import assert from 'node:assert/strict';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import { inferMathAst } from '../src/features/pdf-to-word/core/math.js';
import * as evidence from '../src/features/pdf-to-word/core/math-region-evidence.js';

const glyph = (id, text, x, y, width, height, size, baseline, font, italic = false) => ({
  id, sourceIds: [id], text, rect: { x, y, width, height }, size, baseline, font,
  preciseInk: true, raster: false, italic, bold: false, color: '000000', order: 0,
});
const base = glyph('base', 'T', 160.049, 43.17, 7.418, 7.385, 11, 50.55, 'ABCDEF+CMMI10', true);
const subscript = glyph('subscript', 'i', 166.401, 46.917, 2.287, 5.356, 8, 52.186, 'ABCDEF+CMMI8', true);
const following = glyph('following', 'i', 163.374, 56.895, 2.88, 7.331, 11, 64.099, 'ABCDEF+CMMI10', true);
const upperProse = glyph('upper-prose', 'the figure represents an input embedding,', 20, 43.106, 135, 9.829, 11, 50.55, 'Times-Roman');
const lowerProse = glyph('lower-prose', 'represents a contextual token in this paragraph', 20, 56.655, 140.58, 9.818, 11, 64.099, 'Times-Roman');
const input = [base, subscript, following, upperProse, lowerProse];
const originals = structuredClone(input);
const sources = input.map(item => ({ id: item.id, text: item.text, rect: { ...item.rect }, disposition: 'editable', order: 0 }));
const grouped = groupPageRegions(input, [], [], sources, { bounds: { x: 0, y: 0, width: 200, height: 130 } });
assert(sources.filter(source => source.id.endsWith('prose')).every(source => source.disposition === 'editable'),
  'a small index cannot bridge to the next prose line and turn both paragraphs into a picture');
assert(grouped.items.some(item => item.id === 'lower-prose' && item.type === 'text'));
const formula = grouped.items.find(item => item.role === 'math' && item.sourceIds.includes('base'));
assert(formula);
assert.deepEqual(new Set(formula.sourceIds), new Set(['base', 'subscript']));
const ast = inferMathAst(formula);
assert.equal(ast.type, 'script');
assert.equal(ast.base.sourceId, 'base');
assert.equal(ast.subscript.sourceId, 'subscript');
assert.deepEqual(input, originals, 'source evidence never mutates input glyphs');

const owners = evidence.nativeSubscriptOwners([base, subscript, following]);
assert.equal(owners.size, 1);
assert.equal(owners.get(subscript), base);
for (const change of [
  (b, s) => { b.font = 'UnknownBase'; },
  (b, s) => { s.font = 'UnknownIndex'; },
  (b, s) => { s.raster = true; },
  (b, s) => { s.ocr = true; },
  (b, s) => { s.rect.width = 0; },
  (b, s) => { s.preciseInk = false; },
  (b, s) => { s.alphabet = 'script'; },
  (b, s) => { s.mathStyleUncertain = true; },
  (b, s) => { s.baseline = b.baseline; },
  (b, s) => { s.baseline = b.baseline - 5; },
  (b, s) => { s.size = b.size; },
  (b, s) => { s.rect.x = b.rect.x - 3; },
  (b, s) => { b.bold = true; },
  (b, s) => { s.delimiterPart = true; },
  (b, s) => { s.baseline = NaN; },
]) {
  const [b, s] = structuredClone([base, subscript]); change(b, s);
  assert.equal(evidence.nativeSubscriptOwners([b, s]).size, 0, 'uncertain source geometry cannot pin an index');
}
const competitor = { ...base, id: 'competitor', rect: { ...base.rect, x: base.rect.x + .5 } };
assert.equal(evidence.nativeSubscriptOwners([base, subscript, competitor]).size, 0, 'multiple plausible bases remain ambiguous');

// Both scripts still connect through their real base even if their direct
// peer-to-peer edge is unnecessary; a large global distance reduction is wrong.
const upper = glyph('superscript', '2', 167, 39, 3.5, 5.4, 8, 45, 'ABCDEF+CMR8');
const both = [structuredClone(base), structuredClone(subscript), upper];
const bothSources = both.map(g => ({ id: g.id, text: g.text, rect: g.rect, disposition: 'editable' }));
const bothGroups = groupPageRegions(both, [], [], bothSources, { bounds: { x: 0, y: 0, width: 200, height: 130 } });
const bothFormula = bothGroups.items.find(item => item.role === 'math' && item.sourceIds.includes('base'));
assert.deepEqual(new Set(bothFormula.sourceIds), new Set(both.map(g => g.id)));
const bothAst = inferMathAst(bothFormula);
assert.equal(bothAst.subscript.sourceId, 'subscript');
assert.equal(bothAst.superscript.sourceId, 'superscript');
const dense = Array.from({ length: 1000 }, (_, index) => glyph('dense-' + index, 'x', 2, 2, 6, 8, 11, 10, 'ABCDEF+CMMI10', true));
assert.equal(evidence.nativeSubscriptOwners([base, subscript, ...dense]).size, 0, 'exhausted work budget discards partial ownership evidence');
assert.deepEqual(evidence.nativeSubscriptOwners([]), new Map());
console.log('Native math adjacency: source-pinned subscripts, cross-row prose protection, full dual scripts, ambiguity and bounded-work refusal passed.');
