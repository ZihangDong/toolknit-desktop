// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { contains, overlaps, spatialIndex, median } from './geometry.js';
import { ruledTableGrids, tableOwnsStroke } from './tables.js';
import { mathAtom, mathScriptAttachment } from './math-rows.js';
import { independentTextGroups } from './text-paint-groups.js';
import { LIMITS } from './input.js';

const mathFragment = part => part.alphabet || part.radicalPart || part.delimiterPart || part.mathStyleUncertain
  || part.italic && /^[\p{Script=Latin}\p{Script=Greek}]{1,2}$/u.test(part.text.trim())
  || part.text.trim().length <= 3 && /[\p{Sm}*/^_]/u.test(part.text);
const scriptFragment = parts => {
  if (parts.length > 256) return true;
  const atoms = parts.map(part => mathAtom({ type: 'symbol', text: part.text }, part.rect, part.baseline, part.size));
  return atoms.some(small => atoms.some(base => small !== base && small.size < base.size * .85 && mathScriptAttachment(small, base)));
};

/** Preserve the grid/uncertain content as a local backdrop, not duplicate text. */
export function recoverTableTextLayers({ number, items, text, rules, sources, operations, graphics = [], tableGrids }) {
  const groups = independentTextGroups(operations);
  if (!groups.length) return { items, count: 0 };
  const grids = (tableGrids || ruledTableGrids(rules)).filter(grid => grid.rows >= 2 && grid.columnWidths.length >= 2 && grid.cells.length >= 4);
  if (!grids.length) return { items, count: 0 };
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const redraws = new Set(sources.filter(source => source.disposition === 'redraw').map(source => source.equivalentTo));
  const imagesAt = spatialIndex(items.filter(item => item.type === 'image'));
  const restored = [], output = [];
  const edgeAllowance = Math.max(1, Math.min(4, median(text.map(item => item.size)) * .5));
  let count = 0;
  for (const item of items) {
    const grid = count < LIMITS.backgroundLayersPerPage && item.type === 'image' && item.role === 'figure' && item.sourceIds.length >= 2
      // A connected footer can extend the backdrop. Require the table to own
      // most of that crop; only text wholly inside confirmed cells is restored.
      && grids.find(grid => contains(item.rect, grid.rect, 1)
        && contains(grid.rect, item.rect, Math.max(edgeAllowance, Math.min(grid.rect.width, grid.rect.height) * .25))
        && grid.rect.width * grid.rect.height >= item.rect.width * item.rect.height * .75);
    if (!grid) { output.push(item); continue; }
    const textIndex = spatialIndex(text), graphicIndex = spatialIndex(graphics.filter(graphic => !tableOwnsStroke(graphic, grid)));
    const protectedCells = new Set(grid.cells.filter(cell => {
      const parts = textIndex(cell.rect).filter(part => contains(cell.rect, part.rect, .5));
      const interior = { x: cell.rect.x + .5, y: cell.rect.y + .5,
        width: Math.max(0, cell.rect.width - 1), height: Math.max(0, cell.rect.height - 1) };
      return parts.some(mathFragment) || scriptFragment(parts) || graphicIndex(cell.rect).some(graphic => overlaps(cell.rect, graphic.rect, .1)
        // A later row's border can touch this cell without covering its ink.
        && (overlaps(interior, graphic.rect, .1) || parts.some(part => overlaps(part.rect, graphic.rect, 0)))
        && !((graphic.fillRect || graphic.strokedFillRect) && !graphic.thin && graphic.order < Math.min(...parts.map(part => part.order))));
    }));
    const owned = new Set(item.sourceIds);
    const eligible = new Map(text.filter(part => owned.has(part.id) && !part.raster && !redraws.has(part.id)
      && !imagesAt(part.rect).some(other => other !== item && overlaps(other.rect, part.rect, 0))
      && grid.cells.filter(cell => !protectedCells.has(cell) && contains(cell.rect, part.rect, .5)).length === 1).map(part => [part.id, part]));
    const selected = new Set(), indexes = [];
    for (const group of groups) {
      const visible = group.map(index => sourceById.get(`p${number}:t${index}`))
        .filter(source => source && source.disposition !== 'excluded-hidden');
      if (!visible.length || !visible.every(source => eligible.has(source.id))) continue;
      visible.forEach(source => selected.add(source.id)); indexes.push(...group);
    }
    if (selected.size < 2) { output.push(item); continue; }
    count++;
    output.push({ ...item, sourceIds: item.sourceIds.filter(id => !selected.has(id)), backgroundPaintIndexes: indexes });
    for (const id of selected) {
      sourceById.get(id).disposition = 'editable';
      restored.push({ ...eligible.get(id), type: 'text' });
    }
  }
  return { items: [...output, ...restored], count };
}
