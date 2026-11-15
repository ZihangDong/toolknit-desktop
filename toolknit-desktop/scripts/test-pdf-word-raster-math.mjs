import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { rasterMathComponents, rasterMathComponentLayout, rasterMathReadings, rasterMathTokens, rasterMathCandidates } from '../src/features/pdf-to-word/core/raster-math-layout.js';
import { enlargeRasterMath } from '../src/features/pdf-to-word/core/raster-math-resample.js';
import { createRasterMathRecovery } from '../src/features/pdf-to-word/adapters/raster-math.js';
import { inferMathAst, validateMathAst } from '../src/features/pdf-to-word/core/math.js';
import { nativeMathReaderMode } from '../src/features/pdf-to-word/core/native-math-policy.js';
import { sceneLayoutBytes } from '../src/features/pdf-to-word/core/scene-budget.js';
import { recoverPageRasterMath } from '../src/features/pdf-to-word/raster-math-pipeline.js';
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { snapshotPage } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { buildPageScene } from '../src/features/pdf-to-word/core/scene.js';
import { rasterMathIndexReferences, validRasterIndexReference } from '../src/features/pdf-to-word/core/raster-math-context.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';

const canvas = createCanvas(220, 64), context = canvas.getContext('2d');
context.fillStyle = 'white'; context.fillRect(0, 0, 220, 64); context.fillStyle = 'black';
context.font = '24px Arial'; context.fillText('A', 12, 40); context.fillText('=', 44, 40);
context.font = '26px "Cambria Math"'; context.fillText('∑', 80, 42);
context.font = 'italic 24px "Times New Roman"'; context.fillText('b', 122, 40); context.fillText('e', 156, 40);
context.font = 'italic 13px "Times New Roman"'; context.fillText('i', 134, 45); context.fillText('i', 168, 45);
context.font = '24px Arial'; context.fillText('.', 191, 40);
const pixels = context.getImageData(0, 0, 220, 64).data;
const layout = rasterMathComponents(pixels, 220, 64);
assert(layout, 'independently drawn first-level subscript equation has complete ownership');
assert.equal(layout.units.length, 6); assert.equal(layout.units.filter(unit => unit.subscript).length, 2);
const ids = layout.units.flatMap(unit => [...unit.base.ids, ...(unit.subscript?.ids || [])]);
assert.equal(new Set(ids).size, layout.components.length); assert.equal(ids.length, layout.components.length);
assert.deepEqual(rasterMathComponentLayout(layout.components, 220, 64).units, layout.units);
const reading = factor => ({ width: 220 * factor, height: 64 * factor,
  lines: [{ text: 'A = ∑ biei.', words: [...'A = ∑ biei.'].map(text => ({ text, confidence: text === '∑' ? .79 : .99 })) }] });
const raw = [reading(2), reading(4)], observations = rasterMathReadings(raw);
assert(observations); assert.equal(rasterMathTokens(layout, observations).length, 6);
assert.equal(rasterMathTokens(null, observations), null);
assert.equal(rasterMathComponents(new Uint8Array(pixels), 220, 64), null);
assert.equal(rasterMathComponents(pixels, 221, 64), null);
assert.equal(rasterMathComponents(new Uint8ClampedArray(220 * 64 * 4).fill(255), 220, 64), null);
assert.equal(rasterMathComponentLayout([...layout.components, layout.components[0]], 220, 64), null);
for (const mutation of [value => { value[1].width = value[0].width; value[1].height = value[0].height; },
  value => { value[1].lines[0].words[4].text = 'Σ'; }, value => { value[0].lines[0].words[0].confidence = NaN; },
  value => { value[0].lines[0].words[0] = null; }, value => { value[0].lines[0].text = 'x'.repeat(1000); }]) {
  const invalid = structuredClone(raw); mutation(invalid); assert.equal(rasterMathReadings(invalid), null);
}
const source = { id: 'p1:i7:image', type: 'image', role: 'figure', rect: { x: 20, y: 30, width: 110, height: 32 },
  rasterSource: { operation: 7, rect: { x: 20, y: 30, width: 110, height: 32 } }, sourceIds: [], drawingIds: ['p1:i7'], reasons: [], baseline: 62, size: 16 };
assert.deepEqual(rasterMathCandidates({ items: [source] }), [source]);
assert.deepEqual(rasterMathCandidates({ items: [source, { type: 'text', rect: source.rect }] }), []);
assert.deepEqual(rasterMathCandidates({ rasterPage: true, items: [source] }), []);
const resampled = enlargeRasterMath(pixels, 220, 64, 2);
assert.equal(resampled.width, 440); assert.equal(resampled.height, 128);
assert(resampled.pixels.every((value, index) => index % 4 !== 3 || value === 255));
assert.equal(enlargeRasterMath(pixels, 220, 64, 1000), null);
const recovery = createRasterMathRecovery(createCanvas);
const probe = await recovery.probe({ item: source, pixels, width: 220, height: 64 });
assert(probe); assert.equal(probe.readings.length, 2); assert.match(probe.pixelSha256, /^[0-9a-f]{64}$/);
const recovered = recovery.recover({ imageId: source.id, pixelSha256: probe.pixelSha256, readings: raw });
assert(recovered, 'verified synthetic OCR observations require source pixels and source-bound glyph fit');
const region = recovered.item, ast = inferMathAst(region);
assert(ast); assert(validateMathAst(ast, region)); assert.equal(nativeMathReaderMode(ast, region), 'ocr-structure');
assert(region.mathGlyphs.every(glyph => glyph.raster === true && glyph.ocr === true));
assert(region.mathGlyphs.some(glyph => glyph.ocrEvidence.confidence === .79), 'never replace genuine recognition confidence with .98');
assert(sceneLayoutBytes({ items: [region], sources: recovered.sources }) > 10000);
assert.equal(recovery.recover({ imageId: source.id, pixelSha256: probe.pixelSha256, readings: raw }), null, 'pending source pixels are consumed once');
for (const mutation of [r => { r.mathGlyphs[0].raster = false; }, r => { r.mathGlyphs[0].text = 'B'; },
  r => { r.rasterMathEvidence.components[0].id = 99; }, r => { r.rasterMathEvidence.visibleRect.height = 1; },
  r => { r.sourceIds.reverse(); }, r => { r.mathGlyphs[0].rect.x += 1; }, r => { r.mathGlyphs[0].ocrEvidence.confidence = 1; },
  r => { r.rasterMathEvidence.readings[0].characters[0].confidence = NaN; }, r => { r.rasterMathEvidence = {}; },
  r => { r.drawingIds = ['p1:i999']; }, r => { r.rasterSource.rect.x += 1; }, r => { r.mathGlyphs[0].baseline = 1e10; },
  r => { r.rect = null; }, r => { r.rasterMathEvidence.width = 999999999; }]) {
  const invalid = structuredClone(region); mutation(invalid); assert.equal(inferMathAst(invalid), null); assert.equal(nativeMathReaderMode(ast, invalid), null);
}
const wrongAst = structuredClone(ast); [wrongAst.children[3].base, wrongAst.children[3].subscript] = [wrongAst.children[3].subscript, wrongAst.children[3].base];
assert.equal(validateMathAst(wrongAst, region), false, 'source-conserving base/index swaps still fail');
const legacy = structuredClone(region); delete legacy.rasterMathEvidence;
assert.equal(inferMathAst(legacy), null, 'no relaxation of old native/ASCII OCR guards');
const proof2 = await recovery.probe({ item: source, pixels, width: 220, height: 64 }); recovery.clear();
assert.equal(recovery.recover({ imageId: source.id, pixelSha256: proof2.pixelSha256, readings: raw }), null);
const requests = [], allocated = [], integrated = { items: [structuredClone(source)], sources: [], characters: 0 };
const workerRecovery = createRasterMathRecovery(createCanvas);
const worker = { request: async (type, data) => {
  requests.push(type);
  if (type === 'raster-math-probe') return workerRecovery.probe(data);
  if (type === 'raster-math-recover') return workerRecovery.recover(data);
  if (type === 'raster-math-clear') { workerRecovery.clear(); return true; }
  throw Error('Unknown request');
} };
const nativeImage = { bitmap: canvas, width: 220, height: 64 };
const page = { getOperatorList: async () => ({ fnArray: Array(8).fill(85), argsArray: Array(8).fill(['fixture-image', 220, 64]) }),
  objs: { get: () => nativeImage } };
const operation = { abort: new AbortController(), check() { if (this.abort.signal.aborted) throw Error('cancelled'); } };
// NAPI replaces zero-sized canvases with defaults. Record the release request;
// actual zero-sized browser canvases are covered by the conversion regression.
const allocate = (width, height) => {
  const c = createCanvas(width, height), released = new Set(); allocated.push(released);
  return { get width() { return c.width; }, set width(value) { if (!value) released.add('width'); c.width = value; },
    get height() { return c.height; }, set height(value) { if (!value) released.add('height'); c.height = value; }, getContext: (...args) => c.getContext(...args) };
};
let calls = 0;
assert.equal(await recoverPageRasterMath({ scene: integrated, page, ops: { paintImageXObject: 85 }, worker,
  recognizePage: async c => { calls++; return reading(c.width / 220); }, operation, createCanvas: allocate, remaining: 1 }), 1);
assert.equal(calls, 2); assert.equal(integrated.characters, 8); assert(inferMathAst(integrated.items[0]));
assert.deepEqual(requests, ['raster-math-probe', 'raster-math-recover', 'raster-math-clear']);
assert(allocated.every(released => released.has('width') && released.has('height'))); assert.equal(canvas.width, 220, 'PDF.js owns the source bitmap');
const beforeFailure = { items: [structuredClone(source)], sources: [], characters: 0 }, savedFailure = structuredClone(beforeFailure);
await assert.rejects(recoverPageRasterMath({ scene: beforeFailure, page, ops: { paintImageXObject: 85 }, worker,
  recognizePage: async () => { operation.abort.abort(); operation.check(); }, operation, createCanvas: allocate, remaining: 1 }), /cancelled/);
assert.deepEqual(beforeFailure, savedFailure); assert(allocated.every(released => released.has('width') && released.has('height')));
assert.equal(requests.at(-1), 'raster-math-clear');
const unknown = { ...page, getOperatorList: async () => ({ fnArray: [85], argsArray: [['other', 1e9, 1e9]] }) };
assert.equal(await recoverPageRasterMath({ scene: beforeFailure, page: unknown, ops: { paintImageXObject: 85 }, worker,
  recognizePage: () => { throw Error('Must not invoke model'); }, operation: { ...operation, check() {} }, createCanvas: allocate, remaining: 0 }), 0);
const transparentPixels = new Uint8ClampedArray(pixels); transparentPixels[3] = 0;
assert.equal(rasterMathComponents(transparentPixels, 220, 64), null, 'transparent original backgrounds cannot be disguised as white');
const graphicPdf = await PDFDocument.create(), graphic = await graphicPdf.embedPng(canvas.toBuffer('image/png'));
for (let mode = 0; mode < 4; mode++) {
  const p = graphicPdf.addPage([300, 250]);
  p.drawImage(graphic, { x: 20, y: 80, width: 110, height: 32, opacity: mode === 1 ? .5 : 1, rotate: degrees(mode === 3 ? 90 : 0) });
  if (mode === 2) p.drawRectangle({ x: 40, y: 90, width: 20, height: 10, color: rgb(1, 1, 1) });
}
const loading = getDocument({ data: await graphicPdf.save(), useSystemFonts: false, verbosity: 0 });
try {
  const document = await loading.promise;
  for (let index = 1; index <= 4; index++) {
    const p = await document.getPage(index), scene = buildPageScene(await snapshotPage(p, OPS));
    assert.equal(rasterMathCandidates(scene).length, index === 1 ? 1 : 0,
      'real PDF opacity, later white cover and rotated pictures must preserve visible fallback without raw OCR');
    p.cleanup();
  }
} finally { await loading.destroy(); }
const referenceGlyph = (id, text, rect, size, baseline) => ({ id, text, rect, size, baseline, font: 'ABCDEF+Cambria-Italic',
  raster: false, preciseInk: true, italic: true, bold: false, color: '000000' });
const reference = { base: referenceGlyph('p1:t200', 'nb', { x: 30, y: 70, width: 12, height: 8 }, 11, 78),
  subscript: referenceGlyph('p1:t201', 'i', { x: 43, y: 74, width: 2, height: 5 }, 7, 79) };
const referenceRegion = { id: 'p1:t200:image', role: 'math', sourceIds: ['p1:t200', 'p1:t201'], mathGlyphs: [reference.base, reference.subscript], mathStrokes: [], reasons: [], drawingIds: [] };
assert(validRasterIndexReference(reference, source.id, source.rect));
assert.equal(rasterMathIndexReferences({ items: [referenceRegion] }, source).length, 1);
for (const mutate of [r => { r.base.raster = true; }, r => { r.base.font = 'Unknown'; }, r => { r.base.id = 'p2:t200'; },
  r => { r.subscript.baseline = 78; }, r => { r.subscript.size = 11; }]) {
  const invalid = structuredClone(reference); mutate(invalid); assert.equal(validRasterIndexReference(invalid, source.id, source.rect), false);
}
const compoundCanvas = createCanvas(220, 64), compoundContext = compoundCanvas.getContext('2d');
compoundContext.drawImage(canvas, 0, 0); compoundContext.fillStyle = 'black'; compoundContext.font = 'italic 24px "Times New Roman"'; compoundContext.fillText('n', 108, 40);
const compoundPixels = compoundContext.getImageData(0, 0, 220, 64).data;
const compoundReading = factor => ({ width: 220 * factor, height: 64 * factor,
  lines: [{ text: 'A=∑nbiei.', words: [...'A=∑nbiei.'].map(text => ({ text, confidence: .99 })) }] });
const compoundRecovery = createRasterMathRecovery(createCanvas);
const compoundProbe = await compoundRecovery.probe({ item: source, pixels: compoundPixels, width: 220, height: 64, indexReferences: [reference] });
assert(compoundProbe);
const compound = compoundRecovery.recover({ imageId: source.id, pixelSha256: compoundProbe.pixelSha256, readings: [compoundReading(2), compoundReading(4)] });
assert(compound, 'a source-proven named quantity owns its complete multi-letter base');
const compoundAst = inferMathAst(compound.item), indexed = compoundAst.children.find(node => node.type === 'script');
assert.equal(indexed.base.type, 'row'); assert.deepEqual(indexed.base.children.map(node => node.text), ['n', 'b']);
assert.equal(compound.item.rasterMathEvidence.indexReferences.length, 1);
const brokenReference = structuredClone(compound.item); brokenReference.rasterMathEvidence.indexReferences[0].base.text = 'xb';
assert.equal(inferMathAst(brokenReference), null, 'unused or altered native references cannot authorize compound indices');
const swappedBase = structuredClone(compoundAst); swappedBase.children.find(node => node.type === 'script').base.children.reverse();
assert.equal(validateMathAst(swappedBase, compound.item), false, 'base member order remains source-bound');
const compoundDoc = inferDocument([{ number: 1, width: 300, height: 250, items: [compound.item], sources: compound.sources, rules: [], risks: ['ocr'], characters: 9 }], { preserveGeometry: true });
const compoundWord = await createWordBytes(compoundDoc, [{ id: compound.item.id, bytes: compoundCanvas.toBuffer('image/png'), width: 220, height: 64 }],
  { preserveGeometry: true, editableMath: true, strictMathGeometry: true, measurementContext: createCanvas(1, 1).getContext('2d') });
assert.equal(compoundWord.quality.nativeFormulas, 1);
const compoundXml = xml2js(await (await JSZip.loadAsync(compoundWord.bytes)).file('word/document.xml').async('string'));
const nodes = (node, name) => [...(node.name === name ? [node] : []), ...(node.elements || []).flatMap(child => nodes(child, name))];
const bases = nodes(compoundXml, 'm:sSub').map(node => nodes(node.elements.find(child => child.name === 'm:e'), 'm:t').map(t => t.elements?.[0]?.text || '').join(''));
assert(bases.includes('nb'), 'actual OMML keeps both letters inside the subscript base');
compoundCanvas.width = compoundCanvas.height = 0;
canvas.width = canvas.height = 0;
console.log('Raster math: complete source ownership, bounded original-image scaling, paired literal OCR, truthful provenance, typed AST, stale/clear and semantic mutation guards passed. Synthetic observations are not recognition-accuracy evidence.');
