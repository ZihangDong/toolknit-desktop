import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import sharp from 'sharp';
import { scanRunLength, decodeRunLength } from '../src/features/pdf-object-remove/run-length.js';
import { parsePdfInstructions } from '../src/features/pdf-object-remove/lexer.js';
import { decodeRemovalStream, validateInlineImageSamples } from '../src/features/pdf-object-remove/content-stream.js';
import { analyzeRemovalPdf, buildRemovalPdf } from '../src/features/pdf-object-remove/processor.js';
import { exactRemovalMatches, removalPages, REMOVE_LIMITS } from '../src/features/pdf-object-remove/core.js';
import { inlineRemovalFixture, encodeFixtureRunLength, encodeFixtureAscii85 } from './lib/pdf-object-fixtures.mjs';

const root = path.resolve('tmp/pdf-run-length'), run = promisify(execFile), checks = [], variants = [], references = new Map();
await mkdir(root, { recursive: true });
const N = PDFName.of, { context } = await PDFDocument.create();
const check = (value, label) => { assert.ok(value, label); checks.push(label); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const rawStream = (bytes, entries) => PDFRawStream.of(context.obj(entries), Buffer.from(bytes));
async function save(name, bytes) { const file = path.join(root, name + '.pdf'); await writeFile(file, bytes); return file; }

for (let control = 0; control <= 127; control++) {
  const bytes = Buffer.from(Array.from({ length: control + 1 }, (_, at) => (at * 97 + 128) % 256));
  assert.deepEqual(Buffer.from(decodeRunLength(Buffer.concat([Buffer.from([control]), bytes, Buffer.from([128])]), 1024)), bytes);
}
for (let control = 129; control <= 255; control++) {
  assert.deepEqual(Buffer.from(decodeRunLength(Buffer.from([control, 128, 128]), 1024)), Buffer.alloc(257 - control, 128));
}
for (const count of [0, 1, 2, 3, 127, 128, 129, 256, 1000]) for (const repeated of [false, true]) {
  const bytes = Buffer.from(Array.from({ length: count }, (_, at) => repeated ? 128 : (at * 29) % 256));
  const encoded = encodeFixtureRunLength(bytes);
  assert.deepEqual(Buffer.from(decodeRunLength(encoded, 1024)), bytes);
  assert.deepEqual(Buffer.from(decodePDFRawStream(rawStream(encoded, { Filter: N('RunLengthDecode') })).decode()), bytes);
}
check(true, 'Every literal/repeat control, embedded EOD-valued samples, empty input and packet boundaries match pdf-lib decoding');

for (const bytes of [[], [0], [0, 1], [2, 1, 2, 128], [129], [128, 0], [128, 128]]) {
  assert.throws(() => decodeRunLength(Buffer.from(bytes), 1024), /pdf-remove:stream/);
}
for (const limit of [127, -1]) assert.throws(() => decodeRunLength(Buffer.from([129, 65, 128]), limit), /pdf-remove:decoded/);
assert.deepEqual(scanRunLength(Buffer.from([11, 22, 0, 128, 128, 33]), 2, 5, 1), { end: 5, length: 1 });
check(true, 'RunLength requires EOD, rejects truncated packets/trailing data and measures output before allocation');

const plain = Buffer.from('q Q\n'), encoded = encodeFixtureRunLength(plain), budget = { bytes: 0 };
const chain = { Filter: [N('ASCIIHexDecode'), N('RunLengthDecode')], DecodeParms: [null, null] };
assert.equal(Buffer.from(await decodeRemovalStream(rawStream(encoded.toString('hex') + '>', chain), budget)).toString(), plain.toString());
assert.equal(budget.bytes, encoded.length + plain.length);
await assert.rejects(() => decodeRemovalStream(rawStream(encoded, { Filter: N('RunLengthDecode') }), { bytes: REMOVE_LIMITS.decodedBytes - plain.length + 1 }), /pdf-remove:decoded/);
await assert.rejects(() => decodeRemovalStream(rawStream(encoded.toString('hex') + '>', chain), { bytes: REMOVE_LIMITS.decodedBytes - encoded.length - plain.length + 1 }), /pdf-remove:decoded/);
for (const dict of [
  { Filter: [N('RunLengthDecode'), N('ASCIIHexDecode')] },
  { Filter: [N('ASCIIHexDecode'), N('RunLengthDecode'), N('FlateDecode')] },
  { Filter: N('RunLengthDecode'), DecodeParms: {} },
  { ...chain, DecodeParms: [null] }, { ...chain, DecodeParms: [null, { Predictor: 1 }] },
]) await assert.rejects(() => decodeRemovalStream(rawStream(encoded, dict), { bytes: 0 }), /pdf-remove:filter/);
check(true, 'Page/Form streams support only bounded single RunLength or outer ASCII wrappers with aligned null parameters');

function inline(data, { width = 4, filter = '/RL', parms = '', wrapped = false } = {}) {
  return Buffer.concat([Buffer.from(`BI /W ${width} /H 1 /BPC 8 /CS /G /F ${filter}${parms} ID\n`),
    wrapped ? Buffer.from(data.toString('hex') + '>') : data, Buffer.from('\nEI\nq Q\n')]);
}
for (const filter of ['/RL', '/RunLengthDecode', '[/RunLengthDecode]']) {
  const instructions = parsePdfInstructions(inline(encoded, { filter })), used = { bytes: 0 };
  await validateInlineImageSamples(instructions, context, used);
  assert.equal(instructions[0].image.encoding, 'RunLengthDecode'); assert.equal(used.bytes, plain.length);
}
for (const parms of [' /DP null', ' /DP [null]']) {
  await validateInlineImageSamples(parsePdfInstructions(inline(encoded, { parms })), context, { bytes: 0 });
}
await validateInlineImageSamples(parsePdfInstructions(inline(encoded, {
  filter: '[/AHx /RL]', wrapped: true, parms: ' /DecodeParms [null null]',
})), context, { bytes: 0 });
const ambiguous = encodeFixtureRunLength(Buffer.from('EI Q'));
assert.throws(() => parsePdfInstructions(inline(ambiguous)), /pdf-remove:inline/);
await validateInlineImageSamples(parsePdfInstructions(inline(ambiguous, { filter: '[/AHx /RL]', wrapped: true })), context, { bytes: 0 });
for (const bytes of [encoded.subarray(0, -1), Buffer.concat([encoded, Buffer.from([0])])]) {
  assert.throws(() => parsePdfInstructions(inline(bytes)), /pdf-remove:inline/);
  await assert.rejects(() => validateInlineImageSamples(parsePdfInstructions(inline(bytes, { filter: '[/AHx /RL]', wrapped: true })), context, { bytes: 0 }), /pdf-remove:inline/);
}
assert.throws(() => parsePdfInstructions(inline(encoded, { width: 3 })), /pdf-remove:inline/);
assert.throws(() => parsePdfInstructions(inline(encoded, { parms: ' /DP << /Predictor 1 >>' })), /pdf-remove:inline/);
const split = inline(encoded), boundary = split.indexOf('ID\n') + 4;
assert.throws(() => parsePdfInstructions(split, { streamEnds: [boundary, split.length] }), /pdf-remove:inline/);
await assert.rejects(() => validateInlineImageSamples(parsePdfInstructions(inline(encoded)), context,
  { bytes: REMOVE_LIMITS.decodedBytes - plain.length + 1 }), /pdf-remove:decoded/);
check(true, 'Inline aliases use exact EOD/sample length, reject early EI/stream splits/parameters, and enforce the shared budget');

function fixtureStream(ctx, content, encoding, entries = {}) {
  const packed = encodeFixtureRunLength(Buffer.from(content));
  if (encoding === 'runlength') return PDFRawStream.of(ctx.obj({ ...entries, Filter: N('RunLengthDecode') }), packed);
  const outer = encoding === 'hex-runlength' ? 'ASCIIHexDecode' : 'ASCII85Decode';
  const bytes = outer === 'ASCIIHexDecode' ? Buffer.from(packed.toString('hex') + '>') : encodeFixtureAscii85(packed);
  return PDFRawStream.of(ctx.obj({ ...entries, Filter: [N(outer), N('RunLengthDecode')], DecodeParms: [null, null] }), bytes);
}
async function pageFixture(withTarget) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (const encoding of ['runlength', 'hex-runlength', 'ascii85-runlength']) {
    const page = doc.addPage([320, 230]); page.node.set(N('Resources'), doc.context.obj({ Font: { F0: font.ref } }));
    const content = '0.94 0.96 0.9 rg 0 0 320 230 re f\n0 0 0 rg\nBT /F0 17 Tf 20 180 Td (RunLength searchable body) Tj ET\n'
      + (withTarget ? 'BT /F0 28 Tf 75 95 Td (RUN LENGTH DRAFT) Tj ET\n' : '');
    page.node.set(N('Contents'), doc.context.register(fixtureStream(doc.context, content, encoding)));
  }
  return doc.save();
}
const pageSource = await pageFixture(true), pageAnalysis = await analyzeRemovalPdf(pageSource);
const pageTarget = pageAnalysis.candidates.find(item => item.label === 'RUN LENGTH DRAFT');
const pageIds = exactRemovalMatches(pageAnalysis.candidates, pageTarget, removalPages('', 3));
assert.equal(pageIds.length, 3);
const pageRemoved = await save('page-removed', await buildRemovalPdf(pageAnalysis, pageIds));
const pageExpected = await save('page-expected', await pageFixture(false)); await save('page-source', pageSource);
check(true, 'RunLength page streams and both ASCII wrappers match three watermark occurrences and preserve searchable body text');

async function formFixture(removeOnPages = []) {
  const doc = await PDFDocument.create(), ctx = doc.context, font = await doc.embedFont(StandardFonts.Helvetica);
  const inner = target => ctx.register(fixtureStream(ctx,
    '0.2 0.45 0.7 rg 5 7 80 12 re f\n0 0 0 rg BT /F0 10 Tf 5 30 Td (RunLength form body) Tj ET\n'
    + (target ? 'BT /F0 13 Tf 5 55 Td (RUN LENGTH FORM) Tj ET\n' : ''), 'hex-runlength',
    { Type: N('XObject'), Subtype: N('Form'), BBox: [0, 0, 140, 85], Resources: { Font: { F0: font.ref } } }));
  const shared = inner(true), clean = inner(false);
  const outer = first => ctx.register(fixtureStream(ctx, 'q /First Do Q\nq 1 0 0 1 155 0 cm /Repeat Do Q\n', 'runlength',
    { Type: N('XObject'), Subtype: N('Form'), BBox: [0, 0, 310, 90], Resources: { XObject: { First: first, Repeat: shared } } }));
  const original = outer(shared), edited = outer(clean);
  for (let index = 0; index < 3; index++) {
    const page = doc.addPage([350, 230]);
    page.node.set(N('Resources'), ctx.obj({ Font: { F0: font.ref }, XObject: { Outer: removeOnPages.includes(index) ? edited : original } }));
    const x = index === 2 ? 25 : 10;
    const content = `BT /F0 17 Tf 20 190 Td (RunLength page body) Tj ET\nq 1 0 0 1 ${x} 65 cm /Outer Do Q\n`;
    page.node.set(N('Contents'), ctx.register(fixtureStream(ctx, content, 'ascii85-runlength')));
  }
  return doc.save();
}
const formSource = await formFixture(), formAnalysis = await analyzeRemovalPdf(formSource);
const formTarget = formAnalysis.candidates.find(item => item.label === 'RUN LENGTH FORM'); assert.ok(formTarget);
const formIds = exactRemovalMatches(formAnalysis.candidates, formTarget, removalPages('', 3)); assert.equal(formIds.length, 2);
const formRemoved = await save('form-removed', await buildRemovalPdf(formAnalysis, formIds));
const formExpected = await save('form-expected', await formFixture([0, 1])); await save('form-source', formSource);
const formAfter = await analyzeRemovalPdf(await readFile(formRemoved));
check(formAfter.candidates.filter(item => item.label === 'RUN LENGTH FORM').length === 4,
  'Nested shared RunLength Forms isolate two selected invocations while retaining repeated and differently positioned calls');

for (const bits of [1, 2, 4, 8, 16]) for (const color of ['G', 'RGB', 'CMYK']) for (const encoding of ['runlength', 'hex-runlength', 'ascii85-runlength']) {
  const name = `${color}-${bits}-${encoding}`, key = `${color}-${bits}`, options = { bits, color, width: 5, height: 5 };
  if (!references.has(key)) references.set(key, {
    source: await save(key + '-reference-source', await inlineRemovalFixture(true, 'raw', 1, options)),
    expected: await save(key + '-reference-expected', await inlineRemovalFixture(false, 'raw', 1, options)),
  });
  const bytes = await inlineRemovalFixture(true, encoding, 1, options), before = hash(bytes), analysis = await analyzeRemovalPdf(bytes);
  const images = analysis.candidates.filter(item => item.pageIndex === 0 && item.kind === 'inline-image'); assert.equal(images.length, 3, name);
  const targets = exactRemovalMatches(analysis.candidates, images[2], removalPages('', 2)); assert.equal(targets.length, 2, name);
  assert.ok(!targets.includes(images[0].id) && !targets.includes(images[1].id), name);
  const output = await buildRemovalPdf(analysis, targets), after = await analyzeRemovalPdf(output);
  assert.deepEqual(after.summary.pages.map(page => [page.reason, page.count]), [[null, 3], [null, 3]], name);
  assert.equal(hash(bytes), before);
  variants.push({ name, key, source: await save(name + '-source', bytes), removed: await save(name + '-removed', output) });
}
check(variants.length === 45, '45 bit-depth/color/filter variants preserve exact matching, other images and input bytes');

const mixed = await PDFDocument.create();
for (const payload of [Buffer.concat([encoded, Buffer.from([0])]), encoded]) {
  const page = mixed.addPage([120, 120]);
  page.node.set(N('Contents'), mixed.context.register(mixed.context.flateStream(inline(payload, { filter: '[/AHx /RL]', wrapped: true }))));
}
const mixedBytes = await mixed.save(), mixedAnalysis = await analyzeRemovalPdf(mixedBytes);
assert.deepEqual(mixedAnalysis.summary.pages.map(page => [page.reason, page.count]), [['inline', 0], [null, 1]]);
const mixedOutput = await PDFDocument.load(await buildRemovalPdf(mixedAnalysis, [mixedAnalysis.candidates[0].id]));
const mixedInput = await PDFDocument.load(mixedBytes);
assert.deepEqual(mixedOutput.getPage(0).node.Contents().getContents(), mixedInput.getPage(0).node.Contents().getContents());
await save('mixed', mixedBytes);
check(true, 'Trailing encoded bytes preserve the affected original page while a valid image on the next page remains removable');

let pixelChecks = 0, pdfjsComparisons = 0;
if (process.platform === 'win32' && !process.env.TOOLKNIT_REMOVE_SKIP_NATIVE) {
  const poppler = process.env.TOOLKNIT_PDFTOPPM || 'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1119-907-0_26.1119.907.0_x64__3k8sg7r9htsxt/dependencies/native/poppler/Library/bin/pdftoppm.exe';
  const qpdf = path.resolve('src-tauri/resources/qpdf/qpdf.exe'), rendered = new Set(), pdfjsCache = new Map();
  async function render(file) {
    if (rendered.has(file)) return;
    await run(poppler, ['-r', '96', '-png', file, file.slice(0, -4)], { windowsHide: true }); rendered.add(file);
  }
  async function pdfjsPixels(file) {
    if (pdfjsCache.has(file)) return pdfjsCache.get(file);
    const job = getDocument({ data: new Uint8Array(await readFile(file)), verbosity: 0, useSystemFonts: true });
    try {
      const page = await (await job.promise).getPage(1), viewport = page.getViewport({ scale: 96 / 72 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height)), ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const pixels = Buffer.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data); pdfjsCache.set(file, pixels); return pixels;
    } finally { await job.destroy(); }
  }
  async function compare(a, b, pages) {
    await render(a); await render(b);
    for (let page = 1; page <= pages; page++) {
      const actual = await sharp(a.slice(0, -4) + `-${page}.png`).raw().toBuffer();
      const expected = await sharp(b.slice(0, -4) + `-${page}.png`).raw().toBuffer();
      assert.ok(actual.equals(expected), `${path.basename(a)} page ${page}`); pixelChecks++;
    }
    assert.ok((await pdfjsPixels(a)).equals(await pdfjsPixels(b)), `PDF.js ${path.basename(a)}`); pdfjsComparisons++;
  }
  for (const item of variants) {
    await run(qpdf, ['--check', item.removed], { windowsHide: true });
    const reference = references.get(item.key);
    await compare(item.source, reference.source, 2); await compare(item.removed, reference.expected, 2);
  }
  for (const [actual, expected] of [[pageRemoved, pageExpected], [formRemoved, formExpected]]) {
    await run(qpdf, ['--check', actual], { windowsHide: true }); await compare(actual, expected, 3);
  }
  check(pixelChecks === 186 && pdfjsComparisons === 92, 'Poppler passes 186 page and PDF.js 92 first-page comparisons; qpdf accepts 47 edited outputs');
}
await writeFile(path.join(root, 'report.json'), JSON.stringify({ checks, inlineVariants: variants.length, pixelChecks, pdfjsComparisons,
  nativeChecksSkipped: Boolean(process.env.TOOLKNIT_REMOVE_SKIP_NATIVE) || process.platform !== 'win32' }, null, 2));
console.log(`PDF RunLength passed: ${checks.length} groups, ${variants.length} inline variants, ${pixelChecks} Poppler pages, ${pdfjsComparisons} PDF.js comparisons.`);
