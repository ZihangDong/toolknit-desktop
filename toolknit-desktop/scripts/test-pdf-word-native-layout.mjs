import assert from 'node:assert/strict';
import { Document, Packer, Paragraph, Math as OfficeMath, MathRun, MathFraction, MathRadical, MathSubScript, MathSuperScript, MathLimitLower, MathLimitUpper, RunProperties, BuilderElement } from 'docx';
import JSZip from 'jszip';
import { createNativeMathMeasurer, NativeMathLayoutError } from '../src/features/pdf-to-word/core/native-math-layout.js';
import { positionedPage } from '../src/features/pdf-to-word/adapters/docx-positioned.js';
import { fitNativeMathGeometry, fitNativeFractionGeometry } from '../src/features/pdf-to-word/core/native-math-fitting.js';

// Fixed Times New Roman metrics at 1000 em keep the reader calibration portable.
// Expected attachment positions below come from independent WPS PDF exports,
// not from this model's formulas. No font binaries or private text are fixtures.
const metrics = { N: [722.1699829101562, 671.875, 15.625], D: [722.1699829101562, 671.875, 0],
  M: [889.1599731445312, 671.875, 0], I: [333.010009765625, 671.875, 0], J: [389.1600036621094, 671.875, 15.625],
  '+': [563.9600219726562, 609.375, -62.5], '(': [333.010009765625, 703.125, 218.75],
  ')': [333.010009765625, 703.125, 218.75], H: [722.1699829101562, 671.875, 0], S: [556.1500244140625, 687.5, 15.625], Z: [610.8400268554688, 671.875, 0], ' ': [250, 0, 0] };
const measure = createNativeMathMeasurer(format => {
  const glyphs = [...format.text].map(text => metrics[text]); assert(glyphs.every(Boolean));
  return { width: Math.max(0, glyphs.reduce((sum, glyph) => sum + glyph[0], 0) * format.size / 1000 * format.scale / 100 + glyphs.length * format.spacing),
    height: Math.max(...glyphs.map(glyph => glyph[1])) * format.size / 1000,
    depth: Math.max(...glyphs.map(glyph => glyph[2])) * format.size / 1000 };
});
class Run extends MathRun {
  constructor(text, size = 8, properties = {}) {
    super({ text, normalText: true, literal: true }); this.props = new RunProperties({ font: 'Times New Roman', size: size * 2, ...properties });
  }
  prepForXml(context) {
    const result = super.prepForXml(context), parts = result['m:r'];
    parts.splice(parts.findIndex(part => part['m:t']), 0, this.props.prepForXml(context)); return result;
  }
}
const xml = component => component.prepForXml({ stack: [] });
const fraction = () => new MathFraction({ numerator: [new Run('N')], denominator: [new Run('D')] });
const expected = { normal: [[-3, -2.4], [-3.6, -3.6]], 'script-row': [[-3, -2.4], [-5.4, -5.4]],
  'fraction-row': [[-3, -2.4], [-9.6, -9.6]], fraction: [[-9.6, -9.6], [-9.6, -9.6]], power: [[-4.8, -4.32], [-4.8, -4.32]] };
for (const [shape, shifts] of Object.entries(expected)) for (const boxed of [false, true]) for (const cramped of [false, true]) {
  let base = shape === 'normal' ? [new Run('N')]
    : shape === 'script-row' ? [new Run('(', 7), new MathSubScript({ children: [new Run('N')], subScript: [new Run('I', 6)] }),
      new Run('+', 12), new MathSubScript({ children: [new Run('M')], subScript: [new Run('J', 6)] }), new Run(')', 7)]
    : shape === 'fraction-row' ? [new Run('(', 7), fraction(), new Run(')', 7)]
    : shape === 'fraction' ? [fraction()] : [new MathSuperScript({ children: [new Run('N')], superScript: [new Run('S')] })];
  if (boxed) base = [new BuilderElement({ name: 'm:box', children: [new BuilderElement({ name: 'm:e', children: base })] })];
  const input = [xml(new MathSuperScript({ children: base, superScript: [new Run('Z')] }))], before = structuredClone(input);
  const actual = measure(input, 8, { direct: true, cramped });
  assert(Math.abs(actual.placement.superscript - shifts[Number(boxed)][Number(cramped)]) <= .2, `${shape}: reader attachment`);
  assert.deepEqual(input, before, 'measurement leaves serialized content and grouping unchanged');
}
for (const [size, numerator, denominator] of [[8, -6, 5.28], [11, -8.4, 7.319], [18, -13.681, 12]]) {
  const actual = measure([xml(fraction())], size, { direct: true });
  assert(Math.abs(actual.placement.numerator - numerator) <= .2);
  assert(Math.abs(actual.placement.denominator - denominator) <= .2);
}
const boxed = child => new BuilderElement({ name: 'm:box', children: [new BuilderElement({ name: 'm:e', children: [child] })] });
const tripleFraction = () => new MathFraction({ numerator: [new Run('NNN')], denominator: [new Run('DDD')] });
// Twelve independently exported WPS cases. A box restores display style in
// numerator/denominator arguments, but does not enlarge script/limit styles.
for (const kind of ['num', 'den', 'sup', 'sub', 'root', 'limit']) for (const wrap of [false, true]) {
  const child = wrap ? boxed(tripleFraction()) : tripleFraction();
  const style = ['num', 'den'].includes(kind) ? { mathLevel: 1 } : ['sup', 'sub', 'limit'].includes(kind) ? { mathLevel: 2, depth: 1 } : {};
  const inner = measure([xml(child)], 8, { ...style, direct: true }), data = [inner.placement.numerator, inner.placement.denominator];
  let shift = 0;
  if (kind === 'num' || kind === 'den') {
    const host = new MathFraction({ numerator: kind === 'num' ? [child] : [new Run('MMM')], denominator: kind === 'den' ? [child] : [new Run('MMM')] });
    shift = measure([xml(host)], 8, { direct: true }).placement[kind === 'num' ? 'numerator' : 'denominator'];
  } else if (kind === 'sup' || kind === 'sub') {
    const host = kind === 'sup' ? new MathSuperScript({ children: [new Run('M')], superScript: [child] })
      : new MathSubScript({ children: [new Run('M')], subScript: [child] });
    shift = measure([xml(host)], 8, { direct: true }).placement[kind === 'sup' ? 'superscript' : 'subscript'];
  } else if (kind === 'limit') shift = measure([xml(new MathLimitLower({ children: [new Run('M')], limit: [child] }))], 8, { direct: true }).placement.lower;
  const expected = kind === 'num' ? wrap ? [-15, -3.6] : [-12.24, -3.6]
    : kind === 'den' ? wrap ? [4.2, 15.6] : [4.2, 12.96]
    : kind === 'sup' ? [-6.96, -.96] : kind === 'sub' ? [.6, 6.6] : kind === 'root' ? [-6, 5.4] : [4.08, 10.08];
  data.forEach((value, index) => assert(Math.abs(value + shift - expected[index]) <= .25, `${kind}, boxed=${wrap}: argument baseline`));
}
// Independent 12-case WPS exports: N at 14 pt with lower/upper normal-text
// arguments at 6 or 12 pt. Both limits must retain the same baseline offsets.
for (const [size, limitSize, lowerShift, upperShift] of [[8, 6, 5.04, -11.16], [8, 12, 6.24, -11.16],
  [12, 6, 7.44, -12.12], [12, 12, 7.44, -12.241]]) {
  const lower = new MathLimitLower({ children: [new Run('N', 14)], limit: [new Run('I', limitSize)] });
  assert(Math.abs(measure([xml(lower)], size, { direct: true }).placement.lower - lowerShift) <= .25);
  for (const base of [[new Run('N', 14)], [lower]]) {
    const upper = new MathLimitUpper({ children: base, limit: [new Run('H', limitSize)] });
    assert(Math.abs(measure([xml(upper)], size, { direct: true }).placement.upper - upperShift) <= .25);
  }
}
const rootSizes = new Map([[9, [20.4951171875, 10.09521484375]], [10.5, [22.91357421875, 12.775146484375]],
  [11, [23.7197265625, 13.66845703125]]]);
for (const offset of [0, -400, 800]) {
  let calls = 0;
  const input = { size: 9, baseline: 649.819 + offset,
    targets: [{ ruleY: 628.418 + offset, ruleWidth: 73.015, bottom: 664.08468 + offset, signWidth: 9.614, height: 35.866184 }],
    fractionCenters: [647.328 + offset] };
  const before = structuredClone(input);
  const fitted = fitNativeMathGeometry({ ...input, measure: (size, baseline) => {
    calls++; const box = rootSizes.get(size); if (!box) return null;
    return [{ ruleY: baseline - box[0] + size * 133 / 2048 * 1.5, bottom: baseline + box[1], height: size * 6828 / 2048 }];
  } });
  assert.equal(fitted.size, 10.5, 'source rule alignment selects the independently rendered passing size');
  assert(Math.abs(fitted.baseline - (650.327267578125 + offset)) < 1e-8);
  assert(calls <= 11, 'fitting has a fixed measurement budget');
  assert.deepEqual(input, before, 'source geometry is not mutated');
}
let badCalls = 0;
assert.equal(fitNativeMathGeometry({ size: 9, baseline: 20, targets: [], fractionCenters: [10], measure: () => { badCalls++; } }), null);
assert.equal(badCalls, 0);
assert.equal(fitNativeMathGeometry({ size: 9, baseline: 20,
  targets: [{ ruleY: 1, ruleWidth: 1, bottom: 2, signWidth: 1, height: 1 }], fractionCenters: [10, 12],
  measure: () => { badCalls++; } }), null, 'different fraction axes must not be moved onto one baseline');
assert.equal(badCalls, 0);
assert.equal(fitNativeMathGeometry({ size: 9, baseline: 20, targets: [{ ruleY: 1, ruleWidth: 1, bottom: 2, signWidth: 1, height: 1 }],
  fractionCenters: [10], measure: () => [{ ruleY: NaN, bottom: 2, height: 1 }] }), null);
for (const offset of [0, 100]) {
  const independent = fitNativeMathGeometry({ size: 8, baseline: 120 + offset, fractionCenters: [],
    targets: [{ ruleY: 100 + offset, ruleWidth: 20, bottom: 118 + offset, signWidth: 4, height: 18 }],
    measure: (_, baseline) => [{ ruleY: baseline - 15, bottom: baseline + 3, height: 18 }] });
  assert.equal(independent.size, 8); assert.equal(independent.baseline, 115 + offset);
  let measurements = 0;
  const result = fitNativeFractionGeometry({ size: 6, baseline: 89 + offset, fractionCenters: [85.68000030517579 + offset],
    targets: [{ ruleY: 85.68000030517579 + offset, width: 21.888 }, { ruleY: 76.80000305175782 + offset, width: 17.808 }],
    measure: (size, baseline) => {
      measurements++;
      const inner = boxed(tripleFraction()), host = new MathFraction({ numerator: [inner], denominator: [new Run('MMM')] });
      const outer = measure([xml(host)], size, { direct: true }).placement;
      const nested = measure([xml(inner)], size, { mathLevel: 1, direct: true }).placement;
      return [baseline + outer.fractionRule, baseline + outer.numerator + nested.fractionRule];
    } });
  assert.equal(result.size, 8, 'independent WPS rule positions select their original structural size');
  assert(Math.abs(result.baseline - (87.96515655517579 + offset)) < 1e-8);
  assert(measurements <= 11);
}
for (const functionUnderTest of [fitNativeMathGeometry, fitNativeFractionGeometry]) {
  assert.equal(functionUnderTest({ size: 8, baseline: 20, fractionCenters: [10], targets: [null, null], measure: () => { throw Error('must not measure invalid geometry'); } }), null);
}
const short = measure([xml(new Run('N', 12))], 12).width;
const condensed = measure([xml(new Run('N', 12, { characterSpacing: -40 }))], 12).width;
assert.equal(short - condensed, 2, 'glyph advance can be condensed without adding a negative spacer');
const blank = measure([xml(new Run(' ', 1, { characterSpacing: -40 }))], 12);
assert.equal(blank.width, 0, 'negative spacer advance clamps to zero');
const unsupported = value => assert.throws(() => measure(value, 11), error => error instanceof NativeMathLayoutError);
unsupported([{ 'm:unrecognized': [] }]);
unsupported([xml(new MathRun({ text: 'N' }))]);
unsupported([xml(new Run('N'.repeat(4097)))]);
unsupported(Array.from({ length: 8193 }, () => xml(new Run('N'))));
for (const [name, value] of [['w:sz', '-2'], ['w:w', '601']]) {
  const malformed = xml(new Run('N')), properties = malformed['m:r'].find(part => part['w:rPr'])['w:rPr'];
  const existing = properties.find(part => Object.hasOwn(part, name));
  if (existing) existing[name] = { _attr: { 'w:val': value } };
  else properties.push({ [name]: { _attr: { 'w:val': value } } });
  unsupported([malformed]);
}
const cycle = { 'm:box': [] }; cycle['m:box'].push({ 'm:e': [cycle] }); unsupported([cycle]);
let deep = xml(new Run('N'));
for (let i = 0; i < 34; i++) deep = { 'm:sSup': [{ 'm:e': [xml(new Run('N'))] }, { 'm:sup': [deep] }] };
unsupported([deep]);
assert.throws(() => measure([xml(new Run('N'))], NaN), NativeMathLayoutError);
assert.throws(() => measure([xml(new Run('N'))], 11, { depth: -1 }), NativeMathLayoutError);
assert.throws(() => createNativeMathMeasurer(() => ({ width: NaN, height: 1, depth: 0 }))([xml(new Run('N'))], 11), NativeMathLayoutError);
const huge = createNativeMathMeasurer(() => ({ width: 10, height: 10000, depth: 0 }));
assert.throws(() => huge([xml(new MathRadical({ children: [new Run('N')] }))], 11), NativeMathLayoutError);
const unmeasured = positionedPage({ width: 200, height: 100, header: [], footer: [], blocks: [
  { type: 'image', rect: { x: 10, y: 10, width: 40, height: 30 }, mathGlyphs: [{ size: 8 }] },
] }, new Map(), { empty: () => new Paragraph(''), mathFor: () => new OfficeMath({ children: [fraction()] }) });
const bytes = await Packer.toBuffer(new Document({ sections: [{ children: unmeasured.children }] }));
const documentXml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string');
assert(documentXml.includes('w:x="200"') && documentXml.includes('w:y="200"'));
assert(!documentXml.includes('NaN') && !documentXml.includes('Infinity'), 'legacy unmeasured formulas keep finite frame coordinates');
console.log('Native math layout checks passed: reader-calibrated scripts/limits, fraction placement, bounded source fitting, glyph/spacer advances and failure handling.');
