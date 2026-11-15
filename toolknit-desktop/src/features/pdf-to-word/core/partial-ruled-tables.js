// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { right, bottom, contains, union, median } from './geometry.js';
import { baselineBands } from './reading-order.js';
import { groupLines, lineText, buildParagraphs } from './text.js';

const numeric = value => /^[+−-]?\d[\d.,]*(?:\/\d[\d.,]*)?(?:[%kKmM])?$/u.test(value.trim());
const center = item => item.rect.x + item.rect.width / 2;

function continuous(rules, top, end) {
  let reached = top;
  for (const rule of [...rules].sort((a, b) => a.from - b.from)) {
    if (rule.from > reached + .6) return false;
    reached = Math.max(reached, rule.to);
  }
  return reached >= end - .6;
}

function paragraphs(items, rect) {
  const lines = baselineBands(groupLines(items)).map(band => {
    if (band.length === 1) return band[0];
    const items = band.flatMap(line => line.items).sort((a, b) => a.rect.x - b.rect.x || a.order - b.order);
    return { ...band[0], items, text: lineText(items), rect: union(items.map(item => item.rect)),
      sourceIds: items.flatMap(item => item.sourceIds) };
  });
  // Small raised glyphs belong to their nearby base, not another text line.
  // Preserve the glyph's own baseline for the positioned run writer.
  for (const line of [...lines]) {
    const candidates = lines.filter(base => base !== line && line.size < base.size * .8
      && line.items.every(item => Math.abs(item.baseline - base.baseline) <= base.size * .6
        && base.items.some(other => item.rect.x >= other.rect.x - .2
          && item.rect.x - right(other.rect) <= base.size * .6)))
      .sort((a, b) => Math.abs(line.baseline - a.baseline) - Math.abs(line.baseline - b.baseline));
    if (!candidates.length || candidates[1]
      && Math.abs(line.baseline - candidates[1].baseline) - Math.abs(line.baseline - candidates[0].baseline) < 1) continue;
    const base = candidates[0];
    base.items = [...base.items, ...line.items].sort((a, b) => a.rect.x - b.rect.x || a.order - b.order);
    base.rect = union(base.items.map(item => item.rect)); base.text = lineText(base.items);
    base.sourceIds = base.items.flatMap(item => item.sourceIds);
    lines.splice(lines.indexOf(line), 1);
  }
  return buildParagraphs(lines, rect).map(block => ({ ...block, align: 'left' }));
}

/** Recover sparse numeric columns only inside a proven, continuously partitioned
 * ruled region. Missing values remain empty; they never shift the next value.
 */
export function partialRuledTable(band, parents, tokens, rules, bounds) {
  const top = band[0].at, headerEnd = band[1].at, end = band.at(-1).at;
  const rect = { x: band[0].from, y: top, width: band[0].to - band[0].from, height: end - top };
  if (band.length < 4 || rect.height < 20 || rect.height > 400 || !contains(bounds, rect)
    || !tokens.length || tokens.length > 4000) return null;
  const vertical = rules.filter(rule => rule.axis === 'v' && rule.at > rect.x + 1
    && rule.at < right(rect) - 1 && rule.to > top && rule.from < end);
  const columns = [];
  for (const rule of vertical) {
    let group = columns.find(group => Math.abs(group[0].at - rule.at) <= .3);
    if (!group) columns.push(group = []);
    group.push(rule);
  }
  if (!columns.length || columns.length > 4 || columns.some(group => !continuous(group, top, end)
    || group.some(rule => rule.from < top - .6 || rule.to > end + .6))) return null;
  const partitions = [rect.x, ...columns.map(group => median(group.map(rule => rule.at))).sort((a, b) => a - b), right(rect)];
  const size = median(tokens.map(item => item.size));
  const numbers = tokens.filter(item => item.rect.y >= headerEnd && numeric(item.text));
  const rows = baselineBands(numbers).map(items => ({ items, baseline: median(items.map(item => item.baseline)) }));
  if (rows.length < 3 || rows.length > 100 || rows.some(row => row.items.length < 2)) return null;
  const reference = [...rows].sort((a, b) => b.items.length - a.items.length || a.baseline - b.baseline)[0];
  const centers = reference.items.map(center).sort((a, b) => a - b), tolerance = Math.max(1, size * .8);
  if (centers.length < 4 || centers.length > 20 || centers.some((at, index) => index && at - centers[index - 1] < size * 1.3)) return null;
  const nearest = item => centers.reduce((best, at, index) => Math.abs(center(item) - at) < Math.abs(center(item) - centers[best]) ? index : best, 0);
  const support = centers.map(() => new Set());
  for (const [rowIndex, row] of rows.entries()) {
    const occupied = new Set();
    for (const item of row.items) {
      const col = nearest(item);
      if (occupied.has(col) || Math.abs(center(item) - centers[col]) > tolerance) return null;
      occupied.add(col); support[col].add(rowIndex);
    }
  }
  if (support.some(rows => rows.size < 2)) return null;
  const labels = tokens.filter(item => right(item.rect) < partitions[1] - .3 && item.rect.y >= headerEnd);
  if (labels.length < 3 || labels.some(item => numeric(item.text))) return null;
  centers.unshift(median(labels.map(center)));
  const xs = [rect.x];
  for (let index = 0; index + 1 < centers.length; index++) {
    const borders = partitions.slice(1, -1).filter(at => at > centers[index] && at < centers[index + 1]);
    if (borders.length > 1) return null;
    xs.push(borders[0] ?? (centers[index] + centers[index + 1]) / 2);
  }
  xs.push(right(rect));
  if (partitions.some(at => !xs.some(x => Math.abs(x - at) < .4))) return null;
  const ys = [top, headerEnd];
  for (let index = 0; index + 1 < rows.length; index++) {
    const before = rows[index], after = rows[index + 1];
    const floor = Math.max(...before.items.map(item => bottom(item.rect))) + .1;
    const ceiling = Math.min(...after.items.map(item => item.rect.y)) - .1;
    if (ceiling <= floor) return null;
    const dividingRule = band.find(rule => rule.at >= floor && rule.at <= ceiling);
    ys.push(dividingRule?.at ?? Math.max(floor, Math.min(ceiling, (before.baseline + after.baseline) / 2 - size * .3)));
  }
  ys.push(end);
  if (ys.some((at, index) => index && at - ys[index - 1] < size)) return null;
  const assignments = new Map(), merged = [];
  const locate = (values, from, to) => values.findIndex((at, index) => index + 1 < values.length && from >= at - .2 && to <= values[index + 1] + .2);
  // Native vertical partitions prove the extent of a prose-only merged cell.
  for (const parent of parents) {
    if (parent.rect.y < headerEnd || parent.text.replace(/\s/gu, '').length < 8
      || !/^[\p{L}\s,.;:()'-]+$/u.test(parent.text) || locate(xs, parent.rect.x, right(parent.rect)) >= 0) continue;
    const partition = locate(partitions, parent.rect.x, right(parent.rect));
    const row = locate(ys, parent.rect.y, bottom(parent.rect));
    if (partition < 0 || row < 1) return null;
    const col = xs.findIndex(x => Math.abs(x - partitions[partition]) < .4);
    const endCol = xs.findIndex(x => Math.abs(x - partitions[partition + 1]) < .4);
    if (col < 0 || endCol <= col) return null;
    const value = { row, col, rowSpan: 1, colSpan: endCol - col };
    merged.push(value);
    for (const item of tokens.filter(item => item.parentId === parent.id)) assignments.set(item, value);
  }
  for (const item of tokens) {
    if (assignments.has(item)) continue;
    const col = locate(xs, item.rect.x, right(item.rect));
    if (col < 0) return null;
    let row = locate(ys, item.rect.y, bottom(item.rect)), rowSpan = 1;
    if (col === 0 && item.rect.y >= headerEnd) {
      const section = locate(band.map(rule => rule.at), item.rect.y, bottom(item.rect));
      if (section < 1) return null;
      const from = ys.findIndex(y => Math.abs(y - band[section].at) < .4);
      const to = ys.findIndex(y => Math.abs(y - band[section + 1].at) < .4);
      if (from < 1 || to <= from) return null;
      row = from; rowSpan = to - from;
      if (rowSpan > 1) {
        const sectionLabels = labels.filter(label => label.rect.y >= band[section].at - .2
          && bottom(label.rect) <= band[section + 1].at + .2);
        if (baselineBands(sectionLabels).length !== 1
          || Math.abs(item.rect.y + item.rect.height / 2 - (band[section].at + band[section + 1].at) / 2) > size * .6) return null;
      }
    }
    if (row < 0) return null;
    const existing = merged.find(cell => row >= cell.row && row < cell.row + cell.rowSpan
      && col >= cell.col && col < cell.col + cell.colSpan);
    if (existing && !(col === 0 && existing.col === 0 && existing.row === row && existing.rowSpan === rowSpan)) return null;
    const value = existing || { row, col, rowSpan, colSpan: 1 };
    if (rowSpan > 1 && !existing) merged.push(value);
    assignments.set(item, value);
  }
  const members = new Map();
  for (const item of tokens) {
    const value = assignments.get(item), key = value.row + ':' + value.col;
    if (!members.has(key)) members.set(key, []);
    members.get(key).push(item);
  }
  const cells = [];
  for (let row = 0; row + 1 < ys.length; row++) for (let col = 0; col + 1 < xs.length; col++) {
    const owner = merged.find(cell => row >= cell.row && row < cell.row + cell.rowSpan
      && col >= cell.col && col < cell.col + cell.colSpan);
    if (owner && (owner.row !== row || owner.col !== col)) continue;
    const cell = owner || { row, col, rowSpan: 1, colSpan: 1 };
    const cellRect = { x: xs[col], y: ys[row], width: xs[col + cell.colSpan] - xs[col], height: ys[row + cell.rowSpan] - ys[row] };
    const items = members.get(row + ':' + col) || [];
    if (items.some(item => !contains(cellRect, item.rect, .2))) return null;
    cells.push({ ...cell, rect: cellRect, sourceIds: items.flatMap(item => item.sourceIds), blocks: paragraphs(items, cellRect) });
  }
  const sourceIds = cells.flatMap(cell => cell.sourceIds);
  if (new Set(sourceIds).size !== sourceIds.length || sourceIds.length !== tokens.flatMap(item => item.sourceIds).length) return null;
  return { id: parents[0].id + ':partial-ruled-table', type: 'table', borderless: true, rect, cells, sourceIds,
    horizontalRules: band, nativeRules: [...band, ...vertical], rows: ys.length - 1,
    columnWidths: xs.slice(1).map((x, index) => x - xs[index]), rowHeights: ys.slice(1).map((y, index) => y - ys[index]) };
}
