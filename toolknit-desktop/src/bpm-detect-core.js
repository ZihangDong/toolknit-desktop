export const BPM_DETECT_LIMITS = Object.freeze({
  maxInputBytes: 50 * 1024 * 1024,
  maxDurationSeconds: 5 * 60,
  maxChannels: 2,
  maxDecodedPcmBytes: 192 * 1024 * 1024,
  maxAnalysisSeconds: 120,
  analysisSampleRate: 11025
});

const BPM_DISPLAY_MIN = 30;
const BPM_DISPLAY_MAX = 300;
const BPM_SOURCE_EXTENSIONS = new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a']);
const BPM_ANALYSIS_MIN = 55;
const BPM_ANALYSIS_MAX = 210;
const BPM_ENVELOPE_WINDOW = 1024;
const BPM_ENVELOPE_HOP = 512;

export class BpmDetectError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BpmDetectError';
    this.code = code;
  }
}

export function assertBpmInputSize(byteLength) {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
    throw new BpmDetectError('invalid_input', 'The audio file is empty or has an invalid size.');
  }
  if (byteLength > BPM_DETECT_LIMITS.maxInputBytes) {
    throw new BpmDetectError(
      'input_too_large',
      `Audio files for BPM detection must be ${Math.floor(BPM_DETECT_LIMITS.maxInputBytes / 1024 / 1024)}MB or smaller.`
    );
  }
  return byteLength;
}

export function assertBpmAudioBuffer(audioBuffer) {
  const duration = Number(audioBuffer?.duration);
  const channels = Number(audioBuffer?.numberOfChannels);
  const sampleRate = Number(audioBuffer?.sampleRate);

  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new BpmDetectError('invalid_audio', 'The selected file could not be decoded as audio.');
  }
  if (duration > BPM_DETECT_LIMITS.maxDurationSeconds) {
    throw new BpmDetectError(
      'audio_too_long',
      `BPM detection supports audio up to ${Math.floor(BPM_DETECT_LIMITS.maxDurationSeconds / 60)} minutes.`
    );
  }
  if (!Number.isInteger(channels) || channels < 1 || channels > BPM_DETECT_LIMITS.maxChannels) {
    throw new BpmDetectError('unsupported_channels', 'BPM detection supports mono or stereo audio only.');
  }
  const frameCount = Number.isSafeInteger(audioBuffer?.length) && audioBuffer.length > 0
    ? audioBuffer.length
    : Math.ceil(duration * sampleRate);
  const decodedBytes = frameCount * channels * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(frameCount) || !Number.isSafeInteger(decodedBytes) || decodedBytes > BPM_DETECT_LIMITS.maxDecodedPcmBytes) {
    throw new BpmDetectError('decoded_audio_too_large', 'The decoded audio is too large for safe BPM analysis.');
  }
  return audioBuffer;
}

export function getBpmAnalysisSpec(audioBuffer) {
  assertBpmAudioBuffer(audioBuffer);
  const sampleRate = Math.min(audioBuffer.sampleRate, BPM_DETECT_LIMITS.analysisSampleRate);
  const duration = Math.min(audioBuffer.duration, BPM_DETECT_LIMITS.maxAnalysisSeconds);
  const frameCount = Math.max(1, Math.floor(duration * sampleRate));
  return { sampleRate, frameCount };
}

export function normalizeBpmCandidates(tempos) {
  if (!Array.isArray(tempos)) return [];
  return tempos
    .map((candidate) => {
      const tempo = Number(candidate?.tempo);
      const count = Number(candidate?.count);
      return {
        tempo,
        count: Number.isFinite(count) && count >= 0 ? count : 0
      };
    })
    .filter(({ tempo }) => Number.isFinite(tempo) && tempo >= BPM_DISPLAY_MIN && tempo <= BPM_DISPLAY_MAX)
    .sort((left, right) => right.count - left.count || left.tempo - right.tempo)
    .slice(0, 5);
}

export function isBpmSupportedAudioName(name) {
  const extension = typeof name === 'string' ? /\.([^.\\/]+)$/.exec(name.trim())?.[1]?.toLowerCase() : '';
  return BPM_SOURCE_EXTENSIONS.has(extension);
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function normalizeTempo(tempo) {
  let normalized = tempo;
  while (normalized < BPM_ANALYSIS_MIN) normalized *= 2;
  while (normalized > BPM_ANALYSIS_MAX) normalized /= 2;
  return normalized;
}

// This is intentionally dependency-free so browser and headless callers analyze the same PCM data.
export function analyzeBpmPcm(samples, sampleRate) {
  if (!(samples instanceof Float32Array) || samples.length < BPM_ENVELOPE_WINDOW * 8) {
    throw new BpmDetectError('invalid_audio', 'The decoded audio is too short for BPM analysis.');
  }
  if (!Number.isFinite(sampleRate) || sampleRate < 1000 || sampleRate > 192000) {
    throw new BpmDetectError('invalid_audio', 'The decoded audio has an invalid sample rate.');
  }

  const energies = [];
  for (let start = 0; start + BPM_ENVELOPE_WINDOW <= samples.length; start += BPM_ENVELOPE_HOP) {
    let sum = 0;
    for (let index = start; index < start + BPM_ENVELOPE_WINDOW; index++) sum += samples[index] * samples[index];
    energies.push(Math.sqrt(sum / BPM_ENVELOPE_WINDOW));
  }
  const floor = median(energies);
  const deviations = energies.map(value => Math.max(0, value - floor));
  const envelope = new Float64Array(deviations.length);
  let peak = 0;
  let onsetTotal = 0;
  for (let index = 0; index < deviations.length; index++) {
    const start = Math.max(0, index - 8);
    let localAverage = 0;
    for (let cursor = start; cursor < index; cursor++) localAverage += deviations[cursor];
    localAverage /= Math.max(1, index - start);
    const onset = Math.max(0, deviations[index] - localAverage * 0.55);
    envelope[index] = onset;
    peak = Math.max(peak, onset);
    onsetTotal += onset;
  }
  if (peak < 1e-5 || onsetTotal < 1e-4) {
    return { bpm: null, confidence: 0, candidates: [], analyzedSeconds: samples.length / sampleRate };
  }
  for (let index = 0; index < envelope.length; index++) envelope[index] /= peak;

  const envelopeRate = sampleRate / BPM_ENVELOPE_HOP;
  const minLag = Math.max(1, Math.floor((60 * envelopeRate) / BPM_ANALYSIS_MAX));
  const maxLag = Math.min(envelope.length - 2, Math.ceil((60 * envelopeRate) / BPM_ANALYSIS_MIN));
  const rawCandidates = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = lag; index < envelope.length; index++) {
      const left = envelope[index];
      const right = envelope[index - lag];
      sum += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const score = sum / Math.sqrt(leftEnergy * rightEnergy || 1);
    if (Number.isFinite(score)) rawCandidates.push({ lag, tempo: 60 * envelopeRate / lag, score });
  }

  const peaks = rawCandidates.map((candidate, index, values) => {
    const before = values[index - 1]?.score ?? -Infinity;
    const after = values[index + 1]?.score ?? -Infinity;
    if (candidate.score < before || candidate.score <= after) return null;
    const curvature = before - 2 * candidate.score + after;
    const offset = Number.isFinite(curvature) && curvature < -1e-9
      ? Math.max(-0.5, Math.min(0.5, 0.5 * (before - after) / curvature))
      : 0;
    return { ...candidate, tempo: 60 * envelopeRate / (candidate.lag + offset) };
  }).filter(Boolean);
  const merged = new Map();
  for (const candidate of peaks) {
    const tempo = normalizeTempo(candidate.tempo);
    const key = Math.round(tempo);
    const proximity = 1 - Math.min(0.08, Math.abs(tempo - 120) / 1500);
    const score = candidate.score * proximity;
    const current = merged.get(key);
    if (!current || current.score < score) merged.set(key, { bpm: key, score });
  }
  const candidates = [...merged.values()]
    .sort((left, right) => right.score - left.score || Math.abs(left.bpm - 120) - Math.abs(right.bpm - 120))
    .slice(0, 5);
  const first = candidates[0];
  if (!first || first.score < 0.08) {
    return { bpm: null, confidence: 0, candidates: [], analyzedSeconds: samples.length / sampleRate };
  }
  const secondScore = candidates[1]?.score ?? 0;
  const confidence = Math.round(Math.max(0, Math.min(1, first.score * (1 - Math.min(0.55, secondScore / Math.max(first.score, 1e-6) * 0.35)))) * 100) / 100;
  return {
    bpm: first.bpm,
    confidence,
    candidates: candidates.map(candidate => ({ bpm: candidate.bpm, confidence: Math.round(Math.max(0, Math.min(1, candidate.score)) * 100) / 100 })),
    analyzedSeconds: samples.length / sampleRate
  };
}
