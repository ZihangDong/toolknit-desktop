import assert from 'node:assert/strict';
import {
  COLOR_SPACE_SLIDER_CONFIG,
  fmtColorNumber,
  getSpaceValues,
  hslToWheelPoint,
  hsvToWheelPoint,
  hueToWheelPoint,
  normalizeSliderValue,
  parseHexColor,
  sanitizeHexText,
  spaceToXyz,
  wheelPointToHsl,
  wheelPointToHsv,
  wheelPointToHue,
  xyzToAllSpaces,
  xyzToDisplayRgb,
} from '../src/color-space-compare-core.js';
import {
  bindColorNumberInput,
  getColorSliderPresentation,
  preserveColorSpaceValues,
  replaceColorSpaceChannel,
  stepColorValue,
} from '../src/color-space-compare-controls.js';

function approx(actual, expected, epsilon, message) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${message}: expected ${expected}, got ${actual}`);
}

function getConvertedValues(sourceSpace, sourceValues, targetSpace) {
  const xyz = spaceToXyz(sourceSpace, sourceValues);
  const displayRgb = xyzToDisplayRgb(xyz.x, xyz.y, xyz.z);
  return getSpaceValues(targetSpace, xyzToAllSpaces(xyz, displayRgb), displayRgb);
}

// Converted values are allowed to exceed another space's visual slider range.
// Editing one channel in that target space must retain every untouched value.
const convertedOklch = preserveColorSpaceValues(
  'oklch',
  getConvertedValues('oklab', { L: 0.5, a: 0.4, b: 0.4 }, 'oklch')
);
approx(convertedOklch.C, Math.hypot(0.4, 0.4), 1e-12, 'OKLab to OKLCH chroma');
assert.ok(
  convertedOklch.C > COLOR_SPACE_SLIDER_CONFIG.oklch.channels[1].max,
  'The true linked OKLCH chroma must remain above the editable slider range.'
);
const oklchChromaPresentation = getColorSliderPresentation(
  convertedOklch.C,
  COLOR_SPACE_SLIDER_CONFIG.oklch.channels[1]
);
approx(oklchChromaPresentation.value, convertedOklch.C, 1e-15, 'Displayed OKLCH C');
assert.equal(oklchChromaPresentation.sliderValue, 0.4, 'Only the OKLCH C handle is clamped.');
assert.equal(oklchChromaPresentation.ratio, 1);
assert.equal(oklchChromaPresentation.isOutsideRange, true);
const editedOklch = replaceColorSpaceChannel('oklch', convertedOklch, 'L', 0.6);
approx(editedOklch.C, convertedOklch.C, 1e-15, 'Editing OKLCH L must retain linked C');
assert.deepEqual(
  spaceToXyz('oklch', editedOklch),
  spaceToXyz('oklch', { ...convertedOklch, L: 0.6 }),
  'Continuing to edit OKLCH must not jump to a slider-clamped color.'
);

const convertedLab = preserveColorSpaceValues(
  'lab',
  getConvertedValues('lch', { L: 50, C: 200, H: 0 }, 'lab')
);
approx(convertedLab.a, 200, 1e-9, 'LCh D65 to Lab a');
assert.ok(
  convertedLab.a > COLOR_SPACE_SLIDER_CONFIG.lab.channels[1].max,
  'The true linked Lab a value must remain above the editable slider range.'
);
const labAPresentation = getColorSliderPresentation(
  convertedLab.a,
  COLOR_SPACE_SLIDER_CONFIG.lab.channels[1]
);
approx(labAPresentation.value, convertedLab.a, 1e-15, 'Displayed Lab a');
assert.equal(labAPresentation.sliderValue, 128, 'Only the Lab a handle is clamped.');
assert.equal(labAPresentation.ratio, 1);
assert.equal(labAPresentation.isOutsideRange, true);
approx(
  stepColorValue(convertedLab.a, -1, COLOR_SPACE_SLIDER_CONFIG.lab.channels[1]),
  199.9,
  1e-12,
  'Stepping down from out-of-range Lab a must not jump to the slider edge'
);
approx(
  stepColorValue(convertedOklch.C, -1, COLOR_SPACE_SLIDER_CONFIG.oklch.channels[1]),
  convertedOklch.C - 0.001,
  1e-12,
  'Stepping down from out-of-range OKLCH C must preserve the exact model value'
);
const steppedOklch = replaceColorSpaceChannel(
  'oklch',
  convertedOklch,
  'C',
  stepColorValue(convertedOklch.C, -1, COLOR_SPACE_SLIDER_CONFIG.oklch.channels[1]),
  { normalize: false }
);
approx(
  steppedOklch.C,
  convertedOklch.C - 0.001,
  1e-12,
  'The stepped exact value must not be normalized through the visual track'
);
approx(
  stepColorValue(convertedOklch.C, 1, COLOR_SPACE_SLIDER_CONFIG.oklch.channels[1]),
  convertedOklch.C,
  1e-15,
  'Stepping farther outside the editable range must be ignored'
);
const editedLab = replaceColorSpaceChannel('lab', convertedLab, 'L', 60);
approx(editedLab.a, convertedLab.a, 1e-15, 'Editing Lab L must retain linked a');
assert.deepEqual(
  spaceToXyz('lab', editedLab),
  spaceToXyz('lab', { ...convertedLab, L: 60 }),
  'Continuing to edit Lab must not jump to a slider-clamped color.'
);

class FakeInput {
  constructor(value = '') {
    this.value = value;
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  emit(type, event = {}) {
    const normalizedEvent = {
      key: '',
      preventDefault() {},
      stopPropagation() {},
      ...event,
    };
    for (const handler of this.listeners.get(type) ?? []) handler(normalizedEvent);
  }

  focus() {
    this.emit('focus');
  }

  blur() {
    this.emit('change');
    this.emit('blur');
  }
}

function createInputHarness(initialValue, config, initialText = String(initialValue)) {
  const input = new FakeInput(initialText);
  let modelValue = Number(initialValue);
  const transientValues = [];
  const committedValues = [];
  const controller = bindColorNumberInput(input, {
    config,
    getCurrentValue: () => modelValue,
    applyTransientValue: value => {
      modelValue = value;
      transientValues.push(value);
    },
    applyCommittedValue: value => {
      modelValue = value;
      committedValues.push(value);
    },
    stepValue: () => {},
  });
  return { input, controller, transientValues, committedValues, getValue: () => modelValue };
}

function typeDraft(harness, draft, expectedValue) {
  harness.input.value = draft;
  harness.input.emit('input');
  assert.equal(harness.input.value, draft, `Input draft ${JSON.stringify(draft)} must not be rewritten.`);
  if (expectedValue !== undefined) assert.equal(harness.getValue(), expectedValue);
}

const labAConfig = COLOR_SPACE_SLIDER_CONFIG.lab.channels[1];

const multiDigit = createInputHarness(0, labAConfig);
multiDigit.input.focus();
typeDraft(multiDigit, '1', 1);
assert.equal(multiDigit.controller.isEditing(), true);
typeDraft(multiDigit, '12', 12);
assert.equal(multiDigit.committedValues.length, 0, 'Typing digits must not commit or format early.');
multiDigit.input.emit('change');
assert.equal(multiDigit.input.value, '12.0');
assert.equal(multiDigit.committedValues.at(-1), 12);

const negative = createInputHarness(0, labAConfig);
negative.input.focus();
typeDraft(negative, '-', 0);
typeDraft(negative, '-2', -2);
typeDraft(negative, '-20.5', -20.5);
negative.input.emit('keydown', { key: 'Enter' });
assert.equal(negative.input.value, '-20.5');
assert.equal(negative.committedValues.at(-1), -20.5);

const decimal = createInputHarness(0, COLOR_SPACE_SLIDER_CONFIG.oklab.channels[0]);
decimal.input.focus();
typeDraft(decimal, '0', 0);
typeDraft(decimal, '0.', 0);
typeDraft(decimal, '0.4', 0.4);
decimal.input.emit('blur');
assert.equal(decimal.input.value, '0.400');
assert.equal(decimal.committedValues.at(-1), 0.4);

// Merely focusing and leaving a linked out-of-range value must not clamp it.
const linkedValue = createInputHarness(convertedOklch.C, COLOR_SPACE_SLIDER_CONFIG.oklch.channels[1]);
linkedValue.input.focus();
linkedValue.input.emit('blur');
approx(linkedValue.getValue(), convertedOklch.C, 1e-15, 'Untouched linked value');
assert.equal(linkedValue.committedValues.length, 0);

// Empty and invalid drafts restore the precise model snapshot from focus time.
// The formatted DOM text is intentionally rounded to prove it is not used as
// the restoration source.
const exactLinkedChroma = convertedOklch.C;
const linkedChromaConfig = COLOR_SPACE_SLIDER_CONFIG.oklch.channels[1];
const emptyLinkedValue = createInputHarness(exactLinkedChroma, linkedChromaConfig, '0.566');
emptyLinkedValue.input.focus();
typeDraft(emptyLinkedValue, '');
emptyLinkedValue.input.blur();
approx(emptyLinkedValue.getValue(), exactLinkedChroma, 1e-15, 'Empty linked draft restoration');
assert.equal(emptyLinkedValue.input.value, '0.566');
assert.equal(emptyLinkedValue.committedValues.length, 0);

const invalidLinkedValue = createInputHarness(exactLinkedChroma, linkedChromaConfig, '0.566');
invalidLinkedValue.input.focus();
typeDraft(invalidLinkedValue, '0.3', 0.3);
typeDraft(invalidLinkedValue, '-', 0.3);
invalidLinkedValue.input.blur();
approx(invalidLinkedValue.getValue(), exactLinkedChroma, 1e-15, 'Invalid linked draft restoration');
assert.equal(invalidLinkedValue.input.value, '0.566');
assert.equal(invalidLinkedValue.committedValues.length, 0);

const escapedLinkedValue = createInputHarness(exactLinkedChroma, linkedChromaConfig, '0.566');
escapedLinkedValue.input.focus();
typeDraft(escapedLinkedValue, '0.2', 0.2);
escapedLinkedValue.input.emit('keydown', { key: 'Escape' });
approx(escapedLinkedValue.getValue(), exactLinkedChroma, 1e-15, 'Escape linked draft restoration');
assert.equal(escapedLinkedValue.input.value, '0.566');
assert.equal(escapedLinkedValue.committedValues.length, 0);

// A valid user draft is still normalized only when committed.
const clampedCommit = createInputHarness(0.4, COLOR_SPACE_SLIDER_CONFIG.oklab.channels[0], '0.400');
clampedCommit.input.focus();
typeDraft(clampedCommit, '1.5', 1.5);
clampedCommit.input.emit('blur');
assert.equal(clampedCommit.getValue(), 1);
assert.equal(clampedCommit.input.value, '1.000');
assert.deepEqual(clampedCommit.committedValues, [1]);

function createSliderTakeoverHarness(initialValues) {
  const configs = Object.fromEntries(
    COLOR_SPACE_SLIDER_CONFIG.hsl.channels.map(config => [config.key, config])
  );
  let model = preserveColorSpaceValues('hsl', initialValues);
  const inputs = {
    h: new FakeInput(fmtColorNumber(model.h, configs.h.decimals)),
    s: new FakeInput(fmtColorNumber(model.s, configs.s.decimals)),
  };
  const controllers = {};
  const aria = {};
  let dragValues = null;

  function syncPresentation() {
    for (const key of ['h', 's']) {
      const presentation = getColorSliderPresentation(model[key], configs[key]);
      if (!controllers[key]?.isEditing()) {
        inputs[key].value = fmtColorNumber(presentation.value, configs[key].decimals);
      }
      aria[key] = {
        valueNow: presentation.sliderValue,
        valueText: `${fmtColorNumber(presentation.value, configs[key].decimals)}${configs[key].unit}`,
      };
    }
  }

  function applyInputValue(key, value, normalize) {
    model = replaceColorSpaceChannel('hsl', model, key, value, { normalize });
    syncPresentation();
  }

  for (const key of ['h', 's']) {
    controllers[key] = bindColorNumberInput(inputs[key], {
      config: configs[key],
      getCurrentValue: () => model[key],
      applyTransientValue: value => applyInputValue(key, value, false),
      applyCommittedValue: value => applyInputValue(key, value, true),
      stepValue: () => {},
    });
  }
  syncPresentation();

  return {
    inputs,
    controllers,
    aria,
    getModel: () => ({ ...model }),
    pointerDownSlider(key, value) {
      // Mirrors color-space-compare-ui.js: every active editor is finished
      // before the drag base values are captured and the slider takes over.
      for (const controller of Object.values(controllers)) controller.finishEditing();
      dragValues = { ...model };
      model = replaceColorSpaceChannel('hsl', dragValues, key, value);
      syncPresentation();
    },
    pointerUpSlider() {
      dragValues = null;
    },
  };
}

function assertSliderTakeover({ dirty, sliderKey }) {
  const harness = createSliderTakeoverHarness({ h: 30, s: 40, l: 50 });
  harness.inputs.h.focus();
  if (dirty) typeDraft({
    input: harness.inputs.h,
    getValue: () => harness.getModel().h,
  }, '12', 12);

  const sliderValue = sliderKey === 'h' ? 270 : 75;
  harness.pointerDownSlider(sliderKey, sliderValue);
  harness.pointerUpSlider();
  harness.inputs.h.blur();

  const model = harness.getModel();
  assert.equal(model[sliderKey], sliderValue, `${sliderKey} slider result must survive pointerup and blur.`);
  assert.equal(model.h, sliderKey === 'h' ? 270 : dirty ? 12 : 30);
  assert.equal(
    harness.inputs.h.value,
    fmtColorNumber(model.h, COLOR_SPACE_SLIDER_CONFIG.hsl.channels[0].decimals),
    'The formerly focused input must match the final model.'
  );
  assert.equal(harness.aria[sliderKey].valueNow, sliderValue);
  assert.equal(
    harness.aria[sliderKey].valueText,
    `${fmtColorNumber(sliderValue, COLOR_SPACE_SLIDER_CONFIG.hsl.channels[sliderKey === 'h' ? 0 : 1].decimals)}${COLOR_SPACE_SLIDER_CONFIG.hsl.channels[sliderKey === 'h' ? 0 : 1].unit}`
  );
}

assertSliderTakeover({ dirty: true, sliderKey: 'h' });
assertSliderTakeover({ dirty: false, sliderKey: 'h' });
assertSliderTakeover({ dirty: true, sliderKey: 's' });
assertSliderTakeover({ dirty: false, sliderKey: 's' });

// The colour wheels feed the same linked model as the sliders, so every pick
// must normalise onto a valid slider step before it is committed.
const wheelModule = await import('../src/color-space-compare-wheel.js');
assert.equal(
  typeof wheelModule.createColorWheels,
  'function',
  'The wheel factory must be importable without a DOM.'
);
assert.deepEqual(
  wheelModule.COLOR_WHEEL_KINDS.map(kind => kind.id),
  ['hsv', 'hsl'],
  'Both HSV and HSL wheels are required.'
);

const hsvChannels = COLOR_SPACE_SLIDER_CONFIG.hsv.channels;
const hslChannels = COLOR_SPACE_SLIDER_CONFIG.hsl.channels;
const [hueChannel, saturationChannel] = hsvChannels;
for (let step = 0; step < 720; step += 1) {
  const angle = step * 0.5;
  const dot = hueToWheelPoint(angle);
  const hue = normalizeSliderValue(wheelPointToHue(dot.x, dot.y), hueChannel);
  assert.ok(hue >= 0 && hue <= 360, `Wheel hue ${angle} must stay inside the slider range.`);
  approx(Math.abs(hue / hueChannel.step - Math.round(hue / hueChannel.step)), 0, 1e-9,
    `Wheel hue ${angle} must land on a slider step.`);
}

// Pointer positions between the inner shape and the hue ring, and beyond the
// wheel entirely, must clamp into the editable channel range instead of
// producing out-of-domain values.
const strays = [
  { kind: 'hsv', channels: hsvChannels, picked: wheelPointToHsv(0.9, 0.9) },
  { kind: 'hsv', channels: hsvChannels, picked: wheelPointToHsv(-0.9, -0.9) },
  { kind: 'hsl', channels: hslChannels, picked: wheelPointToHsl(5, 5) },
  { kind: 'hsl', channels: hslChannels, picked: wheelPointToHsl(-5, -5) },
];
for (const stray of strays) {
  for (const channel of stray.channels) {
    const raw = channel.key === 'h' ? 0 : stray.picked[channel.key];
    const value = normalizeSliderValue(raw, channel);
    assert.ok(
      value >= channel.min && value <= channel.max,
      `Stray ${stray.kind} ${channel.key} pick must clamp into ${channel.min}..${channel.max}.`
    );
  }
}

function approxXyz(actual, expected, message) {
  approx(actual.x, expected.x, 1e-9, `${message} x`);
  approx(actual.y, expected.y, 1e-9, `${message} y`);
  approx(actual.z, expected.z, 1e-9, `${message} z`);
}

// A wheel pick round-tripped through the shared conversion must reproduce the
// color the wheel was showing.
for (const rgb of [{ r: 30, g: 200, b: 120 }, { r: 240, g: 90, b: 20 }, { r: 12, g: 12, b: 240 }]) {
  const hsv = getConvertedValues('rgb', rgb, 'hsv');
  const hsl = getConvertedValues('rgb', rgb, 'hsl');
  const hsvPoint = hsvToWheelPoint(hsv.s, hsv.v);
  const hslPoint = hslToWheelPoint(hsl.s, hsl.l);
  approxXyz(
    spaceToXyz('hsv', { h: hsv.h, ...wheelPointToHsv(hsvPoint.x, hsvPoint.y) }),
    spaceToXyz('rgb', rgb),
    'HSV wheel pick must preserve the linked color'
  );
  approxXyz(
    spaceToXyz('hsl', { h: hsl.h, ...wheelPointToHsl(hslPoint.x, hslPoint.y) }),
    spaceToXyz('rgb', rgb),
    'HSL wheel pick must preserve the linked color'
  );
}

// Typing a HEX value must move the linked model exactly like the sliders do.
for (const [text, expected] of [['#1A2B3C', { r: 26, g: 43, b: 60 }], ['abc', { r: 170, g: 187, b: 204 }]]) {
  assert.deepEqual(parseHexColor(text), expected, `parseHexColor(${text})`);
  const xyz = spaceToXyz('rgb', expected);
  const presented = xyzToAllSpaces(xyz, xyzToDisplayRgb(xyz.x, xyz.y, xyz.z));
  approxXyz(spaceToXyz('hsl', presented.hsl), xyz, `HEX ${text} must reach the shared model`);
}
assert.equal(parseHexColor('12'), null, 'Incomplete HEX input must not commit a color.');
assert.equal(parseHexColor('#12345'), null, 'Five-digit HEX input must be rejected.');
assert.equal(sanitizeHexText('#1a-2b 3c!!'), '1A2B3C', 'HEX entry must strip separators.');

console.log('Color space compare runtime regression checks passed');
