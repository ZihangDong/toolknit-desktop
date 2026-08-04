export const AUDIO_CLIP_LIMITS = Object.freeze({
  maxInputBytes: 100 * 1024 * 1024,
  maxDurationSeconds: 20 * 60,
  maxChannels: 2,
  maxDecodedPcmBytes: 256 * 1024 * 1024,
  minSelectionSeconds: 0.1
});

const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma']);

export class AudioClipError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AudioClipError';
    this.code = code;
  }
}

export function assertAudioClipInput(file) {
  const name = typeof file?.name === 'string' ? file.name.trim() : '';
  const size = Number(file?.size);
  const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (!name || !AUDIO_EXTENSIONS.has(extension)) {
    throw new AudioClipError('invalid_input', 'Select a supported audio file.');
  }
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new AudioClipError('invalid_input', 'The audio file is empty or has an invalid size.');
  }
  if (size > AUDIO_CLIP_LIMITS.maxInputBytes) {
    throw new AudioClipError('input_too_large', 'Audio files for clipping must be 100MB or smaller.');
  }
  return file;
}

export function assertAudioClipBuffer(audioBuffer) {
  const duration = Number(audioBuffer?.duration);
  const channels = Number(audioBuffer?.numberOfChannels);
  const sampleRate = Number(audioBuffer?.sampleRate);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new AudioClipError('invalid_audio', 'The selected file could not be decoded as audio.');
  }
  if (duration > AUDIO_CLIP_LIMITS.maxDurationSeconds) {
    throw new AudioClipError('audio_too_long', 'Audio clipping supports audio up to 20 minutes.');
  }
  if (!Number.isInteger(channels) || channels < 1 || channels > AUDIO_CLIP_LIMITS.maxChannels) {
    throw new AudioClipError('unsupported_channels', 'Audio clipping supports mono or stereo audio only.');
  }
  const frameCount = Number.isSafeInteger(audioBuffer?.length) && audioBuffer.length > 0
    ? audioBuffer.length
    : Math.ceil(duration * sampleRate);
  const decodedBytes = frameCount * channels * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(frameCount) || !Number.isSafeInteger(decodedBytes) || decodedBytes > AUDIO_CLIP_LIMITS.maxDecodedPcmBytes) {
    throw new AudioClipError('decoded_audio_too_large', 'The decoded audio is too large for safe clipping.');
  }
  return audioBuffer;
}

export function isAudioClipSupportedName(name) {
  const extension = typeof name === 'string' ? /\.([^.\\/]+)$/.exec(name.trim())?.[1]?.toLowerCase() : '';
  return AUDIO_EXTENSIONS.has(extension);
}

export function assertAudioClipSelection(startTime, endTime, duration) {
  const start = Number(startTime);
  const end = Number(endTime);
  const total = Number(duration);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(total)
    || start < 0 || end > total || end - start < AUDIO_CLIP_LIMITS.minSelectionSeconds) {
    throw new AudioClipError('invalid_selection', 'The clip selection is invalid.');
  }
  return { start, end };
}
