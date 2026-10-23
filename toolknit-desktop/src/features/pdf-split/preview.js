import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { pdfjsDocumentOptions, destroyPdfDocument } from '../../shared/pdfjs-options.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession } from '../../app/modal-runtime.js';
import { createPdfWorkbench } from '../../shared/pdf-workbench.js';
import { assertPdfSplitPageCount } from '../../pdf-split-core.js';
import { onLangChange, t } from '../../i18n.js';
import { createPdfSplitRangeDialog } from './range-dialog.js';

export function createPdfSplitPreview({ overlay, workspace, workspaceClose, workspaceStatus, workspaceHint,
  pageStrip, selectedCount, selectionMeta, selectAllButton, downloadAllButton,
  isSaving = () => false, onDownloadPage = () => {}, onDownloadAll = () => {}, onDownloadZip = () => {}, refreshIcons = () => {} } = {}) {
  const lifecycle = createLifecycleScope();
  const currentButton = workspace.querySelector('#pdfSplitDownloadCurrentBtn');
  const zipButton = workspace.querySelector('#pdfSplitDownloadZipBtn');
  const rangeButton = workspace.querySelector('#pdfSplitRangeBtn');
  let loadingTask = null, documents = [], pages = [], view = null, inputFileCount = 0;
  const modal = createModalSession({ root: workspace, background: overlay, initialFocus: workspaceClose,
    onClose: () => closeWorkspace(), canClose: () => !isSaving() });

  function updateControls() {
    workspace.setAttribute('aria-label', t('home.pdfSplit.workspaceTitle'));
    const chosen = pages.filter(page => page.selected).length;
    workspaceStatus.textContent = t('home.pdfSplit.inputStatus', { count: inputFileCount });
    workspaceHint.textContent = t('home.pdfSplit.totalPages', { total: pages.length });
    selectedCount.textContent = t('home.pdfSplit.selectedCount', { count: chosen });
    selectionMeta.textContent = t('home.pdfSplit.selectionStatus', { selected: chosen, total: pages.length });
    selectAllButton.querySelector('span').textContent = t(chosen === pages.length && pages.length ? 'home.pdfSplit.clearSelection' : 'home.pdfSplit.selectAll');
    selectAllButton.setAttribute('aria-pressed', String(Boolean(pages.length && chosen === pages.length)));
    downloadAllButton.querySelector('span').textContent = t(chosen === pages.length ? 'home.pdfSplit.exportAll' : 'home.pdfSplit.exportSelected');
    currentButton.querySelector('span').textContent = t('home.pdfSplit.exportCurrent');
    zipButton.querySelector('span').textContent = t('home.pdfSplit.exportZip');
    for (const button of [downloadAllButton, zipButton]) button.disabled = isSaving() || !chosen;
    for (const button of [currentButton, selectAllButton, rangeButton]) button.disabled = isSaving() || !pages.length;
    workspaceClose.disabled = isSaving();
  }
  view = createPdfWorkbench({ root: workspace, pageStrip, back: workspaceClose,
    actions: workspace.querySelector('#pdfSplitWorkbenchActions'), tag: 'PDF SPLITTER · TOOL PAGE 3.2',
    stageId: 'pdfSplitPageStage',
    labels: { back: 'home.pdfSplit.backToHome', sourcePage: 'home.pdfSplit.sourcePage', selectedCount: 'home.pdfSplit.selectedCount' },
    onChange: updateControls, refreshIcons });
  const rangeDialog = createPdfSplitRangeDialog({ root: workspace.ownerDocument.getElementById('pdfSplitRangeDialog'), workspace,
    trigger: rangeButton, getPages: () => pages, isLocked: isSaving, onSelect: () => view.refresh() });

  function releaseResources() {
    rangeDialog.close({ restore: false });
    view.clear();
    try { loadingTask?.destroy()?.catch(() => {}); } catch {} loadingTask = null;
    for (const { doc } of documents) { try { destroyPdfDocument(doc)?.catch(() => {}); } catch {} }
    documents = []; pages = []; inputFileCount = 0;
  }
  async function load({ files, readFileData, limits, isCurrent, onProgress }) {
    releaseResources(); inputFileCount = files.length;
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const check = () => { if (!isCurrent()) throw new Error('PDF split operation cancelled'); };
    check();
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      check(); const file = files[fileIndex];
      onProgress?.({ fileIndex, fileCount: files.length, phase: 'read' });
      const fileData = await readFileData(file); check();
      const task = pdfjs.getDocument(pdfjsDocumentOptions({ data: fileData.slice() }));
      loadingTask = task;
      let doc;
      try { doc = await task.promise; } finally { if (loadingTask === task) loadingTask = null; }
      if (!isCurrent()) { await destroyPdfDocument(doc); check(); }
      try { assertPdfSplitPageCount(pages.length + doc.numPages, limits); }
      catch (failure) { await destroyPdfDocument(doc); throw failure; }
      documents.push({ doc, fileData, fileName: file.name });
      for (let pageIndex = 1; pageIndex <= doc.numPages; pageIndex++) {
        pages.push({ fileIndex, pageIndex, fileName: file.name, selected: false });
      }
    }
  }
  function openWorkspace() {
    modal.open();
    const sources = documents;
    view.setPages(pages, page => sources[page.fileIndex].doc.getPage(page.pageIndex));
    updateControls();
  }
  function closeWorkspace({ force = false } = {}) {
    if (!force && isSaving()) return false;
    rangeDialog.close({ restore: false });
    modal.close({ restore: !force }); releaseResources(); return true;
  }
  lifecycle.event(workspaceClose, 'click', () => closeWorkspace());
  lifecycle.event(selectAllButton, 'click', () => {
    if (isSaving()) return;
    const select = pages.some(page => !page.selected);
    pages.forEach(page => { page.selected = select; }); view.refresh();
  });
  lifecycle.event(currentButton, 'click', () => { void onDownloadPage(view.currentIndex()); });
  lifecycle.event(downloadAllButton, 'click', () => { void onDownloadAll(); });
  lifecycle.event(zipButton, 'click', () => { void onDownloadZip(); });
  lifecycle.use(onLangChange(updateControls));
  return { load, openWorkspace, closeWorkspace, releaseResources,
    close: () => closeWorkspace({ force: true }),
    dispose() { closeWorkspace({ force: true }); rangeDialog.dispose(); view.dispose(); lifecycle.dispose(); },
    setSaving(value) { if (value) rangeDialog.close({ restore: false }); view.setLocked(value); updateControls(); },
    getExportState({ index = null, selectedOnly = false } = {}) {
      return { documents: documents.map(({ fileData, fileName }) => ({ fileData, fileName })),
        pages: (Number.isInteger(index) ? pages.slice(index, index + 1) : selectedOnly ? pages.filter(page => page.selected) : pages)
          .map(({ fileIndex, pageIndex }) => ({ fileIndex, pageIndex })) };
    }
  };
}
