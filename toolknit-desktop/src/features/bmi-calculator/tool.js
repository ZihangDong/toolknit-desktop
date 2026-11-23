import '../../styles/components/calculator-form.css';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { applyTranslations, onLangChange, t } from '../../i18n.js';
import { BMI_INPUT_LIMITS, calculateBmi } from './core.js';
import './bmi-calculator.css';

const WARNING_DELAY_MS = 800;

export function initBmiCalculatorTool({
  overlay,
  initStandardToolPlasma = () => null,
  disposeStandardToolPlasma = instance => instance
} = {}) {
  if (!overlay) throw new Error('bmi-calculator:missing-overlay');
  const lifecycle = createLifecycleScope();
  const root = overlay.ownerDocument || document;
  const q = selector => overlay.querySelector(selector);
  const back = q('#bmiCalcBack');
  const background = q('#bmiCalcBg');
  const modeTabs = q('#bmiCalcModeTabs');
  const advancedFields = q('#bmiCalcAdvancedFields');
  const genderTabs = q('#bmiCalcGenderTabs');
  const hipField = q('#bmiCalcHipField');
  const resultEmpty = q('#bmiCalcResultEmpty');
  const resultContent = q('#bmiCalcResultContent');
  const resultBarMarker = q('#bmiCalcBarMarker');
  // The validation dialog is a document-level sibling of the tool overlay.
  const warningDialog = root.getElementById('bmiCalcWarnDialog');
  const warningMessage = root.getElementById('bmiCalcWarnMsg');
  const warningOk = root.getElementById('bmiCalcWarnOk');
  const warningTimers = new Map();
  let gender = 'male';
  let mode = 'simple';
  let plasma = null;
  let warningField = null;

  function clearWarnings() {
    for (const timer of warningTimers.values()) clearTimeout(timer);
    warningTimers.clear();
    warningField = null;
    warningDialog?.classList.remove('visible');
  }

  function input(field) {
    return q(`#bmiCalc${field[0].toUpperCase()}${field.slice(1)}`);
  }

  function tagClass(level) {
    return `bmi-calc-card-tag tag-${level}`;
  }

  function showEmpty() {
    if (resultEmpty) resultEmpty.style.display = '';
    if (resultContent) resultContent.style.display = 'none';
  }

  function renderResult() {
    const result = calculateBmi({
      age: input('age')?.value,
      height: input('height')?.value,
      weight: input('weight')?.value,
      waist: input('waist')?.value,
      neck: input('neck')?.value,
      hip: input('hip')?.value,
      gender,
      mode
    });
    if (!result) {
      showEmpty();
      return;
    }
    resultEmpty && (resultEmpty.style.display = 'none');
    resultContent && (resultContent.style.display = '');
    const bmiValue = q('#bmiValue');
    const bmiTag = q('#bmiTag');
    const bodyFatValue = q('#bodyFatValue');
    const bodyFatTag = q('#bodyFatTag');
    const bmrValue = q('#bmrValue');
    const idealWeightValue = q('#idealWeightValue');
    const idealWeightDiff = q('#idealWeightDiff');
    const fatMassValue = q('#fatMassValue');
    const leanMassValue = q('#leanMassValue');
    const bmiLabel = level => t(`home.bmiCalc.${{
      low: 'rangeLow',
      normal: 'rangeNormal',
      high: 'rangeHigh',
      veryhigh: 'rangeVeryHigh'
    }[level] || 'rangeNormal'}`);
    if (bmiValue) bmiValue.textContent = result.bmi.toFixed(1);
    if (bmiTag) {
      bmiTag.textContent = bmiLabel(result.bmiInfo.level);
      bmiTag.className = tagClass(result.bmiInfo.level);
    }
    const hasBodyFat = Number.isFinite(result.bodyFat);
    if (bodyFatValue) bodyFatValue.textContent = hasBodyFat ? `${result.bodyFat.toFixed(1)}%` : '--';
    if (bodyFatTag) {
      bodyFatTag.textContent = hasBodyFat ? bmiLabel(result.bodyFatInfo.level)
        : t(`home.bmiCalc.${result.bodyFatError === 'missing_measurements' ? 'advancedMissing' : 'advancedInvalid'}`);
      bodyFatTag.className = hasBodyFat ? tagClass(result.bodyFatInfo.level) : 'bmi-calc-card-tag';
      bodyFatTag.title = hasBodyFat ? '' : t('home.bmiCalc.advancedCheck');
      bodyFatTag.setAttribute('role', 'status');
    }
    if (bmrValue) bmrValue.textContent = String(Math.round(result.bmr));
    if (idealWeightValue) idealWeightValue.textContent = `${result.idealWeight.toFixed(1)} kg`;
    if (idealWeightDiff) {
      const diffText = result.weightDiff > 0 ? `+${result.weightDiff.toFixed(1)} kg` : `${result.weightDiff.toFixed(1)} kg`;
      idealWeightDiff.textContent = diffText;
      idealWeightDiff.className = `bmi-calc-card-tag tag-${Math.abs(result.weightDiff) < 3 ? 'normal' : result.weightDiff > 0 ? 'high' : 'low'}`;
    }
    if (fatMassValue) fatMassValue.textContent = hasBodyFat ? `${result.fatMass.toFixed(1)} kg` : '--';
    if (leanMassValue) leanMassValue.textContent = hasBodyFat ? `${result.leanMass.toFixed(1)} kg` : '--';
    if (resultBarMarker) {
      resultBarMarker.hidden = !hasBodyFat;
      resultBarMarker.style.left = hasBodyFat ? `${result.barPercent}%` : '';
    }
  }

  function showWarning(field) {
    const limits = BMI_INPUT_LIMITS[field];
    if (!limits || !warningMessage) return;
    warningField = field;
    const labelKey = {
      age: 'age', height: 'height', weight: 'weight', waist: 'waist', neck: 'neck', hip: 'hip'
    }[field];
    warningMessage.textContent = t('home.bmiCalc.warnMsg')
      .replace('{label}', t(`home.bmiCalc.${labelKey}`))
      .replace('{min}', limits.min)
      .replace('{max}', limits.max);
    warningDialog?.classList.add('visible');
  }

  function validateField(field) {
    const el = input(field);
    if (!el) return;
    renderResult();
    clearTimeout(warningTimers.get(field));
    warningTimers.delete(field);
    if (!el.value) return;
    const value = Number.parseFloat(el.value);
    const limits = BMI_INPUT_LIMITS[field];
    if (Number.isFinite(value) && (value < limits.min || value > limits.max)) {
      warningTimers.set(field, setTimeout(() => {
        warningTimers.delete(field);
        showWarning(field);
      }, WARNING_DELAY_MS));
    }
  }

  function setMode(nextMode) {
    clearWarnings();
    mode = nextMode;
    modeTabs?.querySelectorAll('.bmi-calc-mode-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.mode === mode));
    if (advancedFields) advancedFields.style.display = mode === 'advanced' ? '' : 'none';
    renderResult();
  }

  function setGender(nextGender) {
    clearWarnings();
    gender = nextGender;
    genderTabs?.querySelectorAll('.bmi-calc-gender-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.gender === gender));
    if (hipField) hipField.style.display = gender === 'female' ? '' : 'none';
    renderResult();
  }

  function open() {
    lifecycle.invalidate();
    applyTranslations();
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    if (background && !plasma) plasma = initStandardToolPlasma(background);
    renderResult();
  }

  function close() {
    lifecycle.invalidate();
    clearWarnings();
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    plasma = disposeStandardToolPlasma(plasma);
  }

  lifecycle.event(back, 'click', close);
  lifecycle.event(modeTabs, 'click', event => {
    const tab = event.target.closest('.bmi-calc-mode-tab');
    if (tab && modeTabs.contains(tab)) setMode(tab.dataset.mode);
  });
  lifecycle.event(genderTabs, 'click', event => {
    const tab = event.target.closest('.bmi-calc-gender-tab');
    if (tab && genderTabs.contains(tab)) setGender(tab.dataset.gender);
  });
  for (const field of Object.keys(BMI_INPUT_LIMITS)) lifecycle.event(input(field), 'input', () => validateField(field));
  lifecycle.event(warningOk, 'click', () => {
    const limits = BMI_INPUT_LIMITS[warningField];
    const el = warningField ? input(warningField) : null;
    if (limits && el) el.value = String(limits.default);
    warningDialog?.classList.remove('visible');
    warningField = null;
    renderResult();
  });
  lifecycle.use(onLangChange(renderResult));

  return {
    open,
    close,
    dispose() {
      close();
      lifecycle.dispose();
    }
  };
}
