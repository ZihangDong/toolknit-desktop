import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { createPdfWorkbench } from '../../shared/pdf-workbench.js';
import { pdfjsDocumentOptions, destroyPdfDocument } from '../../shared/pdfjs-options.js';
import { moveFocusOutOfHiddenRegion } from '../../shared/tool-page-shell.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession, setModalInteractivity } from '../../app/modal-runtime.js';
import { taskCenter } from '../../app/task-center.js';
import { tauriCorePromise, loadTauriDialog, loadTauriWebview } from '../../platform/tauri-runtime.js';
import { onLangChange, t } from '../../i18n.js';
import { PDF_PPT_LIMITS, pptError, pptErrorCode, pptPageRange, validatePptInput, validatePptPages } from './core.js';
import { exportPdfPresentation, publishPdfPresentation } from './processor.js';

export function createPdfPptController({ overlay, isTauri = false, getOutputDir,
  displayFilesystemPath = String, refreshIcons = () => {}, invokeNative, center = taskCenter } = {}) {
  const scope = createLifecycleScope(), q = id => document.getElementById(`pdfPpt${id}`);
  const tr = (key, params) => t(`home.pdfPpt.${key}`, params);
  const invoke = async (...args) => (invokeNative || (await tauriCorePromise).invoke)(...args);
  const upload = q('Upload'), input = q('FileInput'), back = q('Back'), mobileBar = q('MobileBar');
  let session = null, operation = null, pdf = null, file = null, result = null, disposed = false, dpi = 200;
  let status = null, progress = { key: 'loading', percent: 0 }, workbench = null;
  const ownerCurrent = owner => owner && session === owner && !owner.disposed;
  const current = op => operation === op && ownerCurrent(op?.owner) && !op.cancelled;
  const processModal = createModalSession({ root: q('Process'), background: overlay, initialFocus: q('Cancel'),
    onClose: cancel, canClose: () => !operation?.committing });
  const successModal = createModalSession({ root: q('Success'), background: overlay, initialFocus: q('Done'), onClose: () => successModal.close() });
  scope.use(processModal.dispose); scope.use(successModal.dispose);
  workbench = createPdfWorkbench({ root: overlay, pageStrip: q('Pages'), back, actions: q('Actions'), tag: 'PDF TO PPT · TOOL PAGE 3.4',
    labels: { back: 'settings.back', selectedCount: 'home.pdfPpt.selected', sourcePage: 'home.pdfPpt.sourcePage' },
    onChange: () => { if (workbench) updateControls(); }, refreshIcons });
  const body = overlay.querySelector('.pdf-workbench-body'), shell = overlay.querySelector('.pdf-workbench-shell');
  shell.insertBefore(upload, body); shell.insertBefore(mobileBar, body); shell.append(input);

  function updateControls() {
    const busy = Boolean(operation), loaded = Boolean(pdf);
    for (const node of overlay.querySelectorAll('[data-ppt-dpi]')) {
      node.disabled = busy; node.setAttribute('aria-pressed', String(Number(node.dataset.pptDpi) === dpi));
    }
    for (const id of ['Pick', 'Reset', 'Range', 'ApplyRange', 'All', 'None']) q(id).disabled = busy || (id !== 'Pick' && !loaded);
    const count = workbench?.getPages().filter(page => page.selected).length || 0;
    q('Selected').textContent = tr('selected', { count }); q('Export').disabled = busy || !count;
    mobileBar.hidden = !loaded; q('MobileExport').disabled = busy || !count;
    q('MobileOptions').disabled = busy; q('MobileExport').querySelector('span').textContent = tr('exportSelected', { count });
  }
  function renderStatus() {
    for (const id of ['Status', 'UploadStatus']) {
      q(id).textContent = status ? tr(status.key, status.params) : '';
      q(id).classList.toggle('is-error', Boolean(status?.error));
    }
  }
  function setStatus(key, params = {}, error = false) { status = { key, params, error }; renderStatus(); }
  function renderProgress() {
    q('ProgressTitle').textContent = tr(progress.key, progress);
    q('ProgressFill').style.width = `${progress.percent}%`;
    q('Process').querySelector('[role="progressbar"]').setAttribute('aria-valuenow', String(Math.round(progress.percent)));
  }
  function setProgress(value) { progress = value; renderProgress(); operation?.task?.progress(value.percent, tr(value.key, value)); }
  function renderResult() {
    if (!result) return;
    q('SuccessName').textContent = result.name;
    q('SuccessMeta').textContent = tr('resultMeta', { count: result.count, dpi: result.dpi, size: (result.size / 1024 / 1024).toFixed(2) });
    q('SuccessPath').textContent = result.path ? displayFilesystemPath(result.path) : tr('browserDownload');
    q('Folder').hidden = !result.path; q('ResultStatus').textContent = '';
  }
  function translate() {
    for (const root of [overlay, q('Process'), q('Success')]) root.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
    overlay.setAttribute('aria-label', tr('title')); updateControls(); renderStatus(); renderProgress(); renderResult();
  }
  function begin(kind) {
    const op = { owner: session, kind, cancelled: false, timedOut: false, committing: false, loadingTask: null, worker: null, renderTask: null };
    op.check = () => { if (!current(op)) throw pptError(op.timedOut ? 'timeout' : 'cancelled'); };
    operation = op;
    const timer = setTimeout(() => { if (current(op) && !op.committing) { op.timedOut = true; cancel(); setStatus('error.timeout', {}, true); } }, kind === 'load' ? 60000 : PDF_PPT_LIMITS.timeoutMs);
    op.clearTimer = op.owner.use(() => clearTimeout(timer));
    updateControls(); workbench.setLocked(true); q('Cancel').disabled = false;
    setProgress({ key: kind === 'load' ? 'loading' : 'preparing', percent: 0 }); processModal.open();
    if (kind === 'export') op.task = center.begin({ label: tr('title'), tool: 'pdf-to-ppt', cancel });
    return op;
  }
  function cancel() {
    const op = operation; if (!op || op.committing) return;
    op.cancelled = true; op.clearTimer();
    try { op.renderTask?.cancel(); } catch {}
    op.worker?.dispose(); void op.loadingTask?.destroy().catch(() => {});
    processModal.close(); setStatus(op.timedOut ? 'error.timeout' : 'cancelled', {}, op.timedOut);
  }
  function end(op) {
    op.clearTimer(); if (operation !== op) return;
    operation = null; processModal.close(); workbench.setLocked(false); updateControls();
  }
  function releaseDocument() {
    workbench.clear(); const previous = pdf; pdf = null; file = null;
    if (previous) void Promise.resolve(destroyPdfDocument(previous)).catch(() => {});
  }
  function report(error) {
    const code = pptErrorCode(error);
    setStatus(code === 'cancelled' ? 'cancelled' : `error.${code}`, {}, code !== 'cancelled');
  }
  async function loadFile(candidate) {
    if (!session || operation || disposed) return;
    const op = begin('load'); let task, loaded, adopted = false, password = false;
    try {
      let bytes;
      if (candidate.path) {
        candidate = { ...candidate, size: Number(await invoke('get_file_size', { path: candidate.path })) }; op.check();
        validatePptInput(candidate);
        bytes = Uint8Array.from(await invoke('read_file_bytes_limited', { path: candidate.path, maxBytes: PDF_PPT_LIMITS.inputBytes }));
      } else { validatePptInput(candidate); bytes = new Uint8Array(await candidate.arrayBuffer()); }
      op.check(); validatePptInput({ name: candidate.name, size: bytes.length });
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); op.check();
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      task = pdfjs.getDocument(pdfjsDocumentOptions({ data: bytes, isEvalSupported: false })); op.loadingTask = task;
      task.onPassword = () => { password = true; void task.destroy().catch(() => {}); };
      loaded = await task.promise; op.check(); validatePptPages(loaded.numPages);
      releaseDocument(); pdf = loaded; loaded = null; adopted = true; file = candidate; op.loadingTask = null;
      moveFocusOutOfHiddenRegion(upload); upload.hidden = true; body.hidden = false;
      q('TitleSlot').prepend(q('Title'));
      const snapshot = pdf;
      workbench.setPages(Array.from({ length: pdf.numPages }, (_, i) => ({ pageIndex: i + 1, selected: true, fileName: candidate.name })), entry => snapshot.getPage(entry.pageIndex));
      setStatus('fileMeta', { count: pdf.numPages });
    } catch (error) { if (ownerCurrent(op.owner) && !op.cancelled) report(password ? pptError('password') : error); }
    finally {
      if (loaded) void Promise.resolve(destroyPdfDocument(loaded)).catch(() => {});
      if (task && !adopted) void task.destroy().catch(() => {});
      end(op); if (ownerCurrent(op.owner)) (pdf ? q('Export') : q('Pick')).focus({ preventScroll: true });
    }
  }
  async function pick() {
    if (!session || operation) return;
    if (!isTauri) { input.click(); return; }
    const owner = session;
    try {
      const { open } = await loadTauriDialog(); if (!ownerCurrent(owner)) return;
      const path = await open({ multiple: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (path && ownerCurrent(owner)) await loadFile({ path, name: path.split(/[\\/]/).pop() });
    } catch { if (ownerCurrent(owner)) setStatus('error.read', {}, true); }
  }
  function reset() {
    if (operation) return;
    releaseDocument(); result = null; successModal.close();
    moveFocusOutOfHiddenRegion(body); body.hidden = true; upload.hidden = false;
    upload.querySelector('.pdf-ppt-upload-copy').prepend(q('Title'));
    dpi = 200; q('Range').value = ''; input.value = ''; status = null; renderStatus(); updateControls(); q('Pick').focus({ preventScroll: true });
  }
  async function runExport() {
    if (!pdf || operation || !session) return;
    const pages = workbench.getPages().filter(page => page.selected).map(page => page.pageIndex);
    if (!pages.length) return;
    const op = begin('export');
    try {
      const output = await exportPdfPresentation({ pdf, pages, dpi, fileName: file.name, operation: op,
        onProgress: value => { if (current(op)) setProgress(value); } });
      op.check(); let path = '';
      if (isTauri) {
        setProgress({ key: 'saving', percent: 97 });
        path = await publishPdfPresentation({ output, invoke, getOutputDir, operation: op,
          onCommit: () => { q('Cancel').disabled = true; op.task.disableCancellation(); op.clearTimer(); } });
      } else {
        const url = URL.createObjectURL(new Blob([output.bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
        const revoke = op.owner.use(() => URL.revokeObjectURL(url)); op.owner.timeout(revoke, 30000);
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = output.name;
        document.body.append(anchor); anchor.click(); anchor.remove();
      }
      op.task.finish({ outputs: path ? [path] : [], message: tr('resultMeta', { count: output.count, dpi: output.dpi, size: (output.bytes.length / 1024 / 1024).toFixed(2) }) });
      if (!ownerCurrent(op.owner)) return;
      result = { name: path ? path.split(/[\\/]/).pop() : output.name, path, count: output.count, dpi: output.dpi, size: output.bytes.length };
      renderResult(); setStatus('success'); end(op); successModal.open();
    } catch (error) {
      const actual = op.cancelled ? pptError(op.timedOut ? 'timeout' : 'cancelled') : error;
      op.task.fail(actual); if (ownerCurrent(op.owner)) report(actual);
    } finally { end(op); }
  }
  scope.event(q('Pick'), 'click', () => { void pick(); }); scope.event(back, 'click', close);
  scope.event(q('Reset'), 'click', reset); scope.event(q('Export'), 'click', () => { void runExport(); });
  scope.event(q('MobileExport'), 'click', () => { void runExport(); });
  scope.event(q('MobileOptions'), 'click', () => { q('Range').scrollIntoView({ block: 'center' }); q('Range').focus({ preventScroll: true }); });
  scope.event(q('Cancel'), 'click', cancel); scope.event(q('Done'), 'click', () => successModal.close());
  scope.event(input, 'change', () => { const candidate = input.files?.[0]; input.value = ''; if (candidate) void loadFile(candidate); });
  scope.event(overlay, 'click', event => {
    const button = event.target.closest('[data-ppt-dpi]'); if (button && !button.disabled) { dpi = Number(button.dataset.pptDpi); updateControls(); }
  });
  for (const id of ['All', 'None']) scope.event(q(id), 'click', () => {
    workbench.getPages().forEach(page => { page.selected = id === 'All'; }); workbench.refresh();
  });
  function applyRange() {
    if (!pdf || operation) return;
    try {
      const pages = new Set(pptPageRange(q('Range').value, pdf.numPages));
      workbench.getPages().forEach(page => { page.selected = pages.has(page.pageIndex); }); workbench.refresh();
      setStatus('selected', { count: pages.size });
    } catch (error) { report(error); }
  }
  scope.event(q('ApplyRange'), 'click', applyRange);
  scope.event(q('Range'), 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); applyRange(); } });
  scope.event(q('Folder'), 'click', async () => {
    const owner = session, path = result?.path; if (!path || !isTauri) return;
    try { await invoke('open_path', { path }); }
    catch { if (ownerCurrent(owner)) q('ResultStatus').textContent = tr('error.folder'); }
  });
  scope.event(overlay, 'dragover', event => { if (!isTauri) event.preventDefault(); });
  scope.event(overlay, 'drop', event => {
    if (isTauri) return; event.preventDefault(); if (operation) return;
    if (event.dataTransfer?.files.length !== 1) { setStatus('error.single', {}, true); return; }
    void loadFile(event.dataTransfer.files[0]);
  });
  scope.event(document, 'keydown', event => { if (event.key === 'Escape' && session && !overlay.inert) close(); });
  scope.use(onLangChange(translate)); scope.event(window, 'pagehide', close);
  async function bindNativeDrop(owner) {
    try {
      const { getCurrentWebview } = await loadTauriWebview(); if (!ownerCurrent(owner)) return;
      owner.use(await getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (!ownerCurrent(owner) || overlay.inert || operation || payload.type !== 'drop') return;
        if (payload.paths.length !== 1) { setStatus('error.single', {}, true); return; }
        const path = payload.paths[0]; void loadFile({ path, name: path.split(/[\\/]/).pop() });
      }));
    } catch { /* File picker remains available when native drag registration is unavailable. */ }
  }
  function open() {
    if (disposed || close() === false) return false;
    session = createLifecycleScope(); overlay.classList.add('visible'); setModalInteractivity(overlay, true);
    reset(); translate(); refreshIcons(); if (isTauri) void bindNativeDrop(session);
  }
  function close() {
    if (operation?.committing) return false;
    if (operation) { cancel(); operation.task?.fail(pptError('cancelled')); }
    const owner = session; session = null; operation = null; owner?.dispose();
    processModal.close({ restore: false }); successModal.close({ restore: false });
    releaseDocument(); result = null; moveFocusOutOfHiddenRegion(overlay);
    overlay.classList.remove('visible'); setModalInteractivity(overlay, false);
  }
  translate(); refreshIcons();
  return { open, close, openWithFile: loadFile, get busy() { return Boolean(operation); },
    dispose() { if (disposed || close() === false) return; disposed = true; workbench.dispose(); scope.dispose(); } };
}
