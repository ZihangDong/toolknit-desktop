// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { fitSourceOwnedScanGlyphs } from './source-owned-scan-fit.js';
import { fitOcrDisplayTitleInk } from './ocr-display-title-ink.js';
import { fitSourceOwnedColons } from './ocr-colon-typography.js';
import { fitSourceOwnedTableGlyphs } from './source-owned-table-fit.js';
import { inferDocument } from '../core/layout.js';
import { validRect, overlaps, spatialIndex } from '../core/geometry.js';
import { drawResultText } from './text-rendering.js';

const FONTS = ['SimSun', 'SimHei', 'Microsoft YaHei', 'FangSong', 'KaiTi'];
const PHASES = [{ padding: .4, components: 3, context: true },
  { padding: .4, components: 2 }, { padding: 2, components: 1 }];
const walk = blocks => blocks.flatMap(b => [b, ...(b.cells || []).flatMap(c => walk(c.blocks)),
  ...(b.columns || []).flatMap(c => walk(c.blocks)), ...(b.lines || []).flatMap(l => walk(l.items))]);

function components(mask, width, height, minimum) {
  const seen = new Uint8Array(mask.length), boxes = [], queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let count = 1, cursor = 0, x = width, y = height, right = 0, bottom = 0;
    queue[0] = start; seen[start] = 1;
    while (cursor < count) {
      const at = queue[cursor++], xx = at % width, yy = Math.floor(at / width);
      x = Math.min(x, xx); y = Math.min(y, yy); right = Math.max(right, xx + 1); bottom = Math.max(bottom, yy + 1);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = xx + dx, ny = yy + dy, next = ny * width + nx;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[next] && !seen[next]) {
          seen[next] = 1; queue[count++] = next;
        }
      }
    }
    if (count >= minimum) boxes.push([x, y, right, bottom]);
  }
  return boxes.sort((a, b) => a[0] + a[2] - b[0] - b[2] || a[1] + a[3] - b[1] - b[3]);
}

/** Physical-size proposals supplement the small shape signature. Every source
 * component remains accounted for; an established improvement is never replaced
 * by a later search. Original spelling, source ids and page pixels stay intact.
 */
export function createOcrPhysicalTypography(createCanvas) {
  if (typeof createCanvas !== 'function') return prepared => prepared;
  return (prepared, data, { pixelBudget = 4_000_000, maxChanges = 128, check = () => {} } = {}) => {
    const scene = prepared?.scene, { pixels, width, height } = data || {};
    if (!prepared?.changed || !scene || !pixels || !Number.isInteger(width) || !Number.isInteger(height)
      || !(width > 0 && height > 0) || pixels.length !== width * height * 4
      || !Number.isFinite(pixelBudget) || pixelBudget < 1 || pixelBudget > 4_000_000
      || !Number.isInteger(maxChanges) || maxChanges < 1 || maxChanges > 128) return prepared;
    const sx = width / scene.width, sy = height / scene.height;
    if (!(sx > 0 && sy > 0) || !Number.isFinite(sx + sy)) return prepared;
    const items = walk(scene.items), words = items.flatMap(item => item.words || []), accepted = new Set();
    const tableAllowance = { remaining: 0 };
    const sourceSamples = new Map(); let cachedPixelCount = 0;
    const queryWords = spatialIndex(words.filter(word => validRect(word.rect)).map(word => ({ word, rect: { ...word.rect } })));
    const queryRules = spatialIndex((scene.rules || []).flatMap(rule => {
      if (!['h', 'v'].includes(rule.axis) || !Number.isFinite(rule.at + rule.from + rule.to) || rule.to <= rule.from) return [];
      return [{ rect: rule.axis === 'h' ? { x: rule.from, y: rule.at - .25, width: rule.to - rule.from, height: .5 }
        : { x: rule.at - .25, y: rule.from, width: .5, height: rule.to - rule.from } }];
    }));
    const dark = offset => Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]) < 180;
    for (const phase of PHASES) {
      let remaining = pixelBudget;
      for (const item of items) {
        check();
        if (!item.ocr || item.ocrNative || !item.words?.length || item.words.length > 96 || item.italic
          || !(item.ocrFontScore >= (phase.context ? .75 : .65)) || !FONTS.includes(item.font)) continue;
        for (const word of item.words) {
          check();
          if (accepted.size >= maxChanges || remaining < 1) break;
          if (accepted.has(word) || word.ocrPhysicalFit || !word.preciseInk || word.italic
            || !(word.confidence >= .99 && word.ocrGlyphScore >= 0 && word.ocrGlyphScore < .9)
            || !/^\p{Script=Han}$/u.test(word.text || '') || !FONTS.includes(word.font)
            || phase.context && (!item.bold || !word.bold || word.font !== item.font)) continue;
          const r = word.rect, pad = phase.padding;
          if (!validRect(r) || r.width < 3 || r.height < 3 || r.width > 30 || r.height > 30) continue;
          const expanded = { x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
          if (queryRules(expanded).some(rule => overlaps(expanded, rule.rect, 0))) continue;
          const x = Math.max(0, Math.floor(expanded.x * sx)), y = Math.max(0, Math.floor(expanded.y * sy));
          const w = Math.min(width, Math.ceil((expanded.x + expanded.width) * sx)) - x;
          const h = Math.min(height, Math.ceil((expanded.y + expanded.height) * sy)) - y;
          if (w < 3 || h < 3 || w * h > Math.min(20000, remaining)) continue;
          remaining -= w * h;
          let isolated = true;
          for (let xx = x; xx < x + w; xx++) for (const yy of [y, y + h - 1]) if (dark((yy * width + xx) * 4)) isolated = false;
          for (let yy = y; yy < y + h; yy++) for (const xx of [x, x + w - 1]) if (dark((yy * width + xx) * 4)) isolated = false;
          if (!isolated) continue;
          const source = new Uint8Array(w * h); let total = 0, bx = w, by = h, right = 0, bottom = 0, sourceChromatic = false;
          for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (dark(((y + yy) * width + x + xx) * 4)) {
            const sourceAt=((y+yy)*width+x+xx)*4; if(Math.max(pixels[sourceAt],pixels[sourceAt+1],pixels[sourceAt+2])-Math.min(pixels[sourceAt],pixels[sourceAt+1],pixels[sourceAt+2])>30) sourceChromatic=true;
            source[yy * w + xx] = 1; total++; bx = Math.min(bx, xx); by = Math.min(by, yy); right = Math.max(right, xx + 1); bottom = Math.max(bottom, yy + 1);
          }
          if (total < 10) continue;
          if(phase.padding<1) {
            const old=sourceSamples.get(word),next=cachedPixelCount-(old?.mask.length||0)+source.length;
            if(next<=pixelBudget) { sourceSamples.set(word,{x,y,w,h,mask:source,ink:total,bx,by,br:right,bb:bottom,color:sourceChromatic,
              rectKey:JSON.stringify(r),tight:{x:(x+bx)/sx,y:(y+by)/sy,width:(right-bx)/sx,height:(bottom-by)/sy}});cachedPixelCount=next; }
          }
          const sourceBoxes = components(source, w, h, Math.max(4, Math.floor(total * .02)));
          if (sourceBoxes.length < phase.components || sourceBoxes.length > 8) continue;
          const tight = phase.context ? r : { x: (x + bx) / sx, y: (y + by) / sy, width: (right - bx) / sx, height: (bottom - by) / sy };
          const neighborhood = { x: tight.x - 2.1, y: tight.y - 2.1, width: tight.width + 4.2, height: tight.height + 4.2 };
          if (queryWords(neighborhood).some(other => other.word !== word && overlaps(tight, other.word.rect, .1))) continue;
          let canvas, measure;
          try {
            canvas = createCanvas(w, h);
            const context = canvas.getContext('2d', { willReadFrequently: true });
            measure = createCanvas(1, 1);
            const mc = measure.getContext('2d');
            const score = candidate => {
              check();
              if (w * h > remaining) return null;
              remaining -= w * h;
              const glyph = { ...candidate, id: 'ocr-fit', type: 'text', sourceIds: ['ocr-fit'], words: undefined, ocr: true,
                color: /^[0-9a-f]{6}$/i.test(item.color || '') ? item.color : '000000' };
              const document = inferDocument([{ number: scene.number, width: scene.width, height: scene.height, items: [glyph],
                sources: [{ id: glyph.id, text: glyph.text, rect: r, disposition: 'editable' }], rules: [], risks: [], characters: 1 }], { preserveGeometry: true });
              context.setTransform(1, 0, 0, 1, 0, 0); context.fillStyle = '#fff'; context.fillRect(0, 0, w, h);
              context.setTransform(sx, 0, 0, sy, -x, -y); drawResultText(document.pages[0], context);
              const data = context.getImageData(0, 0, w, h).data, mask = new Uint8Array(w * h); let ink = 0, common = 0;
              for (let i = 0; i < mask.length; i++) { mask[i] = Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < 180 ? 1 : 0; ink += mask[i]; common += mask[i] & source[i]; }
              const boxes = components(mask, w, h, Math.max(4, Math.floor(total * .02)));
              const edge = boxes.length === sourceBoxes.length ? Math.max(0, ...boxes.flatMap((box, i) => box.map((n, j) => Math.abs(n - sourceBoxes[i][j]) / (j % 2 ? sy : sx)))) : Infinity;
              return { f1: 2 * common / Math.max(1, ink + total), edge, count: boxes.length };
            };
            const initial = score(word);
            if (!initial || (phase.context ? initial.count >= sourceBoxes.length : initial.edge <= 1.25)) continue;
            const faces = phase.context ? [[word.font, false]] : [...new Map([[word.font, false], [item.font, Boolean(item.bold)],
              [item.font, false], ...FONTS.map(font => [font, false])].map(face => [JSON.stringify(face), face])).values()];
            let winner = null, best = initial;
            for (const [font, bold] of faces) {
              check(); if (w * h > remaining) break;
              mc.font = `${bold ? 'bold ' : ''}1000px "${font}"`; mc.fontKerning = 'none';
              const m = mc.measureText(word.text), height = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 1000;
              const size = height > 0 ? tight.height / height : 0;
              if (!(size >= 4 && size <= 120)) continue;
              const scale = tight.width / ((m.actualBoundingBoxLeft + m.actualBoundingBoxRight) / 1000 * size) * 100;
              if (!Number.isFinite(scale) || scale < 25 || scale > 400) continue;
              // Keep the established line/frame anchor. Precise ink placement
              // uses the candidate rect and serialized metrics; changing this
              // reference baseline would also re-quantize untouched neighbours.
              const candidate = { ...word, rect: tight, font, fontFamily: font, bold, size, glyphScale: Math.round(scale) };
              const value = score(candidate), step = phase.context ? .5 : 1 / Math.max(sx, sy);
              if (value && value.edge <= 1.25 && value.edge <= best.edge - step + 1e-8
                && value.f1 >= (phase.context ? initial.f1 + .05 : Math.max(.75, initial.f1 - .05))) { best = value; winner = candidate; }
            }
            if (winner) {
              const priorScore = word.ocrGlyphScore;
              Object.assign(word, winner); delete word.ocrGlyphScore; delete word.ocrGlyphOwnershipScore;
              word.ocrPhysicalFit = { phase: phase.context ? 'weight' : phase.padding < 1 ? 'geometry' : 'edge', priorGlyphScore: priorScore,
                before: initial.f1, after: best.f1, edgeBefore: Number.isFinite(initial.edge) ? initial.edge : null, edgeAfter: best.edge };
              accepted.add(word);
            }
          } finally {
            if (canvas) canvas.width = canvas.height = 0;
            if (measure) measure.width = measure.height = 0;
          }
        }
      }
      tableAllowance.remaining = remaining;
    }
    fitSourceOwnedTableGlyphs({ scene, data, createCanvas, accepted, allowance: tableAllowance, maxChanges, check });
    fitSourceOwnedScanGlyphs({ scene, data, createCanvas, accepted, allowance: tableAllowance, maxChanges, check, samples: sourceSamples });
    fitOcrDisplayTitleInk({ scene, data, createCanvas, accepted, allowance: tableAllowance, maxChanges, check });
    fitSourceOwnedColons({ scene, data, createCanvas, accepted, allowance: tableAllowance, maxChanges, check });
    return prepared;
  };
}
