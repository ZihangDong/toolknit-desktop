// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { PDF_TO_WORD_LIMITS as LIMITS } from '../../../core/limits/pdf.js';
export { LIMITS };
export function wordError(code, details) {
  const error = new Error(`pdf-to-word:${code}`);
  error.code = code;
  if (details) error.details = details;
  return error;
}
export function validateInput({ name, size }) {
  if (!/\.pdf$/i.test(String(name || ''))) throw wordError('type');
  if (!Number.isSafeInteger(size) || size <= 0) throw wordError('empty');
  if (size > LIMITS.inputBytes) throw wordError('input-large');
}
export function parsePageRange(value, count) {
  if (!Number.isInteger(count) || count < 1 || count > LIMITS.documentPages) throw wordError('pages');
  const result = new Set();
  if (!String(value || '').trim()) {
    for (let page = 1; page <= count; page++) result.add(page);
  } else {
    if (String(value).length > 1000) throw wordError('range');
    for (const token of String(value).split(/[,，]/)) {
      const match = token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) throw wordError('range');
      const first = Number(match[1]), last = Number(match[2] || first);
      if (first < 1 || last > count || last < first) throw wordError('range');
      for (let page = first; page <= last; page++) result.add(page);
    }
  }
  if (!result.size || result.size > LIMITS.selectedPages) throw wordError('selection-large');
  return [...result].sort((a, b) => a - b);
}
export function renderPlan(width, height, scale = 2) {
  if (![width, height].every(n => Number.isFinite(n) && n > 0 && n <= 14400)) throw wordError('page-size');
  const bounded = Math.min(scale, LIMITS.renderSide / width, LIMITS.renderSide / height, Math.sqrt(LIMITS.renderPixels / (width * height)));
  return { scale: bounded, width: Math.max(1, Math.floor(width * bounded)), height: Math.max(1, Math.floor(height * bounded)) };
}
export function outputName(name) {
  const stem = String(name || 'document').replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  let prefix = '';
  for (const character of stem) {
    if (prefix.length + character.length > 100) break;
    prefix += character;
  }
  return `${prefix || 'document'}_ToolKnit.docx`;
}
