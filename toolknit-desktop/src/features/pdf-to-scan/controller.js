import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { createPdfWorkbench } from '../../shared/pdf-workbench.js';
import { pdfjsDocumentOptions, destroyPdfDocument } from '../../shared/pdfjs-options.js';
import { moveFocusOutOfHiddenRegion } from '../../shared/tool-page-shell.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession, setModalInteractivity } from '../../app/modal-runtime.js';
import { tauriCorePromise, loadTauriDialog, loadTauriWebview } from '../../platform/tauri-runtime.js';
import { onLangChange, t } from '../../i18n.js';
import { DEFAULT_SCAN_SETTINGS, SCAN_LIMITS, scanError, scanErrorCode, scanPageRange, validateScanInput, validateScanPages } from './core.js';
import { createScanWorker } from './worker-client.js';
import { exportScannedPdf, transformScanCanvas } from './processor.js';
import { previewControlsMarkup } from './template.js';

export function createPdfScanController({ overlay, isTauri = false, getOutputDir, displayFilesystemPath = value => value, refreshIcons = () => {} } = {}) {
  const scope = createLifecycleScope();
  const byId = id => document.getElementById(`pdfScan${id}`);
  const upload = byId('Upload'), fileInput = byId('FileInput'), actions = byId('Actions');
  const processRoot = byId('ProcessOverlay'), passwordRoot = byId('PasswordOverlay'), successRoot = byId('SuccessOverlay');
  const back = byId('Back'), pagesRoot = byId('Pages');
  let session = null, operation = null, pdf = null, file = null, previewWorker = null, workbench = null, disposed = false;
  let settings = { ...DEFAULT_SCAN_SETTINGS }, previewMode = 'effect', status = null, progress = { key: 'loading', percent: 0 }, result = null;
  let passwordUpdate = null, passwordReason = 1;
  const tr = (key, params) => t(`home.pdfScan.${key}`, params);
  const ownerCurrent = owner => owner && session === owner && !owner.disposed;
  const current = op => operation === op && ownerCurrent(op?.owner) && !op.cancelled;

  const processModal = createModalSession({ root: processRoot, background: overlay, initialFocus: byId('Cancel'),
    onClose: () => cancel(), canClose: () => !operation?.committing });
  const passwordModal = createModalSession({ root: passwordRoot, background: overlay, initialFocus: byId('Password'), onClose: () => cancel() });
  const successModal = createModalSession({ root: successRoot, background: overlay, initialFocus: byId('SuccessOk'), onClose: () => successModal.close() });

  workbench = createPdfWorkbench({ root: overlay, pageStrip: pagesRoot, back, actions, tag: 'PDF TO SCAN · TOOL PAGE 3.1',
    labels: { back: 'settings.back', selectedCount: 'home.pdfScan.selected', sourcePage: 'home.pdfScan.sourcePage' },
    onChange: () => { if (workbench) updateControls(); }, refreshIcons,
    async transformPreview(canvas, entry, isCurrent) {
      if (previewMode !== 'effect' || settings.mode === 'faithful' || !session) return;
      const owner = session, snapshot = { ...settings };
      previewWorker ||= createScanWorker();
      try {
        await transformScanCanvas(canvas, snapshot, entry.pageIndex, previewWorker, () => {
          if (!ownerCurrent(owner) || !isCurrent()) throw scanError('cancelled');
        });
      } catch (error) {
        if (ownerCurrent(owner) && isCurrent()) { previewWorker?.dispose(); previewWorker = null; report(error); }
        throw error;
      }
    }
  });
  const body = overlay.querySelector('.pdf-workbench-body'), shell = overlay.querySelector('.pdf-workbench-shell');
  shell.insertBefore(upload, body); shell.append(fileInput);
  const controls = document.createElement('div');
  controls.innerHTML = previewControlsMarkup;
  overlay.querySelector('.pdf-editor-preview-toolbar').append(controls.firstElementChild);

  function translate() {
    for (const root of [overlay, processRoot, passwordRoot, successRoot]) {
      root.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
      root.querySelectorAll('[data-i18n-aria-label]').forEach(node => node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel)));
    }
    overlay.setAttribute('aria-label', tr('title'));
    byId('PasswordHint').textContent = tr(passwordReason === 2 ? 'passwordWrong' : 'passwordHint');
    updateControls(); renderStatus(); renderProgress(); renderResult();
  }
  function updateControls() {
    const busy = Boolean(operation), loaded = Boolean(pdf);
    for (const button of overlay.querySelectorAll('[data-scan-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.scanMode === settings.mode)); button.disabled = busy;
    }
    for (const button of overlay.querySelectorAll('[data-scan-dpi]')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.scanDpi) === settings.dpi)); button.disabled = busy;
    }
    for (const button of overlay.querySelectorAll('[data-scan-preview]')) {
      button.setAttribute('aria-pressed', String(button.dataset.scanPreview === previewMode)); button.disabled = busy;
    }
    for (const key of ['noise', 'warmth', 'skew']) {
      const suffix = key[0].toUpperCase() + key.slice(1);
      byId(suffix).disabled = busy || settings.mode !== 'natural';
      byId(`${suffix}Value`).textContent = `${settings[key]}${key === 'skew' ? '\u00b0' : ''}`;
    }
    for (const id of ['Pick', 'Reset', 'All', 'None', 'ApplyRange', 'Range', 'Expand']) byId(id).disabled = busy;
    const count = workbench?.getPages().filter(page => page.selected).length || 0;
    byId('Export').disabled = busy || !loaded || !count;
    byId('ModeHint').textContent = tr(`${settings.mode}Hint`);
    byId('Selected').textContent = tr('selected', { count });
    const expanded = overlay.classList.contains('is-expanded');
    byId('Expand').title = tr(expanded ? 'collapse' : 'expand');
    byId('Expand').setAttribute('aria-label', byId('Expand').title);
    byId('Expand').setAttribute('aria-expanded', String(expanded));
  }
  function renderStatus() {
    for (const id of ['Status', 'UploadStatus']) {
      byId(id).textContent = status ? tr(status.key, status.params) : '';
      byId(id).classList.toggle('is-error', Boolean(status?.error));
    }
  }
  function setStatus(key, params = {}, error = false) { status = { key, params, error }; renderStatus(); }
  function renderProgress() {
    byId('ProgressTitle').textContent = tr(progress.key, progress);
    byId('ProgressFill').style.width = `${progress.percent}%`;
    processRoot.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', String(Math.round(progress.percent)));
  }
  function setProgress(value) { progress = value; renderProgress(); }
  function renderResult() {
    if (!result) return;
    byId('SuccessName').textContent = result.name;
    byId('SuccessMeta').textContent = tr('resultMeta', { count: result.count, size: formatSize(result.bytes.length), dpi: result.settings.dpi });
    byId('SuccessPath').textContent = isTauri ? displayFilesystemPath(result.path) : tr('browserDownload');
    byId('OpenFolder').hidden = !isTauri || !result.path;
  }
  function formatSize(bytes) { return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
  function begin(type) {
    const op = { type, owner: session, cancelled: false, committing: false, renderTask: null, worker: null, loadingTask: null };
    op.isCurrent = () => current(op); operation = op;
    const timer = setTimeout(() => {
      if (current(op) && !op.committing) { cancel(); setStatus('error.timeout', {}, true); }
    }, type === 'load' ? 60000 : SCAN_LIMITS.timeoutMs);
    op.clearTimeout = op.owner.use(() => clearTimeout(timer));
    setProgress({ key: type === 'load' ? 'loading' : 'preparing', percent: 0 });
    updateControls(); workbench.setLocked(true); processModal.open();
    return op;
  }
  function cancel() {
    const op = operation;
    if (!op || op.committing) return;
    op.cancelled = true;
    op.clearTimeout();
    try { op.renderTask?.cancel(); } catch {}
    op.worker?.dispose();
    void op.loadingTask?.destroy().catch(() => {});
    passwordUpdate = null; byId('Password').value = '';
    passwordModal.close(); processModal.close();
    setStatus('cancelled');
  }
  function end(op) {
    op.clearTimeout();
    if (operation !== op) return;
    operation = null; passwordUpdate = null;
    passwordModal.close(); processModal.close();
    workbench.setLocked(false); byId('Cancel').disabled = false; updateControls();
  }
  function report(error) {
    const code = scanErrorCode(error);
    if (code === 'cancelled' || error?.name === 'RenderingCancelledException') setStatus('cancelled');
    else setStatus(`error.${code}`, {}, true);
  }
  async function loadFile(candidate) {
    if (!session || operation || disposed) return;
    const op = begin('load');
    let task = null, loaded = null, adopted = false;
    const check = () => { if (!current(op)) throw scanError('cancelled'); };
    try {
      let bytes;
      if (candidate.path) {
        const { invoke } = await tauriCorePromise; check();
        candidate = { ...candidate, size: Number(await invoke('get_file_size', { path: candidate.path })) }; check();
        validateScanInput(candidate);
        bytes = Uint8Array.from(await invoke('read_file_bytes_limited', { path: candidate.path, maxBytes: SCAN_LIMITS.inputBytes }));
      } else { validateScanInput(candidate); bytes = new Uint8Array(await candidate.arrayBuffer()); }
      check(); validateScanInput({ name: candidate.name, size: bytes.length });
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); check();
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      task = pdfjs.getDocument(pdfjsDocumentOptions({ data: bytes, isEvalSupported: false })); op.loadingTask = task;
      task.onPassword = (update, reason) => {
        if (!current(op)) return;
        passwordUpdate = update; passwordReason = reason;
        byId('Password').value = ''; byId('PasswordHint').textContent = tr(reason === 2 ? 'passwordWrong' : 'passwordHint');
        processModal.close(); passwordModal.open();
      };
      loaded = await task.promise; check(); validateScanPages(loaded.numPages);
      releaseDocument(); pdf = loaded; loaded = null; adopted = true; file = candidate; op.loadingTask = null;
      moveFocusOutOfHiddenRegion(upload);
      upload.hidden = true; body.hidden = false;
      workbench.setPages(Array.from({ length: pdf.numPages }, (_, i) => ({ pageIndex: i + 1, selected: true, fileName: candidate.name })), entry => pdf.getPage(entry.pageIndex));
      setStatus('fileMeta', { count: pdf.numPages, size: formatSize(candidate.size) });
    } catch (error) { if (ownerCurrent(op.owner) && !op.cancelled) report(error); }
    finally {
      if (loaded) void destroyPdfDocument(loaded);
      if (task && !adopted) void task.destroy().catch(() => {});
      end(op);
      if (ownerCurrent(op.owner) && pdf) byId('Export').focus({ preventScroll: true });
    }
  }
  async function pick() {
    if (!session || operation) return;
    const owner = session;
    if (!isTauri) { fileInput.click(); return; }
    try {
      const { open } = await loadTauriDialog();
      if (!ownerCurrent(owner)) return;
      const path = await open({ multiple: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (path && ownerCurrent(owner)) await loadFile({ path, name: path.split(/[\\/]/).pop() });
    } catch { if (ownerCurrent(owner)) setStatus('error.read', {}, true); }
  }
  function releaseDocument() {
    workbench.clear(); previewWorker?.dispose(); previewWorker = null;
    const old = pdf; pdf = null; file = null;
    if (old) void destroyPdfDocument(old).catch(() => {});
  }
  function reset() {
    if (operation) return;
    releaseDocument(); result = null; successModal.close();
    moveFocusOutOfHiddenRegion(body); body.hidden = true; upload.hidden = false;
    overlay.classList.remove('is-expanded');
    const sidebar = overlay.querySelector('.pdf-editor-page-sidebar');
    sidebar.inert = false; sidebar.setAttribute('aria-hidden', 'false');
    settings = { ...DEFAULT_SCAN_SETTINGS }; previewMode = 'effect';
    for (const key of ['Noise', 'Warmth', 'Skew']) byId(key).value = String(settings[key.toLowerCase()]);
    byId('Range').value = ''; byId('Advanced').open = false; fileInput.value = '';
    status = null; renderStatus(); updateControls();
    byId('Pick').focus({ preventScroll: true });
  }
  async function runExport() {
    if (!pdf || operation || !session) return;
    const selected = workbench.getPages().filter(page => page.selected).map(page => page.pageIndex);
    if (!selected.length) return;
    const op = begin('export'), snapshot = pdf;
    try {
      const output = await exportScannedPdf({ pdf: snapshot, pages: selected, settings: { ...settings }, fileName: file.name,
        operation: op, isTauri, getOutputDir, onProgress: value => { if (current(op)) setProgress(value); },
        onCommit: () => { if (current(op)) byId('Cancel').disabled = true; } });
      if (!current(op)) return;
      if (!isTauri) {
        const url = URL.createObjectURL(new Blob([output.bytes], { type: 'application/pdf' }));
        const owner = op.owner;
        const revoke = owner.use(() => URL.revokeObjectURL(url)); owner.timeout(revoke, 30000);
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = output.name;
        document.body.append(anchor); anchor.click(); anchor.remove();
      }
      result = output; renderResult(); setStatus('success');
      end(op); successModal.open();
    } catch (error) { if (ownerCurrent(op.owner)) report(error); }
    finally { end(op); }
  }
  function refreshPreview() { workbench.refreshPages([workbench.currentIndex()]); }
  function expand() {
    const expanded = overlay.classList.toggle('is-expanded');
    const sidebar = overlay.querySelector('.pdf-editor-page-sidebar');
    if (expanded) moveFocusOutOfHiddenRegion(sidebar);
    sidebar.inert = expanded; sidebar.setAttribute('aria-hidden', String(expanded));
    updateControls(); refreshPreview();
  }
  scope.event(overlay, 'click', event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.dataset.scanMode) { settings.mode = button.dataset.scanMode; updateControls(); refreshPreview(); }
    if (button.dataset.scanDpi) { settings.dpi = Number(button.dataset.scanDpi); updateControls(); }
    if (button.dataset.scanPreview) { previewMode = button.dataset.scanPreview; updateControls(); refreshPreview(); }
  });
  scope.event(byId('Pick'), 'click', () => { void pick(); });
  scope.event(byId('Reset'), 'click', reset);
  scope.event(back, 'click', close);
  scope.event(byId('Export'), 'click', () => { void runExport(); });
  scope.event(byId('Cancel'), 'click', cancel);
  scope.event(byId('Expand'), 'click', expand);
  for (const id of ['All', 'None']) scope.event(byId(id), 'click', () => {
    workbench.getPages().forEach(page => { page.selected = id === 'All'; }); workbench.refresh();
  });
  scope.event(byId('ApplyRange'), 'click', () => {
    if (!pdf) return;
    try {
      const selected = new Set(scanPageRange(byId('Range').value, pdf.numPages));
      workbench.getPages().forEach(page => { page.selected = selected.has(page.pageIndex); }); workbench.refresh();
      setStatus('selected', { count: selected.size });
    } catch (error) { report(error); }
  });
  for (const id of ['Noise', 'Warmth', 'Skew']) scope.event(byId(id), 'input', () => {
    settings[id.toLowerCase()] = Number(byId(id).value); updateControls();
    session?.invalidate();
    // Delay only the preview, leaving slider feedback immediate.
    const owner = session, revision = owner?.token();
    owner?.timeout(() => { if (ownerCurrent(owner) && owner.isCurrent(revision)) refreshPreview(); }, 160);
  });
  scope.event(fileInput, 'change', () => {
    const candidate = fileInput.files?.[0]; fileInput.value = '';
    if (candidate) void loadFile(candidate);
  });
  scope.event(byId('PasswordForm'), 'submit', event => {
    event.preventDefault();
    if (!passwordUpdate || !operation) return;
    const value = byId('Password').value; byId('Password').value = '';
    const update = passwordUpdate; passwordUpdate = null;
    passwordModal.close(); processModal.open(); update(value);
  });
  scope.event(byId('PasswordCancel'), 'click', cancel);
  scope.event(byId('SuccessOk'), 'click', () => successModal.close());
  scope.event(byId('OpenFolder'), 'click', async () => {
    const owner = session, path = result?.path;
    if (!isTauri || !path) return;
    try { const { invoke } = await tauriCorePromise; if (ownerCurrent(owner)) await invoke('open_path', { path }); }
    catch { if (ownerCurrent(owner)) setStatus('error.open-folder', {}, true); }
  });
  scope.event(overlay, 'dragover', event => { if (!isTauri) event.preventDefault(); });
  scope.event(overlay, 'drop', event => {
    if (isTauri) return;
    event.preventDefault();
    if (event.dataTransfer?.files.length !== 1) { setStatus('error.single', {}, true); return; }
    void loadFile(event.dataTransfer.files[0]);
  });
  scope.event(document, 'keydown', event => {
    if (event.key !== 'Escape' || !session || overlay.inert) return;
    if (overlay.classList.contains('is-expanded')) { event.preventDefault(); event.stopPropagation(); expand(); }
    else close();
  });
  scope.use(onLangChange(translate)); scope.event(window, 'pagehide', close);
  async function bindNativeDrop(owner) {
    try {
      const { getCurrentWebview } = await loadTauriWebview();
      if (!ownerCurrent(owner)) return;
      const unlisten = await getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (!ownerCurrent(owner) || overlay.inert || payload.type !== 'drop') return;
        if (payload.paths.length !== 1) { setStatus('error.single', {}, true); return; }
        const path = payload.paths[0]; void loadFile({ path, name: path.split(/[\\/]/).pop() });
      });
      owner.use(unlisten);
    } catch { if (ownerCurrent(owner)) setStatus('dropUnavailable'); }
  }
  function open() {
    if (disposed) return;
    if (session) close();
    session = createLifecycleScope(); overlay.classList.add('visible'); setModalInteractivity(overlay, true);
    reset(); translate(); refreshIcons();
    if (isTauri) void bindNativeDrop(session);
  }
  function close() {
    const owner = session; session = null;
    if (operation && !operation.committing) {
      operation.cancelled = true; try { operation.renderTask?.cancel(); } catch {}
      operation.worker?.dispose(); void operation.loadingTask?.destroy().catch(() => {});
    }
    operation = null; passwordUpdate = null; byId('Password').value = '';
    processModal.close({ restore: false }); passwordModal.close({ restore: false }); successModal.close({ restore: false });
    owner?.dispose(); releaseDocument(); result = null;
    moveFocusOutOfHiddenRegion(overlay); overlay.classList.remove('visible'); setModalInteractivity(overlay, false);
  }
  translate(); refreshIcons();
  return { open, close, dispose() { if (disposed) return; close(); disposed = true; workbench.dispose(); scope.dispose(); } };
}
