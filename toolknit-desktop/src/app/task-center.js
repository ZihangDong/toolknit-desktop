const STORAGE_KEY = 'toolknit.tasks.v1';
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);

/** Metadata only: file bytes and credentials never enter task history. */
export function createTaskCenter({ storage, limit = 100, now = () => new Date().toISOString() } = {}) {
  const listeners = new Set(), actions = new Map();
  let tasks = [];
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(saved)) tasks = saved.filter(row => row && typeof row.id === 'string' && typeof row.label === 'string').slice(0, limit)
      .map(row => TERMINAL.has(row.state) ? row : { ...row, state: 'interrupted', finishedAt: now(), message: 'interrupted' });
  } catch { /* unavailable storage starts an empty session */ }
  function publish() {
    const active = tasks.filter(row => !TERMINAL.has(row.state));
    const recent = tasks.filter(row => TERMINAL.has(row.state)).slice(0, limit);
    const kept = new Set([...active, ...recent].map(row => row.id));
    tasks = tasks.filter(row => kept.has(row.id));
    for (const id of actions.keys()) if (!kept.has(id)) actions.delete(id);
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(tasks)); } catch { /* work continues without history persistence */ }
    for (const fn of listeners) { try { fn(); } catch {} }
  }
  function update(id, patch) {
    const row = tasks.find(item => item.id === id);
    if (!row) return;
    Object.assign(row, patch); publish();
  }
  function begin({ label, tool = '', cancel, retry } = {}) {
    const id = globalThis.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    tasks.unshift({ id, label: String(label || tool), tool, state: 'running', progress: null, message: '', createdAt: now(), outputs: [] });
    actions.set(id, { cancel, retry }); publish();
    let settled = false;
    return {
      id,
      queued() { if (!settled) update(id, { state: 'queued' }); },
      start() { if (!settled) update(id, { state: 'running' }); },
      disableCancellation() { const action = actions.get(id); if (action) action.cancel = null; publish(); },
      progress(percent, message = '') {
        if (settled) return;
        const value = Number(percent);
        update(id, { progress: percent === null || !Number.isFinite(value) ? null : Math.max(0, Math.min(99, value)), message });
      },
      finish({ outputs = [], message = '' } = {}) {
        if (settled) return; settled = true;
        update(id, { state: 'succeeded', progress: 100, outputs: outputs.filter(path => typeof path === 'string'), message, finishedAt: now() });
      },
      fail(error, { outputs = [] } = {}) {
        if (settled) return; settled = true;
        const cancelled = error?.name === 'AbortError' || error?.code === 'CANCELLED';
        update(id, { state: cancelled ? 'cancelled' : 'failed', outputs, message: String(error?.message || error), finishedAt: now() });
      }
    };
  }
  return {
    begin,
    list: () => tasks.map(row => ({ ...row, outputs: [...(row.outputs || [])], canCancel: ['queued', 'running'].includes(row.state) && typeof actions.get(row.id)?.cancel === 'function', canRetry: ['failed', 'cancelled'].includes(row.state) && typeof actions.get(row.id)?.retry === 'function' })),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async cancel(id) {
      const row = tasks.find(item => item.id === id), action = actions.get(id)?.cancel;
      if (!['queued', 'running'].includes(row?.state) || typeof action !== 'function') return;
      const previousState = row.state;
      update(id, { state: 'cancelling' });
      try { await action(); } catch (error) {
        if (row.state === 'cancelling') update(id, { state: previousState, message: String(error?.message || error) });
      }
    },
    retry(id) {
      const row = tasks.find(item => item.id === id);
      if (!['failed', 'cancelled'].includes(row?.state)) return;
      return actions.get(id)?.retry?.();
    },
    clearFinished() {
      const removed = tasks.filter(row => TERMINAL.has(row.state));
      tasks = tasks.filter(row => !TERMINAL.has(row.state));
      for (const row of removed) actions.delete(row.id);
      publish();
    }
  };
}

let storage;
try { storage = globalThis.localStorage; } catch {}
export const taskCenter = createTaskCenter({ storage });
