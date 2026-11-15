import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession, setModalInteractivity } from '../../app/modal-runtime.js';
import { moveFocusOutOfHiddenRegion } from '../../shared/tool-page-shell.js';
import { loadTauriDialog, loadTauriWebview, tauriCorePromise, tauriEventPromise } from '../../platform/tauri-runtime.js';
import { applyTranslations, onLangChange, t } from '../../i18n.js';
import { addWordFiles, applyWordResult, wordErrorCode, wordName } from './core.js';

export function createWordPdfController({
  overlay, isTauri = false, getOutputDir, ensureLibreOfficeAvailable,
  checkLibreOfficeAvailable, requestLibreOfficeRuntime, openLazyTool,
  showToast = () => {}, displayFilesystemPath = String,
  formatFileSize = bytes => `${(Number(bytes || 0) / 1024).toFixed(1)} KB`,
  refreshIcons = () => {}, nativeInvoke, nativeListen, chooseWordFiles,
} = {}) {
  const lifetime = createLifecycleScope();
  const doc = overlay.ownerDocument;
  const q = id => doc.getElementById(`wordPdf${id}`);
  const tr = (key, args) => t(`home.wordPdf.${key}`, args);
  const invoke = nativeInvoke || ((command, args) => tauriCorePromise.then(api => api.invoke(command, args)));
  const listen = nativeListen || ((name, fn) => tauriEventPromise.then(api => api.listen(name, fn)));
  let session = null, returnFocus = null, rows = [], successTarget = null;
  let operation = null, disposed = false, message = null, transferring = false;
  const visible = () => session && !session.disposed && !disposed;
  const current = owner => visible() && owner === session;
  const errorText = error => tr(`errors.${wordErrorCode(error)}`);
  const processModal = createModalSession({ root: q('Process'), background: overlay, initialFocus: q('Cancel'), onClose: () => void cancel() });
  const successModal = createModalSession({ root: q('Success'), background: overlay, initialFocus: q('SuccessEditor'), onClose: reset });
  lifetime.use(processModal.dispose);
  lifetime.use(successModal.dispose);

  function setStatus(key, params = {}) {
    message = key ? { key, params } : null;
    q('Status').textContent = key ? tr(key, params) : '';
    q('Status').hidden = !key;
  }
  function clearResult() {
    successTarget = null;
    for (const id of ['SuccessName', 'SuccessMeta', 'SuccessPath', 'ResultStatus']) {
      q(id).textContent = '';
      q(id).removeAttribute('title');
    }
    q('ResultSelect').replaceChildren();
  }
  function reset() {
    if (operation || transferring) return;
    successModal.close({ restore: false });
    rows = [];
    clearResult();
    setStatus('');
    render();
    if (visible()) q('Pick').focus({ preventScroll: true });
  }
  function icon(name) {
    const el = doc.createElement('i');
    el.dataset.lucide = name;
    return el;
  }
  function render() {
    const focused = doc.activeElement;
    const focusedPath = focused?.dataset?.wordResult || focused?.dataset?.wordRemove;
    q('Empty').hidden = rows.length > 0;
    q('Files').hidden = rows.length === 0;
    q('QueueCount').textContent = rows.length ? String(rows.length) : '';
    for (const id of ['Pick', 'Clear', 'Convert', 'Retry']) q(id).disabled = Boolean(operation || transferring);
    q('Clear').disabled ||= rows.length === 0;
    q('Convert').disabled ||= !rows.some(row => row.status === 'pending');
    q('Retry').hidden = !rows.some(row => ['failed', 'cancelled'].includes(row.status));
    q('Retry').disabled ||= q('Retry').hidden;
    const fragment = doc.createDocumentFragment();
    for (const row of rows) {
      const item = doc.createElement('article');
      item.className = 'word-pdf-file';
      const info = doc.createElement('div');
      info.className = 'word-pdf-file-info';
      const title = doc.createElement('strong');
      title.textContent = row.name;
      title.title = row.name;
      const detail = doc.createElement('small');
      detail.textContent = row.error ? errorText(row.error) : tr(`states.${row.status}`);
      if (row.status === 'success') detail.textContent += ` · ${formatFileSize(row.outputBytes)}`;
      info.append(title, detail);
      item.append(icon('file-type-2'), info);
      if (row.outputPath) {
        const result = doc.createElement('button');
        result.type = 'button';
        result.className = 'word-pdf-button';
        result.dataset.wordResult = row.path;
        result.textContent = tr('viewResults');
        result.disabled = Boolean(operation || transferring);
        item.append(result);
      }
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'word-pdf-button word-pdf-remove';
      remove.dataset.wordRemove = row.path;
      remove.setAttribute('aria-label', tr('remove'));
      remove.title = tr('remove');
      remove.append(icon('x'));
      remove.disabled = Boolean(operation || transferring);
      item.append(remove);
      fragment.append(item);
    }
    q('Files').replaceChildren(fragment);
    if (focusedPath) {
      const attr = focused.dataset.wordResult ? 'wordResult' : 'wordRemove';
      const replacement = [...q('Files').querySelectorAll('button')].find(el => el.dataset[attr] === focusedPath);
      (replacement && !replacement.disabled ? replacement : q('Pick')).focus({ preventScroll: true });
    }
    if (message) setStatus(message.key, message.params);
    refreshIcons();
  }
  function resultDetails() {
    if (!successTarget) return;
    const name = wordName(successTarget.outputPath);
    q('SuccessName').textContent = name;
    q('SuccessName').title = name;
    q('SuccessMeta').textContent = tr('successDetails', { pages: successTarget.pageCount, size: formatFileSize(successTarget.outputBytes) });
    q('SuccessPath').textContent = displayFilesystemPath(successTarget.outputPath);
    q('SuccessPath').title = q('SuccessPath').textContent;
    q('ResultStatus').textContent = '';
  }
  function showResult(row) {
    if (!row?.outputPath || operation || !visible()) return;
    successTarget = row;
    const outputs = rows.filter(item => item.outputPath);
    q('ResultChoice').hidden = outputs.length <= 1;
    q('ResultSelect').replaceChildren(...outputs.map(item => {
      const option = doc.createElement('option');
      option.value = item.path;
      option.textContent = wordName(item.outputPath);
      return option;
    }));
    q('ResultSelect').value = row.path;
    resultDetails();
    successModal.open();
  }
  function add(paths) {
    if (operation || transferring || !visible()) return;
    try { rows = addWordFiles(rows, paths); setStatus('ready'); render(); }
    catch (error) { setStatus('failure', { error: errorText(error) }); }
  }
  async function choose() {
    const owner = session;
    if (!owner || operation || transferring) return;
    if (!isTauri) { setStatus('desktopOnly'); return; }
    try {
      const paths = chooseWordFiles ? await chooseWordFiles() : await (await loadTauriDialog()).open({ multiple: true, filters: [{ name: 'Word', extensions: ['doc', 'docx'] }] });
      if (current(owner)) add(Array.isArray(paths) ? paths : typeof paths === 'string' ? [paths] : []);
    } catch { if (current(owner)) setStatus('chooseFailed'); }
  }
  async function cancel() {
    const active = operation;
    if (!active) return;
    active.cancelled = true;
    q('Cancel').disabled = true;
    q('ProgressText').textContent = tr('cancelling');
    if (active.started) await invoke('cancel_word_to_pdf', { jobId: active.id }).catch(() => {});
  }
  async function convert(retry = false) {
    if (operation || transferring || !visible()) return;
    if (!isTauri) { setStatus('desktopOnly'); return; }
    const queue = rows;
    const files = queue.filter(row => retry ? ['failed', 'cancelled'].includes(row.status) : row.status === 'pending');
    if (!files.length) return;
    const owner = session;
    const active = { id: crypto.randomUUID(), cancelled: false, started: false };
    operation = active;
    render();
    q('Cancel').disabled = false;
    q('ProgressText').textContent = tr('preparing');
    q('ProgressBar').style.width = '0%';
    // Show feedback before any native dependency, directory or listener awaits.
    processModal.open();
    let unlisten, completed = null;
    const live = () => current(owner) && !active.cancelled;
    try {
      if (checkLibreOfficeAvailable || ensureLibreOfficeAvailable) {
        const ready = checkLibreOfficeAvailable ? await checkLibreOfficeAvailable() : await ensureLibreOfficeAvailable();
        if (!live()) return;
        if (!ready) {
          processModal.close();
          setStatus('failure', { error: tr('errors.runtime-missing') });
          requestLibreOfficeRuntime?.(() => {});
          return;
        }
      }
      const outputDir = await getOutputDir();
      if (!live()) return;
      unlisten = await listen('word-to-pdf-progress', event => {
        const p = event.payload;
        if (p?.jobId !== active.id || operation !== active) return;
        if (active.cancelled) void invoke('cancel_word_to_pdf', { jobId: active.id }).catch(() => {});
        if (p.phase === 'done') applyWordResult(queue, p.file);
        if (current(owner)) {
          q('ProgressBar').style.width = `${Math.round(((p.index + (p.phase === 'done' ? 1 : 0)) / files.length) * 100)}%`;
          q('ProgressText').textContent = active.cancelled ? tr('cancelling') : tr('progress', { current: p.index + 1, total: files.length });
        }
      });
      if (!live()) return;
      files.forEach(row => { row.status = 'converting'; row.error = null; });
      q('ProgressText').textContent = tr('progress', { current: 1, total: files.length });
      active.started = true;
      const result = await invoke('convert_word_to_pdf', { inputPaths: files.map(row => row.path), outputDir, jobId: active.id });
      for (const file of result.files || []) applyWordResult(queue, file);
      if (current(owner)) {
        const success = files.filter(row => row.status === 'success').length;
        setStatus(result.cancelled ? 'cancelSummary' : 'summary', { success, failed: files.length - success });
        // Partial batches stay in the queue so retry cannot discard successful files.
        if (!result.cancelled && queue.every(row => row.status === 'success')) completed = queue[0];
      }
    } catch (error) {
      for (const row of files) if (['pending', 'converting'].includes(row.status)) {
        row.status = active.cancelled ? 'cancelled' : 'failed';
        row.error = `word-render:${active.cancelled ? 'cancelled' : wordErrorCode(error)}`;
      }
      if (current(owner)) setStatus('failure', { error: errorText(error) });
    } finally {
      unlisten?.();
      if (operation === active) operation = null;
      if (current(owner)) {
        processModal.close({ restore: false });
        render();
        if (completed) showResult(completed);
        else (!q('Retry').hidden ? q('Retry') : q('Pick')).focus({ preventScroll: true });
      } else if (visible()) render();
    }
  }
  async function revealResult() {
    if (!successTarget?.outputPath) return;
    const owner = session;
    try { await invoke('open_path', { path: successTarget.outputPath }); }
    catch { if (current(owner)) q('ResultStatus').textContent = tr('openFailed'); }
  }
  async function importResult() {
    if (!successTarget?.outputPath || transferring || operation) return;
    const file = { path: successTarget.outputPath, name: wordName(successTarget.outputPath), size: successTarget.outputBytes };
    transferring = true;
    q('SuccessEditor').disabled = true;
    successModal.close({ restore: false });
    close();
    try {
      const instance = await openLazyTool?.('pdf-editor');
      if (!instance?.raw?.openWithFile) throw new Error('editor-unavailable');
      const opened = await instance.raw.openWithFile(file);
      if (opened === false) showToast(tr('editorFailed'));
    } catch { showToast(tr('editorFailed')); }
    finally { transferring = false; q('SuccessEditor').disabled = false; if (visible()) render(); }
  }
  lifetime.event(overlay, 'click', event => {
    const result = event.target.closest('[data-word-result]');
    if (result) showResult(rows.find(row => row.path === result.dataset.wordResult));
    const remove = event.target.closest('[data-word-remove]');
    if (remove && !operation && !transferring) { rows = rows.filter(row => row.path !== remove.dataset.wordRemove); render(); }
    if (event.target.closest('[data-word-pdf-close]')) close();
  });
  lifetime.event(q('Pick'), 'click', () => void choose());
  lifetime.event(q('Clear'), 'click', reset);
  lifetime.event(q('Convert'), 'click', () => void convert());
  lifetime.event(q('Retry'), 'click', () => void convert(true));
  lifetime.event(q('Cancel'), 'click', () => void cancel());
  lifetime.event(q('Done'), 'click', reset);
  lifetime.event(q('SuccessFolder'), 'click', () => void revealResult());
  lifetime.event(q('SuccessEditor'), 'click', () => void importResult());
  lifetime.event(q('ResultSelect'), 'change', () => { successTarget = rows.find(row => row.path === q('ResultSelect').value); resultDetails(); });
  lifetime.use(onLangChange(() => { applyTranslations(); render(); resultDetails(); }));
  async function open() {
    if (disposed || visible()) return;
    returnFocus = doc.activeElement;
    session = createLifecycleScope();
    const owner = session;
    overlay.classList.add('visible');
    setModalInteractivity(overlay, true);
    applyTranslations();
    render();
    q('Pick').focus({ preventScroll: true });
    // Discovery is read-only and cached by the runtime; never start conversion here.
    if (isTauri && checkLibreOfficeAvailable) void checkLibreOfficeAvailable().catch(() => {});
    if (isTauri && !nativeInvoke) {
      try {
        const view = (await loadTauriWebview()).getCurrentWebview();
        const release = await view.onDragDropEvent(event => { if (event.payload.type === 'drop' && current(owner)) add(event.payload.paths || []); });
        owner.use(release);
      } catch { if (current(owner)) setStatus('dropUnavailable'); }
    }
  }
  function close() {
    if (!session) return;
    void cancel();
    session.dispose();
    session = null;
    processModal.close({ restore: false });
    successModal.close({ restore: false });
    rows = [];
    clearResult();
    setStatus('');
    q('Files').replaceChildren();
    moveFocusOutOfHiddenRegion(overlay);
    overlay.classList.remove('visible');
    setModalInteractivity(overlay, false);
    if (returnFocus?.isConnected && !returnFocus.closest('[inert], [aria-hidden="true"]')) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }
  return { open, close, dispose() { close(); disposed = true; lifetime.dispose(); }, get busy() { return Boolean(operation || transferring); } };
}
