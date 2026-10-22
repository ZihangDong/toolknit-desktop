import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createPreviewViewport } from '../../shared/preview-viewport.js';
import { renderPdfPreviewCanvas } from '../../shared/pdf-preview-canvas.js';
import { destroyPdfDocument } from '../../shared/pdfjs-options.js';
import { calculatePdfPageNumberLayout } from '../../pdf-page-number-core.js';

const THUMB_WIDTH = 116;
const THUMB_HEIGHT = 150;
const THUMB_CONCURRENCY = 2;
const PREVIEW_MIN_ZOOM = 0.45;
const PREVIEW_MAX_ZOOM = 3.2;

function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

async function destroySource(source) {
  if (!source || source.destroyed) return;
  source.destroyed = true;
  try {
    if (source.pdfDoc) await destroyPdfDocument(source.pdfDoc);
    else await source.loadingTask?.destroy?.();
  } catch (_) {}
  source.pdfDoc = null;
  source.loadingTask = null;
  source.bytes = null;
}

function isCancellation(error) {
  return error?.name === 'PdfPageNumberCancelledError'
    || error?.name === 'RenderingCancelledException'
    || /cancelled|canceled/i.test(String(error?.message || error || ''));
}

function icon(name) {
  const element = document.createElement('i');
  element.dataset.lucide = name;
  return element;
}

export function createPdfPageNumberWorkspace({
  overlay,
  pageList,
  canvasScroll,
  canvasWrap,
  previewCanvas,
  liveLayer,
  liveBackground,
  liveText,
  previewStatus,
  settingStatus,
  model,
  text,
  showToast,
  refreshIcons = () => {},
  isLocked = () => false,
  isDisposed = () => false,
  getSettings,
  getPlan,
  onStateChange = () => {}
} = {}) {
  const lifecycle = createLifecycleScope();
  let pageScope = null;
  let sourceIdSeed = 0;
  let pageIdSeed = 0;
  let thumbObserver = null;
  let thumbQueue = [];
  let thumbActive = 0;
  let thumbEpoch = 0;
  let thumbTasks = new Set();
  let previewTask = null;
  let previewRequest = 0;
  let previewZoom = 1;
  let previewScale = 1;
  let previewPageWidth = 1;
  let previewPageHeight = 1;
  let dragState = null;
  let suppressClickUntil = 0;
  let resizeObserver = null;
  let resizeTimer = null;

  const hasPages = () => model.pages.length > 0;
  const currentPageIndex = () => model.pages.findIndex(page => page.id === model.currentId);
  const currentPage = () => model.pages.find(page => page.id === model.currentId) || null;
  const pageSource = page => model.sources.find(source => source.id === page?.sourceId) || null;
  const viewport = createPreviewViewport({ viewport: canvasScroll, content: canvasWrap,
    enabled: () => !isDisposed() && overlay?.classList.contains('visible') && !isLocked() && hasPages() && !dragState && !canvasWrap.hidden,
    getScale: () => previewZoom, min: PREVIEW_MIN_ZOOM, max: PREVIEW_MAX_ZOOM,
    setScale: value => {
      const ratio = value / previewZoom; previewZoom = value; previewScale *= ratio;
      previewRequest++; try { previewTask?.cancel(); } catch {} previewTask = null;
      const rect = canvasWrap.getBoundingClientRect();
      for (const element of [canvasWrap, previewCanvas]) {
        element.style.width = rect.width * ratio + 'px'; element.style.height = rect.height * ratio + 'px';
      }
      renderLivePageNumber(); onStateChange();
    }, render: renderPreview });
  lifecycle.use(viewport.dispose);

  function notifyChange({ preview = false, list = false } = {}) {
    if (preview) viewport.reset();
    if (list) renderPageList();
    onStateChange();
    if (preview) void renderPreview();
    else renderLivePageNumber();
  }

  function releaseThumbs() {
    thumbEpoch += 1;
    thumbQueue = [];
    thumbActive = 0;
    thumbObserver?.disconnect();
    thumbObserver = null;
    for (const task of thumbTasks) {
      try { task.cancel(); } catch (_) {}
    }
    thumbTasks = new Set();
    pageList?.querySelectorAll('canvas').forEach(releaseCanvas);
  }

  function cancelPreview({ clear = true } = {}) {
    previewRequest += 1;
    try { previewTask?.cancel(); } catch (_) {}
    previewTask = null;
    if (clear) { releaseCanvas(previewCanvas); if (canvasWrap) canvasWrap.hidden = true; }
  }

  function stopPointerDrag(commit = false) {
    if (!dragState) return;
    const state = dragState;
    dragState = null;
    state.tile?.classList.remove('is-dragging');
    overlay?.classList.remove('is-page-sorting');
    try { state.handle?.releasePointerCapture?.(state.pointerId); } catch (_) {}
    if (commit && state.active) {
      const byPageId = new Map(model.pages.map(page => [page.id, page]));
      const ordered = Array.from(pageList.querySelectorAll('[data-page-id]'))
        .map(item => byPageId.get(item.dataset.pageId))
        .filter(Boolean);
      if (ordered.length === model.pages.length) model.pages = ordered;
      suppressClickUntil = performance.now() + 250;
      updatePageOrderLabels();
      notifyChange();
    }
  }

  function createPageItem(page, index) {
    const item = document.createElement('article');
    item.className = 'pdf-page-number-page-item';
    item.dataset.pageId = page.id;
    item.tabIndex = 0;
    item.setAttribute('aria-label', text('home.pdfPageNumber.pageAria', {
      page: index + 1,
      name: page.sourceName
    }));
    item.classList.toggle('is-current', page.id === model.currentId);
    item.classList.toggle('is-selected', model.selectedIds.has(page.id));

    const check = document.createElement('button');
    check.className = 'pdf-page-number-check';
    check.type = 'button';
    check.setAttribute('aria-label', text('home.pdfPageNumber.toggleSelection'));
    check.appendChild(icon('check'));

    const thumbFrame = document.createElement('div');
    thumbFrame.className = 'pdf-page-number-thumb-frame';
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page-number-thumb';
    canvas.setAttribute('aria-hidden', 'true');
    const skeleton = document.createElement('span');
    skeleton.className = 'pdf-page-number-thumb-skeleton';
    const thumbError = document.createElement('span');
    thumbError.className = 'pdf-page-number-thumb-error';
    thumbError.textContent = text('home.pdfPageNumber.thumbnailError');
    thumbFrame.append(canvas, skeleton, thumbError);

    const copy = document.createElement('div');
    copy.className = 'pdf-page-number-page-copy';
    const order = document.createElement('strong');
    order.dataset.orderLabel = '';
    order.textContent = text('home.pdfPageNumber.pageLabel', { page: index + 1 });
    const sourceName = document.createElement('span');
    sourceName.title = page.sourceName;
    sourceName.textContent = page.sourceName;
    const sourcePage = document.createElement('small');
    sourcePage.textContent = text('home.pdfPageNumber.sourcePageLabel', {
      page: page.sourcePageIndex + 1
    });
    copy.append(order, sourceName, sourcePage);

    const actions = document.createElement('div');
    actions.className = 'pdf-page-number-page-actions';
    const drag = document.createElement('button');
    drag.className = 'pdf-page-number-drag';
    drag.type = 'button';
    drag.setAttribute('aria-label', text('home.pdfPageNumber.dragPage'));
    drag.appendChild(icon('grip-vertical'));
    const remove = document.createElement('button');
    remove.className = 'pdf-page-number-delete';
    remove.type = 'button';
    remove.setAttribute('aria-label', text('home.pdfPageNumber.deletePage'));
    remove.appendChild(icon('trash-2'));
    actions.append(drag, remove);
    item.append(check, thumbFrame, copy, actions);

    pageScope.event(item, 'click', event => {
      if (performance.now() < suppressClickUntil || event.target.closest('button')) return;
      selectPageFromEvent(page.id, event);
    });
    pageScope.event(item, 'keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectPageFromEvent(page.id, event);
    });
    pageScope.event(check, 'click', event => {
      event.stopPropagation();
      togglePageSelection(page.id);
    });
    pageScope.event(remove, 'click', event => {
      event.stopPropagation();
      deletePages(new Set([page.id]));
    });
    pageScope.event(drag, 'pointerdown', event => beginPointerDrag(event, page.id));
    return item;
  }

  function renderPageList() {
    releaseThumbs();
    pageScope?.dispose();
    pageScope = createLifecycleScope();
    const fragment = document.createDocumentFragment();
    model.pages.forEach((page, index) => fragment.appendChild(createPageItem(page, index)));
    pageList?.replaceChildren(fragment);
    startThumbObserver();
    refreshIcons();
  }

  function updatePageItems() {
    pageList?.querySelectorAll('[data-page-id]').forEach(item => {
      item.classList.toggle('is-current', item.dataset.pageId === model.currentId);
      item.classList.toggle('is-selected', model.selectedIds.has(item.dataset.pageId));
    });
  }

  function updatePageOrderLabels() {
    model.pages.forEach((page, index) => {
      const item = pageList?.querySelector(`[data-page-id="${CSS.escape(page.id)}"]`);
      const label = item?.querySelector('[data-order-label]');
      if (label) label.textContent = text('home.pdfPageNumber.pageLabel', { page: index + 1 });
    });
    updatePageItems();
  }

  function startThumbObserver() {
    if (!model.pages.length) return;
    if (typeof IntersectionObserver !== 'function') {
      model.pages.forEach(page => enqueueThumbnail(page.id));
      return;
    }
    thumbObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        thumbObserver?.unobserve(entry.target);
        enqueueThumbnail(entry.target.dataset.pageId);
      });
    }, { root: pageList, rootMargin: '220px 0px' });
    pageList.querySelectorAll('[data-page-id]').forEach(item => thumbObserver.observe(item));
  }

  function enqueueThumbnail(pageId) {
    const item = pageList?.querySelector(`[data-page-id="${CSS.escape(pageId)}"]`);
    if (!item || item.dataset.thumbState) return;
    item.dataset.thumbState = 'queued';
    thumbQueue.push({ pageId, epoch: thumbEpoch });
    pumpThumbnails();
  }

  function pumpThumbnails() {
    while (thumbActive < THUMB_CONCURRENCY && thumbQueue.length) {
      const job = thumbQueue.shift();
      if (job.epoch !== thumbEpoch) continue;
      thumbActive += 1;
      void renderThumbnail(job).finally(() => {
        if (job.epoch !== thumbEpoch) return;
        thumbActive = Math.max(0, thumbActive - 1);
        pumpThumbnails();
      });
    }
  }

  async function renderThumbnail({ pageId, epoch }) {
    const page = model.pages.find(candidate => candidate.id === pageId);
    const item = pageList?.querySelector(`[data-page-id="${CSS.escape(pageId)}"]`);
    const canvas = item?.querySelector('canvas');
    if (!page || !item || !canvas || epoch !== thumbEpoch) return;
    let proxy = null;
    let task = null;
    try {
      proxy = await pageSource(page)?.pdfDoc?.getPage(page.sourcePageIndex + 1);
      if (!proxy || epoch !== thumbEpoch) return;
      const base = proxy.getViewport({ scale: 1 });
      const scale = Math.min(THUMB_WIDTH / base.width, THUMB_HEIGHT / base.height);
      const viewport = proxy.getViewport({ scale });
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(viewport.width * dpr));
      canvas.height = Math.max(1, Math.round(viewport.height * dpr));
      canvas.style.width = `${Math.round(viewport.width)}px`;
      canvas.style.height = `${Math.round(viewport.height)}px`;
      task = proxy.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0]
      });
      thumbTasks.add(task);
      await task.promise;
      if (epoch !== thumbEpoch) return;
      item.dataset.thumbState = 'ready';
      item.classList.add('is-thumb-ready');
    } catch (error) {
      if (epoch !== thumbEpoch || isCancellation(error)) return;
      item.dataset.thumbState = 'error';
      item.classList.add('has-thumb-error');
    } finally {
      if (task) thumbTasks.delete(task);
      try { proxy?.cleanup?.(); } catch (_) {}
    }
  }

  function selectPageFromEvent(pageId, event) {
    const index = model.pages.findIndex(page => page.id === pageId);
    if (index < 0 || isLocked()) return;
    viewport.reset();
    model.currentId = pageId;
    if (event.shiftKey && model.selectionAnchorId) {
      const anchor = model.pages.findIndex(page => page.id === model.selectionAnchorId);
      if (anchor >= 0) {
        const next = new Set(event.ctrlKey || event.metaKey ? model.selectedIds : []);
        for (let item = Math.min(anchor, index); item <= Math.max(anchor, index); item += 1) {
          next.add(model.pages[item].id);
        }
        model.selectedIds = next;
      }
    } else if (event.ctrlKey || event.metaKey) {
      if (model.selectedIds.has(pageId)) model.selectedIds.delete(pageId);
      else model.selectedIds.add(pageId);
      model.selectionAnchorId = pageId;
    } else {
      model.selectedIds = new Set([pageId]);
      model.selectionAnchorId = pageId;
    }
    updatePageItems();
    notifyChange({ preview: true });
  }

  function togglePageSelection(pageId) {
    if (isLocked()) return;
    viewport.reset();
    if (model.selectedIds.has(pageId)) model.selectedIds.delete(pageId);
    else model.selectedIds.add(pageId);
    model.currentId = pageId;
    model.selectionAnchorId = pageId;
    updatePageItems();
    notifyChange({ preview: true });
  }

  function deletePages(ids) {
    if (isLocked()) return;
    const removing = new Set([...ids].filter(id => model.pages.some(page => page.id === id)));
    if (!removing.size) return;
    if (model.pages.length - removing.size < 1) {
      showToast(text('home.pdfPageNumber.cannotDeleteAll'));
      return;
    }
    const previousIndex = Math.max(0, currentPageIndex());
    model.lastDeletedSnapshot = {
      pages: [...model.pages],
      selectedIds: new Set(model.selectedIds),
      currentId: model.currentId,
      selectionAnchorId: model.selectionAnchorId
    };
    model.pages = model.pages.filter(page => !removing.has(page.id));
    model.selectedIds = new Set([...model.selectedIds].filter(id => !removing.has(id)));
    if (!model.pages.some(page => page.id === model.currentId)) {
      model.currentId = model.pages[Math.min(previousIndex, model.pages.length - 1)]?.id
        || model.pages[0]?.id
        || null;
    }
    if (!model.selectedIds.size && model.currentId) model.selectedIds.add(model.currentId);
    model.selectionAnchorId = model.currentId;
    notifyChange({ preview: true, list: true });
  }

  function undoDelete() {
    if (!model.lastDeletedSnapshot || isLocked()) return;
    model.pages = model.lastDeletedSnapshot.pages;
    model.selectedIds = model.lastDeletedSnapshot.selectedIds;
    model.currentId = model.lastDeletedSnapshot.currentId;
    model.selectionAnchorId = model.lastDeletedSnapshot.selectionAnchorId;
    model.lastDeletedSnapshot = null;
    notifyChange({ preview: true, list: true });
  }

  function beginPointerDrag(event, pageId) {
    if (event.button !== 0 || isLocked()) return;
    const item = event.currentTarget.closest('[data-page-id]');
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    stopPointerDrag(false);
    dragState = {
      pageId,
      tile: item,
      handle: event.currentTarget,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false
    };
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch (_) {}
  }

  function handlePointerMove(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
    if (!dragState.active && distance < 5) return;
    if (!dragState.active) {
      dragState.active = true;
      dragState.tile.classList.add('is-dragging');
      overlay?.classList.add('is-page-sorting');
    }
    event.preventDefault();
    const rect = pageList.getBoundingClientRect();
    if (event.clientY < rect.top + 42) pageList.scrollTop -= 12;
    else if (event.clientY > rect.bottom - 42) pageList.scrollTop += 12;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-page-id]');
    if (!target || target === dragState.tile || !pageList.contains(target)) return;
    const targetRect = target.getBoundingClientRect();
    const after = event.clientY > targetRect.top + targetRect.height / 2;
    pageList.insertBefore(dragState.tile, after ? target.nextSibling : target);
  }

  function handlePointerUp(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    stopPointerDrag(true);
  }

  async function renderPreview() {
    const page = currentPage();
    cancelPreview({ clear: !page });
    const request = previewRequest;
    onStateChange();
    if (!page) {
      renderLivePageNumber();
      return;
    }
    const source = pageSource(page);
    if (!source?.pdfDoc) return;
    let proxy = null;
    let task = null;
    try {
      proxy = await source.pdfDoc.getPage(page.sourcePageIndex + 1);
      if (request !== previewRequest || isDisposed()) return;
      const base = proxy.getViewport({ scale: 1 });
      const availableWidth = Math.max(240, canvasScroll.clientWidth - 72);
      const availableHeight = Math.max(260, canvasScroll.clientHeight - 72);
      const fitScale = Math.min(availableWidth / base.width, availableHeight / base.height, 1.55);
      previewScale = Math.max(0.08, fitScale * previewZoom);
      previewPageWidth = base.width;
      previewPageHeight = base.height;
      task = renderPdfPreviewCanvas({ proxy, canvas: previewCanvas, wrap: canvasWrap, scale: previewScale,
        isCurrent: () => request === previewRequest && !isDisposed() });
      previewTask = task;
      await task.promise;
      if (request !== previewRequest || isDisposed()) return;
      renderLivePageNumber();
      if (previewStatus) {
        previewStatus.textContent = text('home.pdfPageNumber.previewReady', {
          name: page.sourceName,
          page: page.sourcePageIndex + 1
        });
      }
    } catch (error) {
      if (request !== previewRequest || isCancellation(error)) return;
      console.error('[PDF Page Number] preview failed:', error);
      if (previewStatus) previewStatus.textContent = text('home.pdfPageNumber.previewFailed');
    } finally {
      if (previewTask === task) previewTask = null;
      try { proxy?.cleanup?.(); } catch (_) {}
    }
  }

  function renderLivePageNumber() {
    if (!hasPages() || canvasWrap?.hidden) {
      if (liveLayer) liveLayer.hidden = true;
      return;
    }
    let plan;
    try {
      plan = getPlan();
      settingStatus?.classList.remove('is-error');
    } catch (_) {
      if (settingStatus) {
        settingStatus.textContent = text('home.pdfPageNumber.rangeInvalid');
        settingStatus.classList.add('is-error');
      }
      if (liveLayer) liveLayer.hidden = true;
      return;
    }
    const entry = plan[currentPageIndex()];
    const appliedCount = plan.filter(item => item.applied).length;
    if (settingStatus) {
      settingStatus.textContent = text('home.pdfPageNumber.applySummary', {
        applied: appliedCount,
        total: model.pages.length
      });
    }
    if (!entry?.applied) {
      if (liveLayer) liveLayer.hidden = true;
      return;
    }
    const settings = getSettings();
    const measureCanvas = document.createElement('canvas');
    const context = measureCanvas.getContext('2d');
    context.font = `500 ${settings.fontSize}px "Noto Sans SC", "Microsoft YaHei", sans-serif`;
    const textWidth = Math.max(1, context.measureText(entry.text).width);
    const textHeight = settings.fontSize * 1.15;
    const layout = calculatePdfPageNumberLayout({
      pageWidth: previewPageWidth,
      pageHeight: previewPageHeight,
      textWidth,
      textHeight,
      settings
    });
    const scale = previewScale;
    liveLayer.hidden = false;
    liveLayer.style.width = `${previewPageWidth * scale}px`;
    liveLayer.style.height = `${previewPageHeight * scale}px`;
    liveText.textContent = entry.text;
    liveText.style.left = `${layout.text.x * scale}px`;
    liveText.style.top = `${(previewPageHeight - layout.text.y - layout.text.height) * scale}px`;
    liveText.style.width = `${layout.text.width * scale + 2}px`;
    liveText.style.height = `${layout.text.height * scale + 2}px`;
    liveText.style.fontSize = `${settings.fontSize * scale}px`;
    liveText.style.lineHeight = `${layout.text.height * scale}px`;
    liveText.style.color = settings.textColor;
    liveText.style.opacity = String(settings.textOpacity);
    if (layout.background) {
      liveBackground.hidden = false;
      liveBackground.style.left = `${layout.background.x * scale}px`;
      liveBackground.style.top = `${(previewPageHeight - layout.background.y - layout.background.height) * scale}px`;
      liveBackground.style.width = `${layout.background.width * scale}px`;
      liveBackground.style.height = `${layout.background.height * scale}px`;
      liveBackground.style.background = settings.backgroundColor;
      liveBackground.style.opacity = String(settings.backgroundOpacity);
      liveBackground.style.border = settings.borderWidth > 0
        ? `${settings.borderWidth * scale}px solid ${settings.borderColor}`
        : '0';
      liveBackground.style.borderRadius = layout.background.style === 'circle'
        ? '50%'
        : layout.background.style === 'pill'
          ? '999px'
          : layout.background.style === 'label'
            ? `${Math.min(5, settings.padding * 0.55) * scale}px`
            : '0';
    } else {
      liveBackground.hidden = true;
    }
  }

  function selectAdjacent(delta) {
    viewport.reset();
    if (isLocked()) return;
    const target = model.pages[currentPageIndex() + delta];
    if (!target) return;
    model.currentId = target.id;
    model.selectionAnchorId = target.id;
    updatePageItems();
    notifyChange({ preview: true });
    pageList?.querySelector(`[data-page-id="${CSS.escape(target.id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function changeZoom(factor) {
    viewport.zoomTo(previewZoom * factor);
  }

  function fitPreview() {
    viewport.reset();
    previewZoom = 1;
    notifyChange({ preview: true });
  }

  function captureSnapshot() {
    return {
      sources: [...model.sources],
      pages: [...model.pages],
      selectedIds: new Set(model.selectedIds),
      currentId: model.currentId,
      selectionAnchorId: model.selectionAnchorId,
      lastDeletedSnapshot: model.lastDeletedSnapshot
    };
  }

  function appendSources(staged) {
    const sources = staged.map(source => ({
      ...source,
      id: `pdf-page-number-source-${++sourceIdSeed}`
    }));
    const newPages = sources.flatMap(source => Array.from(
      { length: source.pdfDoc.numPages },
      (_, sourcePageIndex) => ({
        id: `pdf-page-number-page-${++pageIdSeed}`,
        sourceId: source.id,
        sourceName: source.name,
        sourcePageIndex,
        sourcePageCount: source.pdfDoc.numPages
      })
    ));
    model.sources.push(...sources);
    model.pages.push(...newPages);
    if (!model.currentId) model.currentId = newPages[0]?.id || model.pages[0]?.id || null;
    model.selectedIds = new Set(model.currentId ? [model.currentId] : []);
    model.selectionAnchorId = model.currentId;
    model.lastDeletedSnapshot = null;
    renderPageList();
    onStateChange();
    return { newPages, sources };
  }

  async function restoreSnapshot(snapshot) {
    const retained = new Set(snapshot.sources);
    const removed = model.sources.filter(source => !retained.has(source));
    model.sources = snapshot.sources;
    model.pages = snapshot.pages;
    model.selectedIds = snapshot.selectedIds;
    model.currentId = snapshot.currentId;
    model.selectionAnchorId = snapshot.selectionAnchorId;
    model.lastDeletedSnapshot = snapshot.lastDeletedSnapshot;
    renderPageList();
    onStateChange();
    if (hasPages()) void renderPreview();
    for (const source of removed) {
      await destroySource(source);
    }
  }

  async function resetDocument() {
    viewport.reset();
    stopPointerDrag(false);
    releaseThumbs();
    cancelPreview();
    pageScope?.dispose();
    pageScope = null;
    const sources = model.sources;
    model.sources = [];
    model.pages = [];
    model.selectedIds = new Set();
    model.currentId = null;
    model.selectionAnchorId = null;
    model.lastDeletedSnapshot = null;
    previewZoom = 1;
    pageList?.replaceChildren();
    onStateChange();
    renderLivePageNumber();
    for (const source of sources) {
      await destroySource(source);
    }
  }

  function handleShortcut(event) {
    const tag = event.target?.tagName?.toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag)) return false;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectAdjacent(-1);
      return true;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectAdjacent(1);
      return true;
    }
    if (event.key === 'Delete' && model.selectedIds.size) {
      event.preventDefault();
      deletePages(model.selectedIds);
      return true;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      model.selectedIds = new Set(model.pages.map(page => page.id));
      updatePageItems();
      onStateChange();
      return true;
    }
    return false;
  }

  lifecycle.event(document, 'pointermove', handlePointerMove, { passive: false });
  lifecycle.event(document, 'pointerup', handlePointerUp);
  lifecycle.event(document, 'pointercancel', handlePointerUp);
  if (typeof ResizeObserver === 'function' && canvasScroll) {
    resizeObserver = new ResizeObserver(() => {
      if (!overlay?.classList.contains('visible') || !hasPages() || isLocked()) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { void renderPreview(); }, 120);
    });
    resizeObserver.observe(canvasScroll);
    lifecycle.use(() => {
      resizeObserver?.disconnect();
      resizeObserver = null;
      clearTimeout(resizeTimer);
      resizeTimer = null;
    });
  }

  return {
    appendSources,
    captureSnapshot,
    changeZoom,
    deleteSelected: () => deletePages(model.selectedIds),
    async dispose() {
      if (lifecycle.disposed) return;
      lifecycle.dispose();
      pageScope?.dispose();
      pageScope = null;
      await resetDocument();
    },
    fitPreview,
    getData: () => ({
      sources: model.sources,
      pages: model.pages,
      selectedIds: model.selectedIds
    }),
    getPreviewZoom: () => previewZoom,
    hasActiveDrag: () => Boolean(dragState?.active),
    hasPages,
    handleShortcut,
    refresh() {
      renderPageList();
      onStateChange();
      renderLivePageNumber();
    },
    renderLivePageNumber,
    renderPreview,
    resetDocument,
    restoreSnapshot,
    selectAdjacent,
    selectAll() {
      if (isLocked()) return;
      model.selectedIds = model.selectedIds.size === model.pages.length
        ? new Set()
        : new Set(model.pages.map(page => page.id));
      updatePageItems();
      onStateChange();
    },
    undoDelete
  };
}
