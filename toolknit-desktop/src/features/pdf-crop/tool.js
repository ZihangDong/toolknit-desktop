import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { onLangChange, t } from '../../i18n.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import { enhanceToolSelects } from '../../tool-custom-select.js';
import {
  PDF_CROP_LIMITS,
  PdfCropCancelledError,
  assertPdfCropFile,
  sanitizePdfCropBaseName
} from './core.js';
import { createPdfCropExporter } from './exporter.js';
import { createPdfCropView } from './view.js';
import { createPdfCropWorkspace } from './workspace.js';
import './pdf-crop.css';

function asUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new Error('Invalid binary response');
}

function sourceName(file) {
  return String(file?.name || file?.fileName || file?.path?.split(/[\\/]/).pop() || 'document.pdf');
}

function isPasswordError(error) {
  return error?.name === 'PasswordException'
    || /password|encrypted/i.test(String(error?.message || error || ''));
}

function isCancellation(error) {
  return error instanceof PdfCropCancelledError
    || error?.name === 'RenderingCancelledException'
    || /cancelled|canceled/i.test(String(error?.message || error || ''));
}

export function initPdfCropTool({
  overlay,
  isTauri = false,
  getOutputDir,
  displayFilesystemPath,
  notify,
  refreshIcons = () => {},
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = instance => instance
} = {}) {
  const byId = id => document.getElementById(id);
  const plasmaBg = byId('pdfCropPlasmaBg');
  const back = byId('pdfCropBack');
  const dropZone = byId('pdfCropDropZone');
  const fileInput = byId('pdfCropFileInput');
  const emptyAdd = byId('pdfCropEmptyAdd');
  const replaceButton = byId('pdfCropReplace');
  const unitSelect = byId('pdfCropUnit');
  const outputNameInput = byId('pdfCropOutputName');
  const exportCurrentButton = byId('pdfCropExportCurrent');
  const exportButton = byId('pdfCropExport');
  const processMask = byId('pdfCropProcessMask');
  const processText = byId('pdfCropProcessText');
  const processValue = byId('pdfCropProcessValue');
  const processFill = byId('pdfCropProcessFill');
  const processCancel = byId('pdfCropProcessCancel');
  const successOverlay = byId('pdfCropSuccessOverlay');
  const successMeta = byId('pdfCropSuccessMeta');
  const successCount = byId('pdfCropSuccessCount');
  const successPath = byId('pdfCropSuccessPath');
  const successOpenFolder = byId('pdfCropSuccessOpenFolder');
  const successOk = byId('pdfCropSuccessOk');

  if (!overlay || !byId('pdfCropFilmstrip') || !byId('pdfCropPreviewCanvas')
    || !byId('pdfCropInteractionLayer') || !exportCurrentButton || !exportButton) {
    return { open() {}, close() {}, dispose() {} };
  }
  if (typeof getOutputDir !== 'function') throw new Error('pdf-crop:missing-output-directory');
  if (typeof displayFilesystemPath !== 'function') throw new Error('pdf-crop:missing-path-display');

  const lifecycle = createLifecycleScope();
  const listen = (target, type, handler, options) => target
    ? lifecycle.event(target, type, handler, options)
    : () => {};
  const customSelectControls = enhanceToolSelects([unitSelect]);
  let disposed = false;
  let session = null;
  let activeOperation = null;
  let operationSequence = 0;
  let plasmaInstance = null;
  let overlayReturnFocus = null;
  let successReturnFocus = null;
  const isDemo = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get('pdf-crop-demo') === '1';

  const showToast = (message, duration = 7000) => {
    if (disposed) return;
    if (typeof notify === 'function') notify(message, { duration, dismissible: true });
    else window.showToast?.(message, { duration, dismissible: true });
  };
  const getInvoke = async () => {
    const { invoke } = await tauriCorePromise;
    return invoke;
  };
  const isOpenSession = owner => owner && owner === session && !owner.disposed
    && overlay.classList.contains('visible');

  const view = createPdfCropView({
    overlay,
    processMask,
    processText,
    processValue,
    processFill,
    processCancel,
    successOverlay,
    successMeta,
    successCount,
    successPath,
    successOpenFolder,
    displayFilesystemPath,
    isTauri,
    text: t
  });
  const workspace = createPdfCropWorkspace({
    overlay,
    text: t,
    refreshIcons,
    customSelectControls,
    isBusy: () => Boolean(activeOperation),
    isOpen: () => isOpenSession(session),
    onStateChange: () => updateControls()
  });
  const exporter = createPdfCropExporter({ isTauri, getOutputDir, getInvoke });

  function beginOperation(type, owner) {
    if (activeOperation) throw new Error('pdf-crop:busy');
    const operation = {
      id: ++operationSequence,
      type,
      owner,
      cancelled: false,
      silent: false,
      loadingTasks: new Set(),
      isCurrent: () => activeOperation === operation && isOpenSession(owner)
    };
    activeOperation = operation;
    if (processCancel) processCancel.disabled = false;
    updateControls();
    return operation;
  }

  function assertOperation(operation) {
    if (!operation || operation.cancelled || !operation.isCurrent()) {
      throw new PdfCropCancelledError();
    }
  }

  function finishOperation(operation) {
    if (activeOperation !== operation) return;
    activeOperation = null;
    view.setProcessState(false);
    updateControls();
  }

  function cancelOperation({ silent = false, detach = false } = {}) {
    const operation = activeOperation;
    if (!operation || operation.cancelled) return;
    operation.cancelled = true;
    operation.silent ||= silent;
    if (processCancel) processCancel.disabled = true;
    if (!silent) view.setProgress(0, t('home.pdfCrop.cancelling'));
    operation.loadingTasks.forEach(task => { try { task.destroy(); } catch (_) {} });
    if (detach && activeOperation === operation) {
      activeOperation = null;
      view.setProcessState(false);
      updateControls();
    }
  }

  async function fileSizeFor(file) {
    if (isTauri && file.path) {
      const invoke = await getInvoke();
      return Number(await invoke('get_file_size', { path: file.path }));
    }
    return Number(file.size || 0);
  }

  async function readFileBytes(file) {
    if (isTauri && file.path) {
      const invoke = await getInvoke();
      return asUint8Array(await invoke('read_file_bytes', { path: file.path }));
    }
    return new Uint8Array(await file.arrayBuffer());
  }

  function loadErrorMessage(error) {
    if (isCancellation(error)) return t('home.pdfCrop.loadCancelled');
    if (isPasswordError(error)) return t('home.pdfCrop.passwordProtected');
    const detail = String(error?.message || error || '');
    if (/pdf file is required/i.test(detail)) return t('home.pdfCrop.pdfOnly');
    if (/mb limit|file size/i.test(detail)) return t('home.pdfCrop.fileTooLarge');
    if (/page limit/i.test(detail)) return t('home.pdfCrop.tooManyPages', { count: PDF_CROP_LIMITS.maxPages });
    return t('home.pdfCrop.loadFailed', { error: detail });
  }

  function exportErrorMessage(error) {
    if (isCancellation(error)) return t('home.pdfCrop.cancelled');
    return t('home.pdfCrop.exportFailed', { error: String(error?.message || error || '') });
  }

  function outputMode() {
    return overlay.querySelector('input[name="pdfCropOutputMode"]:checked')?.value === 'zip'
      ? 'zip'
      : 'single';
  }

  function updateControls() {
    const busy = Boolean(activeOperation);
    const hasDocument = workspace.hasDocument();
    workspace.refreshControls();
    if (replaceButton) replaceButton.disabled = busy;
    if (emptyAdd) emptyAdd.disabled = busy;
    overlay.querySelectorAll('input[name="pdfCropOutputMode"], #pdfCropOutputName').forEach(input => {
      input.disabled = busy || !hasDocument;
    });
    exportCurrentButton.disabled = busy || !hasDocument || !workspace.hasCurrentCrop();
    exportButton.disabled = busy || !hasDocument || !workspace.hasCrop();
  }

  async function loadFile(fileList, owner = session) {
    const files = Array.from(fileList || []);
    if (!isOpenSession(owner) || !files.length || activeOperation) return;
    if (files.length !== 1) {
      showToast(t('home.pdfCrop.singleFileOnly'));
      if (fileInput) fileInput.value = '';
      return;
    }
    const operation = beginOperation('load', owner);
    view.setProcessState(true);
    view.setProgress(3, t('home.pdfCrop.readingFile'));
    let staged = null;
    let previous = null;
    try {
      const file = files[0];
      const name = sourceName(file);
      const size = await fileSizeFor(file);
      assertPdfCropFile(name, size);
      assertOperation(operation);
      const bytes = await readFileBytes(file);
      assertOperation(operation);
      const replacement = await workspace.stageDocument({
        name,
        size,
        bytes,
        active: operation,
        assertOperation,
        setProgress: (percent, label) => {
          assertOperation(operation);
          view.setProgress(percent, label);
        }
      });
      staged = replacement.source;
      assertOperation(operation);
      previous = workspace.replaceDocument(replacement);
      staged = null;
      if (outputNameInput) outputNameInput.value = sanitizePdfCropBaseName(name);
      updateControls();
      view.setProgress(76, t('home.pdfCrop.renderingPreview'));
      await workspace.renderPreview();
      assertOperation(operation);
      view.setProgress(100, t('home.pdfCrop.ready'));
      await workspace.releaseSource(previous);
      previous = null;
    } catch (error) {
      await workspace.releaseSource(staged);
      await workspace.releaseSource(previous);
      if (!operation.silent && isOpenSession(owner) && !isCancellation(error)) {
        showToast(loadErrorMessage(error));
      }
    } finally {
      finishOperation(operation);
      if (fileInput) fileInput.value = '';
    }
  }

  async function exportDocument(target = 'all', owner = session) {
    const canExport = target === 'current' ? workspace.hasCurrentCrop() : workspace.hasCrop();
    if (!isOpenSession(owner) || activeOperation || !workspace.hasDocument() || !canExport) return;
    const trigger = target === 'current' ? exportCurrentButton : exportButton;
    const operation = beginOperation(target === 'current' ? 'export-current' : 'export-all', owner);
    view.setProcessState(true);
    view.setProgress(3, t('home.pdfCrop.preparingExport'));
    try {
      const state = workspace.getExportState();
      const result = await exporter.run({
        active: operation,
        ...state,
        outputName: outputNameInput?.value || state.sourceName,
        mode: outputMode(),
        target,
        assertOperation,
        setProgress: (percent, label) => view.setProgress(percent, label),
        text: t
      });
      assertOperation(operation);
      view.setProgress(100, t('home.pdfCrop.complete'));
      successReturnFocus = trigger;
      view.showSuccess(result);
      view.focus(successOk || successOpenFolder);
    } catch (error) {
      if (!operation.silent && isOpenSession(owner) && !isCancellation(error)) {
        console.error('[PDF Crop] export failed:', error);
        showToast(exportErrorMessage(error), 9000);
      }
    } finally {
      finishOperation(operation);
    }
  }

  async function openOutputFolder() {
    const result = view.getLastResult();
    if (!isTauri || (!result?.outputPath && !result?.outputDir)) return;
    try {
      const invoke = await getInvoke();
      await invoke('open_path', { path: result.outputPath || result.outputDir });
    } catch (error) {
      console.error('[PDF Crop] open output folder failed:', error);
      showToast(t('home.pdfCrop.openFolderFailed'));
    }
  }

  function showDropZone() {
    if (activeOperation) return;
    overlay.classList.add('drag-over');
    dropZone?.classList.add('visible');
  }

  function hideDropZone() {
    overlay.classList.remove('drag-over');
    dropZone?.classList.remove('visible');
  }

  async function registerNativeDrop(owner) {
    if (!isTauri || !isOpenSession(owner)) return;
    try {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      if (!isOpenSession(owner)) return;
      const unlisten = await getCurrentWebview().onDragDropEvent(event => {
        if (!isOpenSession(owner) || activeOperation) return;
        const payload = event.payload || {};
        if (payload.type === 'enter' || payload.type === 'over') showDropZone();
        else if (payload.type === 'leave') hideDropZone();
        else if (payload.type === 'drop') {
          hideDropZone();
          const files = Array.from(payload.paths || []).map(path => ({
            name: path.split(/[\\/]/).pop() || path,
            path,
            size: 0
          }));
          void loadFile(files, owner);
        }
      });
      owner.use(unlisten);
    } catch (error) {
      if (isOpenSession(owner)) console.error('[PDF Crop] native drag-drop setup failed:', error);
    }
  }

  async function loadDemoFile(owner) {
    const { PDFDocument, StandardFonts, degrees, rgb } = await import('pdf-lib');
    const documentHandle = await PDFDocument.create();
    const font = await documentHandle.embedFont(StandardFonts.Helvetica);
    [[612, 792, 0], [792, 612, 90], [420, 595, 0], [595, 420, 270]].forEach(([width, height, rotation], index) => {
      const page = documentHandle.addPage([width, height]);
      page.setRotation(degrees(rotation));
      page.drawText(`ToolKnit PDF Crop - Page ${index + 1}`, {
        x: 42,
        y: height - 72,
        size: 20,
        font,
        color: rgb(0.08, 0.08, 0.1)
      });
    });
    const bytes = await documentHandle.save();
    if (!isOpenSession(owner)) return;
    await loadFile([{
      name: 'toolknit-pdf-crop-demo.pdf',
      size: bytes.length,
      arrayBuffer: async () => bytes.slice().buffer
    }], owner);
  }

  function handleKeydown(event) {
    if (!overlay.classList.contains('visible')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (successOverlay?.classList.contains('visible')) {
        view.closeSuccess();
        view.focus(successReturnFocus || exportButton);
        successReturnFocus = null;
      } else if (activeOperation) {
        cancelOperation();
      } else if (!workspace.cancelReframe()) {
        void closeTool();
      }
      return;
    }
    if (processMask?.classList.contains('visible') || successOverlay?.classList.contains('visible')) return;
    workspace.handleShortcut(event);
  }

  function requestFile() {
    if (activeOperation || !session) return;
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
  }

  function openTool() {
    if (disposed) return;
    if (isOpenSession(session)) {
      updateControls();
      return;
    }
    if (!overlay.classList.contains('visible')) overlayReturnFocus = document.activeElement;
    session?.dispose();
    session = createLifecycleScope();
    view.clear();
    view.setOverlayState(true);
    if (plasmaBg && !plasmaInstance) plasmaInstance = initStandardToolPlasma(plasmaBg);
    customSelectControls.forEach(control => control.refresh());
    refreshIcons();
    workspace.startSession(session);
    updateControls();
    void registerNativeDrop(session);
    const owner = session;
    requestAnimationFrame(() => {
      if (!isOpenSession(owner)) return;
      view.focus(workspace.hasDocument() ? exportButton : emptyAdd || back);
    });
    if (isDemo && !workspace.hasDocument()) void loadDemoFile(owner);
  }

  async function closeTool({ restoreFocus = true } = {}) {
    const returnFocus = overlayReturnFocus;
    overlayReturnFocus = null;
    successReturnFocus = null;
    if (activeOperation) cancelOperation({ silent: true, detach: true });
    const owner = session;
    session = null;
    owner?.dispose();
    view.clear();
    view.setOverlayState(false);
    hideDropZone();
    customSelectControls.forEach(control => control.close());
    plasmaInstance = disposeStandardToolPlasma(plasmaInstance);
    if (fileInput) fileInput.value = '';
    await workspace.resetDocument();
    updateControls();
    if (restoreFocus) view.focus(returnFocus);
  }

  listen(back, 'click', () => { void closeTool(); });
  listen(emptyAdd, 'click', requestFile);
  listen(replaceButton, 'click', requestFile);
  listen(fileInput, 'change', event => { void loadFile(event.target.files, session); });
  listen(exportCurrentButton, 'click', () => { void exportDocument('current', session); });
  listen(exportButton, 'click', () => { void exportDocument('all', session); });
  listen(processCancel, 'click', () => cancelOperation());
  listen(successOk, 'click', () => {
    view.closeSuccess();
    view.focus(successReturnFocus || exportButton);
    successReturnFocus = null;
  });
  listen(successOpenFolder, 'click', () => { void openOutputFolder(); });
  listen(document, 'keydown', handleKeydown);
  listen(overlay, 'dragover', event => {
    if (isTauri) return;
    event.preventDefault();
    showDropZone();
  });
  listen(overlay, 'dragleave', event => {
    if (!overlay.contains(event.relatedTarget)) hideDropZone();
  });
  listen(overlay, 'drop', event => {
    if (isTauri) return;
    event.preventDefault();
    hideDropZone();
    void loadFile(event.dataTransfer?.files, session);
  });

  const unsubscribeLangChange = onLangChange(() => {
    workspace.refresh();
    customSelectControls.forEach(control => control.refresh());
    view.refresh();
  }) || (() => {});
  lifecycle.use(unsubscribeLangChange);
  lifecycle.use(() => customSelectControls.forEach(control => control.dispose()));
  listen(window, 'beforeunload', () => { void dispose(); }, { once: true });

  updateControls();
  view.clear();
  view.setOverlayState(false);

  async function dispose() {
    if (disposed) return;
    await closeTool({ restoreFocus: false });
    disposed = true;
    exporter.dispose();
    await workspace.dispose();
    lifecycle.dispose();
  }

  return { open: openTool, close: closeTool, dispose };
}
