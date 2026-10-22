import { PDF_EDITOR_LIMITS } from '../../pdf-editor-core.js';

/**
 * Computes and paints PDF Editor control availability from injected state.
 * Business mutations stay in the page, selection and editing controllers.
 */
export function createPdfEditorControls({
  appendBtn,
  rotateCcwBtn,
  rotateCwBtn,
  moveUpBtn,
  moveDownBtn,
  duplicateBtn,
  blankPageBtn,
  newDocumentBtn,
  deleteBtn,
  extractBtn,
  replaceBtn,
  exportBtn,
  editTextBtn,
  editTextSidebarBtn,
  insertTextBtn,
  insertImageBtn,
  insertRectBtn,
  insertEllipseBtn,
  insertLineBtn,
  selectComponentBtn,
  resetBtn,
  undoBtn,
  redoBtn,
  selectedCountEl,
  pageIndicator,
  footerHint,
  selectAllBtn,
  invertSelectionBtn,
  t = key => key,
  getActiveOperation = () => null,
  hasDocument = () => false,
  getPages = () => [],
  getSelectedIds = () => new Set(),
  getCurrentPage = () => null,
  pageSupportsContentEditing = () => false,
  pageSupportsInsertion = pageSupportsContentEditing,
  getSelectedComponent = () => null,
  getComponentMode = () => false,
  getEditMode = () => false,
  getInsertMode = () => null,
  getMainSourceName = () => 'document.pdf',
  getPageStates = () => new Map(),
  updateZoomLabel = () => {}
} = {}) {
  function updateControls() {
    const busy = Boolean(getActiveOperation());
    const has = hasDocument();
    const pages = getPages() || [];
    const selectedIds = getSelectedIds() || new Set();
    const selectedCount = selectedIds.size;
    const page = getCurrentPage();
    const currentIndex = page ? pages.indexOf(page) : -1;
    const hasSelectedComponent = Boolean(getSelectedComponent());

    if (appendBtn) appendBtn.disabled = busy || !has;
    if (rotateCcwBtn) rotateCcwBtn.disabled = busy || !has;
    if (rotateCwBtn) rotateCwBtn.disabled = busy || !has;
    if (moveUpBtn) moveUpBtn.disabled = busy || !has || currentIndex <= 0;
    if (moveDownBtn) moveDownBtn.disabled = busy || !has || currentIndex < 0 || currentIndex >= pages.length - 1;
    if (duplicateBtn) duplicateBtn.disabled = busy || !has || pages.length + Math.max(1, selectedCount) > PDF_EDITOR_LIMITS.maxPages;
    if (blankPageBtn) blankPageBtn.disabled = busy || pages.length >= PDF_EDITOR_LIMITS.maxPages;
    if (newDocumentBtn) newDocumentBtn.disabled = busy;
    if (selectAllBtn) selectAllBtn.disabled = busy || !has || selectedCount === pages.length;
    if (invertSelectionBtn) invertSelectionBtn.disabled = busy || !has;
    if (deleteBtn) deleteBtn.disabled = busy || !has || (!hasSelectedComponent && pages.length <= 1);
    if (extractBtn) extractBtn.disabled = busy || !has;
    if (replaceBtn) replaceBtn.disabled = busy;
    if (exportBtn) exportBtn.disabled = busy || !has;

    const sourceRotationKnown = !page || page.sourceRotation == null || Number.isFinite(Number(page.sourceRotation));
    const contentEditingAllowed = has && sourceRotationKnown && pageSupportsContentEditing(page);
    const insertionAllowed = has && sourceRotationKnown && pageSupportsInsertion(page);
    if (editTextBtn) editTextBtn.disabled = busy || !contentEditingAllowed;
    if (editTextSidebarBtn) editTextSidebarBtn.disabled = busy || !contentEditingAllowed;
    if (insertTextBtn) insertTextBtn.disabled = busy || !insertionAllowed;
    if (insertImageBtn) insertImageBtn.disabled = busy || !insertionAllowed;
    for (const button of [insertRectBtn, insertEllipseBtn, insertLineBtn]) {
      if (button) button.disabled = busy || !insertionAllowed;
    }
    if (selectComponentBtn) {
      selectComponentBtn.disabled = busy || !has;
      selectComponentBtn.classList.toggle('is-active', getComponentMode());
      selectComponentBtn.setAttribute('aria-pressed', String(getComponentMode()));
    }
    if (resetBtn) resetBtn.disabled = busy || !has || !getBaselineSnapshot();
    if (undoBtn) undoBtn.disabled = busy || !has || !canUndo();
    if (redoBtn) redoBtn.disabled = busy || !has || !canRedo();

    if (selectedCountEl) {
      selectedCountEl.textContent = selectedCount > 0
        ? t('home.pdfEditor.selectedCount', { count: selectedCount })
        : '';
    }
    if (pageIndicator) {
      pageIndicator.textContent = has
        ? t('home.pdfEditor.pageIndicator', { current: currentIndex + 1, total: pages.length })
        : '';
    }
    if (footerHint) {
      footerHint.textContent = has
        ? t('home.pdfEditor.footerHint', { name: getMainSourceName() })
        : t('home.pdfEditor.footerEmptyHint');
    }
    for (const pageState of getPageStates().values()) {
      pageState.tile.classList.toggle('is-selected', selectedIds.has(pageState.id));
      pageState.selectButton.setAttribute('aria-pressed', String(selectedIds.has(pageState.id)));
    }
    updateZoomLabel();
    const inserting = Boolean(getInsertMode());
    for (const button of [insertTextBtn, insertImageBtn, insertRectBtn, insertEllipseBtn, insertLineBtn]) {
      if (button) button.classList.toggle('is-active', inserting && button.dataset.insertMode === getInsertMode());
    }
    if (editTextSidebarBtn) editTextSidebarBtn.classList.toggle('is-active', getEditMode());
    if (editTextBtn) {
      editTextBtn.classList.toggle('is-active', getEditMode());
      editTextBtn.setAttribute('aria-pressed', String(getEditMode()));
    }
  }

  let getBaselineSnapshot = () => null;
  let canUndo = () => false;
  let canRedo = () => false;

  function setHistoryState({ getBaseline, canUndo: nextCanUndo, canRedo: nextCanRedo } = {}) {
    getBaselineSnapshot = typeof getBaseline === 'function' ? getBaseline : getBaselineSnapshot;
    canUndo = typeof nextCanUndo === 'function' ? nextCanUndo : canUndo;
    canRedo = typeof nextCanRedo === 'function' ? nextCanRedo : canRedo;
  }

  return { updateControls, setHistoryState };
}
