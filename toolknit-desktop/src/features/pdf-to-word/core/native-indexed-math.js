// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { validRect, right, union } from './geometry.js';
import { sourceMathAccent, sourceAccentBase } from './math-accents.js';
import { NATIVE_MATH_FUNCTIONS } from './math-limit-runs.js';

const nativeLetter = text => typeof text === 'string' && /^[\p{Script=Latin}\p{Script=Greek}]$/u.test(text);
const nativeItalic = glyph => glyph?.italic && /^(?:[A-Z]{6}\+)?CMMI(?:[5-9]|1[012])$/.test(glyph.font || '');
const uprightSerifIndex = glyph => glyph && typeof glyph.text === 'string' && !glyph.italic
  && /^(?:[A-Z]{6}\+)?NimbusRomNo9L-Regu$/.test(glyph.font || '') && /^[a-z]{3,12}$/.test(glyph.text);
const functionLabel = glyph => glyph && !glyph.italic && NATIVE_MATH_FUNCTIONS.includes(glyph.text)
  && /^(?:[A-Z]{6}\+)?CMR(?:[5-9]|1[012])$/.test(glyph.font || '');

function nativeScriptOwner(base, small, ids, upper = false) {
  if (!base || !small || !nativeItalic(base)) return false;
  const owners = [...ids.values()].filter(glyph => {
    const delta = upper ? glyph.baseline - small.baseline : small.baseline - glyph.baseline;
    return nativeItalic(glyph) && nativeLetter(glyph.text) && small.size >= glyph.size * .45 && small.size < glyph.size * .85
      && delta > glyph.size * (upper ? .2 : .1) && delta < glyph.size * (upper ? .8 : .6)
      && small.rect.x >= glyph.rect.x + glyph.rect.width * .4 && small.rect.x <= right(glyph.rect) + glyph.size * .6;
  });
  return owners.length === 1 && owners[0] === base;
}

function samePhysicalRow(main, boxes) {
  const first = main[0];
  return Boolean(first) && main.every((glyph, index) => Math.abs(glyph.size - first.size) <= .01
    && Math.abs(glyph.baseline - first.baseline) <= .05
    && (!index || boxes[index].x - right(boxes[index - 1]) >= -.3
      && boxes[index].x - right(boxes[index - 1]) <= first.size * 1.6));
}

function sourceSideCondition(node, ids) {
  const base = ids.get(node.base.sourceId), lower = node.subscript?.children;
  if (!Array.isArray(lower) || lower.length !== 3 || lower.some(child => child?.type !== 'symbol')
    || lower[1].text !== '≥' || !/^[\p{Script=Latin}\p{Script=Greek}]$/u.test(lower[0].text)
    || !/^[\p{Script=Latin}\p{Script=Greek}]$/u.test(lower[2].text)) return false;
  const glyphs = lower.map(child => ids.get(child.sourceId));
  if (glyphs.some(glyph => !glyph || glyph.size > base.size * .85 || glyph.size < base.size * .45
    || glyph.baseline - base.baseline < base.size * .1 || glyph.baseline - base.baseline > base.size * .6
    || Math.abs(glyph.size - glyphs[0].size) > .01 || Math.abs(glyph.baseline - glyphs[0].baseline) > .05)) return false;
  return glyphs[0].rect.x >= base.rect.x + base.rect.width - .3
    && glyphs[0].rect.x <= base.rect.x + base.rect.width + base.size * .6
    && glyphs.slice(1).every((glyph, index) => {
      const previous = glyphs[index], gap = glyph.rect.x - previous.rect.x - previous.rect.width;
      return gap >= -.25 && gap <= glyphs[0].size * .6;
    });
}

/** Source typewriter labels are admitted as indices, or as max with a proven
 * right-side condition. Upright serif labels require a unique lower-index
 * owner. Ordinary words, OCR and unknown fonts stay outside math. */
export function sourceNamedIndex(ast, region) {
  return sourceIndexedMath(ast, region, 'named');
}

/** A short sum of indexed scalar products needs no nested mathematical layout.
 * Share the full source proof without widening the general script gate. */
export function sourceIndexedArithmetic(ast, region) {
  return sourceIndexedMath(ast, region, 'arithmetic');
}

export function sourceNativeFunction(ast, region) {
  return sourceIndexedMath(ast, region, 'function');
}

function sourceFunctionRow(ast, ids) {
  if (ast?.type !== 'row') return false;
  const nodes = [], pending = [{ node: ast, depth: 0 }], seen = new Set();
  while (pending.length) {
    const { node, depth } = pending.pop();
    if (!node || seen.has(node) || seen.size >= 32 || depth > 4) return false;
    seen.add(node);
    if (node.type === 'row') {
      if (!Array.isArray(node.children) || node.children.length < 2 || node.children.length > 8) return false;
      pending.push(...node.children.map(child => ({ node: child, depth: depth + 1 })).reverse());
    } else nodes.push(node);
  }
  if (nodes.length < 4 || nodes.length > 8) return false;
  const main = [], boxes = [];
  const push = node => {
    if (node?.type !== 'symbol') return false;
    const glyph = ids.get(node.sourceId);
    if (!glyph) return false;
    main.push(glyph); boxes.push(glyph.rect); return true;
  };
  let cursor = 0, depth = 0;
  while (depth < 2 && nodes[cursor]?.type === 'symbol' && functionLabel(ids.get(nodes[cursor].sourceId))
    && nodes[cursor + 1]?.type === 'symbol' && nodes[cursor + 1].text === '(') {
    if (!push(nodes[cursor]) || !push(nodes[cursor + 1])) return false;
    cursor += 2; depth++;
  }
  const body = nodes.slice(cursor, nodes.length - depth);
  if (!depth || body.length < 1 || body.length > 2) return false;
  for (const node of body.slice(0, -1)) {
    if (node?.type !== 'symbol' || !/^[A-Z]$/.test(node.text) || !nativeItalic(ids.get(node.sourceId)) || !push(node)) return false;
  }
  const power = body.at(-1);
  if (power?.type !== 'script' || power.subscript || power.base?.type !== 'symbol' || !/^[A-Z]$/.test(power.base.text)
    || power.superscript?.type !== 'symbol' || power.superscript.text !== 'T') return false;
  const base = ids.get(power.base.sourceId), small = ids.get(power.superscript.sourceId);
  if (!nativeItalic(small) || !nativeScriptOwner(base, small, ids, true)) return false;
  main.push(base); boxes.push(union([base.rect, small.rect]));
  for (const node of nodes.slice(nodes.length - depth)) if (node?.type !== 'symbol' || node.text !== ')' || !push(node)) return false;
  return samePhysicalRow(main, boxes);
}

function sourceArithmeticRow(ast, ids) {
  if (ast?.type !== 'row' || !Array.isArray(ast.children) || ![7, 11].includes(ast.children.length)) return false;
  const terms = [[]], main = [], boxes = []; let scripts = 0;
  for (const node of ast.children) {
    if (node?.type === 'symbol' && ['+', '-', '−'].includes(node.text)) terms.push([]);
    else terms.at(-1).push(node);
  }
  if (terms.length < 2 || terms.length > 3 || terms.some(term => term.length !== 3
    || term[1]?.type !== 'symbol' || term[1].text !== '·'
    || ![term[0], term[2]].some(node => node?.type === 'script'))) return false;
  for (const node of ast.children) {
    if (node?.type === 'symbol') {
      const glyph = ids.get(node.sourceId);
      if (!glyph || !(nativeLetter(node.text) ? nativeItalic(glyph)
        : ['+', '-', '−', '·'].includes(node.text) && !glyph.italic)) return false;
      main.push(glyph); boxes.push(glyph.rect); continue;
    }
    if (node?.type !== 'script' || node.superscript || node.base?.type !== 'symbol'
      || node.subscript?.type !== 'symbol' || !nativeLetter(node.base.text)
      || !/^[\p{Script=Latin}\p{Script=Greek}0-9]$/u.test(node.subscript.text || '') || ++scripts > 3) return false;
    const base = ids.get(node.base.sourceId), small = ids.get(node.subscript.sourceId);
    if (!nativeScriptOwner(base, small, ids)) return false;
    main.push(base); boxes.push(union([base.rect, small.rect]));
  }
  return scripts >= 2 && samePhysicalRow(main, boxes);
}

function sourceIndexedMath(ast, region, mode) {
  const arithmetic = mode === 'arithmetic', functionCall = mode === 'function', extended = arithmetic || functionCall;
  const glyphs = region.mathGlyphs;
  if (region.role !== 'math' || !Array.isArray(glyphs) || glyphs.length < 2 || glyphs.length > 24
    || region.mathStrokes?.length || region.drawingIds?.length || region.reasons?.length || region.backgroundPaintIndexes?.length
    || !Array.isArray(region.sourceIds) || !region.sourceIds.length || region.sourceIds.length > 24) return false;
  const sources = new Set(region.sourceIds), ids = new Map(glyphs.map(g => [g.id, g]));
  const label = g => uprightSerifIndex(g)
    || /^(?:[A-Z]{6}\+)?CMTT(?:[5-9]|1[012])$/.test(g.font || '') && /^[a-z]{3,12}$/.test(g.text);
  const maxima = glyphs.filter(g => label(g) && g.text === 'max'), maximum = maxima.length === 1 ? maxima[0] : null;
  const sourceEquality = g => maximum && g.text === '=' && !g.italic
    && /^(?:[A-Z]{6}\+)?NimbusRomNo9L-Regu$/.test(g.font || '')
    && Math.abs(g.size - maximum.size) <= .01 && Math.abs(g.baseline - maximum.baseline) <= .05;
  if (ids.size !== glyphs.length || sources.size !== region.sourceIds.length || !extended && !glyphs.some(g => label(g) || sourceMathAccent(g))
    || glyphs.some(g => typeof g.id !== 'string' || !g.preciseInk || g.raster !== false || g.ocr
      || g.alphabet || g.mathStyleUncertain || g.radicalPart || g.delimiterPart || g.bold
      || !validRect(g.rect) || extended && !(g.rect.width > 0 && g.rect.height > 0)
      || !Number.isFinite(g.baseline) || !(g.size >= 4 && g.size <= 40)
      || !/^[0-9a-f]{6}$/i.test(g.color || '') || g.color !== glyphs[0].color
      || !(sourceEquality(g) || label(g) && !g.italic || functionCall && functionLabel(g)
        || /^(?:[A-Z]{6}\+)?CM(?:MI|R|SY)(?:[5-9]|1[012])$/.test(g.font || '')
        && typeof g.text === 'string' && [...g.text].length === 1)
      || !(sources.has(g.id) || sources.has(g.splitFrom) && Array.isArray(g.sourceRange)
        && g.sourceRange.length === 2 && g.sourceRange.every(Number.isSafeInteger)
        && g.sourceRange[0] >= 0 && g.sourceRange[1] > g.sourceRange[0] && g.sourceRange[1] <= 4096))) return false;
  const covered = new Set(glyphs.map(g => sources.has(g.id) ? g.id : g.splitFrom));
  if (covered.size !== sources.size || arithmetic && !sourceArithmeticRow(ast, ids) || functionCall && !sourceFunctionRow(ast, ids)) return false;
  if (glyphs.some(uprightSerifIndex) && (glyphs.length !== 2 || ast?.type !== 'script'
    || ast.base?.type !== 'symbol' || ast.subscript?.type !== 'symbol' || ast.superscript)) return false;
  const seen = new Set(), serifIndices = new Set(); let remaining = 64, labels = 0, accents = 0, scripts = 0;
  const visit = (node, role = 'main', depth = 0) => {
    if (!node || typeof node !== 'object' || --remaining < 0 || depth > 6) return false;
    if (node.type === 'symbol') {
      const g = ids.get(node.sourceId);
      if (!g || seen.has(g.id) || node.text !== g.text || node.alphabet
        || node.italic !== Boolean(g.italic) || node.bold !== Boolean(g.bold)) return false;
      if (uprightSerifIndex(g) && !serifIndices.has(g.id)) return false;
      if (label(g)) { if (role !== 'subscript' && !(role === 'operator-base' && g.text === 'max')) return false; labels++; }
      seen.add(g.id); return true;
    }
    if (node.type === 'accent') {
      const g = ids.get(node.sourceId);
      if (role !== 'main' || ++accents > 1 || !g || seen.has(g.id) || node.text !== g.text || !sourceAccentBase(g, node.base, ids)) return false;
      seen.add(g.id); return visit(node.base, 'main', depth + 1);
    }
    if (node.type === 'row') return Array.isArray(node.children) && node.children.length >= 2
      && node.children.length <= 24 && node.children.every(child => visit(child, role, depth + 1));
    if (functionCall && node.type === 'script') return role === 'main' && ++scripts <= 1
      && !node.subscript && node.base?.type === 'symbol' && node.superscript?.type === 'symbol'
      && visit(node.base, 'base', depth + 1) && visit(node.superscript, 'superscript', depth + 1);
    if (node.type !== 'script' || role !== 'main' || ++scripts > 4 || !node.subscript || node.superscript
      || node.base?.type !== 'symbol') return false;
    const base = ids.get(node.base.sourceId), serifIndex = ids.get(node.subscript?.sourceId);
    if (uprightSerifIndex(serifIndex)) {
      if (!nativeScriptOwner(base, serifIndex, ids)) return false;
      serifIndices.add(serifIndex.id);
    }
    const sideMax = base && label(base) && base.text === 'max' && sourceSideCondition(node, ids);
    if (!/^[\p{Script=Latin}\p{Script=Greek}]$/u.test(node.base.text) && !sideMax) return false;
    return visit(node.base, sideMax ? 'operator-base' : 'base', depth + 1) && visit(node.subscript, 'subscript', depth + 1);
  };
  return visit(ast) && (extended || labels > 0 || accents > 0) && scripts > 0 && seen.size === ids.size;
}
