import {
  isPdfEditorRenderCancellation,
  releasePdfEditorCanvas
} from './render-utils.js';

const DEFAULT_ZOOM_MIN = 0.08;
const DEFAULT_ZOOM_MAX = 8;

/**
 * Owns the PDF Editor's main-page render session. PDF.js tasks and candidate
 * canvases are invalidated by an epoch before the caller resets its document
 * model, so an old page can never replace a newer preview.
 */
export function createPdfEditorPreview({
  canvasStage,
  canvasScroll,
  getCanvasWrap = () => null,
  setCanvasWrap = () => {},
  getTextLayer = () => null,
  setTextLayer = () => {},
  getMainCanvas = () => null,
  setMainCanvas = () => {},
  getMainRenderTask = () => null,
  setMainRenderTask = () => {},
  getMainEpoch = () => 0,
  setMainEpoch = () => {},
  getLastRenderScale = () => 1,
  setLastRenderScale = () => {},
  getZoom = () => null,
  getCurrentPage = () => null,
  hasDocument = () => false,
  getSourceDoc,
  cacheSourceRotation,
  effectivePageRotation,
  pageSupportsContentEditing,
  getTextLinesCache = () => new Map(),
  setTextLinesCache = () => {},
  getEditMode = () => false,
  setEditMode = () => {},
  isDisposed = () => false,
  renderTextLayer = () => {},
  handleCanvasPlacement = () => {},
  handleCanvasBackgroundClick = () => {},
  syncStageVisibility = () => {},
  updateControls = () => {},
  updateZoomLabel = () => {},
  groupTextItemsIntoLines,
  buildTextLine,
  listenerOptions = {},
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  zoomMin = DEFAULT_ZOOM_MIN,
  zoomMax = DEFAULT_ZOOM_MAX
} = {}) {
  if (!canvasStage) throw new TypeError('PDF editor preview requires a canvas stage');

  function cancel() {
    setMainEpoch(Number(getMainEpoch()) + 1);
    const renderTask = getMainRenderTask();
    if (renderTask) {
      try { renderTask.cancel(); } catch (_) {}
      setMainRenderTask(null);
    }
  }

  function ensureCanvas() {
    let canvasWrap = getCanvasWrap();
    if (!canvasWrap) {
      canvasWrap = documentRef.createElement('div');
      canvasWrap.className = 'pdf-editor-canvas-wrap';
      canvasStage.appendChild(canvasWrap);
      setCanvasWrap(canvasWrap);
    }
    let textLayer = getTextLayer();
    if (!textLayer) {
      textLayer = documentRef.createElement('div');
      textLayer.className = 'pdf-editor-text-layer';
      textLayer.setAttribute('aria-hidden', 'true');
      canvasWrap.appendChild(textLayer);
      setTextLayer(textLayer);
      canvasWrap.addEventListener('click', handleCanvasPlacement, { ...listenerOptions, capture: true });
      canvasWrap.addEventListener('click', handleCanvasBackgroundClick, listenerOptions);
    }
    return canvasWrap;
  }

  async function render(zoomToken, zoomRequest) {
    const zoom = getZoom();
    if (!zoom) return;
    zoom.beginRender();
    cancel();
    const page = getCurrentPage();
    const canvasWrap = getCanvasWrap();
    if (!page || !hasDocument()) {
      if (canvasWrap) canvasWrap.style.display = 'none';
      zoom.clearPreviewHint(zoomToken);
      syncStageVisibility();
      return;
    }

    const epoch = Number(getMainEpoch());
    let loadedPage = null;
    let renderTask = null;
    let nextCanvas = null;
    try {
      const doc = await getSourceDoc(page.sourceId);
      if (epoch !== Number(getMainEpoch()) || isDisposed()) return;
      loadedPage = await doc.getPage(page.pageIndex + 1);
      if (epoch !== Number(getMainEpoch()) || isDisposed()) return;
      cacheSourceRotation(page, loadedPage);
      // Source rotation is cached outside history; refresh controls once it is
      // known so content-editing guards reflect the actual page orientation.
      updateControls();
      const displayRotation = effectivePageRotation(page);
      const base = loadedPage.getViewport({ scale: 1, rotation: displayRotation });
      let scale;
      const zoomState = zoom.getState();
      if (zoomState.viewMode === 'fit') {
        const availWidth = Math.max(220, (canvasScroll?.clientWidth || 800) - 80);
        scale = Math.max(zoomMin, Math.min(4, availWidth / Math.max(1, base.width)));
      } else {
        scale = Math.max(zoomMin, Math.min(zoomMax, zoomState.zoomPercent));
      }
      updateZoomLabel();
      const dpr = Math.min(2, Math.max(1, windowRef?.devicePixelRatio || 1));
      const viewport = loadedPage.getViewport({ scale: scale * dpr, rotation: displayRotation });
      const currentWrap = ensureCanvas();
      const previousCanvas = getMainCanvas();
      const cssWidth = Math.max(1, Math.round(viewport.width / dpr));
      const cssHeight = Math.max(1, Math.round(viewport.height / dpr));

      // Paint off-DOM so the currently visible frame remains stable while
      // PDF.js renders the candidate page.
      nextCanvas = documentRef.createElement('canvas');
      nextCanvas.className = 'pdf-editor-main-canvas';
      nextCanvas.style.visibility = 'hidden';
      nextCanvas.width = Math.max(1, Math.round(viewport.width));
      nextCanvas.height = Math.max(1, Math.round(viewport.height));
      nextCanvas.style.width = cssWidth + 'px';
      nextCanvas.style.height = cssHeight + 'px';
      currentWrap.style.display = '';
      const context = nextCanvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Cannot create preview canvas');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
      renderTask = loadedPage.render({ canvasContext: context, viewport, background: '#ffffff' });
      setMainRenderTask(renderTask);
      await renderTask.promise;
      if (getMainRenderTask() === renderTask) setMainRenderTask(null);
      if (epoch !== Number(getMainEpoch()) || isDisposed() || !zoom.isCurrentRequest(zoomRequest)) {
        releasePdfEditorCanvas(nextCanvas);
        nextCanvas = null;
        return;
      }

      nextCanvas.style.visibility = '';
      if (previousCanvas?.isConnected) {
        previousCanvas.replaceWith(nextCanvas);
      } else {
        currentWrap.appendChild(nextCanvas);
      }
      if (previousCanvas && previousCanvas !== nextCanvas) releasePdfEditorCanvas(previousCanvas);
      setMainCanvas(nextCanvas);
      currentWrap.style.width = cssWidth + 'px';
      currentWrap.style.height = cssHeight + 'px';
      setLastRenderScale(scale);
      zoom.commitRender(zoomToken, zoomRequest, scale);
      syncStageVisibility();

      const cssViewport = loadedPage.getViewport({ scale, rotation: displayRotation });
      // Measure replacements only after the local preview font is ready.
      if (documentRef.fonts?.load) {
        const family = windowRef?.getComputedStyle(getTextLayer())
          .getPropertyValue('--tk-font-pdf').trim() || 'ToolKnitNotoSansSC';
        await documentRef.fonts.load(`500 16px ${family}`).catch(() => {});
        if (epoch !== Number(getMainEpoch()) || isDisposed() || !zoom.isCurrentRequest(zoomRequest)) return;
      }
      const editable = pageSupportsContentEditing(page);
      const textLinesCache = getTextLinesCache() || new Map();
      if (editable) {
        try {
          const cachedLines = textLinesCache.get(page.id);
          let lines = cachedLines?.rotation === displayRotation && Array.isArray(cachedLines.lines)
            ? cachedLines.lines
            : null;
          if (!lines) {
            const content = await loadedPage.getTextContent();
            if (epoch !== Number(getMainEpoch()) || isDisposed()) return;
            lines = groupTextItemsIntoLines(content.items).map(buildTextLine);
          }
          textLinesCache.set(page.id, { lines, scale, cssViewport, rotation: displayRotation, epoch });
          setTextLinesCache(textLinesCache);
          renderTextLayer(lines, cssViewport, scale, page.id);
        } catch (error) {
          if (epoch === Number(getMainEpoch()) && !isDisposed()) {
            console.error('[PDF Editor] text layer failed:', error);
          }
          textLinesCache.delete(page.id);
          setTextLinesCache(textLinesCache);
          renderTextLayer([], cssViewport, scale, page.id);
        }
      } else {
        textLinesCache.set(page.id, { lines: [], scale, cssViewport, rotation: displayRotation, epoch });
        setTextLinesCache(textLinesCache);
        renderTextLayer([], cssViewport, scale, page.id);
        if (getEditMode()) setEditMode(false);
      }
    } catch (error) {
      if (getMainRenderTask() === renderTask) setMainRenderTask(null);
      if (!isPdfEditorRenderCancellation(error)
        && epoch === Number(getMainEpoch())
        && !isDisposed()) {
        console.error('[PDF Editor] preview render failed:', error);
      }
    } finally {
      zoom.clearPreviewHint(zoomToken);
      if (getMainRenderTask() === renderTask) setMainRenderTask(null);
      const currentCanvas = getMainCanvas();
      if (nextCanvas && nextCanvas !== currentCanvas) releasePdfEditorCanvas(nextCanvas);
      try { loadedPage?.cleanup(); } catch (_) {}
    }
  }

  function dispose() {
    cancel();
    const canvas = getMainCanvas();
    if (canvas) {
      releasePdfEditorCanvas(canvas);
      setMainCanvas(null);
    }
    const canvasWrap = getCanvasWrap();
    if (canvasWrap) {
      canvasWrap.style.width = '';
      canvasWrap.style.height = '';
    }
  }

  return {
    cancel,
    dispose,
    ensureCanvas,
    render
  };
}
