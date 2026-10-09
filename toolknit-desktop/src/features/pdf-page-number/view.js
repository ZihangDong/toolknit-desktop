import { t } from '../../i18n.js';

export function safeFocus(element, isDisposed = () => false) {
  if (isDisposed() || !element?.isConnected || element.closest('[inert], [aria-hidden="true"]')) return;
  requestAnimationFrame(() => {
    if (isDisposed() || !element?.isConnected || element.closest('[inert], [aria-hidden="true"]')) return;
    try { element.focus({ preventScroll: true }); } catch (_) {}
  });
}

export function createPdfPageNumberView({
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
  isTauri = false,
  isDisposed = () => false,
  text = t
} = {}) {
  let lastResult = null;

  function syncLayers() {
    const overlayVisible = overlay?.classList.contains('visible') || false;
    const processVisible = processMask?.classList.contains('visible') || false;
    const successVisible = successOverlay?.classList.contains('visible') || false;
    const modalVisible = processVisible || successVisible;
    if (overlay) {
      overlay.inert = !overlayVisible || modalVisible;
      overlay.setAttribute('aria-hidden', String(!overlayVisible || modalVisible));
    }
    if (processMask) {
      processMask.inert = !processVisible || successVisible;
      processMask.setAttribute('aria-hidden', String(!processVisible || successVisible));
    }
    if (successOverlay) {
      successOverlay.inert = !successVisible;
      successOverlay.setAttribute('aria-hidden', String(!successVisible));
    }
  }

  function setOverlayState(visible) {
    overlay?.classList.toggle('visible', visible);
    syncLayers();
  }

  function setSuccessState(visible) {
    successOverlay?.classList.toggle('visible', visible);
    syncLayers();
  }

  function setProcessState(visible) {
    processMask?.classList.toggle('visible', visible);
    if (!visible && processCancel) processCancel.disabled = false;
    syncLayers();
  }

  function setProgress(percent, label) {
    const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if (processFill) processFill.style.width = `${value}%`;
    if (processValue) processValue.textContent = `${value}%`;
    if (processText && label) processText.textContent = label;
    processMask?.querySelector('[role="progressbar"]')?.setAttribute('aria-valuenow', String(value));
  }

  function renderSuccess() {
    if (!lastResult) return;
    if (successMeta) {
      successMeta.textContent = text(lastResult.mode === 'zip'
        ? 'home.pdfPageNumber.successZipMeta'
        : 'home.pdfPageNumber.successPdfMeta');
    }
    if (successCount) {
      successCount.textContent = text('home.pdfPageNumber.outputCountValue', { count: lastResult.count });
    }
    if (successPath) {
      successPath.textContent = displayFilesystemPath(lastResult.outputPath || lastResult.outputDir || '~/Downloads');
    }
    if (successOpenFolder) successOpenFolder.style.display = isTauri ? '' : 'none';
  }

  function showSuccess(result) {
    lastResult = result;
    renderSuccess();
    setSuccessState(true);
  }

  function clear() {
    lastResult = null;
    processMask?.classList.remove('visible');
    successOverlay?.classList.remove('visible');
    setProgress(0, text('home.pdfPageNumber.preparingExport'));
    syncLayers();
  }

  syncLayers();

  return {
    clear,
    closeSuccess: () => setSuccessState(false),
    getLastResult: () => lastResult,
    refresh() {
      if (lastResult && successOverlay?.classList.contains('visible')) renderSuccess();
    },
    renderSuccess,
    setOverlayState,
    setProcessState,
    setProgress,
    setSuccessState,
    showSuccess,
    syncLayers,
    focus: element => safeFocus(element, isDisposed)
  };
}
