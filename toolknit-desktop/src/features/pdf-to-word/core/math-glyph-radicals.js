// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { bottom, right, union, contains, validRect } from './geometry.js';

/** A verified overbar owns the mathematical groups underneath it even when
 * their ink is too far from the thin rule for ordinary adjacency. */
export function joinGlyphRootGroups(groups, roots) {
  if (!roots.length) return groups;
  const parents = groups.map((_, index) => index);
  const owner = index => { while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; } return index; };
  let work = 0;
  for (const root of roots) {
    const ids = new Set([...root.glyphIds, ...root.strokeIds]), matched = [];
    for (let index = 0; index < groups.length; index++) {
      const group = groups[index];
      if ((work += group.length) > 16384) break;
      if (group.some(item => ids.has(item.id)) || group.every(item => contains(root.rect, item.rect, .7))) matched.push(owner(index));
    }
    if (work > 16384) break;
    if (matched.length) { const first = Math.min(...matched); matched.forEach(index => { parents[index] = first; }); }
  }
  const merged = new Map();
  groups.forEach((group, index) => { const id = owner(index); if (!merged.has(id)) merged.set(id, []); merged.get(id).push(...group); });
  return [...merged.values()];
}

/** Join only outline-verified, visible CMEX pieces and their complete top rule.
 * Component source ids remain owned by the single resulting radical. */
export function glyphRadicals(glyphs, strokes) {
  if (glyphs.length + strokes.length > 1024) return [];
  const parts = glyphs.filter(item => item.radicalPart && item.text === '\u221a' && !item.raster && !item.italic && !item.bold
    && !item.mathStyleUncertain && /^(?:[A-Z]{6}\+)?CMEX[1-9]\d?$/.test(item.font || '')
    && validRect(item.rect) && item.rect.width > 0 && item.rect.height > 0 && Number.isFinite(item.size) && item.size > 0
    && /^[0-9a-f]{6}$/i.test(item.color || ''));
  const roots = []; let work = 0;
  for (const cap of parts.filter(item => item.radicalPart === 'cap')) {
    if ((work += parts.length) > 16384) break;
    const same = item => item.font === cap.font && item.color === cap.color && Math.abs(item.size - cap.size) <= cap.size * .02;
    for (const hook of parts.filter(item => item.radicalPart === 'hook' && same(item) && item.rect.y > cap.rect.y)) {
      if ((work += parts.length + strokes.length) > 16384) break;
      const thickness = right(hook.rect) - cap.rect.x;
      if (thickness < cap.rect.width * .06 || thickness > cap.rect.width * .18 || bottom(hook.rect) - cap.rect.y > 200) continue;
      const stems = parts.filter(item => item.radicalPart === 'stem' && same(item) && item.rect.y > cap.rect.y
        && item.rect.y < hook.rect.y && Math.abs(item.rect.x - cap.rect.x) < thickness * .4
        && Math.abs(item.rect.width - thickness) < thickness * .3).sort((a, b) => a.rect.y - b.rect.y);
      if (stems.length > 32) continue;
      const sequence = [cap, ...stems, hook];
      if (sequence.some((item, index) => index && (item.rect.y - bottom(sequence[index - 1].rect) > Math.max(.1, thickness * .6)
        || bottom(sequence[index - 1].rect) - item.rect.y > Math.min(item.rect.height, sequence[index - 1].rect.height) * .25))) continue;
      const bars = strokes.filter(line => line.thin && !line.unmapped && (!line.path || line.path.complete)
        && line.color === cap.color && line.rect.height <= Math.min(1.5, cap.size * .12) && line.rect.width >= cap.size * .5
        && Math.abs(line.rect.y - cap.rect.y) <= Math.max(.12, line.rect.height)
        && Math.abs(line.rect.x - right(cap.rect)) <= thickness * 2);
      if (bars.length !== 1) continue;
      const bar = bars[0], y = bar.rect.y + bar.rect.height / 2;
      roots.push({ glyphs: sequence, glyphIds: sequence.map(item => item.id), strokes: [bar], strokeIds: [bar.id],
        rect: union([...sequence.map(item => item.rect), bar.rect]), height: bottom(hook.rect) - y,
        start: [hook.rect.x, hook.rect.y + hook.rect.height * .25], valley: [right(hook.rect) - thickness / 2, bottom(hook.rect)],
        barStart: [right(cap.rect), y], barEnd: [right(bar.rect), y] });
    }
  }
  const claims = new Map();
  for (const root of roots) for (const id of [...root.glyphIds, ...root.strokeIds]) claims.set(id, (claims.get(id) || 0) + 1);
  return roots.filter(root => [...root.glyphIds, ...root.strokeIds].every(id => claims.get(id) === 1));
}
