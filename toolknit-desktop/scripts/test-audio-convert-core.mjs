import assert from 'node:assert/strict';
import {
  AUDIO_CONVERT_LIMITS,
  AudioConvertError,
  getAudioConversionProfile,
  normalizeAudioConversionQuality,
  normalizeAudioTargetFormat,
  validateAudioBatchSelection
} from '../src/audio-convert-core.js';

assert.equal(normalizeAudioTargetFormat(' flac '), 'FLAC');
assert.throws(() => normalizeAudioTargetFormat('wma'), AudioConvertError);
assert.equal(normalizeAudioConversionQuality(), 'medium');
assert.equal(normalizeAudioConversionQuality(' HIGH '), 'high');
assert.throws(() => normalizeAudioConversionQuality('192k'), AudioConvertError);
assert.deepEqual(getAudioConversionProfile('aac', 'high'), {
  format: 'AAC', quality: 'high', extension: '.m4a', encoder: 'aac', args: ['-b:a', '256k', '-movflags', '+faststart']
});
assert.deepEqual(getAudioConversionProfile('wav', 'low'), {
  format: 'WAV', quality: 'low', extension: '.wav', encoder: 'pcm_s16le', args: []
});
assert.equal(validateAudioBatchSelection([{ name: 'track.m4a', path: 'D:/track.m4a', size: 1 }]).length, 1);
assert.throws(
  () => validateAudioBatchSelection([{ name: 'empty.wav', path: 'D:/empty.wav', size: 0 }]),
  (error) => error instanceof AudioConvertError && error.code === 'invalid_input_size'
);
assert.throws(
  () => validateAudioBatchSelection([{ name: 'track.mp3', path: 'D:/track.mp3', size: 1 }, { name: 'track.mp3', path: 'D:/track.mp3', size: 1 }]),
  (error) => error instanceof AudioConvertError && error.code === 'duplicate_input'
);
assert.throws(
  () => validateAudioBatchSelection([{ name: 'track.mp4', path: 'D:/track.mp4', size: 1 }]),
  (error) => error instanceof AudioConvertError && error.code === 'unsupported_input'
);
assert.throws(
  () => validateAudioBatchSelection([{ name: 'large.flac', path: 'D:/large.flac', size: AUDIO_CONVERT_LIMITS.maxBytesPerFile + 1 }]),
  (error) => error instanceof AudioConvertError && error.code === 'input_too_large'
);

console.log('Audio conversion core regression checks passed');
