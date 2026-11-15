import { tauriCorePromise, tauriEventPromise } from './tauri-runtime.js';

export function createFileSearchRuntime({ isTauri = false } = {}) {
  return Object.freeze({
    available: isTauri,
    async call(action, payload = {}) {
      if (!isTauri) throw new Error('file-search:desktop-only');
      const { invoke } = await tauriCorePromise;
      return invoke('file_search', { request: { ...payload, action } });
    },
    async listen(handler) {
      if (!isTauri) return () => {};
      const { listen } = await tauriEventPromise;
      return listen('file-search-state', event => handler(event.payload));
    },
    async onSettled(handler) {
      if (!isTauri) return () => {};
      const { listen } = await tauriEventPromise;
      return listen('file-search-settled', event => handler(event.payload));
    },
    async onPanelEvent(name, handler) {
      if (!isTauri) return () => {};
      if (!['file-search-pending', 'file-search-navigate'].includes(name)) throw new Error('file-search:invalid-request');
      const { listen } = await tauriEventPromise;
      return listen(name, event => handler(event.payload));
    }
  });
}
