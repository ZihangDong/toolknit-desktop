import assert from 'node:assert/strict';
import { VideoGifError, createDefaultVideoGifSelection, normalizeVideoGifRequest, videoGifTimeLabel } from '../src/video-gif-core.js';

const base = normalizeVideoGifRequest({ start_ms: 1_000, end_ms: 30_000 }, 40);
assert.deepEqual(base, { start_ms: 1_000, end_ms: 30_000, duration_ms: 29_000, frame_rate: 12, width: 640, quality: 'balanced' });
assert.equal(normalizeVideoGifRequest({ start_ms: 0, end_ms: 10_000, quality: 'small' }).quality, 'small');
assert.deepEqual(createDefaultVideoGifSelection(4.371), { start_ms: 0, end_ms: 4_371 });
assert.deepEqual(createDefaultVideoGifSelection(45), { start_ms: 0, end_ms: 30_000 });
assert.equal(videoGifTimeLabel(62_003), '01:02.003');
assert.throws(() => normalizeVideoGifRequest({ start_ms: 0, end_ms: 30_001 }), VideoGifError);
assert.throws(() => normalizeVideoGifRequest({ start_ms: 10_000, end_ms: 10_000 }), VideoGifError);
assert.throws(() => normalizeVideoGifRequest({ start_ms: 0, end_ms: 10_000, frame_rate: 25 }), VideoGifError);
assert.throws(() => normalizeVideoGifRequest({ start_ms: 0, end_ms: 10_000, width: 159 }), VideoGifError);
assert.throws(() => normalizeVideoGifRequest({ start_ms: 0, end_ms: 10_000, quality: 'raw' }), VideoGifError);
assert.throws(() => createDefaultVideoGifSelection(0), VideoGifError);
console.log('Video GIF core checks passed');
