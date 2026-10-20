import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { Document, Packer, Paragraph } from 'docx';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { inferMathAst, validateMathAst, validateMathEvidence } from '../src/features/pdf-to-word/core/math.js';
import { validateAiScope } from '../src/features/pdf-to-word/core/ai-v2.js';
import { nativeMath } from '../src/features/pdf-to-word/adapters/docx-math.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';

const glyph = (id, text, x, y, width, height, baseline, size, italic = false) => ({ id, text,
  rect: { x, y, width, height }, baseline, size, italic, bold: false, font: 'Cambria Math' });
const source = { id: 'sum', role: 'math', reasons: [], rect: { x: 25, y: 12, width: 60, height: 30 }, mathStrokes: [], mathGlyphs: [
  glyph('sigma', '\u2211', 25, 20, 14, 14, 20, 10), glyph('upper', 'H', 29, 12, 6, 5, 17, 7, true),
  glyph('lower-i', 'i', 25, 37, 3, 5, 42, 7, true), glyph('lower-eq', '=1', 29, 37, 10, 5, 42, 7),
  glyph('a', 'a', 43, 23, 5, 7, 30, 10, true), glyph('index', 'i', 49, 29, 3, 5, 34, 7, true),
  glyph('power', 'l', 49, 19, 3, 5, 24, 7, true)
] };
const ast = inferMathAst(source);
assert.equal(ast?.type, 'nary'); assert.equal(ast.operator.sourceId, 'sigma');
assert.equal(ast.body.type, 'script'); assert.equal(ast.body.base.sourceId, 'a');
assert.equal(ast.body.subscript.sourceId, 'index'); assert.equal(ast.body.superscript.sourceId, 'power');
assert.equal(ast.upper.sourceId, 'upper'); assert(validateMathAst(ast, source));
const following = structuredClone(source); following.mathGlyphs.push(glyph('plus', '+', 58, 23, 6, 7, 30, 10), glyph('b', 'b', 66, 23, 5, 7, 30, 10, true));
const followedAst = inferMathAst(following);
assert.equal(followedAst?.children[0].type, 'nary');
assert.deepEqual(followedAst.children.slice(1).map(node => node.sourceId), ['plus', 'b'], 'a following addition stays outside the summation');
const swallowed = { ...ast, body: { type: 'row', children: [ast.body, ...followedAst.children.slice(1)] } };
assert(!validateMathEvidence(swallowed, following), 'same-source AI cannot expand the body over an unparenthesized addition');
const request = { schemaVersion: 2, requestId: 'sum', inputDigest: 'a'.repeat(64), sourceDigest: 'b'.repeat(64), page: 1, scopeId: 'sum',
  kind: 'math', math: { id: 'sum', glyphs: source.mathGlyphs, strokes: [] } };
const { kind, math, ...identity } = request;
validateAiScope(JSON.stringify({ ...identity, mathCandidates: [{ id: 'sum', ast }] }), request);
for (const changed of [{ ...ast, lower: ast.upper, upper: ast.lower }, { ...ast, body: ast.upper, upper: ast.body },
  { ...ast, operator: { ...ast.operator, text: '\u220f' } }]) {
  assert.throws(() => validateAiScope(JSON.stringify({ ...identity, mathCandidates: [{ id: 'sum', ast: changed }] }), request), /ai-response/);
}
for (const mutate of [value => { value.mathGlyphs = value.mathGlyphs.filter(item => !['a', 'index', 'power'].includes(item.id)); },
  value => { value.mathGlyphs[1].rect.x += 30; }, value => { value.mathGlyphs[0].bold = true; },
  value => { value.mathGlyphs.push(glyph('adjacent', 'b', 58, 23, 5, 7, 30, 10, true)); }]) {
  const changed = structuredClone(source); mutate(changed); assert.equal(inferMathAst(changed), null, 'ambiguous ownership or unsupported operator stays an image');
}
const grouped = structuredClone(source);
grouped.mathGlyphs = [...grouped.mathGlyphs.slice(0, 4), ...['(', 'a', '+', 'b', ')'].map((text, index) =>
  glyph(`body-${index}`, text, 43 + index * 7, 23, 5, 7, 30, 10, /[ab]/.test(text)))];
assert.equal(inferMathAst(grouped)?.body.type, 'row', 'parentheses explicitly own a multi-term body');
const before = structuredClone(source); inferMathAst(source); assert.deepEqual(source, before);
const microText = [glyph('mu', '\u00b5', 10, 24, 5, 7, 31, 10, true), glyph('layer', 'l', 16, 19, 2, 5, 24, 7, true),
  glyph('equals', '=', 22, 26, 6, 2, 31, 10)].map(item => ({ ...item, type: 'text', sourceIds: [item.id], order: 1 }));
const microSources = microText.map(item => ({ id: item.id, text: item.text, rect: item.rect, order: 1, disposition: 'editable' }));
const microGroup = groupPageRegions(microText, [], [], microSources).items.find(item => item.type === 'image');
assert.deepEqual(new Set(microGroup.sourceIds), new Set(['mu', 'layer', 'equals']));
const microAst = inferMathAst(microGroup);
assert.equal(microAst.children[0].base.text, '\u00b5', 'the PDF micro-sign spelling is preserved, not silently rewritten');
for (const scale of [.6, 1, 1.8, 3]) {
  const scaled = structuredClone(source);
  for (const item of scaled.mathGlyphs) {
    item.rect = { x: item.rect.x * scale + 200, y: item.rect.y * scale + 80, width: item.rect.width * scale, height: item.rect.height * scale };
    item.baseline = item.baseline * scale + 80; item.size *= scale;
  }
  assert.equal(inferMathAst(scaled)?.type, 'nary');
}
const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [source, grouped, following].map(value =>
  new Paragraph({ children: [nativeMath(inferMathAst(value), value, { measurementContext: createCanvas(1, 1).getContext('2d') })],
    run: { size: 20 }, spacing: { after: 400 } })) }] }));
const zip = await JSZip.loadAsync(bytes), xml = await zip.file('word/document.xml').async('string');
const all = node => [node, ...(node.elements || []).flatMap(all)];
const direct = (node, name) => node?.elements?.find(child => child.name === name);
const text = node => all(node).filter(child => child.name === 'm:t').map(child => child.elements?.map(value => value.text || '').join('')).join('').replace(/\s/g, '');
const formulas = all(xml2js(xml)).filter(node => node.name === 'm:oMath');
assert.equal(formulas.length, 3);
for (const [index, formula] of formulas.entries()) {
  const group = direct(direct(formula, 'm:box'), 'm:e'), upper = direct(group, 'm:limUpp');
  const lower = direct(direct(upper, 'm:e'), 'm:limLow');
  assert.equal(text(direct(lower, 'm:e')), '\u2211', 'the source sum operator remains one editable glyph');
  assert.equal(text(direct(lower, 'm:lim')), 'i=1');
  assert.equal(text(direct(upper, 'm:lim')), 'H');
  const body = group.elements.filter(child => child.type === 'element' && child !== upper);
  assert.equal(body.map(text).join(''), index === 1 ? '(a+b)' : 'ail', 'limits stay separate from the complete sum body');
  assert.equal((text(formula).match(/\u2211/g) || []).length, 1);
}
assert.equal(text(formulas[2]).slice(-2), '+b');
assert(!xml.includes('<m:nary>'), 'measured operators use source geometry instead of an unscalable Office glyph');
const unmeasured = nativeMath(ast, source).prepForXml({ stack: [] });
assert(JSON.stringify(unmeasured).includes('m:nary'), 'legacy calls without measurement keep their native sum representation');
await mkdir('tmp/pdf-word-math/summation', { recursive: true });
await writeFile('tmp/pdf-word-math/summation/supported.docx', bytes);
console.log('Summation checks passed: centered bounds, explicit body, following addition, ambiguous rejection, AI mutations and native OMML.');
