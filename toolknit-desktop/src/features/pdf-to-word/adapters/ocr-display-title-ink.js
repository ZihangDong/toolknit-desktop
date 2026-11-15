// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { inferDocument, leafBlocks } from "../core/layout.js";
import { ocrFrameLayout } from "../core/ocr-frame-layout.js";
import { positionedTextRuns, runOptions } from "./text-layout.js";
const adapters = Object.freeze({
  inferDocument,
  leafBlocks,
  ocrFrameLayout,
  positionedTextRuns,
  runOptions
});
const valid = (r) => r && [
  "x",
  "y",
  "width",
  "height"
].every((k) => Number.isFinite(r[k])) && r.width > 0 && r.height > 0;
const overlaps = (a, b, p = 0) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) - p && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y) - p;
const contains = (a, b, p = .25) => valid(a) && valid(b) && b.x >= a.x - p && b.y >= a.y - p && b.x + b.width <= a.x + a.width + p && b.y + b.height <= a.y + a.height + p;
const median = (a) => {
  const b = [...a].sort((x, y) => x - y);
  return b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2;
};
function parts(mask, w, h, check) {
  const seen = new Uint8Array(mask.length), result = [], queue = new Int32Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let count = 1, cursor = 0, x = w, y = h, r = 0, b = 0;
    queue[0] = i;
    seen[i] = 1;
    while (cursor < count) {
      if (!(cursor % 512)) check();
      const at = queue[cursor++], xx = at % w, yy = Math.floor(at / w);
      x = Math.min(x, xx);
      y = Math.min(y, yy);
      r = Math.max(r, xx + 1);
      b = Math.max(b, yy + 1);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = xx + dx, ny = yy + dy, j = ny * w + nx;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[j] && !seen[j]) {
          seen[j] = 1;
          queue[count++] = j;
        }
      }
    }
    result.push({
      box: [
        x,
        y,
        r,
        b
      ],
      count
    });
  }
  return result;
}
function componentEdge(a, b, sx, sy) {
  if (a.length !== b.length || a.length > 8) return Infinity;
  const costs = new Float64Array(1 << b.length);
  costs.fill(Infinity);
  costs[0] = 0;
  for (let used = 0; used < costs.length; used++) {
    if (!Number.isFinite(costs[used])) continue;
    let i = 0;
    for (let n = used; n; n &= n - 1) i++;
    if (i >= a.length) continue;
    for (let j = 0; j < b.length; j++) if (!(used & 1 << j)) {
      const edge = Math.max(...a[i].box.map((n, k) => Math.abs(n - b[j].box[k]) / (k % 2 ? sy : sx)));
      costs[used | 1 << j] = Math.min(costs[used | 1 << j], Math.max(costs[used], edge));
    }
  }
  return costs.at(-1);
}
function independent(items, out = []) {
  for (const item of items || []) {
    if (["table", "option-grid"].includes(item.type)) continue;
    if (item.words?.length) out.push(item);
    for (const col of item.columns || []) independent(col.blocks, out);
    for (const line of item.lines || []) independent(line.items, out);
  }
  return out;
}
function allWords(items, out = []) {
  for (const item of items || []) {
    out.push(...item.words || []);
    for (const x of item.cells || []) allWords(x.blocks, out);
    for (const x of item.columns || []) allWords(x.blocks, out);
    for (const x of item.lines || []) allWords(x.items, out);
  }
  return out;
}
function actualPlan(scene, owner, target, replacement, mc, a) {
  const update = (node) => {
    if (node === owner) return {
      ...node,
      words: node.words.map((w) => w === target ? {
        ...replacement,
        __fitProbe: true
      } : w)
    };
    const out = { ...node };
    for (const key of [
      "items",
      "blocks",
      "lines",
      "cells",
      "columns"
    ]) if (Array.isArray(node[key])) out[key] = node[key].map(update);
    return out;
  };
  const page = a.inferDocument([{
    ...scene,
    items: scene.items.map(update)
  }], { preserveGeometry: true }).pages[0], frames = a.ocrFrameLayout(page), runs = [];
  for (const block of a.leafBlocks([
    ...page.header,
    ...page.blocks,
    ...page.footer
  ])) for (const line of block.lines || []) for (const chunk of frames.get(line.id) || [line]) for (const run of a.positionedTextRuns(chunk, mc)) if (run.kind === "text") runs.push({
    ...run,
    frame: chunk.id
  });
  const found = runs.flatMap((r, i) => r.item.__fitProbe ? [i] : []);
  return found.length === 1 ? {
    runs,
    index: found[0],
    run: runs[found[0]]
  } : null;
}
function sameNeighbors(before, after) {
  const shape = (r) => ({
    text: r.item.text,
    x: r.x,
    baseline: r.baseline,
    position: r.position,
    spacing: r.spacing,
    options: r.options,
    frame: r.frame
  });
  return before && after && before.index === after.index && before.runs.length === after.runs.length && before.runs.every((r, i) => i === before.index || JSON.stringify(shape(r)) === JSON.stringify(shape(after.runs[i])));
}
function paint(ctx, run, a) {
  const o = a.runOptions(run.item), scale = (o.scale || 100) / 100;
  ctx.font = `${o.italics ? "italic " : ""}${o.bold ? "bold " : ""}${o.size / 2}px "${o.font.ascii}"`;
  ctx.fontKerning = "none";
  ctx.fillStyle = "#" + o.color;
  ctx.textBaseline = "alphabetic";
  ctx.save();
  ctx.translate(run.x, run.baseline);
  ctx.scale(scale, 1);
  if ("letterSpacing" in ctx) {
    ctx.letterSpacing = run.spacing / 20 / scale + "px";
    ctx.fillText(run.item.text, 0, 0);
    ctx.letterSpacing = "0px";
  } else ctx.fillText(run.item.text, 0, 0);
  ctx.restore();
}
export function fitOcrDisplayTitleInk({ scene, data, createCanvas, allowance, accepted, maxChanges, check = () => {} } = {}) {
  const a = adapters;
  if (!scene || !data || typeof createCanvas !== "function" || !allowance || !Number.isInteger(allowance.remaining) || allowance.remaining < 1 || allowance.remaining > 4e6 || !(accepted instanceof Set) || !Number.isInteger(maxChanges) || maxChanges < 1 || maxChanges > 128 || accepted.size >= maxChanges) return;
  const { pixels, width, height } = data, sx = width / scene.width, sy = height / scene.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16e6 || pixels?.length !== width * height * 4 || !(sx > 0 && sy > 0) || !Number.isFinite(sx + sy)) return;
  const spend = (n) => {
    check();
    if (!Number.isInteger(n) || n < 1 || n > allowance.remaining) return false;
    allowance.remaining -= n;
    return true;
  };
  const sources = new Map((scene.sources || []).map((s) => [s.id, s])), words = allWords(scene.items), staged = [];
  const hitsRule = (r) => (scene.rules || []).some((rule) => ["h", "v"].includes(rule.axis) && Number.isFinite(rule.at + rule.from + rule.to) && overlaps(r, rule.axis === "h" ? {
    x: rule.from,
    y: rule.at - .25,
    width: rule.to - rule.from,
    height: .5
  } : {
    x: rule.at - .25,
    y: rule.from,
    width: .5,
    height: rule.to - rule.from
  }));
  let measure;
  try {
    measure = createCanvas(1, 1);
    const mc = measure.getContext("2d");
    for (const owner of independent(scene.items)) {
      check();
      if (staged.length >= 2 || accepted.size + staged.length >= maxChanges) break;
      const group = owner.words || [], source = owner.sourceIds?.length === 1 ? sources.get(owner.sourceIds[0]) : null;
      if (!owner.ocr || owner.ocrNative || owner.raster || owner.fontAssetId || owner.italic || !owner.preciseInk || owner.font !== "SimSun" || !(owner.ocrFontScore >= .9) || owner.bold || group.length < 4 || group.length > 12 || !valid(owner.rect) || owner.rect.y > scene.height * .35 || Math.abs(owner.rect.x + owner.rect.width / 2 - scene.width / 2) > scene.width * .1 || owner.role === "math" || !source || source.disposition !== "editable" || source.text !== owner.text || group.some((w) => !/^\p{Script=Han}$/u.test(w.text || "") || w.font !== owner.font || w.bold || w.italic || w.fontAssetId || w.ocrRuling || !w.preciseInk || !(w.confidence >= .99) || !valid(w.rect) || !Number.isFinite(w.size) || w.size < 32 || w.size > 72)) continue;
      const candidates = group.filter((w) => !accepted.has(w) && !w.ocrDisplayTitleFit && !w.ocrPhysicalFit && w.ocrGlyphScore >= .92 && a.runOptions(w).size / 2 - median(group.filter((x) => x !== w).map((x) => a.runOptions(x).size / 2)) >= 1);
      if (!candidates.length) continue;
      const samples = new Map();
      let incomplete = false;
      for (const word of group) {
        check();
        const r = word.rect, pad = 2, x = Math.floor((r.x - pad) * sx), y = Math.floor((r.y - pad) * sy), right = Math.ceil((r.x + r.width + pad) * sx), bottom = Math.ceil((r.y + r.height + pad) * sy), w = right - x, h = bottom - y;
        if (x < 0 || y < 0 || right > width || bottom > height || w < 3 || h < 3 || w * h > 9e4 || !spend(w * h)) {
          incomplete = true;
          break;
        }
        const mask = new Uint8Array(w * h);
        let ink = 0, bx = w, by = h, br = 0, bb = 0, bad = false;
        for (let yy = 0; yy < h; yy++) {
          check();
          for (let xx = 0; xx < w; xx++) {
            const at = ((y + yy) * width + x + xx) * 4, low = Math.min(pixels[at], pixels[at + 1], pixels[at + 2]);
            if (pixels[at + 3] !== 255) bad = true;
            if ((!xx || !yy || xx === w - 1 || yy === h - 1) && low < 245) bad = true;
            if (low >= 180) continue;
            if (Math.max(pixels[at], pixels[at + 1], pixels[at + 2]) - low > 30) bad = true;
            mask[yy * w + xx] = 1;
            ink++;
            bx = Math.min(bx, xx);
            by = Math.min(by, yy);
            br = Math.max(br, xx + 1);
            bb = Math.max(bb, yy + 1);
          }
        }
        const cs = parts(mask, w, h, check), tight = {
          x: (x + bx) / sx,
          y: (y + by) / sy,
          width: (br - bx) / sx,
          height: (bb - by) / sy
        };
        if (bad || ink < 500 || !cs.length || cs.length > 8 || cs.some((p) => p.count < Math.max(4, ink * .02)) || !contains(owner.rect, tight) || !contains(source.rect, tight) || hitsRule(tight) || words.some((other) => other !== word && valid(other.rect) && overlaps(tight, other.rect, .1))) {
          incomplete = true;
          break;
        }
        mc.font = "1000px \"SimSun\"";
        mc.fontKerning = "none";
        const m = mc.measureText(word.text), outlineHeight = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
        if (![
          m.width,
          m.fontBoundingBoxAscent,
          m.fontBoundingBoxDescent,
          m.actualBoundingBoxLeft,
          m.actualBoundingBoxRight,
          m.actualBoundingBoxAscent,
          m.actualBoundingBoxDescent
        ].every(Number.isFinite) || Math.abs(m.width - 1e3) > 1 || Math.abs(m.fontBoundingBoxAscent / 1e3 - .859375) > .001 || Math.abs(m.fontBoundingBoxDescent / 1e3 - .140625) > .001 || m.actualBoundingBoxLeft + m.actualBoundingBoxRight <= 0 || outlineHeight <= 0) {
          incomplete = true;
          break;
        }
        samples.set(word, {
          x,
          y,
          w,
          h,
          mask,
          ink,
          bx,
          by,
          br,
          bb,
          parts: cs,
          tight,
          sourceEm: tight.height / (outlineHeight / 1e3)
        });
      }
      if (incomplete) continue;
      const ems = [...samples.values()].map((s) => s.sourceEm), em = median(ems);
      if (!(em >= 32 && em <= 72) || Math.max(...ems) - Math.min(...ems) > Math.min(1.5, em * .03)) continue;
      for (const word of candidates) {
        check();
        if (staged.length >= 2 || accepted.size + staged.length >= maxChanges) break;
        const s = samples.get(word), common = median(group.filter((w) => w !== word).map((w) => samples.get(w).sourceEm));
        if (Math.abs(s.sourceEm - common) > .75 || a.runOptions(word).size / 2 - common > 2) continue;
        const before = actualPlan(scene, owner, word, word, mc, a);
        if (!before) continue;
        let canvas;
        try {
          canvas = createCanvas(s.w, s.h);
          const cx = canvas.getContext("2d", { willReadFrequently: true });
          const score = (candidate) => {
            if (!spend(s.w * s.h)) return null;
            const after = actualPlan(scene, owner, word, candidate, mc, a);
            if (!sameNeighbors(before, after)) return null;
            cx.setTransform(1, 0, 0, 1, 0, 0);
            cx.fillStyle = "#fff";
            cx.fillRect(0, 0, s.w, s.h);
            cx.setTransform(sx, 0, 0, sy, -s.x, -s.y);
            paint(cx, after.run, a);
            const rgba = cx.getImageData(0, 0, s.w, s.h).data, mask = new Uint8Array(s.w * s.h);
            let ink = 0, common = 0, bx = s.w, by = s.h, br = 0, bb = 0, border = false;
            for (let yy = 0; yy < s.h; yy++) {
              check();
              for (let xx = 0; xx < s.w; xx++) {
                const at = yy * s.w + xx;
                if (Math.min(rgba[at * 4], rgba[at * 4 + 1], rgba[at * 4 + 2]) >= 180) continue;
                mask[at] = 1;
                ink++;
                common += s.mask[at];
                bx = Math.min(bx, xx);
                by = Math.min(by, yy);
                br = Math.max(br, xx + 1);
                bb = Math.max(bb, yy + 1);
                border ||= !xx || !yy || xx === s.w - 1 || yy === s.h - 1;
              }
            }
            const ps = parts(mask, s.w, s.h, check);
            if (border || !ink || ps.some((p) => p.count < Math.max(4, s.ink * .02))) return null;
            return {
              f1: 2 * common / (ink + s.ink),
              bx,
              by,
              br,
              bb,
              edge: Math.max(Math.abs(bx - s.bx) / sx, Math.abs(by - s.by) / sy, Math.abs(br - s.br) / sx, Math.abs(bb - s.bb) / sy),
              componentEdge: componentEdge(ps, s.parts, sx, sy)
            };
          };
          const initial = score(word);
          if (!initial || initial.edge <= .5) continue;
          const dx = (s.bx - initial.bx) / sx, dy = (s.by - initial.by) / sy, scale = Math.round((word.glyphScale || 100) * (s.br - s.bx) / (initial.br - initial.bx));
          if (Math.max(Math.abs(dx), Math.abs(dy)) > 1 || Math.abs(scale - (word.glyphScale || 100)) > 4 || scale < 25 || scale > 400) continue;
          const candidate = {
            ...word,
            rect: {
              ...word.rect,
              x: word.rect.x + dx,
              y: word.rect.y + dy
            },
            glyphScale: scale
          };
          const value = score(candidate);
          if (!value || value.f1 < .9 || value.f1 <= initial.f1 || value.edge > .5 || value.componentEdge > .75 || value.edge > initial.edge - 1 / Math.max(sx, sy) + 1e-8) continue;
          staged.push({
            word,
            candidate,
            evidence: {
              phase: "display-title-actual-template",
              commonEm: common,
              sourceEm: s.sourceEm,
              before: initial.f1,
              after: value.f1,
              edgeBefore: initial.edge,
              edgeAfter: value.edge,
              componentEdge: value.componentEdge
            }
          });
        } finally {
          if (canvas) canvas.width = canvas.height = 0;
        }
      }
    }
    check();
    for (const entry of staged) {
      Object.assign(entry.word, entry.candidate, { ocrDisplayTitleFit: entry.evidence });
      accepted.add(entry.word);
    }
  } finally {
    if (measure) measure.width = measure.height = 0;
  }
}
