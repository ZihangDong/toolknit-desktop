import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { AiProviderError, AI_PROVIDER_LIMITS } from '../../ai-provider-core.js';
import {
  AI_DOC_LIMITS,
  AiDocLayoutError,
  compactAiDocHistoryMessage,
  normalizeAiDocLayout
} from '../../ai-doc-core.js';
import { t } from '../../i18n.js';
import { createAiDocumentEditor } from './editor.js';
import { createAiDocumentExporter } from './exporter.js';
import { createAiDocumentPreview } from './preview.js';
import {
  AI_DOC_EDITOR_DEMO_LAYOUT,
  AI_DOC_PRESET_PROMPTS,
  AI_DOC_SYSTEM_PROMPT
} from './prompts.js';
import { createAiDocumentRequestSession } from './request-session.js';
import '../ai-workbench/ai-workbench-shared.css';
import './ai-document.css';
import './ai-document-editor.css';
import '../../styles/components/ai-workbench.css';


const REQUEST_TIMEOUT_MS = AI_PROVIDER_LIMITS.maxTimeoutMs;

function appendToolKnitAvatar(container, alt) {
  const image = document.createElement('img');
  image.src = '/assets/toolknit-icon.png';
  image.alt = alt;
  image.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
  container.replaceChildren(image);
}

export function initAiDocumentTool({
  overlay,
  isTauri = false,
  requestAi,
  extractJson,
  getOutputDir,
  displayFilesystemPath,
  refreshIcons = () => {},
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = instance => instance
} = {}) {
  if (!overlay) throw new Error('ai-document:missing-overlay');
  if (typeof requestAi !== 'function') throw new Error('ai-document:missing-ai-request');
  if (typeof extractJson !== 'function') throw new Error('ai-document:missing-json-extractor');
  if (typeof getOutputDir !== 'function') throw new Error('ai-document:missing-output-directory');

  const lifecycle = createLifecycleScope();
  const byId = id => document.getElementById(id);
  const back = byId('aiDocBack');
  const background = byId('aiDocBg');
  const messages = byId('aiDocChatMessages');
  const input = byId('aiDocChatInput');
  const sendButton = byId('aiDocChatSend');
  const empty = byId('aiDocCanvasEmpty');
  const thumbScroll = byId('aiDocThumbScroll');
  const canvasToolbar = byId('aiDocCanvasToolbar');
  const exportButton = byId('aiDocExportBtn');
  const openEditorButton = byId('aiDocOpenEditorBtn');
  const resetButton = byId('aiDocResetBtn');
  const previewMeta = byId('aiDocPreviewMeta');
  const inputCounter = byId('aiDocInputCounter');
  const mask = byId('aiDocMask');
  const maskText = byId('aiDocMaskText');
  const isEditorDemo = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get('ai-doc-editor-demo') === '1';

  let session = null;
  let plasma = null;
  let history = [];
  let exporter = null;
  let messageScope = null;
  const requests = createAiDocumentRequestSession({ timeoutMs: REQUEST_TIMEOUT_MS });

  const bind = (target, type, listener, options) => target && lifecycle.event(target, type, listener, options);
  const isOpenSession = owner => owner && owner === session && !owner.disposed
    && overlay.classList.contains('visible');
  const isCurrent = (owner, id) => isOpenSession(owner) && requests.isCurrent(id);

  function showMask(message) {
    if (maskText) maskText.textContent = message;
    mask?.classList.add('visible');
  }

  function hideMask() {
    mask?.classList.remove('visible');
  }

  function updateInputState() {
    const length = input?.value?.length || 0;
    if (inputCounter) inputCounter.textContent = `${length} / ${AI_DOC_LIMITS.maxPromptChars}`;
    if (sendButton) sendButton.disabled = !input?.value?.trim() || requests.busy;
  }

  function appendHistory(role, content) {
    const compact = compactAiDocHistoryMessage(content);
    if (!compact) return;
    history = [...history, { role, content: compact }].slice(-AI_DOC_LIMITS.maxHistoryMessages);
  }

  function addChatMessage(role, text, link = false) {
    if (!messages) return null;
    const message = document.createElement('div');
    message.className = `ai-doc-chat-msg ai-doc-chat-msg-${role}`;
    const avatar = document.createElement('div');
    avatar.className = 'ai-doc-chat-avatar';
    appendToolKnitAvatar(avatar, role === 'ai' ? 'AI' : 'ToolKnit');
    const bubble = document.createElement('div');
    bubble.className = 'ai-doc-chat-bubble';
    if (link) bubble.classList.add('ai-doc-gen-link');
    bubble.textContent = text;
    message.append(avatar, bubble);
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
    refreshIcons();
    return bubble;
  }

  function addPromptChips() {
    if (!messages) return;
    const message = document.createElement('div');
    message.className = 'ai-doc-chat-msg ai-doc-chat-msg-ai';
    const avatar = document.createElement('div');
    avatar.className = 'ai-doc-chat-avatar';
    appendToolKnitAvatar(avatar, 'AI');
    const bubble = document.createElement('div');
    bubble.className = 'ai-doc-chat-bubble ai-doc-chip-bubble';
    const title = document.createElement('div');
    title.className = 'ai-doc-chip-title';
    title.textContent = t('home.aiDoc.chipTitle');
    const chips = document.createElement('div');
    chips.className = 'ai-doc-prompt-chips';
    for (const preset of AI_DOC_PRESET_PROMPTS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'ai-doc-prompt-chip';
      chip.textContent = t(preset.labelKey);
      chip.dataset.prompt = preset.prompt;
      chips.appendChild(chip);
    }
    bubble.append(title, chips);
    message.append(avatar, bubble);
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
  }

  const preview = createAiDocumentPreview({
    empty,
    scroll: thumbScroll,
    toolbar: canvasToolbar,
    meta: previewMeta,
    t,
    openEditor: () => editor.open(),
    refreshIcons
  });

  const editor = createAiDocumentEditor({
    isTauri,
    addChatMessage,
    refreshIcons,
    initStandardToolPlasma,
    disposeStandardToolPlasma,
    onExport: () => exporter?.exportPdf(),
    onClose: layout => preview.render(layout)
  });

  exporter = createAiDocumentExporter({
    isTauri,
    isEditorDemo,
    getLayout: editor.getLayout,
    getOutputDir,
    displayFilesystemPath,
    showMask,
    hideMask,
    reportError: message => addChatMessage('ai', message)
  });

  function cancelRequest() {
    requests.cancel();
    updateInputState();
  }

  function finishRequest(owner, id) {
    if (!isCurrent(owner, id)) return false;
    return requests.finish(id);
  }

  function resetState() {
    cancelRequest();
    hideMask();
    history = [];
    messageScope?.dispose();
    messageScope = createLifecycleScope();
    editor.reset();
    preview.clear();
    messages?.replaceChildren();
    addChatMessage('ai', t('home.aiDoc.welcome'));
    addPromptChips();
    if (input) input.value = '';
    updateInputState();
  }

  function layoutErrorKey(error) {
    return {
      response_too_large: 'home.aiDoc.responseTooLarge',
      too_many_pages: 'home.aiDoc.tooManyPages',
      too_many_regions: 'home.aiDoc.tooManyRegions',
      region_text_too_large: 'home.aiDoc.regionTextTooLarge',
      field_text_too_large: 'home.aiDoc.regionTextTooLarge',
      document_text_too_large: 'home.aiDoc.documentTextTooLarge'
    }[error.code] || 'home.aiDoc.parseError';
  }

  async function send() {
    const prompt = input?.value?.trim();
    if (!prompt || requests.busy) return;
    if (prompt.length > AI_DOC_LIMITS.maxPromptChars) {
      addChatMessage('ai', t('home.aiDoc.promptTooLong', { max: AI_DOC_LIMITS.maxPromptChars }));
      return;
    }
    const owner = session;
    if (!isOpenSession(owner)) return;
    const request = requests.begin();
    if (!request) return;
    const releaseRequest = owner.use(() => requests.cancel(request.id));
    addChatMessage('user', prompt);
    input.value = '';
    appendHistory('user', prompt);
    updateInputState();
    showMask(t('home.aiDoc.thinking'));

    try {
      const content = await requestAi([
        { role: 'system', content: AI_DOC_SYSTEM_PROMPT },
        ...history.map(message => ({
          role: message.role === 'user' ? 'user' : 'assistant',
          content: message.content
        }))
      ], request.signal, 8192, { timeoutMs: REQUEST_TIMEOUT_MS, reasoningEffort: 'low', diagnostics: true });
      if (!isCurrent(owner, request.id)) return;
      if (typeof content !== 'string' || !content.trim()) {
        throw new AiDocLayoutError('invalid_layout', 'AI returned an empty response.');
      }
      if (content.length > AI_DOC_LIMITS.maxResponseChars) {
        throw new AiDocLayoutError('response_too_large', 'AI response exceeds the supported size.');
      }
      const json = extractJson(content);
      if (!json) {
        const response = compactAiDocHistoryMessage(content);
        addChatMessage('ai', response);
        appendHistory('assistant', response);
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(json);
      } catch (error) {
        console.error('[AI Doc] JSON parse failed:', error?.name || 'SyntaxError');
        try {
          parsed = JSON.parse(json.replace(/[\u0000-\u001F\uFEFF\uFFFD]/g, ' ').replace(/\n/g, '\\n'));
        } catch {
          addChatMessage('ai', t('home.aiDoc.parseError'));
          return;
        }
      }
      if (parsed.ready === false && parsed.question) {
        const question = compactAiDocHistoryMessage(parsed.question);
        if (!question) throw new AiDocLayoutError('invalid_layout', 'AI question is empty.');
        addChatMessage('ai', question);
        appendHistory('assistant', question);
        return;
      }
      if (parsed.ready !== true
        && !(parsed.ready === undefined && Array.isArray(parsed.columns) && Array.isArray(parsed.rows))) {
        console.warn('[AI Doc] response schema is missing ready/pages.');
        addChatMessage('ai', t('home.aiDoc.parseError'));
        return;
      }
      const normalized = normalizeAiDocLayout(parsed);
      const summary = normalized.summary || t('home.aiDoc.docReady');
      const bubble = addChatMessage('ai', summary, true);
      const prepared = editor.setLayout(normalized);
      appendHistory('assistant', `文档已生成：${summary}。后续如需修改，请说明要调整的内容。`);
      if (bubble) messageScope.event(bubble, 'click', () => editor.open());
      preview.render(prepared);
    } catch (error) {
      if (!isCurrent(owner, request.id)) return;
      console.error('[AI Doc] Error:', error);
      if (error instanceof AiProviderError && error.diagnostics) {
        console.error('[AI Doc] API diagnostics:', JSON.stringify(error.diagnostics, null, 2));
      }
      if (request.signal.aborted || error.code === 'timeout') {
        if (request.timedOut() || error.code === 'timeout') addChatMessage('ai', t('home.aiDoc.requestTimeout'));
      } else if (error instanceof AiDocLayoutError) {
        addChatMessage('ai', t(layoutErrorKey(error)));
      } else if (error instanceof AiProviderError) {
        addChatMessage('ai', error.message);
      } else {
        addChatMessage('ai', t('home.aiDoc.networkError'));
      }
    } finally {
      if (finishRequest(owner, request.id)) {
        hideMask();
        updateInputState();
      }
      releaseRequest();
    }
  }

  bind(back, 'click', () => api.close());
  bind(sendButton, 'click', () => { void send(); });
  bind(messages, 'click', event => {
    const chip = event.target.closest('.ai-doc-prompt-chip');
    if (!chip || !input) return;
    input.value = chip.dataset.prompt || '';
    input.focus();
    updateInputState();
  });
  bind(input, 'keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void send();
  });
  bind(input, 'input', updateInputState);
  bind(exportButton, 'click', () => { void exporter.exportPdf(); });
  bind(openEditorButton, 'click', () => editor.open());
  bind(resetButton, 'click', resetState);

  const api = {
    open() {
      session?.dispose();
      session = createLifecycleScope();
      overlay.classList.add('visible');
      overlay.setAttribute('aria-hidden', 'false');
      exporter.open();
      resetState();
      if (background && !plasma) plasma = initStandardToolPlasma(background);
      if (isEditorDemo) {
        const prepared = editor.setLayout(normalizeAiDocLayout(AI_DOC_EDITOR_DEMO_LAYOUT));
        preview.render(prepared);
        const frame = requestAnimationFrame(() => {
          if (isOpenSession(session)) editor.open();
        });
        session.use(() => cancelAnimationFrame(frame));
      }
    },
    close() {
      cancelRequest();
      session?.dispose();
      session = null;
      messageScope?.dispose();
      messageScope = null;
      editor.reset();
      exporter.close();
      preview.clear();
      hideMask();
      history = [];
      messages?.replaceChildren();
      if (input) input.value = '';
      updateInputState();
      overlay.classList.remove('visible');
      overlay.setAttribute('aria-hidden', 'true');
      plasma = disposeStandardToolPlasma(plasma);
    },
    dispose() {
      api.close();
      editor.dispose();
      exporter.dispose();
      lifecycle.dispose();
    }
  };

  return api;
}
