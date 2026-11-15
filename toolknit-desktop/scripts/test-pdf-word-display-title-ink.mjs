// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fitOcrDisplayTitleInk } from '../src/features/pdf-to-word/adapters/ocr-display-title-ink.js';
import { createOcrPhysicalTypography } from '../src/features/pdf-to-word/adapters/ocr-physical-typography.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { drawResultText } from '../src/features/pdf-to-word/adapters/text-rendering.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const FONT_ASCENT = .859375, FONT_DESCENT = .140625;
const WIDTH = 1440, HEIGHT = 1600, SCALE = 4, BALANCE = 1_000_000;
const shapes = [[.05, -.8, .65, .9], [.75, -.75, .12, .16]];

// A deterministic font/context double, independent of installed fonts. Its
// rectangular outlines test real product layout, raster, ownership and budget
// decisions. These results are never counted as actual-font/reader evidence.
function rectangle(pixels, width, height, left, top, right, bottom, color) {
  for (let y = Math.max(0, Math.ceil(top - .5)); y < Math.min(height, Math.ceil(bottom - .5)); y++) {
    for (let x = Math.max(0, Math.ceil(left - .5)); x < Math.min(width, Math.ceil(right - .5)); x++) {
      const at = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) pixels[at + channel] = color[channel];
    }
  }
}
function deterministicCanvas(width, height, mode = 'matching') {
  let w = width, h = height, pixels = new Uint8ClampedArray(w * h * 4), matrix = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const context = {
    font: '10px "SimSun"', fontKerning: 'normal', fillStyle: '#000000', textBaseline: 'alphabetic', letterSpacing: '0px',
    setTransform(a, b, c, d, e, f) { matrix = [a, b, c, d, e, f]; },
    translate(x, y) { matrix[4] += matrix[0] * x + matrix[2] * y; matrix[5] += matrix[1] * x + matrix[3] * y; },
    scale(x, y) { matrix[0] *= x; matrix[1] *= x; matrix[2] *= y; matrix[3] *= y; },
    save() { stack.push([...matrix]); }, restore() { matrix = stack.pop(); },
    fillRect(x, y, width, height) {
      const [a, , , d, e, f] = matrix, white = ['#fff', '#ffffff', 'white'].includes(this.fillStyle);
      rectangle(pixels, w, h, a * x + e, d * y + f, a * (x + width) + e, d * (y + height) + f,
        white ? [255, 255, 255, 255] : [0, 0, 0, 255]);
    },
    measureText(text) {
      const em = Number(this.font.match(/([\d.]+)px/)?.[1] || 10);
      if (mode === 'throws') throw new Error('measurement unavailable');
      const absent = mode === 'missing-glyph';
      return { width: text.length * em, fontBoundingBoxAscent: (mode === 'wrong-metrics' ? .9 : FONT_ASCENT) * em,
        fontBoundingBoxDescent: FONT_DESCENT * em, actualBoundingBoxLeft: absent ? 0 : -.05 * em,
        actualBoundingBoxRight: absent ? 0 : .87 * em, actualBoundingBoxAscent: absent ? 0 : .8 * em,
        actualBoundingBoxDescent: absent ? 0 : .1 * em };
    },
    fillText(text, x, y) {
      const em = Number(this.font.match(/([\d.]+)px/)?.[1] || 10);
      for (let i = 0; i < text.length; i++) for (const [left, top, width, height] of shapes)
        this.fillRect(x + (i + left) * em, y + top * em, width * em, height * em);
    },
    getImageData() { return { data: pixels.slice() }; },
  };
  return {
    get width() { return w; }, set width(value) { w = value; pixels = new Uint8ClampedArray(w * h * 4); },
    get height() { return h; }, set height(value) { h = value; pixels = new Uint8ClampedArray(w * h * 4); },
    getContext() { return context; },
  };
}

function fixture(realFactory = null) {
  const letters = ['田', '由', '甲', '中', '田'];
  let pixels;
  if (realFactory) {
    const canvas = realFactory(WIDTH, HEIGHT), context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, WIDTH, HEIGHT); context.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    context.font = '43px "SimSun"'; context.fontKerning = 'none'; context.fillStyle = '#000';
    letters.forEach((text, index) => context.fillText(text, 40 + index * 60, 80));
    pixels = context.getImageData(0, 0, WIDTH, HEIGHT).data; canvas.width = canvas.height = 0;
  } else {
    // Independent source bitmap: fixed source em/origins are specified before
    // constructing any OCR frame or calling the candidate/context painter.
    pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4); pixels.fill(255);
    letters.forEach((text, index) => {
      for (const [x, y, width, height] of shapes) rectangle(pixels, WIDTH, HEIGHT,
        (40 + index * 60 + x * 43) * SCALE, (80 + y * 43) * SCALE,
        (40 + index * 60 + (x + width) * 43) * SCALE, (80 + (y + height) * 43) * SCALE, [0, 0, 0, 255]);
    });
  }
  const words = letters.map((text, index) => {
    let x = WIDTH, y = HEIGHT, right = 0, bottom = 0;
    for (let yy = 120; yy < 340; yy++) for (let xx = (38 + index * 60) * SCALE; xx < (88 + index * 60) * SCALE; xx++) {
      if (pixels[(yy * WIDTH + xx) * 4] >= 180) continue;
      x = Math.min(x, xx); y = Math.min(y, yy); right = Math.max(right, xx + 1); bottom = Math.max(bottom, yy + 1);
    }
    const rect = { x: x / SCALE + (index === 4 ? .72 : 0), y: y / SCALE, width: (right - x) / SCALE, height: (bottom - y) / SCALE };
    return { text, rect, size: index === 4 ? 43 : 42, font: 'SimSun', fontFamily: 'SimSun', bold: false, italic: false,
      baseline: 80, baselineX: 40 + index * 60, advanceWidth: rect.width, glyphScale: index === 4 ? 98 : 100,
      preciseInk: true, confidence: .9999, ocrGlyphScore: .95 };
  });
  const owner = { id: 'display', type: 'text', text: letters.join(''), sourceIds: ['display'],
    rect: { x: 35, y: 30, width: 295, height: 60 }, baseline: 80, size: 42, font: 'SimSun', fontFamily: 'SimSun',
    bold: false, italic: false, color: '000000', preciseInk: true, ocr: true, raster: false, ocrFontScore: .95, words };
  return { scene: { number: 1, width: WIDTH / SCALE, height: HEIGHT / SCALE, items: [owner],
    sources: [{ id: owner.id, text: owner.text, rect: { ...owner.rect }, disposition: 'editable' }], rules: [], risks: [], characters: letters.length },
    data: { pixels, width: WIDTH, height: HEIGHT }, owner };
}

function fit(sample, { amount = BALANCE, accepted = new Set(), maxChanges = 128, mode = 'matching', cancelAt = Infinity, factory = null } = {}) {
  const allowance = { remaining: amount }, resources = []; let calls = 0;
  const create = (width, height) => {
    const canvas = factory ? factory(width, height) : deterministicCanvas(width, height, mode);
    const state = { widthReset: false, heightReset: false }; resources.push(state);
    return new Proxy(canvas, {
      get(target, key) { const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; },
      set(target, key, value) {
        if (['width', 'height'].includes(key) && value === 0) state[key + 'Reset'] = true;
        return Reflect.set(target, key, factory && value === 0 ? 1 : value, target);
      },
    });
  };
  try {
    fitOcrDisplayTitleInk({ ...sample, createCanvas: create, allowance, accepted, maxChanges,
      check() { if (++calls === cancelAt) throw new Error('cancelled'); } });
  } finally {
    assert(resources.every(resource => resource.widthReset && resource.heightReset), 'canvas reset on success, rejection and exceptions');
    assert(allowance.remaining >= 0 && allowance.remaining <= amount, 'shared remainder never replenished or overspent');
  }
  return { allowance, accepted, calls };
}
const semantic = word => Object.fromEntries(Object.entries(word).filter(([key]) => !['rect', 'glyphScale', 'ocrDisplayTitleFit'].includes(key)));
function render(sample) {
  const canvas = deterministicCanvas(WIDTH, HEIGHT), context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, WIDTH, HEIGHT); context.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  drawResultText(inferDocument([sample.scene], { preserveGeometry: true }).pages[0], context);
  return context.getImageData().data;
}

let checks = 0;
const positive = fixture(), original = structuredClone(positive.scene), pixelHash = hash(positive.data.pixels), beforePaint = render(positive);
const success = fit(positive), proof = positive.owner.words[4].ocrDisplayTitleFit;
assert(proof && proof.after >= .9 && proof.after > proof.before && proof.edgeAfter <= .5 && proof.componentEdge <= .75);
assert.deepEqual(positive.owner.words.slice(0, 4), original.items[0].words.slice(0, 4));
assert.deepEqual(semantic(positive.owner.words[4]), semantic(original.items[0].words[4]));
assert.deepEqual(positive.scene.sources, original.sources); assert.deepEqual(positive.scene.rules, original.rules);
assert.equal(hash(positive.data.pixels), pixelHash);
const afterPaint = render(positive), bounds = original.items[0].words[4].rect;
for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
  if (x >= (bounds.x - 3) * SCALE && x < (bounds.x + bounds.width + 3) * SCALE && y >= (bounds.y - 3) * SCALE && y < (bounds.y + bounds.height + 3) * SCALE) continue;
  const at = (y * WIDTH + x) * 4;
  for (let channel = 0; channel < 4; channel++) assert.equal(afterPaint[at + channel], beforePaint[at + channel], 'all neighbor pixels exact');
}
checks++;
for (const [name, change] of [
  ['body', s => s.owner.words.forEach(w => w.size = 16)], ['oversize', s => s.owner.words[4].size = 73],
  ['missing size', s => delete s.owner.words[4].size], ['native', s => s.owner.ocr = false],
  ['native OCR', s => s.owner.ocrNative = true], ['raster', s => s.owner.raster = true], ['math', s => s.owner.role = 'math'],
  ['foreign font', s => s.owner.words[4].font = 'ForeignFONT'], ['unknown font', s => s.owner.font = 'UnknownFONT'],
  ['generated font', s => s.owner.words[4].fontAssetId = 'font:held'], ['low face score', s => s.owner.ocrFontScore = .8999],
  ['missing face score', s => delete s.owner.ocrFontScore], ['low confidence', s => s.owner.words[4].confidence = .989],
  ['missing confidence', s => delete s.owner.words[4].confidence], ['low signature', s => s.owner.words[4].ocrGlyphScore = .919],
  ['italic', s => s.owner.words[4].italic = true], ['bold', s => s.owner.words[4].bold = true], ['numeric', s => s.owner.words[4].text = '4'],
  ['punctuation', s => s.owner.words[4].text = ','], ['prior fit', s => s.owner.words[4].ocrPhysicalFit = { phase: 'held' }],
  ['rule owner', s => s.owner.words[4].ocrRuling = true], ['body position', s => s.owner.rect.y = 200], ['off center', s => s.owner.rect.x = 180],
  ['source text', s => s.scene.sources[0].text = 'different'], ['image source', s => s.scene.sources[0].disposition = 'visible-image'],
  ['ordinary table', s => s.scene.items = [{ type: 'table', cells: [{ blocks: [s.owner] }] }]],
  ['option grid', s => s.scene.items = [{ type: 'option-grid', cells: [{ blocks: [s.owner] }] }]],
  ['neighbor overlap', s => s.scene.items.push({ id: 'held', words: [{ ...s.owner.words[4], rect: { ...s.owner.words[4].rect } }] })],
  ['rule contact', s => s.scene.rules.push({ axis: 'h', at: s.owner.words[4].rect.y + 2, from: 200, to: 350 })],
  ['color', s => { for (let at = 0; at < s.data.pixels.length; at += 4) if (s.data.pixels[at] < 180) { s.data.pixels[at + 1] = 120; break; } }],
  ['alpha', s => { for (let at = 0; at < s.data.pixels.length; at += 4) if (s.data.pixels[at] < 180) { s.data.pixels[at + 3] = 200; break; } }],
  ['incomplete source', s => s.owner.words[4].rect.height /= 2],
]) {
  const sample = fixture(); change(sample); const before = structuredClone(sample.scene), pixels = hash(sample.data.pixels);
  fit(sample); assert.deepEqual(sample.scene, before, name); assert.equal(hash(sample.data.pixels), pixels); checks++;
}
const cost = BALANCE - success.allowance.remaining;
for (const amount of [0, 1, cost - 1, cost]) {
  const sample = fixture(), before = structuredClone(sample.scene), result = fit(sample, { amount });
  if (amount < cost) assert.deepEqual(sample.scene, before); else { assert(sample.owner.words[4].ocrDisplayTitleFit); assert.equal(result.allowance.remaining, 0); }
  checks++;
}
for (const cancelAt of [1, 100, success.calls]) {
  const sample = fixture(), before = structuredClone(sample.scene), accepted = new Set();
  assert.throws(() => fit(sample, { accepted, cancelAt }), /cancelled/);
  assert.deepEqual(sample.scene, before); assert.equal(accepted.size, 0); checks++;
}
for (const mode of ['wrong-metrics', 'missing-glyph']) {
  const sample = fixture(), before = structuredClone(sample.scene); fit(sample, { mode }); assert.deepEqual(sample.scene, before); checks++;
}
{
  const sample = fixture(), before = structuredClone(sample.scene);
  assert.throws(() => fit(sample, { mode: 'throws' }), /measurement unavailable/); assert.deepEqual(sample.scene, before); checks++;
}
{
  const sample = fixture(), before = structuredClone(sample.scene); fit(sample, { maxChanges: 0 }); assert.deepEqual(sample.scene, before); checks++;
}
{
  const sample = fixture(), before = structuredClone(sample.scene); fit(sample, { accepted: new Set([sample.owner.words[4]]) }); assert.deepEqual(sample.scene, before); checks++;
}
{
  // The same remainder and accepted set come from the preceding table/scan
  // phases. Their existing accepted word must retain priority over title.
  const sample = fixture(), prior = sample.owner.words[0], accepted = new Set([prior]), amount = cost + 137;
  const result = fit(sample, { accepted, amount, maxChanges: 2 });
  assert.equal(result.accepted, accepted); assert.equal(accepted.size, 2); assert(accepted.has(prior));
  assert.equal(result.allowance.remaining, 137); checks++;
}
{
  const sample = fixture(), before = structuredClone(sample.scene), accepted = new Set([{}]);
  fit(sample, { accepted, maxChanges: 1 }); assert.deepEqual(sample.scene, before); assert.equal(accepted.size, 1); checks++;
}
{
  const sample = fixture(), pixels = hash(sample.data.pixels);
  createOcrPhysicalTypography((w, h) => deterministicCanvas(w, h))({ changed: true, scene: sample.scene }, sample.data, { pixelBudget: BALANCE });
  assert(sample.owner.words[4].ocrDisplayTitleFit, 'physical final hook reaches title after existing phases');
  assert.equal(hash(sample.data.pixels), pixels); checks++;
}

// Actual-font coverage is optional and separately counted. Missing native
// Canvas, an unavailable family or an empty glyph is never an actual-font pass.
let realCoverage = { status: 'not_executed', reason: 'canvas_runtime_unavailable' }, verifiedCanvasChecks = 0;
let runtime;
try { runtime = await import('@napi-rs/canvas'); }
catch (error) { if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED'].includes(error.code)) throw error; }
if (runtime) {
  const canvas = runtime.createCanvas(1, 1), context = canvas.getContext('2d');
  let reason = null;
  try {
    context.font = '1000px "SimSun"'; context.fontKerning = 'none';
    for (const text of ['田', '由', '甲', '中']) {
      const m = context.measureText(text);
      if (![m.width, m.fontBoundingBoxAscent, m.fontBoundingBoxDescent].every(Number.isFinite)
        || Math.abs(m.width - 1000) > 1 || Math.abs(m.fontBoundingBoxAscent / 1000 - FONT_ASCENT) > .001
        || Math.abs(m.fontBoundingBoxDescent / 1000 - FONT_DESCENT) > .001) { reason = 'font_metrics_mismatch'; break; }
      if (![m.actualBoundingBoxLeft, m.actualBoundingBoxRight, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent].every(Number.isFinite)
        || m.actualBoundingBoxLeft + m.actualBoundingBoxRight <= 0 || m.actualBoundingBoxAscent + m.actualBoundingBoxDescent <= 0) { reason = 'glyph_ink_unavailable'; break; }
    }
    if (reason) {
      const sample = fixture(), before = structuredClone(sample.scene);
      fit(sample, { factory: runtime.createCanvas }); assert.deepEqual(sample.scene, before, 'unverified actual context keeps fallback');
      realCoverage = { status: 'not_executed', reason, runtimeFallbackAsserted: true };
    } else {
      const sample = fixture(runtime.createCanvas), before = structuredClone(sample.scene), pixels = hash(sample.data.pixels);
      fit(sample, { factory: runtime.createCanvas }); assert(sample.owner.words[4].ocrDisplayTitleFit);
      assert.deepEqual(sample.owner.words.slice(0, 4), before.items[0].words.slice(0, 4)); assert.equal(hash(sample.data.pixels), pixels);
      verifiedCanvasChecks = 1; realCoverage = { status: 'executed', verifiedFontMetrics: true, verifiedGlyphInk: true };
    }
  } finally { canvas.width = canvas.height = 1; }
}
console.log(JSON.stringify({ deterministicChecks: checks, verifiedCanvasChecks, realFontCoverage: realCoverage,
  readerEvidence: 'Separately retained platform evidence; this test does not start a reader.' }));
