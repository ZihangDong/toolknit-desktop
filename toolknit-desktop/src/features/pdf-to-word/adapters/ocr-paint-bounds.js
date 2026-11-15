// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { positionedTextRuns } from './text-layout.js';

const box = (sample, pad) => ({ pad, width: sample.w + 2 * pad, height: sample.h + 2 * pad });
const padding = (sample, edges, sx, sy) => 3 + Math.ceil(Math.max(0, sample.x - edges[0] * sx,
  sample.y - edges[1] * sy, edges[2] * sx - sample.x - sample.w, edges[3] * sy - sample.y - sample.h));

/** Read the complete actual run, including ink outside the expected source.
 * The halo also covers raster/filter edges and fractional-font quantization. */
export function ocrPaintBounds(line, context, sample, sx, sy) {
  let pad = 3;
  for (const run of positionedTextRuns(line, context)) {
    if (run.kind !== 'text') return null;
    const metrics = run.metrics, options = run.options, raw = context.measureText(run.item.text);
    const unit = options.size / 2 / 1000, horizontal = (options.scale || 100) / 100;
    const edges = [run.x - metrics.left, run.baseline - metrics.ascent,
      run.x + raw.actualBoundingBoxRight * unit * horizontal, run.baseline + metrics.inkDescent];
    if (!edges.every(Number.isFinite)) return null;
    pad = Math.max(pad, padding(sample, edges, sx, sy));
  }
  return box(sample, pad);
}

/** Same program coordinates and half-point position as the serialized run.
 * This reserves the exact final footprint before constructing/loading a face. */
export function generatedOcrPaintBounds({ bounds, size, scale, baseline, tight, sample, sx, sy }) {
  const unit = size / 1024, horizontal = Math.round(scale) / 100, ascent = bounds[3] * unit;
  const position = Math.round((baseline - tight.y - ascent) * 2) / 2, actualBaseline = baseline - position;
  const edges = [tight.x, actualBaseline - ascent, tight.x + (bounds[2] - bounds[0]) * unit * horizontal,
    actualBaseline - bounds[1] * unit];
  return box(sample, padding(sample, edges, sx, sy));
}
