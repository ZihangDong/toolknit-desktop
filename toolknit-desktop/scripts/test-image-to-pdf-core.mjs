import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { LIMITS, pagePlan, decodeSize, naturalFileOrder, movePage, outputName, validateInput, validateDimensions, errorCode } from '../src/features/image-to-pdf/core.js';
import { createScanWriter } from '../src/shared/scanned-pdf-writer.js';
import { readRasterDimensions } from '../src/core/image-dimensions.js';

assert.deepEqual(naturalFileOrder(['page10.png', 'page02.png', 'page1.png', 'page20.png'].map(name => ({ name }))).map(file => file.name),
  ['page1.png', 'page02.png', 'page10.png', 'page20.png']);
const items = ['a', 'b', 'c', 'd'].map(id => ({ id }));
assert.deepEqual(movePage(items, 'a', 'c', true).map(item => item.id), ['b', 'c', 'a', 'd']);
assert.deepEqual(movePage(items, 'd', 'b').map(item => item.id), ['a', 'd', 'b', 'c']);
assert.deepEqual(items.map(item => item.id), ['a', 'b', 'c', 'd']);
assert.equal(movePage(items, 'missing', 'a'), items);
for (const name of ['CON', 'nul.pdf', 'LPT1', 'a/b\\c:*?<>|', '../unsafe.pdf', '...']) {
  const result = outputName(name);
  assert.match(result, /\.pdf$/);
  assert.doesNotMatch(result, /[\\/:*?<>|]/);
  assert.doesNotMatch(result, /^(con|nul|lpt1)\.pdf$/i);
}
assert.equal(outputName('中文😀.pdf'), '中文😀.pdf');
assert.equal(outputName('CLOCK$'), '_CLOCK$.pdf');
assert.equal(outputName('a'.repeat(88) + ' .discarded'), 'a'.repeat(88) + '.pdf');
assert.equal(outputName('a\u007fb'), 'a_b.pdf');
assert.equal(errorCode('image-pdf:changed'), 'changed');
for (const file of [{ name: 'x.svg', size: 50 }, { name: 'x.png', size: 0 }, { name: 'x.jpg', size: LIMITS.inputBytes + 1 }]) assert.throws(() => validateInput(file));
for (const [width, height] of [[0, 1], [NaN, 5], [8000, 6000], [32769, 1]]) assert.throws(() => validateDimensions(width, height));
assert.throws(() => pagePlan({ width: 100, height: 100, rotation: 45 }));
assert.throws(() => pagePlan({ width: 100, height: 100 }, { quality: 'invalid' }));
for (const [width, height] of [[300, 800], [800, 300], [1000, 1000], [32768, 1], [4000, 6000]]) {
  for (const rotation of [0, 90, 180, 270]) for (const orientation of ['auto', 'portrait', 'landscape']) for (const quality of ['clear', 'balanced', 'small']) {
    const plan = pagePlan({ width, height, rotation }, { orientation, quality });
    assert.ok(plan.pixelWidth > 0 && plan.pixelHeight > 0);
    assert.ok(plan.pixelWidth * plan.pixelHeight <= LIMITS.renderPixels);
    assert.ok(Math.max(plan.pixelWidth, plan.pixelHeight) <= LIMITS.renderSide);
    assert.ok(plan.x >= 8 * 72 / 25.4 - .01 && plan.y >= 8 * 72 / 25.4 - .01);
    assert.ok(plan.x + plan.drawWidth <= plan.width && plan.y + plan.drawHeight <= plan.height);
    const ratio = rotation % 180 ? height / width : width / height;
    assert.ok(Math.abs(plan.drawWidth / plan.drawHeight - ratio) < .000001, 'A4 fitting never stretches or crops');
    assert.ok(Math.abs(plan.x - (plan.width - plan.drawWidth) / 2) < .00001);
    const decoded = decodeSize({ width, height }, plan);
    assert.ok(decoded.maxWidth * decoded.maxHeight <= LIMITS.renderPixels);
    assert.ok(Math.max(decoded.maxWidth, decoded.maxHeight) <= LIMITS.renderSide);
  }
}
const original = pagePlan({ width: 1200, height: 1800, dpiX: 300, dpiY: 150 }, { paper: 'original' });
assert.deepEqual([original.width, original.height, original.x, original.y, original.drawWidth, original.drawHeight], [288, 864, 0, 0, 288, 864]);
const rotated = pagePlan({ width: 1200, height: 1800, dpiX: 300, dpiY: 150, rotation: 90 }, { paper: 'original' });
assert.deepEqual([rotated.width, rotated.height], [864, 288]);
assert.deepEqual(decodeSize({ width: 1200, height: 1800 }, original), { maxWidth: 1200, maxHeight: 1800 },
  'asymmetric TIFF resolution must not unnecessarily halve vertical detail');
assert.deepEqual(decodeSize({ width: 1200, height: 1800 }, rotated), { maxWidth: 1200, maxHeight: 1800 });
const icon = pagePlan({ width: 1, height: 1 });
assert.ok(icon.pixelWidth >= 595 && icon.pixelHeight >= 841, 'A4 margins retain meaningful page geometry for tiny icons');
assert.deepEqual(decodeSize({ width: 1, height: 1 }, icon), { maxWidth: 1, maxHeight: 1 }, 'tiny source decoding is never upscaled');
assert.equal(icon.resolutionLimit, 'source');
assert.equal(pagePlan({ width: 8000, height: 5000 }, { paper: 'original', quality: 'clear' }).resolutionLimit, 'processing');
const canvas = createCanvas(32, 24), context = canvas.getContext('2d');
context.fillStyle = '#eee'; context.fillRect(0, 0, 32, 24);
const png = canvas.toBuffer('image/png'), jpeg = canvas.toBuffer('image/jpeg');
assert.deepEqual(readRasterDimensions(png, 'png'), { width: 32, height: 24 });
assert.deepEqual(readRasterDimensions(jpeg, 'jpeg'), { width: 32, height: 24 });
assert.equal(readRasterDimensions(new Uint8Array([1, 2, 3]), 'png'), null);
const writer = await createScanWriter(2);
await writer.add({ png, width: 288, height: 432 });
await writer.add({ jpeg, width: 432, height: 288 });
const pdf = await PDFDocument.load(await writer.finish());
assert.deepEqual(pdf.getPages().map(page => [page.getWidth(), page.getHeight()]), [[288, 432], [432, 288]]);
const invalid = await createScanWriter(1);
await assert.rejects(invalid.add({ png, jpeg, width: 100, height: 100 }));
await assert.rejects(invalid.finish());
console.log('Image PDF geometry, sorting, size budgets, raster metadata and actual mixed PNG/JPEG PDF output passed');
