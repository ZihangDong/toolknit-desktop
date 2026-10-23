// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { trustedTexFamily } from './font-style.js';
import { outlinePolygon, occupancy } from './tex-symbol.js';

const pieces = {
  '\uf8eb': [48, 'left', 'top'], '\uf8ec': [66, 'left', 'stem'], '\uf8ed': [64, 'left', 'bottom'],
  '\uf8f6': [49, 'right', 'top'], '\uf8f7': [67, 'right', 'stem'], '\uf8f8': [65, 'right', 'bottom'],
};
export const texDelimiterCandidate = (name, glyph) => /^(?:[A-Z]{6}\+)?CMEX[1-9]\d?$/.test(name || '')
  && (['(', ')', '[', ']'].includes(glyph?.unicode) || Object.hasOwn(pieces, glyph?.unicode || ''));

export function identifyTexDelimiter({ fontName, embeddedName, glyph, commands }) {
  if (!texDelimiterCandidate(fontName, glyph)) return null;
  const uncertain = { uncertain: true };
  if (trustedTexFamily(fontName, embeddedName) !== 'CMEX' || glyph.isInFont === false || glyph.accent) return uncertain;
  const piece = pieces[glyph.unicode];
  if (piece && glyph.originalCharCode !== piece[0]) return uncertain;
  const kind = !piece && ['[', ']'].includes(glyph.unicode) ? 'square' : 'round';
  const side = piece?.[1] || (['(', '['].includes(glyph.unicode) ? 'left' : 'right');
  const part = piece?.[2] || 'whole';
  const polygon = outlinePolygon(commands, [.02, .65]);
  if (!polygon) return uncertain;
  let rows = occupancy(polygon);
  if (side === 'right') rows = rows.map(columns => columns.map(column => 31 - column).sort((a, b) => a - b));
  if (part === 'stem') return rows.every(columns => columns.length >= 28) ? { delimiterPart: { kind, side, part } } : uncertain;
  if (kind === 'square') {
    const stem = rows.slice(3, -3).every(columns => columns.length > 0 && columns.length <= 10 && columns.every(column => column <= 10));
    const ends = [rows.slice(0, 3), rows.slice(-3)].every(end => end.some(columns => columns.length >= 24));
    return stem && ends ? { delimiterPart: { kind, side, part } } : uncertain;
  }
  if (!rows.every(columns => columns.length >= 1 && columns.length <= 13
    && columns.at(-1) - columns[0] + 1 === columns.length)) return uncertain;
  if (part === 'bottom') rows = rows.toReversed();
  const centers = rows.map(columns => (columns[0] + columns.at(-1)) / 2);
  const rises = values => values.every((value, index) => !index || value >= values[index - 1] - 1 && value <= values[index - 1] + 7);
  const verified = part === 'whole'
    ? centers[0] >= 22 && centers.at(-1) >= 22 && Math.max(centers[15], centers[16]) <= 9
      && rises(centers.slice(0, 16).reverse()) && rises(centers.slice(16))
    : centers[0] <= 7 && centers.at(-1) >= 22 && rises(centers);
  return verified ? { delimiterPart: { kind, side, part } } : uncertain;
}
