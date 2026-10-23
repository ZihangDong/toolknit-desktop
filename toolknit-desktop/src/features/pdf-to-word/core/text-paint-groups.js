// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
// BT/ET and an explicit text-matrix reset isolate plain text advances. Other
// text operators may change persistent spacing and must remain untouched.
export function independentTextGroups(operations) {
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
      if (operation.name === 'setTextMatrix' && (Array.isArray(matrix) || ArrayBuffer.isView(matrix))
        && matrix.length === 6 && matrix.every(Number.isFinite)) {
        if (current.indexes.length) current.segments.push(current.indexes);
        current.indexes = [];
      } else if (['showText', 'showSpacedText'].includes(operation.name)) current.indexes.push(index);
      else if (/ShowText$/.test(operation.name)) current.invalid = true;
    }
  }
  return result;
}
