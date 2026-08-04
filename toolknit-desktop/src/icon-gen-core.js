export const ICON_GEN_LIMITS = Object.freeze({
  maxInputBytes: 20 * 1024 * 1024,
  maxInputPixels: 20_000_000,
  maxOutputBytes: 32 * 1024 * 1024
});

const SUPPORTED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

export class IconGenerationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IconGenerationError';
    this.code = code;
  }
}

export function isSupportedIconSource(fileName) {
  if (typeof fileName !== 'string') return false;
  const match = /\.([^.\\/]+)$/.exec(fileName.trim());
  return Boolean(match && SUPPORTED_EXTENSIONS.has(match[1].toLowerCase()));
}

export function assertIconSource(file, size = file?.size) {
  if (!file || !isSupportedIconSource(file.name)) {
    throw new IconGenerationError('unsupported_input', 'Only PNG, JPEG, and WebP images can be used for icon generation.');
  }
  const byteSize = Number(size);
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) {
    throw new IconGenerationError('invalid_input_size', 'The image file is empty or has an invalid size.');
  }
  if (byteSize > ICON_GEN_LIMITS.maxInputBytes) {
    throw new IconGenerationError('input_too_large', 'The image exceeds the supported file size limit.');
  }
}

export function assertIconSourceDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new IconGenerationError('invalid_dimensions', 'Image dimensions are invalid.');
  }
  if (width * height > ICON_GEN_LIMITS.maxInputPixels) {
    throw new IconGenerationError('too_many_pixels', 'Image dimensions exceed the supported pixel limit.');
  }
}

export function assertIconArchiveSize(size) {
  const byteSize = Number(size);
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > ICON_GEN_LIMITS.maxOutputBytes) {
    throw new IconGenerationError('archive_too_large', 'Generated icon archive exceeds the supported size limit.');
  }
}
