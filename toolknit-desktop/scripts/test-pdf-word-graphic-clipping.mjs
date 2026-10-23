import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, rectangle, clipEvenOdd, endPath, fill, setFillingColor } from 'pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import { boundedGraphicClip } from '../src/features/pdf-to-word/core/graphic-clipping.js';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { prepareWordScene } from '../src/features/pdf-to-word/adapters/scene.js';
import { inspectSceneInk } from '../src/features/pdf-to-word/core/ink-coverage.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const graphics = [{ name: 'constructPath', args: ['endPath'] }, { name: 'save' }, { name: 'setFillRGBColor', args: ['#ffffff'] },
  { name: 'constructPath', args: ['fill'] }, { name: 'restore' }, { name: 'restore' }];
assert.deepEqual(boundedGraphicClip(graphics, 0, true), { end: 5, painted: true });
assert.equal(boundedGraphicClip(graphics, 0, false), null);
assert.deepEqual(boundedGraphicClip([{ name: 'constructPath' }, { name: 'restore' }], 0, true), { end: 1, painted: false });
for (const name of ['showText', 'beginText', 'beginAnnotation', 'paintFormXObjectBegin', 'beginGroup', 'endMarkedContent', 'unknown']) {
  assert.equal(boundedGraphicClip([graphics[0], { name }, { name: 'restore' }], 0, true), null);
}
for (const state of [[['Font', ['face', 12]]], [['SMask', true]], [['BM', 'multiply']]]) {
  assert.equal(boundedGraphicClip([graphics[0], { name: 'setGState', args: [state] }, { name: 'restore' }], 0, true), null);
}
assert.deepEqual(boundedGraphicClip([graphics[0], { name: 'setGState', args: [[['BM', 'source-over'], ['SMask', false], ['ca', 1]]] },
  { name: 'shadingFill' }, { name: 'restore' }], 0, true), { end: 3, painted: true });
assert.equal(boundedGraphicClip(graphics.slice(0, -1), 0, true), null);
assert.equal(boundedGraphicClip([graphics[0], ...Array.from({ length: 2050 }, () => ({ name: 'dependency' })), { name: 'restore' }], 0, true), null);

const directory = 'tmp/pdf-word-graphic-clipping'; await mkdir(directory, { recursive: true });
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([360, 320]);
page.drawText('Editable heading', { x: 20, y: 285, size: 14, font });
page.drawText('COVERED', { x: 25, y: 220, size: 10, font });
page.drawText('Hole visible', { x: 140, y: 220, size: 10, font });
page.pushOperators(pushGraphicsState(), rectangle(20, 200, 90, 50), rectangle(260, 200, 80, 50), clipEvenOdd(), endPath(),
  setFillingColor(rgb(1, 1, 1)), rectangle(20, 200, 320, 50), fill(), popGraphicsState());
page.drawText('Editable row 123.45', { x: 20, y: 160, size: 12, font });
page.pushOperators(pushGraphicsState(), rectangle(20, 90, 100, 40), rectangle(240, 90, 100, 40), clipEvenOdd(), endPath(),
  setFillingColor(rgb(.2, .4, .7)), rectangle(0, 0, 360, 320), fill(), popGraphicsState());
page.drawText('Editable footer', { x: 20, y: 40, size: 12, font });
const bytes = await pdf.save(); await writeFile(`${directory}/source.pdf`, bytes);
const task = getDocument({ data: bytes.slice(), fontExtraProperties: true, useSystemFonts: false, verbosity: 0,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
try {
  const document = await task.promise, original = await document.getPage(1), canvas = createCanvas(1, 1);
  const operation = { optionalContentConfig: await document.getOptionalContentConfig({ intent: 'display' }) };
  const snapshot = await snapshotPage(original, OPS, () => {}, operation.optionalContentConfig);
  const plan = await renderPage(original, canvas, operation); snapshot.fonts = snapshotFonts(original, snapshot.fontIds);
  const scene = prepareWordScene(snapshot, { measurementContext: createCanvas(1, 1).getContext('2d') });
  assert(!scene.rasterPage, 'bounded graphic-only compound clips must not rasterize unrelated text');
  for (const label of ['Editable heading', 'Editable row 123.45', 'Editable footer']) {
    assert.equal(scene.sources.find(source => source.text === label).disposition, 'editable');
  }
  assert(inspectSceneInk(scene, canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data,
    canvas.width, canvas.height, plan.scale).accepted);
  const assets = await collectPageAssets(scene, canvas, createCanvas);
  const covered = scene.items.find(item => item.type === 'image' && item.sourceIds.some(id => scene.sources.find(source => source.id === id)?.text === 'COVERED'));
  assert(covered, 'uncertain covered text stays with the final visible crop');
  const asset = assets.find(asset => asset.id === covered.id), decoded = await loadImage(asset.bytes);
  const image = createCanvas(decoded.width, decoded.height), context = image.getContext('2d'); context.drawImage(decoded, 0, 0);
  const rect = scene.sources.find(source => source.text === 'COVERED').rect;
  const pixels = context.getImageData(Math.floor(rect.x * plan.scale) - Math.floor(covered.rect.x * plan.scale),
    Math.floor(rect.y * plan.scale) - Math.floor(covered.rect.y * plan.scale), Math.ceil(rect.width * plan.scale), Math.ceil(rect.height * plan.scale)).data;
  for (let index = 0; index < pixels.length; index += 4) assert(Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) > 240);
  const output = await createWordBytes(inferDocument([scene], { preserveGeometry: true }), assets,
    { preserveGeometry: true, measurementContext: createCanvas(1, 1).getContext('2d') });
  const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
  assert(!xml.includes('COVERED')); assert(xml.includes('Editable'));
  await writeFile(`${directory}/result.docx`, output.bytes);
  canvas.width = canvas.height = image.width = image.height = 0;
} finally { await task.destroy(); }
console.log('Graphic-only clipping: bounded compound artwork, restored state, visible holes, hidden-text protection and real DOCX passed.');
