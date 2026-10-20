// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { median } from './geometry.js';
import { lineSpacing } from './text.js';

const twips = value => Math.round(value * 20);

export function paragraphLineHeight(block) {
  const ink = Math.max(...block.lines.map(line => line.rect.height),
    ...block.lines.flatMap(line => line.items.map(item => item.size * 1.12)));
  return twips(Math.max(ink, lineSpacing(block.lines))) / 20;
}

// Reclaim a bounded amount of whitespace, never glyph height, from a text-only
// page. Large blank bands are anchors; moving text across them changes layout.
export function planParagraphPagination(blocks, { top, bottom, continuous = false }) {
  if (continuous || !blocks.length || blocks.some(block => block.type !== 'paragraph')) return null;
  const heights = blocks.map(paragraphLineHeight);
  const reserve = twips(Math.max(16, Math.min(36, median(heights) * 2 + 2)));
  const limit = twips(bottom), start = twips(top), gaps = [], capacities = [];
  let cursor = start;
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index], gap = Math.max(0, twips(block.rect.y) - cursor);
    gaps.push(gap);
    if (gap > twips(block.size * 3)) capacities.fill(0);
    capacities.push(index && gap <= twips(block.size * 3) ? Math.floor(Math.min(gap * 0.15, twips(block.size * 0.3))) : 0);
    cursor += gap + twips(heights[index]) * block.lines.length;
  }
  const slackBefore = limit - cursor;
  const capacity = capacities.reduce((sum, value) => sum + value, 0);
  const recover = Math.max(0, Math.min(reserve - slackBefore, capacity, 360, Math.floor((limit - start) * 0.03)));
  const reductions = capacities.map(value => capacity ? Math.floor(recover * value / capacity) : 0);
  let remaining = recover - reductions.reduce((sum, value) => sum + value, 0);
  for (let i = reductions.length - 1; i >= 0 && remaining; i--) {
    if (reductions[i] < capacities[i]) { reductions[i]++; remaining--; }
  }
  return {
    gaps: new Map(blocks.map((block, index) => [block.id, (gaps[index] - reductions[index]) / 20])),
    reserve: reserve / 20, slackBefore: slackBefore / 20,
    recovered: recover / 20, slackAfter: (slackBefore + recover) / 20,
    limited: slackBefore + recover < reserve,
  };
}
