import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { parsePdfInstructions } from '../src/features/pdf-object-remove/lexer.js';
import { validateInlineImageSamples, decodeRemovalStream } from '../src/features/pdf-object-remove/content-stream.js';
import { analyzeRemovalPdf, buildRemovalPdf } from '../src/features/pdf-object-remove/processor.js';
import { exactRemovalMatches, removalPages, REMOVE_LIMITS } from '../src/features/pdf-object-remove/core.js';
import { encodeFixturePrediction, encodeFixtureLzw, inlineRemovalFixture, nestedFormRemovalFixture } from './lib/pdf-object-fixtures.mjs';
import { pdfRemovalRenderQa } from './lib/pdf-removal-render-qa.mjs';

const qa = await pdfRemovalRenderQa('tmp/pdf-lzw-predictor'), checks = [], cases = [], variants = [], references = new Map();
const { context } = await PDFDocument.create(), N = PDFName.of;
const check = (value, label) => { assert.ok(value, label); checks.push(label); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const samples = Buffer.from(Array.from({ length: 75 }, (_, at) => (at * 31 + 73) % 256));
const geometry = predictor => ` /Predictor ${predictor} /Colors 3 /BitsPerComponent 8 /Columns 5`;
function inline(data, { earlyChange = 1, predictor = 15, wrapped = false, parameters,
  width = 5, height = 5, bits = 8, color = 'RGB' } = {}) {
  const dict = parameters ?? `<< /EarlyChange ${earlyChange}${geometry(predictor)} >>`;
  return Buffer.concat([Buffer.from(`BI /W ${width} /H ${height} /CS /${color} /BPC ${bits} /F ${wrapped ? '[/AHx /LZW]' : '/LZW'} /DP ${wrapped ? `[null ${dict}]` : dict} ID\n`),
    wrapped ? Buffer.from(data.toString('hex') + '>') : data, Buffer.from('\nEI\nq Q\n')]);
}
async function validate(bytes, budget = { bytes: 0 }) {
  const instructions = parsePdfInstructions(bytes); await validateInlineImageSamples(instructions, context, budget); return instructions;
}
for (const earlyChange of [0, 1]) for (const predictor of [2, 10, 11, 12, 13, 14, 15]) {
  const rows = encodeFixturePrediction(samples, { predictor, rowBytes: 15, pixelBytes: 3 });
  const packed = encodeFixtureLzw(rows, earlyChange), budget = { bytes: 0 };
  const ops = await validate(inline(packed, { earlyChange, predictor }), budget);
  assert.equal(ops[0].image.prediction.predictor, predictor); assert.equal(ops[0].image.lzw.earlyChange, earlyChange);
  assert.equal(budget.bytes, rows.length);
  const wrappedBudget = { bytes: 0 };
  await validate(inline(packed, { earlyChange, predictor, wrapped: true }), wrappedBudget);
  assert.equal(wrappedBudget.bytes, packed.length + rows.length);
}
check(true, 'Both EarlyChange modes support TIFF/PNG residuals and count row tags plus ASCII intermediate data');

const rows = encodeFixturePrediction(samples, { predictor: 15, rowBytes: 15, pixelBytes: 3 }), packed = encodeFixtureLzw(rows);
await validate(inline(packed, { parameters: `<<${geometry(15)} >>` }));
for (const parameters of [
  '<< /EarlyChange 2' + geometry(15) + ' >>', '<< /EarlyChange 0 /EarlyChange 1' + geometry(15) + ' >>',
  '<< /EarlyChange 1 /Predictor 3 >>', '<< /EarlyChange 1 /Predictor 15 /Colors 1 /Columns 5 >>',
  '<< /EarlyChange 1 /Predictor 15 /Colors 3 /Columns 6 >>',
  '<< /EarlyChange 1 /Predictor 15 /Colors 3 /Columns 5 /BPC 8 /BitsPerComponent 8 >>',
  '<< /EarlyChange 1 /Predictor 15 /Colors 3 /Columns 5 /Unknown 1 >>',
]) assert.throws(() => parsePdfInstructions(inline(packed, { parameters })), /pdf-remove:inline/);
for (const bits of [1, 2, 4, 16]) {
  assert.throws(() => parsePdfInstructions(inline(packed, { bits, parameters: `<< /EarlyChange 1 /Predictor 15 /Colors 3 /Columns 5 /BPC ${bits} >>` })), /pdf-remove:inline/);
}
assert.throws(() => parsePdfInstructions(inline(packed, { bits: 16, predictor: 2,
  parameters: '<< /EarlyChange 1 /Predictor 2 /Colors 3 /Columns 5 /BitsPerComponent 16 >>' })), /pdf-remove:inline/);
const unaligned = Buffer.from(inline(packed).toString('latin1').replace('/F /LZW', '/F [/LZW]'), 'latin1');
assert.throws(() => parsePdfInstructions(unaligned), /pdf-remove:inline/);
check(true, 'Geometry, duplicate aliases, unaligned parameters and existing TIFF16/non-8-bit BPC restrictions remain enforced');

const badTag = Buffer.from(rows); badTag[16] = 5;
for (const decoded of [badTag, rows.subarray(0, -1), Buffer.concat([rows, Buffer.from([0])])]) {
  const data = encodeFixtureLzw(decoded);
  await assert.rejects(() => validate(inline(data, { wrapped: true })), /pdf-remove:inline/);
}
for (const data of [packed.subarray(0, -1), Buffer.concat([packed, Buffer.from([0])])]) {
  await assert.rejects(() => validate(inline(data, { wrapped: true })), /pdf-remove:inline/);
}
await assert.rejects(() => validate(inline(packed), { bytes: REMOVE_LIMITS.decodedBytes - rows.length + 1 }), /pdf-remove:decoded/);
await assert.rejects(() => validate(inline(packed, { wrapped: true }), { bytes: REMOVE_LIMITS.decodedBytes - packed.length - rows.length + 1 }), /pdf-remove:decoded/);
await assert.rejects(() => decodeRemovalStream(PDFRawStream.of(context.obj({ Filter: N('LZWDecode'), DecodeParms: { Predictor: 15, Colors: 5 } }), packed), { bytes: 0 }), /pdf-remove:filter/);
check(true, 'Bad PNG tags/length, LZW truncation/trailers and decoded budgets fail safely; predicted page content stays excluded');

for (const earlyChange of [0, 1]) for (const predictor of [2, 10, 11, 12, 13, 14, 15]) for (const encoding of ['lzw', 'hex-lzw', 'ascii85-lzw']) {
  cases.push({ name: `p${predictor}-ec${earlyChange}-${encoding}`, key: 'RGB-8', predictor, encoding,
    options: { earlyChange, width: 5, height: 5, bits: 8, color: 'RGB' } });
}
const depthProfiles = [...[1, 2, 4].flatMap(bits => ['G', 'RGB', 'CMYK'].map(color => ({ bits, color, predictor: 2 }))),
  ...[1, 2, 4, 16].flatMap(bits => ['G', 'RGB', 'CMYK'].map(color => ({ bits, color, predictor: 15 })))];
for (const [index, profile] of depthProfiles.entries()) {
  const earlyChange = index % 2, encoding = ['lzw', 'hex-lzw', 'ascii85-lzw'][index % 3];
  cases.push({ name: `depth-p${profile.predictor}-${profile.color}-${profile.bits}-ec${earlyChange}-${encoding}`,
    key: `${profile.color}-${profile.bits}`, predictor: profile.predictor, encoding,
    options: { earlyChange, width: 5, height: 5, bits: profile.bits, color: profile.color } });
}
let seed = 12345;
const large = Buffer.from(Array.from({ length: 16384 }, () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed & 255; }));
for (const earlyChange of [0, 1]) for (const encoding of ['lzw', 'hex-lzw', 'ascii85-lzw']) {
  cases.push({ name: `long-p15-ec${earlyChange}-${encoding}`, key: 'long-G-8', predictor: 15, encoding,
    options: { earlyChange, width: 128, height: 128, bits: 8, color: 'G', sampleBytes: large } });
}
for (const item of cases) {
  if (!references.has(item.key)) references.set(item.key, {
    source: await qa.save(item.key + '-reference-source', await inlineRemovalFixture(true, 'raw', 1, item.options)),
    expected: await qa.save(item.key + '-reference-expected', await inlineRemovalFixture(false, 'raw', 1, item.options)),
  });
  const bytes = await inlineRemovalFixture(true, item.encoding, item.predictor, item.options), before = hash(bytes);
  const analysis = await analyzeRemovalPdf(bytes), images = analysis.candidates.filter(candidate => candidate.pageIndex === 0 && candidate.kind === 'inline-image');
  assert.equal(images.length, 3, item.name);
  const ids = exactRemovalMatches(analysis.candidates, images[2], removalPages('', 2)); assert.equal(ids.length, 2, item.name);
  assert.ok(!ids.includes(images[0].id) && !ids.includes(images[1].id), item.name);
  const output = await buildRemovalPdf(analysis, ids), after = await analyzeRemovalPdf(output);
  assert.deepEqual(after.summary.pages.map(page => [page.reason, page.count]), [[null, 3], [null, 3]], item.name);
  assert.equal(after.candidates.filter(candidate => candidate.label === 'Body after inline images').length, 2, item.name);
  assert.equal(hash(bytes), before);
  variants.push({ name: item.name, key: item.key, source: await qa.save(item.name + '-source', bytes), removed: await qa.save(item.name + '-removed', output) });
}
check(variants.length === 69, '42 predictor/EarlyChange/wrapper, 21 depth/color and six long dictionary-switch images retain exact matches and source bytes');

const formPairs = [];
for (const earlyChange of [0, 1]) for (const predictor of [2, 15]) {
  const imageOptions = { lzw: true, earlyChange }, bytes = await nestedFormRemovalFixture([], [], predictor, imageOptions);
  const analysis = await analyzeRemovalPdf(bytes), target = analysis.candidates.find(candidate => candidate.kind === 'inline-image'); assert.ok(target);
  const ids = exactRemovalMatches(analysis.candidates, target, removalPages('', 3)); assert.equal(ids.length, 2);
  const output = await buildRemovalPdf(analysis, ids), reopened = await analyzeRemovalPdf(output);
  assert.equal(reopened.candidates.filter(candidate => candidate.kind === 'inline-image').length, 4);
  const name = `form-p${predictor}-ec${earlyChange}`;
  await qa.save(name + '-source', bytes);
  formPairs.push({ removed: await qa.save(name + '-removed', output),
    expected: await qa.save(name + '-expected', await nestedFormRemovalFixture([], [0, 1], predictor, imageOptions)) });
}
check(formPairs.length === 4, 'Both EarlyChange modes and TIFF/PNG images inside nested Forms keep unselected shared calls intact');

const mixed = await PDFDocument.create();
for (const data of [encodeFixtureLzw(badTag), packed]) {
  const page = mixed.addPage([120, 120]); page.node.set(N('Contents'), mixed.context.register(mixed.context.flateStream(inline(data, { wrapped: true }))));
}
const mixedBytes = await mixed.save(), mixedAnalysis = await analyzeRemovalPdf(mixedBytes);
assert.deepEqual(mixedAnalysis.summary.pages.map(page => [page.reason, page.count]), [['inline', 0], [null, 1]]);
const editedMixed = await PDFDocument.load(await buildRemovalPdf(mixedAnalysis, [mixedAnalysis.candidates[0].id]));
assert.deepEqual(editedMixed.getPage(0).node.Contents().getContents(), (await PDFDocument.load(mixedBytes)).getPage(0).node.Contents().getContents());
await qa.save('mixed', mixedBytes);
check(true, 'An invalid predicted image preserves its original page while the valid image on the next page remains editable');

// The same encoded residuals can be valid under multiple declarations; keep their fingerprints distinct.
const same = await PDFDocument.create(), sheet = same.addPage([120, 120]);
sheet.node.set(N('Contents'), same.context.register(same.context.flateStream(Buffer.concat([inline(packed, { predictor: 10 }), inline(packed, { predictor: 15 })]))));
const sameAnalysis = await analyzeRemovalPdf(await same.save());
check(sameAnalysis.candidates.length === 2 && exactRemovalMatches(sameAnalysis.candidates, sameAnalysis.candidates[0], removalPages('', 1)).length === 1,
  'Prediction parameters stay in the exact-match fingerprint even when compressed residual bytes coincide');

for (const item of variants) {
  await qa.verify(item.removed); const reference = references.get(item.key);
  await qa.compare(item.source, reference.source, 2); await qa.compare(item.removed, reference.expected, 2);
}
for (const item of formPairs) { await qa.verify(item.removed); await qa.compare(item.removed, item.expected, 3); }
const rendered = qa.report();
if (!rendered.nativeChecksSkipped) check(rendered.pixelChecks === 288 && rendered.pdfjsComparisons === 142 && rendered.qpdfChecks === 73,
  'Poppler 288-page and PDF.js 142 first-page comparisons agree; qpdf accepts 73 edited outputs');
await writeFile(path.join(qa.root, 'report.json'), JSON.stringify({ checks, inlineVariants: variants.length, predictorProfiles: 42, depthColorProfiles: 21,
  longImages: 6, nestedFormProfiles: 4, ...rendered }, null, 2));
console.log(`PDF LZW prediction passed: ${checks.length} groups, ${variants.length} image profiles, ${rendered.pixelChecks} Poppler pages, ${rendered.pdfjsComparisons} PDF.js comparisons.`);
