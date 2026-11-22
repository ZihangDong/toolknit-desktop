import { pptError } from './core.js';
export function createPptPackageWorker() {
  const worker = new Worker(new URL('./package-worker.js', import.meta.url), { type: 'module' });
  const pending = new Map(); let sequence = 0, disposed = false;
  function stop(error) {
    if (disposed) return;
    disposed = true; worker.terminate();
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  }
  worker.onmessage = ({ data }) => {
    const call = pending.get(data.id); if (!call) return;
    pending.delete(data.id);
    if (data.error) call.reject(new Error(data.error)); else call.resolve(data.output);
  };
  worker.onerror = worker.onmessageerror = () => stop(pptError('failed'));
  return {
    request(type, payload, transfer = []) {
      if (disposed) return Promise.reject(pptError('cancelled'));
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try { worker.postMessage({ id, type, payload }, transfer); }
        catch (error) { pending.delete(id); reject(error); }
      });
    },
    dispose() { stop(pptError('cancelled')); }
  };
}
