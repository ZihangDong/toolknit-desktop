// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { wordError } from '../core/input.js';

export async function canvasBytes(canvas, type = 'image/png', quality) {
  if (typeof canvas.toBuffer === 'function') return new Uint8Array(type === 'image/png' ? canvas.toBuffer(type) : canvas.toBuffer(type, Math.round(quality * 100)));
  if (typeof canvas.convertToBlob === 'function') return new Uint8Array(await (await canvas.convertToBlob({ type, quality })).arrayBuffer());
  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(wordError('image')), type, quality));
  return new Uint8Array(await blob.arrayBuffer());
}

function hasPhotographicColor(canvas, createCanvas) {
  const sample = createCanvas(48, 48);
  try {
    const context = sample.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, 48, 48);
    context.drawImage(canvas, 0, 0, 48, 48);
    const { data } = context.getImageData(0, 0, 48, 48), colors = new Set();
    let chromatic = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] !== 255) return false;
      const red = data[index], green = data[index + 1], blue = data[index + 2];
      if (Math.max(red, green, blue) - Math.min(red, green, blue) >= 24) chromatic++;
      colors.add((red >> 4) << 8 | (green >> 4) << 4 | blue >> 4);
    }
    return colors.size >= 96 && chromatic >= 48 * 48 / 4;
  } finally { sample.width = sample.height = 0; }
}

/** Only encode the already composited visible crop, never a raw PDF image. */
export async function encodeImageAsset(canvas, item, createCanvas, check = () => {}, opaqueRendered = false) {
  const png = await canvasBytes(canvas); check();
  if (!opaqueRendered || item.backgroundPaintIndexes?.length || png.length < 1024 * 1024 || item.role !== 'figure' || !Array.isArray(item.sourceIds) || item.sourceIds.length
    || item.mathGlyphs?.length || !Array.isArray(item.reasons) || item.reasons.some(reason => reason !== 'image')
    || !hasPhotographicColor(canvas, createCanvas)) return { bytes: png, format: 'png' };
  check();
  const jpeg = await canvasBytes(canvas, 'image/jpeg', .96); check();
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff || jpeg.length >= png.length * .8) return { bytes: png, format: 'png' };
  return { bytes: jpeg, format: 'jpg' };
}
