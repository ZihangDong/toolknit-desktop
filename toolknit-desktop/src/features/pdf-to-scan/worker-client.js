import { scanError } from './core.js';

export function createScanWorker() {
  if (typeof Worker !== 'function') throw scanError('worker');
  const worker = new Worker(new URL('./scan-worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let sequence = 0, disposed = false;
  function dispose(code = 'cancelled') {
    if (disposed) return;
    disposed = true; worker.terminate();
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(scanError(code)); }
    pending.clear();
  }
  worker.onmessage = ({ data }) => {
    const item = pending.get(data.id);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(data.id);
    if (data.error) item.reject(scanError(data.error)); else item.resolve(data.result);
  };
  worker.onerror = () => dispose('worker');
  worker.onmessageerror = () => dispose('worker');
  return {
    request(type, payload = {}, transfer = []) {
      if (disposed) return Promise.reject(scanError('cancelled'));
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => dispose('timeout'), 180000);
        pending.set(id, { resolve, reject, timer });
        try { worker.postMessage({ id, type, ...payload }, transfer); }
        catch { dispose('worker'); }
      });
    }, dispose
  };
}
