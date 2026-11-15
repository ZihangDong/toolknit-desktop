import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { createOcrTypography } from '../src/features/pdf-to-word/adapters/ocr-typography.js';
import { prepareOcrScene } from '../src/features/pdf-to-word/core/ocr-scene.js';

const canvas = createCanvas(1500, 900), context = canvas.getContext('2d');
context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
const lines = [];
function line(text, baseline) {
  context.font = '60px "Microsoft YaHei"'; context.fontKerning = 'none';
  context.fillStyle = '#2E74B5'; let x = 45; const words = [];
  for (const char of text) {
    const m = context.measureText(char); context.fillText(char, x, baseline);
    words.push({ text: char, x: x - m.actualBoundingBoxLeft, y: baseline - m.actualBoundingBoxAscent,
      width: m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
      height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent, confidence: .96 });
    x += m.width;
  }
  const left = Math.min(...words.map(w => w.x)), top = Math.min(...words.map(w => w.y));
  const right = Math.max(...words.map(w => w.x + w.width)), bottom = Math.max(...words.map(w => w.y + w.height));
  lines.push({ text, words, x: left, y: top, width: right - left, height: bottom - top, confidence: .8 });
}
line('本地彩色文字校准', 110);
line('县', 200);
context.strokeStyle = 'red'; context.lineWidth = 5; context.beginPath(); context.arc(1100, 290, 60, 0, Math.PI * 2); context.stroke();
const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
const before = structuredClone(lines), scene = { number: 1, width: 500, height: 300,
  sources: [], items: [], rules: [], risks: ['image-page'], characters: 0 };
const result = prepareOcrScene({ scene, result: { width: canvas.width, height: canvas.height, lines },
  pixels, width: canvas.width, height: canvas.height, preserveGeometry: true,
  measurementContext: context, fitTypography: createOcrTypography(createCanvas) });
assert.deepEqual(lines, before, 'recognizer evidence remains intact');
assert(result.changed);
const text = result.scene.items.filter(item => item.type === 'text');
assert.equal(text.length, 2, 'both ordinary prose and peer-calibrated short label are recovered');
for (const item of text) {
  assert.equal(item.color, '2E74B5', 'use the actual solid source color, not its pale fringe');
  assert(item.ocrFontScore >= .7 && item.words.length);
}
for (const line of lines) {
  let ink = 0;
  for (let y = Math.floor(line.y); y < Math.ceil(line.y + line.height); y++)
    for (let x = Math.floor(line.x); x < Math.ceil(line.x + line.width); x++)
      if (Math.min(...result.pixels.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 3)) < 180) ink++;
  assert.equal(ink, 0, 'all proven blue source ink is removed before editable text is painted');
}
for (let y = 220; y < 360; y++) for (let x = 1030; x < 1170; x++) {
  const at = (y * canvas.width + x) * 4;
  assert.deepEqual(result.pixels.slice(at, at + 4), pixels.slice(at, at + 4), 'stamp pixels outside text stay unchanged');
}
// Retain an uncertain colored OCR candidate in the source image ledger when
// other text is recovered. Otherwise the converter could report 100% editing
// while silently dropping this candidate from its accounting.
context.fillStyle = '#2E74B5'; context.fillRect(60, 380, 40, 40); context.fillRect(120, 380, 40, 40);
const mixedPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
const uncertain = { text: '测试', x: 50, y: 370, width: 120, height: 60, confidence: .8,
  words: [{ text: '测', x: 60, y: 380, width: 40, height: 40, confidence: .9 },
    { text: '试', x: 120, y: 380, width: 40, height: 40, confidence: .9 }] };
const mixed = prepareOcrScene({ scene, result: { width: canvas.width, height: canvas.height, lines: [...lines, uncertain] },
  pixels: mixedPixels, width: canvas.width, height: canvas.height, preserveGeometry: true,
  measurementContext: context, fitTypography: createOcrTypography(createCanvas) });
const retained = mixed.scene.sources.find(source => source.ocrUnverified);
assert(retained, 'uncertain image text remains an explicit source rather than disappearing from the denominator');
assert.equal(retained.text, uncertain.text); assert.equal(retained.disposition, 'visible-image');
assert(mixed.scene.items.find(item => item.ocrBackground).sourceIds.includes(retained.id));
assert(!mixed.scene.items.some(item => item.type === 'text' && item.sourceIds.includes(retained.id)));
assert.equal(mixed.scene.characters, lines.reduce((sum, line) => sum + line.text.length, 0) + uncertain.text.length);
assert(mixed.scene.risks.includes('ocr-low-confidence'));
for (let y = 375; y < 425; y++) for (let x = 55; x < 165; x++) {
  const at = (y * canvas.width + x) * 4;
  assert.deepEqual(mixed.pixels.slice(at, at + 4), mixedPixels.slice(at, at + 4), 'uncertain pixels remain unchanged');
}
// A colored rectangle does not become editable text merely because an OCR
// detector emitted boxes for it. No glyph proof means no erasure or overpaint.
context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
context.fillStyle = '#2E74B5'; context.fillRect(60, 55, 40, 40); context.fillRect(120, 55, 40, 40);
const graphic = context.getImageData(0, 0, canvas.width, canvas.height).data;
const rejected = prepareOcrScene({ scene, result: { width: canvas.width, height: canvas.height,
  lines: [{ text: '测试', x: 50, y: 45, width: 120, height: 60, confidence: .8,
    words: [{ text: '测', x: 60, y: 55, width: 40, height: 40, confidence: .9 },
      { text: '试', x: 120, y: 55, width: 40, height: 40, confidence: .9 }] }] },
pixels: graphic, width: canvas.width, height: canvas.height, preserveGeometry: true,
measurementContext: context, fitTypography: createOcrTypography(createCanvas) });
assert.equal(rejected.changed, true, 'an all-uncertain page still carries explicit image source accounting');
assert.deepEqual(rejected.pixels, graphic);
assert.equal(rejected.scene.sources.length, 1);
assert.equal(rejected.scene.sources[0].disposition, 'visible-image');
assert.equal(rejected.scene.sources[0].ocrUnverified, true);
assert.equal(rejected.scene.items.filter(item => item.type === 'text').length, 0);
assert(rejected.scene.risks.includes('ocr-low-confidence'));
assert.deepEqual(scene.items, [], 'input scene is not mutated by rejected recovery');
// A weak isolated CTC token over neutral or pale coloured texture must stay in
// the image. Previously the neutral fringe bypassed the colour-proof gate and
// a default-font digit was painted over a blurred window. Check exact source
// pixels, the rejected candidate ledger, and confident/physically proven peers.
for (const color of ['#727272', '#B9E0E2']) {
  context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color; context.fillRect(60, 55, 40, 40);
  context.fillStyle = '#333333'; context.font = '60px "Arial"'; context.fillText('Known text', 250, 95);
  const original = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const known = { text: 'Known text', x: 245, y: 40, width: 350, height: 65, confidence: .99 };
  for (const [text, confidence, recognition, proven, rejectedToken] of [
    ['1', .61, .61, false, true], ['甲乙', .69, .69, false, true],
    ['1', .61, .61, true, false], ['1', .61, .99, false, false], ['1', .99, .99, false, false],
  ]) {
    const token = { text, x: 50, y: 45, width: 60, height: 60, confidence,
      words: [...text].map((char, index) => ({ text: char, x: 60 + index * 20, y: 55, width: 20, height: 40, confidence: recognition })) };
    const prepared = prepareOcrScene({ scene, result: { width: canvas.width, height: canvas.height, lines: [known, token] },
      pixels: original, width: canvas.width, height: canvas.height, preserveGeometry: true, measurementContext: context,
      // A fit is accepted only when all required physical evidence is present.
      fitTypography: proven ? input => input.line === token ? { ocrFontScore: .9,
        words: token.words.map(w => ({ text: w.text, ocrGlyphScore: .9 })) } : null : undefined });
    assert(prepared.changed);
    assert.equal(prepared.scene.items.some(item => item.type === 'text' && item.sourceIds.includes('p1:ocr1')), !rejectedToken);
    if (rejectedToken) {
      const source = prepared.scene.sources.find(s => s.id === 'p1:ocr1');
      assert.equal(source.disposition, 'visible-image'); assert.equal(source.ocrUnverified, true);
      assert(prepared.scene.items.find(item => item.ocrBackground).sourceIds.includes(source.id));
      assert(prepared.scene.risks.includes('ocr-low-confidence'));
      for (let y = 45; y < 105; y++) for (let x = 50; x < 115; x++) {
        const offset = (y * canvas.width + x) * 4;
        assert.deepEqual(prepared.pixels.slice(offset, offset + 4), original.slice(offset, offset + 4));
      }
      const only = prepareOcrScene({ scene, result: { width: canvas.width, height: canvas.height, lines: [token] },
        pixels: original, width: canvas.width, height: canvas.height, preserveGeometry: true, measurementContext: context });
      assert(only.changed); assert.equal(only.scene.items.filter(item => item.type === 'text').length, 0);
      assert.equal(only.scene.sources.length, 1); assert.equal(only.scene.sources[0].ocrUnverified, true);
      assert.equal(only.scene.sources[0].text, token.text); assert.deepEqual(only.pixels, original);
    }
  }
}
canvas.width = canvas.height = 0;
console.log('OCR colored text: full-ink erasure, exact color, peer-calibrated label, stamp isolation, weak isolated-token image retention and unproven graphic rejection passed.');
