import assert from 'node:assert/strict';
import {
  IMAGE_BATCH_LIMITS,
  ImageBatchError,
  getImageExtension,
  isSupportedImageCompressionFileName,
  isSupportedImageFileName,
  normalizeImageCompressionQuality,
  normalizeImageTargetFormat,
  validateImageCompressionSelection,
  validateImageBatchSelection
} from '../src/image-batch-core.js';

assert.equal(getImageExtension('photo.JPEG'), 'jpeg');
assert.equal(getImageExtension('no-extension'), '');
assert.equal(isSupportedImageFileName('sample.webp'), true);
assert.equal(isSupportedImageFileName('sample.svg'), false);
assert.equal(isSupportedImageCompressionFileName('sample.webp'), true);
assert.equal(isSupportedImageCompressionFileName('sample.gif'), false);
assert.equal(normalizeImageTargetFormat(' jpeg '), 'JPG');
assert.equal(normalizeImageTargetFormat('webp'), 'WEBP');
assert.equal(normalizeImageTargetFormat('svg'), 'SVG');
assert.throws(() => normalizeImageTargetFormat('tiff'), ImageBatchError);
assert.equal(normalizeImageCompressionQuality(' LOW '), 'low');
assert.throws(() => normalizeImageCompressionQuality('maximum'), ImageBatchError);

const selected = validateImageBatchSelection([
  { name: 'one.png', path: 'D:/input/one.png', size: 1024 },
  { name: 'two.JPG', path: 'D:/input/two.JPG', size: IMAGE_BATCH_LIMITS.maxBytesPerFile }
]);
assert.equal(selected.length, 2);
assert.throws(
  () => validateImageBatchSelection([{ name: 'bad.svg', path: 'D:/input/bad.svg', size: 1 }]),
  (error) => error instanceof ImageBatchError && error.code === 'unsupported_input'
);
assert.throws(
  () => validateImageBatchSelection([{ name: 'large.png', path: 'D:/input/large.png', size: IMAGE_BATCH_LIMITS.maxBytesPerFile + 1 }]),
  (error) => error instanceof ImageBatchError && error.code === 'file_too_large'
);
assert.throws(
  () => validateImageBatchSelection([{ name: 'unknown-size.png', path: 'D:/input/unknown-size.png' }]),
  (error) => error instanceof ImageBatchError && error.code === 'invalid_file_size'
);
assert.throws(
  () => validateImageBatchSelection([
    { name: 'copy.png', path: 'D:/input/copy.png', size: 1 },
    { name: 'copy.png', path: 'D:/input/copy.png', size: 1 }
  ]),
  (error) => error instanceof ImageBatchError && error.code === 'duplicate_input'
);
assert.throws(
  () => validateImageCompressionSelection([{ name: 'animated.gif', path: 'D:/input/animated.gif', size: 1 }]),
  (error) => error instanceof ImageBatchError && error.code === 'unsupported_compression_input'
);

console.log('Image batch core regression checks passed');
