// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { contains, validRect, union } from './geometry.js';
import { inferMathAst } from './math.js';
import { MAX_MATH_NODES } from './math-rows.js';

export const MAX_MATH_RUN_GLYPHS = 200;
const namedLimit = /(?:^|[^A-Za-z])(argmin|argmax|min|max|lim|inf|sup)(?![A-Za-z])/;
const plain = text => text.replace(/\s/gu, '');
export const NATIVE_MATH_FUNCTIONS = Object.freeze(['log', 'ln', 'exp', 'softmax']);

/** Trace only a known native function prefix; its operands and closing
 * parentheses still need a complete source-bound structural proof. */
export function hasNativeMathFunctionRun(text, font) {
  if (typeof text !== 'string' || text.length > 64
    || !/^(?:[A-Z]{6}\+)?CMR(?:[5-9]|1[012])$/.test(font || '')) return false;
  const value = plain(text);
  return /^(?:[a-z]+\(){1,2}$/u.test(value)
    && value.split('(').slice(0, -1).every(name => NATIVE_MATH_FUNCTIONS.includes(name));
}

/** Keep short native numeric/operator runs' real origins without widening the
 * AST splitter. A trace is evidence for text placement, not for a 2D formula. */
export function hasLinearNativeMathRun(text, font) {
  if (typeof text !== 'string' || text.length > 128
    || !/^(?:[A-Z]{6}\+)?(?:CMR(?:[5-9]|1[012])|Times-Roman|TimesNewRomanPSMT)$/i.test(font || '')) return false;
  const value = plain(text);
  return value.length >= 2 && value.length <= 64 && /^[0-9=+\-−×÷.,:;()[\]{}<>/]+$/u.test(value)
    && (/[0-9]/u.test(value) && /[=+\-−×÷()[\]{}<>/]/u.test(value) || /^[()[\]{}]+$/u.test(value));
}

export function hasCompoundNativeMathRun(text, font) {
  return typeof text === 'string' && text.length <= 4096 && /\S[\s\S]*\S/u.test(text)
    && (/^(?:[A-Z]{6}\+)?XITSMath-Regular$/i.test(font || '')
      || /^(?:[A-Z]{6}\+)?CMMI(?:[5-9]|1[012])$/.test(font || '') && text.length <= 32
        && /^[\p{Script=Latin}\p{Script=Greek}0-9\s,=<>+\-\u2212\u2264\u2265]+$/u.test(text)
        && !/[\p{L}]{3}/u.test(text));
}

/** Complete source offsets and ink are required even when only the final
 * variable is queried. No substring receives a guessed share of a PDF box. */
export function nativeMathRunParts(glyph) {
  if (!glyph || typeof glyph !== 'object') return null;
  const positions = glyph.mathGlyphPositions;
  if (!glyph.preciseInk || glyph.raster !== false || glyph.alphabet || glyph.mathStyleUncertain
    || glyph.radicalPart || glyph.delimiterPart || !hasCompoundNativeMathRun(glyph.text, glyph.font)
    || !Array.isArray(positions) || positions.length < 2) return null;
  return splitMathRun(glyph);
}

export function completeMathGlyphPositions(glyph, maximum = MAX_MATH_RUN_GLYPHS) {
  const positions = glyph.mathGlyphPositions;
  if (typeof glyph.text !== 'string' || glyph.text.length > 4096
    || !validRect(glyph.rect) || !Number.isFinite(glyph.baseline)
    || !Array.isArray(positions) || positions.length < 2 || positions.length > maximum
    || positions.some((part, index) => !part || typeof part.text !== 'string'
    || !part.text.trim() || !validRect(part.rect) || !contains(glyph.rect, part.rect, .3)
    || !Number.isSafeInteger(part.sourceOffset) || part.sourceOffset < 0
    || glyph.text.slice(part.sourceOffset, part.sourceOffset + part.text.length) !== part.text
    || !Number.isFinite(part.baseline + part.baselineX + part.advanceWidth) || part.advanceWidth <= 0
    || Math.abs(part.baseline - glyph.baseline) > .05
    || index && (part.sourceOffset < positions[index - 1].sourceOffset + positions[index - 1].text.length
      || part.baselineX < positions[index - 1].baselineX - .2))
    || positions.map(part => part.text).join('') !== plain(glyph.text)) return null;
  return positions;
}

function splitMathRun(glyph, functionCall = false) {
  const positions = completeMathGlyphPositions(glyph);
  if (!positions) return null;
  const parts = [];
  const tokens = functionCall && /^(?:[A-Z]{6}\+)?CMMI(?:[5-9]|1[012])$/.test(glyph.font || '') && /^[A-Z]{2}$/.test(glyph.text)
    ? /[A-Za-z]|[0-9]+|\.{2,3}|[^\s]/gu : /[A-Za-z]+|[0-9]+|\.{2,3}|[^\s]/gu;
  for (const match of glyph.text.matchAll(tokens)) {
    if (parts.length >= MAX_MATH_NODES) return null;
    const start = match.index, end = start + match[0].length;
    const selected = positions.filter(part => part.sourceOffset >= start && part.sourceOffset + part.text.length <= end);
    if (!selected.length || selected.map(part => part.text).join('') !== match[0]) return null;
    parts.push({ ...glyph, id: glyph.id + ':math-part:' + start, text: match[0], rect: union(selected.map(part => part.rect)),
      baseline: selected[0].baseline, baselineX: selected[0].baselineX,
      advanceWidth: selected.at(-1).baselineX + selected.at(-1).advanceWidth - selected[0].baselineX,
      mathGlyphPositions: undefined, splitFrom: glyph.id, sourceRange: [start, end] });
  }
  return parts.map(part => part.text).join('') === plain(glyph.text) ? parts : null;
}

export function hasMixedMathLimit(text) {
  if (typeof text !== 'string' || text.length > 4096) return false;
  const match = namedLimit.exec(text);
  return Boolean(match && match[1] !== text);
}

/** A PDF run such as ") =max" hides the actual limit operator. Split it only
 * with complete native glyph positions. Derived ids remain local to the writer:
 * the original scene, source ledger and AI request identities are unchanged.
 */
export function planMathLimitRuns(region) { return planRuns(region, false); }

/** Composite Unicode-math runs can hide the last letter that owns a script.
 * This uses the same bounded source trace, without normalizing source text.
 */
export function planNativeMathRuns(region) { return planRuns(region, true); }

function planRuns(region, compound) {
  if(region?.sourceAlignedEquation!==undefined)return null;
  const originals = region.mathGlyphs;
  if (!Array.isArray(originals) || !originals.length || originals.length > MAX_MATH_NODES) return null;
  const originalIds = new Set(originals.map(glyph => glyph.id)), derived = new Set(), result = [];
  if (originalIds.size !== originals.length) return null;
  const functionCall = compound && originals.some(glyph => hasNativeMathFunctionRun(glyph.text, glyph.font));
  for (const glyph of originals) {
    const positions = glyph.mathGlyphPositions;
    const eligible = hasMixedMathLimit(glyph.text) || compound
      && (hasCompoundNativeMathRun(glyph.text, glyph.font) || hasLinearNativeMathRun(glyph.text, glyph.font)
        || hasNativeMathFunctionRun(glyph.text, glyph.font))
      && glyph.preciseInk && glyph.raster === false;
    if (!eligible || glyph.raster || glyph.alphabet || glyph.mathStyleUncertain
      || glyph.radicalPart || glyph.delimiterPart || !Array.isArray(positions) || positions.length < 2) {
      result.push(glyph); continue;
    }
    const parts = splitMathRun(glyph, functionCall);
    if (!parts || parts.length + result.length > MAX_MATH_NODES) return null;
    for (const part of parts) {
      if (originalIds.has(part.id) || derived.has(part.id)) return null;
      derived.add(part.id);
    }
    result.push(...parts);
    if (result.length > MAX_MATH_NODES) return null;
  }
  if (!derived.size) return null;
  const shorthand = originals.some(g => g.text === '∫' && /^(?:[A-Z]{6}\+)?XITSMath-Regular$/.test(g.font || ''));
  const prepared = { ...region, mathGlyphs: result, ...(shorthand ? { shorthandSourceRuns: originals } : {}) }, ast = inferMathAst(prepared);
  if (!ast) return null;
  let remaining = MAX_MATH_NODES;
  const proof = node => {
    if (!node || --remaining < 0) return 0;
    const children = Object.values(node).filter(value => value && typeof value === 'object')
      .flatMap(value => Array.isArray(value) ? value : [value]).map(proof);
    const owns = derived.has(node.sourceId) || children.some(value => value & 1);
    const structure = children.some(value => value & 2)
      || node.type === 'limit' && derived.has(node.base?.sourceId)
      || compound && !['symbol', 'row'].includes(node.type) && owns;
    return (owns ? 1 : 0) | (structure ? 2 : 0);
  };
  const evidence = proof(ast);
  return evidence & (compound ? 3 : 2) ? { region: prepared, ast } : null;
}
