import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { photographicOcrRegions } from '../src/features/pdf-to-word/core/ocr-photo-regions.js';
import { prepareOcrScene } from '../src/features/pdf-to-word/core/ocr-scene.js';
import { collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { inferDocument, validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const canvas = createCanvas(800, 600), ctx = canvas.getContext('2d');
function texture() {
  const image = ctx.createImageData(800, 600);
  for (let y = 0; y < 600; y++) for (let x = 0; x < 800; x++) {
    const offset = (y * 800 + x) * 4;
    image.data[offset] = 35 + (x * .19 + y * .11) % 175;
    image.data[offset + 1] = 45 + (x * .07 + y * .31) % 165;
    image.data[offset + 2] = 65 + (x * .23 + y * .13) % 155;
    image.data[offset + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}
const image = { id: 'original-picture', type: 'image', role: 'figure', rect: { x: 0, y: 0, width: 800, height: 600 },
  sourceIds: [], drawingIds: ['original-raster'], reasons: [] };
const scene = { number: 1, width: 800, height: 600, items: [image], sources: [], rules: [],
  risks: ['image-page'], characters: 0, rasterPage: false };
texture();
ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 800, 8); ctx.fillRect(0, 592, 800, 8);
ctx.fillRect(0, 0, 8, 600); ctx.fillRect(792, 0, 8, 600);
ctx.fillRect(80, 90, 240, 110); // A photographed white sign, isolated from real paper.
ctx.fillRect(0, 520, 800, 80); // A real document caption connected to its page boundary.
ctx.fillStyle = '#253E6A'; ctx.font = '32px Arial'; ctx.fillText('STORE', 100, 150);
ctx.fillStyle = 'black'; ctx.fillText('SIZE 5995 x 2240', 40, 570);
const pixels = ctx.getImageData(0, 0, 800, 600).data, original = structuredClone(scene);
const sign = { x: 95, y: 118, width: 160, height: 38 }, caption = { x: 35, y: 535, width: 310, height: 40 };
const check = photographicOcrRegions(scene, pixels, 800, 600);
assert(check(sign), 'an isolated white sign inside a continuous-tone picture stays photographic');
assert(!check(caption), 'surrounding real paper is still eligible for OCR');
assert(!check({ x: 900, y: 0, width: 20, height: 20 }));
assert.deepEqual(scene, original);

const wrong = { text: 'WRONG', ...sign, confidence: .99 }, body = { text: 'SIZE 5995 x 2240', ...caption, confidence: .99 };
const prepared = prepareOcrScene({ scene, result: { width: 800, height: 600, lines: [wrong, body] },
  pixels, width: 800, height: 600, preserveGeometry: true, measurementContext: ctx });
assert(prepared.changed);
assert(!prepared.scene.items.some(item => item.type === 'text' && item.text === 'WRONG'), 'a high recognizer score cannot replace picture labels');
assert(prepared.scene.items.some(item => item.type === 'text' && item.text === body.text));
const hypothesis = prepared.scene.sources.find(source => source.id === 'p1:ocr0');
assert(hypothesis.ocrUnverified && hypothesis.disposition === 'visible-image');
for (let y = 60; y < 500; y++) for (let x = 30; x < 770; x++) {
  const offset = (y * 800 + x) * 4;
  assert.deepEqual(prepared.pixels.subarray(offset, offset + 4), pixels.subarray(offset, offset + 4), 'every original picture pixel survives');
}
const assets = await collectPageAssets(prepared.scene, canvas, createCanvas);
const document = inferDocument([prepared.scene], { preserveGeometry: true });
assert.equal(validateCoverage(document).imageCharacters, wrong.text.length);
const word = await createWordBytes(document, assets, { preserveGeometry: true, measurementContext: ctx });
const xml = await (await JSZip.loadAsync(word.bytes)).file('word/document.xml').async('string');
assert(!xml.includes('WRONG')); assert(xml.includes('5995'));
const allPicture = prepareOcrScene({ scene, result: { width: 800, height: 600, lines: [wrong] },
  pixels, width: 800, height: 600, preserveGeometry: true, measurementContext: ctx });
assert.equal(allPicture.changed, false); assert.deepEqual(allPicture.pixels, pixels);
assert.equal(allPicture.scene.items.length, 1); assert(allPicture.scene.items[0].sourceIds.includes(hypothesis.id));

const nativeOverlay = { id: 'native-overlay', type: 'text', text: 'STORE', rect: sign, sourceIds: ['native-overlay'],
  font: 'Arial', size: 32, baseline: 150, raster: false, color: '253E6A' };
const overlayScene = { ...scene, items: [nativeOverlay, image], sources: [{ id: nativeOverlay.id, text: nativeOverlay.text,
  rect: sign, disposition: 'editable' }], characters: nativeOverlay.text.length };
const overlay = prepareOcrScene({ scene: overlayScene, result: { width: 800, height: 600,
  lines: [{ ...wrong, text: nativeOverlay.text }] }, pixels, width: 800, height: 600, preserveGeometry: true, measurementContext: ctx });
assert.deepEqual(overlay.scene, overlayScene, 'native text over a photograph wins before any new OCR image hypothesis is counted');
assert.deepEqual(overlay.pixels, pixels); assert.equal(overlay.changed, false);

for (const mutate of [
  s => { s.items[0].sourceIds = ['known-native-text']; },
  s => { s.items[0].reasons = ['unknown-clipping']; },
  s => { s.items[0].role = 'math'; },
  s => { s.items[0].thin = true; },
  s => { s.items[0].decoration = true; },
]) {
  const copy = structuredClone(scene); mutate(copy);
  assert(!photographicOcrRegions(copy, pixels, 800, 600)(sign), 'unproven/native image contexts retain their previous pipeline');
}
const transparent = pixels.slice(); for (let i = 3; i < transparent.length; i += 4) transparent[i] = 0;
assert(!photographicOcrRegions(scene, transparent, 800, 600)(sign));
assert(!photographicOcrRegions(scene, pixels.subarray(0, 8), 800, 600)(sign));

// A photograph of a large sheet has genuine internal paper. Table rules split
// white regions, but bounded closing keeps the clear paper available for OCR.
texture(); ctx.fillStyle = 'white'; ctx.fillRect(140, 50, 520, 500);
ctx.strokeStyle = '#333333'; ctx.lineWidth = 1;
for (let y = 110; y < 500; y += 40) { ctx.beginPath(); ctx.moveTo(160, y); ctx.lineTo(640, y); ctx.stroke(); }
ctx.font = '24px Arial'; ctx.fillStyle = 'black'; ctx.fillText('Document body', 190, 95);
const paper = ctx.getImageData(0, 0, 800, 600).data, sheet = photographicOcrRegions(scene, paper, 800, 600);
assert(sheet({ x: 30, y: 20, width: 40, height: 20 }), 'the surrounding continuous-tone region is actually classified');
assert(!sheet({ x: 185, y: 65, width: 220, height: 35 }), 'large internal paper is not swallowed by photograph protection');
assert(!sheet({ x: 185, y: 120, width: 220, height: 30 }), 'clear table-cell paper remains available');

ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 800, 600); ctx.fillStyle = 'black'; ctx.font = '24px Arial';
for (let y = 30; y < 600; y += 40) ctx.fillText('Readable scanned document body 12345', 30, y);
const scan = ctx.getImageData(0, 0, 800, 600).data;
assert(!photographicOcrRegions(scene, scan, 800, 600)({ x: 25, y: 40, width: 400, height: 30 }));
canvas.width = canvas.height = 0;
console.log('OCR photographs: isolated signs, exact source pixels, actual Word text, boundary/large internal paper, table rules, native/unknown refusal and bounded maps passed.');
