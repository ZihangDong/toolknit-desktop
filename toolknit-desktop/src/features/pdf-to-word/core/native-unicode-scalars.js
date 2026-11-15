// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { validRect, overlaps, spatialIndex } from './geometry.js';

export const NATIVE_UNICODE_SCALAR_FONT = 'Cambria Math';
const UNITS_PER_EM = 2048;
const MAX_ITEMS = 20000, MAX_NEIGHBOURS = 65536;
// Bounded cmap glyph IDs and hmtx advances from the same inspected Math face.
// Entries are numeric coverage/measurement facts, not distributed font data.
const profile = [
  [0x1d438, 1831, 1279],
  [0x1d441, 1840, 1500],
  [0x1d443, 1842, 1270],
  [0x1d44b, 1850, 1321],
  [0x1d44e, 1853, 1141],
  [0x1d456, 1861, 649],
  [0x1d458, 1863, 1130],
  [0x1d45a, 1865, 1717],
  [0x1d45b, 1866, 1175],
  [0x1d465, 1876, 1090],
  [0x1d6f1, 1998, 1466],
  [0x1d6f4, 2001, 1243],
  [0x1d705, 2018, 1108],
  [0x1d707, 2020, 1123],
  [0x1d708, 2021, 1042],
  [0x1d70e, 2026, 1198],
];
const metrics = new Map(profile.map(([codePoint, glyphId, advance]) => [codePoint,
  Object.freeze({ codePoint, glyphId, advanceAt1000: advance / UNITS_PER_EM * 1000 })]));

export function nativeUnicodeScalarMetric(text) {
  if (typeof text !== 'string' || text.length > 2 || [...text].length !== 1 || !/^\p{L}$/u.test(text)) return null;
  return metrics.get(text.codePointAt(0)) || null;
}
const sameRect = (a, b) => validRect(a) && validRect(b)
  && ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < .001);

export function nativeUnicodeScalarGlyph(glyph) {
  return Boolean(glyph && typeof glyph.id === 'string' && glyph.id.length > 0 && glyph.id.length <= 256 && nativeUnicodeScalarMetric(glyph.text)
    && /^(?:[A-Z]{6}\+)?XITSMath-Regular$/i.test(glyph.font || '')
    && glyph.preciseInk === true && glyph.raster === false && !glyph.ocr && !glyph.alphabet
    && !glyph.mathStyleUncertain && !glyph.radicalPart && !glyph.delimiterPart && !glyph.bold && !glyph.italic
    && Number.isFinite(glyph.size) && glyph.size >= 4 && glyph.size <= 40 && Number.isFinite(glyph.baseline)
    && validRect(glyph.rect) && /^[0-9a-f]{6}$/i.test(glyph.color || ''));
}

export function nativeUnicodeScalarItem(item, source) {
  return Boolean(nativeUnicodeScalarGlyph(item) && !item.nativeCalibrated && !item.fontAssetId
    && Number.isFinite(item.baselineX) && Number.isFinite(item.advanceWidth) && item.advanceWidth > 0
    && item.sourceIds?.length === 1 && item.sourceIds[0] === item.id
    && item.glyphPositions?.length === 1 && item.glyphPositions[0].text === item.text
    && sameRect(item.glyphPositions[0].rect, item.rect)
    && source?.id === item.id && source.text === item.text && source.disposition === 'editable'
    && !source.ocrUnverified && !source.encodingCorrections?.length && sameRect(source.rect, item.rect));
}

export function nativeUnicodeScalarCandidates(text, graphics, sources, groups) {
  if (![text, graphics, sources, groups].every(Array.isArray)
    || [text, graphics, sources, groups].some(values => values.length > MAX_ITEMS)
    || sources.some(source => !source || typeof source.id !== 'string')
    || graphics.some(graphic => !graphic || !validRect(graphic.rect))) return [];
  let members = 0;
  for (const group of groups) if (!Array.isArray(group) || (members += group.length) > MAX_ITEMS * 2) return [];
  const byId = new Map();
  for (const source of sources) byId.set(source.id, byId.has(source.id) ? null : source);
  const candidates = text.filter(item => nativeUnicodeScalarItem(item, byId.get(item.id)));
  if (!candidates.length) return [];
  const owned = new Set(groups.flat()), neighbours = spatialIndex([...text, ...graphics]);
  const accepted = []; let work = 0;
  for (const scalar of candidates) {
    if (owned.has(scalar)) continue;
    const nearby = neighbours(scalar.rect); work += nearby.length;
    if (work > MAX_NEIGHBOURS) return [];
    if (!nearby.some(peer => peer !== scalar && overlaps(scalar.rect, peer.rect, .1))) accepted.push(scalar);
  }
  return accepted;
}

export function sourceNativeUnicodeScalar(region) {
  const proof = region?.sourceNativeUnicodeScalar;
  if (!nativeUnicodeScalarItem(proof?.item, proof?.source)) return false;
  const glyph = region?.mathGlyphs?.length === 1 && region.mathGlyphs[0];
  return Boolean(region?.type === 'image' && region.role === 'math' && nativeUnicodeScalarGlyph(glyph)
    && region.sourceIds?.length === 1 && region.sourceIds[0] === glyph.id
    && !region.ocrMath && region.rasterMathEvidence === undefined && !region.mathStrokes?.length
    && !region.drawingIds?.length && !region.reasons?.length && !region.backgroundPaintIndexes?.length
    && sameRect(region.rect, glyph.rect) && sameRect(proof.item.rect, glyph.rect)
    && ['id', 'text', 'font', 'size', 'baseline', 'color', 'preciseInk', 'raster', 'bold', 'italic']
      .every(key => glyph[key] === proof.item[key]));
}

export const nativeUnicodeScalarRegion = sourceNativeUnicodeScalar;

/** Same bounded cmap/hmtx record is shared by writer coverage and layout. */
export function nativeUnicodeScalarMeasurement({ font, text, metrics }) {
  const metric = nativeUnicodeScalarMetric(text);
  const keys = ['width', 'actualBoundingBoxLeft', 'actualBoundingBoxRight', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent'];
  return Boolean(metric && font === NATIVE_UNICODE_SCALAR_FONT && metrics
    && keys.every(key => Number.isFinite(metrics[key]) && Math.abs(metrics[key]) <= 4096)
    && Math.abs(metrics.width - metric.advanceAt1000) < .1
    && metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight > 0
    && metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent > 0);
}

export function nativeUnicodeScalarLayoutMeasurement(text, format, measured) {
  const metric = nativeUnicodeScalarMetric(text), unit = format.size / 1000 * format.scale / 100;
  return Boolean(metric && format.font === NATIVE_UNICODE_SCALAR_FONT && measured
    && ['width', 'height', 'depth'].every(key => Number.isFinite(measured[key]))
    && measured.height + measured.depth > 0
    && Math.abs(measured.width - metric.advanceAt1000 * unit - format.spacing) < Math.max(1e-9, .1 * unit));
}
