import {
  isPdfEditorRenderCancellation,
  releasePdfEditorCanvas
} from './render-utils.js';

const THUMB_CSS_WIDTH = 132;
const THUMB_CSS_HEIGHT = 176;
const THUMB_CONCURRENCY = 2;
const THUMB_RELEASE_DELAY = 1500;

/**
 * Owns PDF Editor page tiles, lazy thumbnail rendering and page reordering.
 * Document state remains in the feature orchestrator and is exposed through
 * accessors so this module cannot retain stale arrays across a reopen.
 */
export function createPdfEditorThumbnails({
  pageStrip,
  t,
  listenerOptions,
  getPages,
  setPages,
  getSelectedIds,
  getCurrentId,
  setCurrentId,
  getActiveOperation,
  isDisposed = () => false,
  hasDocument = () => true,
  cacheSourceRotation,
  effectivePageRotation,
  getSourceDoc,
  retainPage = page => () => { try { page.cleanup(); } catch {} },
  toggleSelect,
  selectRange,
  setCurrent,
  updateControls,
  renderMainPreview,
  commitEditorHistory,
  documentRef = globalThis.document,
  windowRef = globalThis.window
} = {}) {
  if (!pageStrip || typeof getPages !== 'function' || typeof setPages !== 'function') {
    throw new TypeError('PDF editor thumbnails require page state accessors');
  }

  let pageStates = new Map();
  let tileObserver = null;
  let tileQueue = [];
  let tileActive = 0;
  let tileEpoch = 0;
  let dragState = null;
  let disposed = false;

  function isInactive() {
    return disposed || isDisposed();
  }

  function pageStateFor(id) {
    return pageStates.get(id);
  }

  function releasePreview(pageState, markReleased = true) {
    if (!pageState) return;
    clearTimeout(pageState.releaseTimer);
    pageState.releaseTimer = null;
    if (pageState.renderTask) {
      try { pageState.renderTask.cancel(); } catch (_) {}
      pageState.renderTask = null;
    }
    if (pageState.canvas) {
      releasePdfEditorCanvas(pageState.canvas);
      pageState.canvas = null;
    }
    pageState.queued = false;
    pageState.frame?.classList.remove('is-ready');
    pageState.frame?.classList.toggle('is-released', markReleased);
  }

  function stop(releaseAll = false) {
    tileObserver?.disconnect();
    tileObserver = null;
    tileQueue = [];
    tileEpoch += 1;
    for (const pageState of pageStates.values()) {
      clearTimeout(pageState.releaseTimer);
      pageState.releaseTimer = null;
      pageState.nearby = false;
      if (pageState.renderTask) {
        try { pageState.renderTask.cancel(); } catch (_) {}
      }
      if (releaseAll) releasePreview(pageState, false);
    }
  }

  function clear() {
    stop(true);
    pageStates = new Map();
    pageStrip.replaceChildren();
    dragState = null;
  }

  function onTileDragStart(event, pageState) {
    if (getActiveOperation()) return;
    dragState = { pageState };
    event.dataTransfer.effectAllowed = 'move';
    try { event.dataTransfer.setData('text/plain', String(pageState.id)); } catch (_) {}
    pageState.tile.classList.add('is-dragging');
    (windowRef?.requestAnimationFrame || globalThis.requestAnimationFrame)?.(() => {
      pageState.tile.classList.add('is-drag-ghost');
    });
  }

  function onTileDragOver(event, pageState) {
    if (!dragState || dragState.pageState === pageState) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = pageState.tile.getBoundingClientRect();
    const after = (event.clientY - rect.top) > rect.height / 2;
    const dragged = dragState.pageState.tile;
    if (after) {
      if (pageState.tile.nextSibling !== dragged) pageStrip.insertBefore(dragged, pageState.tile.nextSibling);
    } else if (pageState.tile !== dragged) {
      pageStrip.insertBefore(dragged, pageState.tile);
    }
  }

  function finalizeTileDrag() {
    if (!dragState) return;
    const pages = getPages();
    const previousOrder = pages.map(page => page.id);
    const dragged = dragState.pageState;
    dragState = null;
    dragged.tile.classList.remove('is-dragging', 'is-drag-ghost');
    const orderedIds = Array.from(pageStrip.children)
      .map(tile => tile.dataset.id)
      .filter(Boolean);
    const byId = new Map(pages.map(page => [page.id, page]));
    const nextPages = orderedIds.map(id => byId.get(id)).filter(Boolean);
    setPages(nextPages);
    for (let index = 0; index < nextPages.length; index += 1) {
      const pageState = pageStates.get(nextPages[index].id);
      if (pageState) pageState.indexEl.textContent = String(index + 1);
    }
    updateControls?.();
    if (previousOrder.some((id, index) => id !== nextPages[index]?.id)) {
      commitEditorHistory?.();
    }
  }

  function onTileDrop(event) {
    event.preventDefault();
    finalizeTileDrag();
  }

  function onTileDragEnd() {
    finalizeTileDrag();
  }

  function build(shouldRender = true) {
    stop(true);
    pageStates = new Map();
    const fragment = documentRef.createDocumentFragment();
    const selectedIds = getSelectedIds();
    const pages = getPages();
    pages.forEach((pageModel, index) => {
      const tile = documentRef.createElement('article');
      tile.className = 'pdf-editor-tile';
      tile.dataset.id = pageModel.id;
      tile.draggable = true;

      const frame = documentRef.createElement('span');
      frame.className = 'pdf-editor-tile-frame';
      const skeleton = documentRef.createElement('span');
      skeleton.className = 'pdf-editor-tile-skeleton';
      skeleton.setAttribute('aria-hidden', 'true');
      skeleton.innerHTML = '<span></span><span></span><span></span><span></span><span></span>';
      const errorEl = documentRef.createElement('span');
      errorEl.className = 'pdf-editor-tile-error';
      errorEl.textContent = t('home.pdfEditor.thumbnailError');
      const indexEl = documentRef.createElement('span');
      indexEl.className = 'pdf-editor-tile-index';
      indexEl.textContent = String(index + 1);
      const dragHandle = documentRef.createElement('span');
      dragHandle.className = 'pdf-editor-tile-drag';
      dragHandle.setAttribute('aria-hidden', 'true');
      dragHandle.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg>';
      const selectButton = documentRef.createElement('button');
      selectButton.type = 'button';
      selectButton.className = 'pdf-editor-tile-select';
      selectButton.setAttribute('aria-pressed', String(selectedIds.has(pageModel.id)));
      selectButton.setAttribute('aria-label', t('home.pdfEditor.pageLabel', { page: index + 1 }));
      selectButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.2 4.2L19 6.8"></path></svg>';
      frame.append(skeleton, errorEl);
      tile.append(dragHandle, indexEl, frame, selectButton);
      fragment.appendChild(tile);

      const pageState = {
        id: pageModel.id,
        model: pageModel,
        tile,
        frame,
        indexEl,
        errorEl,
        selectButton,
        canvas: null,
        renderTask: null,
        releaseTimer: null,
        nearby: false,
        queued: false,
        error: false
      };
      pageStates.set(pageModel.id, pageState);

      tile.addEventListener('click', event => {
        if (getActiveOperation()) return;
        if (event.metaKey || event.ctrlKey) toggleSelect?.(pageState);
        else if (event.shiftKey) selectRange?.(pageState);
        else {
          setCurrent?.(pageState);
        }
      }, listenerOptions);
      selectButton.addEventListener('click', event => {
        if (getActiveOperation()) return;
        event.stopPropagation();
        toggleSelect?.(pageState);
      }, listenerOptions);
      tile.addEventListener('dragstart', event => onTileDragStart(event, pageState), listenerOptions);
      tile.addEventListener('dragover', event => onTileDragOver(event, pageState), listenerOptions);
      tile.addEventListener('dragend', onTileDragEnd, listenerOptions);
      tile.addEventListener('drop', onTileDrop, listenerOptions);
    });
    pageStrip.replaceChildren(fragment);
    const currentId = getCurrentId();
    if (currentId && !pageStates.has(currentId)) setCurrentId?.(pages[0]?.id || null);
    if (!getCurrentId()) setCurrentId?.(pages[0]?.id || null);
    updateControls?.();
    startObserver();
    if (shouldRender) renderMainPreview?.();
  }

  function queuePreview(pageState) {
    if (!pageState || pageState.error || pageState.canvas || pageState.renderTask || pageState.queued) return;
    pageState.queued = true;
    pageState.frame?.classList.remove('is-released');
    tileQueue.push(pageState);
    drainQueue();
  }

  async function renderPreview(pageState, epoch) {
    let page = null;
    let releasePage = null;
    let canvas = null;
    let renderTask = null;
    try {
      if (epoch !== tileEpoch || !pageState.nearby || isInactive()) return;
      const doc = await getSourceDoc(pageState.model.sourceId);
      if (epoch !== tileEpoch || !pageState.nearby || isInactive()) return;
      page = await doc.getPage(pageState.model.pageIndex + 1);
      if (epoch !== tileEpoch || !pageState.nearby || isInactive()) return;
      releasePage = retainPage(page);
      cacheSourceRotation?.(pageState.model, page);
      const displayRotation = effectivePageRotation(pageState.model);
      const baseViewport = page.getViewport({ scale: 1, rotation: displayRotation });
      const cssScale = Math.min(THUMB_CSS_WIDTH / baseViewport.width, THUMB_CSS_HEIGHT / baseViewport.height);
      const outputScale = Math.min(2, Math.max(1, windowRef?.devicePixelRatio || 1));
      const viewport = page.getViewport({ scale: cssScale * outputScale, rotation: displayRotation });
      canvas = documentRef.createElement('canvas');
      canvas.className = 'pdf-editor-tile-canvas';
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      canvas.style.width = Math.max(1, Math.round(viewport.width / outputScale)) + 'px';
      canvas.style.height = Math.max(1, Math.round(viewport.height / outputScale)) + 'px';
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Cannot create thumbnail canvas');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      renderTask = page.render({ canvasContext: context, viewport, background: '#ffffff' });
      pageState.renderTask = renderTask;
      await renderTask.promise;
      if (pageState.renderTask === renderTask) pageState.renderTask = null;
      if (epoch !== tileEpoch || !pageState.nearby || isInactive()) {
        releasePdfEditorCanvas(canvas);
        canvas = null;
        return;
      }
      pageState.canvas = canvas;
      pageState.frame?.prepend(canvas);
      pageState.frame?.classList.remove('is-released', 'has-error');
      pageState.frame?.classList.add('is-ready');
      canvas = null;
    } catch (error) {
      if (pageState.renderTask === renderTask) pageState.renderTask = null;
      if (!isPdfEditorRenderCancellation(error) && epoch === tileEpoch && !isInactive()) {
        pageState.error = true;
        pageState.frame?.classList.add('has-error');
        pageState.errorEl.textContent = t('home.pdfEditor.thumbnailError');
      }
    } finally {
      if (pageState.renderTask === renderTask) pageState.renderTask = null;
      if (canvas) releasePdfEditorCanvas(canvas);
      releasePage?.();
      if (epoch === tileEpoch && !isInactive() && pageState.nearby && !pageState.canvas && !pageState.error) {
        queueMicrotask(() => {
          if (!isInactive() && epoch === tileEpoch && pageState.nearby) queuePreview(pageState);
        });
      }
    }
  }

  function drainQueue() {
    while (tileActive < THUMB_CONCURRENCY && tileQueue.length) {
      const pageState = tileQueue.shift();
      if (!pageState) continue;
      tileActive += 1;
      renderPreview(pageState, tileEpoch).finally(() => {
        tileActive = Math.max(0, tileActive - 1);
        drainQueue();
      });
    }
  }

  function startObserver() {
    if (!hasDocument() || isInactive()) return;
    stop(false);
    const epoch = tileEpoch;
    const IntersectionObserverCtor = windowRef?.IntersectionObserver || globalThis.IntersectionObserver;
    if (typeof IntersectionObserverCtor !== 'function') {
      getPages().slice(0, 12).forEach(page => {
        const pageState = pageStateFor(page.id);
        if (pageState) {
          pageState.nearby = true;
          queuePreview(pageState);
        }
      });
      return;
    }
    tileObserver = new IntersectionObserverCtor(entries => {
      if (epoch !== tileEpoch || isInactive()) return;
      for (const entry of entries) {
        const pageState = pageStateFor(entry.target.dataset.id);
        if (!pageState) continue;
        if (entry.isIntersecting) {
          clearTimeout(pageState.releaseTimer);
          pageState.releaseTimer = null;
          pageState.nearby = true;
          queuePreview(pageState);
        } else {
          pageState.nearby = false;
          clearTimeout(pageState.releaseTimer);
          pageState.releaseTimer = setTimeout(() => {
            if (!pageState.nearby) releasePreview(pageState);
          }, THUMB_RELEASE_DELAY);
        }
      }
    }, { root: pageStrip, rootMargin: '120px 0px', threshold: 0.01 });
    pageStates.forEach(pageState => tileObserver.observe(pageState.tile));
  }

  function refresh(pageState) {
    if (!pageState) return;
    pageState.error = false;
    pageState.frame?.classList.remove('has-error');
    releasePreview(pageState);
    if (pageState.nearby) queuePreview(pageState);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clear();
  }

  return {
    build,
    clear,
    dispose,
    getPageState: pageStateFor,
    getPageStates: () => pageStates,
    releasePreview,
    refresh,
    stop
  };
}
