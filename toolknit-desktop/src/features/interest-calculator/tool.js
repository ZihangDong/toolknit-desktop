import '../../styles/components/calculator-form.css';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { onLangChange, t } from '../../i18n.js';
import { calculateInterest, formatInterestMoney } from './core.js';
import './interest-calculator.css';

export function initInterestCalculatorTool({
  overlay,
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = instance => instance
} = {}) {
  if (!overlay) throw new Error('interest-calculator:missing-overlay');
  const lifecycle = createLifecycleScope();
  const q = selector => overlay.querySelector(selector);
  const back = q('#interestCalcBack');
  const background = q('#interestCalcBg');
  const modeTabs = q('#interestCalcModeTabs');
  const frequencyTabs = q('#interestCalcFreqTabs');
  const calculateButton = q('#interestCalcBtn');
  const resultEmpty = q('#interestCalcResultEmpty');
  const resultContent = q('#interestCalcResultContent');
  const scheduleBody = q('#interestCalcScheduleBody');
  const principalField = q('#interestCalcPrincipalField');
  const recurringField = q('#interestCalcRegularField');
  const frequencyField = q('#interestCalcFreqField');
  let mode = 'simple';
  let frequency = 'yearly';
  let plasma = null;
  let lastResult = null;

  const input = id => q(`#${id}`);

  function syncSelection() {
    for (const [group, key, value] of [[modeTabs, 'mode', mode], [frequencyTabs, 'freq', frequency]]) {
      group?.querySelectorAll('.mortgage-calc-method-tab').forEach(tab => {
        const selected = tab.dataset[key] === value;
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-pressed', String(selected));
      });
    }
  }

  function renderSchedule(schedule) {
    if (!scheduleBody) return;
    const fragment = document.createDocumentFragment();
    for (const row of schedule) {
      const element = document.createElement('div');
      element.className = 'mortgage-calc-schedule-row';
      for (const value of [row.period, formatInterestMoney(row.invested), formatInterestMoney(row.interest), formatInterestMoney(row.balance)]) {
        const span = document.createElement('span');
        span.textContent = String(value);
        element.append(span);
      }
      fragment.append(element);
    }
    scheduleBody.replaceChildren(fragment);
  }

  function showEmpty() {
    if (resultEmpty) resultEmpty.style.display = '';
    if (resultContent) resultContent.style.display = 'none';
    lastResult = null;
    scheduleBody?.replaceChildren();
  }

  function renderResult(result = lastResult) {
    if (!result) return showEmpty();
    resultEmpty && (resultEmpty.style.display = 'none');
    resultContent && (resultContent.style.display = '');
    const totalValue = q('#interestCalcTotalValue');
    const totalTag = q('#interestCalcTotalTag');
    const interestValue = q('#interestCalcInterestValue');
    const interestTag = q('#interestCalcInterestTag');
    const investedValue = q('#interestCalcInvestedValue');
    const investedTag = q('#interestCalcInvestedTag');
    const returnValue = q('#interestCalcReturnRateValue');
    const returnTag = q('#interestCalcReturnTag');
    if (totalValue) totalValue.textContent = formatInterestMoney(result.totalAmount);
    if (totalTag) totalTag.textContent = t('home.interestCalc.totalAmount');
    if (interestValue) interestValue.textContent = formatInterestMoney(result.totalInterest);
    if (interestTag) interestTag.textContent = t('home.interestCalc.totalInterest');
    if (investedValue) investedValue.textContent = formatInterestMoney(result.totalInvested);
    if (investedTag) investedTag.textContent = t('home.interestCalc.totalInvested');
    const returnRate = result.totalInvested > 0 ? (result.totalInterest / result.totalInvested * 100).toFixed(1) : '0';
    if (returnValue) returnValue.textContent = `${returnRate}%`;
    if (returnTag) returnTag.textContent = formatInterestMoney(result.totalInterest);
    renderSchedule(result.schedule);
  }

  function updateModeFields() {
    if (mode === 'recurring') {
      if (principalField) principalField.style.display = 'none';
      if (recurringField) recurringField.style.display = '';
      if (frequencyField) frequencyField.style.display = 'none';
    } else if (mode === 'compound') {
      if (principalField) principalField.style.display = '';
      if (recurringField) recurringField.style.display = 'none';
      if (frequencyField) frequencyField.style.display = '';
    } else {
      if (principalField) principalField.style.display = '';
      if (recurringField) recurringField.style.display = 'none';
      if (frequencyField) frequencyField.style.display = 'none';
    }
  }

  function calculate() {
    const result = calculateInterest({
      principal: input('interestCalcPrincipal')?.value,
      regularAmount: input('interestCalcRegularAmount')?.value,
      annualRate: input('interestCalcRate')?.value,
      termYears: input('interestCalcTerm')?.value,
      mode,
      frequency
    });
    if (!result) return showEmpty();
    lastResult = result;
    renderResult(result);
  }

  function open() {
    lifecycle.invalidate();
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    if (background && !plasma) plasma = initStandardToolPlasma(background);
    mode = 'simple';
    frequency = 'yearly';
    syncSelection();
    updateModeFields();
    const defaults = [['interestCalcPrincipal', '10000'], ['interestCalcRegularAmount', '1000'], ['interestCalcRate', '5'], ['interestCalcTerm', '10']];
    for (const [id, value] of defaults) {
      const element = input(id);
      if (element && !element.value.trim()) element.value = value;
    }
    showEmpty();
  }

  function close() {
    lifecycle.invalidate();
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    plasma = disposeStandardToolPlasma(plasma);
  }

  lifecycle.event(back, 'click', close);
  lifecycle.event(modeTabs, 'click', event => {
    const tab = event.target.closest('.mortgage-calc-method-tab');
    if (!tab || !modeTabs.contains(tab)) return;
    mode = tab.dataset.mode || 'simple';
    syncSelection();
    updateModeFields();
  });
  lifecycle.event(frequencyTabs, 'click', event => {
    const tab = event.target.closest('.mortgage-calc-method-tab');
    if (!tab || !frequencyTabs.contains(tab)) return;
    frequency = tab.dataset.freq || 'yearly';
    syncSelection();
  });
  lifecycle.event(calculateButton, 'click', calculate);
  for (const id of ['interestCalcPrincipal', 'interestCalcRegularAmount', 'interestCalcRate', 'interestCalcTerm']) {
    lifecycle.event(input(id), 'keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); calculate(); }
    });
  }
  lifecycle.use(onLangChange(() => renderResult()));

  return {
    open,
    close,
    dispose() {
      close();
      lifecycle.dispose();
    }
  };
}
