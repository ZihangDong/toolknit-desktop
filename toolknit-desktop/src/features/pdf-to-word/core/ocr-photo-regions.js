// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { validRect, contains } from './geometry.js';
import { photographicSample } from './raster-photo.js';

function sample(pixels, width, box) {
  const data = new Uint8ClampedArray(48 * 48 * 4), w = box.right - box.x, h = box.bottom - box.y;
  for (let row = 0; row < 48; row++) for (let col = 0; col < 48; col++) {
    const values = [0, 0, 0];
    for (const dy of [.25, .75]) for (const dx of [.25, .75]) {
      const x = Math.min(box.right - 1, Math.floor(box.x + (col + dx) * w / 48));
      const y = Math.min(box.bottom - 1, Math.floor(box.y + (row + dy) * h / 48)), offset = (y * width + x) * 4;
      if (pixels[offset + 3] !== 255) return null;
      for (let channel = 0; channel < 3; channel++) values[channel] += pixels[offset + channel];
    }
    const offset = (row * 48 + col) * 4;
    for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.round(values[channel] / 4);
    data[offset + 3] = 255;
  }
  return data;
}

function neighborhood(mask, cols, rows, dilate) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let value = dilate ? 0 : 1;
    scan: for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const bit = mask[Math.max(0, Math.min(rows - 1, y + dy)) * cols + Math.max(0, Math.min(cols - 1, x + dx))];
      if (dilate ? bit : !bit) { value = dilate ? 1 : 0; break scan; }
    }
    out[y * cols + x] = value;
  }
  return out;
}

function paperRegions(pixels, width, box, cols, rows) {
  let mask = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const xx = Math.min(box.right - 1, Math.floor(box.x + (x + .5) * (box.right - box.x) / cols));
    const yy = Math.min(box.bottom - 1, Math.floor(box.y + (y + .5) * (box.bottom - box.y) / rows));
    const offset = (yy * width + xx) * 4, r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
    mask[y * cols + x] = Math.min(r, g, b) >= 235 && Math.max(r, g, b) - Math.min(r, g, b) <= 20 ? 1 : 0;
  }
  // Link white document cells across small ink/rule gaps. Broad coloured
  // photographic surroundings remain separate from the continuous paper.
  mask = neighborhood(neighborhood(mask, cols, rows, true), cols, rows, false);
  const seen = new Uint8Array(mask.length), accepted = new Uint8Array(mask.length), queue = new Uint32Array(mask.length);
  for (let first = 0; first < mask.length; first++) {
    if (!mask[first] || seen[first]) continue;
    let count = 1, cursor = 0, edge = false; queue[0] = first; seen[first] = 1;
    const add = index => { if (mask[index] && !seen[index]) { seen[index] = 1; queue[count++] = index; } };
    while (cursor < count) {
      const index = queue[cursor++], x = index % cols, y = Math.floor(index / cols);
      if (!x || !y || x === cols - 1 || y === rows - 1) edge = true;
      if (x) add(index - 1); if (x + 1 < cols) add(index + 1);
      if (y) add(index - cols); if (y + 1 < rows) add(index + cols);
    }
    // A large photographed sheet may be surrounded by a desk, with no paper
    // touching the image boundary. Preserve OCR for that continuous sheet too.
    if (edge || count >= mask.length * .45) for (let i = 0; i < count; i++) accepted[queue[i]] = 1;
  }
  return accepted;
}

/** Protect photographic texture unless all eight padded perimeter samples
 * belong to continuous paper. Original unowned raster crops only; native
 * glyphs, diagrams and unknown clipping retain their current paths. */
export function photographicOcrRegions(scene, pixels, width, height) {
  const noop = () => false;
  if (!(pixels instanceof Uint8ClampedArray) || pixels.length !== width * height * 4
    || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || width * height > 16_000_000 || !(scene?.width > 0 && scene.height > 0)
    || !Array.isArray(scene.items) || scene.items.length > 20_000) return noop;
  const sx = width / scene.width, sy = height / scene.height, entries = [];
  let remaining = 320_000;
  const images = scene.items.filter(item => item.type === 'image' && item.role === 'figure' && !item.thin && !item.decoration
    && !item.sourceIds?.length && !item.reasons?.length && validRect(item.rect)
    && item.rect.width * item.rect.height >= scene.width * scene.height * .05)
    .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height).slice(0, 32);
  for (const image of images) {
    const rect = image.rect, box = { x: Math.max(0, Math.floor(rect.x * sx)), y: Math.max(0, Math.floor(rect.y * sy)),
      right: Math.min(width, Math.ceil((rect.x + rect.width) * sx)), bottom: Math.min(height, Math.ceil((rect.y + rect.height) * sy)) };
    if (box.right <= box.x || box.bottom <= box.y) continue;
    const ratio = Math.min(1, 320 / (box.right - box.x), 320 / (box.bottom - box.y));
    const cols = Math.max(1, Math.min(320, Math.ceil((box.right - box.x) * ratio))), rows = Math.max(1, Math.min(320, Math.ceil((box.bottom - box.y) * ratio)));
    if (cols * rows > remaining) continue;
    const data = sample(pixels, width, box);
    if (!photographicSample(data)) continue;
    remaining -= cols * rows;
    entries.push({ rect, box, cols, rows, paper: paperRegions(pixels, width, box, cols, rows) });
  }
  const points = [[0, 0], [.5, 0], [1, 0], [0, .5], [1, .5], [0, 1], [.5, 1], [1, 1]];
  return rect => validRect(rect) && entries.some(entry => {
    if (!contains(entry.rect, rect, 2)) return false;
    const { box, cols, rows, paper } = entry, left = rect.x * sx - 2, top = rect.y * sy - 2;
    return !points.every(([dx, dy]) => {
      const px = Math.floor(left + (rect.width * sx + 4) * dx), py = Math.floor(top + (rect.height * sy + 4) * dy);
      if (px < box.x || px >= box.right || py < box.y || py >= box.bottom) return false;
      // Closing can bridge a coloured logo stroke. The actual perimeter must
      // still be paper, not merely a white cell in the coarse connectivity map.
      const offset = (py * width + px) * 4, r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
      if (pixels[offset + 3] !== 255 || Math.min(r, g, b) < 235 || Math.max(r, g, b) - Math.min(r, g, b) > 20) return false;
      const x = Math.max(0, Math.min(cols - 1, Math.floor((px - box.x) / (box.right - box.x) * cols)));
      const y = Math.max(0, Math.min(rows - 1, Math.floor((py - box.y) / (box.bottom - box.y) * rows)));
      return paper[y * cols + x];
    });
  });
}
