import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { pdfjsDocumentOptions, destroyPdfDocument } from '../../shared/pdfjs-options.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession } from '../../app/modal-runtime.js';
import { createPdfWorkbench } from '../../shared/pdf-workbench.js';
import { PDF_MERGE_LIMITS } from '../../pdf-merge-core.js';
import { onLangChange, t } from '../../i18n.js';

function cancelledError() {
  return new Error('PDF merge operation cancelled');
}

/**
 * Owns PDF.js documents and the merge-specific state around the shared PDF
 * workbench. The workbench owns only the rendered canvases and page controls.
 */
export function createPdfMergePreview({
  overlay,
  workspace,
  workspaceClose,
  workspaceStatus,
  workspaceHint,
  inputCount,
  totalCount,
  outputCount,
  selectedCount,
  selectionMeta,
  selectAllButton,
  commitButton,
  moveUpButton,
  moveDownButton,
  deleteButton,
  isSaving = () => false,
  onCommit = () => {},
  refreshIcons = () => {}
} = {}) {
  const lifecycle = createLifecycleScope();
  const actions = workspace.querySelector('#pdfMergeWorkbenchActions');
  let loadingTask = null;
  let documents = [];
  let pages = [];
  let view = null;
  let workspaceSession = false;

  const modal = createModalSession({
    root: workspace,
    background: overlay,
    initialFocus: workspaceClose,
    onClose: () => closeWorkspace(),
    canClose: () => !isSaving()
  });

  function updateControls() {
    const chosen = pages.filter(page => page.selected).length;
    const currentPageIndex = view?.currentIndex?.() ?? -1;
    const canMoveUp = currentPageIndex > 0;
    const canMoveDown = currentPageIndex >= 0 && currentPageIndex < pages.length - 1;
    const canDelete = chosen > 0 && pages.length - chosen >= 2;
    const allSelected = pages.length > 0 && chosen === pages.length;
    workspace.setAttribute('aria-label', t('home.pdfMerge.workspaceTitle'));
    if (workspaceStatus) {
      workspaceStatus.textContent = t('home.pdfMerge.inputStatus', { count: documents.length });
    }
    if (workspaceHint) workspaceHint.textContent = t('home.pdfMerge.workspaceHint');
    if (inputCount) inputCount.textContent = String(documents.length);
    if (totalCount) totalCount.textContent = String(documents.reduce((sum, { doc }) => sum + doc.numPages, 0));
    if (outputCount) outputCount.textContent = String(pages.length);
    if (selectedCount) {
      selectedCount.textContent = t('home.pdfMerge.selectedCount', { count: chosen });
    }
    if (selectionMeta) {
      selectionMeta.textContent = t('home.pdfMerge.outputSummary', { count: pages.length });
    }
    if (selectAllButton) {
      const label = selectAllButton.querySelector('span');
      if (label) label.textContent = t(allSelected
        ? 'home.pdfMerge.clearSelection'
        : 'home.pdfMerge.selectAllPages');
      selectAllButton.disabled = isSaving() || !pages.length;
    }
    if (commitButton) commitButton.disabled = isSaving() || pages.length < 2;
    if (moveUpButton) moveUpButton.disabled = isSaving() || !canMoveUp;
    if (moveDownButton) moveDownButton.disabled = isSaving() || !canMoveDown;
    if (deleteButton) {
      deleteButton.disabled = isSaving() || !canDelete;
      deleteButton.title = canDelete ? '' : t('home.pdfMerge.minimumPages');
    }
    if (workspaceClose) workspaceClose.disabled = isSaving();
  }

  view = createPdfWorkbench({
    root: workspace,
    pageStrip: workspace.querySelector('#pdfMergePageStrip'),
    back: workspaceClose,
    actions,
    tag: 'PDF MERGER · TOOL PAGE 3.1',
    labels: {
      back: 'home.pdfMerge.backToHome',
      sourcePage: 'home.pdfMerge.sourcePage',
      selectedCount: 'home.pdfMerge.selectedCount'
    },
    stageId: 'pdfMergePageStage',
    sortable: true,
    onReorder: () => updateControls(),
    onChange: updateControls,
    refreshIcons
  });

  function releaseResources() {
    view.clear();
    const task = loadingTask;
    if (task) {
      try { task.cancel(); } catch {}
      try { loadingTask.destroy()?.catch(() => {}); } catch {}
    }
    loadingTask = null;
    for (const { doc } of documents) {
      try { destroyPdfDocument(doc)?.catch(() => {}); } catch {}
    }
    documents = [];
    pages = [];
    workspaceSession = false;
  }

  async function loadSources({ files, readFileData, preflight, isCurrent, onProgress }) {
    releaseResources();
    await preflight();
    if (!isCurrent()) throw cancelledError();
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

    try {
      for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        if (!isCurrent()) throw cancelledError();
        const file = files[fileIndex];
        onProgress?.(fileIndex, files.length);
        const fileData = await readFileData(file);
        if (!fileData.length) throw new Error(`File ${file.name} is empty`);
        if (!isCurrent()) throw cancelledError();

        const task = pdfjs.getDocument(pdfjsDocumentOptions({ data: fileData.slice() }));
        loadingTask = task;
        let documentHandle;
        try {
          documentHandle = await task.promise;
        } finally {
          if (loadingTask === task) loadingTask = null;
        }
        if (!isCurrent()) {
          await destroyPdfDocument(documentHandle);
          throw cancelledError();
        }
        if (pages.length + documentHandle.numPages > PDF_MERGE_LIMITS.maxPreviewPages) {
          await destroyPdfDocument(documentHandle);
          throw new Error(`PDF inputs exceed the ${PDF_MERGE_LIMITS.maxPreviewPages}-page preview limit`);
        }

        documents.push({ doc: documentHandle, fileData, fileName: file.name });
        for (let pageIndex = 1; pageIndex <= documentHandle.numPages; pageIndex += 1) {
          pages.push({
            fileIndex,
            pageIndex,
            fileName: file.name,
            rotation: 0,
            selected: true
          });
        }
      }
    } catch (error) {
      releaseResources();
      throw error;
    }

    return documents
      .map(({ doc }, fileIndex) => ({ fileIndex, pageCount: doc.numPages }))
      .filter(({ pageCount }) => pageCount > 1);
  }

  function openWorkspace() {
    if (!pages.length) return;
    workspaceSession = true;
    modal.open();
    view.setPages(pages, page => documents[page.fileIndex].doc.getPage(page.pageIndex));
    updateControls();
  }

  function closeWorkspace({ force = false } = {}) {
    if (!force && isSaving()) return false;
    modal.close({ restore: !force });
    releaseResources();
    return true;
  }

  function hideForCommit() {
    modal.close({ restore: false });
  }

  function restoreAfterError() {
    if (!workspaceSession || !pages.length) return false;
    modal.open();
    updateControls();
    return true;
  }

  function moveSelected(direction) {
    if (isSaving()) return;
    const from = view.currentIndex();
    const to = direction === 'up' ? from - 1 : from + 1;
    if (to < 0 || to >= pages.length) return;
    [pages[from], pages[to]] = [pages[to], pages[from]];
    view.setPages(pages, page => documents[page.fileIndex].doc.getPage(page.pageIndex));
    view.select(to);
    view.refresh();
    updateControls();
  }

  function deleteSelected() {
    if (isSaving()) return;
    const chosen = pages.filter(page => page.selected).length;
    if (!chosen || pages.length - chosen < 2) return;
    const oldCurrent = view.currentIndex();
    const removedBefore = pages.slice(0, oldCurrent).filter(page => page.selected).length;
    pages = pages.filter(page => !page.selected);
    const nextIndex = Math.min(Math.max(0, oldCurrent - removedBefore), pages.length - 1);
    pages.forEach(page => { page.selected = false; });
    if (pages[nextIndex]) pages[nextIndex].selected = true;
    view.setPages(pages, page => documents[page.fileIndex].doc.getPage(page.pageIndex));
    view.select(nextIndex);
    updateControls();
  }

  lifecycle.event(workspaceClose, 'click', () => closeWorkspace());
  lifecycle.event(selectAllButton, 'click', () => {
    if (isSaving() || !pages.length) return;
    const select = pages.some(page => !page.selected);
    pages.forEach(page => { page.selected = select; });
    view.refresh();
  });
  lifecycle.event(moveUpButton, 'click', () => moveSelected('up'));
  lifecycle.event(moveDownButton, 'click', () => moveSelected('down'));
  lifecycle.event(deleteButton, 'click', deleteSelected);
  lifecycle.event(commitButton, 'click', () => {
    if (isSaving() || !pages.some(page => page.selected)) return;
    void onCommit();
  });
  lifecycle.use(onLangChange(updateControls));

  return {
    loadSources,
    openWorkspace,
    hideForCommit,
    restoreAfterError,
    releaseResources,
    close: () => closeWorkspace({ force: true }),
    dispose() {
      closeWorkspace({ force: true });
      view.dispose();
      lifecycle.dispose();
    },
    setSaving(value) {
      view.setLocked(value);
      updateControls();
    },
    getExportState() {
      return {
        documents: documents.map(({ fileData, fileName }) => ({ fileData, fileName })),
        pages: pages.map(({ fileIndex, pageIndex, rotation }) => ({
          fileIndex,
          pageIndex,
          rotation
        }))
      };
    },
    get visible() { return Boolean(workspace.classList.contains('visible')); }
  };
}
