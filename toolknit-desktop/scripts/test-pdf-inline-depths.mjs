import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { PDFDocument, PDFName } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import sharp from 'sharp';
import { parsePdfInstructions } from '../src/features/pdf-object-remove/lexer.js';
import { validateInlineImageSamples } from '../src/features/pdf-object-remove/content-stream.js';
import { analyzeRemovalPdf, buildRemovalPdf } from '../src/features/pdf-object-remove/processor.js';
import { exactRemovalMatches, removalPages, REMOVE_LIMITS } from '../src/features/pdf-object-remove/core.js';
import { inlineRemovalFixture, encodeFixturePrediction } from './lib/pdf-object-fixtures.mjs';

const root = path.resolve('tmp/pdf-inline-depths'), run = promisify(execFile), checks = [], variants = [], references = new Map();
await mkdir(root, { recursive: true });
const check = (value, label) => { assert.ok(value, label); checks.push(label); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const { context } = await PDFDocument.create();
const dictionary = (bits, predictor = 2, colors = 1, columns = 3) =>
  `<< /Predictor ${predictor} /Colors ${colors} /BitsPerComponent ${bits} /Columns ${columns} >>`;
function inline(data, { bits = 16, width = 3, height = 2, color = 'G', params = dictionary(bits) } = {}) {
  // ASCII wrapping avoids accidental EI delimiters in arbitrary test samples.
  return Buffer.from(`BI /W ${width} /H ${height} /BPC ${bits} /CS /${color} /F [/AHx /Fl] /DP [null ${params}] ID\n${data.toString('hex')}>\nEI\n`);
}
async function validate(bytes, budget = { bytes: 0 }) {
  const instructions = parsePdfInstructions(bytes);
  await validateInlineImageSamples(instructions, context, budget);
  return instructions;
}
async function save(name, bytes) {
  const target = path.join(root, name + '.pdf'); await writeFile(target, bytes); return target;
}

const words = Buffer.from('00ff0100ff0080007fff0000', 'hex');
const delta = encodeFixturePrediction(words, { predictor: 2, rowBytes: 6, pixelBytes: 2, bits: 16, colors: 1, columns: 3 });
assert.equal(delta.toString('hex'), '00ff0001fe008000ffff8001');
const packed = deflateSync(delta), budget = { bytes: 0 };
assert.throws(() => parsePdfInstructions(inline(packed)), /pdf-remove:inline/);
const pngWords = encodeFixturePrediction(words, { predictor: 15, rowBytes: 6, pixelBytes: 2, bits: 16, colors: 1, columns: 3 });
const pngPacked = deflateSync(pngWords);
await validate(inline(pngPacked, { params: dictionary(16, 15) }), budget);
check(budget.bytes === pngPacked.length + pngWords.length,
  '16-bit PNG includes row tags in its budget; TIFF 16-bit remains rejected after the reader consistency probe');

// Three samples per row, with deliberately nonzero padding bits.
for (const [bits, bytes, expected] of [[1, [0xb7, 0x57], [0xf7, 0x77]], [2, [0x6b, 0xdb], [0x53, 0xe7]], [4, [0xf1, 0x2d, 0x23, 0x4e], [0xf2, 0x1d, 0x21, 0x1e]]]) {
  const data = Buffer.from(bytes), rowBytes = Math.ceil(3 * bits / 8);
  const residual = encodeFixturePrediction(data, { predictor: 2, rowBytes, pixelBytes: 1, bits, colors: 1, columns: 3 });
  assert.deepEqual([...residual], expected, `known ${bits}-bit samples`);
  await validate(inline(deflateSync(residual), { bits }));
}
check(true, 'Packed 1/2/4-bit TIFF samples preserve row padding and use sample/channel differences');

for (const bits of [0, 3, 12, 32]) assert.throws(() => parsePdfInstructions(inline(packed, { bits })), /pdf-remove:inline/);
for (const bits of [1, 2, 4, 16]) {
  assert.throws(() => parsePdfInstructions(inline(pngPacked, { bits, params: dictionary(bits, 15).replace('BitsPerComponent', 'BPC') })), /pdf-remove:inline/);
}
for (const params of [dictionary(8, 15), dictionary(16, 15, 3), dictionary(16, 15, 1, 4)]) {
  assert.throws(() => parsePdfInstructions(inline(packed, { params })), /pdf-remove:inline/);
}
for (const residual of [pngWords.subarray(0, -1), Buffer.concat([pngWords, Buffer.from([0])])]) {
  await assert.rejects(() => validate(inline(deflateSync(residual), { params: dictionary(16, 15) })), /pdf-remove:inline/);
}
await assert.rejects(() => validate(inline(pngPacked, { params: dictionary(16, 15) }), { bytes: REMOVE_LIMITS.decodedBytes - pngPacked.length - pngWords.length + 1 }), /pdf-remove:decoded/);
assert.throws(() => parsePdfInstructions(inline(packed, { width: REMOVE_LIMITS.streamBytes, height: 2,
  params: dictionary(16, 15, 1, REMOVE_LIMITS.streamBytes) })), /pdf-remove:inline/);
check(true, 'Unsupported depth, conflicting geometry, odd 16-bit rows and decoding limits remain rejected');

// Predictors change interpretation, so identical packed bits must not be matched.
const identity = inline(pngPacked, { width: 7, height: 1, params: '<< /Predictor 1 >>' });
const differential = inline(pngPacked, { params: dictionary(16, 15) });
const fingerprintDoc = await PDFDocument.create(), fingerprintPage = fingerprintDoc.addPage([120, 120]);
fingerprintPage.node.set(PDFName.of('Contents'), fingerprintDoc.context.register(fingerprintDoc.context.flateStream(Buffer.concat([identity, differential]))));
const fingerprintAnalysis = await analyzeRemovalPdf(await fingerprintDoc.save());
check(fingerprintAnalysis.candidates.length === 2 && exactRemovalMatches(fingerprintAnalysis.candidates,
  fingerprintAnalysis.candidates[0], removalPages('', 1)).length === 1,
  'Identical 16-bit compressed bytes with different image geometry and prediction semantics are kept separate');

const cases = [];
for (const bits of [1, 2, 4]) for (const color of ['G', 'RGB', 'CMYK']) for (const encoding of ['flate', 'hex-flate', 'ascii85-flate']) {
  cases.push({ name: `tiff2-${color}-${bits}-${encoding}`, bits, color, encoding, predictor: 2 });
}
for (const color of ['G', 'RGB', 'CMYK']) for (const encoding of ['flate', 'hex-flate', 'ascii85-flate']) {
  cases.push({ name: `png15-${color}-16-${encoding}`, bits: 16, color, encoding, predictor: 15 });
}
for (const color of ['G', 'RGB', 'CMYK']) for (const encoding of ['raw', 'hex', 'ascii85']) {
  cases.push({ name: `plain-${color}-16-${encoding}`, bits: 16, color, encoding, predictor: 1 });
}
for (const item of cases) {
  const options = { bits: item.bits, color: item.color, width: 5, height: 5 }, referenceKey = `${item.color}-${item.bits}`;
  if (!references.has(referenceKey)) references.set(referenceKey, {
    source: await save(referenceKey + '-reference-source', await inlineRemovalFixture(true, 'raw', 1, options)),
    expected: await save(referenceKey + '-reference-expected', await inlineRemovalFixture(false, 'raw', 1, options)),
  });
  const bytes = await inlineRemovalFixture(true, item.encoding, item.predictor, options), sourceHash = digest(bytes);
  const analysis = await analyzeRemovalPdf(bytes), images = analysis.candidates.filter(candidate => candidate.pageIndex === 0 && candidate.kind === 'inline-image');
  assert.equal(images.length, 3, item.name); assert.ok(analysis.summary.pages.every(page => !page.reason), item.name);
  const targets = exactRemovalMatches(analysis.candidates, images[2], removalPages('', 2));
  assert.equal(targets.length, 2, item.name); assert.ok(!targets.includes(images[0].id) && !targets.includes(images[1].id), item.name);
  const output = await buildRemovalPdf(analysis, targets), reopened = await analyzeRemovalPdf(output);
  assert.deepEqual(reopened.summary.pages.map(page => [page.reason, page.count]), [[null, 3], [null, 3]], item.name);
  assert.equal(reopened.candidates.filter(candidate => candidate.label === 'Body after inline images').length, 2, item.name);
  assert.equal(digest(bytes), sourceHash);
  variants.push({ ...item, referenceKey, source: await save(item.name + '-source', bytes), removed: await save(item.name + '-removed', output) });
}
check(variants.length === 45, '45 depth/color/filter combinations preserve cross-page matches, different images, searchable body and input bytes');

// Keep repeatable reader-disagreement evidence alongside the production guards.
const guarded = [];
const tiff16Probe = await save('tiff16-probe-source', await inlineRemovalFixture(true, 'flate', 2, { bits: 16, color: 'G', width: 5, height: 5 }));
const aliasDocument = await PDFDocument.load(await inlineRemovalFixture(true, 'flate', 2, { bits: 1, color: 'G', width: 5, height: 5 }));
for (const page of aliasDocument.getPages()) {
  const contents = inflateSync(page.node.Contents().getContents()).toString('latin1').replaceAll('/BitsPerComponent 1 >>', '/BPC 1 >>');
  page.node.set(PDFName.of('Contents'), aliasDocument.context.register(aliasDocument.context.flateStream(Buffer.from(contents, 'latin1'))));
}
const aliasProbe = await save('ambiguous-bpc-source', await aliasDocument.save());
for (const file of [tiff16Probe, aliasProbe]) {
  const analysis = await analyzeRemovalPdf(await readFile(file));
  assert.ok(analysis.summary.pages.every(page => page.reason === 'inline' && page.count === 0));
}
check(true, 'TIFF 16-bit and ambiguous non-8-bit BPC aliases preserve their original pages without selectable drawing objects');

let pixelChecks = 0, pdfjsPageComparisons = 0;
if (process.platform === 'win32' && !process.env.TOOLKNIT_REMOVE_SKIP_NATIVE) {
  const poppler = process.env.TOOLKNIT_PDFTOPPM || 'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1119-907-0_26.1119.907.0_x64__3k8sg7r9htsxt/dependencies/native/poppler/Library/bin/pdftoppm.exe';
  const qpdf = path.resolve('src-tauri/resources/qpdf/qpdf.exe'), rendered = new Set();
  async function render(file) {
    if (rendered.has(file)) return;
    await run(poppler, ['-r', '96', '-png', file, file.slice(0, -4)], { windowsHide: true }); rendered.add(file);
  }
  async function compare(a, b) {
    await render(a); await render(b);
    for (let page = 1; page <= 2; page++) {
      const actual = await sharp(a.slice(0, -4) + `-${page}.png`).raw().toBuffer();
      const expected = await sharp(b.slice(0, -4) + `-${page}.png`).raw().toBuffer();
      assert.ok(actual.equals(expected), `${path.basename(a)} page ${page}`); pixelChecks++;
    }
  }
  for (const item of variants) {
    await run(qpdf, ['--check', item.removed], { windowsHide: true });
    const reference = references.get(item.referenceKey);
    await compare(item.source, reference.source); await compare(item.removed, reference.expected);
  }
  check(pixelChecks === 180, 'Poppler passes 180 original/removed page comparisons, and qpdf accepts 45 edited PDFs');
  const pdfjsCache = new Map();
  async function pdfjsPixels(file) {
    if (pdfjsCache.has(file)) return pdfjsCache.get(file);
    const job = getDocument({ data: new Uint8Array(await readFile(file)), verbosity: 0, useSystemFonts: true });
    try {
      const pdf = await job.promise, page = await pdf.getPage(1), viewport = page.getViewport({ scale: 96 / 72 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height)), ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      await writeFile(file.slice(0, -4) + '-pdfjs.png', canvas.toBuffer('image/png'));
      const pixels = Buffer.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
      pdfjsCache.set(file, pixels); return pixels;
    } finally { await job.destroy(); }
  }
  for (const item of variants) {
    const reference = references.get(item.referenceKey);
    for (const [file, expected] of [[item.source, reference.source], [item.removed, reference.expected]]) {
      assert.ok((await pdfjsPixels(file)).equals(await pdfjsPixels(expected)), `PDF.js ${item.name} ${path.basename(file)}`);
      pdfjsPageComparisons++;
    }
  }
  check(pdfjsPageComparisons === 90, 'PDF.js passes 90 source/removed first-page comparisons against raw or clean references');
  for (const [name, file, key] of [['TIFF 16-bit carry', tiff16Probe, 'G-16'], ['non-8-bit BPC alias', aliasProbe, 'G-1']]) {
    const reference = references.get(key).source;
    await render(file); await render(reference);
    const actual = await sharp(file.slice(0, -4) + '-1.png').raw().toBuffer();
    const expected = await sharp(reference.slice(0, -4) + '-1.png').raw().toBuffer();
    let differentBytes = 0; for (let at = 0; at < actual.length; at++) if (actual[at] !== expected[at]) differentBytes++;
    const a = await pdfjsPixels(file), b = await pdfjsPixels(reference);
    guarded.push({ name, pdfjsMatchesRaw: a.equals(b), popplerMatchesRaw: actual.equals(expected), popplerDifferentBytes: differentBytes,
      status: 'not enabled; preserved by parser guard' });
  }
}
await writeFile(path.join(root, 'report.json'), JSON.stringify({ checks, variants: variants.map(({ name, bits, color, encoding, predictor }) =>
  ({ name, bits, color, encoding, predictor })), pixelChecks, pdfjsPageComparisons, guarded,
  nativeChecksSkipped: Boolean(process.env.TOOLKNIT_REMOVE_SKIP_NATIVE) || process.platform !== 'win32' }, null, 2));
console.log(`PDF inline depths passed: ${checks.length} groups, ${variants.length} filter/depth/color combinations, ${pixelChecks} independent page comparisons.`);
