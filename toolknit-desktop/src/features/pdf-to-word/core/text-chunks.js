// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { union, right, bottom, validRect, spatialIndex } from './geometry.js';

function nativeAccentOverlay(items) {
  if (items.length < 2 || items.length > 20000) return false;
  const accents = items.filter(item => item.raster === false && /^[\u00a8\u00b4\u02c6\u02c7\u02d8\u02d9\u02da\u02dc]$/u.test(item.text || '')
    && /Times|NimbusRom|Palatino|Palladio|Arial|Helvetica/i.test(item.font || '') && validRect(item.rect)
    && item.rect.width > 0 && item.rect.height > 0 && Number.isFinite(item.size + item.baseline)
    && item.rect.width <= item.size * .5 && item.rect.height <= item.size * .4);
  if (!accents.length) return false;
  const query = spatialIndex(items); let work = 0;
  for (const accent of accents) {
    const nearby = query(accent.rect); work += nearby.length;
    if (work > 8192) return false;
    const hosts = nearby.filter(word => word !== accent && word.raster === false && /[A-Za-z]{2}/.test(word.text || '')
      && word.font === accent.font && word.color === accent.color && Boolean(word.bold) === Boolean(accent.bold)
      && Boolean(word.italic) === Boolean(accent.italic) && Math.abs(word.size - accent.size) <= .01
      && Math.abs(word.baseline - accent.baseline) <= .1 && word.rect.width > accent.rect.width * 1.5
      && accent.rect.x >= word.rect.x - .3 && right(accent.rect) <= right(word.rect) + .3
      && accent.rect.y >= word.baseline - word.size && bottom(accent.rect) <= word.baseline - word.size * .25);
    if (hosts.length === 1) return true;
  }
  return false;
}

/** Office readers can clamp negative spacing after CJK punctuation. Resume at
 * the next proven source origin instead of carrying that width error forward.
 * Near-full-width CJK stops can still acquire negative spacing after font
 * calibration. A proven gap around a number also restarts its source origin:
 * readers can quantize accumulated CJK tracking before a critical numeric field.
 * Latin words and gaps without these source conditions keep their shaping.
 */
export function compressedPunctuationChunks(line) {
  if (!line.items.every(item => item.preciseInk && !item.ocr)) return [line];
  // TeX spacing accents can deliberately overpaint the beginning of a word.
  // A sequential run would fit that WHOLE word into the accent's tiny advance.
  // Keep each original parent at its own origin, including its internal words.
  if (nativeAccentOverlay(line.items)) return line.items.flatMap((item, index) => compressedPunctuationChunks({
    ...line, id: `${line.id}:accent:${index}`, items: [item], rect: { ...item.rect }, baseline: item.baseline, size: item.size,
  }));
  const items = line.items.flatMap(item => item.words?.length > 1
    ? item.words.map(word => ({ ...item, ...word, words: undefined })) : [item]);
  const hasHan = items.some(item => /\p{Script=Han}/u.test(item.text));
  const breaks = new Set();
  for (let index = 0; index + 1 < items.length; index++) {
    const current = items[index], next = items[index + 1];
    const advance = next.baselineX - current.baselineX;
    const numericGap = hasHan && Number.isFinite(current.advanceWidth)
      && ((/^\p{Script=Han}$/u.test(current.text) && /^[0-9]+$/.test(next.text))
        || (/^[0-9]+$/.test(current.text) && /^\p{Script=Han}$/u.test(next.text)))
      && advance - current.advanceWidth > current.size * .1
      && advance - current.advanceWidth < current.size * .6;
    if (numericGap) breaks.add(index);
    const cjkStop = hasHan && /^[，。！？、；：]$/u.test(current.text);
    if (/^[\u2000-\u206f\u3000-\u303f\uff00-\uffef]$/u.test(current.text)
      && Number.isFinite(advance) && advance > 0
      && advance < current.size * (cjkStop ? 1.05 : .8)) breaks.add(index);
  }
  if (!breaks.size) return [line];
  const chunks = []; let pending = [];
  const flush = () => {
    chunks.push({ ...line, id: `${line.id}:punctuation:${chunks.length}`, items: pending,
      rect: union(pending.map(item => item.rect)) });
    pending = [];
  };
  for (const [index, item] of items.entries()) {
    pending.push(item);
    if (breaks.has(index)) flush();
  }
  if (pending.length) flush();
  return chunks;
}
