import { createPreviewPlayback } from './preview-playback.js';
import { createPreviewRequest } from './preview-request.js';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { onLangChange } from '../../i18n.js';
import { loadTauriDialog, tauriCorePromise, tauriEventPromise } from '../../platform/tauri-runtime.js';
import { formatFileSize } from '../../shared/file-size.js';
import { frameTimeLabel, normalizeVideoFrameFormat, normalizeVideoFrameTimestamp, validateVideoFrameInput } from '../../video-frame-core.js';
import {
  VIDEO_EXTENSIONS,
  clearQueuedVideoPreview,
  createPreviewQueue,
  localVideoFile,
  registerNativeVideoDrop,
  scheduleVideoPreview,
  setDropVisible
} from './shared.js';

export function createVideoFrameController({
  overlay,
  isTauri = false,
  t = value => value,
  onLangChange: registerLanguageChange = onLangChange,
  notify = () => {},
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = instance => instance?.(),
  getOutputDir = async () => '',
  openOutputFolder = async () => false,
  displayFilesystemPath = value => String(value || ''),
  refreshIcons = () => {},
  openSettings = () => {},
  openSupport = () => {},
  openExternalUrl = () => {},
  handleWindowAction = () => {},
  documentRef = globalThis.document
} = {}) {
  if (!overlay || !documentRef) throw new Error('video-frame:missing-root');
  const byId = id => documentRef.getElementById(id);
  const dropZone = byId('videoFrameDropZone');
  const empty = byId('videoFrameEmpty');
  const editor = byId('videoFrameEditor');
  const previewVideo = byId('videoFramePreviewVideo');
  const previewImage = byId('videoFramePreviewImage');
  const previewToggle = byId('videoFramePreviewToggle');
  const expandToggle = byId('videoFrameExpandToggle');
  const timeline = byId('videoFrameTimeline');
  const timestampInput = byId('videoFrameTimestamp');
  const timeLabel = byId('videoFrameTime');
  const currentTimeLabel = byId('videoFrameCurrentTime');
  const durationLabel = byId('videoFrameDuration');
  const resolutionLabel = byId('videoFrameResolution');
  const frameRateLabel = byId('videoFrameRate');
  const fileSizeLabel = byId('videoFrameFileSize');
  const fileName = byId('videoFrameName');
  const formatOptions = byId('videoFrameFormat');
  const processMask = byId('videoFrameProcessMask');
  const processFill = byId('videoFrameProcessBarFill');
  const processText = byId('videoFrameProcessText');
  const success = byId('videoFrameSuccessOverlay');
  const successMeta = byId('videoFrameSuccessMeta');
  const successFormat = byId('videoFrameSuccessFormat');
  const successTime = byId('videoFrameSuccessTime');
  const successPath = byId('videoFrameSuccessPath');
  const plasmaBackground = byId('videoFramePlasmaBg');
  const lifecycle = createLifecycleScope({ onError: error => console.error('[Video Frame] cleanup:', error) });
  let session = null;
  let plasma = null;
  let nativeDropUnlisten = null;
  let file = null;
  let duration = 0;
  let stepMs = 33;
  let timestampMs = 0;
  let outputFormat = 'png';
  let processing = false;
  let operationId = 0;
  let outputPath = '';
  const previewQueue = createPreviewQueue();
  let disposed = false;

  const current = owner => Boolean(owner && owner === session && !disposed && overlay.classList.contains('visible'));
  const maxMs = () => Math.max(0, Math.round(duration * 1000));

  function setProgress(value, message = t('home.videoFrame.processing'), visible = true) {
    if (processFill) processFill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    if (processText) processText.textContent = message;
    processMask?.classList.toggle('visible', visible);
  }

  const playback = createPreviewPlayback({
    media: previewVideo,
    requestClip: args => createPreviewRequest('render_video_preview_clip', args,
      async () => (await tauriCorePromise).invoke),
    onState: () => updateToggle(),
    onTime: value => updateTimestamp(value, false),
    onError: error => {
      if (!current(session)) return;
      notify(t(error?.message === 'video-preview:decode-failed' ? 'home.videoFrame.decodeFailed' : 'home.videoFrame.previewFailed'));
      updateTimestamp(timestampMs);
    }
  });

  function updateToggle() {
    const { active, loading, playing } = playback.state();
    if (previewToggle) {
      previewToggle.disabled = !file?.path || duration <= 0;
      previewToggle.classList.toggle('is-loading', loading);
      previewToggle.classList.toggle('is-playing', playing);
      previewToggle.setAttribute('aria-pressed', String(active));
      previewToggle.setAttribute('aria-busy', String(loading));
      const key = loading ? 'home.videoFrame.cancelLoading' : active ? 'home.videoFrame.pause' : 'home.videoFrame.play';
      previewToggle.setAttribute('aria-label', t(key));
      previewToggle.setAttribute('title', t(key));
    }
    previewToggle?.querySelector('.video-gif-preview-play-icon')?.toggleAttribute('hidden', active);
    previewToggle?.querySelector('.video-gif-preview-pause-icon')?.toggleAttribute('hidden', !active);
    if (previewImage && !previewVideo.hidden) previewImage.hidden = true;
  }

  function updateTimestamp(value, render = true, immediate = false) {
    timestampMs = Math.max(0, Math.min(maxMs(), Math.round(Number(value) || 0)));
    if (timeline) timeline.value = String(timestampMs);
    if (timestampInput) timestampInput.value = String(timestampMs);
    if (timeLabel) timeLabel.textContent = frameTimeLabel(timestampMs);
    if (currentTimeLabel) currentTimeLabel.textContent = frameTimeLabel(timestampMs);
    if (render && file?.path) {
      const reusable = playback.seek(timestampMs);
      if (reusable) {
        clearQueuedVideoPreview(previewQueue, previewImage);
        if (previewImage) previewImage.hidden = true;
      } else if (previewImage) {
        previewImage.hidden = false;
        scheduleVideoPreview(previewQueue, previewImage, file.path, timestampMs, { immediate, notify });
      }
    }
    return timestampMs;
  }

  function clearPreview() {
    playback.reset();
    clearQueuedVideoPreview(previewQueue, previewImage);
  }

  function setExpanded(expanded) {
    const sidebar = overlay.querySelector('.video-media-v2-sidebar');
    if (expanded && sidebar?.contains(documentRef.activeElement)) expandToggle?.focus();
    overlay.classList.toggle('is-expanded', expanded);
    sidebar?.toggleAttribute('inert', expanded);
    sidebar?.setAttribute('aria-hidden', String(expanded));
    expandToggle?.setAttribute('aria-pressed', String(expanded));
    const label = t(expanded ? 'home.videoFrame.collapse' : 'home.videoFrame.expand');
    expandToggle?.setAttribute('aria-label', label);
    expandToggle?.setAttribute('title', label);
    expandToggle?.querySelector('[data-expand-icon="expand"]')?.toggleAttribute('hidden', expanded);
    expandToggle?.querySelector('[data-expand-icon="collapse"]')?.toggleAttribute('hidden', !expanded);
  }

  async function loadFile(path) {
    if (!isTauri || !path || processing) return;
    const owner = session;
    const request = ++operationId;
    try {
      const { invoke } = await tauriCorePromise;
      const nextFile = localVideoFile(path);
      validateVideoFrameInput(nextFile);
      const probe = await invoke('probe_video', { inputPath: path });
      const nextDuration = Number(probe?.duration);
      if (!Number.isFinite(nextDuration) || nextDuration <= 0) throw new Error('无法读取视频时长。');
      if (!current(owner) || request !== operationId) return;
      file = { ...nextFile, size: Number(probe?.file_size ?? probe?.fileSize) || 0 };
      duration = nextDuration;
      stepMs = Number.isFinite(probe?.frame_rate) && probe.frame_rate > 0 && probe.frame_rate <= 240 ? 1000 / probe.frame_rate : 33;
      clearPreview();
      playback.reset(file.path, maxMs());
      if (fileName) fileName.textContent = file.name;
      timeline && (timeline.max = String(maxMs()));
      durationLabel && (durationLabel.textContent = frameTimeLabel(maxMs()));
      const width = Number(probe?.width) || 0;
      const height = Number(probe?.height) || 0;
      resolutionLabel && (resolutionLabel.textContent = width && height ? `${width} × ${height}` : '--');
      frameRateLabel && (frameRateLabel.textContent = Number(probe?.frame_rate) > 0 ? `${Number(probe.frame_rate).toFixed(2).replace(/\.00$/, '')} FPS` : '--');
      fileSizeLabel && (fileSizeLabel.textContent = file.size > 0 ? formatFileSize(file.size) : '--');
      empty && (empty.hidden = true);
      editor && (editor.hidden = false);
      overlay.classList.add('is-editing');
      updateTimestamp(0, true, true);
    } catch (error) {
      if (current(owner) && request === operationId) notify(error?.message || '无法读取视频文件。');
    }
  }

  async function chooseFile() {
    if (!isTauri || processing) { notify(t('home.videoFrame.desktopOnly')); return; }
    const owner = session;
    try {
      const { open } = await loadTauriDialog();
      const selected = await open({ multiple: false, filters: [{ name: 'Video', extensions: VIDEO_EXTENSIONS }] });
      if (current(owner) && typeof selected === 'string') await loadFile(selected);
    } catch (error) { console.error('[Video Frame] file picker failed:', error); }
  }

  async function playPreview() {
    if (!isTauri || !file?.path) return;
    clearQueuedVideoPreview(previewQueue, previewImage);
    await playback.play(timestampMs);
  }

  function clearFile() {
    operationId += 1;
    file = null;
    duration = 0;
    timestampMs = 0;
    clearPreview();
    timeline && (timeline.max = '0');
    durationLabel && (durationLabel.textContent = frameTimeLabel(0));
    currentTimeLabel && (currentTimeLabel.textContent = frameTimeLabel(0));
    resolutionLabel && (resolutionLabel.textContent = '--');
    frameRateLabel && (frameRateLabel.textContent = '--');
    fileSizeLabel && (fileSizeLabel.textContent = '--');
    overlay.classList.remove('is-editing');
    editor && (editor.hidden = true);
    empty && (empty.hidden = false);
  }

  async function exportFrame() {
    if (!isTauri || !file?.path || processing) return;
    const owner = session;
    const request = ++operationId;
    playback.pause();
    processing = true;
    setProgress(8, t('home.videoFrame.processing'));
    let release = null;
    try {
      const [{ invoke }, { listen }] = await Promise.all([tauriCorePromise, tauriEventPromise]);
      const outputDir = await getOutputDir('Videos');
      if (!current(owner) || request !== operationId) return;
      const rawUnlisten = await listen('video-frame-progress', event => {
        if (!current(owner) || request !== operationId) return;
        const value = Math.max(0, Math.min(1, Number(event?.payload?.progress) || 0));
        setProgress(Math.max(8, value * 100), event?.payload?.phase === 'publish' ? '正在发布图片...' : '正在定位并导出帧...');
      });
      release = session?.use ? session.use(rawUnlisten) : rawUnlisten;
      if (!current(owner) || request !== operationId) { release?.(); return; }
      const result = await invoke('extract_video_frame', { inputPath: file.path, outputDir, timestampMs, format: normalizeVideoFrameFormat(outputFormat) });
      release?.();
      if (!current(owner) || request !== operationId) return;
      outputPath = result?.output_path || result?.outputPath || '';
      successMeta && (successMeta.textContent = file.name);
      successFormat && (successFormat.textContent = String(result?.format || outputFormat).toUpperCase());
      successTime && (successTime.textContent = frameTimeLabel(result?.timestamp_ms ?? timestampMs));
      successPath && (successPath.textContent = displayFilesystemPath(outputPath));
      setProgress(100);
      session?.timeout(() => { if (current(owner) && request === operationId) { processing = false; setProgress(0, undefined, false); success?.classList.add('visible'); } }, 240);
    } catch (error) {
      release?.();
      if (current(owner) && request === operationId) { processing = false; setProgress(0, undefined, false); notify(error?.message || '导出失败。'); }
    }
  }

  function cancel() {
    operationId += 1;
    const wasProcessing = processing;
    processing = false;
    setProgress(0, undefined, false);
    if (isTauri && wasProcessing) void tauriCorePromise.then(({ invoke }) => invoke('cancel_convert', { toolknitTaskTool: 'video-frame' })).catch(() => {});
  }

  function bindActions() {
    const action = (id, handler) => { const node = byId(id); if (node) lifecycle.event(node, 'click', event => { event.stopPropagation(); handler(event); }); };
    action('videoFrameBack', close);
    action('videoFrameV2Settings', openSettings);
    action('videoFrameChange', () => { void chooseFile(); });
    overlay.querySelectorAll('[data-video-pick="frame"]').forEach(node => lifecycle.event(node, 'click', () => { void chooseFile(); }));
    action('videoFramePrev', () => updateTimestamp(timestampMs - stepMs));
    action('videoFrameNext', () => updateTimestamp(timestampMs + stepMs));
    action('videoFrameStart', () => updateTimestamp(0));
    action('videoFrameBackFive', () => updateTimestamp(timestampMs - 5000));
    action('videoFrameForwardFive', () => updateTimestamp(timestampMs + 5000));
    action('videoFrameEnd', () => updateTimestamp(maxMs()));
    action('videoFrameExport', () => { void exportFrame(); });
    action('videoFrameCancelBtn', cancel);
    action('videoFrameSuccessOk', () => success?.classList.remove('visible'));
    action('videoFrameOpenFolder', () => { if (outputPath) void openOutputFolder(outputPath); success?.classList.remove('visible'); });
    action('videoFramePreviewToggle', () => { if (playback.state().active) playback.pause(); else void playPreview(); });
    action('videoFrameExpandToggle', () => setExpanded(!overlay.classList.contains('is-expanded')));
    overlay.querySelectorAll('[data-home-link="website"]').forEach(node => lifecycle.event(node, 'click', () => openExternalUrl('https://toolknit.com')));
    overlay.querySelectorAll('[data-open-support]').forEach(node => lifecycle.event(node, 'click', openSupport));
    overlay.querySelectorAll('[data-action]').forEach(node => lifecycle.event(node, 'click', () => handleWindowAction(node.dataset.action)));
    lifecycle.event(timeline, 'input', () => updateTimestamp(timeline.value));
    lifecycle.event(timestampInput, 'change', () => { try { updateTimestamp(normalizeVideoFrameTimestamp(timestampInput.value, duration), true, true); } catch { updateTimestamp(timestampMs, false); } });
    lifecycle.event(formatOptions, 'click', event => {
      const button = event.target?.closest?.('[data-format]');
      if (!button) return;
      outputFormat = normalizeVideoFrameFormat(button.dataset.format);
      formatOptions.querySelectorAll('[data-format]').forEach(item => item.classList.toggle('active', item === button));
    });
    lifecycle.event(documentRef, 'keydown', event => {
      if (!overlay.classList.contains('visible') || success?.classList.contains('visible')) return;
      if (event.key === 'Escape' && overlay.classList.contains('is-expanded')) {
        event.preventDefault();
        setExpanded(false);
        return;
      }
      const target = event.target;
      if (target && (target.matches?.('input, textarea, select, button, [contenteditable="true"]') || target.isContentEditable)) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        const delta = event.shiftKey ? Math.max(1000, Math.round(stepMs * 10)) : stepMs;
        event.preventDefault();
        updateTimestamp(timestampMs + direction * delta);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        updateTimestamp(event.key === 'Home' ? 0 : maxMs());
      } else if (event.key === ' ') {
        event.preventDefault();
        previewToggle?.click();
      }
    });
    lifecycle.use(registerLanguageChange(() => {
      const expanded = overlay.classList.contains('is-expanded');
      expandToggle?.setAttribute('aria-label', t(expanded ? 'home.videoFrame.collapse' : 'home.videoFrame.expand'));
      expandToggle?.setAttribute('title', t(expanded ? 'home.videoFrame.collapse' : 'home.videoFrame.expand'));
      updateToggle();
      refreshIcons();
    }));
  }

  function open() {
    if (disposed) return;
    if (session && overlay.classList.contains('visible')) return;
    session?.dispose();
    session = createLifecycleScope();
    overlay.removeAttribute('inert');
    overlay.classList.add('visible');
    setExpanded(false);
    updateToggle();
    overlay.setAttribute('aria-hidden', 'false');
    if (!plasma && plasmaBackground) plasma = initStandardToolPlasma(plasmaBackground);
  }

  function close() {
    operationId += 1;
    cancel();
    session?.dispose();
    session = null;
    clearFile();
    setExpanded(false);
    success?.classList.remove('visible');
    if (overlay.contains(documentRef.activeElement)) documentRef.activeElement?.blur();
    overlay.setAttribute('inert', '');
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    setDropVisible(overlay, dropZone, false);
    plasma = disposeStandardToolPlasma(plasma);
  }

  bindActions();
  void registerNativeVideoDrop({
    isTauri,
    overlay,
    scope: lifecycle,
    isActive: () => overlay.classList.contains('visible'),
    isBusy: () => processing,
    onVisibility: visible => setDropVisible(overlay, dropZone, visible),
    onDrop: path => { void loadFile(path); },
    onUnsupported: () => notify('请拖入支持的视频文件。')
  }).then(unlisten => { if (!disposed) nativeDropUnlisten = unlisten; else unlisten?.(); }).catch(error => console.warn('[Video Frame] native drop unavailable:', error));

  return {
    open,
    close,
    dispose() {
      if (disposed) return;
      disposed = true;
      close();
      playback.dispose();
      nativeDropUnlisten?.();
      nativeDropUnlisten = null;
      lifecycle.dispose();
    }
  };
}
