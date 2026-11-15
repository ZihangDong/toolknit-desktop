// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
// Complete source-proven shorthand evidence and inference; no source-specific identifiers or coordinates.
import { validRect, right, bottom, union } from './geometry.js';
import { mathClassificationText } from './font-style.js';
import { integralLimitEvidence } from './math-integrals.js';
import { centeredMathLimit, mathOperatorBaseline } from './math-rows.js';

export const SHORTHAND_LIMITS = Object.freeze({ glyphs: 96, nodes: 192, depth: 10, calls: 4 });
export const sourceShorthandNodePresent = ast => ast?.type === 'shorthand-integral'
  || ast?.type === 'row' && Array.isArray(ast.children) && ast.children.some(n => n?.type === 'shorthand-integral');
const face = /^(?:[A-Z]{6}\+)?XITSMath-Regular$/;
const relation = /^[=≠≤≥<>]$/u;
const letter = text => /^[\p{Script=Latin}\p{Script=Greek}]$/u.test(mathClassificationText(text));
const scalar = node => node?.type === 'symbol' && letter(node.text);
const symbol = glyph => ({ type: 'symbol', sourceId: glyph.id, text: glyph.text,
  italic: Boolean(glyph.italic), bold: Boolean(glyph.bold) });
const rectNear = (a, b) => ['x', 'y', 'width', 'height'].every(k => Math.abs(a[k] - b[k]) <= .015);
const supportedCharacter = text => {
  if (mathClassificationText(text) === text) return true;
  return /^[\u{1d434}-\u{1d467}\u{1d6e2}-\u{1d71b}\u{1d49c}-\u{1d4b5}ℬℰℱℋℐℒℳℛ]$/u.test(text);
};

function boundedTree(ast) {
  const queue = [{ node: ast, depth: 0 }], seen = new Set();
  for (let i = 0; i < queue.length; i++) {
    const { node, depth } = queue[i];
    if (!node || typeof node !== 'object' || Array.isArray(node) || seen.has(node)
      || depth > SHORTHAND_LIMITS.depth || seen.size >= SHORTHAND_LIMITS.nodes) return null;
    seen.add(node);
    const keys = { symbol: ['type', 'sourceId', 'text', 'italic', 'bold'], row: ['type', 'children'],
      fraction: ['type', 'strokeId', 'numerator', 'denominator'], script: ['type', 'base', 'subscript'],
      'shorthand-integral': ['type', 'operator', 'lower', 'body'], nary: ['type', 'operator', 'lower', 'upper', 'body'] }[node.type];
    if (!keys || Object.keys(node).some(k => !keys.includes(k))) return null;
    if (node.type === 'symbol') {
      if (typeof node.sourceId !== 'string' || typeof node.text !== 'string' || [...node.text].length !== 1) return null;
    } else {
      const required = { row: ['children'], fraction: ['numerator', 'denominator'], script: ['base', 'subscript'],
        'shorthand-integral': ['operator', 'lower', 'body'], nary: ['operator', 'lower', 'upper', 'body'] }[node.type];
      if (required.some(k => !node[k] || typeof node[k] !== 'object')) return null;
      for (const [key, value] of Object.entries(node)) {
      if (key === 'children') {
        if (!Array.isArray(value) || value.length < 2 || value.length > SHORTHAND_LIMITS.glyphs) return null;
        queue.push(...value.map(child => ({ node: child, depth: depth + 1 })));
      } else if (value && typeof value === 'object') queue.push({ node: value, depth: depth + 1 });
      }
    }
  }
  return [...seen];
}

/** Source identity includes the exact subset-qualified face, native ink, style,
 * complete original run slices and unique source coverage; a flag alone is not proof. */
function sourceProof(region) {
  const glyphs = region?.mathGlyphs, strokes = region?.mathStrokes;
  if (region?.role !== 'math' || !Array.isArray(glyphs) || glyphs.length < 12 || glyphs.length > SHORTHAND_LIMITS.glyphs
    || !Array.isArray(strokes) || strokes.length !== 1 || region.reasons?.length || region.backgroundPaintIndexes?.length
    || region.rasterMathEvidence !== undefined || region.ocrMath || !Array.isArray(region.sourceIds)
    || !region.sourceIds.length || region.sourceIds.length > SHORTHAND_LIMITS.glyphs
    || region.sourceIds.some(id => typeof id !== 'string' || !id || id.length > 256)
    || new Set(region.sourceIds).size !== region.sourceIds.length) return null;
  const ids = new Map(), sources = new Set(region.sourceIds), claims = new Map();
  const originals = region.shorthandSourceRuns;
  if (originals !== undefined && (!Array.isArray(originals) || originals.length > SHORTHAND_LIMITS.glyphs
    || originals.some(g => !g || typeof g.id !== 'string' || typeof g.text !== 'string' || g.text.length > 4096)
    || originals.reduce((n, g) => n + g.text.length, 0) > 4096
    || new Set(originals.map(g => g.id)).size !== originals.length)) return null;
  const raw = new Map((originals || []).map(g => [g.id, g]));
  const font = glyphs[0]?.font, color = glyphs[0]?.color;
  if (!face.test(font || '') || !/^[0-9a-f]{6}$/i.test(color || '')) return null;
  for (const g of glyphs) {
    if (!g || typeof g.id !== 'string' || ids.has(g.id) || !g.preciseInk || g.raster !== false || g.ocr
      || g.alphabet || g.mathStyleUncertain || g.radicalPart || g.delimiterPart || g.bold || g.italic
      || g.font !== font || g.color !== color || !validRect(g.rect) || !(g.rect.width > 0 && g.rect.height > 0)
      || !Number.isFinite(g.baseline) || !(g.size >= 4 && g.size <= 40)
      || typeof g.text !== 'string' || [...g.text].length !== 1 || !supportedCharacter(g.text)) return null;
    ids.set(g.id, g);
    const parent = g.splitFrom || g.id;
    if (!sources.has(parent)) return null;
    if (!claims.has(parent)) claims.set(parent, []);
    claims.get(parent).push(g);
    if (!g.splitFrom && raw.size) {
      const original = raw.get(g.id);
      if (!original || original.text !== g.text || original.font !== g.font || original.color !== g.color
        || original.italic !== g.italic || original.bold !== g.bold || !rectNear(original.rect, g.rect)
        || Math.abs(original.baseline - g.baseline) > .01 || Math.abs(original.size - g.size) > .01) return null;
    }
    if (g.splitFrom) {
      const original = raw.get(parent), range = g.sourceRange;
      if (!original || !original.preciseInk || original.raster !== false || original.font !== font || original.color !== color
        || original.bold || original.italic || original.alphabet || original.mathStyleUncertain
        || !Array.isArray(range) || range.length !== 2 || !range.every(Number.isSafeInteger)
        || range[0] < 0 || range[1] <= range[0] || range[1] > 4096
        || original.text?.slice(range[0], range[1]) !== g.text || Math.abs(g.size - original.size) > .01
        || Math.abs(g.baseline - original.baseline) > .01 || !Array.isArray(original.mathGlyphPositions)
        || original.mathGlyphPositions.length > 200) return null;
      const pieces = original.mathGlyphPositions.filter(p => p.sourceOffset >= range[0]
        && p.sourceOffset + p.text.length <= range[1]);
      if (!pieces.length || pieces.map(p => p.text).join('') !== g.text
        || pieces.some(p => !validRect(p.rect) || !Number.isSafeInteger(p.sourceOffset)
          || original.text.slice(p.sourceOffset, p.sourceOffset + p.text.length) !== p.text)
        || !rectNear(g.rect, union(pieces.map(p => p.rect)))) return null;
    }
  }
  if (claims.size !== sources.size || raw.size && (raw.size !== sources.size || [...raw.keys()].some(id => !sources.has(id)))) return null;
  for (const [id, leaves] of claims) {
    if (leaves.some(g => !g.splitFrom)) { if (leaves.length !== 1) return null; continue; }
    const original = raw.get(id), ordered = [...leaves].sort((a, b) => a.sourceRange[0] - b.sourceRange[0]);
    if (ordered.some((g, i) => i && g.sourceRange[0] < ordered[i - 1].sourceRange[1])
      || ordered.map(g => g.text).join('') !== original.text.replace(/\s/gu, '')) return null;
    for (let i = 0; i < original.text.length; i++) if (!/\s/u.test(original.text[i])
      && !ordered.some(g => i >= g.sourceRange[0] && i < g.sourceRange[1])) return null;
  }
  const stroke = strokes[0];
  if (!stroke || typeof stroke.id !== 'string' || ids.has(stroke.id) || !stroke.thin || stroke.unmapped || !validRect(stroke.rect)
    || stroke.color !== color || !stroke.path || !stroke.path.complete || stroke.path.paint !== 'stroke'
    || !Array.isArray(stroke.path.from) || !Array.isArray(stroke.path.to)
    || stroke.path.from.length !== 2 || stroke.path.to.length !== 2
    || ![...stroke.path.from, ...stroke.path.to].every(Number.isFinite)
    || Math.abs(stroke.path.from[1] - stroke.path.to[1]) > .05
    || stroke.path.to[0] <= stroke.path.from[0] || stroke.path.color !== color) return null;
  if (region.drawingIds && (!Array.isArray(region.drawingIds) || region.drawingIds.length !== 1 || region.drawingIds[0] !== stroke.id)) return null;
  return { ids, stroke };
}

function flatten(node, output = []) {
  if (node.type === 'row') node.children.forEach(child => flatten(child, output)); else output.push(node);
  return output;
}
const indexed = (node, index) => node?.type === 'script' && scalar(node.base) && scalar(node.subscript)
  && !node.superscript && node.subscript.text === index;
const lowerIndex = node => {
  const nodes = flatten(node);
  return nodes.length === 3 && scalar(nodes[0]) && nodes[1]?.type === 'symbol' && nodes[1].text === '='
    && nodes[2]?.type === 'symbol' && /^[0-9]$/u.test(nodes[2].text) ? nodes[0].text : null;
};

/** A bounded product of complete binary scalar function calls. Each indexed
 * argument belongs to the sum's dummy index; neither punctuation nor prose is inferred. */
export function sourceShorthandSumBody(node, lower) {
  if (!boundedTree(node) || !boundedTree(lower)) return false;
  const index = lowerIndex(lower), nodes = flatten(node);
  if (!index || !nodes.length || nodes.length > SHORTHAND_LIMITS.calls * 7) return false;
  let at = 0, calls = 0;
  while (at < nodes.length) {
    const [name, open, first, separator, second, close] = nodes.slice(at, at + 6);
    if (++calls > SHORTHAND_LIMITS.calls || !scalar(name) || open?.text !== '(' || !scalar(first)
      || separator?.type !== 'symbol' || !/^[,;]$/.test(separator.text) || !indexed(second, index) || close?.text !== ')') return false;
    at += 6;
  }
  return at === nodes.length;
}

/** A separate node: one path label and one scalar body, no differential property. */
export function shorthandIntegralNodeEvidence(node, glyphs) {
  if (node?.type !== 'shorthand-integral' || Object.keys(node).some(k => !['type', 'operator', 'lower', 'body'].includes(k))
    || node.operator?.type !== 'symbol' || node.operator.text !== '∫' || !scalar(node.lower) || !scalar(node.body)) return false;
  const operator = glyphs.get(node.operator.sourceId), lower = glyphs.get(node.lower.sourceId), body = glyphs.get(node.body.sourceId);
  if (!operator || !lower || !body || !integralLimitEvidence(operator, [lower]) || lower.size >= operator.size * .85
    || !face.test(operator.font || '') || lower.font !== operator.font || body.font !== operator.font) return false;
  const baseline = mathOperatorBaseline(operator);
  return body.rect.x >= right(operator.rect) - .3 && body.rect.x - right(operator.rect) <= operator.size * 1.5
    && right(lower.rect) <= body.rect.x + .3 && Math.abs(body.baseline - baseline) <= operator.size * .12;
}

function coefficientGeometry(node, ids, stroke) {
  const top = flatten(node.numerator).map(n => ids.get(n.sourceId)), low = flatten(node.denominator).map(n => ids.get(n.sourceId));
  const axis = stroke.rect.y + stroke.rect.height / 2, size = Math.max(...[...top, ...low].map(g => g.size));
  if (stroke.rect.height > Math.min(1.5, size * .12) || stroke.rect.width < size * .5) return false;
  for (const [members, above] of [[top, true], [low, false]]) {
    const rect = union(members.map(g => g.rect)), baseline = members[0].baseline;
    if (members.some(g => Math.abs(g.baseline - baseline) > size * .08 || Math.abs(g.size - members[0].size) > .05)
      || rect.x < stroke.rect.x - .7 || right(rect) > right(stroke.rect) + .7
      || Math.abs(rect.x + rect.width / 2 - stroke.rect.x - stroke.rect.width / 2) > size * .4
      || (above ? bottom(rect) > axis - .2 || axis - bottom(rect) >= size * 1.8
        : rect.y < axis + .2 || rect.y - axis >= size * 1.8)) return false;
  }
  return true;
}

function coefficient(node) {
  if (node?.type !== 'fraction') return false;
  return [node.numerator, node.denominator].every(value => {
    const parts = flatten(value);
    return parts.length >= 1 && parts.length <= 8 && parts.every(n => n.type === 'symbol'
      && (letter(n.text) || /^[0-9·]$/u.test(n.text)));
  });
}

/** Complete class gate, shared by parser validation and reader admission.
 * This proves source roles and geometry only. It is NOT reader visual evidence. */
export function sourceShorthandEquation(ast, region) {
  const nodes = boundedTree(ast), proof = sourceProof(region);
  if (!nodes || !proof || ast.type !== 'row' || ![4, 5].includes(ast.children.length)) return false;
  const [factor, integral, equals, sum, stop] = ast.children;
  if (!coefficient(factor) || !shorthandIntegralNodeEvidence(integral, proof.ids)
    || equals?.type !== 'symbol' || !relation.test(equals.text) || sum?.type !== 'nary'
    || sum.operator?.type !== 'symbol' || sum.operator.text !== '∑' || !sum.lower || !sum.upper
    || !(scalar(sum.upper) || sum.upper.type === 'symbol' && /^[0-9]$/.test(sum.upper.text))
    || !sourceShorthandSumBody(sum.body, sum.lower) || stop && (stop.type !== 'symbol' || !/^[.,]$/.test(stop.text))) return false;
  const leaves = nodes.filter(n => n.type === 'symbol'), seen = new Set();
  for (const leaf of leaves) {
    const g = proof.ids.get(leaf.sourceId);
    if (!g || seen.has(g.id) || leaf.text !== g.text || leaf.bold !== false || leaf.italic !== false) return false;
    seen.add(g.id);
  }
  if (seen.size !== proof.ids.size || nodes.filter(n => n.type === 'shorthand-integral').length !== 1
    || nodes.filter(n => n.type === 'nary').length !== 1 || nodes.filter(n => n.type === 'fraction').length !== 1
    || factor.strokeId !== proof.stroke.id || leaves.filter(n => n.text === '∫').length !== 1
    || leaves.filter(n => n.text === '∑').length !== 1) return false;
  if (!coefficientGeometry(factor, proof.ids, proof.stroke)) return false;
  const operator = proof.ids.get(integral.operator.sourceId), sigma = proof.ids.get(sum.operator.sourceId);
  const eq = proof.ids.get(equals.sourceId), baseline = mathOperatorBaseline(operator), mainSize = operator.size;
  const lower = flatten(sum.lower).map(n => proof.ids.get(n.sourceId)), upper = flatten(sum.upper).map(n => proof.ids.get(n.sourceId));
  if (!centeredMathLimit(sigma, lower) || !centeredMathLimit(sigma, upper, true)
    || Math.abs(mathOperatorBaseline(sigma) - baseline) > mainSize * .12
    || Math.abs(eq.baseline - baseline) > mainSize * .12 || Math.abs(eq.size - mainSize) > .05
    || right(proof.stroke.rect) > operator.rect.x + .3 || operator.rect.x - right(proof.stroke.rect) > mainSize
    || proof.ids.get(integral.body.sourceId).rect.x >= eq.rect.x || eq.rect.x >= sigma.rect.x
    || sigma.rect.x - right(eq.rect) > mainSize * 1.5) return false;
  const bodyLeaves = flatten(sum.body).flatMap(n => n.type === 'script' ? [n.base, n.subscript] : [n]);
  const bodyGlyphs = bodyLeaves.map(n => proof.ids.get(n.sourceId));
  const start = Math.min(...bodyGlyphs.map(g => g.rect.x));
  if (start < right(sigma.rect) - .3 || start - right(sigma.rect) > mainSize * 1.2
    || [...lower, ...upper].some(g => right(g.rect) > start + .3)) return false;
  const main = flatten(sum.body).map(n => proof.ids.get(n.type === 'script' ? n.base.sourceId : n.sourceId));
  if (main.some((g, i) => Math.abs(g.baseline - baseline) > mainSize * .12 || Math.abs(g.size - mainSize) > .05
    || i && (g.rect.x < main[i - 1].rect.x - .3 || g.rect.x - right(main[i - 1].rect) > mainSize * 1.6))) return false;
  for (const script of nodes.filter(n => n.type === 'script')) {
    const base = proof.ids.get(script.base.sourceId), small = proof.ids.get(script.subscript.sourceId);
    const owners = [...proof.ids.values()].filter(g => letter(g.text) && small.size >= g.size * .45 && small.size < g.size * .85
      && small.baseline - g.baseline > g.size * .06 && small.baseline - g.baseline < g.size * .7
      && small.rect.x >= g.rect.x + g.rect.width * .4 && small.rect.x <= right(g.rect) + g.size * .65);
    if (owners.length !== 1 || owners[0] !== base) return false;
  }
  if (stop) {
    const punctuation = proof.ids.get(stop.sourceId), last = bodyGlyphs.sort((a, b) => right(b.rect) - right(a.rect))[0];
    if (punctuation.rect.x < right(last.rect) - .3 || punctuation.rect.x - right(last.rect) > mainSize * .6
      || Math.abs(punctuation.baseline - baseline) > mainSize * .12) return false;
  }
  return true;
}

export function inferSourceShorthandEquation(region, parse) {
  const proof = sourceProof(region);
  if (!proof || typeof parse !== 'function') return null;
  const glyphs = [...proof.ids.values()], integrals = glyphs.filter(g => g.text === '∫'), sums = glyphs.filter(g => g.text === '∑');
  if (integrals.length !== 1 || sums.length !== 1) return null;
  const operator = integrals[0], sigma = sums[0], baseline = mathOperatorBaseline(operator);
  const relations = glyphs.filter(g => relation.test(g.text) && Math.abs(g.baseline - baseline) <= operator.size * .12);
  if (relations.length !== 1) return null;
  const equals = relations[0], body = glyphs.filter(g => g.rect.x > right(operator.rect) - .3
    && right(g.rect) < equals.rect.x && Math.abs(g.baseline - baseline) <= operator.size * .12 && letter(g.text));
  if (body.length !== 1) return null;
  const path = glyphs.filter(g => right(g.rect) <= body[0].rect.x + .3 && integralLimitEvidence(operator, [g]));
  if (path.length !== 1) return null;
  const small = glyphs.filter(g => g !== sigma && g.rect.x > equals.rect.x);
  // Individual letters need not sit at the operator's center. Collect the
  // existing physical limit band, then prove the complete band's center.
  const band = (g, above) => g.size < sigma.size * .88 && g.size >= sigma.size * .35
    && g.rect.x >= sigma.rect.x - sigma.size * .75 && right(g.rect) <= right(sigma.rect) + sigma.size * .75
    && (above ? bottom(g.rect) < sigma.rect.y - sigma.size * .04 && sigma.rect.y - bottom(g.rect) < sigma.size * 1.5
      : g.rect.y > bottom(sigma.rect) + sigma.size * .04 && g.rect.y - bottom(sigma.rect) < sigma.size * 1.5);
  const lower = small.filter(g => band(g, false)), upper = small.filter(g => band(g, true));
  if (!centeredMathLimit(sigma, lower) || upper.length !== 1 || !centeredMathLimit(sigma, upper, true)
    || lower.some(g => upper.includes(g))) return null;
  const excluded = new Set([operator, sigma, equals, body[0], path[0], ...lower, ...upper]);
  const prefix = glyphs.filter(g => !excluded.has(g) && right(g.rect) <= operator.rect.x + .3);
  const rest = glyphs.filter(g => !excluded.has(g) && !prefix.includes(g)).sort((a, b) => a.rect.x - b.rect.x);
  const stop = /^[.,]$/.test(rest.at(-1)?.text || '') ? rest.pop() : null;
  const part = (members, strokes = []) => parse({ role: 'math', mathGlyphs: members, mathStrokes: strokes, reasons: [] });
  const factor = part(prefix, [proof.stroke]), low = part(lower), up = part(upper), sumBody = part(rest);
  if (!factor || !low || !up || !sumBody) return null;
  const ast = { type: 'row', children: [factor, { type: 'shorthand-integral', operator: symbol(operator), lower: symbol(path[0]), body: symbol(body[0]) },
    symbol(equals), { type: 'nary', operator: symbol(sigma), lower: low, upper: up, body: sumBody }, ...(stop ? [symbol(stop)] : [])] };
  return sourceShorthandEquation(ast, region) ? ast : null;
}
