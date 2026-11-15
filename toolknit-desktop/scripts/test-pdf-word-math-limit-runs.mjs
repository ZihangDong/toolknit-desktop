import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { hasMixedMathLimit, planMathLimitRuns, hasCompoundNativeMathRun, planNativeMathRuns } from '../src/features/pdf-to-word/core/math-limit-runs.js';
import { inferMathAst } from '../src/features/pdf-to-word/core/math.js';
import { mathClassificationText, mathUnicodeRunStyle } from '../src/features/pdf-to-word/core/font-style.js';
import { mathGlyphBaseline } from '../src/features/pdf-to-word/core/math-rows.js';
import { nativeMathReaderMode } from '../src/features/pdf-to-word/core/native-math-policy.js';
import { sceneLayoutBytes } from '../src/features/pdf-to-word/core/scene-budget.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { snapshotPage, snapshotFonts, renderPage } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { prepareWordScene } from '../src/features/pdf-to-word/adapters/scene.js';

const glyph = (id, text, x, width, italic = false) => ({ id, text, font: 'Times-Roman', size: 12, baseline: 80,
  rect: { x, y: 71, width, height: 11 }, italic, bold: false });
const joined = glyph('joined', ') =max', 61, 41.6);
joined.mathGlyphPositions = [
  { text: ')', sourceOffset: 0, x: 61, y: 71, width: 4, height: 11 },
  { text: '=', sourceOffset: 2, x: 70, y: 75, width: 8, height: 3 },
  { text: 'm', sourceOffset: 3, x: 82, y: 74, width: 7.5, height: 6 },
  { text: 'a', sourceOffset: 4, x: 90, y: 74, width: 5.8, height: 6 },
  { text: 'x', sourceOffset: 5, x: 97, y: 74, width: 5.6, height: 6 },
].map(({ x, y, width, height, ...rest }) => ({ ...rest, rect: { x, y, width, height }, baseline: 80, baselineX: x, advanceWidth: width }));
const lower = { ...glyph('lower', 'D', 90, 6, true), size: 8, baseline: 91, rect: { x: 90, y: 85, width: 6, height: 6 } };
const glyphs = [glyph('C', 'C', 40, 7, true), glyph('open', '(', 48, 4), glyph('G', 'G', 53, 7, true), joined, lower,
  glyph('V', 'V', 112, 7, true), glyph('open2', '(', 121, 4), glyph('G2', 'G', 126, 7, true),
  glyph('comma', ',', 135, 2), glyph('D2', 'D', 139, 7, true), glyph('close', ')', 148, 4)];
const region = { id: 'formula', type: 'image', role: 'math', mathGlyphs: glyphs, mathStrokes: [], reasons: [],
  rect: { x: 40, y: 71, width: 112, height: 20 }, size: 12, baseline: 80, sourceIds: glyphs.map(glyph => glyph.id) };
const original = structuredClone(region), plan = planMathLimitRuns(region);
assert(plan);
const nodes = node => [node, ...Object.values(node).filter(value => value && typeof value === 'object')
  .flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const limits = nodes(plan.ast).filter(node => node.type === 'limit');
assert.equal(limits.length, 1);
assert.equal(limits[0].base.text, 'max');
assert.equal(limits[0].lower.text, 'D', 'D belongs under max, not under the closing-parenthesis/equality run');
assert(!nodes(plan.ast).some(node => node.type === 'script'));
assert.deepEqual(plan.region.sourceIds, region.sourceIds, 'derived math ids do not replace the source ledger');
assert.equal(nativeMathReaderMode(plan.ast, plan.region), 'limit');
assert.deepEqual(region, original);
assert.equal(plan.region.mathGlyphs.map(glyph => glyph.text).join('').replace(/\s/gu, ''), glyphs.map(glyph => glyph.text).join('').replace(/\s/gu, ''));
assert.equal(inferMathAst(region)?.children?.some(node => node.type === 'limit'), false, 'fixture reproduces the original merged-run defect');
for (const value of ['max', 'maximum', 'maximal', 'minimize', 'administration', 'simple text']) assert.equal(hasMixedMathLimit(value), false);
for (const value of [') =max', '=min', ' lim', 'argmax +', 'x=inf', '(sup)']) assert.equal(hasMixedMathLimit(value), true);

for (const mutate of [
  run => { run.mathGlyphPositions.pop(); },
  run => { run.mathGlyphPositions[1].text = '+'; },
  run => { run.mathGlyphPositions[1].sourceOffset = 3; },
  run => { run.mathGlyphPositions[1].rect.x = 500; },
  run => { run.mathGlyphPositions[1].baseline += 1; },
  run => { run.mathGlyphPositions[1].baselineX = 1; },
  run => { run.mathGlyphPositions[1].advanceWidth = Infinity; },
  run => { run.mathGlyphPositions = Array.from({ length: 201 }, () => run.mathGlyphPositions[0]); },
  run => { run.raster = true; },
  run => { run.mathStyleUncertain = true; },
  run => { run.alphabet = 'script'; },
]) {
  const input = structuredClone(region); mutate(input.mathGlyphs[3]);
  assert.equal(planMathLimitRuns(input), null);
}
const unindexed = structuredClone(region); unindexed.mathGlyphs = unindexed.mathGlyphs.filter(glyph => glyph.id !== 'lower');
assert.equal(planMathLimitRuns(unindexed), null, 'lexical splitting cannot expand unrelated flat equations');
const collision = structuredClone(region); collision.mathGlyphs.at(-1).id = 'joined:math-part:0';
assert.equal(planMathLimitRuns(collision), null);
const duplicate = structuredClone(region); duplicate.mathGlyphs.at(-1).id = 'joined';
assert.equal(planMathLimitRuns(duplicate), null);
const ligature = structuredClone(region);
ligature.mathGlyphs[3].text = ')=max';
ligature.mathGlyphs[3].mathGlyphPositions = [{ ...joined.mathGlyphPositions[0], text: ')=', sourceOffset: 0 },
  ...joined.mathGlyphPositions.slice(2).map(part => ({ ...part, sourceOffset: part.sourceOffset - 1 }))];
assert.equal(planMathLimitRuns(ligature), null, 'a native glyph spanning token boundaries is not divided by guessed geometry');

const sources = glyphs.map(glyph => ({ id: glyph.id, text: glyph.text, rect: glyph.rect, disposition: 'visible-image' }));
const scene = { number: 1, width: 240, height: 160, items: [region], sources, rules: [], risks: ['math-image'], characters: 20 };
assert(sceneLayoutBytes(scene) >= joined.mathGlyphPositions.length * 2048, 'math trace and derived writer objects count against the existing working-memory budget');
const document = inferDocument([scene], { preserveGeometry: true }), baseline = structuredClone(document);
const canvas = createCanvas(224, 40), assets = [{ id: region.id, width: 224, height: 40, bytes: canvas.toBuffer('image/png') }];
const options = { preserveGeometry: true, editableMath: true, strictMathGeometry: true, measurementContext: createCanvas(1, 1).getContext('2d') };
const result = await createWordBytes(document, assets, options);
const xml = await (await JSZip.loadAsync(result.bytes)).file('word/document.xml').async('string');
assert.equal(result.quality.nativeFormulas, 1);
assert.equal(result.quality.nativeMathCharacters, sources.reduce((sum, source) => sum + source.text.replace(/\s/gu, '').length, 0));
assert(xml.includes('<m:limLow>'));
assert(!xml.includes('<m:sSub>'));
assert.deepEqual(document, baseline, 'writer normalization never rewrites the scene or public source ids');

// Generate the actual PDF operator pattern; hand-authored trace data alone
// would miss regressions between snapshot, native ink, region and writer.
const inputPdf = await PDFDocument.create(), roman = await inputPdf.embedFont(StandardFonts.TimesRoman), italic = await inputPdf.embedFont(StandardFonts.TimesRomanItalic);
const inputPage = inputPdf.addPage([300, 200]), lead = 'C(G) =max';
const maxX = 40 + roman.widthOfTextAtSize('C(G) =', 12), maxWidth = roman.widthOfTextAtSize('max', 12);
inputPage.drawText(lead, { x: 40, y: 120, size: 12, font: roman });
inputPage.drawText('D', { x: maxX + (maxWidth - italic.widthOfTextAtSize('D', 8)) / 2, y: 108, size: 8, font: italic });
inputPage.drawText('V(G,D)', { x: maxX + maxWidth + 4, y: 120, size: 12, font: italic });
const task = getDocument({ data: await inputPdf.save(), fontExtraProperties: true, verbosity: 0,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/', cMapUrl: 'node_modules/pdfjs-dist/cmaps/', cMapPacked: true, wasmUrl: 'node_modules/pdfjs-dist/wasm/' });
const pageCanvas = createCanvas(1, 1);
try {
  const pdf = await task.promise, page = await pdf.getPage(1), operation = { optionalContentConfig: await pdf.getOptionalContentConfig({ intent: 'display' }) };
  const snapshot = await snapshotPage(page, OPS, () => {}, operation.optionalContentConfig);
  await renderPage(page, pageCanvas, operation); snapshot.fonts = snapshotFonts(page, snapshot.fontIds);
  const realScene = prepareWordScene(snapshot, { pixels: pageCanvas.getContext('2d').getImageData(0, 0, pageCanvas.width, pageCanvas.height).data,
    width: pageCanvas.width, height: pageCanvas.height, measurementContext: options.measurementContext });
  const realRegion = realScene.items.find(item => item.mathGlyphs?.some(glyph => hasMixedMathLimit(glyph.text)));
  assert(realRegion, 'real PDF text operation is retained as a math region');
  const realPlan = planMathLimitRuns(realRegion);
  assert(realPlan, 'snapshot carries complete glyph offsets through region ownership');
  const realLimits = nodes(realPlan.ast).filter(node => node.type === 'limit');
  assert.equal(realLimits.length, 1); assert.equal(realLimits[0].base.text, 'max'); assert.equal(realLimits[0].lower.text, 'D');
  assert(realRegion.mathGlyphs.length < realPlan.region.mathGlyphs.length);
  const realDocument = inferDocument([realScene], { preserveGeometry: true });
  const realAssets = realScene.items.filter(item => item.type === 'image').map(item => ({ ...assets[0], id: item.id }));
  const realOutput = await createWordBytes(realDocument, realAssets, options);
  const realXml = await (await JSZip.loadAsync(realOutput.bytes)).file('word/document.xml').async('string');
  assert(realXml.includes('<m:limLow>'));
} finally { pageCanvas.width = pageCanvas.height = 0; await task.destroy(); }

assert.equal(mathClassificationText('𝗫𝑥𝛼𝟘ℛℝ'), 'Xxα0RR');
for (const literal of ['版本Ｖ１', 'ﬁ', '😀', 'x\u0304', '\u{1d455}']) {
  assert.equal(mathClassificationText(literal), literal, 'classification does not apply unrelated compatibility folds');
}
assert.equal(mathClassificationText(null), '');
assert.equal(mathClassificationText('x'.repeat(8193)), '');
assert.equal(mathUnicodeRunStyle('𝑋𝑥ℎ'), 'italic');
for(const text of ['x','版本Ｖ１','𝗫','𝔛','𝛼','𝟘','𝑋x','\u{1d455}',null,'𝑥'.repeat(2049)]){
  assert.equal(mathUnicodeRunStyle(text),null,'unverified or mixed alphabets cannot acquire native italic style');
}
assert(hasCompoundNativeMathRun('𝑦 = 𝑥', 'ABCDEF+XITSMath-Regular'));
assert(!hasCompoundNativeMathRun('𝑥', 'XITSMath-Regular'), 'one astral character is not a composite run');
assert(!hasCompoundNativeMathRun('𝑦 = 𝑥', 'UnverifiedMathFont'));
const composite = { ...glyph('unicode-prefix', '𝑦 = 𝑥', 20, 37), font: 'ABCDEF+XITSMath-Regular', color: '000000', preciseInk: true, raster: false,
  mathGlyphPositions: [
    { text: '𝑦', sourceOffset: 0, rect: { x: 20, y: 71, width: 7, height: 11 }, baseline: 80, baselineX: 20, advanceWidth: 8 },
    { text: '=', sourceOffset: 3, rect: { x: 33, y: 75, width: 8, height: 3 }, baseline: 80, baselineX: 33, advanceWidth: 9 },
    { text: '𝑥', sourceOffset: 5, rect: { x: 50, y: 74, width: 7, height: 7 }, baseline: 80, baselineX: 50, advanceWidth: 8 },
  ] };
const exponent = { ...glyph('exponent', '2', 58, 5), font: composite.font, color: '000000', preciseInk: true, raster: false,
  size: 8, baseline: 72, rect: { x: 58, y: 65, width: 5, height: 6 } };
const unicodeRegion = { ...region, id: 'unicode-equation', mathGlyphs: [composite, exponent], sourceIds: [composite.id, exponent.id],
  rect: { x: 20, y: 65, width: 43, height: 17 } };
const unicodeBefore = structuredClone(unicodeRegion), unicodePlan = planNativeMathRuns(unicodeRegion);
assert(unicodePlan);
const exponentNode = nodes(unicodePlan.ast).find(node => node.type === 'script');
assert.equal(exponentNode.base.text, '𝑥', 'the exponent belongs to x, not the entire y=x prefix');
assert.equal(exponentNode.superscript.text, '2');
assert.equal(nodes(inferMathAst(unicodeRegion)).find(node => node.type === 'script').base.text, '𝑦 = 𝑥', 'fixture reproduces the composite-base defect');
assert.deepEqual(unicodePlan.region.sourceIds, unicodeRegion.sourceIds);
assert.deepEqual(unicodePlan.region.mathGlyphs.find(g => g.id === exponentNode.base.sourceId).sourceRange, [5, 7],
  'source offsets remain UTF-16 while tokens preserve whole Unicode codepoints');
assert.deepEqual(unicodeRegion, unicodeBefore);
assert.equal(nativeMathReaderMode(inferMathAst(unicodeRegion), unicodeRegion), null, 'an unsplit composite cannot bypass the source-trace gate');
assert.equal(nativeMathReaderMode(unicodePlan.ast, unicodePlan.region), 'unicode');
const wrongSpelling = structuredClone(unicodePlan.ast);
nodes(wrongSpelling).find(node => node.type === 'symbol' && node.text === '𝑥').text = 'x';
assert.equal(nativeMathReaderMode(wrongSpelling, unicodePlan.region), null, 'classification normalization cannot rewrite the output spelling');
const cyclic = { type: 'row', children: [] }; cyclic.children.push(cyclic);
for (const bad of [cyclic, { type: 'row' }, { type: 'symbol' }, { type: 'matrix' }, { type: 'radical' }]) {
  assert.equal(nativeMathReaderMode(bad, unicodePlan.region), null, 'unknown/malformed structure is rejected within a fixed budget');
}
for (const mutate of [
  value => { value.mathGlyphs[0].font = 'UnknownMathFont'; },
  value => { value.mathGlyphs[0].rect.width = -1; },
  value => { value.mathGlyphs[0].size = 0; },
  value => { value.mathGlyphs[0].raster = true; },
  value => { value.mathGlyphs[0].color = 'untrusted'; },
  value => { value.mathGlyphs[0].bold = true; },
  value => { value.mathGlyphs[0].sourceRange[0] = -1; },
  value => { value.backgroundPaintIndexes = [1]; },
]) {
  const bad = structuredClone(unicodePlan.region); mutate(bad);
  assert.equal(nativeMathReaderMode(unicodePlan.ast, bad), null, 'source/style/geometry evidence remains mandatory');
}
for (const mutate of [
  g => { g.mathGlyphPositions[2].sourceOffset = 6; },
  g => { g.mathGlyphPositions[1].text = '+'; },
  g => { g.mathGlyphPositions[2].rect.x = 600; },
  g => { g.mathGlyphPositions[2].baseline += 1; },
  g => { g.font = 'UnverifiedMathFont'; },
  g => { g.raster = true; },
]) {
  const bad = structuredClone(unicodeRegion); mutate(bad.mathGlyphs[0]);
  assert.equal(planNativeMathRuns(bad), null);
}
const unicodeScene = { ...scene, items: [unicodeRegion], sources: unicodeRegion.mathGlyphs.map(g => ({ id: g.id, text: g.text, rect: g.rect, disposition: 'visible-image' })) };
const unicodeOutput = await createWordBytes(inferDocument([unicodeScene], { preserveGeometry: true }),
  [{ ...assets[0], id: unicodeRegion.id }], { ...options, strictMathGeometry: false });
assert.equal(unicodeOutput.quality.nativeFormulas, 1);
const unicodeStrict = await createWordBytes(inferDocument([unicodeScene], { preserveGeometry: true }),
  [{ ...assets[0], id: unicodeRegion.id }], { ...options, strictMathGeometry: true });
const unicodeXml = await (await JSZip.loadAsync(unicodeOutput.bytes)).file('word/document.xml').async('string');
assert.equal(await (await JSZip.loadAsync(unicodeStrict.bytes)).file('word/document.xml').async('string'), unicodeXml,
  'verified Unicode math keeps the reader-tested source frame');
const scriptXml = unicodeXml.match(/<m:sSup>[\s\S]*?<\/m:sSup>/)?.[0];
assert(scriptXml?.includes('<m:t>𝑥</m:t>') && !scriptXml.includes('𝑦'), 'actual OMML retains the correct Unicode base');
const unicodeRuns=[...unicodeXml.matchAll(/<m:r>[\s\S]*?<\/m:r>/g)].map(m=>m[0]).filter(s=>/<m:t>[𝑦𝑥]<\/m:t>/u.test(s));
assert.equal(unicodeRuns.length,2);
for(const run of unicodeRuns){
 assert(run.includes('<m:sty m:val="i"/>'),'intrinsic italic is explicitly preserved for reader save/reopen');
 assert(!run.includes('<m:nor m:val="1"/>'),'normal-text mode would lose intrinsic italic during reader folding');
}
const unsupportedAlphabet=structuredClone(unicodePlan.region),unsupportedAst=structuredClone(unicodePlan.ast);
const unsupportedGlyph=unsupportedAlphabet.mathGlyphs.find(g=>g.text==='𝑦');unsupportedGlyph.text='𝗬';
nodes(unsupportedAst).find(n=>n.sourceId===unsupportedGlyph.id).text='𝗬';
assert.equal(nativeMathReaderMode(unsupportedAst,unsupportedAlphabet),null,'unverified alphabet save behavior remains outside the reader policy');
const stretch = { text: '(', font: 'ABCDEF+XITSMath-Regular', size: 12, baseline: 526.355,
  rect: { x: 20, y: 507.563, width: 4.368, height: 22.14 }, preciseInk: true, raster: false };
assert(Math.abs(mathGlyphBaseline(stretch) - 521.633) < .0001);
for (const invalid of [{ raster: true }, { preciseInk: false }, { font: 'UnknownStretch' }, { text: 'x' }]) {
  assert.equal(mathGlyphBaseline({ ...stretch, ...invalid }), stretch.baseline);
}
console.log('Math limit runs: real glyph partitions, centered ownership, bounded provenance rejection, DOCX limits and immutable source ledger passed.');
