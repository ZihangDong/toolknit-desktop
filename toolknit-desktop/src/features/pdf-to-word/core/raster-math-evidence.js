// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { rasterMathComponentLayout, rasterMathReadings, rasterMathTokens, positiveMathRect } from './raster-math-layout.js';
import { contains, union } from './geometry.js';
import { validateMathGeometry } from './math-evidence.js';
import { rasterMathScriptGroups } from './raster-math-context.js';

const fonts = new Set(['Arial', 'Times New Roman', 'Calibri', 'Cambria', 'Cambria Math']);
const close = (a, b, tolerance = .001) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
const sameRect = (a, b) => a && b && ['x', 'y', 'width', 'height'].every(key => close(a[key], b[key]));
const symbol = glyph => ({ type: 'symbol', sourceId: glyph.id, text: glyph.text, italic: glyph.italic, bold: glyph.bold });

/** Explicit optical provenance, separate from native font/ASCII OCR inference.
 * Only source-owned first-level Latin subscripts and a literal bare sum are
 * supported. Unknown/malformed evidence never falls back to the native path. */
export function inferRasterMathAst(region) {
  const proof = region?.rasterMathEvidence, glyphs = region?.mathGlyphs;
  if (proof?.version !== 1 || proof.kind !== 'local-ocr-components' || proof.resampler !== 'lanczos3'
    || typeof proof.originalImageId !== 'string' || !/^p\d{1,5}:i\d{1,6}:image$/.test(proof.originalImageId) || region.id !== proof.originalImageId
    || !/^[0-9a-f]{64}$/.test(proof.pixelSha256 || '') || !positiveMathRect(proof.imageRect) || !positiveMathRect(proof.visibleRect)
    || region.role !== 'math' || !region.ocrMath || !positiveMathRect(region.rect) || region.reasons?.length || region.mathStrokes?.length
    || region.backgroundPaintIndexes?.length || region.decorationTextPaintIndexes?.length
    || !Array.isArray(glyphs) || glyphs.length < 5 || glyphs.length > 48 || !Array.isArray(proof.readings)
    || proof.readings.length !== 2 || !Array.isArray(region.sourceIds) || region.sourceIds.length !== glyphs.length
    || !Array.isArray(region.drawingIds) || region.drawingIds.length !== 1
    || region.drawingIds[0] !== proof.originalImageId.replace(/:image$/, '')
    || !sameRect(proof.imageRect, region.rasterSource?.rect)) return null;
  const layout = rasterMathComponentLayout(proof.components, proof.width, proof.height);
  if (!layout || proof.width > 512 || proof.height > 128 || !contains(proof.imageRect, proof.visibleRect, .01)
    || !contains(proof.visibleRect, region.rect, .01)
    || proof.readings.some((reading, index) => reading?.width !== proof.width * [2, 4][index]
      || reading.height !== proof.height * [2, 4][index] || !Array.isArray(reading.characters) || reading.characters.length > 48
      || reading.characters.some(char => typeof char?.text !== 'string' || [...char.text].length !== 1))) return null;
  const readings = rasterMathReadings(proof.readings.map(reading => ({ width: reading.width, height: reading.height,
    lines: [{ text: reading.characters.map(char => char.text).join(''), words: reading.characters }] })));
  const tokens = readings && rasterMathTokens(layout, readings);
  if (!tokens || glyphs.length !== readings[0].characters.length) return null;
  const mapRect = rect => ({ x: proof.imageRect.x + rect.x * proof.imageRect.width / proof.width,
    y: proof.imageRect.y + rect.y * proof.imageRect.height / proof.height,
    width: rect.width * proof.imageRect.width / proof.width, height: rect.height * proof.imageRect.height / proof.height });
  const ids = new Set();
  for (let index = 0; index < glyphs.length; index++) {
    const glyph = glyphs[index], text = readings[0].characters[index].text;
    if (typeof glyph?.id !== 'string' || glyph.id !== `${proof.originalImageId}:optical-${index}` || ids.has(glyph.id)
      || region.sourceIds[index] !== glyph.id || glyph.text !== text || glyph.raster !== true || glyph.ocr !== true
      || glyph.preciseInk !== true || glyph.alphabet || glyph.mathStyleUncertain || glyph.radicalPart || glyph.delimiterPart
      || !fonts.has(glyph.font) || typeof glyph.bold !== 'boolean' || typeof glyph.italic !== 'boolean'
      || glyph.color !== '000000' || !Number.isFinite(glyph.size) || glyph.size < .5 || glyph.size > 100
      || !Number.isFinite(glyph.baseline) || !positiveMathRect(glyph.rect) || !contains(proof.imageRect, glyph.rect, .01)
      || glyph.baseline < glyph.rect.y - glyph.size * .25 || glyph.baseline > glyph.rect.y + glyph.rect.height + glyph.size * .5
      || !close(glyph.ocrEvidence?.confidence, Math.max(...readings.map(reading => reading.characters[index].confidence)), 1e-8)
      || !Number.isFinite(glyph.ocrEvidence?.shapeScore) || glyph.ocrEvidence.shapeScore < .65 || glyph.ocrEvidence.shapeScore > 1) return null;
    if (text === '∑' && (glyph.font !== 'Cambria Math' || glyph.bold || glyph.italic)) return null;
    ids.add(glyph.id);
  }
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index], unit = layout.units[index], base = glyphs[token.index];
    if (!sameRect(base.rect, mapRect(unit.base.rect))) return null;
    if (token.subscript) {
      const child = glyphs[token.subscript.index];
      if (!sameRect(child.rect, mapRect(unit.subscript.rect)) || base.font !== child.font || base.bold !== child.bold
        || base.italic !== child.italic || child.size >= base.size || child.baseline <= base.baseline) return null;
    }
  }
  if (!sameRect(region.rect, union(glyphs.map(glyph => glyph.rect)))) return null;
  const references = proof.indexReferences === undefined ? [] : proof.indexReferences;
  const plan = rasterMathScriptGroups(tokens, layout, references, proof.originalImageId, proof.imageRect);
  if (!plan || plan.references.length !== references.length) return null;
  const children = plan.groups.map(group => {
    const symbols = group.units.map(index => symbol(glyphs[tokens[index].index]));
    const base = symbols.length === 1 ? symbols[0] : { type: 'row', children: symbols };
    return group.subscript === null ? base : { type: 'script', base, subscript: symbol(glyphs[group.subscript]) };
  });
  const ast = { type: 'row', children };
  return validateMathGeometry(ast, new Map(glyphs.map(glyph => [glyph.id, glyph])), new Map(), []) ? ast : null;
}

export function rasterMathAstMatches(ast, region) {
  const expected = inferRasterMathAst(region);
  // The generated tree has fixed bounded depth and explicit allowed keys.
  const equal = (actual, local) => actual !== null && actual !== undefined && typeof actual === typeof local && (Array.isArray(local)
    ? Array.isArray(actual) && actual.length === local.length && local.every((value, index) => equal(actual[index], value))
    : local && typeof local === 'object' ? !Array.isArray(actual) && Object.keys(actual).length === Object.keys(local).length
      && Object.keys(local).every(key => Object.hasOwn(actual, key) && equal(actual[key], local[key])) : actual === local);
  return expected !== null && Boolean(equal(ast, expected));
}
