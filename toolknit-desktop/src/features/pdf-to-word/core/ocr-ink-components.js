// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.

/** Small isolated masks only. Preserve every foreground pixel, including noise;
 * callers decide whether the complete component inventory is safe to fit. */
export function isolatedInkComponents(mask, width, height, { check = () => {} } = {}) {
  if (!(mask instanceof Uint8Array) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1 || width * height > 262144 || mask.length !== width * height) return null;
  check();
  const seen = new Uint8Array(mask.length), result = [];
  for (let first = 0; first < mask.length; first++) {
    if (first % 1024 === 0) check();
    if (!mask[first] || seen[first]) continue;
    const points = [first]; seen[first] = 1;
    let x = width, y = height, right = 0, bottom = 0;
    for (let cursor = 0; cursor < points.length; cursor++) {
      if (cursor % 256 === 0) check();
      const at = points[cursor], xx = at % width, yy = Math.floor(at / width);
      x = Math.min(x, xx); y = Math.min(y, yy); right = Math.max(right, xx + 1); bottom = Math.max(bottom, yy + 1);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = xx + dx, ny = yy + dy, next = ny * width + nx;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && mask[next] && !seen[next]) {
          seen[next] = 1; points.push(next);
        }
      }
    }
    result.push({ x, y, right, bottom, points });
    if (result.length > 8) return null;
  }
  return result.sort((a, b) => a.x - b.x);
}
