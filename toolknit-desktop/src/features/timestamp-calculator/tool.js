import '../../styles/components/calculator-form.css';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { onLangChange, t } from '../../i18n.js';
import { formatLocalDate, formatUtcDate, getRelativeTime, pad2, parseTimestamp } from './core.js';
import './timestamp-calculator.css';

const COPY_FEEDBACK_MS = 1500;

export function initTimestampCalculatorTool({
  overlay,
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = () => null
} = {}) {
  if (!overlay) throw new Error('timestamp-calculator:missing-overlay');

  const lifecycle = createLifecycleScope();
  const q = selector => overlay.querySelector(selector);
  const back = q('#tsCalcBack');
  const background = q('#tsCalcBg');
  const modeTabs = q('#tsCalcModeTabs');
  const timestampForm = q('#tsCalcTs2DateForm');
  const dateForm = q('#tsCalcDate2TsForm');
  const timestampInput = q('#tsCalcInput');
  const dateInput = q('#tsCalcDateInput');
  const timestampFormats = q('#tsCalcFormatTabs');
  const dateFormats = q('#tsCalcFormatTabs2');
  const resultEmpty = q('#tsCalcResultEmpty');
  const resultContent = q('#tsCalcResultContent');
  const resultValue = q('#tsCalcResultValue');
  const resultLabel = q('#tsCalcResultLabel');
  const detailLocal = q('#tsCalcDetailLocal');
  const detailUtc = q('#tsCalcDetailUtc');
  const detailRelative = q('#tsCalcDetailRelative');
  const nowSeconds = q('#tsCalcNowSec');
  const nowMilliseconds = q('#tsCalcNowMs');

  let mode = 'ts2date';
  let timestampFormat = 'local';
  let dateFormat = 'unix';
  let backgroundInstance = null;
  let nowTimer = 0;
  const copyTimers = new Map();

  function clearCopyTimers() {
    for (const timer of copyTimers.values()) clearTimeout(timer);
    copyTimers.clear();
  }

  function stopClock() {
    if (nowTimer) clearInterval(nowTimer);
    nowTimer = 0;
  }

  lifecycle.use(() => {
    stopClock();
    clearCopyTimers();
  });

  function relative(timestamp) {
    return getRelativeTime(timestamp, Date.now() / 1000, {
      now: t('home.timestampCalc.now'),
      secondAgo: t('home.timestampCalc.secAgo'),
      secondLater: t('home.timestampCalc.secLater'),
      minuteAgo: t('home.timestampCalc.minAgo'),
      minuteLater: t('home.timestampCalc.minLater'),
      hourAgo: t('home.timestampCalc.hourAgo'),
      hourLater: t('home.timestampCalc.hourLater'),
      dayAgo: t('home.timestampCalc.dayAgo'),
      dayLater: t('home.timestampCalc.dayLater')
    });
  }

  function updateClock() {
    const milliseconds = Date.now();
    if (nowSeconds) nowSeconds.textContent = String(Math.floor(milliseconds / 1000));
    if (nowMilliseconds) nowMilliseconds.textContent = String(milliseconds);
  }

  function showEmpty() {
    if (resultEmpty) resultEmpty.style.display = '';
    if (resultContent) resultContent.style.display = 'none';
    if (resultValue) resultValue.textContent = '--';
    if (detailLocal) detailLocal.textContent = '--';
    if (detailUtc) detailUtc.textContent = '--';
    if (detailRelative) detailRelative.textContent = '--';
  }

  function renderTimestampResult(parsed) {
    const date = new Date(parsed.ts * 1000);
    if (Number.isNaN(date.getTime())) return showEmpty();
    if (resultEmpty) resultEmpty.style.display = 'none';
    if (resultContent) resultContent.style.display = '';
    const values = {
      local: formatLocalDate(date),
      utc: `${formatUtcDate(date)} UTC`,
      iso: date.toISOString(),
      relative: relative(parsed.ts)
    };
    if (resultValue) resultValue.textContent = values[timestampFormat] || values.local;
    if (resultLabel) resultLabel.textContent = t(`home.timestampCalc.${{ local: 'localTime', utc: 'utcTime', iso: 'iso', relative: 'relativeTime' }[timestampFormat] || 'localTime'}`);
    if (detailLocal) detailLocal.textContent = values.local;
    if (detailUtc) detailUtc.textContent = values.utc;
    if (detailRelative) detailRelative.textContent = relative(parsed.ts);
  }

  function renderDateResult() {
    if (!dateInput?.value) return showEmpty();
    const date = new Date(dateInput.value);
    if (Number.isNaN(date.getTime())) return showEmpty();
    if (resultEmpty) resultEmpty.style.display = 'none';
    if (resultContent) resultContent.style.display = '';
    const seconds = Math.floor(date.getTime() / 1000);
    const values = { unix: String(seconds), ms: String(date.getTime()), iso: date.toISOString() };
    if (resultValue) resultValue.textContent = values[dateFormat] || values.unix;
    if (resultLabel) resultLabel.textContent = t('home.timestampCalc.resultLabel');
    if (detailLocal) detailLocal.textContent = formatLocalDate(date);
    if (detailUtc) detailUtc.textContent = `${formatUtcDate(date)} UTC`;
    if (detailRelative) detailRelative.textContent = relative(seconds);
  }

  function renderResult() {
    if (mode === 'ts2date') {
      const parsed = parseTimestamp(timestampInput?.value);
      if (!parsed) return showEmpty();
      renderTimestampResult(parsed);
    } else {
      renderDateResult();
    }
  }

  function setDefaultDate() {
    const now = new Date();
    if (dateInput) dateInput.value = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}T${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  }

  function copyValue(value, button) {
    if (!value || value === '--' || !navigator.clipboard?.writeText) return;
    const token = lifecycle.token();
    navigator.clipboard.writeText(value).then(() => {
      if (!lifecycle.isCurrent(token) || !overlay.classList.contains('visible')) return;
      const original = button.dataset.originalText || button.textContent;
      button.dataset.originalText = original;
      button.textContent = t('home.timestampCalc.copied');
      clearTimeout(copyTimers.get(button));
      const timer = setTimeout(() => {
        copyTimers.delete(button);
        if (lifecycle.isCurrent(token) && button.isConnected) button.textContent = button.dataset.originalText || t('home.timestampCalc.copy');
      }, COPY_FEEDBACK_MS);
      copyTimers.set(button, timer);
    }).catch(() => {});
  }

  lifecycle.event(back, 'click', () => api.close());
  lifecycle.event(modeTabs, 'click', event => {
    const button = event.target.closest('[data-mode]');
    if (!button || !modeTabs.contains(button)) return;
    mode = button.dataset.mode;
    modeTabs.querySelectorAll('[data-mode]').forEach(item => item.classList.toggle('active', item === button));
    if (timestampForm) timestampForm.style.display = mode === 'ts2date' ? '' : 'none';
    if (dateForm) dateForm.style.display = mode === 'date2ts' ? '' : 'none';
    renderResult();
  });
  lifecycle.event(timestampFormats, 'click', event => {
    const button = event.target.closest('[data-fmt]');
    if (!button || !timestampFormats.contains(button)) return;
    timestampFormat = button.dataset.fmt;
    timestampFormats.querySelectorAll('[data-fmt]').forEach(item => item.classList.toggle('active', item === button));
    renderResult();
  });
  lifecycle.event(dateFormats, 'click', event => {
    const button = event.target.closest('[data-fmt]');
    if (!button || !dateFormats.contains(button)) return;
    dateFormat = button.dataset.fmt;
    dateFormats.querySelectorAll('[data-fmt]').forEach(item => item.classList.toggle('active', item === button));
    renderResult();
  });
  lifecycle.event(timestampInput, 'input', renderResult);
  lifecycle.event(dateInput, 'input', renderResult);
  lifecycle.event(dateInput, 'change', renderResult);
  lifecycle.event(overlay, 'click', event => {
    const button = event.target.closest('.ts-calc-copy-btn');
    if (!button || !overlay.contains(button)) return;
    const value = button.id === 'tsCalcCopyNowSec' ? nowSeconds?.textContent : button.id === 'tsCalcCopyNowMs' ? nowMilliseconds?.textContent : resultValue?.textContent;
    copyValue(value, button);
  });
  lifecycle.use(onLangChange(() => {
    renderResult();
    overlay.querySelectorAll('.ts-calc-copy-btn').forEach(button => {
      if (!button.dataset.originalText || button.textContent !== t('home.timestampCalc.copied')) button.textContent = t('home.timestampCalc.copy');
      button.dataset.originalText = t('home.timestampCalc.copy');
    });
  }));

  const api = {
    open() {
      lifecycle.invalidate();
      stopClock();
      clearCopyTimers();
      overlay.classList.add('visible');
      overlay.setAttribute('aria-hidden', 'false');
      if (background && !backgroundInstance) backgroundInstance = initStandardToolPlasma(background);
      mode = 'ts2date';
      timestampFormat = 'local';
      dateFormat = 'unix';
      modeTabs?.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
      timestampFormats?.querySelectorAll('[data-fmt]').forEach(button => button.classList.toggle('active', button.dataset.fmt === timestampFormat));
      dateFormats?.querySelectorAll('[data-fmt]').forEach(button => button.classList.toggle('active', button.dataset.fmt === dateFormat));
      if (timestampForm) timestampForm.style.display = '';
      if (dateForm) dateForm.style.display = 'none';
      if (timestampInput) timestampInput.value = '';
      setDefaultDate();
      updateClock();
      nowTimer = setInterval(updateClock, 1000);
      showEmpty();
    },
    close() {
      lifecycle.invalidate();
      stopClock();
      clearCopyTimers();
      if (timestampInput) timestampInput.value = '';
      if (dateInput) dateInput.value = '';
      showEmpty();
      overlay.classList.remove('visible');
      overlay.setAttribute('aria-hidden', 'true');
      backgroundInstance = disposeStandardToolPlasma(backgroundInstance);
      overlay.querySelectorAll('.ts-calc-copy-btn').forEach(button => {
        button.textContent = t('home.timestampCalc.copy');
        delete button.dataset.originalText;
      });
    },
    dispose() {
      api.close();
      lifecycle.dispose();
    }
  };

  return api;
}
