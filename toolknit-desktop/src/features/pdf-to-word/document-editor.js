// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { createPdfWorkbench } from '../../shared/pdf-workbench.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession, setModalInteractivity } from '../../app/modal-runtime.js';
import { moveFocusOutOfHiddenRegion } from '../../shared/tool-page-shell.js';
import { applyTranslations, t, onLangChange } from '../../i18n.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import { createWordResultEditor } from './result-editor.js';
import { pageAssetIds, renderResultPage } from './result-preview.js';
import { publishWord } from './processor.js';
import { downloadWord, wordErrorKey } from './output.js';
import { wordButton, wordLabel, wordResultMarkup } from './template.js';
import { wordError } from './core/input.js';
import { createSourceFontScope } from './adapters/source-font-runtime.js';

/** PDF-editor chrome with a WordScene adapter, never a DOCX→PDF round trip. */
export function createWordDocumentEditor({ isTauri = false, getOutputDir, displayFilesystemPath = value => value, refreshIcons = () => {}, openLazyTool } = {}) {
  const scope = createLifecycleScope(), root = document.createElement('div'), actions = document.createElement('div'), back = document.createElement('button'), strip = document.createElement('div');
  root.id = 'wordDocumentOverlay'; root.className = 'pdf-word-document'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-hidden', 'true'); root.inert = true; back.type = 'button'; actions.className = 'pdf-workbench-actions';
  const button = (id, icon, key, attrs = '') => wordButton(id, icon, key, attrs, 'wordDocument');
  actions.innerHTML = `<h2 data-i18n="home.pdfWord.documentEditor"></h2><p class="pdf-word-hint" data-i18n="home.pdfWord.documentEditHint"></p>${button('Structure', 'scan', 'structure', 'aria-pressed="true"')}<div class="pdf-word-select-buttons">${button('Undo', 'undo-2', 'undo')}${button('Redo', 'redo-2', 'redo')}${button('Reset', 'rotate-ccw', 'reset')}</div><div id="wordDocumentSelection" class="pdf-word-selection" hidden><strong id="wordDocumentSelectionType"></strong>${button('Edit', 'pencil', 'edit')}${button('Replace', 'image-plus', 'replace')}${button('Delete', 'trash-2', 'delete')}${button('Deselect', 'x', 'deselect')}</div><input id="wordDocumentImageInput" type="file" accept="image/png,image/jpeg" hidden><p id="wordDocumentStatus" class="pdf-word-status" role="status"></p><div class="pdf-workbench-export">${button('Export', 'download', 'exportEdited', 'data-export-primary')}</div>`;
  let session = null, owner = null, active = null, revision = 0, confirmation = null, savedResult = null, status = null, sourceFontScope = null;
  const tr = (key, params) => t('home.pdfWord.' + key, params);
  const byId = suffix => root.querySelector('#wordDocument' + suffix) || portals.querySelector('#wordDocument' + suffix);
  const portals = document.createElement('div'); portals.className = 'pdf-word-portals';
  portals.innerHTML = `<div id="wordDocumentEditOverlay" class="pdf-word-modal" role="dialog" aria-modal="true" aria-labelledby="wordDocumentEditTitle" aria-hidden="true" inert><div class="pdf-word-dialog"><h2 id="wordDocumentEditTitle" data-i18n="home.pdfWord.editText"></h2><form id="wordDocumentEditForm"><textarea id="wordDocumentEditText" rows="6" maxlength="10000" data-i18n-aria-label="home.pdfWord.editText"></textarea><p id="wordDocumentEditError" class="pdf-word-status is-error" role="status"></p><div class="pdf-word-dialog-actions">${button('EditCancel', 'x', 'cancel')}<button class="pdf-word-button" type="submit">${wordLabel('apply')}</button></div></form></div></div><div id="wordDocumentConfirmOverlay" class="pdf-word-modal" role="dialog" aria-modal="true" aria-labelledby="wordDocumentConfirmTitle" aria-hidden="true" inert><div class="pdf-word-dialog"><h2 id="wordDocumentConfirmTitle" data-i18n="home.pdfWord.confirmTitle"></h2><p id="wordDocumentConfirmMessage"></p><div class="pdf-word-dialog-actions">${button('ConfirmCancel', 'x', 'cancel')}${button('ConfirmOk', 'check', 'continue')}</div></div></div><div id="wordDocumentProcess" class="audio-convert-process-mask pdf-word-document-process" role="dialog" aria-modal="true" aria-labelledby="wordDocumentProgressTitle" aria-hidden="true" inert><div class="tk-mascot-lg" aria-hidden="true"></div><h2 id="wordDocumentProgressTitle" data-i18n="home.pdfWord.saving"></h2>${button('Cancel', 'x', 'cancel')}</div>${wordResultMarkup('wordDocument')}`;
  document.body.append(root, portals);
  const workbench = createPdfWorkbench({ root, pageStrip: strip, back, actions, tag: 'WORD DOCUMENT · PDF EDITOR', selection: false,
    labels: { back: 'home.pdfWord.editorBack', selectedCount: 'home.pdfWord.documentPages', sourcePage: 'home.pdfWord.pageLabel' }, refreshIcons,
    onRendered: () => editor.render(), onChange: () => { if (session) editor.render(); } });
  const regions = document.createElement('div'); regions.id = 'wordDocumentRegions'; regions.className = 'pdf-word-regions'; workbench.surface.append(regions);
  const fontsReady = () => {
    const page = session?.document.pages[workbench.currentIndex()];
    return page && !sourceFontScope?.loading && pageAssetIds(page).filter(id => id.startsWith('font:')).every(id => sourceFontScope?.has(id));
  };
  const editor = createWordResultEditor({ overlay: root, byId, tr, enabled: () => Boolean(session && !active && !root.inert && fontsReady()),
    fontContext: context => sourceFontScope?.context(context) || context,
    resolveInsertedStyle: (text, style) => sourceFontScope?.insertedStyle(text, style) || style,
    pageNumber: () => session?.document.pages[workbench.currentIndex()]?.number, report,
    changed: ({ pages = [] } = {}) => { workbench.invalidate(pages.map(number => session?.document.pages.findIndex(page => page.number === number)).filter(index => index >= 0)); editor.render(); } });
  const confirmModal = createModalSession({ root: byId('ConfirmOverlay'), background: root, initialFocus: byId('ConfirmCancel'), onClose: () => resolveConfirm(false) });
  const processModal = createModalSession({ root: byId('Process'), background: root, initialFocus: byId('Cancel'), onClose: cancel, canClose: () => !active?.committing });
  const resultModal = createModalSession({ root: byId('SuccessOverlay'), background: root, initialFocus: byId('SuccessOk'), onClose: closeResult });
  function closeResult() { resultModal.close(); editor.render(); }
  function resolveConfirm(value) { const resolve = confirmation; confirmation = null; confirmModal.close(); editor.render(); resolve?.(value); }
  function confirm(key) { if (confirmation) return Promise.resolve(false); byId('ConfirmMessage').textContent = tr(key); confirmModal.open(); return new Promise(resolve => { confirmation = resolve; }); }
  function report(error) { status = wordErrorKey(error); byId('Status').textContent = tr(status); }
  function cancel() { if (!active || active.committing) return; active.cancelled = true; active.nativeCancel?.(); processModal.close(); }
  function pageAdapter(entry) {
    const page = editor.document().pages[entry.index];
    return { rotate: 0, getViewport: ({ scale }) => ({ width: page.width * scale, height: page.height * scale }),
      render({ canvasContext }) {
        const epoch = revision, source = session, fonts = sourceFontScope; let cancelled = false;
        const check = () => { if (cancelled || epoch !== revision || source !== session) throw wordError('cancelled'); };
        return { cancel() { cancelled = true; }, promise: (async () => {
          const assets = await source.worker.request('assets', { ids: pageAssetIds(page).filter(id => !fonts?.has(id)) }); check();
          await fonts?.ensure(assets, check); check();
          const map = new Map([...assets, ...editor.assets.values()].map(asset => [asset.id, asset]));
          await renderResultPage(page, canvasContext.canvas, map, check, fonts); check();
        })() };
      } };
  }
  function renderResult() { if (!savedResult) return;
    byId('ResultName').textContent = savedResult.name; byId('ResultPath').textContent = savedResult.path ? displayFilesystemPath(savedResult.path) : tr('browserDownload');
    byId('OpenFolder').disabled = !savedResult.path; byId('EditDocument').hidden = true; byId('ResultStatus').textContent = '';
  }
  async function exportWord() {
    if (!session || active || editor.busy) return;
    const source = session, epoch = revision;
    const op = { cancelled: false, committing: false, nativeCancel: null, check() { if (op.cancelled || epoch !== revision || source !== session) throw wordError('cancelled'); } };
    active = op; workbench.setLocked(true); byId('Export').disabled = true; processModal.open();
    try {
      const output = await source.worker.request('finish', { document: editor.document(), editedAssets: editor.editedAssets(), options: { preserveGeometry: true, editableMath: true, strictMathGeometry: true } }); op.check();
      const path = await publishWord({ bytes: output.bytes, name: source.name, isTauri, getOutputDir, operation: op }); op.check();
      if (!isTauri) downloadWord(output.bytes, source.name, owner);
      editor.markSaved(); savedResult = { name: path ? path.split(/[\\/]/).pop() : source.name, path }; renderResult();
      processModal.close(); resultModal.open();
    } catch (error) { if (epoch === revision) report(error); }
    finally { if (active === op) { active = null; workbench.setLocked(false); byId('Export').disabled = false; processModal.close(); editor.render(); } }
  }
  scope.event(byId('Export'), 'click', () => { void exportWord(); });
  scope.event(byId('Cancel'), 'click', cancel); scope.event(byId('SuccessOk'), 'click', closeResult);
  scope.event(byId('OpenFolder'), 'click', async () => {
    if (!savedResult?.path || !session) return;
    const epoch = revision, saved = savedResult;
    try { const { invoke } = await tauriCorePromise;
      if (epoch === revision && savedResult === saved) await invoke('open_path', {path:saved.path});
    } catch (error) { if (epoch === revision && savedResult === saved) byId('ResultStatus').textContent = tr(wordErrorKey(error)); }
  });
  scope.event(byId('Structure'), 'click', () => { const button = byId('Structure'); button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true')); editor.render(); });
  scope.event(byId('Reset'), 'click', async () => { const epoch = revision; if (await confirm('resetConfirm') && epoch === revision && session && !active) editor.reset(); });
  scope.event(byId('ConfirmCancel'), 'click', () => resolveConfirm(false)); scope.event(byId('ConfirmOk'), 'click', () => resolveConfirm(true));
  scope.event(back, 'click', async () => { if (await close() !== false) await openLazyTool?.('pdf-to-word'); });
    scope.event(document, 'keydown', event => { if (event.key === 'Escape' && session && !root.inert && !event.defaultPrevented) { event.preventDefault(); void close(); } });
  function translate() { applyTranslations(root); applyTranslations(portals); root.setAttribute('aria-label', tr('documentEditor')); if (status) byId('Status').textContent = tr(status); renderResult(); }
  scope.use(onLangChange(translate)); scope.event(window, 'pagehide', () => { void close(true); });
  function release() {
    revision++; const old = session; session = null; owner?.dispose(); owner = null; sourceFontScope = null;
    if (active) { active.cancelled = true; active.nativeCancel?.(); active = null; }
    resolveConfirm(false); resultModal.close({ restore: false }); processModal.close({ restore: false });
    workbench.clear(); editor.clear(); old?.release(); savedResult = null; status = null;
    moveFocusOutOfHiddenRegion(root); root.classList.remove('visible'); setModalInteractivity(root, false);
  }
  async function close(force = false) {
    if (!session) return true;
    if (active?.committing && !force) return false;
    const epoch = revision;
    if (!force && editor.unsaved && (!await confirm('discardEdits') || epoch !== revision)) return false;
    release(); return true;
  }
  return { open(value) { release(); session = value; owner = createLifecycleScope(); sourceFontScope = createSourceFontScope();
    const fonts = sourceFontScope; owner.use(() => fonts.dispose()); root.classList.add('visible'); setModalInteractivity(root, true);
    editor.setBaseline(value.document); byId('Structure').setAttribute('aria-pressed', 'true');
    workbench.setPages(value.document.pages.map((page, index) => ({ index, pageIndex: page.number, fileName: value.name, selected: true })), pageAdapter);
    translate(); refreshIcons(); back.focus({ preventScroll: true }); }, close,
    dispose() { release(); editor.dispose(); workbench.dispose(); confirmModal.dispose(); processModal.dispose(); resultModal.dispose(); scope.dispose(); root.remove(); portals.remove(); } };
}
