import { toolTopbarMarkup } from '../../shared/tool-page-shell.js';
const text = key => `data-i18n="home.clipboardHistory.${key}"`;
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const command = (id, name, key, extra = '') => `<button id="clipboard${id}" type="button" class="clipboard-button" ${extra} data-i18n-title="home.clipboardHistory.${key}" data-i18n-aria-label="home.clipboardHistory.${key}">${icon(name)}<span ${text(key)}></span></button>`;

export default `<div id="clipboardHistoryOverlay" class="pdf-merge-overlay pdf-merge-v2 hardware-v2 tool-page-v2-light clipboard-history" role="dialog" aria-modal="true" aria-hidden="true" inert data-tool-page-chrome data-i18n-aria-label="home.clipboardHistory.title">
${toolTopbarMarkup({ tag: 'CLIPBOARD · TOOL PAGE 3.1', title: 'CLIPBOARD', closeAttr: 'data-clipboard-close' })}
<div class="hardware-v2-body clipboard-body">
  <aside class="clipboard-sidebar">
    <span class="pdf-merge-v2-section-kicker">LOCAL HISTORY</span>
    <h1 ${text('title')}></h1>
    <p class="clipboard-muted" ${text('subtitle')}></p>
    <div class="clipboard-monitor"><div><strong ${text('monitor')}></strong><span id="clipboardMonitorStatus" role="status"></span></div><button id="clipboardToggle" class="clipboard-switch" type="button" role="switch" aria-checked="false" data-i18n-aria-label="home.clipboardHistory.monitor"><span></span></button></div>
    <p id="clipboardStarted" class="clipboard-muted"></p>
    <dl class="clipboard-stats"><div><dt ${text('today')}></dt><dd id="clipboardToday">0</dd></div><div><dt ${text('total')}></dt><dd id="clipboardTotal">0</dd></div><div><dt ${text('storage')}></dt><dd id="clipboardStorage">0 B</dd></div></dl>
    <div id="clipboardHealth" class="clipboard-muted" aria-live="polite"></div>
    <div id="clipboardError" class="clipboard-error" role="alert" hidden></div>
    <fieldset class="clipboard-types"><legend ${text('recordTypes')}></legend>${[['Text','typeText'],['Images','typeImage'],['Files','typeFiles']].map(([id,key])=>`<label><input id="clipboard${id}" type="checkbox" checked><span ${text(key)}></span></label>`).join('')}</fieldset>
    ${command('Settings','sliders-horizontal','settings')}
    <div class="clipboard-privacy">${icon('shield-check')}<p ${text('privacy')}></p></div>
  </aside>
  <main class="clipboard-workspace">
    <div class="clipboard-toolbar">
      <label class="clipboard-search">${icon('search')}<input id="clipboardSearch" type="search" maxlength="512" autocomplete="off" data-i18n-placeholder="home.clipboardHistory.search" data-i18n-aria-label="home.clipboardHistory.search"></label>
      <select id="clipboardKind" data-i18n-aria-label="home.clipboardHistory.filterType">${[['','allTypes'],['text','typeText'],['image','typeImage'],['files','typeFiles']].map(([value,key])=>`<option value="${value}" ${text(key)}></option>`).join('')}</select>
      <select id="clipboardDate" data-i18n-aria-label="home.clipboardHistory.filterDate">${[['','allDates'],['today','today'],['week','week']].map(([value,key])=>`<option value="${value}" ${text(key)}></option>`).join('')}</select>
      ${command('Favorites','star','favorites','aria-pressed="false"')}${command('Batch','list-checks','batch','aria-pressed="false"')}${command('Clear','trash-2','clear')}
    </div>
    <div class="clipboard-batch" id="clipboardBatchBar" hidden><label><input id="clipboardSelectAll" type="checkbox"><span ${text('selectVisible')}></span></label><span id="clipboardSelectionCount"></span>${command('DeleteSelected','trash-2','deleteSelected')}</div>
    <button id="clipboardNew" type="button" class="clipboard-new" hidden></button>
    <div class="clipboard-content">
      <section class="clipboard-timeline" data-i18n-aria-label="home.clipboardHistory.timeline"><div id="clipboardList"></div><div id="clipboardEmpty" class="clipboard-empty"><div class="clipboard-empty-icon">${icon('clipboard-list')}</div><h2 id="clipboardEmptyTitle"></h2><p id="clipboardEmptyDescription"></p></div>${command('More','chevron-down','more','hidden')}</section>
      <section class="clipboard-detail" id="clipboardDetail" data-i18n-aria-label="home.clipboardHistory.details">
        <div class="clipboard-detail-empty" id="clipboardDetailEmpty">${icon('text-cursor-input')}<span ${text('selectRecord')}></span></div>
        <div id="clipboardDetailContent" hidden><div class="clipboard-detail-head"><div><span id="clipboardDetailType" class="pdf-merge-v2-section-kicker"></span><h2 ${text('details')}></h2></div>${command('DetailBack','arrow-left','backList')}</div>
          <dl id="clipboardMetadata" class="clipboard-metadata"></dl>
          <div id="clipboardPreview" class="clipboard-preview" tabindex="0"></div><p id="clipboardDetailNote" class="clipboard-muted"></p>
          <div class="clipboard-detail-actions">${command('Copy','copy','copy')}${command('CopyPaths','files','copyPaths','hidden')}${command('SaveImage','download','saveImage','hidden')}${command('Zoom','maximize','zoom','hidden')}${command('Favorite','star','favorite','aria-pressed="false"')}${command('Delete','trash-2','delete')}</div>
        </div>
      </section>
    </div>
  </main>
</div>
</div>
<div id="clipboardHistoryDialog" class="clipboard-modal-overlay" role="dialog" aria-modal="true" aria-hidden="true" inert><div class="clipboard-modal"><h2 id="clipboardDialogTitle"></h2><div id="clipboardDialogBody"></div><div class="clipboard-modal-actions">${command('DialogCancel','x','cancel')}${command('DialogConfirm','check','confirm')}</div></div></div>`;
