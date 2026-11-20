import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { onLangChange, t } from '../../i18n.js';
import { copySensitiveText } from '../../platform/clipboard-runtime.js';
import {
  assessPasswordStrength,
  countPasswordComposition,
  generatePassword
} from './core.js';
import '../../styles/components/calculator-form.css';
import './password-generator.css';


const COPY_FEEDBACK_MS = 1500;

export function initPasswordGeneratorTool({
  overlay,
  isTauri = false,
  notify = message => window.showToast?.(message),
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = () => null
} = {}) {
  if (!overlay) throw new Error('password-generator:missing-overlay');

  const lifecycle = createLifecycleScope();
  const q = selector => overlay.querySelector(selector);
  const back = q('#passwordGenBack');
  const background = q('#passwordGenBg');
  const strengthTabs = q('#passwordGenStrengthTabs');
  const strengthDescription = q('#passwordGenStrengthDesc');
  const generateButton = q('#passwordGenBtn');
  const resultEmpty = q('#passwordGenResultEmpty');
  const resultContent = q('#passwordGenResultContent');
  const output = q('#passwordGenOutput');
  const copyButton = q('#passwordGenCopyBtn');
  const strengthText = q('#passwordGenStrengthText');
  const strengthFill = q('#passwordGenStrengthFill');
  const historyList = q('#passwordGenHistoryList');
  const clearButton = q('#passwordGenClearBtn');
  const lengthSlider = q('#passwordGenLengthSlider');
  const lengthValue = q('#passwordGenLengthValue');
  const stats = {
    total: q('#passwordGenStatTotal'),
    letters: q('#passwordGenStatLetters'),
    numbers: q('#passwordGenStatNumbers'),
    symbols: q('#passwordGenStatSymbols')
  };

  let strength = 'simple';
  let backgroundInstance = null;
  let history = [];
  let currentStrength = null;
  let generationFrame = 0;
  const feedbackTimers = new Set();

  function clearFeedbackTimers() {
    for (const timer of feedbackTimers) clearTimeout(timer);
    feedbackTimers.clear();
  }

  function clearTransientTasks() {
    if (generationFrame) cancelAnimationFrame(generationFrame);
    generationFrame = 0;
    clearFeedbackTimers();
    if (generateButton) generateButton.disabled = false;
  }

  lifecycle.use(clearTransientTasks);

  function renderComposition(password = '') {
    const composition = countPasswordComposition(password);
    for (const [key, element] of Object.entries(stats)) {
      if (element) element.textContent = String(composition[key]);
    }
  }

  function clearSensitiveContent() {
    history = [];
    currentStrength = null;
    if (output) output.textContent = '';
    if (copyButton) copyButton.textContent = t('home.passwordGen.copy');
    if (strengthText) strengthText.textContent = '--';
    if (strengthFill) {
      strengthFill.style.width = '0';
      strengthFill.style.background = '';
    }
    historyList?.replaceChildren();
    if (resultEmpty) resultEmpty.style.display = '';
    if (resultContent) resultContent.style.display = 'none';
    renderComposition('');
  }

  function getOptions() {
    return {
      uppercase: Boolean(q('#passwordGenUppercase')?.checked),
      lowercase: Boolean(q('#passwordGenLowercase')?.checked),
      numbers: Boolean(q('#passwordGenNumbers')?.checked),
      symbols: Boolean(q('#passwordGenSymbols')?.checked),
      excludeSimilar: Boolean(q('#passwordGenExcludeSimilar')?.checked)
    };
  }

  function renderHistory() {
    if (!historyList) return;
    historyList.replaceChildren();
    history.forEach((password, index) => {
      const item = document.createElement('div');
      item.className = 'password-gen-history-item';
      const text = document.createElement('span');
      text.style.flex = '1';
      text.textContent = password;
      const itemCopyButton = document.createElement('button');
      itemCopyButton.className = 'password-gen-history-item-copy';
      itemCopyButton.type = 'button';
      itemCopyButton.dataset.passwordHistoryIndex = String(index);
      itemCopyButton.textContent = t('home.passwordGen.copy');
      item.append(text, itemCopyButton);
      historyList.appendChild(item);
    });
  }

  function renderStrength() {
    if (!currentStrength) return;
    if (strengthText) strengthText.textContent = t(`home.passwordGen.${currentStrength.label}`);
  }

  function renderPresetDescription() {
    if (!strengthDescription) return;
    const key = strength === 'simple'
      ? 'simpleDesc'
      : strength === 'medium'
        ? 'mediumDesc'
        : 'ultimateDesc';
    strengthDescription.textContent = t(`home.passwordGen.${key}`);
  }

  function generate() {
    const length = Number.parseInt(lengthSlider?.value || '16', 10);
    let generated;
    try {
      generated = generatePassword({ length, ...getOptions() });
    } catch {
      if (resultEmpty) resultEmpty.style.display = '';
      if (resultContent) resultContent.style.display = 'none';
      notify(t('home.passwordGen.generateFailed'));
      return;
    }

    const { password, charsetSize } = generated;
    if (resultEmpty) resultEmpty.style.display = 'none';
    if (resultContent) resultContent.style.display = '';
    if (output) output.textContent = password;

    currentStrength = assessPasswordStrength(password.length, charsetSize);
    renderStrength();
    if (strengthFill) {
      strengthFill.style.width = `${currentStrength.percent}%`;
      strengthFill.style.background = currentStrength.color;
    }
    renderComposition(password);

    history.unshift(password);
    if (history.length > 10) history.pop();
    renderHistory();
  }

  function applyStrengthPreset(nextStrength) {
    const uppercase = q('#passwordGenUppercase');
    const lowercase = q('#passwordGenLowercase');
    const numbers = q('#passwordGenNumbers');
    const symbols = q('#passwordGenSymbols');
    const excludeSimilar = q('#passwordGenExcludeSimilar');

    if (nextStrength === 'simple') {
      if (lowercase) lowercase.checked = true;
      if (numbers) numbers.checked = true;
      if (uppercase) uppercase.checked = false;
      if (symbols) symbols.checked = false;
      if (excludeSimilar) excludeSimilar.checked = false;
      if (lengthSlider) lengthSlider.value = '8';
    } else if (nextStrength === 'medium') {
      if (uppercase) uppercase.checked = true;
      if (lowercase) lowercase.checked = true;
      if (numbers) numbers.checked = true;
      if (symbols) symbols.checked = false;
      if (excludeSimilar) excludeSimilar.checked = false;
      if (lengthSlider) lengthSlider.value = '16';
    } else {
      if (uppercase) uppercase.checked = true;
      if (lowercase) lowercase.checked = true;
      if (numbers) numbers.checked = true;
      if (symbols) symbols.checked = true;
      if (excludeSimilar) excludeSimilar.checked = true;
      if (lengthSlider) lengthSlider.value = '24';
    }
    renderPresetDescription();
    if (lengthValue) lengthValue.textContent = lengthSlider?.value || '16';
  }

  function scheduleCopyReset(button, token) {
    const timer = setTimeout(() => {
      feedbackTimers.delete(timer);
      if (lifecycle.isCurrent(token) && button.isConnected) {
        button.textContent = t('home.passwordGen.copy');
      }
    }, COPY_FEEDBACK_MS);
    feedbackTimers.add(timer);
  }

  async function copyPassword(password, button) {
    if (!password || (!isTauri && !navigator.clipboard?.writeText)) {
      notify(t('home.passwordGen.copyFailed'));
      return;
    }
    const token = lifecycle.token();
    try {
      await copySensitiveText(password, { isTauri });
      if (!lifecycle.isCurrent(token) || !overlay.classList.contains('visible')) return;
      button.textContent = t('home.passwordGen.copied');
      scheduleCopyReset(button, token);
    } catch {
      if (lifecycle.isCurrent(token)) notify(t('home.passwordGen.copyFailed'));
    }
  }

  lifecycle.event(back, 'click', () => api.close());
  lifecycle.event(strengthTabs, 'click', event => {
    const tab = event.target.closest('[data-strength]');
    if (!tab || !strengthTabs.contains(tab)) return;
    strengthTabs.querySelectorAll('.password-gen-strength-tab').forEach(item => item.classList.toggle('active', item === tab));
    strength = tab.dataset.strength;
    applyStrengthPreset(strength);
  });
  lifecycle.event(lengthSlider, 'input', () => {
    if (lengthValue) lengthValue.textContent = lengthSlider.value;
  });
  lifecycle.event(generateButton, 'click', () => {
    generateButton.disabled = true;
    const token = lifecycle.token();
    generationFrame = requestAnimationFrame(() => {
      generationFrame = 0;
      if (!lifecycle.isCurrent(token)) return;
      generate();
      generateButton.disabled = false;
    });
  });
  lifecycle.event(copyButton, 'click', () => {
    void copyPassword(output?.textContent || '', copyButton);
  });
  lifecycle.event(clearButton, 'click', clearSensitiveContent);
  lifecycle.event(historyList, 'click', event => {
    const button = event.target.closest('[data-password-history-index]');
    if (!button || !historyList.contains(button)) return;
    const password = history[Number(button.dataset.passwordHistoryIndex)] || '';
    void copyPassword(password, button);
  });
  lifecycle.use(onLangChange(() => {
    renderPresetDescription();
    renderStrength();
    renderHistory();
  }));

  const api = {
    open() {
      lifecycle.invalidate();
      clearTransientTasks();
      overlay.classList.add('visible');
      overlay.setAttribute('aria-hidden', 'false');
      if (background && !backgroundInstance) backgroundInstance = initStandardToolPlasma(background);
      strength = 'simple';
      strengthTabs?.querySelectorAll('.password-gen-strength-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.strength === 'simple');
      });
      applyStrengthPreset(strength);
      clearSensitiveContent();
    },
    close() {
      lifecycle.invalidate();
      clearTransientTasks();
      clearSensitiveContent();
      overlay.classList.remove('visible');
      overlay.setAttribute('aria-hidden', 'true');
      backgroundInstance = disposeStandardToolPlasma(backgroundInstance);
    },
    dispose() {
      api.close();
      lifecycle.dispose();
    }
  };

  return api;
}
