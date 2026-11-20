import * as tauriCore from '@tauri-apps/api/core';
import * as tauriEvent from '@tauri-apps/api/event';
import * as tauriWindow from '@tauri-apps/api/window';
import { taskCenter } from '../app/task-center.js';
import { createTrackedInvoke } from './tracked-invoke.js';

// Keep the current promise-shaped contract while centralizing platform imports.
export const rawInvoke = tauriCore.invoke;
export const tauriCorePromise = Promise.resolve({ ...tauriCore, invoke: createTrackedInvoke({
  invoke: rawInvoke, listen: tauriEvent.listen, center: taskCenter,
  isEnabled: () => !!globalThis.window?.__TAURI_INTERNALS__ && !globalThis.document?.documentElement?.hasAttribute('data-tk-auxiliary')
}) });
export const tauriEventPromise = Promise.resolve(tauriEvent);
// Window APIs are exposed only through this platform boundary. Feature and
// application modules must not import @tauri-apps/api/window directly.
export const { LogicalSize, currentMonitor, getCurrentWindow } = tauriWindow;

export function loadTauriDialog() {
  return import('@tauri-apps/plugin-dialog');
}

export function loadTauriWebview() {
  return import('@tauri-apps/api/webview');
}

export function loadTauriApp() {
  return import('@tauri-apps/api/app');
}
