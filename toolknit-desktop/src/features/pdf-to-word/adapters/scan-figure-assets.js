// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { canvasBytes } from './image-assets.js';
import { LIMITS, wordError } from '../core/input.js';

/** Exact integer-pixel crop from the final visible page BEFORE OCR erasure.
 * PNG only: chart labels and fine lines must not enter photo downsampling.
 */
export async function collectScanFigureAssets(scene, rawCanvas, createCanvas, check = () => {}) {
  const assets = []; let total = 0;
  const figures = scene.items.filter(item => item.type === 'image' && item.scanFigure);
  if (figures.length > 12) throw wordError('image');
  for (const item of figures) {
    check();
    const { pixelRect: r, width, height, version } = item.scanFigure;
    if (version !== 1 || width !== rawCanvas.width || height !== rawCanvas.height || !r
      || ![r.x, r.y, r.width, r.height].every(Number.isSafeInteger) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0
      || r.x + r.width > width || r.y + r.height > height || r.width * r.height > width * height * .48) throw wordError('image');
    const crop = createCanvas(r.width, r.height);
    try {
      crop.getContext('2d').drawImage(rawCanvas, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
      const bytes = await canvasBytes(crop); check(); total += bytes.length;
      if (total > LIMITS.assetBytes) throw wordError('asset-large');
      item.assetId = item.id;
      assets.push({ id: item.id, bytes, width: r.width, height: r.height, format: 'png' });
    } finally { crop.width = crop.height = 0; }
  }
  return assets;
}
