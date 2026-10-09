import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession, setModalInteractivity } from '../../app/modal-runtime.js';
import { mergePdfPages } from '../../pdf-merge-core.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import { t } from '../../i18n.js';

function outputParent(path) {
  return String(path || '').replace(/[/\\][^/\\]+$/, '').replace(/\//g, '\\');
}

export function createPdfMergeExporter({
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
  getInputCount = () => 0,
  onSuccess = () => {},
  onFailure = () => {},
  onAcknowledge = () => {},
  showError = message => window.alert(message)
} = {}) {
  const lifecycle = createLifecycleScope();
  const objectUrls = new Map();
  let session = null;
  let revision = 0;
  let activeId = 0;
  let committing = false;
  let lastOutputPath = '';

  const successModal = createModalSession({
    root: successOverlay,
    background: workspace,
    initialFocus: successOk,
    onClose: () => successModal.close()
  });
  const processModal = createModalSession({
    root: processMask,
    background: workspace,
    initialFocus: processMask?.querySelector('#pdfMergeProcessCancel'),
    onClose: () => cancel()
  });

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
    if (!current(owner, id)) throw new Error('PDF merge export cancelled');
  }

  function setSaving(value, owner = session) {
    committing = value;
    if (owner === session && !owner?.disposed) preview.setSaving(value);
  }

  function setProgressSafe(percent, message) {
    setProgress?.(percent, message);
  }

  async function saveBytes(bytes, owner, id) {
    assertCurrent(owner, id);
    if (isTauri) {
      const { invoke } = await tauriCorePromise;
      const directory = await getOutputDir('PDF_Merge');
      assertCurrent(owner, id);
      const path = await invoke('write_unique_file_bytes', {
        directory,
        fileName: 'merged.pdf',
        bytes: Array.from(bytes)
      });
      assertCurrent(owner, id);
      return path;
    }

    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'merged.pdf';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    const timer = window.setTimeout(() => revokeObjectUrl(url), 1000);
    objectUrls.set(url, timer);
    return '~/Downloads/merged.pdf';
  }

  function showSuccess(path, owner, id) {
    if (!current(owner, id)) return;
    const count = getInputCount();
    lastOutputPath = path;
    if (successMeta) successMeta.textContent = t('home.pdfMerge.successSummary', { count });
    if (successCount) successCount.textContent = String(count) + ' ' + t('home.pdfMerge.successCountUnit');
    if (successPath) successPath.textContent = displayFilesystemPath(path);
    successModal.open();
  }

  async function commit() {
    if (committing || !session || session.disposed) return;
    const state = preview.getExportState();
    if (!state.documents.length || !state.pages.length) return;

    const owner = session;
    const id = ++revision;
    activeId = id;
    setSaving(true, owner);
    preview.hideForCommit();
    processModal.open();
    setProgressSafe(5, t('home.pdfMerge.processing'));

    try {
      const bytes = await mergePdfPages(state);
      assertCurrent(owner, id);
      setProgressSafe(85, t('home.pdfMerge.processing'));
      const path = await saveBytes(bytes, owner, id);
      assertCurrent(owner, id);
      setProgressSafe(100, t('home.pdfMerge.processing'));
      preview.releaseResources();
      processModal.close();
      onSuccess();
      showSuccess(path, owner, id);
    } catch (error) {
      if (!current(owner, id) || /cancelled/i.test(String(error?.message || error))) return;
      console.error('[PDF Merge] export error:', error);
      const restored = preview.restoreAfterError();
      onFailure({ restored });
      showError(t('common.errorOccurred', { error: String(error?.message || error) }));
    } finally {
      const ownsUi = current(owner, id);
      if (id === activeId) {
        committing = false;
        activeId = 0;
      }
      if (ownsUi) {
        processModal.close();
        setProgressSafe(0);
        preview.setSaving(false);
      }
    }
  }

  lifecycle.event(successOk, 'click', () => {
    successModal.close();
    onAcknowledge();
  });
  lifecycle.event(successOpenFolder, 'click', async () => {
    if (!isTauri || !lastOutputPath) return;
    try {
      const { invoke } = await tauriCorePromise;
      await invoke('open_path', { path: lastOutputPath });
    } catch (error) {
      console.error('[PDF Merge] Open folder error:', error);
    }
  });

  function cancel() {
    revision += 1;
    activeId = 0;
    committing = false;
    preview.setSaving(false);
    processModal.close();
    setProgressSafe(0);
  }

  function close() {
    cancel();
    session?.dispose();
    session = null;
    successModal.close({ restore: false });
    processModal.close({ restore: false });
    setModalInteractivity(successOverlay, false);
    for (const url of objectUrls.keys()) revokeObjectUrl(url);
    lastOutputPath = '';
  }

  return {
    cancel,
    close,
    commit,
    dispose() {
      close();
      lifecycle.dispose();
    },
    open() {
      session?.dispose();
      session = createLifecycleScope();
      successModal.close({ restore: false });
      processModal.close({ restore: false });
      lastOutputPath = '';
      if (!committing) preview.setSaving(false);
    },
    get busy() { return committing; }
  };
}
