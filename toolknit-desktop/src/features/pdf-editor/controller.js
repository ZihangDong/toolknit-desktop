import { tauriCorePromise, tauriEventPromise } from '../../platform/tauri-runtime.js';
import {
  PDF_EDITOR_LIMITS,
  normalizePageRotation,
  resolvePdfPageRotation
} from '../../pdf-editor-core.js';
import {
  compactPdfEditorComponent,
  pdfEditorSnapshotsEqual
} from '../../pdf-editor-state.js';
import { createPdfEditorHistory } from './history.js';
import { createPdfEditorFocusManager } from './focus.js';
import {
  isPdfEditorRenderCancellation as isRenderCancellation,
  releasePdfEditorCanvas as releaseCanvas
} from './render-utils.js';
import { createPdfEditorExporter } from './exporter.js';
import { createPdfEditorDocumentStore } from './documents.js';
import { createPdfEditorZoomController } from './zoom.js';
import { createPdfEditorComponentRenderer } from './component-renderer.js';
import { createPdfEditorComponentModel } from './component-model.js';
import { createPdfEditorComponentControls } from './component-controls.js';
import { createPdfEditorComponentInteraction } from './component-interaction.js';
import { createPdfEditorContentEditing } from './content-editing.js';
import { createPdfEditorFileSession } from './file-session.js';
import { createPdfEditorPageOperations } from './page-operations.js';
import { createPdfEditorPageSelection } from './page-selection.js';
import { createPdfEditorThumbnails } from './thumbnails.js';
import { createPdfEditorPreview } from './preview.js';
import { createPdfEditorView } from './view.js';
import { createPdfEditorOperationRuntime } from './operation.js';
import { createPdfEditorEvents } from './events.js';
import { createPdfEditorControls } from './controls.js';
import { createPdfEditorStateController } from './state.js';
import {
  buildTextLine,
  editedTextVisualBox,
  groupTextItemsIntoLines,
  insertedTextVisualBox
} from './text-layout.js';

const ZOOM_MIN = 0.08;
const ZOOM_MAX = 8;

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function hexToRgb01(hex) {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '').trim());
  if (!match) return [0, 0, 0];
  return [
    parseInt(match[1], 16) / 255,
    parseInt(match[2], 16) / 255,
    parseInt(match[3], 16) / 255
  ];
}

function rgb01ToHex(color) {
  const values = Array.isArray(color) ? color : [];
  const toHex = value => Math.round(clamp01(value) * 255).toString(16).padStart(2, '0');
  return `#${toHex(values[0] ?? 0)}${toHex(values[1] ?? 0)}${toHex(values[2] ?? 0)}`;
}

function rgb01ToCss(color, fallback = '#111111') {
  if (!Array.isArray(color) || color.length < 3) return fallback;
  return rgb01ToHex(color);
}

export function initPdfEditorTool({
  isTauri,
  t,
  onLangChange,
  pdfWorkerUrl,
  getOutputDir,
  displayFilesystemPath,
  initStandardToolPlasma,
  disposeStandardToolPlasma
}) {
  const overlay = document.getElementById('pdfEditorOverlay');
  const plasmaBg = document.getElementById('pdfEditorPlasmaBg');
  const back = document.getElementById('pdfEditorBack');
  const cta = document.getElementById('pdfEditorCta');
  const fileInput = document.getElementById('pdfEditorFileInput');
  const appendInput = document.getElementById('pdfEditorAppendInput');
  const imageInput = document.getElementById('pdfEditorImageInput');
  const dropZone = document.getElementById('pdfEditorDropZone');
  const fileNameEl = document.getElementById('pdfEditorFileName');
  const fileStatsEl = document.getElementById('pdfEditorFileStats');
  const appendBtn = document.getElementById('pdfEditorAppend');
  const rotateCcwBtn = document.getElementById('pdfEditorRotateCcw');
  const rotateCwBtn = document.getElementById('pdfEditorRotateCw');
  const moveUpBtn = document.getElementById('pdfEditorMoveUp');
  const moveDownBtn = document.getElementById('pdfEditorMoveDown');
  const duplicateBtn = document.getElementById('pdfEditorDuplicate');
  const blankPageBtn = document.getElementById('pdfEditorBlankPage');
  const deleteBtn = document.getElementById('pdfEditorDelete');
  const extractBtn = document.getElementById('pdfEditorExtract');
  const selectComponentBtn = document.getElementById('pdfEditorSelectComponent');
  const resetBtn = document.getElementById('pdfEditorReset');
  const undoBtn = document.getElementById('pdfEditorUndo');
  const redoBtn = document.getElementById('pdfEditorRedo');
  const pageStrip = document.getElementById('pdfEditorPageStrip');
  const selectedCountEl = document.getElementById('pdfEditorSelectedCount');
  const selectAllBtn = document.getElementById('pdfEditorSelectAll');
  const invertSelectionBtn = document.getElementById('pdfEditorInvertSelection');
  const pageIndicator = document.getElementById('pdfEditorPageIndicator');
  const zoomOutBtn = document.getElementById('pdfEditorZoomOut');
  const zoomValueBtn = document.getElementById('pdfEditorZoomValue');
  const zoomInBtn = document.getElementById('pdfEditorZoomIn');
  const fitWidthBtn = document.getElementById('pdfEditorFitWidth');
  const canvasScroll = document.getElementById('pdfEditorCanvasScroll');
  const canvasStage = document.getElementById('pdfEditorCanvasStage');
  const emptyState = document.getElementById('pdfEditorEmpty');
  const footerHint = document.getElementById('pdfEditorFooterHint');
  const replaceBtn = document.getElementById('pdfEditorReplace');
  const exportBtn = document.getElementById('pdfEditorExport');
  const processMask = document.getElementById('pdfEditorProcessMask');
  const processBarFill = document.getElementById('pdfEditorProcessBarFill');
  const processValue = document.getElementById('pdfEditorProcessValue');
  const processText = document.getElementById('pdfEditorProcessText');
  const processCancel = document.getElementById('pdfEditorCancel');
  const successOverlay = document.getElementById('pdfEditorSuccessOverlay');
  const successMeta = document.getElementById('pdfEditorSuccessMeta');
  const successPath = document.getElementById('pdfEditorSuccessPath');
  const successOpenFolder = document.getElementById('pdfEditorSuccessOpenFolder');
  const successOk = document.getElementById('pdfEditorSuccessOk');
  const editTextBtn = document.getElementById('pdfEditorEditText');
  const editModal = document.getElementById('pdfEditorEditModal');
  const editModalOriginal = document.getElementById('pdfEditorEditOriginal');
  const editModalInput = document.getElementById('pdfEditorEditInput');
  const editSecurityNote = document.getElementById('pdfEditorEditSecurityNote');
  const editModalSave = document.getElementById('pdfEditorEditSave');
  const editModalCancel = document.getElementById('pdfEditorEditCancel');
  const editModalClose = document.getElementById('pdfEditorEditClose');
  const editModalTitle = document.getElementById('pdfEditorEditTitle');
  const editModalOriginalLabel = document.getElementById('pdfEditorEditOriginalLabel');
  const editModalNewLabel = document.getElementById('pdfEditorEditNewLabel');
  const editTextSidebarBtn = document.getElementById('pdfEditorEditTextSidebar');
  const insertTextBtn = document.getElementById('pdfEditorInsertText');
  const insertImageBtn = document.getElementById('pdfEditorInsertImage');
  const insertRectBtn = document.getElementById('pdfEditorInsertRect');
  const insertEllipseBtn = document.getElementById('pdfEditorInsertEllipse');
  const insertLineBtn = document.getElementById('pdfEditorInsertLine');
  const componentMenu = document.getElementById('pdfEditorComponentMenu');
  const componentScaleDownBtn = document.getElementById('pdfEditorComponentScaleDown');
  const componentScaleUpBtn = document.getElementById('pdfEditorComponentScaleUp');
  const componentEditBtn = document.getElementById('pdfEditorComponentEdit');
  const componentRotateBtn = document.getElementById('pdfEditorComponentRotate');
  const componentDeleteBtn = document.getElementById('pdfEditorComponentDelete');
  const shapePanel = document.getElementById('pdfEditorShapePanel');
  const shapeFillField = document.getElementById('pdfEditorShapeFillField');
  const shapeFillInput = document.getElementById('pdfEditorShapeFill');
  const shapeStrokeInput = document.getElementById('pdfEditorShapeStroke');
  const shapeStrokeWidth = document.getElementById('pdfEditorShapeStrokeWidth');

  if (!overlay || !pageStrip || !canvasStage) return { dispose() {} };

  const listenerController = new AbortController();
  const listenerOptions = { signal: listenerController.signal };
  let sources = [];
  // Keep immutable source objects available while undo/redo switches the
  // active page list. History stores only ids, so large PDF byte arrays are
  // not cloned into every snapshot.
  let sourceStore = new Map();
  let pages = [];
  let selectedIds = new Set();
  let currentId = null;
  let selectionAnchorId = null;
  let mainCanvas = null;
  let mainRenderTask = null;
  let mainEpoch = 0;
  let lastRenderScale = 1;
  let idCounter = 0;
  let disposed = false;
  let unsubscribeLangChange = () => {};
  let canvasWrap = null;
  let textLayerEl = null;
  let editMode = false;
  let componentMode = false;
  let insertMode = null;
  let pendingInsert = null;
  let textLinesCache = new Map();
  let textEdits = new Map();
  let insertedTexts = [];
  let insertedImages = [];
  // Image bytes are immutable while an editor session is open. Keep one
  // backing copy and let history snapshots retain only layout metadata.
  let insertedImageStore = new Map();
  let insertedShapes = [];
  let selectedComponent = null;
  let componentInteraction = null;
  let contentEditing = null;
  let fileSession = null;
  let pageOperations = null;
  let pageSelection = null;
  let componentRenderFrame = 0;
  let componentControls = null;
  let preview = null;
  let fitResizeObserver = null;
  let fitResizeFrame = 0;
  let editingLineKey = null;
  let modalMode = null;
  let baselineSnapshot = null;
  let savedSnapshot = null;
  let pdfEditorView = null;
  let operationRuntime = null;
  let pdfEditorEvents = null;
  let pdfEditorControls = null;
  let pdfEditorState = null;
  let editorHistory = null;
  const showToast = (message, duration = 7000) => {
    if (!disposed) window.showToast?.(message, { duration, dismissible: true });
  };

  const {
    activeFocusRoots,
    canReceiveFocus,
    focusedElement,
    restoreFocus,
    trapFocus
  } = createPdfEditorFocusManager({
    overlay,
    processMask,
    successOverlay,
    editModal,
    isDisposed: () => disposed
  });

  const getInvoke = async () => {
    const { invoke } = await tauriCorePromise;
    return invoke;
  };

  const cloneFallback = value => typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));

  function cloneState(value) {
    return pdfEditorState?.cloneState?.(value) ?? cloneFallback(value);
  }

  function normalizeEditSnapshot(edit) {
    if (!edit) return null;
    return {
      newText: String(edit.newText ?? ''),
      segment: edit.segment ? cloneState(edit.segment) : null,
      baseSegment: edit.baseSegment ? cloneState(edit.baseSegment) : null
    };
  }

  function normalizeInsertedImageSnapshot(object) {
    if (!object) return null;
    return {
      id: object.id,
      pageId: object.pageId,
      x: Number(object.x) || 0,
      y: Number(object.y) || 0,
      width: Number(object.width) || 0,
      height: Number(object.height) || 0,
      rotation: Number(object.rotation) || 0,
      mimeType: object.mimeType || '',
      previewUrl: ''
    };
  }

  function clearPendingInsert() {
    if (pendingInsert?.previewUrl) URL.revokeObjectURL(pendingInsert.previewUrl);
    pendingInsert = null;
  }

  function normalizeInsertedShapeSnapshot(object) {
    if (!object) return null;
    return {
      id: object.id,
      pageId: object.pageId,
      shapeType: ['rect', 'ellipse', 'line'].includes(object.shapeType) ? object.shapeType : 'rect',
      x: Number(object.x) || 0,
      y: Number(object.y) || 0,
      width: Number(object.width) || 0,
      height: Number(object.height) || 0,
      rotation: Number(object.rotation) || 0,
      fill: Array.isArray(object.fill) ? object.fill.map(clamp01) : null,
      stroke: Array.isArray(object.stroke) ? object.stroke.map(clamp01) : [0, 0, 0],
      strokeWidth: Math.max(0, Number(object.strokeWidth) || 0)
    };
  }

  function restoreSelectedComponent(component) {
    return pdfEditorState?.restoreSelectedComponent(component) || null;
  }

  function captureEditorSnapshot() {
    return pdfEditorState?.captureEditorSnapshot?.() || null;
  }

  function applyEditorSnapshot(snapshot) {
    return pdfEditorState?.applyEditorSnapshot(snapshot);
  }

  pdfEditorState = createPdfEditorStateController({
    getSources: () => sources,
    setSources: value => { sources = value; },
    getSourceStore: () => sourceStore,
    getPages: () => pages,
    setPages: value => { pages = value; },
    getSelectedIds: () => selectedIds,
    setSelectedIds: value => { selectedIds = value; },
    getCurrentId: () => currentId,
    setCurrentId: value => { currentId = value; },
    getSelectionAnchorId: () => selectionAnchorId,
    setSelectionAnchorId: value => { selectionAnchorId = value; },
    getEditMode: () => editMode,
    setEditMode: value => { editMode = Boolean(value); },
    getComponentMode: () => componentMode,
    setComponentMode: value => { componentMode = Boolean(value); },
    getSelectedComponent: () => selectedComponent,
    setSelectedComponent: value => { selectedComponent = value; },
    getZoom: () => zoom,
    getIdCounter: () => idCounter,
    setIdCounter: value => { idCounter = value; },
    getTextEdits: () => textEdits,
    setTextEdits: value => { textEdits = value; },
    getInsertedTexts: () => insertedTexts,
    setInsertedTexts: value => { insertedTexts = value; },
    getInsertedImages: () => insertedImages,
    setInsertedImages: value => { insertedImages = value; },
    getInsertedImageStore: () => insertedImageStore,
    getInsertedShapes: () => insertedShapes,
    setInsertedShapes: value => { insertedShapes = value; },
    setEditingLineKey: value => { editingLineKey = value; },
    setModalMode: value => { modalMode = value; },
    setInsertMode: value => { insertMode = value; },
    getTextLinesCache: () => textLinesCache,
    resetComponentInteraction: () => componentInteraction?.reset(),
    clearPendingInsert,
    closeEditModal,
    editTextBtn,
    selectComponentBtn,
    syncEditModeClass,
    syncComponentModeClass,
    buildTiles,
    updateFileCard,
    updateZoomLabel,
    updateControls,
    compactComponent: compactPdfEditorComponent,
    normalizeEditSnapshot,
    normalizeInsertedImageSnapshot,
    normalizeInsertedShapeSnapshot,
    hasDocument,
    getSavedSnapshot: () => savedSnapshot,
    t,
    confirm: message => window.confirm(message)
  });

  editorHistory = createPdfEditorHistory({
    capture: captureEditorSnapshot,
    apply: applyEditorSnapshot,
    equals: pdfEditorSnapshotsEqual,
    hasDocument,
    onChange: () => updateControls()
  });
  pdfEditorState.setHistory(editorHistory);

  function resetEditorHistory() {
    return pdfEditorState.resetEditorHistory();
  }

  function commitEditorHistory() {
    return pdfEditorState.commitEditorHistory();
  }

  function hasUnsavedChanges() {
    return pdfEditorState.hasUnsavedChanges();
  }

  function confirmDiscardChanges(action) {
    return pdfEditorState.confirmDiscardChanges(action);
  }

  function canUndo() {
    return pdfEditorState.canUndo();
  }

  function canRedo() {
    return pdfEditorState.canRedo();
  }

  function undoEditorChange() {
    return pdfEditorState.undoEditorChange();
  }

  function redoEditorChange() {
    return pdfEditorState.redoEditorChange();
  }

  function handleDocumentKeydown(event) {
    if (disposed) return;
    // Settings and its nested dialogs sit above the PDF editor. Keep editor
    // shortcuts from mutating the document while that higher-level surface is
    // active (for example, Delete or Ctrl+Z in a settings field).
    if (document.getElementById('settingsOverlay')?.classList.contains('visible')) return;
    const roots = activeFocusRoots();
    if (!roots.length) return;
    const active = focusedElement();
    const isTypingField = Boolean(active
      && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable));
    if (event.key === 'Tab') {
      trapFocus(event, roots);
      return;
    }
    if (!isTypingField && (event.ctrlKey || event.metaKey)) {
      const key = String(event.key || '').toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) redoEditorChange(); else undoEditorChange();
        return;
      }
      if (key === 'y') {
        event.preventDefault();
        event.stopPropagation();
        redoEditorChange();
        return;
      }
    }
    if (!isTypingField && (event.key === 'Delete' || event.key === 'Backspace')) {
      if (selectedComponent || selectedIds.size) {
        event.preventDefault();
        event.stopPropagation();
        deleteSelected();
        return;
      }
    }
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (successOverlay?.classList.contains('visible')) {
      closeSuccess();
    } else if (processMask?.classList.contains('visible')) {
      if (!processCancel?.disabled) void cancelActiveOperation();
    } else if (editModal?.classList.contains('visible')) {
      handleEditModalCancel();
    } else if (selectedComponent) {
      clearSelectedComponent();
    } else if (componentMode) {
      setComponentMode(false);
    } else {
      closeOverlay();
    }
  }

  function scheduleComponentVisualRefresh() {
    if (disposed || componentRenderFrame) return;
    componentRenderFrame = requestAnimationFrame(() => {
      componentRenderFrame = 0;
      if (disposed) return;
      syncComponentModeClass();
      updateControls();
      refreshCurrentTextLayer();
    });
  }

  function flushComponentVisualRefresh() {
    if (componentRenderFrame) {
      cancelAnimationFrame(componentRenderFrame);
      componentRenderFrame = 0;
    }
    if (disposed) return;
    syncComponentModeClass();
    updateControls();
    refreshCurrentTextLayer();
  }

  function scheduleFitPreview() {
    if (disposed || !overlay.classList.contains('visible') || zoom.getState().viewMode !== 'fit' || !hasDocument()) return;
    if (fitResizeFrame) return;
    fitResizeFrame = requestAnimationFrame(() => {
      fitResizeFrame = 0;
      if (!disposed && overlay.classList.contains('visible') && zoom.getState().viewMode === 'fit' && hasDocument()) {
        renderMainPreview();
      }
    });
  }

  function stopFitPreviewObserver() {
    fitResizeObserver?.disconnect();
    fitResizeObserver = null;
    if (fitResizeFrame) {
      cancelAnimationFrame(fitResizeFrame);
      fitResizeFrame = 0;
    }
  }

  function syncInteractiveLayers() {
    const overlayVisible = overlay.classList.contains('visible');
    const processVisible = processMask?.classList.contains('visible') || false;
    const successVisible = successOverlay?.classList.contains('visible') || false;
    const editVisible = editModal?.classList.contains('visible') || false;
    const processInteractive = overlayVisible && processVisible && !successVisible;
    const successInteractive = overlayVisible && successVisible;
    const overlayInteractive = overlayVisible && !processVisible && !successVisible;
    overlay.inert = overlayVisible ? !overlayInteractive : false;
    overlay.setAttribute('aria-hidden', String(!overlayVisible));
    if (processMask) {
      processMask.inert = !processInteractive;
      processMask.setAttribute('aria-hidden', String(!processVisible));
    }
    if (successOverlay) {
      successOverlay.inert = !successInteractive;
      successOverlay.setAttribute('aria-hidden', String(!successVisible));
    }
    if (editModal) {
      editModal.inert = !editVisible;
      editModal.setAttribute('aria-hidden', String(!editVisible));
    }
  }

  function hasDocument() {
    return sources.length > 0 && pages.length > 0;
  }

  function currentPage() {
    return pageSelection?.currentPage() || null;
  }

  function cacheSourceRotation(model, pdfPage) {
    if (!model || !pdfPage) return;
    model.sourceRotation = normalizePageRotation(pdfPage.rotate);
  }

  function effectivePageRotation(model) {
    if (!model) return null;
    // A freshly committed page has not been inspected by PDF.js yet. Treat
    // that short window as an unrotated page so editing controls do not stay
    // disabled while the first preview is painting; the cached source rotation
    // still takes precedence as soon as it is known.
    return resolvePdfPageRotation(model.sourceRotation ?? 0, model.rotation);
  }

  function pageSupportsContentEditing(model) {
    return effectivePageRotation(model) === 0;
  }

  function pageSupportsInsertion(model) {
    return model && Number.isFinite(effectivePageRotation(model));
  }

  function pageStateFor(id) {
    return pageSelection?.pageStateFor(id) || null;
  }

  function targetIds() {
    return pageSelection?.targetIds() || [];
  }

  function mainSourceName() {
    return sources[0]?.name || 'document.pdf';
  }

  function formatSize(size) {
    const bytes = Number(size) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function currentOperation() {
    return operationRuntime?.getActiveOperation?.() || null;
  }

  function setProgress(percent, message) {
    return operationRuntime?.setProgress(percent, message);
  }

  function setLocalizedProgress(percent, key, params = {}) {
    return operationRuntime?.setLocalizedProgress(percent, key, params);
  }

  function showProcess(key, percent = 0, params = {}) {
    return operationRuntime?.showProcess(key, percent, params);
  }

  function hideProcess() {
    return operationRuntime?.hideProcess();
  }

  function beginOperation(type) {
    return operationRuntime?.beginOperation(type);
  }

  function assertOperation(operation) {
    return operationRuntime?.assertOperation(operation);
  }

  function endOperation(operation) {
    return operationRuntime?.endOperation(operation);
  }

  async function cancelActiveOperation() {
    return operationRuntime?.cancelActiveOperation();
  }

  function messageForError(error, phase) {
    return operationRuntime?.messageForError(error, phase);
  }

  async function fileSizeFor(file) {
    return operationRuntime?.fileSizeFor(file);
  }

  async function readBytes(file) {
    return operationRuntime?.readBytes(file);
  }

  function openOverlay() {
    return pdfEditorView?.openOverlay();
  }

  function closeOverlay() {
    return pdfEditorView?.closeOverlay();
  }

  function showDropZone() {
    return pdfEditorView?.showDropZone();
  }

  function hideDropZone() {
    return pdfEditorView?.hideDropZone();
  }

  function closeSuccess(restore = true) {
    return pdfEditorView?.closeSuccess(restore);
  }

  function renderSuccess() {
    return pdfEditorView?.renderSuccess();
  }

  function showSuccess(result, returnFocus) {
    return pdfEditorView?.showSuccess(result, returnFocus);
  }

  async function resetDocument() {
    stopTileObserver(true);
    cancelMainRender();
    zoom.reset();
    if (componentRenderFrame) {
      cancelAnimationFrame(componentRenderFrame);
      componentRenderFrame = 0;
    }
    componentInteraction?.reset();
    closeEditModal();
    editMode = false;
    componentMode = false;
    if (editTextBtn) {
      editTextBtn.classList.remove('is-active');
      editTextBtn.setAttribute('aria-pressed', 'false');
    }
    if (selectComponentBtn) {
      selectComponentBtn.classList.remove('is-active');
      selectComponentBtn.setAttribute('aria-pressed', 'false');
    }
    syncEditModeClass();
    syncComponentModeClass();
    insertMode = null;
    clearPendingInsert();
    editingLineKey = null;
    textEdits = new Map();
    insertedTexts = [];
    for (const image of insertedImages) {
      if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
    }
    insertedImages = [];
    insertedImageStore.clear();
    insertedShapes = [];
    textLinesCache = new Map();
    if (editTextBtn) {
      editTextBtn.classList.remove('is-active');
      editTextBtn.setAttribute('aria-pressed', 'false');
    }
    syncEditModeClass();
    await documents.destroyAll();
    if (mainCanvas) {
      releaseCanvas(mainCanvas);
      mainCanvas = null;
    }
    if (canvasWrap) {
      canvasWrap.style.width = '';
      canvasWrap.style.height = '';
    }
    sources = [];
    sourceStore.clear();
    pages = [];
    selectedIds = new Set();
    currentId = null;
    selectionAnchorId = null;
    thumbnails.clear();
    selectedComponent = null;
    componentInteraction?.reset();
    editorHistory.clear();
    baselineSnapshot = null;
    savedSnapshot = null;
    updateFileCard();
    updateControls();
    syncStageVisibility();
  }

  function updateFileCard() {
    return pdfEditorView?.updateFileCard();
  }

  function syncStageVisibility() {
    return pdfEditorView?.syncStageVisibility();
  }

  function updateZoomLabel() {
    return pdfEditorView?.updateZoomLabel();
  }

  function updateControls() {
    return pdfEditorControls?.updateControls();
  }

  function selectOnly(pageState) {
    return pageSelection?.selectOnly(pageState);
  }

  function toggleSelect(pageState) {
    return pageSelection?.toggleSelect(pageState);
  }

  function selectRange(pageState) {
    return pageSelection?.selectRange(pageState);
  }

  function selectAllPages() {
    return pageSelection?.selectAllPages();
  }

  function invertPageSelection() {
    return pageSelection?.invertPageSelection();
  }

  function setCurrent(pageState) {
    return pageSelection?.setCurrent(pageState);
  }

  const documents = createPdfEditorDocumentStore({
    pdfWorkerUrl,
    getSources: () => sources,
    isDisposed: () => disposed
  });

  // ----- Thumbnail rendering -----
  function getSourceDoc(sourceId) {
    return documents.get(sourceId);
  }

  const thumbnails = createPdfEditorThumbnails({
    pageStrip,
    t,
    listenerOptions,
    getPages: () => pages,
    setPages: nextPages => { pages = nextPages; },
    getSelectedIds: () => selectedIds,
    getCurrentId: () => currentId,
    setCurrentId: nextId => { currentId = nextId; },
    getActiveOperation: currentOperation,
    isDisposed: () => disposed,
    hasDocument,
    cacheSourceRotation,
    effectivePageRotation,
    getSourceDoc,
    toggleSelect,
    selectRange,
    selectOnly,
    setCurrent,
    updateControls,
    renderMainPreview,
    commitEditorHistory
  });

  pageSelection = createPdfEditorPageSelection({
    getPages: () => pages,
    getCurrentId: () => currentId,
    setCurrentId: value => { currentId = value; },
    getSelectedIds: () => selectedIds,
    setSelectedIds: value => { selectedIds = value; },
    getSelectionAnchorId: () => selectionAnchorId,
    setSelectionAnchorId: value => { selectionAnchorId = value; },
    getPageState: id => thumbnails.getPageState(id),
    getActiveOperation: currentOperation,
    hasDocument,
    getSelectedComponent: () => selectedComponent,
    clearSelectedComponent,
    updateControls,
    renderMainPreview
  });

  pdfEditorControls = createPdfEditorControls({
    appendBtn,
    rotateCcwBtn,
    rotateCwBtn,
    moveUpBtn,
    moveDownBtn,
    duplicateBtn,
    blankPageBtn,
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
    t,
    getActiveOperation: currentOperation,
    hasDocument,
    getPages: () => pages,
    getSelectedIds: () => selectedIds,
    getCurrentPage: currentPage,
    pageSupportsContentEditing,
    pageSupportsInsertion,
    getSelectedComponent: () => selectedComponent,
    getComponentMode: () => componentMode,
    getEditMode: () => editMode,
    getInsertMode: () => insertMode,
    getMainSourceName: mainSourceName,
    getPageStates: () => thumbnails.getPageStates(),
    updateZoomLabel
  });
  pdfEditorControls.setHistoryState({
    getBaseline: () => baselineSnapshot,
    canUndo,
    canRedo
  });

  fileSession = createPdfEditorFileSession({
    isTauri,
    documentRef: document,
    windowRef: window,
    fileInput,
    appendInput,
    pageStrip,
    t,
    isDisposed: () => disposed,
    getActiveOperation: currentOperation,
    getIdCounter: () => idCounter,
    setIdCounter: value => { idCounter = value; },
    getSources: () => sources,
    setSources: value => { sources = value; },
    getPages: () => pages,
    setPages: value => { pages = value; },
    getSourceStore: () => sourceStore,
    setSourceStore: value => { sourceStore = value; },
    setCurrentId: value => { currentId = value; },
    setSelectedIds: value => { selectedIds = value; },
    setSelectionAnchorId: value => { selectionAnchorId = value; },
    getDocuments: () => documents,
    hasDocument,
    confirmDiscardChanges,
    resetDocument,
    fileSizeFor,
    readBytes,
    beginOperation,
    assertOperation,
    endOperation,
    showProcess,
    setLocalizedProgress,
    buildTiles,
    updateFileCard,
    syncStageVisibility,
    renderMainPreview,
    updateControls,
    resetEditorHistory,
    setBaselineSnapshot: value => { baselineSnapshot = value; },
    setSavedSnapshot: value => { savedSnapshot = value; },
    editorHistoryFirstSnapshot: () => editorHistory.firstSnapshot(),
    cloneState,
    messageForError,
    commitEditorHistory,
    showToast
  });

  function buildTiles(shouldRender = true) {
    return thumbnails.build(shouldRender);
  }

  function stopTileObserver(releaseAll = false) {
    return thumbnails.stop(releaseAll);
  }

  function refreshTile(pageState) {
    return thumbnails.refresh(pageState);
  }

  function releasePreview(pageState, markReleased = true) {
    return thumbnails.releasePreview(pageState, markReleased);
  }

  // ----- Main preview -----
  function cancelMainRender() {
    return preview?.cancel();
  }

  function syncTextLayerAccessibility() {
    return componentRenderer.syncTextLayerAccessibility();
  }

  function applyRelativeViewportRect(element, rect, parentRect) {
    return componentRenderer.applyRelativeViewportRect(element, rect, parentRect);
  }

  function ensureTextMask(lineElement, key, sourceBox, lineBox, cssViewport, rotation = 0, rotationBox = sourceBox) {
    return componentRenderer.ensureTextMask(lineElement, key, sourceBox, lineBox, cssViewport, rotation, rotationBox);
  }

  function renderTextLayer(lines, cssViewport, scale, pageId) {
    return componentRenderer.render(lines, cssViewport, scale, pageId);
  }

  function handleCanvasBackgroundClick(event) {
    if (!componentMode || insertMode) return;
    if (event.target === mainCanvas || event.target === canvasWrap || event.target === textLayerEl) {
      clearSelectedComponent();
    }
  }

  function currentTextLayerCache() {
    const page = currentPage();
    return page ? textLinesCache.get(page.id) : null;
  }

  function handleCanvasPlacement(event) {
    return contentEditing?.handleCanvasPlacement(event);
  }


  function syncEditModeClass() {
    if (textLayerEl) {
      textLayerEl.classList.toggle('is-edit-mode', editMode);
      textLayerEl.classList.toggle('is-insert-mode', Boolean(insertMode));
    }
    syncTextLayerAccessibility();
  }

  function syncComponentModeClass() {
    if (textLayerEl) textLayerEl.classList.toggle('is-object-mode', componentMode);
    syncTextLayerAccessibility();
    syncComponentMenu();
  }

  function refreshCurrentTextLayer() {
    const page = currentPage();
    const cache = page ? textLinesCache.get(page.id) : null;
    if (page && cache) {
      renderTextLayer(cache.lines, cache.cssViewport, cache.scale, page.id);
    } else if (hasDocument()) {
      renderMainPreview();
    }
  }

  function componentElementKey(component) {
    return componentModel.componentElementKey(component);
  }

  function sameComponent(left, right) {
    return componentModel.sameComponent(left, right);
  }

  function componentElement(component) {
    if (!textLayerEl || !component) return null;
    const key = componentElementKey(component);
    const candidates = textLayerEl.querySelectorAll('[data-segment-key]');
    for (const candidate of candidates) {
      if (candidate.dataset.segmentKey === key) return candidate;
    }
    return null;
  }

  function selectedComponentElement() {
    return componentElement(selectedComponent);
  }

  function resolveComponentObject(component) {
    return componentModel.resolveComponentObject(component);
  }

  function getComponentRotation(component) {
    return componentModel.getComponentRotation(component);
  }

  function snapRotationToAxis(rotationDeg, threshold = 6) {
    return componentModel.snapRotationToAxis(rotationDeg, threshold);
  }

  function setComponentRotation(component, rotationDeg) {
    return componentModel.setComponentRotation(component, rotationDeg);
  }

  function positionComponentMenu() {
    return componentControls?.positionComponentMenu();
  }

  function syncComponentMenu() {
    return componentControls?.syncComponentMenu();
  }

  function positionShapePanel() {
    return componentControls?.positionShapePanel();
  }

  function syncShapePanel() {
    return componentControls?.syncShapePanel();
  }

  function updateSelectedShapeProperty(property, value) {
    return componentControls?.updateSelectedShapeProperty(property, value);
  }

  function stopComponentRotate() {
    return componentInteraction?.stopComponentRotate();
  }

  function stopComponentPointerSession() {
    return componentInteraction?.stopComponentPointerSession();
  }

  function scaleSelectedComponent(factor) {
    return componentInteraction?.scaleSelectedComponent(factor);
  }

  function beginComponentRotate(event) {
    return componentInteraction?.beginComponentRotate(event);
  }

  function editSelectedComponent() {
    if (!selectedComponent || currentOperation()) return;
    if (selectedComponent.type === 'inserted-text') {
      const object = insertedTexts.find(item => item.id === selectedComponent.key);
      if (!object) {
        clearSelectedComponent();
        return;
      }
      openEditModal(object.id, object, object, 'edit-inserted-text');
      return;
    }
    if (selectedComponent.type !== 'text') return;
    const edit = textEdits.get(selectedComponent.key);
    const segment = edit?.segment || selectedComponent.segment;
    if (!segment) {
      clearSelectedComponent();
      return;
    }
    openEditModal(selectedComponent.key, segment, segment);
  }

  function setComponentMode(enabled) {
    const next = Boolean(enabled);
    if (next === componentMode) return;
    componentMode = next;
    if (componentMode) {
      editMode = false;
      insertMode = null;
      clearPendingInsert();
      closeEditModal();
    } else {
      selectedComponent = null;
      componentInteraction?.reset();
    }
    if (editTextBtn) {
      editTextBtn.classList.toggle('is-active', editMode);
      editTextBtn.setAttribute('aria-pressed', String(editMode));
    }
    if (selectComponentBtn) {
      selectComponentBtn.classList.toggle('is-active', componentMode);
      selectComponentBtn.setAttribute('aria-pressed', String(componentMode));
    }
    syncEditModeClass();
    syncComponentModeClass();
    updateControls();
    refreshCurrentTextLayer();
  }

  function selectComponent(component) {
    if (!component) return;
    const alreadySelected = sameComponent(selectedComponent, component);
    selectedComponent = cloneState(component);
    if (!componentMode) {
      setComponentMode(true);
      return;
    }
    if (alreadySelected) return;
    syncComponentModeClass();
    updateControls();
    refreshCurrentTextLayer();
  }

  function clearSelectedComponent() {
    if (!selectedComponent) return;
    selectedComponent = null;
    stopComponentRotate();
    syncComponentModeClass();
    updateControls();
    refreshCurrentTextLayer();
  }

  function editableComponentKey(component) {
    return componentModel.editableComponentKey(component);
  }

  function ensureTextEditEntry(component, segment) {
    return componentModel.ensureTextEditEntry(component, segment);
  }

  function sameTextSegmentLayout(a, b) {
    return componentModel.sameTextSegmentLayout(a, b);
  }

  function updateComponentFromDelta(
    deltaX,
    deltaY,
    deltaScale = 1,
    baseComponent = selectedComponent,
    { deferRender = false } = {}
  ) {
    return componentModel.updateComponentFromDelta(
      deltaX,
      deltaY,
      deltaScale,
      baseComponent,
      { deferRender }
    );
  }

  function componentBox(component, object) {
    return componentModel.componentBox(component, object);
  }

  function collectSnapTargets(pageId, excludeType, excludeKey) {
    return componentModel.collectSnapTargets(pageId, excludeType, excludeKey);
  }

  function snapAxisDelta(mine, targets, threshold) {
    return componentModel.snapAxisDelta(mine, targets, threshold);
  }

  function snapComponentDrag(component, dx, dy, snapTargets = null) {
    return componentModel.snapComponentDrag(component, dx, dy, snapTargets);
  }

  function shapeStrokeCss(strokeWidth, scale) {
    return componentControls?.shapeStrokeCss(strokeWidth, scale);
  }

  function buildShapeSvg(object, cssWidth, cssHeight, scale) {
    return componentControls?.buildShapeSvg(object, cssWidth, cssHeight, scale);
  }

  function appendResizeHandles(container, component, pageId, object) {
    return componentControls?.appendResizeHandles(container, component, pageId, object);
  }

  function applyComponentResize(component, baseObject, handle, localDx, localDy) {
    return componentInteraction?.applyComponentResize(component, baseObject, handle, localDx, localDy);
  }

  function applyComponentDomVisual(component) {
    return componentInteraction?.applyComponentDomVisual(component);
  }

  function beginComponentDrag(event, component) {
    return componentInteraction?.beginComponentDrag(event, component);
  }

  function beginComponentResize(event, component, handle = 'se') {
    return componentInteraction?.beginComponentResize(event, component, handle);
  }


  function setEditMode(enabled) {
    return contentEditing?.setEditMode(enabled);
  }

  function openEditModal(key, segment, fallbackSegment, mode = 'edit') {
    return contentEditing?.openEditModal(key, segment, fallbackSegment, mode);
  }

  function closeEditModal() {
    return contentEditing?.closeEditModal();
  }

  function cancelInsertMode() {
    return contentEditing?.cancelInsertMode();
  }

  function openInsertTextModal() {
    return contentEditing?.openInsertTextModal();
  }

  function chooseInsertImage() {
    return contentEditing?.chooseInsertImage();
  }

  function insertShape(shapeType) {
    return contentEditing?.insertShape(shapeType);
  }

  async function prepareInsertImage(file) {
    return contentEditing?.prepareInsertImage(file);
  }

  function saveEditModal() {
    return contentEditing?.saveEditModal();
  }

  function handleEditModalCancel() {
    return contentEditing?.handleEditModalCancel();
  }


  function renderMainPreview(zoomToken = zoom.getPreviewToken(), zoomRequest = null) {
    return preview?.render(zoomToken, zoomRequest);
  }

  const zoom = createPdfEditorZoomController({
    getCanvasWrap: () => canvasWrap,
    getCanvasScroll: () => canvasScroll,
    getSelectedComponent: () => selectedComponent,
    getLastRenderScale: () => lastRenderScale,
    setLastRenderScale: scale => { lastRenderScale = scale; },
    isDisposed: () => disposed,
    hasDocument,
    hasActiveOperation: () => Boolean(currentOperation()),
    updateZoomLabel,
    positionComponentMenu,
    renderMainPreview,
    listenerOptions
  });

  preview = createPdfEditorPreview({
    canvasStage,
    canvasScroll,
    getCanvasWrap: () => canvasWrap,
    setCanvasWrap: value => { canvasWrap = value; },
    getTextLayer: () => textLayerEl,
    setTextLayer: value => { textLayerEl = value; },
    getMainCanvas: () => mainCanvas,
    setMainCanvas: value => { mainCanvas = value; },
    getMainRenderTask: () => mainRenderTask,
    setMainRenderTask: value => { mainRenderTask = value; },
    getMainEpoch: () => mainEpoch,
    setMainEpoch: value => { mainEpoch = value; },
    getLastRenderScale: () => lastRenderScale,
    setLastRenderScale: value => { lastRenderScale = value; },
    getZoom: () => zoom,
    getCurrentPage: currentPage,
    hasDocument,
    getSourceDoc,
    cacheSourceRotation,
    effectivePageRotation,
    pageSupportsContentEditing,
    pageSupportsInsertion,
    getTextLinesCache: () => textLinesCache,
    setTextLinesCache: value => { textLinesCache = value; },
    getEditMode: () => editMode,
    setEditMode: value => setEditMode(value),
    isDisposed: () => disposed,
    renderTextLayer,
    handleCanvasPlacement,
    handleCanvasBackgroundClick,
    syncStageVisibility,
    updateControls,
    updateZoomLabel,
    groupTextItemsIntoLines,
    buildTextLine,
    listenerOptions,
    documentRef: document,
    windowRef: window,
    zoomMin: ZOOM_MIN,
    zoomMax: ZOOM_MAX
  });

  const componentModel = createPdfEditorComponentModel({
    getTextEdits: () => textEdits,
    getInsertedTexts: () => insertedTexts,
    getInsertedImages: () => insertedImages,
    getInsertedShapes: () => insertedShapes,
    getTextLinesCache: () => textLinesCache,
    getSelectedComponent: () => selectedComponent,
    setSelectedComponent: value => { selectedComponent = value; },
    cloneState,
    onChanged: ({ deferRender, component }) => {
      if (deferRender) {
        applyComponentDomVisual(component);
      } else {
        syncComponentModeClass();
        updateControls();
        refreshCurrentTextLayer();
      }
    }
  });

  componentControls = createPdfEditorComponentControls({
    componentMenu,
    componentEditBtn,
    shapePanel,
    shapeFillField,
    shapeFillInput,
    shapeStrokeInput,
    shapeStrokeWidth,
    canvasStage,
    documentRef: document,
    windowRef: window,
    listenerOptions,
    t,
    cloneState,
    getSelectedComponent: () => selectedComponent,
    getComponentMode: () => componentMode,
    hasDocument,
    componentElement,
    getInsertedShapes: () => insertedShapes,
    beginComponentResize,
    updateControls,
    refreshCurrentTextLayer
  });

  componentInteraction = createPdfEditorComponentInteraction({
    documentRef: document,
    getComponentMode: () => componentMode,
    getEditMode: () => editMode,
    getInsertMode: () => insertMode,
    getActiveOperation: currentOperation,
    hasDocument,
    getSelectedComponent: () => selectedComponent,
    getCurrentPage: currentPage,
    getCurrentTextLayerCache: currentTextLayerCache,
    getCanvasWrap: () => canvasWrap,
    getTextLayer: () => textLayerEl,
    getTextLinesCache: () => textLinesCache,
    getTextEdits: () => textEdits,
    getInsertedTexts: () => insertedTexts,
    getInsertedImages: () => insertedImages,
    getInsertedShapes: () => insertedShapes,
    cloneState,
    selectComponent,
    componentElement,
    resolveComponentObject,
    getComponentRotation,
    snapRotationToAxis,
    setComponentRotation,
    collectSnapTargets,
    snapComponentDrag,
    updateComponentFromDelta,
    applyRelativeViewportRect,
    ensureTextMask,
    buildShapeSvg,
    positionComponentMenu,
    flushComponentVisualRefresh,
    updateControls,
    commitEditorHistory,
    listenerOptions
  });

  contentEditing = createPdfEditorContentEditing({
    documentRef: document,
    windowRef: window,
    getCanvasWrap: () => canvasWrap,
    imageInput,
    editTextBtn,
    selectComponentBtn,
    editModal,
    editModalOriginal,
    editModalInput,
    editSecurityNote,
    editModalTitle,
    editModalOriginalLabel,
    editModalNewLabel,
    t,
    listenerOptions,
    getEditMode: () => editMode,
    setEditModeState: value => { editMode = Boolean(value); },
    getComponentMode: () => componentMode,
    setComponentModeState: value => { componentMode = Boolean(value); },
    getInsertMode: () => insertMode,
    setInsertMode: value => { insertMode = value; },
    getPendingInsert: () => pendingInsert,
    setPendingInsert: value => { pendingInsert = value; },
    getEditingLineKey: () => editingLineKey,
    setEditingLineKey: value => { editingLineKey = value; },
    getModalMode: () => modalMode,
    setModalMode: value => { modalMode = value; },
    getSelectedComponent: () => selectedComponent,
    setSelectedComponent: value => { selectedComponent = value; },
    getTextEdits: () => textEdits,
    getTextLinesCache: () => textLinesCache,
    getInsertedTexts: () => insertedTexts,
    setInsertedTexts: value => { insertedTexts = value; },
    getInsertedImages: () => insertedImages,
    setInsertedImages: value => { insertedImages = value; },
    getInsertedShapes: () => insertedShapes,
    setInsertedShapes: value => { insertedShapes = value; },
    hasDocument,
    getCurrentPage: currentPage,
    getCurrentTextLayerCache: currentTextLayerCache,
    pageSupportsContentEditing,
    pageSupportsInsertion,
    getActiveOperation: currentOperation,
    nextId: type => `${type}-${++idCounter}`,
    storeInsertedImage: (id, value) => { insertedImageStore.set(id, value); },
    clearPendingInsert,
    closeSelectedComponent: clearSelectedComponent,
    setComponentMode,
    syncEditModeClass,
    syncComponentModeClass,
    syncInteractiveLayers,
    updateControls,
    renderMainPreview,
    refreshCurrentTextLayer,
    renderTextLayer,
    fileSizeFor,
    readBytes,
    cloneState,
    compactComponent: compactPdfEditorComponent,
    sameTextSegmentLayout,
    commitEditorHistory,
    showToast
  });

  pageOperations = createPdfEditorPageOperations({
    documentRef: document,
    t,
    getActiveOperation: currentOperation,
    getPages: () => pages,
    setPages: value => { pages = value; },
    getSources: () => sources,
    getSourceStore: () => sourceStore,
    getTextEdits: () => textEdits,
    getInsertedTexts: () => insertedTexts,
    setInsertedTexts: value => { insertedTexts = value; },
    getInsertedImages: () => insertedImages,
    setInsertedImages: value => { insertedImages = value; },
    getInsertedShapes: () => insertedShapes,
    setInsertedShapes: value => { insertedShapes = value; },
    getInsertedImageStore: () => insertedImageStore,
    getSelectedComponent: () => selectedComponent,
    getCurrentId: () => currentId,
    setCurrentId: value => { currentId = value; },
    getSelectedIds: () => selectedIds,
    setSelectedIds: value => { selectedIds = value; },
    getSelectionAnchorId: () => selectionAnchorId,
    setSelectionAnchorId: value => { selectionAnchorId = value; },
    getPageStrip: () => pageStrip,
    hasDocument,
    targetIds,
    currentPage,
    pageStateFor,
    refreshTile,
    renderMainPreview,
    updateControls,
    commitEditorHistory,
    showToast,
    clearSelectedComponent,
    ensureTextEditEntry,
    releasePreview,
    buildTiles,
    updateFileCard,
    beginOperation,
    assertOperation,
    endOperation,
    showProcess,
    setLocalizedProgress,
    getSourceDoc,
    cacheSourceRotation,
    effectivePageRotation,
    messageForError,
    nextId: type => `${type}-${++idCounter}`,
    cloneState,
    normalizeEditSnapshot,
    normalizeInsertedImageSnapshot,
    normalizeInsertedShapeSnapshot
  });

  const componentRenderer = createPdfEditorComponentRenderer({
    getTextLayer: () => textLayerEl,
    getEditMode: () => editMode,
    getComponentMode: () => componentMode,
    getInsertMode: () => insertMode,
    getSelectedComponent: () => selectedComponent,
    getTextEdits: () => textEdits,
    getInsertedTexts: () => insertedTexts,
    getInsertedImages: () => insertedImages,
    getInsertedShapes: () => insertedShapes,
    t,
    listenerOptions,
    selectComponent,
    handleCanvasPlacement,
    sameComponent,
    beginComponentDrag,
    beginComponentResize,
    appendResizeHandles,
    buildShapeSvg,
    syncComponentMenu
  });

  // ----- Load / append -----
  function loadMainFile(file) {
    return fileSession?.loadMainFile(file);
  }

  function appendPdfBytes(bytes, name, size) {
    return fileSession?.appendPdfBytes(bytes, name, size);
  }

  function chooseMainFile() {
    return fileSession?.chooseMainFile();
  }

  function chooseAppendFile() {
    return fileSession?.chooseAppendFile();
  }

  // ----- Page operations -----
  function rotateSelected(delta) {
    return pageOperations?.rotateSelected(delta);
  }

  function moveCurrent(direction) {
    return pageOperations?.moveCurrent(direction);
  }

  function duplicateSelectedPages() {
    return pageOperations?.duplicateSelectedPages();
  }

  async function insertBlankPage() {
    return pageOperations?.insertBlankPage();
  }

  function deleteSelected() {
    return pageOperations?.deleteSelected();
  }

  function resetEditorState() {
    if (currentOperation() || !hasDocument() || !baselineSnapshot) return;
    if (!confirmDiscardChanges('reset')) return;
    applyEditorSnapshot(baselineSnapshot);
    resetEditorHistory();
    baselineSnapshot = cloneState(editorHistory.firstSnapshot());
    savedSnapshot = cloneState(editorHistory.firstSnapshot());
  }

  operationRuntime = createPdfEditorOperationRuntime({
    isTauri,
    t,
    getInvoke,
    processMask,
    processBarFill,
    processValue,
    processText,
    processCancel,
    successOverlay,
    exportBtn,
    back,
    isDisposed: () => disposed,
    focusedElement,
    restoreFocus,
    canReceiveFocus,
    syncInteractiveLayers,
    updateControls,
    isRenderCancellation
  });

  pdfEditorView = createPdfEditorView({
    overlay,
    plasmaBg,
    dropZone,
    fileNameEl,
    fileStatsEl,
    emptyState,
    successOverlay,
    successMeta,
    successPath,
    successOpenFolder,
    successOk,
    zoomValueBtn,
    fileInput,
    appendInput,
    t,
    isTauri,
    isDisposed: () => disposed,
    initStandardToolPlasma,
    disposeStandardToolPlasma,
    displayFilesystemPath,
    getSources: () => sources,
    getPages: () => pages,
    getMainSourceName: mainSourceName,
    formatSize,
    getCanvasWrap: () => canvasWrap,
    getOpenFocusTarget: () => hasDocument() ? exportBtn : cta || back,
    getZoomState: () => zoom.getState(),
    getActiveOperation: currentOperation,
    hasDocument,
    confirmDiscardChanges,
    resetDocument,
    focusedElement,
    restoreFocus,
    canReceiveFocus,
    syncInteractiveLayers,
    showToast
  });

  const exporter = createPdfEditorExporter({
    isTauri,
    getInvoke,
    getOutputDir,
    t,
    isDisposed: () => disposed,
    hasDocument,
    getActiveOperation: currentOperation,
    getSources: () => sources,
    getPages: () => pages,
    getTextEdits: () => textEdits,
    getInsertedTexts: () => insertedTexts,
    getInsertedImages: () => insertedImages,
    getInsertedShapes: () => insertedShapes,
    getEditedTextVisualBox: editedTextVisualBox,
    getInsertedTextVisualBox: insertedTextVisualBox,
    getMainSourceName: mainSourceName,
    beginOperation,
    assertOperation,
    endOperation,
    showProcess,
    setLocalizedProgress,
    showToast,
    messageForError,
    showSuccess,
    captureEditorSnapshot,
    setSavedSnapshot: () => {
      savedSnapshot = captureEditorSnapshot();
    }
  });

  // ----- Event wiring -----
  pdfEditorEvents = createPdfEditorEvents({
    documentRef: document,
    windowRef: window,
    listenerOptions,
    isTauri,
    overlay,
    dropZone,
    fileInput,
    appendInput,
    imageInput,
    back,
    cta,
    appendBtn,
    replaceBtn,
    editTextBtn,
    editTextSidebarBtn,
    insertTextBtn,
    insertImageBtn,
    insertRectBtn,
    insertEllipseBtn,
    insertLineBtn,
    selectComponentBtn,
    componentScaleDownBtn,
    componentScaleUpBtn,
    componentEditBtn,
    componentRotateBtn,
    componentDeleteBtn,
    shapeFillInput,
    shapeStrokeInput,
    shapeStrokeWidth,
    resetBtn,
    undoBtn,
    redoBtn,
    editModalSave,
    editModalCancel,
    editModalClose,
    editModalInput,
    rotateCcwBtn,
    rotateCwBtn,
    moveUpBtn,
    moveDownBtn,
    duplicateBtn,
    blankPageBtn,
    selectAllBtn,
    invertSelectionBtn,
    deleteBtn,
    extractBtn,
    exportBtn,
    processCancel,
    successOk,
    successOpenFolder,
    zoomOutBtn,
    zoomInBtn,
    fitWidthBtn,
    zoomValueBtn,
    canvasScroll,
    zoom,
    exporter,
    getLastOutputFolder: () => pdfEditorView?.getLastOutputFolder(),
    getLastSuccess: () => pdfEditorView?.getLastSuccess(),
    getInvoke,
    t,
    getEditMode: () => editMode,
    getComponentMode: () => componentMode,
    getSelectedComponent: () => selectedComponent,
    getCurrentOperation: currentOperation,
    isDisposed: () => disposed,
    hexToRgb01,
    updateSelectedShapeProperty,
    commitEditorHistory,
    setEditMode: value => setEditMode(value),
    chooseMainFile,
    chooseAppendFile,
    openInsertTextModal,
    chooseInsertImage,
    insertShape,
    setComponentMode,
    scaleSelectedComponent,
    editSelectedComponent,
    beginComponentRotate,
    deleteSelected,
    resetEditorState,
    undoEditorChange,
    redoEditorChange,
    saveEditModal,
    handleEditModalCancel,
    rotateSelected,
    moveCurrent,
    duplicateSelectedPages,
    insertBlankPage,
    selectAllPages,
    invertPageSelection,
    targetIds,
    cancelActiveOperation,
    closeOverlay,
    closeSuccess,
    loadMainFile,
    appendPdfBytes,
    prepareInsertImage,
    cancelInsertMode,
    showDropZone,
    hideDropZone,
    openOverlay,
    positionComponentMenu,
    showToast
  });
  window.addEventListener('resize', scheduleFitPreview, listenerOptions);
  if (typeof ResizeObserver === 'function' && canvasScroll) {
    fitResizeObserver = new ResizeObserver(scheduleFitPreview);
    fitResizeObserver.observe(canvasScroll);
  }

  document.addEventListener('keydown', handleDocumentKeydown, listenerOptions);

  unsubscribeLangChange = onLangChange(() => {
    updateControls();
    updateFileCard();
    const operation = currentOperation();
    if (operation?.progressKey && processMask?.classList.contains('visible')) {
      setLocalizedProgress(Number(processValue?.textContent?.replace('%', '') || 0), operation.progressKey, operation.progressParams);
    }
    if (pdfEditorView?.getLastSuccess() && successOverlay?.classList.contains('visible')) renderSuccess();
  }) || (() => {});

  updateControls();
  updateFileCard();
  updateZoomLabel();
  syncInteractiveLayers();
  syncStageVisibility();

  return {
    open() {
      if (disposed) return;
      openOverlay();
    },
    close() {
      return closeOverlay();
    },
    async openWithFile(file) {
      if (disposed) return;
      openOverlay();
      await loadMainFile(file);
    },
    dispose() {
      if (disposed) return;
      const operation = currentOperation();
      if (operation && !operation.cancelled) void cancelActiveOperation();
      operationRuntime?.clearActiveOperation();
      disposed = true;
      exporter.dispose();
      listenerController.abort();
      try { unsubscribeLangChange(); } catch (_) {}
      unsubscribeLangChange = () => {};
      pdfEditorEvents?.dispose();
      pdfEditorView?.dispose();
      processMask?.classList.remove('visible');
      if (fileInput) fileInput.value = '';
      if (appendInput) appendInput.value = '';
      stopFitPreviewObserver();
      zoom.dispose();
      stopComponentRotate();
      if (componentRenderFrame) {
        cancelAnimationFrame(componentRenderFrame);
        componentRenderFrame = 0;
      }
      syncInteractiveLayers();
      preview?.dispose();
      stopTileObserver(true);
      void resetDocument().finally(() => documents.dispose());
    }
  };
}
