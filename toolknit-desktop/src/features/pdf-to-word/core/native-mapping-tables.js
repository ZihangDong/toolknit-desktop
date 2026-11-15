// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { union, median, contains, overlaps, right, bottom, validRect } from './geometry.js';
import { buildParagraphs, lineText } from './text.js';

const sameBox = (a, b) => validRect(a) && validRect(b)
  && ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < .001);
const family = item => String(item.sourceFont || item.font || '').replace(/^[A-Z]{6}\+/, '');
const mono = item => /^(?:CourierNewPSMT|Courier|CourierNew|Courier New|CMTT(?:[5-9]|1[012]))$/i.test(family(item));

/** Exact leading is limited to the source-verified native faces of a mapping
 * row. Merely attaching a row flag cannot enable it for unknown/scan text. */
export function nativeMappingRowCandidate(item) {
  return item && item.preciseInk && !item.raster && !item.ocr && !item.bold && !item.italic
    && !item.alphabet && !item.mathStyleUncertain && !item.radicalPart && !item.delimiterPart && !item.fontAssetId
    && typeof item.text === 'string' && item.text.length > 0 && item.text.length <= 128 && !/[\r\n\t]/u.test(item.text)
    && validRect(item.rect) && Number.isFinite(item.baseline) && Number.isFinite(item.size) && item.size >= 5 && item.size <= 20
    && (item.glyphScale === undefined || Number.isFinite(item.glyphScale) && item.glyphScale >= 25 && item.glyphScale <= 400)
    && Math.abs((item.horizontalScale ?? 1) - 1) < .001
    && (mono(item) && mono({ font: item.font })
      || /^(?:TimesNewRomanPSMT|Times New Roman)$/i.test(family(item)) && /^(?:[A-Z]{6}\+)?(?:TimesNewRomanPSMT|Times New Roman)$/i.test(item.font || '')
      || family(item) === 'SimSun' && /^(?:[A-Z]{6}\+)?SimSun$/i.test(item.font || '')
      || family(item) === 'XITSMath-Regular' && item.text === '⇒' && item.nativeCalibrated === true
        && item.font === 'Cambria Math' && Number.isFinite(item.sourceSize) && item.sourceSize > 0);
}

function mappingMarker(item, sources, fitArrow) {
  let glyph = item;
  if (item.type === 'image' && item.role === 'math' && item.mathGlyphs?.length === 1
    && !item.mathStrokes?.length && !item.drawingIds?.length && !item.reasons?.length && !item.backgroundPaintIndexes?.length) glyph = item.mathGlyphs[0];
  const source = sources.get(glyph.id);
  if (glyph.text !== '⇒' || !validRect(glyph.rect) || glyph.raster || glyph.ocr || glyph.bold || glyph.italic || !glyph.preciseInk
    || glyph.alphabet || glyph.mathStyleUncertain || glyph.radicalPart || glyph.delimiterPart
    || family(glyph) !== 'XITSMath-Regular' || !source || source.text !== glyph.text || !sameBox(source.rect, glyph.rect)
    || item.sourceIds?.length !== 1 || item.sourceIds[0] !== source.id) return null;
  if (item.type === 'text') return source.disposition === 'editable' && nativeMappingRowCandidate(item) ? item : null;
  if (source.disposition !== 'visible-image' || !sameBox(item.rect, glyph.rect)) return null;
  const fitted = fitArrow(glyph);
  if (!fitted) return null;
  const candidate = { ...glyph, ...fitted, type: 'text', sourceIds: [source.id], order: item.order,
    sourceFont: glyph.font, sourceSize: glyph.size, nativeCalibrated: true };
  return nativeMappingRowCandidate(candidate) ? candidate : null;
}

/** Return atomic plans for repeated two-sided mappings with a separate arrow
 * column. Spelling, original ink and source identities never come from a grid.
 * Geometry/measurement are injected; no Canvas or platform runtime lives here. */
export function nativeMappingTablePlans(scene, { fitArrow, measureLine, excludedIds = [] } = {}) {
  if (!scene || scene.rasterPage || !Array.isArray(scene.items) || scene.items.length > 3000
    || !Array.isArray(scene.sources) || !Array.isArray(scene.rules) || scene.rules.length > 3000
    || scene.rules.some(rule => !rule || !['h', 'v'].includes(rule.axis) || !Number.isFinite(rule.at + rule.from + rule.to) || rule.to <= rule.from)
    || typeof fitArrow !== 'function' || typeof measureLine !== 'function'
    || !validRect({ x: 0, y: 0, width: scene.width, height: scene.height })) return [];
  const sources = new Map(scene.sources.map(source => [source.id, source]));
  if (sources.size !== scene.sources.length || scene.items.some(item => !item || !validRect(item.rect))) return [];
  const bounds = { x: 0, y: 0, width: scene.width, height: scene.height }, excluded = new Set(excludedIds), candidates = [];
  for (const original of scene.items) {
    const arrow = mappingMarker(original, sources, fitArrow);
    if (arrow) candidates.push({ original, arrow });
    if (candidates.length > 64) return [];
  }
  candidates.sort((a, b) => a.arrow.baseline - b.arrow.baseline);
  const groups = []; let current = [];
  for (const candidate of candidates) {
    const last = current.at(-1), size = candidate.arrow.sourceSize;
    if (last && (candidate.arrow.baseline - last.arrow.baseline > size * 2.3 || Math.abs(candidate.arrow.rect.x - last.arrow.rect.x) > .5)) {
      groups.push(current); current = [];
    }
    current.push(candidate);
  }
  if (current.length) groups.push(current);
  const plans = [], claimed = new Set(); let cellsHeld = 0;
  for (const group of groups) {
    if (group.length < 3 || group.length > 50 || cellsHeld + group.length * 3 > 192) continue;
    const id = group[0].arrow.id + ':mapping-table';
    if (excluded.has(id)) continue;
    const pitch = median(group.slice(1).map((value, index) => value.arrow.baseline - group[index].arrow.baseline));
    const size = median(group.map(value => value.arrow.sourceSize));
    if (!(pitch > size * 1.25 && pitch < size * 2.3) || group.some((value, index) =>
      Math.abs(value.arrow.baseline - group[0].arrow.baseline - index * pitch) > .1 || Math.abs(value.arrow.sourceSize - size) > .01)) continue;
    // An unverified arrow immediately outside the group may be a missing edge
    // row of the same table. Never call its remaining rows a complete grid.
    if (scene.items.some(item => {
      const glyph = item.text === '⇒' ? item : item.mathGlyphs?.length === 1 && item.mathGlyphs[0]?.text === '⇒' ? item.mathGlyphs[0] : null;
      return glyph && validRect(glyph.rect) && Math.abs(glyph.rect.x - group[0].arrow.rect.x) <= .5
        && (Math.abs(glyph.baseline - group[0].arrow.baseline + pitch) <= .1
          || Math.abs(glyph.baseline - group.at(-1).arrow.baseline - pitch) <= .1);
    })) continue;
    const arrows = new Set(group.map(value => value.original)), rows = []; let valid = true;
    for (const value of group) {
      const members = scene.items.filter(item => !arrows.has(item) && item.type === 'text'
        && item.rect.y + item.rect.height / 2 > value.arrow.baseline - pitch * .7
        && item.rect.y + item.rect.height / 2 < value.arrow.baseline + pitch * .3);
      const left = members.filter(item => right(item.rect) < value.arrow.rect.x), rhs = members.filter(item => item.rect.x > right(value.arrow.rect));
      if (!left.length || left.length > 4 || !rhs.length || rhs.length > 32 || members.length !== left.length + rhs.length
        || !left.every(mono) || !/[A-Za-z]/u.test(left.map(item => item.text).join(''))) { valid = false; break; }
      for (const item of members) {
        const source = item.sourceIds?.length === 1 && sources.get(item.sourceIds[0]);
        const raised = item.size < size * .85 && value.arrow.baseline - item.baseline > 0 && value.arrow.baseline - item.baseline < size * .6;
        if (!nativeMappingRowCandidate(item) || item.mathGlyphs || !source || source.disposition !== 'editable' || source.id !== item.id
          || source.text !== item.text || !sameBox(source.rect, item.rect) || claimed.has(item) || !contains(bounds, item.rect, 0)
          || item.color !== value.arrow.color || !(Math.abs(item.baseline - value.arrow.baseline) < .05 || raised)) { valid = false; break; }
      }
      if (!valid) break;
      left.sort((a, b) => a.rect.x - b.rect.x); rhs.sort((a, b) => a.rect.x - b.rect.x);
      rows.push({ ...value, left, rhs });
    }
    if (!valid || rows.some(row => Math.abs(row.left[0].rect.x - rows[0].left[0].rect.x) > .5)) continue;
    const xs = [Math.min(...rows.flatMap(row => row.left.map(item => item.rect.x))) - 2,
      (Math.max(...rows.flatMap(row => row.left.map(item => right(item.rect)))) + Math.min(...rows.map(row => row.arrow.rect.x))) / 2,
      (Math.max(...rows.map(row => right(row.arrow.rect))) + Math.min(...rows.flatMap(row => row.rhs.map(item => item.rect.x)))) / 2,
      Math.max(...rows.flatMap(row => row.rhs.map(item => right(item.rect)))) + 2];
    const rowLines = rows.map(row => [row.left, [row.arrow], row.rhs].map(items => ({ id: items[0].id + ':mapping-line', type: 'line',
      nativeMappingRow: true, text: lineText(items), items, rect: union(items.map(item => item.rect)), baseline: row.arrow.baseline,
      size: Math.max(...items.map(item => item.size)), sourceIds: items.flatMap(item => item.sourceIds) })));
    const heights = rowLines.map(lines => lines.map(line => {
      const measured = measureLine(line);
      return measured && Number.isFinite(measured.height + measured.baselineOffset) && measured.height > 0
        && measured.baselineOffset >= 0 && measured.baselineOffset <= measured.height
        ? { top: line.baseline - measured.baselineOffset, bottom: line.baseline - measured.baselineOffset + measured.height } : null;
    }));
    if (heights.flat().some(value => !value)) continue;
    const extents = heights.map(row => ({ top: Math.min(...row.map(value => value.top)), bottom: Math.max(...row.map(value => value.bottom)) }));
    if (extents.some((value, index) => index && value.top < extents[index - 1].bottom + .1)) continue;
    const ys = [Math.min(extents[0].top, Math.min(...rowLines[0].map(line => line.rect.y)) - 2)];
    for (let index = 1; index < rows.length; index++) ys.push((extents[index - 1].bottom + extents[index].top) / 2);
    ys.push(Math.max(extents.at(-1).bottom, Math.max(...rowLines.at(-1).map(line => bottom(line.rect))) + 2));
    const rect = { x: xs[0], y: ys[0], width: xs.at(-1) - xs[0], height: ys.at(-1) - ys[0] };
    const cells = [], members = new Set(group.map(value => value.original));
    for (let row = 0; row < rows.length; row++) for (let col = 0; col < 3; col++) {
      const cellRect = { x: xs[col], y: ys[row], width: xs[col + 1] - xs[col], height: ys[row + 1] - ys[row] }, line = rowLines[row][col];
      if (!contains(cellRect, line.rect, 0)) { valid = false; break; }
      cells.push({ row, col, rowSpan: 1, colSpan: 1, rect: cellRect, sourceIds: [...line.sourceIds], blocks: buildParagraphs([line], cellRect) });
      line.items.forEach(item => { if (item !== rows[row].arrow) members.add(item); });
    }
    const ids = cells.flatMap(cell => cell.sourceIds);
    if (!valid || new Set(ids).size !== ids.length || !contains(bounds, rect, 0)
      || scene.items.some(item => !members.has(item) && overlaps(rect, item.rect, .01))
      || scene.rules.some(rule => rule.axis === 'h'
        ? rule.at > rect.y && rule.at < bottom(rect) && rule.from < right(rect) && rule.to > rect.x
        : rule.at > rect.x && rule.at < right(rect) && rule.from < bottom(rect) && rule.to > rect.y)) continue;
    const table = { id, type: 'table', borderless: true, nativeMappingBaseline: true, rect, rows: rows.length,
      columnWidths: xs.slice(1).map((value, index) => value - xs[index]), rowHeights: ys.slice(1).map((value, index) => value - ys[index]),
      cells, sourceIds: ids, evidence: ['regular-native-arrow-mappings', 'independent-monospace-left-column'] };
    plans.push({ table, members, recoveredSources: group.filter(value => value.original.type === 'image').map(value => value.arrow.sourceIds[0]) });
    cellsHeld += cells.length; members.forEach(item => claimed.add(item));
  }
  return plans;
}
