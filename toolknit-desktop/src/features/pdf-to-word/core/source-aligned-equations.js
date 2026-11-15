// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { validRect, union, bottom, overlaps, spatialIndex } from './geometry.js';
import { completeMathGlyphPositions, nativeMathRunParts } from './math-limit-runs.js';
import { sourceUpperAttachmentMetric } from './source-upper-attachment-profile.js';

const MAX_ITEMS = 20000, MAX_WORK = 65536;
const xits = /^(?:[A-Z]{6}\+)?XITSMath-Regular$/;
const memberKeys = ['item', 'source'];
const proofConflicts = ['ocrMath', 'rasterMathEvidence', 'sourceNativeUnicodeScalar', 'sourceFirstLevelIndex',
  'sourceScalarRelation', 'sourceIndexedSum', 'sourceUpperAttachment'];
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => allowed.includes(key));
const sameRect = (a, b) => validRect(a) && validRect(b)
  && ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < .001);
const letter = text => typeof text === 'string' && [...text].length === 1 && /^\p{L}$/u.test(text)
  && (text === 'ℎ' || text.codePointAt(0) >= 0x1d434 && text.codePointAt(0) <= 0x1d467);
const symbol = glyph => ({ type: 'symbol', sourceId: glyph.id, text: glyph.text, italic: false, bold: false });
function canonical(value) {
  let work = 0;
  const visit = (node, depth = 0) => {
    if (++work > 4096 || depth > 14) throw Error('bounded-aligned-evidence');
    if (typeof node === 'string' && node.length > 4096) throw Error('bounded-aligned-text');
    if (Array.isArray(node)) {
      if (node.length > 64) throw Error('bounded-aligned-array');
      return node.map(child => visit(child, depth + 1));
    }
    if (node && typeof node === 'object') {
      const names = Object.keys(node);
      if (names.length > 64 || names.some(name => name.length > 256)) throw Error('bounded-aligned-object');
      return Object.fromEntries(names.filter(name => node[name] !== undefined).sort()
        .map(name => [name, visit(node[name], depth + 1)]));
    }
    if (typeof node === 'number' && !Number.isFinite(node)
      || node !== null && !['string', 'number', 'boolean', 'undefined'].includes(typeof node)) throw Error('invalid-aligned-value');
    return node;
  };
  return visit(value);
}
const exact = (a, b) => { try { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); } catch { return false; } };

function clean(item, source) {
  return item && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 200
    && typeof item.text === 'string' && item.text.length <= 128 && xits.test(item.font || '')
    && item.preciseInk === true && item.raster === false && !item.reason && !item.ocr && !item.ocrEvidence
    && !item.alphabet && !item.mathStyleUncertain && !item.radicalPart && !item.delimiterPart
    && !item.bold && !item.italic && !item.nativeCalibrated && !item.fontAssetId
    && !item.splitFrom && !item.sourceRange && !item.clipped && !item.truncated && validRect(item.rect)
    && [item.size, item.baseline, item.baselineX, item.advanceWidth].every(Number.isFinite)
    && item.size >= 4 && item.size <= 40 && item.advanceWidth > 0 && item.advanceWidth <= item.size * 24
    && item.horizontalScale === 1 && /^[0-9a-f]{6}$/i.test(item.color || '')
    && item.sourceIds?.length === 1 && item.sourceIds[0] === item.id
    && source?.id === item.id && source.text === item.text && sameRect(source.rect, item.rect)
    && source.disposition === 'editable' && !source.ocrUnverified && !source.encodingCorrections?.length;
}
function literal(item, continuation) {
  const positions = completeMathGlyphPositions(item, 17), parts = nativeMathRunParts(item);
  if (!positions || !parts || parts.length !== positions.length || parts.length < (continuation ? 4 : 5)
    || !Array.isArray(item.glyphPositions) || item.glyphPositions.length !== parts.length
    || positions.some((point, index) => item.glyphPositions[index]?.text !== point.text
      || !sameRect(item.glyphPositions[index]?.rect, point.rect))) return null;
  const relation = continuation ? 0 : 1;
  if (parts[relation].text !== '=' || !continuation && !letter(parts[0].text)) return null;
  const rhs = parts.slice(relation + 1);
  if (rhs.length % 2 !== 1 || rhs.some((part, index) => index % 2 ? !['+', '−'].includes(part.text) : !letter(part.text))) return null;
  return { item, parts, relation: parts[relation], ast: { type: 'row', children: parts.map(symbol) } };
}
function pair(first, second) {
  if (first.id === second.id || first.font !== second.font || first.color !== second.color
    || Math.abs(first.size - second.size) > .01) return null;
  const a = literal(first, false), b = literal(second, true), em = first.size;
  if (!a || !b || Math.abs(a.relation.rect.x - b.relation.rect.x) > .35
    || Math.abs(a.relation.baselineX - b.relation.baselineX) > .35
    || second.baseline - first.baseline < em * 1.2 || second.baseline - first.baseline > em * 2.5
    || second.rect.y - bottom(first.rect) < em * .2 || second.baselineX <= first.baselineX
    || second.baselineX - first.baselineX > em * 2.5) return null;
  const all = [...a.parts, ...b.parts];
  if (new Set(all.map(glyph => glyph.id)).size !== all.length) return null;
  const ast = { type: 'aligned-equations', rows: [a.ast, b.ast], sharedLhsSourceId: a.parts[0].id };
  const rows = [a, b].map(row => ({ ...row, region: { type: 'image', role: 'math', rect: { ...row.item.rect },
    sourceIds: [row.item.id], mathGlyphs: row.parts, mathStrokes: [], drawingIds: [], reasons: [] } }));
  return { rows, ast, glyphs: [first, second] };
}

export function sourceAlignedEquationRegion(region) {
  const proof = region?.sourceAlignedEquation;
  if (!keys(proof, ['version', 'members']) || proof.version !== 1 || !Array.isArray(proof.members)
    || proof.members.length !== 2 || region.type !== 'image' || region.role !== 'math'
    || proofConflicts.some(name => region[name] !== undefined && !(name === 'ocrMath' && region[name] === false))
    || region.mathStrokes?.length || region.drawingIds?.length || region.reasons?.length
    || region.backgroundPaintIndexes?.length || !Array.isArray(region.sourceIds) || !Array.isArray(region.mathGlyphs)
    || proof.members.some(member => !keys(member, memberKeys) || !clean(member.item, member.source))) return null;
  const items = proof.members.map(member => member.item), result = pair(...items);
  return result && sameRect(region.rect, union(items.map(item => item.rect)))
    && exact(region.sourceIds, items.map(item => item.id)) && exact(region.mathGlyphs, items) ? result : null;
}
export function sourceAlignedEquation(ast, region) {
  const source = sourceAlignedEquationRegion(region);
  return source && exact(ast, source.ast) ? source : null;
}
export function sourceAlignedRowContext(context) {
  if (!keys(context, ['parent', 'index']) || ![0, 1].includes(context.index)) return null;
  return sourceAlignedEquationRegion(context.parent)?.rows[context.index] || null;
}
export function sourceAlignedRow(ast, region, context) {
  const row = sourceAlignedRowContext(context);
  return row && exact(ast, row.ast) && exact(region, row.region) ? row : null;
}
export function sourceAlignedMeasurement(font, character, measured) {
  // Reuse the audited Latin metrics. The additional plus is from the same
  // verified Cambria Math cmap/hmtx (GID3397,1530/2048em); no font bytes.
  const metric = character === '+' && font === 'Cambria Math'
    ? { advanceAt1000: 1530 / 2048 * 1000 } : sourceUpperAttachmentMetric(font, character);
  return Boolean(metric && measured && ['width', 'actualBoundingBoxLeft', 'actualBoundingBoxRight',
    'actualBoundingBoxAscent', 'actualBoundingBoxDescent'].every(key => Number.isFinite(measured[key]) && Math.abs(measured[key]) <= 4096)
    && Math.abs(measured.width - metric.advanceAt1000) < .1
    && measured.actualBoundingBoxLeft + measured.actualBoundingBoxRight > 0
    && measured.actualBoundingBoxAscent + measured.actualBoundingBoxDescent > 0);
}

export function sourceAlignedEquationCandidates(text, graphics, sources, groups) {
  if (![text, graphics, sources, groups].every(Array.isArray)
    || [text, graphics, sources, groups].some(items => items.length > MAX_ITEMS)
    || text.some(item => !validRect(item?.rect)) || graphics.some(item => !validRect(item?.rect))) return [];
  const byId = new Map(), seen = new Set(), owners = new Map(); let work = 0, memberCount = 0;
  for (const source of sources) {
    if (!source || typeof source.id !== 'string') return [];
    byId.set(source.id, byId.has(source.id) ? null : source);
  }
  for (const item of text) { if (seen.has(item.id)) return []; seen.add(item.id); }
  for (const group of groups) {
    if (!Array.isArray(group) || (memberCount += group.length) > MAX_ITEMS * 2) return [];
    for (const item of group) { const own = owners.get(item) || []; own.push(group); owners.set(item, own); }
  }
  const query = spatialIndex([...text, ...graphics]), proposals = [], claims = new Map();
  for (const first of text) {
    if (!clean(first, byId.get(first.id)) || !literal(first, false)) continue;
    const search = { x: first.rect.x - first.size, y: first.rect.y,
      width: first.rect.width + first.size * 2, height: first.size * 4 };
    const near = query(search); work += near.length; if (work > MAX_WORK) return [];
    for (const second of near) {
      if (second === first || !clean(second, byId.get(second.id))) continue;
      const result = pair(first, second); if (!result) continue;
      const items = [first, second], own = new Set(items), rect = union(items.map(item => item.rect));
      if (result.rows.some(row => row.parts.some(part => byId.has(part.id)))) continue;
      const old = new Set(items.flatMap(item => owners.get(item) || [])); work += old.size;
      if (work > MAX_WORK) return [];
      if ([...old].some(group => group.some(item => !own.has(item)))) continue;
      const margin = first.size * .12, area = { x: rect.x - margin, y: rect.y - margin,
        width: rect.width + margin * 2, height: rect.height + margin * 2 };
      const visible = query(area); work += visible.length; if (work > MAX_WORK) return [];
      if (visible.some(item => !own.has(item) && overlaps(area, item.rect, .05))) continue;
      const proof = { version: 1, members: items.map(item => ({ item: structuredClone(item), source: structuredClone(byId.get(item.id)) })) };
      const region = { type: 'image', role: 'math', rect, sourceIds: items.map(item => item.id),
        mathGlyphs: result.glyphs, mathStrokes: [], drawingIds: [], reasons: [], sourceAlignedEquation: proof };
      if (!sourceAlignedEquationRegion(region)) continue;
      proposals.push({ items, proof, region, ast: result.ast });
      items.forEach(item => claims.set(item, (claims.get(item) || 0) + 1));
    }
  }
  return proposals.filter(proposal => proposal.items.every(item => claims.get(item) === 1));
}
