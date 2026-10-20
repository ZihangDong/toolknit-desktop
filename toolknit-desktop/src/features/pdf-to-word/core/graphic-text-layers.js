// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { contains, overlaps, spatialIndex } from './geometry.js';
import { independentTextGroups } from './text-paint-groups.js';
import { textInkRects } from './text-geometry.js';
import { LIMITS } from './input.js';

const expand = (rect, padding) => ({ x: rect.x - padding, y: rect.y - padding,
  width: rect.width + padding * 2, height: rect.height + padding * 2 });
const plainText = item => !item.raster && item.preciseInk && !item.alphabet && !item.radicalPart
  && !item.delimiterPart && !item.mathStyleUncertain
  && !/[\p{Sm}^_\u221a\u222b\u2211]/u.test(item.text)
  && (/[\p{Script=Latin}]{3,}|[\p{Script=Han}]{2,}/u.test(item.text)
    || /^\s*\d[\d.,: -]{2,}\s*$/u.test(item.text));

/** Recover plain labels from a proven paint stream without reflowing a figure. */
export function recoverGraphicTextLayers({ number, items, text, sources, operations, graphics = [], maxLayers = LIMITS.backgroundLayersPerPage }) {
  const groups = independentTextGroups(operations);
  if (!groups.length) return { items, count: 0 };
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const redraws = new Set(sources.filter(source => source.disposition === 'redraw').map(source => source.equivalentTo));
  const textAt = spatialIndex(text), strokesAt = spatialIndex(graphics.filter(item => item.thin));
  const imagesAt = spatialIndex(items.filter(item => item.type === 'image'));
  const eligible = new Map(text.filter(item => {
    if (!plainText(item) || redraws.has(item.id)) return false;
    const nearby = expand(item.rect, item.size * .4);
    // Raised indices, fractions and crossing rules must stay in their image.
    if (textAt(nearby).some(other => other !== item && overlaps(nearby, other.rect, 0)
      && (other.size < item.size * .85 || other.size > item.size / .85 || other.alphabet
        || other.radicalPart || other.delimiterPart || /[\p{Sm}^_]/u.test(other.text)))) return false;
    const numeric = /^\s*\d/u.test(item.text);
    if (textInkRects(item).some(rect => {
      const ruleArea = expand(rect, item.size * (numeric ? 1 : .4));
      return strokesAt(ruleArea).some(stroke => (!numeric || stroke.rect.width <= item.size * 12 && stroke.rect.height <= item.size * .2)
        && overlaps(ruleArea, stroke.rect, .1));
    })) return false;
    return true;
  }).map(item => [item.id, item]));
  const output = [], restored = [];
  let count = 0;
  for (const image of items) {
    const existingLayer = Boolean(image.backgroundPaintIndexes?.length);
    if ((!existingLayer && count >= maxLayers) || image.type !== 'image' || image.role !== 'figure'
      || !image.sourceIds.length) { output.push(image); continue; }
    const owned = new Set(image.sourceIds), selected = new Set(), indexes = [];
    for (const group of groups) {
      const visible = group.map(index => sourceById.get(`p${number}:t${index}`))
        .filter(source => source && source.disposition !== 'excluded-hidden');
      if (!visible.length || !visible.every(source => owned.has(source.id) && eligible.has(source.id)
        && contains(image.rect, eligible.get(source.id).rect, 0)
        && !imagesAt(source.rect).some(other => other !== image && overlaps(other.rect, source.rect, 0)))) continue;
      visible.forEach(source => selected.add(source.id)); indexes.push(...group);
    }
    if (!selected.size) { output.push(image); continue; }
    if (!existingLayer) count++;
    // Table recovery may already own this backdrop. Merge only independently
    // verified remaining draws so both recovery passes share its render budget.
    output.push({ ...image, sourceIds: image.sourceIds.filter(id => !selected.has(id)),
      backgroundPaintIndexes: [...new Set([...(image.backgroundPaintIndexes || []), ...indexes])].sort((a, b) => a - b) });
    for (const id of selected) {
      sourceById.get(id).disposition = 'editable';
      restored.push({ ...eligible.get(id), type: 'text' });
    }
  }
  return { items: [...output, ...restored], count };
}
