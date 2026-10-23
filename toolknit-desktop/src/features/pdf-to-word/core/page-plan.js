// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { union, validRect, bottom } from './geometry.js';
import { wordError } from './input.js';
import { MAX_POSITIONED_FRAMES, positionedFrameCost } from './positioned-budget.js';
import { leafBlocks } from './layout.js';

function translate(value, dx, dy, scale) {
  if (Array.isArray(value)) return value.map(item => translate(item, dx, dy, scale));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (['rect', 'column', 'content', 'advanceRect'].includes(key) && validRect(item)) {
      result[key] = { x: item.x * scale + dx, y: item.y * scale + dy, width: item.width * scale, height: item.height * scale };
    } else if (key === 'baseline' && Number.isFinite(item)) result[key] = item * scale + dy;
    else if (key === 'baselineX' && Number.isFinite(item)) result[key] = item * scale + dx;
    else if (['size', 'advanceWidth', 'strokeRadius', 'joinRadius'].includes(key) && Number.isFinite(item)) result[key] = item * scale;
    else if (['from', 'to'].includes(key) && Array.isArray(item) && item.length === 2 && item.every(Number.isFinite)) result[key] = [item[0] * scale + dx, item[1] * scale + dy];
    else if (['columnWidths', 'rowHeights'].includes(key)) result[key] = item.map(number => number * scale);
    else result[key] = translate(item, dx, dy, scale);
  }
  return result;
}

function fragmentRole(page) {
  const visible = leafBlocks([...page.header, ...page.blocks, ...page.footer]).flatMap(block => block.lines || [])
    .sort((a, b) => a.baseline - b.baseline || (a.rect?.x || 0) - (b.rect?.x || 0))
    .map(line => line.text || '').join('\n').trimStart().slice(0, 512);
  if (/^(?:\d{1,3}[.\u3001\uff0e]|\u7b2c\s*\d+\s*\u9898)/u.test(visible)
    || /^[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]+[\u3001.][\s\S]*?\d{1,3}[.\uff0e]/u.test(visible)) return 'question';
  if (/^(?:[\u3010\uff08(]?\s*(?:\u7b54\u6848|\u53c2\u8003\u7b54\u6848|\u89e3\u9898\u5206\u6790|\u89e3\u6790|\u89e3\u7b54|\u5206\u6790)|[\u3010\uff08(]?\u89e3[\u3011\uff09):\uff1a]|\[?\s*(?:Answer|Solution|Analysis)\s*[:.\]])/iu.test(visible)) return 'explanation';
  return 'other';
}

function pageFragments(source, bodyWidth, bodyHeight) {
  const blocks = [...source.header, ...source.blocks, ...source.footer];
  if (blocks.some(block => !validRect(block.rect))) throw wordError('geometry');
  const extent = blocks.length ? union(blocks.map(block => block.rect)) : { x: 0, y: 0, width: 1, height: 1 };
  const widthScale = Math.min(1, bodyWidth / Math.max(1, extent.width));
  const fit = Math.min(widthScale, bodyHeight / Math.max(1, extent.height));
  const create = (content, rect, part, last) => {
    const scale = Math.min(widthScale, bodyHeight / Math.max(1, rect.height));
    // Retain a useful text size; extreme posters need the original-page mode.
    if (scale < .5 && leafBlocks(content).some(block => block.lines?.some(line => line.items.some(item => item.type === 'text')))) throw wordError('a4-fit');
    const ids = new Set(leafBlocks(content).flatMap(block => block.sourceIds));
    const sources = last === 1 ? source.sources : source.sources.filter(item => ids.has(item.id)
      || item.disposition === 'redraw' && ids.has(item.equivalentTo) || part === 0 && item.disposition === 'excluded-hidden');
    const count = positionedFrameCost(content);
    if (count > MAX_POSITIONED_FRAMES) throw wordError('layout-quality');
    return { source, blocks: content, sources, extent: rect, scale, fragmentHeight: Math.max(1, rect.height * scale), count,
      empty: !content.length, role: part === 0 ? fragmentRole(source) : 'other', part };
  };
  // Small margin overruns (including repeated footers) need only a slight fit.
  if (source.rasterPage || fit >= widthScale * .9) return [create(blocks, extent, 0, 1)];
  const maxHeight = bodyHeight / widthScale;
  const flatten = content => content.flatMap(block => block.type === 'columns' ? block.columns.flatMap(column => flatten(column.blocks))
    : block.type === 'paragraph' && block.rect.height > maxHeight && block.lines.every(line => validRect(line.rect))
      ? block.lines.map((line, index) => ({ ...block, id: block.id + ':a4:' + index, rect: line.rect, lines: [line], sourceIds: line.sourceIds })) : [block]);
  // A background and all overlaid text form one band. Never slice a table or a
  // figure through its content simply to satisfy the page-height limit.
  const bands = [];
  for (const block of flatten(blocks).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)) {
    const previous = bands.at(-1);
    if (previous && block.rect.y < bottom(previous.rect) + .5) {
      previous.blocks.push(block); previous.rect = union([previous.rect, block.rect]);
    } else bands.push({ blocks: [block], rect: block.rect });
  }
  const groups = [];
  for (const band of bands) {
    const previous = groups.at(-1);
    if (previous && bottom(band.rect) - previous.rect.y <= maxHeight
      && positionedFrameCost([...previous.blocks, ...band.blocks]) <= MAX_POSITIONED_FRAMES) {
      previous.blocks.push(...band.blocks); previous.rect = union([previous.rect, band.rect]);
    } else groups.push({ blocks: [...band.blocks], rect: band.rect });
  }
  return groups.map((group, index) => create(group.blocks, { ...group.rect, x: extent.x, width: extent.width }, index, groups.length));
}

/** Fit and pack source fragments without detaching text from its background. */
export function planPackedPages(document, { width = 595.3, height = 841.9, margin = 36, gap = 6 } = {}) {
  if (![width, height, margin, gap].every(Number.isFinite) || margin < 0 || gap < 0 || width <= margin * 2 || height <= margin * 2) throw wordError('geometry');
  const pages = [], sources = [];
  let target = null, cursor = margin, runs = 0;
  const fragments = document.pages.flatMap(source => pageFragments(source, width - margin * 2, height - margin * 2));
  for (const [index, fragment] of fragments.entries()) {
    const { source, blocks, extent, scale, fragmentHeight, count, empty } = fragment;
    let requiredHeight = fragmentHeight, requiredRuns = count;
    // Keep explicit question/answer fragments together only when the whole group
    // fits a page. Large explanations remain splittable at source boundaries.
    if (fragment.role === 'question') for (let next = index + 1; fragments[next]?.role === 'explanation'; next++) {
      const following = fragments[next];
      if (requiredHeight + gap + following.fragmentHeight > height - margin * 2 || requiredRuns + following.count > MAX_POSITIONED_FRAMES) break;
      requiredHeight += gap + following.fragmentHeight; requiredRuns += following.count;
    }
    if (!target || cursor + requiredHeight > height - margin || runs + requiredRuns > MAX_POSITIONED_FRAMES) {
      target = { number: pages.length + 1, width, height, header: [], footer: [], blocks: [], sources: [], risks: [], evidence: [], rasterPage: false };
      pages.push(target); cursor = margin; runs = 0;
    }
    const dx = margin - extent.x * scale, dy = cursor - extent.y * scale;
    target.blocks.push(...translate(blocks, dx, dy, scale)); target.sources.push(...translate(fragment.sources, dx, dy, scale));
    target.risks.push(...source.risks);
    sources.push({ page: source.number, targetPage: target.number, bookmark: `toolknit_source_${source.number}` + (fragment.part ? `_part_${fragment.part + 1}` : ''),
      sourceRect: extent, targetRect: { x: margin, y: cursor, width: extent.width * scale, height: fragmentHeight }, scale,
      ...(empty ? { emptySourcePage: true } : {}) });
    cursor += fragmentHeight + gap; runs += count;
  }
  for (const page of pages) { page.content = union(page.blocks.map(block => block.rect)); page.risks = [...new Set(page.risks)]; }
  return { document: { schemaVersion: document.schemaVersion, pages }, sources };
}
