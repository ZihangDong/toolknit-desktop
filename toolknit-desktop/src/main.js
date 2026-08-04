      import { getCurrentWindow } from '@tauri-apps/api/window';
      import { createIcons, icons } from 'lucide';
      import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
      import { initDarkVeil } from './darkveil.js';
      import { initLightRays } from './lightrays.js';
      import { initPlasma } from './plasma.js';
      import { initFerrofluid } from './ferrofluid.js';
      import { initDither } from './dither.js';
      import { getLang, setLang, applyTranslations, onLangChange, t } from './i18n.js';
      import typingWordsData from './data/typing-words.json';
      import { HELP_CONTENT, getHelpContent } from './help-data.js';
      import { getLegalContent } from './legal-data.js';
      import { AiProviderError, normalizeAiProviderConfig, requestAiCompletion } from './ai-provider-core.js';
      import {
        AI_DOC_LIMITS,
        AiDocLayoutError,
        assertAiDocImageBudget,
        cloneAiDocLayout,
        compactAiDocHistoryMessage,
        ensureAiDocEditorIds,
        isSupportedAiDocImage,
        moveAiDocRegionInFlow,
        normalizeAiDocLayout
      } from './ai-doc-core.js';
      import { buildAiDocPdf } from './ai-doc-pdf-core.js';
      import {
        AI_TABLE_LIMITS,
        AiTableDataError,
        assertAiTableTextBudget,
        compactAiTableHistoryMessage,
        isAiTableResponseReady,
        makeAiTableCsv,
        normalizeAiTableData,
        normalizeAiTableSheetName,
        parseAiTableNumber,
        safeSpreadsheetCellValue
      } from './ai-table-core.js';
      import {
        AI_TRANSLATE_LIMITS,
        AiTranslateError,
        aiTranslateOriginalsMatch,
        detectAiTranslateSourceLanguage,
        normalizeAiTranslatePairs
      } from './ai-translate-core.js';
      import {
        AI_POLISH_LIMITS,
        AiPolishError,
        normalizeAiPolishedText,
        normalizeAiPolishDirections
      } from './ai-polish-core.js';
      import {
        TEXT_FORMAT_LIMITS,
        TextFormatError,
        executeTextFormat
      } from './text-format-core.js';
      import {
        TEXT_STATS_LIMITS,
        calculateTextStats
      } from './text-stats-core.js';
      import {
        assessPasswordStrength,
        generatePassword as generateSecurePassword
      } from './password-core.js';
      import {
        COLOR_EXTRACTOR_LIMITS,
        assertColorExtractorImageBytes,
        assertColorExtractorDimensions,
        assertColorExtractorFile,
        readColorExtractorImageDimensions
      } from './color-extractor-core.js';
      import {
        ImageBatchError,
        normalizeImageCompressionQuality,
        normalizeImageTargetFormat,
        validateImageCompressionSelection,
        validateImageBatchSelection
      } from './image-batch-core.js';
      import {
        IconGenerationError,
        assertIconArchiveSize,
        assertIconSource,
        assertIconSourceDimensions
      } from './icon-gen-core.js';
      import {
        AudioConvertError,
        normalizeAudioTargetFormat,
        validateAudioBatchSelection
      } from './audio-convert-core.js';
      import {
        BpmDetectError,
        assertBpmAudioBuffer,
        assertBpmInputSize,
        getBpmAnalysisSpec,
        isBpmSupportedAudioName,
        normalizeBpmCandidates
      } from './bpm-detect-core.js';
      import {
        AudioExtractError,
        assertAudioExtractInput,
        normalizeAudioExtractFormat,
        normalizeAudioTrackIndex
      } from './audio-extract-core.js';
      import {
        AudioClipError,
        assertAudioClipBuffer,
        assertAudioClipInput,
        assertAudioClipSelection,
        isAudioClipSupportedName
      } from './audio-clip-core.js';
      import {
        VideoConvertError,
        normalizeVideoTargetFormat,
        validateVideoBatchSelection
      } from './video-convert-core.js';
      import { frameTimeLabel, normalizeVideoFrameFormat, normalizeVideoFrameTimestamp, validateVideoFrameInput } from './video-frame-core.js';
      import { createDefaultVideoGifSelection, normalizeVideoGifRequest, validateVideoGifInput, videoGifTimeLabel } from './video-gif-core.js';
      import { calculateImageStitchLayout, normalizeImageStitchRequest } from './image-stitch-core.js';
      import JSZip from 'jszip';

      // Disable context menu globally, but allow on tool items for favorites
      document.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.audio-list-item')) return;
        e.preventDefault();
      });
      document.addEventListener('copy', (e) => e.preventDefault());
      document.addEventListener('cut', (e) => e.preventDefault());

      createIcons({ icons });
      applyTranslations();

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

      const darkveilBg = document.getElementById('darkveilBg');
      if (darkveilBg) {
        // Randomly choose between the original dark color and a blue variant on each entry
        const darkveilVariant = Math.random() < 0.5 ? 'original' : 'blue';
        initDarkVeil(darkveilBg, {
          hueShift: darkveilVariant === 'blue' ? 220 : 0,
          noiseIntensity: 0.03,
          scanlineIntensity: 0,
          speed: 1.6,
          scanlineFrequency: 5,
          warpAmount: 0,
          resolutionScale: 1
        });
      }

      const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
      const appWindow = isTauri ? getCurrentWindow() : null;
      const OUTPUT_ROOT_KEY = 'toolknit.output-root.v1';
      const BACKGROUND_KEY = 'toolknit.custom-background.v1';

      // Tauri uses data-tauri-drag-region. The older WebKit-only CSS hint was not
      // reliable on every Windows WebView, especially after opening an overlay.
      if (isTauri && appWindow) {
        const dragRegions = '.main-header-drag-region, .settings-header, .api-key-header, .feedback-header, .audio-convert-header, .audio-clip-header, .help-sidebar-header, .help-content-header, .transcription-model-header, .pdf-merge-page-picker-header, .pdf-page-workspace-header, .pdf-preview-drawer-header';
        document.querySelectorAll(dragRegions).forEach(region => {
          region.setAttribute('data-tauri-drag-region', '');
        });
      }

      function configuredOutputRoot() {
        try { return localStorage.getItem(OUTPUT_ROOT_KEY)?.trim() || ''; } catch { return ''; }
      }

      async function syncConfiguredOutputRoot() {
        if (!isTauri) return;
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const savedInBrowser = configuredOutputRoot();
          let savedInApp = await invoke('get_output_root');
          // Migrate the earlier browser-only setting once, then always use the native record.
          if (!savedInApp && savedInBrowser) {
            await invoke('set_output_root', { outputDir: savedInBrowser });
            savedInApp = savedInBrowser;
          }
          if (savedInApp) localStorage.setItem(OUTPUT_ROOT_KEY, savedInApp);
          else localStorage.removeItem(OUTPUT_ROOT_KEY);
        } catch (error) {
          console.error('Failed to sync output folder:', error);
        }
      }

      async function getOutputDir(subFolder) {
        const joinOutputSubFolder = (root, child) => {
          const separator = root.includes('\\') ? '\\' : '/';
          const normalizedChild = String(child || '')
            .replace(/[\\/]+/g, separator)
            .replace(separator === '\\' ? /^\\+|\\+$/g : /^\/+|\/+$/g, '');
          const normalizedRoot = root.replace(/[\/\\]+$/, '');
          return normalizedChild ? normalizedRoot + separator + normalizedChild : normalizedRoot;
        };
        let configuredRoot = configuredOutputRoot();
        if (isTauri) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const savedInApp = await invoke('get_output_root');
            configuredRoot = typeof savedInApp === 'string' ? savedInApp.trim() : '';
            if (configuredRoot) localStorage.setItem(OUTPUT_ROOT_KEY, configuredRoot);
            else localStorage.removeItem(OUTPUT_ROOT_KEY);
          } catch (error) {
            // Keep the last known path as a temporary fallback when native config is unavailable.
            console.error('Failed to read output folder:', error);
          }
        }
        if (configuredRoot) {
          return joinOutputSubFolder(configuredRoot, subFolder);
        }
        if (!isTauri) return '~/Downloads/ToolKnit/' + subFolder;
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const defaultRoot = await invoke('get_default_output_root');
          return joinOutputSubFolder(defaultRoot, subFolder);
        } catch (e) {
          console.error('Failed to get default output folder:', e);
          return 'C:\\Users\\Downloads\\ToolKnit\\' + subFolder;
        }
      }
      function outputParentFolder(outputPath) {
        const value = String(outputPath || '').trim();
        if (!value) return '';
        const normalized = value.replace(/[\\/]+$/, '');
        const parent = normalized.replace(/[/\\][^/\\]+$/, '');
        return parent && parent !== normalized ? parent : normalized;
      }
      async function openOutputFolder(outputPath) {
        if (!isTauri || !outputPath) return;
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('open_path', { path: outputParentFolder(outputPath) });
      }
      const transitionMask = document.getElementById('transitionMask');
      const navItems = document.querySelectorAll('.nav-item');
      const contentSections = document.querySelectorAll('.content-section');
      const mainContent = document.querySelector('.main-content');
      let isSwitching = false;

      // Tool card mouse spotlight effect and accessibility
      document.querySelectorAll('.tool-card').forEach(card => {
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        const toolName = card.querySelector('.tool-name');
        if (toolName) {
          card.setAttribute('aria-label', toolName.textContent || t('common.tool'));
        }
        card.addEventListener('mousemove', (e) => {
          const rect = card.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 100;
          const y = ((e.clientY - rect.top) / rect.height) * 100;
          card.style.setProperty('--mouse-x', `${x}%`);
          card.style.setProperty('--mouse-y', `${y}%`);
        });
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            card.click();
          }
        });
      });

      // Audio list items accessibility + mouse spotlight
      document.querySelectorAll('.audio-list-item').forEach(item => {
        item.addEventListener('mousemove', (e) => {
          const rect = item.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 100;
          const y = ((e.clientY - rect.top) / rect.height) * 100;
          item.style.setProperty('--mouse-x', `${x}%`);
          item.style.setProperty('--mouse-y', `${y}%`);
        });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            item.click();
          }
        });
      });

      // Audio tool search: trigger by button click with spider mascot loading for at least 1s
      // After search: input hides, clear button shows; footer shows at bottom of results
      // Clear button: mask animation, then restore input
      const audioSearchInput = document.getElementById('audioSearchInput');
      const audioSearchBtn = document.getElementById('audioSearchBtn');
      const audioClearBtn = document.getElementById('audioClearBtn');
      const audioSearchFooter = document.getElementById('audioSearchFooter');
      const audioSearchWrap = document.getElementById('audioSearchWrap');

      if (audioSearchBtn && audioSearchInput) {
        let audioSearching = false;
        const doAudioSearch = () => {
          if (audioSearching) return;
          audioSearching = true;
          if (transitionMask) transitionMask.classList.add('visible');
          setTimeout(() => {
            const query = audioSearchInput.value.trim().toLowerCase();
            document.querySelectorAll('.audio-list-item').forEach(item => {
              const text = item.textContent.toLowerCase();
              item.style.display = text.includes(query) ? '' : 'none';
            });
            // Hide input + search button, show clear button
            audioSearchInput.style.display = 'none';
            audioSearchBtn.style.display = 'none';
            audioClearBtn.style.display = 'block';
            // Show footer
            if (audioSearchFooter) audioSearchFooter.style.display = 'flex';
            if (transitionMask) transitionMask.classList.remove('visible');
            audioSearching = false;
          }, 1000);
        };
        audioSearchBtn.addEventListener('click', doAudioSearch);
        audioSearchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') doAudioSearch();
        });
      }

      let audioClearing = false;
      const doAudioClear = () => {
        if (audioClearing) return;
        audioClearing = true;
        if (transitionMask) transitionMask.classList.add('visible');
        setTimeout(() => {
          // Reset all items
          document.querySelectorAll('.audio-list-item').forEach(item => {
            item.style.display = '';
          });
          // Restore input + search button, hide clear button
          if (audioSearchInput) { audioSearchInput.value = ''; audioSearchInput.style.display = ''; }
          if (audioSearchBtn) audioSearchBtn.style.display = '';
          if (audioClearBtn) audioClearBtn.style.display = 'none';
          if (audioSearchFooter) audioSearchFooter.style.display = 'none';
          if (transitionMask) transitionMask.classList.remove('visible');
          audioClearing = false;
        }, 1000);
      };

      if (audioClearBtn) audioClearBtn.addEventListener('click', doAudioClear);

      // Generic tools search for all other category pages
      document.querySelectorAll('.content-section').forEach(section => {
        if (section.dataset.category === 'audio') return; // audio has its own logic
        const searchInput = section.querySelector('.tools-search-input');
        const searchBtn = section.querySelector('.tools-search-btn');
        const clearBtn = section.querySelector('.tools-clear-btn');
        if (!searchInput || !searchBtn) return;

        let searching = false;
        const doSearch = () => {
          if (searching) return;
          const query = searchInput.value.trim();
          if (!query) return;
          searching = true;
          if (transitionMask) transitionMask.classList.add('visible');
          setTimeout(() => {
            const query = searchInput.value.trim().toLowerCase();
            section.querySelectorAll('.audio-list-item').forEach(item => {
              const text = item.textContent.toLowerCase();
              item.style.display = text.includes(query) ? '' : 'none';
            });
            searchInput.style.display = 'none';
            searchBtn.style.display = 'none';
            if (clearBtn) clearBtn.style.display = 'block';
            if (transitionMask) transitionMask.classList.remove('visible');
            searching = false;
          }, 1000);
        };
        searchBtn.addEventListener('click', doSearch);
        searchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') doSearch();
        });

        if (clearBtn) {
          clearBtn.addEventListener('click', () => {
            if (searching) return;
            searching = true;
            if (transitionMask) transitionMask.classList.add('visible');
            setTimeout(() => {
              section.querySelectorAll('.audio-list-item').forEach(item => {
                item.style.display = '';
              });
              searchInput.value = '';
              searchInput.style.display = '';
              searchBtn.style.display = '';
              clearBtn.style.display = 'none';
              if (transitionMask) transitionMask.classList.remove('visible');
              searching = false;
            }, 1000);
          });
        }
      });

      let navigatedFromHome = false;
      let homeToolLaunchToken = 0;

      function switchCategory(category) {
        if (isSwitching) return;
        isSwitching = true;

        navItems.forEach(item => item.classList.remove('active'));
        const targetNav = document.querySelector(`.nav-item[data-category="${category}"]`);
        if (targetNav) targetNav.classList.add('active');

        contentSections.forEach(section => section.classList.remove('active', 'section-entering'));
        const targetSection = document.querySelector(`.content-section[data-category="${category}"]`);
        if (targetSection) {
          targetSection.classList.add('active');
          mainContent.scrollTop = 0;

          // A short root-level transition keeps navigation responsive while giving every category a shared rhythm.
          void targetSection.offsetWidth;
          targetSection.classList.add('section-entering');
          const clearEnteringState = event => {
            if (event.target !== targetSection || event.animationName !== 'sectionMicroEnter') return;
            targetSection.classList.remove('section-entering');
            targetSection.removeEventListener('animationend', clearEnteringState);
          };
          targetSection.addEventListener('animationend', clearEnteringState);
        }
        isSwitching = false;
      }

      function clearHomeToolNavigation() {
        navigatedFromHome = false;
        homeToolLaunchToken += 1;
      }

      function launchToolFromHome(toolId, category, delay = 0) {
        if (!toolId || !category) return;
        const launchToken = ++homeToolLaunchToken;
        navigatedFromHome = true;
        switchCategory(category);

        const openTool = () => {
          if (!navigatedFromHome || launchToken !== homeToolLaunchToken) return;
          const toolItem = Array.from(document.querySelectorAll('.audio-list-item'))
            .find(item => item.dataset.tool === toolId);
          toolItem?.click();
        };
        if (delay > 0) window.setTimeout(openTool, delay);
        else openTool();
      }

      navItems.forEach(item => {
        item.addEventListener('click', () => {
          const category = item.dataset.category;
          if (category && !item.classList.contains('active')) {
            clearHomeToolNavigation();
            switchCategory(category);
          }
        });
      });

      if (isTauri && appWindow) {
        document.querySelectorAll('.ctrl-btn[data-action]').forEach(btn => {
          btn.addEventListener('pointerdown', (e) => e.stopPropagation());
          btn.addEventListener('mousedown', (e) => e.stopPropagation());
          btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            try {
              if (action === 'minimize') {
                await appWindow.minimize();
              } else if (action === 'maximize') {
                await appWindow.toggleMaximize();
              } else if (action === 'close') {
                await appWindow.hide();
              }
            } catch (e) {
              console.error('Window control failed:', e);
            }
          });
        });
      }

      const settingsOverlay = document.getElementById('settingsOverlay');
      const settingsBtn = document.getElementById('settingsBtn');
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

      // Re-apply translations when language changes externally
      onLangChange(() => {
        applyTranslations();
      });

      // Refresh help content on language change
      onLangChange(() => {
        helpSearchCache = null;
        const activeItem = helpNav && helpNav.querySelector('.help-nav-item.active');
        if (activeItem && activeItem.dataset.helpSection) {
          showHelpSection(activeItem.dataset.helpSection);
        }
      });


      async function ensureFfmpegAvailable() {
        if (!isTauri) return false;
        try {
          const { invoke } = await import('@tauri-apps/api/core');
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
          const { invoke } = await import('@tauri-apps/api/core');
          const customRoot = await invoke('get_output_root');
          if (typeof customRoot === 'string' && customRoot.trim()) {
            localStorage.setItem(OUTPUT_ROOT_KEY, customRoot);
            storagePathDisplay.textContent = customRoot;
            return;
          }
          localStorage.removeItem(OUTPUT_ROOT_KEY);
          storagePathDisplay.textContent = await invoke('get_default_output_root');
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
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('set_output_root', { outputDir: selected });
          localStorage.setItem(OUTPUT_ROOT_KEY, selected);
          await refreshStoragePath();
        } catch (error) { console.error('Choose output folder failed:', error); }
      });
      if (openStorageFolder) {
        openStorageFolder.addEventListener('click', async () => {
          if (!isTauri) return;
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const customRoot = await invoke('get_output_root');
            const defaultRoot = await invoke('get_default_output_root');
            await invoke('open_path', { path: customRoot || defaultRoot });
          } catch (e) {
            console.error('Open folder failed:', e);
          }
        });
      }

      const customBackground = document.getElementById('customBackground');
      const customBackgroundStatus = document.getElementById('customBackgroundStatus');
      const chooseCustomBackground = document.getElementById('chooseCustomBackground');
      const clearCustomBackground = document.getElementById('clearCustomBackground');
      const customBackgroundInput = document.getElementById('customBackgroundInput');
      function updateCustomBackgroundStatus(record) {
        if (!customBackgroundStatus) return;
        if (!record) customBackgroundStatus.textContent = t('settings.defaultBackground');
        else customBackgroundStatus.textContent = record.type === 'video'
          ? t('settings.customVideoBackground')
          : t('settings.customImageBackground');
      }

      function restoreDefaultBackground({ forgetSavedBackground = false } = {}) {
        customBackground?.replaceChildren();
        document.body.classList.remove('has-custom-background');
        updateCustomBackgroundStatus(null);
        if (clearCustomBackground) clearCustomBackground.disabled = true;
        if (forgetSavedBackground) {
          try { localStorage.removeItem(BACKGROUND_KEY); } catch {}
        }
      }

      async function applyCustomBackground(record) {
        if (!customBackground) return;
        customBackground.replaceChildren();
        const active = record && typeof record.path === 'string' && (record.type === 'image' || record.type === 'video');
        document.body.classList.toggle('has-custom-background', Boolean(active));
        updateCustomBackgroundStatus(active ? record : null);
        if (clearCustomBackground) clearCustomBackground.disabled = !active;
        if (!active) {
          restoreDefaultBackground();
          return;
        }
        let source = record.path;
        if (isTauri) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            source = await invoke('get_custom_background_media_url', { path: record.path });
          } catch (error) {
            console.error('Cannot create custom background media URL:', error);
            restoreDefaultBackground({ forgetSavedBackground: true });
            window.showToast?.(t('settings.backgroundLoadFailed'));
            return;
          }
        }
        async function traceBackground(event) {
          if (!isTauri) return;
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('log_custom_background_event', { event });
          } catch {}
        }
        const media = document.createElement(record.type === 'video' ? 'video' : 'img');
        media.src = source;
        if (record.type === 'video') { media.autoplay = true; media.loop = true; media.muted = true; media.playsInline = true; }
        media.addEventListener('loadeddata', () => {
          void traceBackground(`loaded type=${record.type} path=${record.path} source=${source}`);
        }, { once: true });
        media.addEventListener('error', async () => {
          if (!customBackground.contains(media)) return;
          const mediaError = media.error;
          const details = `load-failed type=${record.type} code=${mediaError?.code ?? 'unknown'} network=${media.networkState} ready=${media.readyState} path=${record.path} source=${source}`;
          console.error('Custom background failed:', details);
          await traceBackground(details);
          restoreDefaultBackground({ forgetSavedBackground: true });
          window.showToast?.(t('settings.backgroundLoadFailed'));
        }, { once: true });
        customBackground.append(media);
      }
      function savedBackground() { try { return JSON.parse(localStorage.getItem(BACKGROUND_KEY) || 'null'); } catch { return null; } }
      void applyCustomBackground(savedBackground());
      async function saveCustomBackground(record) {
        try { localStorage.setItem(BACKGROUND_KEY, JSON.stringify(record)); } catch {}
        await applyCustomBackground(record);
        window.showToast?.(record.type === 'video'
          ? t('settings.customVideoBackground')
          : t('settings.customImageBackground'));
      }

      async function importCustomBackground(sourcePath) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const imported = await invoke('import_custom_background', { sourcePath });
          await saveCustomBackground({ path: imported.path, type: imported.media_type });
        } catch (error) {
          console.error('Import custom background failed:', error);
          window.showToast?.(t('common.errorOccurred', { error: String(error?.message || error) }));
        }
      }

      function setCustomBackgroundImporting(importing) {
        if (!chooseCustomBackground) return;
        chooseCustomBackground.disabled = importing;
        chooseCustomBackground.textContent = importing
          ? t('settings.preparingBackground')
          : t('settings.uploadBackground');
      }

      async function importPickedCustomBackground(sourcePath) {
        setCustomBackgroundImporting(true);
        try {
          await importCustomBackground(sourcePath);
        } finally {
          setCustomBackgroundImporting(false);
        }
      }

      async function importCustomBackgroundWithDependencies(sourcePath) {
        const extension = String(sourcePath).split('.').at(-1)?.toLowerCase();
        const isVideo = ['mp4', 'webm', 'ogv', 'ogg', 'mov'].includes(extension);
        if (isVideo && !await ensureFfmpegAvailable()) {
          showDependencyGate({
            openFn: () => importPickedCustomBackground(sourcePath),
            needsFfmpeg: true,
            needsModel: false
          });
          return;
        }
        await importPickedCustomBackground(sourcePath);
      }

      chooseCustomBackground?.addEventListener('click', async () => {
        if (!isTauri) {
          customBackgroundInput?.click();
          return;
        }
        try {
          const { open } = await import('@tauri-apps/plugin-dialog');
          const selected = await open({
            multiple: false,
            title: '选择自定义背景',
            filters: [
              { name: '图像或视频', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'mp4', 'webm', 'ogv', 'ogg', 'mov'] }
            ]
          });
          if (typeof selected === 'string') {
            await importCustomBackgroundWithDependencies(selected);
          }
        } catch (error) {
          console.error('Choose custom background failed:', error);
          window.showToast?.(t('common.errorOccurred', { error: String(error?.message || error) }));
          setCustomBackgroundImporting(false);
        }
      });
      customBackgroundInput?.addEventListener('change', async () => {
        const file = customBackgroundInput.files?.[0];
        if (!file) return;
        const isVideo = file.type.startsWith('video/');
        const isImage = file.type.startsWith('image/');
        if (!isVideo && !isImage) return;
        await saveCustomBackground({ path: URL.createObjectURL(file), type: isVideo ? 'video' : 'image' });
        customBackgroundInput.value = '';
      });
      clearCustomBackground?.addEventListener('click', async () => {
        if (isTauri) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('clear_custom_background');
          } catch (error) {
            console.error('Clear custom background failed:', error);
            return;
          }
        }
        try { localStorage.removeItem(BACKGROUND_KEY); } catch {}
        restoreDefaultBackground();
      });
      onLangChange(() => {
        void refreshStoragePath();
        updateCustomBackgroundStatus(savedBackground());
      });

      // ===== Offline model manager and local transcription =====
      const MODEL_SOURCE_KEY = 'toolknit.transcription-model-source.v1';
      const offlineModelSummary = document.getElementById('offlineModelSummary');
      const manageOfflineModels = document.getElementById('manageOfflineModels');
      const transcriptionModelOverlay = document.getElementById('transcriptionModelOverlay');
      const transcriptionModelClose = document.getElementById('transcriptionModelClose');
      const transcriptionModelList = document.getElementById('transcriptionModelList');
      const transcriptionSourceOptions = document.getElementById('transcriptionSourceOptions');
      const transcriptionOverlay = document.getElementById('transcriptionOverlay');
      const transcriptionBack = document.getElementById('transcriptionBack');
      const transcriptionCta = document.getElementById('transcriptionCta');
      const transcriptionCtaText = document.getElementById('transcriptionCtaText');
      const transcriptionInput = document.getElementById('transcriptionInput');
      const transcriptionFiles = document.getElementById('transcriptionFiles');
      const transcriptionSelectedFile = document.getElementById('transcriptionSelectedFile');
      const transcriptionSelectedFileName = document.getElementById('transcriptionSelectedFileName');
      const transcriptionProcessBtn = document.getElementById('transcriptionProcessBtn');
      const transcriptionProcessMask = document.getElementById('transcriptionProcessMask');
      const transcriptionProcessText = document.getElementById('transcriptionProcessText');
      const transcriptionProcessBarFill = document.getElementById('transcriptionProcessBarFill');
      const transcriptionLanguageOptions = document.getElementById('transcriptionLanguageOptions');
      const transcriptionRefine = document.getElementById('transcriptionRefine');
      const transcriptionDropZone = document.getElementById('transcriptionDropZone');
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
      const transcriptionPlasmaBg = document.getElementById('transcriptionPlasmaBg');
      const transcriptionSuccessOverlay = document.getElementById('transcriptionSuccessOverlay');
      const transcriptionSuccessMeta = document.getElementById('transcriptionSuccessMeta');
      const transcriptionSuccessCount = document.getElementById('transcriptionSuccessCount');
      const transcriptionSuccessPath = document.getElementById('transcriptionSuccessPath');
      const transcriptionSuccessOpenFolder = document.getElementById('transcriptionSuccessOpenFolder');
      const transcriptionSuccessOk = document.getElementById('transcriptionSuccessOk');
      let transcriptionModels = [];
      let transcriptionModelProgress = new Map();
      let transcriptionDownloadSource = localStorage.getItem(MODEL_SOURCE_KEY) || 'auto';
      let transcriptionFile = null;
      let transcriptionLanguage = 'auto';
      let transcriptionProcessing = false;
      let transcriptionPlasmaDispose = null;
      let transcriptionOutputDir = '';
      let dependencyGateState = null;

      function formatTranscriptionBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes < 1) return '--';
        const units = ['B', 'KB', 'MB', 'GB'];
        const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        return `${(bytes / (1024 ** index)).toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
      }

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

      function setTranscriptionProgress(progress, message) {
        if (transcriptionProcessBarFill) transcriptionProcessBarFill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
        if (message && transcriptionProcessText) transcriptionProcessText.textContent = message;
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
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('set_current_transcription_model', { modelId: model.id });
                await refreshTranscriptionModels();
              });
              actions.append(use);
            }
            const remove = document.createElement('button');
            remove.type = 'button'; remove.className = 'settings-btn'; remove.textContent = t('home.transcription.deleteModel');
            remove.addEventListener('click', async () => {
              const { invoke } = await import('@tauri-apps/api/core');
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
                const { invoke } = await import('@tauri-apps/api/core');
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
          const { invoke } = await import('@tauri-apps/api/core');
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
          const { listen } = await import('@tauri-apps/api/event');
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

      function formatRuntimeBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes < 1) return '--';
        const units = ['B', 'KB', 'MB', 'GB'];
        const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        return `${(bytes / (1024 ** index)).toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
      }

      function updateFfmpegRuntimeSummary() {
        if (!ffmpegRuntimeSummary) return;
        ffmpegRuntimeSummary.textContent = ffmpegRuntimeStatus?.installed
          ? (getLang() === 'en' ? `Installed (${formatRuntimeBytes(ffmpegRuntimeStatus.bytes)})` : `已安装 (${formatRuntimeBytes(ffmpegRuntimeStatus.bytes)})`)
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
          ? `${formatRuntimeBytes(ffmpegRuntimeStatus.bytes)} - ${ffmpegRuntimeStatus.path}`
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
        } else if (ffmpegRuntimeStatus?.installed) {
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'settings-btn'; remove.textContent = getLang() === 'en' ? 'Delete' : '删除';
          remove.addEventListener('click', async () => {
            try { const { invoke } = await import('@tauri-apps/api/core'); await invoke('delete_ffmpeg_runtime'); await refreshFfmpegRuntime(); }
            catch (error) { window.showToast?.(String(error?.message || error)); }
          });
          actions.append(remove);
        } else {
          const install = document.createElement('button'); install.type = 'button'; install.className = 'settings-btn'; install.textContent = getLang() === 'en' ? 'Download' : '下载';
          install.addEventListener('click', async () => {
            try {
              ffmpegRuntimeProgress = { phase: 'downloading', downloaded_bytes: 0, total_bytes: 0 }; renderFfmpegRuntime();
              const { invoke } = await import('@tauri-apps/api/core'); await invoke('download_ffmpeg_runtime', { source: resolvedFfmpegDownloadSource() });
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
        try { const { invoke } = await import('@tauri-apps/api/core'); ffmpegRuntimeStatus = await invoke('get_ffmpeg_runtime_status'); updateFfmpegRuntimeSummary(); renderFfmpegRuntime(); }
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
        (async () => { const { listen } = await import('@tauri-apps/api/event'); await listen('ffmpeg-runtime-download-progress', event => { ffmpegRuntimeProgress = event.payload; renderFfmpegRuntime(); updateDependencyGateProgress('ffmpeg', event.payload); }); })().catch(error => console.error('Cannot listen for FFmpeg runtime download:', error));
      }

      function resolvedFfmpegDownloadSource() {
        if (ffmpegRuntimeSource !== 'auto') return ffmpegRuntimeSource;
        return getLang() === 'en' ? 'auto-official' : 'auto-china';
      }

      function resolvedModelDownloadSource() {
        if (transcriptionDownloadSource !== 'auto') return transcriptionDownloadSource;
        return getLang() === 'en' ? 'official' : 'china';
      }

      function dependencyProgressPercent(progress) {
        if (!progress) return 0;
        if (['installing', 'verifying', 'complete'].includes(progress.phase)) return 100;
        return Math.max(0, Math.min(100, Math.round((Number(progress.downloaded_bytes) || 0) / Math.max(1, Number(progress.total_bytes) || 0) * 100)));
      }

      function dependencyStatusText(type, progress, complete) {
        if (complete || progress?.phase === 'complete') return t('home.dependencies.ready');
        if (!progress) return t('home.dependencies.waiting');
        if (progress.phase === 'installing') return t('home.dependencies.installing');
        if (progress.phase === 'verifying') return t('home.dependencies.verifying');
        const percent = dependencyProgressPercent(progress);
        return `${t('home.dependencies.downloading')} ${percent}%`;
      }

      function renderDependencyGate() {
        const state = dependencyGateState;
        if (!state || !dependencyGateList) return;
        const isTranscription = state.needsModel;
        if (dependencyGateTitle) dependencyGateTitle.textContent = t(isTranscription ? 'home.dependencies.transcriptionTitle' : 'home.dependencies.title');
        if (dependencyGateDesc) dependencyGateDesc.textContent = t(isTranscription ? 'home.dependencies.transcriptionDesc' : 'home.dependencies.desc');
        dependencyGateList.replaceChildren();
        const appendItem = (type, label, size, progress, complete) => {
          const row = document.createElement('div');
          row.className = 'audio-convert-success-row dependency-gate-row';
          const key = document.createElement('span'); key.className = 'audio-convert-success-key'; key.textContent = `${label} · ${size}`;
          const value = document.createElement('span'); value.className = 'audio-convert-success-value'; value.textContent = dependencyStatusText(type, progress, complete);
          value.dataset.state = complete || progress?.phase === 'complete' ? 'ready' : (progress ? 'active' : 'waiting');
          row.append(key, value); dependencyGateList.append(row);
        };
        if (state.needsFfmpeg) appendItem('ffmpeg', 'FFmpeg', '29 MB', state.ffmpegProgress, state.ffmpegComplete);
        if (state.needsModel) appendItem('model', 'Whisper Small', '465 MB', state.modelProgress, state.modelComplete);

        const types = [state.needsFfmpeg && 'ffmpeg', state.needsModel && 'model'].filter(Boolean);
        const overall = types.length
          ? Math.round(types.reduce((sum, type) => sum + (state[`${type}Complete`] ? 100 : dependencyProgressPercent(state[`${type}Progress`])), 0) / types.length)
          : 100;
        if (dependencyGateProgress) dependencyGateProgress.hidden = !state.downloading;
        if (dependencyGateProgressFill) dependencyGateProgressFill.style.width = `${overall}%`;
        if (dependencyGateProgressText) {
          const currentName = state.current === 'model' ? 'Whisper Small' : 'FFmpeg';
          dependencyGateProgressText.textContent = state.cancelling
            ? t('home.dependencies.cancelling')
            : `${t('home.dependencies.current')}${currentName} · ${overall}%`;
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
        const state = dependencyGateState;
        if (!state || !state.downloading || !state[`needs${type === 'ffmpeg' ? 'Ffmpeg' : 'Model'}`]) return;
        state[`${type}Progress`] = progress || null;
        if (progress?.phase === 'complete') state[`${type}Complete`] = true;
        renderDependencyGate();
      }

      function showDependencyGate({ openFn, needsFfmpeg, needsModel }) {
        dependencyGateState = {
          openFn,
          needsFfmpeg: Boolean(needsFfmpeg),
          needsModel: Boolean(needsModel),
          ffmpegProgress: null,
          modelProgress: null,
          ffmpegComplete: !needsFfmpeg,
          modelComplete: !needsModel,
          current: needsFfmpeg ? 'ffmpeg' : 'model',
          downloading: false,
          cancelling: false,
          cancelled: false,
          error: ''
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
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          if (state.needsFfmpeg) {
            state.current = 'ffmpeg'; renderDependencyGate();
            if (!await ensureFfmpegAvailable()) await invoke('download_ffmpeg_runtime', { source: resolvedFfmpegDownloadSource() });
            if (state.cancelled) throw new Error('dependency-download:cancelled');
            state.ffmpegComplete = true; state.ffmpegProgress = { phase: 'complete', downloaded_bytes: 1, total_bytes: 1 };
            ffmpegRuntimeProgress = null;
            await refreshFfmpegRuntime();
          }
          if (state.needsModel) {
            state.current = 'model'; renderDependencyGate();
            await refreshTranscriptionModels();
            if (!activeTranscriptionModel()) {
              const small = transcriptionModels.find(model => model.id === 'small');
              state.modelProgress = { phase: 'downloading', downloaded_bytes: 0, total_bytes: small?.bytes || 487_601_967 };
              renderDependencyGate();
              await invoke('download_transcription_model', { modelId: 'small', source: resolvedModelDownloadSource() });
              await invoke('set_current_transcription_model', { modelId: 'small' });
            }
            if (state.cancelled) throw new Error('dependency-download:cancelled');
            state.modelComplete = true; state.modelProgress = { phase: 'complete', downloaded_bytes: 1, total_bytes: 1 };
            transcriptionModelProgress.delete('small');
            await refreshTranscriptionModels();
          }
          const openFn = state.openFn;
          state.downloading = false;
          renderDependencyGate();
          closeDependencyGate(true);
          await openFn?.();
        } catch (error) {
          const message = String(error?.message || error || '');
          ffmpegRuntimeProgress = null;
          transcriptionModelProgress.delete('small');
          if (state.cancelled || message.includes('dependency-download:cancelled')) {
            state.downloading = false;
            closeDependencyGate(true);
            return;
          }
          state.downloading = false;
          state.cancelling = false;
          state.error = `${t('home.dependencies.failed')} ${message}`.trim();
          renderFfmpegRuntime();
          renderTranscriptionModels();
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
        try { const { invoke } = await import('@tauri-apps/api/core'); await invoke('cancel_dependency_downloads'); }
        catch (error) { console.error('Cannot cancel dependency download:', error); }
      });

      function updateTranscriptionUploadState() {
        const hasFile = Boolean(transcriptionFile?.name);
        const ctaLabel = hasFile ? t('home.transcription.reupload') : t('home.transcription.cta');
        if (transcriptionCtaText) transcriptionCtaText.textContent = ctaLabel;
        if (transcriptionCta) transcriptionCta.setAttribute('aria-label', ctaLabel);
        if (transcriptionSelectedFile) transcriptionSelectedFile.hidden = !hasFile;
        if (transcriptionSelectedFileName) {
          transcriptionSelectedFileName.textContent = hasFile ? transcriptionFile.name : '';
          transcriptionSelectedFileName.title = hasFile ? transcriptionFile.name : '';
        }
      }

      function renderTranscriptionFile() {
        transcriptionFiles?.replaceChildren();
        updateTranscriptionUploadState();
      }

      function updateTranscriptionProcessButton() {
        if (!transcriptionProcessBtn) return;
        transcriptionProcessBtn.style.display = transcriptionFile ? '' : 'none';
        transcriptionProcessBtn.classList.toggle('visible', Boolean(transcriptionFile));
        transcriptionProcessBtn.disabled = transcriptionProcessing;
      }

      function addTranscriptionFile(file) {
        if (!file || transcriptionProcessing) return;
        transcriptionFile = file;
        renderTranscriptionFile();
        updateTranscriptionProcessButton();
      }

      function showTranscriptionTool() {
        transcriptionOverlay?.classList.add('visible');
        if (transcriptionPlasmaBg && !transcriptionPlasmaDispose) transcriptionPlasmaDispose = initPlasma(transcriptionPlasmaBg, { color: '#6366f1', speed: 0.25, scale: 1.05 });
      }

      async function openTranscriptionTool() {
        if (!isTauri) { window.showToast?.(t('home.transcription.desktopOnly')); return; }
        const { invoke } = await import('@tauri-apps/api/core');
        const [engineReady, ffmpegReady] = await Promise.all([invoke('check_transcription_engine'), ensureFfmpegAvailable()]);
        if (!engineReady) { window.showToast?.(t('home.transcription.engineUnavailable')); return; }
        await refreshTranscriptionModels();
        const modelReady = Boolean(activeTranscriptionModel());
        if (!ffmpegReady || !modelReady) {
          showDependencyGate({ openFn: showTranscriptionTool, needsFfmpeg: !ffmpegReady, needsModel: !modelReady });
          return;
        }
        showTranscriptionTool();
      }

      function closeTranscriptionTool() {
        if (transcriptionProcessing) return;
        transcriptionOverlay?.classList.remove('visible');
        transcriptionFile = null;
        renderTranscriptionFile();
        updateTranscriptionProcessButton();
        if (transcriptionPlasmaDispose) { transcriptionPlasmaDispose(); transcriptionPlasmaDispose = null; }
      }

      transcriptionBack?.addEventListener('click', closeTranscriptionTool);
      transcriptionCta?.addEventListener('click', async () => {
        if (isTauri) {
          const { open } = await import('@tauri-apps/plugin-dialog');
          const selected = await open({ multiple: false, filters: [{ name: 'Audio and video', extensions: ['mp3', 'aac', 'm4a', 'wav', 'flac', 'alac', 'ogg', 'wma', 'mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'ts'] }] });
          if (typeof selected === 'string') addTranscriptionFile({ path: selected, name: selected.split(/[\\/]/).pop() || selected });
        } else transcriptionInput?.click();
      });
      transcriptionInput?.addEventListener('change', () => { const file = transcriptionInput.files?.[0]; if (file) addTranscriptionFile(file); transcriptionInput.value = ''; });
      transcriptionLanguageOptions?.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', () => {
        transcriptionLanguage = button.dataset.language || 'auto';
        transcriptionLanguageOptions.querySelectorAll('[data-language]').forEach(item => item.classList.toggle('active', item === button));
      }));
      updateTranscriptionUploadState();
      document.querySelectorAll('.audio-list-item[data-tool="transcription"]').forEach(item => {
        item.addEventListener('click', () => { void openTranscriptionTool(); });
        item.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void openTranscriptionTool(); } });
      });

      if (isTauri && transcriptionOverlay) {
        (async () => {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          const webview = getCurrentWebview();
          await webview.onDragDropEvent(event => {
            if (!transcriptionOverlay.classList.contains('visible') || transcriptionProcessing) return;
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') transcriptionDropZone?.classList.add('visible');
            else if (payload.type === 'leave') transcriptionDropZone?.classList.remove('visible');
            else if (payload.type === 'drop') {
              transcriptionDropZone?.classList.remove('visible');
              const path = payload.paths?.[0];
              if (path) addTranscriptionFile({ path, name: path.split(/[\\/]/).pop() || path });
            }
          });
        })().catch(error => console.error('Cannot register transcription drag and drop:', error));
      }

      function transcriptionProgressLabel(phase) {
        const labels = {
          preparing: 'home.transcription.preparing',
          transcribing: 'home.transcription.transcribing',
          publishing: 'home.transcription.publishing',
          refining: 'home.transcription.refining',
          complete: 'home.transcription.complete'
        };
        return t(labels[phase] || 'home.transcription.preparing');
      }

      async function readTranscriptionText(path) {
        const { invoke } = await import('@tauri-apps/api/core');
        const bytes = await invoke('read_file_bytes_limited', { path, maxBytes: 10 * 1024 * 1024 });
        return new TextDecoder('utf-8').decode(Uint8Array.from(bytes));
      }

      function parseTranscriptionSrt(value) {
        return String(value || '').replace(/^\uFEFF/, '').trim().split(/\r?\n\s*\r?\n/).map(block => {
          const lines = block.split(/\r?\n/);
          const id = Number(lines.shift());
          const timing = lines.shift() || '';
          const match = /^(\S+)\s+-->\s+(\S+)$/.exec(timing.trim());
          if (!Number.isInteger(id) || !match || lines.length === 0) return null;
          return { id, start: match[1], end: match[2], text: lines.join('\n').trim() };
        }).filter(Boolean);
      }

      function parseRefinedTranscriptionResponse(value, expectedIds) {
        const source = String(value || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        const start = source.indexOf('{');
        const json = start >= 0 ? extractBalancedJson(source, start) : null;
        const parsed = JSON.parse(json || source);
        if (!Array.isArray(parsed?.segments) || parsed.segments.length !== expectedIds.length) throw new Error('Invalid refinement response');
        const updated = new Map();
        for (const segment of parsed.segments) {
          const id = Number(segment?.id);
          const text = typeof segment?.text === 'string' ? segment.text.trim() : '';
          if (!expectedIds.has(id) || updated.has(id) || !text || text.length > 1200) throw new Error('Invalid refinement response');
          updated.set(id, text);
        }
        if (updated.size !== expectedIds.size) throw new Error('Invalid refinement response');
        return updated;
      }

      async function refineTranscriptionSegments(segments) {
        const updated = new Map();
        const chunkSize = 42;
        for (let offset = 0; offset < segments.length; offset += chunkSize) {
          const chunk = segments.slice(offset, offset + chunkSize);
          const payload = chunk.map(({ id, text }) => ({ id, text }));
          const response = await callDeepSeek([
            {
              role: 'system',
              content: 'You proofread speech-recognition subtitles. Return JSON only: {"segments":[{"id":number,"text":string}]}. Keep exactly the supplied IDs, one item per ID, in the same order. Do not add, remove, merge, or split segments. Do not invent names, numbers, facts, or missing speech. Correct punctuation, obvious grammar, and clearly contextual recognition errors only. Preserve the language of each segment.'
            },
            { role: 'user', content: JSON.stringify({ segments: payload }) }
          ], undefined, 4000);
          const edits = parseRefinedTranscriptionResponse(response, new Set(chunk.map(segment => segment.id)));
          edits.forEach((text, id) => updated.set(id, text));
        }
        return updated;
      }

      async function writeRefinedTranscription(result) {
        const rawSrt = await readTranscriptionText(result.raw_srt_path);
        const segments = parseTranscriptionSrt(rawSrt);
        if (segments.length === 0) throw new Error('No subtitle segments were produced');
        setTranscriptionProgress(97, transcriptionProgressLabel('refining'));
        const refined = await refineTranscriptionSegments(segments);
        const finalSegments = segments.map(segment => ({ ...segment, text: refined.get(segment.id) || segment.text }));
        const srt = finalSegments.map((segment, index) => `${index + 1}\n${segment.start} --> ${segment.end}\n${segment.text}`).join('\n\n') + '\n';
        const txt = finalSegments.map(segment => segment.text.replace(/\n/g, ' ')).join('\n') + '\n';
        const outputDir = result.raw_srt_path.replace(/[/\\][^/\\]+$/, '');
        const rawSrtName = result.raw_srt_path.split(/[\\/]/).pop() || 'transcript.srt';
        const rawTxtName = result.raw_txt_path.split(/[\\/]/).pop() || 'transcript.txt';
        const srtName = rawSrtName.replace(/\.srt$/i, '_refined.srt');
        const txtName = rawTxtName.replace(/\.txt$/i, '_refined.txt');
        const { invoke } = await import('@tauri-apps/api/core');
        const written = await invoke('write_unique_file_pair', {
          directory: outputDir,
          firstFileName: srtName,
          firstBytes: Array.from(new TextEncoder().encode(srt)),
          secondFileName: txtName,
          secondBytes: Array.from(new TextEncoder().encode(txt))
        });
        return { srtPath: written.first_path, txtPath: written.second_path };
      }

      function showTranscriptionResult(result, refined = null) {
        if (!transcriptionFiles) return;
        transcriptionFiles.replaceChildren();
        const paths = [
          [t('home.transcription.rawJson'), result.raw_json_path],
          [t('home.transcription.rawSrt'), result.raw_srt_path],
          [t('home.transcription.rawTxt'), result.raw_txt_path],
          ...(refined ? [[t('home.transcription.refinedSrt'), refined.srtPath], [t('home.transcription.refinedTxt'), refined.txtPath]] : [])
        ];
        paths.forEach(([label, path]) => {
          const item = document.createElement('div'); item.className = 'audio-convert-file-item';
          const name = document.createElement('span'); name.className = 'audio-convert-file-name'; name.textContent = `${label}: ${path.split(/[\\/]/).pop()}`;
          item.append(name); transcriptionFiles.append(item);
        });
      }

      function showTranscriptionSuccess(result, refined = null, refineFailed = false) {
        if (!transcriptionSuccessOverlay) return;
        const outputDir = String(result.raw_srt_path || '').replace(/[/\\][^/\\]+$/, '');
        transcriptionOutputDir = outputDir;
        if (transcriptionSuccessMeta) {
          transcriptionSuccessMeta.textContent = refineFailed
            ? t('home.transcription.refineFailed')
            : t('home.transcription.success');
        }
        if (transcriptionSuccessCount) transcriptionSuccessCount.textContent = String(refined ? 5 : 3);
        if (transcriptionSuccessPath) transcriptionSuccessPath.textContent = outputDir;
        transcriptionSuccessOverlay.classList.add('visible');
      }

      transcriptionSuccessOk?.addEventListener('click', () => transcriptionSuccessOverlay?.classList.remove('visible'));
      transcriptionSuccessOpenFolder?.addEventListener('click', async () => {
        if (!isTauri || !transcriptionOutputDir) return;
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('open_path', { path: transcriptionOutputDir });
        } catch (error) {
          console.error('Cannot open transcription output folder:', error);
        }
      });

      transcriptionProcessBtn?.addEventListener('click', async () => {
        if (!transcriptionFile || transcriptionProcessing || !isTauri) return;
        if (!transcriptionFile.path) { window.showToast?.(t('home.transcription.desktopOnly')); return; }
        transcriptionProcessing = true;
        updateTranscriptionProcessButton();
        transcriptionProcessMask?.classList.add('visible');
        setTranscriptionProgress(2, transcriptionProgressLabel('preparing'));
        let unlisten = null;
        let completion = null;
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const { listen } = await import('@tauri-apps/api/event');
          unlisten = await listen('transcription-progress', event => {
            const progress = event.payload;
            if (!progress) return;
            setTranscriptionProgress(progress.progress || 0, transcriptionProgressLabel(progress.phase));
          });
          const result = await invoke('transcribe_media', {
            inputPath: transcriptionFile.path,
            outputDir: await getOutputDir('Transcripts'),
            language: transcriptionLanguage
          });
          let refined = null;
          let refineFailed = false;
          if (transcriptionRefine?.checked) {
            try {
              refined = await writeRefinedTranscription(result);
            } catch (error) {
              console.error('Transcription refinement failed:', error);
              refineFailed = true;
            }
          }
          showTranscriptionResult(result, refined);
          completion = { result, refined, refineFailed };
          setTranscriptionProgress(100, transcriptionProgressLabel('complete'));
        } catch (error) {
          console.error('Transcription failed:', error);
          window.showToast?.(t('common.errorOccurred', { error: String(error?.message || error) }));
        } finally {
          unlisten?.();
          transcriptionProcessing = false;
          transcriptionProcessMask?.classList.remove('visible');
          updateTranscriptionProcessButton();
          setTranscriptionProgress(0, transcriptionProgressLabel('preparing'));
          if (completion) showTranscriptionSuccess(completion.result, completion.refined, completion.refineFailed);
        }
      });

      onLangChange(() => { updateTranscriptionUploadState(); updateOfflineModelSummary(); renderTranscriptionModels(); updateFfmpegRuntimeSummary(); renderFfmpegRuntime(); renderDependencyGate(); });

      const helpBtn = document.getElementById('helpBtn');
      if (settingsBtn && settingsOverlay) {
        settingsBtn.addEventListener('click', () => {
          if (settingsContent) settingsContent.scrollTop = 0;
          settingsOverlay.classList.add('visible');
        });
      }
      if (helpBtn) {
        helpBtn.addEventListener('click', () => {
          openHelpOverlay('overview');
        });
      }

      if (settingsBack && settingsOverlay) {
        settingsBack.addEventListener('click', () => {
          settingsOverlay.classList.remove('visible');
        });
      }

      const helpLink = document.getElementById('helpLink');
      const feedbackLink = document.getElementById('feedbackLink');
      const declarationLink = document.getElementById('declarationLink');
      const usagePolicyLink = document.getElementById('usagePolicyLink');

      if (helpLink) {
        helpLink.addEventListener('click', (e) => {
          e.preventDefault();
          openHelpOverlay();
        });
      }

      const helpOverlay = document.getElementById('helpOverlay');
      const helpBackBtn = document.getElementById('helpBackBtn');
      const helpNav = document.getElementById('helpNav');
      const helpContentBody = document.getElementById('helpContentBody');
      const helpContentTitle = document.getElementById('helpContentTitle');
      const helpSearchInput = document.getElementById('helpSearchInput');

      function openHelpOverlay(sectionId = 'overview') {
        if (!helpOverlay) return;
        helpOverlay.classList.add('visible');
        showHelpSection(sectionId || 'overview');
      }

      function closeHelpOverlay() {
        if (!helpOverlay) return;
        helpOverlay.classList.remove('visible');
        if (helpSearchInput) helpSearchInput.value = '';
        if (helpNav) {
          helpNav.querySelectorAll('.help-nav-item').forEach(item => {
            item.style.display = '';
          });
          helpNav.querySelectorAll('.help-nav-group').forEach(g => g.style.display = '');
        }
      }

      if (helpBackBtn) {
        helpBackBtn.addEventListener('click', closeHelpOverlay);
      }

      let helpSearchCache = null;
      function buildHelpSearchCache() {
        const content = getHelpContent();
        if (helpSearchCache || !content) return;
        helpSearchCache = {};
        for (const key in content) {
          const entry = content[key];
          helpSearchCache[key] = (entry.title + ' ' + entry.html).toLowerCase();
        }
      }

      function showHelpSection(sectionId) {
        const content = getHelpContent();
        if (!content || !content[sectionId]) return;
        const data = content[sectionId];
        if (helpContentTitle) helpContentTitle.textContent = data.title;
        if (helpContentBody) {
          helpContentBody.innerHTML = data.html;
          helpContentBody.scrollTop = 0;
        }
        if (helpSearchInput) helpSearchInput.value = '';
        if (helpNav) {
          helpNav.querySelectorAll('.help-nav-item').forEach(item => {
            item.style.display = '';
            item.classList.toggle('active', item.dataset.helpSection === sectionId);
          });
          helpNav.querySelectorAll('.help-nav-group').forEach(g => g.style.display = '');
        }
      }

      if (helpNav) {
        helpNav.addEventListener('click', (e) => {
          const item = e.target.closest('.help-nav-item');
          if (!item) return;
          const section = item.dataset.helpSection;
          if (section) showHelpSection(section);
        });
      }

      if (helpContentBody) {
        helpContentBody.addEventListener('click', async (event) => {
          const button = event.target.closest('.help-prompt-copy');
          if (!button) return;
          const prompt = button.dataset.copyPrompt || '';
          if (!prompt) return;
          const originalLabel = button.textContent;
          try {
            await navigator.clipboard.writeText(prompt);
            button.textContent = getLang() === 'zh' ? '已复制' : 'Copied';
            button.classList.add('is-copied');
            setTimeout(() => {
              button.textContent = originalLabel;
              button.classList.remove('is-copied');
            }, 1600);
          } catch (error) {
            console.error('Could not copy Agent prompt:', error);
          }
        });
      }

      if (helpSearchInput) {
        helpSearchInput.addEventListener('input', () => {
          const query = helpSearchInput.value.trim().toLowerCase();
          if (!helpNav) return;
          if (!query) {
            helpNav.querySelectorAll('.help-nav-item').forEach(item => item.style.display = '');
            helpNav.querySelectorAll('.help-nav-group').forEach(g => g.style.display = '');
            const activeItem = helpNav.querySelector('.help-nav-item.active');
            if (activeItem && activeItem.dataset.helpSection) {
              const section = activeItem.dataset.helpSection;
              const content = getHelpContent();
              if (content[section]) {
                helpContentTitle.textContent = content[section].title;
                helpContentBody.innerHTML = content[section].html;
              }
            }
            return;
          }
          buildHelpSearchCache();
          let anyVisible = false;
          helpNav.querySelectorAll('.help-nav-group').forEach(group => {
            let groupHasVisible = false;
            group.querySelectorAll('.help-nav-item').forEach(item => {
              const text = (item.textContent || '').toLowerCase();
              const section = item.dataset.helpSection || '';
              const cached = (helpSearchCache && helpSearchCache[section]) || '';
              const match = text.includes(query) || cached.includes(query);
              item.style.display = match ? '' : 'none';
              if (match) groupHasVisible = true;
            });
            group.style.display = groupHasVisible ? '' : 'none';
            if (groupHasVisible) anyVisible = true;
          });
          if (helpContentBody) {
            if (!anyVisible) {
              helpContentBody.innerHTML = `<div class="help-search-empty">${escapeHtml(t('help.searchEmpty'))}</div>`;
            }
          }
        });
      }

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && helpOverlay && helpOverlay.classList.contains('visible')) {
          closeHelpOverlay();
        }
      });

      const feedbackOverlay = document.getElementById('feedbackOverlay');
      const feedbackBack = document.getElementById('feedbackBack');
      const feedbackBtn = document.getElementById('feedbackBtn');
      const lightraysBg = document.getElementById('lightraysBg');
      let lightraysInstance = null;

      function openFeedbackOverlay() {
        if (!feedbackOverlay) return;
        feedbackOverlay.classList.add('visible');
        if (lightraysBg && !lightraysInstance) {
          lightraysInstance = initLightRays(lightraysBg, {
            raysOrigin: 'top-center',
            raysColor: '#ffffff',
            raysSpeed: 0.6,
            lightSpread: 0.6,
            rayLength: 3,
            followMouse: true,
            mouseInfluence: 0.1,
            noiseAmount: 0,
            distortion: 0,
            pulsating: false,
            fadeDistance: 1,
            saturation: 1
          });
        }
      }

      function closeFeedbackOverlay() {
        if (!feedbackOverlay) return;
        feedbackOverlay.classList.remove('visible');
        closeFeedbackDrawer();
        if (lightraysInstance) {
          lightraysInstance.destroy();
          lightraysInstance = null;
        }
      }

      if (feedbackLink && feedbackOverlay) {
        feedbackLink.addEventListener('click', (e) => {
          e.preventDefault();
          openFeedbackOverlay();
        });
      }

      if (feedbackBtn && feedbackOverlay) {
        feedbackBtn.addEventListener('click', () => {
          openFeedbackOverlay();
        });
      }

      if (feedbackBack && feedbackOverlay) {
        feedbackBack.addEventListener('click', () => {
          closeFeedbackOverlay();
        });
      }

      // Audio Convert Tool Page
      const audioConvertOverlay = document.getElementById('audioConvertOverlay');
      const audioConvertBack = document.getElementById('audioConvertBack');
      const plasmaBg = document.getElementById('plasmaBg');
      let plasmaInstance = null;

      function openAudioConvertOverlay() {
        if (!audioConvertOverlay) return;
        audioConvertOverlay.classList.add('visible');
        if (plasmaBg && !plasmaInstance) {
          plasmaInstance = initPlasma(plasmaBg, {
            color: '#6B6B6B',
            speed: 0.8,
            direction: 'forward',
            scale: 1,
            opacity: 1,
            mouseInteractive: false
          });
        }
      }

      function closeAudioConvertOverlay() {
        if (!audioConvertOverlay) return;
        audioConvertOverlay.classList.remove('visible');
        if (plasmaInstance) {
          plasmaInstance();
          plasmaInstance = null;
        }
        cancelActiveAudioConversion();
        audioConvertProcessMask.classList.remove('visible');
        audioConvertProcessBarFill.style.width = '0%';
        // Clear file list for fresh start next time
        clearAudioFiles();
      }


      if (audioConvertBack) {
        audioConvertBack.addEventListener('click', closeAudioConvertOverlay);
      }

      // Click on audio-list-item with data-tool="convert" to open the convert page
      document.querySelectorAll('.audio-list-item[data-tool="convert"]').forEach(item => {
        item.addEventListener('click', () => {
          openToolWithFfmpegCheck(openAudioConvertOverlay);
        });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openToolWithFfmpegCheck(openAudioConvertOverlay);
          }
        });
      });

      // Audio Convert drag & drop / files / processing
      const audioConvertDropZone = document.getElementById('audioConvertDropZone');
      const audioConvertFiles = document.getElementById('audioConvertFiles');
      const audioConvertCta = document.getElementById('audioConvertCta');
      const audioConvertProcessBtn = document.getElementById('audioConvertProcessBtn');
      const audioConvertProcessMask = document.getElementById('audioConvertProcessMask');
      const audioConvertProcessBarFill = document.getElementById('audioConvertProcessBarFill');
      const audioConvertProcessText = document.getElementById('audioConvertProcessText');
      const audioConvertCancelBtn = document.getElementById('audioConvertCancelBtn');
      let selectedAudioFiles = [];
      let processingAudio = false;
      let targetAudioFormat = 'MP3';
      let audioConversionRunId = 0;
      let audioConvertUnlisten = null;
      const audioConvertSuccessOverlay = document.getElementById('audioConvertSuccessOverlay');
      const audioConvertSuccessPath = document.getElementById('audioConvertSuccessPath');
      const audioConvertSuccessMeta = document.getElementById('audioConvertSuccessMeta');
      const audioConvertSuccessFormat = document.getElementById('audioConvertSuccessFormat');
      const audioConvertSuccessCount = document.getElementById('audioConvertSuccessCount');
      const audioConvertOpenFolder = document.getElementById('audioConvertOpenFolder');
      const audioConvertSuccessOk = document.getElementById('audioConvertSuccessOk');
      const audioConvertFormatOptions = document.getElementById('audioConvertFormatOptions');

      function addAudioFiles(fileList) {
        if (!fileList || fileList.length === 0) return;
        const nextFiles = [...selectedAudioFiles];
        for (const file of fileList) {
          // Deduplicate by path (preferred) or name+size fallback
          const dup = file.path
            ? nextFiles.some(f => f.path === file.path)
            : nextFiles.some(f => f.name === file.name && f.size === file.size);
          if (dup) continue;
          nextFiles.push(file);
        }
        try {
          validateAudioBatchSelection(nextFiles);
        } catch (error) {
          console.error('Audio selection validation failed:', error);
          alert(error instanceof AudioConvertError ? error.message : t('home.audioConvert.conversionError'));
          return;
        }
        selectedAudioFiles = nextFiles;
        renderAudioFiles();
      }

      function removeAudioFile(index) {
        selectedAudioFiles.splice(index, 1);
        renderAudioFiles();
      }

      function clearAudioFiles() {
        selectedAudioFiles = [];
        renderAudioFiles();
      }

      function renderAudioFiles() {
        if (!audioConvertFiles) return;
        audioConvertFiles.innerHTML = '';
        if (selectedAudioFiles.length > 0) {
          audioConvertFiles.classList.add('has-files');
        } else {
          audioConvertFiles.classList.remove('has-files');
        }
        selectedAudioFiles.forEach((file, index) => {
          const item = document.createElement('div');
          item.className = 'audio-convert-file-item';
          item.innerHTML = `
            <span class="audio-convert-file-name">${escapeHtml(file.name)}</span>
            <button class="audio-convert-file-remove" data-index="${index}" aria-label="remove">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          `;
          audioConvertFiles.appendChild(item);
        });
        audioConvertFiles.querySelectorAll('.audio-convert-file-remove').forEach(btn => {
          btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.index, 10);
            if (!isNaN(idx)) removeAudioFile(idx);
          });
        });
        enableSortableFileList(audioConvertFiles, selectedAudioFiles, renderAudioFiles, () => processingAudio);
        toggleAudioProcessButton();
      }

      function toggleAudioProcessButton() {
        if (!audioConvertProcessBtn) return;
        if (selectedAudioFiles.length > 0) {
          audioConvertProcessBtn.style.display = '';
          requestAnimationFrame(() => audioConvertProcessBtn.classList.add('visible'));
        } else {
          audioConvertProcessBtn.classList.remove('visible');
          const onTransitionEnd = (e) => {
            if (e.propertyName === 'opacity' && !audioConvertProcessBtn.classList.contains('visible')) {
              audioConvertProcessBtn.style.display = 'none';
              audioConvertProcessBtn.removeEventListener('transitionend', onTransitionEnd);
            }
          };
          audioConvertProcessBtn.addEventListener('transitionend', onTransitionEnd);
        }
      }

      function showAudioDropZone() {
        if (audioConvertDropZone) audioConvertDropZone.classList.add('visible');
        if (audioConvertOverlay) audioConvertOverlay.classList.add('drag-over');
      }

      function hideAudioDropZone() {
        if (audioConvertDropZone) audioConvertDropZone.classList.remove('visible');
        if (audioConvertOverlay) audioConvertOverlay.classList.remove('drag-over');
      }

      // Tauri native drag-drop events — provides file paths
      // Must use getCurrentWebview (not getCurrentWindow) because drag-drop
      // events are emitted at the Webview level, not the Window level.
      if (isTauri && audioConvertOverlay) {
        (async () => {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          const webview = getCurrentWebview();
          await webview.onDragDropEvent((event) => {
            if (!audioConvertOverlay.classList.contains('visible') || processingAudio) return;
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') {
              showAudioDropZone();
            } else if (payload.type === 'leave') {
              hideAudioDropZone();
            } else if (payload.type === 'drop') {
              hideAudioDropZone();
              const paths = payload.paths || [];
              if (paths.length === 0) return;
              const audioExts = ['mp3', 'aac', 'm4a', 'wav', 'flac', 'alac', 'ogg', 'wma'];
              const fileList = paths
                .filter(p => audioExts.some(ext => p.toLowerCase().endsWith('.' + ext)))
                .map(path => ({ name: path.split(/[\\/]/).pop() || path, path, size: 0 }));
              if (fileList.length > 0) {
                addAudioFiles(fileList);
              }
            }
          });
        })();
      }

      if (audioConvertCta) {
        audioConvertCta.addEventListener('click', async () => {
          if (isTauri) {
            try {
              const { open } = await import('@tauri-apps/plugin-dialog');
              const selected = await open({
                multiple: true,
                filters: [{
                  name: 'Audio Files',
                  extensions: ['mp3', 'aac', 'm4a', 'wav', 'flac', 'alac', 'ogg', 'wma']
                }]
              });
              if (selected && Array.isArray(selected)) {
                const fileList = selected.map(path => ({ name: path.split(/[\\/]/).pop() || path, path, size: 0 }));
                addAudioFiles(fileList);
              }
            } catch (e) {
              console.error('Audio file selection error', e);
            }
          } else {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = 'audio/*';
            input.addEventListener('change', () => {
              addAudioFiles(input.files);
              input.value = '';
            });
            input.click();
          }
        });
      }

      function showSuccessDialog(result) {
        const outputPath = result?.output_dir || (isTauri
          ? 'C:\\Users\\Downloads\\toolknit-converted'
          : '~/Downloads/toolknit-converted');
        const successCount = result?.success_count ?? selectedAudioFiles.length;
        const failCount = result?.fail_count ?? 0;
        const firstFileName = selectedAudioFiles[0]?.name || '';

        // All files failed — show error alert instead of success dialog
        if (failCount > 0 && successCount === 0) {
          const errorDetails = result?.errors?.length > 0
            ? result.errors.slice(0, 3).join('\n')
            : '';
          alert(t('home.audioConvert.allFailed', { count: failCount }) + (errorDetails ? '\n\n' + errorDetails : ''));
          return;
        }

        let summary;
        if (failCount > 0 && successCount > 0) {
          summary = t('home.audioConvert.successSummaryPartial', { success: successCount, fail: failCount, format: targetAudioFormat });
        } else if (successCount > 1) {
          summary = t('home.audioConvert.successSummaryPlural', { count: successCount, format: targetAudioFormat });
        } else {
          summary = t('home.audioConvert.successSummarySingle', { name: firstFileName, format: targetAudioFormat });
        }
        if (audioConvertSuccessMeta) {
          audioConvertSuccessMeta.textContent = summary;
        }
        if (audioConvertSuccessFormat) {
          audioConvertSuccessFormat.textContent = targetAudioFormat;
        }
        if (audioConvertSuccessCount) {
          audioConvertSuccessCount.textContent = `${successCount} ${t('home.audioConvert.successCountUnit')}`;
        }
        if (audioConvertSuccessPath) {
          audioConvertSuccessPath.textContent = outputPath;
        }
        lastOutputPath = outputPath;
        if (audioConvertSuccessOverlay) {
          audioConvertSuccessOverlay.classList.add('visible');
        }
      }

      function closeSuccessDialog() {
        if (audioConvertSuccessOverlay) {
          audioConvertSuccessOverlay.classList.remove('visible');
        }
        clearAudioFiles();
      }

      if (audioConvertCancelBtn) {
        audioConvertCancelBtn.addEventListener('click', cancelActiveAudioConversion);
      }

      function cancelActiveAudioConversion() {
        const wasProcessing = processingAudio;
        audioConversionRunId += 1;
        if (audioConvertUnlisten) {
          audioConvertUnlisten();
          audioConvertUnlisten = null;
        }
        if (audioConvertProcessMask) audioConvertProcessMask.classList.remove('visible');
        if (audioConvertProcessBarFill) audioConvertProcessBarFill.style.width = '0%';
        processingAudio = false;
        if (isTauri && wasProcessing) {
          import('@tauri-apps/api/core')
            .then(({ invoke }) => invoke('cancel_convert'))
            .catch((error) => console.error('Cancel failed:', error));
        }
      }

      async function startAudioProcessing() {
        if (!audioConvertProcessMask || !audioConvertProcessBarFill || processingAudio) return;
        if (selectedAudioFiles.length === 0) return;
        try {
          validateAudioBatchSelection(selectedAudioFiles);
          targetAudioFormat = normalizeAudioTargetFormat(targetAudioFormat);
        } catch (error) {
          alert(error instanceof AudioConvertError ? error.message : t('home.audioConvert.conversionError'));
          return;
        }
        const runId = ++audioConversionRunId;
        processingAudio = true;
        audioConvertProcessMask.classList.add('visible');
        audioConvertProcessBarFill.style.width = '0%';

        if (isTauri) {
          let unlisten = null;
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const { listen } = await import('@tauri-apps/api/event');

            const finalOutputDir = await getOutputDir('Audio');

            // Collect file paths from selectedAudioFiles
            const inputPaths = selectedAudioFiles.map(f => f.path).filter(Boolean);
            if (inputPaths.length === 0) {
              console.error('No valid file paths found in selectedAudioFiles:', selectedAudioFiles);
              if (runId === audioConversionRunId) {
                audioConvertProcessMask.classList.remove('visible');
                processingAudio = false;
              }
              alert(t('common.filePathsNotAvailable'));
              return;
            }

            let currentFile = 0;
            const totalFiles = inputPaths.length;

            // Ensure ffmpeg is available (prompt user to download if missing)
            const ffmpegReady = await ensureFfmpegAvailable();
            if (!ffmpegReady) {
              if (runId === audioConversionRunId) {
                audioConvertProcessMask.classList.remove('visible');
                processingAudio = false;
              }
              return;
            }

            unlisten = await listen('convert-progress', (event) => {
              if (runId !== audioConversionRunId) return;
              const data = event.payload;
              if (data.status === 'converting') {
                currentFile = data.current;
                const fileProgress = (data.current - 1 + data.progress) / data.total;
                const percent = Math.min(99, Math.round(fileProgress * 100));
                audioConvertProcessBarFill.style.width = `${percent}%`;
                if (audioConvertProcessText) {
                  audioConvertProcessText.textContent = `${t('home.audioConvert.processing')} (${data.current}/${data.total})`;
                }
              }
            });
            if (runId !== audioConversionRunId) {
              unlisten();
              return;
            }
            audioConvertUnlisten = unlisten;

            const result = await invoke('convert_audio_batch', {
              inputPaths: inputPaths,
              outputDir: finalOutputDir,
              targetFormat: targetAudioFormat,
              quality: null
            });

            unlisten();
            if (audioConvertUnlisten === unlisten) audioConvertUnlisten = null;
            if (runId !== audioConversionRunId) return;
            audioConvertProcessBarFill.style.width = '100%';

            setTimeout(() => {
              if (runId !== audioConversionRunId) return;
              audioConvertProcessMask.classList.remove('visible');
              audioConvertProcessBarFill.style.width = '0%';
              processingAudio = false;
              showSuccessDialog(result);
            }, 400);
          } catch (e) {
            console.error('Conversion failed:', e);
            if (unlisten) unlisten();
            if (audioConvertUnlisten === unlisten) audioConvertUnlisten = null;
            if (runId !== audioConversionRunId) return;
            audioConvertProcessMask.classList.remove('visible');
            audioConvertProcessBarFill.style.width = '0%';
            processingAudio = false;
            if (audioConvertProcessText) {
              audioConvertProcessText.textContent = t('home.audioConvert.processing');
            }
            alert(t('common.errorOccurred', { error: e?.message || e }));
          }
        } else {
          audioConvertProcessMask.classList.remove('visible');
          audioConvertProcessBarFill.style.width = '0%';
          processingAudio = false;
          alert(t('home.audioConvert.desktopOnly'));
        }
      }

      if (audioConvertProcessBtn) {
        audioConvertProcessBtn.addEventListener('click', () => {
          if (selectedAudioFiles.length > 0) startAudioProcessing();
        });
      }

      if (audioConvertSuccessOk) {
        audioConvertSuccessOk.addEventListener('click', () => {
          closeSuccessDialog();
        });
      }

      let lastOutputPath = '';
      if (audioConvertOpenFolder) {
        audioConvertOpenFolder.addEventListener('click', () => {
          if (isTauri && lastOutputPath) {
            openOutputFolder(lastOutputPath).catch(e => console.error('Open folder error', e));
          }
          closeSuccessDialog();
        });
      }

      if (audioConvertFormatOptions) {
        audioConvertFormatOptions.addEventListener('click', (e) => {
          const btn = e.target.closest('.audio-convert-format-option');
          if (!btn) return;
          audioConvertFormatOptions.querySelectorAll('.audio-convert-format-option').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          targetAudioFormat = normalizeAudioTargetFormat(btn.dataset.format);
        });
      }

      function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      function enableSortableFileList(container, files, render, isLocked = () => false) {
        if (!container || !Array.isArray(files)) return;
        const rows = Array.from(container.querySelectorAll(':scope > .audio-convert-file-item'));
        let draggingIndex = -1;
        rows.forEach((row, index) => {
          row.dataset.sortIndex = String(index);
          row.draggable = files.length > 1 && !isLocked();
          row.classList.toggle('is-sortable', row.draggable);
          row.addEventListener('dragstart', event => {
            const targetElement = event.target instanceof Element ? event.target : null;
            if (!row.draggable || targetElement?.closest('button, input, select, textarea, a')) {
              event.preventDefault();
              return;
            }
            draggingIndex = index;
            row.classList.add('dragging');
            event.dataTransfer?.setData('text/plain', String(index));
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
          });
          row.addEventListener('dragend', () => {
            draggingIndex = -1;
            rows.forEach(item => item.classList.remove('dragging', 'drag-target'));
          });
          row.addEventListener('dragover', event => {
            if (draggingIndex < 0 || isLocked()) return;
            event.preventDefault();
            rows.forEach(item => item.classList.remove('drag-target'));
            if (draggingIndex !== index) row.classList.add('drag-target');
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          });
          row.addEventListener('drop', event => {
            if (draggingIndex < 0 || isLocked()) return;
            event.preventDefault();
            const from = draggingIndex;
            const to = Number(row.dataset.sortIndex);
            if (!Number.isInteger(to) || from === to || from < 0 || from >= files.length || to < 0 || to >= files.length) {
              rows.forEach(item => item.classList.remove('dragging', 'drag-target'));
              return;
            }
            const [moved] = files.splice(from, 1);
            files.splice(to, 0, moved);
            render();
          });
        });
      }

      // ===== Image Convert Tool =====
      const imageConvertOverlay = document.getElementById('imageConvertOverlay');
      const imageConvertBack = document.getElementById('imageConvertBack');
      const imageConvertPlasmaBg = document.getElementById('imageConvertPlasmaBg');
      let imageConvertPlasmaInstance = null;

      function openImageConvertOverlay() {
        if (!imageConvertOverlay) return;
        imageConvertOverlay.classList.add('visible');
        if (imageConvertPlasmaBg && !imageConvertPlasmaInstance) {
          imageConvertPlasmaInstance = initPlasma(imageConvertPlasmaBg, {
            color: '#6B6B6B', speed: 0.8, direction: 'forward', scale: 1, opacity: 1, mouseInteractive: false
          });
        }
      }

      function closeImageConvertOverlay() {
        if (!imageConvertOverlay) return;
        imageConvertOverlay.classList.remove('visible');
        if (imageConvertPlasmaInstance) { imageConvertPlasmaInstance(); imageConvertPlasmaInstance = null; }
        cancelActiveImageConversion();
        processingImage = false;
        imageConvertProcessMask.classList.remove('visible');
        imageConvertProcessBarFill.style.width = '0%';
        clearImageFiles();
      }

      if (imageConvertBack) imageConvertBack.addEventListener('click', closeImageConvertOverlay);

      document.querySelectorAll('.audio-list-item[data-tool="image-convert"]').forEach(item => {
        item.addEventListener('click', () => openImageConvertOverlay());
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openImageConvertOverlay(); }
        });
      });

      const imageConvertDropZone = document.getElementById('imageConvertDropZone');
      const imageConvertFiles = document.getElementById('imageConvertFiles');
      const imageConvertCta = document.getElementById('imageConvertCta');
      const imageConvertProcessBtn = document.getElementById('imageConvertProcessBtn');
      const imageConvertProcessMask = document.getElementById('imageConvertProcessMask');
      const imageConvertProcessBarFill = document.getElementById('imageConvertProcessBarFill');
      const imageConvertProcessText = document.getElementById('imageConvertProcessText');
      const imageConvertCancelBtn = document.getElementById('imageConvertCancelBtn');
      let selectedImageFiles = [];
      let processingImage = false;
      let targetImageFormat = 'PNG';
      let imageConversionRunId = 0;
      let imageConvertUnlisten = null;
      const imageConvertSuccessOverlay = document.getElementById('imageConvertSuccessOverlay');
      const imageConvertSuccessPath = document.getElementById('imageConvertSuccessPath');
      const imageConvertSuccessMeta = document.getElementById('imageConvertSuccessMeta');
      const imageConvertSuccessFormat = document.getElementById('imageConvertSuccessFormat');
      const imageConvertSuccessCount = document.getElementById('imageConvertSuccessCount');
      const imageConvertOpenFolder = document.getElementById('imageConvertOpenFolder');
      const imageConvertSuccessOk = document.getElementById('imageConvertSuccessOk');
      const imageConvertFormatOptions = document.getElementById('imageConvertFormatOptions');
      const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'];

      function addImageFiles(fileList) {
        if (!fileList || fileList.length === 0) return;
        const nextFiles = [...selectedImageFiles];
        for (const file of fileList) {
          const dup = file.path
            ? nextFiles.some(f => f.path === file.path)
            : nextFiles.some(f => f.name === file.name && f.size === file.size);
          if (dup) continue;
          nextFiles.push(file);
        }
        try {
          validateImageBatchSelection(nextFiles);
        } catch (error) {
          const message = error instanceof ImageBatchError ? error.message : t('home.imageConvert.conversionError');
          alert(t('home.imageConvert.selectionError', { error: message }));
          return;
        }
        selectedImageFiles = nextFiles;
        renderImageFiles();
      }

      function removeImageFile(index) { selectedImageFiles.splice(index, 1); renderImageFiles(); }
      function clearImageFiles() { selectedImageFiles = []; renderImageFiles(); }

      function renderImageFiles() {
        if (!imageConvertFiles) return;
        imageConvertFiles.innerHTML = '';
        if (selectedImageFiles.length > 0) imageConvertFiles.classList.add('has-files');
        else imageConvertFiles.classList.remove('has-files');
        selectedImageFiles.forEach((file, index) => {
          const item = document.createElement('div');
          item.className = 'audio-convert-file-item';
          item.innerHTML = `<span class="audio-convert-file-name">${escapeHtml(file.name)}</span><button class="audio-convert-file-remove" data-index="${index}" aria-label="remove"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>`;
          imageConvertFiles.appendChild(item);
        });
        imageConvertFiles.querySelectorAll('.audio-convert-file-remove').forEach(btn => {
          btn.addEventListener('click', () => { const idx = parseInt(btn.dataset.index, 10); if (!isNaN(idx)) removeImageFile(idx); });
        });
        enableSortableFileList(imageConvertFiles, selectedImageFiles, renderImageFiles, () => processingImage);
        toggleImageProcessButton();
      }

      function toggleImageProcessButton() {
        if (!imageConvertProcessBtn) return;
        if (selectedImageFiles.length > 0) {
          imageConvertProcessBtn.style.display = '';
          requestAnimationFrame(() => imageConvertProcessBtn.classList.add('visible'));
        } else {
          imageConvertProcessBtn.classList.remove('visible');
          const onTransitionEnd = (e) => {
            if (e.propertyName === 'opacity' && !imageConvertProcessBtn.classList.contains('visible')) {
              imageConvertProcessBtn.style.display = 'none';
              imageConvertProcessBtn.removeEventListener('transitionend', onTransitionEnd);
            }
          };
          imageConvertProcessBtn.addEventListener('transitionend', onTransitionEnd);
        }
      }

      function showImageDropZone() {
        if (imageConvertDropZone) imageConvertDropZone.classList.add('visible');
        if (imageConvertOverlay) imageConvertOverlay.classList.add('drag-over');
      }
      function hideImageDropZone() {
        if (imageConvertDropZone) imageConvertDropZone.classList.remove('visible');
        if (imageConvertOverlay) imageConvertOverlay.classList.remove('drag-over');
      }

      if (isTauri && imageConvertOverlay) {
        (async () => {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          const webview = getCurrentWebview();
          await webview.onDragDropEvent((event) => {
            if (!imageConvertOverlay.classList.contains('visible') || processingImage) return;
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') showImageDropZone();
            else if (payload.type === 'leave') hideImageDropZone();
            else if (payload.type === 'drop') {
              hideImageDropZone();
              const paths = payload.paths || [];
              if (paths.length === 0) return;
              const fileList = paths
                .filter(p => imageExts.some(ext => p.toLowerCase().endsWith('.' + ext)))
                .map(path => ({ name: path.split(/[\\/]/).pop() || path, path, size: 0 }));
              if (fileList.length > 0) addImageFiles(fileList);
            }
          });
        })();
      }

      if (imageConvertCta) {
        imageConvertCta.addEventListener('click', async () => {
          if (isTauri) {
            try {
              const { open } = await import('@tauri-apps/plugin-dialog');
              const selected = await open({ multiple: true, filters: [{ name: 'Image Files', extensions: imageExts }] });
              if (selected && Array.isArray(selected)) {
                addImageFiles(selected.map(path => ({ name: path.split(/[\\/]/).pop() || path, path, size: 0 })));
              }
            } catch (e) { console.error('Image file selection error', e); }
          } else {
            const input = document.createElement('input');
            input.type = 'file'; input.multiple = true; input.accept = 'image/*';
            input.addEventListener('change', () => { addImageFiles(input.files); input.value = ''; });
            input.click();
          }
        });
      }

      function showImageSuccessDialog(result) {
        const outputPath = result?.output_dir || (isTauri ? 'C:\\Users\\Downloads\\toolknit-converted' : '~/Downloads/toolknit-converted');
        const successCount = result?.success_count ?? selectedImageFiles.length;
        const failCount = result?.fail_count ?? 0;
        const firstFileName = selectedImageFiles[0]?.name || '';
        let summary;
        if (failCount > 0 && successCount > 0) {
          summary = t('home.imageConvert.successSummaryPartial', { success: successCount, fail: failCount, format: targetImageFormat });
        } else if (failCount > 0 && successCount === 0) {
          summary = t('home.imageConvert.allFailed', { count: failCount });
        } else if (successCount > 1) {
          summary = t('home.imageConvert.successSummaryPlural', { count: successCount, format: targetImageFormat });
        } else {
          summary = t('home.imageConvert.successSummarySingle', { name: firstFileName, format: targetImageFormat });
        }
        if (imageConvertSuccessMeta) imageConvertSuccessMeta.textContent = summary;
        if (imageConvertSuccessFormat) imageConvertSuccessFormat.textContent = targetImageFormat;
        if (imageConvertSuccessCount) imageConvertSuccessCount.textContent = `${successCount} ${t('home.imageConvert.successCountUnit')}`;
        if (imageConvertSuccessPath) imageConvertSuccessPath.textContent = outputPath;
        lastImageOutputPath = outputPath;
        if (imageConvertSuccessOverlay) imageConvertSuccessOverlay.classList.add('visible');
      }

      function closeImageSuccessDialog() {
        if (imageConvertSuccessOverlay) imageConvertSuccessOverlay.classList.remove('visible');
        clearImageFiles();
      }

      if (imageConvertCancelBtn) {
        imageConvertCancelBtn.addEventListener('click', cancelActiveImageConversion);
      }

      function cancelActiveImageConversion() {
        const wasProcessing = processingImage;
        imageConversionRunId += 1;
        if (imageConvertUnlisten) {
          imageConvertUnlisten();
          imageConvertUnlisten = null;
        }
        if (imageConvertProcessMask) imageConvertProcessMask.classList.remove('visible');
        if (imageConvertProcessBarFill) imageConvertProcessBarFill.style.width = '0%';
        processingImage = false;
        if (isTauri && wasProcessing) {
          import('@tauri-apps/api/core')
            .then(({ invoke }) => invoke('cancel_convert'))
            .catch((error) => console.error('Cancel failed:', error));
        }
      }

      async function startImageProcessing() {
        if (!imageConvertProcessMask || !imageConvertProcessBarFill || processingImage) return;
        if (selectedImageFiles.length === 0) return;
        try {
          validateImageBatchSelection(selectedImageFiles);
          targetImageFormat = normalizeImageTargetFormat(targetImageFormat);
        } catch (error) {
          const message = error instanceof ImageBatchError ? error.message : t('home.imageConvert.conversionError');
          alert(t('home.imageConvert.selectionError', { error: message }));
          return;
        }
        const runId = ++imageConversionRunId;
        processingImage = true;
        imageConvertProcessMask.classList.add('visible');
        imageConvertProcessBarFill.style.width = '0%';

        if (isTauri) {
          let unlisten = null;
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const { listen } = await import('@tauri-apps/api/event');

            const finalOutputDir = await getOutputDir('Images');

            const inputPaths = selectedImageFiles.map(f => f.path).filter(Boolean);
            if (inputPaths.length === 0) {
              if (runId === imageConversionRunId) {
                imageConvertProcessMask.classList.remove('visible');
                processingImage = false;
              }
              alert(t('common.filePathsNotAvailableShort')); return;
            }

            unlisten = await listen('convert-progress', (event) => {
              if (runId !== imageConversionRunId) return;
              const data = event.payload;
              if (data.status === 'converting') {
                const fileProgress = (data.current - 1 + data.progress) / data.total;
                const percent = Math.min(99, Math.round(fileProgress * 100));
                imageConvertProcessBarFill.style.width = `${percent}%`;
                if (imageConvertProcessText) imageConvertProcessText.textContent = `${t('home.imageConvert.processing')} (${data.current}/${data.total})`;
              }
            });
            if (runId !== imageConversionRunId) {
              unlisten();
              return;
            }
            imageConvertUnlisten = unlisten;

            const result = await invoke('convert_image_batch', { inputPaths, outputDir: finalOutputDir, targetFormat: targetImageFormat });
            if (unlisten) unlisten();
            if (imageConvertUnlisten === unlisten) imageConvertUnlisten = null;
            if (runId !== imageConversionRunId) return;
            imageConvertProcessBarFill.style.width = '100%';
            setTimeout(() => {
              if (runId !== imageConversionRunId) return;
              imageConvertProcessMask.classList.remove('visible');
              imageConvertProcessBarFill.style.width = '0%';
              processingImage = false;
              if (result?.success_count === 0 && result?.fail_count > 0) {
                alert(t('home.imageConvert.allFailed', { count: result.fail_count }));
                return;
              }
              showImageSuccessDialog(result);
            }, 400);
          } catch (e) {
            console.error('Image conversion failed:', e);
            if (unlisten) unlisten();
            if (imageConvertUnlisten === unlisten) imageConvertUnlisten = null;
            if (runId !== imageConversionRunId) return;
            imageConvertProcessMask.classList.remove('visible');
            imageConvertProcessBarFill.style.width = '0%';
            processingImage = false;
            if (imageConvertProcessText) imageConvertProcessText.textContent = t('home.imageConvert.processing');
            alert(t('common.errorOccurred', { error: e?.message || e }));
          }
        } else {
          imageConvertProcessMask.classList.remove('visible');
          imageConvertProcessBarFill.style.width = '0%';
          processingImage = false;
          alert(t('home.imageConvert.desktopOnly'));
        }
      }

      if (imageConvertProcessBtn) imageConvertProcessBtn.addEventListener('click', () => { if (selectedImageFiles.length > 0) startImageProcessing(); });
      if (imageConvertSuccessOk) imageConvertSuccessOk.addEventListener('click', () => closeImageSuccessDialog());

      let lastImageOutputPath = '';
      if (imageConvertOpenFolder) {
        imageConvertOpenFolder.addEventListener('click', () => {
          if (isTauri && lastImageOutputPath) {
            openOutputFolder(lastImageOutputPath).catch(e => console.error('Open folder error', e));
          }
          closeImageSuccessDialog();
        });
      }

      if (imageConvertFormatOptions) {
        imageConvertFormatOptions.addEventListener('click', (e) => {
          const btn = e.target.closest('.audio-convert-format-option');
          if (!btn) return;
          imageConvertFormatOptions.querySelectorAll('.audio-convert-format-option').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          targetImageFormat = normalizeImageTargetFormat(btn.dataset.format);
        });
      }

      // ===== Image Compress Tool =====
      const imageCompressOverlay = document.getElementById('imageCompressOverlay');
      const imageCompressBack = document.getElementById('imageCompressBack');
      const imageCompressPlasmaBg = document.getElementById('imageCompressPlasmaBg');
      let imageCompressPlasmaInstance = null;

      function openImageCompressOverlay() {
        if (!imageCompressOverlay) return;
        imageCompressOverlay.classList.add('visible');
        if (imageCompressPlasmaBg && !imageCompressPlasmaInstance) {
          imageCompressPlasmaInstance = initPlasma(imageCompressPlasmaBg, {
            color: '#6B6B6B', speed: 0.8, direction: 'forward', scale: 1, opacity: 1, mouseInteractive: false
          });
        }
      }

      function closeImageCompressOverlay() {
        if (!imageCompressOverlay) return;
        imageCompressOverlay.classList.remove('visible');
        if (imageCompressPlasmaInstance) { imageCompressPlasmaInstance(); imageCompressPlasmaInstance = null; }
        cancelActiveImageCompression();
        processingImageCompress = false;
        imageCompressProcessMask.classList.remove('visible');
        imageCompressProcessBarFill.style.width = '0%';
        clearImageCompressFiles();
      }

      if (imageCompressBack) imageCompressBack.addEventListener('click', closeImageCompressOverlay);

      document.querySelectorAll('.audio-list-item[data-tool="image-compress"]').forEach(item => {
        item.addEventListener('click', () => openImageCompressOverlay());
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openImageCompressOverlay(); }
        });
      });

      const imageCompressDropZone = document.getElementById('imageCompressDropZone');
      const imageCompressFiles = document.getElementById('imageCompressFiles');
      const imageCompressCta = document.getElementById('imageCompressCta');
      const imageCompressProcessBtn = document.getElementById('imageCompressProcessBtn');
      const imageCompressProcessMask = document.getElementById('imageCompressProcessMask');
      const imageCompressProcessBarFill = document.getElementById('imageCompressProcessBarFill');
      const imageCompressProcessText = document.getElementById('imageCompressProcessText');
      const imageCompressCancelBtn = document.getElementById('imageCompressCancelBtn');
      let selectedImageCompressFiles = [];
      let processingImageCompress = false;
      let targetCompressQuality = 'medium';
      let imageCompressionRunId = 0;
      let imageCompressUnlisten = null;
      const imageCompressSuccessOverlay = document.getElementById('imageCompressSuccessOverlay');
      const imageCompressSuccessPath = document.getElementById('imageCompressSuccessPath');
      const imageCompressSuccessMeta = document.getElementById('imageCompressSuccessMeta');
      const imageCompressSuccessFormat = document.getElementById('imageCompressSuccessFormat');
      const imageCompressSuccessCount = document.getElementById('imageCompressSuccessCount');
      const imageCompressOpenFolder = document.getElementById('imageCompressOpenFolder');
      const imageCompressSuccessOk = document.getElementById('imageCompressSuccessOk');
      const imageCompressQualityOptions = document.getElementById('imageCompressQualityOptions');
      const compressExts = ['jpg', 'jpeg', 'png', 'webp'];
      const qualityLabelMap = { high: 'home.imageCompress.qualityHigh', medium: 'home.imageCompress.qualityMedium', low: 'home.imageCompress.qualityLow' };

      function addImageCompressFiles(fileList) {
        if (!fileList || fileList.length === 0) return;
        const nextFiles = [...selectedImageCompressFiles];
        for (const file of fileList) {
          const dup = file.path
            ? nextFiles.some(f => f.path === file.path)
            : nextFiles.some(f => f.name === file.name && f.size === file.size);
          if (dup) continue;
          nextFiles.push(file);
        }
        try {
          validateImageCompressionSelection(nextFiles);
        } catch (error) {
          const message = error instanceof ImageBatchError ? error.message : t('home.imageCompress.conversionError');
          alert(t('home.imageCompress.selectionError', { error: message }));
          return;
        }
        selectedImageCompressFiles = nextFiles;
        renderImageCompressFiles();
      }

      function removeImageCompressFile(index) { selectedImageCompressFiles.splice(index, 1); renderImageCompressFiles(); }
      function clearImageCompressFiles() { selectedImageCompressFiles = []; renderImageCompressFiles(); }

      function renderImageCompressFiles() {
        if (!imageCompressFiles) return;
        imageCompressFiles.innerHTML = '';
        if (selectedImageCompressFiles.length > 0) imageCompressFiles.classList.add('has-files');
        else imageCompressFiles.classList.remove('has-files');
        selectedImageCompressFiles.forEach((file, index) => {
          const item = document.createElement('div');
          item.className = 'audio-convert-file-item';
          item.innerHTML = `<span class="audio-convert-file-name">${escapeHtml(file.name)}</span><button class="audio-convert-file-remove" data-index="${index}" aria-label="remove"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>`;
          imageCompressFiles.appendChild(item);
        });
        imageCompressFiles.querySelectorAll('.audio-convert-file-remove').forEach(btn => {
          btn.addEventListener('click', () => { const idx = parseInt(btn.dataset.index, 10); if (!isNaN(idx)) removeImageCompressFile(idx); });
        });
        enableSortableFileList(imageCompressFiles, selectedImageCompressFiles, renderImageCompressFiles, () => processingImageCompress);
        toggleImageCompressProcessButton();
      }

      function toggleImageCompressProcessButton() {
        if (!imageCompressProcessBtn) return;
        if (selectedImageCompressFiles.length > 0) {
          imageCompressProcessBtn.style.display = '';
          requestAnimationFrame(() => imageCompressProcessBtn.classList.add('visible'));
        } else {
          imageCompressProcessBtn.classList.remove('visible');
          const onTransitionEnd = (e) => {
            if (e.propertyName === 'opacity' && !imageCompressProcessBtn.classList.contains('visible')) {
              imageCompressProcessBtn.style.display = 'none';
              imageCompressProcessBtn.removeEventListener('transitionend', onTransitionEnd);
            }
          };
          imageCompressProcessBtn.addEventListener('transitionend', onTransitionEnd);
        }
      }

      function showImageCompressDropZone() {
        if (imageCompressDropZone) imageCompressDropZone.classList.add('visible');
        if (imageCompressOverlay) imageCompressOverlay.classList.add('drag-over');
      }
      function hideImageCompressDropZone() {
        if (imageCompressDropZone) imageCompressDropZone.classList.remove('visible');
        if (imageCompressOverlay) imageCompressOverlay.classList.remove('drag-over');
      }

      if (isTauri && imageCompressOverlay) {
        (async () => {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          const webview = getCurrentWebview();
          await webview.onDragDropEvent((event) => {
            if (!imageCompressOverlay.classList.contains('visible') || processingImageCompress) return;
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') showImageCompressDropZone();
            else if (payload.type === 'leave') hideImageCompressDropZone();
            else if (payload.type === 'drop') {
              hideImageCompressDropZone();
              const paths = payload.paths || [];
              if (paths.length === 0) return;
              const fileList = paths
                .filter(p => compressExts.some(ext => p.toLowerCase().endsWith('.' + ext)))
                .map(path => ({ name: path.split(/[\\/]/).pop() || path, path, size: 0 }));
              if (fileList.length > 0) addImageCompressFiles(fileList);
            }
          });
        })();
      }

      if (imageCompressCta) {
        imageCompressCta.addEventListener('click', async () => {
          if (isTauri) {
            try {
              const { open } = await import('@tauri-apps/plugin-dialog');
              const selected = await open({ multiple: true, filters: [{ name: 'Image Files', extensions: compressExts }] });
              if (selected && Array.isArray(selected)) {
                addImageCompressFiles(selected.map(path => ({ name: path.split(/[\\/]/).pop() || path, path, size: 0 })));
              }
            } catch (e) { console.error('Image compress file selection error', e); }
          } else {
            const input = document.createElement('input');
            input.type = 'file'; input.multiple = true; input.accept = 'image/*';
            input.addEventListener('change', () => { addImageCompressFiles(input.files); input.value = ''; });
            input.click();
          }
        });
      }

      function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        let val = bytes;
        while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
        return i === 0 ? `${val} ${units[i]}` : `${val.toFixed(2)} ${units[i]}`;
      }

      function showImageCompressSuccessDialog(result) {
        const outputPath = result?.output_dir || (isTauri ? 'C:\\Users\\Downloads\\toolknit-compressed' : '~/Downloads/toolknit-compressed');
        const successCount = result?.success_count ?? selectedImageCompressFiles.length;
        const failCount = result?.fail_count ?? 0;
        const firstFileName = selectedImageCompressFiles[0]?.name || '';
        const baseQualityText = t(qualityLabelMap[targetCompressQuality] || 'home.imageCompress.qualityMedium');
        const hasWebp = selectedImageCompressFiles.some(file => /\.webp$/i.test(file.name || ''));
        const hasNonWebp = selectedImageCompressFiles.some(file => !/\.webp$/i.test(file.name || ''));
        const qualityText = hasWebp
          ? (hasNonWebp ? `${baseQualityText} / ${t('home.imageCompress.webpLossless')}` : t('home.imageCompress.webpLossless'))
          : baseQualityText;
        let summary;
        if (failCount > 0 && successCount > 0) {
          summary = t('home.imageCompress.successSummaryPartial', { success: successCount, fail: failCount, format: qualityText });
        } else if (failCount > 0 && successCount === 0) {
          summary = t('home.imageCompress.allFailed', { count: failCount });
        } else if (successCount > 1) {
          summary = t('home.imageCompress.successSummaryPlural', { count: successCount, format: qualityText });
        } else {
          summary = t('home.imageCompress.successSummarySingle', { name: firstFileName, format: qualityText });
        }
        if (imageCompressSuccessMeta) imageCompressSuccessMeta.textContent = summary;
        if (imageCompressSuccessFormat) imageCompressSuccessFormat.textContent = qualityText;
        if (imageCompressSuccessCount) imageCompressSuccessCount.textContent = `${successCount} ${t('home.imageCompress.successCountUnit')}`;
        if (imageCompressSuccessPath) imageCompressSuccessPath.textContent = outputPath;

        const origSize = result?.original_size ?? 0;
        const compSize = result?.compressed_size ?? 0;
        const savedBytes = origSize - compSize;
        const savedPercent = origSize > 0 ? Math.round((savedBytes / origSize) * 100) : 0;
        const origEl = document.getElementById('imageCompressSuccessOriginalSize');
        const compEl = document.getElementById('imageCompressSuccessCompressedSize');
        const savedEl = document.getElementById('imageCompressSuccessSavedSize');
        if (origEl) origEl.textContent = formatBytes(origSize);
        if (compEl) compEl.textContent = formatBytes(compSize);
        if (savedEl) savedEl.textContent = `${formatBytes(savedBytes)} (${savedPercent}%)`;

        lastImageCompressOutputPath = outputPath;
        if (imageCompressSuccessOverlay) imageCompressSuccessOverlay.classList.add('visible');
      }

      function closeImageCompressSuccessDialog() {
        if (imageCompressSuccessOverlay) imageCompressSuccessOverlay.classList.remove('visible');
        clearImageCompressFiles();
      }

      if (imageCompressCancelBtn) {
        imageCompressCancelBtn.addEventListener('click', cancelActiveImageCompression);
      }

      function cancelActiveImageCompression() {
        const wasProcessing = processingImageCompress;
        imageCompressionRunId += 1;
        if (imageCompressUnlisten) {
          imageCompressUnlisten();
          imageCompressUnlisten = null;
        }
        if (imageCompressProcessMask) imageCompressProcessMask.classList.remove('visible');
        if (imageCompressProcessBarFill) imageCompressProcessBarFill.style.width = '0%';
        processingImageCompress = false;
        if (isTauri && wasProcessing) {
          import('@tauri-apps/api/core')
            .then(({ invoke }) => invoke('cancel_convert'))
            .catch((error) => console.error('Cancel failed:', error));
        }
      }

      async function startImageCompressProcessing() {
        if (!imageCompressProcessMask || !imageCompressProcessBarFill || processingImageCompress) return;
        if (selectedImageCompressFiles.length === 0) return;
        try {
          validateImageCompressionSelection(selectedImageCompressFiles);
          targetCompressQuality = normalizeImageCompressionQuality(targetCompressQuality);
        } catch (error) {
          const message = error instanceof ImageBatchError ? error.message : t('home.imageCompress.conversionError');
          alert(t('home.imageCompress.selectionError', { error: message }));
          return;
        }
        const runId = ++imageCompressionRunId;
        processingImageCompress = true;
        imageCompressProcessMask.classList.add('visible');
        imageCompressProcessBarFill.style.width = '0%';

        if (isTauri) {
          let unlisten = null;
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const { listen } = await import('@tauri-apps/api/event');

            const finalOutputDir = await getOutputDir('Images');

            const inputPaths = selectedImageCompressFiles.map(f => f.path).filter(Boolean);
            if (inputPaths.length === 0) {
              if (runId === imageCompressionRunId) {
                imageCompressProcessMask.classList.remove('visible');
                processingImageCompress = false;
              }
              alert(t('common.filePathsNotAvailableShort')); return;
            }

            unlisten = await listen('convert-progress', (event) => {
              if (runId !== imageCompressionRunId) return;
              const data = event.payload;
              if (data.status === 'converting') {
                const fileProgress = (data.current - 1 + data.progress) / data.total;
                const percent = Math.min(99, Math.round(fileProgress * 100));
                imageCompressProcessBarFill.style.width = `${percent}%`;
                if (imageCompressProcessText) imageCompressProcessText.textContent = `${t('home.imageCompress.processing')} (${data.current}/${data.total})`;
              }
            });
            if (runId !== imageCompressionRunId) {
              unlisten();
              return;
            }
            imageCompressUnlisten = unlisten;

            const result = await invoke('compress_image_batch', { inputPaths, outputDir: finalOutputDir, quality: targetCompressQuality });
            if (unlisten) unlisten();
            if (imageCompressUnlisten === unlisten) imageCompressUnlisten = null;
            if (runId !== imageCompressionRunId) return;
            imageCompressProcessBarFill.style.width = '100%';
            setTimeout(() => {
              if (runId !== imageCompressionRunId) return;
              imageCompressProcessMask.classList.remove('visible');
              imageCompressProcessBarFill.style.width = '0%';
              processingImageCompress = false;
              if (result?.success_count === 0 && result?.fail_count > 0) {
                const onlyNoSmallerOutputs = Array.isArray(result.errors)
                  && result.errors.length > 0
                  && result.errors.every((error) => String(error).includes('no smaller output was produced'));
                alert(onlyNoSmallerOutputs
                  ? t('home.imageCompress.noSmallerOutput')
                  : t('home.imageCompress.allFailed', { count: result.fail_count }));
                return;
              }
              showImageCompressSuccessDialog(result);
            }, 400);
          } catch (e) {
            console.error('Image compression failed:', e);
            if (unlisten) unlisten();
            if (imageCompressUnlisten === unlisten) imageCompressUnlisten = null;
            if (runId !== imageCompressionRunId) return;
            imageCompressProcessMask.classList.remove('visible');
            imageCompressProcessBarFill.style.width = '0%';
            processingImageCompress = false;
            if (imageCompressProcessText) imageCompressProcessText.textContent = t('home.imageCompress.processing');
            alert(t('common.errorOccurred', { error: e?.message || e }));
          }
        } else {
          imageCompressProcessMask.classList.remove('visible');
          imageCompressProcessBarFill.style.width = '0%';
          processingImageCompress = false;
          alert(t('home.imageCompress.desktopOnly'));
        }
      }

      if (imageCompressProcessBtn) imageCompressProcessBtn.addEventListener('click', () => { if (selectedImageCompressFiles.length > 0) startImageCompressProcessing(); });
      if (imageCompressSuccessOk) imageCompressSuccessOk.addEventListener('click', () => closeImageCompressSuccessDialog());

      let lastImageCompressOutputPath = '';
      if (imageCompressOpenFolder) {
        imageCompressOpenFolder.addEventListener('click', () => {
          if (isTauri && lastImageCompressOutputPath) {
            openOutputFolder(lastImageCompressOutputPath).catch(e => console.error('Open folder error', e));
          }
          closeImageCompressSuccessDialog();
        });
      }

      if (imageCompressQualityOptions) {
        imageCompressQualityOptions.addEventListener('click', (e) => {
          const btn = e.target.closest('.audio-convert-format-option');
          if (!btn) return;
          imageCompressQualityOptions.querySelectorAll('.audio-convert-format-option').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          targetCompressQuality = normalizeImageCompressionQuality(btn.dataset.quality);
        });
      }

      // ===== Icon Generator Tool =====
      const iconGenOverlay = document.getElementById('iconGenOverlay');
      const iconGenBack = document.getElementById('iconGenBack');
      const iconGenPlasmaBg = document.getElementById('iconGenPlasmaBg');
      const iconGenCta = document.getElementById('iconGenCta');
      const iconGenProcessBtn = document.getElementById('iconGenProcessBtn');
      const iconGenFiles = document.getElementById('iconGenFiles');
      const iconGenDropZone = document.getElementById('iconGenDropZone');
      const iconGenProcessMask = document.getElementById('iconGenProcessMask');
      const iconGenProcessBarFill = document.getElementById('iconGenProcessBarFill');
      const iconGenProcessText = document.getElementById('iconGenProcessText');
      const iconGenCancelBtn = document.getElementById('iconGenCancelBtn');
      let iconGenPlasmaInstance = null;
      let lastIconGenDownloadDir = '';
      let selectedIconGenFile = null;
      let selectedIconGenImage = null;
      let selectedIconGenFileSize = 0;
      let processingIconGen = false;
      let iconGenObjectUrl = null;
      let iconGenRunId = 0;

      const ALL_SIZES = [16, 24, 32, 48, 64, 96, 128, 144, 152, 167, 180, 192, 256, 384, 512, 1024];
      const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

      function openIconGenOverlay() {
        if (!iconGenOverlay) return;
        iconGenOverlay.classList.add('visible');
        if (iconGenPlasmaBg && !iconGenPlasmaInstance) {
          iconGenPlasmaInstance = initPlasma(iconGenPlasmaBg, {
            color: '#6B6B6B', speed: 0.8, direction: 'forward', scale: 1, opacity: 1, mouseInteractive: false
          });
        }
      }

      function closeIconGenOverlay() {
        if (!iconGenOverlay) return;
        cancelIconGenProcessing();
        iconGenOverlay.classList.remove('visible');
        if (iconGenPlasmaInstance) {
          iconGenPlasmaInstance();
          iconGenPlasmaInstance = null;
        }
        if (iconGenProcessMask) iconGenProcessMask.classList.remove('visible');
        if (iconGenProcessBarFill) iconGenProcessBarFill.style.width = '0%';
        if (iconGenObjectUrl) {
          URL.revokeObjectURL(iconGenObjectUrl);
          iconGenObjectUrl = null;
        }
        selectedIconGenFile = null;
        selectedIconGenImage = null;
        selectedIconGenFileSize = 0;
        if (iconGenFiles) {
          iconGenFiles.innerHTML = '';
          iconGenFiles.classList.remove('has-files');
        }
        if (iconGenProcessBtn) {
          iconGenProcessBtn.classList.remove('visible');
          setTimeout(() => iconGenProcessBtn.style.display = 'none', 300);
        }
      }

      if (iconGenBack) iconGenBack.addEventListener('click', closeIconGenOverlay);
      if (iconGenCancelBtn) iconGenCancelBtn.addEventListener('click', cancelIconGenProcessing);

      document.querySelectorAll('.audio-list-item[data-tool="icon-gen"]').forEach(item => {
        item.addEventListener('click', () => openIconGenOverlay());
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openIconGenOverlay();
          }
        });
      });

      function showIconGenProcessBtn() {
        if (!iconGenProcessBtn) return;
        iconGenProcessBtn.style.display = '';
        requestAnimationFrame(() => iconGenProcessBtn.classList.add('visible'));
      }

      function hideIconGenProcessBtn() {
        if (!iconGenProcessBtn) return;
        iconGenProcessBtn.classList.remove('visible');
        const onTransitionEnd = (e) => {
          if (e.propertyName === 'opacity' && !iconGenProcessBtn.classList.contains('visible')) {
            iconGenProcessBtn.style.display = 'none';
            iconGenProcessBtn.removeEventListener('transitionend', onTransitionEnd);
          }
        };
        iconGenProcessBtn.addEventListener('transitionend', onTransitionEnd);
      }

      // Drag & drop visual feedback
      if (iconGenOverlay) {
        iconGenOverlay.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (!iconGenOverlay.classList.contains('visible') || processingIconGen) return;
          iconGenOverlay.classList.add('drag-over');
        });
        iconGenOverlay.addEventListener('dragleave', (e) => {
          e.preventDefault();
          if (!iconGenOverlay.classList.contains('visible') || processingIconGen) return;
          iconGenOverlay.classList.remove('drag-over');
        });
        iconGenOverlay.addEventListener('drop', (e) => {
          e.preventDefault();
          if (!iconGenOverlay.classList.contains('visible') || processingIconGen) return;
          iconGenOverlay.classList.remove('drag-over');
          const files = e.dataTransfer?.files;
          if (files && files.length > 0) {
            handleIconGenFileSelect(files[0]);
          }
        });
      }

      // Tauri native drag-drop events — provides file paths
      if (isTauri && iconGenOverlay) {
        (async () => {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          const webview = getCurrentWebview();
          await webview.onDragDropEvent((event) => {
            if (!iconGenOverlay.classList.contains('visible') || processingIconGen) return;
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') {
              iconGenOverlay.classList.add('drag-over');
              if (iconGenDropZone) iconGenDropZone.classList.add('visible');
            } else if (payload.type === 'leave') {
              iconGenOverlay.classList.remove('drag-over');
              if (iconGenDropZone) iconGenDropZone.classList.remove('visible');
            } else if (payload.type === 'drop') {
              iconGenOverlay.classList.remove('drag-over');
              if (iconGenDropZone) iconGenDropZone.classList.remove('visible');
              const paths = payload.paths || [];
              if (paths.length === 0) return;
              const imgExts = ['png', 'jpg', 'jpeg', 'webp'];
              const imgPath = paths.find(p => imgExts.some(ext => p.toLowerCase().endsWith('.' + ext)));
              if (imgPath) {
                handleIconGenFileSelect({ name: imgPath.split(/[\\/]/).pop() || imgPath, path: imgPath, size: 0, type: 'image/png' });
              }
            }
          });
        })();
      }

      if (iconGenCta) {
        iconGenCta.addEventListener('click', async () => {
          if (isTauri) {
            try {
              const { open } = await import('@tauri-apps/plugin-dialog');
              const selected = await open({
                multiple: false,
                filters: [{ name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
              });
              if (selected && typeof selected === 'string') {
                handleIconGenFileSelect({ name: selected.split(/[\\/]/).pop() || selected, path: selected, size: 0, type: 'image/png' });
              }
            } catch (e) {
              console.error('Icon gen file selection error', e);
            }
          } else {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/png,image/jpeg,image/webp';
            input.onchange = (e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleIconGenFileSelect(e.target.files[0]);
              }
            };
            input.click();
          }
        });
      }

      async function handleIconGenFileSelect(file) {
        if (!iconGenFiles) return;
        let candidateUrl = null;
        try {
          let sourceSize = Number(file?.size);
          if (isTauri && file?.path) {
            const { invoke } = await import('@tauri-apps/api/core');
            sourceSize = Number(await invoke('get_file_size', { path: file.path }));
          }
          assertIconSource(file, sourceSize);
          const sourceBytes = await readIconGenSourceBytes(file);
          assertIconSource(file, sourceBytes.byteLength);
          const dimensions = readColorExtractorImageDimensions(sourceBytes);
          if (!dimensions) {
            throw new IconGenerationError('invalid_image_data', 'Image data is unsupported or malformed.');
          }
          assertIconSourceDimensions(dimensions.width, dimensions.height);
          candidateUrl = URL.createObjectURL(new Blob([sourceBytes], { type: getIconGenMimeType(file?.name) }));
          const candidateImage = await loadIconGenImage(candidateUrl);
          assertIconSourceDimensions(candidateImage.naturalWidth, candidateImage.naturalHeight);

          if (iconGenObjectUrl) URL.revokeObjectURL(iconGenObjectUrl);
          iconGenObjectUrl = candidateUrl;
          selectedIconGenFile = file;
          selectedIconGenImage = candidateImage;
          selectedIconGenFileSize = sourceSize;
        } catch (error) {
          if (candidateUrl) URL.revokeObjectURL(candidateUrl);
          console.error('Icon source validation failed:', error);
          const message = error instanceof IconGenerationError ? error.message : t('home.iconGen.invalidFormat');
          alert(t('home.iconGen.inputError', { error: message }));
          return;
        }
        iconGenFiles.innerHTML = '';
        iconGenFiles.classList.add('has-files');
        const item = document.createElement('div');
        item.className = 'audio-convert-file-item';
        const displaySize = selectedIconGenFileSize;
        item.innerHTML = `<img class="audio-convert-file-thumb" src="${iconGenObjectUrl}" alt="preview" /><span class="audio-convert-file-name">${escapeHtml(file.name)}</span><span class="audio-convert-file-size">${(displaySize / 1024).toFixed(1)} KB</span><button class="audio-convert-file-remove" aria-label="remove"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>`;
        iconGenFiles.appendChild(item);
        item.querySelector('.audio-convert-file-remove').addEventListener('click', () => {
          if (iconGenObjectUrl) {
            URL.revokeObjectURL(iconGenObjectUrl);
            iconGenObjectUrl = null;
          }
          selectedIconGenFile = null;
          selectedIconGenImage = null;
          selectedIconGenFileSize = 0;
          iconGenFiles.innerHTML = '';
          iconGenFiles.classList.remove('has-files');
          hideIconGenProcessBtn();
        });
        showIconGenProcessBtn();
      }

      function getIconGenMimeType(fileName) {
        if (/\.png$/i.test(fileName || '')) return 'image/png';
        if (/\.webp$/i.test(fileName || '')) return 'image/webp';
        return 'image/jpeg';
      }

      async function readIconGenSourceBytes(file) {
        if (isTauri && file?.path) {
          const { invoke } = await import('@tauri-apps/api/core');
          const rawBytes = await invoke('read_file_bytes_limited', {
            path: file.path,
            maxBytes: ICON_GEN_LIMITS.maxInputBytes
          });
          return Array.isArray(rawBytes) ? Uint8Array.from(rawBytes) : new Uint8Array(rawBytes);
        }
        return new Uint8Array(await file.arrayBuffer());
      }

      function loadIconGenImage(objectUrl) {
        return new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error('Failed to decode image'));
          image.src = objectUrl;
        });
      }

      // Crop image to square using Canvas
      function cropToSquare(img, size) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        const minDim = Math.max(1, Math.min(img.width, img.height));
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
        return canvas;
      }

      // Generate SVG wrapping the image as base64
      function generateSvg(img) {
        const canvas = document.createElement('canvas');
        const size = 1024;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        const minDim = Math.max(1, Math.min(img.width, img.height));
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
        const dataUrl = canvas.toDataURL('image/png');
        const base64 = dataUrl.split(',')[1];
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><image href="data:image/png;base64,${base64}" width="1024" height="1024"/></svg>`;
        return svg;
      }

      // Generate ICO file from multiple PNG blobs
      async function generateIco(img, sizes) {
        const pngs = [];
        for (const size of sizes) {
          const canvas = cropToSquare(img, size);
          const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(b => { if (b) resolve(b); else reject(new Error('toBlob returned null')); }, 'image/png');
          });
          const buf = new Uint8Array(await blob.arrayBuffer());
          pngs.push({ size, data: buf });
        }

        const headerSize = 6;
        const dirEntrySize = 16;
        const numIcons = pngs.length;
        const offset = headerSize + dirEntrySize * numIcons;

        const totalSize = offset + pngs.reduce((sum, p) => sum + p.data.length, 0);
        const buf = new ArrayBuffer(totalSize);
        const view = new DataView(buf);
        const u8 = new Uint8Array(buf);

        // ICONDIR header
        view.setUint16(0, 0, true);  // reserved
        view.setUint16(2, 1, true);  // type = ICO
        view.setUint16(4, numIcons, true);

        let dataOffset = offset;
        for (let i = 0; i < numIcons; i++) {
          const p = pngs[i];
          const entryOffset = headerSize + i * dirEntrySize;
          view.setUint8(entryOffset, p.size >= 256 ? 0 : p.size);   // width
          view.setUint8(entryOffset + 1, p.size >= 256 ? 0 : p.size); // height
          view.setUint8(entryOffset + 2, 0);  // palette
          view.setUint8(entryOffset + 3, 0);  // reserved
          view.setUint16(entryOffset + 4, 1, true);  // color planes
          view.setUint16(entryOffset + 6, 32, true); // bits per pixel
          view.setUint32(entryOffset + 8, p.data.length, true);  // size
          view.setUint32(entryOffset + 12, dataOffset, true);     // offset
          u8.set(p.data, dataOffset);
          dataOffset += p.data.length;
        }

        return new Blob([buf], { type: 'image/x-icon' });
      }

      function cancelIconGenProcessing() {
        iconGenRunId += 1;
        processingIconGen = false;
        if (iconGenProcessMask) iconGenProcessMask.classList.remove('visible');
        if (iconGenProcessBarFill) iconGenProcessBarFill.style.width = '0%';
        if (iconGenProcessText) iconGenProcessText.textContent = t('home.iconGen.processing');
        if (iconGenProcessBtn) {
          iconGenProcessBtn.textContent = t('home.iconGen.processBtn');
          iconGenProcessBtn.disabled = false;
        }
      }

      // Generate icons and pack as ZIP
      async function startIconGenProcessing() {
        if (!selectedIconGenFile || !selectedIconGenImage || processingIconGen) return;
        const runId = ++iconGenRunId;
        const assertCurrentRun = () => {
          if (runId !== iconGenRunId) throw new IconGenerationError('cancelled', 'Icon generation was cancelled.');
        };
        processingIconGen = true;
        lastIconGenDownloadDir = '';
        if (iconGenProcessBtn) {
          iconGenProcessBtn.textContent = t('home.iconGen.processing');
          iconGenProcessBtn.disabled = true;
        }

        if (iconGenProcessMask) {
          iconGenProcessMask.classList.add('visible');
          if (iconGenProcessBarFill) iconGenProcessBarFill.style.width = '0%';
        }

        try {
          const img = selectedIconGenImage;
          const zip = new JSZip();
          const folder = zip.folder('icons');
          const totalSteps = ALL_SIZES.length + 3; // PNG sizes + ICO + SVG + favicon.ico
          let step = 0;

          // Generate PNG icons at all sizes
          for (const size of ALL_SIZES) {
            const canvas = cropToSquare(img, size);
            const blob = await new Promise((resolve, reject) => {
              canvas.toBlob(b => { if (b) resolve(b); else reject(new Error('toBlob returned null')); }, 'image/png');
            });
            assertCurrentRun();
            folder.file(`icon-${size}x${size}.png`, blob);
            step++;
            const percent = Math.round((step / totalSteps) * 80);
            if (iconGenProcessBarFill) iconGenProcessBarFill.style.width = `${percent}%`;
          }

          // Generate ICO (multi-size)
          if (iconGenProcessText) iconGenProcessText.textContent = t('home.iconGen.genIco');
          const icoBlob = await generateIco(img, ICO_SIZES);
          assertCurrentRun();
          folder.file('icon.ico', icoBlob);
          step++;
          if (iconGenProcessBarFill) iconGenProcessBarFill.style.width = `${Math.round((step / totalSteps) * 80)}%`;

          // Generate SVG
          if (iconGenProcessText) iconGenProcessText.textContent = t('home.iconGen.genSvg');
          const svgContent = generateSvg(img);
          assertCurrentRun();
          folder.file('icon.svg', svgContent);
          step++;
          if (iconGenProcessBarFill) iconGenProcessBarFill.style.width = `${Math.round((step / totalSteps) * 80)}%`;

          // Generate favicon.ico (16x32x48 - classic favicon)
          if (iconGenProcessText) iconGenProcessText.textContent = t('home.iconGen.genFavicon');
          const faviconBlob = await generateIco(img, [16, 32, 48]);
          assertCurrentRun();
          folder.file('favicon.ico', faviconBlob);
          step++;
          if (iconGenProcessBarFill) iconGenProcessBarFill.style.width = `${Math.round((step / totalSteps) * 80)}%`;

          if (iconGenProcessText) iconGenProcessText.textContent = t('home.iconGen.processing');
          if (iconGenProcessBarFill) iconGenProcessBarFill.style.width = '90%';
          const zipBlob = await zip.generateAsync(
            { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, streamFiles: true },
            (metadata) => {
              assertCurrentRun();
              if (iconGenProcessBarFill) {
                const percent = Math.min(99, 90 + Math.round(metadata.percent * 0.09));
                iconGenProcessBarFill.style.width = `${percent}%`;
              }
            }
          );
          assertCurrentRun();
          assertIconArchiveSize(zipBlob.size);
          if (iconGenProcessBarFill) iconGenProcessBarFill.style.width = '100%';

          let savedPath = '';
          if (isTauri) {
            let archiveSessionId = null;
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const outputDir = await getOutputDir('Icons');
              const fileName = `icons_${Date.now()}.zip`;
              archiveSessionId = await invoke('begin_icon_archive_write', { directory: outputDir, fileName });
              const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
              const CHUNK_SIZE = 5_000_000;
              for (let off = 0; off < zipBytes.length; off += CHUNK_SIZE) {
                assertCurrentRun();
                const end = Math.min(off + CHUNK_SIZE, zipBytes.length);
                await invoke('append_icon_archive_chunk', {
                  sessionId: archiveSessionId,
                  bytes: Array.from(zipBytes.subarray(off, end))
                });
              }
              assertCurrentRun();
              savedPath = await invoke('finalize_icon_archive_write', { sessionId: archiveSessionId });
              archiveSessionId = null;
              lastIconGenDownloadDir = savedPath;
            } catch (e) {
              if (archiveSessionId !== null) {
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('discard_icon_archive_write', { sessionId: archiveSessionId }).catch(() => {});
              }
              console.error('Tauri icon archive save failed:', e);
              throw e;
            }
          } else {
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `icons.zip`;
            a.click();
            URL.revokeObjectURL(url);
          }

          const totalIcons = ALL_SIZES.length + 3; // PNGs + ICO + SVG + favicon.ico
          setTimeout(() => {
            if (runId !== iconGenRunId) return;
            if (iconGenProcessMask) iconGenProcessMask.classList.remove('visible');
            if (iconGenProcessBarFill) iconGenProcessBarFill.style.width = '0%';
            if (iconGenProcessText) iconGenProcessText.textContent = t('home.iconGen.processing');
            showIconGenSuccessDialog(totalIcons);
          }, 400);
        } catch (err) {
          console.error('Icon generation error:', err);
          if (runId !== iconGenRunId || err instanceof IconGenerationError && err.code === 'cancelled') return;
          if (iconGenProcessMask) iconGenProcessMask.classList.remove('visible');
          if (iconGenProcessBarFill) iconGenProcessBarFill.style.width = '0%';
          if (iconGenProcessText) iconGenProcessText.textContent = t('home.iconGen.processing');
          alert(t('home.iconGen.error'));
        } finally {
          if (runId !== iconGenRunId) return;
          processingIconGen = false;
          if (iconGenProcessBtn) {
            iconGenProcessBtn.textContent = t('home.iconGen.processBtn');
            iconGenProcessBtn.disabled = false;
          }
        }
      }

      // Success dialog
      const iconGenSuccessOverlay = document.getElementById('iconGenSuccessOverlay');
      const iconGenSuccessOk = document.getElementById('iconGenSuccessOk');
      const iconGenSuccessCount = document.getElementById('iconGenSuccessCount');
      const iconGenSuccessMeta = document.getElementById('iconGenSuccessMeta');
      const iconGenOpenFolder = document.getElementById('iconGenOpenFolder');

      function showIconGenSuccessDialog(count) {
        if (!iconGenSuccessOverlay) return;
        if (iconGenSuccessCount) iconGenSuccessCount.textContent = `${count} ${t('home.iconGen.successCountUnit')}`;
        if (iconGenSuccessMeta) {
          if (lastIconGenDownloadDir) {
            const dir = lastIconGenDownloadDir.includes('\\') ? lastIconGenDownloadDir.substring(0, lastIconGenDownloadDir.lastIndexOf('\\')) : lastIconGenDownloadDir;
            iconGenSuccessMeta.textContent = t('home.iconGen.successSummary', { count }) + '\n' + dir;
          } else {
            iconGenSuccessMeta.textContent = t('home.iconGen.successSummary', { count });
          }
        }
        if (iconGenOpenFolder) {
          iconGenOpenFolder.style.display = lastIconGenDownloadDir ? '' : 'none';
        }
        iconGenSuccessOverlay.classList.add('visible');
      }

      function closeIconGenSuccessDialog() {
        if (!iconGenSuccessOverlay) return;
        iconGenSuccessOverlay.classList.remove('visible');
      }

      if (iconGenProcessBtn) iconGenProcessBtn.addEventListener('click', () => { if (selectedIconGenFile && !processingIconGen) startIconGenProcessing(); });
      if (iconGenSuccessOk) iconGenSuccessOk.addEventListener('click', closeIconGenSuccessDialog);
      if (iconGenOpenFolder) {
        iconGenOpenFolder.addEventListener('click', () => {
          if (isTauri && lastIconGenDownloadDir) {
            import('@tauri-apps/api/core').then(({ invoke }) => {
              const dir = lastIconGenDownloadDir.includes('\\') ? lastIconGenDownloadDir.substring(0, lastIconGenDownloadDir.lastIndexOf('\\')) : lastIconGenDownloadDir;
              invoke('open_path', { path: dir }).catch(e => console.error('Open folder error', e));
            }).catch(e => console.error('Core import error', e));
          }
          closeIconGenSuccessDialog();
        });
      }

      // ===== Video Convert Tool =====
      const videoConvertOverlay = document.getElementById('videoConvertOverlay');
      const videoConvertBack = document.getElementById('videoConvertBack');
      const videoConvertPlasmaBg = document.getElementById('videoConvertPlasmaBg');
      let videoConvertPlasmaInstance = null;

      function openVideoConvertOverlay() {
        if (!videoConvertOverlay) return;
        videoConvertOverlay.classList.add('visible');
        if (videoConvertPlasmaBg && !videoConvertPlasmaInstance) {
          videoConvertPlasmaInstance = initPlasma(videoConvertPlasmaBg, {
            color: '#6B6B6B', speed: 0.8, direction: 'forward', scale: 1, opacity: 1, mouseInteractive: false
          });
        }
      }

      function closeVideoConvertOverlay() {
        if (!videoConvertOverlay) return;
        cancelActiveVideoConversion();
        videoConvertOverlay.classList.remove('visible');
        if (videoConvertPlasmaInstance) { videoConvertPlasmaInstance(); videoConvertPlasmaInstance = null; }
        clearVideoFiles();
      }

      if (videoConvertBack) videoConvertBack.addEventListener('click', closeVideoConvertOverlay);

      document.querySelectorAll('.audio-list-item[data-tool="video-convert"]').forEach(item => {
        item.addEventListener('click', () => openToolWithFfmpegCheck(openVideoConvertOverlay));
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openToolWithFfmpegCheck(openVideoConvertOverlay); }
        });
      });

      const videoConvertDropZone = document.getElementById('videoConvertDropZone');
      const videoConvertFiles = document.getElementById('videoConvertFiles');
      const videoConvertCta = document.getElementById('videoConvertCta');
      const videoConvertProcessBtn = document.getElementById('videoConvertProcessBtn');
      const videoConvertProcessMask = document.getElementById('videoConvertProcessMask');
      const videoConvertProcessBarFill = document.getElementById('videoConvertProcessBarFill');
      const videoConvertProcessText = document.getElementById('videoConvertProcessText');
      const videoConvertCancelBtn = document.getElementById('videoConvertCancelBtn');
      let selectedVideoFiles = [];
      let processingVideo = false;
      let targetVideoFormat = 'MP4';
      let videoConversionRunId = 0;
      let videoConvertUnlisten = null;
      const videoConvertSuccessOverlay = document.getElementById('videoConvertSuccessOverlay');
      const videoConvertSuccessPath = document.getElementById('videoConvertSuccessPath');
      const videoConvertSuccessMeta = document.getElementById('videoConvertSuccessMeta');
      const videoConvertSuccessFormat = document.getElementById('videoConvertSuccessFormat');
      const videoConvertSuccessCount = document.getElementById('videoConvertSuccessCount');
      const videoConvertOpenFolder = document.getElementById('videoConvertOpenFolder');
      const videoConvertSuccessOk = document.getElementById('videoConvertSuccessOk');
      const videoConvertFormatOptions = document.getElementById('videoConvertFormatOptions');
      const videoExts = ['mp4', 'avi', 'mkv', 'mov', 'webm', 'flv', 'wmv', 'ts', 'm4v'];

      function addVideoFiles(fileList) {
        if (!fileList || fileList.length === 0) return;
        const nextFiles = [...selectedVideoFiles];
        for (const file of fileList) {
          const dup = file.path
            ? nextFiles.some(f => f.path === file.path)
            : nextFiles.some(f => f.name === file.name && f.size === file.size);
          if (dup) continue;
          nextFiles.push(file);
        }
        try {
          validateVideoBatchSelection(nextFiles);
        } catch (error) {
          console.error('Video selection validation failed:', error);
          alert(t('home.videoConvert.selectionError', {
            error: error instanceof VideoConvertError ? error.message : t('home.videoConvert.conversionError')
          }));
          return;
        }
        selectedVideoFiles = nextFiles;
        renderVideoFiles();
      }

      function removeVideoFile(index) { selectedVideoFiles.splice(index, 1); renderVideoFiles(); }
      function clearVideoFiles() { selectedVideoFiles = []; renderVideoFiles(); }

      function renderVideoFiles() {
        if (!videoConvertFiles) return;
        videoConvertFiles.innerHTML = '';
        if (selectedVideoFiles.length > 0) videoConvertFiles.classList.add('has-files');
        else videoConvertFiles.classList.remove('has-files');
        selectedVideoFiles.forEach((file, index) => {
          const item = document.createElement('div');
          item.className = 'audio-convert-file-item';
          item.innerHTML = `<span class="audio-convert-file-name">${escapeHtml(file.name)}</span><button class="audio-convert-file-remove" data-index="${index}" aria-label="remove"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>`;
          videoConvertFiles.appendChild(item);
        });
        videoConvertFiles.querySelectorAll('.audio-convert-file-remove').forEach(btn => {
          btn.addEventListener('click', () => { const idx = parseInt(btn.dataset.index, 10); if (!isNaN(idx)) removeVideoFile(idx); });
        });
        enableSortableFileList(videoConvertFiles, selectedVideoFiles, renderVideoFiles, () => processingVideo);
        toggleVideoProcessButton();
      }

      function toggleVideoProcessButton() {
        if (!videoConvertProcessBtn) return;
        if (selectedVideoFiles.length > 0) {
          videoConvertProcessBtn.style.display = '';
          requestAnimationFrame(() => videoConvertProcessBtn.classList.add('visible'));
        } else {
          videoConvertProcessBtn.classList.remove('visible');
          const onTransitionEnd = (e) => {
            if (e.propertyName === 'opacity' && !videoConvertProcessBtn.classList.contains('visible')) {
              videoConvertProcessBtn.style.display = 'none';
              videoConvertProcessBtn.removeEventListener('transitionend', onTransitionEnd);
            }
          };
          videoConvertProcessBtn.addEventListener('transitionend', onTransitionEnd);
        }
      }

      function showVideoDropZone() {
        if (videoConvertDropZone) videoConvertDropZone.classList.add('visible');
        if (videoConvertOverlay) videoConvertOverlay.classList.add('drag-over');
      }
      function hideVideoDropZone() {
        if (videoConvertDropZone) videoConvertDropZone.classList.remove('visible');
        if (videoConvertOverlay) videoConvertOverlay.classList.remove('drag-over');
      }

      if (isTauri && videoConvertOverlay) {
        (async () => {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          const webview = getCurrentWebview();
          await webview.onDragDropEvent((event) => {
            if (!videoConvertOverlay.classList.contains('visible') || processingVideo) return;
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') showVideoDropZone();
            else if (payload.type === 'leave') hideVideoDropZone();
            else if (payload.type === 'drop') {
              hideVideoDropZone();
              const paths = payload.paths || [];
              if (paths.length === 0) return;
              const fileList = paths
                .filter(p => videoExts.some(ext => p.toLowerCase().endsWith('.' + ext)))
                .map(path => ({ name: path.split(/[\\/]/).pop() || path, path, size: 0 }));
              if (fileList.length > 0) addVideoFiles(fileList);
            }
          });
        })();
      }

      if (videoConvertCta) {
        videoConvertCta.addEventListener('click', async () => {
          if (isTauri) {
            try {
              const { open } = await import('@tauri-apps/plugin-dialog');
              const selected = await open({ multiple: true, filters: [{ name: 'Video Files', extensions: videoExts }] });
              if (selected && Array.isArray(selected)) {
                addVideoFiles(selected.map(path => ({ name: path.split(/[\\/]/).pop() || path, path, size: 0 })));
              }
            } catch (e) { console.error('Video file selection error', e); }
          } else {
            const input = document.createElement('input');
            input.type = 'file'; input.multiple = true; input.accept = 'video/*';
            input.addEventListener('change', () => { addVideoFiles(input.files); input.value = ''; });
            input.click();
          }
        });
      }

      function showVideoSuccessDialog(result) {
        const outputPath = result?.output_dir || (isTauri ? 'C:\\Users\\Downloads\\toolknit-converted' : '~/Downloads/toolknit-converted');
        const successCount = result?.success_count ?? selectedVideoFiles.length;
        const failCount = result?.fail_count ?? 0;
        const firstFileName = selectedVideoFiles[0]?.name || '';
        if (failCount > 0 && successCount === 0) {
          const details = result?.errors?.length ? `\n\n${result.errors.slice(0, 3).join('\n')}` : '';
          alert(t('home.videoConvert.allFailed', { count: failCount }) + details);
          return;
        }
        let summary;
        if (failCount > 0) {
          summary = t('home.videoConvert.successSummaryPartial', { success: successCount, fail: failCount, format: targetVideoFormat });
        } else if (successCount > 1) {
          summary = t('home.videoConvert.successSummaryPlural', { count: successCount, format: targetVideoFormat });
        } else {
          summary = t('home.videoConvert.successSummarySingle', { name: firstFileName, format: targetVideoFormat });
        }
        if (videoConvertSuccessMeta) videoConvertSuccessMeta.textContent = summary;
        if (videoConvertSuccessFormat) videoConvertSuccessFormat.textContent = targetVideoFormat;
        if (videoConvertSuccessCount) videoConvertSuccessCount.textContent = `${successCount} ${t('home.videoConvert.successCountUnit')}`;
        if (videoConvertSuccessPath) videoConvertSuccessPath.textContent = outputPath;
        lastVideoOutputPath = outputPath;
        if (videoConvertSuccessOverlay) videoConvertSuccessOverlay.classList.add('visible');
      }

      function closeVideoSuccessDialog() {
        if (videoConvertSuccessOverlay) videoConvertSuccessOverlay.classList.remove('visible');
        clearVideoFiles();
      }

      if (videoConvertCancelBtn) {
        videoConvertCancelBtn.addEventListener('click', cancelActiveVideoConversion);
      }

      function cancelActiveVideoConversion() {
        const wasProcessing = processingVideo;
        videoConversionRunId += 1;
        if (videoConvertUnlisten) {
          videoConvertUnlisten();
          videoConvertUnlisten = null;
        }
        if (videoConvertProcessMask) videoConvertProcessMask.classList.remove('visible');
        if (videoConvertProcessBarFill) videoConvertProcessBarFill.style.width = '0%';
        if (videoConvertProcessText) videoConvertProcessText.textContent = t('home.videoConvert.processing');
        processingVideo = false;
        if (isTauri && wasProcessing) {
          import('@tauri-apps/api/core')
            .then(({ invoke }) => invoke('cancel_convert'))
            .catch((error) => console.error('Video cancellation failed:', error));
        }
      }

      async function startVideoProcessing() {
        if (!videoConvertProcessMask || !videoConvertProcessBarFill || processingVideo) return;
        if (selectedVideoFiles.length === 0) return;
        try {
          validateVideoBatchSelection(selectedVideoFiles);
          targetVideoFormat = normalizeVideoTargetFormat(targetVideoFormat);
        } catch (error) {
          alert(error instanceof VideoConvertError ? error.message : t('home.videoConvert.conversionError'));
          return;
        }
        if (!isTauri) {
          alert(t('home.videoConvert.desktopOnly'));
          return;
        }
        const runId = ++videoConversionRunId;
        processingVideo = true;
        videoConvertProcessMask.classList.add('visible');
        videoConvertProcessBarFill.style.width = '0%';

        let unlisten = null;
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const { listen } = await import('@tauri-apps/api/event');
          const inputPaths = selectedVideoFiles.map(file => file.path).filter(Boolean);
          if (inputPaths.length !== selectedVideoFiles.length) {
            throw new Error(t('common.filePathsNotAvailableShort'));
          }
          const finalOutputDir = await getOutputDir('Videos');
          if (runId !== videoConversionRunId) return;
          const ffmpegReady = await ensureFfmpegAvailable();
          if (!ffmpegReady || runId !== videoConversionRunId) return;

          const progressByFile = new Map();
          unlisten = await listen('convert-progress', (event) => {
            if (runId !== videoConversionRunId) return;
            const data = event.payload || {};
            const current = Number(data.current);
            const total = Number(data.total);
            if (!Number.isInteger(current) || !Number.isInteger(total) || current < 1 || total < 1) return;
            const progress = Number.isFinite(Number(data.progress)) ? Number(data.progress) : 0;
            const existing = progressByFile.get(current) || 0;
            const next = data.status === 'done' || data.status === 'error' ? 1 : Math.max(existing, Math.max(0, Math.min(progress, 0.99)));
            progressByFile.set(current, next);
            const completed = [...progressByFile.values()].reduce((sum, value) => sum + value, 0);
            const percent = Math.min(99, Math.round((completed / total) * 100));
            videoConvertProcessBarFill.style.width = `${percent}%`;
            if (videoConvertProcessText) videoConvertProcessText.textContent = `${t('home.videoConvert.processing')} (${current}/${total})`;
          });
          if (runId !== videoConversionRunId) {
            unlisten();
            return;
          }
          videoConvertUnlisten = unlisten;
          const result = await invoke('convert_video_batch', { inputPaths, outputDir: finalOutputDir, targetFormat: targetVideoFormat });
          unlisten();
          if (videoConvertUnlisten === unlisten) videoConvertUnlisten = null;
          if (runId !== videoConversionRunId) return;
          videoConvertProcessBarFill.style.width = '100%';
          setTimeout(() => {
            if (runId !== videoConversionRunId) return;
            videoConvertProcessMask.classList.remove('visible');
            videoConvertProcessBarFill.style.width = '0%';
            processingVideo = false;
            showVideoSuccessDialog(result);
          }, 400);
        } catch (e) {
          console.error('Video conversion failed:', e);
          if (unlisten) unlisten();
          if (videoConvertUnlisten === unlisten) videoConvertUnlisten = null;
          if (runId !== videoConversionRunId) return;
          videoConvertProcessMask.classList.remove('visible');
          videoConvertProcessBarFill.style.width = '0%';
          processingVideo = false;
          if (videoConvertProcessText) videoConvertProcessText.textContent = t('home.videoConvert.processing');
          alert(t('common.errorOccurred', { error: e?.message || e }));
        }
      }

      if (videoConvertProcessBtn) videoConvertProcessBtn.addEventListener('click', () => { if (selectedVideoFiles.length > 0) startVideoProcessing(); });
      if (videoConvertSuccessOk) videoConvertSuccessOk.addEventListener('click', () => closeVideoSuccessDialog());

      let lastVideoOutputPath = '';
      if (videoConvertOpenFolder) {
        videoConvertOpenFolder.addEventListener('click', () => {
          if (isTauri && lastVideoOutputPath) {
            openOutputFolder(lastVideoOutputPath).catch(e => console.error('Open folder error', e));
          }
          closeVideoSuccessDialog();
        });
      }

      if (videoConvertFormatOptions) {
        videoConvertFormatOptions.addEventListener('click', (e) => {
          const btn = e.target.closest('.audio-convert-format-option');
          if (!btn) return;
          videoConvertFormatOptions.querySelectorAll('.audio-convert-format-option').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          targetVideoFormat = btn.dataset.format;
        });
      }

      // ===== Image Stitch Tool =====
      const imageStitchOverlay = document.getElementById('imageStitchOverlay');
      const imageStitchQueue = document.getElementById('imageStitchQueue');
      const imageStitchQueueEmpty = document.getElementById('imageStitchQueueEmpty');
      const imageStitchPreview = document.getElementById('imageStitchPreview');
      const imageStitchPreviewEmpty = document.getElementById('imageStitchPreviewEmpty');
      const imageStitchCount = document.getElementById('imageStitchCount');
      const imageStitchEstimate = document.getElementById('imageStitchEstimate');
      const imageStitchExport = document.getElementById('imageStitchExport');
      const imageStitchClear = document.getElementById('imageStitchClear');
      const imageStitchPdfPick = document.getElementById('imageStitchPdfPick');
      const imageStitchProcessing = document.getElementById('imageStitchProcessing');
      const imageStitchProgressFill = document.getElementById('imageStitchProgressFill');
      const imageStitchProgressValue = document.getElementById('imageStitchProgressValue');
      const imageStitchProgressText = document.getElementById('imageStitchProgressText');
      const imageStitchQualityWrap = document.getElementById('imageStitchQualityWrap');
      const imageStitchDropZone = document.getElementById('imageStitchDropZone');
      let imageStitchFiles = [];
      let imageStitchMode = 'vertical';
      let imageStitchReference = 'first';
      let imageStitchFormat = 'png';
      let imageStitchBusy = false;
      let imageStitchDragIndex = -1;
      let imageStitchJobId = '';
      let imageStitchProgressUnlisten = null;
      let lastImageStitchOutputPath = '';
      let imageStitchPdfSessions = [];
      let imageStitchImportingPdf = false;
      let imageStitchPdfImportCancelled = false;
      let imageStitchPdfLoadingTask = null;
      let imageStitchCancelRequested = false;

      function imageStitchBackgroundRgba() {
        const color = document.getElementById('imageStitchBackground')?.value || '#ffffff';
        const alpha = Math.round(Number(document.getElementById('imageStitchBackgroundAlpha')?.value || 100) * 255 / 100);
        return `${color}${alpha.toString(16).padStart(2, '0')}`.toUpperCase();
      }

      function imageStitchSettings() {
        return normalizeImageStitchRequest({
          mode: imageStitchMode,
          reference: imageStitchReference,
          spacing_px: Number(document.getElementById('imageStitchSpacing')?.value),
          scale_percent: Number(document.getElementById('imageStitchScale')?.value),
          format: imageStitchFormat,
          jpeg_quality: Number(document.getElementById('imageStitchQuality')?.value || 92),
          background_rgba: imageStitchBackgroundRgba()
        });
      }

      function imageStitchOutputName() {
        const value = document.getElementById('imageStitchOutputName')?.value.trim() || '';
        if (!value) return null;
        const reserved = value.split('.')[0].trimEnd().toUpperCase();
        const isReserved = ['CON', 'PRN', 'AUX', 'NUL'].includes(reserved)
          || /^(?:COM|LPT)[1-9]$/.test(reserved);
        if (value.length > 96 || value === '.' || value === '..'
          || /[\\/:*?"<>|\u0000-\u001f]/.test(value) || /[ .]$/.test(value) || isReserved) {
          throw new Error('image-stitch:invalid-output-name');
        }
        return value;
      }

      function imageStitchErrorMessage(error) {
        const message = String(error?.message || error || '');
        if (message.includes('animated')) return t('home.imageStitch.animatedError');
        if (message.includes('Duplicate')) return t('home.imageStitch.duplicateError');
        if (message.includes('output-too-large-for-memory')) return t('home.imageStitch.memoryError');
        if (message.includes('output-too-large')) return t('home.imageStitch.sizeError');
        if (message.includes('invalid-settings') || message.includes('Invalid stitch settings')) return t('home.imageStitch.settingsError');
        if (message.includes('invalid-output-name')) return t('home.imageStitch.outputNameError');
        if (message.includes('pdf-') || message.includes('InvalidPDF')) return t('home.imageStitch.pdfError');
        if (message.includes('invalid-input') || message.includes('Cannot read')) return t('home.imageStitch.inputError');
        return message || t('home.imageStitch.error');
      }

      function currentImageStitchLayout() {
        if (imageStitchFiles.length < 2) return null;
        try {
          return calculateImageStitchLayout(imageStitchFiles, imageStitchSettings());
        } catch (error) {
          imageStitchEstimate.textContent = imageStitchErrorMessage(error);
          return null;
        }
      }

      function fitImageStitchScaleToSafeLayout(notify = false) {
        if (imageStitchFiles.length < 2) return true;
        const scaleInput = document.getElementById('imageStitchScale');
        const startingScale = Math.min(100, Math.max(10, Number(scaleInput?.value) || 100));
        for (let scale = startingScale; scale >= 10; scale -= 1) {
          try {
            calculateImageStitchLayout(imageStitchFiles, { ...imageStitchSettings(), scale_percent: scale });
            if (scale !== startingScale && scaleInput) {
              scaleInput.value = String(scale);
              if (notify) window.showToast?.(t('home.imageStitch.autoScaled').replace('{scale}', scale));
            }
            return true;
          } catch (error) {
            if (!String(error?.code || error).includes('output_too_large')) return false;
          }
        }
        return false;
      }

      async function discardImageStitchPdfSession(sessionId) {
        imageStitchPdfSessions = imageStitchPdfSessions.filter(session => session.id !== sessionId);
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('discard_image_stitch_pdf_session', { sessionId });
        } catch (error) {
          console.warn('Cannot clean image stitch PDF session:', error);
        }
      }

      async function releaseUnusedImageStitchPdfSessions() {
        const active = new Set(imageStitchFiles.map(file => file.path.toLowerCase()));
        const unused = imageStitchPdfSessions.filter(session => !session.paths.some(path => active.has(path.toLowerCase())));
        await Promise.all(unused.map(session => discardImageStitchPdfSession(session.id)));
      }

      async function cleanupAllImageStitchPdfSessions(removeQueuedPages = false) {
        const sessions = [...imageStitchPdfSessions];
        imageStitchPdfSessions = [];
        if (removeQueuedPages && sessions.length) {
          const temporaryPaths = new Set(sessions.flatMap(session => session.paths.map(path => path.toLowerCase())));
          imageStitchFiles = imageStitchFiles.filter(file => !temporaryPaths.has(file.path.toLowerCase()));
        }
        await Promise.all(sessions.map(async (session) => {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('discard_image_stitch_pdf_session', { sessionId: session.id });
          } catch (error) {
            console.warn('Cannot clean image stitch PDF session:', error);
          }
        }));
        if (removeQueuedPages) renderImageStitchQueue();
      }

      function renderImageStitchPreview() {
        if (!imageStitchPreview || !imageStitchPreviewEmpty) return;
        const layout = currentImageStitchLayout();
        imageStitchPreview.hidden = !layout;
        imageStitchPreviewEmpty.hidden = Boolean(layout);
        if (!layout) {
          imageStitchPreview.innerHTML = '';
          if (imageStitchFiles.length < 2) imageStitchEstimate.textContent = '-- × --';
          return;
        }
        imageStitchEstimate.textContent = `${layout.width.toLocaleString()} × ${layout.height.toLocaleString()} px`;
        imageStitchPreview.className = `image-stitch-preview-composition ${layout.mode}`;
        imageStitchPreview.style.background = layout.background_rgba;
        const previewAxis = layout.mode === 'vertical' ? 440 : 320;
        const fixedAxis = layout.mode === 'vertical' ? layout.width : layout.height;
        imageStitchPreview.style.gap = `${Math.max(0, layout.spacing_px * previewAxis / fixedAxis)}px`;
        imageStitchPreview.innerHTML = layout.items.map((item, index) => {
          const ratio = `${item.target_width} / ${item.target_height}`;
          return `<div class="image-stitch-preview-item" style="aspect-ratio:${ratio}" title="${escapeHtml(item.name)}"><img src="${item.thumbnail_data_url}" alt=""></div>`;
        }).join('');
      }

      function moveImageStitchFile(from, to) {
        if (imageStitchBusy || from === to || from < 0 || to < 0 || from >= imageStitchFiles.length || to >= imageStitchFiles.length) return;
        const [file] = imageStitchFiles.splice(from, 1);
        imageStitchFiles.splice(to, 0, file);
        renderImageStitchQueue();
      }

      function renderImageStitchQueue() {
        if (!imageStitchQueue) return;
        imageStitchCount.textContent = `${imageStitchFiles.length} / 100`;
        imageStitchQueueEmpty.hidden = imageStitchFiles.length > 0;
        imageStitchQueue.hidden = imageStitchFiles.length === 0;
        imageStitchClear.disabled = imageStitchBusy || imageStitchFiles.length === 0;
        imageStitchExport.disabled = imageStitchBusy || imageStitchFiles.length < 2 || !currentImageStitchLayout();
        imageStitchQueue.innerHTML = imageStitchFiles.map((file, index) => `
          <div class="image-stitch-row" draggable="${!imageStitchBusy}" data-index="${index}">
            <span class="image-stitch-row-index">${String(index + 1).padStart(2, '0')}</span>
            <span class="image-stitch-row-thumb"><img src="${file.thumbnail_data_url}" alt=""></span>
            <span class="image-stitch-row-info"><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><span>${file.width} × ${file.height}</span></span>
            <span class="image-stitch-row-actions">
              <button type="button" data-action="up" title="${t('home.imageStitch.moveUp')}" ${index === 0 || imageStitchBusy ? 'disabled' : ''}><i data-lucide="chevron-up"></i></button>
              <button type="button" data-action="down" title="${t('home.imageStitch.moveDown')}" ${index === imageStitchFiles.length - 1 || imageStitchBusy ? 'disabled' : ''}><i data-lucide="chevron-down"></i></button>
              <button type="button" data-action="remove" title="${t('home.imageStitch.remove')}" ${imageStitchBusy ? 'disabled' : ''}><i data-lucide="x"></i></button>
            </span>
          </div>`).join('');
        imageStitchQueue.querySelectorAll('.image-stitch-row').forEach((row) => {
          const index = Number(row.dataset.index);
          row.querySelector('[data-action="up"]')?.addEventListener('click', () => moveImageStitchFile(index, index - 1));
          row.querySelector('[data-action="down"]')?.addEventListener('click', () => moveImageStitchFile(index, index + 1));
          row.querySelector('[data-action="remove"]')?.addEventListener('click', () => {
            imageStitchFiles.splice(index, 1);
            renderImageStitchQueue();
            void releaseUnusedImageStitchPdfSessions();
          });
          row.addEventListener('dragstart', (event) => {
            imageStitchDragIndex = index;
            row.classList.add('dragging');
            event.dataTransfer.effectAllowed = 'move';
          });
          row.addEventListener('dragend', () => {
            imageStitchDragIndex = -1;
            imageStitchQueue.querySelectorAll('.image-stitch-row').forEach(item => item.classList.remove('dragging', 'drag-target'));
          });
          row.addEventListener('dragover', (event) => {
            event.preventDefault();
            imageStitchQueue.querySelectorAll('.image-stitch-row').forEach(item => item.classList.remove('drag-target'));
            if (imageStitchDragIndex !== index) row.classList.add('drag-target');
          });
          row.addEventListener('drop', (event) => {
            event.preventDefault();
            moveImageStitchFile(imageStitchDragIndex, index);
          });
        });
        renderImageStitchPreview();
        if (typeof createIcons === 'function') createIcons({ icons });
      }

      async function addImageStitchPaths(rawPaths) {
        const paths = (Array.isArray(rawPaths) ? rawPaths : [rawPaths])
          .filter(path => typeof path === 'string' && /\.(?:jpe?g|png|webp|bmp|gif)$/i.test(path))
          .filter(path => !imageStitchFiles.some(file => file.path.toLowerCase() === path.toLowerCase()));
        if (!paths.length) return false;
        if (imageStitchFiles.length + paths.length > 100) {
          window.showToast?.(t('home.imageStitch.limitError'));
          return false;
        }
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const inspected = await invoke('inspect_image_stitch_inputs', { inputPaths: paths });
          imageStitchFiles.push(...inspected.map(item => ({
            path: item.path,
            name: item.name,
            width: item.width,
            height: item.height,
            thumbnail_data_url: item.thumbnail_data_url || item.thumbnailDataUrl
          })));
          if (!fitImageStitchScaleToSafeLayout(true)) {
            imageStitchFiles.splice(imageStitchFiles.length - inspected.length, inspected.length);
            window.showToast?.(t('home.imageStitch.sizeError'));
            renderImageStitchQueue();
            return false;
          }
          renderImageStitchQueue();
          return true;
        } catch (error) {
          window.showToast?.(imageStitchErrorMessage(error));
          return false;
        }
      }

      async function openImageStitcher({ source = 'images', paths = [], sessionId = null } = {}) {
        imageStitchOverlay?.classList.add('visible');
        const added = await addImageStitchPaths(paths);
        if (added && sessionId && !imageStitchPdfSessions.some(session => session.id === sessionId)) {
          imageStitchPdfSessions.push({ id: sessionId, source, paths: [...paths] });
        }
        renderImageStitchQueue();
        return added;
      }
      window.openImageStitcher = openImageStitcher;

      async function renderPdfPageForImageStitch(pdfPage) {
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const maxPixels = 40_000_000;
        let scale = Math.min(2, Math.sqrt(maxPixels / Math.max(1, baseViewport.width * baseViewport.height)));
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (imageStitchPdfImportCancelled) throw new Error('image-stitch:pdf-import-cancelled');
          const viewport = pdfPage.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(viewport.width));
          canvas.height = Math.max(1, Math.round(viewport.height));
          const context = canvas.getContext('2d', { alpha: false });
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          await pdfPage.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;
          const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('image-stitch:pdf-page-encode-failed')), 'image/png'));
          if (blob.size <= 19 * 1024 * 1024) return new Uint8Array(await blob.arrayBuffer());
          scale *= Math.max(0.55, Math.sqrt((18 * 1024 * 1024) / blob.size) * 0.95);
        }
        throw new Error('image-stitch:invalid-pdf-page');
      }

      async function importPdfToImageStitcher(inputPath) {
        if (imageStitchBusy || !isTauri || typeof inputPath !== 'string' || !inputPath) return false;
        let session = null;
        let keepSession = false;
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          imageStitchImportingPdf = true;
          imageStitchPdfImportCancelled = false;
          imageStitchProgressFill.style.width = '2%';
          imageStitchProgressValue.textContent = '2%';
          imageStitchProgressText.textContent = t('home.imageStitch.pdfReading');
          setImageStitchBusy(true);
          session = await invoke('create_image_stitch_pdf_session');
          const rawBytes = await invoke('read_file_bytes_limited', { path: inputPath, maxBytes: 250 * 1024 * 1024 });
          if (imageStitchPdfImportCancelled) throw new Error('image-stitch:pdf-import-cancelled');
          const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
          pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
          const wasmUrl = new URL('assets/', document.baseURI).href;
          const bytes = Array.isArray(rawBytes) ? Uint8Array.from(rawBytes) : new Uint8Array(rawBytes);
          imageStitchPdfLoadingTask = pdfjsLib.getDocument({ data: bytes, wasmUrl, useWasm: true });
          const documentProxy = await imageStitchPdfLoadingTask.promise;
          if (documentProxy.numPages < 1 || imageStitchFiles.length + documentProxy.numPages > 100) {
            throw new Error('image-stitch:pdf-too-many');
          }
          const pagePaths = [];
          for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
            if (imageStitchPdfImportCancelled) throw new Error('image-stitch:pdf-import-cancelled');
            const page = await documentProxy.getPage(pageNumber);
            try {
              const pageBytes = await renderPdfPageForImageStitch(page);
              const pagePath = await invoke('write_image_stitch_pdf_page', {
                sessionId: session.session_id || session.sessionId,
                pageNumber,
                bytes: Array.from(pageBytes)
              });
              pagePaths.push(pagePath);
            } finally {
              try { page.cleanup(); } catch {}
            }
            const percent = Math.round(5 + pageNumber / documentProxy.numPages * 90);
            imageStitchProgressFill.style.width = `${percent}%`;
            imageStitchProgressValue.textContent = `${percent}%`;
            imageStitchProgressText.textContent = t('home.imageStitch.pdfRendering')
              .replace('{current}', pageNumber).replace('{total}', documentProxy.numPages);
          }
          const sessionId = session.session_id || session.sessionId;
          keepSession = await openImageStitcher({ source: 'pdf-to-image', paths: pagePaths, sessionId });
          if (!keepSession) throw new Error('image-stitch:pdf-import-failed');
          window.showToast?.(t('home.imageStitch.pdfImported').replace('{count}', pagePaths.length));
          return true;
        } catch (error) {
          const message = String(error?.message || error || '');
          if (!message.includes('cancelled')) {
            window.showToast?.(message.includes('pdf-too-many') ? t('home.imageStitch.pdfTooMany') : imageStitchErrorMessage(error));
          }
          return false;
        } finally {
          if (imageStitchPdfLoadingTask) {
            try { await imageStitchPdfLoadingTask.destroy(); } catch {}
          }
          imageStitchPdfLoadingTask = null;
          if (session && !keepSession) {
            await discardImageStitchPdfSession(session.session_id || session.sessionId);
          }
          imageStitchImportingPdf = false;
          imageStitchPdfImportCancelled = false;
          setImageStitchBusy(false);
        }
      }
      window.importPdfToImageStitcher = importPdfToImageStitcher;

      imageStitchPdfPick?.addEventListener('click', async () => {
        if (imageStitchBusy || !isTauri) return;
        try {
          const { open } = await import('@tauri-apps/plugin-dialog');
          const inputPath = await open({ multiple: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
          if (typeof inputPath === 'string') await importPdfToImageStitcher(inputPath);
        } catch (error) {
          window.showToast?.(imageStitchErrorMessage(error));
        }
      });

      document.getElementById('imageStitchPick')?.addEventListener('click', async () => {
        if (imageStitchBusy) return;
        try {
          const { open } = await import('@tauri-apps/plugin-dialog');
          const paths = await open({ multiple: true, filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }] });
          if (paths) await addImageStitchPaths(paths);
        } catch (error) {
          window.showToast?.(imageStitchErrorMessage(error));
        }
      });
      document.getElementById('imageStitchHelp')?.addEventListener('click', () => openHelpOverlay('image-stitch'));
      imageStitchClear?.addEventListener('click', () => {
        if (imageStitchBusy) return;
        imageStitchFiles = [];
        renderImageStitchQueue();
        void cleanupAllImageStitchPdfSessions();
      });
      document.getElementById('imageStitchMode')?.addEventListener('click', event => {
        const button = event.target.closest('[data-mode]');
        if (!button || imageStitchBusy) return;
        imageStitchMode = button.dataset.mode;
        document.querySelectorAll('#imageStitchMode [data-mode]').forEach(item => item.classList.toggle('active', item === button));
        fitImageStitchScaleToSafeLayout(true);
        renderImageStitchQueue();
      });
      document.getElementById('imageStitchReference')?.addEventListener('click', event => {
        const button = event.target.closest('[data-reference]');
        if (!button || imageStitchBusy) return;
        imageStitchReference = button.dataset.reference;
        document.querySelectorAll('#imageStitchReference [data-reference]').forEach(item => item.classList.toggle('active', item === button));
        fitImageStitchScaleToSafeLayout(true);
        renderImageStitchQueue();
      });
      document.getElementById('imageStitchFormat')?.addEventListener('click', event => {
        const button = event.target.closest('[data-format]');
        if (!button || imageStitchBusy) return;
        imageStitchFormat = button.dataset.format;
        document.querySelectorAll('#imageStitchFormat [data-format]').forEach(item => item.classList.toggle('active', item === button));
        imageStitchQualityWrap.hidden = imageStitchFormat !== 'jpg';
        renderImageStitchQueue();
      });
      ['imageStitchSpacing', 'imageStitchScale', 'imageStitchBackground', 'imageStitchBackgroundAlpha', 'imageStitchQuality', 'imageStitchOutputName'].forEach((id) => {
        document.getElementById(id)?.addEventListener('input', () => {
          if (id === 'imageStitchBackgroundAlpha') document.getElementById('imageStitchBackgroundAlphaValue').textContent = `${document.getElementById(id).value}%`;
          renderImageStitchQueue();
        });
        document.getElementById(id)?.addEventListener('change', (event) => {
          const input = event.currentTarget;
          if (input.type === 'number') input.value = String(Math.min(Number(input.max), Math.max(Number(input.min), Number(input.value))));
          if (id === 'imageStitchSpacing') fitImageStitchScaleToSafeLayout(true);
          renderImageStitchQueue();
        });
      });

      async function ensureImageStitchProgressListener() {
        if (imageStitchProgressUnlisten) return;
        const { listen } = await import('@tauri-apps/api/event');
        imageStitchProgressUnlisten = await listen('image-stitch-progress', (event) => {
          const payload = event.payload || {};
          if (payload.jobId && imageStitchJobId && payload.jobId !== imageStitchJobId) return;
          const percent = Math.max(0, Math.min(100, Number(payload.percent) || 0));
          imageStitchProgressFill.style.width = `${percent}%`;
          imageStitchProgressValue.textContent = `${Math.round(percent)}%`;
          const labels = {
            prepare: 'home.imageStitch.preparing', inspect: 'home.imageStitch.inspecting',
            compose: 'home.imageStitch.composing', encode: 'home.imageStitch.encoding', complete: 'home.imageStitch.completing'
          };
          imageStitchProgressText.textContent = t(labels[payload.phase] || 'home.imageStitch.preparing')
            .replace('{current}', payload.current ?? 0).replace('{total}', payload.total ?? imageStitchFiles.length);
        });
      }

      function setImageStitchBusy(busy) {
        imageStitchBusy = busy;
        imageStitchProcessing.classList.toggle('visible', busy);
        imageStitchOverlay.querySelectorAll('button, input').forEach(control => { control.disabled = busy; });
        document.getElementById('imageStitchCancel').disabled = !busy;
        if (!busy) renderImageStitchQueue();
      }

      imageStitchExport?.addEventListener('click', async () => {
        const layout = currentImageStitchLayout();
        if (!layout || imageStitchBusy) return window.showToast?.(t('home.imageStitch.minimumError'));
        let outputName;
        try { outputName = imageStitchOutputName(); } catch (error) { return window.showToast?.(imageStitchErrorMessage(error)); }
        imageStitchJobId = globalThis.crypto?.randomUUID?.() || `stitch-${Date.now()}`;
        imageStitchCancelRequested = false;
        imageStitchProgressFill.style.width = '0%';
        imageStitchProgressValue.textContent = '0%';
        imageStitchProgressText.textContent = t('home.imageStitch.preparing');
        setImageStitchBusy(true);
        try {
          await ensureImageStitchProgressListener();
          const { invoke } = await import('@tauri-apps/api/core');
          const settings = imageStitchSettings();
          const result = await invoke('stitch_images', {
            inputPaths: imageStitchFiles.map(file => file.path),
            outputDir: await getOutputDir('Images/Image Stitch'),
            outputName,
            mode: settings.mode,
            reference: settings.reference,
            spacingPx: settings.spacing_px,
            scalePercent: settings.scale_percent,
            format: settings.format,
            jpegQuality: settings.jpeg_quality,
            backgroundRgba: settings.background_rgba,
            jobId: imageStitchJobId
          });
          await cleanupAllImageStitchPdfSessions(true);
          lastImageStitchOutputPath = result.output_path || result.outputPath || '';
          document.getElementById('imageStitchSuccessMeta').textContent = t('home.imageStitch.successMeta').replace('{count}', result.count).replace('{format}', result.format);
          document.getElementById('imageStitchSuccessSize').textContent = `${result.width} × ${result.height} px`;
          document.getElementById('imageStitchSuccessPath').textContent = lastImageStitchOutputPath;
          document.getElementById('imageStitchSuccessOverlay').classList.add('visible');
        } catch (error) {
          if (!String(error).includes('cancelled')) window.showToast?.(imageStitchErrorMessage(error));
        } finally {
          if (imageStitchCancelRequested) await cleanupAllImageStitchPdfSessions(true);
          setImageStitchBusy(false);
        }
      });
      document.getElementById('imageStitchCancel')?.addEventListener('click', () => {
        imageStitchProgressText.textContent = t('home.imageStitch.cancelling');
        if (imageStitchImportingPdf) {
          imageStitchPdfImportCancelled = true;
          imageStitchPdfLoadingTask?.destroy?.().catch(() => {});
          return;
        }
        imageStitchCancelRequested = true;
        import('@tauri-apps/api/core').then(({ invoke }) => invoke('cancel_convert')).catch(() => {});
      });
      document.getElementById('imageStitchSuccessOk')?.addEventListener('click', () => document.getElementById('imageStitchSuccessOverlay')?.classList.remove('visible'));
      document.getElementById('imageStitchOpenFolder')?.addEventListener('click', () => { if (lastImageStitchOutputPath) openOutputFolder(lastImageStitchOutputPath).catch(() => {}); document.getElementById('imageStitchSuccessOverlay')?.classList.remove('visible'); });
      document.getElementById('imageStitchBack')?.addEventListener('click', () => { if (!imageStitchBusy) imageStitchOverlay?.classList.remove('visible'); });
      document.querySelectorAll('.audio-list-item[data-tool="image-stitch"]').forEach(item => item.addEventListener('click', () => {
        imageStitchOverlay?.classList.add('visible');
        renderImageStitchQueue();
        if (typeof createIcons === 'function') createIcons({ icons });
      }));
      imageStitchOverlay?.addEventListener('dragover', event => { event.preventDefault(); if (!imageStitchBusy) imageStitchDropZone?.classList.add('visible'); });
      imageStitchOverlay?.addEventListener('dragleave', event => { if (!imageStitchOverlay.contains(event.relatedTarget)) imageStitchDropZone?.classList.remove('visible'); });
      imageStitchOverlay?.addEventListener('drop', event => { event.preventDefault(); imageStitchDropZone?.classList.remove('visible'); });
      if (imageStitchOverlay && isTauri) {
        (async () => {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          await getCurrentWebview().onDragDropEvent(async (event) => {
            if (!imageStitchOverlay.classList.contains('visible') || imageStitchBusy) return;
            const payload = event.payload;
            if (payload.type === 'over') imageStitchDropZone?.classList.add('visible');
            else if (payload.type === 'leave') imageStitchDropZone?.classList.remove('visible');
            else if (payload.type === 'drop') {
              imageStitchDropZone?.classList.remove('visible');
              await addImageStitchPaths(payload.paths || []);
            }
          });
        })().catch(error => console.error('Cannot register image stitch drag and drop:', error));
      }
      renderImageStitchQueue();

      // ===== Video Frame Capture Tool =====
      const videoFrameOverlay = document.getElementById('videoFrameOverlay');
      const videoFrameBack = document.getElementById('videoFrameBack');
      const videoFramePick = document.getElementById('videoFramePick');
      const videoFrameChange = document.getElementById('videoFrameChange');
      const videoFrameDropZone = document.getElementById('videoFrameDropZone');
      const videoFrameEmpty = document.getElementById('videoFrameEmpty');
      const videoFrameEditor = document.getElementById('videoFrameEditor');
      const videoFramePreviewVideo = document.getElementById('videoFramePreviewVideo');
      const videoFramePreviewImage = document.getElementById('videoFramePreviewImage');
      const videoFramePreviewToggle = document.getElementById('videoFramePreviewToggle');
      const videoFramePreviewPlayIcon = videoFramePreviewToggle?.querySelector('.video-gif-preview-play-icon');
      const videoFramePreviewPauseIcon = videoFramePreviewToggle?.querySelector('.video-gif-preview-pause-icon');
      const videoFrameTimeline = document.getElementById('videoFrameTimeline');
      const videoFrameTimestamp = document.getElementById('videoFrameTimestamp');
      const videoFrameTime = document.getElementById('videoFrameTime');
      const videoFrameName = document.getElementById('videoFrameName');
      const videoFramePrev = document.getElementById('videoFramePrev');
      const videoFrameNext = document.getElementById('videoFrameNext');
      const videoFrameFormat = document.getElementById('videoFrameFormat');
      const videoFrameExport = document.getElementById('videoFrameExport');
      const videoFrameProcessMask = document.getElementById('videoFrameProcessMask');
      const videoFrameProcessBarFill = document.getElementById('videoFrameProcessBarFill');
      const videoFrameProcessText = document.getElementById('videoFrameProcessText');
      const videoFrameCancelBtn = document.getElementById('videoFrameCancelBtn');
      const videoFrameSuccessOverlay = document.getElementById('videoFrameSuccessOverlay');
      const videoFrameSuccessMeta = document.getElementById('videoFrameSuccessMeta');
      const videoFrameSuccessFormat = document.getElementById('videoFrameSuccessFormat');
      const videoFrameSuccessTime = document.getElementById('videoFrameSuccessTime');
      const videoFrameSuccessPath = document.getElementById('videoFrameSuccessPath');
      const videoFrameOpenFolder = document.getElementById('videoFrameOpenFolder');
      const videoFrameSuccessOk = document.getElementById('videoFrameSuccessOk');
      const videoFramePlasmaBg = document.getElementById('videoFramePlasmaBg');
      let videoFrameFile = null;
      let videoFrameDuration = 0;
      let videoFrameStepMs = 33;
      let videoFrameOutputFormat = 'png';
      let videoFramePlasmaDispose = null;
      let videoFrameProcessing = false;
      let videoFrameProgressUnlisten = null;
      let lastVideoFrameOutputPath = '';
      let videoFrameTimestampMs = 0;
      let videoFrameUseNativePreview = false;
      let videoFrameSeekRaf = 0;
      let videoFramePendingSeekMs = 0;
      let videoFramePreviewClipRange = null;
      let videoFramePreviewClipToken = 0;
      let videoFramePreviewClipLoading = false;
      const videoFramePreviewState = { token: 0, timer: null, pending: null, inFlight: false, errorShown: false };
      const VIDEO_FRAME_PREVIEW_WINDOW_MS = 30_000;

      function isSupportedVideoPath(filePath) {
        const lower = String(filePath || '').toLowerCase();
        return videoExts.some(ext => lower.endsWith(`.${ext}`));
      }

      function localVideoFile(filePath, size = 0) {
        return {
          name: String(filePath || '').split(/[\\/]/).pop() || String(filePath || ''),
          path: String(filePath || ''),
          size: Number(size) || 0
        };
      }

      function firstSupportedVideoPath(paths) {
        return (Array.isArray(paths) ? paths : []).find(isSupportedVideoPath) || '';
      }

      function clearQueuedVideoPreview(state, image) {
        state.token += 1;
        if (state.timer) clearTimeout(state.timer);
        state.timer = null;
        state.pending = null;
        state.errorShown = false;
        image?.removeAttribute('src');
        image?.classList.remove('is-loading', 'is-ready');
      }

      function runQueuedVideoPreview(state) {
        if (state.inFlight || !state.pending) return;
        const request = state.pending;
        state.pending = null;
        state.inFlight = true;
        request.image?.classList.add('is-loading');
        (async () => {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const result = await invoke('render_video_preview_frame', {
              inputPath: request.inputPath,
              timestampMs: request.timestampMs
            });
            const dataUrl = result?.image_data_url || result?.imageDataUrl;
            if (!dataUrl) throw new Error('video-preview:empty-result');
            if (request.token !== state.token) return;
            request.image.src = dataUrl;
            request.image.classList.add('is-ready');
            state.errorShown = false;
          } catch (error) {
            if (request.token === state.token && !state.errorShown) {
              state.errorShown = true;
              window.showToast?.('无法生成视频预览帧，仍可继续导出。');
              console.warn('Video preview frame failed:', error);
            }
          } finally {
            state.inFlight = false;
            if (request.token === state.token) request.image?.classList.remove('is-loading');
            if (state.pending) runQueuedVideoPreview(state);
          }
        })();
      }

      function scheduleVideoPreview(state, image, inputPath, timestampMs, immediate = false) {
        if (!image || !inputPath) return;
        const token = state.token + 1;
        state.token = token;
        state.pending = { token, image, inputPath, timestampMs };
        if (state.timer) clearTimeout(state.timer);
        const start = () => {
          state.timer = null;
          runQueuedVideoPreview(state);
        };
        if (immediate) start();
        else state.timer = setTimeout(start, 100);
      }

      function updateVideoFramePreviewToggle() {
        const isPlaying = Boolean(videoFramePreviewVideo && !videoFramePreviewVideo.paused && !videoFramePreviewVideo.ended);
        const enabled = Boolean(videoFrameFile?.path && videoFrameDuration > 0 && !videoFramePreviewClipLoading);
        if (videoFramePreviewToggle) {
          videoFramePreviewToggle.disabled = !enabled;
          videoFramePreviewToggle.classList.toggle('is-loading', videoFramePreviewClipLoading);
          videoFramePreviewToggle.classList.toggle('is-playing', isPlaying);
          videoFramePreviewToggle.setAttribute('aria-pressed', String(isPlaying));
          const label = videoFramePreviewClipLoading ? '正在准备视频预览' : (isPlaying ? '暂停视频' : '播放视频');
          videoFramePreviewToggle.setAttribute('aria-label', label);
          videoFramePreviewToggle.title = label;
        }
        if (videoFramePreviewPlayIcon) videoFramePreviewPlayIcon.hidden = isPlaying;
        if (videoFramePreviewPauseIcon) videoFramePreviewPauseIcon.hidden = !isPlaying;
      }

      function showVideoFrameFallbackPreview(inputPath, timestampMs, immediate = false) {
        if (videoFramePreviewVideo && videoFramePreviewVideo.paused) videoFramePreviewVideo.hidden = true;
        if (videoFramePreviewImage) videoFramePreviewImage.hidden = false;
        scheduleVideoPreview(videoFramePreviewState, videoFramePreviewImage, inputPath, timestampMs, immediate);
      }

      function updateVideoFrameTimestampUi(milliseconds) {
        const value = Math.max(0, Math.min(Math.round(videoFrameDuration * 1000), Math.round(milliseconds)));
        videoFrameTimestampMs = value;
        if (videoFrameTimeline) videoFrameTimeline.value = String(value);
        if (videoFrameTimestamp) videoFrameTimestamp.value = String(value);
        if (videoFrameTime) videoFrameTime.textContent = frameTimeLabel(value);
        return value;
      }

      function videoFrameMaxMs() {
        return Math.max(0, Math.round((Number(videoFrameDuration) || 0) * 1000));
      }

      function videoFrameClipWindowFor(milliseconds) {
        const maxMs = videoFrameMaxMs();
        if (maxMs <= 0) return null;
        const duration = Math.min(VIDEO_FRAME_PREVIEW_WINDOW_MS, maxMs);
        let startMs = 0;
        if (maxMs > duration) {
          startMs = Math.floor(Math.max(0, Math.min(maxMs, milliseconds)) / duration) * duration;
          startMs = Math.min(startMs, maxMs - duration);
        }
        let endMs = Math.min(maxMs, startMs + duration);
        if (endMs <= startMs) endMs = Math.min(maxMs, startMs + 1);
        if (endMs <= startMs) return null;
        return { startMs, endMs };
      }

      function videoFrameClipContains(milliseconds) {
        return Boolean(
          videoFramePreviewClipRange
          && milliseconds >= videoFramePreviewClipRange.startMs
          && milliseconds <= videoFramePreviewClipRange.endMs
        );
      }

      function seekVideoFramePreviewClip(milliseconds, immediate = false) {
        if (!videoFramePreviewVideo || !videoFrameClipContains(milliseconds)) return false;
        const applySeek = () => {
          if (!videoFramePreviewVideo || !videoFrameClipContains(videoFramePendingSeekMs)) return;
          const offsetSeconds = Math.max(0, Math.min(
            (videoFramePreviewClipRange.endMs - videoFramePreviewClipRange.startMs) / 1000,
            (videoFramePendingSeekMs - videoFramePreviewClipRange.startMs) / 1000
          ));
          try {
            videoFramePreviewVideo.currentTime = offsetSeconds;
            videoFramePreviewVideo.hidden = false;
            if (videoFramePreviewImage) videoFramePreviewImage.hidden = true;
          } catch (error) {
            if (videoFrameFile?.path) showVideoFrameFallbackPreview(videoFrameFile.path, videoFramePendingSeekMs, true);
          }
        };
        videoFramePendingSeekMs = Math.max(0, Math.round(milliseconds));
        if (immediate) {
          if (videoFrameSeekRaf) cancelAnimationFrame(videoFrameSeekRaf);
          videoFrameSeekRaf = 0;
          applySeek();
          return true;
        }
        if (!videoFrameSeekRaf) {
          videoFrameSeekRaf = requestAnimationFrame(() => {
            videoFrameSeekRaf = 0;
            applySeek();
          });
        }
        return true;
      }

      function resetVideoFramePreviewClip({ restoreStill = true } = {}) {
        videoFramePreviewClipToken += 1;
        videoFramePreviewClipLoading = false;
        videoFramePreviewClipRange = null;
        videoFrameUseNativePreview = false;
        if (videoFrameSeekRaf) cancelAnimationFrame(videoFrameSeekRaf);
        videoFrameSeekRaf = 0;
        if (videoFramePreviewVideo) {
          videoFramePreviewVideo.pause();
          videoFramePreviewVideo.removeAttribute('src');
          videoFramePreviewVideo.load();
          videoFramePreviewVideo.hidden = true;
        }
        if (restoreStill && videoFramePreviewImage) videoFramePreviewImage.hidden = false;
        updateVideoFramePreviewToggle();
      }

      async function loadVideoFramePreviewClip(milliseconds, { autoplay = false, showError = false } = {}) {
        if (!videoFramePreviewVideo || !videoFrameFile?.path || !isTauri) return false;
        const range = videoFrameClipWindowFor(milliseconds);
        if (!range) return false;
        const token = ++videoFramePreviewClipToken;
        videoFramePreviewClipLoading = true;
        updateVideoFramePreviewToggle();
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const result = await invoke('render_video_preview_clip', {
            inputPath: videoFrameFile.path,
            startMs: range.startMs,
            endMs: range.endMs
          });
          const source = result?.media_data_url || result?.mediaDataUrl;
          if (!source) throw new Error('视频预览准备失败。');
          if (token !== videoFramePreviewClipToken) return false;
          await new Promise((resolve, reject) => {
            const ready = () => { cleanup(); resolve(); };
            const failed = () => { cleanup(); reject(new Error('无法播放视频预览。')); };
            const cleanup = () => {
              videoFramePreviewVideo.removeEventListener('canplay', ready);
              videoFramePreviewVideo.removeEventListener('error', failed);
            };
            videoFramePreviewVideo.addEventListener('canplay', ready, { once: true });
            videoFramePreviewVideo.addEventListener('error', failed, { once: true });
            videoFramePreviewVideo.pause();
            videoFramePreviewVideo.src = source;
            videoFramePreviewVideo.hidden = false;
            if (videoFramePreviewImage) videoFramePreviewImage.hidden = true;
            videoFramePreviewVideo.load();
          });
          if (token !== videoFramePreviewClipToken) return false;
          videoFramePreviewClipRange = range;
          videoFrameUseNativePreview = true;
          seekVideoFramePreviewClip(Math.max(range.startMs, Math.min(range.endMs, milliseconds)), true);
          if (autoplay) {
            await videoFramePreviewVideo.play();
          }
          return true;
        } catch (error) {
          if (token === videoFramePreviewClipToken) {
            videoFramePreviewClipRange = null;
            videoFrameUseNativePreview = false;
            if (showError) window.showToast?.(error?.message || '无法播放视频。');
            if (videoFrameFile?.path) showVideoFrameFallbackPreview(videoFrameFile.path, milliseconds, true);
          }
          return false;
        } finally {
          if (token === videoFramePreviewClipToken) {
            videoFramePreviewClipLoading = false;
            updateVideoFramePreviewToggle();
          }
        }
      }

      function seekVideoFramePreview(milliseconds, immediate = false) {
        if (seekVideoFramePreviewClip(milliseconds)) return true;
        if (videoFramePreviewVideo && !videoFramePreviewVideo.paused) videoFramePreviewVideo.pause();
        if (videoFrameFile?.path) showVideoFrameFallbackPreview(videoFrameFile.path, milliseconds, immediate);
        if (!videoFramePreviewClipLoading && (immediate || videoFrameMaxMs() <= VIDEO_FRAME_PREVIEW_WINDOW_MS)) {
          void loadVideoFramePreviewClip(milliseconds);
        }
        return true;
      }

      async function playVideoFramePreview() {
        if (!videoFramePreviewVideo || !videoFrameFile?.path || videoFramePreviewClipLoading) return;
        let targetMs = videoFrameTimestampMs;
        const maxMs = videoFrameMaxMs();
        if (maxMs > 0 && targetMs >= maxMs - 50) {
          targetMs = 0;
          updateVideoFrameTimestampUi(0);
        }
        try {
          if (!videoFrameClipContains(targetMs)) {
            await loadVideoFramePreviewClip(targetMs, { autoplay: true, showError: true });
            return;
          }
          seekVideoFramePreviewClip(targetMs, true);
          videoFramePreviewVideo.hidden = false;
          if (videoFramePreviewImage) videoFramePreviewImage.hidden = true;
          await videoFramePreviewVideo.play();
        } catch (error) {
          window.showToast?.(error?.message || '无法播放视频。');
          updateVideoFramePreviewToggle();
        }
      }

      function pauseVideoFramePreview() {
        videoFramePreviewVideo?.pause();
        updateVideoFramePreviewToggle();
      }

      function syncVideoFrameTimestamp(milliseconds, renderPreview = true, immediate = false) {
        const value = updateVideoFrameTimestampUi(milliseconds);
        if (renderPreview && videoFrameFile?.path) {
          seekVideoFramePreview(value, immediate);
        }
      }
      function clearVideoFrame() {
        videoFrameFile = null; videoFrameDuration = 0; videoFrameStepMs = 33; videoFrameTimestampMs = 0; videoFrameUseNativePreview = false; videoFramePendingSeekMs = 0; videoFramePreviewClipRange = null; videoFramePreviewClipLoading = false; videoFramePreviewClipToken += 1;
        if (videoFrameSeekRaf) cancelAnimationFrame(videoFrameSeekRaf);
        videoFrameSeekRaf = 0;
        clearQueuedVideoPreview(videoFramePreviewState, videoFramePreviewImage);
        if (videoFramePreviewVideo) {
          videoFramePreviewVideo.pause();
          videoFramePreviewVideo.removeAttribute('src');
          videoFramePreviewVideo.load();
          videoFramePreviewVideo.hidden = true;
        }
        if (videoFramePreviewImage) videoFramePreviewImage.hidden = true;
        updateVideoFramePreviewToggle();
        videoFrameOverlay?.classList.remove('is-editing');
        if (videoFrameEditor) videoFrameEditor.hidden = true;
        if (videoFrameEmpty) videoFrameEmpty.hidden = false;
      }
      function openVideoFrameOverlay() { videoFrameOverlay?.classList.add('visible'); if (videoFramePlasmaBg && !videoFramePlasmaDispose) videoFramePlasmaDispose = initPlasma(videoFramePlasmaBg, { color: '#6B6B6B', speed: 0.45, scale: 1, opacity: 1, mouseInteractive: false }); }
      function closeVideoFrameOverlay() { videoFrameOverlay?.classList.remove('visible'); clearVideoFrame(); if (videoFramePlasmaDispose) { videoFramePlasmaDispose(); videoFramePlasmaDispose = null; } }
      async function loadVideoFrameFile(selected) {
        if (!isTauri) { window.showToast?.('视频单帧导出仅可在桌面端使用。'); return; }
        if (typeof selected !== 'string' || !selected) return;
        try {
          const file = { name: selected.split(/[\\/]/).pop() || selected, path: selected, size: 0 };
          validateVideoFrameInput(file);
          const { invoke } = await import('@tauri-apps/api/core');
          const probe = await invoke('probe_video', { inputPath: selected });
          const duration = Number(probe?.duration);
          if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取视频时长。');
          clearQueuedVideoPreview(videoFramePreviewState, videoFramePreviewImage);
          videoFrameFile = file;
          videoFrameDuration = duration;
          videoFrameStepMs = 33;
          videoFrameFile.size = Number(probe?.file_size ?? probe?.fileSize) || 0;
          videoFrameName.textContent = file.name;
          videoFrameTimeline.max = String(Math.floor(duration * 1000));
          if (Number.isFinite(probe?.frame_rate) && probe.frame_rate > 0 && probe.frame_rate <= 240) videoFrameStepMs = 1000 / probe.frame_rate;
          videoFrameEmpty.hidden = true;
          videoFrameEditor.hidden = false;
          videoFrameOverlay?.classList.add('is-editing');
          updateVideoFrameTimestampUi(0);
          await loadVideoFramePreviewClip(0);
          syncVideoFrameTimestamp(0, true, true);
        } catch (error) { window.showToast?.(error?.message || '无法读取视频文件。'); }
      }
      async function chooseVideoFrameFile() {
        if (!isTauri) { window.showToast?.('视频单帧导出仅可在桌面端使用。'); return; }
        try {
          const { open } = await import('@tauri-apps/plugin-dialog');
          const selected = await open({ multiple: false, filters: [{ name: 'Video', extensions: videoExts }] });
          if (typeof selected !== 'string') return;
          await loadVideoFrameFile(selected);
        } catch (error) { window.showToast?.(error?.message || '无法读取视频文件。'); }
      }
      videoFrameTimeline?.addEventListener('input', () => syncVideoFrameTimestamp(Number(videoFrameTimeline.value)));
      videoFrameTimestamp?.addEventListener('change', () => { try { syncVideoFrameTimestamp(normalizeVideoFrameTimestamp(Number(videoFrameTimestamp.value), videoFrameDuration), true, true); } catch (error) { syncVideoFrameTimestamp(videoFrameTimestampMs, false); } });
      videoFramePrev?.addEventListener('click', () => syncVideoFrameTimestamp(Math.round(videoFrameTimestampMs - videoFrameStepMs), true, true));
      videoFrameNext?.addEventListener('click', () => syncVideoFrameTimestamp(Math.round(videoFrameTimestampMs + videoFrameStepMs), true, true));
      videoFramePick?.addEventListener('click', chooseVideoFrameFile); videoFrameChange?.addEventListener('click', chooseVideoFrameFile); videoFrameBack?.addEventListener('click', closeVideoFrameOverlay);
      videoFrameFormat?.addEventListener('click', event => { const button = event.target.closest('[data-format]'); if (!button) return; videoFrameOutputFormat = button.dataset.format; videoFrameFormat.querySelectorAll('[data-format]').forEach(item => item.classList.toggle('active', item === button)); });
      videoFramePreviewToggle?.addEventListener('click', () => {
        if (!videoFrameFile?.path || !videoFramePreviewVideo || videoFramePreviewClipLoading) return;
        if (videoFramePreviewVideo.paused || videoFramePreviewVideo.ended) playVideoFramePreview();
        else pauseVideoFramePreview();
      });
      videoFramePreviewVideo?.addEventListener('play', updateVideoFramePreviewToggle);
      videoFramePreviewVideo?.addEventListener('pause', updateVideoFramePreviewToggle);
      videoFramePreviewVideo?.addEventListener('ended', updateVideoFramePreviewToggle);
      videoFramePreviewVideo?.addEventListener('loadedmetadata', () => {
        if (!videoFrameUseNativePreview) return;
        seekVideoFramePreviewClip(videoFrameTimestampMs, true);
        updateVideoFramePreviewToggle();
      });
      videoFramePreviewVideo?.addEventListener('timeupdate', () => {
        if (!videoFrameUseNativePreview || !videoFramePreviewVideo || videoFramePreviewVideo.seeking) return;
        const baseMs = videoFramePreviewClipRange?.startMs || 0;
        updateVideoFrameTimestampUi(baseMs + Math.round(videoFramePreviewVideo.currentTime * 1000));
      });
      videoFramePreviewVideo?.addEventListener('seeked', () => {
        if (!videoFrameUseNativePreview || !videoFramePreviewVideo) return;
        const baseMs = videoFramePreviewClipRange?.startMs || 0;
        updateVideoFrameTimestampUi(baseMs + Math.round(videoFramePreviewVideo.currentTime * 1000));
      });
      videoFramePreviewVideo?.addEventListener('error', () => {
        if (!videoFrameUseNativePreview) return;
        videoFrameUseNativePreview = false;
        videoFramePreviewClipRange = null;
        updateVideoFramePreviewToggle();
        if (videoFrameFile?.path) showVideoFrameFallbackPreview(videoFrameFile.path, videoFrameTimestampMs, true);
      });
      function closeVideoFrameSuccess() { videoFrameSuccessOverlay?.classList.remove('visible'); }
      function showVideoFrameSuccess(result) {
        lastVideoFrameOutputPath = result.output_path || result.outputPath || '';
        if (videoFrameSuccessMeta) videoFrameSuccessMeta.textContent = videoFrameFile?.name || '';
        if (videoFrameSuccessFormat) videoFrameSuccessFormat.textContent = String(result.format || videoFrameOutputFormat).toUpperCase();
        if (videoFrameSuccessTime) videoFrameSuccessTime.textContent = frameTimeLabel(result.timestamp_ms ?? videoFrameTimestampMs);
        if (videoFrameSuccessPath) videoFrameSuccessPath.textContent = lastVideoFrameOutputPath;
        videoFrameSuccessOverlay?.classList.add('visible');
      }
      videoFrameCancelBtn?.addEventListener('click', () => import('@tauri-apps/api/core').then(({ invoke }) => invoke('cancel_convert')).catch(() => {}));
      videoFrameSuccessOk?.addEventListener('click', closeVideoFrameSuccess);
      videoFrameOpenFolder?.addEventListener('click', () => { if (lastVideoFrameOutputPath) openOutputFolder(lastVideoFrameOutputPath).catch(() => {}); closeVideoFrameSuccess(); });
      videoFrameExport?.addEventListener('click', async () => {
        if (!videoFrameFile?.path || !isTauri || videoFrameProcessing) return;
        videoFrameProcessing = true;
        if (videoFrameProcessBarFill) videoFrameProcessBarFill.style.width = '8%';
        if (videoFrameProcessText) videoFrameProcessText.textContent = '正在导出单帧图...';
        videoFrameProcessMask?.classList.add('visible');
        let unlisten;
        try {
          const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
          unlisten = await listen('video-frame-progress', event => {
            const progress = Math.max(0, Math.min(1, Number(event.payload?.progress) || 0));
            if (videoFrameProcessBarFill) videoFrameProcessBarFill.style.width = `${Math.max(8, progress * 100)}%`;
            if (videoFrameProcessText) videoFrameProcessText.textContent = event.payload?.phase === 'publish' ? '正在发布图片...' : '正在定位并导出帧...';
          });
          const result = await invoke('extract_video_frame', { inputPath: videoFrameFile.path, outputDir: await getOutputDir('Videos'), timestampMs: videoFrameTimestampMs, format: normalizeVideoFrameFormat(videoFrameOutputFormat) });
          if (videoFrameProcessBarFill) videoFrameProcessBarFill.style.width = '100%';
          setTimeout(() => { videoFrameProcessMask?.classList.remove('visible'); if (videoFrameProcessBarFill) videoFrameProcessBarFill.style.width = '0%'; showVideoFrameSuccess(result); }, 240);
        } catch (error) {
          videoFrameProcessMask?.classList.remove('visible');
          if (videoFrameProcessBarFill) videoFrameProcessBarFill.style.width = '0%';
          window.showToast?.(error?.message || '导出失败。');
        } finally {
          if (unlisten) unlisten();
          videoFrameProcessing = false;
        }
      });
      document.querySelectorAll('.audio-list-item[data-tool="video-frame"]').forEach(item => {
        item.addEventListener('click', () => openToolWithFfmpegCheck(openVideoFrameOverlay));
        item.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openToolWithFfmpegCheck(openVideoFrameOverlay);
          }
        });
      });
      function showVideoFrameDropZone() {
        videoFrameDropZone?.classList.add('visible');
        videoFrameOverlay?.classList.add('drag-over');
      }
      function hideVideoFrameDropZone() {
        videoFrameDropZone?.classList.remove('visible');
        videoFrameOverlay?.classList.remove('drag-over');
      }
      if (videoFrameOverlay && isTauri) {
        (async () => {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          await getCurrentWebview().onDragDropEvent(async event => {
            if (!videoFrameOverlay.classList.contains('visible') || videoFrameProcessing) return;
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') showVideoFrameDropZone();
            else if (payload.type === 'leave') hideVideoFrameDropZone();
            else if (payload.type === 'drop') {
              hideVideoFrameDropZone();
              const selected = firstSupportedVideoPath(payload.paths || []);
              if (selected) await loadVideoFrameFile(selected);
              else window.showToast?.('请拖入支持的视频文件。');
            }
          });
        })().catch(error => console.error('Cannot register video frame drag and drop:', error));
      }

      // ===== Video GIF Tool =====
      const videoGifOverlay = document.getElementById('videoGifOverlay');
      const videoGifBack = document.getElementById('videoGifBack');
      const videoGifPick = document.getElementById('videoGifPick');
      const videoGifChange = document.getElementById('videoGifChange');
      const videoGifDropZone = document.getElementById('videoGifDropZone');
      const videoGifEmpty = document.getElementById('videoGifEmpty');
      const videoGifEditor = document.getElementById('videoGifEditor');
      const videoGifPreviewImage = document.getElementById('videoGifPreviewImage');
      const videoGifRangePreview = document.getElementById('videoGifRangePreview');
      const videoGifPreviewToggle = document.getElementById('videoGifPreviewToggle');
      const videoGifPreviewPlayIcon = videoGifPreviewToggle?.querySelector('.video-gif-preview-play-icon');
      const videoGifPreviewPauseIcon = videoGifPreviewToggle?.querySelector('.video-gif-preview-pause-icon');
      const videoGifTimelineWrap = document.getElementById('videoGifTimelineWrap');
      const videoGifTimeline = document.getElementById('videoGifTimeline');
      const videoGifName = document.getElementById('videoGifName');
      const videoGifPreviewTime = document.getElementById('videoGifPreviewTime');
      const videoGifSelectStart = document.getElementById('videoGifSelectStart');
      const videoGifSelectEnd = document.getElementById('videoGifSelectEnd');
      const videoGifStartLabel = document.getElementById('videoGifStartLabel');
      const videoGifEndLabel = document.getElementById('videoGifEndLabel');
      const videoGifDurationLabel = document.getElementById('videoGifDurationLabel');
      const videoGifAdjustHint = document.getElementById('videoGifAdjustHint');
      const videoGifPrev = document.getElementById('videoGifPrev');
      const videoGifNext = document.getElementById('videoGifNext');
      const videoGifFrameRateOptions = document.getElementById('videoGifFrameRate');
      const videoGifResolutionOptions = document.getElementById('videoGifResolution');
      const videoGifQualityOptions = document.getElementById('videoGifQuality');
      const videoGifEstimate = document.getElementById('videoGifEstimate');
      const videoGifExport = document.getElementById('videoGifExport');
      const videoGifProcessMask = document.getElementById('videoGifProcessMask');
      const videoGifProcessBarFill = document.getElementById('videoGifProcessBarFill');
      const videoGifProcessText = document.getElementById('videoGifProcessText');
      const videoGifCancelBtn = document.getElementById('videoGifCancelBtn');
      const videoGifSuccessOverlay = document.getElementById('videoGifSuccessOverlay');
      const videoGifSuccessMeta = document.getElementById('videoGifSuccessMeta');
      const videoGifSuccessDuration = document.getElementById('videoGifSuccessDuration');
      const videoGifSuccessSpec = document.getElementById('videoGifSuccessSpec');
      const videoGifSuccessSize = document.getElementById('videoGifSuccessSize');
      const videoGifSuccessPath = document.getElementById('videoGifSuccessPath');
      const videoGifOpenFolder = document.getElementById('videoGifOpenFolder');
      const videoGifSuccessOk = document.getElementById('videoGifSuccessOk');
      const videoGifPlasmaBg = document.getElementById('videoGifPlasmaBg');
      let videoGifFile = null;
      let videoGifDuration = 0;
      let videoGifStepMs = 33;
      let videoGifStartMs = 0;
      let videoGifEndMs = 30_000;
      let videoGifActivePoint = 'start';
      let videoGifFrameRate = 12;
      let videoGifWidth = 640;
      let videoGifQuality = 'balanced';
      let videoGifSourceWidth = 0;
      let videoGifSourceHeight = 0;
      let videoGifSourceSize = 0;
      let videoGifProcessing = false;
      let videoGifPlasmaDispose = null;
      let lastVideoGifOutputPath = '';
      let videoGifPreviewTimestampMs = 0;
      const videoGifPreviewState = { token: 0, timer: null, pending: null, inFlight: false, errorShown: false };
      let videoGifPreviewPlaybackToken = 0;
      let videoGifPreviewPlaybackLoading = false;
      let videoGifPreviewPlaybackRange = null;
      const videoGifQualityLabels = { high: '清晰', balanced: '均衡', small: '小体积', tiny: '极小' };
      const videoGifEstimateFactors = { high: 0.21, balanced: 0.14, small: 0.095, tiny: 0.068 };

      function videoGifSelectionIsPlayable() {
        return Boolean(videoGifFile?.path)
          && Number.isFinite(videoGifStartMs)
          && Number.isFinite(videoGifEndMs)
          && videoGifEndMs > videoGifStartMs;
      }

      function videoGifSelectionKey() {
        return videoGifSelectionIsPlayable()
          ? `${videoGifFile.path}\u0000${videoGifStartMs}\u0000${videoGifEndMs}`
          : null;
      }

      function updateVideoGifPreviewToggle() {
        const isPlaying = Boolean(videoGifRangePreview && !videoGifRangePreview.paused && !videoGifRangePreview.ended);
        const enabled = videoGifSelectionIsPlayable() && !videoGifPreviewPlaybackLoading;
        if (videoGifPreviewToggle) {
          videoGifPreviewToggle.disabled = !enabled;
          videoGifPreviewToggle.classList.toggle('is-loading', videoGifPreviewPlaybackLoading);
          videoGifPreviewToggle.classList.toggle('is-playing', isPlaying);
          videoGifPreviewToggle.setAttribute('aria-pressed', String(isPlaying));
          const label = videoGifPreviewPlaybackLoading
            ? '正在准备所选片段预览'
            : isPlaying
              ? '暂停所选片段'
              : videoGifPreviewPlaybackRange
                ? '继续播放所选片段'
                : '播放所选片段';
          videoGifPreviewToggle.setAttribute('aria-label', label);
          videoGifPreviewToggle.title = label;
        }
        if (videoGifPreviewPlayIcon) videoGifPreviewPlayIcon.hidden = isPlaying;
        if (videoGifPreviewPauseIcon) videoGifPreviewPauseIcon.hidden = !isPlaying;
      }

      function videoGifPercent(milliseconds) {
        const max = Math.max(1, Math.round(videoGifDuration * 1000));
        return `${Math.max(0, Math.min(100, (Number(milliseconds) || 0) / max * 100)).toFixed(3)}%`;
      }

      function updateVideoGifTimelineVisual() {
        if (!videoGifTimelineWrap) return;
        videoGifTimelineWrap.style.setProperty('--gif-start', videoGifPercent(videoGifStartMs));
        videoGifTimelineWrap.style.setProperty('--gif-end', videoGifPercent(videoGifEndMs));
        videoGifTimelineWrap.style.setProperty('--gif-cursor', videoGifPercent(videoGifPreviewTimestampMs));
      }

      function estimateVideoGifBytes() {
        if (!videoGifSelectionIsPlayable()) return null;
        const durationSeconds = Math.max(0.001, (videoGifEndMs - videoGifStartMs) / 1000);
        const frames = Math.max(1, Math.round(durationSeconds * Math.max(1, videoGifFrameRate)));
        const sourceWidth = videoGifSourceWidth > 0 ? videoGifSourceWidth : videoGifWidth;
        const sourceHeight = videoGifSourceHeight > 0 ? videoGifSourceHeight : Math.round(sourceWidth * 9 / 16);
        const outputWidth = Math.max(160, Math.min(videoGifWidth, sourceWidth));
        const outputHeight = Math.max(2, Math.round(outputWidth * sourceHeight / Math.max(1, sourceWidth) / 2) * 2);
        const factor = videoGifEstimateFactors[videoGifQuality] || videoGifEstimateFactors.balanced;
        const rawEstimate = frames * outputWidth * outputHeight * factor;
        const sourceBound = videoGifSourceSize > 0 ? videoGifSourceSize * (durationSeconds / Math.max(durationSeconds, videoGifDuration || durationSeconds)) * 2.2 : 0;
        const center = Math.max(rawEstimate, sourceBound);
        return {
          low: Math.max(1, Math.round(center * 0.72)),
          high: Math.max(1, Math.round(center * 1.38)),
          frames,
          width: outputWidth,
          height: outputHeight
        };
      }

      function updateVideoGifEstimate() {
        if (!videoGifEstimate) return;
        const estimate = estimateVideoGifBytes();
        if (!estimate) {
          videoGifEstimate.textContent = '预计体积：选择视频后自动估算';
          return;
        }
        videoGifEstimate.textContent = `预计体积：${formatFileSize(estimate.low)} - ${formatFileSize(estimate.high)} · ${estimate.frames} 帧 · ${estimate.width}×${estimate.height} · ${videoGifQualityLabels[videoGifQuality] || '均衡'}`;
      }

      function resetVideoGifSelectionPlayback({ restoreStill = true } = {}) {
        videoGifPreviewPlaybackToken += 1;
        videoGifPreviewPlaybackLoading = false;
        videoGifPreviewPlaybackRange = null;
        if (videoGifRangePreview) {
          videoGifRangePreview.pause();
          videoGifRangePreview.removeAttribute('src');
          videoGifRangePreview.load();
          videoGifRangePreview.hidden = true;
        }
        if (restoreStill && videoGifPreviewImage) videoGifPreviewImage.hidden = false;
        updateVideoGifPreviewToggle();
      }

      function pauseVideoGifSelectionPlayback() {
        videoGifRangePreview?.pause();
        updateVideoGifPreviewToggle();
      }

      async function playVideoGifSelectionPlayback() {
        if (!videoGifSelectionIsPlayable() || !videoGifRangePreview) return;
        const selectionKey = videoGifSelectionKey();
        if (videoGifPreviewPlaybackRange === selectionKey && videoGifRangePreview.getAttribute('src')) {
          try {
            await videoGifRangePreview.play();
          } catch (error) {
            window.showToast?.(error?.message || '无法播放所选片段。');
          }
          updateVideoGifPreviewToggle();
          return;
        }

        const token = ++videoGifPreviewPlaybackToken;
        videoGifPreviewPlaybackLoading = true;
        updateVideoGifPreviewToggle();
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const result = await invoke('render_video_preview_clip', {
            inputPath: videoGifFile.path,
            startMs: videoGifStartMs,
            endMs: videoGifEndMs
          });
          const source = result?.media_data_url || result?.mediaDataUrl;
          if (!source) throw new Error('视频预览准备失败。');
          if (token !== videoGifPreviewPlaybackToken || selectionKey !== videoGifSelectionKey()) return;

          await new Promise((resolve, reject) => {
            const ready = () => { cleanup(); resolve(); };
            const failed = () => { cleanup(); reject(new Error('无法播放所选片段。')); };
            const cleanup = () => {
              videoGifRangePreview.removeEventListener('canplay', ready);
              videoGifRangePreview.removeEventListener('error', failed);
            };
            videoGifRangePreview.addEventListener('canplay', ready, { once: true });
            videoGifRangePreview.addEventListener('error', failed, { once: true });
            videoGifRangePreview.src = source;
            videoGifRangePreview.hidden = false;
            if (videoGifPreviewImage) videoGifPreviewImage.hidden = true;
            videoGifRangePreview.load();
          });
          if (token !== videoGifPreviewPlaybackToken || selectionKey !== videoGifSelectionKey()) return;
          videoGifPreviewPlaybackRange = selectionKey;
          videoGifRangePreview.currentTime = 0;
          videoGifPreviewTimestampMs = videoGifStartMs;
          if (videoGifTimeline) videoGifTimeline.value = String(videoGifStartMs);
          if (videoGifPreviewTime) videoGifPreviewTime.textContent = videoGifTimeLabel(videoGifStartMs);
          updateVideoGifTimelineVisual();
          await videoGifRangePreview.play();
        } catch (error) {
          if (token === videoGifPreviewPlaybackToken) {
            resetVideoGifSelectionPlayback();
            window.showToast?.(error?.message || '无法播放所选片段。');
          }
        } finally {
          if (token === videoGifPreviewPlaybackToken) {
            videoGifPreviewPlaybackLoading = false;
            updateVideoGifPreviewToggle();
          }
        }
      }

      function updateVideoGifSelection() {
        if (videoGifStartLabel) videoGifStartLabel.textContent = videoGifTimeLabel(videoGifStartMs);
        if (videoGifEndLabel) videoGifEndLabel.textContent = videoGifTimeLabel(videoGifEndMs);
        if (videoGifDurationLabel) videoGifDurationLabel.textContent = `${((videoGifEndMs - videoGifStartMs) / 1000).toFixed(3)} 秒 / 最多 30 秒`;
        videoGifSelectStart?.classList.toggle('active', videoGifActivePoint === 'start');
        videoGifSelectEnd?.classList.toggle('active', videoGifActivePoint === 'end');
        if (videoGifAdjustHint) videoGifAdjustHint.textContent = videoGifActivePoint === 'start' ? '正在调整起始帧' : '正在调整结束帧';
        updateVideoGifTimelineVisual();
        updateVideoGifEstimate();
        updateVideoGifPreviewToggle();
      }
      function seekVideoGif(milliseconds, immediate = false) {
        const value = Math.max(0, Math.min(Math.round(videoGifDuration * 1000), Math.round(milliseconds)));
        videoGifPreviewTimestampMs = value;
        if (videoGifTimeline) videoGifTimeline.value = String(value);
        if (videoGifPreviewTime) videoGifPreviewTime.textContent = videoGifTimeLabel(value);
        updateVideoGifTimelineVisual();
        if (videoGifFile?.path) {
          scheduleVideoPreview(videoGifPreviewState, videoGifPreviewImage, videoGifFile.path, value, immediate);
        }
      }
      function setVideoGifPoint(point, milliseconds, previewImmediately = false) {
        resetVideoGifSelectionPlayback();
        const max = Math.round(videoGifDuration * 1000);
        let value = Math.max(0, Math.min(max, Math.round(milliseconds)));
        if (point === 'start') {
          value = Math.min(value, videoGifEndMs - 1);
          value = Math.max(0, videoGifEndMs - 30_000, value);
          videoGifStartMs = value;
        } else {
          value = Math.max(value, videoGifStartMs + 1);
          value = Math.min(max, videoGifStartMs + 30_000, value);
          videoGifEndMs = value;
        }
        updateVideoGifSelection();
        seekVideoGif(value, previewImmediately);
      }
      function clearVideoGif() {
        resetVideoGifSelectionPlayback();
        videoGifFile = null; videoGifDuration = 0; videoGifStartMs = 0; videoGifEndMs = 30_000; videoGifStepMs = 33; videoGifPreviewTimestampMs = 0; videoGifSourceWidth = 0; videoGifSourceHeight = 0; videoGifSourceSize = 0;
        clearQueuedVideoPreview(videoGifPreviewState, videoGifPreviewImage);
        videoGifOverlay?.classList.remove('is-editing');
        if (videoGifEditor) videoGifEditor.hidden = true;
        if (videoGifEmpty) videoGifEmpty.hidden = false;
        updateVideoGifSelection();
      }
      function openVideoGifOverlay() { videoGifOverlay?.classList.add('visible'); if (videoGifPlasmaBg && !videoGifPlasmaDispose) videoGifPlasmaDispose = initPlasma(videoGifPlasmaBg, { color: '#6B6B6B', speed: 0.45, scale: 1, opacity: 1, mouseInteractive: false }); }
      function closeVideoGifOverlay() { videoGifOverlay?.classList.remove('visible'); clearVideoGif(); if (videoGifPlasmaDispose) { videoGifPlasmaDispose(); videoGifPlasmaDispose = null; } }
      async function loadVideoGifFile(selected) {
        if (!isTauri) { window.showToast?.('视频 GIF 导出仅可在桌面端使用。'); return; }
        if (typeof selected !== 'string' || !selected) return;
        try {
          const file = localVideoFile(selected);
          validateVideoGifInput(file);
          const { invoke } = await import('@tauri-apps/api/core');
          const probe = await invoke('probe_video', { inputPath: selected });
          const duration = Number(probe?.duration);
          if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取视频时长。');
          resetVideoGifSelectionPlayback();
          clearQueuedVideoPreview(videoGifPreviewState, videoGifPreviewImage);
          videoGifStepMs = 33;
          if (Number.isFinite(probe?.frame_rate) && probe.frame_rate > 0 && probe.frame_rate <= 240) videoGifStepMs = 1000 / probe.frame_rate;
          videoGifFile = file;
          videoGifDuration = duration;
          videoGifSourceWidth = Number(probe?.width) || 0;
          videoGifSourceHeight = Number(probe?.height) || 0;
          videoGifSourceSize = Number(probe?.file_size ?? probe?.fileSize ?? file.size) || 0;
          const defaultSelection = createDefaultVideoGifSelection(duration);
          videoGifStartMs = defaultSelection.start_ms;
          videoGifEndMs = defaultSelection.end_ms;
          if (videoGifEndMs <= videoGifStartMs) throw new Error('视频时长不足以生成 GIF。');
          videoGifName.textContent = file.name;
          videoGifTimeline.max = String(Math.floor(duration * 1000));
          videoGifActivePoint = 'start';
          updateVideoGifSelection();
          videoGifEmpty.hidden = true;
          videoGifEditor.hidden = false;
          videoGifOverlay?.classList.add('is-editing');
          seekVideoGif(0, true);
        } catch (error) { window.showToast?.(error?.message || '无法读取视频文件。'); }
      }
      async function chooseVideoGifFile() {
        if (!isTauri) { window.showToast?.('视频 GIF 导出仅可在桌面端使用。'); return; }
        try {
          const { open } = await import('@tauri-apps/plugin-dialog');
          const selected = await open({ multiple: false, filters: [{ name: 'Video', extensions: videoExts }] });
          if (typeof selected !== 'string') return;
          await loadVideoGifFile(selected);
        } catch (error) { window.showToast?.(error?.message || '无法读取视频文件。'); }
      }
      videoGifTimeline?.addEventListener('input', () => setVideoGifPoint(videoGifActivePoint, Number(videoGifTimeline.value)));
      videoGifSelectStart?.addEventListener('click', () => { resetVideoGifSelectionPlayback(); videoGifActivePoint = 'start'; updateVideoGifSelection(); seekVideoGif(videoGifStartMs, true); });
      videoGifSelectEnd?.addEventListener('click', () => { resetVideoGifSelectionPlayback(); videoGifActivePoint = 'end'; updateVideoGifSelection(); seekVideoGif(videoGifEndMs, true); });
      videoGifPrev?.addEventListener('click', () => setVideoGifPoint(videoGifActivePoint, (videoGifActivePoint === 'start' ? videoGifStartMs : videoGifEndMs) - videoGifStepMs, true));
      videoGifNext?.addEventListener('click', () => setVideoGifPoint(videoGifActivePoint, (videoGifActivePoint === 'start' ? videoGifStartMs : videoGifEndMs) + videoGifStepMs, true));
      videoGifPick?.addEventListener('click', chooseVideoGifFile); videoGifChange?.addEventListener('click', chooseVideoGifFile); videoGifBack?.addEventListener('click', closeVideoGifOverlay);
      videoGifPreviewToggle?.addEventListener('click', () => {
        if (videoGifPreviewPlaybackLoading) return;
        if (videoGifRangePreview && !videoGifRangePreview.paused && !videoGifRangePreview.ended) pauseVideoGifSelectionPlayback();
        else void playVideoGifSelectionPlayback();
      });
      videoGifRangePreview?.addEventListener('play', updateVideoGifPreviewToggle);
      videoGifRangePreview?.addEventListener('pause', updateVideoGifPreviewToggle);
      videoGifRangePreview?.addEventListener('timeupdate', () => {
        if (!videoGifPreviewPlaybackRange) return;
        const timestamp = Math.min(videoGifEndMs, videoGifStartMs + Math.round(videoGifRangePreview.currentTime * 1000));
        videoGifPreviewTimestampMs = timestamp;
        if (videoGifTimeline) videoGifTimeline.value = String(timestamp);
        if (videoGifPreviewTime) videoGifPreviewTime.textContent = videoGifTimeLabel(timestamp);
        updateVideoGifTimelineVisual();
      });
      videoGifRangePreview?.addEventListener('ended', () => {
        if (!videoGifPreviewPlaybackRange || videoGifPreviewPlaybackRange !== videoGifSelectionKey()) {
          updateVideoGifPreviewToggle();
          return;
        }
        videoGifRangePreview.currentTime = 0;
        videoGifPreviewTimestampMs = videoGifStartMs;
        if (videoGifTimeline) videoGifTimeline.value = String(videoGifStartMs);
        if (videoGifPreviewTime) videoGifPreviewTime.textContent = videoGifTimeLabel(videoGifStartMs);
        updateVideoGifTimelineVisual();
        videoGifRangePreview.play().catch(() => updateVideoGifPreviewToggle());
      });
      videoGifFrameRateOptions?.addEventListener('click', event => { const button = event.target.closest('[data-fps]'); if (!button) return; videoGifFrameRate = Number(button.dataset.fps); videoGifFrameRateOptions.querySelectorAll('[data-fps]').forEach(item => item.classList.toggle('active', item === button)); updateVideoGifEstimate(); });
      videoGifResolutionOptions?.addEventListener('click', event => { const button = event.target.closest('[data-width]'); if (!button) return; videoGifWidth = Number(button.dataset.width); videoGifResolutionOptions.querySelectorAll('[data-width]').forEach(item => item.classList.toggle('active', item === button)); updateVideoGifEstimate(); });
      videoGifQualityOptions?.addEventListener('click', event => { const button = event.target.closest('[data-quality]'); if (!button) return; videoGifQuality = String(button.dataset.quality || 'balanced'); videoGifQualityOptions.querySelectorAll('[data-quality]').forEach(item => item.classList.toggle('active', item === button)); updateVideoGifEstimate(); });
      function closeVideoGifSuccess() { videoGifSuccessOverlay?.classList.remove('visible'); }
      videoGifSuccessOk?.addEventListener('click', closeVideoGifSuccess);
      videoGifOpenFolder?.addEventListener('click', () => { if (lastVideoGifOutputPath) openOutputFolder(lastVideoGifOutputPath).catch(() => {}); closeVideoGifSuccess(); });
      videoGifCancelBtn?.addEventListener('click', () => import('@tauri-apps/api/core').then(({ invoke }) => invoke('cancel_convert')).catch(() => {}));
      videoGifExport?.addEventListener('click', async () => {
        if (!videoGifFile?.path || !isTauri || videoGifProcessing) return;
        let settings;
        try { settings = normalizeVideoGifRequest({ start_ms: videoGifStartMs, end_ms: videoGifEndMs, frame_rate: videoGifFrameRate, width: videoGifWidth, quality: videoGifQuality }, videoGifDuration); }
        catch (error) { window.showToast?.(error?.message || 'GIF 选区无效。'); return; }
        videoGifProcessing = true; videoGifProcessMask?.classList.add('visible');
        if (videoGifProcessBarFill) videoGifProcessBarFill.style.width = '8%';
        let unlisten;
        try {
          const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
          unlisten = await listen('video-gif-progress', event => { const progress = Math.max(0, Math.min(1, Number(event.payload?.progress) || 0)); if (videoGifProcessBarFill) videoGifProcessBarFill.style.width = `${Math.max(8, progress * 100)}%`; if (videoGifProcessText) videoGifProcessText.textContent = event.payload?.phase === 'publish' ? '正在发布 GIF...' : '正在生成调色板与 GIF...'; });
          const result = await invoke('extract_video_gif', { inputPath: videoGifFile.path, outputDir: await getOutputDir('Videos'), startMs: settings.start_ms, endMs: settings.end_ms, frameRate: settings.frame_rate, width: settings.width, quality: settings.quality });
          lastVideoGifOutputPath = result.output_path || result.outputPath || '';
          if (videoGifSuccessMeta) videoGifSuccessMeta.textContent = videoGifFile.name;
          if (videoGifSuccessDuration) videoGifSuccessDuration.textContent = `${(settings.duration_ms / 1000).toFixed(3)} 秒`;
          if (videoGifSuccessSpec) videoGifSuccessSpec.textContent = `${settings.width}px / ${settings.frame_rate} FPS / ${videoGifQualityLabels[settings.quality] || '均衡'}`;
          if (videoGifSuccessSize) videoGifSuccessSize.textContent = formatFileSize(Number(result.output_size ?? result.outputSize ?? 0));
          if (videoGifSuccessPath) videoGifSuccessPath.textContent = lastVideoGifOutputPath;
          if (videoGifProcessBarFill) videoGifProcessBarFill.style.width = '100%';
          setTimeout(() => { videoGifProcessMask?.classList.remove('visible'); if (videoGifProcessBarFill) videoGifProcessBarFill.style.width = '0%'; videoGifSuccessOverlay?.classList.add('visible'); }, 240);
        } catch (error) { videoGifProcessMask?.classList.remove('visible'); if (videoGifProcessBarFill) videoGifProcessBarFill.style.width = '0%'; window.showToast?.(error?.message || 'GIF 导出失败。'); }
        finally { if (unlisten) unlisten(); videoGifProcessing = false; }
      });
      document.querySelectorAll('.audio-list-item[data-tool="video-gif"]').forEach(item => {
        item.addEventListener('click', () => openToolWithFfmpegCheck(openVideoGifOverlay));
        item.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openToolWithFfmpegCheck(openVideoGifOverlay);
          }
        });
      });
      function showVideoGifDropZone() {
        videoGifDropZone?.classList.add('visible');
        videoGifOverlay?.classList.add('drag-over');
      }
      function hideVideoGifDropZone() {
        videoGifDropZone?.classList.remove('visible');
        videoGifOverlay?.classList.remove('drag-over');
      }
      if (videoGifOverlay && isTauri) {
        (async () => {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          await getCurrentWebview().onDragDropEvent(async event => {
            if (!videoGifOverlay.classList.contains('visible') || videoGifProcessing) return;
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') showVideoGifDropZone();
            else if (payload.type === 'leave') hideVideoGifDropZone();
            else if (payload.type === 'drop') {
              hideVideoGifDropZone();
              const selected = firstSupportedVideoPath(payload.paths || []);
              if (selected) await loadVideoGifFile(selected);
              else window.showToast?.('请拖入支持的视频文件。');
            }
          });
        })().catch(error => console.error('Cannot register video GIF drag and drop:', error));
      }

      // ===== BPM Detect Tool =====
      const bpmDetectOverlay = document.getElementById('bpmDetectOverlay');
      const bpmDetectBack = document.getElementById('bpmDetectBack');
      const bpmDetectCta = document.getElementById('bpmDetectCta');
      const bpmDetectHeroTop = document.getElementById('bpmDetectHeroTop');
      const bpmResult = document.getElementById('bpmResult');
      const bpmResultNumber = document.getElementById('bpmResultNumber');
      const bpmTimelineTrack = document.getElementById('bpmTimelineTrack');
      const bpmResultHint = document.getElementById('bpmResultHint');
      const bpmReanalyzeBtn = document.getElementById('bpmReanalyzeBtn');
      const bpmProcessMask = document.getElementById('bpmProcessMask');
      const bpmProcessBarFill = document.getElementById('bpmProcessBarFill');
      const bpmProcessText = document.getElementById('bpmProcessText');
      const bpmDropZone = document.getElementById('bpmDropZone');
      const bpmPlasmaBg = document.getElementById('bpmPlasmaBg');
      let bpmPlasmaInstance = null;
      let bpmAudioContext = null;
      let bpmAnalyzing = false;
      let bpmAnalysisRunId = 0;
      let bpmProgressInterval = null;
      let bpmResultTimer = null;
      let bpmReanalyzeTimer = null;
      let lastAnalyzedAudioBuffer = null;

      function clearBpmProgress() {
        if (bpmProgressInterval) {
          clearInterval(bpmProgressInterval);
          bpmProgressInterval = null;
        }
      }

      function isCurrentBpmRun(runId) {
        return runId === bpmAnalysisRunId && bpmDetectOverlay.classList.contains('visible');
      }

      function finishBpmRun(runId) {
        if (runId === bpmAnalysisRunId) bpmAnalyzing = false;
      }

      function invalidateBpmRun() {
        bpmAnalysisRunId += 1;
        bpmAnalyzing = false;
        clearBpmProgress();
        if (bpmResultTimer) {
          clearTimeout(bpmResultTimer);
          bpmResultTimer = null;
        }
        if (bpmReanalyzeTimer) {
          clearTimeout(bpmReanalyzeTimer);
          bpmReanalyzeTimer = null;
        }
      }

      function startBpmRun() {
        if (bpmAnalyzing) return null;
        bpmAnalyzing = true;
        lastAnalyzedAudioBuffer = null;
        return ++bpmAnalysisRunId;
      }

      function getBpmErrorMessage(error) {
        if (!(error instanceof BpmDetectError)) {
          return t('home.bpmDetect.analyzeError') + ': ' + (error?.message || error);
        }
        const messageKey = {
          invalid_input: 'invalidInput',
          input_too_large: 'inputTooLarge',
          invalid_audio: 'invalidAudio',
          audio_too_long: 'audioTooLong',
          unsupported_channels: 'unsupportedChannels',
          decoded_audio_too_large: 'decodedAudioTooLarge',
          audio_context_unavailable: 'audioContextUnavailable'
        }[error.code];
        return messageKey ? t(`home.bpmDetect.${messageKey}`) : error.message;
      }

      function showBpmError(error, runId = null) {
        if (runId !== null && !isCurrentBpmRun(runId)) return;
        console.error('BPM analysis error:', error);
        alert(getBpmErrorMessage(error));
        resetBpmResult();
      }

      function openBpmDetectOverlay() {
        if (bpmDetectOverlay.classList.contains('visible')) return;
        bpmDetectOverlay.classList.add('visible');
        // Reset to initial state
        bpmDetectHeroTop.style.display = '';
        bpmResult.classList.remove('visible');
        // Init plasma bg
        if (bpmPlasmaBg && !bpmPlasmaInstance) {
          bpmPlasmaInstance = initPlasma(bpmPlasmaBg, {
            color: '#6B6B6B',
            speed: 0.8,
            direction: 'forward',
            density: 3
          });
        }
      }

      function closeBpmDetectOverlay() {
        invalidateBpmRun();
        bpmDetectOverlay.classList.remove('visible');
        bpmResult.classList.remove('visible');
        // Stop BPM demo if playing
        if (bpmDemoState.isPlaying) closeBpmDemo();
        // Destroy plasma instance to free GPU/CPU
        if (bpmPlasmaInstance) {
          bpmPlasmaInstance();
          bpmPlasmaInstance = null;
        }
        bpmProcessMask.classList.remove('visible');
        bpmProcessBarFill.style.width = '0%';
        lastAnalyzedAudioBuffer = null;
        if (bpmAudioContext) {
          const context = bpmAudioContext;
          bpmAudioContext = null;
          context.close().catch(() => {});
        }
        // Reset hero display
        bpmDetectHeroTop.style.display = '';
      }

      if (bpmDetectBack) {
        bpmDetectBack.addEventListener('click', closeBpmDetectOverlay);
      }

      // Click on audio-list-item with data-tool="bpm-detect" to open
      document.querySelectorAll('.audio-list-item[data-tool="bpm-detect"]').forEach(item => {
        item.addEventListener('click', () => {
          openBpmDetectOverlay();
        });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openBpmDetectOverlay();
          }
        });
      });

      // Runs entirely in the renderer. A run ID prevents stale decode/analyzer work from changing a later UI state.
      function getBpmAudioContext() {
        if (bpmAudioContext) return bpmAudioContext;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
          throw new BpmDetectError('audio_context_unavailable', 'This browser does not support local audio analysis.');
        }
        bpmAudioContext = new AudioContextClass();
        return bpmAudioContext;
      }

      // The upstream analyzer makes an additional OfflineAudioContext copy. Keep that copy bounded and mono.
      function createBpmAnalysisBuffer(audioBuffer) {
        const { sampleRate, frameCount } = getBpmAnalysisSpec(audioBuffer);
        const analysisBuffer = getBpmAudioContext().createBuffer(1, frameCount, sampleRate);
        const output = analysisBuffer.getChannelData(0);
        const sourceChannels = Array.from(
          { length: audioBuffer.numberOfChannels },
          (_, index) => audioBuffer.getChannelData(index)
        );
        const sourceStep = audioBuffer.sampleRate / sampleRate;
        for (let frame = 0; frame < frameCount; frame++) {
          const sourceFrame = Math.min(Math.floor(frame * sourceStep), audioBuffer.length - 1);
          let sample = 0;
          for (const channel of sourceChannels) sample += channel[sourceFrame];
          output[frame] = sample / sourceChannels.length;
        }
        return analysisBuffer;
      }

      async function analyzeBpmAudioBuffer(arrayBuffer, runId) {
        if (!isCurrentBpmRun(runId)) return;
        let resultDeliveryScheduled = false;

        bpmDetectHeroTop.style.display = 'none';
        bpmProcessMask.classList.add('visible');
        bpmProcessBarFill.style.width = '0%';

        let progress = 0;
        clearBpmProgress();
        bpmProgressInterval = setInterval(() => {
          if (!isCurrentBpmRun(runId)) {
            clearBpmProgress();
            return;
          }
          if (progress < 90) {
            progress += Math.random() * 8 + 2;
            bpmProcessBarFill.style.width = Math.min(progress, 90) + '%';
          }
        }, 200);

        try {
          assertBpmInputSize(arrayBuffer?.byteLength);
          const audioContext = getBpmAudioContext();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          if (!isCurrentBpmRun(runId)) return;
          assertBpmAudioBuffer(audioBuffer);

          const { analyzeFullBuffer } = await import('realtime-bpm-analyzer');
          const analysisBuffer = createBpmAnalysisBuffer(audioBuffer);
          const tempos = await analyzeFullBuffer(analysisBuffer);
          if (!isCurrentBpmRun(runId)) return;

          clearBpmProgress();
          bpmProcessBarFill.style.width = '100%';
          resultDeliveryScheduled = true;
          bpmResultTimer = setTimeout(() => {
            bpmResultTimer = null;
            if (!isCurrentBpmRun(runId)) return;
            try {
              bpmProcessMask.classList.remove('visible');
              showBpmResult(tempos?.length ? tempos : null, audioBuffer);
            } catch (error) {
              showBpmError(error, runId);
            } finally {
              finishBpmRun(runId);
            }
          }, 300);
        } catch (err) {
          clearBpmProgress();
          if (!isCurrentBpmRun(runId)) return;
          bpmProcessMask.classList.remove('visible');
          showBpmError(err, runId);
        } finally {
          if (!resultDeliveryScheduled) finishBpmRun(runId);
        }
      }

      async function analyzeBpmFromFile(filePath) {
        const runId = startBpmRun();
        if (!runId) return;
        let analysisStarted = false;
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const byteLength = Number(await invoke('get_file_size', { path: filePath }));
          assertBpmInputSize(byteLength);
          if (!isCurrentBpmRun(runId)) return;
          const bytes = await invoke('read_file_bytes_limited', {
            path: filePath,
            maxBytes: 50 * 1024 * 1024
          });
          if (!isCurrentBpmRun(runId)) return;
          const arrayBuffer = new Uint8Array(bytes).buffer;
          analysisStarted = true;
          await analyzeBpmAudioBuffer(arrayBuffer, runId);
        } catch (err) {
          showBpmError(err, runId);
        } finally {
          if (!analysisStarted) finishBpmRun(runId);
        }
      }

      async function analyzeBpmBrowserFile(file) {
        try {
          assertBpmInputSize(file?.size);
        } catch (error) {
          showBpmError(error);
          return;
        }

        const runId = startBpmRun();
        if (!runId) return;
        let analysisStarted = false;
        try {
          const arrayBuffer = await file.arrayBuffer();
          if (!isCurrentBpmRun(runId)) return;
          analysisStarted = true;
          await analyzeBpmAudioBuffer(arrayBuffer, runId);
        } catch (error) {
          showBpmError(error, runId);
        } finally {
          if (!analysisStarted) finishBpmRun(runId);
        }
      }

      function showBpmResult(tempos, audioBuffer) {
        lastAnalyzedAudioBuffer = audioBuffer;
        const candidates = normalizeBpmCandidates(tempos);
        if (candidates.length === 0) {
          bpmResult.classList.add('visible');
          bpmResultNumber.textContent = '?';
          bpmTimelineTrack.innerHTML = '';
          bpmResultHint.textContent = t('home.bpmDetect.noBeatDetected');
          bpmResultHint.classList.add('visible');
          return;
        }

        const topTempo = candidates[0];
        const bpm = Math.round(topTempo.tempo);

        // Show result card
        bpmResult.classList.add('visible');
        bpmResultNumber.textContent = bpm;

        // Generate timeline bars from actual audio data
        bpmTimelineTrack.innerHTML = '';
        const barCount = 64;
        const channelData = audioBuffer.getChannelData(0);
        const samplesPerBar = Math.floor(channelData.length / barCount);
        const expectedBeatCount = Math.max(1, Math.round(audioBuffer.duration * bpm / 60));
        const barsPerBeat = Math.max(1, Math.round(barCount / expectedBeatCount));

        for (let i = 0; i < barCount; i++) {
          const start = i * samplesPerBar;
          const end = Math.min(start + samplesPerBar, channelData.length);
          let peak = 0;
          const sampleStep = Math.max(1, Math.ceil((end - start) / 2048));
          for (let j = start; j < end; j += sampleStep) {
            const abs = Math.abs(channelData[j]);
            if (abs > peak) peak = abs;
          }
          const bar = document.createElement('div');
          bar.className = 'bpm-timeline-bar';
          const height = Math.max(3, peak * 24);
          bar.style.height = height + 'px';
          if (i % barsPerBeat === 0) {
            bar.classList.add('beat');
          }
          bpmTimelineTrack.appendChild(bar);
        }

        // Half/double time hints
        bpmResultHint.classList.remove('visible');
        if (bpm < 70) {
          bpmResultHint.textContent = t('home.bpmDetect.doubleTimeHint', { bpm: bpm * 2 });
          bpmResultHint.classList.add('visible');
        } else if (bpm > 160) {
          bpmResultHint.textContent = t('home.bpmDetect.halfTimeHint', { bpm: Math.round(bpm / 2) });
          bpmResultHint.classList.add('visible');
        }
      }

      function resetBpmResult() {
        bpmResult.classList.remove('visible');
        bpmDetectHeroTop.style.display = '';
        bpmTimelineTrack.innerHTML = '';
        bpmResultHint.classList.remove('visible');
      }

      async function selectBpmAudioFile() {
        if (bpmAnalyzing) return;
        if (isTauri) {
          try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({
              multiple: false,
              filters: [{
                name: 'Audio Files',
                extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a']
              }]
            });
            if (selected && typeof selected === 'string') {
              analyzeBpmFromFile(selected);
            }
          } catch (e) {
            console.error('BPM file selection error', e);
          }
        } else {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'audio/*';
          input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file) return;
            if (isTauri && file.path) await analyzeBpmFromFile(file.path);
            else await analyzeBpmBrowserFile(file);
          });
          input.click();
        }
      }

      if (bpmDetectCta) {
        bpmDetectCta.addEventListener('click', () => {
          selectBpmAudioFile();
        });
      }

      if (bpmReanalyzeBtn) {
        bpmReanalyzeBtn.addEventListener('click', () => {
          if (bpmAnalyzing) return;
          resetBpmResult();
          bpmReanalyzeTimer = setTimeout(() => {
            bpmReanalyzeTimer = null;
            if (bpmDetectOverlay.classList.contains('visible')) selectBpmAudioFile();
          }, 300);
        });
      }

      // Tauri native drag-drop for BPM overlay
      if (isTauri && bpmDetectOverlay) {
        (async () => {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          const webview = getCurrentWebview();
          await webview.onDragDropEvent((event) => {
            if (!bpmDetectOverlay.classList.contains('visible') || bpmAnalyzing) return;
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') {
              bpmDetectOverlay.classList.add('drag-over');
              bpmDropZone.classList.add('visible');
            } else if (payload.type === 'leave') {
              bpmDetectOverlay.classList.remove('drag-over');
              bpmDropZone.classList.remove('visible');
            } else if (payload.type === 'drop') {
              bpmDetectOverlay.classList.remove('drag-over');
              bpmDropZone.classList.remove('visible');
              const paths = payload.paths || [];
              if (paths.length === 0) return;
              const audioPath = paths.find(isBpmSupportedAudioName);
              if (audioPath) {
                analyzeBpmFromFile(audioPath);
              }
            }
          });
        })();
      }

      // HTML5 drag-drop fallback (non-Tauri)
      if (bpmDetectOverlay && !isTauri) {
        bpmDetectOverlay.addEventListener('dragover', (e) => {
          e.preventDefault();
          bpmDetectOverlay.classList.add('drag-over');
          bpmDropZone.classList.add('visible');
        });
        bpmDetectOverlay.addEventListener('dragleave', (e) => {
          if (e.relatedTarget && bpmDetectOverlay.contains(e.relatedTarget)) return;
          bpmDetectOverlay.classList.remove('drag-over');
          bpmDropZone.classList.remove('visible');
        });
        bpmDetectOverlay.addEventListener('drop', (e) => {
          e.preventDefault();
          bpmDetectOverlay.classList.remove('drag-over');
          bpmDropZone.classList.remove('visible');
          const file = e.dataTransfer.files[0];
          if (file && (file.type.startsWith('audio/') || isBpmSupportedAudioName(file.name))) {
            (async () => {
              if (isTauri && file.path) await analyzeBpmFromFile(file.path);
              else await analyzeBpmBrowserFile(file);
            })();
          }
        });
      }

      // ===== BPM Beat Demo =====
      const bpmDemoOverlay = document.getElementById('bpmDemoOverlay');
      const bpmDemoClose = document.getElementById('bpmDemoClose');
      const bpmDemoBpmNumber = document.getElementById('bpmDemoBpmNumber');
      const bpmDemoBeatIndicator = document.getElementById('bpmDemoBeatIndicator');
      const bpmDemoPlayBtn = document.getElementById('bpmDemoPlayBtn');
      const bpmDemoStopBtn = document.getElementById('bpmDemoStopBtn');
      const bpmDemoAudioVolume = document.getElementById('bpmDemoAudioVolume');
      const bpmDemoBeatVolume = document.getElementById('bpmDemoBeatVolume');
      const bpmDemoBeatBtn = document.getElementById('bpmDemoBeatBtn');

      let bpmDemoState = {
        bpm: 128,
        audioBuffer: null,
        isPlaying: false,
        audioContext: null,
        audioSource: null,
        audioGainNode: null,
        beatGainNode: null,
        beatIntervalId: null,
        beatTimeoutId: null,
        audioStartTime: 0
      };

      function openBpmDemo(bpm, audioBuffer) {
        bpmDemoState.bpm = bpm;
        bpmDemoState.audioBuffer = audioBuffer;
        bpmDemoBpmNumber.textContent = bpm;
        bpmDemoOverlay.classList.add('visible');
      }

      function closeBpmDemo() {
        stopBpmDemo();
        bpmDemoOverlay.classList.remove('visible');
      }

      if (bpmDemoClose) {
        bpmDemoClose.addEventListener('click', closeBpmDemo);
      }

      function startBpmDemo() {
        if (bpmDemoState.isPlaying) return;
        bpmDemoState.isPlaying = true;
        bpmDemoPlayBtn.style.display = 'none';
        bpmDemoStopBtn.style.display = 'inline-flex';

        // Create or resume AudioContext
        if (!bpmDemoState.audioContext) {
          bpmDemoState.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (bpmDemoState.audioContext.state === 'suspended') {
          bpmDemoState.audioContext.resume();
        }
        const ctx = bpmDemoState.audioContext;
        const now = ctx.currentTime;

        // Audio gain node (low volume)
        bpmDemoState.audioGainNode = ctx.createGain();
        const audioVol = parseInt(bpmDemoAudioVolume.value) / 100;
        bpmDemoState.audioGainNode.gain.setValueAtTime(audioVol, now);
        bpmDemoState.audioGainNode.connect(ctx.destination);

        // Beat gain node (high volume)
        bpmDemoState.beatGainNode = ctx.createGain();
        const beatVol = parseInt(bpmDemoBeatVolume.value) / 100;
        bpmDemoState.beatGainNode.gain.setValueAtTime(beatVol, now);
        bpmDemoState.beatGainNode.connect(ctx.destination);

        // Play audio
        if (bpmDemoState.audioBuffer) {
          bpmDemoState.audioSource = ctx.createBufferSource();
          bpmDemoState.audioSource.buffer = bpmDemoState.audioBuffer;
          bpmDemoState.audioSource.loop = true;
          bpmDemoState.audioSource.connect(bpmDemoState.audioGainNode);
          bpmDemoState.audioSource.start(0);
          bpmDemoState.audioStartTime = ctx.currentTime;
        }

        // Start metronome
        const beatIntervalMs = 60000 / bpmDemoState.bpm;
        let beatCount = 0;

        function scheduleBeat() {
          if (!bpmDemoState.isPlaying) return;

          // Play click sound using oscillator
          const beatTime = bpmDemoState.audioContext.currentTime;
          const osc = bpmDemoState.audioContext.createOscillator();
          const env = bpmDemoState.audioContext.createGain();
          osc.frequency.setValueAtTime(beatCount % 4 === 0 ? 1200 : 800, beatTime);
          env.gain.setValueAtTime(0, beatTime);
          env.gain.linearRampToValueAtTime(1, beatTime + 0.001);
          env.gain.exponentialRampToValueAtTime(0.001, beatTime + 0.05);
          osc.connect(env);
          env.connect(bpmDemoState.beatGainNode);
          osc.start(beatTime);
          osc.stop(beatTime + 0.05);

          // Visual indicator
          bpmDemoBeatIndicator.classList.add('beat-active');
          setTimeout(() => {
            bpmDemoBeatIndicator.classList.remove('beat-active');
          }, 80);

          beatCount++;
          bpmDemoState.beatTimeoutId = setTimeout(scheduleBeat, beatIntervalMs);
        }

        scheduleBeat();
      }

      function stopBpmDemo() {
        if (!bpmDemoState.isPlaying) return;
        bpmDemoState.isPlaying = false;
        bpmDemoPlayBtn.style.display = 'inline-flex';
        bpmDemoStopBtn.style.display = 'none';

        if (bpmDemoState.beatTimeoutId) {
          clearTimeout(bpmDemoState.beatTimeoutId);
          bpmDemoState.beatTimeoutId = null;
        }

        if (bpmDemoState.audioSource) {
          try { bpmDemoState.audioSource.stop(); } catch(e) {}
          bpmDemoState.audioSource = null;
        }

        bpmDemoBeatIndicator.classList.remove('beat-active');
      }

      if (bpmDemoPlayBtn) {
        bpmDemoPlayBtn.addEventListener('click', startBpmDemo);
      }

      if (bpmDemoStopBtn) {
        bpmDemoStopBtn.addEventListener('click', stopBpmDemo);
      }

      if (bpmDemoAudioVolume) {
        bpmDemoAudioVolume.addEventListener('input', () => {
          if (bpmDemoState.audioGainNode && bpmDemoState.audioContext) {
            const vol = parseInt(bpmDemoAudioVolume.value) / 100;
            bpmDemoState.audioGainNode.gain.setValueAtTime(vol, bpmDemoState.audioContext.currentTime);
          }
        });
      }

      if (bpmDemoBeatVolume) {
        bpmDemoBeatVolume.addEventListener('input', () => {
          if (bpmDemoState.beatGainNode && bpmDemoState.audioContext) {
            const vol = parseInt(bpmDemoBeatVolume.value) / 100;
            bpmDemoState.beatGainNode.gain.setValueAtTime(vol, bpmDemoState.audioContext.currentTime);
          }
        });
      }

      if (bpmDemoBeatBtn) {
        bpmDemoBeatBtn.addEventListener('click', () => {
          if (lastAnalyzedAudioBuffer) {
            openBpmDemo(parseInt(bpmResultNumber.textContent), lastAnalyzedAudioBuffer);
          }
        });
      }

      // ===== Audio Clip Editor =====
      const audioClipOverlay = document.getElementById('audioClipOverlay');
      const audioClipBack = document.getElementById('audioClipBack');
      const audioClipCta = document.getElementById('audioClipCta');
      const audioClipHeroTop = document.getElementById('audioClipHeroTop');
      const audioClipBody = document.getElementById('audioClipBody');
      const audioClipDropZone = document.getElementById('audioClipDropZone');
      const audioClipPlasmaBg = document.getElementById('audioClipPlasmaBg');
      const audioClipFileInfo = document.getElementById('audioClipFileInfo');
      const audioClipFileName = document.getElementById('audioClipFileName');
      const audioClipFileDuration = document.getElementById('audioClipFileDuration');
      const audioClipFileRemove = document.getElementById('audioClipFileRemove');
      const audioClipWaveformWrap = document.getElementById('audioClipWaveformWrap');
      const audioClipCanvas = document.getElementById('audioClipCanvas');
      const audioClipSelection = document.getElementById('audioClipSelection');
      const audioClipPlayhead = document.getElementById('audioClipPlayhead');
      const audioClipTimeStart = document.getElementById('audioClipTimeStart');
      const audioClipTimeEnd = document.getElementById('audioClipTimeEnd');
      const audioClipSelectionInfo = document.getElementById('audioClipSelectionInfo');
      const audioClipSelStart = document.getElementById('audioClipSelStart');
      const audioClipSelEnd = document.getElementById('audioClipSelEnd');
      const audioClipSelDuration = document.getElementById('audioClipSelDuration');
      const audioClipControls = document.getElementById('audioClipControls');
      const audioClipPlayBtn = document.getElementById('audioClipPlayBtn');
      const audioClipMinusBtn = document.getElementById('audioClipMinusBtn');
      const audioClipPlusBtn = document.getElementById('audioClipPlusBtn');
      const audioClipResetBtn = document.getElementById('audioClipResetBtn');
      const audioClipCurrentTime = document.getElementById('audioClipCurrentTime');
      const audioClipTotalTime = document.getElementById('audioClipTotalTime');
      const audioClipExportBtn = document.getElementById('audioClipExportBtn');
      const audioClipHandleStart = document.getElementById('audioClipHandleStart');
      const audioClipHandleEnd = document.getElementById('audioClipHandleEnd');
      const audioClipHandleStartLabel = document.getElementById('audioClipHandleStartLabel');
      const audioClipHandleEndLabel = document.getElementById('audioClipHandleEndLabel');
      const audioClipSuccessOverlay = document.getElementById('audioClipSuccessOverlay');
      const audioClipSuccessPath = document.getElementById('audioClipSuccessPath');
      const audioClipSuccessMeta = document.getElementById('audioClipSuccessMeta');
      const audioClipSuccessFile = document.getElementById('audioClipSuccessFile');
      const audioClipSuccessDuration = document.getElementById('audioClipSuccessDuration');
      const audioClipSuccessOpenFolder = document.getElementById('audioClipSuccessOpenFolder');
      const audioClipSuccessOk = document.getElementById('audioClipSuccessOk');
      const audioClipProcessMask = document.getElementById('audioClipProcessMask');
      const audioClipProcessBarFill = document.getElementById('audioClipProcessBarFill');
      const audioClipProcessText = document.getElementById('audioClipProcessText');
      let audioClipPlasmaInstance = null;
      let clipLoadId = 0;
      let clipExportRunId = 0;

      let clipState = {
        audioBuffer: null,
        audioContext: null,
        audioSource: null,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        filePath: null,
        fileName: '',
        selStart: 0,
        selEnd: 0,
        hasSelection: false,
        rafId: null,
        isLoading: false,
        isExporting: false,
        outputPath: '',
        activeHandle: null,
      };

      function isCurrentClipLoad(loadId) {
        return loadId === clipLoadId && audioClipOverlay.classList.contains('visible');
      }

      function isCurrentClipExport(runId) {
        return runId === clipExportRunId && audioClipOverlay.classList.contains('visible');
      }

      function getAudioClipErrorMessage(error) {
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
        const code = typeof error === 'string' ? error : error?.message || '';
        if (code.includes('cancelled')) return t('home.audioClip.cancelled');
        return t('home.audioClip.exportError');
      }

      function invalidateClipExport() {
        const wasExporting = clipState.isExporting;
        clipExportRunId += 1;
        clipState.isExporting = false;
        if (audioClipExportBtn) {
          audioClipExportBtn.disabled = false;
          audioClipExportBtn.style.opacity = '';
        }
        if (audioClipProcessMask) audioClipProcessMask.classList.remove('visible');
        if (audioClipProcessBarFill) audioClipProcessBarFill.style.width = '0%';
        if (wasExporting && isTauri) {
          import('@tauri-apps/api/core')
            .then(({ invoke }) => invoke('cancel_convert'))
            .catch(() => {});
        }
      }

      function formatTime(sec) {
        if (!sec || isNaN(sec)) return '0:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
      }

      function openAudioClipOverlay() {
        audioClipOverlay.classList.add('visible');
        audioClipHeroTop.style.display = '';
        if (audioClipPlasmaBg && !audioClipPlasmaInstance) {
          audioClipPlasmaInstance = initPlasma(audioClipPlasmaBg, {
            color: '#6B6B6B',
            speed: 0.8,
            direction: 'forward',
          });
        }
      }

      function closeAudioClipOverlay() {
        audioClipOverlay.classList.remove('visible');
        stopClipPlayback();
        resetClipState();
        if (clipState.audioContext) {
          const context = clipState.audioContext;
          clipState.audioContext = null;
          context.close().catch(() => {});
        }
        // Destroy plasma instance to free GPU/CPU
        if (audioClipPlasmaInstance) {
          audioClipPlasmaInstance();
          audioClipPlasmaInstance = null;
        }
      }

      function resetClipState() {
        clipLoadId += 1;
        invalidateClipExport();
        clipState.isLoading = false;
        stopClipPlayback();
        clipState.audioBuffer = null;
        clipState.currentTime = 0;
        clipState.duration = 0;
        clipState.filePath = null;
        clipState.fileName = '';
        clipState.outputPath = '';
        clipState.selStart = 0;
        clipState.selEnd = 0;
        clipState.hasSelection = false;
        audioClipFileInfo.classList.remove('visible');
        audioClipWaveformWrap.classList.remove('visible');
        audioClipControls.classList.remove('visible');
        audioClipSelectionInfo.classList.remove('visible');
        audioClipExportBtn.classList.remove('visible');
        audioClipSelection.style.display = 'none';
        audioClipPlayhead.style.display = 'none';
        audioClipHandleStart.style.display = 'none';
        audioClipHandleEnd.style.display = 'none';
        audioClipHandleStart.classList.remove('active');
        audioClipHandleEnd.classList.remove('active');
        audioClipHeroTop.style.display = '';
        audioClipSuccessOverlay.classList.remove('visible');
        setActiveHandle(null);
      }

      if (audioClipBack) {
        audioClipBack.addEventListener('click', closeAudioClipOverlay);
      }

      document.querySelectorAll('.audio-list-item[data-tool="audio-clip"]').forEach(item => {
        item.addEventListener('click', () => { openToolWithFfmpegCheck(openAudioClipOverlay); });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openToolWithFfmpegCheck(openAudioClipOverlay);
          }
        });
      });

      async function selectClipAudioFile() {
        if (isTauri) {
          try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({
              multiple: false,
              filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'] }],
            });
            if (selected) {
              loadClipAudioFile(selected);
            }
          } catch (e) {
            console.error('File select error:', e);
          }
        } else {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'audio/*';
          input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
              loadClipAudioFile(file);
            }
          };
          input.click();
        }
      }

      if (audioClipCta) {
        audioClipCta.addEventListener('click', selectClipAudioFile);
      }

      if (audioClipFileRemove) {
        audioClipFileRemove.addEventListener('click', resetClipState);
      }

      async function loadClipAudioFile(filePathOrFile) {
        if (clipState.isLoading || clipState.isExporting) return;
        const loadId = ++clipLoadId;
        clipState.isLoading = true;
        stopClipPlayback();

        // Show loading mask
        audioClipProcessBarFill.style.width = '30%';
        audioClipProcessText.textContent = t('home.audioClip.loading');
        audioClipProcessMask.classList.add('visible');
        let arrayBuffer;
        let fileName;
        let sourcePath = null;

        try {
          if (typeof filePathOrFile === 'string') {
            sourcePath = filePathOrFile;
            fileName = filePathOrFile.split(/[/\\]/).pop() || filePathOrFile;
            audioClipProcessBarFill.style.width = '50%';
            if (!isTauri) throw new AudioClipError('invalid_input', 'Desktop file paths are unavailable in a browser.');
            const { invoke } = await import('@tauri-apps/api/core');
            const size = Number(await invoke('get_file_size', { path: filePathOrFile }));
            assertAudioClipInput({ name: fileName, size });
            if (!isCurrentClipLoad(loadId)) return;
            const bytes = await invoke('read_file_bytes_limited', {
              path: filePathOrFile,
              maxBytes: 100 * 1024 * 1024
            });
            if (!isCurrentClipLoad(loadId)) return;
            arrayBuffer = new Uint8Array(bytes).buffer;
          } else {
            fileName = filePathOrFile?.name || '';
            assertAudioClipInput(filePathOrFile);
            if (isTauri && filePathOrFile.path) {
              const { invoke } = await import('@tauri-apps/api/core');
              sourcePath = filePathOrFile.path;
              const size = Number(await invoke('get_file_size', { path: sourcePath }));
              assertAudioClipInput({ name: fileName, size });
              if (!isCurrentClipLoad(loadId)) return;
              const bytes = await invoke('read_file_bytes_limited', {
                path: sourcePath,
                maxBytes: 100 * 1024 * 1024
              });
              if (!isCurrentClipLoad(loadId)) return;
              arrayBuffer = new Uint8Array(bytes).buffer;
            } else {
              arrayBuffer = await filePathOrFile.arrayBuffer();
            }
          }
          if (!isCurrentClipLoad(loadId)) return;
          audioClipProcessBarFill.style.width = '70%';
          if (!clipState.audioContext) {
            clipState.audioContext = new (window.AudioContext || window.webkitAudioContext)();
          }
          if (clipState.audioContext.state === 'suspended') {
            clipState.audioContext.resume();
          }
          const audioBuffer = await clipState.audioContext.decodeAudioData(arrayBuffer);
          if (!isCurrentClipLoad(loadId)) return;
          assertAudioClipBuffer(audioBuffer);
          audioClipProcessBarFill.style.width = '90%';
          const duration = audioBuffer.duration;
          clipState.audioBuffer = audioBuffer;
          clipState.filePath = sourcePath;
          clipState.fileName = fileName;
          clipState.duration = duration;
          clipState.currentTime = 0;
          clipState.selStart = 0;
          clipState.selEnd = duration;
          clipState.hasSelection = true;
          setActiveHandle('start');

          // Update UI
          audioClipHeroTop.style.display = 'none';
          audioClipFileInfo.classList.add('visible');
          audioClipFileDuration.textContent = formatTime(duration);
          audioClipWaveformWrap.classList.add('visible');
          audioClipControls.classList.add('visible');
          audioClipSelectionInfo.classList.add('visible');
          audioClipExportBtn.classList.add('visible');

          audioClipTimeStart.textContent = '0:00';
          audioClipTimeEnd.textContent = formatTime(duration);
          audioClipTotalTime.textContent = formatTime(duration);
          audioClipCurrentTime.textContent = '0:00';
          audioClipSelStart.textContent = '0:00';
          audioClipSelEnd.textContent = formatTime(duration);
          audioClipSelDuration.textContent = formatTime(duration);

          audioClipProcessBarFill.style.width = '100%';

          // Draw waveform (deferred to ensure canvas has dimensions after CSS transition)
          requestAnimationFrame(() => {
            drawWaveform();
            updateSelectionOverlay();
            updatePlayhead();
          });

          if (window.lucide) window.lucide.createIcons();
        } catch (error) {
          console.error('Audio clip load error:', error);
          if (isCurrentClipLoad(loadId)) alert(getAudioClipErrorMessage(error));
        } finally {
          if (isCurrentClipLoad(loadId)) {
            audioClipProcessMask.classList.remove('visible');
            audioClipProcessBarFill.style.width = '0%';
            clipState.isLoading = false;
          }
        }
      }

      function drawWaveform() {
        if (!clipState.audioBuffer || !audioClipCanvas) return;
        const canvas = audioClipCanvas;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const width = rect.width;
        const height = rect.height;
        const buffer = clipState.audioBuffer;
        const channelData = buffer.getChannelData(0);
        const samplesPerPixel = Math.max(1, Math.floor(channelData.length / width));

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = 'rgba(74, 222, 128, 0.5)';
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.8)';
        ctx.lineWidth = 1;

        const midY = height / 2;

        for (let x = 0; x < width; x++) {
          let min = 1.0;
          let max = -1.0;
          const start = x * samplesPerPixel;
          const end = Math.min(start + samplesPerPixel, channelData.length);
          const sampleStep = Math.max(1, Math.ceil((end - start) / 2048));
          for (let i = start; i < end; i += sampleStep) {
            const v = channelData[i];
            if (v < min) min = v;
            if (v > max) max = v;
          }
          const yMin = midY + min * midY * 0.9;
          const yMax = midY + max * midY * 0.9;
          ctx.fillRect(x, yMin, 1, Math.max(1, yMax - yMin));
        }
      }

      const CLIP_PAD = 16;

      function timeToX(time) {
        if (!clipState.duration) return CLIP_PAD;
        const rect = audioClipCanvas.getBoundingClientRect();
        const trackWidth = Math.max(1, rect.width - CLIP_PAD * 2);
        return CLIP_PAD + (time / clipState.duration) * trackWidth;
      }

      function xToTime(x) {
        const rect = audioClipCanvas.getBoundingClientRect();
        const trackWidth = Math.max(1, rect.width - CLIP_PAD * 2);
        const adjustedX = x - CLIP_PAD;
        const ratio = Math.max(0, Math.min(1, adjustedX / trackWidth));
        return ratio * clipState.duration;
      }

      function setActiveHandle(handle) {
        clipState.activeHandle = handle;
        audioClipHandleStart.classList.toggle('active', handle === 'start');
        audioClipHandleEnd.classList.toggle('active', handle === 'end');
        if (handle) {
          audioClipMinusBtn.disabled = false;
          audioClipPlusBtn.disabled = false;
        } else {
          audioClipMinusBtn.disabled = true;
          audioClipPlusBtn.disabled = true;
        }
      }

      function updateSelectionOverlay() {
        if (!clipState.hasSelection) {
          audioClipSelection.style.display = 'none';
          audioClipHandleStart.style.display = 'none';
          audioClipHandleEnd.style.display = 'none';
          setActiveHandle(null);
          return;
        }
        const startX = timeToX(clipState.selStart);
        const endX = timeToX(clipState.selEnd);
        audioClipSelection.style.display = 'block';
        audioClipSelection.style.left = `${startX}px`;
        audioClipSelection.style.width = `${endX - startX}px`;

        audioClipHandleStart.style.display = 'flex';
        audioClipHandleStart.style.left = `${startX}px`;
        audioClipHandleStartLabel.textContent = formatTime(clipState.selStart);

        audioClipHandleEnd.style.display = 'flex';
        audioClipHandleEnd.style.left = `${endX}px`;
        audioClipHandleEndLabel.textContent = formatTime(clipState.selEnd);

        audioClipSelStart.textContent = formatTime(clipState.selStart);
        audioClipSelEnd.textContent = formatTime(clipState.selEnd);
        audioClipSelDuration.textContent = formatTime(clipState.selEnd - clipState.selStart);
      }

      function updatePlayhead() {
        if (!clipState.duration) {
          audioClipPlayhead.style.display = 'none';
          return;
        }
        const x = timeToX(clipState.currentTime);
        audioClipPlayhead.style.display = 'block';
        audioClipPlayhead.style.left = `${x}px`;
        audioClipCurrentTime.textContent = formatTime(clipState.currentTime);
      }

      function startClipPlayback() {
        if (!clipState.audioBuffer || clipState.isPlaying) return;
        clipState.isPlaying = true;
        const ctx = clipState.audioContext;
        if (ctx.state === 'suspended') ctx.resume();

        const selStart = clipState.hasSelection ? clipState.selStart : 0;
        const selEnd = clipState.hasSelection ? clipState.selEnd : clipState.duration;

        function playSegment(fromTime) {
          // Cancel any existing animation frame before starting a new segment
          if (clipState.rafId) {
            cancelAnimationFrame(clipState.rafId);
            clipState.rafId = null;
          }
          const source = ctx.createBufferSource();
          source.buffer = clipState.audioBuffer;
          source.connect(ctx.destination);
          source.start(0, fromTime);
          clipState.audioSource = source;
          const startTime = ctx.currentTime - fromTime;

          source.onended = () => {
            // Only handle natural end (buffer exhausted), not manual stop
            if (clipState.isPlaying && clipState.audioSource === source) {
              clipState.audioSource = null;
              // Loop back to selStart
              if (clipState.isPlaying) {
                clipState.currentTime = selStart;
                playSegment(selStart);
              }
            }
          };

          function tick() {
            if (!clipState.isPlaying) return;
            clipState.currentTime = ctx.currentTime - startTime;
            if (clipState.currentTime >= selEnd) {
              // Reached end of selection — loop back to start
              try { source.stop(); } catch(e) {}
              clipState.audioSource = null;
              clipState.currentTime = selStart;
              playSegment(selStart);
              return;
            }
            updatePlayhead();
            clipState.rafId = requestAnimationFrame(tick);
          }
          clipState.rafId = requestAnimationFrame(tick);
        }

        // Start from current position if within selection, otherwise from selStart
        const startOffset = (clipState.currentTime >= selStart && clipState.currentTime < selEnd) ? clipState.currentTime : selStart;
        clipState.currentTime = startOffset;
        playSegment(startOffset);

        audioClipPlayBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
      }

      function stopClipPlayback() {
        if (clipState.audioSource) {
          try { clipState.audioSource.stop(); } catch(e) {}
          clipState.audioSource = null;
        }
        if (clipState.rafId) {
          cancelAnimationFrame(clipState.rafId);
          clipState.rafId = null;
        }
        if (clipState.isPlaying) {
          clipState.isPlaying = false;
          audioClipPlayBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
        }
      }

      function togglePlayPause() {
        if (clipState.isPlaying) {
          stopClipPlayback();
        } else {
          startClipPlayback();
        }
      }

      if (audioClipPlayBtn) {
        audioClipPlayBtn.addEventListener('click', togglePlayPause);
      }

      if (audioClipMinusBtn) {
        audioClipMinusBtn.addEventListener('click', () => {
          if (!clipState.hasSelection || !clipState.activeHandle) return;
          stopClipPlayback();
          if (clipState.activeHandle === 'end') {
            clipState.selEnd = Math.max(clipState.selStart + 0.1, clipState.selEnd - 1);
          } else {
            clipState.selStart = Math.max(0, clipState.selStart - 1);
            if (clipState.selStart >= clipState.selEnd) clipState.selStart = Math.max(0, clipState.selEnd - 0.1);
          }
          clipState.currentTime = clipState.activeHandle === 'end' ? clipState.selEnd : clipState.selStart;
          updatePlayhead();
          updateSelectionOverlay();
        });
      }

      if (audioClipPlusBtn) {
        audioClipPlusBtn.addEventListener('click', () => {
          if (!clipState.hasSelection || !clipState.activeHandle) return;
          stopClipPlayback();
          if (clipState.activeHandle === 'end') {
            clipState.selEnd = Math.min(clipState.duration, clipState.selEnd + 1);
          } else {
            clipState.selStart = Math.min(clipState.selEnd - 0.1, clipState.selStart + 1);
          }
          clipState.currentTime = clipState.activeHandle === 'end' ? clipState.selEnd : clipState.selStart;
          updatePlayhead();
          updateSelectionOverlay();
        });
      }

      if (audioClipResetBtn) {
        audioClipResetBtn.addEventListener('click', () => {
          stopClipPlayback();
          clipState.currentTime = 0;
          clipState.selStart = 0;
          clipState.selEnd = clipState.duration;
          clipState.hasSelection = true;
          setActiveHandle('start');
          updatePlayhead();
          updateSelectionOverlay();
        });
      }

      // Handle-based selection: drag start/end handles to select region
      // Canvas click only moves playhead (no selection drag on waveform)
      if (audioClipCanvas) {
        audioClipCanvas.addEventListener('mousedown', (e) => {
          if (!clipState.audioBuffer) return;
          const rect = audioClipCanvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const time = xToTime(x);
          stopClipPlayback();
          clipState.currentTime = time;
          setActiveHandle(null);
          updatePlayhead();
        });
      }

      // Start handle drag
      if (audioClipHandleStart) {
        audioClipHandleStart.addEventListener('mousedown', (e) => {
          if (!clipState.audioBuffer) return;
          e.preventDefault();
          e.stopPropagation();
          setActiveHandle('start');
          stopClipPlayback();

          function onMove(ev) {
            const rect = audioClipCanvas.getBoundingClientRect();
            const x = ev.clientX - rect.left;
            const time = xToTime(x);
            clipState.selStart = Math.max(0, Math.min(clipState.selEnd - 0.1, time));
            clipState.currentTime = clipState.selStart;
            updatePlayhead();
            updateSelectionOverlay();
          }
          function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          }
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      }

      // End handle drag
      if (audioClipHandleEnd) {
        audioClipHandleEnd.addEventListener('mousedown', (e) => {
          if (!clipState.audioBuffer) return;
          e.preventDefault();
          e.stopPropagation();
          setActiveHandle('end');
          stopClipPlayback();

          function onMove(ev) {
            const rect = audioClipCanvas.getBoundingClientRect();
            const x = ev.clientX - rect.left;
            const time = xToTime(x);
            clipState.selEnd = Math.min(clipState.duration, Math.max(clipState.selStart + 0.1, time));
            clipState.currentTime = clipState.selEnd;
            updatePlayhead();
            updateSelectionOverlay();
          }
          function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          }
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      }

      // Export clip
      if (audioClipExportBtn) {
        audioClipExportBtn.addEventListener('click', async () => {
          if (clipState.isExporting) return;
          if (!isTauri) {
            alert(t('home.audioClip.desktopOnly'));
            return;
          }
          if (!clipState.filePath) {
            alert(t('home.audioClip.noFile'));
            return;
          }
          let selection;
          try {
            selection = assertAudioClipSelection(
              clipState.hasSelection ? clipState.selStart : 0,
              clipState.hasSelection ? clipState.selEnd : clipState.duration,
              clipState.duration
            );
          } catch (error) {
            alert(getAudioClipErrorMessage(error));
            return;
          }
          const request = {
            inputPath: clipState.filePath,
            fileName: clipState.fileName,
            startTime: selection.start,
            endTime: selection.end,
            duration: selection.end - selection.start
          };
          const runId = ++clipExportRunId;
          clipState.isExporting = true;
          audioClipExportBtn.disabled = true;
          audioClipExportBtn.style.opacity = '0.6';
          audioClipProcessBarFill.style.width = '15%';
          audioClipProcessText.textContent = t('home.audioClip.exporting');
          audioClipProcessMask.classList.add('visible');

          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const outputDir = await getOutputDir('Audio');
            if (!isCurrentClipExport(runId)) return;

            const ffmpegReady = await ensureFfmpegAvailable();
            if (!isCurrentClipExport(runId)) return;
            if (!ffmpegReady) throw new Error('Audio trim runtime unavailable');

            audioClipProcessBarFill.style.width = '70%';
            const result = await invoke('trim_audio', {
              inputPath: request.inputPath,
              outputDir,
              startTime: request.startTime,
              endTime: request.endTime,
            });
            if (!isCurrentClipExport(runId)) return;
            if (!result?.success || !result.output_path) throw new Error(result?.error || 'Audio trim failed');

            audioClipProcessBarFill.style.width = '100%';
            clipState.outputPath = result.output_path;
            const durStr = formatTime(request.duration);
            if (audioClipSuccessMeta) {
              audioClipSuccessMeta.textContent = t('home.audioClip.successSummary', { name: request.fileName, duration: durStr });
            }
            if (audioClipSuccessFile) audioClipSuccessFile.textContent = request.fileName;
            if (audioClipSuccessDuration) audioClipSuccessDuration.textContent = durStr;
            if (audioClipSuccessPath) audioClipSuccessPath.textContent = result.output_path;
            audioClipSuccessOverlay.classList.add('visible');
          } catch (error) {
            if (isCurrentClipExport(runId)) {
              console.error('Audio clip export error:', error);
              alert(getAudioClipErrorMessage(error));
            }
          } finally {
            if (!isCurrentClipExport(runId)) return;
            audioClipProcessMask.classList.remove('visible');
            audioClipProcessBarFill.style.width = '0%';
            audioClipProcessText.textContent = t('home.audioClip.loading');
            clipState.isExporting = false;
            audioClipExportBtn.disabled = false;
            audioClipExportBtn.style.opacity = '';
          }
        });
      }

      // Success dialog
      if (audioClipSuccessOk) {
        audioClipSuccessOk.addEventListener('click', () => {
          audioClipSuccessOverlay.classList.remove('visible');
        });
      }
      if (audioClipSuccessOpenFolder) {
        audioClipSuccessOpenFolder.addEventListener('click', async () => {
          if (isTauri && clipState.outputPath) {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const folder = clipState.outputPath.replace(/[/\\][^/\\]+$/, '');
              await invoke('open_path', { path: folder });
            } catch (e) {
              console.error('Open folder error:', e);
            }
          }
        });
      }

      // Tauri native drag-drop for audio clip overlay
      if (isTauri && audioClipOverlay) {
        (async () => {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          const webview = getCurrentWebview();
          await webview.onDragDropEvent((event) => {
            if (!audioClipOverlay.classList.contains('visible') || clipState.isLoading || clipState.isExporting) return;
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') {
              audioClipOverlay.classList.add('drag-over');
              audioClipDropZone.classList.add('visible');
            } else if (payload.type === 'leave') {
              audioClipOverlay.classList.remove('drag-over');
              audioClipDropZone.classList.remove('visible');
            } else if (payload.type === 'drop') {
              audioClipOverlay.classList.remove('drag-over');
              audioClipDropZone.classList.remove('visible');
              const paths = payload.paths || [];
              if (paths.length === 0) return;
              loadClipAudioFile(paths[0]);
            }
          });
        })();
      }

      // HTML5 drag-drop fallback (non-Tauri)
      if (audioClipOverlay && !isTauri) {
        audioClipOverlay.addEventListener('dragover', (e) => {
          if (clipState.isLoading || clipState.isExporting) return;
          e.preventDefault();
          audioClipOverlay.classList.add('drag-over');
          audioClipDropZone.classList.add('visible');
        });
        audioClipOverlay.addEventListener('dragleave', (e) => {
          if (e.relatedTarget && audioClipOverlay.contains(e.relatedTarget)) return;
          audioClipOverlay.classList.remove('drag-over');
          audioClipDropZone.classList.remove('visible');
        });
        audioClipOverlay.addEventListener('drop', (e) => {
          if (clipState.isLoading || clipState.isExporting) return;
          e.preventDefault();
          audioClipOverlay.classList.remove('drag-over');
          audioClipDropZone.classList.remove('visible');
          const file = e.dataTransfer.files[0];
          if (file && (file.type.startsWith('audio/') || isAudioClipSupportedName(file.name))) {
            loadClipAudioFile(file);
          }
        });
      }

      // Redraw waveform on window resize
      window.addEventListener('resize', () => {
        if (clipState.audioBuffer && audioClipWaveformWrap.classList.contains('visible')) {
          setTimeout(() => {
            drawWaveform();
            updateSelectionOverlay();
            updatePlayhead();
          }, 100);
        }
      });

      // ===== Audio Extract Tool =====
      const audioExtractOverlay = document.getElementById('audioExtractOverlay');
      const audioExtractBack = document.getElementById('audioExtractBack');
      const audioExtractPlasmaBg = document.getElementById('audioExtractPlasmaBg');
      const audioExtractDropZone = document.getElementById('audioExtractDropZone');
      const audioExtractBody = document.getElementById('audioExtractBody');
      const audioExtractHeroTop = document.getElementById('audioExtractHeroTop');
      const audioExtractCta = document.getElementById('audioExtractCta');
      const audioExtractStart = document.getElementById('audioExtractStart');
      const audioExtractInfo = document.getElementById('audioExtractInfo');
      const audioExtractFileName = document.getElementById('audioExtractFileName');
      const audioExtractFileMeta = document.getElementById('audioExtractFileMeta');
      const audioExtractFileRemove = document.getElementById('audioExtractFileRemove');
      const audioExtractTrackSelector = document.getElementById('audioExtractTrackSelector');
      const audioExtractTrackSelect = document.getElementById('audioExtractTrackSelect');
      const audioExtractProcessMask = document.getElementById('audioExtractProcessMask');
      const audioExtractProcessBarFill = document.getElementById('audioExtractProcessBarFill');
      const audioExtractProcessText = document.getElementById('audioExtractProcessText');
      const audioExtractFormatOptions = document.getElementById('audioExtractFormatOptions');
      const audioExtractSuccessOverlay = document.getElementById('audioExtractSuccessOverlay');
      const audioExtractSuccessPath = document.getElementById('audioExtractSuccessPath');
      const audioExtractSuccessMeta = document.getElementById('audioExtractSuccessMeta');
      const audioExtractSuccessFile = document.getElementById('audioExtractSuccessFile');
      const audioExtractSuccessFormat = document.getElementById('audioExtractSuccessFormat');
      const audioExtractSuccessOpenFolder = document.getElementById('audioExtractSuccessOpenFolder');
      const audioExtractSuccessOk = document.getElementById('audioExtractSuccessOk');
      let audioExtractPlasmaInstance = null;
      let audioExtractRunId = 0;
      let audioExtractUnlisten = null;
      let extractState = {
        filePath: null,
        fileName: '',
        fileSize: 0,
        outputPath: '',
        targetFormat: 'MP3',
        trackIndex: null,
        isProcessing: false,
        isReady: false,
      };

      function setAudioExtractStartEnabled(enabled) {
        if (audioExtractStart) audioExtractStart.disabled = !enabled;
      }

      function isCurrentAudioExtractRun(runId) {
        return runId === audioExtractRunId && audioExtractOverlay?.classList.contains('visible');
      }

      function invalidateAudioExtractRun() {
        const wasProcessing = extractState.isProcessing;
        audioExtractRunId += 1;
        extractState.isProcessing = false;
        if (audioExtractUnlisten) {
          audioExtractUnlisten();
          audioExtractUnlisten = null;
        }
        if (audioExtractProcessMask) audioExtractProcessMask.classList.remove('visible');
        if (audioExtractProcessBarFill) audioExtractProcessBarFill.style.width = '0%';
        if (wasProcessing && isTauri) {
          import('@tauri-apps/api/core')
            .then(({ invoke }) => invoke('cancel_convert'))
            .catch(() => {});
        }
      }

      function finishAudioExtractRun(runId) {
        if (runId === audioExtractRunId) extractState.isProcessing = false;
      }

      function getAudioExtractErrorMessage(error) {
        if (error instanceof AudioExtractError) {
          const key = {
            invalid_input: 'invalidInput',
            input_too_large: 'inputTooLarge',
            invalid_target_format: 'invalidFormat',
            invalid_track: 'invalidTrack'
          }[error.code];
          if (key) return t(`home.audioExtract.${key}`);
        }
        const code = typeof error === 'string' ? error : error?.message || '';
        const key = {
          'audio-extract:cancelled': 'cancelled',
          'audio-extract:invalid-input': 'invalidInput',
          'audio-extract:input-too-large': 'inputTooLarge',
          'audio-extract:invalid-target-format': 'invalidFormat',
          'audio-extract:invalid-track': 'invalidTrack',
          'audio-extract:no-audio-track': 'noAudioTrack',
          'audio-extract:output-path': 'outputError',
          'audio-extract:desktop-only': 'desktopOnly',
          'audio-extract:runtime-unavailable': 'runtimeUnavailable',
          'audio-extract:failed': 'failed'
        }[code];
        return key ? t(`home.audioExtract.${key}`) : t('home.audioExtract.failed');
      }

      function openAudioExtractOverlay() {
        if (!audioExtractOverlay) return;
        audioExtractOverlay.classList.add('visible');
        if (audioExtractPlasmaBg && !audioExtractPlasmaInstance) {
          audioExtractPlasmaInstance = initPlasma(audioExtractPlasmaBg, {
            color: '#6B6B6B',
            speed: 0.8,
            direction: 'forward',
          });
        }
      }

      function closeAudioExtractOverlay() {
        if (!audioExtractOverlay) return;
        audioExtractOverlay.classList.remove('visible');
        if (audioExtractPlasmaInstance) {
          audioExtractPlasmaInstance();
          audioExtractPlasmaInstance = null;
        }
        resetExtractState();
      }

      function resetExtractState() {
        invalidateAudioExtractRun();
        extractState = {
          filePath: null,
          fileName: '',
          fileSize: 0,
          outputPath: '',
          targetFormat: 'MP3',
          trackIndex: null,
          isProcessing: false,
          isReady: false,
        };
        if (audioExtractHeroTop) audioExtractHeroTop.style.display = '';
        if (audioExtractInfo) audioExtractInfo.style.display = 'none';
        if (audioExtractTrackSelector) audioExtractTrackSelector.style.display = 'none';
        if (audioExtractTrackSelect) audioExtractTrackSelect.replaceChildren();
        setAudioExtractStartEnabled(false);
        // Reset format to MP3
        if (audioExtractFormatOptions) {
          audioExtractFormatOptions.querySelectorAll('.audio-convert-format-option').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.format === 'MP3');
          });
        }
      }

      function formatDuration(sec) {
        if (!sec || sec <= 0) return '--';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        const h = Math.floor(m / 60);
        if (h > 0) {
          return `${h}:${(m % 60).toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m}:${s.toString().padStart(2, '0')}`;
      }

      function formatFileSize(bytes) {
        if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
        if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
        if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
        return `${bytes} B`;
      }

      function renderAudioExtractTracks(audioTracks) {
        if (!audioExtractTrackSelector || !audioExtractTrackSelect) return;
        audioExtractTrackSelect.replaceChildren();
        const tracks = Array.isArray(audioTracks) ? audioTracks : [];
        if (tracks.length === 0) {
          extractState.trackIndex = null;
          audioExtractTrackSelector.style.display = 'none';
          return;
        }

        tracks.forEach((track, position) => {
          const option = document.createElement('option');
          const index = normalizeAudioTrackIndex(track?.index ?? position);
          option.value = String(index);
          option.textContent = `${t('home.audioExtract.trackLabel', { index: position + 1 })} · ${track?.codec || 'Unknown'} · ${track?.language || 'default'} · ${track?.channels || 'unknown'}`;
          audioExtractTrackSelect.appendChild(option);
        });
        extractState.trackIndex = normalizeAudioTrackIndex(audioExtractTrackSelect.value);
        audioExtractTrackSelector.style.display = tracks.length > 1 ? '' : 'none';
      }

      async function loadVideoFile(filePath, suppliedSize = null) {
        if (!filePath || extractState.isProcessing) return;
        const fileName = String(filePath).split(/[\\/]/).pop() || String(filePath);
        invalidateAudioExtractRun();
        const loadId = ++audioExtractRunId;
        setAudioExtractStartEnabled(false);

        try {
          let fileSize = suppliedSize;
          let invoke = null;
          if (isTauri) {
            ({ invoke } = await import('@tauri-apps/api/core'));
            fileSize = Number(await invoke('get_file_size', { path: filePath }));
          }
          assertAudioExtractInput({ name: fileName, size: fileSize });
          if (!isCurrentAudioExtractRun(loadId)) return;

          extractState = {
            filePath: String(filePath),
            fileName,
            fileSize,
            outputPath: '',
            targetFormat: extractState.targetFormat,
            trackIndex: null,
            isProcessing: false,
            isReady: false,
          };
          if (audioExtractHeroTop) audioExtractHeroTop.style.display = 'none';
          if (audioExtractInfo) audioExtractInfo.style.display = '';
          if (audioExtractFileName) audioExtractFileName.textContent = fileName;
          if (audioExtractFileMeta) audioExtractFileMeta.textContent = t('home.audioExtract.probing');

          if (!isTauri) {
            if (audioExtractFileMeta) audioExtractFileMeta.textContent = formatFileSize(fileSize);
            extractState.isReady = true;
            setAudioExtractStartEnabled(true);
            return;
          }

          const probe = await invoke('probe_video', { inputPath: filePath });
          if (!isCurrentAudioExtractRun(loadId)) return;
          const tracks = Array.isArray(probe.audio_tracks) ? probe.audio_tracks : [];
          const metaParts = [formatDuration(probe.duration), formatFileSize(probe.file_size)];
          if (tracks.length === 0) {
            if (audioExtractFileMeta) audioExtractFileMeta.textContent = t('home.audioExtract.noAudioTrack');
            renderAudioExtractTracks([]);
            return;
          }

          if (audioExtractFileMeta) audioExtractFileMeta.textContent = metaParts.join(' · ');
          renderAudioExtractTracks(tracks);
          extractState.isReady = true;
          setAudioExtractStartEnabled(true);
        } catch (error) {
          if (!isCurrentAudioExtractRun(loadId)) return;
          console.error('Audio extraction probe failed:', error);
          if (audioExtractFileMeta) audioExtractFileMeta.textContent = getAudioExtractErrorMessage(error);
          renderAudioExtractTracks([]);
        }
      }

      async function startExtraction() {
        if (!extractState.filePath || !extractState.isReady || extractState.isProcessing) return;
        let request;
        try {
          request = {
            inputPath: extractState.filePath,
            fileName: extractState.fileName,
            targetFormat: normalizeAudioExtractFormat(extractState.targetFormat),
            trackIndex: normalizeAudioTrackIndex(extractState.trackIndex)
          };
        } catch (error) {
          alert(getAudioExtractErrorMessage(error));
          return;
        }

        const runId = ++audioExtractRunId;
        extractState.isProcessing = true;
        setAudioExtractStartEnabled(false);
        if (audioExtractProcessMask) audioExtractProcessMask.classList.add('visible');
        if (audioExtractProcessBarFill) audioExtractProcessBarFill.style.width = '4%';
        if (audioExtractProcessText) audioExtractProcessText.textContent = t('home.audioExtract.extracting');

        let unlisten = null;
        try {
          if (!isTauri) throw new Error('audio-extract:desktop-only');
          const { invoke } = await import('@tauri-apps/api/core');
          const { listen } = await import('@tauri-apps/api/event');
          const finalOutputDir = await getOutputDir('Audio');
          if (!isCurrentAudioExtractRun(runId)) return;

          const ffmpegReady = await ensureFfmpegAvailable();
          if (!isCurrentAudioExtractRun(runId)) return;
          if (!ffmpegReady) throw new Error('audio-extract:runtime-unavailable');

          unlisten = await listen('audio-extract-progress', (event) => {
            if (!isCurrentAudioExtractRun(runId)) return;
            const data = event.payload || {};
            const progress = Number(data.progress);
            if (Number.isFinite(progress) && audioExtractProcessBarFill) {
              audioExtractProcessBarFill.style.width = `${Math.min(98, Math.max(4, Math.round(progress * 100)))}%`;
            }
            if (!audioExtractProcessText) return;
            const statusKey = {
              probe: 'probing',
              prepare: 'preparing',
              extract: 'extracting',
              publish: 'preparing',
              cancelled: 'cancelled',
              failed: 'failed'
            }[data.status] || 'extracting';
            audioExtractProcessText.textContent = t(`home.audioExtract.${statusKey}`);
          });
          audioExtractUnlisten = unlisten;
          if (!isCurrentAudioExtractRun(runId)) return;
          const result = await invoke('extract_audio', {
            inputPath: request.inputPath,
            outputDir: finalOutputDir,
            targetFormat: request.targetFormat,
            trackIndex: request.trackIndex,
          });
          if (!isCurrentAudioExtractRun(runId)) return;
          if (!result?.success || !result.output_path) throw new Error(result?.error || 'audio-extract:failed');

          if (audioExtractProcessBarFill) audioExtractProcessBarFill.style.width = '100%';
          extractState.outputPath = result.output_path;
          if (audioExtractSuccessMeta) {
            audioExtractSuccessMeta.textContent = t('home.audioExtract.successSummary', { name: request.fileName, format: request.targetFormat });
          }
          if (audioExtractSuccessFile) audioExtractSuccessFile.textContent = request.fileName;
          if (audioExtractSuccessFormat) audioExtractSuccessFormat.textContent = request.targetFormat;
          if (audioExtractSuccessPath) audioExtractSuccessPath.textContent = result.output_path;
          if (audioExtractSuccessOverlay) audioExtractSuccessOverlay.classList.add('visible');
        } catch (error) {
          if (isCurrentAudioExtractRun(runId)) {
            console.error('Audio extraction failed:', error);
            alert(getAudioExtractErrorMessage(error));
          }
        } finally {
          if (unlisten) unlisten();
          if (audioExtractUnlisten === unlisten) audioExtractUnlisten = null;
          if (!isCurrentAudioExtractRun(runId)) return;
          if (audioExtractProcessMask) audioExtractProcessMask.classList.remove('visible');
          if (audioExtractProcessBarFill) audioExtractProcessBarFill.style.width = '0%';
          finishAudioExtractRun(runId);
          setAudioExtractStartEnabled(extractState.isReady);
        }
      }

      async function selectVideoFile() {
        if (isTauri) {
          try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({
              multiple: false,
              filters: [{ name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'ts', 'm4v'] }],
            });
            if (selected) {
              loadVideoFile(selected);
            }
          } catch (e) {
            console.error('Video file select error:', e);
          }
        } else {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'video/*';
          input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
              loadVideoFile(file.name, file.size);
            }
          };
          input.click();
        }
      }

      // Format selection
      if (audioExtractFormatOptions) {
        audioExtractFormatOptions.querySelectorAll('.audio-convert-format-option').forEach(btn => {
          btn.addEventListener('click', () => {
            if (extractState.isProcessing) return;
            audioExtractFormatOptions.querySelectorAll('.audio-convert-format-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            try {
              extractState.targetFormat = normalizeAudioExtractFormat(btn.dataset.format);
            } catch (error) {
              alert(getAudioExtractErrorMessage(error));
            }
          });
        });
      }

      // Track selection
      if (audioExtractTrackSelect) {
        audioExtractTrackSelect.addEventListener('change', () => {
          try {
            extractState.trackIndex = normalizeAudioTrackIndex(audioExtractTrackSelect.value);
          } catch (error) {
            alert(getAudioExtractErrorMessage(error));
          }
        });
      }

      // CTA button
      if (audioExtractCta) {
        audioExtractCta.addEventListener('click', selectVideoFile);
      }
      if (audioExtractStart) {
        audioExtractStart.addEventListener('click', startExtraction);
      }

      // File remove
      if (audioExtractFileRemove) {
        audioExtractFileRemove.addEventListener('click', () => {
          resetExtractState();
        });
      }

      // Back button
      if (audioExtractBack) {
        audioExtractBack.addEventListener('click', closeAudioExtractOverlay);
      }

      // Navigation entry
      document.querySelectorAll('.audio-list-item[data-tool="audio-extract"]').forEach(item => {
        item.addEventListener('click', () => { openToolWithFfmpegCheck(openAudioExtractOverlay); });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openToolWithFfmpegCheck(openAudioExtractOverlay);
          }
        });
      });

      // Success dialog
      if (audioExtractSuccessOk) {
        audioExtractSuccessOk.addEventListener('click', () => {
          if (audioExtractSuccessOverlay) audioExtractSuccessOverlay.classList.remove('visible');
          resetExtractState();
        });
      }
      if (audioExtractSuccessOpenFolder) {
        audioExtractSuccessOpenFolder.addEventListener('click', async () => {
          if (isTauri && extractState.outputPath) {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const folder = extractState.outputPath.replace(/[/\\][^/\\]+$/, '');
              await invoke('open_path', { path: folder });
            } catch (e) {
              console.error('Open folder error:', e);
            }
          }
        });
      }

      // Tauri native drag-drop for audio extract overlay
      if (isTauri && audioExtractOverlay) {
        (async () => {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          const webview = getCurrentWebview();
          await webview.onDragDropEvent((event) => {
            if (!audioExtractOverlay.classList.contains('visible') || extractState.isProcessing) return;
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') {
              audioExtractOverlay.classList.add('drag-over');
              if (audioExtractDropZone) audioExtractDropZone.classList.add('visible');
            } else if (payload.type === 'leave') {
              audioExtractOverlay.classList.remove('drag-over');
              if (audioExtractDropZone) audioExtractDropZone.classList.remove('visible');
            } else if (payload.type === 'drop') {
              audioExtractOverlay.classList.remove('drag-over');
              if (audioExtractDropZone) audioExtractDropZone.classList.remove('visible');
              const paths = payload.paths || [];
              if (paths.length === 0) return;
              const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'ts', 'm4v'];
              const videoPath = paths.find(p => videoExts.some(ext => p.toLowerCase().endsWith('.' + ext)));
              if (videoPath) {
                loadVideoFile(videoPath);
              }
            }
          });
        })();
      }

      // HTML5 drag-drop fallback (non-Tauri)
      if (audioExtractOverlay && !isTauri) {
        audioExtractOverlay.addEventListener('dragover', (e) => {
          e.preventDefault();
          audioExtractOverlay.classList.add('drag-over');
          if (audioExtractDropZone) audioExtractDropZone.classList.add('visible');
        });
        audioExtractOverlay.addEventListener('dragleave', (e) => {
          if (e.relatedTarget && audioExtractOverlay.contains(e.relatedTarget)) return;
          audioExtractOverlay.classList.remove('drag-over');
          if (audioExtractDropZone) audioExtractDropZone.classList.remove('visible');
        });
        audioExtractOverlay.addEventListener('drop', (e) => {
          e.preventDefault();
          audioExtractOverlay.classList.remove('drag-over');
          if (audioExtractDropZone) audioExtractDropZone.classList.remove('visible');
          const file = e.dataTransfer.files[0];
          if (file && file.type.startsWith('video/')) {
            loadVideoFile(file.name, file.size);
          }
        });
      }

      // Feedback drawer
      const feedbackDrawer = document.getElementById('feedbackDrawer');
      const feedbackDrawerBackdrop = document.getElementById('feedbackDrawerBackdrop');
      const feedbackDrawerClose = document.getElementById('feedbackDrawerClose');
      const feedbackCta = document.getElementById('feedbackCta');
      const feedbackForm = document.getElementById('feedbackForm');
      const feedbackFormCancel = document.getElementById('feedbackFormCancel');
      const feedbackFormSubmit = document.getElementById('feedbackFormSubmit');
      const feedbackName = document.getElementById('feedbackName');
      const feedbackEmail = document.getElementById('feedbackEmail');
      const feedbackTitle = document.getElementById('feedbackTitle');
      const feedbackContent = document.getElementById('feedbackContent');

      function openFeedbackDrawer() {
        if (feedbackDrawer) feedbackDrawer.classList.add('open');
      }

      function closeFeedbackDrawer() {
        if (feedbackDrawer) feedbackDrawer.classList.remove('open');
      }

      function resetFeedbackForm() {
        if (feedbackForm) feedbackForm.reset();
      }

      if (feedbackCta) {
        feedbackCta.addEventListener('click', () => {
          void openExternalUrl('https://github.com/ZihangDong/toolknit-desktop');
        });
      }

      if (feedbackDrawerClose) {
        feedbackDrawerClose.addEventListener('click', () => {
          closeFeedbackDrawer();
        });
      }

      if (feedbackDrawerBackdrop) {
        feedbackDrawerBackdrop.addEventListener('click', () => {
          closeFeedbackDrawer();
        });
      }

      if (feedbackFormCancel) {
        feedbackFormCancel.addEventListener('click', () => {
          closeFeedbackDrawer();
          resetFeedbackForm();
        });
      }

      if (feedbackForm) {
        feedbackForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!feedbackForm.checkValidity()) return;

          const payload = {
            title: feedbackTitle ? feedbackTitle.value.trim() : '',
            content: feedbackContent ? feedbackContent.value.trim() : ''
          };
          const nameVal = feedbackName ? feedbackName.value.trim() : '';
          const emailVal = feedbackEmail ? feedbackEmail.value.trim() : '';
          if (nameVal) payload.name = nameVal;
          if (emailVal) payload.email = emailVal;

          if (feedbackFormSubmit) feedbackFormSubmit.disabled = true;

          try {
            const msg = getLang() === 'zh' ? '此功能在开源版中已移除' : 'This feature has been removed in the open-source version.';
            window.showToast(msg);
          } finally {
            if (feedbackFormSubmit) feedbackFormSubmit.disabled = false;
          }
        });
      }

      // Random marquee reviews
      const marqueeTrack = document.getElementById('marqueeTrack');
      if (marqueeTrack) {
        function getReviewers() {
          return [
            { name: 'Sarah', text: t('home.feedbackPage.review1') },
            { name: 'Michael', text: t('home.feedbackPage.review2') },
            { name: 'Emily', text: t('home.feedbackPage.review3') },
            { name: 'David', text: t('home.feedbackPage.review4') },
            { name: 'Jessica', text: t('home.feedbackPage.review5') },
            { name: 'James', text: t('home.feedbackPage.review6') },
            { name: 'Olivia', text: t('home.feedbackPage.review7') },
            { name: 'Christopher', text: t('home.feedbackPage.review8') },
            { name: 'Amanda', text: t('home.feedbackPage.review9') },
            { name: 'Matthew', text: t('home.feedbackPage.review10') },
            { name: 'Elizabeth', text: t('home.feedbackPage.review11') },
            { name: 'Daniel', text: t('home.feedbackPage.review12') }
          ];
        }

        function renderReviews() {
          const stars = Array.from({ length: 5 }, () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>').join('');
          const reviewers = getReviewers();

          const cards = reviewers.map((r, i) => {
            const initial = r.name.charAt(0).toUpperCase();
            const palettes = [
              ['#667eea', '#764ba2'], ['#f093fb', '#f5576c'], ['#4facfe', '#00f2fe'],
              ['#43e97b', '#38f9d7'], ['#fa709a', '#fee140'], ['#30cfd0', '#330867'],
              ['#a8edea', '#fed6e3'], ['#ff9a9e', '#fecfef'], ['#ffecd2', '#fcb69f'],
              ['#a18cd1', '#fbc2eb'], ['#fbc2eb', '#a6c1ee'], ['#84fab0', '#8fd3f4']
            ];
            const [c1, c2] = palettes[i % palettes.length];
            const avatarSvg = `<div class="marquee-avatar" style="background:linear-gradient(135deg,${c1},${c2});display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:#fff;flex-shrink:0;">${escapeHtml(initial)}</div>`;
            return `
              <div class="marquee-card">
                <div class="marquee-card-header">
                  ${avatarSvg}
                  <div class="marquee-info">
                    <div class="marquee-name">${escapeHtml(r.name)}</div>
                    <div class="marquee-stars">${stars}</div>
                  </div>
                </div>
                <p class="marquee-text">${escapeHtml(r.text)}</p>
              </div>
            `;
          }).join('');

          // Duplicate for seamless loop
          marqueeTrack.innerHTML = cards + cards;
        }

        renderReviews();
        onLangChange(renderReviews);
      }

      // ===== Legal Overlay (Declaration & Usage Policy) =====
      const legalOverlay = document.getElementById('legalOverlay');
      const legalBackBtn = document.getElementById('legalBackBtn');
      const legalNav = document.getElementById('legalNav');
      const legalContentTitle = document.getElementById('legalContentTitle');
      const legalContentBody = document.getElementById('legalContentBody');

      function showLegalSection(sectionId) {
        const content = getLegalContent();
        if (!content || !content[sectionId]) return;
        const data = content[sectionId];
        if (legalContentTitle) legalContentTitle.textContent = data.title;
        if (legalContentBody) {
          legalContentBody.innerHTML = data.html;
          legalContentBody.scrollTop = 0;
        }
        if (legalNav) {
          legalNav.querySelectorAll('.help-nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.legalSection === sectionId);
          });
        }
      }

      function openLegalOverlay(sectionId) {
        if (legalOverlay) legalOverlay.classList.add('visible');
        showLegalSection(sectionId || 'declaration');
      }

      function closeLegalOverlay() {
        if (legalOverlay) legalOverlay.classList.remove('visible');
      }

      if (legalBackBtn) {
        legalBackBtn.addEventListener('click', closeLegalOverlay);
      }

      if (legalNav) {
        legalNav.querySelectorAll('.help-nav-item').forEach(item => {
          item.addEventListener('click', () => {
            const section = item.dataset.legalSection;
            if (section) showLegalSection(section);
          });
        });
      }

      if (declarationLink) {
        declarationLink.addEventListener('click', (e) => {
          e.preventDefault();
          openLegalOverlay('declaration');
        });
      }

      if (usagePolicyLink) {
        usagePolicyLink.addEventListener('click', (e) => {
          e.preventDefault();
          openLegalOverlay('usage-policy');
        });
      }

      // Refresh legal content on language change
      onLangChange(() => {
        if (legalOverlay && legalOverlay.classList.contains('visible')) {
          const activeItem = legalNav && legalNav.querySelector('.help-nav-item.active');
          showLegalSection(activeItem ? activeItem.dataset.legalSection : 'declaration');
        }
      });

      // API key configuration lives in Settings in the open-source desktop app.
      const btnApiKey = document.getElementById('settingsApiKey');
      const apiKeyOverlay = document.getElementById('apiKeyOverlay');
      const apiKeyBack = document.getElementById('apiKeyBack');
      const apiKeyInput = document.getElementById('apiKeyInput');
      const apiKeyToggle = document.getElementById('apiKeyToggle');
      const apiKeySave = document.getElementById('apiKeySave');
      const apiKeyClear = document.getElementById('apiKeyClear');
      const apiKeyStatus = document.getElementById('apiKeyStatus');
      const apiKeyDropdown = document.getElementById('apiKeyDropdown');
      const apiKeyDropdownTrigger = document.getElementById('apiKeyDropdownTrigger');
      const apiKeyDropdownMenu = document.getElementById('apiKeyDropdownMenu');
      const apiKeyDropdownValue = document.getElementById('apiKeyDropdownValue');
      let apiKeyPlatformValue = 'deepseek';
      const apiKeyCustomWrap = document.getElementById('apiKeyCustomWrap');
      const apiKeyCustomUrl = document.getElementById('apiKeyCustomUrl');
      const apiKeyCustomModel = document.getElementById('apiKeyCustomModel');

      // AI platform configurations
      const AI_PLATFORMS = {
        deepseek: { url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat', label: 'DeepSeek' },
        openai: { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', label: 'OpenAI' },
        qwen: { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus', label: 'Qwen' },
        moonshot: { url: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k', label: 'Moonshot' },
        custom: { url: '', model: '' },
      };

      function getAiPlatformConfig() {
        const platform = localStorage.getItem('ai_platform') || 'deepseek';
        const base = AI_PLATFORMS[platform] || AI_PLATFORMS.deepseek;
        if (platform === 'custom') {
          return {
            url: localStorage.getItem('ai_custom_url') || '',
            model: localStorage.getItem('ai_custom_model') || '',
          };
        }
        return { url: base.url, model: base.model };
      }

      function hasAiApiKey() {
        return !!localStorage.getItem('ai_api_key');
      }

      function setApiKeyPlatform(value) {
        apiKeyPlatformValue = value;
        const items = apiKeyDropdownMenu.querySelectorAll('.api-key-dropdown-item');
        items.forEach(item => {
          item.classList.toggle('active', item.dataset.value === value);
          if (item.dataset.value === value) {
            apiKeyDropdownValue.textContent = item.textContent;
          }
        });
        if (value === 'custom') {
          if (apiKeyCustomWrap) apiKeyCustomWrap.style.display = '';
        } else {
          if (apiKeyCustomWrap) apiKeyCustomWrap.style.display = 'none';
        }
      }

      if (apiKeyDropdownTrigger && apiKeyDropdown) {
        apiKeyDropdownTrigger.addEventListener('click', (e) => {
          e.stopPropagation();
          apiKeyDropdown.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
          if (!apiKeyDropdown.contains(e.target)) {
            apiKeyDropdown.classList.remove('open');
          }
        });
      }
      if (apiKeyDropdownMenu) {
        apiKeyDropdownMenu.querySelectorAll('.api-key-dropdown-item').forEach(item => {
          item.addEventListener('click', () => {
            setApiKeyPlatform(item.dataset.value);
            apiKeyDropdown.classList.remove('open');
          });
        });
      }

      if (btnApiKey && apiKeyOverlay) {
        btnApiKey.addEventListener('click', (e) => {
          e.stopPropagation();
          const savedPlatform = localStorage.getItem('ai_platform') || 'deepseek';
          const savedKey = localStorage.getItem('ai_api_key') || '';
          setApiKeyPlatform(savedPlatform);
          apiKeyInput.value = savedKey;
          if (apiKeyCustomUrl) apiKeyCustomUrl.value = localStorage.getItem('ai_custom_url') || '';
          if (apiKeyCustomModel) apiKeyCustomModel.value = localStorage.getItem('ai_custom_model') || '';
          apiKeyStatus.classList.remove('show', 'success', 'error');
          apiKeyOverlay.classList.add('visible');
        });
      }
      if (apiKeyBack && apiKeyOverlay) {
        apiKeyBack.addEventListener('click', () => {
          apiKeyOverlay.classList.remove('visible');
        });
      }
      if (apiKeyToggle) {
        apiKeyToggle.addEventListener('click', () => {
          apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
        });
      }
      if (apiKeySave) {
        apiKeySave.addEventListener('click', () => {
          const key = apiKeyInput.value.trim();
          if (!key) {
            apiKeyStatus.textContent = t('apiKey.errEmpty');
            apiKeyStatus.className = 'api-key-status show error';
            return;
          }
          const platform = apiKeyPlatformValue;
          let customUrl = '';
          let customModel = '';
          if (platform === 'custom') {
            customUrl = apiKeyCustomUrl ? apiKeyCustomUrl.value.trim() : '';
            customModel = apiKeyCustomModel ? apiKeyCustomModel.value.trim() : '';
            if (!customUrl || !customModel) {
              apiKeyStatus.textContent = t('apiKey.errCustom');
              apiKeyStatus.className = 'api-key-status show error';
              return;
            }
            try {
              const normalizedConfig = normalizeAiProviderConfig({ url: customUrl, model: customModel });
              customUrl = normalizedConfig.url;
              customModel = normalizedConfig.model;
            } catch {
              apiKeyStatus.textContent = t('apiKey.errCustom');
              apiKeyStatus.className = 'api-key-status show error';
              return;
            }
          }
          localStorage.setItem('ai_platform', platform);
          localStorage.setItem('ai_api_key', key);
          if (platform === 'custom') {
            localStorage.setItem('ai_custom_url', customUrl);
            localStorage.setItem('ai_custom_model', customModel);
          }
          apiKeyStatus.textContent = t('apiKey.saved');
          apiKeyStatus.className = 'api-key-status show success';
          setTimeout(() => apiKeyOverlay.classList.remove('visible'), 800);
        });
      }
      if (apiKeyClear) {
        apiKeyClear.addEventListener('click', () => {
          apiKeyInput.value = '';
          localStorage.removeItem('ai_api_key');
          localStorage.removeItem('ai_platform');
          localStorage.removeItem('ai_custom_url');
          localStorage.removeItem('ai_custom_model');
          // Also clear legacy key
          localStorage.removeItem('deepseek_api_key');
          apiKeyStatus.textContent = t('apiKey.cleared');
          apiKeyStatus.className = 'api-key-status show success';
          setTimeout(() => apiKeyOverlay.classList.remove('visible'), 800);
        });
      }

      // AI key required overlay
      const aiKeyRequiredOverlay = document.getElementById('aiKeyRequiredOverlay');
      const aiKeyRequiredCancel = document.getElementById('aiKeyRequiredCancel');
      const aiKeyRequiredGoSettings = document.getElementById('aiKeyRequiredGoSettings');

      function hideAiKeyRequiredOverlay() {
        if (aiKeyRequiredOverlay) aiKeyRequiredOverlay.classList.remove('visible');
      }
      if (aiKeyRequiredCancel) {
        aiKeyRequiredCancel.addEventListener('click', hideAiKeyRequiredOverlay);
      }
      if (aiKeyRequiredGoSettings) {
        aiKeyRequiredGoSettings.addEventListener('click', () => {
          hideAiKeyRequiredOverlay();
          if (btnApiKey) btnApiKey.click();
        });
      }

      // Check AI API key before opening AI tool overlay
      function openToolWithAiCheck(openFn) {
        if (!hasAiApiKey()) {
          if (aiKeyRequiredOverlay) aiKeyRequiredOverlay.classList.add('visible');
          return;
        }
        openFn();
      }

      window.showToast = function(message, duration = 2000) {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
          toast.classList.add('hiding');
          toast.addEventListener('animationend', () => toast.remove(), { once: true });
        }, duration);
      };

      const HOME_LINKS = {
        website: 'https://toolknit.com',
        github: 'https://github.com/ZihangDong/toolknit-desktop'
      };

      async function openExternalUrl(url) {
        if (!url || !/^https?:\/\//i.test(url)) {
          console.warn('Invalid external URL:', url);
          return;
        }
        if (isTauri) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('open_url', { url });
          } catch (err) {
            console.error('Failed to open URL:', err);
            window.open(url, '_blank');
          }
        } else {
          window.open(url, '_blank');
        }
      }

      document.querySelectorAll('[data-home-link]').forEach(link => {
        link.addEventListener('click', () => {
          const url = HOME_LINKS[link.dataset.homeLink];
          if (url) openExternalUrl(url);
        });
      });

      const homeSupportAuthor = document.getElementById('homeSupportAuthor');
      const donationOverlay = document.getElementById('donationOverlay');

      function openDonationOverlay() {
        if (!donationOverlay) return;
        donationOverlay.classList.add('visible');
        donationOverlay.setAttribute('aria-hidden', 'false');
      }

      function closeDonationOverlay() {
        if (!donationOverlay) return;
        donationOverlay.classList.remove('visible');
        donationOverlay.setAttribute('aria-hidden', 'true');
      }

      homeSupportAuthor?.addEventListener('click', openDonationOverlay);
      donationOverlay?.querySelectorAll('[data-donation-close]').forEach(button => {
        button.addEventListener('click', closeDonationOverlay);
      });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && donationOverlay?.classList.contains('visible')) {
          closeDonationOverlay();
        }
      });

      const GITHUB_REPOSITORY = 'ZihangDong/toolknit-desktop';
      const GITHUB_STATS_CACHE_KEY = 'toolknit_github_home_stats';
      const GITHUB_CONTRIBUTORS_URL = `https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/main/public/contributors.json`;
      const GITHUB_LOCAL_CONTRIBUTORS_URL = new URL('contributors.json', document.baseURI).href;
      const GITHUB_FIXED_ACTIVITY_POINTS = '0,62 248,62 280,8';
      // A shipped snapshot prevents a blank metric on first launch without a network connection.
      const DEFAULT_GITHUB_STAR_COUNT = 216;
      const DEFAULT_DONATION_TOTAL = 23.88;
      const GITHUB_REQUEST_TIMEOUT_MS = 8_000;

      async function fetchGithubJson(url, options = {}) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), GITHUB_REQUEST_TIMEOUT_MS);
        try {
          const response = await fetch(url, { ...options, signal: controller.signal });
          if (!response.ok) throw new Error(`GitHub request failed: ${response.status}`);
          return response.json();
        } finally {
          window.clearTimeout(timeoutId);
        }
      }

      function normalizeGithubStarCount(value) {
        const count = Number(value);
        return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
      }

      function normalizeDonationTotal(data) {
        const contributors = Array.isArray(data?.contributors) ? data.contributors : [];
        const total = contributors.reduce((sum, contributor) => {
          const amount = Number(contributor?.amount_cny);
          return Number.isFinite(amount) && amount >= 0 && amount <= 100_000_000 ? sum + amount : sum;
        }, 0);
        return Math.round(total * 100) / 100;
      }

      function formatDonationTotal(value) {
        const total = Number.isFinite(value) && value >= 0 ? value : DEFAULT_DONATION_TOTAL;
        return total.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      function getCachedGithubStats() {
        try {
          const cached = JSON.parse(localStorage.getItem(GITHUB_STATS_CACHE_KEY) || 'null');
          if (!cached || typeof cached !== 'object' || !cached.data) return null;
          return {
            stars: normalizeGithubStarCount(cached.data.stars) ?? DEFAULT_GITHUB_STAR_COUNT,
            donationTotal: Number.isFinite(Number(cached.data.donationTotal))
              ? Math.max(0, Number(cached.data.donationTotal))
              : DEFAULT_DONATION_TOTAL
          };
        } catch {
          return null;
        }
      }

      function saveGithubStats(data) {
        try {
          localStorage.setItem(GITHUB_STATS_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
        } catch {
          // Homepage metrics remain functional when browser storage is unavailable.
        }
      }

      function renderGithubActivity(data, { repoSynced = false, donationsSynced = false } = {}) {
        const status = document.getElementById('githubActivityStatus');
        const starCount = document.getElementById('githubStarCount');
        const donationTotal = document.getElementById('githubDonationTotal');
        const chartLine = document.getElementById('githubActivityLine');
        if (!status || !starCount || !donationTotal || !chartLine) return;

        starCount.textContent = data?.stars === null || data?.stars === undefined ? '--' : String(data.stars);
        donationTotal.textContent = formatDonationTotal(Number(data?.donationTotal));
        chartLine.setAttribute('points', GITHUB_FIXED_ACTIVITY_POINTS);
        status.textContent = repoSynced && donationsSynced
          ? 'Star 与贡献名单已同步'
          : repoSynced
            ? 'Star 已同步，贡献名单使用本地数据'
            : '离线显示最近可用数据';
      }

      async function loadDonationTotal() {
        const sources = [
          { url: GITHUB_CONTRIBUTORS_URL, isLive: true },
          { url: GITHUB_LOCAL_CONTRIBUTORS_URL, isLive: false }
        ];
        let lastError = null;
        for (const source of sources) {
          try {
            const data = await fetchGithubJson(source.url, {
              cache: 'no-store',
              headers: { Accept: 'application/json' }
            });
            const total = normalizeDonationTotal(data);
            return { total, isLive: source.isLive };
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError || new Error('Contributor list request failed');
      }

      async function loadGithubActivity() {
        const cached = getCachedGithubStats();
        renderGithubActivity(cached || {
          stars: DEFAULT_GITHUB_STAR_COUNT,
          donationTotal: DEFAULT_DONATION_TOTAL
        });

        const headers = { Accept: 'application/vnd.github+json' };
        const [repoResult, donationResult] = await Promise.allSettled([
          fetchGithubJson(`https://api.github.com/repos/${GITHUB_REPOSITORY}`, { headers }),
          loadDonationTotal()
        ]);
        const repoSynced = repoResult.status === 'fulfilled';
        const donationsAvailable = donationResult.status === 'fulfilled';
        const donationsSynced = donationsAvailable && donationResult.value.isLive;
        const data = {
          stars: repoSynced
            ? normalizeGithubStarCount(repoResult.value?.stargazers_count)
            : cached?.stars ?? DEFAULT_GITHUB_STAR_COUNT,
          donationTotal: donationsAvailable
            ? donationResult.value.total
            : cached?.donationTotal ?? DEFAULT_DONATION_TOTAL
        };
        if (!repoSynced) console.warn('Unable to load GitHub stars:', repoResult.reason);
        if (!donationsAvailable) console.warn('Unable to load contributor donations:', donationResult.reason);
        saveGithubStats(data);
        renderGithubActivity(data, { repoSynced, donationsSynced });
      }

      loadGithubActivity();

      // ===== PDF Merger =====
      const pdfMergeOverlay = document.getElementById('pdfMergeOverlay');
      const pdfMergeFerrofluid = document.getElementById('pdfMergeFerrofluid');
      const pdfMergeBack = document.getElementById('pdfMergeBack');
      let pdfMergeFerrofluidInstance = null;

      function openPdfMergeOverlay() {
        if (!pdfMergeOverlay) return;
        pdfMergeOverlay.classList.add('visible');
        if (pdfMergeFerrofluid && !pdfMergeFerrofluidInstance) {
          pdfMergeFerrofluidInstance = initFerrofluid(pdfMergeFerrofluid, {
            colors: ['#e8e8ec', '#a0a0a8', '#ffffff'],
            speed: 0.3,
            scale: 2,
            turbulence: 1,
            fluidity: 0.14,
            rimWidth: 0.19,
            sharpness: 4.7,
            shimmer: 0.5,
            glow: 2.8,
            flowDirection: 'left',
            opacity: 0.6,
            mouseInteraction: true,
            mouseStrength: 1.6,
            mouseRadius: 0.6,
            mouseDampening: 0.15
          });
        }
      }

      function closePdfMergeOverlay() {
        if (!pdfMergeOverlay) return;
        pdfMergeOverlay.classList.remove('visible');
        if (pdfMergeFerrofluidInstance) {
          pdfMergeFerrofluidInstance();
          pdfMergeFerrofluidInstance = null;
        }
        pdfMergeProcessing = false;
        pdfMergeCommitting = false;
        resetPdfMergeSelectionFlow();
        releasePdfMergePreviewResources();
        if (pdfMergeProcessMask) pdfMergeProcessMask.classList.remove('visible');
        if (pdfMergeProcessBarFill) pdfMergeProcessBarFill.style.width = '0%';
        clearPdfMergeFiles();
      }

      function returnToPdfMergeEditor() {
        if (pdfMergeCommitting) return;
        resetPdfMergeSelectionFlow();
        releasePdfMergePreviewResources();
        pdfMergeProcessing = false;
        if (pdfMergeProcessMask) pdfMergeProcessMask.classList.remove('visible');
        if (pdfMergeProcessBarFill) pdfMergeProcessBarFill.style.width = '0%';
      }

      if (pdfMergeBack) {
        pdfMergeBack.addEventListener('click', () => {
          if (pdfMergeSelection?.classList.contains('visible')) {
            returnToPdfMergeEditor();
            return;
          }
          closePdfMergeOverlay();
        });
      }

      document.querySelectorAll('.audio-list-item[data-tool="pdf-merge"]').forEach(item => {
        item.addEventListener('click', () => {
          openPdfMergeOverlay();
        });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPdfMergeOverlay();
          }
        });
      });

      // ===== PDF Split Overlay Open/Close =====
      const pdfSplitOverlay = document.getElementById('pdfSplitOverlay');
      const pdfSplitFerrofluid = document.getElementById('pdfSplitFerrofluid');
      const pdfSplitBack = document.getElementById('pdfSplitBack');
      let pdfSplitFerrofluidInstance = null;

      function openPdfSplitOverlay() {
        if (!pdfSplitOverlay) return;
        pdfSplitOverlay.classList.add('visible');
        if (pdfSplitFerrofluid && !pdfSplitFerrofluidInstance) {
          pdfSplitFerrofluidInstance = initFerrofluid(pdfSplitFerrofluid, {
            colors: ['#e8e8ec', '#a0a0a8', '#ffffff'],
            speed: 0.3,
            scale: 2,
            opacity: 0.6,
          });
        }
      }

      function closePdfSplitOverlay() {
        if (!pdfSplitOverlay) return;
        pdfSplitOverlay.classList.remove('visible');
        if (pdfSplitFerrofluidInstance) {
          pdfSplitFerrofluidInstance();
          pdfSplitFerrofluidInstance = null;
        }
      }

      if (pdfSplitBack) {
        pdfSplitBack.addEventListener('click', closePdfSplitOverlay);
      }

      document.querySelectorAll('.audio-list-item[data-tool="pdf-split"]').forEach(item => {
        item.addEventListener('click', () => {
          openPdfSplitOverlay();
        });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPdfSplitOverlay();
          }
        });
      });

      // ===== PDF Split Interaction =====
      const pdfSplitDropZone = document.getElementById('pdfSplitDropZone');
      const pdfSplitFiles = document.getElementById('pdfSplitFiles');
      const pdfSplitCta = document.getElementById('pdfSplitCta');
      const pdfSplitProcessBtn = document.getElementById('pdfSplitProcessBtn');
      const pdfSplitProcessMask = document.getElementById('pdfSplitProcessMask');
      const pdfSplitProcessBarFill = document.getElementById('pdfSplitProcessBarFill');
      const pdfSplitProcessText = document.getElementById('pdfSplitProcessText');
      const pdfSplitSuccessOverlay = document.getElementById('pdfSplitSuccessOverlay');
      const pdfSplitSuccessPath = document.getElementById('pdfSplitSuccessPath');
      const pdfSplitSuccessMeta = document.getElementById('pdfSplitSuccessMeta');
      const pdfSplitSuccessCount = document.getElementById('pdfSplitSuccessCount');
      const pdfSplitSuccessOpenFolder = document.getElementById('pdfSplitSuccessOpenFolder');
      const pdfSplitSuccessOk = document.getElementById('pdfSplitSuccessOk');
      const pdfSplitWorkspace = document.getElementById('pdfSplitWorkspace');
      const pdfSplitWorkspaceClose = document.getElementById('pdfSplitWorkspaceClose');
      const pdfSplitWorkspaceStatus = document.getElementById('pdfSplitWorkspaceStatus');
      const pdfSplitWorkspaceHint = document.getElementById('pdfSplitWorkspaceHint');
      const pdfSplitPageStrip = document.getElementById('pdfSplitPageStrip');
      const pdfSplitSelectedCount = document.getElementById('pdfSplitSelectedCount');
      const pdfSplitDownloadAllBtn = document.getElementById('pdfSplitDownloadAllBtn');
      const pdfSplitSelectionMeta = document.getElementById('pdfSplitSelectionMeta');
      const pdfSplitSelectAllBtn = document.getElementById('pdfSplitSelectAllBtn');

      let selectedPdfSplitFiles = [];
      let pdfSplitProcessing = false;
      let pdfSplitSaving = false;
      let pdfSplitRunId = 0;
      let pdfSplitActiveRunId = 0;
      let lastPdfSplitSavedFolder = '';

      function addPdfSplitFiles(fileList) {
        if (!fileList || fileList.length === 0) return;
        for (const file of fileList) {
          const dup = file.path
            ? selectedPdfSplitFiles.some(f => f.path === file.path)
            : selectedPdfSplitFiles.some(f => f.name === file.name && f.size === file.size);
          if (dup) continue;
          selectedPdfSplitFiles.push(file);
        }
        renderPdfSplitFiles();
      }

      function removePdfSplitFile(index) {
        selectedPdfSplitFiles.splice(index, 1);
        renderPdfSplitFiles();
      }

      function clearPdfSplitFiles() {
        selectedPdfSplitFiles = [];
        renderPdfSplitFiles();
      }

      function renderPdfSplitFiles() {
        if (!pdfSplitFiles) return;
        pdfSplitFiles.innerHTML = '';
        if (selectedPdfSplitFiles.length > 0) {
          pdfSplitFiles.classList.add('has-files');
        } else {
          pdfSplitFiles.classList.remove('has-files');
        }
        selectedPdfSplitFiles.forEach((file, index) => {
          const item = document.createElement('div');
          item.className = 'audio-convert-file-item';
          item.dataset.index = index;
          item.innerHTML = `
            <span class="audio-convert-file-index">${index + 1}</span>
            <span class="audio-convert-file-name">${escapeHtml(file.name)}</span>
            <button class="audio-convert-file-remove" data-index="${index}" aria-label="remove">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          `;
          pdfSplitFiles.appendChild(item);
        });
        pdfSplitFiles.querySelectorAll('.audio-convert-file-remove').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.index, 10);
            if (!isNaN(idx)) removePdfSplitFile(idx);
          });
        });
        enableSortableFileList(pdfSplitFiles, selectedPdfSplitFiles, renderPdfSplitFiles, () => pdfSplitProcessing || pdfSplitSaving);
        togglePdfSplitProcessButton();
      }

      function togglePdfSplitProcessButton() {
        if (!pdfSplitProcessBtn) return;
        if (selectedPdfSplitFiles.length >= 1) {
          pdfSplitProcessBtn.style.display = '';
          requestAnimationFrame(() => pdfSplitProcessBtn.classList.add('visible'));
        } else {
          pdfSplitProcessBtn.classList.remove('visible');
          const onTransitionEnd = (e) => {
            if (e.propertyName === 'opacity' && !pdfSplitProcessBtn.classList.contains('visible')) {
              pdfSplitProcessBtn.style.display = 'none';
              pdfSplitProcessBtn.removeEventListener('transitionend', onTransitionEnd);
            }
          };
          pdfSplitProcessBtn.addEventListener('transitionend', onTransitionEnd);
        }
      }

      function showPdfSplitDropZone() {
        if (pdfSplitDropZone) pdfSplitDropZone.classList.add('visible');
        if (pdfSplitOverlay) pdfSplitOverlay.classList.add('drag-over');
      }

      function hidePdfSplitDropZone() {
        if (pdfSplitDropZone) pdfSplitDropZone.classList.remove('visible');
        if (pdfSplitOverlay) pdfSplitOverlay.classList.remove('drag-over');
      }

      // Tauri native drag-drop
      if (isTauri && pdfSplitOverlay) {
        (async () => {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          const webview = getCurrentWebview();
          await webview.onDragDropEvent((event) => {
            if (!pdfSplitOverlay.classList.contains('visible') || pdfSplitProcessing) return;
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') {
              showPdfSplitDropZone();
            } else if (payload.type === 'leave') {
              hidePdfSplitDropZone();
            } else if (payload.type === 'drop') {
              hidePdfSplitDropZone();
              const paths = payload.paths || [];
              if (paths.length === 0) return;
              const fileList = paths
                .filter(p => p.toLowerCase().endsWith('.pdf'))
                .map(path => ({ name: path.split(/[\\/]/).pop() || path, path, size: 0 }));
              if (fileList.length > 0) {
                addPdfSplitFiles(fileList);
              }
            }
          });
        })();
      }

      // CTA button — open file dialog
      if (pdfSplitCta) {
        pdfSplitCta.addEventListener('click', async () => {
          if (isTauri) {
            try {
              const { open } = await import('@tauri-apps/plugin-dialog');
              const selected = await open({
                multiple: true,
                filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
              });
              if (selected && Array.isArray(selected)) {
                const fileList = selected.map(path => ({ name: path.split(/[\\/]/).pop() || path, path, size: 0 }));
                addPdfSplitFiles(fileList);
              }
            } catch (e) {
              console.error('PDF split file selection error', e);
            }
          } else {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = '.pdf,application/pdf';
            input.addEventListener('change', () => {
              addPdfSplitFiles(input.files);
              input.value = '';
            });
            input.click();
          }
        });
      }

      // ===== PDF Split: Preview, Selection, and Export =====
      let pdfSplitLoadedDocs = []; // [{ doc, fileData, fileName }]
      let pdfSplitPagesData = []; // [{ fileIndex, pageIndex, canvas, selected }]
      let pdfSplitLoadingTasks = new Set();

      function releasePdfSplitPreviewResources() {
        pdfSplitLoadingTasks.forEach(task => { try { task.destroy(); } catch (_) {} });
        pdfSplitLoadingTasks.clear();
        pdfSplitLoadedDocs.forEach(({ doc }) => { try { doc.destroy(); } catch (_) {} });
        pdfSplitLoadedDocs = [];
        pdfSplitPagesData.forEach(({ canvas }) => {
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
        });
        pdfSplitPagesData = [];
        if (pdfSplitPageStrip) pdfSplitPageStrip.replaceChildren();
      }

      function setPdfSplitProgress(percent, message) {
        if (pdfSplitProcessBarFill) pdfSplitProcessBarFill.style.width = `${percent}%`;
        if (message && pdfSplitProcessText) pdfSplitProcessText.textContent = message;
      }

      function assertPdfSplitRun(runId) {
        if (runId !== pdfSplitRunId) throw new Error('PDF split operation cancelled');
      }

      function isPdfPasswordError(error) {
        return error?.name === 'PasswordException' || /password|encrypted/i.test(String(error?.message || error));
      }

      async function preflightPdfSplitFiles() {
        const { PDF_SPLIT_LIMITS, assertPdfSplitSelection } = await import('./pdf-split-core.js');
        let totalBytes = 0;
        if (isTauri) {
          const { invoke } = await import('@tauri-apps/api/core');
          for (const file of selectedPdfSplitFiles) {
            if (!file.path) throw new Error(`Missing path for ${file.name}`);
            totalBytes += Number(await invoke('get_file_size', { path: file.path }));
          }
        } else {
          totalBytes = selectedPdfSplitFiles.reduce((sum, file) => sum + Number(file.size || 0), 0);
        }
        assertPdfSplitSelection(selectedPdfSplitFiles, totalBytes, PDF_SPLIT_LIMITS);
        return PDF_SPLIT_LIMITS;
      }

      async function readPdfSplitFileData(file) {
        if (isTauri && file.path) {
          const { invoke } = await import('@tauri-apps/api/core');
          const bytes = await invoke('read_file_bytes', { path: file.path });
          if (Array.isArray(bytes)) return Uint8Array.from(bytes);
          if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
          if (bytes instanceof Uint8Array) return bytes;
          if (bytes && typeof bytes.length === 'number') return Uint8Array.from(bytes);
          throw new Error(`Invalid file data for ${file.name}`);
        }
        return new Uint8Array(await file.arrayBuffer());
      }

      async function getPdfSplitOutputDir() {
        return getOutputDir('PDF_Split');
      }

      if (pdfSplitProcessBtn) {
        pdfSplitProcessBtn.addEventListener('click', async () => {
          if (selectedPdfSplitFiles.length < 1 || pdfSplitProcessing || pdfSplitSaving) return;
          const runId = ++pdfSplitRunId;
          pdfSplitActiveRunId = runId;
          pdfSplitProcessing = true;
          if (pdfSplitProcessMask) pdfSplitProcessMask.classList.add('visible');
          setPdfSplitProgress(5, t('home.pdfSplit.processing'));

          try {
            releasePdfSplitPreviewResources();
            const limits = await preflightPdfSplitFiles();
            assertPdfSplitRun(runId);
            const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
            pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

            let totalPages = 0;
            for (let fileIndex = 0; fileIndex < selectedPdfSplitFiles.length; fileIndex++) {
              assertPdfSplitRun(runId);
              const file = selectedPdfSplitFiles[fileIndex];
              setPdfSplitProgress(
                Math.round(((fileIndex + 0.2) / selectedPdfSplitFiles.length) * 100),
                `${t('home.pdfSplit.processing')} (${fileIndex + 1}/${selectedPdfSplitFiles.length})`
              );
              const fileData = await readPdfSplitFileData(file);
              if (!fileData.length) throw new Error(`File ${file.name} is empty`);
              assertPdfSplitRun(runId);

              const wasmUrl = new URL('assets/', document.baseURI).href;
              const loadingTask = pdfjsLib.getDocument({ data: fileData.slice(), wasmUrl, useWasm: true });
              pdfSplitLoadingTasks.add(loadingTask);
              let pdfDoc;
              try {
                pdfDoc = await loadingTask.promise;
              } finally {
                pdfSplitLoadingTasks.delete(loadingTask);
              }
              assertPdfSplitRun(runId);
              totalPages += pdfDoc.numPages;
              if (totalPages > limits.maxPreviewPages) {
                try { await pdfDoc.destroy(); } catch (_) {}
                throw new Error(t('home.pdfSplit.tooManyPages'));
              }
              pdfSplitLoadedDocs.push({ doc: pdfDoc, fileData, fileName: file.name });

              for (let pageIndex = 1; pageIndex <= pdfDoc.numPages; pageIndex++) {
                assertPdfSplitRun(runId);
                const page = await pdfDoc.getPage(pageIndex);
                const viewport = page.getViewport({ scale: 1 });
                const scale = 240 / viewport.width;
                const scaledViewport = page.getViewport({ scale });
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                if (!context) throw new Error(`Cannot create a preview for ${file.name}`);
                canvas.width = scaledViewport.width;
                canvas.height = scaledViewport.height;
                await page.render({ canvasContext: context, viewport: scaledViewport }).promise;
                assertPdfSplitRun(runId);
                pdfSplitPagesData.push({ fileIndex, pageIndex, canvas, selected: true });
              }
            }

            assertPdfSplitRun(runId);
            setPdfSplitProgress(100, t('home.pdfSplit.processing'));
            renderSplitPreviewPages();
            openPdfSplitWorkspace();
          } catch (error) {
            const cancelled = runId !== pdfSplitRunId;
            if (!cancelled) {
              console.error('PDF split preview error:', error);
              releasePdfSplitPreviewResources();
              const message = isPdfPasswordError(error)
                ? t('home.pdfSplit.passwordProtected')
                : String(error?.message || error) === t('home.pdfSplit.tooManyPages')
                  ? t('home.pdfSplit.tooManyPages')
                  : t('common.errorOccurred', { error: String(error) });
              alert(message);
            }
          } finally {
            if (pdfSplitActiveRunId === runId) {
              pdfSplitActiveRunId = 0;
              pdfSplitProcessing = false;
            }
            if (runId === pdfSplitRunId) {
              if (pdfSplitProcessMask) pdfSplitProcessMask.classList.remove('visible');
              setPdfSplitProgress(0);
            }
          }
        });
      }

      function updatePdfSplitSelectionControls() {
        const selectedCount = pdfSplitPagesData.filter(page => page.selected).length;
        const allSelected = selectedCount > 0 && selectedCount === pdfSplitPagesData.length;
        if (pdfSplitWorkspaceStatus) {
          pdfSplitWorkspaceStatus.textContent = t('home.pdfSplit.inputStatus', {
            count: selectedPdfSplitFiles.length
          });
        }
        if (pdfSplitWorkspaceHint) {
          pdfSplitWorkspaceHint.textContent = t('home.pdfSplit.drawerHint');
        }
        if (pdfSplitSelectedCount) {
          pdfSplitSelectedCount.textContent = t('home.pdfSplit.selectedCount', { count: selectedCount });
        }
        if (pdfSplitSelectionMeta) {
          pdfSplitSelectionMeta.textContent = t('home.pdfSplit.selectionStatus', {
            selected: selectedCount,
            total: pdfSplitPagesData.length
          });
        }
        if (pdfSplitSelectAllBtn) {
          pdfSplitSelectAllBtn.textContent = t(allSelected ? 'home.pdfSplit.clearSelection' : 'home.pdfSplit.selectAll');
          pdfSplitSelectAllBtn.disabled = pdfSplitSaving || pdfSplitPagesData.length === 0;
        }
        if (pdfSplitDownloadAllBtn) {
          pdfSplitDownloadAllBtn.textContent = t('home.pdfSplit.downloadSelected');
          pdfSplitDownloadAllBtn.disabled = pdfSplitSaving || selectedCount === 0;
        }
      }

      function renderSplitPreviewPages() {
        if (!pdfSplitPageStrip) return;
        const pageFragment = document.createDocumentFragment();

        pdfSplitPagesData.forEach((pageData, index) => {
          const pageEl = document.createElement('article');
          pageEl.className = 'pdf-page-workspace-tile pdf-split-workspace-tile';
          pageEl.dataset.index = String(index);

          const selectBtn = document.createElement('button');
          selectBtn.type = 'button';
          selectBtn.className = 'pdf-page-workspace-page-select';
          selectBtn.setAttribute('aria-label', `${t('home.pdfSplit.pageLabel')} ${index + 1}`);

          const setSelected = (selected) => {
            pageData.selected = selected;
            pageEl.classList.toggle('is-selected', selected);
            selectBtn.setAttribute('aria-pressed', String(selected));
            updatePdfSplitSelectionControls();
          };
          setSelected(pageData.selected);
          selectBtn.addEventListener('click', () => setSelected(!pageData.selected));

          const canvas = pageData.canvas;
          const previewFrame = document.createElement('span');
          previewFrame.className = 'pdf-page-workspace-frame';
          previewFrame.appendChild(canvas);

          const indexLabel = document.createElement('span');
          indexLabel.className = 'pdf-page-workspace-index';
          indexLabel.textContent = `${index + 1}`;
          previewFrame.appendChild(indexLabel);

          const check = document.createElement('span');
          check.className = 'pdf-page-workspace-check';
          check.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.2 4.2L19 6.8"></path></svg>';
          selectBtn.append(previewFrame, check);

          const actionGroup = document.createElement('div');
          actionGroup.className = 'pdf-page-workspace-tile-actions';
          const downloadBtn = document.createElement('button');
          downloadBtn.className = 'pdf-page-workspace-icon-button';
          downloadBtn.type = 'button';
          downloadBtn.title = t('home.pdfSplit.downloadPage');
          downloadBtn.setAttribute('aria-label', t('home.pdfSplit.downloadPage'));
          downloadBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
          downloadBtn.addEventListener('click', async (event) => {
            event.stopPropagation();
            await downloadSingleSplitPage(index);
          });
          actionGroup.appendChild(downloadBtn);
          pageEl.append(selectBtn, actionGroup);
          pageFragment.appendChild(pageEl);
        });
        pdfSplitPageStrip.replaceChildren(pageFragment);
        updatePdfSplitSelectionControls();
      }

      async function savePdfSplitPages(pages) {
        const { splitPdfPages } = await import('./pdf-split-core.js');
        const savedPaths = [];
        const failures = [];
        const outputDir = isTauri ? await getPdfSplitOutputDir() : '~/Downloads';
        let invoke = null;
        if (isTauri) ({ invoke } = await import('@tauri-apps/api/core'));

        await splitPdfPages({
          documents: pdfSplitLoadedDocs,
          pages,
          onProgress: async ({ completed, total, output }) => {
            setPdfSplitProgress(Math.round((completed / total) * 100), t('home.pdfSplit.saving'));
            try {
              if (isTauri) {
                const outputPath = await invoke('write_unique_file_bytes', {
                  directory: outputDir,
                  fileName: output.fileName,
                  bytes: Array.from(output.bytes)
                });
                savedPaths.push(outputPath);
              } else {
                const blob = new Blob([output.bytes], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = output.fileName;
                anchor.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                savedPaths.push(`${outputDir}/${output.fileName}`);
              }
            } catch (error) {
              console.error('[PDF Split] Output write error:', error);
              failures.push(error);
            }
          }
        });
        return { outputDir, savedPaths, failures };
      }

      async function downloadSingleSplitPage(pageIndex) {
        if (pdfSplitSaving || pageIndex < 0 || pageIndex >= pdfSplitPagesData.length) return;
        pdfSplitSaving = true;
        updatePdfSplitSelectionControls();
        if (pdfSplitProcessMask) pdfSplitProcessMask.classList.add('visible');
        setPdfSplitProgress(10, t('home.pdfSplit.saving'));
        try {
          const result = await savePdfSplitPages([pdfSplitPagesData[pageIndex]]);
          if (result.savedPaths.length === 1) showPdfSplitSuccess(result.outputDir, 'single', 1);
          else throw result.failures[0] || new Error('No PDF page was saved');
        } catch (error) {
          console.error('[PDF Split] Single page save error:', error);
          alert(t('common.errorOccurred', { error: String(error) }));
        } finally {
          pdfSplitSaving = false;
          if (pdfSplitProcessMask) pdfSplitProcessMask.classList.remove('visible');
          setPdfSplitProgress(0);
          updatePdfSplitSelectionControls();
        }
      }

      if (pdfSplitDownloadAllBtn) {
        pdfSplitDownloadAllBtn.addEventListener('click', async () => {
          const pages = pdfSplitPagesData.filter(page => page.selected);
          if (pdfSplitSaving || pages.length === 0) return;
          pdfSplitSaving = true;
          updatePdfSplitSelectionControls();
          if (pdfSplitProcessMask) pdfSplitProcessMask.classList.add('visible');
          setPdfSplitProgress(0, t('home.pdfSplit.saving'));
          try {
            const result = await savePdfSplitPages(pages);
            if (result.savedPaths.length === 0) throw result.failures[0] || new Error('No PDF pages were saved');
            closePdfSplitWorkspace(true);
            showPdfSplitSuccess(result.outputDir, 'all', result.savedPaths.length, result.failures.length);
          } catch (error) {
            console.error('[PDF Split] Batch save error:', error);
            alert(t('common.errorOccurred', { error: String(error) }));
          } finally {
            pdfSplitSaving = false;
            if (pdfSplitProcessMask) pdfSplitProcessMask.classList.remove('visible');
            setPdfSplitProgress(0);
            updatePdfSplitSelectionControls();
          }
        });
      }

      if (pdfSplitSelectAllBtn) {
        pdfSplitSelectAllBtn.addEventListener('click', () => {
          if (pdfSplitSaving || pdfSplitPagesData.length === 0) return;
          const shouldSelect = pdfSplitPagesData.some(page => !page.selected);
          pdfSplitPagesData.forEach(page => { page.selected = shouldSelect; });
          renderSplitPreviewPages();
        });
      }

      function openPdfSplitWorkspace() {
        if (!pdfSplitWorkspace) return;
        pdfSplitWorkspace.classList.add('visible');
        pdfSplitWorkspace.setAttribute('aria-hidden', 'false');
      }

      function closePdfSplitWorkspace(force = false) {
        if (pdfSplitSaving && !force) return;
        if (pdfSplitWorkspace) {
          pdfSplitWorkspace.classList.remove('visible');
          pdfSplitWorkspace.setAttribute('aria-hidden', 'true');
        }
        releasePdfSplitPreviewResources();
      }

      if (pdfSplitWorkspaceClose) pdfSplitWorkspaceClose.addEventListener('click', () => closePdfSplitWorkspace());

      function showPdfSplitSuccess(saveFolder, type, count, failedCount = 0) {
        lastPdfSplitSavedFolder = saveFolder;
        if (pdfSplitSuccessCount) pdfSplitSuccessCount.textContent = String(count);
        if (pdfSplitSuccessPath) pdfSplitSuccessPath.textContent = saveFolder.replace(/\//g, '\\');
        if (pdfSplitSuccessMeta) {
          pdfSplitSuccessMeta.textContent = failedCount > 0
            ? t('home.pdfSplit.partialSave', { saved: count, failed: failedCount })
            : t(type === 'all' ? 'home.pdfSplit.successAllMeta' : 'home.pdfSplit.successSingleMeta', { count });
        }
        if (pdfSplitSuccessOverlay) pdfSplitSuccessOverlay.classList.add('visible');
      }

      if (pdfSplitSuccessOk) {
        pdfSplitSuccessOk.addEventListener('click', () => {
          if (pdfSplitSuccessOverlay) pdfSplitSuccessOverlay.classList.remove('visible');
          closePdfSplitWorkspace(true);
          clearPdfSplitFiles();
        });
      }
      if (pdfSplitSuccessOpenFolder) {
        pdfSplitSuccessOpenFolder.addEventListener('click', async () => {
          if (isTauri && lastPdfSplitSavedFolder) {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              await invoke('open_path', { path: lastPdfSplitSavedFolder });
            } catch (error) {
              console.error('[PDF Split] Open folder error:', error);
            }
          }
        });
      }

      function closePdfSplitOverlayFull() {
        if (pdfSplitSaving) {
          window.showToast(t('home.pdfSplit.saving'));
          return;
        }
        pdfSplitRunId++;
        closePdfSplitOverlay();
        if (pdfSplitProcessMask) pdfSplitProcessMask.classList.remove('visible');
        setPdfSplitProgress(0);
        clearPdfSplitFiles();
        closePdfSplitWorkspace(true);
      }
      if (pdfSplitBack) {
        pdfSplitBack.removeEventListener('click', closePdfSplitOverlay);
        pdfSplitBack.addEventListener('click', closePdfSplitOverlayFull);
      }

      // ===== PDF Rotate Overlay Open/Close =====
      const pdfRotateOverlay = document.getElementById('pdfRotateOverlay');
      const pdfRotateFerrofluid = document.getElementById('pdfRotateFerrofluid');
      const pdfRotateBack = document.getElementById('pdfRotateBack');
      let pdfRotateFerrofluidInstance = null;

      function openPdfRotateOverlay() {
        if (!pdfRotateOverlay) return;
        pdfRotateOverlay.classList.add('visible');
        if (pdfRotateFerrofluid && !pdfRotateFerrofluidInstance) {
          pdfRotateFerrofluidInstance = initFerrofluid(pdfRotateFerrofluid, {
            colors: ['#e8e8ec', '#a0a0a8', '#ffffff'],
            speed: 0.3,
            scale: 2,
            opacity: 0.6,
          });
        }
      }

      function closePdfRotateOverlay() {
        if (!pdfRotateOverlay) return;
        pdfRotateOverlay.classList.remove('visible');
        if (pdfRotateFerrofluidInstance) {
          pdfRotateFerrofluidInstance();
          pdfRotateFerrofluidInstance = null;
        }
      }

      if (pdfRotateBack) {
        pdfRotateBack.addEventListener('click', closePdfRotateOverlay);
      }

      document.querySelectorAll('.audio-list-item[data-tool="pdf-rotate"]').forEach(item => {
        item.addEventListener('click', () => {
          openPdfRotateOverlay();
        });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPdfRotateOverlay();
          }
        });
      });

      // ===== PDF Rotate Interaction =====
      const pdfRotateDropZone = document.getElementById('pdfRotateDropZone');
      const pdfRotateFiles = document.getElementById('pdfRotateFiles');
      const pdfRotateCta = document.getElementById('pdfRotateCta');
      const pdfRotateInput = document.getElementById('pdfRotateInput');
      const pdfRotateProcessBtn = document.getElementById('pdfRotateProcessBtn');
      const pdfRotateProcessMask = document.getElementById('pdfRotateProcessMask');
      const pdfRotateProcessBarFill = document.getElementById('pdfRotateProcessBarFill');
      const pdfRotateProcessText = document.getElementById('pdfRotateProcessText');
      const pdfRotateSuccessOverlay = document.getElementById('pdfRotateSuccessOverlay');
      const pdfRotateSuccessPath = document.getElementById('pdfRotateSuccessPath');
      const pdfRotateSuccessMeta = document.getElementById('pdfRotateSuccessMeta');
      const pdfRotateSuccessCount = document.getElementById('pdfRotateSuccessCount');
      const pdfRotateSuccessOpenFolder = document.getElementById('pdfRotateSuccessOpenFolder');
      const pdfRotateSuccessOk = document.getElementById('pdfRotateSuccessOk');
      const pdfRotateWorkspace = document.getElementById('pdfRotateWorkspace');
      const pdfRotateWorkspaceClose = document.getElementById('pdfRotateWorkspaceClose');
      const pdfRotateWorkspaceStatus = document.getElementById('pdfRotateWorkspaceStatus');
      const pdfRotateWorkspaceFileName = document.getElementById('pdfRotateWorkspaceFileName');
      const pdfRotatePageCount = document.getElementById('pdfRotatePageCount');
      const pdfRotatePageStrip = document.getElementById('pdfRotatePageStrip');
      const pdfRotateWorkspaceFooterStatus = document.getElementById('pdfRotateWorkspaceFooterStatus');
      const pdfRotateDownloadAllBtn = document.getElementById('pdfRotateDownloadAllBtn');
      const pdfRotateRotateAllBtn = document.getElementById('pdfRotateRotateAllBtn');

      let selectedPdfRotateFiles = [];
      let pdfRotateProcessing = false;
      let pdfRotateSaving = false;
      let pdfRotateRunId = 0;
      let pdfRotateActiveRunId = 0;
      let pdfRotateLoadingTask = null;
      let lastPdfRotateSavedPath = '';
      let pdfRotateLoadedDoc = null;  // { doc, fileData, fileName }
      let pdfRotatePagesData = [];    // [{ pageIndex, canvas, rotation, fileName }]

      function releasePdfRotatePreviewResources() {
        if (pdfRotateLoadingTask) {
          try { pdfRotateLoadingTask.destroy(); } catch (_) {}
          pdfRotateLoadingTask = null;
        }
        if (pdfRotateLoadedDoc) {
          try { pdfRotateLoadedDoc.doc.destroy(); } catch (_) {}
          pdfRotateLoadedDoc = null;
        }
        pdfRotatePagesData.forEach(({ canvas }) => {
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
        });
        pdfRotatePagesData = [];
        if (pdfRotatePageStrip) pdfRotatePageStrip.replaceChildren();
      }

      function setPdfRotateProgress(percent, message) {
        if (pdfRotateProcessBarFill) pdfRotateProcessBarFill.style.width = `${percent}%`;
        if (message && pdfRotateProcessText) pdfRotateProcessText.textContent = message;
      }

      function assertPdfRotateRun(runId) {
        if (runId !== pdfRotateRunId) throw new Error('PDF rotate operation cancelled');
      }

      function isPdfRotatePasswordError(error) {
        return error?.name === 'PasswordException' || /password|encrypted/i.test(String(error?.message || error));
      }

      function formatPdfRotateError(error) {
        if (isPdfRotatePasswordError(error)) return t('home.pdfRotate.passwordProtected');
        const message = String(error?.message || error);
        if (/rotation limit/.test(message) && /MB/.test(message)) return t('home.pdfRotate.fileTooLarge');
        if (/rotation limit/.test(message) && /page/.test(message)) return t('home.pdfRotate.tooManyPages');
        return message;
      }

      async function preflightPdfRotateFile() {
        const { PDF_ROTATE_LIMITS, assertPdfRotateSelection } = await import('./pdf-rotate-core.js');
        const file = selectedPdfRotateFiles[0];
        if (!file) throw new Error('No PDF file is selected');
        const totalBytes = isTauri && file.path
          ? Number(await (await import('@tauri-apps/api/core')).invoke('get_file_size', { path: file.path }))
          : Number(file.size || 0);
        assertPdfRotateSelection(selectedPdfRotateFiles, totalBytes, PDF_ROTATE_LIMITS);
        return PDF_ROTATE_LIMITS;
      }

      async function readPdfRotateFileData(file) {
        if (isTauri && file.path) {
          const { invoke } = await import('@tauri-apps/api/core');
          const bytes = await invoke('read_file_bytes', { path: file.path });
          if (Array.isArray(bytes)) return Uint8Array.from(bytes);
          if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
          if (bytes instanceof Uint8Array) return bytes;
          if (bytes && typeof bytes.length === 'number') return Uint8Array.from(bytes);
          throw new Error(`Invalid file data for ${file.name}`);
        }
        return new Uint8Array(await file.arrayBuffer());
      }

      async function getPdfRotateOutputDir() {
        return getOutputDir('PDF_Rotate');
      }

      function addPdfRotateFiles(fileList) {
        if (!fileList || fileList.length === 0) return;
        if (pdfRotateProcessing || pdfRotateSaving) return;
        // Single file only — replace if exists
        if (fileList.length > 1) {
          alert(t('home.pdfRotate.singleFileOnly'));
          return;
        }
        const file = fileList[0];
        selectedPdfRotateFiles = [file]; // Always replace, only 1 file allowed
        renderPdfRotateFiles();
      }

      function clearPdfRotateFiles() {
        selectedPdfRotateFiles = [];
        renderPdfRotateFiles();
      }

      function renderPdfRotateFiles() {
        if (!pdfRotateFiles) return;
        pdfRotateFiles.innerHTML = '';
        if (selectedPdfRotateFiles.length > 0) {
          pdfRotateFiles.classList.add('has-files');
        } else {
          pdfRotateFiles.classList.remove('has-files');
        }
        selectedPdfRotateFiles.forEach((file, index) => {
          const item = document.createElement('div');
          item.className = 'audio-convert-file-item';
          item.dataset.index = index;
          item.innerHTML = `
            <span class="audio-convert-file-index">${index + 1}</span>
            <span class="audio-convert-file-name">${escapeHtml(file.name)}</span>
            <button class="audio-convert-file-remove" data-index="${index}" aria-label="remove">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          `;
          pdfRotateFiles.appendChild(item);
        });
        pdfRotateFiles.querySelectorAll('.audio-convert-file-remove').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearPdfRotateFiles();
          });
        });
        togglePdfRotateProcessButton();
      }

      function togglePdfRotateProcessButton() {
        if (!pdfRotateProcessBtn) return;
        if (selectedPdfRotateFiles.length >= 1) {
          pdfRotateProcessBtn.style.display = '';
          requestAnimationFrame(() => pdfRotateProcessBtn.classList.add('visible'));
        } else {
          pdfRotateProcessBtn.classList.remove('visible');
          const onTransitionEnd = (e) => {
            if (e.propertyName === 'opacity' && !pdfRotateProcessBtn.classList.contains('visible')) {
              pdfRotateProcessBtn.style.display = 'none';
              pdfRotateProcessBtn.removeEventListener('transitionend', onTransitionEnd);
            }
          };
          pdfRotateProcessBtn.addEventListener('transitionend', onTransitionEnd);
        }
      }

      function showPdfRotateDropZone() {
        if (pdfRotateDropZone) pdfRotateDropZone.classList.add('visible');
        if (pdfRotateOverlay) pdfRotateOverlay.classList.add('drag-over');
      }

      function hidePdfRotateDropZone() {
        if (pdfRotateDropZone) pdfRotateDropZone.classList.remove('visible');
        if (pdfRotateOverlay) pdfRotateOverlay.classList.remove('drag-over');
      }

      // Tauri native drag-drop
      if (isTauri && pdfRotateOverlay) {
        (async () => {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          const webview = getCurrentWebview();
          await webview.onDragDropEvent((event) => {
            if (!pdfRotateOverlay.classList.contains('visible') || pdfRotateProcessing || pdfRotateSaving) return;
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') {
              showPdfRotateDropZone();
            } else if (payload.type === 'leave') {
              hidePdfRotateDropZone();
            } else if (payload.type === 'drop') {
              hidePdfRotateDropZone();
              const paths = payload.paths || [];
              if (paths.length === 0) return;
              const fileList = paths
                .filter(p => p.toLowerCase().endsWith('.pdf'))
                .map(path => ({ name: path.split(/[\\/]/).pop() || path, path, size: 0 }));
              if (fileList.length > 0) {
                addPdfRotateFiles(fileList);
              }
            }
          });
        })();
      }

      // CTA button — open file dialog
      if (pdfRotateCta) {
        pdfRotateCta.addEventListener('click', async () => {
          if (pdfRotateProcessing || pdfRotateSaving) return;
          if (isTauri) {
            try {
              const { open } = await import('@tauri-apps/plugin-dialog');
              const selected = await open({
                multiple: false,
                filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
              });
              if (selected && typeof selected === 'string') {
                addPdfRotateFiles([{ name: selected.split(/[\\/]/).pop() || selected, path: selected, size: 0 }]);
              }
            } catch (e) {
              console.error('PDF rotate file selection error', e);
            }
          } else {
            pdfRotateInput?.click();
          }
        });
      }
      if (pdfRotateInput) {
        pdfRotateInput.addEventListener('change', () => {
          addPdfRotateFiles(pdfRotateInput.files);
          pdfRotateInput.value = '';
        });
      }

      // ===== PDF Rotate: Real Implementation =====
      // Process button — load PDF and render previews
      if (pdfRotateProcessBtn) {
        pdfRotateProcessBtn.addEventListener('click', async () => {
          if (selectedPdfRotateFiles.length < 1 || pdfRotateProcessing || pdfRotateSaving) return;
          const runId = ++pdfRotateRunId;
          pdfRotateActiveRunId = runId;
          pdfRotateProcessing = true;
          if (pdfRotateProcessMask) pdfRotateProcessMask.classList.add('visible');
          setPdfRotateProgress(5, t('home.pdfRotate.processing'));

          try {
            releasePdfRotatePreviewResources();
            const limits = await preflightPdfRotateFile();
            assertPdfRotateRun(runId);

            // Configure pdf.js worker
            const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
            pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

            const file = selectedPdfRotateFiles[0];

            const fileData = await readPdfRotateFileData(file);
            if (!fileData.length) throw new Error(`File ${file.name} is empty`);
            assertPdfRotateRun(runId);

            // Load with pdfjs for preview
            const _wasmUrl = new URL('assets/', document.baseURI).href;
            const loadingTask = pdfjsLib.getDocument({ data: fileData.slice(), wasmUrl: _wasmUrl, useWasm: true });
            pdfRotateLoadingTask = loadingTask;
            let pdfDoc;
            try {
              pdfDoc = await loadingTask.promise;
            } finally {
              if (pdfRotateLoadingTask === loadingTask) pdfRotateLoadingTask = null;
            }
            assertPdfRotateRun(runId);

            // Check page limit
            const { assertPdfRotatePageCount } = await import('./pdf-rotate-core.js');
            try {
              assertPdfRotatePageCount(pdfDoc.numPages, limits);
            } catch (limitError) {
              try { pdfDoc.destroy(); } catch (_) {}
              throw limitError;
            }

            pdfRotateLoadedDoc = { doc: pdfDoc, fileData, fileName: file.name };

            setPdfRotateProgress(10, t('home.pdfRotate.processing'));

            // Render each page to canvas
            for (let pi = 1; pi <= pdfDoc.numPages; pi++) {
              assertPdfRotateRun(runId);
              const renderProgress = 10 + Math.round((pi / pdfDoc.numPages) * 90);
              setPdfRotateProgress(renderProgress, t('home.pdfRotate.processing'));
              try {
                const page = await pdfDoc.getPage(pi);
                const viewport = page.getViewport({ scale: 1 });
                const targetWidth = 240;
                const scale = targetWidth / viewport.width;
                const scaledViewport = page.getViewport({ scale });

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error(`Cannot create a preview for ${file.name}`);
                canvas.width = scaledViewport.width;
                canvas.height = scaledViewport.height;
                await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
                page.cleanup();
                assertPdfRotateRun(runId);

                pdfRotatePagesData.push({
                  pageIndex: pi,
                  fileName: file.name,
                  canvas,
                  rotation: 0
                });
              } catch (renderErr) {
                throw new Error(`Failed to render page ${pi}: ${renderErr?.message || renderErr}`);
              }
            }

            assertPdfRotateRun(runId);
            setPdfRotateProgress(100, t('home.pdfRotate.processing'));
            await new Promise(r => setTimeout(r, 300));
            assertPdfRotateRun(runId);

            renderRotatePreviewPages();
            openPdfRotateWorkspace();
          } catch (e) {
            console.error('PDF rotate error:', e);
            if (runId === pdfRotateRunId) {
              releasePdfRotatePreviewResources();
              if (!/cancelled/i.test(String(e?.message || e))) {
                alert(t('common.errorOccurred', { error: formatPdfRotateError(e) }));
              }
            }
          } finally {
            if (pdfRotateActiveRunId === runId) {
              pdfRotateProcessing = false;
              if (pdfRotateProcessMask) pdfRotateProcessMask.classList.remove('visible');
              setPdfRotateProgress(0);
            }
          }
        });
      }

      function renderRotatePreviewPages() {
        if (!pdfRotatePageStrip) return;
        const pageFragment = document.createDocumentFragment();

        pdfRotatePagesData.forEach((pageData, idx) => {
          const pageEl = document.createElement('article');
          pageEl.className = 'pdf-page-workspace-tile pdf-rotate-workspace-tile';
          pageEl.dataset.index = idx;

          const canvas = pageData.canvas;
          const previewFrame = document.createElement('div');
          previewFrame.className = 'pdf-page-workspace-frame';
          const previewStage = document.createElement('div');
          previewStage.className = 'pdf-page-workspace-rotate-stage';
          pageData.previewStage = previewStage;
          canvas.style.transition = 'transform 0.2s ease';
          previewStage.appendChild(canvas);
          previewFrame.appendChild(previewStage);
          updatePdfRotatePreviewRotation(pageData);

          const indexLabel = document.createElement('span');
          indexLabel.className = 'pdf-page-workspace-index';
          indexLabel.textContent = `${idx + 1}`;
          previewFrame.appendChild(indexLabel);

          const btnContainer = document.createElement('div');
          btnContainer.className = 'pdf-page-workspace-tile-actions';

          const rotateBtn = document.createElement('button');
          rotateBtn.className = 'pdf-page-workspace-icon-button';
          rotateBtn.type = 'button';
          rotateBtn.title = t('home.pdfRotate.rotatePage');
          rotateBtn.setAttribute('aria-label', t('home.pdfRotate.rotatePage'));
          rotateBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';
          rotateBtn.addEventListener('click', () => {
            pageData.rotation = (pageData.rotation + 90) % 360;
            updatePdfRotatePreviewRotation(pageData);
          });
          btnContainer.appendChild(rotateBtn);

          const downloadBtn = document.createElement('button');
          downloadBtn.className = 'pdf-page-workspace-icon-button';
          downloadBtn.type = 'button';
          downloadBtn.title = t('home.pdfRotate.downloadPage');
          downloadBtn.setAttribute('aria-label', t('home.pdfRotate.downloadPage'));
          downloadBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
          downloadBtn.addEventListener('click', async () => {
            await downloadSingleRotatePage(idx);
          });
          btnContainer.appendChild(downloadBtn);

          pageEl.append(previewFrame, btnContainer);
          pageFragment.appendChild(pageEl);
        });
        pdfRotatePageStrip.replaceChildren(pageFragment);
        updatePdfRotateWorkspaceControls();

        if (pdfRotateDownloadAllBtn) {
          pdfRotateDownloadAllBtn.textContent = t('home.pdfRotate.downloadAll');
        }
        if (pdfRotateRotateAllBtn) {
          pdfRotateRotateAllBtn.textContent = t('home.pdfRotate.rotateAll');
        }
      }

      function updatePdfRotateWorkspaceControls() {
        const pageCount = pdfRotatePagesData.length;
        if (pdfRotateWorkspaceStatus) {
          pdfRotateWorkspaceStatus.textContent = t('home.pdfRotate.pageCount', { count: pageCount });
        }
        if (pdfRotateWorkspaceFileName) {
          pdfRotateWorkspaceFileName.textContent = pdfRotateLoadedDoc?.fileName || '';
        }
        if (pdfRotatePageCount) {
          pdfRotatePageCount.textContent = t('home.pdfRotate.pageCount', { count: pageCount });
        }
        if (pdfRotateWorkspaceFooterStatus) {
          pdfRotateWorkspaceFooterStatus.textContent = t('home.pdfRotate.workspaceHint');
        }
      }

      function updatePdfRotatePreviewRotation(pageData) {
        const { canvas, previewStage, rotation } = pageData;
        if (!canvas || !previewStage || !canvas.width || !canvas.height) return;
        const isQuarterTurn = rotation % 180 !== 0;
        previewStage.style.aspectRatio = isQuarterTurn
          ? `${canvas.height} / ${canvas.width}`
          : `${canvas.width} / ${canvas.height}`;
        canvas.style.setProperty(
          'width',
          isQuarterTurn ? `${(canvas.width / canvas.height) * 100}%` : '100%',
          'important'
        );
        canvas.style.setProperty('max-width', 'none', 'important');
        canvas.style.transform = `rotate(${rotation}deg)`;
      }

      // Rotate all pages 90°
      if (pdfRotateRotateAllBtn) {
        pdfRotateRotateAllBtn.addEventListener('click', () => {
          if (pdfRotateSaving) return;
          pdfRotatePagesData.forEach(pageData => {
            pageData.rotation = (pageData.rotation + 90) % 360;
            updatePdfRotatePreviewRotation(pageData);
          });
        });
      }

      function setPdfRotateSaving(saving) {
        pdfRotateSaving = saving;
        [pdfRotateDownloadAllBtn, pdfRotateRotateAllBtn].forEach(button => {
          if (button) button.disabled = saving;
        });
        if (pdfRotateWorkspaceClose) pdfRotateWorkspaceClose.disabled = saving;
        pdfRotatePageStrip?.querySelectorAll('.pdf-page-workspace-icon-button').forEach(button => {
          button.disabled = saving;
        });
      }

      async function savePdfRotateBytes(bytes, fileName) {
        if (isTauri) {
          const { invoke } = await import('@tauri-apps/api/core');
          return invoke('write_unique_file_bytes', {
            directory: await getPdfRotateOutputDir(),
            fileName,
            bytes: Array.from(bytes)
          });
        }

        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        return `~/Downloads/${fileName}`;
      }

      async function downloadSingleRotatePage(pageIdx) {
        if (pageIdx < 0 || pageIdx >= pdfRotatePagesData.length) return;
        if (!pdfRotateLoadedDoc?.fileData) {
          alert(t('common.fileDataMissing'));
          return;
        }
        if (pdfRotateProcessing || pdfRotateSaving) return;

        const pageData = pdfRotatePagesData[pageIdx];
        setPdfRotateSaving(true);
        if (pdfRotateProcessMask) pdfRotateProcessMask.classList.add('visible');
        setPdfRotateProgress(15, t('home.pdfRotate.saving'));
        try {
          const { createPdfRotateFileName, rotatePdfPages } = await import('./pdf-rotate-core.js');
          const singlePageBytes = await rotatePdfPages({
            fileData: pdfRotateLoadedDoc.fileData,
            pages: [{ pageIndex: pageData.pageIndex, rotation: pageData.rotation }],
            onProgress: () => setPdfRotateProgress(85, t('home.pdfRotate.saving'))
          });
          const fileName = createPdfRotateFileName(pageData.fileName, pageData.pageIndex);
          const savedPath = await savePdfRotateBytes(singlePageBytes, fileName);
          showPdfRotateSuccess(savedPath, 'single', 1);
        } catch (e) {
          console.error('[PDF Rotate] Single page save error:', e);
          alert(t('common.errorOccurred', { error: formatPdfRotateError(e) }));
        } finally {
          if (pdfRotateProcessMask) pdfRotateProcessMask.classList.remove('visible');
          setPdfRotateProgress(0);
          setPdfRotateSaving(false);
        }
      }

      // Download all — export all pages as a single PDF with rotation applied
      if (pdfRotateDownloadAllBtn) {
        pdfRotateDownloadAllBtn.addEventListener('click', async () => {
          if (pdfRotatePagesData.length === 0) return;
          if (!pdfRotateLoadedDoc?.fileData) return;
          if (pdfRotateProcessing || pdfRotateSaving) return;
          setPdfRotateSaving(true);
          if (pdfRotateProcessMask) pdfRotateProcessMask.classList.add('visible');
          setPdfRotateProgress(5, t('home.pdfRotate.saving'));

          try {
            const { createPdfRotateFileName, rotatePdfPages } = await import('./pdf-rotate-core.js');
            const totalPages = pdfRotatePagesData.length;
            const outputBytes = await rotatePdfPages({
              fileData: pdfRotateLoadedDoc.fileData,
              pages: pdfRotatePagesData.map(({ pageIndex, rotation }) => ({ pageIndex, rotation })),
              onProgress: ({ completed, total }) => setPdfRotateProgress(
                10 + Math.round((completed / total) * 80),
                t('home.pdfRotate.saving')
              )
            });
            const fileName = createPdfRotateFileName(pdfRotateLoadedDoc.fileName);
            const savedPath = await savePdfRotateBytes(outputBytes, fileName);
            showPdfRotateSuccess(savedPath, 'all', totalPages);
          } catch (e) {
            console.error('[PDF Rotate] Export all error:', e);
            alert(t('common.errorOccurred', { error: formatPdfRotateError(e) }));
          } finally {
            if (pdfRotateProcessMask) pdfRotateProcessMask.classList.remove('visible');
            setPdfRotateProgress(0);
            setPdfRotateSaving(false);
          }
        });
      }

      function openPdfRotateWorkspace() {
        if (!pdfRotateWorkspace) return;
        pdfRotateWorkspace.classList.add('visible');
        pdfRotateWorkspace.setAttribute('aria-hidden', 'false');
      }

      function closePdfRotateWorkspace(force = false) {
        if (pdfRotateSaving && !force) return;
        if (pdfRotateWorkspace) {
          pdfRotateWorkspace.classList.remove('visible');
          pdfRotateWorkspace.setAttribute('aria-hidden', 'true');
        }
        releasePdfRotatePreviewResources();
      }

      if (pdfRotateWorkspaceClose) {
        pdfRotateWorkspaceClose.addEventListener('click', () => closePdfRotateWorkspace());
      }

      function showPdfRotateSuccess(savePath, type, count) {
        lastPdfRotateSavedPath = savePath;
        if (pdfRotateSuccessCount) pdfRotateSuccessCount.textContent = String(count);
        if (pdfRotateSuccessPath) pdfRotateSuccessPath.textContent = savePath.replace(/\//g, '\\');
        if (type === 'all') {
          if (pdfRotateSuccessMeta) pdfRotateSuccessMeta.textContent = t('home.pdfRotate.successAllMeta');
        } else {
          if (pdfRotateSuccessMeta) pdfRotateSuccessMeta.textContent = t('home.pdfRotate.successSingleMeta');
        }
        if (pdfRotateSuccessOverlay) pdfRotateSuccessOverlay.classList.add('visible');
      }

      if (pdfRotateSuccessOk) {
        pdfRotateSuccessOk.addEventListener('click', () => {
          if (pdfRotateSuccessOverlay) pdfRotateSuccessOverlay.classList.remove('visible');
        });
      }
      if (pdfRotateSuccessOpenFolder) {
        pdfRotateSuccessOpenFolder.addEventListener('click', async () => {
          if (isTauri && lastPdfRotateSavedPath) {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const folder = lastPdfRotateSavedPath.replace(/[/\\][^/\\]+$/, '').replace(/\//g, '\\');
              await invoke('open_path', { path: folder });
            } catch (e) {
              console.error('[PDF Rotate] Open folder error:', e);
            }
          }
        });
      }

      // Close cleanup
      function closePdfRotateOverlayFull() {
        if (pdfRotateSaving) {
          window.showToast(t('home.pdfRotate.saving'));
          return;
        }
        pdfRotateRunId++;
        pdfRotateActiveRunId = 0;
        closePdfRotateOverlay();
        pdfRotateProcessing = false;
        if (pdfRotateProcessMask) pdfRotateProcessMask.classList.remove('visible');
        setPdfRotateProgress(0);
        clearPdfRotateFiles();
        closePdfRotateWorkspace(true);
      }
      if (pdfRotateBack) {
        pdfRotateBack.removeEventListener('click', closePdfRotateOverlay);
        pdfRotateBack.addEventListener('click', closePdfRotateOverlayFull);
      }

      onLangChange(() => {
        if (pdfSplitWorkspace?.classList.contains('visible')) {
          renderSplitPreviewPages();
        }
        if (pdfRotateWorkspace?.classList.contains('visible')) {
          renderRotatePreviewPages();
        }
      });

      // ===== PDF Encrypt Overlay Open/Close =====
      const pdfEncryptOverlay = document.getElementById('pdfEncryptOverlay');
      const pdfEncryptFerrofluid = document.getElementById('pdfEncryptFerrofluid');
      const pdfEncryptBack = document.getElementById('pdfEncryptBack');
      let pdfEncryptFerrofluidInstance = null;

      function openPdfEncryptOverlay() {
        if (!pdfEncryptOverlay) return;
        pdfEncryptOverlay.classList.add('visible');
        if (pdfEncryptFerrofluid && !pdfEncryptFerrofluidInstance) {
          pdfEncryptFerrofluidInstance = initFerrofluid(pdfEncryptFerrofluid, {
            colors: ['#e8e8ec', '#a0a0a8', '#ffffff'],
            speed: 0.3,
            scale: 2,
            opacity: 0.6,
          });
        }
      }

      function closePdfEncryptOverlay() {
        if (!pdfEncryptOverlay) return;
        pdfEncryptOverlay.classList.remove('visible');
        if (pdfEncryptFerrofluidInstance) {
          pdfEncryptFerrofluidInstance();
          pdfEncryptFerrofluidInstance = null;
        }
      }

      if (pdfEncryptBack) {
        pdfEncryptBack.addEventListener('click', closePdfEncryptOverlayFull);
      }

      document.querySelectorAll('.audio-list-item[data-tool="pdf-encrypt"]').forEach(item => {
        item.addEventListener('click', () => {
          openPdfEncryptOverlay();
        });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPdfEncryptOverlay();
          }
        });
      });

      // ===== PDF Encrypt Interaction =====
      const pdfEncryptDropZone = document.getElementById('pdfEncryptDropZone');
      const pdfEncryptFiles = document.getElementById('pdfEncryptFiles');
      const pdfEncryptCta = document.getElementById('pdfEncryptCta');
      const pdfEncryptInput = document.getElementById('pdfEncryptInput');
      const pdfEncryptProcessBtn = document.getElementById('pdfEncryptProcessBtn');
      const pdfEncryptProcessMask = document.getElementById('pdfEncryptProcessMask');
      const pdfEncryptProcessBarFill = document.getElementById('pdfEncryptProcessBarFill');
      const pdfEncryptProcessText = document.getElementById('pdfEncryptProcessText');
      const pdfEncryptSuccessOverlay = document.getElementById('pdfEncryptSuccessOverlay');
      const pdfEncryptSuccessPath = document.getElementById('pdfEncryptSuccessPath');
      const pdfEncryptSuccessMeta = document.getElementById('pdfEncryptSuccessMeta');
      const pdfEncryptSuccessCount = document.getElementById('pdfEncryptSuccessCount');
      const pdfEncryptSuccessOpenFolder = document.getElementById('pdfEncryptSuccessOpenFolder');
      const pdfEncryptSuccessOk = document.getElementById('pdfEncryptSuccessOk');
      const pdfEncryptPasswordDialog = document.getElementById('pdfEncryptPasswordDialog');
      const pdfEncryptPasswordInput = document.getElementById('pdfEncryptPasswordInput');
      const pdfEncryptConfirmInput = document.getElementById('pdfEncryptConfirmInput');
      const pdfEncryptPasswordCancel = document.getElementById('pdfEncryptPasswordCancel');
      const pdfEncryptPasswordConfirm = document.getElementById('pdfEncryptPasswordConfirm');
      const pdfEncryptPermPrinting = document.getElementById('pdfEncryptPermPrinting');
      const pdfEncryptPermCopying = document.getElementById('pdfEncryptPermCopying');
      const pdfEncryptPermModifying = document.getElementById('pdfEncryptPermModifying');
      const pdfEncryptPermAnnotating = document.getElementById('pdfEncryptPermAnnotating');
      const pdfEncryptPermFilling = document.getElementById('pdfEncryptPermFilling');
      const pdfEncryptPermAccessibility = document.getElementById('pdfEncryptPermAccessibility');
      const pdfEncryptPermAssembly = document.getElementById('pdfEncryptPermAssembly');
      const pdfEncryptPermHighQualityPrint = document.getElementById('pdfEncryptPermHighQualityPrint');

      let selectedPdfEncryptFiles = [];
      let pdfEncryptProcessing = false;
      let lastPdfEncryptSavedPath = '';

      function setPdfEncryptProgress(percent, message) {
        if (pdfEncryptProcessBarFill) pdfEncryptProcessBarFill.style.width = `${percent}%`;
        if (message && pdfEncryptProcessText) pdfEncryptProcessText.textContent = message;
      }

      function clearPdfEncryptPasswordInputs() {
        if (pdfEncryptPasswordInput) {
          pdfEncryptPasswordInput.value = '';
          pdfEncryptPasswordInput.type = 'password';
        }
        if (pdfEncryptConfirmInput) {
          pdfEncryptConfirmInput.value = '';
          pdfEncryptConfirmInput.type = 'password';
        }
        document.querySelectorAll('.pdf-encrypt-eye-btn').forEach(button => button.classList.remove('show'));
      }

      function formatPdfEncryptError(error) {
        const message = String(error?.message || error);
        if (/at least 8 characters/.test(message)) return t('home.pdfEncrypt.passwordTooShort');
        if (/encrypted/i.test(message)) return t('home.pdfEncrypt.passwordProtected');
        if (/encryption limit/.test(message) && /MB/.test(message)) return t('home.pdfEncrypt.fileTooLarge');
        if (/encryption limit/.test(message) && /page/.test(message)) return t('home.pdfEncrypt.tooManyPages');
        return message;
      }

      async function preflightPdfEncryptFile() {
        const { PDF_ENCRYPT_LIMITS, assertPdfEncryptSelection } = await import('./pdf-encrypt-core.js');
        const file = selectedPdfEncryptFiles[0];
        if (!file) throw new Error('No PDF file is selected');
        const totalBytes = isTauri && file.path
          ? Number(await (await import('@tauri-apps/api/core')).invoke('get_file_size', { path: file.path }))
          : Number(file.size || 0);
        assertPdfEncryptSelection(selectedPdfEncryptFiles, totalBytes, PDF_ENCRYPT_LIMITS);
      }

      async function readPdfEncryptFileData(file) {
        if (isTauri && file.path) {
          const { invoke } = await import('@tauri-apps/api/core');
          const bytes = await invoke('read_file_bytes', { path: file.path });
          if (Array.isArray(bytes)) return Uint8Array.from(bytes);
          if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
          if (bytes instanceof Uint8Array) return bytes;
          if (bytes && typeof bytes.length === 'number') return Uint8Array.from(bytes);
          throw new Error(`Invalid file data for ${file.name}`);
        }
        return new Uint8Array(await file.arrayBuffer());
      }

      async function getPdfEncryptOutputDir() {
        return getOutputDir('PDF_Encrypt');
      }

      async function savePdfEncryptBytes(bytes, fileName) {
        if (isTauri) {
          const { invoke } = await import('@tauri-apps/api/core');
          return invoke('write_unique_file_bytes', {
            directory: await getPdfEncryptOutputDir(),
            fileName,
            bytes: Array.from(bytes)
          });
        }

        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        return `~/Downloads/${fileName}`;
      }

      function addPdfEncryptFiles(fileList) {
        if (!fileList || fileList.length === 0) return;
        if (pdfEncryptProcessing || pdfEncryptPasswordDialog?.classList.contains('visible')) return;
        if (fileList.length > 1) {
          alert(t('home.pdfEncrypt.singleFileOnly'));
          return;
        }
        const file = fileList[0];
        selectedPdfEncryptFiles = [file];
        renderPdfEncryptFiles();
      }

      function clearPdfEncryptFiles() {
        selectedPdfEncryptFiles = [];
        renderPdfEncryptFiles();
      }

      function renderPdfEncryptFiles() {
        if (!pdfEncryptFiles) return;
        pdfEncryptFiles.innerHTML = '';
        if (selectedPdfEncryptFiles.length > 0) {
          pdfEncryptFiles.classList.add('has-files');
        } else {
          pdfEncryptFiles.classList.remove('has-files');
        }
        selectedPdfEncryptFiles.forEach((file, index) => {
          const item = document.createElement('div');
          item.className = 'audio-convert-file-item';
          item.dataset.index = index;
          item.innerHTML = `
            <span class="audio-convert-file-index">${index + 1}</span>
            <span class="audio-convert-file-name">${escapeHtml(file.name)}</span>
            <button class="audio-convert-file-remove" data-index="${index}" aria-label="remove">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          `;
          pdfEncryptFiles.appendChild(item);
        });
        pdfEncryptFiles.querySelectorAll('.audio-convert-file-remove').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearPdfEncryptFiles();
          });
        });
        togglePdfEncryptProcessButton();
      }

      function togglePdfEncryptProcessButton() {
        if (!pdfEncryptProcessBtn) return;
        if (selectedPdfEncryptFiles.length >= 1) {
          pdfEncryptProcessBtn.style.display = '';
          requestAnimationFrame(() => pdfEncryptProcessBtn.classList.add('visible'));
        } else {
          pdfEncryptProcessBtn.classList.remove('visible');
          const onTransitionEnd = (e) => {
            if (e.propertyName === 'opacity' && !pdfEncryptProcessBtn.classList.contains('visible')) {
              pdfEncryptProcessBtn.style.display = 'none';
              pdfEncryptProcessBtn.removeEventListener('transitionend', onTransitionEnd);
            }
          };
          pdfEncryptProcessBtn.addEventListener('transitionend', onTransitionEnd);
        }
      }

      function showPdfEncryptDropZone() {
        if (pdfEncryptDropZone) pdfEncryptDropZone.classList.add('visible');
        if (pdfEncryptOverlay) pdfEncryptOverlay.classList.add('drag-over');
      }

      function hidePdfEncryptDropZone() {
        if (pdfEncryptDropZone) pdfEncryptDropZone.classList.remove('visible');
        if (pdfEncryptOverlay) pdfEncryptOverlay.classList.remove('drag-over');
      }

      // Tauri native drag-drop
      if (isTauri && pdfEncryptOverlay) {
        (async () => {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          const webview = getCurrentWebview();
          await webview.onDragDropEvent((event) => {
            if (!pdfEncryptOverlay.classList.contains('visible') || pdfEncryptProcessing || pdfEncryptPasswordDialog?.classList.contains('visible')) return;
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') {
              showPdfEncryptDropZone();
            } else if (payload.type === 'leave') {
              hidePdfEncryptDropZone();
            } else if (payload.type === 'drop') {
              hidePdfEncryptDropZone();
              const paths = payload.paths || [];
              if (paths.length === 0) return;
              const fileList = paths
                .filter(p => p.toLowerCase().endsWith('.pdf'))
                .map(path => ({ name: path.split(/[\\/]/).pop() || path, path, size: 0 }));
              if (fileList.length > 0) {
                addPdfEncryptFiles(fileList);
              }
            }
          });
        })();
      }

      // CTA button — open file dialog
      if (pdfEncryptCta) {
        pdfEncryptCta.addEventListener('click', async () => {
          if (pdfEncryptProcessing || pdfEncryptPasswordDialog?.classList.contains('visible')) return;
          if (isTauri) {
            try {
              const { open } = await import('@tauri-apps/plugin-dialog');
              const selected = await open({
                multiple: false,
                filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
              });
              if (selected && typeof selected === 'string') {
                addPdfEncryptFiles([{ name: selected.split(/[\\/]/).pop() || selected, path: selected, size: 0 }]);
              }
            } catch (e) {
              console.error('PDF encrypt file selection error', e);
            }
          } else {
            pdfEncryptInput?.click();
          }
        });
      }
      if (pdfEncryptInput) {
        pdfEncryptInput.addEventListener('change', () => {
          addPdfEncryptFiles(pdfEncryptInput.files);
          pdfEncryptInput.value = '';
        });
      }

      // Process button — show password dialog
      if (pdfEncryptProcessBtn) {
        pdfEncryptProcessBtn.addEventListener('click', () => {
          if (selectedPdfEncryptFiles.length < 1 || pdfEncryptProcessing) return;
          clearPdfEncryptPasswordInputs();
          // Reset permissions to default (all checked)
          [pdfEncryptPermPrinting, pdfEncryptPermCopying, pdfEncryptPermModifying, pdfEncryptPermAnnotating,
           pdfEncryptPermFilling, pdfEncryptPermAccessibility, pdfEncryptPermAssembly, pdfEncryptPermHighQualityPrint
          ].forEach(cb => { if (cb) cb.checked = true; });
          // Show password dialog
          if (pdfEncryptPasswordDialog) pdfEncryptPasswordDialog.classList.add('visible');
        });
      }

      // Password dialog cancel
      if (pdfEncryptPasswordCancel) {
        pdfEncryptPasswordCancel.addEventListener('click', () => {
          if (pdfEncryptPasswordDialog) pdfEncryptPasswordDialog.classList.remove('visible');
          clearPdfEncryptPasswordInputs();
        });
      }

      // Password eye toggle
      ['pdfEncryptEyeBtn1', 'pdfEncryptEyeBtn2'].forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const input = btn.parentElement.querySelector('input');
        if (!input) return;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const isPassword = input.type === 'password';
          input.type = isPassword ? 'text' : 'password';
          btn.classList.toggle('show', isPassword);
          input.focus();
        });
      });

      // Password dialog confirm — start encryption
      async function handleEncryptConfirm() {
        if (pdfEncryptProcessing) return;
        const password = pdfEncryptPasswordInput ? pdfEncryptPasswordInput.value : '';
        const confirmPwd = pdfEncryptConfirmInput ? pdfEncryptConfirmInput.value : '';

        if (!password) {
          alert(t('home.pdfEncrypt.passwordEmpty'));
          return;
        }
        if (password !== confirmPwd) {
          alert(t('home.pdfEncrypt.passwordMismatch'));
          return;
        }

        try {
          const { assertPdfEncryptPassword } = await import('./pdf-encrypt-core.js');
          assertPdfEncryptPassword(password);
        } catch (error) {
          alert(formatPdfEncryptError(error));
          return;
        }

        if (pdfEncryptPasswordDialog) pdfEncryptPasswordDialog.classList.remove('visible');
        clearPdfEncryptPasswordInputs();

        pdfEncryptProcessing = true;
        if (pdfEncryptProcessMask) pdfEncryptProcessMask.classList.add('visible');
        setPdfEncryptProgress(10, t('home.pdfEncrypt.encrypting'));

        try {
          await preflightPdfEncryptFile();
          const file = selectedPdfEncryptFiles[0];
          const fileData = await readPdfEncryptFileData(file);
          if (!fileData.length) throw new Error(`File ${file.name} is empty`);

          const permPrinting = pdfEncryptPermPrinting && pdfEncryptPermPrinting.checked;
          const permHighQuality = pdfEncryptPermHighQualityPrint && pdfEncryptPermHighQualityPrint.checked;
          const permissions = {
            printing: permPrinting ? (permHighQuality ? 'highResolution' : 'lowResolution') : false,
            modifying: !!(pdfEncryptPermModifying && pdfEncryptPermModifying.checked),
            copying: !!(pdfEncryptPermCopying && pdfEncryptPermCopying.checked),
            annotating: !!(pdfEncryptPermAnnotating && pdfEncryptPermAnnotating.checked),
            fillingForms: !!(pdfEncryptPermFilling && pdfEncryptPermFilling.checked),
            contentAccessibility: !!(pdfEncryptPermAccessibility && pdfEncryptPermAccessibility.checked),
            documentAssembly: !!(pdfEncryptPermAssembly && pdfEncryptPermAssembly.checked),
          };
          const { createPdfEncryptFileName, encryptPdf } = await import('./pdf-encrypt-core.js');
          const encryptedBytes = await encryptPdf({
            fileData,
            password,
            permissions,
            onProgress: ({ percent }) => setPdfEncryptProgress(percent, t('home.pdfEncrypt.encrypting'))
          });
          setPdfEncryptProgress(95, t('home.pdfEncrypt.encrypting'));
          const savedPath = await savePdfEncryptBytes(
            encryptedBytes,
            createPdfEncryptFileName(file.name)
          );
          showPdfEncryptSuccess(savedPath, 1);
        } catch (e) {
          console.error('[PDF Encrypt] Error:', e);
          alert(t('common.errorOccurred', { error: formatPdfEncryptError(e) }));
        } finally {
          if (pdfEncryptProcessMask) pdfEncryptProcessMask.classList.remove('visible');
          setPdfEncryptProgress(0);
          pdfEncryptProcessing = false;
        }
      }

      if (pdfEncryptPasswordConfirm) {
        pdfEncryptPasswordConfirm.addEventListener('click', handleEncryptConfirm);
      }
      if (pdfEncryptConfirmInput) {
        pdfEncryptConfirmInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleEncryptConfirm();
          }
        });
      }
      if (pdfEncryptPasswordInput) {
        pdfEncryptPasswordInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (pdfEncryptConfirmInput) pdfEncryptConfirmInput.focus();
          }
        });
      }

      function showPdfEncryptSuccess(savePath, count) {
        lastPdfEncryptSavedPath = savePath;
        if (pdfEncryptSuccessCount) pdfEncryptSuccessCount.textContent = String(count);
        if (pdfEncryptSuccessPath) pdfEncryptSuccessPath.textContent = savePath.replace(/\//g, '\\');
        if (pdfEncryptSuccessMeta) pdfEncryptSuccessMeta.textContent = t('home.pdfEncrypt.successMeta');
        if (pdfEncryptSuccessOverlay) pdfEncryptSuccessOverlay.classList.add('visible');
      }

      if (pdfEncryptSuccessOk) {
        pdfEncryptSuccessOk.addEventListener('click', () => {
          if (pdfEncryptSuccessOverlay) pdfEncryptSuccessOverlay.classList.remove('visible');
        });
      }

      if (pdfEncryptSuccessOpenFolder) {
        pdfEncryptSuccessOpenFolder.addEventListener('click', async () => {
          if (isTauri && lastPdfEncryptSavedPath) {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const folder = lastPdfEncryptSavedPath.replace(/[/\\][^/\\]+$/, '').replace(/\//g, '\\');
              await invoke('open_path', { path: folder });
            } catch (e) {
              console.error('[PDF Encrypt] Open folder error:', e);
            }
          }
        });
      }

      // Close cleanup
      function closePdfEncryptOverlayFull() {
        if (pdfEncryptProcessing) {
          window.showToast(t('home.pdfEncrypt.encrypting'));
          return;
        }
        closePdfEncryptOverlay();
        if (pdfEncryptProcessMask) pdfEncryptProcessMask.classList.remove('visible');
        setPdfEncryptProgress(0);
        if (pdfEncryptPasswordDialog) pdfEncryptPasswordDialog.classList.remove('visible');
        if (pdfEncryptSuccessOverlay) pdfEncryptSuccessOverlay.classList.remove('visible');
        clearPdfEncryptPasswordInputs();
        clearPdfEncryptFiles();
      }

      // ===== PDF Decrypt Overlay Open/Close =====
      const pdfDecryptOverlay = document.getElementById('pdfDecryptOverlay');
      const pdfDecryptFerrofluid = document.getElementById('pdfDecryptFerrofluid');
      const pdfDecryptBack = document.getElementById('pdfDecryptBack');
      let pdfDecryptFerrofluidInstance = null;

      function openPdfDecryptOverlay() {
        if (!pdfDecryptOverlay) return;
        pdfDecryptOverlay.classList.add('visible');
        if (pdfDecryptFerrofluid && !pdfDecryptFerrofluidInstance) {
          pdfDecryptFerrofluidInstance = initFerrofluid(pdfDecryptFerrofluid, {
            colors: ['#e8e8ec', '#a0a0a8', '#ffffff'],
            speed: 0.3,
            scale: 2,
            opacity: 0.6,
          });
        }
      }

      function closePdfDecryptOverlay() {
        if (!pdfDecryptOverlay) return;
        pdfDecryptOverlay.classList.remove('visible');
        if (pdfDecryptFerrofluidInstance) {
          pdfDecryptFerrofluidInstance();
          pdfDecryptFerrofluidInstance = null;
        }
      }

      if (pdfDecryptBack) {
        pdfDecryptBack.addEventListener('click', closePdfDecryptOverlayFull);
      }

      document.querySelectorAll('.audio-list-item[data-tool="pdf-decrypt"]').forEach(item => {
        item.addEventListener('click', () => {
          openPdfDecryptOverlay();
        });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPdfDecryptOverlay();
          }
        });
      });

      // ===== PDF Decrypt Interaction =====
      const pdfDecryptDropZone = document.getElementById('pdfDecryptDropZone');
      const pdfDecryptFiles = document.getElementById('pdfDecryptFiles');
      const pdfDecryptCta = document.getElementById('pdfDecryptCta');
      const pdfDecryptInput = document.getElementById('pdfDecryptInput');
      const pdfDecryptProcessBtn = document.getElementById('pdfDecryptProcessBtn');
      const pdfDecryptProcessMask = document.getElementById('pdfDecryptProcessMask');
      const pdfDecryptProcessBarFill = document.getElementById('pdfDecryptProcessBarFill');
      const pdfDecryptProcessText = document.getElementById('pdfDecryptProcessText');
      const pdfDecryptSuccessOverlay = document.getElementById('pdfDecryptSuccessOverlay');
      const pdfDecryptSuccessPath = document.getElementById('pdfDecryptSuccessPath');
      const pdfDecryptSuccessMeta = document.getElementById('pdfDecryptSuccessMeta');
      const pdfDecryptSuccessCount = document.getElementById('pdfDecryptSuccessCount');
      const pdfDecryptSuccessOpenFolder = document.getElementById('pdfDecryptSuccessOpenFolder');
      const pdfDecryptSuccessOk = document.getElementById('pdfDecryptSuccessOk');
      const pdfDecryptPasswordDialog = document.getElementById('pdfDecryptPasswordDialog');
      const pdfDecryptPasswordInput = document.getElementById('pdfDecryptPasswordInput');
      const pdfDecryptPasswordCancel = document.getElementById('pdfDecryptPasswordCancel');
      const pdfDecryptPasswordConfirm = document.getElementById('pdfDecryptPasswordConfirm');

      let selectedPdfDecryptFiles = [];
      let pdfDecryptProcessing = false;
      let lastPdfDecryptSavedPath = '';

      function setPdfDecryptProgress(percent, message) {
        if (pdfDecryptProcessBarFill) pdfDecryptProcessBarFill.style.width = `${percent}%`;
        if (message && pdfDecryptProcessText) pdfDecryptProcessText.textContent = message;
      }

      function clearPdfDecryptPasswordInput() {
        if (pdfDecryptPasswordInput) {
          pdfDecryptPasswordInput.value = '';
          pdfDecryptPasswordInput.type = 'password';
        }
        pdfDecryptEyeBtn?.classList.remove('show');
      }

      async function getPdfDecryptErrorInfo(error) {
        const { getPdfDecryptErrorCode } = await import('./pdf-decrypt-core.js');
        const code = getPdfDecryptErrorCode(error);
        const messages = {
          'invalid-password': 'home.pdfDecrypt.wrongPassword',
          'input-too-large': 'home.pdfDecrypt.fileTooLarge',
          'too-many-pages': 'home.pdfDecrypt.tooManyPages',
          'invalid-pdf': 'home.pdfDecrypt.invalidPdf',
          'desktop-only': 'home.pdfDecrypt.desktopOnly',
          'qpdf-unavailable': 'home.pdfDecrypt.decryptFailed',
          'decryption-failed': 'home.pdfDecrypt.decryptFailed'
        };
        return { code, message: t(messages[code] || 'home.pdfDecrypt.decryptFailed') };
      }

      async function preflightPdfDecryptFile() {
        const { PDF_DECRYPT_LIMITS, assertPdfDecryptSelection } = await import('./pdf-decrypt-core.js');
        const file = selectedPdfDecryptFiles[0];
        if (!file) throw new Error('No PDF file is selected');
        const totalBytes = isTauri && file.path
          ? Number(await (await import('@tauri-apps/api/core')).invoke('get_file_size', { path: file.path }))
          : Number(file.size || 0);
        assertPdfDecryptSelection(selectedPdfDecryptFiles, totalBytes, PDF_DECRYPT_LIMITS);
      }

      function addPdfDecryptFiles(fileList) {
        if (!fileList || fileList.length === 0) return;
        if (pdfDecryptProcessing || pdfDecryptPasswordDialog?.classList.contains('visible')) return;
        if (fileList.length > 1) {
          alert(t('home.pdfDecrypt.singleFileOnly'));
          return;
        }
        const file = fileList[0];
        selectedPdfDecryptFiles = [file];
        renderPdfDecryptFiles();
      }

      function clearPdfDecryptFiles() {
        selectedPdfDecryptFiles = [];
        renderPdfDecryptFiles();
      }

      function renderPdfDecryptFiles() {
        if (!pdfDecryptFiles) return;
        pdfDecryptFiles.innerHTML = '';
        if (selectedPdfDecryptFiles.length > 0) {
          pdfDecryptFiles.classList.add('has-files');
        } else {
          pdfDecryptFiles.classList.remove('has-files');
        }
        selectedPdfDecryptFiles.forEach((file, index) => {
          const item = document.createElement('div');
          item.className = 'audio-convert-file-item';
          item.dataset.index = index;
          item.innerHTML = `
            <span class="audio-convert-file-index">${index + 1}</span>
            <span class="audio-convert-file-name">${escapeHtml(file.name)}</span>
            <button class="audio-convert-file-remove" data-index="${index}" aria-label="remove">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          `;
          pdfDecryptFiles.appendChild(item);
        });
        pdfDecryptFiles.querySelectorAll('.audio-convert-file-remove').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearPdfDecryptFiles();
          });
        });
        togglePdfDecryptProcessButton();
      }

      function togglePdfDecryptProcessButton() {
        if (!pdfDecryptProcessBtn) return;
        if (selectedPdfDecryptFiles.length >= 1) {
          pdfDecryptProcessBtn.style.display = '';
          requestAnimationFrame(() => pdfDecryptProcessBtn.classList.add('visible'));
        } else {
          pdfDecryptProcessBtn.classList.remove('visible');
          const onTransitionEnd = (e) => {
            if (e.propertyName === 'opacity' && !pdfDecryptProcessBtn.classList.contains('visible')) {
              pdfDecryptProcessBtn.style.display = 'none';
              pdfDecryptProcessBtn.removeEventListener('transitionend', onTransitionEnd);
            }
          };
          pdfDecryptProcessBtn.addEventListener('transitionend', onTransitionEnd);
        }
      }

      function showPdfDecryptDropZone() {
        if (pdfDecryptDropZone) pdfDecryptDropZone.classList.add('visible');
        if (pdfDecryptOverlay) pdfDecryptOverlay.classList.add('drag-over');
      }

      function hidePdfDecryptDropZone() {
        if (pdfDecryptDropZone) pdfDecryptDropZone.classList.remove('visible');
        if (pdfDecryptOverlay) pdfDecryptOverlay.classList.remove('drag-over');
      }

      // CTA button — open file dialog
      if (pdfDecryptCta) {
        pdfDecryptCta.addEventListener('click', async () => {
          if (pdfDecryptProcessing || pdfDecryptPasswordDialog?.classList.contains('visible')) return;
          if (isTauri) {
            try {
              const { open } = await import('@tauri-apps/plugin-dialog');
              const selected = await open({
                multiple: false,
                filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
              });
              if (selected && typeof selected === 'string') {
                addPdfDecryptFiles([{ name: selected.split(/[\\/]/).pop() || selected, path: selected, size: 0 }]);
              }
            } catch (e) {
              console.error('PDF decrypt file selection error', e);
            }
          } else {
            pdfDecryptInput?.click();
          }
        });
      }
      if (pdfDecryptInput) {
        pdfDecryptInput.addEventListener('change', () => {
          addPdfDecryptFiles(pdfDecryptInput.files);
          pdfDecryptInput.value = '';
        });
      }

      // Tauri native drag-drop
      if (isTauri && pdfDecryptOverlay) {
        (async () => {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          const webview = getCurrentWebview();
          await webview.onDragDropEvent((event) => {
            if (!pdfDecryptOverlay.classList.contains('visible') || pdfDecryptProcessing || pdfDecryptPasswordDialog?.classList.contains('visible')) return;
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') {
              showPdfDecryptDropZone();
            } else if (payload.type === 'leave') {
              hidePdfDecryptDropZone();
            } else if (payload.type === 'drop') {
              hidePdfDecryptDropZone();
              const paths = payload.paths || [];
              if (paths.length === 0) return;
              const fileList = paths
                .filter(p => p.toLowerCase().endsWith('.pdf'))
                .map(path => ({ name: path.split(/[\\/]/).pop() || path, path, size: 0 }));
              if (fileList.length > 0) {
                addPdfDecryptFiles(fileList);
              }
            }
          });
        })();
      }

      // HTML5 drag-drop fallback (non-Tauri)
      if (pdfDecryptOverlay && !isTauri) {
        pdfDecryptOverlay.addEventListener('dragover', (e) => {
          e.preventDefault();
          showPdfDecryptDropZone();
        });
        pdfDecryptOverlay.addEventListener('dragleave', (e) => {
          if (e.target === pdfDecryptOverlay) {
            hidePdfDecryptDropZone();
          }
        });
        pdfDecryptOverlay.addEventListener('drop', (e) => {
          e.preventDefault();
          hidePdfDecryptDropZone();
          if (e.dataTransfer && e.dataTransfer.files.length > 0) {
            addPdfDecryptFiles(Array.from(e.dataTransfer.files));
          }
        });
      }

      // Process button — show password dialog
      if (pdfDecryptProcessBtn) {
        pdfDecryptProcessBtn.addEventListener('click', () => {
          if (selectedPdfDecryptFiles.length < 1 || pdfDecryptProcessing) return;
          clearPdfDecryptPasswordInput();
          if (pdfDecryptPasswordDialog) pdfDecryptPasswordDialog.classList.add('visible');
          if (pdfDecryptPasswordInput) pdfDecryptPasswordInput.focus();
        });
      }

      // Password dialog cancel
      if (pdfDecryptPasswordCancel) {
        pdfDecryptPasswordCancel.addEventListener('click', () => {
          if (pdfDecryptPasswordDialog) pdfDecryptPasswordDialog.classList.remove('visible');
          clearPdfDecryptPasswordInput();
        });
      }

      // Password eye toggle
      const pdfDecryptEyeBtn = document.getElementById('pdfDecryptEyeBtn');
      if (pdfDecryptEyeBtn && pdfDecryptPasswordInput) {
        pdfDecryptEyeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          const isPassword = pdfDecryptPasswordInput.type === 'password';
          pdfDecryptPasswordInput.type = isPassword ? 'text' : 'password';
          pdfDecryptEyeBtn.classList.toggle('show', isPassword);
          pdfDecryptPasswordInput.focus();
        });
      }

      // Password dialog confirm — start decryption
      async function handleDecryptConfirm() {
        if (pdfDecryptProcessing) return;
        let password = pdfDecryptPasswordInput ? pdfDecryptPasswordInput.value : '';
        try {
          const { assertPdfDecryptPassword } = await import('./pdf-decrypt-core.js');
          assertPdfDecryptPassword(password);
        } catch (error) {
          alert(t('home.pdfDecrypt.passwordUnsupported'));
          return;
        }

        if (pdfDecryptPasswordDialog) pdfDecryptPasswordDialog.classList.remove('visible');
        clearPdfDecryptPasswordInput();
        pdfDecryptProcessing = true;
        if (pdfDecryptProcessMask) pdfDecryptProcessMask.classList.add('visible');
        setPdfDecryptProgress(10, t('home.pdfDecrypt.decrypting'));

        try {
          await preflightPdfDecryptFile();
          if (!isTauri) throw new Error('pdf-decrypt:desktop-only');
          const file = selectedPdfDecryptFiles[0];
          setPdfDecryptProgress(40, t('home.pdfDecrypt.decrypting'));
          const { invoke } = await import('@tauri-apps/api/core');
          const savedPath = await invoke('decrypt_pdf', { inputPath: file.path, password, outputDir: await getOutputDir('PDF_Decrypt') });
          setPdfDecryptProgress(100, t('home.pdfDecrypt.decrypting'));
          showPdfDecryptSuccess(savedPath, 1);
        } catch (e) {
          console.error('[PDF Decrypt] Error:', e);
          const errorInfo = await getPdfDecryptErrorInfo(e);
          if (errorInfo.code === 'invalid-password') {
            clearPdfDecryptPasswordInput();
            if (pdfDecryptPasswordDialog) pdfDecryptPasswordDialog.classList.add('visible');
            pdfDecryptPasswordInput?.focus();
          }
          alert(t('common.errorOccurred', { error: errorInfo.message }));
        } finally {
          password = '\0'.repeat(password.length);
          password = '';
          if (pdfDecryptProcessMask) pdfDecryptProcessMask.classList.remove('visible');
          setPdfDecryptProgress(0);
          pdfDecryptProcessing = false;
        }
      }

      if (pdfDecryptPasswordConfirm) {
        pdfDecryptPasswordConfirm.addEventListener('click', handleDecryptConfirm);
      }
      if (pdfDecryptPasswordInput) {
        pdfDecryptPasswordInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleDecryptConfirm();
          }
        });
      }

      function showPdfDecryptSuccess(savePath, count) {
        lastPdfDecryptSavedPath = savePath;
        if (pdfDecryptSuccessCount) pdfDecryptSuccessCount.textContent = String(count);
        if (pdfDecryptSuccessPath) pdfDecryptSuccessPath.textContent = savePath.replace(/\//g, '\\');
        if (pdfDecryptSuccessMeta) pdfDecryptSuccessMeta.textContent = t('home.pdfDecrypt.successMeta');
        if (pdfDecryptSuccessOverlay) pdfDecryptSuccessOverlay.classList.add('visible');
      }

      if (pdfDecryptSuccessOk) {
        pdfDecryptSuccessOk.addEventListener('click', () => {
          if (pdfDecryptSuccessOverlay) pdfDecryptSuccessOverlay.classList.remove('visible');
        });
      }

      if (pdfDecryptSuccessOpenFolder) {
        pdfDecryptSuccessOpenFolder.addEventListener('click', async () => {
          if (isTauri && lastPdfDecryptSavedPath) {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const folder = lastPdfDecryptSavedPath.replace(/[/\\][^/\\]+$/, '').replace(/\//g, '\\');
              await invoke('open_path', { path: folder });
            } catch (e) {
              console.error('[PDF Decrypt] Open folder error:', e);
            }
          }
        });
      }

      // Close cleanup
      function closePdfDecryptOverlayFull() {
        if (pdfDecryptProcessing) {
          window.showToast(t('home.pdfDecrypt.decrypting'));
          return;
        }
        closePdfDecryptOverlay();
        if (pdfDecryptProcessMask) pdfDecryptProcessMask.classList.remove('visible');
        setPdfDecryptProgress(0);
        if (pdfDecryptPasswordDialog) pdfDecryptPasswordDialog.classList.remove('visible');
        clearPdfDecryptPasswordInput();
        if (pdfDecryptSuccessOverlay) pdfDecryptSuccessOverlay.classList.remove('visible');
        clearPdfDecryptFiles();
      }

      // ===== PDF Enhance Overlay Open/Close =====
      const pdfEnhanceOverlay = document.getElementById('pdfEnhanceOverlay');
      const pdfEnhanceFerrofluid = document.getElementById('pdfEnhanceFerrofluid');
      const pdfEnhanceBack = document.getElementById('pdfEnhanceBack');
      let pdfEnhanceFerrofluidInstance = null;

      function openPdfEnhanceOverlay() {
        if (!pdfEnhanceOverlay) return;
        pdfEnhanceOverlay.classList.add('visible');
        if (pdfEnhanceFerrofluid && !pdfEnhanceFerrofluidInstance) {
          pdfEnhanceFerrofluidInstance = initFerrofluid(pdfEnhanceFerrofluid, {
            colors: ['#e8e8ec', '#a0a0a8', '#ffffff'],
            speed: 0.3,
            scale: 2,
            opacity: 0.6,
          });
        }
      }

      function closePdfEnhanceOverlay() {
        if (!pdfEnhanceOverlay) return;
        pdfEnhanceOverlay.classList.remove('visible');
        if (pdfEnhanceFerrofluidInstance) {
          pdfEnhanceFerrofluidInstance();
          pdfEnhanceFerrofluidInstance = null;
        }
      }

      if (pdfEnhanceBack) {
        pdfEnhanceBack.addEventListener('click', closePdfEnhanceOverlayFull);
      }

      document.querySelectorAll('.audio-list-item[data-tool="pdf-enhance"]').forEach(item => {
        item.addEventListener('click', () => {
          openPdfEnhanceOverlay();
        });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPdfEnhanceOverlay();
          }
        });
      });

      // ===== PDF Enhance Interaction =====
      const pdfEnhanceDropZone = document.getElementById('pdfEnhanceDropZone');
      const pdfEnhanceFiles = document.getElementById('pdfEnhanceFiles');
      const pdfEnhanceCta = document.getElementById('pdfEnhanceCta');
      const pdfEnhanceProcessBtn = document.getElementById('pdfEnhanceProcessBtn');
      const pdfEnhanceProcessMask = document.getElementById('pdfEnhanceProcessMask');
      const pdfEnhanceProcessBarFill = document.getElementById('pdfEnhanceProcessBarFill');
      const pdfEnhanceProcessText = document.getElementById('pdfEnhanceProcessText');
      const pdfEnhanceSuccessOverlay = document.getElementById('pdfEnhanceSuccessOverlay');
      const pdfEnhanceSuccessPath = document.getElementById('pdfEnhanceSuccessPath');
      const pdfEnhanceSuccessMeta = document.getElementById('pdfEnhanceSuccessMeta');
      const pdfEnhanceSuccessCount = document.getElementById('pdfEnhanceSuccessCount');
      const pdfEnhanceSuccessOpenFolder = document.getElementById('pdfEnhanceSuccessOpenFolder');
      const pdfEnhanceSuccessOk = document.getElementById('pdfEnhanceSuccessOk');
      const pdfEnhanceStrengthHint = document.getElementById('pdfEnhanceStrengthHint');

      let selectedPdfEnhanceFiles = [];
      let pdfEnhanceProcessing = false;
      let lastPdfEnhanceSavedPath = '';
      let pdfEnhanceStrength = 'light';

      // Strength selector
      document.querySelectorAll('#pdfEnhanceStrengthOptions .audio-convert-format-option').forEach(btn => {
        btn.addEventListener('click', () => {
          if (pdfEnhanceProcessing) return;
          document.querySelectorAll('#pdfEnhanceStrengthOptions .audio-convert-format-option').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          pdfEnhanceStrength = btn.dataset.strength;
          if (pdfEnhanceStrengthHint) {
            const hintKey = `home.pdfEnhance.strength${pdfEnhanceStrength.charAt(0).toUpperCase() + pdfEnhanceStrength.slice(1)}Hint`;
            pdfEnhanceStrengthHint.textContent = t(hintKey);
          }
        });
      });

      function addPdfEnhanceFiles(fileList) {
        if (!fileList || fileList.length === 0) return;
        if (pdfEnhanceProcessing) return;
        if (fileList.length > 1) {
          alert(t('home.pdfEnhance.singleFileOnly'));
          return;
        }
        const file = fileList[0];
        selectedPdfEnhanceFiles = [file];
        renderPdfEnhanceFiles();
      }

      function clearPdfEnhanceFiles() {
        selectedPdfEnhanceFiles = [];
        renderPdfEnhanceFiles();
      }

      function renderPdfEnhanceFiles() {
        if (!pdfEnhanceFiles) return;
        pdfEnhanceFiles.innerHTML = '';
        if (selectedPdfEnhanceFiles.length > 0) {
          pdfEnhanceFiles.classList.add('has-files');
        } else {
          pdfEnhanceFiles.classList.remove('has-files');
        }
        if (pdfEnhanceCta) {
          const ctaText = pdfEnhanceCta.querySelector('span');
          if (ctaText) {
            ctaText.textContent = selectedPdfEnhanceFiles.length > 0
              ? (t('home.pdfEnhance.ctaReupload'))
              : (t('home.pdfEnhance.cta'));
          }
        }
        selectedPdfEnhanceFiles.forEach((file, index) => {
          const item = document.createElement('div');
          item.className = 'audio-convert-file-item';
          item.dataset.index = index;
          item.innerHTML = `
            <span class="audio-convert-file-index">${index + 1}</span>
            <span class="audio-convert-file-name">${escapeHtml(file.name)}</span>
            <button class="audio-convert-file-remove" data-index="${index}" aria-label="remove">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          `;
          pdfEnhanceFiles.appendChild(item);
        });
        pdfEnhanceFiles.querySelectorAll('.audio-convert-file-remove').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearPdfEnhanceFiles();
          });
        });
        togglePdfEnhanceProcessButton();
      }

      function togglePdfEnhanceProcessButton() {
        if (!pdfEnhanceProcessBtn) return;
        if (selectedPdfEnhanceFiles.length >= 1) {
          pdfEnhanceProcessBtn.style.display = '';
          requestAnimationFrame(() => pdfEnhanceProcessBtn.classList.add('visible'));
        } else {
          pdfEnhanceProcessBtn.classList.remove('visible');
          const onTransitionEnd = (e) => {
            if (e.propertyName === 'opacity' && !pdfEnhanceProcessBtn.classList.contains('visible')) {
              pdfEnhanceProcessBtn.style.display = 'none';
              pdfEnhanceProcessBtn.removeEventListener('transitionend', onTransitionEnd);
            }
          };
          pdfEnhanceProcessBtn.addEventListener('transitionend', onTransitionEnd);
        }
      }

      async function getPdfEnhanceErrorMessage(error) {
        const { getPdfEnhanceErrorCode } = await import('./pdf-enhance-core.js');
        const code = getPdfEnhanceErrorCode(error);
        const messageKey = {
          'single-file-required': 'errorSingleFile',
          'input-too-large': 'errorTooLarge',
          'too-many-pages': 'errorTooManyPages',
          'page-too-large': 'errorPageTooLarge',
          'document-too-large': 'errorDocumentTooLarge',
          'output-too-large': 'errorOutputTooLarge',
          'invalid-strength': 'errorInvalidStrength',
          'invalid-pdf': 'errorInvalidPdf',
          'password-protected': 'errorPasswordProtected',
          'enhancement-failed': 'errorFailed'
        }[code] || 'errorFailed';
        return t(`home.pdfEnhance.${messageKey}`);
      }

      function showPdfEnhanceDropZone() {
        if (pdfEnhanceDropZone) pdfEnhanceDropZone.classList.add('visible');
        if (pdfEnhanceOverlay) pdfEnhanceOverlay.classList.add('drag-over');
      }

      function hidePdfEnhanceDropZone() {
        if (pdfEnhanceDropZone) pdfEnhanceDropZone.classList.remove('visible');
        if (pdfEnhanceOverlay) pdfEnhanceOverlay.classList.remove('drag-over');
      }

      // Tauri native drag-drop
      if (isTauri && pdfEnhanceOverlay) {
        (async () => {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          const webview = getCurrentWebview();
          await webview.onDragDropEvent((event) => {
            if (!pdfEnhanceOverlay.classList.contains('visible') || pdfEnhanceProcessing) return;
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') {
              showPdfEnhanceDropZone();
            } else if (payload.type === 'leave') {
              hidePdfEnhanceDropZone();
            } else if (payload.type === 'drop') {
              hidePdfEnhanceDropZone();
              const paths = payload.paths || [];
              if (paths.length === 0) return;
              const fileList = paths
                .filter(p => p.toLowerCase().endsWith('.pdf'))
                .map(path => ({ name: path.split(/[\\/]/).pop() || path, path, size: 0 }));
              if (fileList.length > 0) {
                addPdfEnhanceFiles(fileList);
              }
            }
          });
        })();
      }

      // CTA button — open file dialog
      if (pdfEnhanceCta) {
        pdfEnhanceCta.addEventListener('click', async () => {
          if (pdfEnhanceProcessing) return;
          if (isTauri) {
            try {
              const { open } = await import('@tauri-apps/plugin-dialog');
              const selected = await open({
                multiple: false,
                filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
              });
              if (selected && typeof selected === 'string') {
                addPdfEnhanceFiles([{ name: selected.split(/[\\/]/).pop() || selected, path: selected, size: 0 }]);
              }
            } catch (e) {
              console.error('PDF enhance file selection error', e);
            }
          } else {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.pdf,application/pdf';
            input.addEventListener('change', () => {
              addPdfEnhanceFiles(input.files);
              input.value = '';
            });
            input.click();
          }
        });
      }

      // ===== Image Enhancement Functions =====

      // CLAHE — Contrast Limited Adaptive Histogram Equalization
      // Divides image into tiles, enhances local contrast with clip limit
      function clahe(data, w, h, tileSize, clipLimit) {
        const tilesX = Math.ceil(w / tileSize);
        const tilesY = Math.ceil(h / tileSize);

        // Build per-tile LUTs on grayscale
        const luts = new Float32Array(tilesX * tilesY * 256);
        for (let ty = 0; ty < tilesY; ty++) {
          for (let tx = 0; tx < tilesX; tx++) {
            const x0 = tx * tileSize, y0 = ty * tileSize;
            const x1 = Math.min(x0 + tileSize, w), y1 = Math.min(y0 + tileSize, h);
            const hist = new Int32Array(256);
            let count = 0;
            for (let y = y0; y < y1; y++) {
              for (let x = x0; x < x1; x++) {
                const gray = 0.299 * data[(y * w + x) * 4] + 0.587 * data[(y * w + x) * 4 + 1] + 0.114 * data[(y * w + x) * 4 + 2];
                hist[Math.round(gray)]++;
                count++;
              }
            }
            // Clip histogram
            let excess = 0;
            for (let i = 0; i < 256; i++) {
              if (hist[i] > clipLimit) { excess += hist[i] - clipLimit; hist[i] = clipLimit; }
            }
            // Keep the histogram total exact. Int32Array silently truncates fractional additions.
            const add = Math.floor(excess / 256);
            const remainder = excess % 256;
            for (let i = 0; i < 256; i++) hist[i] += add + (i < remainder ? 1 : 0);
            // Build CDF to LUT (total = count after redistribution)
            let cdf = 0;
            const lutIdx = (ty * tilesX + tx) * 256;
            for (let i = 0; i < 256; i++) {
              cdf += hist[i];
              luts[lutIdx + i] = (cdf / count) * 255;
            }
          }
        }

        // Apply with bilinear interpolation between tile LUTs
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const fx = x / tileSize - 0.5;
            const fy = y / tileSize - 0.5;
            const tx0 = Math.max(0, Math.min(tilesX - 1, Math.floor(fx)));
            const ty0 = Math.max(0, Math.min(tilesY - 1, Math.floor(fy)));
            const tx1 = Math.min(tilesX - 1, tx0 + 1);
            const ty1 = Math.min(tilesY - 1, ty0 + 1);
            const ax = Math.max(0, Math.min(1, fx - tx0));
            const ay = Math.max(0, Math.min(1, fy - ty0));

            for (let c = 0; c < 3; c++) {
              const v = data[idx + c];
              const v00 = luts[(ty0 * tilesX + tx0) * 256 + v];
              const v01 = luts[(ty0 * tilesX + tx1) * 256 + v];
              const v10 = luts[(ty1 * tilesX + tx0) * 256 + v];
              const v11 = luts[(ty1 * tilesX + tx1) * 256 + v];
              const v0 = v00 * (1 - ax) + v01 * ax;
              const v1 = v10 * (1 - ax) + v11 * ax;
              data[idx + c] = Math.max(0, Math.min(255, v0 * (1 - ay) + v1 * ay));
            }
          }
        }
      }

      // Sauvola adaptive binarization — local mean + std dev threshold
      function sauvolaBinarize(data, w, h, windowSize, k) {
        const rowStride = w * 4;
        const halfWin = windowSize >> 1;
        // Compute grayscale
        const gray = new Uint8ClampedArray(w * h);
        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
          gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
        // Integral images for mean and squared mean
        const integral = new Float64Array((w + 1) * (h + 1));
        const integralSq = new Float64Array((w + 1) * (h + 1));
        for (let y = 0; y < h; y++) {
          let rowSum = 0, rowSumSq = 0;
          for (let x = 0; x < w; x++) {
            const g = gray[y * w + x];
            rowSum += g;
            rowSumSq += g * g;
            integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
            integralSq[(y + 1) * (w + 1) + (x + 1)] = integralSq[y * (w + 1) + (x + 1)] + rowSumSq;
          }
        }
        const R = 128; // dynamic range std
        for (let y = 0; y < h; y++) {
          const y0 = Math.max(0, y - halfWin), y1 = Math.min(h - 1, y + halfWin);
          for (let x = 0; x < w; x++) {
            const x0 = Math.max(0, x - halfWin), x1 = Math.min(w - 1, x + halfWin);
            const area = (x1 - x0 + 1) * (y1 - y0 + 1);
            const sum = integral[(y1 + 1) * (w + 1) + (x1 + 1)] - integral[y0 * (w + 1) + (x1 + 1)] - integral[(y1 + 1) * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
            const sumSq = integralSq[(y1 + 1) * (w + 1) + (x1 + 1)] - integralSq[y0 * (w + 1) + (x1 + 1)] - integralSq[(y1 + 1) * (w + 1) + x0] + integralSq[y0 * (w + 1) + x0];
            const mean = sum / area;
            const variance = sumSq / area - mean * mean;
            const std = Math.sqrt(Math.max(0, variance));
            const threshold = mean * (1 + k * (std / R - 1));
            const idx = (y * w + x) * 4;
            const val = gray[y * w + x] > threshold ? 255 : 0;
            data[idx] = val; data[idx + 1] = val; data[idx + 2] = val;
          }
        }
      }

      // 5x5 unsharp mask sharpening
      function sharpen5x5(data, w, h, amount) {
        const original = new Uint8ClampedArray(data);
        const rowStride = w * 4;
        const center = 1 + 8 * amount;
        const side = -amount;
        for (let y = 2; y < h - 2; y++) {
          const rowOff = y * rowStride;
          for (let x = 2; x < w - 2; x++) {
            const idx = rowOff + x * 4;
            for (let c = 0; c < 3; c++) {
              const val = original[idx + c] * center
                + (original[idx - 4 + c] + original[idx + 4 + c] + original[idx - rowStride + c] + original[idx + rowStride + c]) * side
                + (original[idx - 8 + c] + original[idx + 8 + c] + original[idx - rowStride * 2 + c] + original[idx + rowStride * 2 + c]) * (side * 0.5);
              data[idx + c] = Math.max(0, Math.min(255, val));
            }
          }
        }
      }

      // 3x3 unsharp mask sharpening (lighter)
      function sharpen3x3(data, w, h, amount) {
        const original = new Uint8ClampedArray(data);
        const rowStride = w * 4;
        const center = 1 + 4 * amount;
        const side = -amount;
        for (let y = 1; y < h - 1; y++) {
          const rowOff = y * rowStride;
          for (let x = 1; x < w - 1; x++) {
            const idx = rowOff + x * 4;
            data[idx]     = Math.max(0, Math.min(255, original[idx]     * center + (original[idx - 4]     + original[idx + 4]     + original[idx - rowStride]     + original[idx + rowStride])     * side));
            data[idx + 1] = Math.max(0, Math.min(255, original[idx + 1] * center + (original[idx - 3]     + original[idx + 5]     + original[idx - rowStride + 1] + original[idx + rowStride + 1]) * side));
            data[idx + 2] = Math.max(0, Math.min(255, original[idx + 2] * center + (original[idx - 2]     + original[idx + 6]     + original[idx - rowStride + 2] + original[idx + rowStride + 2]) * side));
          }
        }
      }

      function enhanceImageCanvas(canvas, strength) {
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('pdf-enhance:enhancement-failed');
        const w = canvas.width;
        const h = canvas.height;
        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;

        if (strength === 'light') {
          // Light: CLAHE (large tiles, gentle) + 3x3 sharpen, preserve color
          clahe(data, w, h, 64, 20);
          sharpen3x3(data, w, h, 0.4);
        } else if (strength === 'medium') {
          // Medium: grayscale mix 60% + CLAHE (medium tiles) + 5x5 sharpen
          for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            data[i]     = data[i]     * 0.4 + gray * 0.6;
            data[i + 1] = data[i + 1] * 0.4 + gray * 0.6;
            data[i + 2] = data[i + 2] * 0.4 + gray * 0.6;
          }
          clahe(data, w, h, 48, 15);
          sharpen5x5(data, w, h, 0.5);
        } else {
          // Strong: full grayscale + CLAHE (small tiles, aggressive) + Sauvola binarization + 5x5 sharpen
          for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            data[i] = data[i + 1] = data[i + 2] = gray;
          }
          clahe(data, w, h, 32, 10);
          sauvolaBinarize(data, w, h, 41, 0.15);
          sharpen5x5(data, w, h, 0.4);
        }

        ctx.putImageData(imageData, 0, 0);
      }

      // ===== Process button — enhance PDF =====
      if (pdfEnhanceProcessBtn) {
        pdfEnhanceProcessBtn.addEventListener('click', async () => {
          if (selectedPdfEnhanceFiles.length < 1 || pdfEnhanceProcessing) return;
          pdfEnhanceProcessing = true;
          if (pdfEnhanceProcessMask) pdfEnhanceProcessMask.classList.add('visible');
          if (pdfEnhanceProcessBarFill) pdfEnhanceProcessBarFill.style.width = '5%';
          if (pdfEnhanceProcessText) pdfEnhanceProcessText.textContent = t('home.pdfEnhance.loading');

          let pdfDoc = null;
          try {
            const enhanceCore = await import('./pdf-enhance-core.js');
            let file = selectedPdfEnhanceFiles[0];
            if (isTauri && file.path) {
              const { invoke } = await import('@tauri-apps/api/core');
              file = { ...file, size: await invoke('get_file_size', { path: file.path }) };
              selectedPdfEnhanceFiles = [file];
            }
            enhanceCore.assertPdfEnhanceSelection([file]);
            enhanceCore.assertPdfEnhanceStrength(pdfEnhanceStrength);

            let fileData;
            if (isTauri && file.path) {
              const { invoke } = await import('@tauri-apps/api/core');
              const rawBytes = await invoke('read_file_bytes', { path: file.path });
              if (Array.isArray(rawBytes)) {
                fileData = Uint8Array.from(rawBytes);
              } else if (rawBytes instanceof ArrayBuffer) {
                fileData = new Uint8Array(rawBytes);
              } else if (rawBytes instanceof Uint8Array) {
                fileData = rawBytes;
              } else if (rawBytes && typeof rawBytes.length === 'number') {
                fileData = Uint8Array.from(rawBytes);
              } else {
                throw new Error('pdf-enhance:invalid-pdf');
              }
            } else {
              fileData = new Uint8Array(await file.arrayBuffer());
            }
            if (fileData.length === 0) throw new Error('pdf-enhance:invalid-pdf');

            const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
            pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
            const wasmUrl = new URL('assets/', document.baseURI).href;
            const loadingTask = pdfjsLib.getDocument({ data: fileData, wasmUrl, useWasm: true });
            pdfDoc = await loadingTask.promise;
            const totalPages = pdfDoc.numPages;

            const RENDER_SCALE = 2.5;
            const pagePlan = [];
            for (let pi = 1; pi <= totalPages; pi++) {
              const page = await pdfDoc.getPage(pi);
              const outputViewport = page.getViewport({ scale: 1 });
              const renderViewport = page.getViewport({ scale: RENDER_SCALE });
              pagePlan.push({
                outputWidth: outputViewport.width,
                outputHeight: outputViewport.height,
                renderWidth: renderViewport.width,
                renderHeight: renderViewport.height
              });
              try { page.cleanup(); } catch (_) {}
            }
            enhanceCore.assertPdfEnhancePagePlan(pagePlan);

            if (pdfEnhanceProcessText) pdfEnhanceProcessText.textContent = `${t('home.pdfEnhance.processing')} (0/${totalPages})`;
            const { PDFDocument } = await import('pdf-lib');
            const newPdf = await PDFDocument.create();

            for (let pi = 1; pi <= totalPages; pi++) {
              const page = await pdfDoc.getPage(pi);
              const plan = pagePlan[pi - 1];
              const renderViewport = page.getViewport({ scale: RENDER_SCALE });
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              if (!ctx) throw new Error('pdf-enhance:enhancement-failed');
              canvas.width = Math.ceil(plan.renderWidth);
              canvas.height = Math.ceil(plan.renderHeight);
              await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;

              enhanceImageCanvas(canvas, pdfEnhanceStrength);
              const jpegBlob = await new Promise((resolve, reject) => {
                canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('pdf-enhance:enhancement-failed')), 'image/jpeg', 0.85);
              });
              const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
              const image = await newPdf.embedJpg(jpegBytes);
              const outputPage = newPdf.addPage([plan.outputWidth, plan.outputHeight]);
              outputPage.drawImage(image, { x: 0, y: 0, width: plan.outputWidth, height: plan.outputHeight });

              canvas.width = 0;
              canvas.height = 0;
              try { page.cleanup(); } catch (_) {}

              const progress = Math.round((pi / totalPages) * 85) + 5;
              if (pdfEnhanceProcessBarFill) pdfEnhanceProcessBarFill.style.width = progress + '%';
              if (pdfEnhanceProcessText) pdfEnhanceProcessText.textContent = `${t('home.pdfEnhance.processing')} (${pi}/${totalPages})`;
              await new Promise(resolve => setTimeout(resolve, 0));
            }

            if (pdfEnhanceProcessText) pdfEnhanceProcessText.textContent = t('home.pdfEnhance.generating');
            if (pdfEnhanceProcessBarFill) pdfEnhanceProcessBarFill.style.width = '95%';
            const enhancedBytes = await newPdf.save();
            if (enhancedBytes.length > enhanceCore.PDF_ENHANCE_LIMITS.maxOutputBytes) {
              throw new Error('pdf-enhance:output-too-large');
            }
            if (pdfEnhanceProcessBarFill) pdfEnhanceProcessBarFill.style.width = '100%';

            if (isTauri) {
              const { invoke } = await import('@tauri-apps/api/core');
              const outputDir = await getOutputDir('Enhance');
              const baseName = file.name.replace(/\.pdf$/i, '');
              let fileName = `${baseName}_enhanced.pdf`;
              let fullPath = outputDir + '\\' + fileName;
              let counter = 1;
              while (await invoke('exists_path', { path: fullPath }).catch(() => false)) {
                fileName = `${baseName}_enhanced_${counter}.pdf`;
                fullPath = outputDir + '\\' + fileName;
                counter++;
              }
              await invoke('write_file_chunk', { path: fullPath, offset: 0, bytes: Array.from(enhancedBytes.subarray(0, 5_000_000)) });
              for (let offset = 5_000_000; offset < enhancedBytes.length; offset += 5_000_000) {
                const end = Math.min(offset + 5_000_000, enhancedBytes.length);
                await invoke('write_file_chunk', { path: fullPath, offset, bytes: Array.from(enhancedBytes.subarray(offset, end)) });
              }
              if (pdfEnhanceProcessMask) pdfEnhanceProcessMask.classList.remove('visible');
              if (pdfEnhanceProcessBarFill) pdfEnhanceProcessBarFill.style.width = '0%';
              pdfEnhanceProcessing = false;
              showPdfEnhanceSuccess(fullPath, totalPages);
            } else {
              const blob = new Blob([enhancedBytes], { type: 'application/pdf' });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = `${file.name.replace(/\.pdf$/i, '')}_enhanced.pdf`;
              anchor.click();
              setTimeout(() => URL.revokeObjectURL(url), 1_000);
              if (pdfEnhanceProcessMask) pdfEnhanceProcessMask.classList.remove('visible');
              if (pdfEnhanceProcessBarFill) pdfEnhanceProcessBarFill.style.width = '0%';
              pdfEnhanceProcessing = false;
              showPdfEnhanceSuccess(`~/Downloads/${file.name.replace(/\.pdf$/i, '')}_enhanced.pdf`, totalPages);
            }
          } catch (e) {
            console.error('[PDF Enhance] Error:', e);
            if (pdfEnhanceProcessMask) pdfEnhanceProcessMask.classList.remove('visible');
            if (pdfEnhanceProcessBarFill) pdfEnhanceProcessBarFill.style.width = '0%';
            pdfEnhanceProcessing = false;
            alert(t('common.errorOccurred', { error: await getPdfEnhanceErrorMessage(e) }));
          } finally {
            if (pdfDoc) {
              try { await pdfDoc.destroy(); } catch (_) {}
            }
          }
        });
      }

      function showPdfEnhanceSuccess(savePath, count) {
        lastPdfEnhanceSavedPath = savePath;
        if (pdfEnhanceSuccessCount) pdfEnhanceSuccessCount.textContent = String(count);
        if (pdfEnhanceSuccessPath) pdfEnhanceSuccessPath.textContent = savePath.replace(/\//g, '\\');
        if (pdfEnhanceSuccessMeta) pdfEnhanceSuccessMeta.textContent = t('home.pdfEnhance.successMeta');
        if (pdfEnhanceSuccessOverlay) pdfEnhanceSuccessOverlay.classList.add('visible');
      }

      if (pdfEnhanceSuccessOk) {
        pdfEnhanceSuccessOk.addEventListener('click', () => {
          if (pdfEnhanceSuccessOverlay) pdfEnhanceSuccessOverlay.classList.remove('visible');
        });
      }

      if (pdfEnhanceSuccessOpenFolder) {
        pdfEnhanceSuccessOpenFolder.addEventListener('click', async () => {
          if (isTauri && lastPdfEnhanceSavedPath) {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const folder = lastPdfEnhanceSavedPath.replace(/[/\\][^/\\]+$/, '').replace(/\//g, '\\');
              await invoke('open_path', { path: folder });
            } catch (e) {
              console.error('[PDF Enhance] Open folder error:', e);
            }
          }
        });
      }

      function closePdfEnhanceOverlayFull() {
        if (pdfEnhanceProcessing) {
          window.showToast(t('home.pdfEnhance.processing'));
          return;
        }
        closePdfEnhanceOverlay();
        if (pdfEnhanceProcessMask) pdfEnhanceProcessMask.classList.remove('visible');
        if (pdfEnhanceProcessBarFill) pdfEnhanceProcessBarFill.style.width = '0%';
        if (pdfEnhanceSuccessOverlay) pdfEnhanceSuccessOverlay.classList.remove('visible');
        clearPdfEnhanceFiles();
      }

      // ===== AI Polish Tool =====
      const aiPolishOverlay = document.getElementById('aiPolishOverlay');
      const aiPolishBack = document.getElementById('aiPolishBack');
      const aiPolishStartBtn = document.getElementById('aiPolishStartBtn');
      const aiPolishInput = document.getElementById('aiPolishInput');
      const aiPolishRightEmpty = document.getElementById('aiPolishRightEmpty');
      const aiPolishDrawer = document.getElementById('aiPolishDrawer');
      const aiPolishDirections = document.getElementById('aiPolishDirections');
      const aiPolishDirectionList = document.getElementById('aiPolishDirectionList');
      const aiPolishComparison = document.getElementById('aiPolishComparison');
      const aiPolishPolishedText = document.getElementById('aiPolishPolishedText');
      const aiPolishMask = document.getElementById('aiPolishMask');
      const aiPolishMaskText = document.getElementById('aiPolishMaskText');
      const aiPolishCopyBtn = document.getElementById('aiPolishCopyBtn');

      let aiPolishDirectionsData = [];
      let aiPolishResultMode = false; // true when result is shown, button acts as "clear"
      let aiPolishOriginalContent = '';
      let aiPolishDitherInstance = null;
      let aiPolishRequestController = null;
      let aiPolishRequestTimeoutId = null;
      let aiPolishRequestId = 0;

      const AI_POLISH_REQUEST_TIMEOUT_MS = 90_000;

      function cancelAiPolishRequest() {
        aiPolishRequestId += 1;
        if (aiPolishRequestTimeoutId !== null) {
          clearTimeout(aiPolishRequestTimeoutId);
          aiPolishRequestTimeoutId = null;
        }
        if (aiPolishRequestController) {
          aiPolishRequestController.abort();
          aiPolishRequestController = null;
        }
      }

      function finishAiPolishRequest(requestId) {
        if (requestId !== aiPolishRequestId) return false;
        if (aiPolishRequestTimeoutId !== null) {
          clearTimeout(aiPolishRequestTimeoutId);
          aiPolishRequestTimeoutId = null;
        }
        aiPolishRequestController = null;
        return true;
      }

      const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
      const DEEPSEEK_MODEL = 'deepseek-chat';

      // Robust JSON extraction: strip markdown code blocks and use balanced brace matching
      function extractJson(str) {
        if (!str || typeof str !== 'string') return null;

        // 0. Try direct JSON.parse first (in case the entire string is valid JSON)
        try {
          JSON.parse(str.trim());
          return str.trim();
        } catch (e) {}

        // 1. Try to extract content from markdown code blocks (```json ... ``` or ``` ... ```)
        const codeBlockRegex = /```(?:json|javascript|js)?\s*\n([\s\S]*?)\n```/g;
        let matches = [];
        let match;
        while ((match = codeBlockRegex.exec(str)) !== null) {
          matches.push(match[1]);
        }
        for (const blockContent of matches) {
          const trimmed = cleanJsonString(blockContent.trim());
          // Try direct parse
          try { JSON.parse(trimmed); return trimmed; } catch (e) {}
          const start = trimmed.indexOf('{');
          if (start !== -1) {
            const result = extractBalancedJson(trimmed, start);
            if (result) {
              try { JSON.parse(result); return result; } catch (e) {}
            }
          }
        }

        // 2. Remove any stray code fence markers and surrounding explanation text
        let cleaned = cleanJsonString(str
          .replace(/```(?:json|javascript|js)?\s*/g, '')
          .replace(/```\s*/g, '')
          .trim());

        // 3. Try direct parse on cleaned string
        try { JSON.parse(cleaned); return cleaned; } catch (e) {}

        // 4. Find the first '{' and extract balanced JSON
        const start = cleaned.indexOf('{');
        if (start === -1) return null;
        const balanced = extractBalancedJson(cleaned, start);
        if (balanced) {
          try { JSON.parse(balanced); return balanced; } catch (e) {}
        }

        // 5. Fallback: find first '{' and last '}' — try to parse the substring
        const lastClose = cleaned.lastIndexOf('}');
        if (start !== -1 && lastClose > start) {
          const candidate = cleaned.substring(start, lastClose + 1);
          try { JSON.parse(candidate); return candidate; } catch (e) {}
        }

        // 6. Repair truncated JSON (DeepSeek output hit the 8K token limit and got cut off)
        const repaired = repairTruncatedJson(cleaned);
        if (repaired) {
          try { JSON.parse(repaired); return repaired; } catch (e) {}
        }

        // 7. Last resort: return the balanced result even if JSON.parse fails (caller will handle)
        if (balanced) return balanced;

        return null;
      }

      // Repairs a truncated JSON object by discarding the incomplete trailing portion
      // and closing all open brackets. Used when the model output is cut off mid-region.
      function repairTruncatedJson(str) {
        const start = str.indexOf('{');
        if (start === -1) return null;
        const candidates = []; // each: { pos, stack: remaining open brackets after this close }
        let stack = [];
        let inString = false;
        let escape = false;
        for (let i = start; i < str.length; i++) {
          const ch = str[i];
          if (escape) { escape = false; continue; }
          if (ch === '\\') { if (inString) escape = true; continue; }
          if (ch === '"') { inString = !inString; continue; }
          if (inString) continue;
          if (ch === '{' || ch === '[') {
            stack.push(ch);
          } else if (ch === '}' || ch === ']') {
            stack.pop();
            candidates.push({ pos: i, stack: stack.slice() });
          }
        }
        // Try from the last complete closing bracket backwards, closing the remaining stack
        for (let k = candidates.length - 1; k >= 0; k--) {
          const { pos, stack: rem } = candidates[k];
          let closing = '';
          for (let j = rem.length - 1; j >= 0; j--) {
            closing += rem[j] === '{' ? '}' : ']';
          }
          const candidate = str.substring(start, pos + 1) + closing;
          try {
            JSON.parse(candidate);
            console.warn('[AI Doc] Repaired truncated JSON, discarded trailing incomplete content. Recovered length:', candidate.length);
            return candidate;
          } catch (e) {}
        }
        return null;
      }

      function cleanJsonString(str) {
        // Remove BOM and control characters that are invalid in JSON strings
        return str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFEFF\uFFFD]/g, '');
      }

      function extractBalancedJson(str, start) {
        let depth = 0;
        let inString = false;
        let escape = false;
        for (let i = start; i < str.length; i++) {
          const ch = str[i];
          if (escape) { escape = false; continue; }
          if (ch === '\\' && inString) { escape = true; continue; }
          if (ch === '"') { inString = !inString; continue; }
          if (inString) continue;
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) return str.substring(start, i + 1);
          }
        }
        return null;
      }

      async function callDeepSeek(messages, signal, maxTokens) {
        const apiKey = localStorage.getItem('ai_api_key') || localStorage.getItem('deepseek_api_key') || '';
        if (!apiKey) {
          throw new Error(t('home.aiPolish.noApiKey'));
        }
        const { url: apiUrl, model } = getAiPlatformConfig();
        if (!apiUrl || !model) {
          throw new Error(t('home.aiPolish.noApiKey'));
        }
        try {
          return await requestAiCompletion({
            url: apiUrl,
            apiKey,
            model,
            messages,
            maxTokens,
            signal
          });
        } catch (error) {
          if (error instanceof AiProviderError) {
            const suffix = error.code === 'http_error' && error.status !== null
              ? `: ${error.status}`
              : '';
            throw new Error(`${t('home.aiPolish.apiError')}${suffix}`);
          }
          throw error;
        }
      }

      function openAiPolishOverlay() {
        if (!aiPolishOverlay) return;
        aiPolishOverlay.classList.add('visible');
        resetAiPolishState();
        if (aiPolishBg && !aiPolishDitherInstance) {
          aiPolishDitherInstance = initDither(aiPolishBg, {
            waveColor: [0.38823529411764707, 0.4, 0.9450980392156862],
            colorNum: 40,
            pixelSize: 2,
            waveAmplitude: 0,
            waveFrequency: 0,
            waveSpeed: 0.07
          });
        }
      }

      function closeAiPolishOverlay() {
        if (!aiPolishOverlay) return;
        aiPolishOverlay.classList.remove('visible');
        resetAiPolishState();
        if (aiPolishDitherInstance) {
          aiPolishDitherInstance();
          aiPolishDitherInstance = null;
        }
      }

      function resetAiPolishState() {
        cancelAiPolishRequest();
        hideAiPolishMask();
        if (aiPolishInput) aiPolishInput.value = '';
        if (aiPolishRightEmpty) aiPolishRightEmpty.style.display = '';
        if (aiPolishDirections) aiPolishDirections.style.display = 'none';
        if (aiPolishComparison) aiPolishComparison.style.display = 'none';
        if (aiPolishDrawer) {
          aiPolishDrawer.classList.remove('processing');
        }
        if (aiPolishStartBtn) {
          aiPolishStartBtn.classList.add('disabled');
          const btnLabel = aiPolishStartBtn.querySelector('span');
          if (btnLabel) btnLabel.textContent = t('home.aiPolish.cta');
          const btnIcon = aiPolishStartBtn.querySelector('i[data-lucide]');
          if (btnIcon) {
            btnIcon.setAttribute('data-lucide', 'sparkles');
            if (window.lucide) window.lucide.createIcons();
          }
        }
        aiPolishResultMode = false;
        aiPolishDirectionsData = [];
        aiPolishOriginalContent = '';
      }

      function showAiPolishDrawer() {
        if (aiPolishDrawer) {
          aiPolishDrawer.style.display = '';
          requestAnimationFrame(() => aiPolishDrawer.classList.add('expanded'));
        }
      }

      function showAiPolishMask(text) {
        if (aiPolishMaskText) aiPolishMaskText.textContent = text;
        if (aiPolishMask) aiPolishMask.classList.add('visible');
      }

      function hideAiPolishMask() {
        if (aiPolishMask) aiPolishMask.classList.remove('visible');
      }

      async function copyAiPolishText(text) {
        if (navigator.clipboard?.writeText) {
          try {
            await navigator.clipboard.writeText(text);
            return;
          } catch {
            // WebView clipboard permissions can be unavailable; use the
            // in-document fallback before treating the copy as failed.
          }
        }
        const input = document.createElement('textarea');
        input.value = text;
        input.setAttribute('readonly', '');
        input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand?.('copy');
        input.remove();
        if (!copied) throw new Error('clipboard-unavailable');
      }

      async function handleAiPolishStart() {
        const text = aiPolishInput?.value?.trim();
        if (!text) return;
        if (text.length > AI_POLISH_LIMITS.maxInputChars) {
          alert(t('home.aiPolish.inputTooLong', { max: AI_POLISH_LIMITS.maxInputChars }));
          return;
        }
        if (aiPolishRequestController) return;

        const controller = new AbortController();
        const requestId = ++aiPolishRequestId;
        let timedOut = false;
        aiPolishRequestController = controller;
        aiPolishRequestTimeoutId = setTimeout(() => {
          if (requestId !== aiPolishRequestId || controller.signal.aborted) return;
          timedOut = true;
          controller.abort();
        }, AI_POLISH_REQUEST_TIMEOUT_MS);

        aiPolishOriginalContent = text;
        showAiPolishMask(t('home.aiPolish.analyzing'));
        if (aiPolishDrawer) aiPolishDrawer.classList.add('processing');

        try {
          const systemPrompt = '你是一位资深文字编辑专家，精通中文和英文写作，拥有丰富的润色经验。你擅长分析文本的语境、风格和意图，能够提供多种润色方向并精准执行。你的原则是：保持原文核心意思不变，提升表达的准确性、流畅性和美感。';

          const userPrompt = `请分析以下用户输入的文字，推理用户可能希望的润色方向。给出 3 个最合适的润色方向，每个方向包含：\n- 方向名称（简洁，2-6个字，如"正式商务"、"简洁精炼"、"生动活泼"）\n- 简短说明（一句话描述这个方向的特点）\n\n请以 JSON 格式返回：\n{"directions":[{"name":"方向名称","desc":"简短说明"},{"name":"方向名称","desc":"简短说明"},{"name":"方向名称","desc":"简短说明"}]}\n\n用户文字：\n${text}`;

          const content = await callDeepSeek([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ], controller.signal);

          if (requestId !== aiPolishRequestId) return;
          if (typeof content !== 'string' || !content.trim() || content.length > AI_POLISH_LIMITS.maxResponseChars) {
            throw new AiPolishError('result_too_large', 'AI response exceeds the supported size.');
          }

          // Parse JSON from response using balanced brace matching
          const jsonStr = extractJson(content);
          if (!jsonStr) throw new AiPolishError('invalid_result', 'AI did not return directions JSON.');
          let parsed;
          try {
            parsed = JSON.parse(jsonStr);
          } catch {
            throw new AiPolishError('invalid_result', 'AI returned invalid directions JSON.');
          }
          aiPolishDirectionsData = normalizeAiPolishDirections(parsed);

          // Show direction options in right panel
          if (aiPolishRightEmpty) aiPolishRightEmpty.style.display = 'none';
          if (aiPolishDirections) aiPolishDirections.style.display = '';
          if (aiPolishDirectionList) {
            aiPolishDirectionList.innerHTML = '';
            aiPolishDirectionsData.forEach((dir, idx) => {
              const btn = document.createElement('button');
              btn.className = 'ai-polish-direction-btn';
              btn.innerHTML = `<span class="ai-polish-direction-btn-name">${escapeHtml(dir.name)}</span><span class="ai-polish-direction-btn-desc">${escapeHtml(dir.desc)}</span>`;
              btn.addEventListener('click', () => handleDirectionSelect(idx));
              aiPolishDirectionList.appendChild(btn);
            });
          }
        } catch (e) {
          if (requestId !== aiPolishRequestId) return;
          console.error('[AI Polish] Analysis error:', e);
          if (controller.signal.aborted) {
            if (timedOut) alert(t('home.aiPolish.requestTimeout'));
          } else if (e instanceof AiPolishError) {
            alert(e.code === 'result_too_large'
              ? t('home.aiPolish.resultTooLarge')
              : t('home.aiPolish.parseError'));
          } else {
            alert(t('home.aiPolish.networkError'));
          }
        } finally {
          if (finishAiPolishRequest(requestId)) {
            hideAiPolishMask();
            if (aiPolishDrawer) aiPolishDrawer.classList.remove('processing');
          }
        }
      }

      async function handleDirectionSelect(idx) {
        const dir = aiPolishDirectionsData[idx];
        if (!dir) return;
        if (aiPolishRequestController) return;

        const controller = new AbortController();
        const requestId = ++aiPolishRequestId;
        let timedOut = false;
        aiPolishRequestController = controller;
        aiPolishRequestTimeoutId = setTimeout(() => {
          if (requestId !== aiPolishRequestId || controller.signal.aborted) return;
          timedOut = true;
          controller.abort();
        }, AI_POLISH_REQUEST_TIMEOUT_MS);

        showAiPolishMask(t('home.aiPolish.polishing'));
        if (aiPolishDrawer) aiPolishDrawer.classList.add('processing');

        try {
          const systemPrompt = '你是一位资深文字编辑专家，精通中文和英文写作，拥有丰富的润色经验。你的原则是：保持原文核心意思不变，提升表达的准确性、流畅性和美感。';

          const userPrompt = `请按照「${dir.name}」方向润色以下文字。\n要求：\n1. 保持原文核心意思不变\n2. ${dir.desc}\n3. 直接输出润色后的文字，不要添加任何解释或说明\n\n原文：\n${aiPolishOriginalContent}`;

          const polished = await callDeepSeek([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ], controller.signal);

          if (requestId !== aiPolishRequestId) return;
          const safePolished = normalizeAiPolishedText(polished);

          // Show polished result in right panel
          if (aiPolishDirections) aiPolishDirections.style.display = 'none';
          if (aiPolishComparison) aiPolishComparison.style.display = '';
          if (aiPolishPolishedText) aiPolishPolishedText.textContent = safePolished;
          // Change start button to "清理结果" (clear result)
          aiPolishResultMode = true;
          if (aiPolishStartBtn) {
            aiPolishStartBtn.classList.remove('disabled');
            const btnLabel = aiPolishStartBtn.querySelector('span');
            if (btnLabel) btnLabel.textContent = t('home.aiPolish.clearResult');
            const btnIcon = aiPolishStartBtn.querySelector('i[data-lucide]');
            if (btnIcon) {
              btnIcon.setAttribute('data-lucide', 'rotate-ccw');
              if (window.lucide) window.lucide.createIcons();
            }
          }
        } catch (e) {
          if (requestId !== aiPolishRequestId) return;
          console.error('[AI Polish] Polish error:', e);
          if (controller.signal.aborted) {
            if (timedOut) alert(t('home.aiPolish.requestTimeout'));
          } else if (e instanceof AiPolishError) {
            alert(e.code === 'result_too_large'
              ? t('home.aiPolish.resultTooLarge')
              : t('home.aiPolish.parseError'));
          } else {
            alert(t('home.aiPolish.networkError'));
          }
        } finally {
          if (finishAiPolishRequest(requestId)) {
            hideAiPolishMask();
            if (aiPolishDrawer) aiPolishDrawer.classList.remove('processing');
          }
        }
      }

      // Event listeners
      if (aiPolishBack) {
        aiPolishBack.addEventListener('click', closeAiPolishOverlay);
      }

      document.querySelectorAll('.audio-list-item[data-tool="ai-polish"]').forEach(item => {
        item.addEventListener('click', () => openToolWithAiCheck(openAiPolishOverlay));
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openToolWithAiCheck(openAiPolishOverlay);
          }
        });
      });

      if (aiPolishStartBtn) {
        aiPolishStartBtn.addEventListener('click', () => {
          if (aiPolishResultMode) {
            resetAiPolishState();
            return;
          }
          const text = aiPolishInput?.value?.trim();
          if (!text) return;
          handleAiPolishStart();
        });
      }

      if (aiPolishInput) {
        aiPolishInput.addEventListener('input', () => {
          const hasText = aiPolishInput.value.trim().length > 0;
          if (aiPolishDirectionsData.length > 0 && !aiPolishRequestController && !aiPolishResultMode) {
            // Directions describe the previous input. Do not let a user apply
            // them after they have edited the source text.
            aiPolishDirectionsData = [];
            if (aiPolishDirections) aiPolishDirections.style.display = 'none';
            if (aiPolishRightEmpty) aiPolishRightEmpty.style.display = '';
          }
          if (hasText) {
            aiPolishStartBtn?.classList.remove('disabled');
          } else {
            aiPolishStartBtn?.classList.add('disabled');
          }
        });
      }

      if (aiPolishCopyBtn) {
        aiPolishCopyBtn.addEventListener('click', async () => {
          const text = aiPolishPolishedText?.textContent || '';
          if (!text) return;
          try {
            await copyAiPolishText(text);
            aiPolishCopyBtn.classList.add('copied');
            const icon = aiPolishCopyBtn.querySelector('i[data-lucide]');
            if (icon) icon.setAttribute('data-lucide', 'check');
            if (window.lucide) window.lucide.createIcons();
            setTimeout(() => {
              aiPolishCopyBtn.classList.remove('copied');
              if (icon) icon.setAttribute('data-lucide', 'copy');
              if (window.lucide) window.lucide.createIcons();
            }, 2000);
          } catch {
            alert(t('home.aiPolish.copyFailed'));
          }
        });
      }

      const aiPolishCancelBtn = document.getElementById('aiPolishCancelBtn');
      if (aiPolishCancelBtn) {
        aiPolishCancelBtn.addEventListener('click', () => {
          if (aiPolishDirections) aiPolishDirections.style.display = 'none';
          if (aiPolishRightEmpty) aiPolishRightEmpty.style.display = '';
          aiPolishDirectionsData = [];
        });
      }
      // ===== End AI Polish Tool =====

      // ===== AI Translate Tool =====
      const aiTranslateOverlay = document.getElementById('aiTranslateOverlay');
      const aiTranslateBack = document.getElementById('aiTranslateBack');
      const aiTranslateStartBtn = document.getElementById('aiTranslateStartBtn');
      const aiTranslateInput = document.getElementById('aiTranslateInput');
      const aiTranslateRightEmpty = document.getElementById('aiTranslateRightEmpty');
      const aiTranslateDrawer = document.getElementById('aiTranslateDrawer');
      const aiTranslateLangSelect = document.getElementById('aiTranslateLangSelect');
      const aiTranslateLangList = document.getElementById('aiTranslateLangList');
      const aiTranslateComparison = document.getElementById('aiTranslateComparison');
      const aiTranslateResult = document.getElementById('aiTranslateResult');
      const aiTranslateMask = document.getElementById('aiTranslateMask');
      const aiTranslateMaskText = document.getElementById('aiTranslateMaskText');
      const aiTranslateCopyBtn = document.getElementById('aiTranslateCopyBtn');

      let aiTranslateResultMode = false;
      let aiTranslateOriginalContent = '';
      let aiTranslateDitherInstance = null;
      let aiTranslateRequestController = null;
      let aiTranslateRequestTimeoutId = null;
      let aiTranslateRequestId = 0;

      const AI_TRANSLATE_REQUEST_TIMEOUT_MS = 90_000;

      function cancelAiTranslateRequest() {
        aiTranslateRequestId += 1;
        if (aiTranslateRequestTimeoutId !== null) {
          clearTimeout(aiTranslateRequestTimeoutId);
          aiTranslateRequestTimeoutId = null;
        }
        if (aiTranslateRequestController) {
          aiTranslateRequestController.abort();
          aiTranslateRequestController = null;
        }
      }

      function finishAiTranslateRequest(requestId) {
        if (requestId !== aiTranslateRequestId) return false;
        if (aiTranslateRequestTimeoutId !== null) {
          clearTimeout(aiTranslateRequestTimeoutId);
          aiTranslateRequestTimeoutId = null;
        }
        aiTranslateRequestController = null;
        return true;
      }

      const TRANSLATE_LANGUAGES = [
        { code: 'en', name: 'English', nativeNameKey: 'home.aiTranslate.langEnglish', pattern: /[a-zA-Z]/g },
        { code: 'zh', name: 'Chinese', nativeNameKey: 'home.aiTranslate.langChinese', pattern: /[\u4e00-\u9fff]/g },
        { code: 'ja', name: 'Japanese', nativeNameKey: 'home.aiTranslate.langJapanese', pattern: /[\u3040-\u30ff\u31f0-\u31ff]/g },
        { code: 'ko', name: 'Korean', nativeNameKey: 'home.aiTranslate.langKorean', pattern: /[\uac00-\ud7af]/g },
        { code: 'fr', name: 'French', nativeNameKey: 'home.aiTranslate.langFrench', pattern: null },
        { code: 'de', name: 'German', nativeNameKey: 'home.aiTranslate.langGerman', pattern: null },
        { code: 'es', name: 'Spanish', nativeNameKey: 'home.aiTranslate.langSpanish', pattern: null },
        { code: 'ru', name: 'Russian', nativeNameKey: 'home.aiTranslate.langRussian', pattern: /[\u0400-\u04ff]/g },
        { code: 'pt', name: 'Portuguese', nativeNameKey: 'home.aiTranslate.langPortuguese', pattern: null },
        { code: 'it', name: 'Italian', nativeNameKey: 'home.aiTranslate.langItalian', pattern: null },
      ];

      function detectMainLanguage(text) {
        return detectAiTranslateSourceLanguage(text);
      }

      function openAiTranslateOverlay() {
        if (!aiTranslateOverlay) return;
        aiTranslateOverlay.classList.add('visible');
        resetAiTranslateState();
        if (aiTranslateBg && !aiTranslateDitherInstance) {
          aiTranslateDitherInstance = initDither(aiTranslateBg, {
            waveColor: [0.38823529411764707, 0.4, 0.9450980392156862],
            colorNum: 40,
            pixelSize: 2,
            waveAmplitude: 0,
            waveFrequency: 0,
            waveSpeed: 0.07
          });
        }
      }

      function closeAiTranslateOverlay() {
        if (!aiTranslateOverlay) return;
        aiTranslateOverlay.classList.remove('visible');
        restoreAiTranslateInput();
        resetAiTranslateState();
        if (aiTranslateDitherInstance) {
          aiTranslateDitherInstance();
          aiTranslateDitherInstance = null;
        }
      }

      function resetAiTranslateState() {
        cancelAiTranslateRequest();
        hideAiTranslateMask();
        if (aiTranslateInput) aiTranslateInput.value = '';
        if (aiTranslateRightEmpty) aiTranslateRightEmpty.style.display = '';
        if (aiTranslateLangSelect) aiTranslateLangSelect.style.display = 'none';
        if (aiTranslateComparison) aiTranslateComparison.style.display = 'none';
        if (aiTranslateDrawer) aiTranslateDrawer.classList.remove('processing');
        if (aiTranslateStartBtn) {
          aiTranslateStartBtn.classList.add('disabled');
          const btnLabel = aiTranslateStartBtn.querySelector('span');
          if (btnLabel) btnLabel.textContent = t('home.aiTranslate.cta');
          const btnIcon = aiTranslateStartBtn.querySelector('i[data-lucide]');
          if (btnIcon) {
            btnIcon.setAttribute('data-lucide', 'languages');
            if (window.lucide) window.lucide.createIcons();
          }
        }
        aiTranslateResultMode = false;
        aiTranslateOriginalContent = '';
      }

      function showAiTranslateMask(text) {
        if (aiTranslateMaskText) aiTranslateMaskText.textContent = text;
        if (aiTranslateMask) aiTranslateMask.classList.add('visible');
      }

      function hideAiTranslateMask() {
        if (aiTranslateMask) aiTranslateMask.classList.remove('visible');
      }

      function showAiTranslateLangSelect() {
        if (aiTranslateRightEmpty) aiTranslateRightEmpty.style.display = 'none';
        if (aiTranslateLangSelect) aiTranslateLangSelect.style.display = '';
        if (aiTranslateLangList) {
          const detectedLang = detectMainLanguage(aiTranslateOriginalContent);
          aiTranslateLangList.innerHTML = '';
          TRANSLATE_LANGUAGES.forEach(lang => {
            if (detectedLang && lang.code === detectedLang) return; // Exclude a reliably detected source language
            const btn = document.createElement('button');
            btn.className = 'ai-polish-direction-btn ai-translate-lang-btn';
            btn.innerHTML = `<span class="ai-polish-direction-btn-name">${escapeHtml(t(lang.nativeNameKey))}</span><span class="ai-polish-direction-btn-desc">${escapeHtml(lang.name)}</span>`;
            btn.addEventListener('click', () => handleAiTranslateStart(lang));
            aiTranslateLangList.appendChild(btn);
          });
        }
      }

      async function handleAiTranslateStart(lang) {
        if (!aiTranslateOriginalContent) return;
        if (aiTranslateOriginalContent.length > AI_TRANSLATE_LIMITS.maxInputChars) {
          alert(t('home.aiTranslate.inputTooLong', { max: AI_TRANSLATE_LIMITS.maxInputChars }));
          return;
        }
        if (aiTranslateRequestController) return;

        const controller = new AbortController();
        const requestId = ++aiTranslateRequestId;
        let timedOut = false;
        aiTranslateRequestController = controller;
        aiTranslateRequestTimeoutId = setTimeout(() => {
          if (requestId !== aiTranslateRequestId || controller.signal.aborted) return;
          timedOut = true;
          controller.abort();
        }, AI_TRANSLATE_REQUEST_TIMEOUT_MS);

        if (aiTranslateLangSelect) aiTranslateLangSelect.style.display = 'none';
        showAiTranslateMask(t('home.aiTranslate.translating'));
        if (aiTranslateDrawer) aiTranslateDrawer.classList.add('processing');

        try {
          const systemPrompt = '你是一位专业翻译专家，精通多种语言。你的原则是：准确传达原文意思，保持语境和语气一致。你需要逐句翻译，并返回JSON格式的句子对照。';
          const userPrompt = `请将以下文字翻译为${t(lang.nativeNameKey)}（${lang.name}）。\n要求：\n1. 逐句翻译，保持句子对应关系\n2. 准确传达原文意思和语气\n3. 以JSON格式返回：{"pairs":[{"original":"原文句子1","translated":"译文句子1"},{"original":"原文句子2","translated":"译文句子2"}]}\n4. 每个句子应该是一个完整的意群\n\n原文：\n${aiTranslateOriginalContent}`;

          const content = await callDeepSeek([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ], controller.signal);

          if (requestId !== aiTranslateRequestId) return;
          if (typeof content !== 'string' || !content.trim()) {
            throw new AiTranslateError('invalid_result', 'AI returned an empty response.');
          }
          if (content.length > AI_TRANSLATE_LIMITS.maxResponseChars) {
            throw new AiTranslateError('result_too_large', 'AI response exceeds the supported size.');
          }

          const jsonStr = extractJson(content);
          if (!jsonStr) throw new AiTranslateError('invalid_result', 'AI did not return translation JSON.');
          let parsed;
          try {
            parsed = JSON.parse(jsonStr);
          } catch {
            throw new AiTranslateError('invalid_result', 'AI returned invalid translation JSON.');
          }
          const pairs = normalizeAiTranslatePairs(parsed);

          // Render highlighted sentences on both sides
          renderAiTranslateResult(pairs, aiTranslateOriginalContent);

          // Change start button to "清理结果"
          aiTranslateResultMode = true;
          if (aiTranslateStartBtn) {
            aiTranslateStartBtn.classList.remove('disabled');
            const btnLabel = aiTranslateStartBtn.querySelector('span');
            if (btnLabel) btnLabel.textContent = t('home.aiTranslate.clearResult');
            const btnIcon = aiTranslateStartBtn.querySelector('i[data-lucide]');
            if (btnIcon) {
              btnIcon.setAttribute('data-lucide', 'rotate-ccw');
              if (window.lucide) window.lucide.createIcons();
            }
          }
        } catch (e) {
          if (requestId !== aiTranslateRequestId) return;
          console.error('[AI Translate] Error:', e);
          if (controller.signal.aborted) {
            if (timedOut) alert(t('home.aiTranslate.requestTimeout'));
          } else if (e instanceof AiTranslateError) {
            alert(e.code === 'result_too_large'
              ? t('home.aiTranslate.resultTooLarge')
              : t('home.aiTranslate.parseError'));
          } else {
            alert(t('home.aiTranslate.networkError'));
          }
        } finally {
          if (finishAiTranslateRequest(requestId)) {
            hideAiTranslateMask();
            if (aiTranslateDrawer) aiTranslateDrawer.classList.remove('processing');
          }
        }
      }

      function renderAiTranslateResult(pairs, sourceText) {
        // Render right side (translated) with highlighted sentences
        if (aiTranslateComparison) aiTranslateComparison.style.display = '';
        if (aiTranslateResult) {
          aiTranslateResult.innerHTML = '';
          pairs.forEach(pair => {
            const span = document.createElement('span');
            span.className = 'ai-translate-sentence';
            span.textContent = pair.translated || '';
            span.title = t('home.aiTranslate.clickToCopy');
            span.addEventListener('click', () => copySentenceText(span, pair.translated || ''));
            aiTranslateResult.appendChild(span);
          });
        }

        // Render left side (original) with matching highlight colors
        if (aiTranslateInput) {
          const leftPanel = aiTranslateInput.closest('.ai-polish-left-panel');
          if (leftPanel) {
            let highlightDiv = leftPanel.querySelector('.ai-translate-highlight');
            if (!highlightDiv) {
              highlightDiv = document.createElement('div');
              highlightDiv.className = 'ai-polish-polished ai-translate-highlight';
              highlightDiv.style.display = 'block';
              leftPanel.appendChild(highlightDiv);
            }
            highlightDiv.innerHTML = '';
            const sourcePairs = aiTranslateOriginalsMatch(sourceText, pairs)
              ? pairs
              : [{ original: sourceText, translated: '' }];
            sourcePairs.forEach(pair => {
              const span = document.createElement('span');
              span.className = 'ai-translate-sentence';
              span.textContent = pair.original || '';
              span.title = t('home.aiTranslate.clickToCopy');
              span.addEventListener('click', () => copySentenceText(span, pair.original || ''));
              highlightDiv.appendChild(span);
            });
            aiTranslateInput.style.display = 'none';
          }
        }
      }

      function copySentenceText(el, text) {
        if (!text) return;
        copyAiTranslateText(text).then(() => {
          el.classList.add('copied-flash');
          setTimeout(() => el.classList.remove('copied-flash'), 600);
        }).catch(() => {
          alert(t('home.aiTranslate.copyFailed'));
        });
      }

      async function copyAiTranslateText(text) {
        if (navigator.clipboard?.writeText) {
          try {
            await navigator.clipboard.writeText(text);
            return;
          } catch {
            // Fall through for WebView clipboard-permission failures.
          }
        }
        const input = document.createElement('textarea');
        input.value = text;
        input.setAttribute('readonly', '');
        input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand?.('copy');
        input.remove();
        if (!copied) throw new Error('clipboard-unavailable');
      }

      function restoreAiTranslateInput() {
        if (aiTranslateInput) {
          aiTranslateInput.style.display = '';
          const leftPanel = aiTranslateInput.closest('.ai-polish-left-panel');
          const highlightDiv = leftPanel?.querySelector('.ai-translate-highlight');
          if (highlightDiv) highlightDiv.remove();
        }
      }

      // Event listeners
      if (aiTranslateBack) {
        aiTranslateBack.addEventListener('click', closeAiTranslateOverlay);
      }

      document.querySelectorAll('.audio-list-item[data-tool="ai-translate"]').forEach(item => {
        item.addEventListener('click', () => openToolWithAiCheck(openAiTranslateOverlay));
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openToolWithAiCheck(openAiTranslateOverlay);
          }
        });
      });

      if (aiTranslateStartBtn) {
        aiTranslateStartBtn.addEventListener('click', () => {
          if (aiTranslateResultMode) {
            resetAiTranslateState();
            restoreAiTranslateInput();
            return;
          }
          const text = aiTranslateInput?.value?.trim();
          if (!text) return;
          if (text.length > AI_TRANSLATE_LIMITS.maxInputChars) {
            alert(t('home.aiTranslate.inputTooLong', { max: AI_TRANSLATE_LIMITS.maxInputChars }));
            return;
          }
          aiTranslateOriginalContent = text;
          showAiTranslateLangSelect();
        });
      }

      if (aiTranslateInput) {
        aiTranslateInput.addEventListener('input', () => {
          const hasText = aiTranslateInput.value.trim().length > 0;
          if (aiTranslateOriginalContent && aiTranslateInput.value.trim() !== aiTranslateOriginalContent) {
            aiTranslateOriginalContent = '';
            if (aiTranslateLangSelect) aiTranslateLangSelect.style.display = 'none';
            if (aiTranslateRightEmpty) aiTranslateRightEmpty.style.display = '';
          }
          if (hasText) {
            aiTranslateStartBtn?.classList.remove('disabled');
          } else {
            aiTranslateStartBtn?.classList.add('disabled');
          }
        });
      }

      if (aiTranslateCopyBtn) {
        aiTranslateCopyBtn.addEventListener('click', async () => {
          const text = aiTranslateResult?.textContent || '';
          if (!text) return;
          try {
            await copyAiTranslateText(text);
            aiTranslateCopyBtn.classList.add('copied');
            const icon = aiTranslateCopyBtn.querySelector('i[data-lucide]');
            if (icon) icon.setAttribute('data-lucide', 'check');
            if (window.lucide) window.lucide.createIcons();
            setTimeout(() => {
              aiTranslateCopyBtn.classList.remove('copied');
              if (icon) icon.setAttribute('data-lucide', 'copy');
              if (window.lucide) window.lucide.createIcons();
            }, 2000);
          } catch {
            alert(t('home.aiTranslate.copyFailed'));
          }
        });
      }

      const aiTranslateCancelBtn = document.getElementById('aiTranslateCancelBtn');
      if (aiTranslateCancelBtn) {
        aiTranslateCancelBtn.addEventListener('click', () => {
          if (aiTranslateLangSelect) aiTranslateLangSelect.style.display = 'none';
          if (aiTranslateRightEmpty) aiTranslateRightEmpty.style.display = '';
        });
      }
      // ===== End AI Translate Tool =====

      // ===== AI Document Tool =====
      const aiDocOverlay = document.getElementById('aiDocOverlay');
      const aiDocBack = document.getElementById('aiDocBack');
      const aiDocBg = document.getElementById('aiDocBg');
      const aiDocChatMessages = document.getElementById('aiDocChatMessages');
      const aiDocChatInput = document.getElementById('aiDocChatInput');
      const aiDocChatSend = document.getElementById('aiDocChatSend');
      const aiDocCanvasEmpty = document.getElementById('aiDocCanvasEmpty');
      const aiDocThumbScroll = document.getElementById('aiDocThumbScroll');
      const aiDocCanvasToolbar = document.getElementById('aiDocCanvasToolbar');
      const aiDocExportBtn = document.getElementById('aiDocExportBtn');
      const aiDocMask = document.getElementById('aiDocMask');
      const aiDocMaskText = document.getElementById('aiDocMaskText');
      const aiDocEditOverlay = document.getElementById('aiDocEditOverlay');
      const aiDocEditBack = document.getElementById('aiDocEditBack');
      const aiDocEditBg = document.getElementById('aiDocEditBg');
      const aiDocEditScroll = document.getElementById('aiDocEditScroll');
      const aiDocEditExportBtn = document.getElementById('aiDocEditExportBtn');
      const aiDocUndoBtn = document.getElementById('aiDocUndoBtn');
      const aiDocRedoBtn = document.getElementById('aiDocRedoBtn');
      const aiDocMoveUpBtn = document.getElementById('aiDocMoveUpBtn');
      const aiDocMoveDownBtn = document.getElementById('aiDocMoveDownBtn');
      const aiDocDeleteBtn = document.getElementById('aiDocDeleteBtn');
      const aiDocSelectionStatus = document.getElementById('aiDocSelectionStatus');
      const aiDocFontSizeInput = document.getElementById('aiDocFontSizeInput');
      const aiDocBoldBtn = document.getElementById('aiDocBoldBtn');
      const aiDocAlignLeftBtn = document.getElementById('aiDocAlignLeftBtn');
      const aiDocAlignCenterBtn = document.getElementById('aiDocAlignCenterBtn');
      const aiDocAlignRightBtn = document.getElementById('aiDocAlignRightBtn');
      const aiDocTextColorInput = document.getElementById('aiDocTextColorInput');
      const aiDocBackgroundColorInput = document.getElementById('aiDocBackgroundColorInput');
      const aiDocBorderColorInput = document.getElementById('aiDocBorderColorInput');
      const aiDocMoreStyleBtn = document.getElementById('aiDocMoreStyleBtn');
      const aiDocStyleInspector = document.getElementById('aiDocStyleInspector');
      const aiDocStyleInspectorClose = document.getElementById('aiDocStyleInspectorClose');
      const aiDocLineHeightInput = document.getElementById('aiDocLineHeightInput');
      const aiDocPaddingInput = document.getElementById('aiDocPaddingInput');
      const aiDocBorderWidthInput = document.getElementById('aiDocBorderWidthInput');
      const aiDocOpacityInput = document.getElementById('aiDocOpacityInput');
      const aiDocLineHeightValue = document.getElementById('aiDocLineHeightValue');
      const aiDocPaddingValue = document.getElementById('aiDocPaddingValue');
      const aiDocBorderWidthValue = document.getElementById('aiDocBorderWidthValue');
      const aiDocOpacityValue = document.getElementById('aiDocOpacityValue');
      const aiDocGlobalAlignSelect = document.getElementById('aiDocGlobalAlignSelect');
      const aiDocApplyGlobalStyleBtn = document.getElementById('aiDocApplyGlobalStyleBtn');
      const aiDocSuccessOverlay = document.getElementById('aiDocSuccessOverlay');
      const aiDocSuccessPath = document.getElementById('aiDocSuccessPath');
      const aiDocSuccessOpenFolder = document.getElementById('aiDocSuccessOpenFolder');
      const aiDocSuccessOk = document.getElementById('aiDocSuccessOk');

      let aiDocCleanupFns = [];
      let aiDocDitherInstance = null;
      let aiDocEditDitherInstance = null;
      let aiDocLastExportPath = '';
      let aiDocChatHistory = [];
      let aiDocLayoutData = null; // { pages: [{ regions: [...] }] }
      let aiDocFontRegularBytes = null;
      let aiDocFontBoldBytes = null;
      let aiDocRequestController = null;
      let aiDocRequestTimeoutId = null;
      let aiDocRequestId = 0;
      let aiDocSelectedRegionId = null;
      let aiDocRegionIdSeed = 0;
      let aiDocUndoStack = [];
      let aiDocRedoStack = [];

      const AI_DOC_REQUEST_TIMEOUT_MS = 90_000;
      const AI_DOC_HISTORY_LIMIT = 50;
      const isAiDocEditorDemo = import.meta.env.DEV
        && new URLSearchParams(window.location.search).get('ai-doc-editor-demo') === '1';

      function cancelAiDocRequest() {
        aiDocRequestId += 1;
        if (aiDocRequestTimeoutId !== null) {
          clearTimeout(aiDocRequestTimeoutId);
          aiDocRequestTimeoutId = null;
        }
        if (aiDocRequestController) {
          aiDocRequestController.abort();
          aiDocRequestController = null;
        }
      }

      function finishAiDocRequest(requestId) {
        if (requestId !== aiDocRequestId) return false;
        if (aiDocRequestTimeoutId !== null) {
          clearTimeout(aiDocRequestTimeoutId);
          aiDocRequestTimeoutId = null;
        }
        aiDocRequestController = null;
        return true;
      }

      function appendAiDocHistory(role, content) {
        const compact = compactAiDocHistoryMessage(content);
        if (!compact) return;
        aiDocChatHistory = [...aiDocChatHistory, { role, content: compact }]
          .slice(-AI_DOC_LIMITS.maxHistoryMessages);
      }

      const AI_DOC_PRESET_PROMPTS = [
        { labelKey: 'home.aiDoc.chipRent', prompt: '请帮我生成一份标准个人租房合同，要求：1. 包含出租方和承租方信息栏；2. 明确房屋地址、面积、租金、押金、付款方式；3. 详细列出租赁期限、房屋用途、维修责任；4. 加入违约条款、提前解约条件和费用承担；5. 末尾预留双方签字和日期区域；6. 使用清晰的 A4 商务版式，相关字段用表格行整合，条款使用分级标题和正文。' },
        { labelKey: 'home.aiDoc.chipResign', prompt: '请帮我生成一份正式离职申请书/离职报告，要求：1. 标题为离职报告；2. 包含申请人信息、部门、职位、入职日期；3. 说明离职原因、最后工作日；4. 表达感谢和工作交接意愿；5. 加入交接事项清单；6. 末尾预留签名和日期区域；7. 使用克制、正式的 A4 公文版式。' },
        { labelKey: 'home.aiDoc.chipMeeting', prompt: '请帮我生成一份一页的项目周会会议纪要，要求：1. 包含会议主题、时间、地点、主持人、参会人员；2. 列出会议议程和讨论事项；3. 记录每个议题的结论；4. 待办事项使用紧凑表格行，明确责任人和截止时间；5. 加入下次会议安排；6. 使用信息层次清晰、现代专业的 A4 商务版式。' },
        { labelKey: 'home.aiDoc.chipPrd', prompt: '请帮我生成一份产品需求文档（PRD），要求：1. 包含产品背景、目标用户、核心目标；2. 按功能模块描述需求、业务流程、输入输出和异常处理；3. 加入非功能需求、项目排期、风险说明；4. 使用 A4 专业文档版式，以章节、正文、表格和重点摘要组织内容，不堆砌零散区域。' },
        { labelKey: 'home.aiDoc.chipBusiness', prompt: '请帮我生成一份初创项目商业计划书，要求：1. 包含项目概述、市场痛点、解决方案；2. 分析目标市场、市场规模、竞争对手；3. 描述商业模式、运营计划、团队、财务预测和融资需求；4. 加入风险分析和未来规划；5. 至少 3 页，使用现代、清晰的 A4 商务报告版式，以重点摘要、章节、表格和注释建立视觉层次。' },
        { labelKey: 'home.aiDoc.chipResume', prompt: '请帮我生成一份个人简历，要求：1. 包含个人信息、联系方式、求职意向；2. 列出教育背景、工作经历、专业技能、项目经验和证书荣誉；3. 加入简洁的自我评价；4. 使用一至两页 A4 现代简历版式，以清晰的信息分组和时间层次组织内容。' }
      ];

      const A4_WIDTH = 794;
      const A4_HEIGHT = 1123;

      const AI_DOC_REGION_LABELS = {
        zh: {
          title: '标题', subtitle: '副标题', 'section-heading': '章节标题', 'sub-heading': '小标题',
          body: '正文', 'body-indent': '缩进正文', 'list-item': '列表项', image: '图片',
          signature: '签名', date: '日期', divider: '分隔线', 'page-header': '页眉',
          'page-footer': '页脚', 'table-row': '表格行', note: '注释', emphasis: '重点摘要'
        },
        en: {
          title: 'Title', subtitle: 'Subtitle', 'section-heading': 'Section', 'sub-heading': 'Subheading',
          body: 'Body', 'body-indent': 'Indented body', 'list-item': 'List item', image: 'Image',
          signature: 'Signature', date: 'Date', divider: 'Divider', 'page-header': 'Header',
          'page-footer': 'Footer', 'table-row': 'Table row', note: 'Note', emphasis: 'Emphasis'
        }
      };

      function createAiDocEditorId() {
        aiDocRegionIdSeed += 1;
        return `ai-doc-${Date.now().toString(36)}-${aiDocRegionIdSeed.toString(36)}`;
      }

      function initialAiDocFlowGap(previous, current) {
        if (!previous) return 0;
        if (previous.type === 'table-row' && current.type === 'table-row') return 0;
        if (previous.type === 'title' && current.type === 'subtitle') return 8;
        if (current.type === 'section-heading') return 10;
        return 4;
      }

      function prepareAiDocLayoutForEditing(layout) {
        const pagesNeedingInitialOrder = (layout?.pages || []).map(page => (
          !page.regions.every(region => typeof region.editorId === 'string' && region.editorId)
        ));
        const editable = ensureAiDocEditorIds(layout, createAiDocEditorId);
        editable.pages.forEach((page, pageIndex) => {
          if (pagesNeedingInitialOrder[pageIndex]) {
            page.regions.sort((a, b) => (a.y || 0) - (b.y || 0));
            let previousContent = null;
            page.regions.forEach(region => {
              if (['page-header', 'page-footer'].includes(region.type)) return;
              if (!Number.isFinite(region.flowGap)) {
                region.flowGap = initialAiDocFlowGap(previousContent, region);
              }
              previousContent = region;
            });
          }
        });
        return editable;
      }

      function resetAiDocEditorHistory() {
        aiDocSelectedRegionId = null;
        aiDocUndoStack = [];
        aiDocRedoStack = [];
        updateAiDocEditorControls();
      }

      function findAiDocRegionById(editorId) {
        if (!editorId || !aiDocLayoutData?.pages) return null;
        for (let pageIdx = 0; pageIdx < aiDocLayoutData.pages.length; pageIdx++) {
          const regionIdx = aiDocLayoutData.pages[pageIdx].regions.findIndex(region => region.editorId === editorId);
          if (regionIdx >= 0) {
            return { pageIdx, regionIdx, region: aiDocLayoutData.pages[pageIdx].regions[regionIdx] };
          }
        }
        return null;
      }

      function updateAiDocEditorControls() {
        if (aiDocUndoBtn) aiDocUndoBtn.disabled = aiDocUndoStack.length === 0;
        if (aiDocRedoBtn) aiDocRedoBtn.disabled = aiDocRedoStack.length === 0;

        const selected = findAiDocRegionById(aiDocSelectedRegionId);
        const isEditable = Boolean(selected && !['page-header', 'page-footer'].includes(selected.region.type));
        let canMoveUp = false;
        let canMoveDown = false;
        if (isEditable) {
          const content = aiDocLayoutData.pages[selected.pageIdx].regions
            .filter(region => !['page-header', 'page-footer'].includes(region.type));
          const position = content.findIndex(region => region.editorId === aiDocSelectedRegionId);
          canMoveUp = position > 0;
          canMoveDown = position >= 0 && position < content.length - 1;
        }
        if (aiDocMoveUpBtn) aiDocMoveUpBtn.disabled = !canMoveUp;
        if (aiDocMoveDownBtn) aiDocMoveDownBtn.disabled = !canMoveDown;
        if (aiDocDeleteBtn) aiDocDeleteBtn.disabled = !isEditable;

        const style = selected?.region?.style || {};
        const editableText = Boolean(isEditable && !['image', 'divider'].includes(selected.region.type));
        if (aiDocFontSizeInput) {
          aiDocFontSizeInput.disabled = !editableText;
          if (editableText) aiDocFontSizeInput.value = String(Math.round(selected.region.fontSize || 14));
        }
        if (aiDocBoldBtn) {
          aiDocBoldBtn.disabled = !editableText;
          aiDocBoldBtn.classList.toggle('active', Boolean(editableText && selected.region.bold));
          aiDocBoldBtn.setAttribute('aria-pressed', String(Boolean(editableText && selected.region.bold)));
        }
        const alignmentButtons = { left: aiDocAlignLeftBtn, center: aiDocAlignCenterBtn, right: aiDocAlignRightBtn };
        Object.entries(alignmentButtons).forEach(([alignment, button]) => {
          if (!button) return;
          button.disabled = !editableText;
          button.classList.toggle('active', Boolean(editableText && (selected.region.align || 'left') === alignment));
          button.setAttribute('aria-pressed', String(Boolean(editableText && (selected.region.align || 'left') === alignment)));
        });
        const setColorInput = (input, value, fallback) => {
          if (!input) return;
          input.disabled = !isEditable;
          input.value = /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
          const swatch = input.previousElementSibling;
          if (swatch?.style) {
            if (input.parentElement?.classList.contains('ai-doc-color-control-text')) swatch.style.color = input.value;
            else swatch.style.backgroundColor = input.value;
          }
        };
        setColorInput(aiDocTextColorInput, style.textColor, selected?.region?.type === 'emphasis' ? '#ffffff' : '#242424');
        setColorInput(aiDocBackgroundColorInput, style.backgroundColor, selected?.region?.type === 'emphasis' ? '#1b1b1b' : '#ffffff');
        setColorInput(aiDocBorderColorInput, style.borderColor, '#d8d8d6');
        if (aiDocMoreStyleBtn) aiDocMoreStyleBtn.disabled = !isEditable;
        const syncRange = (input, output, value, fallback, suffix = '') => {
          if (!input) return;
          input.disabled = !isEditable;
          input.value = String(value ?? fallback);
          if (output) output.textContent = `${input.value}${suffix}`;
        };
        syncRange(aiDocLineHeightInput, aiDocLineHeightValue, style.lineHeight, 1.58);
        syncRange(aiDocPaddingInput, aiDocPaddingValue, style.padding, 0);
        syncRange(aiDocBorderWidthInput, aiDocBorderWidthValue, style.borderWidth, 0);
        syncRange(aiDocOpacityInput, aiDocOpacityValue, style.opacity, 1, '%');
        if (aiDocOpacityValue) aiDocOpacityValue.textContent = `${Math.round(Number(aiDocOpacityInput?.value || 1) * 100)}%`;

        if (aiDocSelectionStatus) {
          if (!selected) {
            aiDocSelectionStatus.textContent = t('home.aiDoc.noLayerSelected');
          } else {
            const lang = getLang() === 'en' ? 'en' : 'zh';
            const label = AI_DOC_REGION_LABELS[lang][selected.region.type] || selected.region.type;
            aiDocSelectionStatus.textContent = t('home.aiDoc.selectedLayer', {
              type: label,
              width: Math.round(selected.region.w || 0)
            });
          }
        }
      }

      function applyAiDocSelectedStyle(patch) {
        const selected = findAiDocRegionById(aiDocSelectedRegionId);
        if (!selected || ['page-header', 'page-footer'].includes(selected.region.type)) return;
        const previousLayout = cloneAiDocLayout(aiDocLayoutData);
        const typography = ['fontSize', 'bold', 'align'];
        typography.forEach(key => {
          if (patch[key] !== undefined) selected.region[key] = patch[key];
        });
        const stylePatch = Object.fromEntries(Object.entries(patch).filter(([key]) => !typography.includes(key)));
        if (Object.keys(stylePatch).length) selected.region.style = { ...(selected.region.style || {}), ...stylePatch };
        recordAiDocEdit(previousLayout);
        renderAiDocEditPages(aiDocLayoutData);
      }

      function applyAiDocGlobalAlignment() {
        const align = aiDocGlobalAlignSelect?.value;
        if (!align || !aiDocLayoutData?.pages) return;
        const previousLayout = cloneAiDocLayout(aiDocLayoutData);
        let changed = false;
        aiDocLayoutData.pages.forEach(page => page.regions.forEach(region => {
          if (['image', 'divider', 'page-header', 'page-footer'].includes(region.type)) return;
          if (region.align !== align) { region.align = align; changed = true; }
        }));
        if (!changed) return;
        recordAiDocEdit(previousLayout);
        renderAiDocEditPages(aiDocLayoutData);
      }

      function selectAiDocRegion(editorId) {
        aiDocSelectedRegionId = editorId || null;
        if (aiDocEditScroll) {
          aiDocEditScroll.querySelectorAll('.ai-doc-region.selected').forEach(regionEl => {
            regionEl.classList.toggle('selected', regionEl.dataset.editorId === aiDocSelectedRegionId);
          });
          const selectedEl = aiDocSelectedRegionId
            ? aiDocEditScroll.querySelector(`.ai-doc-region[data-editor-id="${aiDocSelectedRegionId}"]`)
            : null;
          if (selectedEl) selectedEl.classList.add('selected');
        }
        updateAiDocEditorControls();
      }

      function recordAiDocEdit(previousLayout) {
        if (!previousLayout) return;
        aiDocUndoStack.push(previousLayout);
        if (aiDocUndoStack.length > AI_DOC_HISTORY_LIMIT) aiDocUndoStack.shift();
        aiDocRedoStack = [];
        updateAiDocEditorControls();
      }

      function applyAiDocHistoryLayout(layout) {
        aiDocLayoutData = prepareAiDocLayoutForEditing(layout);
        if (!findAiDocRegionById(aiDocSelectedRegionId)) aiDocSelectedRegionId = null;
        renderAiDocEditPages(aiDocLayoutData);
      }

      function undoAiDocEdit() {
        if (!aiDocUndoStack.length || !aiDocLayoutData) return;
        aiDocRedoStack.push(cloneAiDocLayout(aiDocLayoutData));
        applyAiDocHistoryLayout(aiDocUndoStack.pop());
        updateAiDocEditorControls();
      }

      function redoAiDocEdit() {
        if (!aiDocRedoStack.length || !aiDocLayoutData) return;
        aiDocUndoStack.push(cloneAiDocLayout(aiDocLayoutData));
        applyAiDocHistoryLayout(aiDocRedoStack.pop());
        updateAiDocEditorControls();
      }

      function moveSelectedAiDocRegion(direction) {
        if (!aiDocLayoutData || !aiDocSelectedRegionId) return;
        const previousLayout = cloneAiDocLayout(aiDocLayoutData);
        const result = moveAiDocRegionInFlow(aiDocLayoutData, aiDocSelectedRegionId, direction);
        if (!result.moved) return;
        aiDocLayoutData = result.layout;
        recordAiDocEdit(previousLayout);
        renderAiDocEditPages(aiDocLayoutData);
      }

      function deleteSelectedAiDocRegion() {
        const selected = findAiDocRegionById(aiDocSelectedRegionId);
        if (!selected || ['page-header', 'page-footer'].includes(selected.region.type)) return;
        const previousLayout = cloneAiDocLayout(aiDocLayoutData);
        aiDocLayoutData.pages[selected.pageIdx].regions.splice(selected.regionIdx, 1);
        aiDocSelectedRegionId = null;
        recordAiDocEdit(previousLayout);
        renderAiDocEditPages(aiDocLayoutData);
      }

      function openAiDocOverlay() {
        if (!aiDocOverlay) return;
        aiDocOverlay.classList.add('visible');
        resetAiDocState();
        if (aiDocBg && !aiDocDitherInstance) {
          aiDocDitherInstance = initDither(aiDocBg, {
            waveColor: [0.38823529411764707, 0.4, 0.9450980392156862],
            colorNum: 40,
            pixelSize: 2,
            waveAmplitude: 0,
            waveFrequency: 0,
            waveSpeed: 0.07
          });
        }
      }

      function closeAiDocOverlay() {
        if (!aiDocOverlay) return;
        aiDocOverlay.classList.remove('visible');
        resetAiDocState();
        if (aiDocDitherInstance) {
          aiDocDitherInstance();
          aiDocDitherInstance = null;
        }
      }

      function resetAiDocState() {
        cancelAiDocRequest();
        hideAiDocMask();
        aiDocChatHistory = [];
        aiDocLayoutData = null;
        resetAiDocEditorHistory();
        // Clean up all document-level event listeners from regions
        aiDocCleanupFns.forEach(fn => fn());
        aiDocCleanupFns = [];
        if (aiDocChatMessages) {
          aiDocChatMessages.innerHTML = '';
          addAiDocChatMsg('ai', t('home.aiDoc.welcome'));
          addAiDocPromptChips();
        }
        if (aiDocChatInput) aiDocChatInput.value = '';
        if (aiDocChatSend) aiDocChatSend.disabled = true;
        if (aiDocCanvasEmpty) aiDocCanvasEmpty.style.display = '';
        if (aiDocThumbScroll) {
          aiDocThumbScroll.style.display = 'none';
          aiDocThumbScroll.innerHTML = '';
        }
        if (aiDocCanvasToolbar) aiDocCanvasToolbar.style.display = 'none';
      }

      // Conversations use the local ToolKnit mark instead of account-specific avatars.
      function fillUserAvatar(avatarEl) {
        const img = document.createElement('img');
        img.src = '/assets/toolknit-icon.png';
        img.alt = 'ToolKnit';
        img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
        avatarEl.replaceChildren(img);
      }

      function addAiDocChatMsg(role, text, isGenLink = false) {
        if (!aiDocChatMessages) return;
        const msg = document.createElement('div');
        msg.className = `ai-doc-chat-msg ai-doc-chat-msg-${role}`;
        const avatar = document.createElement('div');
        avatar.className = 'ai-doc-chat-avatar';
        if (role === 'ai') {
          const img = document.createElement('img');
          img.src = '/assets/toolknit-icon.png';
          img.alt = 'AI';
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.borderRadius = '50%';
          img.style.objectFit = 'cover';
          avatar.appendChild(img);
        } else {
          fillUserAvatar(avatar);
        }
        const bubble = document.createElement('div');
        bubble.className = 'ai-doc-chat-bubble';
        if (isGenLink) bubble.classList.add('ai-doc-gen-link');
        bubble.textContent = text;
        msg.appendChild(avatar);
        msg.appendChild(bubble);
        aiDocChatMessages.appendChild(msg);
        aiDocChatMessages.scrollTop = aiDocChatMessages.scrollHeight;
        if (window.lucide) window.lucide.createIcons();
        return bubble;
      }

      function addAiDocPromptChips() {
        if (!aiDocChatMessages) return;
        const msg = document.createElement('div');
        msg.className = 'ai-doc-chat-msg ai-doc-chat-msg-ai';
        const avatar = document.createElement('div');
        avatar.className = 'ai-doc-chat-avatar';
        const img = document.createElement('img');
        img.src = '/assets/toolknit-icon.png';
        img.alt = 'AI';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.borderRadius = '50%';
        img.style.objectFit = 'cover';
        avatar.appendChild(img);
        const bubble = document.createElement('div');
        bubble.className = 'ai-doc-chat-bubble ai-doc-chip-bubble';
        const title = document.createElement('div');
        title.className = 'ai-doc-chip-title';
        title.textContent = t('home.aiDoc.chipTitle');
        const chips = document.createElement('div');
        chips.className = 'ai-doc-prompt-chips';
        AI_DOC_PRESET_PROMPTS.forEach(item => {
          const chip = document.createElement('button');
          chip.className = 'ai-doc-prompt-chip';
          chip.textContent = t(item.labelKey);
          chip.dataset.prompt = item.prompt;
          chips.appendChild(chip);
        });
        bubble.appendChild(title);
        bubble.appendChild(chips);
        msg.appendChild(avatar);
        msg.appendChild(bubble);
        aiDocChatMessages.appendChild(msg);
        aiDocChatMessages.scrollTop = aiDocChatMessages.scrollHeight;
      }

      function showAiDocMask(text) {
        if (aiDocMaskText) aiDocMaskText.textContent = text;
        if (aiDocMask) aiDocMask.classList.add('visible');
      }

      function hideAiDocMask() {
        if (aiDocMask) aiDocMask.classList.remove('visible');
      }

      async function handleAiDocSend() {
        const text = aiDocChatInput?.value?.trim();
        if (!text) return;
        if (text.length > AI_DOC_LIMITS.maxPromptChars) {
          addAiDocChatMsg('ai', t('home.aiDoc.promptTooLong', { max: AI_DOC_LIMITS.maxPromptChars }));
          return;
        }
        if (aiDocRequestController) return;

        const controller = new AbortController();
        const requestId = ++aiDocRequestId;
        let timedOut = false;
        aiDocRequestController = controller;
        aiDocRequestTimeoutId = setTimeout(() => {
          if (requestId !== aiDocRequestId || controller.signal.aborted) return;
          timedOut = true;
          controller.abort();
        }, AI_DOC_REQUEST_TIMEOUT_MS);

        addAiDocChatMsg('user', text);
        aiDocChatInput.value = '';
        aiDocChatSend.disabled = true;
        appendAiDocHistory('user', text);

        showAiDocMask(t('home.aiDoc.thinking'));

        try {
          const systemPrompt = `你是一位顶级文档排版设计师，擅长生成内容充实、排版精美的专业 A4 文档。
用户会描述他们需要的文档类型和内容，你的任务是通过对话收集足够信息后生成一份与需求页数相符的高质量文档。

## 核心原则
1. **内容完整且克制**：每个 region 的 text 必须有实际内容，不能使用占位符；但绝不为显得详实而重复、扩写或堆砌文字
2. **自然排版**：按内容所需高度排列，region 之间保持 6-16px 间距；不要为了填满页面而加入内容，也不要因内容很短而硬塞到页面底部
3. **文字适量**：正文 region 的 text 应是完整、清晰的段落（通常 20-80 字），不要只写一两个词，也不要超过实际页面承载能力
4. **页数服从需求**：用户明确指定页数时必须严格遵从；不得为了填满页面、凑页数或重复内容而增加页面
5. **合理分区**：使用足够的 region 组织内容，但不要把一句话、一个字段或一个表格单元格拆成多个无意义的 region

## 专业版式原则
- 采用现代黑白商务报告风格：强标题、清晰章节、克制的灰阶信息块，不使用装饰性符号堆砌
- 元数据（时间、地点、人员、编号）优先合并成 2-4 列的 table-row，不要逐字段生成独立正文
- 待办、计划、对比和责任清单必须使用 table-row，每一行用“ | ”分隔列，列顺序保持一致
- 重要结论使用 emphasis，补充说明和下次安排使用 note；普通内容不要滥用强调样式
- title 下可使用一条简短 subtitle，但不要生成页眉和页脚，ToolKnit 会自动完成页面装饰和准确页码

## A4 画布规格
- 宽 794px × 高 1123px
- 页边距：上下 60px，左右 56px
- 内容区域：x: 56-738, y: 60-1063
- 正文满宽：x=56, w=682
- 缩进正文：x=76, w=662

## region type 样式指南
1. **title**：居中, fontSize 28-32, bold, y=60, h=56
2. **subtitle**：居中, fontSize 13-15, bold=false, y=124, h=24, 灰色
3. **section-heading**：左对齐, fontSize 16-19, bold, 上方留 18px, h=34
4. **sub-heading**：左对齐, fontSize 14-16, bold, 上方留 10px, h=26
5. **body**：左对齐, fontSize 13.5-15, h=根据文字行数精确计算（行数×22+8）
6. **body-indent**：左对齐, fontSize 13.5-15, x=76, w=662, 用于条款正文
7. **list-item**：左对齐, fontSize 13-14, x=76, w=662, text前加"• "或"1. "
8. **image**：图片占位, label 描述内容
9. **signature**：fontSize 13-14, 签字线
10. **date**：fontSize 13-14
11. **divider**：h=2, text="", 视觉分隔
12. **page-header**：居中, fontSize 9, y=30, h=18, 灰色
13. **page-footer**：居中, fontSize 9, y=1085, h=18, 灰色
14. **table-row**：fontSize 12-14, text用" | "分隔 2-4 列，相邻行列数必须一致
15. **note**（注释/提示）：左对齐, fontSize 11.5-13, x=76, w=662, 用于补充说明
16. **emphasis**（强调段落）：左对齐, fontSize 13-15, bold=true, 用于重要结论摘要

## 布局计算公式
- 正文字号 14px，行高约 22px
- 一个 body region 的高度 = 文字行数 × 22 + 8
- 估算文字行数：中文字符数 / (w / fontSize) ≈ 字符数 / 48
- region 之间的 y 间距 = 上一个 region 的 y + h + 间距(10-16px)
- 每页可用高度约 1000px（60 到 1060）

## 输出长度硬性限制（极其重要，违反会导致文档无法显示）
- 由于模型单次输出长度有限，最终 JSON 总字符数绝对不能超过 13000 字符，否则会被截断导致用户看不到文档
- 文档总页数必须控制在 1-8 页之间，绝对不要超过 8 页
- 用户要求“1 页”或“一页”时，pages 数组必须恰好只有 1 项，且该页最多 20 个内容 region；未指定页数的简短需求默认生成 1 页
- 对于单页文档，优先将相关字段合并为一条 table-row 或一个紧凑正文 region，宁可精炼文字，也绝不能生成第二页
- 如果用户要求超过 8 页（例如"生成15页"），你必须把内容精炼浓缩到 8 页以内完成，并在 summary 中说明"已将内容浓缩为 N 页以保证完整生成"
- 每页通常使用 3-16 个内容 region；简单单页文档不需要为了凑数量堆砌 region
- 每个正文 region 的 text 控制在 1-3 行（20-80字），简明扼要，不要冗长
- 不要输出 page-header 或 page-footer；ToolKnit 会在最终渲染后自动生成准确页码
- 优先保证文档结构完整（标题、章节、正文、结尾齐全），宁可内容精简也不要被截断

## 内容组织建议
- 单页文档：标题 + 必要信息 + 核心章节/正文 + 结尾信息，内容应完整而简洁
- 多页文档：第一页概述，中间页按主题分章节，最后页总结、附则、签字区或日期
- 只补充用户需求直接相关的信息；始终遵守用户页数、8 页和 13000 字符上限

## 图片占位确认流程（硬性规则）
1. 如果用户描述中明确要求图片占位（如"要有X张图片"、"包含图片占位"、"插入图片"等），不要直接生成 JSON，必须先用 ready: false 回复确认。
2. 确认内容应包含：建议的图片位置（如"第1页顶部、第3页中部"）、每张图片的用途/描述，并询问用户是否确认。示例：{"ready": false, "question": "我计划在以下位置为您插入图片占位符：\n1. 第1页标题下方（封面图）\n2. 第2页功能概述区（界面截图）\n3. 第3页数据展示处（统计图）\n\n请确认是否按此方案生成，或告诉我您的调整要求。"}
3. 只有在用户确认后，才能在最终 JSON 中输出 image 类型 region。不得在未确认时直接生成图片占位。
4. 用户确认后，最终 JSON 必须严格包含用户要求的图片数量，每个图片 region 必须有 type: "image"、label（描述图片用途）和合适的 w/h（建议 w=300-500，h=180-320，根据页面布局动态调整）。
5. 如果用户未要求图片，最终 JSON 中不得出现 type: "image" 的 region。

## 对话规则
1. 信息不完整时追问（最多 3 轮）
2. 信息完整且图片占位已确认（如无需图片则直接）时返回 JSON
3. 当需要返回 JSON 时，必须直接返回原始 JSON 字符串，不要任何 markdown 代码块（如 \`\`\`json ... \`\`\` 或 \`\`\` ... \`\`\`），不要添加任何解释性文字、前缀或后缀。输出必须是合法 JSON 字符串本身，否则前端无法解析
4. 如果 JSON 输出被代码块标记包裹，前端会解析失败，用户看不到生成的文档
5. 闲聊或不需要生成文档时，返回普通文字即可，不要带 JSON

## JSON 示例（注意结构、层级和内容密度）
{"ready":true,"summary":"已生成一页项目周会会议纪要","pages":[{"regions":[{"type":"title","x":56,"y":60,"w":682,"h":50,"text":"项目周会会议纪要","fontSize":30,"bold":true,"align":"center"},{"type":"subtitle","x":56,"y":120,"w":682,"h":24,"text":"PRODUCT DELIVERY / WEEK 25","fontSize":14,"bold":false,"align":"center"},{"type":"table-row","x":56,"y":164,"w":682,"h":42,"text":"会议时间 | 2026年8月2日 14:00 | 主持人 | 张伟","fontSize":13,"bold":false,"align":"left"},{"type":"table-row","x":56,"y":206,"w":682,"h":42,"text":"会议地点 | 3F 会议室 A | 参会人数 | 6 人","fontSize":13,"bold":false,"align":"left"},{"type":"section-heading","x":56,"y":280,"w":682,"h":34,"text":"01 / 本周结论","fontSize":18,"bold":true,"align":"left"},{"type":"emphasis","x":56,"y":334,"w":682,"h":54,"text":"支付链路进入联调阶段，本周优先完成异常回退与第三方接口稳定性验证。","fontSize":14,"bold":true,"align":"left"},{"type":"body","x":56,"y":408,"w":682,"h":62,"text":"用户中心模块已完成设计评审，前端进入开发排期。数据报表继续补充复杂筛选场景，测试团队同步准备回归用例。","fontSize":14.5,"bold":false,"align":"left"},{"type":"section-heading","x":56,"y":502,"w":682,"h":34,"text":"02 / 待办事项","fontSize":18,"bold":true,"align":"left"},{"type":"table-row","x":56,"y":556,"w":682,"h":42,"text":"事项 | 责任人 | 截止日期 | 优先级","fontSize":13,"bold":true,"align":"left"},{"type":"table-row","x":56,"y":598,"w":682,"h":42,"text":"完成支付页面开发 | 李娜 | 08-07 | 高","fontSize":13,"bold":false,"align":"left"},{"type":"table-row","x":56,"y":640,"w":682,"h":42,"text":"验证异常回退链路 | 王强 | 08-08 | 高","fontSize":13,"bold":false,"align":"left"},{"type":"note","x":56,"y":706,"w":682,"h":48,"text":"下次会议：8月9日 14:00。请各责任人在会前更新任务状态并附上可验证结果。","fontSize":12.5,"bold":false,"align":"left"}]}]}

坐标系：x 范围 0-794, y 范围 0-1123`;

          const content = await callDeepSeek([
            { role: 'system', content: systemPrompt },
            ...aiDocChatHistory.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
          ], controller.signal, 8192);

          if (requestId !== aiDocRequestId) return;
          if (typeof content !== 'string' || !content.trim()) {
            throw new AiDocLayoutError('invalid_layout', 'AI returned an empty response.');
          }
          if (content.length > AI_DOC_LIMITS.maxResponseChars) {
            throw new AiDocLayoutError('response_too_large', 'AI response exceeds the supported size.');
          }

          // Try to extract JSON from response using balanced brace matching
          const jsonStr = extractJson(content);
          if (!jsonStr) {
            // No JSON, treat as plain conversation
            const response = compactAiDocHistoryMessage(content);
            addAiDocChatMsg('ai', response);
            appendAiDocHistory('assistant', response);
            return;
          }

          let parsed;
          try {
            parsed = JSON.parse(jsonStr);
          } catch (parseErr) {
            console.error('[AI Doc] JSON parse failed:', parseErr, jsonStr?.slice(0, 500));
            // Try once more with aggressive cleanup
            const fallbackJson = jsonStr.replace(/[\u0000-\u001F\uFEFF\uFFFD]/g, ' ').replace(/\n/g, '\\n');
            try {
              parsed = JSON.parse(fallbackJson);
            } catch (e2) {
              addAiDocChatMsg('ai', t('home.aiDoc.parseError'));
              return;
            }
          }

          if (parsed.ready === false && parsed.question) {
            const question = compactAiDocHistoryMessage(parsed.question);
            if (!question) throw new AiDocLayoutError('invalid_layout', 'AI question is empty.');
            addAiDocChatMsg('ai', question);
            appendAiDocHistory('assistant', question);
            return;
          }

          if (parsed.ready === true || (parsed.ready === undefined && Array.isArray(parsed.columns) && Array.isArray(parsed.rows))) {
            const normalizedLayout = normalizeAiDocLayout(parsed);
            // Show summary as chat message with click-to-preview
            const summaryText = normalizedLayout.summary || t('home.aiDoc.docReady');
            const bubble = addAiDocChatMsg('ai', summaryText, true);
            aiDocLayoutData = prepareAiDocLayoutForEditing(normalizedLayout);
            resetAiDocEditorHistory();
            appendAiDocHistory('assistant', `文档已生成：${summaryText}。后续如需修改，请说明要调整的内容。`);
            bubble.addEventListener('click', () => {
              openAiDocEditOverlay();
            });
            // Auto-render thumbnails immediately
            renderAiDocThumbnails(aiDocLayoutData);
          } else {
            // Never surface raw, malformed model JSON as a user-facing chat message.
            console.warn('[AI Doc] parsed missing ready/pages:', parsed);
            addAiDocChatMsg('ai', t('home.aiDoc.parseError'));
          }
        } catch (e) {
          if (requestId !== aiDocRequestId) return;
          console.error('[AI Doc] Error:', e);
          if (controller.signal.aborted) {
            if (timedOut) addAiDocChatMsg('ai', t('home.aiDoc.requestTimeout'));
          } else if (e instanceof AiDocLayoutError) {
            const errorMessageKey = {
              response_too_large: 'home.aiDoc.responseTooLarge',
              too_many_pages: 'home.aiDoc.tooManyPages',
              too_many_regions: 'home.aiDoc.tooManyRegions',
              region_text_too_large: 'home.aiDoc.regionTextTooLarge',
              field_text_too_large: 'home.aiDoc.regionTextTooLarge',
              document_text_too_large: 'home.aiDoc.documentTextTooLarge'
            }[e.code] || 'home.aiDoc.parseError';
            addAiDocChatMsg('ai', t(errorMessageKey));
          } else {
            addAiDocChatMsg('ai', t('home.aiDoc.networkError'));
          }
        } finally {
          if (finishAiDocRequest(requestId)) {
            hideAiDocMask();
            aiDocChatSend.disabled = !aiDocChatInput?.value?.trim();
          }
        }
      }

      // Render read-only horizontal thumbnails
      function renderAiDocThumbnails(data) {
        if (!aiDocThumbScroll || !data.pages) return;
        if (aiDocCanvasEmpty) aiDocCanvasEmpty.style.display = 'none';
        aiDocThumbScroll.style.display = '';
        if (aiDocCanvasToolbar) aiDocCanvasToolbar.style.display = '';
        aiDocThumbScroll.innerHTML = '';

        data.pages.forEach((page, pageIdx) => {
          const thumb = document.createElement('div');
          thumb.className = 'ai-doc-thumb';

          // Scaled content (read-only, no pointer events)
          const content = document.createElement('div');
          content.className = 'ai-doc-thumb-content';
          if (page.regions) {
            page.regions.forEach((region, regionIdx) => {
              const el = createAiDocRegionReadOnly(region);
              if (el) content.appendChild(el);
            });
          }
          thumb.appendChild(content);

          // Hover overlay with blur + hint text
          const overlay = document.createElement('div');
          overlay.className = 'ai-doc-thumb-overlay';
          const overlayText = document.createElement('div');
          overlayText.className = 'ai-doc-thumb-overlay-text';
          overlayText.textContent = t('home.aiDoc.clickToEdit');
          overlay.appendChild(overlayText);
          thumb.appendChild(overlay);

          // Page number
          const pageNum = document.createElement('div');
          pageNum.className = 'ai-doc-thumb-num';
          pageNum.textContent = `${pageIdx + 1} / ${data.pages.length}`;
          thumb.appendChild(pageNum);

          // Click to open edit overlay
          thumb.addEventListener('click', () => openAiDocEditOverlay());

          aiDocThumbScroll.appendChild(thumb);
        });
        if (window.lucide) window.lucide.createIcons();
      }

      // Read-only region for thumbnails (no drag, no resize, no edit)
      function renderAiDocTableCells(textEl, text) {
        const cells = String(text || '').split('|').map(cell => cell.trim()).filter(Boolean);
        if (cells.length < 2) {
          textEl.textContent = text || '';
          return;
        }
        textEl.replaceChildren(...cells.map(cellText => {
          const cell = document.createElement('span');
          cell.className = 'ai-doc-table-cell';
          cell.textContent = cellText;
          return cell;
        }));
      }

      function createAiDocRegionReadOnly(region) {
        const el = document.createElement('div');
        el.className = 'ai-doc-region';
        el.dataset.regionType = region.type;
        if (region.type === 'table-row' && region.bold) el.dataset.tableHeader = 'true';
        el.style.left = (region.x || 0) + 'px';
        el.style.top = (region.y || 0) + 'px';
        el.style.width = (region.w || 200) + 'px';
        el.style.minHeight = (region.h || 40) + 'px';
        el.style.height = 'auto';

        // Keep the editor preview faithful to the PDF renderer. Defaults remain
        // type-driven in CSS; explicit user styles always win through inline CSS.
        const regionStyle = region.style || {};
        if (regionStyle.backgroundColor) el.style.backgroundColor = regionStyle.backgroundColor;
        if (regionStyle.borderColor) el.style.borderColor = regionStyle.borderColor;
        if (regionStyle.borderWidth !== undefined) {
          el.style.borderStyle = 'solid';
          el.style.borderWidth = `${regionStyle.borderWidth}px`;
        }
        if (regionStyle.opacity !== undefined) el.style.opacity = String(regionStyle.opacity);
        el.style.cursor = 'default';
        el.style.outline = 'none';

        if (region.type === 'image') {
          el.classList.add('ai-doc-region-image');
          if (region.imageData) {
            const img = document.createElement('img');
            img.src = region.imageData;
            el.appendChild(img);
          } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'ai-doc-img-placeholder';
            placeholder.innerHTML = `<i data-lucide="image"></i><span>${escapeHtml(region.label || t('home.aiDoc.imgPlaceholder'))}</span>`;
            el.appendChild(placeholder);
          }
        } else if (region.type === 'divider') {
          const dividerEl = document.createElement('div');
          dividerEl.style.width = '100%';
          dividerEl.style.height = '1px';
          dividerEl.style.background = '#ccc';
          dividerEl.style.marginTop = '4px';
          el.appendChild(dividerEl);
        } else {
          const textEl = document.createElement('div');
          textEl.className = 'ai-doc-region-text';
          textEl.textContent = region.text || '';
          textEl.style.fontWeight = region.bold ? 'bold' : 'normal';
          textEl.style.textAlign = region.align || 'left';
          textEl.style.fontSize = (region.fontSize || 12) + 'px';

          switch (region.type) {
            case 'title':
              textEl.style.fontWeight = 'bold';
              textEl.style.fontSize = (region.fontSize || 24) + 'px';
              break;
            case 'subtitle':
              textEl.style.color = '#666';
              textEl.style.fontSize = (region.fontSize || 13) + 'px';
              break;
            case 'section-heading':
              textEl.style.fontWeight = 'bold';
              textEl.style.fontSize = (region.fontSize || 14) + 'px';
              textEl.style.borderBottom = '1px solid #ddd';
              textEl.style.paddingBottom = '4px';
              break;
            case 'sub-heading':
              textEl.style.fontWeight = 'bold';
              textEl.style.fontSize = (region.fontSize || 12) + 'px';
              break;
            case 'page-header':
            case 'page-footer':
              textEl.style.color = '#999';
              textEl.style.fontSize = (region.fontSize || 9) + 'px';
              break;
            case 'table-row':
              textEl.style.fontSize = (region.fontSize || 13) + 'px';
              break;
            case 'note':
              textEl.style.fontSize = (region.fontSize || 10.5) + 'px';
              textEl.style.color = '#888';
              textEl.style.fontStyle = 'italic';
              break;
            case 'emphasis':
              textEl.style.fontWeight = 'bold';
              textEl.style.fontSize = (region.fontSize || 12) + 'px';
              break;
            default:
              textEl.style.fontSize = (region.fontSize || 14) + 'px';
          }
          if (region.type === 'table-row') renderAiDocTableCells(textEl, region.text);
          el.appendChild(textEl);
        }
        return el;
      }

      // Open full-screen edit overlay
      function openAiDocEditOverlay() {
        if (!aiDocEditOverlay || !aiDocLayoutData) return;
        aiDocLayoutData = prepareAiDocLayoutForEditing(aiDocLayoutData);
        aiDocEditOverlay.classList.add('visible');
        // Clean up previous edit listeners
        aiDocCleanupFns.forEach(fn => fn());
        aiDocCleanupFns = [];
        // The first opening starts from the document top; later edits preserve
        // this container's viewport through renderAiDocEditPages.
        if (aiDocEditScroll) {
          aiDocEditScroll.scrollTop = 0;
          aiDocEditScroll.scrollLeft = 0;
        }
        renderAiDocEditPages(aiDocLayoutData, { preserveScroll: false });
        // Init dither background for edit overlay
        if (aiDocEditBg && !aiDocEditDitherInstance) {
          aiDocEditDitherInstance = initDither(aiDocEditBg, {
            waveColor: [0.38823529411764707, 0.4, 0.9450980392156862],
            colorNum: 40,
            pixelSize: 2,
            waveAmplitude: 0,
            waveFrequency: 0,
            waveSpeed: 0.07
          });
        }
      }

      function closeAiDocEditOverlay() {
        if (!aiDocEditOverlay) return;
        aiDocEditOverlay.classList.remove('visible');
        // Clean up edit listeners
        aiDocCleanupFns.forEach(fn => fn());
        aiDocCleanupFns = [];
        if (aiDocEditScroll) aiDocEditScroll.innerHTML = '';
        if (aiDocLayoutData) renderAiDocThumbnails(aiDocLayoutData);
        if (aiDocEditDitherInstance) {
          aiDocEditDitherInstance();
          aiDocEditDitherInstance = null;
        }
      }

      // Render full-size A4 pages in edit overlay (with editing enabled)
      function renderAiDocEditPages(sourceData, { preserveScroll = true } = {}) {
        if (!aiDocEditScroll || !sourceData?.pages) return;
        // Rebuilding the editable pages briefly removes all scrollable height.
        // Capture it first and restore it after the new DOM has been laid out.
        const previousScroll = preserveScroll
          ? { top: aiDocEditScroll.scrollTop, left: aiDocEditScroll.scrollLeft }
          : null;
        // Reflow must never mutate the model-normalized source. Local edits are
        // applied to this shallow editable copy; data URLs remain immutable strings.
        const data = prepareAiDocLayoutForEditing(sourceData);
        // Clean up previous drag/resize listeners to prevent leak when reflowing
        // (uploadAiDocImage triggers reflow repeatedly; without this, document-level
        // mousemove/mouseup listeners accumulate and cause drag glitches + slowdown).
        aiDocCleanupFns.forEach(fn => fn());
        aiDocCleanupFns = [];
        aiDocEditScroll.innerHTML = '';

        const PAGE_BOTTOM = 1060;
        const PAGE_TOP = 60;
        const GAP = 12;
        const HEADER_Y = 30;
        const FOOTER_Y = 1085;

        const newPages = [];

        const createEditablePage = () => {
          const pageElement = document.createElement('div');
          pageElement.className = 'ai-doc-page';
          pageElement.style.width = A4_WIDTH + 'px';
          pageElement.style.minHeight = A4_HEIGHT + 'px';
          pageElement.addEventListener('mousedown', event => {
            if (event.target === pageElement) selectAiDocRegion(null);
          });
          aiDocEditScroll.appendChild(pageElement);
          return pageElement;
        };

        const getEditorFlowGap = (previous, current) => {
          if (!previous) return 0;
          if (Number.isFinite(current.flowGap)) return Math.max(0, Math.min(42, current.flowGap));
          if (previous.type === 'table-row' && current.type === 'table-row') return 0;
          if (previous.type === 'title' && current.type === 'subtitle') return 10;
          if (current.type === 'section-heading') return 20;
          return GAP;
        };

        const balancePageSpacing = (pageElement, regions) => {
          const content = regions.filter(region => !['page-header', 'page-footer'].includes(region.type));
          if (content.length < 5) return;
          const lastRegion = content[content.length - 1];
          const usedBottom = (lastRegion.y || PAGE_TOP) + (lastRegion.h || 0);
          if (usedBottom >= 900) return;
          const expandableGapIndexes = content
            .map((region, index) => index > 0 && getEditorFlowGap(content[index - 1], region) > 0 ? index : -1)
            .filter(index => index >= 0);
          if (!expandableGapIndexes.length) return;
          const extraGap = Math.min(28, Math.max(0, (920 - usedBottom) / expandableGapIndexes.length));
          if (extraGap < 1) return;
          let accumulatedOffset = 0;
          content.forEach((region, index) => {
            if (expandableGapIndexes.includes(index)) {
              const previous = content[index - 1];
              region.flowGap = Math.round((getEditorFlowGap(previous, region) + extraGap) * 100) / 100;
              accumulatedOffset += extraGap;
            }
            if (accumulatedOffset === 0) return;
            region.y += accumulatedOffset;
            const regionElement = pageElement.querySelector(`[data-editor-id="${region.editorId}"]`);
            if (regionElement) regionElement.style.top = region.y + 'px';
          });
        };

        // Process each original page separately, preserving AI page structure
        data.pages.forEach((page, originalPageIdx) => {
          if (!page.regions || page.regions.length === 0) return;

          const sorted = [...page.regions];
          const header = sorted.find(r => r.type === 'page-header');
          const footer = sorted.find(r => r.type === 'page-footer');
          const contentRegions = sorted.filter(r => r.type !== 'page-header' && r.type !== 'page-footer');

          const appendFooter = (targetPage, targetPageIdx, targetRegions) => {
            const fallbackFooter = {
              type: 'page-footer', x: 56, y: FOOTER_Y, w: 682, h: 18,
              text: '', fontSize: 9, bold: false, align: 'center'
            };
            // Page labels are filled once every actual page is known. Never
            // reuse a model-provided label such as "1 / 1" after reflow.
            const f = {
              ...(footer || fallbackFooter),
              editorId: createAiDocEditorId(),
              y: FOOTER_Y,
              text: ''
            };
            const fEl = createAiDocRegion(f, targetPageIdx, targetRegions.length);
            if (fEl) {
              targetPage.appendChild(fEl);
              targetRegions.push(f);
            }
          };

          const minimumRegionHeight = (region) => {
            if (region.type === 'image') return region.imageHeight || region.h || 100;
            if (region.type === 'divider') return 2;
            if (region.type === 'title') return 32;
            if (region.type === 'section-heading') return 24;
            return 16;
          };

          // pageIdx must always equal this page's final index in newPages so that
          // uploadAiDocImage / drag / resize write back to the correct region.
          let pageIdx = newPages.length;

          // Start the first page for this original page
          let pageDiv = createEditablePage();

          let currentPageRegions = [];
          let currentY = PAGE_TOP;
          let previousContentRegion = null;

          // Add header to first page
          if (header) {
            const h = { ...header, y: HEADER_Y };
            const hEl = createAiDocRegion(h, pageIdx, 0);
            if (hEl) {
              pageDiv.appendChild(hEl);
              currentPageRegions.push(h);
            }
          }

          for (const r of contentRegions) {
            const gapBefore = getEditorFlowGap(previousContentRegion, r);
            r.y = currentY + gapBefore;
            let el = createAiDocRegion(r, pageIdx, currentPageRegions.length);
            if (!el) continue;

            pageDiv.appendChild(el);
            // Model-provided heights are estimates. Measure the real rendered
            // text without that estimate first; otherwise harmless overlarge
            // regions create artificial pages and blank PDF tails.
            if (r.type !== 'image' && r.type !== 'divider') el.style.minHeight = '0px';
            const actualH = Math.max(minimumRegionHeight(r), el.offsetHeight);
            const hasContent = currentPageRegions.some(region => region.type !== 'page-header');

            if (r.y + actualH > PAGE_BOTTOM && hasContent) {
              el.remove();
              balancePageSpacing(pageDiv, currentPageRegions);
              appendFooter(pageDiv, pageIdx, currentPageRegions);
              newPages.push({ regions: currentPageRegions });

              pageIdx = newPages.length;
              currentPageRegions = [];
              currentY = PAGE_TOP;
              previousContentRegion = null;
              pageDiv = createEditablePage();

              if (header) {
                const h = { ...header, y: HEADER_Y };
                const hEl = createAiDocRegion(h, pageIdx, 0);
                if (hEl) {
                  pageDiv.appendChild(hEl);
                  currentPageRegions.push(h);
                }
              }
              r.y = currentY;
              el = createAiDocRegion(r, pageIdx, currentPageRegions.length);
              if (!el) continue;
              pageDiv.appendChild(el);
              if (r.type !== 'image' && r.type !== 'divider') el.style.minHeight = '0px';
            }

            r.h = actualH;
            el.style.minHeight = actualH + 'px';
            currentY = r.y + actualH;
            currentPageRegions.push(r);
            previousContentRegion = r;
          }

          balancePageSpacing(pageDiv, currentPageRegions);
          appendFooter(pageDiv, pageIdx, currentPageRegions);

          newPages.push({ regions: currentPageRegions });
        });

        // Update layout data with new pages
        data.pages = newPages;
        aiDocLayoutData = data;

        // Apply final labels after reflow; these labels are authoritative for
        // both preview and subsequent PDF export.
        const allPageDivs = aiDocEditScroll.querySelectorAll('.ai-doc-page');
        const totalPages = allPageDivs.length;
        allPageDivs.forEach((pd, idx) => {
          const regions = data.pages[idx]?.regions || [];
          const footerIdx = regions.findIndex(region => region.type === 'page-footer');
          if (footerIdx >= 0) {
            const footerText = t('home.aiDoc.pageOfTotal', { current: idx + 1, total: totalPages });
            regions[footerIdx].text = footerText;
            const footerTextEl = pd.querySelector(`.ai-doc-region[data-page-idx="${idx}"][data-region-idx="${footerIdx}"] .ai-doc-region-text`);
            if (footerTextEl) footerTextEl.textContent = footerText;
          }
          const pageNum = document.createElement('div');
          pageNum.className = 'ai-doc-page-num';
          pageNum.textContent = `${idx + 1} / ${totalPages}`;
          pd.appendChild(pageNum);
        });

        selectAiDocRegion(aiDocSelectedRegionId);

        try { createIcons({ icons }); }
        catch (e) { if (window.lucide) window.lucide.createIcons(); }

        if (previousScroll) {
          requestAnimationFrame(() => {
            if (!aiDocEditScroll?.isConnected) return;
            const maxTop = Math.max(0, aiDocEditScroll.scrollHeight - aiDocEditScroll.clientHeight);
            const maxLeft = Math.max(0, aiDocEditScroll.scrollWidth - aiDocEditScroll.clientWidth);
            aiDocEditScroll.scrollTop = Math.min(previousScroll.top, maxTop);
            aiDocEditScroll.scrollLeft = Math.min(previousScroll.left, maxLeft);
          });
        }
      }

      function createAiDocRegion(region, pageIdx, regionIdx) {
        const el = document.createElement('div');
        el.className = 'ai-doc-region';
        el.dataset.regionType = region.type;
        if (region.type === 'table-row' && region.bold) el.dataset.tableHeader = 'true';
        el.dataset.editorId = region.editorId || createAiDocEditorId();
        region.editorId = el.dataset.editorId;
        el.dataset.pageIdx = pageIdx;
        el.dataset.regionIdx = regionIdx;
        el.style.left = (region.x || 0) + 'px';
        el.style.top = (region.y || 0) + 'px';
        el.style.width = (region.w || 200) + 'px';
        // Use min-height instead of fixed height so text can expand
        el.style.minHeight = (region.h || 40) + 'px';
        el.style.height = 'auto';

        const regionStyle = region.style || {};
        if (regionStyle.backgroundColor) el.style.backgroundColor = regionStyle.backgroundColor;
        if (regionStyle.borderColor) el.style.borderColor = regionStyle.borderColor;
        if (regionStyle.borderWidth !== undefined) {
          el.style.borderStyle = 'solid';
          el.style.borderWidth = `${regionStyle.borderWidth}px`;
        }
        if (regionStyle.opacity !== undefined) el.style.opacity = String(regionStyle.opacity);

        const isLockedRegion = ['page-header', 'page-footer'].includes(region.type);
        if (isLockedRegion) el.classList.add('locked');

        if (region.type === 'image') {
          el.classList.add('ai-doc-region-image');
          const imageHeight = region.imageHeight || region.h || 120;
          el.style.height = imageHeight + 'px';
          el.style.minHeight = imageHeight + 'px';
          if (region.imageData) {
            const img = document.createElement('img');
            img.src = region.imageData;
            img.style.width = '100%';
            // Use stored imageHeight for deterministic layout (avoids async-load height jitter)
            img.style.height = region.imageHeight ? region.imageHeight + 'px' : 'auto';
            img.style.display = 'block';
            img.style.objectFit = 'contain';
            el.appendChild(img);
          } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'ai-doc-img-placeholder';
            placeholder.innerHTML = `<i data-lucide="image"></i><span>${escapeHtml(region.label || t('home.aiDoc.imgUploadHint'))}</span>`;
            el.appendChild(placeholder);
          }
          el.addEventListener('dblclick', () => uploadAiDocImage(el, region.editorId));
          if (window.lucide) window.lucide.createIcons();
        } else if (region.type === 'divider') {
          const dividerEl = document.createElement('div');
          dividerEl.style.width = '100%';
          dividerEl.style.height = '1px';
          dividerEl.style.background = '#ccc';
          dividerEl.style.marginTop = '4px';
          el.appendChild(dividerEl);
        } else {
          // Text-based region
          const textEl = document.createElement('div');
          textEl.className = 'ai-doc-region-text';
          textEl.textContent = region.text || '';
          textEl.style.fontSize = (region.fontSize || 12) + 'px';
          textEl.style.fontWeight = region.bold ? 'bold' : 'normal';
          textEl.style.textAlign = region.align || 'left';
          if (regionStyle.textColor) textEl.style.color = regionStyle.textColor;
          if (regionStyle.padding !== undefined) textEl.style.padding = `${regionStyle.padding}px`;
          if (regionStyle.lineHeight !== undefined) textEl.style.lineHeight = String(regionStyle.lineHeight);

          // Apply styles based on region type
          switch (region.type) {
            case 'title':
              textEl.style.fontWeight = 'bold';
              textEl.style.fontSize = (region.fontSize || 24) + 'px';
              break;
            case 'subtitle':
              textEl.style.color = '#666';
              textEl.style.fontSize = (region.fontSize || 13) + 'px';
              break;
            case 'section-heading':
              textEl.style.fontWeight = 'bold';
              textEl.style.fontSize = (region.fontSize || 14) + 'px';
              textEl.style.borderBottom = '1px solid #ddd';
              textEl.style.paddingBottom = '4px';
              break;
            case 'sub-heading':
              textEl.style.fontWeight = 'bold';
              textEl.style.fontSize = (region.fontSize || 12) + 'px';
              break;
            case 'page-header':
            case 'page-footer':
              textEl.style.color = '#999';
              textEl.style.fontSize = (region.fontSize || 9) + 'px';
              break;
            case 'list-item':
              textEl.style.fontSize = (region.fontSize || 11) + 'px';
              break;
            case 'body-indent':
              textEl.style.fontSize = (region.fontSize || 12) + 'px';
              break;
            case 'signature':
              textEl.style.fontSize = (region.fontSize || 12) + 'px';
              break;
            case 'date':
              textEl.style.fontSize = (region.fontSize || 12) + 'px';
              break;
            case 'table-row':
              textEl.style.fontSize = (region.fontSize || 13) + 'px';
              break;
            case 'note':
              textEl.style.fontSize = (region.fontSize || 10.5) + 'px';
              textEl.style.color = '#777';
              textEl.style.fontStyle = 'italic';
              break;
            case 'emphasis':
              textEl.style.fontWeight = 'bold';
              textEl.style.fontSize = (region.fontSize || 12) + 'px';
              textEl.style.color = '#333';
              break;
            default: // body
              textEl.style.fontSize = (region.fontSize || 14) + 'px';
          }
          if (region.type === 'table-row') {
            renderAiDocTableCells(textEl, region.text);
            textEl.querySelectorAll('.ai-doc-table-cell').forEach(cell => {
              if (regionStyle.dividerColor || regionStyle.borderColor) cell.style.borderLeftColor = regionStyle.dividerColor || regionStyle.borderColor;
              if (regionStyle.dividerWidth !== undefined) cell.style.borderLeftWidth = `${regionStyle.dividerWidth}px`;
            });
          }
          el.appendChild(textEl);

          // Double-click to edit text
          let textEditPreviousLayout = null;
          el.addEventListener('dblclick', (e) => {
            if (isLockedRegion) return;
            e.stopPropagation();
            selectAiDocRegion(region.editorId);
            textEditPreviousLayout = cloneAiDocLayout(aiDocLayoutData);
            if (region.type === 'table-row') textEl.textContent = region.text || '';
            textEl.setAttribute('contenteditable', 'true');
            textEl.focus();
            // Select all
            const range = document.createRange();
            range.selectNodeContents(textEl);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          });
          textEl.addEventListener('blur', () => {
            textEl.removeAttribute('contenteditable');
            const selected = findAiDocRegionById(region.editorId);
            if (!selected) return;
            const nextText = textEl.textContent;
            if (selected.region.text !== nextText) {
              selected.region.text = nextText;
              recordAiDocEdit(textEditPreviousLayout);
              textEditPreviousLayout = null;
              requestAnimationFrame(() => renderAiDocEditPages(aiDocLayoutData));
            } else if (region.type === 'table-row') {
              renderAiDocTableCells(textEl, selected.region.text);
            }
          });
          textEl.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
              textEl.blur();
            }
          });
        }

        if (!isLockedRegion) {
          el.addEventListener('click', event => {
            if (event.target.getAttribute('contenteditable') === 'true') return;
            event.stopPropagation();
            selectAiDocRegion(region.editorId);
          });

          const cleanupDrag = makeAiDocRegionDraggable(el, region.editorId);
          if (cleanupDrag) aiDocCleanupFns.push(cleanupDrag);

          const resizeAnchors = region.type === 'image' ? ['left', 'corner'] : ['right'];
          resizeAnchors.forEach(anchor => {
            const handle = document.createElement('div');
            handle.className = `ai-doc-resize-handle ai-doc-resize-handle-${anchor}`;
            handle.dataset.resizeAnchor = anchor;
            el.appendChild(handle);
            const cleanupResize = makeAiDocRegionResizable(el, handle, region.editorId);
            if (cleanupResize) aiDocCleanupFns.push(cleanupResize);
          });
        }

        return el;
      }

      function makeAiDocRegionDraggable(el, editorId) {
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let moved = false;
        let previousLayout = null;

        const onMouseDown = (e) => {
          if (e.target.getAttribute('contenteditable') === 'true') return;
          if (e.target.classList.contains('ai-doc-resize-handle')) return;
          selectAiDocRegion(editorId);
          isDragging = true;
          startX = e.clientX;
          startY = e.clientY;
          moved = false;
          previousLayout = cloneAiDocLayout(aiDocLayoutData);
          el.classList.add('dragging');
          e.preventDefault();
        };

        const onMouseMove = (e) => {
          if (!isDragging) return;
          const deltaX = e.clientX - startX;
          const deltaY = e.clientY - startY;
          const selected = findAiDocRegionById(editorId);
          const isImage = selected?.region.type === 'image';
          moved = moved || Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4;
          el.style.transform = isImage
            ? `translate(${deltaX}px, ${deltaY}px)`
            : `translateY(${deltaY}px)`;
        };

        const onMouseUp = (e) => {
          if (!isDragging) return;
          isDragging = false;
          el.classList.remove('dragging');
          el.style.transform = '';
          if (!moved) return;

          const selected = findAiDocRegionById(editorId);
          if (!selected) return;
          const page = aiDocLayoutData.pages[selected.pageIdx];
          const isImage = selected.region.type === 'image';
          let horizontalChanged = false;
          if (isImage) {
            const width = el.offsetWidth;
            const rawLeft = (parseFloat(el.style.left) || 0) + (e.clientX - startX);
            const maxLeft = Math.max(0, A4_WIDTH - width);
            const snapTargets = [0, 56, (A4_WIDTH - width) / 2, A4_WIDTH - 56 - width, maxLeft]
              .filter(value => value >= 0 && value <= maxLeft);
            const snappedLeft = snapTargets.reduce((best, target) => (
              Math.abs(target - rawLeft) < Math.abs(best - rawLeft) ? target : best
            ), Math.min(maxLeft, Math.max(0, rawLeft)));
            const nextLeft = Math.abs(snappedLeft - rawLeft) <= 10
              ? snappedLeft
              : Math.min(maxLeft, Math.max(0, rawLeft));
            horizontalChanged = Math.round(nextLeft) !== Math.round(selected.region.x || 0);
            selected.region.x = Math.round(nextLeft);
          }
          const contentRegions = page.regions.filter(region => !['page-header', 'page-footer'].includes(region.type));
          const otherRegions = contentRegions.filter(region => region.editorId !== editorId);
          const originalTop = parseFloat(el.style.top) || 0;
          const dropCenter = originalTop + (e.clientY - startY) + el.offsetHeight / 2;
          let insertAt = 0;
          otherRegions.forEach(region => {
            const regionEl = aiDocEditScroll.querySelector(`[data-editor-id="${region.editorId}"]`);
            const center = (parseFloat(regionEl?.style.top) || region.y || 0) + (regionEl?.offsetHeight || region.h || 0) / 2;
            if (dropCenter > center) insertAt += 1;
          });
          const reorderedContent = [...otherRegions];
          reorderedContent.splice(insertAt, 0, selected.region);
          const previousOrder = contentRegions.map(region => region.editorId).join('|');
          const nextOrder = reorderedContent.map(region => region.editorId).join('|');
          if (previousOrder === nextOrder) {
            if (!horizontalChanged) return;
            recordAiDocEdit(previousLayout);
            renderAiDocEditPages(aiDocLayoutData);
            return;
          }

          const header = page.regions.filter(region => region.type === 'page-header');
          const footer = page.regions.filter(region => region.type === 'page-footer');
          page.regions = [...header, ...reorderedContent, ...footer];
          recordAiDocEdit(previousLayout);
          renderAiDocEditPages(aiDocLayoutData);
        };

        el.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        return () => {
          el.removeEventListener('mousedown', onMouseDown);
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };
      }

      function makeAiDocRegionResizable(el, handle, editorId) {
        let isResizing = false;
        let startX = 0;
        let startY = 0;
        let origW = 0;
        let origH = 0;
        let origLeft = 0;
        let origTop = 0;
        let resizeAnchor = 'right';
        let previousLayout = null;

        const onMouseDown = (e) => {
          e.stopPropagation();
          selectAiDocRegion(editorId);
          isResizing = true;
          startX = e.clientX;
          startY = e.clientY;
          origW = el.offsetWidth;
          origH = el.offsetHeight;
          origLeft = parseFloat(el.style.left) || 0;
          origTop = parseFloat(el.style.top) || 0;
          resizeAnchor = handle.dataset.resizeAnchor || 'right';
          previousLayout = cloneAiDocLayout(aiDocLayoutData);
          e.preventDefault();
        };

        const onMouseMove = (e) => {
          if (!isResizing) return;
          const selected = findAiDocRegionById(editorId);
          if (!selected) return;
          const isImage = selected.region.type === 'image';
          const resizeFromLeft = isImage && resizeAnchor === 'left';
          const minimumWidth = isImage ? 80 : 120;
          const pointerDeltaX = e.clientX - startX;
          const maxWidth = resizeFromLeft ? origLeft + origW : A4_WIDTH - origLeft;
          const newW = Math.max(minimumWidth, Math.min(maxWidth, resizeFromLeft
            ? origW - pointerDeltaX
            : origW + pointerDeltaX));
          const newLeft = resizeFromLeft ? origLeft + origW - newW : origLeft;
          el.style.width = newW + 'px';
          if (isImage) {
            const maxHeight = A4_HEIGHT - origTop;
            const newH = resizeFromLeft
              ? Math.max(80, Math.min(maxHeight, Math.round(origH * (newW / Math.max(1, origW)))))
              : Math.max(80, Math.min(maxHeight, origH + (e.clientY - startY)));
            el.style.left = newLeft + 'px';
            el.style.height = newH + 'px';
            el.style.minHeight = newH + 'px';
          } else {
            el.style.height = 'auto';
            el.style.minHeight = '0px';
          }
        };

        const onMouseUp = () => {
          if (!isResizing) return;
          isResizing = false;
          const selected = findAiDocRegionById(editorId);
          if (!selected) return;
          const newW = Math.round(el.offsetWidth);
          const newH = Math.round(el.offsetHeight);
          if (newW === Math.round(selected.region.w || 0)
            && (selected.region.type !== 'image' || newH === Math.round(selected.region.h || 0))) return;
          selected.region.w = newW;
          selected.region.h = newH;
          if (selected.region.type === 'image') {
            selected.region.x = Math.round(parseFloat(el.style.left) || 0);
            selected.region.imageHeight = newH;
            selected.region.imageWidth = newW;
          }
          recordAiDocEdit(previousLayout);
          renderAiDocEditPages(aiDocLayoutData);
        };

        handle.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        return () => {
          handle.removeEventListener('mousedown', onMouseDown);
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };
      }

      async function uploadAiDocImage(el, editorId) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.png,.jpg,.jpeg,image/png,image/jpeg';
        input.addEventListener('change', async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const targetAtUpload = findAiDocRegionById(editorId);
          if (!targetAtUpload || targetAtUpload.region.type !== 'image') return;
          if (!isSupportedAiDocImage(file)) {
            addAiDocChatMsg('ai', t('home.aiDoc.imageFormatError'));
            return;
          }
          if (Number.isFinite(file.size) && file.size > AI_DOC_LIMITS.maxImageBytes) {
            addAiDocChatMsg('ai', t('home.aiDoc.imageTooLarge', { max: 10 }));
            return;
          }
          const imageMime = file.type === 'image/png' || /\.png$/i.test(file.name || '')
            ? 'image/png'
            : 'image/jpeg';
          let sourceBytes = Number(file.size);
          if (!Number.isSafeInteger(sourceBytes) || sourceBytes < 0) {
            addAiDocChatMsg('ai', t('home.aiDoc.imageReadError'));
            return;
          }
          let dataUrl;
          if (isTauri && file.path) {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const fileSize = Number(await invoke('get_file_size', { path: file.path }));
              if (!Number.isSafeInteger(fileSize) || fileSize < 0 || fileSize > AI_DOC_LIMITS.maxImageBytes) {
                addAiDocChatMsg('ai', t('home.aiDoc.imageTooLarge', { max: 10 }));
                return;
              }
              sourceBytes = fileSize;
              const rawBytes = await invoke('read_file_bytes', { path: file.path });
              const bytes = Array.isArray(rawBytes) ? Uint8Array.from(rawBytes) : new Uint8Array(rawBytes);
              if (bytes.byteLength > AI_DOC_LIMITS.maxImageBytes) {
                addAiDocChatMsg('ai', t('home.aiDoc.imageTooLarge', { max: 10 }));
                return;
              }
              const blob = new Blob([bytes], { type: imageMime });
              dataUrl = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(r.result);
                r.onerror = () => reject(new Error('FileReader error'));
                r.readAsDataURL(blob);
              });
            } catch (err) {
              console.error('AI Doc image read error:', err);
              return;
            }
          } else {
            dataUrl = await new Promise((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(r.result);
              r.onerror = () => reject(new Error('FileReader error'));
              r.readAsDataURL(file);
            });
          }
          const existingBytes = aiDocLayoutData?.pages?.reduce((total, page) => (
            total + (page?.regions || []).reduce((pageTotal, region) => {
              if (region.editorId === editorId) return pageTotal;
              const bytes = Number(region?.imageByteLength);
              return pageTotal + (Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0);
            }, 0)
          ), 0) || 0;
          try {
            assertAiDocImageBudget(existingBytes, sourceBytes);
          } catch (error) {
            if (error instanceof AiDocLayoutError && error.code === 'images_too_large') {
              addAiDocChatMsg('ai', t('home.aiDoc.imagesTooLarge', { max: 40 }));
            } else {
              addAiDocChatMsg('ai', t('home.aiDoc.imageReadError'));
            }
            return;
          }
          const tempImg = new Image();
          tempImg.onload = () => {
              const previousLayout = cloneAiDocLayout(aiDocLayoutData);
              const currentTarget = findAiDocRegionById(editorId);
              if (!currentTarget || currentTarget.region.type !== 'image') return;
              const naturalW = tempImg.naturalWidth;
              const naturalH = tempImg.naturalHeight;
              if (!naturalW || !naturalH || naturalW * naturalH > AI_DOC_LIMITS.maxImagePixels) {
                addAiDocChatMsg('ai', t('home.aiDoc.imageDimensionsTooLarge'));
                return;
              }
              const regionW = currentTarget.region.w || parseInt(el.style.width) || 200;
              // Calculate display height maintaining aspect ratio, fit within region width
              const displayW = regionW;
              const displayH = Math.round(naturalH * (displayW / naturalW));
              // Cap height to avoid overflow
              const maxH = 500;
              const finalH = Math.min(displayH, maxH);
              const finalW = Math.round(naturalW * (finalH / naturalH));

              // Update layout data with actual image dimensions
              const region = currentTarget.region;
              region.imageData = dataUrl;
              region.imageWidth = finalW;
              region.imageHeight = finalH;
              region.imageByteLength = sourceBytes;
              region.w = finalW;
              region.h = finalH;
              recordAiDocEdit(previousLayout);
              // Reflow entire document to adjust subsequent regions and prevent overlap
              if (aiDocLayoutData) {
                renderAiDocEditPages(aiDocLayoutData);
              }
          };
          tempImg.onerror = () => {
            addAiDocChatMsg('ai', t('home.aiDoc.imageReadError'));
          };
          tempImg.src = dataUrl;
        });
        input.click();
      }

      async function loadAiDocFontBytes() {
        if (aiDocFontRegularBytes && aiDocFontBoldBytes) return;
        try {
          const [regularResponse, semiboldResponse] = await Promise.all([
            fetch('/assets/fonts/MiSans-Regular.ttf'),
            fetch('/assets/fonts/MiSans-Semibold.ttf')
          ]);
          if (!regularResponse.ok || !semiboldResponse.ok) throw new Error('font fetch failed');
          const [regularBytes, semiboldBytes] = await Promise.all([
            regularResponse.arrayBuffer(),
            semiboldResponse.arrayBuffer()
          ]);
          if (new Uint8Array(regularBytes, 0, 1)[0] === 0x3C
            || new Uint8Array(semiboldBytes, 0, 1)[0] === 0x3C) {
            throw new Error('font fetch returned HTML');
          }
          aiDocFontRegularBytes = regularBytes;
          aiDocFontBoldBytes = semiboldBytes;
        } catch (e) {
          console.error('[AI Doc] Failed to load font:', e);
          aiDocFontRegularBytes = null;
          aiDocFontBoldBytes = null;
        }
      }

      async function exportAiDocPdf() {
        if (!aiDocLayoutData?.pages) return;
        showAiDocMask(t('home.aiDoc.exporting'));

        try {
          const layout = cloneAiDocLayout(aiDocLayoutData);
          await loadAiDocFontBytes();
          // The desktop editor and CLI intentionally share one renderer. The
          // previous inlined renderer had diverged from the CLI and could turn
          // a two-page layout into three pages because it trusted oversized AI
          // height estimates instead of the measured text height.
          const { bytes: pdfBytes } = await buildAiDocPdf({
            layout,
            fontRegularBytes: aiDocFontRegularBytes || undefined,
            fontBoldBytes: aiDocFontBoldBytes || undefined,
            footerText: (current, total) => t('home.aiDoc.pageOfTotal', { current, total }),
            imagePlaceholder: t('home.aiDoc.imgPlaceholder')
          });

          if (isAiDocEditorDemo) {
            let binary = '';
            for (let offset = 0; offset < pdfBytes.length; offset += 0x8000) {
              binary += String.fromCharCode(...pdfBytes.subarray(offset, offset + 0x8000));
            }
            let bridge = document.getElementById('aiDocEditorDemoPdf');
            if (!bridge) {
              bridge = document.createElement('textarea');
              bridge.id = 'aiDocEditorDemoPdf';
              bridge.hidden = true;
              document.body.appendChild(bridge);
            }
            bridge.value = btoa(binary);
            bridge.dataset.byteLength = String(pdfBytes.length);
          }

          if (isTauri) {
            const { invoke } = await import('@tauri-apps/api/core');
            const outputDir = await getOutputDir('AI_Doc');
            const fileName = `ai_doc_${Date.now()}.pdf`;
            const outputPath = await invoke('write_unique_file_bytes', {
              directory: outputDir,
              fileName,
              bytes: Array.from(pdfBytes)
            });
            aiDocLastExportPath = outputPath;
            showAiDocSuccess(outputPath);
          } else {
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            let url;
            let shouldRevoke = false;
            if (typeof URL.createObjectURL === 'function') {
              url = URL.createObjectURL(blob);
              shouldRevoke = true;
            } else {
              let binary = '';
              for (let offset = 0; offset < pdfBytes.length; offset += 0x8000) {
                binary += String.fromCharCode(...pdfBytes.subarray(offset, offset + 0x8000));
              }
              url = `data:application/pdf;base64,${btoa(binary)}`;
            }
            const a = document.createElement('a');
            a.href = url;
            a.download = `ai_doc_${Date.now()}.pdf`;
            a.click();
            if (shouldRevoke) URL.revokeObjectURL(url);
          }
        } catch (e) {
          console.error('[AI Doc] Export error:', e);
          showAiDocError();
        } finally {
          hideAiDocMask();
        }
      }

      function showAiDocSuccess(filePath) {
        if (aiDocSuccessPath) aiDocSuccessPath.textContent = filePath;
        if (aiDocSuccessOverlay) aiDocSuccessOverlay.classList.add('visible');
      }

      function showAiDocError() {
        addAiDocChatMsg('ai', t('home.aiDoc.exportError'));
      }

      // Event listeners
      if (aiDocBack) {
        aiDocBack.addEventListener('click', closeAiDocOverlay);
      }

      if (aiDocEditBack) {
        aiDocEditBack.addEventListener('click', closeAiDocEditOverlay);
      }

      if (aiDocEditExportBtn) {
        aiDocEditExportBtn.addEventListener('click', exportAiDocPdf);
      }

      if (aiDocUndoBtn) aiDocUndoBtn.addEventListener('click', undoAiDocEdit);
      if (aiDocRedoBtn) aiDocRedoBtn.addEventListener('click', redoAiDocEdit);
      if (aiDocMoveUpBtn) aiDocMoveUpBtn.addEventListener('click', () => moveSelectedAiDocRegion(-1));
      if (aiDocMoveDownBtn) aiDocMoveDownBtn.addEventListener('click', () => moveSelectedAiDocRegion(1));
      if (aiDocDeleteBtn) aiDocDeleteBtn.addEventListener('click', deleteSelectedAiDocRegion);
      aiDocFontSizeInput?.addEventListener('change', () => {
        const size = Number(aiDocFontSizeInput.value);
        if (Number.isFinite(size)) applyAiDocSelectedStyle({ fontSize: Math.max(6, Math.min(96, Math.round(size))) });
      });
      aiDocBoldBtn?.addEventListener('click', () => {
        const selected = findAiDocRegionById(aiDocSelectedRegionId);
        if (selected) applyAiDocSelectedStyle({ bold: !selected.region.bold });
      });
      aiDocAlignLeftBtn?.addEventListener('click', () => applyAiDocSelectedStyle({ align: 'left' }));
      aiDocAlignCenterBtn?.addEventListener('click', () => applyAiDocSelectedStyle({ align: 'center' }));
      aiDocAlignRightBtn?.addEventListener('click', () => applyAiDocSelectedStyle({ align: 'right' }));
      aiDocTextColorInput?.addEventListener('change', () => applyAiDocSelectedStyle({ textColor: aiDocTextColorInput.value.toUpperCase() }));
      aiDocBackgroundColorInput?.addEventListener('change', () => applyAiDocSelectedStyle({ backgroundColor: aiDocBackgroundColorInput.value.toUpperCase() }));
      aiDocBorderColorInput?.addEventListener('change', () => applyAiDocSelectedStyle({ borderColor: aiDocBorderColorInput.value.toUpperCase(), borderWidth: 1 }));
      aiDocMoreStyleBtn?.addEventListener('click', () => {
        const visible = !aiDocStyleInspector?.classList.contains('visible');
        aiDocStyleInspector?.classList.toggle('visible', visible);
        aiDocStyleInspector?.setAttribute('aria-hidden', String(!visible));
      });
      aiDocStyleInspectorClose?.addEventListener('click', () => { aiDocStyleInspector?.classList.remove('visible'); aiDocStyleInspector?.setAttribute('aria-hidden', 'true'); });
      const bindAiDocRange = (input, output, key, format = value => value) => {
        input?.addEventListener('input', () => { if (output) output.textContent = format(input.value); });
        input?.addEventListener('change', () => { const value = Number(input.value); if (Number.isFinite(value)) applyAiDocSelectedStyle({ [key]: value }); });
      };
      bindAiDocRange(aiDocLineHeightInput, aiDocLineHeightValue, 'lineHeight');
      bindAiDocRange(aiDocPaddingInput, aiDocPaddingValue, 'padding');
      bindAiDocRange(aiDocBorderWidthInput, aiDocBorderWidthValue, 'borderWidth');
      bindAiDocRange(aiDocOpacityInput, aiDocOpacityValue, 'opacity', value => `${Math.round(Number(value) * 100)}%`);
      aiDocApplyGlobalStyleBtn?.addEventListener('click', applyAiDocGlobalAlignment);

      document.addEventListener('keydown', event => {
        if (!aiDocEditOverlay?.classList.contains('visible')) return;
        const editingText = event.target?.getAttribute?.('contenteditable') === 'true';
        if (editingText) return;
        const modifier = event.ctrlKey || event.metaKey;
        if (modifier && event.key.toLowerCase() === 'z') {
          event.preventDefault();
          if (event.shiftKey) redoAiDocEdit();
          else undoAiDocEdit();
        } else if (modifier && event.key.toLowerCase() === 'y') {
          event.preventDefault();
          redoAiDocEdit();
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          deleteSelectedAiDocRegion();
        }
      });

      if (aiDocSuccessOk) {
        aiDocSuccessOk.addEventListener('click', () => {
          if (aiDocSuccessOverlay) aiDocSuccessOverlay.classList.remove('visible');
        });
      }

      if (aiDocSuccessOpenFolder) {
        aiDocSuccessOpenFolder.addEventListener('click', async () => {
          if (isTauri && aiDocLastExportPath) {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const folder = aiDocLastExportPath.replace(/[/\\][^/\\]+$/, '').replace(/\//g, '\\');
              await invoke('open_path', { path: folder });
            } catch (err) {
              console.error('[AI Doc] Open folder error:', err);
            }
          }
        });
      }

      document.querySelectorAll('.audio-list-item[data-tool="ai-doc"]').forEach(item => {
        item.addEventListener('click', () => openToolWithAiCheck(openAiDocOverlay));
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openToolWithAiCheck(openAiDocOverlay);
          }
        });
      });

      if (aiDocChatSend) {
        aiDocChatSend.disabled = true;
        aiDocChatSend.addEventListener('click', handleAiDocSend);
      }

      if (aiDocChatMessages) {
        aiDocChatMessages.addEventListener('click', (e) => {
          const chip = e.target.closest('.ai-doc-prompt-chip');
          if (!chip) return;
          const prompt = chip.dataset.prompt;
          if (aiDocChatInput && prompt) {
            aiDocChatInput.value = prompt;
            aiDocChatInput.focus();
            aiDocChatInput.dispatchEvent(new Event('input'));
          }
        });
      }

      if (aiDocChatInput) {
        aiDocChatInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleAiDocSend();
          }
        });
        aiDocChatInput.addEventListener('input', () => {
          aiDocChatSend.disabled = !aiDocChatInput.value.trim();
        });
      }

      if (aiDocExportBtn) {
        aiDocExportBtn.addEventListener('click', exportAiDocPdf);
      }

      const aiDocResetBtn = document.getElementById('aiDocResetBtn');
      if (aiDocResetBtn) {
        aiDocResetBtn.addEventListener('click', () => {
          resetAiDocState();
          aiDocChatSend.disabled = true;
        });
      }

      if (isAiDocEditorDemo) {
        const demoLayout = normalizeAiDocLayout({
          ready: true,
          summary: 'AI document editor development fixture',
          pages: [{
            regions: [
              { type: 'title', x: 56, y: 60, w: 682, h: 56, text: '项目周会会议纪要', fontSize: 30, bold: true, align: 'center' },
              { type: 'subtitle', x: 56, y: 124, w: 682, h: 24, text: 'PRODUCT DELIVERY / WEEK 25', fontSize: 14, bold: false, align: 'center' },
              { type: 'table-row', x: 56, y: 164, w: 682, h: 42, text: '会议时间 | 2026年8月2日 14:00 | 主持人 | 张伟', fontSize: 13, bold: false, align: 'left' },
              { type: 'table-row', x: 56, y: 206, w: 682, h: 42, text: '会议地点 | 3F 会议室 A | 参会人数 | 6 人', fontSize: 13, bold: false, align: 'left' },
              { type: 'section-heading', x: 56, y: 270, w: 682, h: 34, text: '01 / 本周结论', fontSize: 18, bold: true, align: 'left' },
              { type: 'emphasis', x: 56, y: 316, w: 682, h: 58, text: '支付链路进入联调阶段，本周优先完成第三方接口稳定性验证与异常回退方案。', fontSize: 14, bold: true, align: 'left' },
              { type: 'body', x: 56, y: 390, w: 682, h: 70, text: '用户中心模块已完成设计评审，前端进入开发排期。数据报表继续补充复杂筛选场景，测试团队同步准备回归用例。', fontSize: 14.5, bold: false, align: 'left' },
              { type: 'section-heading', x: 56, y: 486, w: 682, h: 34, text: '02 / 待办事项', fontSize: 18, bold: true, align: 'left' },
              { type: 'table-row', x: 56, y: 532, w: 682, h: 42, text: '事项 | 责任人 | 截止日期 | 优先级', fontSize: 13, bold: true, align: 'left' },
              { type: 'table-row', x: 56, y: 574, w: 682, h: 42, text: '完成支付页面开发 | 李娜 | 08-07 | 高', fontSize: 13, bold: false, align: 'left' },
              { type: 'table-row', x: 56, y: 616, w: 682, h: 42, text: '验证异常回退链路 | 王强 | 08-08 | 高', fontSize: 13, bold: false, align: 'left' },
              { type: 'table-row', x: 56, y: 658, w: 682, h: 42, text: '补充报表筛选用例 | 赵敏 | 08-09 | 中', fontSize: 13, bold: false, align: 'left' },
              { type: 'note', x: 56, y: 724, w: 682, h: 56, text: '下次会议：8月9日 14:00。请各责任人在会前更新任务状态并附上可验证结果。', fontSize: 12.5, bold: false, align: 'left' }
            ]
          }]
        });
        aiDocLayoutData = prepareAiDocLayoutForEditing(demoLayout);
        resetAiDocEditorHistory();
        requestAnimationFrame(openAiDocEditOverlay);
      }
      // ===== End AI Document Tool =====

      // ===== AI Table Tool =====
      const aiTableOverlay = document.getElementById('aiTableOverlay');
      const aiTableBack = document.getElementById('aiTableBack');
      const aiTableBg = document.getElementById('aiTableBg');
      const aiTableChatMessages = document.getElementById('aiTableChatMessages');
      const aiTableChatInput = document.getElementById('aiTableChatInput');
      const aiTableChatSend = document.getElementById('aiTableChatSend');
      const aiTableCanvasEmpty = document.getElementById('aiTableCanvasEmpty');
      const aiTablePreviewScroll = document.getElementById('aiTablePreviewScroll');
      const aiTableCanvasToolbar = document.getElementById('aiTableCanvasToolbar');
      const aiTableHelpBtn = document.getElementById('aiTableHelpBtn');
      const aiTableUndoBtn = document.getElementById('aiTableUndoBtn');
      const aiTableResetBtn = document.getElementById('aiTableResetBtn');
      const aiTableSuccessOverlay = document.getElementById('aiTableSuccessOverlay');
      const aiTableSuccessPath = document.getElementById('aiTableSuccessPath');
      const aiTableSuccessOpenFolder = document.getElementById('aiTableSuccessOpenFolder');
      const aiTableSuccessOk = document.getElementById('aiTableSuccessOk');
      const aiTableMask = document.getElementById('aiTableMask');
      const aiTableMaskText = document.getElementById('aiTableMaskText');

      let aiTableDitherInstance = null;
      let aiTableChatHistory = [];
      let aiTableData = null; // { title, columns, rows, charts }
      let aiTableUndoStack = [];
      let aiTableLastExportPath = '';
      let aiTableChartCanvases = []; // [{ canvas, instance, chartDef }] for PNG/PDF export
      let aiTableRequestController = null;
      let aiTableRequestTimeoutId = null;
      let aiTableRequestId = 0;
      let aiTableRenderVersion = 0;
      let aiTableChartRenderPromise = Promise.resolve();

      const AI_TABLE_REQUEST_TIMEOUT_MS = 90_000;
      const AI_TABLE_MAX_UNDO = 20;

      function cloneAiTableData(data) {
        return data ? JSON.parse(JSON.stringify(data)) : null;
      }

      function updateAiTableUndoButton() {
        if (!aiTableUndoBtn) return;
        const canUndo = aiTableUndoStack.length > 0;
        aiTableUndoBtn.disabled = !canUndo;
        aiTableUndoBtn.title = canUndo ? t('home.aiTable.undo') : t('home.aiTable.undoEmpty');
      }

      function pushAiTableUndoState() {
        if (!aiTableData) return;
        aiTableUndoStack.push(cloneAiTableData(aiTableData));
        if (aiTableUndoStack.length > AI_TABLE_MAX_UNDO) aiTableUndoStack.shift();
        updateAiTableUndoButton();
      }

      function undoAiTableLastEdit() {
        const previous = aiTableUndoStack.pop();
        if (!previous) {
          updateAiTableUndoButton();
          return;
        }
        aiTableData = previous;
        renderAiTablePreview(aiTableData);
        addAiTableChatMsg('ai', t('home.aiTable.undone'));
      }

      function aiTableValuesEqual(a, b) {
        return String(a ?? '') === String(b ?? '');
      }

      function cancelAiTableRequest() {
        aiTableRequestId += 1;
        if (aiTableRequestTimeoutId !== null) {
          clearTimeout(aiTableRequestTimeoutId);
          aiTableRequestTimeoutId = null;
        }
        if (aiTableRequestController) {
          aiTableRequestController.abort();
          aiTableRequestController = null;
        }
      }

      function finishAiTableRequest(requestId) {
        if (requestId !== aiTableRequestId) return false;
        if (aiTableRequestTimeoutId !== null) {
          clearTimeout(aiTableRequestTimeoutId);
          aiTableRequestTimeoutId = null;
        }
        aiTableRequestController = null;
        return true;
      }

      function appendAiTableHistory(role, content) {
        const compact = compactAiTableHistoryMessage(content);
        if (!compact) return;
        aiTableChatHistory = [...aiTableChatHistory, { role, content: compact }]
          .slice(-AI_TABLE_LIMITS.maxHistoryMessages);
      }

      // Inline SVGs (avoid relying on lucide re-scan for dynamically created buttons)
      const AI_TABLE_ICON_PLUS = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
      const AI_TABLE_ICON_TRASH = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';

      const AI_TABLE_PRESET_PROMPTS = [
        { labelKey: 'home.aiTable.presetSales', prompt: '请生成一份2024年Q1-Q4的销售报表，包含产品名称、季度、销售额（万元）、同比增长率列，数据要真实合理，并生成一个柱状图展示各产品季度销售额对比' },
        { labelKey: 'home.aiTable.presetSchedule', prompt: '请生成一个项目排期表，包含任务名称、负责人、开始日期、结束日期、状态列，至少8个任务，状态包括进行中、已完成、未开始' },
        { labelKey: 'home.aiTable.presetCompare', prompt: '请生成一份手机产品对比表，对比5款手机的处理器、内存、电池容量、摄像头像素、价格，数据要真实合理' },
        { labelKey: 'home.aiTable.presetPerformance', prompt: '请生成一份部门员工绩效表，包含姓名、部门、KPI得分、出勤率、综合评级列，至少10人，并生成一个饼图展示评级分布' },
      ];

      function openAiTableOverlay() {
        if (!aiTableOverlay) return;
        aiTableOverlay.classList.add('visible');
        resetAiTableState();
        if (aiTableBg && !aiTableDitherInstance) {
          aiTableDitherInstance = initDither(aiTableBg, {
            waveColor: [0.38823529411764707, 0.4, 0.9450980392156862],
            colorNum: 40, pixelSize: 2, waveAmplitude: 0, waveFrequency: 0, waveSpeed: 0.07
          });
        }
      }

      function closeAiTableOverlay() {
        if (!aiTableOverlay) return;
        aiTableOverlay.classList.remove('visible');
        resetAiTableState();
        if (aiTableDitherInstance) { aiTableDitherInstance(); aiTableDitherInstance = null; }
      }

      function resetAiTableState() {
        cancelAiTableRequest();
        hideAiTableMask();
        aiTableChatHistory = [];
        aiTableData = null;
        aiTableUndoStack = [];
        aiTableRenderVersion += 1;
        // Destroy Chart.js instances before clearing to prevent memory leaks
        aiTableChartCanvases.forEach(c => { try { c.instance && c.instance.destroy(); } catch (e) {} });
        aiTableChartCanvases = [];
        if (aiTableChatMessages) {
          aiTableChatMessages.innerHTML = '';
          addAiTableChatMsg('ai', t('home.aiTable.welcome'));
          addAiTablePromptChips();
        }
        if (aiTableChatInput) aiTableChatInput.value = '';
        if (aiTableChatSend) aiTableChatSend.disabled = true;
        if (aiTableCanvasEmpty) aiTableCanvasEmpty.style.display = '';
        if (aiTablePreviewScroll) { aiTablePreviewScroll.style.display = 'none'; aiTablePreviewScroll.innerHTML = ''; }
        if (aiTableCanvasToolbar) aiTableCanvasToolbar.style.display = 'none';
        updateAiTableUndoButton();
      }

      function addAiTableChatMsg(role, text, isGenLink = false) {
        if (!aiTableChatMessages) return;
        const msg = document.createElement('div');
        msg.className = `ai-doc-chat-msg ai-doc-chat-msg-${role}`;
        const avatar = document.createElement('div');
        avatar.className = 'ai-doc-chat-avatar';
        if (role === 'ai') {
          const img = document.createElement('img');
          img.src = '/assets/toolknit-icon.png'; img.alt = 'AI';
          img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
          avatar.appendChild(img);
        } else {
          fillUserAvatar(avatar);
        }
        const bubble = document.createElement('div');
        bubble.className = 'ai-doc-chat-bubble';
        if (isGenLink) bubble.classList.add('ai-doc-gen-link');
        bubble.textContent = text;
        msg.appendChild(avatar);
        msg.appendChild(bubble);
        aiTableChatMessages.appendChild(msg);
        aiTableChatMessages.scrollTop = aiTableChatMessages.scrollHeight;
        if (window.lucide) window.lucide.createIcons();
        return bubble;
      }

      function addAiTablePromptChips() {
        if (!aiTableChatMessages) return;
        const msg = document.createElement('div');
        msg.className = 'ai-doc-chat-msg ai-doc-chat-msg-ai';
        const avatar = document.createElement('div');
        avatar.className = 'ai-doc-chat-avatar';
        const img = document.createElement('img');
        img.src = '/assets/toolknit-icon.png'; img.alt = 'AI';
        img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
        avatar.appendChild(img);
        const bubble = document.createElement('div');
        bubble.className = 'ai-doc-chat-bubble ai-doc-chip-bubble';
        const title = document.createElement('div');
        title.className = 'ai-doc-chip-title';
        title.textContent = t('home.aiDoc.chipTitle');
        const chips = document.createElement('div');
        chips.className = 'ai-doc-prompt-chips';
        AI_TABLE_PRESET_PROMPTS.forEach(item => {
          const chip = document.createElement('button');
          chip.className = 'ai-doc-prompt-chip';
          chip.textContent = t(item.labelKey);
          chip.dataset.prompt = item.prompt;
          chips.appendChild(chip);
        });
        bubble.appendChild(title);
        bubble.appendChild(chips);
        msg.appendChild(avatar);
        msg.appendChild(bubble);
        aiTableChatMessages.appendChild(msg);
        aiTableChatMessages.scrollTop = aiTableChatMessages.scrollHeight;
      }

      function showAiTableMask(text) {
        if (aiTableMaskText) aiTableMaskText.textContent = text;
        if (aiTableMask) aiTableMask.classList.add('visible');
      }

      function hideAiTableMask() {
        if (aiTableMask) aiTableMask.classList.remove('visible');
      }

      async function handleAiTableSend() {
        const text = aiTableChatInput?.value?.trim();
        if (!text) return;
        if (text.length > AI_TABLE_LIMITS.maxPromptChars) {
          addAiTableChatMsg('ai', t('home.aiTable.promptTooLong', { max: AI_TABLE_LIMITS.maxPromptChars }));
          return;
        }
        if (aiTableRequestController) return;

        const controller = new AbortController();
        const requestId = ++aiTableRequestId;
        let timedOut = false;
        aiTableRequestController = controller;
        aiTableRequestTimeoutId = setTimeout(() => {
          if (requestId !== aiTableRequestId || controller.signal.aborted) return;
          timedOut = true;
          controller.abort();
        }, AI_TABLE_REQUEST_TIMEOUT_MS);

        addAiTableChatMsg('user', text);
        aiTableChatInput.value = '';
        aiTableChatSend.disabled = true;
        appendAiTableHistory('user', text);
        showAiTableMask(t('home.aiTable.thinking'));

        try {
          const systemPrompt = `你是一位数据分析专家，擅长根据用户需求生成结构化数据表和可视化图表。
用户会描述他们需要的表格类型和内容，你的任务是通过对话收集足够信息后生成一份包含数据表和图表的 JSON。

## 输出长度硬性限制
- JSON 总字符数不超过 12000，否则会被截断
- 表格行数控制在 5-50 行，列数 3-12 列
- 图表数量 0-4 个；没有数值列时不要生成图表

## JSON 格式（必须直接返回，不要 markdown 代码块）
{"ready": true, "title": "表格标题", "summary": "简短描述", "columns": [{"key": "name", "label": "姓名", "type": "text"}, {"key": "score", "label": "得分", "type": "number"}, {"key": "date", "label": "日期", "type": "date"}], "rows": [["张三", 95, "2026-01-01"], ["李四", 88, "2026-01-02"]], "charts": [{"type": "bar", "title": "得分对比", "labelColumn": 0, "valueColumns": [1]}]}

## 字段说明
- columns: 列定义，key 是英文标识，label 是列名，type 是 "text"、"number" 或 "date"
- rows: 二维数组，每个子数组是一行数据，顺序与 columns 对应
- charts: 可选，图表数组
  - type: "bar"（柱状图）、"line"（折线图）、"pie"（饼图）
  - title: 图表标题
  - labelColumn: 用作 X 轴标签的列索引（pie 图用作标签）
  - valueColumns: 用作数值的列索引数组（pie 图只取第一个）

## 对话规则
1. 信息不完整时追问（最多 2 轮），返回 {"ready": false, "question": "你的问题"}
2. 信息完整时返回完整 JSON，不要任何 markdown 代码块或解释文字
3. 数据要真实合理，不要用占位符
4. 如果用户要求图表，必须包含 charts 字段`;

          const content = await callDeepSeek([
            { role: 'system', content: systemPrompt },
            ...aiTableChatHistory.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
          ], controller.signal, 8192);

          if (requestId !== aiTableRequestId) return;
          if (typeof content !== 'string' || !content.trim()) {
            throw new AiTableDataError('invalid_table', 'AI returned an empty response.');
          }
          if (content.length > AI_TABLE_LIMITS.maxResponseChars) {
            throw new AiTableDataError('table_too_large', 'AI response exceeds the supported size.');
          }
          const jsonStr = extractJson(content);
          if (!jsonStr) {
            const response = compactAiTableHistoryMessage(content);
            addAiTableChatMsg('ai', response);
            appendAiTableHistory('assistant', response);
            return;
          }

          let parsed;
          try { parsed = JSON.parse(jsonStr); }
          catch (parseErr) {
            console.error('[AI Table] JSON parse failed:', parseErr, jsonStr?.slice(0, 500));
            const fallbackJson = jsonStr.replace(/[\u0000-\u001F\uFEFF\uFFFD]/g, ' ').replace(/\n/g, '\\n');
            try { parsed = JSON.parse(fallbackJson); }
            catch (e2) { addAiTableChatMsg('ai', t('home.aiTable.parseError')); return; }
          }

          if (parsed.ready === false && parsed.question) {
            const question = compactAiTableHistoryMessage(parsed.question);
            if (!question) throw new AiTableDataError('invalid_table', 'AI question is empty.');
            addAiTableChatMsg('ai', question);
            appendAiTableHistory('assistant', question);
            return;
          }

          // Some providers omit the optional ready flag even though they
          // returned a complete table. Treat the presence of bounded table
          // fields as a completed response; normalizeAiTableData still
          // performs the authoritative schema validation below.
          if (isAiTableResponseReady(parsed)) {
            const normalizedTable = normalizeAiTableData(parsed);
            const summaryText = normalizedTable.summary || t('home.aiTable.summaryFallback');
            const bubble = addAiTableChatMsg('ai', `${summaryText}\n\n${t('home.aiTable.afterGenerateGuide')}`, true);
            aiTableData = normalizedTable;
            aiTableUndoStack = [];
            updateAiTableUndoButton();
            appendAiTableHistory('assistant', `${summaryText} ${t('home.aiTable.afterGenerateGuide')}`);
            bubble.addEventListener('click', () => {
              if (aiTablePreviewScroll) aiTablePreviewScroll.scrollIntoView({ behavior: 'smooth' });
            });
            renderAiTablePreview(normalizedTable);
          } else {
            console.warn('[AI Table] parsed missing fields:', parsed);
            addAiTableChatMsg('ai', t('home.aiTable.parseError'));
          }
        } catch (e) {
          if (requestId !== aiTableRequestId) return;
          console.error('[AI Table] Error:', e);
          if (controller.signal.aborted) {
            if (timedOut) addAiTableChatMsg('ai', t('home.aiTable.requestTimeout'));
          } else if (e instanceof AiTableDataError) {
            addAiTableChatMsg('ai', e.code === 'table_too_large'
              ? t('home.aiTable.tableTooLarge')
              : t('home.aiTable.parseError'));
          } else {
            addAiTableChatMsg('ai', t('home.aiTable.errNetwork'));
          }
        } finally {
          if (finishAiTableRequest(requestId)) {
            hideAiTableMask();
            if (aiTableChatSend) aiTableChatSend.disabled = !aiTableChatInput?.value?.trim();
          }
        }
      }

      // ===== Table Rendering & Editing =====
      function renderAiTablePreview(data) {
        if (!aiTablePreviewScroll || !data.columns) return;
        const renderVersion = ++aiTableRenderVersion;
        if (aiTableCanvasEmpty) aiTableCanvasEmpty.style.display = 'none';
        aiTablePreviewScroll.style.display = '';
        if (aiTableCanvasToolbar) aiTableCanvasToolbar.style.display = '';
        aiTablePreviewScroll.innerHTML = '';
        // Destroy previous Chart.js instances to avoid leaks
        aiTableChartCanvases.forEach(c => { try { c.instance && c.instance.destroy(); } catch (e) {} });
        aiTableChartCanvases = [];
        updateAiTableUndoButton();

        const editGuide = document.createElement('div');
        editGuide.className = 'ai-table-edit-guide';
        editGuide.innerHTML = `
          <div class="ai-table-edit-guide-copy">
            <div class="ai-table-edit-guide-title">${escapeHtml(t('home.aiTable.editGuideTitle'))}</div>
            <div class="ai-table-edit-guide-text">${escapeHtml(t('home.aiTable.editGuideBody'))}</div>
          </div>
          <div class="ai-table-edit-guide-side">
            <div class="ai-table-preview-stats">${escapeHtml(t('home.aiTable.editGuideStats', {
              rows: data.rows.length,
              columns: data.columns.length,
              charts: (data.charts || []).length
            }))}</div>
            <button class="ai-table-guide-link" type="button">
              <i data-lucide="circle-help"></i>
              <span>${escapeHtml(t('home.aiTable.help'))}</span>
            </button>
          </div>
        `;
        editGuide.querySelector('.ai-table-guide-link')?.addEventListener('click', () => openHelpOverlay('ai-table'));
        aiTablePreviewScroll.appendChild(editGuide);

        // Title
        if (data.title) {
          const titleEl = document.createElement('h3');
          titleEl.className = 'ai-table-title';
          titleEl.textContent = data.title;
          titleEl.title = t('home.aiTable.editTitleTip');
          titleEl.addEventListener('click', () => {
            if (titleEl.isContentEditable) return;
            titleEl.setAttribute('contenteditable', 'true');
            titleEl.focus();
            const r = document.createRange(); r.selectNodeContents(titleEl);
            const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
          });
          titleEl.addEventListener('blur', () => {
            titleEl.removeAttribute('contenteditable');
            if (aiTableData) {
              const nextTitle = titleEl.textContent.trim().slice(0, AI_TABLE_LIMITS.maxTitleChars);
              if (!aiTableValuesEqual(aiTableData.title, nextTitle)) {
                pushAiTableUndoState();
                aiTableData.title = nextTitle;
              }
              titleEl.textContent = aiTableData.title;
            }
          });
          aiTablePreviewScroll.appendChild(titleEl);
        }

        // Table container
        const tableWrap = document.createElement('div');
        tableWrap.className = 'ai-table-wrap';
        const table = document.createElement('table');
        table.className = 'ai-table-grid';

        // Header row
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        data.columns.forEach((col, colIdx) => {
          const th = document.createElement('th');
          th.dataset.colIdx = colIdx;
          th.addEventListener('click', () => sortAiTable(colIdx));
          const label = document.createElement('span');
          label.textContent = col.label || col.key;
          th.appendChild(label);
          if (data.columns.length > 1) {
            const deleteColBtn = document.createElement('button');
            deleteColBtn.className = 'ai-table-col-delete';
            deleteColBtn.innerHTML = AI_TABLE_ICON_TRASH;
            deleteColBtn.title = t('home.aiTable.deleteColumn');
            deleteColBtn.setAttribute('aria-label', t('home.aiTable.deleteColumn'));
            deleteColBtn.addEventListener('click', (event) => {
              event.stopPropagation();
              removeAiTableColumn(colIdx);
            });
            th.appendChild(deleteColBtn);
          }
          headerRow.appendChild(th);
        });
        // Action column header
        const actionTh = document.createElement('th');
        actionTh.className = 'ai-table-action-col';
        actionTh.textContent = '';
        headerRow.appendChild(actionTh);
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Body rows
        const tbody = document.createElement('tbody');
        data.rows.forEach((row, rowIdx) => {
          const tr = createAiTableRow(row, rowIdx, data.columns);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableWrap.appendChild(table);

        // Add row button
        const addRowBtn = document.createElement('button');
        addRowBtn.className = 'ai-table-add-btn';
        addRowBtn.innerHTML = AI_TABLE_ICON_PLUS + ' ' + escapeHtml(t('home.aiTable.addRow'));
        addRowBtn.addEventListener('click', () => {
          if (!aiTableData) return;
          if (aiTableData.rows.length >= AI_TABLE_LIMITS.maxRows) {
            addAiTableChatMsg('ai', t('home.aiTable.rowLimit', { max: AI_TABLE_LIMITS.maxRows }));
            return;
          }
          pushAiTableUndoState();
          const newRow = aiTableData.columns.map(c => c.type === 'number' ? 0 : '');
          aiTableData.rows.push(newRow);
          renderAiTablePreview(aiTableData);
        });
        tableWrap.appendChild(addRowBtn);

        // Add column button
        const addColBtn = document.createElement('button');
        addColBtn.className = 'ai-table-add-btn';
        addColBtn.innerHTML = AI_TABLE_ICON_PLUS + ' ' + escapeHtml(t('home.aiTable.addCol'));
        addColBtn.addEventListener('click', () => {
          if (!aiTableData) return;
          if (aiTableData.columns.length >= AI_TABLE_LIMITS.maxColumns) {
            addAiTableChatMsg('ai', t('home.aiTable.columnLimit', { max: AI_TABLE_LIMITS.maxColumns }));
            return;
          }
          pushAiTableUndoState();
          const usedKeys = new Set(aiTableData.columns.map(column => column.key));
          let keyIndex = aiTableData.columns.length + 1;
          let key = `col_${keyIndex}`;
          while (usedKeys.has(key)) {
            keyIndex += 1;
            key = `col_${keyIndex}`;
          }
          aiTableData.columns.push({ key, label: t('home.aiTable.addCol'), type: 'text' });
          aiTableData.rows.forEach(r => r.push(''));
          // Re-render
          renderAiTablePreview(aiTableData);
        });
        tableWrap.appendChild(addColBtn);

        aiTablePreviewScroll.appendChild(tableWrap);

        // Fallback: if AI returned no charts, auto-generate a bar chart from the
        // first text column (labels) and first numeric column (values).
        if (!data.charts || data.charts.length === 0) {
          const textColIdx = data.columns.findIndex(c => c.type !== 'number');
          const numColIdx = data.columns.findIndex(c => c.type === 'number');
          if (numColIdx !== -1) {
            const labelIdx = textColIdx !== -1 ? textColIdx : 0;
            data.charts = [{
              type: 'bar',
              title: (data.columns[numColIdx].label || t('home.aiTable.defaultChartValue')) + ' ' + t('home.aiTable.chartCompare'),
              labelColumn: labelIdx,
              valueColumns: [numColIdx],
            }];
          }
        }

        // Sanitize chart column indices against current columns (in case of edits)
        if (data.charts) {
          data.charts = data.charts.filter(ch => {
            const vc = (ch.valueColumns || []).filter(i => i >= 0 && i < data.columns.length);
            if (vc.length === 0) return false;
            ch.valueColumns = vc;
            if (ch.labelColumn == null || ch.labelColumn < 0 || ch.labelColumn >= data.columns.length) ch.labelColumn = 0;
            return true;
          });
        }

        const statsEl = editGuide.querySelector('.ai-table-preview-stats');
        if (statsEl) {
          statsEl.textContent = t('home.aiTable.editGuideStats', {
            rows: data.rows.length,
            columns: data.columns.length,
            charts: (data.charts || []).length
          });
        }

        // Charts
        const chartRenderJobs = [];
        if (data.charts && data.charts.length > 0) {
          data.charts.forEach((chart, chartIdx) => {
            const chartWrap = document.createElement('div');
            chartWrap.className = 'ai-table-chart-wrap';
            const chartTitle = document.createElement('div');
            chartTitle.className = 'ai-table-chart-title';
            chartTitle.textContent = chart.title || t('home.aiTable.defaultChartTitle');
            chartWrap.appendChild(chartTitle);
            const canvasHolder = document.createElement('div');
            canvasHolder.className = 'ai-table-chart-holder';
            const canvas = document.createElement('canvas');
            canvas.className = 'ai-table-chart-canvas';
            canvas.width = 760; canvas.height = 380;
            canvasHolder.appendChild(canvas);
            chartWrap.appendChild(canvasHolder);
            aiTablePreviewScroll.appendChild(chartWrap);
            // Draw chart after DOM insertion so canvas has dimensions
            chartRenderJobs.push(new Promise(resolve => {
              requestAnimationFrame(async () => {
                try {
                  const rendered = await renderAiTableChartJs(canvas, chart, data, renderVersion);
                  resolve({ ok: rendered !== false });
                } catch (error) {
                  // Keep the preview usable when one chart fails, while
                  // retaining the concrete error for exports and diagnostics.
                  console.error('[AI Table] Chart render failed:', error);
                  resolve({ ok: false, error });
                }
              });
            }));
          });
        }
        aiTableChartRenderPromise = Promise.all(chartRenderJobs);
        aiTableChartRenderPromise.then((results) => {
          if (renderVersion !== aiTableRenderVersion) return;
          const failed = results.find(result => !result?.ok);
          if (failed) addAiTableChatMsg('ai', t('home.aiTable.errChart'));
        });

        try { createIcons({ icons }); }
        catch (e) { if (window.lucide) window.lucide.createIcons(); }
      }

      function createAiTableRow(row, rowIdx, columns) {
        const tr = document.createElement('tr');
        tr.dataset.rowIdx = rowIdx;
        columns.forEach((col, colIdx) => {
          const td = document.createElement('td');
          td.textContent = row[colIdx] !== undefined ? String(row[colIdx]) : '';
          td.dataset.colIdx = colIdx;
          td.title = t('home.aiTable.editCellTip');
          td.addEventListener('click', () => {
            if (td.isContentEditable) return;
            td.setAttribute('contenteditable', 'true');
            td.focus();
            const r = document.createRange(); r.selectNodeContents(td);
            const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
          });
          td.addEventListener('blur', () => {
            td.removeAttribute('contenteditable');
            if (aiTableData && aiTableData.rows[rowIdx]) {
              const val = td.textContent.trim().slice(0, AI_TABLE_LIMITS.maxCellChars);
              const previousValue = aiTableData.rows[rowIdx][colIdx];
              if (col.type === 'number') {
                if (val === '') {
                  if (!aiTableValuesEqual(previousValue, '')) pushAiTableUndoState();
                  aiTableData.rows[rowIdx][colIdx] = '';
                } else {
                  const num = parseAiTableNumber(val);
                  if (num === null) {
                    td.textContent = previousValue == null ? '' : String(previousValue);
                    addAiTableChatMsg('ai', t('home.aiTable.invalidNumber'));
                    return;
                  }
                  if (!aiTableValuesEqual(previousValue, num)) pushAiTableUndoState();
                  aiTableData.rows[rowIdx][colIdx] = num;
                }
                td.textContent = String(aiTableData.rows[rowIdx][colIdx]);
              } else {
                const textChars = aiTableData.rows.reduce((total, sourceRow, sourceRowIdx) => (
                  total + sourceRow.reduce((rowTotal, value, sourceColIdx) => {
                    if (sourceRowIdx === rowIdx && sourceColIdx === colIdx) return rowTotal + val.length;
                    return rowTotal + (typeof value === 'string' ? value.length : 0);
                  }, 0)
                ), 0);
                try {
                  assertAiTableTextBudget(textChars);
                } catch {
                  td.textContent = previousValue == null ? '' : String(previousValue);
                  addAiTableChatMsg('ai', t('home.aiTable.tableTooLarge'));
                  return;
                }
                if (!aiTableValuesEqual(previousValue, val)) pushAiTableUndoState();
                aiTableData.rows[rowIdx][colIdx] = val;
                td.textContent = val;
              }
              // Keep charts and every export format aligned with manual edits.
              renderAiTablePreview(aiTableData);
            }
          });
          td.addEventListener('keydown', (e) => { if (e.key === 'Escape') td.blur(); });
          tr.appendChild(td);
        });
        // Delete row button
        const delTd = document.createElement('td');
        delTd.className = 'ai-table-action-col';
        const delBtn = document.createElement('button');
        delBtn.className = 'ai-table-del-btn';
        delBtn.innerHTML = AI_TABLE_ICON_TRASH;
        delBtn.title = t('home.aiTable.deleteRow');
        delBtn.setAttribute('aria-label', t('home.aiTable.deleteRow'));
        delBtn.addEventListener('click', () => {
          if (!aiTableData || !aiTableData.rows[rowIdx]) return;
          pushAiTableUndoState();
          aiTableData.rows.splice(rowIdx, 1);
          renderAiTablePreview(aiTableData);
        });
        delTd.appendChild(delBtn);
        tr.appendChild(delTd);
        return tr;
      }

      function removeAiTableColumn(colIdx) {
        if (!aiTableData || aiTableData.columns.length <= 1) {
          addAiTableChatMsg('ai', t('home.aiTable.minColumn'));
          return;
        }
        pushAiTableUndoState();
        aiTableData.columns.splice(colIdx, 1);
        aiTableData.rows.forEach(row => row.splice(colIdx, 1));
        aiTableData.charts = (aiTableData.charts || []).map(chart => {
          const remap = (index) => index === colIdx ? null : (index > colIdx ? index - 1 : index);
          const valueColumns = (chart.valueColumns || []).map(remap).filter(index => index !== null);
          const labelColumn = remap(chart.labelColumn);
          return { ...chart, labelColumn: labelColumn === null ? 0 : labelColumn, valueColumns };
        }).filter(chart => chart.valueColumns.length > 0);
        renderAiTablePreview(aiTableData);
      }

      let aiTableSortCol = -1, aiTableSortAsc = true;
      function sortAiTable(colIdx) {
        if (!aiTableData || !aiTableData.columns[colIdx]) return;
        if (!aiTableData.rows || aiTableData.rows.length < 2) return;
        const col = aiTableData.columns[colIdx];
        const isNumeric = col.type === 'number';
        // Toggle direction if clicking the same column
        if (aiTableSortCol === colIdx) aiTableSortAsc = !aiTableSortAsc;
        else { aiTableSortCol = colIdx; aiTableSortAsc = true; }
        const dir = aiTableSortAsc ? 1 : -1;
        pushAiTableUndoState();
        aiTableData.rows.sort((a, b) => {
          const va = a[colIdx], vb = b[colIdx];
          if (isNumeric) return ((parseFloat(va) || 0) - (parseFloat(vb) || 0)) * dir;
          return String(va).localeCompare(String(vb), 'zh') * dir;
        });
        renderAiTablePreview(aiTableData);
      }

      // ===== Chart Rendering (Chart.js, refined monochrome theme) =====
      const AI_TABLE_FONT = "'DouyinSansBold', 'Microsoft YaHei', sans-serif";
      // Per-series gradient stops [top, bottom] for depth; doughnut slice palette
      const AI_TABLE_SERIES = [
        { dark: '#1f1f1f', light: '#5f5f5f' },
        { dark: '#525252', light: '#9a9a9a' },
        { dark: '#7a7a7a', light: '#b8b8b8' },
        { dark: '#9c9c9c', light: '#d4d4d4' },
      ];
      const AI_TABLE_SLICES = ['#262626', '#454545', '#636363', '#828282', '#a0a0a0', '#bdbdbd', '#383838', '#d6d6d6'];

      function aiTableFmtNum(v) {
        if (typeof v !== 'number') v = parseFloat(v);
        if (isNaN(v)) return '';
        if (Math.abs(v) >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
        return Number.isInteger(v) ? String(v) : v.toFixed(1);
      }
      function aiTableHexToRgba(hex, a) {
        const m = hex.replace('#', '');
        const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${a})`;
      }
      function aiTableVGradient(chart, from, to) {
        const area = chart.chartArea;
        if (!area) return from;
        const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
        g.addColorStop(0, from); g.addColorStop(1, to);
        return g;
      }

      // White background for opaque PNG/PDF export
      const aiTableBgPlugin = {
        id: 'aiTableWhiteBg',
        beforeDraw: (c) => {
          const cx = c.ctx; cx.save();
          cx.globalCompositeOperation = 'destination-over';
          cx.fillStyle = '#ffffff';
          cx.fillRect(0, 0, c.width, c.height);
          cx.restore();
        },
      };
      // Value labels on top of bars / line points
      const aiTableValueLabelPlugin = {
        id: 'aiTableValueLabels',
        afterDatasetsDraw: (chart) => {
          const type = chart.config.type;
          if (type !== 'bar' && type !== 'line') return;
          const ctx = chart.ctx; ctx.save();
          ctx.font = "600 11px " + AI_TABLE_FONT;
          ctx.fillStyle = '#4d4d4d';
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          chart.data.datasets.forEach((ds, di) => {
            const meta = chart.getDatasetMeta(di);
            if (meta.hidden || meta.data.length > 14) return;
            meta.data.forEach((el, i) => {
              const txt = aiTableFmtNum(ds.data[i]);
              if (txt) ctx.fillText(txt, el.x, el.y - 6);
            });
          });
          ctx.restore();
        },
      };
      // Percentage labels on doughnut slices + center total
      const aiTableDoughnutPlugin = {
        id: 'aiTableDoughnut',
        afterDatasetsDraw: (chart) => {
          if (chart.config.type !== 'doughnut') return;
          const ctx = chart.ctx;
          const meta = chart.getDatasetMeta(0);
          const ds = chart.data.datasets[0];
          const total = ds.data.reduce((s, v) => s + (parseFloat(v) || 0), 0) || 1;
          ctx.save();
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          meta.data.forEach((arc, i) => {
            const val = parseFloat(ds.data[i]) || 0;
            const pct = val / total;
            if (pct < 0.05) return;
            const ang = (arc.startAngle + arc.endAngle) / 2;
            const r = (arc.innerRadius + arc.outerRadius) / 2;
            const x = arc.x + Math.cos(ang) * r;
            const y = arc.y + Math.sin(ang) * r;
            ctx.font = "700 11px " + AI_TABLE_FONT;
            ctx.fillStyle = (i % AI_TABLE_SLICES.length) < 4 ? '#ffffff' : '#1f1f1f';
            ctx.fillText(Math.round(pct * 100) + '%', x, y);
          });
          const arc0 = meta.data[0];
          if (arc0) {
            ctx.fillStyle = '#9a9a9a'; ctx.font = "600 11px " + AI_TABLE_FONT;
            ctx.fillText(t('home.aiTable.total'), arc0.x, arc0.y - 11);
            ctx.fillStyle = '#1f1f1f'; ctx.font = "700 18px " + AI_TABLE_FONT;
            ctx.fillText(aiTableFmtNum(total), arc0.x, arc0.y + 9);
          }
          ctx.restore();
        },
      };

      async function renderAiTableChartJs(canvas, chartDef, data, renderVersion) {
        let ChartJS;
        try {
          ChartJS = (await import('chart.js/auto')).default;
        } catch (e) {
          console.error('[AI Table] Chart.js load failed:', e);
          throw new Error('Chart.js could not be loaded.', { cause: e });
        }
        if (renderVersion !== aiTableRenderVersion) return false;

        const labelCol = chartDef.labelColumn || 0;
        const valCols = (chartDef.valueColumns && chartDef.valueColumns.length) ? chartDef.valueColumns : [1];
        const labels = data.rows.map(r => String(r[labelCol] !== undefined ? r[labelCol] : ''));

        const tickFont = { family: AI_TABLE_FONT, size: 11 };
        const legendFont = { family: AI_TABLE_FONT, size: 12 };

        let config;
        if (chartDef.type === 'pie') {
          const values = data.rows.map(r => parseAiTableNumber(r[valCols[0]]) ?? 0);
          config = {
            type: 'doughnut',
            data: {
              labels,
              datasets: [{
                data: values,
                backgroundColor: labels.map((_, i) => AI_TABLE_SLICES[i % AI_TABLE_SLICES.length]),
                borderColor: '#ffffff',
                borderWidth: 3,
                hoverOffset: 6,
                spacing: 2,
              }],
            },
            options: {
              responsive: false,
              animation: false,
              devicePixelRatio: 2,
              cutout: '60%',
              radius: '88%',
              layout: { padding: { top: 12, right: 12, bottom: 12, left: 12 } },
              plugins: {
                legend: {
                  position: 'right',
                  labels: { color: '#404040', font: legendFont, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 14 },
                },
                tooltip: { enabled: false },
              },
            },
            plugins: [aiTableBgPlugin, aiTableDoughnutPlugin],
          };
        } else {
          const isLine = chartDef.type === 'line';
          const datasets = valCols.map((vi, si) => {
            const seriesData = data.rows.map(r => parseAiTableNumber(r[vi]));
            const s = AI_TABLE_SERIES[si % AI_TABLE_SERIES.length];
            if (isLine) {
              return {
                label: data.columns[vi]?.label || '',
                data: seriesData,
                borderColor: s.dark,
                borderWidth: 2.5,
                tension: 0.4,
                fill: true,
                backgroundColor: (c) => {
                  const area = c.chart.chartArea;
                  if (!area) return 'rgba(0,0,0,0)';
                  const g = c.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
                  g.addColorStop(0, aiTableHexToRgba(s.dark, 0.20));
                  g.addColorStop(1, 'rgba(255,255,255,0)');
                  return g;
                },
                pointRadius: seriesData.length > 14 ? 0 : 4,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: s.dark,
                pointBorderWidth: 2,
                pointHoverRadius: 6,
              };
            }
            return {
              label: data.columns[vi]?.label || '',
              data: seriesData,
              backgroundColor: (c) => aiTableVGradient(c.chart, s.dark, s.light),
              borderRadius: 6,
              borderSkipped: false,
              maxBarThickness: 52,
              categoryPercentage: 0.68,
              barPercentage: 0.86,
            };
          });
          config = {
            type: isLine ? 'line' : 'bar',
            data: { labels, datasets },
            options: {
              responsive: false,
              animation: false,
              devicePixelRatio: 2,
              layout: { padding: { top: 26, right: 16, bottom: 6, left: 6 } },
              plugins: {
                legend: {
                  display: datasets.length > 1,
                  align: 'end',
                  labels: { color: '#404040', font: legendFont, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 16 },
                },
                tooltip: { enabled: false },
              },
              scales: {
                x: {
                  grid: { display: false },
                  border: { display: false },
                  ticks: { color: '#6b6b6b', font: tickFont, maxRotation: 0, autoSkip: true, padding: 6 },
                },
                y: {
                  beginAtZero: true,
                  grid: { color: 'rgba(0,0,0,0.05)' },
                  border: { display: false, dash: [3, 3] },
                  ticks: { color: '#a0a0a0', font: tickFont, padding: 8, maxTicksLimit: 6, callback: (v) => aiTableFmtNum(v) },
                },
              },
            },
            plugins: [aiTableBgPlugin, aiTableValueLabelPlugin],
          };
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Chart canvas context is unavailable.');
        const instance = new ChartJS(ctx, config);
        if (renderVersion !== aiTableRenderVersion) {
          instance.destroy();
          return false;
        }
        aiTableChartCanvases.push({ canvas, instance, chartDef });
        return true;
      }

      // ===== Export Functions =====
      function exportAiTableCsv() {
        if (!aiTableData) return;
        const csv = makeAiTableCsv(aiTableData);
        downloadAiTableFile(csv, 'text/csv;charset=utf-8', `ai_table_${Date.now()}.csv`);
      }

      async function exportAiTableXlsx() {
        if (!aiTableData) return;
        showAiTableMask(t('home.aiTable.exportingExcel'));
        try {
          // Chart.js renders on the next animation frame. Wait for that
          // frame before taking snapshots, otherwise an XLSX export can
          // contain an empty chart even though the preview is still drawing.
          const chartResults = await aiTableChartRenderPromise;
          const failedChart = chartResults.find(result => !result?.ok);
          if (failedChart) throw (failedChart.error || new Error('Chart rendering failed.'));

          // ExcelJS supports full cell styling (borders, fonts, fills) unlike SheetJS community build
          const ExcelJS = (await import('exceljs')).default;
          const cols = aiTableData.columns;
          const wb = new ExcelJS.Workbook();
          const sheetName = normalizeAiTableSheetName(aiTableData.title);
          const ws = wb.addWorksheet(sheetName);

          const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
          const allBorders = { top: thin, left: thin, bottom: thin, right: thin };

          // Measure helper (CJK chars count as ~1.8 units)
          const measure = (v) => {
            const s = String(v == null ? '' : v);
            let w = 0;
            for (const ch of s) w += /[\u4e00-\u9fff\uff00-\uffef]/.test(ch) ? 1.8 : 1;
            return w;
          };

          // Optional title row spanning all columns
          let startRow = 1;
          if (aiTableData.title) {
            ws.mergeCells(1, 1, 1, cols.length);
            const titleCell = ws.getCell(1, 1);
            titleCell.value = safeSpreadsheetCellValue(aiTableData.title);
            titleCell.font = { bold: true, size: 16, color: { argb: 'FF1A1A1A' } };
            titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
            ws.getRow(1).height = 28;
            startRow = 2;
          }

          // Header row
          const headerRow = ws.getRow(startRow);
          cols.forEach((c, ci) => {
            const cell = headerRow.getCell(ci + 1);
            cell.value = safeSpreadsheetCellValue(c.label || c.key);
            cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E2E2E' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = allBorders;
          });
          headerRow.height = 22;

          // Data rows
          aiTableData.rows.forEach((row, ri) => {
            const r = ws.getRow(startRow + 1 + ri);
            cols.forEach((c, ci) => {
              const cell = r.getCell(ci + 1);
              let val = row[ci];
              const numericValue = c.type === 'number' ? parseAiTableNumber(val) : null;
              cell.value = c.type === 'number' && numericValue !== null
                ? numericValue
                : safeSpreadsheetCellValue(val);
              cell.alignment = { horizontal: c.type === 'number' ? 'right' : 'left', vertical: 'middle' };
              cell.border = allBorders;
              if (ri % 2 === 1) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
              }
            });
            r.height = 18;
          });

          // Column widths from content
          cols.forEach((c, ci) => {
            let max = measure(c.label || c.key);
            aiTableData.rows.forEach(rw => { max = Math.max(max, measure(rw[ci])); });
            ws.getColumn(ci + 1).width = Math.min(Math.max(max + 3, 10), 50);
          });

          // Keep chart output alongside the editable table. ExcelJS accepts a
          // data URL in browser builds and embeds the actual rendered bitmap.
          if (aiTableData.charts && aiTableData.charts.length > 0) {
            if (aiTableChartCanvases.length !== aiTableData.charts.length) {
              throw new Error('Rendered chart count does not match the table data.');
            }
            const chartsName = t('home.aiTable.chartSheet') || 'Charts';
            const chartsBaseName = normalizeAiTableSheetName(chartsName);
            const usedSheetNames = new Set([sheetName.toLocaleLowerCase()]);
            let chartsSheetName = chartsBaseName;
            let sheetSuffix = 2;
            while (usedSheetNames.has(chartsSheetName.toLocaleLowerCase())) {
              const suffix = ` ${sheetSuffix++}`;
              chartsSheetName = `${chartsBaseName.slice(0, 31 - suffix.length)}${suffix}`;
            }
            const chartsWs = wb.addWorksheet(chartsSheetName);
            chartsWs.views = [{ showGridLines: false }];
            for (let column = 1; column <= 12; column++) chartsWs.getColumn(column).width = 12;
            chartsWs.mergeCells(1, 1, 1, 12);
            const chartsHeading = chartsWs.getCell(1, 1);
            chartsHeading.value = aiTableData.title
              ? `${aiTableData.title} - ${chartsName}`
              : chartsName;
            chartsHeading.font = { bold: true, size: 16, color: { argb: 'FF1A1A1A' } };
            chartsHeading.alignment = { horizontal: 'center', vertical: 'middle' };
            chartsWs.getRow(1).height = 28;

            let chartRow = 3;
            aiTableChartCanvases.forEach(({ canvas: chartCanvas, chartDef }, chartIndex) => {
              const titleRow = chartRow;
              chartsWs.mergeCells(titleRow, 1, titleRow, 12);
              const chartTitle = chartsWs.getCell(titleRow, 1);
              chartTitle.value = chartDef.title || `${t('home.aiTable.defaultChartTitle')} ${chartIndex + 1}`;
              chartTitle.font = { bold: true, size: 12, color: { argb: 'FF262626' } };
              chartTitle.alignment = { horizontal: 'left', vertical: 'middle' };
              chartsWs.getRow(titleRow).height = 22;

              const imageData = chartCanvas.toDataURL('image/png');
              if (!imageData || imageData.length < 128) {
                throw new Error(`Chart ${chartIndex + 1} produced an empty image.`);
              }
              const imageId = wb.addImage({ base64: imageData, extension: 'png' });
              chartsWs.addImage(imageId, {
                tl: { col: 0, row: titleRow },
                ext: { width: 760, height: 380 }
              });
              // Reserve enough worksheet rows for the image before placing
              // the next chart; this keeps multiple charts from overlapping.
              chartRow += 22;
            });
            wb.views = [{ activeTab: 1 }];
          }

          const buffer = await wb.xlsx.writeBuffer();
          const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          await saveAiTableBlob(blob, `ai_table_${Date.now()}.xlsx`);
        } catch (e) {
          console.error('[AI Table] XLSX export error:', e);
          addAiTableChatMsg('ai', t('home.aiTable.errXlsx'));
        } finally { hideAiTableMask(); }
      }

      async function exportAiTablePng() {
        if (!aiTableData) return;
        showAiTableMask(t('home.aiTable.exportingPng'));
        try {
          await aiTableChartRenderPromise;
          // Build a composite canvas: table text + charts
          const padding = 40;
          const tableW = 600;
          const headerH = aiTableData.title ? 40 : 0;
          const rowH = 32;
          const tableH = headerH + (aiTableData.rows.length + 1) * rowH + 20;
          const chartH = aiTableChartCanvases.length > 0 ? aiTableChartCanvases.reduce((sum, c) => sum + c.canvas.height + 30, 0) : 0;
          const totalW = Math.max(tableW, ...aiTableChartCanvases.map(c => c.canvas.width)) + padding * 2;
          const totalH = padding + tableH + chartH + padding;

          const canvas = document.createElement('canvas');
          canvas.width = totalW; canvas.height = totalH;
          const ctx = canvas.getContext('2d');
          // White, print-friendly background to match black & white charts
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, totalW, totalH);

          let y = padding;
          // Title
          if (aiTableData.title) {
            ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(aiTableData.title, totalW / 2, y + 20); y += headerH;
          }
          // Table header
          const colW = (totalW - padding * 2) / aiTableData.columns.length;
          ctx.fillStyle = '#1a1a1a'; ctx.fillRect(padding, y, totalW - padding * 2, rowH);
          ctx.fillStyle = '#ffffff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left';
          aiTableData.columns.forEach((col, ci) => {
            ctx.fillText(col.label || col.key, padding + ci * colW + 8, y + 20);
          });
          y += rowH;
          // Table rows
          aiTableData.rows.forEach((row, ri) => {
            ctx.fillStyle = ri % 2 === 1 ? '#f2f2f2' : '#ffffff';
            ctx.fillRect(padding, y, totalW - padding * 2, rowH);
            ctx.fillStyle = '#262626'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
            row.forEach((val, ci) => {
              const text = String(val == null ? '' : val);
              const maxW = colW - 16;
              let display = text;
              if (ctx.measureText(display).width > maxW) {
                while (display.length > 1 && ctx.measureText(display + '…').width > maxW) display = display.slice(0, -1);
                display += '…';
              }
              ctx.fillText(display, padding + ci * colW + 8, y + 20);
            });
            y += rowH;
          });
          // Table border lines
          ctx.strokeStyle = '#d9d9d9'; ctx.lineWidth = 1;
          ctx.strokeRect(padding, padding + headerH, totalW - padding * 2, (aiTableData.rows.length + 1) * rowH);
          y += 20;

          // Charts
          aiTableChartCanvases.forEach(({ canvas: chartCanvas }) => {
            ctx.drawImage(chartCanvas, padding, y);
            y += chartCanvas.height + 30;
          });

          canvas.toBlob((blob) => {
            if (!blob) { hideAiTableMask(); addAiTableChatMsg('ai', t('home.aiTable.errPng')); return; }
            saveAiTableBlob(blob, `ai_table_${Date.now()}.png`).then(() => hideAiTableMask()).catch((err) => {
              console.error('[AI Table] PNG save error:', err);
              hideAiTableMask();
              addAiTableChatMsg('ai', t('home.aiTable.errPng'));
            });
          }, 'image/png');
        } catch (e) {
          console.error('[AI Table] PNG export error:', e);
          hideAiTableMask();
          addAiTableChatMsg('ai', t('home.aiTable.errPng'));
        }
      }

      async function exportAiTablePdf() {
        if (!aiTableData) return;
        showAiTableMask(t('home.aiTable.exportingPdf'));
        try {
          await aiTableChartRenderPromise;
          await loadAiDocFontBytes();
          const pdfLib = await import('pdf-lib-plus-encrypt');
          const { PDFDocument, StandardFonts, rgb } = pdfLib.PDFDocument ? pdfLib : pdfLib.default;
          const pdfDoc = await PDFDocument.create();
          // Embed Chinese-capable font so CJK characters don't crash WinAnsi encoder
          let font;
          if (aiDocFontRegularBytes) {
            const fontkit = (await import('@pdf-lib/fontkit')).default;
            pdfDoc.registerFontkit(fontkit);
            font = await pdfDoc.embedFont(aiDocFontRegularBytes);
          } else {
            font = await pdfDoc.embedFont(StandardFonts.Helvetica);
          }
          const pageW = 595.28, pageH = 841.89;
          const margin = 40;
          let page = pdfDoc.addPage([pageW, pageH]);
          let y = pageH - margin;

          // Truncate text to fit within a given pixel width using actual font metrics
          const fitText = (text, maxW, size) => {
            let s = String(text == null ? '' : text);
            if (font.widthOfTextAtSize(s, size) <= maxW) return s;
            while (s.length > 1 && font.widthOfTextAtSize(s + '…', size) > maxW) s = s.slice(0, -1);
            return s + '…';
          };

          // Title
          if (aiTableData.title) {
            const titleSize = 16;
            page.drawText(fitText(aiTableData.title, pageW - margin * 2, titleSize), { x: margin, y: y - titleSize, size: titleSize, font, color: rgb(0.1, 0.1, 0.1) });
            y -= titleSize + 12;
          }

          // Table
          const cols = aiTableData.columns;
          const colW = (pageW - margin * 2) / cols.length;
          const rowH = 22;
          const fontSize = 9;
          const cellPad = 5;

          const drawTableHeader = () => {
            page.drawRectangle({ x: margin, y: y - rowH, width: pageW - margin * 2, height: rowH, color: rgb(0.18, 0.18, 0.18) });
            cols.forEach((col, ci) => {
              page.drawText(fitText(col.label || col.key, colW - cellPad * 2, fontSize), { x: margin + ci * colW + cellPad, y: y - rowH + 7, size: fontSize, font, color: rgb(1, 1, 1) });
            });
            y -= rowH;
          };
          drawTableHeader();

          // Rows
          aiTableData.rows.forEach((row, ri) => {
            if (y - rowH < margin) {
              page = pdfDoc.addPage([pageW, pageH]);
              y = pageH - margin;
              drawTableHeader();
            }
            if (ri % 2 === 1) {
              page.drawRectangle({ x: margin, y: y - rowH, width: pageW - margin * 2, height: rowH, color: rgb(0.95, 0.95, 0.95) });
            }
            row.forEach((val, ci) => {
              try {
                page.drawText(fitText(val, colW - cellPad * 2, fontSize), { x: margin + ci * colW + cellPad, y: y - rowH + 7, size: fontSize, font, color: rgb(0.15, 0.15, 0.15) });
              } catch (e) {}
            });
            y -= rowH;
          });

          // Charts as images
          for (const { canvas: chartCanvas } of aiTableChartCanvases) {
            const pngDataUrl = chartCanvas.toDataURL('image/png');
            const base64 = pngDataUrl.split(',')[1];
            const imgBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            const img = await pdfDoc.embedPng(imgBytes);
            const imgW = pageW - margin * 2;
            const imgH = img.height * (imgW / img.width);
            if (y - imgH < margin) {
              page = pdfDoc.addPage([pageW, pageH]);
              y = pageH - margin;
            }
            page.drawImage(img, { x: margin, y: y - imgH, width: imgW, height: imgH });
            y -= imgH + 20;
          }

          const pdfBytes = await pdfDoc.save();
          if (isTauri) {
            const { invoke } = await import('@tauri-apps/api/core');
            const outputDir = await getOutputDir('AI_Table');
            const fileName = `ai_table_${Date.now()}.pdf`;
            const outputPath = await invoke('write_unique_file_bytes', {
              directory: outputDir,
              fileName,
              bytes: Array.from(pdfBytes)
            });
            aiTableLastExportPath = outputPath;
            showAiTableSuccess(outputPath);
          } else {
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `ai_table_${Date.now()}.pdf`; a.click();
            URL.revokeObjectURL(url);
          }
        } catch (e) {
          console.error('[AI Table] PDF export error:', e);
          addAiTableChatMsg('ai', t('home.aiTable.errPdf'));
        } finally { hideAiTableMask(); }
      }

      async function saveAiTableBlob(blob, fileName) {
        if (isTauri) {
          const { invoke } = await import('@tauri-apps/api/core');
          const arrayBuffer = await blob.arrayBuffer();
          const outputDir = await getOutputDir('AI_Table');
          const outputPath = await invoke('write_unique_file_bytes', {
            directory: outputDir,
            fileName,
            bytes: Array.from(new Uint8Array(arrayBuffer))
          });
          aiTableLastExportPath = outputPath;
          showAiTableSuccess(outputPath);
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = fileName; a.click();
          URL.revokeObjectURL(url);
        }
      }

      async function downloadAiTableFile(content, mime, fileName) {
        const blob = new Blob([content], { type: mime });
        try { await saveAiTableBlob(blob, fileName); }
        catch (e) { console.error('[AI Table] CSV export error:', e); addAiTableChatMsg('ai', t('home.aiTable.errCsv')); }
      }

      function showAiTableSuccess(filePath) {
        if (aiTableSuccessPath) aiTableSuccessPath.textContent = filePath;
        if (aiTableSuccessOverlay) aiTableSuccessOverlay.classList.add('visible');
      }

      // ===== AI Table Event Listeners =====
      if (aiTableBack) aiTableBack.addEventListener('click', closeAiTableOverlay);
      if (aiTableHelpBtn) aiTableHelpBtn.addEventListener('click', () => openHelpOverlay('ai-table'));
      if (aiTableUndoBtn) aiTableUndoBtn.addEventListener('click', undoAiTableLastEdit);
      if (aiTableResetBtn) aiTableResetBtn.addEventListener('click', () => { resetAiTableState(); });
      if (aiTableSuccessOk) aiTableSuccessOk.addEventListener('click', () => { if (aiTableSuccessOverlay) aiTableSuccessOverlay.classList.remove('visible'); });
      if (aiTableSuccessOpenFolder) aiTableSuccessOpenFolder.addEventListener('click', async () => {
        if (isTauri && aiTableLastExportPath) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const folder = aiTableLastExportPath.replace(/[/\\][^/\\]+$/, '').replace(/\//g, '\\');
            await invoke('open_path', { path: folder });
          } catch (err) { console.error('[AI Table] Open folder error:', err); }
        }
      });

      document.querySelectorAll('.audio-list-item[data-tool="ai-table"]').forEach(item => {
        item.addEventListener('click', () => openToolWithAiCheck(openAiTableOverlay));
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openToolWithAiCheck(openAiTableOverlay); }
        });
      });

      if (aiTableChatSend) {
        aiTableChatSend.disabled = true;
        aiTableChatSend.addEventListener('click', handleAiTableSend);
      }
      if (aiTableChatInput) {
        aiTableChatInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiTableSend(); }
        });
        aiTableChatInput.addEventListener('input', () => {
          aiTableChatSend.disabled = !aiTableChatInput.value.trim();
        });
      }
      if (aiTableChatMessages) {
        aiTableChatMessages.addEventListener('click', (e) => {
          const chip = e.target.closest('.ai-doc-prompt-chip');
          if (!chip) return;
          const prompt = chip.dataset.prompt;
          if (aiTableChatInput && prompt) {
            aiTableChatInput.value = prompt;
            aiTableChatInput.focus();
            aiTableChatInput.dispatchEvent(new Event('input'));
          }
        });
      }

      // Export buttons
      document.querySelectorAll('.ai-table-export-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const fmt = btn.dataset.fmt;
          if (fmt === 'csv') exportAiTableCsv();
          else if (fmt === 'xlsx') exportAiTableXlsx();
          else if (fmt === 'png') exportAiTablePng();
          else if (fmt === 'pdf') exportAiTablePdf();
        });
      });
      // ===== End AI Table Tool =====

      // ===== Color Extractor Tool =====
      const colorExtractorOverlay = document.getElementById('colorExtractorOverlay');
      const colorExtractorBack = document.getElementById('colorExtractorBack');
      const colorExtractorBg = document.getElementById('colorExtractorBg');
      const colorExtractorUploadZone = document.getElementById('colorExtractorUploadZone');
      const colorExtractorFileInput = document.getElementById('colorExtractorFileInput');
      const colorExtractorResult = document.getElementById('colorExtractorResult');
      const colorExtractorCircles = document.getElementById('colorExtractorCircles');
      const colorExtractorImagePreview = document.getElementById('colorExtractorImagePreview');
      const colorExtractorImage = document.getElementById('colorExtractorImage');
      const colorExtractorCirclesView = document.getElementById('colorExtractorCirclesView');
      const colorExtractorReselectBtn = document.getElementById('colorExtractorReselectBtn');
      const colorExtractorFill = document.getElementById('colorExtractorFill');
      const colorExtractorDetailView = document.getElementById('colorExtractorDetailView');
      const colorExtractorDetailCols = document.getElementById('colorExtractorDetailCols');
      const colorExtractorBackDetailBtn = document.getElementById('colorExtractorBackDetailBtn');

      let colorExtractorDitherInstance = null;
      let colorExtractorCurrentImg = null;
      let colorExtractorColors = [];
      let colorExtractorRequestId = 0;
      let colorExtractorPreviewUrl = null;

      function releaseColorExtractorPreviewUrl() {
        if (colorExtractorPreviewUrl) URL.revokeObjectURL(colorExtractorPreviewUrl);
        colorExtractorPreviewUrl = null;
      }

      function openColorExtractorOverlay() {
        if (!colorExtractorOverlay) return;
        colorExtractorOverlay.classList.add('visible');
        resetColorExtractorState();
        if (colorExtractorBg && !colorExtractorDitherInstance) {
          colorExtractorDitherInstance = initDither(colorExtractorBg, {
            waveColor: [0.4, 0.5, 0.9], colorNum: 40, pixelSize: 2,
            waveAmplitude: 0, waveFrequency: 0, waveSpeed: 0.07
          });
        }
      }
      function closeColorExtractorOverlay() {
        if (!colorExtractorOverlay) return;
        colorExtractorOverlay.classList.remove('visible');
        resetColorExtractorState();
        if (colorExtractorDitherInstance) { colorExtractorDitherInstance(); colorExtractorDitherInstance = null; }
      }
      function resetColorExtractorState() {
        colorExtractorRequestId += 1;
        // Clear any pending animation timers
        colorExtractorAnimationTimers.forEach(timer => clearTimeout(timer));
        colorExtractorAnimationTimers = [];
        colorExtractorIsAnimating = false;
        
        colorExtractorCurrentImg = null;
        colorExtractorColors = [];
        if (colorExtractorUploadZone) {
          colorExtractorUploadZone.style.display = '';
          colorExtractorUploadZone.classList.remove('dragover');
        }
        if (colorExtractorFileInput) colorExtractorFileInput.value = '';
        if (colorExtractorImagePreview) colorExtractorImagePreview.style.display = 'none';
        if (colorExtractorImage) colorExtractorImage.src = '';
        releaseColorExtractorPreviewUrl();
        if (colorExtractorResult) colorExtractorResult.classList.remove('visible');
        if (colorExtractorCircles) colorExtractorCircles.innerHTML = '';
        if (colorExtractorCirclesView) colorExtractorCirclesView.classList.remove('hidden');
        if (colorExtractorFill) {
          colorExtractorFill.classList.remove('expanded');
          colorExtractorFill.style.removeProperty('--fill-color');
          colorExtractorFill.style.removeProperty('--fill-x');
          colorExtractorFill.style.removeProperty('--fill-y');
          colorExtractorFill.style.removeProperty('--fill-scale');
        }
        if (colorExtractorDetailView) colorExtractorDetailView.classList.remove('visible');
        if (colorExtractorDetailCols) colorExtractorDetailCols.innerHTML = '';
      }

      // Color conversion helpers
      function rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(v => {
          const h = Math.round(v).toString(16);
          return h.length === 1 ? '0' + h : h;
        }).join('').toUpperCase();
      }
      function rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0, l = (max + min) / 2;
        if (max !== min) {
          const d = max - min;
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
          switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
            case g: h = ((b - r) / d + 2); break;
            case b: h = ((r - g) / d + 4); break;
          }
          h /= 6;
        }
        return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
      }

      // K-means color quantization
      function extractColors(img, numColors) {
        if (!img.naturalWidth || !img.naturalHeight) return [];
        numColors = Math.max(2, Math.min(numColors, 9));
        const canvas = document.createElement('canvas');
        const maxDim = 200; // Downsample for speed
        const scale = Math.min(maxDim / img.naturalWidth, maxDim / img.naturalHeight, 1);
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return [];
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let data;
        try {
          data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        } catch (error) {
          console.error('[Color Extractor] Pixel read error:', error);
          return [];
        }

        // Sample pixels (skip alpha=0)
        const pixels = [];
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          pixels.push([data[i], data[i + 1], data[i + 2]]);
        }
        if (pixels.length === 0) return [];

        // Init centroids: pick evenly spaced pixels
        let centroids = [];
        const step = Math.max(1, Math.floor(pixels.length / numColors));
        for (let i = 0; i < numColors && i * step < pixels.length; i++) {
          centroids.push([...pixels[i * step]]);
        }
        if (centroids.length === 0) return [];

        const maxIter = 12;
        let sums = centroids.map(() => [0, 0, 0, 0]); // r,g,b,count — outside loop for later access
        for (let iter = 0; iter < maxIter; iter++) {
          sums = centroids.map(() => [0, 0, 0, 0]); // reset each iteration
          for (const p of pixels) {
            let bestDist = Infinity, bestIdx = 0;
            for (let ci = 0; ci < centroids.length; ci++) {
              const c = centroids[ci];
              const d = (p[0]-c[0])**2 + (p[1]-c[1])**2 + (p[2]-c[2])**2;
              if (d < bestDist) { bestDist = d; bestIdx = ci; }
            }
            sums[bestIdx][0] += p[0];
            sums[bestIdx][1] += p[1];
            sums[bestIdx][2] += p[2];
            sums[bestIdx][3]++;
          }
          let changed = false;
          for (let ci = 0; ci < centroids.length; ci++) {
            if (sums[ci][3] === 0) continue;
            const nr = sums[ci][0] / sums[ci][3];
            const ng = sums[ci][1] / sums[ci][3];
            const nb = sums[ci][2] / sums[ci][3];
            if (Math.abs(nr - centroids[ci][0]) > 1 || Math.abs(ng - centroids[ci][1]) > 1 || Math.abs(nb - centroids[ci][2]) > 1) {
              changed = true;
              centroids[ci] = [nr, ng, nb];
            }
          }
          if (!changed) break;
        }

        // Sort by population (most frequent first)
        const result = centroids.map((c, ci) => ({
          r: Math.round(c[0]), g: Math.round(c[1]), b: Math.round(c[2]),
          count: sums[ci] ? sums[ci][3] : 0,
        })).sort((a, b) => b.count - a.count);

        return result;
      }

      // File handling
      let colorExtractorAnimationTimers = []; // Track animation timers for cleanup
      let colorExtractorIsAnimating = false; // Prevent multiple simultaneous animations

      async function handleColorExtractorFile(file) {
        resetColorExtractorState();
        const requestId = colorExtractorRequestId;
        try {
          assertColorExtractorFile(file);
        } catch (error) {
          showToast(error instanceof RangeError
            ? t('home.colorExtractor.fileTooLarge', { max: 20 })
            : t('home.colorExtractor.unsupportedFormat'));
          return;
        }

        const mimeType = file.type === 'image/png' || /\.png$/i.test(file.name || '')
          ? 'image/png'
          : (file.type === 'image/webp' || /\.webp$/i.test(file.name || '') ? 'image/webp' : 'image/jpeg');
        const useLoadedImage = (img, imageUrl) => {
          if (requestId !== colorExtractorRequestId) {
            URL.revokeObjectURL(imageUrl);
            return;
          }
          try {
            assertColorExtractorDimensions(img.naturalWidth, img.naturalHeight);
          } catch (error) {
            showToast(t('home.colorExtractor.dimensionsTooLarge'));
            return;
          }
          colorExtractorCurrentImg = img;
          if (colorExtractorUploadZone) colorExtractorUploadZone.style.display = 'none';
          if (colorExtractorImagePreview && colorExtractorImage) {
            colorExtractorImage.src = imageUrl;
            colorExtractorImagePreview.style.display = '';
          }
          doExtractColors();
        };
        const loadImage = (blob) => {
          const imageUrl = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => useLoadedImage(img, imageUrl);
          img.onerror = () => {
            URL.revokeObjectURL(imageUrl);
            if (requestId === colorExtractorRequestId) showToast(t('home.colorExtractor.extractFailed'));
          };
          colorExtractorPreviewUrl = imageUrl;
          img.src = imageUrl;
        };
        // In Tauri mode, read file bytes via backend to ensure data accessibility
        if (isTauri && file.path) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const fileSize = Number(await invoke('get_file_size', { path: file.path }));
            assertColorExtractorFile(file, fileSize);
            const rawBytes = await invoke('read_file_bytes', { path: file.path });
            const bytes = Array.isArray(rawBytes) ? Uint8Array.from(rawBytes) : new Uint8Array(rawBytes);
            assertColorExtractorFile(file, bytes.byteLength);
            assertColorExtractorImageBytes(bytes);
            const blob = new Blob([bytes], { type: mimeType });
            loadImage(blob);
            return;
          } catch (e) {
            console.error('[Color Extractor] Tauri file read error:', e);
            if (requestId === colorExtractorRequestId) {
              showToast(e instanceof RangeError
                ? t('home.colorExtractor.fileTooLarge', { max: 20 })
                : t('home.colorExtractor.extractFailed'));
            }
            return;
          }
        }
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (requestId !== colorExtractorRequestId) return;
          assertColorExtractorImageBytes(bytes);
          loadImage(file);
        } catch (error) {
          if (requestId !== colorExtractorRequestId) return;
          showToast(error instanceof RangeError
            ? t('home.colorExtractor.dimensionsTooLarge')
            : t('home.colorExtractor.extractFailed'));
        }
      }

      function doExtractColors() {
        if (!colorExtractorCurrentImg) return;
        const num = 9; // 9 colors for 3x3 grid
        const colors = extractColors(colorExtractorCurrentImg, num);
        if (colors.length === 0) {
          console.warn('[Color Extractor] No colors extracted');
          // Show user feedback
          if (colorExtractorResult) {
            colorExtractorResult.classList.remove('visible');
          }
          if (colorExtractorUploadZone) {
            colorExtractorUploadZone.style.display = '';
          }
          showToast(t('home.colorExtractor.extractFailed'));
          return;
        }
        colorExtractorColors = colors;
        renderColorCircles(colors);
      }

      function renderColorCircles(colors) {
        if (!colorExtractorCircles) return;
        colorExtractorCircles.innerHTML = '';
        const top5 = colors.slice(0, 5);
        top5.forEach((color, idx) => {
          const hex = rgbToHex(color.r, color.g, color.b);
          const item = document.createElement('div');
          item.className = 'color-extractor-circle-item';
          item.style.animationDelay = (idx * 0.08) + 's';

          const circle = document.createElement('div');
          circle.className = 'color-extractor-circle';
          circle.style.background = hex;
          circle.addEventListener('click', () => {
            expandColorToDetail(color, circle);
          });

          const hexLabel = document.createElement('span');
          hexLabel.className = 'color-extractor-circle-hex';
          hexLabel.textContent = hex;
          hexLabel.addEventListener('click', () => {
            expandColorToDetail(color, circle);
          });

          item.appendChild(circle);
          item.appendChild(hexLabel);
          colorExtractorCircles.appendChild(item);
        });
        if (colorExtractorResult) {
          requestAnimationFrame(() => {
            colorExtractorResult.classList.add('visible');
          });
        }
      }

      function resetColorExtractor() {
        resetColorExtractorState();
      }

      function expandColorToDetail(color, circleEl) {
        if (!colorExtractorFill || !colorExtractorResult) return;
        if (colorExtractorIsAnimating) return; // Prevent multiple simultaneous animations
        colorExtractorIsAnimating = true;
        
        const hex = rgbToHex(color.r, color.g, color.b);
        const rgbStr = `rgb(${color.r}, ${color.g}, ${color.b})`;
        const [h, s, l] = rgbToHsl(color.r, color.g, color.b);
        const hslStr = `hsl(${h}, ${s}%, ${l}%)`;

        // Calculate circle center relative to result container
        const rect = circleEl.getBoundingClientRect();
        const containerRect = colorExtractorResult.getBoundingClientRect();
        
        // Validate container dimensions
        if (containerRect.width === 0 || containerRect.height === 0) {
          console.error('[Color Extractor] Invalid container dimensions');
          colorExtractorIsAnimating = false;
          return;
        }
        
        const cx = rect.left + rect.width / 2 - containerRect.left;
        const cy = rect.top + rect.height / 2 - containerRect.top;
        const xPct = (cx / containerRect.width) * 100;
        const yPct = (cy / containerRect.height) * 100;

        // Calculate scale needed to cover the entire container from the clicked point
        const w = containerRect.width;
        const containerH = containerRect.height;
        const radius = 39; // half of 78px fill circle
        const corners = [
          Math.sqrt(cx * cx + cy * cy),
          Math.sqrt((w - cx) * (w - cx) + cy * cy),
          Math.sqrt(cx * cx + (containerH - cy) * (containerH - cy)),
          Math.sqrt((w - cx) * (w - cx) + (containerH - cy) * (containerH - cy)),
        ];
        const farthest = Math.max(...corners);
        const coverScale = (farthest / radius) + 0.5; // small margin

        // Hide circles view
        if (colorExtractorCirclesView) colorExtractorCirclesView.classList.add('hidden');

        // Set fill color, position, and scale, then expand after list starts hiding
        colorExtractorFill.style.setProperty('--fill-color', hex);
        colorExtractorFill.style.setProperty('--fill-x', xPct + '%');
        colorExtractorFill.style.setProperty('--fill-y', yPct + '%');
        colorExtractorFill.style.setProperty('--fill-scale', coverScale);
        colorExtractorFill.classList.remove('expanded');
        // Force reflow to ensure the browser registers the initial scale state
        void colorExtractorFill.offsetWidth;
        // Start fill animation after list starts hiding (50ms delay)
        const timer1 = setTimeout(() => {
          colorExtractorFill.classList.add('expanded');
          // Clean up will-change after animation completes
          const cleanupWillChange = () => {
            colorExtractorFill.style.removeProperty('will-change');
            colorExtractorFill.removeEventListener('transitionend', cleanupWillChange);
          };
          colorExtractorFill.addEventListener('transitionend', cleanupWillChange);
        }, 50);
        colorExtractorAnimationTimers.push(timer1);

        // After fill animation (1.2s + 50ms start delay = 1250ms), show detail view
        const timer2 = setTimeout(() => {
          renderDetailView(hex, rgbStr, hslStr, color);
          colorExtractorIsAnimating = false;
        }, 1250);
        colorExtractorAnimationTimers.push(timer2);
      }

      function renderDetailView(hex, rgbStr, hslStr, color) {
        if (!colorExtractorDetailCols || !colorExtractorDetailView || !colorExtractorBackDetailBtn) return;
        colorExtractorDetailCols.innerHTML = '';

        // Determine text color based on brightness
        const brightness = (color.r * 299 + color.g * 587 + color.b * 114) / 1000;
        const isLight = brightness > 200;
        const textColor = isLight ? '#1a1a1a' : '#ffffff';

        // Back button color
        colorExtractorBackDetailBtn.classList.toggle('dark-text', isLight);

        const codes = [
          { label: 'HEX', value: hex, desc: t('home.colorExtractor.hexLabel')},
          { label: 'RGB', value: rgbStr, desc: t('home.colorExtractor.rgbLabel')},
          { label: 'HSL', value: hslStr, desc: t('home.colorExtractor.hslLabel')},
        ];

        codes.forEach((code) => {
          const col = document.createElement('div');
          col.className = 'color-extractor-detail-col';

          const codeEl = document.createElement('div');
          codeEl.className = 'color-extractor-detail-col-code';
          codeEl.style.color = textColor;
          codeEl.textContent = code.value;
          codeEl.addEventListener('click', async () => {
            const copyToClipboard = (text) => {
              return new Promise((resolve, reject) => {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(text).then(resolve).catch(() => {
                    fallbackCopy(text, resolve, reject);
                  });
                } else {
                  fallbackCopy(text, resolve, reject);
                }
              });
            };
            const fallbackCopy = (text, resolve, reject) => {
              try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                resolve();
              } catch (e) {
                reject(e);
              }
            };
            try {
              await copyToClipboard(code.value);
              codeEl.classList.remove('copied');
              void codeEl.offsetWidth;
              codeEl.classList.add('copied');
              showToast(t('home.colorExtractor.copySuccess'));
            } catch (e) {
              console.error('[Color Extractor] Copy failed:', e);
              showToast(t('home.colorExtractor.copyFailed'));
            }
          });

          const labelEl = document.createElement('div');
          labelEl.className = 'color-extractor-detail-col-label';
          labelEl.style.color = textColor;
          labelEl.textContent = code.desc;

          col.appendChild(codeEl);
          col.appendChild(labelEl);
          colorExtractorDetailCols.appendChild(col);
        });

        colorExtractorDetailView.classList.add('visible');
      }

      function collapseDetailToCircles() {
        if (colorExtractorDetailView) colorExtractorDetailView.classList.remove('visible');
        if (colorExtractorDetailCols) colorExtractorDetailCols.innerHTML = '';
        // After detail fades (0.4s), shrink fill, then show circles
        const timer1 = setTimeout(() => {
          if (colorExtractorFill) colorExtractorFill.classList.remove('expanded');
          // After fill shrinks (1.2s), show circles with animation
          const timer2 = setTimeout(() => {
            if (colorExtractorCirclesView) colorExtractorCirclesView.classList.remove('hidden');
          }, 1200);
          colorExtractorAnimationTimers.push(timer2);
        }, 400);
        colorExtractorAnimationTimers.push(timer1);
      }

      // Event listeners
      if (colorExtractorBack) colorExtractorBack.addEventListener('click', closeColorExtractorOverlay);
      if (colorExtractorReselectBtn) colorExtractorReselectBtn.addEventListener('click', resetColorExtractor);
      if (colorExtractorBackDetailBtn) colorExtractorBackDetailBtn.addEventListener('click', collapseDetailToCircles);

      if (colorExtractorUploadZone) {
        colorExtractorUploadZone.addEventListener('click', () => colorExtractorFileInput?.click());
        colorExtractorUploadZone.addEventListener('dragover', (e) => {
          e.preventDefault();
          colorExtractorUploadZone.classList.add('dragover');
        });
        let dragCounter = 0;
        colorExtractorUploadZone.addEventListener('dragenter', (e) => {
          e.preventDefault();
          dragCounter++;
          colorExtractorUploadZone.classList.add('dragover');
        });
        colorExtractorUploadZone.addEventListener('dragleave', () => {
          dragCounter--;
          if (dragCounter <= 0) {
            dragCounter = 0;
            colorExtractorUploadZone.classList.remove('dragover');
          }
        });
        colorExtractorUploadZone.addEventListener('drop', (e) => {
          e.preventDefault();
          colorExtractorUploadZone.classList.remove('dragover');
          const file = e.dataTransfer?.files?.[0];
          if (file) handleColorExtractorFile(file);
        });
      }

      if (colorExtractorFileInput) {
        colorExtractorFileInput.addEventListener('change', (e) => {
          const file = e.target.files?.[0];
          if (file) handleColorExtractorFile(file);
        });
      }

      // ===== End Color Extractor Tool =====

      // Tool list entry
      document.querySelectorAll('.audio-list-item[data-tool="color-extractor"]').forEach(item => {
        item.addEventListener('click', openColorExtractorOverlay);
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openColorExtractorOverlay(); }
        });
      });

      // ===== Text Stats Tool =====
      const textStatsOverlay = document.getElementById('textStatsOverlay');
      const textStatsBack = document.getElementById('textStatsBack');
      const textStatsBg = document.getElementById('textStatsBg');
      const textStatsInput = document.getElementById('textStatsInput');
      const textStatsClearBtn = document.getElementById('textStatsClearBtn');
      const textStatsCopyBtn = document.getElementById('textStatsCopyBtn');
      const textStatsChars = document.getElementById('textStatsChars');
      const textStatsCharsNoSpace = document.getElementById('textStatsCharsNoSpace');
      const textStatsSpaces = document.getElementById('textStatsSpaces');
      const textStatsWords = document.getElementById('textStatsWords');
      const textStatsEnglishWords = document.getElementById('textStatsEnglishWords');
      const textStatsLines = document.getElementById('textStatsLines');
      const textStatsParagraphs = document.getElementById('textStatsParagraphs');
      const textStatsSentences = document.getElementById('textStatsSentences');
      const textStatsChineseChars = document.getElementById('textStatsChineseChars');
      const textStatsLetters = document.getElementById('textStatsLetters');
      const textStatsUppercase = document.getElementById('textStatsUppercase');
      const textStatsLowercase = document.getElementById('textStatsLowercase');
      const textStatsDigits = document.getElementById('textStatsDigits');
      const textStatsPunctuation = document.getElementById('textStatsPunctuation');
      const textStatsLongestLine = document.getElementById('textStatsLongestLine');
      const textStatsAvgLineLength = document.getElementById('textStatsAvgLineLength');
      const textStatsReadingTime = document.getElementById('textStatsReadingTime');
      let textStatsPlasmaInstance = null;
      let textStatsFrameId = null;
      let textStatsDebounceTimer = null;
      let textStatsFocusTimer = null;

      function calcTextStats(text) {
        return calculateTextStats(text);
      }

      function updateTextStats() {
        if (!textStatsInput) return;
        const text = textStatsInput.value;
        const stats = calcTextStats(text);
        const isEmpty = text.trim() === '';
        if (textStatsChars) textStatsChars.textContent = stats.chars;
        if (textStatsCharsNoSpace) textStatsCharsNoSpace.textContent = stats.charsNoSpace;
        if (textStatsSpaces) textStatsSpaces.textContent = stats.spaces;
        if (textStatsWords) textStatsWords.textContent = stats.words;
        if (textStatsEnglishWords) textStatsEnglishWords.textContent = stats.englishWords;
        if (textStatsLines) textStatsLines.textContent = stats.lines;
        if (textStatsParagraphs) textStatsParagraphs.textContent = stats.paragraphs;
        if (textStatsSentences) textStatsSentences.textContent = stats.sentences;
        if (textStatsChineseChars) textStatsChineseChars.textContent = stats.chineseChars;
        if (textStatsLetters) textStatsLetters.textContent = stats.letters;
        if (textStatsUppercase) textStatsUppercase.textContent = stats.uppercase;
        if (textStatsLowercase) textStatsLowercase.textContent = stats.lowercase;
        if (textStatsDigits) textStatsDigits.textContent = stats.digits;
        if (textStatsPunctuation) textStatsPunctuation.textContent = stats.punctuation;
        if (textStatsLongestLine) textStatsLongestLine.textContent = stats.longestLine;
        if (textStatsAvgLineLength) textStatsAvgLineLength.textContent = isEmpty ? 0 : stats.avgLineLength;
        if (textStatsReadingTime) textStatsReadingTime.textContent = isEmpty ? 0 : stats.readingTime;
      }

      function scheduleTextStatsUpdate() {
        const scheduleFrame = () => {
          if (textStatsFrameId !== null) return;
          textStatsFrameId = requestAnimationFrame(() => {
            textStatsFrameId = null;
            updateTextStats();
          });
        };
        if (textStatsInput?.value.length > 20_000) {
          if (textStatsDebounceTimer !== null) clearTimeout(textStatsDebounceTimer);
          textStatsDebounceTimer = setTimeout(() => {
            textStatsDebounceTimer = null;
            scheduleFrame();
          }, 120);
          return;
        }
        scheduleFrame();
      }

      function openTextStatsOverlay() {
        if (!textStatsOverlay) return;
        textStatsOverlay.classList.add('visible');
        updateTextStats();
        if (textStatsBg && !textStatsPlasmaInstance) {
          textStatsPlasmaInstance = initPlasma(textStatsBg, {
            color: '#6B6B6B', speed: 0.8, direction: 'forward', scale: 1, opacity: 1, mouseInteractive: false
          });
        }
        if (textStatsFocusTimer !== null) clearTimeout(textStatsFocusTimer);
        textStatsFocusTimer = setTimeout(() => {
          textStatsFocusTimer = null;
          if (textStatsOverlay?.classList.contains('visible')) textStatsInput?.focus();
        }, 300);
      }

      function closeTextStatsOverlay() {
        if (!textStatsOverlay) return;
        textStatsOverlay.classList.remove('visible');
        if (textStatsFrameId !== null) {
          cancelAnimationFrame(textStatsFrameId);
          textStatsFrameId = null;
        }
        if (textStatsDebounceTimer !== null) {
          clearTimeout(textStatsDebounceTimer);
          textStatsDebounceTimer = null;
        }
        if (textStatsFocusTimer !== null) {
          clearTimeout(textStatsFocusTimer);
          textStatsFocusTimer = null;
        }
        if (textStatsPlasmaInstance) { textStatsPlasmaInstance(); textStatsPlasmaInstance = null; }
      }

      if (textStatsBack) textStatsBack.addEventListener('click', closeTextStatsOverlay);
      if (textStatsInput) {
        textStatsInput.addEventListener('input', () => {
          if (textStatsInput.value.length > TEXT_STATS_LIMITS.maxInputChars) {
            textStatsInput.value = textStatsInput.value.slice(0, TEXT_STATS_LIMITS.maxInputChars);
            window.showToast(t('home.textStats.inputTooLong', { max: TEXT_STATS_LIMITS.maxInputChars }));
          }
          scheduleTextStatsUpdate();
        });
      }
      if (textStatsClearBtn) {
        textStatsClearBtn.addEventListener('click', () => {
          if (textStatsInput) { textStatsInput.value = ''; textStatsInput.focus(); updateTextStats(); }
        });
      }
      if (textStatsCopyBtn) {
        textStatsCopyBtn.addEventListener('click', () => {
          if (!textStatsInput) return;
          const stats = calcTextStats(textStatsInput.value);
          const isEmpty = textStatsInput.value.trim() === '';
          const isZh = getLang() === 'zh';
          const labels = isZh ? {
            chars: '总字符数', charsNoSpace: '不含空格字符', spaces: '空格数',
            words: '单词总数', englishWords: '英文单词数', chineseChars: '中文字符',
            letters: '英文字母', uppercase: '大写字母', lowercase: '小写字母',
            digits: '数字', punctuation: '标点符号', lines: '行数',
            paragraphs: '段落数', sentences: '句子数', longestLine: '最长行字符',
            avgLineLength: '平均行长', readingTime: '预计阅读(分钟)'
          } : {
            chars: 'Characters', charsNoSpace: 'Chars (no space)', spaces: 'Spaces',
            words: 'Total Words', englishWords: 'English Words', chineseChars: 'Chinese Chars',
            letters: 'Letters', uppercase: 'Uppercase', lowercase: 'Lowercase',
            digits: 'Digits', punctuation: 'Punctuation', lines: 'Lines',
            paragraphs: 'Paragraphs', sentences: 'Sentences', longestLine: 'Longest Line',
            avgLineLength: 'Avg Line Length', readingTime: 'Reading (min)'
          };
          const lines = [
            labels.chars + ': ' + stats.chars,
            labels.charsNoSpace + ': ' + stats.charsNoSpace,
            labels.spaces + ': ' + stats.spaces,
            labels.words + ': ' + stats.words,
            labels.englishWords + ': ' + stats.englishWords,
            labels.chineseChars + ': ' + stats.chineseChars,
            labels.letters + ': ' + stats.letters,
            labels.uppercase + ': ' + stats.uppercase,
            labels.lowercase + ': ' + stats.lowercase,
            labels.digits + ': ' + stats.digits,
            labels.punctuation + ': ' + stats.punctuation,
            labels.lines + ': ' + stats.lines,
            labels.paragraphs + ': ' + stats.paragraphs,
            labels.sentences + ': ' + stats.sentences,
            labels.longestLine + ': ' + stats.longestLine,
            labels.avgLineLength + ': ' + (isEmpty ? 0 : stats.avgLineLength),
            labels.readingTime + ': ' + (isEmpty ? 0 : stats.readingTime)
          ];
          if (!navigator.clipboard?.writeText) {
            window.showToast(t('home.textStats.copyFailed'));
            return;
          }
          navigator.clipboard.writeText(lines.join('\n')).then(() => {
            const original = textStatsCopyBtn.textContent;
            textStatsCopyBtn.textContent = '✓';
            setTimeout(() => { textStatsCopyBtn.textContent = original; }, 1500);
          }).catch(() => window.showToast(t('home.textStats.copyFailed')));
        });
      }

      // Tool list entry
      document.querySelectorAll('.audio-list-item[data-tool="text-stats"]').forEach(item => {
        item.addEventListener('click', openTextStatsOverlay);
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTextStatsOverlay(); }
        });
      });

      // ===== Text Format Tool =====
      const textFormatOverlay = document.getElementById('textFormatOverlay');
      const textFormatBack = document.getElementById('textFormatBack');
      const textFormatBg = document.getElementById('textFormatBg');
      const textFormatInput = document.getElementById('textFormatInput');
      const textFormatOutput = document.getElementById('textFormatOutput');
      const textFormatActions = document.getElementById('textFormatActions');
      const textFormatCopyBtn = document.getElementById('textFormatCopyBtn');
      const textFormatClearBtn = document.getElementById('textFormatClearBtn');
      const textFormatUseAsInputBtn = document.getElementById('textFormatUseAsInputBtn');
      let textFormatPlasmaInstance = null;
      let textFormatFocusTimer = null;

      function executeFormat(action, text) {
        return executeTextFormat(action, text);
      }

      function openTextFormatOverlay() {
        if (!textFormatOverlay) return;
        textFormatOverlay.classList.add('visible');
        if (textFormatBg && !textFormatPlasmaInstance) {
          textFormatPlasmaInstance = initPlasma(textFormatBg, {
            color: '#6B6B6B', speed: 0.8, direction: 'forward', scale: 1, opacity: 1, mouseInteractive: false
          });
        }
        if (textFormatFocusTimer !== null) clearTimeout(textFormatFocusTimer);
        textFormatFocusTimer = setTimeout(() => {
          textFormatFocusTimer = null;
          if (textFormatOverlay?.classList.contains('visible')) textFormatInput?.focus();
        }, 300);
      }

      function closeTextFormatOverlay() {
        if (!textFormatOverlay) return;
        textFormatOverlay.classList.remove('visible');
        if (textFormatFocusTimer !== null) {
          clearTimeout(textFormatFocusTimer);
          textFormatFocusTimer = null;
        }
        if (textFormatPlasmaInstance) { textFormatPlasmaInstance(); textFormatPlasmaInstance = null; }
      }

      if (textFormatBack) textFormatBack.addEventListener('click', closeTextFormatOverlay);
      if (textFormatActions) {
        textFormatActions.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const text = textFormatInput ? textFormatInput.value : '';
          if (!text) return;
          try {
            const result = executeFormat(btn.dataset.action, text);
            if (textFormatOutput) textFormatOutput.value = result;
          } catch (error) {
            if (error instanceof TextFormatError && error.code === 'result_too_long') {
              window.showToast(t('home.textFormat.resultTooLong', { max: TEXT_FORMAT_LIMITS.maxInputChars }));
            } else if (error instanceof TextFormatError && error.code === 'too_many_lines') {
              window.showToast(t('home.textFormat.tooManyLines', { max: TEXT_FORMAT_LIMITS.maxLines }));
            } else if (error instanceof RangeError) {
              window.showToast(t('home.textFormat.inputTooLong', { max: TEXT_FORMAT_LIMITS.maxInputChars }));
            } else {
              console.error('[Text Format] Processing error:', error);
            }
          }
        });
      }
      if (textFormatInput) {
        textFormatInput.addEventListener('input', () => {
          if (textFormatInput.value.length > TEXT_FORMAT_LIMITS.maxInputChars) {
            textFormatInput.value = textFormatInput.value.slice(0, TEXT_FORMAT_LIMITS.maxInputChars);
            window.showToast(t('home.textFormat.inputTooLong', { max: TEXT_FORMAT_LIMITS.maxInputChars }));
          }
        });
      }
      if (textFormatCopyBtn) {
        textFormatCopyBtn.addEventListener('click', () => {
          if (!textFormatOutput || !textFormatOutput.value) return;
          if (!navigator.clipboard?.writeText) {
            window.showToast(t('home.textFormat.copyFailed'));
            return;
          }
          navigator.clipboard.writeText(textFormatOutput.value).then(() => {
            const original = textFormatCopyBtn.textContent;
            textFormatCopyBtn.textContent = '✓';
            setTimeout(() => { textFormatCopyBtn.textContent = original; }, 1500);
          }).catch(() => window.showToast(t('home.textFormat.copyFailed')));
        });
      }
      if (textFormatClearBtn) {
        textFormatClearBtn.addEventListener('click', () => {
          if (textFormatInput) textFormatInput.value = '';
          if (textFormatOutput) textFormatOutput.value = '';
          if (textFormatInput) textFormatInput.focus();
        });
      }
      if (textFormatUseAsInputBtn) {
        textFormatUseAsInputBtn.addEventListener('click', () => {
          if (!textFormatOutput || !textFormatOutput.value) return;
          if (textFormatOutput.value.length > TEXT_FORMAT_LIMITS.maxInputChars) {
            window.showToast(t('home.textFormat.resultTooLong', { max: TEXT_FORMAT_LIMITS.maxInputChars }));
            return;
          }
          if (textFormatInput) textFormatInput.value = textFormatOutput.value;
          if (textFormatOutput) textFormatOutput.value = '';
          if (textFormatInput) textFormatInput.focus();
        });
      }

      document.querySelectorAll('.audio-list-item[data-tool="text-format"]').forEach(item => {
        item.addEventListener('click', openTextFormatOverlay);
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTextFormatOverlay(); }
        });
      });

      // ===== Typing Test =====
      const typingTestOverlay = document.getElementById('typingTestOverlay');
      const typingTestBack = document.getElementById('typingTestBack');
      const typingTestBg = document.getElementById('typingTestBg');
      const typingTestBody = document.getElementById('typingTestBody');
      const typingTestSettings = document.getElementById('typingTestSettings');
      const typingTestArea = document.getElementById('typingTestArea');
      const typingTestResult = document.getElementById('typingTestResult');
      const typingTestText = document.getElementById('typingTestText');
      const typingTestInput = document.getElementById('typingTestInput');
      const typingTestStartBtn = document.getElementById('typingTestStartBtn');
      const typingTestResetBtn = document.getElementById('typingTestResetBtn');
      const typingTestAgainBtn = document.getElementById('typingTestAgainBtn');
      const typingTestBackBtn = document.getElementById('typingTestBackBtn');
      const typingTestTime = document.getElementById('typingTestTime');
      const typingTestWpm = document.getElementById('typingTestWpm');
      const typingTestAccuracy = document.getElementById('typingTestAccuracy');
      const typingTestLangOptions = document.getElementById('typingTestLangOptions');
      const typingTestDifficultyOptions = document.getElementById('typingTestDifficultyOptions');
      const typingTestDurationOptions = document.getElementById('typingTestDurationOptions');
      const typingTestResultWpm = document.getElementById('typingTestResultWpm');
      const typingTestResultCpm = document.getElementById('typingTestResultCpm');
      const typingTestResultAccuracy = document.getElementById('typingTestResultAccuracy');
      const typingTestResultCorrect = document.getElementById('typingTestResultCorrect');
      const typingTestResultWrong = document.getElementById('typingTestResultWrong');
      const typingTestResultRating = document.getElementById('typingTestResultRating');

      let typingTestDitherInstance = null;
      let typingTestTimer = null;
      let typingTestComposing = false;
      let zhInputBuffer = '';
      let typingTestState = {
        lang: getLang() === 'zh' ? 'zh' : 'en',
        difficulty: 'easy',
        duration: 30,
        targetText: '',
        input: '',
        startTime: 0,
        timeLeft: 30,
        isRunning: false,
        isFinished: false,
        correctCount: 0,
        wrongCount: 0,
        totalCharCount: 0,
        backspaceCount: 0,
      };

      const TYPING_TEST_WORDS = typingWordsData;

      function generateTypingText(lang, difficulty) {
        const pool = TYPING_TEST_WORDS[lang]?.[difficulty] || TYPING_TEST_WORDS.zh.easy;
        const count = difficulty === 'easy' ? 20 : difficulty === 'medium' ? 16 : 12;
        let parts = [];
        for (let i = 0; i < count; i++) {
          parts.push(pool[Math.floor(Math.random() * pool.length)]);
        }
        if (lang === 'en') {
          return parts.join(' ');
        }
        return parts.join('');
      }

      let typingAudioCtx = null;
      function getTypingAudioCtx() {
        if (!typingAudioCtx) {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (!AudioContext) return null;
          typingAudioCtx = new AudioContext();
        }
        if (typingAudioCtx.state === 'suspended') {
          typingAudioCtx.resume();
        }
        return typingAudioCtx;
      }

      function playTypingSound() {
        try {
          const ctx = getTypingAudioCtx();
          if (!ctx) return;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(1200, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.06);
          gain.gain.setValueAtTime(0.08, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.06);
        } catch (e) {
          // Ignore audio errors
        }
      }

      function playErrorSound() {
        try {
          const ctx = getTypingAudioCtx();
          if (!ctx) return;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(300, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.1);
          gain.gain.setValueAtTime(0.08, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.1);
        } catch (e) {
          // Ignore audio errors
        }
      }

      function renderTypingText() {
        if (!typingTestText) return;
        typingTestText.innerHTML = '';
        const target = typingTestState.targetText;
        const input = typingTestState.input;
        const isPunctuation = (ch) => /[，。！？、；：\u201c\u201d\u2018\u2019（）【】《》…—·,.!?;:"'()\[\]{}]/.test(ch);

        let tIdx = 0, iIdx = 0;
        while (tIdx < target.length || iIdx < input.length) {
          if (tIdx < target.length && isPunctuation(target[tIdx])) {
            const charSpan = document.createElement('span');
            charSpan.className = 'typing-test-char';
            charSpan.textContent = target[tIdx];
            typingTestText.appendChild(charSpan);
            tIdx++;
            continue;
          }
          if (iIdx < input.length && isPunctuation(input[iIdx])) {
            iIdx++;
            continue;
          }
          if (tIdx < target.length && iIdx < input.length) {
            const charSpan = document.createElement('span');
            charSpan.className = 'typing-test-char';
            charSpan.textContent = target[tIdx];
            if (input[iIdx] === target[tIdx]) {
              charSpan.classList.add('correct');
            } else {
              charSpan.classList.add('wrong');
            }
            typingTestText.appendChild(charSpan);
            tIdx++;
            iIdx++;
          } else if (tIdx < target.length) {
            const charSpan = document.createElement('span');
            charSpan.className = 'typing-test-char';
            charSpan.textContent = target[tIdx];
            if (iIdx === input.length) charSpan.classList.add('current');
            typingTestText.appendChild(charSpan);
            tIdx++;
          } else if (iIdx < input.length) {
            const extraSpan = document.createElement('span');
            extraSpan.className = 'typing-test-char extra';
            extraSpan.textContent = input[iIdx];
            typingTestText.appendChild(extraSpan);
            iIdx++;
          }
        }
      }

      function updateTypingStats() {
        const elapsed = (Date.now() - typingTestState.startTime) / 1000 / 60;
        const totalChars = typingTestState.totalCharCount || typingTestState.input.length;
        const correctChars = typingTestState.correctCount;
        const cpm = elapsed > 0 ? Math.round(correctChars / elapsed) : 0;
        const wpm = elapsed > 0 ? Math.round((correctChars / 5) / elapsed) : 0;
        const accuracy = totalChars > 0 ? Math.round((correctChars / totalChars) * 100) : 100;
        if (typingTestTime) typingTestTime.textContent = typingTestState.timeLeft;
        if (typingTestWpm) typingTestWpm.textContent = wpm;
        if (typingTestAccuracy) typingTestAccuracy.textContent = accuracy + '%';
        if (typingTestTime && typingTestState.timeLeft <= 10) {
          typingTestTime.classList.add('warning');
        }
        return { wpm, cpm, accuracy };
      }

      function getTypingRating(wpm, lang) {
        if (lang === 'zh') {
          if (wpm >= 120) return 'S';
          if (wpm >= 100) return 'A';
          if (wpm >= 80) return 'B';
          if (wpm >= 60) return 'C';
          return 'D';
        }
        if (wpm >= 80) return 'S';
        if (wpm >= 60) return 'A';
        if (wpm >= 40) return 'B';
        if (wpm >= 20) return 'C';
        return 'D';
      }

      function showTypingResult() {
        const elapsed = (Date.now() - typingTestState.startTime) / 1000 / 60;
        const correctChars = typingTestState.correctCount;
        const wrongChars = typingTestState.wrongCount;
        const totalChars = typingTestState.totalCharCount || typingTestState.input.length;
        const cpm = elapsed > 0 ? Math.round(correctChars / elapsed) : 0;
        const wpm = elapsed > 0 ? Math.round((correctChars / 5) / elapsed) : 0;
        const accuracy = totalChars > 0 ? Math.round((correctChars / totalChars) * 100) : 100;
        const rating = getTypingRating(wpm, typingTestState.lang);
        if (typingTestArea) typingTestArea.style.display = 'none';
        if (typingTestResult) typingTestResult.style.display = 'block';
        if (typingTestResultWpm) typingTestResultWpm.textContent = wpm;
        if (typingTestResultCpm) typingTestResultCpm.textContent = cpm;
        if (typingTestResultAccuracy) typingTestResultAccuracy.textContent = accuracy + '%';
        if (typingTestResultCorrect) typingTestResultCorrect.textContent = correctChars;
        if (typingTestResultWrong) typingTestResultWrong.textContent = wrongChars;
        if (typingTestResultRating) typingTestResultRating.textContent = rating;
      }

      function endTypingTest() {
        if (!typingTestState.isRunning) return;
        typingTestState.isRunning = false;
        typingTestState.isFinished = true;
        if (typingTestTimer) {
          clearInterval(typingTestTimer);
          typingTestTimer = null;
        }
        if (typingTestInput) typingTestInput.blur();
        showTypingResult();
      }

      function startTypingTest() {
        typingTestState.targetText = generateTypingText(typingTestState.lang, typingTestState.difficulty);
        typingTestState.input = '';
        typingTestState.startTime = 0;
        typingTestState.timeLeft = typingTestState.duration;
        typingTestState.isRunning = false;
        typingTestState.isFinished = false;
        typingTestState.correctCount = 0;
        typingTestState.wrongCount = 0;
        typingTestState.totalCharCount = 0;
        typingTestState.backspaceCount = 0;
        if (typingTestSettings) typingTestSettings.style.display = 'none';
        if (typingTestResult) typingTestResult.style.display = 'none';
        if (typingTestArea) typingTestArea.style.display = 'flex';
        if (typingTestTime) {
          typingTestTime.textContent = typingTestState.duration;
          typingTestTime.classList.remove('warning');
        }
        if (typingTestWpm) typingTestWpm.textContent = '0';
        if (typingTestAccuracy) typingTestAccuracy.textContent = '100%';
        renderTypingText();
        zhInputBuffer = '';
        if (typingTestInput) {
          typingTestInput.value = '';
          typingTestInput.focus();
        }
      }

      function resetTypingTestToSettings() {
        if (typingTestTimer) {
          clearInterval(typingTestTimer);
          typingTestTimer = null;
        }
        typingTestState.isRunning = false;
        typingTestState.isFinished = false;
        if (typingTestArea) typingTestArea.style.display = 'none';
        if (typingTestResult) typingTestResult.style.display = 'none';
        if (typingTestSettings) typingTestSettings.style.display = 'block';
      }

      function openTypingTestOverlay() {
        if (!typingTestOverlay) return;
        typingTestOverlay.classList.add('visible');
        typingTestState.lang = getLang() === 'zh' ? 'zh' : 'en';
        selectTypingTestOption(typingTestLangOptions, typingTestState.lang);
        resetTypingTestToSettings();
        if (typingTestBg && !typingTestDitherInstance) {
          typingTestDitherInstance = initDither(typingTestBg, { color: 'rgba(120,130,255,0.18)', speed: 0.0006 });
        }
      }

      function closeTypingTestOverlay() {
        if (!typingTestOverlay) return;
        typingTestOverlay.classList.remove('visible');
        if (typingTestTimer) {
          clearInterval(typingTestTimer);
          typingTestTimer = null;
        }
        typingTestState.isRunning = false;
        if (typingTestDitherInstance) { typingTestDitherInstance(); typingTestDitherInstance = null; }
      }

      function handleTypingInput() {
        if (!typingTestInput || typingTestState.isFinished || typingTestComposing) return;
        const rawVal = typingTestState.lang === 'zh' ? zhInputBuffer : typingTestInput.value;
        const target = typingTestState.targetText;
        const prevLen = typingTestState.input.length;

        // 双指针比对：跳过标点，确保字符顺序一致
        const isPunctuation = (ch) => /[，。！？、；：\u201c\u201d\u2018\u2019（）【】《》…—·,.!?;:"'()\[\]{}]/.test(ch);
        let targetChars = target.split('');
        let inputChars = rawVal.split('');
        let tIdx = 0, iIdx = 0;
        let correct = 0, wrong = 0;
        let inputCharCount = 0;

        while (tIdx < targetChars.length && iIdx < inputChars.length) {
          while (tIdx < targetChars.length && isPunctuation(targetChars[tIdx])) tIdx++;
          while (iIdx < inputChars.length && isPunctuation(inputChars[iIdx])) iIdx++;
          if (tIdx < targetChars.length && iIdx < inputChars.length) {
            inputCharCount++;
            if (targetChars[tIdx] === inputChars[iIdx]) {
              correct++;
            } else {
              wrong++;
            }
            tIdx++;
            iIdx++;
          }
        }
        while (iIdx < inputChars.length) {
          if (!isPunctuation(inputChars[iIdx])) {
            wrong++;
            inputCharCount++;
          }
          iIdx++;
        }

        typingTestState.input = rawVal;
        typingTestState.correctCount = correct;
        typingTestState.wrongCount = wrong;
        typingTestState.totalCharCount = inputCharCount;
        if (!typingTestState.isRunning && rawVal.length > 0) {
          typingTestState.isRunning = true;
          typingTestState.startTime = Date.now();
          typingTestTimer = setInterval(() => {
            typingTestState.timeLeft -= 1;
            updateTypingStats();
            if (typingTestState.timeLeft <= 0) {
              endTypingTest();
            }
          }, 1000);
        }
        if (!typingTestState.isRunning) return;

        if (rawVal.length > prevLen) {
          const lastIdx = rawVal.length - 1;
          const lastChar = rawVal[lastIdx];
          if (!isPunctuation(lastChar)) {
            if (lastChar === target[lastIdx]) {
              playTypingSound();
            } else {
              playErrorSound();
            }
          }
        }
        renderTypingText();
        updateTypingStats();
        if (wrong === 0 && tIdx >= targetChars.length && rawVal.length > 0) {
          endTypingTest();
        }
      }

      function selectTypingTestOption(container, value) {
        if (!container) return;
        container.querySelectorAll('.typing-test-option').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.value === value);
        });
      }

      if (typingTestStartBtn) typingTestStartBtn.addEventListener('click', startTypingTest);
      if (typingTestResetBtn) typingTestResetBtn.addEventListener('click', startTypingTest);
      if (typingTestAgainBtn) typingTestAgainBtn.addEventListener('click', startTypingTest);
      if (typingTestBackBtn) typingTestBackBtn.addEventListener('click', resetTypingTestToSettings);
      if (typingTestBack) typingTestBack.addEventListener('click', closeTypingTestOverlay);
      if (typingTestInput) {
        typingTestInput.addEventListener('input', (e) => {
          if (e.isComposing || typingTestComposing) return;
          if (typingTestState.lang === 'zh') return;
          handleTypingInput();
        });
        typingTestInput.addEventListener('keydown', (e) => {
          if (typingTestState.lang !== 'zh') return;
          if (typingTestComposing) return;
          if (e.key === 'Backspace' && zhInputBuffer.length > 0) {
            zhInputBuffer = zhInputBuffer.slice(0, -1);
            handleTypingInput();
          }
        });
        typingTestInput.addEventListener('compositionstart', () => { typingTestComposing = true; });
        typingTestInput.addEventListener('compositionend', (e) => {
          typingTestComposing = false;
          if (typingTestState.lang === 'zh') {
            if (e.data) {
              const cleanData = e.data.replace(/[，。！？、；：""''（）【】《》…—·,.!?;:"'()\[\]{}]/g, '');
              if (cleanData) {
                zhInputBuffer += cleanData;
              }
            }
            typingTestInput.value = '';
            handleTypingInput();
          } else {
            setTimeout(() => handleTypingInput(), 0);
          }
        });
      }
      if (typingTestBody) {
        typingTestBody.addEventListener('click', (e) => {
          if (!typingTestState.isFinished && typingTestArea && typingTestArea.style.display !== 'none') {
            if (typingTestInput) typingTestInput.focus();
          }
        });
      }
      if (typingTestLangOptions) {
        typingTestLangOptions.addEventListener('click', (e) => {
          const btn = e.target.closest('.typing-test-option');
          if (!btn) return;
          typingTestState.lang = btn.dataset.value;
          selectTypingTestOption(typingTestLangOptions, btn.dataset.value);
        });
      }
      if (typingTestDifficultyOptions) {
        typingTestDifficultyOptions.addEventListener('click', (e) => {
          const btn = e.target.closest('.typing-test-option');
          if (!btn) return;
          typingTestState.difficulty = btn.dataset.value;
          selectTypingTestOption(typingTestDifficultyOptions, btn.dataset.value);
        });
      }
      if (typingTestDurationOptions) {
        typingTestDurationOptions.addEventListener('click', (e) => {
          const btn = e.target.closest('.typing-test-option');
          if (!btn) return;
          typingTestState.duration = parseInt(btn.dataset.value, 10);
          selectTypingTestOption(typingTestDurationOptions, btn.dataset.value);
        });
      }

      // Tool list entry
      document.querySelectorAll('.audio-list-item[data-tool="typing-test"]').forEach(item => {
        item.addEventListener('click', openTypingTestOverlay);
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTypingTestOverlay(); }
        });
      });

      // ===== Body Fat Calculator =====
      const bmiCalcOverlay = document.getElementById('bmiCalcOverlay');
      const bmiCalcBack = document.getElementById('bmiCalcBack');
      const bmiCalcBg = document.getElementById('bmiCalcBg');
      const bmiCalcModeTabs = document.getElementById('bmiCalcModeTabs');
      const bmiCalcAdvancedFields = document.getElementById('bmiCalcAdvancedFields');
      const bmiCalcGenderTabs = document.getElementById('bmiCalcGenderTabs');
      const bmiCalcHipField = document.getElementById('bmiCalcHipField');
      const bmiCalcResultEmpty = document.getElementById('bmiCalcResultEmpty');
      const bmiCalcResultContent = document.getElementById('bmiCalcResultContent');
      const bmiCalcBarMarker = document.getElementById('bmiCalcBarMarker');

      let bmiCalcGender = 'male';
      let bmiCalcMode = 'simple';
      let bmiCalcDitherInstance = null;

      function openBmiCalcOverlay() {
        if (!bmiCalcOverlay) return;
        bmiCalcOverlay.classList.add('visible');
        if (bmiCalcBg && !bmiCalcDitherInstance) {
          bmiCalcDitherInstance = initDarkVeil(bmiCalcBg, {
            hueShift: 0,
            noiseIntensity: 0.03,
            scanlineIntensity: 0,
            speed: 1.6,
            scanlineFrequency: 5,
            warpAmount: 0,
            resolutionScale: 1
          });
        }
        calcBmiResult();
      }

      function closeBmiCalcOverlay() {
        if (bmiCalcOverlay) bmiCalcOverlay.classList.remove('visible');
        if (bmiCalcDitherInstance) {
          bmiCalcDitherInstance();
          bmiCalcDitherInstance = null;
        }
        Object.keys(bmiCalcWarnTimers).forEach(id => clearTimeout(bmiCalcWarnTimers[id]));
        if (bmiCalcWarnDialog) bmiCalcWarnDialog.classList.remove('visible');
      }

      if (bmiCalcBack) {
        bmiCalcBack.addEventListener('click', closeBmiCalcOverlay);
      }

      // Mode tabs
      if (bmiCalcModeTabs) {
        bmiCalcModeTabs.querySelectorAll('.bmi-calc-mode-tab').forEach(tab => {
          tab.addEventListener('click', () => {
            bmiCalcModeTabs.querySelectorAll('.bmi-calc-mode-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            bmiCalcMode = tab.dataset.mode;
            if (bmiCalcAdvancedFields) {
              bmiCalcAdvancedFields.style.display = bmiCalcMode === 'advanced' ? '' : 'none';
            }
            calcBmiResult();
          });
        });
      }

      // Gender tabs
      if (bmiCalcGenderTabs) {
        bmiCalcGenderTabs.querySelectorAll('.bmi-calc-gender-tab').forEach(tab => {
          tab.addEventListener('click', () => {
            bmiCalcGenderTabs.querySelectorAll('.bmi-calc-gender-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            bmiCalcGender = tab.dataset.gender;
            if (bmiCalcHipField) {
              bmiCalcHipField.style.display = bmiCalcGender === 'female' ? '' : 'none';
            }
            calcBmiResult();
          });
        });
      }

      // Input limits and defaults
      const bmiCalcLimits = {
        bmiCalcAge: { min: 1, max: 120, default: 25, label: () => t('home.bmiCalc.age')},
        bmiCalcHeight: { min: 50, max: 250, default: 170, label: () => t('home.bmiCalc.height')},
        bmiCalcWeight: { min: 10, max: 300, default: 65, label: () => t('home.bmiCalc.weight')},
        bmiCalcWaist: { min: 30, max: 200, default: 80, label: () => t('home.bmiCalc.waist')},
        bmiCalcNeck: { min: 20, max: 100, default: 38, label: () => t('home.bmiCalc.neck')},
        bmiCalcHip: { min: 30, max: 200, default: 90, label: () => t('home.bmiCalc.hip')}
      };

      const bmiCalcWarnDialog = document.getElementById('bmiCalcWarnDialog');
      const bmiCalcWarnMsg = document.getElementById('bmiCalcWarnMsg');
      const bmiCalcWarnOk = document.getElementById('bmiCalcWarnOk');
      let bmiCalcWarnFieldId = null;

      function showBmiCalcWarn(fieldId) {
        const lim = bmiCalcLimits[fieldId];
        if (!lim) return;
        bmiCalcWarnFieldId = fieldId;
        if (bmiCalcWarnMsg) {
          bmiCalcWarnMsg.textContent = (t('home.bmiCalc.warnMsg'))
            .replace('{label}', lim.label())
            .replace('{min}', lim.min)
            .replace('{max}', lim.max);
        }
        if (bmiCalcWarnDialog) bmiCalcWarnDialog.classList.add('visible');
      }

      if (bmiCalcWarnOk) {
        bmiCalcWarnOk.addEventListener('click', () => {
          if (bmiCalcWarnFieldId && bmiCalcLimits[bmiCalcWarnFieldId]) {
            const el = document.getElementById(bmiCalcWarnFieldId);
            if (el) el.value = bmiCalcLimits[bmiCalcWarnFieldId].default;
            calcBmiResult();
          }
          if (bmiCalcWarnDialog) bmiCalcWarnDialog.classList.remove('visible');
        });
      }

      // Input listeners with debounced out-of-range detection
      const bmiCalcWarnTimers = {};
      Object.keys(bmiCalcLimits).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
          calcBmiResult();
          clearTimeout(bmiCalcWarnTimers[id]);
          if (!el.value) return;
          const val = parseFloat(el.value);
          if (isNaN(val)) return;
          const lim = bmiCalcLimits[id];
          if (val < lim.min || val > lim.max) {
            bmiCalcWarnTimers[id] = setTimeout(() => {
              showBmiCalcWarn(id);
            }, 800);
          }
        });
      });

      function getBmiInput(id) {
        const el = document.getElementById(id);
        if (!el || !el.value) return 0;
        const val = parseFloat(el.value);
        if (isNaN(val)) return 0;
        const lim = bmiCalcLimits[id];
        if (lim) {
          return Math.min(lim.max, Math.max(lim.min, val));
        }
        return val;
      }

      function getBmiTagClass(level) {
        if (level === 'low') return 'tag-low';
        if (level === 'normal') return 'tag-normal';
        if (level === 'high') return 'tag-high';
        return 'tag-veryhigh';
      }

      function getBmiLevel(bmi) {
        if (bmi < 18.5) return { level: 'low', label: t('home.bmiCalc.rangeLow')};
        if (bmi < 24) return { level: 'normal', label: t('home.bmiCalc.rangeNormal')};
        if (bmi < 28) return { level: 'high', label: t('home.bmiCalc.rangeHigh')};
        return { level: 'veryhigh', label: t('home.bmiCalc.rangeVeryHigh')};
      }

      function getBodyFatLevel(bf, isMale) {
        if (isMale) {
          if (bf < 10) return { level: 'low', label: t('home.bmiCalc.rangeLow')};
          if (bf < 20) return { level: 'normal', label: t('home.bmiCalc.rangeNormal')};
          if (bf < 25) return { level: 'high', label: t('home.bmiCalc.rangeHigh')};
          return { level: 'veryhigh', label: t('home.bmiCalc.rangeVeryHigh')};
        } else {
          if (bf < 18) return { level: 'low', label: t('home.bmiCalc.rangeLow')};
          if (bf < 28) return { level: 'normal', label: t('home.bmiCalc.rangeNormal')};
          if (bf < 35) return { level: 'high', label: t('home.bmiCalc.rangeHigh')};
          return { level: 'veryhigh', label: t('home.bmiCalc.rangeVeryHigh')};
        }
      }

      function calcBmiResult() {
        const age = getBmiInput('bmiCalcAge');
        const height = getBmiInput('bmiCalcHeight');
        const weight = getBmiInput('bmiCalcWeight');
        const isMale = bmiCalcGender === 'male';

        if (!height || !weight) {
          if (bmiCalcResultEmpty) bmiCalcResultEmpty.style.display = '';
          if (bmiCalcResultContent) bmiCalcResultContent.style.display = 'none';
          return;
        }

        const heightM = height / 100;
        const bmi = weight / (heightM * heightM);
        const bmiInfo = getBmiLevel(bmi);

        // Body fat calculation
        let bodyFat = 0;
        if (bmiCalcMode === 'advanced') {
          const waist = getBmiInput('bmiCalcWaist');
          const neck = getBmiInput('bmiCalcNeck');
          const hip = getBmiInput('bmiCalcHip');
          if (waist && neck && height) {
            if (isMale) {
              const logVal = Math.log10(waist - neck);
              bodyFat = 495 / (1.0324 - 0.19077 * logVal + 0.15456 * Math.log10(height)) - 450;
            } else {
              if (hip) {
                const logVal = Math.log10(waist + hip - neck);
                bodyFat = 495 / (1.29579 - 0.35004 * logVal + 0.22100 * Math.log10(height)) - 450;
              }
            }
          }
        }
        if (!bodyFat || !isFinite(bodyFat) || bodyFat < 0) {
          // Deurenberg formula
          bodyFat = 1.20 * bmi + 0.23 * (age || 25) - 10.8 * (isMale ? 1 : 0) - 5.4;
        }
        bodyFat = Math.max(0, bodyFat);
        const bfInfo = getBodyFatLevel(bodyFat, isMale);

        // BMR (Mifflin-St Jeor)
        const bmr = isMale
          ? 10 * weight + 6.25 * height - 5 * (age || 25) + 5
          : 10 * weight + 6.25 * height - 5 * (age || 25) - 161;

        // Ideal weight (BMI 22)
        const idealWeight = heightM * heightM * 22;
        const weightDiff = weight - idealWeight;

        // Fat mass / lean mass
        const fatMass = weight * bodyFat / 100;
        const leanMass = weight - fatMass;

        // Show results
        if (bmiCalcResultEmpty) bmiCalcResultEmpty.style.display = 'none';
        if (bmiCalcResultContent) bmiCalcResultContent.style.display = '';

        const bmiValueEl = document.getElementById('bmiValue');
        const bmiTagEl = document.getElementById('bmiTag');
        const bodyFatValueEl = document.getElementById('bodyFatValue');
        const bodyFatTagEl = document.getElementById('bodyFatTag');
        const bmrValueEl = document.getElementById('bmrValue');
        const idealWeightValueEl = document.getElementById('idealWeightValue');
        const idealWeightDiffEl = document.getElementById('idealWeightDiff');
        const fatMassValueEl = document.getElementById('fatMassValue');
        const leanMassValueEl = document.getElementById('leanMassValue');

        if (bmiValueEl) bmiValueEl.textContent = bmi.toFixed(1);
        if (bmiTagEl) {
          bmiTagEl.textContent = bmiInfo.label;
          bmiTagEl.className = 'bmi-calc-card-tag ' + getBmiTagClass(bmiInfo.level);
        }
        if (bodyFatValueEl) bodyFatValueEl.textContent = bodyFat.toFixed(1) + '%';
        if (bodyFatTagEl) {
          bodyFatTagEl.textContent = bfInfo.label;
          bodyFatTagEl.className = 'bmi-calc-card-tag ' + getBmiTagClass(bfInfo.level);
        }
        if (bmrValueEl) bmrValueEl.textContent = Math.round(bmr).toString();
        if (idealWeightValueEl) idealWeightValueEl.textContent = idealWeight.toFixed(1) + ' kg';
        if (idealWeightDiffEl) {
          const diffText = weightDiff > 0
            ? '+' + weightDiff.toFixed(1) + ' kg'
            : weightDiff.toFixed(1) + ' kg';
          idealWeightDiffEl.textContent = diffText;
          idealWeightDiffEl.className = 'bmi-calc-card-tag ' + getBmiTagClass(
            Math.abs(weightDiff) < 3 ? 'normal' : (weightDiff > 0 ? 'high' : 'low')
          );
        }
        if (fatMassValueEl) fatMassValueEl.textContent = fatMass.toFixed(1) + ' kg';
        if (leanMassValueEl) leanMassValueEl.textContent = leanMass.toFixed(1) + ' kg';

        // Bar marker position (0-40% range mapped to 0-100%)
        const barPercent = Math.min(100, Math.max(0, (bodyFat / 40) * 100));
        if (bmiCalcBarMarker) bmiCalcBarMarker.style.left = barPercent + '%';
      }

      // Open from tool list
      document.querySelectorAll('.audio-list-item[data-tool="bmi-calc"]').forEach(item => {
        item.addEventListener('click', () => {
          if (transitionMask) transitionMask.classList.add('visible');
          setTimeout(() => {
            openBmiCalcOverlay();
            if (transitionMask) transitionMask.classList.remove('visible');
          }, 1000);
        });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            item.click();
          }
        });
      });

      // ===== End Body Fat Calculator =====

      // ===== Timestamp Calculator =====
      const tsCalcOverlay = document.getElementById('tsCalcOverlay');
      const tsCalcBack = document.getElementById('tsCalcBack');
      const tsCalcBg = document.getElementById('tsCalcBg');
      const tsCalcModeTabs = document.getElementById('tsCalcModeTabs');
      const tsCalcTs2DateForm = document.getElementById('tsCalcTs2DateForm');
      const tsCalcDate2TsForm = document.getElementById('tsCalcDate2TsForm');
      const tsCalcInput = document.getElementById('tsCalcInput');
      const tsCalcDateInput = document.getElementById('tsCalcDateInput');
      const tsCalcFormatTabs = document.getElementById('tsCalcFormatTabs');
      const tsCalcFormatTabs2 = document.getElementById('tsCalcFormatTabs2');
      const tsCalcResultEmpty = document.getElementById('tsCalcResultEmpty');
      const tsCalcResultContent = document.getElementById('tsCalcResultContent');
      const tsCalcResultValue = document.getElementById('tsCalcResultValue');
      const tsCalcResultLabel = document.getElementById('tsCalcResultLabel');
      const tsCalcDetailLocal = document.getElementById('tsCalcDetailLocal');
      const tsCalcDetailUtc = document.getElementById('tsCalcDetailUtc');
      const tsCalcDetailRelative = document.getElementById('tsCalcDetailRelative');
      const tsCalcNowSec = document.getElementById('tsCalcNowSec');
      const tsCalcNowMs = document.getElementById('tsCalcNowMs');

      let tsCalcMode = 'ts2date';
      let tsCalcFormat = 'local';
      let tsCalcFormat2 = 'unix';
      let tsCalcDitherInstance = null;
      let tsCalcNowTimer = null;

      function pad2(n) { return n < 10 ? '0' + n : '' + n; }

      function formatLocalDate(d) {
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
          ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
      }

      function formatUtcDate(d) {
        return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
          ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
      }

      function getRelativeTime(ts, now) {
        const diff = ts - now;
        const absDiff = Math.abs(diff);
        if (absDiff < 1) return t('home.timestampCalc.now');
        const isPast = diff < 0;
        if (absDiff < 60) {
          return Math.round(absDiff) + (isPast ? t('home.timestampCalc.secAgo') : t('home.timestampCalc.secLater'));
        }
        if (absDiff < 3600) {
          return Math.round(absDiff / 60) + (isPast ? t('home.timestampCalc.minAgo') : t('home.timestampCalc.minLater'));
        }
        if (absDiff < 86400) {
          return Math.round(absDiff / 3600) + (isPast ? t('home.timestampCalc.hourAgo') : t('home.timestampCalc.hourLater'));
        }
        return Math.round(absDiff / 86400) + (isPast ? t('home.timestampCalc.dayAgo') : t('home.timestampCalc.dayLater'));
      }

      function parseTimestamp(str) {
        if (!str) return null;
        const val = parseFloat(str.trim());
        if (isNaN(val) || val <= 0) return null;
        if (val > 1e14) return null;
        const isMs = str.trim().length >= 13 || val > 1e11;
        return { ts: isMs ? val / 1000 : val, isMs };
      }

      function updateTsCalcNow() {
        const now = Math.floor(Date.now() / 1000);
        const nowMs = Date.now();
        if (tsCalcNowSec) tsCalcNowSec.textContent = now.toString();
        if (tsCalcNowMs) tsCalcNowMs.textContent = nowMs.toString();
      }

      function calcTsResult() {
        if (tsCalcMode === 'ts2date') {
          const parsed = parseTimestamp(tsCalcInput ? tsCalcInput.value : '');
          if (!parsed) {
            if (tsCalcResultEmpty) tsCalcResultEmpty.style.display = '';
            if (tsCalcResultContent) tsCalcResultContent.style.display = 'none';
            return;
          }
          const d = new Date(parsed.ts * 1000);
          if (isNaN(d.getTime())) {
            if (tsCalcResultEmpty) tsCalcResultEmpty.style.display = '';
            if (tsCalcResultContent) tsCalcResultContent.style.display = 'none';
            return;
          }
          if (tsCalcResultEmpty) tsCalcResultEmpty.style.display = 'none';
          if (tsCalcResultContent) tsCalcResultContent.style.display = '';

          let resultStr = '';
          if (tsCalcFormat === 'local') resultStr = formatLocalDate(d);
          else if (tsCalcFormat === 'utc') resultStr = formatUtcDate(d) + ' UTC';
          else if (tsCalcFormat === 'iso') resultStr = d.toISOString();
          else if (tsCalcFormat === 'relative') resultStr = getRelativeTime(parsed.ts, Date.now() / 1000);

          if (tsCalcResultValue) tsCalcResultValue.textContent = resultStr;
          if (tsCalcResultLabel) {
            const fmtLabels = { local: 'localTime', utc: 'utcTime', iso: 'iso', relative: 'relativeTime' };
            tsCalcResultLabel.textContent = t('home.timestampCalc.' + (fmtLabels[tsCalcFormat] || 'localTime'));
          }
          if (tsCalcDetailLocal) tsCalcDetailLocal.textContent = formatLocalDate(d);
          if (tsCalcDetailUtc) tsCalcDetailUtc.textContent = formatUtcDate(d) + ' UTC';
          if (tsCalcDetailRelative) tsCalcDetailRelative.textContent = getRelativeTime(parsed.ts, Date.now() / 1000);
        } else {
          if (!tsCalcDateInput || !tsCalcDateInput.value) {
            if (tsCalcResultEmpty) tsCalcResultEmpty.style.display = '';
            if (tsCalcResultContent) tsCalcResultContent.style.display = 'none';
            return;
          }
          const d = new Date(tsCalcDateInput.value);
          if (isNaN(d.getTime())) {
            if (tsCalcResultEmpty) tsCalcResultEmpty.style.display = '';
            if (tsCalcResultContent) tsCalcResultContent.style.display = 'none';
            return;
          }
          const tsSec = Math.floor(d.getTime() / 1000);
          const tsMs = d.getTime();
          if (tsCalcResultEmpty) tsCalcResultEmpty.style.display = 'none';
          if (tsCalcResultContent) tsCalcResultContent.style.display = '';

          let resultStr = '';
          if (tsCalcFormat2 === 'unix') resultStr = tsSec.toString();
          else if (tsCalcFormat2 === 'ms') resultStr = tsMs.toString();
          else if (tsCalcFormat2 === 'iso') resultStr = d.toISOString();

          if (tsCalcResultValue) tsCalcResultValue.textContent = resultStr;
          if (tsCalcResultLabel) tsCalcResultLabel.textContent = t('home.timestampCalc.resultLabel');
          if (tsCalcDetailLocal) tsCalcDetailLocal.textContent = formatLocalDate(d);
          if (tsCalcDetailUtc) tsCalcDetailUtc.textContent = formatUtcDate(d) + ' UTC';
          if (tsCalcDetailRelative) tsCalcDetailRelative.textContent = getRelativeTime(tsSec, Date.now() / 1000);
        }
      }

      function openTsCalcOverlay() {
        if (!tsCalcOverlay) return;
        tsCalcOverlay.classList.add('visible');
        if (tsCalcBg && !tsCalcDitherInstance) {
          tsCalcDitherInstance = initDarkVeil(tsCalcBg, {
            hueShift: 0,
            noiseIntensity: 0.03,
            scanlineIntensity: 0,
            speed: 1.6,
            scanlineFrequency: 5,
            warpAmount: 0,
            resolutionScale: 1
          });
        }
        // Reset state
        tsCalcMode = 'ts2date';
        tsCalcFormat = 'local';
        tsCalcFormat2 = 'unix';
        if (tsCalcModeTabs) {
          tsCalcModeTabs.querySelectorAll('.ts-calc-mode-tab').forEach(t => t.classList.remove('active'));
          const defaultModeTab = tsCalcModeTabs.querySelector('[data-mode="ts2date"]');
          if (defaultModeTab) defaultModeTab.classList.add('active');
        }
        if (tsCalcFormatTabs) {
          tsCalcFormatTabs.querySelectorAll('.ts-calc-format-tab').forEach(t => t.classList.remove('active'));
          const defaultFmtTab = tsCalcFormatTabs.querySelector('[data-fmt="local"]');
          if (defaultFmtTab) defaultFmtTab.classList.add('active');
        }
        if (tsCalcFormatTabs2) {
          tsCalcFormatTabs2.querySelectorAll('.ts-calc-format-tab').forEach(t => t.classList.remove('active'));
          const defaultFmtTab2 = tsCalcFormatTabs2.querySelector('[data-fmt="unix"]');
          if (defaultFmtTab2) defaultFmtTab2.classList.add('active');
        }
        if (tsCalcTs2DateForm) tsCalcTs2DateForm.style.display = '';
        if (tsCalcDate2TsForm) tsCalcDate2TsForm.style.display = 'none';
        if (tsCalcInput) tsCalcInput.value = '';
        if (tsCalcDateInput) {
          const now = new Date();
          tsCalcDateInput.value = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) +
            'T' + pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
        }
        updateTsCalcNow();
        if (tsCalcNowTimer) clearInterval(tsCalcNowTimer);
        tsCalcNowTimer = setInterval(updateTsCalcNow, 1000);
        calcTsResult();
      }

      function closeTsCalcOverlay() {
        if (tsCalcOverlay) tsCalcOverlay.classList.remove('visible');
        if (tsCalcDitherInstance) {
          tsCalcDitherInstance();
          tsCalcDitherInstance = null;
        }
        if (tsCalcNowTimer) {
          clearInterval(tsCalcNowTimer);
          tsCalcNowTimer = null;
        }
      }

      if (tsCalcBack) {
        tsCalcBack.addEventListener('click', closeTsCalcOverlay);
      }

      // Mode tabs
      if (tsCalcModeTabs) {
        tsCalcModeTabs.querySelectorAll('.ts-calc-mode-tab').forEach(tab => {
          tab.addEventListener('click', () => {
            tsCalcModeTabs.querySelectorAll('.ts-calc-mode-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            tsCalcMode = tab.dataset.mode;
            if (tsCalcTs2DateForm) tsCalcTs2DateForm.style.display = tsCalcMode === 'ts2date' ? '' : 'none';
            if (tsCalcDate2TsForm) tsCalcDate2TsForm.style.display = tsCalcMode === 'date2ts' ? '' : 'none';
            calcTsResult();
          });
        });
      }

      // Format tabs (ts2date)
      if (tsCalcFormatTabs) {
        tsCalcFormatTabs.querySelectorAll('.ts-calc-format-tab').forEach(tab => {
          tab.addEventListener('click', () => {
            tsCalcFormatTabs.querySelectorAll('.ts-calc-format-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            tsCalcFormat = tab.dataset.fmt;
            calcTsResult();
          });
        });
      }

      // Format tabs (date2ts)
      if (tsCalcFormatTabs2) {
        tsCalcFormatTabs2.querySelectorAll('.ts-calc-format-tab').forEach(tab => {
          tab.addEventListener('click', () => {
            tsCalcFormatTabs2.querySelectorAll('.ts-calc-format-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            tsCalcFormat2 = tab.dataset.fmt;
            calcTsResult();
          });
        });
      }

      // Input listeners
      if (tsCalcInput) {
        tsCalcInput.addEventListener('input', calcTsResult);
      }
      if (tsCalcDateInput) {
        tsCalcDateInput.addEventListener('input', calcTsResult);
        tsCalcDateInput.addEventListener('change', calcTsResult);
      }

      // Copy buttons
      const tsCalcCopyTimers = {};
      function copyToClipboard(text, btn) {
        if (!text || text === '--') return;
        navigator.clipboard.writeText(text).then(() => {
          if (btn) {
            const key = btn.id || btn.textContent;
            clearTimeout(tsCalcCopyTimers[key]);
            if (!btn.dataset.origText) btn.dataset.origText = btn.textContent;
            btn.textContent = t('home.timestampCalc.copied');
            tsCalcCopyTimers[key] = setTimeout(() => { btn.textContent = btn.dataset.origText; }, 1500);
          }
        }).catch(() => {});
      }

      const tsCalcCopyNowSec = document.getElementById('tsCalcCopyNowSec');
      const tsCalcCopyNowMs = document.getElementById('tsCalcCopyNowMs');
      const tsCalcCopyResult = document.getElementById('tsCalcCopyResult');

      if (tsCalcCopyNowSec) {
        tsCalcCopyNowSec.addEventListener('click', () => {
          copyToClipboard(tsCalcNowSec ? tsCalcNowSec.textContent : '', tsCalcCopyNowSec);
        });
      }
      if (tsCalcCopyNowMs) {
        tsCalcCopyNowMs.addEventListener('click', () => {
          copyToClipboard(tsCalcNowMs ? tsCalcNowMs.textContent : '', tsCalcCopyNowMs);
        });
      }
      if (tsCalcCopyResult) {
        tsCalcCopyResult.addEventListener('click', () => {
          copyToClipboard(tsCalcResultValue ? tsCalcResultValue.textContent : '', tsCalcCopyResult);
        });
      }

      // Open from tool list
      document.querySelectorAll('.audio-list-item[data-tool="timestamp-calc"]').forEach(item => {
        item.addEventListener('click', () => {
          if (transitionMask) transitionMask.classList.add('visible');
          setTimeout(() => {
            openTsCalcOverlay();
            if (transitionMask) transitionMask.classList.remove('visible');
          }, 1000);
        });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            item.click();
          }
        });
      });

      // ===== End Timestamp Calculator =====

      // ===== Mortgage Calculator =====
      const mortgageCalcOverlay = document.getElementById('mortgageCalcOverlay');
      const mortgageCalcBack = document.getElementById('mortgageCalcBack');
      const mortgageCalcBg = document.getElementById('mortgageCalcBg');
      const mortgageCalcMethodTabs = document.getElementById('mortgageCalcMethodTabs');
      const mortgageCalcBtn = document.getElementById('mortgageCalcBtn');
      const mortgageCalcResultEmpty = document.getElementById('mortgageCalcResultEmpty');
      const mortgageCalcResultContent = document.getElementById('mortgageCalcResultContent');
      const mortgageCalcScheduleBody = document.getElementById('mortgageCalcScheduleBody');

      let mortgageCalcMethod = 'equalPayment';
      let mortgageCalcDitherInstance = null;
      let mortgageCalcSchedule = [];

      function formatMoney(val) {
        if (!isFinite(val)) return '--';
        return val.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      }

      function formatWan(val) {
        if (!isFinite(val)) return '--';
        const unit = t('home.mortgageCalc.loanAmountUnit');
        if (unit === '万') {
          return val.toFixed(2) + ' ' + unit;
        }
        return formatMoney(val * 10000);
      }

      function calcMortgage() {
        const amountEl = document.getElementById('mortgageCalcAmount');
        const termEl = document.getElementById('mortgageCalcTerm');
        const rateEl = document.getElementById('mortgageCalcRate');
        if (!amountEl || !termEl || !rateEl) return;

        const amountWan = parseFloat(amountEl.value);
        const termYears = parseFloat(termEl.value);
        const annualRate = parseFloat(rateEl.value);

        if (!amountWan || amountWan <= 0 || !termYears || termYears <= 0 || !annualRate || annualRate <= 0) {
          if (mortgageCalcResultEmpty) mortgageCalcResultEmpty.style.display = '';
          if (mortgageCalcResultContent) mortgageCalcResultContent.style.display = 'none';
          return;
        }

        const months = Math.round(termYears * 12);
        if (months < 1) {
          if (mortgageCalcResultEmpty) mortgageCalcResultEmpty.style.display = '';
          if (mortgageCalcResultContent) mortgageCalcResultContent.style.display = 'none';
          return;
        }

        // Show global spider transition mask
        if (transitionMask) transitionMask.classList.add('visible');
        if (mortgageCalcBtn) mortgageCalcBtn.disabled = true;

        setTimeout(() => {
          _doCalcMortgage(amountWan, termYears, annualRate, months);
          if (transitionMask) transitionMask.classList.remove('visible');
          if (mortgageCalcBtn) mortgageCalcBtn.disabled = false;
        }, 1000);
      }

      function _doCalcMortgage(amountWan, termYears, annualRate, months) {
        const principal = amountWan * 10000;
        const monthlyRate = annualRate / 100 / 12;

        mortgageCalcSchedule = [];
        let totalInterest = 0;
        let totalPayment = 0;
        let monthlyDisplay = '';
        let firstMonthly = 0;
        let lastMonthly = 0;
        let monthlyTagText = '';

        if (mortgageCalcMethod === 'equalPayment') {
          // 等额本息: M = P * r * (1+r)^n / ((1+r)^n - 1)
          let monthlyPayment;
          if (monthlyRate === 0) {
            monthlyPayment = principal / months;
          } else {
            const factor = Math.pow(1 + monthlyRate, months);
            monthlyPayment = principal * monthlyRate * factor / (factor - 1);
          }
          monthlyDisplay = formatMoney(monthlyPayment);
          firstMonthly = monthlyPayment;
          lastMonthly = monthlyPayment;
          monthlyTagText = t('home.mortgageCalc.fixedMonthly');

          let remaining = principal;
          for (let i = 1; i <= months; i++) {
            const interest = remaining * monthlyRate;
            const mPrincipal = monthlyPayment - interest;
            remaining -= mPrincipal;
            if (i === months) remaining = 0;
            totalInterest += interest;
            mortgageCalcSchedule.push({
              month: i,
              principal: mPrincipal,
              interest: interest,
              remaining: Math.max(0, remaining)
            });
          }
          totalPayment = monthlyPayment * months;
        } else {
          // 等额本金: 每月本金 = P / n, 每月利息 = remaining * r
          const monthlyPrincipal = principal / months;
          let remaining = principal;
          for (let i = 1; i <= months; i++) {
            const interest = remaining * monthlyRate;
            const payment = monthlyPrincipal + interest;
            remaining -= monthlyPrincipal;
            if (i === months) remaining = 0;
            totalInterest += interest;
            mortgageCalcSchedule.push({
              month: i,
              principal: monthlyPrincipal,
              interest: interest,
              remaining: Math.max(0, remaining)
            });
            if (i === 1) firstMonthly = payment;
            if (i === months) lastMonthly = payment;
          }
          totalPayment = principal + totalInterest;
          monthlyDisplay = formatMoney(firstMonthly) + ' → ' + formatMoney(lastMonthly);
          monthlyTagText = t('home.mortgageCalc.monthlyDecreasing');
        }

        if (mortgageCalcResultEmpty) mortgageCalcResultEmpty.style.display = 'none';
        if (mortgageCalcResultContent) mortgageCalcResultContent.style.display = '';

        const monthlyValueEl = document.getElementById('mortgageCalcMonthlyValue');
        const monthlyLabelEl = document.getElementById('mortgageCalcMonthlyLabel');
        const monthlyTagEl = document.getElementById('mortgageCalcMonthlyTag');
        const totalValueEl = document.getElementById('mortgageCalcTotalValue');
        const totalTagEl = document.getElementById('mortgageCalcTotalTag');
        const interestValueEl = document.getElementById('mortgageCalcInterestValue');
        const interestTagEl = document.getElementById('mortgageCalcInterestTag');
        const ratioValueEl = document.getElementById('mortgageCalcRatioValue');

        if (monthlyValueEl) monthlyValueEl.textContent = monthlyDisplay;
        if (monthlyLabelEl) monthlyLabelEl.textContent = t('home.mortgageCalc.monthlyPayment');
        if (monthlyTagEl) monthlyTagEl.textContent = monthlyTagText;
        if (totalValueEl) totalValueEl.textContent = formatWan(totalPayment / 10000);
        if (totalTagEl) totalTagEl.textContent = months + ' ' + (t('home.mortgageCalc.months'));
        if (interestValueEl) interestValueEl.textContent = formatWan(totalInterest / 10000);
        if (interestTagEl) interestTagEl.textContent = formatMoney(totalInterest);
        if (ratioValueEl) ratioValueEl.textContent = (totalPayment > 0 ? (totalInterest / totalPayment * 100).toFixed(1) : '0') + '%';

        renderSchedule();
      }

      function renderSchedule() {
        if (!mortgageCalcScheduleBody) return;
        mortgageCalcScheduleBody.innerHTML = mortgageCalcSchedule.map(row =>
          '<div class="mortgage-calc-schedule-row">' +
            '<span>' + row.month + '</span>' +
            '<span>' + formatMoney(row.principal) + '</span>' +
            '<span>' + formatMoney(row.interest) + '</span>' +
            '<span>' + formatMoney(row.remaining) + '</span>' +
          '</div>'
        ).join('');
      }

      function openMortgageCalcOverlay() {
        if (!mortgageCalcOverlay) return;
        mortgageCalcOverlay.classList.add('visible');
        if (mortgageCalcBg && !mortgageCalcDitherInstance) {
          mortgageCalcDitherInstance = initDarkVeil(mortgageCalcBg, {
            hueShift: 0,
            noiseIntensity: 0.03,
            scanlineIntensity: 0,
            speed: 1.6,
            scanlineFrequency: 5,
            warpAmount: 0,
            resolutionScale: 1
          });
        }
        // Reset state
        mortgageCalcMethod = 'equalPayment';
        if (mortgageCalcMethodTabs) {
          mortgageCalcMethodTabs.querySelectorAll('.mortgage-calc-method-tab').forEach(tab => tab.classList.remove('active'));
          const defaultTab = mortgageCalcMethodTabs.querySelector('[data-method="equalPayment"]');
          if (defaultTab) defaultTab.classList.add('active');
        }
        mortgageCalcSchedule = [];
        if (mortgageCalcResultEmpty) mortgageCalcResultEmpty.style.display = '';
        if (mortgageCalcResultContent) mortgageCalcResultContent.style.display = 'none';
        if (mortgageCalcScheduleBody) mortgageCalcScheduleBody.innerHTML = '';
        const amountEl = document.getElementById('mortgageCalcAmount');
        const termEl = document.getElementById('mortgageCalcTerm');
        const rateEl = document.getElementById('mortgageCalcRate');
        if (amountEl && !amountEl.value.trim()) amountEl.value = '100';
        if (termEl && !termEl.value.trim()) termEl.value = '30';
        if (rateEl && !rateEl.value.trim()) rateEl.value = '4.2';
      }

      function closeMortgageCalcOverlay() {
        if (mortgageCalcOverlay) mortgageCalcOverlay.classList.remove('visible');
        if (mortgageCalcDitherInstance) {
          mortgageCalcDitherInstance();
          mortgageCalcDitherInstance = null;
        }
      }

      if (mortgageCalcBack) {
        mortgageCalcBack.addEventListener('click', closeMortgageCalcOverlay);
      }

      if (mortgageCalcMethodTabs) {
        mortgageCalcMethodTabs.querySelectorAll('.mortgage-calc-method-tab').forEach(tab => {
          tab.addEventListener('click', () => {
            mortgageCalcMethodTabs.querySelectorAll('.mortgage-calc-method-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            mortgageCalcMethod = tab.dataset.method;
          });
        });
      }

      if (mortgageCalcBtn) {
        mortgageCalcBtn.addEventListener('click', calcMortgage);
      }

      // Enter key support on input fields
      ['mortgageCalcAmount', 'mortgageCalcTerm', 'mortgageCalcRate'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); calcMortgage(); }
        });
      });

      // Open from tool list
      document.querySelectorAll('.audio-list-item[data-tool="mortgage-calc"]').forEach(item => {
        item.addEventListener('click', () => {
          if (transitionMask) transitionMask.classList.add('visible');
          setTimeout(() => {
            openMortgageCalcOverlay();
            if (transitionMask) transitionMask.classList.remove('visible');
          }, 1000);
        });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            item.click();
          }
        });
      });

      // ===== End Mortgage Calculator =====

      // ===== Interest Calculator =====
      const interestCalcOverlay = document.getElementById('interestCalcOverlay');
      const interestCalcBack = document.getElementById('interestCalcBack');
      const interestCalcBg = document.getElementById('interestCalcBg');
      const interestCalcModeTabs = document.getElementById('interestCalcModeTabs');
      const interestCalcFreqTabs = document.getElementById('interestCalcFreqTabs');
      const interestCalcBtn = document.getElementById('interestCalcBtn');
      const interestCalcResultEmpty = document.getElementById('interestCalcResultEmpty');
      const interestCalcResultContent = document.getElementById('interestCalcResultContent');
      const interestCalcScheduleBody = document.getElementById('interestCalcScheduleBody');
      const interestCalcPrincipalField = document.getElementById('interestCalcPrincipalField');
      const interestCalcRegularField = document.getElementById('interestCalcRegularField');
      const interestCalcFreqField = document.getElementById('interestCalcFreqField');

      let interestCalcMode = 'simple';
      let interestCalcFreq = 'yearly';
      let interestCalcDitherInstance = null;
      let interestCalcSchedule = [];

      function formatInterestMoney(val) {
        if (!isFinite(val)) return '--';
        return val.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      }

      function calcInterest() {
        const rateEl = document.getElementById('interestCalcRate');
        const termEl = document.getElementById('interestCalcTerm');
        if (!rateEl || !termEl) return;

        const annualRate = parseFloat(rateEl.value);
        const termYears = parseFloat(termEl.value);

        if (!annualRate || annualRate <= 0 || !termYears || termYears <= 0) {
          if (interestCalcResultEmpty) interestCalcResultEmpty.style.display = '';
          if (interestCalcResultContent) interestCalcResultContent.style.display = 'none';
          return;
        }

        let principal = 0;
        let regularAmount = 0;

        if (interestCalcMode === 'recurring') {
          const regEl = document.getElementById('interestCalcRegularAmount');
          if (!regEl) return;
          regularAmount = parseFloat(regEl.value);
          if (!regularAmount || regularAmount <= 0) {
            if (interestCalcResultEmpty) interestCalcResultEmpty.style.display = '';
            if (interestCalcResultContent) interestCalcResultContent.style.display = 'none';
            return;
          }
        } else {
          const principalEl = document.getElementById('interestCalcPrincipal');
          if (!principalEl) return;
          principal = parseFloat(principalEl.value);
          if (!principal || principal <= 0) {
            if (interestCalcResultEmpty) interestCalcResultEmpty.style.display = '';
            if (interestCalcResultContent) interestCalcResultContent.style.display = 'none';
            return;
          }
        }

        if (transitionMask) transitionMask.classList.add('visible');
        if (interestCalcBtn) interestCalcBtn.disabled = true;

        setTimeout(() => {
          _doCalcInterest(principal, regularAmount, annualRate, termYears);
          if (transitionMask) transitionMask.classList.remove('visible');
          if (interestCalcBtn) interestCalcBtn.disabled = false;
        }, 1000);
      }

      function _doCalcInterest(principal, regularAmount, annualRate, termYears) {
        const monthlyRate = annualRate / 100 / 12;
        const dailyRate = annualRate / 100 / 365;

        interestCalcSchedule = [];
        let totalAmount = 0;
        let totalInterest = 0;
        let totalInvested = 0;

        if (interestCalcMode === 'simple') {
          // 单利: 利息 = P × r × n, 本利和 = P × (1 + r × n)
          totalInterest = principal * (annualRate / 100) * termYears;
          totalAmount = principal + totalInterest;
          totalInvested = principal;

          for (let i = 1; i <= termYears; i++) {
            const yearInterest = principal * (annualRate / 100);
            const balance = principal + yearInterest * i;
            interestCalcSchedule.push({
              period: i,
              invested: i === 1 ? principal : 0,
              interest: yearInterest,
              balance: balance
            });
          }
        } else if (interestCalcMode === 'compound') {
          // 复利: A = P × (1 + r/n)^(n×t)
          let periodsPerYear, ratePerPeriod;
          if (interestCalcFreq === 'yearly') {
            periodsPerYear = 1;
            ratePerPeriod = annualRate / 100;
          } else if (interestCalcFreq === 'monthly') {
            periodsPerYear = 12;
            ratePerPeriod = monthlyRate;
          } else {
            periodsPerYear = 365;
            ratePerPeriod = dailyRate;
          }

          const totalPeriods = Math.round(termYears * periodsPerYear);
          let balance = principal;
          totalInvested = principal;

          if (interestCalcFreq === 'daily') {
            // 按日复利明细按年汇总，避免 3650+ 行 DOM 卡顿
            let yearInterestSum = 0;
            for (let i = 1; i <= totalPeriods; i++) {
              const periodInterest = balance * ratePerPeriod;
              balance += periodInterest;
              yearInterestSum += periodInterest;
              if (i % periodsPerYear === 0) {
                const yearNum = Math.floor(i / periodsPerYear);
                interestCalcSchedule.push({
                  period: yearNum,
                  invested: yearNum === 1 ? principal : 0,
                  interest: yearInterestSum,
                  balance: balance
                });
                yearInterestSum = 0;
              }
            }
            // 处理余数（非整年）
            if (yearInterestSum > 0) {
              interestCalcSchedule.push({
                period: interestCalcSchedule.length + 1,
                invested: 0,
                interest: yearInterestSum,
                balance: balance
              });
            }
          } else {
            for (let i = 1; i <= totalPeriods; i++) {
              const periodInterest = balance * ratePerPeriod;
              balance += periodInterest;
              interestCalcSchedule.push({
                period: i,
                invested: i === 1 ? principal : 0,
                interest: periodInterest,
                balance: balance
              });
            }
          }
          totalAmount = balance;
          totalInterest = totalAmount - principal;
        } else {
          // 定投: 每月投入, 复利按月计算
          // FV = PMT × ((1 + r)^n - 1) / r
          const totalMonths = Math.round(termYears * 12);
          let balance = 0;
          totalInvested = 0;

          for (let i = 1; i <= totalMonths; i++) {
            balance += regularAmount;
            totalInvested += regularAmount;
            const periodInterest = balance * monthlyRate;
            balance += periodInterest;
            interestCalcSchedule.push({
              period: i,
              invested: regularAmount,
              interest: periodInterest,
              balance: balance
            });
          }
          totalAmount = balance;
          totalInterest = totalAmount - totalInvested;
        }

        if (interestCalcResultEmpty) interestCalcResultEmpty.style.display = 'none';
        if (interestCalcResultContent) interestCalcResultContent.style.display = '';

        const totalValueEl = document.getElementById('interestCalcTotalValue');
        const totalTagEl = document.getElementById('interestCalcTotalTag');
        const interestValueEl = document.getElementById('interestCalcInterestValue');
        const interestTagEl = document.getElementById('interestCalcInterestTag');
        const investedValueEl = document.getElementById('interestCalcInvestedValue');
        const investedTagEl = document.getElementById('interestCalcInvestedTag');
        const returnRateValueEl = document.getElementById('interestCalcReturnRateValue');
        const returnTagEl = document.getElementById('interestCalcReturnTag');

        if (totalValueEl) totalValueEl.textContent = formatInterestMoney(totalAmount);
        if (totalTagEl) totalTagEl.textContent = t('home.interestCalc.totalAmount');
        if (interestValueEl) interestValueEl.textContent = formatInterestMoney(totalInterest);
        if (interestTagEl) interestTagEl.textContent = t('home.interestCalc.totalInterest');
        if (investedValueEl) investedValueEl.textContent = formatInterestMoney(totalInvested);
        if (investedTagEl) investedTagEl.textContent = t('home.interestCalc.totalInvested');
        const returnRate = totalInvested > 0 ? (totalInterest / totalInvested * 100).toFixed(1) : '0';
        if (returnRateValueEl) returnRateValueEl.textContent = returnRate + '%';
        if (returnTagEl) returnTagEl.textContent = formatInterestMoney(totalInterest);

        renderInterestSchedule();
      }

      function renderInterestSchedule() {
        if (!interestCalcScheduleBody) return;
        interestCalcScheduleBody.innerHTML = interestCalcSchedule.map(row =>
          '<div class="mortgage-calc-schedule-row">' +
            '<span>' + row.period + '</span>' +
            '<span>' + formatInterestMoney(row.invested) + '</span>' +
            '<span>' + formatInterestMoney(row.interest) + '</span>' +
            '<span>' + formatInterestMoney(row.balance) + '</span>' +
          '</div>'
        ).join('');
      }

      function updateInterestModeFields() {
        if (interestCalcMode === 'recurring') {
          if (interestCalcPrincipalField) interestCalcPrincipalField.style.display = 'none';
          if (interestCalcRegularField) interestCalcRegularField.style.display = '';
          if (interestCalcFreqField) interestCalcFreqField.style.display = 'none';
        } else if (interestCalcMode === 'compound') {
          if (interestCalcPrincipalField) interestCalcPrincipalField.style.display = '';
          if (interestCalcRegularField) interestCalcRegularField.style.display = 'none';
          if (interestCalcFreqField) interestCalcFreqField.style.display = '';
        } else {
          if (interestCalcPrincipalField) interestCalcPrincipalField.style.display = '';
          if (interestCalcRegularField) interestCalcRegularField.style.display = 'none';
          if (interestCalcFreqField) interestCalcFreqField.style.display = 'none';
        }
      }

      function openInterestCalcOverlay() {
        if (!interestCalcOverlay) return;
        interestCalcOverlay.classList.add('visible');
        if (interestCalcBg && !interestCalcDitherInstance) {
          interestCalcDitherInstance = initDarkVeil(interestCalcBg, {
            hueShift: 0,
            noiseIntensity: 0.03,
            scanlineIntensity: 0,
            speed: 1.6,
            scanlineFrequency: 5,
            warpAmount: 0,
            resolutionScale: 1
          });
        }
        // Reset state
        interestCalcMode = 'simple';
        interestCalcFreq = 'yearly';
        if (interestCalcModeTabs) {
          interestCalcModeTabs.querySelectorAll('.mortgage-calc-method-tab').forEach(tab => tab.classList.remove('active'));
          const defaultTab = interestCalcModeTabs.querySelector('[data-mode="simple"]');
          if (defaultTab) defaultTab.classList.add('active');
        }
        if (interestCalcFreqTabs) {
          interestCalcFreqTabs.querySelectorAll('.mortgage-calc-method-tab').forEach(tab => tab.classList.remove('active'));
          const defaultFreqTab = interestCalcFreqTabs.querySelector('[data-freq="yearly"]');
          if (defaultFreqTab) defaultFreqTab.classList.add('active');
        }
        updateInterestModeFields();
        interestCalcSchedule = [];
        if (interestCalcResultEmpty) interestCalcResultEmpty.style.display = '';
        if (interestCalcResultContent) interestCalcResultContent.style.display = 'none';
        if (interestCalcScheduleBody) interestCalcScheduleBody.innerHTML = '';
        const principalEl = document.getElementById('interestCalcPrincipal');
        const regularEl = document.getElementById('interestCalcRegularAmount');
        const rateEl = document.getElementById('interestCalcRate');
        const termEl = document.getElementById('interestCalcTerm');
        if (principalEl && !principalEl.value.trim()) principalEl.value = '10000';
        if (regularEl && !regularEl.value.trim()) regularEl.value = '1000';
        if (rateEl && !rateEl.value.trim()) rateEl.value = '5';
        if (termEl && !termEl.value.trim()) termEl.value = '10';
      }

      function closeInterestCalcOverlay() {
        if (interestCalcOverlay) interestCalcOverlay.classList.remove('visible');
        if (interestCalcDitherInstance) {
          interestCalcDitherInstance();
          interestCalcDitherInstance = null;
        }
      }

      if (interestCalcBack) {
        interestCalcBack.addEventListener('click', closeInterestCalcOverlay);
      }

      if (interestCalcModeTabs) {
        interestCalcModeTabs.querySelectorAll('.mortgage-calc-method-tab').forEach(tab => {
          tab.addEventListener('click', () => {
            interestCalcModeTabs.querySelectorAll('.mortgage-calc-method-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            interestCalcMode = tab.dataset.mode;
            updateInterestModeFields();
          });
        });
      }

      if (interestCalcFreqTabs) {
        interestCalcFreqTabs.querySelectorAll('.mortgage-calc-method-tab').forEach(tab => {
          tab.addEventListener('click', () => {
            interestCalcFreqTabs.querySelectorAll('.mortgage-calc-method-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            interestCalcFreq = tab.dataset.freq;
          });
        });
      }

      if (interestCalcBtn) {
        interestCalcBtn.addEventListener('click', calcInterest);
      }

      // Enter key support on input fields
      ['interestCalcPrincipal', 'interestCalcRegularAmount', 'interestCalcRate', 'interestCalcTerm'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); calcInterest(); }
        });
      });

      // Open from tool list
      document.querySelectorAll('.audio-list-item[data-tool="interest-calc"]').forEach(item => {
        item.addEventListener('click', () => {
          if (transitionMask) transitionMask.classList.add('visible');
          setTimeout(() => {
            openInterestCalcOverlay();
            if (transitionMask) transitionMask.classList.remove('visible');
          }, 1000);
        });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            item.click();
          }
        });
      });

      // ===== End Interest Calculator =====

      // ===== Password Generator =====
      const passwordGenOverlay = document.getElementById('passwordGenOverlay');
      const passwordGenBack = document.getElementById('passwordGenBack');
      const passwordGenBg = document.getElementById('passwordGenBg');
      const passwordGenStrengthTabs = document.getElementById('passwordGenStrengthTabs');
      const passwordGenStrengthDesc = document.getElementById('passwordGenStrengthDesc');
      const passwordGenBtn = document.getElementById('passwordGenBtn');
      const passwordGenResultEmpty = document.getElementById('passwordGenResultEmpty');
      const passwordGenResultContent = document.getElementById('passwordGenResultContent');
      const passwordGenOutput = document.getElementById('passwordGenOutput');
      const passwordGenCopyBtn = document.getElementById('passwordGenCopyBtn');
      const passwordGenStrengthText = document.getElementById('passwordGenStrengthText');
      const passwordGenStrengthFill = document.getElementById('passwordGenStrengthFill');
      const passwordGenHistoryList = document.getElementById('passwordGenHistoryList');
      const passwordGenClearBtn = document.getElementById('passwordGenClearBtn');
      const passwordGenLengthSlider = document.getElementById('passwordGenLengthSlider');
      const passwordGenLengthValue = document.getElementById('passwordGenLengthValue');

      let passwordGenStrength = 'simple';
      let passwordGenDitherInstance = null;
      let passwordGenHistory = [];

      function clearPasswordSensitiveContent() {
        passwordGenHistory = [];
        if (passwordGenOutput) passwordGenOutput.textContent = '';
        if (passwordGenStrengthText) passwordGenStrengthText.textContent = '--';
        if (passwordGenStrengthFill) {
          passwordGenStrengthFill.style.width = '0';
          passwordGenStrengthFill.style.background = '';
        }
        if (passwordGenHistoryList) passwordGenHistoryList.replaceChildren();
        if (passwordGenResultEmpty) passwordGenResultEmpty.style.display = '';
        if (passwordGenResultContent) passwordGenResultContent.style.display = 'none';
      }

      function getPasswordOptions() {
        const upperEl = document.getElementById('passwordGenUppercase');
        const lowerEl = document.getElementById('passwordGenLowercase');
        const numEl = document.getElementById('passwordGenNumbers');
        const symEl = document.getElementById('passwordGenSymbols');
        const excludeEl = document.getElementById('passwordGenExcludeSimilar');
        return {
          uppercase: Boolean(upperEl?.checked),
          lowercase: Boolean(lowerEl?.checked),
          numbers: Boolean(numEl?.checked),
          symbols: Boolean(symEl?.checked),
          excludeSimilar: Boolean(excludeEl?.checked)
        };
      }

      function generatePassword() {
        const length = parseInt(passwordGenLengthSlider ? passwordGenLengthSlider.value : '16');
        let generated;
        try {
          generated = generateSecurePassword({ length, ...getPasswordOptions() });
        } catch (error) {
          console.error('[Password Generator] Generation error:', error);
          if (passwordGenResultEmpty) passwordGenResultEmpty.style.display = '';
          if (passwordGenResultContent) passwordGenResultContent.style.display = 'none';
          window.showToast(t('home.passwordGen.generateFailed'));
          return;
        }
        const { password, charsetSize } = generated;

        if (passwordGenResultEmpty) passwordGenResultEmpty.style.display = 'none';
        if (passwordGenResultContent) passwordGenResultContent.style.display = '';

        if (passwordGenOutput) passwordGenOutput.textContent = password;

        // Strength assessment
        const strengthInfo = assessPasswordStrength(password.length, charsetSize);
        if (passwordGenStrengthText) passwordGenStrengthText.textContent = t('home.passwordGen.' + strengthInfo.label);
        if (passwordGenStrengthFill) {
          passwordGenStrengthFill.style.width = strengthInfo.percent + '%';
          passwordGenStrengthFill.style.background = strengthInfo.color;
        }

        // Add to history
        passwordGenHistory.unshift(password);
        if (passwordGenHistory.length > 10) passwordGenHistory.pop();
        renderPasswordHistory();
      }

      function renderPasswordHistory() {
        if (!passwordGenHistoryList) return;
        passwordGenHistoryList.replaceChildren();
        passwordGenHistory.forEach(password => {
          const item = document.createElement('div');
          item.className = 'password-gen-history-item';
          const text = document.createElement('span');
          text.style.flex = '1';
          text.textContent = password;
          const copyButton = document.createElement('button');
          copyButton.className = 'password-gen-history-item-copy';
          copyButton.textContent = t('home.passwordGen.copy');
          copyButton.addEventListener('click', async () => {
            if (!navigator.clipboard?.writeText) {
              window.showToast(t('home.passwordGen.copyFailed'));
              return;
            }
            try {
              await navigator.clipboard.writeText(password);
              copyButton.textContent = t('home.passwordGen.copied');
              setTimeout(() => { copyButton.textContent = t('home.passwordGen.copy'); }, 1500);
            } catch (error) {
              window.showToast(t('home.passwordGen.copyFailed'));
            }
          });
          item.append(text, copyButton);
          passwordGenHistoryList.appendChild(item);
        });
      }

      function applyStrengthPreset(strength) {
        const upperEl = document.getElementById('passwordGenUppercase');
        const lowerEl = document.getElementById('passwordGenLowercase');
        const numEl = document.getElementById('passwordGenNumbers');
        const symEl = document.getElementById('passwordGenSymbols');
        const excludeEl = document.getElementById('passwordGenExcludeSimilar');

        if (strength === 'simple') {
          if (lowerEl) lowerEl.checked = true;
          if (numEl) numEl.checked = true;
          if (upperEl) upperEl.checked = false;
          if (symEl) symEl.checked = false;
          if (excludeEl) excludeEl.checked = false;
          if (passwordGenStrengthDesc) passwordGenStrengthDesc.textContent = t('home.passwordGen.simpleDesc');
          if (passwordGenLengthSlider) passwordGenLengthSlider.value = '8';
        } else if (strength === 'medium') {
          if (upperEl) upperEl.checked = true;
          if (lowerEl) lowerEl.checked = true;
          if (numEl) numEl.checked = true;
          if (symEl) symEl.checked = false;
          if (excludeEl) excludeEl.checked = false;
          if (passwordGenStrengthDesc) passwordGenStrengthDesc.textContent = t('home.passwordGen.mediumDesc');
          if (passwordGenLengthSlider) passwordGenLengthSlider.value = '16';
        } else {
          if (upperEl) upperEl.checked = true;
          if (lowerEl) lowerEl.checked = true;
          if (numEl) numEl.checked = true;
          if (symEl) symEl.checked = true;
          if (excludeEl) excludeEl.checked = true;
          if (passwordGenStrengthDesc) passwordGenStrengthDesc.textContent = t('home.passwordGen.ultimateDesc');
          if (passwordGenLengthSlider) passwordGenLengthSlider.value = '24';
        }
        if (passwordGenLengthValue) passwordGenLengthValue.textContent = passwordGenLengthSlider ? passwordGenLengthSlider.value : '16';
      }

      function openPasswordGenOverlay() {
        if (!passwordGenOverlay) return;
        passwordGenOverlay.classList.add('visible');
        if (passwordGenBg && !passwordGenDitherInstance) {
          passwordGenDitherInstance = initDarkVeil(passwordGenBg, {
            hueShift: 0,
            noiseIntensity: 0.03,
            scanlineIntensity: 0,
            speed: 1.6,
            scanlineFrequency: 5,
            warpAmount: 0,
            resolutionScale: 1
          });
        }
        // Reset state
        passwordGenStrength = 'simple';
        if (passwordGenStrengthTabs) {
          passwordGenStrengthTabs.querySelectorAll('.password-gen-strength-tab').forEach(tab => tab.classList.remove('active'));
          const defaultTab = passwordGenStrengthTabs.querySelector('[data-strength="simple"]');
          if (defaultTab) defaultTab.classList.add('active');
        }
        applyStrengthPreset('simple');
        clearPasswordSensitiveContent();
      }

      function closePasswordGenOverlay() {
        clearPasswordSensitiveContent();
        if (passwordGenOverlay) passwordGenOverlay.classList.remove('visible');
        if (passwordGenDitherInstance) {
          passwordGenDitherInstance();
          passwordGenDitherInstance = null;
        }
      }

      if (passwordGenBack) {
        passwordGenBack.addEventListener('click', closePasswordGenOverlay);
      }

      if (passwordGenStrengthTabs) {
        passwordGenStrengthTabs.querySelectorAll('.password-gen-strength-tab').forEach(tab => {
          tab.addEventListener('click', () => {
            passwordGenStrengthTabs.querySelectorAll('.password-gen-strength-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            passwordGenStrength = tab.dataset.strength;
            applyStrengthPreset(passwordGenStrength);
          });
        });
      }

      if (passwordGenLengthSlider) {
        passwordGenLengthSlider.addEventListener('input', () => {
          if (passwordGenLengthValue) passwordGenLengthValue.textContent = passwordGenLengthSlider.value;
        });
      }

      if (passwordGenBtn) {
        passwordGenBtn.addEventListener('click', () => {
          if (passwordGenBtn) passwordGenBtn.disabled = true;
          requestAnimationFrame(() => {
            generatePassword();
            if (passwordGenBtn) passwordGenBtn.disabled = false;
          });
        });
      }

      if (passwordGenCopyBtn) {
        passwordGenCopyBtn.addEventListener('click', async () => {
          const pw = passwordGenOutput ? passwordGenOutput.textContent : '';
          if (!pw || !navigator.clipboard?.writeText) {
            window.showToast(t('home.passwordGen.copyFailed'));
            return;
          }
          try {
            await navigator.clipboard.writeText(pw);
            passwordGenCopyBtn.textContent = t('home.passwordGen.copied');
            setTimeout(() => { passwordGenCopyBtn.textContent = t('home.passwordGen.copy'); }, 1500);
          } catch (error) {
            window.showToast(t('home.passwordGen.copyFailed'));
          }
        });
      }

      if (passwordGenClearBtn) {
        passwordGenClearBtn.addEventListener('click', clearPasswordSensitiveContent);
      }

      // Open from tool list
      document.querySelectorAll('.audio-list-item[data-tool="password-gen"]').forEach(item => {
        item.addEventListener('click', () => {
          if (transitionMask) transitionMask.classList.add('visible');
          setTimeout(() => {
            openPasswordGenOverlay();
            if (transitionMask) transitionMask.classList.remove('visible');
          }, 1000);
        });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            item.click();
          }
        });
      });

      // ===== End Password Generator =====

      const pdfMergeDropZone = document.getElementById('pdfMergeDropZone');
      const pdfMergeFiles = document.getElementById('pdfMergeFiles');
      const pdfMergeCta = document.getElementById('pdfMergeCta');
      const pdfMergeProcessBtn = document.getElementById('pdfMergeProcessBtn');
      const pdfMergeProcessMask = document.getElementById('pdfMergeProcessMask');
      const pdfMergeProcessBarFill = document.getElementById('pdfMergeProcessBarFill');
      const pdfMergeProcessText = document.getElementById('pdfMergeProcessText');
      const pdfMergeSuccessOverlay = document.getElementById('pdfMergeSuccessOverlay');
      const pdfMergeSuccessPath = document.getElementById('pdfMergeSuccessPath');
      const pdfMergeSuccessMeta = document.getElementById('pdfMergeSuccessMeta');
      const pdfMergeSuccessCount = document.getElementById('pdfMergeSuccessCount');
      const pdfMergeSuccessOpenFolder = document.getElementById('pdfMergeSuccessOpenFolder');
      const pdfMergeSuccessOk = document.getElementById('pdfMergeSuccessOk');
      let selectedPdfMergeFiles = [];
      let pdfMergeProcessing = false;
      let pdfMergeCommitting = false;

      function addPdfMergeFiles(fileList) {
        if (!fileList || fileList.length === 0) return;
        for (const file of fileList) {
          const dup = file.path
            ? selectedPdfMergeFiles.some(f => f.path === file.path)
            : selectedPdfMergeFiles.some(f => f === file);
          if (dup) continue;
          selectedPdfMergeFiles.push(file);
        }
        renderPdfMergeFiles();
      }

      function removePdfMergeFile(index) {
        selectedPdfMergeFiles.splice(index, 1);
        renderPdfMergeFiles();
      }

      function clearPdfMergeFiles() {
        selectedPdfMergeFiles = [];
        renderPdfMergeFiles();
      }

      async function getPdfMergeFileSize(file) {
        if (isTauri && file.path) {
          const { invoke } = await import('@tauri-apps/api/core');
          const size = await invoke('get_file_size', { path: file.path });
          if (!Number.isSafeInteger(size) || size < 0) {
            throw new Error(`Invalid file size for ${file.name}`);
          }
          file.size = size;
          return size;
        }
        if (!Number.isSafeInteger(file.size) || file.size < 0) {
          throw new Error(`Invalid file size for ${file.name}`);
        }
        return file.size;
      }

      async function preflightPdfMergeFiles() {
        const { assertPdfMergeSelection } = await import('./pdf-merge-core.js');
        const sizes = await Promise.all(selectedPdfMergeFiles.map(getPdfMergeFileSize));
        const totalBytes = sizes.reduce((total, size) => total + size, 0);
        if (!Number.isSafeInteger(totalBytes)) {
          throw new Error('PDF inputs are too large to merge safely');
        }
        assertPdfMergeSelection(selectedPdfMergeFiles, totalBytes);
      }

      function renderPdfMergeFiles() {
        if (!pdfMergeFiles) return;
        pdfMergeFiles.innerHTML = '';
        if (selectedPdfMergeFiles.length > 0) {
          pdfMergeFiles.classList.add('has-files');
        } else {
          pdfMergeFiles.classList.remove('has-files');
        }
        selectedPdfMergeFiles.forEach((file, index) => {
          const item = document.createElement('div');
          item.className = 'audio-convert-file-item';
          item.draggable = true;
          item.dataset.index = index;
          item.innerHTML = `
            <span class="audio-convert-file-index">${index + 1}</span>
            <span class="audio-convert-file-name">${escapeHtml(file.name)}</span>
            <button class="audio-convert-file-remove" data-index="${index}" aria-label="remove">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          `;
          pdfMergeFiles.appendChild(item);
        });
        pdfMergeFiles.querySelectorAll('.audio-convert-file-remove').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.index, 10);
            if (!isNaN(idx)) removePdfMergeFile(idx);
          });
        });
        // Drag-to-reorder
        let dragSrcIdx = null;
        pdfMergeFiles.querySelectorAll('.audio-convert-file-item').forEach(item => {
          item.addEventListener('dragstart', (e) => {
            dragSrcIdx = parseInt(item.dataset.index, 10);
            item.classList.add('dragging');
          });
          item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
          });
          item.addEventListener('dragover', (e) => {
            e.preventDefault();
            const targetIdx = parseInt(item.dataset.index, 10);
            if (dragSrcIdx === null || dragSrcIdx === targetIdx) return;
            const moved = selectedPdfMergeFiles.splice(dragSrcIdx, 1)[0];
            selectedPdfMergeFiles.splice(targetIdx, 0, moved);
            dragSrcIdx = targetIdx;
            renderPdfMergeFiles();
          });
        });
        togglePdfMergeProcessButton();
      }

      function togglePdfMergeProcessButton() {
        if (!pdfMergeProcessBtn) return;
        if (selectedPdfMergeFiles.length >= 2) {
          pdfMergeProcessBtn.style.display = '';
          requestAnimationFrame(() => pdfMergeProcessBtn.classList.add('visible'));
        } else {
          pdfMergeProcessBtn.classList.remove('visible');
          const onTransitionEnd = (e) => {
            if (e.propertyName === 'opacity' && !pdfMergeProcessBtn.classList.contains('visible')) {
              pdfMergeProcessBtn.style.display = 'none';
              pdfMergeProcessBtn.removeEventListener('transitionend', onTransitionEnd);
            }
          };
          pdfMergeProcessBtn.addEventListener('transitionend', onTransitionEnd);
        }
      }

      function showPdfMergeDropZone() {
        if (pdfMergeDropZone) pdfMergeDropZone.classList.add('visible');
        if (pdfMergeOverlay) pdfMergeOverlay.classList.add('drag-over');
      }

      function hidePdfMergeDropZone() {
        if (pdfMergeDropZone) pdfMergeDropZone.classList.remove('visible');
        if (pdfMergeOverlay) pdfMergeOverlay.classList.remove('drag-over');
      }

      if (isTauri && pdfMergeOverlay) {
        (async () => {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          const webview = getCurrentWebview();
          await webview.onDragDropEvent((event) => {
            if (!pdfMergeOverlay.classList.contains('visible') || pdfMergeProcessing) return;
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') {
              showPdfMergeDropZone();
            } else if (payload.type === 'leave') {
              hidePdfMergeDropZone();
            } else if (payload.type === 'drop') {
              hidePdfMergeDropZone();
              const paths = payload.paths || [];
              if (paths.length === 0) return;
              const fileList = paths
                .filter(p => p.toLowerCase().endsWith('.pdf'))
                .map(path => ({ name: path.split(/[\\/]/).pop() || path, path, size: 0 }));
              if (fileList.length > 0) {
                addPdfMergeFiles(fileList);
              }
            }
          });
        })();
      }

      if (pdfMergeCta) {
        pdfMergeCta.addEventListener('click', async () => {
          if (isTauri) {
            try {
              const { open } = await import('@tauri-apps/plugin-dialog');
              const selected = await open({
                multiple: true,
                filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
              });
              if (selected && Array.isArray(selected)) {
                const fileList = selected.map(path => ({ name: path.split(/[\\/]/).pop() || path, path, size: 0 }));
                addPdfMergeFiles(fileList);
              }
            } catch (e) {
              console.error('PDF file selection error', e);
            }
          } else {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = '.pdf,application/pdf';
            input.addEventListener('change', () => {
              addPdfMergeFiles(input.files);
              input.value = '';
            });
            input.click();
          }
        });
      }

      if (pdfMergeProcessBtn) {
        pdfMergeProcessBtn.addEventListener('click', async () => {
          if (selectedPdfMergeFiles.length < 2 || pdfMergeProcessing) return;
          pdfMergeProcessing = true;
          if (pdfMergeProcessMask) pdfMergeProcessMask.classList.add('visible');
          if (pdfMergeProcessBarFill) pdfMergeProcessBarFill.style.width = '30%';
          if (pdfMergeProcessText) pdfMergeProcessText.textContent = t('home.pdfMerge.loadingPreview');

          try {
            const multiPageFiles = await loadPdfMergeSources();
            if (multiPageFiles.length > 0) {
              if (pdfMergeProcessMask) pdfMergeProcessMask.classList.remove('visible');
              if (pdfMergeProcessBarFill) pdfMergeProcessBarFill.style.width = '0%';
              openPdfMergeSelectionNotice(multiPageFiles);
            } else {
              await beginPdfMergeCommit();
            }
          } catch (e) {
            console.error('PDF merge source load error:', e);
            releasePdfMergePreviewResources();
            resetPdfMergeSelectionFlow();
            if (pdfMergeProcessMask) pdfMergeProcessMask.classList.remove('visible');
            if (pdfMergeProcessBarFill) pdfMergeProcessBarFill.style.width = '0%';
            pdfMergeProcessing = false;
            alert(t('common.errorOccurred', { error: String(e) }));
          }
        });
      }

      // ===== PDF Merge Page Selection =====
      const pdfMergeSelection = document.getElementById('pdfMergeSelection');
      const pdfMergeSelectionEyebrow = document.getElementById('pdfMergeSelectionEyebrow');
      const pdfMergeChoosePagesBtn = document.getElementById('pdfMergeChoosePagesBtn');
      const pdfMergeUseAllPagesBtn = document.getElementById('pdfMergeUseAllPagesBtn');
      const pdfMergePickerProgress = document.getElementById('pdfMergePickerProgress');
      const pdfMergePickerFileName = document.getElementById('pdfMergePickerFileName');
      const pdfMergePickerSelectedCount = document.getElementById('pdfMergePickerSelectedCount');
      const pdfMergePickerInputStatus = document.getElementById('pdfMergePickerInputStatus');
      const pdfMergePageStrip = document.getElementById('pdfMergePageStrip');
      const pdfMergeSelectAllPagesBtn = document.getElementById('pdfMergeSelectAllPagesBtn');
      const pdfMergeSelectionNextBtn = document.getElementById('pdfMergeSelectionNextBtn');

      // Each entry is an implementation-neutral merge instruction.
      let pdfPagesData = [];
      let pdfLoadedDocs = [];
      let pdfMergeSelectionFiles = [];
      let pdfMergeCurrentSelectionIndex = 0;
      let pdfMergePreviewRenderToken = 0;

      function releasePdfMergePreviewResources() {
        pdfMergePreviewRenderToken += 1;
        pdfLoadedDocs.forEach(({ doc }) => { try { doc.destroy(); } catch (_) {} });
        pdfLoadedDocs = [];
        pdfPagesData = [];
        if (pdfMergePageStrip) pdfMergePageStrip.replaceChildren();
      }

      function resetPdfMergeSelectionFlow() {
        pdfMergeSelectionFiles = [];
        pdfMergeCurrentSelectionIndex = 0;
        if (pdfMergeSelection) {
          pdfMergeSelection.classList.remove('visible');
          pdfMergeSelection.dataset.phase = '';
          pdfMergeSelection.setAttribute('aria-hidden', 'true');
        }
        if (pdfMergeOverlay) pdfMergeOverlay.classList.remove('is-selection-flow');
      }

      function hidePdfMergeSelectionFlow() {
        if (pdfMergeSelection) {
          pdfMergeSelection.classList.remove('visible');
          pdfMergeSelection.setAttribute('aria-hidden', 'true');
        }
        if (pdfMergeOverlay) pdfMergeOverlay.classList.remove('is-selection-flow');
      }

      async function loadPdfMergeSources() {
        releasePdfMergePreviewResources();

        try {
          await preflightPdfMergeFiles();
          const { PDF_MERGE_LIMITS } = await import('./pdf-merge-core.js');
          const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
          pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

          for (let fi = 0; fi < selectedPdfMergeFiles.length; fi++) {
            const file = selectedPdfMergeFiles[fi];
            let fileData;

            if (isTauri && file.path) {
              const { invoke } = await import('@tauri-apps/api/core');
              const bytes = await invoke('read_file_bytes', { path: file.path });
              if (Array.isArray(bytes)) {
                fileData = Uint8Array.from(bytes);
              } else if (bytes instanceof ArrayBuffer) {
                fileData = new Uint8Array(bytes);
              } else if (bytes instanceof Uint8Array) {
                fileData = bytes;
              } else if (bytes && typeof bytes.length === 'number') {
                fileData = Uint8Array.from(bytes);
              } else {
                throw new Error(`Invalid file data for ${file.name}: ${typeof bytes}`);
              }
              if (fileData.length === 0) throw new Error(`File ${file.name} is empty`);
            } else {
              fileData = new Uint8Array(await file.arrayBuffer());
            }

            const wasmUrl = new URL('assets/', document.baseURI).href;
            const loadingTask = pdfjsLib.getDocument({ data: fileData.slice(), wasmUrl, useWasm: true });
            const pdfDoc = await loadingTask.promise;
            if (pdfPagesData.length + pdfDoc.numPages > PDF_MERGE_LIMITS.maxPreviewPages) {
              try { await pdfDoc.destroy(); } catch (_) {}
              throw new Error(`PDF inputs exceed the ${PDF_MERGE_LIMITS.maxPreviewPages}-page preview limit`);
            }
            pdfLoadedDocs.push({ doc: pdfDoc, fileData });

            for (let pi = 1; pi <= pdfDoc.numPages; pi++) {
              pdfPagesData.push({
                fileIndex: fi,
                pageIndex: pi,
                rotation: 0,
                selected: true
              });
            }
          }

          return pdfLoadedDocs
            .map(({ doc }, fileIndex) => ({ fileIndex, pageCount: doc.numPages }))
            .filter(({ pageCount }) => pageCount > 1);
        } catch (error) {
          releasePdfMergePreviewResources();
          throw error;
        }
      }

      function openPdfMergeSelectionNotice(multiPageFiles) {
        pdfMergeSelectionFiles = multiPageFiles;
        pdfMergeCurrentSelectionIndex = 0;
        if (pdfMergeSelectionEyebrow) {
          pdfMergeSelectionEyebrow.textContent = t('home.pdfMerge.multiPageDetected', { count: multiPageFiles.length });
        }
        if (pdfMergeSelection) {
          pdfMergeSelection.dataset.phase = 'notice';
          pdfMergeSelection.classList.add('visible');
          pdfMergeSelection.setAttribute('aria-hidden', 'false');
        }
        if (pdfMergeOverlay) pdfMergeOverlay.classList.add('is-selection-flow');
      }

      function getPdfMergePagesForFile(fileIndex) {
        return pdfPagesData.filter(pageData => pageData.fileIndex === fileIndex);
      }

      function getSelectedPdfMergePages() {
        return pdfPagesData.filter(pageData => pageData.selected);
      }

      function updatePdfMergeSelectionControls() {
        const currentFile = pdfMergeSelectionFiles[pdfMergeCurrentSelectionIndex];
        if (!currentFile) return;
        const currentPages = getPdfMergePagesForFile(currentFile.fileIndex);
        const selectedCount = currentPages.filter(pageData => pageData.selected).length;
        const allPagesSelected = currentPages.length > 0 && selectedCount === currentPages.length;

        if (pdfMergePickerProgress) {
          pdfMergePickerProgress.textContent = t('home.pdfMerge.pickerProgress', {
            current: pdfMergeCurrentSelectionIndex + 1,
            total: pdfMergeSelectionFiles.length
          });
        }
        if (pdfMergePickerFileName) {
          pdfMergePickerFileName.textContent = t('home.pdfMerge.pickerFile', {
            name: selectedPdfMergeFiles[currentFile.fileIndex]?.name || ''
          });
        }
        if (pdfMergePickerInputStatus) {
          pdfMergePickerInputStatus.textContent = t('home.pdfMerge.pickerInputStatus', {
            count: selectedPdfMergeFiles.length
          });
        }
        if (pdfMergePickerSelectedCount) {
          pdfMergePickerSelectedCount.textContent = t('home.pdfMerge.pickerSelected', {
            selected: selectedCount,
            total: currentPages.length
          });
        }
        if (pdfMergeSelectAllPagesBtn) {
          pdfMergeSelectAllPagesBtn.textContent = t(allPagesSelected
            ? 'home.pdfMerge.deselectAllPages'
            : 'home.pdfMerge.selectAllPages');
        }
        if (pdfMergeSelectionNextBtn) {
          const isLastFile = pdfMergeCurrentSelectionIndex === pdfMergeSelectionFiles.length - 1;
          pdfMergeSelectionNextBtn.textContent = t(isLastFile
            ? 'home.pdfMerge.selectionComplete'
            : 'home.pdfMerge.nextFile');
          pdfMergeSelectionNextBtn.disabled = selectedCount === 0;
        }
      }

      function setPdfMergePageTileSelected(pageEl, selected) {
        pageEl.classList.toggle('is-selected', selected);
        pageEl.setAttribute('aria-pressed', String(selected));
      }

      function renderPdfMergePagePicker() {
        const currentFile = pdfMergeSelectionFiles[pdfMergeCurrentSelectionIndex];
        if (!currentFile || !pdfMergePageStrip) return;

        const pagePreviews = [];
        const pageFragment = document.createDocumentFragment();
        for (const pageData of getPdfMergePagesForFile(currentFile.fileIndex)) {
          const pageEl = document.createElement('button');
          pageEl.type = 'button';
          pageEl.className = 'pdf-merge-page-tile';
          pageEl.setAttribute('aria-label', `Page ${pageData.pageIndex}`);
          setPdfMergePageTileSelected(pageEl, pageData.selected);

          const previewFrame = document.createElement('span');
          previewFrame.className = 'pdf-merge-page-frame is-loading';
          const loading = document.createElement('span');
          loading.className = 'pdf-merge-page-loading';
          previewFrame.appendChild(loading);

          const pageIndex = document.createElement('span');
          pageIndex.className = 'pdf-merge-page-index';
          pageIndex.textContent = String(pageData.pageIndex);

          const check = document.createElement('span');
          check.className = 'pdf-merge-page-check';
          check.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.2 4.2L19 6.8"></path></svg>';

          pageEl.append(previewFrame, pageIndex, check);
          pageEl.addEventListener('click', () => {
            pageData.selected = !pageData.selected;
            setPdfMergePageTileSelected(pageEl, pageData.selected);
            updatePdfMergeSelectionControls();
          });
          pageFragment.appendChild(pageEl);
          pagePreviews.push({ pageData, previewFrame });
        }

        pdfMergePageStrip.replaceChildren(pageFragment);
        updatePdfMergeSelectionControls();
        const renderToken = ++pdfMergePreviewRenderToken;
        void renderPdfMergePagePreviews(currentFile.fileIndex, pagePreviews, renderToken);
      }

      async function renderPdfMergePagePreviews(fileIndex, pagePreviews, renderToken) {
        const sourceDocument = pdfLoadedDocs[fileIndex]?.doc;
        if (!sourceDocument) return;

        let nextPreviewIndex = 0;
        const renderOne = async () => {
          while (nextPreviewIndex < pagePreviews.length) {
            const preview = pagePreviews[nextPreviewIndex++];
            try {
              const page = await sourceDocument.getPage(preview.pageData.pageIndex);
              const baseViewport = page.getViewport({ scale: 1 });
              const viewport = page.getViewport({ scale: 232 / baseViewport.width });
              const canvas = document.createElement('canvas');
              const context = canvas.getContext('2d', { alpha: false });
              if (!context) throw new Error('Unable to create PDF preview canvas');
              canvas.width = Math.ceil(viewport.width);
              canvas.height = Math.ceil(viewport.height);
              await page.render({ canvasContext: context, viewport }).promise;
              try { page.cleanup(); } catch (_) {}

              if (renderToken !== pdfMergePreviewRenderToken || !preview.previewFrame.isConnected) {
                canvas.width = 0;
                canvas.height = 0;
                return;
              }
              preview.previewFrame.replaceChildren(canvas);
              preview.previewFrame.classList.remove('is-loading');
            } catch (error) {
              console.warn('Unable to render PDF page preview:', error);
              if (renderToken === pdfMergePreviewRenderToken && preview.previewFrame.isConnected) {
                preview.previewFrame.classList.remove('is-loading');
                preview.previewFrame.classList.add('has-error');
              }
            }
          }
        };

        await Promise.all(Array.from({ length: Math.min(3, pagePreviews.length) }, renderOne));
      }

      function showPdfMergePagePicker() {
        if (!pdfMergeSelectionFiles.length) return;
        if (pdfMergeSelection) {
          pdfMergeSelection.dataset.phase = 'pages';
          pdfMergeSelection.classList.add('visible');
          pdfMergeSelection.setAttribute('aria-hidden', 'false');
        }
        if (pdfMergeOverlay) pdfMergeOverlay.classList.add('is-selection-flow');
        renderPdfMergePagePicker();
      }

      if (pdfMergeChoosePagesBtn) {
        pdfMergeChoosePagesBtn.addEventListener('click', showPdfMergePagePicker);
      }

      if (pdfMergeUseAllPagesBtn) {
        pdfMergeUseAllPagesBtn.addEventListener('click', () => {
          pdfPagesData.forEach(pageData => { pageData.selected = true; });
          void beginPdfMergeCommit();
        });
      }

      if (pdfMergeSelectAllPagesBtn) {
        pdfMergeSelectAllPagesBtn.addEventListener('click', () => {
          const currentFile = pdfMergeSelectionFiles[pdfMergeCurrentSelectionIndex];
          if (!currentFile) return;
          const currentPages = getPdfMergePagesForFile(currentFile.fileIndex);
          const shouldSelectAll = currentPages.some(pageData => !pageData.selected);
          currentPages.forEach(pageData => { pageData.selected = shouldSelectAll; });
          pdfMergePageStrip?.querySelectorAll('.pdf-merge-page-tile').forEach(pageEl => {
            setPdfMergePageTileSelected(pageEl, shouldSelectAll);
          });
          updatePdfMergeSelectionControls();
        });
      }

      if (pdfMergeSelectionNextBtn) {
        pdfMergeSelectionNextBtn.addEventListener('click', () => {
          const currentFile = pdfMergeSelectionFiles[pdfMergeCurrentSelectionIndex];
          if (!currentFile) return;
          const hasSelection = getPdfMergePagesForFile(currentFile.fileIndex)
            .some(pageData => pageData.selected);
          if (!hasSelection) {
            window.showToast(t('home.pdfMerge.selectAtLeastOne'));
            return;
          }
          if (pdfMergeCurrentSelectionIndex < pdfMergeSelectionFiles.length - 1) {
            pdfMergeCurrentSelectionIndex += 1;
            renderPdfMergePagePicker();
            return;
          }
          void beginPdfMergeCommit();
        });
      }

      onLangChange(() => {
        if (!pdfMergeSelection?.classList.contains('visible')) return;
        if (pdfMergeSelection.dataset.phase === 'notice') {
          if (pdfMergeSelectionEyebrow) {
            pdfMergeSelectionEyebrow.textContent = t('home.pdfMerge.multiPageDetected', {
              count: pdfMergeSelectionFiles.length
            });
          }
          return;
        }
        updatePdfMergeSelectionControls();
      });

      async function beginPdfMergeCommit() {
        if (!pdfMergeProcessing || pdfMergeCommitting || getSelectedPdfMergePages().length === 0) return;
        pdfMergeCommitting = true;
        hidePdfMergeSelectionFlow();
        if (pdfMergeProcessMask) pdfMergeProcessMask.classList.add('visible');
        if (pdfMergeProcessBarFill) pdfMergeProcessBarFill.style.width = '30%';
        if (pdfMergeProcessText) pdfMergeProcessText.textContent = t('home.pdfMerge.processing');
        const startTime = Date.now();

        try {
          const outputPath = await performPdfMerge();
          if (pdfMergeProcessBarFill) pdfMergeProcessBarFill.style.width = '100%';
          const elapsed = Date.now() - startTime;
          const remaining = Math.max(0, 1500 - elapsed);
          setTimeout(() => {
            if (pdfMergeProcessMask) pdfMergeProcessMask.classList.remove('visible');
            if (pdfMergeProcessBarFill) pdfMergeProcessBarFill.style.width = '0%';
            pdfMergeProcessing = false;
            pdfMergeCommitting = false;
            resetPdfMergeSelectionFlow();
            showPdfMergeSuccess(outputPath);
          }, remaining);
        } catch (error) {
          console.error('PDF merge error:', error);
          const elapsed = Date.now() - startTime;
          const remaining = Math.max(0, 1500 - elapsed);
          setTimeout(() => {
            if (pdfMergeProcessMask) pdfMergeProcessMask.classList.remove('visible');
            if (pdfMergeProcessBarFill) pdfMergeProcessBarFill.style.width = '0%';
            pdfMergeCommitting = false;
            if (pdfMergeSelectionFiles.length > 0) {
              if (pdfMergeSelection) {
                pdfMergeSelection.classList.add('visible');
                pdfMergeSelection.setAttribute('aria-hidden', 'false');
              }
              if (pdfMergeOverlay) pdfMergeOverlay.classList.add('is-selection-flow');
            } else {
              pdfMergeProcessing = false;
            }
            alert(t('common.errorOccurred', { error: String(error) }));
          }, remaining);
        }
      }

      async function performPdfMerge() {
        const { mergePdfPages } = await import('./pdf-merge-core.js');
        const mergedBytes = await mergePdfPages({ documents: pdfLoadedDocs, pages: getSelectedPdfMergePages() });

        // Keep merge exports in the same configured output root as every other desktop tool.
        let outputPath;
        if (isTauri) {
          const { invoke } = await import('@tauri-apps/api/core');
          const outputDir = await getOutputDir('PDF_Merge');
          outputPath = await invoke('write_unique_file_bytes', {
            directory: outputDir,
            fileName: 'merged.pdf',
            bytes: Array.from(mergedBytes)
          });
        } else {
          // Browser fallback: download
          const blob = new Blob([mergedBytes], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'merged.pdf';
          a.click();
          URL.revokeObjectURL(url);
          outputPath = '~/Downloads/merged.pdf';
        }

        return outputPath;
      }

      function showPdfMergeSuccess(outputPath) {
        releasePdfMergePreviewResources();

        const count = selectedPdfMergeFiles.length;
        if (pdfMergeSuccessMeta) {
          pdfMergeSuccessMeta.textContent = t('home.pdfMerge.successSummary', { count });
        }
        if (pdfMergeSuccessCount) {
          pdfMergeSuccessCount.textContent = `${count} ${t('home.pdfMerge.successCountUnit')}`;
        }
        if (pdfMergeSuccessPath) {
          pdfMergeSuccessPath.textContent = outputPath.replace(/\//g, '\\');
        }
        if (pdfMergeSuccessOverlay) {
          pdfMergeSuccessOverlay.classList.add('visible');
        }
      }

      if (pdfMergeSuccessOk) {
        pdfMergeSuccessOk.addEventListener('click', () => {
          if (pdfMergeSuccessOverlay) pdfMergeSuccessOverlay.classList.remove('visible');
          clearPdfMergeFiles();
        });
      }

      if (pdfMergeSuccessOpenFolder) {
        pdfMergeSuccessOpenFolder.addEventListener('click', async () => {
          if (isTauri && pdfMergeSuccessPath.textContent) {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const folder = pdfMergeSuccessPath.textContent
                .replace(/[/\\][^/\\]+$/, '')
                .replace(/\//g, '\\');
              await invoke('open_path', { path: folder });
            } catch (e) {
              console.error('Open folder error:', e);
            }
          }
        });
      }

      // ===== PDF Compress =====
      const pdfCompressOverlay = document.getElementById('pdfCompressOverlay');
      const pdfCompressFerrofluid = document.getElementById('pdfCompressFerrofluid');
      const pdfCompressBack = document.getElementById('pdfCompressBack');
      let pdfCompressFerrofluidInstance = null;
      const pdfCompressDropZone = document.getElementById('pdfCompressDropZone');
      const pdfCompressFiles = document.getElementById('pdfCompressFiles');
      const pdfCompressCta = document.getElementById('pdfCompressCta');
      const pdfCompressProcessBtn = document.getElementById('pdfCompressProcessBtn');
      const pdfCompressProcessMask = document.getElementById('pdfCompressProcessMask');
      const pdfCompressProcessBarFill = document.getElementById('pdfCompressProcessBarFill');
      const pdfCompressProcessText = document.getElementById('pdfCompressProcessText');
      const pdfCompressLevelOptions = document.getElementById('pdfCompressLevelOptions');
      const pdfCompressDrawer = document.getElementById('pdfCompressDrawer');
      const pdfCompressDrawerBackdrop = document.getElementById('pdfCompressDrawerBackdrop');
      const pdfCompressDrawerClose = document.getElementById('pdfCompressDrawerClose');
      const pdfCompressDrawerBody = document.getElementById('pdfCompressDrawerBody');
      const pdfCompressDrawerFooter = document.getElementById('pdfCompressDrawerFooter');
      const pdfCompressDownloadAllBtn = document.getElementById('pdfCompressDownloadAllBtn');
      const pdfCompressSuccessOverlay = document.getElementById('pdfCompressSuccessOverlay');
      const pdfCompressSuccessMeta = document.getElementById('pdfCompressSuccessMeta');
      const pdfCompressSuccessCount = document.getElementById('pdfCompressSuccessCount');
      const pdfCompressSuccessPath = document.getElementById('pdfCompressSuccessPath');
      const pdfCompressSuccessOk = document.getElementById('pdfCompressSuccessOk');
      const pdfCompressSuccessOpenFolder = document.getElementById('pdfCompressSuccessOpenFolder');

      let selectedPdfCompressFiles = [];
      let pdfCompressProcessing = false;
      let pdfCompressLevel = 'medium';
      let pdfCompressResults = [];
      let pdfCompressOutputDir = '';

      function openPdfCompressOverlay() {
        if (!pdfCompressOverlay) return;
        pdfCompressOverlay.classList.add('visible');
        if (pdfCompressFerrofluid && !pdfCompressFerrofluidInstance) {
          pdfCompressFerrofluidInstance = initFerrofluid(pdfCompressFerrofluid, {
            colors: ['#e8e8ec', '#a0a0a8', '#ffffff'],
            opacity: 0.6,
          });
        }
      }

      function closePdfCompressOverlay() {
        if (pdfCompressProcessing) {
          window.showToast(t('home.pdfCompress.processing'));
          return;
        }
        if (!pdfCompressOverlay) return;
        pdfCompressOverlay.classList.remove('visible');
        if (pdfCompressFerrofluidInstance) {
          pdfCompressFerrofluidInstance();
          pdfCompressFerrofluidInstance = null;
        }
        if (pdfCompressProcessMask) pdfCompressProcessMask.classList.remove('visible');
        if (pdfCompressProcessBarFill) pdfCompressProcessBarFill.style.width = '0%';
        clearPdfCompressFiles();
        if (pdfCompressDrawer) pdfCompressDrawer.classList.remove('visible');
        pdfCompressResults = [];
      }

      if (pdfCompressBack) {
        pdfCompressBack.addEventListener('click', closePdfCompressOverlay);
      }

      document.querySelectorAll('.audio-list-item[data-tool="pdf-compress"]').forEach(item => {
        item.addEventListener('click', () => openPdfCompressOverlay());
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPdfCompressOverlay();
          }
        });
      });

      // Compression level selector
      if (pdfCompressLevelOptions) {
        pdfCompressLevelOptions.addEventListener('click', (e) => {
          const btn = e.target.closest('.audio-convert-format-option');
          if (!btn) return;
          pdfCompressLevelOptions.querySelectorAll('.audio-convert-format-option').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          pdfCompressLevel = btn.dataset.level;
        });
      }

      function addPdfCompressFiles(fileList) {
        if (!fileList || fileList.length === 0) return;
        if (pdfCompressProcessing) return;
        for (const file of fileList) {
          const dup = file.path
            ? selectedPdfCompressFiles.some(f => f.path === file.path)
            : selectedPdfCompressFiles.some(f => f.name === file.name && f.size === file.size);
          if (dup) continue;
          selectedPdfCompressFiles.push(file);
        }
        renderPdfCompressFiles();
      }

      function removePdfCompressFile(index) {
        selectedPdfCompressFiles.splice(index, 1);
        renderPdfCompressFiles();
      }

      function clearPdfCompressFiles() {
        selectedPdfCompressFiles = [];
        renderPdfCompressFiles();
      }

      function renderPdfCompressFiles() {
        if (!pdfCompressFiles) return;
        pdfCompressFiles.innerHTML = '';
        if (selectedPdfCompressFiles.length > 0) {
          pdfCompressFiles.classList.add('has-files');
        } else {
          pdfCompressFiles.classList.remove('has-files');
        }
        selectedPdfCompressFiles.forEach((file, index) => {
          const item = document.createElement('div');
          item.className = 'audio-convert-file-item';
          item.dataset.index = index;
          item.innerHTML = `
            <span class="audio-convert-file-index">${index + 1}</span>
            <span class="audio-convert-file-name">${escapeHtml(file.name)}</span>
            <button class="audio-convert-file-remove" data-index="${index}" aria-label="remove">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          `;
          pdfCompressFiles.appendChild(item);
        });
        pdfCompressFiles.querySelectorAll('.audio-convert-file-remove').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.index, 10);
            if (!isNaN(idx)) removePdfCompressFile(idx);
          });
        });
        enableSortableFileList(pdfCompressFiles, selectedPdfCompressFiles, renderPdfCompressFiles, () => pdfCompressProcessing);
        togglePdfCompressProcessButton();
      }

      function togglePdfCompressProcessButton() {
        if (!pdfCompressProcessBtn) return;
        if (selectedPdfCompressFiles.length >= 1) {
          pdfCompressProcessBtn.style.display = '';
          requestAnimationFrame(() => pdfCompressProcessBtn.classList.add('visible'));
        } else {
          pdfCompressProcessBtn.classList.remove('visible');
          const onTransitionEnd = (e) => {
            if (e.propertyName === 'opacity' && !pdfCompressProcessBtn.classList.contains('visible')) {
              pdfCompressProcessBtn.style.display = 'none';
              pdfCompressProcessBtn.removeEventListener('transitionend', onTransitionEnd);
            }
          };
          pdfCompressProcessBtn.addEventListener('transitionend', onTransitionEnd);
        }
      }

      async function getPdfCompressErrorMessage(error) {
        const { getPdfCompressErrorCode } = await import('./pdf-compress-core.js');
        const code = getPdfCompressErrorCode(error);
        const messageKey = {
          'desktop-only': 'errorDesktopOnly',
          'input-too-large': 'errorTooLarge',
          'too-many-pages': 'errorTooManyPages',
          'invalid-level': 'errorInvalidLevel',
          'invalid-pdf': 'errorInvalidPdf',
          'password-protected': 'errorPasswordProtected',
          'qpdf-unavailable': 'errorEngineUnavailable',
          'compression-failed': 'errorFailed'
        }[code] || 'errorFailed';
        return t(`home.pdfCompress.${messageKey}`);
      }

      function showPdfCompressDropZone() {
        if (pdfCompressDropZone) pdfCompressDropZone.classList.add('visible');
        if (pdfCompressOverlay) pdfCompressOverlay.classList.add('drag-over');
      }

      function hidePdfCompressDropZone() {
        if (pdfCompressDropZone) pdfCompressDropZone.classList.remove('visible');
        if (pdfCompressOverlay) pdfCompressOverlay.classList.remove('drag-over');
      }

      if (isTauri && pdfCompressOverlay) {
        (async () => {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          const webview = getCurrentWebview();
          await webview.onDragDropEvent(async (event) => {
            if (!pdfCompressOverlay.classList.contains('visible') || pdfCompressProcessing) return;
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') {
              showPdfCompressDropZone();
            } else if (payload.type === 'leave') {
              hidePdfCompressDropZone();
            } else if (payload.type === 'drop') {
              hidePdfCompressDropZone();
              const paths = payload.paths || [];
              if (paths.length === 0) return;
              const filePaths = paths.filter(p => p.toLowerCase().endsWith('.pdf'));
              const fileList = await Promise.all(filePaths.map(async path => {
                let size = 0;
                try {
                  const { invoke } = await import('@tauri-apps/api/core');
                  size = await invoke('get_file_size', { path });
                } catch (e) {}
                return { name: path.split(/[\\/]/).pop() || path, path, size };
              }));
              if (fileList.length > 0) addPdfCompressFiles(fileList);
            }
          });
        })();
      }

      if (pdfCompressCta) {
        pdfCompressCta.addEventListener('click', async () => {
          if (pdfCompressProcessing) return;
          if (isTauri) {
            try {
              const { open } = await import('@tauri-apps/plugin-dialog');
              const selected = await open({
                multiple: true,
                filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
              });
              if (selected && Array.isArray(selected)) {
                const fileList = await Promise.all(selected.map(async path => {
                  let size = 0;
                  try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    size = await invoke('get_file_size', { path });
                  } catch (e) {}
                  return { name: path.split(/[\\/]/).pop() || path, path, size };
                }));
                addPdfCompressFiles(fileList);
              }
            } catch (e) {
              console.error('PDF compress file selection error', e);
            }
          } else {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.pdf';
            input.multiple = true;
            input.addEventListener('change', () => {
              if (input.files) addPdfCompressFiles(Array.from(input.files));
            });
            input.click();
          }
        });
      }

      if (pdfCompressProcessBtn) {
        pdfCompressProcessBtn.addEventListener('click', async () => {
          if (selectedPdfCompressFiles.length < 1 || pdfCompressProcessing) return;
          pdfCompressProcessing = true;
          if (pdfCompressProcessMask) pdfCompressProcessMask.classList.add('visible');
          if (pdfCompressProcessBarFill) pdfCompressProcessBarFill.style.width = '30%';
          if (pdfCompressProcessText) pdfCompressProcessText.textContent = t('home.pdfCompress.processing');

          try {
            const { assertPdfCompressSelection } = await import('./pdf-compress-core.js');
            const { invoke } = await import('@tauri-apps/api/core');
            assertPdfCompressSelection(selectedPdfCompressFiles);
            if (!isTauri) throw new Error('pdf-compress:desktop-only');

            pdfCompressResults = [];
            pdfCompressOutputDir = '';
            const errors = [];
            for (let i = 0; i < selectedPdfCompressFiles.length; i++) {
              const file = selectedPdfCompressFiles[i];
              const progress = Math.round(((i + 0.3) / selectedPdfCompressFiles.length) * 100);
              if (pdfCompressProcessBarFill) pdfCompressProcessBarFill.style.width = progress + '%';
              if (pdfCompressProcessText) pdfCompressProcessText.textContent = `${t('home.pdfCompress.processing')} (${i + 1}/${selectedPdfCompressFiles.length})`;

              try {
                if (!file.path) throw new Error('pdf-compress:desktop-only');
                const result = await invoke('compress_pdf', { inputPath: file.path, level: pdfCompressLevel, outputDir: await getOutputDir('PDF_Compress') });
                pdfCompressOutputDir = result.output_dir || pdfCompressOutputDir;
                pdfCompressResults.push({
                  name: file.name,
                  originalSize: result.original_size,
                  compressedSize: result.compressed_size,
                  outputPath: result.output_path || ''
                });
              } catch (fileErr) {
                console.error(`[PDF Compress] Failed: ${file.name}`, fileErr);
                errors.push(`${file.name}: ${await getPdfCompressErrorMessage(fileErr)}`);
              }
            }

            if (pdfCompressProcessBarFill) pdfCompressProcessBarFill.style.width = '100%';
            if (pdfCompressProcessMask) pdfCompressProcessMask.classList.remove('visible');
            if (pdfCompressProcessBarFill) pdfCompressProcessBarFill.style.width = '0%';
            pdfCompressProcessing = false;

            if (pdfCompressResults.length > 0) {
              renderCompressResults();
              if (pdfCompressDrawer) pdfCompressDrawer.classList.add('visible');
            }
            if (pdfCompressResults.length > 0 && errors.length > 0) {
              alert(`${t('home.pdfCompress.partialFail')}:\n${errors.join('\n')}`);
            }
            if (pdfCompressResults.length === 0 && errors.length === 0) {
              alert(t('home.pdfCompress.errorFailed'));
            } else if (pdfCompressResults.length === 0 && errors.length > 0) {
              alert(`${t('home.pdfCompress.compressFailed')}:\n${errors.join('\n')}`);
            }
          } catch (e) {
            console.error('PDF compress error:', e);
            if (pdfCompressProcessMask) pdfCompressProcessMask.classList.remove('visible');
            if (pdfCompressProcessBarFill) pdfCompressProcessBarFill.style.width = '0%';
            pdfCompressProcessing = false;
            alert(t('common.errorOccurred', { error: await getPdfCompressErrorMessage(e) }));
          }
        });
      }

      function renderCompressResults() {
        if (!pdfCompressDrawerBody) return;
        pdfCompressDrawerBody.innerHTML = '';

        pdfCompressResults.forEach((result, idx) => {
          const item = document.createElement('div');
          item.className = 'pdf-compress-result-item';
          const hasSavedOutput = Boolean(result.outputPath);
          const ratio = result.originalSize > 0
            ? Math.round((1 - result.compressedSize / result.originalSize) * 100)
            : 0;
          const ratioText = ratio <= 0 ? `+${Math.abs(ratio)}%` : `-${ratio}%`;
          const ratioClass = ratio <= 0 ? 'pdf-compress-result-ratio no-save' : 'pdf-compress-result-ratio';
          item.innerHTML = `
            <div class="pdf-compress-result-info">
              <span class="pdf-compress-result-index">${idx + 1}</span>
              <span class="pdf-compress-result-name">${escapeHtml(result.name)}</span>
            </div>
            <div class="pdf-compress-result-sizes">
              <span class="pdf-compress-result-original">${formatFileSize(result.originalSize)}</span>
              <span class="pdf-compress-result-arrow">→</span>
              <span class="pdf-compress-result-compressed">${formatFileSize(result.compressedSize)}</span>
              <span class="${ratioClass}">${ratioText}</span>
            </div>
            <button class="pdf-compress-result-download" data-index="${idx}" type="button" aria-label="${hasSavedOutput ? t('home.pdfCompress.revealFile') : t('home.pdfCompress.noSmallerOutput')}" ${hasSavedOutput ? '' : 'disabled'}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
          `;
          pdfCompressDrawerBody.appendChild(item);
        });

        // Single file download buttons
        pdfCompressDrawerBody.querySelectorAll('.pdf-compress-result-download').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.index, 10);
            if (!isNaN(idx) && pdfCompressResults[idx]) {
              const result = pdfCompressResults[idx];
              if (isTauri && result.outputPath) {
                try {
                  await openOutputFolder(result.outputPath);
                } catch (err) {
                  console.error('[PDF Compress] Reveal file error:', err);
                  alert(t('home.pdfCompress.errorOpenOutput'));
                }
              }
            }
          });
        });

        // Update footer button text
        if (pdfCompressDownloadAllBtn) {
          const hasSavedOutput = pdfCompressResults.some(result => result.outputPath);
          pdfCompressDownloadAllBtn.textContent = t('home.pdfCompress.openOutputFolder');
          pdfCompressDownloadAllBtn.disabled = !hasSavedOutput;
        }
      }

      if (pdfCompressDownloadAllBtn) {
        pdfCompressDownloadAllBtn.addEventListener('click', async () => {
          if (pdfCompressResults.length === 0) return;
          if (isTauri && pdfCompressResults.some(result => result.outputPath)) {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              await invoke('open_path', { path: pdfCompressOutputDir });
            } catch (err) {
              console.error('[PDF Compress] Open output folder error:', err);
              alert(t('home.pdfCompress.errorOpenOutput'));
            }
          }
        });
      }

      if (pdfCompressDrawerClose) {
        pdfCompressDrawerClose.addEventListener('click', () => {
          if (pdfCompressDrawer) pdfCompressDrawer.classList.remove('visible');
        });
      }
      if (pdfCompressDrawerBackdrop) {
        pdfCompressDrawerBackdrop.addEventListener('click', () => {
          if (pdfCompressDrawer) pdfCompressDrawer.classList.remove('visible');
        });
      }

      let lastPdfCompressSavedPath = '';

      function showPdfCompressSuccess(savePath, type) {
        lastPdfCompressSavedPath = savePath;
        const count = pdfCompressResults.length;
        if (pdfCompressSuccessCount) pdfCompressSuccessCount.textContent = String(count);
        if (pdfCompressSuccessPath) pdfCompressSuccessPath.textContent = savePath;
        if (type === 'all') {
          if (pdfCompressSuccessMeta) pdfCompressSuccessMeta.textContent = t('home.pdfCompress.successAllMeta', { count });
        } else {
          if (pdfCompressSuccessMeta) pdfCompressSuccessMeta.textContent = t('home.pdfCompress.successSingleMeta');
        }
        if (pdfCompressSuccessOverlay) pdfCompressSuccessOverlay.classList.add('visible');
      }

      if (pdfCompressSuccessOk) {
        pdfCompressSuccessOk.addEventListener('click', () => {
          if (pdfCompressSuccessOverlay) pdfCompressSuccessOverlay.classList.remove('visible');
        });
      }
      if (pdfCompressSuccessOpenFolder) {
        pdfCompressSuccessOpenFolder.addEventListener('click', async () => {
          if (isTauri && lastPdfCompressSavedPath) {
            try {
              await openOutputFolder(lastPdfCompressSavedPath);
            } catch (e) {
              console.error('[PDF Compress] Reveal error:', e);
            }
          }
        });
      }

      // ===== Favorites System =====
      const FAV_KEY = 'toolknit_favorites';
      const MAX_FAVORITES = 6;
      const toastEl = document.getElementById('favToast');
      const toastText = document.getElementById('favToastText');
      let toastTimer = null;

      function showToast(msg) {
        if (!toastEl || !toastText) return;
        toastText.textContent = msg;
        toastEl.classList.add('visible');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
          toastEl.classList.remove('visible');
        }, 2000);
      }

      function getFavorites() {
        try {
          const favorites = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
          return Array.isArray(favorites) ? favorites.slice(0, MAX_FAVORITES) : [];
        } catch { return []; }
      }

      function saveFavorites(favs) {
        localStorage.setItem(FAV_KEY, JSON.stringify(favs.slice(0, MAX_FAVORITES)));
      }

      function isFavorited(toolId) {
        return getFavorites().some(f => f.tool === toolId);
      }

      function addFavorite(toolId, name, iconHtml, category) {
        if (isFavorited(toolId)) return false;
        const favs = getFavorites();
        if (favs.length >= MAX_FAVORITES) {
          showToast(t('home.favLimit'));
          return false;
        }
        favs.push({ tool: toolId, name, iconHtml, category, ts: Date.now() });
        saveFavorites(favs);
        renderFavorites();
        return true;
      }

      function removeFavorite(toolId) {
        const favs = getFavorites().filter(f => f.tool !== toolId);
        saveFavorites(favs);
        renderFavorites();
      }

      function getToolInfo(item) {
        const toolId = item.dataset.tool || '';
        const titleEl = item.querySelector('.audio-list-title');
        const name = titleEl ? titleEl.textContent : (item.dataset.tool || 'Tool');
        const iconEl = item.querySelector('.audio-list-icon');
        let iconHtml = '';
        if (iconEl) {
          iconHtml = iconEl.innerHTML;
        }
        const section = item.closest('.content-section');
        const category = section ? section.dataset.category : '';
        return { toolId, name, iconHtml, category };
      }

      function currentToolCategory(toolId, fallback = '') {
        const item = Array.from(document.querySelectorAll('.content-section:not([data-category="home"]) .audio-list-item'))
          .find(candidate => candidate.dataset.tool === toolId);
        return item?.closest('.content-section')?.dataset.category || fallback;
      }

      function resolveHomeToolInfo(record) {
        const toolId = record?.tool || '';
        const item = Array.from(document.querySelectorAll('.content-section:not([data-category="home"]) .audio-list-item'))
          .find(candidate => candidate.dataset.tool === toolId);
        if (item) return getToolInfo(item);
        return {
          toolId,
          name: record?.name || toolId || t('common.tool'),
          iconHtml: '',
          category: record?.category || ''
        };
      }

      function seedDefaultFavorites() {
        if (localStorage.getItem(FAV_KEY) !== null) return;

        const candidates = Array.from(document.querySelectorAll('.content-section:not([data-category="home"]) .audio-list-item'));
        const defaults = candidates
          .sort(() => Math.random() - 0.5)
          .slice(0, MAX_FAVORITES)
          .map(item => {
            const info = getToolInfo(item);
            return { tool: info.toolId, name: info.name, iconHtml: info.iconHtml, category: info.category, ts: Date.now() };
          });

        if (defaults.length > 0) saveFavorites(defaults);
      }

      // Right-click on audio-list-item → direct toggle favorite
      // Also track recent usage on click
      const RECENT_KEY = 'toolknit_recent_tools';
      const MAX_RECENT = 3;

      // A home shortcut may briefly switch to a category solely to open its tool.
      // Return only after that tool overlay has actually closed, so the category
      // never flashes between the overlay and the home screen.
      document.addEventListener('click', (event) => {
        const backButton = event.target.closest('.settings-back');
        if (!backButton || !navigatedFromHome) return;
        const toolOverlay = backButton.closest('[id$="Overlay"]');
        if (!toolOverlay) return;

        queueMicrotask(() => {
          if (!navigatedFromHome || toolOverlay.classList.contains('visible')) return;
          clearHomeToolNavigation();
          switchCategory('home');
        });
      });

      function getRecent() {
        try {
          return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
        } catch { return []; }
      }

      function saveRecent(list) {
        localStorage.setItem(RECENT_KEY, JSON.stringify(list));
      }

      function addRecent(toolId, name, iconHtml, category) {
        let list = getRecent().filter(r => r.tool !== toolId);
        list.unshift({ tool: toolId, name, iconHtml, category, ts: Date.now() });
        list = list.slice(0, MAX_RECENT);
        saveRecent(list);
      }

      document.querySelectorAll('.audio-list-item').forEach(item => {
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const info = getToolInfo(item);
          if (isFavorited(info.toolId)) {
            removeFavorite(info.toolId);
            showToast(t('home.favRemoved'));
          } else if (addFavorite(info.toolId, info.name, info.iconHtml, info.category)) {
            showToast(t('home.favAdded'));
          }
        });
        item.addEventListener('click', () => {
          const info = getToolInfo(item);
          if (info.toolId) {
            addRecent(info.toolId, info.name, info.iconHtml, info.category);
            renderRecent();
          }
        });
      });

      // Render favorites card on home
      function renderFavorites() {
        const container = document.getElementById('favoritesContent');
        if (!container) return;

        const favs = getFavorites();
        if (favs.length === 0) {
          container.innerHTML = `
            <div class="fav-empty-guide">
              <div class="fav-empty-icon"><i data-lucide="mouse-pointer-click"></i></div>
              <div class="fav-empty-text">${escapeHtml(t('home.favEmptyGuide'))}</div>
            </div>
          `;
          if (typeof createIcons === 'function') createIcons({ icons });
          return;
        }

        container.innerHTML = favs.map(f => {
          const info = resolveHomeToolInfo(f);
          return `
          <div class="fav-item" data-tool="${escapeHtml(info.toolId)}" data-category="${escapeHtml(info.category || '')}">
            <div class="fav-icon">${info.iconHtml}</div>
            <div class="fav-name">${escapeHtml(info.name)}</div>
            <div class="fav-remove" data-tool="${escapeHtml(info.toolId)}">
              <i data-lucide="x"></i>
            </div>
          </div>
        `;
        }).join('');

        if (typeof createIcons === 'function') createIcons({ icons });

        container.querySelectorAll('.fav-item').forEach(el => {
          el.addEventListener('click', (e) => {
            if (e.target.closest('.fav-remove')) return;
            const toolId = el.dataset.tool;
            const category = el.dataset.category;
            launchToolFromHome(toolId, category);
          });
        });

        container.querySelectorAll('.fav-remove').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeFavorite(btn.dataset.tool);
          });
        });
      }

      // ===== Recommended Tools (random 3) =====
      function renderRecommended() {
        const container = document.getElementById('recommendedContent');
        if (!container) return;
        const allItems = Array.from(document.querySelectorAll('.content-section:not([data-category="home"]) .audio-list-item'));
        if (allItems.length === 0) return;

        // Pick 3 random items
        const shuffled = allItems.sort(() => Math.random() - 0.5);
        const picks = shuffled.slice(0, 3);

        container.innerHTML = picks.map(item => {
          const info = getToolInfo(item);
          return `
            <div class="rec-item" data-tool="${info.toolId}" data-category="${info.category || ''}">
              <div class="rec-icon">${info.iconHtml || ''}</div>
              <div class="rec-name">${info.name}</div>
            </div>
          `;
        }).join('');

        if (typeof createIcons === 'function') createIcons({ icons });

        container.querySelectorAll('.rec-item').forEach(el => {
          el.addEventListener('click', () => {
            const toolId = el.dataset.tool;
            const category = el.dataset.category;
            launchToolFromHome(toolId, category, 1100);
          });
        });
      }

      // ===== Recently Used =====
      function renderRecent() {
        const container = document.getElementById('recentlyContent');
        if (!container) return;
        const recent = getRecent();
        if (recent.length === 0) {
          container.innerHTML = `<div class="placeholder-box" data-i18n="home.empty">${escapeHtml(t('home.empty'))}</div>`;
          return;
        }
        container.innerHTML = recent.map(r => {
          const info = resolveHomeToolInfo(r);
          return `
          <div class="rec-item" data-tool="${escapeHtml(info.toolId)}" data-category="${escapeHtml(info.category || '')}">
            <div class="rec-icon">${info.iconHtml}</div>
            <div class="rec-name">${escapeHtml(info.name)}</div>
          </div>
        `;
        }).join('');
        if (typeof createIcons === 'function') createIcons({ icons });
        container.querySelectorAll('.rec-item').forEach(el => {
          el.addEventListener('click', () => {
            const toolId = el.dataset.tool;
            const category = el.dataset.category;
            launchToolFromHome(toolId, category, 1100);
          });
        });
      }

      // Initial render
      seedDefaultFavorites();
      renderFavorites();
      renderRecommended();
      renderRecent();

      // Re-render on language change
      onLangChange(() => {
        renderFavorites();
        renderRecommended();
        renderRecent();
      });
