// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { rasterMathComponents, rasterMathReadings, rasterMathTokens, positiveMathRect } from '../core/raster-math-layout.js';
import { enlargeRasterMath } from '../core/raster-math-resample.js';
import { inferRasterMathAst } from '../core/raster-math-evidence.js';
import { contains, union } from '../core/geometry.js';
import { validRasterIndexReference, rasterMathScriptGroups } from '../core/raster-math-context.js';

const SIDE = 32;
const signature = (mask, width, height) => {
  const result = new Uint8Array(SIDE * SIDE);
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
    const x1 = Math.floor(x * width / SIDE), x2 = Math.min(width, Math.max(x1 + 1, Math.ceil((x + 1) * width / SIDE)));
    const y1 = Math.floor(y * height / SIDE), y2 = Math.min(height, Math.max(y1 + 1, Math.ceil((y + 1) * height / SIDE)));
    let ink = 0;
    for (let yy = y1; yy < y2; yy++) for (let xx = x1; xx < x2; xx++) ink += mask[yy * width + xx];
    result[y * SIDE + x] = ink / ((x2 - x1) * (y2 - y1)) > .3 ? 1 : 0;
  }
  return result;
};
const similarity = (a, b) => {
  let ink = 0, common = 0;
  for (let index = 0; index < a.length; index++) { ink += a[index] + b[index]; common += a[index] & b[index]; }
  return 2 * common / Math.max(1, ink);
};

/** One pending original bitmap per Worker. Probe before model loading; all
 * success, decline and failure paths release pixels, labels and font masks. */
export function createRasterMathRecovery(createCanvas) {
  let pending = null;
  const clear = () => { pending = null; };
  const probe = async ({ item, pixels, width, height, indexReferences = [] }) => {
    clear();
    if (typeof createCanvas !== 'function' || width > 512 || height > 128 || item?.type !== 'image'
      || !positiveMathRect(item.rasterSource?.rect) || !Number.isSafeInteger(item.rasterSource.operation)
      || item.rasterSource.operation < 0 || item.sourceIds?.length || item.drawingIds?.length !== 1
      || item.drawingIds[0] !== item.id?.replace(/:image$/, '') || item.role !== 'figure'
      || item.mathGlyphs?.length || item.reasons?.length || !contains(item.rasterSource.rect, item.rect, .01)
      || !Array.isArray(indexReferences) || indexReferences.length > 8
      || indexReferences.some(reference => !validRasterIndexReference(reference, item.id, item.rasterSource.rect))) return null;
    const layout = rasterMathComponents(pixels, width, height);
    if (!layout) return null;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', pixels);
    const pixelSha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    const readings = [2, 4].map(factor => enlargeRasterMath(pixels, width, height, factor));
    if (readings.some(reading => !reading)) return null;
    pending = { item, layout, pixelSha256, indexReferences };
    return { imageId: item.id, pixelSha256, readings };
  };
  const recover = ({ imageId, pixelSha256, readings: raw }) => {
    const source = pending; clear();
    if (!source || imageId !== source.item.id || pixelSha256 !== source.pixelSha256) return null;
    const readings = rasterMathReadings(raw), tokens = readings && rasterMathTokens(source.layout, readings);
    if (!tokens) return null;
    const { layout, item } = source, imageRect = item.rasterSource.rect, cache = new Map();
    const groups = rasterMathScriptGroups(tokens, layout, source.indexReferences, item.id, imageRect);
    if (!groups) return null;
    const measureCanvas = createCanvas(1, 1), context = measureCanvas.getContext('2d');
    const sourceMask = part => {
      const { x, y, width, height } = part.rect, mask = new Uint8Array(width * height), ids = new Set(part.ids);
      for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++) mask[yy * width + xx] = ids.has(layout.labels[(y + yy) * layout.width + x + xx]) ? 1 : 0;
      return signature(mask, width, height);
    };
    const template = (text, style) => {
      const key = JSON.stringify([text, style.font, style.italic, style.bold]);
      if (cache.has(key)) return cache.get(key);
      const canvas = createCanvas(220, 180), ctx = canvas.getContext('2d');
      try {
        ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}100px "${style.font}"`; ctx.fontKerning = 'none';
        const m = ctx.measureText(text), width = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight), height = Math.ceil(m.actualBoundingBoxAscent) + Math.ceil(m.actualBoundingBoxDescent);
        if (width < 1 || width > 200 || height < 1 || height > 160) return null;
        ctx.fillStyle = '#000'; ctx.fillText(text, Math.ceil(m.actualBoundingBoxLeft), Math.ceil(m.actualBoundingBoxAscent));
        const data = ctx.getImageData(0, 0, width, height).data, mask = new Uint8Array(width * height);
        for (let index = 0; index < mask.length; index++) mask[index] = data[index * 4 + 3] > 100 ? 1 : 0;
        const value = signature(mask, width, height); cache.set(key, value); return value;
      } finally { canvas.width = canvas.height = 0; }
    };
    const glyphs = [], baseGlyphs = [];
    const makeGlyph = (token, part, style, shapeScore) => {
      const box = part.rect, rect = { x: imageRect.x + box.x * imageRect.width / layout.width, y: imageRect.y + box.y * imageRect.height / layout.height,
        width: box.width * imageRect.width / layout.width, height: box.height * imageRect.height / layout.height };
      context.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}1000px "${style.font}"`; context.fontKerning = 'none';
      const metrics = context.measureText(token.text), height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
      if (!(height > 0)) return null;
      const size = rect.height * 1000 / height, baseline = rect.y + metrics.actualBoundingBoxAscent * size / 1000;
      const glyph = { id: `${item.id}:optical-${token.index}`, text: token.text, rect, size, baseline, ...style,
        preciseInk: true, raster: true, ocr: true, color: '000000', ocrEvidence: { confidence: token.confidence, shapeScore } };
      glyphs.push(glyph); return glyph;
    };
    try {
      for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index], unit = layout.units[index], baseMask = sourceMask(unit.base), subMask = unit.subscript && sourceMask(unit.subscript);
        const styles = token.text === '∑' ? [{ font: 'Cambria Math', italic: false, bold: false }]
          : ['Arial', 'Times New Roman', 'Calibri', 'Cambria'].flatMap(font => [false, true].flatMap(italic => [false, true].map(bold => ({ font, italic, bold }))));
        const fits = styles.map(style => {
          const mask = template(token.text, style), sub = token.subscript && template(token.subscript.text, style);
          const baseScore = mask ? similarity(baseMask, mask) : 0, subScore = sub ? similarity(subMask, sub) : 0;
          return { style, baseScore, subScore, score: token.subscript ? baseScore * .75 + subScore * .25 : baseScore };
        }).filter(fit => fit.baseScore >= .65 && (!token.subscript || fit.subScore >= .65)).sort((a, b) => b.score - a.score);
        let best = fits[0];
        // Low-resolution interpolation can falsely favour synthetic weight.
        // Require independent shape improvement before enabling bold.
        if (best?.style.bold) {
          const regular = fits.find(fit => fit.style.font === best.style.font && fit.style.italic === best.style.italic && !fit.style.bold);
          if (regular && best.score - regular.score < .08) best = regular;
        }
        if (!best || best.baseScore < .65 || token.subscript && best.subScore < .65) return null;
        const base = makeGlyph(token, unit.base, best.style, best.baseScore);
        if (!base) return null;
        baseGlyphs.push(base);
        if (token.subscript && !makeGlyph(token.subscript, unit.subscript, best.style, best.subScore)) return null;
      }
      const rect = union(glyphs.map(glyph => glyph.rect));
      if (!contains(item.rect, rect, .01)) return null; // A clip may trim white borders, never original ink.
      const result = { ...item, role: 'math', ocrMath: true, rect, mathGlyphs: glyphs, mathStrokes: [],
        sourceIds: glyphs.map(glyph => glyph.id), baseline: baseGlyphs[0].baseline, size: baseGlyphs[0].size,
        rasterMathEvidence: { version: 1, kind: 'local-ocr-components', resampler: 'lanczos3', originalImageId: item.id,
          imageRect, visibleRect: item.rect, width: layout.width, height: layout.height, pixelSha256, components: layout.components, readings,
          ...(groups.references.length ? { indexReferences: groups.references } : {}) } };
      if (!inferRasterMathAst(result)) return null;
      return { item: result, sources: glyphs.map(glyph => ({ id: glyph.id, text: glyph.text, rect: glyph.rect,
        disposition: 'visible-image', provenance: 'raster-ocr' })) };
    } finally { measureCanvas.width = measureCanvas.height = 0; cache.clear(); }
  };
  return { probe, recover, clear };
}
