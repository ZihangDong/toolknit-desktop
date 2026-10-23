// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
/** Separate baseline scale from synthetic slant; rotation/mirroring stay guarded. */
export function horizontalTextGeometry(matrix, size) {
  if (!Array.isArray(matrix) || matrix.length !== 6 || !matrix.every(Number.isFinite)
    || !Number.isFinite(size) || size <= 0) return null;
  const [a, b, c, d] = matrix;
  if (a <= 0 || d >= 0 || Math.abs(b) > Math.max(.00001, a * .001)) return null;
  const shear = c / -d;
  if (Math.abs(shear) > .35) return null;
  return { size: size * -d, shear, italic: Math.abs(shear) >= .08, horizontalScale: a / -d };
}

export const textInkRects = item => item.preciseInk && item.words?.length
  ? item.words.map(word => word.rect) : [item.rect];
