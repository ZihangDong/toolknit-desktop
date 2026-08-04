import en from './locales/en.json' with { type: 'json' };
import zh from './locales/zh.json' with { type: 'json' };

const locales = { en, zh };
const STORAGE_KEY = 'toolknit-lang';
const INSTALLER_LANG_KEY = 'toolknit-installer-lang';

function normalizeLang(lang) {
  return lang && locales[lang] ? lang : 'zh';
}

let currentLang = normalizeLang(localStorage.getItem(STORAGE_KEY));
const langChangeCallbacks = [];

export function onLangChange(cb) {
  langChangeCallbacks.push(cb);
}

// On launch, check if installer language changed (reinstall with different language)
// If so, apply the new installer language. Otherwise respect user's saved preference.
const checkInstallLang = () => {
  import('@tauri-apps/api/core').then(({ invoke }) => {
    invoke('get_install_config')
      .then((config) => {
        const lang = config.language || 'zh';
        const normalized = normalizeLang(lang);
        const saved = localStorage.getItem(STORAGE_KEY);
        const prevInstallerLang = localStorage.getItem(INSTALLER_LANG_KEY);
        // Apply installer language if:
        // 1. No saved preference (first launch), OR
        // 2. Installer language changed since last launch (reinstall with different language), OR
        // 3. No previous installer lang recorded (upgraded from old version)
        if (!saved || !prevInstallerLang || prevInstallerLang !== normalized) {
          currentLang = normalized;
          localStorage.setItem(STORAGE_KEY, normalized);
        }
        // Always record the current installer language
        localStorage.setItem(INSTALLER_LANG_KEY, normalized);
        // Apply if we changed currentLang above
        if (currentLang !== normalizeLang(saved)) {
          document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
          document.body.classList.toggle('lang-zh', currentLang === 'zh');
          applyTranslations();
          langChangeCallbacks.forEach(cb => { try { cb(); } catch (e) {} });
          if (window.__refreshMarquee) window.__refreshMarquee();
        }
      })
      .catch(() => {});
  });
};
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkInstallLang);
} else {
  checkInstallLang();
}

function get(obj, path) {
  return path.split('.').reduce((acc, key) => acc && acc[key], obj);
}

export function t(key, vars = {}) {
  const val = get(locales[currentLang], key) || get(locales.en, key) || key;
  return Object.entries(vars).reduce(
    (str, [k, v]) => str.replace(new RegExp(`\\{${k}\\}`, 'g'), v),
    val
  );
}

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  const normalized = normalizeLang(lang);
  if (normalized === currentLang) return;
  const body = document.body;
  body.classList.add('fade-out');
  setTimeout(() => {
    setLangInternal(normalized);
    body.classList.remove('fade-out');
    body.classList.add('fade-in');
    setTimeout(() => {
      body.classList.remove('fade-in');
    }, 300);
  }, 300);
}

export function setLangWithoutFade(lang) {
  const normalized = normalizeLang(lang);
  if (normalized === currentLang) return;
  setLangInternal(normalized);
}

function setLangInternal(lang) {
  const normalized = normalizeLang(lang);
  currentLang = normalized;
  localStorage.setItem(STORAGE_KEY, normalized);
  document.documentElement.lang = normalized === 'zh' ? 'zh-CN' : 'en';
  document.body.classList.toggle('lang-zh', normalized === 'zh');
  applyTranslations();
  // Update system tray menu language
  import('@tauri-apps/api/core').then(({ invoke }) => {
    invoke('set_tray_lang', { lang: normalized }).catch(() => {});
  }).catch(() => {});
  // Fire registered callbacks
  langChangeCallbacks.forEach(cb => { try { cb(); } catch (e) {} });
  // Re-render marquee if needed
  if (window.__refreshMarquee) window.__refreshMarquee();
}

export function toggleLang() {
  setLang(currentLang === 'zh' ? 'en' : 'zh');
}

// Initialize body class on load
if (typeof document !== 'undefined') {
  document.body.classList.toggle('lang-zh', currentLang === 'zh');
  document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
}

export function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const text = t(key);
    if (el.hasAttribute('placeholder')) {
      el.placeholder = text;
    } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.placeholder = text;
    } else {
      el.textContent = text;
    }
  });

  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });

  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  });

  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });

  // Update document title
  const titleEl = document.querySelector('title');
  if (titleEl) titleEl.textContent = t('app.title');
}
