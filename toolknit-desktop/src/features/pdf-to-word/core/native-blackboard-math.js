// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { validRect, right } from './geometry.js';
import { validateMathAst } from './math.js';

const face = family => new RegExp(`^(?:[A-Z]{6}\\+)?${family}(?:[5-9]|1[012])$`);
const italicFace = face('CMMI'), symbolFace = face('CMSY'), blackboardFace = face('MSBM');

/** Reader-proven native real-space powers, optionally with a membership prefix.
 * The bounded shape check precedes the generic source/geometry validator. A
 * power on its own remains a component; it does not prove a complete equation.
 */
export function sourceBlackboardSpace(ast, region) {
  const glyphs = region.mathGlyphs, sources = region.sourceIds;
  if (region.role !== 'math' || !Array.isArray(glyphs) || glyphs.length < 2 || glyphs.length > 7
    || !Array.isArray(sources) || sources.length !== glyphs.length || new Set(sources).size !== sources.length
    || region.mathStrokes?.length || region.drawingIds?.length || region.reasons?.length
    || region.backgroundPaintIndexes?.length) return false;
  const ids = new Map(glyphs.map(g => [g.id, g]));
  if (ids.size !== glyphs.length || glyphs.some(g => typeof g.id !== 'string' || !sources.includes(g.id)
    || !g.preciseInk || g.raster !== false || g.ocr || g.mathStyleUncertain || g.radicalPart || g.delimiterPart
    || g.bold || !(g.size >= 4 && g.size <= 40) || !Number.isFinite(g.baseline) || !validRect(g.rect)
    || !/^[0-9a-f]{6}$/i.test(g.color || '') || g.color !== glyphs[0].color)) return false;
  const seen = new Set();
  const take = (node, pattern, font, italic, alphabet) => {
    if (node?.type !== 'symbol' || !pattern.test(node.text)) return null;
    const g = ids.get(node.sourceId);
    if (!g || seen.has(g.id) || !font.test(g.font || '') || g.text !== node.text
      || g.italic !== italic || g.alphabet !== alphabet) return null;
    seen.add(g.id); return g;
  };
  const letter = (node, pattern = /^[A-Z]$/) => take(node, pattern, italicFace, true, undefined);
  const membership = ast?.type === 'row' && Array.isArray(ast.children) && ast.children.length === 3;
  const power = membership ? ast.children[2] : ast;
  if (power?.type !== 'script' || power.subscript || !power.superscript) return false;
  const base = take(power.base, /^R$/, blackboardFace, false, 'doubleStruck');
  if (!base) return false;
  const dimension = power.superscript;
  let dimensions;
  if (dimension.type === 'row') {
    if (!Array.isArray(dimension.children) || dimension.children.length !== 3) return false;
    dimensions = [letter(dimension.children[0]), take(dimension.children[1], /^×$/, symbolFace, false, undefined),
      letter(dimension.children[2])];
  } else dimensions = [letter(dimension)];
  if (dimensions.some(g => !g)) return false;
  const first = dimensions[0];
  if (first.size < base.size * .55 || first.size > base.size * .82
    || first.baseline > base.baseline - base.size * .12 || first.baseline < base.baseline - base.size * .6
    || dimensions.some(g => Math.abs(g.size - first.size) > .05 || Math.abs(g.baseline - first.baseline) > .1)) return false;
  if (membership) {
    const [variable, relation] = ast.children;
    const indexed = variable?.type === 'script';
    const variableBase = letter(indexed ? variable.base : variable);
    const relationGlyph = take(relation, /^∈$/, symbolFace, false, undefined);
    if (!variableBase || !relationGlyph || indexed && (variable.superscript || !variable.subscript)) return false;
    if (indexed) {
      const sub = letter(variable.subscript, /^[a-z]$/);
      if (!sub || sub.size < variableBase.size * .55 || sub.size > variableBase.size * .82
        || sub.baseline < variableBase.baseline + variableBase.size * .08
        || sub.baseline > variableBase.baseline + variableBase.size * .5) return false;
    }
    if ([variableBase, relationGlyph].some(g => Math.abs(g.size - base.size) > .05 || Math.abs(g.baseline - base.baseline) > .1)
      || variableBase.rect.x >= relationGlyph.rect.x || relationGlyph.rect.x >= base.rect.x
      || relationGlyph.rect.x - right(variableBase.rect) > base.size * 1.5
      || base.rect.x - right(relationGlyph.rect) > base.size * 1.5) return false;
  }
  return seen.size === ids.size && validateMathAst(ast, region);
}
