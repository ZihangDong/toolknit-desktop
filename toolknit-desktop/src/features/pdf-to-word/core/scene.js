// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { IDENTITY, multiply, point, transformedRect, intersect, contains, overlaps, union, area, validRect, spatialIndex, strokeMayTouchRect } from './geometry.js';
import { LIMITS, wordError } from './input.js';
import { horizontalTextGeometry, textInkRects } from './text-geometry.js';
import { createGlyphMetrics } from './font-metrics.js';
import { sourceFontTraits } from './font-style.js';
import { groupPageRegions } from './regions.js';
import { glyphRadicals } from './math-glyph-radicals.js';
import { recoverTableTextLayers } from './table-text-layers.js';
import { recoverGraphicTextLayers } from './graphic-text-layers.js';
import { ruledTableGrids } from './tables.js';
import { boundedAnnotations } from './annotations.js';
import { hasDarkTextBackground } from './text-background.js';
import { boundedGraphicClip } from './graphic-clipping.js';

const STROKES = new Set(['stroke', 'closeStroke', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke']);
const FILLS = new Set(['fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke']);
const clone = state => ({ ...state, matrix: [...state.matrix], textMatrix: [...state.textMatrix], clip: { ...state.clip } });
const color = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1).toUpperCase() : '000000';

function pathPoints(data) {
  if (!Array.isArray(data) && !ArrayBuffer.isView(data)) return null;
  const points = [];
  for (let i = 0; i < data.length;) {
    const command = data[i++];
    if (command === 0 || command === 1) points.push({ move: command === 0, x: data[i++], y: data[i++] });
    else if (command === 4) points.push({ close: true });
    else return null;
  }
  return points;
}
function rectangular(points) {
  if (!points || points.length < 4 || points.filter(p => p.move).length !== 1) return false;
  const vertices = points.filter(p => !p.close);
  if (vertices.length === 5 && vertices[0].x === vertices[4].x && vertices[0].y === vertices[4].y) vertices.pop();
  return vertices.length === 4 && vertices.every((p, i) => {
    const q = vertices[(i + 1) % 4];
    return p.x === q.x || p.y === q.y;
  }) && new Set(vertices.map(p => p.x)).size === 2 && new Set(vertices.map(p => p.y)).size === 2;
}

/** Interpret the bounded PDF.js 6 operator snapshot; the PDF renderer remains authoritative for pixels. */
export function buildPageScene({ number, width, height, transform, operations, fonts = {}, textCharacters = 0, textLayerMapping = false }, { tableFallbackIds = [] } = {}) {
  if (!Number.isInteger(number) || number < 1 || !validRect({ x: 0, y: 0, width, height }) || width > 14400 || height > 14400) throw wordError('page-size');
  if (!Array.isArray(operations) || operations.length > LIMITS.operationsPerPage) throw wordError('complexity');
  const bounds = { x: 0, y: 0, width, height }, text = [], images = [], rules = [], paints = [], risks = new Set();
  const annotations = boundedAnnotations(operations, transform, bounds);
  const stack = [], groupStack = [], markedVisibility = [], sources = [];
  const glyphMetrics = createGlyphMetrics(fonts);
  let state = { matrix: [...transform], textMatrix: [...IDENTITY], clip: bounds, font: null, size: 12,
    x: 0, y: 0, lineX: 0, lineY: 0, leading: 0, hScale: 1, rise: 0, charSpacing: 0,
    wordSpacing: 0, mode: 0, fill: '000000', stroke: '000000', fillAlpha: 1, strokeAlpha: 1,
    fillPattern: false, strokePattern: false,
    lineWidth: 1, lineJoin: 0, lineCap: 0, miterLimit: 10, uncertain: false };
  let pendingClip = false, characters = 0, fullRaster = false, contentVisible = true;
  const unsafe = code => { risks.add(code); fullRaster = true; };
  const addRule = (a, b) => {
    const [x1, y1] = point(state.matrix, a.x, a.y), [x2, y2] = point(state.matrix, b.x, b.y);
    if (![x1, y1, x2, y2].every(Number.isFinite) || rules.length >= 3000) return;
    if (Math.abs(y1 - y2) < 0.8 && Math.abs(x1 - x2) > 5) rules.push({ axis: 'h', at: (y1 + y2) / 2, from: Math.min(x1, x2), to: Math.max(x1, x2) });
    else if (Math.abs(x1 - x2) < 0.8 && Math.abs(y1 - y2) > 5) rules.push({ axis: 'v', at: (x1 + x2) / 2, from: Math.min(y1, y2), to: Math.max(y1, y2) });
  };
  function strokeSegment(a, b, index, segment, paint) {
    const p = point(state.matrix, a.x, a.y), q = point(state.matrix, b.x, b.y);
    const padding = Math.max(0.2, Math.abs(state.lineWidth) * Math.max(Math.hypot(state.matrix[0], state.matrix[1]), Math.hypot(state.matrix[2], state.matrix[3])) / 2);
    const full = { x: Math.min(p[0], q[0]) - padding, y: Math.min(p[1], q[1]) - padding,
      width: Math.abs(p[0] - q[0]) + padding * 2, height: Math.abs(p[1] - q[1]) + padding * 2 };
    const rect = intersect(full, state.clip);
    const strokeRadius = Math.max(.2, Math.abs(state.lineWidth) * Math.hypot(...state.matrix.slice(0, 4)) / 2);
    const joinRadius = [0, 1, 2].includes(state.lineJoin) && [0, 1, 2].includes(state.lineCap) && Number.isFinite(state.miterLimit) && state.miterLimit >= 1
      ? strokeRadius * Math.max(state.lineJoin === 0 ? state.miterLimit : 1, state.lineCap === 2 ? Math.SQRT2 : 1) : null;
    if (rect) images.push({ id: `p${number}:d${index}-${segment}`, sourceIds: [], rect, order: index, raster: true, reason: 'image', decoration: true, thin: true,
      strokeColor: state.stroke, strokeWidth: padding * 2,
      opaque: state.strokeAlpha === 1 && !state.uncertain,
      path: { id: `p${number}:d${index}`, segment, from: p, to: q, paint, color: state.stroke, strokeRadius, joinRadius,
        complete: contains(state.clip, full, 0) && state.strokeAlpha === 1 && !state.uncertain } });
  }
  function addText(glyphs, index) {
    const font = fonts[state.font];
    if (!font || !Array.isArray(glyphs)) { unsafe('font-unsupported'); return; }
    if (glyphs.length > LIMITS.itemsPerPage) throw wordError('complexity');
    const matrix = multiply(state.matrix, state.textMatrix);
    const baseline = point(matrix, state.x, state.y + state.rise);
    const singleGlyph = glyphs.filter(glyph => glyph && typeof glyph === 'object').length === 1;
    let advance = 0, value = '', completeInk = true, uncertainGlyph = false, glyphIndex = 0, radicalPart = null, delimiterPart = null;
    const inkRects = [], words = [], encodingCorrections = [];
    let word = null, spaceBefore = false;
    const flushWord = () => {
      if (word) words.push({ text: word.text, spaceBefore: word.spaceBefore, rect: union(word.rects),
        baselineX: point(matrix, state.x + word.start * state.hScale, state.y + state.rise)[0],
        advanceWidth: (word.end - word.start) * state.hScale * Math.hypot(matrix[0], matrix[1]) });
      word = null;
    };
    for (const glyph of glyphs) {
      if (typeof glyph === 'number') {
        const gap = -glyph * state.size / 1000;
        if (Math.abs(gap) > state.size * .15) flushWord();
        if (gap > state.size * .22) spaceBefore = true;
        if (gap > state.size * 0.22 && value && !/\s$/.test(value)) value += ' ';
        advance += gap;
      } else if (glyph && typeof glyph.unicode === 'string' && Number.isFinite(glyph.width)) {
        const correction = glyphMetrics.symbol(state.font, glyph), unicode = correction?.text || glyph.unicode;
        const rootComponent = glyphMetrics.radicalPart(state.font, glyph);
        if (rootComponent?.uncertain) uncertainGlyph = true;
        if (rootComponent?.part) radicalPart = rootComponent.part;
        const delimiter = singleGlyph ? glyphMetrics.delimiter(state.font, glyph) : null;
        if (delimiter?.uncertain) uncertainGlyph = true;
        if (delimiter?.delimiterPart) delimiterPart = delimiter.delimiterPart;
        if (correction?.uncertain) uncertainGlyph = true;
        if (correction?.text) encodingCorrections.push({ glyph: glyphIndex, from: glyph.unicode, to: unicode, rule: correction.rule });
        // PDF.js skips absent glyphs even if the repaired font's cmap happens
        // to resolve fontChar to a different, visible outline (often '%').
        const ink = glyph.isInFont === false && !font.missingFile ? null
          : glyphMetrics.glyph(state.font, glyph, { fillOnly: (state.mode & 3) === 0 });
        const glyphAdvance = glyph.width * state.size * (font.matrixScale || 0.001) + state.charSpacing + (glyph.isSpace ? state.wordSpacing : 0);
        const inkRect = ink ? transformedRect(matrix,
            state.x + (advance + ink[0] * state.size) * state.hScale, state.y + state.rise + ink[1] * state.size,
            (ink[2] - ink[0]) * state.size * state.hScale, (ink[3] - ink[1]) * state.size) : null;
        if (unicode.trim()) {
          if (inkRect) inkRects.push(inkRect); else completeInk = false;
          if (inkRect) {
            if (!word) { word = { text: '', rects: [], start: advance, end: advance, spaceBefore }; spaceBefore = false; }
            word.text += unicode; word.rects.push(inkRect); word.end = advance + glyphAdvance;
          }
        } else if (inkRect && contentVisible && (state.mode & 3) !== 3 && (state.fillAlpha > 0 || state.strokeAlpha > 0)) {
          flushWord(); spaceBefore = true;
          const visibleInk = intersect(inkRect, state.clip);
          if (visibleInk) images.push({ id: `p${number}:g${index}-${glyphIndex}`, sourceIds: [], rect: visibleInk,
            order: index, raster: true, reason: 'unmapped-glyph', mathGlyph: true,
            baseline: baseline[1], size: state.size * Math.hypot(matrix[2], matrix[3]) });
        } else { flushWord(); spaceBefore = true; }
        glyphIndex++;
        value += unicode;
        advance += glyphAdvance;
        if (glyph.isInFont === false && unicode.trim() && !font.missingFile) uncertainGlyph = true;
      } else { unsafe('encoding'); }
      if (value.length > LIMITS.characters) throw wordError('text-large');
    }
    flushWord();
    const sourceId = `p${number}:t${index}`;
    const validMetrics = Number.isFinite(font.ascent) && Number.isFinite(font.descent)
      && font.ascent > 0 && font.descent <= 0 && font.ascent - font.descent <= 4;
    // Broken zero metrics are not evidence that painted text is invisible.
    const ascent = validMetrics ? font.ascent : 0.9;
    const descent = validMetrics ? font.descent : -0.2;
    const advanceRect = transformedRect(matrix, state.x, state.y + state.rise + state.size * descent,
      advance * state.hScale, state.size * (ascent - descent));
    // Advances omit italic overhang. With missing outlines, preserve a bounded
    // side bearing in the actual crop as well as in the coverage calculation.
    const fallbackInkRect = transformedRect(matrix, state.x - state.size * .2 * state.hScale,
      state.y + state.rise + state.size * descent, (advance + state.size * .4) * state.hScale, state.size * (ascent - descent));
    const rect = completeInk && inkRects.length ? union(inkRects) : fallbackInkRect;
    state.x += advance * state.hScale;
    if (!value.trim()) return;
    characters += value.length;
    if (characters > LIMITS.characters || sources.length >= LIMITS.itemsPerPage) throw wordError('text-large');
    if (!validRect(rect)) throw wordError('geometry');
    const visible = intersect(rect, state.clip);
    const paintMode = state.mode & 3;
    const hidden = !contentVisible || paintMode === 3 || !visible || (paintMode === 0 && state.fillAlpha === 0)
      || (paintMode === 1 && state.strokeAlpha === 0) || (state.fillAlpha === 0 && state.strokeAlpha === 0);
    const source = { id: sourceId, text: value, rect, order: index, disposition: hidden ? 'excluded-hidden' : 'editable',
      ...(encodingCorrections.length ? { encodingCorrections } : {}) };
    sources.push(source);
    if (hidden) return;
    const horizontal = horizontalTextGeometry(matrix, state.size);
    const size = Math.max(1, horizontal?.size ?? state.size * Math.hypot(matrix[2], matrix[3]));
    const partial = !contains(state.clip, rect, Math.min(0.3, size * 0.025));
    const uncertainInk = (paintMode !== 1 && state.fillAlpha < 1) || (paintMode === 1 && state.strokeAlpha < 1);
    const whiteInk = paintMode !== 1 && state.fill === 'FFFFFF';
    const traits = sourceFontTraits(font, value, glyphMetrics.style(state.font));
    const unsupported = state.uncertain || uncertainGlyph || uncertainInk || traits.mathStyleUncertain || font.vertical || font.type3 || !horizontal
      || paintMode !== 1 && state.fillPattern || paintMode !== 0 && state.strokePattern
      || radicalPart && (glyphIndex !== 1 || value !== '\u221a' || horizontal.italic || paintMode !== 0)
      || delimiterPart && (glyphIndex !== 1 || horizontal.italic || paintMode !== 0)
      || /\uFFFD|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);
    if (state.mode >= 4) unsafe('text-clipping');
    text.push({ id: sourceId, sourceIds: [sourceId], text: value, rect: visible, baseline: baseline[1], size,
      font: font.name || '', fontFamily: font.fallbackFamily,
      bold: Boolean(font.bold || font.black || traits.bold) || /bold|black|heavy|semibold|Nimbus(?:RomNo9L|SanL|MonL)-Medi/i.test(font.name || '') || paintMode === 2,
      italic: traits.symbolFace ? Boolean(horizontal?.italic) : Boolean(font.italic || horizontal?.italic || traits.italic)
        || /italic|oblique|Nimbus(?:RomNo9L|SanL|MonL)-(?:Regu|Medi)Ital/i.test(font.name || ''),
      ...(traits.alphabet ? { alphabet: traits.alphabet } : {}),
      ...(traits.mathStyleUncertain ? { mathStyleUncertain: true } : {}),
      ...(!partial && !unsupported && radicalPart ? { radicalPart } : {}),
      ...(!partial && !unsupported && delimiterPart ? { delimiterPart } : {}),
      baselineX: baseline[0], horizontalScale: horizontal?.horizontalScale ?? 1,
      advanceWidth: advance * state.hScale * Math.hypot(matrix[0], matrix[1]),
      advanceRect,
      words: completeInk && words.length > 1 ? words : undefined,
      fontMetrics: glyphMetrics.lineMetrics(state.font),
      preciseInk: completeInk && inkRects.length > 0,
      color: paintMode === 1 ? state.stroke : state.fill,
      ...(!partial && !unsupported && whiteInk ? { requiresDarkBackground: true } : {}),
      order: index, raster: partial || Boolean(unsupported) || whiteInk, reason: partial ? 'partial-text' : unsupported || whiteInk ? 'complex-text' : null });
  }
  for (let index = 0; index < operations.length; index++) {
    const { name, args = [] } = operations[index];
    switch (name) {
      case 'save': stack.push(clone(state)); break;
      case 'restore': state = stack.pop() || state; break;
      case 'transform': state.matrix = multiply(state.matrix, args); break;
      case 'paintFormXObjectBegin':
        stack.push(clone(state));
        if (args[0]) state.matrix = multiply(state.matrix, args[0]);
        if (args[1]) {
          const box = transformedRect(state.matrix, args[1][0], args[1][1], args[1][2] - args[1][0], args[1][3] - args[1][1]);
          state.clip = intersect(state.clip, box) || { x: 0, y: 0, width: 0, height: 0 };
        }
        break;
      case 'paintFormXObjectEnd': state = stack.pop() || state; break;
      case 'beginText': state.textMatrix = [...IDENTITY]; state.x = state.y = state.lineX = state.lineY = 0; break;
      case 'setTextMatrix': state.textMatrix = [...(args.length === 1 ? args[0] : args)]; state.x = state.y = state.lineX = state.lineY = 0; break;
      case 'setFont': state.font = args[0]; state.size = Math.abs(args[1]); state.uncertain = args[1] < 0; break;
      case 'setLeading': state.leading = -args[0]; break;
      case 'moveText': state.lineX += args[0]; state.lineY += args[1]; state.x = state.lineX; state.y = state.lineY; break;
      case 'setLeadingMoveText': state.leading = args[1]; state.lineX += args[0]; state.lineY += args[1]; state.x = state.lineX; state.y = state.lineY; break;
      case 'nextLine': state.lineY += state.leading; state.x = state.lineX; state.y = state.lineY; break;
      case 'setCharSpacing': state.charSpacing = args[0]; break;
      case 'setWordSpacing': state.wordSpacing = args[0]; break;
      case 'setHScale': state.hScale = args[0] / 100; break;
      case 'setTextRise': state.rise = args[0]; break;
      case 'setTextRenderingMode': state.mode = args[0]; break;
      case 'setLineWidth': state.lineWidth = args[0]; break;
      case 'setLineJoin': state.lineJoin = args[0]; break;
      case 'setLineCap': state.lineCap = args[0]; break;
      case 'setMiterLimit': state.miterLimit = args[0]; break;
      case 'setFillRGBColor': state.fill = color(args[0]); state.fillPattern = false; break;
      case 'setStrokeRGBColor': state.stroke = color(args[0]); state.strokePattern = false; break;
      case 'setGState':
        for (const [key, value] of args[0] || []) {
          if (key === 'ca') state.fillAlpha = value;
          else if (key === 'CA') state.strokeAlpha = value;
          else if (key === 'Font') { state.font = value[0]; state.size = Math.abs(value[1]); }
          else if (key === 'LW') state.lineWidth = value;
          else if (key === 'LJ') state.lineJoin = value;
          else if (key === 'LC') state.lineCap = value;
          else if (key === 'ML') state.miterLimit = value;
          else if (key === 'SMask' && value || key === 'BM' && value !== 'source-over') unsafe('compositing');
        }
        break;
      case 'clip': case 'eoClip': pendingClip = true; break;
      case 'constructPath': {
        const [paint, data, limits] = args;
        if (!limits) { if (pendingClip) { unsafe('complex-clipping'); pendingClip = false; } break; }
        const points = pathPoints(data?.[0]);
        if (points && points.every(p => p.close) && !limits.every(Number.isFinite)) {
          // PDF.js uses infinite bounds for an empty path containing only close.
          // Painting it does nothing; clipping by it makes the clip empty.
          if (pendingClip) { state.clip = { x: 0, y: 0, width: 0, height: 0 }; pendingClip = false; }
          break;
        }
        const rect = transformedRect(state.matrix, limits[0], limits[1], limits[2] - limits[0], limits[3] - limits[1]);
        if (!validRect(rect)) throw wordError('geometry');
        if (pendingClip) {
          if (!rectangular(points) || Math.abs(state.matrix[1] * state.matrix[0]) > 0.001 || Math.abs(state.matrix[2] * state.matrix[3]) > 0.001) {
            const graphic = paint === 'endPath' ? boundedGraphicClip(operations, index, stack.length > 0) : null;
            if (graphic) {
              const clipped = intersect(state.clip, rect);
              if (graphic.painted && clipped && contentVisible) images.push({ id: `p${number}:clip${index}`, sourceIds: [],
                rect: clipped, order: graphic.end, raster: true, reason: 'complex-graphics' });
              if (graphic.painted) risks.add('complex-graphics');
              state = stack.pop(); index = graphic.end; pendingClip = false; break;
            }
            unsafe('complex-clipping');
          }
          state.clip = intersect(state.clip, rect) || { x: 0, y: 0, width: 0, height: 0 };
          pendingClip = false;
        }
        if (!contentVisible) break;
        const padding = STROKES.has(paint) ? Math.max(0.2, Math.abs(state.lineWidth) * Math.max(Math.hypot(state.matrix[0], state.matrix[1]), Math.hypot(state.matrix[2], state.matrix[3])) / 2) : 0;
        const paintedRect = { x: rect.x - padding, y: rect.y - padding, width: rect.width + padding * 2, height: rect.height + padding * 2 };
        const clipped = intersect(paintedRect, state.clip);
        if (STROKES.has(paint) && state.strokePattern) unsafe('complex-color');
        if (FILLS.has(paint) && clipped && state.fillAlpha > 0 && !state.fillPattern) paints.push({ rect: clipped, order: index,
          opaque: state.fillAlpha === 1 && rectangular(points), color: state.fill,
          solidRect: !state.uncertain && rectangular(points) && !STROKES.has(paint)
            && Math.abs(state.matrix[1] * state.matrix[0]) < .001 && Math.abs(state.matrix[2] * state.matrix[3]) < .001 });
        const thinFill = FILLS.has(paint) && !state.fillPattern && rectangular(points) && Math.min(rect.width, rect.height) <= 2;
        if (thinFill && Math.max(rect.width, rect.height) > 5) rules.push(rect.width > rect.height
          ? { axis: 'h', at: rect.y + rect.height / 2, from: rect.x, to: rect.x + rect.width }
          : { axis: 'v', at: rect.x + rect.width / 2, from: rect.y, to: rect.y + rect.height });
        if (clipped && ((STROKES.has(paint) && !points && state.strokeAlpha > 0) || (FILLS.has(paint) && state.fillAlpha > 0 && (state.fillPattern || state.fill !== 'FFFFFF')))) {
          images.push({ id: `p${number}:d${index}`, sourceIds: [], rect: clipped, order: index, raster: true, reason: state.fillPattern ? 'complex-color' : 'image', decoration: Boolean(points), thin: thinFill || rect.width < 2 || rect.height < 2,
            fillRect: !state.fillPattern && FILLS.has(paint) && !STROKES.has(paint) && rectangular(points),
            // Keep combined fill/border pixels as a backdrop; do not replace
            // their border styling with native Word cell shading.
            strokedFillRect: !state.fillPattern && !state.uncertain && FILLS.has(paint) && STROKES.has(paint) && rectangular(points)
              && Math.abs(state.matrix[1] * state.matrix[0]) < .001 && Math.abs(state.matrix[2] * state.matrix[3]) < .001,
            opaque: !state.fillPattern && state.fillAlpha === 1 && !state.uncertain && rectangular(points), fillColor: state.fillPattern ? undefined : state.fill });
        }
        if (STROKES.has(paint) && points && state.strokeAlpha > 0) {
          let start, previous, segment = 0;
          for (const p of points) {
            if (p.move) start = previous = p;
            else if (p.close) { if (previous && start) { addRule(previous, start); strokeSegment(previous, start, index, segment++, paint); } }
            else { if (previous) { addRule(previous, p); strokeSegment(previous, p, index, segment++, paint); } previous = p; }
          }
        }
        break;
      }
      case 'showText': addText(args[0], index); break;
      case 'showSpacedText': addText(args[0], index); break;
      case 'nextLineShowText': state.lineY += state.leading; state.x = state.lineX; state.y = state.lineY; addText(args[0], index); break;
      case 'nextLineSetSpacingShowText':
        state.wordSpacing = args[0]; state.charSpacing = args[1]; state.lineY += state.leading;
        state.x = state.lineX; state.y = state.lineY; addText(args[2], index); break;
      case 'paintImageXObject': case 'paintInlineImageXObject': case 'paintImageMaskXObject': case 'paintSolidColorImageMask': {
        if (!contentVisible) break;
        const rect = intersect(transformedRect(state.matrix, 0, 0, 1, 1), state.clip);
        if (rect && area(rect) > 0.1) images.push({ id: `p${number}:i${index}`, sourceIds: [], rect, order: index, raster: true, reason: 'image' });
        break;
      }
      case 'beginGroup': {
        const group = args[0];
        groupStack.push(contentVisible ? { state: clone(state), depth: stack.length } : null);
        if (!contentVisible) break;
        // PDF.js renders a group without isolation as saved state plus a clip.
        // Masks, knockout and non-axis-aligned clips still require final pixels.
        if (!group || group.needsIsolation !== false || group.knockout || group.isGray || group.smask
          || state.fillAlpha !== 1 || state.strokeAlpha !== 1) {
          const box = group?.bbox, matrix = group?.matrix ? multiply(state.matrix, group.matrix) : state.matrix;
          if (box?.length === 4 && Array.from(box).every(Number.isFinite) && matrix.every(Number.isFinite)
            && !group.smask && !group.hasSoftMask) {
            let end = index + 1, depth = 1, hasText = false;
            for (; end < operations.length; end++) {
              const name = operations[end].name;
              if (/^(?:showText|showSpacedText|nextLineShowText|nextLineSetSpacingShowText)$/.test(name)) hasText = true;
              if (name === 'beginGroup' && ++depth > 200) throw wordError('geometry');
              if (name === 'endGroup' && --depth === 0) break;
            }
            // A bounded non-text group can use the final composited pixels.
            // Groups containing text remain conservative until visibility is proven.
            if (depth === 0 && !hasText) {
              const rect = intersect(transformedRect(matrix, box[0], box[1], box[2] - box[0], box[3] - box[1]), state.clip);
              if (rect) images.push({ id: `p${number}:group${index}`, sourceIds: [], rect, order: end,
                raster: true, reason: 'complex-graphics' });
              risks.add('complex-graphics'); groupStack.pop(); index = end; break;
            }
          }
          unsafe('complex-graphics'); break;
        }
        if (group.bbox) {
          const matrix = group.matrix ? multiply(state.matrix, group.matrix) : state.matrix;
          const box = group.bbox;
          if (box.length !== 4 || !Array.from(box).every(Number.isFinite)
            || matrix.length !== 6 || !matrix.every(Number.isFinite)
            || Math.abs(matrix[0] * matrix[1]) > .001 || Math.abs(matrix[2] * matrix[3]) > .001) {
            unsafe('complex-graphics'); break;
          }
          const rect = transformedRect(matrix, box[0], box[1], box[2] - box[0], box[3] - box[1]);
          state.clip = intersect(state.clip, rect) || { x: 0, y: 0, width: 0, height: 0 };
        }
        break;
      }
      case 'endGroup': {
        if (!groupStack.length) { unsafe('complex-graphics'); break; }
        const saved = groupStack.pop();
        if (saved) {
          if (stack.length !== saved.depth) unsafe('complex-graphics');
          state = saved.state;
        }
        break;
      }
      case 'beginAnnotation': {
        const annotation = annotations?.get(index);
        if (!annotation) { unsafe('complex-graphics'); break; }
        if (contentVisible && annotation.rect) images.push({ id: `p${number}:annotation${index}`, sourceIds: [], rect: annotation.rect,
          order: annotation.end, raster: true, reason: 'complex-graphics' });
        index = annotation.end;
        break;
      }
      case 'endAnnotation':
      case 'paintImageXObjectRepeat': case 'paintImageMaskXObjectRepeat': case 'paintImageMaskXObjectGroup':
      case 'paintInlineImageXObjectGroup': case 'shadingFill':
        if (contentVisible) unsafe('complex-graphics'); break;
      case 'beginMarkedContent': markedVisibility.push(contentVisible); break;
      case 'beginMarkedContentProps':
        markedVisibility.push(contentVisible);
        if (args[0] === 'OC') {
          if (typeof args[2] !== 'boolean') unsafe('optional-content');
          else contentVisible = contentVisible && args[2];
        }
        break;
      case 'endMarkedContent': contentVisible = markedVisibility.pop() ?? true; break;
      case 'setFillColorN': state.fillPattern = true; break;
      case 'setStrokeColorN': state.strokePattern = true; break;
      default: break;
    }
    if (stack.length > 200 || groupStack.length > 200 || markedVisibility.length > 200 || !state.matrix.every(Number.isFinite) || !state.textMatrix.every(Number.isFinite)) throw wordError('geometry');
  }
  if (groupStack.length) unsafe('complex-graphics');
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const componentRules = new Map(glyphRadicals(text.filter(item => item.radicalPart), images.filter(item => item.thin)
    .map(item => ({ ...item, color: item.strokeColor || item.fillColor })))
    .map(root => [root.glyphs[0].id, root.strokeIds[0]]));
  const paintIndex = spatialIndex([...paints, ...images]);
  const textIndex = spatialIndex(text);
  for (const item of text) {
    if (item.requiresDarkBackground) {
      if (hasDarkTextBackground(item, paintIndex, textIndex)) { item.raster = false; item.reason = null; }
      delete item.requiresDarkBackground;
    }
    for (const paint of paintIndex(item.rect)) {
      if (paint.order <= item.order || !overlaps(paint.rect, item.rect)) continue;
      if (paint.id && componentRules.get(item.id) === paint.id) continue;
      if (!textInkRects(item).some(rect => overlaps(paint.rect, rect)
        && (!paint.path || strokeMayTouchRect(paint.path, rect)))) continue;
      if (paint.opaque && contains(paint.rect, item.rect)) { item.hidden = true; sourceById.get(item.id).disposition = 'excluded-hidden'; break; }
      item.raster = true; item.reason = 'overlapping-graphics';
    }
  }
  // Only identical, near-coincident redraws qualify; overlaps alone never delete text.
  const seen = new Map();
  const visibleText = text.filter(item => !item.hidden).filter(item => {
    const key = `${item.text}|${Math.round(item.baseline * 2)}|${Math.round(item.rect.x * 2)}|${Math.round(item.size * 2)}`;
    const old = seen.get(key);
    if (old && Math.abs(old.rect.width - item.rect.width) < 0.5 && old.font === item.font && old.color === item.color) {
      old.bold = true;
      sourceById.get(item.id).disposition = 'redraw'; sourceById.get(item.id).equivalentTo = old.id;
      return false;
    }
    seen.set(key, item); return true;
  });
  if (!sources.length && textCharacters > 0) unsafe('unmapped-text');
  const sourceCharacters = sources.reduce((sum, s) => sum + s.text.replace(/\s/g, '').length, 0);
  if (textCharacters > sourceCharacters) unsafe('unmapped-text');
  if (fullRaster) {
    for (const source of sources) if (source.disposition === 'editable') source.disposition = 'visible-image';
    return { number, width, height, sources, items: [{ id: `p${number}:page`, type: 'image', sourceIds: sources.filter(s => s.disposition === 'visible-image').map(s => s.id), rect: bounds, order: 0 }], rules: [], risks: [...risks], rasterPage: true, characters };
  }
  const tableGrids = ruledTableGrids(rules);
  const grouped = groupPageRegions(visibleText, images, rules, sources, { tableFallbackIds, tableGrids, bounds });
  const layered = textLayerMapping ? recoverTableTextLayers({ number, items: grouped.items, text: visibleText, rules, sources, operations, graphics: images, tableGrids })
    : { items: grouped.items, count: 0 };
  const graphicsLayered = textLayerMapping ? recoverGraphicTextLayers({ number, items: layered.items, text: visibleText, sources,
    operations, graphics: images, maxLayers: LIMITS.backgroundLayersPerPage - layered.count }) : { items: layered.items, count: 0 };
  const items = graphicsLayered.items, layers = layered.count + graphicsLayered.count;
  grouped.risks.forEach(reason => risks.add(reason));
  if (!visibleText.length && images.length) risks.add('image-page');
  return { number, width, height, sources, items, rules, drawingOwnership: grouped.drawingOwnership, risks: [...risks], rasterPage: false, characters,
    ...(layers ? { backgroundTextLayers: layers } : {}) };
}
