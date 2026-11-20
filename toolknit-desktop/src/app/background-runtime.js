import { CUSTOM_BACKGROUND_STORAGE_KEY, DEFAULT_DARK_BACKGROUND_SRC, initializeDefaultBackground } from './custom-background-default.js';

const CUSTOM_BACKGROUND_CHANGE_EVENT = 'toolknit-custom-background-change';

const STANDARD_PLASMA_OPTIONS = Object.freeze({
  color: '#6B6B6B',
  speed: 0.8,
  direction: 'forward',
  scale: 1,
  opacity: 1,
  mouseInteractive: false
});

const isVideoElement = node => typeof globalThis.HTMLVideoElement !== 'undefined'
  && node instanceof globalThis.HTMLVideoElement;

/** Shared home/tool background media and animation lifecycle. */
export function createBackgroundRuntime({
  isTauri = false,
  tauriCorePromise,
  initPlasma,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  allowCustomBackground = () => true,
  onThemeChange = () => () => {},
  onHomeBackgroundChanged = () => {},
  onPreviewPlaybackSync = () => {}
} = {}) {
  initializeDefaultBackground(windowRef);
  const runtime = {
    config: null,
    configKey: '',
    source: '',
    sourceKey: '',
    sourcePromise: null,
    media: null,
    mediaRole: '',
    mediaToken: 0,
    homeHost: null,
    homeSession: null,
    homeReady: false,
    homeFailedKey: '',
    toolSessions: new Set()
  };
  const permanentCleanup = [];
  let policyRevision = 0;
  let runtimeDisposed = false;

  const readConfig = () => {
    let parsed = null;
    try { parsed = JSON.parse(windowRef?.localStorage?.getItem(CUSTOM_BACKGROUND_STORAGE_KEY) || 'null'); } catch { parsed = null; }
    if (!parsed || typeof parsed !== 'object') return null;
    const type = String(parsed.media_type || parsed.type || '').toLowerCase();
    if (type !== 'image' && type !== 'video') return null;
    const path = typeof parsed.path === 'string' ? parsed.path.trim() : '';
    const src = typeof parsed.src === 'string' ? parsed.src.trim() : '';
    if (!path && !src) return null;
    return {
      type,
      path,
      src,
      poster: typeof parsed.poster === 'string' ? parsed.poster.trim() : '',
      name: typeof parsed.name === 'string' ? parsed.name.trim() : ''
    };
  };

  const configKey = config => {
    if (!config) return '';
    const source = String(config.src || '');
    const fingerprint = source ? `${source.length}:${source.slice(0, 24)}:${source.slice(-24)}` : '';
    return [config.type, config.path, config.name, config.size || '', fingerprint, config.poster].join('|');
  };

  const refreshConfig = () => {
    const config = allowCustomBackground() ? readConfig() : null;
    const key = configKey(config);
    if (key !== runtime.configKey) {
      runtime.config = config;
      runtime.configKey = key;
      runtime.source = '';
      runtime.sourceKey = '';
      runtime.sourcePromise = null;
      runtime.homeFailedKey = '';
      runtime.homeReady = false;
    } else runtime.config = config;
    return config;
  };

  const isAllowedSource = source => source === DEFAULT_DARK_BACKGROUND_SRC
    || Boolean(source && /^(?:blob:|data:|https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$))/i.test(source));

  const resolveSource = async config => {
    if (runtimeDisposed || !allowCustomBackground()) return '';
    const current = config || refreshConfig();
    if (!current) return '';
    const key = configKey(current);
    if (runtime.sourceKey === key && runtime.source) return runtime.source;
    if (runtime.sourcePromise && runtime.sourceKey === key) return runtime.sourcePromise;
    runtime.sourceKey = key;
    const revision = policyRevision;
    const request = (async () => {
      let source = current.src;
      if (!source && isTauri && current.path) {
        try {
          const { invoke } = await tauriCorePromise;
          source = await invoke('get_custom_background_media_url', { path: current.path });
        } catch (error) {
          console.error('Failed to resolve custom background:', error);
          try {
            const { invoke } = await tauriCorePromise;
            await invoke('log_custom_background_event', { event: 'resolve-failed' });
          } catch {}
          source = '';
        }
      }
      if (runtimeDisposed || revision !== policyRevision || runtime.configKey !== key || !allowCustomBackground() || !isAllowedSource(source)) return '';
      runtime.source = source;
      return source;
    })();
    runtime.sourcePromise = request;
    try { return await request; }
    finally { if (runtime.sourcePromise === request) runtime.sourcePromise = null; }
  };

  const ensureHomeHost = () => {
    const root = documentRef?.querySelector?.('.app');
    if (!root) return null;
    if (runtime.homeHost?.isConnected) return runtime.homeHost;
    const host = documentRef.createElement('div');
    host.className = 'home-v2-custom-background-host';
    host.setAttribute('aria-hidden', 'true');
    root.insertBefore(host, root.firstChild);
    runtime.homeHost = host;
    return host;
  };

  const disposeMedia = (expectedToken = null) => {
    if (expectedToken !== null && expectedToken !== runtime.mediaToken) return;
    const media = runtime.media;
    const host = media?.parentElement;
    runtime.media = null;
    runtime.mediaRole = '';
    runtime.mediaToken += 1;
    if (!media) return;
    host?.classList.remove('has-custom-background');
    try {
      if (isVideoElement(media)) {
        media.pause();
        media.removeAttribute('src');
        media.load();
      } else media.removeAttribute('src');
    } catch {}
    media.remove();
  };

  const mountMedia = (host, config, source, role) => {
    if (runtimeDisposed || !allowCustomBackground() || !host || !config || !source || !host.isConnected) return null;
    disposeMedia();
    const token = runtime.mediaToken;
    const media = documentRef.createElement(config.type === 'video' ? 'video' : 'img');
    media.className = 'toolknit-custom-background-media';
    media.dataset.backgroundRole = role;
    media.setAttribute('aria-hidden', 'true');
    media.setAttribute('draggable', 'false');
    if (config.type === 'video') {
      media.autoplay = true;
      media.loop = true;
      media.muted = true;
      media.playsInline = true;
      media.preload = 'metadata';
      if (config.poster && isAllowedSource(config.poster)) media.poster = config.poster;
    } else {
      media.decoding = 'async';
      media.loading = 'eager';
    }
    runtime.media = media;
    runtime.mediaRole = role;
    host.appendChild(media);
    let settled = false;
    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const settle = ok => {
      if (settled || token !== runtime.mediaToken) return;
      settled = true;
      resolveReady(Boolean(ok));
      if (!ok && isTauri) {
        tauriCorePromise.then(({ invoke }) => invoke('log_custom_background_event', { event: `media-error:${role}` })).catch(() => {});
      }
    };
    const handleReady = () => {
      if (token !== runtime.mediaToken || !allowCustomBackground()) return;
      settle(true);
      if (isVideoElement(media)) media.play().catch(() => {});
    };
    media.addEventListener('error', () => settle(false), { once: true });
    if (isVideoElement(media)) {
      media.addEventListener('canplay', handleReady, { once: true });
      media.addEventListener('loadeddata', handleReady, { once: true });
    } else media.addEventListener('load', handleReady, { once: true });
    media.src = source;
    if (isVideoElement(media)) media.load();
    return {
      token,
      media,
      ready,
      dispose: () => { if (token === runtime.mediaToken) disposeMedia(token); }
    };
  };

  const syncHome = () => {
    if (runtimeDisposed) return;
    const config = refreshConfig();
    const root = documentRef?.querySelector?.('.app');
    const homeActive = Boolean(root?.classList.contains('is-v2-home')) && runtime.toolSessions.size === 0;
    root?.classList.toggle('has-custom-background', Boolean(config && homeActive && runtime.homeReady));
    if (!root?.classList.contains('is-v2-home') || runtime.toolSessions.size > 0 || !config) {
      runtime.homeReady = false;
      runtime.homeSession?.dispose?.();
      runtime.homeSession = null;
      return;
    }
    const host = ensureHomeHost();
    if (!host) return;
    const key = runtime.configKey;
    if (runtime.homeSession?.configKey === key || runtime.homeFailedKey === key) return;
    runtime.homeReady = false;
    runtime.homeSession?.dispose?.();
    const session = { configKey: key, disposed: false, dispose: () => {} };
    runtime.homeSession = session;
    session.ready = resolveSource(config).then(source => {
      if (session.disposed || runtime.homeSession !== session) return;
      if (!source) {
        runtime.homeFailedKey = key;
        session.dispose();
        onHomeBackgroundChanged();
        return;
      }
      const mounted = mountMedia(host, config, source, 'home');
      if (!mounted) return;
      const ready = mounted.ready.then(ok => {
        if (ok && !session.disposed && runtime.homeSession === session) {
          runtime.homeReady = true;
          host.classList.add('has-custom-background');
          root?.classList.toggle('has-custom-background', Boolean(root?.classList.contains('is-v2-home') && runtime.toolSessions.size === 0));
          onHomeBackgroundChanged();
        } else if (!ok && !session.disposed) {
          runtime.homeFailedKey = key;
          session.dispose();
          onHomeBackgroundChanged();
        }
      });
      session.dispose = () => {
        if (session.disposed) return;
        session.disposed = true;
        if (runtime.homeSession === session) runtime.homeSession = null;
        runtime.homeReady = false;
        mounted.dispose();
      };
      return ready;
    }).catch(() => {});
    session.dispose = () => {
      if (session.disposed) return;
      session.disposed = true;
      if (runtime.homeSession === session) runtime.homeSession = null;
      runtime.homeReady = false;
    };
  };

  const pause = () => { if (isVideoElement(runtime.media)) runtime.media.pause(); };
  const resume = () => {
    if (runtimeDisposed || !allowCustomBackground() || !isVideoElement(runtime.media) || documentRef?.hidden || !runtime.media.isConnected) return;
    runtime.media.play().catch(() => {});
  };
  const visibility = () => { if (documentRef?.hidden) pause(); else resume(); onPreviewPlaybackSync(); };
  const pagehide = () => pause();
  const pageshow = () => { resume(); onPreviewPlaybackSync(); };
  documentRef?.addEventListener?.('visibilitychange', visibility);
  windowRef?.addEventListener?.('pagehide', pagehide);
  windowRef?.addEventListener?.('pageshow', pageshow);
  permanentCleanup.push(() => documentRef?.removeEventListener?.('visibilitychange', visibility));
  permanentCleanup.push(() => windowRef?.removeEventListener?.('pagehide', pagehide));
  permanentCleanup.push(() => windowRef?.removeEventListener?.('pageshow', pageshow));

  const mountTool = container => {
    if (runtimeDisposed || !container) return null;
    let disposed = false;
    let innerDispose = null;
    let rebuildRaf = 0;
    let customSession = null;
    let currentConfigKey = '';
    let sessionRevision = 0;
    const raf = callback => typeof windowRef?.requestAnimationFrame === 'function'
      ? windowRef.requestAnimationFrame(callback)
      : windowRef?.setTimeout?.(callback, 0);
    const cancelRaf = id => typeof windowRef?.cancelAnimationFrame === 'function'
      ? windowRef.cancelAnimationFrame(id)
      : windowRef?.clearTimeout?.(id);
    const startStandard = () => {
      if (disposed || innerDispose || documentRef?.hidden || !container.isConnected) return;
      innerDispose = initPlasma?.(container, STANDARD_PLASMA_OPTIONS) || null;
    };
    const stopInner = () => {
      if (rebuildRaf) { cancelRaf(rebuildRaf); rebuildRaf = 0; }
      if (typeof innerDispose === 'function') { innerDispose(); innerDispose = null; }
    };
    const scheduleStart = () => {
      if (disposed || innerDispose || rebuildRaf) return;
      rebuildRaf = raf(() => { rebuildRaf = 0; startStandard(); });
    };
    const sync = () => { if (disposed) return; if (documentRef?.hidden || customSession) stopInner(); else scheduleStart(); };
    documentRef?.addEventListener?.('visibilitychange', sync);
    windowRef?.addEventListener?.('pageshow', sync);
    windowRef?.addEventListener?.('pagehide', stopInner);
    scheduleStart();

    const session = {
      refresh: () => {
        if (disposed) return;
        const config = refreshConfig();
        const nextKey = configKey(config);
        const ownsMedia = Boolean(customSession?.media?.isConnected && customSession.media.parentElement === container);
        if (nextKey === currentConfigKey && (ownsMedia || !config)) return;
        const revision = ++sessionRevision;
        if (customSession && !ownsMedia) customSession = null;
        currentConfigKey = nextKey;
        container.classList.remove('has-custom-background');
        customSession?.dispose?.();
        customSession = null;
        if (!config) { if (!innerDispose && !documentRef?.hidden) scheduleStart(); return; }
        if (!innerDispose && !documentRef?.hidden) scheduleStart();
        resolveSource(config).then(source => {
          if (disposed || revision !== sessionRevision || nextKey !== currentConfigKey || !allowCustomBackground() || !source) return;
          const mounted = mountMedia(container, config, source, 'tool');
          if (!mounted) return;
          customSession = mounted;
          mounted.ready.then(ok => {
            if (disposed || revision !== sessionRevision || nextKey !== currentConfigKey || !allowCustomBackground()) return;
            if (ok) { container.classList.add('has-custom-background'); stopInner(); }
            else { container.classList.remove('has-custom-background'); mounted.dispose(); if (customSession === mounted) customSession = null; if (!innerDispose && !documentRef?.hidden) scheduleStart(); }
          });
        }).catch(() => {});
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        sessionRevision += 1;
        stopInner();
        documentRef?.removeEventListener?.('visibilitychange', sync);
        windowRef?.removeEventListener?.('pageshow', sync);
        windowRef?.removeEventListener?.('pagehide', stopInner);
        runtime.toolSessions.delete(session);
        container.classList.remove('has-custom-background');
        customSession?.dispose?.();
        customSession = null;
      }
    };
    runtime.toolSessions.add(session);
    syncHome();
    session.refresh();
    return () => {
      session.dispose();
      documentRef?.removeEventListener?.('visibilitychange', sync);
      windowRef?.removeEventListener?.('pageshow', sync);
      windowRef?.removeEventListener?.('pagehide', stopInner);
      stopInner();
      runtime.toolSessions.forEach(other => other.refresh?.());
      if (runtime.toolSessions.size === 0) syncHome();
    };
  };

  const refresh = ({ retry = false } = {}) => {
    if (runtimeDisposed) return;
    if (retry) runtime.homeFailedKey = '';
    refreshConfig();
    syncHome();
    runtime.toolSessions.forEach(session => session.refresh?.());
    onHomeBackgroundChanged();
  };
  const dispose = () => {
    if (runtimeDisposed) return;
    runtimeDisposed = true;
    policyRevision += 1;
    permanentCleanup.splice(0).forEach(cleanup => cleanup());
    runtime.homeSession?.dispose?.();
    runtime.toolSessions.forEach(session => session.dispose?.());
    runtime.toolSessions.clear();
    disposeMedia();
  };
  let customAllowed = allowCustomBackground();
  permanentCleanup.push(onThemeChange(() => {
    const allowed = allowCustomBackground();
    if (allowed === customAllowed) return;
    customAllowed = allowed;
    policyRevision += 1;
    refresh();
  }));

  return Object.freeze({
    dispose,
    disposeTool: toolDispose => {
      if (typeof toolDispose === 'function') toolDispose();
      return null;
    },
    getConfig: () => ({ ...(readConfig() || {}) }),
    mountTool,
    pause,
    refresh,
    resume,
    whenHomeReady: () => {
      syncHome();
      return runtime.homeSession?.ready || Promise.resolve();
    },
    syncHome
  });
}

export { CUSTOM_BACKGROUND_CHANGE_EVENT, CUSTOM_BACKGROUND_STORAGE_KEY, STANDARD_PLASMA_OPTIONS };
