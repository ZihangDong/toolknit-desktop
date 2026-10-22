import { PdfEditorCancelledError } from './errors.js';

function asUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (value && typeof value.length === 'number') return Uint8Array.from(value);
  throw new Error('Invalid binary response');
}

function isPasswordError(error) {
  return error?.name === 'PasswordException'
    || /password|encrypted/i.test(String(error?.message || error || ''));
}

/**
 * Owns one PDF Editor operation at a time, including progress, cancellation,
 * stale-operation checks and platform file reads. Consumers receive callbacks
 * instead of reaching into the active operation's mutable state.
 */
export function createPdfEditorOperationRuntime({
  isTauri = false,
  t = key => key,
  getInvoke = async () => async () => {},
  processMask = null,
  processBarFill = null,
  processValue = null,
  processText = null,
  processCancel = null,
  successOverlay = null,
  exportBtn = null,
  back = null,
  isDisposed = () => false,
  focusedElement = () => null,
  restoreFocus = () => {},
  canReceiveFocus = () => true,
  syncInteractiveLayers = () => {},
  updateControls = () => {},
  isRenderCancellation = () => false
} = {}) {
  let activeOperation = null;
  let operationSequence = 0;

  function setProgress(percent, message) {
    const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if (processBarFill) processBarFill.style.width = safePercent + '%';
    if (processValue) processValue.textContent = safePercent + '%';
    if (processText && message) processText.textContent = message;
  }

  function setLocalizedProgress(percent, key, params = {}) {
    if (activeOperation) {
      activeOperation.progressKey = key;
      activeOperation.progressParams = params;
    }
    setProgress(percent, t(`home.pdfEditor.${key}`, params));
  }

  function showProcess(key, percent = 0, params = {}) {
    setLocalizedProgress(percent, key, params);
    processMask?.classList.add('visible');
    if (processCancel) {
      processCancel.disabled = false;
      processCancel.style.display = '';
    }
    syncInteractiveLayers();
    restoreFocus(processCancel);
  }

  function hideProcess() {
    processMask?.classList.remove('visible');
    if (processCancel) processCancel.disabled = false;
    setProgress(0, t('home.pdfEditor.loadingDocument'));
    syncInteractiveLayers();
  }

  function beginOperation(type) {
    if (activeOperation) throw new Error('pdf-editor:busy');
    const operation = {
      id: ++operationSequence,
      type,
      cancelled: false,
      returnFocus: focusedElement(),
      progressKey: '',
      progressParams: {}
    };
    activeOperation = operation;
    return operation;
  }

  function assertOperation(operation) {
    if (!operation || operation.cancelled || activeOperation !== operation) {
      throw new PdfEditorCancelledError();
    }
  }

  function endOperation(operation) {
    if (activeOperation !== operation) return;
    activeOperation = null;
    hideProcess();
    updateControls();
    if (!successOverlay?.classList.contains('visible')) {
      restoreFocus(canReceiveFocus(operation.returnFocus) ? operation.returnFocus : exportBtn || back);
    }
  }

  function beginCommit(operation) {
    assertOperation(operation);
    operation.committing = true;
    if (processCancel) processCancel.disabled = true;
  }

  async function cancelActiveOperation() {
    const operation = activeOperation;
    if (!operation || operation.cancelled || operation.committing) return;
    operation.cancelled = true;
    if (processCancel) processCancel.disabled = true;
    setLocalizedProgress(0, 'cancelling');
    if (operation.type === 'load') {
      try { await operation.loadingTask?.destroy(); } catch (_) {}
    }
  }

  function messageForError(error, phase) {
    if (error instanceof PdfEditorCancelledError || isRenderCancellation(error)) {
      return t(phase === 'load' ? 'home.pdfEditor.loadCancelled' : 'home.pdfEditor.cancelled');
    }
    if (isPasswordError(error)) return t('home.pdfEditor.passwordProtected');
    const detail = String(error?.message || error || '');
    if (/another (task|operation) is already in progress/i.test(detail)) {
      return t('home.pdfEditor.busy');
    }
    if (/exceeds/.test(detail)) {
      return /page/i.test(detail) ? t('home.pdfEditor.tooManyPages') : t('home.pdfEditor.fileTooLarge');
    }
    if (/required|\.pdf/i.test(detail)) return t('home.pdfEditor.pdfOnly');
    const map = {
      load: 'loadFailed',
      export: 'exportFailed',
      extract: 'extractFailed',
      append: 'appendFailed'
    };
    return t(`home.pdfEditor.${map[phase] || 'exportFailed'}`, { error: detail });
  }

  async function fileSizeFor(file) {
    if (isTauri && file.path) {
      const invoke = await getInvoke();
      return Number(await invoke('get_file_size', { path: file.path }));
    }
    return Number(file.size || 0);
  }

  async function readBytes(file) {
    if (isTauri && file.path) {
      const invoke = await getInvoke();
      return asUint8Array(await invoke('read_file_bytes', { path: file.path }));
    }
    return new Uint8Array(await file.arrayBuffer());
  }

  function getActiveOperation() {
    return activeOperation;
  }

  function clearActiveOperation() {
    activeOperation = null;
  }

  function getProgressState() {
    return {
      percent: Number.parseInt(String(processValue?.textContent || '0'), 10) || 0,
      key: activeOperation?.progressKey || '',
      params: activeOperation?.progressParams || {}
    };
  }

  return {
    setProgress,
    setLocalizedProgress,
    showProcess,
    hideProcess,
    beginOperation,
    assertOperation,
    beginCommit,
    endOperation,
    cancelActiveOperation,
    messageForError,
    fileSizeFor,
    readBytes,
    getActiveOperation,
    clearActiveOperation,
    getProgressState
  };
}
