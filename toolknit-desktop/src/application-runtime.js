      import { createElement as createLucideElement, createIcons, icons } from 'lucide';
      import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
      import { initLightRays } from './lightrays.js';
      import { initPlasma } from './plasma.js';
      import { getLang, setLang, applyTranslations, onLangChange, t } from './i18n.js';
      import { initUpdatePreview } from './update-preview.js';
      import { compareVersions, createUpdateService, UPDATE_RELEASES_PAGE } from './update-service.js';
      import { readResponseTextLimited } from './core/bounded-response.js';
      import { createLazyToolRegistry } from './app/lazy-tool-registry.js';
      import { initUiSoundController } from './app/ui-sound-controller.js';
      import { createAiKeyStore } from './app/ai-key-store.js';
      import { createAiSettingsRuntime } from './app/ai-settings-runtime.js';
      import { createExternalLinksRuntime } from './app/external-links-runtime.js';
      import { createHomeExplorerRuntime } from './app/home-explorer-runtime.js';
      import { createFontSettingsRuntime } from './app/font-settings-runtime.js';
      import { createStartupRuntime } from './app/startup-runtime.js';
      import { createWindowRuntime } from './app/window-runtime.js';
      import { createUpdateRuntime } from './app/update-runtime.js';
      import { createModalRuntime } from './app/modal-runtime.js';
      import { createPageTransitionRuntime } from './app/page-transition-runtime.js';
      import { createThemeRuntime } from './app/theme-runtime.js';
      import { createOutputRuntime, OUTPUT_ROOT_KEY, displayFilesystemPath } from './app/output-runtime.js';
      import {
        createDependencyHelpers,
        overallDependencyProgress,
        updateDependencyProgress,
        formatDependencyBytes,
        isManagedRuntime,
        normalizeLibreOfficeAvailability
      } from './app/dependency-helpers.js';
      import {
        createBackgroundRuntime,
        CUSTOM_BACKGROUND_CHANGE_EVENT,
        CUSTOM_BACKGROUND_STORAGE_KEY
      } from './app/background-runtime.js';
      import { LAZY_TOOL_SPECS } from './features/lazy-tools.js';
      import { joinPath, normalizeDesktopBytes, uniqueOutputDirectory, writeUniqueFile } from './features/ppt-workflows/shared.js';
      import { currentMonitor, getCurrentWindow, LogicalSize, tauriCorePromise, tauriEventPromise, loadTauriApp } from './platform/tauri-runtime.js';
      import { readTextDocument } from './shared/text-document-reader.js';
      import { formatFileSize } from './shared/file-size.js';
      import { escapeHtml, escapeAttr } from './shared/html.js';
      import { HELP_CONTENT, getHelpContent } from './help-data.js';
      import { createDonationController } from './app/donation-controller.js';
      import { getLegalContent } from './legal-data.js';
      import { normalizeAiProviderConfig } from './ai-provider-core.js';
      import { createAiRequestRuntime } from './app/ai-request-runtime.js';
      import { extractJson } from './app/json-extractor.js';
      import { createToastManager } from './app/toast-manager.js';
      import { createHelpCenterRuntime } from './app/help-center-runtime.js';
      import { bindGlobalToolPageChrome, moveFocusOutOfHiddenRegion } from './shared/tool-page-shell.js';
      import { createHomeController } from './app/home-controller.js';
      import { createScreenPickerSettingsRuntime } from './app/screen-picker-settings-runtime.js';
      import { createCustomBackgroundSettingsRuntime } from './app/custom-background-settings-runtime.js';
      import {
        PPT_TEXT_EXTRACT_LIMITS,
        analyzePptxText,
        buildPptTextAiMessages,
        createPptTextMarkdown,
        createPptTextJson,
        createPptTextTxt,
        normalizePptTextAiMode,
        normalizePptTextFormat,
        normalizePptTextPageSelection,
        planPptTextExport,
        sanitizePptTextBaseName
      } from './ppt-text-extract-core.js';
      import {
        PPT_COMPRESS_LIMITS,
        compressPptxBytes,
        createPptCompressManifest,
        sanitizePptCompressBaseName
      } from './ppt-compress-core.js';
      import { TaskRunner } from '../shared/task-runtime.mjs';
      // Keep custom tool menus, but preserve native editing menus in text fields.
      document.addEventListener('contextmenu', (e) => {
        if (import.meta.env.DEV) return;
        if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (e.target.closest('.audio-list-item')) return;
        if (e.target.closest('.cleanup-large-files-table tr[data-path], .cleanup-large-files-context-menu')) return;
        e.preventDefault();
      });

      const WINDOW_RESIZE_KEY = 'toolknit.window-resizable.v1';
      // Keep the native constraint low enough for compact and high-DPI laptop
      // work areas. Individual pages already switch to their compact layouts
      // before this floor, while larger screens receive their preferred size
      // from the native startup fitting below.
      const WINDOW_MIN_WIDTH = 720;
      const WINDOW_MIN_HEIGHT = 480;
      const WINDOW_ABSOLUTE_MIN_WIDTH = 480;
      const WINDOW_ABSOLUTE_MIN_HEIGHT = 360;
      const WINDOW_SAFE_MARGIN = 32;
      const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
      let lazyFeatureRegistry = null;
      let customBackgroundSettingsRuntime = null;

      function syncCustomBackgroundPreviewPlayback() {
        customBackgroundSettingsRuntime?.syncPreviewPlayback?.();
      }

      function readTextStatsDocument(file) {
        return readTextDocument(file, {
          isTauri,
          fallbackName: t('home.textStats.document'),
          onTrim: max => window.showToast?.(t('home.textStats.documentTrimmed', { max }))
        });
      }
      const isScreenPickerWindow = typeof window !== 'undefined'
        && new URLSearchParams(window.location.search).get('screen-picker') === '1';
      const appWindow = isTauri ? getCurrentWindow() : null;
      const pageTransition = createPageTransitionRuntime();
      const themeRuntime = createThemeRuntime({
        enabled: !isScreenPickerWindow,
        pageTransition
      });

      const aiKeyStore = createAiKeyStore({ isTauri, tauriCorePromise });
      const aiApiKeyReady = aiKeyStore.ready;
      const getAiApiKey = aiKeyStore.get;
      const persistAiApiKey = aiKeyStore.set;
      const removeAiApiKey = aiKeyStore.remove;
      const clearLegacyAiApiKeys = aiKeyStore.clearLegacy;

      // Global UI feedback is intentionally kept separate from tool audio
      // contexts (BPM, typing and audio clipping). It is synthesized locally,
      // so no asset download or additional permission is required.
      initUiSoundController({ isScreenPickerWindow });
      if (isScreenPickerWindow) {
        setTimeout(() => {
          import('./features/color-extractor/screen-picker.js')
            .then(({ bootstrapScreenPickerOverlay }) => bootstrapScreenPickerOverlay())
            .catch(error => console.error('[screen-picker] bootstrap failed:', error));
        }, 0);
      }

      const backgroundRuntime = createBackgroundRuntime({
        isTauri,
        tauriCorePromise,
        initPlasma,
        allowCustomBackground: themeRuntime.allowsCustomBackground,
        onThemeChange: themeRuntime.subscribe,
        onHomeBackgroundChanged: () => syncHomeV2Background(),
        onPreviewPlaybackSync: () => syncCustomBackgroundPreviewPlayback?.()
      });
      const syncCustomHomeBackground = backgroundRuntime.syncHome;
      const initStandardToolPlasma = backgroundRuntime.mountTool;
      const disposeStandardToolPlasma = backgroundRuntime.disposeTool;
      window.toolknitCustomBackground = {
        refresh: () => backgroundRuntime.refresh(),
        getConfig: backgroundRuntime.getConfig
      };
      window.toolknitToolBackground = {
        mount: initStandardToolPlasma,
        dispose: disposeStandardToolPlasma
      };
      window.addEventListener(CUSTOM_BACKGROUND_CHANGE_EVENT, () => {
        backgroundRuntime.refresh({ retry: true });
      });

      function readWindowResizeSetting() {
        try { return localStorage.getItem(WINDOW_RESIZE_KEY) === '1'; } catch { return false; }
      }

      function saveWindowResizeSetting(enabled) {
        try { localStorage.setItem(WINDOW_RESIZE_KEY, enabled ? '1' : '0'); } catch {}
        return Boolean(enabled);
      }

      const windowRuntime = createWindowRuntime({
        appWindow,
        isTauri,
        isScreenPickerWindow,
        tauriCorePromise,
        getTheme: themeRuntime.get,
        onThemeChange: themeRuntime.subscribe,
        translate: t,
        refreshIcons: () => createIcons({ icons })
      });
      const {
        apply: applyWindowRadiusSetting,
        clampRadius: clampWindowRadius,
        handleControl: handleWindowControlAction,
        observeFrame: observeNativeWindowFrameState,
        pixels: windowRadiusPixels,
        read: readWindowRadiusSetting,
        repairChrome: repairNativeWindowChrome,
        save: saveWindowRadiusSetting,
        scheduleChromeRepair: scheduleNativeWindowChromeRepair,
        syncAfterLayout: syncWindowFrameAfterLayoutChange,
        syncFrame: syncWindowFrameState,
        syncRadiusAfterLayout: syncWindowRadiusAfterLayoutChange,
        toggleMaximize: toggleWindowFrameMaximize
      } = windowRuntime;

      applyWindowRadiusSetting();
      scheduleNativeWindowChromeRepair();
      observeNativeWindowFrameState();

      createIcons({ icons });
      applyTranslations();

      const modalRuntime = createModalRuntime();
      const {
        initA11y: initModalA11yStates,
        initOverflow: initModalOverflowTitles,
        scanOverflow: scanModalOverflowNode,
        syncA11y: syncModalA11yState,
        syncOverflowTitle: syncModalOverflowTitle
      } = modalRuntime;
      initModalA11yStates();
      initModalOverflowTitles();

      function enablePdfPageStageHorizontalWheel(stage) {
        if (!stage) return;
        stage.addEventListener('wheel', (event) => {
          if (event.ctrlKey || event.metaKey || stage.scrollWidth <= stage.clientWidth) return;
          const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
            ? event.deltaX
            : event.deltaY;
          if (!delta) return;

          const maxScrollLeft = stage.scrollWidth - stage.clientWidth;
          const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, stage.scrollLeft + delta));
          if (nextScrollLeft === stage.scrollLeft) return;

          event.preventDefault();
          stage.scrollLeft = nextScrollLeft;
        }, { passive: false });
      }

      document.querySelectorAll('.pdf-merge-page-stage').forEach(enablePdfPageStageHorizontalWheel);

      function stopDefaultDynamicBackground() {
      }

      function syncDefaultDynamicBackground() {
        stopDefaultDynamicBackground();
      }
      document.addEventListener('visibilitychange', syncDefaultDynamicBackground);
      window.addEventListener('pageshow', syncDefaultDynamicBackground);
      window.addEventListener('pagehide', stopDefaultDynamicBackground);
      syncDefaultDynamicBackground();

      let windowResizeQueue = Promise.resolve();
      async function adaptiveMinimumWindowSize() {
        if (!isTauri) return new LogicalSize(WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT);
        try {
          const monitor = await currentMonitor();
          const scale = Number(monitor?.scaleFactor) || 1;
          const physicalSize = monitor?.workArea?.size;
          if (!physicalSize || scale <= 0) {
            return new LogicalSize(WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT);
          }
          const usableWidth = Math.max(
            WINDOW_ABSOLUTE_MIN_WIDTH,
            (Number(physicalSize.width) / scale) - WINDOW_SAFE_MARGIN
          );
          const usableHeight = Math.max(
            WINDOW_ABSOLUTE_MIN_HEIGHT,
            (Number(physicalSize.height) / scale) - WINDOW_SAFE_MARGIN
          );
          return new LogicalSize(
            Math.max(WINDOW_ABSOLUTE_MIN_WIDTH, Math.min(WINDOW_MIN_WIDTH, usableWidth)),
            Math.max(WINDOW_ABSOLUTE_MIN_HEIGHT, Math.min(WINDOW_MIN_HEIGHT, usableHeight))
          );
        } catch (error) {
          console.warn('Unable to inspect monitor work area for window sizing:', error);
          return new LogicalSize(WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT);
        }
      }

      function applyWindowResizeSetting(enabled = readWindowResizeSetting()) {
        const requested = Boolean(enabled);
        if (isScreenPickerWindow || !isTauri || !appWindow) return Promise.resolve(requested);

        // All native style changes share one queue. This prevents a fast
        // double-click from interleaving setResizable with unmaximize or a
        // delayed frame repair and leaving the toggle out of sync.
        windowResizeQueue = windowResizeQueue
          .catch(() => undefined)
          .then(async () => {
            await appWindow.setMinSize(await adaptiveMinimumWindowSize());
            await appWindow.setMaxSize(null);
            await repairNativeWindowChrome();

            if (!requested) {
              try {
                if (await appWindow.isMaximized()) await appWindow.unmaximize();
              } catch (error) {
                // A transient maximize-state read must not prevent the user
                // from changing the resizable setting itself.
                console.warn('Unable to restore window before disabling resize:', error);
              }
            }
            await appWindow.setResizable(requested);

            const applied = await appWindow.isResizable();
            if (applied !== requested) {
              throw new Error(`Native resizable state mismatch: requested=${requested}, applied=${applied}`);
            }
            syncWindowFrameAfterLayoutChange();
            return applied;
          });
        return windowResizeQueue;
      }

      if (!isScreenPickerWindow) {
        const initialResizePreference = readWindowResizeSetting();
        void applyWindowResizeSetting(initialResizePreference).catch(error => {
          console.error('Failed to apply saved window resize setting:', error);
        });
      }

      function canStartNativeWindowDrag(event) {
        if (event.button !== 0 || event.defaultPrevented) return false;
        const target = event.target;
        if (!(target instanceof Element)) return false;
        return !target.closest('button, a, input, select, textarea, summary, [contenteditable="true"], [role="button"], [data-no-window-drag]');
      }

      // A data-tauri-drag-region on a complete header also includes its nested
      // controls. On Windows that lets the native drag handler win over a
      // settings/minimize/maximize click intermittently. Dedicated empty drag
      // strips retain the native attribute; interactive headers start dragging
      // only from genuinely empty space.
      function initNativeWindowDragRegions() {
        if (!isTauri || !appWindow || isScreenPickerWindow) return;
        document.querySelectorAll('.main-header-drag-region').forEach(region => {
          region.setAttribute('data-tauri-drag-region', '');
        });

        const headerSelector = '.settings-header, .settings-v2-topbar, .home-v2-topbar, .api-key-header, .feedback-header, .audio-convert-header, .audio-clip-header, .help-v2-topbar, .pdf-merge-v2-topbar, .help-sidebar-header, .help-content-header, .transcription-model-header, .pdf-merge-page-picker-header, .pdf-page-workspace-header, .pdf-preview-drawer-header, .update-preview-stage-topbar';
        document.querySelectorAll(headerSelector).forEach(header => {
          if (header.dataset.tkWindowDragBound === '1') return;
          header.dataset.tkWindowDragBound = '1';
          header.removeAttribute('data-tauri-drag-region');
          header.style.setProperty('-webkit-app-region', 'no-drag');
          header.addEventListener('pointerdown', event => {
            if (!canStartNativeWindowDrag(event)) return;
            event.preventDefault();
            appWindow.startDragging().catch(error => {
              console.warn('Native window drag failed:', error);
            });
          });
        });
      }

      initNativeWindowDragRegions();

      const outputRuntime = createOutputRuntime({
        isTauri,
        tauriCorePromise,
        notify: message => window.showToast?.(message),
        translate: t
      });
      const configuredOutputRoot = outputRuntime.configuredRoot;
      const syncConfiguredOutputRoot = outputRuntime.syncConfiguredRoot;
      const getOutputDir = outputRuntime.getOutputDir;
      const outputParentFolder = outputRuntime.outputParentFolder;
      const displayOutputParentFolder = outputRuntime.displayOutputParentFolder;
      const openOutputFolder = outputRuntime.openFolder;
      const dependencyHelpers = createDependencyHelpers({
        translate: t,
        getLanguage: getLang,
        displayPath: displayFilesystemPath
      });
      const {
        detectedRuntimeLabel,
        dependencyStatusText,
        dependencyErrorMessage,
        dependencyInstallingDetail,
        runtimeMetadata
      } = dependencyHelpers;
      const transitionMask = document.getElementById('transitionMask');
      const appRoot = document.querySelector('.app');
      const homeController = createHomeController({
        root: document,
        transitionMask,
        appRoot,
        mainContent: document.querySelector('.main-content'),
        isTauri,
        appWindow,
        isScreenPickerWindow,
        handleWindowControlAction,
        syncCustomBackground: syncCustomHomeBackground,
        translate: t,
        onOpenTool: toolId => {
          if (!toolId || !LAZY_TOOL_SPECS[toolId]) return;
          void lazyFeatureRegistry?.open(toolId);
        }
      });
      const syncHomeV2Background = homeController.syncHomeBackground;
      const switchCategory = homeController.switchCategory;
      const launchToolFromHome = homeController.launchTool;
      homeController.bind();

      const settingsOverlay = document.getElementById('settingsOverlay');
      const settingsBtns = document.querySelectorAll('#settingsBtn, button[id$="V2Settings"]');
      const settingsBack = document.getElementById('settingsBack');
      const settingsContent = settingsOverlay?.querySelector('.settings-content');

      // Language selection in settings
      const langOptionBtns = document.querySelectorAll('.settings-row.lang-options .lang-option');
      function syncLangButtons() {
        const current = getLang();
        langOptionBtns.forEach(btn => {
          btn.classList.toggle('active', btn.dataset.lang === current);
        });
      }
      langOptionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          if (transitionMask) transitionMask.classList.add('visible');
          setTimeout(() => {
            setLang(btn.dataset.lang);
            setTimeout(() => {
              if (transitionMask) transitionMask.classList.remove('visible');
            }, 300);
          }, 300);
        });
      });
      onLangChange(syncLangButtons);
      syncLangButtons();

      const uiSoundToggle = document.getElementById('uiSoundToggle');
      const uiSoundStyleBtns = document.querySelectorAll('[data-sound-style]');
      const uiSoundPreview = document.getElementById('uiSoundPreview');

      function syncUiSoundControls(state = window.toolknitUiSound?.getState?.() || { enabled: true, style: '1' }) {
        const enabled = state.enabled !== false;
        uiSoundToggle?.classList.toggle('active', enabled);
        uiSoundToggle?.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        uiSoundStyleBtns.forEach(button => {
          const active = String(button.dataset.soundStyle) === String(state.style);
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        uiSoundPreview?.toggleAttribute('disabled', !enabled);
      }

      uiSoundToggle?.addEventListener('click', () => {
        const current = window.toolknitUiSound?.getState?.() || { enabled: true, style: '1' };
        const next = window.toolknitUiSound?.setEnabled?.(!current.enabled) || { ...current, enabled: !current.enabled };
        syncUiSoundControls(next);
        if (next.enabled) window.toolknitUiSound?.preview?.(next.style);
      });
      uiSoundStyleBtns.forEach(button => {
        button.addEventListener('click', () => {
          const style = String(button.dataset.soundStyle || '1');
          const next = window.toolknitUiSound?.setStyle?.(style) || { enabled: true, style };
          syncUiSoundControls(next);
          if (next.enabled) window.toolknitUiSound?.preview?.(style);
        });
      });
      uiSoundPreview?.addEventListener('click', () => {
        const state = window.toolknitUiSound?.getState?.() || { enabled: true, style: '1' };
        if (!state.enabled) return;
        window.toolknitUiSound?.preview?.(state.style);
      });
      window.addEventListener('toolknit-ui-sound-change', event => syncUiSoundControls(event.detail));
      syncUiSoundControls();

      const windowRadiusOptionBtns = document.querySelectorAll('.settings-radius-option[data-window-radius-mode]');
      const windowRadiusCustomInput = document.getElementById('windowRadiusCustomInput');
      const windowRadiusValue = document.getElementById('windowRadiusValue');
      const windowRadiusCustomWrap = document.getElementById('windowRadiusCustomWrap');
      const windowResizeToggle = document.getElementById('windowResizeToggle');
      let applyingWindowResizeSetting = false;

      function syncWindowResizeControl(enabled = readWindowResizeSetting()) {
        windowResizeToggle?.classList.toggle('active', enabled);
        windowResizeToggle?.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        windowResizeToggle?.toggleAttribute('disabled', applyingWindowResizeSetting);
      }

      function syncWindowRadiusControls(setting = readWindowRadiusSetting()) {
        const radius = applyWindowRadiusSetting(setting);
        windowRadiusOptionBtns.forEach(btn => {
          btn.classList.toggle('active', btn.dataset.windowRadiusMode === setting.mode);
        });
        if (windowRadiusCustomInput) {
          windowRadiusCustomInput.value = String(clampWindowRadius(setting.custom));
          windowRadiusCustomInput.disabled = setting.mode !== 'custom';
        }
        if (windowRadiusValue) windowRadiusValue.textContent = `${radius}px`;
        windowRadiusCustomWrap?.classList.toggle('is-disabled', setting.mode !== 'custom');
      }

      windowRadiusOptionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const current = readWindowRadiusSetting();
          const next = saveWindowRadiusSetting({
            mode: btn.dataset.windowRadiusMode || 'none',
            custom: current.custom
          });
          syncWindowRadiusControls(next);
        });
      });

      windowRadiusCustomInput?.addEventListener('input', () => {
        const next = saveWindowRadiusSetting({
          mode: 'custom',
          custom: windowRadiusCustomInput.value
        });
        windowRadiusOptionBtns.forEach(btn => {
          btn.classList.toggle('active', btn.dataset.windowRadiusMode === 'custom');
        });
        if (windowRadiusCustomInput) windowRadiusCustomInput.disabled = false;
        if (windowRadiusValue) windowRadiusValue.textContent = `${windowRadiusPixels(next)}px`;
        windowRadiusCustomWrap?.classList.remove('is-disabled');
      });

      windowRadiusCustomInput?.addEventListener('change', () => {
        syncWindowRadiusControls(readWindowRadiusSetting());
      });

      windowResizeToggle?.addEventListener('click', async () => {
        if (applyingWindowResizeSetting) return;
        const previous = readWindowResizeSetting();
        const next = !previous;
        applyingWindowResizeSetting = true;
        syncWindowResizeControl(previous);
        try {
          const applied = await applyWindowResizeSetting(next);
          saveWindowResizeSetting(applied);
          syncWindowResizeControl(applied);
        } catch (error) {
          console.error('Failed to apply window resize setting:', error);
          syncWindowResizeControl(previous);
          window.showToast?.(getLang() === 'zh' ? '窗口拉伸设置应用失败，请重试。' : 'Failed to apply window resize setting. Please try again.');
        } finally {
          applyingWindowResizeSetting = false;
          syncWindowResizeControl(readWindowResizeSetting());
        }
      });

      syncWindowResizeControl();
      syncWindowRadiusControls();

      // Re-apply translations when language changes externally
      onLangChange(() => {
        applyTranslations();
        syncWindowRadiusControls();
      });

      async function ensureFfmpegAvailable() {
        if (!isTauri) return false;
        try {
          const { invoke } = await tauriCorePromise;
          return await invoke('check_ffmpeg');
        } catch (e) {
          console.error('FFmpeg check failed:', e);
          return false;
        }
      }

      // Intercept tool entry: check ffmpeg before opening the tool overlay
      async function openToolWithFfmpegCheck(openFn) {
        const ready = await ensureFfmpegAvailable();
        if (ready) { openFn(); return; }
        showDependencyGate({ openFn, needsFfmpeg: true, needsModel: false });
      }

      // Storage path display + open folder
      const storagePathDisplay = document.getElementById('storagePathDisplay');
      const openStorageFolder = document.getElementById('openStorageFolder');
      const chooseStorageFolder = document.getElementById('chooseStorageFolder');
      async function refreshStoragePath() {
        if (!storagePathDisplay) return;
        if (!isTauri) { storagePathDisplay.textContent = '~/Downloads/ToolKnit'; return; }
        try {
          const { invoke } = await tauriCorePromise;
          const customRoot = await invoke('get_output_root');
          if (typeof customRoot === 'string' && customRoot.trim()) {
            localStorage.setItem(OUTPUT_ROOT_KEY, customRoot);
            storagePathDisplay.textContent = displayFilesystemPath(customRoot);
            return;
          }
          localStorage.removeItem(OUTPUT_ROOT_KEY);
          storagePathDisplay.textContent = displayFilesystemPath(await invoke('get_default_output_root'));
        } catch { storagePathDisplay.textContent = '--'; }
      }
      if (storagePathDisplay) {
        void syncConfiguredOutputRoot().then(refreshStoragePath);
      }
      chooseStorageFolder?.addEventListener('click', async () => {
        if (!isTauri) return;
        try {
          const { open } = await import('@tauri-apps/plugin-dialog');
          const selected = await open({ directory: true, multiple: false, title: '选择 ToolKnit 输出位置' });
          if (!selected || Array.isArray(selected)) return;
          const { invoke } = await tauriCorePromise;
          await invoke('set_output_root', { outputDir: selected });
          localStorage.setItem(OUTPUT_ROOT_KEY, selected);
          await refreshStoragePath();
          window.showToast?.(t('settings.storageFolderUpdated'));
        } catch (error) {
          console.error('Choose output folder failed:', error);
          window.showToast?.(t('settings.storageFolderChooseFailed'));
        }
      });
      if (openStorageFolder) {
        openStorageFolder.addEventListener('click', async () => {
          if (!isTauri) return;
          try {
            const { invoke } = await tauriCorePromise;
            const customRoot = await invoke('get_output_root');
            const defaultRoot = await invoke('get_default_output_root');
            await invoke('open_path', { path: customRoot || defaultRoot });
          } catch (e) {
            console.error('Open folder failed:', e);
            window.showToast?.(t('settings.storageFolderOpenFailed'));
          }
        });
      }

      onLangChange(() => {
        void refreshStoragePath();
      });

      // Toast is consumed by settings runtimes created below. Initialize it
      // before wiring those runtimes so the startup path never touches a
      // temporal-dead-zone binding and aborts the rest of application setup.
      const toastIconNodes = Object.freeze({
        info: icons.Info,
        success: icons.CircleCheck,
        warning: icons.TriangleAlert,
        error: icons.CircleAlert,
        close: icons.X
      });
      const toastManager = createToastManager({
        root: document,
        getLanguage: getLang,
        createIconElement: name => {
          const iconNode = toastIconNodes[name];
          return iconNode
            ? createLucideElement(iconNode, { 'aria-hidden': 'true', 'stroke-width': 2 })
            : null;
        }
      });
      const showToast = toastManager.show;
      window.showToast = showToast;
      window.alert = message => {
        try {
          showToast(message);
        } catch (error) {
          console.error('Toast fallback failed:', error);
        }
      };

      // Custom background settings own import, preview and media cleanup.
      customBackgroundSettingsRuntime = createCustomBackgroundSettingsRuntime({
        root: document,
        windowRef: window,
        isTauri,
        tauriCorePromise,
        tauriEventPromise,
        settingsOverlay,
        storageKey: CUSTOM_BACKGROUND_STORAGE_KEY,
        changeEvent: CUSTOM_BACKGROUND_CHANGE_EVENT,
        allowCustomBackground: themeRuntime.allowsCustomBackground,
        onThemeChange: themeRuntime.subscribe,
        translate: t,
        showToast,
        onLanguageChange: onLangChange
      });
      // ===== Local interface font overrides =====
      const fontSettingsRuntime = createFontSettingsRuntime({
        root: document,
        windowRef: window,
        isTauri,
        tauriCorePromise,
        normalizeDesktopBytes,
        translate: t
      });

      // ===== Version update check =====
      const versionUpdateStatus = document.getElementById('versionUpdateStatus');
      const checkVersionUpdateBtn = document.getElementById('checkVersionUpdateBtn');
      const openReleasePageBtn = document.getElementById('openReleasePageBtn');
      const APP_VERSION_FALLBACK = '3.1.0';
      let updatePreviewController = null;
      const updateRuntime = createUpdateRuntime({
        isTauri,
        fallbackVersion: APP_VERSION_FALLBACK,
        updateService: createUpdateService(),
        compareVersions,
        translate: t,
        statusElement: versionUpdateStatus,
        checkButton: checkVersionUpdateBtn,
        releaseButton: openReleasePageBtn,
        getPreviewController: () => updatePreviewController,
        openExternalUrl: url => openExternalUrl(url || UPDATE_RELEASES_PAGE),
        loadAppVersion: async () => (await loadTauriApp()).getVersion()
      });
      const updateService = updateRuntime.service;
      const getLocalAppVersion = updateRuntime.getLocalAppVersion;
      const renderVersionUpdateStatus = updateRuntime.render;
      const setVersionUpdateState = updateRuntime.setState;
      const runVersionUpdateCheck = updateRuntime.runCheck;
      const getLastVersionUpdateResult = updateRuntime.getLastResult;

      checkVersionUpdateBtn?.addEventListener('click', () => void runVersionUpdateCheck());
      openReleasePageBtn?.addEventListener('click', () => {
        void openExternalUrl(getLastVersionUpdateResult()?.release?.htmlUrl || UPDATE_RELEASES_PAGE);
      });

      void getLocalAppVersion().then(version => {
        setVersionUpdateState('neutral', version);
      });

      onLangChange(renderVersionUpdateStatus);

      // Screen picker shortcut settings own their event and recording cleanup.
      const screenPickerSettingsRuntime = createScreenPickerSettingsRuntime({
        root: document,
        windowRef: window,
        isTauri,
        tauriCorePromise,
        translate: t,
        getLanguage: getLang,
        showToast,
        onLanguageChange: onLangChange
      });

      // ===== Offline model manager and local transcription =====
      const MODEL_SOURCE_KEY = 'toolknit.transcription-model-source.v1';
      const offlineModelSummary = document.getElementById('offlineModelSummary');
      const manageOfflineModels = document.getElementById('manageOfflineModels');
      const transcriptionModelOverlay = document.getElementById('transcriptionModelOverlay');
      const transcriptionModelClose = document.getElementById('transcriptionModelClose');
      const transcriptionModelList = document.getElementById('transcriptionModelList');
      const transcriptionSourceOptions = document.getElementById('transcriptionSourceOptions');
      const dependencyGateOverlay = document.getElementById('dependencyGateOverlay');
      const dependencyGateTitle = document.getElementById('dependencyGateTitle');
      const dependencyGateDesc = document.getElementById('dependencyGateDesc');
      const dependencyGateList = document.getElementById('dependencyGateList');
      const dependencyGateProgress = document.getElementById('dependencyGateProgress');
      const dependencyGateProgressFill = document.getElementById('dependencyGateProgressFill');
      const dependencyGateProgressText = document.getElementById('dependencyGateProgressText');
      const dependencyGateError = document.getElementById('dependencyGateError');
      const dependencyGateCancel = document.getElementById('dependencyGateCancel');
      const dependencyGateInstall = document.getElementById('dependencyGateInstall');
      let transcriptionModels = [];
      let transcriptionModelProgress = new Map();
      let transcriptionDownloadSource = localStorage.getItem(MODEL_SOURCE_KEY) || 'auto';
      let dependencyGateState = null;

      const formatTranscriptionBytes = formatDependencyBytes;

      function activeTranscriptionModel() {
        return transcriptionModels.find(model => model.current && model.installed) || null;
      }

      function updateOfflineModelSummary() {
        if (!offlineModelSummary) return;
        const current = activeTranscriptionModel();
        offlineModelSummary.textContent = current
          ? t('settings.offlineModelsCurrent', { model: current.display_name })
          : t('settings.offlineModelsEmpty');
      }

      function renderTranscriptionModels() {
        if (!transcriptionModelList) return;
        transcriptionModelList.replaceChildren();
        transcriptionModels.forEach(model => {
          const row = document.createElement('div');
          row.className = 'transcription-model-row';
          const info = document.createElement('div');
          const name = document.createElement('div');
          name.className = 'transcription-model-name';
          name.textContent = model.display_name;
          const meta = document.createElement('div');
          meta.className = 'transcription-model-meta';
          meta.textContent = `${formatTranscriptionBytes(model.bytes)} ${model.id === 'small' ? `- ${t('home.transcription.recommended')}` : ''}`;
          info.append(name, meta);
          const actions = document.createElement('div');
          actions.className = 'transcription-model-actions';
          const progress = transcriptionModelProgress.get(model.id);
          if (progress && progress.phase !== 'complete') {
            const status = document.createElement('span');
            status.className = 'transcription-model-current';
            status.textContent = progress.phase === 'verifying'
              ? t('home.transcription.verifying')
              : `${Math.min(100, Math.round((progress.downloaded_bytes / Math.max(1, progress.total_bytes)) * 100))}%`;
            actions.append(status);
          } else if (model.installed) {
            if (model.current) {
              const current = document.createElement('span');
              current.className = 'transcription-model-current';
              current.textContent = t('home.transcription.current');
              actions.append(current);
            } else {
              const use = document.createElement('button');
              use.type = 'button'; use.className = 'settings-btn'; use.textContent = t('home.transcription.useModel');
              use.addEventListener('click', async () => {
                const { invoke } = await tauriCorePromise;
                await invoke('set_current_transcription_model', { modelId: model.id });
                await refreshTranscriptionModels();
              });
              actions.append(use);
            }
            const remove = document.createElement('button');
            remove.type = 'button'; remove.className = 'settings-btn'; remove.textContent = t('home.transcription.deleteModel');
            remove.addEventListener('click', async () => {
              const { invoke } = await tauriCorePromise;
              await invoke('delete_transcription_model', { modelId: model.id });
              await refreshTranscriptionModels();
            });
            actions.append(remove);
          } else {
            const install = document.createElement('button');
            install.type = 'button'; install.className = 'settings-btn'; install.textContent = t('home.transcription.downloadModel');
            install.addEventListener('click', async () => {
              try {
                transcriptionModelProgress.set(model.id, { phase: 'downloading', downloaded_bytes: 0, total_bytes: model.bytes });
                renderTranscriptionModels();
                const { invoke } = await tauriCorePromise;
                await invoke('download_transcription_model', { modelId: model.id, source: resolvedModelDownloadSource() });
                transcriptionModelProgress.delete(model.id);
                await refreshTranscriptionModels();
              } catch (error) {
                transcriptionModelProgress.delete(model.id);
                renderTranscriptionModels();
                window.showToast?.(String(error));
              }
            });
            actions.append(install);
          }
          row.append(info, actions);
          if (progress && progress.phase !== 'complete') {
            const bar = document.createElement('div');
            bar.className = 'transcription-model-progress';
            const fill = document.createElement('span');
            fill.style.width = `${Math.min(100, (progress.downloaded_bytes / Math.max(1, progress.total_bytes)) * 100)}%`;
            bar.append(fill); row.append(bar);
          }
          transcriptionModelList.append(row);
        });
        if (window.lucide) window.lucide.createIcons();
      }

      async function refreshTranscriptionModels() {
        if (!isTauri) return;
        try {
          const { invoke } = await tauriCorePromise;
          transcriptionModels = await invoke('list_transcription_models');
          updateOfflineModelSummary();
          renderTranscriptionModels();
        } catch (error) {
          console.error('Cannot read offline transcription models:', error);
        }
      }

      function openTranscriptionModelManager() {
        if (!transcriptionModelOverlay) return;
        transcriptionModelOverlay.classList.add('visible');
        transcriptionModelOverlay.setAttribute('aria-hidden', 'false');
        void refreshTranscriptionModels();
      }

      function closeTranscriptionModelManager() {
        transcriptionModelOverlay?.classList.remove('visible');
        transcriptionModelOverlay?.setAttribute('aria-hidden', 'true');
      }

      manageOfflineModels?.addEventListener('click', openTranscriptionModelManager);
      transcriptionModelClose?.addEventListener('click', closeTranscriptionModelManager);
      transcriptionModelOverlay?.addEventListener('click', event => { if (event.target === transcriptionModelOverlay) closeTranscriptionModelManager(); });
      transcriptionSourceOptions?.querySelectorAll('[data-source]').forEach(button => {
        button.classList.toggle('active', button.dataset.source === transcriptionDownloadSource);
        button.addEventListener('click', () => {
          transcriptionDownloadSource = button.dataset.source || 'auto';
          localStorage.setItem(MODEL_SOURCE_KEY, transcriptionDownloadSource);
          transcriptionSourceOptions.querySelectorAll('[data-source]').forEach(item => item.classList.toggle('active', item === button));
        });
      });
      if (isTauri) {
        void refreshTranscriptionModels();
        (async () => {
          const { listen } = await tauriEventPromise;
          await listen('transcription-model-download-progress', event => {
            const progress = event.payload;
            if (!progress?.model_id) return;
            transcriptionModelProgress.set(progress.model_id, progress);
            renderTranscriptionModels();
            updateDependencyGateProgress('model', progress);
          });
        })().catch(error => console.error('Cannot listen for model download progress:', error));
      }

      // FFmpeg is a separately managed runtime so the desktop installer remains compact.
      const FFMPEG_SOURCE_KEY = 'toolknit.ffmpeg-runtime-source.v1';
      const ffmpegRuntimeSummary = document.getElementById('ffmpegRuntimeSummary');
      const manageFfmpegRuntime = document.getElementById('manageFfmpegRuntime');
      const ffmpegRuntimeOverlay = document.getElementById('ffmpegRuntimeOverlay');
      const ffmpegRuntimeClose = document.getElementById('ffmpegRuntimeClose');
      const ffmpegRuntimeList = document.getElementById('ffmpegRuntimeList');
      const ffmpegRuntimeSourceOptions = document.getElementById('ffmpegRuntimeSourceOptions');
      let ffmpegRuntimeStatus = null;
      let ffmpegRuntimeProgress = null;
      let ffmpegRuntimeSource = localStorage.getItem(FFMPEG_SOURCE_KEY) || 'auto';

      const formatRuntimeBytes = formatDependencyBytes;

      function updateFfmpegRuntimeSummary() {
        if (!ffmpegRuntimeSummary) return;
        ffmpegRuntimeSummary.textContent = ffmpegRuntimeStatus?.installed
          ? detectedRuntimeLabel(ffmpegRuntimeStatus)
          : t('settings.ffmpegRuntimeEmpty');
      }

      function renderFfmpegRuntime() {
        if (!ffmpegRuntimeList) return;
        ffmpegRuntimeList.replaceChildren();
        const row = document.createElement('div'); row.className = 'transcription-model-row';
        const info = document.createElement('div');
        const name = document.createElement('div'); name.className = 'transcription-model-name'; name.textContent = 'FFmpeg';
        const meta = document.createElement('div'); meta.className = 'transcription-model-meta';
        meta.textContent = ffmpegRuntimeStatus?.installed
          ? runtimeMetadata(ffmpegRuntimeStatus)
          : (getLang() === 'en' ? 'Required for audio and video tools' : '音频、视频工具所需的本地运行时');
        info.append(name, meta);
        const actions = document.createElement('div'); actions.className = 'transcription-model-actions';
        if (ffmpegRuntimeProgress && ffmpegRuntimeProgress.phase !== 'complete') {
          const progress = document.createElement('span'); progress.className = 'transcription-model-current';
          const total = Math.max(1, ffmpegRuntimeProgress.total_bytes || 0);
          progress.textContent = ffmpegRuntimeProgress.phase === 'installing'
            ? (getLang() === 'en' ? 'Installing' : '正在安装')
            : `${Math.min(100, Math.round((ffmpegRuntimeProgress.downloaded_bytes || 0) / total * 100))}%`;
          actions.append(progress);
        } else if (ffmpegRuntimeStatus?.installed && isManagedRuntime(ffmpegRuntimeStatus)) {
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'settings-btn'; remove.textContent = getLang() === 'en' ? 'Delete' : '删除';
          remove.addEventListener('click', async () => {
            try { const { invoke } = await tauriCorePromise; await invoke('delete_ffmpeg_runtime'); await refreshFfmpegRuntime(); }
            catch (error) { window.showToast?.(String(error?.message || error)); }
          });
          actions.append(remove);
        } else if (ffmpegRuntimeStatus?.installed) {
          const detected = document.createElement('span'); detected.className = 'transcription-model-current'; detected.textContent = detectedRuntimeLabel(ffmpegRuntimeStatus);
          actions.append(detected);
        } else {
          const install = document.createElement('button'); install.type = 'button'; install.className = 'settings-btn'; install.textContent = getLang() === 'en' ? 'Download' : '下载';
          install.addEventListener('click', async () => {
            try {
              ffmpegRuntimeProgress = { phase: 'downloading', downloaded_bytes: 0, total_bytes: 0 }; renderFfmpegRuntime();
              const { invoke } = await tauriCorePromise; await invoke('download_ffmpeg_runtime', { source: resolvedFfmpegDownloadSource() });
              ffmpegRuntimeProgress = null; await refreshFfmpegRuntime();
            } catch (error) { ffmpegRuntimeProgress = null; renderFfmpegRuntime(); window.showToast?.(String(error?.message || error)); }
          });
          actions.append(install);
        }
        row.append(info, actions);
        if (ffmpegRuntimeProgress && ffmpegRuntimeProgress.phase !== 'complete') {
          const bar = document.createElement('div'); bar.className = 'transcription-model-progress';
          const fill = document.createElement('span'); const total = Math.max(1, ffmpegRuntimeProgress.total_bytes || 0);
          fill.style.width = `${Math.min(100, (ffmpegRuntimeProgress.downloaded_bytes || 0) / total * 100)}%`; bar.append(fill); row.append(bar);
        }
        ffmpegRuntimeList.append(row);
      }

      async function refreshFfmpegRuntime() {
        if (!isTauri) return;
        try { const { invoke } = await tauriCorePromise; ffmpegRuntimeStatus = await invoke('get_ffmpeg_runtime_status'); updateFfmpegRuntimeSummary(); renderFfmpegRuntime(); }
        catch (error) { console.error('Cannot read FFmpeg runtime:', error); }
      }
      function openFfmpegRuntimeManager() { if (!ffmpegRuntimeOverlay) return; ffmpegRuntimeOverlay.classList.add('visible'); ffmpegRuntimeOverlay.setAttribute('aria-hidden', 'false'); void refreshFfmpegRuntime(); }
      function closeFfmpegRuntimeManager() { ffmpegRuntimeOverlay?.classList.remove('visible'); ffmpegRuntimeOverlay?.setAttribute('aria-hidden', 'true'); }
      manageFfmpegRuntime?.addEventListener('click', openFfmpegRuntimeManager);
      ffmpegRuntimeClose?.addEventListener('click', closeFfmpegRuntimeManager);
      ffmpegRuntimeOverlay?.addEventListener('click', event => { if (event.target === ffmpegRuntimeOverlay) closeFfmpegRuntimeManager(); });
      ffmpegRuntimeSourceOptions?.querySelectorAll('[data-source]').forEach(button => {
        button.classList.toggle('active', button.dataset.source === ffmpegRuntimeSource);
        button.addEventListener('click', () => { ffmpegRuntimeSource = button.dataset.source || 'auto'; localStorage.setItem(FFMPEG_SOURCE_KEY, ffmpegRuntimeSource); ffmpegRuntimeSourceOptions.querySelectorAll('[data-source]').forEach(item => item.classList.toggle('active', item === button)); });
      });
      if (isTauri) {
        void refreshFfmpegRuntime();
        (async () => { const { listen } = await tauriEventPromise; await listen('ffmpeg-runtime-download-progress', event => { ffmpegRuntimeProgress = event.payload; renderFfmpegRuntime(); updateDependencyGateProgress('ffmpeg', event.payload); }); })().catch(error => console.error('Cannot listen for FFmpeg runtime download:', error));
      }

      // LibreOffice is an optional, separately managed PPT rendering runtime.
      const LIBREOFFICE_SOURCE_KEY = 'toolknit.libreoffice-runtime-source.v1';
      const libreOfficeRuntimeSummary = document.getElementById('libreOfficeRuntimeSummary');
      const manageLibreOfficeRuntime = document.getElementById('manageLibreOfficeRuntime');
      const libreOfficeRuntimeOverlay = document.getElementById('libreOfficeRuntimeOverlay');
      const libreOfficeRuntimeClose = document.getElementById('libreOfficeRuntimeClose');
      const libreOfficeRuntimeList = document.getElementById('libreOfficeRuntimeList');
      const libreOfficeRuntimeSourceOptions = document.getElementById('libreOfficeRuntimeSourceOptions');
      let libreOfficeRuntimeStatus = null;
      let libreOfficeRuntimeProgress = null;
      let libreOfficeRuntimeSource = localStorage.getItem(LIBREOFFICE_SOURCE_KEY) || 'auto';
      // A full status lookup probes soffice and may walk hundreds of files to
      // calculate the managed runtime size. Keep that work out of the PPT
      // page-entry path and share in-flight checks between callers.
      const LIBREOFFICE_AVAILABILITY_TTL = 30_000;
      const LIBREOFFICE_STATUS_TTL = 15_000;
      let libreOfficeRuntimeAvailable = null;
      let libreOfficeRuntimeAvailabilityAt = 0;
      let libreOfficeRuntimeAvailabilityPromise = null;
      let libreOfficeRuntimeStatusAt = 0;
      let libreOfficeRuntimeStatusPromise = null;

      function cacheLibreOfficeAvailability(available, at = Date.now()) {
        libreOfficeRuntimeAvailable = Boolean(available);
        libreOfficeRuntimeAvailabilityAt = at;
        return libreOfficeRuntimeAvailable;
      }

      async function checkLibreOfficeRuntimeAvailable({ force = false } = {}) {
        if (!isTauri) return false;
        const now = Date.now();
        if (!force && typeof libreOfficeRuntimeAvailable === 'boolean'
          && now - libreOfficeRuntimeAvailabilityAt < LIBREOFFICE_AVAILABILITY_TTL) {
          return libreOfficeRuntimeAvailable;
        }
        if (libreOfficeRuntimeAvailabilityPromise) return libreOfficeRuntimeAvailabilityPromise;
        libreOfficeRuntimeAvailabilityPromise = (async () => {
          const { invoke } = await tauriCorePromise;
          try {
            const available = normalizeLibreOfficeAvailability(await invoke('is_libreoffice_runtime_available'));
            cacheLibreOfficeAvailability(available);
            return available;
          } catch (error) {
            // Older already-installed builds do not expose the lightweight
            // command. Fall back once, then use the same short-lived cache.
            try {
              const status = await invoke('get_libreoffice_runtime_status');
              libreOfficeRuntimeStatus = status;
              libreOfficeRuntimeStatusAt = Date.now();
              updateLibreOfficeRuntimeSummary();
              renderLibreOfficeRuntime();
              return cacheLibreOfficeAvailability(Boolean(status?.installed));
            } catch (fallbackError) {
              console.error('Cannot check PPT runtime availability:', fallbackError || error);
              return cacheLibreOfficeAvailability(false);
            }
          }
        })().finally(() => { libreOfficeRuntimeAvailabilityPromise = null; });
        return libreOfficeRuntimeAvailabilityPromise;
      }

      function updateLibreOfficeRuntimeSummary() {
        if (!libreOfficeRuntimeSummary) return;
        libreOfficeRuntimeSummary.textContent = libreOfficeRuntimeStatus?.installed
          ? detectedRuntimeLabel(libreOfficeRuntimeStatus)
          : t('settings.libreOfficeRuntimeEmpty');
      }

      function renderLibreOfficeRuntime() {
        if (!libreOfficeRuntimeList) return;
        libreOfficeRuntimeList.replaceChildren();
        const row = document.createElement('div'); row.className = 'transcription-model-row';
        const info = document.createElement('div');
        const name = document.createElement('div'); name.className = 'transcription-model-name'; name.textContent = 'LibreOffice';
        const meta = document.createElement('div'); meta.className = 'transcription-model-meta';
        meta.textContent = libreOfficeRuntimeStatus?.installed
          ? runtimeMetadata(libreOfficeRuntimeStatus)
          : (getLang() === 'en' ? 'Required for PPT to PDF and PPT to image' : 'PPT 转 PDF、PPT 转图像所需的本地运行时');
        if (libreOfficeRuntimeProgress?.phase === 'installing') {
          meta.textContent = dependencyInstallingDetail('LibreOffice', libreOfficeRuntimeProgress);
        }
        info.append(name, meta);
        const actions = document.createElement('div'); actions.className = 'transcription-model-actions';
        if (libreOfficeRuntimeProgress && libreOfficeRuntimeProgress.phase !== 'complete') {
          const status = document.createElement('span'); status.className = 'transcription-model-current';
          status.textContent = dependencyStatusText('libreoffice', libreOfficeRuntimeProgress, false);
          actions.append(status);
        } else if (libreOfficeRuntimeStatus?.installed && isManagedRuntime(libreOfficeRuntimeStatus)) {
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'settings-btn'; remove.textContent = getLang() === 'en' ? 'Delete' : '删除';
          remove.addEventListener('click', async () => {
            try {
              const { invoke } = await tauriCorePromise;
              await invoke('delete_libreoffice_runtime');
              libreOfficeRuntimeStatus = null;
              libreOfficeRuntimeStatusAt = 0;
              libreOfficeRuntimeAvailable = null;
              libreOfficeRuntimeAvailabilityAt = 0;
              await refreshLibreOfficeRuntime({ force: true });
            }
            catch (error) { window.showToast?.(String(error?.message || error)); }
          });
          actions.append(remove);
        } else if (libreOfficeRuntimeStatus?.installed) {
          const detected = document.createElement('span'); detected.className = 'transcription-model-current'; detected.textContent = detectedRuntimeLabel(libreOfficeRuntimeStatus);
          actions.append(detected);
        } else {
          const install = document.createElement('button'); install.type = 'button'; install.className = 'settings-btn'; install.textContent = getLang() === 'en' ? 'Download' : '下载';
          install.addEventListener('click', async () => {
            try {
              libreOfficeRuntimeProgress = { phase: 'downloading', downloaded_bytes: 0, total_bytes: 0 }; renderLibreOfficeRuntime();
              const { invoke } = await tauriCorePromise;
              const status = await invoke('download_libreoffice_runtime', { source: resolvedLibreOfficeDownloadSource() });
              libreOfficeRuntimeProgress = null;
              if (status && typeof status === 'object') {
                libreOfficeRuntimeStatus = status;
                libreOfficeRuntimeStatusAt = Date.now();
                cacheLibreOfficeAvailability(Boolean(status.installed), libreOfficeRuntimeStatusAt);
              } else {
                cacheLibreOfficeAvailability(true);
              }
              updateLibreOfficeRuntimeSummary();
              renderLibreOfficeRuntime();
            } catch (error) { libreOfficeRuntimeProgress = null; renderLibreOfficeRuntime(); window.showToast?.(dependencyErrorMessage(error)); }
          });
          actions.append(install);
        }
        row.append(info, actions);
        if (libreOfficeRuntimeProgress && libreOfficeRuntimeProgress.phase !== 'complete') {
          const bar = document.createElement('div'); bar.className = 'transcription-model-progress';
          const fill = document.createElement('span'); const total = Math.max(1, libreOfficeRuntimeProgress.total_bytes || 0);
          fill.style.width = `${Math.min(100, (libreOfficeRuntimeProgress.downloaded_bytes || 0) / total * 100)}%`; bar.append(fill); row.append(bar);
        }
        libreOfficeRuntimeList.append(row);
      }

      async function refreshLibreOfficeRuntime({ force = false } = {}) {
        if (!isTauri) return null;
        const now = Date.now();
        if (!force && libreOfficeRuntimeStatus && now - libreOfficeRuntimeStatusAt < LIBREOFFICE_STATUS_TTL) {
          updateLibreOfficeRuntimeSummary();
          renderLibreOfficeRuntime();
          return libreOfficeRuntimeStatus;
        }
        if (libreOfficeRuntimeStatusPromise) return libreOfficeRuntimeStatusPromise;
        libreOfficeRuntimeStatusPromise = (async () => {
          try {
            const { invoke } = await tauriCorePromise;
            const status = await invoke('get_libreoffice_runtime_status');
            libreOfficeRuntimeStatus = status;
            libreOfficeRuntimeStatusAt = Date.now();
            cacheLibreOfficeAvailability(Boolean(status?.installed), libreOfficeRuntimeStatusAt);
            updateLibreOfficeRuntimeSummary();
            renderLibreOfficeRuntime();
            return status;
          } catch (error) {
            console.error('Cannot read PPT runtime:', error);
            return null;
          }
        })().finally(() => { libreOfficeRuntimeStatusPromise = null; });
        return libreOfficeRuntimeStatusPromise;
      }
      function openLibreOfficeRuntimeManager() { if (!libreOfficeRuntimeOverlay) return; libreOfficeRuntimeOverlay.classList.add('visible'); libreOfficeRuntimeOverlay.setAttribute('aria-hidden', 'false'); void refreshLibreOfficeRuntime({ force: true }); }
      function closeLibreOfficeRuntimeManager() { libreOfficeRuntimeOverlay?.classList.remove('visible'); libreOfficeRuntimeOverlay?.setAttribute('aria-hidden', 'true'); }
      manageLibreOfficeRuntime?.addEventListener('click', openLibreOfficeRuntimeManager);
      libreOfficeRuntimeClose?.addEventListener('click', closeLibreOfficeRuntimeManager);
      libreOfficeRuntimeOverlay?.addEventListener('click', event => { if (event.target === libreOfficeRuntimeOverlay) closeLibreOfficeRuntimeManager(); });
      libreOfficeRuntimeSourceOptions?.querySelectorAll('[data-source]').forEach(button => {
        button.classList.toggle('active', button.dataset.source === libreOfficeRuntimeSource);
        button.addEventListener('click', () => { libreOfficeRuntimeSource = button.dataset.source || 'auto'; localStorage.setItem(LIBREOFFICE_SOURCE_KEY, libreOfficeRuntimeSource); libreOfficeRuntimeSourceOptions.querySelectorAll('[data-source]').forEach(item => item.classList.toggle('active', item === button)); });
      });
      if (isTauri) {
        // The settings panel performs the detailed refresh on demand. Do not
        // start a recursive runtime-directory scan during app bootstrap.
        (async () => { const { listen } = await tauriEventPromise; await listen('libreoffice-runtime-download-progress', event => { libreOfficeRuntimeProgress = event.payload; renderLibreOfficeRuntime(); updateDependencyGateProgress('libreoffice', event.payload); }); })().catch(error => console.error('Cannot listen for PPT runtime download:', error));
      }

      function resolvedLibreOfficeDownloadSource() {
        if (libreOfficeRuntimeSource !== 'auto') return libreOfficeRuntimeSource;
        return getLang() === 'en' ? 'auto-official' : 'auto-china';
      }

      async function ensurePptRuntimeAvailable() {
        if (!isTauri) return false;
        // Export is the last user-visible gate, so refresh the cheap boolean
        // check in case the runtime was removed outside ToolKnit meanwhile.
        if (await checkLibreOfficeRuntimeAvailable({ force: true })) return true;
        showDependencyGate({ openFn: () => {}, needsFfmpeg: false, needsModel: false, needsLibreOffice: true });
        throw new Error('ppt-render:runtime-missing');
      }

      function resolvedFfmpegDownloadSource() {
        if (ffmpegRuntimeSource !== 'auto') return ffmpegRuntimeSource;
        return getLang() === 'en' ? 'auto-official' : 'auto-china';
      }

      function resolvedModelDownloadSource() {
        if (transcriptionDownloadSource !== 'auto') return transcriptionDownloadSource;
        return getLang() === 'en' ? 'official' : 'china';
      }

      // Shared dependency helpers own the field mapping and progress labels.

      function renderDependencyGate() {
        const state = dependencyGateState;
        if (!state || !dependencyGateList) return;
        if (dependencyGateOverlay && state.taskSnapshot) {
          dependencyGateOverlay.dataset.taskState = state.taskSnapshot.state;
          dependencyGateOverlay.dataset.taskId = state.taskSnapshot.task_id;
        }
        const isMatting = state.modelKind === 'matting';
        const isTranscription = state.needsModel && !isMatting;
        const isPpt = state.needsLibreOffice;
        if (dependencyGateTitle) dependencyGateTitle.textContent = t(isMatting ? 'home.dependencies.mattingTitle' : (isTranscription ? 'home.dependencies.transcriptionTitle' : (isPpt ? 'home.dependencies.pptTitle' : 'home.dependencies.title')));
        if (dependencyGateDesc) dependencyGateDesc.textContent = t(isMatting ? 'home.dependencies.mattingDesc' : (isTranscription ? 'home.dependencies.transcriptionDesc' : (isPpt ? 'home.dependencies.pptDesc' : 'home.dependencies.desc')));
        dependencyGateList.replaceChildren();
        const appendItem = (type, label, size, progress, complete) => {
          const row = document.createElement('div');
          row.className = 'audio-convert-success-row dependency-gate-row';
          const key = document.createElement('span'); key.className = 'audio-convert-success-key'; key.textContent = `${label} · ${size}`;
          const value = document.createElement('span'); value.className = 'audio-convert-success-value'; value.textContent = dependencyStatusText(type, progress, complete, Boolean(state.error && state.current === type));
          value.dataset.state = complete || progress?.phase === 'complete' ? 'ready' : (progress ? 'active' : 'waiting');
          row.append(key, value); dependencyGateList.append(row);
        };
        if (state.needsFfmpeg) appendItem('ffmpeg', 'FFmpeg', '29 MB', state.ffmpegProgress, state.ffmpegComplete);
        if (state.needsModel) appendItem('model', state.modelLabel || 'Whisper Small', state.modelSizeText || '465 MB', state.modelProgress, state.modelComplete);
        if (state.needsLibreOffice) appendItem('libreoffice', 'LibreOffice', '356 MB', state.libreOfficeProgress, state.libreOfficeComplete);

        const overall = overallDependencyProgress(state);
        const currentProgress = state.current === 'model'
          ? state.modelProgress
          : (state.current === 'libreoffice' ? state.libreOfficeProgress : state.ffmpegProgress);
        const currentPhase = currentProgress?.phase || '';
        const isPostDownload = currentPhase === 'installing' || currentPhase === 'verifying';
        if (dependencyGateProgress) dependencyGateProgress.hidden = !state.downloading;
        if (dependencyGateProgress) dependencyGateProgress.dataset.indeterminate = isPostDownload ? 'true' : 'false';
        if (dependencyGateProgressFill) dependencyGateProgressFill.style.width = isPostDownload ? '34%' : `${overall}%`;
        if (dependencyGateProgressText) {
          const currentName = state.current === 'model' ? (state.modelLabel || 'Whisper Small') : (state.current === 'libreoffice' ? 'LibreOffice' : 'FFmpeg');
          dependencyGateProgressText.textContent = state.cancelling
            ? t('home.dependencies.cancelling')
            : (currentPhase === 'installing'
              ? dependencyInstallingDetail(currentName, currentProgress)
              : (currentPhase === 'verifying'
                ? t('home.dependencies.verifyingDetail', { name: currentName })
                : `${t('home.dependencies.current')}${currentName} · ${overall}%`));
        }
        if (dependencyGateError) {
          dependencyGateError.hidden = !state.error;
          dependencyGateError.textContent = state.error || '';
        }
        if (dependencyGateCancel) dependencyGateCancel.textContent = state.cancelling ? t('home.dependencies.cancelling') : t('home.dependencies.cancel');
        if (dependencyGateInstall) {
          dependencyGateInstall.textContent = state.downloading ? t('home.dependencies.downloadingAll') : t('home.dependencies.installAll');
          dependencyGateInstall.disabled = state.downloading;
        }
      }

      function updateDependencyGateProgress(type, progress) {
        if (updateDependencyProgress(dependencyGateState, type, progress)) renderDependencyGate();
      }

      function showDependencyGate({ openFn, needsFfmpeg, needsModel, needsLibreOffice, modelKind, modelLabel, modelSizeText }) {
        dependencyGateState = {
          openFn,
          needsFfmpeg: Boolean(needsFfmpeg),
          needsModel: Boolean(needsModel),
          needsLibreOffice: Boolean(needsLibreOffice),
          modelKind: modelKind === 'matting' ? 'matting' : 'transcription',
          modelLabel: modelLabel || 'Whisper Small',
          modelSizeText: modelSizeText || '465 MB',
          ffmpegProgress: null,
          modelProgress: null,
          libreOfficeProgress: null,
          ffmpegComplete: !needsFfmpeg,
          modelComplete: !needsModel,
          libreOfficeComplete: !needsLibreOffice,
          current: needsFfmpeg ? 'ffmpeg' : (needsModel ? 'model' : 'libreoffice'),
          downloading: false,
          cancelling: false,
          cancelled: false,
          error: '',
          runner: null,
          taskSnapshot: null
        };
        renderDependencyGate();
        dependencyGateOverlay?.classList.add('visible');
        dependencyGateOverlay?.setAttribute('aria-hidden', 'false');
        if (window.lucide) window.lucide.createIcons();
      }

      function closeDependencyGate(force = false) {
        if (dependencyGateState?.downloading && !force) return;
        dependencyGateOverlay?.classList.remove('visible');
        dependencyGateOverlay?.setAttribute('aria-hidden', 'true');
        dependencyGateState = null;
      }

      async function installDependencyGateRequirements() {
        const state = dependencyGateState;
        if (!state || state.downloading || !isTauri) return;
        state.downloading = true;
        state.error = '';
        renderDependencyGate();
        const runner = new TaskRunner({
          tool: 'dependencies.install',
          onEvent(event) {
            if (dependencyGateState !== state) return;
            state.taskSnapshot = event;
            renderDependencyGate();
          },
          onCancel: async () => {
            try {
              const { invoke } = await tauriCorePromise;
              await invoke('cancel_dependency_downloads');
            } catch (error) {
              console.error('Cannot cancel dependency download:', error);
            }
          }
        });
        state.runner = runner;
        try {
          const { invoke } = await tauriCorePromise;
          await runner.run(async ({ report, throwIfCancelled }) => {
            report(0, t('home.dependencies.downloadingAll'), { phase: 'prepare' });
            if (state.needsFfmpeg) {
              state.current = 'ffmpeg'; renderDependencyGate();
              report(8, 'FFmpeg', { phase: 'ffmpeg' });
              if (!await ensureFfmpegAvailable()) await invoke('download_ffmpeg_runtime', { source: resolvedFfmpegDownloadSource() });
              throwIfCancelled();
              state.ffmpegComplete = true; state.ffmpegProgress = { phase: 'complete', downloaded_bytes: 1, total_bytes: 1 };
              ffmpegRuntimeProgress = null;
              await refreshFfmpegRuntime();
              report(state.needsModel ? 50 : 96, 'FFmpeg', { phase: 'ffmpeg-complete' });
            }
            if (state.needsModel) {
              state.current = 'model'; renderDependencyGate();
              if (state.modelKind === 'matting') {
                report(8, state.modelLabel, { phase: 'model' });
                const unlistenMatting = await tauriEventPromise.then(({ listen }) => listen('matting-model-progress', event => {
                  state.modelProgress = event?.payload || null;
                  renderDependencyGate();
                }));
                try {
                  throwIfCancelled();
                  await installMattingModel(mattingDownloadSource);
                  throwIfCancelled();
                } finally {
                  try { unlistenMatting(); } catch {}
                }
                state.modelComplete = true;
                state.modelProgress = { phase: 'complete', downloaded_bytes: 1, total_bytes: 1 };
                renderDependencyGate();
                report(96, state.modelLabel, { phase: 'model-complete' });
              } else {
              report(state.needsFfmpeg ? 52 : 8, 'Whisper Small', { phase: 'model' });
              await refreshTranscriptionModels();
              if (!activeTranscriptionModel()) {
                const small = transcriptionModels.find(model => model.id === 'small');
                state.modelProgress = { phase: 'downloading', downloaded_bytes: 0, total_bytes: small?.bytes || 487_601_967 };
                renderDependencyGate();
                await invoke('download_transcription_model', { modelId: 'small', source: resolvedModelDownloadSource() });
                await invoke('set_current_transcription_model', { modelId: 'small' });
              }
              throwIfCancelled();
              state.modelComplete = true; state.modelProgress = { phase: 'complete', downloaded_bytes: 1, total_bytes: 1 };
              transcriptionModelProgress.delete('small');
              await refreshTranscriptionModels();
              report(96, 'Whisper Small', { phase: 'model-complete' });
              }
            }
            if (state.needsLibreOffice) {
              state.current = 'libreoffice'; renderDependencyGate();
              report(state.needsFfmpeg || state.needsModel ? 97 : 8, 'LibreOffice', { phase: 'libreoffice' });
              const available = await checkLibreOfficeRuntimeAvailable({ force: true });
              if (!available) {
                const pptRuntime = await invoke('download_libreoffice_runtime', { source: resolvedLibreOfficeDownloadSource() });
                if (pptRuntime && typeof pptRuntime === 'object') {
                  libreOfficeRuntimeStatus = pptRuntime;
                  libreOfficeRuntimeStatusAt = Date.now();
                  cacheLibreOfficeAvailability(Boolean(pptRuntime.installed), libreOfficeRuntimeStatusAt);
                } else {
                  cacheLibreOfficeAvailability(true);
                }
              }
              throwIfCancelled();
              state.libreOfficeComplete = true;
              state.libreOfficeProgress = { phase: 'complete', downloaded_bytes: 1, total_bytes: 1 };
              libreOfficeRuntimeProgress = null;
              updateLibreOfficeRuntimeSummary();
              renderLibreOfficeRuntime();
              report(96, 'LibreOffice', { phase: 'libreoffice-complete' });
            }
            return true;
          });
          const openFn = state.openFn;
          state.downloading = false;
          renderDependencyGate();
          closeDependencyGate(true);
          await openFn?.();
        } catch (error) {
          const message = String(error?.message || error || '');
          ffmpegRuntimeProgress = null;
          transcriptionModelProgress.delete('small');
          if (state.cancelled || error?.code === 'CANCELLED' || message.includes('dependency-download:cancelled')) {
            state.downloading = false;
            closeDependencyGate(true);
            return;
          }
          state.downloading = false;
          state.cancelling = false;
          libreOfficeRuntimeProgress = null;
          state.error = `${t('home.dependencies.failed')} ${dependencyErrorMessage(error)}`.trim();
          renderFfmpegRuntime();
          renderTranscriptionModels();
          renderLibreOfficeRuntime();
          renderDependencyGate();
        }
      }

      dependencyGateInstall?.addEventListener('click', () => { void installDependencyGateRequirements(); });
      dependencyGateCancel?.addEventListener('click', async () => {
        const state = dependencyGateState;
        if (!state) return;
        if (!state.downloading) { closeDependencyGate(); return; }
        state.cancelled = true;
        state.cancelling = true;
        renderDependencyGate();
        await state.runner?.cancel(t('home.dependencies.cancelling'));
      });

      // The model/runtime managers stay in the settings surface and therefore
      // remain global; keep their labels synchronized even while transcription
      // itself is lazy-loaded.
      onLangChange(() => {
        updateOfflineModelSummary();
        renderTranscriptionModels();
        updateFfmpegRuntimeSummary();
        renderFfmpegRuntime();
        renderDependencyGate();
      });

      function resetSettingsChildOverlays() {
        // Settings owns nested dependency dialogs; clear stale visibility before opening the parent.
        settingsOverlay?.querySelectorAll?.('[id$="Overlay"]').forEach(region => {
          if (!region.classList.contains('visible') && region.getAttribute('aria-hidden') !== 'false') return;
          moveFocusOutOfHiddenRegion(region);
          region.classList.remove('visible');
          region.setAttribute('aria-hidden', 'true');
          region.inert = true;
          region.setAttribute('inert', '');
        });
      }

      function showSettingsOverlay() {
        if (!settingsOverlay) return;
        resetSettingsChildOverlays();
        document.querySelectorAll('[id$="Overlay"].visible').forEach(region => {
          if (region !== settingsOverlay) moveFocusOutOfHiddenRegion(region);
        });
        document.getElementById('helpOverlay')?.classList.remove('visible');
        if (settingsContent) settingsContent.scrollTop = 0;
        settingsOverlay.style.zIndex = '50000';
        settingsOverlay.classList.add('visible');
        settingsOverlay.removeAttribute('inert');
        settingsOverlay.setAttribute('aria-hidden', 'false');
        window.requestAnimationFrame(() => {
          if (settingsOverlay.classList.contains('visible')) settingsBack?.focus?.({ preventScroll: true });
        });
        syncCustomBackgroundPreviewPlayback?.();
      }

      function openSettingsOverlay() {
        return pageTransition.run(showSettingsOverlay);
      }

      function closeSettingsOverlay() {
        return pageTransition.run(() => {
          resetSettingsChildOverlays();
          moveFocusOutOfHiddenRegion(settingsOverlay);
          settingsOverlay?.classList.remove('visible');
          if (settingsOverlay) settingsOverlay.style.zIndex = '';
          syncCustomBackgroundPreviewPlayback?.();
        });
      }

      if (settingsBtns.length && settingsOverlay) {
        settingsBtns.forEach(settingsBtn => settingsBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openSettingsOverlay();
        }));
      }

      if (settingsBack && settingsOverlay) {
        settingsBack.addEventListener('click', () => { void closeSettingsOverlay(); });
      }

      const helpCenterRuntime = createHelpCenterRuntime({
        root: document,
        windowRef: window,
        translate: t,
        getLanguage: getLang,
        onLangChange,
        getHelpContent,
        getLegalContent,
        escapeHtml,
        initLightRays,
        getTheme: themeRuntime.get,
        onThemeChange: themeRuntime.subscribe,
        settingsOverlay,
        settingsContent,
        pageTransition,
        syncCustomBackgroundPreviewPlayback
      });
      const {
        openFeedbackOverlay,
        openHelpOverlay,
        openLegalOverlay,
        showHelpSection,
        showLegalSection
      } = helpCenterRuntime;

      const aiSettingsRuntime = createAiSettingsRuntime({
        root: document,
        storage: localStorage,
        windowRef: window,
        aiKeyStore,
        aiApiKeyReady,
        translate: t,
        onOpenSettings: openSettingsOverlay
      });
      const {
        getAiPlatformConfig,
        hasAiApiKey,
        openToolWithAiCheck,
        showAiKeyRequiredOverlay
      } = aiSettingsRuntime;

      const externalLinksRuntime = createExternalLinksRuntime({
        root: document,
        storage: localStorage,
        windowRef: window,
        isTauri,
        tauriCorePromise,
        readResponseTextLimited,
        translate: t,
        onOpenHelp: openHelpOverlay
      });
      const openExternalUrl = externalLinksRuntime.openExternalUrl;
      const donationController = createDonationController({ openExternalUrl });
      // Tool overlays are mounted lazily and still contain both current and
      // legacy chrome attributes. Keep one capture-phase owner so every page
      // has working top actions without duplicating feature listeners.
      bindGlobalToolPageChrome({
        root: document,
        onWebsite: () => { void openExternalUrl('https://toolknit.com'); },
        onSupport: () => { void donationController.open(); },
        onSettings: () => openSettingsOverlay(),
        onToolBack: ({ overlay }) => lazyFeatureRegistry?.closeFromChrome(overlay) ?? false,
        onWindowAction: action => { void handleWindowControlAction(action); }
      });
      void externalLinksRuntime.loadGithubActivity();

      // ===== PDF Tool Template Overlay Background =====
      const pdfToolTemplateOverlay = document.getElementById('pdfToolTemplateOverlay');
      const pdfToolTemplatePlasmaBg = document.getElementById('pdfToolTemplatePlasmaBg');
      const pdfToolTemplateBack = document.getElementById('pdfToolTemplateBack');
      let pdfToolTemplatePlasmaInstance = null;

      function openPdfToolTemplateOverlay() {
        if (!pdfToolTemplateOverlay) return;
        pdfToolTemplateOverlay.classList.add('visible');
        if (pdfToolTemplatePlasmaBg && !pdfToolTemplatePlasmaInstance) {
          pdfToolTemplatePlasmaInstance = initStandardToolPlasma(pdfToolTemplatePlasmaBg);
        }
      }

      function closePdfToolTemplateOverlay() {
        if (!pdfToolTemplateOverlay) return;
        pdfToolTemplateOverlay.classList.remove('visible');
        pdfToolTemplatePlasmaInstance = disposeStandardToolPlasma(pdfToolTemplatePlasmaInstance);
      }

      window.openPdfToolTemplateOverlay = openPdfToolTemplateOverlay;
      pdfToolTemplateBack?.addEventListener('click', closePdfToolTemplateOverlay);

      const callDeepSeek = createAiRequestRuntime({
        getApiKey: getAiApiKey,
        getConfig: getAiPlatformConfig,
        translate: t,
        isTauri
      });





      const homeExplorerRuntime = createHomeExplorerRuntime({
        root: document,
        storage: localStorage,
        translate: t,
        escapeHtml,
        createIcons: () => createIcons({ icons }),
        onLaunchTool: launchToolFromHome,
        onOpenSupport: donationController.open
      });
      const renderHomeTools = homeExplorerRuntime.renderHomeTools;
      const renderFavorites = homeExplorerRuntime.renderFavorites;
      onLangChange(() => {
        renderHomeTools({ resetPagination: true });
        renderFavorites();
      });

      // ===== Lazy feature tools (2.1) =====
      let mattingManagerRenderQueued = false;
      let mattingDownloadSource = 'auto';
      const mattingManagerDownloads = new Map();
      let mattingDownloadPromise = null;
      if (isTauri) {
        void tauriEventPromise
          .then(({ listen }) => listen('matting-model-progress', event => {
            const payload = event?.payload || {};
            if (payload.model_id) {
              mattingManagerDownloads.set(payload.model_id, payload.total_bytes ? Math.round(payload.downloaded_bytes / payload.total_bytes * 100) : 0);
              queueMattingManagerRender();
            }
          }))
          .catch(error => console.error('Cannot listen for matting model progress:', error));
      }

      function settingsOverlayVisible() {
        return Boolean(settingsOverlay?.classList.contains('visible'));
      }

      function queueMattingManagerRender() {
        if (mattingManagerRenderQueued) return;
        mattingManagerRenderQueued = true;
        requestAnimationFrame(() => {
          mattingManagerRenderQueued = false;
          void renderMattingModelManager();
        });
      }

      async function installMattingModel(source = 'auto') {
        if (mattingDownloadPromise) return mattingDownloadPromise;
        const operation = (async () => {
          const { invoke } = await tauriCorePromise;
          await invoke('download_matting_model', { modelId: 'modnet', source });
          await invoke('set_current_matting_model', { modelId: 'modnet' });
        })();
        mattingDownloadPromise = operation;
        mattingManagerDownloads.set('modnet', 0);
        queueMattingManagerRender();
        try {
          await operation;
        } finally {
          if (mattingDownloadPromise === operation) mattingDownloadPromise = null;
          mattingManagerDownloads.delete('modnet');
          document.dispatchEvent(new CustomEvent('toolknit:matting-models-changed'));
          queueMattingManagerRender();
        }
      }

      let mattingManagerOpenRequest = 0;

      function showMattingModelManager(request) {
        if (request !== mattingManagerOpenRequest || !settingsOverlay?.classList.contains('visible')) return;
        const overlayEl = document.getElementById('mattingModelOverlay');
        overlayEl?.classList.add('visible');
        overlayEl?.setAttribute('aria-hidden', 'false');
        queueMattingManagerRender();
        if (window.lucide) window.lucide.createIcons();
      }

      function openMattingModelManager() {
        const request = ++mattingManagerOpenRequest;
        // This control lives inside settings. Avoid routing a nested dialog
        // through the page transition, which creates a close/reopen race.
        if (settingsOverlay?.classList.contains('visible')) {
          showMattingModelManager(request);
          return;
        }
        void openSettingsOverlay().then(() => showMattingModelManager(request));
      }

      function closeMattingModelManager() {
        mattingManagerOpenRequest += 1;
        const overlayEl = document.getElementById('mattingModelOverlay');
        overlayEl?.classList.remove('visible');
        overlayEl?.setAttribute('aria-hidden', 'true');
      }

      function wireMattingModelManager() {
        const manageButton = document.getElementById('manageMattingModelsBtn');
        manageButton?.addEventListener('click', () => openMattingModelManager());
        document.getElementById('mattingModelClose')?.addEventListener('click', () => closeMattingModelManager());
        const overlayEl = document.getElementById('mattingModelOverlay');
        overlayEl?.addEventListener('click', event => {
          if (event.target === overlayEl) closeMattingModelManager();
        });
        document.getElementById('mattingModelOverlay')?.addEventListener('keydown', event => {
          if (event.key === 'Escape') closeMattingModelManager();
        });
        document.querySelectorAll('#mattingSourceOptions .audio-convert-format-option').forEach(option => {
          option.addEventListener('click', () => {
            document.querySelectorAll('#mattingSourceOptions .audio-convert-format-option').forEach(item => item.classList.remove('active'));
            option.classList.add('active');
            mattingDownloadSource = option.dataset.source || 'auto';
          });
        });
        manageButton && renderMattingModelStatus();
      }
      wireMattingModelManager();

      async function renderMattingModelStatus() {
        const status = document.getElementById('mattingModelStatus');
        if (!status || !isTauri) return;
        try {
          const { invoke } = await tauriCorePromise;
          const models = await invoke('list_matting_models');
          const current = models.find(model => model.current && model.installed);
          status.textContent = current
            ? t('settings.mattingStatusCurrent', { name: current.display_name })
            : t('settings.mattingStatusNone');
        } catch (error) {
          status.textContent = t('settings.mattingStatusNone');
        }
      }

      async function renderMattingModelManager() {
        const list = document.getElementById('mattingModelList');
        if (!list) return;
        try {
          const { invoke } = await tauriCorePromise;
          const models = await invoke('list_matting_models');
          list.replaceChildren();
          models.forEach(model => {
            const row = document.createElement('div');
            row.className = 'transcription-model-row';
            const info = document.createElement('div');
            const name = document.createElement('div');
            name.className = 'transcription-model-name';
            name.textContent = model.display_name;
            const meta = document.createElement('div');
            meta.className = 'transcription-model-meta';
            const progress = mattingManagerDownloads.get(model.id);
            meta.textContent = progress !== undefined
              ? progress + '%'
              : Math.round(model.bytes / 1024 / 1024) + ' MB';
            info.append(name, meta);
            const actions = document.createElement('div');
            actions.className = 'transcription-model-actions';
            const makeButton = (label, handler) => {
              const button = document.createElement('button');
              button.type = 'button';
              button.className = 'settings-btn';
              button.textContent = label;
              button.addEventListener('click', async () => {
                if (button.disabled) return;
                button.disabled = true;
                try {
                  await handler();
                } catch (error) {
                  console.error('[BgRemoval] matting model action failed:', error);
                  window.showToast?.(t('settings.mattingActionFailed'));
                } finally {
                  button.disabled = false;
                  queueMattingManagerRender();
                }
              });
              return button;
            };
            const done = () => {
              document.dispatchEvent(new CustomEvent('toolknit:matting-models-changed'));
              void renderMattingModelManager();
            };
            if (progress !== undefined) {
              const status = document.createElement('span');
              status.className = 'transcription-model-current';
              status.textContent = progress + '%';
              actions.append(status);
            } else if (model.installed) {
              if (!model.current) {
                actions.append(makeButton(t('home.transcription.useModel'), async () => {
                  await invoke('set_current_matting_model', { modelId: model.id });
                  done();
                }));
              }
              actions.append(makeButton(t('home.transcription.deleteModel'), async () => {
                await invoke('delete_matting_model', { modelId: model.id });
                done();
              }));
            } else {
              actions.append(makeButton(t('settings.mattingDownload'), async () => {
                await installMattingModel(mattingDownloadSource);
                done();
              }));
            }
            row.append(info, actions);
            list.append(row);
          });
          await renderMattingModelStatus();
        } catch (error) {
          console.error('[BgRemoval] matting manager render failed:', error);
        }
      }

      async function requestMattingModelGate(onReady) {
        if (!isTauri) return true;
        let installed = false;
        try {
          const { invoke } = await tauriCorePromise;
          const models = await invoke('list_matting_models');
          installed = Array.isArray(models) && models.some(model => model.installed);
        } catch (error) {
          console.error('[BgRemoval] model check failed:', error);
        }
        if (installed) {
          return true;
        }
        showDependencyGate({
          openFn: async () => {
            try {
              const { invoke } = await tauriCorePromise;
              const models = await invoke('list_matting_models');
              if (Array.isArray(models) && models.some(model => model.installed)) await onReady?.();
            } catch (error) {
              console.error('[BgRemoval] gate reopen failed:', error);
            }
          },
          needsFfmpeg: false,
          needsModel: true,
          modelKind: 'matting',
          modelLabel: 'MODNet 人像精修',
          modelSizeText: '24.7 MB'
        });
        if (mattingDownloadPromise) void installDependencyGateRequirements();
        return false;
      }

      async function requestTeleprompterOfflineModel(onReady) {
        if (!isTauri) {
          window.showToast?.(t('home.teleprompter.desktopOnly'));
          return false;
        }
        await refreshTranscriptionModels();
        if (activeTranscriptionModel()) return true;
        showDependencyGate({
          openFn: async () => {
            await refreshTranscriptionModels();
            await onReady?.();
          },
          needsFfmpeg: false,
          needsModel: true,
          needsLibreOffice: false
        });
        return false;
      }

      const isAiDocEditorDemoEntry = import.meta.env.DEV
        && new URLSearchParams(window.location.search).get('ai-doc-editor-demo') === '1';
      const isAiTableDemoEntry = import.meta.env.DEV
        && new URLSearchParams(window.location.search).get('ai-table-demo') === '1';
      lazyFeatureRegistry = createLazyToolRegistry({
        specs: LAZY_TOOL_SPECS,
        root: document,
        // Lazy templates are appended after the initial Lucide document scan.
        // The registry uses this fallback immediately after mounting; feature
        // contexts still receive the same callback for post-initialization UI.
        refreshIcons: () => createIcons({ icons }),
        pageTransition,
        beforeOpen: async (toolId, retryOpen) => {
          if (toolId === 'ai-polish' || toolId === 'ai-translate'
            || toolId === 'ai-doc' || toolId === 'ai-table') {
            if ((toolId === 'ai-doc' && isAiDocEditorDemoEntry)
              || (toolId === 'ai-table' && isAiTableDemoEntry)) return true;
            await aiApiKeyReady;
            if (!hasAiApiKey()) {
              showAiKeyRequiredOverlay();
              return false;
            }
          }
          if (toolId === 'transcription' && isTauri) {
            const { invoke } = await tauriCorePromise;
            const [engineReady, ffmpegReady] = await Promise.all([
              invoke('check_transcription_engine'),
              ensureFfmpegAvailable()
            ]);
            if (!engineReady) {
              window.showToast?.(t('home.transcription.engineUnavailable'));
              return false;
            }
            await refreshTranscriptionModels();
            const modelReady = Boolean(activeTranscriptionModel());
            if (!ffmpegReady || !modelReady) {
              showDependencyGate({
                openFn: retryOpen,
                needsFfmpeg: !ffmpegReady,
                needsModel: !modelReady,
                needsLibreOffice: false
              });
              return false;
            }
          }
          if ((toolId === 'teleprompter' || toolId === 'bg-removal') && isTauri) {
            // AI tools that depend on on-demand models gate at the home card:
            // no model, no tool page (dependencies install, then entry resumes).
            const ready = toolId === 'teleprompter'
              ? await requestTeleprompterOfflineModel(() => {
                  void retryOpen();
                })
              : await requestMattingModelGate(() => {
                  void retryOpen();
                });
            return ready;
          }
          if ((toolId === 'audio-extract' || toolId === 'convert' || toolId === 'audio-clip'
            || toolId === 'video-convert' || toolId === 'video-frame' || toolId === 'video-gif') && isTauri) {
            const ready = await ensureFfmpegAvailable();
            if (!ready) {
              showDependencyGate({
                openFn: retryOpen,
                needsFfmpeg: true,
                needsModel: false,
                needsLibreOffice: false
              });
              return false;
            }
          }
          return true;
        },
        createContext: () => {
          // Lazy templates are appended after the initial window chrome pass.
          // Repair their drag region before the feature can receive input so
          // native dragging never swallows topbar button clicks.
          initNativeWindowDragRegions();
          return {
          notify: (message, options) => window.showToast?.(message, options),
          isTauri,
          t,
          getLang,
          onLangChange,
          pdfWorkerUrl,
          readTextDocument: readTextStatsDocument,
          formatFileSize,
          displayFilesystemPath,
           requestOfflineModel: requestTeleprompterOfflineModel,
           requestAi: callDeepSeek,
           getAiApiKey,
           getAiPlatformConfig,
           requestAiKeyConfiguration: showAiKeyRequiredOverlay,
           extractJson,
           refreshTranscriptionModels,
           activeTranscriptionModel,
           showDependencyGate,
          refreshIcons: () => createIcons({ icons }),
          openHelp: openHelpOverlay,
          initStandardToolPlasma,
          disposeStandardToolPlasma,
          getOutputDir,
          ensureFfmpegAvailable,
          openOutputFolder,
          ensureLibreOfficeAvailable: ensurePptRuntimeAvailable,
          checkLibreOfficeAvailable: checkLibreOfficeRuntimeAvailable,
          requestLibreOfficeRuntime: openFn => showDependencyGate({ openFn, needsFfmpeg: false, needsModel: false, needsLibreOffice: true }),
          openLazyTool: toolId => lazyFeatureRegistry.open(toolId),
          continueToDraft: async (outline, sourceLabel) => {
            const instance = await lazyFeatureRegistry.open('ppt-draft');
            const importOutline = instance?.raw?.importOutline || instance?.importOutline;
            if (typeof importOutline !== 'function') return false;
            return Boolean(importOutline(outline, sourceLabel));
          },
          openSettings: openSettingsOverlay,
          openMattingModelManager,
          openSupport: donationController.open,
          openExternalUrl,
          syncWindowFrameAfterLayoutChange,
          handleWindowAction: handleWindowControlAction
          };
        },
        onError: (error, toolId) => {
          console.error(`Cannot open ${toolId}:`, error);
          window.showToast?.(getLang() === 'zh' ? `工具加载失败：${String(error?.message || error)}` : `Failed to load tool: ${String(error?.message || error)}`);
        }
      });
      lazyFeatureRegistry.bind();
      // Keep the global screen-picker shortcut available before the color
      // feature is opened for the first time. The heavy picker UI remains
      // lazy, while the sampled payload is replayed after the feature mounts.
      if (isTauri && !isScreenPickerWindow) {
        void tauriEventPromise.then(({ listen }) => listen('screen-color-picked', event => {
          if (lazyFeatureRegistry.activeToolId === 'color-extractor') return;
          const payload = event?.payload;
          void lazyFeatureRegistry.open('color-extractor').then(() => {
            window.dispatchEvent(new CustomEvent('toolknit:screen-color-picked', { detail: payload }));
          });
        })).then(unlisten => {
          window.addEventListener('pagehide', () => unlisten?.(), { once: true });
        }).catch(error => console.warn('[screen-picker] bridge listener failed:', error));
      }
      if (isAiDocEditorDemoEntry) void lazyFeatureRegistry.open('ai-doc');
      if (isAiTableDemoEntry) void lazyFeatureRegistry.open('ai-table');

      updatePreviewController = initUpdatePreview({
        openExternalUrl,
        notify: message => window.showToast?.(message),
        refreshBackgroundRendering: syncHomeV2Background,
        refreshIcons: () => createIcons({ icons }),
        onUpdate: async release => {
          // The updater public key is not configured yet. Keep the current
          // release action honest: it opens the verified GitHub Release where
          // the installer and its SHA-256 checksum are published together.
          await openExternalUrl(release.htmlUrl || UPDATE_RELEASES_PAGE);
        },
        onDefer: release => updateService.defer(release.version)
      });

      function scheduleAutomaticUpdateCheck() {
        if (!isTauri) return;
        const checkWhenIdle = () => {
          if (document.hidden || !appRoot?.classList.contains('is-v2-home')) return;
          void runVersionUpdateCheck({ force: false, showUpdate: false }).then(result => {
            if (!result) return;
            void getLocalAppVersion().then(localVersion => {
              if (updateService.shouldPrompt(result, localVersion)) {
                updatePreviewController?.open({ ...result.release, currentVersion: localVersion });
              }
            });
          });
        };
        window.setTimeout(() => {
          if ('requestIdleCallback' in window) {
            window.requestIdleCallback(checkWhenIdle, { timeout: 3_000 });
          } else {
            checkWhenIdle();
          }
        }, 5_000);
      }

scheduleAutomaticUpdateCheck();

      createStartupRuntime({
        fontsReady: fontSettingsRuntime.ready,
        backgroundReady: isScreenPickerWindow ? Promise.resolve() : backgroundRuntime.whenHomeReady()
      });
