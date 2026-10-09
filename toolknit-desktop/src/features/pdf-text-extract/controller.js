import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { applyTranslations, onLangChange, t } from '../../i18n.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { extractPdfRules } from './table-grid.js';
import { loadTauriDialog, loadTauriWebview, tauriCorePromise } from '../../platform/tauri-runtime.js';
import { bindToolPageChrome, moveFocusOutOfHiddenRegion } from '../../shared/tool-page-shell.js';
import { destroyPdfDocument, pdfjsDocumentOptions } from '../../shared/pdfjs-options.js';
import { createPdfTextResultPreview } from './result-preview.js';
import {
  PDF_TEXT_LIMITS,
  PdfTextExtractionCancelledError,
  convertPdfPagesToMarkdown,
  isPdfTextCancellation,
  normalizePdfTextError,
  reconstructPdfPage
} from './core.js';

const ERROR_KEYS = Object.freeze({
  'unsupported-file': 'unsupportedFile',
  'file-too-large': 'fileTooLarge',
  'password-protected': 'passwordProtected',
  'invalid-pdf': 'invalidPdf',
  'read-failed': 'readFailed',
  'document-too-large': 'documentTooLarge'
});

function sourceName(file) {
  return String(file?.name || file?.fileName || file?.path?.split(/[\\/]/).pop() || 'document.pdf');
}

function normalizeBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value);
  return new Uint8Array();
}

function bytesToSize(bytes, formatFileSize) {
  if (typeof formatFileSize === 'function') return formatFileSize(bytes);
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function isPdfFile(file) {
  return /\.pdf$/i.test(sourceName(file)) || String(file?.type || '').toLowerCase() === 'application/pdf';
}

function errorWithCode(code) {
  const error = new Error(`pdf-text-extract:${code}`);
  error.code = code;
  return error;
}

function setLayerVisibility(element, visible) {
  if (!element) return;
  if (!visible) moveFocusOutOfHiddenRegion(element);
  element.hidden = !visible;
  element.classList.toggle('visible', visible);
  element.setAttribute('aria-hidden', visible ? 'false' : 'true');
  element.inert = !visible;
}

export function createPdfTextMarkdownController({
  overlay,
  isTauri = false,
  notify = message => window.showToast?.(message),
  openLazyTool = null,
  refreshIcons = () => {},
  formatFileSize,
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = () => {}
} = {}) {
  if (!overlay) throw new Error('pdf-text-extract:missing-overlay');

  const query = selector => overlay.querySelector(selector);
  const shell = query('.tool-page-v2-topbar');
  const back = query('#pdfTextExtractBack');
  const cta = query('#pdfTextExtractCta');
  const fileInput = query('#pdfTextExtractFileInput');
  const dropZone = query('#pdfTextExtractDropZone');
  const fileCard = query('#pdfTextExtractFileCard');
  const fileName = query('#pdfTextExtractFileName');
  const fileSize = query('#pdfTextExtractFileSize');
  const pageCount = query('#pdfTextExtractPageCount');
  const textLayer = query('#pdfTextExtractTextLayer');
  const removeFile = query('#pdfTextExtractRemove');
  const statusTitle = query('#pdfTextExtractStatusTitle');
  const statusBadge = query('#pdfTextExtractStatusBadge');
  const statusMessage = query('#pdfTextExtractStatusMessage');
  const progressWrap = query('#pdfTextExtractProgressWrap');
  const progressFill = query('#pdfTextExtractProgressFill');
  const progressText = query('#pdfTextExtractProgressText');
  const progressChars = query('#pdfTextExtractProgressChars');
  const processedPages = query('#pdfTextExtractProcessedPages');
  const extractedChars = query('#pdfTextExtractCharCount');
  const sourceType = query('#pdfTextExtractSourceType');
  const warning = query('#pdfTextExtractWarning');
  const warningText = query('#pdfTextExtractWarningText');
  const resultPanel = query('#pdfTextExtractResult');
  const resultSummary = query('#pdfTextExtractResultSummary');
  const resetButton = query('#pdfTextExtractReset');
  const importButton = query('#pdfTextExtractImport');
  const processButton = query('#pdfTextExtractProcess');
  const processIcon = query('#pdfTextExtractProcessIcon');
  const cancelIcon = query('#pdfTextExtractCancelIcon');
  const processLabel = query('#pdfTextExtractProcessLabel');

  const lifecycle = createLifecycleScope();
  const resultPreview = createPdfTextResultPreview({ root: overlay, lifecycle, localize });
  let session = null;
  let disposed = false;
  let selectedFile = null;
  let selectedBytes = null;
  let pdfDocument = null;
  let loadingTask = null;
  let operation = null;
  let result = null;
  let state = 'empty';
  let statusMessageKey = 'emptyDesc';
  let statusMessageVars = {};
  let warningMessageKey = '';
  let warningMessageVars = {};
  let progressSnapshot = { current: 0, total: 0, chars: 0 };
  let revision = 0;
  let returnFocus = null;

  const statusKeys = {
    empty: ['emptyTitle', 'emptyBadge', 'emptyDesc'],
    loading: ['loadingTitle', 'loadingBadge', 'loadingDesc'],
    selected: ['selectedTitle', 'selectedBadge', 'selectedDesc'],
    processing: ['processingTitle', 'processingBadge', 'processingDesc'],
    success: ['successStatusTitle', 'successBadge', 'successStatusDesc'],
    partial: ['partialTitle', 'partialBadge', 'partialDesc'],
    noText: ['noTextTitle', 'noTextBadge', 'noTextDesc'],
    error: ['errorTitle', 'errorBadge', 'errorDesc']
  };

  const isOpen = owner => owner && owner === session && !owner.disposed
    && overlay.classList.contains('visible') && !disposed;

  function localize(key, vars = {}) {
    return t(`home.pdfTextMarkdown.${key}`, vars);
  }

  function showToast(message, duration = 7000) {
    if (disposed) return;
    notify?.(message, { duration, dismissible: true });
  }

  function renderState() {
    overlay.dataset.state = state;
    overlay.dataset.hasFile = String(Boolean(selectedFile));
    const keys = statusKeys[state] || statusKeys.empty;
    if (statusTitle) statusTitle.textContent = localize(keys[0]);
    if (statusBadge) {
      statusBadge.textContent = localize(keys[1]);
      statusBadge.dataset.state = state;
    }
    if (statusMessage) statusMessage.textContent = localize(statusMessageKey || keys[2], statusMessageVars);
  }

  function setState(nextState, messageKey = null, vars = {}) {
    state = nextState;
    const keys = statusKeys[nextState] || statusKeys.empty;
    statusMessageKey = messageKey || keys[2];
    statusMessageVars = { ...vars };
    renderState();
  }

  function setDropVisible(visible) {
    dropZone?.classList.toggle('visible', visible);
    overlay.classList.toggle('drag-over', visible);
  }

  function setProgress(current, total, chars = 0) {
    const safeTotal = Math.max(0, Number(total) || 0);
    const safeCurrent = Math.max(0, Math.min(safeTotal || current, Number(current) || 0));
    const safeChars = Math.max(0, Number(chars) || 0);
    progressSnapshot = { current: safeCurrent, total: safeTotal, chars: safeChars };
    const percent = safeTotal ? Math.round((safeCurrent / safeTotal) * 100) : 0;
    progressFill?.style.setProperty('width', `${percent}%`);
    if (progressText) progressText.textContent = safeTotal
      ? localize('progressText', { current: safeCurrent, total: safeTotal })
      : localize('progressPreparing');
    if (progressChars) progressChars.textContent = localize('charsValue', { count: safeChars.toLocaleString() });
    if (processedPages) processedPages.textContent = `${safeCurrent} / ${safeTotal || 0}`;
    if (extractedChars) extractedChars.textContent = safeChars.toLocaleString();
  }

  function renderWarning() {
    if (!warning || !warningText) return;
    const visible = Boolean(warningMessageKey);
    warning.hidden = !visible;
    warning.classList.toggle('is-visible', visible);
    warningText.textContent = visible ? localize(warningMessageKey, warningMessageVars) : '';
  }

  function setWarning(messageKey = '', vars = {}) {
    warningMessageKey = messageKey;
    warningMessageVars = { ...vars };
    renderWarning();
  }

  function renderSourceInfo() {
    let textLayerKey = 'sourcePending';
    let sourceTypeKey = 'sourcePending';
    if (result?.status === 'no-text') {
      textLayerKey = 'sourceScanned';
      sourceTypeKey = 'sourceScanned';
    } else if (result?.pagesWithText > 0) {
      const allText = result.pagesWithText === result.pageCount && result.pageCount > 0;
      textLayerKey = allText ? 'sourceAvailable' : 'sourcePartial';
      sourceTypeKey = allText ? 'sourceElectronic' : 'sourcePartial';
    }
    if (textLayer) textLayer.textContent = localize(textLayerKey);
    if (sourceType) sourceType.textContent = localize(sourceTypeKey);
  }

  function renderFile() {
    const visible = Boolean(selectedFile);
    if (fileCard) fileCard.hidden = !visible;
    if (!visible) {
      if (fileName) fileName.textContent = '';
      if (fileSize) fileSize.textContent = '';
      if (pageCount) pageCount.textContent = '-';
      if (textLayer) textLayer.textContent = localize('sourcePending');
      return;
    }
    const name = sourceName(selectedFile);
    if (fileName) {
      fileName.textContent = name;
      fileName.title = name;
    }
    if (fileSize) fileSize.textContent = bytesToSize(selectedFile.size || selectedBytes?.byteLength, formatFileSize);
    if (pageCount) pageCount.textContent = pdfDocument?.numPages ? String(pdfDocument.numPages) : localize('pagePending');
  }

  function renderResult() {
    const visible = Boolean(result?.markdown && (state === 'success' || state === 'partial'));
    if (resultPanel) resultPanel.hidden = !visible;
    resultPreview.render(visible ? result : null);
    if (!visible) {
      if (resultSummary) resultSummary.textContent = '';
      return;
    }
    if (resultSummary) {
      resultSummary.textContent = localize('resultSummary', {
        pages: result.pagesWithText,
        total: result.pageCount,
        chars: result.chars.toLocaleString(),
        warning: result.warnings.length
          ? localize('resultWarningSuffix', { count: result.warnings.length })
          : ''
      });
    }
  }

  function renderControls() {
    const busy = Boolean(operation);
    const cancelling = Boolean(operation?.cancelled);
    const canProcess = Boolean(pdfDocument && selectedBytes && !operation && (state === 'selected' || state === 'error'));
    if (processButton) {
      processButton.disabled = busy ? cancelling : !canProcess;
      processButton.classList.toggle('is-cancel', busy);
    }
    processIcon?.toggleAttribute('hidden', busy);
    cancelIcon?.toggleAttribute('hidden', !busy);
    if (processLabel) processLabel.textContent = localize(busy ? (cancelling ? 'cancellingButton' : 'cancel') : 'process');
    if (cta) cta.disabled = busy;
    if (removeFile) removeFile.disabled = busy;
    if (resetButton) resetButton.disabled = busy;
    if (importButton) importButton.disabled = !result?.markdown || !['success', 'partial'].includes(state);
  }

  function render() {
    applyTranslations(overlay);
    renderState();
    renderFile();
    renderSourceInfo();
    renderResult();
    renderWarning();
    renderControls();
    refreshIcons?.();
  }

  async function destroyDocument() {
    const task = loadingTask;
    loadingTask = null;
    const documentHandle = pdfDocument;
    pdfDocument = null;
    try { await task?.destroy?.(); } catch (_) {}
    if (documentHandle) {
      try { await destroyPdfDocument(documentHandle); } catch (_) {}
    }
  }

  async function clearDocument({ keepFile = false } = {}) {
    revision += 1;
    if (operation) operation.cancelled = true;
    operation = null;
    await destroyDocument();
    selectedBytes = null;
    if (!keepFile) selectedFile = null;
  }

  async function readFileBytes(file) {
    if (!isPdfFile(file)) throw errorWithCode('unsupported-file');
    const declaredSize = Number(file?.size) || 0;
    if (declaredSize > PDF_TEXT_LIMITS.maxDocumentBytes) throw errorWithCode('file-too-large');
    let bytes;
    if (isTauri && file?.path) {
      const { invoke } = await tauriCorePromise;
      bytes = normalizeBytes(await invoke('read_file_bytes_limited', {
        path: file.path,
        maxBytes: PDF_TEXT_LIMITS.maxDocumentBytes
      }));
    } else if (typeof file?.arrayBuffer === 'function') {
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      throw errorWithCode('read-failed');
    }
    if (!bytes.length) throw errorWithCode('read-failed');
    if (bytes.byteLength > PDF_TEXT_LIMITS.maxDocumentBytes) throw errorWithCode('file-too-large');
    return bytes;
  }

  async function loadPdf(bytes, owner, requestRevision) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (!isOpen(owner) || requestRevision !== revision) throw new PdfTextExtractionCancelledError();
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    let passwordRequested = false;
    const task = pdfjs.getDocument(pdfjsDocumentOptions({ data: bytes.slice() }));
    loadingTask = task;
    task.onPassword = () => {
      passwordRequested = true;
      // Stop immediately instead of feeding PDF.js an empty password, which
      // would trigger the password callback repeatedly and leave the UI busy.
      void task.destroy();
    };
    try {
      const documentHandle = await task.promise;
      if (passwordRequested || !isOpen(owner) || requestRevision !== revision) {
        await destroyPdfDocument(documentHandle);
        throw passwordRequested ? errorWithCode('password-protected') : new PdfTextExtractionCancelledError();
      }
      pdfDocument = documentHandle;
      return documentHandle;
    } catch (error) {
      if (passwordRequested) throw errorWithCode('password-protected');
      throw error;
    } finally {
      if (loadingTask === task) loadingTask = null;
    }
  }

  async function inspectFile(file, owner = session) {
    if (!isOpen(owner) || operation) return false;
    await clearDocument();
    result = null;
    selectedFile = { name: sourceName(file), path: file?.path || '', size: Number(file?.size) || 0 };
    renderFile();
    renderSourceInfo();
    renderResult();
    setState('loading');
    progressWrap && (progressWrap.hidden = false);
    setProgress(0, 0, 0);
    setWarning('');
    const requestRevision = revision;
    try {
      selectedBytes = await readFileBytes(file);
      if (!isOpen(owner) || requestRevision !== revision) return false;
      selectedFile.size = selectedBytes.byteLength;
      renderFile();
      const documentHandle = await loadPdf(selectedBytes, owner, requestRevision);
      if (documentHandle.numPages > PDF_TEXT_LIMITS.maxPages) throw errorWithCode('document-too-large');
      pageCount && (pageCount.textContent = String(documentHandle.numPages));
      textLayer && (textLayer.textContent = localize('sourcePending'));
      sourceType && (sourceType.textContent = localize('sourcePending'));
      setProgress(0, documentHandle.numPages, 0);
      setState('selected');
      renderControls();
      return true;
    } catch (error) {
      if (!isOpen(owner) || requestRevision !== revision || isPdfTextCancellation(error)) return false;
      await destroyDocument();
      selectedBytes = null;
      const normalized = error.code ? { code: error.code } : normalizePdfTextError(error);
      const key = ERROR_KEYS[normalized.code] || 'readFailed';
      setState('error', key);
      setWarning(key);
      renderSourceInfo();
      renderControls();
      return false;
    }
  }

  function assertCurrent(active, owner, requestRevision) {
    if (!active || active.cancelled || operation !== active || !isOpen(owner) || requestRevision !== revision) {
      throw new PdfTextExtractionCancelledError();
    }
  }

  async function extract(owner = session) {
    if (!pdfDocument || !selectedBytes || operation || !isOpen(owner)) return false;
    const active = { owner, cancelled: false, id: revision + 1 };
    operation = active;
    const requestRevision = revision;
    const pages = [];
    let chars = 0;
    setWarning('');
    setState('processing');
    progressWrap && (progressWrap.hidden = false);
    setProgress(0, pdfDocument.numPages, 0);
    renderControls();
    try {
      const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        assertCurrent(active, owner, requestRevision);
        let page = null;
        try {
          page = await pdfDocument.getPage(pageNumber);
          const viewport = page.getViewport?.({ scale: 1 }) || {};
          const content = await page.getTextContent();
          assertCurrent(active, owner, requestRevision);
          let rules = [];
          try { rules = extractPdfRules(await page.getOperatorList(), OPS); } catch (_) {
            // Text extraction remains available when a page has unsupported drawing operators.
          }
          assertCurrent(active, owner, requestRevision);
          const pageResult = reconstructPdfPage(content?.items || [], {
            pageNumber,
            pageWidth: viewport.width,
            pageHeight: viewport.height,
            rules
          });
          pages.push(pageResult);
          chars += pageResult.chars;
        } catch (error) {
          if (isPdfTextCancellation(error)) throw error;
          pages.push({ pageNumber, error: normalizePdfTextError(error), lines: [], text: '', chars: 0, hasText: false });
        } finally {
          try { page?.cleanup?.(); } catch (_) {}
        }
        setProgress(pageNumber, pdfDocument.numPages, chars);
        if (chars > PDF_TEXT_LIMITS.maxCharacters) throw errorWithCode('document-too-large');
      }
      assertCurrent(active, owner, requestRevision);
      result = { ...convertPdfPagesToMarkdown(pages, { sourceName: sourceName(selectedFile) }), sourceName: sourceName(selectedFile), pages };
      const partial = result.status === 'partial';
      if (result.status === 'no-text') {
        setState('noText');
        setWarning('noTextWarning');
      } else {
        setState(partial ? 'partial' : 'success');
        if (partial) setWarning('partialWarning', { empty: result.emptyPages.length, failed: result.failedPages.length });
      }
      renderSourceInfo();
      renderResult();
      return true;
    } catch (error) {
      if (isPdfTextCancellation(error) && isOpen(owner) && requestRevision === revision) {
        result = null;
        setState('selected', 'cancelledDesc');
        setWarning('');
        renderSourceInfo();
        renderResult();
      } else if (isOpen(owner) && requestRevision === revision) {
        result = null;
        const normalized = error.code ? { code: error.code } : normalizePdfTextError(error);
        const key = ERROR_KEYS[normalized.code] || 'readFailed';
        setState('error', key);
        setWarning(key);
        renderSourceInfo();
        renderResult();
      }
      return false;
    } finally {
      if (operation === active) operation = null;
      renderControls();
    }
  }

  function cancelExtraction() {
    if (!operation || operation.cancelled) return false;
    operation.cancelled = true;
    setState('processing', 'cancelling');
    renderControls();
    showToast(localize('cancelling'));
    return true;
  }

  async function requestFile() {
    if (!isOpen(session) || operation) return;
    if (!isTauri) {
      fileInput?.click();
      return;
    }
    try {
      const { open } = await loadTauriDialog();
      const selected = await open({ multiple: false, filters: [{ name: 'PDF Files', extensions: ['pdf'] }] });
      if (typeof selected === 'string') await inspectFile({ name: sourceName({ path: selected }), path: selected, size: 0 });
    } catch (error) {
      if (isOpen(session)) setWarning('readFailed');
    }
  }

  async function importMarkdown() {
    if (!result?.markdown || !['success', 'partial'].includes(state)) return false;
    if (typeof openLazyTool !== 'function') {
      showToast(localize('importUnavailable'));
      return false;
    }
    const markdown = result.markdown;
    const source = result.sourceName;
    try {
      const editorInstance = await openLazyTool('markdown-editor');
      const importer = editorInstance?.raw?.importMarkdown || editorInstance?.importMarkdown;
      if (typeof importer !== 'function' || !importer(markdown, source)) {
        showToast(localize('importUnavailable'));
        return false;
      }
      return true;
    } catch (error) {
      showToast(localize('importUnavailable'));
      return false;
    }
  }

  async function reset() {
    if (!session || operation) return;
    await clearDocument();
    result = null;
    setState('empty');
    if (fileInput) fileInput.value = '';
    progressWrap && (progressWrap.hidden = true);
    setProgress(0, 0, 0);
    setWarning('');
    render();
    cta?.focus({ preventScroll: true });
  }

  async function close({ restoreFocus = true } = {}) {
    resultPreview.render(null);
    const focusTarget = returnFocus;
    returnFocus = null;
    if (operation) operation.cancelled = true;
    await clearDocument();
    session?.dispose();
    session = null;
    result = null;
    selectedFile = null;
    if (fileInput) fileInput.value = '';
    setDropVisible(false);
    progressWrap && (progressWrap.hidden = true);
    setWarning('');
    setLayerVisibility(overlay, false);
    if (restoreFocus && focusTarget?.focus) {
      try { focusTarget.focus({ preventScroll: true }); } catch (_) {}
    }
    return true;
  }

  function handleDragEnter() {
    if (!operation && isOpen(session)) setDropVisible(true);
  }

  function handleDrop(event) {
    event.preventDefault();
    if (isTauri || operation || !isOpen(session)) return;
    setDropVisible(false);
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length !== 1) {
      showToast(localize('singleFileOnly'));
      return;
    }
    void inspectFile(files[0]);
  }

  async function registerNativeDrop(owner) {
    if (!isTauri || !isOpen(owner)) return;
    try {
      const { getCurrentWebview } = await loadTauriWebview();
      if (!isOpen(owner)) return;
      const unlisten = await getCurrentWebview().onDragDropEvent(event => {
        if (!isOpen(owner) || operation) return;
        const payload = event.payload || {};
        if (payload.type === 'enter' || payload.type === 'over') setDropVisible(true);
        else if (payload.type === 'leave') setDropVisible(false);
        else if (payload.type === 'drop') {
          setDropVisible(false);
          const paths = Array.from(payload.paths || []);
          const pdfPaths = paths.filter(value => /\.pdf$/i.test(value));
          if (paths.length !== 1 || pdfPaths.length !== 1) {
            showToast(localize(paths.length > 1 ? 'singleFileOnly' : 'unsupportedFile'));
            return;
          }
          const [path] = pdfPaths;
          void inspectFile({ name: sourceName({ path }), path, size: 0 }, owner);
        }
      });
      owner.use(unlisten);
    } catch (_) {
      // Native drag/drop is an enhancement; the platform file dialog remains available.
    }
  }

  const releaseLanguage = onLangChange(() => {
    if (disposed) return;
    applyTranslations(overlay);
    renderState();
    renderFile();
    renderSourceInfo();
    renderResult();
    renderWarning();
    setProgress(progressSnapshot.current, progressSnapshot.total, progressSnapshot.chars);
    renderControls();
  });
  lifecycle.use(releaseLanguage);
  lifecycle.use(bindToolPageChrome(shell, () => { void close(); }));
  lifecycle.event(cta, 'click', () => { void requestFile(); });
  lifecycle.event(back, 'click', event => { event.preventDefault(); void close(); });
  lifecycle.event(removeFile, 'click', () => { void reset(); });
  lifecycle.event(resetButton, 'click', () => { void reset(); });
  lifecycle.event(processButton, 'click', () => {
    if (!cancelExtraction()) void extract();
  });
  lifecycle.event(importButton, 'click', () => { void importMarkdown(); });
  lifecycle.event(fileInput, 'change', event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void inspectFile(file);
  });
  lifecycle.event(overlay, 'dragenter', event => { event.preventDefault(); handleDragEnter(); });
  lifecycle.event(overlay, 'dragover', event => { event.preventDefault(); handleDragEnter(); });
  lifecycle.event(overlay, 'dragleave', event => {
    if (!event.relatedTarget || !overlay.contains(event.relatedTarget)) setDropVisible(false);
  });
  lifecycle.event(overlay, 'drop', handleDrop);
  lifecycle.event(document, 'keydown', event => {
    if (event.key !== 'Escape' || !isOpen(session)) return;
    event.preventDefault();
    if (operation) {
      cancelExtraction();
    } else {
      void close();
    }
  });

  function open() {
    if (disposed || session) return;
    returnFocus = document.activeElement;
    session = createLifecycleScope();
    setLayerVisibility(overlay, true);
    const background = initStandardToolPlasma(query('.pdf-merge-v2-bg'));
    session.use(() => disposeStandardToolPlasma(background));
    result = null;
    selectedFile = null;
    selectedBytes = null;
    setState('empty');
    setWarning('');
    setProgress(0, 0, 0);
    progressWrap && (progressWrap.hidden = true);
    render();
    void registerNativeDrop(session);
    requestAnimationFrame(() => { if (isOpen(session)) cta?.focus({ preventScroll: true }); });
  }

  async function dispose() {
    if (disposed) return;
    await close({ restoreFocus: false });
    disposed = true;
    lifecycle.dispose();
  }

  setLayerVisibility(overlay, false);
  render();
  return { open, close, dispose, importMarkdown };
}
