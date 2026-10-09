import { t } from '../../i18n.js';
import { setModalInteractivity } from '../../app/modal-runtime.js';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export function createPdfToImageView({
  overlay,
  body,
  workspace,
  processMask,
  processBarFill,
  processValue,
  processText,
  processCancel,
  processProgress,
  successOverlay,
  successMeta,
  successType,
  successCount,
  successPath,
  successOpenFolder,
  successOk,
  isTauri = false,
  displayFilesystemPath,
  getActiveOperation = () => null,
  isDisposed = () => false
} = {}) {
  let successReturnFocus = null;
  let lastSuccess = null;
  let lastOutputFolder = '';
  let lastOutputPath = '';
  let disposed = false;

  function focusedElement() {
    return document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  function canReceiveFocus(target) {
    return Boolean(target?.isConnected
      && !target.disabled
      && !target.closest('[inert], [aria-hidden="true"]'));
  }

  function restoreFocus(target) {
    if (disposed || isDisposed() || !canReceiveFocus(target)) return;
    requestAnimationFrame(() => {
      if (disposed || isDisposed() || !canReceiveFocus(target)) return;
      try { target.focus({ preventScroll: true }); } catch (_) {}
    });
  }

  function focusableElements(roots) {
    const elements = [];
    const seen = new Set();
    for (const root of roots.filter(Boolean)) {
      for (const element of root.querySelectorAll(FOCUSABLE_SELECTOR)) {
        if (!(element instanceof HTMLElement) || seen.has(element)) continue;
        if (element.hidden || element.closest('[inert], [aria-hidden="true"]')) continue;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        seen.add(element);
        elements.push(element);
      }
    }
    return elements;
  }

  function trapFocus(event, roots) {
    if (event.key !== 'Tab') return;
    const elements = focusableElements(roots);
    if (!elements.length) {
      event.preventDefault();
      return;
    }
    const first = elements[0];
    const last = elements[elements.length - 1];
    const active = focusedElement();
    if (!elements.includes(active)) {
      event.preventDefault();
      restoreFocus(event.shiftKey ? last : first);
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      restoreFocus(last);
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      restoreFocus(first);
    }
  }

  function syncInteractiveLayers() {
    const overlayVisible = overlay.classList.contains('visible');
    const workspaceVisible = workspace.classList.contains('visible');
    const processVisible = processMask?.classList.contains('visible') || false;
    const successVisible = successOverlay?.classList.contains('visible') || false;
    const modalVisible = processVisible || successVisible;
    const processInteractive = processVisible && !successVisible;

    setModalInteractivity(overlay, overlayVisible && !workspaceVisible && !modalVisible);
    if (body) body.inert = workspaceVisible;
    setModalInteractivity(workspace, workspaceVisible && !modalVisible);
    if (processMask) {
      setModalInteractivity(processMask, processInteractive);
    }
    if (successOverlay) {
      setModalInteractivity(successOverlay, successVisible);
    }
  }

  function syncProgressLabel() {
    if (!processProgress) return;
    const key = getActiveOperation()?.type === 'load'
      ? 'home.pdfToImageTool.loadProgressLabel'
      : 'home.pdfToImageTool.exportProgressLabel';
    processProgress.setAttribute('aria-label', t(key));
  }

  function setProgress(percent, message) {
    const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if (processBarFill) processBarFill.style.width = safePercent + '%';
    if (processValue) processValue.textContent = safePercent + '%';
    if (processText && message) processText.textContent = message;
    if (processProgress) processProgress.setAttribute('aria-valuenow', String(safePercent));
  }

  function setLocalizedProgress(percent, key, params = {}) {
    const operation = getActiveOperation();
    if (operation) {
      operation.progressKey = key;
      operation.progressParams = params;
    }
    setProgress(percent, t(`home.pdfToImageTool.${key}`, params));
  }

  function showProcess(key, percent = 0, params = {}) {
    setLocalizedProgress(percent, key, params);
    processMask?.classList.add('visible');
    if (processCancel) {
      processCancel.disabled = false;
      processCancel.style.display = '';
    }
    syncProgressLabel();
    syncInteractiveLayers();
    restoreFocus(processCancel);
  }

  function hideProcess() {
    processMask?.classList.remove('visible');
    if (processCancel) processCancel.disabled = false;
    setProgress(0, t('home.pdfToImageTool.preparing'));
    syncInteractiveLayers();
  }

  function renderSuccess() {
    if (!lastSuccess) return;
    const { result, mode, limitedCount } = lastSuccess;
    if (successMeta) {
      const base = t(
        mode === 'grid'
          ? 'home.pdfToImageTool.successGridMeta'
          : ['long', 'long-horizontal'].includes(mode)
            ? 'home.pdfToImageTool.successLongImagesMeta'
          : 'home.pdfToImageTool.successImagesMeta'
      );
      successMeta.textContent = limitedCount > 0
        ? base + ' ' + t('home.pdfToImageTool.safeLimitApplied', { count: limitedCount })
        : base;
    }
    if (successType) {
      successType.textContent = t(
        mode === 'grid'
          ? 'home.pdfToImageTool.successTypeGrid'
          : ['long', 'long-horizontal'].includes(mode)
            ? 'home.pdfToImageTool.successTypeLongImages'
          : 'home.pdfToImageTool.successTypeImages'
      );
    }
    if (successCount) successCount.textContent = String(result.outputCount || result.outputs?.length || 0);
    if (successPath) successPath.textContent = displayFilesystemPath(result.outputDir || '~/Downloads');
    // Keep the action visible in browser previews as well. The click handler
    // still guards the native-only folder operation, matching the PDF rotate
    // success dialog and keeping both result surfaces structurally identical.
    if (successOpenFolder) successOpenFolder.style.display = '';
  }

  function closeSuccess(restore = true) {
    if (!successOverlay?.classList.contains('visible')) return;
    successOverlay.classList.remove('visible');
    syncInteractiveLayers();
    const returnFocus = successReturnFocus;
    successReturnFocus = null;
    if (restore) restoreFocus(returnFocus);
  }

  function showSuccess(result, mode, limitedCount, returnFocus) {
    lastOutputFolder = result.outputDir || '';
    lastOutputPath = result.outputPath
      || result.output_path
      || result.outputs?.[0]?.outputPath
      || result.outputs?.[0]?.output_path
      || '';
    lastSuccess = { result, mode, limitedCount };
    successReturnFocus = returnFocus || focusedElement();
    renderSuccess();
    successOverlay?.classList.add('visible');
    syncInteractiveLayers();
    restoreFocus(successOk || successOpenFolder);
  }

  function refresh() {
    syncProgressLabel();
    const operation = getActiveOperation();
    if (operation?.progressKey && processMask?.classList.contains('visible')) {
      setProgress(
        Number(processProgress?.getAttribute('aria-valuenow') || 0),
        t(`home.pdfToImageTool.${operation.progressKey}`, operation.progressParams)
      );
    }
    if (lastSuccess && successOverlay?.classList.contains('visible')) renderSuccess();
  }

  function clear() {
    successOverlay?.classList.remove('visible');
    processMask?.classList.remove('visible');
    successReturnFocus = null;
    lastSuccess = null;
    lastOutputFolder = '';
    lastOutputPath = '';
    syncInteractiveLayers();
  }

  function dispose() {
    if (disposed) return;
    clear();
    disposed = true;
  }

  return {
    canReceiveFocus,
    clear,
    closeSuccess,
    dispose,
    focusedElement,
    getLastOutputFolder: () => lastOutputFolder,
    getLastOutputPath: () => lastOutputPath,
    hasSuccess: () => Boolean(lastSuccess),
    hideProcess,
    refresh,
    renderSuccess,
    restoreFocus,
    setLocalizedProgress,
    setProgress,
    showProcess,
    showSuccess,
    syncInteractiveLayers,
    syncProgressLabel,
    trapFocus
  };
}
