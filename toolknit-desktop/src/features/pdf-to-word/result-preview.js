// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { leafBlocks } from './core/layout.js';
import { wordFont, outputWordFont } from './adapters/docx-fonts.js';

export function measureResultText(text, style, context) {
  let font = wordFont(style.font, style.fontFamily);
  if (font === 'Times New Roman' && /[\p{Script=Han}\u2460-\u24ff\u3000-\u303f\uff00-\uffef]/u.test(text)) font = 'SimSun';
  font = outputWordFont(font).replaceAll('"', '');
  context.font = (style.italic ? 'italic ' : '') + (style.bold || /FZDBS/i.test(style.font || '') ? 'bold ' : '') + style.size + 'px "' + font + '"';
  context.fontKerning = 'none';
  return context.measureText(text).width;
}

export function pageAssetIds(page) {
  return [...new Set(leafBlocks([...page.header, ...page.blocks, ...page.footer]).flatMap(block =>
    block.type === 'image' ? [block.assetId || block.id] : (block.lines || []).flatMap(line => line.items.filter(item => item.type === 'image').map(item => item.assetId || item.id))))];
}

/** Rebuild from export data, so erased text is never painted over a source screenshot. */
export async function renderResultPage(page, canvas, assets, check = () => {}) {
  const context = canvas.getContext('2d'), scale = canvas.width / page.width;
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
    for (const block of leaves) for (const line of block.lines || []) for (const item of line.items) {
      if (item.type === 'image') continue;
      measureResultText(item.text, item, context);
      context.fillStyle = '#' + (/^[a-f0-9]{6}$/i.test(item.color) ? item.color : '000000');
      context.textBaseline = 'alphabetic';
      context.fillText(item.text, item.baselineX ?? item.rect.x, item.baseline ?? line.baseline);
    }
  } finally { decoded.forEach(({ bitmap }) => bitmap.close()); }
}
