// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com

import assert from 'node:assert/strict';
import { knownNativeCourierFrame } from '../src/features/pdf-to-word/adapters/native-courier-baseline.js';
import { measureLineBox, runOptions, textMetrics, baselinePosition } from '../src/features/pdf-to-word/adapters/text-layout.js';

const ASCENT = 1705 / 2048;
const DESCENT = 615 / 2048;
const ADVANCE = 1229 / 2048;
const fontMetrics = { ascent: ASCENT, descent: DESCENT, winAscent: ASCENT, winDescent: DESCENT };
const proofOptions = { runOptions, textMetrics, baselinePosition };
const aliases = ['Courier New', 'CourierNew', 'CourierNewPSMT', 'ABCDEF+CourierNewPSMT'];
const sizes = [6, 8, 10, 12.7, 16, 24];
const text = 'Hgx0 regular mono text';

// This context is synthetic: it verifies the predicate and branch selection
// on any platform. Its results are never counted as installed-font evidence.
function deterministicContext(mode = 'matching') {
  return {
    font: '19px "Unrelated"', fontKerning: 'normal',
    measureText(value) {
      if (mode === 'throws') throw new Error('measurement unavailable');
      const em = Number(this.font.match(/([\d.]+)px/)?.[1] || 1000);
      const missing = mode === 'missing glyph' && value === 'H';
      return { width: value.length * ADVANCE * em,
        actualBoundingBoxLeft: 0, actualBoundingBoxRight: missing ? 0 : value.length * ADVANCE * em,
        actualBoundingBoxAscent: missing ? 0 : .6 * em,
        actualBoundingBoxDescent: missing ? 0 : .2 * em,
        fontBoundingBoxAscent: mode === 'missing font' ? .905 * em : mode === 'nonfinite' ? NaN : ASCENT * em,
        fontBoundingBoxDescent: mode === 'wrong metrics' ? .2 * em : DESCENT * em };
    },
  };
}

function fixture({ font = 'ABCDEF+CourierNewPSMT', size = 12.7, baseline = 80,
  context = deterministicContext() } = {}) {
  const beforeFont = context.font;
  const beforeKerning = context.fontKerning;
  let fine;
  try {
    context.font = '1000px "Courier New"';
    context.fontKerning = 'none';
    fine = context.measureText(text);
  } finally {
    context.font = beforeFont;
    context.fontKerning = beforeKerning;
  }
  const scale = size / 1000;
  const item = { id: 'native', type: 'text', sourceIds: ['native'], text, font,
    fontFamily: 'monospace', size, baseline, baselineX: 30, advanceWidth: fine.width * scale,
    rect: { x: 30 - fine.actualBoundingBoxLeft * scale, y: baseline - fine.actualBoundingBoxAscent * scale,
      width: (fine.actualBoundingBoxLeft + fine.actualBoundingBoxRight) * scale,
      height: (fine.actualBoundingBoxAscent + fine.actualBoundingBoxDescent) * scale },
    fontMetrics: { ...fontMetrics }, preciseInk: true, bold: false, italic: false,
    raster: false, color: '000000' };
  return { item, line: { id: 'line', type: 'line', baseline, rect: { ...item.rect }, items: [item] } };
}

function accepts(item, line, context, flags = {}) {
  return knownNativeCourierFrame({ line, items: [item], context,
    nativeWordFrame: true, onlyText: true, ...proofOptions, ...flags });
}

let deterministicChecks = 0;
for (const font of aliases) for (const size of sizes) {
  const context = deterministicContext();
  const { item, line } = fixture({ font, size });
  const before = structuredClone(line);
  assert(accepts(item, line, context));
  assert.equal(context.font, '19px "Unrelated"');
  assert.equal(context.fontKerning, 'normal');
  const box = measureLineBox(line, context, false, null, true);
  assert.equal(box.baselineOffset, Math.round(box.height * 20) / 20 * .8);
  assert.deepEqual(line, before);
  deterministicChecks++;
}

for (const kind of ['OCR', 'native calibrated', 'bold', 'italic', 'generic Courier',
  'Nimbus substitute', 'missing metrics', 'wrong Win metrics', 'wrong source hhea',
  'source substitution', 'source font asset', 'CJK', 'unknown face', 'word children',
  'nonprecise', 'raster', 'math', 'nonzero run position', 'mixed source baseline']) {
  const context = deterministicContext();
  const { item, line } = fixture();
  if (kind === 'OCR') item.ocr = true;
  if (kind === 'native calibrated') item.nativeCalibrated = true;
  if (kind === 'bold') item.bold = true;
  if (kind === 'italic') item.italic = true;
  if (kind === 'generic Courier') item.font = 'Courier';
  if (kind === 'Nimbus substitute') item.font = 'NimbusMonoPS-Regular';
  if (kind === 'missing metrics') delete item.fontMetrics;
  if (kind === 'wrong Win metrics') item.fontMetrics.winAscent = .9;
  if (kind === 'wrong source hhea') item.fontMetrics.ascent = .9;
  if (kind === 'source substitution') item.sourceFont = 'UnknownFont';
  if (kind === 'source font asset') item.fontAssetId = 'font:existing';
  if (kind === 'CJK') item.text = '中文';
  if (kind === 'unknown face') item.font = 'UnknownCourierFont';
  if (kind === 'word children') item.words = [{ ...item }];
  if (kind === 'nonprecise') item.preciseInk = false;
  if (kind === 'raster') item.raster = true;
  if (kind === 'math') item.role = 'math';
  if (kind === 'nonzero run position') item.rect.y += 1;
  if (kind === 'mixed source baseline') line.baseline += .1;
  assert.equal(accepts(item, line, context), false, kind);
  deterministicChecks++;
}

for (const flags of [{ nativeWordFrame: false }, { includeImages: true }, { onlyText: false },
  { nativeTableRow: true }, { fit: { top: 0, bottom: 100 } }]) {
  const { item, line } = fixture();
  assert.equal(accepts(item, line, deterministicContext(), flags), false);
  deterministicChecks++;
}

for (const mode of ['missing font', 'missing glyph', 'wrong metrics', 'nonfinite']) {
  const { item, line } = fixture();
  const before = structuredClone(line);
  const context = deterministicContext(mode);
  assert.equal(accepts(item, line, context), false, mode);
  assert.equal(context.font, '19px "Unrelated"');
  assert.equal(context.fontKerning, 'normal');
  // Rejection must preserve the existing native fallback, not merely return
  // false while still receiving the new exact-line anchor elsewhere.
  assert.deepEqual(measureLineBox(line, context, false, null, true),
    measureLineBox(line, context, false, null, false), `${mode}: original fallback retained`);
  assert.deepEqual(line, before);
  deterministicChecks++;
}

for (const size of [4, 40]) {
  const { item, line } = fixture({ size });
  assert.equal(accepts(item, line, deterministicContext()), false);
  deterministicChecks++;
}
{
  const { item, line } = fixture();
  const context = deterministicContext('throws');
  assert.throws(() => accepts(item, line, context), /measurement unavailable/);
  assert.equal(context.font, '19px "Unrelated"');
  assert.equal(context.fontKerning, 'normal');
  deterministicChecks++;
}
assert.equal(deterministicChecks, 55);

// Real-font evidence is separate and conditional. A family name or a global
// FontFace availability flag never satisfies this probe on its own.
function realFontEvidence(context) {
  const beforeFont = context.font;
  const beforeKerning = context.fontKerning;
  try {
    context.font = '1000px "Courier New"';
    context.fontKerning = 'none';
    for (const character of new Set('iW0' + text)) {
      const m = context.measureText(character);
      if (!Number.isFinite(m.width + m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)
        || Math.abs(m.width / 1000 - ADVANCE) > .001
        || Math.abs(m.fontBoundingBoxAscent / 1000 - ASCENT) > .001
        || Math.abs(m.fontBoundingBoxDescent / 1000 - DESCENT) > .001) {
        return { verified: false, reason: 'font_metrics_mismatch' };
      }
      if (character !== ' ' && (![m.actualBoundingBoxLeft, m.actualBoundingBoxRight,
        m.actualBoundingBoxAscent, m.actualBoundingBoxDescent].every(Number.isFinite)
        || m.actualBoundingBoxLeft + m.actualBoundingBoxRight <= 0
        || m.actualBoundingBoxAscent + m.actualBoundingBoxDescent <= 0)) {
        return { verified: false, reason: 'glyph_ink_unavailable' };
      }
    }
    return { verified: true };
  } finally {
    context.font = beforeFont;
    context.fontKerning = beforeKerning;
  }
}

let canvas;
let realChecks = 0;
let realCoverage;
try {
  let runtime;
  try {
    runtime = await import('@napi-rs/canvas');
  } catch (error) {
    if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED'].includes(error.code)) throw error;
    realCoverage = { status: 'not_executed', reason: 'canvas_runtime_unavailable' };
  }
  if (runtime) {
    canvas = runtime.createCanvas(1, 1);
    const context = canvas.getContext('2d');
    const evidence = realFontEvidence(context);
    if (!evidence.verified) {
      const { item, line } = fixture();
      assert.equal(accepts(item, line, context), false, 'unverified runtime must refuse Courier calibration');
      assert.deepEqual(measureLineBox(line, context, false, null, true),
        measureLineBox(line, context, false, null, false), 'unverified runtime keeps original fallback');
      realCoverage = { status: 'not_executed', reason: evidence.reason, runtimeFallbackAsserted: true };
    } else {
      const [{ default: JSZip }, { inferDocument }, { createWordBytes }] = await Promise.all([
        import('jszip'), import('../src/features/pdf-to-word/core/layout.js'),
        import('../src/features/pdf-to-word/adapters/docx.js'),
      ]);
      for (const font of aliases) for (const size of sizes) {
        const { item, line } = fixture({ font, size, context });
        const before = structuredClone(line);
        assert(accepts(item, line, context));
        const source = { id: item.id, text: item.text, rect: item.rect, disposition: 'editable' };
        const document = inferDocument([{ number: 1, width: 400, height: 250,
          items: [item], sources: [source], rules: [], risks: ['unmapped-glyph'],
          characters: item.text.length }], { preserveGeometry: true });
        const exported = await createWordBytes(document, [], { preserveGeometry: true, measurementContext: context });
        const zip = await JSZip.loadAsync(exported.bytes);
        const xml = await zip.file('word/document.xml').async('string');
        const frame = xml.match(/<w:framePr\b[^>]*\bw:y="(\d+)"[^>]*>/);
        const spacing = xml.match(/<w:spacing\b[^>]*\bw:line="(\d+)"[^>]*>/g)
          ?.find(tag => /w:lineRule="exact"/.test(tag) && Number(tag.match(/w:line="(\d+)"/)[1]) > 2);
        assert(frame && spacing);
        const y = Number(frame[1]) / 20;
        const height = Number(spacing.match(/w:line="(\d+)"/)[1]) / 20;
        assert(Math.abs(y + height * .8 - item.baseline) <= .026,
          'verified actual-font Word frame retains the native source baseline');
        assert.deepEqual(line, before);
        realChecks++;
      }
      assert.equal(realChecks, 24);
      realCoverage = { status: 'executed', verifiedFontMetrics: true };
    }
  }
} finally {
  if (canvas) canvas.width = canvas.height = 1;
}
console.log(JSON.stringify({ deterministicPredicateAndFallbackChecks: deterministicChecks,
  verifiedCanvasDocxChecks: realChecks, realFontCoverage: realCoverage,
  readerEvidence: 'Separate platform-specific evidence; this test does not run a reader.' }));
