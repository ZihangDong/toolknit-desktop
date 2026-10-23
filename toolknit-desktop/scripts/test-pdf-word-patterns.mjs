import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, PDFName, PDFOperator, pushGraphicsState, popGraphicsState,
  rectangle, fill, beginText, endText, setFontAndSize, setTextMatrix, showText } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { prepareWordScene } from '../src/features/pdf-to-word/adapters/scene.js';
import { inspectSceneInk } from '../src/features/pdf-to-word/core/ink-coverage.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const directory = 'tmp/pdf-word-patterns'; await mkdir(directory, { recursive: true });
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([320, 260]);
const pattern = pdf.context.register(pdf.context.flateStream('0.8 g 0 0 8 8 re f 0.2 G 0.5 w 0 0 m 8 8 l S',
  { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 8, 8], XStep: 8, YStep: 8, Resources: {} }));
page.node.Resources().set(PDFName.of('Pattern'), pdf.context.obj({ Hatch: pattern }));
const patternColor = () => [PDFOperator.of('cs', [PDFName.of('Pattern')]), PDFOperator.of('scn', [PDFName.of('Hatch')])];
page.drawText('Editable before', { x: 20, y: 225, font, size: 12 });
page.drawText('PATTERN-COVERED-SECRET', { x: 25, y: 140, font, size: 12 });
page.pushOperators(pushGraphicsState(), ...patternColor(), rectangle(20, 120, 220, 45), fill(), popGraphicsState());
const fontKey = page.node.newFontDictionary(font.name, font.ref);
page.pushOperators(pushGraphicsState(), ...patternColor(), beginText(), setFontAndSize(fontKey, 12),
  setTextMatrix(1, 0, 0, 1, 25, 80), showText(font.encodeText('Patterned lettering')), endText(), popGraphicsState());
page.drawText('Editable after', { x: 20, y: 40, font, size: 12 });
const bytes = await pdf.save(); await writeFile(`${directory}/source.pdf`, bytes);
const task = getDocument({ data: bytes.slice(), fontExtraProperties: true, verbosity: 0, standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
try {
  const document = await task.promise, original = await document.getPage(1), canvas = createCanvas(1, 1);
  const operation = { optionalContentConfig: await document.getOptionalContentConfig({ intent: 'display' }) };
  const snapshot = await snapshotPage(original, OPS, () => {}, operation.optionalContentConfig);
  const plan = await renderPage(original, canvas, operation); snapshot.fonts = snapshotFonts(original, snapshot.fontIds);
  assert(snapshot.operations.some(operation => operation.name === 'setFillColorN'));
  const scene = prepareWordScene(snapshot, { measurementContext: createCanvas(1, 1).getContext('2d') });
  assert(!scene.rasterPage, 'a bounded hatch is a local graphic, not a reason to rasterize the page');
  for (const label of ['Editable before', 'Editable after']) assert.equal(scene.sources.find(source => source.text === label).disposition, 'editable');
  for (const label of ['PATTERN-COVERED-SECRET', 'Patterned lettering']) assert.equal(scene.sources.find(source => source.text === label).disposition, 'visible-image');
  assert(inspectSceneInk(scene, canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data,
    canvas.width, canvas.height, plan.scale).accepted);
  const assets = await collectPageAssets(scene, canvas, createCanvas);
  const result = await createWordBytes(inferDocument([scene], { preserveGeometry: true }), assets,
    { preserveGeometry: true, measurementContext: createCanvas(1, 1).getContext('2d') });
  const xml = await (await JSZip.loadAsync(result.bytes)).file('word/document.xml').async('string');
  assert(!xml.includes('PATTERN-COVERED-SECRET') && !xml.includes('Patterned lettering'));
  assert(xml.includes('Editable') && xml.includes('before') && xml.includes('after'));
  await writeFile(`${directory}/result.docx`, result.bytes);
  canvas.width = canvas.height = 0; original.cleanup();
} finally { await task.destroy(); }
console.log('PDF Word patterns passed: local hatch, patterned lettering, covering paint, solid color restoration and real DOCX.');
