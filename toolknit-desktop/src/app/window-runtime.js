import { createLifecycleScope } from './tool-lifecycle.js';

const WINDOW_RADIUS_KEY = 'toolknit.window-radius.v3';
const WINDOW_RADIUS_PRESETS = Object.freeze({ none: 0, small: 10, large: 18 });
const WINDOW_RADIUS_CUSTOM_DEFAULT = 10;
const WINDOW_RADIUS_MAX = 32;

function clampRadius(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return WINDOW_RADIUS_CUSTOM_DEFAULT;
  return Math.max(0, Math.min(WINDOW_RADIUS_MAX, Math.round(numeric)));
}

/**
 * Owns native window chrome state and its CSS fallback. The application only
 * supplies platform primitives and receives a small, stable controller API.
 */
export function createWindowRuntime({
  appWindow = null,
  isTauri = false,
  isScreenPickerWindow = false,
  tauriCorePromise,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  storage = globalThis.localStorage,
  getTheme = () => 'dark',
  onThemeChange = () => () => {},
  translate = key => key,
  refreshIcons = () => {},
  notify = () => {},
  actionTimeoutMs = 4000
} = {}) {
  const scope = createLifecycleScope();
  let chromeQueue = Promise.resolve();
  let chromeTimer = 0;
  let radiusTimer = null;
  let frameTimer = 0;
  let actionQueue = Promise.resolve();
  const pendingActions = new Map();
  let appliedShadow = null;
  let appliedSurface = null;
  let requestedRadius = null;
  let frameMaximized = false;
  let observingFrame = false;

  const clearLegacyRadiusStyles = () => {
    documentRef?.querySelectorAll?.('html, body, .app, .settings-overlay, .global-window-controls, .transition-mask')
      .forEach(layer => {
        layer.style.removeProperty('border-radius');
        layer.style.removeProperty('clip-path');
        layer.style.removeProperty('-webkit-clip-path');
        layer.style.removeProperty('overflow');
      });
  };

  const read = () => {
    try {
      const parsed = JSON.parse(storage?.getItem(WINDOW_RADIUS_KEY) || 'null');
      const mode = ['none', 'small', 'large', 'custom'].includes(parsed?.mode) ? parsed.mode : 'large';
      return { mode, custom: clampRadius(parsed?.custom ?? WINDOW_RADIUS_CUSTOM_DEFAULT) };
    } catch {
      return { mode: 'large', custom: WINDOW_RADIUS_CUSTOM_DEFAULT };
    }
  };

  const pixels = (setting = read()) => setting.mode === 'custom'
    ? clampRadius(setting.custom)
    : WINDOW_RADIUS_PRESETS[setting.mode] ?? 0;

  const repairChrome = () => {
    if (scope.disposed || !isTauri || !appWindow || isScreenPickerWindow) return Promise.resolve();
    chromeQueue = chromeQueue
      .catch(() => undefined)
      .then(async () => {
        if (scope.disposed) return;
        const decorated = typeof appWindow.isDecorated === 'function'
          ? await appWindow.isDecorated()
          : true;
        if (scope.disposed) return;
        if (decorated && typeof appWindow.setDecorations === 'function') {
          await appWindow.setDecorations(false);
          appliedShadow = null;
          appliedSurface = null;
        }
        if (scope.disposed) return;
        // DWM shadows use the rectangular host, not our CSS alpha contour.
        // The native companion shares the actual radius without changing layout.
        if (typeof appWindow.setShadow === 'function' && appliedShadow !== false) {
          await appWindow.setShadow(false);
          appliedShadow = false;
        }
        const { invoke } = await tauriCorePromise;
        if (scope.disposed) return;
        // Read the latest theme/radius after pending native calls.
        const radius = requestedRadius ?? pixels(read());
        const shadow = getTheme() === 'light' && !frameMaximized;
        const surface = `${radius}:${shadow}`;
        if (surface !== appliedSurface) {
          await invoke('set_window_corner_radius', { radius, shadow });
          appliedSurface = surface;
        }
      })
      .catch(error => console.warn('Native frameless chrome repair failed:', error));
    return chromeQueue;
  };

  const apply = (setting = read()) => {
    if (scope.disposed || isScreenPickerWindow) return 0;
    const radius = pixels(setting);
    const value = `${radius}px`;
    const root = documentRef?.documentElement;
    const body = documentRef?.body;
    root?.style.setProperty('--toolknit-window-radius', value);
    if (root) root.dataset.windowRadius = setting.mode;
    body?.classList.remove('use-native-window-radius');
    body?.classList.toggle('use-css-window-radius', radius > 0);
    body?.style.setProperty('--toolknit-window-radius', value);
    body?.setAttribute('data-window-radius', setting.mode);
    documentRef?.querySelectorAll?.('.app, .settings-overlay, .global-window-controls, .transition-mask')
      .forEach(layer => layer.style.setProperty('--toolknit-window-radius', value));
    clearLegacyRadiusStyles();
    if (isTauri) {
      requestedRadius = radius;
      void repairChrome();
    } else if (body) {
      root?.style.setProperty('border-radius', value, 'important');
      root?.style.setProperty('overflow', 'hidden', 'important');
      root?.style.setProperty('clip-path', `inset(0 round ${value})`, 'important');
      root?.style.setProperty('-webkit-clip-path', `inset(0 round ${value})`, 'important');
    }
    return radius;
  };

  const setMaximizedState = enabled => {
    if (scope.disposed) return;
    const maximized = Boolean(enabled);
    if (frameMaximized !== maximized) {
      frameMaximized = maximized;
      void repairChrome();
    }
    documentRef?.documentElement?.classList.toggle('window-is-maximized', maximized);
    documentRef?.body?.classList.toggle('window-is-maximized', maximized);
    const iconName = maximized ? 'copy' : 'square';
    const labelKey = maximized ? 'common.restore' : 'common.maximize';
    const label = translate(labelKey);
    let iconChanged = false;
    documentRef?.querySelectorAll?.('.ctrl-btn[data-action="maximize"], .tk-nav-maximize').forEach(button => {
      const icon = button.querySelector('[data-lucide]');
      if (icon && icon.getAttribute('data-lucide') !== iconName) {
        icon.setAttribute('data-lucide', iconName);
        iconChanged = true;
      }
      button.dataset.i18nTitle = labelKey;
      button.dataset.i18nAriaLabel = labelKey;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', maximized ? 'true' : 'false');
    });
    if (iconChanged) {
      try { refreshIcons(); } catch (error) { console.warn('Window control icon refresh failed:', error); }
    }
  };

  const readMaximized = async () => {
    if (!isTauri || !appWindow || isScreenPickerWindow) return false;
    try {
      const maximized = await appWindow.isMaximized();
      const fullscreen = typeof appWindow.isFullscreen === 'function'
        ? await appWindow.isFullscreen().catch(() => false)
        : false;
      return Boolean(maximized || fullscreen);
    } catch { return false; }
  };

  const syncFrame = async () => {
    if (scope.disposed || !isTauri || !appWindow || isScreenPickerWindow || !documentRef?.body) return;
    setMaximizedState(await readMaximized());
  };

  const syncAfterLayout = () => {
    if (scope.disposed || !isTauri || !appWindow || isScreenPickerWindow) return;
    [0, 180].forEach(delay => scope.timeout(async () => {
      await syncFrame();
      apply(read());
    }, delay));
  };

  const scheduleChromeRepair = ({ reapplyRadius = true } = {}) => {
    if (scope.disposed || !isTauri || !appWindow || isScreenPickerWindow) return;
    windowRef?.clearTimeout?.(chromeTimer);
    chromeTimer = windowRef?.setTimeout?.(() => {
      chromeTimer = 0;
      repairChrome().finally(() => { if (reapplyRadius) apply(read()); });
    }, 140) || 0;
  };

  const scheduleFrameSync = () => {
    if (scope.disposed || !isTauri || !appWindow || isScreenPickerWindow) return;
    windowRef?.clearTimeout?.(frameTimer);
    frameTimer = windowRef?.setTimeout?.(async () => {
      frameTimer = 0;
      await syncFrame();
      apply(read());
    }, 120) || 0;
  };

  const observeFrame = () => {
    if (scope.disposed || observingFrame || !isTauri || !appWindow || isScreenPickerWindow) return;
    observingFrame = true;
    ['onResized', 'onScaleChanged', 'onFocusChanged'].forEach(method => {
      if (typeof appWindow[method] !== 'function') return;
      appWindow[method](event => {
        if (method !== 'onFocusChanged' || event.payload) scheduleFrameSync();
      })
        .then(unlisten => scope.use(unlisten))
        .catch(error => console.warn(`Native window ${method} listener failed:`, error));
    });
  };

  const syncRadiusAfterLayout = () => {
    if (scope.disposed || !isTauri || !appWindow || isScreenPickerWindow) return;
    windowRef?.clearTimeout?.(radiusTimer);
    radiusTimer = windowRef?.setTimeout?.(() => apply(read()), 80) || null;
  };

  const handleControl = action => {
    if (scope.disposed || !isTauri || !appWindow || isScreenPickerWindow || !['minimize', 'maximize', 'close'].includes(action)) return Promise.resolve();
    if (pendingActions.has(action)) return pendingActions.get(action);
    const task = actionQueue.then(async () => {
      if (scope.disposed) return;
      // A missing native reply must not strand every later window command.
      let release = () => {};
      const expired = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Window action timed out')), actionTimeoutMs);
        release = scope.use(() => { clearTimeout(timer); resolve(); });
      });
      try {
        // Screenshot restoration can show the HWND without updating Tao's
        // visibility cache. The native command verifies the actual hide.
        const operation = action === 'close' ? tauriCorePromise.then(({ invoke }) => invoke('hide_main_window'))
          : action === 'minimize' ? appWindow.minimize() : appWindow.toggleMaximize();
        await Promise.race([operation, expired]);
        if (!scope.disposed && action === 'maximize') scheduleFrameSync();
      } catch {
        if (!scope.disposed) notify(translate('common.windowControlFailed'));
      } finally { release(); }
    }).finally(() => pendingActions.delete(action));
    pendingActions.set(action, task);
    actionQueue = task.catch(() => {});
    return task;
  };
  const toggleMaximize = () => handleControl('maximize');

  const save = setting => {
    const normalized = {
      mode: ['none', 'small', 'large', 'custom'].includes(setting?.mode) ? setting.mode : 'large',
      custom: clampRadius(setting?.custom ?? WINDOW_RADIUS_CUSTOM_DEFAULT)
    };
    try { storage?.setItem(WINDOW_RADIUS_KEY, JSON.stringify(normalized)); } catch {}
    apply(normalized);
    return normalized;
  };

  const dispose = () => {
    if (scope.disposed) return;
    scope.dispose();
    windowRef?.clearTimeout?.(chromeTimer);
    windowRef?.clearTimeout?.(frameTimer);
    windowRef?.clearTimeout?.(radiusTimer);
    chromeTimer = 0;
    frameTimer = 0;
    radiusTimer = null;
  };

  if (isTauri && appWindow && !isScreenPickerWindow) {
    scope.use(onThemeChange(() => { void repairChrome(); }));
    if (windowRef?.addEventListener) scope.event(windowRef, 'pagehide', event => { if (!event.persisted) dispose(); });
    if (windowRef?.addEventListener) scope.event(windowRef, 'focus', scheduleFrameSync);
    if (documentRef?.addEventListener) scope.event(documentRef, 'visibilitychange', () => {
      if (!documentRef.hidden) scheduleFrameSync();
    });
    void syncFrame().then(repairChrome);
  }

  return Object.freeze({
    apply,
    clampRadius,
    dispose,
    handleControl,
    observeFrame,
    pixels,
    read,
    repairChrome,
    save,
    scheduleChromeRepair,
    setMaximizedState,
    syncAfterLayout,
    syncFrame,
    syncRadiusAfterLayout,
    toggleMaximize
  });
}

export { WINDOW_RADIUS_KEY };
