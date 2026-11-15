import { createLocalOcrRuntime } from '../platform/local-ocr-runtime.js';
import { createLifecycleScope } from './tool-lifecycle.js';
import { createModalSession } from './modal-runtime.js';
import { formatDependencyBytes } from './dependency-helpers.js';
import '../styles/components/local-translation.css';

export function createLocalOcrSettings({ root = document, isTauri = false, translate = key => key, onLanguageChange, notify = () => {} } = {}) {
  const q = id => root.getElementById(`localOcr${id}`), scope = createLifecycleScope();
  if (!q('Overlay')) return { dispose() {} };
  const runtime = createLocalOcrRuntime({ isTauri }), tr = key => translate(`settings.localOcr.${key}`);
  let state = {}, pending = false, error = '', revision = 0, request = null;
  const modal = createModalSession({ root: q('Overlay'), initialFocus: q('Install'), onClose: close });
  function settle(value) { request?.resolve(value); request = null; }
  function close() { modal.close(); settle(false); }
  function render() {
    if (scope.disposed) return;
    const busy = pending || state.installing;
    q('Summary').textContent = tr(state.ready ? 'ready' : 'missing');
    q('Status').textContent = tr(error || (busy ? state.progress?.phase === 'testing' ? 'testing' : 'downloading' : state.ready ? 'ready' : 'missing'));
    q('Install').textContent = tr(state.ready ? 'repair' : 'install'); q('Install').disabled = !isTauri || busy;
    q('Remove').hidden = !state.ready; q('Remove').disabled = busy || state.busy;
    q('Cancel').hidden = !busy;
    q('Progress').hidden = !busy; q('Progress').max = state.progress?.total || state.downloadBytes || 1; q('Progress').value = state.progress?.received || 0;
    q('Bytes').hidden = !busy; q('Bytes').textContent = `${formatDependencyBytes(state.progress?.received)} / ${formatDependencyBytes(state.progress?.total || state.downloadBytes)}`;
    const focused = root.activeElement; if (q('Overlay').contains(focused) && (focused.hidden || focused.disabled)) q('Close').focus({ preventScroll: true });
  }
  async function refresh() {
    if (!isTauri || pending || scope.disposed) return;
    const current = ++revision;
    try { const next = await runtime.call('status'); if (current === revision && !scope.disposed) { state = next; render(); } }
    catch { if (current === revision && !scope.disposed) { error = 'error'; render(); } }
  }
  function open() { error = ''; modal.open(); render(); void refresh(); }
  async function change(action) {
    if (pending || state.installing) return;
    revision++; pending = true; error = ''; render();
    try { state = await runtime.call(action); if (!scope.disposed) { notify(tr(action === 'install' ? 'installed' : 'removed')); if (action === 'install') { settle(true); modal.close(); } } }
    catch (e) { if (!scope.disposed) { error = String(e).includes('cancelled') ? 'cancelled' : String(e).includes('checksum') ? 'checksum' : 'error'; } }
    finally { pending = false; if (!scope.disposed) { state.installing = false; render(); void refresh(); } }
  }
  scope.event(q('Manage'), 'click', open); scope.event(q('Close'), 'click', close);
  scope.event(q('Install'), 'click', () => void change('install')); scope.event(q('Remove'), 'click', () => void change('remove'));
  scope.event(q('Cancel'), 'click', () => void runtime.call('cancel-install').catch(() => notify(tr('error'))));
  scope.event(root, 'local-ocr-request', event => { settle(false); request = event.detail; request.handled = true; if (request?.signal?.aborted) return settle(false); open(); });
  for (const [name, handler] of [
    ['local-ocr-open', open],
    ['local-ocr-progress', progress => { state = { ...state, installing: true, progress }; render(); }],
    ['local-ocr-changed', next => { state = next; render(); }]
  ]) void runtime.listen(name, value => { if (!scope.disposed) { revision++; handler(value); } }).then(unlisten => scope.use(unlisten)).catch(() => {});
  if (onLanguageChange) scope.use(onLanguageChange(render));
  scope.use(() => { settle(false); modal.dispose(); });
  if (root.defaultView) scope.event(root.defaultView, 'pagehide', () => { if (pending) void runtime.call('cancel-install').catch(() => {}); scope.dispose(); }, { once: true });
  render(); void refresh(); return { refresh, dispose: scope.dispose };
}
