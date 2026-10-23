function cancelRenderTask(task) {
  try { task?.cancel?.(); } catch (_) {}
}

export function createPausableRenderQueue({ concurrency = 2, run } = {}) {
  if (typeof run !== 'function') throw new TypeError('A render queue requires a task runner');
  const limit = Math.max(1, Math.floor(Number(concurrency) || 1));
  const pending = [];
  const pendingKeys = new Set();
  const renderTasks = new Map();
  let active = 0;
  let disposed = false;
  let paused = false;

  function pump() {
    if (disposed || paused) return;
    while (active < limit && pending.length) {
      const key = pending.shift();
      pendingKeys.delete(key);
      active += 1;
      void Promise.resolve().then(() => run(key)).finally(() => {
        active -= 1;
        pump();
      });
    }
  }

  function enqueue(key, { front = false } = {}) {
    if (disposed || pendingKeys.has(key)) return;
    pendingKeys.add(key);
    front ? pending.unshift(key) : pending.push(key);
    pump();
  }

  function track(key, task) {
    if (disposed) {
      cancelRenderTask(task);
      return () => {};
    }
    renderTasks.set(key, task);
    return () => {
      if (renderTasks.get(key) === task) renderTasks.delete(key);
    };
  }

  function pause() {
    if (disposed || paused) return;
    paused = true;
    renderTasks.forEach(cancelRenderTask);
  }

  function resume() {
    if (disposed || !paused) return;
    paused = false;
    pump();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    pending.length = 0;
    pendingKeys.clear();
    renderTasks.forEach(cancelRenderTask);
    renderTasks.clear();
  }

  return {
    dispose,
    enqueue,
    pause,
    requeue: key => enqueue(key, { front: true }),
    resume,
    track,
    get paused() { return paused; }
  };
}
