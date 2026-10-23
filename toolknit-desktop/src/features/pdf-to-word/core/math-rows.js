// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { bottom, right, union, median } from './geometry.js';
import { mathIntegralOperator, integralLimitBand, integralLimitEvidence, attachIntegralBodies } from './math-integrals.js';

export const MAX_MATH_DEPTH = 16, MAX_MATH_NODES = 1024;
export const mathRow = children => children.length === 1 ? children[0] : { type: 'row', children };
export const mathAtom = (node, rect, baseline, size, inkHeight = rect.height) => ({ node, rect, bodyRect: rect,
  symbolBody: node.type === 'symbol', baseline, size, inkHeight });
const failure = () => { throw new Error('ambiguous-math'); };
const operator = /^[=<>+\-\u2212\u00d7\u00f7\u2264\u2265\u2260,:;]$/u;
const closing = { ')': '(', ']': '[', '}': '{', '\u230b': '\u230a', '\u2309': '\u2308' };
const opening = new Set(Object.values(closing));
export const bareMathClosing = node => node?.type === 'symbol' && (Object.hasOwn(closing, node.text) || /^\|+$/.test(node.text));
export const namedMathLimit = node => node?.type === 'symbol' && !node.italic && !node.alphabet
  && /^(?:min|max|lim|inf|sup|argmin|argmax)$/.test(node.text);
export const mathNaryOperator = node => node?.type === 'symbol' && node.text === '\u2211' && !node.italic && !node.bold && !node.alphabet;
export const mathOperatorBaseline = glyph => glyph.rect.y + glyph.rect.height / 2 + glyph.size * .25;
export const mathGlyphBaseline = glyph => mathNaryOperator({ ...glyph, type: 'symbol' }) || mathIntegralOperator({ ...glyph, type: 'symbol' })
  || !glyph.mathStyleUncertain && !glyph.italic && /^(?:[A-Z]{6}\+)?CMEX[1-9]\d?$/.test(glyph.font || '')
    && /^[()[\]{}]$/.test(glyph.text) && glyph.rect.height >= glyph.size * 1.1
  ? mathOperatorBaseline(glyph) : glyph.baseline;
export function mathNaryBody(node) {
  if (node.type === 'symbol') return /^[\p{L}\p{N}]+$/u.test(node.text);
  if (node.type === 'script') return mathNaryBody(node.base);
  if (['fraction', 'radical', 'nary'].includes(node.type)) return true;
  if (node.type !== 'row' || node.children[0]?.type !== 'symbol' || !opening.has(node.children[0].text)) return false;
  const stack = [];
  for (let index = 0; index < node.children.length; index++) {
    const child = node.children[index];
    if (child.type !== 'symbol') continue;
    if (opening.has(child.text)) stack.push(child.text);
    else if (Object.hasOwn(closing, child.text)) {
      if (stack.pop() !== closing[child.text] || !stack.length && index !== node.children.length - 1) return false;
    }
  }
  return stack.length === 0;
}

function limitBand(base, item, upper) {
  return item.size < base.size * .88 && item.size >= base.size * .35
    && item.rect.x >= base.rect.x - base.size * .75 && right(item.rect) <= right(base.rect) + base.size * .75
    && (upper ? bottom(item.rect) < base.rect.y - base.size * .04 && base.rect.y - bottom(item.rect) < base.size * 1.5
      : item.rect.y > bottom(base.rect) + base.size * .04 && item.rect.y - bottom(base.rect) < base.size * 1.5);
}

export function centeredMathLimit(base, items, upper = false) {
  if (!items.length || items.length > 64 || !items.every(item => limitBand(base, item, upper))) return false;
  const rect = union(items.map(item => item.rect));
  return rect.height < base.size * 2 && Math.abs(rect.x + rect.width / 2 - base.rect.x - base.rect.width / 2) < base.size * .35;
}

function attachable(item, base) {
  if (!base) return false;
  const localOffset = item.baseline - base.baseline;
  const fractionScript = item.node.type === 'fraction' && item.size < base.size * .8 && item.rect.height <= base.size * 1.5
    && (bottom(item.rect) < base.baseline - base.size * .15 || item.rect.y > base.baseline + base.size * .1);
  const smallInk = base.symbolBody && item.node.type === 'symbol' && item.size < base.size * .8
    && Math.abs(localOffset) > base.size * .06
    && (localOffset > 0
      ? item.rect.y > base.bodyRect.y + base.size * .08 && bottom(item.rect) > bottom(base.bodyRect) + base.size * .08
      : item.rect.y < base.bodyRect.y - base.size * .08 && bottom(item.rect) < bottom(base.bodyRect) - base.size * .08);
  const descenderIndex = base.symbolBody && item.node.type === 'symbol' && item.size < base.size * .8
    && localOffset > base.size * .12 && bottom(base.bodyRect) > base.baseline + base.size * .1
    && item.rect.y > base.bodyRect.y + base.size * .08 && bottom(item.rect) > base.baseline + base.size * .1;
  return (item.node.type !== 'fraction' || fractionScript) && !(base.node.type === 'symbol' && operator.test(base.node.text.trim()))
    && item.rect.x >= base.rect.x && item.rect.x - right(base.rect) <= base.size * .55
    && (smallInk || descenderIndex || Math.abs(localOffset) > base.size * .18)
    && Math.abs(localOffset) <= base.size * (fractionScript ? 1.8 : 1.05);
}
export { attachable as mathScriptAttachment };

/** Assemble a baseline and its bounded child rows without flattening the
 * scripts inside those rows. Structural strokes have already been consumed. */
export function assembleMathAtoms(input, { depth = 0, spend } = {}) {
  if (!input.length || input.length > MAX_MATH_NODES || depth > MAX_MATH_DEPTH) failure();
  spend(input.length);
  const options = { depth: depth + 1, spend }, consumedLimits = new Set(), limits = new Map(), claims = new Map();
  for (const base of input.filter(item => namedMathLimit(item.node) || mathNaryOperator(item.node) || mathIntegralOperator(item.node))) {
    const bands = {};
    const integral = mathIntegralOperator(base.node);
    const bodyStart = integral ? input.filter(item => item !== base && item.size >= base.size * .88
      && item.rect.x >= right(base.bodyRect) - .3 && Math.abs(item.baseline - base.baseline) <= base.size * .3)
      .reduce((start, item) => Math.min(start, item.rect.x), Infinity) : Infinity;
    for (const [key, upper] of [['lower', false], ['upper', true]]) {
      const members = input.filter(item => item !== base && (!integral || right(item.rect) <= bodyStart + .3)
        && (integral ? integralLimitBand : limitBand)(base, item, upper));
      if (!(integral ? integralLimitEvidence : centeredMathLimit)(base, members, upper)) continue;
      bands[key] = members;
      for (const member of members) claims.set(member, (claims.get(member) || 0) + 1);
    }
    if (Object.keys(bands).length || integral) limits.set(base, bands);
    else if (mathNaryOperator(base.node)) failure();
  }
  if ([...claims.values()].some(count => count > 1)) failure();
  const atoms = input.map(base => {
    const bands = limits.get(base);
    if (!bands) return base;
    const node = mathIntegralOperator(base.node) ? { type: 'integral', operator: base.node }
      : mathNaryOperator(base.node) ? { type: 'nary', operator: base.node } : { type: 'limit', base: base.node };
    for (const [key, members] of Object.entries(bands)) {
      members.forEach(item => consumedLimits.add(item)); node[key] = assembleMathAtoms(members, options);
    }
    return { ...base, node, symbolBody: false, rect: union([base.rect, ...Object.values(bands).flat().map(item => item.rect)]) };
  }).filter(item => !consumedLimits.has(item));
  atoms.sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y);
  const mainSize = Math.max(...atoms.map(item => item.size));
  const baseline = median(atoms.filter(item => item.size >= mainSize * .9 && item.node.type !== 'fraction').map(item => item.baseline))
    || median(atoms.map(item => item.baseline));
  const output = [], consumed = new Set();
  const append = item => {
    const open = item.node.type === 'symbol' && Object.hasOwn(closing, item.node.text) ? closing[item.node.text] : null;
    const index = open ? output.findLastIndex(part => part.node.type === 'symbol' && opening.has(part.node.text)) : -1;
    if (index < 0) { output.push(item); return; }
    const first = output[index];
    if (first.node.text !== open || Math.abs(first.baseline - item.baseline) > Math.max(first.size, item.size) * .22) failure();
    const parts = [...output.splice(index), item];
    attachIntegralBodies(parts);
    output.push(mathAtom(mathRow(parts.map(part => part.node)), union(parts.map(part => part.rect)),
      median([first.baseline, item.baseline]), Math.max(...parts.map(part => part.size)), median(parts.map(part => part.inkHeight))));
  };
  for (let position = 0; position < atoms.length; position++) {
    const item = atoms[position];
    if (consumed.has(item)) continue;
    const offset = item.baseline - baseline, base = output.at(-1), localOffset = base ? item.baseline - base.baseline : 0;
    if (!attachable(item, base)) {
      if (Math.abs(offset) <= mainSize * .22) { append(item); continue; }
      failure();
    }
    if (item.size >= base.size * .88 && item.inkHeight >= base.inkHeight * .8 || bareMathClosing(base.node)) failure();
    const key = localOffset < 0 ? 'superscript' : 'subscript';
    const members = [item]; let box = item.rect;
    for (const next of atoms.slice(position + 1)) {
      if (consumed.has(next)) continue;
      const nextOffset = next.baseline - base.baseline;
      const smaller = next.size < base.size * .88 || next.inkHeight < base.inkHeight * .8;
      if (!smaller || Math.abs(nextOffset) < base.size * .06) break;
      if (Math.sign(nextOffset) !== Math.sign(localOffset)) continue;
      // Another full-size raised tier can be an outer script, not part of
      // this argument. Smaller nested indices are parsed within their row.
      if (next.size >= item.size * .88 && Math.abs(next.baseline - item.baseline) > item.size * .18) break;
      if (next.rect.x - right(box) > item.size * .65 || Math.abs(nextOffset) > base.size * 1.8) break;
      members.push(next); consumed.add(next); box = union([box, next.rect]);
    }
    const childNode = members.length === 1 ? item.node : assembleMathAtoms(members, options);
    const child = { ...item, node: childNode, rect: box };
    if (base.node.type !== 'script') base.node = { type: 'script', base: base.node };
    if (base.node[key]) {
      const previous = base[key];
      if (!previous) failure();
      const outer = base.node.subscript && base.node.superscript && key === 'superscript'
        && item.size >= previous.size * .88 && item.size <= previous.size * 1.12
        && previous.baseline - item.baseline > base.size * .22 && item.rect.x >= right(base.rect) + base.size * .08;
      if (outer) { base.node = { type: 'script', base: base.node, superscript: childNode }; delete base.subscript; }
      else {
        if (Math.abs(previous.baseline - item.baseline) > item.size * .18 || item.rect.x < right(previous.rect) - .3) failure();
        base.node[key] = mathRow([base.node[key], childNode]);
      }
    } else base.node[key] = childNode;
    base[key] = child; base.rect = union([base.rect, box]);
  }
  attachIntegralBodies(output);
  for (let index = output.length - 1; index >= 0; index--) {
    const item = output[index];
    if (item.node.type !== 'nary') continue;
    const body = output[index + 1], after = output[index + 2];
    const separator = node => node?.type === 'symbol' && /^[=<>+\-\u2212\u00d7\u00f7\u2264\u2265\u2260,;]$/u.test(node.text.trim());
    if (!body || !mathNaryBody(body.node) || separator(body.node) || body.rect.x < right(item.bodyRect) - .3
      || body.rect.x - right(item.bodyRect) > item.size * 1.2
      || Math.abs(body.baseline - item.baseline) > item.size * .3
      || after && !separator(after.node)) failure();
    item.node.body = body.node; item.rect = union([item.rect, body.rect]);
    output.splice(index + 1, 1);
  }
  return mathRow(output.map(item => item.node));
}
