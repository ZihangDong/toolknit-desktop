// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { leafBlocks } from './core/layout.js';
import { textMetrics } from './adapters/text-layout.js';
import { drawResultText } from './adapters/text-rendering.js';
import { nativePairMeasure } from './core/native-pair-policy.js';

export function measureResultText(text, style, context) {
  const paired = nativePairMeasure(text, style, context);
  return paired === null ? textMetrics({ ...style, text }, context).width : paired;
}
measureResultText.metrics = (text, style, context) => {
  const value = textMetrics({ ...style, text }, context);
  return { ...value, descent: Math.max(0, value.inkDescent) };
};

export function pageAssetIds(page) {
  const leaves = leafBlocks([...page.header, ...page.blocks, ...page.footer]);
  const fonts = leaves.flatMap(block => (block.lines || []).flatMap(line => line.items.flatMap(item =>
    [item, ...(item.words || [])].map(value => value.fontAssetId).filter(Boolean))));
  const images = leaves.flatMap(block => block.type === 'image' ? [block.assetId || block.id]
    : (block.lines || []).flatMap(line => line.items.filter(item => item.type === 'image').map(item => item.assetId || item.id)));
  return [...new Set([...fonts, ...images])];
}

/** Rebuild from export data, so erased text is never painted over a source screenshot. */
export async function renderResultPage(page, canvas, assets, check = () => {}, fontScope = null) {
  const context = fontScope?.context(canvas.getContext('2d')) || canvas.getContext('2d'), scale = canvas.width / page.width;
  const leaves = leafBlocks([...page.header, ...page.blocks, ...page.footer]);
  const imageItems = leaves.flatMap(block => block.type === 'image' ? [block] : (block.lines || []).flatMap(line => line.items.filter(item => item.type === 'image')));
  const decoded = [];
  try {
    for (const item of imageItems) {
      check();
      const asset = assets.get(item.assetId || item.id); if (!asset) throw new Error('pdf-to-word:image');
      const bitmap = await createImageBitmap(new Blob([asset.bytes], { type: asset.format === 'jpg' ? 'image/jpeg' : 'image/png' }));
      decoded.push({ item, bitmap }); check();
    }
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.fillStyle = '#fff'; context.fillRect(0, 0, page.width, page.height);
    const tables = (blocks, borders = false) => {
      for (const block of blocks) {
        if (block.type === 'columns') block.columns.forEach(column => tables(column.blocks, borders));
        else if (['table', 'option-grid'].includes(block.type)) for (const cell of block.cells) {
          if (!borders && cell.shading) { context.fillStyle = '#' + cell.shading; context.fillRect(cell.rect.x, cell.rect.y, cell.rect.width, cell.rect.height); }
          if (borders && !block.borderless && block.type === 'table') { context.strokeStyle = '#333'; context.lineWidth = .5; context.strokeRect(cell.rect.x, cell.rect.y, cell.rect.width, cell.rect.height); }
          tables(cell.blocks, borders);
        }
      }
    };
    tables([...page.header, ...page.blocks, ...page.footer]);
    for (const { item, bitmap } of decoded) context.drawImage(bitmap, item.rect.x, item.rect.y, item.rect.width, item.rect.height);
    tables([...page.header, ...page.blocks, ...page.footer], true);
    drawResultText(page, context);
  } finally { decoded.forEach(({ bitmap }) => bitmap.close()); }
}
