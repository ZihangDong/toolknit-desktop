// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { union, intersect, right, bottom, contains, median } from './geometry.js';
import { lineText } from './text.js';
import { validateCoverage } from './layout.js';
import { wordError } from './input.js';

const sections = ['header', 'blocks', 'footer'];
const textOnly = block => block.type === 'paragraph' && block.lines.every(line => line.items.every(item => item.type !== 'image'));
const targetKey = (page, id) => page + '/' + id;
const groups = line => {
  const result = [];
  for (const item of line.items) {
    const last = result.at(-1);
    if (item.type !== 'image' && last?.type === 'text') last.items.push(item);
    else result.push({ type: item.type === 'image' ? 'image' : 'text', items: [item] });
  }
  return result;
};

/** Targets refer to the immutable conversion baseline, never to canvas pixels. */
export function resultTargets(page) {
  const targets = [];
  const image = item => targets.push({ key: targetKey(page.number, item.id), type: 'image', rect: item.rect, item });
  const text = (id, lines, container, inline = false) => {
    const items = lines.flatMap(line => line.items);
    targets.push({ key: targetKey(page.number, id), type: 'text', rect: union(lines.map(line => line.rect)),
      text: lines.reduce((value, line) => {
        const next = lineText(line.items).trim();
        // PDF line endings are physical wrapping within an inferred paragraph.
        const space = value && next && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(value)
          && !/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}，。！？；：、]/u.test(next) && !/[-\s]$/.test(value);
        return value + (space ? ' ' : '') + next;
      }, ''), size: median(items.map(item => item.size)), items, lines, container, inline });
  };
  const walk = (blocks, container) => {
    for (const block of blocks) {
      if (block.type === 'columns') block.columns.forEach(column => walk(column.blocks, intersect(container, column.rect) || container));
      else if (['table', 'option-grid'].includes(block.type)) block.cells.forEach(cell => walk(cell.blocks, intersect(container, cell.rect) || container));
      else if (block.type === 'image') image(block);
      else if (textOnly(block)) text(block.id, block.lines, intersect(container, block.column || container) || container);
      else for (const line of block.lines || []) for (const group of groups(line)) {
        if (group.type === 'image') image(group.items[0]);
        else text(line.id + '/' + group.items[0].id, [{ ...line, items: group.items, rect: union(group.items.map(item => item.rect)) }],
          intersect(container, block.column || container) || container, true);
      }
    }
  };
  sections.forEach(section => walk(page[section], { x: 0, y: 0, width: page.width, height: page.height }));
  return targets;
}

export function editedTextRect(target, edit) {
  return edit?.type === 'text' ? union(edit.lines.map(line => ({ x: line.x ?? target.rect.x,
    y: line.baseline - edit.size, width: line.width, height: edit.size * 1.2 }))) : target.rect;
}

/** Grow only into unoccupied space in this column/cell, including previous edits. */
export function availableTextRect(target, page, edits = {}) {
  let container = page ? target.container || target.rect : target.rect;
  const size = Math.round(target.size * 2) / 2;
  const neighbours = (page ? resultTargets(page) : []).filter(item => item.key !== target.key && edits[item.key]?.type !== 'delete');
  for (const item of neighbours) if (item.type === 'image' && contains(item.rect, target.rect)) container = intersect(container, item.rect) || container;
  const origin = Math.min(target.rect.x, ...target.items.map(item => Number.isFinite(item.baselineX) ? item.baselineX : item.rect.x));
  const x = Math.max(container.x, origin), top = Math.max(container.y, Math.min(target.rect.y, target.lines[0].baseline - size));
  let x2 = Math.max(right(target.rect), right(container)), y2 = Math.max(bottom(target.rect), bottom(container)), y = top;
  const obstacles = neighbours.filter(item => !item.item?.backgroundPaintIndexes?.length && !contains(item.rect, target.rect))
    .map(item => editedTextRect(item, edits[item.key]));
  const gap = Math.min(2, size * .15), overlapsAxis = (a, a2, b, b2) => Math.min(a2, b2) - Math.max(a, b) > .5;
  for (const rect of obstacles) {
    if (rect.x >= right(target.rect) - .5 && overlapsAxis(target.rect.y, bottom(target.rect), rect.y, bottom(rect))) x2 = Math.min(x2, rect.x - gap);
  }
  x2 = Math.max(right(target.rect), x2);
  for (const rect of obstacles) {
    if (!overlapsAxis(x, x2, rect.x, right(rect))) continue;
    if (rect.y >= bottom(target.rect) - .5) y2 = Math.min(y2, rect.y - gap);
    if (bottom(rect) <= target.rect.y + .5) y = Math.max(y, bottom(rect) + gap);
  }
  return { x, y, width: Math.max(.1, x2 - x), height: Math.max(.1, y2 - y) };
}

/** Match Word's half-point sizes, preserve the source size first, then fit automatically. */
export function layoutEditedText(target, text, measure, { page, edits } = {}) {
  if (typeof text !== 'string' || text.length > 10000 || !text.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw wordError('edit-text');
  if (!Number.isFinite(target.size) || target.size <= 0 || typeof measure !== 'function') throw wordError('edit-text');
  const maximum = Math.max(1, Math.min(400, Math.round(target.size * 2) / 2));
  const minimum = Math.min(maximum, Math.ceil(Math.max(6, maximum * .7) * 2) / 2);
  const rect = availableTextRect(target, page, edits), style = target.items[0];
  const distances = target.lines.slice(1).map((line, index) => line.baseline - target.lines[index].baseline).filter(gap => gap > 0);
  const sourceLeading = distances.length ? median(distances) : maximum * 1.2;
  const attempt = size => {
    const leading = Math.max(size * 1.2, sourceLeading * size / maximum);
    const firstBaseline = Math.max(rect.y + size, target.lines[0].baseline);
    const capacity = Math.max(0, Math.floor((bottom(rect) - firstBaseline - size * .2 + .01) / leading) + 1);
    const maxLines = target.inline ? Math.min(1, capacity) : capacity;
    const lines = [], width = value => measure(value, { ...style, size });
    const append = value => {
      if (lines.length >= maxLines) return false;
      lines.push({ text: value, x: rect.x, baseline: firstBaseline + lines.length * leading, width: Math.max(.1, width(value)) });
      return true;
    };
    for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
      let line = '';
      for (const character of paragraph) {
        if (width(character) > rect.width + .1) return null;
        if (line && width(line + character) > rect.width + .1) {
          const space = line.lastIndexOf(' ');
          const breakAtSpace = space > line.length / 2 && /^[A-Za-z0-9'-]+$/.test(line.slice(space + 1) + character);
          if (!append(breakAtSpace ? line.slice(0, space) : line)) return null;
          line = breakAtSpace ? line.slice(space + 1) : '';
        }
        line += character;
      }
      if (!append(line)) return null;
    }
    return { type: 'text', text, size, lines };
  };
  const originalSize = attempt(maximum); if (originalSize) return originalSize;
  let best = attempt(minimum); if (!best) throw wordError('edit-fit');
  let low = Math.round(minimum * 2), high = Math.round(maximum * 2) - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2), fitted = attempt(middle / 2);
    if (fitted) { best = fitted; low = middle + 1; } else high = middle - 1;
  }
  return best;
}

/** Create a validated export document; user deletions are removed from its source ledger. */
export function applyResultEdits(original, edits = {}) {
  if (!Object.keys(edits).length) return original;
  const document = structuredClone(original);
  for (const page of document.pages) {
    const targets = new Map(resultTargets(page).map(target => [target.key, target]));
    const removed = new Set(), rewritten = new Map();
    const discard = ids => ids.forEach(id => removed.add(id));
    const editImage = item => {
      const edit = edits[targetKey(page.number, item.id)];
      if (!edit) return item;
      if (edit.type === 'delete') { discard(item.sourceIds); return null; }
      if (edit.type !== 'image' || !/^word-edit-[a-z0-9-]+$/.test(edit.assetId)) throw wordError('image');
      // A replacement is an image chosen by the user, not an inferred formula.
      return { id: item.id, type: 'image', rect: { ...item.rect }, sourceIds: item.sourceIds,
        assetId: edit.assetId, order: item.order, baseline: item.baseline, size: item.size };
    };
    const editText = (id, sourceLines) => {
      const key = targetKey(page.number, id), edit = edits[key];
      if (!edit) return sourceLines;
      const target = targets.get(key), ids = target.items.flatMap(item => item.sourceIds);
      if (edit.type === 'delete') { discard(ids); return []; }
      if (edit.type !== 'text' || !edit.lines?.length || !Number.isFinite(edit.size)) throw wordError('edit-text');
      ids.forEach((sourceId, index) => rewritten.set(sourceId, index ? '' : edit.text));
      return edit.lines.map((value, index) => {
        const rect = { x: value.x ?? target.rect.x, y: value.baseline - edit.size, width: value.width, height: edit.size * 1.2 };
        const sourceIds = index ? [] : ids;
        const item = { id: id + ':edited:' + index, type: 'text', text: value.text, sourceIds, rect,
          size: edit.size, baseline: value.baseline, baselineX: rect.x, advanceWidth: value.width,
          font: target.items[0].font, fontFamily: target.items[0].fontFamily, color: target.items[0].color,
          bold: target.items[0].bold, italic: target.items[0].italic, preciseInk: true };
        return { id: item.id + ':line', type: 'line', text: value.text, items: [item], sourceIds, rect, size: edit.size, baseline: value.baseline };
      });
    };
    const walk = blocks => blocks.flatMap(block => {
      if (block.type === 'columns') block.columns.forEach(column => { column.blocks = walk(column.blocks); });
      else if (['table', 'option-grid'].includes(block.type)) block.cells.forEach(cell => { cell.blocks = walk(cell.blocks); });
      else if (block.type === 'image') { const value = editImage(block); return value ? [value] : []; }
      else if (textOnly(block)) {
        block.lines = editText(block.id, block.lines);
        if (!block.lines.length) return [];
        if (edits[targetKey(page.number, block.id)]) block.align = 'left';
      } else if (block.lines) {
        block.lines = block.lines.flatMap(line => {
          const items = groups(line).flatMap(group => {
            if (group.type === 'image') { const item = editImage(group.items[0]); return item ? [item] : []; }
            const part = { ...line, items: group.items, rect: union(group.items.map(item => item.rect)) };
            return editText(line.id + '/' + group.items[0].id, [part]).flatMap(value => value.items);
          });
          return items.length ? [{ ...line, items, rect: union(items.map(item => item.rect)), sourceIds: items.flatMap(item => item.sourceIds), text: lineText(items) }] : [];
        });
        if (!block.lines.length) return [];
      }
      if (block.lines) {
        block.sourceIds = block.lines.flatMap(line => line.items.flatMap(item => item.sourceIds));
        block.rect = union(block.lines.map(line => line.rect));
      }
      return [block];
    });
    sections.forEach(section => { page[section] = walk(page[section]); });
    page.sources = page.sources.filter(source => !removed.has(source.id) && !(source.disposition === 'redraw' && removed.has(source.equivalentTo)))
      .map(source => rewritten.has(source.id) ? { ...source, text: rewritten.get(source.id), disposition: 'editable' } : source);
  }
  document.quality = validateCoverage(document);
  return document;
}
