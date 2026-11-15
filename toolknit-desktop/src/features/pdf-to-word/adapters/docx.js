// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { nativePairRuns } from '../core/native-pair-spacing.js';
import { nativePairPolicyRuns, nativePairEditStyle } from '../core/native-pair-policy.js';
import { Document, Packer, TextRun, ImageRun, Header, Footer, Table, TableRow, TableCell,
  WidthType, TableLayoutType, BorderStyle, HeightRule, LineRuleType, SectionType, ColumnBreak, DocumentGridType,
  HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType, BuilderElement } from 'docx';
import { right, bottom, median, union } from '../core/geometry.js';
import { paragraphLineHeight, planParagraphPagination } from '../core/pagination.js';
import { validateCoverage, leafBlocks } from '../core/layout.js';
import { LIMITS, wordError } from '../core/input.js';
import { assertLayoutQuality } from '../core/quality.js';
import { needsPositionedPage, positionedPage } from './docx-positioned.js';
import { PdfParagraph as Paragraph } from './docx-paragraph.js';
import { continuousSection } from './docx-continuous.js';
import { inferMathAst } from '../core/math.js';
import { nativeMathReaderMode } from '../core/native-math-policy.js';
import { planNativeMathRuns } from '../core/math-limit-runs.js';
import { wordFont } from './docx-fonts.js';
import { sourceFontOptions } from './source-font-runtime.js';
import { createOcrFontContext } from './ocr-font-context.js';
import { runOptions, textMetrics, originX, baselinePosition, measureLineBox, positionedTextRuns,
  positionedTextItems, positionedLineOrigin } from './text-layout.js';
export { wordFont } from './docx-fonts.js';

const twip = value => Math.round(value * 20);
const emu = value => Math.round(value * 12700);
const DEFAULT_DOCUMENT_SIZE = 22;
const pageSize = page => page.width > page.height
  ? { width: twip(page.height), height: twip(page.width), orientation: 'landscape' }
  : { width: twip(page.width), height: twip(page.height), orientation: 'portrait' };
const noBorders = Object.fromEntries(['top', 'bottom', 'left', 'right', 'insideHorizontal', 'insideVertical'].map(key => [key, { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }]));
const anchorRun = { size: 1, snapToGrid: false };
const empty = (height = 0.5) => new Paragraph({ children: [new TextRun({ text: '', ...anchorRun })], run: anchorRun,
  spacing: { before: 0, after: 0, line: twip(height), lineRule: LineRuleType.EXACT }, widowControl: false });

function positionedRuns(line, assets, context) {
  return positionedTextRuns(line, context).map(run => run.kind === 'space'
    ? new TextRun({ text: ' ', font: 'Arial', size: 2, characterSpacing: run.spacing, snapToGrid: false })
    : run.kind === 'image' ? image(run.item, assets, false, line.baseline)
      : new TextRun({ ...run.options, text: run.item.text, characterSpacing: run.spacing, position: run.position }));
}

function textRuns(line, assets, context) {
  if (context && line.items.every(item => item.preciseInk || item.type === 'image')) return positionedRuns(line, assets, context);
  const runs = [];
  let previous = null, lastKey = '', current = null;
  for (const item of line.items) {
    if (item.type === 'image') {
      runs.push(image(item, assets, false, line.baseline));
      previous = item; current = null; lastKey = ''; continue;
    }
    const options = runOptions(item), key = JSON.stringify(options);
    let text = item.text;
    if (previous && item.rect.x - right(previous.rect) > Math.min(item.size, previous.size) * 0.22
      && !/\s$/.test(previous.text) && !/^\s/.test(text)) text = ' ' + text;
    if (current && key === lastKey) current.text += text;
    else { current = { ...options, text }; runs.push(current); lastKey = key; }
    previous = item;
  }
  return runs.map(run => run instanceof ImageRun ? run : new TextRun(run));
}

function measuredLineWidth(line, context) {
  if (line.items.every(item => item.preciseInk || item.type === 'image')) {
    const items = context ? positionedTextItems(line) : line.items, last = items.at(-1);
    return originX(last, context) + (last.type === 'image' ? last.rect.width : context ? textMetrics(last, context).width : last.advanceWidth)
      - (context ? positionedLineOrigin(line,context) : originX(items[0], context));
  }
  if (!context) return line.rect.width;
  let width = 0, previous = null;
  for (const item of line.items) {
    if (item.type === 'image') { width += item.rect.width; previous = item; continue; }
    const options = runOptions(item);
    context.font = `${options.italics ? 'italic ' : ''}${options.bold ? 'bold ' : ''}${options.size / 2 * 96 / 72}px "${wordFont(options.font.ascii).replaceAll('"', '')}"`;
    width += context.measureText(item.text).width * 72 / 96 + options.characterSpacing / 20 * [...item.text].length;
    if (previous && item.rect.x - right(previous.rect) > Math.min(item.size, previous.size) * 0.22 && !/\s$/.test(previous.text) && !/^\s/.test(item.text)) width += context.measureText(' ').width * 72 / 96;
    previous = item;
  }
  return width;
}

function paragraph(block, origin, { before = 0, lineBreaks = true, breakColumn = false, assets, measurementContext, lineHeight, rightAllowance = 0 } = {}) {
  const lines = block.lines;
  const line = lineHeight ?? paragraphLineHeight(block);
  const children = [];
  if (breakColumn) children.push(new ColumnBreak());
  lines.forEach((part, index) => {
    if (index && lineBreaks) children.push(new TextRun({ ...runOptions(part.items[0]), break: 1 }));
    else if (index && !/[\p{Script=Han}]$/u.test(lines[index - 1].text) && !/^[\p{Script=Han}]/u.test(part.text)) children.push(new TextRun(' '));
    children.push(...textRuns(part, assets, measurementContext));
  });
  const lineOrigin = part => measurementContext && part.items.every(item => item.preciseInk || item.type === 'image')
    ? positionedLineOrigin(part,measurementContext) : part.rect.x;
  const left = lines.length > 1 ? median(lines.slice(1).map(lineOrigin)) : lineOrigin(lines[0]);
  const firstDelta = lineOrigin(lines[0]) - left;
  const indent = block.align === 'center' ? (() => {
    const delta = block.rect.x + block.rect.width / 2 - (origin + block.column.width / 2);
    return delta > 0 ? { left: twip(delta * 2) } : { right: twip(-delta * 2) };
  })() : { left: Math.max(0, twip(left - origin)), ...(firstDelta > 0.5 ? { firstLine: twip(firstDelta) } : firstDelta < -0.5 ? { hanging: twip(-firstDelta) } : {}) };
  if (rightAllowance > 0 && block.align !== 'center') indent.right = -Math.ceil(rightAllowance * 20);
  return { element: new Paragraph({ children, alignment: block.align || 'left', indent, run: { ...runOptions(lines[0].items[0]), bold: undefined, italics: undefined },
    spacing: { before: Math.max(0, twip(before)), after: 0, line: twip(line), lineRule: lineBreaks ? LineRuleType.EXACT : LineRuleType.AT_LEAST },
    keepNext: block.role === 'heading' || undefined, keepLines: block.role === 'heading' || undefined, widowControl: false,
    // contextualSpacing defaults to off in our styles. Omitting it prevents
    // previews from treating its mere presence as suppression of paragraph gaps.
    autoSpaceEastAsianText: false }), height: line * (lineBreaks ? lines.length : Math.max(1, lines.length)) };
}

/** Table readers can wrap on a final full-width advance even when all visible
 * ink fits. Reserve only that proven blank overhang; do not resize the cell or
 * glyphs, relax vertical fit, or allow actual ink outside its source cell.
 */
function tableLineAllowance(line, cellRight, context) {
  if (!context || !Number.isFinite(cellRight) || !line.items.length
    || !line.items.every(item => item.type !== 'image' && item.preciseInk && !item.raster
      && right(item.rect) <= cellRight + .25)) return 0;
  const last = line.items.at(-1), plan = positionedTextRuns(line, context), tail = plan.at(-1);
  const serializedEnd = tail?.kind === 'text' ? tail.x + tail.metrics.width
    + tail.spacing / 20 * Math.max(1, [...tail.item.text].length) : -Infinity;
  // The emitted final run may retain source character spacing after its last
  // visible glyph. Natural font width alone misses that blank advance, causing
  // Office to wrap a whole word even though every visible glyph fits the cell.
  const end = Math.max(positionedLineOrigin(line,context) + measuredLineWidth(line, context), serializedEnd);
  const overhang = end - cellRight;
  if (!(overhang > 0 && overhang <= last.size * .5)) return 0;
  // One point covers reader rounding/line-break lookahead without changing any
  // run origin. An overlong source line still fails the existing fit preflight.
  return overhang + 1;
}

function image(item, assets, floating = false, baseline) {
  const asset = assets.get(item.assetId || item.id);
  if (!asset?.bytes?.length) throw wordError('image');
  const format = asset.format ?? 'png';
  if (!['png', 'jpg'].includes(format)) throw wordError('image');
  const excluded = item.backgroundPaintIndexes?.length ? item.backgroundPaintIndexes : item.decorationTextPaintIndexes;
  if (item.decorationTextPaintIndexes?.length && (!item.decoration || !item.thin || item.sourceIds.length || item.backgroundPaintIndexes?.length)) throw wordError('image');
  if (excluded?.length && (!Array.isArray(asset.excludedPaintIndexes)
    || excluded.length !== asset.excludedPaintIndexes.length
    || excluded.some((index, position) => index !== asset.excludedPaintIndexes[position]))) throw wordError('image');
  const rect = item.rect;
  return new ImageRun({ type: format, data: asset.bytes, transformation: { width: rect.width * 96 / 72, height: rect.height * 96 / 72 },
    ...(Number.isFinite(baseline) ? { run: { position: Math.round((baseline - bottom(rect)) * 2), snapToGrid: false } } : {}),
    ...(floating ? { floating: { horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: emu(rect.x) },
      verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: emu(rect.y) },
      allowOverlap: true, lockAnchor: true, behindDocument: Boolean(item.backgroundPaintIndexes?.length || item.ocrBackground || item.formTableBackdrop), wrap: { type: TextWrappingType.NONE }, layoutInCell: false } } : {}) });
}

function table(block, originX, assets, settings) {
  if(block.nativeOpenGrid&&block.cells.some(cell=>cell.blocks.some(b=>b.lines?.some(line=>line.items.some(item=>(item.words?.length?item.words:[item]).some(word=>{
    if(!/^(?:[A-Z]{6}\+)?NimbusRomNo9L-Regu$/i.test((word.nativePairPolicy?.evidence||word.nativePairSpacing)?.sourceFont||''))return false;
    const value={...item,...word};return !(nativePairPolicyRuns(value,settings.measurementContext,runOptions(value))
      ||nativePairEditStyle(value)&&nativePairRuns(value,settings.measurementContext,runOptions(value)));
  }))))))throw wordError('layout-quality');

  if(block.nativeOpenGrid&&block.cells.some(cell=>cell.blocks.some(b=>b.lines?.some(line=>line.items.some(item=>/^(?:[A-Z]{6}\+)?(?:CMMI(?:9|10)|CMR(?:9|10)|CMBX10|CMSY10)$/.test(item.font||''))))))throw wordError('layout-quality');
  const widths = block.columnWidths.map(value => Math.max(1, twip(value))), rows = [];
  const exactGrid = settings.positioned && block.type === 'table' && block.rowHeights?.length === block.rows;
  const borderWidth = block.borderless ? 0 : .5, inset = exactGrid ? borderWidth / 2 : 0;
  const rowTops = Array.from({ length: block.rows }, (_, row) => Math.min(...block.cells.filter(cell => cell.row === row).map(cell => cell.rect.y)));
  const rowHeight = median(rowTops.slice(1).map((top, i) => top - rowTops[i]).filter(Number.isFinite)) || Math.max(12, block.rect.height / block.rows);
  const rowHeights = Array.from({ length: block.rows }, (_, row) => Number.isFinite(block.rowHeights?.[row]) && block.rowHeights[row] > 0 ? block.rowHeights[row] : rowHeight);
  for (let row = 0; row < block.rows; row++) {
    const cells = [];
    for (let col = 0; col < widths.length;) {
      const cell = block.cells.find(cell => cell.row === row && cell.col === col);
      const covered = block.cells.some(cell => cell.row < row && cell.row + cell.rowSpan > row && cell.col <= col && cell.col + cell.colSpan > col);
      if (covered) { col++; continue; }
      if (!cell) {
        cells.push(new TableCell({ width: { size: widths[col], type: WidthType.DXA }, children: [empty()], margins: { top: 0, bottom: 0, left: 0, right: 0 } })); col++; continue;
      }
      const width = widths.slice(col, col + cell.colSpan).reduce((sum, n) => sum + n, 0);
      const cellFlow = flow(cell.blocks, cell.rect.x + inset, cell.rect.y + inset, assets,
        { ...settings, inTable: true, cellRight: right(cell.rect) - inset, cellBottom: bottom(cell.rect),
        compactTable: Boolean(block.nativeRules?.length), nativeRowBaseline: Boolean(block.nativeRowBaseline),
        nativeMappingBaseline: block.nativeMappingBaseline === true,
        requireBaselineFit: Boolean(block.borderless) });
      if (exactGrid && cellFlow.cursor > bottom(cell.rect) + .25) throw wordError('layout-quality');
      const content = cellFlow.children;
      cells.push(new TableCell({ width: { size: width, type: WidthType.DXA }, columnSpan: cell.colSpan, rowSpan: cell.rowSpan,
        ...(cell.shading ? { shading: { fill: cell.shading } } : {}),
        children: content.length ? content : block.emptyForm ? [new Paragraph({ children: [],
          run: { font: 'Arial', size: 22 }, spacing: { before: 0, after: 0 }, widowControl: false })] : [empty()],
        margins: { top: 0, bottom: 0, left: 0, right: 0 }, verticalAlign: 'top' }));
      col += cell.colSpan;
    }
    rows.push(new TableRow({ children: cells, cantSplit: rowHeights[row] < 150,
      height: { value: twip(rowHeights[row]), rule: exactGrid ? HeightRule.EXACT : HeightRule.ATLEAST } }));
  }
  return { element: new Table({ rows, width: { size: widths.reduce((sum, n) => sum + n, 0), type: WidthType.DXA }, columnWidths: widths,
    ...(settings.positioned ? { float: { horizontalAnchor: 'page', verticalAnchor: 'page',
      absoluteHorizontalPosition: twip(block.rect.x), absoluteVerticalPosition: twip(block.rect.y - inset),
      overlap: 'overlap', topFromText: 0, bottomFromText: 0, leftFromText: 0, rightFromText: 0 } } : {}),
    indent: { size: Math.max(0, twip(block.rect.x - originX)), type: WidthType.DXA }, layout: TableLayoutType.FIXED,
    margins: { top: 0, bottom: 0, left: 0, right: 0 }, borders: block.type === 'option-grid' || block.borderless ? noBorders
      : Object.fromEntries(['top', 'bottom', 'left', 'right', 'insideHorizontal', 'insideVertical'].map(key => [key, { style: BorderStyle.SINGLE, size: borderWidth * 8, color: '000000' }])) }),
    height: Math.max(block.rect.height, rowHeights.reduce((sum, value) => sum + value, 0)) };
}

export function tablesRequiringFallback(scene, measurementContext) {
  const rejected = [];
  for (const block of scene.items.filter(item => item.type === 'table')) {
    try { table(block, block.rect.x, new Map(), { measurementContext, positioned: true }); }
    catch (error) { if (error?.code !== 'layout-quality') throw error; rejected.push(block.id); }
  }
  return rejected;
}

function flow(blocks, originX, startY, assets, settings = {}) {
  const children = [];
  let cursor = startY, breakColumn = Boolean(settings.breakColumn);
  for (const block of blocks) {
    let gap = settings.continuous ? (children.length ? 3 : 0) : settings.gaps?.get(block.id) ?? Math.max(0, block.rect.y - cursor);
    if (block.type === 'paragraph') {
      if (settings.inTable && settings.positioned && settings.measurementContext
        && block.lines.every(line => line.items.every(item => item.preciseInk))) {
        for (const line of block.lines) {
          const next = block.lines[block.lines.indexOf(line) + 1];
          const measuredLine = settings.nativeMappingBaseline ? { ...line, nativeMappingRow: true } : line;
          const box = measureLineBox(measuredLine, settings.measurementContext, false, settings.compactTable
            ? { top: cursor, bottom: Math.min(settings.cellBottom, next?.rect.y ?? settings.cellBottom) } : null,
            Boolean(settings.nativeMappingBaseline), settings.nativeRowBaseline);
          const beforeLine = line.baseline - box.baselineOffset - cursor;
          if (settings.requireBaselineFit && beforeLine < -.25) throw wordError('layout-quality');
          const before = Math.max(0, beforeLine);
          const result = paragraph({ ...block, lines: [line], align: 'left' }, originX,
            { before, assets, measurementContext: settings.measurementContext, lineHeight: box.height,
              rightAllowance: tableLineAllowance(line, settings.cellRight, settings.measurementContext) });
          children.push(result.element); cursor += before + result.height;
        }
        breakColumn = false; continue;
      }
      let lineHeight;
      if (settings.continuous && settings.measurementContext) {
        lineHeight = Math.max(...block.lines.map(line => measureLineBox(line, settings.measurementContext, true).height));
      }
      if (settings.inTable && settings.positioned && settings.measurementContext && block.lines.length === 1) {
        const box = measureLineBox(block.lines[0], settings.measurementContext, true);
        const beforeLine = block.lines[0].baseline - box.baselineOffset - cursor;
        if (settings.requireBaselineFit && beforeLine < -.25) throw wordError('layout-quality');
        gap = Math.max(0, beforeLine); lineHeight = box.height;
      }
      const result = paragraph(block, originX, { before: gap, lineBreaks: !settings.continuous, breakColumn, assets, measurementContext: settings.measurementContext, lineHeight });
      children.push(result.element); cursor += gap + result.height; breakColumn = false;
    } else {
      if (breakColumn) { children.push(new Paragraph({ children: [new ColumnBreak()], spacing: { line: 1, lineRule: LineRuleType.EXACT, after: 0 } })); breakColumn = false; }
      if (gap > 0.2) children.push(empty(gap));
      if (block.type === 'image') {
        children.push(new Paragraph({ children: [image(block, assets)], run: anchorRun, indent: { left: Math.max(0, twip(block.rect.x - originX)) },
          spacing: { before: 0, after: 0, line: twip(block.rect.height + 0.5), lineRule: LineRuleType.AT_LEAST } }));
        cursor += gap + block.rect.height + 0.5;
      } else if (block.type === 'table' || block.type === 'option-grid') {
        const result = table(block, originX, assets, settings); children.push(result.element, empty()); cursor += gap + result.height + 0.5;
      } else throw wordError('structure');
    }
  }
  return { children, cursor };
}

function headerFooter(blocks, page, assets, footer = false) {
  const images = blocks.filter(block => block.type === 'image');
  const paragraphs = blocks.filter(block => block.type === 'paragraph');
  const origin = blocks.length ? Math.min(...blocks.map(block => block.rect.y)) : 0;
  const children = [];
  if (images.length) children.push(new Paragraph({ children: images.map(item => image(item, assets, true)), run: anchorRun,
    spacing: { before: 0, line: 1, lineRule: LineRuleType.EXACT, after: 0 }, widowControl: false }));
  let cursor = origin + (images.length ? 0.05 : 0);
  for (const block of paragraphs) {
    const prepared = paragraph(block, page.content.x, { before: Math.max(0, block.rect.y - cursor), assets });
    children.push(prepared.element); cursor = block.rect.y + prepared.height;
  }
  return { content: footer ? new Footer({ children: children.length ? children : [empty()] }) : new Header({ children: children.length ? children : [empty()] }), origin };
}

export async function createWordBytes(document, assetList, { continuous = false, preserveGeometry = false, editableMath = false, strictMathGeometry = false, check = () => {}, measurementContext = null } = {}) {
  check();
  const quality = validateCoverage(document), assets = new Map(assetList.map(asset => [asset.id, asset]));
  quality.layout = assertLayoutQuality(document);
  if (assetList.reduce((sum, asset) => sum + asset.bytes.length, 0) > LIMITS.assetBytes) throw wordError('asset-large');
  const generatedFonts = createOcrFontContext();
  try {
  const fonts = await sourceFontOptions(document, assetList, { onFont: (asset, info) => generatedFonts.add(asset, info.generatedProgram) }); check();
  const sections = [];
  quality.pagination = [];
  quality.nativeFormulas = 0;
  const nativeSourceIds = new Set();
  // The experimental writer supports more structures than the reader policy.
  // Unverified structures retain their visible image in the desktop path.
  const mathWriter = editableMath ? (await import('./docx-math.js')).nativeMath : null;
  const mathFor = item => {
    if (!mathWriter) return null;
    const limitPlan = planNativeMathRuns(item);
    item = limitPlan?.region || item;
    const ast = limitPlan?.ast || inferMathAst(item);
    if (!ast) return null;
    const readerMode = strictMathGeometry ? nativeMathReaderMode(ast, item) : null;
    if (strictMathGeometry && !readerMode) {
      (quality.nativeMathFallbacks ||= []).push({ id: item.id, reason: 'reader-geometry' }); return null;
    }
    let result;
    try { result = mathWriter(ast, item, { measurementContext, defaultSize: DEFAULT_DOCUMENT_SIZE / 2 }); }
    catch (error) {
      if (!['native-math-layout','structure'].includes(error?.code)) throw error;
      (quality.nativeMathFallbacks ||= []).push({ id: item.id, reason: error.message });
      return null;
    }
    if (readerMode === 'flat' && measurementContext && result.sourceLayout) {
      // Calibrated OCR glyphs use Office's fixed-line baseline placement. The
      // compact native frame's ascent estimate is not the scan font's actual
      // baseline; the existing source-baseline frame below preserves it.
      result.sourceLayout.strictGeometry = !item.ocrMath;
      const box = result.sourceLayout.measured;
      const expected = item.rect.x + item.rect.width - result.sourceLayout.x;
      if (!Number.isFinite(box?.width) || Math.abs(box.width - expected) > Math.max(1, item.size * .08)) {
        (quality.nativeMathFallbacks ||= []).push({ id: item.id, reason: 'measured-width' });
        return null;
      }
    }
    item.sourceIds.forEach(id => nativeSourceIds.add(id)); quality.nativeFormulas++;
    return result;
  };
  measurementContext ||= typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1).getContext('2d') : null;
  measurementContext = generatedFonts.context(measurementContext);
  if (continuous) {
    const planned = continuousSection(document, assets, { flow, empty, measurementContext, check, positionedPage,
      textRuns, runOptions, image, table, originX, measureLineBox, mathFor });
    sections.push(...planned.sections); quality.layoutMode = 'continuous-a4'; quality.sourceMap = planned.sources; quality.flowStrategy = planned.strategy;
  }
  for (const page of continuous ? [] : document.pages) {
    check();
    if (page.width > 1584 || page.height > 1584) throw wordError('page-size');
    if (!continuous && (preserveGeometry || needsPositionedPage(page))) {
      const positioned = positionedPage(page, assets, { textRuns, runOptions, image, table, empty, measurementContext, originX, measureLineBox, mathFor });
      sections.push({ properties: { type: SectionType.NEXT_PAGE, grid: { type: DocumentGridType.DEFAULT, linePitch: 0, charSpace: 0 },
        page: { size: pageSize(page), margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 } } },
        headers: { default: new Header({ children: [empty(.05)] }) }, footers: { default: new Footer({ children: [empty(.05)] }) },
        children: positioned.children });
      quality.pagination.push({ page: page.number, strategy: 'positioned-lines', lines: positioned.lines });
      continue;
    }
    const header = headerFooter(page.header, page, assets), footer = headerFooter(page.footer, page, assets, true);
    const top = page.blocks.length ? Math.max(page.content.y, 1) : 36;
    const minimumMargin = page.height < 400 ? .5 : 20;
    const bottomMargin = page.footer.length ? Math.max(minimumMargin, page.height - footer.origin + 6) : Math.max(minimumMargin, Math.min(36, page.height - bottom(page.content) - 2));
    let rightAllowance = 1;
    for (const block of leafBlocks(page.blocks)) for (const line of block.lines || []) {
      rightAllowance = Math.max(rightAllowance, line.rect.x + measuredLineWidth(line, measurementContext) - right(page.content) + 0.5);
    }
    rightAllowance = Math.min(8, rightAllowance);
    const pagination = planParagraphPagination(page.blocks, { top, bottom: page.height - bottomMargin, continuous });
    if (pagination) {
      const { gaps, ...metrics } = pagination;
      quality.pagination.push({ page: page.number, ...metrics });
    }
    const properties = { type: SectionType.NEXT_PAGE, grid: { type: DocumentGridType.DEFAULT, linePitch: 0, charSpace: 0 },
      page: { size: pageSize(page),
      margin: { top: twip(top), bottom: twip(bottomMargin), left: twip(page.content.x), right: twip(Math.max(0, page.width - right(page.content) - rightAllowance)),
        header: twip(page.header.length ? header.origin : 0), footer: page.footer.length ? twip(Math.max(0, page.height - footer.origin - union(page.footer.map(block => block.rect)).height)) : 0 } } };
    let pending = [], first = true, cursor = top;
    const append = (children, column) => {
      sections.push({ properties: { ...properties, type: first ? SectionType.NEXT_PAGE : SectionType.CONTINUOUS, ...(column ? { column } : {}) },
        headers: { default: header.content }, footers: { default: footer.content }, children: children.length ? children : [empty()] }); first = false;
    };
    const flush = () => { if (!pending.length) return; const result = flow(pending, page.content.x, cursor, assets, { continuous, gaps: pagination?.gaps, measurementContext }); append(result.children); cursor = result.cursor; pending = []; };
    for (const block of page.blocks) {
      if (block.type !== 'columns') { pending.push(block); continue; }
      flush();
      const children = [];
      const start = cursor;
      block.columns.forEach((column, index) => {
        const result = flow(column.blocks, column.rect.x, start, assets, { continuous, breakColumn: index > 0, measurementContext }); children.push(...result.children);
      });
      append(children, { count: block.columns.length, space: 0, equalWidth: false, children: block.columns.map(column => ({ width: twip(column.rect.width), space: 0 })) });
      cursor = bottom(block.rect);
    }
    flush(); if (first) append([]);
  }
  const file = new Document({ ...(fonts.length ? { fonts } : {}), creator: 'ToolKnit', title: 'Converted PDF', description: 'Editable document converted locally with ToolKnit.',
    styles: { default: { document: { run: { font: { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'SimSun' }, size: DEFAULT_DOCUMENT_SIZE }, paragraph: { spacing: { after: 0 }, widowControl: false } } } },
    sections });
  // Preserve scan backgrounds and formula assets when the reader saves edits.
  // Office otherwise defaults to resampling embedded images, even on a no-op save.
  file.Settings.addChildElement(new BuilderElement({ name: 'w:doNotAutoCompressPictures' }));
  const buffer = await Packer.toArrayBuffer(file); check();
  quality.nativeMathCharacters = document.pages.flatMap(page => page.sources).filter(source => nativeSourceIds.has(source.id))
    .reduce((sum, source) => sum + source.text.replace(/\s/g, '').length, 0);
  quality.editableCharacters += quality.nativeMathCharacters;
  quality.imageCharacters -= quality.nativeMathCharacters;
  if (buffer.byteLength > LIMITS.outputBytes || buffer.byteLength < 100) throw wordError('output-large');
  return { bytes: new Uint8Array(buffer), quality };
  } finally { generatedFonts.dispose(); }
}
