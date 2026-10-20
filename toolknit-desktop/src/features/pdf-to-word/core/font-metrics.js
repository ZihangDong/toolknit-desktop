// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import fontkit from '@pdf-lib/fontkit';
import { LIMITS, wordError } from './input.js';
import { normalizeTexSymbol, texSymbolCandidate } from './tex-symbol.js';
import { glyphInkBounds } from './font-outline.js';
import { identifyTexRadicalPart, texRadicalPartCandidate } from './tex-radical.js';
import { identifyTexDelimiter, texDelimiterCandidate } from './tex-delimiter.js';

/** Read repaired PDF.js font outlines and metadata; no fonts enter DOCX. */
export function createGlyphMetrics(fonts) {
  let bytes = 0;
  for (const font of Object.values(fonts)) bytes += font.data?.byteLength || 0;
  if (bytes > LIMITS.assetBytes) throw wordError('complexity');
  const parsed = new Map(), cache = new Map(), symbolCache = new Map(), radicalCache = new Map(), delimiterCache = new Map();
  const font = id => {
    if (!parsed.has(id)) {
      try { parsed.set(id, fonts[id]?.data?.length ? fontkit.create(fonts[id].data) : null); }
      catch { parsed.set(id, null); }
    }
    return parsed.get(id);
  };
  const measure = (id, glyph, { fillOnly = false } = {}) => {
    if (!glyph?.fontChar || glyph.accent || fonts[id]?.type3 || fonts[id]?.vertical || fonts[id]?.missingFile) return null;
    const key = `${id}:${glyph.fontChar}:${fillOnly ? 'fill' : 'stroke'}`;
    if (cache.has(key)) return cache.get(key);
    let result = null;
    try {
      const face = font(id);
      if (face && face.unitsPerEm > 0 && [...glyph.fontChar].length === 1) {
        const outline = face.glyphForCodePoint(glyph.fontChar.codePointAt(0));
        if (outline.id !== 0) {
          const box = glyphInkBounds(outline, fillOnly), unit = face.unitsPerEm;
          const values = [box.minX / unit, box.minY / unit, box.maxX / unit, box.maxY / unit];
          if (values.every(Number.isFinite) && values.every(value => Math.abs(value) <= 8)
            && values[2] > values[0] && values[3] > values[1]) result = values;
        }
      }
    } catch { parsed.set(id, null); }
    cache.set(key, result);
    return result;
  };
  const lineMetrics = id => {
    try {
      const face = font(id), os2 = face?.['OS/2'], unit = face?.unitsPerEm;
      if (!(unit > 0) || !os2 || os2.fsSelection?.useTypoMetrics) return null;
      const metrics = { ascent: face.ascent / unit, descent: -face.descent / unit,
        winAscent: os2.winAscent / unit, winDescent: os2.winDescent / unit };
      return Object.values(metrics).every(value => Number.isFinite(value) && value >= 0 && value <= 2) ? metrics : null;
    } catch { return null; }
  };
  const style = id => {
    try {
      const face = font(id);
      if (!face) return null;
      const os2 = face['OS/2'], head = face.head, angle = face.post?.italicAngle;
      return { name: face.postscriptName || face.familyName || '',
        bold: Boolean(os2?.fsSelection?.bold || head?.macStyle?.bold || os2?.usWeightClass >= 700 && os2.usWeightClass <= 1000),
        italic: Boolean(os2?.fsSelection?.italic || os2?.fsSelection?.oblique || head?.macStyle?.italic
          || Number.isFinite(angle) && Math.abs(angle) > .01 && Math.abs(angle) <= 90) };
    } catch { return null; }
  };
  const symbol = (id, glyph) => {
    if (!texSymbolCandidate(fonts[id]?.name, glyph)) return null;
    const key = `${id}:${glyph.originalCharCode}:${glyph.fontChar}:${glyph.unicode}`;
    if (symbolCache.has(key)) return symbolCache.get(key);
    let result = { uncertain: true };
    try {
      const face = font(id);
      if (face && glyph.fontChar && [...glyph.fontChar].length === 1 && glyph.isInFont !== false && !glyph.accent) {
        const outline = face.glyphForCodePoint(glyph.fontChar.codePointAt(0));
        result = normalizeTexSymbol({ fontName: fonts[id].name, embeddedName: face.postscriptName || face.familyName,
          glyph, commands: outline.id ? outline.path.commands : null });
      }
    } catch { /* Uncertain encoding remains a visible image. */ }
    symbolCache.set(key, result); return result;
  };
  const radicalPart = (id, glyph) => {
    if (!texRadicalPartCandidate(fonts[id]?.name, glyph)) return null;
    const key = `${id}:${glyph.originalCharCode}:${glyph.fontChar}`;
    if (radicalCache.has(key)) return radicalCache.get(key);
    if (radicalCache.size >= 128) return { uncertain: true };
    let result = { uncertain: true };
    try {
      const face = font(id);
      if (face && glyph.fontChar && [...glyph.fontChar].length === 1) {
        const outline = face.glyphForCodePoint(glyph.fontChar.codePointAt(0));
        result = identifyTexRadicalPart({ fontName: fonts[id].name, embeddedName: face.postscriptName || face.familyName,
          glyph, commands: outline.id ? outline.path.commands : null });
      }
    } catch { /* Unproven components retain their visible image. */ }
    radicalCache.set(key, result); return result;
  };
  const delimiter = (id, glyph) => {
    if (!texDelimiterCandidate(fonts[id]?.name, glyph)) return null;
    const key = `${id}:${glyph.originalCharCode}:${glyph.fontChar}:${glyph.unicode}`;
    if (delimiterCache.has(key)) return delimiterCache.get(key);
    if (delimiterCache.size >= 128) return { uncertain: true };
    let result = { uncertain: true };
    try {
      const face = font(id);
      if (face && glyph.fontChar && [...glyph.fontChar].length === 1) {
        const outline = face.glyphForCodePoint(glyph.fontChar.codePointAt(0));
        result = identifyTexDelimiter({ fontName: fonts[id].name, embeddedName: face.postscriptName || face.familyName,
          glyph, commands: outline.id ? outline.path.commands : null });
      }
    } catch { /* Unverified bracket pieces keep the visible image. */ }
    delimiterCache.set(key, result); return result;
  };
  return { glyph: measure, lineMetrics, style, symbol, radicalPart, delimiter };
}
