import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { bindSortableFileList } from '../../shared/sortable-file-list.js';
import { formatFileSize } from '../../shared/file-size.js';
import { onLangChange } from '../../i18n.js';
import { loadTauriDialog, tauriCorePromise, tauriEventPromise } from '../../platform/tauri-runtime.js';
import { normalizeVideoTargetFormat, validateVideoBatchSelection, VideoConvertError } from '../../video-convert-core.js';
import {
  VIDEO_EXTENSIONS,
  registerNativeVideoDrop,
  setDropVisible,
  fileNameFromPath
} from './shared.js';

export function createVideoConvertController({
  overlay,
  isTauri = false,
  t = value => value,
  onLangChange: registerLanguageChange = onLangChange,
  notify = () => {},
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = instance => instance?.(),
  getOutputDir = async () => '',
  ensureFfmpegAvailable = async () => isTauri,
  openOutputFolder = async () => false,
  displayFilesystemPath = value => String(value || ''),
  refreshIcons = () => {},
  openSettings = () => {},
  openSupport = () => {},
  openExternalUrl = () => {},
  handleWindowAction = () => {},
  documentRef = globalThis.document
} = {}) {
  if (!overlay || !documentRef) throw new Error('video-convert:missing-root');

  const byId = id => documentRef.getElementById(id);
  const dropZone = byId('videoConvertDropZone');
  const filesNode = byId('videoConvertFiles');
  const processButton = byId('videoConvertProcessBtn');
  const processMask = byId('videoConvertProcessMask');
  const processFill = byId('videoConvertProcessBarFill');
  const processText = byId('videoConvertProcessText');
  const formatOptions = byId('videoConvertFormatOptions');
  const successOverlay = byId('videoConvertSuccessOverlay');
  const successPath = byId('videoConvertSuccessPath');
  const successMeta = byId('videoConvertSuccessMeta');
  const successFormat = byId('videoConvertSuccessFormat');
  const successCount = byId('videoConvertSuccessCount');
  const plasmaBackground = byId('videoConvertPlasmaBg');
  const lifecycle = createLifecycleScope({ onError: error => console.error('[Video Convert] cleanup:', error) });
  let session = null;
  let queueScope = createLifecycleScope();
  let plasma = null;
  let nativeDropUnlisten = null;
  let selectedFiles = [];
  let processing = false;
  let targetFormat = 'MP4';
  let runId = 0;
  let completionTimer = null;
  let lastOutputPath = '';
  let disposed = false;

  const current = owner => Boolean(owner && owner === session && !disposed && overlay.classList.contains('visible'));

  function errorText(error) {
    if (error instanceof VideoConvertError) {
      const keys = {
        missing_input: 'home.videoConvert.selectionError',
        too_many_files: 'home.videoConvert.selectionError',
        invalid_input: 'home.videoConvert.selectionError',
        input_too_large: 'home.videoConvert.selectionError',
        duplicate_input: 'home.videoConvert.selectionError'
      };
      return t(keys[error.code] || 'home.videoConvert.conversionError', { error: error.message });
    }
    return t('common.errorOccurred', { error: error?.message || error || t('home.videoConvert.conversionError') });
  }

  function setProgress(value, message = t('home.videoConvert.processing'), visible = true) {
    if (processFill) processFill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    if (processText) processText.textContent = message;
    processMask?.classList.toggle('visible', visible);
  }

  function toggleProcessButton() {
    if (!processButton) return;
    if (disposed) {
      processButton.classList.remove('visible');
      if (completionTimer !== null) { clearTimeout(completionTimer); completionTimer = null; }
      processButton.style.display = 'none';
      return;
    }
    if (selectedFiles.length && !disposed) {
      if (completionTimer !== null) { clearTimeout(completionTimer); completionTimer = null; }
      processButton.style.display = '';
      requestAnimationFrame(() => { if (!disposed) processButton.classList.add('visible'); });
      return;
    }
    processButton.classList.remove('visible');
    if (completionTimer !== null) clearTimeout(completionTimer);
    completionTimer = setTimeout(() => {
      completionTimer = null;
      if (!processButton.classList.contains('visible')) processButton.style.display = 'none';
    }, 320);
  }

  function renderQueue() {
    queueScope.dispose();
    queueScope = createLifecycleScope();
    if (!filesNode) return;
    filesNode.replaceChildren();
    filesNode.classList.toggle('has-files', selectedFiles.length > 0);
    selectedFiles.forEach((file, index) => {
      const row = documentRef.createElement('div');
      row.className = 'audio-convert-file-item';
      row.dataset.sortIndex = String(index);
      const order = documentRef.createElement('span');
      order.className = 'audio-convert-file-index';
      order.textContent = String(index + 1);
      const name = documentRef.createElement('span');
      name.className = 'audio-convert-file-name';
      name.textContent = file.name || '';
      row.append(order, name);
      if (Number(file.size) > 0) {
        const size = documentRef.createElement('span');
        size.className = 'audio-convert-file-size';
        size.textContent = formatFileSize(file.size);
        row.append(size);
      }
      const remove = documentRef.createElement('button');
      remove.type = 'button';
      remove.className = 'audio-convert-file-remove';
      remove.dataset.index = String(index);
      remove.setAttribute('aria-label', t('common.remove'));
      const icon = documentRef.createElement('i');
      icon.dataset.lucide = 'x';
      remove.append(icon);
      row.append(remove);
      filesNode.append(row);
    });
    bindSortableFileList({
      scope: queueScope,
      container: filesNode,
      items: selectedFiles,
      render: renderQueue,
      isLocked: () => processing
    });
    refreshIcons();
    toggleProcessButton();
  }

  function addFiles(fileList) {
    const next = [...selectedFiles];
    for (const file of Array.from(fileList || [])) {
      const duplicate = file.path
        ? next.some(item => item.path === file.path)
        : next.some(item => item.name === file.name && item.size === file.size);
      if (!duplicate) next.push(file);
    }
    try { validateVideoBatchSelection(next); }
    catch (error) { notify(errorText(error)); return; }
    selectedFiles = next;
    renderQueue();
  }

  function clearFiles() {
    selectedFiles = [];
    renderQueue();
  }

  async function chooseFiles() {
    if (processing) return;
    if (isTauri) {
      try {
        const { open } = await loadTauriDialog();
        const selected = await open({ multiple: true, filters: [{ name: 'Video Files', extensions: VIDEO_EXTENSIONS }] });
        if (Array.isArray(selected)) addFiles(selected.map(path => ({ name: fileNameFromPath(path), path, size: 0 })));
      } catch (error) { console.error('[Video Convert] file picker failed:', error); }
      return;
    }
    const input = documentRef.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = VIDEO_EXTENSIONS.map(extension => `.${extension}`).join(',');
    input.addEventListener('change', () => { addFiles(input.files); input.value = ''; }, { once: true });
    input.click();
  }

  function cancel() {
    const wasProcessing = processing;
    runId += 1;
    processing = false;
    if (completionTimer !== null) { clearTimeout(completionTimer); completionTimer = null; }
    setProgress(0, t('home.videoConvert.processing'), false);
    if (isTauri && wasProcessing) {
      void tauriCorePromise.then(({ invoke }) => invoke('cancel_convert', { toolknitTaskTool: 'video-convert' })).catch(error => console.error('[Video Convert] cancel failed:', error));
    }
  }

  function showSuccess(result) {
    const output = result?.output_dir || '';
    const succeeded = Number(result?.success_count ?? selectedFiles.length);
    const failed = Number(result?.fail_count ?? 0);
    if (failed && !succeeded) { notify(t('home.videoConvert.allFailed', { count: failed })); return; }
    const summary = failed
      ? t('home.videoConvert.successSummaryPartial', { success: succeeded, fail: failed, format: targetFormat })
      : succeeded > 1
        ? t('home.videoConvert.successSummaryPlural', { count: succeeded, format: targetFormat })
        : t('home.videoConvert.successSummarySingle', { name: selectedFiles[0]?.name || '', format: targetFormat });
    if (successMeta) successMeta.textContent = summary;
    if (successFormat) successFormat.textContent = targetFormat;
    if (successCount) successCount.textContent = `${succeeded} ${t('home.videoConvert.successCountUnit')}`;
    if (successPath) successPath.textContent = displayFilesystemPath(output);
    lastOutputPath = output;
    successOverlay?.classList.add('visible');
  }

  async function processFiles() {
    if (processing || !selectedFiles.length) return;
    try {
      validateVideoBatchSelection(selectedFiles);
      targetFormat = normalizeVideoTargetFormat(targetFormat);
    } catch (error) { notify(errorText(error)); return; }
    if (!isTauri) { notify(t('home.videoConvert.desktopOnly')); return; }
    const owner = session;
    const operation = ++runId;
    processing = true;
    setProgress(0);
    let release = null;
    try {
      const [{ invoke }, { listen }] = await Promise.all([tauriCorePromise, tauriEventPromise]);
      const inputPaths = selectedFiles.map(file => file.path).filter(Boolean);
      if (inputPaths.length !== selectedFiles.length) throw new Error(t('common.filePathsNotAvailableShort'));
      const outputDir = await getOutputDir('Videos');
      if (!current(owner) || operation !== runId) return;
      const ffmpegReady = await ensureFfmpegAvailable();
      if (!ffmpegReady) {
        if (current(owner) && operation === runId) {
          processing = false;
          setProgress(0, t('home.videoConvert.processing'), false);
        }
        return;
      }
      if (!current(owner) || operation !== runId) return;
      const progressByFile = new Map();
      const rawUnlisten = await listen('convert-progress', event => {
        if (!current(owner) || operation !== runId) return;
        const data = event?.payload || {};
        const currentFile = Number(data.current);
        const total = Number(data.total);
        if (!Number.isInteger(currentFile) || !Number.isInteger(total) || currentFile < 1 || total < 1) return;
        const value = Number.isFinite(Number(data.progress)) ? Number(data.progress) : 0;
        progressByFile.set(currentFile, data.status === 'done' || data.status === 'error' ? 1 : Math.max(progressByFile.get(currentFile) || 0, Math.min(0.99, Math.max(0, value))));
        const totalProgress = [...progressByFile.values()].reduce((sum, item) => sum + item, 0);
        setProgress(Math.min(99, Math.round(totalProgress / total * 100)), `${t('home.videoConvert.processing')} (${currentFile}/${total})`);
      });
      release = session?.use ? session.use(rawUnlisten) : rawUnlisten;
      const result = await invoke('convert_video_batch', { inputPaths, outputDir, targetFormat });
      if (!current(owner) || operation !== runId) return;
      setProgress(100);
      completionTimer = setTimeout(() => {
        completionTimer = null;
        if (!current(owner) || operation !== runId) return;
        setProgress(0, t('home.videoConvert.processing'), false);
        processing = false;
        showSuccess(result);
      }, 400);
    } catch (error) {
      if (current(owner) && operation === runId) {
        processing = false;
        setProgress(0, t('home.videoConvert.processing'), false);
        notify(errorText(error));
      }
    } finally {
      release?.();
    }
  }

  function bindActions() {
    const byAction = (id, handler) => { const node = byId(id); if (node) lifecycle.event(node, 'click', event => { event.stopPropagation(); handler(event); }); };
    byAction('videoConvertBack', close);
    byAction('videoConvertV2Settings', openSettings);
    byAction('videoConvertCta', () => { void chooseFiles(); });
    byAction('videoConvertProcessBtn', () => { void processFiles(); });
    byAction('videoConvertCancelBtn', cancel);
    byAction('videoConvertSuccessOk', () => { successOverlay?.classList.remove('visible'); clearFiles(); });
    byAction('videoConvertOpenFolder', () => { if (lastOutputPath) void openOutputFolder(lastOutputPath); successOverlay?.classList.remove('visible'); clearFiles(); });
    overlay.querySelectorAll('[data-home-link="website"]').forEach(node => lifecycle.event(node, 'click', () => openExternalUrl('https://toolknit.com')));
    overlay.querySelectorAll('[data-open-support]').forEach(node => lifecycle.event(node, 'click', openSupport));
    overlay.querySelectorAll('[data-action]').forEach(node => lifecycle.event(node, 'click', () => handleWindowAction(node.dataset.action)));
    lifecycle.event(formatOptions, 'change', () => {
      if (processing) return;
      targetFormat = normalizeVideoTargetFormat(formatOptions.value);
    });
    lifecycle.event(filesNode, 'click', event => {
      const button = event.target?.closest?.('.audio-convert-file-remove');
      if (!button || processing) return;
      const index = Number(button.dataset.index);
      if (Number.isInteger(index)) { selectedFiles.splice(index, 1); renderQueue(); }
    });
    lifecycle.use(registerLanguageChange(() => refreshIcons()));
  }

  function open() {
    if (disposed) return;
    session?.dispose();
    session = createLifecycleScope();
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    if (!plasma && plasmaBackground) plasma = initStandardToolPlasma(plasmaBackground);
    renderQueue();
  }

  function close() {
    runId += 1;
    cancel();
    session?.dispose();
    session = null;
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    setDropVisible(overlay, dropZone, false);
    if (plasma) { plasma = disposeStandardToolPlasma(plasma); }
    successOverlay?.classList.remove('visible');
    clearFiles();
  }

  bindActions();
  void registerNativeVideoDrop({
    isTauri,
    overlay,
    scope: lifecycle,
    isActive: () => overlay.classList.contains('visible'),
    isBusy: () => processing,
    onVisibility: visible => setDropVisible(overlay, dropZone, visible),
    onDrop: path => addFiles([{ name: fileNameFromPath(path), path, size: 0 }]),
    onUnsupported: () => notify(t('home.videoConvert.selectionError'))
  }).then(unlisten => { if (!disposed) nativeDropUnlisten = unlisten; else unlisten?.(); }).catch(error => console.warn('[Video Convert] native drop unavailable:', error));

  return {
    open,
    close,
    dispose() {
      if (disposed) return;
      disposed = true;
      close();
      nativeDropUnlisten?.();
      nativeDropUnlisten = null;
      queueScope.dispose();
      lifecycle.dispose();
    }
  };
}
