import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { fitSourceOwnedTableGlyphs } from '../src/features/pdf-to-word/adapters/source-owned-table-fit.js';
import { createOcrPhysicalTypography } from '../src/features/pdf-to-word/adapters/ocr-physical-typography.js';
import { positionedTextRuns } from '../src/features/pdf-to-word/adapters/text-layout.js';
import { drawResultText } from '../src/features/pdf-to-word/adapters/text-rendering.js';

const scale = 4;
function fixture(text = '田', bold = false) {
  // Source pixels are painted independently, before any proposed word geometry
  // or run plan exists. No source mask is made from the fitter's output.
  const canvas = createCanvas(960, 480), c = canvas.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = '#000'; c.font = `${bold ? 'bold ' : ''}56px "SimSun"`; c.fontKerning = 'none';
  c.fillText(text, 120, 240); c.fillText('林', 344, 240);
  const pixels = c.getImageData(0, 0, canvas.width, canvas.height).data;
  const inkRect = (left, end) => {
    let x = end, y = 480, right = left, bottom = 0;
    for (let yy = 0; yy < 480; yy++) for (let xx = left; xx < end; xx++) {
      const at = (yy * 960 + xx) * 4;
      if (Math.min(pixels[at], pixels[at + 1], pixels[at + 2]) >= 180) continue;
      x = Math.min(x, xx); y = Math.min(y, yy); right = Math.max(right, xx + 1); bottom = Math.max(bottom, yy + 1);
    }
    return { x: x / scale, y: y / scale, width: (right - x) / scale, height: (bottom - y) / scale };
  };
  const source = inkRect(0, 280), nextSource = inkRect(280, 600);
  const proposed = { x: source.x - 1, y: source.y - 1, width: source.width + 2.5, height: source.height + 2.5 };
  const word = { text, rect: proposed, size: 22, baseline: 60, baselineX: proposed.x, advanceWidth: proposed.width,
    font: 'SimSun', fontFamily: 'SimSun', bold, italic: false, color: '000000', glyphScale: 100,
    confidence: .9999, ocrGlyphScore: .8, preciseInk: true, language: 'zh-CN' };
  const neighbour = { ...word, text: '林', rect: nextSource, size: 14, baselineX: nextSource.x,
    advanceWidth: nextSource.width, ocrGlyphScore: .98 };
  const rect = { x: proposed.x, y: Math.min(proposed.y, nextSource.y), width: nextSource.x + nextSource.width - proposed.x,
    height: Math.max(proposed.y + proposed.height, nextSource.y + nextSource.height) - Math.min(proposed.y, nextSource.y) };
  const item = { id: 'sample-source', type: 'text', sourceIds: ['sample-source'], text: text + '林', rect,
    baseline: 60, baselineX: rect.x, size: 14, font: 'SimSun', fontFamily: 'SimSun', bold, italic: false,
    color: '000000', ocr: true, raster: false, preciseInk: true, ocrFontScore: .9, words: [word, neighbour] };
  const line = { id: 'sample-line', type: 'line', text: item.text, rect, baseline: 60, items: [item] };
  const cell = { row: 0, col: 0, rowSpan: 1, colSpan: 1, rect: { x: 20, y: 30, width: 110, height: 60 },
    blocks: [{ id: 'sample-paragraph', type: 'paragraph', rect, sourceIds: [item.id], lines: [line] }] };
  const table = { id: 'sample-table', type: 'table', rect: { ...cell.rect }, cells: [cell], borderless: true };
  const scene = { number: 1, width: 240, height: 120, items: [table],
    sources: [{ id: item.id, text: item.text, rect: { ...rect }, disposition: 'editable' }], rules: [], risks: ['ocr'], characters: item.text.length };
  canvas.width = canvas.height = 0;
  return { scene, data: { pixels, width: 960, height: 480 }, item, word, neighbour, line, table, cell, source };
}

const owned = [];
function trackedCanvas(w, h) {
  const canvas = createCanvas(w, h), state = {};
  for (const axis of ['width', 'height']) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(canvas), axis);
    Object.defineProperty(canvas, axis, { get: () => descriptor.get.call(canvas),
      set(value) { state[axis] = value; descriptor.set.call(canvas, value); } });
  }
  owned.push(state); return canvas;
}

function fit(sample, options = {}) {
  const allowance = options.allowance || { remaining: 4_000_000 };
  fitSourceOwnedTableGlyphs({ scene: sample.scene, data: sample.data, createCanvas: options.createCanvas || trackedCanvas,
    accepted: options.accepted || new Set(), allowance, maxChanges: options.maxChanges ?? 128, check: options.check || (() => {}) });
  assert(allowance.remaining >= 0 && allowance.remaining <= 4_000_000);
  return allowance;
}

function painted(sample) {
  const canvas = createCanvas(960, 480), context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, 960, 480); context.setTransform(scale, 0, 0, scale, 0, 0);
  drawResultText({ header: [], footer: [], blocks: [sample.table] }, context);
  const result = context.getImageData(0, 0, 960, 480).data; canvas.width = canvas.height = 0; return result;
}

function sourceF1(sample, output) {
  const r = sample.source, left = Math.floor((r.x - 3) * scale), top = Math.floor((r.y - 3) * scale);
  const end = Math.ceil((r.x + r.width + 3) * scale), bottom = Math.ceil((r.y + r.height + 3) * scale);
  let source = 0, painted = 0, common = 0;
  for (let y = top; y < bottom; y++) for (let x = left; x < end; x++) {
    const at = (y * 960 + x) * 4;
    const a = Math.min(...sample.data.pixels.subarray(at, at + 3)) < 180;
    const b = Math.min(...output.subarray(at, at + 3)) < 180;
    source += a; painted += b; common += a && b;
  }
  return 2 * common / Math.max(1, source + painted);
}

const semantic = word => Object.fromEntries(Object.entries(word).filter(([key]) => !['rect', 'size', 'glyphScale', 'ocrPhysicalFit'].includes(key)));
let verified = 0;
for (const [text, bold] of [['田', false], ['利', false], ['田', true]]) {
  const sample = fixture(text, bold), before = structuredClone(sample.scene), pixels = sample.data.pixels.slice();
  const beforePaint = painted(sample), beforeF1 = sourceF1(sample, beforePaint), oldStyle = semantic(sample.word);
  const neighbour = structuredClone(sample.neighbour), planBefore = positionedTextRuns(sample.line, createCanvas(1, 1).getContext('2d'));
  const allowance = fit(sample);
  assert(sample.word.ocrPhysicalFit, 'independently painted connected/multipart/true-bold table source is fitted');
  assert.equal(sample.word.ocrPhysicalFit.phase, 'source-owned-table'); assert.equal(sample.word.bold, bold);
  assert(sourceF1(sample, painted(sample)) >= Math.max(.75, beforeF1 + .05), 'independent source pixels improve under the real table-line renderer');
  assert.deepEqual(semantic(sample.word), oldStyle); assert.deepEqual(sample.neighbour, neighbour);
  assert.deepEqual(sample.scene.sources, before.sources); assert.deepEqual(sample.scene.rules, before.rules);
  assert.deepEqual(sample.cell.rect, before.items[0].cells[0].rect); assert.deepEqual(sample.table.rect, before.items[0].rect);
  assert.deepEqual(sample.data.pixels, pixels); assert(allowance.remaining < 4_000_000);
  const planAfter = positionedTextRuns(sample.line, createCanvas(1, 1).getContext('2d'));
  const a = planBefore.filter(run => run.kind === 'text')[1], b = planAfter.filter(run => run.kind === 'text')[1];
  assert(Math.abs(a.x - b.x) <= .025 + 1e-8); assert.equal(a.baseline, b.baseline); assert.deepEqual(a.options, b.options);
  const once = structuredClone(sample.scene); fit(sample); assert.deepEqual(sample.scene, once);
  verified++;
}

for (const mutate of [
  s => { s.word.confidence = .98; }, s => { s.item.ocrFontScore = .64; }, s => { s.word.ocrGlyphScore = .95; },
  s => { s.word.fontAssetId = 'font:Explicit'; }, s => { s.item.fontAssetId = 'font:Explicit'; },
  s => { s.word.italic = true; }, s => { s.item.ocrNative = true; }, s => { s.item.raster = true; },
  s => { s.word.bold = !s.item.bold; }, s => { s.table.aiInferred = true; },
  s => { s.scene.sources[0].text += '?'; }, s => { s.scene.sources[0].disposition = 'visible-image'; },
  s => { s.scene.rules.push({ axis: 'h', at: s.word.rect.y + 3, from: s.word.rect.x - 2, to: s.word.rect.x + 20 }); },
  s => { s.item.words.push({ ...s.word, rect: { ...s.word.rect }, ocrGlyphScore: .98 }); },
  s => { s.word.ocrPhysicalFit = { phase: 'established' }; },
  s => { s.word.rect = { ...s.source }; },
  s => { s.table.cells.push({ ...s.cell, rect: { ...s.cell.rect }, blocks: [] }); }
]) {
  const sample = fixture(); mutate(sample); const before = structuredClone(sample.scene), pixels = sample.data.pixels.slice();
  fit(sample); assert.deepEqual(sample.scene, before, 'uncertain, explicit, native, ruled, competing, established or already-tight evidence stays unchanged');
  assert.deepEqual(sample.data.pixels, pixels); verified++;
}

for (const kind of ['border', 'colored', 'detached']) {
  const sample = fixture(), r = sample.word.rect;
  const x = Math.floor((r.x - .4) * scale) + (kind === 'border' ? 0 : 1);
  const y = Math.floor((r.y - .4) * scale) + (kind === 'border' ? 0 : 1);
  sample.data.pixels.set(kind === 'colored' ? [0, 90, 90, 255] : [0, 0, 0, 255], (y * 960 + x) * 4);
  const before = structuredClone(sample.scene), pixels = sample.data.pixels.slice();
  fit(sample); assert.deepEqual(sample.scene, before); assert.deepEqual(sample.data.pixels, pixels); verified++;
}

for (const options of [{ allowance: { remaining: 1 } }, { maxChanges: 0 }, { accepted: new Set([{}]), maxChanges: 1 }]) {
  const sample = fixture(), before = structuredClone(sample.scene); fit(sample, options); assert.deepEqual(sample.scene, before); verified++;
}

for (const options of [{ pixelBudget: 1 }, { pixelBudget: 0 }, { pixelBudget: Infinity }, { maxChanges: 0 }, { maxChanges: 129 }]) {
  const sample = fixture(), before = structuredClone(sample.scene);
  createOcrPhysicalTypography(trackedCanvas)({ changed: true, scene: sample.scene }, sample.data, options);
  assert.deepEqual(sample.scene, before, 'the supplement cannot receive a fresh allowance or bypass original limits'); verified++;
}

const cancelling = fixture(), cancelBefore = structuredClone(cancelling.scene); let checks = 0;
assert.throws(() => fit(cancelling, { check() { if (++checks === 5) throw Error('cancelled'); } }), /cancelled/);
assert.deepEqual(cancelling.scene, cancelBefore); verified++;
const allocating = fixture(), allocateBefore = structuredClone(allocating.scene); let allocations = 0;
assert.throws(() => fit(allocating, { createCanvas(...args) { if (++allocations === 2) throw Error('allocation failed'); return trackedCanvas(...args); } }), /allocation failed/);
assert.deepEqual(allocating.scene, allocateBefore); verified++;
assert(owned.every(state => state.width === 0 && state.height === 0), 'success, failure and cancellation release both canvases');
console.log(`Source-owned table typography: ${verified} synthetic pixel, semantic, neighbour-plan, ownership, negative-evidence, budget and lifecycle checks passed. Reader validation remains separate.`);
