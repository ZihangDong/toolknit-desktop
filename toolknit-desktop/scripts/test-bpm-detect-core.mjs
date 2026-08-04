import assert from 'node:assert/strict';
import {
  BpmDetectError,
  BPM_DETECT_LIMITS,
  analyzeBpmPcm,
  assertBpmAudioBuffer,
  assertBpmInputSize,
  getBpmAnalysisSpec,
  isBpmSupportedAudioName,
  normalizeBpmCandidates
} from '../src/bpm-detect-core.js';

assert.equal(assertBpmInputSize(1024), 1024);
assert.throws(() => assertBpmInputSize(0), (error) => error instanceof BpmDetectError && error.code === 'invalid_input');
assert.throws(
  () => assertBpmInputSize(BPM_DETECT_LIMITS.maxInputBytes + 1),
  (error) => error instanceof BpmDetectError && error.code === 'input_too_large'
);
assert.equal(
  assertBpmAudioBuffer({ duration: 180, numberOfChannels: 2, sampleRate: 48000 }).duration,
  180
);
assert.throws(
  () => assertBpmAudioBuffer({ duration: BPM_DETECT_LIMITS.maxDurationSeconds + 1, numberOfChannels: 2, sampleRate: 48000 }),
  (error) => error instanceof BpmDetectError && error.code === 'audio_too_long'
);
assert.throws(
  () => assertBpmAudioBuffer({ duration: 180, numberOfChannels: 6, sampleRate: 48000 }),
  (error) => error instanceof BpmDetectError && error.code === 'unsupported_channels'
);
assert.throws(
  () => assertBpmAudioBuffer({
    duration: 240,
    numberOfChannels: 2,
    sampleRate: 192000,
    length: 240 * 192000
  }),
  (error) => error instanceof BpmDetectError && error.code === 'decoded_audio_too_large'
);
assert.deepEqual(
  getBpmAnalysisSpec({ duration: 180, numberOfChannels: 2, sampleRate: 48000, length: 180 * 48000 }),
  { sampleRate: BPM_DETECT_LIMITS.analysisSampleRate, frameCount: BPM_DETECT_LIMITS.maxAnalysisSeconds * BPM_DETECT_LIMITS.analysisSampleRate }
);
assert.deepEqual(
  normalizeBpmCandidates([{ tempo: 128.4, count: 2 }, { tempo: Infinity, count: 99 }, { tempo: 15, count: 99 }, { tempo: 120, count: 8 }]),
  [{ tempo: 120, count: 8 }, { tempo: 128.4, count: 2 }]
);
assert.equal(isBpmSupportedAudioName('track.M4A'), true);
assert.equal(isBpmSupportedAudioName('track.txt'), false);

const clickRate = BPM_DETECT_LIMITS.analysisSampleRate;
const clickSamples = new Float32Array(clickRate * 24);
for (let beat = 0; beat < 48; beat++) {
  const start = Math.round(beat * clickRate * 0.5);
  for (let offset = 0; offset < Math.min(110, clickSamples.length - start); offset++) {
    clickSamples[start + offset] = (1 - offset / 110) * 0.9;
  }
}
const detected = analyzeBpmPcm(clickSamples, clickRate);
assert.ok(detected.bpm >= 118 && detected.bpm <= 122, `Expected 120 BPM, got ${detected.bpm}`);
assert.ok(detected.confidence > 0.1);
assert.ok(detected.candidates.length >= 1);
assert.equal(analyzeBpmPcm(new Float32Array(clickRate), clickRate).bpm, null);

console.log('BPM detection core regression checks passed');
