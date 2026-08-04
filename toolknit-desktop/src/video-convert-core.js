export const VIDEO_CONVERT_LIMITS = Object.freeze({
  maxFiles: 30,
  maxInputBytes: 10 * 1024 * 1024 * 1024
});

const TARGET_FORMATS = new Set(['MP4', 'AVI', 'MKV', 'MOV', 'WEBM', 'FLV', 'WMV', 'TS']);
const SOURCE_EXTENSIONS = new Set(['mp4', 'avi', 'mkv', 'mov', 'webm', 'flv', 'wmv', 'ts', 'm4v']);

export class VideoConvertError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VideoConvertError';
    this.code = code;
  }
}

export function normalizeVideoTargetFormat(value) {
  const format = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!TARGET_FORMATS.has(format)) {
    throw new VideoConvertError('invalid_target_format', 'Unsupported target video format.');
  }
  return format;
}

export function validateVideoBatchSelection(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new VideoConvertError('missing_input', 'Select at least one video file.');
  }
  if (files.length > VIDEO_CONVERT_LIMITS.maxFiles) {
    throw new VideoConvertError('too_many_files', `A batch can contain at most ${VIDEO_CONVERT_LIMITS.maxFiles} video files.`);
  }

  const seen = new Set();
  for (const [index, file] of files.entries()) {
    const name = typeof file?.name === 'string' ? file.name.trim() : '';
    const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    if (!name || !SOURCE_EXTENSIONS.has(extension)) {
      throw new VideoConvertError('invalid_input', `Invalid video file at position ${index + 1}.`);
    }
    if (Number.isFinite(file?.size) && file.size > VIDEO_CONVERT_LIMITS.maxInputBytes) {
      throw new VideoConvertError('input_too_large', `${name} exceeds the 10 GB file limit.`);
    }
    const identity = typeof file?.path === 'string' && file.path
      ? `path:${file.path}`
      : `file:${name}\u0000${file?.size ?? ''}`;
    if (seen.has(identity)) {
      throw new VideoConvertError('duplicate_input', `Duplicate video file: ${name}`);
    }
    seen.add(identity);
  }

  return files;
}
