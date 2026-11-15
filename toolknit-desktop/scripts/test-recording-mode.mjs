import assert from 'node:assert/strict';
import { createRecordingModeState, isRecordingModeEnabled, readRecordingSnapshot, recordingFailureCode, RECORDING_SNAPSHOT_KEY } from '../src/app/recording-mode-state.js';
import { createRecordingModeAdapter } from '../src/platform/recording-mode-runtime.js';

const off = () => ({ autostart: false, clipboard: false, history: false });
const on = () => ({ autostart: true, clipboard: true, history: true });
const memory = () => {
  const entries = new Map();
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
};
function fixture(initial = off(), storage = memory()) {
  let native = { ...initial };
  const calls = [], published = [];
  const adapter = { available: true, read: async () => ({ ...native }), set: async (key, enabled) => { calls.push([key, enabled]); native[key] = enabled; } };
  const model = createRecordingModeState({ adapter, storage, onChange: value => published.push(value) });
  return { model, adapter, storage, calls, published, get native() { return native; } };
}

// Preserve independently enabled preferences, including across application restart.
{
  const previous = { ...off(), clipboard: true };
  const f = fixture(previous);
  await f.model.refresh();
  assert.equal(await f.model.setEnabled(true), true);
  assert.deepEqual(f.native, on());
  assert.deepEqual(readRecordingSnapshot(f.storage), previous);
  f.model.dispose();
  const restarted = createRecordingModeState({ adapter: f.adapter, storage: f.storage });
  assert.equal(await restarted.setEnabled(false), true);
  assert.deepEqual(f.native, previous);
  assert.equal(readRecordingSnapshot(f.storage), null);
}
{
  const f = fixture(on());
  await f.model.setEnabled(false);
  assert.deepEqual(f.native, off(), 'without saved state, turning mode off disables all three');
}
{
  const f = fixture();
  await f.model.setEnabled(true);
  f.native.clipboard = false;
  await f.model.refresh();
  assert.equal(f.published.at(-1).enabled, false, 'tray/tool changes update aggregate status');
  await f.model.setEnabled(true);
  assert.deepEqual(readRecordingSnapshot(f.storage), off(), 're-enabling preserves original snapshot');
  await f.model.setEnabled(false);
  assert.deepEqual(f.native, off());
}

// A partial native failure can occur after mutation: rollback includes that key.
{
  const f = fixture();
  const set = f.adapter.set;
  f.adapter.set = async (key, enabled) => {
    await set(key, enabled);
    if (key === 'clipboard' && enabled) throw new Error('native-failure');
  };
  await assert.rejects(f.model.setEnabled(true), /recording:failed/);
  assert.deepEqual(f.native, off());
  assert.deepEqual(f.calls, [['autostart', true], ['clipboard', true], ['clipboard', false], ['autostart', false]]);
  assert.equal(readRecordingSnapshot(f.storage), null);
  assert.equal(f.model.busy, false);
}
{
  const f = fixture();
  const set = f.adapter.set;
  f.adapter.set = async (key, enabled) => {
    if (key === 'clipboard' && enabled) throw new Error('write-failed');
    if (key === 'autostart' && !enabled) throw new Error('restore-failed');
    await set(key, enabled);
  };
  await assert.rejects(f.model.setEnabled(true), /recording:rollback-failed/);
  assert.deepEqual(readRecordingSnapshot(f.storage), off(), 'retain recovery intent after failed rollback');
  assert.equal(f.published.at(-1).state.autostart, true, 'UI reports actual partial state');
}
{
  const f = fixture();
  const set = f.adapter.set;
  f.adapter.set = async (key, enabled) => { if (key !== 'history') await set(key, enabled); };
  await assert.rejects(f.model.setEnabled(true), /recording:failed/);
  assert.deepEqual(f.native, off(), 'verify success rather than trusting command completion');
}
{
  const f = fixture();
  f.storage.setItem = () => { throw new Error('storage-unavailable'); };
  await assert.rejects(f.model.setEnabled(true), /recording:failed/);
  assert.equal(f.calls.length, 0, 'persist recovery intent before changing Windows settings');
}
{
  const storage = memory();
  storage.setItem(RECORDING_SNAPSHOT_KEY, '{"autostart":true}');
  assert.equal(readRecordingSnapshot(storage), null);
  storage.setItem(RECORDING_SNAPSHOT_KEY, '{malformed');
  assert.equal(readRecordingSnapshot(storage), null);
  assert.equal(isRecordingModeEnabled({ ...on(), clipboard: 'true' }), false);
}

// Repeated clicks, stale reads and disposal cannot publish obsolete states.
{
  const f = fixture();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const read = f.adapter.read;
  let first = true;
  f.adapter.read = async () => { if (first) { first = false; await pending; } return read(); };
  const action = f.model.setEnabled(true);
  assert.equal(await f.model.setEnabled(true), false);
  assert.equal(await f.model.setEnabled(false), false);
  release();
  await action;
  assert.equal(f.calls.length, 3);
}
{
  const f = fixture();
  let release;
  const read = f.adapter.read;
  f.adapter.read = () => new Promise(resolve => { release = resolve; });
  const stale = f.model.refresh();
  f.adapter.read = read;
  await f.model.setEnabled(true);
  release(off());
  await stale;
  assert.equal(f.published.at(-1).enabled, true);
}
{
  const f = fixture();
  const set = f.adapter.set;
  let release;
  f.adapter.set = async (key, value) => {
    await set(key, value);
    if (key === 'autostart' && value) await new Promise(resolve => { release = resolve; });
  };
  const action = f.model.setEnabled(true);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  f.model.dispose();
  const count = f.published.length;
  release();
  await assert.rejects(action, /recording:failed/);
  assert.deepEqual(f.native, off());
  assert.equal(f.published.length, count);
}

// Native adapter uses established commands and preserves disabled shortcuts.
{
  const calls = [];
  const adapter = createRecordingModeAdapter({ isTauri: true, core: Promise.resolve({
    invoke: async (command, args) => {
      calls.push([command, args]);
      if (command === 'get_autostart') return { supported: true, enabled: true };
      if (command === 'clipboard_history') return { enabled: false };
      if (args?.request?.action === 'preferences') return { shortcut: null, history: false };
    }
  }) });
  assert.deepEqual(await adapter.read(), { autostart: true, clipboard: false, history: false });
  await adapter.set('history', true);
  assert.deepEqual(calls.at(-1), ['quick_screenshot', { request: { action: 'configure', preferences: { shortcut: null, history: true } } }]);
  await adapter.set('clipboard', false);
  assert.deepEqual(calls.at(-1), ['clipboard_history', { request: { action: 'stop' } }]);
  await assert.rejects(adapter.set('invalid', true), /invalid-setting/);
}
{
  let released = 0;
  const events = Promise.resolve({ listen: async name => {
    if (name === 'screenshot-preferences-changed') throw new Error('listen-failed');
    return () => released++;
  } });
  await assert.rejects(createRecordingModeAdapter({ events }).subscribe(() => {}), /listen-failed/);
  assert.equal(released, 2);
}
{
  const adapter = createRecordingModeAdapter({ isTauri: true, core: Promise.resolve({ invoke: async () => ({ supported: true }) }) });
  await assert.rejects(adapter.read(), /invalid-state/);
}
console.log('Recording mode passed: native preferences, snapshots, restart, rollback, concurrency, disposal and listener cleanup.');

{
  const f = fixture();
  f.adapter.read = async () => { throw new Error('clipboard:key-missing'); };
  await assert.rejects(f.model.setEnabled(true), error => error.message === 'recording:failed'
    && error.stage === 'read' && error.code === 'clipboard:key-missing');
  assert.equal(f.calls.length, 0, 'unreadable state must not mutate settings or claim failed rollback');
}
{
  const f = fixture({ ...off(), clipboard: true });
  const set = f.adapter.set;
  f.adapter.set = async (key, value) => {
    if (key === 'history' && value) throw new Error('screenshot:window-failed');
    await set(key, value);
  };
  await assert.rejects(f.model.setEnabled(true), error => error.stage === 'history'
    && error.code === 'screenshot:window-failed');
  assert.deepEqual(f.native, { ...off(), clipboard: true }, 'independent clipboard setting survives window failure');
}
{
  const f = fixture();
  const read = f.adapter.read;
  let reject;
  f.adapter.read = () => new Promise((_, fail) => { reject = fail; });
  const stale = f.model.refresh();
  f.adapter.read = read;
  await f.model.setEnabled(true);
  reject(new Error('clipboard:busy')); await stale;
  assert.equal(f.published.at(-1).enabled, true, 'stale read error cannot override later successful action');
}
assert.equal(recordingFailureCode(new Error('private-path/example')), 'recording:operation-failed');
assert.equal(recordingFailureCode('screenshot:shortcut-conflict'), 'screenshot:shortcut-conflict');
console.log('Recording mode diagnostics: safe codes, failed stage, no-write failure, protected independent settings and stale error passed.');
