// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { IDENTITY, multiply, point, transformedRect, intersect, contains, overlaps, union, area, validRect, spatialIndex, strokeMayTouchRect } from './geometry.js';
import { LIMITS, wordError } from './input.js';
import { horizontalTextGeometry, textInkRects } from './text-geometry.js';
import { createGlyphMetrics } from './font-metrics.js';
import { sourceFontTraits } from './font-style.js';
import { groupPageRegions } from './regions.js';
import { glyphRadicals } from './math-glyph-radicals.js';
import { recoverTableTextLayers } from './table-text-layers.js';
import { recoverGraphicTextLayers, protectClippedRuleLayers } from './graphic-text-layers.js';
import { ruledTableGrids } from './tables.js';
import { prepareHorizontalTables } from './horizontal-tables.js';
import { boundedAnnotations } from './annotations.js';
import { hasDarkTextBackground, hasWhiteTextBackground } from './text-background.js';
import { boundedGraphicClip } from './graphic-clipping.js';
import { hasMixedMathLimit, hasCompoundNativeMathRun, hasLinearNativeMathRun, hasNativeMathFunctionRun, MAX_MATH_RUN_GLYPHS } from './math-limit-runs.js';
import { emptyFormTables } from './empty-form-tables.js';
import { nativePairSpacing, MAX_NATIVE_PAIR_GLYPHS, MAX_NATIVE_PAIR_PAGE_GLYPHS } from './native-pair-spacing.js';

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
function rectangleContours(points, maximum = 1) {
  if (!points) return null;
  // PDF generators can leave move-only subpaths before/after a rectangle.
  // They paint no ink and define no clipping area. Counting them as corners
  // falsely rasterizes the entire page, including otherwise native text.
  const contours = []; let current = [], closed = false;
  const finish = () => { if (current.length > 1) contours.push(current); current = []; };
  for (const point of points) {
    if (point.move) { finish(); current = [point]; closed = false; }
    else if (point.close) { finish(); closed = true; }
    else { if (closed || !current.length) return null; current.push(point); }
  }
  finish();
  if (!contours.length || contours.length > maximum) return null;
  for (const vertices of contours) {
    if (vertices.length === 5 && vertices[0].x === vertices[4].x && vertices[0].y === vertices[4].y) vertices.pop();
    const rectangular = vertices.length === 4 && vertices.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))
      && new Set(vertices.map(p => `${p.x},${p.y}`)).size === 4 && vertices.every((p, i) => {
        const q = vertices[(i + 1) % 4];
        return p.x === q.x || p.y === q.y;
      }) && new Set(vertices.map(p => p.x)).size === 2 && new Set(vertices.map(p => p.y)).size === 2;
    if (!rectangular) return null;
  }
  return contours;
}
const rectangleVertices = points => rectangleContours(points)?.[0] || null;

// Only a small union of disjoint axis-aligned rectangles has the same support
// under winding and even-odd clipping. Nested/overlapping contours may have
// holes; their bounding boxes must not be treated as separately filled areas.
function disjointClipRects(points, matrix, clip) {
  if (Math.abs(matrix[1] * matrix[0]) > .001 || Math.abs(matrix[2] * matrix[3]) > .001) return null;
  const contours = rectangleContours(points, 8);
  if (!contours || contours.length < 2) return null;
  const rectangles = contours.map(vertices => {
    const xs = vertices.map(p => p.x), ys = vertices.map(p => p.y);
    return transformedRect(matrix, Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  });
  if (rectangles.some((rect, i) => !validRect(rect) || rectangles.slice(0, i).some(other => intersect(rect, other)))) return null;
  return rectangles.map(rect => intersect(rect, clip)).filter(Boolean);
}

// An opaque white rectangular fill needs the same visibility accounting as a
// normal white PDF rectangle, not a crop of later text. Prove every operation
// in this narrow saved scope; unknown paint/state still uses final pixels.
function whiteClipPaints(operations, start, end, initial, state) {
  if (state.fillAlpha !== 1 || state.fillPattern || state.uncertain) return null;
  let clips = initial, fillColor = state.fill, pending = false;
  const result = [];
  for (let index = start + 1; index < end; index++) {
    const { name, args = [] } = operations[index];
    if (name === 'dependency' || name === 'setFlatness') continue;
    if (name === 'setFillRGBColor') {
      if (typeof args[0] !== 'string' || !/^#[0-9a-f]{6}$/i.test(args[0])) return null;
      fillColor = color(args[0]); continue;
    }
    if (name === 'clip' || name === 'eoClip') { if (pending) return null; pending = true; continue; }
    if (name !== 'constructPath') return null;
    const [paint, data] = args, vertices = rectangleVertices(pathPoints(data?.[0]));
    if (!vertices || !['endPath', 'fill', 'eoFill'].includes(paint)) return null;
    const xs = vertices.map(p => p.x), ys = vertices.map(p => p.y);
    const rect = transformedRect(state.matrix, Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (!validRect(rect)) return null;
    if (pending) { clips = clips.map(clip => intersect(clip, rect)).filter(Boolean); pending = false; }
    if (paint === 'endPath') continue;
    if (fillColor !== 'FFFFFF' || result.length + clips.length > 128) return null;
    for (const clip of clips) {
      const painted = intersect(clip, rect);
      if (painted) result.push({ rect: painted, order: index, opaque: true, color: fillColor, solidRect: true });
    }
  }
  return pending ? null : result;
}

/** Interpret the bounded PDF.js 6 operator snapshot; the PDF renderer remains authoritative for pixels. */
export function buildPageScene({ number, width, height, transform, operations, fonts = {}, textCharacters = 0, textLayerMapping = false }, { tableFallbackIds = [], traceTypography = false, resolveGlyph = null, preserveGeometry = false } = {}) {
  if (!Number.isInteger(number) || number < 1 || !validRect({ x: 0, y: 0, width, height }) || width > 14400 || height > 14400) throw wordError('page-size');
  if (!Array.isArray(operations) || operations.length > LIMITS.operationsPerPage) throw wordError('complexity');
  const bounds = { x: 0, y: 0, width, height }, text = [], images = [], rules = [], paints = [], whiteClips = [], risks = new Set();
  const annotations = boundedAnnotations(operations, transform, bounds);
  const stack = [], groupStack = [], markedVisibility = [], sources = [];
  const glyphMetrics = createGlyphMetrics(fonts);
  let state = { matrix: [...transform], textMatrix: [...IDENTITY], clip: bounds, font: null, size: 12,
    x: 0, y: 0, lineX: 0, lineY: 0, leading: 0, hScale: 1, rise: 0, charSpacing: 0,
    wordSpacing: 0, mode: 0, fill: '000000', stroke: '000000', fillAlpha: 1, strokeAlpha: 1,
    fillPattern: false, strokePattern: false,
    lineWidth: 1, lineJoin: 0, lineCap: 0, miterLimit: 10, uncertain: false };
  let pendingClip = false, characters = 0, fullRaster = false, contentVisible = true, encodingCountDelta = 0;
  let linearTraceRemaining = MAX_MATH_RUN_GLYPHS;
  const deferredLinearTraces = [];
  let deferredTraceGlyphs = 0;
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
  let nativePairGlyphsRemaining = MAX_NATIVE_PAIR_PAGE_GLYPHS;
  const tablePairCandidates=new Map();let tablePairGlyphs=0;
  function addText(glyphs, index) {
    const font = fonts[state.font];
    if (!font || !Array.isArray(glyphs)) { unsafe('font-unsupported'); return; }
    if (glyphs.length > LIMITS.itemsPerPage) throw wordError('complexity');
    const matrix = multiply(state.matrix, state.textMatrix);
    const baseline = point(matrix, state.x, state.y + state.rise);
    // PDF.js divides the pen width by the text matrix's baseline scale before
    // painting glyphs. Font size is separate (some producers use size=1 and a
    // large text matrix). Carry the real stroke into every glyph/crop bound.
    const textScale = Math.hypot(state.textMatrix[0], state.textMatrix[1]);
    const stroke = [1, 2].includes(state.mode & 3) && state.strokeAlpha > 0 && state.lineWidth > 0
      && textScale > 0 && state.size > 0 ? { width: state.lineWidth / textScale / state.size,
        lineJoin: state.lineJoin, lineCap: state.lineCap, miterLimit: state.miterLimit } : null;
    const singleGlyph = glyphs.filter(glyph => glyph && typeof glyph === 'object').length === 1;
    let advance = 0, value = '', completeInk = true, uncertainGlyph = false, glyphIndex = 0, radicalPart = null, delimiterPart = null;
    const inkRects = [], words = [], encodingCorrections = [], glyphPositions = [], positionedGlyphs=[];
    const nativeWordGlyphs = new WeakMap();
    const customFace = traceTypography && !/^(?:[A-Z]{6}\+)?(?:Arial|Helvetica|Times|Courier|Nimbus|Calibri|Cambria|CM[A-Z]*\d|SimSun|SimHei|KaiTi|FangSong)/i.test(font.name || '');
    let word = null, spaceBefore = false, seenGlyph = false, leadingMotion = false, trailingMotion = false;
    const flushWord = () => {
      if (word) {
        const value = { text: word.text, spaceBefore: word.spaceBefore, rect: union(word.rects),
          baselineX: point(matrix, state.x + word.start * state.hScale, state.y + state.rise)[0],
          advanceWidth: (word.end - word.start) * state.hScale * Math.hypot(matrix[0], matrix[1]) };
        if (preserveGeometry && traceTypography && word.text.length >= 2 && word.text.length <= MAX_NATIVE_PAIR_GLYPHS
          && positionedGlyphs.length - word.glyphStart === word.text.length) nativeWordGlyphs.set(value, positionedGlyphs.slice(word.glyphStart));
        words.push(value);
      }
      word = null;
    };
    for (const glyph of glyphs) {
      if (typeof glyph === 'number') {
        const gap = -glyph * state.size / 1000;
        if (Math.abs(gap) > .01) { if (!seenGlyph) leadingMotion = true; trailingMotion = true; }
        if (Math.abs(gap) > state.size * .15) flushWord();
        if (gap > state.size * .22) spaceBefore = true;
        if (gap > state.size * 0.22 && value && !/\s$/.test(value)) value += ' ';
        advance += gap;
      } else if (glyph && typeof glyph.unicode === 'string' && Number.isFinite(glyph.width)) {
        seenGlyph = true; trailingMotion = false;
        const correction = glyphMetrics.symbol(state.font, glyph) || resolveGlyph?.(state.font, glyph), unicode = correction?.text || glyph.unicode;
        const rootComponent = glyphMetrics.radicalPart(state.font, glyph);
        if (rootComponent?.uncertain) uncertainGlyph = true;
        if (rootComponent?.part) radicalPart = rootComponent.part;
        const delimiter = singleGlyph ? glyphMetrics.delimiter(state.font, glyph) : null;
        if (delimiter?.uncertain) uncertainGlyph = true;
        if (delimiter?.delimiterPart) delimiterPart = delimiter.delimiterPart;
        if (correction?.uncertain) uncertainGlyph = true;
        if (correction?.text) {
          encodingCountDelta += glyph.unicode.replace(/\s/g, '').length - unicode.replace(/\s/g, '').length;
          encodingCorrections.push({ glyph: glyphIndex, textRange: [value.length, value.length + unicode.length], from: glyph.unicode, to: unicode, rule: correction.rule,
            ...(correction.evidence ? { evidence: correction.evidence } : {}) });
        }
        // PDF.js skips absent glyphs even if the repaired font's cmap happens
        // to resolve fontChar to a different, visible outline (often '%').
        const ink = glyph.isInFont === false && !font.missingFile ? null
          : glyphMetrics.glyph(state.font, glyph, { fillOnly: (state.mode & 3) === 0, stroke });
        const glyphAdvance = glyph.width * state.size * (font.matrixScale || 0.001) + state.charSpacing + (glyph.isSpace ? state.wordSpacing : 0);
        const inkRect = ink ? transformedRect(matrix,
            state.x + (advance + ink[0] * state.size) * state.hScale, state.y + state.rise + ink[1] * state.size,
            (ink[2] - ink[0]) * state.size * state.hScale, (ink[3] - ink[1]) * state.size) : null;
        if (customFace && unicode.trim() && glyphPositions.length < 200) {
          const proxy = inkRect || transformedRect(matrix,state.x+advance*state.hScale,state.y+state.rise-state.size*.2,glyphAdvance*state.hScale,state.size*1.1);
          glyphPositions.push({text:unicode,rect:proxy});
        }
        if (unicode.trim()) {
          if (inkRect) inkRects.push(inkRect); else completeInk = false;
          if (inkRect) {
            if(traceTypography&&positionedGlyphs.length<4096)positionedGlyphs.push({text:unicode,rect:inkRect,spaceBefore,sourceOffset:value.length,
              baseline:baseline[1],baselineX:point(matrix,state.x+advance*state.hScale,state.y+state.rise)[0],
              advanceWidth:glyphAdvance*state.hScale*Math.hypot(matrix[0],matrix[1])});
            if (!word) { word = { text: '', rects: [], start: advance, end: advance, spaceBefore, glyphStart: positionedGlyphs.length - 1 }; spaceBefore = false; }
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
    const strokePad = stroke ? stroke.width * state.size / 2
      * Math.max(stroke.lineJoin === 0 ? stroke.miterLimit : 1, stroke.lineCap === 2 ? Math.SQRT2 : 1) : 0;
    const fallbackInkRect = transformedRect(matrix, state.x - (state.size * .2 + strokePad) * state.hScale,
      state.y + state.rise + state.size * descent - strokePad, (advance + state.size * .4 + strokePad * 2) * state.hScale,
      state.size * (ascent - descent) + strokePad * 2);
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
    const traceableLinear = completeInk && traceTypography && !partial && !unsupported && !whiteInk
      && (hasLinearNativeMathRun(value, font.name) || hasNativeMathFunctionRun(value, font.name)) && positionedGlyphs.length > 1
      && positionedGlyphs.length <= 64;
    // New operator traces use only the allowance left by existing native runs,
    // even when the new run occurs first in the source operation order.
    const deferredLinear = traceableLinear && /[×÷]/u.test(value);
    const linearTrace = traceableLinear && !deferredLinear && positionedGlyphs.length <= linearTraceRemaining;
    if (linearTrace) linearTraceRemaining -= positionedGlyphs.length;
    // TJ can move before/after the only word without painting a character.
    // Keep the original logical text and command span, but expose that word's
    // physical span to the shared renderer instead of spreading motion as tracking.
    const singletonSpan = completeInk && !partial && !unsupported && !whiteInk && (leadingMotion || trailingMotion)
      && words.length === 1 && words[0].text === value.trim();
    const item = { id: sourceId, sourceIds: [sourceId], text: value, rect: visible, baseline: baseline[1], size,
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
      words: completeInk && traceTypography && /[\p{Script=Han}]/u.test(value) && positionedGlyphs.length>1
        &&positionedGlyphs.map(glyph=>glyph.text).join('')===value.replace(/\s/g,'')?positionedGlyphs:completeInk && (words.length > 1 || singletonSpan) ? words : undefined,
      ...(customFace && glyphPositions.map(glyph=>glyph.text).join('') === value.replace(/\s/g,'') ? { glyphPositions } : {}),
      ...(completeInk && traceTypography && (hasMixedMathLimit(value) || hasCompoundNativeMathRun(value, font.name) || linearTrace) && positionedGlyphs.length > 1
        && positionedGlyphs.length <= MAX_MATH_RUN_GLYPHS ? { mathGlyphPositions: positionedGlyphs } : {}),
      fontMetrics: glyphMetrics.lineMetrics(state.font),
      preciseInk: completeInk && inkRects.length > 0,
      color: paintMode === 1 ? state.stroke : state.fill,
      ...(!partial && !unsupported && whiteInk ? { requiresDarkBackground: true } : {}),
      ...(!partial && !unsupported && whiteInk && paintMode === 0 ? { whitePaintOnly: true } : {}),
      order: index, raster: partial || Boolean(unsupported) || whiteInk, reason: partial ? 'partial-text' : unsupported || whiteInk ? 'complex-text' : null };
    if (preserveGeometry && traceTypography && completeInk && !item.raster && nativePairGlyphsRemaining > 0) {
      for (const word of words) {
        const glyphs = nativeWordGlyphs.get(word);
        if (!glyphs || glyphs.length > nativePairGlyphsRemaining) continue;
        const proof = nativePairSpacing({ ...item, ...word }, glyphs, { charSpacing: state.charSpacing, wordSpacing: state.wordSpacing,
          horizontal: !font.vertical && state.hScale === 1 && matrix[0] > 0 && Math.abs(matrix[1]) < 1e-8 && Math.abs(matrix[2]) < 1e-8 });
        if (proof) { word.nativePairSpacing = proof; nativePairGlyphsRemaining -= glyphs.length; }
        else if(/^(?:[A-Z]{6}\+)?NimbusRomNo9L-Regu$/i.test(item.font||'')&&tablePairGlyphs+glyphs.length<=MAX_NATIVE_PAIR_PAGE_GLYPHS){
          const optional=nativePairSpacing({...item,...word},glyphs,{charSpacing:state.charSpacing,wordSpacing:state.wordSpacing,
            horizontal:!font.vertical&&state.hScale===1&&matrix[0]>0&&Math.abs(matrix[1])<1e-8&&Math.abs(matrix[2])<1e-8,compatibleFace:true});
          if(optional){const existing=tablePairCandidates.get(item.id)||[];existing.push(optional);tablePairCandidates.set(item.id,existing);tablePairGlyphs+=glyphs.length;}
        }
      }
      if (!item.words && words.length === 1 && words[0].text === item.text
        && Math.abs(words[0].baselineX - item.baselineX) < .001
        && Math.abs(words[0].advanceWidth - item.advanceWidth) < .001
        && words[0].nativePairSpacing) item.nativePairSpacing = words[0].nativePairSpacing;
    }
    text.push(item);
    if (deferredLinear && deferredTraceGlyphs + positionedGlyphs.length <= MAX_MATH_RUN_GLYPHS) {
      deferredLinearTraces.push({ item, positions: positionedGlyphs });
      deferredTraceGlyphs += positionedGlyphs.length;
    }
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
        const vertices = rectangleVertices(points), simpleRect = Boolean(vertices);
        const pathBounds = vertices ? [Math.min(...vertices.map(p=>p.x)),Math.min(...vertices.map(p=>p.y)),
          Math.max(...vertices.map(p=>p.x)),Math.max(...vertices.map(p=>p.y))] : limits;
        const rect = transformedRect(state.matrix, pathBounds[0], pathBounds[1], pathBounds[2] - pathBounds[0], pathBounds[3] - pathBounds[1]);
        if (!validRect(rect)) throw wordError('geometry');
        if (pendingClip) {
          if (!simpleRect || Math.abs(state.matrix[1] * state.matrix[0]) > 0.001 || Math.abs(state.matrix[2] * state.matrix[3]) > 0.001) {
            const graphic = paint === 'endPath' ? boundedGraphicClip(operations, index, stack.length > 0) : null;
            if (graphic) {
              const parts = disjointClipRects(points, state.matrix, state.clip);
              const clipped = parts || [intersect(state.clip, rect)].filter(Boolean);
              const white = parts && whiteClipPaints(operations, index, graphic.end, parts, state);
              if (contentVisible && white) { paints.push(...white); whiteClips.push(...white); }
              else if (graphic.painted && contentVisible) clipped.forEach((region, part) => images.push({
                id: `p${number}:clip${index}${parts ? `-${part}` : ''}`, sourceIds: [],
                rect: region, order: graphic.end, raster: true, reason: 'complex-graphics' }));
              if (graphic.painted && !white) risks.add('complex-graphics');
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
          opaque: state.fillAlpha === 1 && simpleRect, color: state.fill,
          solidRect: !state.uncertain && simpleRect && !STROKES.has(paint)
            && Math.abs(state.matrix[1] * state.matrix[0]) < .001 && Math.abs(state.matrix[2] * state.matrix[3]) < .001 });
        const thinFill = FILLS.has(paint) && !state.fillPattern && simpleRect && Math.min(rect.width, rect.height) <= 2;
        if (thinFill && Math.max(rect.width, rect.height) > 5) rules.push(rect.width > rect.height
          ? { axis: 'h', at: rect.y + rect.height / 2, from: rect.x, to: rect.x + rect.width }
          : { axis: 'v', at: rect.x + rect.width / 2, from: rect.y, to: rect.y + rect.height });
        if (clipped && ((STROKES.has(paint) && !points && state.strokeAlpha > 0) || (FILLS.has(paint) && state.fillAlpha > 0 && (state.fillPattern || state.fill !== 'FFFFFF')))) {
          images.push({ id: `p${number}:d${index}`, sourceIds: [], rect: clipped, order: index, raster: true, reason: state.fillPattern ? 'complex-color' : 'image', decoration: Boolean(points), thin: thinFill || rect.width < 2 || rect.height < 2,
            fillRect: !state.fillPattern && FILLS.has(paint) && !STROKES.has(paint) && simpleRect,
            // Keep combined fill/border pixels as a backdrop; do not replace
            // their border styling with native Word cell shading.
            strokedFillRect: !state.fillPattern && !state.uncertain && FILLS.has(paint) && STROKES.has(paint) && simpleRect
              && Math.abs(state.matrix[1] * state.matrix[0]) < .001 && Math.abs(state.matrix[2] * state.matrix[3]) < .001,
            opaque: !state.fillPattern && state.fillAlpha === 1 && !state.uncertain && simpleRect, fillColor: state.fillPattern ? undefined : state.fill });
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
        const full = transformedRect(state.matrix, 0, 0, 1, 1), rect = intersect(full, state.clip);
        const completeImage = name === 'paintImageXObject' && state.fillAlpha === 1 && !state.uncertain && state.matrix[0] > 0 && state.matrix[3] < 0
          && Math.abs(state.matrix[1]) < .00001 && Math.abs(state.matrix[2]) < .00001 && rect && area(rect) >= area(full) * .8;
        if (rect && area(rect) > 0.1) images.push({ id: `p${number}:i${index}`, sourceIds: [], rect, order: index, raster: true, reason: 'image',
          ...(completeImage && full.width >= 20 && full.width <= 180 && full.height >= 8 && full.height <= 35
            ? { rasterSource: { operation: index, rect: full } } : {}) });
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
  for (const { item, positions } of deferredLinearTraces) {
    if (positions.length > linearTraceRemaining) continue;
    item.mathGlyphPositions = positions;
    linearTraceRemaining -= positions.length;
  }
  if (groupStack.length) unsafe('complex-graphics');
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const componentRules = new Map(glyphRadicals(text.filter(item => item.radicalPart), images.filter(item => item.thin)
    .map(item => ({ ...item, color: item.strokeColor || item.fillColor })))
    .map(root => [root.glyphs[0].id, root.strokeIds[0]]));
  const paintIndex = spatialIndex([...paints, ...images]);
  // Raw image OCR must never recover ink later hidden by a white rectangle or
  // another paint. Visible fallback assets continue to use the composited page.
  for (const image of images) if (image.rasterSource && paintIndex(image.rect).some(paint => paint !== image
    && paint.order > image.order && overlaps(paint.rect, image.rect, 0))) delete image.rasterSource;
  const textIndex = spatialIndex(text);
  for (const item of text) {
    if (item.requiresDarkBackground) {
      if (hasDarkTextBackground(item, paintIndex, textIndex)) { item.raster = false; item.reason = null; }
      else if (item.whitePaintOnly && hasWhiteTextBackground(item,paintIndex,textIndex)) {
        item.hidden = true; sourceById.get(item.id).disposition = 'excluded-hidden';
      }
      delete item.requiresDarkBackground;
      delete item.whitePaintOnly;
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
  // Compare extraction against the original encoded glyph count. A proven
  // repair may turn a control-code glyph into a space; that is not lost ink.
  const sourceCharacters = sources.reduce((sum, source) => sum + source.text.replace(/\s/g, '').length, encodingCountDelta);
  if (textCharacters > sourceCharacters) unsafe('unmapped-text');
  if (fullRaster) {
    for (const source of sources) if (source.disposition === 'editable') source.disposition = 'visible-image';
    return { number, width, height, sources, items: [{ id: `p${number}:page`, type: 'image', sourceIds: sources.filter(s => s.disposition === 'visible-image').map(s => s.id), rect: bounds, order: 0 }], rules: [], risks: [...risks], rasterPage: true, characters };
  }
  const horizontal = prepareHorizontalTables(visibleText, images, rules, sources, bounds);
  const regionText = horizontal.text;
  const tableGrids = ruledTableGrids(rules);
  const grouped = groupPageRegions(regionText, images, rules, sources, { tableFallbackIds, tableGrids, horizontalTables: horizontal.tables, bounds });
  const layered = textLayerMapping ? recoverTableTextLayers({ number, items: grouped.items, text: regionText, rules, sources, operations, graphics: images, tableGrids, tableFallbackIds })
    : { items: grouped.items, count: 0 };
  const graphicsLayered = textLayerMapping ? recoverGraphicTextLayers({ number, items: layered.items, text: regionText, sources,
    operations, graphics: images, bounds, maxLayers: LIMITS.backgroundLayersPerPage - layered.count }) : { items: layered.items, count: 0 };
  const items = preserveGeometry === true ? emptyFormTables({ number, items: graphicsLayered.items,
    text: regionText, rules, graphics: images, bounds, tableGrids, tableFallbackIds }).items : graphicsLayered.items;
  const protectedRules = textLayerMapping ? protectClippedRuleLayers({ number, items, sources, operations, whiteClips,
    maxLayers: LIMITS.backgroundLayersPerPage - layered.count - graphicsLayered.count }) : { items, count: 0 };
  // Optional compatible pairs spend only the allowance left AFTER all
  // legacy pairs, and bind solely inside a complete proven open grid.
  const bindPairs=blocks=>{for(const block of blocks){
    if(block.nativeOpenGrid===true)for(const cell of block.cells)for(const paragraph of cell.blocks)for(const line of paragraph.lines||[])for(const item of line.items){
      const candidates=tablePairCandidates.get(item.id);if(!candidates)continue;
      for(const word of item.words?.length?item.words:[item]){
        if(word.nativePairSpacing)continue;
        const proofs=candidates.filter(proof=>proof.text===word.text&&proof.sourceFont===item.font&&proof.size===(word.size??item.size)
          &&Math.abs(proof.origin-word.baselineX)<.001&&Math.abs(proof.advance-word.advanceWidth)<.001);
        if(proofs.length!==1||proofs[0].glyphs.length>nativePairGlyphsRemaining)continue;
        word.nativePairSpacing=proofs[0];nativePairGlyphsRemaining-=proofs[0].glyphs.length;
      }
    }
    if(block.columns)block.columns.forEach(col=>bindPairs(col.blocks));
  }};
  bindPairs(protectedRules.items);tablePairCandidates.clear();
  const layers = layered.count + graphicsLayered.count + protectedRules.count;
  grouped.risks.forEach(reason => risks.add(reason));
  if (!visibleText.length && images.length) risks.add('image-page');
  return { number, width, height, sources, items: protectedRules.items, rules, drawingOwnership: grouped.drawingOwnership, risks: [...risks], rasterPage: false, characters,
    ...(layers ? { backgroundTextLayers: layers } : {}) };
}
