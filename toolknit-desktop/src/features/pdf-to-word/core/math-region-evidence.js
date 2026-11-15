// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { bottom, right, union, overlaps, spatialIndex, median, validRect } from './geometry.js';
import { hasNativeMathFunctionRun } from './math-limit-runs.js';

/** Wide short rules need numerator AND denominator evidence. Otherwise a
 * footnote separator can connect an entire prose line to a nearby expression. */
export function nativeNonFractionRules(candidates, graphics) {
  if (!Array.isArray(candidates) || !Array.isArray(graphics) || candidates.length > 20000 || graphics.length > 20000) return new Set();
  const size = median(candidates.map(glyph => glyph.size));
  if (!(size > 0)) return new Set();
  const query = spatialIndex(candidates), result = new Set(); let work = 0;
  for (const line of graphics) {
    const rect = line.rect;
    if (!line.thin || line.mathGlyph || !line.path?.complete || !validRect(rect)
      || rect.width < size * 4 || rect.width >= 100 || rect.height > Math.min(1.5, size * .12)) continue;
    const band = { x: rect.x - .7, y: rect.y - size * 2, width: rect.width + 1.4, height: rect.height + size * 4 };
    const nearby = query(band); work += nearby.length;
    if (work > 8192) return new Set();
    const within = nearby.filter(glyph => glyph.rect.x >= rect.x - .7 && right(glyph.rect) <= right(rect) + .7);
    const axis = rect.y + rect.height / 2;
    const above = within.some(glyph => bottom(glyph.rect) <= axis - .2 && bottom(glyph.rect) >= band.y);
    const below = within.some(glyph => glyph.rect.y >= axis + .2 && glyph.rect.y <= bottom(band));
    if (!above || !below) result.add(line);
  }
  return result;
}

/** A source function prefix may end with an unjoined closing-only run. Claim
 * it once, only at the original baseline and with no intervening text. */
export function nativeFunctionClosings(groups, text) {
  if (!Array.isArray(groups) || !Array.isArray(text) || groups.length > 20000 || text.length > 20000
    || groups.reduce((sum, group) => sum + group.length, 0) > 20000) return groups;
  const owned = new Set(groups.flat()), query = spatialIndex(text), proposals = new Map(), claims = new Map();
  let work = 0;
  for (const group of groups) {
    const prefixes = group.filter(glyph => hasNativeMathFunctionRun(glyph.text, glyph.font));
    if (prefixes.length !== 1 || group.some(glyph => !glyph.text || !glyph.preciseInk || glyph.raster !== false
      || glyph.ocr || !validRect(glyph.rect) || !Number.isFinite(glyph.baseline + glyph.size))) continue;
    const prefix = prefixes[0], value = group.map(glyph => glyph.text).join('');
    const open = (value.match(/\(/g) || []).length - (value.match(/\)/g) || []).length;
    if (open < 1 || open > 2) continue;
    const box = union(group.map(glyph => glyph.rect));
    const nearby = query({ x: right(box) - .2, y: prefix.rect.y - prefix.size, width: prefix.size, height: prefix.size * 3 });
    work += nearby.length;
    if (work > 8192) return groups;
    const closings = nearby.filter(glyph => !owned.has(glyph) && glyph.text?.trim() === ')'.repeat(open)
      && glyph.font === prefix.font && !glyph.italic && !glyph.bold && glyph.preciseInk && glyph.raster === false && !glyph.ocr
      && Math.abs(glyph.size - prefix.size) <= .01 && Math.abs(glyph.baseline - prefix.baseline) <= .05
      && glyph.rect.x >= right(box) - .2 && glyph.rect.x <= right(box) + prefix.size * .8);
    if (closings.length !== 1) continue;
    const closing = closings[0], complete = union([box, closing.rect]), visible = query(complete);
    work += visible.length;
    if (work > 8192) return groups;
    const members = new Set([...group, closing]);
    if (visible.some(glyph => !members.has(glyph) && overlaps(complete, glyph.rect, .1))) continue;
    proposals.set(group, closing); claims.set(closing, (claims.get(closing) || 0) + 1);
  }
  return groups.map(group => {
    const closing = proposals.get(group);
    return closing && claims.get(closing) === 1 ? [...group, closing] : group;
  });
}

/** A small native reference after a full stop belongs to the sentence, even
 * when the preceding word ends in an italic mathematical variable. */
export function nativeFootnoteMarkers(text) {
  if (!Array.isArray(text) || text.length > 20000) return new Set();
  const safe = glyph => glyph && glyph.preciseInk && glyph.raster === false && !glyph.ocr
    && !glyph.alphabet && !glyph.mathStyleUncertain && !glyph.radicalPart && !glyph.delimiterPart && !glyph.bold
    && validRect(glyph.rect) && glyph.rect.width > 0 && glyph.rect.height > 0
    && Number.isFinite(glyph.size + glyph.baseline) && glyph.size >= 1 && glyph.size <= 400
    && /^[0-9a-f]{6}$/i.test(glyph.color || '');
  const available = text.filter(safe), query = spatialIndex(available), result = new Set();
  const roman = /^(?:[A-Z]{6}\+)?(?:Times-Roman|TimesNewRomanPSMT|NimbusRomNo9L-Regu|CMR(?:[5-9]|1[012]))$/;
  let work = 0;
  for (const marker of available) {
    if (marker.italic || !/^\d{1,3}$/.test(marker.text || '') || !roman.test(marker.font || '')) continue;
    const nearby = query({ x: marker.rect.x - marker.size * 3, y: marker.rect.y - marker.size,
      width: marker.rect.width + marker.size * 4, height: marker.rect.height + marker.size * 3 });
    work += nearby.length;
    if (work > 8192) return new Set();
    const matches = [];
    for (const dot of nearby) {
      if (dot === marker || dot.text !== '.' || dot.italic || dot.font !== marker.font
        || marker.size < dot.size * .45 || marker.size >= dot.size * .85
        || dot.baseline - marker.baseline < dot.size * .2 || dot.baseline - marker.baseline > dot.size * .8
        || dot.rect.height > dot.size * .25 || dot.rect.width < dot.rect.height * .5 || dot.rect.width > dot.rect.height * 2
        || Math.abs(bottom(dot.rect) - dot.baseline) > dot.size * .08
        || marker.rect.x - right(dot.rect) < 0 || marker.rect.x - right(dot.rect) > dot.size * .5) continue;
      const bases = nearby.filter(glyph => glyph !== dot && glyph !== marker && glyph.italic
        && /^[A-Za-z]$/.test(glyph.text || '') && /^(?:[A-Z]{6}\+)?CMMI(?:[5-9]|1[012])$/.test(glyph.font || '')
        && Math.abs(glyph.size - dot.size) <= .01 && Math.abs(glyph.baseline - dot.baseline) <= .05
        && glyph.color === dot.color && dot.rect.x - right(glyph.rect) >= dot.size * .02
        && dot.rect.x - right(glyph.rect) <= dot.size * .6);
      if (bases.length !== 1) continue;
      const base = bases[0], box = union([base.rect, dot.rect, marker.rect]);
      if (!nearby.some(glyph => glyph !== base && glyph !== dot && glyph !== marker && overlaps(box, glyph.rect, .1))) matches.push(dot);
    }
    if (matches.length === 1) result.add(marker);
  }
  return result;
}

/** A decimal dot can be a separate italic-font command. Prove its two numeric
 * neighbours before treating it as math; sentence stops and bullets stay prose. */
export function nativeDecimalPoints(text) {
  if (!Array.isArray(text) || text.length > 20000) return [];
  const safe = glyph => glyph && glyph.preciseInk && glyph.raster === false && !glyph.ocr
    && !glyph.alphabet && !glyph.mathStyleUncertain && !glyph.radicalPart && !glyph.delimiterPart && !glyph.bold
    && validRect(glyph.rect) && glyph.rect.width > 0 && glyph.rect.height > 0
    && Number.isFinite(glyph.size + glyph.baseline) && glyph.size >= 1 && glyph.size <= 400;
  const available = text.filter(safe), query = spatialIndex(available), result = [];
  const roman = /^(?:[A-Z]{6}\+)?(?:CMR(?:[5-9]|1[012])|Times-Roman|TimesNewRomanPSMT|NimbusRomNo9L-Regu)$/;
  const dotFace = /^(?:[A-Z]{6}\+)?(?:CM(?:R|MI)(?:[5-9]|1[012])|Times-Roman|TimesNewRomanPSMT|NimbusRomNo9L-Regu)$/;
  let work = 0;
  for (const dot of available) {
    if (dot.text !== '.' || !dotFace.test(dot.font || '')
      || dot.italic && !/^(?:[A-Z]{6}\+)?CMMI(?:[5-9]|1[012])$/.test(dot.font || '')
      || dot.rect.height > dot.size * .25 || dot.rect.width < dot.rect.height * .5 || dot.rect.width > dot.rect.height * 2
      || Math.abs(bottom(dot.rect) - dot.baseline) > dot.size * .08) continue;
    const nearby = query({ x: dot.rect.x - dot.size * 4, y: dot.rect.y - dot.size,
      width: dot.size * 8, height: dot.size * 2 });
    work += nearby.length;
    if (work > 8192) return [];
    const peers = nearby.filter(glyph => glyph !== dot && !glyph.italic && roman.test(glyph.font || '')
      && Math.abs(glyph.size - dot.size) <= .01 && Math.abs(glyph.baseline - dot.baseline) <= .05 && glyph.color === dot.color);
    const left = peers.filter(glyph => /^(?:[=<>+\-−]\s*)?\d{1,6}$/.test(String(glyph.text || '').trim())
      && dot.rect.x - right(glyph.rect) >= -.2 && dot.rect.x - right(glyph.rect) <= dot.size * .45);
    const after = peers.filter(glyph => /^\d{1,6}$/.test(String(glyph.text || '').trim())
      && glyph.rect.x - right(dot.rect) >= -.2 && glyph.rect.x - right(dot.rect) <= dot.size * .45);
    if (left.length === 1 && after.length === 1 && left[0].font === after[0].font) result.push(dot);
  }
  return result;
}

/** A proven small native subscript already has one local base. Its proximity
 * to another prose line must not connect both rows into a rectangular crop. */
export function nativeSubscriptOwners(candidates) {
  const owners = new Map();
  if (!Array.isArray(candidates) || candidates.length > 20000) return owners;
  const safe = glyph => glyph && glyph.preciseInk && glyph.raster === false && !glyph.ocr && !glyph.alphabet
    && !glyph.mathStyleUncertain && !glyph.radicalPart && !glyph.delimiterPart && !glyph.bold
    && validRect(glyph.rect) && glyph.rect.width > 0 && glyph.rect.height > 0
    && Number.isFinite(glyph.baseline + glyph.size) && glyph.size >= 1 && glyph.size <= 400;
  const available = candidates.filter(safe), query = spatialIndex(available);
  let work = 0;
  for (const small of available) {
    if (!/^(?:[A-Z]{6}\+)?CM(?:MI|R)(?:[5-9]|1[012])$/.test(small.font || '')
      || !/^[A-Za-z0-9\p{Script=Greek}]$/u.test(small.text || '')) continue;
    const nearby = query({ x: small.rect.x - small.size * 2, y: small.rect.y - small.size * 2,
      width: small.rect.width + small.size * 4, height: small.rect.height + small.size * 4 });
    work += nearby.length;
    if (work > 8192) return new Map();
    const bases = nearby.filter(base => base !== small && base.italic
      && /^(?:[A-Z]{6}\+)?CMMI(?:[5-9]|1[012])$/.test(base.font || '')
      && /^[A-Za-z\p{Script=Greek}]$/u.test(base.text || '')
      && small.size >= base.size * .45 && small.size < base.size * .85
      && small.baseline - base.baseline > base.size * .1 && small.baseline - base.baseline < base.size * .6
      && small.rect.x >= base.rect.x + base.rect.width * .4 && small.rect.x <= right(base.rect) + base.size * .6);
    if (bases.length === 1) owners.set(small, bases[0]);
  }
  return owners;
}

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
