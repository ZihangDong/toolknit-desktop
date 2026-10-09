import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { pdfjsDocumentOptions, destroyPdfDocument } from '../../shared/pdfjs-options.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession } from '../../app/modal-runtime.js';
import { createPdfWorkbench } from '../../shared/pdf-workbench.js';
import { assertPdfSplitPageCount } from '../../pdf-split-core.js';
import { onLangChange, t } from '../../i18n.js';

export function createPdfSplitPreview({ overlay, workspace, workspaceClose, workspaceStatus, workspaceHint,
  pageStrip, selectedCount, selectionMeta, selectAllButton, downloadAllButton,
  isSaving = () => false, onDownloadPage = () => {}, onDownloadAll = () => {}, onDownloadZip = () => {}, refreshIcons = () => {} } = {}) {
  const lifecycle = createLifecycleScope();
  const currentButton = workspace.querySelector('#pdfSplitDownloadCurrentBtn');
  const zipButton = workspace.querySelector('#pdfSplitDownloadZipBtn');
  let loadingTask = null, documents = [], pages = [], view = null, inputFileCount = 0;
  const modal = createModalSession({ root: workspace, background: overlay, initialFocus: workspaceClose,
    onClose: () => closeWorkspace(), canClose: () => !isSaving() });

  function updateControls() {
    workspace.setAttribute('aria-label', t('home.pdfSplit.workspaceTitle'));
    const chosen = pages.filter(page => page.selected).length;
    workspaceStatus.textContent = t('home.pdfSplit.inputStatus', { count: inputFileCount });
    workspaceHint.textContent = t('home.pdfSplit.workspaceTitle');
    selectedCount.textContent = t('home.pdfSplit.selectedCount', { count: chosen });
    selectionMeta.textContent = t('home.pdfSplit.selectionStatus', { selected: chosen, total: pages.length });
    selectAllButton.textContent = t(chosen === pages.length ? 'home.pdfSplit.clearSelection' : 'home.pdfSplit.selectAll');
    downloadAllButton.querySelector('span').textContent = t(chosen === pages.length ? 'home.pdfSplit.exportAll' : 'home.pdfSplit.exportSelected');
    currentButton.querySelector('span').textContent = t('home.pdfSplit.exportCurrent');
    zipButton.querySelector('span').textContent = t('home.pdfSplit.exportZip');
    for (const button of [downloadAllButton, zipButton]) button.disabled = isSaving() || !chosen;
    for (const button of [currentButton, selectAllButton]) button.disabled = isSaving() || !pages.length;
    workspaceClose.disabled = isSaving();
  }
  view = createPdfWorkbench({ root: workspace, pageStrip, back: workspaceClose,
    actions: workspace.querySelector('#pdfSplitWorkbenchActions'), tag: 'PDF SPLITTER · TOOL PAGE 3.1',
    stageId: 'pdfSplitPageStage',
    labels: { back: 'home.pdfSplit.backToHome', sourcePage: 'home.pdfSplit.sourcePage', selectedCount: 'home.pdfSplit.selectedCount' },
    onChange: updateControls, refreshIcons });

  function releaseResources() {
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
        pages.push({ fileIndex, pageIndex, fileName: file.name, selected: true });
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
    dispose() { closeWorkspace({ force: true }); view.dispose(); lifecycle.dispose(); },
    setSaving(value) { view.setLocked(value); updateControls(); },
    getExportState({ index = null, selectedOnly = false } = {}) {
      return { documents: documents.map(({ fileData, fileName }) => ({ fileData, fileName })),
        pages: (Number.isInteger(index) ? pages.slice(index, index + 1) : selectedOnly ? pages.filter(page => page.selected) : pages)
          .map(({ fileIndex, pageIndex }) => ({ fileIndex, pageIndex })) };
    }
  };
}
