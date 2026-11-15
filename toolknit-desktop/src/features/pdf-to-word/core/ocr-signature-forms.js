// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { contains, overlaps, right, bottom, validRect, median } from './geometry.js';
import { baselineBands } from './reading-order.js';

const signatureLabel = value => value.length <= 32 && /(?:盖章|签字|签名|签章)/u.test(value)
  && /^[\p{L}\p{N}\s（）().:_：-]+$/u.test(value);

/** Two signature/date compartments may have open outer sides. The complete
 * divider, both horizontal ends and mirrored label/date rows prove this narrow
 * form layout. Keep all original borders in the raster backdrop: inferred outer
 * edges are logical cell boundaries, never new visible strokes.
 */
export function ocrSignatureFormGrids(text, rules, bounds) {
  if (!Array.isArray(text) || text.length > 20_000 || !Array.isArray(rules) || rules.length > 3000
    || !validRect(bounds)) return [];
  const lines = rules.filter(r => r && ['h', 'v'].includes(r.axis)
    && [r.at, r.from, r.to].every(Number.isFinite) && r.to > r.from);
  const dividers = lines.filter(r => r.axis === 'v' && r.to - r.from >= 50 && r.to - r.from <= 220);
  if (dividers.length > 64) return [];
  const result = []; let budget = 100_000;
  for (const divider of dividers) {
    const across = lines.filter(r => r.axis === 'h' && r.from < divider.at - 60 && r.to > divider.at + 60);
    const at = y => across.filter(r => Math.abs(r.at - y) <= 1.5).sort((a, b) => b.to - b.from - (a.to - a.from))[0];
    const top = at(divider.from), end = at(divider.to);
    if (!top || !end || end.at - top.at < 50 || end.at - top.at > 220
      || Math.abs(top.from - end.from) > 12 || Math.abs(top.to - end.to) > 12) continue;
    const rect = { x: Math.min(top.from, end.from), y: top.at,
      width: Math.max(top.to, end.to) - Math.min(top.from, end.from), height: end.at - top.at };
    if (rect.width < 160 || rect.width > 650 || !contains(bounds, rect)
      || result.some(grid => overlaps(grid.rect, rect))) continue;
    const splits = lines.filter(r => r.axis === 'v' && r.at > rect.x + 1 && r.at < right(rect) - 1
      && r.to > rect.y + 2 && r.from < bottom(rect) - 2);
    if (splits.some(r => {
      if (Math.abs(r.at - divider.at) <= .5) return false;
      // A neighbouring backdrop can contribute a short edge at one printed
      // horizontal endpoint. It is not another full-height compartment.
      const shared = Math.min(r.to, bottom(rect)) - Math.max(r.from, rect.y);
      return !(shared <= rect.height * .2 && [top.from, top.to, end.from, end.to].some(x => Math.abs(x - r.at) <= 1.5));
    })) continue;
    const xs = [rect.x, divider.at, right(rect)];
    const cells = xs.slice(0, 2).map((x, col) => ({ row: 0, col, rowSpan: 1, colSpan: 1,
      rect: { x, y: rect.y, width: xs[col + 1] - x, height: rect.height } }));
    const occupants = [];
    let safe = true;
    for (const item of text) {
      if (--budget < 0) return [];
      if (!item || !validRect(item.rect) || !overlaps(item.rect, rect)) continue;
      if (!item.ocr || item.ocrNative || !item.preciseInk || !contains(rect, item.rect, .5)
        || typeof item.text !== 'string' || !Array.isArray(item.words) || !item.words.length || item.words.length > 200
        || item.words.some(w => typeof w?.text !== 'string')
        || item.words.map(w => w.text).join('').replace(/\s/gu, '') !== item.text.replace(/\s/gu, '')) { safe = false; break; }
      for (const word of item.words) {
        if (--budget < 0) return [];
        if (!word?.preciseInk || !validRect(word.rect) || word.rect.width <= 0 || word.rect.height <= 0
          || !Number.isFinite(word.baseline) || !(word.size >= 4 && word.size <= 32)
          || typeof word.text !== 'string' || !word.text.trim()) { safe = false; break; }
        const owners = cells.filter(c => contains(c.rect, word.rect, .5));
        if (owners.length !== 1) { safe = false; break; }
        occupants.push({ ...word, col: owners[0].col });
      }
      if (!safe || occupants.length > 80) { safe = false; break; }
    }
    if (!safe) continue;
    const rows = cells.map(cell => baselineBands(occupants.filter(word => word.col === cell.col))
      .map(words => ({ text: [...words].sort((a, b) => a.rect.x - b.rect.x).map(w => w.text).join('').replace(/\s/gu, ''),
        baseline: median(words.map(w => w.baseline)), size: median(words.map(w => w.size)) })));
    if (rows.some(r => r.length !== 2 || !signatureLabel(r[0].text) || r[1].text !== '年月日'
      || r[0].baseline > rect.y + rect.height * .6 || r[1].baseline < rect.y + rect.height * .65
      || r[1].baseline - r[0].baseline < Math.max(r[0].size, r[1].size) * 2)) continue;
    if (rows.some((r, col) => col && r.some((row, n) => Math.abs(row.baseline - rows[0][n].baseline) > row.size * .3))) continue;
    result.push({ rect, rows: 1, columnWidths: cells.map(c => c.rect.width), rowHeights: [rect.height], cells, borderless: true });
    if (result.length >= 16) break;
  }
  return result;
}
