import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import * as evidence from '../src/features/pdf-to-word/core/math-region-evidence.js';
import * as runs from '../src/features/pdf-to-word/core/math-limit-runs.js';
import { nativeMathReaderMode } from '../src/features/pdf-to-word/core/native-math-policy.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const context = createCanvas(1, 1).getContext('2d');
const union = rects => {
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
  return { x, y, width: Math.max(...rects.map(r => r.x + r.width)) - x, height: Math.max(...rects.map(r => r.y + r.height)) - y };
};
function glyph(id, text, x, baseline = 60, size = 11, italic = false) {
  const parts = []; let offset = 0;
  context.font = `${italic ? 'italic ' : ''}1000px "Cambria Math"`; context.fontKerning = 'none';
  for (const char of text) {
    const m = context.measureText(char), scale = size / 1000, rect = { x: x - m.actualBoundingBoxLeft * scale,
      y: baseline - m.actualBoundingBoxAscent * scale, width: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * scale,
      height: (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * scale };
    parts.push({ text: char, sourceOffset: offset++, rect, baseline, baselineX: x, advanceWidth: m.width * scale });
    x += m.width * scale;
  }
  return { id, sourceIds: [id], text, rect: union(parts.map(p => p.rect)), baseline, size,
    font: 'ABCDEF+' + (italic ? size === 8 ? 'CMMI8' : 'CMMI10' : 'CMR10'), italic, bold: false,
    color: '000000', preciseInk: true, raster: false, order: 1, ...(parts.length > 1 ? { mathGlyphPositions: parts } : {}) };
}
const prefix = glyph('call', 'log(softmax(', 30);
const matrix = glyph('matrix', 'CW', prefix.rect.x + prefix.rect.width + 1, 60, 11, true);
const transpose = glyph('transpose', 'T', matrix.rect.x + matrix.rect.width + .5, 56, 8, true);
const close = glyph('closing', '))', transpose.rect.x + transpose.rect.width + .7);
const prose = { ...glyph('prose', 'e.g.,', 8), rect: { x: 8, y: 52, width: 15, height: 9 }, font: 'Times-Roman' };
const line = { id: 'separator', rect: { x: 8, y: 67.5, width: 60, height: .4 }, order: 2, raster: true,
  thin: true, decoration: true, reason: 'image', path: { complete: true, paint: 'stroke' } };
const input = [prose, prefix, matrix, transpose, close];
const before = structuredClone(input);
const sources = input.map(g => ({ id: g.id, text: g.text, rect: { ...g.rect }, order: 1, disposition: 'editable' }));
const grouped = groupPageRegions(input, [line], [], sources, { bounds: { x: 0, y: 0, width: 250, height: 120 } });
assert.equal(sources.find(s => s.id === prose.id).disposition, 'editable', 'a footnote separator cannot turn unrelated prose into a formula image');
const formula = grouped.items.find(g => g.role === 'math' && g.sourceIds.includes(prefix.id));
assert(formula && formula.sourceIds.includes(close.id) && !formula.drawingIds.length, 'one uniquely matching closing run completes the original call');
const plan = runs.planNativeMathRuns(formula);
assert(plan && nativeMathReaderMode(plan.ast, plan.region) === 'script', JSON.stringify({ ast: plan?.ast,
  glyphs: plan?.region.mathGlyphs.map(g => ({ id: g.id, text: g.text, rect: g.rect, size: g.size, baseline: g.baseline, italic: g.italic })) }));
const nodes = node => [node, ...(node.type === 'row' ? node.children.flatMap(nodes) : [])];
const power = nodes(plan.ast).find(node => node.type === 'script');
assert(power && !power.subscript);
assert.equal(power.base.text, 'W', 'the transpose applies to the final matrix, not the complete CW run');
assert.equal(power.superscript.text, 'T');
assert.equal(power.base.splitFrom, undefined, 'source ownership lives on the prepared glyph, not guessed AST fields');
assert.equal(plan.region.mathGlyphs.find(g => g.id === power.base.sourceId).splitFrom, matrix.id);
assert.deepEqual(input, before);
assert.deepEqual(evidence.nativeNonFractionRules([prefix, matrix, transpose, close], [line]), new Set([line]));
for (const mutate of [g => { g.path.complete = false; }, g => { g.mathGlyph = true; },
  g => { g.rect.width = 20; }, g => { g.rect.height = 4; }]) {
  const other = structuredClone(line); mutate(other);
  assert.equal(evidence.nativeNonFractionRules(input, [other]).size, 0);
}
const numerator = glyph('numerator', 'X', 25, 52, 11, true), denominator = glyph('denominator', 'Y', 25, 80, 11, true);
assert.equal(evidence.nativeNonFractionRules([numerator, denominator], [line]).size, 0, 'a genuine two-sided fraction bar keeps its original path');
assert(runs.hasNativeMathFunctionRun('log(softmax(', 'ABCDEF+CMR10'));
assert(runs.hasNativeMathFunctionRun('ln(', 'ABCDEF+CMR10'));
for (const text of ['log', 'soft max', 'print(', 'log(softmax(exp(', 'log(x)', 'log('.repeat(100)])
  assert(!runs.hasNativeMathFunctionRun(text, 'ABCDEF+CMR10'));
assert(!runs.hasNativeMathFunctionRun('log(', 'Unknown'));

for (const change of [
  r => { r.mathGlyphs.find(g => g.text === 'log').italic = true; },
  r => { r.mathGlyphs.find(g => g.text === 'log').font = 'Unknown'; },
  r => { r.mathGlyphs.find(g => g.text === 'softmax').baseline += 1; },
  r => { r.mathGlyphs.find(g => g.text === 'softmax').size += 1; },
  r => { r.mathGlyphs.find(g => g.id === power.base.sourceId).italic = false; },
  r => { r.mathGlyphs.find(g => g.id === power.base.sourceId).rect.width = 0; },
  r => { r.mathGlyphs.find(g => g.id === 'transpose').size = 11; },
  r => { r.mathGlyphs.find(g => g.id === 'transpose').baseline = 60; },
  r => { r.mathGlyphs.find(g => g.id === 'transpose').rect.x -= 15; },
  r => { r.mathGlyphs[0].raster = true; }, r => { r.mathGlyphs[0].ocr = true; },
  r => { r.mathGlyphs[0].mathStyleUncertain = true; },
  r => { r.sourceIds.push('uncovered'); }, r => { r.drawingIds = ['extra']; },
]) {
  const changed = structuredClone(plan.region); change(changed);
  assert.equal(nativeMathReaderMode(plan.ast, changed), null, 'all function atoms, transpose geometry and source roles must be proved');
}
for (const change of [
  ast => { nodes(ast).find(n => n.type === 'script').superscript.text = '2'; },
  ast => { const p = nodes(ast).find(n => n.type === 'script'); p.subscript = p.superscript; delete p.superscript; },
  ast => { ast.children[0].text = 'exp'; },
  ast => { const inner = nodes(ast).find(n => n.type === 'row' && n.children.some(c => c.type === 'script'));
    const p = inner.children.find(n => n.type === 'script'), at = inner.children.findIndex(n => n.text === 'C');
    [inner.children[at], p.base] = [p.base, inner.children[at]]; },
  ast => { ast.children.push(ast); },
]) {
  const changed = structuredClone(plan.ast); change(changed);
  assert.equal(nativeMathReaderMode(changed, plan.region), null, 'complete source ids cannot legitimize another function, operand or transpose owner');
}
const ambiguous = { ...close, id: 'another-close', rect: { ...close.rect, x: close.rect.x + .1 } };
const members = [prefix, matrix, transpose];
assert.deepEqual(evidence.nativeFunctionClosings([members], [...members, close, ambiguous]), [members]);
const copiedMembers = members.map(g => ({ ...g, id: g.id + ':copy' }));
assert.deepEqual(evidence.nativeFunctionClosings([members, copiedMembers], [...members, ...copiedMembers, close]), [members, copiedMembers]);
const shifted = members.map(g => ({ ...g, id: g.id + ':far', rect: { ...g.rect, x: g.rect.x + 1000 } }));
const farClose = { ...close, id: 'far-close', rect: { ...close.rect, x: close.rect.x + 1000 } };
const dense = Array.from({ length: 9000 }, (_, i) => ({ ...farClose, id: 'dense' + i }));
assert.deepEqual(evidence.nativeFunctionClosings([members, shifted], [...members, close, ...shifted, farClose, ...dense]),
  [members, shifted], 'an exhausted neighbor budget leaves no partial closing claims');
const crowded = Array.from({ length: 500 }, (_, i) => ({ ...prefix, id: 'crowded' + i, rect: { x: 95, y: 52, width: 1, height: 1 } }));
const repeatedRules = Array.from({ length: 20 }, (_, i) => ({ ...line, id: 'rule' + i }));
assert.equal(evidence.nativeNonFractionRules(crowded, repeatedRules).size, 0, 'rule-proof work exhaustion preserves the original path atomically');
const missingTrace = structuredClone(formula); delete missingTrace.mathGlyphs.find(g => g.id === prefix.id).mathGlyphPositions;
const missingPlan = runs.planNativeMathRuns(missingTrace);
assert(!missingPlan || nativeMathReaderMode(missingPlan.ast, missingPlan.region) === null);

const scene = { number: 1, width: 250, height: 120, items: grouped.items, sources, rules: [], risks: grouped.risks, characters: input.reduce((n, g) => n + g.text.length, 0) };
const document = inferDocument([scene], { preserveGeometry: true });
const assets = grouped.items.filter(g => g.type === 'image').map(g => ({ id: g.id, bytes: createCanvas(1, 1).toBuffer('image/png') }));
const output = await createWordBytes(document, assets, { preserveGeometry: true, editableMath: true, strictMathGeometry: true, measurementContext: context });
const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
assert.equal(output.quality.nativeFormulas, 1);
assert.equal((xml.match(/<m:sSup>/g) || []).length, 1);
assert(xml.includes('>log</m:t>') && xml.includes('>softmax</m:t>') && xml.includes('>W</m:t>'));
console.log('Native function calls: separated footnote rules, unique balanced closing, complete glyph trace, final-matrix transpose, source counterexamples and actual editable DOCX passed.');
