// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { bottom, contains, validRect } from '../core/geometry.js';
import { wordFont, outputWordFont, wordLineMetrics } from './docx-fonts.js';
import { isSourceFontName } from '../core/source-font.js';
import { documentFontAssetId } from '../core/document-font.js';
import { nativeTableRowCandidate } from '../core/native-table-row.js';
import { nativeMappingRowCandidate } from '../core/native-mapping-tables.js';
import { isCenteredNativeWord } from '../core/ocr-frame-layout.js';
import { nativePairRuns } from '../core/native-pair-spacing.js';
import { nativePairPolicyRuns, nativePairEditStyle } from '../core/native-pair-policy.js';
import { knownNativeCourierFrame } from './native-courier-baseline.js';

export function runOptions(item) {
  let font = wordFont(item.font, item.fontFamily);
  if (font === 'Times New Roman' && /[\p{Script=Han}\u2460-\u24ff\u3000-\u303f\uff00-\uffef]/u.test(item.text || '')) font = 'SimSun';
  font = outputWordFont(font);
  const size = Math.max(2, Math.min(800, Math.round(item.size * 2)));
  // This writer owns a plain default style; absent emphasis means off. Avoid
  // redundant off-tags that presence-only preview parsers may enable instead.
  return { font: { ascii: font, hAnsi: font, eastAsia: font, cs: font }, size,
    scale: Number.isFinite(item.glyphScale) ? Math.max(25,Math.min(400,Math.round(item.glyphScale))) : undefined,
    bold: item.bold || /FZDBS/i.test(item.font || '') || undefined, italics: item.italic || undefined,
    color: /^[0-9a-f]{6}$/i.test(item.color) ? item.color : '000000',
    characterSpacing: Math.round((item.size - size / 2) * 20), snapToGrid: false };
}

export function textMetrics(item, context) {
  const options = runOptions(item);
  const measurementFont = wordFont(options.font.ascii);
  // Measuring tiny glyphs quantizes their ink boxes on some canvas backends.
  // Large-em metrics describe the outline that document renderers actually use.
  context.font = `${options.italics ? 'italic ' : ''}${options.bold ? 'bold ' : ''}1000px "${measurementFont.replaceAll('"', '')}"`;
  context.fontKerning = 'none';
  const result = context.measureText(item.text);
  const scale = options.size / 2 / 1000, horizontal = (options.scale || 100) / 100;
  const family = value => String(value).replace(/^[A-Z]{6}\+/, '').replace(/BoldItalic|Regular|Bold|Italic|Oblique|PSMT|MT|PS/gi, '').replace(/[^a-z]/gi, '').toLowerCase();
  const source = item.fontMetrics;
  const winMetrics = source && ['calibri', 'cambria', 'arial', 'timesnewroman', 'couriernew'].includes(family(measurementFont))
    && family(item.font) === family(measurementFont)
    && Math.abs(source.ascent - result.fontBoundingBoxAscent / 1000) < .02
    && Math.abs(source.descent - result.fontBoundingBoxDescent / 1000) < .02;
  const substituteMetrics = wordLineMetrics(measurementFont, result.fontBoundingBoxAscent / 1000, result.fontBoundingBoxDescent / 1000);
  // Word uses OS/2 Windows line metrics for these matching font faces; Canvas
  // can expose hhea metrics instead. Never apply a source face to a substitute.
  return { width: result.width * scale * horizontal, left: result.actualBoundingBoxLeft * scale * horizontal,
    ascent: result.actualBoundingBoxAscent * scale,
    inkDescent: result.actualBoundingBoxDescent * scale,
    fontAscent: winMetrics ? source.winAscent * options.size / 2 : substituteMetrics ? substituteMetrics.ascent * options.size / 2 : result.fontBoundingBoxAscent * scale,
    fontDescent: winMetrics ? source.winDescent * options.size / 2 : substituteMetrics ? substituteMetrics.descent * options.size / 2 : result.fontBoundingBoxDescent * scale };
}
export const originX = (item, context) => item.type === 'image' ? item.rect.x : item.preciseInk && context
  ? item.rect.x + textMetrics(item, context).left : item.baselineX ?? item.rect.x;

export function baselinePosition(item, baseline, metrics) {
  // Nimbus replacements preserve the text baseline. Their glyph outlines differ
  // from the Windows faces, so aligning each word's ink box distorts a whole line.
  const compatible = /^(?:[A-Z]{6}\+)?Nimbus(?:RomNo9L|Roman|SanL|Sans|MonL|Mono)/i.test(item.font || '')
    && runOptions(item).font.ascii === wordFont(item.font);
  return Math.round((compatible && Number.isFinite(item.baseline)
    ? baseline - item.baseline : baseline - item.rect.y - metrics.ascent) * 2);
}

export function measureLineBox(line, context, includeImages = false, fit = null, nativeWordFrame = false, nativeTableRow = false) {
  // Native ink calibration can leave the original nominal bounds on a parent
  // run while its word children carry the actual size, ink and baseline. The
  // writer emits those children; measuring the padded parent instead moves
  // the entire frame even though none of its visible glyphs has moved.
  const calibratedWords = nativeWordFrame && line.items.some(item => item.nativeCalibrated && item.words?.length);
  const items = (calibratedWords ? positionedTextItems(line) : line.items).filter(item => item.type !== 'image');
  const onlyText = line.items.every(item => item.type !== 'image');
  const size = Math.max(1, ...items.map(item => item.size));
  if (!context || !items.length && !includeImages) return { height: size * 1.2, baselineOffset: size };
  let ascent = 0, descent = 0;
  for (const [index, item] of items.entries()) {
    const metrics = textMetrics(item, context);
    const position = item.preciseInk ? baselinePosition(item, line.baseline, metrics) / 2 : 0;
    ascent = Math.max(ascent, metrics.fontAscent + position);
    descent = Math.max(descent, metrics.fontDescent - position);
    if (!index) { ascent = Math.max(ascent, metrics.fontAscent); descent = Math.max(descent, metrics.fontDescent); }
  }
  if (includeImages) for (const item of line.items.filter(item => item.type === 'image')) {
    const position = Math.round((line.baseline - bottom(item.rect)) * 2) / 2;
    ascent = Math.max(ascent, item.rect.height + position); descent = Math.max(descent, -position);
  }
  let height = Math.max(size * 1.2, ascent + descent);
  const exactTableRow = Boolean(nativeTableRow && fit && !nativeWordFrame && onlyText && items.length
    && Number.isFinite(fit.top + fit.bottom) && fit.bottom > fit.top
    && items.every(nativeTableRowCandidate));
  // A proven native table may use leading smaller than the nominal font box.
  // Keep its baseline and visible glyph bounds; never shrink the font itself.
  if (fit && !includeImages && onlyText
    && items.every(item => item.preciseInk && !item.ocr && !item.raster)
    && Number.isFinite(fit.top + fit.bottom) && fit.bottom > fit.top) {
    const maximum = exactTableRow ? Math.min(height, fit.bottom - fit.top,
      (line.baseline - fit.top) / .8, (fit.bottom - line.baseline) / .2) : Math.min(height, fit.bottom - fit.top,
      2 * (line.baseline - fit.top) - ascent + descent,
      2 * (fit.bottom - line.baseline) + ascent - descent);
    const inkTop = Math.min(...items.map(item => item.rect.y));
    const inkBottom = Math.max(...items.map(item => bottom(item.rect)));
    const compact = Math.floor(maximum * 20) / 20;
    if (inkTop >= fit.top - .2 && inkBottom <= fit.bottom + .2
      && compact >= inkBottom - inkTop) height = compact;
  }
  // With exact line spacing, Office readers place calibrated OCR text at 80%
  // of the physical line height. Centering Canvas hhea metrics instead shifts
  // Calibri down by about 0.11em. Both WPS and LibreOffice were independently
  // measured; retain source baselines/positions and the same full line height.
  // The same rule applies to ordinary math text explicitly fitted to native
  // ink. Cambria Math's hhea box differs substantially from its exact-line
  // baseline in Office; its source operator baseline is not a font-box center.
  // Pixel-calibrated native word children also carry their own visible bounds:
  // after expanding them, use this baseline rather than the nominal parent box.
  // Uncalibrated native runs and image-bearing lines retain their contract.
  const exactCalibrated = !includeImages && onlyText
    && items.length > 0 && items.every(item => item.preciseInk && (item.ocr
      || calibratedWords && item.nativeCalibrated
      || nativeWordFrame && line.mixedNativeDecoration === true && item.nativeCalibrated
      || nativeWordFrame && isCenteredNativeWord(item)
      // Editing expands calibrated word children into ordinary source runs.
      // Their XITS-to-Cambria ink fit keeps the same exact-line baseline even
      // when the parent words array no longer exists.
      || nativeWordFrame && item.nativeCalibrated && !item.raster && !item.alphabet
        && Number.isFinite(item.sourceSize) && item.sourceSize > 0
        && /^(?:[A-Z]{6}\+)?XITSMath-Regular$/i.test(item.sourceFont || '')
        && runOptions(item).font.ascii === 'Cambria Math'
      || item.fontAssetId && documentFontAssetId(item.font) === item.fontAssetId
      || isSourceFontName(item.sourceFont) && Number.isFinite(item.sourceSize) && item.sourceSize > 0
      || !item.raster && !item.alphabet && Number.isFinite(item.sourceSize) && item.sourceSize > 0
        && /^(?:[A-Z]{6}\+)?CM(?:MI(?:B)?|R|SY)\d{1,2}$/i.test(item.sourceFont || '')
        && ['Cambria', 'Cambria Math'].includes(runOptions(item).font.ascii)));
  const exactMapping = nativeWordFrame && line.nativeMappingRow === true && onlyText && items.length > 0 && items.every(nativeMappingRowCandidate);
  const exactCourier = knownNativeCourierFrame({ line, items, context, nativeWordFrame, includeImages, onlyText, nativeTableRow, fit, runOptions, textMetrics, baselinePosition });
  return { height, baselineOffset: (exactCalibrated || exactTableRow || exactMapping || exactCourier) ? Math.round(height * 20) / 20 * .8 : (height + ascent - descent) / 2 };
}

export function positionedTextItems(line) {
  return line.items.flatMap(item => {
    const only = item.words?.length === 1 && item.words[0];
    const singleton = only && item.preciseInk && (item.raster === false && !item.ocr
      || item.ocr && only.fontAssetId && documentFontAssetId(only.font) === only.fontAssetId)
      && typeof item.text === 'string' && typeof only.text === 'string' && only.text && item.text.trim() === only.text
      && validRect(item.rect) && validRect(only.rect) && contains(item.rect, only.rect, .3)
      && Number.isFinite(only.baselineX + only.advanceWidth) && only.advanceWidth > 0;
    return item.words?.length > 1 || singleton
      ? item.words.map(word => ({ ...item, ...word, words: undefined, positionedWord: true })) : [item];
  });
}
const itemsOrigin = (items, context) => items.length ? Math.min(...items.map(item => originX(item, context))) : 0;

/** The frame anchors the runs actually emitted. A parent may include leading
 * spaces which its measured word children already express as physical gaps. */
export function positionedLineOrigin(line, context) {
  return itemsOrigin(positionedTextItems(line), context);
}

/** Shared positioned run plan for Canvas editing and DOCX serialization. */
export function positionedTextRuns(line, context) {
  const items = positionedTextItems(line);
  const result = []; let cursor = itemsOrigin(items, context);
  for (let index = 0; index < items.length; index++) {
    const item = items[index], start = originX(item, context), gap = start - cursor;
    if (gap > .1 || item.spaceBefore) {
      const spacing = Math.round((Math.max(0, gap) - .278) * 20);
      result.push({ kind: 'space', spacing }); cursor += .278 + spacing / 20;
    }
    if (item.type === 'image') { result.push({ kind: 'image', item, x: cursor }); cursor += item.rect.width; continue; }
    const metrics = textMetrics(item, context), next = items[index + 1], count = Math.max(1, [...item.text].length);
    const pairRuns = (!next || originX(next, context) - start - item.advanceWidth > .1)
      && (nativePairPolicyRuns(item, context, runOptions(item))
        || nativePairEditStyle(item) && nativePairRuns(item, context, runOptions(item)));
    if (pairRuns) {
      // All fragments share the original word baseline and the existing frame.
      // An inner short glyph must not recompute baseline from the word's top.
      const position = baselinePosition(item, line.baseline, metrics);
      for (const part of pairRuns) {
        const child = { ...item, text: part.text }, measured = textMetrics(child, context);
        result.push({ kind: 'text', item: child, options: { ...runOptions(item), kern: part.kern }, metrics: measured,
          spacing: part.spacing, position, x: cursor, baseline: line.baseline - position / 2 });
        cursor += measured.width + part.spacing / 20 * part.text.length;
      }
      continue;
    }
    // OCR and calibrated native glyphs store visible ink width as the advance. An opening full-width
    // bracket has a wide blank left bearing: shrinking its final advance to ink
    // width makes Office's auto frame clip the whole glyph. No next origin
    // depends on a terminal glyph, so retain its font advance there. Internal
    // spacing and multi-character shaping keep their existing source plan.
    const natural = !next && count === 1 && (item.ocr || item.nativeCalibrated) && item.preciseInk
      ? Math.max(item.advanceWidth || 0, metrics.width) : item.advanceWidth || metrics.width;
    const nextX = next ? originX(next, context) : Infinity, extra = nextX - start - natural;
    const adjacent = count === 1 && next && next.type !== 'image' && !next.spaceBefore
      && !/\s$/u.test(item.text) && !/^\s/u.test(next.text || '') && extra >= 0 && extra <= Math.min(item.size, next.size) * .22;
    const advance = adjacent ? nextX - start : Math.min(natural, nextX - start);
    const spacing = Math.round((advance - metrics.width) / count * 20), position = baselinePosition(item, line.baseline, metrics);
    result.push({ kind: 'text', item, options: runOptions(item), metrics, spacing, position, x: cursor, baseline: line.baseline - position / 2 });
    cursor += metrics.width + spacing / 20 * count;
  }
  return result;
}
