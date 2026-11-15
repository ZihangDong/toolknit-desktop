// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { leafBlocks } from '../core/layout.js';
import { ocrFrameLayout } from '../core/ocr-frame-layout.js';
import { compressedPunctuationChunks } from '../core/text-chunks.js';
import { runOptions, positionedTextRuns } from './text-layout.js';

function drawRun(context, text, item, x, baseline, spacing = 0) {
  const options = runOptions(item);
  context.font = (options.italics ? 'italic ' : '') + (options.bold ? 'bold ' : '') + options.size / 2 + 'px "' + options.font.ascii.replaceAll('"', '') + '"';
  context.fontKerning = 'none'; context.fillStyle = '#' + options.color; context.textBaseline = 'alphabetic';
  const horizontal = (options.scale || 100) / 100;
  context.save(); context.translate(x, baseline); context.scale(horizontal, 1);
  if ('letterSpacing' in context) {
    context.letterSpacing = spacing / 20 / horizontal + 'px'; context.fillText(text, 0, 0); context.letterSpacing = '0px';
  } else {
    let cursor = 0;
    for (const character of text) { context.fillText(character, cursor, 0); cursor += context.measureText(character).width + spacing / 20 / horizontal; }
  }
  context.restore();
}

/** Synchronous text painting shared by the editor and bounded font proposals.
 * The caller owns the transform, background, assets and canvas lifetime.
 */
export function drawResultText(page, context) {
  const leaves = leafBlocks([...page.header, ...page.blocks, ...page.footer]);
  const frames = ocrFrameLayout(page);
  for (const block of leaves) for (const line of block.lines || []) {
    if (frames.has(line.id)) {
      for (const single of frames.get(line.id)) for (const run of positionedTextRuns(single, context))
        if (run.kind === 'text') drawRun(context, run.item.text, run.item, run.x, run.baseline, run.spacing);
      continue;
    }
    if (line.items.every(item => item.preciseInk || item.type === 'image')) {
      for (const chunk of compressedPunctuationChunks(line)) for (const run of positionedTextRuns(chunk, context))
        if (run.kind === 'text') drawRun(context, run.item.text, run.item, run.x, run.baseline, run.spacing);
    } else for (const item of line.items) if (item.type !== 'image')
      drawRun(context, item.text, item, item.baselineX ?? item.rect.x, item.baseline ?? line.baseline);
  }
}
