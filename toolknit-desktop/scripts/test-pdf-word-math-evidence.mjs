import assert from 'node:assert/strict';
import { validateMathEvidence } from '../src/features/pdf-to-word/core/math.js';
import { validateAiScope } from '../src/features/pdf-to-word/core/ai-v2.js';

const glyph = (id, text, x, y, width, height, baseline, size) => ({ id, text,
  rect: { x, y, width, height }, baseline, size, italic: false, bold: false });
const symbol = (id, text = id) => ({ type: 'symbol', sourceId: id, text, italic: false, bold: false });
const region = (mathGlyphs, mathStrokes = []) => ({ mathGlyphs, mathStrokes });
const a = symbol('a'), b = symbol('b');
const fractionSource = region([glyph('a', 'a', 13, 8, 5, 6, 14, 9), glyph('b', 'b', 13, 24, 5, 6, 30, 9)],
  [{ id: 'bar', rect: { x: 10, y: 19.8, width: 12, height: .4 }, thin: true }]);
const fraction = { type: 'fraction', strokeId: 'bar', numerator: a, denominator: b };
const scriptSource = region([glyph('a', 'a', 10, 24, 5, 6, 30, 9), glyph('b', 'b', 17, 15, 3, 5, 20, 6)]);
const power = { type: 'script', base: a, superscript: b };
const rowSource = region([glyph('a', 'a', 10, 24, 5, 6, 30, 9), glyph('b', 'b', 18, 24, 5, 6, 30, 9)]);
const row = { type: 'row', children: [a, b] };

const rootPoints = [[8, 15], [10, 14], [12, 20], [16, 5], [30, 5]];
const rootStrokes = rootPoints.slice(0, -1).map((from, segment) => {
  const to = rootPoints[segment + 1];
  return { id: `root-${segment}`, thin: true, rect: { x: Math.min(from[0], to[0]), y: Math.min(from[1], to[1]),
    width: Math.abs(to[0] - from[0]) + .2, height: Math.abs(to[1] - from[1]) + .2 },
  path: { id: 'root', segment, from, to, paint: 'stroke', color: '000000', complete: true } };
});
const rootSource = region([glyph('x', 'x', 20, 8, 6, 7, 15, 10), glyph('two', '2', 6, 6, 3, 4, 10, 5)], rootStrokes);
const root = { type: 'radical', strokeIds: rootStrokes.map(stroke => stroke.id), radicand: symbol('x'), degree: symbol('two', '2') };
const outsideSource = structuredClone(rootSource); outsideSource.mathGlyphs.push(glyph('y', 'y', 35, 8, 6, 7, 15, 10));
const outside = { type: 'row', children: [root, symbol('y')] };

const cases = [
  ['fraction', fractionSource, fraction, true],
  ['swapped fraction', fractionSource, { ...fraction, numerator: b, denominator: a }, false],
  ['superscript', scriptSource, power, true],
  ['superscript changed to subscript', scriptSource, { type: 'script', base: a, subscript: b }, false],
  ['flattened power', scriptSource, row, false],
  ['same baseline is not a power', rowSource, power, false],
  ['row', rowSource, row, true],
  ['reversed operands', rowSource, { type: 'row', children: [b, a] }, false],
  ['root degree', rootSource, root, true],
  ['swapped degree and content', rootSource, { ...root, degree: root.radicand, radicand: root.degree }, false],
  ['outside the root', outsideSource, outside, true],
  ['root consumes adjacent operand', outsideSource, { ...root, radicand: { type: 'row', children: [symbol('x'), symbol('y')] } }, false],
];
for (const [name, source, ast, valid] of cases) {
  const before = structuredClone({ source, ast });
  assert.equal(validateMathEvidence(ast, source), valid, name);
  const request = { schemaVersion: 2, requestId: 'test', inputDigest: 'a'.repeat(64), sourceDigest: 'b'.repeat(64),
    page: 1, scopeId: 'scope', kind: 'math', math: { id: 'formula', glyphs: source.mathGlyphs, strokes: source.mathStrokes } };
  const { kind, math, ...identity } = request;
  const response = JSON.stringify({ ...identity, mathCandidates: [{ id: 'formula', ast }] });
  if (valid) validateAiScope(response, request);
  else assert.throws(() => validateAiScope(response, request), /ai-response/, `AI: ${name}`);
  assert.deepEqual({ source, ast }, before, 'validation cannot rewrite input evidence');
}
for (const mutate of [value => { value.mathGlyphs[0].size = Infinity; }, value => { value.mathGlyphs[0].raster = true; },
  value => { value.mathGlyphs.push({ ...value.mathGlyphs[0] }); }, value => { value.mathStrokes[0].rect.y = 3; },
  value => { value.mathStrokes[0].rect.x = 50; }, value => { value.mathStrokes.push({ ...value.mathStrokes[0] }); }]) {
  const changed = structuredClone(fractionSource); mutate(changed);
  assert(!validateMathEvidence(fraction, changed), 'invalid or unowned geometry cannot validate a formula');
}
console.log('Math evidence passed: fraction direction, script direction, row order, radical ownership, source immutability and AI rejection.');
