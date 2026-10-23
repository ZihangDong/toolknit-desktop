// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { LIMITS, wordError } from './input.js';

/** Check rendered source ink independently of Unicode/source-ID accounting. */
export function inspectSceneInk(scene, pixels, width, height, scale) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width * height > LIMITS.renderPixels || pixels.length !== width * height * 4) throw wordError('geometry');
  if (scale !== undefined && (!Number.isFinite(scale) || scale <= 0 || Math.abs(scene.width * scale - width) > 1.1
    || Math.abs(scene.height * scale - height) > 1.1)) throw wordError('geometry');
  const coverage = new Uint8Array(width * height), sx = scale ?? width / scene.width, sy = scale ?? height / scene.height;
  // Hinting and antialiasing may paint one device pixel beyond the outline box.
  // Keep this local to known geometry; never forgive an arbitrary missing count.
  const padX = .5 + 1 / sx, padY = .5 + 1 / sy;
  for (const item of scene.items) {
    const rect = item.rect;
    const x1 = Math.max(0, Math.floor((rect.x - padX) * sx)), x2 = Math.min(width, Math.ceil((rect.x + rect.width + padX) * sx));
    const y1 = Math.max(0, Math.floor((rect.y - padY) * sy)), y2 = Math.min(height, Math.ceil((rect.y + rect.height + padY) * sy));
    for (let y = y1; y < y2; y++) coverage.fill(1, y * width + x1, y * width + x2);
  }
  let inkPixels = 0, uncoveredPixels = 0, minX = width, minY = height, maxX = 0, maxY = 0;
  for (let i = 0; i < coverage.length; i++) {
    const offset = i * 4, alpha = pixels[offset + 3] / 255;
    const luminance = (pixels[offset] * .2126 + pixels[offset + 1] * .7152 + pixels[offset + 2] * .0722) * alpha + 255 * (1 - alpha);
    if (luminance >= 200) continue;
    inkPixels++;
    if (!coverage[i]) {
      uncoveredPixels++;
      const x = i % width, y = Math.floor(i / width);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  return { accepted: uncoveredPixels === 0, inkPixels, uncoveredPixels,
    bounds: uncoveredPixels ? { x: minX / sx, y: minY / sy, width: (maxX - minX + 1) / sx, height: (maxY - minY + 1) / sy } : null };
}
