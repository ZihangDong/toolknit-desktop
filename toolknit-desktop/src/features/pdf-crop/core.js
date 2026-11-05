import { copyPdfPages } from '../../core/pdf-page-copy.js';
import { PDFDocument } from 'pdf-lib';
import { flattenPdfFormForPageCopy } from '../../pdf-document-structure.js';

export const PDF_CROP_LIMITS = Object.freeze({
  maxInputBytes: 150 * 1024 * 1024,
  maxPages: 500,
  minCropPoints: 6
});

export const PDF_CROP_FULL_RECT = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

export class PdfCropCancelledError extends Error {
  constructor() {
    super('PDF crop operation cancelled');
    this.name = 'PdfCropCancelledError';
  }
}

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, number(value, min)));

export function normalizePdfCropRotation(value) {
  const normalized = ((Math.round(number(value) / 90) * 90) % 360 + 360) % 360;
  return [0, 90, 180, 270].includes(normalized) ? normalized : 0;
}

export function assertPdfCropFile(name, size, limits = PDF_CROP_LIMITS) {
  if (!/\.pdf$/i.test(String(name || ''))) throw new Error('A PDF file is required');
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('Invalid PDF file size');
  if (size > limits.maxInputBytes) {
    throw new Error(`PDF input exceeds the ${Math.floor(limits.maxInputBytes / 1024 / 1024)}MB limit`);
  }
}

export function assertPdfCropPageCount(count, limits = PDF_CROP_LIMITS) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('PDF has no pages');
  if (count > limits.maxPages) throw new Error(`PDF input exceeds the ${limits.maxPages}-page limit`);
}

export function sanitizePdfCropBaseName(value) {
  return String(value || 'document')
    .split(/[\\/]/)
    .pop()
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96) || 'document';
}

export function createPdfCropFileName(value, mode = 'single') {
  const base = sanitizePdfCropBaseName(value);
  return mode === 'zip' ? `${base}_cropped_pages.zip` : `${base}_cropped.pdf`;
}

export function createPdfCropPageFileName(value, pageNumber, totalPages = 1) {
  const digits = Math.max(3, String(Math.max(1, Math.trunc(number(totalPages, 1)))).length);
  return `${sanitizePdfCropBaseName(value)}_page_${String(Math.max(1, Math.trunc(number(pageNumber, 1)))).padStart(digits, '0')}.pdf`;
}

export function normalizePdfCropRect(value = PDF_CROP_FULL_RECT, minSize = 0.002) {
  const minimum = clamp(minSize, 0.0001, 0.5);
  let x = clamp(value.x, 0, 1);
  let y = clamp(value.y, 0, 1);
  let width = clamp(value.width, minimum, 1);
  let height = clamp(value.height, minimum, 1);
  if (x + width > 1) width = Math.max(minimum, 1 - x);
  if (y + height > 1) height = Math.max(minimum, 1 - y);
  if (width < minimum) {
    x = Math.max(0, 1 - minimum);
    width = minimum;
  }
  if (height < minimum) {
    y = Math.max(0, 1 - minimum);
    height = minimum;
  }
  return { x, y, width, height };
}

export function pdfCropRectsEqual(left, right, epsilon = 0.00001) {
  const a = normalizePdfCropRect(left);
  const b = normalizePdfCropRect(right);
  return ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) <= epsilon);
}

export function pdfCropDisplaySize(baseBox, rotation = 0) {
  const width = Math.max(0, number(baseBox?.width));
  const height = Math.max(0, number(baseBox?.height));
  return normalizePdfCropRotation(rotation) % 180 === 0
    ? { width, height }
    : { width: height, height: width };
}

export function pdfCropRectToMargins(rect, displaySize) {
  const normalized = normalizePdfCropRect(rect);
  const width = Math.max(0, number(displaySize?.width));
  const height = Math.max(0, number(displaySize?.height));
  return {
    top: normalized.y * height,
    right: (1 - normalized.x - normalized.width) * width,
    bottom: (1 - normalized.y - normalized.height) * height,
    left: normalized.x * width
  };
}

export function pdfCropMarginsToRect(margins, displaySize, minCropPoints = PDF_CROP_LIMITS.minCropPoints) {
  const width = Math.max(0.0001, number(displaySize?.width, 1));
  const height = Math.max(0.0001, number(displaySize?.height, 1));
  const minimumWidth = Math.min(width, Math.max(0.0001, number(minCropPoints, PDF_CROP_LIMITS.minCropPoints)));
  const minimumHeight = Math.min(height, Math.max(0.0001, number(minCropPoints, PDF_CROP_LIMITS.minCropPoints)));
  const left = clamp(margins?.left, 0, Math.max(0, width - minimumWidth));
  const top = clamp(margins?.top, 0, Math.max(0, height - minimumHeight));
  const right = clamp(margins?.right, 0, Math.max(0, width - left - minimumWidth));
  const bottom = clamp(margins?.bottom, 0, Math.max(0, height - top - minimumHeight));
  return normalizePdfCropRect({
    x: left / width,
    y: top / height,
    width: (width - left - right) / width,
    height: (height - top - bottom) / height
  }, Math.min(minimumWidth / width, minimumHeight / height));
}

export function displayRectToPdfBox(rect, baseBox, rotation = 0) {
  const normalized = normalizePdfCropRect(rect);
  const base = {
    x: number(baseBox?.x),
    y: number(baseBox?.y),
    width: Math.max(0.0001, number(baseBox?.width, 1)),
    height: Math.max(0.0001, number(baseBox?.height, 1))
  };
  const angle = normalizePdfCropRotation(rotation);
  const display = pdfCropDisplaySize(base, angle);
  const sx = normalized.x * display.width;
  const sy = normalized.y * display.height;
  const sw = normalized.width * display.width;
  const sh = normalized.height * display.height;
  let x;
  let y;
  let width;
  let height;

  if (angle === 90) {
    x = sy;
    y = sx;
    width = sh;
    height = sw;
  } else if (angle === 180) {
    x = base.width - sx - sw;
    y = sy;
    width = sw;
    height = sh;
  } else if (angle === 270) {
    x = base.width - sy - sh;
    y = base.height - sx - sw;
    width = sh;
    height = sw;
  } else {
    x = sx;
    y = base.height - sy - sh;
    width = sw;
    height = sh;
  }

  return {
    x: base.x + Math.max(0, x),
    y: base.y + Math.max(0, y),
    width: Math.min(base.width, Math.max(0.0001, width)),
    height: Math.min(base.height, Math.max(0.0001, height))
  };
}

function pageBaseBox(page) {
  const crop = typeof page.getCropBox === 'function' ? page.getCropBox() : null;
  const media = page.getMediaBox();
  const box = crop && crop.width > 0 && crop.height > 0 ? crop : media;
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function setPageBoxes(page, box) {
  page.setMediaBox(box.x, box.y, box.width, box.height);
  page.setCropBox(box.x, box.y, box.width, box.height);
  page.setBleedBox(box.x, box.y, box.width, box.height);
  page.setTrimBox(box.x, box.y, box.width, box.height);
  page.setArtBox(box.x, box.y, box.width, box.height);
}

function assertActive(shouldCancel) {
  if (shouldCancel?.()) throw new PdfCropCancelledError();
}

function applyCropStateToPage(page, state = {}) {
  if (state.explicit === false) return;
  const rotation = page.getRotation()?.angle || state.rotation || 0;
  setPageBoxes(page, displayRectToPdfBox(state.rect, pageBaseBox(page), rotation));
}

function applyCropPlan(document, crops, shouldCancel, onProgress) {
  const pages = document.getPages();
  assertPdfCropPageCount(pages.length);
  if (!Array.isArray(crops) || crops.length !== pages.length) {
    throw new Error('Crop state does not match the PDF page count');
  }
  pages.forEach((page, index) => {
    assertActive(shouldCancel);
    applyCropStateToPage(page, crops[index]);
    onProgress?.({ completed: index + 1, total: pages.length });
  });
  return pages;
}

export async function exportCroppedPdf({ bytes, crops, shouldCancel, onProgress }) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!input.length) throw new Error('PDF data is empty');
  assertActive(shouldCancel);
  const document = await PDFDocument.load(input.slice());
  applyCropPlan(document, crops, shouldCancel, onProgress);
  assertActive(shouldCancel);
  return new Uint8Array(await document.save({ useObjectStreams: true }));
}

export async function exportCroppedPdfPage({
  bytes,
  crop,
  pageIndex = 0,
  shouldCancel,
  onProgress
}) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!input.length) throw new Error('PDF data is empty');
  assertActive(shouldCancel);
  const source = await PDFDocument.load(input.slice());
  const pages = source.getPages();
  assertPdfCropPageCount(pages.length);
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) {
    throw new Error('Current PDF page is out of range');
  }
  assertActive(shouldCancel);
  applyCropStateToPage(pages[pageIndex], crop);
  onProgress?.({ completed: 1, total: 1, page: pageIndex + 1 });
  flattenPdfFormForPageCopy(source);
  assertActive(shouldCancel);
  const output = await PDFDocument.create();
  const [page] = await copyPdfPages(output, source, [pageIndex]);
  output.addPage(page);
  assertActive(shouldCancel);
  return new Uint8Array(await output.save({ useObjectStreams: true }));
}

export async function splitCroppedPdfPages({ bytes, crops, baseName, shouldCancel, onProgress }) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!input.length) throw new Error('PDF data is empty');
  assertActive(shouldCancel);
  const source = await PDFDocument.load(input.slice());
  const pages = applyCropPlan(source, crops, shouldCancel);
  flattenPdfFormForPageCopy(source);
  const output = [];
  for (let index = 0; index < pages.length; index += 1) {
    assertActive(shouldCancel);
    const document = await PDFDocument.create();
    const [page] = await copyPdfPages(document, source, [index]);
    document.addPage(page);
    output.push({
      fileName: createPdfCropPageFileName(baseName, index + 1, pages.length),
      bytes: new Uint8Array(await document.save({ useObjectStreams: true }))
    });
    onProgress?.({ completed: index + 1, total: pages.length });
  }
  return output;
}
