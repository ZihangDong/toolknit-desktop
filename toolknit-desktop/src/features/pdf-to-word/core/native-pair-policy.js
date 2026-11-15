// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { nativePairRuns, MAX_NATIVE_PAIR_GLYPHS, MAX_NATIVE_PAIR_RUNS } from './native-pair-spacing.js';

const family = value => String(value || '').replace(/^[A-Z]{6}\+/, '')
  .replace(/(?:[-,](?:BoldItalic|BoldOblique|Bold|Italic|Oblique|Regular))?(?:PSMT|MT)?$/i, '')
  .replace(/PS$/i, '').replace(/[\s-]/g, '').toLowerCase().replace(/^nimbusromno9lregu$/, 'timesnewroman');
const compatibleRoman=name=>/^(?:[A-Z]{6}\+)?NimbusRomNo9L-Regu$/i.test(name||'');
const allowed = (proof, pair) => !proof.italic && (family(proof.sourceFont) === 'arial' && proof.bold && ['Te', 'Ts'].includes(pair)
  || family(proof.sourceFont) === 'timesnewroman' && (proof.bold ? pair === 'Ts' : ['We'].includes(pair)||compatibleRoman(proof.sourceFont)&&pair==='Va'));

/** The evidence remains an immutable description of the original PDF. This
 * inherited style never relabels newly typed characters as original glyphs. */
export function nativePairEditStyle(item) {
  const policy = item?.nativePairPolicy, proof = policy?.evidence || item?.nativePairSpacing;
  if (!proof || proof.version !== 1 || typeof proof.text !== 'string'
    || typeof item.text !== 'string' || !item.text.length || item.text.length > MAX_NATIVE_PAIR_GLYPHS
    || !Array.isArray(proof.glyphs) || proof.glyphs.length < 2 || proof.glyphs.length > MAX_NATIVE_PAIR_GLYPHS
    || proof.text.length !== proof.glyphs.length || !/^[A-Za-z]+$/.test(proof.text)
    || typeof proof.sourceFont !== 'string' || !proof.sourceFont.length || proof.sourceFont.length > 160
    || !Number.isFinite(proof.size) || proof.size <= 0 || !Number.isFinite(proof.origin)
    || !Number.isFinite(proof.advance) || proof.advance <= 0) return null;
  // Bound and validate every slot before map/slice arithmetic. Indexed access
  // deliberately rejects sparse arrays as well as explicit null/invalid glyphs.
  for (let i = 0; i < proof.glyphs.length; i++) {
    const g = proof.glyphs[i];
    if (!g || typeof g !== 'object' || typeof g.text !== 'string' || g.text.length !== 1
      || !Number.isFinite(g.offset) || !Number.isFinite(g.advance) || g.advance <= 0) return null;
  }
  if (proof.text !== proof.glyphs.map(g => g.text).join('')
    || policy && policy.version !== 1 || item.ocr || item.raster || item.nativeCalibrated || item.alphabet
    || proof.sourceFont !== (item.sourceFont || item.font) || proof.size !== item.size
    || proof.bold !== Boolean(item.bold) || proof.italic !== Boolean(item.italic)) return null;
  const moves = proof.glyphs.slice(0, -1).map((g, i) => ({ pair: proof.text.slice(i, i + 2), delta: proof.glyphs[i + 1].offset - g.offset - g.advance }));
  if (moves.some(p => !Number.isFinite(p.delta)) || !moves.some(p => Math.abs(p.delta) > .01)
    || moves.some(p => Math.abs(p.delta) > .01 && !allowed(proof, p.pair))) return null;
  const map = policy ? item.nativePairMap : [...proof.text].map((_, i) => i);
  if (!Array.isArray(map) || map.length !== item.text.length || !policy && item.text !== proof.text) return null;
  return { ...item, nativePairPolicy: policy || { version: 1, evidence: proof }, nativePairMap: [...map] };
}

export function nativePairPolicyRuns(item, context, options) {
  if (!item?.nativePairPolicy) return null;
  const style = nativePairEditStyle(item), proof = style?.nativePairPolicy.evidence;
  if (!style || !/^[\x20-\x7e]{1,64}$/.test(item.text) || item.fontAssetId || item.characterSpacing !== undefined
    || item.userTracking !== undefined || item.horizontalScale !== 1 || item.glyphScale !== undefined && item.glyphScale !== 100
    || options?.size !== (compatibleRoman(proof.sourceFont)?Math.round(proof.size*2):proof.size*2) || Boolean(options.bold) !== proof.bold || Boolean(options.italics) !== proof.italic
    || family(options.font?.ascii) !== family(proof.sourceFont)) return null;
  const map = style.nativePairMap;
  if (map.some((n, i) => n !== null && (!Number.isInteger(n) || n < 0 || n >= proof.text.length || proof.text[n] !== item.text[i]))
    || map.filter(n => n !== null).some((n, i, a) => i && n <= a[i - 1])) return null;
  // Validate the old proof against the actual current face, independently of
  // the edited spelling or its new physical origin/advance.
  const original = { ...item, text: proof.text, baselineX: proof.origin, advanceWidth: proof.advance,
    nativePairSpacing: proof, nativePairPolicy: undefined, nativePairMap: undefined };
  if (!nativePairRuns(original, context, options)) return null;
  const saved = { font: context.font, fontKerning: context.fontKerning, letterSpacing: context.letterSpacing };
  try {
    context.font = `${options.bold ? 'bold ' : ''}1000px "${options.font.ascii.replaceAll('"', '')}"`;
    context.fontKerning = 'none'; if ('letterSpacing' in context) context.letterSpacing = '0px';
    const scale = options.size / 2000, chars = [...item.text], widths = chars.map(c => context.measureText(c).width * scale);
    if (widths.some(n => !Number.isFinite(n) || n <= 0)) return null;
    const desired = [], spacing = [];
    for (let i = 0; i < chars.length; i++) {
      let advance = widths[i];
      if (i + 1 < chars.length && map[i] !== null && map[i + 1] === map[i] + 1) {
        advance = proof.glyphs[map[i + 1]].offset - proof.glyphs[map[i]].offset;
      } else if (i + 1 < chars.length && allowed(proof, item.text.slice(i, i + 2))) {
        context.fontKerning = 'normal';
        advance = context.measureText(item.text.slice(i, i + 2)).width * scale - widths[i + 1];
        context.fontKerning = 'none';
      } else if (i + 1 === chars.length && map[i] !== null) advance = proof.glyphs[map[i]].advance;
      if (!Number.isFinite(advance) || advance <= 0 || Math.abs(advance - widths[i]) > item.size * .25) return null;
      const drift=compatibleRoman(proof.sourceFont)?desired.reduce((sum,n)=>sum+n,0)-widths.slice(0,i).reduce((sum,n)=>sum+n,0)-spacing.reduce((sum,n)=>sum+n/20,0):0;
      desired.push(advance); spacing.push(Math.round((advance-widths[i]+drift)*20)||0);
    }
    let encoded = 0, expected = 0;
    for (let i = 0; i < chars.length; i++) {
      if (Math.abs(encoded - expected) > .05 + 1e-8) return null;
      encoded += widths[i] + spacing[i] / 20; expected += desired[i];
    }
    if (Math.abs(encoded - expected) > .05 + 1e-8) return null;
    const runs = [];
    for (let i = 0; i < chars.length;) {
      let end = i + 1; while (end < chars.length && spacing[end] === spacing[i]) end++;
      runs.push({ text: item.text.slice(i, end), spacing: spacing[i], kern: 32767 });
      if (runs.length > MAX_NATIVE_PAIR_RUNS) return null; i = end;
    }
    return runs;
  } catch { return null; }
  finally {
    context.font = saved.font; context.fontKerning = saved.fontKerning;
    if ('letterSpacing' in context) context.letterSpacing = saved.letterSpacing;
  }
}

/** Use the exact explicit run advances consumed by Canvas and Word. A valid
 * inherited policy which cannot be encoded rejects fitting instead of losing
 * the unchanged prefix's spacing style silently. */
export function nativePairMeasure(text, item, context) {
  const style = nativePairEditStyle(item);
  if (!style || /^\s*$/u.test(text)) return null;
  let map = style.nativePairMap;
  if (text !== style.text) map = style.text.startsWith(text) ? map.slice(0, text.length) : [...text].map(() => null);
  const value = { ...style, text, nativePairMap: map };
  const options = { font: { ascii: family(style.nativePairPolicy.evidence.sourceFont) === 'arial' ? 'Arial' : 'Times New Roman' },
    size: Math.round(style.size * 2), bold: Boolean(style.bold), italics: Boolean(style.italic) };
  const runs = nativePairPolicyRuns(value, context, options);
  if (!runs) return NaN;
  const saved = { font: context.font, fontKerning: context.fontKerning, letterSpacing: context.letterSpacing };
  try {
    context.font = `${options.bold ? 'bold ' : ''}1000px "${options.font.ascii}"`;context.fontKerning = 'none';
    if ('letterSpacing' in context) context.letterSpacing = '0px';
    return runs.reduce((sum, r) => sum + context.measureText(r.text).width * options.size / 2000 + r.spacing / 20 * r.text.length, 0);
  } finally {
    context.font = saved.font; context.fontKerning = saved.fontKerning;
    if ('letterSpacing' in context) context.letterSpacing = saved.letterSpacing;
  }
}
