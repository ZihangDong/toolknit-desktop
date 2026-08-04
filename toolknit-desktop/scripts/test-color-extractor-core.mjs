import assert from 'node:assert/strict';
import {
  COLOR_EXTRACTOR_LIMITS,
  assertColorExtractorImageBytes,
  assertColorExtractorDimensions,
  assertColorExtractorFile,
  isSupportedColorExtractorFile,
  readColorExtractorImageDimensions
} from '../src/color-extractor-core.js';

assert.equal(isSupportedColorExtractorFile({ name: 'sample.webp', type: '' }), true);
assert.equal(isSupportedColorExtractorFile({ name: 'sample.svg', type: 'image/svg+xml' }), false);
assert.doesNotThrow(() => assertColorExtractorFile({ name: 'sample.png', type: 'image/png', size: 1024 }));
assert.throws(() => assertColorExtractorFile({ name: 'large.jpg', type: 'image/jpeg', size: COLOR_EXTRACTOR_LIMITS.maxBytes + 1 }), RangeError);
assert.doesNotThrow(() => assertColorExtractorDimensions(6000, 6000));
assert.throws(() => assertColorExtractorDimensions(10000, 10000), RangeError);

const png = new Uint8Array(24);
png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
png.set([0x49, 0x48, 0x44, 0x52], 12);
new DataView(png.buffer).setUint32(16, 320);
new DataView(png.buffer).setUint32(20, 240);
assert.deepEqual(readColorExtractorImageDimensions(png), { width: 320, height: 240 });
assert.deepEqual(assertColorExtractorImageBytes(png), { width: 320, height: 240 });

const jpeg = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0x01,
  0x11, 0x00
]);
assert.deepEqual(readColorExtractorImageDimensions(jpeg), { width: 640, height: 480 });

const webp = new Uint8Array(30);
webp.set([0x52, 0x49, 0x46, 0x46], 0);
webp.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 8);
webp.set([0x0a, 0x00, 0x00, 0x00], 16);
webp.set([0x3f, 0x01, 0x00], 24);
webp.set([0xef, 0x00, 0x00], 27);
assert.deepEqual(readColorExtractorImageDimensions(webp), { width: 320, height: 240 });
assert.throws(() => assertColorExtractorImageBytes(new Uint8Array([1, 2, 3])), TypeError);

console.log('Color extractor core regression checks passed');
