import { tauriCorePromise, tauriEventPromise } from './tauri-runtime.js';

export function createClipboardRuntime({ isTauri = false, tauri = tauriCorePromise, events = tauriEventPromise } = {}) {
  return {
    available: isTauri,
    async request(request) {
      if (!isTauri) throw new Error('clipboard:desktop-only');
      return (await tauri).invoke('clipboard_history', { request });
    },
    async subscribe(callback) {
      if (!isTauri) return () => {};
      return (await events).listen('clipboard-history-changed', event => callback(event?.payload));
    }
  };
}

export async function copySensitiveText(text, { isTauri = false, tauri = tauriCorePromise, clipboard = globalThis.navigator?.clipboard } = {}) {
  if (isTauri) return (await tauri).invoke('copy_sensitive_text', { text });
  if (!clipboard?.writeText) throw new Error('clipboard:unavailable');
  return clipboard.writeText(text);
}
