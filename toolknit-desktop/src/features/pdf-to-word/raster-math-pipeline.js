// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { rasterMathCandidates, RASTER_MATH_LIMITS } from './core/raster-math-layout.js';
import { rasterMathIndexReferences } from './core/raster-math-context.js';

/** Small source images are read only for OCR. Published assets still use the
 * composited visible PDF crop. Original image orientation/clip comes from the
 * scene parser, and the Worker must prove every ink component remains visible. */
export async function recoverPageRasterMath({ scene, page, ops, worker, recognizePage, operation, createCanvas, remaining, onOcr = () => {} }) {
  const candidates = rasterMathCandidates(scene).slice(0, Math.min(RASTER_MATH_LIMITS.perPage, remaining));
  if (!candidates.length) return 0;
  const list = await page.getOperatorList(); operation.check();
  let attempted = 0;
  for (const item of candidates) {
    const index = item.rasterSource.operation;
    if (list.fnArray[index] !== ops.paintImageXObject || typeof list.argsArray[index]?.[0] !== 'string') continue;
    const args = list.argsArray[index];
    let original;
    try { original = page.objs.get(args[0]); } catch { continue; } // PDF.js may have released an unavailable image.
    if (!original?.bitmap || !Number.isSafeInteger(original.width) || !Number.isSafeInteger(original.height)
      || original.width < 16 || original.width > 512 || original.height < 12 || original.height > 128
      || original.width !== args[1] || original.height !== args[2]
      || original.bitmap.width !== original.width || original.bitmap.height !== original.height) continue;
    const canvas = createCanvas(original.width, original.height);
    try {
      const context = canvas.getContext('2d');
      // Keep source alpha. Filling white first would disguise transparency and
      // let the bitmap probe incorrectly claim an opaque original background.
      context.drawImage(original.bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const indexReferences = rasterMathIndexReferences(scene, item);
      const probe = await worker.request('raster-math-probe', { item, pixels, width: canvas.width, height: canvas.height, indexReferences }, [pixels.buffer]); operation.check();
      if (!probe) continue;
      attempted++; operation.addOcrBudget?.(); onOcr();
      const readings = [];
      for (const reading of probe.readings) {
        canvas.width = reading.width; canvas.height = reading.height;
        const context = canvas.getContext('2d'), image = context.createImageData(reading.width, reading.height);
        image.data.set(reading.pixels); context.putImageData(image, 0, 0);
        const result = await recognizePage(canvas, operation.abort.signal); operation.check();
        if (result?.width !== reading.width || result?.height !== reading.height) return attempted;
        readings.push(result);
      }
      const result = await worker.request('raster-math-recover', { imageId: probe.imageId, pixelSha256: probe.pixelSha256, readings }); operation.check();
      if (result) {
        const position = scene.items.indexOf(item);
        scene.items[position] = result.item; scene.sources.push(...result.sources);
        scene.characters += result.sources.reduce((sum, source) => sum + [...source.text].length, 0);
      }
    } finally {
      canvas.width = canvas.height = 0;
      await worker.request('raster-math-clear', {}).catch(() => {});
    }
  }
  return attempted;
}
