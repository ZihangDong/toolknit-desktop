import { applyTranslations } from '../../i18n.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession } from '../../app/modal-runtime.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import {
  PPT_IMAGE_EXTRACT_LIMITS,
  analyzePptxImages,
  createPptImageManifestMarkdown,
  normalizePptPageSelection,
  planPptImageExport,
  sanitizePptImageBaseName
} from '../../ppt-image-extract-core.js';
import {
  bindPptChrome,
  choosePptxFile,
  createOperationGuard,
  dragHasExternalFiles,
  isPptxFile,
  readPptxFile,
  registerNativePptxDrop,
  setInteractiveLayer,
  uniqueOutputDirectory,
  writeUniqueFile
} from '../ppt-workflows/shared.js';

function errorMessage(error, text) {
  const message = String(error?.userMessage || error?.message || error || '');
  const code = String(error?.code || '');
  const details = `${code} ${message}`;
  if (/invalid[-_]extension/i.test(details)) return text('unsupportedFormat');
  if (/input[-_]too[-_]large|too large/i.test(details)) return text('fileTooLarge');
  if (/too[-_]many[-_]slides/i.test(details)) return text('tooManySlides', { count: PPT_IMAGE_EXTRACT_LIMITS.maxSlides });
  if (/too[-_]many[-_]images|too[-_]many[-_]media/i.test(details)) return text('tooManyImages', { count: PPT_IMAGE_EXTRACT_LIMITS.maxExportItems });
  if (/empty[-_]selection|invalid[-_]selection/i.test(details)) return text('emptySelection');
  if (/invalid[-_]pptx|invalid[-_]input|read[-_]failed/i.test(details)) return text('invalidPptx');
  if (/cancelled|canceled/i.test(details)) return text('cancelled');
  return text('exportFailed', { error: message || 'unknown error' });
}

function createTextNode(documentRef, tag, className, text) {
  const element = documentRef.createElement(tag);
  if (className) element.className = className;
  element.textContent = text == null ? '' : String(text);
  return element;
}

function queryById(root, id) {
  return root?.querySelector?.(`#${id}`) || null;
}

async function loadJsZip() {
  const module = await import('jszip');
  return module.default || module;
}

export function createPptImagesController({
  overlay: featureOverlay,
  portal,
  isTauri = false,
  t = key => key,
  onLangChange = () => () => {},
  notify = () => {},
  formatFileSize = value => String(value || 0),
  displayFilesystemPath = value => String(value || ''),
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = instance => instance,
  getOutputDir = async () => '',
  openOutputFolder = async () => false,
  openSettings = () => {},
  openSupport = () => {},
  openExternalUrl = () => {},
  handleWindowAction = () => {},
  refreshIcons = () => {},
  documentRef = globalThis.document
} = {}) {
  if (!featureOverlay || !portal || !documentRef) throw new Error('ppt-images:missing-root');

  const overlay = featureOverlay;
  const byPageId = id => queryById(overlay, id);
  const byPortalId = id => queryById(portal, id);
  const background = byPageId('pptImagesPlasmaBg');
  const workspace = byPageId('pptImagesScrollArea');
  const dropZone = byPageId('pptImagesDropZone');
  const input = byPageId('pptImagesFileInput');
  const cta = byPageId('pptImagesCta');
  const fileName = byPageId('pptImagesFileName');
  const empty = byPageId('pptImagesEmpty');
  const results = byPageId('pptImagesResults');
  const summary = byPageId('pptImagesSummary');
  const pageFilter = byPageId('pptImagesPageFilter');
  const skipDuplicates = byPageId('pptImagesSkipDuplicates');
  const selectAll = byPageId('pptImagesSelectAll');
  const clearSelection = byPageId('pptImagesClearSelection');
  const exportButton = byPageId('pptImagesExportBtn');
  const list = byPageId('pptImagesList');
  const scrollTop = byPageId('pptImagesScrollTop');
  const processMask = byPortalId('pptImagesProcessMask');
  const processFill = byPortalId('pptImagesProcessBarFill');
  const processText = byPortalId('pptImagesProcessText');
  const successOverlay = byPortalId('pptImagesSuccessOverlay');
  const successMeta = byPortalId('pptImagesSuccessMeta');
  const successCount = byPortalId('pptImagesSuccessCount');
  const successPath = byPortalId('pptImagesSuccessPath');
  const successOpenFolder = byPortalId('pptImagesSuccessOpenFolder');
  const successOk = byPortalId('pptImagesSuccessOk');
  const previewOverlay = byPortalId('pptImagesPreviewOverlay');
  const previewImage = byPortalId('pptImagesPreviewImage');
  const previewTitle = byPortalId('pptImagesPreviewTitle');
  const previewMeta = byPortalId('pptImagesPreviewMeta');
  const previewClose = byPortalId('pptImagesPreviewClose');
  const lifecycle = createLifecycleScope({ onError: error => console.error('[PPT Images] dispose error:', error) });
  const previewModal = createModalSession({ root: previewOverlay, background: overlay,
    initialFocus: previewClose, onClose: () => closePreview() });
  lifecycle.use(() => previewModal.dispose());
  const guard = createOperationGuard(() => session);
  let session = null;
  let plasma = null;
  let busy = false;
  let manifest = null;
  let zip = null;
  let selectedFile = null;
  let selected = new Set();
  let previewUrls = [];
  let previewRevision = 0;
  let thumbnailScope = null;
  let lastOutputPath = '';
  let disposed = false;

  const text = (key, params) => t(`home.pptImagesPage.${key}`, params);
  const isOpen = owner => Boolean(owner && owner === session && !owner.disposed && overlay.classList.contains('visible'));

  function releasePreviewUrls() {
    closePreview({ restore: false });
    thumbnailScope?.dispose();
    thumbnailScope = null;
    for (const url of previewUrls) URL.revokeObjectURL(url);
    previewUrls = [];
    previewRevision += 1;
  }

  function closePreview(options) {
    previewModal.close(options);
    previewImage?.removeAttribute('src');
    if (previewImage) previewImage.alt = '';
    if (previewTitle) previewTitle.textContent = '';
    if (previewMeta) previewMeta.textContent = '';
  }

  function openPreview(thumb) {
    if (busy || !isOpen(session) || thumb.disabled) return;
    const image = thumb.querySelector('img');
    if (!image?.complete || !image.naturalWidth) return;
    const row = thumb.closest('.ppt-images-item');
    previewTitle.textContent = row.querySelector('.ppt-images-info strong').textContent;
    previewMeta.textContent = row.querySelector('.ppt-images-info > span').textContent;
    previewImage.src = image.src;
    previewImage.alt = previewTitle.textContent;
    previewModal.open();
  }

  function setProgress(percent, message, visible = true) {
    if (processFill) processFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if (processText) processText.textContent = message || text('processing');
    setInteractiveLayer(processMask, visible);
  }

  function hideProgressSoon(owner) {
    if (isOpen(owner) && !busy) setProgress(0, text('processing'), false);
  }

  function summaryText() {
    if (!manifest) return '';
    const bytes = manifest.images.reduce((sum, item) => sum + (item.bytes || 0), 0);
    return text('summary', {
      slides: manifest.slide_count,
      images: manifest.image_count,
      duplicates: manifest.duplicate_count,
      size: formatFileSize(bytes)
    });
  }

  function formatDimensions(item) {
    return item?.width && item?.height ? `${item.width} × ${item.height}` : text('unknownDimensions');
  }

  function formatSlide(item) {
    return item?.slide_number ? text('slide', { page: item.slide_number }) : text('unlocated');
  }

  function selectedArray() {
    return [...selected]
      .map(value => Number(value))
      .filter(value => Number.isSafeInteger(value) && value > 0)
      .sort((left, right) => left - right);
  }

  function pageFilterIsValid() {
    if (!manifest) return true;
    const value = pageFilter?.value?.trim() || '';
    if (!value) return true;
    try {
      normalizePptPageSelection(value, manifest.slide_count);
      return true;
    } catch {
      return false;
    }
  }

  function exportPlan({ allowEmpty = false } = {}) {
    if (!manifest) return null;
    const indexes = selectedArray();
    if (!allowEmpty && indexes.length < 1) throw new Error('ppt-image-extract:empty_selection');
    const allSelected = indexes.length === manifest.images.length;
    return planPptImageExport(manifest, {
      images: allSelected ? null : indexes,
      pages: pageFilter?.value?.trim() || null,
      skip_duplicates: Boolean(skipDuplicates?.checked)
    });
  }

  function updateControls() {
    if (!manifest) {
      if (exportButton) {
        exportButton.disabled = true;
        exportButton.hidden = true;
      }
      return;
    }
    const valid = pageFilterIsValid();
    let count = 0;
    if (valid) {
      try { count = exportPlan({ allowEmpty: true })?.selected_count || 0; } catch { count = 0; }
    }
    pageFilter?.classList.toggle('is-invalid', !valid);
    if (summary) {
      summary.replaceChildren(
        createTextNode(documentRef, 'span', '', summaryText()),
        createTextNode(documentRef, 'strong', '', text('selectedSummary', { selected: count, total: manifest.image_count }))
      );
    }
    if (exportButton) {
      exportButton.disabled = busy || !valid || count < 1;
      exportButton.hidden = busy || !valid || count < 1;
    }
  }

  function syncDuplicateSelection() {
    if (!list || !manifest) return;
    const skip = Boolean(skipDuplicates?.checked);
    for (const row of list.querySelectorAll('.ppt-images-item')) {
      const checkbox = row.querySelector('.ppt-images-check');
      const duplicate = row.classList.contains('is-duplicate');
      const locked = skip && duplicate;
      if (checkbox) {
        checkbox.disabled = locked;
        if (locked) checkbox.checked = false;
      }
      row.classList.toggle('is-locked', locked);
      if (locked) {
        const index = Number(row.dataset.index);
        if (Number.isSafeInteger(index)) selected.delete(index);
      }
    }
    updateControls();
  }

  function renderList() {
    if (!list || !manifest) return;
    list.replaceChildren();
    for (const item of manifest.images) {
      const duplicateText = item.duplicate_of ? text('duplicateOf', { id: item.duplicate_of }) : text('original');
      const row = documentRef.createElement('article');
      row.className = `ppt-images-item${item.is_duplicate ? ' is-duplicate' : ''}`;
      row.dataset.index = String(item.index);
      const checkbox = documentRef.createElement('input');
      checkbox.className = 'ppt-images-check';
      checkbox.type = 'checkbox';
      checkbox.dataset.index = String(item.index);
      checkbox.checked = selected.has(item.index);
      checkbox.setAttribute('aria-label', text('selectImage', { name: item.original_name || item.suggested_file_name }));
      const selection = documentRef.createElement('label');
      selection.className = 'ppt-images-selection';
      const checkmark = documentRef.createElement('span');
      checkmark.className = 'ppt-images-checkmark';
      checkmark.setAttribute('aria-hidden', 'true');
      const checkIcon = documentRef.createElement('i');
      checkIcon.dataset.lucide = 'check';
      checkmark.append(checkIcon);
      selection.append(checkbox, checkmark);
      const thumb = documentRef.createElement('button');
      thumb.type = 'button';
      thumb.disabled = true;
      thumb.className = 'ppt-images-thumb';
      thumb.setAttribute('aria-label', text('previewImage', { name: item.original_name || item.suggested_file_name }));
      thumb.title = text('noPreview');
      thumb.dataset.mediaPath = item.media_path || '';
      thumb.dataset.extension = item.extension || '';
      const icon = documentRef.createElement('i');
      icon.dataset.lucide = 'image';
      icon.setAttribute('aria-hidden', 'true');
      thumb.append(icon, createTextNode(documentRef, 'em', '', text('noPreview')));
      const info = documentRef.createElement('span');
      info.className = 'ppt-images-info';
      info.append(
        createTextNode(documentRef, 'strong', '', `#${item.id} · ${item.original_name || item.suggested_file_name}`),
        createTextNode(documentRef, 'span', '', [formatSlide(item), item.extension?.toUpperCase(), formatDimensions(item), formatFileSize(item.bytes)].filter(Boolean).join(' · '))
      );
      const badge = createTextNode(documentRef, 'span', 'ppt-images-badge', duplicateText);
      row.append(selection, thumb, info, badge);
      list.append(row);
    }
    refreshIcons();
    syncDuplicateSelection();
    void renderPreviews();
  }

  function canPreview(item) {
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(String(item?.extension || '').toLowerCase())
      && Number(item?.bytes || 0) <= 8 * 1024 * 1024;
  }

  async function renderPreviews() {
    const owner = session;
    if (!owner || !zip || !manifest || !list || !isOpen(owner)) return;
    releasePreviewUrls();
    thumbnailScope = createLifecycleScope();
    const revision = previewRevision;
    let rendered = 0;
    for (const item of manifest.images) {
      if (!isOpen(owner) || revision !== previewRevision) return;
      if (!canPreview(item)) continue;
      const row = list.querySelector(`.ppt-images-item[data-index="${item.index}"]`);
      const thumb = row?.querySelector('.ppt-images-thumb');
      const zipFile = zip.file(item.media_path);
      if (!thumb || !zipFile) continue;
      try {
        const bytes = await zipFile.async('uint8array');
        if (!isOpen(owner) || revision !== previewRevision) return;
        const url = URL.createObjectURL(new Blob([bytes], { type: item.mime_type || 'application/octet-stream' }));
        previewUrls.push(url);
        const image = documentRef.createElement('img');
        image.alt = '';
        image.draggable = false;
        thumbnailScope.event(image, 'load', () => {
          if (!isOpen(owner) || revision !== previewRevision) return;
          thumb.replaceChildren(image);
          thumb.disabled = false;
          thumb.title = text('previewImage', { name: item.original_name || item.suggested_file_name });
        }, { once: true });
        image.src = url;
        rendered += 1;
        if (rendered % 12 === 0) await new Promise(resolve => queueMicrotask(resolve));
      } catch (error) {
        if (isOpen(owner)) console.warn('[PPT Images] preview failed:', error);
      }
    }
  }

  function resetState() {
    guard.cancel();
    releasePreviewUrls();
    busy = false;
    manifest = null;
    zip = null;
    selectedFile = null;
    selected = new Set();
    lastOutputPath = '';
    if (input) input.value = '';
    if (fileName) {
      fileName.textContent = '';
      fileName.classList.remove('visible');
    }
    const label = cta?.querySelector('span');
    if (label) label.textContent = text('cta');
    if (cta) cta.disabled = false;
    if (empty) empty.hidden = false;
    if (results) results.hidden = true;
    summary?.replaceChildren();
    if (pageFilter) {
      pageFilter.value = '';
      pageFilter.classList.remove('is-invalid');
    }
    if (skipDuplicates) skipDuplicates.checked = false;
    list?.replaceChildren();
    dropZone?.classList.remove('visible');
    if (exportButton) {
      exportButton.disabled = true;
      exportButton.hidden = true;
    }
    scrollTop?.classList.remove('visible');
    if (workspace) workspace.scrollTop = 0;
    setInteractiveLayer(successOverlay, false);
    setProgress(0, text('processing'), false);
  }

  function updateScrollTop() {
    if (workspace && scrollTop) scrollTop.classList.toggle('visible', workspace.scrollTop > 160);
  }

  function showOverlay() {
    if (disposed) return;
    guard.cancel();
    session?.dispose();
    session = createLifecycleScope({ onError: error => console.error('[PPT Images] session cleanup:', error) });
    session.use(releasePreviewUrls);
    resetState();
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    if (workspace) workspace.scrollTop = 0;
    if (background) plasma = initStandardToolPlasma(background);
    const owner = session;
    if (isTauri) {
      void registerNativePptxDrop({
        owner,
        isCurrent: () => isOpen(owner),
        onVisibility: visible => { if (!busy && isOpen(owner)) dropZone?.classList.toggle('visible', visible); },
        onUnsupported: () => notify(text('unsupportedFormat')),
        onDrop: file => { void handleFile(file); }
      }).catch(error => {
        if (isOpen(owner)) console.error('[PPT Images] drag registration failed:', error);
      });
    }
    updateControls();
  }

  function close() {
    if (disposed) return;
    guard.cancel();
    const owner = session;
    session = null;
    owner?.dispose();
    busy = false;
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    plasma = disposeStandardToolPlasma(plasma);
    resetState();
  }

  async function handleFile(file) {
    if (!file || busy || !isOpen(session)) return;
    if (!isPptxFile(file)) {
      notify(text('unsupportedFormat'));
      return;
    }
    const owner = session;
    const operation = guard.begin();
    if (!operation) return;
    guard.attachScope(operation, createLifecycleScope());
    busy = true;
    updateControls();
    releasePreviewUrls();
    setProgress(12, text('reading'));
    try {
      const bytes = await readPptxFile(file, {
        isTauri,
        maxBytes: PPT_IMAGE_EXTRACT_LIMITS.maxInputBytes,
        errorPrefix: 'ppt-image-extract'
      });
      guard.assertCurrent(operation);
      setProgress(42, text('analyzing'));
      const nextManifest = await analyzePptxImages(bytes, { sourceName: file.name || file.path || 'presentation.pptx' });
      guard.assertCurrent(operation);
      const JSZip = await loadJsZip();
      const nextZip = await JSZip.loadAsync(bytes);
      guard.assertCurrent(operation);
      manifest = nextManifest;
      zip = nextZip;
      selectedFile = { ...file, size: bytes.byteLength };
      selected = new Set(manifest.images.map(item => item.index));
      if (fileName) {
        fileName.textContent = `${file.name || file.path || 'presentation.pptx'} · ${summaryText()}`;
        fileName.classList.add('visible');
      }
      const label = cta?.querySelector('span');
      if (label) label.textContent = text('replace');
      if (empty) empty.hidden = true;
      if (results) results.hidden = false;
      setProgress(78, text('previewing'));
      renderList();
      setProgress(100, text('previewing'));
      notify(text('scanDone', { slides: manifest.slide_count, images: manifest.image_count }));
    } catch (error) {
      if (!guard.isCurrent(operation)) return;
      console.error('[PPT Images] scan failed:', error);
      setProgress(0, text('processing'), false);
      notify(errorMessage(error, text), { kind: 'error' });
    } finally {
      if (!guard.isCurrent(operation)) return;
      busy = false;
      guard.finish(operation);
      updateControls();
      hideProgressSoon(owner);
    }
  }

  async function exportImages() {
    if (!manifest || !zip || busy || !isOpen(session)) return;
    if (!pageFilterIsValid()) {
      notify(text('invalidPageFilter', { count: manifest.slide_count }));
      updateControls();
      return;
    }
    let plan;
    try {
      plan = exportPlan();
    } catch (error) {
      notify(errorMessage(error, text));
      return;
    }
    const owner = session;
    const operation = guard.begin();
    if (!operation) return;
    guard.attachScope(operation, createLifecycleScope());
    busy = true;
    updateControls();
    setProgress(8, text('exporting'));
    try {
      const baseName = sanitizePptImageBaseName(selectedFile?.name || selectedFile?.path || manifest.source_name);
      const outputs = [];
      if (isTauri) {
        const { invoke } = await tauriCorePromise;
        const outputDir = await uniqueOutputDirectory({
          getOutputDir,
          isTauri,
          category: 'PPT_Images',
          baseName: `${baseName}_ppt_images`
        });
        for (let index = 0; index < plan.selected_images.length; index += 1) {
          guard.assertCurrent(operation);
          const item = plan.selected_images[index];
          const zipFile = zip.file(item.media_path);
          if (!zipFile) continue;
          const bytes = await zipFile.async('uint8array');
          guard.assertCurrent(operation);
          const outputPath = await writeUniqueFile(invoke, outputDir, item.suggested_file_name, bytes);
          outputs.push({ item, path: outputPath, relative_path: outputPath.split(/[\\/]/).pop() || item.suggested_file_name, bytes: bytes.byteLength });
          setProgress(10 + Math.round(((index + 1) / plan.selected_images.length) * 76), `${text('exporting')} (${index + 1}/${plan.selected_images.length})`);
          await new Promise(resolve => operation.scope.timeout(resolve, 0));
        }
        guard.assertCurrent(operation);
        setProgress(92, text('writingManifest'));
        const result = {
          ...manifest,
          input: { name: selectedFile?.name || manifest.source_name, path: selectedFile?.path || null },
          output_dir: outputDir,
          options: { pages: plan.pages, images: plan.images, skip_duplicates: plan.skip_duplicates },
          selected_count: plan.selected_count,
          selected_bytes: plan.selected_bytes,
          outputs
        };
        const encoder = new TextEncoder();
        await writeUniqueFile(invoke, outputDir, 'manifest.json', encoder.encode(JSON.stringify(result, null, 2)));
        await writeUniqueFile(invoke, outputDir, 'manifest.md', encoder.encode(createPptImageManifestMarkdown(result)));
        guard.assertCurrent(operation);
        lastOutputPath = outputDir;
        showSuccess(outputDir, outputs.length);
      } else {
        const JSZip = await loadJsZip();
        const outputZip = new JSZip();
        for (let index = 0; index < plan.selected_images.length; index += 1) {
          guard.assertCurrent(operation);
          const item = plan.selected_images[index];
          const zipFile = zip.file(item.media_path);
          if (!zipFile) continue;
          const bytes = await zipFile.async('uint8array');
          guard.assertCurrent(operation);
          outputZip.file(item.suggested_file_name, bytes);
          outputs.push({ item, relative_path: item.suggested_file_name, bytes: bytes.byteLength });
          setProgress(10 + Math.round(((index + 1) / plan.selected_images.length) * 76), `${text('exporting')} (${index + 1}/${plan.selected_images.length})`);
        }
        const result = {
          ...manifest,
          input: { name: selectedFile?.name || manifest.source_name, path: null },
          output_dir: `~/Downloads/${baseName}_ppt_images.zip`,
          options: { pages: plan.pages, images: plan.images, skip_duplicates: plan.skip_duplicates },
          selected_count: plan.selected_count,
          selected_bytes: plan.selected_bytes,
          outputs
        };
        outputZip.file('manifest.json', JSON.stringify(result, null, 2));
        outputZip.file('manifest.md', createPptImageManifestMarkdown(result));
        setProgress(94, text('writingManifest'));
        const blob = await outputZip.generateAsync({ type: 'blob' });
        guard.assertCurrent(operation);
        const url = URL.createObjectURL(blob);
        operation.scope.use(() => URL.revokeObjectURL(url));
        const anchor = documentRef.createElement('a');
        anchor.href = url;
        anchor.download = `${baseName}_ppt_images.zip`;
        anchor.click();
        lastOutputPath = result.outputs?.[0]?.output_path
          || result.outputs?.[0]?.outputPath
          || result.output_path
          || result.output_dir;
        showSuccess(result.output_dir, outputs.length);
      }
      guard.assertCurrent(operation);
      setProgress(100, text('writingManifest'));
      notify(text('exportDone', { count: outputs.length }));
    } catch (error) {
      if (!guard.isCurrent(operation)) return;
      console.error('[PPT Images] export failed:', error);
      notify(errorMessage(error, text), { kind: 'error' });
    } finally {
      if (!guard.isCurrent(operation)) return;
      busy = false;
      guard.finish(operation);
      updateControls();
      hideProgressSoon(owner);
    }
  }

  function showSuccess(outputPath, count) {
    if (successMeta) successMeta.textContent = text('successMeta');
    if (successCount) successCount.textContent = String(count);
    if (successPath) successPath.textContent = displayFilesystemPath(outputPath);
    setInteractiveLayer(successOverlay, true);
  }

  lifecycle.event(overlay, 'dragover', event => {
    if (!isOpen(session) || !dragHasExternalFiles(event)) return;
    event.preventDefault();
    if (!busy) dropZone?.classList.add('visible');
  });
  lifecycle.event(overlay, 'dragleave', event => {
    if (event.target === overlay) dropZone?.classList.remove('visible');
  });
  lifecycle.event(overlay, 'drop', event => {
    if (!isOpen(session) || !dragHasExternalFiles(event)) return;
    event.preventDefault();
    dropZone?.classList.remove('visible');
    const file = Array.from(event.dataTransfer?.files || []).find(isPptxFile);
    if (file) void handleFile(file);
    else notify(text('unsupportedFormat'));
  });
  lifecycle.event(cta, 'click', () => {
    if (busy) return;
    void choosePptxFile({ isTauri, input, onSelected: handleFile, onError: error => notify(errorMessage(error, text)) });
  });
  lifecycle.event(input, 'change', event => {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
  });
  lifecycle.event(selectAll, 'click', () => {
    if (!manifest) return;
    const skip = Boolean(skipDuplicates?.checked);
    selected = new Set(manifest.images.filter(item => !(skip && item.is_duplicate)).map(item => item.index));
    list?.querySelectorAll('.ppt-images-check').forEach(checkbox => { checkbox.checked = !checkbox.disabled; });
    updateControls();
  });
  lifecycle.event(clearSelection, 'click', () => {
    selected = new Set();
    list?.querySelectorAll('.ppt-images-check').forEach(checkbox => { checkbox.checked = false; });
    updateControls();
  });
  lifecycle.event(list, 'change', event => {
    const checkbox = event.target.closest?.('.ppt-images-check');
    if (!checkbox || checkbox.disabled) return;
    const index = Number(checkbox.dataset.index);
    if (!Number.isSafeInteger(index)) return;
    if (checkbox.checked) selected.add(index);
    else selected.delete(index);
    updateControls();
  });
  lifecycle.event(list, 'click', event => {
    const thumb = event.target.closest?.('.ppt-images-thumb');
    if (thumb) { openPreview(thumb); return; }
    if (event.target.closest?.('.ppt-images-selection')) return;
    const checkbox = event.target.closest?.('.ppt-images-item')?.querySelector('.ppt-images-check');
    if (checkbox && !checkbox.disabled) checkbox.click();
  });
  lifecycle.event(previewClose, 'click', () => closePreview());
  lifecycle.event(previewOverlay, 'click', event => {
    if (event.target === previewOverlay) closePreview();
  });
  lifecycle.event(skipDuplicates, 'change', syncDuplicateSelection);
  lifecycle.event(pageFilter, 'input', updateControls);
  lifecycle.event(pageFilter, 'blur', () => {
    if (manifest && !pageFilterIsValid()) notify(text('invalidPageFilter', { count: manifest.slide_count }));
  });
  lifecycle.event(exportButton, 'click', () => { void exportImages(); });
  lifecycle.event(list, 'dragstart', event => {
    if (event.target?.closest?.('.ppt-images-thumb, .ppt-images-item')) event.preventDefault();
  });
  lifecycle.event(workspace, 'scroll', updateScrollTop, { passive: true });
  lifecycle.event(scrollTop, 'click', () => workspace?.scrollTo({ top: 0, behavior: 'smooth' }));
  lifecycle.event(successOk, 'click', () => setInteractiveLayer(successOverlay, false));
  lifecycle.event(successOpenFolder, 'click', () => {
    if (isTauri && lastOutputPath && isOpen(session)) void openOutputFolder(lastOutputPath);
  });
  bindPptChrome(lifecycle, overlay, { onClose: close, openSettings, openSupport, openExternalUrl, handleWindowAction });
  lifecycle.use(onLangChange(() => {
    if (!isOpen(session)) return;
    applyTranslations();
    if (manifest) {
      if (fileName && selectedFile) fileName.textContent = `${selectedFile.name || selectedFile.path || 'presentation.pptx'} · ${summaryText()}`;
      renderList();
    }
  }));

  resetState();
  return {
    open: showOverlay,
    close,
    dispose() {
      if (disposed) return;
      close();
      disposed = true;
      lifecycle.dispose();
    },
    get busy() { return busy; }
  };
}
