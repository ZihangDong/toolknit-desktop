import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createPdfRotateExportJob } from './export-runtime.js';
import { createModalSession } from '../../app/modal-runtime.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import { t } from '../../i18n.js';

function outputParent(path) {
  return String(path || '').replace(/[/\\][^/\\]+$/, '').replace(/\//g, '\\');
}

export function createPdfRotateExporter({
  isTauri = false,
  preview,
  workspace,
  processMask,
  setProgress,
  successOverlay,
  successPath,
  successMeta,
  successCount,
  successOpenFolder,
  successOk,
  getOutputDir,
  displayFilesystemPath,
  formatError = error => String(error?.message || error),
  showError = message => window.alert(message)
} = {}) {
  const lifecycle = createLifecycleScope();
  const objectUrls = new Map();
  let session = null;
  let revision = 0;
  let activeId = 0;
  let saving = false;
  let lastSavedPath = '';
  let activeJob = null;
  const successModal = createModalSession({ root: successOverlay, background: workspace,
    initialFocus: successOk, onClose: () => successModal.close() });
  const processModal = createModalSession({ root: processMask, background: workspace,
    initialFocus: processMask?.querySelector('[data-rotate-cancel]'), onClose: () => cancel() });

  function revokeObjectUrl(url) {
    const timer = objectUrls.get(url);
    if (timer) window.clearTimeout(timer);
    objectUrls.delete(url);
    URL.revokeObjectURL(url);
  }

  lifecycle.use(() => {
    for (const url of objectUrls.keys()) revokeObjectUrl(url);
  });

  function current(owner, id) {
    return owner && owner === session && !owner.disposed && id === activeId && id === revision;
  }

  function assertCurrent(owner, id) {
    if (!current(owner, id)) throw new Error('PDF rotate export cancelled');
  }

  function setSaving(value, owner = session) {
    saving = value;
    if (owner === session && !owner?.disposed) preview.setSaving(value);
  }

  async function saveBytes(bytes, fileName, owner, id) {
    assertCurrent(owner, id);
    if (isTauri) {
      const { invoke } = await tauriCorePromise;
      const directory = await getOutputDir('PDF_Rotate');
      assertCurrent(owner, id);
      return invoke('write_unique_file_bytes', {
        directory,
        fileName,
        bytes: Array.from(bytes)
      });
    }

    const blob = new Blob([bytes], { type: fileName.endsWith('.zip') ? 'application/zip' : 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    const timer = window.setTimeout(() => revokeObjectUrl(url), 1000);
    objectUrls.set(url, timer);
    return `~/Downloads/${fileName}`;
  }

  function showSuccess(path, type, count, owner, id) {
    if (!current(owner, id)) return;
    lastSavedPath = path;
    if (successCount) successCount.textContent = String(count);
    if (successPath) successPath.textContent = displayFilesystemPath(path);
    if (successMeta) {
      successMeta.textContent = t(type === 'zip' ? 'home.pdfRotate.successZipMeta'
        : type === 'all' ? 'home.pdfSplit.exportPdfMeta' : 'home.pdfRotate.successSingleMeta', { count });
    }
    successModal.open();
  }

  function report(error, owner, id) {
    if (!current(owner, id) || /cancelled/i.test(String(error?.message || error))) return;
    console.error('[PDF Rotate] export error:', error);
    showError(t('common.errorOccurred', { error: formatError(error) }));
  }

  async function runExport(work) {
    if (saving || !session || session.disposed) return;
    const owner = session;
    const id = ++revision;
    activeId = id;
    setSaving(true, owner);
    processModal.open();
    try {
      await work(owner, id);
    } catch (error) {
      report(error, owner, id);
    } finally {
      const ownsUi = current(owner, id);
      if (id === activeId) {
        saving = false;
        activeId = 0;
      }
      if (ownsUi) {
        processModal.close();
        setProgress(0);
        preview.setSaving(false);
      }
    }
  }

  async function download({ index = null, selectedOnly = false, mode }) {
    const state = preview.getExportState({ index, selectedOnly });
    if (!state?.fileData || !state.pages.length) return;
    await runExport(async (owner, id) => {
      setProgress(5, t('home.pdfRotate.saving'));
      const job = createPdfRotateExportJob({ ...state, mode,
        onProgress: percent => { if (current(owner, id)) setProgress(Math.round(percent), t('home.pdfRotate.saving')); }
      });
      activeJob = job;
      const release = owner.use(() => job.cancel());
      let output;
      try { output = await job.promise; }
      finally { release(); if (activeJob === job) activeJob = null; }
      assertCurrent(owner, id);
      const path = await saveBytes(output.bytes, output.fileName, owner, id);
      assertCurrent(owner, id);
      processModal.close();
      showSuccess(path, mode, output.pageCount, owner, id);
    });
  }

  lifecycle.event(successOk, 'click', () => successModal.close());
  lifecycle.event(successOpenFolder, 'click', async () => {
    if (!isTauri || !lastSavedPath) return;
    try {
      const { invoke } = await tauriCorePromise;
      await invoke('open_path', { path: lastSavedPath });
    } catch (error) {
      console.error('[PDF Rotate] Open folder error:', error);
    }
  });

  function cancel() {
    revision += 1;
    activeJob?.cancel(); activeJob = null;
    activeId = 0; saving = false;
    preview.setSaving(false);
    processModal.close();
    setProgress(0);
  }

  function close() {
    cancel();
    session?.dispose();
    session = null;
    successModal.close({ restore: false });
    for (const url of objectUrls.keys()) revokeObjectUrl(url);
    setProgress(0);
    lastSavedPath = '';
  }

  return {
    cancel,
    close,
    dispose() {
      close();
      lifecycle.dispose();
    },
    downloadAll: () => download({ selectedOnly: true, mode: 'all' }),
    downloadSingle: index => download({ index, mode: 'single' }),
    downloadZip: () => download({ selectedOnly: true, mode: 'zip' }),
    open() {
      session?.dispose();
      session = createLifecycleScope();
      successOverlay?.classList.remove('visible');
      lastSavedPath = '';
      if (!saving) preview.setSaving(false);
    },
    get busy() { return saving; }
  };
}
