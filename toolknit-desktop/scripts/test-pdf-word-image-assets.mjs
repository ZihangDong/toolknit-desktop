import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { canvasBytes, encodeImageAsset } from '../src/features/pdf-to-word/adapters/image-assets.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';

const photo = createCanvas(1024, 1024), context = photo.getContext('2d');
const pixels = context.createImageData(photo.width, photo.height);
let seed = 15291;
for (let y = 0; y < photo.height; y++) for (let x = 0; x < photo.width; x++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const offset = (y * photo.width + x) * 4, grain = (seed >>> 24) / 8;
  pixels.data.set([30 + x % 180 + grain, 20 + y % 160 + grain, 40 + (x + y) % 130 + grain, 255], offset);
}
context.putImageData(pixels, 0, 0);
context.fillStyle = '#ffffff'; context.fillRect(200, 200, 200, 200);
const image = { id: 'p1:photo', type: 'image', role: 'figure', sourceIds: [], reasons: [],
  rect: { x: 20, y: 20, width: 220, height: 220 }, baseline: 240, size: 220, order: 0 };
const original = structuredClone(image), temporary = [];
const factory = (width, height) => {
  const canvas = createCanvas(width, height), released = new Set(); temporary.push(released);
  return new Proxy(canvas, {
    get(target, key) { const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; },
    set(target, key, value) { if (['width', 'height'].includes(key) && value === 0) released.add(key); return Reflect.set(target, key, value, target); },
  });
};
const png = await canvasBytes(photo);
assert(png.length > 1024 * 1024, 'fixture exercises the large-image boundary');
const encoded = await encodeImageAsset(photo, image, factory, () => {}, true);
assert.equal(encoded.format, 'jpg'); assert(encoded.bytes.length < png.length * .8);
assert.deepEqual([...encoded.bytes.slice(0, 3)], [255, 216, 255]);
assert.deepEqual(image, original); assert(temporary.every(released => released.size === 2));
const decoded = await loadImage(encoded.bytes), restored = createCanvas(decoded.width, decoded.height);
restored.getContext('2d').drawImage(decoded, 0, 0);
assert.equal(decoded.width, photo.width); assert.equal(decoded.height, photo.height);
assert([...restored.getContext('2d').getImageData(250, 250, 100, 100).data].every(value => value >= 254),
  'composited white covering remains blank; encoding never reads the underlying source');

for (const [candidate, opaque] of [
  [{ ...image, role: 'math' }, true], [{ ...image, sourceIds: ['visible-text'] }, true],
  [{ ...image, reasons: ['partial-clip'] }, true], [{ ...image, reasons: ['table-image'] }, true],
  [{ ...image, mathGlyphs: [{ text: 'x' }] }, true], [{ ...image, sourceIds: undefined }, true], [image, false],
]) {
  const result = await encodeImageAsset(photo, candidate, factory, () => {}, opaque);
  assert.equal(result.format, 'png'); assert.deepEqual(result.bytes, png);
}
const gray = createCanvas(1024, 1024), grayContext = gray.getContext('2d');
const grayPixels = grayContext.createImageData(1024, 1024);
for (let index = 0; index < grayPixels.data.length; index += 4) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const value = seed >>> 24; grayPixels.data.set([value, value, value, 255], index);
}
grayContext.putImageData(grayPixels, 0, 0);
const grayResult = await encodeImageAsset(gray, image, factory, () => {}, true);
assert.equal(grayResult.format, 'png', 'grayscale scans and line artwork remain lossless');
const tiny = createCanvas(32, 32); tiny.getContext('2d').fillRect(0, 0, 32, 32);
assert.equal((await encodeImageAsset(tiny, image, factory, () => {}, true)).format, 'png');
await assert.rejects(encodeImageAsset(photo, image, factory, () => { throw Error('cancelled'); }, true), /cancelled/);

const requests = [];
const offscreen = { convertToBlob: async options => { requests.push(options); return new Blob([encoded.bytes], { type: options.type }); } };
assert.deepEqual(await canvasBytes(offscreen, 'image/jpeg', .96), encoded.bytes);
assert.deepEqual(requests, [{ type: 'image/jpeg', quality: .96 }]);
const html = { toBlob(callback, type, quality) { requests.push({ type, quality }); callback(new Blob([png], { type })); } };
assert.deepEqual(await canvasBytes(html), png);
await assert.rejects(canvasBytes({ toBlob(callback) { callback(null); } }), /pdf-to-word:image/);

const scene = { number: 1, width: 300, height: 300, sources: [], items: [image], rules: [], risks: [], characters: 0 };
const layout = inferDocument([scene], { preserveGeometry: true });
const asset = { ...encoded, id: image.id, width: photo.width, height: photo.height };
const output = await createWordBytes(layout, [asset], { preserveGeometry: true });
const zip = await JSZip.loadAsync(output.bytes);
const jpegPart = Object.keys(zip.files).find(name => /^word\/media\/.*\.jpg$/.test(name));
assert(jpegPart); assert.deepEqual(await zip.file(jpegPart).async('uint8array'), encoded.bytes);
assert((await zip.file('[Content_Types].xml').async('string')).includes('image/jpeg'));
assert.equal(output.quality.editableCharacters, 0); assert.equal(output.quality.imageCharacters, 0);
await assert.rejects(createWordBytes(layout, [{ ...asset, format: 'svg' }], { preserveGeometry: true }), /pdf-to-word:image/);
const legacy = await createWordBytes(layout, [{ ...asset, bytes: png, format: undefined }], { preserveGeometry: true });
assert(Object.keys((await JSZip.loadAsync(legacy.bytes)).files).some(name => /^word\/media\/.*\.png$/.test(name)));
photo.width = photo.height = gray.width = gray.height = tiny.width = tiny.height = restored.width = restored.height = 0;
assert(temporary.every(released => released.size === 2));
console.log('Image asset checks passed: bounded high-quality photo encoding, exact PNG exclusions, composited covering, browser encoders, cancellation and DOCX media types.');
