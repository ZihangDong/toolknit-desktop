import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { onLangChange, t } from '../../i18n.js';
import { moveFocusOutOfHiddenRegion } from '../../shared/tool-page-shell.js';
import {
  loadTauriDialog,
  loadTauriWebview,
  tauriCorePromise,
  tauriEventPromise
} from '../../platform/tauri-runtime.js';
import {
  EXCEL_TO_PDF_MAX_FILES,
  excelWorkbookKey,
  excelWorkbookNameFromPath,
  formatExcelWorkbookBytes,
  getExcelToPdfErrorKey,
  isSupportedExcelWorkbook,
  normalizeExcelWorkbookRecord
} from './core.js';

function copy(key, values) {
  return t(`home.excelToPdfPage.${key}`, values);
}

export function createExcelToPdfController({
  overlay,
  notify = () => {},
  isTauri = false,
  initStandardToolPlasma,
  disposeStandardToolPlasma,
  openSettings,
  openSupport,
  openExternalUrl,
  handleWindowAction,
  getOutputDir,
  ensureLibreOfficeAvailable,
  refreshIcons = () => {}
} = {}) {
  if (!overlay) return { open() {}, close() {}, dispose() {} };

  const lifecycle = createLifecycleScope();
  const query = selector => overlay.querySelector(selector);
  const fileInput = query('[data-excel-input]');
  const filesContainer = query('[data-excel-files]');
  const emptyState = query('.excel-pdf-empty');
  const clearButton = query('[data-excel-action="clear"]');
  const status = query('[data-excel-status]');
  const processButton = query('[data-excel-action="convert"]');
  const processMask = query('[data-excel-process]');
  const progressBar = query('[data-excel-progress]');
  const processText = query('[data-excel-process-text]');
  const successOverlay = query('[data-excel-success]');
  const successMeta = query('[data-excel-success-meta]');
  const successFiles = query('[data-excel-success-files]');
  const successPages = query('[data-excel-success-pages]');
  const successPath = query('[data-excel-success-path]');
  const dropZone = query('[data-excel-drop-zone]');
  const background = query('[data-excel-bg]');
  const settings = { sheets: 'all', orientation: 'source', paper: 'auto', scale: 'fit' };
  let files = [];
  let nextId = 1;
  let plasmaInstance = null;
  let session = null;
  let processing = false;
  let cancelling = false;
  let lastOutputDir = '';
  let disposed = false;
  let operationSequence = 0;
  let nativeStarted = false;

  const invoke = async (command, args) => {
    const api = await tauriCorePromise;
    return api.invoke(command, args);
  };
  const isOpenSession = owner => owner && owner === session && !owner.disposed
    && overlay.classList.contains('visible') && !disposed;

  function renderFiles() {
    emptyState.hidden = files.length > 0;
    filesContainer.hidden = files.length === 0;
    clearButton.hidden = files.length === 0;
    const fragment = document.createDocumentFragment();
    files.forEach((file, index) => {
      const article = document.createElement('article');
      article.className = 'excel-pdf-file';
      article.dataset.fileId = String(file.id);

      const order = document.createElement('span');
      order.className = 'excel-pdf-file-index';
      order.textContent = String(index + 1).padStart(2, '0');

      const iconBox = document.createElement('span');
      iconBox.className = 'excel-pdf-file-icon';
      const icon = document.createElement('i');
      icon.dataset.lucide = 'file-spreadsheet';
      iconBox.append(icon);

      const fileCopy = document.createElement('span');
      fileCopy.className = 'excel-pdf-file-copy';
      const name = document.createElement('strong');
      name.textContent = file.name;
      name.title = file.name;
      const metadata = document.createElement('small');
      metadata.textContent = `${file.extension.toUpperCase()} · ${formatExcelWorkbookBytes(file.size, copy('unknownSize'))}`;
      fileCopy.append(name, metadata);

      const remove = document.createElement('button');
      remove.className = 'excel-pdf-icon-button';
      remove.type = 'button';
      remove.dataset.removeFile = String(file.id);
      remove.title = copy('removeFile');
      remove.setAttribute('aria-label', copy('removeFile'));
      const removeIcon = document.createElement('i');
      removeIcon.dataset.lucide = 'x';
      remove.append(removeIcon);

      article.append(order, iconBox, fileCopy, remove);
      fragment.append(article);
    });
    filesContainer.replaceChildren(fragment);
    status.textContent = files.length
      ? copy('footerReady', { count: files.length })
      : copy('footerEmpty');
    processButton.hidden = files.length === 0;
    processButton.disabled = files.length === 0 || processing;
    processButton.classList.toggle('visible', files.length > 0);
    refreshIcons();
  }

  function addRecords(records) {
    if (disposed) return;
    const accepted = [];
    let unsupported = false;
    let duplicate = false;
    const known = new Set(files.map(excelWorkbookKey));
    for (const record of records) {
      const name = record?.name || excelWorkbookNameFromPath(record?.path);
      if (!isSupportedExcelWorkbook(name)) {
        unsupported = true;
        continue;
      }
      if (files.length + accepted.length >= EXCEL_TO_PDF_MAX_FILES) {
        notify(copy('tooMany'));
        break;
      }
      const normalized = normalizeExcelWorkbookRecord(record, nextId++);
      const key = excelWorkbookKey(normalized);
      if (known.has(key)) {
        duplicate = true;
        continue;
      }
      known.add(key);
      accepted.push(normalized);
    }
    files.push(...accepted);
    if (unsupported) notify(copy('unsupported'));
    else if (duplicate) notify(copy('duplicate'));
    renderFiles();
  }

  function addBrowserFiles(fileList) {
    addRecords(Array.from(fileList || []).map(file => ({ name: file.name, size: file.size })));
  }

  function renderLocale() {
    if (disposed) return;
    overlay.querySelectorAll('[data-excel-text]').forEach(node => {
      const key = node.dataset.excelText;
      if (key) node.textContent = copy(key);
    });
    overlay.querySelectorAll('[data-excel-title]').forEach(node => {
      const key = node.dataset.excelTitle;
      if (!key) return;
      const value = copy(key);
      node.title = value;
      if (!node.getAttribute('aria-label')) node.setAttribute('aria-label', value);
    });
    renderFiles();
  }

  async function chooseFiles() {
    if (processing || !session) return;
    const owner = session;
    if (!isTauri) {
      fileInput.value = '';
      fileInput.click();
      return;
    }
    try {
      const { open } = await loadTauriDialog();
      const selected = await open({
        multiple: true,
        filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'ods'] }]
      });
      if (!isOpenSession(owner)) return;
      const paths = Array.isArray(selected)
        ? selected
        : (typeof selected === 'string' ? [selected] : []);
      addRecords(paths.map(path => ({ path, name: excelWorkbookNameFromPath(path) })));
    } catch {
      if (isOpenSession(owner)) notify(copy('chooseFailed'));
    }
  }

  function setProgress(percent, message, visible = true) {
    progressBar.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
    processText.textContent = message || copy('processing');
    processMask.classList.toggle('visible', Boolean(visible));
  }

  function hideSuccess({ restoreFocus = false } = {}) {
    moveFocusOutOfHiddenRegion(successOverlay, restoreFocus ? processButton : null);
    successOverlay.inert = true;
    successOverlay.classList.remove('visible');
    successOverlay.setAttribute('aria-hidden', 'true');
  }

  function conversionErrorMessage(error) {
    const message = String(error?.message || error || '');
    const key = getExcelToPdfErrorKey(error);
    return key === 'conversionFailed'
      ? copy(key, { error: message || copy('unknownError') })
      : copy(key);
  }

  function showSuccess(result) {
    const outputs = Array.isArray(result?.outputs) ? result.outputs : [];
    const firstOutputPath = String(outputs[0]?.output_path || outputs[0]?.outputPath || '');
    lastOutputDir = firstOutputPath || String(result?.outputDir || '');
    const pageCount = outputs.reduce((sum, item) => sum + (Number(item?.pageCount) || 0), 0);
    const succeeded = Number(result?.successCount) || outputs.length;
    const failed = Number(result?.failCount) || 0;
    successMeta.textContent = failed
      ? copy('successPartial', { success: succeeded, failed })
      : copy('successMeta', { count: succeeded });
    successFiles.textContent = copy('successFileCount', { count: succeeded });
    successPages.textContent = pageCount > 0
      ? copy('successPageCount', { count: pageCount })
      : copy('pageCountUnavailable');
    successPath.textContent = lastOutputDir;
    successOverlay.classList.add('visible');
    successOverlay.inert = false;
    successOverlay.setAttribute('aria-hidden', 'false');
  }

  async function startConversion() {
    if (processing || files.length === 0 || !session) return;
    const owner = session;
    if (!isTauri) {
      notify(copy('desktopOnly'));
      return;
    }
    const inputPaths = files.map(file => file.path).filter(Boolean);
    if (inputPaths.length !== files.length) {
      notify(copy('reselectDesktopFiles'));
      return;
    }
    processing = true;
    cancelling = false;
    nativeStarted = false;
    const operation = ++operationSequence;
    renderFiles();
    overlay.querySelectorAll('[data-setting-value], [data-excel-action="upload"], [data-excel-action="clear"], [data-remove-file]')
      .forEach(node => { node.disabled = true; });
    setProgress(4, copy('preparing'));
    let releaseProgress = () => {};

    try {
      if (ensureLibreOfficeAvailable && !await ensureLibreOfficeAvailable()) return;
      if (!isOpenSession(owner) || cancelling || operation !== operationSequence) return;
      const { listen } = await tauriEventPromise;
      const unlisten = await listen('excel-to-pdf-progress', event => {
        if (!isOpenSession(owner) || operation !== operationSequence) return;
        const payload = event.payload || {};
        const phase = String(payload.phase || 'converting');
        const key = phase === 'preparing'
          ? 'preparing'
          : phase === 'publishing'
          ? 'publishing'
          : (phase === 'complete' ? 'complete' : 'converting');
        const message = phase === 'complete'
          ? copy('complete')
          : copy(key, {
              current: Number(payload.current) || 1,
              total: Number(payload.total) || files.length,
              file: String(payload.fileName || '')
            });
        setProgress(payload.percent, message);
      });
      if (!isOpenSession(owner) || cancelling || operation !== operationSequence) {
        unlisten();
        return;
      }
      releaseProgress = owner.use(unlisten);
      const outputDir = await getOutputDir?.('Excel_To_PDF');
      if (!isOpenSession(owner) || cancelling || operation !== operationSequence) return;
      nativeStarted = true;
      const result = await invoke('convert_excel_to_pdf', {
        inputPaths,
        outputDir,
        options: {
          sheetRange: settings.sheets,
          orientation: settings.orientation,
          paper: settings.paper,
          scale: settings.scale
        }
      });
      if (!isOpenSession(owner) || operation !== operationSequence) return;
      setProgress(100, copy('complete'));
      showSuccess(result);
    } catch (error) {
      if (isOpenSession(owner) && !cancelling && operation === operationSequence
          && !/runtime-missing/i.test(String(error?.message || error))) {
        notify(conversionErrorMessage(error));
      }
    } finally {
      releaseProgress();
      if (operation === operationSequence) {
        processing = false;
        cancelling = false;
        nativeStarted = false;
      }
      if (isOpenSession(owner) && operation === operationSequence) {
        setProgress(0, copy('processing'), false);
        overlay.querySelectorAll('[data-setting-value], [data-excel-action="upload"], [data-excel-action="clear"], [data-remove-file]')
          .forEach(node => { node.disabled = false; });
        renderFiles();
      }
    }
  }

  async function startNativeDragListener(owner) {
    if (!isTauri || !isOpenSession(owner)) return;
    try {
      const { getCurrentWebview } = await loadTauriWebview();
      const unlisten = await getCurrentWebview().onDragDropEvent(event => {
        if (!isOpenSession(owner) || processing) return;
        const payload = event.payload || {};
        if (payload.type === 'enter' || payload.type === 'over') {
          overlay.classList.add('drag-over');
          dropZone.classList.add('visible');
        } else if (payload.type === 'leave') {
          overlay.classList.remove('drag-over');
          dropZone.classList.remove('visible');
        } else if (payload.type === 'drop') {
          overlay.classList.remove('drag-over');
          dropZone.classList.remove('visible');
          addRecords((payload.paths || []).map(path => ({
            path,
            name: excelWorkbookNameFromPath(path)
          })));
        }
      });
      if (!isOpenSession(owner)) unlisten();
      else owner.use(unlisten);
    } catch {
      // Browser drag/drop remains available when the native listener cannot start.
    }
  }

  function open() {
    if (disposed || session) return;
    const owner = createLifecycleScope();
    session = owner;
    overlay.classList.add('visible');
    overlay.inert = false;
    overlay.setAttribute('aria-hidden', 'false');
    plasmaInstance = initStandardToolPlasma?.(background) || plasmaInstance;
    renderLocale();
    void startNativeDragListener(owner);
  }

  function close({ force = false } = {}) {
    if (!session) return true;
    if (processing && !force) {
      notify(copy('busy'));
      return false;
    }
    const owner = session;
    session = null;
    operationSequence += 1;
    owner.dispose();
    moveFocusOutOfHiddenRegion(overlay);
    overlay.inert = true;
    overlay.classList.remove('visible', 'drag-over');
    overlay.setAttribute('aria-hidden', 'true');
    dropZone.classList.remove('visible');
    processMask.classList.remove('visible');
    hideSuccess();
    plasmaInstance = disposeStandardToolPlasma?.(plasmaInstance) || null;
    return true;
  }

  function dispose() {
    if (disposed) return;
    if (nativeStarted && !cancelling) {
      cancelling = true;
      void invoke('cancel_convert').catch(() => {});
    }
    close({ force: true });
    disposed = true;
    lifecycle.dispose();
    overlay.replaceChildren();
  }

  function handleClick(event) {
    const remove = event.target.closest('[data-remove-file]');
    if (remove) {
      if (processing) return;
      files = files.filter(file => file.id !== Number(remove.dataset.removeFile));
      renderFiles();
      return;
    }
    const settingButton = event.target.closest('[data-setting-value]');
    if (settingButton) {
      if (processing) return;
      const group = settingButton.closest('[data-setting-group]');
      if (!group) return;
      settings[group.dataset.settingGroup] = settingButton.dataset.settingValue;
      group.querySelectorAll('[data-setting-value]').forEach(button => {
        const active = button === settingButton;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      return;
    }
    const action = event.target.closest('[data-excel-action]')?.dataset.excelAction;
    if (action === 'back') close();
    else if (action === 'upload') void chooseFiles();
    else if (action === 'clear') {
      if (processing) return;
      files = [];
      renderFiles();
    } else if (action === 'convert') void startConversion();
    else if (action === 'cancel' && processing && !cancelling) {
      cancelling = true;
      setProgress(Number.parseFloat(progressBar.style.width) || 0, copy('cancelling'));
      if (nativeStarted) void invoke('cancel_convert').catch(() => {});
    } else if (action === 'success-ok') {
      hideSuccess({ restoreFocus: true });
    } else if (action === 'open-output' && lastOutputDir) {
      void invoke('open_path', { path: lastOutputDir })
        .catch(() => notify(copy('openFolderFailed')));
    } else if (action === 'website') openExternalUrl?.('https://toolknit.com');
    else if (action === 'support') openSupport?.();
    else if (action === 'settings') openSettings?.();

    const windowAction = event.target.closest('[data-window-action]')?.dataset.windowAction;
    if (windowAction) void handleWindowAction?.(windowAction);
  }

  lifecycle.event(overlay, 'click', handleClick);
  lifecycle.event(overlay, 'keydown', event => {
    if (event.key !== 'Escape') return;
    if (successOverlay.classList.contains('visible')) {
      event.preventDefault();
      event.stopPropagation();
      hideSuccess({ restoreFocus: true });
    }
  });
  lifecycle.event(fileInput, 'change', () => addBrowserFiles(fileInput.files));
  lifecycle.event(overlay, 'dragover', event => {
    if (!event.dataTransfer?.types?.includes('Files') || processing || !session) return;
    event.preventDefault();
    overlay.classList.add('drag-over');
    dropZone.classList.add('visible');
  });
  lifecycle.event(overlay, 'dragleave', event => {
    if (event.relatedTarget && overlay.contains(event.relatedTarget)) return;
    overlay.classList.remove('drag-over');
    dropZone.classList.remove('visible');
  });
  lifecycle.event(overlay, 'drop', event => {
    if (!event.dataTransfer?.files?.length || processing || !session) return;
    event.preventDefault();
    overlay.classList.remove('drag-over');
    dropZone.classList.remove('visible');
    addBrowserFiles(event.dataTransfer.files);
  });

  const unsubscribeLanguage = onLangChange(renderLocale) || (() => {});
  lifecycle.use(unsubscribeLanguage);
  hideSuccess();
  renderLocale();
  return { open, close, dispose };
}
