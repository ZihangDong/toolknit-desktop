export const VIDEO_FRAME_LIMITS = Object.freeze({
  maxInputBytes: 10 * 1024 * 1024 * 1024,
  maxTimestampMs: 24 * 60 * 60 * 1000,
  formats: new Set(['png', 'jpg'])
});

const VIDEO_EXTENSIONS = new Set(['mp4', 'avi', 'mkv', 'mov', 'webm', 'flv', 'wmv', 'ts', 'm4v']);

export class VideoFrameError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VideoFrameError';
    this.code = code;
  }
}

export function normalizeVideoFrameFormat(value) {
  const format = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!VIDEO_FRAME_LIMITS.formats.has(format)) {
    throw new VideoFrameError('invalid_format', 'Output format must be PNG or JPG.');
  }
  return format;
}

export function normalizeVideoFrameTimestamp(value, durationSeconds = undefined) {
  const timestamp = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > VIDEO_FRAME_LIMITS.maxTimestampMs) {
    throw new VideoFrameError('invalid_timestamp', 'Timestamp must be a non-negative millisecond value within the supported range.');
  }
  const durationMs = Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds * 1000) : null;
  if (durationMs !== null && timestamp > durationMs) {
    throw new VideoFrameError('timestamp_out_of_range', 'Timestamp is outside the video duration.');
  }
  return Math.round(timestamp);
}

export function validateVideoFrameInput(file) {
  const name = typeof file?.name === 'string' ? file.name.trim() : '';
  const extension = name.includes('.') ? name.split('.').at(-1).toLowerCase() : '';
  if (!name || !VIDEO_EXTENSIONS.has(extension)) {
    throw new VideoFrameError('invalid_input', 'Select a supported video file.');
  }
  if (Number.isFinite(file?.size) && file.size > VIDEO_FRAME_LIMITS.maxInputBytes) {
    throw new VideoFrameError('input_too_large', 'Video files must be 10 GB or smaller.');
  }
  return file;
}

export function frameTimeLabel(timestampMs) {
  const total = Math.max(0, Math.round(Number(timestampMs) || 0));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const milliseconds = total % 1000;
  const prefix = hours ? `${String(hours).padStart(2, '0')}:` : '';
  return `${prefix}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}
