function safeFocus(element) {
  if (!element || element.closest?.('[inert], [aria-hidden="true"]')) return;
  try { element.focus({ preventScroll: true }); } catch (_) {}
}

function setInteractiveLayer(element, visible, visibleClass = 'visible') {
  if (!element) return;
  element.classList.toggle(visibleClass, visible);
  element.setAttribute('aria-hidden', visible ? 'false' : 'true');
  element.inert = !visible;
}

export function createPdfCropView({
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
  text
}) {
  const progressbar = processMask?.querySelector('[role="progressbar"]');
  let lastResult = null;

  function setOverlayState(visible) {
    setInteractiveLayer(overlay, visible);
  }

  function setProcessState(visible) {
    setInteractiveLayer(processMask, visible);
  }

  function setProgress(percent, label) {
    const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if (processFill) processFill.style.width = `${value}%`;
    if (processValue) processValue.textContent = `${value}%`;
    if (processText && label) processText.textContent = label;
    progressbar?.setAttribute('aria-valuenow', String(value));
  }

  function closeSuccess() {
    setInteractiveLayer(successOverlay, false);
  }

  function renderSuccess() {
    if (!lastResult) return;
    if (successMeta) {
      const key = lastResult.mode === 'current'
        ? 'home.pdfCrop.successCurrent'
        : lastResult.mode === 'zip'
          ? 'home.pdfCrop.successZip'
          : 'home.pdfCrop.successSingle';
      successMeta.textContent = text(key, {
        count: lastResult.pageCount,
        page: lastResult.exportedPageNumber
      });
    }
    if (successCount) {
      successCount.textContent = text('home.pdfCrop.outputCountValue', { count: lastResult.outputCount });
    }
    if (successPath) {
      successPath.textContent = displayFilesystemPath(lastResult.outputPath || lastResult.outputDir || '~/Downloads');
    }
    if (successOpenFolder) successOpenFolder.style.display = isTauri ? '' : 'none';
  }

  function showSuccess(result) {
    lastResult = { ...result };
    renderSuccess();
    setInteractiveLayer(successOverlay, true);
  }

  function clear() {
    lastResult = null;
    setProcessState(false);
    closeSuccess();
    setProgress(0, text('home.pdfCrop.preparingExport'));
    if (processCancel) processCancel.disabled = false;
  }

  return {
    clear,
    closeSuccess,
    focus: safeFocus,
    getLastResult: () => lastResult,
    refresh: renderSuccess,
    setOverlayState,
    setProcessState,
    setProgress,
    showSuccess
  };
}
