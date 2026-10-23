// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
// A bounded count shared by the page planner and the positioned writer.
export const MAX_POSITIONED_FRAMES = 512;

export function positionedFrameCost(blocks) {
  let count = 0;
  for (const block of blocks) {
    if (block.type === 'columns') count += block.columns.reduce((sum, column) => sum + positionedFrameCost(column.blocks), 0);
    if (block.type === 'option-grid') count += block.cells.reduce((sum, cell) => sum + positionedFrameCost(cell.blocks), 0);
    for (const line of block.lines || []) {
      if (!line.items.every(item => item.preciseInk || item.type === 'image')) { count++; continue; }
      let previous = '', baseline;
      for (const item of line.items) {
        const key = item.type === 'image' ? '' : JSON.stringify([item.font, item.size, item.bold, item.italic, item.color]);
        if (key && (key !== previous || Math.abs(item.baseline - baseline) > .5)) { count++; baseline = item.baseline; }
        if (!key) baseline = undefined;
        previous = key;
      }
    }
  }
  return count;
}
