// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.

// This metadata is optional. Old layouts and all unproven text retain the old
// path. Bound source metadata and emitted fragments independently of frames.
export const MAX_NATIVE_PAIR_GLYPHS = 64;
export const MAX_NATIVE_PAIR_PAGE_GLYPHS = 512;
export const MAX_NATIVE_PAIR_RUNS = 8;
const family = name => String(name || '').replace(/^[A-Z]{6}\+/, '')
  .replace(/(?:[-,](?:BoldItalic|BoldOblique|Bold|Italic|Oblique|Regular))?(?:PSMT|MT)?$/i, '')
  .replace(/PS$/i, '').replace(/[\s-]/g, '').toLowerCase().replace(/^nimbusromno9lregu$/, 'timesnewroman');
const compatibleRoman=name=>/^(?:[A-Z]{6}\+)?NimbusRomNo9L-Regu$/i.test(name||'');
const knownFaces = new Set(['arial','timesnewroman','couriernew','calibri','cambria','georgia','verdana','tahoma','segoeui','trebuchetms']);

/** Charge bounded source proof objects and worst-case extra OOXML fragments
 * against the existing layout allowance; the allowance itself is unchanged. */
export function nativePairSpacingBytes(proof) {
  const count = proof?.version === 1 && Array.isArray(proof.glyphs) ? proof.glyphs.length : 0;
  return count >= 2 && count <= MAX_NATIVE_PAIR_GLYPHS
    ? 256 + count * 192 + (Math.min(count, MAX_NATIVE_PAIR_RUNS) - 1) * 512 : 0;
}

/** Retain original single-glyph origins only for bounded, plain native words
 * whose internal source adjustment is lost by uniform word-width fitting. */
export function nativePairSpacing(item, glyphs, { charSpacing = 0, wordSpacing = 0, horizontal = true, compatibleFace = false } = {}) {
  const text = item?.text, sourceFont = item?.sourceFont || item?.font;
  if(compatibleRoman(sourceFont)&&compatibleFace!==true)return null;
  if (!item || item.raster || item.ocr || item.alphabet || item.italic || !item.preciseInk || item.role === 'math'
    || typeof sourceFont !== 'string' || sourceFont.length > 160
    || !knownFaces.has(family(sourceFont)) || !/^[A-Za-z]{2,64}$/.test(text || '')
    || !horizontal || charSpacing !== 0 || wordSpacing !== 0 || item.horizontalScale !== 1
    || !Number.isFinite(item.size + item.baselineX + item.advanceWidth) || item.size < 4 || item.size > 120
    || !Array.isArray(glyphs) || glyphs.length !== text.length) return null;
  const positions = [];
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    if (!g || g.text !== text[i] || !Number.isFinite(g.baselineX + g.baseline + g.advanceWidth)
      || g.advanceWidth <= 0 || Math.abs(g.baseline - glyphs[0].baseline) > .001
      || i && g.baselineX <= glyphs[i - 1].baselineX) return null;
    positions.push({ text: g.text, offset: g.baselineX - item.baselineX, advance: g.advanceWidth });
  }
  if (Math.abs(positions[0].offset) > .001
    || Math.abs(positions.at(-1).offset + positions.at(-1).advance - item.advanceWidth) > .001) return null;
  const adjustments = positions.slice(0, -1).map((g, i) => positions[i + 1].offset - g.offset - g.advance);
  if(compatibleRoman(sourceFont)&&adjustments.some((n,i)=>Math.abs(n)>.01&&text.slice(i,i+2)!=='Va'))return null;
  if (!adjustments.some(n => Math.abs(n) > .01)
    || adjustments.some(n => Math.abs(n) > item.size * .25)) return null;
  return { version: 1, text, sourceFont, size: item.size, bold: Boolean(item.bold), italic: Boolean(item.italic),
    origin: item.baselineX, advance: item.advanceWidth, glyphs: positions };
}

/** Prove the entire source pair pattern against the actual known output face.
 * Then encode local advances as at most eight same-frame fragments. Canvas and
 * DOCX both keep automatic kerning off; no global style is changed. */
export function nativePairRuns(item, context, options) {
  const proof = item?.nativePairSpacing, count = item?.text?.length;
  if (!proof || proof.version !== 1 || proof.text !== item.text || !/^[A-Za-z]{2,64}$/.test(item.text)
    || typeof proof.sourceFont !== 'string' || proof.sourceFont.length > 160
    || !Array.isArray(proof.glyphs) || proof.glyphs.length !== count || count > MAX_NATIVE_PAIR_GLYPHS
    || item.ocr || item.raster || item.alphabet || item.italic || item.role === 'math' || !item.preciseInk
    || item.nativeCalibrated || item.fontAssetId || item.glyphScale !== undefined && item.glyphScale !== 100
    || item.horizontalScale !== 1 || item.characterSpacing !== undefined || item.userTracking !== undefined
    || !Number.isFinite(item.baselineX + item.advanceWidth + item.size)
    || proof.sourceFont !== (item.sourceFont || item.font) || !knownFaces.has(family(proof.sourceFont))
    || family(proof.sourceFont) !== family(options?.font?.ascii)
    || proof.bold !== Boolean(options.bold) || proof.italic !== Boolean(options.italics)
    || (compatibleRoman(proof.sourceFont)?Math.round(proof.size*2)!==options.size:Math.abs(proof.size-options.size/2)>.001)
    || Math.abs(proof.origin - item.baselineX) > .001 || Math.abs(proof.advance - item.advanceWidth) > .001
    || !context || typeof context.measureText !== 'function' || !('fontKerning' in context)) return null;
  const glyphs = proof.glyphs;
  if (!Number.isFinite(proof.origin + proof.advance + proof.size) || proof.advance <= 0
    || glyphs.some((g, i) => g?.text !== item.text[i] || !Number.isFinite(g.offset + g.advance) || g.advance <= 0
      || i && g.offset <= glyphs[i - 1].offset)
    || Math.abs(glyphs[0].offset) > .001
    || Math.abs(glyphs.at(-1).offset + glyphs.at(-1).advance - proof.advance) > .001) return null;
  const saved = { font: context.font, fontKerning: context.fontKerning, letterSpacing: context.letterSpacing };
  try {
    context.font = `${options.italics ? 'italic ' : ''}${options.bold ? 'bold ' : ''}1000px "${options.font.ascii.replaceAll('"', '')}"`;
    if ('letterSpacing' in context) context.letterSpacing = '0px';
    const scale = compatibleRoman(proof.sourceFont)?proof.size/1000:options.size/2000, widths = new Map(), pairs = new Map();
    const measure = text => {
      const value = context.measureText(text).width * scale;
      return Number.isFinite(value) && value > 0 ? value : null;
    };
    context.fontKerning = 'none';
    for (const g of glyphs) if (!widths.has(g.text)) widths.set(g.text, measure(g.text));
    if (glyphs.some(g => !widths.get(g.text) || Math.abs(g.advance - widths.get(g.text)) > .05)) return null;
    const unkerned = measure(item.text), nominal = glyphs.reduce((n, g) => n + widths.get(g.text), 0);
    if (!unkerned || Math.abs(unkerned - nominal) > .05) return null;
    const adjustments = [];
    for (let i = 0; i + 1 < count; i++) {
      const pair = item.text.slice(i, i + 2);
      if (!pairs.has(pair)) { context.fontKerning = 'normal'; pairs.set(pair, measure(pair)); }
      const shaped = pairs.get(pair), desired = glyphs[i + 1].offset - glyphs[i].offset;
      if (!shaped || Math.abs(desired - (shaped - widths.get(glyphs[i + 1].text))) > .05) return null;
      adjustments.push(desired - glyphs[i].advance);
    }
    if (!adjustments.some(n => Math.abs(n) > .01)) return null;
    context.fontKerning = 'normal';
    const shapedWord = measure(item.text);
    if (!shapedWord || Math.abs(shapedWord - proof.advance) > .05) return null;
    // Per-character source deltas, not (whole-word error / character count).
    const paintWidths = new Map([...widths].map(([key,w])=>[key,compatibleRoman(proof.sourceFont)?w*options.size/(proof.size*2):w]));
    let residue=0;
    const spacing = glyphs.map((g, i) => {
      const desired=(i+1<count?glyphs[i+1].offset-g.offset:g.advance)-paintWidths.get(g.text);
      const result=Math.round((desired+(compatibleRoman(proof.sourceFont)?residue:0))*20)||0;
      if(compatibleRoman(proof.sourceFont))residue+=desired-result/20;
      return result;
    });
    // Bound cumulative twip quantization against each original glyph origin.
    // This is an encoding guard; it does not change any acceptance threshold.
    let encoded = 0;
    for (let i = 0; i < count; i++) {
      if (Math.abs(encoded - glyphs[i].offset) > .05 + 1e-8) return null;
      encoded += paintWidths.get(glyphs[i].text) + spacing[i] / 20;
    }
    if (Math.abs(encoded - proof.advance) > .05 + 1e-8) return null;
    const runs = [];
    for (let i = 0; i < count;) {
      let end = i + 1;
      while (end < count && spacing[end] === spacing[i]) end++;
      runs.push({ text: item.text.slice(i, end), spacing: spacing[i], kern: 32767 });
      if (runs.length > MAX_NATIVE_PAIR_RUNS) return null;
      i = end;
    }
    return runs;
  } catch {
    // Extra pair probing cannot make a previously measurable word fail.
    return null;
  } finally {
    context.font = saved.font; context.fontKerning = saved.fontKerning;
    if ('letterSpacing' in context) context.letterSpacing = saved.letterSpacing;
  }
}
