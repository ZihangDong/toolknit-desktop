import { imagePdfError } from './core.js';

export function createImagePdfWorker() {
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const pending = new Map(); let sequence = 0, disposed = false;
  function dispose(code = 'cancelled') {
    if (disposed) return; disposed = true; worker.terminate();
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(imagePdfError(code)); }
    pending.clear();
  }
  worker.onmessage = ({ data }) => {
    const item = pending.get(data.id); if (!item) return;
    clearTimeout(item.timer); pending.delete(data.id);
    if (data.error) item.reject(imagePdfError(data.error)); else item.resolve(data.result);
  };
  worker.onerror = () => dispose('worker'); worker.onmessageerror = () => dispose('worker');
  return { dispose, request(type, payload = {}, transfer = []) {
    if (disposed) return Promise.reject(imagePdfError('cancelled'));
    return new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => dispose('timeout'), 120000);
      pending.set(id, { timer, resolve, reject });
      try { worker.postMessage({ id, type, ...payload }, transfer); } catch { dispose('worker'); }
    });
  } };
}
