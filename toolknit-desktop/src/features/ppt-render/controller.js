import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import {
  PPT_RENDER_LIMITS,
  createPptToPdfFileName,
  inspectPptxRenderBytes,
  sanitizePptRenderBaseName
} from '../../ppt-render-core.js';
import { applyTranslations } from '../../i18n.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import {
  bindPptChrome,
  choosePptxFile,
  createOperationGuard,
  dragHasExternalFiles,
  isPptxFile,
  readPptxFile,
  registerNativePptxDrop,
  setInteractiveLayer
} from '../ppt-workflows/shared.js';

function createTextNode(documentRef, tag, className, text) {
  const element = documentRef.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function errorMessage(error, text) {
  const message = String(error?.userMessage || error?.message || error || '');
  if (/runtime-missing|dependency/i.test(message)) return text('runtimeMissing');
  if (/invalid-extension|invalid_extension/i.test(message)) return text('unsupportedFormat');
  if (/input-too-large|input_too_large|too large/i.test(message)) return text('fileTooLarge');
  if (/too-many-slides|too_many_slides/i.test(message)) return text('tooManySlides', { count: PPT_RENDER_LIMITS.maxSlides });
  if (/empty-ppt|empty_ppt/i.test(message)) return text('emptyPpt');
  if (/invalid-pptx|invalid_pptx|invalid-input|read-failed/i.test(message)) return text('invalidPptx');
  if (/busy|another file conversion/i.test(message)) return text('busy');
  if (/cancelled|canceled/i.test(message)) return text('cancelled');
  if (/timeout|timed out|did not respond/i.test(message)) return text('timeout');
  return text('exportFailed', { error: message || 'unknown error' });
}

export function createPptRenderController({
  overlay,
  portal,
  mode = 'pdf',
  isTauri = false,
  t,
  onLangChange,
  notify = () => {},
  formatFileSize = value => String(value || 0),
  displayFilesystemPath = value => String(value || ''),
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = instance => instance,
  getOutputDir = async () => '',
  openOutputFolder = async () => false,
  checkLibreOfficeAvailable = async () => true,
  requestLibreOfficeRuntime = () => {},
  ensureLibreOfficeAvailable = async () => true,
  openLazyTool = async () => null,
  openSettings = () => {},
  openSupport = () => {},
  openExternalUrl = () => {},
  handleWindowAction = () => {},
  refreshIcons = () => {},
  documentRef = globalThis.document
} = {}) {
  if (!overlay || !portal || !documentRef) throw new Error('ppt-render:missing-root');
  const prefix = mode === 'image' ? 'pptToImage' : 'pptToPdf';
  const i18nKey = mode === 'image' ? 'pptToImagePage' : 'pptToPdfPage';
  const byId = suffix => documentRef.getElementById(`${prefix}${suffix}`);
  const background = byId('PlasmaBg');
  const body = byId('Body');
  const workspace = overlay.querySelector('.ppt-render-v2-workspace');
  const dropZone = byId('DropZone');
  const input = byId('FileInput');
  const cta = byId('Cta');
  const fileName = byId('FileName');
  const empty = byId('Empty');
  const results = byId('Results');
  const summary = byId('Summary');
  const stats = byId('Stats');
  const actionButton = byId(mode === 'image' ? 'OpenWorkspaceBtn' : 'ExportBtn');
  const processMask = byId('ProcessMask');
  const processFill = byId('ProcessBarFill');
  const processText = byId('ProcessText');
  const successOverlay = mode === 'pdf' ? byId('SuccessOverlay') : null;
  const successMeta = mode === 'pdf' ? byId('SuccessMeta') : null;
  const successPages = mode === 'pdf' ? byId('SuccessPages') : null;
  const successSize = mode === 'pdf' ? byId('SuccessSize') : null;
  const successPath = mode === 'pdf' ? byId('SuccessPath') : null;
  const successOpenFolder = mode === 'pdf' ? byId('SuccessOpenFolder') : null;
  const successOk = mode === 'pdf' ? byId('SuccessOk') : null;
  const lifecycle = createLifecycleScope({ onError: error => console.error('[PPT Render] dispose error:', error) });
  const guard = createOperationGuard(() => session);
  let session = null;
  let plasma = null;
  let busy = false;
  let selectedFile = null;
  let manifest = null;
  let lastOutputPath = '';
  let openRevision = 0;
  let disposed = false;

  const text = (key, params) => t(`home.${i18nKey}.${key}`, params);
  const isOpen = owner => Boolean(owner && owner === session && !owner.disposed && overlay.classList.contains('visible'));

  function setProgress(percent, message, visible = true) {
    if (processFill) processFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if (processText) processText.textContent = message || text('processing');
    setInteractiveLayer(processMask, visible);
  }

  function summaryText() {
    if (!manifest) return '';
    return text('summary', {
      slides: manifest.slide_count,
      size: formatFileSize(manifest.input_bytes),
      output: createPptToPdfFileName(manifest.base_name || manifest.source_name)
    });
  }

  function renderStats() {
    if (!manifest || !stats || !summary) return;
    const outputFile = createPptToPdfFileName(manifest.base_name || manifest.source_name);
    const items = [
      { label: text('statSource'), value: manifest.source_name || '--', hint: text('statLocal') },
      { label: text('statSlides'), value: String(manifest.slide_count || 0), hint: text('statSlidesHint') },
      { label: text('statInputSize'), value: formatFileSize(manifest.input_bytes || 0), hint: text('statInputHint') },
      { label: text('statOutput'), value: outputFile, hint: text(mode === 'image' ? 'statOutputImageHint' : 'statOutputPdfHint') }
    ];
    stats.replaceChildren();
    for (const item of items) {
      const card = createTextNode(documentRef, 'div', 'ppt-compress-stat', '');
      card.append(
        createTextNode(documentRef, 'span', '', item.label),
        createTextNode(documentRef, 'strong', '', item.value),
        createTextNode(documentRef, 'em', '', item.hint)
      );
      stats.append(card);
    }
    summary.replaceChildren(
      createTextNode(documentRef, 'span', '', summaryText()),
      createTextNode(documentRef, 'strong', '', text(mode === 'image' ? 'readyImage' : 'readyPdf'))
    );
  }

  function setCtaLabel(key) {
    const label = cta?.querySelector('span');
    if (label) label.textContent = text(key);
  }

  function updateControls() {
    if (actionButton) {
      const enabled = Boolean(manifest && selectedFile && !busy);
      actionButton.disabled = !enabled;
      actionButton.hidden = !enabled;
    }
    if (cta) cta.disabled = busy;
  }

  function resetState() {
    guard.cancel();
    busy = false;
    selectedFile = null;
    manifest = null;
    lastOutputPath = '';
    if (input) input.value = '';
    if (fileName) {
      fileName.textContent = '';
      fileName.classList.remove('visible');
    }
    setCtaLabel('cta');
    if (cta) cta.disabled = false;
    if (empty) empty.hidden = false;
    if (results) results.hidden = true;
    summary?.replaceChildren();
    stats?.replaceChildren();
    if (actionButton) {
      actionButton.disabled = true;
      actionButton.hidden = true;
    }
    dropZone?.classList.remove('visible');
    if (body) body.scrollTop = 0;
    if (workspace) workspace.scrollTop = 0;
    setInteractiveLayer(successOverlay, false);
    setProgress(0, text('processing'), false);
  }

  function showOverlay() {
    if (disposed) return;
    session?.dispose();
    session = createLifecycleScope({ onError: error => console.error('[PPT Render] session cleanup:', error) });
    resetState();
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    if (body) body.scrollTop = 0;
    if (background) plasma = initStandardToolPlasma(background);
    if (isTauri) {
      const owner = session;
      void registerNativePptxDrop({
        owner,
        isCurrent: () => isOpen(owner),
        onVisibility: visible => { if (!busy) dropZone?.classList.toggle('visible', visible); },
        onUnsupported: () => notify(text('unsupportedFormat')),
        onDrop: handleFile
      }).catch(error => console.error(`[PPT Render:${mode}] drag registration failed:`, error));
    }
    updateControls();
  }

  async function open() {
    if (disposed) return;
    const revision = ++openRevision;
    if (isTauri) {
      const available = await checkLibreOfficeAvailable().catch(error => {
        console.error('[PPT Render] runtime check failed:', error);
        return false;
      });
      if (disposed || revision !== openRevision) return;
      if (!available) {
        requestLibreOfficeRuntime(() => { void open(); });
        return;
      }
    }
    showOverlay();
  }

  function close() {
    openRevision += 1;
    guard.cancel();
    session?.dispose();
    session = null;
    busy = false;
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    plasma = disposeStandardToolPlasma(plasma);
    resetState();
  }

  function hideProgressSoon(owner) {
    // Release the full-screen hit-test layer as soon as the operation settles;
    // the shared CSS transition still provides the visual fade-out.
    if (isOpen(owner) && !busy) setProgress(0, text('processing'), false);
  }

  async function handleFile(file) {
    if (!file || busy || !isOpen(session)) return;
    if (!isPptxFile(file)) {
      notify(text('unsupportedFormat'));
      return;
    }
    const owner = session;
    const operation = guard.begin();
    if (!operation) return;
    operation.scope = createLifecycleScope();
    operation.signal = operation.scope.abortController().signal;
    busy = true;
    updateControls();
    setProgress(12, text('reading'));
    try {
      const bytes = await readPptxFile(file, {
        isTauri,
        maxBytes: PPT_RENDER_LIMITS.maxInputBytes,
        errorPrefix: 'ppt-render'
      });
      guard.assertCurrent(operation);
      setProgress(46, text('analyzing'));
      const nextManifest = await inspectPptxRenderBytes(bytes, {
        sourceName: file.name || file.path || 'presentation.pptx'
      });
      guard.assertCurrent(operation);
      manifest = nextManifest;
      selectedFile = { ...file, size: bytes.byteLength };
      if (fileName) {
        fileName.textContent = `${file.name || file.path || 'presentation.pptx'} · ${summaryText()}`;
        fileName.classList.add('visible');
      }
      setCtaLabel('replace');
      if (empty) empty.hidden = true;
      if (results) results.hidden = false;
      renderStats();
      refreshIcons();
      setProgress(100, text('analyzing'));
      notify(text('scanDone', { slides: manifest.slide_count, size: formatFileSize(manifest.input_bytes) }));
    } catch (error) {
      if (!guard.isCurrent(operation)) return;
      console.error(`[PPT Render:${mode}] scan failed:`, error);
      setProgress(0, text('processing'), false);
      notify(errorMessage(error, text));
    } finally {
      if (!guard.isCurrent(operation)) return;
      busy = false;
      guard.finish(operation);
      updateControls();
      hideProgressSoon(owner);
    }
  }

  async function convertToPdf(outputCategory, operation) {
    if (!selectedFile || !manifest) throw new Error('ppt-render:invalid-input');
    if (!isTauri || !selectedFile.path) throw new Error('ppt-render:desktop-only');
    await ensureLibreOfficeAvailable();
    guard.assertCurrent(operation);
    const { invoke } = await tauriCorePromise;
    const outputDir = await getOutputDir(outputCategory);
    guard.assertCurrent(operation);
    const baseName = sanitizePptRenderBaseName(manifest.base_name || selectedFile.name || selectedFile.path || 'presentation.pptx');
    const result = await invoke('convert_ppt_to_pdf', {
      inputPath: selectedFile.path,
      outputDir,
      outputName: baseName,
      temporary: mode === 'image'
    });
    try {
      guard.assertCurrent(operation);
    } catch (error) {
      if (mode === 'image') await discardTemporaryPreview(result);
      throw error;
    }
    return result;
  }

  async function discardTemporaryPreview(result) {
    if (mode !== 'image' || result?.temporary !== true) return;
    const outputDir = result.outputDir || result.output_dir;
    const outputPath = result.outputPath || result.output_path;
    const manifestPath = result.manifestPath || result.manifest_path;
    if (!outputDir || !outputPath || !manifestPath) return;
    try {
      const { invoke } = await tauriCorePromise;
      await invoke('discard_ppt_to_image_preview', {
        outputDir,
        outputPath,
        manifestPath
      });
    } catch (_) {
      // Do not echo filesystem paths in a user-facing log. The native command
      // refuses anything that is not a marked, exact preview artifact.
      console.error('[PPT Render:image] temporary preview cleanup failed');
    }
  }

  function showSuccess(result) {
    lastOutputPath = result?.outputPath || result?.output_path || result?.outputDir || '';
    if (successMeta) successMeta.textContent = result?.warnings?.length
      ? `${text('successMeta')} ${text('successWarning')}`
      : text('successMeta');
    if (successPages) successPages.textContent = String(result?.pageCount || manifest?.slide_count || 0);
    if (successSize) successSize.textContent = formatFileSize(result?.outputBytes || 0);
    if (successPath) successPath.textContent = displayFilesystemPath(result?.outputDir || '');
    setInteractiveLayer(successOverlay, true);
  }

  async function exportPdf() {
    if (!selectedFile || !manifest || busy) return;
    const owner = session;
    const operation = guard.begin();
    if (!operation) return;
    operation.scope = createLifecycleScope();
    operation.signal = operation.scope.abortController().signal;
    busy = true;
    updateControls();
    setProgress(18, text('converting'));
    try {
      const result = await convertToPdf('PPT_To_PDF', operation);
      setProgress(100, text('writing'));
      showSuccess(result);
      notify(text('exportDone', { pages: result.pageCount || manifest.slide_count, size: formatFileSize(result.outputBytes || 0) }));
    } catch (error) {
      if (!guard.isCurrent(operation)) return;
      console.error('[PPT Render:pdf] export failed:', error);
      if (!String(error?.message || error).includes('runtime-missing')) {
        notify(String(error?.message || error).includes('desktop-only') ? text('desktopOnly') : errorMessage(error, text));
      }
    } finally {
      if (!guard.isCurrent(operation)) return;
      busy = false;
      guard.finish(operation);
      updateControls();
      hideProgressSoon(owner);
    }
  }

  async function openImageWorkspace() {
    if (!selectedFile || !manifest || busy) return;
    const operation = guard.begin();
    if (!operation) return;
    operation.scope = createLifecycleScope();
    operation.signal = operation.scope.abortController().signal;
    busy = true;
    updateControls();
    setProgress(16, text('converting'));
    let pdfFile = null;
    let temporaryCleanup = null;
    try {
      const result = await convertToPdf('PPT_To_Image', operation);
      setProgress(92, text('openingWorkspace'));
      notify(text('workspaceReady', { pages: result.pageCount || manifest.slide_count }));
      temporaryCleanup = () => discardTemporaryPreview(result);
      pdfFile = {
        name: result.outputFile || createPptToPdfFileName(manifest.base_name || manifest.source_name),
        path: result.outputPath,
        size: result.outputBytes || 0,
        outputCategory: 'PPT_To_Image'
      };
    } catch (error) {
      if (!guard.isCurrent(operation)) return;
      console.error('[PPT Render:image] preparation failed:', error);
      if (!String(error?.message || error).includes('runtime-missing')) {
        notify(String(error?.message || error).includes('desktop-only') ? text('desktopOnly') : errorMessage(error, text));
      }
    } finally {
      if (guard.isCurrent(operation)) {
        busy = false;
        guard.finish(operation);
        updateControls();
      }
    }
    if (!pdfFile) {
      hideProgressSoon(session);
      return;
    }
    close();
    let transferred = false;
    try {
      const instance = await openLazyTool('pdf-to-image');
      const opened = await instance?.raw?.openWithFile(pdfFile, {
        cleanupTemporaryPreview: temporaryCleanup
      });
      transferred = opened === true;
      if (!transferred) await temporaryCleanup?.();
    } catch (error) {
      if (!transferred) await temporaryCleanup?.();
      console.error('[PPT Render:image] workspace open failed');
      notify(errorMessage(error, text));
    }
  }

  lifecycle.event(overlay, 'dragover', event => {
    if (!dragHasExternalFiles(event)) return;
    event.preventDefault();
    if (!busy) dropZone?.classList.add('visible');
  });
  lifecycle.event(overlay, 'dragleave', event => {
    if (event.target === overlay) dropZone?.classList.remove('visible');
  });
  lifecycle.event(overlay, 'drop', event => {
    if (!dragHasExternalFiles(event)) return;
    event.preventDefault();
    dropZone?.classList.remove('visible');
    const file = Array.from(event.dataTransfer?.files || []).find(isPptxFile);
    if (file) void handleFile(file);
    else notify(text('unsupportedFormat'));
  });
  function selectFile() {
    if (busy) return;
    void choosePptxFile({
      isTauri,
      input,
      onSelected: handleFile,
      onError: error => notify(String(error?.message || error))
    });
  }
  lifecycle.event(cta, 'click', selectFile);
  lifecycle.event(input, 'change', event => {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
  });
  lifecycle.event(actionButton, 'click', () => {
    if (mode === 'image') void openImageWorkspace();
    else void exportPdf();
  });
  if (successOk) lifecycle.event(successOk, 'click', () => setInteractiveLayer(successOverlay, false));
  if (successOpenFolder) lifecycle.event(successOpenFolder, 'click', () => {
    if (isTauri && lastOutputPath) void openOutputFolder(lastOutputPath);
  });
  bindPptChrome(lifecycle, overlay, {
    onClose: close,
    openSettings,
    openSupport,
    openExternalUrl,
    handleWindowAction
  });
  lifecycle.use(onLangChange(() => {
    if (!isOpen(session)) return;
    applyTranslations();
    if (manifest) {
      if (fileName && selectedFile) {
        fileName.textContent = `${selectedFile.name || selectedFile.path || 'presentation.pptx'} · ${summaryText()}`;
      }
      renderStats();
    }
  }));

  resetState();
  return {
    open,
    close,
    dispose() {
      if (disposed) return;
      close();
      disposed = true;
      lifecycle.dispose();
    },
    get busy() { return busy; }
  };
}
