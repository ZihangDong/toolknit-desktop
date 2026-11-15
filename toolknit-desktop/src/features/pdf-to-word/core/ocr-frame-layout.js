// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { MAX_POSITIONED_FRAMES, positionedFrameCost } from './positioned-budget.js';
import { union, median } from './geometry.js';
import { wordError } from './input.js';

export const isGeneratedOcrWord = word => /^TKInk[0-9a-f]{24}$/.test(word.font || '') && word.fontAssetId === 'font:' + word.font;
export const isCenteredNativeWord = item => item.nativeAdvanceCentered === true && item.nativeCalibrated === true
  && !item.ocr && !item.raster && !item.alphabet && item.font === 'SimHei' && item.bold === true
  && Number.isFinite(item.sourceSize) && item.sourceSize >= 20 && item.sourceSize <= 120
  && /^FZH4(?:FW|JW)--GB1-[0-9]+$/i.test(item.sourceFont || '');
const editedWord = item => item.positionedWord === true && item.preciseInk === true && !item.raster && !item.alphabet;
function distribute(counts, minimum, budget) {
  const capacities = counts.map((count, i) => Math.max(0, count - minimum[i]));
  const capacity = capacities.reduce((sum, n) => sum + n, 0);
  const extra = Math.min(capacity, Math.max(0, budget - minimum.reduce((sum, n) => sum + n, 0)));
  const shares = capacities.map(n => capacity ? n * extra / capacity : 0);
  const slots = minimum.map((n, i) => n + Math.floor(shares[i]));
  let remaining = extra - shares.reduce((sum, n) => sum + Math.floor(n), 0);
  for (const { index } of shares.map((n, index) => ({ index, fraction: n - Math.floor(n) })).sort((a, b) => b.fraction - a.fraction || a.index - b.index))
    if (remaining > 0 && slots[index] < counts[index]) { slots[index]++; remaining--; }
  return slots;
}
export function ocrFrameLayout(page, { generatedWord = isGeneratedOcrWord } = {}) {
  const blocks = [...page.header, ...page.blocks, ...page.footer], lines = [], literalLines = [];
  const walk = blocks => { for (const block of blocks) {
    if (block.type === 'columns') block.columns.forEach(column => walk(column.blocks));
    else if (block.type === 'option-grid' || block.type === 'table' && block.aiInferred) block.cells.forEach(cell => walk(cell.blocks));
    else for (const line of block.lines || []) {
      const text = line.items.filter(item => item.type !== 'image');
      const decorations = line.items.filter(item => item.type === 'image');
      if (!text.length || !text.every(item => (item.ocr || item.nativeCalibrated)
        && (item.words?.length || editedWord(item)))) continue;
      // This extra path is proven for the centered legacy display substitute.
      // Other mixed lines retain their existing layout and reader evidence.
      if (decorations.length && !text.every(item => item.nativeAdvanceCentered === true)) continue;
      if (decorations.length && !decorations.every(item => item.decoration === true && item.role === 'figure'
        && item.text === '' && item.sourceIds?.length === 0 && !item.mathGlyphs?.length)) continue;
      // These source-proven short labels previously occupied a native frame.
      // Spend the existing tail reserve so their character positions do not
      // redistribute the bounded OCR frames already assigned to body text.
      const literal = text.every(item => item.ocr && item.preciseInk
        && item.ocrLiteralPlacement?.version === 1 && (item.words?.length || editedWord(item)));
      if (literal && !decorations.length) { literalLines.push(line); continue; }
      lines.push(decorations.length ? { ...line, items: text, mixedNativeDecoration: true } : line);
    }
  } };
  walk(blocks);
  // Edited word leaves replace their old style frames. Charging those frames
  // again would exhaust the budget merely because a source run was expanded.
  const replaced = lines.reduce((sum, line) => sum + (line.items.some(editedWord)
    ? positionedFrameCost([{ lines: [line] }]) : 1), 0);
  const literalOriginalCost = literalLines.reduce((sum, line) => sum + positionedFrameCost([{ lines: [line] }]), 0);
  const native = Math.max(0, positionedFrameCost(blocks) - replaced - literalOriginalCost + literalLines.length);
  const budget = Math.max(1, MAX_POSITIONED_FRAMES - native - 16);
  const plans = lines.map(line => {
    const words = line.items.flatMap(item => item.words?.length ? item.words : [item]), cuts = new Set([0, words.length]);
    let generated = false;
    words.forEach((word, index) => { if (generatedWord(word)) { generated = true; cuts.add(index); cuts.add(index + 1); } });
    return { words, generated, cuts: [...cuts].sort((a, b) => a - b) };
  });
  const minimum = plans.map(p => Math.max(0, p.cuts.length - 1));
  if (minimum.reduce((sum, n) => sum + n, 0) > budget && plans.some(p => p.generated)) throw wordError('layout-quality');
  const slots = distribute(plans.map(p => p.words.length), minimum, budget), result = new Map();
  let literalCost = 0;
  for (const line of literalLines) {
    const glyphs = line.items.flatMap(item => item.words?.length
      ? item.words.map(word => ({ ...item, ...word, words: undefined })) : [{ ...item, words: undefined }]);
    literalCost += glyphs.length;
    if (literalCost > 16) throw wordError('layout-quality');
    result.set(line.id, glyphs.map((item, index) => ({ ...line, id: line.id + ':literal:' + index,
      items: [item], baseline: item.baseline, rect: item.rect })));
  }
  if (literalLines.length && native - literalLines.length + literalCost
    + slots.reduce((sum, count) => sum + count, 0) > MAX_POSITIONED_FRAMES) throw wordError('layout-quality');
  for (const [index, line] of lines.entries()) {
    const glyphs = line.items.flatMap(item => item.words?.length
      ? item.words.map(word => ({ ...item, ...word, words: undefined })) : [{ ...item, words: undefined }]);
    const cuts = plans[index].cuts, lengths = cuts.slice(1).map((end, j) => end - cuts[j]);
    const parts = distribute(lengths, lengths.map(() => 1), slots[index]), chunks = [];
    for (let region = 0; region < lengths.length; region++) for (let slot = 0; slot < parts[region]; slot++) {
      const start = cuts[region] + Math.floor(slot * lengths[region] / parts[region]);
      const end = cuts[region] + Math.floor((slot + 1) * lengths[region] / parts[region]);
      const items = glyphs.slice(start, end);
      chunks.push({ ...line, id: line.id + ':frame:' + start, items, baseline: median(items.map(item => item.baseline)), rect: union(items.map(item => item.rect)) });
    }
    result.set(line.id, chunks);
  }
  return result;
}
