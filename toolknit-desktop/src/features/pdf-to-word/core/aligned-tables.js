// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { bottom, right, union, median, overlaps, contains, spatialIndex } from './geometry.js';
import { buildParagraphs } from './text.js';
import { baselineBands } from './reading-order.js';

const numeric = value => /^\s*[+\-]?[\p{Sc}]?\d[\d,.'\s]*([.:]\d+)?\s*[%\p{Sc}]?\s*$/u.test(value);
const expand = (rect, padding) => ({ x: rect.x - padding, y: rect.y - padding,
  width: rect.width + 2 * padding, height: rect.height + 2 * padding });

/** Only repeated, separated label/value rows provide evidence of an unruled grid. */
export function alignedTables(lines, excludedRects = [], bounds) {
  const excludedAt = spatialIndex(excludedRects.map(rect => ({ rect })));
  const bands = baselineBands(lines).map(band => band.sort((a, b) => a.rect.x - b.rect.x));
  const tables = [];
  let rows = [];
  const emit = () => {
    const group = rows; rows = [];
    if (group.length < 3 || group.length > 200) return;
    const columns = group[0].length, size = median(group.flat().map(line => line.size));
    if (!(size > 0) || !group.every(row => row.length === columns)) return;
    const data = group.filter(row => row.slice(1).some(line => numeric(line.text)));
    if (data.length < 3 || data.length < group.length - 1
      || data.filter(row => /[\p{L}]{2}/u.test(row[0].text)).length < data.length * .8) return;
    const numericColumns = Array.from({ length: columns - 1 }, (_, index) => index + 1)
      .filter(col => data.filter(row => numeric(row[col].text)).length >= data.length * .8);
    if (!numericColumns.length) return;
    for (let col = 0; col < columns; col++) {
      const lefts = data.map(row => row[col].rect.x), rights = data.map(row => right(row[col].rect));
      if (Math.min(Math.max(...lefts) - Math.min(...lefts), Math.max(...rights) - Math.min(...rights)) > size * .5) return;
    }
    const extent = union(group.flat().map(line => line.rect)), padding = size * .25;
    const xs = [extent.x - padding];
    for (let col = 0; col + 1 < columns; col++) {
      const left = Math.max(...group.map(row => right(row[col].rect)));
      const next = Math.min(...group.map(row => row[col + 1].rect.x));
      if (next - left < size) return;
      xs.push((left + next) / 2);
    }
    xs.push(right(extent) + padding);
    const ys = group.map(row => Math.min(...row.map(line => line.rect.y)) - padding);
    ys.push(Math.max(bottom(extent) + size * .5, ys.at(-1) + size * 1.5));
    if (ys.slice(1).some((y, index) => y - ys[index] < size * 1.2)) return;
    const rect = { x: xs[0], y: ys[0], width: xs.at(-1) - xs[0], height: ys.at(-1) - ys[0] };
    if (rect.x < 0 || rect.y < 0 || bounds && !contains(bounds, rect, 0)) return;
    const guard = expand(rect, size * .7);
    if (excludedAt(guard).some(item => overlaps(guard, item.rect, 0))) return;
    const cells = group.flatMap((row, index) => row.map((line, col) => {
      const cellRect = { x: xs[col], y: ys[index], width: xs[col + 1] - xs[col], height: ys[index + 1] - ys[index] };
      return { row: index, col, rowSpan: 1, colSpan: 1, rect: cellRect,
        blocks: buildParagraphs([line], cellRect), sourceIds: [...line.sourceIds] };
    }));
    tables.push({ id: group[0][0].id + ':aligned-table', type: 'table', borderless: true, rect,
      columnWidths: xs.slice(1).map((x, index) => x - xs[index]), rowHeights: ys.slice(1).map((y, index) => y - ys[index]),
      rows: group.length, cells, sourceIds: cells.flatMap(cell => cell.sourceIds) });
  };
  for (const band of bands) {
    if (band.length < 2 || band.length > 12 || band.some(line => line.items.some(item => item.raster || item.alphabet
      || item.mathStyleUncertain || item.radicalPart || item.delimiterPart))) { emit(); continue; }
    const size = median(band.map(line => line.size));
    if (band.some(line => Math.abs(line.size - size) > size * .2)) { emit(); continue; }
    if (rows.length) {
      const previous = rows.at(-1), gap = median(band.map(line => line.baseline)) - median(previous.map(line => line.baseline));
      if (band.length !== previous.length || gap > size * 3 || gap < size * .9) emit();
    }
    rows.push(band);
  }
  emit(); return tables;
}
