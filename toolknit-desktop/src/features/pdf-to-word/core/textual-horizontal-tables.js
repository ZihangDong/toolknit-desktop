// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { right, bottom, contains, median, union, validRect } from './geometry.js';
import { baselineBands } from './reading-order.js';
import { completeHorizontalTable } from './indexed-horizontal-tables.js';

const plain = items => items.map(item => item.text).join('').replace(/\s/gu, '');
const center = box => box.x + box.width / 2;

function groupsOf(items, size) {
  const groups = [];
  for (const item of [...items].sort((a,b) => a.rect.x - b.rect.x || a.order - b.order)) {
    let group = groups.at(-1);
    if (group && item.rect.x < right(group.rect) - .3) return null;
    const last = group?.items.at(-1), advance = last && last.baselineX + last.advanceWidth;
    // A full-width comma has little visible ink but still owns its original
    // advance. Its blank side-bearing is not an independent column gutter.
    const end = last && /[，。、；：！？）》」』】）〕］｝,.;:!?]$/u.test(last.text)
      && Number.isFinite(advance) && last.advanceWidth > 0 && last.advanceWidth <= last.rect.width + size * 1.2
      ? Math.max(right(group.rect), advance) : group ? right(group.rect) : 0;
    if (!group || item.rect.x - end > size * .6) groups.push(group = { items: [], rect: item.rect });
    group.items.push(item); group.rect = union(group.items.map(t => t.rect));
  }
  return groups;
}

function aligned(header, rows, size) {
  const tolerance = Math.max(1, size * .35), boxes = [header.rect, ...rows.map(row => row.rect)];
  return boxes.every(b => Math.abs(b.x - median(boxes.map(b => b.x))) <= tolerance)
    || boxes.every(b => Math.abs(center(b) - median(boxes.map(center))) <= tolerance);
}

/** Native text tables can have centred prose instead of numeric columns.
 * Three real rules, independent header cells and repeated body alignment prove
 * the grid. Blank columns need additionally consecutive row-label evidence;
 * unruled lists, scans and arbitrary sparse paragraphs stay on their old path.
 */
export function textualHorizontalTable(band, parents, tokens, rules, bounds) {
  if (band.length !== 3 || tokens.length < 5 || tokens.length > 2000
    || tokens.some(t => t.ocr || t.raster || t.alphabet || t.radicalPart || t.delimiterPart || t.mathStyleUncertain
      || !Number.isFinite(t.baseline + t.size) || !validRect(t.rect) || t.rect.width <= 0 || t.rect.height <= 0 || !t.text?.trim()
      || /[=<>∑√∫±≤≥≠]/u.test(t.text))) return null;
  const [top, separator, end] = band.map(rule => rule.at);
  const rect = { x: band[0].from, y: top, width: band[0].to - band[0].from, height: end - top };
  if (!contains(bounds, rect) || rect.height < 30 || rect.height > 400
    || rules.some(r => r.axis === 'v' && r.at > rect.x + 1 && r.at < right(rect) - 1 && r.to > top && r.from < end)) return null;
  const size = median(tokens.map(t => t.size));
  if (!(size >= 4 && size <= 40)) return null;
  const header = tokens.filter(t => bottom(t.rect) <= separator + .2);
  const body = tokens.filter(t => t.rect.y >= separator - .2);
  if (header.length + body.length !== tokens.length || !header.length || baselineBands(header).length !== 1) return null;
  const heads = groupsOf(header, size);
  if (!heads || heads.length < 2 || heads.length > 8
    || heads.some(h => !/\p{L}/u.test(plain(h.items)) || plain(h.items).length > 80)) return null;

  const main = body.filter(t => t.size >= size * .85), minor = body.filter(t => t.size < size * .85);
  const rows = baselineBands(main).sort((a,b) => median(a.map(t => t.baseline)) - median(b.map(t => t.baseline)))
    .map(items => ({ baseline: median(items.map(t => t.baseline)), items: [...items] }));
  if (rows.length < 3 || rows.length > 40) return null;
  // Raised source footnote markers keep their original baseline. They must
  // uniquely adjoin a real glyph on a principal row, not define another row.
  for (const mark of minor) {
    if (!/^(?:[a-zA-Z]|[†‡*])$/u.test(mark.text) || mark.size < size * .5) return null;
    const owners = rows.filter(row => row.baseline - mark.baseline >= size * .15
      && row.baseline - mark.baseline <= size * .65
      && row.items.some(t => mark.rect.x - right(t.rect) >= -.2 && mark.rect.x - right(t.rect) <= size * .35));
    if (owners.length !== 1) return null;
    owners[0].items.push(mark);
  }
  for (const row of rows) {
    row.groups = groupsOf(row.items, size);
    if (!row.groups || !row.groups.length) return null;
  }
  const full = heads.length === 2 && rows.every(row => row.groups.length === 2
    && row.groups.every(group => /\p{L}/u.test(plain(group.items))));
  let sparse = false;
  if (!full && rows.every(row => row.groups.length === 1)) {
    const labels = rows.map(row => /^([\p{L}]{1,12})([1-9]\d{0,3})([\p{L}]{0,3})$/u.exec(plain(row.groups[0].items)));
    sparse = labels.every(m => m && m[1] === labels[0][1] && m[3] === labels[0][3])
      && labels.every((m,i) => !i || Number(m[2]) === Number(labels[i-1][2]) + 1);
  }
  if (!full && !sparse) return null;
  for (let col = 0; col < (full ? heads.length : 1); col++)
    if (!aligned(heads[col], rows.map(row => row.groups[col]), size)) return null;

  const assigned = heads.flatMap((h,col) => h.items.map(item => ({ item, row: 0, col })));
  rows.forEach((row,i) => row.groups.forEach((group,col) => group.items.forEach(item => assigned.push({ item, row: i + 1, col }))));
  const xs = [rect.x];
  for (let col = 0; col + 1 < heads.length; col++) {
    const left = Math.max(...assigned.filter(a => a.col === col).map(a => right(a.item.rect)));
    const next = Math.min(...assigned.filter(a => a.col === col + 1).map(a => a.item.rect.x));
    if (next - left < size * .5) return null;
    xs.push((left + next) / 2);
  }
  xs.push(right(rect));
  if (xs.some((x,i) => i && x - xs[i-1] < size * 1.5)) return null;
  const table = completeHorizontalTable({ band, parents, tokens, rect, xs, assigned, baselines: rows.map(row => row.baseline), size,
    suffix: sparse ? 'sparse-textual-table' : 'textual-table', allowEmpty: sparse,
    singleLineBaselines: [median(header.map(t => t.baseline)), ...rows.map(row => row.baseline)] });
  // Reuse the existing fillable-cell style and scene budget. A real empty
  // field must not inherit the half-point spacer used for layout-only gaps.
  if (table && sparse) table.emptyForm = true;
  return table;
}
