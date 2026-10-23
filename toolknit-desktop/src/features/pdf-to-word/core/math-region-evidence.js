// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { bottom, right, union, overlaps, spatialIndex, median } from './geometry.js';

/** Long fraction rules need two-sided text evidence. Raising the general
 * line-length threshold would also turn separators and table rules into math. */
export function longFractionBars(text, candidates, graphics, strongMath) {
  const size = median(candidates.map(item => item.size)), result = new Map();
  if (!(size > 0) || !Number.isFinite(size)) return result;
  const candidateSet = new Set(candidates), query = spatialIndex(text), graphicQuery = spatialIndex(graphics);
  let work = 0;
  for (const line of graphics) {
    const box = line.rect;
    if (!line.thin || line.mathGlyph || line.path && !line.path.complete
      || box.width < Math.min(100, size * 10) || box.height > Math.min(1.5, size * .12)) continue;
    const band = { x: box.x - .7, y: box.y - size * 1.8, width: box.width + 1.4, height: box.height + size * 3.6 };
    const nearby = query(band).filter(item => overlaps(band, item.rect, 0));
    work += nearby.length;
    if (work > 8192) break;
    if (!nearby.length || nearby.length > 512 || nearby.some(item => !candidateSet.has(item) || item.raster)) continue;
    const within = nearby.filter(item => item.rect.x >= box.x - .7 && right(item.rect) <= right(box) + .7);
    const axis = box.y + box.height / 2;
    const above = within.filter(item => bottom(item.rect) <= axis - .2);
    const below = within.filter(item => item.rect.y >= axis + .2);
    if (!above.length || !below.length || above.length + below.length !== within.length || !within.some(strongMath)) continue;
    const ownSize = Math.max(...within.map(item => item.size));
    if ([above, below].some(items => {
      const rect = union(items.map(item => item.rect));
      return Math.abs(rect.x + rect.width / 2 - box.x - box.width / 2) > ownSize * .4;
    })) continue;
    const crossing = graphicQuery({ x: box.x - .6, y: box.y - .6, width: box.width + 1.2, height: box.height + 1.2 });
    work += crossing.length;
    if (work > 8192) break;
    if (crossing.some(other => other !== line && other.rect.height > ownSize * .7 && other.rect.width < ownSize * .15
      && overlaps({ x: box.x - .6, y: box.y - .6, width: box.width + 1.2, height: box.height + 1.2 }, other.rect, 0))) continue;
    result.set(line, new Set(within));
  }
  return result;
}
