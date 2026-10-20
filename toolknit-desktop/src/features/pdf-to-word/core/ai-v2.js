// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { LIMITS, wordError } from './input.js';
import { union, intersect, contains, overlaps, right } from './geometry.js';
import { validateCoverage, leafBlocks } from './layout.js';
import { validateAiStructure, applyAiStructure } from './ai.js';
import { validateMathEvidence, validMathStyle } from './math.js';

const ROLES = ['paragraph', 'heading', 'list', 'option', 'table', 'option-grid', 'columns'];
const fail = () => { throw wordError('ai-response'); };
const fields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key));

function peers(page, path) {
  let blocks = page.blocks;
  for (const step of path) {
    const parent = blocks.find(block => block.id === step.id);
    blocks = parent?.[step.kind]?.[step.index]?.blocks;
    if (!blocks) fail();
  }
  return blocks;
}

function safeMath(page, image, sources) {
  if (image?.role !== 'math' || image.reasons?.length || !image.mathGlyphs?.length
    || image.mathGlyphs.length + (image.mathStrokes?.length || 0) > LIMITS.aiSourceIds
    || image.mathGlyphs.length !== image.sourceIds.length) return false;
  sources ||= new Map(page.sources.map(source => [source.id, source]));
  const ids = new Set(image.sourceIds);
  return new Set(image.mathGlyphs.map(glyph => glyph.id)).size === ids.size && image.mathGlyphs.every(glyph => !glyph.raster && validMathStyle(glyph)
    && ids.has(glyph.id) && sources.get(glyph.id)?.disposition === 'visible-image' && sources.get(glyph.id)?.text === glyph.text);
}

// Paths describe locally owned containers, never model-controlled coordinates.
export function planAiScopes(document, selectedPages = []) {
  validateCoverage(document);
  const result = [];
  for (const page of document.pages) {
    if (page.rasterPage || page.risks.includes('image-page')) continue;
    const pageRect = { x: 0, y: 0, width: page.width, height: page.height };
    const visible = new Map(page.sources.filter(source => source.disposition === 'editable').map(source => [source.id, source]));
    const leaves = leafBlocks(page.blocks);
    const fixedTableBackgrounds = leaves.filter(block => block.type === 'image' && block.backgroundPaintIndexes?.length);
    const add = scope => {
      const rect = intersect(scope.rect, pageRect);
      if (rect) result.push({ ...scope, rect, page: page.number,
        id: `p${page.number}:scope${result.length}`, priority: (selectedPages.includes(page.number) ? 10 : 0)
          + (scope.kind === 'math' ? 3 : scope.path.length ? 2 : 0) });
    };
    const visit = (blocks, path) => {
      let pending = [];
      const flush = () => {
        if (!pending.length) return;
        add({ kind: 'layout', path, ids: pending.map(block => block.id), rect: union(pending.map(block => block.rect)) });
        pending = [];
      };
      for (const block of blocks) {
        if (block.type === 'paragraph') {
          // Recovered table text shares fixed coordinates with its backdrop.
          // Regrouping it would either fail overlap validation or break cells.
          if (fixedTableBackgrounds.some(background => overlaps(background.rect, block.rect))) { flush(); continue; }
          const text = block.lines.flatMap(line => line.items.filter(item => item.type === 'text'));
          if (text.length && text.every(item => item.sourceIds.every(id => visible.has(id)))) {
            pending.push(block); if (pending.length === Math.min(64, LIMITS.aiSourceIds)) flush();
          } else flush();
        } else {
          flush();
          for (const kind of ['columns', 'cells']) block[kind]?.forEach((child, index) => visit(child.blocks, [...path, { id: block.id, kind, index }]));
        }
      }
      flush();
    };
    visit(page.blocks, []);
    const images = [...leaves.filter(block => block.type === 'image'), ...leaves.flatMap(block => (block.lines || []).flatMap(line => line.items.filter(item => item.type === 'image')))];
    const sources = new Map(page.sources.map(source => [source.id, source]));
    for (const image of images) {
      if (!safeMath(page, image, sources)) continue;
      add({ kind: 'math', path: [], ids: [image.id], rect: image.rect });
    }
  }
  return result.sort((a, b) => b.priority - a.priority || a.page - b.page);
}

function mathRegion(page, id) {
  const leaves = leafBlocks(page.blocks);
  return leaves.find(block => block.id === id) || leaves.flatMap(block => (block.lines || []).flatMap(line => line.items)).find(item => item.id === id);
}

export function aiScopePayload(page, scope) {
  const base = { schemaVersion: 2, page: page.number, scopeId: scope.id, kind: scope.kind, rect: scope.rect };
  if (scope.kind === 'math') {
    const image = mathRegion(page, scope.ids[0]);
    if (!safeMath(page, image)) fail();
    return { ...base, regions: [], allowedRoles: [], math: { id: image.id,
      glyphs: image.mathGlyphs.map(({ id, text, rect, baseline, size, bold, italic, alphabet, font, radicalPart, delimiterPart, color }) =>
        ({ id, text, rect, baseline, size, bold: Boolean(bold), italic: Boolean(italic), ...(alphabet ? { alphabet } : {}),
          ...(font ? { font } : {}), ...(color ? { color } : {}), ...(radicalPart ? { radicalPart } : {}), ...(delimiterPart ? { delimiterPart } : {}) })),
      strokes: (image.mathStrokes || []).map(({ id, rect, thin, unmapped, path, color }) => ({ id, rect, thin: Boolean(thin), unmapped: Boolean(unmapped), ...(color ? { color } : {}),
        ...(path?.complete ? { path } : {}) })) } };
  }
  const blocks = peers(page, scope.path), chosen = blocks.filter(block => scope.ids.includes(block.id));
  if (chosen.length !== scope.ids.length) fail();
  return { ...base, regions: chosen.map(block => ({ id: block.id, role: block.role, rect: block.rect,
    text: block.lines.map(line => line.items.map(item => item.type === 'text' ? item.text : '[image]').join('')).join('\n') })),
    // Word sections can express page columns, not columns nested inside a cell/column.
    allowedRoles: scope.path.length ? ROLES.filter(role => role !== 'columns') : ROLES,
    fixed: blocks.filter(block => !scope.ids.includes(block.id) && overlaps(block.rect, scope.rect))
      .map(({ id, type, rect }) => ({ id, type, rect })) };
}

export function validateAiScope(response, request) {
  if (typeof response !== 'string' || new TextEncoder().encode(response).length > LIMITS.aiResponseBytes) fail();
  let value;
  try { value = JSON.parse(response); } catch { fail(); }
  if (!fields(value, ['schemaVersion', 'requestId', 'inputDigest', 'sourceDigest', 'page', 'scopeId', 'groups', 'readingOrder', 'mathCandidates'])
    || ['schemaVersion', 'requestId', 'inputDigest', 'sourceDigest', 'page', 'scopeId'].some(key => value[key] !== request[key])) fail();
  if (request.kind === 'math') {
    if (value.groups !== undefined || value.readingOrder !== undefined || !Array.isArray(value.mathCandidates) || value.mathCandidates.length > 1) fail();
    for (const candidate of value.mathCandidates) {
      if (!fields(candidate, ['id', 'ast']) || candidate.id !== request.math.id
        || !validateMathEvidence(candidate.ast, { mathGlyphs: request.math.glyphs, mathStrokes: request.math.strokes })) fail();
    }
  } else {
    if (value.mathCandidates !== undefined || !value.groups) fail();
    validateAiStructure(JSON.stringify({ schemaVersion: 1, requestId: value.requestId, sourceDigest: value.sourceDigest,
      page: value.page, groups: value.groups, readingOrder: value.readingOrder }), { ...request, schemaVersion: 1 });
  }
  return value;
}

export function applyAiScope(document, scope, request, suggestion) {
  const output = structuredClone(document), page = output.pages.find(page => page.number === scope.page);
  if (!page) fail();
  // Revalidate even cached proposals; math evidence proves provenance, not meaning.
  validateAiScope(JSON.stringify(suggestion), request);
  if (scope.kind === 'math') {
    const image = mathRegion(page, scope.ids[0]);
    if (!image) fail();
    image.aiReview = { status: suggestion.mathCandidates.length ? 'needs-review' : 'kept-image',
      candidates: suggestion.mathCandidates, sourceDigest: request.sourceDigest };
  } else {
    const blocks = peers(page, scope.path), chosen = blocks.filter(block => scope.ids.includes(block.id));
    const start = blocks.findIndex(block => block.id === scope.ids[0]);
    if (chosen.length !== scope.ids.length || start < 0 || !scope.ids.every((id, index) => blocks[start + index]?.id === id)) fail();
    const fake = { schemaVersion: 1, pages: [{ ...page, blocks: chosen, header: [], footer: [], content: scope.rect,
      width: right(scope.rect), sources: page.sources.filter(source => chosen.some(block => block.sourceIds.includes(source.id))), evidence: [] }] };
    const converted = applyAiStructure(fake, { ...request, schemaVersion: 1 }, { ...suggestion, schemaVersion: 1 }).pages[0].blocks;
    for (const block of converted) {
      if (!contains(scope.rect, block.rect, 2) || blocks.some(fixed => !scope.ids.includes(fixed.id) && overlaps(block.rect, fixed.rect))) fail();
    }
    blocks.splice(start, scope.ids.length, ...converted);
  }
  page.evidence = [...new Set([...page.evidence, 'ai-region-structure'])];
  output.quality = validateCoverage(output);
  return output;
}
