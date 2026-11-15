// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
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
  const relativeSourceGroups = new Map(), relativeDisplayGroups = new Map();
  independentTextGroups(rendered, { relativeMoves: true }).forEach(group => group.forEach(index => relativeDisplayGroups.set(index, group)));
  for (const group of independentTextGroups(source, { relativeMoves: true })) {
    const mapped = new Set(group.map(index => mapping.get(index)));
    // A display optimizer may join source reset groups. A finer source group
    // is usable only if complete display groups prove the same boundary.
    if (mapped.has(undefined) || [...mapped].some(index => !relativeDisplayGroups.has(index)
      || relativeDisplayGroups.get(index).some(peer => !mapped.has(peer)))) continue;
    group.forEach(index => relativeSourceGroups.set(index, group));
  }
  return { mapping, groupByIndex, relativeSourceGroups, relativeDisplayGroups };
}

export function mappedTextSelection(binding, indexes, relativeIndexes = []) {
  if (!binding) return null;
  if (!Array.isArray(indexes) || !Array.isArray(relativeIndexes) || indexes.length > LIMITS.operationsPerPage
    || relativeIndexes.length > indexes.length || new Set(relativeIndexes).size !== relativeIndexes.length) return null;
  const selected = new Set(indexes.map(index => binding.mapping.get(index)));
  if (selected.has(undefined) || selected.size !== indexes.length) return null;
  const sourceSelection = new Set(indexes), relative = new Set(relativeIndexes.map(index => binding.mapping.get(index)));
  if (relative.has(undefined) || relativeIndexes.some(index => !sourceSelection.has(index)
    || !binding.relativeSourceGroups?.has(index)
    || binding.relativeSourceGroups.get(index).some(peer => !sourceSelection.has(peer)
      || !relative.has(binding.mapping.get(peer))))) return null;
  for (const group of new Set([...selected].map(index => binding.groupByIndex.get(index)))) {
    if (!group) return null;
    if (group.some(index => !selected.has(index))) {
      for (const index of group.filter(index => selected.has(index))) {
        const finer = binding.relativeDisplayGroups?.get(index);
        if (!relative.has(index) || !finer || finer.some(peer => !selected.has(peer) || !relative.has(peer))) return null;
      }
    }
  }
  return selected;
}
