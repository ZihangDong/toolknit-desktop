import { createLifecycleScope } from '../app/tool-lifecycle.js';
import { toolTopbarMarkup } from './tool-page-shell.js';
import { onLangChange, t } from '../i18n.js';
import '../styles/components/pdf-workbench.css';

// Document ownership and export actions belong to the feature. This view owns only its canvases and listeners.
export function createPdfWorkbench({ root, pageStrip, back, actions, tag, labels, stageId, ids = {}, getRotation = () => 0, transformPreview = null, sortable = false, onReorder = () => {}, onChange = () => {}, refreshIcons = () => {} }) {
  const scope = createLifecycleScope();
  root.classList.add('pdf-workbench', 'pdf-merge-v2', 'pdf-editor-v2');
  root.setAttribute('data-tool-page-chrome', '');
  const shell = document.createElement('div');
  // Opt the workbench into the shared tool-page chrome. The extra class is a
  // styling contract only; the workbench keeps its own three-column body.
  shell.className = 'pdf-workbench-shell tool-page-v2-shell';
  shell.innerHTML = `${toolTopbarMarkup({ tag, title: '' })}
    <div class="pdf-editor-v2-body pdf-workbench-body">
      <aside class="pdf-editor-sidebar pdf-editor-page-sidebar">
        <div class="pdf-editor-pages-head"><span data-wb-label="home.pdfEditor.pages"></span><span data-wb-count></span></div>
        <div data-wb-pages></div>
      </aside>
      <main class="pdf-editor-preview">
        <div class="pdf-editor-preview-toolbar"><span class="pdf-editor-page-indicator" data-wb-indicator></span>
          <div class="pdf-editor-zoom">
            <button class="pdf-editor-zoom-btn" data-wb-zoom="out" type="button"><i data-lucide="zoom-out"></i></button>
            <button class="pdf-editor-zoom-value" data-wb-zoom="fit" type="button"></button>
            <button class="pdf-editor-zoom-btn" data-wb-zoom="in" type="button"><i data-lucide="zoom-in"></i></button>
          </div>
        </div>
        <div class="pdf-editor-canvas-scroll" data-wb-scroll><div class="pdf-editor-canvas-stage" data-wb-stage>
          <canvas class="pdf-editor-main-canvas" data-wb-canvas></canvas><span data-wb-error hidden></span>
        </div></div>
      </main>
      <aside class="pdf-editor-tool-panel"><div class="pdf-editor-filecard"><i data-lucide="file-text"></i>
        <div class="pdf-editor-filecard-meta"><span class="pdf-editor-filecard-name" data-wb-source></span>
        <span class="pdf-editor-filecard-stats" data-wb-source-page></span></div></div><div data-wb-actions></div></aside>
    </div>`;
  back.className = 'tool-page-v2-back settings-v2-back settings-back pdf-merge-v2-back';
  back.innerHTML = '<i data-lucide="arrow-left"></i><span></span>';
  shell.querySelector('[data-tool-close]').replaceWith(back);
  pageStrip.className = 'pdf-editor-page-strip';
  shell.querySelector('[data-wb-pages]').replaceWith(pageStrip);
  const actionHost = actions?.classList?.contains('pdf-workbench-actions')
    ? actions
    : document.createElement('div');
  if (actionHost !== actions) {
    actionHost.className = 'pdf-workbench-actions';
    if (actions) actionHost.append(actions);
  }
  shell.querySelector('[data-wb-actions]').replaceWith(actionHost);
  root.replaceChildren(shell);
  const find = selector => shell.querySelector(selector);
  for (const [selector, id] of Object.entries(ids)) {
    if (id) find(selector)?.setAttribute('id', id);
  }
  if (stageId) find('[data-wb-stage]').id = stageId;
  const canvas = find('[data-wb-canvas]');
  const body = find('.pdf-workbench-body');
  const scroll = find('[data-wb-scroll]');
  const error = find('[data-wb-error]');
  let pages = [], currentIndex = 0, zoom = null, locked = false, generation = 0, previewRevision = 0;
  let getPage = null, mainTask = null, observer = null, renderScope = null, frame = 0, wheelFrame = 0, wheelDelta = 0, renderedScale = 1, draggedIndex = -1;
  const thumbTasks = new Set();
  let queue = [], activeThumbs = 0;

  function translate() {
    shell.querySelectorAll('[data-wb-label]').forEach(node => { node.textContent = t(node.dataset.wbLabel); });
    back.querySelector('span').textContent = t(labels.back);
    find('[data-tool-website] span').textContent = t('home.webVersion');
    find('[data-tool-support] span').textContent = t('home.supportAuthor');
    const settings = find('[data-tool-settings]');
    settings.title = t('nav.settings'); settings.setAttribute('aria-label', settings.title);
    shell.querySelectorAll('[data-tool-window]').forEach(button => {
      button.title = t(`common.${button.dataset.toolWindow}`); button.setAttribute('aria-label', button.title);
    });
    for (const [mode, key] of [['out', 'zoomOut'], ['in', 'zoomIn'], ['fit', 'fitWidth']]) {
      const button = find(`[data-wb-zoom="${mode}"]`);
      button.title = t(`home.pdfEditor.${key}`);
      button.setAttribute('aria-label', button.title);
    }
    update();
  }
  function update() {
    const count = pages.filter(page => page.selected).length;
    find('[data-wb-count]').textContent = t(labels.selectedCount, { count });
    find('[data-wb-indicator]').textContent = pages.length ? t('home.pdfEditor.pageIndicator', { current: currentIndex + 1, total: pages.length }) : '';
    const page = pages[currentIndex];
    find('[data-wb-source]').textContent = page?.fileName || '';
    find('[data-wb-source]').title = page?.fileName || '';
    find('[data-wb-source-page]').textContent = page ? t(labels.sourcePage, { page: page.pageIndex }) : '';
    find('[data-wb-zoom="fit"]').textContent = zoom ? `${Math.round(zoom * 100)}%` : t('home.pdfEditor.fitWidth');
    shell.querySelectorAll('[data-wb-zoom]').forEach(button => { button.disabled = locked || !pages.length; });
    pageStrip.querySelectorAll('.pdf-editor-tile').forEach((tile, index) => {
      tile.classList.toggle('is-current', index === currentIndex);
      tile.classList.toggle('is-selected', pages[index].selected);
      tile.setAttribute('aria-current', String(index === currentIndex));
      const check = tile.querySelector('button');
      check.disabled = locked;
      check.setAttribute('aria-pressed', String(pages[index].selected));
      check.title = t('home.pdfEditor.pageLabel', { page: index + 1 });
      check.setAttribute('aria-label', check.title);
    });
    onChange({ currentIndex, count });
  }

  async function renderMain() {
    if (!getPage || !pages.length || !root.classList.contains('visible')) return;
    const version = ++previewRevision, owner = generation;
    try { mainTask?.cancel(); } catch {}
    mainTask = null;
    // Render into a private canvas so superseded work can never repaint the current page.
    const temporary = document.createElement('canvas');
    error.hidden = true;
    try {
      const entry = pages[currentIndex];
      const rotationDelta = getRotation(entry);
      const page = await getPage(entry);
      if (version !== previewRevision || owner !== generation) return;
      const rotation = page.rotate + rotationDelta;
      const base = page.getViewport({ scale: 1, rotation });
      const scale = zoom || Math.min(2, Math.max(0.1, (scroll.clientWidth - 56) / base.width));
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8000000 / (base.width * base.height * scale * scale)));
      const viewport = page.getViewport({ scale: scale * pixelRatio, rotation });
      temporary.width = Math.ceil(viewport.width); temporary.height = Math.ceil(viewport.height);
      const task = page.render({ canvasContext: temporary.getContext('2d'), viewport, background: '#ffffff' });
      mainTask = task;
      await task.promise;
      if (mainTask === task) mainTask = null;
      if (version !== previewRevision || owner !== generation) return;
      if (transformPreview) {
        await transformPreview(temporary, entry, () => version === previewRevision && owner === generation);
        if (version !== previewRevision || owner !== generation) return;
      }
      canvas.width = temporary.width; canvas.height = temporary.height;
      canvas.style.width = `${base.width * scale}px`; canvas.style.height = `${base.height * scale}px`;
      canvas.getContext('2d').drawImage(temporary, 0, 0);
      renderedScale = scale;
      canvas.hidden = false;
    } catch (failure) {
      if (version === previewRevision && owner === generation && failure?.name !== 'RenderingCancelledException') {
        error.hidden = false; error.textContent = t('home.pdfEditor.thumbnailError');
      }
    } finally { temporary.width = 0; temporary.height = 0; }
  }
  function scheduleMain() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { frame = 0; void renderMain(); });
  }
  function select(index) {
    if (locked || !pages[index]) return;
    currentIndex = index; update(); scheduleMain();
  }
  function reorder(from, to) {
    if (!sortable || locked || from === to || !pages[from] || !pages[to]) return;
    const [entry] = pages.splice(from, 1);
    pages.splice(to, 0, entry);
    if (currentIndex === from) currentIndex = to;
    else if (from < currentIndex && currentIndex <= to) currentIndex -= 1;
    else if (to <= currentIndex && currentIndex < from) currentIndex += 1;
    const nextIndex = currentIndex;
    const nextPages = pages;
    setPages(nextPages, getPage);
    currentIndex = Math.min(nextIndex, pages.length - 1);
    update();
    onReorder(pages, { from, to });
    scheduleMain();
  }
  async function renderThumb(index, tile, owner) {
    let task;
    const thumbnail = document.createElement('canvas');
    try {
      const page = await getPage(pages[index]);
      if (owner !== generation) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(132 / base.width, 176 / base.height) });
      thumbnail.width = Math.ceil(viewport.width); thumbnail.height = Math.ceil(viewport.height);
      thumbnail.className = 'pdf-editor-tile-canvas';
      task = page.render({ canvasContext: thumbnail.getContext('2d'), viewport, background: '#ffffff' });
      thumbTasks.add(task); await task.promise;
      if (owner !== generation) return;
      const frame = tile.querySelector('.pdf-editor-tile-frame');
      frame.appendChild(thumbnail); frame.classList.add('is-ready');
      updateThumbRotation(index, thumbnail);
    } catch {
      if (owner === generation) tile.classList.add('has-error');
    } finally {
      if (task) thumbTasks.delete(task);
      if (!thumbnail.isConnected) { thumbnail.width = 0; thumbnail.height = 0; }
      if (owner === generation) { activeThumbs--; pump(); }
    }
  }
  function pump() {
    while (activeThumbs < 2 && queue.length) {
      const item = queue.shift(); activeThumbs++;
      void renderThumb(item.index, item.tile, generation);
    }
  }
  function updateThumbRotation(index, thumbnail) {
    const angle = getRotation(pages[index]);
    // Thumbnails reuse their original pixels; rotating never restarts the PDF render queue.
    const scale = angle % 180 ? Math.min(1, thumbnail.width / thumbnail.height) : 1;
    thumbnail.style.transform = `rotate(${angle}deg) scale(${scale})`;
  }
  function refreshPages(indices) {
    if (locked) return;
    for (const index of indices) {
      const thumbnail = pageStrip.children[index]?.querySelector('canvas');
      if (thumbnail) updateThumbRotation(index, thumbnail);
    }
    update();
    if (indices.includes(currentIndex)) scheduleMain();
  }
  function clear() {
    generation++; previewRevision++; queue = []; activeThumbs = 0;
    observer?.disconnect(); observer = null; renderScope?.dispose(); renderScope = null;
    if (frame) cancelAnimationFrame(frame); frame = 0;
    if (wheelFrame) cancelAnimationFrame(wheelFrame); wheelFrame = 0; wheelDelta = 0;
    try { mainTask?.cancel(); } catch {} mainTask = null;
    for (const task of thumbTasks) { try { task.cancel(); } catch {} } thumbTasks.clear();
    body.scrollTop = 0;
    pageStrip.scrollTop = 0;
    actionHost.scrollTop = 0;
    scroll.scrollTop = 0;
    pageStrip.querySelectorAll('canvas').forEach(node => { node.width = 0; node.height = 0; });
    canvas.width = 0; canvas.height = 0; canvas.hidden = true;
    pageStrip.replaceChildren(); pages = []; getPage = null; zoom = null; currentIndex = 0; locked = false; renderedScale = 1;
  }
  function setPages(next, loader) {
    clear(); pages = next; getPage = loader; renderScope = createLifecycleScope();
    observer = new IntersectionObserver(entries => {
      entries.filter(entry => entry.isIntersecting).forEach(entry => {
        observer.unobserve(entry.target);
        queue.push({ index: Number(entry.target.dataset.index), tile: entry.target });
      }); pump();
    }, { root: pageStrip, rootMargin: '200px' });
    const fragment = document.createDocumentFragment();
    pages.forEach((page, index) => {
      const tile = document.createElement('article');
      tile.className = 'pdf-editor-tile'; tile.dataset.index = String(index); tile.tabIndex = 0;
      if (sortable) tile.draggable = true;
      const frame = document.createElement('div'); frame.className = 'pdf-editor-tile-frame';
      const skeleton = document.createElement('span'); skeleton.className = 'pdf-editor-tile-skeleton';
      const failure = document.createElement('span'); failure.className = 'pdf-editor-tile-error'; failure.textContent = t('home.pdfEditor.thumbnailError');
      const number = document.createElement('span'); number.className = 'pdf-editor-tile-index'; number.textContent = String(index + 1);
      const check = document.createElement('button'); check.type = 'button'; check.className = 'pdf-editor-tile-select';
      const icon = document.createElement('i'); icon.dataset.lucide = 'check'; check.appendChild(icon);
      frame.append(skeleton, failure); tile.append(frame, number, check);
      renderScope.event(tile, 'click', () => select(index));
      if (sortable) {
        renderScope.event(tile, 'dragstart', event => {
          if (locked) { event.preventDefault(); return; }
          draggedIndex = index;
          tile.classList.add('is-dragging');
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', String(index));
        });
        renderScope.event(tile, 'dragover', event => {
          if (locked || draggedIndex < 0) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          tile.classList.toggle('is-drag-target', draggedIndex !== index);
        });
        renderScope.event(tile, 'dragleave', () => tile.classList.remove('is-drag-target'));
        renderScope.event(tile, 'drop', event => {
          event.preventDefault();
          reorder(draggedIndex, index);
          draggedIndex = -1;
          pageStrip.querySelectorAll('.is-drag-target, .is-dragging').forEach(node => node.classList.remove('is-drag-target', 'is-dragging'));
        });
        renderScope.event(tile, 'dragend', () => {
          draggedIndex = -1;
          pageStrip.querySelectorAll('.is-drag-target, .is-dragging').forEach(node => node.classList.remove('is-drag-target', 'is-dragging'));
        });
      }
      renderScope.event(tile, 'keydown', event => {
        if (event.target !== tile || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault(); select(index);
      });
      renderScope.event(check, 'click', event => { event.stopPropagation(); if (!locked) { page.selected = !page.selected; update(); } });
      fragment.appendChild(tile);
    });
    pageStrip.appendChild(fragment);
    pageStrip.querySelectorAll('article').forEach(tile => observer.observe(tile));
    translate(); refreshIcons(); scheduleMain();
  }
  scope.event(shell, 'click', event => {
    const button = event.target.closest('[data-wb-zoom]'); if (!button || locked) return;
    if (button.dataset.wbZoom === 'fit') zoom = null;
    else zoom = Math.max(.15, Math.min(3, (zoom || renderedScale) * (button.dataset.wbZoom === 'in' ? 1.2 : 1 / 1.2)));
    update(); scheduleMain();
  });
  scope.event(scroll, 'wheel', event => {
    if (locked || !pages.length || !root.classList.contains('visible')) return;
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * scroll.clientHeight : event.deltaY;
    if (!Number.isFinite(delta) || delta === 0) return;
    event.preventDefault(); wheelDelta = Math.max(-2400, Math.min(2400, wheelDelta + delta));
    if (wheelFrame) return;
    wheelFrame = requestAnimationFrame(() => {
      wheelFrame = 0; const change = wheelDelta; wheelDelta = 0;
      const current = zoom || renderedScale;
      const next = Math.max(0.15, Math.min(3, current * Math.max(0.72, Math.min(1.38, Math.exp(-change * 0.0015)))));
      if (Math.abs(next - current) < 0.001) return;
      const rect = scroll.getBoundingClientRect();
      const anchorX = event.clientX >= rect.left && event.clientX <= rect.right ? event.clientX - rect.left + scroll.scrollLeft : scroll.clientWidth / 2 + scroll.scrollLeft;
      const anchorY = event.clientY >= rect.top && event.clientY <= rect.bottom ? event.clientY - rect.top + scroll.scrollTop : scroll.clientHeight / 2 + scroll.scrollTop;
      const ratio = next / current;
      zoom = next; update(); scheduleMain();
      window.requestAnimationFrame(() => {
        scroll.scrollLeft = Math.max(0, anchorX * ratio - (event.clientX - rect.left));
        scroll.scrollTop = Math.max(0, anchorY * ratio - (event.clientY - rect.top));
      });
    });
  }, { passive: false });
  const resize = new ResizeObserver(scheduleMain); resize.observe(scroll); scope.use(() => resize.disconnect());
  scope.use(onLangChange(translate));
  translate(); refreshIcons();
  return { setPages, clear, refresh: update, refreshPages, select, getPages: () => pages, currentIndex: () => currentIndex,
    setLocked(value) { locked = value; update(); },
    dispose() { clear(); scope.dispose(); } };
}
