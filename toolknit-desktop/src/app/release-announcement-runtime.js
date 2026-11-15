import { createLifecycleScope } from './tool-lifecycle.js';
import { createModalSession } from './modal-runtime.js';
import { onLangChange, t } from '../i18n.js';
import '../styles/components/release-announcement.css';

export const RELEASE_NOTICE_STORAGE_KEY = 'toolknit_release_notice_acknowledged_version';
const REQUIRED_VISIBLE_MS = 10_000;

export function createReleaseAnnouncementRuntime({
  root,
  background,
  appVersion,
  enabled = true,
  storage = globalThis.localStorage,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  now = () => globalThis.performance.now()
} = {}) {
  const permanent = createLifecycleScope();
  const button = root?.querySelector?.('#releaseNoticeAcknowledge');
  if (!enabled || !root || !button || !appVersion) {
    return Object.freeze({ openIfNeeded: () => false, acknowledged: Promise.resolve(), dispose: permanent.dispose });
  }

  const modal = createModalSession({
    root,
    background,
    initialFocus: root.querySelector('[data-home-link="website"]'),
    canClose: () => false,
    documentRef
  });
  let session = null;
  let visibleMs = 0;
  let lastTick = 0;
  let counting = false;
  let displayedSeconds = null;
  let tickTimer = null;
  let finished = false;
  let resolveAcknowledged;
  const acknowledged = new Promise(resolve => { resolveAcknowledged = resolve; });

  const renderCountdown = (force = false) => {
    const seconds = Math.ceil(Math.max(0, REQUIRED_VISIBLE_MS - visibleMs) / 1000);
    if (!force && seconds === displayedSeconds) return;
    displayedSeconds = seconds;
    const key = seconds ? 'home.releaseNotice.wait' : 'home.releaseNotice.continue';
    const vars = seconds ? { seconds } : {};
    button.disabled = seconds > 0;
    button.textContent = t(key, vars);
    button.setAttribute('aria-label', t(key, vars));
    if (!seconds && tickTimer !== null) { clearInterval(tickTimer); tickTimer = null; }
  };

  const tick = () => {
    const current = now();
    if (counting) {
      // WebView focus may lag behind the visible startup UI. Count actual
      // visible time, including delayed timer delivery, without a focus gate.
      visibleMs = Math.min(REQUIRED_VISIBLE_MS, visibleMs + Math.max(0, current - lastTick));
    }
    lastTick = current;
    renderCountdown();
  };

  const openIfNeeded = () => {
    if (permanent.disposed || finished) return false;
    if (root.classList.contains('visible')) return true;
    try {
      if (storage?.getItem(RELEASE_NOTICE_STORAGE_KEY) === appVersion) {
        finished = true;
        resolveAcknowledged();
        return false;
      }
    } catch {
      // If storage is unavailable, show the notice on each launch rather than skipping it.
    }
    session?.dispose();
    session = createLifecycleScope();
    visibleMs = 0;
    displayedSeconds = null;
    lastTick = now();
    modal.open();
    counting = documentRef?.visibilityState !== 'hidden';
    renderCountdown();
    tickTimer = session.interval(tick, 200);
    session.event(documentRef, 'visibilitychange', () => {
      tick();
      counting = documentRef?.visibilityState !== 'hidden';
    });
    return true;
  };

  permanent.event(button, 'click', () => {
    if (!session || finished) return;
    tick();
    if (visibleMs < REQUIRED_VISIBLE_MS) return;
    try { storage?.setItem(RELEASE_NOTICE_STORAGE_KEY, appVersion); } catch {}
    session?.dispose();
    session = null;
    finished = true;
    modal.close();
    resolveAcknowledged();
  });
  permanent.use(onLangChange(() => { if (session) renderCountdown(true); }));
  permanent.event(windowRef, 'pagehide', () => dispose(), { once: true });

  function dispose() {
    session?.dispose();
    session = null;
    modal.dispose();
    permanent.dispose();
    resolveAcknowledged();
  }

  return Object.freeze({
    openIfNeeded,
    acknowledged,
    get disposed() { return permanent.disposed; },
    dispose
  });
}
