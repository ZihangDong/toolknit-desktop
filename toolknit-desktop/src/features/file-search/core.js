export const SORTS = Object.freeze(['relevance', 'name-asc', 'name-desc', 'newest', 'oldest', 'largest', 'smallest']);
export function normalizeQuery(value = {}) {
  return { text: String(value.text || '').slice(0, 256), extension: String(value.extension || '').replace(/^\.+/, '').toLowerCase(), sort: SORTS.includes(value.sort) ? value.sort : 'relevance' };
}
export function queryKey(query) { return JSON.stringify(normalizeQuery(query)); }
export function errorCode(error) {
  const value = typeof error === 'string' ? error : error?.message || '';
  return /file-search:([a-z-]+)/.exec(value)?.[1] || 'failed';
}
export function errorText(error, tr) {
  const text = tr(`errors.${errorCode(error)}`);
  return text.startsWith('fileSearch.errors.') ? tr('errors.failed') : text;
}
// Native IPC completions may arrive out of order. A new query must wait for
// every previously issued invalidation, not merely the newest acknowledgement.
export function createInvalidationBarrier(invalidate) {
  let pending = Promise.resolve();
  return {
    invalidate() {
      let next;
      try { next = Promise.resolve(invalidate()).catch(() => {}); }
      catch { next = Promise.resolve(); }
      pending = Promise.all([pending, next]).then(() => {});
    },
    wait: () => pending
  };
}
// The capsule publishes into the other WebView. Keep cancellation ordering,
// debounce and close/IME invalidation here so it cannot send a stale draft.
export function createInputPublisher({ invalidate, publish, failed = () => {}, delay = 110 }) {
  const barrier = createInvalidationBarrier(invalidate);
  let revision = 0, timer, disposed = false, pending = false, publishing = Promise.resolve();
  const cancel = () => { revision++; pending = false; clearTimeout(timer); };
  const invalidateCurrent = () => { if (disposed) return; cancel(); barrier.invalidate(); };
  async function execute(text, token) {
    await Promise.all([barrier.wait(), publishing]);
    if (disposed || token !== revision) return;
    publishing = Promise.resolve().then(() => publish(text)).catch(error => {
      if (!disposed && token === revision) failed(error);
    });
    await publishing;
    if (!disposed && token === revision) pending = false;
  }
  return {
    submit(text, { immediate = false } = {}) {
      if (disposed) return;
      invalidateCurrent(); pending = true; const token = revision;
      if (immediate) void execute(text, token);
      else timer = setTimeout(() => void execute(text, token), delay);
    },
    invalidate: invalidateCurrent, cancel, get pending() { return pending; },
    dispose() { disposed = true; cancel(); }
  };
}
// Input invalidates immediately; debounce controls work, not freshness.
export function createQuerySession({ search, check = null, invalidate = () => {}, changed = () => {}, failed = () => {}, delay = 110 }) {
  let revision = 0, query = normalizeQuery(), timer, disposed = false, cursor = null, rows = [], ticket = '', loading = false;
  let ready = false, composing = false;
  let checking = false;
  const barrier = createInvalidationBarrier(invalidate);
  const invalidateCurrent = () => barrier.invalidate();
  const emit = extra => changed({ query: { ...query }, rows: [...rows], cursor, ticket, loading, ...extra });
  async function execute(append = false, background = false) {
    if (disposed || composing || !ready || (append && (!cursor || loading))) return;
    const token = ++revision, page = append ? cursor : null;
    loading = true; emit({ background });
    try {
      await barrier.wait();
      if (disposed || revision !== token || !ready || composing) return;
      const data = await search({ query, cursor: page });
      if (disposed || revision !== token) return;
      const incoming = Array.isArray(data?.result?.rows) ? data.result.rows : [];
      const ids = new Set(append ? rows.map(row => row.id) : []);
      rows = [...(append ? rows : []), ...incoming.filter(row => { if (ids.has(row.id)) return false; ids.add(row.id); return true; })];
      cursor = data.cursor || null; ticket = data.ticket || ''; loading = false;
      emit({ background: false, total: data.result.total, extensions: data.result.extensions, index: data.index, generation: data.generation });
    } catch (error) {
      if (disposed || revision !== token) return;
      loading = false;
      if (errorCode(error) === 'cancelled') { ticket = ''; emit({ background: false }); return; }
      if (append && errorCode(error) === 'stale-query') { cursor = null; rows = []; ticket = ''; void execute(false); return; }
      rows = []; cursor = null; ticket = ''; emit({ background: false }); failed(error);
    }
  }
  function set(next, { immediate = false, force = false } = {}) {
    if (disposed) return;
    const value = normalizeQuery({ ...query, ...next });
    if (!force && queryKey(value) === queryKey(query)) return;
    const same = queryKey(value) === queryKey(query);
    query = value; revision++; clearTimeout(timer); if (!same) rows = []; cursor = null; ticket = ''; loading = true;
    invalidateCurrent(); emit({ background: false });
    if (!composing && ready) { if (immediate) void execute(); else timer = setTimeout(() => void execute(), delay); }
  }
  return {
    set, more: () => execute(true), refresh: () => set(query, { immediate: true, force: true }),
    async checkUpdate() {
      if (!check || disposed || !ready || composing || loading || checking || !ticket) return null;
      const token=revision, previous=ticket; checking=true;
      try { const value=await check({ticket:previous}); return !disposed && ready && revision===token && ticket===previous ? value : null; }
      catch (error) { return !disposed && ready && revision===token && ticket===previous && errorCode(error)==='stale-query' ? {expired:true} : null; } finally { checking=false; }
    },
    refreshBackground() { if (!disposed && ready && !loading && !composing) void execute(false,true); },
    start() { if (disposed || ready) return; ready = true; void execute(); },
    composition(active) { if (disposed || composing === active) return; composing = active; revision++; clearTimeout(timer); if (active) { ticket = ''; loading = true; invalidateCurrent(); emit(); } else set(query, { force: true }); },
    pause() { if (disposed || (!ready && !composing && !loading)) return; ready = false; composing = false; revision++; clearTimeout(timer); loading = false; ticket = ''; invalidateCurrent(); },
    dispose() { if (disposed) return; disposed = true; ready = false; revision++; clearTimeout(timer); rows = []; cursor = null; ticket = ''; loading = false; invalidateCurrent(); },
    get query() { return { ...query }; },
    get active() { return ready && !disposed; }
  };
}
