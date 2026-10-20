// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { contains, overlaps } from './geometry.js';

/** White lettering is editable only when an unoccluded solid backdrop proves contrast. */
export function hasDarkTextBackground(item, paintsAt, textAt) {
  if (!item.preciseInk || textAt(item.rect).some(other => other !== item && other.order < item.order && overlaps(other.rect, item.rect, 0))) return false;
  const earlier = paintsAt(item.rect).filter(paint => paint.order < item.order && overlaps(paint.rect, item.rect, 0));
  return earlier.some(paint => paint.solidRect && paint.opaque && /^[0-9A-F]{6}$/i.test(paint.color)
    && [0, 2, 4].every(offset => Number.parseInt(paint.color.slice(offset, offset + 2), 16) <= 204)
    && contains(paint.rect, item.rect, 0) && !earlier.some(other => other.order > paint.order));
}
