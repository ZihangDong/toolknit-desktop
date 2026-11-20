import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { AiProviderError, AI_PROVIDER_LIMITS } from '../../ai-provider-core.js';
import {
  AI_TABLE_LIMITS,
  AiTableDataError,
  compactAiTableHistoryMessage,
  isAiTableResponseReady,
  normalizeAiTableData
} from '../../ai-table-core.js';
import { createSerializedRequestSession } from '../../core/serialized-request-session.js';
import { t } from '../../i18n.js';
import { createAiTableEditor } from './editor.js';
import { createAiTableExporter } from './exporter.js';
import {
  AI_TABLE_DEMO_DATA,
  AI_TABLE_PRESET_PROMPTS,
  AI_TABLE_SYSTEM_PROMPT
} from './prompts.js';
import '../ai-workbench/ai-workbench-shared.css';
import './ai-table.css';
import '../../styles/components/ai-workbench.css';


const REQUEST_TIMEOUT_MS = AI_PROVIDER_LIMITS.maxTimeoutMs;

function appendToolKnitAvatar(container, alt) {
  const image = document.createElement('img');
  image.src = '/assets/toolknit-icon.png';
  image.alt = alt;
  image.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
  container.replaceChildren(image);
}

export function initAiTableTool({
  overlay,
  isTauri = false,
  requestAi,
  extractJson,
  getOutputDir,
  displayFilesystemPath,
  fillUserAvatar = container => appendToolKnitAvatar(container, 'ToolKnit'),
  openHelp = () => {},
  refreshIcons = () => {},
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = instance => instance
} = {}) {
  if (!overlay) throw new Error('ai-table:missing-overlay');
  if (typeof requestAi !== 'function') throw new Error('ai-table:missing-ai-request');
  if (typeof extractJson !== 'function') throw new Error('ai-table:missing-json-extractor');
  if (typeof getOutputDir !== 'function') throw new Error('ai-table:missing-output-directory');

  const lifecycle = createLifecycleScope();
  const byId = id => document.getElementById(id);
  const back = byId('aiTableBack');
  const background = byId('aiTableBg');
  const messages = byId('aiTableChatMessages');
  const input = byId('aiTableChatInput');
  const sendButton = byId('aiTableChatSend');
  const empty = byId('aiTableCanvasEmpty');
  const previewScroll = byId('aiTablePreviewScroll');
  const toolbar = byId('aiTableCanvasToolbar');
  const undoButton = byId('aiTableUndoBtn');
  const resetButton = byId('aiTableResetBtn');
  const mask = byId('aiTableMask');
  const maskText = byId('aiTableMaskText');
  const isDemo = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get('ai-table-demo') === '1';
  const requests = createSerializedRequestSession({ timeoutMs: REQUEST_TIMEOUT_MS });
  let session = null;
  let messageScope = null;
  let history = [];
  let plasma = null;
  let exporter = null;

  const bind = (target, type, listener, options) => target
    && lifecycle.event(target, type, listener, options);
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
    if (sendButton) sendButton.disabled = !input?.value?.trim() || requests.busy;
  }

  function appendHistory(role, content) {
    const compact = compactAiTableHistoryMessage(content);
    if (!compact) return;
    history = [...history, { role, content: compact }].slice(-AI_TABLE_LIMITS.maxHistoryMessages);
  }

  function addChatMessage(role, text, link = false) {
    if (!messages) return null;
    const message = document.createElement('div');
    message.className = `ai-doc-chat-msg ai-doc-chat-msg-${role}`;
    const avatar = document.createElement('div');
    avatar.className = 'ai-doc-chat-avatar';
    if (role === 'ai') appendToolKnitAvatar(avatar, 'AI');
    else fillUserAvatar(avatar);
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
    for (const preset of AI_TABLE_PRESET_PROMPTS) {
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

  const editor = createAiTableEditor({
    empty,
    scroll: previewScroll,
    toolbar,
    undoButton,
    addChatMessage,
    openHelp,
    refreshIcons
  });

  exporter = createAiTableExporter({
    isTauri,
    isDemo,
    getData: editor.getData,
    getChartEntries: editor.getChartEntries,
    waitForCharts: editor.waitForCharts,
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

  function resetState() {
    cancelRequest();
    hideMask();
    history = [];
    messageScope?.dispose();
    messageScope = createLifecycleScope();
    editor.reset();
    messages?.replaceChildren();
    addChatMessage('ai', t('home.aiTable.welcome'));
    addPromptChips();
    if (input) input.value = '';
    updateInputState();
  }

  async function send() {
    const prompt = input?.value?.trim();
    if (!prompt || requests.busy) return;
    if (prompt.length > AI_TABLE_LIMITS.maxPromptChars) {
      addChatMessage('ai', t('home.aiTable.promptTooLong', { max: AI_TABLE_LIMITS.maxPromptChars }));
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
    showMask(t('home.aiTable.thinking'));

    try {
      const content = await requestAi([
        { role: 'system', content: AI_TABLE_SYSTEM_PROMPT },
        ...history.map(message => ({
          role: message.role === 'user' ? 'user' : 'assistant',
          content: message.content
        }))
      ], request.signal, 8192, { timeoutMs: REQUEST_TIMEOUT_MS, reasoningEffort: 'low' });
      if (!isCurrent(owner, request.id)) return;
      if (typeof content !== 'string' || !content.trim()) {
        throw new AiTableDataError('invalid_table', 'AI returned an empty response.');
      }
      if (content.length > AI_TABLE_LIMITS.maxResponseChars) {
        throw new AiTableDataError('table_too_large', 'AI response exceeds the supported size.');
      }
      const json = extractJson(content);
      if (!json) {
        const response = compactAiTableHistoryMessage(content);
        addChatMessage('ai', response);
        appendHistory('assistant', response);
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(json);
      } catch (error) {
        console.error('[AI Table] JSON parse failed:', error?.name || 'SyntaxError');
        try {
          parsed = JSON.parse(json.replace(/[\u0000-\u001F\uFEFF\uFFFD]/g, ' ').replace(/\n/g, '\\n'));
        } catch {
          addChatMessage('ai', t('home.aiTable.parseError'));
          return;
        }
      }

      if (parsed.ready === false && parsed.question) {
        const question = compactAiTableHistoryMessage(parsed.question);
        if (!question) throw new AiTableDataError('invalid_table', 'AI question is empty.');
        addChatMessage('ai', question);
        appendHistory('assistant', question);
        return;
      }
      if (!isAiTableResponseReady(parsed)) {
        console.warn('[AI Table] response schema is missing required fields.');
        addChatMessage('ai', t('home.aiTable.parseError'));
        return;
      }

      const normalized = normalizeAiTableData(parsed);
      const summary = normalized.summary || t('home.aiTable.summaryFallback');
      const bubble = addChatMessage(
        'ai',
        `${summary}\n\n${t('home.aiTable.afterGenerateGuide')}`,
        true
      );
      appendHistory('assistant', `${summary} ${t('home.aiTable.afterGenerateGuide')}`);
      if (bubble) messageScope.event(bubble, 'click', () => editor.scrollIntoView());
      editor.setData(normalized);
    } catch (error) {
      if (!isCurrent(owner, request.id)) return;
      console.error('[AI Table] Error:', error);
      if (request.signal.aborted || error.code === 'timeout') {
        if (request.timedOut() || error.code === 'timeout') addChatMessage('ai', t('home.aiTable.requestTimeout'));
      } else if (error instanceof AiTableDataError) {
        addChatMessage('ai', error.code === 'table_too_large'
          ? t('home.aiTable.tableTooLarge')
          : t('home.aiTable.parseError'));
      } else if (error instanceof AiProviderError) {
        addChatMessage('ai', error.message);
      } else {
        addChatMessage('ai', t('home.aiTable.errNetwork'));
      }
    } finally {
      if (isCurrent(owner, request.id) && requests.finish(request.id)) {
        hideMask();
        updateInputState();
      }
      releaseRequest();
    }
  }

  bind(back, 'click', () => api.close());
  bind(undoButton, 'click', editor.undo);
  bind(resetButton, 'click', resetState);
  bind(sendButton, 'click', () => { void send(); });
  bind(input, 'keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void send();
  });
  bind(input, 'input', updateInputState);
  bind(messages, 'click', event => {
    const chip = event.target.closest('.ai-doc-prompt-chip');
    if (!chip || !input) return;
    input.value = chip.dataset.prompt || '';
    input.focus();
    updateInputState();
  });

  const api = {
    open() {
      session?.dispose();
      session = createLifecycleScope();
      overlay.classList.add('visible');
      overlay.setAttribute('aria-hidden', 'false');
      editor.open();
      exporter.open();
      resetState();
      if (background && !plasma) plasma = initStandardToolPlasma(background);
      if (isDemo) editor.setData(normalizeAiTableData(AI_TABLE_DEMO_DATA));
    },
    close() {
      cancelRequest();
      session?.dispose();
      session = null;
      messageScope?.dispose();
      messageScope = null;
      editor.close();
      exporter.close();
      history = [];
      messages?.replaceChildren();
      if (input) input.value = '';
      updateInputState();
      hideMask();
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
