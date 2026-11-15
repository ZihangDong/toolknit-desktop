import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { createOcrPhysicalTypography } from '../src/features/pdf-to-word/adapters/ocr-physical-typography.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

// The reference is an independently painted font glyph at scan resolution,
// rather than a font signature or the proposed Word rendering.
function sample(text = '利', font = 'SimSun', sourceBold = false, wrongFont = 'SimSun', proposedSize = 22) {
  const canvas = createCanvas(640, 320), c = canvas.getContext('2d'), sx = 4;
  c.fillStyle = '#fff'; c.fillRect(0, 0, 640, 320); c.fillStyle = '#000';
  c.font = `${sourceBold ? 'bold ' : ''}56px "${font}"`; c.fillText(text, 120, 200);
  const pixels = c.getImageData(0, 0, 640, 320).data;
  let x = 640, y = 320, right = 0, bottom = 0;
  for (let yy = 0; yy < 320; yy++) for (let xx = 0; xx < 640; xx++) if (pixels[(yy * 640 + xx) * 4] < 180) {
    x = Math.min(x, xx); y = Math.min(y, yy); right = Math.max(right, xx + 1); bottom = Math.max(bottom, yy + 1);
  }
  const rect = { x: x / sx, y: y / sx, width: (right - x) / sx, height: (bottom - y) / sx };
  const word = { text, rect: { ...rect }, size: proposedSize, baseline: 50, baselineX: rect.x, advanceWidth: rect.width,
    font: wrongFont, fontFamily: wrongFont, bold: true, confidence: .9999, ocrGlyphScore: .8, preciseInk: true, glyphScale: 100 };
  const item = { id: 'row', type: 'text', sourceIds: ['row'], text, rect, size: 14, baseline: 50, baselineX: rect.x,
    font, fontFamily: font, bold: sourceBold, color: '000000', words: [word], ocr: true,
    ocrFontScore: .9, preciseInk: true, raster: false, italic: false, order: 0 };
  const scene = { number: 1, width: 160, height: 80, items: [item], sources: [{ id: 'row', text, rect: { ...rect }, disposition: 'editable' }],
    rules: [], risks: ['ocr'], characters: 1 };
  canvas.width = canvas.height = 0;
  return { prepared: { changed: true, scene, pixels: Uint8ClampedArray.from(pixels) }, data: { pixels, width: 640, height: 320 }, item, word };
}
const owned = [], trackedCanvas = (w, h) => {
  const canvas = createCanvas(w, h), reset = {};
  for (const axis of ['width', 'height']) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(canvas), axis);
    Object.defineProperty(canvas, axis, { get: () => descriptor.get.call(canvas),
      set(value) { reset[axis] = value; descriptor.set.call(canvas, value); } });
  }
  // NAPI resets a zero-sized canvas to its default dimensions. Observe the
  // actual release calls, forwarding them to the backend, instead of asserting
  // browser-specific getter values on this native test backend.
  owned.push(reset); return canvas;
};
const refine = createOcrPhysicalTypography(trackedCanvas);
const original = sample(), frozenPixels = Uint8ClampedArray.from(original.data.pixels), frozenSources = structuredClone(original.prepared.scene.sources);
assert.equal(refine(original.prepared, original.data), original.prepared);
assert(original.word.ocrPhysicalFit, 'independent 14pt scan ink corrects a genuinely oversized 22pt bold proposal');
assert.equal(original.word.bold, false);
assert(Math.abs(original.word.size - 14) < 1, 'the fitted size follows the original scan rather than the erroneous proposal');
assert.equal(original.word.baseline, 50, 'a physical font fit preserves the established shared-frame anchor');
assert.equal(original.word.text, '利'); assert.deepEqual(original.prepared.scene.sources, frozenSources);
assert.deepEqual(original.data.pixels, frozenPixels); assert.deepEqual(original.prepared.pixels, frozenPixels, 'font proposals cannot repaint the background or hide source ink');
assert(original.word.ocrPhysicalFit.edgeAfter <= 1.25);
const once = structuredClone(original.prepared); refine(original.prepared, original.data);
assert.deepEqual(original.prepared, once, 'repeating the same page refinement is a no-op');
assert(owned.every(c => c.width === 0 && c.height === 0), 'every temporary canvas receives both release calls');
const strong = sample(); strong.item.bold = true;
refine(strong.prepared, strong.data);
assert.equal(strong.word.ocrPhysicalFit?.phase, 'weight', 'a falsely bold line can recover an independently regular glyph');
assert.equal(strong.word.bold, false);

for (const change of [s => { s.word.confidence = .98; }, s => { s.item.ocrNative = true; }, s => { s.word.ocrGlyphScore = .95; },
  s => { s.word.text = 'A'; }, s => { s.word.font = 'UnknownFont'; }, s => { s.item.italic = true; },
  s => { s.prepared.changed = false; }, s => { s.prepared.scene.rules = [{ axis: 'h', at: s.word.rect.y + 3, from: 20, to: 70 }]; }]) {
  const s = sample(); change(s); const before = structuredClone(s.prepared);
  refine(s.prepared, s.data); assert.deepEqual(s.prepared, before, 'uncertain/native/foreign/ruled/unsupported input cannot use this scan refinement');
}
for (const options of [{ pixelBudget: 0 }, { pixelBudget: 1 }, { pixelBudget: Infinity }, { maxChanges: 0 }, { maxChanges: 129 }]) {
  const s = sample(), before = structuredClone(s.prepared); refine(s.prepared, s.data, options); assert.deepEqual(s.prepared, before);
}
const bold = sample('利', 'SimSun', true, 'SimSun', 14), boldBefore = structuredClone(bold.prepared);
refine(bold.prepared, bold.data); assert.deepEqual(bold.prepared, boldBefore, 'a genuinely bold original is not made thin');
const neighbor = sample(); neighbor.item.words.push({ ...neighbor.word, text: '甲', rect: { ...neighbor.word.rect }, ocrGlyphScore: .99 });
const neighborBefore = structuredClone(neighbor.prepared); refine(neighbor.prepared, neighbor.data);
assert.deepEqual(neighbor.prepared, neighborBefore, 'competing word ownership blocks an otherwise attractive physical fit');
const strongNeighbor = sample(); strongNeighbor.item.bold = true;
strongNeighbor.item.words.push({ ...strongNeighbor.word, text: '甲', rect: { ...strongNeighbor.word.rect }, ocrGlyphScore: .99 });
const strongNeighborBefore = structuredClone(strongNeighbor.prepared); refine(strongNeighbor.prepared, strongNeighbor.data);
assert.deepEqual(strongNeighbor.prepared, strongNeighborBefore, 'the strong-line phase also respects competing word ownership');
let checks = 0; const cancelled = sample(), beforeCancel = structuredClone(cancelled.prepared);
assert.throws(() => refine(cancelled.prepared, cancelled.data, { check() { if (++checks === 2) throw Error('cancelled'); } }), /cancelled/);
assert.deepEqual(cancelled.prepared, beforeCancel);
const midFit = sample(), beforeFit = structuredClone(midFit.prepared); checks = 0;
assert.throws(() => refine(midFit.prepared, midFit.data, { check() { if (++checks === 4) throw Error('cancelled'); } }), /cancelled/);
assert.deepEqual(midFit.prepared, beforeFit);
assert(owned.every(c => c.width === 0 && c.height === 0), 'cancellation during fitting releases both temporary canvases');
let allocations = 0;
const failedAllocation = createOcrPhysicalTypography((...args) => {
  if (++allocations === 2) throw Error('allocation failed');
  return trackedCanvas(...args);
});
const allocationSample = sample(), allocationBefore = structuredClone(allocationSample.prepared);
assert.throws(() => failedAllocation(allocationSample.prepared, allocationSample.data), /allocation failed/);
assert.deepEqual(allocationSample.prepared, allocationBefore);
assert(owned.every(c => c.width === 0 && c.height === 0), 'a failed measurement allocation also releases the first canvas');

const doc = inferDocument([original.prepared.scene], { preserveGeometry: true }), snapshot = structuredClone(doc);
const output = await createWordBytes(doc, [], { preserveGeometry: true, measurementContext: createCanvas(1, 1).getContext('2d') });
const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
assert(xml.includes('利')); assert(!xml.includes('ocrPhysicalFit')); assert(!xml.includes('<w:vanish'));
assert.deepEqual(doc, snapshot, 'writer export preserves the fitted scene and provenance');
console.log('Physical OCR typography: independent scan pixels, preserved true bold/native/neighbor/rule evidence, bounded cancellation, canvas disposal, idempotence and actual DOCX export passed.');
