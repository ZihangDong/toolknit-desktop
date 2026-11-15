// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { sourceAlignedEquation } from './source-aligned-equations.js';
import { sourceUpperAttachment } from './source-upper-attachment.js';
import {sourceIndexedSum} from './source-indexed-sum.js';
import { sourceScalarRelation } from './source-scalar-relation.js';
import { sourceNativeUnicodeScalar } from './native-unicode-scalars.js';
import { sourceFirstLevelIndex } from './source-first-level-index.js';
import { sourceShorthandEquation, sourceShorthandNodePresent } from './source-shorthand-integral.js';
import { namedMathLimit, sideMathNaryLimit } from './math-rows.js';
import { validRect } from './geometry.js';
import { mathClassificationText, mathUnicodeRunStyle } from './font-style.js';
import { sourceBlackboardSpace } from './native-blackboard-math.js';
import { sourceNamedIndex, sourceIndexedArithmetic, sourceNativeFunction } from './native-indexed-math.js';
import { rasterMathAstMatches } from './raster-math-evidence.js';
import { sourceShorthandStyleCovered } from './source-shorthand-gamma.js';

const knownFace = /^(?:[A-Z]{6}\+)?(?:Times|Arial|Helvetica|Cambria|CM[A-Z]*\d)/i;
const atomicFace = /^(?:[A-Z]{6}\+)?(?:XITSMath-Regular|TimesNewRomanPSMT|Times-Roman|CM(?:R|MI|SY)\d{1,2}|MSBM\d{1,2})$/i;
const unicodeFace = /^(?:[A-Z]{6}\+)?XITSMath-Regular$/i;
const unicodePeer = /^(?:[A-Z]{6}\+)?(?:TimesNewRomanPSMT|Times-Roman)$/i;

/** Source-traced Unicode math uses the source-baseline frame. This deliberately
 * excludes nested fractions/scripts, accents, roots and unbalanced fragments.
 */
function unicodeSourceMode(ast, region) {
  const sourceProvenUnicodeScalar = sourceNativeUnicodeScalar(region);
  const glyphs = region.mathGlyphs, strokes = region.mathStrokes || [];
  if (region.role !== 'math' || !Array.isArray(glyphs) || !glyphs.length || glyphs.length > 64
    || !glyphs.some(g => unicodeFace.test(g.font || '')) || region.reasons?.length || region.backgroundPaintIndexes?.length
    || !Array.isArray(region.sourceIds) || region.sourceIds.length > 64 || !region.sourceIds.length || strokes.length > 1) return false;
  const sourceIds = new Set(region.sourceIds), ids = new Map(glyphs.map(g => [g.id, g]));
  if (ids.size !== glyphs.length || glyphs.some(g => typeof g.id !== 'string'
    || !g.preciseInk || g.raster !== false || g.ocr || g.alphabet || g.mathStyleUncertain || g.radicalPart || g.delimiterPart
    || g.bold || g.italic || !(g.size >= 4 && g.size <= 40) || !Number.isFinite(g.baseline) || !validRect(g.rect)
    || !/^[0-9a-f]{6}$/i.test(g.color || '') || g.color !== glyphs[0].color
    || !(unicodeFace.test(g.font || '') || unicodePeer.test(g.font || ''))
    || typeof g.text !== 'string' || !g.text || /[\u2308-\u230b]/u.test(g.text)
    || mathClassificationText(g.text)!==g.text&&!mathUnicodeRunStyle(g.text, { sourceProvenUnicodeScalar })
    || !([...g.text].length === 1 || /^\d{1,6}$/u.test(g.text) || namedMathLimit({ type: 'symbol', text: g.text }))
    || !(sourceIds.has(g.id) || sourceIds.has(g.splitFrom) && Array.isArray(g.sourceRange)
      && g.sourceRange.length === 2 && g.sourceRange.every(Number.isSafeInteger)
      && g.sourceRange[0] >= 0 && g.sourceRange[1] > g.sourceRange[0] && g.sourceRange[1] <= 4096))) return false;
  let remaining = 128, fractions = 0, scripts = 0, limits = 0;
  const seen = new Set();
  const flat = node => node?.type === 'symbol' || node?.type === 'row' && Array.isArray(node.children)
    && node.children.length >= 2 && node.children.every(flat);
  const text = node => node?.type === 'symbol' ? node.text : node?.type === 'row' ? node.children.map(text).join('')
    : node?.type === 'script' ? text(node.base) : node?.type === 'limit' ? text(node.base) : '';
  const balanced = node => {
    const stack = [], pairs = { ')': '(', ']': '[', '}': '{' };
    for (const character of text(node)) {
      if ('([{'.includes(character)) stack.push(character);
      else if (Object.hasOwn(pairs, character) && stack.pop() !== pairs[character]) return false;
    }
    return !stack.length;
  };
  const visit = node => {
    if (!node || --remaining < 0) return false;
    if (node.type === 'symbol') {
      const g = ids.get(node.sourceId);
      if (!g || seen.has(g.id) || node.text !== g.text || node.italic !== false || node.bold !== false || node.alphabet) return false;
      seen.add(g.id); return true;
    }
    if (node.type === 'row') return Array.isArray(node.children) && node.children.length >= 2
      && node.children.length <= 64 && node.children.every(visit);
    if (node.type === 'fraction') return ++fractions <= 1 && strokes.length === 1 && strokes[0].id === node.strokeId
      && flat(node.numerator) && flat(node.denominator) && balanced(node.numerator) && balanced(node.denominator)
      && visit(node.numerator) && visit(node.denominator);
    if (node.type === 'limit') return ++limits <= 1 && namedMathLimit(node.base) && (node.lower || node.upper)
      && visit(node.base) && (!node.lower || flat(node.lower) && balanced(node.lower) && visit(node.lower))
      && (!node.upper || flat(node.upper) && balanced(node.upper) && visit(node.upper));
    if (node.type !== 'script' || ++scripts > 4 || !node.subscript && !node.superscript) return false;
    const base = node.base;
    const bracketed = base?.type === 'row' && base.children?.[0]?.text === '(' && base.children?.at(-1)?.text === ')'
      && base.children.every(child => child.type === 'symbol' || child.type === 'fraction');
    return (base?.type === 'symbol' || bracketed) && balanced(base) && visit(base)
      && (!node.subscript || flat(node.subscript) && balanced(node.subscript) && visit(node.subscript))
      && (!node.superscript || flat(node.superscript) && balanced(node.superscript) && visit(node.superscript));
  };
  // Inspect the bounded tree before recursive helpers see any untrusted shape.
  const queue = [ast]; let nodes = 0;
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]; if (!node || typeof node !== 'object' || ++nodes > 64) return false;
    if (!['symbol', 'row', 'script', 'limit', 'fraction'].includes(node.type)) return false;
    if (node.type === 'row' && (!Array.isArray(node.children) || node.children.length < 2 || node.children.length > 64)
      || node.type === 'symbol' && (typeof node.text !== 'string' || node.text.length > 12)) return false;
    for (const value of Object.values(node)) if (value && typeof value === 'object') {
      if (Array.isArray(value)) { if (value.length > 64) return false; queue.push(...value); }
      else queue.push(value);
    }
  }
  return balanced(ast) && visit(ast) && seen.size === ids.size && fractions === strokes.length;
}

/** The complete native exponential ratio has one division bar and a side-
 * indexed sum in its denominator. Other nested structures retain their gate. */
function sourceExponentialRatio(ast, region) {
  const glyphs = region.mathGlyphs, strokes = region.mathStrokes;
  if (ast?.type !== 'row' || !Array.isArray(ast.children) || ast.children.length < 3
    || ast.children.at(-1)?.type !== 'fraction' || ast.children.at(-2)?.type !== 'symbol'
    || !/^[=≠≤≥]$/u.test(ast.children.at(-2).text)
    || region.role !== 'math' || !Array.isArray(glyphs) || glyphs.length < 7 || glyphs.length > 32
    || !Array.isArray(strokes) || strokes.length !== 1 || !strokes[0].thin || strokes[0].unmapped
    || strokes[0].path && !strokes[0].path.complete || !validRect(strokes[0].rect)
    || region.reasons?.length || region.backgroundPaintIndexes?.length
    || !Array.isArray(region.sourceIds) || !region.sourceIds.length || region.sourceIds.length > 64) return false;
  const sources = new Set(region.sourceIds), ids = new Map(glyphs.map(glyph => [glyph.id, glyph]));
  if (ids.size !== glyphs.length || glyphs.some(glyph => typeof glyph.id !== 'string'
    || !glyph.preciseInk || glyph.raster !== false || glyph.ocr || glyph.alphabet || glyph.bold
    || glyph.mathStyleUncertain || glyph.radicalPart || glyph.delimiterPart
    || !validRect(glyph.rect) || !Number.isFinite(glyph.baseline) || !(glyph.size >= 4 && glyph.size <= 40)
    || !/^(?:[A-Z]{6}\+)?CM(?:MI|R|SY|EX)(?:[5-9]|1[012])$/.test(glyph.font || '')
    || typeof glyph.text !== 'string' || [...glyph.text].length !== 1
    || !/^[0-9a-f]{6}$/i.test(glyph.color || '') || glyph.color !== glyphs[0].color
    || !(sources.has(glyph.id) || sources.has(glyph.splitFrom) && Array.isArray(glyph.sourceRange)
      && glyph.sourceRange.length === 2 && glyph.sourceRange.every(Number.isSafeInteger)
      && glyph.sourceRange[0] >= 0 && glyph.sourceRange[1] > glyph.sourceRange[0] && glyph.sourceRange[1] <= 4096))) return false;
  const covered = new Set(glyphs.map(glyph => sources.has(glyph.id) ? glyph.id : glyph.splitFrom));
  if (covered.size !== sources.size) return false;
  const power = node => node?.type === 'script' && node.base?.type === 'symbol' && node.base.text === 'e'
    && node.superscript && !node.subscript;
  const seen = new Set(); let budget = 128, fraction = null, sum = null;
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || --budget < 0 || depth > 8) return false;
    if (node.type === 'symbol') {
      const source = ids.get(node.sourceId);
      if (!source || seen.has(source.id) || node.text !== source.text || node.alphabet
        || node.italic !== Boolean(source.italic) || node.bold !== Boolean(source.bold)) return false;
      seen.add(source.id); return true;
    }
    if (node.type === 'row') return Array.isArray(node.children) && node.children.length >= 2
      && node.children.length <= 32 && node.children.every(child => visit(child, depth + 1));
    if (node.type === 'script') return node.base?.type === 'symbol' && (node.subscript || node.superscript)
      && visit(node.base, depth + 1) && (!node.subscript || visit(node.subscript, depth + 1))
      && (!node.superscript || visit(node.superscript, depth + 1));
    if (node.type === 'fraction') {
      if (fraction || node.strokeId !== strokes[0].id) return false;
      fraction = node;
      return power(node.numerator) && node.denominator?.type === 'nary'
        && visit(node.numerator, depth + 1) && visit(node.denominator, depth + 1);
    }
    if (node.type === 'nary') {
      if (sum || !node.lower || node.upper || !power(node.body)) return false;
      sum = node;
      if (!visit(node.operator, depth + 1) || !visit(node.lower, depth + 1) || !visit(node.body, depth + 1)) return false;
      const lower = node.lower.type === 'row' ? node.lower.children : [node.lower];
      return lower.every(child => child.type === 'symbol')
        && sideMathNaryLimit(ids.get(node.operator.sourceId), lower.map(child => ids.get(child.sourceId)));
    }
    return false;
  };
  return visit(ast) && fraction && sum === fraction.denominator && seen.size === ids.size;
}

/** Reader evidence is narrower than the writer's experimental AST support.
 * Short, first-level scripts and single native literal equations use the source
 * baseline frame. Multi-glyph flat equations use the compact measured frame.
 */
export function nativeMathReaderMode(ast, region) {
  if(region?.sourceAlignedEquation!==undefined)return sourceAlignedEquation(ast,region)?'source-aligned-equation':null;
  if(region?.sourceIndexedSum!==undefined)return sourceIndexedSum(ast,region)?'source-indexed-sum':null;
  if(region?.sourceUpperAttachment!==undefined)return sourceUpperAttachment(ast,region)?'source-upper-attachment':null;
  if(region?.sourceScalarRelation!==undefined)return sourceScalarRelation(ast,region)?'source-scalar-relation':null;
  if (region?.sourceFirstLevelIndex !== undefined) return sourceFirstLevelIndex(ast, region) ? 'xits-first-level-index' : null;
  if (region?.sourceNativeUnicodeScalar !== undefined && !sourceNativeUnicodeScalar(region)) return null;
  if (sourceShorthandNodePresent(ast)) return sourceShorthandEquation(ast, region) && sourceShorthandStyleCovered(region) ? 'xits-shorthand-equation' : null;
  if (region?.rasterMathEvidence !== undefined) return rasterMathAstMatches(ast, region) ? 'ocr-structure' : null;
  const glyphs = region.mathGlyphs;
  // A source-bound scalar has no inferred 2D relationships. Preserve its source
  // baseline frame; the multi-glyph equation frame changes its vertical origin.
  const only = glyphs?.length === 1 ? glyphs[0] : null;
  if (only && ast?.type === 'symbol' && ast.sourceId === only.id && ast.text === only.text
    && typeof only.text === 'string' && [...only.text].length === 1 && /^[\p{Sm}\p{Script=Greek}]$/u.test(only.text)
    && only.preciseInk && only.raster === false && !only.alphabet && !only.mathStyleUncertain
    && !only.radicalPart && !only.delimiterPart && !region.mathStrokes?.length && !region.drawingIds?.length
    && !region.reasons?.length && !region.backgroundPaintIndexes?.length
    && region.sourceIds?.length === 1 && region.sourceIds[0] === only.id
    && atomicFace.test(only.font || '')) return 'atomic';
  if (unicodeSourceMode(ast, region)) return 'unicode';
  if (sourceExponentialRatio(ast, region)) return 'exponential-ratio';
  if (sourceBlackboardSpace(ast, region)) return 'blackboard-space';
  if (sourceNamedIndex(ast, region) || sourceIndexedArithmetic(ast, region) || sourceNativeFunction(ast, region)) return 'script';
  if (!Array.isArray(glyphs) || !glyphs.length || !glyphs.every(glyph => knownFace.test(glyph.font || ''))) return null;
  let remaining = 64;
  const flat = node => --remaining >= 0 && (node?.type === 'symbol'
    || node?.type === 'row' && Array.isArray(node.children) && node.children.length > 0 && node.children.every(flat));
  const text = glyphs.map(glyph => glyph.text).join('');
  // A uniform native ASCII equation needs no invented per-character positions.
  // Its source frame preserves the literal run's trailing blank advance.
  const literal = glyphs.length === 1 && ast?.type === 'symbol' && ast.sourceId === glyphs[0].id
    && glyphs[0].preciseInk && !glyphs[0].raster && !glyphs[0].alphabet && !glyphs[0].italic && !glyphs[0].bold
    && /^(?:[A-Z]{6}\+)?Cambria$/i.test(glyphs[0].font || '') && text.length <= 64 && text.includes('=')
    && /^[A-Za-z0-9]+(?:\s*[=+\-]\s*[A-Za-z0-9]+)+\s*$/u.test(text);
  if (literal) return 'literal';
  if (flat(ast) && glyphs.length >= 3 && /[=<>+×÷−]/u.test(text)) return 'flat';
  // Multi-character PDF runs, nested scripts and scanned glyphs need additional
  // placement evidence. Do not infer support from a successful OMML serialization.
  if (glyphs.length < 2 || glyphs.some(glyph => glyph.raster || glyph.alphabet)) return null;
  remaining = 64;
  let scripts = 0;
  const bases = new Set();
  const simple = node => {
    if (--remaining < 0 || !node) return false;
    if (node.type === 'symbol') return true;
    if (node.type === 'row') return Array.isArray(node.children) && node.children.length > 0 && node.children.every(simple);
    if (node.type !== 'script' || !node.subscript && !node.superscript) return false;
    scripts++;
    if (node.base?.type === 'symbol') bases.add(node.base.sourceId);
    return flat(node.base) && (!node.subscript || flat(node.subscript)) && (!node.superscript || flat(node.superscript));
  };
  if (glyphs.length <= 8 && simple(ast) && scripts > 0 && glyphs.every(glyph => typeof glyph.text === 'string'
    && ([...glyph.text].length === 1 || bases.has(glyph.id) && glyph.preciseInk && glyph.italic && !glyph.bold
      && /^(?:[A-Z]{6}\+)?Cambria-Italic$/i.test(glyph.font || '') && /^[A-Za-z]{2,3}$/.test(glyph.text)))) return 'script';
  if (glyphs.length > 16 || glyphs.some(glyph => typeof glyph.text !== 'string' || glyph.text.length > 12)) return null;
  remaining = 64;
  let limits = 0;
  const limited = node => {
    if (--remaining < 0 || !node) return false;
    if (node.type === 'symbol') return true;
    if (node.type === 'row') return Array.isArray(node.children) && node.children.length > 0 && node.children.every(limited);
    return node.type === 'limit' && ++limits <= 1 && namedMathLimit(node.base) && (node.lower || node.upper)
      && flat(node.base) && (!node.lower || flat(node.lower)) && (!node.upper || flat(node.upper));
  };
  return limited(ast) && limits === 1 ? 'limit' : null;
}
