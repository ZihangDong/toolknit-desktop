import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { tauriCorePromise, tauriEventPromise } from '../../platform/tauri-runtime.js';
import { bindPointerSortableFileList } from '../../shared/sortable-file-list.js';
import {
  ImageBatchError,
  getImageBatchFailureSummary,
  getImageCompressionOutcome,
  normalizeImageCompressionQuality,
  normalizeImageTargetFormat,
  validateImageCompressionSelection,
  validateImageBatchSelection
} from '../../image-batch-core.js';

const CONFIGS = Object.freeze({
  convert: Object.freeze({
    root: 'imageConvert',
    translationRoot: 'home.imageConvert',
    extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'],
    defaultOption: 'PNG',
    optionAttribute: 'format',
    optionContainerId: 'imageConvertFormatOptions',
    command: 'convert_image_batch',
    validate: validateImageBatchSelection,
    normalize: normalizeImageTargetFormat
  }),
  compress: Object.freeze({
    root: 'imageCompress',
    translationRoot: 'home.imageCompress',
    extensions: ['jpg', 'jpeg', 'png', 'webp'],
    defaultOption: 'medium',
    optionAttribute: 'quality',
    optionContainerId: 'imageCompressQualityOptions',
    command: 'compress_image_batch',
    validate: validateImageCompressionSelection,
    normalize: normalizeImageCompressionQuality
  })
});

const QUALITY_LABELS = Object.freeze({
  high: 'home.imageCompress.qualityHigh',
  medium: 'home.imageCompress.qualityMedium',
  low: 'home.imageCompress.qualityLow'
});
const WEBSITE_URL = 'https://toolknit.com';

function fileNameFromPath(path) {
  return String(path || '').split(/[/\\]/).pop() || String(path || '');
}

function setInteractiveLayer(element, visible) {
  if (!element) return;
  element.classList.toggle('visible', visible);
  element.setAttribute('aria-hidden', visible ? 'false' : 'true');
  element.inert = !visible;
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  let value = Number(bytes);
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return index === 0 ? `${value} ${units[index]}` : `${value.toFixed(2)} ${units[index]}`;
}

function waitForScope(scope, delay) {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      release();
      resolve();
    };
    const timer = setTimeout(finish, delay);
    const release = scope.use(() => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve();
      }
    });
  });
}

export function createImageBatchController({
  overlay,
  portal,
  mode,
  isTauri = false,
  t = key => key,
  onLangChange = () => () => {},
  getOutputDir,
  displayFilesystemPath = value => String(value || ''),
  openOutputFolder = async () => false,
  refreshIcons = () => {},
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = instance => instance,
  openSettings = () => {},
  openSupport = () => {},
  openExternalUrl = () => {},
  handleWindowAction = () => {},
  showError = message => window.alert(message),
  tauriCore = tauriCorePromise,
  tauriEvents = tauriEventPromise
} = {}) {
  const config = CONFIGS[mode];
  if (!config) throw new Error(`image-batch:unknown-mode:${mode}`);
  if (!overlay || !portal) throw new Error(`image-batch:missing-dom:${mode}`);
  if (typeof getOutputDir !== 'function') throw new Error(`image-batch:missing-output-directory:${mode}`);

  const byId = id => document.getElementById(id);
  const root = config.root;
  const background = byId(`${root}PlasmaBg`);
  const back = byId(`${root}Back`);
  const dropZone = byId(`${root}DropZone`);
  const fileList = byId(`${root}Files`);
  const cta = byId(`${root}Cta`);
  const processButton = byId(`${root}ProcessBtn`);
  const processMask = byId(`${root}ProcessMask`);
  const progressFill = byId(`${root}ProcessBarFill`);
  const progressText = byId(`${root}ProcessText`);
  const cancelButton = byId(`${root}CancelBtn`);
  const optionContainer = byId(config.optionContainerId);
  const successOverlay = byId(`${root}SuccessOverlay`);
  const successMeta = byId(`${root}SuccessMeta`);
  const successFormat = byId(`${root}SuccessFormat`);
  const successCount = byId(`${root}SuccessCount`);
  const successPath = byId(`${root}SuccessPath`);
  const failureSummary = byId(`${root}FailureSummary`);
  const openFolder = byId(`${root}OpenFolder`);
  const successOk = byId(`${root}SuccessOk`);

  if (!fileList || !cta || !processButton || !processMask || !successOverlay) {
    throw new Error(`image-batch:incomplete-dom:${mode}`);
  }

  const lifecycle = createLifecycleScope();
  const browserInput = !isTauri ? document.createElement('input') : null;
  let session = null;
  let renderScope = null;
  let files = [];
  let selectedOption = config.defaultOption;
  let processing = false;
  let activeOperation = null;
  let operationSequence = 0;
  let plasma = null;
  let outputPath = '';
  let lastResult = null;
  let buttonRevision = 0;
  let nativeDropGuardUntil = 0;
  let disposed = false;

  const isOpenSession = owner => owner && owner === session && !owner.disposed
    && overlay.classList.contains('visible') && !disposed;
  const isCurrentOperation = operation => operation && operation === activeOperation
    && isOpenSession(operation.owner) && operation.id === operationSequence;

  if (browserInput) {
    browserInput.type = 'file';
    browserInput.accept = 'image/*';
    browserInput.multiple = true;
    browserInput.hidden = true;
    document.body.append(browserInput);
    lifecycle.event(browserInput, 'change', () => {
      addFiles(browserInput.files);
      browserInput.value = '';
    });
    lifecycle.use(() => browserInput.remove());
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

  function setProgress(percent, detail = {}) {
    const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if (progressFill) progressFill.style.width = `${value}%`;
    if (!progressText) return;
    progressText.textContent = Number(detail.total) > 0
      ? `${t(`${config.translationRoot}.processing`)} (${detail.current}/${detail.total})`
      : t(`${config.translationRoot}.processing`);
  }

  function setProcessing(visible) {
    processing = visible;
    setInteractiveLayer(processMask, visible);
    if (!visible) setProgress(0);
    processButton.disabled = visible;
  }

  function updateProcessButton() {
    const revision = ++buttonRevision;
    if (files.length > 0) {
      processButton.style.display = '';
      const owner = session;
      let releaseFrame = null;
      const frame = requestAnimationFrame(() => {
        releaseFrame?.();
        if (revision === buttonRevision && (!owner || isOpenSession(owner))) {
          processButton.classList.add('visible');
        }
      });
      releaseFrame = owner?.use(() => cancelAnimationFrame(frame)) || null;
      return;
    }
    processButton.classList.remove('visible');
    const owner = renderScope || session;
    const finish = () => {
      if (revision === buttonRevision && files.length === 0) processButton.style.display = 'none';
    };
    const release = (owner || lifecycle).event(processButton, 'transitionend', event => {
      if (event.propertyName !== 'opacity') return;
      release();
      finish();
    });
    const timer = setTimeout(() => {
      release();
      finish();
    }, 320);
    owner?.use(() => clearTimeout(timer));
  }

  function renderFiles() {
    renderScope?.dispose();
    renderScope = createLifecycleScope();
    fileList.replaceChildren();
    fileList.classList.toggle('has-files', files.length > 0);
    files.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'audio-convert-file-item';
      item.dataset.index = String(index);
      const number = document.createElement('span');
      number.className = 'audio-convert-file-index';
      const numberText = document.createElement('span');
      numberText.textContent = String(index + 1);
      number.append(numberText);
      const name = document.createElement('span');
      name.className = 'audio-convert-file-name';
      name.textContent = String(file?.name || fileNameFromPath(file?.path) || t('common.unnamedFile'));
      name.title = name.textContent;
      const remove = document.createElement('button');
      remove.className = 'audio-convert-file-remove';
      remove.type = 'button';
      remove.setAttribute('aria-label', 'remove');
      const icon = document.createElement('i');
      icon.dataset.lucide = 'x';
      remove.append(icon);
      renderScope.event(remove, 'click', event => {
        event.stopPropagation();
        if (processing) return;
        files.splice(index, 1);
        renderFiles();
      });
      item.append(number, name, remove);
      fileList.append(item);
    });
    bindPointerSortableFileList({
      scope: renderScope,
      container: fileList,
      items: files,
      render: renderFiles,
      isLocked: () => processing,
      guardNativeDrop: duration => { nativeDropGuardUntil = performance.now() + duration; }
    });
    updateProcessButton();
    refreshIcons();
  }

  function addFiles(fileListValue) {
    if (!fileListValue || processing) return;
    const nextFiles = [...files];
    for (const file of fileListValue) {
      const duplicate = file?.path
        ? nextFiles.some(item => item.path === file.path)
        : nextFiles.some(item => item.name === file?.name && item.size === file?.size);
      if (!duplicate) nextFiles.push(file);
    }
    try {
      config.validate(nextFiles);
    } catch (error) {
      const message = error instanceof ImageBatchError
        ? error.message
        : t(`${config.translationRoot}.conversionError`);
      showError(t(`${config.translationRoot}.selectionError`, { error: message }));
      return;
    }
    files = nextFiles;
    renderFiles();
  }

  function clearFiles() {
    files = [];
    renderFiles();
  }

  async function pickFiles() {
    if (processing) return;
    if (!isTauri) {
      browserInput?.click();
      return;
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: true,
        filters: [{ name: 'Image Files', extensions: config.extensions }]
      });
      if (!Array.isArray(selected)) return;
      addFiles(selected.map(path => ({ name: fileNameFromPath(path), path, size: 0 })));
    } catch (error) {
      console.error(`${mode === 'convert' ? 'Image' : 'Image compress'} file selection error`, error);
    }
  }

  async function registerNativeDrop(owner) {
    if (!isTauri) return;
    try {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      const unlisten = await getCurrentWebview().onDragDropEvent(event => {
        if (!isOpenSession(owner) || processing || performance.now() < nativeDropGuardUntil) return;
        const payload = event.payload || {};
        if (payload.type === 'enter' || payload.type === 'over') showDropZone();
        else if (payload.type === 'leave') hideDropZone();
        else if (payload.type === 'drop') {
          hideDropZone();
          const accepted = (payload.paths || [])
            .filter(path => config.extensions.some(extension => path.toLowerCase().endsWith(`.${extension}`)))
            .map(path => ({ name: fileNameFromPath(path), path, size: 0 }));
          addFiles(accepted);
        }
      });
      owner.use(unlisten);
    } catch (error) {
      if (isOpenSession(owner)) console.error(`Cannot register ${mode} image drag and drop:`, error);
    }
  }

  function releaseOperation(operation) {
    operation?.releaseProgress?.();
    if (activeOperation === operation) activeOperation = null;
  }

  function cancelOperation({ invokeNative = true } = {}) {
    const operation = activeOperation;
    const wasProcessing = processing;
    operationSequence += 1;
    releaseOperation(operation);
    setProcessing(false);
    if (isTauri && invokeNative && wasProcessing) {
      void tauriCore
        .then(({ invoke }) => invoke('cancel_convert', { toolknitTaskTool: mode === 'convert' ? 'image-convert' : 'image-compress' }))
        .catch(error => console.error('Cancel failed:', error));
    }
  }

  function renderFailureSummary(result) {
    if (!failureSummary) return;
    const { failCount, visibleErrors, remainingCount } = getImageBatchFailureSummary(result);
    if (!failCount) {
      failureSummary.hidden = true;
      failureSummary.textContent = '';
      return;
    }
    const lines = [t(`${config.translationRoot}.failureDetails`, { count: failCount })];
    lines.push(...visibleErrors.map(error => `- ${error}`));
    if (remainingCount > 0) lines.push(t(`${config.translationRoot}.failureMore`, { count: remainingCount }));
    failureSummary.textContent = lines.join('\n');
    failureSummary.hidden = false;
  }

  function compressionQualityText() {
    const base = t(QUALITY_LABELS[selectedOption] || QUALITY_LABELS.medium);
    const hasLossless = files.some(file => /\.(png|webp)$/i.test(file?.name || ''));
    const hasJpeg = files.some(file => /\.jpe?g$/i.test(file?.name || ''));
    if (!hasLossless) return base;
    return hasJpeg ? `${base} / ${t('home.imageCompress.lossless')}` : t('home.imageCompress.lossless');
  }

  function showSuccess(result) {
    lastResult = result;
    outputPath = result?.output_dir || (isTauri
      ? `C:\\Users\\Downloads\\toolknit-${mode === 'convert' ? 'converted' : 'compressed'}`
      : `~/Downloads/toolknit-${mode === 'convert' ? 'converted' : 'compressed'}`);
    const count = result?.success_count ?? files.length;
    const failed = result?.fail_count ?? 0;
    const unchanged = mode === 'compress'
      ? getImageCompressionOutcome(result, files.length).unchangedCount : 0;
    const format = mode === 'convert' ? selectedOption : compressionQualityText();
    const firstName = files[0]?.name || '';
    let summary;
    if (unchanged > 0) summary = t('home.imageCompress.resultSummary', { success: count, unchanged, fail: failed, format });
    else if (failed > 0 && count > 0) summary = t(`${config.translationRoot}.successSummaryPartial`, { success: count, fail: failed, format });
    else if (failed > 0) summary = t(`${config.translationRoot}.allFailed`, { count: failed });
    else if (count > 1) summary = t(`${config.translationRoot}.successSummaryPlural`, { count, format });
    else summary = t(`${config.translationRoot}.successSummarySingle`, { name: firstName, format });
    if (successMeta) successMeta.textContent = summary;
    if (mode === 'compress') {
      const icon = successOverlay.querySelector('.audio-convert-success-icon');
      if (icon) {
        icon.dataset.resultState = count > 0 && failed === 0 ? 'success' : 'info';
        const glyph = document.createElement('i');
        glyph.dataset.lucide = icon.dataset.resultState === 'success' ? 'check' : 'info';
        icon.replaceChildren(glyph);
        refreshIcons();
      }
    }
    if (successFormat) successFormat.textContent = format;
    if (successCount) successCount.textContent = `${count} ${t(`${config.translationRoot}.successCountUnit`)}`;
    if (openFolder) openFolder.disabled = count === 0;
    if (successPath) successPath.textContent = count === 0 && mode === 'compress'
      ? t('home.imageCompress.noSmallerOutput') : displayFilesystemPath(outputPath);
    if (mode === 'compress') {
      const originalSize = Number(result?.original_size) || 0;
      const compressedSize = Number(result?.compressed_size) || 0;
      const saved = originalSize - compressedSize;
      const percent = originalSize > 0 ? Math.round((saved / originalSize) * 100) : 0;
      const original = byId('imageCompressSuccessOriginalSize');
      const compressed = byId('imageCompressSuccessCompressedSize');
      const savedElement = byId('imageCompressSuccessSavedSize');
      if (original) original.textContent = formatBytes(originalSize);
      if (compressed) compressed.textContent = formatBytes(compressedSize);
      if (savedElement) savedElement.textContent = `${formatBytes(saved)} (${percent}%)`;
    }
    renderFailureSummary(result);
    setInteractiveLayer(successOverlay, true);
  }

  function closeSuccess() {
    setInteractiveLayer(successOverlay, false);
    lastResult = null;
    clearFiles();
  }

  async function startProcessing() {
    if (processing || files.length === 0 || !isOpenSession(session)) return;
    try {
      config.validate(files);
      selectedOption = config.normalize(selectedOption);
    } catch (error) {
      const message = error instanceof ImageBatchError
        ? error.message
        : t(`${config.translationRoot}.conversionError`);
      showError(t(`${config.translationRoot}.selectionError`, { error: message }));
      return;
    }
    if (!isTauri) {
      showError(t(`${config.translationRoot}.desktopOnly`));
      return;
    }

    const operation = { id: ++operationSequence, owner: session, releaseProgress: null };
    activeOperation = operation;
    setProcessing(true);
    try {
      const [{ invoke }, { listen }] = await Promise.all([tauriCore, tauriEvents]);
      if (!isCurrentOperation(operation)) return;
      const finalOutputDir = await getOutputDir('Images');
      if (!isCurrentOperation(operation)) return;
      const inputPaths = files.map(file => file?.path).filter(Boolean);
      if (!inputPaths.length) {
        releaseOperation(operation);
        setProcessing(false);
        showError(t('common.filePathsNotAvailableShort'));
        return;
      }
      const unlisten = await listen('convert-progress', event => {
        if (!isCurrentOperation(operation)) return;
        const data = event.payload || {};
        if (data.status !== 'converting') return;
        const total = Math.max(1, Number(data.total) || 1);
        const current = Math.max(1, Number(data.current) || 1);
        const progress = Math.max(0, Math.min(1, Number(data.progress) || 0));
        setProgress(Math.min(99, ((current - 1 + progress) / total) * 100), { current, total });
      });
      if (!isCurrentOperation(operation)) {
        unlisten();
        return;
      }
      operation.releaseProgress = operation.owner.use(unlisten);
      const args = mode === 'convert'
        ? { inputPaths, outputDir: finalOutputDir, targetFormat: selectedOption }
        : { inputPaths, outputDir: finalOutputDir, quality: selectedOption };
      const result = await invoke(config.command, args);
      if (!isCurrentOperation(operation)) return;
      operation.releaseProgress?.();
      operation.releaseProgress = null;
      setProgress(100);
      await waitForScope(operation.owner, 400);
      if (!isCurrentOperation(operation)) return;
      releaseOperation(operation);
      setProcessing(false);
      const unchanged = mode === 'compress'
        ? getImageCompressionOutcome(result, files.length).unchangedCount : 0;
      if (result?.success_count === 0 && result?.fail_count > 0 && unchanged === 0) {
        showError(t(`${config.translationRoot}.allFailed`, { count: result.fail_count }));
        return;
      }
      showSuccess(result);
    } catch (error) {
      if (!isCurrentOperation(operation)) return;
      console.error(`Image ${mode === 'convert' ? 'conversion' : 'compression'} failed:`, error);
      releaseOperation(operation);
      setProcessing(false);
      showError(t('common.errorOccurred', { error: error?.message || error }));
    }
  }

  function bindSession(owner) {
    owner.event(overlay, 'dragover', event => {
      event.preventDefault();
      if (isOpenSession(owner) && !processing) showDropZone();
    });
    owner.event(overlay, 'dragleave', event => {
      event.preventDefault();
      if (isOpenSession(owner)) hideDropZone();
    });
    owner.event(overlay, 'drop', event => {
      event.preventDefault();
      if (!isOpenSession(owner) || processing) return;
      hideDropZone();
      addFiles(event.dataTransfer?.files);
    });
    void registerNativeDrop(owner);
  }

  function open() {
    if (disposed) return;
    session?.dispose();
    session = createLifecycleScope();
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    plasma = initStandardToolPlasma(background);
    bindSession(session);
    refreshIcons();
  }

  function close() {
    cancelOperation();
    setInteractiveLayer(successOverlay, false);
    hideDropZone();
    session?.dispose();
    session = null;
    renderScope?.dispose();
    renderScope = null;
    files = [];
    fileList.replaceChildren();
    fileList.classList.remove('has-files');
    buttonRevision += 1;
    processButton.classList.remove('visible');
    processButton.style.display = 'none';
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    plasma = disposeStandardToolPlasma(plasma);
  }

  lifecycle.event(back, 'click', close);
  lifecycle.event(overlay.querySelector('[data-home-link="website"]'), 'click', event => {
    event.preventDefault();
    void openExternalUrl(WEBSITE_URL);
  });
  lifecycle.event(overlay.querySelector('[data-open-support]'), 'click', () => openSupport());
  lifecycle.event(overlay.querySelector('[id$="V2Settings"]'), 'click', () => openSettings());
  overlay.querySelectorAll('.ctrl-btn[data-action]').forEach(button => {
    lifecycle.event(button, 'pointerdown', event => event.stopPropagation(), { capture: true });
    lifecycle.event(button, 'mousedown', event => event.stopPropagation(), { capture: true });
    lifecycle.event(button, 'click', event => {
      event.preventDefault();
      event.stopPropagation();
      void handleWindowAction(button.dataset.action);
    });
  });
  lifecycle.event(cta, 'click', () => { void pickFiles(); });
  lifecycle.event(processButton, 'click', () => { void startProcessing(); });
  lifecycle.event(cancelButton, 'click', () => cancelOperation());
  lifecycle.event(successOk, 'click', closeSuccess);
  lifecycle.event(openFolder, 'click', () => {
    void (async () => {
      if (isTauri && outputPath) await openOutputFolder(outputPath);
      closeSuccess();
    })();
  });
  lifecycle.event(optionContainer, 'click', event => {
    const button = event.target.closest('.audio-convert-format-option');
    if (!button || processing) return;
    optionContainer.querySelectorAll('.audio-convert-format-option').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    selectedOption = config.normalize(button.dataset[config.optionAttribute]);
  });
  lifecycle.use(onLangChange(() => {
    if (lastResult && successOverlay.classList.contains('visible')) showSuccess(lastResult);
    else if (!processing && progressText) progressText.textContent = t(`${config.translationRoot}.processing`);
  }));

  setInteractiveLayer(processMask, false);
  setInteractiveLayer(successOverlay, false);
  updateProcessButton();

  return {
    open,
    close,
    dispose() {
      if (disposed) return;
      close();
      disposed = true;
      lifecycle.dispose();
      renderScope?.dispose();
    }
  };
}
