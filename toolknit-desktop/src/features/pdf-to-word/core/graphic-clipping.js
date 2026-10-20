// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
const graphicState = new Set(['dependency', 'transform', 'clip', 'eoClip', 'constructPath', 'setFillRGBColor', 'setStrokeRGBColor',
  'setFillColorN', 'setStrokeColorN', 'setLineWidth', 'setLineCap', 'setLineJoin', 'setMiterLimit', 'setDash',
  'setRenderingIntent', 'setFlatness', 'shadingFill', 'paintImageXObject', 'paintInlineImageXObject',
  'paintImageMaskXObject', 'paintSolidColorImageMask']);

/** Find the end of a graphics-only saved scope already constrained by a clip. */
export function boundedGraphicClip(operations, start, hasSavedState) {
  if (!hasSavedState) return null;
  let depth = 0, painted = false;
  for (let index = start + 1; index < Math.min(operations.length, start + 2049); index++) {
    const { name, args = [] } = operations[index];
    if (name === 'save') { if (++depth > 100) return null; continue; }
    if (name === 'restore') {
      if (!depth) return { end: index, painted };
      depth--; continue;
    }
    if (name === 'setGState') {
      if (!Array.isArray(args[0]) || args[0].some(([key, value]) =>
        !['ca', 'CA', 'LW', 'LC', 'LJ', 'ML', 'D'].includes(key) && !(key === 'BM' && value === 'source-over') && !(key === 'SMask' && !value))) return null;
      continue;
    }
    if (!graphicState.has(name)) return null;
    painted ||= name === 'shadingFill' || name.startsWith('paint') || name === 'constructPath' && args[0] !== 'endPath';
  }
  return null;
}
