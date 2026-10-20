// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
const portableFamilies = new Map(['Arial', 'Times New Roman', 'Courier New', 'Calibri', 'Cambria', 'Cambria Math',
  'Georgia', 'Palatino Linotype', 'Verdana', 'Tahoma', 'Segoe UI', 'Trebuchet MS', 'Comic Sans MS', 'Consolas', 'Lucida Console',
  'Symbol', 'Wingdings', 'Webdings', 'SimSun', 'SimHei', 'KaiTi', 'FangSong', 'Microsoft YaHei']
  .map(name => [name.replace(/\s/g, '').toLowerCase(), name]));
const genericFamilies = Object.freeze({ serif: 'Times New Roman', 'sans-serif': 'Arial', monospace: 'Courier New' });

export function wordLineMetrics(family, ascent, descent) {
  // Palatino's four Windows faces share these hhea and OS/2 Win metrics.
  // Apply only when Canvas exposes the matching hhea values; some backends
  // already expose Win metrics or substitute another font.
  if (family === 'Palatino Linotype' && Math.abs(ascent - 1499 / 2048) < .001
    && Math.abs(descent - 582 / 2048) < .001) return { ascent: 2150 / 2048, descent: 613 / 2048 };
  return null;
}

export function wordFont(name, fallbackFamily) {
  let family = String(name || '').replace(/^[A-Z]{6}\+/, '').replace(/[-,](Regular|BoldItalic|Bold|Italic|Oblique)$/i, '');
  // Some PDF names contain UTF-8 bytes exposed as Latin-1. Decode only a valid
  // byte sequence; ordinary Unicode and genuine Latin-1 names stay unchanged.
  if ([...family].every(character => character.codePointAt(0) <= 255)) {
    try { family = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(family, character => character.charCodeAt(0))); } catch {}
  }
  if (/simsun|song|宋/i.test(family)) return /fangsong|仿宋/i.test(family) ? 'FangSong' : 'SimSun';
  if (/simhei|黑体/i.test(family)) return 'SimHei';
  if (/kaiti|楷/i.test(family)) return 'KaiTi';
  if (/^FZ(?:HT|DH)/i.test(family)) return 'SimHei';
  if (/^FZY\dK/i.test(family)) return 'SimHei';
  if (/^FZ(?:KT|K)/i.test(family)) return 'KaiTi';
  if (/^FZ(?:DBS|SS|S|XBS)/i.test(family)) return 'SimSun';
  if (/yahei|微软雅黑/i.test(family)) return 'Microsoft YaHei';
  if (/helvetica|arial|^NimbusSans|^NimbusSanL/i.test(family)) return 'Arial';
  if (/^(?:URWPalladioL|Palladio|P052|Palatino(?:Linotype)?|BookAntiqua)(?:$|[-,])/i.test(family)) return 'Palatino Linotype';
  if (/times|^NimbusRoman|^NimbusRomNo9L/i.test(family)) return 'Times New Roman';
  if (/courier|^NimbusMono|^NimbusMonL/i.test(family)) return 'Courier New';
  if (/^E-[A-Z0-9]+$/i.test(family)) return 'Times New Roman';
  const portable = portableFamilies.get(family.replace(/\s/g, '').toLowerCase());
  if (portable) return portable;
  // Uninstalled PostScript families can resolve to unrelated Office defaults.
  // Use the PDF renderer's generic family so measurement and Word agree.
  if (Object.hasOwn(genericFamilies, fallbackFamily)) return genericFamilies[fallbackFamily];
  return family && family.length <= 80 && !/[<>\x00-\x1f\x7f-\x9f]/.test(family) ? family : 'SimSun';
}

export function mathWordFont(glyph) {
  // Common text faces omit many Unicode math symbols. Measuring their missing
  // glyph and letting Office choose another face produces unrelated geometry.
  if (glyph.alphabet || [...glyph.text].some(character => character.codePointAt(0) > 127 && /\p{Sm}/u.test(character))) return 'Cambria Math';
  const mapped = wordFont(glyph.font);
  return ['Times New Roman', 'Arial', 'Courier New', 'Cambria Math', 'Symbol'].includes(mapped) ? mapped : 'Cambria Math';
}

export function outputWordFont(name) {
  const family = wordFont(name);
  // LibreOffice substitutes the English aliases despite the Windows faces
  // being installed. Their localized family names select the intended faces.
  return family === 'KaiTi' ? '\u6977\u4f53' : family === 'FangSong' ? '\u4eff\u5b8b' : family;
}
