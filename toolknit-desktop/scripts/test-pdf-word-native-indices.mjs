import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { planNativeMathRuns, nativeMathRunParts, hasCompoundNativeMathRun } from '../src/features/pdf-to-word/core/math-limit-runs.js';
import { inferMathAst, validateMathAst, validateMathEvidence } from '../src/features/pdf-to-word/core/math.js';
import { nativeMathReaderMode } from '../src/features/pdf-to-word/core/native-math-policy.js';
import { sourceMathAccent, sourceAccentNeighbor, attachSourceMathAccents } from '../src/features/pdf-to-word/core/math-accents.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import { union } from '../src/features/pdf-to-word/core/geometry.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { mathWordFont } from '../src/features/pdf-to-word/adapters/docx-fonts.js';
import { nativeMath } from '../src/features/pdf-to-word/adapters/docx-math.js';
import { createNativeMathMeasurer } from '../src/features/pdf-to-word/core/native-math-layout.js';

// Source-sized native TeX geometry, with a compound comparison and an indexed
// variable under a narrow hat. Expected roles are written independently here.
const g = (id, text, font, x, y, width, height, size = 11, baseline = 50) => ({ id, sourceIds: [id], text,
  font: 'ABCDEF+' + font, rect: { x, y, width, height }, size, baseline, preciseInk: true, raster: false,
  italic: font.startsWith('CMMI'), bold: false, color: '000000', order: 0 });
const hat = g('hat', 'ˆ', 'CMR10', 45.3, 42.3, 2.9, 1.68);
const s = g('s', 's', 'CMMI10', 40, 45, 4, 5);
const index = g('index', 'i,j', 'CMMI8', 44.8, 46.35, 8.3, 6.9, 8, 51.64);
const compare = g('compare', '> s', 'CMMI10', 59.15, 43.93, 16.25, 6.33);
const nullIndex = g('null', 'null', 'CMTT8', 76, 46.7, 16.38, 4.91, 8, 51.64);
const plus = g('plus', '+', 'CMR10', 97, 43.6, 7.25, 7.26);
const tau = g('tau', 'τ', 'CMMI10', 108, 45.3, 5.28, 4.83);
const position = (text, sourceOffset, rect, baseline) => ({ text, sourceOffset, rect, baseline, baselineX: rect.x,
  advanceWidth: rect.width });
index.mathGlyphPositions = [position('i', 0, { x: 44.8, y: 46.35, width: 2.28, height: 5.35 }, 51.64),
  position(',', 1, { x: 48.2, y: 50.8, width: .98, height: 2.42 }, 51.64),
  position('j', 2, { x: 49.7, y: 46.35, width: 3.4, height: 6.9 }, 51.64)];
compare.mathGlyphPositions = [position('>', 0, { x: 59.15, y: 43.93, width: 6.67, height: 6.33 }, 50),
  position('s', 2, { x: 71.38, y: 45, width: 4.02, height: 4.94 }, 50)];
const glyphs = [hat, s, index, compare, nullIndex, plus, tau];
const region = { id: 'indexed', type: 'image', role: 'math', mathGlyphs: glyphs, mathStrokes: [],
  sourceIds: glyphs.map(g => g.id), rect: union(glyphs.map(g => g.rect)), reasons: [], size: 11, baseline: 50 };
const original = structuredClone(region), plan = planNativeMathRuns(region);
assert(plan);
const tree = n => [n, ...Object.values(n).filter(v => v && typeof v === 'object').flatMap(v => Array.isArray(v) ? v.flatMap(tree) : tree(v))];
const accent = tree(plan.ast).find(n => n.type === 'accent');
assert.equal(accent.sourceId, 'hat'); assert.equal(accent.base.type, 'script');
assert.equal(accent.base.base.sourceId, 's');
assert.deepEqual(accent.base.subscript.children.map(n => n.text), ['i', ',', 'j']);
// A hatted expression can coexist with matrix rows and delimiter/root source
// arrays. Rewriting the marked node must preserve all nested array shapes.
const siblingMatrix = { type: 'matrix', brackets: 'round', leftGlyphIds: ['left-cap', 'left-hook'],
  rightGlyphIds: ['right-cap', 'right-hook'], rows: [
    [{ type: 'symbol', sourceId: 'm-a', text: 'a' }],
    [{ type: 'symbol', sourceId: 'm-b', text: 'b' }],
  ] };
const siblingRoot = { type: 'radical', strokeIds: ['root-bar'], glyphIds: ['root-sign'],
  radicand: { type: 'symbol', sourceId: 'root-x', text: 'x' } };
const untouchedTree = { type: 'row', children: [siblingMatrix, siblingRoot, structuredClone(accent.base)] };
const untouchedBefore = structuredClone(untouchedTree);
const markedTree = attachSourceMathAccents(untouchedTree, [hat], new Map(plan.region.mathGlyphs.map(g => [g.id, g])));
assert.deepEqual(markedTree.children.slice(0, 2), untouchedBefore.children.slice(0, 2));
assert(Array.isArray(markedTree.children[0].rows[0]));
assert(markedTree.children[0].leftGlyphIds.every(id => typeof id === 'string'));
assert.equal(markedTree.children[2].type, 'accent');
assert.deepEqual(untouchedTree, untouchedBefore, 'recursive replacement preserves source trees');
const named = tree(plan.ast).find(n => n.type === 'script' && n.subscript?.text === 'null');
assert.equal(named.base.sourceId, 'compare:math-part:2');
assert.equal(nativeMathReaderMode(plan.ast, plan.region), 'script');
assert(validateMathAst(plan.ast, plan.region)); assert.deepEqual(region, original);
assert.equal(nativeMathRunParts(compare).at(-1).text, 's');
for (const text of ['ordinary word', 'null', 'CMMI', 's'.repeat(33)]) assert(!hasCompoundNativeMathRun(text, 'CMMI10'));
assert(hasCompoundNativeMathRun('i,j', 'CMMI8'));
for (const change of [v => { v.raster = true; }, v => { v.preciseInk = false; }, v => { v.mathGlyphPositions[1].sourceOffset = 1; },
  v => { v.mathGlyphPositions[1].baselineX = -50; }, v => { v.mathGlyphPositions[1].rect.x = 1000; }]) {
  const bad = structuredClone(compare); change(bad); assert.equal(nativeMathRunParts(bad), null);
}
assert(sourceMathAccent(hat)); assert(sourceAccentNeighbor(hat, s));
assert(!sourceAccentNeighbor(hat, { ...s, baseline: s.baseline - 13.5 }), 'an accent cannot bridge the preceding formula line');
for (const change of [v => { v.text = '^'; }, v => { v.font = 'Unknown'; }, v => { v.raster = true; },
  v => { v.preciseInk = false; }, v => { v.bold = true; }, v => { v.rect.height = 8; }]) {
  const bad = structuredClone(hat); change(bad); assert(!sourceMathAccent(bad));
}
for (const change of [
  v => { v.mathGlyphs.find(g => g.id === 'null').font = 'Unknown'; },
  v => { v.mathGlyphs.find(g => g.id === 'null').italic = true; },
  v => { v.backgroundPaintIndexes = [0]; }, v => { v.sourceIds.push('uncovered'); },
  v => { v.mathGlyphs.find(g => g.id === 's').raster = true; }
]) {
  const bad = structuredClone(plan.region); change(bad); assert.equal(nativeMathReaderMode(plan.ast, bad), null);
}
const wrong = structuredClone(plan.ast), wrongAccent = tree(wrong).find(n => n.type === 'accent');
const detached = wrongAccent.base.subscript; wrongAccent.base = wrongAccent.base.base;
wrong.children.push(...detached.children);
assert(!validateMathEvidence(wrong, plan.region), 'all source ids cannot legitimize a hat applied to only the wrong base');
const cyclic = { type: 'accent', sourceId: 'hat', text: 'ˆ' }; cyclic.base = cyclic;
assert(!validateMathAst(cyclic, plan.region)); assert.equal(nativeMathReaderMode(cyclic, plan.region), null);
const sources = glyphs.map(g => ({ id: g.id, text: g.text, rect: g.rect, disposition: 'editable' }));
const grouped = groupPageRegions(glyphs, [], [], structuredClone(sources), { bounds: { x: 0, y: 0, width: 200, height: 120 } });
const actual = grouped.items.find(x => x.sourceIds?.includes('null'));
assert.equal(actual.role, 'math'); assert(actual.sourceIds.includes('hat'));
const actualPlan = planNativeMathRuns(actual);
assert(actualPlan && tree(actualPlan.ast).some(n => n.type === 'accent'), 'source label, glyph trace, grouping and full-tree ownership agree');
const scene = { number: 1, width: 200, height: 120, items: [region], sources: sources.map(g => ({ ...g, disposition: 'visible-image' })), rules: [], risks: ['math-image'], characters: 15 };
const document = inferDocument([scene], { preserveGeometry: true }), before = structuredClone(document);
const context = createCanvas(1, 1).getContext('2d');
const output = await createWordBytes(document, [{ id: region.id, width: 160, height: 24, bytes: createCanvas(160, 24).toBuffer('image/png') }],
  { preserveGeometry: true, editableMath: true, strictMathGeometry: true, measurementContext: context });
assert.equal(output.quality.nativeFormulas, 1); assert.deepEqual(document, before);
const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
assert.equal((xml.match(/<m:acc>/g) || []).length, 1);
assert.match(xml, /<m:acc>[\s\S]*?<m:e><m:sSub>/);
assert.match(xml, /w:ascii="Courier New"/); assert.match(xml, /<m:t>null<\/m:t>/);
assert.equal(mathWordFont(nullIndex), 'Courier New');
assert.notEqual(mathWordFont({ ...nullIndex, font: 'UnverifiedTypewriter' }), 'Courier New');
assert.throws(() => nativeMath(plan.ast, plan.region), /./, 'an unmeasured accent is never emitted');
const native = nativeMath(plan.ast, plan.region, { measurementContext: context });
const crowded = structuredClone(plan.region);
crowded.mathGlyphs.find(g => g.id === 'compare:math-part:0').rect.x = index.rect.x + index.rect.width + .1;
assert.throws(() => nativeMath(plan.ast, crowded, { measurementContext: context }), /following source gap/,
  'source-derived padding cannot shift the next symbol into occupied space');
const serialized = native.prepForXml({ stack: [] })['m:oMath'];
const measure = createNativeMathMeasurer(f => ({ width: f.text.length * f.size * .6 + f.spacing * f.text.length, height: f.size * .7, depth: f.size * .2 }));
assert(measure(serialized, 10).width > 0);
const alterHat = value => { for (const item of value || []) if (item && typeof item === 'object') for (const [key, own] of Object.entries(item)) {
  if (key === 'm:chr') own._attr['m:val'] = '\u0302'; else if (Array.isArray(own)) alterHat(own);
} };
const stretched = structuredClone(serialized); alterHat(stretched);
assert.throws(() => measure(stretched, 10), /Unsupported accent/);

// A complete definition has a hatted indexed variable AND a source typewriter
// max with a right-side condition. The condition is not a centered lower limit.
const maxGlyphs = [structuredClone(hat), structuredClone(s), structuredClone(index),
  g('equals', '=', 'NimbusRomNo9L-Regu', 57.67, 45.67, 5.5, 2.9),
  g('maximum', 'max', 'CMTT10', 66.64, 45.23, 16.91, 4.8),
  g('max-j', 'j', 'CMMI8', 83.75, 46.36, 3.4, 6.9, 8, 51.64),
  g('max-ge', '≥', 'CMSY8', 88.45, 46.85, 5.17, 5.98, 8, 51.64),
  g('max-i', 'i', 'CMMI8', 94.57, 46.36, 2.29, 5.35, 8, 51.64),
  g('S', 'S', 'CMMI10', 98.28, 42.53, 6.47, 7.59),
  g('dot1', '·', 'CMSY10', 105.97, 46.85, 1.16, 1.16),
  g('T1', 'T', 'CMMI10', 108.33, 42.53, 7.42, 7.47),
  g('T1-i', 'i', 'CMMI8', 114.68, 46.36, 2.29, 5.35, 8, 51.64),
  g('add', '+', 'CMR10', 121.19, 43.1, 7.26, 7.26),
  g('E', 'E', 'CMMI10', 132.24, 42.53, 7.92, 7.47),
  g('dot2', '·', 'CMSY10', 141.45, 46.85, 1.16, 1.16),
  g('T2', 'T', 'CMMI10', 143.8, 42.53, 7.42, 7.47),
  g('T2-j', 'j', 'CMMI8', 149.8, 46.36, 3.4, 6.9, 8, 51.64)];
const definition = { id: 'definition', type: 'image', role: 'math', mathGlyphs: maxGlyphs,
  mathStrokes: [], drawingIds: [], reasons: [], sourceIds: maxGlyphs.map(glyph => glyph.id),
  rect: union(maxGlyphs.map(glyph => glyph.rect)), size: 11, baseline: 50 };
const definitionPlan = planNativeMathRuns(definition);
assert(definitionPlan);
const maxScript = tree(definitionPlan.ast).find(node => node.type === 'script' && node.base?.text === 'max');
assert(maxScript && !maxScript.superscript);
assert.deepEqual(maxScript.subscript.children.map(node => node.text), ['j', '≥', 'i']);
assert.equal(tree(definitionPlan.ast).filter(node => node.type === 'limit').length, 0);
assert.equal(nativeMathReaderMode(definitionPlan.ast, definitionPlan.region), 'script', 'a complete native hatted max definition is editable');
assert(validateMathEvidence(definitionPlan.ast, definitionPlan.region));
for (const change of [
  region => { region.mathGlyphs.find(glyph => glyph.id === 'maximum').font = 'UnverifiedTypewriter'; },
  region => { region.mathGlyphs.find(glyph => glyph.id === 'maximum').italic = true; },
  region => { region.mathGlyphs.find(glyph => glyph.id === 'equals').font = 'UnverifiedRoman'; },
  region => { region.mathGlyphs.find(glyph => glyph.id === 'equals').italic = true; },
  region => { region.mathGlyphs.find(glyph => glyph.id === 'equals').baseline += 1; },
  region => { region.mathGlyphs.find(glyph => glyph.id === 'max-j').rect.x -= 15; },
  region => { region.mathGlyphs.find(glyph => glyph.id === 'max-j').rect.x += 20; },
  region => { region.mathGlyphs.find(glyph => glyph.id === 'max-i').baseline += 1; },
  region => { region.mathGlyphs.find(glyph => glyph.id === 'max-i').size += 1; },
  region => { region.mathGlyphs.find(glyph => glyph.id === 'max-ge').rect.x -= 8; },
  region => { region.mathGlyphs.find(glyph => glyph.id === 'max-j').raster = true; },
  region => { region.mathGlyphs.find(glyph => glyph.id === 'max-ge').mathStyleUncertain = true; },
  region => { region.drawingIds = ['extra-stroke']; },
]) {
  const rejected = structuredClone(definitionPlan.region); change(rejected);
  assert.equal(nativeMathReaderMode(definitionPlan.ast, rejected), null, 'the whole side-index condition requires verified style and physical order');
}
for (const change of [
  script => { script.superscript = script.subscript; delete script.subscript; },
  script => { script.subscript.children.reverse(); },
  script => { script.subscript.children.push(script.subscript.children[0]); },
  script => { script.base.text = 'min'; },
]) {
  const wrong = structuredClone(definitionPlan.ast);
  change(tree(wrong).find(node => node.type === 'script' && node.base?.text === 'max'));
  assert.equal(nativeMathReaderMode(wrong, definitionPlan.region), null, 'complete source ids cannot legitimize a different side-index relationship');
}
const definitionScene = { number: 1, width: 200, height: 120, items: [definition], rules: [], risks: ['math-image'],
  sources: maxGlyphs.map(glyph => ({ id: glyph.id, text: glyph.text, rect: { ...glyph.rect }, disposition: 'visible-image' })), characters: 21 };
const definitionDocument = inferDocument([definitionScene], { preserveGeometry: true }), beforeDefinition = structuredClone(definitionDocument);
const definitionOutput = await createWordBytes(definitionDocument, [{ id: definition.id, bytes: createCanvas(1, 1).toBuffer('image/png') }],
  { preserveGeometry: true, editableMath: true, strictMathGeometry: true, measurementContext: context });
assert.equal(definitionOutput.quality.nativeFormulas, 1);
const definitionXml = await (await JSZip.loadAsync(definitionOutput.bytes)).file('word/document.xml').async('string');
assert.equal((definitionXml.match(/<m:acc>/g) || []).length, 1);
assert.equal((definitionXml.match(/<m:sSub>/g) || []).length, 4);
assert(!definitionXml.includes('<m:limLow>') && !definitionXml.includes('<w:drawing'));
assert.match(definitionXml, /<m:sSub>[\s\S]*?<m:t>max<\/m:t>[\s\S]*?<m:sub>/);
assert(definitionXml.includes('w:ascii="Courier New"'));
assert.deepEqual(definitionDocument, beforeDefinition, 'the complete formula never rewrites its source ledger');
console.log('Native hatted definition: full-base accent, right-side max condition, preserved-source counterexamples and actual editable DOCX passed.');

// A complete sum of native indexed products may exceed the generic eight-glyph
// script gate, while still having only two simple first-level subscripts.
const productGlyphs = structuredClone(maxGlyphs.slice(8));
const productRegion = { id: 'indexed-products', type: 'image', role: 'math', mathGlyphs: productGlyphs,
  sourceIds: productGlyphs.map(glyph => glyph.id), mathStrokes: [], drawingIds: [], reasons: [],
  rect: union(productGlyphs.map(glyph => glyph.rect)), size: 11, baseline: 50 };
const productAst = inferMathAst(productRegion);
assert(productAst && productAst.children.length === 7);
assert.equal(nativeMathReaderMode(productAst, productRegion), 'script', 'a complete source-proven indexed sum remains editable beyond eight glyphs');
assert.deepEqual(productAst.children.map(node => node.type === 'script'
  ? [node.base.text, node.subscript.text] : node.text), ['S', '·', ['T', 'i'], '+', 'E', '·', ['T', 'j']]);
for (const change of [
  r => { r.mathGlyphs.find(glyph => glyph.id === 'T1-i').baseline = 50; },
  r => { r.mathGlyphs.find(glyph => glyph.id === 'T1-i').baseline = 43; },
  r => { r.mathGlyphs.find(glyph => glyph.id === 'T1-i').size = 11; },
  r => { r.mathGlyphs.find(glyph => glyph.id === 'T1-i').rect.x = 134; },
  r => { r.mathGlyphs.find(glyph => glyph.id === 'T1').font = 'Unknown'; },
  r => { r.mathGlyphs.find(glyph => glyph.id === 'T1').italic = false; },
  r => { r.mathGlyphs.find(glyph => glyph.id === 'T1').rect.width = 0; },
  r => { r.mathGlyphs.find(glyph => glyph.id === 'E').baseline += 1; },
  r => { r.mathGlyphs.find(glyph => glyph.id === 'E').size += 1; },
  r => { r.mathGlyphs.find(glyph => glyph.id === 'E').rect.x = 170; },
  r => { r.mathGlyphs.find(glyph => glyph.id === 'dot1').italic = true; },
  r => { r.mathGlyphs.find(glyph => glyph.id === 'dot1').raster = true; },
  r => { r.mathGlyphs.find(glyph => glyph.id === 'dot1').ocr = true; },
  r => { r.mathGlyphs.find(glyph => glyph.id === 'T2-j').color = 'ff0000'; },
  r => { r.mathGlyphs.find(glyph => glyph.id === 'T2-j').mathStyleUncertain = true; },
  r => { r.sourceIds.push('uncovered'); }, r => { r.sourceIds.push(r.sourceIds[0]); },
  r => { r.mathStrokes.push({ id: 'stroke' }); }, r => { r.backgroundPaintIndexes = [0]; },
]) {
  const bad = structuredClone(productRegion); change(bad);
  assert.equal(nativeMathReaderMode(productAst, bad), null, 'indexed products require complete native geometry, real index owners and exact style');
}
for (const change of [
  ast => { ast.children[2].superscript = ast.children[2].subscript; delete ast.children[2].subscript; },
  ast => { [ast.children[2].subscript, ast.children[6].subscript] = [ast.children[6].subscript, ast.children[2].subscript]; },
  ast => { [ast.children[2], ast.children[6]] = [ast.children[6], ast.children[2]]; },
  ast => { ast.children[1].text = '/'; }, ast => { ast.children[3].text = '='; },
  ast => { ast.children.push(ast); },
]) {
  const bad = structuredClone(productAst); change(bad);
  assert.equal(nativeMathReaderMode(bad, productRegion), null, 'preserved source ids cannot authorize another structure or script owner');
}
const productScene = { number: 1, width: 200, height: 120, items: [productRegion], rules: [], risks: ['math-image'],
  sources: productGlyphs.map(glyph => ({ id: glyph.id, text: glyph.text, rect: { ...glyph.rect }, disposition: 'visible-image' })), characters: 9 };
const productDocument = inferDocument([productScene], { preserveGeometry: true });
const productOutput = await createWordBytes(productDocument, [{ id: productRegion.id, bytes: createCanvas(1, 1).toBuffer('image/png') }],
  { preserveGeometry: true, editableMath: true, strictMathGeometry: true, measurementContext: context });
const productXml = await (await JSZip.loadAsync(productOutput.bytes)).file('word/document.xml').async('string');
assert.equal(productOutput.quality.nativeFormulas, 1);
assert.equal((productXml.match(/<m:sSub>/g) || []).length, 2);
assert(!productXml.includes('<w:drawing'));
console.log('Native indexed products: whole arithmetic row, source roles/geometry, wrong-owner/cycle refusals and actual editable OMML passed.');
console.log('Native indexed math: complete glyph offsets, named-index ownership, full-base hats, mutation refusals, real OMML, measured context and immutable source contracts passed.');

// A known upright text face can name a lower index. Its unique source owner
// and physical role are required independently of an otherwise valid AST.
const serifFixture = (label = 'model') => {
  const base = g('serif-base', 'd', 'CMMI10', 40, 42.5, 5.7, 7.5, 11, 50);
  const lower = g('serif-index', label, 'NimbusRomNo9L-Regu', 46, 47.5, 14, 5.2, 8, 52);
  const value = { id: 'serif-indices', type: 'image', role: 'math', rect: union([base.rect, lower.rect]),
    mathGlyphs: [base, lower], sourceIds: [base.id, lower.id], mathStrokes: [], reasons: [], size: 11, baseline: 50 };
  return { region: value, ast: { type: 'script',
    base: { type: 'symbol', text: 'd', sourceId: base.id, italic: true, bold: false },
    subscript: { type: 'symbol', text: label, sourceId: lower.id, italic: false, bold: false } } };
};
for (const label of ['model', 'data', 'train', 'abcdefghijkl']) {
  const fixture = serifFixture(label), before = structuredClone(fixture);
  assert(validateMathAst(fixture.ast, fixture.region));
  assert.equal(nativeMathReaderMode(fixture.ast, fixture.region), 'script');
  assert.deepEqual(fixture, before);
}
{
  const fixture = serifFixture(), before = structuredClone(fixture);
  const native = nativeMath(fixture.ast, fixture.region, { measurementContext: context });
  const xml = JSON.stringify(native.prepForXml({ stack: [] }));
  assert(xml.includes('m:sSub') && xml.includes('m:sub'));
  assert(xml.includes('Times New Roman') && xml.includes('model'));
  const own = { number: 1, width: 200, height: 120, items: [fixture.region], rules: [], risks: ['math-image'],
    characters: 6, sources: fixture.region.mathGlyphs.map(glyph => ({ id: glyph.id, text: glyph.text,
      rect: { ...glyph.rect }, disposition: 'visible-image' })) };
  const document = inferDocument([own], { preserveGeometry: true }), original = structuredClone(document);
  const bytes = await createWordBytes(document, [{ id: fixture.region.id, bytes: createCanvas(1, 1).toBuffer('image/png') }],
    { preserveGeometry: true, editableMath: true, strictMathGeometry: true, measurementContext: context });
  const actual = await (await JSZip.loadAsync(bytes.bytes)).file('word/document.xml').async('string');
  assert.equal(bytes.quality.nativeFormulas, 1);
  assert.match(actual, /<m:sSub>[\s\S]*?<m:sub>[\s\S]*?<m:t>model<\/m:t>/);
  assert.match(actual, /w:ascii="Times New Roman"/);
  assert(!actual.includes('<w:drawing'));
  assert.deepEqual(document, original); assert.deepEqual(fixture, before);
}
let serifRefusals = 0;
for (const change of [
  f => { f.region.mathGlyphs[1].font = 'ABCDEF+NimbusRomNo9L-Medi'; },
  f => { f.region.mathGlyphs[1].font = 'ABCDEF+NimbusRomNo9L-ReguItal'; },
  f => { f.region.mathGlyphs[1].font = 'Unknown'; },
  f => { f.region.mathGlyphs[1].italic = f.ast.subscript.italic = true; },
  f => { f.region.mathGlyphs[1].bold = f.ast.subscript.bold = true; },
  f => { f.region.mathGlyphs[1].text = f.ast.subscript.text = 'Model'; },
  f => { f.region.mathGlyphs[1].text = f.ast.subscript.text = 'ab'; },
  f => { f.region.mathGlyphs[1].text = f.ast.subscript.text = 'abcdefghijklm'; },
  f => { f.region.mathGlyphs[1].text = f.ast.subscript.text = 'data1'; },
  f => { f.region.mathGlyphs[1].text = f.ast.subscript.text = 'two words'; },
  f => { f.region.mathGlyphs[1].baseline = 50; },
  f => { f.region.mathGlyphs[1].baseline = 47; },
  f => { f.region.mathGlyphs[1].baseline = 58; },
  f => { f.region.mathGlyphs[1].size = 10; },
  f => { f.region.mathGlyphs[1].size = 4; },
  f => { f.region.mathGlyphs[1].rect.x = 30; },
  f => { f.region.mathGlyphs[1].rect.x = 70; },
  f => { f.region.mathGlyphs[1].color = 'ff0000'; },
  f => { f.region.mathGlyphs[1].ocr = true; },
  f => { f.region.mathGlyphs[1].raster = true; },
  f => { f.region.mathGlyphs[1].preciseInk = false; },
  f => { f.region.mathGlyphs[1].mathStyleUncertain = true; },
  f => { f.region.mathGlyphs[1].text = undefined; },
  f => { f.region.sourceIds.push('uncovered'); },
  f => { f.region.sourceIds.push(f.region.sourceIds[0]); },
  f => { f.region.mathStrokes.push({ id: 'unexplained' }); },
  f => { f.region.backgroundPaintIndexes = [0]; },
  f => { f.ast.superscript = f.ast.subscript; delete f.ast.subscript; },
  f => { f.ast.subscript = { type: 'row', children: [f.ast.subscript] }; },
  f => { f.ast.subscript.sourceId = f.ast.base.sourceId; },
  f => { f.ast.subscript = f.ast; },
  f => {
    const rival = { ...f.region.mathGlyphs[0], id: 'rival', text: 'p' };
    f.region.mathGlyphs.push(rival); f.region.sourceIds.push(rival.id);
  },
]) {
  const fixture = serifFixture(); change(fixture);
  assert.equal(nativeMathReaderMode(fixture.ast, fixture.region), null, 'a text face alone cannot prove a lower index');
  serifRefusals++;
}
// Ordinary upright max is not a new operator profile.
{
  const fixture = serifFixture('max'), [base, lower] = fixture.region.mathGlyphs;
  [base.text, lower.text] = ['max', 'data'];
  base.font = lower.font; base.italic = false;
  fixture.ast.base = { type: 'symbol', sourceId: base.id, text: base.text, italic: false, bold: false };
  fixture.ast.subscript.text = lower.text;
  assert.equal(nativeMathReaderMode(fixture.ast, fixture.region), null);
  serifRefusals++;
}
{
  const first = serifFixture(), second = serifFixture('data');
  for (const glyph of second.region.mathGlyphs) { glyph.id += '-next'; glyph.rect.x += 40; }
  second.ast.base.sourceId += '-next'; second.ast.subscript.sourceId += '-next';
  const equal = g('serif-equal', '=', 'CMR10', 65, 45, 6, 3, 11, 50);
  const glyphs = [...first.region.mathGlyphs, equal, ...second.region.mathGlyphs];
  const combined = { ...first.region, mathGlyphs: glyphs, sourceIds: glyphs.map(glyph => glyph.id),
    rect: union(glyphs.map(glyph => glyph.rect)) };
  const ast = { type: 'row', children: [first.ast,
    { type: 'symbol', text: '=', sourceId: equal.id, italic: false, bold: false }, second.ast] };
  assert(validateMathAst(ast, combined));
  assert.equal(nativeMathReaderMode(ast, combined), null, 'the serif profile cannot authorize unverified multi-script geometry');
  serifRefusals++;
}
console.log(`Native upright serif indices: 4 valid labels and ${serifRefusals} source/role/style/ownership refusals passed.`);
