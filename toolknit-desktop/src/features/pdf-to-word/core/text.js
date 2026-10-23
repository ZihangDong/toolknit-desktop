// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { median, union, right, bottom } from './geometry.js';
import { baselineBands } from './reading-order.js';

export const isOption = text => /^(?:[A-HＡ-Ｈ][.、．)）]|[（(][A-HＡ-Ｈ][)）])/.test(text.trim());
export const isList = text => /^(?:\d{1,3}[.、．)）]|[（(]\d{1,3}[)）]|[•●▪-]\s)/.test(text.trim());

export function lineText(items) {
  let value = '', previous = null;
  for (const item of items) {
    if (previous) {
      const gap = item.rect.x - right(previous.rect);
      if (gap > Math.min(item.size, previous.size) * 0.22 && !/\s$/.test(value) && !/^\s/.test(item.text)) value += ' ';
    }
    value += item.text; previous = item;
  }
  return value;
}

export function groupLines(items) {
  const rows = [];
  for (const item of [...items].sort((a, b) => a.baseline - b.baseline || a.rect.x - b.rect.x || a.order - b.order)) {
    let row = rows.at(-1);
    if (!row || Math.abs(row.baseline - item.baseline) > Math.max(1, Math.min(row.size, item.size) * 0.28)) {
      row = { baseline: item.baseline, size: item.size, items: [] }; rows.push(row);
    }
    // A raised small letter may be encountered before the main text. Re-anchor
    // only to a distinctly larger face when every existing item still fits.
    if (row.items.length && item.size > row.size / .85 && row.items.every(previous =>
      Math.abs(previous.baseline - item.baseline) <= Math.max(1, Math.min(previous.size, item.size) * .28))) row.baseline = item.baseline;
    row.items.push(item); row.size = Math.max(row.size, item.size);
  }
  const lines = [];
  for (const row of rows) {
    let group = [];
    const emit = () => {
      if (!group.length) return;
      const size = median(group.map(item => item.size));
      const baseline = median(group.filter(item => item.size >= size * .9).map(item => item.baseline));
      lines.push({ id: group[0].id + ':line', type: 'line', items: group, text: lineText(group),
        sourceIds: group.flatMap(item => item.sourceIds), rect: union(group.map(item => item.rect)),
        size, baseline,
        bold: group.filter(item => item.bold).length >= group.length * 0.7 });
      group = [];
    };
    for (const item of row.items.sort((a, b) => a.rect.x - b.rect.x)) {
      const previous = group.at(-1);
      if (previous && item.rect.x - right(previous.rect) > Math.max(8, Math.min(item.size, previous.size) * 1.3)) emit();
      group.push(item);
    }
    emit();
  }
  return lines;
}

function canJoin(previous, next, column) {
  const gap = next.baseline - previous.baseline;
  const first = previous.items[0];
  if (gap <= Math.max(1, Math.min(previous.size, next.size) * .28)
    || gap > Math.max(previous.size, next.size) * 2.2 || Math.abs(previous.size - next.size) > 0.7) return false;
  if (isOption(next.text) || isList(next.text) || next.bold !== previous.bold) return false;
  if (Math.abs(next.rect.x - column.x) > next.size * 2.4) return false;
  if (right(previous.rect) < right(column) - previous.size * 3 && /[。！？.!?:：；;]$/.test(previous.text.trim())) return false;
  return first && first.color === next.items[0]?.color;
}

export function buildParagraphs(lines, column) {
  const paragraphs = [];
  const bodySize = median(lines.map(line => line.size)) || 11;
  const bands = baselineBands(lines), fragmented = new Set(bands.filter(band => band.length > 1).flat());
  for (const line of bands.flatMap(band => band.sort((a, b) => a.rect.x - b.rect.x))) {
    const centered = Math.abs((line.rect.x + line.rect.width / 2) - (column.x + column.width / 2)) < line.size * 1.5;
    const heading = line.size > bodySize * 1.22 || line.bold && centered && line.rect.width < column.width * 0.8;
    const role = heading ? 'heading' : isOption(line.text) ? 'option' : isList(line.text) ? 'list' : 'paragraph';
    const previous = paragraphs.at(-1);
    if (previous && role === 'paragraph' && ['paragraph', 'list'].includes(previous.role)
      && !fragmented.has(line) && !fragmented.has(previous.lines.at(-1)) && canJoin(previous.lines.at(-1), line, column)) {
      previous.lines.push(line); previous.sourceIds.push(...line.sourceIds); previous.rect = union([previous.rect, line.rect]);
    } else {
      paragraphs.push({ id: line.id + ':paragraph', type: 'paragraph', role, lines: [line], sourceIds: [...line.sourceIds], rect: { ...line.rect },
        align: centered && heading ? 'center' : 'left', size: line.size, column: { ...column } });
    }
  }
  return paragraphs;
}

export function textOfBlock(block) {
  if (block.type === 'paragraph') return block.lines.map(line => line.text).join('\n');
  if (block.type === 'table' || block.type === 'option-grid') return block.cells.map(cell => cell.blocks.map(textOfBlock).join('\n')).join('\t');
  if (block.type === 'columns') return block.columns.map(column => column.blocks.map(textOfBlock).join('\n')).join('\n');
  return '';
}

export function lineSpacing(lines) {
  const distances = lines.slice(1).map((line, i) => line.baseline - lines[i].baseline).filter(gap => gap > 0);
  return distances.length ? median(distances) : (lines[0]?.size || 11) * 1.2;
}
