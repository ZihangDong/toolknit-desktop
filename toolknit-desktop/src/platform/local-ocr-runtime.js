import { tauriCorePromise, tauriEventPromise } from './tauri-runtime.js';

export function createLocalOcrRuntime({ isTauri = false, session } = {}) {
  async function call(action, payload = {}) {
    if (!isTauri) throw new Error('ocr:desktop-only');
    const { invoke } = await tauriCorePromise;
    return invoke('local_ocr', { request: { action, ...(session === undefined ? {} : { session }), ...payload } });
  }
  return {
    call,
    async ensure(signal) {
      if (signal?.aborted) throw new Error('ocr:cancelled');
      const status = await call('status');
      if (signal?.aborted) throw new Error('ocr:cancelled');
      if (status.ready) return;
      if (session !== undefined) { await call('open-manager'); throw new Error('ocr:not-installed'); }
      const ready = await new Promise(resolve => {
        const abort = () => resolve(false);
        signal?.addEventListener('abort', abort, { once: true });
        const detail = { resolve(value) { signal?.removeEventListener('abort', abort); resolve(value); }, signal, handled: false };
        document.dispatchEvent(new CustomEvent('local-ocr-request', { detail }));
        if (!detail.handled) detail.resolve(false);
      });
      if (!ready || signal?.aborted) throw new Error('ocr:cancelled');
    },
    async recognize(image, signal) {
      if (signal?.aborted) throw new Error('ocr:cancelled');
      const requestId = crypto.randomUUID();
      const abort = () => { void call('cancel', { requestId }).catch(() => {}); };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        const result = await call('recognize', { image, requestId });
        if (signal?.aborted) throw new Error('ocr:cancelled');
        return result;
      } finally { signal?.removeEventListener('abort', abort); }
    },
    async listen(name, handler) {
      if (!isTauri) return () => {};
      const { listen } = await tauriEventPromise;
      const unlisten = await listen(name, event => handler(event.payload));
      return () => { void Promise.resolve(unlisten()).catch(() => {}); };
    }
  };
}
