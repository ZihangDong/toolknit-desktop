import { pdfEditorPageIdsInDocumentOrder } from '../../pdf-editor-state.js';

/**
 * Owns current-page and page-selection state without rendering page content.
 * The editor orchestration layer supplies state accessors and visual callbacks
 * so selection behavior remains compatible with the existing thumbnail UI.
 */
export function createPdfEditorPageSelection({
  getPages = () => [],
  getCurrentId = () => null,
  setCurrentId = () => {},
  getSelectedIds = () => new Set(),
  setSelectedIds = () => {},
  getSelectionAnchorId = () => null,
  setSelectionAnchorId = () => {},
  getPageState = () => null,
  getActiveOperation = () => null,
  hasDocument = () => false,
  getSelectedComponent = () => null,
  clearSelectedComponent = () => {},
  updateControls = () => {},
  renderMainPreview = () => {}
} = {}) {
  function currentPage() {
    const pages = getPages() || [];
    const currentId = getCurrentId();
    return pages.find(page => page.id === currentId) || pages[0] || null;
  }

  function pageStateFor(id) {
    return getPageState(id);
  }

  function targetIds() {
    return pdfEditorPageIdsInDocumentOrder(getPages() || [], getSelectedIds() || new Set(), getCurrentId());
  }

  function selectOnly(pageState) {
    if (!pageState?.id) return;
    setSelectedIds(new Set([pageState.id]));
    setSelectionAnchorId(pageState.id);
    updateControls();
  }

  function toggleSelect(pageState) {
    if (!pageState?.id) return;
    const selectedIds = getSelectedIds() || new Set();
    const nextSelectedIds = new Set(selectedIds);
    if (nextSelectedIds.has(pageState.id)) {
      nextSelectedIds.delete(pageState.id);
      if (getSelectionAnchorId() === pageState.id) setSelectionAnchorId(null);
    } else {
      nextSelectedIds.add(pageState.id);
      setSelectionAnchorId(pageState.id);
    }
    setSelectedIds(nextSelectedIds);
    updateControls();
  }

  function selectRange(pageState) {
    if (!pageState?.id) return;
    const anchorId = getSelectionAnchorId();
    if (!anchorId || !pageStateFor(anchorId)) {
      selectOnly(pageState);
      return;
    }
    const pages = getPages() || [];
    const anchorIndex = pages.findIndex(page => page.id === anchorId);
    const targetIndex = pages.findIndex(page => page.id === pageState.id);
    if (anchorIndex < 0 || targetIndex < 0) return;
    const [start, end] = anchorIndex <= targetIndex
      ? [anchorIndex, targetIndex]
      : [targetIndex, anchorIndex];
    setSelectedIds(new Set(pages.slice(start, end + 1).map(page => page.id)));
    updateControls();
  }

  function selectAllPages() {
    if (getActiveOperation() || !hasDocument()) return;
    const pages = getPages() || [];
    setSelectedIds(new Set(pages.map(page => page.id)));
    setSelectionAnchorId(pages[0]?.id || null);
    updateControls();
  }

  function invertPageSelection() {
    if (getActiveOperation() || !hasDocument()) return;
    const selectedIds = getSelectedIds() || new Set();
    const pages = getPages() || [];
    setSelectedIds(new Set(pages.filter(page => !selectedIds.has(page.id)).map(page => page.id)));
    setSelectionAnchorId(getCurrentId());
    updateControls();
  }

  function setCurrent(pageState) {
    if (!pageState?.id) return;
    if (getCurrentId() === pageState.id) return;
    setCurrentId(pageState.id);
    const selectedComponent = getSelectedComponent();
    if (selectedComponent && selectedComponent.pageId !== pageState.id) {
      clearSelectedComponent();
    }
    updateControls();
    renderMainPreview();
  }

  return {
    currentPage,
    invertPageSelection,
    pageStateFor,
    selectAllPages,
    selectOnly,
    selectRange,
    setCurrent,
    targetIds,
    toggleSelect
  };
}
