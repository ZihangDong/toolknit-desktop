import {
  COLOR_SPACE_SLIDER_CONFIG,
  fmtColorNumber,
  getSpaceValues,
  hexCaretAfterSanitize,
  oklabInAdobeRgb,
  oklabInDisplayP3,
  oklabInRec2020,
  oklabInSrgbGamut,
  parseHexColor,
  rgbToHex,
  sanitizeHexText,
  spaceToDisplayRgb,
  spaceToXyz,
  xyzToAllSpaces,
  xyzToDisplayRgb,
} from './color-space-compare-core.js';
import { createColorWheels } from './color-space-compare-wheel.js';
import {
  bindColorNumberInput,
  getColorSliderPresentation,
  preserveColorSpaceValues,
  replaceColorSpaceChannel,
  stepColorValue,
} from './color-space-compare-controls.js';
import { onLangChange, t } from './i18n.js';
import { createIcons, icons } from 'lucide';
import { bindToolPageChrome, mountToolPageBackground, toolTopbarMarkup } from './tool-page-shell.js';
import './color-space-compare.css';

const INITIAL_RGB = Object.freeze({ r: 128, g: 128, b: 128 });

const SPACE_META = Object.freeze([
  { id: 'oklch', label: 'OKLCH', icon: 'sparkles' },
  { id: 'oklab', label: 'OKLab', icon: 'orbit' },
  { id: 'lch', label: 'CIELCH', icon: 'circle-dashed' },
  { id: 'lab', label: 'CIELAB', icon: 'triangle' },
  { id: 'rgb', label: 'RGB', icon: 'panel-top' },
  { id: 'hsl', label: 'HSL', icon: 'diamond' },
  { id: 'hsv', label: 'HSV', icon: 'scan' },
  { id: 'cmyk', label: 'CMYK', icon: 'blend' },
]);

const CODE_FORMATS = Object.freeze([
  { id: 'oklch', label: 'OKLCH' },
  { id: 'oklab', label: 'OKLab' },
  { id: 'lch', label: 'LCh D65' },
  { id: 'lab', label: 'Lab D65' },
  { id: 'cmyk', label: 'CMYK ≈' },
  { id: 'rgb', label: 'RGB' },
  { id: 'hsl', label: 'HSL' },
  { id: 'hsv', label: 'HSV' },
]);

const GAMUTS = Object.freeze([
  { id: 'srgb', label: 'sRGB', test: oklabInSrgbGamut },
  { id: 'p3', label: 'Display P3', test: oklabInDisplayP3 },
  { id: 'adobe', label: 'Adobe RGB', test: oklabInAdobeRgb },
  { id: 'rec2020', label: 'Rec.2020', test: oklabInRec2020 },
]);

function createCopyIcon() {
  const icon = document.createElement('i');
  icon.dataset.lucide = 'copy';
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function createStepIcon(direction) {
  const icon = document.createElement('i');
  icon.dataset.lucide = direction > 0 ? 'chevron-up' : 'chevron-down';
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // WebView clipboard permissions can be denied even when the API exists.
    }
  }

  const textarea = document.createElement('textarea');
  const previousActive = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  textarea.value = text;
  textarea.dataset.allowProgrammaticCopy = 'true';
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  let copied = false;
  try {
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    copied = document.execCommand('copy');
  } finally {
    textarea.remove();
    if (previousActive?.isConnected) previousActive.focus({ preventScroll: true });
  }
  if (!copied) throw new Error('Clipboard write failed');
}

function formatCodeValues(all, displayRgb) {
  const oklchHue = Number.isFinite(all.oklch.H) ? fmtColorNumber(all.oklch.H, 1) : 'none';
  const lchHue = Number.isFinite(all.lch.H) ? fmtColorNumber(all.lch.H, 1) : 'none';
  return {
    oklch: `oklch(${fmtColorNumber(all.oklch.L, 3)} ${fmtColorNumber(all.oklch.C, 3)} ${oklchHue})`,
    oklab: `oklab(${fmtColorNumber(all.oklab.L, 3)} ${fmtColorNumber(all.oklab.a, 3)} ${fmtColorNumber(all.oklab.b, 3)})`,
    lab: `Lab D65(${fmtColorNumber(all.lab.L, 1)} ${fmtColorNumber(all.lab.a, 1)} ${fmtColorNumber(all.lab.b, 1)})`,
    lch: `LCh D65(${fmtColorNumber(all.lch.L, 1)} ${fmtColorNumber(all.lch.C, 1)} ${lchHue})`,
    cmyk: `CMYK≈(${fmtColorNumber(all.cmyk.c, 0)}% ${fmtColorNumber(all.cmyk.m, 0)}% ${fmtColorNumber(all.cmyk.y, 0)}% ${fmtColorNumber(all.cmyk.k, 0)}%)`,
    rgb: `rgb(${Math.round(displayRgb.r)} ${Math.round(displayRgb.g)} ${Math.round(displayRgb.b)})`,
    hsl: `hsl(${fmtColorNumber(all.hsl.h, 1)} ${fmtColorNumber(all.hsl.s, 1)}% ${fmtColorNumber(all.hsl.l, 1)}%)`,
    hsv: `hsv(${fmtColorNumber(all.hsv.h, 1)} ${fmtColorNumber(all.hsv.s, 1)}% ${fmtColorNumber(all.hsv.v, 1)}%)`,
  };
}

function createColorSpaceCompareController(root, notify) {
  if (!root) {
    return { open() {}, close() {}, destroy() {} };
  }

  const preview = root.querySelector('[data-role="preview"]');
  const hexValue = root.querySelector('[data-role="hex"]');
  const hexRow = root.querySelector('[data-role="hex-row"]');
  const hexInput = root.querySelector('[data-role="hex-input"]');
  const wheelsRoot = root.querySelector('[data-role="wheels"]');
  const gamutBadge = root.querySelector('[data-role="gamut-badge"]');
  const gamutList = root.querySelector('[data-role="gamut-list"]');
  const previewStatus = root.querySelector('[data-role="preview-status"]');
  const codeList = root.querySelector('[data-role="code-list"]');
  const slidersRoot = root.querySelector('[data-role="sliders"]');
  const controlsRoot = root.querySelector('.color-space-compare-controls');

  if (!preview || !hexValue || !hexRow || !hexInput || !wheelsRoot
    || !gamutBadge || !gamutList || !previewStatus || !codeList || !slidersRoot) {
    throw new Error('Color space compare markup is incomplete.');
  }

  const codeElements = new Map();
  const sliderElements = {};
  let wheels = null;
  let displayRgb = { ...INITIAL_RGB };
  let canonicalState = { space: 'rgb', values: { ...INITIAL_RGB } };
  let lastPresentedAll = null;
  let isUpdating = false;
  let isOpen = false;
  let trackDrawFrame = null;
  let pendingTrackAll = null;
  let openDrawFrame = null;
  let unsubscribeLanguage = null;
  let copyGeneration = 0;

  function buildCodeCards() {
    const fragment = document.createDocumentFragment();
    for (const format of CODE_FORMATS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'color-space-compare-code-card';
      button.dataset.format = format.id;

      const label = document.createElement('span');
      label.className = 'color-space-compare-code-label';
      label.textContent = format.label;

      const value = document.createElement('span');
      value.className = 'color-space-compare-code-value';

      button.append(label, value, createCopyIcon());
      button.addEventListener('click', async () => {
        const generation = copyGeneration;
        try {
          await copyText(value.textContent || '');
          if (isOpen && generation === copyGeneration) notify(t('home.colorSpaceCompare.copySuccess', { format: format.label }));
        } catch (error) {
          console.error('[Color Space Compare] Copy failed:', error);
          if (isOpen && generation === copyGeneration) notify(t('home.colorSpaceCompare.copyFailed'));
        }
      });

      codeElements.set(format.id, { button, value, format });
      fragment.appendChild(button);
    }
    codeList.replaceChildren(fragment);
  }

  function getEditableSpaceValues(space) {
    if (canonicalState.space === space) return { ...canonicalState.values };
    if (!lastPresentedAll) return preserveColorSpaceValues(space, INITIAL_RGB);
    return preserveColorSpaceValues(space, getSpaceValues(space, lastPresentedAll, displayRgb));
  }

  function buildSliders() {
    const fragment = document.createDocumentFragment();

    for (const meta of SPACE_META) {
      const section = document.createElement('section');
      section.className = 'color-space-compare-section';
      section.dataset.space = meta.id;

      const title = document.createElement('h2');
      title.className = 'color-space-compare-section-title';
      const icon = document.createElement('span');
      icon.className = 'color-space-compare-section-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = `<i data-lucide="${meta.icon}"></i>`;
      const name = document.createElement('span');
      name.textContent = meta.label;
      const description = document.createElement('span');
      description.className = 'color-space-compare-section-desc';
      title.append(icon, name, description);
      section.appendChild(title);

      sliderElements[meta.id] = {};
      for (const config of COLOR_SPACE_SLIDER_CONFIG[meta.id].channels) {
        const row = document.createElement('div');
        row.className = 'color-space-compare-slider-row';
        row.dataset.space = meta.id;
        row.dataset.channel = config.key;

        const channelLabel = document.createElement('span');
        channelLabel.className = 'color-space-compare-slider-label';
        channelLabel.textContent = config.key;

        const track = document.createElement('div');
        track.className = 'color-space-compare-track';
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        const handle = document.createElement('span');
        handle.className = 'color-space-compare-handle';
        handle.setAttribute('aria-hidden', 'true');
        const hit = document.createElement('div');
        hit.className = 'color-space-compare-track-hit';
        hit.setAttribute('role', 'slider');
        hit.tabIndex = 0;
        hit.setAttribute('aria-valuemin', String(config.min));
        hit.setAttribute('aria-valuemax', String(config.max));
        track.append(canvas, handle, hit);

        const valueGroup = document.createElement('div');
        valueGroup.className = 'color-space-compare-value-group';
        const prefix = document.createElement('span');
        prefix.className = 'color-space-compare-value-prefix';
        prefix.textContent = config.key;
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'color-space-compare-value-input';
        input.min = String(config.min);
        input.max = String(config.max);
        input.step = String(config.step);
        input.inputMode = config.decimals === 0 ? 'numeric' : 'decimal';
        const unit = document.createElement('span');
        unit.className = 'color-space-compare-value-unit';
        unit.textContent = config.unit || '';
        const stepButtons = document.createElement('span');
        stepButtons.className = 'color-space-compare-step-buttons';
        const increase = document.createElement('button');
        increase.type = 'button';
        increase.className = 'color-space-compare-step-button';
        increase.dataset.direction = '1';
        increase.appendChild(createStepIcon(1));
        const decrease = document.createElement('button');
        decrease.type = 'button';
        decrease.className = 'color-space-compare-step-button';
        decrease.dataset.direction = '-1';
        decrease.appendChild(createStepIcon(-1));
        stepButtons.append(increase, decrease);
        valueGroup.append(prefix, input, unit, stepButtons);
        row.append(channelLabel, track, valueGroup);
        section.appendChild(row);

        const elements = {
          meta,
          config,
          row,
          canvas,
          handle,
          hit,
          input,
          increase,
          decrease,
          description,
        };
        sliderElements[meta.id][config.key] = elements;
        wireSlider(elements);
      }

      fragment.appendChild(section);
    }
    slidersRoot.replaceChildren(fragment);
  }

  function buildWheels() {
    wheels = createColorWheels(wheelsRoot, {
      getValues: space => getEditableSpaceValues(space),
      applyValues: (space, values) => updateAll(space, values),
      getDisplayRgb: () => displayRgb,
    });
  }

  function wireHexInput() {
    const syncFromHex = (text) => {
      const rgb = parseHexColor(text);
      hexRow.classList.toggle('is-invalid', sanitizeHexText(text).length > 0 && !rgb);
      if (rgb) updateAll('rgb', rgb);
    };

    hexInput.addEventListener('input', () => {
      const raw = hexInput.value;
      const cleaned = sanitizeHexText(raw);
      if (cleaned !== raw) {
        // Keep the caret on the same logical character once illegal
        // characters have been stripped out from under it.
        const caret = hexCaretAfterSanitize(raw, hexInput.selectionStart || 0);
        hexInput.value = cleaned;
        const position = Math.min(caret, cleaned.length);
        try {
          hexInput.setSelectionRange(position, position);
        } catch {
          // Selection APIs are unavailable for some input states.
        }
      }
      syncFromHex(cleaned);
    });

    // Pasted values often start with "#", which maxlength would otherwise
    // truncate before the colour could be parsed.
    hexInput.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text') ?? '';
      if (!text) return;
      event.preventDefault();
      const cleaned = sanitizeHexText(text);
      hexInput.value = cleaned;
      syncFromHex(cleaned);
    });

    hexInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') hexInput.blur();
    });

    hexInput.addEventListener('blur', () => {
      const parsed = parseHexColor(hexInput.value) ?? displayRgb;
      hexInput.value = rgbToHex(parsed.r, parsed.g, parsed.b).slice(1);
      hexRow.classList.remove('is-invalid');
    });
  }

  function wireSlider(elements) {
    const { meta, config, hit, input, increase, decrease } = elements;
    let dragging = false;
    let pointerId = null;
    let dragValues = null;

    function pointerToValue(event) {
      const rect = hit.getBoundingClientRect();
      const ratio = rect.width > 0
        ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
        : 0;
      return config.min + ratio * (config.max - config.min);
    }

    function applyValue(rawValue, baseValues = null, normalize = true) {
      const values = replaceColorSpaceChannel(
        meta.id,
        baseValues ?? getEditableSpaceValues(meta.id),
        config.key,
        rawValue,
        { normalize }
      );
      if (!values) return;
      updateAll(meta.id, values);
    }

    function currentValue() {
      return getEditableSpaceValues(meta.id)[config.key];
    }

    function updateButtonState(rawValue = currentValue()) {
      const value = Number(rawValue);
      increase.disabled = !Number.isFinite(value) || value >= config.max;
      decrease.disabled = !Number.isFinite(value) || value <= config.min;
    }
    elements.updateButtonState = updateButtonState;

    function stepValue(direction, multiplier = 1) {
      const next = stepColorValue(currentValue(), direction, config, multiplier);
      if (next === null) return;
      applyValue(next, null, false);
      input.value = fmtColorNumber(next, config.decimals);
      updateButtonState(next);
    }

    hit.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      // pointerdown is prevented so the active input does not naturally blur.
      // Finish every active draft before snapshotting the model for this drag;
      // otherwise a later blur could replay stale text over the slider result.
      for (const channels of Object.values(sliderElements)) {
        for (const slider of Object.values(channels)) {
          slider.inputController?.finishEditing();
        }
      }
      dragging = true;
      pointerId = event.pointerId;
      dragValues = getEditableSpaceValues(meta.id);
      hit.setPointerCapture(event.pointerId);
      event.preventDefault();
      applyValue(pointerToValue(event), dragValues);
    });
    hit.addEventListener('pointermove', (event) => {
      if (!dragging || event.pointerId !== pointerId) return;
      event.preventDefault();
      applyValue(pointerToValue(event), dragValues);
    });
    const stopDrag = (event) => {
      if (event && pointerId !== null && event.pointerId !== pointerId) return;
      const capturedPointerId = pointerId;
      dragging = false;
      pointerId = null;
      dragValues = null;
      if (capturedPointerId !== null) {
        try {
          if (hit.hasPointerCapture?.(capturedPointerId)) hit.releasePointerCapture(capturedPointerId);
        } catch {}
      }
    };
    elements.stopDrag = stopDrag;
    hit.addEventListener('pointerup', stopDrag);
    hit.addEventListener('pointercancel', stopDrag);
    hit.addEventListener('lostpointercapture', stopDrag);
    hit.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        event.preventDefault();
        stepValue(1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        event.preventDefault();
        stepValue(-1);
      } else if (event.key === 'PageUp' || event.key === 'PageDown') {
        event.preventDefault();
        stepValue(event.key === 'PageUp' ? 1 : -1, 10);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        applyValue(event.key === 'Home' ? config.min : config.max);
      }
    });

    elements.inputController = bindColorNumberInput(input, {
      config,
      getCurrentValue: currentValue,
      applyTransientValue: value => {
        applyValue(value, null, false);
        updateButtonState(value);
      },
      applyCommittedValue: value => {
        applyValue(value);
        updateButtonState(value);
      },
      stepValue,
    });
    increase.addEventListener('click', () => stepValue(1));
    decrease.addEventListener('click', () => stepValue(-1));
  }

  function updateAll(sourceSpace, sourceValues) {
    if (isUpdating) return;
    isUpdating = true;
    try {
      const presentedSource = preserveColorSpaceValues(sourceSpace, sourceValues);
      canonicalState = { space: sourceSpace, values: { ...presentedSource } };

      const xyz = spaceToXyz(sourceSpace, presentedSource);
      displayRgb = xyzToDisplayRgb(xyz.x, xyz.y, xyz.z);
      const all = xyzToAllSpaces(xyz, displayRgb);
      if (sourceSpace !== 'rgb') all[sourceSpace] = { ...presentedSource };
      lastPresentedAll = all;

      const hex = rgbToHex(displayRgb.r, displayRgb.g, displayRgb.b);
      preview.style.backgroundColor = hex;
      hexValue.textContent = hex;
      if (hexInput !== document.activeElement) {
        hexInput.value = hex.slice(1);
        hexRow.classList.remove('is-invalid');
      }

      const codeValues = formatCodeValues(all, displayRgb);
      for (const [id, entry] of codeElements) entry.value.textContent = codeValues[id];

      for (const meta of SPACE_META) {
        const values = getSpaceValues(meta.id, all, displayRgb);
        for (const config of COLOR_SPACE_SLIDER_CONFIG[meta.id].channels) {
          const elements = sliderElements[meta.id]?.[config.key];
          if (!elements) continue;
          const presentation = getColorSliderPresentation(values[config.key], config);
          if (!elements.inputController?.isEditing()) {
            elements.input.value = fmtColorNumber(presentation.value, config.decimals);
          }
          elements.updateButtonState?.(presentation.value);
          elements.handle.style.left = `${presentation.ratio * 100}%`;
          elements.row.classList.toggle('is-value-outside-range', presentation.isOutsideRange);
          elements.hit.setAttribute('aria-valuenow', String(presentation.sliderValue));
          elements.hit.setAttribute('aria-valuetext', `${fmtColorNumber(presentation.value, config.decimals)}${config.unit || ''}`);
        }
      }

      updateGamutInfo(all.oklab);
      wheels?.sync();
      scheduleCanvasTracks(all);
    } finally {
      isUpdating = false;
    }
  }

  function updateGamutInfo(oklab) {
    const results = GAMUTS.map(gamut => ({ ...gamut, inside: gamut.test(oklab.L, oklab.a, oklab.b) }));
    const allInside = results.every(result => result.inside);
    const srgbInside = results[0].inside;

    const badge = document.createElement('span');
    badge.className = `color-space-compare-gamut-badge ${allInside ? 'is-in' : 'is-out'}`;
    badge.textContent = t(allInside
      ? 'home.colorSpaceCompare.allGamutsIn'
      : 'home.colorSpaceCompare.partialGamutsOut');
    gamutBadge.replaceChildren(badge);

    previewStatus.textContent = t(srgbInside
      ? 'home.colorSpaceCompare.previewNative'
      : 'home.colorSpaceCompare.previewMapped');

    const fragment = document.createDocumentFragment();
    for (const result of results) {
      const item = document.createElement('div');
      item.className = `color-space-compare-gamut-item ${result.inside ? 'is-in' : 'is-out'}`;
      item.title = t(result.inside
        ? 'home.colorSpaceCompare.gamutInside'
        : 'home.colorSpaceCompare.gamutOutside');
      const label = document.createElement('span');
      label.textContent = result.label;
      item.appendChild(label);
      fragment.appendChild(item);
    }
    gamutList.replaceChildren(fragment);
  }

  function scheduleCanvasTracks(all) {
    pendingTrackAll = all;
    if (!isOpen || trackDrawFrame !== null) return;
    trackDrawFrame = requestAnimationFrame(() => {
      const latest = pendingTrackAll;
      pendingTrackAll = null;
      trackDrawFrame = null;
      if (isOpen && latest) drawAllCanvasTracks(latest);
    });
  }

  function drawAllCanvasTracks(all) {
    const viewport = controlsRoot?.getBoundingClientRect();
    for (const meta of SPACE_META) {
      const section = slidersRoot.querySelector(`[data-space="${meta.id}"]`);
      const rect = section?.getBoundingClientRect();
      if (viewport && rect && (rect.bottom < viewport.top || rect.top > viewport.bottom)) continue;
      for (const config of COLOR_SPACE_SLIDER_CONFIG[meta.id].channels) {
        const elements = sliderElements[meta.id]?.[config.key];
        if (elements) drawCanvasTrack(meta.id, config, elements.canvas, all);
      }
    }
  }

  function drawCanvasTrack(space, config, canvas, all) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    const samples = Math.min(144, Math.max(64, Math.ceil(rect.width * 0.65)));
    const baseValues = getSpaceValues(space, all, displayRgb);

    for (let index = 0; index < samples; index += 1) {
      const ratio = samples === 1 ? 0 : index / (samples - 1);
      const values = { ...baseValues, [config.key]: config.min + ratio * (config.max - config.min) };
      const rgb = spaceToDisplayRgb(space, values);
      context.fillStyle = `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`;
      const x = Math.floor(index * width / samples);
      context.fillRect(x, 0, Math.ceil(width / samples) + 1, height);
    }
  }

  function refreshLanguage() {
    root.querySelectorAll('[data-csc-i18n]').forEach(element => {
      element.textContent = t(element.dataset.cscI18n);
    });
    for (const meta of SPACE_META) {
      const section = slidersRoot.querySelector(`[data-space="${meta.id}"]`);
      const description = section?.querySelector('.color-space-compare-section-desc');
      if (description) description.textContent = t(`home.colorSpaceCompare.spaces.${meta.id}`);

      for (const config of COLOR_SPACE_SLIDER_CONFIG[meta.id].channels) {
        const elements = sliderElements[meta.id]?.[config.key];
        if (!elements) continue;
        const label = t('home.colorSpaceCompare.sliderLabel', {
          space: meta.label,
          channel: config.key,
          min: config.min,
          max: config.max,
        });
        elements.input.setAttribute('aria-label', label);
        elements.hit.setAttribute('aria-label', label);
        elements.increase.setAttribute('aria-label', t('home.colorSpaceCompare.increase', {
          channel: config.key,
          step: config.step,
        }));
        elements.decrease.setAttribute('aria-label', t('home.colorSpaceCompare.decrease', {
          channel: config.key,
          step: config.step,
        }));
      }
    }

    wheels?.refreshLabels(key => t(`home.colorSpaceCompare.wheelRoles.${key}`));
    hexInput.setAttribute('aria-label', t('home.colorSpaceCompare.hexInputLabel'));
    for (const entry of codeElements.values()) {
      entry.button.setAttribute('aria-label', t('home.colorSpaceCompare.copyValue', {
        format: entry.format.label,
      }));
    }
    if (lastPresentedAll) updateGamutInfo(lastPresentedAll.oklab);
  }

  function reset() {
    displayRgb = { ...INITIAL_RGB };
    canonicalState = { space: 'rgb', values: { ...INITIAL_RGB } };
    updateAll('rgb', INITIAL_RGB);
    if (controlsRoot) controlsRoot.scrollTop = 0;
    const summaryRoot = root.querySelector('.color-space-compare-summary');
    if (summaryRoot) summaryRoot.scrollTop = 0;
  }

  function open() {
    isOpen = true;
    copyGeneration += 1;
    unsubscribeLanguage?.();
    unsubscribeLanguage = onLangChange(refreshLanguage);
    if (resizeObserver && controlsRoot) resizeObserver.observe(controlsRoot);
    window.addEventListener('resize', handleResize);
    controlsRoot?.addEventListener('scroll', handleResize, { passive: true });
    refreshLanguage();
    reset();
    if (openDrawFrame !== null) cancelAnimationFrame(openDrawFrame);
    openDrawFrame = requestAnimationFrame(() => {
      openDrawFrame = requestAnimationFrame(() => {
        openDrawFrame = null;
        if (!isOpen) return;
        wheels?.relayout();
        if (lastPresentedAll) scheduleCanvasTracks(lastPresentedAll);
      });
    });
  }

  function close() {
    isOpen = false;
    copyGeneration += 1;
    pendingTrackAll = null;
    if (trackDrawFrame !== null) cancelAnimationFrame(trackDrawFrame);
    if (openDrawFrame !== null) cancelAnimationFrame(openDrawFrame);
    trackDrawFrame = null;
    openDrawFrame = null;
    for (const channels of Object.values(sliderElements)) {
      for (const slider of Object.values(channels)) slider.stopDrag?.();
    }
    wheels?.destroy();
    resizeObserver?.disconnect();
    unsubscribeLanguage?.();
    unsubscribeLanguage = null;
    window.removeEventListener('resize', handleResize);
    controlsRoot?.removeEventListener('scroll', handleResize);
    for (const canvas of root.querySelectorAll('.color-space-compare-track canvas')) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  function handleResize() {
    if (!isOpen) return;
    wheels?.sync();
    if (lastPresentedAll) scheduleCanvasTracks(lastPresentedAll);
  }

  buildCodeCards();
  buildSliders();
  buildWheels();
  wireHexInput();
  createIcons({ icons, attrs: { 'stroke-width': 1.8 } });
  refreshLanguage();
  updateAll('rgb', INITIAL_RGB);

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(handleResize)
    : null;

  return {
    open,
    close,
    destroy() {
      close();
    },
  };
}

export function initColorSpaceCompareTool({
  overlay,
  notify = message => window.showToast?.(message),
}) {
  if (!overlay) throw new Error('color-space-compare:missing-overlay');

  overlay.innerHTML = `<div class="tool-page-v2-shell color-space-compare-shell">
    ${toolTopbarMarkup({
      tag: 'CREATIVE TOOLS · TOOL PAGE 2.3',
      title: t('home.toolNames.colorSpaceCompare'),
      closeAttr: 'data-csc-close',
    })}
    <main class="tool-page-v2-body color-space-compare-main">
      <aside class="tool-page-v2-rail color-space-compare-summary">
        <span class="tool-page-v2-rail-kicker">COLOR SCIENCE LAB</span>
        <h1 data-csc-i18n="home.toolNames.colorSpaceCompare">${t('home.toolNames.colorSpaceCompare')}</h1>
        <p data-csc-i18n="home.colorSpaceCompare.subtitle">${t('home.colorSpaceCompare.subtitle')}</p>
        <section class="color-space-compare-wheel-panel">
          <div class="color-space-compare-wheel-head">
            <span class="color-space-compare-card-kicker" data-csc-i18n="home.colorSpaceCompare.wheelKicker">${t('home.colorSpaceCompare.wheelKicker')}</span>
            <p class="color-space-compare-wheel-hint" data-csc-i18n="home.colorSpaceCompare.wheelHint">${t('home.colorSpaceCompare.wheelHint')}</p>
          </div>
          <div class="color-space-compare-wheels" data-role="wheels"></div>
        </section>
        <section class="color-space-compare-preview-card">
          <span class="color-space-compare-card-kicker" data-csc-i18n="home.colorSpaceCompare.livePreview">${t('home.colorSpaceCompare.livePreview')}</span>
          <div class="color-space-compare-preview-row">
            <div class="color-space-compare-preview" data-role="preview"></div>
            <div class="color-space-compare-preview-meta">
              <strong class="color-space-compare-hex" data-role="hex">#808080</strong>
              <div data-role="gamut-badge"></div>
            </div>
          </div>
          <div class="color-space-compare-hex-row" data-role="hex-row">
            <span class="color-space-compare-hex-hash" aria-hidden="true">#</span>
            <input class="color-space-compare-hex-input" data-role="hex-input" type="text" value="808080"
                   maxlength="8" spellcheck="false" autocomplete="off" autocapitalize="off" />
            <span class="color-space-compare-hex-tag" data-csc-i18n="home.colorSpaceCompare.hexTag">${t('home.colorSpaceCompare.hexTag')}</span>
          </div>
          <p class="color-space-compare-preview-status" data-role="preview-status"></p>
          <div class="color-space-compare-gamut-list" data-role="gamut-list"></div>
        </section>
        <section class="color-space-compare-code-list" data-role="code-list"></section>
        <div class="tool-page-v2-rail-note">
          <span>LOCAL &amp; PRECISE</span>
          <strong data-csc-i18n="home.colorSpaceCompare.localNote">${t('home.colorSpaceCompare.localNote')}</strong>
        </div>
      </aside>
      <section class="tool-page-v2-workspace color-space-compare-workspace">
        <header class="color-space-compare-workspace-head">
          <div><span>LINKED COLOR MODEL</span><h2 data-csc-i18n="home.colorSpaceCompare.workspaceTitle">${t('home.colorSpaceCompare.workspaceTitle')}</h2></div>
          <p data-csc-i18n="home.colorSpaceCompare.workspaceDesc">${t('home.colorSpaceCompare.workspaceDesc')}</p>
        </header>
        <div class="color-space-compare-controls">
          <div class="color-space-compare-sliders" data-role="sliders"></div>
        </div>
      </section>
    </main>
  </div>`;

  const shell = overlay.querySelector('.color-space-compare-shell');
  const controller = createColorSpaceCompareController(shell, notify);
  let backgroundDispose = null;
  let isOpen = false;
  const api = {
    open() {
      if (isOpen) return;
      isOpen = true;
      backgroundDispose?.();
      backgroundDispose = mountToolPageBackground(shell);
      overlay.classList.add('visible');
      overlay.setAttribute('aria-hidden', 'false');
      controller.open();
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      controller.close();
      backgroundDispose?.();
      backgroundDispose = null;
      overlay.classList.remove('visible');
      overlay.setAttribute('aria-hidden', 'true');
    },
    destroy() {
      api.close();
      controller.destroy();
      disposeChrome();
      overlay.replaceChildren();
    },
  };
  const disposeChrome = bindToolPageChrome(shell, api.close);
  return api;
}
