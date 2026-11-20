import { createLifecycleScope } from './tool-lifecycle.js';
import { CUSTOM_BACKGROUND_STORAGE_KEY, DEFAULT_DARK_BACKGROUND_SRC, initializeDefaultBackground } from './custom-background-default.js';

const DEFAULT_BROWSER_MAX_BYTES = 8 * 1024 * 1024;
const IMPORT_LABELS = Object.freeze({
  validating: 'settings.backgroundImportPreparing',
  prepare: 'settings.backgroundImportPreparing',
  preparing: 'settings.backgroundImportPreparing',
  copying: 'settings.backgroundImportCopying',
  probing: 'settings.backgroundImportAnalyzing',
  analyzing: 'settings.backgroundImportAnalyzing',
  converting: 'settings.backgroundImportTranscoding',
  transcoding: 'settings.backgroundImportTranscoding',
  verify: 'settings.backgroundImportFinalizing',
  finalizing: 'settings.backgroundImportFinalizing',
  complete: 'settings.backgroundImportComplete',
  error: 'settings.backgroundImportFailed',
  failed: 'settings.backgroundImportFailed'
});

function mediaType(value) {
  return String(value || '').toLowerCase() === 'video' ? 'video' : 'image';
}

function mediaName(path = '') {
  return String(path || '').split(/[\\/]/).pop() || '';
}

function isVideoElement(node, windowRef) {
  const Video = windowRef?.HTMLVideoElement || globalThis.HTMLVideoElement;
  return typeof Video !== 'undefined' && node instanceof Video;
}

/** Owns custom background settings, import progress and preview resources. */
export function createCustomBackgroundSettingsRuntime({
  root = globalThis.document,
  windowRef = globalThis.window,
  isTauri = false,
  tauriCorePromise,
  tauriEventPromise,
  settingsOverlay,
  allowCustomBackground = () => true,
  onThemeChange = () => () => {},
  storageKey = CUSTOM_BACKGROUND_STORAGE_KEY,
  changeEvent = 'toolknit-custom-background-change',
  maxBrowserBytes = DEFAULT_BROWSER_MAX_BYTES,
  translate = key => key,
  showToast = () => {},
  onLanguageChange = () => () => {}
} = {}) {
  if (storageKey === CUSTOM_BACKGROUND_STORAGE_KEY) initializeDefaultBackground(windowRef);
  const preview = root?.getElementById?.('settingsBackgroundPreview');
  const backgroundCard = preview?.closest?.('.settings-v2-background-card');
  const backgroundControls = backgroundCard?.querySelector?.('[data-background-controls]');
  const summary = root?.getElementById?.('settingsBackgroundSummary');
  const chooseImage = root?.getElementById?.('chooseBackgroundImage');
  const chooseVideo = root?.getElementById?.('chooseBackgroundVideo');
  const clearButton = root?.getElementById?.('clearCustomBackground');
  const imageInput = root?.getElementById?.('customBackgroundImageInput');
  const videoInput = root?.getElementById?.('customBackgroundVideoInput');
  const importStatus = root?.getElementById?.('settingsBackgroundImportStatus');
  const importTrack = root?.getElementById?.('settingsBackgroundImportTrack');
  const importLabelElement = root?.getElementById?.('settingsBackgroundImportLabel');
  const scope = createLifecycleScope({ onError: error => console.error('[custom-background-settings] dispose failed:', error) });
  let renderToken = 0;
  let previewMedia = null;
  let previewMediaErrorRelease = null;
  let importBusy = false;
  let policyRevision = 0;

  function readMetadata() {
    try {
      const raw = windowRef?.localStorage?.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !['image', 'video'].includes(String(parsed.type || parsed.media_type))) return null;
      return { ...parsed, type: mediaType(parsed.type || parsed.media_type) };
    } catch {
      return null;
    }
  }

  function saveMetadata(metadata) {
    try {
      if (!metadata) windowRef?.localStorage?.removeItem(storageKey);
      else windowRef?.localStorage?.setItem(storageKey, JSON.stringify(metadata));
    } catch (error) {
      console.warn('Unable to persist custom background metadata:', error);
    }
  }

  function importLabel(phase = 'preparing') {
    return translate(IMPORT_LABELS[String(phase || '').toLowerCase()] || IMPORT_LABELS.preparing);
  }

  function hasMetadata() {
    return Boolean(readMetadata());
  }

  function syncControls() {
    const blocked = !allowCustomBackground();
    const disabled = importBusy || blocked;
    if (blocked && backgroundControls?.contains(root?.activeElement)) {
      root.activeElement?.blur?.();
      if (settingsOverlay?.classList.contains('visible')) root.getElementById('themeWallpaperToggle')?.focus?.();
    }
    backgroundCard?.classList.toggle('is-wallpaper-disabled', blocked);
    backgroundControls?.setAttribute('aria-disabled', String(blocked));
    if (backgroundControls) backgroundControls.inert = blocked;
    if (chooseImage) chooseImage.disabled = disabled;
    if (chooseVideo) chooseVideo.disabled = disabled;
    if (clearButton) clearButton.disabled = disabled || !hasMetadata();
    if (imageInput) imageInput.disabled = disabled;
    if (videoInput) videoInput.disabled = disabled;
  }

  function setImportState(active, { percent = 0, phase = 'preparing' } = {}) {
    importBusy = Boolean(active);
    const rawPercent = Number(percent) || 0;
    const normalized = Math.max(0, Math.min(100, rawPercent <= 1 ? rawPercent * 100 : rawPercent));
    if (importStatus) importStatus.hidden = !importBusy;
    if (importLabelElement && importBusy) importLabelElement.textContent = importLabel(phase);
    if (importTrack) {
      importTrack.value = normalized;
      importTrack.setAttribute('aria-valuenow', String(Math.round(normalized)));
    }
    syncControls();
  }

  function dispatchChange(metadata, src = '') {
    windowRef?.dispatchEvent?.(new CustomEvent(changeEvent, {
      detail: metadata ? { ...metadata, src } : null
    }));
  }

  function resetPreview() {
    renderToken += 1;
    previewMediaErrorRelease?.();
    previewMediaErrorRelease = null;
    if (!preview) return;
    preview.querySelectorAll('img, video').forEach(media => {
      try { media.pause?.(); } catch {}
      media.removeAttribute('src');
      media.load?.();
      media.remove();
    });
    previewMedia = null;
    preview.classList.remove('has-media');
    const copy = preview.querySelector('.settings-v2-background-preview-copy');
    if (copy) copy.hidden = false;
    syncControls();
  }

  function syncPreviewPlayback() {
    const media = previewMedia;
    if (!isVideoElement(media, windowRef)) return;
    const shouldPlay = Boolean(allowCustomBackground() && !scope.disposed && settingsOverlay?.classList.contains('visible') && !windowRef?.document?.hidden);
    if (shouldPlay) media.play().catch(() => {});
    else media.pause();
  }

  function setSummary(metadata = null) {
    if (!summary) return;
    if (!metadata) {
      summary.textContent = translate('settings.customBackgroundEmptyHint');
      return;
    }
    const kind = metadata.type === 'video'
      ? translate('settings.chooseBackgroundVideo')
      : translate('settings.chooseBackgroundImage');
    const name = metadata.src === DEFAULT_DARK_BACKGROUND_SRC
      ? translate('settings.defaultDarkBackground')
      : metadata.name || mediaName(metadata.path) || translate('settings.customBackground');
    summary.textContent = `${kind} · ${name}`;
  }

  async function render(metadata) {
    if (scope.disposed) return;
    resetPreview();
    const token = renderToken;
    if (!allowCustomBackground()) { setSummary(metadata); return; }
    if (!metadata) {
      setSummary(null);
      dispatchChange(null);
      return;
    }
    let src = metadata.src || '';
    try {
      if (!src && isTauri && metadata.path) {
        const { invoke } = await tauriCorePromise;
        src = await invoke('get_custom_background_media_url', { path: metadata.path });
      }
      if (!src) throw new Error('Background source is unavailable');
      if (scope.disposed || token !== renderToken || !allowCustomBackground() || !preview) return;
      const type = mediaType(metadata.type || metadata.media_type);
      const media = root.createElement(type === 'video' ? 'video' : 'img');
      media.src = src;
      media.alt = '';
      media.setAttribute('aria-hidden', 'true');
      if (type === 'video') {
        media.muted = true;
        media.loop = true;
        media.autoplay = false;
        media.playsInline = true;
        media.preload = 'metadata';
      }
      previewMediaErrorRelease = scope.event(media, 'error', () => showToast(translate('settings.customBackgroundImportFailed')), { once: true });
      preview.appendChild(media);
      previewMedia = type === 'video' ? media : null;
      syncPreviewPlayback();
      preview.classList.add('has-media');
      const copy = preview.querySelector('.settings-v2-background-preview-copy');
      if (copy) copy.hidden = true;
      setSummary(metadata);
      syncControls();
      dispatchChange(metadata, src);
    } catch (error) {
      if (token !== renderToken) return;
      console.error('Failed to render custom background:', error);
      setSummary(null);
      syncControls();
      showToast(translate('settings.customBackgroundImportFailed'));
      dispatchChange(null);
    }
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const Reader = windowRef?.FileReader || globalThis.FileReader;
      if (!Reader) return reject(new Error('FileReader is unavailable'));
      const reader = new Reader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Unable to read background file'));
      reader.readAsDataURL(file);
    });
  }

  async function importBrowser(file, type) {
    if (scope.disposed || !allowCustomBackground() || !file || importBusy) return;
    const mime = String(file.type || '').toLowerCase();
    const extension = String(file.name || '').toLowerCase().split('.').pop();
    const allowed = type === 'video'
      ? ['mp4', 'webm', 'ogv', 'ogg', 'mov']
      : ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp'];
    const validType = type === 'video' ? mime.startsWith('video/') : mime.startsWith('image/');
    if (!validType && !allowed.includes(extension)) {
      showToast(translate('settings.customBackgroundImportFailed'));
      return;
    }
    if (file.size > maxBrowserBytes) {
      showToast(translate('settings.customBackgroundTooLarge'));
      return;
    }
    setImportState(true, { percent: 12, phase: 'preparing' });
    try {
      setImportState(true, { percent: 48, phase: 'copying' });
      const src = await fileToDataUrl(file);
      if (scope.disposed) return;
      const metadata = { type, media_type: type, name: file.name, mime: file.type, size: file.size, src };
      saveMetadata(metadata);
      setImportState(true, { percent: 88, phase: 'finalizing' });
      await render(metadata);
      setImportState(true, { percent: 100, phase: 'complete' });
    } catch (error) {
      console.error('Failed to import browser background:', error);
      setImportState(true, { percent: 0, phase: 'failed' });
      showToast(translate('settings.customBackgroundImportFailed'));
    } finally {
      scope.timeout(() => setImportState(false), 220);
    }
  }

  async function chooseDesktop(type) {
    if (scope.disposed || !allowCustomBackground() || importBusy) return;
    const revision = policyRevision;
    let unlistenProgress = null;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      if (scope.disposed || revision !== policyRevision || !allowCustomBackground()) return;
      const extensions = type === 'video'
        ? ['mp4', 'webm', 'ogv', 'ogg', 'mov']
        : ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
      const selected = await open({
        multiple: false,
        directory: false,
        title: type === 'video' ? translate('settings.chooseBackgroundVideo') : translate('settings.chooseBackgroundImage'),
        filters: [{ name: type === 'video' ? 'Video' : 'Image', extensions }]
      });
      if (scope.disposed || revision !== policyRevision || !allowCustomBackground() || !selected || Array.isArray(selected)) return;
      const jobId = `background-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const [{ invoke }, { listen }] = await Promise.all([tauriCorePromise, tauriEventPromise]);
      if (scope.disposed || revision !== policyRevision || !allowCustomBackground()) return;
      setImportState(true, { percent: type === 'video' ? 6 : 10, phase: type === 'video' ? 'analyzing' : 'copying' });
      unlistenProgress = await listen('custom-background-import-progress', event => {
        const progress = event?.payload || {};
        const progressJobId = progress.jobId || progress.job_id;
        if (progressJobId && progressJobId !== jobId) return;
        setImportState(true, { percent: progress.percent, phase: progress.phase || 'preparing' });
      });
      if (scope.disposed || revision !== policyRevision || !allowCustomBackground()) return;
      const asset = await invoke('import_custom_background', { sourcePath: selected, jobId });
      if (scope.disposed) return;
      const metadata = {
        type: mediaType(asset?.media_type || type),
        media_type: asset?.media_type || type,
        path: asset?.path || selected,
        name: mediaName(selected)
      };
      saveMetadata(metadata);
      await render(metadata);
      setImportState(true, { percent: 100, phase: 'complete' });
    } catch (error) {
      console.error('Failed to import desktop background:', error);
      setImportState(true, { percent: 0, phase: 'failed' });
      showToast(String(error?.message || error) || translate('settings.customBackgroundImportFailed'));
    } finally {
      try { unlistenProgress?.(); } catch {}
      if (importBusy) scope.timeout(() => setImportState(false), 340);
    }
  }

  async function clear() {
    if (scope.disposed || !allowCustomBackground() || importBusy) return;
    try {
      if (isTauri) {
        const { invoke } = await tauriCorePromise;
        await invoke('clear_custom_background');
      }
      saveMetadata(null);
      await render(null);
      showToast(translate('settings.customBackgroundCleared'));
    } catch (error) {
      console.error('Failed to clear custom background:', error);
      showToast(translate('settings.customBackgroundImportFailed'));
    }
  }

  function dispose() {
    if (scope.disposed) return;
    resetPreview();
    scope.dispose();
  }

  if (chooseImage) scope.event(chooseImage, 'click', () => {
    if (!allowCustomBackground() || importBusy) return;
    if (isTauri) void chooseDesktop('image');
    else imageInput?.click();
  });
  if (chooseVideo) scope.event(chooseVideo, 'click', () => {
    if (!allowCustomBackground() || importBusy) return;
    if (isTauri) void chooseDesktop('video');
    else videoInput?.click();
  });
  if (imageInput) scope.event(imageInput, 'change', event => {
    void importBrowser(event.target.files?.[0], 'image');
    event.target.value = '';
  });
  if (videoInput) scope.event(videoInput, 'change', event => {
    void importBrowser(event.target.files?.[0], 'video');
    event.target.value = '';
  });
  if (clearButton) scope.event(clearButton, 'click', () => { void clear(); });
  if (windowRef) {
    scope.event(windowRef, 'pagehide', dispose, { once: true });
    scope.event(windowRef, 'pageshow', syncPreviewPlayback);
  }
  if (root) scope.event(root, 'visibilitychange', syncPreviewPlayback);
  scope.use(onLanguageChange(() => setSummary(readMetadata())));
  let customAllowed = allowCustomBackground();
  scope.use(onThemeChange(() => {
    const allowed = allowCustomBackground();
    if (allowed === customAllowed) return;
    customAllowed = allowed;
    policyRevision += 1;
    void render(readMetadata());
  }));
  void render(readMetadata());

  return Object.freeze({
    clear,
    dispose,
    getMetadata: readMetadata,
    refresh: () => render(readMetadata()),
    syncPreviewPlayback
  });
}
