import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { SCAN_LIMITS, DEFAULT_SCAN_SETTINGS, applyScanPixels, scanErrorCode, scanFileName,
  scanPageRange, scanRenderPlan, scanSkewGeometry, validateScanInput, validateScanPages,
  validateScanSettings } from '../src/features/pdf-to-scan/core.js';
import { createScanWriter } from '../src/features/pdf-to-scan/writer.js';
import { publishScanBytes } from '../src/features/pdf-to-scan/processor.js';

assert.deepEqual(validateScanSettings({}), DEFAULT_SCAN_SETTINGS);
assert.doesNotThrow(() => validateScanInput({ name: 'sample.PDF', size: 100 }));
for (const file of [null, { name: 'x.pdf', size: 0 }, { name: 'x.png', size: 10 }, { name: 'x.pdf', size: Infinity }]) {
  assert.throws(() => validateScanInput(file), /invalid/);
}
assert.throws(() => validateScanInput({ name: 'x.pdf', size: SCAN_LIMITS.inputBytes + 1 }), /input-large/);
assert.throws(() => validateScanPages(101), /pages-large/);
for (const count of [0, -1, 1.5, NaN]) assert.throws(() => validateScanPages(count), /invalid/);
for (const setting of [{ dpi: 72 }, { mode: 'unknown' }, { noise: -1 }, { warmth: 11 }, { skew: Infinity }]) {
  assert.throws(() => validateScanSettings(setting), /settings/);
}
assert.deepEqual(scanPageRange('3, 1-2, 2', 5), [1, 2, 3]);
assert.deepEqual(scanPageRange('1-2，4', 5), [1, 2, 4]);
assert.deepEqual(scanPageRange(' ', 3), [1, 2, 3]);
for (const range of ['0', '2-1', '6', '1-', '1,', '1.5', '1e2', '<script>']) assert.throws(() => scanPageRange(range, 5), /range/);
const plan = scanRenderPlan(612, 792, 200);
assert.deepEqual(plan, { width: 612, height: 792, scale: 200 / 72, pixelWidth: 1700, pixelHeight: 2200 });
assert.equal(scanRenderPlan(480, 360, 150).pixelWidth, 1000);
assert.throws(() => scanRenderPlan(2400, 3400, 300), /page-size/);
assert.throws(() => scanRenderPlan(1, 10000, 150), /page-size/);
assert.throws(() => scanRenderPlan(NaN, 792, 200), /page-size/);
assert.equal(scanFileName('report.PDF'), 'report_scan.pdf');
assert.doesNotMatch(scanFileName('../unsafe\\name?.pdf'), /[<>:"/\\|?*]/);
assert.ok(scanFileName(`${'a'.repeat(200)}.pdf`).length <= 109);
assert.equal(scanErrorCode('pdf-enhance:output-path'), 'output-path');
assert.equal(scanErrorCode('pdf-enhance:output-too-large'), 'output-large');
const source = new Uint8ClampedArray([255, 0, 0, 255, 10, 20, 30, 0, 255, 255, 255, 255]);
assert.deepEqual(applyScanPixels(source.slice(), 3, 1, {}), source);
const gray = applyScanPixels(source.slice(), 3, 1, { mode: 'grayscale' });
assert.deepEqual([...gray], [54, 54, 54, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
const natural = applyScanPixels(source.slice(), 3, 1, { mode: 'natural' }, 42);
assert.deepEqual(natural, applyScanPixels(source.slice(), 3, 1, { mode: 'natural' }, 42));
assert.ok(natural[10] < natural[8]);
assert.throws(() => applyScanPixels(new Uint8ClampedArray(1), 1, 1, {}), /page-size/);
for (const number of [1, 2]) {
  const { angle, scale } = scanSkewGeometry(600, 800, { mode: 'natural', skew: 0.8 }, number);
  assert.equal(Math.sign(angle), number === 1 ? 1 : -1);
  assert.ok((600 * Math.cos(angle) + 800 * Math.abs(Math.sin(angle))) * scale <= 600 + 1e-8);
  assert.ok((800 * Math.cos(angle) + 600 * Math.abs(Math.sin(angle))) * scale <= 800 + 1e-8);
}
// Minimal SOF fixture tests PDF assembly; browser tests validate actual JPEG rendering.
const jpeg = new Uint8Array([255, 216, 255, 192, 0, 17, 8, 0, 1, 0, 1, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217]);
const writer = await createScanWriter(2);
await writer.add({ jpeg, width: 612, height: 792 });
await assert.rejects(writer.finish(), /output-invalid/);
await writer.add({ jpeg, width: 792, height: 612 });
await assert.rejects(writer.add({ jpeg, width: 10, height: 10 }), /output-invalid/);
const bytes = await writer.finish(), pdf = await PDFDocument.load(bytes);
assert.deepEqual(pdf.getPages().map(page => [page.getWidth(), page.getHeight()]), [[612, 792], [792, 612]]);
assert.equal(await publishScanBytes({ bytes, count: 2, isTauri: false, check() {} }), '');
await assert.rejects(publishScanBytes({ bytes: new Uint8Array(), count: 2, isTauri: false, check() {} }), /output-invalid/);

async function publishScenario({ fail, cancelAt } = {}) {
  const calls = [], operation = { cancelled: false, committing: false };
  const native = { invoke: async (command, args) => {
    calls.push([command, args]);
    if (command === cancelAt) operation.cancelled = true;
    if (command === fail) throw new Error('simulated write failure');
    return command === 'begin_pdf_enhance_write' ? 'session' : command === 'finalize_pdf_enhance_write' ? 'output/report_scan_2.pdf' : true;
  } };
  const result = publishScanBytes({ bytes: new Uint8Array(1024 * 1024 + 1), fileName: 'report_scan.pdf', count: 2, isTauri: true,
    native, operation, getOutputDir: async sub => { assert.equal(sub, 'PDF_Scan'); return 'output'; },
    check: () => { if (operation.cancelled) throw new Error('cancelled'); } });
  if (fail || cancelAt) {
    await assert.rejects(result);
    assert.equal(calls.at(-1)[0], 'discard_pdf_enhance_write');
    if (cancelAt) assert.ok(!calls.some(([command]) => command === 'finalize_pdf_enhance_write'));
  } else {
    assert.equal(await result, 'output/report_scan_2.pdf');
    assert.deepEqual(calls.map(([command]) => command), ['begin_pdf_enhance_write', 'append_pdf_enhance_chunk', 'append_pdf_enhance_chunk', 'finalize_pdf_enhance_write']);
    assert.equal(calls[1][1].bytes.length, 1024 * 1024);
    assert.equal(calls[2][1].bytes.length, 1);
    assert.equal(operation.committing, true);
  }
}
await publishScenario();
await publishScenario({ fail: 'append_pdf_enhance_chunk' });
await publishScenario({ fail: 'finalize_pdf_enhance_write' });
await publishScenario({ cancelAt: 'begin_pdf_enhance_write' });
await publishScenario({ cancelAt: 'append_pdf_enhance_chunk' });
console.log('PDF scan limits, ranges, effects, page geometry, assembly and safe publication passed');
