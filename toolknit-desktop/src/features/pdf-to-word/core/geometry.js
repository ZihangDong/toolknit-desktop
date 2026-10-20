// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);
export const point = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], ...point(a, b[4], b[5])
];
export const right = r => r.x + r.width;
export const bottom = r => r.y + r.height;
export const area = r => r ? Math.max(0, r.width) * Math.max(0, r.height) : 0;
export function union(rects) {
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
  let x = Infinity, y = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const rect of rects) { x = Math.min(x, rect.x); y = Math.min(y, rect.y); x2 = Math.max(x2, right(rect)); y2 = Math.max(y2, bottom(rect)); }
  return { x, y, width: x2 - x, height: y2 - y };
}
export function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const width = Math.min(right(a), right(b)) - x, height = Math.min(bottom(a), bottom(b)) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}
export const overlaps = (a, b, epsilon = 0.1) => Math.min(right(a), right(b)) - Math.max(a.x, b.x) > epsilon
  && Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y) > epsilon;
export const contains = (outer, inner, epsilon = 0.15) => outer.x <= inner.x + epsilon && outer.y <= inner.y + epsilon
  && right(outer) >= right(inner) - epsilon && bottom(outer) >= bottom(inner) - epsilon;

/** A conservative stroke test: shaft bounds plus endpoint caps/miter joins. */
export function strokeMayTouchRect(path, rect) {
  if (path?.paint !== 'stroke' || !Array.isArray(path.from) || !Array.isArray(path.to)
    || ![...path.from, ...path.to, path.strokeRadius, path.joinRadius].every(Number.isFinite)
    || path.strokeRadius < 0 || path.joinRadius < path.strokeRadius) return true;
  const distance = ([x, y]) => Math.hypot(Math.max(rect.x - x, 0, x - right(rect)), Math.max(rect.y - y, 0, y - bottom(rect)));
  if (distance(path.from) <= path.joinRadius || distance(path.to) <= path.joinRadius) return true;
  const [x, y] = path.from, dx = path.to[0] - x, dy = path.to[1] - y, padding = path.strokeRadius;
  let first = 0, last = 1;
  for (const [p, q] of [[-dx, x - rect.x + padding], [dx, right(rect) + padding - x],
    [-dy, y - rect.y + padding], [dy, bottom(rect) + padding - y]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const ratio = q / p;
    if (p < 0) first = Math.max(first, ratio); else last = Math.min(last, ratio);
    if (first > last) return false;
  }
  return true;
}
export function transformedRect(matrix, x, y, width, height) {
  const pts = [[x, y], [x + width, y], [x, y + height], [x + width, y + height]].map(p => point(matrix, ...p));
  const left = Math.min(...pts.map(p => p[0])), top = Math.min(...pts.map(p => p[1]));
  return { x: left, y: top, width: Math.max(...pts.map(p => p[0])) - left, height: Math.max(...pts.map(p => p[1])) - top };
}
export const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};
export const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;
export const validRect = r => r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width >= 0 && r.height >= 0;

// Fixed cells bound neighbourhood searches without depending on drawing order.
export function spatialIndex(items, size = 64) {
  const cells = new Map(), large = [];
  const keys = rect => {
    const result = [];
    if (!validRect(rect) || (Math.ceil(rect.width / size) + 2) * (Math.ceil(rect.height / size) + 2) > 4096) return null;
    for (let y = Math.floor(rect.y / size); y <= Math.floor(bottom(rect) / size); y++) {
      for (let x = Math.floor(rect.x / size); x <= Math.floor(right(rect) / size); x++) result.push(`${x}:${y}`);
    }
    return result;
  };
  for (const item of items) {
    const itemKeys = keys(item.rect);
    if (!itemKeys) { large.push(item); continue; }
    for (const key of itemKeys) {
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(item);
    }
  }
  return rect => { const query = keys(rect); return query ? [...new Set([...large, ...query.flatMap(key => cells.get(key) || [])])] : items; };
}
