const ZOOM_MIN = 0.08;
const ZOOM_MAX = 8;
const ZOOM_RENDER_DEBOUNCE_MS = 130;

function defaultRequestFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(callback, 0);
}

function defaultCancelFrame(handle) {
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(handle);
  } else {
    globalThis.clearTimeout(handle);
  }
}

/**
 * Owns PDF Editor zoom state, preview transforms and zoom-related scheduling.
 * PDF rendering remains injected so this module has no PDF.js or UI model
 * dependency and can invalidate every pending request at the session boundary.
 */
export function createPdfEditorZoomController({
  getCanvasWrap = () => null,
  getCanvasScroll = () => null,
  getSelectedComponent = () => null,
  getLastRenderScale = () => 1,
  setLastRenderScale = () => {},
  isDisposed = () => false,
  hasDocument = () => false,
  hasActiveOperation = () => false,
  updateZoomLabel = () => {},
  positionComponentMenu = () => {},
  renderMainPreview = () => {},
  listenerOptions = {},
  requestFrame = defaultRequestFrame,
  cancelFrame = defaultCancelFrame,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  setIntervalRef = globalThis.setInterval,
  clearIntervalRef = globalThis.clearInterval
} = {}) {
  let viewMode = 'fit';
  let zoomPercent = 1;
  let zoomPreviewToken = 0;
  let zoomRenderFrame = 0;
  let zoomRenderTimer = null;
  let zoomRequestId = 0;
  let pendingZoomAnchor = null;
  let pendingZoomRender = null;
  let zoomRepeatTimer = null;
  let zoomRepeatDelayTimer = null;
  let zoomPointerAction = false;
  let disposed = false;

  function getState() {
    return { viewMode, zoomPercent };
  }

  function setState(next = {}) {
    viewMode = next.viewMode === 'manual' ? 'manual' : 'fit';
    const value = Number(next.zoomPercent);
    zoomPercent = Number.isFinite(value) && value > 0 ? value : 1;
    updateZoomLabel();
  }

  function setRenderedScale(scale) {
    const value = Number(scale);
    if (Number.isFinite(value) && value > 0) setLastRenderScale(value);
  }

  function getCurrentScale() {
    const rendered = Math.max(0.0001, Number(getLastRenderScale()) || 1);
    return viewMode === 'fit' ? rendered : zoomPercent;
  }

  function readCanvasLayoutRect(canvasWrap) {
    if (!canvasWrap) return null;
    const transform = canvasWrap.style.transform;
    const origin = canvasWrap.style.transformOrigin;
    if (transform) canvasWrap.style.transform = 'none';
    const rect = canvasWrap.getBoundingClientRect();
    if (transform) {
      canvasWrap.style.transform = transform;
      canvasWrap.style.transformOrigin = origin;
    }
    return rect;
  }

  function captureAnchor(anchor = null) {
    const canvasWrap = getCanvasWrap();
    const canvasScroll = getCanvasScroll();
    if (!canvasWrap || !canvasScroll) return null;
    const visualRect = canvasWrap.getBoundingClientRect();
    const layoutRect = readCanvasLayoutRect(canvasWrap);
    const scrollRect = canvasScroll.getBoundingClientRect();
    if (!layoutRect || !scrollRect) return null;
    const requestedX = Number(anchor?.clientX);
    const requestedY = Number(anchor?.clientY);
    const clientX = Number.isFinite(requestedX)
      ? requestedX
      : scrollRect.left + scrollRect.width / 2;
    const clientY = Number.isFinite(requestedY)
      ? requestedY
      : scrollRect.top + scrollRect.height / 2;
    const localX = (clientX - visualRect.left) * layoutRect.width / Math.max(.0001, visualRect.width);
    const localY = (clientY - visualRect.top) * layoutRect.height / Math.max(.0001, visualRect.height);
    const baseScale = Math.max(0.0001, Number(getLastRenderScale()) || 1);
    return {
      clientX,
      clientY,
      localX,
      localY,
      layoutLeft: layoutRect.left,
      layoutTop: layoutRect.top,
      pdfX: localX / baseScale,
      pdfY: localY / baseScale,
      baseScale
    };
  }

  function applyAnchor(anchor, nextScale) {
    const canvasWrap = getCanvasWrap();
    const canvasScroll = getCanvasScroll();
    if (!anchor || !canvasWrap || !canvasScroll || !Number.isFinite(nextScale)) return;
    const rect = canvasWrap.getBoundingClientRect();
    const targetX = rect.left + anchor.pdfX * nextScale;
    const targetY = rect.top + anchor.pdfY * nextScale;
    const maxScrollLeft = Math.max(0, canvasScroll.scrollWidth - canvasScroll.clientWidth);
    const maxScrollTop = Math.max(0, canvasScroll.scrollHeight - canvasScroll.clientHeight);
    const nextScrollLeft = canvasScroll.scrollLeft + (targetX - anchor.clientX);
    const nextScrollTop = canvasScroll.scrollTop + (targetY - anchor.clientY);
    canvasScroll.scrollLeft = Math.max(0, Math.min(maxScrollLeft, nextScrollLeft));
    canvasScroll.scrollTop = Math.max(0, Math.min(maxScrollTop, nextScrollTop));
  }

  function scheduleMenuPosition() {
    if (disposed || isDisposed() || !getSelectedComponent()) return;
    requestFrame(() => {
      if (!disposed && !isDisposed()) positionComponentMenu();
    });
  }

  function showPreviewHint(nextScale, anchor = null) {
    const canvasWrap = getCanvasWrap();
    const lastRenderScale = Number(getLastRenderScale());
    if (!canvasWrap || !Number.isFinite(nextScale) || !Number.isFinite(lastRenderScale) || lastRenderScale <= 0) {
      return zoomPreviewToken;
    }
    // Keep the ratio relative to the last successfully painted page instead
    // of compounding transforms from successive wheel events.
    const ratio = Math.max(0.02, Math.min(40, nextScale / lastRenderScale));
    const token = ++zoomPreviewToken;
    if (anchor) {
      // The preceding wheel frame may still be a transformed preview. Preserve
      // its visible point even when the pointer moves before the next repaint.
      const x = anchor.clientX - anchor.layoutLeft - anchor.localX * ratio;
      const y = anchor.clientY - anchor.layoutTop - anchor.localY * ratio;
      canvasWrap.style.transformOrigin = '0px 0px';
      canvasWrap.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${ratio})`;
    } else {
      canvasWrap.style.transformOrigin = 'center';
      canvasWrap.style.transform = `translateZ(0) scale(${ratio})`;
    }
    canvasWrap.dataset.zoomPreviewToken = String(token);
    scheduleMenuPosition();
    return token;
  }

  function clearPreviewHint(token = zoomPreviewToken) {
    const canvasWrap = getCanvasWrap();
    if (!canvasWrap || token !== zoomPreviewToken) return;
    canvasWrap.style.transform = '';
    canvasWrap.style.transformOrigin = '';
    delete canvasWrap.dataset.zoomPreviewToken;
    scheduleMenuPosition();
  }

  function beginRender() {
    if (zoomRenderFrame) {
      cancelFrame(zoomRenderFrame);
      zoomRenderFrame = 0;
    }
    pendingZoomRender = null;
  }

  function scheduleRender(defer = false) {
    if (disposed || isDisposed()) return;
    if (zoomRenderTimer) {
      clearTimer(zoomRenderTimer);
      zoomRenderTimer = null;
    }
    const scheduleFrame = () => {
      zoomRenderTimer = null;
      if (zoomRenderFrame) return;
      zoomRenderFrame = requestFrame(() => {
        zoomRenderFrame = 0;
        const request = pendingZoomRender;
        pendingZoomRender = null;
        if (!request || disposed || isDisposed()) return;
        renderMainPreview(request.zoomToken, request);
      });
    };
    if (defer) {
      zoomRenderTimer = setTimer(scheduleFrame, ZOOM_RENDER_DEBOUNCE_MS);
    } else {
      scheduleFrame();
    }
  }

  function setZoom(mode, value, anchor = null, { defer = false } = {}) {
    viewMode = mode === 'fit' ? 'fit' : 'manual';
    zoomPercent = Number(value) || 1;
    updateZoomLabel();
    if (viewMode === 'fit') {
      zoomRequestId += 1;
      pendingZoomAnchor = null;
      clearPreviewHint();
      pendingZoomRender = { zoomToken: zoomPreviewToken, requestId: zoomRequestId, anchor: null };
      scheduleRender(false);
      return;
    }
    const anchorInfo = captureAnchor(anchor);
    const requestId = ++zoomRequestId;
    const zoomToken = showPreviewHint(Number(value), anchorInfo);
    pendingZoomAnchor = anchorInfo;
    pendingZoomRender = { zoomToken, requestId, anchor: anchorInfo };
    scheduleRender(defer);
  }

  function handleWheel(event) {
    const canvasScroll = getCanvasScroll();
    if (disposed || isDisposed() || hasActiveOperation() || !hasDocument() || !canvasScroll?.contains(event.target)) return;
    const currentScale = getCurrentScale();
    const delta = event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * Math.max(1, canvasScroll.clientHeight)
        : event.deltaY;
    if (!Number.isFinite(delta) || delta === 0) return;
    event.preventDefault();
    const factor = Math.max(0.88, Math.min(1.14, Math.exp(-delta * 0.0015)));
    const nextScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, currentScale * factor));
    if (Math.abs(nextScale - currentScale) < 0.001) return;
    setZoom('manual', nextScale, { clientX: event.clientX, clientY: event.clientY }, { defer: true });
  }

  function changeBy(factor) {
    if (hasActiveOperation() || !hasDocument()) return;
    const currentScale = getCurrentScale();
    const nextScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, currentScale * factor));
    if (Math.abs(nextScale - currentScale) < 0.001) return;
    setZoom('manual', nextScale);
  }

  function stopRepeat() {
    if (zoomRepeatDelayTimer) {
      clearTimer(zoomRepeatDelayTimer);
      zoomRepeatDelayTimer = null;
    }
    if (zoomRepeatTimer) {
      clearIntervalRef(zoomRepeatTimer);
      zoomRepeatTimer = null;
    }
  }

  function bindButton(button, factor) {
    if (!button) return;
    button.addEventListener('pointerdown', event => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      zoomPointerAction = true;
      try { button.setPointerCapture?.(event.pointerId); } catch (_) {}
      changeBy(factor);
      stopRepeat();
      zoomRepeatDelayTimer = setTimer(() => {
        if (!zoomPointerAction) return;
        zoomRepeatTimer = setIntervalRef(() => changeBy(factor), 90);
      }, 280);
    }, listenerOptions);
    button.addEventListener('pointerup', () => stopRepeat(), listenerOptions);
    button.addEventListener('pointercancel', () => {
      stopRepeat();
      zoomPointerAction = false;
    }, listenerOptions);
    button.addEventListener('click', event => {
      if (zoomPointerAction) {
        event.preventDefault();
        zoomPointerAction = false;
        return;
      }
      changeBy(factor);
    }, listenerOptions);
  }

  function commitRender(zoomToken, zoomRequest, scale) {
    setRenderedScale(scale);
    if (zoomRequest?.requestId === zoomRequestId) {
      clearPreviewHint(zoomToken);
      applyAnchor(zoomRequest.anchor, scale);
      if (pendingZoomAnchor === zoomRequest.anchor) pendingZoomAnchor = null;
    }
  }

  function isCurrentRequest(zoomRequest) {
    return !zoomRequest || zoomRequest.requestId === zoomRequestId;
  }

  function reset() {
    stopRepeat();
    beginRender();
    zoomRequestId += 1;
    pendingZoomAnchor = null;
    pendingZoomRender = null;
    zoomPointerAction = false;
    clearPreviewHint();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    reset();
  }

  return {
    beginRender,
    bindButton,
    changeBy,
    clearPreviewHint,
    commitRender,
    dispose,
    getCurrentScale,
    getPreviewToken: () => zoomPreviewToken,
    getState,
    handleWheel,
    isCurrentRequest,
    reset,
    scheduleMenuPosition,
    setLastRenderScale: setRenderedScale,
    setState,
    setZoom,
    showPreviewHint,
    stopRepeat
  };
}
