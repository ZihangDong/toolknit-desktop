import { PDFDocument } from 'pdf-lib';
import {
  PDF_EDITOR_LIMITS,
  normalizePageRotation
} from '../../pdf-editor-core.js';
import { PdfEditorCancelledError } from './errors.js';

/**
 * Owns page-level mutations for PDF Editor. Document loading and rendering
 * remain injected so page operations can update the existing orchestration
 * state without taking ownership of the PDF.js session.
 */
export function createPdfEditorPageOperations({
  documentRef = globalThis.document,
  urlRef = globalThis.URL,
  blobConstructor = globalThis.Blob,
  t = key => key,
  getActiveOperation = () => null,
  getPages = () => [],
  setPages = () => {},
  getSources = () => [],
  getSourceStore = () => new Map(),
  getTextEdits = () => new Map(),
  getInsertedTexts = () => [],
  setInsertedTexts = () => {},
  getInsertedImages = () => [],
  setInsertedImages = () => {},
  getInsertedShapes = () => [],
  setInsertedShapes = () => {},
  getInsertedImageStore = () => new Map(),
  getSelectedComponent = () => null,
  getCurrentId = () => null,
  setCurrentId = () => {},
  getSelectedIds = () => new Set(),
  setSelectedIds = () => {},
  getSelectionAnchorId = () => null,
  setSelectionAnchorId = () => {},
  getPageStrip = () => null,
  hasDocument = () => false,
  targetIds = () => [],
  currentPage = () => null,
  pageStateFor = () => null,
  refreshTile = () => {},
  renderMainPreview = () => {},
  refreshCurrentTextLayer = () => {},
  updateControls = () => {},
  commitEditorHistory = () => {},
  showToast = () => {},
  clearSelectedComponent = () => {},
  ensureTextEditEntry = () => null,
  releasePreview = () => {},
  buildTiles = () => {},
  updateFileCard = () => {},
  beginOperation = () => null,
  assertOperation = () => {},
  endOperation = () => {},
  showProcess = () => {},
  setLocalizedProgress = () => {},
  getSourceDoc = async () => null,
  cacheSourceRotation = () => {},
  effectivePageRotation = page => page?.rotation || 0,
  messageForError = error => String(error?.message || error),
  nextId = type => `${type}-${Date.now()}`,
  cloneState = value => value,
  normalizeEditSnapshot = value => value,
  normalizeInsertedImageSnapshot = value => value,
  normalizeInsertedShapeSnapshot = value => value
} = {}) {
  function revokeObjectUrl(url) {
    if (!url || typeof urlRef?.revokeObjectURL !== 'function') return;
    try { urlRef.revokeObjectURL(url); } catch (_) {}
  }

  function rotateSelected(delta) {
    if (getActiveOperation() || !hasDocument()) return;
    const pages = getPages() || [];
    const ids = targetIds();
    for (const id of ids) {
      const page = pages.find(item => item.id === id);
      if (!page) continue;
      page.rotation = normalizePageRotation(page.rotation + delta);
      const pageState = pageStateFor(id);
      if (pageState) refreshTile(pageState);
    }
    renderMainPreview();
    updateControls();
    commitEditorHistory();
  }

  function moveCurrent(direction) {
    if (getActiveOperation() || !hasDocument()) return;
    const pages = getPages() || [];
    const page = currentPage();
    if (!page) return;
    const index = pages.indexOf(page);
    const targetIndex = direction === -1 ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= pages.length) return;
    const [moved] = pages.splice(index, 1);
    pages.splice(targetIndex, 0, moved);

    // Reorder the DOM tiles in lockstep without discarding rendered canvases.
    const pageStrip = getPageStrip();
    const targetTile = pageStateFor(page.id)?.tile;
    if (pageStrip && targetTile) {
      const ordered = Array.from(pageStrip.children || []);
      const domIndex = ordered.indexOf(targetTile);
      if (domIndex !== -1) {
        ordered.splice(domIndex, 1);
        ordered.splice(targetIndex, 0, targetTile);
        const fragment = documentRef.createDocumentFragment();
        ordered.forEach(node => fragment.appendChild(node));
        pageStrip.appendChild(fragment);
      }
    }
    for (let i = 0; i < pages.length; i++) {
      const pageState = pageStateFor(pages[i].id);
      if (pageState?.indexEl) pageState.indexEl.textContent = String(i + 1);
    }
    setPages(pages);
    updateControls();
    commitEditorHistory();
  }

  function duplicateSelectedPages() {
    if (getActiveOperation() || !hasDocument()) return;
    const pages = getPages() || [];
    const ids = targetIds();
    if (!ids.length) return;
    if (pages.length + ids.length > PDF_EDITOR_LIMITS.maxPages) {
      showToast(t('home.pdfEditor.tooManyPages'));
      return;
    }

    const idsToDuplicate = new Set(ids);
    const duplicateIds = [];
    const nextPages = [];
    const pageCopies = new Map();
    for (const page of pages) {
      nextPages.push(page);
      if (!idsToDuplicate.has(page.id)) continue;
      const duplicate = { ...page, id: nextId('page') };
      nextPages.push(duplicate);
      duplicateIds.push(duplicate.id);
      pageCopies.set(page.id, duplicate.id);
    }

    const textEdits = getTextEdits() || new Map();
    const copiedTextEdits = [];
    for (const [key, edit] of textEdits.entries()) {
      const sourcePageId = String(key).split(':')[0];
      const targetPageId = pageCopies.get(sourcePageId);
      if (!targetPageId) continue;
      copiedTextEdits.push([
        `${targetPageId}${String(key).slice(sourcePageId.length)}`,
        normalizeEditSnapshot(edit)
      ]);
    }
    for (const [key, edit] of copiedTextEdits) textEdits.set(key, edit);

    const insertedTexts = getInsertedTexts() || [];
    for (const object of [...insertedTexts]) {
      const pageId = pageCopies.get(object.pageId);
      if (!pageId) continue;
      insertedTexts.push({ ...cloneState(object), id: nextId('text'), pageId });
    }
    setInsertedTexts(insertedTexts);

    const insertedImages = getInsertedImages() || [];
    const imageStore = getInsertedImageStore() || new Map();
    for (const object of [...insertedImages]) {
      const pageId = pageCopies.get(object.pageId);
      if (!pageId) continue;
      const imageId = nextId('image');
      const stored = imageStore.get(object.id);
      const bytes = stored?.bytes || object.bytes;
      imageStore.set(imageId, { bytes, mimeType: object.mimeType });
      insertedImages.push({
        ...normalizeInsertedImageSnapshot(object),
        id: imageId,
        pageId,
        bytes,
        previewUrl: bytes?.length && typeof urlRef?.createObjectURL === 'function'
          ? urlRef.createObjectURL(new blobConstructor([bytes], { type: object.mimeType || 'image/png' }))
          : ''
      });
    }
    setInsertedImages(insertedImages);

    const insertedShapes = getInsertedShapes() || [];
    for (const object of [...insertedShapes]) {
      const pageId = pageCopies.get(object.pageId);
      if (!pageId) continue;
      insertedShapes.push({ ...normalizeInsertedShapeSnapshot(object), id: nextId('shape'), pageId });
    }
    setInsertedShapes(insertedShapes);

    setPages(nextPages);
    setCurrentId(duplicateIds.at(-1) || getCurrentId());
    setSelectedIds(new Set(duplicateIds));
    setSelectionAnchorId(duplicateIds[0] || getCurrentId());
    clearSelectedComponent();
    buildTiles();
    updateFileCard();
    commitEditorHistory();
  }

  async function insertBlankPage() {
    if (getActiveOperation() || !hasDocument()) return;
    const pages = getPages() || [];
    if (pages.length >= PDF_EDITOR_LIMITS.maxPages) {
      showToast(t('home.pdfEditor.tooManyPages'));
      return;
    }

    const operation = beginOperation('append');
    showProcess('preparingPages', 10);
    try {
      const current = currentPage();
      let width = 612;
      let height = 792;
      if (current) {
        const sourceDoc = await getSourceDoc(current.sourceId);
        assertOperation(operation);
        const sourcePage = await sourceDoc.getPage(current.pageIndex + 1);
        cacheSourceRotation(current, sourcePage);
        const viewport = sourcePage.getViewport({
          scale: 1,
          rotation: effectivePageRotation(current)
        });
        width = Math.max(72, Number(viewport.width) || width);
        height = Math.max(72, Number(viewport.height) || height);
        try { sourcePage.cleanup(); } catch (_) {}
      }

      const blankDocument = await PDFDocument.create();
      blankDocument.addPage([width, height]);
      const bytes = await blankDocument.save({ useObjectStreams: true });
      assertOperation(operation);
      const sources = getSources() || [];
      const totalBytes = sources.reduce((sum, source) => sum + Number(source.size || 0), 0) + bytes.length;
      if (totalBytes > PDF_EDITOR_LIMITS.maxMergeTotalBytes) {
        throw new Error('PDF inputs exceed the merge size limit');
      }

      const source = {
        id: nextId('src'),
        name: 'blank-page.pdf',
        bytes,
        size: bytes.length,
        pageCount: 1
      };
      const blankPage = {
        id: nextId('page'),
        sourceId: source.id,
        pageIndex: 0,
        rotation: 0,
        sourceRotation: 0
      };
      sources.push(source);
      getSourceStore().set(source.id, source);
      const insertAt = Math.max(0, pages.findIndex(page => page.id === getCurrentId()) + 1);
      pages.splice(insertAt, 0, blankPage);
      setPages(pages);
      setCurrentId(blankPage.id);
      setSelectedIds(new Set([blankPage.id]));
      setSelectionAnchorId(blankPage.id);
      clearSelectedComponent();
      buildTiles();
      updateFileCard();
      commitEditorHistory();
      setLocalizedProgress(100, 'preparingPages');
    } catch (error) {
      const cancelled = operation?.cancelled || error instanceof PdfEditorCancelledError;
      showToast(
        cancelled ? t('home.pdfEditor.cancelled') : messageForError(error, 'append'),
        cancelled ? 4500 : 9000
      );
    } finally {
      endOperation(operation);
    }
  }

  function deleteSelected() {
    if (getActiveOperation() || !hasDocument()) return;
    const selectedComponent = getSelectedComponent();
    const textEdits = getTextEdits() || new Map();
    const insertedImageStore = getInsertedImageStore() || new Map();
    if (selectedComponent) {
      if (selectedComponent.type === 'text') {
        const edit = ensureTextEditEntry(selectedComponent, selectedComponent.segment);
        if (edit?.segment) {
          edit.newText = '';
          textEdits.set(selectedComponent.key, edit);
        }
      } else if (selectedComponent.type === 'inserted-text') {
        setInsertedTexts((getInsertedTexts() || []).filter(item => item.id !== selectedComponent.key));
      } else if (selectedComponent.type === 'inserted-image') {
        const object = (getInsertedImages() || []).find(item => item.id === selectedComponent.key);
        if (object?.previewUrl) revokeObjectUrl(object.previewUrl);
        insertedImageStore.delete(selectedComponent.key);
        setInsertedImages((getInsertedImages() || []).filter(item => item.id !== selectedComponent.key));
      } else if (selectedComponent.type === 'inserted-shape') {
        setInsertedShapes((getInsertedShapes() || []).filter(item => item.id !== selectedComponent.key));
      }
      clearSelectedComponent();
      refreshCurrentTextLayer();
      commitEditorHistory();
      return;
    }

    const pages = getPages() || [];
    const ids = targetIds();
    if (ids.length >= pages.length) {
      showToast(t('home.pdfEditor.cannotDeleteAll'));
      return;
    }
    const remaining = pages.filter(page => !ids.includes(page.id));
    if (remaining.length === 0) {
      showToast(t('home.pdfEditor.cannotDeleteAll'));
      return;
    }
    setPages(remaining);
    for (const id of ids) {
      const pageState = pageStateFor(id);
      if (pageState) releasePreview(pageState, false);
      for (const key of Array.from(textEdits.keys())) {
        if (String(key).split(':')[0] === id) textEdits.delete(key);
      }
      setInsertedTexts((getInsertedTexts() || []).filter(item => item.pageId !== id));
      for (const image of (getInsertedImages() || []).filter(item => item.pageId === id)) {
        if (image.previewUrl) revokeObjectUrl(image.previewUrl);
        insertedImageStore.delete(image.id);
      }
      setInsertedImages((getInsertedImages() || []).filter(item => item.pageId !== id));
      setInsertedShapes((getInsertedShapes() || []).filter(item => item.pageId !== id));
    }
    const selectedIds = getSelectedIds() || new Set();
    setSelectedIds(new Set([...selectedIds].filter(id => !ids.includes(id))));
    let currentId = getCurrentId();
    if (currentId && ids.includes(currentId)) currentId = null;
    if (!currentId) currentId = remaining[0]?.id || null;
    if (currentId && !(getSelectedIds()?.size)) setSelectedIds(new Set([currentId]));
    setCurrentId(currentId);
    buildTiles();
    updateFileCard();
    commitEditorHistory();
  }

  return {
    deleteSelected,
    duplicateSelectedPages,
    insertBlankPage,
    moveCurrent,
    rotateSelected
  };
}
