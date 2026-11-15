// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
// Local raster evidence only. These are geometric proposals, not semantics.
import { validRect, contains, overlaps, union, median } from './geometry.js';

const area = r => r.width * r.height;
const pad = (r, n, width, height) => {
  const x = Math.max(0, Math.floor(r.x - n)), y = Math.max(0, Math.floor(r.y - n));
  return { x, y, width: Math.min(width, Math.ceil(r.x + r.width + n)) - x,
    height: Math.min(height, Math.ceil(r.y + r.height + n)) - y };
};
const gap = (a, b) => ({ x: Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width),
  y: Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height) });

/** Detect large connected non-text ink, after excluding OCR boxes and straight
 * rules from an ANALYSIS mask. The visible input pixels are never changed.
 * Bounded to one raster page and <=1000 OCR lines; unknown/mixed native scenes
 * retain the established engine. No file names, page numbers or sample boxes.
 */
export function scanFigureRegions({ scene, result, pixels, width, height, check = () => {} }) {
  if (!(scene?.width > 0 && scene.height > 0) || !Number.isFinite(scene.width + scene.height) || !(scene.rasterPage || scene.risks?.includes('image-page'))
    || scene.sources?.length || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 32 || height < 32
    || width * height > 16_000_000 || !(pixels instanceof Uint8ClampedArray) || pixels.length !== width * height * 4
    || result?.width !== width || result?.height !== height || !Array.isArray(result.lines) || result.lines.length > 1000) return [];
  const lines = result.lines.map((line, index) => ({ ...line, index })).filter(line => validRect(line) && line.width > 0 && line.height > 0
    && typeof line.text === 'string' && line.text.length <= 8000 && Number.isFinite(line.confidence) && line.confidence >= .5
    && contains({ x: 0, y: 0, width, height }, line, 1));
  const bodyHeights = lines.filter(l => l.width > width * .25 && [...l.text].length >= 12).map(l => l.height);
  if (bodyHeights.length < 3) return [];
  const em = median(bodyHeights), step = Math.max(2, Math.ceil(Math.max(width, height) / 1200));
  if (em < 6 || em > height * .06) return [];
  const cols = Math.ceil(width / step), rows = Math.ceil(height / step), size = cols * rows;
  const mask = new Uint8Array(size), raw = new Uint8Array(size), excluded = new Uint8Array(size);
  const exclude = r => {
    const left = Math.max(0, Math.floor(r.x / step)), top = Math.max(0, Math.floor(r.y / step));
    const right = Math.min(cols, Math.ceil((r.x + r.width) / step)), bottom = Math.min(rows, Math.ceil((r.y + r.height) / step));
    for (let y = top; y < bottom; y++) excluded.fill(1, y * cols + left, y * cols + right);
  };
  for (const line of lines) exclude(pad(line, Math.max(2, em * .12), width, height));
  for (const rule of (Array.isArray(result.rules) ? result.rules : []).slice(0, 3000)) {
    if (!['h', 'v'].includes(rule.axis) || ![rule.at, rule.from, rule.to].every(Number.isFinite) || rule.to <= rule.from) continue;
    const n = Math.max(3, em * .12);
    exclude(rule.axis === 'h' ? { x: rule.from, y: rule.at - n, width: rule.to - rule.from, height: n * 2 }
      : { x: rule.at - n, y: rule.from, width: n * 2, height: rule.to - rule.from });
  }
  // A few actual pixels per cell preserve thin sloping strokes without
  // allocating another full-resolution RGBA page or performing OCR again.
  for (let y = 0; y < height; y++) {
    if (y % 128 === 0) check();
    const row = Math.floor(y / step) * cols;
    for (let x = 0; x < width; x++) {
      const cell = row + Math.floor(x / step), o = (y * width + x) * 4;
      if (pixels[o + 3] > 240 && Math.min(pixels[o], pixels[o + 1], pixels[o + 2]) < 180) {
        raw[cell] = 1; if (!excluded[cell]) mask[cell] = 1;
      }
    }
  }
  // Small gaps in scans and text boxes can separate a map's coastlines.
  const linked = new Uint8Array(size);
  for (let y = 1; y + 1 < rows; y++) for (let x = 1; x + 1 < cols; x++) {
    const at = y * cols + x;
    if (!mask[at]) continue;
    for (let dy = -1; dy <= 1; dy++) linked.fill(1, at + dy * cols - 1, at + dy * cols + 2);
  }
  const queue = new Uint32Array(size), cores = [];
  for (let first = 0; first < size; first++) {
    if (first % 65536 === 0) check();
    if (!linked[first]) continue;
    let count = 1, cursor = 0, ink = 0, left = cols, right = 0, top = rows, bottom = 0;
    queue[0] = first; linked[first] = 0;
    while (cursor < count) {
      const at = queue[cursor++], x = at % cols, y = Math.floor(at / cols);
      if (mask[at]) { ink++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
      for (const next of [x ? at - 1 : -1, x + 1 < cols ? at + 1 : -1, y ? at - cols : -1, y + 1 < rows ? at + cols : -1]) {
        if (next >= 0 && linked[next]) { linked[next] = 0; queue[count++] = next; }
      }
    }
    if (ink < 1) continue;
    const rect = { x: left * step, y: top * step, width: (right - left + 1) * step, height: (bottom - top + 1) * step };
    if (rect.width < em * 2.5 || rect.height < em * 2.5 || area(rect) < em * em * 16 || ink * step * step < em * em * 1.4) continue;
    // Full pages, borders, watermarks and large paper fills are not figures.
    if (area(rect) > width * height * .48 || rect.height > height * .55 || rect.width > width * .94) continue;
    cores.push({ ...rect, ink });
    if (cores.length > 96) return [];
  }
  if (!cores.length) return [];
  // A graphic's internal labels may themselves be long. Only independently
  // external prose is a barrier to expansion and joining.
  const barriers = lines.filter(line => !cores.some(core => contains(pad(core, em * .2, width, height), line, 0))
    && line.width > width * .23 && [...line.text].length >= 12 && line.height < em * 1.8);
  // Short last lines of body paragraphs are also body. Infer them from the
  // established prose's left edge and line spacing, not the words it says.
  const prose = [...barriers];
  for (const line of lines) if (!barriers.includes(line) && !cores.some(core => overlaps(core, line, 0))
    && line.height > em * .6 && line.height < em * 1.6
    && prose.some(body => Math.abs(body.x - line.x) < em * .8 && gap(body, line).y < em * 1.6
      && Math.abs(body.y - line.y) > em * .5)) barriers.push(line);
  let regions = cores.map(core => pad(core, em * .25, width, height));
  const safe = rect => !barriers.some(line => overlaps(rect, line, 0));
  // Reconnect to original unmasked ink. Analysis exclusions can split a filled
  // map or cut a graph at its straight axes; they must never define the crop.
  const rawSeen = new Uint8Array(size), fragments = [];
  for (let first = 0; first < size; first++) {
    if (first % 65536 === 0) check();
    if (!raw[first] || rawSeen[first]) continue;
    let count = 1, cursor = 0, left = cols, right = 0, top = rows, bottom = 0;
    queue[0] = first; rawSeen[first] = 1;
    while (cursor < count) {
      const at = queue[cursor++], x = at % cols, y = Math.floor(at / cols);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, next = yy * cols + xx;
        if (xx < 0 || xx >= cols || yy < 0 || yy >= rows || !raw[next] || rawSeen[next]) continue;
        rawSeen[next] = 1; queue[count++] = next;
      }
    }
    if (count * step * step < em * em * .025) continue;
    fragments.push({ x: left * step, y: top * step, width: Math.min(width, (right + 1) * step) - left * step,
      height: Math.min(height, (bottom + 1) * step) - top * step });
    if (fragments.length > 12_000) return [];
  }
  for (let i = 0; i < regions.length; i++) for (let pass = 0; pass < 3; pass++) {
    for (const fragment of fragments) {
      const box = regions[i], d = gap(box, fragment);
      if (d.x > em * .9 || d.y > em * .6) continue;
      const joined = pad(union([box, fragment]), 0, width, height);
      if (area(joined) < width * height * .48 && safe(joined)) regions[i] = joined;
    }
  }
  // Join neighbouring graphic parts only across a narrow, prose-free gap.
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 0; i < regions.length; i++) for (let j = regions.length - 1; j > i; j--) {
      const a = regions[i], b = regions[j], d = gap(a, b), joined = union([a, b]);
      if ((d.x < em * 3 && d.y < em * 1.1 || d.x === 0 && d.y < em * 1.8)
        && area(joined) < width * height * .48 && safe(joined)) {
        regions[i] = joined; regions.splice(j, 1); changed = true;
      }
    }
    if (!changed) break;
  }
  for (let r = 0; r < regions.length; r++) {
    let box = regions[r];
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      for (const line of lines) {
        if (barriers.includes(line) || contains(box, line, 0)) continue;
        const d = gap(box, line);
        if (d.x > em * 1.6 || d.y > em * .95) continue;
        const expanded = union([box, pad(line, em * .15, width, height)]);
        if (safe(expanded) && area(expanded) < width * height * .48) { box = expanded; changed = true; }
      }
      if (!changed) break;
    }
    regions[r] = box;
  }
  const proposals = [];
  for (const region of regions) {
    const padded = pad(region, Math.max(2, em * .12), width, height);
    const box = safe(padded) ? padded : region;
    if (!safe(box) || proposals.some(p => overlaps(p.pixelRect, box, 0))) continue;
    // Intersecting an OCR line is not permission to cut it in half.
    if (lines.some(line => overlaps(box, line, 0) && !contains(box, line, 0))) continue;
    const lineIndexes = lines.filter(line => contains(box, line, 0)).map(line => line.index);
    proposals.push({ id: `p${scene.number}:scan-figure${proposals.length}`, pixelRect: box,
      rect: { x: box.x * scene.width / width, y: box.y * scene.height / height,
        width: box.width * scene.width / width, height: box.height * scene.height / height },
      lineIndexes, evidence: 'connected-nontext-ink', version: 1 });
  }
  return proposals.slice(0, 12);
}
