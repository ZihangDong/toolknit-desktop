// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.

export const OCR_FONT_LIMITS = Object.freeze({ units: 1024, glyphs: 512, points: 131072, bytes: 2 * 1024 * 1024 });
export const isOcrFontName = name => typeof name === 'string' && /^TKInk[0-9a-f]{24}$/.test(name);
const align = n => Math.ceil(n / 4) * 4;
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const sum = bytes => {
  let value = 0;
  for (let i = 0; i < bytes.length; i += 4) value = (value + (((bytes[i] || 0) * 0x1000000
    + (bytes[i + 1] || 0) * 0x10000 + (bytes[i + 2] || 0) * 0x100 + (bytes[i + 3] || 0)) >>> 0)) >>> 0;
  return value;
};
const signed = n => Number.isInteger(n) && n >= -4096 && n <= 4096;
const printable = text => typeof text === 'string' && text.length === 1 && Boolean(text.trim()) && text.charCodeAt(0) >= 32
  && !/[\x7f-\x9f\ud800-\uf8ff\ufffe\uffff]/u.test(text);

function glyphBytes(contours) {
  if (!contours.length || contours.length > 512) return null;
  let count = 0;
  for (const contour of contours) if (!Array.isArray(contour) || contour.length < 4 || (count += contour.length) > 8192) return null;
  const points = contours.flat();
  if (points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(signed))) return null;
  if (contours.some(c => c.reduce((area, p, i) => {
    const q = c[(i + 1) % c.length]; return area + p[0] * q[1] - q[0] * p[1];
  }, 0) === 0)) return null;
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  if (!(bounds[2] > bounds[0] && bounds[3] > bounds[1])) return null;
  const bytes = new Uint8Array(12 + contours.length * 2 + count * 5), data = view(bytes);
  data.setInt16(0, contours.length); bounds.forEach((n, i) => data.setInt16(2 + i * 2, n));
  let end = -1;
  contours.forEach((c, i) => { end += c.length; data.setUint16(10 + i * 2, end); });
  const flags = 12 + contours.length * 2, xOffset = flags + count, yOffset = xOffset + count * 2;
  let x = 0, y = 0;
  points.forEach((p, i) => { bytes[flags + i] = 1; data.setInt16(xOffset + i * 2, p[0] - x);
    data.setInt16(yOffset + i * 2, p[1] - y); x = p[0]; y = p[1]; });
  return { bytes, bounds, points: count, contours: contours.length };
}

function cmap(entries) {
  const count = entries.length + 1, length = 16 + count * 8, bytes = new Uint8Array(12 + length), data = view(bytes), at = 12;
  data.setUint16(2, 1); data.setUint16(4, 3); data.setUint16(6, 1); data.setUint32(8, at);
  data.setUint16(at, 4); data.setUint16(at + 2, length); data.setUint16(at + 6, count * 2);
  const power = 2 ** Math.floor(Math.log2(count)); data.setUint16(at + 8, power * 2);
  data.setUint16(at + 10, Math.log2(power)); data.setUint16(at + 12, count * 2 - power * 2);
  for (let i = 0; i < count; i++) {
    const point = i < entries.length ? entries[i].text.charCodeAt(0) : 0xffff, gid = i < entries.length ? entries[i].gid : 0;
    data.setUint16(at + 14 + i * 2, point); data.setUint16(at + 16 + count * 2 + i * 2, point);
    data.setUint16(at + 16 + count * 4 + i * 2, (gid - point) & 0xffff);
  }
  return bytes;
}

function names(name, bold) {
  const style = bold ? 'Bold' : 'Regular';
  const records = [[0, 'Generated locally from OCR document pixels; no source or system font program copied.'],
    [1, name], [2, style], [3, name], [4, name], [5, 'Version 1.0'], [6, name], [16, name], [17, style]];
  const start = 6 + records.length * 12, size = records.reduce((n, [, text]) => n + text.length * 2, start);
  const bytes = new Uint8Array(size), data = view(bytes); data.setUint16(2, records.length); data.setUint16(4, start);
  let cursor = start;
  records.forEach(([id, text], i) => {
    const at = 6 + i * 12; data.setUint16(at, 3); data.setUint16(at + 2, 1); data.setUint16(at + 4, 0x409);
    data.setUint16(at + 6, id); data.setUint16(at + 8, text.length * 2); data.setUint16(at + 10, cursor - start);
    for (const character of text) { data.setUint16(cursor, character.charCodeAt(0)); cursor += 2; }
  });
  return bytes;
}

/** Build a NEW document-owned classic TrueType font from bounded outlines.
 * This does not read, relabel, alter permission flags of, or grant rights to an
 * existing font. OCR provenance/ownership must be established by the caller.
 * Positions use one shared baseline/em; tight glyph heights are not font sizes.
 */
export function buildOcrTtf(glyphs, name, { check = () => {}, bold = false } = {}) {
  if (!isOcrFontName(name) || typeof bold !== 'boolean' || !Array.isArray(glyphs) || glyphs.length < 1 || glyphs.length > OCR_FONT_LIMITS.glyphs) return null;
  check();
  if (glyphs.some(item => !item || !printable(item.text))) return null;
  const entries = [...glyphs].sort((a, b) => a.text.charCodeAt(0) - b.text.charCodeAt(0)), seen = new Set(), encoded = [];
  let points = 0, glyfSize = 0;
  for (const item of entries) {
    check();
    if (!item || !printable(item.text) || seen.has(item.text) || !Number.isInteger(item.advance)
      || item.advance < 1 || item.advance > 8192 || !Array.isArray(item.contours)) return null;
    seen.add(item.text);
    const glyph = glyphBytes(item.contours);
    if (!glyph || (points += glyph.points) > OCR_FONT_LIMITS.points) return null;
    encoded.push(glyph); glyfSize += align(glyph.bytes.length);
  }
  const units = OCR_FONT_LIMITS.units, count = entries.length + 2;
  const bounds = [Math.min(0, ...encoded.map(g => g.bounds[0])), Math.min(0, ...encoded.map(g => g.bounds[1])),
    Math.max(...encoded.map(g => g.bounds[2])), Math.max(...encoded.map(g => g.bounds[3]))];
  // A punctuation-only subset still uses the cohort's nominal line/em. Its
  // tiny ink box must not redefine line metrics or enlarge a thin Chinese 一.
  const ascent = Math.max(Math.round(units * .9), bounds[3]), descent = Math.min(-Math.round(units * .2), bounds[1]);
  if (ascent - descent > units * 3) return null;
  const glyf = new Uint8Array(glyfSize), loca = new Uint8Array((count + 1) * 4), hmtx = new Uint8Array(count * 4);
  // Spaces have no source ink/provenance. Give ordinary and nonbreaking space
  // one explicit empty advance, so typing a space does not use a .notdef em.
  view(hmtx).setUint16(0, units); view(hmtx).setUint16(4, units / 4); let offset = 0;
  encoded.forEach((glyph, i) => {
    check(); view(loca).setUint32((i + 2) * 4, offset); glyf.set(glyph.bytes, offset); offset += align(glyph.bytes.length);
    view(hmtx).setUint16((i + 2) * 4, entries[i].advance); view(hmtx).setInt16((i + 2) * 4 + 2, glyph.bounds[0]);
  });
  view(loca).setUint32(count * 4, offset);
  const head = new Uint8Array(54), hv = view(head); hv.setUint32(0, 0x10000); hv.setUint32(4, 0x10000);
  hv.setUint32(12, 0x5f0f3cf5); hv.setUint16(16, 3); hv.setUint16(18, units);
  hv.setBigUint64(20, 2082844800n); hv.setBigUint64(28, 2082844800n); bounds.forEach((n, i) => hv.setInt16(36 + i * 2, n));
  hv.setUint16(44, bold ? 1 : 0);
  hv.setUint16(46, 8); hv.setInt16(48, 2); hv.setInt16(50, 1);
  const hhea = new Uint8Array(36), hh = view(hhea); hh.setUint32(0, 0x10000); hh.setInt16(4, ascent); hh.setInt16(6, descent);
  hh.setUint16(10, Math.max(units, ...entries.map(g => g.advance))); hh.setInt16(12, bounds[0]);
  hh.setInt16(14, Math.min(0, ...encoded.map((g, i) => entries[i].advance - g.bounds[2]))); hh.setInt16(16, bounds[2]);
  hh.setInt16(18, 1); hh.setUint16(34, count);
  const maxp = new Uint8Array(32), mv = view(maxp); mv.setUint32(0, 0x10000); mv.setUint16(4, count);
  mv.setUint16(6, Math.max(...encoded.map(g => g.points))); mv.setUint16(8, Math.max(...encoded.map(g => g.contours))); mv.setUint16(14, 2);
  const os2 = new Uint8Array(96), ov = view(os2); ov.setUint16(0, 3); ov.setInt16(2, Math.round(entries.reduce((n, g) => n + g.advance, 0) / entries.length));
  ov.setUint16(4, bold ? 700 : 400); ov.setUint16(6, 5); ov.setInt16(10, 650); ov.setInt16(12, 600); ov.setInt16(18, 650); ov.setInt16(20, 600);
  ov.setInt16(26, 50); ov.setInt16(28, 300); os2.set([84, 75, 78, 84], 58); ov.setUint16(62, bold ? 32 : 64);
  ov.setUint16(64, 32); ov.setUint16(66, Math.max(160, entries.at(-1).text.charCodeAt(0)));
  ov.setInt16(68, ascent); ov.setInt16(70, descent); ov.setUint16(74, ascent); ov.setUint16(76, -descent);
  ov.setUint32(42, 3);
  if (entries.some(g => /\p{Script=Han}/u.test(g.text))) { ov.setUint32(46, 1 << 27); ov.setUint32(78, 1 << 18); }
  ov.setInt16(86, Math.round(units * .5)); ov.setInt16(88, Math.round(units * .7)); ov.setUint16(92, 32); ov.setUint16(94, 1);
  const post = new Uint8Array(32); view(post).setUint32(0, 0x30000); view(post).setInt16(8, -100); view(post).setInt16(10, 50);
  const codes = [{ text: ' ', gid: 1 }, { text: '\u00a0', gid: 1 }, ...entries.map((g, i) => ({ text: g.text, gid: i + 2 }))]
    .sort((a, b) => a.text.charCodeAt(0) - b.text.charCodeAt(0));
  const tables = [...new Map([['head', head], ['hhea', hhea], ['maxp', maxp], ['OS/2', os2], ['hmtx', hmtx],
    ['loca', loca], ['glyf', glyf], ['cmap', cmap(codes)], ['name', names(name, bold)], ['post', post]])].sort(([a], [b]) => a < b ? -1 : 1);
  const size = tables.reduce((n, [, bytes]) => n + align(bytes.length), 12 + tables.length * 16);
  if (size > OCR_FONT_LIMITS.bytes) return null;
  const bytes = new Uint8Array(size), output = view(bytes), power = 2 ** Math.floor(Math.log2(tables.length));
  output.setUint32(0, 0x10000); output.setUint16(4, tables.length); output.setUint16(6, power * 16);
  output.setUint16(8, Math.log2(power)); output.setUint16(10, tables.length * 16 - power * 16);
  let cursor = 12 + tables.length * 16, headOffset = 0;
  tables.forEach(([tag, table], i) => {
    check(); const at = 12 + i * 16; bytes.set(Uint8Array.from(tag, c => c.charCodeAt(0)), at);
    output.setUint32(at + 4, sum(table)); output.setUint32(at + 8, cursor); output.setUint32(at + 12, table.length); bytes.set(table, cursor);
    if (tag === 'head') headOffset = cursor; cursor += align(table.length);
  });
  output.setUint32(headOffset + 8, (0xb1b0afba - sum(bytes)) >>> 0); check();
  return { bytes, name, glyphs: entries.map(g => g.text).join(''), fsType: 0, weight: bold ? 700 : 400, bold, italic: false,
    origin: 'generated-ocr-outline', units, ascent, descent };
}

/** Accept only the deterministic, instruction-free format generated above.
 * Rebuilding independently decoded coordinates also binds names, Unicode,
 * blank advances, style, table checksums and provenance point counts. It never
 * accepts a relabelled external program as a newly generated OCR font.
 */
export function matchesOcrTtf(bytes, name, characters, bold, observations) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 172 || bytes.length > OCR_FONT_LIMITS.bytes
    || !isOcrFontName(name) || typeof characters !== 'string' || characters.length < 1
    || characters.length > OCR_FONT_LIMITS.glyphs || !Array.isArray(observations)) return false;
  try {
    const data = view(bytes), tables = new Map();
    if (data.getUint32(0) !== 0x10000 || data.getUint16(4) !== 10) return false;
    for (let i = 0; i < 10; i++) {
      const at = 12 + i * 16, tag = String.fromCharCode(...bytes.subarray(at, at + 4));
      const offset = data.getUint32(at + 8), length = data.getUint32(at + 12);
      if (offset < 172 || offset > bytes.length || length > bytes.length - offset || tables.has(tag)) return false;
      tables.set(tag, bytes.subarray(offset, offset + length));
    }
    const loca = view(tables.get('loca')), metrics = view(tables.get('hmtx')), glyf = tables.get('glyf');
    const ordered = [...characters].sort((a, b) => a.charCodeAt(0) - b.charCodeAt(0));
    const proof = new Map(observations.map(g => [g.text, g.points]));
    if (ordered.join('') !== characters || new Set(ordered).size !== ordered.length || proof.size !== ordered.length) return false;
    const glyphs = []; let total = 0;
    for (let i = 0; i < ordered.length; i++) {
      const gid = i + 2, start = loca.getUint32(gid * 4), stop = loca.getUint32((gid + 1) * 4);
      if (start > stop || stop > glyf.length || stop - start < 20) return false;
      const glyph = view(glyf.subarray(start, stop)), count = glyph.getInt16(0);
      if (count < 1 || count > 512) return false;
      const ends = Array.from({ length: count }, (_, n) => glyph.getUint16(10 + n * 2)), points = ends.at(-1) + 1;
      const flags = 12 + count * 2, xAt = flags + points, yAt = xAt + points * 2;
      if (points < 4 || points > 8192 || (total += points) > OCR_FONT_LIMITS.points || proof.get(ordered[i]) !== points
        || glyph.getUint16(10 + count * 2) !== 0 || align(yAt + points * 2) !== stop - start) return false;
      const coordinates = []; let x = 0, y = 0;
      for (let n = 0; n < points; n++) {
        if (glyph.getUint8(flags + n) !== 1) return false;
        x += glyph.getInt16(xAt + n * 2); y += glyph.getInt16(yAt + n * 2); coordinates.push([x, y]);
      }
      let cursor = 0; const contours = [];
      for (const end of ends) {
        if (end + 1 - cursor < 4 || end >= points) return false;
        contours.push(coordinates.slice(cursor, end + 1)); cursor = end + 1;
      }
      glyphs.push({ text: ordered[i], advance: metrics.getUint16(gid * 4), contours });
    }
    const rebuilt = buildOcrTtf(glyphs, name, { bold });
    return Boolean(rebuilt && rebuilt.bytes.length === bytes.length && rebuilt.bytes.every((value, i) => value === bytes[i]));
  } catch { return false; }
}
