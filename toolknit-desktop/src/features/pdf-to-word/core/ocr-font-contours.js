// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.

export const OCR_CONTOUR_LIMITS = Object.freeze({ side: 256, edges: 32768, points: 8192 });

/** Trace every pixel boundary of an already-owned binary glyph. This function
 * proves geometry only, not OCR spelling, complete source ownership or font
 * identity. The caller must establish those before using a generated font.
 * Input pixels are never changed; diagonal-touch components stay separate.
 */
export function traceOcrGlyph(mask, width, height, { check = () => {}, maxEdges = OCR_CONTOUR_LIMITS.edges,
  maxPoints = OCR_CONTOUR_LIMITS.points } = {}) {
  if (!(mask instanceof Uint8Array) || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width > OCR_CONTOUR_LIMITS.side || height > OCR_CONTOUR_LIMITS.side
    || mask.length !== width * height || !Number.isInteger(maxEdges) || maxEdges < 4 || maxEdges > OCR_CONTOUR_LIMITS.edges
    || !Number.isInteger(maxPoints) || maxPoints < 4 || maxPoints > OCR_CONTOUR_LIMITS.points) return null;
  const stride = width + 1, from = [], to = [], outgoing = new Map();
  let inkPixels = 0;
  const edge = (a, b) => {
    if (from.length >= maxEdges) return false;
    const index = from.length; from.push(a); to.push(b);
    const values = outgoing.get(a);
    if (values) values.push(index); else outgoing.set(a, [index]);
    return true;
  };
  for (let y = 0; y < height; y++) {
    check();
    for (let x = 0; x < width; x++) {
      const value = mask[y * width + x];
      if (value > 1) return null;
      if (!value) continue;
      inkPixels++;
      const a = y * stride + x, b = a + 1, c = a + stride + 1, d = a + stride;
      if ((!y || !mask[(y - 1) * width + x]) && !edge(a, b)
        || (x === width - 1 || !mask[y * width + x + 1]) && !edge(b, c)
        || (y === height - 1 || !mask[(y + 1) * width + x]) && !edge(c, d)
        || (!x || !mask[y * width + x - 1]) && !edge(d, a)) return null;
    }
  }
  if (!inkPixels) return null;
  const used = new Uint8Array(from.length), contours = [];
  let pointCount = 0, walked = 0;
  for (let first = 0; first < from.length; first++) {
    if (used[first]) continue;
    const ring = []; let index = first;
    for (;;) {
      if ((walked++ & 255) === 0) check();
      if (used[index]) return null;
      used[index] = 1;
      const a = from[index], b = to[index]; ring.push([a % stride, Math.floor(a / stride)]);
      if (b === from[first]) break;
      const dx = b % stride - a % stride, dy = Math.floor(b / stride) - Math.floor(a / stride);
      let next = -1, rank = Infinity;
      for (const candidate of outgoing.get(b) || []) {
        if (used[candidate]) continue;
        const end = to[candidate], vx = end % stride - b % stride, vy = Math.floor(end / stride) - Math.floor(b / stride);
        const cross = dx * vy - dy * vx, dot = dx * vx + dy * vy;
        const value = cross > 0 ? 0 : dot > 0 ? 1 : cross < 0 ? 2 : 3;
        if (value < rank) { rank = value; next = candidate; }
      }
      if (next < 0) return null;
      index = next;
    }
    const points = ring.filter((b, i) => {
      const a = ring[(i + ring.length - 1) % ring.length], c = ring[(i + 1) % ring.length];
      return (b[0] - a[0]) * (c[1] - b[1]) !== (b[1] - a[1]) * (c[0] - b[0]);
    });
    pointCount += points.length;
    if (points.length < 4 || pointCount > maxPoints || contours.length >= 512) return null;
    contours.push(points);
  }
  if (walked !== from.length) return null;
  return { contours, pointCount, edgeCount: from.length, inkPixels };
}
