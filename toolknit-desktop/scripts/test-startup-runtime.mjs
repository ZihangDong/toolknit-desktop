import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createStartupRuntime } from '../src/app/startup-runtime.js';
import { createFontSettingsRuntime } from '../src/app/font-settings-runtime.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const fonts = deferred();
  const background = deferred();
  const layoutFonts = deferred();
  const image = deferred();
  let fontRead = 0;
  let imageRead = 0;
  const documentRef = new EventTarget();
  const windowRef = new EventTarget();
  windowRef.clearTimeout = clearTimeout;
  windowRef.getComputedStyle = () => ({ opacity: '1' });
  documentRef.documentElement = { dataset: { tkStartup: 'loading' } };
  documentRef.body = { setAttribute() {}, removeAttribute() {} };
  documentRef.fonts = { get ready() { fontRead += 1; return layoutFonts.promise; } };
  const mask = { style: {}, remove() { this.removed = true; } };
  const app = {
    inert: false,
    getBoundingClientRect() { return { width: 100, height: 100 }; },
    querySelectorAll: () => [{
      getBoundingClientRect: () => ({ width: 100, height: 100 }),
      decode() { imageRead += 1; return image.promise; }
    }]
  };
  documentRef.getElementById = () => mask;
  documentRef.querySelector = () => app;
  const runtime = createStartupRuntime({ documentRef, windowRef,
    fontsReady: fonts.promise, backgroundReady: background.promise, revealMs: 1, ...options });
  return { runtime, fonts, background, layoutFonts, image, app, mask, documentRef, windowRef,
    fontRead: () => fontRead, imageRead: () => imageRead };
}

const state = fixture();
assert.equal(state.app.inert, true);
state.background.resolve();
await tick();
assert.equal(state.fontRead(), 0, 'custom fonts must settle before waiting for CSS font layout');
state.fonts.resolve();
await tick();
assert.equal(state.fontRead(), 1);
assert.equal(state.documentRef.documentElement.dataset.tkStartup, 'loading');
state.layoutFonts.resolve();
await tick();
assert.equal(state.imageRead(), 1);
assert.equal(state.mask.removed, undefined, 'image decoding must remain covered');
const tab = new Event('keydown', { cancelable: true });
Object.defineProperty(tab, 'key', { value: 'Tab' });
state.documentRef.dispatchEvent(tab);
assert.equal(tab.defaultPrevented, true);
state.image.resolve();
await state.runtime.ready;
assert.equal(state.mask.removed, true);
assert.equal(state.app.inert, false);
assert.equal(state.documentRef.documentElement.dataset.tkStartup, undefined);
const after = new Event('keydown', { cancelable: true });
Object.defineProperty(after, 'key', { value: 'Tab' });
state.documentRef.dispatchEvent(after);
assert.equal(after.defaultPrevented, false, 'startup must release input listeners');
state.runtime.dispose();

const failure = fixture({ fontsReady: Promise.reject(new Error('font unavailable')),
  backgroundReady: Promise.reject(new Error('image unavailable')) });
failure.layoutFonts.resolve();
failure.image.resolve();
await failure.runtime.ready;
assert.equal(failure.app.inert, false, 'failed optional resources must use available fallback UI');

let deadlines = 0;
const timeout = fixture({ timeoutMs: 5, onTimeout: () => { deadlines += 1; } });
await timeout.runtime.ready;
assert.equal(deadlines, 1);
assert.equal(timeout.mask.removed, true, 'stalled font/native requests cannot trap the user');
timeout.fonts.resolve(); timeout.background.resolve();
await tick();
assert.equal(timeout.fontRead(), 0, 'late work must not re-enter after disposal');

const closed = fixture();
closed.windowRef.dispatchEvent(new Event('pagehide'));
await closed.runtime.ready;
assert.equal(closed.mask.removed, true);
assert.equal(closed.app.inert, false);
closed.runtime.dispose();

const nativeFonts = deferred();
const settings = createFontSettingsRuntime({ root: {}, windowRef: {}, isTauri: true,
  tauriCorePromise: Promise.resolve({ invoke: () => nativeFonts.promise }) });
let fontsSettled = false;
settings.ready.then(() => { fontsSettled = true; });
await tick();
assert.equal(fontsSettled, false, 'font readiness includes the native preferences lookup');
nativeFonts.resolve([]);
await settings.ready;
assert.equal(fontsSettled, true);
settings.dispose();

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const bootstrap = html.match(/<script data-tk-theme-bootstrap>([\s\S]*?)<\/script>/)?.[1];
for (const theme of ['light', 'dark']) {
  const root = { dataset: {} };
  let watchdog;
  const windowRef = { location: { search: '' }, setTimeout: fn => { watchdog = fn; return 1; } };
  vm.runInNewContext(bootstrap, { window: windowRef, document: { documentElement: root },
    localStorage: { getItem: () => theme }, URLSearchParams });
  assert.equal(root.dataset.theme, theme);
  assert.equal(root.dataset.tkStartup, 'loading');
  assert.equal(typeof watchdog, 'function', 'a failed main module still has a recovery path');
}
const picker = { dataset: {} };
vm.runInNewContext(bootstrap, { window: { location: { search: '?screen-picker=1' } },
  document: { documentElement: picker }, URLSearchParams });
assert.equal(picker.dataset.tkStartup, undefined, 'screen capture must never display the home cover');
for (const language of ['zh', 'en']) {
  const locale = JSON.parse(await readFile(new URL(`../src/locales/${language}.json`, import.meta.url)));
  assert.ok(locale.app.loading);
}
console.log('Startup runtime passed: readiness ordering, native fonts, failures, timeout, input, teardown, theme and screen picker.');
