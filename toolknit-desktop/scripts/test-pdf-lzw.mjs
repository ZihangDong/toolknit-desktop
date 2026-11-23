import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { scanLzw, decodeLzw } from '../src/features/pdf-object-remove/lzw.js';
import { parsePdfInstructions } from '../src/features/pdf-object-remove/lexer.js';
import { decodeRemovalStream, validateInlineImageSamples } from '../src/features/pdf-object-remove/content-stream.js';
import { analyzeRemovalPdf, buildRemovalPdf } from '../src/features/pdf-object-remove/processor.js';
import { exactRemovalMatches, removalPages, REMOVE_LIMITS } from '../src/features/pdf-object-remove/core.js';
import { inlineRemovalFixture, encodeFixtureLzw, packFixtureLzwCodes, encodeFixtureAscii85 } from './lib/pdf-object-fixtures.mjs';
import { pdfRemovalRenderQa } from './lib/pdf-removal-render-qa.mjs';

const qa = await pdfRemovalRenderQa('tmp/pdf-lzw'), checks = [], variants = [], references = new Map(), N = PDFName.of;
const { context } = await PDFDocument.create(), digest = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (value, label) => { assert.ok(value, label); checks.push(label); };
let state = 12345;
const random = Buffer.from(Array.from({ length: 50000 }, () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state & 255; }));
const rawStream = (bytes, entries) => PDFRawStream.of(context.obj(entries), Buffer.from(bytes));
for (const earlyChange of [0, 1]) for (const resetOnFull of [false, true]) {
  for (const bytes of [Buffer.alloc(0), Buffer.from('A'.repeat(10000)), ...[1, 253, 254, 255, 256, 765, 2046, 4096, 50000].map(length => random.subarray(0, length))]) {
    const encoded = encodeFixtureLzw(bytes, earlyChange, { resetOnFull });
    assert.deepEqual(Buffer.from(decodeLzw(encoded, 50000, earlyChange)), bytes);
    const other = decodePDFRawStream(rawStream(encoded, { Filter: N('LZWDecode'), DecodeParms: { EarlyChange: earlyChange } })).decode();
    assert.deepEqual(Buffer.from(other), bytes);
  }
  assert.equal(Buffer.from(decodeLzw(packFixtureLzwCodes([256, 65, 258, 259, 257], earlyChange), 10, earlyChange)).toString(), 'AAAAAA');
  assert.equal(Buffer.from(decodeLzw(packFixtureLzwCodes([256, 65, 66, 256, 67, 68, 257], earlyChange), 10, earlyChange)).toString(), 'ABCD');
}
check(true, 'EarlyChange 0/1, 9–12-bit widths, full/saturated dictionaries, resets and special new words agree with pdf-lib');

const short = encodeFixtureLzw(Buffer.from('q Q\n')), padding = packFixtureLzwCodes([256, 65, 257]); padding[padding.length - 1] |= 1;
for (const bytes of [Buffer.alloc(0), short.subarray(0, -1), Buffer.concat([short, Buffer.from([0])]), padding,
  ...[[65, 257], [256, 258, 257], [256, 65, 260, 257], [256, 65], [256, 65, 256, 258, 257]].map(codes => packFixtureLzwCodes(codes))]) {
  assert.throws(() => decodeLzw(bytes, 100), /pdf-remove:stream/);
}
assert.throws(() => decodeLzw(short, 3), /pdf-remove:decoded/);
assert.throws(() => decodeLzw(short, -1), /pdf-remove:decoded/);
assert.throws(() => decodeLzw(short, 10, 2), /pdf-remove:filter/);
assert.deepEqual(scanLzw(Buffer.concat([Buffer.from([9]), short, Buffer.from([10])]), 1, short.length + 1, 4), { end: short.length + 1, length: 4 });
check(true, 'Clear/EOD, legal dictionary references, zero final padding, exact stream end and preallocation limits are mandatory');

for (const earlyChange of [0, 1]) {
  const bytes = encodeFixtureLzw(random, earlyChange), used = { bytes: 0 };
  const entries = { Filter: [N('ASCIIHexDecode'), N('LZWDecode')], DecodeParms: [null, { EarlyChange: earlyChange, Predictor: 1 }] };
  assert.deepEqual(Buffer.from(await decodeRemovalStream(rawStream(bytes.toString('hex') + '>', entries), used)), random);
  assert.equal(used.bytes, bytes.length + random.length);
  await assert.rejects(() => decodeRemovalStream(rawStream(bytes.toString('hex') + '>', entries), { bytes: REMOVE_LIMITS.decodedBytes - bytes.length - random.length + 1 }), /pdf-remove:decoded/);
}
for (const value of [2, -1, 0.5, false, null, N('Default')]) {
  await assert.rejects(() => decodeRemovalStream(rawStream(short, { Filter: N('LZWDecode'), DecodeParms: { EarlyChange: value } }), { bytes: 0 }), /pdf-remove:filter/);
}
for (const settings of [{ Predictor: 12, Colors: 5 }, { Unknown: 1 }]) {
  await assert.rejects(() => decodeRemovalStream(rawStream(short, { Filter: N('LZWDecode'), DecodeParms: settings }), { bytes: 0 }), /pdf-remove:filter/);
}
await assert.rejects(() => decodeRemovalStream(rawStream(short, { Filter: [N('LZWDecode')], DecodeParms: { EarlyChange: 0 } }), { bytes: 0 }), /pdf-remove:filter/);
await assert.rejects(() => decodeRemovalStream(rawStream(short, { Filter: N('LZWDecode'), DecodeParms: [{ EarlyChange: 0 }] }), { bytes: 0 }), /pdf-remove:filter/);
check(true, 'Page/Form LZW stream parameters and each ASCII/decoded stage are validated independently');

function inline(bytes, { width = 4, filter = '/LZW', parms = '' , wrapped = false } = {}) {
  return Buffer.concat([Buffer.from(`BI /W ${width} /H 1 /BPC 8 /CS /G /F ${filter}${parms} ID\n`),
    wrapped ? Buffer.from(bytes.toString('hex') + '>') : bytes, Buffer.from('\nEI\nq Q\n')]);
}
for (const filter of ['/LZW', '/LZWDecode', '[/LZWDecode]']) {
  const instructions = parsePdfInstructions(inline(short, { filter }));
  await validateInlineImageSamples(instructions, context, { bytes: 0 });
  assert.equal(instructions[0].image.lzw.earlyChange, 1);
}
for (const parms of [' /DP null', ' /DP [null]', ' /DP << /EarlyChange 0 >>', ' /DecodeParms << /EarlyChange 1 /Predictor 1 >>']) {
  await validateInlineImageSamples(parsePdfInstructions(inline(short, { parms })), context, { bytes: 0 });
}
await validateInlineImageSamples(parsePdfInstructions(inline(short, { filter: '[/LZWDecode]', parms: ' /DP [<< /EarlyChange 0 >>]' })), context, { bytes: 0 });
assert.throws(() => parsePdfInstructions(inline(short, { filter: '[/LZWDecode]', parms: ' /DP << /EarlyChange 0 >>' })), /pdf-remove:inline/);
assert.throws(() => parsePdfInstructions(inline(short, { parms: ' /DP [<< /EarlyChange 0 >>]' })), /pdf-remove:inline/);
const ambiguous = packFixtureLzwCodes([256, 1, 42, 146, 0, 257]); assert.ok(ambiguous.includes('EI '));
assert.throws(() => parsePdfInstructions(inline(ambiguous)), /pdf-remove:inline/);
await validateInlineImageSamples(parsePdfInstructions(inline(ambiguous, { filter: '[/AHx /LZW]', parms: ' /DP [null << /EarlyChange 1 >>]', wrapped: true })), context, { bytes: 0 });
for (const parms of [' /DP << /EarlyChange 2 >>', ' /DP << /EarlyChange true >>', ' /DP << /EarlyChange 0 /EarlyChange 1 >>',
  ' /DP << /Predictor 12 >>', ' /DP << /Unknown 1 >>', ' /DP [null null]']) {
  assert.throws(() => parsePdfInstructions(inline(short, { parms })), /pdf-remove:inline/);
}
for (const bytes of [short.subarray(0, -1), Buffer.concat([short, Buffer.from([0])])]) {
  assert.throws(() => parsePdfInstructions(inline(bytes)), /pdf-remove:inline/);
  await assert.rejects(() => validateInlineImageSamples(parsePdfInstructions(inline(bytes, { filter: '[/AHx /LZW]', wrapped: true })), context, { bytes: 0 }), /pdf-remove:inline/);
}
assert.throws(() => parsePdfInstructions(inline(short, { width: 3 })), /pdf-remove:inline/);
const split = inline(short);
assert.throws(() => parsePdfInstructions(split, { streamEnds: [split.indexOf('ID\n') + 4, split.length] }), /pdf-remove:inline/);
await assert.rejects(() => validateInlineImageSamples(parsePdfInstructions(inline(short)), context, { bytes: REMOVE_LIMITS.decodedBytes - 3 }), /pdf-remove:decoded/);
check(true, 'Inline LZW aliases, explicit/default EarlyChange, exact sample length, ambiguous EI, split streams and invalid parameters are checked');

const fingerprints = await PDFDocument.create(), fingerprintPage = fingerprints.addPage([100, 100]);
fingerprintPage.node.set(N('Contents'), fingerprints.context.register(fingerprints.context.flateStream(Buffer.concat([
  inline(short, { parms: ' /DP << /EarlyChange 0 >>' }), inline(short, { parms: ' /DP << /EarlyChange 1 >>' }),
]))));
const fingerprintAnalysis = await analyzeRemovalPdf(await fingerprints.save());
check(fingerprintAnalysis.candidates.length === 2 && exactRemovalMatches(fingerprintAnalysis.candidates, fingerprintAnalysis.candidates[0], removalPages('', 1)).length === 1,
  'EarlyChange is part of the image fingerprint even when short compressed bytes happen to be identical');

function fixtureStream(ctx, content, encoding, earlyChange, entries = {}) {
  const bytes = encodeFixtureLzw(Buffer.from(content), earlyChange), settings = { EarlyChange: earlyChange, Predictor: 1 };
  if (encoding === 'lzw') return PDFRawStream.of(ctx.obj({ ...entries, Filter: N('LZWDecode'), DecodeParms: settings }), bytes);
  const outer = encoding === 'hex-lzw' ? 'ASCIIHexDecode' : 'ASCII85Decode';
  const wrapped = outer === 'ASCIIHexDecode' ? Buffer.from(bytes.toString('hex') + '>') : encodeFixtureAscii85(bytes);
  return PDFRawStream.of(ctx.obj({ ...entries, Filter: [N(outer), N('LZWDecode')], DecodeParms: [null, settings] }), wrapped);
}
const comments = '%' + random.toString('hex').match(/.{1,128}/g).join('\n%') + '\n';
async function pageFixture(withTarget) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (const early of [0, 1]) for (const encoding of ['lzw', 'hex-lzw', 'ascii85-lzw']) {
    const page = doc.addPage([320, 230]); page.node.set(N('Resources'), doc.context.obj({ Font: { F0: font.ref } }));
    const content = comments + 'BT /F0 17 Tf 20 180 Td (LZW searchable body) Tj ET\n'
      + (withTarget ? 'BT /F0 28 Tf 75 95 Td (LZW DRAFT) Tj ET\n' : '');
    page.node.set(N('Contents'), doc.context.register(fixtureStream(doc.context, content, encoding, early)));
  }
  return doc.save();
}
const pageSource = await pageFixture(true), pageAnalysis = await analyzeRemovalPdf(pageSource);
const pageTarget = pageAnalysis.candidates.find(item => item.label === 'LZW DRAFT'); assert.ok(pageTarget);
const pageIds = exactRemovalMatches(pageAnalysis.candidates, pageTarget, removalPages('', 6)); assert.equal(pageIds.length, 6);
const pageRemoved = await qa.save('page-removed', await buildRemovalPdf(pageAnalysis, pageIds));
const pageExpected = await qa.save('page-expected', await pageFixture(false)); await qa.save('page-source', pageSource);
check(true, 'Six long page streams exercise dictionary width transitions/reset in both EarlyChange modes and all three wrapper variants');

async function formFixture(removeOnPages = []) {
  const doc = await PDFDocument.create(), ctx = doc.context, font = await doc.embedFont(StandardFonts.Helvetica);
  const inner = target => ctx.register(fixtureStream(ctx, 'BT /F0 10 Tf 5 30 Td (LZW form body) Tj ET\n'
    + (target ? 'BT /F0 13 Tf 5 55 Td (LZW FORM) Tj ET\n' : ''), 'hex-lzw', 1,
    { Type: N('XObject'), Subtype: N('Form'), BBox: [0, 0, 140, 85], Resources: { Font: { F0: font.ref } } }));
  const shared = inner(true), clean = inner(false);
  const outer = first => ctx.register(fixtureStream(ctx, 'q /First Do Q\nq 1 0 0 1 155 0 cm /Repeat Do Q\n', 'lzw', 0,
    { Type: N('XObject'), Subtype: N('Form'), BBox: [0, 0, 310, 90], Resources: { XObject: { First: first, Repeat: shared } } }));
  const original = outer(shared), edited = outer(clean);
  for (let index = 0; index < 3; index++) {
    const page = doc.addPage([350, 230]);
    page.node.set(N('Resources'), ctx.obj({ Font: { F0: font.ref }, XObject: { Outer: removeOnPages.includes(index) ? edited : original } }));
    const content = `BT /F0 17 Tf 20 190 Td (LZW page body) Tj ET\nq 1 0 0 1 ${index === 2 ? 25 : 10} 65 cm /Outer Do Q\n`;
    page.node.set(N('Contents'), ctx.register(fixtureStream(ctx, content, 'ascii85-lzw', 0)));
  }
  return doc.save();
}
const formSource = await formFixture(), formAnalysis = await analyzeRemovalPdf(formSource);
const formTarget = formAnalysis.candidates.find(item => item.label === 'LZW FORM'); assert.ok(formTarget);
const formIds = exactRemovalMatches(formAnalysis.candidates, formTarget, removalPages('', 3)); assert.equal(formIds.length, 2);
const formRemoved = await qa.save('form-removed', await buildRemovalPdf(formAnalysis, formIds));
const formExpected = await qa.save('form-expected', await formFixture([0, 1])); await qa.save('form-source', formSource);
check((await analyzeRemovalPdf(await readFile(formRemoved))).candidates.filter(item => item.label === 'LZW FORM').length === 4,
  'Shared nested Forms mix EarlyChange modes and keep all unselected invocations');

const cases = [];
for (const earlyChange of [0, 1]) for (const bits of [1, 2, 4, 8, 16]) for (const color of ['G', 'RGB', 'CMYK']) for (const encoding of ['lzw', 'hex-lzw', 'ascii85-lzw']) {
  cases.push({ name: `${color}-${bits}-ec${earlyChange}-${encoding}`, key: `${color}-${bits}`, encoding,
    options: { width: 5, height: 5, bits, color, earlyChange } });
}
for (const earlyChange of [0, 1]) for (const encoding of ['lzw', 'hex-lzw', 'ascii85-lzw']) {
  cases.push({ name: `long-ec${earlyChange}-${encoding}`, key: 'long-G-8', encoding,
    options: { width: 128, height: 128, bits: 8, color: 'G', earlyChange, sampleBytes: random.subarray(0, 16384) } });
}
for (const item of cases) {
  if (!references.has(item.key)) references.set(item.key, {
    source: await qa.save(item.key + '-reference-source', await inlineRemovalFixture(true, 'raw', 1, item.options)),
    expected: await qa.save(item.key + '-reference-expected', await inlineRemovalFixture(false, 'raw', 1, item.options)),
  });
  const bytes = await inlineRemovalFixture(true, item.encoding, 1, item.options), before = digest(bytes);
  const analysis = await analyzeRemovalPdf(bytes), images = analysis.candidates.filter(candidate => candidate.pageIndex === 0 && candidate.kind === 'inline-image');
  assert.equal(images.length, 3, item.name);
  const ids = exactRemovalMatches(analysis.candidates, images[2], removalPages('', 2)); assert.equal(ids.length, 2, item.name);
  assert.ok(!ids.includes(images[0].id) && !ids.includes(images[1].id), item.name);
  const output = await buildRemovalPdf(analysis, ids), after = await analyzeRemovalPdf(output);
  assert.deepEqual(after.summary.pages.map(page => [page.reason, page.count]), [[null, 3], [null, 3]], item.name);
  assert.equal(digest(bytes), before);
  variants.push({ name: item.name, key: item.key, source: await qa.save(item.name + '-source', bytes), removed: await qa.save(item.name + '-removed', output) });
}
check(variants.length === 96, '90 depth/color/wrapper profiles and six long dictionary-switch images retain exact matches and source bytes');

const mixed = await PDFDocument.create();
for (const payload of [Buffer.concat([short, Buffer.from([0])]), short]) {
  const page = mixed.addPage([120, 120]); page.node.set(N('Contents'), mixed.context.register(mixed.context.flateStream(inline(payload, { filter: '[/AHx /LZW]', wrapped: true }))));
}
const mixedBytes = await mixed.save(), mixedAnalysis = await analyzeRemovalPdf(mixedBytes);
assert.deepEqual(mixedAnalysis.summary.pages.map(page => [page.reason, page.count]), [['inline', 0], [null, 1]]);
const mixedOutput = await PDFDocument.load(await buildRemovalPdf(mixedAnalysis, [mixedAnalysis.candidates[0].id]));
assert.deepEqual(mixedOutput.getPage(0).node.Contents().getContents(), (await PDFDocument.load(mixedBytes)).getPage(0).node.Contents().getContents());
await qa.save('mixed', mixedBytes); check(true, 'Bad LZW data keeps its original page while a valid adjacent image can be removed');

for (const item of variants) {
  await qa.verify(item.removed); const reference = references.get(item.key);
  await qa.compare(item.source, reference.source, 2); await qa.compare(item.removed, reference.expected, 2);
}
for (const [actual, expected, pages] of [[pageRemoved, pageExpected, 6], [formRemoved, formExpected, 3]]) {
  await qa.verify(actual); await qa.compare(actual, expected, pages);
}
const rendered = qa.report();
if (!rendered.nativeChecksSkipped) check(rendered.pixelChecks === 393 && rendered.pdfjsComparisons === 194 && rendered.qpdfChecks === 98,
  'Independent Poppler 393-page and PDF.js 194 first-page comparisons agree; qpdf accepts 98 edited outputs');
await writeFile(path.join(qa.root, 'report.json'), JSON.stringify({ checks, inlineVariants: variants.length, ...rendered }, null, 2));
console.log(`PDF LZW passed: ${checks.length} groups, ${variants.length} image variants, ${rendered.pixelChecks} Poppler pages, ${rendered.pdfjsComparisons} PDF.js comparisons.`);
