// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { LIMITS, wordError, outputName } from './core/input.js';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from './adapters/pdfjs.js';
import { createWordWorker } from './worker-client.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import { needsPageOcr } from './core/ocr-scene.js';
import { sourceFontCandidateName } from './core/source-font.js';
import { recoverPageRasterMath } from './raster-math-pipeline.js';
import { RASTER_MATH_LIMITS } from './core/raster-math-layout.js';
import { collectScanFigureAssets } from './adapters/scan-figure-assets.js';

const canvasFactory = (width = 1, height = 1) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; };
export async function analyzeWordDocument({ pdf, pages, ops, operation, onProgress = () => {}, pageModes = {}, preserveGeometry = false, continuous = false, recognizePage = null, preserveScanFigures = false, refineScanText = false }) {
  const worker = createWordWorker(); operation.worker = worker;
  const check = operation.check, canvas = canvasFactory();
  let totalAssets = 0, sourceFontsTried = false, rasterMathAttempts = 0; const assetOwners = new Map();
  try {
    operation.optionalContentConfig = await pdf.getOptionalContentConfig({ intent: 'display' }); check();
    for (let index = 0; index < pages.length; index++) {
      check(); onProgress({ key: 'analyzing', current: index + 1, total: pages.length });
      const page = await pdf.getPage(pages[index]); check();
      let formulaAssets = [], figureAssets = [];
      try {
        page.cleanup();
        const snapshot = await snapshotPage(page, ops, check, operation.optionalContentConfig); check();
        const plan = await renderPage(page, canvas, operation, check); check();
        snapshot.fonts = snapshotFonts(page, snapshot.fontIds);
        if (!sourceFontsTried && preserveGeometry && !continuous && typeof FontFace === 'function' && typeof pdf.getData === 'function'
          && Object.values(snapshot.fonts).some(font => font.data?.length && sourceFontCandidateName(font.name))) {
          sourceFontsTried = true;
          const sourceBytes = await pdf.getData(); check();
          await worker.request('source-fonts', { bytes: sourceBytes, pages }, [sourceBytes.buffer]); check();
        }
        const typographyPixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let scene = await worker.request('scene', { snapshot, pixels: typographyPixels, width: canvas.width, height: canvas.height, preserveGeometry: preserveGeometry === true && !continuous }, [typographyPixels.buffer]); check();
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        scene.inkCoverage = await worker.request('ink', { scene, pixels, width: canvas.width, height: canvas.height, scale: plan.scale }, [pixels.buffer]); check();
        if (!scene.inkCoverage.accepted) throw wordError('coverage');
        if (recognizePage && needsPageOcr(scene)) {
          operation.addOcrBudget?.();
          onProgress({ key: 'ocr', current: index + 1, total: pages.length });
          const result = await recognizePage(canvas, operation.abort.signal); check();
          const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          const prepared = await worker.request('ocr', { scene, result, pixels, remainingPages: pages.length - index,
            width: canvas.width, height: canvas.height, preserveGeometry, preserveScanFigures, refineScanText }, [pixels.buffer]); check();
          scene = prepared.scene;
          figureAssets = await collectScanFigureAssets(scene, canvas, canvasFactory, check); check();
          const formulas = scene.items.filter(item => item.ocrMath);
          if (formulas.length) formulaAssets = await collectPageAssets({ ...scene, items: formulas }, canvas, canvasFactory, check);
          if (prepared.changed) canvas.getContext('2d').putImageData(new ImageData(prepared.pixels, canvas.width, canvas.height), 0, 0);
        } else if (recognizePage && preserveGeometry && !continuous && rasterMathAttempts < RASTER_MATH_LIMITS.perDocument) {
          rasterMathAttempts += await recoverPageRasterMath({ scene, page, ops, worker, recognizePage, operation, createCanvas: canvasFactory,
            remaining: RASTER_MATH_LIMITS.perDocument - rasterMathAttempts,
            onOcr: () => onProgress({ key: 'ocr', current: index + 1, total: pages.length }) }); check();
          const formulas = scene.items.filter(item => item.ocrMath);
          if (formulas.length) formulaAssets = await collectPageAssets({ ...scene, items: formulas }, canvas, canvasFactory, check);
        }
        const collected = [...formulaAssets, ...figureAssets, ...await collectPageAssets({ ...scene, items: scene.items.filter(item => !item.ocrMath&&!item.scanFigure) }, canvas, canvasFactory, check)]; check();
        const assets = collected.filter(asset => {
          const item = scene.items.find(item => item.assetId === asset.id);
          // Exclusion indexes belong to this source's display list; identical
          // image bytes cannot merge different proof of removed hidden text.
          const fingerprint = item?.backgroundPaintIndexes?.length ? null : item?.fingerprint;
          const existing = fingerprint && assetOwners.get(fingerprint);
          if (existing) { item.assetId = existing; return false; }
          if (fingerprint) assetOwners.set(fingerprint, asset.id);
          return true;
        });
        totalAssets += assets.reduce((sum, asset) => sum + asset.bytes.length, 0);
        if (totalAssets > LIMITS.assetBytes) throw wordError('asset-large');
        await worker.request('page', { scene, assets }, assets.map(asset => asset.bytes.buffer)); check();
      } finally { canvas.width = canvas.height = 0; page.cleanup(); }
    }
    const document = await worker.request('layout', { options: { pageModes, preserveGeometry, continuous } }); check();
    return { document, worker };
  } catch (error) { worker.dispose(); throw error; }
  finally { canvas.width = canvas.height = 0; operation.renderTask = null; operation.optionalContentConfig = null; }
}

export async function publishWord({ bytes, name, isTauri, getOutputDir, operation, native = tauriCorePromise }) {
  operation.check();
  if (!(bytes instanceof Uint8Array) || bytes.length < 100 || bytes.length > LIMITS.outputBytes) throw wordError('output-large');
  if (!isTauri) return '';
  const { invoke } = await native, directory = await getOutputDir('PDF_Word'); operation.check();
  let id = null;
  try {
    id = await invoke('begin_pdf_to_word_write', { directory, fileName: name, expectedBytes: bytes.length }); operation.check();
    operation.nativeCancel = () => { void invoke('discard_pdf_to_word_write', { sessionId: id }).catch(() => {}); };
    for (let offset = 0; offset < bytes.length; offset += LIMITS.chunkBytes) {
      await invoke('append_pdf_to_word_chunk', { sessionId: id, offset, bytes: Array.from(bytes.subarray(offset, offset + LIMITS.chunkBytes)) }); operation.check();
    }
    operation.committing = true;
    const path = await invoke('finalize_pdf_to_word_write', { sessionId: id }); id = null; return path;
  } finally {
    operation.nativeCancel = null;
    if (id !== null) await invoke('discard_pdf_to_word_write', { sessionId: id }).catch(() => {});
  }
}
export { outputName };
