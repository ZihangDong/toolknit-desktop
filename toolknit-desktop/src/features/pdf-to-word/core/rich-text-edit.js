// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { wordError } from './input.js';
import { lineText } from './text.js';
import { nativePairEditStyle } from './native-pair-policy.js';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const segments = text => [...segmenter.segment(text)].map(value => ({ text: value.segment, offset: value.index }));
const key = item => JSON.stringify([item.font, item.fontFamily, item.fontAssetId, item.size, item.bold, item.italic, item.color, item.horizontalScale]);

/** Map the displayed paragraph to its source runs, including inferred spaces. */
export function textFragments(lines) {
  let text = ''; const fragments = [];
  lines.forEach((line, lineIndex) => {
    const value = lineText(line.items).trim();
    const space = text && value && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(text)
      && !/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}，。！？；：、]/u.test(value) && !/[-\s]$/.test(text);
    if (space) { fragments.push({ start: text.length, end: text.length + 1, text: ' ', item: line.items[0], lineIndex, softBreak: true }); text += ' '; }
    const start = text.length; let cursor = 0;
    for (const item of line.items.flatMap(item => item.words?.length > 1 || item.words?.some(word => word.fontAssetId)
      || item.nativeAdvanceCentered && item.words?.length || item.words?.some(word => word.nativePairSpacing || word.nativePairPolicy)
      ? item.words.map(word => ({ ...item, ...word, words: undefined,
        ...((item.ocr || item.nativeCalibrated) ? { positionedWord: true } : {}) })) : [item])) {
      let token = item.text || '';
      if (!cursor) token = token.trimStart();
      if (token && !value.includes(token) && value.endsWith(token.trimEnd())) token = token.trimEnd();
      if (!token) continue;
      const at = value.indexOf(token, cursor);
      if (at < 0) continue;
      if (at > cursor) fragments.push({ start: start + cursor, end: start + at, text: value.slice(cursor, at), item, lineIndex,
        layoutSpace: /^\s+$/u.test(value.slice(cursor, at)) });
      fragments.push({ start: start + at, end: start + at + token.length, text: token, item, lineIndex }); cursor = at + token.length;
    }
    if (cursor < value.length) fragments.push({ start: start + cursor, end: start + value.length, text: value.slice(cursor), item: line.items.at(-1), lineIndex });
    text += value;
  });
  return { text, fragments };
}

function styledTokens(text, fragments, fallback) {
  let index = 0;
  return segments(text).map(token => {
    while (index + 1 < fragments.length && fragments[index].end <= token.offset) index++;
    const fragment = fragments[index], item = fragment?.item || fallback, offset = token.offset - (fragment?.start || 0);
    const style = nativePairEditStyle(item);
    const sourceMap = fragment?.nativePairSourceMap || style?.nativePairMap;
    return { text: token.text, sourceOffset: token.offset, item, pairSourceOffset: fragment?.layoutSpace || fragment?.softBreak ? null : sourceMap?.[offset] ?? null, lineIndex: fragment?.lineIndex || 0,
      softBreak: fragment?.softBreak, layoutSpace: Boolean(fragment?.layoutSpace && /^\s+$/u.test(token.text)) };
  });
}

/** Prefix/suffix fast path and bounded middle LCS retain independent edits. */
export function replaceStyledText(target, text, previous) {
  const source = previous?.runs?.length ? { text: previous.text, fragments: previous.runs } : textFragments(target.lines);
  const old = styledTokens(source.text, source.fragments, target.items[0]), next = segments(text);
  let prefix = 0, suffix = 0;
  while (prefix < old.length && prefix < next.length && old[prefix].text === next[prefix].text) prefix++;
  while (suffix < old.length - prefix && suffix < next.length - prefix && old.at(-1 - suffix).text === next.at(-1 - suffix).text) suffix++;
  const a = old.slice(prefix, old.length - suffix), b = next.slice(prefix, next.length - suffix);
  if ((a.length + 1) * (b.length + 1) > 1_000_000) throw wordError('edit-complex');
  const rows = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    rows[i][j] = a[i].text === b[j].text ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  const result = old.slice(0, prefix); let i = 0, j = 0;
  let inherited = a[0] || result.at(-1) || old[old.length - suffix] || { item: target.items[0], lineIndex: 0 };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].text === b[j].text) { result.push(a[i]); inherited = a[i++]; j++; }
    else if (i < a.length && (j >= b.length || rows[i + 1][j] >= rows[i][j + 1])) { inherited = a[i++]; }
    else result.push({ ...inherited, text: b[j++].text, inserted: true, pairSourceOffset: null, layoutSpace: false, softBreak: false });
  }
  result.push(...old.slice(old.length - suffix));
  return result;
}

/** Layout carries individual styles. Source runs are never flattened to one face. */
export function fitStyledText(target, text, measure, rect, previous) {
  let offset = 0; const pairStyles = new WeakMap();
  const tokens = replaceStyledText(target, text, previous).map(token => {
    const resolved = token.inserted && measure.resolveStyle ? measure.resolveStyle(token.text, token.item) : token.item;
    if (!pairStyles.has(resolved)) pairStyles.set(resolved, nativePairEditStyle(resolved) || resolved);
    const item = pairStyles.get(resolved);
    const value = { ...token, item, startStable: token.sourceOffset === offset, stable: !token.inserted && token.sourceOffset === offset };
    offset += token.text.length; return value;
  });
  const preservePairAnchors = tokens.some(token => token.item.nativePairPolicy);
  const sizes = tokens.map(token => token.item.size).filter(size => Number.isFinite(size) && size > 0);
  if (!sizes.length) throw wordError('edit-text');
  const maximum = Math.max(...sizes), distances = target.lines.slice(1).map((line, i) => line.baseline - target.lines[i].baseline).filter(n => n > 0);
  const leading = distances.length ? distances.sort((a, b) => a - b)[Math.floor(distances.length / 2)] : maximum * 1.2;
  const measured = (value, item, factor, map) => {
    if (item.nativePairPolicy && factor !== 1) return NaN;
    const style = { ...item, size: item.size * factor, ...(map && item.nativePairPolicy ? { text: value, nativePairMap: map } : {}) };
    const valueWidth = measure(value, style);
    if (!Number.isFinite(valueWidth) || valueWidth < 0) return NaN;
    if (item.nativePairPolicy) return valueWidth;
    const original = item.advanceWidth;
    if (!Number.isFinite(original) || original <= 0 || !item.preciseInk) return valueWidth;
    const sourceWidth = measure(item.text, item);
    const ratio = sourceWidth > 0 ? original / sourceWidth : 1;
    return valueWidth * Math.max(.5, Math.min(2, ratio));
  };
  const attempt = factor => {
    let prefixStable = factor === 1;
    const output = []; let current = [], pieces = [], width = 0, lastSourceLine = tokens[0]?.lineIndex || 0;
    let baseline = target.lines[0].baseline;
    const flush = () => {
      if (!current.length) return true;
      const size = Math.max(...current.map(t => t.item.size * factor));
      if (output.length && target.inline) return false;
      const items = []; let x = rect.x, pendingGap = 0;
      for (const token of current) {
        const source = token.item, style = { ...source, size: source.size * factor };
        // Inferred PDF word gaps already have physical origins. Keep them in
        // the logical edited string without serializing a second literal space
        // inside the next word and losing its unchanged source identity.
        if (token.layoutSpace && !token.inserted && /^\s+$/u.test(token.text)) {
          const gap = measured(token.text, source, factor);
          if (!Number.isFinite(gap)) return false;
          pendingGap += gap; continue;
        }
        const last = items.at(-1);
        if (!pendingGap && last && key(last) === key(style) && last._source === source) { last.text += token.text; last._stable &&= token.stable; last._sourceStable &&= !token.inserted; if (last.nativePairPolicy) last.nativePairMap.push(token.pairSourceOffset); }
        else items.push({ ...style, text: token.text, ...(style.nativePairPolicy ? { nativePairMap: [token.pairSourceOffset] } : {}), _source: source, sourceLine: token.lineIndex,
          _stable:token.stable, _sourceStable:!token.inserted, _startStable:token.startStable, _leadingGap: pendingGap });
        pendingGap = 0;
      }
      let previousUnchanged = false, previousInkRight = -Infinity, previousBaseline = NaN;
      for (const item of items) {
        const previousEnd = x;
        x += item._leadingGap || 0;
        const advance = measured(item.text, item._source, factor, item.nativePairMap), details = measure.metrics?.(item.text, item);
        if (!Number.isFinite(advance)) return false;
        const ascent = details?.ascent ?? (item._source.baseline - item._source.rect.y) * factor;
        const height = details ? details.ascent + (details.descent ?? item.size * .2) : item._source.rect.height * factor;
        const left = details?.left || 0;
        const sourceBaseline = target.lines[item.sourceLine]?.baseline ?? target.lines[0].baseline;
        const itemBaseline = baseline + (item._source.baseline - sourceBaseline) * factor;
        const metrics=measure.metrics?.(item._source.text,item._source);
        // Native XITS ink is fitted to Cambria Math while retaining the PDF's
        // logical baseline. Its painted baseline can differ from that nominal
        // value; preserve that proven offset when editing the fitted run.
        const opticalOffset = item._source.preciseInk && item._source.nativeCalibrated
          && item._source.font === 'Cambria Math' && Number.isFinite(item._source.sourceSize) && item._source.sourceSize > 0
          && /^(?:[A-Z]{6}\+)?XITSMath-Regular$/i.test(item._source.sourceFont || '')
          && Number.isFinite(metrics?.ascent) ? item._source.rect.y + metrics.ascent - item._source.baseline : 0;
        const inkOffset = Math.abs(opticalOffset) <= item._source.size * .25 ? opticalOffset * factor : 0;
        const sourceX = item._source.preciseInk && metrics ? item._source.rect.x + metrics.left : item._source.baselineX ?? item._source.rect.x;
        const sameBaseline = Math.abs(itemBaseline - item._source.baseline) < .01;
        // A source gap need not equal this substitute font's space advance.
        // Anchor the unchanged suffix if the previous run itself still fits;
        // wider edits retain reflow instead of overwriting the next word.
        // Fitted fonts can have an advance wider than their original ink.
        // Two untouched, disjoint source spans retain their physical anchors;
        // an edited preceding span still has to fit before the next origin.
        const sourceInkGap = previousUnchanged && item._source.preciseInk
          && Number.isFinite(previousInkRight + item._source.rect?.x + previousBaseline)
          // Less than one physical Word twip is still the same source row.
          && Math.abs(previousBaseline - itemBaseline) < .05 && item._source.rect.x >= previousInkRight - .01;
        const stableSource = item._stable || preservePairAnchors && item._sourceStable;
        const stableSuffix = factor === 1 && stableSource && item.text === item._source.text && sameBaseline
          && (sourceX >= previousEnd - .01 || sourceInkGap);
        const stablePairPrefix = factor === 1 && item.nativePairPolicy && item.nativePairMap?.[0] === 0
          && item._startStable && sameBaseline && (prefixStable || sourceX >= previousEnd - .01 || sourceInkGap);
        if ((prefixStable && item._startStable && sameBaseline) || stableSuffix || stablePairPrefix) x = sourceX;
        const unchanged = (prefixStable || stableSuffix) && stableSource && item.text === item._source.text && sameBaseline;
        if(!unchanged)prefixStable=false;
        Object.assign(item, unchanged ? item._source : { words: undefined, size: item.size, preciseInk: true,
          baseline: itemBaseline, baselineX: x, advanceWidth: advance, rect: { x: x - left, y: itemBaseline + inkOffset - ascent, width: Math.max(.1, advance), height: Math.max(.1, height) } });
        if (!unchanged && item.nativePairPolicy) delete item.nativePairSpacing;
        if (!unchanged && /^\s/u.test(item.text)) item.spaceBefore = false;
        previousUnchanged = unchanged && item.preciseInk;
        previousInkRight = item.rect?.x + item.rect?.width;
        previousBaseline = itemBaseline;
        delete item._source;delete item._stable;delete item._sourceStable;delete item._startStable;delete item._leadingGap; x += unchanged ? item.advanceWidth || advance : advance;
      }
      // The font's descent includes room for absent descenders. A title with
      // no such glyphs may have a tight ink-height column: test emitted ink,
      // not an invented 0.2em, before rejecting otherwise free horizontal space.
      if(x>rect.x+rect.width+.5 || items.some(item => item.rect.y + item.rect.height > rect.y + rect.height + .5))return false;
      output.push({ text: current.map(t => t.text).join(''), x: rect.x, baseline, width: x - rect.x, size, items });
      baseline += leading * factor; current = []; pieces = []; width = 0; return true;
    };
    for (const token of tokens) {
      if (token.text === '\n') { if (current.length) { if (!flush()) return null; } else baseline += leading * factor; continue; }
      if (token.lineIndex !== lastSourceLine && current.length) { if (!flush()) return null; }
      lastSourceLine = token.lineIndex;
      if (token.softBreak && !current.length) continue;
      const last = pieces.at(-1), combined = last?.item === token.item;
      const nextText = combined ? last.text + token.text : token.text;
      const nextMap = combined ? [...(last.map || []), token.pairSourceOffset] : [token.pairSourceOffset];
      const segmentWidth = measured(nextText, token.item, factor, nextMap);
      let nextWidth = width - (combined ? last.width : 0) + segmentWidth;
      if (!Number.isFinite(nextWidth)) return null;
      if (nextWidth > rect.width + .1 && current.length) { if (!flush()) return null; nextWidth=measured(token.text, token.item, factor, [token.pairSourceOffset]); }
      const single = measured(token.text, token.item, factor, [token.pairSourceOffset]); if (single > rect.width + .1) return null;
      const tail=pieces.at(-1);
      if(tail?.item===token.item){tail.text+=token.text;tail.width=segmentWidth;tail.map=nextMap;}
      else pieces.push({text:token.text,item:token.item,width:single,map:[token.pairSourceOffset]});
      current.push(token); width=nextWidth;
    }
    if (!flush() || !output.length) return null;
    const runs = []; let offset = 0;
    for (const token of tokens) {
      const last = runs.at(-1);
      if (last && last.item === token.item && last.lineIndex === token.lineIndex && last.softBreak === token.softBreak && last.layoutSpace === token.layoutSpace) {
        last.text += token.text; last.end += token.text.length;
        if (last.nativePairSourceMap) last.nativePairSourceMap.push(token.pairSourceOffset);
      } else runs.push({ start: offset, end: offset + token.text.length, text: token.text, item: token.item, lineIndex: token.lineIndex,
        ...(token.item.nativePairPolicy ? { nativePairSourceMap: [token.pairSourceOffset] } : {}),
        softBreak: token.softBreak, layoutSpace: token.layoutSpace });
      offset += token.text.length;
    }
    return { type: 'text', text, size: target.size * factor, lines: output, runs };
  };
  let value = attempt(1); if (value) return value;
  // Automatic fitting is bounded and preserves relative run styles.
  const minimum = Math.min(1, Math.max(Math.ceil(maximum * .7 * 2) / 2 / maximum, 6 / Math.min(...sizes)));
  value = attempt(minimum); if (!value) throw wordError('edit-fit');
  let low = minimum, high = 1;
  for (let i = 0; i < 8; i++) { const middle = (low + high) / 2, next = attempt(middle); if (next) { low = middle; value = next; } else high = middle; }
  return value;
}
