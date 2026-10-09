import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { pdfjsDocumentOptions, destroyPdfDocument } from '../../shared/pdfjs-options.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession } from '../../app/modal-runtime.js';
import { createPdfWorkbench } from '../../shared/pdf-workbench.js';
import { assertPdfRotatePageCount, normalizePdfRotation } from '../../pdf-rotate-core.js';
import { onLangChange, t } from '../../i18n.js';

export function createPdfRotatePreview({ overlay, workspace, workspaceClose, workspaceStatus,
  workspaceFileName, pageCount, pageStrip, workspaceFooterStatus, rotateAllButton, downloadAllButton,
  isSaving = () => false, onDownloadPage = () => {}, onDownloadAll = () => {},
  onDownloadZip = () => {}, refreshIcons = () => {} } = {}) {
  const lifecycle = createLifecycleScope();
  const actions = workspace.querySelector('[data-rotate-actions]');
  const find = selector => actions.querySelector(selector);
  let loadingTask = null, loadedDocument = null, pages = [], view = null, range = 'current';
  const modal = createModalSession({ root: workspace, background: overlay, initialFocus: workspaceClose,
    onClose: () => closeWorkspace(), canClose: () => !isSaving() });

  function targets() {
    return pages.map((page, index) => ({ page, index })).filter(({ page, index }) =>
      range === 'all' || (range === 'selected' ? page.selected : index === view?.currentIndex()));
  }
  function updateControls() {
    const count = pages.filter(page => page.selected).length;
    workspace.setAttribute('aria-label', t('home.pdfRotate.workbenchTitle'));
    actions.querySelectorAll('[data-rotate-label]').forEach(node => { node.textContent = t(node.dataset.rotateLabel); });
    workspaceStatus.textContent = t('home.pdfRotate.workbenchTitle');
    workspaceFileName.textContent = loadedDocument?.fileName || '';
    pageCount.textContent = t('home.pdfRotate.pageCount', { count: pages.length });
    workspaceFooterStatus.textContent = t('home.pdfSplit.selectionStatus', { selected: count, total: pages.length });
    downloadAllButton.querySelector('span').textContent = t(count === pages.length ? 'home.pdfSplit.exportAll' : 'home.pdfSplit.exportSelected');
    find('[data-rotate-select]').textContent = t(count === pages.length ? 'home.pdfSplit.clearSelection' : 'home.pdfSplit.selectAll');
    find('[data-rotate-angle]').textContent = t('home.pdfRotate.angleStatus', { angle: pages[view?.currentIndex()]?.rotation || 0 });
    actions.querySelectorAll('button').forEach(button => { button.disabled = isSaving() || !pages.length; });
    actions.querySelectorAll('[data-rotate-scope]').forEach(button => {
      const active = button.dataset.rotateScope === range;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    actions.querySelectorAll('[data-rotate-turn]').forEach(button => { button.disabled = isSaving() || !targets().length; });
    for (const button of [downloadAllButton, find('[data-rotate-export="zip"]')]) button.disabled = isSaving() || !count;
    workspaceClose.disabled = isSaving();
  }
  view = createPdfWorkbench({ root: workspace, pageStrip, back: workspaceClose, actions,
    stageId: 'pdfRotatePageStage', tag: 'PDF ROTATOR · TOOL PAGE 3.1',
    labels: { back: 'home.pdfSplit.backToHome', sourcePage: 'home.pdfSplit.sourcePage', selectedCount: 'home.pdfSplit.selectedCount' },
    getRotation: page => page.rotation, onChange: updateControls, refreshIcons });

  function releaseResources() {
    view.clear();
    try { loadingTask?.destroy()?.catch(() => {}); } catch {} loadingTask = null;
    if (loadedDocument) { try { destroyPdfDocument(loadedDocument.doc)?.catch(() => {}); } catch {} }
    loadedDocument = null; pages = []; range = 'current';
  }
  async function load({ file, fileData, limits, isCurrent, onProgress }) {
    releaseResources();
    const check = () => { if (!isCurrent()) throw new Error('PDF rotate operation cancelled'); };
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    check();
    const task = pdfjs.getDocument(pdfjsDocumentOptions({ data: fileData.slice() }));
    loadingTask = task;
    let doc;
    try { doc = await task.promise; } finally { if (loadingTask === task) loadingTask = null; }
    if (!isCurrent()) { await destroyPdfDocument(doc); check(); }
    try { assertPdfRotatePageCount(doc.numPages, limits); }
    catch (failure) { await destroyPdfDocument(doc); throw failure; }
    loadedDocument = { doc, fileData, fileName: file.name };
    pages = Array.from({ length: doc.numPages }, (_, index) => ({
      pageIndex: index + 1, fileName: file.name, rotation: 0, selected: true
    }));
    onProgress?.(doc.numPages, doc.numPages);
  }
  function openWorkspace() {
    modal.open();
    const doc = loadedDocument.doc;
    view.setPages(pages, page => doc.getPage(page.pageIndex));
    updateControls();
  }
  function closeWorkspace({ force = false } = {}) {
    if (!force && isSaving()) return false;
    modal.close({ restore: !force }); releaseResources(); return true;
  }
  function turn(value, entries = targets()) {
    if (isSaving()) return;
    for (const { page } of entries) page.rotation = value === 'reset' ? 0 : normalizePdfRotation(page.rotation + Number(value));
    view.refreshPages(entries.map(({ index }) => index));
  }
  lifecycle.event(workspaceClose, 'click', () => closeWorkspace());
  lifecycle.event(actions, 'click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled || isSaving()) return;
    if (button.dataset.rotateScope) { range = button.dataset.rotateScope; updateControls(); }
    else if (button.dataset.rotateTurn) turn(button.dataset.rotateTurn);
    else if (button.hasAttribute('data-rotate-select')) {
      const select = pages.some(page => !page.selected);
      pages.forEach(page => { page.selected = select; }); view.refresh();
    } else if (button.dataset.rotateExport === 'current') void onDownloadPage(view.currentIndex());
    else if (button.dataset.rotateExport === 'zip') void onDownloadZip();
  });
  lifecycle.event(rotateAllButton, 'click', () => turn(90, pages.map((page, index) => ({ page, index }))));
  lifecycle.event(downloadAllButton, 'click', () => { void onDownloadAll(); });
  lifecycle.use(onLangChange(updateControls));
  return { load, openWorkspace, releaseResources,
    close: () => closeWorkspace({ force: true }),
    dispose() { closeWorkspace({ force: true }); view.dispose(); lifecycle.dispose(); },
    setSaving(value) { view.setLocked(value); updateControls(); },
    getExportState({ index = null, selectedOnly = false } = {}) {
      return loadedDocument ? { fileData: loadedDocument.fileData, fileName: loadedDocument.fileName,
        pages: (Number.isInteger(index) ? pages.slice(index, index + 1) : selectedOnly ? pages.filter(page => page.selected) : pages)
          .map(({ pageIndex, fileName, rotation }) => ({ pageIndex, fileName, rotation })) } : null;
    }
  };
}
