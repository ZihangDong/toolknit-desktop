// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { union, median, right, bottom } from './geometry.js';
import { buildParagraphs, isOption } from './text.js';
import { optionGrids } from './tables.js';
import { wordError, LIMITS } from './input.js';
import { pageInlineParts, requiresPackedLayout } from './inline-layout.js';
import { orderBandBlocks } from './reading-order.js';

function repeatedParts(pages) {
  const occurrences = new Map();
  const key = (part, page) => {
    if (!['image', 'line'].includes(part.type)) return null;
    const zone = bottom(part.rect) < page.height * 0.1 ? 'header' : part.rect.y > page.height * 0.9 ? 'footer' : '';
    if (!zone) return null;
    const content = part.type === 'image' ? part.fingerprint || '' : part.text.replace(/\d+/g, '#').replace(/\s/g, '');
    if (!content) return null;
    return `${zone}:${content}`;
  };
  const centerX = part => part.rect.x + part.rect.width / 2;
  const bucket = (x, y) => `${x}:${y}`;
  for (const page of pages) for (const part of page.parts) {
    const signature = key(part, page);
    if (!signature) continue;
    if (!occurrences.has(signature)) occurrences.set(signature, new Map());
    const positions = occurrences.get(signature), x = centerX(part), y = part.rect.y;
    const cell = bucket(Math.floor(x / 4), Math.floor(y / 4));
    if (!positions.has(cell)) positions.set(cell, []);
    positions.get(cell).push({ x, y, page: page.number });
  }
  return (part, page) => {
    const signature = key(part, page);
    if (!signature || pages.length < 2) return null;
    const positions = occurrences.get(signature), matchingPages = new Set();
    const x = centerX(part), y = part.rect.y, bx = Math.floor(x / 4), by = Math.floor(y / 4);
    // Page-number digit changes and tiny coordinate shifts must not turn a
    // repeated footer into body content at a quantization boundary.
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const candidate of positions?.get(bucket(bx + dx, by + dy)) || []) {
        if (Math.abs(candidate.x - x) <= 4 && Math.abs(candidate.y - y) <= 4) matchingPages.add(candidate.page);
      }
    }
    if (matchingPages.size < Math.max(2, Math.ceil(pages.length * 0.6))) return null;
    return signature.startsWith('header:') ? 'header' : 'footer';
  };
}

function columnCuts(lines, rect) {
  const bodySize = median(lines.map(line => line.size)) || 11;
  const candidates = lines.filter(line => line.rect.width < rect.width * 0.72 && line.size <= bodySize * 1.2 && !isOption(line.text));
  if (candidates.length < 4) return [];
  const intervals = candidates.map(line => [line.rect.x, right(line.rect)]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const span of intervals) {
    if (merged.length && span[0] <= merged.at(-1)[1] + 2) merged.at(-1)[1] = Math.max(merged.at(-1)[1], span[1]);
    else merged.push([...span]);
  }
  const cuts = [];
  for (let i = 1; i < merged.length; i++) {
    if (merged[i][0] - merged[i - 1][1] < Math.max(18, bodySize * 1.5)) continue;
    const cut = (merged[i][0] + merged[i - 1][1]) / 2;
    const left = candidates.filter(line => right(line.rect) < cut), rightSide = candidates.filter(line => line.rect.x > cut);
    if (left.length >= 2 && rightSide.length >= 2) cuts.push(cut);
  }
  return cuts.length <= 3 ? cuts : [];
}

function bandBlocks(parts, rect, mode) {
  const lines = parts.filter(part => part.type === 'line'), other = parts.filter(part => part.type !== 'line');
  const cuts = mode === 'single' ? [] : columnCuts(lines, rect);
  if (!cuts.length) return orderBandBlocks([...buildParagraphs(lines, rect), ...other]);
  const bodySize = median(lines.map(line => line.size)) || 11;
  const headings = lines.filter(line => line.size > bodySize * 1.22);
  const bodyTop = Math.min(...lines.filter(line => line.size <= bodySize * 1.22).map(line => line.rect.y));
  const topHeading = headings.length === 1 && bottom(headings[0].rect) < bodyTop ? headings[0] : null;
  const spanning = parts.filter(part => part === topHeading || cuts.some(cut => part.rect.x < cut && right(part.rect) > cut));
  if (spanning.length) {
    const groups = [];
    for (const part of [...spanning].sort((a, b) => a.rect.y - b.rect.y)) {
      const last = groups.at(-1);
      if (last && part.rect.y < bottom(last.rect) + 1) { last.parts.push(part); last.rect = union([last.rect, part.rect]); }
      else groups.push({ parts: [part], rect: part.rect });
    }
    const remaining = parts.filter(part => !spanning.includes(part));
    const result = [];
    for (const group of groups) {
      const before = remaining.filter(part => bottom(part.rect) <= group.rect.y + 1);
      before.forEach(part => remaining.splice(remaining.indexOf(part), 1));
      if (before.length) result.push(...bandBlocks(before, rect, mode));
      result.push(...bandBlocks(group.parts, rect, 'single'));
    }
    if (remaining.length) result.push(...bandBlocks(remaining, rect, mode));
    return result;
  }
  const boundaries = [rect.x, ...cuts, right(rect)];
  const columns = boundaries.slice(0, -1).map((x, index) => {
    const columnRect = { x, y: rect.y, width: boundaries[index + 1] - x, height: rect.height };
    const content = parts.filter(part => (part.rect.x + right(part.rect)) / 2 >= x && (part.rect.x + right(part.rect)) / 2 < boundaries[index + 1] + 0.1);
    return { rect: columnRect, blocks: bandBlocks(content, columnRect, 'single') };
  }).filter(column => column.blocks.length);
  if (columns.length < 2) return bandBlocks(parts, rect, 'single');
  return [{ id: parts[0].id + ':columns', type: 'columns', rect: union(parts.map(part => part.rect)),
    sourceIds: parts.flatMap(part => part.sourceIds), columns, evidence: ['persistent-gutter', 'independent-column-flow'] }];
}

function makeBlocks(parts, rect, mode) {
  let lines = parts.filter(part => part.type === 'line');
  // Grid ownership and fit were settled before image crops. Re-detecting here
  // would turn deliberately preserved cell images back into an unchecked table.
  const options = optionGrids(lines, rect);
  const optionIds = new Set(options.flatMap(table => table.sourceIds));
  lines = lines.filter(line => !line.sourceIds.some(id => optionIds.has(id)));
  const figures = parts.filter(part => part.type === 'image');
  return bandBlocks([...lines, ...options, ...figures, ...parts.filter(part => part.type === 'table')], rect, mode);
}

export function inferDocument(scenes, { pageModes = {}, preserveGeometry = false, continuous = false } = {}) {
  if (!Array.isArray(scenes) || scenes.length < 1 || scenes.length > LIMITS.selectedPages) throw wordError('selection-large');
  if (scenes.reduce((sum, page) => sum + page.sources.length, 0) > LIMITS.items || scenes.reduce((sum, page) => sum + page.characters, 0) > LIMITS.characters) throw wordError('text-large');
  const keepGeometry = preserveGeometry || continuous && requiresPackedLayout(scenes);
  const pages = scenes.map(scene => ({ ...scene, parts: pageInlineParts(scene, { preserveGeometry: keepGeometry }) }));
  const classify = repeatedParts(pages);
  const output = pages.map(page => {
    const headerParts = [], footerParts = [], bodyParts = [];
    for (const part of page.parts) {
      const role = pageModes[page.number] === 'no-header' ? null : classify(part, page);
      (role === 'header' ? headerParts : role === 'footer' ? footerParts : bodyParts).push(part);
    }
    const extent = union(bodyParts.map(part => part.rect));
    const contentLeft = Math.max(0, Math.min(extent.x, page.width * 0.12));
    const contentRight = Math.min(page.width, Math.max(right(extent), page.width * 0.88));
    const content = { x: contentLeft, y: extent.y, width: contentRight - contentLeft, height: extent.height };
    const full = { x: contentLeft, y: 0, width: contentRight - contentLeft, height: page.height };
    const result = { number: page.number, width: page.width, height: page.height, sources: page.sources,
      header: makeBlocks(headerParts, full, 'single'), footer: makeBlocks(footerParts, full, 'single'),
      blocks: makeBlocks(bodyParts, content, pageModes[page.number] || 'auto'),
      content, risks: [...page.risks], rasterPage: page.rasterPage, drawingOwnership: page.drawingOwnership,
      inkCoverage: page.inkCoverage, evidence: [] };
    if (page.backgroundTextLayers) result.backgroundTextLayers = page.backgroundTextLayers;
    if (headerParts.length) result.evidence.push('repeated-header');
    if (footerParts.length) result.evidence.push('repeated-footer');
    if (result.blocks.some(block => block.type === 'columns')) result.evidence.push('columns');
    if (result.blocks.some(block => block.type === 'option-grid')) result.evidence.push('option-grid');
    return result;
  });
  const document = { schemaVersion: 1, pages: output };
  document.quality = validateCoverage(document);
  return document;
}

export function leafBlocks(blocks) {
  return blocks.flatMap(block => block.type === 'columns' ? block.columns.flatMap(column => leafBlocks(column.blocks))
    : ['table', 'option-grid'].includes(block.type) ? block.cells.flatMap(cell => leafBlocks(cell.blocks)) : [block]);
}

export function validateCoverage(document) {
  let characters = 0, editableCharacters = 0, imageCharacters = 0, hiddenCharacters = 0, redrawCharacters = 0;
  const pages = [];
  for (const page of document.pages) {
    const seen = new Set(), sourceMap = new Map(page.sources.map(source => [source.id, source]));
    if (sourceMap.size !== page.sources.length) throw wordError('coverage');
    const leaves = leafBlocks([...page.header, ...page.blocks, ...page.footer]);
    for (const block of leaves) for (const id of block.sourceIds) {
      if (!sourceMap.has(id) || seen.has(id) || ['excluded-hidden', 'redraw'].includes(sourceMap.get(id).disposition)) throw wordError('coverage');
      seen.add(id);
    }
    for (const source of page.sources) {
      const length = source.text.replace(/\s/g, '').length;
      if (source.disposition === 'excluded-hidden') { hiddenCharacters += length; continue; }
      if (source.disposition === 'redraw') { if (!seen.has(source.equivalentTo)) throw wordError('coverage'); redrawCharacters += length; continue; }
      if (!seen.has(source.id)) throw wordError('coverage');
      characters += length;
      if (source.disposition === 'editable') editableCharacters += length; else imageCharacters += length;
    }
    const images = [...leaves.filter(block => block.type === 'image'), ...leaves.flatMap(block => (block.lines || []).flatMap(line => line.items.filter(item => item.type === 'image')))];
    pages.push({ page: page.number, sourceCount: page.sources.length, outputSourceCount: seen.size, risks: page.risks,
      paragraphs: leaves.filter(block => block.type === 'paragraph').length, images: images.length,
      imageFormulas: images.filter(item => item.role === 'math').length });
  }
  return { characters, editableCharacters, imageCharacters, hiddenCharacters, redrawCharacters, pages };
}
