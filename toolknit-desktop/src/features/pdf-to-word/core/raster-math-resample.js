// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
/** Deterministic separable Lanczos3. Used only for bounded original equation
 * bitmaps; browser-dependent interpolation can destroy small source indices. */
export function enlargeRasterMath(pixels, width, height, factor) {
  if (!(pixels instanceof Uint8ClampedArray) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 16 || width > 512 || height < 12 || height > 128 || pixels.length !== width * height * 4
    || ![2, 4].includes(factor)) return null;
  const sinc = x => Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
  const weights = length => Array.from({ length: length * factor }, (_, index) => {
    const center = (index + .5) / factor, start = Math.max(0, Math.floor(center - 3 + .5));
    const end = Math.min(length, Math.floor(center + 3 + .5)), values = [];
    let sum = 0;
    for (let source = start; source < end; source++) {
      const distance = source + .5 - center, weight = Math.abs(distance) < 3 ? sinc(distance) * sinc(distance / 3) : 0;
      values.push([source, weight]); sum += weight;
    }
    return values.map(([source, weight]) => [source, weight / sum]);
  });
  const horizontal = weights(width), vertical = weights(height), enlargedWidth = width * factor;
  const rows = new Uint8ClampedArray(enlargedWidth * height * 4), result = new Uint8ClampedArray(enlargedWidth * height * factor * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < enlargedWidth; x++) for (let channel = 0; channel < 4; channel++) {
    let value = 0;
    for (const [source, weight] of horizontal[x]) value += pixels[(y * width + source) * 4 + channel] * weight;
    rows[(y * enlargedWidth + x) * 4 + channel] = Math.round(value);
  }
  for (let y = 0; y < height * factor; y++) for (let x = 0; x < enlargedWidth; x++) for (let channel = 0; channel < 4; channel++) {
    let value = 0;
    for (const [source, weight] of vertical[y]) value += rows[(source * enlargedWidth + x) * 4 + channel] * weight;
    result[(y * enlargedWidth + x) * 4 + channel] = Math.round(value);
  }
  return { pixels: result, width: enlargedWidth, height: height * factor };
}
