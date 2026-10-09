import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { readColorExtractorImageDimensions } from '../../color-extractor-core.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import {
  IconGenerationError,
  assertIconSource,
  assertIconSourceDimensions
} from './core.js';
import { generateIconArchive } from './generator.js';
import { discardIconArchiveOperation, publishIconArchive } from './publisher.js';

const WEBSITE_URL = 'https://toolknit.com';
const IMAGE_EXTENSIONS = Object.freeze(['png', 'jpg', 'jpeg', 'webp']);

function fileNameFromPath(path) {
  return String(path || '').split(/[/\\]/).pop() || String(path || '');
}

function mimeTypeFromName(name) {
  if (/\.png$/i.test(name || '')) return 'image/png';
  if (/\.webp$/i.test(name || '')) return 'image/webp';
  return 'image/jpeg';
}

function outputParentFolder(path) {
  const value = String(path || '').trim().replace(/[/\\]+$/, '');
  if (!value) return '';
  const parent = value.replace(/[/\\][^/\\]+$/, '');
  return parent && parent !== value ? parent : value;
}

function setInteractiveLayer(element, visible) {
  if (!element) return;
  element.classList.toggle('visible', visible);
  element.setAttribute('aria-hidden', visible ? 'false' : 'true');
  element.inert = !visible;
}

function createDefaultImageDecoder(objectUrl, documentRef) {
  const ImageConstructor = documentRef.defaultView?.Image || Image;
  const image = new ImageConstructor();
  let settled = false;
  let rejectPending = null;
  const cleanup = () => {
    image.onload = null;
    image.onerror = null;
  };
  const promise = new Promise((resolve, reject) => {
    rejectPending = reject;
    image.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Failed to decode image'));
    };
    image.src = objectUrl;
  });
  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      cleanup();
      image.src = '';
      rejectPending?.(new IconGenerationError('cancelled', 'Icon source decoding was cancelled.'));
    }
  };
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

export function createIconGeneratorController({
  overlay,
  portal,
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
  createImageDecoder = createDefaultImageDecoder,
  generateArchive = generateIconArchive,
  publishArchive = publishIconArchive,
  discardArchive = discardIconArchiveOperation,
  urlApi = URL
} = {}) {
  if (!overlay || !portal) throw new Error('icon-generator:missing-dom');
  if (typeof getOutputDir !== 'function') throw new Error('icon-generator:missing-output-directory');
  const documentRef = overlay.ownerDocument || document;
  const byId = id => documentRef.getElementById(id);
  const background = byId('iconGenPlasmaBg');
  const back = byId('iconGenBack');
  const cta = byId('iconGenCta');
  const fileList = byId('iconGenFiles');
  const dropZone = byId('iconGenDropZone');
  const processButton = byId('iconGenProcessBtn');
  const processMask = byId('iconGenProcessMask');
  const progressFill = byId('iconGenProcessBarFill');
  const progressText = byId('iconGenProcessText');
  const cancelButton = byId('iconGenCancelBtn');
  const successOverlay = byId('iconGenSuccessOverlay');
  const successMeta = byId('iconGenSuccessMeta');
  const successCount = byId('iconGenSuccessCount');
  const successPath = byId('iconGenSuccessPath');
  const openFolder = byId('iconGenOpenFolder');
  const successOk = byId('iconGenSuccessOk');
  if (!fileList || !cta || !processButton || !processMask || !successOverlay) {
    throw new Error('icon-generator:incomplete-dom');
  }

  const lifecycle = createLifecycleScope();
  const browserInput = !isTauri ? documentRef.createElement('input') : null;
  let session = null;
  let renderScope = null;
  let plasma = null;
  let selectedFile = null;
  let selectedImage = null;
  let selectedFileSize = 0;
  let selectedObjectUrl = '';
  let sourceSequence = 0;
  let activeSourceRequest = null;
  let operationSequence = 0;
  let activeOperation = null;
  let processing = false;
  let outputPath = '';
  let lastCount = 0;
  let successRevision = 0;
  let openingFolder = false;
  let buttonRevision = 0;
  let disposed = false;

  const isOpenSession = owner => owner && owner === session && !owner.disposed
    && overlay.classList.contains('visible') && !disposed;
  const isCurrentSourceRequest = request => request && request === activeSourceRequest
    && request.id === sourceSequence && isOpenSession(request.owner);
  const isCurrentOperation = operation => operation && operation === activeOperation
    && operation.id === operationSequence && !operation.cancelled && isOpenSession(operation.owner);

  if (browserInput) {
    browserInput.type = 'file';
    browserInput.accept = 'image/png,image/jpeg,image/webp';
    browserInput.hidden = true;
    documentRef.body.append(browserInput);
    lifecycle.event(browserInput, 'change', () => {
      const file = browserInput.files?.[0];
      browserInput.value = '';
      if (file) void selectSource(file);
    });
    lifecycle.use(() => browserInput.remove());
  }

  function showDropZone() {
    if (processing) return;
    overlay.classList.add('drag-over');
    dropZone?.classList.add('visible');
  }

  function hideDropZone() {
    overlay.classList.remove('drag-over');
    dropZone?.classList.remove('visible');
  }

  function setProgress(percent, phase = 'archive') {
    const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if (progressFill) progressFill.style.width = `${value}%`;
    if (!progressText) return;
    const key = {
      ico: 'home.iconGen.genIco',
      svg: 'home.iconGen.genSvg',
      favicon: 'home.iconGen.genFavicon'
    }[phase] || 'home.iconGen.processing';
    progressText.textContent = t(key);
  }

  function setProcessing(visible) {
    processing = visible;
    setInteractiveLayer(processMask, visible);
    processButton.disabled = visible;
    processButton.textContent = t(visible ? 'home.iconGen.processing' : 'home.iconGen.processBtn');
    if (!visible) setProgress(0);
  }

  function updateProcessButton() {
    const revision = ++buttonRevision;
    if (selectedFile) {
      processButton.style.display = '';
      const owner = session;
      let releaseFrame = null;
      const frame = requestAnimationFrame(() => {
        releaseFrame?.();
        if (revision === buttonRevision && selectedFile && (!owner || isOpenSession(owner))) {
          processButton.classList.add('visible');
        }
      });
      releaseFrame = owner?.use(() => cancelAnimationFrame(frame)) || null;
      return;
    }
    processButton.classList.remove('visible');
    const owner = renderScope || session;
    const finish = () => {
      if (revision === buttonRevision && !selectedFile) processButton.style.display = 'none';
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

  function revokeRequestUrl(request) {
    if (!request?.objectUrl) return;
    urlApi.revokeObjectURL(request.objectUrl);
    request.objectUrl = '';
  }

  function invalidateSourceRequest() {
    sourceSequence += 1;
    const request = activeSourceRequest;
    activeSourceRequest = null;
    request?.cancelDecode?.();
    revokeRequestUrl(request);
  }

  function releaseSelectedSource() {
    renderScope?.dispose();
    renderScope = null;
    fileList.replaceChildren();
    fileList.classList.remove('has-files');
    if (selectedObjectUrl) urlApi.revokeObjectURL(selectedObjectUrl);
    selectedObjectUrl = '';
    selectedFile = null;
    selectedImage = null;
    selectedFileSize = 0;
    updateProcessButton();
  }

  function renderSource() {
    renderScope?.dispose();
    renderScope = createLifecycleScope();
    fileList.replaceChildren();
    fileList.classList.add('has-files');
    const item = documentRef.createElement('div');
    item.className = 'audio-convert-file-item';
    const thumbnail = documentRef.createElement('img');
    thumbnail.className = 'audio-convert-file-thumb';
    thumbnail.src = selectedObjectUrl;
    thumbnail.alt = 'preview';
    const name = documentRef.createElement('span');
    name.className = 'audio-convert-file-name';
    name.textContent = String(selectedFile?.name || fileNameFromPath(selectedFile?.path));
    name.title = name.textContent;
    const size = documentRef.createElement('span');
    size.className = 'audio-convert-file-size';
    size.textContent = `${(selectedFileSize / 1024).toFixed(1)} KB`;
    const remove = documentRef.createElement('button');
    remove.className = 'audio-convert-file-remove';
    remove.type = 'button';
    remove.setAttribute('aria-label', 'remove');
    const icon = documentRef.createElement('i');
    icon.dataset.lucide = 'x';
    remove.append(icon);
    renderScope.event(remove, 'click', () => {
      if (!processing) releaseSelectedSource();
    });
    item.append(thumbnail, name, size, remove);
    fileList.append(item);
    updateProcessButton();
    refreshIcons();
  }

  async function readSource(file) {
    if (isTauri && file?.path) {
      const { invoke } = await tauriCore;
      const prepared = await invoke('prepare_icon_source_image', { path: file.path });
      const rawBytes = prepared?.bytes;
      const bytes = Array.isArray(rawBytes) ? Uint8Array.from(rawBytes) : new Uint8Array(rawBytes);
      return {
        bytes,
        mimeType: 'image/png',
        sourceSize: Number(prepared?.source_bytes) || bytes.byteLength,
        dimensions: { width: Number(prepared?.width), height: Number(prepared?.height) }
      };
    }
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: mimeTypeFromName(file?.name),
      sourceSize: Number(file?.size) || 0,
      dimensions: null
    };
  }

  async function selectSource(file) {
    if (processing || !isOpenSession(session)) return;
    invalidateSourceRequest();
    const request = { id: sourceSequence, owner: session, objectUrl: '', cancelDecode: null };
    activeSourceRequest = request;
    try {
      let sourceSize = Number(file?.size);
      if (isTauri && file?.path) {
        const { invoke } = await tauriCore;
        sourceSize = Number(await invoke('get_file_size', { path: file.path }));
        if (!isCurrentSourceRequest(request)) return;
      }
      assertIconSource(file, sourceSize);
      const prepared = await readSource(file);
      if (!isCurrentSourceRequest(request)) return;
      const dimensions = prepared.dimensions || readColorExtractorImageDimensions(prepared.bytes);
      if (!dimensions) throw new IconGenerationError('invalid_image_data', t('home.iconGen.decodeError'));
      assertIconSourceDimensions(dimensions.width, dimensions.height);
      request.objectUrl = urlApi.createObjectURL(new Blob([prepared.bytes], { type: prepared.mimeType }));
      const decoder = createImageDecoder(request.objectUrl, documentRef);
      request.cancelDecode = decoder.cancel;
      const image = await decoder.promise;
      request.cancelDecode = null;
      if (!isCurrentSourceRequest(request)) return;
      assertIconSourceDimensions(
        Number(image.naturalWidth || image.width),
        Number(image.naturalHeight || image.height)
      );
      releaseSelectedSource();
      selectedObjectUrl = request.objectUrl;
      request.objectUrl = '';
      selectedFile = file;
      selectedImage = image;
      selectedFileSize = prepared.sourceSize || sourceSize;
      activeSourceRequest = null;
      renderSource();
    } catch (error) {
      if (!isCurrentSourceRequest(request)) return;
      activeSourceRequest = null;
      console.error('Icon source validation failed:', error);
      const message = error instanceof IconGenerationError ? error.message : t('home.iconGen.invalidFormat');
      showError(t('home.iconGen.inputError', { error: message }));
    } finally {
      request.cancelDecode = null;
      revokeRequestUrl(request);
      if (activeSourceRequest === request) activeSourceRequest = null;
    }
  }

  async function pickSource() {
    if (processing || !isOpenSession(session)) return;
    const owner = session;
    if (!isTauri) {
      browserInput?.click();
      return;
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Image Files', extensions: IMAGE_EXTENSIONS }]
      });
      if (!isOpenSession(owner) || typeof selected !== 'string') return;
      void selectSource({ name: fileNameFromPath(selected), path: selected, size: 0, type: mimeTypeFromName(selected) });
    } catch (error) {
      if (isOpenSession(owner)) console.error('Icon gen file selection error:', error);
    }
  }

  async function registerNativeDrop(owner) {
    if (!isTauri) return;
    try {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      const unlisten = await getCurrentWebview().onDragDropEvent(event => {
        if (!isOpenSession(owner) || processing) return;
        const payload = event.payload || {};
        if (payload.type === 'enter' || payload.type === 'over') showDropZone();
        else if (payload.type === 'leave') hideDropZone();
        else if (payload.type === 'drop') {
          hideDropZone();
          const path = (payload.paths || []).find(candidate => IMAGE_EXTENSIONS.some(extension => candidate.toLowerCase().endsWith(`.${extension}`)));
          if (path) void selectSource({ name: fileNameFromPath(path), path, size: 0, type: mimeTypeFromName(path) });
        }
      });
      owner.use(unlisten);
    } catch (error) {
      if (isOpenSession(owner)) console.error('Cannot register icon generator drag and drop:', error);
    }
  }

  function cancelOperation() {
    const operation = activeOperation;
    const wasProcessing = processing;
    operationSequence += 1;
    activeOperation = null;
    if (operation) operation.cancelled = true;
    setProcessing(false);
    if (isTauri && operation?.archiveSessionId !== null && operation?.archiveSessionId !== undefined) {
      void discardArchive(operation, tauriCore);
    }
    return wasProcessing;
  }

  function updateSuccessContent() {
    if (successCount) successCount.textContent = `${lastCount} ${t('home.iconGen.successCountUnit')}`;
    if (successMeta) successMeta.textContent = t('home.iconGen.successSummary', { count: lastCount });
    const canOpenFolder = isTauri && Boolean(outputPath);
    if (successPath) {
      successPath.textContent = canOpenFolder
        ? displayFilesystemPath(outputParentFolder(outputPath))
        : t('home.iconGen.browserDownloadLocation');
      successPath.title = successPath.textContent;
    }
    if (openFolder) {
      openFolder.disabled = !canOpenFolder || openingFolder;
      openFolder.title = canOpenFolder ? '' : t('home.iconGen.browserOpenFolderUnavailable');
    }
  }

  function showSuccess(count) {
    successRevision += 1;
    lastCount = count;
    openingFolder = false;
    updateSuccessContent();
    setInteractiveLayer(successOverlay, true);
  }

  function closeSuccess() {
    successRevision += 1;
    openingFolder = false;
    if (successOverlay.contains(documentRef.activeElement)) processButton.focus({ preventScroll: true });
    setInteractiveLayer(successOverlay, false);
  }

  async function openSuccessFolder() {
    if (!isTauri || !outputPath || openingFolder || !successOverlay.classList.contains('visible')) return;
    const owner = session;
    const revision = successRevision;
    const isCurrentResult = () => isOpenSession(owner) && revision === successRevision;
    openingFolder = true;
    updateSuccessContent();
    try {
      const opened = await openOutputFolder(outputPath);
      if (isCurrentResult() && opened !== false) closeSuccess();
    } catch {
      if (isCurrentResult()) showError(t('common.openFolderFailed'));
    } finally {
      if (isCurrentResult()) {
        openingFolder = false;
        updateSuccessContent();
      }
    }
  }

  async function startProcessing() {
    if (processing || !selectedFile || !selectedImage || !isOpenSession(session)) return;
    const operation = {
      id: ++operationSequence,
      owner: session,
      cancelled: false,
      archiveSessionId: null
    };
    activeOperation = operation;
    outputPath = '';
    setProcessing(true);
    const assertActive = () => {
      if (!isCurrentOperation(operation)) {
        throw new IconGenerationError('cancelled', 'Icon generation was cancelled.');
      }
    };
    try {
      const result = await generateArchive({
        image: selectedImage,
        assertActive,
        onProgress: ({ percent, phase }) => {
          assertActive();
          setProgress(percent, phase);
        }
      });
      assertActive();
      const published = await publishArchive({
        blob: result.blob,
        operation,
        assertActive,
        isTauri,
        tauriCore,
        getOutputDir,
        documentRef,
        urlApi
      });
      assertActive();
      outputPath = typeof published.savedPath === 'string' ? published.savedPath.trim() : '';
      if (isTauri && !outputPath) throw new Error('icon-generator:missing-output-path');
      setProgress(100);
      await waitForScope(operation.owner, 400);
      assertActive();
      setProcessing(false);
      showSuccess(result.count);
    } catch (error) {
      if (!isCurrentOperation(operation) || error instanceof IconGenerationError && error.code === 'cancelled') return;
      console.error('Icon generation error:', error);
      setProcessing(false);
      showError(t('home.iconGen.error'));
    } finally {
      if (activeOperation === operation) activeOperation = null;
      if (operation.id === operationSequence && isOpenSession(operation.owner)) setProcessing(false);
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
      const file = event.dataTransfer?.files?.[0];
      if (file) void selectSource(file);
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
    invalidateSourceRequest();
    cancelOperation();
    closeSuccess();
    hideDropZone();
    session?.dispose();
    session = null;
    releaseSelectedSource();
    outputPath = '';
    lastCount = 0;
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    plasma = disposeStandardToolPlasma(plasma);
  }

  lifecycle.event(back, 'click', close);
  lifecycle.event(cta, 'click', () => { void pickSource(); });
  lifecycle.event(processButton, 'click', () => { void startProcessing(); });
  lifecycle.event(cancelButton, 'click', cancelOperation);
  lifecycle.event(successOk, 'click', closeSuccess);
  lifecycle.event(openFolder, 'click', () => { void openSuccessFolder(); });
  lifecycle.event(overlay.querySelector('[data-home-link="website"]'), 'click', event => {
    event.preventDefault();
    void openExternalUrl(WEBSITE_URL);
  });
  lifecycle.event(overlay.querySelector('[data-open-support]'), 'click', () => openSupport());
  lifecycle.event(byId('iconGenV2Settings'), 'click', () => openSettings());
  overlay.querySelectorAll('.ctrl-btn[data-action]').forEach(button => {
    lifecycle.event(button, 'pointerdown', event => event.stopPropagation(), { capture: true });
    lifecycle.event(button, 'mousedown', event => event.stopPropagation(), { capture: true });
    lifecycle.event(button, 'click', event => {
      event.preventDefault();
      event.stopPropagation();
      void handleWindowAction(button.dataset.action);
    });
  });
  lifecycle.use(onLangChange(() => {
    if (successOverlay.classList.contains('visible') && lastCount) updateSuccessContent();
    else if (!processing) setProgress(0);
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
