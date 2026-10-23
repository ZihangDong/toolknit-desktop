import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, PDFOperator, StandardFonts, rgb, beginText, endText, setFontAndSize, setTextMatrix } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { prepareWordScene } from '../src/features/pdf-to-word/adapters/scene.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const directory = 'tmp/pdf-word-text-paints'; await mkdir(directory, { recursive: true });
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([240, 200]);
const key = page.node.newFontDictionary(font.name, font.ref);
for (const [y, a, b] of [[150, '123.45', '678.90'], [70, '111.11', '999.99']]) {
  page.pushOperators(beginText(), setFontAndSize(key, 10), setTextMatrix(1, 0, 0, 1, 30, y),
    PDFOperator.of('TJ', [pdf.context.obj([font.encodeText(a), -6000, font.encodeText(b)])]), endText());
}
page.drawLine({ start: { x: 100, y: 40 }, end: { x: 100, y: 175 }, thickness: .5, color: rgb(0, 0, 0) });
page.drawRectangle({ x: 115, y: 65, width: 55, height: 18, color: rgb(.8, .8, .8) });
const input = await pdf.save(); await writeFile(`${directory}/source.pdf`, input);
const task = getDocument({ data: input.slice(), fontExtraProperties: true, verbosity: 0,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
try {
  const document = await task.promise, original = await document.getPage(1), canvas = createCanvas(1, 1);
  const operation = { optionalContentConfig: await document.getOptionalContentConfig({ intent: 'display' }) };
  const snapshot = await snapshotPage(original, OPS, () => {}, operation.optionalContentConfig);
  await renderPage(original, canvas, operation); snapshot.fonts = snapshotFonts(original, snapshot.fontIds);
  const scene = prepareWordScene(snapshot, { measurementContext: createCanvas(1, 1).getContext('2d') });
  assert.equal(scene.sources.find(source => source.text.includes('123.45')).disposition, 'editable',
    'a border in the whitespace between separate words cannot mark those words as occluded');
  assert.equal(scene.sources.find(source => source.text.includes('999.99')).disposition, 'visible-image',
    'actual coverage of one word still protects the entire drawing operation');
  const output = await createWordBytes(inferDocument([scene], { preserveGeometry: true }),
    await collectPageAssets(scene, canvas, createCanvas), { preserveGeometry: true, measurementContext: createCanvas(1, 1).getContext('2d') });
  const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
  assert(xml.includes('123.45')); assert(xml.includes('678.90')); assert(!xml.includes('999.99'));
  await writeFile(`${directory}/result.docx`, output.bytes);
  canvas.width = canvas.height = 0;
} finally { await task.destroy(); }
console.log('PDF Word text paint occupancy tests passed.');
