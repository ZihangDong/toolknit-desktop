// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
// BT/ET and an explicit text-matrix reset isolate plain text advances. Other
// text operators may change persistent spacing and must remain untouched.
export function independentTextGroups(operations, { relativeMoves = false } = {}) {
  const result = [];
  let current = null, nested = 0;
  for (const [index, operation] of operations.entries()) {
    if (operation.name === 'beginText') {
      if (current) { current.invalid = true; nested++; }
      else current = { indexes: [], segments: [], invalid: false };
    } else if (operation.name === 'endText') {
      if (nested) { nested--; continue; }
      if (current && !current.invalid) result.push(...current.segments, ...(current.indexes.length ? [current.indexes] : []));
      current = null;
    } else if (current) {
      const matrix = operation.args?.length === 1 ? operation.args[0] : operation.args;
      // Td restores the text cursor from the line matrix; showText advances
      // only the cursor. Opt in only when both source/display streams prove
      // the same complete group. Default grouping retains its old contract.
      const reset = operation.name === 'setTextMatrix' || relativeMoves && operation.name === 'moveText';
      if (reset && (Array.isArray(matrix) || ArrayBuffer.isView(matrix))
        && matrix.length === (operation.name === 'moveText' ? 2 : 6) && matrix.every(Number.isFinite)) {
        if (current.indexes.length) current.segments.push(current.indexes);
        current.indexes = [];
      } else if (relativeMoves && reset) current.invalid = true;
      else if (['showText', 'showSpacedText'].includes(operation.name)) current.indexes.push(index);
      else if (/ShowText$/.test(operation.name)) current.invalid = true;
    }
  }
  return result;
}
