import { sanitizeWordHistory } from './word-conversion-history.js';
const STORAGE_KEY = 'toolknit.tasks.v1';
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);

/** Metadata only: file bytes and credentials never enter task history. */
export function createTaskCenter({ storage, limit = 100, now = () => new Date().toISOString() } = {}) {
  const listeners = new Set(), actions = new Map();
  let persistenceAvailable = Boolean(storage?.setItem);
  function cleanRow(row) {
    if (!row || typeof row.id !== 'string' || typeof row.label !== 'string') return null;
    return { id: row.id.slice(0, 100), label: row.label.slice(0, 240), tool: String(row.tool || '').slice(0, 100),
      state: String(row.state || 'interrupted'), progress: Number.isFinite(row.progress) ? row.progress : null,
      message: String(row.message || '').slice(0, 4096), createdAt: typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt)) ? row.createdAt.slice(0, 80) : now(),
      ...(typeof row.finishedAt === 'string' && Number.isFinite(Date.parse(row.finishedAt)) ? { finishedAt: row.finishedAt.slice(0, 80) } : {}),
      outputs: Array.isArray(row.outputs) ? row.outputs.filter(path => typeof path === 'string' && path.length <= 4096 && !path.includes('\0')).slice(0, 500) : [],
      ...(row.tool === 'word-to-pdf' && sanitizeWordHistory(row.recovery) ? { recovery: sanitizeWordHistory(row.recovery) } : {}) };
  }
  let tasks = [];
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(saved)) tasks = saved.slice(0, limit).map(cleanRow).filter(Boolean)
      .map(row => TERMINAL.has(row.state) ? row : { ...row, state: 'interrupted', finishedAt: now(), message: 'interrupted' });
  } catch { persistenceAvailable = false; }
  function publish() {
    const active = tasks.filter(row => !TERMINAL.has(row.state));
    const recent = tasks.filter(row => TERMINAL.has(row.state)).slice(0, limit);
    const kept = new Set([...active, ...recent].map(row => row.id));
    tasks = tasks.filter(row => kept.has(row.id));
    for (const id of actions.keys()) if (!kept.has(id)) actions.delete(id);
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(tasks.map(cleanRow))); persistenceAvailable = Boolean(storage?.setItem); }
    catch { persistenceAvailable = false; }
    for (const fn of listeners) { try { fn(); } catch {} }
  }
  function update(id, patch) {
    const row = tasks.find(item => item.id === id);
    if (!row) return;
    Object.assign(row, patch); publish();
  }
  function begin({ label, tool = '', cancel, retry, recovery } = {}) {
    const id = globalThis.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const recipe = tool === 'word-to-pdf' ? sanitizeWordHistory(recovery) : null;
    tasks.unshift({ id, label: String(label || tool), tool, state: 'running', progress: null, message: '', createdAt: now(), outputs: [], ...(recipe ? { recovery: recipe } : {}) });
    actions.set(id, { cancel, retry }); publish();
    let settled = false;
    return {
      id,
      recovery(value) { if (!settled && tool === 'word-to-pdf') update(id, { recovery: sanitizeWordHistory(value) }); },
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
  if (tasks.length) publish();
  return {
    begin,
    list: () => tasks.map(row => ({ ...cleanRow(row), canRecover: TERMINAL.has(row.state) && Boolean(row.recovery), canCancel: ['queued', 'running'].includes(row.state) && typeof actions.get(row.id)?.cancel === 'function', canRetry: ['failed', 'cancelled'].includes(row.state) && typeof actions.get(row.id)?.retry === 'function' })),
    persistenceAvailable: () => persistenceAvailable,
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
