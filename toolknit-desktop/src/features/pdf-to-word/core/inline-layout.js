// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { median, right, bottom, spatialIndex } from './geometry.js';
import { groupLines } from './text.js';

export const requiresPackedLayout = pages => pages.some(page => page.height < 400 || page.rasterPage || page.backgroundTextLayers > 0
  || page.risks?.includes('math-image') || page.risks?.includes('unmapped-glyph'));

export function pageInlineParts(scene, { preserveGeometry = false } = {}) {
  const stableFlow = !preserveGeometry && !scene.backgroundTextLayers && scene.height >= 400 && !scene.items.some(item => item.role === 'math' || item.reasons?.includes('unmapped-glyph'));
  const text = scene.items.filter(item => item.type === 'text').map(item => stableFlow && item.advanceRect
    ? { ...item, rect: item.advanceRect, preciseInk: false } : item);
  const bodySize = median(text.map(item => item.size)) || 11;
  const anchors = spatialIndex(scene.items.filter(item => item.type === 'text' || item.sourceIds.length && Number.isFinite(item.baseline)));
  const figures = scene.items.filter(item => item.type === 'image').map(item => {
    if (item.backgroundPaintIndexes?.length) return item;
    if (item.sourceIds.length || item.rect.height > bodySize * 3.5 || item.rect.width > bodySize * 12) return item;
    const neighbours = anchors({ x: item.rect.x - bodySize * 2, y: item.rect.y - bodySize, width: item.rect.width + bodySize * 4, height: item.rect.height + bodySize * 2 })
      .filter(other => other !== item && other.rect.y < bottom(item.rect) + bodySize && bottom(other.rect) > item.rect.y - bodySize);
    const distance = other => Math.max(0, item.rect.x - right(other.rect), other.rect.x - right(item.rect))
      + Math.abs(other.baseline - (item.rect.y + item.rect.height * .8));
    neighbours.sort((a, b) => distance(a) - distance(b));
    return neighbours.length ? { ...item, baseline: neighbours[0].baseline, size: neighbours[0].size, inlineGraphic: true } : item;
  });
  const inline = figures.filter(item => !scene.rasterPage && !item.backgroundPaintIndexes?.length
    && (item.sourceIds.length || item.inlineGraphic) && item.rect.height <= Math.max(bodySize * 3.5, (item.size || 0) * 3.5)
    && item.rect.width < scene.width * .9 && Number.isFinite(item.baseline));
  const ids = new Set(inline.map(item => item.id));
  const lines = groupLines([...text, ...inline.map(item => ({ ...item, text: item.optionPrefix || '', inline: true }))]);
  return [...lines, ...scene.items.filter(item => item.type !== 'text' && !ids.has(item.id))];
}
