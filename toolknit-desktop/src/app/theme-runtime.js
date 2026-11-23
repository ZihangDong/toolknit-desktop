import { createLifecycleScope } from './tool-lifecycle.js';
import { themeEngine, THEME_PRESETS, normalizeColor, normalizeThemeConfig, readAppearancePreference, applyTheme, APPEARANCE_STORAGE_KEY } from './theme-palette.js';

export const THEME_STORAGE_KEY = themeEngine.LEGACY_KEY;
export const normalizeTheme = value => value === 'dark' ? 'dark' : 'light';
export const readThemePreference = windowRef => readAppearancePreference(windowRef ?? globalThis.window).mode;

/** One saved appearance, with reversible previews and legacy mode subscriptions. */
export function createThemeRuntime({ root = globalThis.document, windowRef = globalThis.window, enabled = true, pageTransition = null } = {}) {
  const scope = createLifecycleScope(), listeners = new Set();
  const paletteContainer = root?.getElementById?.('themePaletteChoices');
  if (enabled && paletteContainer && root?.createElement) {
    paletteContainer.replaceChildren(...THEME_PRESETS.map(preset => {
      const button = root.createElement('button');
      button.type = 'button'; button.className = 'settings-v2-choice';
      button.dataset.paletteChoice = preset.id;
      button.setAttribute('role', 'radio');
      return button;
    }));
  }
  const buttons = [...root?.querySelectorAll?.('[data-theme-choice]') || []];
  const presets = [...root?.querySelectorAll?.('[data-palette-choice]') || []];
  const node = id => root?.getElementById?.(id);
  const picker = node('themeCustomColor'), input = node('themeCustomHex'), error = node('themeColorError');
  const wallpaper = node('themeWallpaperToggle'), previewActions = node('themePreviewActions');
  let saved = enabled ? readAppearancePreference(windowRef) : normalizeThemeConfig({ mode: 'dark' });
  let config = { ...saved }, revision = 0, previewing = false;
  function localizePalettes() {
    const language = (root?.documentElement?.lang || '').startsWith('en') ? 'en' : 'zh';
    presets.forEach(button => {
      const preset = THEME_PRESETS.find(p => p.id === button.dataset.paletteChoice);
      if (preset) {
        button.textContent = '';
        button.setAttribute('aria-label', preset.name[language]);
        button.setAttribute('title', preset.name[language]);
      }
    });
    const summary = node('settingsPaletteSummary');
    if (summary) summary.textContent = THEME_PRESETS.find(p => p.id === config.preset)?.name[language]
      || (language === 'en' ? 'Custom' : '自定义');
  }
  function persist() {
    try {
      windowRef?.localStorage?.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(saved));
      windowRef?.localStorage?.setItem(THEME_STORAGE_KEY, saved.mode);
    } catch { /* Keep this session usable when persistence is unavailable. */ }
  }
  function render() {
    if (!enabled) return;
    applyTheme(root?.documentElement, config);
    localizePalettes();
    for (const [nodes, key, value] of [[buttons, 'themeChoice', config.mode], [presets, 'paletteChoice', config.preset]]) {
      nodes.forEach(button => {
        const selected = button.dataset[key] === value;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-checked', String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      if (nodes.length && !nodes.some(button => button.dataset[key] === value)) nodes[0].tabIndex = 0;
    }
    if (picker) picker.value = config.customColor;
    if (input && root.activeElement !== input) input.value = config.customColor;
    if (wallpaper) { wallpaper.setAttribute('aria-pressed', String(config.wallpaperEnabled)); wallpaper.classList.toggle('active', config.wallpaperEnabled); }
    if (previewActions) previewActions.hidden = !previewing;
  }
  function notify() {
    listeners.forEach(listener => listener(config.mode, { ...config }));
    if (windowRef?.CustomEvent) windowRef.dispatchEvent(new windowRef.CustomEvent('toolknit-theme-change', { detail: { ...config } }));
  }
  function update(value, { persist: shouldPersist = true, transition = false, preview = false } = {}) {
    if (!enabled || scope.disposed) return { ...config };
    const next = normalizeThemeConfig({ ...config, ...value });
    const request = ++revision;
    const commit = () => {
      if (scope.disposed || request !== revision) return;
      const changed = JSON.stringify(next) !== JSON.stringify(config);
      config = next;
      previewing = preview;
      if (shouldPersist) { saved = { ...config }; persist(); }
      render();
      if (changed) notify();
    };
    if (transition && pageTransition?.run && next.mode !== config.mode) {
      void pageTransition.run(commit, { replaceable: false, mode: 'theme' }).catch(error => console.error('[Theme] transition failed:', error));
    } else commit();
    return { ...config };
  }
  function set(value, options = {}) {
    if (['dark', 'light'].includes(value)) update({ mode: value }, { transition: true, ...options });
    return config.mode;
  }
  function subscribe(listener) {
    if (scope.disposed || typeof listener !== 'function') return () => {};
    listeners.add(listener); return () => listeners.delete(listener);
  }
  function cancelPreview() {
    if (previewing) update(saved, { persist: false });
    if (error) error.hidden = true;
    input?.removeAttribute('aria-invalid');
    if (input) input.value = config.customColor;
  }
  function previewColor(value) {
    const color = normalizeColor(value);
    if (error) error.hidden = Boolean(color);
    input?.setAttribute('aria-invalid', String(!color));
    if (color) update({ preset: 'custom', customColor: color }, { persist: false, preview: true });
  }
  function radioGroup(nodes, select) {
    nodes.forEach((button, index) => {
      scope.event(button, 'click', () => { cancelPreview(); select(button); });
      scope.event(button, 'keydown', event => {
        let next;
        if (['ArrowDown', 'ArrowRight'].includes(event.key)) next = (index + 1) % nodes.length;
        else if (['ArrowUp', 'ArrowLeft'].includes(event.key)) next = (index + nodes.length - 1) % nodes.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = nodes.length - 1;
        else return;
        event.preventDefault(); nodes[next].focus(); cancelPreview(); select(nodes[next]);
      });
    });
  }
  function dispose() {
    if (scope.disposed) return;
    cancelPreview(); scope.dispose(); listeners.clear();
  }
  if (enabled) {
    localizePalettes();
    if (root?.documentElement && windowRef?.MutationObserver) {
      const observer = new windowRef.MutationObserver(localizePalettes);
      observer.observe(root.documentElement, { attributes: true, attributeFilter: ['lang'] });
      scope.use(() => observer.disconnect());
    }
    presets.forEach(button => {
      const preset = THEME_PRESETS.find(p => p.id === button.dataset.paletteChoice);
      if (preset) button.style?.setProperty('--theme-swatch', preset.color);
    });
    radioGroup(buttons, button => set(button.dataset.themeChoice));
    radioGroup(presets, button => update({ preset: button.dataset.paletteChoice }));
    if (picker) scope.event(picker, 'input', () => previewColor(picker.value));
    if (input) scope.event(input, 'input', () => previewColor(input.value));
    if (node('themePreviewSave')) scope.event(node('themePreviewSave'), 'click', () => {
      if (input?.getAttribute('aria-invalid') !== 'true') update(config);
    });
    if (node('themePreviewCancel')) scope.event(node('themePreviewCancel'), 'click', cancelPreview);
    if (node('themeRestoreDefault')) scope.event(node('themeRestoreDefault'), 'click', () => {
      cancelPreview(); update({ preset: 'neutral', customColor: '#3565a6' });
    });
    if (wallpaper) scope.event(wallpaper, 'click', () => { cancelPreview(); update({ wallpaperEnabled: !config.wallpaperEnabled }); });
    const overlay = node('settingsOverlay');
    if (overlay && windowRef?.MutationObserver) {
      const observer = new windowRef.MutationObserver(() => { if (!overlay.classList.contains('visible')) cancelPreview(); });
      observer.observe(overlay, { attributes: true, attributeFilter: ['class'] }); scope.use(() => observer.disconnect());
    }
    if (windowRef?.addEventListener) {
      scope.event(windowRef, 'storage', event => {
        if ([APPEARANCE_STORAGE_KEY, THEME_STORAGE_KEY, null].includes(event.key)) {
          saved = readAppearancePreference(windowRef); update(saved, { persist: false });
        }
      });
      scope.event(windowRef, 'pagehide', event => { if (!event.persisted) dispose(); });
    }
    persist(); render();
  }
  return Object.freeze({ get: () => config.mode, set, subscribe, dispose,
    getConfig: () => ({ ...config }), setConfig: update, cancelPreview,
    subscribeConfig: listener => subscribe((mode, value) => listener(value)),
    allowsCustomBackground: () => config.wallpaperEnabled });
}
