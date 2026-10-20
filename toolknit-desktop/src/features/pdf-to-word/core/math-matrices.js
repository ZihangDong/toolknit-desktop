// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { right, bottom, union, contains, validRect, median } from './geometry.js';

const partText = { left: { top: '\uf8eb', stem: '\uf8ec', bottom: '\uf8ed' },
  right: { top: '\uf8f6', stem: '\uf8f7', bottom: '\uf8f8' } };
export function supportedMatrixShape(rows, brackets) {
  if (brackets !== 'round' || rows.length !== 2 || rows[0].length !== 1) return true;
  const vector = node => node?.type === 'symbol' ? node.bold && /^[\p{L}]+$/u.test(node.text)
    : node?.type === 'script' && vector(node.base);
  // An unmarked two-row round column is indistinguishable from a binomial.
  return rows.every(row => vector(row[0]));
}
export function validDelimiterGlyph(glyph) {
  const value = glyph?.delimiterPart;
  if (!value || !['round', 'square'].includes(value.kind) || !['left', 'right'].includes(value.side)
    || !['whole', 'top', 'stem', 'bottom'].includes(value.part) || Object.keys(value).some(key => !['kind', 'side', 'part'].includes(key))
    || glyph.raster || glyph.bold || glyph.italic || glyph.mathStyleUncertain || !validRect(glyph.rect)
    || !(glyph.size > 0) || !Number.isFinite(glyph.size) || !/^(?:[A-Z]{6}\+)?CMEX[1-9]\d?$/.test(glyph.font || '')) return false;
  return value.part === 'whole' ? glyph.text === (value.kind === 'round' ? value.side === 'left' ? '(' : ')'
    : value.side === 'left' ? '[' : ']') : value.kind === 'round' && glyph.text === partText[value.side][value.part];
}

/** The font layer has verified each outline; here only complete, touching
 * chains with consistent geometry/color can own a mathematical delimiter. */
export function matrixDelimiterPairs(glyphs) {
  if (!Array.isArray(glyphs) || glyphs.length > 8192) return [];
  const parts = glyphs.filter(validDelimiterGlyph), chains = []; let work = 0;
  if (parts.length > 128) return [];
  for (const top of parts.filter(item => ['whole', 'top'].includes(item.delimiterPart.part))) {
    const descriptor = top.delimiterPart;
    if (descriptor.part === 'whole') {
      if (top.rect.height >= top.size * 1.65) chains.push({ glyphs: [top], ...descriptor, rect: top.rect, size: top.size });
      continue;
    }
    const same = item => item.delimiterPart.kind === descriptor.kind && item.delimiterPart.side === descriptor.side
      && item.font === top.font && item.color === top.color && Math.abs(item.size - top.size) < top.size * .03;
    const endings = parts.filter(item => same(item) && item.delimiterPart.part === 'bottom' && item.rect.y > top.rect.y
      && Math.abs(item.rect.x - top.rect.x) < top.size * .1 && Math.abs(item.rect.width - top.rect.width) < top.size * .1);
    for (const end of endings) {
      if ((work += parts.length) > 32768) return [];
      const stems = parts.filter(item => same(item) && item.delimiterPart.part === 'stem' && item.rect.y > top.rect.y
        && item.rect.y < end.rect.y && Math.abs((descriptor.side === 'left' ? item.rect.x : right(item.rect))
          - (descriptor.side === 'left' ? top.rect.x : right(top.rect))) < top.size * .08).sort((a, b) => a.rect.y - b.rect.y);
      const chain = [top, ...stems, end];
      if (stems.length > 32 || bottom(end.rect) - top.rect.y > 400 || chain.some((item, index) => index
        && (item.rect.y - bottom(chain[index - 1].rect) > Math.max(.2, top.size * .06)
          || bottom(chain[index - 1].rect) - item.rect.y > Math.min(item.rect.height, chain[index - 1].rect.height) * .25))) continue;
      chains.push({ glyphs: chain, kind: descriptor.kind, side: descriptor.side, rect: union(chain.map(item => item.rect)), size: top.size });
    }
  }
  const proposals = [];
  for (const left of chains.filter(chain => chain.side === 'left')) {
    const matches = chains.filter(chain => chain.side === 'right' && chain.kind === left.kind
      && chain.rect.x > right(left.rect) && Math.abs(chain.size - left.size) < left.size * .05
      && Math.abs(chain.rect.y - left.rect.y) < left.size * .12 && Math.abs(bottom(chain.rect) - bottom(left.rect)) < left.size * .12)
      .sort((a, b) => a.rect.x - b.rect.x);
    const closing = matches[0];
    if (!closing || chains.some(chain => chain.side === 'left' && chain !== left && chain.rect.x > left.rect.x
      && chain.rect.x < closing.rect.x && Math.abs(chain.rect.y - left.rect.y) < left.size * .12)) continue;
    const rect = union([left.rect, closing.rect]), content = { x: right(left.rect), y: rect.y,
      width: closing.rect.x - right(left.rect), height: rect.height };
    proposals.push({ left: left.glyphs, right: closing.glyphs, kind: left.kind, rect, content, size: left.size,
      baseline: rect.y + rect.height / 2 + left.size * .25 });
  }
  const claims = new Map();
  for (const pair of proposals) for (const item of [...pair.left, ...pair.right]) claims.set(item.id, (claims.get(item.id) || 0) + 1);
  return proposals.filter(pair => [...pair.left, ...pair.right].every(item => claims.get(item.id) === 1));
}

export function joinMatrixGroups(groups, glyphs, accept = () => true) {
  const pairs = matrixDelimiterPairs(glyphs), parents = groups.map((_, index) => index);
  const owner = index => { while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; } return index; };
  let work = 0;
  for (const pair of pairs) {
    if (!accept(pair)) continue;
    const ids = new Set([...pair.left, ...pair.right].map(item => item.id));
    const matched = [];
    for (const [index, group] of groups.entries()) {
      if ((work += group.length) > 32768) return groups;
      if (group.some(item => ids.has(item.id)) || group.every(item => contains(pair.content, item.rect, pair.size * .15))) matched.push(owner(index));
    }
    if (matched.length) { const first = Math.min(...matched); matched.forEach(index => { parents[index] = first; }); }
  }
  const merged = new Map();
  groups.forEach((group, index) => { const id = owner(index); if (!merged.has(id)) merged.set(id, []); merged.get(id).push(...group); });
  return [...merged.values()];
}

/** Partition already parsed atoms, so a fraction/radical remains in one cell.
 * Uncertain row ownership and ragged/unaligned grids are not guessed. */
export function matrixCells(atoms, pair) {
  if (!atoms.length || atoms.length > 1024) return null;
  const size = Math.max(...atoms.map(item => item.size)), anchors = atoms.filter(item => item.size >= size * .88);
  const rows = [];
  for (const item of [...anchors].sort((a, b) => a.baseline - b.baseline)) {
    let row = rows.at(-1);
    if (!row || Math.abs(row.baseline - item.baseline) > size * .24) { row = { baseline: item.baseline, items: [] }; rows.push(row); }
    row.items.push(item);
  }
  if (rows.length < 2 || rows.length > 16 || rows.some((row, index) => index && row.baseline - rows[index - 1].baseline < size * .65)) return null;
  for (const atom of atoms.filter(item => !anchors.includes(item))) {
    const near = rows.map((row, index) => ({ row, index, distance: Math.abs(atom.baseline - row.baseline) })).sort((a, b) => a.distance - b.distance);
    const first = near[0];
    const gap = Math.min(first.index ? first.row.baseline - rows[first.index - 1].baseline : Infinity,
      first.index + 1 < rows.length ? rows[first.index + 1].baseline - first.row.baseline : Infinity);
    if (first.distance > Math.min(size, gap * .4) || near[1].distance - first.distance < size * .15) return null;
    first.row.items.push(atom);
  }
  const cells = rows.map(row => {
    const result = [];
    for (const item of row.items.sort((a, b) => a.rect.x - b.rect.x)) {
      let cell = result.at(-1);
      if (!cell || item.rect.x - right(cell.rect) > size * .85) { cell = { rect: item.rect, items: [] }; result.push(cell); }
      cell.items.push(item); cell.rect = union([cell.rect, item.rect]);
    }
    return result;
  });
  const columns = cells[0].length;
  if (!columns || columns > 16 || columns * cells.length > 128 || cells.some(row => row.length !== columns)) return null;
  for (let column = 0; column < columns; column++) {
    const centers = cells.map(row => row[column].rect.x + row[column].rect.width / 2), center = median(centers);
    if (centers.some(value => Math.abs(value - center) > size * .55)) return null;
  }
  if (atoms.some(atom => !contains(pair.content, atom.rect, pair.size * .15))) return null;
  return cells.map(row => row.map(cell => cell.items));
}
