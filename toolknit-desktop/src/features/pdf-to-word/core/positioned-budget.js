// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { sourceAlignedEquationRegion } from './source-aligned-equations.js';
import { sourceUpperAttachmentRegion } from './source-upper-attachment.js';
import {sourceIndexedSumRegion} from './source-indexed-sum.js';
import {sourceScalarRelationRegion} from './source-scalar-relation.js';
import { nativeUnicodeScalarRegion } from './native-unicode-scalars.js';
import { sourceFirstLevelIndexRegion } from './source-first-level-index.js';
// A bounded count shared by the page planner and the positioned writer.
import { compressedPunctuationChunks } from './text-chunks.js';
export const MAX_POSITIONED_FRAMES = 512;

export function positionedFrameCost(blocks) {
  let count = 0;
  for (const block of blocks) {
    if (block.type === 'image' && (nativeUnicodeScalarRegion(block) || sourceFirstLevelIndexRegion(block) || sourceScalarRelationRegion(block) || sourceIndexedSumRegion(block) || sourceUpperAttachmentRegion(block) || sourceAlignedEquationRegion(block))) count++;
    if (block.type === 'columns') count += block.columns.reduce((sum, column) => sum + positionedFrameCost(column.blocks), 0);
    if (block.type === 'option-grid') count += block.cells.reduce((sum, cell) => sum + positionedFrameCost(cell.blocks), 0);
    for (const line of (block.lines || []).flatMap(compressedPunctuationChunks)) {
      if (!line.items.every(item => item.preciseInk || item.type === 'image')) { count++; continue; }
      let previous = '', baseline;
      for (const item of line.items) {
        if (item.type === 'image' && (nativeUnicodeScalarRegion(item) || sourceFirstLevelIndexRegion(item) || sourceScalarRelationRegion(item) || sourceIndexedSumRegion(item) || sourceUpperAttachmentRegion(item) || sourceAlignedEquationRegion(item))) count++;
        const key = item.type === 'image' ? '' : JSON.stringify([item.sourceFont || item.font, item.font, item.size, item.bold, item.italic, item.color]);
        if (key && (key !== previous || Math.abs(item.baseline - baseline) > .5)) { count++; baseline = item.baseline; }
        if (!key) baseline = undefined;
        previous = key;
      }
    }
  }
  return count;
}
