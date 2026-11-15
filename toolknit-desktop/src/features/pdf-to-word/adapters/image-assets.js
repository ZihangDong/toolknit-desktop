// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { wordError } from '../core/input.js';
import { photographicSample } from '../core/raster-photo.js';

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
    return photographicSample(context.getImageData(0, 0, 48, 48).data);
  } finally { sample.width = sample.height = 0; }
}

/** Only encode the already composited visible crop, never a raw PDF image. */
export async function encodeImageAsset(canvas, item, createCanvas, check = () => {}, opaqueRendered = false, { maxPixelScale = Infinity, sourceById = null } = {}) {
  const png = await canvasBytes(canvas); check();
  // Unverified OCR labels are accounting for pixels already left in an image,
  // not proof of native glyphs. Adding those labels must not turn a photograph
  // into a lossless scan and exhaust the existing asset budget. Missing or
  // verified source evidence retains the original PNG protection.
  const hypothesisOnly=Array.isArray(item.sourceIds)&&item.sourceIds.length>0&&sourceById instanceof Map
    &&item.sourceIds.every(id=>{const source=sourceById.get(id);return source?.id===id
      &&source.ocrUnverified===true&&source.disposition==='visible-image';});
  if (!opaqueRendered || item.backgroundPaintIndexes?.length || item.decorationTextPaintIndexes?.length || png.length < 512 * 1024 || item.role !== 'figure' || !Array.isArray(item.sourceIds) || item.sourceIds.length&&!hypothesisOnly
    || item.mathGlyphs?.length || !Array.isArray(item.reasons) || item.reasons.some(reason => reason !== 'image')
    || !hasPhotographicColor(canvas, createCanvas)) return { bytes: png, format: 'png' };
  check();
  let resized=null;
  try {
  const ratio=Math.min(1,item.rect.width*maxPixelScale/canvas.width,item.rect.height*maxPixelScale/canvas.height);
  if(ratio<.99){resized=createCanvas(Math.max(1,Math.ceil(canvas.width*ratio)),Math.max(1,Math.ceil(canvas.height*ratio)));const context=resized.getContext('2d');context.imageSmoothingQuality='high';context.drawImage(canvas,0,0,resized.width,resized.height);}
  const jpeg = await canvasBytes(resized||canvas, 'image/jpeg', .96); check();
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff || jpeg.length >= png.length * .8) return { bytes: png, format: 'png' };
  return { bytes: jpeg, format: 'jpg', width:(resized||canvas).width, height:(resized||canvas).height };
  } finally {if(resized)resized.width=resized.height=0;}
}
