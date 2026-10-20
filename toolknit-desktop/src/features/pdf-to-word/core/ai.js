// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { LIMITS, wordError } from './input.js';
import { leafBlocks, validateCoverage } from './layout.js';
import { union, right, bottom } from './geometry.js';

const ROLES = new Set(['paragraph', 'heading', 'list', 'option']);
export function aiPageRequest(page, requestId, digest) {
  const blocks = page.blocks.filter(block => block.type === 'paragraph');
  if (!blocks.length || blocks.length > LIMITS.aiSourceIds) return null;
  return { schemaVersion: 1, requestId, sourceDigest: digest, page: page.number,
    regions: blocks.map(block => ({ id: block.id, role: block.role, rect: block.rect,
      text: block.lines.map(line => line.text).join('\n') })),
    allowedRoles: [...ROLES, 'table', 'option-grid', 'columns'] };
}

function validateGroups(value, request) {
  if (Object.keys(value).some(key => !['schemaVersion', 'requestId', 'sourceDigest', 'page', 'groups', 'readingOrder'].includes(key))) throw wordError('ai-response');
  if (!Array.isArray(value.groups) || !value.groups.length || value.groups.length > request.regions.length) throw wordError('ai-response');
  const allowed = new Set(request.regions.map(region => region.id)), seen = new Set(), groups = new Set();
  const checkIds = ids => {
    if (!Array.isArray(ids) || !ids.length || ids.some(id => !allowed.has(id) || seen.has(id))) throw wordError('ai-response');
    for (const id of ids) { if (seen.has(id)) throw wordError('ai-response'); seen.add(id); }
  };
  for (const group of value.groups) {
    if (!group || !/^[a-zA-Z0-9_-]{1,64}$/.test(group.id) || groups.has(group.id)
      || !request.allowedRoles.includes(group.role) || Object.keys(group).some(key => !['id', 'role', 'sourceIds', 'cells', 'columns'].includes(key))) throw wordError('ai-response');
    groups.add(group.id);
    if (group.role === 'table' || group.role === 'option-grid') {
      if (group.sourceIds || group.columns || !Array.isArray(group.cells) || !group.cells.length || group.cells.length > 256) throw wordError('ai-response');
      const occupied = new Set();
      for (const cell of group.cells) {
        if (!cell || Object.keys(cell).some(key => !['row', 'col', 'rowSpan', 'colSpan', 'sourceIds'].includes(key))) throw wordError('ai-response');
        if (![cell.row, cell.col, cell.rowSpan, cell.colSpan].every(Number.isInteger) || cell.row < 0 || cell.col < 0 || cell.rowSpan < 1 || cell.colSpan < 1 || cell.row + cell.rowSpan > 64 || cell.col + cell.colSpan > 16) throw wordError('ai-response');
        checkIds(cell.sourceIds);
        for (let row = cell.row; row < cell.row + cell.rowSpan; row++) for (let col = cell.col; col < cell.col + cell.colSpan; col++) {
          const position = `${row}:${col}`; if (occupied.has(position)) throw wordError('ai-response'); occupied.add(position);
        }
      }
    } else if (group.role === 'columns') {
      if (group.sourceIds || group.cells || !Array.isArray(group.columns) || group.columns.length < 2 || group.columns.length > 4) throw wordError('ai-response');
      group.columns.forEach(column => { if (!column || Object.keys(column).some(key => key !== 'sourceIds')) throw wordError('ai-response'); checkIds(column.sourceIds); });
    } else {
      if (group.cells || group.columns) throw wordError('ai-response'); checkIds(group.sourceIds);
    }
  }
  if (seen.size !== allowed.size || !Array.isArray(value.readingOrder) || value.readingOrder.length !== groups.size
    || new Set(value.readingOrder).size !== groups.size || value.readingOrder.some(id => !groups.has(id))) throw wordError('ai-response');
  return value;
}

export function validateAiStructure(response, request) {
  if (typeof response !== 'string' || new TextEncoder().encode(response).length > LIMITS.aiResponseBytes) throw wordError('ai-response');
  let value;
  try { value = JSON.parse(response); } catch { throw wordError('ai-response'); }
  if (!value || typeof value !== 'object'
    || value.schemaVersion !== 1 || value.requestId !== request.requestId || value.sourceDigest !== request.sourceDigest || value.page !== request.page) throw wordError('ai-response');
  if (value.groups) return validateGroups(value, request);
  if (Object.keys(value).some(key => !['schemaVersion', 'requestId', 'sourceDigest', 'page', 'regions', 'readingOrder'].includes(key))) throw wordError('ai-response');
  const allowed = new Set(request.regions.map(region => region.id)), used = new Set();
  if (!Array.isArray(value.regions) || value.regions.length !== allowed.size || !Array.isArray(value.readingOrder) || value.readingOrder.length !== allowed.size) throw wordError('ai-response');
  for (const region of value.regions) {
    if (!region || Object.keys(region).some(key => !['id', 'role'].includes(key)) || !allowed.has(region.id) || used.has(region.id) || !ROLES.has(region.role)) throw wordError('ai-response');
    used.add(region.id);
  }
  if (new Set(value.readingOrder).size !== allowed.size || value.readingOrder.some(id => !allowed.has(id))) throw wordError('ai-response');
  return value;
}

export function applyAiStructure(document, request, suggestion) {
  const output = structuredClone(document), page = output.pages.find(page => page.number === request.page);
  if (!page) throw wordError('ai-response');
  if (suggestion.groups) {
    const originals = new Map(page.blocks.filter(block => block.type === 'paragraph').map(block => [block.id, block]));
    const members = ids => ids.map(id => { const block = originals.get(id); if (!block) throw wordError('ai-response'); return block; });
    const converted = new Map();
    for (const group of suggestion.groups) {
      let block;
      if (group.role === 'columns') {
        const columns = group.columns.map(column => { const blocks = members(column.sourceIds); return { blocks, rect: union(blocks.map(block => block.rect)) }; });
        for (let i = 1; i < columns.length; i++) if (columns[i].rect.x < right(columns[i - 1].rect) - 2) throw wordError('ai-response');
        block = { id: `ai:${request.requestId}:${group.id}`, type: 'columns', columns, rect: union(columns.map(column => column.rect)), sourceIds: columns.flatMap(column => column.blocks.flatMap(block => block.sourceIds)) };
      } else if (group.role === 'table' || group.role === 'option-grid') {
        const cells = group.cells.map(cell => { const blocks = members(cell.sourceIds); return { ...cell, blocks, rect: union(blocks.map(block => block.rect)), sourceIds: blocks.flatMap(block => block.sourceIds) }; });
        const rect = union(cells.map(cell => cell.rect));
        const count = Math.max(...cells.map(cell => cell.col + cell.colSpan)), rows = Math.max(...cells.map(cell => cell.row + cell.rowSpan));
        const xs = Array.from({ length: count }, (_, col) => Math.min(...cells.filter(cell => cell.col === col).map(cell => cell.rect.x)));
        if (xs.some(x => !Number.isFinite(x)) || xs.some((x, index) => index && x <= xs[index - 1])) throw wordError('ai-response');
        const edge = Math.min(page.width, Math.max(right(rect) + 4, right(page.content)));
        for (const cell of cells) {
          const boundary = xs[cell.col + cell.colSpan] ?? edge;
          if (right(cell.rect) > boundary + 2) throw wordError('ai-response');
          cell.rect = { ...cell.rect, x: xs[cell.col], width: boundary - xs[cell.col] };
        }
        block = { id: `ai:${request.requestId}:${group.id}`, type: group.role, cells, rect: { ...rect, width: edge - rect.x }, rows,
          columnWidths: xs.map((x, index) => (xs[index + 1] ?? edge) - x), sourceIds: cells.flatMap(cell => cell.sourceIds) };
      } else {
        const blocks = members(group.sourceIds), lines = blocks.flatMap(block => block.lines);
        block = { ...blocks[0], id: `ai:${request.requestId}:${group.id}`, role: group.role, lines, rect: union(blocks.map(block => block.rect)), sourceIds: blocks.flatMap(block => block.sourceIds) };
      }
      converted.set(group.id, block);
    }
    const preserved = page.blocks.filter(block => !request.regions.some(region => region.id === block.id)).sort((a, b) => a.rect.y - b.rect.y);
    const ordered = suggestion.readingOrder.map(id => converted.get(id));
    // Fixed graphics/tables remain in source order; AI cannot move text across their vertical boundaries.
    for (const block of ordered) for (const fixed of preserved) {
      if (block.rect.y < bottom(fixed.rect) && bottom(block.rect) > fixed.rect.y && block.rect.x < right(fixed.rect) && right(block.rect) > fixed.rect.x) throw wordError('ai-response');
    }
    const bands = Array.from({ length: preserved.length + 1 }, () => []);
    let previousBand = 0;
    for (const block of ordered) {
      const band = preserved.filter(fixed => bottom(fixed.rect) <= block.rect.y).length;
      if (band < previousBand) throw wordError('ai-response');
      bands[band].push(block); previousBand = band;
    }
    page.blocks = bands.flatMap((band, index) => index < preserved.length ? [...band, preserved[index]] : band);
    page.evidence.push('ai-structure'); output.quality = validateCoverage(output); return output;
  }
  const roles = new Map(suggestion.regions.map(region => [region.id, region.role]));
  const order = new Map(suggestion.readingOrder.map((id, index) => [id, index]));
  function update(blocks) {
    for (const block of blocks) {
      if (block.type === 'columns') block.columns.forEach(column => update(column.blocks));
      else if (block.type === 'table' || block.type === 'option-grid') block.cells.forEach(cell => update(cell.blocks));
      else if (block.type === 'paragraph' && roles.has(block.id)) block.role = roles.get(block.id);
    }
    // Preserve graphics and table ownership; AI can reorder only contiguous peer paragraphs.
    for (let start = 0; start < blocks.length;) {
      if (!order.has(blocks[start].id)) { start++; continue; }
      let end = start + 1;
      while (end < blocks.length && order.has(blocks[end].id)) end++;
      const group = blocks.slice(start, end).sort((a, b) => order.get(a.id) - order.get(b.id));
      blocks.splice(start, end - start, ...group); start = end;
    }
  }
  update(page.blocks); page.evidence.push('ai-structure'); output.quality = validateCoverage(output);
  return output;
}
