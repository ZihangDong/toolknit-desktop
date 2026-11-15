// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { right, median, contains, overlaps } from './geometry.js';
import { baselineBands } from './reading-order.js';
import { buildParagraphs } from './text.js';

const center = line => line.rect.x + line.rect.width / 2;
const plain = text => String(text || '').replace(/\s/gu, '');
const sameBox = (a, b) => a && b && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(a[key]) && Math.abs(a[key] - b[key]) < .01);

/** Repeated short, centered native cells below a separate heading. Two-column
 * prose, unknown ink and mere left-alignment are insufficient. A paired half-row
 * center may span two rows only with a complete neighbouring baseline lattice.
 * The normal scene and writer preflights still own collision and fit decisions.
 */
export function centeredTextTables(lines, excludedRects, bounds, sources) {
  if (!Array.isArray(lines) || lines.length > 1600 || !bounds || !Array.isArray(sources)) return [];
  const sourceById = new Map(sources.map(source => [source.id, source]));
  if (sourceById.size !== sources.length) return [];
  const native = line => plain(line.text).length > 0 && plain(line.text).length <= 40
    && !/[。！？!?;；=<>\n\r\t]/u.test(line.text) && Number.isFinite(line.baseline) && line.items?.length
    && line.items.every(item => {
      const source = sourceById.get(item.id);
      return (item.type === 'text' || item.type === undefined) && item.raster === false && item.preciseInk && !item.ocr && !item.italic
        && !item.alphabet && !item.mathGlyphs && !item.mathStyleUncertain && !item.radicalPart && !item.delimiterPart
        && item.sourceIds?.length === 1 && item.sourceIds[0] === item.id && source?.disposition === 'editable'
        && source.text === item.text && sameBox(source.rect, item.rect);
    });
  const bands = baselineBands(lines).map(band => [...band].sort((a, b) => a.rect.x - b.rect.x));
  const tables = []; let rows = [], heading = null;
  function emit() {
    const group = rows; rows = [];
    if (group.length < 3 || group.length > 100 || !heading) return;
    const columns = Math.max(...group.map(row => row.length)), size = median(group.flat().map(line => line.size));
    const full = group.filter(row => row.length === columns);
    if (columns < 3 || full.length < 3 || group[0] !== full[0] || group.at(-1) !== full.at(-1)) return;
    const baselines = group.map(row => median(row.map(line => line.baseline)));
    const anchors = full.map(row => median(row.map(line => line.baseline)));
    const pitch = Math.min(...anchors.slice(1).map((value, i) => value - anchors[i]));
    if (!(size > 0) || heading.size < size * 1.08 || heading.baseline >= baselines[0]
      || baselines[0] - heading.baseline > size * 3.2 || pitch < size * 1.35 || pitch > size * 2.8) return;
    if (group.flat().some(line => !native(line) || Math.abs(line.size - size) > size * .05)
      || group.some(row => Math.max(...row.map(line => line.baseline)) - Math.min(...row.map(line => line.baseline)) > size * .08)) return;
    const centers = Array.from({ length: columns }, (_, col) => median(full.map(row => center(row[col]))));
    const tracks = centers.map(() => []), slots = [];
    const lastRow = (baselines.at(-1) - baselines[0]) / pitch, count = Math.round(lastRow) + 1;
    if (Math.abs(lastRow - Math.round(lastRow)) > .04 || count > 100) return;
    for (const line of group.flat()) {
      const cols = centers.flatMap((x, col) => Math.abs(center(line) - x) <= size * .12 ? [col] : []);
      if (cols.length !== 1) return;
      const col = cols[0], at = (line.baseline - baselines[0]) / pitch, rounded = Math.round(at);
      const half = Math.round(at * 2);
      let row, rowSpan;
      if (Math.abs(at - rounded) <= .04) { row = rounded; rowSpan = 1; }
      else if (half % 2 === 1 && Math.abs(at * 2 - half) <= .04) { row = Math.floor(at); rowSpan = 2; }
      else return;
      if (row < 0 || row + rowSpan > count) return;
      const slot = { line, row, col, rowSpan }; tracks[col].push(slot); slots.push(slot);
    }
    // A dense neighbouring column independently establishes every physical row.
    // Two different columns must share any inferred centered two-row span.
    if (!tracks.some(track => track.length === count && track.every(slot => slot.rowSpan === 1)
      && new Set(track.map(slot => slot.row)).size === count)) return;
    const occupied = new Set();
    for (const slot of slots) {
      for (let row = slot.row; row < slot.row + slot.rowSpan; row++) {
        const key = `${row}:${slot.col}`; if (occupied.has(key)) return; occupied.add(key);
      }
      if (slot.rowSpan > 1 && slots.filter(other => other.row === slot.row && other.rowSpan === slot.rowSpan).length < 2) return;
    }
    let centeredVariation = false;
    const xs = [Math.min(...tracks[0].map(slot => slot.line.rect.x)) - size * .5];
    for (let col = 0; col < columns; col++) {
      const members = tracks[col].map(slot => slot.line), values = members.map(center);
      if (Math.max(...values) - Math.min(...values) > size * .12) return;
      const widths = members.map(line => line.rect.width);
      if (Math.max(...widths) - Math.min(...widths) > size * .7) centeredVariation = true;
      if (col + 1 < columns) {
        const left = Math.max(...members.map(line => right(line.rect)));
        const next = Math.min(...tracks[col + 1].map(slot => slot.line.rect.x));
        if (next - left < size) return;
        xs.push((left + next) / 2);
      } else xs.push(Math.max(...members.map(line => right(line.rect))) + size * .5);
    }
    if (!centeredVariation) return;
    const top = Math.min(...group[0].map(line => line.rect.y)) - size * .45;
    const ys = Array.from({ length: count + 1 }, (_, row) => top + pitch * row);
    const rect = { x: xs[0], y: ys[0], width: xs.at(-1) - xs[0], height: ys.at(-1) - ys[0] };
    const guard = { x: rect.x - 1, y: rect.y - 1, width: rect.width + 2, height: rect.height + 2 };
    if (!contains(bounds, rect, 0) || (excludedRects || []).some(other => overlaps(guard, other, 0))) return;
    const cells = [];
    for (const { line, row, col, rowSpan } of slots) {
      const cellRect = { x: xs[col], y: ys[row], width: xs[col + 1] - xs[col], height: pitch * rowSpan };
      if (!contains(cellRect, line.rect, 0)) return;
      cells.push({ row, col, rowSpan, colSpan: 1, rect: cellRect,
        blocks: buildParagraphs([line], cellRect), sourceIds: [...line.sourceIds] });
    }
    for (let row = 0; row < count; row++) for (let col = 0; col < columns; col++) if (!occupied.has(`${row}:${col}`)) {
      cells.push({ row, col, rowSpan: 1, colSpan: 1,
        rect: { x: xs[col], y: ys[row], width: xs[col + 1] - xs[col], height: pitch }, blocks: [], sourceIds: [] });
    }
    cells.sort((a, b) => a.row - b.row || a.col - b.col);
    const ids = cells.flatMap(cell => cell.sourceIds);
    if (new Set(ids).size !== ids.length) return;
    const members = new Set(group.flat());
    if (lines.some(line => !members.has(line) && overlaps(rect, line.rect, .01))) return;
    tables.push({ id: group[0][0].id + ':centered-table', type: 'table', borderless: true, rect,
      columnWidths: xs.slice(1).map((x, i) => x - xs[i]), rowHeights: Array(count).fill(pitch),
      rows: count, cells, sourceIds: ids, evidence: ['repeated-centered-native-grid', 'separate-heading',
        ...(slots.some(slot => slot.rowSpan > 1) ? ['paired-centered-row-spans'] : [])] });
  }
  for (const band of bands) {
    if (band.length > 6 || band.some(line => !native(line))) {
      emit(); heading = band.length === 1 ? band[0] : null; continue;
    }
    if (rows.length) {
      const gap = median(band.map(line => line.baseline)) - median(rows.at(-1).map(line => line.baseline));
      const size = rows[0][0].size;
      if (gap > size * 2.8 || gap < size * .65 || band.some(line => Math.abs(line.size - size) > size * .05)) {
        emit(); heading = band.length === 1 ? band[0] : null;
        if (band.length < 3) continue;
      }
    }
    if (!rows.length && band.length < 3) { heading = band.length === 1 ? band[0] : null; continue; }
    rows.push(band);
  }
  emit(); return tables;
}
