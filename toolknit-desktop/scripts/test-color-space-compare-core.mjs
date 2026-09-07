import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  COLOR_SPACE_SLIDER_CONFIG,
  COLOR_WHEEL_GEOMETRY,
  COLOR_WHEEL_TRIANGLE,
  LAB_D65_WHITE_POINT,
  cmykToRgb,
  fmtColorNumber,
  getSpaceValues,
  hexCaretAfterSanitize,
  hslToRgb,
  hslToWheelPoint,
  hsvToRgb,
  hsvToWheelPoint,
  hueToWheelPoint,
  labD65ToLch,
  labD65ToRgb,
  labD65ToXyz,
  lchD65ToLab,
  linearToSrgb,
  linearRgbToOklab,
  normalizeSliderValue,
  normalizeSpaceValues,
  oklabInAdobeRgb,
  oklabInDisplayP3,
  oklabInRec2020,
  oklabInSrgbGamut,
  oklabToOklch,
  oklabToRgb,
  oklabToXyz,
  oklchToOklab,
  parseHexColor,
  rgbToAllSpaces,
  rgbToCmyk,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
  rgbToLabD65,
  rgbToOklab,
  rgbValuesToXyz,
  sanitizeHexText,
  srgbToLinear,
  spaceToDisplayRgb,
  spaceToXyz,
  wheelPointToHsl,
  wheelPointToHsv,
  wheelPointToHue,
  wheelRadiusIsRing,
  wheelSquareToHsv,
  wheelTriangleBarycentric,
  xyzToAllSpaces,
  xyzToDisplayRgb,
  xyzToLabD65,
  xyzToLinearAdobeRgb,
  xyzToLinearDisplayP3,
  xyzToLinearRec2020,
  xyzToOklab
} from '../src/color-space-compare-core.js';

function approx(actual, expected, epsilon = 1e-8, message = '') {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon,
    `${message || 'value'}: expected ${expected} ± ${epsilon}, received ${actual}`
  );
}

function approxObject(actual, expected, epsilon = 1e-8, message = '') {
  for (const [key, value] of Object.entries(expected)) {
    approx(actual[key], value, epsilon, `${message}${message ? '.' : ''}${key}`);
  }
}

function approxRgb(actual, expected, epsilon = 1e-5, message = 'RGB') {
  approxObject(actual, expected, epsilon, message);
}

// Slider metadata is complete and immutable so UI controls share one contract.
assert.deepEqual(Object.keys(COLOR_SPACE_SLIDER_CONFIG), [
  'oklch', 'oklab', 'lab', 'lch', 'rgb', 'hsl', 'hsv', 'cmyk'
]);
assert.equal(COLOR_SPACE_SLIDER_CONFIG.rgb.channels[0].max, 255);
assert.equal(COLOR_SPACE_SLIDER_CONFIG.oklch.channels[2].unit, '°');
assert.equal(Object.isFrozen(COLOR_SPACE_SLIDER_CONFIG), true);
assert.equal(Object.isFrozen(COLOR_SPACE_SLIDER_CONFIG.rgb.channels), true);
assert.equal(
  Object.values(COLOR_SPACE_SLIDER_CONFIG).reduce((total, space) => total + space.channels.length, 0),
  25,
  'The desktop UI contract must expose all 25 source-page channels.'
);

// Black, white, red, and neutral gray anchor the encoded-sRGB behavior.
assert.equal(rgbToHex(0, 0, 0), '#000000');
assert.equal(rgbToHex(255, 255, 255), '#FFFFFF');
assert.equal(rgbToHex(255, 0, 0), '#FF0000');
assert.equal(rgbToHex(127.6, -20, 300), '#8000FF');

// CSS Color 4 defines the transfer curves over negative extended-range values
// by reflecting the power-law branch around zero.
approx(srgbToLinear(0.5), 0.21404114048223255, 1e-15, 'sRGB transfer');
approx(srgbToLinear(-0.5), -0.21404114048223255, 1e-15, 'negative sRGB transfer');
approx(linearToSrgb(0.25), 0.5370987304831942, 1e-15, 'sRGB companding');
approx(linearToSrgb(-0.25), -0.5370987304831942, 1e-15, 'negative sRGB companding');

const blackSpaces = rgbToAllSpaces(0, 0, 0);
approxObject(blackSpaces.hsl, { h: 0, s: 0, l: 0 });
approxObject(blackSpaces.hsv, { h: 0, s: 0, v: 0 });
approxObject(blackSpaces.cmyk, { c: 0, m: 0, y: 0, k: 100 });
approxObject(blackSpaces.oklab, { L: 0, a: 0, b: 0 });
approxObject(blackSpaces.lab, { L: 0, a: 0, b: 0 });

const whiteXyz = rgbValuesToXyz({ r: 255, g: 255, b: 255 });
approxObject(whiteXyz, {
  x: LAB_D65_WHITE_POINT.x,
  y: LAB_D65_WHITE_POINT.y,
  z: LAB_D65_WHITE_POINT.z
}, 1e-12, 'white XYZ D65');
const whiteLab = xyzToLabD65(whiteXyz.x, whiteXyz.y, whiteXyz.z);
approxObject(whiteLab, { L: 100, a: 0, b: 0 }, 1e-10, 'white Lab D65');

const redXyz = rgbValuesToXyz({ r: 255, g: 0, b: 0 });
approxObject(redXyz, {
  x: 0.4123907992659593,
  y: 0.2126390058715103,
  z: 0.0193308187155918
}, 1e-12, 'red XYZ');
const redSpaces = rgbToAllSpaces(255, 0, 0);
approxObject(redSpaces.hsl, { h: 0, s: 100, l: 50 });
approxObject(redSpaces.hsv, { h: 0, s: 100, v: 100 });
approxObject(redSpaces.cmyk, { c: 0, m: 100, y: 100, k: 0 });
approxObject(redSpaces.oklab, {
  L: 0.6279553606,
  a: 0.2248630611,
  b: 0.1258462985
}, 1e-7, 'red OKLab');
approxObject(redSpaces.lab, {
  L: 53.2371156,
  a: 80.0901135,
  b: 67.2032635
}, 2e-6, 'red Lab D65');

const greenSpaces = rgbToAllSpaces(0, 255, 0);
approxObject(greenSpaces.oklab, {
  L: 0.866439618,
  a: -0.233887581,
  b: 0.179498445
}, 2e-9, 'green OKLab');
approxObject(greenSpaces.lab, {
  L: 87.735519,
  a: -86.181597,
  b: 83.186620
}, 2e-6, 'green Lab D65');

const blueSpaces = rgbToAllSpaces(0, 0, 255);
approxObject(blueSpaces.oklab, {
  L: 0.452013718,
  a: -0.032456975,
  b: -0.311528166
}, 2e-9, 'blue OKLab');
approxObject(blueSpaces.lab, {
  L: 32.300873,
  a: 79.195270,
  b: -107.855466
}, 2e-6, 'blue Lab D65');

// Published XYZ/OKLab anchors from the original OKLab implementation.
approxObject(xyzToOklab(1, 0, 0), { L: 0.450, a: 1.236, b: -0.019 }, 6e-4, 'XYZ red-axis OKLab');
approxObject(xyzToOklab(0, 1, 0), { L: 0.922, a: -0.671, b: 0.263 }, 6e-4, 'XYZ green-axis OKLab');
approxObject(xyzToOklab(0, 0, 1), { L: 0.153, a: -1.415, b: -0.449 }, 6e-4, 'XYZ blue-axis OKLab');

const graySpaces = rgbToAllSpaces(128, 128, 128);
approxObject(graySpaces.hsl, { h: 0, s: 0, l: 128 / 255 * 100 }, 1e-10, 'gray HSL');
approxObject(graySpaces.hsv, { h: 0, s: 0, v: 128 / 255 * 100 }, 1e-10, 'gray HSV');
approx(graySpaces.oklab.a, 0, 2e-8, 'gray OKLab a');
approx(graySpaces.oklab.b, 0, 3e-8, 'gray OKLab b');

// RGB <-> XYZ and aggregate conversion preserve ordinary in-gamut samples.
const sampleRgb = { r: 12, g: 200, b: 85 };
const sampleXyz = rgbValuesToXyz(sampleRgb);
approxRgb(xyzToDisplayRgb(sampleXyz.x, sampleXyz.y, sampleXyz.z), sampleRgb, 2e-5);
const sampleAll = xyzToAllSpaces(sampleXyz);
assert.deepEqual(Object.keys(sampleAll), ['oklab', 'oklch', 'lab', 'lch', 'hsl', 'hsv', 'cmyk']);
approxRgb(getSpaceValues('rgb', sampleAll, sampleRgb), sampleRgb, 0);
assert.equal(getSpaceValues('lab', sampleAll), sampleAll.lab);
assert.throws(() => getSpaceValues('rgb', sampleAll), TypeError);
assert.throws(() => getSpaceValues('xyz', sampleAll, sampleRgb), RangeError);

for (const [space, values] of Object.entries({ rgb: sampleRgb, ...sampleAll })) {
  approxRgb(
    spaceToDisplayRgb(space, values),
    sampleRgb,
    2e-3,
    `${space} -> XYZ -> display RGB`
  );
}

// HSL, HSV, and device-formula CMYK convert through the same XYZ/display path.
approxRgb(hslToRgb(180, 100, 50), { r: 0, g: 255, b: 255 });
approxRgb(hslToRgb(750, 100, 50), hslToRgb(30, 100, 50), 1e-12, 'wrapped HSL hue');
approxRgb(hslToRgb(-330, 100, 50), hslToRgb(30, 100, 50), 1e-12, 'negative HSL hue');
approxRgb(hsvToRgb(300, 100, 100), { r: 255, g: 0, b: 255 });
approxRgb(hsvToRgb(720, 100, 100), hsvToRgb(0, 100, 100), 1e-12, 'wrapped HSV hue');
approxRgb(hsvToRgb(-120, 100, 100), hsvToRgb(240, 100, 100), 1e-12, 'negative HSV hue');
approxRgb(cmykToRgb(100, 0, 100, 0), { r: 0, g: 255, b: 0 });
approxObject(rgbToHsl(0, 255, 255), { h: 180, s: 100, l: 50 });
approxObject(rgbToHsv(255, 0, 255), { h: 300, s: 100, v: 100 });
approxObject(rgbToCmyk(0, 255, 0), { c: 100, m: 0, y: 100, k: 0 });
approxRgb(spaceToDisplayRgb('hsl', { h: 180, s: 100, l: 50 }), { r: 0, g: 255, b: 255 });
approxRgb(spaceToDisplayRgb('hsv', { h: 300, s: 100, v: 100 }), { r: 255, g: 0, b: 255 });
approxRgb(spaceToDisplayRgb('cmyk', { c: 100, m: 0, y: 100, k: 0 }), { r: 0, g: 255, b: 0 });
approxObject(
  spaceToXyz('rgb', sampleRgb),
  sampleXyz,
  1e-12,
  'spaceToXyz rgb'
);
assert.throws(() => spaceToXyz('unsupported', {}), RangeError);

// OKLab and OKLCH round trips use unclipped XYZ internally.
const sampleOklab = rgbToOklab(sampleRgb.r, sampleRgb.g, sampleRgb.b);
const oklabXyz = oklabToXyz(sampleOklab.L, sampleOklab.a, sampleOklab.b);
approxObject(oklabXyz, sampleXyz, 8e-8, 'OKLab -> XYZ');
approxObject(
  xyzToOklab(oklabXyz.x, oklabXyz.y, oklabXyz.z),
  sampleOklab,
  8e-8,
  'OKLab round trip'
);
approxRgb(oklabToRgb(sampleOklab.L, sampleOklab.a, sampleOklab.b), sampleRgb, 1e-3);
const sampleOklch = oklabToOklch(sampleOklab.L, sampleOklab.a, sampleOklab.b);
approxObject(
  oklchToOklab(sampleOklch.L, sampleOklch.C, sampleOklch.H),
  sampleOklab,
  1e-12,
  'OKLCH round trip'
);
const nearNeutralOklch = oklabToOklch(0.5, 0, 0.000003);
approx(nearNeutralOklch.C, 0.000003, 1e-15, 'powerless OKLCH chroma is retained');
assert.equal(Number.isNaN(nearNeutralOklch.H), true, 'powerless OKLCH hue is missing');

// Lab/LCH intentionally retain the source page's D65 reference-white meaning.
const sampleLabD65 = rgbToLabD65(sampleRgb.r, sampleRgb.g, sampleRgb.b);
const labXyz = labD65ToXyz(sampleLabD65.L, sampleLabD65.a, sampleLabD65.b);
approxObject(labXyz, sampleXyz, 1e-12, 'D65 Lab -> XYZ');
approxObject(
  xyzToLabD65(labXyz.x, labXyz.y, labXyz.z),
  sampleLabD65,
  1e-10,
  'D65 Lab round trip'
);
approxRgb(labD65ToRgb(sampleLabD65.L, sampleLabD65.a, sampleLabD65.b), sampleRgb, 2e-5);
const sampleLchD65 = labD65ToLch(sampleLabD65.L, sampleLabD65.a, sampleLabD65.b);
approxObject(
  lchD65ToLab(sampleLchD65.L, sampleLchD65.C, sampleLchD65.H),
  sampleLabD65,
  1e-12,
  'D65 LCH round trip'
);
approxObject(
  spaceToXyz('lch', sampleLchD65),
  sampleXyz,
  1e-12,
  'D65 LCH -> XYZ'
);
const nearNeutralLch = labD65ToLch(50, 0, 0.001);
approx(nearNeutralLch.C, 0.001, 1e-15, 'powerless LCH chroma is retained');
assert.equal(Number.isNaN(nearNeutralLch.H), true, 'powerless LCH hue is missing');

// Formatting and slider normalization match the original page behavior.
assert.equal(fmtColorNumber(-0.0004, 3), '0.000');
assert.equal(fmtColorNumber(12.345, 1), '12.3');
const hueConfig = COLOR_SPACE_SLIDER_CONFIG.hsl.channels[0];
assert.equal(normalizeSliderValue(12.24, hueConfig), 12);
assert.equal(normalizeSliderValue(12.26, hueConfig), 12.5);
assert.equal(normalizeSliderValue(-8, hueConfig), 0);
assert.equal(normalizeSliderValue(500, hueConfig), 360);
assert.equal(normalizeSliderValue(Number.NaN, hueConfig), null);
assert.deepEqual(normalizeSpaceValues('rgb', { r: 12.6, g: -2, b: '255' }), {
  r: 13,
  g: 0,
  b: 255
});
assert.deepEqual(normalizeSpaceValues('hsl', { h: 24.26, s: undefined, l: 99.9 }), {
  h: 24.5,
  s: 0,
  l: 100
});
assert.throws(() => normalizeSpaceValues('xyz', {}), RangeError);

// Gamut checks include exact neutral boundaries and standard wide-gamut primaries.
for (const check of [
  oklabInSrgbGamut,
  oklabInDisplayP3,
  oklabInAdobeRgb,
  oklabInRec2020
]) {
  assert.equal(check(0, 0, 0), true, `${check.name} includes black`);
  assert.equal(check(1, 0, 0), true, `${check.name} includes D65 white`);
  assert.equal(check(0.5, 1, 1), false, `${check.name} rejects a far out-of-gamut color`);
}

const withinSrgbTolerance = linearRgbToOklab(1.00000005, 0.5, 0.5);
const outsideSrgbTolerance = linearRgbToOklab(1.000001, 0.5, 0.5);
assert.equal(
  oklabInSrgbGamut(withinSrgbTolerance.L, withinSrgbTolerance.a, withinSrgbTolerance.b),
  true
);
assert.equal(
  oklabInSrgbGamut(outsideSrgbTolerance.L, outsideSrgbTolerance.a, outsideSrgbTolerance.b),
  false
);

const displayP3GreenXyz = {
  x: 0.2656676931690931,
  y: 0.6917385218365064,
  z: 0.0451133818589026
};
const displayP3Green = xyzToOklab(
  displayP3GreenXyz.x,
  displayP3GreenXyz.y,
  displayP3GreenXyz.z
);
assert.equal(oklabInDisplayP3(displayP3Green.L, displayP3Green.a, displayP3Green.b), true);
assert.equal(oklabInSrgbGamut(displayP3Green.L, displayP3Green.a, displayP3Green.b), false);
approxObject(
  xyzToLinearDisplayP3(displayP3GreenXyz.x, displayP3GreenXyz.y, displayP3GreenXyz.z),
  { r: 0, g: 1, b: 0 },
  2e-9,
  'Display P3 green primary'
);
approxObject(
  xyzToLinearAdobeRgb(displayP3GreenXyz.x, displayP3GreenXyz.y, displayP3GreenXyz.z),
  { r: 0.135994863, g: 1.042056955, b: -0.032506138 },
  2e-9,
  'P3 green in Adobe RGB (1998)'
);
assert.equal(oklabInAdobeRgb(displayP3Green.L, displayP3Green.a, displayP3Green.b), false);
assert.equal(oklabInRec2020(displayP3Green.L, displayP3Green.a, displayP3Green.b), true);

const rec2020GreenXyz = {
  x: 0.14461690358620838,
  y: 0.6779980715188708,
  z: 0.028072693049087428
};
const rec2020Green = xyzToOklab(rec2020GreenXyz.x, rec2020GreenXyz.y, rec2020GreenXyz.z);
approxObject(rec2020Green, {
  L: 0.829777218,
  a: -0.415774378,
  b: 0.215562492
}, 2e-9, 'Rec.2020 green OKLab');
approxObject(
  xyzToLinearRec2020(rec2020GreenXyz.x, rec2020GreenXyz.y, rec2020GreenXyz.z),
  { r: 0, g: 1, b: 0 },
  2e-9,
  'Rec.2020 green primary'
);
assert.equal(oklabInSrgbGamut(rec2020Green.L, rec2020Green.a, rec2020Green.b), false);
assert.equal(oklabInDisplayP3(rec2020Green.L, rec2020Green.a, rec2020Green.b), false);
assert.equal(oklabInAdobeRgb(rec2020Green.L, rec2020Green.a, rec2020Green.b), false);
assert.equal(oklabInRec2020(rec2020Green.L, rec2020Green.a, rec2020Green.b), true);

// Deterministic property checks exercise ordinary colors through every public
// editor space and the entire configured slider domain.
let randomState = 0x5EEDC0DE;
function randomUnit() {
  randomState = (1664525 * randomState + 1013904223) >>> 0;
  return randomState / 0x100000000;
}

const editableSpaces = Object.keys(COLOR_SPACE_SLIDER_CONFIG);
for (let sample = 0; sample < 1024; sample += 1) {
  const rgb = { r: randomUnit() * 255, g: randomUnit() * 255, b: randomUnit() * 255 };
  const all = rgbToAllSpaces(rgb.r, rgb.g, rgb.b);
  for (const space of editableSpaces) {
    const values = space === 'rgb' ? rgb : all[space];
    approxRgb(spaceToDisplayRgb(space, values), rgb, 5e-4, `random ${space} round trip`);
  }
}

for (const space of editableSpaces) {
  const channels = COLOR_SPACE_SLIDER_CONFIG[space].channels;
  for (let sample = 0; sample < 256; sample += 1) {
    const values = Object.fromEntries(channels.map(channel => [
      channel.key,
      channel.min + randomUnit() * (channel.max - channel.min)
    ]));
    const xyz = spaceToXyz(space, values);
    assert.ok(Object.values(xyz).every(Number.isFinite), `${space} must produce finite XYZ values`);
    const rendered = xyzToDisplayRgb(xyz.x, xyz.y, xyz.z);
    assert.ok(
      Object.values(rendered).every(value => Number.isFinite(value) && value >= 0 && value <= 255),
      `${space} display RGB must stay inside 0..255`
    );
    const oklab = xyzToOklab(xyz.x, xyz.y, xyz.z);
    for (const check of [oklabInSrgbGamut, oklabInDisplayP3, oklabInAdobeRgb, oklabInRec2020]) {
      assert.equal(typeof check(oklab.L, oklab.a, oklab.b), 'boolean');
    }
  }
}

// Wheel geometry must survive a round trip through every editable pick so the
// handle drawn on screen always matches the linked HSV/HSL values.
for (let s = 0; s <= 100; s += 10) {
  for (let v = 0; v <= 100; v += 10) {
    const point = hsvToWheelPoint(s, v);
    const back = wheelPointToHsv(point.x, point.y);
    approx(back.s, s, 1e-9, `HSV wheel round trip s=${s} v=${v}`);
    approx(back.v, v, 1e-9, `HSV wheel round trip s=${s} v=${v}`);
  }
}

// The SV square is rasterised from pixel offsets, so its corners must map to
// the four canonical HSV extremes (white, pure hue, black, black-hue).
const sqHalf = COLOR_WHEEL_GEOMETRY.squareRadius / Math.SQRT2;
{
  const point = wheelSquareToHsv(-sqHalf, -sqHalf, sqHalf);
  approx(point.s, 0, 1e-12, 'SV top-left saturation');
  approx(point.v, 100, 1e-12, 'SV top-left value');
}
{
  const point = wheelSquareToHsv(sqHalf, -sqHalf, sqHalf);
  approx(point.s, 100, 1e-12, 'SV top-right saturation');
  approx(point.v, 100, 1e-12, 'SV top-right value');
}
{
  const point = wheelSquareToHsv(-sqHalf, sqHalf, sqHalf);
  approx(point.s, 0, 1e-12, 'SV bottom-left saturation');
  approx(point.v, 0, 1e-12, 'SV bottom-left value');
}
{
  const point = wheelSquareToHsv(sqHalf, sqHalf, sqHalf);
  approx(point.s, 100, 1e-12, 'SV bottom-right saturation');
  approx(point.v, 0, 1e-12, 'SV bottom-right value');
}
// centre is 50% saturation, 50% value for any square half-width
approx(wheelSquareToHsv(0, 0, sqHalf).s, 50, 1e-12, 'SV centre saturation');
approx(wheelSquareToHsv(0, 0, sqHalf).v, 50, 1e-12, 'SV centre value');

for (let s = 0; s <= 100; s += 10) {
  for (let l = 10; l <= 90; l += 10) {
    const point = hslToWheelPoint(s, l);
    const back = wheelPointToHsl(point.x, point.y);
    approx(back.s, s, 1e-9, `HSL wheel round trip s=${s} l=${l}`);
    approx(back.l, l, 1e-9, `HSL wheel round trip s=${s} l=${l}`);
  }
}

const triangleVertices = [
  { name: 'white', vertex: COLOR_WHEEL_TRIANGLE.white, expected: { bW: 1, bK: 0, bC: 0 } },
  { name: 'black', vertex: COLOR_WHEEL_TRIANGLE.black, expected: { bW: 0, bK: 1, bC: 0 } },
  { name: 'pure hue', vertex: COLOR_WHEEL_TRIANGLE.pure, expected: { bW: 0, bK: 0, bC: 1 } },
];
for (const { name, vertex, expected } of triangleVertices) {
  approxObject(
    wheelTriangleBarycentric(vertex.x, vertex.y),
    expected,
    1e-12,
    `HSL triangle ${name} vertex`
  );
}

// The hue ring and its indicator dot share one angle convention: 0° points to
// three o'clock and the angle grows counter-clockwise on screen.
for (let hue = 0; hue < 360; hue += 15) {
  const dot = hueToWheelPoint(hue);
  approx(wheelPointToHue(dot.x, dot.y), hue % 360, 1e-9, `hue indicator ${hue}`);
  approx(dot.x * dot.x + dot.y * dot.y, COLOR_WHEEL_GEOMETRY.hueDotRadius ** 2, 1e-12, 'hue dot radius');
}
approx(wheelPointToHue(1, 0), 0, 1e-12, 'hue at three o clock');
approx(wheelPointToHue(0, -1), 90, 1e-12, 'hue at twelve o clock');
assert.equal(wheelRadiusIsRing(COLOR_WHEEL_GEOMETRY.ringSplitRatio), true);
assert.equal(wheelRadiusIsRing(COLOR_WHEEL_GEOMETRY.ringSplitRatio - 1e-9), false);

// HEX entry must accept the formats people actually paste and reject the rest.
assert.deepEqual(parseHexColor('#1A2B3C'), { r: 26, g: 43, b: 60 });
assert.deepEqual(parseHexColor('1a2b3c'), { r: 26, g: 43, b: 60 });
assert.deepEqual(parseHexColor('#ABC'), { r: 170, g: 187, b: 204 });
assert.deepEqual(parseHexColor('  #000000  '), { r: 0, g: 0, b: 0 });
for (const invalid of ['', '#', '12345', '1234567', '#GGGGGG', 'rgb(1,2,3)', null, undefined]) {
  assert.equal(parseHexColor(invalid), null, `parseHexColor must reject ${JSON.stringify(invalid)}`);
}
assert.equal(sanitizeHexText('#1a-2b 3c!!'), '1A2B3C');
assert.equal(sanitizeHexText('abcdef123456'), 'ABCDEF');
assert.equal(sanitizeHexText(null), '');
assert.equal(hexCaretAfterSanitize('#1a-2b', 4), 2);
assert.equal(hexCaretAfterSanitize('#1a-2b', 0), 0);
assert.equal(hexCaretAfterSanitize('#1a-2b', 99), 4);

// The desktop integration must remain discoverable, localizable, and wired
// through the 2.1 lazy tool shell rather than an isolated iframe.
const projectRoot = new URL('..', import.meta.url);
const [html, main, styles, ui, wheel, zh, en] = await Promise.all([
  readFile(new URL('index.html', projectRoot), 'utf8'),
  readFile(new URL('src/main.js', projectRoot), 'utf8'),
  readFile(new URL('src/color-space-compare.css', projectRoot), 'utf8'),
  readFile(new URL('src/color-space-compare-ui.js', projectRoot), 'utf8'),
  readFile(new URL('src/color-space-compare-wheel.js', projectRoot), 'utf8'),
  readFile(new URL('src/locales/zh.json', projectRoot), 'utf8').then(JSON.parse),
  readFile(new URL('src/locales/en.json', projectRoot), 'utf8').then(JSON.parse),
]);

assert.match(html, /data-tool="color-space-compare"/, 'Creative tools must list Color Space Compare.');
assert.match(html, /id="colorSpaceCompareOverlay"[^>]*aria-hidden="true"/, 'The lazy overlay host is required.');
assert.doesNotMatch(html, /id="colorSpaceCompareWorkspace"/, 'The content must not use the global Workspace modal convention.');
assert.doesNotMatch(html, /<iframe[^>]+color-space-compare/i, 'The tool must not regress to an isolated iframe.');
assert.match(main, /'color-space-compare':[\s\S]*?import\('\.\/color-space-compare-ui\.js'\)/, 'The tool must use the 2.1 lazy loader.');
assert.match(main, /overlayId:\s*'colorSpaceCompareOverlay'/, 'The lazy tool must target its overlay host.');
assert.match(ui, /toolTopbarMarkup/, 'The shared 2.1 top bar is required.');
assert.match(ui, /mountToolPageBackground/, 'The shared custom-background bridge is required.');
assert.match(ui, /lostpointercapture/, 'Pointer capture loss must clear slider drag state.');
assert.match(ui, /applyValue\(next, null, false\)/, 'Exact out-of-range step values must bypass slider clamping.');
assert.match(ui, /resizeObserver\?\.disconnect\(\)/, 'Closing the page must disconnect its ResizeObserver.');
assert.match(ui, /removeEventListener\('scroll', handleResize\)/, 'Closing the page must release its scroll listener.');
assert.match(ui, /canvas\.width = 1;[\s\S]*?canvas\.height = 1;/, 'Closing the page must release canvas buffers.');
assert.match(styles, /\.color-space-compare-sliders\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2/, 'The desktop two-column controls layout is required.');
assert.match(ui, /createColorWheels/, 'The tool must mount the linked HSV and HSL colour wheels.');
assert.match(ui, /wheels\?\.sync\(\)/, 'Every update must sync the wheels.');
assert.match(ui, /wheels\?\.relayout\(\)/, 'Opening the page must relayout the wheels.');
assert.match(ui, /wheels\?\.destroy\(\)/, 'Closing the page must release wheel canvas buffers.');
assert.match(ui, /parseHexColor/, 'The HEX field must be parsed before it is committed.');
assert.match(ui, /hexInput !== document\.activeElement/, 'Syncing must not overwrite a HEX draft.');
assert.match(wheel, /wheelSquareToHsv\(px, py, squareHalf\)/, 'The SV square must map pixel offsets via wheelSquareToHsv.');
assert.doesNotMatch(wheel, /wheelPointToHsv\(px, py\)/, 'The SV square raster must not feed pixel coordinates to the normalised helper.');
assert.match(styles, /\.color-space-compare-wheel-wrap\s*\{[\s\S]*?aspect-ratio:\s*1/, 'The wheels must stay square.');
assert.match(styles, /\.color-space-compare-hex-row/, 'The HEX entry row requires dedicated styling.');
for (const [locale, dictionary] of [['Chinese', zh], ['English', en]]) {
  assert.equal(typeof dictionary.home?.colorSpaceCompare?.subtitle, 'string', `${locale} tool copy is missing.`);
  assert.equal(typeof dictionary.home?.colorSpaceCompare?.spaces?.rgb, 'string', `${locale} RGB guidance is missing.`);
  assert.equal(typeof dictionary.home?.colorSpaceCompare?.gamutOutside, 'string', `${locale} gamut guidance is missing.`);
  assert.equal(typeof dictionary.home?.colorSpaceCompare?.wheelHint, 'string', `${locale} wheel guidance is missing.`);
  assert.equal(typeof dictionary.home?.colorSpaceCompare?.wheelRoles?.hsv, 'string', `${locale} HSV wheel role is missing.`);
  assert.equal(typeof dictionary.home?.colorSpaceCompare?.wheelRoles?.hsl, 'string', `${locale} HSL wheel role is missing.`);
  assert.equal(typeof dictionary.home?.colorSpaceCompare?.hexInputLabel, 'string', `${locale} HEX field label is missing.`);
  assert.equal(typeof dictionary.home?.toolNames?.colorSpaceCompare, 'string', `${locale} tool-list copy is missing.`);
  assert.equal(typeof dictionary.help?.nav?.colorSpaceCompare, 'string', `${locale} help navigation copy is missing.`);
}

console.log('Color space compare core regression checks passed');
