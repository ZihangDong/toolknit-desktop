// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.

export const SOURCE_FONT_LIMITS = Object.freeze({ bytes: 12 * 1024 * 1024, totalBytes: 16 * 1024 * 1024, fonts: 32, glyphs: 4096 });
const tagName = /^[A-Za-z0-9 /]{4}$/;
// Windows GDI/WPS face names must fit LF_FACESIZE (31 visible characters).
// A 96-bit digest keeps the document alias deterministic and within that limit.
export const isSourceFontName = name => typeof name === 'string' && /^TKPdf[0-9a-f]{24}$/.test(name);
export const sourceFontAssetId = name => isSourceFontName(name) ? 'font:' + name : null;
export const sourceFontCandidateName = name => typeof name === 'string' && name.length > 0 && name.length <= 160
  && !/[\x00-\x1f<>]/.test(name)
  && !/^(?:[A-Z]{6}\+)?(?:Arial|Helvetica|Times|Courier|Nimbus|Calibri|Cambria|CM[A-Z]*\d|MSBM\d|SimSun|SimHei|KaiTi|FangSong|XITS|STIX|Symbol|Wingdings)/i.test(name);
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const align = n => Math.ceil(n / 4) * 4;
const u16 = (bytes, at) => view(bytes).getUint16(at);
const u32 = (bytes, at) => view(bytes).getUint32(at);

/** Data-only subset of an explicit two-byte ToUnicode CMap. No PostScript,
 * inherited usecmap, multi-character substitution or ambiguous Unicode aliasing.
 * The caller separately proves the PDF font's Identity-H/CIDToGID identity.
 */
export function sourceFontUnicodeMap(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 256 * 1024) return null;
  const text = new TextDecoder('latin1').decode(bytes).replace(/%[^\r\n]*/g, '');
  if (/\busecmap\b/.test(text) || !/\bbegincmap\b/.test(text) || !/\bendcmap\b/.test(text)
    || !/1\s+begincodespacerange\s*<0000>\s*<FFFF>\s*endcodespacerange/i.test(text)) return null;
  const mapping = new Map(), cids = new Map(); let blocks = 0, entries = 0, failed = false;
  const put = (cid, unicode) => {
    if (++entries > SOURCE_FONT_LIMITS.glyphs || unicode.length !== 4 || !/^[0-9a-f]{4}$/i.test(unicode)) { failed = true; return; }
    const point = parseInt(unicode, 16);
    if (point < 0x20 || point >= 0xfffe || point >= 0x7f && point <= 0x9f || point >= 0xd800 && point <= 0xdfff
      || cid < 1 || cid > 65535 || cids.has(cid) && cids.get(cid) !== point || mapping.has(point) && mapping.get(point) !== cid) { failed = true; return; }
    cids.set(cid, point); mapping.set(point, cid);
  };
  for (const match of text.matchAll(/(\d+)\s+beginbfchar\b([\s\S]*?)\bendbfchar\b/g)) {
    if (++blocks > 128) return null;
    let count = 0;
    const rest = match[2].replace(/<([0-9a-f]{4})>\s*<([0-9a-f]+)>/gi, (_, cid, point) => { count++; put(parseInt(cid, 16), point); return ''; });
    if (rest.trim() || count !== Number(match[1])) return null;
  }
  for (const match of text.matchAll(/(\d+)\s+beginbfrange\b([\s\S]*?)\bendbfrange\b/g)) {
    if (++blocks > 128) return null;
    let count = 0;
    const rest = match[2].replace(/<([0-9a-f]{4})>\s*<([0-9a-f]{4})>\s*(<([0-9a-f]{4})>|\[([^\]]*)\])/gi, (_, start, end, target, first, list) => {
      count++; const from = parseInt(start, 16), to = parseInt(end, 16);
      if (to < from || to - from >= SOURCE_FONT_LIMITS.glyphs) { failed = true; return ''; }
      const values = list === undefined ? null : [...list.matchAll(/<([0-9a-f]{4})>/gi)].map(value => value[1]);
      if (values && (values.length !== to - from + 1 || list.replace(/<[0-9a-f]{4}>/gi, '').trim())) { failed = true; return ''; }
      for (let cid = from; cid <= to && !failed; cid++) put(cid, values ? values[cid - from] : (parseInt(first, 16) + cid - from).toString(16).padStart(4, '0'));
      return '';
    });
    if (rest.trim() || count !== Number(match[1])) return null;
  }
  return !failed && blocks && mapping.size ? mapping : null;
}

function tableDirectory(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes.length > SOURCE_FONT_LIMITS.bytes || u32(bytes, 0) !== 0x00010000) return null;
  const count = u16(bytes, 4), end = 12 + count * 16;
  if (count < 5 || count > 32 || end > bytes.length) return null;
  const tables = new Map(), ranges = [];
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16, tag = String.fromCharCode(...bytes.subarray(at, at + 4)), offset = u32(bytes, at + 8), size = u32(bytes, at + 12);
    // PDF subset writers sometimes pack tables without sfnt's four-byte padding.
    // Bounds/nonoverlap still hold; the rebuilt document font restores alignment.
    if (!tagName.test(tag) || tables.has(tag) || offset < end || offset > bytes.length || size > bytes.length - offset
      || ranges.some(([start, stop]) => size && offset < stop && offset + size > start)) return null;
    ranges.push([offset, offset + size]); tables.set(tag, bytes.subarray(offset, offset + size));
  }
  return tables;
}

/** Permissions come from the ORIGINAL font program. PDF.js clears fsType while
 * repairing browser fonts, so its repaired OS/2 must never authorize embedding.
 */
export function inspectSourceTtf(bytes) {
  const tables = tableDirectory(bytes), head = tables?.get('head'), os2 = tables?.get('OS/2'), maxp = tables?.get('maxp'), hhea = tables?.get('hhea');
  if (!head || head.length < 54 || !os2 || os2.length < 78 || !maxp || maxp.length < 32 || u32(maxp, 0) !== 0x00010000 || !hhea || hhea.length < 36
    || !tables.has('glyf') || !tables.has('loca') || !tables.has('hmtx') || !tables.has('name') || u32(head, 12) !== 0x5f0f3cf5) return null;
  const fsType = u16(os2, 8), units = u16(head, 18), glyphCount = u16(maxp, 4), selection = u16(os2, 62), weight = u16(os2, 4);
  const locaFormat = view(head).getInt16(50), metrics = u16(hhea, 34);
  if (units < 16 || units > 16384 || glyphCount < 2 || ![0, 1].includes(locaFormat) || metrics < 1 || metrics > glyphCount
    || tables.get('loca').length < (glyphCount + 1) * (locaFormat ? 4 : 2)
    || tables.get('hmtx').length < metrics * 4 + (glyphCount - metrics) * 2
    || ['SVG ', 'CBDT', 'CBLC', 'sbix', 'fvar', 'gvar', 'CFF ', 'CFF2'].some(tag => tables.has(tag))
    || fsType & ~0x030e || fsType & (2 | 0x100 | 0x200)
    || fsType !== 0 && !(fsType & 8) || tables.get('name').length > 65535) return null;
  return { fsType, units, glyphCount, bold: Boolean(selection & 32 || weight >= 700 && weight <= 1000),
    italic: Boolean(selection & (1 | 512)), weight: weight >= 100 && weight <= 900 ? weight : 400 };
}

function cmapTable(mapping, glyphCount) {
  if (!(mapping instanceof Map) || !mapping.size || mapping.size > SOURCE_FONT_LIMITS.glyphs) return null;
  const pairs = [...mapping].sort((a, b) => a[0] - b[0]);
  if (pairs.some(([point, glyph]) => !Number.isInteger(point) || point < 0x20 || point >= 0xfffe || point >= 0x7f && point <= 0x9f
    || point >= 0xd800 && point <= 0xdfff || !Number.isInteger(glyph) || glyph < 1 || glyph >= glyphCount)) return null;
  const count = pairs.length + 1, length = 16 + count * 8, bytes = new Uint8Array(12 + length), data = view(bytes), offset = 12;
  data.setUint16(2, 1); data.setUint16(4, 3); data.setUint16(6, 1); data.setUint32(8, offset);
  data.setUint16(offset, 4); data.setUint16(offset + 2, length); data.setUint16(offset + 6, count * 2);
  const power = 2 ** Math.floor(Math.log2(count)); data.setUint16(offset + 8, power * 2); data.setUint16(offset + 10, Math.log2(power)); data.setUint16(offset + 12, count * 2 - power * 2);
  for (let i = 0; i < count; i++) {
    const point = i < pairs.length ? pairs[i][0] : 0xffff, glyph = i < pairs.length ? pairs[i][1] : 0;
    data.setUint16(offset + 14 + i * 2, point); data.setUint16(offset + 16 + count * 2 + i * 2, point);
    data.setUint16(offset + 16 + count * 4 + i * 2, (glyph - point) & 0xffff);
  }
  return bytes;
}

function nameTable(original, name) {
  if (original.length < 6 || u16(original, 0) !== 0) return null;
  const count = u16(original, 2), start = u16(original, 4);
  if (count > 512 || start < 6 + count * 12 || start > original.length) return null;
  const records = [], strings = []; let length = 0, families = 0;
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12, platform = u16(original, at), id = u16(original, at + 6), size = u16(original, at + 8), offset = start + u16(original, at + 10);
    if (offset > original.length || size > original.length - offset) return null;
    let text = original.slice(offset, offset + size);
    if ([1, 4, 6, 16].includes(id)) {
      if (![0, 1, 3].includes(platform)) return null;
      text = platform === 1 ? Uint8Array.from(name, c => c.charCodeAt(0)) : Uint8Array.from([...name].flatMap(c => [0, c.charCodeAt(0)]));
      if (id === 1 || id === 16) families++;
    }
    const record = original.slice(at, at + 12); view(record).setUint16(8, text.length); view(record).setUint16(10, length);
    records.push(record); strings.push(text); length += text.length;
  }
  if (!families || 6 + count * 12 + length > 65535) return null;
  const result = new Uint8Array(6 + count * 12 + length), data = view(result); data.setUint16(2, count); data.setUint16(4, 6 + count * 12);
  records.forEach((record, i) => result.set(record, 6 + i * 12)); let cursor = 6 + count * 12;
  strings.forEach(string => { result.set(string, cursor); cursor += string.length; });
  return result;
}

function checksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) sum = (sum + (((bytes[i] || 0) * 0x1000000 + (bytes[i + 1] || 0) * 0x10000 + (bytes[i + 2] || 0) * 0x100 + (bytes[i + 3] || 0)) >>> 0)) >>> 0;
  return sum;
}

/** Rebuild only Unicode/name metadata needed by document readers. Glyph programs,
 * metrics, copyright/licensing records and original permission bits are retained.
 */
export function buildSourceTtf(bytes, mapping, name) {
  const info = inspectSourceTtf(bytes);
  if (!info || !isSourceFontName(name)) return null;
  const tables = tableDirectory(bytes), cmap = cmapTable(mapping, info.glyphCount), names = nameTable(tables.get('name'), name);
  if (!cmap || !names) return null;
  tables.set('cmap', cmap); tables.set('name', names);
  if (!tables.has('post')) {
    if (info.italic) return null;
    const post = new Uint8Array(32); view(post).setUint32(0, 0x00030000); view(post).setInt16(8, -Math.round(info.units / 10)); view(post).setInt16(10, Math.max(1, Math.round(info.units / 20))); tables.set('post', post);
  }
  const entries = [...tables].sort(([a], [b]) => a.localeCompare(b)), size = entries.reduce((sum, [, data]) => sum + align(data.length), 12 + entries.length * 16);
  if (size > SOURCE_FONT_LIMITS.bytes) return null;
  const result = new Uint8Array(size), output = view(result), count = entries.length, power = 2 ** Math.floor(Math.log2(count));
  output.setUint32(0, 0x00010000); output.setUint16(4, count); output.setUint16(6, power * 16); output.setUint16(8, Math.log2(power)); output.setUint16(10, count * 16 - power * 16);
  let cursor = 12 + count * 16, headOffset = 0;
  entries.forEach(([tag, data], index) => {
    const at = 12 + index * 16; result.set(Uint8Array.from(tag, c => c.charCodeAt(0)), at); output.setUint32(at + 8, cursor); output.setUint32(at + 12, data.length); result.set(data, cursor);
    if (tag === 'head') { headOffset = cursor; output.setUint32(cursor + 8, 0); }
    output.setUint32(at + 4, checksum(result.subarray(cursor, cursor + data.length))); cursor += align(data.length);
  });
  output.setUint32(headOffset + 8, (0xb1b0afba - checksum(result)) >>> 0);
  return inspectSourceTtf(result)?.fsType === info.fsType ? { bytes: result, ...info, name } : null;
}
