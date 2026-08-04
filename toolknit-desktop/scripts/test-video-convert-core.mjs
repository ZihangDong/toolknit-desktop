import assert from 'node:assert/strict';
import {
  VideoConvertError,
  normalizeVideoTargetFormat,
  validateVideoBatchSelection
} from '../src/video-convert-core.js';

assert.equal(normalizeVideoTargetFormat(' webm '), 'WEBM');
assert.throws(() => normalizeVideoTargetFormat('mpeg'), VideoConvertError);
assert.equal(validateVideoBatchSelection([{ name: 'sample.mp4', path: 'D:/sample.mp4', size: 2048 }]).length, 1);
assert.throws(
  () => validateVideoBatchSelection([
    { name: 'sample.mp4', path: 'D:/sample.mp4', size: 2048 },
    { name: 'sample.mp4', path: 'D:/sample.mp4', size: 2048 }
  ]),
  (error) => error instanceof VideoConvertError && error.code === 'duplicate_input'
);
assert.throws(
  () => validateVideoBatchSelection([{ name: 'archive.zip', size: 2048 }]),
  (error) => error instanceof VideoConvertError && error.code === 'invalid_input'
);

console.log('Video conversion core regression checks passed');
