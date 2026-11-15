// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { validRect } from './geometry.js';

/** A short page label can have reliable spelling but displaced CTC peaks.
 * Attribute the complete, isolated ink before measuring its font. Every dark
 * component must belong to one unchanged token; even small extra marks reject
 * the proposal rather than silently removing a decimal point or punctuation.
 */
export function fitOcrNumericLabel({ line, tight, pixels, width, height, sx, sy,
  fonts, weights, glyph, normalized, similarity, budget } = {}) {
  const text = typeof line?.text === 'string' ? line.text.replace(/\s/g, '') : '';
  if (!/^-[0-9]{1,6}-$/.test(text) || !Array.isArray(line.words) || line.words.length !== text.length
    || line.words.map(word => word?.text).join('') !== text
    || line.words.some((word, i) => !word || word.text !== text[i] || !Number.isFinite(word.x + word.width + word.confidence)
      || word.width <= 0 || word.confidence < (/^\d$/.test(word.text) ? .99 : .9))
    || !validRect(tight) || !(pixels instanceof Uint8ClampedArray)
    || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width * height > 16_000_000 || pixels.length !== width * height * 4
    || ![sx, sy].every(value => Number.isFinite(value) && value > 0)
    || !Array.isArray(fonts) || !fonts.length || fonts.length > 10
    || fonts.some(font => typeof font !== 'string' || !font || font.length > 80)
    || !Array.isArray(weights) || !weights.length || weights.length > 2 || weights.some(value => typeof value !== 'boolean')
    || typeof glyph !== 'function' || typeof normalized !== 'function' || typeof similarity !== 'function'
    || !budget || !Number.isFinite(budget.remaining) || budget.remaining < 1) return null;
  const left = Math.max(0, Math.floor(tight.x * sx) - 2), top = Math.max(0, Math.floor(tight.y * sy) - 2);
  const right = Math.min(width, Math.ceil((tight.x + tight.width) * sx) + 2);
  const bottom = Math.min(height, Math.ceil((tight.y + tight.height) * sy) + 2);
  const w = right - left, h = bottom - top, cost = w * h * 12;
  if (w < 12 || w > 512 || h < 12 || h > 128 || w * h > 32768 || cost > budget.remaining) return null;
  budget.remaining -= cost;
  const mask = new Uint8Array(w * h), seen = new Uint8Array(w * h), queue = new Int32Array(w * h);
  let ink = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const at = ((top + y) * width + left + x) * 4;
    if (Math.min(pixels[at], pixels[at + 1], pixels[at + 2]) >= 180) continue;
    if (pixels[at + 3] < 240 || Math.max(pixels[at], pixels[at + 1], pixels[at + 2])
      - Math.min(pixels[at], pixels[at + 1], pixels[at + 2]) > 30
      || !x || !y || x === w - 1 || y === h - 1) return null;
    mask[y * w + x] = 1; ink++;
  }
  const parts = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let count = 1, cursor = 0, x = w, y = h, r = 0, b = 0;
    queue[0] = start; seen[start] = 1;
    while (cursor < count) {
      const at = queue[cursor++], xx = at % w, yy = Math.floor(at / w);
      x = Math.min(x, xx); r = Math.max(r, xx + 1); y = Math.min(y, yy); b = Math.max(b, yy + 1);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = xx + dx, ny = yy + dy, next = ny * w + nx;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h || seen[next] || !mask[next]) continue;
        seen[next] = 1; queue[count++] = next;
      }
    }
    if (count < Math.max(4, ink * .01) || parts.length >= text.length) return null;
    const part = new Uint8Array((r - x) * (b - y));
    for (let i = 0; i < count; i++) part[(Math.floor(queue[i] / w) - y) * (r - x) + queue[i] % w - x] = 1;
    parts.push({ x, y, width: r - x, height: b - y, mask: part });
  }
  parts.sort((a, b) => a.x - b.x);
  if (parts.length !== text.length || parts.some((part, i) => i && part.x < parts[i - 1].x + parts[i - 1].width)) return null;
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const digits = parts.slice(1, -1), digitHeight = median(digits.map(part => part.height));
  if (digitHeight < 16 || digits.some(part => part.height / digitHeight < .8 || part.height / digitHeight > 1.2)) return null;
  for (const part of [parts[0], parts.at(-1)])
    if (part.height > digitHeight * .2 || part.width < part.height * 3 || part.width > digitHeight * .85) return null;
  if (Math.abs(parts[0].y + parts[0].height / 2 - parts.at(-1).y - parts.at(-1).height / 2) > 2
    || parts.some((part, i) => Math.abs(left + part.x + part.width / 2
      - line.words[i].x - line.words[i].width / 2) > digitHeight * .75)) return null;
  const candidates = [];
  for (const font of fonts) for (const bold of weights) {
    const scores = [];
    for (let i = 0; i < digits.length; i++) {
      const part = digits[i], outline = glyph(text[i + 1], font, bold, part.height);
      if (!outline) break;
      const score = similarity(normalized(part.mask, part.width, part.height), outline.mask);
      const ratio = part.width / part.height / (outline.outline.width / outline.outline.height);
      if (score < .8 || ratio < .75 || ratio > 1.25) break;
      scores.push(score - Math.abs(Math.log(ratio)) * .15);
    }
    if (scores.length === digits.length)
      candidates.push({ font, bold, score: scores.reduce((sum, score) => sum + score, 0) / scores.length });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || best.score < .85) return null;
  const words = parts.map((part, i) => {
    const outline = glyph(text[i], best.font, best.bold, part.height);
    if (!outline) return null;
    const rect = { x: (left + part.x) / sx, y: (top + part.y) / sy, width: part.width / sx, height: part.height / sy };
    const size = rect.height * 100 / outline.outline.height;
    const glyphScale = Math.round(rect.width * 100 / (outline.outline.width * size / 100));
    if (!(size >= 4 && size <= 120 && glyphScale >= 25 && glyphScale <= 400)) return null;
    return { text: text[i], rect, size, font: best.font, fontFamily: best.font, bold: best.bold, glyphScale,
      baseline: rect.y + outline.outline.ascent * size / 100, baselineX: rect.x, advanceWidth: rect.width,
      preciseInk: true, confidence: line.words[i].confidence,
      ocrGlyphScore: similarity(normalized(part.mask, part.width, part.height), outline.mask) };
  });
  if (words.some(word => !word)) return null;
  const body = words.slice(1, -1);
  return { font: best.font, fontFamily: best.font, bold: best.bold, size: median(body.map(word => word.size)),
    baseline: median(body.map(word => word.baseline)), words, ocrFontScore: best.score, ocrLineTypography: true };
}
