/** Pure, shared theme engine. The Vite bootstrap embeds this same function before first paint. */
export function createThemeEngine() {
  const STORAGE_KEY = 'toolknit.appearance.v1';
  const LEGACY_KEY = 'toolknit.theme.v3';
  const PRESETS = Object.freeze([
    { id: 'neutral', color: '#191919', name: { zh: '经典灰', en: 'Classic gray' } },
    { id: 'blue', color: '#3565a6', name: { zh: '雾蓝', en: 'Mist blue' } },
    { id: 'green', color: '#35714c', name: { zh: '森林绿', en: 'Forest green' } },
    { id: 'teal', color: '#087b80', name: { zh: '青碧', en: 'Teal' } },
    { id: 'violet', color: '#7856a8', name: { zh: '紫藤', en: 'Wisteria' } },
    { id: 'rose', color: '#a7476b', name: { zh: '玫瑰', en: 'Rose' } },
    { id: 'amber', color: '#95600c', name: { zh: '琥珀', en: 'Amber' } },
    { id: 'sand', color: '#8d6d4f', name: { zh: '暖砂', en: 'Warm sand' } }
  ]);
  const DEFAULT_CONFIG = Object.freeze({ version: 1, mode: 'light', preset: 'neutral', customColor: '#3565a6', wallpaperEnabled: false });
  function normalizeColor(value) {
    if (typeof value !== 'string') return null;
    const s = value.trim();
    if (/^#[\da-f]{6}$/i.test(s)) return s.toLowerCase();
    if (/^#[\da-f]{3}$/i.test(s)) return '#' + [...s.slice(1)].map(c => c + c).join('').toLowerCase();
    return null;
  }
  function normalizeConfig(value) {
    const v = value && typeof value === 'object' ? value : {};
    return { version: 1, mode: v.mode === 'dark' ? 'dark' : 'light',
      preset: v.preset === 'custom' || PRESETS.some(p => p.id === v.preset) ? v.preset : 'neutral',
      customColor: normalizeColor(v.customColor) || DEFAULT_CONFIG.customColor,
      wallpaperEnabled: v.wallpaperEnabled === true };
  }
  function readConfig(windowRef) {
    try {
      const saved = windowRef?.localStorage?.getItem(STORAGE_KEY);
      if (saved) {
        const value = JSON.parse(saved);
        if (value?.version === 1) return normalizeConfig(value);
      }
    } catch { /* An unusable profile falls back to the legacy preference. */ }
    try {
      const mode = windowRef?.localStorage?.getItem(LEGACY_KEY) === 'dark' ? 'dark' : 'light';
      let background = null;
      try { background = JSON.parse(windowRef?.localStorage?.getItem('toolknit.customBackground.v1') || 'null'); } catch {}
      return normalizeConfig({ mode, wallpaperEnabled: mode === 'dark' && Boolean(background?.path || background?.src) });
    } catch { return { ...DEFAULT_CONFIG }; }
  }
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const hex = values => '#' + values.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, weight) => hex(rgb(a).map((v, i) => v * (1 - weight) + rgb(b)[i] * weight));
  function luminance(color) {
    return rgb(color).map(v => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; })
      .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
  }
  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
  }
  function readable(color, backgrounds, minimum = 4.5) {
    if (backgrounds.every(bg => contrast(color, bg) >= minimum)) return color;
    const black = Math.min(...backgrounds.map(bg => contrast('#000000', bg)));
    const white = Math.min(...backgrounds.map(bg => contrast('#ffffff', bg)));
    const end = black >= white ? '#000000' : '#ffffff';
    for (let i = 1; i <= 100; i++) {
      const next = mix(color, end, i / 100);
      if (backgrounds.every(bg => contrast(next, bg) >= minimum)) return next;
    }
    return end;
  }
  function palette(value) {
    const config = normalizeConfig(value), dark = config.mode === 'dark', neutral = config.preset === 'neutral';
    const seed = config.preset === 'custom' ? config.customColor : PRESETS.find(p => p.id === config.preset).color;
    const tint = (base, weight) => neutral ? base : mix(base, seed, weight);
    const page = tint(dark ? '#141518' : '#ffffff', dark ? .09 : .025);
    const surface = tint(dark ? '#25272c' : '#e7e8ea', dark ? .12 : .09);
    const hover = tint(dark ? '#32353c' : '#dddfe2', dark ? .14 : .12);
    const inset = tint(dark ? '#1b1d21' : '#f8f8f9', .035);
    const ink = readable(tint(dark ? '#f3f3f4' : '#191919', .08), [page, surface, hover, inset]);
    const muted = readable(tint(dark ? '#bfc3cc' : '#65676b', .12), [page, surface, hover, inset]);
    const accent = readable(neutral ? ink : seed, [page, surface, hover, inset], 3);
    const onAccent = contrast('#ffffff', accent) >= contrast('#000000', accent) ? '#ffffff' : '#000000';
    const accentHover = mix(accent, onAccent === '#ffffff' ? '#000000' : '#ffffff', .13);
    const border = tint(dark ? '#454a54' : '#d9d9d9', .1);
    const tokens = {
      '--tk-page-bg': page, '--tk-page-ink': ink, '--tk-page-muted': muted, '--tk-page-line': border,
      '--tk-surface': surface, '--tk-surface-hover': hover, '--tk-inset': inset,
      '--tk-ink': ink, '--tk-muted': muted, '--tk-border': border,
      '--tk-border-strong': tint(dark ? '#656c78' : '#b8bbc0', .1),
      '--tk-accent': accent, '--tk-accent-hover': accentHover, '--tk-on-accent': onAccent,
      '--tk-accent-soft': mix(page, seed, dark ? .24 : .12),
      '--tk-card-bg': accent, '--tk-card-ink': onAccent, '--tk-card-muted': onAccent,
      '--tk-home-card-bg': surface, '--tk-home-card-hover': hover, '--tk-home-card-ink': ink,
      '--tk-home-card-muted': muted, '--tk-home-icon-bg': inset,
      '--tk-home-icon-ink': readable(tint(dark ? '#d2d6df' : '#404247', .1), [inset]),
      '--tk-window-bg': page, '--tk-color-scheme': config.mode,
      '--tk-syntax-weight': dark ? '28%' : '80%',
      '--tk-rgb-ink': rgb(ink).join(', '), '--tk-rgb-page': rgb(page).join(', '),
      '--tk-rgb-accent': rgb(accent).join(', '), '--tk-rgb-shadow': '0, 0, 0',
      '--tk-success': readable(dark ? '#7edba1' : '#23603a', [page, surface, hover, inset]),
      '--tk-warning': readable(dark ? '#f4cf75' : '#805900', [page, surface, hover, inset]),
      '--tk-danger': readable(dark ? '#ffaaaa' : '#a32432', [page, surface, hover, inset]),
      '--ink': ink, '--muted': muted, '--quiet': muted, '--line': border, '--line-strong': border,
      '--white': ink, '--black': page
    };
    return tokens;
  }
  function applyTheme(root, value) {
    const config = normalizeConfig(value), tokens = palette(config);
    if (!root) return config;
    root.setAttribute('data-theme', config.mode);
    root.setAttribute('data-theme-config', JSON.stringify(config));
    root.setAttribute('data-palette', config.preset);
    root.setAttribute('data-wallpaper-enabled', String(config.wallpaperEnabled));
    for (const [key, color] of Object.entries(tokens)) root.style?.setProperty(key, color);
    if (root.style) root.style.colorScheme = config.mode;
    return config;
  }
  function appliedConfig(root) {
    try { return normalizeConfig(JSON.parse(root?.getAttribute('data-theme-config') || 'null') || { mode: root?.dataset?.theme }); }
    catch { return normalizeConfig({ mode: root?.dataset?.theme }); }
  }
  function bootstrap(documentRef, windowRef) {
    if (new URLSearchParams(windowRef.location.search).get('screen-picker') !== '1' && !documentRef.documentElement.hasAttribute('data-tk-auxiliary')) {
      applyTheme(documentRef.documentElement, readConfig(windowRef));
    }
  }
  return { STORAGE_KEY, LEGACY_KEY, PRESETS, DEFAULT_CONFIG, normalizeColor, normalizeConfig, readConfig,
    palette, contrast, readable, applyTheme, appliedConfig, bootstrap };
}

export const themeEngine = createThemeEngine();
export const { PRESETS: THEME_PRESETS, DEFAULT_CONFIG: DEFAULT_THEME_CONFIG, normalizeColor, normalizeConfig: normalizeThemeConfig,
  readConfig: readAppearancePreference, palette: createThemePalette, applyTheme, appliedConfig: getAppliedThemeConfig,
  contrast: themeContrast, STORAGE_KEY: APPEARANCE_STORAGE_KEY } = themeEngine;
