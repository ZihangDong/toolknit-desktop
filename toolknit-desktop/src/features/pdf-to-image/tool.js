import {
  PDF_TO_IMAGE_LIMITS,
  assertPdfToImageInput,
  assertPdfToImagePageCount,
  planPdfToImageExport
} from '../../pdf-to-image-core.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { onLangChange, t } from '../../i18n.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import {
  PdfToImageCancelledError,
  asUint8Array,
  errorCode,
  isPasswordError
} from './errors.js';
import { createPdfToImageExporter } from './exporter.js';
import { createPdfToImagePreview, isPdfRenderCancellation } from './preview.js';
import { createPdfToImageView } from './view.js';
import {
  PDF_TO_IMAGE_WORKSPACE_LIMITS,
  isPdfToImageGridCount,
  syncPdfToImageExportModes,
  validatePdfToImageExportMode
} from './export-modes.js';
import './pdf-to-image.css';

export function initPdfToImageTool({
  overlay,
  isTauri = false,
  getOutputDir,
  displayFilesystemPath,
  refreshIcons = () => {},
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = instance => instance
} = {}) {
  const body = document.getElementById('pdfToImageBody');
  const plasmaBg = document.getElementById('pdfToImagePlasmaBg');
  const back = document.getElementById('pdfToImageBack');
  const cta = document.getElementById('pdfToImageCta');
  const fileInput = document.getElementById('pdfToImageFileInput');
  const dropZone = document.getElementById('pdfToImageDropZone');
  const workspace = document.getElementById('pdfToImageWorkspace');
  const workspaceClose = document.getElementById('pdfToImageWorkspaceClose');
  let workspaceStatus = document.getElementById('pdfToImageWorkspaceStatus');
  let workspaceHint = document.getElementById('pdfToImageWorkspaceHint');
  const pageStage = document.getElementById('pdfToImagePageStage');
  const pageStrip = document.getElementById('pdfToImagePageStrip');
  const selectedCount = document.getElementById('pdfToImageSelectedCount');
  const selectionMeta = document.getElementById('pdfToImageSelectionMeta');
  const selectAllBtn = document.getElementById('pdfToImageSelectAllBtn');
  const exportImagesBtn = document.getElementById('pdfToImageExportImagesBtn');
  const exportLongBtn = document.getElementById('pdfToImageExportLongBtn');
  const exportHorizontalBtn = document.getElementById('pdfToImageExportHorizontalBtn');
  const exportGridBtn = document.getElementById('pdfToImageExportGridBtn');
  const longImageLimitNote = workspace?.querySelector('.pdf-to-image-limit-note');
  const formatOptions = document.getElementById('pdfToImageFormatOptions');
  const clarityOptions = document.getElementById('pdfToImageClarityOptions');
  const processMask = document.getElementById('pdfToImageProcessMask');
  const processBarFill = document.getElementById('pdfToImageProcessBarFill');
  const processValue = document.getElementById('pdfToImageProcessValue');
  const processText = document.getElementById('pdfToImageProcessText');
  const processCancel = document.getElementById('pdfToImageCancel');
  const processProgress = processMask?.querySelector('[role="progressbar"]');
  const successOverlay = document.getElementById('pdfToImageSuccessOverlay');
  const successMeta = document.getElementById('pdfToImageSuccessMeta');
  const successType = document.getElementById('pdfToImageSuccessType');
  const successCount = document.getElementById('pdfToImageSuccessCount');
  const successPath = document.getElementById('pdfToImageSuccessPath');
  const successOpenFolder = document.getElementById('pdfToImageSuccessOpenFolder');
  const successOk = document.getElementById('pdfToImageSuccessOk');

  if (!overlay || !workspace || !pageStrip) return { dispose() {} };

  // This feature is mounted lazily, after the application's initial icon scan.
  // Refresh immediately so static chrome and the page-workspace close control
  // never depend on another tool having rendered icons first.
  refreshIcons();

  const lifecycle = createLifecycleScope();
  const listen = (target, type, handler, options) => target
    ? lifecycle.event(target, type, handler, options)
    : () => {};
  let plasmaInstance = null;
  let currentFile = null;
  let activeOperation = null;
  let operationSequence = 0;
  let openSession = null;
  let longExportAllowed = true;
  let disposed = false;
  let overlayReturnFocus = null;
  let unsubscribeLangChange = () => {};
  let temporaryPreviewCleanup = null;
  let previewReleaseChain = Promise.resolve();
  const isDemo = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get('pdf-to-image-demo') === '1';

  const showToast = (message, duration = 7000) => {
    if (!disposed) window.showToast?.(message, { duration, dismissible: true });
  };

  const isOpenSession = owner => owner && owner === openSession && !owner.disposed
    && overlay.classList.contains('visible');

  const getInvoke = async () => {
    const { invoke } = await tauriCorePromise;
    return invoke;
  };

  const view = createPdfToImageView({
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
    isTauri,
    displayFilesystemPath,
    getActiveOperation: () => activeOperation,
    isDisposed: () => disposed
  });
  const {
    canReceiveFocus,
    closeSuccess,
    focusedElement,
    hideProcess,
    restoreFocus,
    setLocalizedProgress,
    showProcess,
    showSuccess,
    syncInteractiveLayers,
    syncProgressLabel,
    trapFocus
  } = view;

  // The shared workbench synchronizes selection state during construction.
  // Keep the reference nullable until construction has completed so that its
  // first callback cannot access a still-initializing lexical binding.
  let preview = null;
  preview = createPdfToImagePreview({
    pageStage,
    pageStrip,
    workspace,
    isLocked: () => Boolean(activeOperation),
    onSelectionChange: () => {
      if (preview) updateControls();
    },
    refreshIcons
  });
  // The shared workbench rebuilds the shell and moves the existing action nodes.
  // Refresh references to the generated header fields after that mount.
  workspaceStatus = workspace.querySelector('#pdfToImageWorkbenchStatus');
  workspaceHint = workspace.querySelector('#pdfToImageWorkbenchHint');
  updateControls();
  const exporter = createPdfToImageExporter({
    isTauri,
    getDocument: preview.getDocument,
    getCurrentFile: () => currentFile,
    getOutputDir,
    getInvoke,
    assertOperation,
    isOperationCurrent: operation => activeOperation === operation,
    setLocalizedProgress
  });

  function setTemporaryPreviewCleanup(cleanup) {
    temporaryPreviewCleanup = typeof cleanup === 'function' ? cleanup : null;
  }

  function releasePreviewResources() {
    const cleanup = temporaryPreviewCleanup;
    temporaryPreviewCleanup = null;
    const release = async () => {
      await preview.releaseDocument();
      if (!cleanup) return;
      try {
        await cleanup();
      } catch (_) {
        console.error('[PDF To Image] temporary preview cleanup failed');
      }
    };
    previewReleaseChain = previewReleaseChain.then(release, release);
    return previewReleaseChain;
  }

  function activeFocusRoots() {
    if (successOverlay?.classList.contains('visible')) return [successOverlay];
    if (processMask?.classList.contains('visible')) return [processMask];
    if (workspace.classList.contains('visible')) return [workspace];
    if (overlay.classList.contains('visible')) return [overlay];
    return [];
  }

  function handleDocumentKeydown(event) {
    if (disposed) return;
    const roots = activeFocusRoots();
    if (!roots.length) return;
    if (event.key === 'Tab') {
      trapFocus(event, roots);
      return;
    }
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (successOverlay?.classList.contains('visible')) {
      closeSuccess();
    } else if (processMask?.classList.contains('visible')) {
      if (!processCancel?.disabled) void cancelActiveOperation();
    } else if (workspace.classList.contains('visible')) {
      void closeWorkspace();
    } else {
      void closeOverlay();
    }
  }

  function selectedOption(group, fallback) {
    return group?.querySelector('button.active[data-value]')?.dataset.value || fallback;
  }

  function setOption(group, button) {
    if (!group || !button) return;
    group.querySelectorAll('button[data-value]').forEach(option => {
      const active = option === button;
      option.classList.toggle('active', active);
      option.setAttribute('aria-pressed', String(active));
    });
  }

  function assertOperation(operation) {
    if (!operation || operation.cancelled || activeOperation !== operation) {
      throw new PdfToImageCancelledError();
    }
  }

  function beginOperation(type) {
    if (activeOperation) throw new Error('pdf-to-image:busy');
    const id = ++operationSequence;
    const operation = {
      id,
      type,
      cancelled: false,
      silent: false,
      renderTask: null,
      sessionId: '',
      jobId: `pdf-to-image-${Date.now()}-${id}`,
      nativeExportStarted: false,
      progressKey: '',
      progressParams: {},
      returnFocus: focusedElement()
    };
    activeOperation = operation;
    return operation;
  }

  function endOperation(operation) {
    if (activeOperation !== operation) return;
    activeOperation = null;
    hideProcess();
    updateControls();
    syncProgressLabel();
    if (!successOverlay?.classList.contains('visible')) {
      const fallback = workspace.classList.contains('visible')
        ? preview.selectedPageStates()[0]?.selectButton || workspaceClose
        : overlay.classList.contains('visible')
          ? cta || back
          : overlayReturnFocus;
      restoreFocus(canReceiveFocus(operation.returnFocus) ? operation.returnFocus : fallback);
    }
  }

  async function cancelActiveOperation() {
    const operation = activeOperation;
    if (!operation || operation.cancelled) return;
    operation.cancelled = true;
    if (processCancel) processCancel.disabled = true;
    setLocalizedProgress(
      Number(processProgress?.getAttribute('aria-valuenow') || 0),
      'cancelling'
    );
    try { operation.renderTask?.cancel(); } catch (_) {}
    if (operation.type === 'load') {
      await preview.cancelLoading();
    }
    if (isTauri && operation.type === 'export') {
      try {
        const invoke = await getInvoke();
        await invoke('cancel_pdf_to_image', { jobId: operation.jobId });
      } catch (_) {}
    }
  }

  function openOverlay() {
    if (disposed) return;
    if (!overlay.classList.contains('visible')) overlayReturnFocus = focusedElement();
    overlay.classList.add('visible');
    if (!openSession || openSession.disposed) {
      openSession = createLifecycleScope();
      void registerNativeDrop(openSession);
    }
    if (plasmaBg && !plasmaInstance) {
      plasmaInstance = initStandardToolPlasma(plasmaBg);
    }
    syncInteractiveLayers();
    restoreFocus(cta || back);
  }

  function showDropZone() {
    if (activeOperation || workspace.classList.contains('visible')) return;
    overlay.classList.add('drag-over');
    dropZone?.classList.add('visible');
  }

  function hideDropZone() {
    overlay.classList.remove('drag-over');
    dropZone?.classList.remove('visible');
  }

  async function registerNativeDrop(owner) {
    if (!isTauri) return;
    try {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      if (!isOpenSession(owner)) return;
      const unlisten = await getCurrentWebview().onDragDropEvent(event => {
        if (!isOpenSession(owner) || workspace.classList.contains('visible') || activeOperation) return;
        const payload = event.payload || {};
        if (payload.type === 'enter' || payload.type === 'over') {
          showDropZone();
        } else if (payload.type === 'leave') {
          hideDropZone();
        } else if (payload.type === 'drop') {
          hideDropZone();
          setLongExportAllowed(true);
          const paths = Array.from(payload.paths || []);
          if (paths.length !== 1) {
            showToast(t('home.pdfToImageTool.singlePdfOnly'));
            return;
          }
          const path = paths[0];
          void acceptFile({
            name: path.split(/[\\/]/).pop() || path,
            path,
            size: 0
          });
        }
      });
      owner.use(unlisten);
    } catch (error) {
      if (isOpenSession(owner)) console.error('[PDF To Image] Native drag-drop setup failed:', error);
    }
  }

  async function closeWorkspace() {
    if (activeOperation) {
      showToast(t('home.pdfToImageTool.busy'));
      return;
    }
    workspace.classList.remove('visible');
    overlay.classList.remove('is-selection-flow');
    setLongExportAllowed(true);
    currentFile = null;
    await releasePreviewResources();
    updateControls();
    syncInteractiveLayers();
    restoreFocus(cta || back);
  }

  async function closeOverlay() {
    if (activeOperation) {
      showToast(t('home.pdfToImageTool.busy'));
      return;
    }
    closeSuccess(false);
    openSession?.dispose();
    openSession = null;
    workspace.classList.remove('visible');
    overlay.classList.remove('visible', 'drag-over', 'is-selection-flow');
    setLongExportAllowed(true);
    dropZone?.classList.remove('visible');
    plasmaInstance = disposeStandardToolPlasma(plasmaInstance);
    if (fileInput) fileInput.value = '';
    currentFile = null;
    await releasePreviewResources();
    syncInteractiveLayers();
    const returnFocus = overlayReturnFocus;
    overlayReturnFocus = null;
    restoreFocus(returnFocus);
  }

  function applyClarityHints() {
    const hintKeys = {
      standard: 'home.pdfToImageTool.clarityStandardHint',
      high: 'home.pdfToImageTool.clarityHighHint',
      print: 'home.pdfToImageTool.clarityPrintHint'
    };
    clarityOptions?.querySelectorAll('button[data-value]').forEach(button => {
      const key = hintKeys[button.dataset.value];
      if (key) button.title = t(key);
    });
  }

  function setLongExportAllowed(allowed = true) {
    longExportAllowed = allowed !== false;
    if (exportLongBtn) {
      exportLongBtn.hidden = !longExportAllowed;
      exportLongBtn.setAttribute('aria-hidden', String(!longExportAllowed));
    }
    if (longImageLimitNote) longImageLimitNote.hidden = !longExportAllowed;
    updateControls();
  }

  function updateControls() {
    const pageStates = preview.getPageStates();
    const total = pageStates.length;
    const selected = pageStates.filter(pageState => pageState.selected).length;
    const allSelected = total > 0 && selected === total;
    const longImages = longExportAllowed && selected >= PDF_TO_IMAGE_WORKSPACE_LIMITS.minLongPages
      ? Math.ceil(selected / PDF_TO_IMAGE_LIMITS.maxPagesPerLongImage)
      : 0;
    const belowLongMinimum = longExportAllowed && selected > 0
      && selected < PDF_TO_IMAGE_WORKSPACE_LIMITS.minLongPages;
    const exceedsLongLimit = longExportAllowed && selected > PDF_TO_IMAGE_WORKSPACE_LIMITS.maxLongPages;
    const busy = Boolean(activeOperation);

    if (workspaceStatus) workspaceStatus.textContent = t('home.pdfToImageTool.readyStatus');
    if (workspaceHint) {
      workspaceHint.textContent = t('home.pdfToImageTool.workspaceHint', {
        name: currentFile?.name || ''
      });
    }
    if (selectedCount) {
      selectedCount.textContent = t('home.pdfToImageTool.selectedCount', { count: selected });
    }
    if (selectionMeta) {
      const statusKey = !longExportAllowed
        ? 'home.pdfToImageTool.selectionStatusIndividual'
        : belowLongMinimum
          ? 'home.pdfToImageTool.selectionStatusLongMinimum'
          : exceedsLongLimit
            ? 'home.pdfToImageTool.selectionStatusLongLimit'
            : 'home.pdfToImageTool.selectionStatus';
      selectionMeta.textContent = t(statusKey, {
        selected,
        total,
        longImages,
        limit: PDF_TO_IMAGE_WORKSPACE_LIMITS.maxLongPages,
        minimum: PDF_TO_IMAGE_WORKSPACE_LIMITS.minLongPages
      });
    }
    if (selectAllBtn) {
      const label = selectAllBtn.querySelector('span') || selectAllBtn;
      label.textContent = t(allSelected ? 'home.pdfToImageTool.clearSelection' : 'home.pdfToImageTool.selectAll');
      selectAllBtn.disabled = busy || total === 0;
    }
    if (exportImagesBtn) exportImagesBtn.disabled = busy || selected === 0;
    const longExportTitle = belowLongMinimum
      ? t('home.pdfToImageTool.longImageMinimumSelection')
      : exceedsLongLimit
        ? t('home.pdfToImageTool.longImageSelectionLimit')
        : '';
    if (exportLongBtn) exportLongBtn.title = longExportTitle;
    if (exportHorizontalBtn) exportHorizontalBtn.title = longExportTitle;
    if (exportGridBtn) {
      const gridLabel = exportGridBtn.querySelector('span');
      if (gridLabel) {
        gridLabel.textContent = t(
          selected === 4
            ? 'home.pdfToImageTool.exportGridImage4'
            : selected === 9
              ? 'home.pdfToImageTool.exportGridImage9'
              : 'home.pdfToImageTool.exportGridImage'
        );
      }
      exportGridBtn.title = isPdfToImageGridCount(selected)
        ? ''
        : t('home.pdfToImageTool.gridSelectionLimit');
    }
    syncPdfToImageExportModes({
      longButton: exportLongBtn,
      horizontalButton: exportHorizontalBtn,
      gridButton: exportGridBtn,
      longExportAllowed,
      selectedCount: selected,
      busy
    });
    formatOptions?.querySelectorAll('button').forEach(button => { button.disabled = busy; });
    clarityOptions?.querySelectorAll('button').forEach(button => { button.disabled = busy; });
    pageStrip?.querySelectorAll('.pdf-editor-tile-select').forEach(button => {
      button.disabled = busy;
    });
    applyClarityHints();
  }

  function messageForError(error, phase) {
    if (error instanceof PdfToImageCancelledError || errorCode(error) === 'cancelled') {
      return t(`home.pdfToImageTool.${phase === 'load' ? 'loadCancelled' : 'cancelled'}`);
    }
    if (isPasswordError(error)) return t('home.pdfToImageTool.passwordProtected');
    const code = errorCode(error);
    const mapped = {
      single_file_required: 'singlePdfOnly',
      invalid_pdf: 'invalidPdf',
      pdf_too_large: 'fileTooLarge',
      input_too_large: 'fileTooLarge',
      too_many_pages: 'tooManyPages',
      empty_pdf: 'emptyPdf',
      invalid_selection: 'noSelection',
      too_many_long_pages: 'longImageSelectionLimit',
      invalid_grid_count: 'gridSelectionLimit',
      page_too_large: 'pageTooLarge',
      output_too_large: 'pageTooLarge',
      output_too_large_for_memory: 'pageTooLarge',
      session_too_large: 'writeFailed',
      page_write_failed: 'writeFailed',
      output_path: 'writeFailed',
      publish_failed: 'writeFailed',
      encode_failed: 'writeFailed',
      busy: 'busy'
    };
    if (mapped[code]) return t('home.pdfToImageTool.' + mapped[code]);
    const detail = String(error?.message || error || '');
    if (/another file conversion is already in progress/i.test(detail)) {
      return t('home.pdfToImageTool.busy');
    }
    return t(
      phase === 'load' ? 'home.pdfToImageTool.loadFailed' : 'home.pdfToImageTool.exportFailed',
      { error: detail }
    );
  }

  async function fileSizeFor(file) {
    if (isTauri && file.path) {
      const invoke = await getInvoke();
      return Number(await invoke('get_file_size', { path: file.path }));
    }
    return Number(file.size || 0);
  }

  async function readPdfBytes(file) {
    if (isTauri && file.path) {
      const invoke = await getInvoke();
      return asUint8Array(await invoke('read_pdf_to_image_source', { path: file.path }));
    }
    return new Uint8Array(await file.arrayBuffer());
  }

  async function loadDemoFile(owner) {
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const documentHandle = await PDFDocument.create();
    const font = await documentHandle.embedFont(StandardFonts.Helvetica);
    const pageSizes = [[612, 792], [842, 595], [420, 595], [612, 792]];
    pageSizes.forEach(([width, height], index) => {
      const page = documentHandle.addPage([width, height]);
      page.drawText(`ToolKnit PDF to Image - Page ${index + 1}`, {
        x: 42,
        y: height - 72,
        size: 20,
        font,
        color: rgb(0.08, 0.08, 0.1)
      });
      page.drawRectangle({
        x: 42,
        y: height - 160,
        width: Math.max(120, width - 84),
        height: 52,
        color: rgb(0.88, 0.9, 0.94)
      });
    });
    const bytes = await documentHandle.save();
    if (!isOpenSession(owner)) return;
    await acceptFile({
      name: 'toolknit-pdf-to-image-demo.pdf',
      size: bytes.length,
      arrayBuffer: async () => bytes.slice().buffer
    });
  }

  async function acceptFile(file, { releaseExisting = true } = {}) {
    if (disposed || !file || activeOperation) {
      if (activeOperation) showToast(t('home.pdfToImageTool.busy'));
      return false;
    }
    const name = String(file.name || '');
    if (!/\.pdf$/i.test(name)) {
      showToast(t('home.pdfToImageTool.pdfOnly'));
      return false;
    }

    const operation = beginOperation('load');
    showProcess('loadingDocument', 2);
    try {
      currentFile = null;
      if (releaseExisting) await releasePreviewResources();
      assertOperation(operation);
      const size = await fileSizeFor(file);
      assertOperation(operation);
      assertPdfToImageInput([{ name }], size);
      setLocalizedProgress(10, 'loadingDocument');
      const bytes = await readPdfBytes(file);
      assertOperation(operation);
      const loadedDocument = await preview.loadDocument(bytes, () => assertOperation(operation));
      assertPdfToImagePageCount(loadedDocument.numPages);
      currentFile = { ...file, name, size };
      setLocalizedProgress(
        82,
        'loadingPages',
        { count: loadedDocument.numPages }
      );
      preview.buildPageTiles(loadedDocument.numPages);
      overlay.classList.add('is-selection-flow');
      workspace.classList.add('visible');
      syncInteractiveLayers();
      setLocalizedProgress(100, 'loadingPages', { count: loadedDocument.numPages });
      preview.start();
      return true;
    } catch (error) {
      const cancelled = operation.cancelled || error instanceof PdfToImageCancelledError;
      if (activeOperation === operation) {
        currentFile = null;
        await releasePreviewResources();
      }
      if (!disposed && !operation.silent && overlay.classList.contains('visible')) {
        showToast(
          cancelled ? t('home.pdfToImageTool.loadCancelled') : messageForError(error, 'load'),
          cancelled ? 4500 : 9000
        );
      }
    } finally {
      endOperation(operation);
    }
  }

  async function exportSelection(mode) {
    const pdfDocument = preview.getDocument();
    if (disposed || !pdfDocument || activeOperation) {
      if (activeOperation) showToast(t('home.pdfToImageTool.busy'));
      return;
    }
    const selectedPages = preview.selectedPageStates();
    if (!selectedPages.length) {
      showToast(t('home.pdfToImageTool.noSelection'));
      return;
    }
    const modeError = validatePdfToImageExportMode(mode, selectedPages.length, longExportAllowed);
    if (modeError === 'unavailable') {
      showToast(t('home.pdfToImageTool.longImageNotAvailable'));
      return;
    }
    if (modeError === 'too-many-long-pages') {
      showToast(t('home.pdfToImageTool.longImageSelectionLimit'), 8500);
      return;
    }
    if (modeError === 'too-few-long-pages') {
      showToast(t('home.pdfToImageTool.longImageMinimumSelection'), 8500);
      return;
    }
    if (modeError === 'invalid-grid-count') {
      showToast(t('home.pdfToImageTool.gridSelectionLimit'), 8500);
      return;
    }

    const operation = beginOperation('export');
    preview.stop(false);
    updateControls();
    showProcess('preparing', 2);
    try {
      const pageMetrics = await exporter.collectPageMetrics(operation, selectedPages);
      assertOperation(operation);
      const plan = planPdfToImageExport({
        sourceName: currentFile.name,
        pageCount: pdfDocument.numPages,
        pages: selectedPages.map(pageState => pageState.pageNumber),
        pageMetrics,
        mode,
        format: selectedOption(formatOptions, 'png'),
        clarity: selectedOption(clarityOptions, 'high')
      });
      setLocalizedProgress(
        10,
        ['long', 'long-horizontal', 'grid'].includes(mode)
          ? 'exportingLongImages'
          : 'exportingImages'
      );
      const result = await exporter.run(operation, plan, mode);
      assertOperation(operation);
      setLocalizedProgress(100, 'writingOutput');
      showSuccess(
        result,
        mode,
        plan.pagePlans.filter(page => page.wasLimited).length,
        operation.returnFocus
      );
    } catch (error) {
      const cancelled = operation.cancelled
        || error instanceof PdfToImageCancelledError
        || isPdfRenderCancellation(error)
        || errorCode(error) === 'cancelled';
      if (!operation.silent && overlay.classList.contains('visible')) {
        showToast(
          cancelled ? t('home.pdfToImageTool.cancelled') : messageForError(error, 'export'),
          cancelled ? 4500 : 9000
        );
      }
      return false;
    } finally {
      const wasCurrent = activeOperation === operation;
      endOperation(operation);
      if (wasCurrent && preview.getDocument() && workspace.classList.contains('visible')) {
        preview.start();
      }
    }
  }

  listen(back, 'click', () => { void closeOverlay(); });
  listen(workspaceClose, 'click', () => { void closeWorkspace(); });
  listen(processCancel, 'click', () => { void cancelActiveOperation(); });
  listen(successOk, 'click', () => closeSuccess());
  listen(successOpenFolder, 'click', async () => {
    const outputPath = view.getLastOutputPath?.();
    const outputFolder = view.getLastOutputFolder();
    if (!isTauri || (!outputPath && !outputFolder)) return;
    try {
      const invoke = await getInvoke();
      await invoke('open_path', { path: outputPath || outputFolder });
      closeSuccess();
    } catch (_) {
      showToast(t('home.pdfToImageTool.openFolderFailed'));
    }
  });

  listen(cta, 'click', async () => {
    if (activeOperation) {
      showToast(t('home.pdfToImageTool.busy'));
      return;
    }
    setLongExportAllowed(true);
    if (isTauri) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
          multiple: false,
          filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
        });
        if (!disposed && typeof selected === 'string') {
          await acceptFile({
            name: selected.split(/[\\/]/).pop() || selected,
            path: selected,
            size: 0
          });
        }
      } catch (error) {
        showToast(messageForError(error, 'load'));
      }
      return;
    }
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
  });

  listen(fileInput, 'change', () => {
    const files = Array.from(fileInput.files || []);
    if (files.length > 1) {
      showToast(t('home.pdfToImageTool.singlePdfOnly'));
      return;
    }
    void acceptFile(files[0]);
  });

  listen(overlay, 'dragover', event => {
    if (!overlay.classList.contains('visible') || isTauri) return;
    event.preventDefault();
    showDropZone();
  });
  listen(overlay, 'dragleave', event => {
    if (event.relatedTarget && overlay.contains(event.relatedTarget)) return;
    hideDropZone();
  });
  listen(overlay, 'drop', event => {
    if (isTauri) return;
    event.preventDefault();
    hideDropZone();
    setLongExportAllowed(true);
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length !== 1) {
      showToast(t('home.pdfToImageTool.singlePdfOnly'));
      return;
    }
    void acceptFile(files[0]);
  });

  [formatOptions, clarityOptions].forEach(group => {
    listen(group, 'click', event => {
      if (activeOperation) return;
      const button = event.target.closest('button[data-value]');
      if (!button || !group.contains(button)) return;
      setOption(group, button);
    });
  });

  listen(selectAllBtn, 'click', () => {
    const pageStates = preview.getPageStates();
    if (activeOperation || !pageStates.length) return;
    preview.setAllSelected(pageStates.some(pageState => !pageState.selected));
  });
  listen(exportImagesBtn, 'click', () => { void exportSelection('images'); });
  listen(exportLongBtn, 'click', () => { void exportSelection('long'); });
  listen(exportHorizontalBtn, 'click', () => { void exportSelection('long-horizontal'); });
  listen(exportGridBtn, 'click', () => { void exportSelection('grid'); });
  listen(document, 'keydown', handleDocumentKeydown);

  unsubscribeLangChange = onLangChange(() => {
    updateControls();
    view.refresh();
  }) || (() => {});

  processMask?.setAttribute('role', 'dialog');
  processMask?.setAttribute('aria-modal', 'true');
  processMask?.setAttribute('aria-labelledby', 'pdfToImageProcessText');
  updateControls();
  syncProgressLabel();
  syncInteractiveLayers();

  async function closeTool() {
    const operation = activeOperation;
    if (operation) operation.silent = true;
    const cancellation = operation && !operation.cancelled
      ? cancelActiveOperation()
      : Promise.resolve();
    activeOperation = null;
    openSession?.dispose();
    openSession = null;
    view.clear();
    workspace.classList.remove('visible');
    overlay.classList.remove('visible', 'drag-over', 'is-selection-flow');
    dropZone?.classList.remove('visible');
    setLongExportAllowed(true);
    if (fileInput) fileInput.value = '';
    overlayReturnFocus = null;
    plasmaInstance = disposeStandardToolPlasma(plasmaInstance);
    syncInteractiveLayers();
    currentFile = null;
    await cancellation;
    await releasePreviewResources();
  }

  return {
    open() {
      if (disposed) return;
      refreshIcons();
      setLongExportAllowed(true);
      openOverlay();
      if (isDemo) void loadDemoFile(openSession);
    },
    close: closeTool,
    async openWithFile(file, {
      allowLongExport = true,
      cleanupTemporaryPreview = null
    } = {}) {
      if (disposed) {
        try { await cleanupTemporaryPreview?.(); } catch (_) {}
        return false;
      }
      await releasePreviewResources();
      setTemporaryPreviewCleanup(cleanupTemporaryPreview);
      setLongExportAllowed(allowLongExport);
      openOverlay();
      const accepted = await acceptFile(file, { releaseExisting: false });
      if (!accepted) await releasePreviewResources();
      return accepted;
    },
    async dispose() {
      if (disposed) return;
      await closeTool();
      disposed = true;
      try { unsubscribeLangChange(); } catch (_) {}
      unsubscribeLangChange = () => {};
      exporter.dispose();
      preview.dispose();
      view.dispose();
      lifecycle.dispose();
    }
  };
}
