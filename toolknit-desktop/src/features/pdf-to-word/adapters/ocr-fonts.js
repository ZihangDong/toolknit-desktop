// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { traceOcrGlyph } from '../core/ocr-font-contours.js';
import { buildOcrTtf, OCR_FONT_LIMITS } from '../core/ocr-font-ttf.js';
import { SOURCE_FONT_LIMITS } from '../core/source-font.js';
import { documentFontAssetId } from '../core/document-font.js';
import { spatialIndex, validRect, overlaps, contains } from '../core/geometry.js';
import { inferDocument, leafBlocks } from '../core/layout.js';
import { drawResultText } from './text-rendering.js';
import { validateDocumentFontAsset } from './source-font-runtime.js';
import { wordError } from '../core/input.js';
import { ocrFrameLayout, isGeneratedOcrWord } from '../core/ocr-frame-layout.js';
import { createOcrFontContext } from './ocr-font-context.js';
import { ocrPaintBounds, generatedOcrPaintBounds } from './ocr-paint-bounds.js';
import { localOcrTextFont } from './docx-fonts.js';

const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
const scalar = text => typeof text === 'string' && text.length === 1 && Boolean(text.trim()) && text.charCodeAt(0) >= 32
  && !/[\x7f-\x9f\ud800-\uf8ff\ufffe\uffff]/u.test(text);
function* texts(items, includeTables = true) {
  for (const item of items || []) {
    if (item.type === 'text') yield item;
    for (const line of item.lines || []) yield* texts(line.items, includeTables);
    for (const child of item.columns || []) yield* texts(child.blocks, includeTables);
    if (includeTables || item.type !== 'table' || item.aiInferred)
      for (const child of item.cells || []) yield* texts(child.blocks, includeTables);
  }
}
function signature(mask, width, height) {
  const result = new Uint8Array(32 * 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const x0 = Math.floor(x * width / 32), x1 = Math.max(x0 + 1, Math.ceil((x + 1) * width / 32));
    const y0 = Math.floor(y * height / 32), y1 = Math.max(y0 + 1, Math.ceil((y + 1) * height / 32));
    let ink = 0, count = 0;
    for (let yy = y0; yy < Math.min(height, y1); yy++) for (let xx = x0; xx < Math.min(width, x1); xx++) { ink += mask[yy * width + xx]; count++; }
    result[y * 32 + x] = ink / Math.max(1, count) > .3 ? 1 : 0;
  }
  return result;
}
function similarity(a, b) {
  let left = 0, right = 0, common = 0;
  for (let i = 0; i < a.length; i++) { left += a[i]; right += b[i]; common += a[i] & b[i]; }
  return 2 * common / Math.max(1, left + right);
}

function hasDetachedSpecks(traced, width, height) {
  const parts = traced.contours.flatMap(ring => {
    const area = ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
    // Clockwise exterior contours in image coordinates; holes are not specks.
    if (area <= 0) return [];
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    return [{ area, x: Math.min(...xs), y: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }];
  });
  const small = Math.max(2, traced.inkPixels * .015), main = parts.filter(part => part.area > small);
  // Do not drop scanner specks/possible neighbour fragments from the outline.
  // Decline the whole proposal when their attribution cannot be established.
  return main.length > 0 && parts.some(part => part.area <= small && main.every(other => Math.hypot(
    Math.max(other.x - part.right, part.x - other.right, 0),
    Math.max(other.y - part.bottom, part.y - other.bottom, 0)) > Math.max(2, Math.min(width, height) * .08)));
}

/** Document/worker-owned NEW fonts for otherwise poorly fitted OCR text.
 * Original PDF font collection and permission decisions are not inputs to this
 * builder. Every accepted glyph still requires its existing OCR spelling,
 * complete isolated pixels, repeat-shape agreement and real paint improvement.
 */
export function createOcrFontRegistry({ createCanvas, fontSet = globalThis.fonts,
  makeFace = typeof FontFace === 'function' ? (name, bytes, options) => new FontFace(name, bytes, options) : null,
  available = () => ({ fonts: SOURCE_FONT_LIMITS.fonts, bytes: SOURCE_FONT_LIMITS.totalBytes }), makePath } = {}) {
  const faces = new Map(), used = new Set(), generatedFonts = createOcrFontContext({ makePath }); let disposed = false, busy = false;
  const alive = check => { check(); if (disposed) throw wordError('cancelled'); };
  const heldBytes = () => [...faces.values()].reduce((sum, entry) => sum + entry.asset.bytes.length, 0);
  const budget = () => {
    const value = available();
    return value && Number.isInteger(value.fonts) && value.fonts >= 0 && value.fonts <= SOURCE_FONT_LIMITS.fonts
      && Number.isInteger(value.bytes) && value.bytes >= 0 && value.bytes <= SOURCE_FONT_LIMITS.totalBytes ? value : null;
  };
  return {
    async prepare(scene, pixels, width, height, { check = () => {}, pixelBudget = 2000000, maxFonts = 4, remainingPages = 1 } = {}) {
      alive(check);
      if (!createCanvas || !fontSet || !makeFace || !scene || !(pixels instanceof Uint8ClampedArray)
        || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16000000
        || pixels.length !== width * height * 4 || !Number.isInteger(scene.number) || scene.number < 1 || scene.number > 10000
        || !Number.isInteger(pixelBudget) || pixelBudget < 1 || pixelBudget > 2000000
        || !Number.isInteger(maxFonts) || maxFonts < 1 || maxFonts > 4
        || !Number.isInteger(remainingPages) || remainingPages < 1 || remainingPages > 100) return scene;
      if (busy) throw wordError('busy');
      busy = true;
      let canvas, metricCanvas, committed = false;
      const staged = new Map(), replacements = [];
      try {
        const capacity = budget();
        if (!capacity || capacity.fonts - faces.size < 1 || capacity.bytes - heldBytes() < 4096) return scene;
        // Share the document's remaining allowance with later selected pages.
        // Unused page quota stays available; neither document limit increases.
        const pageFontLimit = Math.min(maxFonts, Math.max(1, Math.floor((capacity.fonts - faces.size) / remainingPages)));
        const sx = width / scene.width, sy = height / scene.height;
        if (!(sx > 0 && sy > 0) || !Number.isFinite(sx + sy)) return scene;
        // Ordinary native Word cells shape custom CJK faces differently in WPS.
        // Until that reader path has a matching full-cell proof, leave it on
        // the existing cell fitter. Only independently positioned OCR uses this.
        const items = [...texts(scene.items, false)];
        const words = [...texts(scene.items)].flatMap(item => item.words || []);
        const sources = new Map((scene.sources || []).map(source => [source.id, source]));
        const held = () => heldBytes() + [...staged.values()].reduce((sum, entry) => sum + entry.asset.bytes.length, 0);
        const queryWords = spatialIndex(words.filter(w => validRect(w.rect)).map(word => ({ word, rect: word.rect })));
        const queryRules = spatialIndex((scene.rules || []).flatMap(rule => ['h', 'v'].includes(rule.axis)
          && Number.isFinite(rule.at + rule.from + rule.to) && rule.to > rule.from ? [{ rect: rule.axis === 'h'
            ? { x: rule.from, y: rule.at - .25, width: rule.to - rule.from, height: .5 }
            : { x: rule.at - .25, y: rule.from, width: .5, height: rule.to - rule.from } }] : []));
        const groups = [], sourceCandidates = [];
        let remaining = pixelBudget, pointCount = 0, finalReserved = 0;
        canvas = createCanvas(1, 1);
        metricCanvas = createCanvas(1, 1);
        const metricContext = generatedFonts.context(metricCanvas.getContext('2d'));
        const paint = (item, word, sample) => {
          // Observe the whole output around this glyph, not a canvas clipped
          // to its expected bbox. A repeated outline may have an extra remote
          // fragment even when the pixels inside that bbox match well.
          const glyph = { ...item, ...word, id: 'ocr-font-paint', type: 'text', words: undefined, sourceIds: ['ocr-font-paint'], ocr: true };
          const document = inferDocument([{ number: scene.number, width: scene.width, height: scene.height,
            items: [glyph], sources: [{ id: glyph.id, text: glyph.text, rect: glyph.rect, disposition: 'editable' }],
            rules: [], risks: [], characters: glyph.text.length }], { preserveGeometry: true });
          const lines = leafBlocks([...document.pages[0].header, ...document.pages[0].blocks, ...document.pages[0].footer]).flatMap(block => block.lines || []);
          const bounds = lines.length === 1 && ocrPaintBounds(lines[0], metricContext, sample, sx, sy);
          if (!bounds) return null;
          const { pad, width: paintWidth, height: paintHeight } = bounds;
          if (paintWidth * paintHeight > remaining) return null;
          remaining -= paintWidth * paintHeight;
          canvas.width = paintWidth; canvas.height = paintHeight;
          const context = generatedFonts.context(canvas.getContext('2d', { willReadFrequently: true }));
          context.fillStyle = '#fff'; context.fillRect(0, 0, paintWidth, paintHeight);
          context.setTransform(sx, 0, 0, sy, -sample.x + pad, -sample.y + pad);
          drawResultText(document.pages[0], context);
          const data = context.getImageData(0, 0, paintWidth, paintHeight).data;
          let ink = 0, common = 0, x = paintWidth, y = paintHeight, right = 0, bottom = 0;
          for (let i = 0; i < paintWidth * paintHeight; i++) if (Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < 180) {
            ink++; const xx = i % paintWidth - pad, yy = Math.floor(i / paintWidth) - pad;
            if (xx >= 0 && yy >= 0 && xx < sample.w && yy < sample.h) common += sample.mask[yy * sample.w + xx];
            x = Math.min(x, xx); y = Math.min(y, yy); right = Math.max(right, xx + 1); bottom = Math.max(bottom, yy + 1);
          }
          return { f1: 2 * common / Math.max(1, ink + sample.ink), edge: ink ? Math.max(Math.abs(x - sample.bx) / sx,
            Math.abs(y - sample.by) / sy, Math.abs(right - sample.br) / sx, Math.abs(bottom - sample.bb) / sy) : Infinity };
        };
        for (const item of items) {
          alive(check);
          const source = item.sourceIds?.length === 1 && sources.get(item.sourceIds[0]);
          if (!item.ocr || item.ocrNative || item.raster || item.italic || item.role === 'math' || item.fontAssetId
            || typeof item.id !== 'string' || !item.id || item.id.length > 160 || /[<>\x00-\x1f]/.test(item.id)
            || !source || source.disposition !== 'editable' || source.text !== item.text
            || !item.words?.length || item.words.length > 120 || !validRect(item.rect) || !Number.isFinite(item.size + item.baseline)) continue;
          const nominal = Math.round(item.size * 2) / 2;
          if (nominal < 4 || nominal > 120) continue;
          for (const word of item.words) {
            alive(check);
            if (!scalar(word.text) || !word.preciseInk || word.fontAssetId || word.italic || word.ocrRuling || word.ocrStyleCohort || word.ocrOptionInkFit
              || !Number.isFinite(word.confidence) || word.confidence < .99 || !validRect(word.rect)) continue;
            // At a full page quota, an unrepresented family/weight cannot
            // join any cohort. Reject it before sampling or painting so the
            // unchanged allowance remains available to later existing groups.
            // Same-key shape variants still need the normal signature proof.
            const familyKey = JSON.stringify([word.font || item.font, Boolean(word.bold ?? item.bold)]);
            if (groups.length >= Math.min(pageFontLimit, capacity.fonts - faces.size)
              && !groups.some(group => group.key === familyKey)) continue;
            const r = word.rect, x = Math.max(0, Math.floor(r.x * sx) - 1), y = Math.max(0, Math.floor(r.y * sy) - 1);
            const right = Math.min(width, Math.ceil((r.x + r.width) * sx) + 1), bottom = Math.min(height, Math.ceil((r.y + r.height) * sy) + 1);
            const w = right - x, h = bottom - y;
            if (w < 3 || h < 3 || w > 256 || h > 256 || w * h * 3 > remaining) continue;
            const mask = new Uint8Array(w * h); let ink = 0, bx = w, by = h, br = 0, bb = 0, border = false;
            remaining -= w * h;
            for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
              const at = ((y + yy) * width + x + xx) * 4;
              if (Math.min(pixels[at], pixels[at + 1], pixels[at + 2]) >= 180) continue;
              if (Math.max(pixels[at], pixels[at + 1], pixels[at + 2]) - Math.min(pixels[at], pixels[at + 1], pixels[at + 2]) > 30) { border = true; continue; }
              mask[yy * w + xx] = 1; ink++; bx = Math.min(bx, xx); by = Math.min(by, yy); br = Math.max(br, xx + 1); bb = Math.max(bb, yy + 1);
              if (!xx || !yy || xx === w - 1 || yy === h - 1) border = true;
            }
            if (border || ink < 8) continue;
            const tight = { x: (x + bx) / sx, y: (y + by) / sy, width: (br - bx) / sx, height: (bb - by) / sy };
            if (!contains(item.rect, tight, .25) || queryRules(tight).some(rule => overlaps(tight, rule.rect, 0))
              || queryWords(tight).some(other => other.word !== word && overlaps(tight, other.word.rect, .1))) continue;
            const sample = { x, y, w, h, mask, ink, bx, by, br, bb }, initial = paint(item, word, sample);
            if (!initial || initial.f1 >= .85) continue;
            let finalCost = sample.w * sample.h;
            if (finalCost > remaining) continue;
            const traced = traceOcrGlyph(mask, w, h, { check });
            if (!traced || hasDetachedSpecks(traced, w, h) || pointCount + traced.pointCount > OCR_FONT_LIMITS.points) continue;
            const compact = new Uint8Array((br - bx) * (bb - by));
            for (let yy = by; yy < bb; yy++) compact.set(mask.subarray(yy * w + bx, yy * w + br), (yy - by) * (br - bx));
            const sig = signature(compact, br - bx, bb - by), bold = Boolean(word.bold ?? item.bold);
            // Per-glyph normalization retains each word's actual nominal em.
            // A new size alone need not spend another document font slot.
            const key = familyKey;
            let group = groups.find(g => g.key === key && (!g.glyphs.has(word.text) || similarity(g.glyphs.get(word.text).signature, sig) >= .98));
            if (!group) {
              if (groups.length >= Math.min(pageFontLimit, capacity.fonts - faces.size)) continue;
              group = { key, bold, glyphs: new Map(), words: [] }; groups.push(group);
            }
            let base = group.glyphs.get(word.text);
            if (!base) {
              if (group.glyphs.size >= OCR_FONT_LIMITS.glyphs) continue;
              const contours = traced.contours.map(ring => ring.map(([xx, yy]) => [Math.round((xx - bx) / sx / nominal * 1024),
                Math.round((item.baseline - (y + yy) / sy) / nominal * 1024)]).reverse());
              const values = contours.flat(), xs = values.map(p => p[0]), ys = values.map(p => p[1]);
              base = { text: word.text, advance: Math.ceil(tight.width / nominal * 1024) + 32, contours,
                signature: sig, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
                proof: { text: word.text, sourceId: item.id, box: [x + bx, y + by, br - bx, bb - by], confidence: word.confidence, points: traced.pointCount } };
              group.glyphs.set(word.text, base); pointCount += traced.pointCount;
            }
            // Keep the cohort's actual half-point em. Inverting a rounded
            // two-pixel bar's bbox would invent a different size for Chinese 一.
            // Repeat occurrences still have to pass the real paint test.
            const size = nominal, scale = tight.width * 1024 / ((base.bounds[2] - base.bounds[0]) * size) * 100;
            if (!(size >= 4 && size <= 120 && scale >= 25 && scale <= 400)
              || Math.abs((base.bounds[3] - base.bounds[1]) * size / 1024 - tight.height) > .5) continue;
            const candidate = { item, word, sample, initial, base, tight, size, scale };
            // Every accepted proposal owes one real FontFace paint. Reserve
            // that work now so later source scans cannot starve all commits.
            // Sampling and both paints still share the same page allowance.
            const finalBounds = generatedOcrPaintBounds({ bounds: base.bounds, size, scale, baseline: item.baseline, tight, sample, sx, sy });
            finalCost = finalBounds.width * finalBounds.height;
            if (finalCost > remaining) continue;
            remaining -= finalCost; finalReserved += finalCost;
            group.words.push(candidate); sourceCandidates.push(candidate);
          }
        }
        if (!sourceCandidates.length) return scene;
        remaining += finalReserved; finalReserved = 0;
        const pixelFingerprint = await digest(pixels); alive(check);
        for (const group of groups) {
          if (!group.words.length) continue;
          alive(check);
          const name = 'TKInk' + (await digest(new TextEncoder().encode(JSON.stringify({ bold: group.bold,
            glyphs: [...group.glyphs.values()].map(g => ({ text: g.text, advance: g.advance, contours: g.contours })) })))).slice(0, 24);
          alive(check);
          const font = buildOcrTtf([...group.glyphs.values()], name, { bold: group.bold, check });
          if (!font) continue;
          const current = budget(), existing = faces.get(documentFontAssetId(name)) || staged.get(documentFontAssetId(name));
          if (!current || !existing && (faces.size + staged.size >= current.fonts || held() + font.bytes.length > current.bytes)) continue;
          const asset = { ...font, id: documentFontAssetId(name), kind: 'font', format: 'ttf', fingerprint: await digest(font.bytes),
            ocrProvenance: { version: 1, page: scene.number, width, height, pixelFingerprint, glyphs: [...group.glyphs.values()].map(g => g.proof) } };
          alive(check); const info = await validateDocumentFontAsset(asset); alive(check);
          let face, added = false;
          const accepted = [];
          try {
            if (existing) {
              if (existing.asset.fingerprint !== asset.fingerprint) throw wordError('structure');
              face = existing.face;
            } else {
              face = makeFace(name, font.bytes, { weight: String(font.weight), style: 'normal' });
              await face.load(); alive(check); fontSet.add(face); added = true; generatedFonts.add(asset, info.generatedProgram);
            }
            for (const candidate of group.words) {
              alive(check);
              const replacement = { ...candidate.word, rect: candidate.tight, size: candidate.size, font: name, fontFamily: name,
                ocrFallbackFont: localOcrTextFont(candidate.word.font || candidate.item.font, candidate.word.text) || undefined,
                fontAssetId: asset.id, fontMetrics: undefined, bold: group.bold, italic: false,
                glyphScale: Math.round(candidate.scale), advanceWidth: candidate.tight.width, baselineX: candidate.tight.x,
                baseline: candidate.item.baseline, preciseInk: true };
              const score = paint(candidate.item, replacement, candidate.sample);
              if (!score || score.edge > .75 || score.f1 < .95 || score.f1 < candidate.initial.f1 + .05) continue;
              accepted.push({ word: candidate.word, replacement });
            }
            alive(check);
            if (accepted.length) {
              if (!existing) { staged.set(asset.id, { asset, face }); added = false; }
              replacements.push(...accepted);
            }
          } catch (error) { alive(check); if (error?.code === 'cancelled' || error?.name === 'AbortError') throw error; }
          finally { if (added && face) { fontSet.delete(face); generatedFonts.remove(asset.name); } }
        }
        // No await/check after committing: a cancelled/failed proposal must not
        // leave a scene pointing to a font that its owner then releases.
        alive(check);
        const finalCapacity = budget();
        if (!finalCapacity || faces.size + staged.size > finalCapacity.fonts || held() > finalCapacity.bytes) return scene;
        // WPS can change CJK advances when generated glyphs and system text
        // share a frame. Prove independent frames within the existing page
        // allowance BEFORE binding any replacement. The layout keeps the
        // original word objects, so this preflight needs no scene mutation.
        if (replacements.length) {
          const proposed = new WeakSet(replacements.map(value => value.word));
          const page = inferDocument([scene], { preserveGeometry: true }).pages[0];
          ocrFrameLayout(page, { generatedWord: word => proposed.has(word) || isGeneratedOcrWord(word) });
        }
        for (const [id, entry] of staged) faces.set(id, entry);
        for (const { word, replacement } of replacements) Object.assign(word, replacement);
        committed = true;
        return scene;
      } catch (error) {
        alive(check);
        if (error?.code === 'cancelled' || error?.name === 'AbortError') throw error;
        return scene;
      } finally {
        if (!committed) for (const { asset, face } of staged.values()) { fontSet.delete(face); generatedFonts.remove(asset.name); }
        if (canvas) canvas.width = canvas.height = 0;
        if (metricCanvas) metricCanvas.width = metricCanvas.height = 0;
        busy = false;
      }
    },
    assets(scene) {
      for (const item of texts(scene.items)) for (const word of [item, ...item.words || []]) if (faces.has(word.fontAssetId)) used.add(word.fontAssetId);
      return [...used].map(id => faces.get(id).asset);
    },
    capacity() { return { fonts: SOURCE_FONT_LIMITS.fonts - faces.size, bytes: SOURCE_FONT_LIMITS.totalBytes - heldBytes() }; },
    dispose() { if (disposed) return; disposed = true; generatedFonts.dispose(); for (const { face } of faces.values()) fontSet?.delete(face); faces.clear(); used.clear(); }
  };
}
