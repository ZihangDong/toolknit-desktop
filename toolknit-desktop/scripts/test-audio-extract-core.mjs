import assert from 'node:assert/strict';
import {
  AudioExtractError,
  AUDIO_EXTRACT_LIMITS,
  assertAudioExtractInput,
  normalizeAudioExtractFormat,
  normalizeAudioTrackIndex
} from '../src/audio-extract-core.js';

assert.equal(normalizeAudioExtractFormat(' flac '), 'FLAC');
assert.throws(() => normalizeAudioExtractFormat('alac'), AudioExtractError);
assert.equal(assertAudioExtractInput({ name: 'movie.MKV', size: 1024 }).name, 'movie.MKV');
assert.throws(() => assertAudioExtractInput({ name: 'note.txt', size: 1024 }), AudioExtractError);
assert.throws(
  () => assertAudioExtractInput({ name: 'movie.mp4', size: AUDIO_EXTRACT_LIMITS.maxInputBytes + 1 }),
  (error) => error instanceof AudioExtractError && error.code === 'input_too_large'
);
assert.equal(normalizeAudioTrackIndex(0), 0);
assert.equal(normalizeAudioTrackIndex(null), null);
assert.throws(() => normalizeAudioTrackIndex(-1), AudioExtractError);

console.log('Audio extraction core regression checks passed');
