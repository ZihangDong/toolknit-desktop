import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { PDFDocument, PDFName } from 'pdf-lib';
import sharp from 'sharp';
import { parsePdfInstructions } from '../src/features/pdf-object-remove/lexer.js';
import { validateInlineImageSamples } from '../src/features/pdf-object-remove/content-stream.js';
import { analyzeRemovalPdf, buildRemovalPdf } from '../src/features/pdf-object-remove/processor.js';
import { exactRemovalMatches, removalPages, REMOVE_LIMITS } from '../src/features/pdf-object-remove/core.js';
import { inlineRemovalFixture, nestedFormRemovalFixture, encodeFixturePrediction } from './lib/pdf-object-fixtures.mjs';

const root = path.resolve('tmp/pdf-inline-predictor'), run = promisify(execFile), checks = [], files = [];
await mkdir(root, { recursive: true });
const { context } = await PDFDocument.create();
const check = (value, name) => { assert.ok(value, name); checks.push(name); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const parameters = (predictor, colors = 3, bits = 8, columns = 2) =>
  `<< /Predictor ${predictor} /Colors ${colors} /BitsPerComponent ${bits} /Columns ${columns} >>`;
function inline(data, { width = 2, height = 2, bits = 8, color = 'RGB', params = parameters(15),
  filter = '/Fl', wrapped = false } = {}) {
  return Buffer.concat([Buffer.from(`BI /W ${width} /H ${height} /BPC ${bits} /CS /${color} /F ${filter} /DP ${params} ID\n`),
    wrapped ? Buffer.from(data.toString('hex') + '>') : data, Buffer.from('\nEI\nq Q\n')]);
}
async function validate(bytes, budget = { bytes: 0 }) {
  const instructions = parsePdfInstructions(bytes);
  await validateInlineImageSamples(instructions, context, budget);
  return instructions;
}
async function singlePage(content) {
  const document = await PDFDocument.create(), page = document.addPage([120, 120]);
  page.node.set(PDFName.of('Contents'), document.context.register(document.context.flateStream(content)));
  return document.save();
}
async function save(name, bytes) {
  const file = path.join(root, name + '.pdf'); await writeFile(file, bytes); return file;
}
const samples = Buffer.from([12, 30, 200, 90, 22, 55, 20, 90, 23, 44, 55, 200]);
const predicted = encodeFixturePrediction(samples, { predictor: 15, rowBytes: 6, pixelBytes: 3 });
const packed = deflateSync(predicted);
for (const params of ['null', '<< >>', '<< /Predictor 1 >>', '[null]']) {
  const ops = await validate(inline(deflateSync(samples), { params }));
  assert.equal(ops[0].image.prediction, undefined);
}
check(true, 'Null, empty and identity parameters preserve existing Flate behavior');

for (const predictor of [2, 10, 11, 12, 13, 14, 15]) {
  const encoded = encodeFixturePrediction(samples, { predictor, rowBytes: 6, pixelBytes: 3 });
  const budget = { bytes: 0 }, ops = await validate(inline(deflateSync(encoded), { params: parameters(predictor) }), budget);
  assert.equal(budget.bytes, encoded.length);
  assert.equal(ops[0].image.prediction.encodedLength, encoded.length);
}
check(true, 'TIFF 8-bit and all six PNG predictors include row overhead in the decoding budget');

// The same compressed samples render differently as raw samples and TIFF residuals.
const identity = inline(deflateSync(samples), { params: parameters(1) });
const tiff = inline(deflateSync(samples), { params: parameters(2) });
const fingerprintPdf = await singlePage(Buffer.concat([identity, tiff]));
const fingerprints = await analyzeRemovalPdf(fingerprintPdf);
check(fingerprints.candidates.length === 2 && exactRemovalMatches(fingerprints.candidates,
  fingerprints.candidates[0], removalPages('', 1)).length === 1,
  'Different prediction semantics never match solely because the compressed bytes and position match');

for (const params of [
  parameters(0), parameters(3), parameters(16), parameters(12.5), parameters(12, 1), parameters(12, 3, 4), parameters(12, 3, 8, 3),
  '<< /Predictor 12 >>', '<< /Predictor /PNG >>', '<< /Predictor true >>', '<< /Predictor 12 /Columns 0 >>',
  '<< /Predictor 12 /Predictor 15 >>', '<< /Predictor 12 /BPC 8 /BitsPerComponent 8 >>',
  '<< /Predictor 12 /Unknown 1 >>', '<< /Predictor 12 /Colors >>', '[]', '[null null]', '[12]',
]) assert.throws(() => parsePdfInstructions(inline(packed, { params })), /pdf-remove:inline/);
for (const params of [parameters(15), `[${parameters(15)} null]`, `[<< >> ${parameters(15)}]`, `[null]`]) {
  assert.throws(() => parsePdfInstructions(inline(packed, { filter: '[/AHx /Fl]', wrapped: true, params })), /pdf-remove:inline/);
}
assert.throws(() => parsePdfInstructions(inline(packed, { filter: '/AHx', params: parameters(15) })), /pdf-remove:inline/);
assert.throws(() => parsePdfInstructions(inline(packed, { bits: 4, params: parameters(2, 3, 8) })), /pdf-remove:inline/);
assert.throws(() => parsePdfInstructions(inline(packed, { width: 1, height: REMOVE_LIMITS.streamBytes, color: 'G', params: parameters(15, 1, 8, 1) })), /pdf-remove:inline/);
assert.throws(() => parsePdfInstructions(Buffer.from(inline(packed).toString('latin1').replace('/DP ', '/DecodeParms null /DP '), 'latin1')), /pdf-remove:inline/);
check(true, 'Unknown, duplicate, malformed, mismatched and unsupported prediction parameters fail before decompression');

const invalidTag = Buffer.from(predicted); invalidTag[7] = 5;
for (const data of [invalidTag, predicted.subarray(0, -1), Buffer.concat([predicted, Buffer.from([0])])]) {
  await assert.rejects(() => validate(inline(deflateSync(data))), /pdf-remove:inline/);
}
const badChecksum = Buffer.from(packed); badChecksum[badChecksum.length - 1] ^= 1;
for (const data of [badChecksum, packed.subarray(0, -1), Buffer.concat([packed, Buffer.from([0])])]) {
  await assert.rejects(() => validate(inline(data)), /pdf-remove:inline/);
}
await assert.rejects(() => validate(inline(packed), { bytes: REMOVE_LIMITS.decodedBytes - predicted.length + 1 }), /pdf-remove:decoded/);
await assert.rejects(() => validate(inline(packed, { wrapped: true, filter: '[/AHx /Fl]', params: `[null ${parameters(15)}]` }),
  { bytes: REMOVE_LIMITS.decodedBytes - packed.length - predicted.length + 1 }), /pdf-remove:decoded/);
check(true, 'Invalid PNG row tags, row lengths, zlib trailers and both stages of the decode budget are enforced');

const beforeHash = digest(fingerprintPdf);
const mixed = await PDFDocument.create();
for (const data of [deflateSync(invalidTag), packed]) {
  const page = mixed.addPage([120, 120]);
  page.node.set(PDFName.of('Contents'), mixed.context.register(mixed.context.flateStream(inline(data))));
}
const mixedBytes = await mixed.save(), mixedAnalysis = await analyzeRemovalPdf(mixedBytes);
assert.deepEqual(mixedAnalysis.summary.pages.map(page => [page.reason, page.count]), [['inline', 0], [null, 1]]);
const mixedResult = await PDFDocument.load(await buildRemovalPdf(mixedAnalysis, [mixedAnalysis.candidates[0].id]));
const originalBad = (await PDFDocument.load(mixedBytes)).getPage(0).node.Contents().getContents();
check(Buffer.from(mixedResult.getPage(0).node.Contents().getContents()).equals(originalBad) && digest(fingerprintPdf) === beforeHash,
  'An invalid predictor preserves its page stream while a valid image on another page remains removable');
await save('mixed', mixedBytes);

const rawSource = await save('raw-source', await inlineRemovalFixture());
const rawExpected = await save('raw-expected', await inlineRemovalFixture(false));
for (const predictor of [2, 10, 11, 12, 13, 14, 15]) for (const encoding of ['flate', 'hex-flate', 'ascii85-flate']) {
  const name = `${predictor === 2 ? 'tiff' : 'png'}${predictor}-${encoding}`;
  const bytes = await inlineRemovalFixture(true, encoding, predictor), hash = digest(bytes);
  const analysis = await analyzeRemovalPdf(bytes), images = analysis.candidates.filter(item => item.pageIndex === 0 && item.kind === 'inline-image');
  assert.equal(images.length, 3, name); assert.ok(analysis.summary.pages.every(page => !page.reason), name);
  const ids = exactRemovalMatches(analysis.candidates, images[2], removalPages('', 2));
  assert.equal(ids.length, 2, name); assert.ok(!ids.includes(images[0].id) && !ids.includes(images[1].id), name);
  const result = await buildRemovalPdf(analysis, ids), reopened = await analyzeRemovalPdf(result);
  assert.deepEqual(reopened.summary.pages.map(page => page.count), [3, 3], name);
  assert.equal(digest(bytes), hash);
  files.push({ name, source: await save(name + '-source', bytes), removed: await save(name + '-removed', result) });
}
check(files.length === 21, 'Twenty-one TIFF/PNG and ASCII wrapping combinations preserve exact matching, body text and input bytes');

const depthFiles = [];
for (const bits of [1, 2, 4, 8]) for (const [color, colors] of [['G', 1], ['RGB', 3], ['CMYK', 4]]) {
  const width = 5, height = 5, rowBytes = Math.ceil(width * colors * bits / 8), pixelBytes = Math.ceil(colors * bits / 8);
  const data = Buffer.from(Array.from({ length: rowBytes * height }, (_, at) => (at * 31 + 73) % 256));
  const rows = encodeFixturePrediction(data, { predictor: 15, rowBytes, pixelBytes });
  const bytes = inline(deflateSync(rows), { width, height, bits, color, params: parameters(15, colors, bits, width) });
  await validate(bytes);
  const raw = inline(deflateSync(data), { width, height, bits, color, params: 'null' });
  const name = `png15-${color}-${bits}`;
  const display = content => Buffer.concat([Buffer.from('q 100 0 0 100 10 10 cm\n'), content, Buffer.from('Q\n')]);
  depthFiles.push({ name, source: await save(name + '-source', await singlePage(display(bytes))),
    expected: await save(name + '-expected', await singlePage(display(raw))) });
}
check(depthFiles.length === 12, 'PNG adaptive rows accept packed 1/2/4/8-bit Gray/RGB/CMYK samples and all five row tags');

const nestedBytes = await nestedFormRemovalFixture([], [], 15), nestedAnalysis = await analyzeRemovalPdf(nestedBytes);
const nestedTarget = nestedAnalysis.candidates.find(item => item.kind === 'inline-image');
assert.ok(nestedTarget);
const nestedIds = exactRemovalMatches(nestedAnalysis.candidates, nestedTarget, removalPages('', 3));
assert.equal(nestedIds.length, 2);
const nestedRemoved = await save('nested-removed', await buildRemovalPdf(nestedAnalysis, nestedIds));
const nestedExpected = await save('nested-expected', await nestedFormRemovalFixture([], [0, 1], 15));
check(true, 'Predicted images in nested shared Forms remove only the selected invocations');

let pixelChecks = 0;
if (process.platform === 'win32' && !process.env.TOOLKNIT_REMOVE_SKIP_NATIVE) {
  const poppler = process.env.TOOLKNIT_PDFTOPPM || 'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1119-907-0_26.1119.907.0_x64__3k8sg7r9htsxt/dependencies/native/poppler/Library/bin/pdftoppm.exe';
  const qpdf = path.resolve('src-tauri/resources/qpdf/qpdf.exe');
  const rendered = new Set();
  async function render(file) {
    if (rendered.has(file)) return;
    await run(poppler, ['-r', '96', '-png', file, file.slice(0, -4)], { windowsHide: true }); rendered.add(file);
  }
  async function compare(actual, expected, pages) {
    await render(actual); await render(expected);
    for (let page = 1; page <= pages; page++) {
      const a = await sharp(actual.slice(0, -4) + `-${page}.png`).raw().toBuffer();
      const b = await sharp(expected.slice(0, -4) + `-${page}.png`).raw().toBuffer();
      assert.ok(a.equals(b), `${path.basename(actual)} page ${page} differs from the raw/clean reference`); pixelChecks++;
    }
  }
  for (const file of files) {
    await run(qpdf, ['--check', file.removed], { windowsHide: true });
    await compare(file.source, rawSource, 2); await compare(file.removed, rawExpected, 2);
  }
  for (const file of depthFiles) await compare(file.source, file.expected, 1);
  await run(qpdf, ['--check', nestedRemoved], { windowsHide: true });
  await compare(nestedRemoved, nestedExpected, 3);
  check(pixelChecks === 99, 'Independent Poppler renders pass 99 page comparisons; qpdf accepts all 22 edited outputs');
}
await writeFile(path.join(root, 'report.json'), JSON.stringify({ checks, predictorVariants: files.length, depthVariants: depthFiles.length,
  pixelChecks, nativeChecksSkipped: Boolean(process.env.TOOLKNIT_REMOVE_SKIP_NATIVE) || process.platform !== 'win32' }, null, 2));
console.log(`PDF inline prediction passed: ${checks.length} groups, ${files.length} filter variants, ${depthFiles.length} depth variants, ${pixelChecks} independent pixel checks.`);
