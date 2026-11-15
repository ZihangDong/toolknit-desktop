// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { matchesOcrTtf } from './ocr-font-ttf.js';

/** Only the exact, instruction-free generated format is readable here. Source
 * font programs have separate permission/validation and native shaping paths. */
export function inspectOcrFontProgram(bytes, name, characters, bold, observations) {
  if (!matchesOcrTtf(bytes, name, characters, bold, observations)) return null;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), tables = new Map();
  for (let i = 0; i < 10; i++) {
    const at = 12 + i * 16, tag = String.fromCharCode(...bytes.subarray(at, at + 4));
    tables.set(tag, { offset: data.getUint32(at + 8), length: data.getUint32(at + 12) });
  }
  const head = tables.get('head').offset, hhea = tables.get('hhea').offset;
  const loca = tables.get('loca').offset, hmtx = tables.get('hmtx').offset, glyf = tables.get('glyf');
  const units = data.getUint16(head + 18), ascent = data.getInt16(hhea + 4), descent = data.getInt16(hhea + 6);
  const indices = new Map([...characters].map((text, i) => [text, i + 2]));
  indices.set(' ', 1); indices.set('\u00a0', 1);
  function glyph(text, outline = false) {
    const id = indices.get(text);
    if (id === undefined) return null;
    const advance = data.getUint16(hmtx + id * 4);
    if (id === 1) return { advance, bounds: [0, 0, 0, 0], points: 0, coordinates: null, ends: null };
    const start = data.getUint32(loca + id * 4), end = data.getUint32(loca + (id + 1) * 4);
    if (start >= end || end > glyf.length) return null;
    const at = glyf.offset + start, contours = data.getInt16(at);
    if (contours < 1 || contours > 512) return null;
    const ends = Array.from({ length: contours }, (_, i) => data.getUint16(at + 10 + i * 2));
    const points = ends.at(-1) + 1, flags = at + 12 + contours * 2, xAt = flags + points, yAt = xAt + points * 2;
    if (points < 4 || points > 8192 || yAt + points * 2 > glyf.offset + end) return null;
    const bounds = Array.from({ length: 4 }, (_, i) => data.getInt16(at + 2 + i * 2));
    if (!outline) return { advance, bounds, points };
    const coordinates = new Int16Array(points * 2); let x = 0, y = 0;
    for (let i = 0; i < points; i++) {
      if (data.getUint8(flags + i) !== 1) return null;
      x += data.getInt16(xAt + i * 2); y += data.getInt16(yAt + i * 2);
      if (x < -4096 || x > 4096 || y < -4096 || y > 4096) return null;
      coordinates[i * 2] = x; coordinates[i * 2 + 1] = y;
    }
    return { advance, bounds, points, coordinates, ends: Uint16Array.from(ends) };
  }
  return Object.freeze({ name, units, ascent, descent, bold, glyph });
}
