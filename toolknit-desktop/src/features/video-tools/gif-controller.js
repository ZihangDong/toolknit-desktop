import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { onLangChange } from '../../i18n.js';
import { loadTauriDialog, tauriCorePromise, tauriEventPromise } from '../../platform/tauri-runtime.js';
import { formatFileSize } from '../../shared/file-size.js';
import { createDefaultVideoGifSelection, normalizeVideoGifRequest, validateVideoGifInput } from '../../video-gif-core.js';
import {
  VIDEO_EXTENSIONS,
  clearQueuedVideoPreview,
  createPreviewQueue,
  fileNameFromPath,
  localVideoFile,
  registerNativeVideoDrop,
  scheduleVideoPreview,
  setDropVisible
} from './shared.js';

const qualityLabels = Object.freeze({ high: '清晰', balanced: '均衡', small: '小体积', tiny: '极小' });
const estimateFactors = Object.freeze({ high: 0.21, balanced: 0.14, small: 0.095, tiny: 0.068 });

function timeLabel(milliseconds) {
  const value = Math.max(0, Math.round(Number(milliseconds) || 0));
  return `${String(Math.floor(value / 60_000)).padStart(2, '0')}:${String(Math.floor((value % 60_000) / 1000)).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`;
}

export function createVideoGifController({
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
  if (!overlay || !documentRef) throw new Error('video-gif:missing-root');
  const byId = id => documentRef.getElementById(id);
  const dropZone = byId('videoGifDropZone');
  const empty = byId('videoGifEmpty');
  const editor = byId('videoGifEditor');
  const previewImage = byId('videoGifPreviewImage');
  const rangePreview = byId('videoGifRangePreview');
  const previewToggle = byId('videoGifPreviewToggle');
  const expandToggle = byId('videoGifExpandToggle');
  const timelineWrap = byId('videoGifTimelineWrap');
  const timeline = byId('videoGifTimeline');
  const previewTime = byId('videoGifPreviewTime');
  const fileName = byId('videoGifName');
  const startButton = byId('videoGifSelectStart');
  const endButton = byId('videoGifSelectEnd');
  const startLabel = byId('videoGifStartLabel');
  const endLabel = byId('videoGifEndLabel');
  const durationLabel = byId('videoGifDurationLabel');
  const adjustHint = byId('videoGifAdjustHint');
  const frameRateOptions = byId('videoGifFrameRate');
  const resolutionOptions = byId('videoGifResolution');
  const qualityOptions = byId('videoGifQuality');
  const estimate = byId('videoGifEstimate');
  const processMask = byId('videoGifProcessMask');
  const processFill = byId('videoGifProcessBarFill');
  const processText = byId('videoGifProcessText');
  const success = byId('videoGifSuccessOverlay');
  const successMeta = byId('videoGifSuccessMeta');
  const successDuration = byId('videoGifSuccessDuration');
  const successSpec = byId('videoGifSuccessSpec');
  const successSize = byId('videoGifSuccessSize');
  const successPath = byId('videoGifSuccessPath');
  const plasmaBackground = byId('videoGifPlasmaBg');
  const lifecycle = createLifecycleScope({ onError: error => console.error('[Video GIF] cleanup:', error) });
  let session = null;
  let plasma = null;
  let nativeDropUnlisten = null;
  let file = null;
  let duration = 0;
  let stepMs = 33;
  let startMs = 0;
  let endMs = 30_000;
  let activePoint = 'start';
  let frameRate = 12;
  let width = 640;
  let quality = 'balanced';
  let sourceWidth = 0;
  let sourceHeight = 0;
  let sourceSize = 0;
  let cursorMs = 0;
  let processing = false;
  let operationId = 0;
  let previewToken = 0;
  let previewLoading = false;
  let previewRange = null;
  let outputPath = '';
  let disposed = false;
  const previewQueue = createPreviewQueue();

  const current = owner => Boolean(owner && owner === session && !disposed && overlay.classList.contains('visible'));
  const maxMs = () => Math.max(0, Math.round(duration * 1000));
  const selectionPlayable = () => Boolean(file?.path && endMs > startMs);
  const selectionKey = () => selectionPlayable() ? `${file.path}\u0000${startMs}\u0000${endMs}` : null;

  function setProgress(value, message = '正在生成 GIF...', visible = true) {
    if (processFill) processFill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    if (processText) processText.textContent = message;
    processMask?.classList.toggle('visible', visible);
  }

  function updateEstimate() {
    if (!estimate) return;
    if (!selectionPlayable()) { estimate.textContent = '预计体积：选择视频后自动估算'; return; }
    const durationSeconds = Math.max(0.001, (endMs - startMs) / 1000);
    const frames = Math.max(1, Math.round(durationSeconds * frameRate));
    const inputWidth = sourceWidth || width;
    const inputHeight = sourceHeight || Math.round(inputWidth * 9 / 16);
    const outputWidth = Math.max(160, Math.min(width, inputWidth));
    const outputHeight = Math.max(2, Math.round(outputWidth * inputHeight / Math.max(1, inputWidth) / 2) * 2);
    const raw = frames * outputWidth * outputHeight * (estimateFactors[quality] || estimateFactors.balanced);
    const sourceBound = sourceSize > 0 ? sourceSize * (durationSeconds / Math.max(durationSeconds, duration || durationSeconds)) * 2.2 : 0;
    const center = Math.max(raw, sourceBound);
    estimate.textContent = `预计体积：${formatFileSize(Math.max(1, Math.round(center * 0.72)))} - ${formatFileSize(Math.max(1, Math.round(center * 1.38)))} · ${frames} 帧 · ${outputWidth}×${outputHeight} · ${qualityLabels[quality]}`;
  }

  function updateToggle() {
    const playing = Boolean(rangePreview && !rangePreview.paused && !rangePreview.ended);
    const enabled = selectionPlayable() && !previewLoading;
    if (previewToggle) {
      previewToggle.disabled = !enabled;
      previewToggle.classList.toggle('is-loading', previewLoading);
      previewToggle.classList.toggle('is-playing', playing);
      previewToggle.setAttribute('aria-pressed', String(playing));
    }
    previewToggle?.querySelector('.video-gif-preview-play-icon')?.toggleAttribute('hidden', playing);
    previewToggle?.querySelector('.video-gif-preview-pause-icon')?.toggleAttribute('hidden', !playing);
  }

  function updateTimeline() {
    const total = Math.max(1, maxMs());
    timelineWrap?.style.setProperty('--gif-start', `${Math.max(0, Math.min(100, startMs / total * 100)).toFixed(3)}%`);
    timelineWrap?.style.setProperty('--gif-end', `${Math.max(0, Math.min(100, endMs / total * 100)).toFixed(3)}%`);
  }

  function updateSelection() {
    startLabel && (startLabel.textContent = timeLabel(startMs));
    endLabel && (endLabel.textContent = timeLabel(endMs));
    durationLabel && (durationLabel.textContent = `${((endMs - startMs) / 1000).toFixed(3)} 秒 / 最多 30 秒`);
    startButton?.classList.toggle('active', activePoint === 'start');
    endButton?.classList.toggle('active', activePoint === 'end');
    adjustHint && (adjustHint.textContent = activePoint === 'start' ? '正在调整起始帧' : '正在调整结束帧');
    updateTimeline();
    updateEstimate();
    updateToggle();
  }

  function seek(value, immediate = false) {
    cursorMs = Math.max(0, Math.min(maxMs(), Math.round(Number(value) || 0)));
    if (timeline) timeline.value = String(cursorMs);
    if (previewTime) previewTime.textContent = timeLabel(cursorMs);
    updateTimeline();
    if (file?.path) scheduleVideoPreview(previewQueue, previewImage, file.path, cursorMs, { immediate, notify });
  }

  function resetPlayback() {
    previewToken += 1;
    previewLoading = false;
    previewRange = null;
    if (rangePreview) {
      rangePreview.pause();
      rangePreview.removeAttribute('src');
      rangePreview.load();
      rangePreview.hidden = true;
    }
    if (previewImage) previewImage.hidden = false;
    updateToggle();
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

  async function playSelection() {
    if (!isTauri || !selectionPlayable() || !rangePreview) return;
    const key = selectionKey();
    if (previewRange === key && rangePreview.getAttribute('src')) {
      try { await rangePreview.play(); } catch (error) { notify(error?.message || '无法播放所选片段。'); }
      updateToggle();
      return;
    }
    const token = ++previewToken;
    previewLoading = true;
    updateToggle();
    try {
      const { invoke } = await tauriCorePromise;
      const result = await invoke('render_video_preview_clip', { inputPath: file.path, startMs, endMs });
      const source = result?.media_data_url || result?.mediaDataUrl;
      if (!source || token !== previewToken || key !== selectionKey()) return;
      rangePreview.src = source;
      rangePreview.hidden = false;
      if (previewImage) previewImage.hidden = true;
      rangePreview.load();
      previewRange = key;
      rangePreview.currentTime = 0;
      cursorMs = startMs;
      if (timeline) timeline.value = String(cursorMs);
      if (previewTime) previewTime.textContent = timeLabel(cursorMs);
      updateTimeline();
      await rangePreview.play();
    } catch (error) {
      if (token === previewToken) { resetPlayback(); notify(error?.message || '无法播放所选片段。'); }
    } finally {
      if (token === previewToken) { previewLoading = false; updateToggle(); }
    }
  }

  async function loadFile(path) {
    if (!isTauri || !path || processing) return;
    const owner = session;
    const request = ++operationId;
    try {
      const nextFile = localVideoFile(path);
      validateVideoGifInput(nextFile);
      const { invoke } = await tauriCorePromise;
      const probe = await invoke('probe_video', { inputPath: path });
      const nextDuration = Number(probe?.duration);
      if (!Number.isFinite(nextDuration) || nextDuration <= 0) throw new Error('无法读取视频时长。');
      if (!current(owner) || request !== operationId) return;
      file = nextFile;
      duration = nextDuration;
      sourceWidth = Number(probe?.width) || 0;
      sourceHeight = Number(probe?.height) || 0;
      sourceSize = Number(probe?.file_size ?? probe?.fileSize) || 0;
      stepMs = Number.isFinite(probe?.frame_rate) && probe.frame_rate > 0 && probe.frame_rate <= 240
        ? 1000 / probe.frame_rate
        : 33;
      const selection = createDefaultVideoGifSelection(duration);
      startMs = selection.start_ms;
      endMs = selection.end_ms;
      if (endMs <= startMs) throw new Error('视频时长不足以生成 GIF。');
      resetPlayback();
      clearQueuedVideoPreview(previewQueue, previewImage);
      fileName && (fileName.textContent = file.name);
      timeline && (timeline.max = String(maxMs()));
      empty && (empty.hidden = true);
      editor && (editor.hidden = false);
      overlay.classList.add('is-editing');
      setExpanded(true);
      activePoint = 'start';
      seek(0, true);
      updateSelection();
    } catch (error) {
      if (current(owner) && request === operationId) notify(error?.message || '无法读取视频文件。');
    }
  }

  async function chooseFile() {
    if (!isTauri || processing) { notify('视频 GIF 导出仅可在桌面端使用。'); return; }
    try {
      const { open } = await loadTauriDialog();
      const selected = await open({ multiple: false, filters: [{ name: 'Video', extensions: VIDEO_EXTENSIONS }] });
      if (typeof selected === 'string') await loadFile(selected);
    } catch (error) { console.error('[Video GIF] file picker failed:', error); }
  }

  function setPoint(point, value) {
    resetPlayback();
    const max = maxMs();
    let next = Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
    if (point === 'start') {
      next = Math.max(0, Math.min(endMs - 1, Math.max(endMs - 30_000, next)));
      startMs = next;
    } else {
      next = Math.min(max, Math.max(startMs + 1, Math.min(startMs + 30_000, next)));
      endMs = next;
    }
    updateSelection();
    seek(next, true);
  }

  async function exportGif() {
    if (!isTauri || !selectionPlayable() || processing) return;
    let settings;
    try { settings = normalizeVideoGifRequest({ start_ms: startMs, end_ms: endMs, frame_rate: frameRate, width, quality }, duration); }
    catch (error) { notify(error?.message || 'GIF 选区无效。'); return; }
    const owner = session;
    const request = ++operationId;
    processing = true;
    setProgress(8);
    let release = null;
    try {
      const [{ invoke }, { listen }] = await Promise.all([tauriCorePromise, tauriEventPromise]);
      const rawUnlisten = await listen('video-gif-progress', event => {
        if (!current(owner) || request !== operationId) return;
        const progress = Math.max(0, Math.min(1, Number(event?.payload?.progress) || 0));
        setProgress(Math.max(8, progress * 100), event?.payload?.phase === 'publish' ? '正在发布 GIF...' : '正在生成调色板与 GIF...');
      });
      release = session?.use ? session.use(rawUnlisten) : rawUnlisten;
      const result = await invoke('extract_video_gif', { inputPath: file.path, outputDir: await getOutputDir('Videos'), startMs: settings.start_ms, endMs: settings.end_ms, frameRate: settings.frame_rate, width: settings.width, quality: settings.quality });
      release?.();
      if (!current(owner) || request !== operationId) return;
      outputPath = result?.output_path || result?.outputPath || '';
      successMeta && (successMeta.textContent = file.name);
      successDuration && (successDuration.textContent = `${(settings.duration_ms / 1000).toFixed(3)} 秒`);
      successSpec && (successSpec.textContent = `${settings.width}px / ${settings.frame_rate} FPS / ${qualityLabels[settings.quality]}`);
      successSize && (successSize.textContent = formatFileSize(Number(result?.output_size ?? result?.outputSize ?? 0)));
      successPath && (successPath.textContent = displayFilesystemPath(outputPath));
      setProgress(100);
      session?.timeout(() => { if (current(owner) && request === operationId) { processing = false; setProgress(0, undefined, false); success?.classList.add('visible'); } }, 240);
    } catch (error) {
      release?.();
      if (current(owner) && request === operationId) { processing = false; setProgress(0, undefined, false); notify(error?.message || 'GIF 导出失败。'); }
    }
  }

  function cancel() {
    operationId += 1;
    processing = false;
    setProgress(0, undefined, false);
    if (isTauri) void tauriCorePromise.then(({ invoke }) => invoke('cancel_convert', { toolknitTaskTool: 'video-gif' })).catch(() => {});
  }

  function bindActions() {
    const action = (id, handler) => { const node = byId(id); if (node) lifecycle.event(node, 'click', event => { event.stopPropagation(); handler(event); }); };
    action('videoGifBack', close);
    action('videoGifV2Settings', openSettings);
    action('videoGifChange', () => { void chooseFile(); });
    overlay.querySelectorAll('[data-video-pick="gif"]').forEach(node => lifecycle.event(node, 'click', () => { void chooseFile(); }));
    action('videoGifPrev', () => setPoint(activePoint, (activePoint === 'start' ? startMs : endMs) - stepMs));
    action('videoGifNext', () => setPoint(activePoint, (activePoint === 'start' ? startMs : endMs) + stepMs));
    action('videoGifExport', () => { void exportGif(); });
    action('videoGifCancelBtn', cancel);
    action('videoGifSuccessOk', () => success?.classList.remove('visible'));
    action('videoGifOpenFolder', () => { if (outputPath) void openOutputFolder(outputPath); success?.classList.remove('visible'); });
    action('videoGifPreviewToggle', () => { if (rangePreview && !rangePreview.paused && !rangePreview.ended) rangePreview.pause(); else void playSelection(); });
    action('videoGifExpandToggle', () => setExpanded(!overlay.classList.contains('is-expanded')));
    overlay.querySelectorAll('[data-home-link="website"]').forEach(node => lifecycle.event(node, 'click', () => openExternalUrl('https://toolknit.com')));
    overlay.querySelectorAll('[data-open-support]').forEach(node => lifecycle.event(node, 'click', openSupport));
    overlay.querySelectorAll('[data-action]').forEach(node => lifecycle.event(node, 'click', () => handleWindowAction(node.dataset.action)));
    lifecycle.event(timeline, 'input', () => setPoint(activePoint, timeline.value));
    lifecycle.event(startButton, 'click', () => { resetPlayback(); activePoint = 'start'; updateSelection(); seek(startMs, true); });
    lifecycle.event(endButton, 'click', () => { resetPlayback(); activePoint = 'end'; updateSelection(); seek(endMs, true); });
    lifecycle.event(frameRateOptions, 'click', event => { const button = event.target?.closest?.('[data-fps]'); if (!button) return; frameRate = Number(button.dataset.fps); frameRateOptions.querySelectorAll('[data-fps]').forEach(item => item.classList.toggle('active', item === button)); updateEstimate(); });
    lifecycle.event(resolutionOptions, 'click', event => { const button = event.target?.closest?.('[data-width]'); if (!button) return; width = Number(button.dataset.width); resolutionOptions.querySelectorAll('[data-width]').forEach(item => item.classList.toggle('active', item === button)); updateEstimate(); });
    lifecycle.event(qualityOptions, 'click', event => { const button = event.target?.closest?.('[data-quality]'); if (!button) return; quality = String(button.dataset.quality || 'balanced'); qualityOptions.querySelectorAll('[data-quality]').forEach(item => item.classList.toggle('active', item === button)); updateEstimate(); });
    lifecycle.event(rangePreview, 'play', updateToggle);
    lifecycle.event(rangePreview, 'pause', updateToggle);
    lifecycle.event(rangePreview, 'timeupdate', () => { if (previewRange !== selectionKey()) return; cursorMs = Math.min(endMs, startMs + Math.round(rangePreview.currentTime * 1000)); if (timeline) timeline.value = String(cursorMs); if (previewTime) previewTime.textContent = timeLabel(cursorMs); updateTimeline(); });
    lifecycle.event(rangePreview, 'ended', () => { if (previewRange === selectionKey()) { rangePreview.currentTime = 0; void rangePreview.play(); } });
    lifecycle.event(documentRef, 'keydown', event => {
      if (!overlay.classList.contains('visible') || success?.classList.contains('visible')) return;
      if (event.key === 'Escape' && overlay.classList.contains('is-expanded')) {
        event.preventDefault();
        setExpanded(false);
      }
    });
    lifecycle.use(registerLanguageChange(() => {
      const expanded = overlay.classList.contains('is-expanded');
      expandToggle?.setAttribute('aria-label', t(expanded ? 'home.videoFrame.collapse' : 'home.videoFrame.expand'));
      expandToggle?.setAttribute('title', t(expanded ? 'home.videoFrame.collapse' : 'home.videoFrame.expand'));
      refreshIcons();
    }));
  }

  function open() {
    if (disposed) return;
    session?.dispose();
    session = createLifecycleScope();
    overlay.classList.add('visible');
    setExpanded(false);
    overlay.setAttribute('aria-hidden', 'false');
    if (!plasma && plasmaBackground) plasma = initStandardToolPlasma(plasmaBackground);
  }

  function close() {
    operationId += 1;
    cancel();
    session?.dispose();
    session = null;
    resetPlayback();
    clearQueuedVideoPreview(previewQueue, previewImage);
    file = null;
    duration = 0;
    stepMs = 33;
    setExpanded(false);
    overlay.classList.remove('visible', 'is-editing');
    overlay.setAttribute('aria-hidden', 'true');
    editor && (editor.hidden = true);
    empty && (empty.hidden = false);
    success?.classList.remove('visible');
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
  }).then(unlisten => { if (!disposed) nativeDropUnlisten = unlisten; else unlisten?.(); }).catch(error => console.warn('[Video GIF] native drop unavailable:', error));

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
    }
  };
}
