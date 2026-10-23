// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { bottom, validRect, overlaps, spatialIndex } from './geometry.js';
import { wordError } from './input.js';

const leaves = blocks => blocks.flatMap(block => block.type === 'columns'
  ? block.columns.flatMap(column => leaves(column.blocks))
  : ['table', 'option-grid'].includes(block.type) ? block.cells.flatMap(cell => leaves(cell.blocks)) : [block]);

/** Structural preflight is not a rendered fidelity score. */
export function inspectLayoutQuality(document) {
  const pages = document.pages.map(page => {
    const blocks = leaves([...page.header, ...page.blocks, ...page.footer]);
    const images = blocks.filter(block => block.type === 'image');
    const faults = [];
    if (blocks.some(block => !validRect(block.rect) || block.rect.x < -1 || block.rect.y < -1
      || block.rect.x + block.rect.width > page.width + 1 || bottom(block.rect) > page.height + 1)) faults.push('out-of-bounds');
    const imageHeight = images.reduce((sum, image) => sum + image.rect.height, 0);
    const tiny = images.filter(image => Math.min(image.rect.width, image.rect.height) < 3).length;
    const index = spatialIndex(images);
    let overlapping = 0;
    for (const image of images) if (index(image.rect).some(other => other !== image && overlaps(image.rect, other.rect, 0.5))) overlapping++;
    // The current writer gives each unowned image a separate flow paragraph.
    // A dense collection whose minimum occupation exceeds its page cannot fit.
    if (images.length >= 16 && imageHeight > page.height * 1.5) faults.push('fragmented-flow');
    if (images.length >= 32 && (tiny > images.length / 2 || overlapping > images.length / 2)) faults.push('fragmented-regions');
    return { page: page.number, images: images.length, tinyImages: tiny, overlappingImages: overlapping,
      imageHeight, faults };
  });
  return { status: pages.some(page => page.faults.length) ? 'blocked' : 'unverified',
    rendered: false, fidelity: null, pages };
}

export function assertLayoutQuality(document) {
  const result = inspectLayoutQuality(document);
  if (result.status === 'blocked') throw wordError('layout-quality', { pages: result.pages.filter(page => page.faults.length).map(page => page.page) });
  return result;
}
