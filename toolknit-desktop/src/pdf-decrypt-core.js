export const PDF_DECRYPT_LIMITS = Object.freeze({
  maxInputBytes: 150 * 1024 * 1024,
  maxPages: 200
});

export const PDF_DECRYPT_ERROR_PREFIX = 'pdf-decrypt:';

export function assertPdfDecryptSelection(files, totalBytes, limits = PDF_DECRYPT_LIMITS) {
  if (!Array.isArray(files) || files.length !== 1) {
    throw new Error('Exactly one PDF file is required');
  }
  const fileName = String(files[0]?.name || '');
  if (!/\.pdf$/i.test(fileName)) {
    throw new Error('A PDF file is required');
  }
  assertPdfDecryptInputSize(totalBytes, limits);
}

export function assertPdfDecryptInputSize(totalBytes, limits = PDF_DECRYPT_LIMITS) {
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 1) {
    throw new Error('Invalid PDF file size');
  }
  if (totalBytes > limits.maxInputBytes) {
    throw new Error(`PDF input exceeds the ${Math.floor(limits.maxInputBytes / 1024 / 1024)}MB decryption limit`);
  }
}

export function assertPdfDecryptPageCount(pageCount, limits = PDF_DECRYPT_LIMITS) {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw new Error('PDF has no pages to decrypt');
  }
  if (pageCount > limits.maxPages) {
    throw new Error(`PDF input exceeds the ${limits.maxPages}-page decryption limit`);
  }
}

export function assertPdfDecryptPassword(password) {
  if (typeof password !== 'string') {
    throw new Error('Invalid PDF password');
  }
  if (/[\r\n]/.test(password)) {
    throw new Error('PDF password cannot contain line breaks');
  }
}

export function getPdfDecryptErrorCode(error) {
  const message = String(error?.message || error || '');
  const match = message.match(/pdf-decrypt:([a-z-]+)/i);
  return match ? match[1].toLowerCase() : 'decryption-failed';
}
