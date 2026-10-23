import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession, setModalInteractivity } from '../../app/modal-runtime.js';
import { moveFocusOutOfHiddenRegion } from '../../shared/tool-page-shell.js';
import { bindPointerSortableFileList } from '../../shared/sortable-file-list.js';
import { createPreviewViewport } from '../../shared/preview-viewport.js';
import { loadTauriDialog, loadTauriWebview, tauriCorePromise } from '../../platform/tauri-runtime.js';
import { onLangChange, t } from '../../i18n.js';
import { DEFAULT_SETTINGS, LIMITS, imagePdfError, errorCode, pagePlan, decodeSize, naturalFileOrder, movePage } from './core.js';
import { createImageInputs } from './input.js';
import { createImagePdfWorker } from './worker-client.js';
import { exportImagePdf } from './export.js';

export function createImagePdfController({ overlay, isTauri = false, getOutputDir, refreshIcons = () => {}, displayFilesystemPath = value => value } = {}) {
  const scope = createLifecycleScope(), q = suffix => document.getElementById('imagePdf' + suffix);
  const tr = (key, params) => t('home.imagePdf.' + key, params);
  const inputs = createImageInputs({ isTauri });
  let owner = null, operation = null, disposed = false, pages = [], failures = [], selected = '', sequence = 0;
  let settings = { ...DEFAULT_SETTINGS }, listScope = null, observer = null, result = null, status = null;
  let previewRevision = 0, previewWorker = null, previewBusy = false, previewUrl = '', zoom = 1, fit = true;
  let thumbnailQueue = [], thumbnailBusy = false, dropGuard = 0, loadingStop = null;
  const current = session => owner === session && session && !session.disposed && !disposed;
  const check = session => { if (!current(session)) throw imagePdfError('cancelled'); };
  const processModal = createModalSession({ root: q('Process'), background: overlay, initialFocus: q('Cancel'), onClose: () => cancel(), canClose: () => !operation?.committing });
  const successModal = createModalSession({ root: q('Success'), background: overlay, initialFocus: q('Done'), onClose: () => successModal.close() });
  const viewport = createPreviewViewport({ viewport: q('Stage'), content: q('Preview'),
    enabled: () => Boolean(owner && !operation && pages.length && q('Preview').naturalWidth && !q('Preview').hidden),
    getScale: () => q('Preview').clientWidth / q('Preview').naturalWidth,
    setScale: value => { fit = false; zoom = value; sizePreview(); }, min: .02, max: 4, panPrimary: () => true });
  scope.use(viewport.dispose);
  function setStatus(key, params = {}, error = false) {
    status = key ? { key, params, error } : null;
    for (const suffix of ['Status', 'EmptyStatus']) { q(suffix).textContent = status ? tr(key, params) : ''; q(suffix).classList.toggle('is-error', error); }
  }
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
  const icon = name => { const el = node('i'); el.dataset.lucide = name; return el; };
  function sync() {
    const busy = Boolean(operation), active = pages.find(page => page.id === selected);
    q('Empty').hidden = Boolean(pages.length || failures.length); q('Loaded').hidden = !q('Empty').hidden;
    q('EmptyStatus').hidden = q('Empty').hidden;
    q('Summary').textContent = pages.length ? tr('summary', { count: pages.length }) : '';
    for (const el of overlay.querySelectorAll('[data-image-setting]')) {
      const key = el.dataset.imageSetting, value = el.dataset.value;
      el.setAttribute('aria-pressed', String(String(settings[key]) === value));
      el.disabled = busy || settings.paper !== 'a4' && ['orientation', 'margin'].includes(key);
    }
    for (const id of ['Add', 'Clear', 'Pick', 'Sort', 'Name', 'RemoveFailed']) q(id).disabled = busy;
    q('FailureSection').hidden = !failures.length;
    q('FailureCount').textContent = tr('failedLabel', { count: failures.length });
    q('Clear').disabled = busy || !pages.length && !failures.length;
    for (const id of ['Rotate', 'Delete', 'ZoomOut', 'ZoomIn', 'Fit']) q(id).disabled = busy || !active;
    q('Export').disabled = busy || !pages.length || Boolean(failures.length);
    q('Cancel').disabled = Boolean(operation?.committing);
    q('PageLabel').textContent = active ? tr('page', { current: pages.indexOf(active) + 1, total: pages.length }) : '';
    q('Resolution').textContent = active ? (() => {
      try { const plan = pagePlan(active, settings); return tr('dimensions', { width: (plan.width * 25.4 / 72).toFixed(1), height: (plan.height * 25.4 / 72).toFixed(1) })
        + (plan.resolutionLimited ? ' · ' + tr(plan.resolutionLimit === 'processing' ? 'largeImageResolution' : 'limitedResolution') : ''); } catch { return tr('error.paper-size'); }
    })() : '';
    q('Pages').querySelectorAll('[data-image-page]').forEach(row => {
      const chosen = row.dataset.imagePage === selected; row.classList.toggle('is-active', chosen);
      row.querySelector('button').setAttribute('aria-pressed', String(chosen)); row.querySelector('button').disabled = busy;
    });
    if (status) setStatus(status.key, status.params, status.error);
  }
  async function thumbnails() {
    if (thumbnailBusy || !owner || operation) return;
    thumbnailBusy = true; const session = owner;
    try {
      while (thumbnailQueue.length && current(session) && !operation) {
        const entry = thumbnailQueue.shift();
        if (entry.thumbnail || !pages.includes(entry)) continue;
        let bitmap;
        try {
          bitmap = await inputs.bitmap(entry, 180, 180, () => check(session));
          const rotated = entry.rotation % 180;
          const width = rotated ? bitmap.height : bitmap.width, height = rotated ? bitmap.width : bitmap.height;
          const scale = Math.min(1, 180 / width, 180 / height), rotation = entry.rotation;
          const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
          const context = canvas.getContext('2d');
          context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
          context.translate(canvas.width / 2, canvas.height / 2); context.rotate(rotation * Math.PI / 180);
          context.drawImage(bitmap, -bitmap.width * scale / 2, -bitmap.height * scale / 2, bitmap.width * scale, bitmap.height * scale);
          const blob = await canvas.convertToBlob({ type: 'image/png' }); canvas.width = canvas.height = 0; check(session);
          if (!pages.includes(entry) || rotation !== entry.rotation) continue;
          entry.thumbnail = URL.createObjectURL(blob);
          const row = [...q('Pages').children].find(el => el.dataset.imagePage === entry.id);
          if (row) row.querySelector('img').src = entry.thumbnail;
        } catch (error) { if (current(session) && errorCode(error) !== 'cancelled') setStatus('error.' + errorCode(error), {}, true); }
        finally { bitmap?.close(); }
      }
    } finally { thumbnailBusy = false; if (owner && thumbnailQueue.length && !operation) void thumbnails(); }
  }
  function renderList() {
    const scrollTop = q('Pages').scrollTop;
    listScope?.dispose(); observer?.disconnect(); listScope = createLifecycleScope();
    q('Pages').replaceChildren(); q('Failures').replaceChildren();
    for (const [index, entry] of pages.entries()) {
      const row = node('article', 'image-pdf-page'); row.dataset.imagePage = entry.id;
      const grip = node('span', 'image-pdf-grip'); grip.tabIndex = 0; grip.setAttribute('role', 'button');
      grip.setAttribute('aria-label', tr('reorder', { page: index + 1 })); grip.append(node('span', '', String(index + 1)), icon('grip-vertical'));
      const button = node('button', 'image-pdf-page-select'); button.type = 'button'; button.dataset.selectPage = entry.id;
      const image = node('img'); image.alt = ''; image.draggable = false; if (entry.thumbnail) image.src = entry.thumbnail;
      const label = entry.source.file.name + (entry.source.frames.length > 1 ? ` (${entry.index + 1})` : '');
      const caption = node('span', '', label); caption.title = label; button.setAttribute('aria-label', tr('selectPage', { page: index + 1, name: label }));
      button.append(image, caption); row.append(grip, button); q('Pages').append(row);
      listScope.event(grip, 'keydown', event => {
        if (operation || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); const target = pages[index + (event.key === 'ArrowUp' ? -1 : 1)];
        if (target) { pages = movePage(pages, entry.id, target.id, event.key === 'ArrowDown'); renderList(); refreshPreview();
          [...q('Pages').children].find(el => el.dataset.imagePage === entry.id)?.querySelector('.image-pdf-grip').focus(); }
      });
    }
    bindPointerSortableFileList({ scope: listScope, container: q('Pages'), items: pages, rowSelector: ':scope > .image-pdf-page',
      isLocked: () => Boolean(operation), render: () => { renderList(); refreshPreview(); }, guardNativeDrop: ms => { dropGuard = performance.now() + ms; } });
    observer = new IntersectionObserver(events => {
      for (const event of events) if (event.isIntersecting) {
        const entry = pages.find(item => item.id === event.target.dataset.imagePage);
        if (entry && !entry.thumbnail && !thumbnailQueue.includes(entry)) thumbnailQueue.push(entry);
      }
      void thumbnails();
    }, { root: q('Pages'), rootMargin: '100px' });
    for (const row of q('Pages').children) observer.observe(row);
    for (const failure of failures) {
      const row = node('div', 'image-pdf-failure'); row.append(node('span', '', `${failure.name}: ${tr('error.' + failure.code)}`));
      const remove = node('button', 'image-pdf-button'); remove.type = 'button'; remove.dataset.removeFailure = failure.id;
      remove.setAttribute('aria-label', tr('removeFailed', { name: failure.name })); remove.append(icon('x')); row.append(remove); q('Failures').append(row);
    }
    sync(); refreshIcons(); q('Pages').scrollTop = scrollTop;
  }
  function sizePreview() {
    const image = q('Preview'), stage = q('Stage'); if (!image.naturalWidth) return;
    const fitted = Math.min((stage.clientWidth - 40) / image.naturalWidth, (stage.clientHeight - 40) / image.naturalHeight);
    const scale = fit ? Math.max(.02, fitted) : zoom;
    image.style.width = Math.max(1, Math.round(image.naturalWidth * scale)) + 'px';
    image.style.height = Math.max(1, Math.round(image.naturalHeight * scale)) + 'px';
  }
  function refreshPreview() { viewport.reset(); previewRevision++; previewWorker?.dispose(); if (!previewBusy) void preview(); }
  async function preview() {
    if (previewBusy || !owner || operation) return;
    const entry = pages.find(item => item.id === selected), token = previewRevision, session = owner;
    if (!entry) {
      q('Preview').removeAttribute('src'); q('Preview').hidden = true; q('PreviewStatus').textContent = '';
      if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; return;
    }
    previewBusy = true; const valid = () => { check(session); if (token !== previewRevision) throw imagePdfError('cancelled'); };
    let bitmap, url = '', worker;
    q('Preview').hidden = true; q('PreviewStatus').textContent = tr('previewLoading');
    try {
      const plan = pagePlan(entry, settings), scale = Math.min(1, 1200 / Math.max(plan.pixelWidth, plan.pixelHeight));
      plan.pixelWidth = Math.max(1, Math.floor(plan.pixelWidth * scale)); plan.pixelHeight = Math.max(1, Math.floor(plan.pixelHeight * scale));
      const { maxWidth, maxHeight } = decodeSize(entry, plan);
      bitmap = await inputs.bitmap(entry, maxWidth, maxHeight, valid); valid();
      worker = createImagePdfWorker(); previewWorker = worker;
      const rendered = await worker.request('render', { bitmap, plan, settings: { ...settings }, ordinal: pages.indexOf(entry) + 1, preview: true }, [bitmap]); valid();
      url = URL.createObjectURL(new Blob([rendered.buffer], { type: rendered.mime }));
      const decoded = new Image(); decoded.src = url; await decoded.decode(); valid();
      if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = url; url = '';
      q('Preview').src = previewUrl; q('Preview').hidden = false; sizePreview(); q('PreviewStatus').textContent = '';
    } catch (error) { if (current(session) && token === previewRevision && errorCode(error) !== 'cancelled') q('PreviewStatus').textContent = tr('error.' + errorCode(error)); }
    finally {
      bitmap?.close(); worker?.dispose(); if (previewWorker === worker) previewWorker = null;
      if (url) URL.revokeObjectURL(url); previewBusy = false;
      if (owner && (session !== owner || token !== previewRevision) && !operation) void preview();
    }
  }
  function cancel() { if (!operation || operation.committing) return; operation.cancelled = true; operation.worker?.dispose(); }
  function progress(value) {
    if (!operation) return;
    q('Progress').textContent = tr(value.phase, value); q('ProgressBar').value = value.percent || 0;
    q('Cancel').disabled = Boolean(operation.committing);
  }
  async function run(type, task) {
    if (!owner || operation) return;
    const session = owner, op = { owner: session, cancelled: false, committing: false, worker: null, started: performance.now() };
    operation = op; refreshPreview(); sync(); progress({ phase: type, percent: 0 }); processModal.open();
    const assertCurrent = () => { check(session); if (op.cancelled || operation !== op) throw imagePdfError('cancelled');
      if (!op.committing && performance.now() - op.started > LIMITS.timeoutMs) throw imagePdfError('timeout'); };
    void import('../../shared/curve-loading.js').then(({ startScanAnimation }) => {
      if (current(session) && operation === op) loadingStop = startScanAnimation(q('Curve'), q('Quote'), () => tr('local'));
    }).catch(() => {});
    try { await task(op, assertCurrent); }
    catch (error) { if (current(session)) setStatus('error.' + errorCode(error), {}, errorCode(error) !== 'cancelled'); }
    finally {
      op.worker?.dispose(); if (operation === op) { operation = null; loadingStop?.(); loadingStop = null;
        processModal.close(); if (current(session)) { sync(); refreshPreview(); void thumbnails(); } }
    }
  }
  async function addFiles(value) {
    const files = naturalFileOrder(Array.from(value || []));
    if (!files.length) return;
    if (files.length > LIMITS.pages || pages.length + failures.length + files.length > LIMITS.pages) { setStatus('error.pages', {}, true); return; }
    await run('loading', async (op, assertCurrent) => {
      const staged = [], rejected = []; let total = [...new Set(pages.map(page => page.source))].reduce((sum, source) => sum + source.size, 0);
      for (let i = 0; i < files.length; i++) {
        assertCurrent(); progress({ phase: 'loadingFile', current: i + 1, total: files.length, percent: i / files.length * 100 });
        try {
          const source = await inputs.inspect(files[i], assertCurrent); assertCurrent();
          if (total + source.size > LIMITS.totalInputBytes) throw imagePdfError('total-size');
          if (pages.length + staged.length + source.frames.length > LIMITS.pages) throw imagePdfError('pages');
          total += source.size;
          staged.push(...source.frames.map(frame => ({ ...frame, id: 'image-' + ++sequence, source, rotation: 0, thumbnail: '' })));
        } catch (error) { assertCurrent(); rejected.push({ id: 'failed-' + ++sequence, name: files[i].name, code: errorCode(error) }); }
      }
      assertCurrent(); pages.push(...staged); failures.push(...rejected); selected ||= pages[0]?.id || '';
      if (staged.length && q('Name').value === 'images') q('Name').value = staged[0].source.file.name.replace(/\.[^.]+$/, '');
      setStatus(rejected.length ? 'failedFiles' : staged.some(page => page.source.firstFrame) ? 'firstFrame' : null, { count: failures.length }, Boolean(rejected.length));
      renderList();
    });
  }
  async function pick() {
    if (operation || !owner) return;
    if (!isTauri) { q('Input').value = ''; q('Input').click(); return; }
    const session = owner;
    try {
      const { open } = await loadTauriDialog(); check(session);
      const value = await open({ multiple: true, filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'] }] }); check(session);
      if (value) await addFiles((Array.isArray(value) ? value : [value]).map(path => ({ path, name: path.split(/[\\/]/).pop() })));
    } catch (error) { if (current(session) && errorCode(error) !== 'cancelled') setStatus('error.failed', {}, true); }
  }
  function clear() {
    previewRevision++; previewWorker?.dispose(); observer?.disconnect(); listScope?.dispose(); thumbnailQueue = [];
    for (const entry of pages) if (entry.thumbnail) URL.revokeObjectURL(entry.thumbnail);
    pages = []; failures = []; selected = ''; settings = { ...DEFAULT_SETTINGS }; result = null; fit = true;
    if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; q('Preview').removeAttribute('src'); q('Preview').hidden = true;
    q('Name').value = 'images'; q('PreviewStatus').textContent = ''; setStatus(null); renderList();
  }
  function translate() {
    for (const root of [overlay, q('Process'), q('Success')]) root.querySelectorAll('[data-i18n],[data-i18n-title],[data-i18n-aria-label]').forEach(el => {
      if (el.dataset.i18n) el.textContent = t(el.dataset.i18n);
      if (el.dataset.i18nTitle) el.title = t(el.dataset.i18nTitle);
      if (el.dataset.i18nAriaLabel) el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
    });
    overlay.setAttribute('aria-label', tr('title')); if (owner) renderList(); else sync();
  }
  scope.event(overlay, 'click', event => {
    if (event.target.closest('[data-image-pdf-close]')) { close(); return; }
    if (operation) return;
    const setting = event.target.closest('[data-image-setting]');
    if (setting) { const key = setting.dataset.imageSetting; settings[key] = key === 'margin' ? Number(setting.dataset.value) : setting.dataset.value; sync(); refreshPreview(); }
    const choice = event.target.closest('[data-select-page]');
    if (choice) { selected = choice.dataset.selectPage; fit = true; sync(); refreshPreview(); }
    const failed = event.target.closest('[data-remove-failure]');
    if (failed) { failures = failures.filter(item => item.id !== failed.dataset.removeFailure); if (!failures.length) setStatus(null); renderList(); }
  });
  scope.event(q('Input'), 'change', () => { const files = Array.from(q('Input').files || []); q('Input').value = ''; void addFiles(files); });
  for (const id of ['Add', 'Pick']) scope.event(q(id), 'click', () => void pick());
  scope.event(q('Clear'), 'click', () => { if (!operation) clear(); });
  scope.event(q('RemoveFailed'), 'click', () => { if (!operation) { failures = []; setStatus(null); renderList(); } });
  scope.event(q('Rotate'), 'click', () => {
    const entry = pages.find(item => item.id === selected);
    if (!operation && entry) {
      entry.rotation = (entry.rotation + 90) % 360;
      if (entry.thumbnail) URL.revokeObjectURL(entry.thumbnail); entry.thumbnail = '';
      renderList(); refreshPreview();
    }
  });
  scope.event(q('Delete'), 'click', () => {
    if (operation) return; const index = pages.findIndex(item => item.id === selected); if (index < 0) return;
    const [removed] = pages.splice(index, 1); if (removed.thumbnail) URL.revokeObjectURL(removed.thumbnail);
    selected = pages[Math.min(index, pages.length - 1)]?.id || ''; renderList(); refreshPreview();
  });
  scope.event(q('Sort'), 'click', () => { if (!operation) { pages.sort((a, b) => new Intl.Collator('zh-CN', { numeric: true }).compare(a.source.file.name, b.source.file.name) || a.index - b.index); renderList(); refreshPreview(); } });
  for (const [id, factor] of [['ZoomOut', .8], ['ZoomIn', 1.25]]) scope.event(q(id), 'click', () => {
    viewport.zoomTo(q('Preview').clientWidth / q('Preview').naturalWidth * factor);
  });
  scope.event(q('Fit'), 'click', () => { viewport.reset(); fit = true; sizePreview(); });
  scope.event(q('Preview'), 'load', sizePreview);
  const resize = new ResizeObserver(sizePreview); resize.observe(q('Stage')); scope.use(() => resize.disconnect());
  scope.event(q('Export'), 'click', () => {
    if (failures.length || !pages.length) return;
    void run('preparing', async (op, assertCurrent) => {
      result = await exportImagePdf({ pages: pages.map(page => ({ ...page })), settings: { ...settings }, name: q('Name').value,
        inputs, check: assertCurrent, operation: op, isTauri, getOutputDir, progress }); assertCurrent();
      q('ResultName').textContent = result.name; q('ResultMeta').textContent = tr('result', { count: result.count, size: (result.bytes / 1048576).toFixed(2) });
      q('ResultPath').textContent = isTauri ? displayFilesystemPath(result.path) : tr('browserDownload');
      q('Open').hidden = q('Folder').hidden = !isTauri; processModal.close(); successModal.open();
    });
  });
  scope.event(q('Cancel'), 'click', cancel); scope.event(q('Done'), 'click', () => successModal.close());
  for (const id of ['Open', 'Folder']) scope.event(q(id), 'click', async () => {
    if (!isTauri || !result?.path) return;
    const session = owner, path = result.path;
    try { const { invoke } = await tauriCorePromise; check(session); await invoke(id === 'Folder' ? 'open_path' : 'open_image_pdf_result', { path }); }
    catch { if (current(session)) { successModal.close(); setStatus('error.open', {}, true); } }
  });
  scope.event(overlay, 'dragover', event => { if (!isTauri) event.preventDefault(); });
  scope.event(overlay, 'drop', event => { if (!isTauri) { event.preventDefault(); if (performance.now() >= dropGuard && event.dataTransfer?.files.length) void addFiles(event.dataTransfer.files); } });
  scope.event(document, 'keydown', event => { if (event.key === 'Escape' && owner && !overlay.inert) { event.preventDefault(); close(); } });
  scope.use(onLangChange(translate)); scope.event(window, 'pagehide', () => close());
  async function nativeDrop(session) {
    const { getCurrentWebview } = await loadTauriWebview(); check(session);
    session.use(await getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (current(session) && !operation && !overlay.inert && performance.now() >= dropGuard && payload.type === 'drop')
        void addFiles(payload.paths.map(path => ({ path, name: path.split(/[\\/]/).pop() })));
    }));
  }
  function open() {
    if (disposed) return; if (owner && close() === false) return; owner = createLifecycleScope();
    overlay.classList.add('visible'); setModalInteractivity(overlay, true); clear(); translate();
    const session = owner;
    if (isTauri) void nativeDrop(session).catch(() => { if (current(session)) setStatus('error.drop', {}, true); });
  }
  function close({ force = false } = {}) {
    if (operation?.committing && !force) return false;
    viewport.reset();
    const previous = owner; owner = null; cancel(); operation = null; previous?.dispose();
    loadingStop?.(); loadingStop = null; processModal.close({ restore: false }); successModal.close({ restore: false });
    clear(); moveFocusOutOfHiddenRegion(overlay); overlay.classList.remove('visible'); setModalInteractivity(overlay, false); return true;
  }
  translate();
  return { open, close, dispose() { if (disposed) return; close({ force: true }); disposed = true; scope.dispose(); listScope?.dispose(); observer?.disconnect(); } };
}
