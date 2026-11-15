// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { prepareWordScene, prepareOcrWordScene } from './adapters/scene.js';
import { inferDocument, validateCoverage } from './core/layout.js';
import { createWordBytes } from './adapters/docx.js';
import { planContinuousSection } from './adapters/docx-continuous.js';
import { LIMITS, wordError } from './core/input.js';
import { inspectSceneInk } from './core/ink-coverage.js';
import { sceneLayoutBytes } from './core/scene-budget.js';
import { createSourceFontRegistry } from './adapters/source-fonts.js';
import { createRasterMathRecovery } from './adapters/raster-math.js';
import { createOcrFontRegistry } from './adapters/ocr-fonts.js';
import { fontProvenanceBytes } from './core/document-font.js';
import { refineScanTextTypography } from './adapters/scan-text-typography.js';

let scenes = [], assets = [], bytes = 0, operations = 0, characters = 0, items = 0, layoutBytes = 0;
let ocrFonts;
const sourceFonts = createSourceFontRegistry({ available: () => ocrFonts.capacity() }), fontAssetIds = new Set();
ocrFonts = createOcrFontRegistry({ createCanvas: typeof OffscreenCanvas === 'function'
  ? (width, height) => new OffscreenCanvas(width, height) : null, available: () => sourceFonts.capacity() });
const rasterMath = createRasterMathRecovery(typeof OffscreenCanvas === 'function' ? (width, height) => new OffscreenCanvas(width, height) : null);
self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    let result;
    if (type === 'source-fonts') {
      await sourceFonts.prepare(data.bytes, data.pages); result = true;
    } else if (type === 'scene') {
      operations += data.snapshot.operations.length;
      if (operations > LIMITS.operations) throw wordError('complexity');
      result = prepareWordScene(data.snapshot, { pixels: data.pixels, width: data.width, height: data.height, preserveGeometry: data.preserveGeometry === true, sourceFonts });
    } else if (type === 'raster-math-probe') {
      result = await rasterMath.probe(data);
      self.postMessage({ id, result }, result?.readings.map(reading => reading.pixels.buffer) || []); return;
    } else if (type === 'raster-math-recover') {
      result = rasterMath.recover(data);
    } else if (type === 'raster-math-clear') {
      rasterMath.clear(); result = true;
    } else if (type === 'ocr') {
      result = prepareOcrWordScene(data);
      if (data.refineScanText === true && data.preserveGeometry === true && typeof OffscreenCanvas === 'function')
        refineScanTextTypography(result, data, (width, height) => new OffscreenCanvas(width, height));
      if (result.changed && data.preserveGeometry === true) await ocrFonts.prepare(result.scene, data.pixels, data.width, data.height,
        { remainingPages: data.remainingPages ?? 1 });
      self.postMessage({ id, result }, [result.pixels.buffer]); return;
    } else if (type === 'ink') {
      result = inspectSceneInk(data.scene, data.pixels, data.width, data.height, data.scale);
    } else if (type === 'page') {
      if (scenes.length >= LIMITS.selectedPages) throw wordError('selection-large');
      const fonts = [...sourceFonts.assets(), ...ocrFonts.assets(data.scene)].filter(asset => !fontAssetIds.has(asset.id));
      fonts.forEach(asset => fontAssetIds.add(asset.id));
      bytes += [...fonts, ...data.assets].reduce((sum, asset) => sum + asset.bytes.length, 0);
      if (bytes > LIMITS.assetBytes) throw wordError('asset-large');
      characters += data.scene.characters; items += data.scene.sources.length;
      layoutBytes += sceneLayoutBytes(data.scene) + fonts.reduce((sum, asset) => sum + fontProvenanceBytes(asset), 0);
      if (characters > LIMITS.characters || items > LIMITS.items) throw wordError('text-large');
      if (items * 1000 + characters * 4 + bytes * 4 + layoutBytes > LIMITS.estimatedWorkingBytes) throw wordError('complexity');
      scenes.push(data.scene); assets.push(...fonts, ...data.assets); result = true;
    } else if (type === 'layout') {
      result = inferDocument(scenes, data.options);
      if (data.options?.continuous) planContinuousSection(result);
    } else if (type === 'assets') {
      const ids = new Set(data.ids);
      result = assets.filter(asset => ids.has(asset.id));
    } else if (type === 'finish') {
      validateCoverage(data.document);
      const extra = data.editedAssets || [];
      if (extra.reduce((sum, asset) => sum + asset.bytes.length, bytes) > LIMITS.assetBytes) throw wordError('asset-large');
      result = await createWordBytes(data.document, [...assets, ...extra], data.options);
      self.postMessage({ id, result }, [result.bytes.buffer]); return;
    } else throw wordError('worker');
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: error?.code || 'failed' }); }
};
