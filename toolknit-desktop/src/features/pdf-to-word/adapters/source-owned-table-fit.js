// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { contains, overlaps, validRect } from '../core/geometry.js';
import { positionedTextRuns, runOptions } from './text-layout.js';

const FONTS = new Set(['SimSun', 'SimHei', 'Microsoft YaHei', 'FangSong', 'KaiTi']);
const glyphs = line => positionedTextRuns(line, line.context).filter(run => run.kind === 'text');

function components(mask, width, height) {
  const seen = new Uint8Array(mask.length), result = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const queue = [start]; seen[start] = 1;
    let x = width, y = height, right = 0, bottom = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const at = queue[cursor], xx = at % width, yy = Math.floor(at / width);
      x = Math.min(x, xx); y = Math.min(y, yy); right = Math.max(right, xx + 1); bottom = Math.max(bottom, yy + 1);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = xx + dx, ny = yy + dy, next = ny * width + nx;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[next] && !seen[next]) {
          seen[next] = 1; queue.push(next);
        }
      }
    }
    result.push({ box: [x, y, right, bottom], count: queue.length });
  }
  return result;
}

function ordered(parts, minimum) {
  return parts.filter(part => part.count >= minimum).map(part => part.box)
    .sort((a, b) => a[0] + a[2] - b[0] - b[2] || a[1] + a[3] - b[1] - b[3]);
}

// Disconnected dots and a body can exchange their x-centre order after
// rasterization. Require a complete bijection instead of pairing by that order.
function componentEdge(output, source, pad, sx, sy) {
  if (output.length !== source.length || source.length > 8) return Infinity;
  const states = new Float64Array(1 << source.length); states.fill(Infinity); states[0] = 0;
  for (let used = 0; used < states.length; used++) {
    if (!Number.isFinite(states[used])) continue;
    let index = 0; for (let bits = used; bits; bits &= bits - 1) index++;
    if (index >= output.length) continue;
    for (let next = 0; next < source.length; next++) if (!(used & 1 << next)) {
      const cost = Math.max(...output[index].map((n, j) => Math.abs(n - pad - source[next][j]) / (j % 2 ? sy : sx)));
      const state = used | 1 << next; states[state] = Math.min(states[state], Math.max(states[used], cost));
    }
  }
  return states.at(-1);
}

function tableLines(items, out = [], table = null, cell = null) {
  for (const item of items || []) {
    if (item.type === 'table') {
      if (!item.aiInferred) for (const owner of item.cells || []) tableLines(owner.blocks, out, item, owner);
    } else if (item.columns) {
      for (const column of item.columns) tableLines(column.blocks, out, table, cell);
    } else {
      for (const line of item.lines || []) if (table && cell && line.items?.length) out.push({ table, cell, line });
    }
  }
  return out;
}

function allWords(items, out = []) {
  for (const item of items || []) {
    out.push(...item.words || []);
    for (const line of item.lines || []) allWords(line.items, out);
    for (const cell of item.cells || []) allWords(cell.blocks, out);
    for (const column of item.columns || []) allWords(column.blocks, out);
  }
  return out;
}

function plan(line, context, target, replacement) {
  const items = line.items.map(item => item.words?.includes(target)
    ? { ...item, words: item.words.map(word => word === target ? replacement : word) } : item);
  const next = { ...line, items, context };
  const runs = glyphs(next);
  const flat = items.flatMap(item => item.words?.length > 1 ? item.words : [item]);
  const index = flat.indexOf(replacement);
  return index >= 0 && runs.length === flat.length ? { runs, index, run: runs[index] } : null;
}

// Compare actual serialized coordinates and all neighbour run styles. The
// only allowed horizontal discrepancy is half of one writer twip; vertical
// positions and semantic run options are exact. This is not a formal score.
function sameNeighbours(before, after) {
  if (!before || !after || before.runs.length !== after.runs.length || before.index !== after.index) return false;
  return before.runs.every((run, index) => index === before.index || (
    Math.abs(run.x - after.runs[index].x) <= .5 / 20 + 1e-8
    && run.baseline === after.runs[index].baseline
    && run.position === after.runs[index].position
    && JSON.stringify(run.options) === JSON.stringify(after.runs[index].options)));
}

function paintRun(context, run) {
  const { item, x, baseline, spacing } = run, options = runOptions(item);
  context.font = `${options.italics ? 'italic ' : ''}${options.bold ? 'bold ' : ''}${options.size / 2}px "${options.font.ascii.replaceAll('"', '')}"`;
  context.fontKerning = 'none'; context.fillStyle = '#' + options.color; context.textBaseline = 'alphabetic';
  const horizontal = (options.scale || 100) / 100;
  context.save(); context.translate(x, baseline); context.scale(horizontal, 1);
  if ('letterSpacing' in context) {
    context.letterSpacing = spacing / 20 / horizontal + 'px'; context.fillText(item.text, 0, 0); context.letterSpacing = '0px';
  } else context.fillText(item.text, 0, 0); // Eligibility requires one Han scalar.
  context.restore();
}

/** Supplement established physical phases using their remaining edge-phase
 * allowance. The candidate keeps its existing semantic face and emphasis.
 * A complete white moat, parent/source/cell ownership and the actual cell-line
 * run plan replace the isolated-word/component-count heuristic in this branch.
 */
export function fitSourceOwnedTableGlyphs({ scene, data, createCanvas, accepted, allowance, maxChanges, check }) {
  const { pixels, width, height } = data, sx = width / scene.width, sy = height / scene.height;
  const sources = new Map((scene.sources || []).map(source => [source.id, source]));
  const words = allWords(scene.items), lines = tableLines(scene.items);
  const rules = (scene.rules || []).filter(rule => ['h', 'v'].includes(rule.axis) && Number.isFinite(rule.at + rule.from + rule.to));
  const hitsRule = rect => rules.some(rule => overlaps(rect, rule.axis === 'h'
    ? { x: rule.from, y: rule.at - .25, width: rule.to - rule.from, height: .5 }
    : { x: rule.at - .25, y: rule.from, width: .5, height: rule.to - rule.from }, 0));
  const spend = count => {
    check(); if (count > allowance.remaining) return false;
    allowance.remaining -= count; return true;
  };
  for (const { table, cell, line } of lines) for (const item of line.items) {
    check();
    if (!item.ocr || item.ocrNative || item.raster || item.italic || item.fontAssetId || !(item.ocrFontScore >= .65)
      || !FONTS.has(item.font) || !item.preciseInk || !validRect(cell.rect) || !validRect(item.rect)
      || !item.words?.length || item.words.length > 96 || line.items.some(run => run.type !== 'text' || !run.preciseInk)
      || item.sourceIds?.length !== 1 || !contains(cell.rect, item.rect, .25)) continue;
    const sourceRecord = sources.get(item.sourceIds[0]);
    if (!sourceRecord || sourceRecord.disposition !== 'editable' || sourceRecord.text !== item.text) continue;
    for (const word of item.words) {
      check();
      if (accepted.size >= maxChanges || allowance.remaining < 1) return allowance;
      if (accepted.has(word) || word.ocrPhysicalFit || word.fontAssetId || word.italic || word.ocrRuling || !word.preciseInk
        || !(word.confidence >= .99 && word.ocrGlyphScore >= 0 && word.ocrGlyphScore < .9)
        || !/^\p{Script=Han}$/u.test(word.text || '') || word.font !== item.font || Boolean(word.bold) !== Boolean(item.bold)
        || !validRect(word.rect) || word.rect.width < 3 || word.rect.height < 3 || word.rect.width > 30 || word.rect.height > 30) continue;
      const r = word.rect, expanded = { x: r.x - .4, y: r.y - .4, width: r.width + .8, height: r.height + .8 };
      if (!contains(cell.rect, expanded) || hitsRule(expanded)) { continue; }
      const x = Math.max(0, Math.floor(expanded.x * sx)), y = Math.max(0, Math.floor(expanded.y * sy));
      const w = Math.min(width, Math.ceil((expanded.x + expanded.width) * sx)) - x;
      const h = Math.min(height, Math.ceil((expanded.y + expanded.height) * sy)) - y;
      if (w < 3 || h < 3 || w * h > 20000 || !spend(w * h)) { continue; }
      const mask = new Uint8Array(w * h);
      let total = 0, bx = w, by = h, right = 0, bottom = 0, blocked = false;
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const at = ((y + yy) * width + x + xx) * 4, low = Math.min(pixels[at], pixels[at + 1], pixels[at + 2]);
        if (low >= 180) continue;
        if (Math.max(pixels[at], pixels[at + 1], pixels[at + 2]) - low > 30 || !xx || !yy || xx === w - 1 || yy === h - 1) blocked = true;
        mask[yy * w + xx] = 1; total++; bx = Math.min(bx, xx); by = Math.min(by, yy); right = Math.max(right, xx + 1); bottom = Math.max(bottom, yy + 1);
      }
      if (blocked || total < 10) { continue; }
      const tight = { x: (x + bx) / sx, y: (y + by) / sy, width: (right - bx) / sx, height: (bottom - by) / sy };
      // A separate branch requires direct evidence of an inflated CTC-derived
      // geometry estimate beyond the existing 1.25pt physical tolerance.
      // This cannot be triggered just by a low font signature score.
      if (Math.max(Math.abs(r.width - tight.width), Math.abs(r.height - tight.height),
        Math.abs(r.x - tight.x), Math.abs(r.y - tight.y)) <= 1.25) continue;
      const owners = table.cells.filter(owner => validRect(owner.rect) && contains(owner.rect, tight, .25));
      if (owners.length !== 1 || owners[0] !== cell || !contains(sourceRecord.rect, tight, .25) || !contains(item.rect, tight, .25)
        || words.some(other => other !== word && validRect(other.rect) && overlaps(tight, other.rect, .1))) { continue; }
      const sourceParts = components(mask, w, h), minimum = Math.max(4, Math.floor(total * .02)), sourceBoxes = ordered(sourceParts, minimum);
      if (sourceParts.reduce((sum, part) => sum + part.count, 0) !== total || sourceParts.length < 1 || sourceParts.length > 8
        || sourceParts.some(part => part.count < minimum) || !sourceBoxes.length) { continue; }
      let canvas, measure;
      try {
        const pad = Math.ceil(Math.max(sx, sy) * 2), pw = w + pad * 2, ph = h + pad * 2;
        canvas = createCanvas(pw, ph); measure = createCanvas(1, 1);
        const context = canvas.getContext('2d', { willReadFrequently: true }), mc = measure.getContext('2d');
        const originalPlan = plan(line, mc, word, word);
        if (!originalPlan) { continue; }
        const score = candidate => {
          if (!spend(pw * ph)) return null;
          const actual = plan(line, mc, word, candidate);
          if (!actual || !sameNeighbours(originalPlan, actual)) return null;
          context.setTransform(1, 0, 0, 1, 0, 0); context.fillStyle = '#fff'; context.fillRect(0, 0, pw, ph);
          context.setTransform(sx, 0, 0, sy, -x + pad, -y + pad); paintRun(context, actual.run);
          const painted = context.getImageData(0, 0, pw, ph).data, output = new Uint8Array(pw * ph);
          let ink = 0, common = 0, ox = pw, oy = ph, or = 0, ob = 0, clipped = false;
          for (let yy = 0; yy < ph; yy++) for (let xx = 0; xx < pw; xx++) {
            const at = (yy * pw + xx) * 4;
            if (Math.min(painted[at], painted[at + 1], painted[at + 2]) >= 180) continue;
            output[yy * pw + xx] = 1; ink++; ox = Math.min(ox, xx); oy = Math.min(oy, yy); or = Math.max(or, xx + 1); ob = Math.max(ob, yy + 1);
            if (!xx || !yy || xx === pw - 1 || yy === ph - 1) clipped = true;
            const rx = xx - pad, ry = yy - pad;
            if (rx >= 0 && ry >= 0 && rx < w && ry < h) common += mask[ry * w + rx];
          }
          const boxes = ordered(components(output, pw, ph), minimum);
          const edge = clipped ? Infinity : componentEdge(boxes, sourceBoxes, pad, sx, sy);
          return { f1: 2 * common / Math.max(1, total + ink), edge, count: boxes.length, sourcePixels: total,
            box: [x + ox - pad, y + oy - pad, x + or - pad, y + ob - pad] };
        };
        const initial = score(word);
        if (!initial || !(initial.edge > .75) || initial.f1 >= .9) continue;
        const output = runOptions(word);
        mc.font = `${output.italics ? 'italic ' : ''}${output.bold ? 'bold ' : ''}1000px "${output.font.ascii.replaceAll('"', '')}"`;
        mc.fontKerning = 'none';
        const metrics = mc.measureText(word.text), physicalHeight = (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) / 1000;
        const proposedSize = Math.round(tight.height / physicalHeight * 2) / 2;
        let winner = null, best = initial;
        for (const size of [proposedSize, proposedSize - .5, proposedSize + .5]) {
          if (!(size >= 4 && size <= 120)) continue;
          const center = Math.round(tight.width / ((metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight) / 1000 * size) * 100);
          for (const scale of [center, center - 1, center + 1]) for (const offset of [0, -.25, .25]) {
            if (!(scale >= 25 && scale <= 400)) continue;
            const candidate = { ...word, rect: { ...tight, y: tight.y + offset }, size, glyphScale: scale };
            const value = score(candidate);
            if (!value) { if (allowance.remaining < pw * ph) break; continue; }
            if (value.edge <= .75 && value.edge <= initial.edge - 1 / Math.max(sx, sy) + 1e-8
              && value.f1 >= Math.max(.75, initial.f1 + .05)
              && (winner === null || value.f1 > best.f1 || value.f1 === best.f1 && value.edge < best.edge)) {
              winner = candidate; best = value;
            }
          }
        }
        if (!winner) { continue; }
        check();
        const prior = word.ocrGlyphScore;
        // Only nonsemantic geometry fields change. Advance, original baseline,
        // source ids, color, font face/family, emphasis and neighbours remain.
        Object.assign(word, { rect: winner.rect, size: winner.size, glyphScale: winner.glyphScale,
          ocrPhysicalFit: { phase: 'source-owned-table', priorGlyphScore: prior, before: initial.f1, after: best.f1,
            edgeBefore: Number.isFinite(initial.edge) ? initial.edge : null, edgeAfter: best.edge,
            sourcePixels: total, sourceComponents: sourceParts.length } });
        accepted.add(word);
      } finally {
        if (canvas) canvas.width = canvas.height = 0;
        if (measure) measure.width = measure.height = 0;
      }
    }
  }
  return allowance;
}
