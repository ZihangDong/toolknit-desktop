import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { pdfjsDocumentOptions, destroyPdfDocument } from '../../shared/pdfjs-options.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createPdfWorkbench } from '../../shared/pdf-workbench.js';
import { t } from '../../i18n.js';

export function isPdfRenderCancellation(error) { return error?.name === 'RenderingCancelledException' || /cancelled|canceled/i.test(String(error?.message || error || '')); }

export function createPdfToImagePreview({ pageStrip, workspace, pageStage, isLocked = () => false, onSelectionChange = () => {}, refreshIcons = () => {} } = {}) {
  const lifecycle = createLifecycleScope();
  let documentHandle = null, loadingTask = null, pages = [], view = null, revision = 0;
  const actions = workspace.querySelector('[data-to-image-actions]');
  const ids = { '[data-wb-label]':'pdfToImagePagesLabel', '[data-wb-source]':'pdfToImageWorkbenchHint', '[data-wb-source-page]':'pdfToImageWorkbenchStatus' };
  view = createPdfWorkbench({ root: workspace, pageStrip, back: workspace.querySelector('#pdfToImageWorkspaceClose'),
    actions, tag: 'PDF TO IMAGE · TOOL PAGE 3.1', stageId: 'pdfToImagePageStage',
    labels: { back:'home.pdfToImageTool.backToHome', sourcePage:'home.pdfToImageTool.sourcePage', selectedCount:'home.pdfToImageTool.selectedCount' },
    ids, onChange: onSelectionChange, refreshIcons });
  // The workbench keeps the feature variant so the existing PDF-to-image
  // theme rules apply to both the upload page and the selection workspace.
  workspace.classList.add('pdf-to-image-v2');
  function statePages() { return view.getPages(); }
  function clear() { revision += 1; view.clear(); pages = []; documentHandle = null; try { loadingTask?.destroy()?.catch(() => {}); } catch {} loadingTask = null; }
  async function loadDocument(bytes, assertCurrent = () => {}) {
    clear(); const current = ++revision;
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl; assertCurrent();
    const task = pdfjs.getDocument(pdfjsDocumentOptions({ data: bytes.slice() })); loadingTask = task;
    let doc; try { doc = await task.promise; } finally { if (loadingTask === task) loadingTask = null; }
    assertCurrent(); if (current !== revision) { await destroyPdfDocument(doc); throw new Error('pdf-to-image:cancelled'); }
    documentHandle = doc; return doc;
  }
  function buildPageTiles(count) { pages = Array.from({ length: count }, (_, i) => ({ pageIndex:i + 1, pageNumber:i + 1, selected:true, fileName:'' })); view.setPages(pages, page => documentHandle.getPage(page.pageIndex)); onSelectionChange(); }
  function start() { /* Shared workbench starts its visible thumbnail queue in setPages. */ }
  function stop(releaseAll = false) { if (releaseAll) view.clear(); }
  async function releaseDocument() { clear(); }
  function setAllSelected(selected) { pages.forEach(page => { page.selected = selected; }); view.refresh(); onSelectionChange(); }
  function refreshTranslations() { view.refresh(); }
  function selectedPageStates() { return pages.filter(page => page.selected); }
  function cancelLoading() { try { loadingTask?.destroy()?.catch(() => {}); } catch {} }
  lifecycle.use(() => clear());
  return { buildPageTiles, cancelLoading, dispose: () => { clear(); view.dispose(); lifecycle.dispose(); }, getDocument: () => documentHandle,
    getPageStates: statePages, loadDocument, refreshTranslations, releaseDocument, selectedPageStates, setAllSelected, start, stop };
}
