// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { independentTextGroups } from './text-paint-groups.js';
import { LIMITS } from './input.js';

const textDraw = name => ['showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText'].includes(name);

/** PDF.js display optimization preserves text order but changes op indexes. */
export function matchRenderedTextOperations(source, display, names) {
  if (!Array.isArray(source) || source.length > LIMITS.operationsPerPage || !display?.lastChunk
    || !Array.isArray(display.fnArray) || !Array.isArray(display.argsArray) || display.fnArray.length !== display.argsArray.length
    || display.fnArray.length > LIMITS.operationsPerPage || !names) return null;
  const rendered = display.fnArray.map((code, index) => ({ name: names[code], args: display.argsArray[index] || [] }));
  if (rendered.some(operation => typeof operation.name !== 'string')) return null;
  const originals = source.flatMap((operation, index) => textDraw(operation.name) ? [{ ...operation, index }] : []);
  const draws = rendered.flatMap((operation, index) => textDraw(operation.name) ? [{ ...operation, index }] : []);
  if (originals.length !== draws.length) return null;
  const mapping = new Map(), groups = independentTextGroups(rendered), groupByIndex = new Map();
  groups.forEach(group => group.forEach(index => groupByIndex.set(index, group)));
  try {
    for (let index = 0; index < originals.length; index++) {
      if (originals[index].name !== draws[index].name || JSON.stringify(originals[index].args) !== JSON.stringify(draws[index].args)) return null;
      mapping.set(originals[index].index, draws[index].index);
    }
  } catch { return null; }
  for (const group of independentTextGroups(source)) {
    const mapped = new Set(group.map(index => mapping.get(index)));
    for (const renderedGroup of new Set([...mapped].map(index => groupByIndex.get(index)))) {
      if (!renderedGroup || renderedGroup.some(index => !mapped.has(index))) return null;
    }
  }
  return { mapping, groupByIndex };
}

export function mappedTextSelection(binding, indexes) {
  if (!binding) return null;
  const selected = new Set(indexes.map(index => binding.mapping.get(index)));
  if (selected.has(undefined) || selected.size !== indexes.length) return null;
  for (const group of new Set([...selected].map(index => binding.groupByIndex.get(index)))) {
    if (!group || group.some(index => !selected.has(index))) return null;
  }
  return selected;
}
