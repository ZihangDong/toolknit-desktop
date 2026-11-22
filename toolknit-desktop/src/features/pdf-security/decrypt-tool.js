import { applyTranslations, onLangChange } from '../../i18n.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { taskCenter } from '../../app/task-center.js';
import { createPdfSecurityShell } from './shell.js';
import { addDecryptFiles, prepareDecryptJobs, runDecryptBatch, clearDecryptJobs, decryptFileKey } from './decrypt-batch.js';
import { createDecryptBatchView, decryptText as tr, decryptErrorText } from './decrypt-batch-view.js';
import './pdf-security.css';

export function initPdfDecryptTool({
  overlay, isTauri = false, getOutputDir, displayFilesystemPath, notify, refreshIcons,
  initStandardToolPlasma, disposeStandardToolPlasma, openLazyTool,
  invokeNative, center = taskCenter
} = {}) {
  if (typeof getOutputDir !== 'function') throw new Error('pdf-decrypt:missing-output-directory');
  const scope = createLifecycleScope();
  const invoke = async (command, args) => (invokeNative || (await tauriCorePromise).invoke)(command, args);
  let rows = [], operation = null, requestedIds = [], notice = null, disposed = false;
  const shell = createPdfSecurityShell({
    kind: 'decrypt', overlay, isTauri, displayFilesystemPath, notify, refreshIcons,
    initStandardToolPlasma, disposeStandardToolPlasma,
    isBusy: () => Boolean(operation), allowBrowserDrop: true, multiple: true
  });
  const view = createDecryptBatchView({
    overlay, getRows: () => rows, getOperation: () => operation, getNotice: () => notice,
    onRemove: id => { if (!operation) { const removed = rows.find(row => row.id === id); if (removed) removed.password = ''; rows = rows.filter(row => row.id !== id); notice = null; render(); } },
    onRetry: requestRun, onCancel: cancel,
    onClear: () => { if (!operation) { clearFiles(); render(); } },
    onReveal: reveal, refreshIcons
  });
  const isDemo = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get('pdf-security-demo') === 'decrypt';
  const visible = () => !disposed && shell.isOpenSession(shell.getSession());
  function render() { if (visible()) shell.renderFiles(); }
  function clearFiles() {
    for (const row of rows) row.password = '';
    rows = []; requestedIds = []; notice = null;
  }
  function add(files) {
    try { rows = addDecryptFiles(rows, files); notice = null; return true; }
    catch (error) { shell.showToast(decryptErrorText(String(error.message).split(':')[1])); return false; }
  }
  function requestRun(ids = rows.filter(row => row.status === 'pending').map(row => row.id)) {
    if (!visible() || operation) return;
    const selected = new Set(ids);
    requestedIds = rows.filter(row => selected.has(row.id) && row.status !== 'succeeded').map(row => row.id);
    if (requestedIds.length) shell.showPassword();
  }
  function cancel() {
    if (!operation) return;
    operation.controller.abort();
    notice = { key: 'stoppingHint' }; render();
  }
  async function reveal(id) {
    const path = rows.find(row => row.id === id)?.outputPath;
    if (!path || !isTauri) return;
    try { await invoke('open_path', { path }); }
    catch { shell.showToast(tr('openFailed')); }
  }
  async function retryFromHistory(files) {
    if (disposed || operation || !files.length) return;
    try {
      if (openLazyTool && !await openLazyTool('pdf-decrypt')) return;
      if (!visible()) shell.open();
    } catch { shell.showToast(tr('retryOpenFailed')); return; }
    if (!visible() || !add(files)) return;
    const keys = new Set(files.map(decryptFileKey));
    render();
    requestRun(rows.filter(row => keys.has(decryptFileKey(row.file)) && row.status !== 'succeeded').map(row => row.id));
  }
  async function confirm(owner) {
    if (operation || !shell.isOpenSession(owner) || disposed) return;
    if (!isTauri) { shell.showToast(tr('desktopOnly')); return; }
    let jobs, password = shell.getPassword();
    try { jobs = prepareDecryptJobs(rows, requestedIds, password); }
    catch (error) { shell.showToast(decryptErrorText(String(error.message).split(':')[1])); return; }
    finally { password = ''; }
    if (!jobs.length) { shell.hidePassword(); return; }
    const active = { controller: new AbortController(), total: jobs.length, done: 0 };
    operation = active;
    for (const row of rows) row.password = '';
    shell.hidePassword();
    let retryFiles = [];
    const task = center.begin({ label: tr('batchTask', { count: jobs.length }), tool: 'pdf-decrypt',
      cancel, retry: () => retryFromHistory(retryFiles) });
    notice = { key: 'batchProgress', params: { current: 0, total: jobs.length, name: '' } };
    render();
    try {
      const results = await runDecryptBatch(jobs, {
        signal: active.controller.signal,
        prepare: async () => {
          const directory = await getOutputDir('PDF_Decrypt');
          if (typeof directory !== 'string' || !directory) throw new Error('pdf-decrypt:output-path');
          return directory;
        },
        sizeOf: async file => {
          if (!file.path) throw new Error('pdf-decrypt:invalid-pdf');
          return Number(await invoke('get_file_size', { path: file.path }));
        },
        decrypt: (file, password, outputDir) => invoke('decrypt_pdf', { inputPath: file.path, password, outputDir }),
        onUpdate: (result, done, total) => {
          const row = rows.find(row => row.id === result.id);
          if (row) Object.assign(row, { status: result.status, error: result.error, outputPath: result.outputPath });
          active.done = done;
          const params = { current: Math.min(done + (result.status === 'running' ? 1 : 0), total), total, name: row?.file.name || '' };
          task.progress(done / total * 100, tr('batchProgress', params));
          if (!active.controller.signal.aborted) notice = { key: 'batchProgress', params };
          render();
        }
      });
      const outputs = results.filter(row => row.status === 'succeeded').map(row => row.outputPath);
      const failed = results.filter(row => row.status === 'failed').length;
      const cancelled = results.filter(row => row.status === 'cancelled').length;
      const ids = new Set(results.filter(row => row.status !== 'succeeded').map(row => row.id));
      // Retry actions retain only source metadata, never rows, jobs or credentials.
      retryFiles = rows.filter(row => ids.has(row.id)).map(row => ({ name: row.file.name, path: row.file.path, size: row.file.size || 0 }));
      const params = { success: outputs.length, failed, cancelled };
      notice = { key: 'batchSummary', params };
      const message = tr('batchSummary', params);
      if (failed || cancelled) task.fail(Object.assign(new Error(message), cancelled ? { name: 'AbortError' } : {}), { outputs });
      else task.finish({ outputs, message });
    } catch {
      const selected = new Set(jobs.map(job => job.id));
      const selectedRows = rows.filter(row => selected.has(row.id));
      for (const row of selectedRows) if (row.status !== 'succeeded') {
        row.status = active.controller.signal.aborted ? 'cancelled' : 'failed';
        row.error = active.controller.signal.aborted ? '' : 'decryption-failed';
      }
      retryFiles = selectedRows.filter(row => row.status !== 'succeeded').map(row => ({ name: row.file.name, path: row.file.path, size: row.file.size || 0 }));
      const outputs = selectedRows.filter(row => row.outputPath).map(row => row.outputPath);
      task.fail(new Error(tr('decryptFailed')), { outputs });
      notice = { key: 'decryptFailed', error: true };
    } finally {
      clearDecryptJobs(jobs);
      if (operation === active) operation = null;
      render();
    }
  }
  shell.setActions({
    selectFiles: add, getFiles: () => rows.map(row => row.file), renderFiles: view.render,
    clearFiles, requestProcess: () => requestRun(), confirm,
    afterOpen(owner) {
      if (isDemo && !rows.length) shell.setFileList([{ name: 'toolknit-pdf-decrypt-demo.pdf', size: 64 }], owner);
    }
  });
  applyTranslations();
  scope.use(onLangChange(render));
  scope.event(window, 'beforeunload', () => { void dispose(); }, { once: true });
  async function dispose() {
    if (disposed) return;
    disposed = true;
    operation?.controller.abort();
    await shell.dispose();
    view.dispose(); scope.dispose();
  }
  return { open: shell.open, close: shell.close, dispose };
}
