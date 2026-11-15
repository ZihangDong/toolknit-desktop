// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { nativeTableFunctionGlyphs, nativeTableNumericGlyphs } from '../core/native-table-row.js';
import { mathWordFont, wordFont } from './docx-fonts.js';
import { MAX_POSITIONED_FRAMES } from '../core/positioned-budget.js';
import { completeMathGlyphPositions } from '../core/math-limit-runs.js';
import { compressedPunctuationChunks } from '../core/text-chunks.js';

const knownFace = /^(?:[A-Z]{6}\+)?(?:CMMI(?:B)?\d{1,2}|CMR\d{1,2}|TimesNewRomanPSMT|NimbusRomNo9L-ReguItal|Cambria(?:Math)?(?:[-,](?:Regular|Italic|Bold|BoldItalic))?)$/i;
const finiteBox = rect => rect && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]))
  && rect.width > 0 && rect.height > 0;
const sameBox = (a, b) => finiteBox(a) && finiteBox(b)
  && ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < .001);
const symbolFace = /^(?:[A-Z]{6}\+)?CMSY(?:[5-9]|1[012])$/i;
const linearSymbols = /^[\p{Script=Latin}\p{Script=Greek}0-9\s()[\]{}|.,:;'+\-−=<>≤≥≠∈·×÷/∞]+$/u;

function fitLetter(glyph, context, forcedFont = null, minimumScale = 70) {
  // Cambria Math has no italic face. Canvas and Office synthesize different
  // slants for ordinary Latin runs, changing their left bearing after export.
  // Use a real italic face for proven CMMI letters; operators keep the math face.
  const font = forcedFont || (glyph.italic && /^[A-Za-z]+$/.test(glyph.text)
    && /^(?:[A-Z]{6}\+)?CMMI(?:B)?\d{1,2}$/i.test(glyph.font || '')
    ? 'Cambria' : mathWordFont(glyph));
  context.font = `${glyph.italic ? 'italic ' : ''}${glyph.bold ? 'bold ' : ''}1000px "${font}"`;
  context.fontKerning = 'none';
  const metrics = context.measureText(glyph.text);
  const inkHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  const inkWidth = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
  if (!(inkHeight > 0 && inkWidth > 0 && metrics.width > 0)) return null;
  const size = Math.round(glyph.rect.height * 1000 / inkHeight * 2) / 2;
  const scale = Math.round(glyph.rect.width * 100000 / (inkWidth * size));
  if (!(size >= 1 && size <= 400 && size / glyph.size >= .7 && size / glyph.size <= 1.5
    && scale >= minimumScale && scale <= 150)) return null;
  return { font, size, glyphScale: scale, advanceWidth: metrics.width / 1000 * size * scale / 100 };
}

export function fitNativeMappingArrow(glyph, context) {
  if (!context || glyph?.text !== '⇒' || glyph.raster !== false || !glyph.preciseInk || !finiteBox(glyph.rect)
    || glyph.ocr || glyph.bold || glyph.italic || glyph.alphabet || glyph.mathStyleUncertain
    || glyph.radicalPart || glyph.delimiterPart || !/^(?:[A-Z]{6}\+)?XITSMath-Regular$/i.test(glyph.font || '')
    || !Number.isFinite(glyph.size) || glyph.size < 5 || glyph.size > 20 || !Number.isFinite(glyph.baseline)) return null;
  return fitLetter(glyph, context);
}

// Ordinary word children remain inside one parent frame. Only proven physical
// chunk breaks can expand them into separate frames in the positioned writer.
function existingFrameCost(scene) {
  const queue = [...scene.items], seen = new Set(); let cost = 0;
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    if (index >= 20000 || !node || typeof node !== 'object') return MAX_POSITIONED_FRAMES;
    if (seen.has(node)) continue;
    seen.add(node);
    if (node.type === 'image' && node.role === 'math') cost++;
    else if (typeof node.text === 'string' && finiteBox(node.rect) && !node.mathGlyphs) {
      cost += node.words?.length > 1 && compressedPunctuationChunks({ items: [node] }).length > 1 ? node.words.length : 1;
    }
    if (cost >= MAX_POSITIONED_FRAMES) return cost;
    for (const key of ['items', 'blocks', 'lines', 'cells', 'columns']) if (Array.isArray(node[key])) {
      if (queue.length + node[key].length > 20000) return MAX_POSITIONED_FRAMES;
      queue.push(...node[key]);
    }
  }
  return cost;
}

function fitLinearGlyph(glyph, context) {
  const roman = /^(?:[A-Z]{6}\+)?CMR\d{1,2}$/i.test(glyph.font || '') && /^[\x20-\x7e]+$/.test(glyph.text);
  const fit = fitLetter(roman ? { ...glyph, font: 'Times New Roman' } : glyph, context);
  if (fit || glyph.text !== '−' || !symbolFace.test(glyph.font || '') || glyph.bold || glyph.italic) return fit;
  // A thin minus has too little vertical ink to estimate an em size reliably.
  // Use its original nominal size only if both measured dimensions agree.
  context.font = '1000px "Cambria Math"'; context.fontKerning = 'none';
  const metrics = context.measureText(glyph.text), size = Math.round(glyph.size * 2) / 2;
  const width = (metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight) * size / 1000;
  const height = (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) * size / 1000;
  const scale = Math.round(glyph.rect.width / width * 100);
  return width > 0 && height > 0 && Math.abs(height - glyph.rect.height) <= .3 && scale >= 70 && scale <= 150
    ? { font: 'Cambria Math', size, glyphScale: scale, advanceWidth: metrics.width * size / 1000 * scale / 100 } : null;
}

/** A flat native argument can be split from its function name by a font change.
 * The visible source neighbour supplies the ONE opening parenthesis; it stays
 * independently owned and is never copied into the recovered fragment.
 */
function adjacentFunctionOpening(text, glyphs, scene, sources) {
  if (!/^[A-Za-z0-9]{1,12}\)$/.test(text)) return false;
  const first = glyphs[0]; let matches = 0;
  for (const peer of scene.items) {
    const source = peer.sourceIds?.length === 1 && sources.get(peer.sourceIds[0]);
    if (peer.type !== 'text' || peer.raster !== false || !peer.preciseInk || peer.ocr || peer.mathGlyphs
      || peer.bold || peer.italic || peer.alphabet || peer.mathStyleUncertain || peer.radicalPart || peer.delimiterPart
      || !/^[A-Za-z]{1,16}\($/.test(peer.text || '') || !/^(?:[A-Z]{6}\+)?CMR\d{1,2}$/i.test(peer.font || '')
      || !source || source.disposition !== 'editable' || source.id !== peer.id || source.text !== peer.text
      || !sameBox(source.rect, peer.rect) || !finiteBox(peer.rect)
      || peer.rect.x < 0 || peer.rect.y < 0 || peer.rect.x + peer.rect.width > scene.width || peer.rect.y + peer.rect.height > scene.height
      || !(Math.abs(peer.baseline - first.baseline) < .05 && Math.abs(peer.size - first.size) < .01)
      || peer.color !== first.color || peer.rect.x + peer.rect.width > first.rect.x
      || first.rect.x - peer.rect.x - peer.rect.width > first.size * .4) continue;
    if (++matches > 1) return false;
  }
  return matches === 1;
}

// Degree runs must retain complete source positions. The ordinary C and
// fullwidth range mark have distinct proven text faces, not guessed math roles.
function nativeTemperatureRange(glyphs) {
  return glyphs.length === 5 && glyphs.every(glyph => !glyph.bold && !glyph.italic)
    && [0, 3].every(index => /^\d{1,4}°$/u.test(glyphs[index].text)
      && /^(?:[A-Z]{6}\+)?XITSMath-Regular$/i.test(glyphs[index].font || ''))
    && [1, 4].every(index => glyphs[index].text === 'C'
      && /^(?:[A-Z]{6}\+)?(?:TimesNewRomanPSMT|Times-Roman)$/i.test(glyphs[index].font || ''))
    && glyphs[2].text === '～' && /^(?:[A-Z]{6}\+)?SimSun$/i.test(glyphs[2].font || '');
}

/** The open parenthesis belongs to an adjacent complete citation, not to an
 * incomplete formula. Prove the visible native suffix without consuming or
 * rewriting it. Unknown, nested and interrupted rows retain the original image.
 */
function nativeParenthesizedMapping(glyphs, scene, sources, work) {
  if (glyphs.length !== 2 || glyphs[0].text !== '⇒' || glyphs[1].text !== '('
    || !/^(?:[A-Z]{6}\+)?XITSMath-Regular$/i.test(glyphs[0].font || '')
    || !/^(?:[A-Z]{6}\+)?TimesNewRomanPSMT$/i.test(glyphs[1].font || '')
    || glyphs.some(glyph => glyph.bold || glyph.italic) || work.remaining < scene.items.length * 2) return false;
  work.remaining -= scene.items.length * 2;
  const opening = glyphs[1], start = opening.rect.x + opening.rect.width;
  const peers = scene.items.filter(peer => peer.type === 'text' && finiteBox(peer.rect)
    && Math.abs(peer.baseline - opening.baseline) < .05 && peer.rect.x >= start - .01
    && peer.rect.x - start <= opening.size * 16).sort((a, b) => a.rect.x - b.rect.x);
  const end = peers.findIndex(peer => peer.text === ')');
  if (end < 1 || end >= 32) return false;
  const suffix = peers.slice(0, end + 1), identities = new Set(); let right = start;
  for (const peer of suffix) {
    const source = peer.sourceIds?.length === 1 && sources.get(peer.sourceIds[0]);
    if (peer.raster !== false || !peer.preciseInk || peer.ocr || peer.mathGlyphs || peer.alphabet || peer.mathStyleUncertain
      || peer.radicalPart || peer.delimiterPart || peer.bold || peer.italic || !Number.isFinite(peer.size)
      || Math.abs(peer.size - opening.size) > .01 || peer.color !== opening.color
      || peer.rect.x < 0 || peer.rect.y < 0 || peer.rect.x + peer.rect.width > scene.width
      || peer.rect.y + peer.rect.height > scene.height
      || !/^(?:[A-Z]{6}\+)?(?:TimesNewRomanPSMT|SimSun)$/i.test(peer.font || '')
      || !source || source.id !== peer.id || identities.has(source.id) || source.disposition !== 'editable'
      || source.text !== peer.text || !sameBox(source.rect, peer.rect)
      || peer.rect.x < right - .01 || peer.rect.x - right > opening.size * .75) return false;
    identities.add(source.id); right = peer.rect.x + peer.rect.width;
  }
  const text = suffix.map(peer => peer.text).join('');
  if (text.length > 128 || !/^[\p{Script=Han}A-Za-z0-9\s.,;;，、·'’\-]+\)$/u.test(text)
    || !/[\p{Script=Han}A-Za-z]/u.test(text) || !/\d/u.test(text)) return false;
  // A separate drawing or off-baseline text inside this interval makes the
  // apparently complete suffix ambiguous. Superscripts after ')' stay separate.
  const top = Math.min(opening.rect.y, ...suffix.map(peer => peer.rect.y));
  const bottom = Math.max(opening.rect.y + opening.rect.height, ...suffix.map(peer => peer.rect.y + peer.rect.height));
  return !scene.items.some(peer => !identities.has(peer.id) && finiteBox(peer.rect)
    && peer.rect.x < right - .01 && peer.rect.x + peer.rect.width > start + .01
    && peer.rect.y < bottom - .01 && peer.rect.y + peer.rect.height > top + .01);
}

function linearTextPlan(item, scene, sources, context, recovery, work) {
  let glyphs = item.mathGlyphs;
  if (item.type !== 'image' || item.role !== 'math' || !Array.isArray(glyphs) || !glyphs.length || glyphs.length > 16
    || glyphs.some(glyph => !glyph || !finiteBox(glyph.rect) || typeof glyph.text !== 'string' || !glyph.text || glyph.text.length > 64)
    || item.mathStrokes?.length || item.drawingIds?.length || item.reasons?.length || item.backgroundPaintIndexes?.length
    || !finiteBox(item.rect) || !Number.isFinite(item.order)
    || item.sourceIds?.length !== glyphs.length || new Set(item.sourceIds).size !== glyphs.length) return null;
  // Region discovery can append a proven dot after its right-hand number.
  // Existing baseline, overlap and source checks still prove a single flat row.
  glyphs = [...glyphs].sort((a, b) => a.rect.x - b.rect.x);
  const text = glyphs.map(glyph => glyph.text).join('');
  const temperature = recovery === 'temperature' && nativeTemperatureRange(glyphs);
  const mapping = recovery === 'mapping' && nativeParenthesizedMapping(glyphs, scene, sources, work);
  if (recovery !== 'legacy' && !temperature && !mapping) return null;
  // Bare operators retain their independently verified native-math path.
  if (text.length > 64 || !temperature && !mapping && !linearSymbols.test(text)
    || !mapping && !/[\p{Script=Latin}\p{Script=Greek}0-9]/u.test(text)) return null;
  const stack = adjacentFunctionOpening(text, glyphs, scene, sources) ? ['('] : [];
  const pairs = { ')': '(', ']': '[', '}': '{' };
  for (const character of text) {
    if ('([{'.includes(character)) stack.push(character);
    else if (Object.hasOwn(pairs, character) && stack.pop() !== pairs[character]) return null;
  }
  if (stack.length && !mapping) return null;
  const first = glyphs[0], owned = [], items = [];
  for (const [index, glyph] of glyphs.entries()) {
    const source = sources.get(glyph.id), previous = glyphs[index - 1];
    if (!source || !item.sourceIds.includes(glyph.id) || source.disposition !== 'visible-image'
      || source.text !== glyph.text || !sameBox(source.rect, glyph.rect) || glyph.raster !== false || !glyph.preciseInk
      || glyph.ocr || glyph.alphabet || glyph.mathStyleUncertain || glyph.radicalPart || glyph.delimiterPart
      || !(temperature || mapping || knownFace.test(glyph.font || '') || symbolFace.test(glyph.font || ''))
      || !Number.isFinite(glyph.baseline) || Math.abs(glyph.baseline - first.baseline) > .05
      || !(glyph.size >= 1 && glyph.size <= 400) || Math.abs(glyph.size - first.size) > .01
      || !/^[0-9a-f]{6}$/i.test(glyph.color || '') || glyph.color !== first.color
      || glyph.rect.x < 0 || glyph.rect.y < 0 || glyph.rect.x + glyph.rect.width > scene.width
      || glyph.rect.y + glyph.rect.height > scene.height
      || glyph.rect.x < item.rect.x - .01 || glyph.rect.y < item.rect.y - .01
      || glyph.rect.x + glyph.rect.width > item.rect.x + item.rect.width + .01
      || glyph.rect.y + glyph.rect.height > item.rect.y + item.rect.height + .01
      || previous && (glyph.rect.x < previous.rect.x + previous.rect.width - .25
        || glyph.rect.x - previous.rect.x - previous.rect.width > first.size * 1.5)) return null;
    const trace = completeMathGlyphPositions(glyph, 64);
    if (symbolFace.test(glyph.font || '') && [...glyph.text].length !== 1
      || glyph.mathGlyphPositions !== undefined && !trace
      || !trace && [...glyph.text].length > 1 && !/^(?:[A-Za-z]{1,12}|[0-9]{1,6})$/.test(glyph.text)) return null;
    let fit;
    if (trace) {
      const words = [];
      for (const part of trace) {
        const value = fitLinearGlyph({ ...glyph, ...part }, context);
        if (!value) return null;
        words.push({ ...part, ...value, baseline: glyph.baseline, bold: Boolean(glyph.bold), italic: Boolean(glyph.italic), preciseInk: true });
      }
      fit = { font: words[0].font, size: glyph.size, words, nativeCalibrated: true };
    } else fit = temperature && glyph.text === '～' ? fitLetter(glyph, context, 'SimSun') : fitLinearGlyph(glyph, context);
    if (!fit) return null;
    owned.push(source);
    items.push({ id: glyph.id, type: 'text', text: glyph.text, sourceIds: [source.id],
      order: item.order + index / glyphs.length, rect: { ...glyph.rect }, ...fit, baseline: glyph.baseline,
      sourceFont: glyph.font, sourceSize: glyph.size, color: glyph.color,
      ...(mapping ? { nativeCalibrated: true } : {}),
      bold: Boolean(glyph.bold), italic: Boolean(glyph.italic), preciseInk: true });
  }
  return { sources: owned, items, cost: items.reduce((sum, item) => sum + (item.words?.length || 1), 0) - 1 };
}

function recoverLinearText(scene, sources, context, recovery = 'legacy') {
  if (!Array.isArray(scene.items) || scene.items.length > 20000) return;
  let remaining = MAX_POSITIONED_FRAMES - existingFrameCost(scene);
  const work = { remaining: 40000 };
  if (remaining < 1) return;
  scene.items = scene.items.flatMap(item => {
    const plan = linearTextPlan(item, scene, sources, context, recovery, work);
    if (!plan || plan.cost > remaining) return item;
    plan.sources.forEach(source => { source.disposition = 'editable'; });
    remaining -= plan.cost;
    return plan.items;
  });
}

/** A complete, upright inline operator needs no synthetic limit/body nodes.
 * This does not recover compound integrals or count ordinary symbols as OMML.
 * The XITS integral is narrower than Cambria's, requiring a separately verified
 * 65% minimum; the general letter/structured formula guards remain unchanged.
 */
function recoverStandaloneIntegrals(scene, sources, context) {
  if (!Array.isArray(scene.items) || scene.items.length > 20000 || existingFrameCost(scene) >= MAX_POSITIONED_FRAMES) return;
  let remaining = 40000;
  scene.items = scene.items.map(item => {
    if (item.type !== 'image' || item.role !== 'math' || item.mathGlyphs?.length !== 1 || item.sourceIds?.length !== 1
      || item.mathStrokes?.length || item.drawingIds?.length || item.reasons?.length || item.backgroundPaintIndexes?.length) return item;
    const glyph = item.mathGlyphs[0], source = sources.get(item.sourceIds[0]);
    if (!glyph || !/^[∫∮]$/u.test(glyph.text || '') || !/^(?:[A-Z]{6}\+)?XITSMath-Regular$/i.test(glyph.font || '')
      || glyph.raster !== false || !glyph.preciseInk || glyph.ocr || glyph.bold || glyph.italic || glyph.alphabet
      || glyph.mathStyleUncertain || glyph.radicalPart || glyph.delimiterPart || glyph.mathGlyphPositions !== undefined
      || !source || source.id !== glyph.id || source.text !== glyph.text || source.disposition !== 'visible-image'
      || !sameBox(glyph.rect, item.rect) || !sameBox(source.rect, item.rect) || !Number.isFinite(item.order)
      || !Number.isFinite(glyph.baseline) || !Number.isFinite(glyph.size) || glyph.size < 5 || glyph.size > 24
      || !/^[0-9a-f]{6}$/i.test(glyph.color || '') || glyph.rect.x < 0 || glyph.rect.y < 0
      || glyph.rect.x + glyph.rect.width > scene.width || glyph.rect.y + glyph.rect.height > scene.height) return item;
    let owners = 0;
    for (const entry of scene.sources) {
      if (--remaining < 0) return item;
      if (entry.id === source.id) owners++;
    }
    if (owners !== 1) return item;
    for (const peer of scene.items) {
      if (--remaining < 0) return item;
      if (peer === item || !finiteBox(peer.rect)) continue;
      if (Math.min(peer.rect.x + peer.rect.width, item.rect.x + item.rect.width) - Math.max(peer.rect.x, item.rect.x) > .1
        && Math.min(peer.rect.y + peer.rect.height, item.rect.y + item.rect.height) - Math.max(peer.rect.y, item.rect.y) > .1) return item;
    }
    const fit = fitLetter(glyph, context, 'Cambria Math', 65);
    if (!fit) return item;
    source.disposition = 'editable';
    return { id: glyph.id, type: 'text', text: glyph.text, sourceIds: [source.id], order: item.order,
      rect: { ...glyph.rect }, ...fit, baseline: glyph.baseline, sourceFont: glyph.font, sourceSize: glyph.size,
      color: glyph.color, bold: false, italic: false, preciseInk: true, nativeCalibrated: true };
  });
}

function recoverNumericRange(item, scene, sources, context) {
  const glyphs = item.mathGlyphs;
  if (item.type !== 'image' || item.role !== 'math' || !Array.isArray(glyphs)
    || glyphs.length < 3 || glyphs.length > 9 || item.mathStrokes?.length
    || item.drawingIds?.length || item.reasons?.length || item.backgroundPaintIndexes?.length
    || item.sourceIds?.length !== glyphs.length || new Set(item.sourceIds).size !== glyphs.length
    || !finiteBox(item.rect) || !/^\d{1,4}~\d{1,4}$/.test(glyphs.map(glyph => glyph.text).join(''))) return null;
  const first = glyphs[0], family = wordFont(first.font);
  if (!['Times New Roman', 'Arial', 'Courier New', 'Calibri', 'Cambria'].includes(family)) return null;
  const owned = [], items = [];
  for (const [index, glyph] of glyphs.entries()) {
    const source = sources.get(glyph.id), previous = glyphs[index - 1];
    if (!source || !item.sourceIds.includes(glyph.id) || source.disposition !== 'visible-image'
      || source.text !== glyph.text || !/^[0-9~]$/.test(glyph.text)
      || !sameBox(source.rect, glyph.rect) || glyph.raster !== false || !glyph.preciseInk
      || glyph.ocr || glyph.alphabet || glyph.mathStyleUncertain || glyph.radicalPart || glyph.delimiterPart
      || glyph.bold || glyph.italic || glyph.font !== first.font
      || !Number.isFinite(glyph.baseline) || Math.abs(glyph.baseline - first.baseline) > .05
      || !(glyph.size >= 1 && glyph.size <= 400) || Math.abs(glyph.size - first.size) > .01
      || !/^[0-9a-f]{6}$/i.test(glyph.color || '') || glyph.color !== first.color
      || glyph.rect.x < 0 || glyph.rect.y < 0 || glyph.rect.x + glyph.rect.width > scene.width
      || glyph.rect.y + glyph.rect.height > scene.height
      || glyph.rect.x < item.rect.x - .01 || glyph.rect.y < item.rect.y - .01
      || glyph.rect.x + glyph.rect.width > item.rect.x + item.rect.width + .01
      || glyph.rect.y + glyph.rect.height > item.rect.y + item.rect.height + .01
      || previous && (glyph.rect.x < previous.rect.x + previous.rect.width - .25
        || glyph.rect.x - previous.rect.x - previous.rect.width > first.size * .6)) return null;
    const fit = fitLetter(glyph, context);
    if (!fit) return null;
    owned.push(source);
    items.push({ id:glyph.id, type:'text', text:glyph.text, sourceIds:[source.id],
      order:item.order + index / glyphs.length, rect:{...glyph.rect}, ...fit, baseline:glyph.baseline,
      sourceFont:glyph.font, sourceSize:glyph.size, color:glyph.color,
      bold:false, italic:false, preciseInk:true });
  }
  if (new Set(owned).size !== glyphs.length) return null;
  return { sources:owned, items };
}

// CMSY's literal angle glyphs can carry CJK Unicode points. Arial's implicit
// substitute has different side bearings and can be completely clipped by a
// narrow source frame. Keep the literal spelling and measure an explicit face.
function recoverLiteralAngles(item, scene, sources, context) {
  const source = item.sourceIds?.length === 1 && sources.get(item.sourceIds[0]);
  if (item.type !== 'text' || item.raster !== false || item.ocr || !item.preciseInk
    || item.words || item.alphabet || item.mathStyleUncertain || item.radicalPart || item.delimiterPart
    || item.bold || item.italic || !/^[〈〉]$/u.test(item.text || '')
    || !/^(?:[A-Z]{6}\+)?CMSY(?:[5-9]|10)$/i.test(item.font || '')
    || !source || source.id !== item.id || source.disposition !== 'editable' || source.text !== item.text
    || !sameBox(source.rect, item.rect) || !(item.size >= 4 && item.size <= 40)
    || !Number.isFinite(item.baseline) || !/^[0-9a-f]{6}$/i.test(item.color || '')
    || item.rect.x < 0 || item.rect.y < 0 || item.rect.x + item.rect.width > scene.width
    || item.rect.y + item.rect.height > scene.height) return;
  if (item.glyphPositions && (item.glyphPositions.length !== 1
    || item.glyphPositions[0].text !== item.text || !sameBox(item.glyphPositions[0].rect, item.rect))) return;
  context.font = '1000px "SimSun"'; context.fontKerning = 'none';
  const metrics = context.measureText(item.text);
  const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
  if (!(height > 0 && width > 0 && metrics.width > 0)) return;
  const size = item.rect.height * 1000 / height;
  const glyphScale = Math.round(item.rect.width * 100000 / (width * size));
  if (!(size >= 4 && size <= 40 && size / item.size >= .7 && size / item.size <= 1.5
    && glyphScale >= 25 && glyphScale <= 400)) return;
  Object.assign(item, { sourceFont: item.font, sourceSize: item.size, sourceFontMetrics: item.fontMetrics,
    fontMetrics: undefined, font: 'SimSun', fontFamily: 'SimSun', size, glyphScale,
    baseline: item.rect.y + metrics.actualBoundingBoxAscent * size / 1000,
    baselineX: item.rect.x, advanceWidth: metrics.width * size / 1000 * glyphScale / 100 });
}

function calibrateOpenTableFunction(line,sources,context){
 const numeric=nativeTableNumericGlyphs(line.items,sources),glyphs=numeric||nativeTableFunctionGlyphs(line.items,sources);if(!glyphs)return;
 const fits=glyphs.map(g=>numeric&&/^(?:[A-Z]{6}\+)?CM(?:R|BX)10$/.test(g.font||'')?fitLetter(g,context,'Times New Roman'):fitLinearGlyph(g,context));if(fits.some(f=>!f))return;
 glyphs.forEach((g,i)=>Object.assign(g,{sourceFont:g.font,sourceSize:g.size,sourceFontMetrics:g.fontMetrics,fontMetrics:undefined,words:undefined,...fits[i]}));
}

function calibrateTableIndices(blocks, sources, context) {
  for (const block of blocks) {
    if (block.columns) block.columns.forEach(column => calibrateTableIndices(column.blocks, sources, context));
    if (!block.cells) continue;
    for (const cell of block.cells) for (const paragraph of cell.blocks) for (const line of paragraph.lines || []) {
      // Core table cells retain raw text leaves, whose historical shape omits type.
      if(block.nativeOpenGrid)calibrateOpenTableFunction(line,sources,context);
      const safe = item => (item.type === undefined || item.type === 'text') && item.preciseInk && item.raster === false && !item.ocr
        && !item.alphabet && !item.mathStyleUncertain && !item.radicalPart && !item.delimiterPart
        && item.italic && /^[A-Za-z]$/.test(item.text) && !(item.words?.length > 1)
        && item.sourceIds?.length === 1 && sources.get(item.sourceIds[0])?.disposition === 'editable'
        && sources.get(item.sourceIds[0]).text === item.text && sameBox(sources.get(item.sourceIds[0]).rect, item.rect);
      const pairs = line.items.filter(item => safe(item) && /^(?:[A-Z]{6}\+)?CMMI7$/i.test(item.font || ''))
        .map(script => ({ script, bases: line.items.filter(base => base !== script && safe(base)
          && /^(?:[A-Z]{6}\+)?CMMI10$/i.test(base.font || '') && script.size < base.size * .8
          && script.size >= base.size * .45 && script.baseline - base.baseline > base.size * .1
          && script.baseline - base.baseline < base.size * .6 && script.rect.x >= base.rect.x
          && script.rect.x - base.rect.x - base.rect.width >= -.2
          && script.rect.x - base.rect.x - base.rect.width < base.size * .6) }));
      const claimed = new Set();
      for (const { script, bases } of pairs) {
        if (bases.length !== 1 || claimed.has(script) || claimed.has(bases[0])
          || pairs.some(other => other.script !== script && other.bases.includes(bases[0]))) continue;
        const items = [bases[0], script], fits = items.map(item => fitLetter(item, context));
        if (fits.some(fit => !fit)) continue;
        items.forEach((item, index) => {
          claimed.add(item);
          Object.assign(item, { sourceFont: item.font, sourceSize: item.size,
            sourceFontMetrics: item.fontMetrics, fontMetrics: undefined, words: undefined, ...fits[index] });
        });
      }
    }
  }
}

/** A lone native Latin run, numeric label or literal range has no 2D structure. Restore
 * ordinary text before layout/assets so Canvas, editing and DOCX share one run.
 * Unknown encodings, raster ink and structured or decorated regions stay images.
 */
export function recoverMathLetters(scene, context) {
  if (!context || scene.rasterPage) return scene;
  const sources = new Map(scene.sources.map(source => [source.id, source]));
  const recovered = [];
  scene.items = scene.items.flatMap(item => {
    recoverLiteralAngles(item, scene, sources, context);
    const range = recoverNumericRange(item, scene, sources, context);
    if (range) { recovered.push(...range.sources); return range.items; }
    if (item.type !== 'image' || item.role !== 'math' || item.mathGlyphs?.length !== 1
      || item.mathStrokes?.length || item.drawingIds?.length || item.reasons?.length
      || item.sourceIds?.length !== 1 || item.backgroundPaintIndexes?.length) return item;
    const glyph = item.mathGlyphs[0], source = sources.get(item.sourceIds[0]);
    if (!source || source.disposition !== 'visible-image' || source.id !== glyph.id || source.text !== glyph.text
      || !/^(?:[A-Za-z]{1,12}|[0-9]{1,6}|×{2,12})$/.test(glyph.text) || !knownFace.test(glyph.font || '')
      || glyph.raster !== false || glyph.preciseInk !== true || glyph.alphabet || glyph.mathStyleUncertain || glyph.radicalPart || glyph.delimiterPart
      || !sameBox(glyph.rect, item.rect) || !sameBox(source.rect, item.rect)
      || !(glyph.size >= 1 && glyph.size <= 400) || !Number.isFinite(glyph.baseline)
      || !/^[0-9a-f]{6}$/i.test(glyph.color || '')
      || glyph.rect.x < 0 || glyph.rect.y < 0 || glyph.rect.x + glyph.rect.width > scene.width
      || glyph.rect.y + glyph.rect.height > scene.height) return item;
    const fit = fitLetter(glyph, context);
    if (!fit) return item;
    recovered.push(source);
    return { id: glyph.id, type: 'text', text: glyph.text, sourceIds: [...item.sourceIds],
      order: item.order, rect: { ...glyph.rect }, ...fit, baseline: glyph.baseline,
      sourceFont: glyph.font, sourceSize: glyph.size, color: glyph.color,
      bold: Boolean(glyph.bold), italic: Boolean(glyph.italic), preciseInk: true,
    };
  });
  recovered.forEach(source => { source.disposition = 'editable'; });
  calibrateTableIndices(scene.items, sources, context);
  recoverLinearText(scene, sources, context);
  // New ranges only use frames left AFTER all previously supported fragments.
  recoverLinearText(scene, sources, context, 'temperature');
  recoverLinearText(scene, sources, context, 'mapping');
  // Replace one existing image frame with one source-owned text frame only
  // after all established recovery stages have spent their work/frame budgets.
  recoverStandaloneIntegrals(scene, sources, context);
  return scene;
}
