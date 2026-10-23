// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { bottom, right, union, median, contains } from './geometry.js';
import { mathOperatorBaseline, mathGlyphBaseline } from './math-rows.js';
import { matrixDelimiterPairs } from './math-matrices.js';

const reject = () => { throw new Error('math-evidence-position'); };

/** Run only after bounded AST/source validation. Counts alone cannot prove
 * which side of a division bar, radical or baseline owns a symbol. */
export function validateMathGeometry(ast, glyphs, strokes, roots) {
  const visit = node => {
    if (node.type === 'symbol') {
      const glyph = glyphs.get(node.sourceId);
      return { ...glyph, baseline: mathGlyphBaseline(glyph), twoDimensional: false };
    }
    if (node.type === 'row') {
      const children = node.children.map(visit), size = Math.max(...children.map(item => item.size));
      for (let index = 1; index < children.length; index++) {
        if (children[index].rect.x < children[index - 1].rect.x - .7) reject();
      }
      const baseline = median(children.filter(item => item.size >= size * .9).map(item => item.baseline));
      const twoDimensional = children.some(item => item.twoDimensional);
      if (!twoDimensional && children.some(item => Math.abs(item.baseline - baseline) > size * .22)) reject();
      return { rect: union(children.map(item => item.rect)), size, baseline, twoDimensional };
    }
    if (node.type === 'fraction') {
      const numerator = visit(node.numerator), denominator = visit(node.denominator);
      const bar = strokes.get(node.strokeId).rect, axis = bar.y + bar.height / 2;
      const size = Math.max(numerator.size, denominator.size);
      if (bar.height > Math.min(1.5, size * .12) || bar.width < size * .5
        || bottom(numerator.rect) > axis - .2 || denominator.rect.y < axis + .2
        || axis - bottom(numerator.rect) >= size * 1.8 || denominator.rect.y - axis >= size * 1.8) reject();
      for (const item of [numerator, denominator]) {
        if (item.rect.x < bar.x - .7 || right(item.rect) > right(bar) + .7
          || Math.abs(item.rect.x + item.rect.width / 2 - bar.x - bar.width / 2) > size * .4) reject();
      }
      return { rect: union([bar, numerator.rect, denominator.rect]), size, baseline: axis + size * .25, twoDimensional: true };
    }
    if (node.type === 'matrix') {
      const pair = matrixDelimiterPairs([...glyphs.values()]).find(pair => pair.left[0].id === node.leftGlyphIds[0]
        && pair.right[0].id === node.rightGlyphIds[0]);
      if (!pair) reject();
      const rows = node.rows.map(row => row.map(visit)), size = Math.max(...rows.flat().map(cell => cell.size));
      const baselines = rows.map(row => median(row.map(cell => cell.baseline)));
      for (const [index, row] of rows.entries()) {
        if (index && baselines[index] - baselines[index - 1] < size * .65) reject();
        for (const [column, cell] of row.entries()) {
          if (!contains(pair.content, cell.rect, pair.size * .15) || Math.abs(cell.baseline - baselines[index]) > size * .24
            || column && cell.rect.x - right(row[column - 1].rect) <= size * .85) reject();
          const parts = node.rows[index][column].type === 'row' ? node.rows[index][column].children.map(visit) : [cell];
          if (parts.some((part, i) => i && part.rect.x - right(parts[i - 1].rect) > size * .85)) reject();
        }
      }
      for (let column = 0; column < rows[0].length; column++) {
        const centers = rows.map(row => row[column].rect.x + row[column].rect.width / 2), center = median(centers);
        if (centers.some(value => Math.abs(value - center) > size * .55)) reject();
      }
      return { rect: union([pair.rect, ...rows.flat().map(cell => cell.rect)]), size, baseline: pair.baseline, twoDimensional: true };
    }
    if (node.type === 'radical') {
      const root = roots.find(value => value.strokeIds.every((id, index) => id === node.strokeIds[index]));
      if (!root) reject();
      const content = visit(node.radicand), { rect, size } = content;
      if (rect.x < root.barStart[0] - .5 || right(rect) > root.barEnd[0] + .7
        || rect.y < root.barStart[1] + .2 || bottom(rect) > root.valley[1] + size * .35) reject();
      const boxes = [root.rect, rect];
      if (node.degree) {
        const degree = visit(node.degree);
        if (degree.size >= size * .8 || degree.rect.x < root.start[0] - root.height * .6
          || right(degree.rect) > root.valley[0] + .2 || bottom(degree.rect) >= root.start[1] - root.height * .15
          || degree.rect.y < root.barStart[1] - root.height * .4) reject();
        boxes.push(degree.rect);
      }
      return { ...content, rect: union(boxes), twoDimensional: true };
    }
    if (node.type === 'nary' || node.type === 'integral') {
      const operator = visit(node.operator), body = visit(node.body), baseline = mathOperatorBaseline(operator);
      if (body.rect.x < right(operator.rect) - .3 || body.rect.x - right(operator.rect) > operator.size * (node.type === 'integral' ? 1.5 : 1.2)
        || Math.abs(body.baseline - baseline) > operator.size * .3) reject();
      const differential = node.type === 'integral' ? visit(node.differential) : null;
      if (differential && (differential.rect.x < right(body.rect) - .3
        || differential.rect.x - right(body.rect) > operator.size * 1.5 || Math.abs(differential.baseline - baseline) > operator.size * .3)) reject();
      if (differential && [node.lower, node.upper].filter(Boolean).some(limit => right(visit(limit).rect) > body.rect.x + .3)) reject();
      return { ...body, baseline, twoDimensional: true, rect: union([operator.rect, body.rect,
        ...(differential ? [differential.rect] : []), ...(node.lower ? [visit(node.lower).rect] : []), ...(node.upper ? [visit(node.upper).rect] : [])]) };
    }
    const base = visit(node.base), boxes = [base.rect];
    for (const [key, upper] of node.type === 'limit' ? [['lower', false], ['upper', true]]
      : [['subscript', false], ['superscript', true]]) {
      if (!node[key]) continue;
      const child = visit(node[key]); boxes.push(child.rect);
      if (node.type === 'limit') continue; // Centered ownership is checked with the original glyphs.
      const offset = (child.baseline - base.baseline) * (upper ? -1 : 1);
      if (offset <= base.size * .04 || offset > base.size * 2.2
        || child.rect.x < base.rect.x - .7 || child.rect.x - right(base.rect) > base.size * .8) reject();
    }
    return { ...base, rect: union(boxes) };
  };
  try { visit(ast); return true; } catch { return false; }
}
