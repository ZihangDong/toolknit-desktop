export const AUDIO_EXTRACT_LIMITS = Object.freeze({
  maxInputBytes: 10 * 1024 * 1024 * 1024,
  maxTrackIndex: 31
});

const VIDEO_EXTENSIONS = new Set(['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'ts', 'm4v']);
const TARGET_FORMATS = new Set(['MP3', 'AAC', 'WAV', 'FLAC', 'OGG']);

export class AudioExtractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AudioExtractError';
    this.code = code;
  }
}

export function normalizeAudioExtractFormat(value) {
  const format = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!TARGET_FORMATS.has(format)) {
    throw new AudioExtractError('invalid_target_format', 'Unsupported audio extraction target format.');
  }
  return format;
}

export function assertAudioExtractInput(file) {
  const name = typeof file?.name === 'string' ? file.name.trim() : '';
  const size = Number(file?.size);
  const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (!name || !VIDEO_EXTENSIONS.has(extension)) {
    throw new AudioExtractError('invalid_input', 'Select a supported video file.');
  }
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new AudioExtractError('invalid_input', 'The selected video file has an invalid size.');
  }
  if (size > AUDIO_EXTRACT_LIMITS.maxInputBytes) {
    throw new AudioExtractError('input_too_large', 'Video files for audio extraction must be 10GB or smaller.');
  }
  return file;
}

export function normalizeAudioTrackIndex(value) {
  if (value === null || value === undefined || value === '') return null;
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index > AUDIO_EXTRACT_LIMITS.maxTrackIndex) {
    throw new AudioExtractError('invalid_track', 'The selected audio track is invalid.');
  }
  return index;
}
