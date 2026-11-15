// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.

/** The recognizer can collapse the three rings of per-mille into percent.
 * Require closed source-ink rings AND an independently stronger local glyph;
 * rates, neighbouring numbers and language are never used to infer a symbol.
 */
export function recoverOcrPermille({ text, mask, width, height, confidence, score }) {
  const side = 32;
  if (text !== '%' || !(mask instanceof Uint8Array) || mask.length !== side * side
    || !(width >= 12 && height >= 12 && width / height >= .9 && width / height <= 1.7)
    || !(confidence >= .75 && confidence <= 1) || typeof score !== 'function') return null;
  const seen = new Uint8Array(mask.length), holes = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] || seen[start]) continue;
    const queue = [start]; seen[start] = 1;
    let edge = false, sumX = 0, sumY = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const at = queue[cursor], x = at % side, y = Math.floor(at / side);
      sumX += x; sumY += y;
      if (!x || x === side - 1 || !y || y === side - 1) edge = true;
      for (const next of [x ? at - 1 : -1, x < side - 1 ? at + 1 : -1,
        y ? at - side : -1, y < side - 1 ? at + side : -1]) {
        if (next >= 0 && !mask[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
      }
    }
    // Ignore tiny resampling pinholes, retaining all substantial closed areas.
    if (!edge && queue.length >= 6) holes.push({ x: sumX / queue.length / side,
      y: sumY / queue.length / side, area: queue.length });
  }
  if (holes.length !== 3 || holes.some(hole => hole.area > 100)) return null;
  holes.sort((a, b) => a.x - b.x);
  const [top, middle, right] = holes;
  if (!(top.x < .35 && top.y < .45 && middle.x > .3 && middle.x < .65
    && right.x > .7 && middle.y > .55 && right.y > .55
    && Math.abs(middle.y - right.y) <= .15 && right.x - middle.x > .2)) return null;
  const original = score('%'), replacement = score('‰');
  if (!Number.isFinite(original) || !Number.isFinite(replacement)
    || replacement < .7 || replacement - original < .15) return null;
  return { text: '‰', rule: 'source-ink-permille', holes: 3,
    similarity: replacement, margin: replacement - original };
}

/** A lost raised 2 can leave a complete square-metre glyph labelled as m.
 * Prove its raised/right ink and reject cubic/degree/ordinary-letter rivals;
 * neighbouring amounts or words never decide which unit was printed.
 */
export function recoverOcrSquareMetre({ text, mask, width, height, confidence, score }) {
  if (text !== 'm' || !(mask instanceof Uint8Array) || mask.length !== 1024
    || !(width >= 12 && height >= 12 && width / height >= .8 && width / height <= 1.8)
    || !(confidence >= .7 && confidence <= 1) || typeof score !== 'function') return null;
  let total = 0, upperLeft = 0, raised = 0, body = 0, lowerRight = 0;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (mask[y * 32 + x]) {
    total++;
    if (y < 9 && x < 19) upperLeft++;
    if (y < 10 && x >= 19) raised++;
    if (y >= 14 && x < 20) body++;
    if (y >= 21 && x >= 28) lowerRight++;
  }
  if (total < 80 || upperLeft > total * .25 || raised < 8 || body < 30
    || lowerRight > Math.max(2, total * .01)) return null;
  const replacement = score('㎡');
  const alternatives = ['m', 'M', '㎥', 'm³', 'm°'].map(token => score(token));
  if (!Number.isFinite(replacement) || alternatives.some(value => !Number.isFinite(value))) return null;
  const margin = replacement - Math.max(...alternatives);
  if (replacement < .75 || margin < .12) return null;
  return { text:'㎡', rule:'source-ink-square-metre', similarity:replacement, margin };
}
