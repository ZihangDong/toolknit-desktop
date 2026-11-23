import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession, setModalInteractivity } from '../../app/modal-runtime.js';
import { moveFocusOutOfHiddenRegion } from '../../shared/tool-page-shell.js';
import { loadTauriDialog, loadTauriWebview, tauriCorePromise, tauriEventPromise } from '../../platform/tauri-runtime.js';
import { applyTranslations, onLangChange, t } from '../../i18n.js';
import { addWordFiles, addWordArchive, applyWordResult, wordErrorCode, wordName } from './core.js';
import { createWordWatermarkView } from './watermark-view.js';
import { createWordEncryptionView } from './encryption-view.js';
import { sanitizeWordHistory } from '../../app/word-conversion-history.js';

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
  let operation = null, disposed = false, message = null, transferring = false, importing = null;
  let history = null;
  const visible = () => session && !session.disposed && !disposed;
  const current = owner => visible() && owner === session;
  const errorText = error => tr(`errors.${wordErrorCode(error)}`);
  const watermarkView = createWordWatermarkView({ q, lifetime, tr, errorText });
  const encryptionView = createWordEncryptionView({ q, lifetime });
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
    for (const id of ['SuccessName', 'SuccessMeta', 'SuccessPath', 'ResultStatus', 'SuccessFonts']) {
      q(id).textContent = '';
      q(id).removeAttribute('title');
    }
    q('ResultSelect').replaceChildren();
    q('SuccessFonts').hidden = true;
  }
  function reset() {
    if (operation || transferring || importing) return;
    successModal.close({ restore: false });
    rows = [];
    history = null;
    q('RefreshFields').checked = false;
    watermarkView.reset();
    encryptionView.reset();
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
  function fontNoticeText(notice) {
    if (['font-check-unavailable', 'font-check-incomplete'].includes(notice.code)) return tr('fonts.checkUnavailable');
    if (notice.code === 'font-replacement-failed') return tr('fonts.replacementFailed', { font: notice.font });
    const reason = tr(notice.code === 'embedding-restricted' ? 'fonts.restricted' : 'fonts.missing');
    return tr(notice.replacement ? 'fonts.replaced' : 'fonts.unresolved', { font: notice.font, replacement: notice.replacement, reason });
  }
  function renderFontNotices(target, row) {
    const fieldNotes = [];
    if (row?.fieldUpdate?.enabled) {
      const note = doc.createElement('p');
      note.className = 'word-pdf-field-summary';
      note.textContent = tr('fieldSummary', { indexes: row.fieldUpdate.indexes, fields: row.fieldUpdate.fields,
        skipped: row.fieldUpdate.skippedFields + row.fieldUpdate.skippedIndexes });
      fieldNotes.push(note);
    }
    if (row?.watermarkPages) {
      const note = doc.createElement('p'); note.textContent = tr('watermark.summary', { count: row.watermarkPages }); fieldNotes.push(note);
    }
    if (row?.encrypted) { const note = doc.createElement('p'); note.textContent = tr('encryption.summary'); fieldNotes.push(note); }
    target.replaceChildren(...fieldNotes, ...(row?.fontNotices || []).map(notice => {
      const text = doc.createElement('p');
      text.textContent = fontNoticeText(notice);
      return text;
    }));
    target.hidden = !target.children.length;
  }
  function render() {
    const focused = doc.activeElement;
    const focusedPath = focused?.dataset?.wordResult || focused?.dataset?.wordRemove || focused?.dataset?.wordAcceptCurrent;
    q('Empty').hidden = rows.length > 0;
    q('Files').hidden = rows.length === 0;
    q('QueueCount').textContent = rows.length ? String(rows.length) : '';
    for (const id of ['Pick', 'Clear', 'Convert', 'Retry']) q(id).disabled = Boolean(operation || transferring || importing);
    q('RefreshFields').disabled = Boolean(operation || transferring || importing);
    watermarkView.render(Boolean(operation || transferring || importing));
    encryptionView.render(Boolean(operation || transferring || importing));
    q('History').hidden = !history;
    q('HistoryRefresh').disabled = q('HistoryRegenerate').disabled = Boolean(operation || transferring || importing);
    if (history) {
      q('HistoryRequirements').textContent = [history.watermarkRequired ? tr('history.watermarkAgain') : '', history.encryptionRequired ? tr('history.passwordAgain') : ''].filter(Boolean).join(' ');
      q('HistorySummary').textContent = tr('history.summary', { kept: rows.filter(row => row.status === 'success').length,
        pending: rows.filter(row => !['success', 'blocked'].includes(row.status)).length, blocked: rows.filter(row => row.status === 'blocked').length });
    }
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
      if (row.historyIssue) { const note = doc.createElement('small'); note.textContent = tr(`history.issues.${row.historyIssue}`); info.append(note); }
      if (row.origin) {
        const origin = doc.createElement('small');
        origin.className = 'word-pdf-origin'; origin.textContent = row.origin; origin.title = row.origin;
        info.append(origin);
      }
      const notices = doc.createElement('div');
      notices.className = 'word-pdf-font-notices';
      renderFontNotices(notices, row);
      info.append(notices);
      item.append(icon('file-type-2'), info);
      if (row.historySourceState === 'changed' && row.currentSourceHash && !row.archivePath) {
        const accept = doc.createElement('button'); accept.type = 'button'; accept.className = 'word-pdf-button';
        accept.dataset.wordAcceptCurrent = row.path; accept.textContent = tr('history.useCurrent'); accept.disabled = Boolean(operation || transferring || importing); item.append(accept);
      }
      if (row.outputPath) {
        const result = doc.createElement('button');
        result.type = 'button';
        result.className = 'word-pdf-button';
        result.dataset.wordResult = row.path;
        result.textContent = tr('viewResults');
        result.disabled = Boolean(operation || transferring || importing);
        item.append(result);
      }
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'word-pdf-button word-pdf-remove';
      remove.dataset.wordRemove = row.path;
      remove.setAttribute('aria-label', tr('remove'));
      remove.title = tr('remove');
      remove.append(icon('x'));
      remove.disabled = Boolean(operation || transferring || importing);
      item.append(remove);
      fragment.append(item);
    }
    q('Files').replaceChildren(fragment);
    if (focusedPath) {
      const attr = focused.dataset.wordResult ? 'wordResult' : focused.dataset.wordAcceptCurrent ? 'wordAcceptCurrent' : 'wordRemove';
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
    q('SuccessEditor').disabled = Boolean(successTarget.encrypted);
    renderFontNotices(q('SuccessFonts'), successTarget);
  }
  function showResult(row) {
    if (!row?.outputPath || operation || importing || !visible()) return;
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
  async function add(paths) {
    if (operation || transferring || importing || !visible() || !paths.length) return;
    const owner = session, token = {};
    importing = token; render(); setStatus('importing');
    let next = [...rows], failures = 0, lastError = null, skipped = 0;
    try {
      // Each selected source is atomic: a rejected ZIP cannot leave half its rows.
      for (const path of [...new Set(paths)]) {
        if (!current(owner)) return;
        try {
          if (typeof path === 'string' && /\.zip$/i.test(path)) {
            const manifest = await invoke('inspect_word_zip', { path });
            if (!current(owner)) return;
            next = addWordArchive(next, manifest); skipped += Number(manifest.skipped) || 0;
          } else next = addWordFiles(next, [path]);
        } catch (error) { failures++; lastError = error; }
      }
      if (current(owner)) {
        rows = next;
        if (failures) setStatus('importPartial', { failed: failures, error: errorText(lastError) });
        else setStatus(skipped ? 'importSkipped' : 'ready', { count: skipped });
      }
    } finally {
      if (importing === token) importing = null;
      if (current(owner)) render();
    }
  }
  async function choose() {
    const owner = session;
    if (!owner || operation || transferring || importing) return;
    if (!isTauri) { setStatus('desktopOnly'); return; }
    try {
      const paths = chooseWordFiles ? await chooseWordFiles() : await (await loadTauriDialog()).open({ multiple: true, filters: [{ name: 'Word / ZIP', extensions: ['doc', 'docx', 'zip'] }] });
      if (current(owner)) await add(Array.isArray(paths) ? paths : typeof paths === 'string' ? [paths] : []);
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
    if (operation || transferring || importing || !visible()) return;
    if (!isTauri) { setStatus('desktopOnly'); return; }
    const queue = rows;
    const refreshFields = q('RefreshFields').checked;
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
    let unlisten, completed = null, encryption = null;
    const live = () => current(owner) && !active.cancelled;
    try {
      encryption = encryptionView.prepare();
      const watermark = await watermarkView.prepare();
      if (!live()) return;
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
      const completedIndices = new Set();
      unlisten = await listen('word-to-pdf-progress', event => {
        const p = event.payload;
        if (p?.jobId !== active.id || operation !== active) return;
        if (active.cancelled) void invoke('cancel_word_to_pdf', { jobId: active.id }).catch(() => {});
        if (p.phase !== 'done' || !Number.isInteger(p.index) || p.index < 0 || p.index >= files.length) return;
        applyWordResult(queue, p.file);
        completedIndices.add(p.index);
        if (current(owner)) {
          const completedCount = completedIndices.size;
          q('ProgressBar').style.width = `${Math.round(completedCount / files.length * 100)}%`;
          q('ProgressText').textContent = active.cancelled ? tr('cancelling')
            : tr('progress', { current: Math.min(completedCount + 1, files.length), total: files.length });
        }
      });
      if (!live()) return;
      files.forEach(row => { row.status = 'converting'; row.error = null; });
      q('ProgressText').textContent = tr('progress', { current: 1, total: files.length });
      active.started = true;
      const archiveInputs = files.filter(row => row.archivePath).map(row => ({
        archivePath: row.archivePath, entryName: row.archiveEntry, archiveHash: row.archiveHash
      }));
      const expectedHashes = files.filter(row => row.historyChecked && row.sourceHash).map(row => ({ inputPath: row.path, sourceHash: row.sourceHash }));
      const result = await invoke('convert_word_to_pdf', { inputPaths: files.map(row => row.path),
        ...(archiveInputs.length ? { archiveInputs } : {}), ...(expectedHashes.length ? { expectedHashes } : {}), ...(watermark ? { watermark } : {}), ...(encryption ? { encryption } : {}), refreshFields, outputDir, jobId: active.id });
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
      if (encryption) encryption.password = '';
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
    catch { if (current(owner)) q('ResultStatus').textContent = tr(history ? 'history.outputMissing' : 'openFailed'); }
  }
  async function importResult() {
    if (!successTarget?.outputPath || successTarget.encrypted || transferring || operation) return;
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
    if (remove && !operation && !transferring && !importing) { rows = rows.filter(row => row.path !== remove.dataset.wordRemove); render(); }
    const accept = event.target.closest('[data-word-accept-current]');
    if (accept && !operation && !transferring && !importing) {
      const row = rows.find(row => row.path === accept.dataset.wordAcceptCurrent);
      if (row?.currentSourceHash) { row.sourceHash = row.currentSourceHash; row.historySourceState = 'available'; row.status = 'pending'; row.historyIssue = 'current-version'; row.outputPath = null; row.outputHash = null; row.error = null; render(); }
    }
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
  lifetime.event(q('HistoryRefresh'), 'click', () => void refreshHistory());
  lifetime.event(q('HistoryRegenerate'), 'click', () => {
    if (operation || transferring || importing) return;
    for (const row of rows) { row.outputPath = null; row.outputHash = null; row.status = row.historySourceState && row.historySourceState !== 'available' ? 'blocked' : 'pending'; row.error = null; }
    setStatus('history.regenerateReady'); render();
  });
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
  function historySnapshot() {
    return sanitizeWordHistory({ ...history, files: rows.map(row => ({ inputPath: row.path,
      ...(row.archivePath ? { archive: { archivePath: row.archivePath, entryName: row.archiveEntry, archiveHash: row.archiveHash } } : {}),
      sourceHash: row.sourceHash, status: row.status, outputPath: row.outputPath, outputHash: row.outputHash, outputBytes: row.outputBytes,
      pageCount: row.pageCount, encrypted: row.encrypted, watermarkPages: row.watermarkPages })) });
  }
  async function probeHistory(recipe, initial) {
    const owner = session, token = {}; importing = token; render(); setStatus('history.checking');
    try {
      const result = await invoke('inspect_word_history', { items: recipe.files.map(file => ({ inputPath: file.inputPath, archive: file.archive || null,
        sourceHash: file.sourceHash, outputPath: file.outputPath, outputHash: file.outputHash, outputBytes: file.outputBytes })) });
      if (!current(owner)) return false;
      if (!Array.isArray(result) || result.length !== recipe.files.length) throw new Error('word-render:history-failed');
      rows = recipe.files.map((file, index) => {
        const probe = result[index], output = file.status === 'success' && probe.outputState === 'available';
        const source = probe.sourceState === 'available';
        return { path: file.inputPath, name: wordName(file.archive?.entryName || file.inputPath), sourceHash: file.sourceHash || probe.sourceHash,
          ...(file.archive ? { archivePath: file.archive.archivePath, archiveEntry: file.archive.entryName, archiveHash: file.archive.archiveHash,
            origin: `${wordName(file.archive.archivePath)} / ${file.archive.entryName}` } : {}),
          status: output ? 'success' : source ? 'pending' : 'blocked', outputPath: output ? file.outputPath : null,
          outputHash: output ? file.outputHash : null, outputBytes: output ? probe.outputBytes : 0, pageCount: output ? file.pageCount : 0,
          encrypted: output && file.encrypted, watermarkPages: output ? file.watermarkPages : 0, error: null,
          historyChecked: true, historySourceState: probe.sourceState, currentSourceHash: probe.sourceHash,
          historyIssue: !source ? file.archive && probe.sourceState === 'changed' ? 'archive-changed' : probe.sourceState === 'changed' ? 'source-changed' : 'source-missing'
            : !output && file.outputPath ? probe.outputState === 'changed' ? 'output-changed' : 'output-missing' : null };
      });
      history = recipe;
      if (initial) {
        q('RefreshFields').checked = recipe.refreshFields;
        if (recipe.watermarkRequired) watermarkView.restoreRequired();
        if (recipe.encryptionRequired) encryptionView.restore(recipe.permissions);
      }
      setStatus('history.ready', { count: rows.length }); return true;
    } catch (error) { if (current(owner)) setStatus('failure', { error: errorText(error) }); return false; }
    finally { if (importing === token) importing = null; if (current(owner)) render(); }
  }
  async function refreshHistory() {
    if (!history || operation || transferring || importing) return;
    const recipe = historySnapshot(); if (recipe) await probeHistory(recipe, false);
  }
  async function restoreHistory(value) {
    if (!visible() || operation || transferring || importing) return false;
    const recipe = sanitizeWordHistory(value);
    if (!recipe) { setStatus('failure', { error: tr('errors.history-invalid') }); return false; }
    if (rows.length) { setStatus('history.queueBusy'); return false; }
    if (!isTauri) { setStatus('desktopOnly'); return false; }
    return probeHistory(recipe, true);
  }
  function close() {
    if (!session) return;
    void cancel();
    session.dispose();
    session = null;
    importing = null;
    q('RefreshFields').checked = false;
    watermarkView.reset();
    encryptionView.reset();
    processModal.close({ restore: false });
    successModal.close({ restore: false });
    rows = [];
    history = null;
    clearResult();
    setStatus('');
    q('Files').replaceChildren();
    moveFocusOutOfHiddenRegion(overlay);
    overlay.classList.remove('visible');
    setModalInteractivity(overlay, false);
    if (returnFocus?.isConnected && !returnFocus.closest('[inert], [aria-hidden="true"]')) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }
  return { open, close, restoreHistory, dispose() { close(); disposed = true; lifetime.dispose(); }, get busy() { return Boolean(operation || transferring || importing); } };
}
