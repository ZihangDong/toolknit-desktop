import assert from 'node:assert/strict';
import { VideoFrameError, frameTimeLabel, normalizeVideoFrameFormat, normalizeVideoFrameTimestamp, validateVideoFrameInput } from '../src/video-frame-core.js';

assert.equal(normalizeVideoFrameFormat(' PNG '), 'png');
assert.equal(normalizeVideoFrameFormat('jpg'), 'jpg');
assert.throws(() => normalizeVideoFrameFormat('gif'), error => error instanceof VideoFrameError && error.code === 'invalid_format');
assert.equal(normalizeVideoFrameTimestamp(1234.6, 10), 1235);
assert.throws(() => normalizeVideoFrameTimestamp(10001, 10), error => error instanceof VideoFrameError && error.code === 'timestamp_out_of_range');
assert.throws(() => normalizeVideoFrameTimestamp(-1), error => error instanceof VideoFrameError && error.code === 'invalid_timestamp');
assert.equal(frameTimeLabel(3_723_004), '01:02:03.004');
assert.equal(frameTimeLabel(4), '00:00.004');
assert.equal(validateVideoFrameInput({ name: '中文 视频.MP4', size: 1024 }).name, '中文 视频.MP4');
assert.throws(() => validateVideoFrameInput({ name: 'payload.txt', size: 1 }), error => error instanceof VideoFrameError && error.code === 'invalid_input');
console.log('Video frame core checks passed');
