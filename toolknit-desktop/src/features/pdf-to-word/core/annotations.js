// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { intersect, transformedRect, validRect } from './geometry.js';

const paints = name => name === 'constructPath' || name === 'shadingFill' || /^paint(?:Image|InlineImage|SolidColor)/.test(name)
  || ['showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText'].includes(name);

/** PDF.js appends clipped annotation appearances after page content. */
export function boundedAnnotations(operations, transform, bounds) {
  const regions = new Map(), start = operations.findIndex(operation => operation.name === 'beginAnnotation');
  if (start < 0) return regions;
  for (let index = start; index < operations.length; index++) {
    const operation = operations[index];
    if (operation.name === 'dependency') continue;
    if (operation.name !== 'beginAnnotation' || regions.size >= 1000) return null;
    const rect = operation.args?.[1];
    if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)
      || rect[2] <= rect[0] || rect[3] <= rect[1]) return null;
    let end = index + 1, painted = false;
    for (; end < operations.length && operations[end].name !== 'endAnnotation'; end++) {
      if (operations[end].name === 'beginAnnotation') return null;
      painted ||= paints(operations[end].name);
    }
    if (end >= operations.length) return null;
    const full = transformedRect(transform, rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
    if (!validRect(full)) return null;
    regions.set(index, { end, rect: painted ? intersect(full, bounds) : null });
    index = end;
  }
  return regions;
}
