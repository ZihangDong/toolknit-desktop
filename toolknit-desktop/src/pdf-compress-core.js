export const PDF_COMPRESS_LIMITS = Object.freeze({
  maxFiles: 10,
  maxInputBytes: 150 * 1024 * 1024,
  maxPages: 500
});

export const PDF_COMPRESS_LEVELS = new Set(['low', 'medium', 'high']);

export function assertPdfCompressSelection(files, limits = PDF_COMPRESS_LIMITS) {
  if (!Array.isArray(files) || files.length < 1) {
    throw new Error('At least one PDF file is required');
  }
  if (files.length > limits.maxFiles) {
    throw new Error(`PDF compression accepts at most ${limits.maxFiles} files at a time`);
  }
  for (const file of files) {
    if (!/\.pdf$/i.test(String(file?.name || ''))) {
      throw new Error('A PDF file is required');
    }
    const size = Number(file?.size);
    if (!Number.isSafeInteger(size) || size < 1) {
      throw new Error('Invalid PDF file size');
    }
    if (size > limits.maxInputBytes) {
      throw new Error(`PDF input exceeds the ${Math.floor(limits.maxInputBytes / 1024 / 1024)}MB compression limit`);
    }
  }
}

export function assertPdfCompressLevel(level) {
  if (!PDF_COMPRESS_LEVELS.has(level)) {
    throw new Error('Invalid PDF compression level');
  }
}

export function getPdfCompressErrorCode(error) {
  const match = String(error?.message || error || '').match(/pdf-compress:([a-z-]+)/i);
  return match ? match[1].toLowerCase() : 'compression-failed';
}
