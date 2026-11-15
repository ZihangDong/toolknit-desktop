import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { nativeMathReaderMode } from '../src/features/pdf-to-word/core/native-math-policy.js';
import { inferMathAst } from '../src/features/pdf-to-word/core/math.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { mathWordFont } from '../src/features/pdf-to-word/adapters/docx-fonts.js';

const symbol = (id, text) => ({ type: 'symbol', sourceId: id, text });
const glyphs = [
  { id: 'base', text: 'x', font: 'Times-Roman', italic: true, bold: false, size: 12, baseline: 50, rect: { x: 40, y: 41, width: 5.4, height: 8 } },
  { id: 'sub', text: '1', font: 'Times-Roman', italic: false, bold: false, size: 8, baseline: 54, rect: { x: 46, y: 48.5, width: 3.5, height: 5.4 } },
];
const region = { id: 'script', type: 'image', role: 'math', sourceIds: ['base', 'sub'], mathGlyphs: glyphs,
  mathStrokes: [], reasons: [], size: 12, baseline: 50, rect: { x: 40, y: 41, width: 9.5, height: 12.9 } };
const ast = inferMathAst(region);
assert.equal(ast?.type, 'script');
assert.equal(nativeMathReaderMode(ast, region), 'script');
for (const change of [
  value => { value.mathGlyphs[0].font = 'UnknownFace'; },
  value => { value.mathGlyphs[0].font = 'ABCDEF+E-BX'; },
  value => { value.mathGlyphs[0].raster = true; },
  value => { value.mathGlyphs[0].text = 'xy'; },
  value => { value.mathGlyphs[0].alphabet = 'script'; },
  value => { value.mathGlyphs.push(...Array.from({ length: 7 }, (_, i) => ({ ...glyphs[0], id: 'extra' + i }))); },
]) {
  const value = structuredClone(region); change(value);
  assert.equal(nativeMathReaderMode(ast, value), null);
}
const nested = { type: 'script', base: ast, subscript: symbol('next', '2') };
assert.equal(nativeMathReaderMode(nested, region), null, 'nested scripts retain images');
assert.equal(nativeMathReaderMode({ type: 'fraction', numerator: symbol('base', 'x'), denominator: symbol('sub', '1') }, region), null);
assert.equal(nativeMathReaderMode(symbol('base', 'x'), region), null, 'isolated symbols stay conservative');
const cycle = { type: 'row', children: [] }; cycle.children.push(cycle);
assert.equal(nativeMathReaderMode(cycle, region), null, 'policy traversal has a fixed work budget');
const flat = { type: 'row', children: [symbol('x', 'x'), symbol('eq', '='), symbol('y', 'y')] };
assert.equal(nativeMathReaderMode(flat, { mathGlyphs: [...'x=y'].map(text => ({ text, font: 'Arial' })) }), 'flat');

const scene = { number: 1, width: 300, height: 200, items: [region], sources: glyphs.map(glyph => ({ ...glyph, disposition: 'visible-image' })),
  rules: [], risks: ['math-image'], characters: 2 };
const document = inferDocument([scene], { preserveGeometry: true }), original = structuredClone(document);
const canvas = createCanvas(20, 26), context = createCanvas(1, 1).getContext('2d');
const assets = [{ id: region.id, bytes: canvas.toBuffer('image/png'), width: 20, height: 26 }];
const options = { preserveGeometry: true, editableMath: true, measurementContext: context };
const strict = await createWordBytes(document, assets, { ...options, strictMathGeometry: true });
const experimental = await createWordBytes(document, assets, options);
const xml = async output => (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
assert.equal(strict.quality.nativeFormulas, 1);
assert.equal(strict.quality.nativeMathCharacters, 2);
assert((await xml(strict)).includes('<m:sSub>'));
assert.equal(await xml(strict), await xml(experimental), 'verified scripts keep the source-baseline frame, not the flat-equation frame');
const unknown = structuredClone(document);
const walk = blocks => { for (const block of blocks) {
  if (block.mathGlyphs) block.mathGlyphs[0].font = 'UnknownFace';
  for (const line of block.lines || []) walk(line.items);
  for (const column of block.columns || []) walk(column.blocks);
  for (const cell of block.cells || []) walk(cell.blocks);
} };
walk([...unknown.pages[0].header, ...unknown.pages[0].blocks, ...unknown.pages[0].footer]);
const fallback = await createWordBytes(unknown, assets, { ...options, strictMathGeometry: true });
assert.equal(fallback.quality.nativeFormulas, 0);
assert.match(await xml(fallback), /<pic:pic[ >]/);
assert.deepEqual(document, original, 'writer policy cannot mutate the scene');

function compactScript(text = 'b') {
  const base = { id: 'compact-base', text, font: 'ABCDEF+Cambria-Italic', italic: true, bold: false,
    preciseInk: true, raster: false, size: 11, baseline: 50,
    rect: { x: 40, y: 42.2, width: text.length * 5, height: 7.75 } };
  const sub = { ...base, id: 'compact-index', text: 'i', size: 7.3, baseline: 50.94,
    rect: { x: 40 + text.length * 5 + .6, y: 46, width: 1.7, height: 4.8 } };
  return { id: 'compact', type: 'image', role: 'math', sourceIds: [base.id, sub.id],
    mathGlyphs: [base, sub], mathStrokes: [], reasons: [], size: 11, baseline: 50,
    rect: { x: 40, y: 42.2, width: text.length * 5 + 2.3, height: 8.6 } };
}
for (const text of ['b', 'nb', 'mc']) {
  const candidate = compactScript(text), before = structuredClone(candidate), parsed = inferMathAst(candidate);
  assert.equal(parsed?.type, 'script');
  assert.equal(parsed.base.text, text);
  assert.equal(parsed.subscript.text, 'i');
  assert.equal(nativeMathReaderMode(parsed, candidate), 'script');
  const scene = { number: 1, width: 300, height: 200, items: [candidate],
    sources: candidate.mathGlyphs.map(glyph => ({ ...glyph, disposition: 'visible-image' })),
    rules: [], risks: ['math-image'], characters: text.length + 1 };
  const value = inferDocument([scene], { preserveGeometry: true });
  const bytes = await createWordBytes(value, [{ ...assets[0], id: candidate.id }], { ...options, strictMathGeometry: true });
  assert.equal(bytes.quality.nativeFormulas, 1);
  assert.equal(bytes.quality.nativeMathCharacters, text.length + 1);
  assert((await xml(bytes)).includes('<m:sSub>'));
  assert.match(await xml(bytes), /w:ascii="Cambria"/);
  assert.deepEqual(candidate, before);
}
for (const change of [
  value => { value.mathGlyphs[0].preciseInk = false; },
  value => { value.mathGlyphs[0].font = 'Unknown-Italic'; },
  value => { value.mathGlyphs[1].font = 'GHIJKL+Cambria-Italic'; },
  value => { value.mathGlyphs[1].italic = false; },
  value => { value.mathGlyphs[1].size = 9; },
  value => { value.mathGlyphs[1].baseline = 50.5; },
  value => { value.mathGlyphs[1].rect.x = 80; },
  value => { value.mathGlyphs[0].bold = true; },
]) {
  const candidate = compactScript(); change(candidate);
  assert.notEqual(inferMathAst(candidate)?.type, 'script', 'shallow scripts require their full native face/ink/size/position evidence');
}
assert.equal(mathWordFont({ text: 'nb', font: 'ABCDEF+Cambria-Italic' }), 'Cambria');
assert.equal(mathWordFont({ text: '\u03b8', font: 'Cambria' }), 'Cambria Math', 'the ASCII evidence cannot broaden non-ASCII math font support');

context.font = '1000px "Cambria"';
const literalText = 'X = A + Z ', metric = context.measureText(literalText), literalSize = 11;
const literalGlyph = { id: 'literal', text: literalText, font: 'ABCDEF+Cambria', size: literalSize,
  baseline: 80, italic: false, bold: false, preciseInk: true, raster: false,
  rect: { x: 30 - metric.actualBoundingBoxLeft * .011, y: 80 - metric.actualBoundingBoxAscent * .011,
    width: (metric.actualBoundingBoxLeft + metric.actualBoundingBoxRight) * .011,
    height: (metric.actualBoundingBoxAscent + metric.actualBoundingBoxDescent) * .011 } };
const literal = { id: 'literal-image', type: 'image', role: 'math', sourceIds: ['literal'], mathGlyphs: [literalGlyph],
  mathStrokes: [], reasons: [], size: literalSize, baseline: 80, rect: literalGlyph.rect };
const literalAst = inferMathAst(literal);
assert.equal(nativeMathReaderMode(literalAst, literal), 'literal');
const literalDocument = inferDocument([{ number: 1, width: 300, height: 200, items: [literal],
  sources: [{ ...literalGlyph, disposition: 'visible-image' }], rules: [], risks: ['math-image'], characters: literalText.length }], { preserveGeometry: true });
const literalBefore = structuredClone(literalDocument), literalAssets = [{ ...assets[0], id: literal.id }];
const literalStrict = await createWordBytes(literalDocument, literalAssets, { ...options, strictMathGeometry: true });
const literalExperimental = await createWordBytes(literalDocument, literalAssets, options);
assert.equal(literalStrict.quality.nativeFormulas, 1);
assert.equal(await xml(literalStrict), await xml(literalExperimental), 'literal equations retain their source-baseline frame including trailing blank advance');
assert.deepEqual(literalDocument, literalBefore);
for (const change of [
  value => { value.mathGlyphs[0].text = 'X + Z'; },
  value => { value.mathGlyphs[0].text = 'X_1 = Z'; },
  value => { value.mathGlyphs[0].text = 'X = (A + Z)'; },
  value => { value.mathGlyphs[0].text = 'X = \u03b8'; },
  value => { value.mathGlyphs[0].text = 'x'.repeat(70) + '=Z'; },
  value => { value.mathGlyphs[0].font = 'Unknown'; },
  value => { value.mathGlyphs[0].preciseInk = false; },
  value => { value.mathGlyphs[0].raster = true; },
  value => { value.mathGlyphs[0].italic = true; },
]) {
  const candidate = structuredClone(literal); change(candidate);
  assert.equal(nativeMathReaderMode(inferMathAst(candidate), candidate), null, 'untested literal structures remain protected');
}

// Single native operators have independently measured source ink, rather than
// invented per-character positions or a reconstructed expression tree.
context.font = '1000px "Cambria Math"';
const atomicMetrics = context.measureText('\u2260');
const atomicGlyph = { id: 'atomic-op', text: '\u2260', font: 'ABCDEF+XITSMath-Regular', size: 12,
  baseline: 70, italic: false, bold: false, preciseInk: true, raster: false,
  rect: { x: 40 - atomicMetrics.actualBoundingBoxLeft * .012, y: 70 - atomicMetrics.actualBoundingBoxAscent * .012,
    width: (atomicMetrics.actualBoundingBoxLeft + atomicMetrics.actualBoundingBoxRight) * .012,
    height: (atomicMetrics.actualBoundingBoxAscent + atomicMetrics.actualBoundingBoxDescent) * .012 } };
const atomic = { id: 'atomic-image', type: 'image', role: 'math', sourceIds: [atomicGlyph.id], mathGlyphs: [atomicGlyph],
  mathStrokes: [], reasons: [], size: 12, baseline: 70, rect: atomicGlyph.rect };
const atomicAst = inferMathAst(atomic);
assert.equal(nativeMathReaderMode(atomicAst, atomic), 'atomic');
const atomicDocument = inferDocument([{ number: 1, width: 300, height: 200, items: [atomic],
  sources: [{ ...atomicGlyph, disposition: 'visible-image' }], rules: [], risks: ['math-image'], characters: 1 }], { preserveGeometry: true });
const atomicBefore = structuredClone(atomicDocument), atomicAssets = [{ ...assets[0], id: atomic.id }];
const atomicStrict = await createWordBytes(atomicDocument, atomicAssets, { ...options, strictMathGeometry: true });
const atomicExperimental = await createWordBytes(atomicDocument, atomicAssets, options);
assert.equal(atomicStrict.quality.nativeFormulas, 1);
assert.equal(atomicStrict.quality.nativeMathCharacters, 1);
assert.equal(await xml(atomicStrict), await xml(atomicExperimental), 'atomic operators retain their source-baseline frame');
assert.deepEqual(atomicDocument, atomicBefore);
for (const change of [
  value => { value.mathGlyphs[0].text = '\u2260 0'; },
  value => { value.mathGlyphs[0].text = 'or'; },
  value => { value.mathGlyphs[0].font = 'UnknownMath'; },
  value => { value.mathGlyphs[0].raster = true; },
  value => { value.mathGlyphs[0].preciseInk = false; },
  value => { value.mathGlyphs[0].mathStyleUncertain = true; },
  value => { value.mathGlyphs[0].alphabet = 'script'; },
  value => { value.sourceIds = ['other-source']; },
  value => { value.mathStrokes = [{ id: 'extra-line' }]; },
  value => { value.drawingIds = ['decoration']; },
  value => { value.reasons = ['overlapping-graphics']; },
  value => { value.backgroundPaintIndexes = [0]; },
]) {
  const candidate = structuredClone(atomic); change(candidate);
  assert.equal(nativeMathReaderMode(symbol(candidate.mathGlyphs[0].id, candidate.mathGlyphs[0].text), candidate), null,
    'raster, mixed, decorated and uncertain sources do not inherit atomic operator evidence');
}
assert.equal(nativeMathReaderMode(symbol('other-source', '\u2260'), atomic), null);
console.log('Reader math policy: bounded first-level scripts, conservative fallback and real DOCX frame equivalence passed.');

// Independently specified real-space membership: a source-native uppercase
// vector, optional lower index, and a scalar or product dimension. Letters
// differ from the paper samples; geometry and glyph provenance remain explicit.
{
  const g = (id, text, font, italic, size, baseline, x, y, width, height, alphabet) => ({
    id, text, font, italic, bold: false, size, baseline, rect: { x, y, width, height },
    preciseInk: true, raster: false, color: '000000', ...(alphabet ? { alphabet } : {}) });
  const glyphs = [g('v', 'A', 'CMMI10', true, 10, 50, 10, 43, 7, 7),
    g('i', 'n', 'CMMI7', true, 7, 52, 17, 47, 4, 5),
    g('in', '∈', 'CMSY10', false, 10, 50, 25, 44, 6, 6),
    g('real', 'R', 'MSBM10', false, 10, 50, 35, 43, 7, 7, 'doubleStruck'),
    g('d1', 'N', 'CMMI7', true, 7, 46, 43, 41, 5, 5),
    g('mul', '×', 'CMSY7', false, 7, 46, 49, 42, 4, 4),
    g('d2', 'D', 'CMMI7', true, 7, 46, 55, 41, 5, 5)];
  const region = { id: 'space', type: 'image', role: 'math', size: 10, baseline: 50,
    rect: { x: 10, y: 41, width: 50, height: 11 }, sourceIds: glyphs.map(g => g.id),
    mathGlyphs: glyphs, mathStrokes: [], reasons: [] };
  const s = g => ({ type: 'symbol', sourceId: g.id, text: g.text, italic: g.italic, bold: false,
    ...(g.alphabet ? { alphabet: g.alphabet } : {}) });
  const expected = { type: 'row', children: [
    { type: 'script', base: s(glyphs[0]), subscript: s(glyphs[1]) }, s(glyphs[2]),
    { type: 'script', base: s(glyphs[3]), superscript: { type: 'row', children: glyphs.slice(4).map(s) } }] };
  const before = structuredClone(region), ast = inferMathAst(region);
  assert.deepEqual(ast, expected, 'source geometry matches independently assigned membership and dimension roles');
  assert.equal(nativeMathReaderMode(ast, region), 'blackboard-space');
  for (const keep of [[3, 4], [3, 4, 5, 6], [0, 2, 3, 4]]) {
    const candidate = structuredClone(region); candidate.mathGlyphs = keep.map(i => glyphs[i]);
    candidate.sourceIds = candidate.mathGlyphs.map(g => g.id);
    assert.equal(nativeMathReaderMode(inferMathAst(candidate), candidate), 'blackboard-space', 'component and unindexed forms keep distinct bounded provenance');
  }
  for (const [index, change] of [
    r => { r.mathGlyphs[3].font = 'UnknownMSBM10'; }, r => { r.mathGlyphs[3].font = 'MSBM10-extra'; },
    r => { r.mathGlyphs[3].alphabet = 'script'; }, r => { r.mathGlyphs[3].text = 'Q'; },
    r => { r.mathGlyphs[3].italic = true; }, r => { r.mathGlyphs[3].bold = true; },
    r => { r.mathGlyphs[3].raster = true; }, r => { r.mathGlyphs[3].ocr = true; },
    r => { r.mathGlyphs[4].preciseInk = false; }, r => { r.mathGlyphs[4].color = 'ff0000'; },
    r => { r.mathGlyphs[4].mathStyleUncertain = true; }, r => { r.mathGlyphs[4].baseline = NaN; },
    r => { r.mathGlyphs[4].size = 10; }, r => { r.mathGlyphs[4].baseline = 49; },
    r => { r.mathGlyphs[4].rect.x = 100; }, r => { r.mathGlyphs[5].text = '+'; },
    r => { r.mathGlyphs[2].font = 'CMR10'; }, r => { r.mathGlyphs[2].baseline = 48; },
    r => { r.mathGlyphs[1].baseline = 50; }, r => { r.mathGlyphs[1].text = 'nn'; },
    r => { r.mathGlyphs[0].rect.width = -1; }, r => { r.mathGlyphs[0].font = 'CMMIB10'; },
    r => { r.sourceIds.push('unrepresented'); }, r => { r.sourceIds[0] = r.sourceIds[1]; },
    r => { r.mathGlyphs.push({ ...r.mathGlyphs[0] }); }, r => { r.mathStrokes.push({ id: 'stroke' }); },
    r => { r.drawingIds = ['decoration']; }, r => { r.reasons = ['overlap']; },
    r => { r.backgroundPaintIndexes = [0]; }, r => { r.role = 'figure'; },
  ].entries()) {
    const candidate = structuredClone(region); change(candidate);
    assert.notEqual(nativeMathReaderMode(ast, candidate), 'blackboard-space', `unproven blackboard source ${index} stays protected`);
  }
  for (const changed of [
    a => { a.children[0].subscript.sourceId = 'd1'; },
    a => { a.children[2].superscript.children.reverse(); },
    a => { a.children[2].base.alphabet = undefined; },
    a => { a.children[2].subscript = a.children[2].superscript; },
    a => { a.children[0].base.italic = false; },
    a => { a.children.push(a); },
  ]) {
    const wrong = structuredClone(ast); changed(wrong);
    assert.notEqual(nativeMathReaderMode(wrong, region), 'blackboard-space', 'source conservation alone cannot authorize wrong roles or styles');
  }
  const doc = inferDocument([{ number: 1, width: 300, height: 200, items: [region],
    sources: glyphs.map(g => ({ ...g, disposition: 'visible-image' })), rules: [], risks: ['math-image'], characters: 7 }], { preserveGeometry: true });
  const output = await createWordBytes(doc, [{ ...assets[0], id: region.id }], { ...options, strictMathGeometry: true });
  assert.equal(output.quality.nativeFormulas, 1);
  assert.equal(output.quality.nativeMathCharacters, 7);
  const actual = await xml(output);
  assert(actual.includes('ℝ') && actual.includes('<m:sSub>') && actual.includes('<m:sSup>'));
  assert.deepEqual(region, before, 'policy and serialization preserve the original source evidence');
  const spaced = [glyphs[0], glyphs[2], glyphs[3], glyphs[4]].map(g => structuredClone(g));
  spaced[0].rect.x = 10; spaced[1].rect.x = 25; spaced[2].rect.x = 39; spaced[3].rect.x = 47;
  const partition = (content, graphics = []) => {
    const text = content.map((g, order) => ({ ...structuredClone(g), type: 'text', order, sourceIds: [g.id] }));
    return groupPageRegions(text, graphics, [], text.map(g => ({ ...g, disposition: 'editable' })));
  };
  const complete = partition(spaced).items.find(item => item.role === 'math' && item.sourceIds.length === 4);
  assert(complete, 'ordinary relation spacing joins the independently proven complete membership');
  assert.equal(nativeMathReaderMode(inferMathAst(complete), complete), 'blackboard-space');
  assert.deepEqual(new Set(complete.sourceIds), new Set(spaced.map(g => g.id)), 'no body source is acquired by the join');
  for (const change of [
    a => { a[2].font = 'Unknown'; }, a => { a[2].color = 'ff0000'; },
    a => { a[0].baseline += 2; }, a => { a[0].italic = false; },
    a => { a[0].rect.x -= 20; }, a => { a[3].raster = true; },
  ]) {
    const candidate = structuredClone(spaced); change(candidate);
    assert(!partition(candidate).items.some(item => item.sourceIds?.length === 4), 'uncertain joins cannot consume existing editable text');
  }
  const obstacle = { id: 'obstacle', type: 'image', order: 20, raster: true, reason: 'image',
    rect: { x: 20, y: 43, width: 1, height: 7 } };
  assert(!partition(spaced, [obstacle]).items.some(item => item.sourceIds?.length === 4), 'a separate visible stroke blocks the wider join');
}

// Independent normalized-exponential fixture: small native TeX indices use
// the same minimum point size in the exponent's nested subscript.
{
  const g = (id, text, font, size, baseline, x, y, width, height) => ({ id, type:'text', sourceIds:[id], text,
    font, size, baseline, rect:{x,y,width,height}, raster:false, preciseInk:true, italic:/^[a-z]$/.test(text), bold:false, color:'000000' });
  const glyphs = [
    g('q','q','CMMI10',10,33,10,25,7,8),g('r','r','CMMI7',7,35.5,17.5,30.5,3,5),g('eq','=','CMR10',10,33,25,29,8,3),
    g('ne','e','CMMI8',8,28,50,24.5,3.3,3.6),g('na','a','CMMI6',6,25.2,54,21,3.9,4.3),
    g('nd','·','CMSY6',6,25.2,59,23.3,.7,.7),g('nb','b','CMMI6',6,25.2,61,21.2,4.7,4),g('nr','r','CMMI6',6,27.1,65.4,23.1,1.9,4.03),
    g('sum','∑','CMEX8',8,33,41,33,8,8),g('index','s','CMMI6',6,41.5,49.5,37.5,2.7,5.2),
    g('de','e','CMMI8',8,39,55,35.5,3.3,3.6),g('da','a','CMMI6',6,35.1,59,30.9,3.9,4.3),
    g('dd','·','CMSY6',6,35.1,64,33.2,.7,.7),g('db','b','CMMI6',6,35.1,66,31.1,4.7,4),g('ds','s','CMMI6',6,37,70.1,33,2.7,5.2),
  ];
  const region = { id:'ratio',type:'image',role:'math',size:10,baseline:33,rect:{x:10,y:21,width:70,height:22},
    sourceIds:glyphs.map(g=>g.id),mathGlyphs:glyphs,mathStrokes:[{id:'division',thin:true,color:'000000',rect:{x:40,y:30,width:40,height:.4}}],reasons:[] };
  const before = structuredClone(region), ast = inferMathAst(region);
  assert.equal(ast?.type,'row');
  const fraction = ast.children.find(n=>n.type==='fraction');
  assert.equal(fraction?.numerator.superscript.children.at(-1).subscript.sourceId,'nr','the numerator index belongs to the exponent base');
  assert.equal(fraction?.denominator.type,'nary');
  assert.equal(fraction.denominator.lower.sourceId,'index','the sum owns only its side index');
  assert.equal(fraction.denominator.body.superscript.children.at(-1).subscript.sourceId,'ds','the denominator exponent keeps its own nested index');
  assert.equal(nativeMathReaderMode(ast,region),'exponential-ratio');
  assert.equal(nativeMathReaderMode(fraction,{...region,sourceIds:region.sourceIds.slice(3),mathGlyphs:region.mathGlyphs.slice(3)}),null,
    'a standalone leading fraction has not passed the same reader-frame proof');
  assert.deepEqual(region,before);
  for(const [caseIndex,change] of[
    r=>{r.mathGlyphs[8].font='CMEX8-extra';},r=>{r.mathGlyphs[8].raster=true;},
    r=>{r.mathGlyphs[9].rect.x=44;},r=>{r.mathGlyphs[9].baseline=39;},
    r=>{r.mathGlyphs[7].font='Unknown6';},r=>{r.mathGlyphs[7].preciseInk=false;},
    r=>{r.mathGlyphs[7].size=9;},
    r=>{r.mathGlyphs[13].italic=false;},r=>{r.mathGlyphs[13].bold=true;},
    r=>{r.sourceIds.push('unrepresented-source');},r=>{r.mathGlyphs[3].ocr=true;},
    r=>{r.mathStrokes[0].unmapped=true;},r=>{r.mathStrokes.push({...r.mathStrokes[0],id:'second-division'});},
  ].entries()){
    const candidate=structuredClone(region);change(candidate);
    assert.notEqual(nativeMathReaderMode(inferMathAst(candidate),candidate),'exponential-ratio',`counterexample ${caseIndex}: unknown, ambiguous and incomplete sources retain the existing fallback`);
  }
  const ordinary=structuredClone(region);ordinary.mathGlyphs[7].baseline=25.2;
  const ordinaryAst=inferMathAst(ordinary),ordinaryExponent=ordinaryAst.children.find(n=>n.type==='fraction').numerator.superscript;
  assert.equal(ordinaryExponent.children.at(-1).sourceId,'nr');
  assert.equal(ordinaryExponent.children.at(-1).type,'symbol','same-size text on the exponent baseline remains ordinary text, not a nested index');
  const wrong=structuredClone(ast);wrong.children.find(n=>n.type==='fraction').denominator.lower.sourceId='ds';
  assert.notEqual(nativeMathReaderMode(wrong,region),'exponential-ratio','an index cannot be stolen from the exponent');
  const ratioDocument=inferDocument([{number:1,width:300,height:200,items:[region],sources:glyphs.map(g=>({...g,disposition:'visible-image'})),rules:[],risks:['math-image'],characters:glyphs.length}],{preserveGeometry:true});
  const output=await createWordBytes(ratioDocument,[{...assets[0],id:region.id}],{...options,strictMathGeometry:true});
  assert.equal(output.quality.nativeFormulas,1,'the complete expression reaches the actual native Word writer');
  const actual=await xml(output);assert(actual.includes('<m:f>')&&actual.includes('<m:sSub>')&&actual.includes('<m:sSup>'));
  assert.deepEqual(region,before,'reading and writing preserve the complete source ledger');
  const partition=(content,decorations=[])=>{
    const text=structuredClone(content).map((g,order)=>({...g,order}));
    const bar={...structuredClone(region.mathStrokes[0]),type:'image',raster:true,reason:'image',strokeColor:'000000',order:100};
    return groupPageRegions(text,[bar,...decorations],[],text.map(g=>({id:g.id,text:g.text,rect:g.rect,order:g.order,disposition:'editable'})));
  };
  const grouped=partition(glyphs),whole=grouped.items.find(g=>g.role==='math'&&g.sourceIds.length===glyphs.length);
  assert(whole,'the relation and short division bar form one complete proven expression across ordinary operator spacing: '
    +JSON.stringify(grouped.items.map(g=>({role:g.role,sourceIds:g.sourceIds}))));
  assert.equal(nativeMathReaderMode(inferMathAst(whole),whole),'exponential-ratio');
  const unknown=structuredClone(glyphs);unknown[7].font='Unknown6';
  assert(!partition(unknown).items.some(g=>g.sourceIds?.length===glyphs.length),'an unsupported candidate cannot swallow earlier editable partitions');
  const obstruction={id:'decoration',type:'image',rect:{x:36,y:28,width:1,height:6},order:99,raster:true,reason:'image'};
  assert(!partition(glyphs,[obstruction]).items.some(g=>g.sourceIds?.length===glyphs.length),'unrelated graphics prevent the wider formula join');
  console.log('Native exponential ratio: complete nested indices, sum body/side limit, provenance counterexamples and real OMML passed.');
}
