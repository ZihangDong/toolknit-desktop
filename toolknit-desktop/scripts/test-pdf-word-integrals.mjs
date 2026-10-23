import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { Document, Packer, Paragraph } from 'docx';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { inferMathAst, validateMathAst, validateMathEvidence } from '../src/features/pdf-to-word/core/math.js';
import { nativeMath } from '../src/features/pdf-to-word/adapters/docx-math.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import { validateAiScope } from '../src/features/pdf-to-word/core/ai-v2.js';

const glyph = (id, text, x, y, size = 10, width = 6, height = 7) => ({ id, text, size,
  rect: { x, y, width, height }, baseline: y + height, font: 'Cambria Math', italic: /^[a-z]/.test(text), bold: false });
const source = { id: 'integral', role: 'math', reasons: [], rect: { x: 10, y: 6, width: 34, height: 29 }, mathStrokes: [], mathGlyphs: [
  { ...glyph('op', '\u222b', 10, 10, 10, 8, 22), baseline: 10 },
  glyph('lower', '0', 16, 30, 7, 4, 5), glyph('upper', '1', 18, 6, 7, 4, 5),
  glyph('body', 'x', 23, 17), glyph('diff', 'dx', 32, 17, 10, 12)
] };
const ast = inferMathAst(source);
assert.equal(ast?.type, 'integral'); assert.equal(ast.operator.text, '\u222b');
assert.equal(ast.lower.sourceId, 'lower'); assert.equal(ast.upper.sourceId, 'upper');
assert.equal(ast.body.sourceId, 'body'); assert.equal(ast.differential.sourceId, 'diff');
assert(validateMathAst(ast, source));
const indexed = structuredClone(source);
indexed.mathGlyphs.splice(-1, 1, glyph('index', 'i', 30, 29, 7, 3, 5), glyph('diff', 'dx', 37, 17, 10, 12));
const indexedAst = inferMathAst(indexed);
assert.equal(indexedAst?.lower.sourceId, 'lower');
assert.equal(indexedAst?.body.subscript.sourceId, 'index', 'an integrand subscript cannot be stolen as an integral lower bound');
const stolenIndex = { ...indexedAst, body: indexedAst.body.base,
  lower: { type: 'row', children: [indexedAst.lower, indexedAst.body.subscript] } };
assert(!validateMathEvidence(stolenIndex, indexed));
const indefinite = structuredClone(source); indefinite.mathGlyphs = indefinite.mathGlyphs.filter(item => !['lower', 'upper'].includes(item.id));
const indefiniteAst = inferMathAst(indefinite);
assert.equal(indefiniteAst?.type, 'integral'); assert(!indefiniteAst.lower && !indefiniteAst.upper);
const split = structuredClone(source); split.mathGlyphs.splice(-1, 1, glyph('d', 'd', 32, 17), glyph('x', 'x', 39, 17));
const splitAst = inferMathAst(split);
assert.equal(splitAst.differential.type, 'row'); assert.deepEqual(splitAst.differential.children.map(item => item.sourceId), ['d', 'x']);
const compound = structuredClone(source); compound.mathGlyphs.splice(-2, 2,
  ...['x', '+', 'y'].map((text, index) => glyph(`b${index}`, text, 23 + index * 8, 17)), glyph('diff', 'dx', 48, 17, 10, 12));
assert.deepEqual(inferMathAst(compound)?.body.children.map(item => item.text), ['x', '+', 'y'],
  'addition before the differential belongs to the complete integrand');
const differentialArgument = structuredClone(source);
differentialArgument.mathGlyphs.splice(-2, 2, ...['f', '(', 'dx', ')'].map((text, index) =>
  glyph(`argument-${index}`, text, 23 + index * 12, 17, 10, text === 'dx' ? 10 : 6)), glyph('diff', 'dx', 72, 17, 10, 12));
assert.equal(inferMathAst(differentialArgument)?.differential.sourceId, 'diff',
  'a d-variable inside function parentheses does not terminate the integral');
const fractionBody = structuredClone(source);
fractionBody.mathGlyphs.splice(-2, 2, glyph('numerator', '1', 25, 15, 6, 4, 4), glyph('denominator', 'x', 25, 23, 6, 4, 4),
  glyph('diff', 'dx', 36, 17, 10, 12));
fractionBody.mathStrokes = [{ id: 'bar', thin: true, rect: { x: 23, y: 21, width: 9, height: .4 } }];
assert.equal(inferMathAst(fractionBody)?.body.type, 'fraction', 'a complete fraction stays the integral body');
const following = structuredClone(source); following.mathGlyphs.push(glyph('plus', '+', 47, 17), glyph('tail', 'y', 55, 17));
const followingAst = inferMathAst(following);
assert.equal(followingAst.children[0].type, 'integral');
assert.deepEqual(followingAst.children.slice(1).map(item => item.sourceId), ['plus', 'tail'],
  'addition after the differential stays outside the integral');
const wrapped = structuredClone(indefinite);
wrapped.mathGlyphs.push(glyph('open', '(', 1, 17), glyph('close', ')', 47, 17));
assert.equal(inferMathAst(wrapped)?.children[1].type, 'integral', 'an enclosing group can own a complete integral');
const ambiguous = structuredClone(source);
ambiguous.mathGlyphs.push(glyph('plus', '+', 47, 17), glyph('tail', 'y', 55, 17), glyph('later-diff', 'dy', 63, 17, 10, 12));
const ambiguousAst = inferMathAst(ambiguous);
assert(ambiguousAst);
const swallowed = { ...ast, body: { type: 'row', children: [ast.body, ast.differential, ...ambiguousAst.children.slice(1, -1)] },
  differential: ambiguousAst.children.at(-1) };
assert(!validateMathEvidence(swallowed, ambiguous), 'an AI proposal cannot skip the first differential and swallow a following term');
for (const mutate of [value => { value.mathGlyphs.pop(); }, value => { value.mathGlyphs[1].rect.x += 40; },
  value => { value.mathGlyphs[0].bold = true; }, value => { value.mathGlyphs.at(-1).text = 'delta'; },
  value => { value.mathGlyphs[0].text = '\u222e'; }, value => { value.mathGlyphs[0].text = '\u222bxdx'; },
  value => { value.mathGlyphs.at(-1).rect.y += 10; value.mathGlyphs.at(-1).baseline += 10; },
  value => { value.reasons.push('partial-clip'); }]) {
  const changed = structuredClone(source); mutate(changed);
  assert.equal(inferMathAst(changed), null, 'missing/ambiguous evidence keeps the formula image');
}
for (const changed of [{ ...ast, lower: ast.upper, upper: ast.lower }, { ...ast, differential: ast.body, body: ast.differential },
  { ...ast, differential: { ...ast.differential, text: 'dy' } }]) {
  assert(!validateMathEvidence(changed, source));
}
assert(!validateMathEvidence({ type: 'row', children: [{ type: 'script', base: ast.operator,
  subscript: ast.lower, superscript: ast.upper }, ast.body, ast.differential] }, source),
  'an integral cannot be flattened into an ordinary scripted symbol with no owned integrand');
const request = { schemaVersion: 2, requestId: 'integral', inputDigest: 'a'.repeat(64), sourceDigest: 'b'.repeat(64),
  page: 1, scopeId: 'integral', kind: 'math', math: { id: 'integral', glyphs: source.mathGlyphs, strokes: [] } };
const { kind, math, ...identity } = request;
validateAiScope(JSON.stringify({ ...identity, mathCandidates: [{ id: 'integral', ast }] }), request);
assert.throws(() => validateAiScope(JSON.stringify({ ...identity,
  mathCandidates: [{ id: 'integral', ast: { ...ast, lower: ast.upper, upper: ast.lower } }] }), request), /ai-response/);
const before = structuredClone(source);
for (const scale of [.6, 1, 2.5]) {
  const changed = structuredClone(source);
  for (const item of changed.mathGlyphs) {
    item.rect = { x: item.rect.x * scale + 100, y: item.rect.y * scale + 60, width: item.rect.width * scale, height: item.rect.height * scale };
    item.size *= scale; item.baseline = item.baseline * scale + 60;
  }
  assert.deepEqual(inferMathAst(changed), ast, 'structure is invariant under translation and uniform scaling');
}
const text = source.mathGlyphs.map(item => ({ ...item, type: 'text', sourceIds: [item.id], order: 1 }));
const sources = text.map(item => ({ id: item.id, text: item.text, rect: item.rect, disposition: 'editable', order: 1 }));
const grouped = groupPageRegions(text, [], [], sources).items.filter(item => item.type === 'image');
assert.equal(grouped.length, 1, 'the tall operator, bounds, body and differential form one source-owned region');
assert.deepEqual(new Set(grouped[0].sourceIds), new Set(text.map(item => item.id)));
assert.equal(inferMathAst(grouped[0])?.type, 'integral');
const samples = [source, indefinite, split, compound, following];
const bytes = await Packer.toBuffer(new Document({ sections: [{ children: samples.map(value =>
  new Paragraph({ children: [nativeMath(inferMathAst(value), value, { measurementContext: createCanvas(1, 1).getContext('2d') })],
    run: { size: 20 }, spacing: { after: 400 } })) }] }));
const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string');
const all = node => [node, ...(node.elements || []).flatMap(all)];
const direct = (node, name) => node?.elements?.find(child => child.name === name);
const content = node => all(node).filter(item => item.name === 'm:t').map(item => item.elements?.map(value => value.text || '').join('')).join('').replace(/\s/g, '');
const formulas = all(xml2js(xml)).filter(node => node.name === 'm:oMath');
assert.equal(formulas.length, samples.length);
for (const formula of formulas) assert.equal((content(formula).match(/\u222b/g) || []).length, 1);
const group = direct(direct(formulas[0], 'm:box'), 'm:e'), upper = direct(group, 'm:limUpp');
const lower = direct(direct(upper, 'm:e'), 'm:limLow');
assert.equal(content(direct(lower, 'm:e')), '\u222b');
assert.equal(content(direct(lower, 'm:lim')), '0'); assert.equal(content(direct(upper, 'm:lim')), '1');
assert.equal(content({ elements: group.elements.filter(node => node !== upper) }), 'xdx');
assert.equal(content(formulas.at(-1)).slice(-2), '+y');
const plain = JSON.stringify(nativeMath(ast, source).prepForXml({ stack: [] }));
assert(plain.includes('m:nary') && plain.includes('subSup') && !plain.includes('m:chr'),
  'unmeasured output uses the default OMML integral glyph with side bounds');
assert.deepEqual(source, before, 'neither parsing nor native output rewrites the source');
console.log('Integral checks passed: bounds, complete integrand and differential, geometry, AI mutations, grouping and actual OMML.');
