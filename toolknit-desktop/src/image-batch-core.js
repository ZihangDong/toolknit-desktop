export const IMAGE_BATCH_LIMITS = Object.freeze({
  maxFiles: 100,
  maxBytesPerFile: 20 * 1024 * 1024,
  maxPixelsPerFile: 40_000_000
});

const SUPPORTED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif']);
const TARGET_FORMATS = new Set(['JPG', 'PNG', 'WEBP', 'BMP', 'GIF', 'SVG']);
const COMPRESSIBLE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const COMPRESSION_QUALITIES = new Set(['high', 'medium', 'low']);

export class ImageBatchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ImageBatchError';
    this.code = code;
  }
}

export function getImageExtension(fileName) {
  if (typeof fileName !== 'string') return '';
  const match = /\.([^.\\/]+)$/.exec(fileName.trim());
  return match ? match[1].toLowerCase() : '';
}

export function isSupportedImageFileName(fileName) {
  return SUPPORTED_EXTENSIONS.has(getImageExtension(fileName));
}

export function normalizeImageTargetFormat(value) {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  const target = normalized === 'JPEG' ? 'JPG' : normalized;
  if (!TARGET_FORMATS.has(target)) {
    throw new ImageBatchError('invalid_target_format', 'Unsupported image target format.');
  }
  return target;
}

export function isSupportedImageCompressionFileName(fileName) {
  return COMPRESSIBLE_EXTENSIONS.has(getImageExtension(fileName));
}

export function normalizeImageCompressionQuality(value) {
  const quality = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!COMPRESSION_QUALITIES.has(quality)) {
    throw new ImageBatchError('invalid_compression_quality', 'Unsupported image compression quality.');
  }
  return quality;
}

export function validateImageBatchSelection(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new ImageBatchError('missing_input', 'Select at least one image file.');
  }
  if (files.length > IMAGE_BATCH_LIMITS.maxFiles) {
    throw new ImageBatchError('too_many_files', `A batch can contain at most ${IMAGE_BATCH_LIMITS.maxFiles} image files.`);
  }

  const seen = new Set();
  return files.map((file, index) => {
    const name = typeof file?.name === 'string' ? file.name.trim() : '';
    if (!name || !isSupportedImageFileName(name)) {
      throw new ImageBatchError('unsupported_input', `Unsupported image file at position ${index + 1}.`);
    }

    const identity = typeof file?.path === 'string' && file.path
      ? `path:${file.path}`
      : `file:${name}\u0000${file?.size ?? ''}`;
    if (seen.has(identity)) {
      throw new ImageBatchError('duplicate_input', `Duplicate image file: ${name}`);
    }
    seen.add(identity);

    const size = Number(file?.size);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new ImageBatchError('invalid_file_size', `Image file has an invalid size at position ${index + 1}.`);
    }
    if (size > IMAGE_BATCH_LIMITS.maxBytesPerFile) {
      throw new ImageBatchError('file_too_large', `Image file exceeds the ${IMAGE_BATCH_LIMITS.maxBytesPerFile}-byte limit.`);
    }
    return file;
  });
}

export function validateImageCompressionSelection(files) {
  const validated = validateImageBatchSelection(files);
  for (const [index, file] of validated.entries()) {
    if (!isSupportedImageCompressionFileName(file.name)) {
      throw new ImageBatchError('unsupported_compression_input', `Image format cannot be compressed safely at position ${index + 1}.`);
    }
  }
  return validated;
}
