// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { inferDocument } from '../core/layout.js';
import { validRect, overlaps, spatialIndex } from '../core/geometry.js';
import { textMetrics } from './text-layout.js';
import { drawResultText } from './text-rendering.js';

const legacyHei = name => /^FZH4(?:FW|JW)--GB1-[0-9]+$/i.test(name || '');
const centeredItems = new WeakSet(), balancedWords = new WeakSet();
function* texts(items, includeTables = true) {
  for (const item of items || []) {
    if (item.type === 'text') yield item;
    for (const line of item.lines || []) yield* texts(line.items, includeTables);
    for (const child of item.columns || []) yield* texts(child.blocks, includeTables);
    if (includeTables || item.type !== 'table' || item.aiInferred)
      for (const child of item.cells || []) yield* texts(child.blocks, includeTables);
  }
}

/** An unembedded legacy Hei face has proportional declared widths, whereas
 * its Windows substitute has half-em Latin advances. Keep the PDF advances
 * and center the substitute within them; never apply this to embedded fonts,
 * unknown faces, OCR, tables, symbols or an unavailable system substitute. */
export function prepareNativeFallback(scene, fonts, context, check = () => {}) {
  if (!context || !scene || !fonts) return scene;
  const records = Object.values(fonts);
  const names = new Set(records.filter(font => font?.missingFile === true && !font.data
    && !font.type3 && !font.vertical && legacyHei(font.name)).map(font => font.name));
  for (const font of records) if (font && (font.missingFile !== true || font.data || font.type3 || font.vertical)) names.delete(font.name);
  if (!names.size) return scene;
  const oldFont = context.font, oldKerning = context.fontKerning;
  try {
    context.font = '1000px "SimHei"'; context.fontKerning = 'none';
    const probe = context.measureText('S');
    if (!Number.isFinite(probe.width + probe.actualBoundingBoxRight + probe.actualBoundingBoxAscent)
      || Math.abs(probe.width - 500) > 1 || Math.abs(probe.actualBoundingBoxRight - 453.125) > 2
      || Math.abs(probe.actualBoundingBoxAscent - 703.125) > 2) return scene;
    // Only native top-level display runs are proven for this substitute. Real
    // table cells and nested content retain their existing fitter/preflight.
    for (const item of scene.items) {
      check();
      if (item.type !== 'text' || item.ocr || item.raster || item.alphabet || item.italic || item.fontAssetId
        || !names.has(item.font) || !validRect(item.rect) || !(item.size >= 20 && item.size <= 120)
        || !Number.isFinite(item.baseline) || item.sourceIds?.length !== 1 || item.sourceIds[0] !== item.id
        || !/^[A-Za-z]+(?: +[A-Za-z]+)*$/.test(item.text || '')
        || !item.glyphPositions?.length || item.glyphPositions.length > 120
        || item.glyphPositions.map(g => g.text).join('') !== item.text.replace(/ /g, '')
        || item.glyphPositions.some(g => !/^[A-Za-z]$/.test(g.text || '') || !validRect(g.rect)
          || !(g.rect.width > 0 && g.rect.width <= item.size * 2))) continue;
      const words = item.glyphPositions.map(g => {
        const word = { text: g.text, font: 'SimHei', fontFamily: 'SimHei', size: item.size,
          bold: true, italic: false, baseline: item.baseline, preciseInk: true };
        const normal = textMetrics(word, context), origin = g.rect.x + Math.max(0, g.rect.width - normal.width) / 2;
        word.glyphScale = Math.max(25, Math.min(100, Math.round(g.rect.width / normal.width * 100)));
        const m = textMetrics(word, context), scale = Math.round(item.size * 2) / 2 / 1000 * word.glyphScale / 100;
        const right = context.measureText(g.text).actualBoundingBoxRight * scale;
        Object.assign(word, { baselineX: origin, advanceWidth: g.rect.width,
          rect: { x: origin - m.left, y: item.baseline - m.ascent,
            width: m.left + right, height: m.ascent + m.inkDescent } });
        return word;
      });
      if (words.some(word => !validRect(word.rect) || !(word.rect.width > 0 && word.rect.height > 0))) continue;
      Object.assign(item, { sourceFont: item.font, sourceSize: item.size, sourceFontMetrics: item.fontMetrics,
        fontMetrics: undefined, font: 'SimHei', fontFamily: 'SimHei', bold: true,
        words, nativeCalibrated: true, nativeAdvanceCentered: true, preciseInk: true });
      delete item.glyphPositions;
      centeredItems.add(item);
    }
  } finally { context.font = oldFont; context.fontKerning = oldKerning; }
  return scene;
}

/** Small bounded optical proposals for already-owned native display glyphs.
 * Pixels supply placement only. Spelling, sources, images and rules stay intact. */
export function refineNativeDisplayInk(scene, pixels, width, height, createCanvas, check = () => {}) {
  if (!scene || !createCanvas || !(pixels instanceof Uint8ClampedArray)
    || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width * height > 16_000_000 || pixels.length !== width * height * 4
    || !Number.isFinite(scene.width + scene.height) || scene.width <= 0 || scene.height <= 0) return scene;
  const sx = width / scene.width, sy = height / scene.height;
  const items = [...texts(scene.items, false)], words = [...texts(scene.items)].flatMap(item => item.words || []);
  const query = spatialIndex(words.filter(word => validRect(word.rect)).map(word => ({ word, rect: word.rect })));
  const canvas = createCanvas(1, 1);
  let remaining = 16_000_000;
  try {
    for (const item of items) {
      if (item.ocr || item.raster || item.size < 20 || item.size > 120 || !item.words?.length || item.words.length > 120
        || !item.fontAssetId && !legacyHei(item.sourceFont)) continue;
      for (const word of item.words) {
        check();
        if (!/^[^\s]$/u.test(word.text || '') || !validRect(word.rect)) continue;
        const r = word.rect, l = Math.max(0, Math.floor((r.x - 2) * sx)), t = Math.max(0, Math.floor((r.y - 2) * sy));
        const rr = Math.min(width, Math.ceil((r.x + r.width + 2) * sx)), bb = Math.min(height, Math.ceil((r.y + r.height + 2) * sy));
        const w = rr - l, h = bb - t, patch = { x: l / sx, y: t / sy, width: w / sx, height: h / sy };
        if (w < 3 || h < 3 || w * h > 300_000 || remaining < w * h * 2
          || query(patch).some(other => other.word !== word && overlaps(patch, other.rect, 0))) continue;
        remaining -= w * h;
        const source = new Uint8Array(w * h);
        let count = 0, border = false;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const p = ((y + t) * width + x + l) * 4;
          if (Math.min(pixels[p], pixels[p + 1], pixels[p + 2]) >= 180) continue;
          source[y * w + x] = 1; count++;
          if (!x || !y || x === w - 1 || y === h - 1) border = true;
        }
        if (border || count < 16) continue;
        canvas.width = w; canvas.height = h;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const score = (dx, dy) => {
          check();
          if (remaining < w * h) return null;
          remaining -= w * h;
          const glyph = { ...item, ...word, id: 'native-optical', type: 'text', words: undefined, sourceIds: ['native-optical'],
            rect: { ...r, x: r.x + dx, y: r.y + dy }, baseline: (word.baseline ?? item.baseline) + dy,
            baselineX: (word.baselineX ?? r.x) + dx };
          const document = inferDocument([{ number: scene.number, width: scene.width, height: scene.height, items: [glyph],
            sources: [{ id: glyph.id, text: glyph.text, rect: glyph.rect, disposition: 'editable' }],
            rules: [], risks: [], characters: glyph.text.length }], { preserveGeometry: true });
          context.setTransform(1, 0, 0, 1, 0, 0); context.fillStyle = '#fff'; context.fillRect(0, 0, w, h);
          context.setTransform(sx, 0, 0, sy, -l, -t); drawResultText(document.pages[0], context);
          const data = context.getImageData(0, 0, w, h).data;
          let ink = 0, common = 0, edge = false;
          for (let i = 0; i < w * h; i++) if (Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < 180) {
            ink++; common += source[i]; const x = i % w, y = Math.floor(i / w);
            if (!x || !y || x === w - 1 || y === h - 1) edge = true;
          }
          return edge ? null : 2 * common / Math.max(1, ink + count);
        };
        const initial = score(0, 0);
        if (initial === null || initial > .995) continue;
        let best = initial, move = [0, 0];
        for (const dx of [-.5, -.25, .25, .5]) {
          const value = score(dx, 0); if (value !== null && value > best + .00001) { best = value; move = [dx, 0]; }
        }
        for (const dy of [-.5, -.25, .25, .5]) {
          const value = score(move[0], dy); if (value !== null && value > best + .00001) { best = value; move = [move[0], dy]; }
        }
        if (best < .8 || best < initial + .01) continue;
        const [dx, dy] = move;
        word.rect = { ...r, x: r.x + dx, y: r.y + dy };
        word.baseline = (word.baseline ?? item.baseline) + dy; word.baselineX = (word.baselineX ?? r.x) + dx;
      }
      if (centeredItems.has(item)) for (const word of item.words) {
        if (word.font !== 'SimHei' || !word.bold || balancedWords.has(word)) continue;
        // Match the synthetic-bold placement of the Windows document reader.
        // The original source baseline stays on the parent; no spelling,
        // advance, source geometry or system font data is rewritten.
        const delta = Math.round(word.size / 128 * 4) / 4;
        word.rect = { ...word.rect, x: word.rect.x + delta, y: word.rect.y - delta };
        word.baseline -= delta; word.baselineX += delta;
        balancedWords.add(word);
      }
    }
  } finally { canvas.width = canvas.height = 0; }
  return scene;
}
