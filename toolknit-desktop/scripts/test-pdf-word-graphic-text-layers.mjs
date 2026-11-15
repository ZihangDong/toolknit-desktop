import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb, moveTo, lineTo, closePath, fill, setFillingColor } from 'pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { prepareWordScene } from '../src/features/pdf-to-word/adapters/scene.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { recoverGraphicTextLayers } from '../src/features/pdf-to-word/core/graphic-text-layers.js';
import { LIMITS } from '../src/features/pdf-to-word/core/input.js';

const rect = { x: 20, y: 20, width: 80, height: 10 };
const texts = ['Alpha', 'Bravo'].map((text, index) => ({ id: `p1:t${index * 3 + 1}`, sourceIds: [`p1:t${index * 3 + 1}`],
  text, rect: { ...rect, y: 20 + index * 30 }, size: 10, preciseInk: true, raster: false }));
const sources = texts.map(item => ({ ...item, disposition: 'visible-image' }));
const background = { id: 'picture', type: 'image', role: 'figure', sourceIds: texts.map(item => item.id), rect: { x: 0, y: 0, width: 200, height: 100 } };
const operations = texts.flatMap(() => [{ name: 'beginText' }, { name: 'showText' }, { name: 'endText' }]);
const fixture = () => ({ number: 1, items: [structuredClone(background)], text: structuredClone(texts), sources: structuredClone(sources), operations });
assert.equal(recoverGraphicTextLayers(fixture()).count, 1);
const partial = fixture();
partial.items[0].sourceIds.shift();
partial.items[0].backgroundPaintIndexes = [1];
partial.sources[0].disposition = 'editable';
partial.items.push({ ...partial.text[0], type: 'text' });
const completedLayer = recoverGraphicTextLayers({ ...partial, maxLayers: 0 });
assert.equal(completedLayer.count, 0, 'extending an existing backdrop does not allocate another layer');
assert.deepEqual(completedLayer.items[0].backgroundPaintIndexes, [1, 4]);
assert.deepEqual(completedLayer.items[0].sourceIds, []);
assert.deepEqual(completedLayer.items.filter(item => item.type === 'text').map(item => item.text).sort(), ['Alpha', 'Bravo']);
assert.deepEqual(partial.items[0].backgroundPaintIndexes, [1], 'do not mutate the prior layer selection');
const full = recoverGraphicTextLayers({ ...fixture(), maxLayers: 0 });
assert.equal(full.count, 0); assert.equal(full.items.length, 1, 'a full budget cannot allocate a new backdrop');
const overlapping = fixture(); overlapping.items.push({ ...structuredClone(background), id: 'nested', sourceIds: [] });
assert.equal(recoverGraphicTextLayers(overlapping).count, 0, 'overlapping crops must not retain a second painted copy of restored text');

// The small neighbouring formula is inside the conservative proximity halo,
// but outside the independently removable prose draw's actual bounds.
const proseFixture = (phrase = 'Complete ordinary prose') => {
  const value = fixture();
  Object.assign(value.text[0], { text: phrase, font: 'ABCDEF+NimbusRomNo9L-Regu', bold: false, italic: false });
  Object.assign(value.text[1], { text: '2', font: 'CMMI7', size: 6, rect: { x: 50, y: 31, width: 4, height: 5 } });
  value.sources = value.text.map(item => ({ ...item, disposition: 'visible-image' }));
  return value;
};
for (const phrase of ['Complete ordinary prose', '. Further ordinary explanation [']) {
  const value = proseFixture(phrase), result = recoverGraphicTextLayers(value);
  assert.equal(result.count, 1);
  assert.deepEqual(result.items[0].backgroundPaintIndexes, [1], 'only the complete prose paint is removed');
  assert.deepEqual(result.items[0].sourceIds, ['p1:t4'], 'the neighbouring formula stays in its original layer');
  assert.equal(value.sources[0].disposition, 'editable');
  assert.equal(value.sources[1].disposition, 'visible-image');
  assert.equal(result.items.find(item => item.type === 'text').text, phrase);
}
for (const change of [
  value => { value.text[1].rect.y = 28; },
  value => { value.text[0].font = 'UnverifiedFace'; },
  value => { value.text[0].ocr = true; },
  value => { value.text[0].italic = true; },
  value => { value.text[0].bold = true; },
  value => { value.text[0].text = 'short word'; },
  value => { value.text[0].text = 'Complete + ordinary prose'; },
  value => { value.text[0].preciseInk = false; },
  value => { value.text[0].alphabet = 'script'; },
  value => { value.maxLayers = 0; },
  value => { value.graphics = [{ thin: true, rect: { x: 30, y: 25, width: 80, height: .5 } }]; },
]) {
  const value = proseFixture(); change(value);
  assert.equal(recoverGraphicTextLayers(value).count, 0, 'uncertain prose ownership keeps the original image');
  assert(value.sources.every(source => source.disposition === 'visible-image'));
}

const directory = 'tmp/pdf-word-graphic-layers'; await mkdir(directory, { recursive: true });
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([320, 320]);
// One compound paint describes a hollow border rather than a filled rectangle.
page.pushOperators(setFillingColor(rgb(.3, .4, .6)),
  moveTo(20, 20), lineTo(300, 20), lineTo(300, 290), lineTo(20, 290), closePath(),
  moveTo(22, 22), lineTo(22, 288), lineTo(298, 288), lineTo(298, 22), closePath(), fill());
for (const [text, x, y] of [['Quotation', 35, 260], ['Item Alpha', 35, 225], ['120.50', 200, 225], ['Item Beta', 35, 195], ['333.00', 200, 195]]) {
  page.drawText(text, { x, y, font, size: 12 });
}
page.drawText('SECRET', { x: 35, y: 55, font, size: 12 });
page.drawRectangle({ x: 30, y: 48, width: 75, height: 25, color: rgb(1, 1, 1) });
page.drawText('150', { x: 210, y: 140, font, size: 12 });
page.drawText('200', { x: 210, y: 119, font, size: 12 });
page.drawLine({ start: { x: 208, y: 136 }, end: { x: 234, y: 136 }, thickness: .5, color: rgb(0, 0, 0) });
page.drawText('index', { x: 40, y: 140, font, size: 12 });
page.drawText('2', { x: 70, y: 145, font, size: 7 });
const input = await pdf.save(); await writeFile(`${directory}/source.pdf`, input);
const task = getDocument({ data: input.slice(), fontExtraProperties: true, verbosity: 0,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
try {
  const document = await task.promise, original = await document.getPage(1), canvas = createCanvas(1, 1);
  const operation = { optionalContentConfig: await document.getOptionalContentConfig({ intent: 'display' }) };
  const snapshot = await snapshotPage(original, OPS, () => {}, operation.optionalContentConfig);
  const plan = await renderPage(original, canvas, operation); snapshot.fonts = snapshotFonts(original, snapshot.fontIds);
  const scene = prepareWordScene(snapshot, { measurementContext: createCanvas(1, 1).getContext('2d') });
  for (const label of ['Quotation', 'Item Alpha', 'Item Beta', '120.50', '333.00']) {
    assert.equal(scene.sources.find(source => source.text === label).disposition, 'editable', 'ordinary labels and amounts are editable over the original graphic');
  }
  assert.equal(scene.sources.find(source => source.text === 'SECRET').disposition, 'excluded-hidden');
  for (const label of ['150', '200', 'index', '2']) assert.equal(scene.sources.find(source => source.text === label).disposition, 'visible-image', label);
  const assets = await collectPageAssets(scene, canvas, createCanvas);
  const image = scene.items.find(item => item.backgroundPaintIndexes?.length);
  assert(image, 'text recovery must create a verified backdrop');
  const asset = assets.find(asset => asset.id === image.id), decoded = await loadImage(asset.bytes);
  const layer = createCanvas(decoded.width, decoded.height); layer.getContext('2d').drawImage(decoded, 0, 0);
  const offsetX = Math.floor(image.rect.x * plan.scale), offsetY = Math.floor(image.rect.y * plan.scale);
  const label = scene.sources.find(source => source.text === 'Item Alpha').rect;
  const pixels = layer.getContext('2d').getImageData(Math.floor(label.x * plan.scale) - offsetX,
    Math.floor(label.y * plan.scale) - offsetY, Math.ceil(label.width * plan.scale), Math.ceil(label.height * plan.scale)).data;
  assert(!pixels.some((value, index) => index % 4 === 0 && value < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100),
    'the old label must be removed from the backdrop, not covered by duplicate Word text');
  const layout = inferDocument([scene], { preserveGeometry: true });
  const output = await createWordBytes(layout, assets, { preserveGeometry: true, measurementContext: createCanvas(1, 1).getContext('2d') });
  const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
  assert(!xml.includes('SECRET')); assert(!xml.includes('>150<')); assert(!xml.includes('>200<'));
  await writeFile(`${directory}/result.docx`, output.bytes);
  canvas.width = canvas.height = layer.width = layer.height = 0;
} finally { await task.destroy(); }

const many = await PDFDocument.create(), manyFont = await many.embedFont(StandardFonts.Helvetica), manyPage = many.addPage([600, 720]);
for (let index = 0; index <= LIMITS.backgroundLayersPerPage; index++) {
  const x = 100 + index % 3 * 200, y = 650 - Math.floor(index / 3) * 110;
  manyPage.drawEllipse({ x, y, xScale: 75, yScale: 30, borderColor: rgb(.1, .4, .7), borderWidth: 1 });
  manyPage.drawText(`Label ${String(index + 1).padStart(2, '0')}`, { x: x - 28, y: y - 4, size: 12, font: manyFont });
}
const manyTask = getDocument({ data: await many.save(), fontExtraProperties: true, verbosity: 0,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
try {
  const document = await manyTask.promise, page = await document.getPage(1), canvas = createCanvas(1, 1);
  const operation = { optionalContentConfig: await document.getOptionalContentConfig({ intent: 'display' }) };
  const originalRender = page.render.bind(page); let renders = 0;
  page.render = options => { renders++; return originalRender(options); };
  const snapshot = await snapshotPage(page, OPS, () => {}, operation.optionalContentConfig);
  await renderPage(page, canvas, operation); snapshot.fonts = snapshotFonts(page, snapshot.fontIds);
  const scene = prepareWordScene(snapshot, { measurementContext: createCanvas(1, 1).getContext('2d') });
  assert.equal(scene.backgroundTextLayers, LIMITS.backgroundLayersPerPage);
  assert.equal(scene.sources.filter(source => source.disposition === 'editable').length, LIMITS.backgroundLayersPerPage);
  assert.equal(scene.sources.filter(source => source.disposition === 'visible-image').length, 1);
  await collectPageAssets(scene, canvas, createCanvas);
  assert.equal(renders, 2, 'sixteen cropped backgrounds share one extra PDF render');
  const layers = scene.items.filter(item => item.backgroundPaintIndexes?.length);
  const excessive = { ...scene, items: [...scene.items, { ...layers[0], id: 'extra-background' }] };
  await assert.rejects(collectPageAssets(excessive, canvas, createCanvas), /pdf-to-word:image/);
  canvas.width = canvas.height = 0;
} finally { await manyTask.destroy(); }
console.log('PDF Word graphic text layer tests passed.');
