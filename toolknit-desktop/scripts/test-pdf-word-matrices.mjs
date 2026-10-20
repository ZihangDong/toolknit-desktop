import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { MathMatrix } from 'docx/math';
import { MathRun, RunProperties } from 'docx';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { identifyTexDelimiter } from '../src/features/pdf-to-word/core/tex-delimiter.js';
import { inferMathAst, validateMathEvidence } from '../src/features/pdf-to-word/core/math.js';
import { matrixDelimiterPairs } from '../src/features/pdf-to-word/core/math-matrices.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { createNativeMathMeasurer } from '../src/features/pdf-to-word/core/native-math-layout.js';
import { validateAiScope } from '../src/features/pdf-to-word/core/ai-v2.js';

const curve = (part, right = false) => {
  const centers = Array.from({ length: 17 }, (_, i) => [2 + 25 * (part === 'whole' ? (i / 8 - 1) ** 2 : (i / 16) ** 2), i * 100 / 16]);
  const points = [...centers.map(([x, y]) => [x - 2, y]), ...centers.toReversed().map(([x, y]) => [x + 2, y])]
    .map(([x, y]) => [right ? 30 - x : x, part === 'bottom' ? 100 - y : y]);
  return [...points.map((args, i) => ({ command: i ? 'lineTo' : 'moveTo', args })), { command: 'closePath', args: [] }];
};
const identify = (text, slot, commands, embeddedName = 'CMEX10') => identifyTexDelimiter({ fontName: 'ABCDEF+CMEX10', embeddedName,
  glyph: { unicode: text, originalCharCode: slot, isInFont: true }, commands });
assert.deepEqual(identify('\uf8eb', 48, curve('top'))?.delimiterPart, { kind: 'round', side: 'left', part: 'top' });
assert.deepEqual(identify('\uf8f8', 65, curve('bottom', true))?.delimiterPart, { kind: 'round', side: 'right', part: 'bottom' });
assert.equal(identify('(', 18, curve('whole'))?.delimiterPart.part, 'whole');
assert(identify('\uf8eb', 64, curve('top')).uncertain);
assert(identify('\uf8eb', 48, curve('top', true)).uncertain);
assert(identify('\uf8eb', 48, curve('top'), 'CMR10').uncertain);
assert(identify('\uf8eb', 48, [{ command: 'lineTo', args: [Infinity, 0] }]).uncertain);

const glyph = (id, text, x, y, width = 6, height = 7, size = 10) => ({ id, text, rect: { x, y, width, height },
  baseline: y + height, size, font: 'Cambria Math', bold: false, italic: false, color: '000000' });
const bracket = (id, side, x) => ({ ...glyph(id, side === 'left' ? '(' : ')', x, 10, 4, 30), baseline: 10, font: 'CMEX10',
  delimiterPart: { kind: 'round', side, part: 'whole' } });
const region = { role: 'math', reasons: [], mathStrokes: [], mathGlyphs: [bracket('left', 'left', 10), bracket('right', 'right', 70),
  glyph('a', 'a', 20, 14), glyph('b', 'b', 45, 14), glyph('c', 'c', 20, 31), glyph('d', 'd', 45, 31)] };
const ast = inferMathAst(region), before = structuredClone(region);
assert.equal(ast?.type, 'matrix'); assert.equal(ast.brackets, 'round');
assert.deepEqual(ast.rows.map(row => row.map(cell => cell.sourceId)), [['a', 'b'], ['c', 'd']]);
assert(validateMathEvidence(ast, region));
for (const mutation of [value => value.rows.reverse(), value => value.rows.forEach(row => row.reverse()),
  value => { value.rows[1].pop(); }, value => { value.brackets = 'square'; },
  value => { value.rows = value.rows.map(row => [{ type: 'row', children: row }]); },
  value => { value.rightGlyphIds = value.leftGlyphIds; }]) {
  const changed = structuredClone(ast); mutation(changed); assert(!validateMathEvidence(changed, region));
}
for (const mutate of [value => value.mathGlyphs.pop(), value => { value.mathGlyphs[0].raster = true; },
  value => { value.mathGlyphs[1].rect.y += 8; }, value => { value.reasons.push('partial-text'); }]) {
  const changed = structuredClone(region); mutate(changed); assert.equal(inferMathAst(changed), null);
}
const vector = structuredClone(region); vector.mathGlyphs = vector.mathGlyphs.filter(item => !['b', 'd'].includes(item.id));
vector.mathGlyphs[1].rect.x = 32;
assert.equal(inferMathAst(vector), null, 'an unmarked two-row column must not be guessed instead of a binomial coefficient');
vector.mathGlyphs.filter(item => ['a', 'c'].includes(item.id)).forEach(item => { item.bold = true; });
vector.mathGlyphs.push(glyph('i', 'i', 26.5, 19, 3, 5, 7), glyph('j', 'j', 26.5, 36, 3, 5, 7));
const indexed = inferMathAst(vector);
assert.deepEqual(indexed.rows.map(row => row[0].subscript.sourceId), ['i', 'j']);
const binomial = structuredClone(vector); binomial.mathGlyphs.forEach(item => { item.bold = false; });
assert.equal(inferMathAst(binomial), null);
const suggestedBinomial = structuredClone(indexed);
suggestedBinomial.rows.forEach(row => { row[0].base.bold = false; });
assert(!validateMathEvidence(suggestedBinomial, binomial));
const fraction = structuredClone(vector); fraction.mathGlyphs = fraction.mathGlyphs.filter(item => !['i', 'j'].includes(item.id));
fraction.mathStrokes.push({ id: 'bar', thin: true, rect: { x: 19, y: 26, width: 8, height: .4 } });
assert.equal(inferMathAst(fraction)?.type, 'row', 'a bracketed fraction is not a two-row matrix');
const surrounding = structuredClone(region);
surrounding.mathGlyphs = surrounding.mathGlyphs.filter(item => !['b', 'd'].includes(item.id));
const surroundingText = surrounding.mathGlyphs.map(item => ({ ...item, italic: !item.delimiterPart, type: 'text', sourceIds: [item.id], order: 1 }));
const surroundingSources = surroundingText.map(item => ({ id: item.id, text: item.text, rect: item.rect, disposition: 'editable', order: 1 }));
groupPageRegions(surroundingText, [{ id: 'unknown-rule', sourceIds: [], rect: { x: 19, y: 26, width: 8, height: .4 },
  thin: true, mathGlyph: true, reason: 'unmapped-glyph', order: 2 }], [], surroundingSources);
assert(surroundingSources.filter(item => ['left', 'right'].includes(item.id)).every(item => item.disposition === 'editable'),
  'unverified content inside a bracket pair cannot absorb editable surrounding delimiters through the matrix grouping path');
const components = structuredClone(region);
components.mathGlyphs = components.mathGlyphs.filter(item => !['left', 'right'].includes(item.id));
for (const [side, x, texts] of [['left', 10, ['\uf8eb', '\uf8ec', '\uf8ed']], ['right', 70, ['\uf8f6', '\uf8f7', '\uf8f8']]]) {
  for (const [index, part] of ['top', 'stem', 'bottom'].entries()) components.mathGlyphs.push({
    ...glyph(`${side}-${part}`, texts[index], x + (side === 'right' && part === 'stem' ? 3 : 0), 10 + index * 10, part === 'stem' ? 1 : 4, 10.1),
    font: 'CMEX10', delimiterPart: { kind: 'round', side, part } });
}
assert.equal(matrixDelimiterPairs(components.mathGlyphs).length, 1);
assert.equal(inferMathAst(components)?.leftGlyphIds.length, 3);
const broken = structuredClone(components); broken.mathGlyphs = broken.mathGlyphs.filter(item => item.id !== 'left-stem');
assert.equal(inferMathAst(broken), null, 'disconnected bracket pieces cannot be invented into a complete delimiter');
const request = { schemaVersion: 2, requestId: 'matrix', inputDigest: 'a'.repeat(64), sourceDigest: 'b'.repeat(64), page: 1,
  scopeId: 'matrix', kind: 'math', math: { id: 'matrix', glyphs: region.mathGlyphs, strokes: [] } };
const { kind, math, ...identity } = request;
validateAiScope(JSON.stringify({ ...identity, mathCandidates: [{ id: 'matrix', ast }] }), request);
assert.throws(() => validateAiScope(JSON.stringify({ ...identity, mathCandidates: [{ id: 'matrix', ast: { ...ast, rows: ast.rows.toReversed() } }] }), request));

const text = region.mathGlyphs.map(item => ({ ...item, type: 'text', sourceIds: [item.id], order: 1 }));
const sources = text.map(item => ({ id: item.id, text: item.text, rect: item.rect, disposition: 'editable', order: 1 }));
const grouped = groupPageRegions(text, [], [], sources);
const document = inferDocument([{ number: 1, width: 120, height: 90, characters: 6, sources, ...grouped }], { preserveGeometry: true });
const canvas = createCanvas(128, 64), measurementContext = createCanvas(1, 1).getContext('2d');
const assets = grouped.items.filter(item => item.type === 'image').map(item => ({ id: item.id, bytes: canvas.toBuffer('image/png'), width: 128, height: 64 }));
const fallback = await createWordBytes(document, assets, { preserveGeometry: true, measurementContext });
assert.equal(fallback.quality.nativeFormulas, 0); assert.equal(fallback.quality.imageCharacters, 6);
const output = await createWordBytes(document, assets, { preserveGeometry: true, measurementContext, editableMath: true });
assert.equal(output.quality.nativeFormulas, 1); assert.equal(output.quality.nativeMathCharacters, 6); assert.equal(output.quality.imageCharacters, 0);
const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
const all = value => [value, ...(value.elements || []).flatMap(all)];
const tree = all(xml2js(xml)), matrix = tree.find(node => node.name === 'm:m');
const rows = matrix.elements.filter(node => node.name === 'm:mr');
const cellText = node => all(node).filter(node => node.name === 'm:t').map(node => node.elements?.map(child => child.text || '').join('')).join('').replace(/\s/g, '');
assert.deepEqual(rows.map(row => row.elements.filter(node => node.name === 'm:e').map(cellText)), [['a', 'b'], ['c', 'd']]);
assert.equal(tree.filter(node => node.name === 'pic:pic').length, 0);
assert.deepEqual(region, before, 'matrix interpretation and writing do not rewrite source glyphs');

const run = text => {
  const value = new MathRun({ text, normalText: true, literal: true }), prep = value.prepForXml.bind(value);
  value.prepForXml = context => { const result = prep(context); result['m:r'].splice(1, 0,
    new RunProperties({ size: 20, font: 'Times New Roman' }).prepForXml(context)); return result; }; return value;
};
const native = new MathMatrix({ rows: [...'abcd'].map(text => [[run(text)]]) }).prepForXml({ stack: [] });
const measure = createNativeMathMeasurer(format => ({ width: format.text === ' ' ? .278 : 5,
  height: ['b', 'd'].includes(format.text) ? 6.94 : 4.46, depth: .12 }));
const placement = measure([native], 10, { direct: true }).placement;
const actualWpsDrops = [11.639, 11.761, 11.760];
placement.matrixRows.slice(1).forEach((value, index) => assert(Math.abs(value - placement.matrixRows[index] - actualWpsDrops[index]) < .15));
const properties = native['m:m'].find(item => item['m:mPr'])['m:mPr'];
properties.push({ 'm:rSpRule': { _attr: { 'm:val': 3 } } }, { 'm:rSp': { _attr: { 'm:val': 216 } } });
const exact = measure([native], 10, { direct: true }).placement;
exact.matrixRows.slice(1).forEach((value, index) => assert(Math.abs(value - exact.matrixRows[index] - 10.8) < .001));
properties.at(-1)['m:rSp']._attr['m:val'] = Infinity;
assert.throws(() => measure([native], 10), /matrix spacing/);
console.log('Matrix checks passed: outline evidence, complete delimiters, rows/columns/scripts, AI mutations, actual OMML and independent WPS row spacing.');
