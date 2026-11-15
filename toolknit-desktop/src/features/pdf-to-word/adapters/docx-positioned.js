// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { LineRuleType, HeightRule } from 'docx';
import { PdfParagraph as Paragraph } from './docx-paragraph.js';
import { bottom, union, median } from '../core/geometry.js';
import { wordError } from '../core/input.js';
import { MAX_POSITIONED_FRAMES } from '../core/positioned-budget.js';
import { ocrFrameLayout } from '../core/ocr-frame-layout.js';
import { compressedPunctuationChunks } from '../core/text-chunks.js';
import { positionedLineOrigin } from './text-layout.js';

const twip = value => Math.round(value * 20);

export function needsPositionedPage(page) {
  return !page.rasterPage && (page.height < 400 || page.backgroundTextLayers > 0 || page.risks.includes('math-image') || page.risks.includes('unmapped-glyph'));
}

/** Bounded line/style frames keep short fragments from becoming overflow pages.
 * Font transitions have independent origins to avoid renderer-specific spacing.
 */
export function positionedPage(page, assets, { textRuns, runOptions, image, table, empty, measurementContext, originX, measureLineBox, mathFor }) {
  const children = [empty(.1)], floating = [];
  const ocrFrames = ocrFrameLayout(page);
  let lines = 0;
  const appendImage = item => {
    const formula = mathFor?.(item);
    if (!formula) { floating.push(image(item, assets, true)); return; }
    if (++lines > MAX_POSITIONED_FRAMES) throw wordError('layout-quality');
    const layout = formula.sourceLayout;
    if(layout?.alignedFrame){
      const f=layout.alignedFrame;
      if(![f.x,f.y,f.height,f.lineHeight].every(Number.isFinite)||f.x<0||f.y<0||f.height<=0||f.lineHeight<=0
        ||f.x>=page.width||f.y+f.height>page.height+1)throw wordError('layout-quality');
      children.push(new Paragraph({children:[formula],run:{font:layout.font,color:layout.color,size:Math.round(layout.size*2)},
        spacing:{before:0,after:0,line:twip(f.lineHeight),lineRule:LineRuleType.EXACT},
        frame:{type:'absolute',position:{x:twip(f.x),y:twip(f.y)},height:twip(f.height),rule:HeightRule.ATLEAST,
          anchor:{horizontal:'page',vertical:'page'},wrap:'none',anchorLock:true,space:{horizontal:0,vertical:0}},
        widowControl:false,autoSpaceEastAsianText:false}));return;
    }
    if (layout?.strictGeometry && layout.measured && [layout.measured.height,layout.measured.depth].every(Number.isFinite)) {
      const height=Math.max(.5,layout.measured.height+layout.measured.depth),y=layout.baseline-layout.measured.height;
      if(y>=0){
        children.push(new Paragraph({children:[formula],run:{font:layout.font,color:layout.color,size:Math.round(layout.size*2)},
          spacing:{before:0,after:0,line:twip(height),lineRule:LineRuleType.EXACT},
          frame:{type:'absolute',position:{x:twip(layout.x),y:twip(y)},height:twip(height+.5),rule:HeightRule.ATLEAST,anchor:{horizontal:'page',vertical:'page'},wrap:'none',anchorLock:true,space:{horizontal:0,vertical:0}},
          widowControl:false,autoSpaceEastAsianText:false}));return;
      }
    }
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
    const precise = measurementContext && line.items.every(item => item.preciseInk);
    const x = Math.max(0, precise ? positionedLineOrigin(line,measurementContext)
      : Math.min(...line.items.map(item => originX(item, measurementContext))));
    const size = Math.max(...line.items.map(item => item.type === 'image' ? 1 : item.size));
    const descent = Math.max(size * .2, ...line.items.filter(item => item.type === 'image').map(item => bottom(item.rect) - line.baseline));
    const ascent = Math.max(size, line.baseline - line.rect.y);
    const measured = precise ? measureLineBox(line, measurementContext, false, null, true) : null;
    const height = measured?.height ?? ascent + descent;
    const y = Math.max(0, line.baseline - (measured?.baselineOffset ?? ascent));
    const text = line.items.find(item => item.type !== 'image');
    children.push(new Paragraph({ children: textRuns(line, assets, measurementContext),
      run: text ? { ...runOptions(text), bold: undefined, italics: undefined } : { size: 1, snapToGrid: false },
      spacing: { before: 0, after: 0, line: twip(height), lineRule: LineRuleType.EXACT },
      frame: { type: 'absolute', position: { x: twip(x), y: twip(y) },
        ...(precise ? {} : { width: twip(Math.max(.5, page.width - x)) }),
        height: twip(height + .5), rule: HeightRule.ATLEAST, anchor: { horizontal: 'page', vertical: 'page' },
        wrap: 'none', anchorLock: true, space: { horizontal: 0, vertical: 0 } },
      widowControl: false, autoSpaceEastAsianText: false }));
  };
  const appendLine = line => {
    // CTC glyph origins are physical positions. Independent frames avoid
    // accumulating Word's half-point spacing quantization across a scan line.
    if (ocrFrames.has(line.id)) {
      line.items.filter(item => item.type === 'image').forEach(appendImage);
      ocrFrames.get(line.id).forEach(frame);
      return;
    }
    if (!measurementContext || !line.items.every(item => item.preciseInk || item.type === 'image')) { frame(line); return; }
    let items = [], previousKey = '';
    const flush = () => {
      if (items.length) frame({ ...line, items, baseline: median(items.map(item => item.baseline)), rect: union(items.map(item => item.rect)) });
      items = [];
    };
    for (const item of line.items) {
      if (item.type === 'image') { flush(); appendImage(item); previousKey = ''; continue; }
      const key = JSON.stringify([item.sourceFont || item.font, runOptions(item)]);
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
      if (block.type === 'paragraph') { block.lines.flatMap(compressedPunctuationChunks).forEach(appendLine);
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
