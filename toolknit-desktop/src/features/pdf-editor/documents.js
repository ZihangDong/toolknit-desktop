import { PdfEditorCancelledError } from './errors.js';
import { pdfjsDocumentOptions, destroyPdfDocument } from '../../shared/pdfjs-options.js';

export function createPdfEditorDocumentStore({ pdfWorkerUrl, getSources, isDisposed,
  loadPdfjs = () => import('pdfjs-dist/legacy/build/pdf.mjs') }) {
  const documents = new Map();
  const pending = new Map();
  const loadingTasks = new Set();
  let generation = 0;
  let disposed = false;

  async function createLoadingTask(bytes, requestGeneration) {
    const pdfjsLib = await loadPdfjs();
    if (disposed || isDisposed?.() || requestGeneration !== generation) throw new PdfEditorCancelledError();
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const loadingTask = pdfjsLib.getDocument(pdfjsDocumentOptions({ data: bytes.slice() }));
    loadingTasks.add(loadingTask);
    return loadingTask;
  }

  async function loadBytes(bytes, { onLoadingTask } = {}) {
    const requestGeneration = generation;
    const loadingTask = await createLoadingTask(bytes, requestGeneration);
    try {
      onLoadingTask?.(loadingTask);
      const pdfDocument = await loadingTask.promise;
      if (disposed || requestGeneration !== generation || isDisposed?.()) {
        throw new PdfEditorCancelledError();
      }
      return { document: pdfDocument, loadingTask };
    } catch (error) {
      try { await loadingTask.destroy(); } catch (_) {}
      throw error;
    } finally {
      loadingTasks.delete(loadingTask);
    }
  }

  async function get(sourceId) {
    if (documents.has(sourceId)) return documents.get(sourceId);
    if (pending.has(sourceId)) return pending.get(sourceId);
    const source = getSources().find(item => item.id === sourceId);
    if (!source) throw new Error('Missing PDF source');
    const requestGeneration = generation;
    const request = (async () => {
      const { document: pdfDocument } = await loadBytes(source.bytes);
      if (requestGeneration !== generation || disposed) {
        try { await destroyPdfDocument(pdfDocument); } catch (_) {}
        throw new PdfEditorCancelledError();
      }
      documents.set(sourceId, pdfDocument);
      return pdfDocument;
    })();
    pending.set(sourceId, request);
    try {
      return await request;
    } finally {
      if (pending.get(sourceId) === request) pending.delete(sourceId);
    }
  }

  function set(sourceId, pdfDocument) {
    if (disposed || !pdfDocument) return;
    documents.set(sourceId, pdfDocument);
  }

  async function destroyAll() {
    generation += 1;
    const tasks = Array.from(loadingTasks);
    for (const task of tasks) loadingTasks.delete(task);
    const values = Array.from(documents.values());
    documents.clear(); pending.clear();
    await Promise.allSettled(tasks.map(async task => {
      try { await task.destroy(); } catch (_) {}
    }));
    await Promise.allSettled(values.map(async pdfDocument => {
      try { await destroyPdfDocument(pdfDocument); } catch (_) {}
    }));
  }

  return {
    get,
    loadBytes,
    set,
    destroyAll,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await destroyAll();
    }
  };
}
