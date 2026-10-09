import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { moveFocusOutOfHiddenRegion } from '../../shared/tool-page-shell.js';
import { getLang, onLangChange, t } from '../../i18n.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import { getPdfEnhanceErrorCode } from '../../pdf-enhance-core.js';
import { createPdfEnhanceProcessor, PdfEnhanceCancelledError } from './processor.js';
import './pdf-enhance.css';

const STRENGTHS = new Set(['light', 'medium', 'strong']);

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

function sourceName(file) {
  return String(file?.name || file?.fileName || file?.path?.split(/[\\/]/).pop() || 'document.pdf');
}

function outputFolder(path) {
  return String(path || '').replace(/[/\\][^/\\]+$/, '').replace(/\//g, '\\');
}

function errorMessage(error) {
  const messageKey = {
    'single-file-required': 'errorSingleFile',
    'input-too-large': 'errorTooLarge',
    'too-many-pages': 'errorTooManyPages',
    'page-too-large': 'errorPageTooLarge',
    'document-too-large': 'errorDocumentTooLarge',
    'output-too-large': 'errorOutputTooLarge',
    'invalid-strength': 'errorInvalidStrength',
    'invalid-pdf': 'errorInvalidPdf',
    'password-protected': 'errorPasswordProtected',
    'output-path': 'errorOutputPath',
    'enhancement-failed': 'errorFailed'
  }[getPdfEnhanceErrorCode(error)] || 'errorFailed';
  return t(`home.pdfEnhance.${messageKey}`);
}

function isCancellation(error) {
  return error instanceof PdfEnhanceCancelledError
    || /pdf-enhance:cancelled|RenderingCancelledException/i.test(String(error?.message || error || ''));
}

export function initPdfEnhanceTool({
  overlay,
  isTauri = false,
  getOutputDir,
  displayFilesystemPath,
  notify,
  refreshIcons = () => {},
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = instance => instance
} = {}) {
  if (!overlay || typeof getOutputDir !== 'function' || typeof displayFilesystemPath !== 'function') {
    if (!overlay) return { open() {}, close() {}, dispose() {} };
    throw new Error('pdf-enhance:missing-context');
  }

  const byId = id => document.getElementById(id);
  const plasmaBg = byId('pdfEnhancePlasmaBg');
  const back = byId('pdfEnhanceBack');
  const dropZone = byId('pdfEnhanceDropZone');
  const filesElement = byId('pdfEnhanceFiles');
  const cta = byId('pdfEnhanceCta');
  const processButton = byId('pdfEnhanceProcessBtn');
  const processMask = byId('pdfEnhanceProcessMask');
  const processFill = byId('pdfEnhanceProcessBarFill');
  const processText = byId('pdfEnhanceProcessText');
  const successOverlay = byId('pdfEnhanceSuccessOverlay');
  const successPath = byId('pdfEnhanceSuccessPath');
  const successMeta = byId('pdfEnhanceSuccessMeta');
  const successCount = byId('pdfEnhanceSuccessCount');
  const successOpenFolder = byId('pdfEnhanceSuccessOpenFolder');
  const successOk = byId('pdfEnhanceSuccessOk');
  const strengthHint = byId('pdfEnhanceStrengthHint');
  const strengthButtons = Array.from(overlay.querySelectorAll(
    '#pdfEnhanceStrengthOptions .audio-convert-format-option'
  ));

  if (!filesElement || !cta || !processButton || !processMask || !successOverlay) {
    return { open() {}, close() {}, dispose() {} };
  }

  const lifecycle = createLifecycleScope();
  const listen = (target, type, handler, options) => target
    ? lifecycle.event(target, type, handler, options)
    : () => {};
  let disposed = false;
  let session = null;
  let selectedFile = null;
  let strength = strengthButtons.find(button => button.classList.contains('active'))?.dataset.strength || 'light';
  let activeOperation = null;
  let activePromise = null;
  let operationSequence = 0;
  let plasmaInstance = null;
  let returnFocus = null;
  let lastResult = null;
  let buttonRevision = 0;

  const isDemo = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get('pdf-enhance-demo') === '1';
  const showToast = (message, duration = 7000) => {
    if (disposed) return;
    if (typeof notify === 'function') notify(message, { duration, dismissible: true });
    else window.showToast?.(message, { duration, dismissible: true });
  };
  const isOpenSession = owner => owner && owner === session && !owner.disposed
    && overlay.classList.contains('visible');
  const processor = createPdfEnhanceProcessor({
    isTauri,
    getOutputDir,
    onLargeDocument: () => {
      showToast(getLang() === 'zh'
        ? '检测到大文档，已自动降低渲染倍率并继续处理。'
        : 'Large document detected; rendering scale was lowered automatically and processing continues.');
    }
  });

  const browserInput = !isTauri ? document.createElement('input') : null;
  if (browserInput) {
    browserInput.type = 'file';
    browserInput.accept = '.pdf,application/pdf';
    browserInput.hidden = true;
    document.body.append(browserInput);
    lifecycle.use(() => browserInput.remove());
  }

  function setProgress(percent, key = 'processing', detail = {}) {
    const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if (processFill) processFill.style.width = `${value}%`;
    if (processText) {
      if (key === 'processing' && Number(detail.total) > 0) {
        processText.textContent = `${t('home.pdfEnhance.processing')} (${detail.current}/${detail.total})`;
      } else {
        processText.textContent = t(`home.pdfEnhance.${key}`);
      }
    }
  }

  function setProcessing(visible) {
    setInteractiveLayer(processMask, visible);
    if (!visible) setProgress(0, 'processing');
  }

  function hideDropZone() {
    dropZone?.classList.remove('visible');
    overlay.classList.remove('drag-over');
  }

  function showDropZone() {
    if (activeOperation) return;
    dropZone?.classList.add('visible');
    overlay.classList.add('drag-over');
  }

  function hideSuccess({ focusProcess = false } = {}) {
    setInteractiveLayer(successOverlay, false);
    if (focusProcess) safeFocus(processButton);
  }

  function renderSuccess() {
    if (!lastResult) return;
    if (successCount) successCount.textContent = String(lastResult.pageCount);
    if (successPath) {
      const path = displayFilesystemPath(lastResult.path);
      successPath.textContent = path;
      successPath.title = path;
    }
    if (successMeta) successMeta.textContent = t('home.pdfEnhance.successMeta');
  }

  function showSuccess(result) {
    lastResult = result;
    renderSuccess();
    setInteractiveLayer(successOverlay, true);
    safeFocus(successOk || successOpenFolder);
  }

  function renderStrength() {
    const key = `home.pdfEnhance.strength${strength.charAt(0).toUpperCase()}${strength.slice(1)}Hint`;
    strengthButtons.forEach(button => {
      button.classList.toggle('active', button.dataset.strength === strength);
    });
    if (strengthHint) {
      strengthHint.dataset.i18n = key;
      strengthHint.textContent = t(key);
    }
  }

  function updateProcessButton() {
    const revision = ++buttonRevision;
    if (selectedFile) {
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
      if (revision === buttonRevision && !selectedFile) processButton.style.display = 'none';
    };
    if (!session) {
      finish();
      return;
    }
    const release = session.event(processButton, 'transitionend', event => {
      if (event.propertyName !== 'opacity') return;
      release();
      finish();
    });
    session.timeout(() => {
      release();
      finish();
    }, 320);
  }

  function renderFiles() {
    filesElement.replaceChildren();
    filesElement.classList.toggle('has-files', Boolean(selectedFile));
    const ctaText = cta.querySelector('span');
    if (ctaText) {
      const key = selectedFile ? 'home.pdfEnhance.ctaReupload' : 'home.pdfEnhance.cta';
      ctaText.dataset.i18n = key;
      ctaText.textContent = t(key);
    }
    if (selectedFile) {
      const item = document.createElement('div');
      item.className = 'audio-convert-file-item';
      item.dataset.index = '0';
      const index = document.createElement('span');
      index.className = 'audio-convert-file-index';
      index.textContent = '1';
      const name = document.createElement('span');
      name.className = 'audio-convert-file-name';
      name.textContent = sourceName(selectedFile);
      name.title = sourceName(selectedFile);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'audio-convert-file-remove';
      remove.dataset.action = 'remove-file';
      remove.setAttribute('aria-label', 'remove');
      const icon = document.createElement('i');
      icon.dataset.lucide = 'x';
      remove.append(icon);
      item.append(index, name, remove);
      filesElement.append(item);
      refreshIcons();
    }
    updateProcessButton();
  }

  function setFileList(fileList, owner = session) {
    const files = Array.from(fileList || []);
    if (!isOpenSession(owner) || !files.length || activeOperation) return false;
    if (files.length !== 1) {
      window.alert(t('home.pdfEnhance.singleFileOnly'));
      return false;
    }
    selectedFile = files[0];
    renderFiles();
    return true;
  }

  function clearFile() {
    if (activeOperation) return;
    selectedFile = null;
    renderFiles();
  }

  async function requestFile() {
    const owner = session;
    if (!isOpenSession(owner) || activeOperation) return;
    if (!isTauri) {
      browserInput.value = '';
      browserInput.click();
      return;
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
      });
      if (!isOpenSession(owner) || typeof selected !== 'string') return;
      setFileList([{
        name: selected.split(/[\\/]/).pop() || selected,
        path: selected,
        size: 0
      }], owner);
    } catch (error) {
      if (isOpenSession(owner)) console.error('[PDF Enhance] file selection failed:', error);
    }
  }

  function beginOperation(owner) {
    if (activeOperation || !isOpenSession(owner)) return null;
    const operation = {
      id: ++operationSequence,
      owner,
      cancelled: false,
      silent: false,
      loadingTask: null,
      renderTask: null,
      writeSessionId: null,
      isCurrent: () => activeOperation === operation && isOpenSession(owner)
    };
    activeOperation = operation;
    return operation;
  }

  function cancelOperation({ silent = false, detach = false } = {}) {
    const operation = activeOperation;
    if (!operation) return;
    operation.silent ||= silent;
    processor.cancel(operation);
    if (detach && activeOperation === operation) activeOperation = null;
  }

  function finishOperation(operation) {
    if (activeOperation !== operation) return;
    activeOperation = null;
    setProcessing(false);
  }

  function downloadBrowser(result, owner) {
    const url = URL.createObjectURL(new Blob([result.bytes], { type: 'application/pdf' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = result.fileName;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    owner.timeout(() => URL.revokeObjectURL(url), 1600);
    owner.use(() => URL.revokeObjectURL(url));
  }

  async function processFile(owner = session) {
    if (!selectedFile || activeOperation || !isOpenSession(owner)) return;
    const operation = beginOperation(owner);
    if (!operation) return;
    setProcessing(true);
    setProgress(5, 'loading');
    let result = null;
    let failure = null;
    const work = processor.run({
      file: selectedFile,
      strength,
      operation,
      onProgress: (percent, key, detail) => {
        if (operation.isCurrent()) setProgress(percent, key, detail);
      }
    });
    activePromise = work;
    try {
      result = await work;
      if (!operation.isCurrent()) throw new PdfEnhanceCancelledError();
      setProgress(100, 'generating');
    } catch (error) {
      if (!operation.silent && operation.isCurrent() && !isCancellation(error)) failure = error;
    } finally {
      if (activePromise === work) activePromise = null;
      finishOperation(operation);
    }
    if (failure && isOpenSession(owner)) {
      console.error('[PDF Enhance] Error:', failure);
      window.alert(t('common.errorOccurred', { error: errorMessage(failure) }));
      return;
    }
    if (!result || operation.cancelled || !isOpenSession(owner)) return;
    if (!isTauri) downloadBrowser(result, owner);
    showSuccess({
      path: result.path,
      fileName: result.fileName,
      pageCount: result.pageCount
    });
  }

  async function openSavedFolder() {
    if (!isTauri || !lastResult?.path) return;
    try {
      const { invoke } = await tauriCorePromise;
      await invoke('open_path', { path: lastResult.path });
    } catch (error) {
      console.error('[PDF Enhance] open folder failed:', error);
    }
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
          const files = Array.from(payload.paths || [])
            .filter(path => path.toLowerCase().endsWith('.pdf'))
            .map(path => ({ name: path.split(/[\\/]/).pop() || path, path, size: 0 }));
          if (files.length) setFileList(files, owner);
        }
      });
      if (!isOpenSession(owner)) {
        unlisten();
        return;
      }
      owner.use(unlisten);
    } catch (error) {
      if (isOpenSession(owner)) console.error('[PDF Enhance] native drag-drop setup failed:', error);
    }
  }

  async function loadDemo(owner) {
    if (!isDemo || selectedFile) return;
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    [[300, 420], [420, 300]].forEach(([width, height], index) => {
      const page = pdf.addPage([width, height]);
      page.drawText(`ToolKnit PDF Enhance - Page ${index + 1}`, {
        x: 24,
        y: height - 48,
        size: 15,
        font,
        color: rgb(0.28, 0.28, 0.3)
      });
      page.drawText('Small gray text for enhancement QA.', {
        x: 24,
        y: height - 80,
        size: 10,
        font,
        color: rgb(0.58, 0.58, 0.6)
      });
    });
    const bytes = await pdf.save();
    if (!isOpenSession(owner)) return;
    setFileList([{
      name: 'toolknit-pdf-enhance-demo.pdf',
      size: bytes.length,
      arrayBuffer: async () => bytes.slice().buffer
    }], owner);
  }

  function handleKeydown(event) {
    if (!overlay.classList.contains('visible') || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (successOverlay.classList.contains('visible')) hideSuccess({ focusProcess: true });
    else if (activeOperation) showToast(t('home.pdfEnhance.processing'));
    else void close();
  }

  function open() {
    if (disposed || isOpenSession(session)) return;
    returnFocus = document.activeElement;
    session?.dispose();
    session = createLifecycleScope();
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.inert = false;
    if (plasmaBg && !plasmaInstance) plasmaInstance = initStandardToolPlasma(plasmaBg);
    hideDropZone();
    hideSuccess();
    setProcessing(false);
    renderStrength();
    renderFiles();
    void registerNativeDrop(session);
    const owner = session;
    requestAnimationFrame(() => {
      if (isOpenSession(owner)) safeFocus(selectedFile ? processButton : cta || back);
    });
    void loadDemo(owner);
  }

  async function close({ force = false, restoreFocus = true } = {}) {
    if (activeOperation && !force) {
      showToast(t('home.pdfEnhance.processing'));
      return false;
    }
    if (activeOperation) cancelOperation({ silent: true, detach: true });
    const focusTarget = returnFocus;
    returnFocus = null;
    const owner = session;
    session = null;
    owner?.dispose();
    selectedFile = null;
    lastResult = null;
    if (browserInput) browserInput.value = '';
    hideDropZone();
    hideSuccess();
    setProcessing(false);
    renderFiles();
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.inert = true;
    plasmaInstance = disposeStandardToolPlasma(plasmaInstance);
    if (restoreFocus) safeFocus(focusTarget);
    return true;
  }

  strengthButtons.forEach(button => {
    listen(button, 'click', () => {
      if (activeOperation || !STRENGTHS.has(button.dataset.strength)) return;
      strength = button.dataset.strength;
      renderStrength();
    });
  });
  listen(back, 'click', () => { void close(); });
  listen(cta, 'click', () => { void requestFile(); });
  listen(filesElement, 'click', event => {
    if (!event.target.closest('[data-action="remove-file"]')) return;
    event.stopPropagation();
    clearFile();
  });
  listen(processButton, 'click', () => { void processFile(session); });
  listen(successOk, 'click', () => hideSuccess({ focusProcess: true }));
  listen(successOpenFolder, 'click', () => { void openSavedFolder(); });
  listen(document, 'keydown', handleKeydown);
  listen(browserInput, 'change', event => {
    setFileList(event.target.files, session);
    event.target.value = '';
  });
  lifecycle.use(onLangChange(() => {
    renderStrength();
    renderFiles();
    renderSuccess();
  }) || (() => {}));
  listen(window, 'beforeunload', () => { void dispose(); }, { once: true });

  setInteractiveLayer(processMask, false);
  setInteractiveLayer(successOverlay, false);
  overlay.setAttribute('aria-hidden', 'true');
  overlay.inert = true;
  renderStrength();
  renderFiles();

  async function dispose() {
    if (disposed) return;
    const pending = activePromise;
    if (activeOperation) cancelOperation({ silent: true });
    await close({ force: true, restoreFocus: false });
    if (pending) {
      try { await pending; } catch (_) {}
    }
    processor.dispose();
    disposed = true;
    lifecycle.dispose();
  }

  return { open, close, dispose };
}
