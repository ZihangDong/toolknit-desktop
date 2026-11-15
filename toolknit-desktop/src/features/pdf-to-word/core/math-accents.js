// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { validRect, union, right, bottom } from './geometry.js';

export const sourceMathAccent = g => g?.text === '\u02c6' && g.preciseInk && g.raster === false
  && !g.bold && !g.italic && !g.alphabet && !g.mathStyleUncertain && !g.radicalPart && !g.delimiterPart
  && /^(?:[A-Z]{6}\+)?CMR(?:[5-9]|1[012])$/.test(g.font || '')
  && g.size >= 4 && g.size <= 40 && Number.isFinite(g.baseline) && validRect(g.rect)
  && g.rect.height < g.size * .3 && g.rect.width >= g.size * .15 && g.rect.width <= g.size * .5;

export function sourceAccentNeighbor(accent, base) {
  if (!sourceMathAccent(accent) || !base?.preciseInk || base.raster !== false || !validRect(base.rect)
    || !/^[\p{Script=Latin}\p{Script=Greek}]$/u.test(base.text || '')
    || !/^(?:[A-Z]{6}\+)?CMMI(?:[5-9]|1[012])$/.test(base.font || '')
    || Math.abs(accent.size / base.size - 1) > .03 || Math.abs(accent.baseline - base.baseline) > .05) return false;
  const center = accent.rect.x + accent.rect.width / 2;
  return bottom(accent.rect) < base.rect.y - base.size * .03 && base.rect.y - bottom(accent.rect) < base.size * .45
    && center >= base.rect.x && center <= right(base.rect) + base.size * 1.1;
}

/** A narrow hat may cover a whole indexed variable, rather than just the
 * first letter. Source geometry must identify exactly one such argument. */
export function sourceAccentBase(accent, node, glyphs) {
  if (!sourceMathAccent(accent)) return null;
  const head = node?.type === 'script' ? node.base : node;
  if (head?.type !== 'symbol' || !/^[\p{Script=Latin}\p{Script=Greek}]$/u.test(head.text)
    || node.type === 'script' && (!node.subscript || node.superscript)) return null;
  const base = glyphs.get(head.sourceId);
  const sub = node.type !== 'script' ? [] : node.subscript.type === 'row' ? node.subscript.children : [node.subscript];
  if (!base || sub.length > 6 || sub.some(n => n.type !== 'symbol' || !/^[A-Za-z0-9,]$/.test(n.text))) return null;
  const parts = [base, ...sub.map(n => glyphs.get(n.sourceId))];
  if (parts.some(g => !g || !g.preciseInk || g.raster !== false || !g.italic || g.bold || g.alphabet || g.mathStyleUncertain
    || !/^(?:[A-Z]{6}\+)?CMMI(?:[5-9]|1[012])$/.test(g.font || '')
    || !validRect(g.rect) || !Number.isFinite(g.baseline) || g.color !== accent.color)) return null;
  const rect = union(parts.map(g => g.rect)), center = accent.rect.x + accent.rect.width / 2;
  if (Math.abs(accent.size / base.size - 1) > .03 || Math.abs(accent.baseline - base.baseline) > .05
    || bottom(accent.rect) > base.rect.y - base.size * .03 || base.rect.y - bottom(accent.rect) > base.size * .45
    || center < rect.x || center > right(rect) || Math.abs(center - rect.x - rect.width / 2) > base.size * .22) return null;
  return { ...base, rect };
}

export function attachSourceMathAccents(ast, accents, glyphs) {
  if (!accents.length) return ast;
  if (accents.length !== 1) throw new Error('ambiguous-math-accent');
  const accent = accents[0], options = []; let budget = 1024;
  const visit = node => {
    if (!node || --budget < 0) throw new Error('math-accent-budget');
    if (sourceAccentBase(accent, node, glyphs)) options.push(node);
    for (const value of Object.values(node)) if (value && typeof value === 'object') {
      if (Array.isArray(value)) value.forEach(visit); else visit(value);
    }
  };
  visit(ast);
  if (options.length !== 1) throw new Error('ambiguous-math-accent');
  const replace = node => {
    // Evidence arrays also contain source-id strings. Preserve their values;
    // treating them as nodes turns each id into an object of character keys.
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(replace);
    if (node === options[0]) return { type: 'accent', sourceId: accent.id, text: accent.text, base: node };
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key,
      Array.isArray(value) ? value.map(replace) : value && typeof value === 'object' ? replace(value) : value]));
  };
  return replace(ast);
}
