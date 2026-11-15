// Only the current virtual window owns thumbnail requests. Keep decoded images
// out of the index and never load a full file into the WebView.
export function createThumbnails({ runtime, limit = 2, cacheLimit = 64, timeout = 4500 } = {}) {
  let ticket = '', namespace = '', retryTimer = null, epoch = 0, disposed = false, targets = new Map(), queue = [], active = 0;
  const retries = new Map(), cache = new Map(), running = new Set(), owners = new Set();
  function wait(value, signal, ms = timeout, delay = false) {
    return new Promise((resolve, reject) => {
      let done = false, timer;
      const finish = (fn, result) => { if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort); fn(result); };
      const abort = () => finish(reject, new Error('cancelled'));
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => delay ? finish(resolve) : finish(reject, new Error('timeout')), ms);
      if (!delay) Promise.resolve().then(value).then(result => finish(resolve, result), error => finish(reject, error));
    });
  }
  async function request(payload, signal) {
    const until = Date.now() + timeout;
    for (let attempt = 0; ; attempt++) {
      try { return await wait(() => runtime.call('thumbnail', payload), signal, Math.max(1, until - Date.now())); }
      catch (error) {
        const ms = Math.min(100 * 2 ** attempt, 800);
        if (signal.aborted || !String(error?.message || error).includes('file-search:busy') || Date.now() + ms >= until) throw error;
        await wait(null, signal, ms, true);
      }
    }
  }
  const key = row => JSON.stringify([row.id, row.parent, row.name, row.size, row.modified, Boolean(row.stale)]);
  function show(item, image) {
    if (!item || !item.picture.isConnected) return;
    if (!image) { item.mark.dataset.thumbnail = 'unavailable'; return; }
    const picture = item.picture;
    picture.onload = () => {
      if (!disposed && targets.get(item.key)?.picture === picture) item.mark.dataset.thumbnail = 'ready';
      picture.onload = picture.onerror = null;
    };
    picture.onerror = () => { item.mark.dataset.thumbnail = 'unavailable'; picture.onload = picture.onerror = null; picture.src = item.fallback; };
    picture.src = image;
    if (picture.complete && picture.naturalWidth) picture.onload?.();
  }
  function remember(id, value) {
    cache.delete(id); cache.set(id, value);
    while (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
  }
  function pump() {
    while (!disposed && ticket && active < limit && queue.length) {
      const item = queue.shift(), owner = ticket, revision = epoch, job = `${revision}:${item.key}`;
      if (!targets.has(item.key) || running.has(job)) continue;
      running.add(job); active++;
      const controller = new AbortController(); owners.add(controller);
      request({ id: item.row.id, ticket: owner }, controller.signal).then(value => {
        if (disposed || epoch !== revision) return;
        const image = typeof value?.image === 'string' && value.image.length <= 100000 && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value.image) ? value.image : null;
        remember(item.key, image); show(targets.get(item.key), image);
      }).catch(error => {
          if (disposed || epoch !== revision) return;
          show(targets.get(item.key), null);
          const transient = /busy|timeout|worker|cancelled|stale-query/.test(String(error?.message || error));
          if (!transient) { remember(item.key, null); return; }
          const tries = (retries.get(item.key) || 0) + 1; retries.set(item.key, tries);
          while (retries.size > cacheLimit) retries.delete(retries.keys().next().value);
          if (tries <= 1 && !retryTimer) retryTimer = setTimeout(() => {
            retryTimer = null;
            for (const [id, current] of targets) if (retries.get(id) === 1 && !cache.has(id) && !running.has(`${epoch}:${id}`)) queue.push(current);
            pump();
          }, 1000);
        })
        .finally(() => { owners.delete(controller); running.delete(job); active--; pump(); });
    }
  }
  function clear(keepCache = false) {
    clearTimeout(retryTimer); retryTimer = null;
    epoch++; retries.clear(); ticket = ''; queue = [];
    if (!keepCache) cache.clear(); else for (const [id, value] of cache) if (!value) cache.delete(id);
    for (const owner of owners) owner.abort();
    for (const item of targets.values()) item.picture.onload = item.picture.onerror = null;
    targets.clear();
  }
  return {
    update(items, nextTicket, nextNamespace = nextTicket) {
      if (disposed) return;
      if (ticket !== nextTicket || namespace !== nextNamespace) { const keep = namespace === nextNamespace; clear(keep); namespace = nextNamespace; ticket = nextTicket || ''; }
      const next = new Map(items.map(item => { item.key = key(item.row); return [item.key, item]; }));
      for (const [id, item] of targets) if (next.get(id)?.picture !== item.picture) item.picture.onload = item.picture.onerror = null;
      targets = next; queue = [];
      if (!ticket) return;
      for (const item of targets.values()) {
        if (cache.has(item.key)) { const image = cache.get(item.key); remember(item.key, image); if (item.picture.src !== image || (image && item.mark.dataset.thumbnail !== 'ready')) show(item, image); }
        else { item.mark.dataset.thumbnail = 'loading'; if (!running.has(`${epoch}:${item.key}`) && !retries.has(item.key)) queue.push(item); }
      }
      pump();
    },
    clear,
    dispose() { if (disposed) return; clear(); disposed = true; }
  };
}
