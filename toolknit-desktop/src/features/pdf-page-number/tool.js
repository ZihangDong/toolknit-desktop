import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { pdfjsDocumentOptions, destroyPdfDocument } from '../../shared/pdfjs-options.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { onLangChange, t } from '../../i18n.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import { enhanceToolSelects } from '../../tool-custom-select.js';
import {
  PDF_PAGE_NUMBER_DEFAULTS,
  PDF_PAGE_NUMBER_LIMITS,
  PdfPageNumberCancelledError,
  assertPdfPageNumberPageCount,
  assertPdfPageNumberSelection,
  buildPdfPageNumberPlan,
  normalizePdfPageNumberSettings,
  sanitizePdfPageNumberBaseName
} from '../../pdf-page-number-core.js';
import { createPdfPageNumberExporter } from './exporter.js';
import { createPdfPageNumberView } from './view.js';
import { createPdfPageNumberWorkspace } from './workspace.js';
import './pdf-page-number.css';

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
  return error instanceof PdfPageNumberCancelledError
    || error?.name === 'RenderingCancelledException'
    || /cancelled|canceled/i.test(String(error?.message || error || ''));
}

async function destroyStagedSources(sources) {
  for (const source of sources) {
    try {
      if (source.pdfDoc) await destroyPdfDocument(source.pdfDoc);
      else await source.loadingTask?.destroy?.();
    } catch (_) {}
    source.pdfDoc = null;
    source.loadingTask = null;
    source.bytes = null;
  }
}

export function initPdfPageNumberTool({
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
  const plasmaBg = byId('pdfPageNumberPlasmaBg');
  const back = byId('pdfPageNumberBack');
  const dropZone = byId('pdfPageNumberDropZone');
  const fileInput = byId('pdfPageNumberFileInput');
  const addButton = byId('pdfPageNumberAdd');
  const emptyAddButton = byId('pdfPageNumberEmptyAdd');
  const pageList = byId('pdfPageNumberPageList');
  const pageCount = byId('pdfPageNumberPageCount');
  const selectedCount = byId('pdfPageNumberSelectedCount');
  const selectAllButton = byId('pdfPageNumberSelectAll');
  const deleteSelectedButton = byId('pdfPageNumberDeleteSelected');
  const undoDeleteButton = byId('pdfPageNumberUndoDelete');
  const prevButton = byId('pdfPageNumberPrev');
  const nextButton = byId('pdfPageNumberNext');
  const pageIndicator = byId('pdfPageNumberIndicator');
  const zoomOutButton = byId('pdfPageNumberZoomOut');
  const zoomInButton = byId('pdfPageNumberZoomIn');
  const fitButton = byId('pdfPageNumberFit');
  const zoomValue = byId('pdfPageNumberZoomValue');
  const canvasScroll = byId('pdfPageNumberCanvasScroll');
  const canvasStage = byId('pdfPageNumberCanvasStage');
  const canvasWrap = byId('pdfPageNumberCanvasWrap');
  const previewCanvas = byId('pdfPageNumberPreviewCanvas');
  const liveLayer = byId('pdfPageNumberLiveLayer');
  const liveBackground = byId('pdfPageNumberLiveBackground');
  const liveText = byId('pdfPageNumberLiveText');
  const emptyState = byId('pdfPageNumberEmpty');
  const previewStatus = byId('pdfPageNumberPreviewStatus');
  const rangeField = byId('pdfPageNumberRangeField');
  const rangeInput = byId('pdfPageNumberCustomRange');
  const templatePreset = byId('pdfPageNumberTemplatePreset');
  const templateField = byId('pdfPageNumberTemplateField');
  const templateInput = byId('pdfPageNumberTemplate');
  const scopeSelect = byId('pdfPageNumberScope');
  const numberingModeSelect = byId('pdfPageNumberMode');
  const startInput = byId('pdfPageNumberStart');
  const stepInput = byId('pdfPageNumberStep');
  const skipInput = byId('pdfPageNumberSkip');
  const numberFormatSelect = byId('pdfPageNumberFormat');
  const marginInput = byId('pdfPageNumberMargin');
  const offsetXInput = byId('pdfPageNumberOffsetX');
  const offsetYInput = byId('pdfPageNumberOffsetY');
  const fontSizeInput = byId('pdfPageNumberFontSize');
  const textColorInput = byId('pdfPageNumberTextColor');
  const textOpacityInput = byId('pdfPageNumberTextOpacity');
  const backgroundColorInput = byId('pdfPageNumberBackgroundColor');
  const backgroundOpacityInput = byId('pdfPageNumberBackgroundOpacity');
  const paddingInput = byId('pdfPageNumberPadding');
  const borderColorInput = byId('pdfPageNumberBorderColor');
  const borderWidthInput = byId('pdfPageNumberBorderWidth');
  const settingStatus = byId('pdfPageNumberSettingStatus');
  const outputNameInput = byId('pdfPageNumberOutputName');
  const exportButton = byId('pdfPageNumberExport');
  const processMask = byId('pdfPageNumberProcessMask');
  const processText = byId('pdfPageNumberProcessText');
  const processValue = byId('pdfPageNumberProcessValue');
  const processFill = byId('pdfPageNumberProcessFill');
  const processCancel = byId('pdfPageNumberProcessCancel');
  const successOverlay = byId('pdfPageNumberSuccessOverlay');
  const successMeta = byId('pdfPageNumberSuccessMeta');
  const successCount = byId('pdfPageNumberSuccessCount');
  const successPath = byId('pdfPageNumberSuccessPath');
  const successOpenFolder = byId('pdfPageNumberSuccessOpenFolder');
  const successOk = byId('pdfPageNumberSuccessOk');

  if (!overlay || !pageList || !canvasStage || !previewCanvas || !exportButton) {
    return { open() {}, close() {}, dispose() {} };
  }
  if (typeof getOutputDir !== 'function') throw new Error('pdf-page-number:missing-output-directory');
  if (typeof displayFilesystemPath !== 'function') throw new Error('pdf-page-number:missing-path-display');

  const lifecycle = createLifecycleScope();
  const listen = (target, type, handler, options) => target
    ? lifecycle.event(target, type, handler, options)
    : () => {};
  const customSelectControls = enhanceToolSelects([
    scopeSelect,
    numberingModeSelect,
    numberFormatSelect,
    templatePreset
  ]);
  const model = {
    sources: [],
    pages: [],
    selectedIds: new Set(),
    currentId: null,
    selectionAnchorId: null,
    lastDeletedSnapshot: null
  };
  let disposed = false;
  let session = null;
  let activeOperation = null;
  let operationSequence = 0;
  let plasmaInstance = null;
  let overlayReturnFocus = null;

  const isDemo = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get('pdf-page-number-demo') === '1';
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

  const view = createPdfPageNumberView({
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
    isDisposed: () => disposed,
    text: t
  });

  function settingsFromControls() {
    const position = overlay.querySelector('.pdf-page-number-position.is-active')?.dataset.position
      || PDF_PAGE_NUMBER_DEFAULTS.position;
    const backgroundStyle = overlay.querySelector('.pdf-page-number-style.is-active')?.dataset.style
      || PDF_PAGE_NUMBER_DEFAULTS.backgroundStyle;
    return normalizePdfPageNumberSettings({
      scope: scopeSelect?.value,
      customRange: rangeInput?.value,
      numberingMode: numberingModeSelect?.value,
      start: startInput?.value,
      step: stepInput?.value,
      skipFirst: skipInput?.value,
      template: templateInput?.value,
      numberFormat: numberFormatSelect?.value,
      position,
      margin: marginInput?.value,
      offsetX: offsetXInput?.value,
      offsetY: offsetYInput?.value,
      fontSize: fontSizeInput?.value,
      textColor: textColorInput?.value,
      textOpacity: textOpacityInput?.value,
      backgroundStyle,
      backgroundColor: backgroundColorInput?.value,
      backgroundOpacity: backgroundOpacityInput?.value,
      padding: paddingInput?.value,
      borderColor: borderColorInput?.value,
      borderWidth: borderWidthInput?.value
    });
  }

  function planFromControls() {
    return buildPdfPageNumberPlan(model.pages, {
      ...settingsFromControls(),
      selectedIds: model.selectedIds
    });
  }

  const workspace = createPdfPageNumberWorkspace({
    overlay,
    pageList,
    canvasScroll,
    canvasWrap,
    previewCanvas,
    liveLayer,
    liveBackground,
    liveText,
    previewStatus,
    settingStatus,
    model,
    text: t,
    showToast,
    refreshIcons,
    isLocked: () => Boolean(activeOperation),
    isDisposed: () => disposed,
    getSettings: settingsFromControls,
    getPlan: planFromControls,
    onStateChange: updateControls
  });
  const exporter = createPdfPageNumberExporter({ isTauri, getInvoke, getOutputDir });

  function beginOperation(type, owner = session) {
    if (activeOperation) throw new Error('Another operation is already in progress');
    const operation = {
      id: ++operationSequence,
      type,
      owner,
      cancelled: false,
      silent: false,
      loadingTasks: new Set(),
      isCurrent: () => activeOperation === operation && isOpenSession(owner) && !disposed
    };
    activeOperation = operation;
    updateControls();
    return operation;
  }

  function assertOperation(operation) {
    if (!operation?.isCurrent() || operation.cancelled) throw new PdfPageNumberCancelledError();
  }

  function finishOperation(operation) {
    if (activeOperation !== operation) return;
    activeOperation = null;
    view.setProcessState(false);
    updateControls();
  }

  function cancelOperation({ silent = false, detach = false } = {}) {
    const operation = activeOperation;
    if (!operation) return;
    operation.silent ||= silent;
    if (!operation.cancelled) {
      operation.cancelled = true;
      if (processCancel) processCancel.disabled = true;
      view.setProgress(0, t('home.pdfPageNumber.cancelling'));
      for (const task of operation.loadingTasks) {
        try { task.destroy(); } catch (_) {}
      }
    }
    if (detach && activeOperation === operation) activeOperation = null;
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
    if (isCancellation(error)) return t('home.pdfPageNumber.loadCancelled');
    if (isPasswordError(error)) return t('home.pdfPageNumber.passwordProtected');
    const detail = String(error?.message || error || '');
    if (/only pdf|pdf file is required/i.test(detail)) return t('home.pdfPageNumber.pdfOnly');
    if (/at most/i.test(detail)) {
      return t('home.pdfPageNumber.tooManyFiles', { count: PDF_PAGE_NUMBER_LIMITS.maxFiles });
    }
    if (/mb limit|input size/i.test(detail)) return t('home.pdfPageNumber.fileTooLarge');
    if (/page limit/i.test(detail)) {
      return t('home.pdfPageNumber.tooManyPages', { count: PDF_PAGE_NUMBER_LIMITS.maxPages });
    }
    return t('home.pdfPageNumber.loadFailed', { error: detail });
  }

  function exportErrorMessage(error) {
    if (isCancellation(error)) return t('home.pdfPageNumber.cancelled');
    if (isPasswordError(error)) return t('home.pdfPageNumber.passwordProtected');
    return t('home.pdfPageNumber.exportFailed', {
      error: String(error?.message || error || '')
    });
  }

  async function loadFiles(fileList, owner = session) {
    const files = Array.from(fileList || []);
    if (!files.length || activeOperation || !isOpenSession(owner)) return;
    const operation = beginOperation('load', owner);
    const snapshot = workspace.captureSnapshot();
    const staged = [];
    let transferred = false;
    view.setProcessState(true);
    if (processCancel) processCancel.disabled = false;
    view.setProgress(2, t('home.pdfPageNumber.readingFiles'));
    try {
      const sizes = [];
      for (const file of files) {
        assertOperation(operation);
        sizes.push(await fileSizeFor(file));
      }
      assertPdfPageNumberSelection(
        [
          ...model.sources.map(source => ({ name: source.name })),
          ...files.map(file => ({ name: sourceName(file) }))
        ],
        model.sources.reduce((sum, source) => sum + source.size, 0)
          + sizes.reduce((sum, size) => sum + size, 0)
      );
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      assertOperation(operation);
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      let stagedPages = 0;
      for (let index = 0; index < files.length; index += 1) {
        assertOperation(operation);
        view.setProgress(5 + Math.round((index / files.length) * 52), t(
          'home.pdfPageNumber.readingFile',
          { current: index + 1, total: files.length }
        ));
        const bytes = await readFileBytes(files[index]);
        assertOperation(operation);
        if (!bytes.length) throw new Error('Invalid PDF input size');
        const loadingTask = pdfjs.getDocument(pdfjsDocumentOptions({ data: bytes.slice() }));
        operation.loadingTasks.add(loadingTask);
        let pdfDoc;
        try {
          pdfDoc = await loadingTask.promise;
        } finally {
          operation.loadingTasks.delete(loadingTask);
        }
        assertOperation(operation);
        stagedPages += pdfDoc.numPages;
        assertPdfPageNumberPageCount(model.pages.length + stagedPages);
        staged.push({
          name: sourceName(files[index]),
          size: sizes[index],
          bytes,
          pdfDoc,
          loadingTask
        });
      }
      const { newPages } = workspace.appendSources(staged);
      transferred = true;
      if (outputNameInput && !outputNameInput.value.trim()) {
        outputNameInput.value = model.sources.length === 1
          ? sanitizePdfPageNumberBaseName(model.sources[0].name)
          : t('home.pdfPageNumber.defaultMergedName');
      }
      view.setProgress(76, t('home.pdfPageNumber.preparingPages', { count: model.pages.length }));
      view.setProgress(92, t('home.pdfPageNumber.renderingPreview'));
      await workspace.renderPreview();
      assertOperation(operation);
      if (!newPages.length) throw new Error('PDF has no pages');
      view.setProgress(100, t('home.pdfPageNumber.ready'));
    } catch (error) {
      if (transferred && isOpenSession(owner)) await workspace.restoreSnapshot(snapshot);
      else if (!transferred) await destroyStagedSources(staged);
      if (!operation.silent && isOpenSession(owner) && !isCancellation(error)) {
        showToast(loadErrorMessage(error), 9000);
      }
    } finally {
      finishOperation(operation);
      if (fileInput) fileInput.value = '';
    }
  }

  function syncRangeOutputs() {
    overlay.querySelectorAll('input[type="range"][data-output]').forEach(input => {
      const output = byId(input.dataset.output);
      if (!output) return;
      const value = Number(input.value);
      output.textContent = input.dataset.percent === 'true'
        ? `${Math.round(value * 100)}%`
        : `${input.value}${input.dataset.suffix || ''}`;
    });
  }

  function updateControls() {
    const busy = Boolean(activeOperation);
    const index = model.pages.findIndex(page => page.id === model.currentId);
    const hasPages = workspace.hasPages();
    const allSelected = hasPages && model.selectedIds.size === model.pages.length;
    if (pageCount) pageCount.textContent = t('home.pdfPageNumber.totalPages', { count: model.pages.length });
    if (selectedCount) {
      selectedCount.textContent = t('home.pdfPageNumber.selectedPages', { count: model.selectedIds.size });
    }
    if (pageIndicator) {
      pageIndicator.textContent = hasPages
        ? t('home.pdfPageNumber.pageIndicator', { current: index + 1, total: model.pages.length })
        : t('home.pdfPageNumber.noDocument');
    }
    if (selectAllButton) {
      selectAllButton.disabled = busy || !hasPages;
      selectAllButton.title = t(allSelected
        ? 'home.pdfPageNumber.clearSelection'
        : 'home.pdfPageNumber.selectAll');
      selectAllButton.setAttribute('aria-label', selectAllButton.title);
    }
    if (deleteSelectedButton) deleteSelectedButton.disabled = busy || model.selectedIds.size === 0;
    if (undoDeleteButton) undoDeleteButton.disabled = busy || !model.lastDeletedSnapshot;
    if (prevButton) prevButton.disabled = busy || index <= 0;
    if (nextButton) nextButton.disabled = busy || index < 0 || index >= model.pages.length - 1;
    const zoom = workspace.getPreviewZoom();
    if (zoomOutButton) zoomOutButton.disabled = !hasPages || zoom <= 0.45;
    if (zoomInButton) zoomInButton.disabled = !hasPages || zoom >= 3.2;
    if (fitButton) fitButton.disabled = !hasPages;
    if (zoomValue) zoomValue.textContent = `${Math.round(zoom * 100)}%`;
    if (addButton) addButton.disabled = busy || model.sources.length >= PDF_PAGE_NUMBER_LIMITS.maxFiles;
    if (emptyAddButton) emptyAddButton.disabled = busy;
    exportButton.disabled = busy || !hasPages;
    overlay.querySelectorAll(
      '.pdf-page-number-settings input, .pdf-page-number-settings select, .pdf-page-number-settings button'
    ).forEach(control => {
      if (control !== exportButton) control.disabled = busy || !hasPages;
    });
    if (rangeField) rangeField.hidden = scopeSelect?.value !== 'custom';
    if (templateField) templateField.hidden = templatePreset?.value !== 'custom';
    if (emptyState) emptyState.hidden = hasPages;
    if (canvasWrap) canvasWrap.hidden = !hasPages || previewCanvas.width < 1;
    pageList.classList.toggle('is-empty', !hasPages);
    syncRangeOutputs();
    if (hasPages) workspace.renderLivePageNumber();
    else if (settingStatus) settingStatus.textContent = t('home.pdfPageNumber.settingEmpty');
    customSelectControls.forEach(control => control.refresh());
  }

  function handleSettingsChange(event) {
    const target = event.target;
    if (target === scopeSelect && rangeField) rangeField.hidden = scopeSelect.value !== 'custom';
    if (target === templatePreset) {
      const templates = {
        page: '{page}',
        total: '{page} / {total}',
        chinese: '第 {page} 页',
        dash: '— {page} —'
      };
      if (templates[templatePreset.value] && templateInput) {
        templateInput.value = templates[templatePreset.value];
      }
      if (templateField) templateField.hidden = templatePreset.value !== 'custom';
    }
    syncRangeOutputs();
    updateControls();
    workspace.renderLivePageNumber();
  }

  function outputMode() {
    return overlay.querySelector('input[name="pdfPageNumberOutputMode"]:checked')?.value === 'zip'
      ? 'zip'
      : 'single';
  }

  async function exportDocument(owner = session) {
    if (!workspace.hasPages() || activeOperation || !isOpenSession(owner)) return;
    let plan;
    try {
      plan = planFromControls();
    } catch (_) {
      showToast(t('home.pdfPageNumber.rangeInvalid'));
      rangeInput?.focus();
      return;
    }
    if (!plan.some(item => item.applied)) {
      showToast(t('home.pdfPageNumber.noAppliedPages'));
      return;
    }
    const operation = beginOperation('export', owner);
    view.setProcessState(true);
    if (processCancel) processCancel.disabled = false;
    view.setProgress(2, t('home.pdfPageNumber.preparingExport'));
    try {
      const result = await exporter.run({
        active: operation,
        ...workspace.getData(),
        settings: settingsFromControls(),
        outputName: outputNameInput?.value,
        mode: outputMode(),
        assertOperation,
        setProgress: view.setProgress,
        text: t
      });
      assertOperation(operation);
      view.setProgress(100, t('home.pdfPageNumber.exportComplete'));
      view.showSuccess(result);
      view.focus(successOk || successOpenFolder);
    } catch (error) {
      if (!operation.silent && isOpenSession(owner) && !isCancellation(error)) {
        console.error('[PDF Page Number] export failed:', error);
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
      console.error('[PDF Page Number] open output folder failed:', error);
      showToast(t('home.pdfPageNumber.openFolderFailed'));
    }
  }

  function showDropZone() {
    if (activeOperation || workspace.hasActiveDrag()) return;
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
        if (!isOpenSession(owner) || activeOperation || workspace.hasActiveDrag()) return;
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
          void loadFiles(files, owner);
        }
      });
      owner.use(unlisten);
    } catch (error) {
      if (isOpenSession(owner)) {
        console.error('[PDF Page Number] native drag-drop setup failed:', error);
      }
    }
  }

  async function loadDemoFile(owner) {
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const documentHandle = await PDFDocument.create();
    const font = await documentHandle.embedFont(StandardFonts.Helvetica);
    [[612, 792], [842, 595], [420, 595], [612, 792]].forEach(([width, height], index) => {
      const page = documentHandle.addPage([width, height]);
      page.drawText(`ToolKnit PDF Page Number - Page ${index + 1}`, {
        x: 42,
        y: height - 72,
        size: 20,
        font,
        color: rgb(0.08, 0.08, 0.1)
      });
    });
    const bytes = await documentHandle.save();
    if (!isOpenSession(owner)) return;
    await loadFiles([{
      name: 'toolknit-pdf-page-number-demo.pdf',
      size: bytes.length,
      arrayBuffer: async () => bytes.slice().buffer
    }], owner);
  }

  function handleKeydown(event) {
    if (event.defaultPrevented) return;
    if (!overlay.classList.contains('visible')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (overlay.querySelector('.tool-custom-select.is-open')) {
        customSelectControls.forEach(control => control.close({ restoreFocus: true }));
        return;
      }
      if (successOverlay?.classList.contains('visible')) {
        view.closeSuccess();
        view.focus(exportButton);
      } else if (activeOperation) {
        cancelOperation();
      } else {
        void closeTool();
      }
      return;
    }
    if (processMask?.classList.contains('visible') || successOverlay?.classList.contains('visible')) return;
    workspace.handleShortcut(event);
  }

  function requestFiles() {
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
    updateControls();
    void registerNativeDrop(session);
    const owner = session;
    requestAnimationFrame(() => {
      if (!isOpenSession(owner)) return;
      if (workspace.hasPages()) void workspace.renderPreview();
      view.focus(workspace.hasPages() ? exportButton : emptyAddButton || addButton || back);
    });
    if (isDemo && !workspace.hasPages()) void loadDemoFile(owner);
  }

  async function closeTool({ restoreFocus = true } = {}) {
    const returnFocus = overlayReturnFocus;
    overlayReturnFocus = null;
    if (activeOperation) cancelOperation({ silent: true, detach: true });
    const owner = session;
    session = null;
    owner?.dispose();
    view.clear();
    view.setOverlayState(false);
    overlay.classList.remove('drag-over', 'is-page-sorting');
    dropZone?.classList.remove('visible');
    customSelectControls.forEach(control => control.close());
    plasmaInstance = disposeStandardToolPlasma(plasmaInstance);
    if (fileInput) fileInput.value = '';
    await workspace.resetDocument();
    updateControls();
    if (restoreFocus) view.focus(returnFocus);
  }

  listen(back, 'click', () => { void closeTool(); });
  listen(addButton, 'click', requestFiles);
  listen(emptyAddButton, 'click', requestFiles);
  listen(fileInput, 'change', event => { void loadFiles(event.target.files); });
  listen(selectAllButton, 'click', () => workspace.selectAll());
  listen(deleteSelectedButton, 'click', () => workspace.deleteSelected());
  listen(undoDeleteButton, 'click', () => workspace.undoDelete());
  listen(prevButton, 'click', () => workspace.selectAdjacent(-1));
  listen(nextButton, 'click', () => workspace.selectAdjacent(1));
  listen(zoomOutButton, 'click', () => workspace.changeZoom(0.86));
  listen(zoomInButton, 'click', () => workspace.changeZoom(1.16));
  listen(fitButton, 'click', () => workspace.fitPreview());
  listen(exportButton, 'click', () => { void exportDocument(); });
  listen(processCancel, 'click', () => cancelOperation());
  listen(successOk, 'click', () => {
    view.closeSuccess();
    view.focus(exportButton);
  });
  listen(successOpenFolder, 'click', () => { void openOutputFolder(); });
  listen(document, 'keydown', handleKeydown);

  overlay.querySelectorAll('.pdf-page-number-settings input, .pdf-page-number-settings select')
    .forEach(control => {
      listen(control, 'input', handleSettingsChange);
      listen(control, 'change', handleSettingsChange);
    });
  overlay.querySelectorAll('.pdf-page-number-position').forEach(button => {
    listen(button, 'click', () => {
      if (activeOperation) return;
      overlay.querySelectorAll('.pdf-page-number-position').forEach(candidate => {
        candidate.classList.toggle('is-active', candidate === button);
      });
      workspace.renderLivePageNumber();
    });
  });
  overlay.querySelectorAll('.pdf-page-number-style').forEach(button => {
    listen(button, 'click', () => {
      if (activeOperation) return;
      overlay.querySelectorAll('.pdf-page-number-style').forEach(candidate => {
        candidate.classList.toggle('is-active', candidate === button);
      });
      workspace.renderLivePageNumber();
    });
  });
  listen(overlay, 'dragover', event => {
    if (isTauri || workspace.hasActiveDrag()) return;
    event.preventDefault();
    showDropZone();
  });
  listen(overlay, 'dragleave', event => {
    if (!overlay.contains(event.relatedTarget)) hideDropZone();
  });
  listen(overlay, 'drop', event => {
    if (isTauri || workspace.hasActiveDrag()) return;
    event.preventDefault();
    hideDropZone();
    void loadFiles(event.dataTransfer?.files);
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
    disposed = true;
    await closeTool({ restoreFocus: false });
    exporter.dispose();
    await workspace.dispose();
    lifecycle.dispose();
  }

  return { open: openTool, close: closeTool, dispose };
}
