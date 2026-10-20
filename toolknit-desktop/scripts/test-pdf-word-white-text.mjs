import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import { spatialIndex } from '../src/features/pdf-to-word/core/geometry.js';
import { hasDarkTextBackground } from '../src/features/pdf-to-word/core/text-background.js';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { prepareWordScene } from '../src/features/pdf-to-word/adapters/scene.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const item = { rect: { x: 30, y: 30, width: 100, height: 12 }, order: 10, preciseInk: true };
const paint = { rect: { x: 20, y: 20, width: 160, height: 40 }, order: 1, solidRect: true, opaque: true, color: '202020' };
assert(hasDarkTextBackground(item, spatialIndex([paint]), spatialIndex([item])));
for (const change of [
  { solidRect: false }, { opaque: false }, { color: 'EEEEEE' }, { color: 'invalid' }, { order: 11 },
  { rect: { x: 20, y: 20, width: 35, height: 40 } },
]) assert(!hasDarkTextBackground(item, spatialIndex([{ ...paint, ...change }]), spatialIndex([item])));
assert(!hasDarkTextBackground({ ...item, preciseInk: false }, spatialIndex([paint]), spatialIndex([item])));
assert(!hasDarkTextBackground(item, spatialIndex([paint, { ...paint, order: 2, solidRect: false }]), spatialIndex([item])));
assert(!hasDarkTextBackground(item, spatialIndex([paint]), spatialIndex([item, { ...item, order: 2 }])));

const directory = 'tmp/pdf-word-white-text'; await mkdir(directory, { recursive: true });
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
const page = pdf.addPage([400, 450]), white = rgb(1, 1, 1), dark = rgb(.1, .2, .3);
page.drawRectangle({ x: 20, y: 280, width: 360, height: 130, color: dark });
page.drawText('Editable header', { x: 40, y: 375, size: 16, font, color: white });
page.drawText('Visible amount 123.45', { x: 40, y: 340, size: 12, font, color: white });
page.drawText('HIDDEN', { x: 40, y: 300, size: 12, font, color: white });
page.drawRectangle({ x: 30, y: 290, width: 140, height: 30, color: dark });
page.drawText('WHITE-ON-WHITE', { x: 40, y: 250, size: 12, font, color: white });
page.drawRectangle({ x: 20, y: 200, width: 200, height: 30, color: dark });
page.drawText('TRANSLUCENT', { x: 40, y: 210, size: 12, font, color: white, opacity: .5 });
page.drawRectangle({ x: 20, y: 150, width: 40, height: 30, color: dark });
page.drawText('PARTIAL-BACKGROUND', { x: 40, y: 160, size: 12, font, color: white });
page.drawRectangle({ x: 20, y: 100, width: 220, height: 30, color: dark });
page.drawRectangle({ x: 20, y: 100, width: 220, height: 30, color: white });
page.drawText('COVERED-BACKGROUND', { x: 40, y: 110, size: 12, font, color: white });
page.drawText('Ordinary body', { x: 40, y: 50, size: 12, font });
const bytes = await pdf.save(); await writeFile(`${directory}/source.pdf`, bytes);
const task = getDocument({ data: bytes.slice(), fontExtraProperties: true, useSystemFonts: false, verbosity: 0,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
try {
  const document = await task.promise, original = await document.getPage(1), canvas = createCanvas(1, 1);
  const operation = { optionalContentConfig: await document.getOptionalContentConfig({ intent: 'display' }) };
  const snapshot = await snapshotPage(original, OPS, () => {}, operation.optionalContentConfig);
  const plan = await renderPage(original, canvas, operation); snapshot.fonts = snapshotFonts(original, snapshot.fontIds);
  const scene = prepareWordScene(snapshot, { measurementContext: createCanvas(1, 1).getContext('2d') });
  const sourceFor = text => scene.sources.find(source => source.text === text);
  for (const label of ['Editable header', 'Visible amount 123.45', 'Ordinary body']) assert.equal(sourceFor(label).disposition, 'editable');
  assert.equal(sourceFor('HIDDEN').disposition, 'excluded-hidden');
  const protectedLabels = ['WHITE-ON-WHITE', 'TRANSLUCENT', 'PARTIAL-BACKGROUND', 'COVERED-BACKGROUND'];
  for (const label of protectedLabels) assert.equal(sourceFor(label).disposition, 'visible-image');
  const assets = await collectPageAssets(scene, canvas, createCanvas);
  const background = scene.items.find(item => item.backgroundPaintIndexes?.length);
  assert(background, 'white lettering must retain its proven dark backdrop');
  const decoded = await loadImage(assets.find(asset => asset.id === background.id).bytes);
  const image = createCanvas(decoded.width, decoded.height), context = image.getContext('2d'); context.drawImage(decoded, 0, 0);
  for (const label of ['Editable header', 'Visible amount 123.45', 'HIDDEN']) {
    const rect = sourceFor(label).rect;
    const x = Math.floor(rect.x * plan.scale) - Math.floor(background.rect.x * plan.scale) - 2;
    const y = Math.floor(rect.y * plan.scale) - Math.floor(background.rect.y * plan.scale) - 2;
    const pixels = context.getImageData(x, y, Math.ceil(rect.width * plan.scale) + 4, Math.ceil(rect.height * plan.scale) + 4).data;
    assert(!pixels.some((value, index) => index % 4 === 0 && value > 200 && pixels[index + 1] > 200 && pixels[index + 2] > 200),
      'the actual dark PNG contains neither the old white letters nor hidden text');
  }
  const output = await createWordBytes(inferDocument([scene], { preserveGeometry: true }), assets,
    { preserveGeometry: true, measurementContext: createCanvas(1, 1).getContext('2d') });
  const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
  for (const label of ['HIDDEN', ...protectedLabels]) assert(!xml.includes(label));
  assert(xml.includes('FFFFFF'));
  await writeFile(`${directory}/result.docx`, output.bytes);
  canvas.width = canvas.height = image.width = image.height = 0;
} finally { await task.destroy(); }
console.log('White text: proven solid contrast, real background removal, covered/transparent/partial/invisible text safeguards and DOCX passed.');
