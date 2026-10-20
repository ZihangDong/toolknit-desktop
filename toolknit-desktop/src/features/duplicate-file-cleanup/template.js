import { toolTopbarMarkup } from '../../shared/tool-page-shell.js';
import { FILE_TYPES } from './file-types.js';
const text = key => `data-i18n="home.duplicateFileCleanup.${key}"`;
const button = (id, icon, key) => `<button id="duplicate${id}" class="cleanup-v2-btn" type="button"><i data-lucide="${icon}" aria-hidden="true"></i><span ${text(key)}></span></button>`;
const iconButton = (id, icon, key) => `<button id="duplicate${id}" class="cleanup-v2-btn duplicate-icon-button" type="button" data-i18n-title="home.duplicateFileCleanup.${key}" data-i18n-aria-label="home.duplicateFileCleanup.${key}"><i data-lucide="${icon}" aria-hidden="true"></i></button>`;
export const TOOL_MARKUP = `
<div class="pdf-merge-overlay pdf-merge-v2 cleanup-v2 duplicate-cleanup" id="duplicateFileCleanupOverlay" aria-hidden="true" inert data-tool-page-chrome>
  <div class="plasma-bg pdf-merge-v2-bg" id="duplicateCleanupBackground"></div>
  ${toolTopbarMarkup({ tag: 'DUPLICATE FILES · TOOL PAGE 3.2', title: 'DUPLICATE FILES', closeAttr: 'data-duplicate-close' })}
  <div class="pdf-merge-v2-body cleanup-large-files-body">
    <aside class="cleanup-v2-side">
      <div class="cleanup-v2-side-scroll">
        <div class="cleanup-v2-side-head"><h1 ${text('title')}></h1><p ${text('subtitle')}></p></div>
        <div class="cleanup-v2-field"><span class="cleanup-v2-label" ${text('folder')}></span><div class="cleanup-v2-path" id="duplicateFolder"></div><div class="duplicate-scope-actions">${button('Choose', 'folder-open', 'choose')}${button('AllDrives', 'hard-drive', 'allDrives')}</div></div>
        <label class="duplicate-check"><input type="checkbox" id="duplicateRecursive" checked><span ${text('recursive')}></span></label>
        <fieldset class="duplicate-types" id="duplicateTypes">
          <legend ${text('fileTypes')}></legend>
          <div class="duplicate-type-actions">${button('TypesAll', 'check-check', 'typesAll')}${button('TypesNone', 'x', 'typesNone')}</div>
          ${FILE_TYPES.map(type => `<div class="duplicate-type-category"><h3 ${text(type.key)}></h3><div class="duplicate-extensions">${type.extensions.map(extension => `<label><input type="checkbox" data-extension="${extension}" checked><span>.${extension}</span></label>`).join('')}</div></div>`).join('')}
          <p id="duplicateTypeCount"></p>
        </fieldset>
      </div>
      <button id="duplicateScan" type="button" class="cleanup-v2-scan-btn"><i data-lucide="scan-search" aria-hidden="true"></i><span ${text('scan')}></span></button>
      <button id="duplicateCancel" class="cleanup-v2-btn" type="button" ${text('cancel')}></button>
    </aside>
    <main class="cleanup-v2-main duplicate-main">
      <header class="duplicate-main-head"><h2 ${text('results')}></h2><span id="duplicateSummary"></span></header>
      <div class="duplicate-toolbar"><input id="duplicateSearch" type="search" data-i18n-placeholder="home.duplicateFileCleanup.search" data-i18n-aria-label="home.duplicateFileCleanup.search">${button('Select', 'list-checks', 'select')}${button('Clear', 'list-x', 'clear')}</div>
      <div id="duplicateStatus" class="duplicate-status" role="status" aria-live="polite"></div>
      <div id="duplicateWarning" class="duplicate-note" hidden></div>
      <div id="duplicateError" class="duplicate-error" role="alert" hidden></div>
      <div class="duplicate-results" id="duplicateResults"><div class="duplicate-empty"><i data-lucide="files" aria-hidden="true"></i><h3 ${text('emptyTitle')}></h3><p ${text('empty')}></p></div></div>
      <footer class="duplicate-footer"><div class="duplicate-pagination">${iconButton('Previous', 'chevron-left', 'previous')}<span id="duplicatePage"></span>${iconButton('Next', 'chevron-right', 'next')}</div><span id="duplicateSelected"></span>${button('Remove', 'trash-2', 'remove')}</footer>
    </main>
    <section id="duplicateCleanupLayer" class="duplicate-cleanup-layer" aria-hidden="true" aria-labelledby="duplicateCleanupTitle" tabindex="-1" hidden inert>
      <div class="duplicate-cleanup-content">
        <div id="duplicateCleanupRunning">
          <canvas id="duplicateCleanupCanvas" class="duplicate-scan-canvas" role="img" data-i18n-aria-label="home.duplicateFileCleanup.cleaningTitle"></canvas>
        </div>
        <div id="duplicateCleanupArtwork" class="duplicate-cleanup-artwork" aria-hidden="true" hidden>
          <svg viewBox="0 0 200 160" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
            <g class="duplicate-art-paper"><rect x="73" y="28" width="54" height="66" rx="5"/><path d="M86 45h28M86 57h28M86 69h18"/></g>
            <path class="duplicate-art-tray" d="m49 88 11 47h80l11-47M49 88h28l7 12h32l7-12h28"/>
            <circle class="duplicate-art-ring" cx="148" cy="48" r="25" fill="var(--dup-cover)"/>
            <path class="duplicate-art-success" d="m135 48 9 9 17-19"/>
            <g class="duplicate-art-partial"><path d="M148 34v17"/><circle cx="148" cy="61" r="1"/></g>
            <path class="duplicate-art-failure" d="m139 39 18 18m0-18-18 18"/>
            <path class="duplicate-art-stopped" d="M141 38v20m14-20v20"/>
          </svg>
        </div>
        <h2 id="duplicateCleanupTitle" role="status" aria-live="polite"></h2>
        <p id="duplicateCleanupMessage"></p>
        <div id="duplicateCleanupProgressArea" class="duplicate-cleanup-progress-area">
          <div class="duplicate-cleanup-progress-label"><span id="duplicateCleanupStage"></span><strong id="duplicateCleanupPercent"></strong></div>
          <progress id="duplicateCleanupProgress" value="0" max="1" data-i18n-aria-label="home.duplicateFileCleanup.cleanupProgress"></progress>
          <p id="duplicateCleanupCounts"></p><p id="duplicateCleanupCurrent" class="duplicate-cleanup-current"></p>
        </div>
        <dl id="duplicateCleanupStats" class="duplicate-cleanup-stats" hidden>
          <div><dt ${text('movedCount')}></dt><dd id="duplicateCleanupSucceeded"></dd></div>
          <div><dt ${text('failedCount')}></dt><dd id="duplicateCleanupFailed"></dd></div>
          <div><dt ${text('unprocessedCount')}></dt><dd id="duplicateCleanupUnprocessed"></dd></div>
          <div><dt ${text('movedSize')}></dt><dd id="duplicateCleanupBytes"></dd></div>
        </dl>
        <p id="duplicateCleanupTime"></p>
        <p id="duplicateCleanupQuote" class="duplicate-scan-quote"></p>
        <details id="duplicateCleanupFailureDetails" class="duplicate-cleanup-failure-details" hidden><summary ${text('failureDetails')}></summary><div id="duplicateCleanupFailureList"></div></details>
        <div class="duplicate-cleanup-actions">
          <button id="duplicateCleanupStop" class="cleanup-v2-btn" type="button" ${text('stopCleanup')}></button>
          <button id="duplicateCleanupReturn" class="cleanup-v2-btn" type="button" hidden><i data-lucide="arrow-left" aria-hidden="true"></i><span ${text('returnToTool')}></span></button>
        </div>
      </div>
    </section>
  </div>
</div>
<div class="audio-convert-success-overlay duplicate-dialog" id="duplicateCleanupDialog" aria-hidden="true" inert>
  <section class="audio-convert-success-dialog" role="dialog" aria-modal="true" aria-labelledby="duplicateDialogTitle" aria-describedby="duplicateDialogText">
    <h2 id="duplicateDialogTitle"></h2><p id="duplicateDialogText"></p><div id="duplicateFailures"></div>
    <div class="duplicate-dialog-actions">${button('DialogCancel', 'x', 'cancel')}${button('DialogConfirm', 'trash-2', 'confirm')}${button('DialogOk', 'check', 'ok')}</div>
  </section>
</div>`;

export default TOOL_MARKUP;
