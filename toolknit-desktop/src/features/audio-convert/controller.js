import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { bindSortableFileList } from '../../shared/sortable-file-list.js';
import { formatFileSize } from '../../shared/file-size.js';
import { onLangChange, t as defaultTranslate } from '../../i18n.js';
import { loadTauriDialog, loadTauriWebview, tauriCorePromise, tauriEventPromise } from '../../platform/tauri-runtime.js';
import { normalizeAudioTargetFormat, validateAudioBatchSelection } from '../../audio-convert-core.js';
import { readNativeAudioFiles } from './selection.js';

export function createAudioConvertController({
  overlay,
  isTauri = false,
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = instance => instance?.(),
  openSettings = () => {},
  openSupport = () => {},
  openExternalUrl = () => {},
  handleWindowAction = () => {},
  getOutputDir,
  ensureFfmpegAvailable = async () => isTauri,
  openOutputFolder = async () => false,
  displayFilesystemPath = value => String(value || ''),
  refreshIcons = () => {},
  notify = message => globalThis.alert?.(message),
  t = defaultTranslate,
  onLangChange: registerLanguageChange = onLangChange,
  documentRef = globalThis.document,
  tauriCore = tauriCorePromise,
  loadDialog = loadTauriDialog,
  tauriEvents = tauriEventPromise
} = {}) {
  if (!overlay) throw new Error('audio-convert:missing-overlay');
  if (!documentRef) throw new Error('audio-convert:missing-document');
  if (isTauri && typeof getOutputDir !== 'function') throw new Error('audio-convert:missing-output-directory');
  const lifecycle = createLifecycleScope();
  let queueLifecycle = createLifecycleScope();
  lifecycle.use(() => queueLifecycle.dispose());
  const page = overlay.querySelector('[data-audio-convert-page]');
  const query = selector => page?.querySelector(selector) || overlay.querySelector(selector);
  const audioConvertOverlay = page;
  const plasmaBg = query('[data-audio-convert-bg]');
  let plasmaInstance = null;
  let nativeDropUnlisten = null;
  let disposed = false;
  let selectionRevision = 0;
  const audioConvertDropZone = query('[data-audio-convert-drop-zone]');
  const audioConvertFiles = query('[data-audio-convert-files]');
  const audioConvertCta = query('[data-audio-convert-action="choose"]');
  const audioConvertProcessBtn = query('[data-audio-convert-action="start"]');
  const audioConvertProcessMask = query('[data-audio-convert-process]');
  const audioConvertProcessBarFill = query('[data-audio-convert-progress]');
  const audioConvertProcessText = query('[data-audio-convert-process-text]');
  const audioConvertCancelBtn = query('[data-audio-convert-action="cancel"]');
  let selectedAudioFiles = [];
  let processingAudio = false;
  let targetAudioFormat = 'MP3';
  let audioConversionRunId = 0;
  let audioConvertUnlisten = null;
  let completionTimer = null;
  let processHideTimer = null;
  const audioConvertSuccessOverlay = query('[data-audio-convert-success]');
  const audioConvertSuccessPath = query('[data-audio-convert-success-path]');
  const audioConvertSuccessMeta = query('[data-audio-convert-success-meta]');
  const audioConvertSuccessFormat = query('[data-audio-convert-success-format]');
  const audioConvertSuccessCount = query('[data-audio-convert-success-count]');
  const audioConvertOpenFolder = query('[data-audio-convert-action="open-folder"]');
  const audioConvertSuccessOk = query('[data-audio-convert-action="success-ok"]');
  const audioConvertFormatOptions = query('[data-audio-convert-formats]');

  function selectionError(error) {
    const key = { invalid_input: 'invalidInput', invalid_input_size: 'invalidInput', missing_input: 'invalidInput',
      unsupported_input: 'unsupportedInput', input_too_large: 'inputTooLarge', too_many_files: 'tooManyFiles' }[error?.code];
    return t(`home.audioConvert.${key || 'conversionError'}`);
  }

  async function addNativeAudioPaths(paths, revision = selectionRevision) {
    const isCurrent = () => !disposed && revision === selectionRevision && page?.classList.contains('visible') && !processingAudio;
    try {
      const { invoke } = await tauriCore;
      const files = await readNativeAudioFiles(paths, invoke, isCurrent);
      if (files && isCurrent()) addAudioFiles(files);
    } catch (error) {
      if (isCurrent()) notify(selectionError(error));
    }
  }

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
          notify(selectionError(error));
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
        selectionRevision += 1;
        selectedAudioFiles = [];
        renderAudioFiles();
      }

      function renderAudioFiles() {
        if (!audioConvertFiles) return;
        queueLifecycle.dispose();
        queueLifecycle = createLifecycleScope();
        audioConvertFiles.replaceChildren();
        if (selectedAudioFiles.length > 0) {
          audioConvertFiles.classList.add('has-files');
        } else {
          audioConvertFiles.classList.remove('has-files');
        }
        selectedAudioFiles.forEach((file, index) => {
          const item = documentRef.createElement('div');
          item.className = 'audio-convert-file-item';
          item.dataset.sortIndex = String(index);
          const sizeText = Number(file.size) > 0 ? formatFileSize(file.size) : '';
          const order = documentRef.createElement('span');
          order.className = 'audio-convert-file-index';
          order.textContent = String(index + 1);
          const name = documentRef.createElement('span');
          name.className = 'audio-convert-file-name';
          name.textContent = file.name || '';
          item.append(order, name);
          if (sizeText) {
            const size = documentRef.createElement('span');
            size.className = 'audio-convert-file-size';
            size.textContent = sizeText;
            item.append(size);
          }
          const remove = documentRef.createElement('button');
          remove.className = 'audio-convert-file-remove';
          remove.dataset.audioConvertAction = 'remove';
          remove.dataset.index = String(index);
          remove.type = 'button';
          remove.setAttribute('aria-label', t('common.remove'));
          remove.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
          item.append(remove);
          audioConvertFiles.appendChild(item);
        });
        bindSortableFileList({ scope: queueLifecycle, container: audioConvertFiles, items: selectedAudioFiles, render: renderAudioFiles, isLocked: () => processingAudio });
        toggleAudioProcessButton();
      }

      function toggleAudioProcessButton() {
        if (!audioConvertProcessBtn) return;
        if (disposed) {
          if (processHideTimer !== null) clearTimeout(processHideTimer);
          processHideTimer = null;
          audioConvertProcessBtn.classList.remove('visible');
          audioConvertProcessBtn.style.display = 'none';
          return;
        }
        if (selectedAudioFiles.length > 0) {
          if (processHideTimer !== null) {
            clearTimeout(processHideTimer);
            processHideTimer = null;
          }
          audioConvertProcessBtn.style.display = '';
          const reveal = () => { if (!disposed) audioConvertProcessBtn.classList.add('visible'); };
          if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(reveal);
          else queueMicrotask(reveal);
        } else {
          audioConvertProcessBtn.classList.remove('visible');
          if (processHideTimer !== null) clearTimeout(processHideTimer);
          processHideTimer = setTimeout(() => {
            processHideTimer = null;
            if (!audioConvertProcessBtn.classList.contains('visible')) audioConvertProcessBtn.style.display = 'none';
          }, 320);
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

      if (audioConvertCta) {
        lifecycle.event(audioConvertCta, 'click', async () => {
          const revision = selectionRevision;
          if (isTauri) {
            try {
              const { open } = await loadDialog();
              const selected = await open({
                multiple: true,
                filters: [{
                  name: 'Audio Files',
                  extensions: ['mp3', 'aac', 'm4a', 'wav', 'flac', 'alac', 'ogg', 'wma']
                }]
              });
              if (selected) await addNativeAudioPaths(selected, revision);
            } catch (e) {
              console.error('Audio file selection error', e);
            }
          } else {
            const input = documentRef.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = 'audio/*';
            input.addEventListener('change', () => {
              if (!disposed && revision === selectionRevision && page?.classList.contains('visible')) addAudioFiles(input.files);
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
          notify(t('home.audioConvert.allFailed', { count: failCount }) + (errorDetails ? '\n\n' + errorDetails : ''));
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
          audioConvertSuccessPath.textContent = displayFilesystemPath(outputPath);
        }
        lastOutputPath = outputPath;
        audioConvertSuccessOverlay?.classList.add('visible');
      }

      function closeSuccessDialog() {
        if (audioConvertSuccessOverlay) {
          audioConvertSuccessOverlay.classList.remove('visible');
        }
        clearAudioFiles();
      }

      if (audioConvertCancelBtn) {
        lifecycle.event(audioConvertCancelBtn, 'click', cancelActiveAudioConversion);
      }

      function cancelActiveAudioConversion() {
        const wasProcessing = processingAudio;
        audioConversionRunId += 1;
        audioConvertUnlisten?.();
        audioConvertUnlisten = null;
        if (completionTimer !== null) {
          clearTimeout(completionTimer);
          completionTimer = null;
        }
        if (audioConvertProcessMask) audioConvertProcessMask.classList.remove('visible');
        if (audioConvertProcessBarFill) audioConvertProcessBarFill.style.width = '0%';
        processingAudio = false;
        if (isTauri && wasProcessing) {
          tauriCore
            .then(({ invoke }) => invoke('cancel_convert', { toolknitTaskTool: 'audio-convert' }))
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
          notify(selectionError(error));
          return;
        }
        const runId = ++audioConversionRunId;
        processingAudio = true;
        audioConvertProcessMask.classList.add('visible');
        audioConvertProcessBarFill.style.width = '0%';

        if (isTauri) {
          let unlisten = null;
          try {
            const { invoke } = await tauriCore;
            const { listen } = await tauriEvents;

            const finalOutputDir = await getOutputDir('Audio');

            // Collect file paths from selectedAudioFiles
            const inputPaths = selectedAudioFiles.map(f => f.path).filter(Boolean);
            if (inputPaths.length === 0) {
              console.error('No valid file paths were found in the audio selection.');
              if (runId === audioConversionRunId) {
                audioConvertProcessMask.classList.remove('visible');
                processingAudio = false;
              }
              notify(t('common.filePathsNotAvailable'));
              return;
            }

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

            const rawUnlisten = await listen('convert-progress', (event) => {
              if (runId !== audioConversionRunId) return;
              const data = event.payload;
              if (data.status === 'converting' || data.status === 'preparing') {
                const current = Math.max(1, Number(data.current) || 1);
                const total = Math.max(current, Number(data.total) || totalFiles);
                const progress = Math.min(1, Math.max(0, Number(data.progress) || 0));
                const fileProgress = (current - 1 + progress) / total;
                const percent = Math.min(99, Math.round(fileProgress * 100));
                audioConvertProcessBarFill.style.width = `${percent}%`;
                if (audioConvertProcessText) {
                  audioConvertProcessText.textContent = `${t('home.audioConvert.processing')} (${current}/${total})`;
                }
              }
            });
            let released = false;
            unlisten = () => {
              if (released) return;
              released = true;
              rawUnlisten?.();
            };
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

            const releaseProgressListener = unlisten;
            releaseProgressListener?.();
            if (audioConvertUnlisten === releaseProgressListener) audioConvertUnlisten = null;
            unlisten = null;
            if (runId !== audioConversionRunId) return;
            audioConvertProcessBarFill.style.width = '100%';

            completionTimer = setTimeout(() => {
              completionTimer = null;
              if (runId !== audioConversionRunId) return;
              audioConvertProcessMask.classList.remove('visible');
              audioConvertProcessBarFill.style.width = '0%';
              processingAudio = false;
              showSuccessDialog(result);
            }, 400);
          } catch (e) {
            console.error('Conversion failed:', e);
            unlisten?.();
            if (audioConvertUnlisten === unlisten) audioConvertUnlisten = null;
            if (runId !== audioConversionRunId) return;
            audioConvertProcessMask.classList.remove('visible');
            audioConvertProcessBarFill.style.width = '0%';
            processingAudio = false;
            if (audioConvertProcessText) {
              audioConvertProcessText.textContent = t('home.audioConvert.processing');
            }
            notify(t('common.errorOccurred', { error: e?.message || e }));
          }
        } else {
          audioConvertProcessMask.classList.remove('visible');
          audioConvertProcessBarFill.style.width = '0%';
          processingAudio = false;
          notify(t('home.audioConvert.desktopOnly'));
        }
      }

      if (audioConvertProcessBtn) {
        lifecycle.event(audioConvertProcessBtn, 'click', () => {
          if (selectedAudioFiles.length > 0) startAudioProcessing();
        });
      }

      if (audioConvertSuccessOk) {
        lifecycle.event(audioConvertSuccessOk, 'click', () => {
          closeSuccessDialog();
        });
      }

      let lastOutputPath = '';
      if (audioConvertOpenFolder) {
        lifecycle.event(audioConvertOpenFolder, 'click', () => {
          if (isTauri && lastOutputPath) {
            Promise.resolve(openOutputFolder(lastOutputPath)).catch(e => console.error('Open folder error', e));
          }
          closeSuccessDialog();
        });
      }

      if (audioConvertFormatOptions) {
        lifecycle.event(audioConvertFormatOptions, 'click', (e) => {
          const btn = e.target?.closest?.('.audio-convert-format-option');
          if (!btn) return;
          audioConvertFormatOptions.querySelectorAll('.audio-convert-format-option').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          targetAudioFormat = normalizeAudioTargetFormat(btn.dataset.format);
        });
      }

  function renderLocale() {
    if (disposed) return;
    refreshIcons();
  }

  function open() {
    if (disposed || !page) return;
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    page.classList.add('visible');
    if (plasmaBg && !plasmaInstance) plasmaInstance = initStandardToolPlasma?.(plasmaBg);
  }

  function close() {
    if (!page) return;
    cancelActiveAudioConversion();
    audioConvertSuccessOverlay?.classList.remove('visible');
    page.classList.remove('visible', 'drag-over');
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    hideAudioDropZone?.();
    if (plasmaInstance) { disposeStandardToolPlasma?.(plasmaInstance); plasmaInstance = null; }
    if (processHideTimer !== null) {
      clearTimeout(processHideTimer);
      processHideTimer = null;
    }
    clearAudioFiles?.();
  }

  function bindChrome() {
    const actionMap = {
      back: close,
      website: () => openExternalUrl?.('https://toolknit.com'),
      support: () => openSupport?.(),
      settings: () => openSettings?.()
    };
    page?.querySelectorAll('[data-audio-convert-action]').forEach(button => {
      const handler = actionMap[button.dataset.audioConvertAction];
      if (!handler) return;
      lifecycle.event(button, 'click', event => {
        event.stopPropagation();
        handler();
      });
    });
    page?.querySelectorAll('[data-window-action]').forEach(button => lifecycle.event(button, 'click', () => handleWindowAction?.(button.dataset.windowAction)));
    lifecycle.use(registerLanguageChange(renderLocale));
  }

  async function registerNativeDrop() {
    if (!isTauri || !page) return;
    try {
      const { getCurrentWebview } = await loadTauriWebview();
      const unlisten = await getCurrentWebview().onDragDropEvent(event => {
        if (disposed || !page.classList.contains('visible') || processingAudio) return;
        const payload = event?.payload || {};
        if (payload.type === 'enter' || payload.type === 'over') showAudioDropZone();
        else if (payload.type === 'leave') hideAudioDropZone();
        else if (payload.type === 'drop') {
          hideAudioDropZone();
          const paths = Array.isArray(payload.paths) ? payload.paths : [];
          const audioPaths = paths.filter(value => ['mp3','aac','m4a','wav','flac','alac','ogg','wma'].some(ext => String(value).toLowerCase().endsWith('.' + ext)));
          if (audioPaths.length) void addNativeAudioPaths(audioPaths);
        }
      });
      if (disposed) unlisten?.();
      else nativeDropUnlisten = unlisten;
    } catch (error) {
      console.warn('Cannot register audio convert drag and drop:', error);
    }
  }

  if (audioConvertFiles) {
    lifecycle.event(audioConvertFiles, 'click', event => {
      const button = event.target?.closest?.('[data-audio-convert-action="remove"]');
      if (!button || processingAudio) return;
      const index = Number(button.dataset.index);
      if (Number.isInteger(index) && index >= 0 && index < selectedAudioFiles.length) removeAudioFile(index);
    });
  }
  bindChrome();
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
