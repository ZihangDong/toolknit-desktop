// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { textInkRects } from './text-geometry.js';
import { overlaps, right, bottom, contains, validRect } from './geometry.js';

const sameBox = (a, b) => a && b && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(a[k]) && Math.abs(a[k] - b[k]) < .01);
const plain = text => String(text || '').replace(/\s/gu, '');

/** A raised source reference can intersect a following run's hull without
 * intersecting any of its words. This proposal does not authorize skipping
 * paint: the original and optimized render streams must prove that separately.
 */
export function raisedReferenceText(text, sources, bounds) {
  if (!Array.isArray(text) || text.length > 2000 || !Array.isArray(sources) || sources.length > 12000
    || !bounds || !validRect(bounds)) return new Set();
  const ledger = new Map(sources.map(source => [source.id, source]));
  if (ledger.size !== sources.length) return new Set();
  const owned = item => {
    const source = ledger.get(item.id);
    return item.sourceIds?.length === 1 && item.sourceIds[0] === item.id && source?.text === item.text
      && Number.isInteger(item.order) && source.order === item.order
      && ['editable', 'visible-image'].includes(source.disposition) && sameBox(source.rect, item.rect)
      && contains(bounds, item.rect, 0) && validRect(item.rect) && item.rect.width > 0 && item.rect.height > 0;
  };
  const ordinary = item => item && item.preciseInk && !item.raster && !item.ocr && !item.italic && !item.alphabet
    && !item.mathStyleUncertain && !item.radicalPart && !item.delimiterPart
    && Number.isFinite(item.size + item.baseline + item.baselineX) && item.size >= 6 && item.size <= 20
    && Math.abs((item.horizontalScale ?? 1) - 1) < .001
    && /^(?:[A-Z]{6}\+)?NimbusRomNo9L-(?:Regu|Medi)$/u.test(item.font || '') && owned(item);
  const sameStyle = (a, b) => ordinary(a) && a.font === b.font && a.bold === b.bold && a.color === b.color
    && Math.abs(a.size - b.size) < .01;
  const marker = (item, body) => item && !item.raster && !item.ocr && !item.italic && !item.bold && item.preciseInk
    && !item.mathStyleUncertain && /^(?:∗|†|‡)$/u.test(item.text || '')
    && /^(?:[A-Z]{6}\+)?CMSY[5-9]$/u.test(item.font || '') && owned(item) && item.color === body.color
    && Number.isFinite(item.size + item.baseline + item.baselineX) && item.size <= body.size * .78 && item.size >= body.size * .55
    && Math.abs((item.horizontalScale ?? 1) - 1) < .001;
  const preceding = (reference, body, baseline) => text.filter(peer => peer !== body && peer !== reference && sameStyle(peer, body)
    && Math.abs(peer.baseline - baseline) < .05 && /[A-Za-z]{3,}\s*$/u.test(peer.text || '')
    && right(peer.rect) <= reference.rect.x + .1 && reference.rect.x - right(peer.rect) < body.size * .5);
  const candidates = text.filter(item => ordinary(item) && item.text.length <= 240 && /^\s*[,;]\s*[A-Za-z]{3,}/u.test(item.text)
    && !/[=<>∑∫√^_]/u.test(item.text) && item.words?.length >= 3 && item.words.length <= 24);
  if (candidates.length > 8) return new Set();
  const markers = text.filter(item => /^(?:∗|†|‡)$/u.test(item.text || ''));
  if (markers.length > 32) return new Set();
  const accepted = new Set();
  for (const body of candidates) {
    if (plain(body.words.map(word => word.text).join('')) !== plain(body.text)
      || body.words.some((word, index) => !word.text?.trim() || !validRect(word.rect) || !contains(body.rect, word.rect, .01)
        || index && word.rect.x < right(body.words[index - 1].rect) - .1)) continue;
    const direct = markers.filter(other => marker(other, body) && body.baseline - other.baseline >= body.size * .2
      && body.baseline - other.baseline <= body.size * .65 && Math.abs(other.baselineX - body.baselineX) < .05
      && !textInkRects(body).some(rect => overlaps(rect, other.rect, 0))
      && preceding(other, body, body.baseline).length === 1);
    if (direct.length !== 1) continue;
    const nearby = { x: body.rect.x - body.size * .4, y: body.rect.y - body.size * .4,
      width: body.rect.width + body.size * .8, height: body.rect.height + body.size * .8 };
    const suspicious = text.filter(other => other !== body && overlaps(nearby, other.rect, 0)
      && (other.size < body.size * .85 || other.size > body.size / .85 || other.alphabet
        || other.radicalPart || other.delimiterPart || /[\p{Sm}^_]/u.test(other.text)));
    if (suspicious.some(other => {
      if (other === direct[0]) return false;
      if (!marker(other, body) || other.rect.y < bottom(body.rect) + body.size * .1) return true;
      // Another line's reference is independent only with its own unique
      // adjacent base and a full vertical gap below every word in this run.
      const bases = text.filter(peer => sameStyle(peer, body) && peer !== body && /[A-Za-z]{3,}\s*$/u.test(peer.text || '')
        && peer.baseline - other.baseline > body.size * .2 && peer.baseline - other.baseline < body.size * .65
        && right(peer.rect) <= other.rect.x + .1 && other.rect.x - right(peer.rect) < body.size * .5);
      return bases.length !== 1;
    })) continue;
    accepted.add(body.id);
  }
  return accepted;
}
