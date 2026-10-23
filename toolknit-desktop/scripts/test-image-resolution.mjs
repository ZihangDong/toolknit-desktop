import assert from 'node:assert/strict';
import { readImageResolution } from '../src/core/image-resolution.js';
import { pagePlan } from '../src/features/image-to-pdf/core.js';

function exif(little = true, orientation = 1, denominator = 1) {
  const bytes = Buffer.alloc(78), u16 = little ? 'writeUInt16LE' : 'writeUInt16BE', u32 = little ? 'writeUInt32LE' : 'writeUInt32BE';
  bytes.write(little ? 'II' : 'MM'); bytes[u16](42, 2); bytes[u32](8, 4); bytes[u16](4, 8);
  for (const [index, tag, type, value] of [[0, 0x11a, 5, 62], [1, 0x11b, 5, 70], [2, 0x128, 3, 2], [3, 0x112, 3, orientation]]) {
    const offset = 10 + index * 12; bytes[u16](tag, offset); bytes[u16](type, offset + 2); bytes[u32](1, offset + 4);
    bytes[type === 3 ? u16 : u32](value, offset + 8);
  }
  bytes[u32](300, 62); bytes[u32](denominator, 66); bytes[u32](150, 70); bytes[u32](1, 74); return bytes;
}
function segment(marker, payload) { const header = Buffer.from([255, marker, 0, 0]); header.writeUInt16BE(payload.length + 2, 2); return Buffer.concat([header, payload]); }
function jpeg(...segments) { return Buffer.concat([Buffer.from([255, 216]), ...segments, Buffer.from([255, 217])]); }
function jfif(unit, x, y) {
  const value = Buffer.alloc(14); value.write('JFIF\0'); value[5] = 1; value[6] = 2; value[7] = unit;
  value.writeUInt16BE(x, 8); value.writeUInt16BE(y, 10); return segment(0xe0, value);
}
function pngChunk(tag, payload) { const header = Buffer.alloc(8); header.writeUInt32BE(payload.length); header.write(tag, 4); return Buffer.concat([header, payload, Buffer.alloc(4)]); }
function png(x, y, unit = 1) {
  const value = Buffer.alloc(9); value.writeUInt32BE(x, 0); value.writeUInt32BE(y, 4); value[8] = unit;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('pHYs', value), pngChunk('IDAT', Buffer.alloc(0))]);
}
for (const little of [true, false]) for (const orientation of [1, 6, 8]) {
  const input = jpeg(jfif(1, 72, 72), segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0'), exif(little, orientation)])));
  const metadata = readImageResolution(input, 'jpeg');
  assert.deepEqual([metadata.dpiX, metadata.dpiY], orientation === 1 ? [300, 150] : [150, 300]);
  const plan = pagePlan({ width: 1200, height: 1800, ...metadata }, { paper: 'original' });
  assert.deepEqual([plan.width, plan.height], orientation === 1 ? [288, 864] : [576, 432]);
  for (let length = 0; length <= input.length; length++) assert.doesNotThrow(() => readImageResolution(input.subarray(0, length), 'jpeg'));
}
assert.deepEqual(readImageResolution(jpeg(jfif(1, 300, 150)), 'jpg'), { dpiX: 300, dpiY: 150 });
assert.deepEqual(readImageResolution(jpeg(jfif(2, 100, 100)), 'jpg'), { dpiX: 254, dpiY: 254 });
assert.deepEqual(readImageResolution(jpeg(jfif(0, 1, 1)), 'jpg'), {});
const webp = Buffer.alloc(12); webp.write('RIFF'); webp.write('WEBP', 8);
const webpChunk = Buffer.alloc(8); webpChunk.write('EXIF'); webpChunk.writeUInt32LE(78, 4);
const webpValue = readImageResolution(Buffer.concat([webp, webpChunk, exif(true, 6)]), 'webp');
assert.deepEqual([webpValue.dpiX, webpValue.dpiY], [150, 300]);
for (let length = 0; length < 6; length++) {
  const shortChunk = Buffer.from(webpChunk); shortChunk.writeUInt32LE(length, 4);
  assert.deepEqual(readImageResolution(Buffer.concat([webp, shortChunk, Buffer.from('Exif\0\0'), exif()]), 'webp'), {});
}
const pngValue = readImageResolution(png(11811, 5906), 'png');
assert.ok(Math.abs(pngValue.dpiX - 300) < .03 && Math.abs(pngValue.dpiY - 150) < .03);
assert.deepEqual(readImageResolution(png(11811, 5906, 0), 'png'), {});
assert.deepEqual(readImageResolution(png(0xffffffff, 0xffffffff), 'png'), {});
const zero = readImageResolution(jpeg(segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0'), exif(true, 1, 0)]))), 'jpeg');
assert.deepEqual([zero.dpiX, zero.dpiY], [150, 150], 'invalid resolution falls back to the other valid axis');
const bmp = Buffer.alloc(54); bmp.write('BM'); bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(11811, 38); bmp.writeInt32LE(11811, 42);
assert.ok(Math.abs(readImageResolution(bmp, 'bmp').dpiX - 300) < .03);
let seed = 1234567;
for (let i = 0; i < 5000; i++) {
  const bytes = Buffer.alloc(i % 160);
  for (let j = 0; j < bytes.length; j++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; bytes[j] = seed & 255; }
  for (const format of ['png', 'jpg', 'bmp', 'webp']) assert.doesNotThrow(() => readImageResolution(bytes, format));
}
console.log('Image resolution: PNG pHYs, JPEG/WebP EXIF endian/orientation, BMP, truncation and 20000 malformed headers passed');
