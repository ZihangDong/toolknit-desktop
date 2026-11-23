import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { AiProviderError, AI_PROVIDER_LIMITS } from '../../ai-provider-core.js';
import {
  AI_TRANSLATE_LIMITS,
  AiTranslateError,
  aiTranslateOriginalsMatch,
  detectAiTranslateSourceLanguage,
  normalizeAiTranslatePairs
} from '../../ai-translate-core.js';
import { onLangChange, t } from '../../i18n.js';
import { bindTextDocumentDrop } from '../../shared/text-document-drop.js';
import {
  readTextDocument,
  TEXT_DOCUMENT_EXTENSIONS,
  textDocumentErrorKey
} from '../../shared/text-document-reader.js';
import { TEXT_STATS_LIMITS } from '../../text-stats-core.js';
import '../ai-text/ai-text-shared.css';
import './ai-translate.css';


const EMPTY_SOURCE = Object.freeze({ type: 'manual', name: '', bytes: 0, kind: '' });
const REQUEST_TIMEOUT_MS = AI_PROVIDER_LIMITS.maxTimeoutMs;
const LANGUAGES = Object.freeze([
  { code: 'en', name: 'English', nativeNameKey: 'home.aiTranslate.langEnglish' },
  { code: 'zh', name: 'Chinese', nativeNameKey: 'home.aiTranslate.langChinese' },
  { code: 'ja', name: 'Japanese', nativeNameKey: 'home.aiTranslate.langJapanese' },
  { code: 'ko', name: 'Korean', nativeNameKey: 'home.aiTranslate.langKorean' },
  { code: 'fr', name: 'French', nativeNameKey: 'home.aiTranslate.langFrench' },
  { code: 'de', name: 'German', nativeNameKey: 'home.aiTranslate.langGerman' },
  { code: 'es', name: 'Spanish', nativeNameKey: 'home.aiTranslate.langSpanish' },
  { code: 'ru', name: 'Russian', nativeNameKey: 'home.aiTranslate.langRussian' },
  { code: 'pt', name: 'Portuguese', nativeNameKey: 'home.aiTranslate.langPortuguese' },
  { code: 'it', name: 'Italian', nativeNameKey: 'home.aiTranslate.langItalian' }
]);

async function writeClipboardText(text) {
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

export function initAiTranslateTool({
  overlay,
  isTauri = false,
  notify = () => {},
  formatFileSize = value => `${Number(value) || 0} B`,
  requestAi,
  extractJson,
  refreshIcons = () => {},
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = instance => instance
} = {}) {
  if (!overlay) throw new Error('ai-translate:missing-overlay');
  if (typeof requestAi !== 'function') throw new Error('ai-translate:missing-ai-request');
  if (typeof extractJson !== 'function') throw new Error('ai-translate:missing-json-extractor');

  const lifecycle = createLifecycleScope();
  const byId = id => document.getElementById(id);
  const background = byId('aiTranslateBg');
  const back = byId('aiTranslateBack');
  const dropZone = byId('aiTranslateDropZone');
  const dropCard = byId('aiTranslateDropCard');
  const cta = byId('aiTranslateCta');
  const selectFileButton = byId('aiTranslateSelectFileBtn');
  const fileInput = byId('aiTranslateFileInput');
  const fileInfo = byId('aiTranslateFileInfo');
  const fileName = byId('aiTranslateFileName');
  const fileMeta = byId('aiTranslateFileMeta');
  const startButton = byId('aiTranslateStartBtn');
  const input = byId('aiTranslateInput');
  const originalPreview = byId('aiTranslateOriginalPreview');
  const rightEmpty = byId('aiTranslateRightEmpty');
  const drawer = byId('aiTranslateDrawer');
  const languageSelect = byId('aiTranslateLangSelect');
  const languageList = byId('aiTranslateLangList');
  const comparison = byId('aiTranslateComparison');
  const result = byId('aiTranslateResult');
  const mask = byId('aiTranslateMask');
  const maskText = byId('aiTranslateMaskText');
  const copyButton = byId('aiTranslateCopyBtn');
  const cancelButton = byId('aiTranslateCancelBtn');

  let source = { ...EMPTY_SOURCE };
  let originalContent = '';
  let resultMode = false;
  let plasma = null;
  let session = null;
  let choiceScope = null;
  let resultScope = null;
  let requestController = null;
  let requestTimeout = 0;
  let requestId = 0;
  let readRunId = 0;
  let copyTimer = 0;
  let maskKey = '';
  const flashTimers = new Set();

  const copy = (key, params) => t(`home.aiTranslate.${key}`, params);
  const isCurrent = token => lifecycle.isCurrent(token) && overlay.classList.contains('visible');
  const bind = (target, type, listener) => target && lifecycle.event(target, type, listener);

  function updateSource(next = EMPTY_SOURCE) {
    source = { ...EMPTY_SOURCE, ...next };
    const manual = source.type === 'manual';
    fileInfo?.classList.toggle('has-file', !manual);
    if (fileName) fileName.textContent = manual ? copy('manualInput') : source.name;
    if (fileMeta) {
      fileMeta.textContent = manual
        ? copy('manualMeta')
        : copy('fileMeta', {
            type: source.kind || copy('document'),
            size: formatFileSize(source.bytes || 0)
          });
    }
  }

  function refreshStartButton() {
    if (!startButton) return;
    const label = startButton.querySelector('span');
    const icon = startButton.querySelector('i[data-lucide], svg[data-lucide]');
    if (resultMode) {
      startButton.classList.remove('disabled');
      if (label) label.textContent = copy('clearResult');
      icon?.setAttribute('data-lucide', 'rotate-ccw');
    } else {
      startButton.classList.toggle('disabled', !input?.value?.trim());
      if (label) label.textContent = copy('cta');
      icon?.setAttribute('data-lucide', 'languages');
    }
    refreshIcons();
  }

  function resetCopyFeedback() {
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = 0;
    copyButton?.classList.remove('copied');
    const icon = copyButton?.querySelector('i[data-lucide], svg[data-lucide]');
    icon?.setAttribute('data-lucide', 'copy');
    refreshIcons();
  }

  function clearFlashTimers() {
    for (const timer of flashTimers) clearTimeout(timer);
    flashTimers.clear();
    overlay.querySelectorAll('.copied-flash').forEach(element => element.classList.remove('copied-flash'));
  }

  function clearChoices() {
    choiceScope?.dispose();
    choiceScope = null;
    languageList?.replaceChildren();
  }

  function clearRenderedResult() {
    resultScope?.dispose();
    resultScope = null;
    clearFlashTimers();
    result?.replaceChildren();
    originalPreview?.replaceChildren();
  }

  function restoreInput() {
    if (input) input.style.display = '';
    if (originalPreview) originalPreview.style.display = 'none';
  }

  function resetOutput() {
    clearChoices();
    clearRenderedResult();
    restoreInput();
    if (rightEmpty) rightEmpty.style.display = '';
    if (languageSelect) languageSelect.style.display = 'none';
    if (comparison) comparison.style.display = 'none';
    drawer?.classList.remove('processing');
    resultMode = false;
    originalContent = '';
    refreshStartButton();
  }

  function showMask(key) {
    maskKey = key;
    if (maskText) maskText.textContent = copy(key);
    mask?.classList.add('visible');
  }

  function hideMask() {
    maskKey = '';
    mask?.classList.remove('visible');
  }

  function cancelRequest() {
    requestId += 1;
    if (requestTimeout) clearTimeout(requestTimeout);
    requestTimeout = 0;
    requestController?.abort();
    requestController = null;
  }

  function beginRequest() {
    const controller = new AbortController();
    const id = ++requestId;
    const token = lifecycle.token();
    let timedOut = false;
    requestController = controller;
    session?.use(() => controller.abort());
    requestTimeout = setTimeout(() => {
      if (id !== requestId || controller.signal.aborted) return;
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    return { controller, id, token, timedOut: () => timedOut };
  }

  function finishRequest(id, token) {
    if (id !== requestId || !isCurrent(token)) return false;
    if (requestTimeout) clearTimeout(requestTimeout);
    requestTimeout = 0;
    requestController = null;
    return true;
  }

  function documentErrorMessage(error) {
    const key = textDocumentErrorKey(error);
    if (key === 'fileTooLarge') {
      return copy(key, { max: Math.round(TEXT_STATS_LIMITS.maxDocumentBytes / 1024 / 1024) });
    }
    if (key === 'tooManyPdfPages') return copy(key, { max: TEXT_STATS_LIMITS.maxPdfPages });
    return copy(key);
  }

  async function loadDocument(file) {
    if (!file) return;
    const runId = ++readRunId;
    const token = lifecycle.token();
    cancelRequest();
    hideMask();
    overlay.classList.add('is-reading-file');
    try {
      const documentResult = await readTextDocument(file, {
        isTauri,
        fallbackName: copy('document')
      });
      if (runId !== readRunId || !isCurrent(token)) return;
      let text = documentResult.text || '';
      if (text.length > AI_TRANSLATE_LIMITS.maxInputChars) {
        text = text.slice(0, AI_TRANSLATE_LIMITS.maxInputChars);
        notify(copy('documentTrimmed', { max: AI_TRANSLATE_LIMITS.maxInputChars }));
      }
      if (input) {
        input.value = text;
        input.focus();
      }
      updateSource({
        type: 'file',
        name: documentResult.name,
        bytes: documentResult.bytes,
        kind: documentResult.kind
      });
      resetOutput();
      notify(copy('fileLoaded', { name: documentResult.name }));
    } catch (error) {
      if (runId !== readRunId || !isCurrent(token)) return;
      console.error('AI translate document read failed:', error);
      notify(documentErrorMessage(error));
    } finally {
      if (runId === readRunId && isCurrent(token)) overlay.classList.remove('is-reading-file');
      if (fileInput) fileInput.value = '';
    }
  }

  async function chooseDocument() {
    if (overlay.classList.contains('is-reading-file')) return;
    if (!isTauri) {
      fileInput?.click();
      return;
    }
    const token = lifecycle.token();
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Documents', extensions: [...TEXT_DOCUMENT_EXTENSIONS] }]
      });
      if (selected && isCurrent(token)) {
        await loadDocument({ path: selected, name: String(selected).split(/[/\\]/).pop() });
      }
    } catch (error) {
      if (!isCurrent(token)) return;
      console.error('AI translate file picker failed:', error);
      notify(copy('readFailed'));
    }
  }

  function renderLanguageChoices() {
    clearChoices();
    if (!languageList) return;
    choiceScope = createLifecycleScope();
    const detected = detectAiTranslateSourceLanguage(originalContent);
    for (const language of LANGUAGES) {
      if (detected && language.code === detected) continue;
      const button = document.createElement('button');
      button.className = 'ai-polish-direction-btn ai-translate-lang-btn';
      const nativeName = document.createElement('span');
      nativeName.className = 'ai-polish-direction-btn-name';
      nativeName.textContent = t(language.nativeNameKey);
      const englishName = document.createElement('span');
      englishName.className = 'ai-polish-direction-btn-desc';
      englishName.textContent = language.name;
      button.append(nativeName, englishName);
      choiceScope.event(button, 'click', () => { void translate(language); });
      languageList.appendChild(button);
    }
  }

  function showLanguageChoices() {
    if (rightEmpty) rightEmpty.style.display = 'none';
    if (languageSelect) languageSelect.style.display = '';
    renderLanguageChoices();
  }

  function flashSentence(element) {
    element.classList.add('copied-flash');
    const timer = setTimeout(() => {
      flashTimers.delete(timer);
      element.classList.remove('copied-flash');
    }, 600);
    flashTimers.add(timer);
  }

  async function copySentence(element, text) {
    if (!text) return;
    const token = lifecycle.token();
    try {
      await writeClipboardText(text);
      if (!isCurrent(token)) return;
      notify(copy('copied'));
      flashSentence(element);
    } catch {
      if (isCurrent(token)) notify(copy('copyFailed'));
    }
  }

  function appendSentences(container, pairs, field) {
    for (const pair of pairs) {
      const text = pair[field] || '';
      const sentence = document.createElement('span');
      sentence.className = 'ai-translate-sentence';
      sentence.textContent = text;
      sentence.title = copy('clickToCopy');
      resultScope.event(sentence, 'click', () => { void copySentence(sentence, text); });
      container.appendChild(sentence);
    }
  }

  function renderResult(pairs, sourceText) {
    clearChoices();
    clearRenderedResult();
    resultScope = createLifecycleScope();
    if (rightEmpty) rightEmpty.style.display = 'none';
    if (languageSelect) languageSelect.style.display = 'none';
    if (comparison) comparison.style.display = '';
    if (result) appendSentences(result, pairs, 'translated');
    if (input && originalPreview) {
      const sourcePairs = aiTranslateOriginalsMatch(sourceText, pairs)
        ? pairs
        : [{ original: sourceText, translated: '' }];
      appendSentences(originalPreview, sourcePairs, 'original');
      input.style.display = 'none';
      originalPreview.style.display = '';
    }
  }

  function reportRequestError(error, controller, timedOut) {
    console.error('[AI Translate] Error:', error);
    if (controller.signal.aborted || error?.code === 'timeout') {
      if (timedOut || error?.code === 'timeout') alert(copy('requestTimeout'));
    } else if (error instanceof AiTranslateError) {
      alert(copy(error.code === 'result_too_large' ? 'resultTooLarge' : 'parseError'));
    } else if (error instanceof AiProviderError) {
      alert(error.message);
    } else {
      alert(copy('networkError'));
    }
  }

  async function translate(language) {
    if (!originalContent || requestController) return;
    if (originalContent.length > AI_TRANSLATE_LIMITS.maxInputChars) {
      alert(copy('inputTooLong', { max: AI_TRANSLATE_LIMITS.maxInputChars }));
      return;
    }
    const request = beginRequest();
    if (languageSelect) languageSelect.style.display = 'none';
    showMask('translating');
    drawer?.classList.add('processing');
    try {
      const systemPrompt = '你是一位专业翻译专家，精通多种语言。你的原则是：准确传达原文意思，保持语境和语气一致。你需要逐句翻译，并返回JSON格式的句子对照。';
      const userPrompt = `请将以下文字翻译为${t(language.nativeNameKey)}（${language.name}）。\n要求：\n1. 逐句翻译，保持句子对应关系\n2. 准确传达原文意思和语气\n3. 以JSON格式返回：{"pairs":[{"original":"原文句子1","translated":"译文句子1"},{"original":"原文句子2","translated":"译文句子2"}]}\n4. 每个句子应该是一个完整的意群\n\n原文：\n${originalContent}`;
      const content = await requestAi([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], request.controller.signal, undefined, { timeoutMs: REQUEST_TIMEOUT_MS, reasoningEffort: 'low' });
      if (request.id !== requestId || !isCurrent(request.token)) return;
      if (typeof content !== 'string' || !content.trim()) {
        throw new AiTranslateError('invalid_result', 'AI returned an empty response.');
      }
      if (content.length > AI_TRANSLATE_LIMITS.maxResponseChars) {
        throw new AiTranslateError('result_too_large', 'AI response exceeds the supported size.');
      }
      const json = extractJson(content);
      if (!json) throw new AiTranslateError('invalid_result', 'AI did not return translation JSON.');
      let parsed;
      try { parsed = JSON.parse(json); }
      catch { throw new AiTranslateError('invalid_result', 'AI returned invalid translation JSON.'); }
      const pairs = normalizeAiTranslatePairs(parsed);
      renderResult(pairs, originalContent);
      resultMode = true;
      refreshStartButton();
    } catch (error) {
      if (request.id !== requestId || !isCurrent(request.token)) return;
      reportRequestError(error, request.controller, request.timedOut());
    } finally {
      if (finishRequest(request.id, request.token)) {
        hideMask();
        drawer?.classList.remove('processing');
      }
    }
  }

  async function copyResult() {
    const text = result?.textContent || '';
    if (!text) return;
    const token = lifecycle.token();
    try {
      await writeClipboardText(text);
      if (!isCurrent(token)) return;
      notify(copy('copied'));
      resetCopyFeedback();
      copyButton?.classList.add('copied');
      const icon = copyButton?.querySelector('i[data-lucide], svg[data-lucide]');
      icon?.setAttribute('data-lucide', 'check');
      refreshIcons();
      copyTimer = setTimeout(resetCopyFeedback, 2000);
    } catch {
      if (isCurrent(token)) notify(copy('copyFailed'));
    }
  }

  function resetState() {
    cancelRequest();
    hideMask();
    resetCopyFeedback();
    if (input) input.value = '';
    if (fileInput) fileInput.value = '';
    overlay.classList.remove('is-reading-file', 'drag-over');
    dropZone?.classList.remove('visible');
    dropCard?.classList.remove('is-dragging');
    updateSource();
    resetOutput();
  }

  function startSession() {
    session?.dispose();
    session = createLifecycleScope();
    bindTextDocumentDrop({
      lifecycle: session,
      overlay,
      dropZone,
      dropCard,
      isTauri,
      onFile: loadDocument,
      onError: error => console.error('AI translate drag registration failed:', error)
    });
  }

  bind(back, 'click', () => { void api.close(); });
  bind(cta, 'click', () => { void chooseDocument(); });
  bind(selectFileButton, 'click', () => { void chooseDocument(); });
  bind(fileInput, 'change', event => {
    const file = event.target.files?.[0];
    if (file) void loadDocument(file);
  });
  bind(startButton, 'click', () => {
    if (resultMode) {
      resetOutput();
      return;
    }
    const text = input?.value?.trim();
    if (!text) return;
    if (text.length > AI_TRANSLATE_LIMITS.maxInputChars) {
      alert(copy('inputTooLong', { max: AI_TRANSLATE_LIMITS.maxInputChars }));
      return;
    }
    originalContent = text;
    showLanguageChoices();
  });
  bind(input, 'input', () => {
    if (input.value.length > AI_TRANSLATE_LIMITS.maxInputChars) {
      input.value = input.value.slice(0, AI_TRANSLATE_LIMITS.maxInputChars);
      notify(copy('inputTooLong', { max: AI_TRANSLATE_LIMITS.maxInputChars }));
    }
    updateSource();
    if (resultMode && !requestController) resetOutput();
    else if (originalContent && input.value.trim() !== originalContent) {
      originalContent = '';
      clearChoices();
      if (languageSelect) languageSelect.style.display = 'none';
      if (rightEmpty) rightEmpty.style.display = '';
    }
    refreshStartButton();
  });
  bind(copyButton, 'click', () => { void copyResult(); });
  bind(cancelButton, 'click', () => {
    clearChoices();
    if (languageSelect) languageSelect.style.display = 'none';
    if (rightEmpty) rightEmpty.style.display = '';
  });
  lifecycle.use(onLangChange(() => {
    resetCopyFeedback();
    clearFlashTimers();
    updateSource(source);
    refreshStartButton();
    if (maskKey && maskText) maskText.textContent = copy(maskKey);
    if (languageSelect?.style.display !== 'none' && originalContent) renderLanguageChoices();
    overlay.querySelectorAll('.ai-translate-sentence').forEach(sentence => {
      sentence.title = copy('clickToCopy');
    });
  }));

  const api = {
    open() {
      lifecycle.invalidate();
      readRunId += 1;
      overlay.classList.add('visible');
      overlay.setAttribute('aria-hidden', 'false');
      resetState();
      startSession();
      if (background && !plasma) plasma = initStandardToolPlasma(background);
      session.timeout(() => {
        if (overlay.classList.contains('visible')) input?.focus();
      }, 300);
    },
    close() {
      lifecycle.invalidate();
      readRunId += 1;
      session?.dispose();
      session = null;
      resetState();
      overlay.classList.remove('visible');
      overlay.setAttribute('aria-hidden', 'true');
      plasma = disposeStandardToolPlasma(plasma);
    },
    dispose() {
      api.close();
      lifecycle.dispose();
    }
  };

  return api;
}
