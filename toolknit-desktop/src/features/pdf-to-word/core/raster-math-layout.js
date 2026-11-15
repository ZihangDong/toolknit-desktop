// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { union, right, bottom, median, validRect, overlaps } from './geometry.js';

export const RASTER_MATH_LIMITS = Object.freeze({ pixels: 262144, side: 1024, components: 96, units: 32, characters: 48, perPage: 4, perDocument: 32 });
/** Metadata only: never schedule OCR for photos, diagrams, layered images or
 * already recovered native math. Pixel structure must still pass the probe. */
export function rasterMathCandidates(scene) {
  if (scene?.rasterPage || !Array.isArray(scene?.items) || scene.items.length > 20000) return [];
  return scene.items.filter(item => item.type === 'image' && item.role === 'figure' && positiveMathRect(item.rect)
    && Number.isSafeInteger(item.rasterSource?.operation) && item.rasterSource.operation >= 0 && positiveMathRect(item.rasterSource.rect)
    && !item.sourceIds?.length && item.drawingIds?.length === 1 && !item.mathGlyphs?.length && !item.ocrMath
    && !item.backgroundPaintIndexes?.length && !item.decorationTextPaintIndexes?.length
    && Array.isArray(item.reasons) && item.reasons.every(reason => reason === 'image')
    && item.rect.width >= 20 && item.rect.width <= 180 && item.rect.height >= 8 && item.rect.height <= 35
    && item.rect.width / item.rect.height >= 2
    && !scene.items.some(other => other !== item && positiveMathRect(other.rect) && overlaps(item.rect, other.rect, .05)))
    .slice(0, RASTER_MATH_LIMITS.perPage);
}
const box = parts => union(parts.map(part => part.rect));
const merge = (a, b, kind) => ({ rect: box([a, b]), ids: [...a.ids, ...b.ids], ink: a.ink + b.ink, kind });

/** Complete, bounded connected components. No tiny fragments are discarded.
 * A source component belongs to exactly one base/script unit, or all recovery
 * is declined. Coordinates here remain in the original crop's pixel grid.
 */
export function rasterMathComponents(pixels, width, height) {
  if (!(pixels instanceof Uint8ClampedArray) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 16 || height < 12 || width > RASTER_MATH_LIMITS.side || height > 256
    || width * height > RASTER_MATH_LIMITS.pixels || pixels.length !== width * height * 4) return null;
  const mask = new Uint8Array(width * height), labels = new Uint16Array(mask.length), queue = new Int32Array(mask.length);
  let ink = 0, perimeter = 0, white = 0;
  for (let index = 0; index < mask.length; index++) {
    const at = index * 4, low = Math.min(pixels[at], pixels[at + 1], pixels[at + 2]), high = Math.max(pixels[at], pixels[at + 1], pixels[at + 2]);
    if (pixels[at + 3] < 250 || low < 235 && high - low > 25) return null;
    if (low < 180) { mask[index] = 1; ink++; }
    const x = index % width, y = Math.floor(index / width);
    if (!x || !y || x === width - 1 || y === height - 1) { perimeter++; if (low > 245) white++; }
  }
  if (ink < 30 || ink > mask.length * .35 || white < perimeter * .98) return null;
  const components = [];
  for (let index = 0; index < mask.length; index++) {
    if (!mask[index] || labels[index]) continue;
    if (components.length >= RASTER_MATH_LIMITS.components) return null;
    const id = components.length + 1; let count = 0, first = 0, last = 1, x1 = width, y1 = height, x2 = 0, y2 = 0;
    queue[0] = index; labels[index] = id;
    while (first < last) {
      const current = queue[first++], x = current % width, y = Math.floor(current / width); count++;
      x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y);
      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
        const next = yy * width + xx;
        if (mask[next] && !labels[next]) { labels[next] = id; queue[last++] = next; }
      }
    }
    components.push({ id, rect: { x: x1, y: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 }, ink: count });
  }
  const layout = rasterMathComponentLayout(components, width, height);
  return layout && { ...layout, mask, labels };
}

/** Rebuild ownership from bounded component evidence at every writer gate. */
export function rasterMathComponentLayout(components, width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 16 || width > 1024 || height < 12 || height > 256
    || width * height > RASTER_MATH_LIMITS.pixels || !Array.isArray(components) || components.length < 4
    || components.length > RASTER_MATH_LIMITS.components
    || components.some((part, index) => part?.id !== index + 1 || !positiveMathRect(part.rect)
      || !Object.values(part.rect).every(Number.isSafeInteger) || part.rect.x < 0 || part.rect.y < 0
      || right(part.rect) > width || bottom(part.rect) > height || !Number.isSafeInteger(part.ink) || part.ink < 1
      || part.ink > part.rect.width * part.rect.height)) return null;
  const ink = components.reduce((sum, part) => sum + part.ink, 0);
  if (ink < 30 || ink > width * height * .35) return null;
  // Physical DPI and the PDF preview render scale vary independently. Use the
  // largest complete component as the grid unit, never fixed pixel gaps.
  const grid = Math.max(1, Math.max(...components.map(part => part.rect.height)) / 20);
  let parts = components.map(part => ({ rect: part.rect, ids: [part.id], ink: part.ink, kind: 'glyph' }));
  for (;;) {
    let found = false;
    for (let i = 0; i < parts.length && !found; i++) for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], b = parts[j], overlap = Math.min(right(a.rect), right(b.rect)) - Math.max(a.rect.x, b.rect.x);
      const gap = Math.max(a.rect.y, b.rect.y) - Math.min(bottom(a.rect), bottom(b.rect));
      const equal = a.kind === 'glyph' && b.kind === 'glyph' && a.rect.width >= a.rect.height * 4 && b.rect.width >= b.rect.height * 4
        && overlap >= Math.max(a.rect.width, b.rect.width) * .8 && gap >= 0 && gap <= 4 * grid;
      const [dot, stem] = a.rect.height < b.rect.height ? [a, b] : [b, a];
      const letter = a.kind !== 'equal' && b.kind !== 'equal' && dot.ids.length === 1 && dot.rect.width <= Math.ceil(2 * grid) && dot.rect.height <= Math.ceil(2 * grid)
        && stem.rect.height >= 4 * grid && stem.rect.width <= Math.ceil(4 * grid) && overlap > 0 && gap >= 0 && gap <= Math.ceil(2 * grid);
      if (!equal && !letter) continue;
      parts = parts.filter((_, index) => index !== i && index !== j).concat(merge(a, b, equal ? 'equal' : 'letter')); found = true; break;
    }
    if (!found) break;
  }
  parts.sort((a, b) => a.rect.x - b.rect.x);
  const maximum = Math.max(...parts.map(part => part.rect.height));
  const baseline = median(parts.filter(part => part.rect.height >= maximum * .6).map(part => bottom(part.rect)));
  const scripts = parts.filter(part => part.rect.height <= maximum * .55 && part.rect.height / part.rect.width >= 1.8 && bottom(part.rect) > baseline + grid);
  const units = parts.filter(part => !scripts.includes(part)).map(part => ({ base: part, subscript: null }));
  for (const script of scripts) {
    const candidates = units.filter(unit => unit.base.rect.x < script.rect.x && unit.base.kind !== 'equal' && unit.base.rect.height >= maximum * .45
      && script.rect.x - right(unit.base.rect) >= -2 * grid && script.rect.x - right(unit.base.rect) <= 3 * grid)
      .sort((a, b) => Math.abs(script.rect.x - right(a.base.rect)) - Math.abs(script.rect.x - right(b.base.rect)));
    if (!candidates.length || candidates[0].subscript || candidates.length > 1
      && Math.abs(script.rect.x - right(candidates[0].base.rect)) + grid >= Math.abs(script.rect.x - right(candidates[1].base.rect))) return null;
    candidates[0].subscript = script;
  }
  const equals = units.map((unit, index) => unit.base.kind === 'equal' ? index : -1).filter(index => index >= 0);
  if (units.length < 5 || units.length > RASTER_MATH_LIMITS.units || !scripts.length || scripts.length > 8
    || equals.length !== 1 || equals[0] < 1 || equals[0] > 4 || equals[0] + 3 >= units.length) return null;
  const operator = equals[0] + 1, op = units[operator];
  if (op.subscript || op.base.rect.height < maximum * .9 || op.base.rect.width / op.base.rect.height < .5 || op.base.rect.width / op.base.rect.height > 1.2) return null;
  const owned = units.flatMap(unit => [...unit.base.ids, ...(unit.subscript?.ids || [])]);
  if (owned.length !== components.length || new Set(owned).size !== components.length) return null;
  return { width, height, ink, components, units, equals: equals[0], operator };
}

/** A pair of actual OCR observations, kept separate from detection confidence.
 * Only whitespace is removed; symbols and variable/index spelling never change.
 */
export function rasterMathReadings(readings) {
  if (!Array.isArray(readings) || readings.length !== 2) return null;
  const result = [];
  for (const reading of readings) {
    if (!Number.isSafeInteger(reading?.width) || !Number.isSafeInteger(reading?.height) || reading.width < 1 || reading.height < 1
      || reading.width > 2048 || reading.height > 512 || !Array.isArray(reading.lines) || reading.lines.length < 1 || reading.lines.length > 4) return null;
    const characters = [];
    for (const line of reading.lines) {
      if (typeof line?.text !== 'string' || line.text.length > RASTER_MATH_LIMITS.characters * 4
        || !Array.isArray(line.words) || !line.words.length || line.words.length > RASTER_MATH_LIMITS.characters * 2
        || line.words.some(word => typeof word?.text !== 'string' || word.text.length > RASTER_MATH_LIMITS.characters * 4)
        || line.words.map(word => word.text).join('').replace(/\s/gu, '') !== line.text.replace(/\s/gu, '')) return null;
      for (const word of line.words) {
        if (typeof word.text !== 'string' || !Number.isFinite(word.confidence) || word.confidence < 0 || word.confidence > 1) return null;
        for (const character of word.text) if (!/\s/u.test(character)) characters.push({ text: character, confidence: word.confidence });
      }
    }
    if (characters.length < 5 || characters.length > RASTER_MATH_LIMITS.characters || characters.some(char => !/^[A-Za-z0-9=∑.+\-−×*/]$/u.test(char.text))) return null;
    result.push({ width: reading.width, height: reading.height, characters });
  }
  if (result[0].characters.map(char => char.text).join('') !== result[1].characters.map(char => char.text).join('')
    || result[0].width === result[1].width && result[0].height === result[1].height) return null;
  return result;
}

/** Match the agreed literal characters to the complete source-owned units.
 * No LaTeX/model-supplied AST or invented upper/lower sum limits are accepted.
 */
export function rasterMathTokens(layout, readings) {
  const chars = readings?.[0]?.characters;
  if (!Array.isArray(chars) || !Array.isArray(readings?.[1]?.characters) || readings[1].characters.length !== chars.length
    || !Array.isArray(layout?.units) || !layout.units.length || layout.units.length > RASTER_MATH_LIMITS.units
    || chars.length !== layout.units.reduce((count, unit) => count + 1 + Boolean(unit.subscript), 0)) return null;
  const tokens = []; let cursor = 0, scripted = 0;
  for (let index = 0; index < layout.units.length; index++) {
    const unit = layout.units[index], source = chars[cursor], confidence = Math.max(source.confidence, readings[1].characters[cursor].confidence);
    if (index < layout.equals && !/^[A-Z]$/.test(source.text) || index === layout.equals && source.text !== '='
      || index === layout.operator && source.text !== '∑' || index > layout.operator && !/^[A-Za-z0-9.+\-−×*/]$/.test(source.text)
      || confidence < (index === layout.operator ? .7 : /^[A-Za-z0-9]$/.test(source.text) ? .9 : .85)) return null;
    const token = { text: source.text, confidence, index: cursor++, subscript: null };
    if (unit.subscript) {
      if (index <= layout.operator || !/^[A-Za-z]$/.test(source.text)) return null;
      const child = chars[cursor], confidence = Math.max(child.confidence, readings[1].characters[cursor].confidence);
      if (!/^[a-z0-9]$/.test(child.text) || confidence < .75) return null;
      token.subscript = { text: child.text, confidence, index: cursor++ }; scripted++;
    }
    tokens.push(token);
  }
  return scripted ? tokens : null;
}

export const positiveMathRect = rect => validRect(rect) && rect.width > 0 && rect.height > 0;
