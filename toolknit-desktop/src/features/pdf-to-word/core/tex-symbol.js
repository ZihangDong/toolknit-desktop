// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { trustedTexFamily } from './font-style.js';

export function outlinePolygon(commands, aspect = [.6, 1.5]) {
  if (!Array.isArray(commands) || commands.length > 128) return null;
  const contours = []; let points = [], current = null;
  const finish = () => {
    if (points.length >= 3) {
      const area = points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length]; return sum + point[0] * next[1] - point[1] * next[0];
      }, 0);
      if (Math.abs(area) > .001) contours.push(points);
    }
    points = []; current = null;
  };
  for (const item of commands) {
    if (!item || typeof item !== 'object') return null;
    const { command, args } = item;
    if (!Array.isArray(args) || !args.every(value => Number.isFinite(value) && Math.abs(value) <= 1e6)) return null;
    if (command === 'moveTo' && args.length === 2) {
      if (points.length) return null;
      current = [...args]; points.push(current);
    } else if (command === 'lineTo' && args.length === 2 && current) {
      current = [...args]; points.push(current);
    } else if (['bezierCurveTo', 'quadraticCurveTo'].includes(command) && current) {
      const cubic = command === 'bezierCurveTo';
      if (args.length !== (cubic ? 6 : 4)) return null;
      const start = current;
      for (let step = 1; step <= 16; step++) {
        const t = step / 16, u = 1 - t;
        points.push([0, 1].map(axis => cubic
          ? u ** 3 * start[axis] + 3 * u ** 2 * t * args[axis] + 3 * u * t ** 2 * args[axis + 2] + t ** 3 * args[axis + 4]
          : u ** 2 * start[axis] + 2 * u * t * args[axis] + t ** 2 * args[axis + 2]));
      }
      current = points.at(-1);
    } else if (command === 'closePath' && !args.length) finish();
    else return null;
    if (points.length > 2048) return null;
  }
  if (points.length || contours.length !== 1) return null;
  const contour = contours[0], xs = contour.map(point => point[0]), ys = contour.map(point => point[1]);
  const left = Math.min(...xs), bottom = Math.min(...ys), width = Math.max(...xs) - left, height = Math.max(...ys) - bottom;
  if (!(width > 0 && height > 0) || width / height < aspect[0] || width / height > aspect[1]) return null;
  return contour.map(([x, y]) => [(x - left) / width, (y - bottom) / height]);
}

export function occupancy(polygon) {
  const inside = (x, y) => {
    let result = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
      const a = polygon[index], b = polygon[previous];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
    }
    return result;
  };
  const rows = [];
  for (let row = 0; row < 32; row++) {
    const columns = [];
    for (let column = 0; column < 32; column++) if (inside((column + .5) / 32, (row + .5) / 32)) columns.push(column);
    rows.push(columns);
  }
  return rows;
}

function hasTShape(commands, top) {
  const polygon = outlinePolygon(commands);
  if (!polygon) return false;
  const rows = occupancy(polygon);
  const broad = rows.map((columns, index) => columns.length >= 22 ? index : -1).filter(index => index >= 0);
  if (!broad.length || broad.length > 8 || broad.some(index => top ? index < 24 : index > 7)) return false;
  if (rows.filter(columns => columns.includes(15) || columns.includes(16)).length < 30) return false;
  return rows.every((columns, index) => broad.includes(index) || columns.length >= 1 && columns.length <= 8
    && columns.every(column => column >= 11 && column <= 20));
}

export function hasCornerShape(commands, top, left) {
  const polygon = outlinePolygon(commands, [.12, .65]);
  if (!polygon) return false;
  const rows = occupancy(polygon);
  const broad = rows.map((columns, index) => columns.length >= 24 ? index : -1).filter(index => index >= 0);
  if (!broad.length || broad.length > 6 || broad.some(index => top ? index < 26 : index > 5)) return false;
  const onStem = columns => columns.length >= 1 && columns.length <= 8
    && columns.every(column => left ? column <= 7 : column >= 24);
  if (!rows.every((columns, index) => broad.includes(index) || onStem(columns))) return false;
  return Array.from({ length: 32 }, (_, column) => rows.filter(columns => columns.includes(column)).length)
    .some(count => count >= 30);
}

const encodings = {
  '>': { code: 62, text: '\u22a4', top: true }, '?': { code: 63, text: '\u22a5', top: false },
  b: { code: 98, text: '\u230a', top: false, left: true }, c: { code: 99, text: '\u230b', top: false, left: false },
  d: { code: 100, text: '\u2308', top: true, left: true }, e: { code: 101, text: '\u2309', top: true, left: false },
};
export const texSymbolCandidate = (fontName, glyph) => Object.hasOwn(encodings, glyph?.unicode || '')
  && /^(?:[A-Z]{6}\+)?CM(?:B)?SY[1-9]\d?$/.test(fontName || '');

/** These CMSY slots can be mislabelled by both ToUnicode and glyph names.
 * Require the standard encoding and the actual complete outline together.
 */
export function normalizeTexSymbol({ fontName, embeddedName, glyph, commands }) {
  if (!texSymbolCandidate(fontName, glyph)) return null;
  const kind = trustedTexFamily(fontName, embeddedName), mapping = encodings[glyph.unicode];
  if (!['CMSY', 'CMBSY'].includes(kind) || glyph.originalCharCode !== mapping.code
    || !(mapping.left === undefined ? hasTShape(commands, mapping.top) : hasCornerShape(commands, mapping.top, mapping.left))) return { uncertain: true };
  return { text: mapping.text, rule: 'tex-slot-and-outline' };
}
