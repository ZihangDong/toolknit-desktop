import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { onLangChange } from '../../i18n.js';
import { loadTauriDialog, loadTauriWebview, tauriCorePromise } from '../../platform/tauri-runtime.js';
import {
  AudioClipError,
  assertAudioClipBuffer,
  assertAudioClipInput,
  assertAudioClipSelection,
  isAudioClipSupportedName
} from '../../audio-clip-core.js';

function outputParentFolder(outputPath) {
  const value = String(outputPath || '').trim().replace(/[\\/]+$/, '');
  const parent = value.replace(/[/\\][^/\\]+$/, '');
  return parent && parent !== value ? parent : value;
}

export function createAudioClipController({
  overlay,
  isTauri = false,
  t = value => value,
  onLangChange: registerLanguageChange = onLangChange,
  refreshIcons = () => {},
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = instance => instance?.(),
  getOutputDir,
  displayFilesystemPath = value => String(value || ''),
  openOutputFolder = async () => false,
  ensureFfmpegAvailable = async () => isTauri,
  openSettings = () => {},
  openSupport = () => {},
  openExternalUrl = () => {},
  handleWindowAction = () => {},
  syncWindowFrameAfterLayoutChange = () => {},
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  tauriCore = tauriCorePromise,
  notify = message => windowRef?.alert?.(message)
} = {}) {
  if (!overlay || !documentRef) throw new Error('audio-clip:missing-root');
  if (typeof getOutputDir !== 'function') throw new Error('audio-clip:missing-output-directory');

  const document = documentRef;
  const window = windowRef || globalThis.window;
  const lifecycle = createLifecycleScope({ onError: error => console.error('[Audio Clip] cleanup:', error) });
  const byId = id => document.getElementById(id) || overlay.querySelector(`#${id}`);
  const audioClipBack = byId('audioClipBack');
  const audioClipCta = byId('audioClipCta');
  const audioClipHeroTop = byId('audioClipHeroTop');
  const audioClipDropZone = byId('audioClipDropZone');
  const audioClipPlasmaBg = byId('audioClipPlasmaBg');
  const audioClipFileInfo = byId('audioClipFileInfo');
  const audioClipFileName = byId('audioClipFileName');
  const audioClipFileDuration = byId('audioClipFileDuration');
  const audioClipFileRemove = byId('audioClipFileRemove');
  const audioClipWaveformWrap = byId('audioClipWaveformWrap');
  const audioClipCanvas = byId('audioClipCanvas');
  const audioClipSelection = byId('audioClipSelection');
  const audioClipPlayhead = byId('audioClipPlayhead');
  const audioClipTimeStart = byId('audioClipTimeStart');
  const audioClipTimeEnd = byId('audioClipTimeEnd');
  const audioClipSelectionInfo = byId('audioClipSelectionInfo');
  const audioClipSelStart = byId('audioClipSelStart');
  const audioClipSelEnd = byId('audioClipSelEnd');
  const audioClipSelDuration = byId('audioClipSelDuration');
  const audioClipControls = byId('audioClipControls');
  const audioClipPlayBtn = byId('audioClipPlayBtn');
  const audioClipMinusBtn = byId('audioClipMinusBtn');
  const audioClipPlusBtn = byId('audioClipPlusBtn');
  const audioClipResetBtn = byId('audioClipResetBtn');
  const audioClipCurrentTime = byId('audioClipCurrentTime');
  const audioClipTotalTime = byId('audioClipTotalTime');
  const audioClipExportBtn = byId('audioClipExportBtn');
  const audioClipHandleStart = byId('audioClipHandleStart');
  const audioClipHandleEnd = byId('audioClipHandleEnd');
  const audioClipHandleStartLabel = byId('audioClipHandleStartLabel');
  const audioClipHandleEndLabel = byId('audioClipHandleEndLabel');
  const audioClipSuccessOverlay = byId('audioClipSuccessOverlay');
  const audioClipSuccessPath = byId('audioClipSuccessPath');
  const audioClipSuccessMeta = byId('audioClipSuccessMeta');
  const audioClipSuccessFile = byId('audioClipSuccessFile');
  const audioClipSuccessDuration = byId('audioClipSuccessDuration');
  const audioClipSuccessOpenFolder = byId('audioClipSuccessOpenFolder');
  const audioClipSuccessOk = byId('audioClipSuccessOk');
  const audioClipProcessMask = byId('audioClipProcessMask');
  const audioClipProcessBarFill = byId('audioClipProcessBarFill');
  const audioClipProcessText = byId('audioClipProcessText');

  let plasma = null;
  let disposed = false;
  let loadRevision = 0;
  let exportRevision = 0;
  let redrawFrame = 0;
  let dragScope = null;
  let viewScope = null;
  const clipState = {
    audioBuffer: null,
    audioContext: null,
    audioSource: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    filePath: '',
    fileName: '',
    selStart: 0,
    selEnd: 0,
    hasSelection: false,
    rafId: 0,
    isLoading: false,
    isExporting: false,
    outputPath: '',
    activeHandle: null
  };

  const visible = () => overlay.classList.contains('visible') && !disposed;
  const currentLoad = id => id === loadRevision && visible();
  const currentExport = id => id === exportRevision && visible();
  const raf = callback => (window?.requestAnimationFrame ? window.requestAnimationFrame(callback) : setTimeout(callback, 0));
  const cancelRaf = id => (window?.cancelAnimationFrame ? window.cancelAnimationFrame(id) : clearTimeout(id));

  function errorMessage(error) {
    if (error instanceof AudioClipError) {
      const key = {
        invalid_input: 'invalidInput',
        input_too_large: 'inputTooLarge',
        invalid_audio: 'decodeError',
        audio_too_long: 'audioTooLong',
        unsupported_channels: 'unsupportedChannels',
        decoded_audio_too_large: 'decodedAudioTooLarge',
        invalid_selection: 'invalidSelection'
      }[error.code];
      if (key) return t(`home.audioClip.${key}`);
    }
    const code = String(typeof error === 'string' ? error : error?.message || '').toLowerCase();
    const backendCodeMap = {
      'audio-clip:invalid-input': 'invalidInput',
      'audio-clip:input-too-large': 'inputTooLarge',
      'audio-clip:audio-too-long': 'audioTooLong',
      'audio-clip:invalid-selection': 'invalidSelection',
      'audio-clip:cancelled': 'cancelled',
      'audio-clip:output-path': 'outputPathError',
      'audio-clip:failed': 'exportError'
    };
    const matched = Object.keys(backendCodeMap).find(key => code.includes(key));
    if (matched) return t(`home.audioClip.${backendCodeMap[matched]}`);
    if (code.includes('cancelled')) return t('home.audioClip.cancelled');
    return t('home.audioClip.exportError');
  }

  function formatTime(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return '0:00';
    const minutes = Math.floor(value / 60);
    return `${minutes}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  }

  function setPlayIcon(playing) {
    if (!audioClipPlayBtn) return;
    audioClipPlayBtn.innerHTML = playing
      ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
      : '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
  }

  function stopPlayback() {
    const source = clipState.audioSource;
    clipState.audioSource = null;
    if (source) {
      try { source.onended = null; source.stop(); } catch {}
      try { source.disconnect(); } catch {}
    }
    if (clipState.rafId) cancelRaf(clipState.rafId);
    clipState.rafId = 0;
    clipState.isPlaying = false;
    setPlayIcon(false);
  }

  function setActiveHandle(handle) {
    clipState.activeHandle = handle;
    audioClipHandleStart?.classList.toggle('active', handle === 'start');
    audioClipHandleEnd?.classList.toggle('active', handle === 'end');
    if (audioClipMinusBtn) audioClipMinusBtn.disabled = !handle;
    if (audioClipPlusBtn) audioClipPlusBtn.disabled = !handle;
  }

  function clearLoadedState() {
    stopPlayback();
    if (redrawFrame) cancelRaf(redrawFrame);
    redrawFrame = 0;
    clipState.audioBuffer = null;
    clipState.currentTime = 0;
    clipState.duration = 0;
    clipState.filePath = '';
    clipState.fileName = '';
    clipState.outputPath = '';
    clipState.selStart = 0;
    clipState.selEnd = 0;
    clipState.hasSelection = false;
    clipState.activeHandle = null;
    audioClipFileInfo?.classList.remove('visible');
    if (audioClipFileName) audioClipFileName.textContent = '--';
    if (audioClipFileDuration) audioClipFileDuration.textContent = '--';
    audioClipWaveformWrap?.classList.remove('visible');
    audioClipControls?.classList.remove('visible');
    audioClipSelectionInfo?.classList.remove('visible');
    audioClipExportBtn?.classList.remove('visible');
    overlay.classList.remove('has-file', 'drag-over');
    audioClipDropZone?.classList.remove('visible');
    if (audioClipSelection) { audioClipSelection.style.display = 'none'; audioClipSelection.style.width = '0px'; }
    if (audioClipPlayhead) audioClipPlayhead.style.display = 'none';
    if (audioClipHandleStart) audioClipHandleStart.style.display = 'none';
    if (audioClipHandleEnd) audioClipHandleEnd.style.display = 'none';
    setActiveHandle(null);
    if (audioClipHeroTop) audioClipHeroTop.style.display = '';
    audioClipSuccessOverlay?.classList.remove('visible');
    for (const node of [audioClipCurrentTime, audioClipTotalTime, audioClipTimeStart, audioClipTimeEnd, audioClipSelStart, audioClipSelEnd, audioClipSelDuration]) {
      if (node) node.textContent = '0:00';
    }
  }

  function invalidateExport() {
    const wasExporting = clipState.isExporting;
    exportRevision += 1;
    clipState.isExporting = false;
    if (audioClipExportBtn) { audioClipExportBtn.disabled = false; audioClipExportBtn.style.opacity = ''; }
    audioClipProcessMask?.classList.remove('visible');
    if (audioClipProcessBarFill) audioClipProcessBarFill.style.width = '0%';
    if (wasExporting && isTauri) tauriCore.then(({ invoke }) => invoke('cancel_convert')).catch(() => {});
  }

  function resetState() {
    loadRevision += 1;
    invalidateExport();
    clipState.isLoading = false;
    clearLoadedState();
  }

  function closeAudioContext() {
    const context = clipState.audioContext;
    clipState.audioContext = null;
    if (context && typeof context.close === 'function' && context.state !== 'closed') context.close().catch(() => {});
  }

  function getAudioContext() {
    if (clipState.audioContext) return clipState.audioContext;
    const Context = window?.AudioContext || window?.webkitAudioContext;
    if (!Context) throw new AudioClipError('invalid_audio', 'AudioContext unavailable');
    clipState.audioContext = new Context();
    return clipState.audioContext;
  }

  function metrics() {
    const canvasRect = audioClipCanvas?.getBoundingClientRect?.();
    const wrapRect = audioClipWaveformWrap?.getBoundingClientRect?.();
    if (!canvasRect || !wrapRect) return { left: 0, width: 1, canvasLeft: 0 };
    return { left: Math.max(0, canvasRect.left - wrapRect.left), width: Math.max(1, canvasRect.width), canvasLeft: canvasRect.left };
  }

  function timeToX(time) {
    const { left, width } = metrics();
    return clipState.duration ? left + (Number(time) / clipState.duration) * width : left;
  }

  function clientXToTime(clientX) {
    const { canvasLeft, width } = metrics();
    return Math.max(0, Math.min(1, (Number(clientX) - canvasLeft) / width)) * clipState.duration;
  }

  function updateSelectionOverlay() {
    if (!clipState.hasSelection || !audioClipSelection) {
      audioClipSelection && (audioClipSelection.style.display = 'none');
      audioClipHandleStart && (audioClipHandleStart.style.display = 'none');
      audioClipHandleEnd && (audioClipHandleEnd.style.display = 'none');
      setActiveHandle(null);
      return;
    }
    const startX = timeToX(clipState.selStart);
    const endX = timeToX(clipState.selEnd);
    audioClipSelection.style.display = 'block';
    audioClipSelection.style.left = `${startX}px`;
    audioClipSelection.style.width = `${Math.max(0, endX - startX)}px`;
    if (audioClipHandleStart) { audioClipHandleStart.style.display = 'flex'; audioClipHandleStart.style.left = `${startX}px`; }
    if (audioClipHandleEnd) { audioClipHandleEnd.style.display = 'flex'; audioClipHandleEnd.style.left = `${endX}px`; }
    if (audioClipHandleStartLabel) audioClipHandleStartLabel.textContent = formatTime(clipState.selStart);
    if (audioClipHandleEndLabel) audioClipHandleEndLabel.textContent = formatTime(clipState.selEnd);
    if (audioClipSelStart) audioClipSelStart.textContent = formatTime(clipState.selStart);
    if (audioClipSelEnd) audioClipSelEnd.textContent = formatTime(clipState.selEnd);
    if (audioClipSelDuration) audioClipSelDuration.textContent = formatTime(clipState.selEnd - clipState.selStart);
  }

  function updatePlayhead() {
    if (!clipState.duration || !audioClipPlayhead) return;
    audioClipPlayhead.style.display = 'block';
    audioClipPlayhead.style.left = `${timeToX(clipState.currentTime)}px`;
    if (audioClipCurrentTime) audioClipCurrentTime.textContent = formatTime(clipState.currentTime);
  }

  function drawWaveform() {
    if (!clipState.audioBuffer || !audioClipCanvas) return;
    const rect = audioClipCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.max(1, Number(window?.devicePixelRatio) || 1);
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    audioClipCanvas.width = Math.max(1, Math.round(width * dpr));
    audioClipCanvas.height = Math.max(1, Math.round(height * dpr));
    const context = audioClipCanvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const styles = window?.getComputedStyle?.(audioClipCanvas);
    context.fillStyle = styles?.getPropertyValue('--clip-wave-ink').trim() || 'rgba(255, 255, 255, 0.78)';
    context.strokeStyle = styles?.getPropertyValue('--clip-wave-axis').trim() || 'rgba(255, 255, 255, 0.18)';
    context.lineWidth = 1;
    const midY = height / 2;
    context.beginPath(); context.moveTo(0, midY); context.lineTo(width, midY); context.stroke();
    const buffer = clipState.audioBuffer;
    const channelCount = Math.max(1, Math.min(Number(buffer.numberOfChannels) || 1, 2));
    const channels = Array.from({ length: channelCount }, (_, index) => buffer.getChannelData(index));
    const samplesPerPixel = Math.max(1, Math.floor(buffer.length / width));
    for (let x = 0; x < width; x += 1) {
      let min = 1; let max = -1;
      const start = x * samplesPerPixel;
      const end = Math.min(start + samplesPerPixel, buffer.length);
      const step = Math.max(1, Math.ceil((end - start) / 1024));
      for (let index = start; index < end; index += step) {
        for (const channel of channels) { const value = channel[index] || 0; min = Math.min(min, value); max = Math.max(max, value); }
      }
      context.fillRect(x, midY + min * midY * 0.9, 1, Math.max(2, (max - min) * midY * 0.9));
    }
  }

  function scheduleRedraw() {
    if (!clipState.audioBuffer || !audioClipWaveformWrap?.classList.contains('visible')) return;
    if (redrawFrame) cancelRaf(redrawFrame);
    redrawFrame = raf(() => { redrawFrame = 0; drawWaveform(); updateSelectionOverlay(); updatePlayhead(); });
  }

  function startPlayback() {
    if (!clipState.audioBuffer || clipState.isPlaying) return;
    const context = clipState.audioContext;
    if (!context) return;
    clipState.isPlaying = true;
    if (context.state === 'suspended') context.resume().catch(() => {});
    const start = clipState.hasSelection ? clipState.selStart : 0;
    const end = clipState.hasSelection ? clipState.selEnd : clipState.duration;
    const playSegment = from => {
      if (!clipState.isPlaying || !clipState.audioBuffer) return;
      if (clipState.rafId) cancelRaf(clipState.rafId);
      const source = context.createBufferSource();
      source.buffer = clipState.audioBuffer;
      source.connect(context.destination);
      clipState.audioSource = source;
      const offset = Math.max(0, Math.min(from, Math.max(0, clipState.duration - 0.001)));
      const startedAt = context.currentTime - offset;
      source.start(0, offset);
      source.onended = () => {
        if (clipState.isPlaying && clipState.audioSource === source) { clipState.audioSource = null; clipState.currentTime = start; playSegment(start); }
      };
      const tick = () => {
        if (!clipState.isPlaying || clipState.audioSource !== source) return;
        clipState.currentTime = context.currentTime - startedAt;
        if (clipState.currentTime >= end) { try { source.stop(); } catch {} clipState.audioSource = null; clipState.currentTime = start; playSegment(start); return; }
        updatePlayhead(); clipState.rafId = raf(tick);
      };
      clipState.rafId = raf(tick);
    };
    const initial = clipState.currentTime >= start && clipState.currentTime < end ? clipState.currentTime : start;
    clipState.currentTime = initial;
    playSegment(initial);
    setPlayIcon(true);
  }

  function beginHandleDrag(event, handle) {
    if (!clipState.audioBuffer || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); event.stopPropagation(); stopPlayback(); setActiveHandle(handle);
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    dragScope?.dispose();
    dragScope = createLifecycleScope();
    document.body?.classList.add('audio-clip-pointer-dragging');
    const move = moveEvent => {
      const time = clientXToTime(moveEvent.clientX);
      if (handle === 'start') { clipState.selStart = Math.max(0, Math.min(clipState.selEnd - 0.1, time)); clipState.currentTime = clipState.selStart; }
      else { clipState.selEnd = Math.min(clipState.duration, Math.max(clipState.selStart + 0.1, time)); clipState.currentTime = clipState.selEnd; }
      updatePlayhead(); updateSelectionOverlay();
    };
    const end = () => { document.body?.classList.remove('audio-clip-pointer-dragging'); dragScope?.dispose(); dragScope = null; };
    dragScope.event(document, 'pointermove', move);
    dragScope.event(document, 'pointerup', end, { once: true });
    dragScope.event(document, 'pointercancel', end, { once: true });
  }

  async function selectFile() {
    if (clipState.isLoading || clipState.isExporting) return;
    if (isTauri) {
      try {
        const { open } = await loadTauriDialog();
        const selected = await open({ multiple: false, filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'] }] });
        if (typeof selected === 'string') await loadFile(selected);
      } catch (error) { notify(errorMessage(error)); }
      return;
    }
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'audio/*';
    input.addEventListener('change', () => { const file = input.files?.[0]; if (file) void loadFile(file); }, { once: true });
    input.click();
  }

  async function loadFile(filePathOrFile) {
    if (clipState.isLoading || clipState.isExporting) return;
    const runId = ++loadRevision;
    clipState.isLoading = true;
    clearLoadedState();
    if (audioClipProcessBarFill) audioClipProcessBarFill.style.width = '30%';
    if (audioClipProcessText) audioClipProcessText.textContent = t('home.audioClip.loading');
    audioClipProcessMask?.classList.add('visible');
    let arrayBuffer; let fileName = ''; let sourcePath = '';
    try {
      if (typeof filePathOrFile === 'string') {
        sourcePath = filePathOrFile;
        fileName = filePathOrFile.split(/[/\\]/).pop() || filePathOrFile;
        if (!isTauri) throw new AudioClipError('invalid_input', 'Desktop file paths are unavailable in a browser.');
        const { invoke } = await tauriCore;
        const size = Number(await invoke('get_file_size', { path: sourcePath }));
        assertAudioClipInput({ name: fileName, size });
        if (!currentLoad(runId)) return;
        const bytes = await invoke('read_file_bytes_limited', { path: sourcePath, maxBytes: 100 * 1024 * 1024 });
        if (!currentLoad(runId)) return;
        arrayBuffer = new Uint8Array(bytes).buffer;
      } else {
        fileName = filePathOrFile?.name || '';
        assertAudioClipInput(filePathOrFile);
        if (isTauri && filePathOrFile?.path) {
          sourcePath = filePathOrFile.path;
          const { invoke } = await tauriCore;
          const size = Number(await invoke('get_file_size', { path: sourcePath }));
          assertAudioClipInput({ name: fileName, size });
          if (!currentLoad(runId)) return;
          const bytes = await invoke('read_file_bytes_limited', { path: sourcePath, maxBytes: 100 * 1024 * 1024 });
          if (!currentLoad(runId)) return;
          arrayBuffer = new Uint8Array(bytes).buffer;
        } else arrayBuffer = await filePathOrFile.arrayBuffer();
      }
      if (!currentLoad(runId)) return;
      if (audioClipProcessBarFill) audioClipProcessBarFill.style.width = '70%';
      const context = getAudioContext();
      if (context.state === 'suspended') await context.resume();
      const audioBuffer = await context.decodeAudioData(arrayBuffer);
      if (!currentLoad(runId)) return;
      assertAudioClipBuffer(audioBuffer);
      const duration = audioBuffer.duration;
      Object.assign(clipState, { audioBuffer, filePath: sourcePath, fileName, duration, currentTime: 0, selStart: 0, selEnd: duration, hasSelection: true });
      setActiveHandle('start');
      audioClipHeroTop && (audioClipHeroTop.style.display = 'none');
      overlay.classList.add('has-file');
      audioClipFileInfo?.classList.add('visible');
      if (audioClipFileName) audioClipFileName.textContent = fileName || '--';
      if (audioClipFileDuration) audioClipFileDuration.textContent = formatTime(duration);
      audioClipWaveformWrap?.classList.add('visible'); audioClipControls?.classList.add('visible'); audioClipSelectionInfo?.classList.add('visible'); audioClipExportBtn?.classList.add('visible');
      if (audioClipTimeStart) audioClipTimeStart.textContent = '0:00';
      if (audioClipTimeEnd) audioClipTimeEnd.textContent = formatTime(duration);
      if (audioClipTotalTime) audioClipTotalTime.textContent = formatTime(duration);
      if (audioClipCurrentTime) audioClipCurrentTime.textContent = '0:00';
      if (audioClipSelStart) audioClipSelStart.textContent = '0:00';
      if (audioClipSelEnd) audioClipSelEnd.textContent = formatTime(duration);
      if (audioClipSelDuration) audioClipSelDuration.textContent = formatTime(duration);
      if (audioClipProcessBarFill) audioClipProcessBarFill.style.width = '100%';
      scheduleRedraw(); refreshIcons();
    } catch (error) {
      console.error('Audio clip load error:', error);
      if (currentLoad(runId)) notify(errorMessage(error));
    } finally {
      if (currentLoad(runId)) { audioClipProcessMask?.classList.remove('visible'); if (audioClipProcessBarFill) audioClipProcessBarFill.style.width = '0%'; clipState.isLoading = false; }
    }
  }

  async function exportClip() {
    if (clipState.isExporting) return;
    if (!isTauri) { notify(t('home.audioClip.desktopOnly')); return; }
    if (!clipState.filePath) { notify(t('home.audioClip.noFile')); return; }
    let selection;
    try { selection = assertAudioClipSelection(clipState.hasSelection ? clipState.selStart : 0, clipState.hasSelection ? clipState.selEnd : clipState.duration, clipState.duration); }
    catch (error) { notify(errorMessage(error)); return; }
    const request = { inputPath: clipState.filePath, fileName: clipState.fileName, startTime: selection.start, endTime: selection.end, duration: selection.end - selection.start };
    const runId = ++exportRevision;
    clipState.isExporting = true;
    if (audioClipExportBtn) { audioClipExportBtn.disabled = true; audioClipExportBtn.style.opacity = '0.6'; }
    if (audioClipProcessBarFill) audioClipProcessBarFill.style.width = '15%';
    if (audioClipProcessText) audioClipProcessText.textContent = t('home.audioClip.exporting');
    audioClipProcessMask?.classList.add('visible');
    try {
      const { invoke } = await tauriCore;
      const outputDir = await getOutputDir('Audio');
      if (!currentExport(runId)) return;
      if (!await ensureFfmpegAvailable()) throw new Error('Audio trim runtime unavailable');
      if (!currentExport(runId)) return;
      if (audioClipProcessBarFill) audioClipProcessBarFill.style.width = '70%';
      const result = await invoke('trim_audio', { inputPath: request.inputPath, outputDir, startTime: request.startTime, endTime: request.endTime });
      if (!currentExport(runId)) return;
      if (!result?.success || !result.output_path) throw new Error(result?.error || 'Audio trim failed');
      if (audioClipProcessBarFill) audioClipProcessBarFill.style.width = '100%';
      clipState.outputPath = result.output_path;
      const duration = formatTime(request.duration);
      if (audioClipSuccessMeta) audioClipSuccessMeta.textContent = t('home.audioClip.successSummary', { name: request.fileName, duration });
      if (audioClipSuccessFile) audioClipSuccessFile.textContent = request.fileName;
      if (audioClipSuccessDuration) audioClipSuccessDuration.textContent = duration;
      if (audioClipSuccessPath) audioClipSuccessPath.textContent = displayFilesystemPath(result.output_path);
      audioClipSuccessOverlay?.classList.add('visible');
    } catch (error) {
      if (currentExport(runId)) { console.error('Audio clip export error:', error); notify(errorMessage(error)); }
    } finally {
      if (currentExport(runId)) { audioClipProcessMask?.classList.remove('visible'); if (audioClipProcessBarFill) audioClipProcessBarFill.style.width = '0%'; if (audioClipProcessText) audioClipProcessText.textContent = t('home.audioClip.loading'); clipState.isExporting = false; if (audioClipExportBtn) { audioClipExportBtn.disabled = false; audioClipExportBtn.style.opacity = ''; } }
    }
  }

  function setDropVisible(value) { overlay.classList.toggle('drag-over', value); audioClipDropZone?.classList.toggle('visible', value); }

  async function registerNativeDrop() {
    if (!isTauri) return;
    try {
      const { getCurrentWebview } = await loadTauriWebview();
      const unlisten = await getCurrentWebview().onDragDropEvent(event => {
        if (!visible() || clipState.isLoading || clipState.isExporting) return;
        const payload = event?.payload || {};
        if (payload.type === 'enter' || payload.type === 'over') setDropVisible(true);
        else if (payload.type === 'leave') setDropVisible(false);
        else if (payload.type === 'drop') {
          setDropVisible(false);
          const path = (payload.paths || []).find(isAudioClipSupportedName);
          if (path) void loadFile(path);
        }
      });
      if (disposed) unlisten?.(); else lifecycle.use(unlisten);
    } catch (error) { console.warn('[Audio Clip] native drop unavailable:', error); }
  }

  function bindActions() {
    const bind = (node, event, handler, options) => { if (node) lifecycle.event(node, event, eventObject => { eventObject.stopPropagation(); handler(eventObject); }, options); };
    bind(audioClipBack, 'click', close);
    bind(audioClipCta, 'click', () => { void selectFile(); });
    bind(audioClipFileRemove, 'click', resetState);
    bind(audioClipPlayBtn, 'click', () => { if (clipState.isPlaying) stopPlayback(); else startPlayback(); });
    bind(audioClipMinusBtn, 'click', () => { if (!clipState.hasSelection || !clipState.activeHandle) return; stopPlayback(); if (clipState.activeHandle === 'end') clipState.selEnd = Math.max(clipState.selStart + 0.1, clipState.selEnd - 1); else { clipState.selStart = Math.max(0, clipState.selStart - 1); if (clipState.selStart >= clipState.selEnd) clipState.selStart = Math.max(0, clipState.selEnd - 0.1); } clipState.currentTime = clipState.activeHandle === 'end' ? clipState.selEnd : clipState.selStart; updatePlayhead(); updateSelectionOverlay(); });
    bind(audioClipPlusBtn, 'click', () => { if (!clipState.hasSelection || !clipState.activeHandle) return; stopPlayback(); if (clipState.activeHandle === 'end') clipState.selEnd = Math.min(clipState.duration, clipState.selEnd + 1); else clipState.selStart = Math.min(clipState.selEnd - 0.1, clipState.selStart + 1); clipState.currentTime = clipState.activeHandle === 'end' ? clipState.selEnd : clipState.selStart; updatePlayhead(); updateSelectionOverlay(); });
    bind(audioClipResetBtn, 'click', () => { stopPlayback(); clipState.currentTime = 0; clipState.selStart = 0; clipState.selEnd = clipState.duration; clipState.hasSelection = true; setActiveHandle('start'); updatePlayhead(); updateSelectionOverlay(); });
    bind(audioClipExportBtn, 'click', () => { void exportClip(); });
    bind(audioClipSuccessOk, 'click', () => audioClipSuccessOverlay?.classList.remove('visible'));
    bind(audioClipSuccessOpenFolder, 'click', () => { if (clipState.outputPath) void openOutputFolder(clipState.outputPath); });
    bind(byId('audioClipV2Settings'), 'click', openSettings);
    overlay.querySelectorAll('[data-home-link="website"]').forEach(node => bind(node, 'click', () => openExternalUrl('https://toolknit.com')));
    overlay.querySelectorAll('[data-open-support]').forEach(node => bind(node, 'click', openSupport));
    overlay.querySelectorAll('[data-action]').forEach(node => bind(node, 'click', () => handleWindowAction(node.dataset.action)));
    bind(audioClipCanvas, 'pointerdown', event => { if (!clipState.audioBuffer || (event.pointerType === 'mouse' && event.button !== 0)) return; stopPlayback(); clipState.currentTime = clientXToTime(event.clientX); setActiveHandle(null); updatePlayhead(); });
    bind(audioClipHandleStart, 'pointerdown', event => beginHandleDrag(event, 'start'));
    bind(audioClipHandleEnd, 'pointerdown', event => beginHandleDrag(event, 'end'));
    if (!isTauri) {
      bind(overlay, 'dragover', event => { if (clipState.isLoading || clipState.isExporting) return; event.preventDefault(); setDropVisible(true); });
      bind(overlay, 'dragleave', event => { if (event.relatedTarget && overlay.contains(event.relatedTarget)) return; setDropVisible(false); });
      bind(overlay, 'drop', event => { if (clipState.isLoading || clipState.isExporting) return; event.preventDefault(); setDropVisible(false); const file = event.dataTransfer?.files?.[0]; if (file && (file.type.startsWith('audio/') || isAudioClipSupportedName(file.name))) void loadFile(file); });
    }
    if (window?.addEventListener) bind(window, 'resize', () => { scheduleRedraw(); syncWindowFrameAfterLayoutChange(); });
    lifecycle.use(registerLanguageChange(() => refreshIcons()));
  }

  function open() {
    if (disposed || visible()) return;
    overlay.classList.add('visible'); overlay.setAttribute('aria-hidden', 'false');
    viewScope = createLifecycleScope();
    // Canvas pixels do not follow CSS theme or layout changes automatically.
    if (window?.MutationObserver && document.documentElement) {
      const observer = new window.MutationObserver(scheduleRedraw);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      viewScope.use(() => observer.disconnect());
    }
    if (window?.ResizeObserver && audioClipCanvas) {
      const observer = new window.ResizeObserver(scheduleRedraw);
      observer.observe(audioClipCanvas);
      viewScope.use(() => observer.disconnect());
    }
    if (!plasma && audioClipPlasmaBg) plasma = initStandardToolPlasma(audioClipPlasmaBg);
  }

  function close() {
    viewScope?.dispose(); viewScope = null;
    loadRevision += 1; invalidateExport(); dragScope?.dispose(); dragScope = null; document.body?.classList.remove('audio-clip-pointer-dragging');
    stopPlayback(); closeAudioContext(); resetState();
    overlay.classList.remove('visible'); overlay.setAttribute('aria-hidden', 'true'); setDropVisible(false);
    if (plasma) { plasma = disposeStandardToolPlasma(plasma); }
  }

  bindActions();
  void registerNativeDrop();
  return {
    open,
    close,
    dispose() { if (disposed) return; disposed = true; close(); dragScope?.dispose(); lifecycle.dispose(); }
  };
}
