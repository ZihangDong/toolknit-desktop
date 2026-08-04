import { PDFDocument } from 'pdf-lib';

export const PDF_SPLIT_LIMITS = Object.freeze({
  maxFiles: 25,
  maxTotalBytes: 150 * 1024 * 1024,
  maxPreviewPages: 200
});

export function assertPdfSplitSelection(files, totalBytes, limits = PDF_SPLIT_LIMITS) {
  if (!Array.isArray(files) || files.length < 1) {
    throw new Error('At least one PDF file is required');
  }
  if (files.length > limits.maxFiles) {
    throw new Error(`Too many PDF files (max ${limits.maxFiles})`);
  }
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) {
    throw new Error('Invalid PDF file size');
  }
  if (totalBytes > limits.maxTotalBytes) {
    throw new Error(`PDF inputs exceed the ${Math.floor(limits.maxTotalBytes / 1024 / 1024)}MB split limit`);
  }
}

export function assertPdfSplitPageCount(pageCount, limits = PDF_SPLIT_LIMITS) {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw new Error('PDF has no pages to split');
  }
  if (pageCount > limits.maxPreviewPages) {
    throw new Error(`PDF inputs exceed the ${limits.maxPreviewPages}-page split limit`);
  }
}

export function createPdfSplitFileName(sourceName, pageIndex) {
  if (!Number.isInteger(pageIndex) || pageIndex < 1) {
    throw new Error('Invalid PDF page index');
  }
  const baseName = String(sourceName || 'document.pdf')
    .split(/[\\/]/)
    .pop()
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim() || 'document';
  return `${baseName}_page_${pageIndex}.pdf`;
}

export async function splitPdfPages({ documents, pages, onProgress }) {
  if (!Array.isArray(documents) || !Array.isArray(pages) || pages.length === 0) {
    throw new Error('No PDF pages are selected for export');
  }

  const sourceCache = new Map();
  const outputs = [];

  for (let outputIndex = 0; outputIndex < pages.length; outputIndex++) {
    const pageData = pages[outputIndex];
    const { fileIndex, pageIndex } = pageData || {};
    const documentInfo = documents[fileIndex];
    if (!documentInfo?.fileData?.length) {
      throw new Error(`Missing PDF data for file index ${fileIndex}`);
    }
    if (!Number.isInteger(pageIndex) || pageIndex < 1) {
      throw new Error(`Invalid page index for file index ${fileIndex}`);
    }

    let sourcePdf = sourceCache.get(fileIndex);
    if (!sourcePdf) {
      sourcePdf = await PDFDocument.load(documentInfo.fileData.slice());
      sourceCache.set(fileIndex, sourcePdf);
    }
    if (pageIndex > sourcePdf.getPageCount()) {
      throw new Error(`Page ${pageIndex} is outside file index ${fileIndex}`);
    }

    const outputPdf = await PDFDocument.create();
    const [copiedPage] = await outputPdf.copyPages(sourcePdf, [pageIndex - 1]);
    outputPdf.addPage(copiedPage);
    const output = {
      fileIndex,
      pageIndex,
      fileName: createPdfSplitFileName(documentInfo.fileName, pageIndex),
      bytes: await outputPdf.save()
    };
    outputs.push(output);
    await onProgress?.({ completed: outputIndex + 1, total: pages.length, output });
  }

  return outputs;
}
