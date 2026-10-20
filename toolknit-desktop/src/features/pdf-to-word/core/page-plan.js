// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { union, validRect } from './geometry.js';
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
    else if (['size', 'advanceWidth'].includes(key) && Number.isFinite(item)) result[key] = item * scale;
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

/** Pack short source fragments while preserving their internal geometry. */
export function planPackedPages(document, { width = 595.3, height = 841.9, margin = 36, gap = 6 } = {}) {
  const pages = [], sources = [];
  let target = null, cursor = margin, runs = 0;
  const fragments = document.pages.map(source => {
    const blocks = [...source.header, ...source.blocks, ...source.footer];
    const empty = blocks.length === 0;
    const extent = empty ? { x: 0, y: 0, width: 1, height: 1 } : union(blocks.map(block => block.rect));
    if (!validRect(extent)) throw wordError('geometry');
    const scale = source.rasterPage ? Math.min(1, (width - margin * 2) / Math.max(1, extent.width), (height - margin * 2) / Math.max(1, extent.height)) : 1;
    const fragmentHeight = Math.max(1, extent.height * scale), count = positionedFrameCost(blocks);
    if (extent.width * scale > width - margin * 2 + .1 || fragmentHeight > height - margin * 2 + .1) throw wordError('a4-fit');
    if (count > MAX_POSITIONED_FRAMES) throw wordError('layout-quality');
    return { source, blocks, extent, scale, fragmentHeight, count, empty, role: fragmentRole(source) };
  });
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
    target.blocks.push(...translate(blocks, dx, dy, scale)); target.sources.push(...translate(source.sources, dx, dy, scale));
    target.risks.push(...source.risks);
    sources.push({ page: source.number, targetPage: target.number, bookmark: `toolknit_source_${source.number}`,
      sourceRect: extent, targetRect: { x: margin, y: cursor, width: extent.width * scale, height: fragmentHeight }, scale,
      ...(empty ? { emptySourcePage: true } : {}) });
    cursor += fragmentHeight + gap; runs += count;
  }
  for (const page of pages) { page.content = union(page.blocks.map(block => block.rect)); page.risks = [...new Set(page.risks)]; }
  return { document: { schemaVersion: document.schemaVersion, pages }, sources };
}
