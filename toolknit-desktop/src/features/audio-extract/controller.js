import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { onLangChange, t as defaultTranslate } from '../../i18n.js';
import { loadTauriDialog, loadTauriWebview, tauriCorePromise, tauriEventPromise } from '../../platform/tauri-runtime.js';
import {
  AudioExtractError,
  assertAudioExtractInput,
  normalizeAudioExtractFormat,
  normalizeAudioTrackIndex
} from '../../audio-extract-core.js';

const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'ts', 'm4v'];

function fileNameFromPath(value) {
  return String(value || '').split(/[\\/]/).pop() || String(value || '');
}

function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '--';
  const total = Math.floor(value);
  const minutes = Math.floor(total / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0
    ? `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
    : `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

function formatFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 1) return '--';
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function outputParent(path) {
  return String(path || '').replace(/[/\\][^/\\]+$/, '');
}

export function createAudioExtractController({
  overlay,
  isTauri = false,
  t = defaultTranslate,
  onLangChange: registerLanguageChange = onLangChange,
  getOutputDir,
  displayFilesystemPath = value => String(value || ''),
  openOutputFolder = async () => false,
  ensureFfmpegAvailable = async () => isTauri,
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = instance => instance?.(),
  openSettings = () => {},
  openSupport = () => {},
  openExternalUrl = () => {},
  handleWindowAction = () => {},
  notify = message => window.alert(message),
  refreshIcons = () => {},
  documentRef = globalThis.document,
  tauriCore = tauriCorePromise,
  loadDialog = loadTauriDialog,
  tauriEvents = tauriEventPromise
} = {}) {
  if (!overlay) throw new Error('audio-extract:missing-overlay');
  if (!documentRef) throw new Error('audio-extract:missing-document');
  if (typeof getOutputDir !== 'function') throw new Error('audio-extract:missing-output-directory');

  const lifecycle = createLifecycleScope();
  const query = selector => overlay.querySelector(selector);
  const background = query('[data-audio-extract-bg]');
  const dropZone = query('[data-audio-extract-drop-zone]');
  const body = query('[data-audio-extract-body]');
  const hero = query('[data-audio-extract-hero]');
  const info = query('[data-audio-extract-info]');
  const fileName = query('[data-audio-extract-file-name]');
  const fileMeta = query('[data-audio-extract-file-meta]');
  const formatOptions = query('[data-audio-extract-formats]');
  const trackWrap = query('[data-audio-extract-track-wrap]');
  const trackSelect = query('[data-audio-extract-track]');
  const processMask = query('[data-audio-extract-process]');
  const progress = query('[data-audio-extract-progress]');
  const processText = query('[data-audio-extract-process-text]');
  const success = query('[data-audio-extract-success]');
  const successMeta = query('[data-audio-extract-success-meta]');
  const successFile = query('[data-audio-extract-success-file]');
  const successFormat = query('[data-audio-extract-success-format]');
  const successPath = query('[data-audio-extract-success-path]');

  let session = null;
  let sessionSequence = 0;
  let operationSequence = 0;
  let activeOperation = null;
  let plasma = null;
  let nativeDropUnlisten = null;
  let state = createEmptyState();
  let disposed = false;

  function createEmptyState() {
    return { inputPath: '', fileName: '', fileSize: 0, outputPath: '', targetFormat: 'MP3', trackIndex: null, tracks: [], ready: false, processing: false };
  }

  function copy(key, values) {
    return t(`home.audioExtract.${key}`, values);
  }

  function isCurrent(owner, operationId = null) {
    return !disposed && session === owner && !owner.closed && overlay.classList.contains('visible')
      && (operationId === null || activeOperation?.id === operationId);
  }

  function setProgress(value, message = '') {
    if (progress) progress.style.width = `${Math.min(100, Math.max(0, Number(value) || 0))}%`;
    if (message && processText) processText.textContent = message;
  }

  function progressMessage(status) {
    const key = {
      probe: 'probing',
      prepare: 'preparing',
      extract: 'extracting',
      publish: 'preparing',
      cancelled: 'cancelled',
      failed: 'failed'
    }[status] || 'extracting';
    return copy(key);
  }

  function renderLocale() {
    if (disposed) return;
    const keys = { back: 'settings.back', website: 'nav.website', support: 'support.author', settings: 'nav.settings', heroLabel: 'home.audioExtract.heroLabel', title: 'home.audioExtract.title', subtitle: 'home.audioExtract.subtitle', cta: 'home.audioExtract.cta', targetFormat: 'home.audioExtract.targetFormat', selectTrack: 'home.audioExtract.selectTrack', extractBtn: 'home.audioExtract.extractBtn', formatsTitle: 'home.audioExtract.formatsTitle', successTitle: 'home.audioExtract.successTitle', successSource: 'home.audioExtract.successSource', successFormat: 'home.audioExtract.successFormat', successPath: 'home.audioExtract.successPath', openFolder: 'home.audioExtract.openFolder', ok: 'home.audioExtract.ok', dropHint: 'home.audioExtract.dropHint' };
    overlay.querySelectorAll('[data-audio-extract-text]').forEach(node => {
      const key = keys[node.dataset.audioExtractText];
      if (key) node.textContent = key.startsWith('home.') ? t(key) : t(key);
    });
    renderTracks(state.tracks);
    if (state.fileName && fileMeta && !state.processing) fileMeta.textContent = state.fileMeta || fileMeta.textContent;
    refreshIcons();
  }

  function setDropVisible(visible) {
    dropZone?.classList.toggle('visible', visible);
    overlay.classList.toggle('drag-over', visible);
  }

  function renderTracks(tracks) {
    if (!trackSelect || !trackWrap) return;
    const selectedTrack = state.trackIndex;
    trackSelect.replaceChildren();
    const list = Array.isArray(tracks) ? tracks : [];
    list.forEach((track, position) => {
      const option = documentRef.createElement('option');
      const index = normalizeAudioTrackIndex(track?.index ?? position);
      option.value = String(index);
      option.textContent = `${copy('trackLabel', { index: position + 1 })} · ${track?.codec || 'Unknown'} · ${track?.language || 'default'} · ${track?.channels || 'unknown'}`;
      trackSelect.append(option);
    });
    if (selectedTrack !== null && Array.from(trackSelect.options).some(option => option.value === String(selectedTrack))) {
      trackSelect.value = String(selectedTrack);
    }
    state.trackIndex = list.length ? normalizeAudioTrackIndex(trackSelect.value) : null;
    trackWrap.hidden = list.length < 2;
  }

  function renderState() {
    const hasFile = Boolean(state.fileName);
    if (hero) hero.hidden = hasFile;
    if (info) info.hidden = !hasFile;
    if (fileName) fileName.textContent = state.fileName || '--';
    if (fileMeta && hasFile && state.fileMeta) fileMeta.textContent = state.fileMeta;
    if (trackWrap) trackWrap.hidden = !hasFile || state.tracks.length < 2;
    const start = query('[data-audio-extract-action="start"]');
    if (start) start.disabled = !state.ready || state.processing;
    renderTracks(state.tracks);
    refreshIcons();
  }

  function resetState() {
    if (activeOperation?.processing && isTauri) {
      void tauriCore.then(({ invoke }) => invoke('cancel_convert')).catch(() => {});
    }
    activeOperation = null;
    state = createEmptyState();
    setProgress(0);
    processMask?.classList.remove('visible');
    success?.classList.remove('visible');
    renderState();
  }

  function errorMessage(error) {
    const code = error instanceof AudioExtractError ? error.code : String(error?.message || error || '');
    const keys = { invalid_input: 'invalidInput', input_too_large: 'inputTooLarge', invalid_target_format: 'invalidFormat', invalid_track: 'invalidTrack', 'audio-extract:cancelled': 'cancelled', 'audio-extract:invalid-input': 'invalidInput', 'audio-extract:input-too-large': 'inputTooLarge', 'audio-extract:invalid-target-format': 'invalidFormat', 'audio-extract:invalid-track': 'invalidTrack', 'audio-extract:no-audio-track': 'noAudioTrack', 'audio-extract:output-path': 'outputError', 'audio-extract:desktop-only': 'desktopOnly', 'audio-extract:runtime-unavailable': 'runtimeUnavailable', 'audio-extract:failed': 'failed' };
    return keys[code] ? copy(keys[code]) : copy('failed');
  }

  async function chooseFile() {
    if (!session || state.processing) return;
    const owner = session;
    if (isTauri) {
      try {
        const { open } = await loadDialog();
        const selected = await open({ multiple: false, filters: [{ name: 'Video Files', extensions: VIDEO_EXTENSIONS }] });
        if (isCurrent(owner) && typeof selected === 'string') await loadVideoFile({ path: selected, name: fileNameFromPath(selected) });
      } catch (error) {
        notify(errorMessage(error));
      }
      return;
    }
    const input = documentRef.createElement('input');
    input.type = 'file';
    input.accept = VIDEO_EXTENSIONS.map(extension => `.${extension}`).join(',');
    input.addEventListener('change', () => { const file = input.files?.[0]; if (file) void loadVideoFile(file); }, { once: true });
    input.click();
  }

  async function loadVideoFile(file) {
    const owner = session;
    if (!owner || state.processing) return;
    const runId = ++operationSequence;
    state = { ...createEmptyState(), targetFormat: state.targetFormat, fileName: file?.name || fileNameFromPath(file?.path), inputPath: file?.path || '', fileSize: Number(file?.size) || 0 };
    renderState();
    try {
      let invoke = null;
      if (isTauri && state.inputPath) {
        ({ invoke } = await tauriCore);
        const size = Number(await invoke('get_file_size', { path: state.inputPath }));
        if (!isCurrent(owner) || runId !== operationSequence) return;
        state.fileSize = size;
      }
      assertAudioExtractInput({ name: state.fileName, size: state.fileSize });
      if (!isCurrent(owner, null) || runId !== operationSequence) return;
      state.fileMeta = isTauri && state.inputPath ? copy('probing') : formatFileSize(state.fileSize);
      renderState();
      if (!isTauri || !state.inputPath) {
        state.ready = true;
        renderState();
        return;
      }
      const probe = await invoke('probe_video', { inputPath: state.inputPath });
      if (!isCurrent(owner, null) || runId !== operationSequence) return;
      state.tracks = Array.isArray(probe?.audio_tracks) ? probe.audio_tracks : [];
      state.fileMeta = state.tracks.length ? [formatDuration(probe.duration), formatFileSize(probe.file_size)].join(' · ') : copy('noAudioTrack');
      state.ready = state.tracks.length > 0;
      renderState();
    } catch (error) {
      if (!isCurrent(owner, null) || runId !== operationSequence) return;
      state.ready = false;
      state.fileMeta = errorMessage(error);
      renderState();
    }
  }

  async function startExtraction() {
    const owner = session;
    if (!owner || !state.ready || state.processing) return;
    if (!isTauri || !state.inputPath) {
      notify(copy('desktopOnly'));
      return;
    }
    let targetFormat;
    try { targetFormat = normalizeAudioExtractFormat(state.targetFormat); } catch (error) { notify(errorMessage(error)); return; }
    const operation = { id: ++operationSequence, owner, processing: true };
    activeOperation = operation;
    state.processing = true;
    renderState();
    processMask?.classList.add('visible');
    setProgress(4, copy('extracting'));
    let unlisten = null;
    try {
      const [{ invoke }, { listen }] = await Promise.all([tauriCore, tauriEvents]);
      const outputDir = await getOutputDir('Audio');
      if (!isCurrent(owner, operation.id)) return;
      if (!await ensureFfmpegAvailable()) throw new Error('audio-extract:runtime-unavailable');
      if (!isCurrent(owner, operation.id)) return;
      unlisten = await listen('audio-extract-progress', event => {
        if (!isCurrent(owner, operation.id)) return;
        const data = event?.payload || {};
        const value = Number(data.progress);
        setProgress(Number.isFinite(value) ? Math.min(98, Math.max(4, Math.round(value * 100))) : 20, progressMessage(data.status));
      });
      const result = await invoke('extract_audio', { inputPath: state.inputPath, outputDir, targetFormat, trackIndex: normalizeAudioTrackIndex(state.trackIndex) });
      if (!isCurrent(owner, operation.id)) return;
      if (!result?.success || !result.output_path) throw new Error(result?.error || 'audio-extract:failed');
      state.outputPath = result.output_path;
      setProgress(100);
      if (successMeta) successMeta.textContent = copy('successSummary', { name: state.fileName, format: targetFormat });
      if (successFile) successFile.textContent = state.fileName;
      if (successFormat) successFormat.textContent = targetFormat;
      if (successPath) { successPath.textContent = displayFilesystemPath(result.output_path); successPath.title = displayFilesystemPath(result.output_path); }
      success?.classList.add('visible');
    } catch (error) {
      if (isCurrent(owner, operation.id)) notify(errorMessage(error));
    } finally {
      unlisten?.();
      if (activeOperation === operation) activeOperation = null;
      if (isCurrent(owner, null)) {
        state.processing = false;
        processMask?.classList.remove('visible');
        setProgress(0);
        renderState();
      }
    }
  }

  function close() {
    if (!session) return;
    session.closed = true;
    operationSequence += 1;
    resetState();
    plasma && disposeStandardToolPlasma(plasma);
    plasma = null;
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    session = null;
  }

  function open() {
    if (disposed) return;
    if (session && !session.closed) return;
    session = { id: ++sessionSequence, closed: false };
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    if (background && !plasma) plasma = initStandardToolPlasma(background);
    resetState();
  }

  function bindActions() {
    const actionMap = {
      back: close,
      choose: () => { void chooseFile(); },
      remove: resetState,
      start: () => { void startExtraction(); },
      'open-folder': () => { if (state.outputPath) void openOutputFolder(state.outputPath); },
      'success-ok': () => { success?.classList.remove('visible'); resetState(); },
      website: () => openExternalUrl('https://toolknit.com'),
      support: openSupport,
      settings: openSettings
    };
    overlay.querySelectorAll('[data-audio-extract-action]').forEach(node => {
      const handler = actionMap[node.dataset.audioExtractAction];
      if (handler) lifecycle.event(node, 'click', event => { event.stopPropagation(); handler(); });
    });
    overlay.querySelectorAll('[data-window-action]').forEach(node => lifecycle.event(node, 'click', () => handleWindowAction(node.dataset.windowAction)));
    formatOptions?.querySelectorAll('[data-format]').forEach(node => lifecycle.event(node, 'click', () => {
      if (state.processing) return;
      state.targetFormat = normalizeAudioExtractFormat(node.dataset.format);
      formatOptions.querySelectorAll('[data-format]').forEach(item => item.classList.toggle('active', item === node));
    }));
    lifecycle.event(trackSelect, 'change', () => { state.trackIndex = normalizeAudioTrackIndex(trackSelect.value); });
    lifecycle.event(overlay, 'dragover', event => { if (!isTauri) { event.preventDefault(); setDropVisible(true); } });
    lifecycle.event(overlay, 'dragleave', event => { if (!isTauri || (event.relatedTarget && overlay.contains(event.relatedTarget))) return; setDropVisible(false); });
    lifecycle.event(overlay, 'drop', event => { if (isTauri) return; event.preventDefault(); setDropVisible(false); const file = event.dataTransfer?.files?.[0]; if (file) void loadVideoFile(file); });
    const unregisterLanguage = registerLanguageChange(renderLocale);
    lifecycle.use(unregisterLanguage);
  }

  async function registerNativeDrop() {
    if (!isTauri) return;
    try {
      const { getCurrentWebview } = await loadTauriWebview();
      const unlisten = await getCurrentWebview().onDragDropEvent(event => {
        if (!session || session.closed || !overlay.classList.contains('visible') || state.processing) return;
        const payload = event?.payload || {};
        if (payload.type === 'enter' || payload.type === 'over') setDropVisible(true);
        else if (payload.type === 'leave') setDropVisible(false);
        else if (payload.type === 'drop') {
          setDropVisible(false);
          const path = (payload.paths || []).find(value => VIDEO_EXTENSIONS.some(extension => String(value).toLowerCase().endsWith(`.${extension}`)));
          if (path) void loadVideoFile({ path, name: fileNameFromPath(path) });
        }
      });
      if (disposed) unlisten?.();
      else nativeDropUnlisten = unlisten;
    } catch (error) {
      console.warn('Cannot register audio extract drag and drop:', error);
    }
  }

  bindActions();
  void registerNativeDrop();

  return {
    open,
    close,
    dispose() {
      if (disposed) return;
      disposed = true;
      close();
      nativeDropUnlisten?.();
      nativeDropUnlisten = null;
      lifecycle.dispose();
      overlay.replaceChildren();
    }
  };
}
