import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { applyTranslations, onLangChange, t } from '../../i18n.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import { bindPointerSortableFileList } from '../../shared/sortable-file-list.js';
import { moveFocusOutOfHiddenRegion } from '../../shared/tool-page-shell.js';
import { enhanceToolSelects } from '../../tool-custom-select.js';
import {
  PDF_COMPRESS_LEVELS,
  getPdfCompressErrorCode,
  summarizePdfCompressResults,
  normalizePdfCompressionOptions
} from '../../pdf-compress-core.js';
import { createPdfCompressProcessor, PdfCompressCancelledError } from './processor.js';
import { createPdfCompressionResultList } from './results.js';
import './pdf-compress.css';

function fileNameFromPath(path) {
  return String(path || '').split(/[/\\]/).pop() || String(path || '');
}

function outputParentFolder(path) {
  const value = String(path || '').trim().replace(/[\\/]+$/, '');
  if (!value) return '';
  const parent = value.replace(/[/\\][^/\\]+$/, '');
  return parent && parent !== value ? parent : value;
}

function setInteractiveLayer(element, visible) {
  if (!element) return;
  if (!visible) moveFocusOutOfHiddenRegion(element);
  element.classList.toggle('visible', visible);
  element.setAttribute('aria-hidden', visible ? 'false' : 'true');
  element.inert = !visible;
}

function safeFocus(element) {
  if (!element || element.closest?.('[inert], [aria-hidden="true"]')) return;
  try { element.focus({ preventScroll: true }); } catch (_) {}
}

function isCancellation(error) {
  return error instanceof PdfCompressCancelledError
    || /pdf-compress:cancelled|cancelled|canceled/i.test(String(error?.message || error || ''));
}

export function initPdfCompressTool({
  overlay,
  isTauri = false,
  getOutputDir,
  displayFilesystemPath,
  formatFileSize = value => `${value} B`,
  notify = () => {},
  refreshIcons = () => {},
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = instance => instance,
  showError = message => window.alert(message)
} = {}) {
  if (!overlay) throw new Error('pdf-compress:missing-overlay');
  if (typeof getOutputDir !== 'function') throw new Error('pdf-compress:missing-output-directory');
  if (typeof displayFilesystemPath !== 'function') throw new Error('pdf-compress:missing-path-display');

  const byId = id => document.getElementById(id);
  const background = byId('pdfCompressPlasmaBg');
  const back = byId('pdfCompressBack');
  const dropZone = byId('pdfCompressDropZone');
  const fileList = byId('pdfCompressFiles');
  const cta = byId('pdfCompressCta');
  const processButton = byId('pdfCompressProcessBtn');
  const processMask = byId('pdfCompressProcessMask');
  const progressFill = byId('pdfCompressProcessBarFill');
  const progressText = byId('pdfCompressProcessText');
  const workflowOptions = byId('pdfCompressWorkflowOptions');
  const regularOptions = byId('pdfCompressRegularOptions');
  const targetOptions = byId('pdfCompressTargetOptions');
  const levelOptions = byId('pdfCompressLevelOptions');
  const targetSize = byId('pdfCompressTargetSize');
  const targetSizeControls = byId('pdfCompressTargetSizeControls');
  const modeOptions = byId('pdfCompressModeOptions');
  const claritySelect = byId('pdfCompressClarity');
  const customTarget = byId('pdfCompressCustomTarget');
  const targetValue = byId('pdfCompressTargetValue');
  const targetUnit = byId('pdfCompressTargetUnit');
  const modeHint = byId('pdfCompressModeHint');
  const targetHint = byId('pdfCompressTargetHint');
  const cancelButton = byId('pdfCompressCancel');
  const successOverlay = byId('pdfCompressSuccessOverlay');
  const successMeta = byId('pdfCompressSuccessMeta');
  const successFileName = byId('pdfCompressSuccessFileName');
  const successOriginalSize = byId('pdfCompressSuccessOriginalSize');
  const successCompressedSize = byId('pdfCompressSuccessCompressedSize');
  const successCount = byId('pdfCompressSuccessCount');
  const successPath = byId('pdfCompressSuccessPath');
  const successOk = byId('pdfCompressSuccessOk');
  const successOpenFolder = byId('pdfCompressSuccessOpenFolder');

  if (!fileList || !cta || !processButton || !processMask || !successOverlay) {
    return { open() {}, close() {}, dispose() {} };
  }

  const lifecycle = createLifecycleScope();
  const listen = (target, type, handler, options) => target
    ? lifecycle.event(target, type, handler, options)
    : () => {};
  const browserInput = !isTauri ? document.createElement('input') : null;
  let fileScope = null;
  let session = null;
  let files = [];
  let level = levelOptions?.querySelector('.active')?.dataset.level || 'medium';
  let targetSizeMb = null;
  let workflow = 'regular';
  let mode = 'structure';
  let clarity = 'readable';
  let unit = 'KB';
  let processing = false;
  let activeOperation = null;
  let activePromise = null;
  let operationSequence = 0;
  let plasma = null;
  let returnFocus = null;
  let results = [];
  let outputDirectory = '';
  let lastSavedPath = '';
  let buttonRevision = 0;
  let nativeDropGuardUntil = 0;
  let disposed = false;

  const isDemo = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get('pdf-compress-demo') === '1';
  const showToast = (message, duration = 7000) => {
    if (!disposed) notify(message, { duration, dismissible: true });
  };
  const isOpenSession = owner => owner && owner === session && !owner.disposed
    && overlay.classList.contains('visible');
  const processor = createPdfCompressProcessor({ isTauri, getOutputDir,
    saveBrowser: async (bytes, name, operation) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      operation.owner.use(() => URL.revokeObjectURL(url));
      operation.owner.timeout(() => URL.revokeObjectURL(url), 2000);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      return `~/Downloads/${name}`;
    }
  });
  const customSelectControls = enhanceToolSelects([targetSize, claritySelect, targetUnit]);
  lifecycle.use(() => customSelectControls.forEach(control => control.dispose()));
  const resultList = createPdfCompressionResultList({
    root: byId('pdfCompressResults'), translate: t, formatFileSize, errorMessage,
    canRetryCompact: result => isReadablePageTooLarge(result),
    onRetryCompact: () => retryWithCompactClarity()
  });
  lifecycle.use(resultList.dispose);

  const targetRequiresRaster = () => workflow === 'target';

  function targetSelectionMegabytes() {
    if (!targetSize || targetSize.value === 'custom') return null;
    const value = Number(targetSize.value);
    return Number.isFinite(value) ? value : null;
  }

  function syncOptions() {
    const targetWorkflow = targetRequiresRaster();
    if (regularOptions) regularOptions.hidden = targetWorkflow;
    if (targetOptions) targetOptions.hidden = !targetWorkflow;
    workflowOptions?.querySelectorAll('[data-workflow]').forEach(button => {
      const active = button.dataset.workflow === workflow;
      button.disabled = processing;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    regularOptions?.querySelectorAll('button, input, select').forEach(control => {
      control.disabled = processing || targetWorkflow;
    });
    targetOptions?.querySelectorAll('button, input, select').forEach(control => {
      control.disabled = processing || !targetWorkflow;
    });
    if (customTarget) {
      const custom = targetSize?.value === 'custom';
      customTarget.hidden = !custom;
      targetSizeControls?.classList.toggle('is-custom', custom);
    }
    if (claritySelect) claritySelect.disabled = processing || !targetWorkflow;
    levelOptions?.querySelectorAll('button').forEach(button => {
      button.disabled = processing || targetWorkflow;
      button.classList.toggle('active', button.dataset.level === level);
    });
    modeOptions?.querySelectorAll('[data-mode]').forEach(button => {
      button.disabled = processing || targetWorkflow;
      button.classList.toggle('active', button.dataset.mode === mode);
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    });
    if (modeHint) {
      const key = mode === 'structure' ? 'home.pdfCompress.structureHint' : 'home.pdfCompress.rasterHint';
      modeHint.dataset.i18n = key;
      modeHint.textContent = t(key);
    }
    if (targetHint) {
      targetHint.dataset.i18n = 'home.pdfCompress.targetHint';
      targetHint.textContent = t('home.pdfCompress.targetHint')
        + (clarity === 'compact' ? ` ${t('home.pdfCompress.compactWarning')}` : '');
    }
    customSelectControls.forEach(control => control.refresh());
  }

  function selectedTargetBytes() {
    if (!targetRequiresRaster() || !targetSize) {
      targetSizeMb = null;
      return null;
    }
    const bytes = targetSize.value === 'custom' ? Math.floor(Number(targetValue.value) * (unit === 'MB' ? 1024 * 1024 : 1024))
      : Number(targetSize.value) * 1024 * 1024;
    targetSizeMb = targetSelectionMegabytes();
    return normalizePdfCompressionOptions({ mode: 'raster', level, clarity, targetBytes: bytes }).targetBytes;
  }

  if (browserInput) {
    browserInput.type = 'file';
    browserInput.accept = '.pdf,application/pdf';
    browserInput.multiple = true;
    browserInput.hidden = true;
    document.body.append(browserInput);
    lifecycle.use(() => browserInput.remove());
  }

  function setProgress(percent, detail = {}) {
    const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if (progressFill) progressFill.style.width = `${value}%`;
    if (progressText) {
      const key = { preparing: 'phasePreparing', encoding: 'phaseEncoding', attempt: 'phaseAttempt', verifying: 'phaseVerifying' }[detail.phase];
      progressText.textContent = key ? t(`home.pdfCompress.${key}`, { ...detail, size: formatFileSize(detail.bytes || 0) }) : Number(detail.total) > 0
        ? `${t('home.pdfCompress.processing')} (${detail.current}/${detail.total})`
        : t('home.pdfCompress.processing');
    }
  }

  function setProcessing(visible) {
    setInteractiveLayer(processMask, visible);
    if (cancelButton) cancelButton.disabled = false;
    syncOptions();
    if (visible) safeFocus(cancelButton);
    if (!visible) setProgress(0);
  }

  function showDropZone() {
    if (processing) return;
    dropZone?.classList.add('visible');
    overlay.classList.add('drag-over');
  }

  function hideDropZone() {
    dropZone?.classList.remove('visible');
    overlay.classList.remove('drag-over');
  }

  function updateProcessButton() {
    if (!processButton) return;
    const revision = ++buttonRevision;
    if (files.length > 0) {
      processButton.style.display = '';
      const owner = session;
      const frame = requestAnimationFrame(() => {
        if (revision === buttonRevision && (!owner || isOpenSession(owner))) {
          processButton.classList.add('visible');
        }
      });
      owner?.use(() => cancelAnimationFrame(frame));
      return;
    }
    processButton.classList.remove('visible');
    const finish = () => {
      if (revision === buttonRevision && files.length === 0) processButton.style.display = 'none';
    };
    const release = lifecycle.event(processButton, 'transitionend', event => {
      if (event.propertyName !== 'opacity') return;
      release();
      finish();
    });
    window.setTimeout(() => {
      release();
      finish();
    }, 320);
  }

  function renderFiles() {
    fileScope?.dispose();
    fileScope = createLifecycleScope();
    fileList.replaceChildren();
    fileList.classList.toggle('has-files', files.length > 0);
    files.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'audio-convert-file-item';
      item.dataset.index = String(index);
      const number = document.createElement('span');
      number.className = 'audio-convert-file-index';
      number.textContent = String(index + 1);
      const name = document.createElement('span');
      name.className = 'audio-convert-file-name';
      name.textContent = String(file?.name || fileNameFromPath(file?.path) || 'document.pdf');
      name.title = name.textContent;
      const remove = document.createElement('button');
      remove.className = 'audio-convert-file-remove';
      remove.type = 'button';
      remove.setAttribute('aria-label', t('home.pdfCompress.removeFile'));
      const icon = document.createElement('i');
      icon.dataset.lucide = 'x';
      remove.appendChild(icon);
      fileScope.event(remove, 'click', event => {
        event.stopPropagation();
        if (processing) return;
        files.splice(index, 1);
        renderFiles();
      });
      item.append(number, name, remove);
      fileList.appendChild(item);
    });
    bindPointerSortableFileList({
      scope: fileScope,
      container: fileList,
      items: files,
      render: renderFiles,
      isLocked: () => processing,
      guardNativeDrop: duration => {
        nativeDropGuardUntil = performance.now() + duration;
      }
    });
    updateProcessButton();
    refreshIcons();
  }

  function addFiles(selected) {
    if (!selected || processing || !isOpenSession(session)) return;
    for (const file of Array.from(selected)) {
      const name = String(file?.name || fileNameFromPath(file?.path) || '');
      if (!/\.pdf$/i.test(name)) continue;
      const duplicate = file?.path
        ? files.some(candidate => candidate.path === file.path)
        : files.some(candidate => candidate === file
          || (candidate.name === file.name && candidate.size === file.size));
      if (!duplicate) files.push(file);
    }
    renderFiles();
  }

  async function chooseFiles() {
    const owner = session;
    if (!isOpenSession(owner) || processing) return;
    if (!isTauri) {
      browserInput.value = '';
      browserInput.click();
      return;
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: true,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
      });
      if (!isOpenSession(owner) || !Array.isArray(selected)) return;
      addFiles(selected.map(path => ({ name: fileNameFromPath(path), path, size: 0 })));
    } catch (error) {
      if (isOpenSession(owner)) console.error('[PDF Compress] file selection failed:', error);
    }
  }

  async function registerNativeDrop(owner) {
    if (!isTauri || !isOpenSession(owner)) return;
    try {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      if (!isOpenSession(owner)) return;
      const unlisten = await getCurrentWebview().onDragDropEvent(event => {
        if (!isOpenSession(owner) || processing) return;
        const payload = event.payload || {};
        if (fileList.classList.contains('is-reordering') || performance.now() < nativeDropGuardUntil) {
          hideDropZone();
          return;
        }
        if (payload.type === 'enter' || payload.type === 'over') showDropZone();
        else if (payload.type === 'leave') hideDropZone();
        else if (payload.type === 'drop') {
          hideDropZone();
          addFiles((payload.paths || [])
            .filter(path => /\.pdf$/i.test(String(path)))
            .map(path => ({ name: fileNameFromPath(path), path, size: 0 })));
        }
      });
      if (!isOpenSession(owner)) {
        unlisten();
        return;
      }
      owner.use(unlisten);
    } catch (error) {
      if (isOpenSession(owner)) console.error('[PDF Compress] native drag-drop setup failed:', error);
    }
  }

  function beginOperation(owner) {
    if (activeOperation || !isOpenSession(owner)) return null;
    const operation = {
      id: ++operationSequence,
      owner,
      cancelled: false,
      silent: false,
      isCurrent: () => activeOperation === operation && isOpenSession(owner)
    };
    activeOperation = operation;
    return operation;
  }

  function cancelOperation({ silent = false, detach = false } = {}) {
    const operation = activeOperation;
    if (!operation) return Promise.resolve();
    operation.silent ||= silent;
    const cancelPromise = processor.cancel(operation);
    if (detach && activeOperation === operation) activeOperation = null;
    return cancelPromise;
  }

  function finishOperation(operation) {
    if (activeOperation !== operation) return;
    activeOperation = null;
    processing = false;
    setProcessing(false);
  }

  function isReadablePageTooLarge(result) {
    return Boolean(result
      && result.targetBytes != null
      && result.clarity === 'readable'
      && getPdfCompressErrorCode(result.error) === 'page-too-large');
  }

  function errorMessage(error, result = null) {
    const key = {
      'desktop-only': 'errorDesktopOnly',
      'input-too-large': 'errorTooLarge',
      'too-many-pages': 'errorTooManyPages',
      'invalid-level': 'errorInvalidLevel',
      'invalid-pdf': 'errorInvalidPdf',
      'password-protected': 'errorPasswordProtected',
      'busy': 'errorBusy',
      'timeout': 'errorTimeout',
      'output-invalid': 'errorOutputInvalid',
      'qpdf-unavailable': 'errorEngineUnavailable',
      'output-path': 'errorOutputPath',
      'invalid-mode': 'errorInvalidMode',
      'invalid-clarity': 'errorInvalidMode',
      'invalid-target-size': 'errorInvalidTarget',
      'cache-limit': 'errorCacheLimit',
      'cache-unavailable': 'errorCacheLimit',
      'page-too-large': 'errorPageTooLarge',
      'output-too-large': 'errorOutputTooLarge',
      'input-changed': 'errorInputChanged',
      'write-session': 'errorOutputInvalid',
      'compression-failed': 'errorFailed'
    }[getPdfCompressErrorCode(error)] || 'errorFailed';
    const message = t(`home.pdfCompress.${key}`);
    return isReadablePageTooLarge(result)
      ? `${message} ${t('home.pdfCompress.pageTooLargeGuidance')}`
      : message;
  }

  function retryWithCompactClarity() {
    if (disposed || processing || !isOpenSession(session)) return;
    workflow = 'target';
    clarity = 'compact';
    if (claritySelect) claritySelect.value = clarity;
    targetSizeMb = targetSelectionMegabytes();
    syncOptions();
    hideSuccess({ focusProcess: true });
  }

  function renderSuccess(allResults) {
    if (!allResults.length) return;
    const summary = summarizePdfCompressResults(allResults);
    const outputResults = summary.savedResults;
    const count = allResults.length;
    const originalBytes = allResults.reduce((sum, result) => sum + (Number(result.originalSize) || 0), 0);
    const compressedBytes = outputResults.reduce((sum, result) => sum + (Number(result.compressedSize) || 0), 0);
    const firstName = String(allResults[0]?.name || '');
    if (successCount) successCount.textContent = String(count);
    if (successFileName) successFileName.textContent = count === 1
      ? firstName
      : t('home.pdfCompress.filesCount', { count });
    if (successOriginalSize) successOriginalSize.textContent = formatFileSize(originalBytes);
    if (successCompressedSize) successCompressedSize.textContent = outputResults.length ? formatFileSize(compressedBytes) : t('home.pdfCompress.noOutputFile');
    if (successPath) {
      const path = outputResults.length ? displayFilesystemPath(outputResults[0].outputPath) : t('home.pdfCompress.noOutputFile');
      successPath.textContent = path;
      successPath.title = path;
    }
    if (successMeta) {
      successMeta.textContent = t('home.pdfCompress.resultSummary', { count, saved: outputResults.length });
    }
    lastSavedPath = outputResults[0]?.outputPath || '';
    if (successOpenFolder) successOpenFolder.disabled = !isTauri || !outputResults.length;
    const icon = document.createElement('i');
    icon.dataset.lucide = outputResults.length === count ? 'check' : 'info';
    const iconHost = successOverlay.querySelector('.audio-convert-success-icon');
    if (iconHost) {
      iconHost.dataset.resultState = outputResults.length === count ? 'success' : 'info';
      iconHost.replaceChildren(icon);
    }
    resultList.render(allResults);
    refreshIcons();
    setInteractiveLayer(successOverlay, true);
    safeFocus(successOk || successOpenFolder);
  }

  async function processFiles(owner = session) {
    if (!files.length || processing || !isOpenSession(owner)) return;
    let targetBytes;
    try { targetBytes = selectedTargetBytes(); }
    catch (error) { showError(errorMessage(error)); return; }
    const processingMode = workflow === 'target' ? 'raster' : mode;
    const operation = beginOperation(owner);
    if (!operation) return;
    processing = true;
    setProcessing(true);
    setProgress(5);
    const snapshot = files.slice();
    const work = processor.run({
      files: snapshot,
      level,
      mode: processingMode, clarity, targetBytes, targetSizeMb,
      operation,
      onProgress: (percent, detail) => {
        if (operation.isCurrent()) setProgress(percent, detail);
      }
    });
    activePromise = work;
    let outcome = null;
    let failure = null;
    try {
      outcome = await work;
      if (!operation.isCurrent()) throw new PdfCompressCancelledError();
    } catch (error) {
      if (!operation.silent && operation.isCurrent() && !isCancellation(error)) failure = error;
    } finally {
      if (activePromise === work) activePromise = null;
      finishOperation(operation);
    }
    if (!isOpenSession(owner)) return;
    if (failure) {
      console.error('[PDF Compress] compression failed:', failure);
      showError(t('common.errorOccurred', { error: errorMessage(failure) }));
      return;
    }
    if (!outcome) {
      if (operation.cancelled && !operation.silent) {
        showToast(t('home.pdfCompress.cancelled'));
        safeFocus(processButton);
      }
      return;
    }
    results = outcome.results || [];
    outputDirectory = outcome.outputDir || '';
    if (results.length) renderSuccess(results);
    else showError(t('home.pdfCompress.errorFailed'));
  }

  async function openSavedFolder() {
    if (!isTauri) return;
    const target = lastSavedPath || outputDirectory || outputParentFolder(lastSavedPath);
    if (!target) return;
    try {
      const { invoke } = await tauriCorePromise;
      await invoke('open_path', { path: target });
    } catch (error) {
      console.error('[PDF Compress] open output folder failed:', error);
      showError(t('home.pdfCompress.errorOpenOutput'));
    }
  }

  function hideSuccess({ focusProcess = false } = {}) {
    setInteractiveLayer(successOverlay, false);
    resultList.clear();
    if (focusProcess) safeFocus(processButton);
  }

  function handleKeydown(event) {
    if (!overlay.classList.contains('visible') || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (successOverlay.classList.contains('visible')) hideSuccess({ focusProcess: true });
    else if (processing) showToast(t('home.pdfCompress.processing'));
    else void close();
  }

  function open() {
    if (disposed || isOpenSession(session)) return;
    [overlay, processMask, successOverlay].forEach(root => applyTranslations(root));
    returnFocus = document.activeElement;
    session?.dispose();
    session = createLifecycleScope();
    files = [];
    results = [];
    outputDirectory = '';
    lastSavedPath = '';
    workflow = 'regular';
    overlay.classList.add('visible');
    overlay.classList.remove('drag-over');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.inert = false;
    hideDropZone();
    hideSuccess();
    setProcessing(false);
    syncOptions();
    customSelectControls.forEach(control => control.refresh());
    renderFiles();
    levelOptions?.querySelectorAll('.audio-convert-format-option').forEach(button => {
      button.classList.toggle('active', button.dataset.level === level);
    });
    plasma = initStandardToolPlasma(background);
    void registerNativeDrop(session);
    requestAnimationFrame(() => safeFocus(isOpenSession(session) ? cta || back : null));
    if (isDemo) void loadDemoFiles(session);
  }

  async function loadDemoFiles(owner) {
    if (!isDemo || !isOpenSession(owner)) return;
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    const bytes = await pdf.save();
    if (!isOpenSession(owner)) return;
    addFiles([{
      name: 'toolknit-pdf-compress-demo.pdf',
      size: bytes.length,
      arrayBuffer: async () => bytes.slice().buffer
    }]);
  }

  async function close({ force = false, restoreFocus = true } = {}) {
    if (activeOperation && !force) {
      showToast(t('home.pdfCompress.processing'));
      return false;
    }
    const cancelPromise = activeOperation
      ? cancelOperation({ silent: true, detach: true })
      : null;
    const focusTarget = returnFocus;
    returnFocus = null;
    const owner = session;
    session = null;
    owner?.dispose();
    fileScope?.dispose();
    fileScope = null;
    files = [];
    results = [];
    outputDirectory = '';
    lastSavedPath = '';
    processing = false;
    hideDropZone();
    hideSuccess();
    customSelectControls.forEach(control => control.close());
    setProcessing(false);
    fileList.replaceChildren();
    fileList.classList.remove('has-files', 'is-reordering');
    overlay.classList.remove('visible', 'drag-over');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.inert = true;
    plasma = disposeStandardToolPlasma(plasma);
    if (restoreFocus) safeFocus(focusTarget);
    await cancelPromise;
    return true;
  }

  listen(back, 'click', () => { void close(); });
  listen(cta, 'click', () => { void chooseFiles(); });
  listen(processButton, 'click', () => { void processFiles(session); });
  listen(cancelButton, 'click', () => {
    cancelButton.disabled = true;
    if (progressText) progressText.textContent = t('home.pdfCompress.cancelling');
    void cancelOperation();
  });
  listen(processButton, 'transitionend', event => {
    if (event.propertyName === 'opacity' && !processButton.classList.contains('visible')) {
      processButton.style.display = 'none';
    }
  });
  listen(levelOptions, 'click', event => {
    const button = event.target.closest('.audio-convert-format-option');
    if (!button || processing || workflow !== 'regular' || !PDF_COMPRESS_LEVELS.has(button.dataset.level)) return;
    level = button.dataset.level;
    syncOptions();
  });
  listen(workflowOptions, 'click', event => {
    const value = event.target.closest('[data-workflow]')?.dataset.workflow;
    if (processing || !['regular', 'target'].includes(value)) return;
    workflow = value;
    targetSizeMb = workflow === 'target' ? targetSelectionMegabytes() : null;
    syncOptions();
  });
  listen(targetSize, 'change', () => {
    targetSizeMb = workflow === 'target' ? targetSelectionMegabytes() : null;
    syncOptions();
  });
  listen(modeOptions, 'click', event => {
    const value = event.target.closest('[data-mode]')?.dataset.mode;
    if (processing || !['structure', 'raster'].includes(value)
      || workflow !== 'regular') return;
    mode = value;
    syncOptions();
  });
  listen(claritySelect, 'change', () => {
    if (workflow !== 'target') return;
    clarity = claritySelect.value;
    syncOptions();
  });
  listen(targetUnit, 'change', () => {
    const value = Number(targetValue.value);
    if (Number.isFinite(value) && value > 0) targetValue.value = String(value * (unit === 'MB' ? 1024 : 1) / (targetUnit.value === 'MB' ? 1024 : 1));
    unit = targetUnit.value;
    targetValue.min = String(unit === 'KB' ? 50 : 50 / 1024);
    targetValue.max = String(unit === 'KB' ? 51200 : 50);
    syncOptions();
  });
  listen(successOk, 'click', () => hideSuccess({ focusProcess: true }));
  listen(successOpenFolder, 'click', () => { void openSavedFolder(); });
  listen(document, 'keydown', handleKeydown);
  listen(browserInput, 'change', event => {
    addFiles(event.target.files);
    event.target.value = '';
  });
  lifecycle.use(onLangChange(() => {
    renderFiles();
    customSelectControls.forEach(control => control.refresh());
    syncOptions();
    if (successOverlay.classList.contains('visible')) renderSuccess(results);
  }));
  listen(window, 'beforeunload', () => { void dispose(); }, { once: true });

  setInteractiveLayer(processMask, false);
  setInteractiveLayer(successOverlay, false);
  overlay.setAttribute('aria-hidden', 'true');
  overlay.inert = true;
  syncOptions();
  renderFiles();

  async function dispose() {
    if (disposed) return;
    const pending = activePromise;
    await close({ force: true, restoreFocus: false });
    if (pending) {
      try { await pending; } catch (_) {}
    }
    processor.dispose();
    disposed = true;
    lifecycle.dispose();
    fileScope?.dispose();
  }

  return { open, close, dispose };
}
