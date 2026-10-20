import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, PDFName } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { boundedAnnotations } from '../src/features/pdf-to-word/core/annotations.js';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { prepareWordScene } from '../src/features/pdf-to-word/adapters/scene.js';
import { inspectSceneInk } from '../src/features/pdf-to-word/core/ink-coverage.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const output = 'tmp/pdf-word-annotations'; await mkdir(output, { recursive: true });
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([320, 260]);
page.drawText('Editable heading', { x: 20, y: 230, font, size: 12 });
page.drawText('Highlighted wording', { x: 25, y: 170, font, size: 12 });
page.drawText('COVERED-ANNOTATION-SECRET', { x: 25, y: 110, font, size: 12 });
page.drawText('Editable footer', { x: 20, y: 40, font, size: 12 });
const annotation = (rect, appearance, resources = {}) => {
  const form = pdf.context.flateStream(appearance, { Type: 'XObject', Subtype: 'Form',
    BBox: [0, 0, rect[2] - rect[0], rect[3] - rect[1]], Resources: resources });
  return pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: rect, F: 4,
    AP: { N: pdf.context.register(form) } }));
};
const blend = pdf.context.register(pdf.context.obj({ Type: 'ExtGState', BM: 'Multiply', ca: .5 }));
page.node.set(PDFName.of('Annots'), pdf.context.obj([
  annotation([20, 160, 170, 190], 'q /Highlight gs 1 1 0 rg 0 0 150 30 re f Q', { ExtGState: { Highlight: blend } }),
  annotation([20, 100, 235, 130], 'q 1 1 1 rg 0 0 215 30 re f Q'),
  annotation([15, 25, 200, 60], 'q Q'),
]));
const bytes = await pdf.save(); await writeFile(`${output}/source.pdf`, bytes);
const task = getDocument({ data: bytes.slice(), fontExtraProperties: true, verbosity: 0, standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
try {
  const document = await task.promise, original = await document.getPage(1), canvas = createCanvas(1, 1);
  const operation = { optionalContentConfig: await document.getOptionalContentConfig({ intent: 'display' }) };
  const snapshot = await snapshotPage(original, OPS, () => {}, operation.optionalContentConfig);
  const plan = await renderPage(original, canvas, operation); snapshot.fonts = snapshotFonts(original, snapshot.fontIds);
  assert.equal(snapshot.operations.filter(operation => operation.name === 'beginAnnotation').length, 3);
  const scene = prepareWordScene(snapshot, { measurementContext: createCanvas(1, 1).getContext('2d') });
  assert(!scene.rasterPage, 'bounded appearances do not rasterize the complete page');
  for (const label of ['Editable heading', 'Editable footer']) assert.equal(scene.sources.find(source => source.text === label).disposition, 'editable');
  assert.equal(scene.sources.find(source => source.text === 'Highlighted wording').disposition, 'visible-image');
  assert(inspectSceneInk(scene, canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data,
    canvas.width, canvas.height, plan.scale).accepted);
  const assets = await collectPageAssets(scene, canvas, createCanvas);
  const covered = scene.items.find(item => item.type === 'image' && item.sourceIds.some(id => scene.sources.find(source => source.id === id)?.text === 'COVERED-ANNOTATION-SECRET'));
  assert(covered);
  const asset = assets.find(asset => asset.id === covered.id), image = await loadImage(asset.bytes), crop = createCanvas(image.width, image.height);
  crop.getContext('2d').drawImage(image, 0, 0);
  const pixels = crop.getContext('2d').getImageData(0, 0, crop.width, crop.height).data;
  for (let i = 0; i < pixels.length; i += 4) assert(Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 240, 'the annotation hides the original secret in image pixels');
  const result = await createWordBytes(inferDocument([scene], { preserveGeometry: true }), assets,
    { preserveGeometry: true, measurementContext: createCanvas(1, 1).getContext('2d') });
  const xml = await (await JSZip.loadAsync(result.bytes)).file('word/document.xml').async('string');
  assert(!xml.includes('COVERED-ANNOTATION-SECRET'));
  assert(xml.includes('Editable') && xml.includes('heading') && xml.includes('footer'));
  await writeFile(`${output}/result.docx`, result.bytes);
  for (const change of [
    operations => operations.pop(),
    operations => operations.push({ name: 'showText', args: [[]] }),
    operations => { operations.find(operation => operation.name === 'beginAnnotation').args[1] = null; },
    operations => { operations.find(operation => operation.name === 'endAnnotation').name = 'beginAnnotation'; },
  ]) {
    const operations = structuredClone(snapshot.operations); change(operations);
    assert.equal(boundedAnnotations(operations, snapshot.transform, { x: 0, y: 0, width: 320, height: 260 }), null);
  }
  canvas.width = canvas.height = crop.width = crop.height = 0; original.cleanup();
} finally { await task.destroy(); }
console.log('PDF Word annotations passed: actual highlight/cover appearances, empty appearance, surrounding editable text, pixels and fail-closed boundaries.');
