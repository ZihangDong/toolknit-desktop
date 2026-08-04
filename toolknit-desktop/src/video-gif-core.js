export const VIDEO_GIF_LIMITS = Object.freeze({
  maxInputBytes: 10 * 1024 * 1024 * 1024,
  maxTimestampMs: 24 * 60 * 60 * 1000,
  maxDurationMs: 30_000,
  minFrameRate: 1,
  maxFrameRate: 20,
  defaultFrameRate: 12,
  minWidth: 160,
  maxWidth: 1920,
  defaultWidth: 640,
  qualityValues: ['high', 'balanced', 'small', 'tiny'],
  defaultQuality: 'balanced',
  maxOutputBytes: 500 * 1024 * 1024
});

const VIDEO_EXTENSIONS = new Set(['mp4', 'avi', 'mkv', 'mov', 'webm', 'flv', 'wmv', 'ts', 'm4v']);

export class VideoGifError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VideoGifError';
    this.code = code;
  }
}

export function validateVideoGifInput(file) {
  const name = typeof file?.name === 'string' ? file.name.trim() : '';
  const extension = name.includes('.') ? name.split('.').at(-1).toLowerCase() : '';
  if (!name || !VIDEO_EXTENSIONS.has(extension)) throw new VideoGifError('invalid_input', 'Select a supported video file.');
  if (Number.isFinite(file?.size) && file.size > VIDEO_GIF_LIMITS.maxInputBytes) throw new VideoGifError('input_too_large', 'Video files must be 10 GB or smaller.');
  return file;
}

function integer(value, label, { min, max }) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new VideoGifError('invalid_argument', `${label} must be an integer from ${min} to ${max}.`);
  return parsed;
}

export function normalizeVideoGifRequest(value, durationSeconds = undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new VideoGifError('invalid_argument', 'GIF settings are required.');
  const startMs = integer(value.startMs ?? value.start_ms, 'Start timestamp', { min: 0, max: VIDEO_GIF_LIMITS.maxTimestampMs });
  const endMs = integer(value.endMs ?? value.end_ms, 'End timestamp', { min: 1, max: VIDEO_GIF_LIMITS.maxTimestampMs });
  if (endMs <= startMs) throw new VideoGifError('invalid_range', 'End timestamp must be after start timestamp.');
  if (endMs - startMs > VIDEO_GIF_LIMITS.maxDurationMs) throw new VideoGifError('duration_too_long', 'GIF selections can be at most 30 seconds.');
  const durationMs = Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds * 1000) : null;
  if (durationMs !== null && endMs > durationMs) throw new VideoGifError('timestamp_out_of_range', 'GIF selection extends beyond the video duration.');
  const frameRate = value.frameRate ?? value.frame_rate ?? VIDEO_GIF_LIMITS.defaultFrameRate;
  const width = value.width ?? VIDEO_GIF_LIMITS.defaultWidth;
  const quality = String(value.quality ?? VIDEO_GIF_LIMITS.defaultQuality).trim().toLowerCase();
  if (!VIDEO_GIF_LIMITS.qualityValues.includes(quality)) {
    throw new VideoGifError('invalid_argument', `Quality must be one of: ${VIDEO_GIF_LIMITS.qualityValues.join(', ')}.`);
  }
  return {
    start_ms: startMs,
    end_ms: endMs,
    duration_ms: endMs - startMs,
    frame_rate: integer(frameRate, 'Frame rate', { min: VIDEO_GIF_LIMITS.minFrameRate, max: VIDEO_GIF_LIMITS.maxFrameRate }),
    width: integer(width, 'Output width', { min: VIDEO_GIF_LIMITS.minWidth, max: VIDEO_GIF_LIMITS.maxWidth }),
    quality
  };
}

export function createDefaultVideoGifSelection(durationSeconds) {
  const durationMs = Math.round(Number(durationSeconds) * 1000);
  if (!Number.isFinite(durationMs) || durationMs < 1) {
    throw new VideoGifError('invalid_duration', 'Video duration must be greater than zero.');
  }
  return {
    start_ms: 0,
    end_ms: Math.min(durationMs, VIDEO_GIF_LIMITS.maxDurationMs)
  };
}

export function videoGifTimeLabel(milliseconds) {
  const value = Math.max(0, Math.round(Number(milliseconds) || 0));
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  const fraction = value % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}`;
}
