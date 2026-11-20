import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWindowRuntime } from '../src/app/window-runtime.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ theme = 'light', maximized = false, fullscreen = false, isTauri = true, picker = false, setSurface } = {}) {
  const node = () => ({ dataset: {}, style: { setProperty() {}, removeProperty() {} },
    classList: { toggle() {}, remove() {} }, setAttribute() {} });
  const documentRef = { documentElement: node(), body: node(), querySelectorAll: () => [] };
  const windowRef = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
  const state = { theme, maximized, fullscreen, decorated: false, shadows: [], surfaces: [], systemShadows: [], events: new Map(), subscriptions: new Set(), released: 0 };
  const observe = name => async callback => {
    state.events.set(name, callback);
    return () => { state.events.delete(name); state.released += 1; };
  };
  const appWindow = {
    isDecorated: async () => state.decorated,
    setDecorations: async value => { state.decorated = value; },
    isMaximized: async () => state.maximized,
    isFullscreen: async () => state.fullscreen,
    setShadow: async value => { state.systemShadows.push(value); },
    onResized: observe('resize'), onScaleChanged: observe('scale')
  };
  const runtime = createWindowRuntime({
    appWindow, isTauri, isScreenPickerWindow: picker, documentRef, windowRef, storage: null,
    tauriCorePromise: Promise.resolve({ invoke: async (command, surface) => {
      assert.equal(command, 'set_window_corner_radius');
      state.surfaces.push(surface);
      state.shadows.push(surface.shadow);
      await setSurface?.(surface);
    } }),
    getTheme: () => state.theme,
    onThemeChange: listener => { state.subscriptions.add(listener); return () => state.subscriptions.delete(listener); }
  });
  const change = value => { state.theme = value; state.subscriptions.forEach(listener => listener(value)); };
  return { state, runtime, change, windowRef };
}

const standard = fixture();
await tick();
assert.deepEqual(standard.state.shadows, [true], 'restored white theme enables native shadow on startup');
assert.deepEqual(standard.state.systemShadows, [false], 'rectangular DWM shadow stays off');
await standard.runtime.repairChrome();
assert.deepEqual(standard.state.shadows, [true], 'unchanged native state is not written repeatedly');
standard.change('dark');
await tick();
assert.deepEqual(standard.state.shadows, [true], 'mode changes keep the same frame treatment');
standard.change('light');
await tick();
standard.state.maximized = true;
await standard.runtime.syncFrame();
await tick();
assert.equal(standard.state.shadows.at(-1), false, 'maximized windows do not retain a shadow');
standard.state.maximized = false;
await standard.runtime.syncFrame();
await tick();
assert.equal(standard.state.shadows.at(-1), true, 'restore reapplies the selected theme');
standard.state.fullscreen = true;
await standard.runtime.syncFrame();
await tick();
assert.equal(standard.state.shadows.at(-1), false);
standard.change('dark');
standard.state.fullscreen = false;
await standard.runtime.syncFrame();
await tick();
assert.equal(standard.state.shadows.at(-1), true, 'leaving fullscreen restores the shared frame treatment');
standard.state.decorated = true;
await standard.runtime.repairChrome();
assert.equal(standard.state.decorated, false, 'shadow does not restore system title bars');
standard.runtime.save({ mode: 'custom', custom: 23 });
await tick();
assert.deepEqual(standard.state.surfaces.at(-1), { radius: 23, shadow: true });
standard.change('light');
await tick();
assert.deepEqual(standard.state.surfaces.at(-1), { radius: 23, shadow: true }, 'theme changes retain the exact custom radius');
assert.ok(standard.state.systemShadows.every(value => value === false));
standard.runtime.observeFrame();
standard.runtime.observeFrame();
await tick();
assert.equal(standard.state.events.size, 2);
standard.windowRef.dispatchEvent(new Event('pagehide'));
assert.equal(standard.state.released, 2);
assert.equal(standard.state.subscriptions.size, 0);
const calls = standard.state.shadows.length;
standard.change('light');
await standard.runtime.repairChrome();
assert.equal(standard.state.shadows.length, calls);
standard.runtime.dispose();

let finish;
const delayed = fixture({ theme: 'dark', setSurface: ({ shadow }) => shadow ? new Promise(resolve => { finish = resolve; }) : undefined });
await tick();
delayed.change('light');
await tick();
delayed.change('dark');
delayed.change('light');
delayed.change('dark');
finish();
await tick();
assert.deepEqual(delayed.state.shadows, [true], 'theme changes do not enqueue redundant native frame writes');
delayed.runtime.dispose();

let finishSurface;
let pendingSurface = true;
const radiusRace = fixture({ setSurface: () => pendingSurface ? new Promise(resolve => { finishSurface = resolve; }) : undefined });
await tick();
radiusRace.runtime.save({ mode: 'small' });
radiusRace.runtime.save({ mode: 'custom', custom: 32 });
radiusRace.change('dark');
pendingSurface = false;
finishSurface();
await tick();
assert.deepEqual(radiusRace.state.surfaces, [{ radius: 18, shadow: true }, { radius: 32, shadow: true }], 'radius changes settle without changing the shared frame treatment');
radiusRace.runtime.dispose();

for (const options of [{ isTauri: false }, { picker: true }]) {
  const isolated = fixture(options);
  await tick();
  isolated.change('dark');
  await isolated.runtime.repairChrome();
  assert.deepEqual(isolated.state.shadows, []);
  assert.equal(isolated.state.subscriptions.size, 0);
  isolated.runtime.dispose();
}
for (const options of [{ maximized: true }, { fullscreen: true }]) {
  const initial = fixture(options);
  await tick();
  assert.deepEqual(initial.state.shadows, [false], 'startup respects the actual native frame state');
  initial.runtime.dispose();
}

let fail = true;
const warnings = [];
const warn = console.warn;
try {
  console.warn = (...args) => warnings.push(args);
  const recovery = fixture({ setSurface: async () => { if (fail) throw new Error('fixture failure'); } });
  await tick();
  assert.ok(warnings.length > 0, 'native errors are handled');
  fail = false;
  await recovery.runtime.repairChrome();
  assert.deepEqual(recovery.state.shadows, [true, true], 'a failed write can be retried');
  recovery.runtime.dispose();
} finally { console.warn = warn; }

const config = JSON.parse(await readFile(new URL('../src-tauri/capabilities/default.json', import.meta.url)));
assert.ok(config.permissions.includes('core:window:allow-set-shadow'));
const composition = await readFile(new URL('../src/application-runtime.js', import.meta.url), 'utf8');
assert.match(composition, /getTheme: themeRuntime\.get/);
assert.doesNotMatch(composition, /\.setShadow\(/);
console.log('Native shadow theme, frame state, concurrency, failure recovery and lifecycle checks passed');
