// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { inferDocument } from '../core/layout.js';
import { validRect } from '../core/geometry.js';
import { createOcrTypography } from './ocr-typography.js';
import { drawResultText } from './text-rendering.js';

const CJK = ['SimSun', 'SimHei', 'Microsoft YaHei', 'FangSong', 'KaiTi', 'DengXian'];
const LATIN = ['SimHei', 'SimSun', 'DengXian', 'Arial', 'Times New Roman', 'Calibri', 'Cambria', 'Microsoft YaHei',
  'Arial Black', 'Impact', 'Bahnschrift', 'Segoe UI Black', 'Segoe UI', 'Franklin Gothic Medium', 'Verdana'];

export function nativeDisplayCandidate(item) {
  return item?.type === 'text' && !item.ocr && !item.raster && !item.alphabet && typeof item.text === 'string'
    && item.size >= 20 && item.size <= 120
    && validRect(item.rect) && Array.isArray(item.glyphPositions) && item.glyphPositions.length >= 1 && item.glyphPositions.length <= 120
    && item.glyphPositions.every(g => typeof g.text === 'string' && g.text && validRect(g.rect))
    && item.glyphPositions.map(g => g.text).join('').replace(/\s/g, '') === item.text.replace(/\s/g, '')
    && item.sourceIds?.length === 1 && item.sourceIds[0] === item.id && !/[=<>∑∫√]/u.test(item.text)
    && !/(?:Times|Arial|SimSun|SimHei|MSYH|宋|黑体|Cambria|CM(?:MI|R|SY)|Calibri|Nimbus|Helvetica|Palatino|Courier|KaiTi|FangSong)/i.test(item.font || '');
}

function* texts(blocks) {
  for (const item of blocks) {
    if (item.type === 'text') yield item;
    for (const column of item.columns || []) yield* texts(column.blocks);
    for (const cell of item.cells || []) yield* texts(cell.blocks);
    for (const line of item.lines || []) yield* texts(line.items);
  }
}

function dilate(mask, width, height, radius) {
  const horizontal = new Uint8Array(mask.length), result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < Math.min(width, radius); x++) count += mask[y * width + x];
    for (let x = 0; x < width; x++) {
      if (x + radius < width) count += mask[y * width + x + radius];
      if (x - radius - 1 >= 0) count -= mask[y * width + x - radius - 1];
      horizontal[y * width + x] = count > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < Math.min(height, radius); y++) count += horizontal[y * width + x];
    for (let y = 0; y < height; y++) {
      if (y + radius < height) count += horizontal[(y + radius) * width + x];
      if (y - radius - 1 >= 0) count -= horizontal[(y - radius - 1) * width + x];
      result[y * width + x] = count > 0 ? 1 : 0;
    }
  }
  return result;
}

/** Rank native display-font proposals using the editor's actual serialized
 * text geometry. Pixels never supply spelling or replace source ownership.
 */
export function createNativeDisplayFitter(createCanvas) {
  const fit = createOcrTypography(createCanvas, { nativeEvidence: true });
  return (scene, pixels, width, height, originals) => {
    if (!originals?.size || !(pixels instanceof Uint8ClampedArray)
      || ![width, height, scene.width, scene.height].every(n => Number.isFinite(n) && n > 0)
      || width * height > 16_000_000 || pixels.length !== width * height * 4) return;
    const sx = width / scene.width, sy = height / scene.height;
    let remaining = 24_000_000;
    for (const item of texts(scene.items)) {
      const original = originals.get(item.id);
      if (!original) continue;
      const x = Math.max(0, Math.floor((original.rect.x - 2) * sx));
      const y = Math.max(0, Math.floor((original.rect.y - 2) * sy));
      const w = Math.min(width, Math.ceil((original.rect.x + original.rect.width + 2) * sx)) - x;
      const h = Math.min(height, Math.ceil((original.rect.y + original.rect.height + 2) * sy)) - y;
      if (w < 1 || h < 1 || w * h > 1_500_000 || w * h > remaining) continue;
      let white = 0, perimeter = 0;
      for (let xx = x; xx < x + w; xx += Math.max(1, Math.floor(w / 50))) for (const yy of [y, y + h - 1]) {
        const p = (yy * width + xx) * 4;
        if (pixels[p] > 245 && pixels[p + 1] > 245 && pixels[p + 2] > 245) white++;
        perimeter++;
      }
      if (white / perimeter < .98) continue;
      const source = new Uint8Array(w * h);
      let sourceInk = 0;
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const p = ((yy + y) * width + xx + x) * 4;
        const ink = Math.min(pixels[p], pixels[p + 1], pixels[p + 2]) < 180;
        source[yy * w + xx] = ink ? 1 : 0; sourceInk += ink ? 1 : 0;
      }
      if (sourceInk < 20) continue;
      const radius = Math.max(1, Math.floor(sx)), tightRadius = Math.max(0, Math.floor(sx * .5));
      const expandedSource = dilate(source, w, h, radius), tightSource = dilate(source, w, h, tightRadius);
      const canvas = createCanvas(w, h), context = canvas.getContext('2d');
      const score = candidate => {
        if (w * h > remaining) return null;
        remaining -= w * h;
        const document = inferDocument([{ number: scene.number, width: scene.width, height: scene.height,
          items: [structuredClone(candidate)], sources: [{ id: candidate.id, text: candidate.text, rect: candidate.rect,
            order: candidate.order, disposition: 'editable' }], rules: [], risks: [], characters: candidate.text.replace(/\s/g, '').length }], { preserveGeometry: true });
        context.setTransform(1, 0, 0, 1, 0, 0); context.fillStyle = '#fff'; context.fillRect(0, 0, w, h);
        context.setTransform(sx, 0, 0, sx, -x, -y); drawResultText(document.pages[0], context);
        const data = context.getImageData(0, 0, w, h).data, output = new Uint8Array(w * h);
        let ink = 0, matched = 0, tightMatched = 0;
        for (let i = 0; i < output.length; i++) {
          output[i] = Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < 180 ? 1 : 0;
          ink += output[i]; matched += output[i] & expandedSource[i]; tightMatched += output[i] & tightSource[i];
        }
        const expanded = dilate(output, w, h, radius), tightExpanded = dilate(output, w, h, tightRadius);
        let recalled = 0, tightRecalled = 0;
        for (let i = 0; i < source.length; i++) { recalled += source[i] & expanded[i]; tightRecalled += source[i] & tightExpanded[i]; }
        const f1 = (a, b) => 2 * a * b / Math.max(1e-9, a + b);
        return { loose: f1(matched / Math.max(1, ink), recalled / sourceInk),
          tight: f1(tightMatched / Math.max(1, ink), tightRecalled / sourceInk) };
      };
      try {
        const initial = score(item);
        if (!initial || initial.loose >= .985) continue;
        let best = initial.tight, bestLoose = initial.loose, winner = null;
        const proposals = [], color = /^[0-9a-f]{6}$/i.test(original.color)
          ? [0, 2, 4].map(i => parseInt(original.color.slice(i, i + 2), 16)) : [0, 0, 0];
        const inkAt = (xx, yy) => { const p = (yy * width + xx) * 4; return [0, 1, 2].every(c => Math.abs(pixels[p + c] - color[c]) < 60); };
        const line = { text: original.text, confidence: 1, words: original.glyphPositions.map(g => ({ text: g.text,
          x: g.rect.x * sx, y: g.rect.y * sy, width: g.rect.width * sx, height: g.rect.height * sy, confidence: 1 })) };
        for (const font of /\p{Script=Han}/u.test(original.text) ? CJK : LATIN) for (const bold of [false, true]) {
          if (w * h > remaining) break;
          const result = fit({ line, pixels, width, height, sx, sy, tight: original.rect, inkAt, fontHint: { font, bold } });
          if (!result || result.ocrFontScore < .65) continue;
          const candidate = { ...item, ...result, sourceFont: original.font, sourceSize: original.size,
            sourceFontMetrics: original.fontMetrics, fontMetrics: undefined, nativeCalibrated: true, preciseInk: true };
          proposals.push(candidate);
          const value = score(candidate);
          if (value && value.loose >= initial.loose + .005 && value.tight > best + .004) {
            best = value.tight; bestLoose = value.loose; winner = candidate;
          }
        }
        if ((winner || item).words?.length <= 8) {
          let current = winner || structuredClone(item);
          for (let i = 0; i < current.words.length; i++) for (const proposal of proposals) {
            if (w * h > remaining) break;
            if (proposal.words?.length !== current.words.length || proposal.words[i].text !== current.words[i].text) continue;
            const candidate = { ...current, words: current.words.map((word, j) => j === i ? proposal.words[i] : word) }, value = score(candidate);
            if (value && value.loose >= bestLoose && value.tight > best + .004) {
              current = candidate; best = value.tight; bestLoose = value.loose; winner = candidate;
            }
          }
        }
        // Short display labels are especially sensitive to half-point Word
        // sizing. Keep the proven ink box and limit this discrete search to two
        // glyphs; longer labels retain their established size fit.
        if ((winner || item).words?.length <= 2) {
          let current = winner || structuredClone(item);
          for (let i = 0; i < current.words.length; i++) {
            const word = current.words[i];
            for (const offset of [-.5, 0, .5]) for (const delta of [-1, 0, 1]) {
              if (w * h > remaining) break;
              const size = Math.round(word.size * 2) / 2 + offset;
              if (size < 4 || size > 120) continue;
              const replacement = { ...word, size, glyphScale: Math.max(25, Math.min(400, Math.round(word.glyphScale * word.size / size) + delta)) };
              const candidate = { ...current, words: current.words.map((v, j) => j === i ? replacement : v) }, value = score(candidate);
              if (value && value.loose >= bestLoose && value.tight > best + .004) {
                current = candidate; best = value.tight; bestLoose = value.loose; winner = candidate;
              }
            }
          }
        }
        if (winner && best >= initial.tight + .01) Object.assign(item, winner);
      } finally { canvas.width = canvas.height = 0; }
    }
  };
}
