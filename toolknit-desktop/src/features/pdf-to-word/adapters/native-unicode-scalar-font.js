// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { NATIVE_UNICODE_SCALAR_FONT, nativeUnicodeScalarMetric, nativeUnicodeScalarRegion, nativeUnicodeScalarMeasurement } from '../core/native-unicode-scalars.js';

/** Coverage comes from the bounded cmap profile; measurement must match its
 * actual hmtx advance. A positive missing-glyph box is never coverage proof. */
export function nativeUnicodeScalarFontCovered(region, context) {
  if (!nativeUnicodeScalarRegion(region) || !context || typeof context.measureText !== 'function') return false;
  const metric = nativeUnicodeScalarMetric(region.mathGlyphs[0].text);
  if (!metric || metric.glyphId <= 0) return false;
  const previousFont = context.font, previousKerning = context.fontKerning;
  try {
    context.font = '1000px "' + NATIVE_UNICODE_SCALAR_FONT + '"'; context.fontKerning = 'none';
    const measured = context.measureText(region.mathGlyphs[0].text);
    return nativeUnicodeScalarMeasurement({ font: NATIVE_UNICODE_SCALAR_FONT, text: region.mathGlyphs[0].text, metrics: measured });
  } catch { return false; }
  finally { context.font = previousFont; context.fontKerning = previousKerning; }
}
