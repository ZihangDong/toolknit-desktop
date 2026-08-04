import { PDFDocument, degrees } from 'pdf-lib';

export const PDF_ROTATE_LIMITS = Object.freeze({
  maxInputBytes: 150 * 1024 * 1024,
  maxPreviewPages: 200
});

export function assertPdfRotateSelection(files, totalBytes, limits = PDF_ROTATE_LIMITS) {
  if (!Array.isArray(files) || files.length !== 1) {
    throw new Error('Exactly one PDF file is required');
  }
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 1) {
    throw new Error('Invalid PDF file size');
  }
  if (totalBytes > limits.maxInputBytes) {
    throw new Error(`PDF input exceeds the ${Math.floor(limits.maxInputBytes / 1024 / 1024)}MB rotation limit`);
  }
}

export function assertPdfRotatePageCount(pageCount, limits = PDF_ROTATE_LIMITS) {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw new Error('PDF has no pages to rotate');
  }
  if (pageCount > limits.maxPreviewPages) {
    throw new Error(`PDF input exceeds the ${limits.maxPreviewPages}-page rotation limit`);
  }
}

export function assertPdfRotateInput(fileData, limits = PDF_ROTATE_LIMITS) {
  if (!fileData?.length || !Number.isSafeInteger(fileData.length)) {
    throw new Error('Invalid PDF file data');
  }
  if (fileData.length > limits.maxInputBytes) {
    throw new Error(`PDF input exceeds the ${Math.floor(limits.maxInputBytes / 1024 / 1024)}MB rotation limit`);
  }
}

export function normalizePdfRotation(rotation) {
  if (!Number.isFinite(rotation) || rotation % 90 !== 0) {
    throw new Error('PDF rotation must be a multiple of 90 degrees');
  }
  return ((rotation % 360) + 360) % 360;
}

export function createPdfRotateFileName(sourceName, pageIndex) {
  if (pageIndex !== undefined && (!Number.isInteger(pageIndex) || pageIndex < 1)) {
    throw new Error('Invalid PDF page index');
  }
  const baseName = String(sourceName || 'document.pdf')
    .split(/[\\/]/)
    .pop()
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim() || 'document';
  return pageIndex === undefined
    ? `${baseName}_rotated.pdf`
    : `${baseName}_page_${pageIndex}_rotated.pdf`;
}

export async function rotatePdfPages({ fileData, pages, onProgress }) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('No PDF pages are available to rotate');
  }
  assertPdfRotateInput(fileData);

  // Do not ignore encryption: a user must unlock protected PDFs in the dedicated tool.
  const sourcePdf = await PDFDocument.load(fileData.slice());
  const outputPdf = await PDFDocument.create();
  const sourcePageCount = sourcePdf.getPageCount();
  assertPdfRotatePageCount(sourcePageCount);

  for (let outputIndex = 0; outputIndex < pages.length; outputIndex++) {
    const { pageIndex, rotation = 0 } = pages[outputIndex] || {};
    if (!Number.isInteger(pageIndex) || pageIndex < 1 || pageIndex > sourcePageCount) {
      throw new Error(`Page ${pageIndex} is outside the source PDF`);
    }
    const normalizedRotation = normalizePdfRotation(rotation);
    const [copiedPage] = await outputPdf.copyPages(sourcePdf, [pageIndex - 1]);
    copiedPage.setRotation(degrees((copiedPage.getRotation().angle + normalizedRotation) % 360));
    outputPdf.addPage(copiedPage);
    await onProgress?.({ completed: outputIndex + 1, total: pages.length });
  }

  return outputPdf.save();
}
