// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
// Source-sized font evidence, shared across a line. OCR spelling is immutable.
import { median, validRect, contains } from '../core/geometry.js';
import { isolatedInkComponents } from '../core/ocr-ink-components.js';
const CJK = ['SimSun', 'KaiTi', 'FangSong', 'SimHei', 'Microsoft YaHei'];
const LATIN = ['Arial', 'Times New Roman', 'Calibri'];
const han = s => /^\p{Script=Han}$/u.test(s || '');
const latin = s => /^[A-Za-z0-9]$/.test(s || '');

/** An opt-in scan-only refinement. Consistent physical em/weight is selected
 * from original pixels; line/word shape signatures alone cannot set emphasis.
 * Tables, native sources, diagrams, formula objects and unresolved text retain
 * their existing policies. No AI, source text correction or raster replacement.
 */
export function refineScanTextTypography(prepared, data, createCanvas, { check = () => {}, pixelBudget = 24_000_000 } = {}) {
  const { scene } = prepared || {}, { pixels, width, height } = data || {};
  if (!prepared?.changed || !scene?.ocr || !(pixels instanceof Uint8ClampedArray) || pixels.length !== width * height * 4
    || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 16_000_000
    || typeof createCanvas !== 'function' || !Number.isFinite(pixelBudget) || pixelBudget < 1 || pixelBudget > 24_000_000) return prepared;
  const sx = width / scene.width, sy = height / scene.height;
  if (![sx, sy].every(v => Number.isFinite(v) && v > 0 && v <= 8)) return prepared;
  const sources = new Map(scene.sources.map(s => [s.id, s])), stats = { lines: 0, words: 0, options: 0 };
  let remaining = pixelBudget, regularEmBudget = Math.min(2_500_000, pixelBudget), measure, paint;
  const cache = new Map();
  try {
    measure = createCanvas(1, 1); paint = createCanvas(1, 1);
    const mc = measure.getContext('2d'), pc = paint.getContext('2d', { willReadFrequently: true });
    const metrics = (text, font, bold = false) => {
      const key = JSON.stringify([text, font, bold]); if (cache.has(key)) return cache.get(key);
      mc.font = `${bold ? 'bold ' : ''}1000px "${font}"`; mc.fontKerning = 'none';
      const m = mc.measureText(text), value = { ascent: m.actualBoundingBoxAscent / 1000, descent: m.actualBoundingBoxDescent / 1000,
        left: m.actualBoundingBoxLeft / 1000, right: m.actualBoundingBoxRight / 1000, advance: m.width / 1000 };
      if (cache.size < 4096) cache.set(key, value); return value;
    };
    const sample = rect => {
      const x = Math.max(0, Math.floor(rect.x * sx) - 3), y = Math.max(0, Math.floor(rect.y * sy) - 3);
      const w = Math.min(width, Math.ceil((rect.x + rect.width) * sx) + 3) - x;
      const h = Math.min(height, Math.ceil((rect.y + rect.height) * sy) + 3) - y;
      if (w < 3 || h < 3 || w > 256 || h > 192 || w * h > 32768 || w * h > remaining) return null;
      remaining -= w * h;
      const mask = new Uint8Array(w * h); let ink = 0;
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const o = ((y + yy) * width + x + xx) * 4, low = Math.min(pixels[o], pixels[o + 1], pixels[o + 2]);
        if (low < 180 && pixels[o + 3] > 240 && Math.max(pixels[o], pixels[o + 1], pixels[o + 2]) - low < 40) { mask[yy * w + xx] = 1; ink++; }
      }
      return ink >= 3 ? { x, y, w, h, mask, ink } : null;
    };
    const proposal = (word, font, bold, size, scale = 100, baseline = null) => {
      const m = metrics(word.text, font, bold), base = baseline ?? word.rect.y + m.ascent * size;
      return { ...word, font, fontFamily: font, bold, size, glyphScale: scale, baseline: base,
        baselineX: word.rect.x + m.left * size * scale / 100, advanceWidth: (m.left + m.right) * size * scale / 100,
        rect: { x: word.rect.x, y: base - m.ascent * size, width: (m.left + m.right) * size * scale / 100, height: (m.ascent + m.descent) * size }, preciseInk: true };
    };
    const score = (word, candidate, s) => {
      if (!s || s.w * s.h * 2 > remaining) return -1;
      remaining -= s.w * s.h * 2; check();
      paint.width = s.w; paint.height = s.h;
      pc.setTransform(1, 0, 0, 1, 0, 0); pc.clearRect(0, 0, s.w, s.h);
      pc.font = `${candidate.bold ? 'bold ' : ''}${candidate.size * sy}px "${candidate.font}"`; pc.fontKerning = 'none';
      pc.setTransform((candidate.glyphScale || 100) / 100 * sx / sy, 0, 0, 1,
        candidate.baselineX * sx - s.x, candidate.baseline * sy - s.y);
      pc.fillStyle = '#000'; pc.fillText(word.text, 0, 0);
      const rgba = pc.getImageData(0, 0, s.w, s.h).data;
      let amount = 0, common = 0;
      for (let i = 0; i < s.mask.length; i++) if (rgba[i * 4 + 3] > 75) { amount++; common += s.mask[i]; }
      s.lastPaintInk = amount;
      return 2 * common / Math.max(1, amount + s.ink);
    };
    const items = scene.items.filter(item => item.type === 'text' && item.ocr && !item.ocrNative && !item.raster && !item.italic && !item.fontAssetId
      && item.words?.length && item.words.length <= 120 && item.sourceIds?.length === 1 && validRect(item.rect)
      && sources.get(item.sourceIds[0])?.disposition === 'editable' && sources.get(item.sourceIds[0]).text === item.text);
    for (const item of items.slice(0, 96)) {
      check();
      if (!/^[A-D]\.[①-⑳]{1,4}$/u.test(item.text)) continue;
      const r = item.rect, x = Math.max(0, Math.floor(r.x * sx) - 3), y = Math.max(0, Math.floor(r.y * sy) - 3);
      const w = Math.min(width, Math.ceil((r.x + r.width) * sx) + 3) - x, h = Math.min(height, Math.ceil((r.y + r.height) * sy) + 3) - y;
      if (w * h > 32768 || w * h > remaining || w < 3 || h < 3) continue;
      remaining -= w * h;
      const mask = new Uint8Array(w * h);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const o = ((y + yy) * width + x + xx) * 4; mask[yy * w + xx] = Math.min(pixels[o], pixels[o + 1], pixels[o + 2]) < 180 ? 1 : 0;
      }
      const parts = isolatedInkComponents(mask, w, h, { check }); if (!parts) continue;
      const outer = parts.filter(p => !parts.some(q => q !== p && q.x <= p.x && q.y <= p.y && q.right >= p.right && q.bottom >= p.bottom));
      if (outer.length !== item.words.length || outer.some(p => !p.x || !p.y || p.right === w || p.bottom === h)) continue;
      const boxes = outer.map(p => ({ x: (x + p.x) / sx, y: (y + p.y) / sy, width: (p.right - p.x) / sx, height: (p.bottom - p.y) / sy }));
      const em = median(boxes.slice(2).map(b => b.height / (metrics('①', 'SimSun').ascent + metrics('①', 'SimSun').descent)));
      const nominal = Math.round(em * 2) / 2;
      if (nominal < 6 || nominal > 30 || boxes[1].height > em * .3 || boxes[1].width > em * .3
        || boxes[1].y < boxes[0].y + boxes[0].height * .55) continue;
      const words = [], proofs = [];
      for (let i = 0; i < item.words.length; i++) {
        const old = { ...item.words[i], rect: boxes[i] }, s = sample(boxes[i]), faces = i === 0 ? LATIN : i === 1 ? ['Times New Roman', 'SimSun'] : ['SimSun'];
        let best = null;
        for (const font of faces) {
          const m = metrics(old.text, font), scale = Math.round(boxes[i].width / ((m.left + m.right) * nominal) * 100);
          if (scale < 65 || scale > 145) continue;
          const c = proposal(old, font, false, nominal, scale), value = score(old, c, s);
          if (!best || value > best.score) best = { word: c, score: value };
        }
        if (!best || best.score < (i === 1 ? .5 : .6)) { words.length = 0; break; }
        best.word.ocrOptionInkFit = { version: 1, score: best.score, originalSize: item.words[i].size, componentRect: boxes[i] };
        words.push(best.word); proofs.push(best.score);
      }
      if (words.length !== item.words.length) continue;
      // Child glyphs own rendering, while the source line keeps its original
      // grouping/order anchors. A punctuation repair must not reorder options.
      item.words = words;
      item.ocrCoherentTypography = { kind: 'isolated-option', version: 1, scores: proofs }; stats.options++;
    }
    const eligible = items.filter(item => !item.ocrCoherentTypography && item.words.filter(w => han(w.text)).length >= 3);
    const evidenceGlyphs = new Map(eligible.map(item => [item, item.words.filter(w => han(w.text) && validRect(w.rect) && w.confidence >= .85 && !w.fontAssetId && !w.italic).map(w => ({ ...w, rect: { ...w.rect } }))]));
    const inkHeight = item => median(evidenceGlyphs.get(item).map(w => w.rect.height));
    for (const item of eligible.slice(0, 64)) {
      check();
      const glyphs = item.words.filter(w => han(w.text) && validRect(w.rect) && w.confidence >= .85 && !w.fontAssetId && !w.italic);
      if (glyphs.length < 3) continue;
      const witnessCount = Math.min(6, glyphs.length);
      const witnesses = Array.from({ length: witnessCount }, (_, i) => glyphs[Math.floor(i * glyphs.length / witnessCount)]);
      const samples = witnesses.map(w => sample(w.rect));
      const peers = eligible.filter(p => Math.abs(p.rect.y - item.rect.y) < item.size * 6
        && Math.min(inkHeight(p), inkHeight(item)) / Math.max(inkHeight(p), inkHeight(item)) > .9);
      const pooledGlyphs = peers.flatMap(p => evidenceGlyphs.get(p));
      const common = CJK.toSorted((a, b) => peers.filter(p => p.font === b).length - peers.filter(p => p.font === a).length)[0];
      const fonts = [...new Set([CJK.includes(item.font) ? item.font : 'SimSun', common, 'SimSun'])];
      const fits = [];
      for (const font of fonts) {
        const sizes = pooledGlyphs.map(w => { const m = metrics(w.text, font); return (m.ascent + m.descent) > .35 ? w.rect.height / (m.ascent + m.descent) : 0; }).filter(n => n >= 4 && n <= 50);
        const size = Math.round(median(sizes) * 2) / 2; if (size < 6 || size > 40) continue;
        const scale = Math.round(median(glyphs.map(w => { const m = metrics(w.text, font); return w.rect.width / ((m.left + m.right) * size) * 100; }).filter(n => n >= 60 && n <= 150)));
        if (scale < 70 || scale > 140) continue;
        for (const bold of [false, true]) {
          const baseline = median(glyphs.map(w => w.rect.y + metrics(w.text, font, bold).ascent * size));
          const ratios = [];
          const scores = witnesses.map((w, i) => { const value = score(w, proposal(w, font, bold, size, scale, baseline), samples[i]);
            ratios.push(samples[i]?.ink / Math.max(1, samples[i]?.lastPaintInk || 0)); return value; });
          if (scores.some(v => v < 0)) continue;
          fits.push({ font, bold, size, scale, baseline, score: median(scores), scores, inkRatio: median(ratios) });
        }
      }
      fits.sort((a, b) => b.score - a.score);
      let fit = fits[0]; if (!fit) continue;
      const boldCohort = peers.length >= 2 && peers.every(p => p.bold === true);
      const ordinaryFlow = !boldCohort && (/^[A-D][.．、]/u.test(item.text) || glyphs.length >= 12 && peers.length >= 2);
      // A rounded cohort em can make a smaller bold face beat the correctly
      // sized regular face. Retry REGULAR faces only on uncertain body text;
      // genuine bold headings keep the established comparison and bounds.
      const ownNominal = font => Math.round(median(glyphs.map(w => { const m = metrics(w.text, font);
        return m.ascent + m.descent > .35 ? w.rect.height / (m.ascent + m.descent) : 0;
      }).filter(n => n >= 4 && n <= 50)) * 2) / 2;
      if (ordinaryFlow && (fit.bold || fit.font === 'SimHei' || fit.score < .76 || Math.abs(ownNominal(fit.font) - fit.size) >= .25)) {
        const original = fit;
        const count = Math.min(12, glyphs.length);
        const retryWords = Array.from({ length: count }, (_, i) => glyphs[Math.floor(i * glyphs.length / count)]);
        const retrySamples = retryWords.map(w => sample(w.rect));
        const reference = retryWords.map((w, i) => score(w, proposal(w, original.font, original.bold, original.size, original.scale, original.baseline), retrySamples[i]));
        const referenceScore = reference.every(s => s >= 0) ? median(reference) : Infinity;
        let bestRetry = -1;
        const regularFonts = [...new Set(['SimSun', fit.font, item.font].filter(font => CJK.includes(font) && font !== 'SimHei'))];
        for (const font of regularFonts) {
          const nominal = ownNominal(font);
          // Ink boxes may miss thin upper/lower strokes; permit the next
          // half-point step without relaxing the original one-point bound.
          for (const size of [...new Set([nominal, nominal - .5, nominal + .5, nominal - 1, nominal + 1])]) {
            if (size < 6 || size > 40 || Math.abs(size - original.size) > 1) continue;
            const cost = retrySamples.reduce((sum, s) => sum + (s ? s.w * s.h * 2 : 0), 0);
            if (!cost || cost > regularEmBudget || cost > remaining || retrySamples.some(s => !s)) continue;
            regularEmBudget -= cost;
            const scale = Math.round(median(glyphs.map(w => { const m = metrics(w.text, font); return w.rect.width / ((m.left + m.right) * size) * 100; }).filter(n => n >= 60 && n <= 150)));
            if (scale < 70 || scale > 140) continue;
            const baseline = median(glyphs.map(w => w.rect.y + metrics(w.text, font).ascent * size));
            const scores = retryWords.map((w, i) => score(w, proposal(w, font, false, size, scale, baseline), retrySamples[i]));
            if (scores.some(s => s < 0)) continue;
            const value = median(scores), improvement = original.bold ? .04 : .03;
            if (value >= .72 && value >= referenceScore + improvement && value > bestRetry) { bestRetry = value; fit = { font, bold: false, size, scale, baseline, score: value, scores,
              regularEmRepair: { version: 1, originalFont: original.font, originalSize: original.size, originalBold: original.bold, before: referenceScore, after: value, witnesses: count } }; }
          }
        }
      }
      if (fit.score < .62) continue;
      if (fit.font === 'SimHei' && !fit.bold && fit.score < .82) {
        const serif = fits.find(f => f.font === 'SimSun' && !f.bold && f.score >= .62 && f.score >= fit.score - .12);
        if (!serif) continue;
        fit = serif;
      }
      const regular = fits.find(f => f.font === fit.font && !f.bold);
      if (fit.bold && regular && fit.score - regular.score < (ordinaryFlow ? .16 : .07)) fit = regular;
      const lineSamples = item.words.map(w => latin(w.text) && validRect(w.rect) ? sample(w.rect) : null);
      const latinWords = item.words.map((w, i) => ({ w, s: lineSamples[i] })).filter(p => p.s);
      let latinFit = null; const latinFits = [];
      if (latinWords.length >= 2) for (const font of LATIN) {
        const size = Math.round(median(latinWords.map(({ w }) => { const m = metrics(w.text, font); return w.rect.height / (m.ascent + m.descent); })) * 2) / 2;
        if (size < 6 || size > 40) continue;
        const scale = Math.round(median(latinWords.map(({ w }) => { const m = metrics(w.text, font); return w.rect.width / ((m.left + m.right) * size) * 100; })));
        if (scale < 70 || scale > 140) continue;
        for (const bold of [false, true]) {
          const baseline = median(latinWords.map(({ w }) => w.rect.y + metrics(w.text, font, bold).ascent * size));
          const ratios = [];
          const value = median(latinWords.slice(0, 6).map(({ w, s }) => { const value = score(w, proposal(w, font, bold, size, scale, baseline), s);
            ratios.push(s.ink / Math.max(1, s.lastPaintInk || 0)); return value; }));
          if (value >= .65) latinFits.push({ font, bold, size, scale, baseline, score: value, inkRatio: median(ratios) });
        }
      }
      latinFits.sort((a, b) => b.score - a.score); latinFit = latinFits[0] || null;
      if (latinFit?.bold) { const plain = latinFits.find(f => f.font === latinFit.font && !f.bold);
        if (plain && latinFit.score - plain.score < .16 && plain.inkRatio < 1.18) latinFit = plain; }
      if (fit.bold && latinFit && !latinFit.bold && latinWords.length <= 8) {
        const emphasized = latinFits.find(f => f.bold);
        if (emphasized && emphasized.score >= latinFit.score - .06) latinFit = emphasized;
      }
      const strong = new Map();
      for (const [i, w] of item.words.entries()) {
        if (!han(w.text) || !validRect(w.rect)) continue;
        const s = sample(w.rect), normal = score(w, proposal(w, fit.font, false, fit.size, fit.scale, fit.baseline), s);
        const bold = score(w, proposal(w, fit.font, true, fit.size, fit.scale, fit.baseline), s);
        if (normal < 0 || bold < 0) continue;
        if (bold > .72 && bold - normal > .12) strong.set(i, { bold: true, margin: bold - normal });
        else if (normal > .7 && normal - bold > .09) strong.set(i, { bold: false, margin: normal - bold });
      }
      let changed = 0;
      item.words = item.words.map((w, i) => {
        if (!validRect(w.rect) || w.fontAssetId || w.italic || w.ocrRuling || !contains(item.rect, w.rect, 1)) return w;
        const style = latin(w.text) && latinFit ? latinFit : fit;
        const evidence = strong.get(i), same = j => strong.get(j)?.bold === evidence?.bold;
        const emphasized = evidence && (evidence.margin > .24 || same(i - 1) && same(i + 1) || same(i - 1) && same(i - 2) || same(i + 1) && same(i + 2));
        const bold = han(w.text) && emphasized ? evidence.bold : style.bold;
        const next = proposal(w, style.font, bold, style.size, style.scale, style.baseline);
        if (!validRect(next.rect) || !contains({ x: 0, y: 0, width: scene.width, height: scene.height }, next.rect, 0)) return w;
        next.ocrStyleCohort = { version: 1, sourceRect: { ...w.rect }, lineScore: fit.score, weightEvidence: emphasized ? 'source-contrast' : 'line-cohort' };
        // Earlier per-glyph score/proof belongs to the replaced face/geometry.
        delete next.ocrGlyphScore; delete next.ocrGlyphOwnershipScore; delete next.ocrPhysicalFit;
        changed++; return next;
      });
      if (changed) { item.ocrCoherentTypography = { kind: 'source-line', version: 1, font: fit.font, size: fit.size, bold: fit.bold, score: fit.score,
        ...(fit.regularEmRepair ? { regularEmRepair: fit.regularEmRepair } : {}) }; stats.lines++; stats.words += changed; }
    }
    scene.scanTypography = stats;
  } finally { if (measure) measure.width = measure.height = 0; if (paint) paint.width = paint.height = 0; }
  return prepared;
}
