import { tauriCorePromise, tauriEventPromise } from './tauri-runtime.js';
export function createScreenshotRuntime({ isTauri = false } = {}) {
  return Object.freeze({
    available: isTauri,
    async image(session) {
      if (!isTauri) throw new Error('screenshot:windows-only');
      const { invoke } = await tauriCorePromise;
      return invoke('quick_screenshot_image', { session });
    },
    async call(action, payload = {}) {
      if (!isTauri) throw new Error('screenshot:windows-only');
      const { invoke } = await tauriCorePromise;
      return invoke('quick_screenshot', { request: { ...payload, action } });
    },
    async listen(name, handler) {
      if (!isTauri) return () => {};
      const { listen } = await tauriEventPromise;
      return listen(name, event => handler(event.payload));
    }
  });
}
