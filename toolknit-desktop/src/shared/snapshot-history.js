/**
 * Owns the bounded snapshot history for the document editors.
 *
 * The editor still decides what a snapshot contains and how it is applied;
 * this module only manages history navigation and transaction locking. That
 * keeps undo/redo behavior reusable without coupling it to DOM or PDF.js.
 */
export function createSnapshotHistory({
  capture,
  apply,
  equals,
  hasDocument = () => true,
  onChange = () => {},
  limit = 40,
  measure = () => 0,
  maxBytes = Infinity
} = {}) {
  if (typeof capture !== 'function') throw new TypeError('History capture must be a function');
  if (typeof apply !== 'function') throw new TypeError('History apply must be a function');
  if (typeof equals !== 'function') throw new TypeError('History equals must be a function');

  const maxEntries = Math.max(2, Number(limit) || 40);
  let entries = [];
  let index = -1;
  let locked = false;

  function notify() {
    try { onChange(); } catch (_) { /* UI refresh is best effort. */ }
  }

  function reset(snapshot = capture()) {
    entries = [snapshot];
    index = 0;
    notify();
    return snapshot;
  }

  function commit() {
    if (locked) return false;
    const snapshot = capture();
    entries = entries.slice(0, index + 1);
    entries.push(snapshot);
    while (entries.length > 1 && (entries.length > maxEntries || entries.reduce((sum, entry) => sum + measure(entry), 0) > maxBytes)) entries.shift();
    index = entries.length - 1;
    notify();
    return true;
  }

  function canUndo() {
    return index > 0;
  }

  function canRedo() {
    return index >= 0 && index < entries.length - 1;
  }

  function move(nextIndex) {
    if (nextIndex < 0 || nextIndex >= entries.length) return false;
    index = nextIndex;
    apply(entries[index]);
    notify();
    return true;
  }

  function undo() {
    return canUndo() && move(index - 1);
  }

  function redo() {
    return canRedo() && move(index + 1);
  }

  function withLock(callback) {
    const previous = locked;
    locked = true;
    try {
      return callback();
    } finally {
      locked = previous;
    }
  }

  function hasUnsavedChanges(savedSnapshot) {
    return Boolean(hasDocument() && savedSnapshot && !equals(capture(), savedSnapshot));
  }

  function clear() {
    entries = [];
    index = -1;
    notify();
  }

  return {
    canRedo,
    canUndo,
    clear,
    commit,
    firstSnapshot() { return entries[0] || null; },
    forEachSnapshot(visitor) { entries.forEach(visitor); },
    get index() { return index; },
    get length() { return entries.length; },
    hasUnsavedChanges,
    redo,
    reset,
    undo,
    withLock,
    get current() { return entries[index] || null; }
  };
}
