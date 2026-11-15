// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { validRect, right } from './geometry.js';

const face = /^(?:[A-Z]{6}\+)?Cambria-Italic$/i;
const finiteBox = rect => validRect(rect) && rect.width > 0 && rect.height > 0
  && Object.values(rect).every(value => Math.abs(value) <= 14400);
const native = glyph => glyph && typeof glyph.id === 'string' && /^p\d{1,5}:t\d{1,6}$/.test(glyph.id)
  && glyph.raster === false && !glyph.ocr && glyph.preciseInk === true && glyph.italic === true && glyph.bold === false
  && !glyph.alphabet && !glyph.mathStyleUncertain && !glyph.radicalPart && !glyph.delimiterPart
  && face.test(glyph.font || '') && finiteBox(glyph.rect) && Number.isFinite(glyph.size) && glyph.size >= 2 && glyph.size <= 100
  && Number.isFinite(glyph.baseline) && Math.abs(glyph.baseline) <= 14400 && /^[0-9a-f]{6}$/i.test(glyph.color || '');

/** A multi-letter indexed quantity must already exist as a precise native
 * source run on this page. Proximity/English spelling alone cannot define it. */
export function validRasterIndexReference(reference, originalImageId, imageRect) {
  const base = reference?.base, small = reference?.subscript, page = originalImageId?.split(':')[0];
  if (!native(base) || !native(small) || !/^[a-z]{2,3}$/.test(base.text || '') || !/^[a-z0-9]$/.test(small.text || '')
    || base.id.split(':')[0] !== page || small.id.split(':')[0] !== page || base.id === small.id
    || base.font !== small.font || base.color !== small.color || small.size < base.size * .45 || small.size >= base.size * .85
    || small.baseline - base.baseline <= base.size * .04 || small.baseline - base.baseline > base.size * .6
    || small.rect.x < base.rect.x + base.rect.width * .4 || small.rect.x - right(base.rect) > base.size * .8
    || !finiteBox(imageRect) || Math.hypot(base.rect.x - imageRect.x, base.rect.y - imageRect.y) > 200) return false;
  return true;
}

export function rasterMathIndexReferences(scene, image) {
  if (!Array.isArray(scene?.items) || scene.items.length > 20000) return [];
  const closest = new Map();
  const fields = glyph => Object.fromEntries(['id', 'text', 'rect', 'font', 'size', 'baseline', 'raster', 'preciseInk', 'italic', 'bold', 'color']
    .map(key => [key, glyph[key]]));
  for (const item of scene.items) {
    if (item.role !== 'math' || item.mathGlyphs?.length !== 2 || item.mathStrokes?.length || item.reasons?.length
      || item.rasterMathEvidence || item.drawingIds?.length || item.sourceIds?.length !== 2
      || item.mathGlyphs.some((glyph, index) => glyph.id !== item.sourceIds[index])) continue;
    const [base, subscript] = item.mathGlyphs, reference = { base, subscript };
    if (!validRasterIndexReference(reference, image.id, image.rasterSource?.rect)) continue;
    const key = base.text + ':' + subscript.text, previous = closest.get(key);
    const distance = Math.hypot(base.rect.x - image.rect.x, base.rect.y - image.rect.y);
    if (!previous || distance < previous.distance) closest.set(key, { distance, reference: { base: fields(base), subscript: fields(subscript) } });
    if (closest.size > 8) return [];
  }
  return [...closest.values()].map(value => value.reference);
}

/** Recompute lexical bases from exact native references AND original component
 * adjacency. Ambiguous/overlapping claims decline the complete optical result. */
export function rasterMathScriptGroups(tokens, layout, references, imageId, imageRect) {
  if (!Array.isArray(references) || references.length > 8
    || references.some(reference => !validRasterIndexReference(reference, imageId, imageRect))) return null;
  const groups = tokens.map((token, index) => ({ units: [index], subscript: token.subscript?.index ?? null }));
  const used = new Set(), claimed = new Set(), proposals = [];
  for (let index = layout.operator + 1; index < tokens.length; index++) {
    const token = tokens[index]; if (!token.subscript) continue;
    const candidates = [];
    for (const reference of references) {
      const start = index + 1 - reference.base.text.length;
      if (start <= layout.operator || reference.subscript.text !== token.subscript.text
        || tokens.slice(start, index + 1).map(token => token.text).join('') !== reference.base.text) continue;
      let valid = true;
      for (let cursor = start; cursor < index; cursor++) {
        const a = layout.units[cursor].base.rect, b = layout.units[cursor + 1].base.rect, gap = b.x - right(a);
        if (tokens[cursor].subscript || gap < -.5 || gap > Math.max(1, Math.min(a.height, b.height) * .4)) valid = false;
      }
      if (valid) candidates.push({ start, index, reference });
    }
    if (candidates.length > 1) return null;
    if (candidates.length) proposals.push(candidates[0]);
  }
  for (const proposal of proposals) {
    const units = Array.from({ length: proposal.index - proposal.start + 1 }, (_, index) => proposal.start + index);
    if (units.some(unit => claimed.has(unit))) return null;
    units.forEach(unit => claimed.add(unit)); used.add(proposal.reference);
    groups[proposal.start] = { units, subscript: tokens[proposal.index].subscript.index };
    for (let index = proposal.start + 1; index <= proposal.index; index++) groups[index] = null;
  }
  return { groups: groups.filter(Boolean), references: [...used] };
}
