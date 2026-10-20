// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { toolTopbarMarkup } from '../../shared/tool-page-shell.js';
const tr = key => `<span data-i18n="home.pdfWord.${key}"></span>`;
const button = (id, icon, key, attrs = '') => `<button id="pdfWord${id}" type="button" class="pdf-editor-tool" ${attrs}><i data-lucide="${icon}"></i>${tr(key)}</button>`;
export default `
<div id="pdfWordOverlay" class="pdf-word tool-page-v2-overlay" role="dialog" aria-modal="true" aria-hidden="true" inert>
  <div class="pdf-word-shell">
    ${toolTopbarMarkup({ tag: 'PDF TO WORD · TOOL PAGE 3.2', closeAttr: 'data-pdf-word-close' })}
    <div class="pdf-word-toolbar">
      <h1 data-i18n="home.pdfWord.title"></h1>
      <span id="pdfWordFileName" class="pdf-word-file"></span>
      ${button('Pick', 'folder-open', 'pick')}
      <input id="pdfWordFileInput" type="file" accept="application/pdf,.pdf" hidden>
    </div>
    <div class="pdf-word-body">
      <aside class="pdf-word-options">
        <label data-i18n="home.pdfWord.mode"></label>
        <div class="pdf-word-segments" role="group" data-i18n-aria-label="home.pdfWord.mode">
          ${button('Local', 'hard-drive', 'local', 'data-word-mode="local" aria-pressed="true"')}
          ${button('Ai', 'sparkles', 'ai', 'data-word-mode="ai" aria-pressed="false"')}
        </div>
        <p id="pdfWordPrivacy" class="pdf-word-hint"></p>
        <label for="pdfWordRange" data-i18n="home.pdfWord.range"></label>
        <input id="pdfWordRange" type="text" placeholder="1-3, 5" maxlength="1000" data-i18n-aria-label="home.pdfWord.range">
        <span id="pdfWordMeta" class="pdf-word-hint"></span>
        <label data-i18n="home.pdfWord.layout"></label>
        <div class="pdf-word-segments" role="group" data-i18n-aria-label="home.pdfWord.layout">
          ${button('Faithful', 'panels-top-left', 'faithful', 'data-word-layout="faithful" aria-pressed="true"')}
          ${button('Flow', 'align-left', 'flow', 'data-word-layout="flow" aria-pressed="false"')}
        </div>
        <p class="pdf-word-hint" data-i18n="home.pdfWord.scope"></p>
        <div class="pdf-word-primary">${button('Analyze', 'scan-text', 'analyze', 'disabled')}${button('Export', 'download', 'export', 'disabled data-export-primary')}</div>
        <p id="pdfWordStatus" class="pdf-word-status" role="status" aria-live="polite"></p>
      </aside>
      <main class="pdf-word-workspace">
        <div id="pdfWordEmpty" class="pdf-word-empty"><i data-lucide="file-type-2"></i><h2 data-i18n="home.pdfWord.empty"></h2><p data-i18n="home.pdfWord.limit"></p></div>
        <div id="pdfWordLoaded" class="pdf-word-loaded" hidden>
          <div class="pdf-word-preview-toolbar">
            ${button('Prev', 'chevron-left', 'previous')}
            <span id="pdfWordPageNumber"></span>
            ${button('Next', 'chevron-right', 'next')}
            ${button('Structure', 'scan', 'structure', 'aria-pressed="true"')}
          </div>
          <div id="pdfWordPreview" class="pdf-word-preview"><div class="pdf-word-paper"><canvas id="pdfWordCanvas"></canvas><div id="pdfWordRegions" class="pdf-word-regions"></div></div></div>
          <div id="pdfWordReview" class="pdf-word-review" hidden>
            <div><strong data-i18n="home.pdfWord.review"></strong><span id="pdfWordQuality"></span></div>
            <div id="pdfWordRisks"></div>
            <label id="pdfWordFallbackLabel" class="pdf-word-check" hidden><input id="pdfWordFallback" type="checkbox">${tr('fallbackConsent')}</label>
            <details><summary data-i18n="home.pdfWord.adjust"></summary>
              <div class="pdf-word-segments" role="group" data-i18n-aria-label="home.pdfWord.adjust">
                ${button('Auto', 'wand-sparkles', 'auto', 'data-word-page-mode="auto"')}
                ${button('Single', 'align-left', 'single', 'data-word-page-mode="single"')}
                ${button('NoHeader', 'panel-top', 'noHeader', 'data-word-page-mode="no-header"')}
              </div>
            </details>
          </div>
        </div>
      </main>
    </div>
  </div>
</div>
<div id="pdfWordProgressOverlay" class="audio-convert-process-mask" role="dialog" aria-modal="true" aria-labelledby="pdfWordProgressTitle" aria-hidden="true" inert>
  <div class="tk-mascot-lg" aria-hidden="true"></div><div id="pdfWordProgressTitle" class="audio-convert-process-text"></div>
  <button id="pdfWordCancel" class="audio-convert-cancel-btn" type="button"><i data-lucide="x"></i>${tr('cancel')}</button>
</div>
<div id="pdfWordPasswordOverlay" class="audio-clip-success-overlay" role="dialog" aria-modal="true" aria-labelledby="pdfWordPasswordTitle" aria-hidden="true" inert>
  <form id="pdfWordPasswordForm" class="audio-clip-success-dialog"><h3 id="pdfWordPasswordTitle" class="audio-clip-success-title" data-i18n="home.pdfWord.passwordTitle"></h3>
    <p id="pdfWordPasswordHint" class="audio-clip-success-meta"></p><input id="pdfWordPassword" type="password" autocomplete="off" data-i18n-aria-label="home.pdfWord.passwordTitle">
    <div class="audio-clip-success-actions"><button id="pdfWordPasswordCancel" class="audio-clip-success-btn audio-clip-success-btn-secondary" type="button">${tr('cancel')}</button><button class="audio-clip-success-btn audio-clip-success-btn-primary" type="submit">${tr('unlock')}</button></div>
  </form>
</div>
<div id="pdfWordSuccessOverlay" class="audio-clip-success-overlay" role="dialog" aria-modal="true" aria-labelledby="pdfWordSuccessTitle" aria-hidden="true" inert>
  <div class="audio-clip-success-dialog"><div class="audio-clip-success-icon"><i data-lucide="check"></i></div><h3 id="pdfWordSuccessTitle" class="audio-clip-success-title" data-i18n="home.pdfWord.success"></h3>
    <p id="pdfWordResultName" class="audio-clip-success-meta"></p><p id="pdfWordResultQuality" class="audio-clip-success-meta"></p><p id="pdfWordResultPath" class="audio-convert-success-value"></p>
    <div class="audio-clip-success-actions"><button id="pdfWordOpenFolder" class="audio-clip-success-btn audio-clip-success-btn-secondary" type="button">${tr('openFolder')}</button><button id="pdfWordOpenFile" class="audio-clip-success-btn audio-clip-success-btn-secondary" type="button">${tr('openFile')}</button><button id="pdfWordSuccessOk" class="audio-clip-success-btn audio-clip-success-btn-primary" type="button">${tr('done')}</button></div>
  </div>
</div>`;
