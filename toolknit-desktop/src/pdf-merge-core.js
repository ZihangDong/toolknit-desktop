import { PDFDocument, degrees } from 'pdf-lib';

export const PDF_MERGE_LIMITS = Object.freeze({
  maxFiles: 25,
  maxTotalBytes: 150 * 1024 * 1024,
  maxPreviewPages: 200
});

export function assertPdfMergeSelection(files, totalBytes, limits = PDF_MERGE_LIMITS) {
  if (!Array.isArray(files) || files.length < 2) {
    throw new Error('At least two PDF files are required');
  }
  if (files.length > limits.maxFiles) {
    throw new Error(`Too many PDF files (max ${limits.maxFiles})`);
  }
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) {
    throw new Error('Invalid PDF file size');
  }
  if (totalBytes > limits.maxTotalBytes) {
    throw new Error(`PDF inputs exceed the ${Math.floor(limits.maxTotalBytes / 1024 / 1024)}MB merge limit`);
  }
}

export async function mergePdfPages({ documents, pages }) {
  if (!Array.isArray(documents) || !Array.isArray(pages) || pages.length === 0) {
    throw new Error('No PDF pages are available to merge');
  }

  const mergedPdf = await PDFDocument.create();
  const sourceCache = new Map();

  for (const pageData of pages) {
    const { fileIndex, pageIndex, rotation = 0 } = pageData;
    const documentInfo = documents[fileIndex];
    if (!documentInfo?.fileData?.length) {
      throw new Error(`Missing PDF data for file index ${fileIndex}`);
    }
    if (!Number.isInteger(pageIndex) || pageIndex < 1) {
      throw new Error(`Invalid page index for file index ${fileIndex}`);
    }
    if (!Number.isFinite(rotation) || rotation % 90 !== 0) {
      throw new Error(`Invalid page rotation for file index ${fileIndex}`);
    }

    let sourcePdf = sourceCache.get(fileIndex);
    if (!sourcePdf) {
      sourcePdf = await PDFDocument.load(documentInfo.fileData.slice());
      sourceCache.set(fileIndex, sourcePdf);
    }
    if (pageIndex > sourcePdf.getPageCount()) {
      throw new Error(`Page ${pageIndex} is outside file index ${fileIndex}`);
    }

    const [copiedPage] = await mergedPdf.copyPages(sourcePdf, [pageIndex - 1]);
    copiedPage.setRotation(degrees(copiedPage.getRotation().angle + rotation));
    mergedPdf.addPage(copiedPage);
  }

  return mergedPdf.save();
}
