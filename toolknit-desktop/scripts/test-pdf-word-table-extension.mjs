import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { prepareWordScene } from '../src/features/pdf-to-word/adapters/scene.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const directory = 'tmp/pdf-word-table-extension';
await mkdir(directory, { recursive: true });
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
const page = pdf.addPage([300, 500]), red = rgb(.7, .1, .1);
page.drawRectangle({ x: 20, y: 180, width: 240, height: 200, borderColor: red, borderWidth: .5 });
page.drawLine({ start: { x: 140, y: 180 }, end: { x: 140, y: 380 }, color: red, thickness: .5 });
page.drawLine({ start: { x: 20, y: 280 }, end: { x: 260, y: 280 }, color: red, thickness: .5 });
// Connected artwork extends the backdrop without introducing another cell.
page.drawLine({ start: { x: 260, y: 180 }, end: { x: 230, y: 145 }, color: red, thickness: .5 });
for (const [text, x, y] of [['A', 36, 340], ['B', 160, 340], ['C', 36, 240], ['K', 230, 155]]) {
  page.drawText(text, { x, y, size: 12, font });
}
page.drawText('Footer', { x: 40, y: 155, size: 12, font });
page.drawText('1', { x: 180, y: 250, size: 12, font });
page.drawLine({ start: { x: 178, y: 246 }, end: { x: 189, y: 246 }, thickness: .5 });
page.drawText('2', { x: 180, y: 232, size: 12, font });
page.drawText('HIDDEN', { x: 160, y: 205, size: 12, font });
page.drawRectangle({ x: 155, y: 199, width: 85, height: 22, color: rgb(1, 1, 1) });
const input = await pdf.save();
await writeFile(`${directory}/source.pdf`, input);
const task = getDocument({ data: input.slice(), fontExtraProperties: true, useSystemFonts: false, verbosity: 0,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
try {
  const source = await task.promise, original = await source.getPage(1), canvas = createCanvas(1, 1);
  const operation = { optionalContentConfig: await source.getOptionalContentConfig({ intent: 'display' }) };
  const snapshot = await snapshotPage(original, OPS, () => {}, operation.optionalContentConfig);
  const plan = await renderPage(original, canvas, operation);
  snapshot.fonts = snapshotFonts(original, snapshot.fontIds);
  const scene = prepareWordScene(snapshot, { measurementContext: createCanvas(1, 1).getContext('2d') });
  const sourceFor = text => scene.sources.find(source => source.text === text);
  for (const label of ['A', 'B', 'C', 'Footer']) assert.equal(sourceFor(label).disposition, 'editable');
  assert.equal(scene.backgroundTextLayers, 1, 'table cells and independent graphic labels share one backdrop');
  for (const label of ['1', '2', 'K']) assert.equal(sourceFor(label).disposition, 'visible-image');
  assert.equal(sourceFor('HIDDEN').disposition, 'excluded-hidden');
  const backdrop = scene.items.find(item => item.backgroundPaintIndexes?.length);
  assert(backdrop && backdrop.rect.height > 230, 'the retained backdrop includes the connected footer');
  const assets = await collectPageAssets(scene, canvas, createCanvas);
  const asset = assets.find(asset => asset.id === backdrop.id);
  const decoded = await loadImage(asset.bytes), visible = createCanvas(decoded.width, decoded.height);
  const context = visible.getContext('2d'); context.drawImage(decoded, 0, 0);
  const blackIn = rect => {
    const x = Math.max(0, Math.floor(rect.x * plan.scale) - Math.floor(backdrop.rect.x * plan.scale) - 2);
    const y = Math.max(0, Math.floor(rect.y * plan.scale) - Math.floor(backdrop.rect.y * plan.scale) - 2);
    const { data } = context.getImageData(x, y, Math.min(visible.width - x, Math.ceil(rect.width * plan.scale) + 4),
      Math.min(visible.height - y, Math.ceil(rect.height * plan.scale) + 4));
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (Math.max(data[i], data[i + 1], data[i + 2]) < 70) count++;
    return count;
  };
  for (const label of ['A', 'B', 'C', 'Footer', 'HIDDEN']) assert.equal(blackIn(sourceFor(label).rect), 0,
    'editable words and the redacted word must not survive in the actual stored PNG');
  for (const label of ['1', '2', 'K']) assert(blackIn(sourceFor(label).rect) > 40,
    'uncertain expressions and content outside confirmed cells remain in the backdrop');
  await writeFile(`${directory}/background.png`, asset.bytes);
  const layout = inferDocument([scene]);
  for (const continuous of [false, true]) {
    const result = await createWordBytes(layout, assets, { continuous, measurementContext: createCanvas(1, 1).getContext('2d') });
    const zip = await JSZip.loadAsync(result.bytes), xml = await zip.file('word/document.xml').async('string');
    for (const label of ['A', 'B', 'C', 'Footer']) assert.equal(xml.split(`>${label}<`).length - 1, 1);
    assert(!xml.includes('HIDDEN'));
    assert.equal(result.quality.editableCharacters, 9);
    assert.equal(result.quality.imageCharacters, 3);
    await writeFile(`${directory}/${continuous ? 'continuous' : 'positioned'}.docx`, result.bytes);
  }
  canvas.width = canvas.height = visible.width = visible.height = 0;
} finally { await task.destroy(); }
console.log('Extended table backdrop: real PDF/PNG/DOCX preserve footer and fraction, recover cell text once and keep hidden text excluded.');
