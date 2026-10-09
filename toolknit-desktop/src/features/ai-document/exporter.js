import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { cloneAiDocLayout } from '../../ai-doc-core.js';
import { buildAiDocPdf } from '../../ai-doc-pdf-core.js';
import { t } from '../../i18n.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';

function encodeBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function createAiDocumentExporter({
  isTauri = false,
  isEditorDemo = false,
  getLayout,
  getOutputDir,
  displayFilesystemPath = value => String(value || ''),
  showMask = () => {},
  hideMask = () => {},
  reportError = () => {}
} = {}) {
  const lifecycle = createLifecycleScope();
  const successOverlay = document.getElementById('aiDocSuccessOverlay');
  const successPath = document.getElementById('aiDocSuccessPath');
  const openFolderButton = document.getElementById('aiDocSuccessOpenFolder');
  const okButton = document.getElementById('aiDocSuccessOk');
  let session = null;
  let fontRegularBytes = null;
  let fontBoldBytes = null;
  let lastExportPath = '';
  let runId = 0;
  let exporting = false;

  const bind = (target, type, listener, options) => target
    && lifecycle.event(target, type, listener, options);
  const current = (owner, id) => owner === session && !owner?.disposed && id === runId;

  async function loadFonts() {
    if (fontRegularBytes && fontBoldBytes) return;
    try {
      const [regularResponse, boldResponse] = await Promise.all([
        fetch('/assets/fonts/NotoSansSC-Regular.ttf'),
        fetch('/assets/fonts/NotoSansSC-Semibold.ttf')
      ]);
      if (!regularResponse.ok || !boldResponse.ok) throw new Error('font fetch failed');
      const [regular, bold] = await Promise.all([regularResponse.arrayBuffer(), boldResponse.arrayBuffer()]);
      if (new Uint8Array(regular, 0, 1)[0] === 0x3C || new Uint8Array(bold, 0, 1)[0] === 0x3C) {
        throw new Error('font fetch returned HTML');
      }
      fontRegularBytes = regular;
      fontBoldBytes = bold;
    } catch (error) {
      console.error('[AI Doc] Failed to load font:', error);
      fontRegularBytes = null;
      fontBoldBytes = null;
    }
  }

  function writeDemoBridge(bytes) {
    if (!isEditorDemo) return;
    let bridge = document.getElementById('aiDocEditorDemoPdf');
    if (!bridge) {
      bridge = document.createElement('textarea');
      bridge.id = 'aiDocEditorDemoPdf';
      bridge.hidden = true;
      document.body.appendChild(bridge);
    }
    bridge.value = encodeBase64(bytes);
    bridge.dataset.byteLength = String(bytes.length);
  }

  function showSuccess(path) {
    lastExportPath = path;
    if (successPath) successPath.textContent = displayFilesystemPath(path);
    successOverlay?.classList.add('visible');
  }

  async function exportPdf() {
    const source = getLayout?.();
    if (!source?.pages || exporting) return;
    const owner = session;
    if (!owner || owner.disposed) return;
    const id = ++runId;
    exporting = true;
    showMask(t('home.aiDoc.exporting'));
    try {
      const layout = cloneAiDocLayout(source);
      await loadFonts();
      if (!current(owner, id)) return;
      const { bytes } = await buildAiDocPdf({
        layout,
        fontRegularBytes: fontRegularBytes || undefined,
        fontBoldBytes: fontBoldBytes || undefined,
        footerText: (page, total) => t('home.aiDoc.pageOfTotal', { current: page, total }),
        imagePlaceholder: t('home.aiDoc.imgPlaceholder')
      });
      if (!current(owner, id)) return;
      writeDemoBridge(bytes);
      if (isTauri) {
        const outputDirectory = await getOutputDir('AI_Doc');
        if (!current(owner, id)) return;
        const { invoke } = await tauriCorePromise;
        const outputPath = await invoke('write_unique_file_bytes', {
          directory: outputDirectory,
          fileName: `ai_doc_${Date.now()}.pdf`,
          bytes: Array.from(bytes)
        });
        if (current(owner, id)) showSuccess(outputPath);
      } else {
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const link = document.createElement('a');
        if (typeof URL.createObjectURL === 'function') {
          const url = URL.createObjectURL(blob);
          const revoke = () => URL.revokeObjectURL(url);
          owner.use(revoke);
          link.href = url;
          link.download = `ai_doc_${Date.now()}.pdf`;
          link.click();
          owner.timeout(revoke, 0);
        } else {
          link.href = `data:application/pdf;base64,${encodeBase64(bytes)}`;
          link.download = `ai_doc_${Date.now()}.pdf`;
          link.click();
        }
      }
    } catch (error) {
      if (current(owner, id)) {
        console.error('[AI Doc] Export error:', error);
        reportError(t('home.aiDoc.exportError'));
      }
    } finally {
      if (current(owner, id)) {
        exporting = false;
        hideMask();
      }
    }
  }

  function open() {
    session?.dispose();
    session = createLifecycleScope();
    exporting = false;
    runId += 1;
  }

  function close() {
    runId += 1;
    exporting = false;
    session?.dispose();
    session = null;
    hideMask();
    successOverlay?.classList.remove('visible');
  }

  bind(okButton, 'click', () => successOverlay?.classList.remove('visible'));
  bind(openFolderButton, 'click', async () => {
    if (!isTauri || !lastExportPath) return;
    try {
      const { invoke } = await tauriCorePromise;
      await invoke('open_path', { path: lastExportPath });
    } catch (error) {
      console.error('[AI Doc] Open folder error:', error);
    }
  });

  return {
    close,
    dispose() {
      close();
      lifecycle.dispose();
      document.getElementById('aiDocEditorDemoPdf')?.remove();
      fontRegularBytes = null;
      fontBoldBytes = null;
    },
    exportPdf,
    open
  };
}
