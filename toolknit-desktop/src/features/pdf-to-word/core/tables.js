// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { contains, intersect, union, right, bottom, median } from './geometry.js';
import { buildParagraphs, groupLines, isOption } from './text.js';

function coordinates(values, tolerance = 1.5) {
  const result = [];
  for (const value of values.sort((a, b) => a - b)) if (!result.length || value - result.at(-1) > tolerance) result.push(value);
  return result;
}
function disjoint(count) {
  const parents = Array.from({ length: count }, (_, i) => i);
  const find = i => { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; };
  return { find, join: (a, b) => { parents[find(a)] = find(b); } };
}
const covers = (lines, at, from, to) => {
  let reached = from;
  for (const line of lines.filter(line => Math.abs(line.at - at) <= 1.5).sort((a, b) => a.from - b.from)) {
    if (line.from > reached + 2) break;
    reached = Math.max(reached, line.to);
    if (reached >= to - 1.5) return true;
  }
  return false;
};

export function tableOwnsStroke(item, table) {
  if (table.borderless) return false;
  const padded = { x: table.rect.x - 1, y: table.rect.y - 1, width: table.rect.width + 2, height: table.rect.height + 2 };
  if (!item.decoration || !item.thin || !contains(padded, item.rect)) return false;
  const xs = [table.rect.x];
  for (const width of table.columnWidths) xs.push(xs.at(-1) + width);
  const ys = [...new Set(table.cells.flatMap(cell => [cell.rect.y, bottom(cell.rect)]))];
  return item.rect.width <= 2 && xs.some(x => Math.abs(item.rect.x + item.rect.width / 2 - x) < 1)
    || item.rect.height <= 2 && ys.some(y => Math.abs(item.rect.y + item.rect.height / 2 - y) < 1);
}

export function ruledTableGrids(rules) {
  const horizontal = rules.filter(line => line.axis === 'h'), vertical = rules.filter(line => line.axis === 'v');
  const all = [...horizontal, ...vertical], groups = disjoint(all.length), buckets = new Map();
  horizontal.forEach((h, i) => vertical.forEach((v, j) => {
    if (v.at >= h.from - 1.5 && v.at <= h.to + 1.5 && h.at >= v.from - 1.5 && h.at <= v.to + 1.5) groups.join(i, horizontal.length + j);
  }));
  all.forEach((line, i) => { const key = groups.find(i); if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(line); });
  const tables = [];
  for (const group of buckets.values()) {
    const h = group.filter(line => line.axis === 'h'), v = group.filter(line => line.axis === 'v');
    const xs = coordinates(v.map(line => line.at)), ys = coordinates(h.map(line => line.at));
    const columns = xs.length - 1, rows = ys.length - 1;
    if (columns < 1 || columns > 32 || rows < 1 || rows > 500 || columns * rows > 5000) continue;
    if (!covers(h, ys[0], xs[0], xs.at(-1)) || !covers(h, ys.at(-1), xs[0], xs.at(-1))
      || !covers(v, xs[0], ys[0], ys.at(-1)) || !covers(v, xs.at(-1), ys[0], ys.at(-1))) continue;
    const cells = disjoint(columns * rows);
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      if (col + 1 < columns && !covers(v, xs[col + 1], ys[row], ys[row + 1])) cells.join(row * columns + col, row * columns + col + 1);
      if (row + 1 < rows && !covers(h, ys[row + 1], xs[col], xs[col + 1])) cells.join(row * columns + col, (row + 1) * columns + col);
    }
    const merged = new Map();
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const key = cells.find(row * columns + col); if (!merged.has(key)) merged.set(key, []); merged.get(key).push([row, col]);
    }
    const rect = { x: xs[0], y: ys[0], width: xs.at(-1) - xs[0], height: ys.at(-1) - ys[0] };
    let invalid = false;
    const outputCells = [...merged.values()].map(members => {
      const row = Math.min(...members.map(pair => pair[0])), col = Math.min(...members.map(pair => pair[1]));
      const rowSpan = Math.max(...members.map(pair => pair[0])) - row + 1, colSpan = Math.max(...members.map(pair => pair[1])) - col + 1;
      if (rowSpan * colSpan !== members.length) invalid = true;
      const cellRect = { x: xs[col], y: ys[row], width: xs[col + colSpan] - xs[col], height: ys[row + rowSpan] - ys[row] };
      return { row, col, rowSpan, colSpan, rect: cellRect };
    });
    if (invalid) continue;
    tables.push({ rect, columnWidths: xs.slice(1).map((x, i) => x - xs[i]),
      rowHeights: ys.slice(1).map((y, i) => y - ys[i]), rows, cells: outputCells });
  }
  return tables;
}

export function ruledTables(lines, rules, grids = ruledTableGrids(rules)) {
  const tables = [];
  const items = lines.flatMap(line => line.items);
  for (const grid of grids) {
    // Borders separate cells even when their text has less than a word gap.
    const candidates = items.filter(item => contains(grid.rect, item.rect, 1));
    if (!candidates.length) continue;
    const cells = grid.cells.map(cell => {
      const members = candidates.filter(item => contains(cell.rect, item.rect, 1));
      return { ...cell, blocks: buildParagraphs(groupLines(members), cell.rect), sourceIds: members.flatMap(item => item.sourceIds) };
    });
    const sourceIds = cells.flatMap(cell => cell.sourceIds);
    if (new Set(sourceIds).size !== sourceIds.length || sourceIds.length !== candidates.flatMap(item => item.sourceIds).length) continue;
    tables.push({ ...grid, id: candidates[0].id + ':table', type: 'table', cells, sourceIds });
  }
  return tables;
}

export function optionGrids(lines, column) {
  const sorted = [...lines].sort((a, b) => a.baseline - b.baseline || a.rect.x - b.rect.x), groups = [];
  let group = [];
  function emit() {
    if (group.length < 2) { group = []; return; }
    const xs = coordinates(group.map(line => line.rect.x), median(group.map(line => line.size)) * 0.8);
    if (xs.length < 2 || xs.length > 4) { group = []; return; }
    const rows = coordinates(group.map(line => line.baseline), 2);
    const rect = union(group.map(line => line.rect));
    const widths = xs.map((x, i) => (xs[i + 1] ?? right(column)) - x);
    const cells = group.map(line => {
      const col = xs.reduce((best, x, i) => Math.abs(x - line.rect.x) < Math.abs(xs[best] - line.rect.x) ? i : best, 0);
      const row = rows.reduce((best, y, i) => Math.abs(y - line.baseline) < Math.abs(rows[best] - line.baseline) ? i : best, 0);
      return { row, col, rowSpan: 1, colSpan: 1, rect: { x: xs[col], y: line.rect.y, width: widths[col], height: line.rect.height }, blocks: buildParagraphs([line], { ...line.rect, width: widths[col] }), sourceIds: line.sourceIds };
    });
    if (new Set(cells.map(cell => `${cell.row}:${cell.col}`)).size === cells.length) groups.push({ id: group[0].id + ':options', type: 'option-grid', rect: { ...rect, width: right(column) - rect.x }, columnWidths: widths, rows: rows.length, cells, sourceIds: group.flatMap(line => line.sourceIds) });
    group = [];
  }
  for (const line of sorted) {
    if (!isOption(line.text)) { emit(); continue; }
    if (group.length && line.baseline - group.at(-1).baseline > line.size * 2.4) emit();
    group.push(line);
  }
  emit(); return groups;
}
