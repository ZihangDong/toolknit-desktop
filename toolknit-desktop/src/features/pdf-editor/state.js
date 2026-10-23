/**
 * Owns PDF Editor snapshots and history-facing state transitions. The editor
 * data remains injected so this controller can restore state without knowing
 * about the DOM or PDF.js implementation details.
 */
export function createPdfEditorStateController({
  getSources = () => [],
  setSources = () => {},
  getSourceStore = () => new Map(),
  getPages = () => [],
  setPages = () => {},
  getSelectedIds = () => new Set(),
  setSelectedIds = () => {},
  getCurrentId = () => null,
  setCurrentId = () => {},
  getSelectionAnchorId = () => null,
  setSelectionAnchorId = () => {},
  getEditMode = () => false,
  setEditMode = () => {},
  getComponentMode = () => false,
  setComponentMode = () => {},
  getSelectedComponent = () => null,
  setSelectedComponent = () => {},
  getZoom = () => null,
  getIdCounter = () => 0,
  setIdCounter = () => {},
  getTextEdits = () => new Map(),
  setTextEdits = () => {},
  getInsertedTexts = () => [],
  setInsertedTexts = () => {},
  getInsertedImages = () => [],
  setInsertedImages = () => {},
  getInsertedImageStore = () => new Map(),
  getInsertedShapes = () => [],
  setInsertedShapes = () => {},
  setEditingLineKey = () => {},
  setModalMode = () => {},
  setInsertMode = () => {},
  getTextLinesCache = () => new Map(),
  resetComponentInteraction = () => {},
  clearPendingInsert = () => {},
  closeEditModal = () => {},
  editTextBtn = null,
  selectComponentBtn = null,
  syncEditModeClass = () => {},
  syncComponentModeClass = () => {},
  buildTiles = () => {},
  updateFileCard = () => {},
  updateZoomLabel = () => {},
  updateControls = () => {},
  compactComponent = value => value,
  cloneState = value => typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)),
  normalizeEditSnapshot: normalizeEdit = edit => edit,
  normalizeInsertedImageSnapshot: normalizeImage = image => image,
  normalizeInsertedShapeSnapshot: normalizeShape = shape => shape,
  hasDocument = () => false,
  getHistory = () => null,
  getSavedSnapshot = () => null,
  getBaselineSnapshot = () => null,
  t = key => key,
  confirm = () => true
} = {}) {
  function normalizeEditSnapshot(edit) {
    return normalizeEdit(edit);
  }

  function normalizeInsertedImageSnapshot(image) {
    return normalizeImage(image);
  }

  function normalizeInsertedShapeSnapshot(shape) {
    return normalizeShape(shape);
  }

  function restoreSelectedComponent(component) {
    const locator = compactComponent(component);
    const pages = getPages() || [];
    if (!locator || !pages.some(page => page.id === locator.pageId)) return null;
    if (locator.type === 'text') {
      const textEdits = getTextEdits() || new Map();
      const textLinesCache = getTextLinesCache() || new Map();
      const editSegment = textEdits.get(locator.key)?.segment;
      const line = textLinesCache.get(locator.pageId)?.lines?.[locator.lineIndex];
      const cachedSegment = Array.isArray(line?.segments) && line.segments.length
        ? line.segments[locator.segmentIndex] || null
        : locator.segmentIndex === 0
          ? line
          : null;
      const segment = editSegment || cachedSegment;
      return segment ? { ...locator, segment: cloneState(segment) } : null;
    }
    const collection = locator.type === 'inserted-text'
      ? getInsertedTexts()
      : locator.type === 'inserted-image'
        ? getInsertedImages()
        : getInsertedShapes();
    return (collection || []).some(item => item.id === locator.key) ? locator : null;
  }

  function captureEditorSnapshot() {
    const zoomState = getZoom()?.getState?.() || {};
    return cloneState({
      sourceIds: (getSources() || []).map(source => source.id),
      pages: (getPages() || []).map(({ sourceRotation: _sourceRotation, ...page }) => page),
      selectedIds: Array.from(getSelectedIds() || []),
      currentId: getCurrentId(),
      selectionAnchorId: getSelectionAnchorId(),
      editMode: Boolean(getEditMode()),
      componentMode: Boolean(getComponentMode()),
      selectedComponent: compactComponent(getSelectedComponent()),
      viewMode: zoomState.viewMode,
      zoomPercent: zoomState.zoomPercent,
      idCounter: getIdCounter(),
      textEdits: Array.from((getTextEdits() || new Map()).entries())
        .map(([key, value]) => [key, normalizeEditSnapshot(value)]),
      insertedTexts: getInsertedTexts() || [],
      insertedImages: (getInsertedImages() || []).map(normalizeInsertedImageSnapshot),
      insertedShapes: (getInsertedShapes() || []).map(normalizeInsertedShapeSnapshot)
    });
  }

  function applyEditorSnapshot(snapshot) {
    if (!snapshot) return;
    const history = getHistory();
    const apply = () => {
      if (Array.isArray(snapshot.sourceIds)) {
        const store = getSourceStore() || new Map();
        setSources(snapshot.sourceIds.map(id => store.get(id)).filter(Boolean));
      }
      setPages(cloneState(snapshot.pages || []));
      setSelectedIds(new Set(Array.isArray(snapshot.selectedIds) ? snapshot.selectedIds : []));
      setCurrentId(snapshot.currentId || null);
      setSelectionAnchorId(snapshot.selectionAnchorId || null);
      setEditMode(Boolean(snapshot.editMode));
      setComponentMode(Boolean(snapshot.componentMode));
      setSelectedComponent(null);
      getZoom()?.setState?.(snapshot);
      if (Number.isFinite(Number(snapshot.idCounter))) setIdCounter(Math.max(getIdCounter(), Number(snapshot.idCounter)));
      setTextEdits(new Map(
        (Array.isArray(snapshot.textEdits) ? snapshot.textEdits : [])
          .map(([key, value]) => [key, normalizeEditSnapshot(value)])
      ));
      setInsertedTexts(cloneState(snapshot.insertedTexts || []));
      const insertedImageStore = getInsertedImageStore() || new Map();
      for (const image of getInsertedImages() || []) {
        if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl);
      }
      setInsertedImages((Array.isArray(snapshot.insertedImages) ? snapshot.insertedImages : []).map(item => {
        const stored = insertedImageStore.get(item?.id);
        const bytes = stored?.bytes || item?.bytes;
        return {
          ...cloneState(item),
          bytes,
          previewUrl: bytes?.length
            ? URL.createObjectURL(new Blob([bytes], { type: item.mimeType || 'image/png' }))
            : ''
        };
      }));
      setInsertedShapes((Array.isArray(snapshot.insertedShapes) ? snapshot.insertedShapes : [])
        .map(item => normalizeInsertedShapeSnapshot(item)));
      setSelectedComponent(restoreSelectedComponent(snapshot.selectedComponent));
      resetComponentInteraction();
      setEditingLineKey(null);
      setModalMode(null);
      setInsertMode(null);
      clearPendingInsert();
      closeEditModal();
      if (editTextBtn) {
        editTextBtn.classList.toggle('is-active', Boolean(snapshot.editMode));
        editTextBtn.setAttribute('aria-pressed', String(Boolean(snapshot.editMode)));
      }
      if (selectComponentBtn) {
        selectComponentBtn.classList.toggle('is-active', Boolean(snapshot.componentMode));
        selectComponentBtn.setAttribute('aria-pressed', String(Boolean(snapshot.componentMode)));
      }
      syncEditModeClass();
      syncComponentModeClass();
      buildTiles();
      updateFileCard();
      updateZoomLabel();
      updateControls();
    };
    if (history?.withLock) history.withLock(apply); else apply();
  }

  let history = null;
  function imageAssetBytes() {
    const bytes = new Set([...getInsertedImageStore().values()].map(image => image.bytes).filter(Boolean));
    return [...bytes].reduce((sum, image) => sum + image.byteLength, 0);
  }
  function pruneImageAssets() {
    const retained = new Set((getInsertedImages() || []).map(image => image.id));
    const collect = snapshot => { for (const image of snapshot?.insertedImages || []) retained.add(image.id); };
    history?.forEachSnapshot(collect);
    collect(getBaselineSnapshot()); collect(getSavedSnapshot());
    const store = getInsertedImageStore();
    for (const id of store.keys()) if (!retained.has(id)) store.delete(id);
  }

  function setHistory(nextHistory) {
    history = nextHistory;
  }

  function resetEditorHistory() {
    return history?.reset();
  }

  function commitEditorHistory() {
    return history?.commit();
  }

  function canUndo() {
    return Boolean(history?.canUndo());
  }

  function canRedo() {
    return Boolean(history?.canRedo());
  }

  function undoEditorChange() {
    return history?.undo();
  }

  function redoEditorChange() {
    return history?.redo();
  }

  function hasUnsavedChanges() {
    if (hasDocument() && !getSavedSnapshot() && getSources().some(source => source.generated)) return true;
    return Boolean(history?.hasUnsavedChanges(getSavedSnapshot()));
  }

  function confirmDiscardChanges(action) {
    if (!hasUnsavedChanges()) return true;
    const messageKey = action === 'reset' ? 'confirmReset' : 'confirmDiscard';
    return confirm(t(`home.pdfEditor.${messageKey}`));
  }

  return {
    captureEditorSnapshot,
    applyEditorSnapshot,
    resetEditorHistory,
    commitEditorHistory,
    canUndo,
    canRedo,
    undoEditorChange,
    redoEditorChange,
    hasUnsavedChanges,
    confirmDiscardChanges,
    setHistory,
    cloneState,
    normalizeEditSnapshot,
    normalizeInsertedImageSnapshot,
    normalizeInsertedShapeSnapshot,
    restoreSelectedComponent,
    pruneImageAssets,
    imageAssetBytes
  };
}
