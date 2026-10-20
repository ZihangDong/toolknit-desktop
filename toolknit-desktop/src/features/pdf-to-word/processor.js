// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { LIMITS, wordError, outputName } from './core/input.js';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from './adapters/pdfjs.js';
import { createWordWorker } from './worker-client.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import { runWordAi } from './ai-runtime.js';

const canvasFactory = (width = 1, height = 1) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; };
export async function analyzeWordDocument({ pdf, pages, ops, operation, onProgress = () => {}, pageModes = {}, preserveGeometry = false, continuous = false }) {
  const worker = createWordWorker(); operation.worker = worker;
  const check = operation.check, canvas = canvasFactory();
  let totalAssets = 0;
  try {
    operation.optionalContentConfig = await pdf.getOptionalContentConfig({ intent: 'display' }); check();
    for (let index = 0; index < pages.length; index++) {
      check(); onProgress({ key: 'analyzing', current: index + 1, total: pages.length });
      const page = await pdf.getPage(pages[index]); check();
      try {
        page.cleanup();
        const snapshot = await snapshotPage(page, ops, check, operation.optionalContentConfig); check();
        const plan = await renderPage(page, canvas, operation, check); check();
        snapshot.fonts = snapshotFonts(page, snapshot.fontIds);
        const scene = await worker.request('scene', { snapshot }); check();
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        scene.inkCoverage = await worker.request('ink', { scene, pixels, width: canvas.width, height: canvas.height, scale: plan.scale }, [pixels.buffer]); check();
        if (!scene.inkCoverage.accepted) throw wordError('coverage');
        const assets = await collectPageAssets(scene, canvas, canvasFactory, check); check();
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

export async function enhanceWordStructure({ pdf, operation, ...options }) {
  const canvas = canvasFactory(); let rendered = null, scale = 1;
  try {
    operation.optionalContentConfig = await pdf.getOptionalContentConfig({ intent: 'display' }); operation.check();
    return await runWordAi({ ...options, operation, renderRegion: async (page, scope, signal) => {
      const check = () => { operation.check(); if (signal.aborted) throw wordError('cancelled'); };
      const abort = () => { try { operation.renderTask?.cancel(); } catch {} };
      signal.addEventListener('abort', abort, { once: true });
      try {
        check();
        if (rendered !== page.number) {
          const sourcePage = await pdf.getPage(page.number);
          try { check(); scale = (await renderPage(sourcePage, canvas, operation, check)).scale; check(); rendered = page.number; }
          finally { sourcePage.cleanup(); }
        }
        check();
        const rect = scope.rect, ratio = Math.min(scale, 1600 / Math.max(rect.width, rect.height));
        const small = canvasFactory(Math.max(1, Math.ceil(rect.width * ratio)), Math.max(1, Math.ceil(rect.height * ratio)));
        try {
          small.getContext('2d').drawImage(canvas, rect.x * scale, rect.y * scale, rect.width * scale, rect.height * scale, 0, 0, small.width, small.height);
          check(); return small.toDataURL('image/png');
        } finally { small.width = small.height = 0; }
      } finally { signal.removeEventListener('abort', abort); }
    } });
  } finally { canvas.width = canvas.height = 0; operation.renderTask = null; operation.optionalContentConfig = null; }
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
