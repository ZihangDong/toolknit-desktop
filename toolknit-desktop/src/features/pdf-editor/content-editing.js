import { IMAGE_BATCH_LIMITS } from '../../image-batch-core.js';
import {
  assertImagePixelLimit,
  readEncodedImageDimensions,
  readImageDimensions
} from './insert-assets.js';

/**
 * Coordinates PDF Editor text editing and inserted content. The orchestrator
 * owns the document snapshot; this controller only performs the edit workflow
 * through injected state accessors and render callbacks.
 */
export function createPdfEditorContentEditing({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  getCanvasWrap = () => null,
  imageInput = null,
  editTextBtn = null,
  selectComponentBtn = null,
  editModal = null,
  editModalOriginal = null,
  editModalInput = null,
  editSecurityNote = null,
  editModalTitle = null,
  editModalOriginalLabel = null,
  editModalNewLabel = null,
  t = key => key,
  listenerOptions = {},
  getEditMode = () => false,
  setEditModeState = () => {},
  getComponentMode = () => false,
  setComponentModeState = () => {},
  getInsertMode = () => null,
  setInsertMode = () => {},
  getPendingInsert = () => null,
  setPendingInsert = () => {},
  getEditingLineKey = () => null,
  setEditingLineKey = () => {},
  getModalMode = () => null,
  setModalMode = () => {},
  getSelectedComponent = () => null,
  setSelectedComponent = () => {},
  getTextEdits = () => new Map(),
  getTextLinesCache = () => new Map(),
  getInsertedTexts = () => [],
  setInsertedTexts = () => {},
  getInsertedImages = () => [],
  setInsertedImages = () => {},
  getInsertedShapes = () => [],
  setInsertedShapes = () => {},
  hasDocument = () => false,
  getCurrentPage = () => null,
  getCurrentTextLayerCache = () => null,
  pageSupportsContentEditing = () => true,
  pageSupportsInsertion = pageSupportsContentEditing,
  getActiveOperation = () => null,
  nextId = () => '',
  storeInsertedImage = () => {},
  clearPendingInsert = () => {},
  closeSelectedComponent = () => {},
  setComponentMode = () => {},
  syncEditModeClass = () => {},
  syncComponentModeClass = () => {},
  syncInteractiveLayers = () => {},
  updateControls = () => {},
  renderMainPreview = () => {},
  refreshCurrentTextLayer = () => {},
  renderTextLayer = () => {},
  fileSizeFor = async () => 0,
  readBytes = async () => new Uint8Array(),
  cloneState = value => value,
  compactComponent = value => value,
  sameTextSegmentLayout = () => false,
  commitEditorHistory = () => {},
  showToast = () => {}
} = {}) {
  const requestFrame = callback => {
    if (typeof windowRef?.requestAnimationFrame === 'function') return windowRef.requestAnimationFrame(callback);
    callback();
    return 0;
  };

  function handleCanvasPlacement(event) {
    const insertMode = getInsertMode();
    const pendingInsert = getPendingInsert();
    const canvasWrap = getCanvasWrap();
    if (!insertMode || !pendingInsert || !canvasWrap) return;
    const page = getCurrentPage();
    const cache = getCurrentTextLayerCache();
    if (!page || !cache || !pageSupportsInsertion(page)) return;
    const bounds = canvasWrap.getBoundingClientRect();
    const cssX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    const cssY = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    const [pdfX, pdfY] = cache.cssViewport.convertToPdfPoint(cssX, cssY);
    if (pendingInsert.type === 'text') {
      const insertedTexts = getInsertedTexts() || [];
      insertedTexts.push({
        id: nextId('text'),
        pageId: page.id,
        x: pdfX,
        y: pdfY - pendingInsert.fontSize * 0.24,
        text: pendingInsert.text,
        fontSize: pendingInsert.fontSize,
        bold: pendingInsert.bold,
        rotation: 0,
        color: pendingInsert.color
      });
      setInsertedTexts(insertedTexts);
    } else if (pendingInsert.type === 'image') {
      const imageId = nextId('image');
      storeInsertedImage(imageId, {
        bytes: pendingInsert.bytes,
        mimeType: pendingInsert.mimeType
      });
      const insertedImages = getInsertedImages() || [];
      insertedImages.push({
        id: imageId,
        pageId: page.id,
        x: pdfX,
        y: pdfY - pendingInsert.height,
        width: pendingInsert.width,
        height: pendingInsert.height,
        originalAspectRatio: pendingInsert.originalAspectRatio || pendingInsert.width / pendingInsert.height,
        aspectRatioLocked: true,
        rotation: 0,
        bytes: pendingInsert.bytes,
        mimeType: pendingInsert.mimeType,
        previewUrl: pendingInsert.previewUrl
      });
      setInsertedImages(insertedImages);
    } else if (pendingInsert.type === 'shape') {
      const insertedShapes = getInsertedShapes() || [];
      insertedShapes.push({
        id: nextId('shape'),
        pageId: page.id,
        shapeType: pendingInsert.shapeType,
        x: pdfX - pendingInsert.width / 2,
        y: pdfY - pendingInsert.height / 2,
        width: pendingInsert.width,
        height: pendingInsert.height,
        rotation: 0,
        fill: pendingInsert.fill,
        stroke: pendingInsert.stroke,
        strokeWidth: pendingInsert.strokeWidth
      });
      setInsertedShapes(insertedShapes);
    }
    setPendingInsert(null);
    setInsertMode(null);
    setComponentModeState(true);
    syncComponentModeClass();
    updateControls();
    renderMainPreview();
    commitEditorHistory();
    showToast(t('home.pdfEditor.insertPlaced'), 3500);
    event.preventDefault();
    event.stopPropagation();
  }

  function setEditMode(enabled) {
    if (getActiveOperation()) return;
    const page = getCurrentPage();
    if (enabled) {
      if (!hasDocument()) {
        showToast(t('home.pdfEditor.appendNeedsFile'));
        return;
      }
      if (!page || !pageSupportsContentEditing(page)) {
        showToast(t('home.pdfEditor.editTextRotated'));
        return;
      }
      const cache = page ? (getTextLinesCache() || new Map()).get(page.id) : null;
      if (!cache || cache.lines.length === 0) {
        showToast(t('home.pdfEditor.editTextNoText'));
        return;
      }
      if (!getComponentMode()) setComponentMode(true);
      setEditModeState(true);
      setSelectedComponent(null);
      closeEditModal();
    } else {
      setEditModeState(false);
      setComponentModeState(true);
      setSelectedComponent(null);
      closeEditModal();
      setInsertMode(null);
      clearPendingInsert();
    }
    if (editTextBtn) {
      editTextBtn.classList.toggle('is-active', getEditMode());
      editTextBtn.setAttribute('aria-pressed', String(getEditMode()));
    }
    if (selectComponentBtn) {
      selectComponentBtn.classList.toggle('is-active', getComponentMode() && !getEditMode());
      selectComponentBtn.setAttribute('aria-pressed', String(getComponentMode() && !getEditMode()));
    }
    syncEditModeClass();
    syncComponentModeClass();
    updateControls();
    renderMainPreview();
  }

  function openEditModal(key, segment, fallbackSegment, mode = 'edit') {
    if (!editModal || !editModalInput || getActiveOperation()) return;
    setEditingLineKey(key);
    setModalMode(mode);
    const source = segment || fallbackSegment || { text: '' };
    const original = source.text || '';
    const edit = mode === 'edit' ? (getTextEdits() || new Map()).get(key) : null;
    editModalInput.value = edit ? edit.newText : original;
    if (editModalOriginal) editModalOriginal.textContent = original;
    if (editModalTitle) editModalTitle.textContent = t('home.pdfEditor.editText');
    if (editSecurityNote) editSecurityNote.hidden = mode !== 'edit';
    if (editModalOriginalLabel) editModalOriginalLabel.style.display = '';
    if (editModalOriginal) editModalOriginal.style.display = '';
    if (editModalNewLabel) editModalNewLabel.textContent = t('home.pdfEditor.editTextNew');
    editModal.classList.add('visible');
    editModal.inert = false;
    editModal.setAttribute('aria-hidden', 'false');
    syncInteractiveLayers();
    requestFrame(() => {
      editModalInput.focus();
      editModalInput.select();
    });
  }

  function closeEditModal() {
    if (!editModal) return;
    editModal.classList.remove('visible');
    editModal.inert = true;
    editModal.setAttribute('aria-hidden', 'true');
    setEditingLineKey(null);
    setModalMode(null);
    syncInteractiveLayers();
  }

  function cancelInsertMode() {
    clearPendingInsert();
    setInsertMode(null);
    setComponentModeState(true);
    syncComponentModeClass();
    closeEditModal();
    updateControls();
    refreshCurrentTextLayer();
  }

  function openInsertTextModal() {
    if (!hasDocument() || getActiveOperation()) return;
    const page = getCurrentPage();
    if (!page || !pageSupportsInsertion(page)) {
      showToast(t('home.pdfEditor.editTextRotated'));
      return;
    }
    setEditModeState(false);
    setComponentModeState(false);
    setSelectedComponent(null);
    setInsertMode('text');
    clearPendingInsert();
    setModalMode('insert-text');
    if (editModalTitle) editModalTitle.textContent = t('home.pdfEditor.insertText');
    if (editModalOriginalLabel) editModalOriginalLabel.style.display = 'none';
    if (editModalOriginal) editModalOriginal.style.display = 'none';
    if (editModalNewLabel) editModalNewLabel.textContent = t('home.pdfEditor.insertTextValue');
    if (editSecurityNote) editSecurityNote.hidden = true;
    if (editModalInput) editModalInput.value = '';
    editModal?.classList.add('visible');
    if (editModal) {
      editModal.inert = false;
      editModal.setAttribute('aria-hidden', 'false');
    }
    syncEditModeClass();
    syncComponentModeClass();
    syncInteractiveLayers();
    requestFrame(() => editModalInput?.focus());
    updateControls();
    renderMainPreview();
  }

  function chooseInsertImage() {
    if (!hasDocument() || getActiveOperation()) return;
    const page = getCurrentPage();
    if (!page || !pageSupportsInsertion(page)) {
      showToast(t('home.pdfEditor.editTextRotated'));
      return;
    }
    setInsertMode('image');
    clearPendingInsert();
    setEditModeState(false);
    setComponentModeState(false);
    setSelectedComponent(null);
    if (editTextBtn) {
      editTextBtn.classList.remove('is-active');
      editTextBtn.setAttribute('aria-pressed', 'false');
    }
    syncEditModeClass();
    syncComponentModeClass();
    if (imageInput) {
      imageInput.value = '';
      imageInput.click();
    }
    updateControls();
    renderMainPreview();
  }

  function insertShape(shapeType) {
    if (!hasDocument() || getActiveOperation()) return;
    const page = getCurrentPage();
    if (!page || !pageSupportsInsertion(page)) {
      showToast(t('home.pdfEditor.editTextRotated'));
      return;
    }
    setEditModeState(false);
    setComponentModeState(false);
    setSelectedComponent(null);
    closeEditModal();
    clearPendingInsert();
    if (editTextBtn) {
      editTextBtn.classList.remove('is-active');
      editTextBtn.setAttribute('aria-pressed', 'false');
    }
    const cache = getCurrentTextLayerCache();
    const pageWidth = cache?.cssViewport?.width ? cache.cssViewport.width / (cache.scale || 1) : 612;
    const isLine = shapeType === 'line';
    const width = isLine ? Math.min(220, pageWidth * 0.36) : Math.min(200, pageWidth * 0.32);
    const height = isLine ? 0 : Math.max(80, width * 0.58);
    setPendingInsert({
      type: 'shape',
      shapeType,
      width,
      height,
      fill: isLine ? null : [1, 1, 1],
      stroke: [0, 0, 0],
      strokeWidth: 2
    });
    setInsertMode(isLine ? 'shape-line' : `shape-${shapeType}`);
    syncEditModeClass();
    syncComponentModeClass();
    syncInteractiveLayers();
    updateControls();
    renderMainPreview();
    showToast(t('home.pdfEditor.insertShapeHint'), 6000);
  }

  async function prepareInsertImage(file) {
    if (!file) return;
    try {
      const fileSize = await fileSizeFor(file);
      if (!Number.isSafeInteger(fileSize) || fileSize < 1) throw new Error('图像文件大小无效');
      if (fileSize > IMAGE_BATCH_LIMITS.maxBytesPerFile) {
        throw new Error(`图像文件超过 ${Math.floor(IMAGE_BATCH_LIMITS.maxBytesPerFile / 1024 / 1024)}MB 限制`);
      }
      const bytes = await readBytes(file);
      const declaredMime = String(file.type || '').toLowerCase();
      const mimeType = declaredMime || (/\.jpe?g$/i.test(String(file.name || '')) ? 'image/jpeg' : 'image/png');
      if (!['image/png', 'image/jpeg', 'image/jpg'].includes(mimeType)) throw new Error('仅支持 PNG 或 JPEG 图像');
      const encodedDimensions = readEncodedImageDimensions(bytes, mimeType);
      if (encodedDimensions) assertImagePixelLimit(encodedDimensions);
      const dimensions = await readImageDimensions(bytes, mimeType);
      const safeDimensions = assertImagePixelLimit(dimensions);
      const cache = getCurrentTextLayerCache();
      const pageWidth = cache?.cssViewport?.width ? cache.cssViewport.width / (cache.scale || 1) : 612;
      const width = Math.min(240, Math.max(64, pageWidth * 0.4));
      const originalAspectRatio = safeDimensions.width / safeDimensions.height;
      const height = width / originalAspectRatio;
      const previewUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      setPendingInsert({ type: 'image', bytes, mimeType, width, height, originalAspectRatio, previewUrl });
      setInsertMode('image');
      showToast(t('home.pdfEditor.insertImageHint'), 6000);
      updateControls();
    } catch (error) {
      setInsertMode(null);
      setComponentModeState(true);
      syncComponentModeClass();
      clearPendingInsert();
      showToast(t('home.pdfEditor.insertImageFailed', { error: String(error?.message || error) }));
      updateControls();
    }
  }

  function saveEditModal() {
    const modalMode = getModalMode();
    if (modalMode === 'insert-text') {
      const text = String(editModalInput?.value || '').trim();
      if (!text) {
        showToast(t('home.pdfEditor.insertTextEmpty'));
        return;
      }
      setPendingInsert({ type: 'text', text, fontSize: 16, bold: false, color: [0, 0, 0] });
      closeEditModal();
      showToast(t('home.pdfEditor.insertTextHint'), 6000);
      updateControls();
      return;
    }
    if (modalMode === 'edit-inserted-text') {
      const objectId = getEditingLineKey();
      const object = (getInsertedTexts() || []).find(item => item.id === objectId);
      if (!object) {
        closeEditModal();
        closeSelectedComponent();
        return;
      }
      const newText = String(editModalInput?.value ?? '').trim();
      if (!newText) {
        showToast(t('home.pdfEditor.insertTextEmpty'));
        return;
      }
      if (newText === object.text) {
        closeEditModal();
        return;
      }
      object.text = newText;
      const selected = getSelectedComponent();
      if (selected?.type === 'inserted-text' && selected.key === object.id) {
        setSelectedComponent(compactComponent(selected));
      }
      closeEditModal();
      refreshCurrentTextLayer();
      commitEditorHistory();
      return;
    }
    const key = getEditingLineKey();
    if (key == null) return;
    const parts = String(key).split(':');
    const pageId = parts[0];
    const lineIndex = Number(parts[1]);
    const segmentIndex = Number(parts[2]);
    const cache = (getTextLinesCache() || new Map()).get(pageId);
    const line = cache?.lines?.[lineIndex];
    const segment = line?.segments?.[segmentIndex] || line;
    if (!segment) {
      closeEditModal();
      return;
    }
    const newText = editModalInput?.value ?? '';
    const textEdits = getTextEdits() || new Map();
    const existingEdit = textEdits.get(key);
    const baseSegment = existingEdit?.baseSegment || segment;
    if (newText === segment.text && (!existingEdit || sameTextSegmentLayout(existingEdit.segment, baseSegment))) {
      textEdits.delete(key);
    } else {
      const currentEdit = existingEdit || { newText: segment.text || '', segment: cloneState(segment) };
      currentEdit.newText = newText;
      currentEdit.segment = cloneState(currentEdit.segment || segment);
      if (!currentEdit.baseSegment) currentEdit.baseSegment = cloneState(baseSegment);
      textEdits.set(key, currentEdit);
    }
    closeEditModal();
    const current = getCurrentPage();
    if (current && current.id === pageId && cache) renderTextLayer(cache.lines, cache.cssViewport, cache.scale, pageId);
    commitEditorHistory();
  }

  function handleEditModalCancel() {
    if (getModalMode() === 'insert-text') {
      cancelInsertMode();
      return;
    }
    closeEditModal();
  }

  return {
    cancelInsertMode,
    chooseInsertImage,
    closeEditModal,
    handleCanvasPlacement,
    handleEditModalCancel,
    insertShape,
    openEditModal,
    openInsertTextModal,
    prepareInsertImage,
    saveEditModal,
    setEditMode
  };
}
