// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { contains, overlaps, spatialIndex } from './geometry.js';
import { independentTextGroups } from './text-paint-groups.js';
import { textInkRects } from './text-geometry.js';
import { LIMITS } from './input.js';
import { raisedReferenceText } from './raised-reference.js';

const expand = (rect, padding) => ({ x: rect.x - padding, y: rect.y - padding,
  width: rect.width + padding * 2, height: rect.height + padding * 2 });
const plainText = item => !item.raster && item.preciseInk && !item.alphabet && !item.radicalPart
  && !item.delimiterPart && !item.mathStyleUncertain
  && !/[\p{Sm}^_\u221a\u222b\u2211]/u.test(item.text)
  && (/[\p{Script=Latin}]{3,}|[\p{Script=Han}]{2,}/u.test(item.text)
    || /^\s*\d[\d.,: -]{2,}\s*$/u.test(item.text));

// A neighbouring formula's outer box can reach a complete prose draw without
// touching its ink. Only an independently removable, ordinary native phrase
// may bypass that proximity check; actual overlap and stroke checks still apply.
const separatedProse = (item, textAt) => !item.ocr && !item.italic && !item.bold
  && /^(?:[A-Z]{6}\+)?(?:NimbusRomNo9L-Regu|Times-Roman|TimesNewRomanPSMT|ArialMT|Helvetica)$/.test(item.font || '')
  && typeof item.text === 'string' && item.text.length >= 14
  && /^[A-Za-z.,][A-Za-z ,.;:'()[\]0-9-]*$/u.test(item.text)
  && (item.text.match(/[A-Za-z]{3,}/g) || []).length >= 2
  && !textAt(item.rect).some(other => other !== item
    && textInkRects(item).some(a => textInkRects(other).some(b => overlaps(a, b, .1))));

/** Recover plain labels from a proven paint stream without reflowing a figure. */
export function recoverGraphicTextLayers({ number, items, text, sources, operations, graphics = [], bounds, maxLayers = LIMITS.backgroundLayersPerPage }) {
  const groups = independentTextGroups(operations);
  if (!groups.length) return { items, count: 0 };
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const referenceItems = raisedReferenceText(text, sources, bounds);
  const referencesByIndex = new Map(text.filter(item => referenceItems.has(item.id)).map(item => [item.order, item.id]));
  const relativeGroups = referenceItems.size ? independentTextGroups(operations, { relativeMoves: true })
    .filter(group => group.every(index => referencesByIndex.get(index) === `p${number}:t${index}`)) : [];
  const relativeIndexes = new Set(relativeGroups.flat());
  const redraws = new Set(sources.filter(source => source.disposition === 'redraw').map(source => source.equivalentTo));
  const textAt = spatialIndex(text), strokesAt = spatialIndex(graphics.filter(item => item.thin));
  const imagesAt = spatialIndex(items.filter(item => item.type === 'image'));
  const eligible = new Map(text.filter(item => {
    if (!plainText(item) || redraws.has(item.id)) return false;
    const reference = referenceItems.has(item.id) || separatedProse(item, textAt);
    const nearby = expand(item.rect, item.size * .4);
    // Raised indices, fractions and crossing rules must stay in their image.
    if (!reference && textAt(nearby).some(other => other !== item && overlaps(nearby, other.rect, 0)
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
    for (const group of [...groups, ...relativeGroups]) {
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
      ...(indexes.some(index => relativeIndexes.has(index)) ? {
        relativeTextPaintIndexes: [...new Set([...(image.relativeTextPaintIndexes || []), ...indexes.filter(index => relativeIndexes.has(index))])]
      } : {}),
      backgroundPaintIndexes: [...new Set([...(image.backgroundPaintIndexes || []), ...indexes])].sort((a, b) => a - b) });
    for (const id of selected) {
      sourceById.get(id).disposition = 'editable';
      restored.push({ ...eligible.get(id), type: 'text' });
    }
  }
  return { items: [...output, ...restored], count };
}

/** Pixel-rounded rule crops beside a proven white clip can include the edge
 * of later editable text. Reuse the existing filtered page render, removing
 * only complete independent text groups already owned by editable components.
 * This does not recover text or alter the source ledger. */
export function protectClippedRuleLayers({ number, items, sources, operations, whiteClips, maxLayers }) {
  if (!whiteClips.length || maxLayers <= 0) return { items, count: 0 };
  const sourceById = new Map(sources.map(source => [source.id, source])), partitions = new Map(), groupById = new Map();
  for (const source of sources) if (source.splitFrom) {
    if (!partitions.has(source.splitFrom)) partitions.set(source.splitFrom, []);
    partitions.get(source.splitFrom).push(source);
  }
  for (const group of independentTextGroups(operations)) {
    const visible = group.flatMap(index => partitions.get(`p${number}:t${index}`) || [sourceById.get(`p${number}:t${index}`)])
      .filter(source => source && source.disposition !== 'excluded-hidden');
    if (!visible.length || !visible.every(source => source.disposition === 'editable')) continue;
    for (const source of visible) groupById.set(source.id, group);
  }
  const textAt = spatialIndex(sources.filter(source => groupById.has(source.id))), clipsAt = spatialIndex(whiteClips);
  let count = 0;
  const output = items.map(item => {
    if (count >= maxLayers || item.type !== 'image' || !item.decoration || !item.thin || item.sourceIds.length
      || item.backgroundPaintIndexes?.length || !clipsAt(expand(item.rect, 1)).some(clip => overlaps(expand(item.rect, 1), clip.rect, 0))) return item;
    const indexes = [...new Set(textAt(expand(item.rect, .5)).filter(source => overlaps(expand(item.rect, .5), source.rect, 0))
      .flatMap(source => groupById.get(source.id)))].sort((a,b) => a-b);
    if (!indexes.length) return item;
    count++;
    return { ...item, decorationTextPaintIndexes: indexes };
  });
  return { items: output, count };
}
