import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createPreviewViewport } from '../../shared/preview-viewport.js';
import { renderPdfPreviewCanvas } from '../../shared/pdf-preview-canvas.js';
import {
  PDF_CROP_FULL_RECT,
  PDF_CROP_LIMITS,
  normalizePdfCropRect,
  pdfCropMarginsToRect,
  pdfCropRectToMargins
} from './core.js';
import { releasePdfCropSource, stagePdfCropDocument } from './document.js';
import {
  calculatePdfCropInteractionRect,
  createLatestFrameScheduler,
  normalizePdfCropPointer
} from './interaction.js';
import { createPausableRenderQueue } from './thumbnail-queue.js';
import {
  formatPdfCropBytes, formatPdfCropDimensions, formatPdfCropUnitValue,
  pdfCropSnapshotsEqual,
  pdfCropUnitFactor,
  releasePdfCropCanvas,
  snapshotPdfCropPages
} from './utils.js';

const THUMB_WIDTH = 96;
const THUMB_HEIGHT = 68;
const THUMB_CONCURRENCY = 2;
const PREVIEW_MIN_ZOOM = 0.45;
const PREVIEW_MAX_ZOOM = 3.2;
const HISTORY_LIMIT = 60;

export function createPdfCropWorkspace({
  overlay,
  text,
  refreshIcons,
  customSelectControls,
  isBusy,
  isOpen,
  onStateChange
}) {
  const byId = id => document.getElementById(id);
  const prevButton = byId('pdfCropPrev');
  const nextButton = byId('pdfCropNext');
  const pageIndicator = byId('pdfCropPageIndicator');
  const zoomOutButton = byId('pdfCropZoomOut');
  const zoomInButton = byId('pdfCropZoomIn');
  const fitButton = byId('pdfCropFit');
  const zoomValue = byId('pdfCropZoomValue');
  const canvasScroll = byId('pdfCropCanvasScroll');
  const canvasWrap = byId('pdfCropCanvasWrap');
  const previewCanvas = byId('pdfCropPreviewCanvas');
  const emptyState = byId('pdfCropEmpty');
  const interactionLayer = byId('pdfCropInteractionLayer');
  const selection = byId('pdfCropSelection');
  const sizeBadge = byId('pdfCropSizeBadge');
  const previewStatus = byId('pdfCropPreviewStatus');
  const resetPageButton = byId('pdfCropResetPage');
  const filmstrip = byId('pdfCropFilmstrip');
  const pageCount = byId('pdfCropPageCount');
  const fileName = byId('pdfCropFileName');
  const fileMeta = byId('pdfCropFileMeta');
  const scopeNote = byId('pdfCropScopeNote');
  const unitSelect = byId('pdfCropUnit');
  const linkMarginsButton = byId('pdfCropLinkMargins');
  const marginInputs = Array.from(overlay.querySelectorAll('[data-margin-side]'));
  const dimension = byId('pdfCropDimension');
  const undoButton = byId('pdfCropUndo');
  const redoButton = byId('pdfCropRedo');
  const reframeButton = byId('pdfCropReframe');
  const resetAllButton = byId('pdfCropResetAll');
  const lifecycle = createLifecycleScope();
  const listen = (target, type, handler, options) => target
    ? lifecycle.event(target, type, handler, options)
    : () => {};
  let disposed = false;
  let source = null;
  let pages = [];
  let currentIndex = 0;
  let scope = 'all';
  let marginsLinked = false;
  let reframeMode = false;
  let history = [];
  let future = [];
  let marginEditBefore = null;
  let marginEditingInput = null;
  let pointerState = null;
  let previewTask = null;
  let previewRequest = 0;
  let previewZoom = 1;
  let previewScale = 1;
  let thumbBatch = null;

  const pointerFrame = createLatestFrameScheduler(renderTransientCropRect, {
    requestFrame: handler => window.requestAnimationFrame(handler),
    cancelFrame: frame => window.cancelAnimationFrame(frame)
  });

  const currentPage = () => pages[currentIndex] || null;
  const hasDocument = () => Boolean(source && pages.length);
  const emitChange = () => onStateChange?.();
  const viewport = createPreviewViewport({ viewport: canvasScroll, content: canvasWrap,
    enabled: () => !disposed && isOpen() && !isBusy() && hasDocument() && !pointerState && !canvasWrap.hidden,
    getScale: () => previewZoom, min: PREVIEW_MIN_ZOOM, max: PREVIEW_MAX_ZOOM,
    setScale: value => {
      const ratio = value / previewZoom; previewZoom = value; previewScale *= ratio;
      previewRequest++; try { previewTask?.cancel(); } catch {} previewTask = null;
      const rect = canvasWrap.getBoundingClientRect();
      for (const element of [canvasWrap, previewCanvas]) {
        element.style.width = rect.width * ratio + 'px'; element.style.height = rect.height * ratio + 'px';
      }
      renderCropOverlay(); emitChange();
    }, render: renderPreview });
  lifecycle.use(viewport.dispose);

  const releaseSource = releasePdfCropSource;
  const stageDocument = options => stagePdfCropDocument({ ...options, text });

  function cancelPreview() {
    previewRequest += 1;
    try { previewTask?.cancel(); } catch (_) {}
    previewTask = null;
    releasePdfCropCanvas(previewCanvas);
    if (canvasWrap) canvasWrap.hidden = true;
    if (interactionLayer) interactionLayer.hidden = true;
  }

  function releaseThumbs() {
    const batch = thumbBatch;
    thumbBatch = null;
    batch?.queue.dispose();
    batch?.owner.dispose();
    filmstrip.querySelectorAll('canvas').forEach(releasePdfCropCanvas);
  }

  function createPageThumb(page, owner) {
    const button = document.createElement('button');
    button.className = 'pdf-crop-page-thumb';
    button.type = 'button';
    button.dataset.pageIndex = String(page.index);
    const visual = document.createElement('span');
    visual.className = 'pdf-crop-page-thumb-visual';
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const box = document.createElement('i');
    box.className = 'pdf-crop-page-thumb-box';
    visual.append(canvas, box);
    const copy = document.createElement('span');
    copy.className = 'pdf-crop-page-thumb-copy';
    const title = document.createElement('b');
    title.textContent = text('home.pdfCrop.pageLabel', { page: page.index + 1 });
    const status = document.createElement('small');
    copy.append(title, status);
    button.append(visual, copy);
    owner.event(button, 'click', () => selectPage(page.index));
    return button;
  }

  function updateThumbState(page) {
    if (!page) return;
    const item = filmstrip.querySelector(`[data-page-index="${page.index}"]`);
    if (!item) return;
    item.classList.toggle('is-current', page.index === currentIndex);
    item.classList.toggle('has-crop', page.explicit);
    const status = item.querySelector('small');
    if (status) status.textContent = text(page.explicit ? 'home.pdfCrop.cropped' : 'home.pdfCrop.uncropped');
    const box = item.querySelector('.pdf-crop-page-thumb-box');
    const canvas = item.querySelector('canvas');
    const visual = item.querySelector('.pdf-crop-page-thumb-visual');
    if (!box || !canvas || !visual || !canvas.style.width) return;
    const width = parseFloat(canvas.style.width) || 0;
    const height = parseFloat(canvas.style.height) || 0;
    box.style.left = `${(visual.clientWidth - width) / 2 + page.rect.x * width}px`;
    box.style.top = `${(visual.clientHeight - height) / 2 + page.rect.y * height}px`;
    box.style.width = `${page.rect.width * width}px`;
    box.style.height = `${page.rect.height * height}px`;
  }

  function updateThumbStates() {
    pages.forEach(updateThumbState);
  }

  async function renderThumbnail(batch, pageIndex) {
    const item = filmstrip.querySelector(`[data-page-index="${pageIndex}"]`);
    const canvas = item?.querySelector('canvas');
    const documentHandle = source?.pdfDoc;
    if (!documentHandle || !item || !canvas || batch !== thumbBatch || batch.owner.disposed) return;
    let proxy = null;
    let renderTask = null;
    let releaseTask = () => {};
    try {
      proxy = await documentHandle.getPage(pageIndex + 1);
      if (batch !== thumbBatch || source?.pdfDoc !== documentHandle || batch.owner.disposed) return;
      if (batch.queue.paused) {
        batch.queue.requeue(pageIndex);
        return;
      }
      const base = proxy.getViewport({ scale: 1 });
      const scale = Math.min(THUMB_WIDTH / base.width, THUMB_HEIGHT / base.height);
      const viewport = proxy.getViewport({ scale });
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(viewport.width * dpr));
      canvas.height = Math.max(1, Math.round(viewport.height * dpr));
      canvas.style.width = `${Math.round(viewport.width)}px`;
      canvas.style.height = `${Math.round(viewport.height)}px`;
      renderTask = proxy.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0]
      });
      const releaseTrackedTask = batch.queue.track(pageIndex, renderTask);
      releaseTask = batch.owner.use(() => { try { renderTask.cancel(); } catch (_) {} });
      try {
        await renderTask.promise;
      } finally {
        releaseTrackedTask();
      }
      if (batch !== thumbBatch || source?.pdfDoc !== documentHandle || batch.owner.disposed) return;
      if (batch.queue.paused) return batch.queue.requeue(pageIndex);
      item.dataset.thumbState = 'ready';
      updateThumbState(pages[pageIndex]);
    } catch (error) {
      if (batch === thumbBatch && !batch.owner.disposed
        && (batch.queue.paused || error?.name === 'RenderingCancelledException')) {
        batch.queue.requeue(pageIndex);
      } else if (batch === thumbBatch) {
        item.dataset.thumbState = 'error';
      }
    } finally {
      releaseTask();
      proxy?.cleanup?.();
    }
  }

  function enqueueThumbnail(batch, pageIndex) {
    const item = filmstrip.querySelector(`[data-page-index="${pageIndex}"]`);
    if (batch !== thumbBatch || !item || item.dataset.thumbState) return;
    item.dataset.thumbState = 'queued';
    batch.queue.enqueue(pageIndex);
  }

  function renderFilmstrip() {
    releaseThumbs();
    const fragment = document.createDocumentFragment();
    if (!pages.length) {
      filmstrip.replaceChildren(fragment);
      filmstrip.classList.add('is-empty');
      refreshIcons();
      return;
    }
    const owner = createLifecycleScope();
    const batch = { owner, queue: null };
    batch.queue = createPausableRenderQueue({
      concurrency: THUMB_CONCURRENCY,
      run: pageIndex => renderThumbnail(batch, pageIndex)
    });
    thumbBatch = batch;
    pages.forEach(page => fragment.appendChild(createPageThumb(page, owner)));
    filmstrip.replaceChildren(fragment);
    filmstrip.classList.remove('is-empty');
    updateThumbStates();
    if (typeof IntersectionObserver === 'function') {
      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          enqueueThumbnail(batch, Number(entry.target.dataset.pageIndex));
        });
      }, { root: filmstrip, rootMargin: '0px 260px' });
      owner.use(() => observer.disconnect());
      filmstrip.querySelectorAll('[data-page-index]').forEach(item => observer.observe(item));
    } else {
      pages.forEach(page => enqueueThumbnail(batch, page.index));
    }
    refreshIcons();
  }

  function setThumbnailsPaused(paused) {
    if (!thumbBatch) return;
    paused ? thumbBatch.queue.pause() : thumbBatch.queue.resume();
  }

  function isPreviewCurrent(request, documentHandle) {
    return !disposed && request === previewRequest && source?.pdfDoc === documentHandle && isOpen();
  }

  async function renderPreview() {
    const request = ++previewRequest;
    try { previewTask?.cancel(); } catch (_) {}
    previewTask = null;
    const page = currentPage();
    const documentHandle = source?.pdfDoc;
    if (!page || !documentHandle) {
      cancelPreview();
      renderCropOverlay();
      return;
    }
    let proxy = null;
    try {
      proxy = await documentHandle.getPage(page.index + 1);
      if (!isPreviewCurrent(request, documentHandle)) return;
      const base = proxy.getViewport({ scale: 1 });
      page.displayWidth = base.width;
      page.displayHeight = base.height;
      page.rotation = proxy.rotate || 0;
      const availableWidth = Math.max(260, canvasScroll.clientWidth - 64);
      const availableHeight = Math.max(230, canvasScroll.clientHeight - 64);
      const fitScale = Math.min(availableWidth / base.width, availableHeight / base.height, 1.6);
      previewScale = Math.max(0.08, fitScale * previewZoom);
      previewTask = renderPdfPreviewCanvas({ proxy, canvas: previewCanvas, wrap: canvasWrap, scale: previewScale,
        isCurrent: () => isPreviewCurrent(request, documentHandle) });
      await previewTask.promise;
      if (!isPreviewCurrent(request, documentHandle)) return;
      previewTask = null;
      renderCropOverlay();
      if (previewStatus) previewStatus.textContent = text('home.pdfCrop.previewReady', { page: page.index + 1 });
    } catch (error) {
      if (!isPreviewCurrent(request, documentHandle) || error?.name === 'RenderingCancelledException') return;
      console.error('[PDF Crop] preview failed:', error);
      if (previewStatus) previewStatus.textContent = text('home.pdfCrop.previewFailed');
    } finally {
      proxy?.cleanup?.();
    }
  }

  function replaceDocument(staged) {
    viewport.reset();
    const previous = source;
    cancelPointer({ render: false });
    cancelPreview();
    releaseThumbs();
    source = staged.source;
    pages = staged.pages;
    currentIndex = 0;
    scope = 'all';
    marginsLinked = false;
    reframeMode = false;
    history = [];
    future = [];
    previewZoom = 1;
    renderLinkButton();
    renderFilmstrip();
    refreshControls();
    return previous;
  }

  async function resetDocument() {
    viewport.reset();
    cancelPointer({ render: false });
    marginEditBefore = null;
    marginEditingInput = null;
    cancelPreview();
    releaseThumbs();
    const previous = source;
    source = null;
    pages = [];
    currentIndex = 0;
    scope = 'all';
    marginsLinked = false;
    reframeMode = false;
    history = [];
    future = [];
    previewZoom = 1;
    filmstrip.replaceChildren();
    renderFilmstrip();
    renderLinkButton();
    refreshControls();
    await releaseSource(previous);
  }

  function updateMarginFields() {
    const page = currentPage();
    if (!page) {
      marginInputs.forEach(input => { input.value = '0'; });
      return;
    }
    const margins = pdfCropRectToMargins(page.rect, { width: page.displayWidth, height: page.displayHeight });
    marginInputs.forEach(input => {
      if (document.activeElement === input && marginEditingInput === input) return;
      input.value = formatPdfCropUnitValue(margins[input.dataset.marginSide], unitSelect?.value);
    });
  }

  function beginMarginEdit(input) {
    marginEditingInput = input;
    marginEditBefore ||= snapshotPdfCropPages(pages);
  }

  function finishMarginEdit(input) {
    if (marginEditingInput !== input) return;
    if (marginEditBefore) commitHistory(marginEditBefore);
    marginEditBefore = null;
    marginEditingInput = null;
  }

  function updateDimension() {
    const page = currentPage();
    if (!dimension) return;
    dimension.textContent = page ? formatPdfCropDimensions(page.rect, page, unitSelect?.value) : '-';
  }

  function renderSelectionGeometry(rect, page) {
    selection.style.left = `${rect.x * 100}%`;
    selection.style.top = `${rect.y * 100}%`;
    selection.style.width = `${rect.width * 100}%`;
    selection.style.height = `${rect.height * 100}%`;
    if (sizeBadge) sizeBadge.textContent = formatPdfCropDimensions(rect, page, unitSelect?.value, true);
  }

  function renderTransientCropRect(value) {
    const page = currentPage();
    if (!page || canvasWrap.hidden) return;
    interactionLayer.hidden = false;
    interactionLayer.classList.remove('is-unset');
    renderSelectionGeometry(normalizePdfCropRect(value), page);
  }

  function renderCropOverlay() {
    const page = currentPage();
    if (!page || canvasWrap.hidden) {
      interactionLayer.hidden = true;
      return;
    }
    interactionLayer.hidden = false;
    renderSelectionGeometry(normalizePdfCropRect(page.rect), page);
    interactionLayer.classList.toggle('is-unset', !page.explicit);
    interactionLayer.classList.toggle('is-reframing', reframeMode);
    updateMarginFields();
    updateDimension();
  }

  function refreshControls() {
    const busy = isBusy();
    const page = currentPage();
    const hasCrop = pages.some(item => item.explicit);
    const scopedCount = scope === 'all' ? pages.length : (page ? 1 : 0);
    if (pageIndicator) pageIndicator.textContent = page
      ? text('home.pdfCrop.pageIndicator', { current: currentIndex + 1, total: pages.length })
      : text('home.pdfCrop.noDocument');
    if (pageCount) pageCount.textContent = text('home.pdfCrop.totalPages', { count: pages.length });
    if (fileName) fileName.textContent = source?.name || text('home.pdfCrop.noFile');
    if (fileMeta) fileMeta.textContent = source
      ? text('home.pdfCrop.fileMeta', { pages: pages.length, size: formatPdfCropBytes(source.size) })
      : text('home.pdfCrop.localOnly');
    if (scopeNote) scopeNote.textContent = hasDocument()
      ? text(scope === 'all' ? 'home.pdfCrop.scopeAllStatus' : 'home.pdfCrop.scopeCurrentStatus', { count: scopedCount, page: currentIndex + 1 })
      : text('home.pdfCrop.scopeEmpty');
    overlay.querySelectorAll('[data-crop-scope]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.cropScope === scope);
      button.disabled = busy || !hasDocument();
    });
    if (prevButton) prevButton.disabled = busy || currentIndex <= 0;
    if (nextButton) nextButton.disabled = busy || currentIndex >= pages.length - 1;
    if (zoomOutButton) zoomOutButton.disabled = !hasDocument() || previewZoom <= PREVIEW_MIN_ZOOM;
    if (zoomInButton) zoomInButton.disabled = !hasDocument() || previewZoom >= PREVIEW_MAX_ZOOM;
    if (fitButton) fitButton.disabled = !hasDocument();
    if (zoomValue) zoomValue.textContent = `${Math.round(previewZoom * 100)}%`;
    if (resetPageButton) resetPageButton.disabled = busy || !page?.explicit;
    if (resetAllButton) resetAllButton.disabled = busy || !hasCrop;
    if (undoButton) undoButton.disabled = busy || !history.length;
    if (redoButton) redoButton.disabled = busy || !future.length;
    if (reframeButton) {
      reframeButton.disabled = busy || !hasDocument();
      reframeButton.setAttribute('aria-pressed', String(reframeMode));
    }
    if (linkMarginsButton) linkMarginsButton.disabled = busy || !hasDocument();
    if (unitSelect) unitSelect.disabled = busy || !hasDocument();
    customSelectControls.forEach(control => control.refresh());
    marginInputs.forEach(input => { input.disabled = busy || !hasDocument(); });
    if (emptyState) emptyState.hidden = hasDocument();
    if (!hasDocument()) canvasWrap.hidden = true;
    if (previewStatus && !hasDocument()) previewStatus.textContent = text('home.pdfCrop.previewEmpty');
    linkMarginsButton?.setAttribute('aria-pressed', String(marginsLinked));
    renderCropOverlay();
  }

  function refreshCropState(syncInputs = true) {
    updateThumbStates();
    renderCropOverlay();
    if (syncInputs) updateMarginFields();
    emitChange();
  }

  function applySnapshot(snapshot) {
    if (!Array.isArray(snapshot) || snapshot.length !== pages.length) return;
    pages.forEach((page, index) => {
      page.rect = normalizePdfCropRect(snapshot[index].rect);
      page.explicit = Boolean(snapshot[index].explicit);
    });
    refreshCropState();
  }

  function commitHistory(before) {
    const after = snapshotPdfCropPages(pages);
    if (!before || pdfCropSnapshotsEqual(before, after)) return false;
    history.push(before);
    if (history.length > HISTORY_LIMIT) history.shift();
    future = [];
    emitChange();
    return true;
  }

  function undo() {
    if (!history.length || isBusy()) return;
    future.push(snapshotPdfCropPages(pages));
    applySnapshot(history.pop());
  }

  function redo() {
    if (!future.length || isBusy()) return;
    history.push(snapshotPdfCropPages(pages));
    applySnapshot(future.pop());
  }

  function applyRectToScope(rect, explicit = true, selectedScope = scope) {
    const normalized = normalizePdfCropRect(rect);
    if (selectedScope === 'all') {
      pages.forEach(page => { page.rect = { ...normalized }; page.explicit = explicit; });
    } else {
      const page = currentPage();
      if (page) { page.rect = { ...normalized }; page.explicit = explicit; }
    }
    refreshCropState();
  }

  function applyMarginsToScope() {
    const factor = pdfCropUnitFactor(unitSelect?.value);
    const margins = Object.fromEntries(marginInputs.map(input => [
      input.dataset.marginSide,
      Math.max(0, Number(input.value) || 0) * factor
    ]));
    const targets = scope === 'all' ? pages : [currentPage()].filter(Boolean);
    targets.forEach(page => {
      page.rect = pdfCropMarginsToRect(margins, { width: page.displayWidth, height: page.displayHeight });
      page.explicit = true;
    });
    refreshCropState(false);
  }

  function selectPage(index) {
    if (!Number.isInteger(index) || index < 0 || index >= pages.length || index === currentIndex) return;
    viewport.reset();
    currentIndex = index;
    reframeMode = false;
    emitChange();
    updateThumbStates();
    filmstrip.querySelector(`[data-page-index="${index}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    void renderPreview();
  }

  function resetCurrentPage() {
    const page = currentPage();
    if (!page?.explicit) return;
    const before = snapshotPdfCropPages(pages);
    page.rect = { ...PDF_CROP_FULL_RECT };
    page.explicit = false;
    commitHistory(before);
    refreshCropState();
  }

  function resetAllPages() {
    if (!pages.some(page => page.explicit)) return;
    const before = snapshotPdfCropPages(pages);
    pages.forEach(page => { page.rect = { ...PDF_CROP_FULL_RECT }; page.explicit = false; });
    commitHistory(before);
    reframeMode = false;
    refreshCropState();
  }

  function beginCropPointer(event) {
    if (!hasDocument() || isBusy() || event.button !== 0) return;
    const page = currentPage();
    const handle = event.target.closest('[data-handle]')?.dataset.handle || '';
    const insideSelection = Boolean(event.target.closest('#pdfCropSelection'));
    let mode = '';
    if (handle && page.explicit && !reframeMode) mode = 'resize';
    else if (insideSelection && page.explicit && !reframeMode) mode = 'move';
    else if (!page.explicit || reframeMode) mode = 'draw';
    if (!mode) return;
    event.preventDefault();
    const rawBounds = interactionLayer.getBoundingClientRect();
    const bounds = {
      left: rawBounds.left,
      top: rawBounds.top,
      width: rawBounds.width,
      height: rawBounds.height
    };
    const point = normalizePdfCropPointer(event, bounds);
    const minWidth = Math.min(0.5, PDF_CROP_LIMITS.minCropPoints / Math.max(1, page.displayWidth || 1));
    const minHeight = Math.min(0.5, PDF_CROP_LIMITS.minCropPoints / Math.max(1, page.displayHeight || 1));
    const initialRect = mode === 'draw'
      ? calculatePdfCropInteractionRect({ mode, start: point, point, rect: page.rect, minWidth, minHeight })
      : { ...page.rect };
    pointerState = {
      pointerId: event.pointerId,
      mode,
      handle,
      start: point,
      startClientX: event.clientX,
      startClientY: event.clientY,
      rect: { ...page.rect },
      latestRect: initialRect,
      bounds,
      minWidth,
      minHeight,
      scope,
      before: snapshotPdfCropPages(pages),
      moved: false
    };
    interactionLayer.classList.add('is-drawing', 'is-interacting');
    setThumbnailsPaused(true);
    try { interactionLayer.setPointerCapture(event.pointerId); } catch (_) {}
    if (mode === 'draw') renderTransientCropRect(initialRect);
  }

  function handleCropPointerMove(event) {
    const state = pointerState;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = normalizePdfCropPointer(event, state.bounds);
    state.moved ||= Math.hypot(event.clientX - state.startClientX, event.clientY - state.startClientY) >= 4;
    state.latestRect = calculatePdfCropInteractionRect({
      mode: state.mode,
      handle: state.handle,
      start: state.start,
      point,
      rect: state.rect,
      minWidth: state.minWidth,
      minHeight: state.minHeight
    });
    pointerFrame.schedule(state.latestRect);
  }

  function cancelPointer({ render = true } = {}) {
    const state = pointerState;
    pointerState = null;
    pointerFrame.cancel();
    interactionLayer.classList.remove('is-drawing', 'is-interacting');
    setThumbnailsPaused(false);
    if (state) {
      try { interactionLayer.releasePointerCapture(state.pointerId); } catch (_) {}
    }
    if (render) renderCropOverlay();
    return state;
  }

  function endCropPointer(event) {
    const state = pointerState;
    if (!state || state.pointerId !== event.pointerId) return;
    pointerFrame.flush();
    cancelPointer({ render: false });
    reframeMode = false;
    if (state.mode === 'draw' && !state.moved) {
      emitChange();
      return;
    }
    applyRectToScope(state.latestRect, true, state.scope);
    commitHistory(state.before);
  }

  function abortCropPointer(event) {
    if (!pointerState || pointerState.pointerId !== event.pointerId) return;
    cancelPointer();
  }

  function renderLinkButton() {
    if (!linkMarginsButton) return;
    const icon = document.createElement('i');
    icon.dataset.lucide = marginsLinked ? 'link-2' : 'unlink';
    const label = document.createElement('span');
    label.textContent = text(marginsLinked ? 'home.pdfCrop.linkedMargins' : 'home.pdfCrop.linkMargins');
    linkMarginsButton.replaceChildren(icon, label);
    refreshIcons();
  }

  function cancelReframe() {
    if (!reframeMode) return false;
    reframeMode = false;
    emitChange();
    return true;
  }

  function handleShortcut(event) {
    const tag = event.target?.tagName?.toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag)) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectPage(currentIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectPage(currentIndex + 1);
    }
  }

  function startSession(owner) {
    let renderTimer = 0;
    const observer = new ResizeObserver(() => {
      if (!isOpen() || !hasDocument() || isBusy()) return;
      window.clearTimeout(renderTimer);
      renderTimer = window.setTimeout(() => { void renderPreview(); }, 120);
    });
    observer.observe(canvasScroll);
    owner.use(() => {
      viewport.reset();
      window.clearTimeout(renderTimer);
      observer.disconnect();
      cancelPointer();
    });
  }

  function refresh() {
    renderFilmstrip();
    renderLinkButton();
    refreshControls();
  }

  listen(prevButton, 'click', () => selectPage(currentIndex - 1));
  listen(nextButton, 'click', () => selectPage(currentIndex + 1));
  listen(zoomOutButton, 'click', () => viewport.zoomTo(previewZoom * 0.86));
  listen(zoomInButton, 'click', () => viewport.zoomTo(previewZoom * 1.16));
  listen(fitButton, 'click', () => { viewport.reset(); previewZoom = 1; emitChange(); void renderPreview(); });
  listen(resetPageButton, 'click', resetCurrentPage);
  listen(undoButton, 'click', undo);
  listen(redoButton, 'click', redo);
  listen(resetAllButton, 'click', resetAllPages);
  listen(reframeButton, 'click', () => { reframeMode = !reframeMode; emitChange(); });
  listen(interactionLayer, 'pointerdown', beginCropPointer);
  listen(document, 'pointermove', handleCropPointerMove, { passive: false });
  listen(document, 'pointerup', endCropPointer);
  listen(document, 'pointercancel', abortCropPointer);
  overlay.querySelectorAll('[data-crop-scope]').forEach(button => {
    listen(button, 'click', () => {
      scope = button.dataset.cropScope === 'current' ? 'current' : 'all';
      emitChange();
    });
  });
  listen(linkMarginsButton, 'click', () => {
    marginsLinked = !marginsLinked;
    renderLinkButton();
    emitChange();
  });
  listen(unitSelect, 'change', () => {
    updateMarginFields();
    updateDimension();
    renderCropOverlay();
  });
  marginInputs.forEach(input => {
    listen(input, 'focus', () => beginMarginEdit(input));
    listen(input, 'input', () => {
      if (marginsLinked) marginInputs.forEach(candidate => { if (candidate !== input) candidate.value = input.value; });
      applyMarginsToScope();
    });
    listen(input, 'change', () => {
      if (document.activeElement !== input) finishMarginEdit(input);
      refreshCropState();
    });
    listen(input, 'blur', () => finishMarginEdit(input));
  });

  renderLinkButton();
  refreshControls();

  async function dispose() {
    if (disposed) return;
    await resetDocument();
    disposed = true;
    lifecycle.dispose();
  }

  return {
    cancelReframe,
    dispose,
    getExportState: () => ({
      bytes: source?.bytes,
      crops: pages.map(page => ({ rect: { ...page.rect }, explicit: page.explicit, rotation: page.rotation })),
      currentIndex,
      pageCount: pages.length,
      sourceName: source?.name || 'document.pdf'
    }),
    hasCrop: () => pages.some(page => page.explicit),
    hasCurrentCrop: () => Boolean(currentPage()?.explicit),
    hasDocument,
    handleShortcut,
    refresh,
    refreshControls,
    releaseSource,
    renderPreview,
    replaceDocument,
    resetDocument,
    stageDocument,
    startSession
  };
}
