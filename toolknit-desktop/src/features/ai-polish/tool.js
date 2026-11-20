import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { AiProviderError, AI_PROVIDER_LIMITS } from '../../ai-provider-core.js';
import {
  AI_POLISH_LIMITS,
  AiPolishError,
  normalizeAiPolishedText,
  normalizeAiPolishDirections
} from '../../ai-polish-core.js';
import { onLangChange, t } from '../../i18n.js';
import { bindTextDocumentDrop } from '../../shared/text-document-drop.js';
import {
  readTextDocument,
  TEXT_DOCUMENT_EXTENSIONS,
  textDocumentErrorKey
} from '../../shared/text-document-reader.js';
import { TEXT_STATS_LIMITS } from '../../text-stats-core.js';
import '../ai-text/ai-text-shared.css';
import './ai-polish.css';


const EMPTY_SOURCE = Object.freeze({ type: 'manual', name: '', bytes: 0, kind: '' });
const REQUEST_TIMEOUT_MS = AI_PROVIDER_LIMITS.maxTimeoutMs;

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // WebView clipboard permissions can be unavailable.
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

export function initAiPolishTool({
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
  if (!overlay) throw new Error('ai-polish:missing-overlay');
  if (typeof requestAi !== 'function') throw new Error('ai-polish:missing-ai-request');
  if (typeof extractJson !== 'function') throw new Error('ai-polish:missing-json-extractor');

  const lifecycle = createLifecycleScope();
  const byId = id => document.getElementById(id);
  const background = byId('aiPolishBg');
  const back = byId('aiPolishBack');
  const dropZone = byId('aiPolishDropZone');
  const dropCard = byId('aiPolishDropCard');
  const cta = byId('aiPolishCta');
  const selectFileButton = byId('aiPolishSelectFileBtn');
  const fileInput = byId('aiPolishFileInput');
  const fileInfo = byId('aiPolishFileInfo');
  const fileName = byId('aiPolishFileName');
  const fileMeta = byId('aiPolishFileMeta');
  const startButton = byId('aiPolishStartBtn');
  const input = byId('aiPolishInput');
  const rightEmpty = byId('aiPolishRightEmpty');
  const drawer = byId('aiPolishDrawer');
  const directions = byId('aiPolishDirections');
  const directionList = byId('aiPolishDirectionList');
  const comparison = byId('aiPolishComparison');
  const polishedText = byId('aiPolishPolishedText');
  const mask = byId('aiPolishMask');
  const maskText = byId('aiPolishMaskText');
  const copyButton = byId('aiPolishCopyBtn');
  const cancelButton = byId('aiPolishCancelBtn');

  let source = { ...EMPTY_SOURCE };
  let directionsData = [];
  let originalContent = '';
  let resultMode = false;
  let plasma = null;
  let session = null;
  let directionScope = null;
  let requestController = null;
  let requestTimeout = 0;
  let requestId = 0;
  let readRunId = 0;
  let copyTimer = 0;
  let maskKey = '';

  const copy = (key, params) => t(`home.aiPolish.${key}`, params);
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
      icon?.setAttribute('data-lucide', 'sparkles');
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

  function clearDirectionBindings() {
    directionScope?.dispose();
    directionScope = null;
    if (directionList) directionList.replaceChildren();
  }

  function resetOutput() {
    clearDirectionBindings();
    if (rightEmpty) rightEmpty.style.display = '';
    if (directions) directions.style.display = 'none';
    if (comparison) comparison.style.display = 'none';
    if (polishedText) polishedText.textContent = '';
    drawer?.classList.remove('processing');
    resultMode = false;
    directionsData = [];
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
      const result = await readTextDocument(file, {
        isTauri,
        fallbackName: copy('document')
      });
      if (runId !== readRunId || !isCurrent(token)) return;
      let text = result.text || '';
      if (text.length > AI_POLISH_LIMITS.maxInputChars) {
        text = text.slice(0, AI_POLISH_LIMITS.maxInputChars);
        notify(copy('documentTrimmed', { max: AI_POLISH_LIMITS.maxInputChars }));
      }
      if (input) {
        input.value = text;
        input.focus();
      }
      updateSource({ type: 'file', name: result.name, bytes: result.bytes, kind: result.kind });
      resetOutput();
      notify(copy('fileLoaded', { name: result.name }));
    } catch (error) {
      if (runId !== readRunId || !isCurrent(token)) return;
      console.error('AI polish document read failed:', error);
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
      console.error('AI polish file picker failed:', error);
      notify(copy('readFailed'));
    }
  }

  function renderDirections() {
    clearDirectionBindings();
    if (!directionList || !directionsData.length) return;
    directionScope = createLifecycleScope();
    directionsData.forEach((direction, index) => {
      const button = document.createElement('button');
      button.className = 'ai-polish-direction-btn';
      const name = document.createElement('span');
      name.className = 'ai-polish-direction-btn-name';
      name.textContent = direction.name;
      const description = document.createElement('span');
      description.className = 'ai-polish-direction-btn-desc';
      description.textContent = direction.desc;
      button.append(name, description);
      directionScope.event(button, 'click', () => { void selectDirection(index); });
      directionList.appendChild(button);
    });
  }

  function reportRequestError(error, controller, timedOut, phase) {
    console.error(`[AI Polish] ${phase} error:`, error);
    if (controller.signal.aborted || error?.code === 'timeout') {
      if (timedOut || error?.code === 'timeout') alert(copy('requestTimeout'));
    } else if (error instanceof AiPolishError) {
      alert(copy(error.code === 'result_too_large' ? 'resultTooLarge' : 'parseError'));
    } else if (error instanceof AiProviderError) {
      alert(error.message);
    } else {
      alert(copy('networkError'));
    }
  }

  async function analyze() {
    const text = input?.value?.trim();
    if (!text) return;
    if (text.length > AI_POLISH_LIMITS.maxInputChars) {
      alert(copy('inputTooLong', { max: AI_POLISH_LIMITS.maxInputChars }));
      return;
    }
    if (requestController) return;
    const request = beginRequest();
    originalContent = text;
    showMask('analyzing');
    drawer?.classList.add('processing');
    try {
      const systemPrompt = '你是一位资深文字编辑专家，精通中文和英文写作，拥有丰富的润色经验。你擅长分析文本的语境、风格和意图，能够提供多种润色方向并精准执行。你的原则是：保持原文核心意思不变，提升表达的准确性、流畅性和美感。';
      const userPrompt = `请分析以下用户输入的文字，推理用户可能希望的润色方向。给出 3 个最合适的润色方向，每个方向包含：\n- 方向名称（简洁，2-6个字，如"正式商务"、"简洁精炼"、"生动活泼"）\n- 简短说明（一句话描述这个方向的特点）\n\n请以 JSON 格式返回：\n{"directions":[{"name":"方向名称","desc":"简短说明"},{"name":"方向名称","desc":"简短说明"},{"name":"方向名称","desc":"简短说明"}]}\n\n用户文字：\n${text}`;
      const content = await requestAi([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], request.controller.signal, undefined, { timeoutMs: REQUEST_TIMEOUT_MS, reasoningEffort: 'low' });
      if (request.id !== requestId || !isCurrent(request.token)) return;
      if (typeof content !== 'string' || !content.trim() || content.length > AI_POLISH_LIMITS.maxResponseChars) {
        throw new AiPolishError('result_too_large', 'AI response exceeds the supported size.');
      }
      const json = extractJson(content);
      if (!json) throw new AiPolishError('invalid_result', 'AI did not return directions JSON.');
      let parsed;
      try { parsed = JSON.parse(json); }
      catch { throw new AiPolishError('invalid_result', 'AI returned invalid directions JSON.'); }
      directionsData = normalizeAiPolishDirections(parsed);
      if (rightEmpty) rightEmpty.style.display = 'none';
      if (directions) directions.style.display = '';
      renderDirections();
    } catch (error) {
      if (request.id !== requestId || !isCurrent(request.token)) return;
      reportRequestError(error, request.controller, request.timedOut(), 'Analysis');
    } finally {
      if (finishRequest(request.id, request.token)) {
        hideMask();
        drawer?.classList.remove('processing');
      }
    }
  }

  async function selectDirection(index) {
    const direction = directionsData[index];
    if (!direction || requestController) return;
    const request = beginRequest();
    showMask('polishing');
    drawer?.classList.add('processing');
    try {
      const systemPrompt = '你是一位资深文字编辑专家，精通中文和英文写作，拥有丰富的润色经验。你的原则是：保持原文核心意思不变，提升表达的准确性、流畅性和美感。';
      const userPrompt = `请按照「${direction.name}」方向润色以下文字。\n要求：\n1. 保持原文核心意思不变\n2. ${direction.desc}\n3. 直接输出润色后的文字，不要添加任何解释或说明\n\n原文：\n${originalContent}`;
      const result = await requestAi([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], request.controller.signal, undefined, { timeoutMs: REQUEST_TIMEOUT_MS, reasoningEffort: 'low' });
      if (request.id !== requestId || !isCurrent(request.token)) return;
      const safeResult = normalizeAiPolishedText(result);
      clearDirectionBindings();
      if (directions) directions.style.display = 'none';
      if (comparison) comparison.style.display = '';
      if (polishedText) polishedText.textContent = safeResult;
      resultMode = true;
      refreshStartButton();
    } catch (error) {
      if (request.id !== requestId || !isCurrent(request.token)) return;
      reportRequestError(error, request.controller, request.timedOut(), 'Polish');
    } finally {
      if (finishRequest(request.id, request.token)) {
        hideMask();
        drawer?.classList.remove('processing');
      }
    }
  }

  async function copyResult() {
    const text = polishedText?.textContent || '';
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
      onError: error => console.error('AI polish drag registration failed:', error)
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
    if (resultMode) resetOutput();
    else void analyze();
  });
  bind(input, 'input', () => {
    if (input.value.length > AI_POLISH_LIMITS.maxInputChars) {
      input.value = input.value.slice(0, AI_POLISH_LIMITS.maxInputChars);
      notify(copy('inputTooLong', { max: AI_POLISH_LIMITS.maxInputChars }));
    }
    updateSource();
    if (resultMode && !requestController) resetOutput();
    else if (directionsData.length && !requestController) {
      directionsData = [];
      clearDirectionBindings();
      if (directions) directions.style.display = 'none';
      if (rightEmpty) rightEmpty.style.display = '';
    }
    refreshStartButton();
  });
  bind(copyButton, 'click', () => { void copyResult(); });
  bind(cancelButton, 'click', () => {
    clearDirectionBindings();
    directionsData = [];
    if (directions) directions.style.display = 'none';
    if (rightEmpty) rightEmpty.style.display = '';
  });
  lifecycle.use(onLangChange(() => {
    resetCopyFeedback();
    updateSource(source);
    refreshStartButton();
    if (maskKey && maskText) maskText.textContent = copy(maskKey);
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
