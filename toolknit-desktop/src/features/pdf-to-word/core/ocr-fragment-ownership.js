// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { contains, validRect, union, spatialIndex } from './geometry.js';

const plain = value => value.replace(/\s/gu, '');
const calibrated = item => item?.ocr && !item.ocrNative && item.preciseInk
  && item.sourceIds?.length === 1 && item.sourceIds[0] === item.id
  && typeof item.text === 'string' && item.text.length <= 8000 && item.ocrFontScore >= .7
  && validRect(item.rect)
  && Array.isArray(item.words) && item.words.length > 0 && item.words.length <= 200
  && item.words.every((word, index) => typeof word?.text === 'string' && validRect(word.rect)
    && word.rect.width > 0 && word.rect.height > 0 && word.preciseInk && Number.isFinite(word.baseline)
    && contains(item.rect, word.rect, .5) && (!index || word.rect.x >= item.words[index - 1].rect.x))
  && plain(item.words.map(word => word.text).join('')) === plain(item.text);

/** Overlapping detections can label the edge of an already-owned Han glyph as
 * another character. Remove only an inferior, narrow edge fragment contained
 * in one complete, strongly recognized glyph; never infer text from language.
 * Erasure still belongs to the original row, including the duplicated ink.
 */
export function trimOcrOwnedFragments(text) {
  if (!Array.isArray(text) || text.length > 20_000) return text;
  const rows = text.filter(calibrated), words = [];
  for (const item of rows) {
    for (const [index, word] of item.words.entries()) words.push({ ...word, item, index });
    if (words.length > 20_000) return text;
  }
  const lookup = spatialIndex(words), plans = []; let budget = 100_000;
  for (const item of rows) {
    if (item.words.length < 4 || item.ocrOriginalText || item.ocrCorrections?.length || item.ocrRuleTokens?.length) continue;
    const omissions = [];
    for (const index of [0, item.words.length - 1]) {
      const fragment = item.words[index];
      if (!/^\p{Script=Han}$/u.test(fragment.text) || !(fragment.ocrGlyphScore >= 0 && fragment.ocrGlyphScore < .5)
        || !(fragment.confidence >= .7 && fragment.confidence < .98)) continue;
      const owners = [];
      for (const owner of lookup(fragment.rect)) {
        if (--budget < 0) return text;
        if (owner.item === item || !/^\p{Script=Han}$/u.test(owner.text)
          || !(owner.confidence >= .98 && owner.ocrGlyphScore >= .7)
          || owner.ocrGlyphScore - fragment.ocrGlyphScore < .25
          || !contains(owner.rect, fragment.rect, .05)
          || fragment.rect.width > owner.rect.width * .4 || fragment.rect.height < owner.rect.height * .6
          || Math.abs(fragment.baseline - owner.baseline) > 1) continue;
        owners.push(owner);
      }
      if (owners.length === 1) omissions.push({ index, owner: owners[0] });
    }
    if (!omissions.length) continue;
    const start = omissions.some(o => o.index === 0) ? 1 : 0;
    const end = item.words.length - (omissions.some(o => o.index === item.words.length - 1) ? 1 : 0);
    const kept = item.words.slice(start, end);
    const from = start ? item.text.indexOf(item.words[0].text) + item.words[0].text.length : 0;
    const to = end < item.words.length ? item.text.lastIndexOf(item.words.at(-1).text) : item.text.length;
    const value = item.text.slice(from, to).trim();
    if (!value || plain(kept.map(word => word.text).join('')) !== plain(value)) continue;
    plans.push({ item, words: kept, text: value, omissions });
  }
  const changed = new Set(plans.map(plan => plan.item));
  for (const plan of plans) {
    // A fragment cannot be justified by another row that is itself being cut.
    if (plan.omissions.some(o => changed.has(o.owner.item))) continue;
    const { item, words, omissions } = plan, rect = union(words.map(word => word.rect));
    item.ocrOriginalText = item.text;
    item.ocrCorrections = omissions.map(({ index, owner }) => ({ word: index, original: item.words[index].text,
      text: '', rule: 'source-ink-fragment-overlap', ownerId: owner.item.id, ownerWord: owner.index,
      similarity: item.words[index].ocrGlyphScore, ownerSimilarity: owner.ocrGlyphScore }));
    Object.assign(item, { text: plan.text, words, rect, advanceRect: { ...rect }, advanceWidth: rect.width,
      baselineX: words[0].baselineX ?? rect.x });
    delete item.ocrRecognitionConfidence;
  }
  return text;
}
