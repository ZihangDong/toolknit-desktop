import assert from 'node:assert/strict';
import {
  AudioClipError,
  AUDIO_CLIP_LIMITS,
  assertAudioClipBuffer,
  assertAudioClipInput,
  assertAudioClipSelection,
  isAudioClipSupportedName
} from '../src/audio-clip-core.js';

assert.equal(assertAudioClipInput({ name: 'voice.m4a', size: 2048 }).name, 'voice.m4a');
assert.throws(() => assertAudioClipInput({ name: 'voice.txt', size: 2048 }), AudioClipError);
assert.throws(
  () => assertAudioClipInput({ name: 'voice.mp3', size: AUDIO_CLIP_LIMITS.maxInputBytes + 1 }),
  (error) => error instanceof AudioClipError && error.code === 'input_too_large'
);
assert.equal(assertAudioClipBuffer({ duration: 120, numberOfChannels: 2, sampleRate: 48000 }).duration, 120);
assert.throws(
  () => assertAudioClipBuffer({ duration: AUDIO_CLIP_LIMITS.maxDurationSeconds + 1, numberOfChannels: 2, sampleRate: 48000 }),
  (error) => error instanceof AudioClipError && error.code === 'audio_too_long'
);
assert.throws(
  () => assertAudioClipBuffer({
    duration: 900,
    numberOfChannels: 2,
    sampleRate: 96000,
    length: 900 * 96000
  }),
  (error) => error instanceof AudioClipError && error.code === 'decoded_audio_too_large'
);
assert.deepEqual(assertAudioClipSelection(1, 4, 10), { start: 1, end: 4 });
assert.throws(() => assertAudioClipSelection(4, 4.05, 10), AudioClipError);
assert.equal(isAudioClipSupportedName('voice.WMA'), true);
assert.equal(isAudioClipSupportedName('voice.txt'), false);

console.log('Audio clip core regression checks passed');
