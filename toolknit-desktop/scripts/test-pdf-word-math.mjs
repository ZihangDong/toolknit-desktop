import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { inferMathAst, validateMathAst, validateMathEvidence } from '../src/features/pdf-to-word/core/math.js';
import { nativeMath } from '../src/features/pdf-to-word/adapters/docx-math.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import { createCanvas } from '@napi-rs/canvas';

const glyph = (id, text, x, baseline, size = 12, width = 6) => ({ id, text, rect: { x, y: baseline - size * .75, width, height: size * .75 }, baseline, size, italic: /[a-z]/.test(text), bold: false });
const region = (glyphs, strokes = []) => ({ role: 'math', mathGlyphs: glyphs, mathStrokes: strokes, reasons: [] });
const exponent = region([glyph('x', 'x', 10, 20), glyph('two', '2', 17, 14, 7, 4)]);
assert.equal(inferMathAst(exponent).type, 'script');
assert.equal(inferMathAst(exponent).superscript.text, '2');
const sub = region([glyph('x', 'x', 10, 20), glyph('i', 'i', 17, 25, 7, 4)]);
assert.equal(inferMathAst(sub).subscript.text, 'i');
const both = region([glyph('x', 'x', 10, 20), glyph('i', 'i', 17, 25, 7, 4), glyph('two', '2', 17, 14, 7, 4)]);
assert(inferMathAst(both).subscript && inferMathAst(both).superscript);
const outerPower = region([glyph('vector', 'w', 10, 30, 10, 6), glyph('layer', 'l', 17, 26, 7, 2),
  glyph('index', 'i', 16.8, 32.5, 7, 2), glyph('transpose', '\u22a4', 20.5, 23.6, 7, 5)]);
const outerAst = inferMathAst(outerPower);
assert.equal(outerAst.type, 'script'); assert.equal(outerAst.base.type, 'script');
assert.equal(outerAst.base.superscript.sourceId, 'layer'); assert.equal(outerAst.base.subscript.sourceId, 'index');
assert.equal(outerAst.superscript.sourceId, 'transpose', 'a higher, separate full-size script belongs to the complete indexed base');
const wrongOuter = { ...outerAst.base, superscript: { type: 'row', children: [outerAst.base.superscript, outerAst.superscript] } };
assert(!validateMathAst(wrongOuter, outerPower), 'the outer transpose cannot flatten into the layer index');
const ambiguousOuter = structuredClone(outerPower);
ambiguousOuter.mathGlyphs.at(-1).rect.x = 18.5;
assert.equal(inferMathAst(ambiguousOuter), null, 'overlapping script tiers require review');
const smallerTier = structuredClone(outerPower);
smallerTier.mathGlyphs.at(-1).size = 5;
const innerTier = inferMathAst(smallerTier);
assert.equal(innerTier.base.sourceId, 'vector');
assert.equal(innerTier.superscript.type, 'script');
assert.equal(innerTier.superscript.base.sourceId, 'layer', 'a smaller raised tier belongs within the exponent, not outside the complete base');
assert(!validateMathAst(outerAst, smallerTier), 'nested and outer powers remain different source-bound structures');
for (const [left, close] of [['(', ')'], ['[', ']'], ['{', '}'], ['\u230a', '\u230b'], ['\u2308', '\u2309']]) {
  const grouped = region([glyph('open', left, 10, 30), glyph('x', 'x', 17, 30), glyph('plus', '+', 24, 30),
    glyph('y', 'y', 31, 30), glyph('close', close, 38, 30), glyph('power', '2', 45, 24, 7, 4)]);
  const ast = inferMathAst(grouped);
  assert.equal(ast.type, 'script'); assert.equal(ast.base.type, 'row');
  assert.deepEqual(ast.base.children.map(node => node.sourceId), ['open', 'x', 'plus', 'y', 'close']);
  assert.equal(ast.superscript.sourceId, 'power');
  const wrong = { type: 'row', children: [...ast.base.children.slice(0, -1),
    { type: 'script', base: ast.base.children.at(-1), superscript: ast.superscript }] };
  assert(!validateMathEvidence(wrong, grouped), 'source-complete suggestions cannot attach a power to a bare closing bracket');
  const missing = structuredClone(grouped); missing.mathGlyphs.shift();
  assert.equal(inferMathAst(missing), null, 'a missing opening bracket cannot be invented');
}
const nestedBrackets = region(['(', 'x', '+', '[', 'y', '-', 'z', ']', ')'].map((text, index) => glyph(`n${index}`, text, 10 + index * 7, 30)));
nestedBrackets.mathGlyphs.push(glyph('outer-power', '2', 73, 24, 7, 4));
const nestedAst = inferMathAst(nestedBrackets);
assert.equal(nestedAst.type, 'script');
assert.equal(nestedAst.base.children[3].type, 'row', 'nested bracket groups keep their own scope');
const crossed = structuredClone(nestedBrackets); crossed.mathGlyphs[7].text = ')';
assert.equal(inferMathAst(crossed), null, 'crossed bracket types are not a reliable mathematical structure');
const shallowIndex = region([
  { ...glyph('base', 'x', 10, 20, 8.25), rect: { x: 10, y: 15.53, width: 4.97, height: 3.44 } },
  { ...glyph('first', '1', 16.4, 20.9, 4.66), rect: { x: 16.4, y: 17.07, width: 1.6, height: 3.19 } },
  { ...glyph('second', '2', 18.5, 20.9, 4.66), rect: { x: 18.5, y: 17.07, width: 1.79, height: 3.19 } },
]);
const shallowAst = inferMathAst(shallowIndex);
assert.equal(shallowAst.type, 'script', 'smaller, visibly lowered ink identifies a modest baseline displacement');
assert.deepEqual(shallowAst.subscript.children.map(node => node.sourceId), ['first', 'second'],
  'the first index must not expand the reference ink box used for the next index');
const shallowLetter = structuredClone(shallowIndex);
shallowLetter.mathGlyphs.splice(1, 2, { ...glyph('index', 'n', 16, 20.9, 4.66),
  rect: { x: 16, y: 18.34, width: 2.76, height: 1.98 } });
assert.equal(inferMathAst(shallowLetter).subscript.sourceId, 'index');
const shallowPower = structuredClone(shallowIndex);
shallowPower.mathGlyphs.slice(1).forEach(item => { item.baseline = 19.1; item.rect.y = 14; });
assert.equal(inferMathAst(shallowPower).superscript.type, 'row');
const smallSameLine = structuredClone(shallowIndex);
smallSameLine.mathGlyphs.slice(1).forEach(item => { item.baseline = 20; item.rect.y = 15.7; });
assert.equal(inferMathAst(smallSameLine).type, 'row', 'small font size alone is not subscript evidence');
const minorBaselineDrift = structuredClone(smallSameLine);
minorBaselineDrift.mathGlyphs.slice(1).forEach(item => { item.baseline = 20.9; });
assert.equal(inferMathAst(minorBaselineDrift).type, 'row', 'a small baseline offset without displaced ink remains a row');
const fraction = region([glyph('a', 'a', 13, 14, 9), glyph('b', 'b', 13, 30, 9)], [{ id: 'bar', rect: { x: 10, y: 19.8, width: 12, height: .4 }, thin: true }]);
assert.equal(inferMathAst(fraction).type, 'fraction');
assert.equal(inferMathAst(fraction).numerator.text, 'a');
assert.equal(inferMathAst(fraction).denominator.text, 'b');
const fractionThenInfix = region([glyph('numerator', '1', 13, 14, 9), glyph('denominator', '2', 13, 30, 9),
  glyph('plus', '+', 24, 24, 9), glyph('value', '3', 33, 24, 9)],
[{ id: 'bar', rect: { x: 10, y: 19.8, width: 12, height: .4 }, thin: true }]);
const infixAst = inferMathAst(fractionThenInfix);
assert.equal(infixAst.type, 'row');
assert.deepEqual(infixAst.children.map(item => item.type), ['fraction', 'symbol', 'symbol'],
  'a tall fraction does not turn following full-size infix content into a subscript');
assert.equal(infixAst.children[1].text, '+');
const wrongInfix = { type: 'script', base: infixAst.children[0], subscript: { type: 'row', children: infixAst.children.slice(1) } };
assert(!validateMathAst(wrongInfix, fractionThenInfix), 'source counts cannot legitimize a fraction followed by false subscripts');
const fractionWithIndex = region([glyph('numerator', '1', 13, 14, 9), glyph('denominator', '2', 13, 30, 9),
  glyph('index', 'i', 23, 29, 5, 3), glyph('plus', '+', 33, 24, 9)],
[{ id: 'bar', rect: { x: 10, y: 19.8, width: 12, height: .4 }, thin: true }]);
const indexedAst = inferMathAst(fractionWithIndex);
assert.equal(indexedAst.type, 'row');
assert.equal(indexedAst.children[0].type, 'script');
assert.equal(indexedAst.children[0].base.type, 'fraction');
assert.equal(indexedAst.children[0].subscript.sourceId, 'index', 'a genuine smaller index remains attached to its fraction');
assert.equal(indexedAst.children[1].sourceId, 'plus');
const lowercaseAfterFraction = region([glyph('top', '4', 13, 14, 9), glyph('bottom', '3', 13, 30, 9),
  { ...glyph('letter', 'e', 25, 24, 9), rect: { x: 25, y: 20, width: 4, height: 4 } }],
[{ id: 'bar', rect: { x: 10, y: 19.8, width: 12, height: .4 }, thin: true }]);
const lowercaseAst = inferMathAst(lowercaseAfterFraction);
assert.equal(lowercaseAst.type, 'row');
assert.deepEqual(lowercaseAst.children.map(node => node.type), ['fraction', 'symbol'],
  'a lowercase x-height does not make a same-size baseline letter the fraction subscript');
const fractionExponent = region([glyph('e', 'e', 10, 30, 12), glyph('one', '1', 20, 15, 6, 3), glyph('three', '3', 20, 23, 6, 3)],
[{ id: 'power-bar', rect: { x: 18, y: 17.8, width: 7, height: .4 }, thin: true }]);
const fractionalPower = inferMathAst(fractionExponent);
assert.equal(fractionalPower.type, 'script'); assert.equal(fractionalPower.base.sourceId, 'e');
assert.equal(fractionalPower.superscript.type, 'fraction');
assert.equal(fractionalPower.superscript.numerator.sourceId, 'one');
assert.equal(fractionalPower.superscript.denominator.sourceId, 'three');
const flattenedPower = { type: 'row', children: [fractionalPower.base, fractionalPower.superscript] };
assert(!validateMathAst(flattenedPower, fractionExponent), 'a fractional exponent cannot become a sibling fraction');
const detachedFraction = structuredClone(fractionExponent);
detachedFraction.mathGlyphs.slice(1).forEach(item => { item.rect.x += 30; }); detachedFraction.mathStrokes[0].rect.x += 30;
assert.equal(inferMathAst(detachedFraction), null, 'displaced fractions without a trustworthy base require review');
const mixed = region([...exponent.mathGlyphs, glyph('equals', '=', 26, 20), glyph('one', '1', 38, 20)]);
assert.equal(inferMathAst(mixed).type, 'row');
const mixedMetrics = region([glyph('base', '2', 10, 20), glyph('power', 'a', 17, 16.5, 7, 4),
  { ...glyph('operator', '=', 26, 20, 18), rect: { x: 26, y: 16, width: 9, height: 4 } }, glyph('value', '3', 40, 20)]);
assert.equal(inferMathAst(mixedMetrics).children[0].type, 'script', 'an oversized operator cannot flatten an exponent');
const sameEmScript = region([glyph('base', '2', 10, 20),
  { ...glyph('power', 'a', 17, 16, 12, 4), rect: { x: 17, y: 12, width: 4, height: 4 } }]);
assert.equal(inferMathAst(sameEmScript).type, 'script', 'ink size disambiguates incompatible math font em sizes');
const sameEmItems = sameEmScript.mathGlyphs.map((item, index) => ({ ...item, sourceIds: [item.id], order: index }));
const sameEmSources = sameEmItems.map(item => ({ id: item.id, order: item.order, text: item.text, disposition: 'editable' }));
const sameEmGroup = groupPageRegions(sameEmItems, [], [], sameEmSources);
assert.equal(sameEmGroup.items.length, 1, 'superscripts must stay with their base even across font em conventions');
assert.equal(sameEmGroup.items[0].sourceIds.length, 2);
const groupFixture = values => {
  const items = values.map(([id, text, x, width]) => ({ ...glyph(id, text, x, 20, 12, width), italic: false,
    sourceIds: [id], order: x }));
  const sources = items.map(item => ({ id: item.id, text: item.text, order: item.order, disposition: 'editable' }));
  return { ...groupPageRegions(items, [], [], sources), sources };
};
for (const ellipsis of ['...', '\u2026', '\u22ef']) {
  const grouped = groupFixture([['left', '+', 10, 6], ['dots', ellipsis, 19, 7], ['right', '+', 30, 6]]);
  assert.equal(grouped.items.length, 1, 'continuation dots must not fragment an otherwise continuous formula');
  assert.equal(grouped.items[0].role, 'math');
  assert(inferMathAst(grouped.items[0]), 'visible mathematical ellipses remain valid literal symbols');
  assert.deepEqual(new Set(grouped.items[0].sourceIds), new Set(['left', 'dots', 'right']));
  assert.equal(new Set(grouped.items[0].sourceIds).size, grouped.items[0].sourceIds.length);
}
const proseEllipsis = groupFixture([['left', 'note', 10, 18], ['dots', '...', 30, 7], ['right', 'text', 40, 20]]);
assert(proseEllipsis.sources.every(source => source.disposition === 'editable'), 'prose ellipses remain editable');
const existingMathEllipsis = groupFixture([['left', '1', 10, 6], ['dots', '\u22ef', 19, 7], ['right', '3', 30, 6]]);
assert.equal(existingMathEllipsis.items.length, 1, 'already recognized math ellipses keep their original ownership');
assert.equal(existingMathEllipsis.items[0].role, 'math');
const minusBridge = groupFixture([['left', '+', 10, 6], ['minus', '-', 19, 7], ['right', '+', 30, 6]]);
assert.equal(minusBridge.items.length, 1, 'a visible ASCII minus does not split a mathematical region');
assert(inferMathAst(minusBridge.items[0]), 'ASCII minus is a source-bound symbol as well as a geometric member');
for (const text of ['-', 'non-linear']) {
  const ordinary = groupFixture([['prose', text, 10, 30]]);
  assert.equal(ordinary.sources[0].disposition, 'editable', 'a plain bullet or hyphenated word alone is not math evidence');
}
const leader = groupFixture([['left', '+', 10, 6], ['dots', '...', 19, 7], ['leader', '...', 29, 7], ['score', '17', 42, 12]]);
assert(leader.sources.filter(source => source.id !== 'left').every(source => source.disposition === 'editable'),
  'dot leaders leading to a score are not a mathematical bridge');
const argumentsGroup = groupFixture([['function', 'F', 10, 6], ['open', '(', 17, 3], ['x', 'x', 21, 6],
  ['comma', ',', 28, 2], ['y', 'y', 31, 6], ['close', ')', 38, 3], ['equals', '=', 42, 6], ['zero', '0', 50, 6]]);
assert.equal(argumentsGroup.items.length, 1);
assert.equal(argumentsGroup.items[0].role, 'math', 'a separator enclosed by matching formula brackets is mathematical evidence');
assert(argumentsGroup.items[0].mathGlyphs.some(item => item.id === 'comma'));
const trailingComma = groupFixture([['x', 'x', 10, 6], ['plus', '+', 17, 6], ['y', 'y', 24, 6],
  ['comma', ',', 31, 2], ['prose', 'where', 34, 26]]);
assert.equal(trailingComma.sources.find(item => item.id === 'comma').disposition, 'editable');
assert.equal(trailingComma.sources.find(item => item.id === 'prose').disposition, 'editable');
const proseAfterFormula = groupFixture([['x', 'x', 10, 6], ['plus', '+', 17, 6], ['y', 'y', 24, 6],
  ['words', 'in which', 32, 35], ['symbol', '\u03c3', 69, 6], ['description', 'denotes', 77, 30]]);
for (const id of ['words', 'description']) assert.equal(proseAfterFormula.sources.find(item => item.id === id).disposition, 'editable',
  'ordinary English words cannot bridge otherwise separate formulas');
const namedFunction = groupFixture([['name', 'sin', 10, 15], ['open', '(', 26, 3], ['x', 'x', 30, 6],
  ['close', ')', 37, 3], ['equals', '=', 42, 6], ['zero', '0', 50, 6]]);
assert.equal(namedFunction.items.length, 1); assert.equal(namedFunction.items[0].role, 'math');
const floorNotation = groupFixture([['floor', '\u230a\u00b7\u230b', 10, 16]]);
assert.equal(floorNotation.items[0].role, 'math');
assert.equal(inferMathAst(floorNotation.items[0]).text, '\u230a\u00b7\u230b');
const indexedRelation = [glyph('a', 'a', 10, 30, 10, 5), glyph('i', 'i', 16, 32.5, 7, 2),
  glyph('l', 'l', 16.2, 26, 7, 2), glyph('equal', '=', 22.3, 30, 10, 6), glyph('h', 'h', 32, 30, 10, 5),
  glyph('j', 'j', 38, 32.5, 7, 2), glyph('m', 'm', 38.2, 26, 7, 2)];
const groupItems = items => groupPageRegions(items.map((item, order) => ({ ...item, order, sourceIds: [item.id] })), [], [],
  items.map((item, order) => ({ id: item.id, text: item.text, order, disposition: 'editable' })));
const indexedRelationGroup = groupItems(indexedRelation);
assert.equal(indexedRelationGroup.items.length, 1, 'indices cannot move a group baseline away from the relation');
assert.equal(indexedRelationGroup.items[0].sourceIds.length, 7);
assert(inferMathAst(indexedRelationGroup.items[0]));
const labelledIndex = [glyph('p', 'p', 10, 30, 10, 5), { ...glyph('label', 'train', 15.5, 31.6, 7, 12), italic: false },
  glyph('open', '(', 29, 30, 10, 3), glyph('x', 'x', 33, 30, 10, 5), glyph('close', ')', 39, 30, 10, 3)];
const labelledGroup = groupItems(labelledIndex);
assert.equal(labelledGroup.items.length, 1, 'a geometrically attached named index preserves the complete formula');
assert.equal(labelledGroup.items[0].role, 'math');
for (const change of [label => { label.size = 10; }, label => { label.baseline = 30; },
  label => { label.rect.x = 50; }, label => { label.text = 'ordinary prose'; }]) {
  const separate = structuredClone(labelledIndex); change(separate[1]);
  const output = groupItems(separate);
  assert(output.items.some(item => item.type === 'text' && item.id === 'label'),
    'ordinary adjacent words without a unique small lowered attachment remain editable');
}
for (const barrier of [glyph('prose', 'where', 19, 30, 10, 3), glyph('option', 'B.', 19, 30, 10, 3)]) {
  const separated = groupItems([...indexedRelation, barrier]);
  assert(!separated.items.some(item => item.sourceIds?.includes('a') && item.sourceIds?.includes('equal')),
    'a prose/option boundary prevents merging even when mathematical baselines match');
}
const nextLine = groupItems([...indexedRelation, ...indexedRelation.map(item => ({ ...item, id: item.id + '-next',
  rect: { ...item.rect, y: item.rect.y + 25 }, baseline: item.baseline + 25 }))]);
assert.equal(nextLine.items.length, 2, 'complete formula grouping cannot cross to the next text line');
for (const original of [exponent, sub, both, fraction, mixed]) {
  const ast = inferMathAst(original); assert(ast); assert(validateMathAst(ast, original));
  const unknown = structuredClone(ast); unknown.xml = '<unsafe/>';
  assert(!validateMathAst(unknown, original));
  const invalid = structuredClone(original); invalid.mathGlyphs[0].text = '\uFFFD';
  assert.equal(inferMathAst(invalid), null);
  const obscured = structuredClone(original); obscured.mathGlyphs[0].raster = true;
  assert.equal(inferMathAst(obscured), null, 'partial or uncertain glyphs are never promoted');
}
const swapped = inferMathAst(fraction); [swapped.numerator, swapped.denominator] = [swapped.denominator, swapped.numerator];
assert(!validateMathAst(swapped, fraction), 'symbol counts alone do not permit reversing a fraction');
const wrongScript = inferMathAst(exponent); wrongScript.subscript = wrongScript.superscript; delete wrongScript.superscript;
assert(!validateMathAst(wrongScript, exponent), 'source-bound suggestions cannot turn an exponent into a subscript');
const ambiguous = region([glyph('x', 'x', 10, 20), glyph('i', 'i', 60, 14, 7)]);
assert.equal(inferMathAst(ambiguous), null);
const blankSymbol = structuredClone(fraction); blankSymbol.mathStrokes[0].unmapped = true;
assert.equal(inferMathAst(blankSymbol), null);
for (let n = 0; n < 200; n++) {
  const variant = structuredClone(n % 2 ? exponent : fraction), scale = .6 + n / 200;
  for (const item of [...variant.mathGlyphs, ...variant.mathStrokes]) {
    item.rect = { x: item.rect.x * scale + n, y: item.rect.y * scale + n, width: item.rect.width * scale, height: item.rect.height * scale };
    if ('baseline' in item) { item.baseline = item.baseline * scale + n; item.size *= scale; }
  }
  assert(inferMathAst(variant), `translation/size invariance ${n}`);
}
const output = 'tmp/pdf-word-math/native-math'; await mkdir(output, { recursive: true });
const samples = [exponent, sub, both, fraction, mixed];
const doc = new Document({ sections: [{ children: samples.map((sample, index) => new Paragraph({
  children: [new TextRun({ text: `${index + 1}. `, size: 24 }), nativeMath(inferMathAst(sample), sample)], run: { size: 24 }, spacing: { after: 240 },
})) }] });
const bytes = await Packer.toBuffer(doc); await writeFile(`${output}/basic.docx`, bytes);
const zip = await JSZip.loadAsync(bytes), xml = await zip.file('word/document.xml').async('string');
assert.equal((xml.match(/<m:oMath>/g) || []).length, 5);
for (const tag of ['m:f', 'm:sSup', 'm:sSub', 'm:sSubSup']) assert(xml.includes(`<${tag}>`));
assert(!xml.includes('<w:drawing>'), 'native formulas are OMML rather than images');
const descendants = node => [node, ...(node.elements || []).flatMap(descendants)];
const mathRuns = descendants(xml2js(xml)).filter(node => node.name === 'm:r');
assert(mathRuns.length > 0);
for (const run of mathRuns) {
  assert(run.elements.some(node => node.name === 'w:rPr'), 'equations must not inherit the document default size');
  const size = descendants(run).find(node => node.name === 'w:sz');
  assert(['18', '24'].includes(size?.attributes['w:val']));
}
const measured = structuredClone(exponent);
measured.rect = { x: 10, y: 8.75, width: 11, height: 11.25 };
measured.mathGlyphs.forEach(item => { item.font = 'Times-Roman'; });
const native = nativeMath(inferMathAst(measured), measured, { measurementContext: createCanvas(1, 1).getContext('2d') });
assert.equal(native.sourceLayout.font, 'Times New Roman');
assert(Number.isFinite(native.sourceLayout.baselineOffset) && native.sourceLayout.height > 0);
const measuredDoc = new Document({ sections: [{ children: [new Paragraph({ children: [native] })] }] });
const measuredXml = await (await JSZip.loadAsync(await Packer.toBuffer(measuredDoc))).file('word/document.xml').async('string');
assert(measuredXml.includes('<m:nor'), 'source-font runs retain literal text instead of mathematical alphabet substitution');
assert(measuredXml.includes('<m:ctrlPr>'), 'structure size is explicit as well as run size');
assert(measuredXml.includes('Times New Roman'));
assert.equal((measuredXml.match(/<m:sSupPr>/g) || []).length, 1, 'empty library properties are extended without duplicating the property container');
const measuredRuns = descendants(xml2js(measuredXml, { captureSpacesBetweenElements: true })).filter(node => node.name === 'm:r');
const context = createCanvas(1, 1).getContext('2d');
let basePointSize;
for (const [index, source] of measured.mathGlyphs.entries()) {
  const run = measuredRuns.find(node => descendants(node).some(child => child.name === 'm:t'
    && child.elements?.some(text => text.type === 'text' && text.text === source.text)));
  const properties = descendants(run), value = key => Number(properties.find(node => node.name === key)?.attributes?.['w:val'] || 0);
  context.font = `${source.italic ? 'italic ' : ''}1000px "Times New Roman"`; context.fontKerning = 'none';
  const metrics = context.measureText(source.text);
  const size = Math.round(source.rect.height * 2000 / (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent)) / 2;
  if (index === 0) basePointSize = size;
  const levelScale = index === 0 ? 1 : .73, serialized = Math.ceil(size * 2 / levelScale);
  assert.equal(value('w:sz'), serialized, 'script size uses the default math font table and integer half-points');
  const effective = index === 0 ? serialized / 2 : Math.floor(serialized * levelScale) / 2;
  // A reader raises this simple superscript by Cambria's 750/2048 em before
  // applying w:position. The combined placement must recover the source ink.
  const naturalBaseline = native.sourceLayout.baseline - (index === 0 ? 0 : basePointSize * 750 / 2048);
  const inkTop = naturalBaseline - value('w:position') / 2 - metrics.actualBoundingBoxAscent / 1000 * effective;
  assert(Math.abs(inkTop - source.rect.y) <= .251, 'natural script shift and serialized position recover the source within half-point rounding');
  const baseScale = Math.max(25, Math.min(400, Math.round(source.rect.width * 100000 / ((metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight) * size))));
  assert.equal(value('w:w'), Math.max(25, Math.min(400, Math.round(baseScale * size / effective))),
    'horizontal measurement compensates the actual emitted script size');
}
const measuredInfix = structuredClone(fractionThenInfix);
measuredInfix.rect = { x: 10, y: 7.25, width: 29, height: 22.75 };
measuredInfix.mathGlyphs.forEach(item => { item.font = 'Times-Roman'; });
const nativeInfix = nativeMath(inferMathAst(measuredInfix), measuredInfix, { measurementContext: createCanvas(1, 1).getContext('2d') });
assert.equal(nativeInfix.sourceLayout.x, measuredInfix.rect.x,
  'a formula beginning with a fraction starts at the fraction boundary, not the first following baseline symbol');
const infixDoc = new Document({ sections: [{ children: [new Paragraph({ children: [nativeInfix] })] }] });
const infixXml = await (await JSZip.loadAsync(await Packer.toBuffer(infixDoc))).file('word/document.xml').async('string');
assert(infixXml.includes('<m:fPr>') && !infixXml.includes('<m:sSub>'), 'full-size infix operators remain siblings of the fraction');
const differentBaselines = region([glyph('open', '(', 10, 18.6, 10, 4), glyph('value', 'x', 16, 20, 10, 6),
  glyph('close', ')', 24, 20, 10, 4)]);
differentBaselines.rect = { x: 10, y: 11.1, width: 18, height: 8.9 };
differentBaselines.mathGlyphs.forEach(item => { item.font = 'Times-Roman'; });
const rowMath = nativeMath(inferMathAst(differentBaselines), differentBaselines, { measurementContext: context });
const rowXml = await (await JSZip.loadAsync(await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [rowMath] })] }] })))).file('word/document.xml').async('string');
const rowRuns = descendants(xml2js(rowXml)).filter(node => node.name === 'm:r');
const openRun = rowRuns.find(run => descendants(run).some(node => node.name === 'm:t' && node.elements?.some(text => text.text === '(')));
const properties = descendants(openRun), emittedSize = Number(properties.find(node => node.name === 'w:sz').attributes['w:val']) / 2;
context.font = '1000px "Times New Roman"'; context.fontKerning = 'none';
const openInk = context.measureText('(');
const expectedRise = Math.round((20 - differentBaselines.mathGlyphs[0].rect.y - openInk.actualBoundingBoxAscent / 1000 * emittedSize) * 2);
assert.equal(Number(properties.find(node => node.name === 'w:position').attributes['w:val']), expectedRise,
  'a different source font baseline is compensated relative to its row, not merely its own glyph');
assert(rowMath.sourceLayout.baselineOffset >= rowMath.sourceLayout.baseline - differentBaselines.rect.y,
  'positioned math reserves the full source ascent after per-run baseline compensation');
assert(rowMath.sourceLayout.height >= differentBaselines.rect.height);
const spacedIndex = region([glyph('base', 'x', 10, 20), glyph('index', '2', 20.5, 25, 7, 4)]);
spacedIndex.rect = { x: 10, y: 11, width: 14.5, height: 14 };
spacedIndex.mathGlyphs.forEach(item => { item.font = 'Times-Roman'; });
const spacedFormula = nativeMath(inferMathAst(spacedIndex), spacedIndex, { measurementContext: context });
const spacedXml = await (await JSZip.loadAsync(await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [spacedFormula] })] }] })))).file('word/document.xml').async('string');
const subscriptNode = descendants(xml2js(spacedXml, { captureSpacesBetweenElements: true })).find(node => node.name === 'm:sub');
assert.equal(descendants(subscriptNode).find(node => node.name === 'm:t').elements[0].text, ' ',
  'the source gap before a script is emitted inside its argument, not lost to automatic kerning');
console.log('Math candidates passed: source-bound fraction/scripts, ambiguity fallback, semantic mutation rejection, 200 geometry perturbations (not an independent corpus), actual OMML.');
