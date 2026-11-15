import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { fitLiteralLabelPlacement } from '../src/features/pdf-to-word/adapters/ocr-literal-placement.js';
import { ocrFrameLayout } from '../src/features/pdf-to-word/core/ocr-frame-layout.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import JSZip from 'jszip';

let passed = 0;
const test = (name, run) => { run(); passed++; };
function fixture(text = '-24-') {
  const width = 600, height = 1000, scale = 3;
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  ctx.font = '36px "Arial"'; ctx.fontKerning = 'none'; ctx.fillStyle = '#000';
  for (const [i, c] of [...text].entries()) ctx.fillText(c, 60 + i * 35, 940);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  let left = width, top = height, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4] < 180) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  }
  canvas.width = canvas.height = 0;
  const rect = { x: left / scale, y: top / scale, width: (right - left) / scale, height: (bottom - top) / scale };
  const item = { id: 'label', type: 'text', sourceIds: ['label'], text, rect, baseline: 940 / scale,
    baselineX: rect.x, advanceWidth: rect.width, size: 12, font: 'Arial', fontFamily: 'Arial', color: '000000',
    ocr: true, preciseInk: true, confidence: .97, ocrRecognitionConfidence: .999, bold: false, italic: false };
  return { scene: { number: 1, width: width / scale, height: height / scale, characters: text.length,
    items: [item], sources: [{ id: 'label', text, rect: { ...rect }, disposition: 'editable' }], risks: [], rules: [] },
    data: { pixels, width, height }, createCanvas, allowance: { remaining: 4_000_000 } };
}

for (const text of ['-2-', '-6-', '-24-', '-10-']) test('independent source positions ' + text, () => {
  const f = fixture(text), original = structuredClone(f.scene), pixels = f.data.pixels.slice();
  fitLiteralLabelPlacement(f);
  const item = f.scene.items[0];
  assert(item.ocrLiteralPlacement, 'complete independently drawn label must recover its physical positions');
  assert.equal(item.words.map(w => w.text).join(''), text);
  for (const w of item.words) for (const key of ['font', 'fontFamily', 'size', 'bold', 'italic', 'confidence'])
    assert.equal(w[key], original.items[0][key]);
  assert.deepEqual(f.scene.sources, original.sources); assert.deepEqual(f.data.pixels, pixels);
  assert(f.allowance.remaining >= 0 && f.allowance.remaining < 4_000_000);
  const once = structuredClone(f.scene), remaining = f.allowance.remaining;
  fitLiteralLabelPlacement(f); assert.deepEqual(f.scene, once); assert.equal(f.allowance.remaining, remaining);
});

for (const name of ['native', 'prepositioned', 'low detection', 'low recognition', 'source mismatch', 'source image',
  'unknown font', 'italic', 'body location', 'different spelling', 'colour', 'alpha', 'extra speck', 'crossing rule',
  'overlapping text', 'empty pixels', 'exhausted pixels', 'exhausted changes', 'invalid changes', 'allocation failure']) test(name, () => {
  const f = fixture(), item = f.scene.items[0];
  if (name === 'native') item.ocrNative = true;
  if (name === 'prepositioned') item.words = [{ text: 'known' }];
  if (name === 'low detection') item.confidence = .69;
  if (name === 'low recognition') item.ocrRecognitionConfidence = .97;
  if (name === 'source mismatch') f.scene.sources[0].text = '-25-';
  if (name === 'source image') f.scene.sources[0].disposition = 'visible-image';
  if (name === 'unknown font') item.fontFamily = 'UnknownFace';
  if (name === 'italic') item.italic = true;
  if (name === 'body location') item.rect.y = 50;
  if (name === 'different spelling') item.text = 'A24B';
  if (name === 'colour' || name === 'alpha') for (let i = 0; i < f.data.pixels.length; i += 4) if (f.data.pixels[i] < 180) {
    if (name === 'colour') f.data.pixels[i + 2] = 150;
    else f.data.pixels[i + 3] = 100;
  }
  if (name === 'extra speck') {
    const x = Math.round(item.rect.x * 3 + 20), y = Math.round(item.rect.y * 3 + 2);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) f.data.pixels.set([0, 0, 0, 255], ((y + dy) * 600 + x + dx) * 4);
  }
  if (name === 'crossing rule') f.scene.rules.push({ axis: 'h', at: item.rect.y + 1, from: 0, to: 200 });
  if (name === 'overlapping text') f.scene.items.push({ ...structuredClone(item), id: 'peer' });
  if (name === 'empty pixels') f.data.pixels.fill(255);
  if (name === 'exhausted pixels') f.allowance.remaining = 1;
  if (name === 'exhausted changes') f.accepted = new Set(Array.from({ length: 128 }, (_, i) => i));
  if (name === 'invalid changes') f.maxChanges = Infinity;
  if (name === 'allocation failure') f.createCanvas = () => { throw new Error('allocation'); };
  const original = structuredClone(f.scene);
  fitLiteralLabelPlacement(f); assert.deepEqual(f.scene, original, name + ' preserves the complete source scene');
});
test('cancellation propagates without partial publication', () => {
  const f = fixture(), original = structuredClone(f.scene);
  f.check = () => { throw Object.assign(new Error('cancelled'), { code: 'cancelled' }); };
  assert.throws(() => fitLiteralLabelPlacement(f), { code: 'cancelled' }); assert.deepEqual(f.scene, original);
});

function densePage() {
  const blocks = Array.from({ length: 3 }, (_, row) => ({ type: 'paragraph', lines: [{ id: 'body' + row,
    rect: { x: 10, y: 20 + row * 20, width: 450, height: 12 }, baseline: 30 + row * 20,
    items: [{ text: 'A'.repeat(220), ocr: true, preciseInk: true, size: 12, font: 'Arial',
      rect: { x: 10, y: 20 + row * 20, width: 450, height: 12 }, baseline: 30 + row * 20,
      words: Array.from({ length: 220 }, (_, n) => ({ text: 'A', ocr: true, preciseInk: true, size: 12,
        font: 'Arial', baseline: 30 + row * 20, rect: { x: 10 + n * 2, y: 20 + row * 20, width: 2, height: 12 } })) }] }] }));
  const item = fixture('-2-').scene.items[0];
  return { header: [], blocks, footer: [{ type: 'paragraph', lines: [{ id: 'footer', items: [item], rect: item.rect, baseline: item.baseline }] }] };
}
test('footer precision retains every dense-body frame exactly', () => {
  const page = densePage(), baseline = ocrFrameLayout(page), f = fixture('-2-');
  fitLiteralLabelPlacement(f); page.footer[0].lines[0].items = f.scene.items;
  const current = ocrFrameLayout(page);
  for (const [id, frames] of baseline) assert.deepEqual(current.get(id), frames);
  assert.equal(current.get('footer').length, 3);
  assert([...current.values()].reduce((n, frames) => n + frames.length, 0) <= 512);
});
test('reserve overflow rejects instead of redistributing body positions', () => {
  const page = densePage(), f = fixture('-24-'); fitLiteralLabelPlacement(f);
  page.footer = Array.from({ length: 5 }, (_, n) => ({ type: 'paragraph', lines: [{ id: 'footer' + n,
    items: structuredClone(f.scene.items), rect: f.scene.items[0].rect, baseline: f.scene.items[0].baseline }] }));
  assert.throws(() => ocrFrameLayout(page), { code: 'layout-quality' });
});

const f = fixture('-24-'); fitLiteralLabelPlacement(f);
const document = inferDocument([f.scene], { preserveGeometry: true });
const canvas = createCanvas(1, 1), bytes = await createWordBytes(document, [], { preserveGeometry: true, measurementContext: canvas.getContext('2d') });
const zip = await JSZip.loadAsync(bytes.bytes), xml = await zip.file('word/document.xml').async('string');
assert.equal([...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]).join(''), '-24-');
assert(!xml.includes('ocrLiteralPlacement')); canvas.width = canvas.height = 0;
console.log(`OCR literal placement: ${passed} behavioral cases and actual DOCX passed.`);
