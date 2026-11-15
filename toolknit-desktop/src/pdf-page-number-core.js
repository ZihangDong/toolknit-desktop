import { copyPdfPages } from './core/pdf-page-copy.js';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import fontkit from './pdf-lib-fontkit.js';
import { flattenPdfFormForPageCopy } from './pdf-document-structure.js';

export const PDF_PAGE_NUMBER_LIMITS = Object.freeze({
  maxFiles: 25,
  maxTotalBytes: 150 * 1024 * 1024,
  maxPages: 200
});

export const PDF_PAGE_NUMBER_DEFAULTS = Object.freeze({
  scope: 'all',
  customRange: '',
  numberingMode: 'continuous',
  start: 1,
  step: 1,
  skipFirst: 0,
  template: '{page}',
  numberFormat: 'decimal',
  position: 'bottom-center',
  margin: 24,
  offsetX: 0,
  offsetY: 0,
  fontSize: 11,
  textColor: '#111111',
  textOpacity: 0.92,
  backgroundStyle: 'none',
  backgroundColor: '#ffffff',
  backgroundOpacity: 0.86,
  padding: 7,
  borderColor: '#111111',
  borderWidth: 0
});

export class PdfPageNumberCancelledError extends Error {
  constructor() {
    super('PDF page-number operation cancelled');
    this.name = 'PdfPageNumberCancelledError';
  }
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function integer(value, min, max, fallback) {
  return Math.round(clamp(value, min, max, fallback));
}

function normalizedRotation(value) {
  const angle = Number(value) || 0;
  return ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
}

function colorFromHex(value, fallback = '#000000') {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(value || '').trim())
    || /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(fallback);
  return rgb(
    parseInt(match[1], 16) / 255,
    parseInt(match[2], 16) / 255,
    parseInt(match[3], 16) / 255
  );
}

function normalizedHex(value, fallback) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value || '').trim());
  return match ? `#${match[1].toLowerCase()}` : fallback;
}

export function assertPdfPageNumberSelection(files, totalBytes, limits = PDF_PAGE_NUMBER_LIMITS) {
  if (!Array.isArray(files) || files.length < 1) throw new Error('At least one PDF file is required');
  if (files.length > limits.maxFiles) throw new Error(`At most ${limits.maxFiles} PDF files are supported`);
  if (files.some(file => !/\.pdf$/i.test(String(file?.name || file?.fileName || '')))) {
    throw new Error('Only PDF files are supported');
  }
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 1) throw new Error('Invalid PDF input size');
  if (totalBytes > limits.maxTotalBytes) {
    throw new Error(`PDF inputs exceed the ${Math.floor(limits.maxTotalBytes / 1024 / 1024)}MB limit`);
  }
}

export function assertPdfPageNumberPageCount(count, limits = PDF_PAGE_NUMBER_LIMITS) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('PDF has no pages');
  if (count > limits.maxPages) throw new Error(`PDF inputs exceed the ${limits.maxPages}-page limit`);
}

export function sanitizePdfPageNumberBaseName(value) {
  return String(value || 'document')
    .split(/[\\/]/)
    .pop()
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96) || 'document';
}

export function createPdfPageNumberFileName(value, extension = 'pdf') {
  const safeExtension = extension === 'zip' ? 'zip' : 'pdf';
  return `${sanitizePdfPageNumberBaseName(value)}_numbered.${safeExtension}`;
}

export function normalizePdfPageNumberSettings(value = {}) {
  const defaults = PDF_PAGE_NUMBER_DEFAULTS;
  const allowed = (candidate, values, fallback) => values.includes(candidate) ? candidate : fallback;
  return {
    scope: allowed(value.scope, ['all', 'odd', 'even', 'custom', 'selected'], defaults.scope),
    customRange: String(value.customRange || '').trim(),
    numberingMode: allowed(value.numberingMode, ['continuous', 'source'], defaults.numberingMode),
    start: integer(value.start, -999999, 999999, defaults.start),
    step: integer(value.step, 1, 9999, defaults.step),
    skipFirst: integer(value.skipFirst, 0, 999999, defaults.skipFirst),
    template: String(value.template || defaults.template).slice(0, 120) || defaults.template,
    numberFormat: allowed(value.numberFormat, ['decimal', 'padded-2', 'padded-3', 'roman-upper', 'roman-lower', 'alpha-upper', 'alpha-lower'], defaults.numberFormat),
    position: allowed(value.position, [
      'top-left', 'top-center', 'top-right',
      'middle-left', 'middle-center', 'middle-right',
      'bottom-left', 'bottom-center', 'bottom-right'
    ], defaults.position),
    margin: clamp(value.margin, 0, 160, defaults.margin),
    offsetX: clamp(value.offsetX, -240, 240, defaults.offsetX),
    offsetY: clamp(value.offsetY, -240, 240, defaults.offsetY),
    fontSize: clamp(value.fontSize, 6, 96, defaults.fontSize),
    textColor: normalizedHex(value.textColor, defaults.textColor),
    textOpacity: clamp(value.textOpacity, 0.05, 1, defaults.textOpacity),
    backgroundStyle: allowed(value.backgroundStyle, ['none', 'circle', 'pill', 'label', 'bar'], defaults.backgroundStyle),
    backgroundColor: normalizedHex(value.backgroundColor, defaults.backgroundColor),
    backgroundOpacity: clamp(value.backgroundOpacity, 0.05, 1, defaults.backgroundOpacity),
    padding: clamp(value.padding, 2, 36, defaults.padding),
    borderColor: normalizedHex(value.borderColor, defaults.borderColor),
    borderWidth: clamp(value.borderWidth, 0, 8, defaults.borderWidth)
  };
}

export function parsePdfPageRange(value, totalPages) {
  const total = integer(totalPages, 1, 1000000, 1);
  const input = String(value || '').trim();
  if (!input) return new Set();
  const pages = new Set();
  for (const rawPart of input.split(/[,，\s]+/).filter(Boolean)) {
    const part = rawPart.trim();
    const single = /^(\d+)$/.exec(part);
    if (single) {
      const page = Number(single[1]);
      if (page < 1 || page > total) throw new Error(`Page ${page} is outside 1-${total}`);
      pages.add(page);
      continue;
    }
    const range = /^(\d+)\s*[-–—]\s*(\d+)$/.exec(part);
    if (!range) throw new Error(`Invalid page range: ${part}`);
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start < 1 || end < start || end > total) throw new Error(`Invalid page range: ${part}`);
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  return pages;
}

function toRoman(value) {
  let number = Math.trunc(value);
  if (number < 1 || number > 3999) return String(value);
  const symbols = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
  ];
  let result = '';
  for (const [amount, symbol] of symbols) {
    while (number >= amount) {
      result += symbol;
      number -= amount;
    }
  }
  return result;
}

function toAlphabet(value) {
  let number = Math.trunc(value);
  if (number < 1) return String(value);
  let result = '';
  while (number > 0) {
    number -= 1;
    result = String.fromCharCode(65 + (number % 26)) + result;
    number = Math.floor(number / 26);
  }
  return result;
}

export function formatPdfPageNumber(value, format = 'decimal') {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return '';
  if (format === 'padded-2') return number < 0 ? `-${String(Math.abs(number)).padStart(2, '0')}` : String(number).padStart(2, '0');
  if (format === 'padded-3') return number < 0 ? `-${String(Math.abs(number)).padStart(3, '0')}` : String(number).padStart(3, '0');
  if (format === 'roman-upper') return toRoman(number);
  if (format === 'roman-lower') return toRoman(number).toLowerCase();
  if (format === 'alpha-upper') return toAlphabet(number);
  if (format === 'alpha-lower') return toAlphabet(number).toLowerCase();
  return String(number);
}

function fillTemplate(template, values) {
  return String(template || '{page}')
    .replaceAll('{page}', values.page)
    .replaceAll('{total}', values.total)
    .replaceAll('{sourcePage}', values.sourcePage);
}

export function buildPdfPageNumberPlan(pages, settings = {}) {
  if (!Array.isArray(pages) || pages.length < 1) return [];
  const normalized = normalizePdfPageNumberSettings(settings);
  const selectedIds = new Set(Array.from(settings.selectedIds || [], String));
  const customPages = normalized.scope === 'custom'
    ? parsePdfPageRange(normalized.customRange, pages.length)
    : new Set();
  const sourceTotals = new Map();
  pages.forEach((page, index) => {
    if (index < normalized.skipFirst) return;
    const sourceId = String(page.sourceId ?? page.sourceIndex ?? 'source');
    sourceTotals.set(sourceId, (sourceTotals.get(sourceId) || 0) + 1);
  });
  const sourceCounters = new Map();
  const continuousTotal = Math.max(0, pages.length - normalized.skipFirst);

  return pages.map((page, index) => {
    const documentPage = index + 1;
    const sourceId = String(page.sourceId ?? page.sourceIndex ?? 'source');
    const afterSkip = index >= normalized.skipFirst;
    let sequenceIndex = index - normalized.skipFirst;
    if (normalized.numberingMode === 'source') {
      sequenceIndex = sourceCounters.get(sourceId) || 0;
      if (afterSkip) sourceCounters.set(sourceId, sequenceIndex + 1);
    }
    const numberValue = normalized.start + Math.max(0, sequenceIndex) * normalized.step;
    const totalValue = normalized.numberingMode === 'source'
      ? (sourceTotals.get(sourceId) || 0)
      : continuousTotal;
    let inScope = normalized.scope === 'all';
    if (normalized.scope === 'odd') inScope = documentPage % 2 === 1;
    if (normalized.scope === 'even') inScope = documentPage % 2 === 0;
    if (normalized.scope === 'custom') inScope = customPages.has(documentPage);
    if (normalized.scope === 'selected') inScope = selectedIds.has(String(page.id));
    const formatted = formatPdfPageNumber(numberValue, normalized.numberFormat);
    const text = fillTemplate(normalized.template, {
      page: formatted,
      total: String(totalValue),
      sourcePage: String(Number(page.sourcePageIndex ?? page.pageIndex ?? 0) + 1)
    });
    return {
      pageId: String(page.id ?? index),
      index,
      documentPage,
      sourceId,
      applied: afterSkip && inScope && Boolean(text.trim()),
      numberValue,
      totalValue,
      text
    };
  });
}

export function calculatePdfPageNumberLayout({ pageWidth, pageHeight, textWidth, textHeight, settings = {} }) {
  const normalized = normalizePdfPageNumberSettings(settings);
  const width = Math.max(1, Number(pageWidth) || 1);
  const height = Math.max(1, Number(pageHeight) || 1);
  const measuredWidth = Math.max(1, Number(textWidth) || normalized.fontSize * 0.58);
  const measuredHeight = Math.max(1, Number(textHeight) || normalized.fontSize);
  const [vertical, horizontal] = normalized.position.split('-');
  const paddingX = normalized.padding;
  const paddingY = Math.max(2, normalized.padding * 0.62);
  let boxWidth = measuredWidth;
  let boxHeight = measuredHeight;

  if (normalized.backgroundStyle === 'circle') {
    boxWidth = boxHeight = Math.max(measuredWidth, measuredHeight) + normalized.padding * 2;
  } else if (normalized.backgroundStyle === 'pill') {
    boxHeight = measuredHeight + paddingY * 2;
    boxWidth = Math.max(boxHeight, measuredWidth + paddingX * 2);
  } else if (normalized.backgroundStyle === 'label') {
    boxWidth = measuredWidth + paddingX * 2;
    boxHeight = measuredHeight + paddingY * 2;
  } else if (normalized.backgroundStyle === 'bar') {
    boxWidth = width;
    boxHeight = Math.max(24, measuredHeight + paddingY * 2);
  }

  const margin = Math.min(normalized.margin, Math.max(0, Math.min(width, height) / 3));
  let boxX = horizontal === 'left' ? margin : horizontal === 'right' ? width - margin - boxWidth : (width - boxWidth) / 2;
  let boxY = vertical === 'bottom' ? margin : vertical === 'top' ? height - margin - boxHeight : (height - boxHeight) / 2;
  boxX += normalized.offsetX;
  boxY += normalized.offsetY;
  if (normalized.backgroundStyle === 'bar') boxX = 0;

  const textX = normalized.backgroundStyle === 'bar'
    ? (horizontal === 'left' ? margin : horizontal === 'right' ? width - margin - measuredWidth : (width - measuredWidth) / 2) + normalized.offsetX
    : boxX + (boxWidth - measuredWidth) / 2;
  const textY = boxY + (boxHeight - measuredHeight) / 2;

  return {
    pageWidth: width,
    pageHeight: height,
    text: { x: textX, y: textY, width: measuredWidth, height: measuredHeight },
    background: normalized.backgroundStyle === 'none'
      ? null
      : { style: normalized.backgroundStyle, x: boxX, y: boxY, width: boxWidth, height: boxHeight }
  };
}

export function getPdfPageDisplayGeometry(page) {
  const crop = typeof page.getCropBox === 'function' ? page.getCropBox() : page.getMediaBox();
  const rotation = normalizedRotation(page.getRotation?.().angle || 0);
  return {
    box: crop,
    rotation,
    width: rotation % 180 === 0 ? crop.width : crop.height,
    height: rotation % 180 === 0 ? crop.height : crop.width
  };
}

export function visualPdfPointToPagePoint(box, rotation, u, v) {
  const normalized = normalizedRotation(rotation);
  if (normalized === 90) return { x: box.x + box.width - v, y: box.y + u };
  if (normalized === 180) return { x: box.x + box.width - u, y: box.y + box.height - v };
  if (normalized === 270) return { x: box.x + v, y: box.y + box.height - u };
  return { x: box.x + u, y: box.y + v };
}

function drawVisualRectangle(page, geometry, rect, options) {
  const point = visualPdfPointToPagePoint(geometry.box, geometry.rotation, rect.x, rect.y);
  page.drawRectangle({
    x: point.x,
    y: point.y,
    width: rect.width,
    height: rect.height,
    rotate: degrees(geometry.rotation),
    ...options
  });
}

function drawVisualEllipse(page, geometry, ellipse, options) {
  const point = visualPdfPointToPagePoint(geometry.box, geometry.rotation, ellipse.x, ellipse.y);
  const swap = geometry.rotation % 180 !== 0;
  page.drawEllipse({
    x: point.x,
    y: point.y,
    xScale: swap ? ellipse.yScale : ellipse.xScale,
    yScale: swap ? ellipse.xScale : ellipse.yScale,
    ...options
  });
}

function drawVisualPill(page, geometry, rect, options) {
  const radius = Math.min(rect.height / 2, rect.width / 2);
  const middleWidth = Math.max(0, rect.width - radius * 2);
  if (middleWidth > 0) {
    drawVisualRectangle(page, geometry, {
      x: rect.x + radius,
      y: rect.y,
      width: middleWidth,
      height: rect.height
    }, options);
  }
  drawVisualEllipse(page, geometry, {
    x: rect.x + radius,
    y: rect.y + rect.height / 2,
    xScale: radius,
    yScale: radius
  }, options);
  drawVisualEllipse(page, geometry, {
    x: rect.x + rect.width - radius,
    y: rect.y + rect.height / 2,
    xScale: radius,
    yScale: radius
  }, options);
}

function drawBackground(page, geometry, background, settings) {
  if (!background) return;
  const fill = colorFromHex(settings.backgroundColor, '#ffffff');
  const border = colorFromHex(settings.borderColor, '#111111');
  const fillOptions = { color: fill, opacity: settings.backgroundOpacity };
  const borderWidth = Math.min(settings.borderWidth, background.height / 4, background.width / 4);

  if (background.style === 'circle') {
    const ellipse = {
      x: background.x + background.width / 2,
      y: background.y + background.height / 2,
      xScale: background.width / 2,
      yScale: background.height / 2
    };
    drawVisualEllipse(page, geometry, ellipse, {
      ...fillOptions,
      borderColor: borderWidth > 0 ? border : undefined,
      borderWidth: borderWidth || undefined,
      borderOpacity: settings.backgroundOpacity
    });
    return;
  }
  if (background.style === 'pill') {
    if (borderWidth > 0) {
      drawVisualPill(page, geometry, background, { color: border, opacity: settings.backgroundOpacity });
      const inner = {
        x: background.x + borderWidth,
        y: background.y + borderWidth,
        width: Math.max(1, background.width - borderWidth * 2),
        height: Math.max(1, background.height - borderWidth * 2)
      };
      drawVisualPill(page, geometry, inner, fillOptions);
    } else {
      drawVisualPill(page, geometry, background, fillOptions);
    }
    return;
  }
  drawVisualRectangle(page, geometry, background, {
    ...fillOptions,
    borderColor: borderWidth > 0 ? border : undefined,
    borderWidth: borderWidth || undefined,
    borderOpacity: settings.backgroundOpacity
  });
}

export function drawPdfPageNumber(page, font, text, settings = {}) {
  const normalized = normalizePdfPageNumberSettings(settings);
  const geometry = getPdfPageDisplayGeometry(page);
  const textWidth = font.widthOfTextAtSize(text, normalized.fontSize);
  const textHeight = font.heightAtSize(normalized.fontSize, { descender: false });
  const layout = calculatePdfPageNumberLayout({
    pageWidth: geometry.width,
    pageHeight: geometry.height,
    textWidth,
    textHeight,
    settings: normalized
  });
  drawBackground(page, geometry, layout.background, normalized);
  const origin = visualPdfPointToPagePoint(
    geometry.box,
    geometry.rotation,
    layout.text.x,
    layout.text.y
  );
  page.drawText(text, {
    x: origin.x,
    y: origin.y,
    size: normalized.fontSize,
    font,
    color: colorFromHex(normalized.textColor, '#111111'),
    opacity: normalized.textOpacity,
    rotate: degrees(geometry.rotation)
  });
  return { geometry, layout };
}

function assertNotCancelled(shouldCancel) {
  if (typeof shouldCancel === 'function' && shouldCancel()) throw new PdfPageNumberCancelledError();
}

function asUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new Error('Invalid PDF source bytes');
}

export async function exportPdfWithPageNumbers({
  sources,
  pages,
  settings = {},
  fontBytes,
  onProgress,
  shouldCancel
}) {
  if (!Array.isArray(sources) || sources.length < 1) throw new Error('No PDF source is available');
  assertPdfPageNumberPageCount(pages?.length || 0);
  const sourceMap = new Map();
  for (const source of sources) {
    assertNotCancelled(shouldCancel);
    const id = String(source.id ?? source.sourceId ?? sourceMap.size);
    const document = await PDFDocument.load(asUint8Array(source.bytes ?? source.fileData).slice());
    flattenPdfFormForPageCopy(document);
    sourceMap.set(id, document);
  }

  const output = await PDFDocument.create();
  let font;
  if (fontBytes) {
    output.registerFontkit(fontkit);
    font = await output.embedFont(asUint8Array(fontBytes), { subset: true });
  } else {
    font = await output.embedFont(StandardFonts.Helvetica);
  }
  const normalized = normalizePdfPageNumberSettings(settings);
  const plan = buildPdfPageNumberPlan(pages, settings);
  for (let index = 0; index < pages.length; index += 1) {
    assertNotCancelled(shouldCancel);
    const pageModel = pages[index];
    const sourceId = String(pageModel.sourceId ?? pageModel.sourceIndex ?? '');
    const sourceDocument = sourceMap.get(sourceId);
    if (!sourceDocument) throw new Error(`Missing PDF source: ${sourceId}`);
    const sourcePageIndex = Number(pageModel.sourcePageIndex ?? pageModel.pageIndex);
    if (!Number.isSafeInteger(sourcePageIndex) || sourcePageIndex < 0 || sourcePageIndex >= sourceDocument.getPageCount()) {
      throw new Error(`Invalid PDF page reference at output page ${index + 1}`);
    }
    const [copiedPage] = await copyPdfPages(output, sourceDocument, [sourcePageIndex]);
    output.addPage(copiedPage);
    if (plan[index]?.applied) drawPdfPageNumber(copiedPage, font, plan[index].text, normalized);
    onProgress?.({ phase: 'pages', completed: index + 1, total: pages.length, percent: Math.round(((index + 1) / pages.length) * 92) });
    if ((index + 1) % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  assertNotCancelled(shouldCancel);
  onProgress?.({ phase: 'saving', completed: pages.length, total: pages.length, percent: 96 });
  const bytes = await output.save({ addDefaultPage: false, useObjectStreams: true });
  assertNotCancelled(shouldCancel);
  onProgress?.({ phase: 'done', completed: pages.length, total: pages.length, percent: 100 });
  return bytes;
}

export async function splitNumberedPdfPages({ bytes, baseName = 'document', onProgress, shouldCancel }) {
  const source = await PDFDocument.load(asUint8Array(bytes).slice());
  assertPdfPageNumberPageCount(source.getPageCount());
  const width = String(source.getPageCount()).length;
  const outputs = [];
  for (let index = 0; index < source.getPageCount(); index += 1) {
    assertNotCancelled(shouldCancel);
    const output = await PDFDocument.create();
    const [page] = await copyPdfPages(output, source, [index]);
    output.addPage(page);
    outputs.push({
      fileName: `${sanitizePdfPageNumberBaseName(baseName)}_page-${String(index + 1).padStart(width, '0')}.pdf`,
      bytes: await output.save({ addDefaultPage: false, useObjectStreams: true })
    });
    onProgress?.({ completed: index + 1, total: source.getPageCount() });
    if ((index + 1) % 6 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return outputs;
}
