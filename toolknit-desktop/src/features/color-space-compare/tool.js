import { t } from '../../i18n.js';
import { bindToolPageChrome, mountToolPageBackground, toolTopbarMarkup } from '../../shared/tool-page-shell.js';
import { createColorSpaceCompareController } from './controller.js';
import './color-space-compare.css';
import './color-space-compare-light.css';

function renderColorSpaceCompareMarkup() {
  return `<div class="tool-page-v2-shell tool-page-v2-light color-space-compare-shell">
    ${toolTopbarMarkup({
      tag: 'CREATIVE TOOLS · TOOL PAGE 3.1',
      title: t('home.toolNames.colorSpaceCompare'),
      closeAttr: 'data-csc-close',
    })}
    <main class="tool-page-v2-body color-space-compare-main">
      <aside class="tool-page-v2-rail color-space-compare-summary">
        <span class="tool-page-v2-rail-kicker">COLOR SCIENCE LAB</span>
        <h1 data-csc-i18n="home.toolNames.colorSpaceCompare">${t('home.toolNames.colorSpaceCompare')}</h1>
        <p data-csc-i18n="home.colorSpaceCompare.subtitle">${t('home.colorSpaceCompare.subtitle')}</p>
        <section class="color-space-compare-preview-card">
          <span class="color-space-compare-card-kicker" data-csc-i18n="home.colorSpaceCompare.livePreview">${t('home.colorSpaceCompare.livePreview')}</span>
          <div class="color-space-compare-preview-row">
            <div class="color-space-compare-preview" data-role="preview"></div>
            <div class="color-space-compare-preview-meta">
              <label class="color-space-compare-hex-row" data-role="hex-row">
                <span aria-hidden="true">#</span>
                <input class="color-space-compare-hex-input" data-role="hex-input" type="text" value="808080" spellcheck="false" autocomplete="off" autocapitalize="characters" aria-label="${t('home.colorSpaceCompare.hexLabel')}">
              </label>
              <strong class="color-space-compare-hex" data-role="hex" hidden>#808080</strong>
              <div data-role="gamut-badge"></div>
            </div>
          </div>
          <p class="color-space-compare-preview-status" data-role="preview-status"></p>
          <div class="color-space-compare-gamut-list" data-role="gamut-list"></div>
        </section>
        <section class="color-space-compare-code-list" data-role="code-list"></section>
        <div class="tool-page-v2-rail-note">
          <span>LOCAL &amp; PRECISE</span>
          <strong data-csc-i18n="home.colorSpaceCompare.localNote">${t('home.colorSpaceCompare.localNote')}</strong>
        </div>
      </aside>
      <section class="tool-page-v2-workspace color-space-compare-workspace">
        <header class="color-space-compare-workspace-head">
          <div><span>LINKED COLOR MODEL</span><h2 data-csc-i18n="home.colorSpaceCompare.workspaceTitle">${t('home.colorSpaceCompare.workspaceTitle')}</h2></div>
          <p data-csc-i18n="home.colorSpaceCompare.workspaceDesc">${t('home.colorSpaceCompare.workspaceDesc')}</p>
        </header>
        <div class="color-space-compare-controls">
          <div class="color-space-compare-wheels" data-role="wheels"></div>
          <div class="color-space-compare-sliders" data-role="sliders"></div>
        </div>
      </section>
    </main>
  </div>`;
}

export function initColorSpaceCompareTool({
  overlay,
  notify = message => window.showToast?.(message),
} = {}) {
  if (!overlay) throw new Error('color-space-compare:missing-overlay');

  overlay.innerHTML = renderColorSpaceCompareMarkup();
  const shell = overlay.querySelector('.color-space-compare-shell');
  const controller = createColorSpaceCompareController(shell, notify);
  let backgroundDispose = null;
  let isOpen = false;
  const api = {
    open() {
      if (isOpen) return;
      isOpen = true;
      backgroundDispose?.();
      backgroundDispose = mountToolPageBackground(shell);
      overlay.classList.add('visible');
      overlay.setAttribute('aria-hidden', 'false');
      controller.open();
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      controller.close();
      backgroundDispose?.();
      backgroundDispose = null;
      overlay.classList.remove('visible');
      overlay.setAttribute('aria-hidden', 'true');
    },
    dispose() {
      api.close();
      controller.destroy();
      disposeChrome();
      overlay.replaceChildren();
    },
    destroy() {
      api.dispose();
    },
  };
  const disposeChrome = bindToolPageChrome(shell, api.close);
  return api;
}
