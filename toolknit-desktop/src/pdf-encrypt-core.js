import { PDFDocument } from 'pdf-lib-plus-encrypt';

export const PDF_ENCRYPT_LIMITS = Object.freeze({
  maxInputBytes: 150 * 1024 * 1024,
  maxPages: 200,
  minPasswordLength: 8
});

export function assertPdfEncryptSelection(files, totalBytes, limits = PDF_ENCRYPT_LIMITS) {
  if (!Array.isArray(files) || files.length !== 1) {
    throw new Error('Exactly one PDF file is required');
  }
  assertPdfEncryptInput({ length: totalBytes }, limits);
}

export function assertPdfEncryptInput(fileData, limits = PDF_ENCRYPT_LIMITS) {
  if (!fileData?.length || !Number.isSafeInteger(fileData.length)) {
    throw new Error('Invalid PDF file data');
  }
  if (fileData.length > limits.maxInputBytes) {
    throw new Error(`PDF input exceeds the ${Math.floor(limits.maxInputBytes / 1024 / 1024)}MB encryption limit`);
  }
}

export function assertPdfEncryptPageCount(pageCount, limits = PDF_ENCRYPT_LIMITS) {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw new Error('PDF has no pages to encrypt');
  }
  if (pageCount > limits.maxPages) {
    throw new Error(`PDF input exceeds the ${limits.maxPages}-page encryption limit`);
  }
}

export function assertPdfEncryptPassword(password, limits = PDF_ENCRYPT_LIMITS) {
  if (typeof password !== 'string' || password.length < limits.minPasswordLength) {
    throw new Error(`PDF password must contain at least ${limits.minPasswordLength} characters`);
  }
}

export function normalizePdfEncryptPermissions(permissions = {}) {
  const printing = permissions.printing === 'lowResolution' || permissions.printing === 'highResolution'
    ? permissions.printing
    : permissions.printing === false
      ? false
      : 'highResolution';
  return {
    printing,
    modifying: permissions.modifying !== false,
    copying: permissions.copying !== false,
    annotating: permissions.annotating !== false,
    fillingForms: permissions.fillingForms !== false,
    contentAccessibility: permissions.contentAccessibility !== false,
    documentAssembly: permissions.documentAssembly !== false
  };
}

export function createPdfEncryptFileName(sourceName) {
  const baseName = String(sourceName || 'document.pdf')
    .split(/[\\/]/)
    .pop()
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim() || 'document';
  return `${baseName}_encrypted.pdf`;
}

function createOwnerPassword() {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('Secure random source is unavailable');
  }
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function encryptPdf({ fileData, password, permissions, onProgress }) {
  assertPdfEncryptInput(fileData);
  assertPdfEncryptPassword(password);
  await onProgress?.({ stage: 'loading', percent: 20 });

  // Existing protected files must be explicitly unlocked by PDF Decrypt first.
  const pdfDocument = await PDFDocument.load(fileData.slice());
  assertPdfEncryptPageCount(pdfDocument.getPageCount());
  await onProgress?.({ stage: 'encrypting', percent: 60 });

  await pdfDocument.encrypt({
    userPassword: password,
    ownerPassword: createOwnerPassword(),
    permissions: normalizePdfEncryptPermissions(permissions)
  });
  const bytes = await pdfDocument.save({ useObjectStreams: false });
  await onProgress?.({ stage: 'saving', percent: 90 });
  return bytes;
}
