// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { LineRuleType, HeightRule } from 'docx';
import { PdfParagraph as Paragraph } from './docx-paragraph.js';
import { bottom, union, median } from '../core/geometry.js';
import { wordError } from '../core/input.js';
import { MAX_POSITIONED_FRAMES } from '../core/positioned-budget.js';

const twip = value => Math.round(value * 20);

export function needsPositionedPage(page) {
  return !page.rasterPage && (page.height < 400 || page.backgroundTextLayers > 0 || page.risks.includes('math-image') || page.risks.includes('unmapped-glyph'));
}

/** Bounded line/style frames keep short fragments from becoming overflow pages.
 * Font transitions have independent origins to avoid renderer-specific spacing.
 */
export function positionedPage(page, assets, { textRuns, runOptions, image, table, empty, measurementContext, originX, measureLineBox, mathFor }) {
  const children = [empty(.1)], floating = [];
  let lines = 0;
  const appendImage = item => {
    const formula = mathFor?.(item);
    if (!formula) { floating.push(image(item, assets, true)); return; }
    if (++lines > MAX_POSITIONED_FRAMES) throw wordError('layout-quality');
    const layout = formula.sourceLayout;
    const measured = Number.isFinite(layout?.baseline);
    const requestedHeight = measured ? Math.max(layout.height, (layout.baseline - item.rect.y + 1) / .8,
      (item.rect.y + item.rect.height - layout.baseline + 1) / .2) : item.rect.height;
    // WPS clamps negative frame coordinates. Keep the exact line's baseline on
    // the page while allowing the containing frame to hold the complete formula.
    const height = measured ? Math.max(.5, Math.min(requestedHeight, Math.floor(layout.baseline / .8 * 20) / 20)) : requestedHeight;
    children.push(new Paragraph({ children: [formula], run: { font: layout?.font, color: layout?.color, size: Math.round((layout?.size ?? Math.max(...item.mathGlyphs.map(glyph => glyph.size))) * 2) },
      spacing: { before: 0, after: 0, line: twip(height), lineRule: measured ? LineRuleType.EXACT : LineRuleType.AT_LEAST },
      frame: { type: 'absolute', position: { x: twip(layout?.x ?? item.rect.x), y: twip(measured ? layout.baseline - Math.round(height * 20) / 20 * .8 : item.rect.y) },
        height: twip(measured ? Math.max(requestedHeight, item.rect.y + item.rect.height - (layout.baseline - height * .8) + 1) : requestedHeight),
        rule: HeightRule.ATLEAST, anchor: { horizontal: 'page', vertical: 'page' }, wrap: 'none', anchorLock: true, space: { horizontal: 0, vertical: 0 } },
      widowControl: false, autoSpaceEastAsianText: false }));
  };
  const frame = line => {
    if (++lines > MAX_POSITIONED_FRAMES) throw wordError('layout-quality');
    const x = Math.max(0, Math.min(...line.items.map(item => originX(item, measurementContext))));
    const size = Math.max(...line.items.map(item => item.type === 'image' ? 1 : item.size));
    const precise = measurementContext && line.items.every(item => item.preciseInk);
    const descent = Math.max(size * .2, ...line.items.filter(item => item.type === 'image').map(item => bottom(item.rect) - line.baseline));
    const ascent = Math.max(size, line.baseline - line.rect.y);
    const measured = precise ? measureLineBox(line, measurementContext) : null;
    const height = measured?.height ?? ascent + descent;
    const y = Math.max(0, line.baseline - (measured?.baselineOffset ?? ascent));
    const text = line.items.find(item => item.type !== 'image');
    children.push(new Paragraph({ children: textRuns(line, assets, measurementContext),
      run: text ? runOptions(text) : { size: 1, snapToGrid: false },
      spacing: { before: 0, after: 0, line: twip(height), lineRule: LineRuleType.EXACT },
      frame: { type: 'absolute', position: { x: twip(x), y: twip(y) },
        ...(precise ? {} : { width: twip(Math.max(.5, page.width - x)) }),
        height: twip(height + .5), rule: HeightRule.ATLEAST, anchor: { horizontal: 'page', vertical: 'page' },
        wrap: 'none', anchorLock: true, space: { horizontal: 0, vertical: 0 } },
      widowControl: false, autoSpaceEastAsianText: false }));
  };
  const appendLine = line => {
    if (!measurementContext || !line.items.every(item => item.preciseInk || item.type === 'image')) { frame(line); return; }
    let items = [], previousKey = '';
    const flush = () => {
      if (items.length) frame({ ...line, items, baseline: median(items.map(item => item.baseline)), rect: union(items.map(item => item.rect)) });
      items = [];
    };
    for (const item of line.items) {
      if (item.type === 'image') { flush(); appendImage(item); previousKey = ''; continue; }
      const key = JSON.stringify(runOptions(item));
      // Keep raised/lowered text in source order without making its position
      // depend on the other font runs that share the same logical line.
      if (key !== previousKey || items.length && Math.abs(item.baseline - items[0].baseline) > .5) flush();
      items.push(item); previousKey = key;
    }
    flush();
  };
  const append = blocks => {
    for (const block of blocks) {
      if (block.type === 'columns') { block.columns.forEach(column => append(column.blocks)); continue; }
      if (block.type === 'option-grid' || block.type === 'table' && block.aiInferred) { block.cells.forEach(cell => append(cell.blocks)); continue; }
      if (block.type === 'paragraph') { block.lines.forEach(appendLine);
      } else if (block.type === 'image') {
        appendImage(block);
      } else if (['table', 'option-grid'].includes(block.type)) {
        children.push(table(block, block.rect.x, assets, { measurementContext, positioned: true }).element, empty(.1));
      } else throw wordError('structure');
    }
  };
  append([...page.header, ...page.blocks, ...page.footer]);
  if (floating.length) children.push(new Paragraph({ children: floating, run: { size: 1, snapToGrid: false },
    spacing: { before: 0, after: 0, line: 1, lineRule: LineRuleType.EXACT }, widowControl: false }));
  // Section properties belong to an ordinary paragraph, never the last frame.
  // Otherwise Office can attach that frame to the following page's section.
  children.push(empty(.1));
  return { children, lines };
}
