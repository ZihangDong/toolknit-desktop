// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { Bookmark, DocumentGridType, SectionType, Header, Footer } from 'docx';
import { PdfParagraph } from './docx-paragraph.js';
import { wordError } from '../core/input.js';
import { planPackedPages } from '../core/page-plan.js';
import { validateCoverage } from '../core/layout.js';
import { requiresPackedLayout } from '../core/inline-layout.js';

const BODY_WIDTH = 595.3 - 72;
const flattenColumns = blocks => blocks.flatMap(block => block.type === 'columns'
  ? block.columns.flatMap(column => flattenColumns(column.blocks)) : [block]);

export function planContinuousSection(document) {
  if (requiresPackedLayout(document.pages)) return planPackedPages(document);
  for (const page of document.pages) for (const block of flattenColumns([...page.header, ...page.blocks, ...page.footer])) {
    if (['image', 'table', 'option-grid'].includes(block.type) && block.rect.width > BODY_WIDTH) throw wordError('a4-fit');
    if (block.type === 'image' && block.rect.height > 769.9) throw wordError('a4-fit');
    for (const line of block.lines || []) for (const item of line.items) {
      if (item.type === 'image' && item.rect.width > BODY_WIDTH) throw wordError('a4-fit');
    }
  }
  return null;
}

export function continuousSection(document, assets, helpers) {
  const { flow, empty, measurementContext, check, positionedPage } = helpers;
  const packed = planContinuousSection(document);
  if (packed) {
    validateCoverage(packed.document);
    const sections = packed.document.pages.map(page => {
      check();
      const rendered = positionedPage(page, assets, helpers);
      return { properties: { type: SectionType.NEXT_PAGE, grid: { type: DocumentGridType.DEFAULT, linePitch: 0, charSpace: 0 },
        page: { size: { width: 11906, height: 16838 }, margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 } } },
        headers: { default: new Header({ children: [empty(.05)] }) }, footers: { default: new Footer({ children: [empty(.05)] }) },
        children: [...packed.sources.filter(source => source.targetPage === page.number).map(source => new PdfParagraph({ children: [new Bookmark({ id: source.bookmark, children: [] })],
          run: { size: 1 }, spacing: { before: 0, after: 0, line: 2, lineRule: 'exact' }, widowControl: false })), ...rendered.children] };
    });
    return { sources: packed.sources, sections, strategy: 'packed-fragments' };
  }
  const children = [], sources = [];
  for (const page of document.pages) {
    check();
    // Running matter is retained in source order; no source text is discarded.
    const blocks = flattenColumns([...page.header, ...page.blocks, ...page.footer]);
    const bookmark = `toolknit_source_${page.number}`;
    sources.push({ page: page.number, bookmark });
    if (children.length) children.push(empty(3));
    children.push(new PdfParagraph({ children: [new Bookmark({ id: bookmark, children: [] })],
      run: { size: 1 }, spacing: { before: 0, after: 0, line: 2, lineRule: 'exact' }, widowControl: false }));
    children.push(...flow(blocks, page.content.x, 0, assets, { continuous: true, measurementContext }).children);
  }
  return { sources, strategy: 'paragraph-flow', sections: [{ properties: { grid: { type: DocumentGridType.DEFAULT, linePitch: 0, charSpace: 0 },
    page: { size: { width: 11906, height: 16838 }, margin: { top: 720, bottom: 720, left: 720, right: 720, header: 0, footer: 0 } } },
    children: children.length ? children : [empty()] }] };
}
