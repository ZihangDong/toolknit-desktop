// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { bottom, right, union } from './geometry.js';

export const mathIntegralOperator = node => node?.type === 'symbol' && node.text === '\u222b'
  && !node.bold && !node.italic && !node.alphabet;
const axisBaseline = glyph => glyph.rect.y + glyph.rect.height / 2 + glyph.size * .25;
const fail = () => { throw new Error('ambiguous-integral'); };
const row = nodes => nodes.length === 1 ? nodes[0] : { type: 'row', children: nodes };

export function integralLimitBand(base, item, upper = false) {
  const baseline = axisBaseline(base), offset = item.baseline - baseline;
  return item.size < base.size * .88 && item.size >= base.size * .35
    && item.rect.x >= base.rect.x - base.size * .5 && right(item.rect) <= right(base.rect) + base.size * 1.5
    && (upper ? offset < -base.size * .3 && bottom(item.rect) < baseline - base.size * .15
      && item.rect.y > base.rect.y - base.size * 1.5
      : offset > base.size * .3 && item.rect.y > baseline + base.size * .1
      && bottom(item.rect) < bottom(base.rect) + base.size * 1.5);
}

export function integralLimitEvidence(base, items, upper = false) {
  if (!items.length || items.length > 64 || !items.every(item => integralLimitBand(base, item, upper))) return false;
  const rect = union(items.map(item => item.rect));
  return rect.width <= base.size * 2.5 && rect.height <= base.size * 1.5;
}

export function integralDifferential(node) {
  if (node?.type === 'symbol') return !node.bold && !node.alphabet && /^d[\p{Script=Latin}\p{Script=Greek}]$/u.test(node.text);
  return node?.type === 'row' && node.children.length === 2 && node.children.every(item => item.type === 'symbol'
    && !item.bold && !item.alphabet) && node.children[0].text === 'd' && /^[\p{Script=Latin}\p{Script=Greek}]$/u.test(node.children[1].text);
}

// Parentheses may share one source glyph run with a function name. Only a
// differential outside those parentheses terminates the integrand.
function bracketStep(node, stack) {
  if (node.type === 'row') { node.children.forEach(child => bracketStep(child, stack)); return; }
  if (node.type !== 'symbol') return;
  const matching = { ')': '(', ']': '[', '}': '{' };
  for (const character of node.text) {
    if ('([{'.includes(character)) stack.push(character);
    else if (Object.hasOwn(matching, character) && stack.pop() !== matching[character]) fail();
  }
}

export function integralBodyEvidence(node) {
  const stack = [];
  const first = node.type === 'row' ? node.children[0] : node;
  const last = node.type === 'row' ? node.children.at(-1) : node;
  if (!first || !last || first.type === 'symbol' && /^[=<>+*/)]/.test(first.text.trim())
    || last.type === 'symbol' && /[=<>+*/-]$/.test(last.text.trim())) return false;
  const flatten = value => value.type === 'row' ? value.children.flatMap(flatten) : [value];
  const atoms = flatten(node);
  try {
    for (let index = 0; index < atoms.length; index++) {
      if (!stack.length && (integralDifferential(atoms[index])
        || index + 1 < atoms.length && integralDifferential(row(atoms.slice(index, index + 2))))) return false;
      bracketStep(atoms[index], stack);
    }
    return stack.length === 0;
  } catch { return false; }
}

export function attachIntegralBodies(atoms) {
  for (let index = atoms.length - 1; index >= 0; index--) {
    const head = atoms[index];
    if (head.node.type !== 'integral') continue;
    const stack = [], body = []; let end = -1, differential;
    for (let next = index + 1; next < atoms.length; next++) {
      const item = atoms[next];
      if (Math.abs(item.baseline - head.baseline) > head.size * .3) fail();
      if (!stack.length && body.length) {
        const pair = atoms[next + 1];
        if (integralDifferential(item.node)) { differential = item.node; end = next; break; }
        if (pair && integralDifferential(row([item.node, pair.node]))
          && pair.rect.x - right(item.rect) >= -.3 && pair.rect.x - right(item.rect) <= head.size * .6
          && Math.abs(pair.baseline - head.baseline) <= head.size * .3) {
          differential = row([item.node, pair.node]); end = next + 1; break;
        }
      }
      if (!stack.length && item.node.type === 'symbol' && /[=<>\u2264\u2265\u2260;]/u.test(item.node.text)) fail();
      bracketStep(item.node, stack); body.push(item);
    }
    if (end < 0 || !body.length || !integralBodyEvidence(row(body.map(item => item.node)))) fail();
    const first = body[0], after = atoms[end + 1];
    if (first.rect.x < right(head.bodyRect) - .3 || first.rect.x - right(head.bodyRect) > head.size * 1.5
      || after && (after.node.type !== 'symbol' || !/^[=<>+\-\u2212\u00d7\u00f7\u2264\u2265\u2260,;)\]}]$/u.test(after.node.text.trim()))) fail();
    head.node.body = row(body.map(item => item.node)); head.node.differential = differential;
    head.rect = union(atoms.slice(index, end + 1).map(item => item.rect));
    atoms.splice(index + 1, end - index);
  }
}
