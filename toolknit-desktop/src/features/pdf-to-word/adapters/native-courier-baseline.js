// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.

const ASCENT = 1705 / 2048;
const DESCENT = 615 / 2048;
const ADVANCE = 1229 / 2048;
const sourceAlias = name => /^(?:[A-Z]{6}\+)?Courier(?: New|New|NewPSMT)$/i.test(name || '');

/** Evidence for the exact-line baseline of an ordinary native Courier frame.
 * Source coordinates, font programs and permissions are never changed here.
 * OCR, tables, substitutes and existing raised/lowered runs keep their owner.
 */
export function knownNativeCourierFrame({ line, items, context, nativeWordFrame,
  includeImages, onlyText, nativeTableRow, fit, runOptions, textMetrics, baselinePosition }) {
  if (!nativeWordFrame || includeImages || !onlyText || nativeTableRow || fit
    || line?.nativeMappingRow || line?.mixedNativeDecoration
    || !Array.isArray(items) || !items.length || items.length > 1000
    || typeof runOptions !== 'function' || typeof context?.measureText !== 'function'
    || typeof textMetrics !== 'function' || typeof baselinePosition !== 'function'
    || !Number.isFinite(line?.baseline)) return false;

  const beforeFont = context.font;
  const beforeKerning = context.fontKerning;
  try {
    for (const item of items) {
      const metrics = item.fontMetrics;
      if (item.type !== 'text' || !item.preciseInk || item.ocr || item.raster
        || item.nativeCalibrated || item.fontAssetId || item.alphabet || item.positionedWord
        || item.bold || item.italic || item.sourceFont || item.sourceSize
        || item.words?.length || item.role === 'math'
        || !sourceAlias(item.font) || typeof item.text !== 'string' || !item.text.trim()
        || !/^[\x20-\x7e]+$/.test(item.text)
        || !Number.isFinite(item.baseline) || Math.abs(item.baseline - line.baseline) > .02
        || !Number.isFinite(item.size) || item.size < 6 || item.size > 24
        || !metrics || !['ascent', 'descent', 'winAscent', 'winDescent']
          .every(key => Number.isFinite(metrics[key]))
        || Math.abs(metrics.ascent - ASCENT) > 1e-6
        || Math.abs(metrics.descent - DESCENT) > 1e-6
        || Math.abs(metrics.winAscent - ASCENT) > 1e-6
        || Math.abs(metrics.winDescent - DESCENT) > 1e-6
        || runOptions(item).font.ascii !== 'Courier New') return false;
      if (baselinePosition(item, line.baseline, textMetrics(item, context)) !== 0) return false;
    }

    // A mapped family name alone does not establish the installed face.
    // Check its actual large-em line metrics and independent fixed advances.
    context.font = '1000px "Courier New"';
    context.fontKerning = 'none';
    const characters = new Set(['i', 'W', '0']);
    for (const item of items) for (const character of item.text) characters.add(character);
    for (const text of characters) {
      const metrics = context.measureText(text);
      if (!Number.isFinite(metrics.width + metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent)
        || Math.abs(metrics.width / 1000 - ADVANCE) > .001
        || Math.abs(metrics.fontBoundingBoxAscent / 1000 - ASCENT) > .001
        || Math.abs(metrics.fontBoundingBoxDescent / 1000 - DESCENT) > .001) return false;
      // A positive advance may belong to an absent/empty glyph. Space needs
      // its advance only; every other source character must have actual ink.
      if (text !== ' ' && (![metrics.actualBoundingBoxLeft, metrics.actualBoundingBoxRight,
        metrics.actualBoundingBoxAscent, metrics.actualBoundingBoxDescent].every(Number.isFinite)
        || metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight <= 0
        || metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent <= 0)) return false;
    }
    return true;
  } finally {
    context.font = beforeFont;
    context.fontKerning = beforeKerning;
  }
}
