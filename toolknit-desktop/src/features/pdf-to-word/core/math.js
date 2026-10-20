// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { bottom, right, union, median, validRect, contains } from './geometry.js';
import { radicalEvidence } from './math-paths.js';
import { validateMathGeometry } from './math-evidence.js';
import { mathIntegralOperator, integralLimitEvidence, integralBodyEvidence, integralDifferential } from './math-integrals.js';
import { validDelimiterGlyph, matrixDelimiterPairs, matrixCells, supportedMatrixShape } from './math-matrices.js';
import { MAX_MATH_DEPTH as MAX_DEPTH, MAX_MATH_NODES as MAX_NODES, mathAtom as atom,
  assembleMathAtoms, bareMathClosing, namedMathLimit, centeredMathLimit, mathNaryOperator, mathGlyphBaseline, mathNaryBody } from './math-rows.js';

const allowed = /^[\p{Script=Latin}\p{Script=Greek}\p{N}\p{Sm}\s()[\]{}|.,'\-\u2026\u2032\u2033\u00b0\u00b7\u00b5\u2308-\u230b]+$/u;
const failure = () => { throw new Error('ambiguous-math'); };
export const validMathStyle = glyph => !glyph.mathStyleUncertain && (!glyph.alphabet
  || ['script', 'doubleStruck'].includes(glyph.alphabet) && !/[a-z]/.test(glyph.text) && !glyph.italic
    && !(glyph.alphabet === 'doubleStruck' && glyph.bold));
const symbol = glyph => ({ type: 'symbol', sourceId: glyph.id, text: glyph.text, italic: Boolean(glyph.italic), bold: Boolean(glyph.bold),
  ...(glyph.alphabet ? { alphabet: glyph.alphabet } : {}) });
const unsupportedIntegral = glyph => /[\u222b-\u2233]/u.test(glyph.text)
  && !mathIntegralOperator({ ...glyph, type: 'symbol' });

/** Geometry-only formula candidates. Uncertain encoding, intersecting ink and
 * unsupported structures remain images; a candidate never rewrites symbols.
 */
export function inferMathAst(region) {
  if (region.role !== 'math' || !region.mathGlyphs?.length || region.reasons?.length) return null;
  const glyphs = region.mathGlyphs, strokes = region.mathStrokes || [];
  if (glyphs.length + strokes.length > MAX_NODES || glyphs.some(glyph => glyph.raster || !validMathStyle(glyph) || unsupportedIntegral(glyph)
    || !allowed.test(glyph.text) && !validDelimiterGlyph(glyph)
    || !validRect(glyph.rect) || !Number.isFinite(glyph.baseline) || !(glyph.size > 0))
    || strokes.some(stroke => stroke.unmapped || !stroke.thin || !validRect(stroke.rect) || stroke.path && !stroke.path.complete)) return null;
  let nodes = 0;
  const spend = count => { if ((nodes += count) > MAX_NODES * 4) failure(); };
  const parse = (items, lines, depth = 0, grid = null) => {
    if (!items.length || depth > MAX_DEPTH) failure();
    spend(items.length + lines.length);
    const size = Math.max(...items.map(item => item.size));
    const remaining = new Set(items), remainingLines = new Set(lines), atoms = [];
    const roots = radicalEvidence(items, lines), matrices = matrixDelimiterPairs(items);
    const underRoot = (root, item) => item.rect.x >= root.barStart[0] - .5 && right(item.rect) <= root.barEnd[0] + .7
      && item.rect.y >= root.barStart[1] + .2 && bottom(item.rect) <= root.valley[1] + size * .35;
    const structures = [...matrices.map(matrix => ({ matrix, width: matrix.rect.width })),
      ...roots.map(root => ({ root, width: root.rect.width })), ...lines.map(line => ({ line, width: line.rect.width }))]
      .sort((a, b) => b.width - a.width);
    // A division bar must have nonempty, wholly separated content on both sides.
    // Outer structures consume their complete evidence before nested parsing.
    for (const { matrix, root, line } of structures) {
      if (matrix) {
        const delimiters = [...matrix.left, ...matrix.right];
        if (!delimiters.every(item => remaining.has(item))) continue;
        const content = [...remaining].filter(item => !delimiters.includes(item) && contains(matrix.content, item.rect, matrix.size * .15));
        const innerLines = [...remainingLines].filter(item => contains(matrix.content, item.rect, .2));
        if (!content.length) continue;
        const rows = parse(content, innerLines, depth + 1, matrix);
        if (!rows) continue;
        for (const member of [...delimiters, ...content]) remaining.delete(member);
        innerLines.forEach(member => remainingLines.delete(member));
        const node = { type: 'matrix', brackets: matrix.kind, leftGlyphIds: matrix.left.map(item => item.id),
          rightGlyphIds: matrix.right.map(item => item.id), rows };
        atoms.push(atom(node, union([matrix.rect, ...content.map(item => item.rect)]), matrix.baseline,
          Math.max(...content.map(item => item.size))));
        continue;
      }
      if (root) {
        if (!root.strokes.every(stroke => remainingLines.has(stroke)) || root.glyphs?.some(glyph => !remaining.has(glyph))) continue;
        const content = [...remaining].filter(item => underRoot(root, item));
        if (!content.length) failure();
        const ownSize = Math.max(...content.map(item => item.size));
        const degree = root.glyphIds ? [] : [...remaining].filter(item => !content.includes(item) && item.size < ownSize * .8
          && item.rect.x >= root.start[0] - root.height * .6 && right(item.rect) <= root.valley[0] + .2
          && bottom(item.rect) < root.start[1] - root.height * .15 && item.rect.y >= root.barStart[1] - root.height * .4);
        if (degree.length > 4) failure();
        if (degree.length && [...remaining].some(item => !degree.includes(item) && !content.includes(item)
          && item.size >= ownSize * .88 && right(item.rect) <= degree[0].rect.x + .3
          && degree[0].rect.x - right(item.rect) < ownSize * .55)) failure();
        const innerLines = [...remainingLines].filter(stroke => !root.strokes.includes(stroke)
          && stroke.rect.x >= root.barStart[0] - .5 && right(stroke.rect) <= root.barEnd[0] + .7
          && stroke.rect.y > root.barStart[1] + .2 && bottom(stroke.rect) <= root.valley[1] + ownSize * .35);
        for (const member of [...content, ...degree, ...(root.glyphs || [])]) remaining.delete(member);
        for (const member of [...root.strokes, ...innerLines]) remainingLines.delete(member);
        const node = { type: 'radical', strokeIds: root.strokeIds, radicand: parse(content, innerLines, depth + 1),
          ...(root.glyphIds ? { glyphIds: root.glyphIds } : {}),
          ...(degree.length ? { degree: parse(degree, [], depth + 1) } : {}) };
        const rect = union([root.rect, ...content.map(item => item.rect), ...degree.map(item => item.rect)]);
        atoms.push({ ...atom(node, rect, median(content.filter(item => item.size >= ownSize * .9).map(item => item.baseline)), ownSize,
          median(content.map(item => item.rect.height))), axis: root.barStart[1] + root.height * .5 });
        continue;
      }
      if (!remainingLines.has(line)) continue;
      const y = line.rect.y + line.rect.height / 2;
      if (line.rect.height > Math.min(1.5, size * .12) || line.rect.width < size * .5) failure();
      const within = [...remaining].filter(item => item.rect.x >= line.rect.x - .7 && right(item.rect) <= right(line.rect) + .7);
      const above = within.filter(item => bottom(item.rect) <= y - .2 && y - bottom(item.rect) < size * 1.8);
      const below = within.filter(item => item.rect.y >= y + .2 && item.rect.y - y < size * 1.8);
      if (!above.length || !below.length) failure();
      const containedRoots = roots.filter(root => root.rect.x >= line.rect.x - .7 && right(root.rect) <= right(line.rect) + .7);
      const rootLines = members => containedRoots.filter(root => {
        const content = items.filter(item => underRoot(root, item));
        return content.length && content.every(item => members.includes(item));
      }).flatMap(root => root.strokes);
      const extraTop = rootLines(above), extraBottom = rootLines(below);
      const numeratorRect = union([...above, ...extraTop].map(item => item.rect)), denominatorRect = union([...below, ...extraBottom].map(item => item.rect));
      if (Math.abs(numeratorRect.x + numeratorRect.width / 2 - line.rect.x - line.rect.width / 2) > size * .4
        || Math.abs(denominatorRect.x + denominatorRect.width / 2 - line.rect.x - line.rect.width / 2) > size * .4) failure();
      const topLines = [...remainingLines].filter(other => other !== line && other.rect.y >= numeratorRect.y && bottom(other.rect) <= bottom(numeratorRect)
        && other.rect.x >= line.rect.x - .7 && right(other.rect) <= right(line.rect) + .7);
      const bottomLines = [...remainingLines].filter(other => other !== line && other.rect.y >= denominatorRect.y && bottom(other.rect) <= bottom(denominatorRect)
        && other.rect.x >= line.rect.x - .7 && right(other.rect) <= right(line.rect) + .7);
      for (const member of [...above, ...below]) remaining.delete(member);
      for (const member of [line, ...topLines, ...bottomLines]) remainingLines.delete(member);
      const node = { type: 'fraction', strokeId: line.id, numerator: parse(above, topLines, depth + 1), denominator: parse(below, bottomLines, depth + 1) };
      const rect = union([numeratorRect, denominatorRect, line.rect]);
      const content = [...above, ...below], ownSize = Math.max(...content.map(item => item.size));
      atoms.push({ ...atom(node, rect, y + ownSize * .25, ownSize, median(content.map(item => item.rect.height))), axis: y });
    }
    if (remainingLines.size) failure();
    for (const glyph of remaining) {
      const node = symbol(glyph);
      atoms.push(atom(node, glyph.rect, mathGlyphBaseline(glyph), glyph.size));
    }
    atoms.sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y);
    for (const fraction of atoms.filter(item => ['fraction', 'radical'].includes(item.node.type))) {
      const neighbours = atoms.filter(item => item.node.type === 'symbol' && item.size >= fraction.size * .88
        && item.size <= fraction.size * 1.25 && item.baseline >= fraction.axis
        && item.baseline <= bottom(fraction.rect) + (fraction.node.type === 'radical' ? fraction.size * .3 : 0));
      if (neighbours.length) fraction.baseline = median(neighbours.map(item => item.baseline));
    }
    if (grid) {
      const cells = matrixCells(atoms, grid);
      const rows = cells?.map(row => row.map(items => assembleMathAtoms(items, { depth: depth + 1, spend })));
      return rows && supportedMatrixShape(rows, grid.kind) ? rows : null;
    }
    return assembleMathAtoms(atoms, { depth, spend });
  };
  try {
    const ast = parse(glyphs, strokes);
    if (!validateMathEvidence(ast, region)) return null;
    return ast;
  } catch { return null; }
}

/** Reject model-supplied text, unknown nodes and any duplicated/missing evidence. */
export function validateMathEvidence(ast, region) {
  if (!region.mathGlyphs?.length || region.mathGlyphs.length + (region.mathStrokes?.length || 0) > MAX_NODES
    || region.mathGlyphs.some(item => !validRect(item.rect) || !(item.size > 0) || !Number.isFinite(item.size)
      || !Number.isFinite(item.baseline) || item.raster || unsupportedIntegral(item))) return false;
  const glyphs = new Map((region.mathGlyphs || []).map(item => [item.id, item]));
  const strokes = new Map((region.mathStrokes || []).map(item => [item.id, item]));
  if (glyphs.size !== region.mathGlyphs.length || strokes.size !== (region.mathStrokes?.length || 0)
    || [...strokes.values()].some(item => !validRect(item.rect) || !item.thin || item.unmapped
      || item.path && !item.path.complete)) return false;
  const roots = radicalEvidence(region.mathGlyphs || [], region.mathStrokes || []), matrices = matrixDelimiterPairs(region.mathGlyphs || []);
  const seen = new Set(), usedStrokes = new Set(), usedIntegrals = new Set(); let count = 0;
  const members = node => node.type === 'symbol' ? [glyphs.get(node.sourceId)]
    : Object.values(node).filter(value => value && typeof value === 'object').flatMap(value =>
      (Array.isArray(value) ? value.filter(child => child && typeof child === 'object') : [value]).flatMap(members));
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > MAX_DEPTH || ++count > MAX_NODES) failure();
    const keys = { symbol: ['type', 'sourceId', 'text', 'italic', 'bold', 'alphabet'], row: ['type', 'children'],
      fraction: ['type', 'strokeId', 'numerator', 'denominator'], script: ['type', 'base', 'subscript', 'superscript'],
      radical: ['type', 'strokeIds', 'glyphIds', 'radicand', 'degree'], limit: ['type', 'base', 'lower', 'upper'],
      nary: ['type', 'operator', 'lower', 'upper', 'body'], integral: ['type', 'operator', 'lower', 'upper', 'body', 'differential'],
      matrix: ['type', 'brackets', 'leftGlyphIds', 'rightGlyphIds', 'rows'] }[node.type];
    if (!keys || Object.keys(node).some(key => !keys.includes(key))) failure();
    if (node.type === 'symbol') {
      const source = glyphs.get(node.sourceId);
      if (!source || source.radicalPart || !validMathStyle(source) || seen.has(node.sourceId) || node.text !== source.text || !allowed.test(node.text)
        || node.italic !== Boolean(source.italic) || node.bold !== Boolean(source.bold) || node.alphabet !== source.alphabet) failure();
      seen.add(node.sourceId);
    } else if (node.type === 'row') {
      if (!Array.isArray(node.children) || node.children.length < 2 || node.children.length > MAX_NODES) failure();
      node.children.forEach(child => visit(child, depth + 1));
    } else if (node.type === 'matrix') {
      const matches = (ids, items) => Array.isArray(ids) && ids.length === items.length && items.every((item, index) => item.id === ids[index]);
      if (!matrices.some(pair => pair.kind === node.brackets && matches(node.leftGlyphIds, pair.left) && matches(node.rightGlyphIds, pair.right))
        || !Array.isArray(node.rows) || node.rows.length < 2 || node.rows.length > 16
        || !Array.isArray(node.rows[0]) || node.rows[0].length < 1 || node.rows[0].length > 16
        || node.rows.length * node.rows[0].length > 128) failure();
      for (const id of [...node.leftGlyphIds, ...node.rightGlyphIds]) { if (seen.has(id)) failure(); seen.add(id); }
      for (const row of node.rows) {
        if (!Array.isArray(row) || row.length !== node.rows[0].length) failure();
        row.forEach(cell => visit(cell, depth + 1));
      }
      if (!supportedMatrixShape(node.rows, node.brackets)) failure();
    } else if (node.type === 'fraction') {
      if (!strokes.has(node.strokeId) || usedStrokes.has(node.strokeId)) failure();
      usedStrokes.add(node.strokeId); visit(node.numerator, depth + 1); visit(node.denominator, depth + 1);
    } else if (node.type === 'radical') {
      if (!Array.isArray(node.strokeIds) || !roots.some(root => root.strokeIds.length === node.strokeIds.length
        && root.strokeIds.every((id, index) => id === node.strokeIds[index])
        && (root.glyphIds ? Array.isArray(node.glyphIds) && root.glyphIds.length === node.glyphIds.length
          && root.glyphIds.every((id, index) => id === node.glyphIds[index]) : node.glyphIds === undefined))) failure();
      if (node.glyphIds) {
        if (node.degree || (count += node.glyphIds.length) > MAX_NODES) failure();
        for (const id of node.glyphIds) { if (!glyphs.has(id) || seen.has(id)) failure(); seen.add(id); }
      }
      for (const id of node.strokeIds) { if (!strokes.has(id) || usedStrokes.has(id)) failure(); usedStrokes.add(id); }
      if (node.degree) visit(node.degree, depth + 1);
      visit(node.radicand, depth + 1);
    } else if (['limit', 'nary', 'integral'].includes(node.type)) {
      const integral = node.type === 'integral', head = node.type === 'limit' ? node.base : node.operator;
      if (!(integral ? mathIntegralOperator(head) : node.type === 'nary' ? mathNaryOperator(head) : namedMathLimit(head))
        || !integral && !node.lower && !node.upper) failure();
      visit(head, depth + 1);
      const base = glyphs.get(head.sourceId);
      for (const [key, upper] of [['lower', false], ['upper', true]]) if (node[key]) {
        visit(node[key], depth + 1);
        if (!(integral ? integralLimitEvidence : centeredMathLimit)(base, members(node[key]), upper)) failure();
      }
      if (node.type === 'nary') { visit(node.body, depth + 1); if (!mathNaryBody(node.body)) failure(); }
      if (integral) {
        usedIntegrals.add(head.sourceId);
        visit(node.body, depth + 1); visit(node.differential, depth + 1);
        if (!integralBodyEvidence(node.body) || !integralDifferential(node.differential)) failure();
      }
    } else {
      if (!node.subscript && !node.superscript || bareMathClosing(node.base)) failure();
      visit(node.base, depth + 1);
      if (node.subscript) visit(node.subscript, depth + 1);
      if (node.superscript) visit(node.superscript, depth + 1);
      if (namedMathLimit(node.base)) {
        const base = glyphs.get(node.base.sourceId);
        if (node.subscript && centeredMathLimit(base, members(node.subscript))
          || node.superscript && centeredMathLimit(base, members(node.superscript), true)) failure();
      }
    }
  };
  try {
    visit(ast);
    return seen.size === glyphs.size && usedStrokes.size === strokes.size
      && [...glyphs.values()].filter(glyph => mathIntegralOperator({ ...glyph, type: 'symbol' })).every(glyph => usedIntegrals.has(glyph.id))
      && validateMathGeometry(ast, glyphs, strokes, roots);
  } catch { return false; }
}

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

export function validateMathAst(ast, region) {
  if (!validateMathEvidence(ast, region)) return false;
  const local = inferMathAst(region);
  return local !== null && JSON.stringify(canonical(ast)) === JSON.stringify(canonical(local));
}
