import { createFileSearchRuntime } from '../platform/file-search-runtime.js';
import { createLifecycleScope } from './tool-lifecycle.js';

export function createFileSearchContextRuntime({ isTauri, getLang, onLangChange, onNavigate, notify = () => {}, translate,
  runtime = createFileSearchRuntime({ isTauri }), root = globalThis.document, windowRef = globalThis.window } = {}) {
  if (!isTauri) return;
  const scope = createLifecycleScope();
  const motion = windowRef.matchMedia('(prefers-reduced-motion: reduce)');
  let disposed = false, sending = false, pending = null, sent = '';
  const flush = async () => {
    if (sending || disposed) return;
    sending = true;
    try {
      while (pending && !disposed) {
        const next = pending; pending = null;
        const key = JSON.stringify(next);
        if (key === sent) continue;
        try { await runtime.call('context', next); if (!disposed) sent = key; }
        catch { /* Keep the next real context event retryable without a busy loop. */ }
      }
    } finally { sending = false; }
  };
  const sync = () => {
    if (disposed) return;
    pending = { lang: getLang(), theme: root.documentElement.dataset.theme, reducedMotion: motion.matches };
    void flush();
  };
  const observer = new windowRef.MutationObserver(sync); observer.observe(root.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  scope.use(() => observer.disconnect()); scope.use(onLangChange(sync));
  scope.event(motion, 'change', sync);
  void runtime.onPanelEvent('file-search-navigate', () => {
    if (disposed) return;
    void Promise.resolve().then(() => { if (!disposed) return onNavigate(); })
      .catch(() => { if (!disposed) notify(translate('fileSearch.errors.failed')); });
  }).then(unlisten => scope.use(unlisten)).catch(() => {});
  const dispose = () => { disposed = true; pending = null; scope.dispose(); };
  scope.event(windowRef, 'pagehide', dispose);
  sync();
  return { dispose };
}
