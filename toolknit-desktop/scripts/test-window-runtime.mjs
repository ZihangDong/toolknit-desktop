import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWindowRuntime } from '../src/app/window-runtime.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(overrides = {}) {
  const calls = [], notices = [], listeners = new Map(), classes = new Set();
  let reads = 0, releases = 0, maximized = false;
  const layer = { dataset: {}, style: { setProperty() {}, removeProperty() {} },
    classList: { toggle(name, value) { value ? classes.add(name) : classes.delete(name); }, remove() {} }, setAttribute() {} };
  const doc = Object.assign(new EventTarget(), { body: layer, documentElement: layer, querySelectorAll: () => [] });
  const view = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
  const appWindow = {
    isMaximized: async () => { reads++; return maximized; }, isDecorated: async () => false,
    hide: async () => { throw Error('Cached framework hide must not be used for main close'); }, minimize: async () => calls.push('minimize'),
    toggleMaximize: async () => { calls.push('maximize'); maximized = !maximized; },
    ...overrides
  };
  for (const method of ['onResized', 'onScaleChanged', 'onFocusChanged']) appWindow[method] = async fn => {
    listeners.set(method, fn); return () => { releases++; listeners.delete(method); };
  };
  const runtime = createWindowRuntime({ appWindow, isTauri: true, documentRef: doc, windowRef: view,
    storage: { getItem: () => null }, tauriCorePromise: Promise.resolve({ invoke: async command => {
      if (command === 'hide_main_window') return overrides.nativeHide ? overrides.nativeHide() : calls.push('close');
      assert.equal(command, 'set_window_corner_radius');
    } }),
    translate: key => key, notify: value => notices.push(value), actionTimeoutMs: 30 });
  return { runtime, calls, notices, listeners, classes, doc, view, setMaximized: value => { maximized = value; },
    reads: () => reads, releases: () => releases };
}
{
  const pending = deferred(), h = fixture({ nativeHide: () => { h.calls.push('close'); return pending.promise; } });
  const close = h.runtime.handleControl('close');
  assert.equal(h.runtime.handleControl('close'), close, 'double close must not issue two native calls');
  const minimize = h.runtime.handleControl('minimize');
  await tick(5); assert.deepEqual(h.calls, ['close']);
  pending.resolve(); await Promise.all([close, minimize]);
  assert.deepEqual(h.calls, ['close', 'minimize']);
  h.runtime.dispose();
}
{
  const h = fixture({ nativeHide: () => new Promise(() => {}) });
  await Promise.all([h.runtime.handleControl('close'), h.runtime.handleControl('minimize')]);
  assert.deepEqual(h.calls, ['minimize'], 'a lost native response must not block subsequent commands');
  assert.deepEqual(h.notices, ['common.windowControlFailed']); h.runtime.dispose();
}
{
  const h = fixture({ nativeHide: async () => { throw Error('native failed'); } });
  await h.runtime.handleControl('close');
  await h.runtime.handleControl('maximize');
  await tick(145); assert.ok(h.classes.has('window-is-maximized'));
  h.runtime.observeFrame(); h.runtime.observeFrame(); await tick(0);
  assert.equal(h.listeners.size, 3, 'frame listeners bind only once');
  h.setMaximized(false); h.listeners.get('onFocusChanged')({ payload: true });
  await tick(145); assert.ok(!h.classes.has('window-is-maximized'), 'tray focus refreshes actual window state');
  h.setMaximized(true); h.doc.dispatchEvent(new Event('visibilitychange'));
  await tick(145); assert.ok(h.classes.has('window-is-maximized'));
  h.runtime.dispose(); h.runtime.dispose();
  assert.equal(h.releases(), 3);
  const reads = h.reads(); h.view.dispatchEvent(new Event('focus')); await tick(145);
  assert.equal(h.reads(), reads, 'disposed runtime must not schedule more frame reads');
  assert.equal(h.notices.length, 1);
}
{
  const pending = deferred(), h = fixture({ nativeHide: () => pending.promise });
  const close = h.runtime.handleControl('close'), minimize = h.runtime.handleControl('minimize');
  await tick(0); h.runtime.dispose(); await Promise.all([close, minimize]);
  pending.resolve(); assert.deepEqual(h.calls, []); assert.deepEqual(h.notices, []);
}
const nativeWindow = await readFile(new URL('../src-tauri/src/native_runtime/core/window.rs', import.meta.url), 'utf8');
assert.match(nativeWindow, /async fn hide_main_window\(window: tauri::Window\)[\s\S]*?window.label\(\) != "main"[\s\S]*?window_visibility::hide\(&window\).await/);
const runner = await readFile(new URL('../src-tauri/src/native_runtime/runner.rs', import.meta.url), 'utf8');
assert.match(runner, /generate_handler!\[[\s\S]*?hide_main_window,/);
assert.match(runner, /"main" => \{\s*api.prevent_close\(\);[\s\S]*?window_visibility::hide_on_main_thread\(window\)/);
console.log('Verified native main-window hide, command ordering, duplicate/timeout/failure recovery, focus sync and disposal passed');
