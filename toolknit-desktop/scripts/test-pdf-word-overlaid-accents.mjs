import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { compressedPunctuationChunks } from '../src/features/pdf-to-word/core/text-chunks.js';
import { positionedFrameCost } from '../src/features/pdf-to-word/core/positioned-budget.js';
import { drawResultText } from '../src/features/pdf-to-word/adapters/text-rendering.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const context = createCanvas(1, 1).getContext('2d'), size = 10, baseline = 50;
context.font = '1000px "Times New Roman"'; context.fontKerning = 'none';
function text(id, value, x) {
  const m = context.measureText(value), scale = size / 1000;
  return { id, type: 'text', text: value, sourceIds: [id], order: 1, font: 'ABCDEF+NimbusRomNo9L-Regu',
    fontFamily: 'serif', size, baseline, baselineX: x, advanceWidth: m.width * scale,
    rect: { x: x - m.actualBoundingBoxLeft * scale, y: baseline - m.actualBoundingBoxAscent * scale,
      width: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * scale,
      height: (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * scale },
    preciseInk: true, raster: false, bold: false, italic: false, color: '000000' };
}
const a = text('word', 'ackstr', 30), accentA = text('accent-a', '¨', 30.5);
const b = text('phrase', 'om, Example and', 80), accentB = text('accent-b', '¨', 80.5);
let cursor = b.baselineX;
b.words = ['om,', 'Example', 'and'].map((value, index) => {
  const word = text('leaf' + index, value, cursor); cursor += word.advanceWidth + context.measureText(' ').width * size / 1000;
  return { text: value, spaceBefore: index > 0, rect: word.rect, baselineX: word.baselineX, advanceWidth: word.advanceWidth };
});
const items = [a, accentA, b, accentB], original = structuredClone(items);
const scene = { number: 1, width: 200, height: 100, items, rules: [], risks: [], characters: items.reduce((n, item) => n + item.text.length, 0),
  sources: items.map(item => ({ id: item.id, text: item.text, rect: { ...item.rect }, disposition: 'editable', order: 1 })) };
const document = inferDocument([scene], { preserveGeometry: true });
const sourceLine = document.pages[0].blocks[0].lines[0];
assert(positionedFrameCost(document.pages[0].blocks) >= 4, 'source-overlaid diacritics cannot compress their containing words into a sequential run');
assert.deepEqual(items, original, 'render planning preserves raw spelling, source ownership and word positions');
assert(compressedPunctuationChunks(sourceLine).every(line => line.items.length === 1));

const reference = createCanvas(800, 400), actual = createCanvas(800, 400);
for (const canvas of [reference, actual]) {
  const c = canvas.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 800, 400); c.scale(4, 4);
}
const r = reference.getContext('2d'); r.font = '10px "Times New Roman"'; r.fontKerning = 'none'; r.fillStyle = '#000';
for (const item of items) if (item.words) item.words.forEach(word => r.fillText(word.text, word.baselineX, baseline));
else r.fillText(item.text, item.baselineX, baseline);
drawResultText(document.pages[0], actual.getContext('2d'));
const mask = canvas => {
  const pixels = canvas.getContext('2d').getImageData(0, 0, 800, 400).data;
  return Uint8Array.from({ length: pixels.length / 4 }, (_, i) => Math.min(...pixels.subarray(i * 4, i * 4 + 3)) < 180 ? 1 : 0);
};
const expected = mask(reference), found = mask(actual);
function covered(a, b) {
  let ink = 0, matching = 0;
  for (let y = 0; y < 400; y++) for (let x = 0; x < 800; x++) if (a[y * 800 + x]) {
    ink++; let near = false;
    for (let yy = Math.max(0, y - 2); yy <= Math.min(399, y + 2) && !near; yy++)
      for (let xx = Math.max(0, x - 2); xx <= Math.min(799, x + 2); xx++) if (b[yy * 800 + xx]) { near = true; break; }
    matching += near ? 1 : 0;
  }
  return matching / ink;
}
assert(covered(expected, found) >= .98 && covered(found, expected) >= .98, 'visible whole words and accents match independently placed source ink');
for (const change of [
  item => { item.text = '!'; }, item => { item.rect.x += 100; },
  item => { item.baseline += 3; }, item => { item.font = 'Unknown'; }, item => { item.ocr = true; },
]) {
  const line = structuredClone(sourceLine); line.items.filter(item => item.text === '¨').forEach(change);
  assert.equal(compressedPunctuationChunks(line).length, 1, 'ordinary punctuation, separate marks, unknown and OCR sources retain their existing grouping');
}
const output = await createWordBytes(document, [], { preserveGeometry: true, measurementContext: context });
const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
const wordRun = xml.match(/<w:r><w:rPr>([\s\S]*?)<\/w:rPr><w:t[^>]*>ackstr<\/w:t><\/w:r>/);
assert(wordRun && !/w:spacing w:val="-[1-9][0-9]+"/.test(wordRun[1]), 'actual Word word runs never acquire large negative tracking from an overlapping accent');
assert((xml.match(/<w:framePr /g) || []).length >= 4);
console.log('Native overlaid accents: full word/phrase ink, independent placement, shared frame budgeting, immutable sources, refusal cases and actual DOCX tracking passed.');
