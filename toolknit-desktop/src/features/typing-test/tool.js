import typingWordsData from '../../data/typing-words.json';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { getLang, onLangChange } from '../../i18n.js';
import {
  calculateTypingStats,
  compareTypingInput,
  createTypingWordPools,
  generateTypingText,
  getTypingRating,
  normalizeTypingValue
} from './core.js';
import './typing-test.css';


const WORD_POOLS = createTypingWordPools(typingWordsData);

export function initTypingTestTool({
  overlay,
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = instance => instance
} = {}) {
  if (!overlay) throw new Error('typing-test:missing-overlay');
  const lifecycle = createLifecycleScope();
  const q = selector => overlay.querySelector(selector);
  const back = q('#typingTestBack');
  const background = q('#typingTestBg');
  const body = q('#typingTestBody');
  const settings = q('#typingTestSettings');
  const area = q('#typingTestArea');
  const result = q('#typingTestResult');
  const text = q('#typingTestText');
  const input = q('#typingTestInput');
  const startButton = q('#typingTestStartBtn');
  const resetButton = q('#typingTestResetBtn');
  const againButton = q('#typingTestAgainBtn');
  const resultBackButton = q('#typingTestBackBtn');
  const timeValue = q('#typingTestTime');
  const wpmValue = q('#typingTestWpm');
  const accuracyValue = q('#typingTestAccuracy');
  const languageOptions = q('#typingTestLangOptions');
  const difficultyOptions = q('#typingTestDifficultyOptions');
  const durationOptions = q('#typingTestDurationOptions');
  const resultWpm = q('#typingTestResultWpm');
  const resultCpm = q('#typingTestResultCpm');
  const resultAccuracy = q('#typingTestResultAccuracy');
  const resultCorrect = q('#typingTestResultCorrect');
  const resultWrong = q('#typingTestResultWrong');
  const resultRating = q('#typingTestResultRating');

  let plasma = null;
  let timer = 0;
  let audioContext = null;
  let composing = false;
  let zhInputBuffer = '';
  const deferredTasks = new Set();
  const state = {
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
    backspaceCount: 0
  };

  function clearTimer() {
    if (timer) clearInterval(timer);
    timer = 0;
  }

  function clearDeferredTasks() {
    for (const task of deferredTasks) clearTimeout(task);
    deferredTasks.clear();
  }

  async function disposeAudioContext() {
    const context = audioContext;
    audioContext = null;
    if (context && context.state !== 'closed') {
      try { await context.close(); } catch { /* WebView may close first */ }
    }
  }

  lifecycle.use(() => {
    clearTimer();
    clearDeferredTasks();
    void disposeAudioContext();
  });

  function getAudioContext() {
    if (audioContext?.state === 'closed') audioContext = null;
    if (!audioContext) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      audioContext = new AudioContext();
    }
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
    return audioContext;
  }

  function playSound({ type, startFrequency, endFrequency, duration }) {
    try {
      const context = getAudioContext();
      if (!context) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(startFrequency, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, context.currentTime + duration);
      gain.gain.setValueAtTime(0.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.addEventListener('ended', () => {
        try { oscillator.disconnect(); } catch { /* already disconnected */ }
        try { gain.disconnect(); } catch { /* already disconnected */ }
      }, { once: true });
      oscillator.start(context.currentTime);
      oscillator.stop(context.currentTime + duration);
    } catch {
      // Audio feedback is optional and must never stop the typing test.
    }
  }

  function renderText() {
    if (!text) return;
    text.replaceChildren();
    const normalizedTarget = normalizeTypingValue(state.targetText);
    const normalizedInput = normalizeTypingValue(state.input);
    text.classList.toggle('segmented-mode', true);
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let currentPlaced = false;
    for (const segment of state.targetText.trim().split(/\s+/).filter(Boolean)) {
      const segmentElement = document.createElement('span');
      segmentElement.className = 'typing-test-segment';
      for (const character of segment) {
        const characterElement = document.createElement('span');
        characterElement.className = 'typing-test-char';
        characterElement.textContent = character;
        if (normalizedInput[cursor] != null) {
          characterElement.classList.add(normalizedInput[cursor] === normalizedTarget[cursor] ? 'correct' : 'wrong');
        } else if (!currentPlaced && cursor === normalizedInput.length) {
          characterElement.classList.add('current');
          currentPlaced = true;
        }
        segmentElement.append(characterElement);
        cursor += 1;
      }
      fragment.append(segmentElement);
    }
    if (normalizedInput.length > normalizedTarget.length) {
      const extra = document.createElement('span');
      extra.className = 'typing-test-segment typing-test-extra-segment';
      for (const character of normalizedInput.slice(normalizedTarget.length)) {
        const characterElement = document.createElement('span');
        characterElement.className = 'typing-test-char extra';
        characterElement.textContent = character;
        extra.append(characterElement);
      }
      fragment.append(extra);
    }
    text.append(fragment);
  }

  function currentStats() {
    return calculateTypingStats({
      correctCount: state.correctCount,
      totalCharCount: state.totalCharCount || state.input.length,
      startTime: state.startTime
    });
  }

  function updateStats() {
    const stats = currentStats();
    if (timeValue) timeValue.textContent = String(state.timeLeft);
    if (wpmValue) wpmValue.textContent = String(stats.wpm);
    if (accuracyValue) accuracyValue.textContent = `${stats.accuracy}%`;
    timeValue?.classList.toggle('warning', state.timeLeft <= 10);
    return stats;
  }

  function showResult() {
    const stats = currentStats();
    if (area) area.style.display = 'none';
    if (result) result.style.display = '';
    if (resultWpm) resultWpm.textContent = String(stats.wpm);
    if (resultCpm) resultCpm.textContent = String(stats.cpm);
    if (resultAccuracy) resultAccuracy.textContent = `${stats.accuracy}%`;
    if (resultCorrect) resultCorrect.textContent = String(state.correctCount);
    if (resultWrong) resultWrong.textContent = String(state.wrongCount);
    if (resultRating) resultRating.textContent = getTypingRating(stats.wpm, state.lang);
  }

  function endTest() {
    if (!state.isRunning) return;
    state.isRunning = false;
    state.isFinished = true;
    clearTimer();
    input?.blur();
    showResult();
  }

  function startTest() {
    clearTimer();
    clearDeferredTasks();
    state.targetText = generateTypingText(WORD_POOLS, state.lang, state.difficulty);
    state.input = '';
    state.startTime = 0;
    state.timeLeft = state.duration;
    state.isRunning = false;
    state.isFinished = false;
    state.correctCount = 0;
    state.wrongCount = 0;
    state.totalCharCount = 0;
    state.backspaceCount = 0;
    composing = false;
    zhInputBuffer = '';
    if (settings) settings.style.display = 'none';
    if (result) result.style.display = 'none';
    if (area) area.style.display = '';
    if (timeValue) timeValue.classList.remove('warning');
    if (wpmValue) wpmValue.textContent = '0';
    if (accuracyValue) accuracyValue.textContent = '100%';
    updateStats();
    renderText();
    if (input) {
      input.value = '';
      input.focus();
    }
  }

  function resetToSettings() {
    clearTimer();
    clearDeferredTasks();
    state.isRunning = false;
    state.isFinished = false;
    composing = false;
    zhInputBuffer = '';
    if (input) input.value = '';
    if (area) area.style.display = 'none';
    if (result) result.style.display = 'none';
    if (settings) settings.style.display = '';
  }

  function selectOption(container, value) {
    container?.querySelectorAll('.typing-test-option').forEach(button => {
      button.classList.toggle('active', button.dataset.value === String(value));
    });
  }

  function handleInput() {
    if (!input || state.isFinished || composing) return;
    const rawValue = state.lang === 'zh' ? zhInputBuffer : input.value;
    const previousLength = normalizeTypingValue(state.input).length;
    const comparison = compareTypingInput(state.targetText, rawValue);
    state.input = rawValue;
    state.correctCount = comparison.correctCount;
    state.wrongCount = comparison.wrongCount;
    state.totalCharCount = comparison.totalCharCount;
    if (!state.isRunning && comparison.normalizedInput.length > 0) {
      state.isRunning = true;
      state.startTime = Date.now();
      timer = setInterval(() => {
        state.timeLeft -= 1;
        updateStats();
        if (state.timeLeft <= 0) endTest();
      }, 1000);
    }
    if (!state.isRunning) return;
    if (comparison.normalizedInput.length > previousLength) {
      const lastIndex = comparison.normalizedInput.length - 1;
      playSound(comparison.normalizedInput[lastIndex] === comparison.normalizedTarget[lastIndex]
        ? { type: 'sine', startFrequency: 1200, endFrequency: 600, duration: 0.06 }
        : { type: 'triangle', startFrequency: 300, endFrequency: 150, duration: 0.1 });
    }
    renderText();
    updateStats();
    if (comparison.complete) endTest();
  }

  lifecycle.event(startButton, 'click', startTest);
  lifecycle.event(resetButton, 'click', startTest);
  lifecycle.event(againButton, 'click', startTest);
  lifecycle.event(resultBackButton, 'click', resetToSettings);
  lifecycle.event(back, 'click', () => { void api.close(); });
  lifecycle.event(input, 'input', event => {
    if (event.isComposing || composing) return;
    if (state.lang === 'zh') {
      const cleanData = normalizeTypingValue(input.value);
      if (cleanData) zhInputBuffer += cleanData;
      input.value = '';
    }
    handleInput();
  });
  lifecycle.event(input, 'keydown', event => {
    if (state.lang !== 'zh' || composing) return;
    if (event.key === 'Backspace' && zhInputBuffer.length > 0) {
      zhInputBuffer = zhInputBuffer.slice(0, -1);
      input.value = '';
      handleInput();
    }
  });
  lifecycle.event(input, 'compositionstart', () => { composing = true; });
  lifecycle.event(input, 'compositionend', event => {
    composing = false;
    if (state.lang === 'zh') {
      const cleanData = normalizeTypingValue(event.data || input.value);
      if (cleanData) zhInputBuffer += cleanData;
      input.value = '';
      handleInput();
      return;
    }
    const token = lifecycle.token();
    const task = setTimeout(() => {
      deferredTasks.delete(task);
      if (lifecycle.isCurrent(token)) handleInput();
    }, 0);
    deferredTasks.add(task);
  });
  lifecycle.event(body, 'click', () => {
    if (!state.isFinished && area?.style.display !== 'none') input?.focus();
  });
  lifecycle.event(languageOptions, 'click', event => {
    const button = event.target.closest('.typing-test-option');
    if (!button || !languageOptions.contains(button)) return;
    state.lang = button.dataset.value;
    selectOption(languageOptions, state.lang);
  });
  lifecycle.event(difficultyOptions, 'click', event => {
    const button = event.target.closest('.typing-test-option');
    if (!button || !difficultyOptions.contains(button)) return;
    state.difficulty = button.dataset.value;
    selectOption(difficultyOptions, state.difficulty);
  });
  lifecycle.event(durationOptions, 'click', event => {
    const button = event.target.closest('.typing-test-option');
    if (!button || !durationOptions.contains(button)) return;
    state.duration = Number.parseInt(button.dataset.value, 10);
    selectOption(durationOptions, state.duration);
  });
  lifecycle.use(onLangChange(() => {
    if (!state.isRunning && settings?.style.display !== 'none') {
      state.lang = getLang() === 'zh' ? 'zh' : 'en';
      selectOption(languageOptions, state.lang);
    }
  }));

  const api = {
    open() {
      lifecycle.invalidate();
      clearTimer();
      clearDeferredTasks();
      overlay.classList.add('visible');
      overlay.setAttribute('aria-hidden', 'false');
      state.lang = getLang() === 'zh' ? 'zh' : 'en';
      selectOption(languageOptions, state.lang);
      resetToSettings();
      if (background && !plasma) plasma = initStandardToolPlasma(background);
    },
    async close() {
      lifecycle.invalidate();
      clearTimer();
      clearDeferredTasks();
      state.isRunning = false;
      state.isFinished = false;
      composing = false;
      zhInputBuffer = '';
      if (input) input.value = '';
      overlay.classList.remove('visible');
      overlay.setAttribute('aria-hidden', 'true');
      await disposeAudioContext();
      plasma = disposeStandardToolPlasma(plasma);
    },
    async dispose() {
      await api.close();
      lifecycle.dispose();
    }
  };

  return api;
}
