// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { trustedTexFamily } from './font-style.js';
import { outlinePolygon, occupancy, hasCornerShape } from './tex-symbol.js';

const slots = { 116: 'hook', 117: 'stem', 118: 'cap' };
export const texRadicalPartCandidate = (fontName, glyph) => glyph?.unicode === '\u221a'
  && Object.hasOwn(slots, glyph.originalCharCode) && /^(?:[A-Z]{6}\+)?CMEX[1-9]\d?$/.test(fontName || '');

/** CMEX extensible-root slots share one Unicode value. The encoding alone
 * cannot distinguish a real component from a mislabeled or altered outline. */
export function identifyTexRadicalPart({ fontName, embeddedName, glyph, commands }) {
  if (!texRadicalPartCandidate(fontName, glyph)) return null;
  if (trustedTexFamily(fontName, embeddedName) !== 'CMEX' || glyph.isInFont === false || glyph.accent
    || !Array.isArray(commands) || commands.length > 48) return { uncertain: true };
  const part = slots[glyph.originalCharCode];
  if (part === 'cap') return hasCornerShape(commands, true, true) ? { part } : { uncertain: true };
  const polygon = outlinePolygon(commands, part === 'stem' ? [.035, .1] : [.25, .45]);
  if (!polygon) return { uncertain: true };
  const rows = occupancy(polygon);
  if (part === 'stem') return rows.every(columns => columns.length >= 24)
    && rows.slice(2, 30).every(columns => columns.length >= 30) ? { part } : { uncertain: true };
  const diagonal = rows.slice(5, 24).map(columns => columns.filter(column => column < 28));
  const rightStem = rows.every(columns => columns.includes(30) && columns.includes(31));
  const upperStemOnly = rows.slice(28).every(columns => columns.length <= 4 && columns.every(column => column >= 28));
  const slope = diagonal.every((columns, index) => columns.length >= 2 && columns.length <= 8
    && (!index || columns[0] <= diagonal[index - 1][0] && columns[0] >= diagonal[index - 1][0] - 2));
  const foot = rows.slice(22, 28).some(columns => columns.some(column => column <= 2));
  return rightStem && upperStemOnly && slope && foot ? { part } : { uncertain: true };
}
