export const RECORDING_SNAPSHOT_KEY = 'toolknit.recording-mode.snapshot.v1';
export const RECORDING_PROMPT_KEY = 'toolknit.recording-mode.prompt-dismissed.v1';
const keys = ['autostart', 'clipboard', 'history'];
// Native exceptions can contain paths; expose only stable product error codes.
export function recordingFailureCode(error) {
  const value = String(error?.code || error?.message || error || '');
  return /^(?:recording|screenshot|clipboard|autostart):[a-z-]{1,64}$/.test(value)
    ? value : 'recording:operation-failed';
}
export const isRecordingModeEnabled = state => keys.every(key => state?.[key] === true);
export function readRecordingSnapshot(storage) {
  try {
    const value = JSON.parse(storage?.getItem(RECORDING_SNAPSHOT_KEY) || 'null');
    return keys.every(key => typeof value?.[key] === 'boolean') ? Object.fromEntries(keys.map(key => [key, value[key]])) : null;
  } catch { return null; }
}

/** Serialize user actions, verify native state and restore only changes made by this transaction. */
export function createRecordingModeState({ adapter, storage, onChange = () => {} }) {
  let busy = false, disposed = false, revision = 0;
  let state = null;
  const publish = () => { if (!disposed) onChange({ state, busy, enabled: isRecordingModeEnabled(state) }); };
  const refresh = async () => {
    if (disposed || busy || !adapter.available) return state;
    const token = ++revision;
    let value;
    try { value = await adapter.read(); }
    catch (error) {
      if (!disposed && !busy && token === revision) throw error;
      return state;
    }
    if (!disposed && !busy && token === revision) { state = value; publish(); }
    return state;
  };
  async function setEnabled(enabled) {
    if (disposed || busy || !adapter.available) return false;
    busy = true; revision++; publish();
    let before, snapshot, stored = false, stage = 'read';
    const changed = [];
    try {
      before = await adapter.read();
      if (disposed) return false;
      snapshot = readRecordingSnapshot(storage);
      const target = enabled ? { autostart: true, clipboard: true, history: true } : snapshot || { autostart: false, clipboard: false, history: false };
      // Persist recovery intent before changing any system setting.
      if (enabled && !snapshot) { stage = 'snapshot'; storage.setItem(RECORDING_SNAPSHOT_KEY, JSON.stringify(before)); stored = true; }
      for (const key of keys) {
        if (disposed) throw new Error('recording:disposed');
        if (before[key] !== target[key]) {
          changed.push(key);
          stage = key;
          await adapter.set(key, target[key]);
        }
      }
      stage = 'verify';
      const actual = await adapter.read();
      const mismatch = keys.find(key => actual[key] !== target[key]);
      if (disposed || mismatch) { stage = mismatch || stage; throw new Error('recording:verification-failed'); }
      if (!enabled) { stage = 'snapshot'; storage.removeItem(RECORDING_SNAPSHOT_KEY); }
      state = actual;
      return true;
    } catch (error) {
      let rollbackFailed = false;
      for (const key of changed.reverse()) {
        try { await adapter.set(key, before[key]); } catch { rollbackFailed = true; }
      }
      try {
        state = await adapter.read();
        if (before && keys.some(key => state[key] !== before[key])) rollbackFailed = true;
      } catch { state = null; rollbackFailed ||= changed.length > 0; }
      if (stored && !rollbackFailed) {
        try { storage.removeItem(RECORDING_SNAPSHOT_KEY); } catch { /* Recovery intent is safe to retain. */ }
      }
      throw Object.assign(new Error(rollbackFailed ? 'recording:rollback-failed' : 'recording:failed', { cause: error }), {
        stage, code: recordingFailureCode(error)
      });
    } finally { busy = false; publish(); }
  }
  return { refresh, setEnabled, dispose() { disposed = true; revision++; }, get busy() { return busy; } };
}
