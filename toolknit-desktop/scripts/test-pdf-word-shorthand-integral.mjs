import { RunProperties } from 'docx';
import { nativeUnicodeScalarRegion, nativeUnicodeScalarCandidates } from '../src/features/pdf-to-word/core/native-unicode-scalars.js';
import { SHORTHAND_GAMMA, sourceShorthandStyleCovered, sourceShorthandGammaMeasurement } from '../src/features/pdf-to-word/core/source-shorthand-gamma.js';
import { mathUnicodeRunStyle } from '../src/features/pdf-to-word/core/font-style.js';
import { createNativeMathMeasurer, NativeMathLayoutError } from '../src/features/pdf-to-word/core/native-math-layout.js';
// Self-contained focused contract test.
// No PDF, TeX, document inventory, or external fixture input.
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { Document, Packer, Paragraph } from 'docx';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { inferMathAst, validateMathAst, validateMathEvidence } from '../src/features/pdf-to-word/core/math.js';
import { planNativeMathRuns } from '../src/features/pdf-to-word/core/math-limit-runs.js';
import { sourceShorthandEquation } from '../src/features/pdf-to-word/core/source-shorthand-integral.js';
import { nativeMathReaderMode } from '../src/features/pdf-to-word/core/native-math-policy.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import { nativeMath } from '../src/features/pdf-to-word/adapters/docx-math.js';

const MODE = 'xits-shorthand-equation', checks = [];
const check = (name, fn) => { fn(); checks.push(name); };
const symbol = glyph => ({ type: 'symbol', sourceId: glyph.id, text: glyph.text, italic: false, bold: false });
const row = children => children.length === 1 ? children[0] : { type: 'row', children };
const bounds = boxes => ({ x: Math.min(...boxes.map(b => b.x)), y: Math.min(...boxes.map(b => b.y)),
  width: Math.max(...boxes.map(b => b.x + b.width)) - Math.min(...boxes.map(b => b.x)),
  height: Math.max(...boxes.map(b => b.y + b.height)) - Math.min(...boxes.map(b => b.y)) });

/** Analytic native-source contract fixture, not a real-font/reader visual proof.
 * Geometry is generated from em units. Every compound run contains complete
 * per-glyph native offsets, origins, advances and ink bounds. */
function fixture({ em = 14, dx = 0, dy = 0, font = 'ABCDEF+XITSMath-Regular', color = '152638',
  numerator = '3', denominator = ['5', 'η', 'u'], path = '𝑧', integrand = '𝑣', index = '𝑗', start = '2', upper = '𝑟',
  functions = ['𝑝', 'ℋ'], variable = '𝑏', stop = '.', scriptInset = .46 } = {}) {
  const baseline = 6 * em + dy, left = 2 * em + dx, originals = [], flat = [];
  let serial = 0;
  const atom = (text, x, y, width, height, size = em, origin = baseline) => ({ text,
    rect: { x, y, width, height }, size, baseline: origin, baselineX: x, advanceWidth: width + em * .08 });
  const run = parts => {
    const id = 'native-' + serial++, text = parts.map(p => p.text).join('');
    let offset = 0;
    const positions = parts.map(p => {
      const value = { ...p, sourceOffset: offset, spaceBefore: false }; offset += p.text.length; return value;
    });
    const g = { id, sourceIds: [id], text, font, color, preciseInk: true, raster: false, bold: false, italic: false,
      size: parts[0].size, baseline: parts[0].baseline, baselineX: parts[0].baselineX,
      rect: bounds(parts.map(p => p.rect)), order: serial,
      ...(parts.length > 1 ? { mathGlyphPositions: positions } : {}) };
    originals.push(g);
    const leaves = parts.map((p, i) => ({ ...g, text: p.text, rect: p.rect, baseline: p.baseline,
      baselineX: p.baselineX, advanceWidth: p.advanceWidth, mathGlyphPositions: undefined,
      ...(parts.length > 1 ? { id: id + ':math-part:' + positions[i].sourceOffset, splitFrom: id,
        sourceRange: [positions[i].sourceOffset, positions[i].sourceOffset + p.text.length] } : {}) }));
    flat.push(...leaves); return leaves;
  };
  const num = run([atom(numerator, left + em * .8, baseline - em * 1.18, em * .4, em * .68, em, baseline - em * .5)])[0];
  const denParts = denominator.map((c, i) => atom(c, left + em * (.28 + i * .48), baseline - em * .18,
    em * .4, em * .68, em, baseline + em * .5));
  const den = run(denParts);
  const opX = left + em * 2.25;
  const op = run([atom('∫', opX, baseline - em * 1.25, em * .4, em * 2, em, baseline + em * .6)])[0];
  const lower = run([atom(path, opX + em * .45, baseline + em * .5, em * .28, em * .45, em * .7, baseline + em * .9)])[0];
  const body = run([atom(integrand, opX + em * 1.15, baseline - em * .65, em * .45, em * .68)])[0];
  const relationX = body.rect.x + em * .8;
  const equals = run([atom('=', relationX, baseline - em * .35, em * .55, em * .2)])[0];
  const sumX = relationX + em * .9;
  const sigma = run([atom('∑', sumX, baseline - em, em, em * 1.5, em, baseline + em * .4)])[0];
  const limitUpper = run([atom(upper, sumX + em * .3, baseline - em * 1.6, em * .4, em * .4,
    em * .7, baseline - em * 1.2)])[0];
  const limitLower = run([index, '=', start].map((c, i) => atom(c, sumX + em * (-.05 + i * .38),
    baseline + em * .65, em * .32, em * .45, em * .7, baseline + em * 1.1)));
  let pen = sumX + em * 1.2;
  const scalar = (c, width) => { const p = atom(c, pen, baseline - em * .65, em * width, em * .68); pen += em * (width + .1); return p; };
  const factors = []; let punctuation = null;
  for (let i = 0; i < functions.length; i++) {
    const first = i === 0 ? path : integrand;
    const prefix = run([scalar(functions[i], .42), scalar('(', .25), scalar(first, .42), scalar(';', .12), scalar(variable, .45)]);
    const base = prefix.at(-1);
    const sub = run([atom(index, base.rect.x + em * scriptInset, baseline - em * .03, em * .2, em * .45,
      em * .7, baseline + em * .3)])[0];
    pen = base.rect.x + em * .85;
    const closing = run([scalar(')', .25), ...(i === functions.length - 1 && stop ? [scalar(stop, .12)] : [])]);
    const close = closing[0]; if (closing[1]) punctuation = closing[1];
    factors.push(symbol(prefix[0]), row([symbol(prefix[1]), symbol(prefix[2]), symbol(prefix[3]),
      { type: 'script', base: symbol(base), subscript: symbol(sub) }, symbol(close)]));
  }
  const bar = { id: 'native-rule', sourceIds: [], rect: { x: left, y: baseline - em * .25 - em * .025, width: em * 2, height: em * .05 },
    thin: true, color, strokeColor: color, unmapped: false, order: 0, raster: true, reason: 'image',
    path: { id: 'native-rule-path', segment: 0, from: [left + em * .025, baseline - em * .25],
      to: [left + em * 1.975, baseline - em * .25], paint: 'stroke', color,
      strokeRadius: em * .025, joinRadius: em * .025, complete: true } };
  const region = { role: 'math', reasons: [], sourceIds: originals.map(g => g.id), drawingIds: [bar.id],
    rect: bounds([...originals.map(g => g.rect), bar.rect]), mathGlyphs: originals, mathStrokes: [bar] };
  // This expected tree is handwritten during fixture construction, never read
  // from inferMathAst(), planNativeMathRuns(), or the generated DOCX.
  const expected = { type: 'row', children: [{ type: 'fraction', strokeId: bar.id, numerator: symbol(num), denominator: row(den.map(symbol)) },
    { type: 'shorthand-integral', operator: symbol(op), lower: symbol(lower), body: symbol(body) }, symbol(equals),
    { type: 'nary', operator: symbol(sigma), lower: row(limitLower.map(symbol)), upper: symbol(limitUpper), body: row(factors) },
    ...(punctuation ? [symbol(punctuation)] : [])] };
  const semantic = [{ fraction: [numerator, denominator.join('')] },
    { shorthandIntegral: { operator: '∫', lower: path, body: integrand, differentialAbsent: true } }, '=',
    { sum: { operator: '∑', lower: index + '=' + start, upper, body: functions.flatMap((f, i) =>
      [f + '(' + (i === 0 ? path : integrand) + ';', { sub: [variable, index] }, ')']) } }, ...(stop ? [stop] : [])];
  // Adjacent visible strings may be split into separate XML runs.
  const combine = values => { const out = []; for (const value of values) {
    if (typeof value === 'string' && typeof out.at(-1) === 'string') out[out.length - 1] += value; else out.push(value);
  } return out; };
  semantic[3].sum.body = combine(semantic[3].sum.body);
  const sources = originals.map(g => ({ id: g.id, text: g.text, rect: g.rect, order: g.order, disposition: 'editable' }));
  return { region, expected, semantic, originals, sources, bar };
}

// Independent OOXML parser. No converter AST, source evidence, or policy calls.
function actualSemantics(xml) {
  const root = xml2js(xml, { compact: false }), formulas = [];
  const combine = values => { const out = []; for (const value of values) for (const v of Array.isArray(value) ? value : [value]) {
    if (v === '') continue;
    if (typeof v === 'string' && typeof out.at(-1) === 'string') out[out.length - 1] += v; else out.push(v);
  } return out.length === 1 ? out[0] : out; };
  const parse = n => {
    const tag = n.name?.replace(/^m:/, '') || '', children = n.elements || [];
    if (tag.endsWith('Pr') || n.name?.startsWith('w:')) return '';
    const get = role => { const c = children.find(c => c.name === 'm:' + role); assert(c, 'XML role ' + role); return parse(c); };
    if (tag === 'r') return children.filter(c => c.name === 'm:t').map(t => (t.elements || []).map(c => c.text || '').join('')).join('').replace(/\s/gu, '');
    if (tag === 'sSub') return { sub: [get('e'), get('sub')] };
    if (tag === 'f') return { fraction: [get('num'), get('den')] };
    if (tag === 'limLow') return { lower: [get('e'), get('lim')] };
    if (tag === 'limUpp') return { upper: [get('e'), get('lim')] };
    if (tag === 'box') {
      const value = get('e'), seq = Array.isArray(value) ? value : [value], first = seq[0];
      if (first?.sub?.[0] === '∫') return { shorthandIntegral: { operator: '∫', lower: first.sub[1], body: combine(seq.slice(1)), differentialAbsent: true } };
      if (first?.upper?.[0]?.lower?.[0] === '∑') return { sum: { operator: '∑', lower: first.upper[0].lower[1], upper: first.upper[1], body: combine(seq.slice(1)) } };
      return value;
    }
    assert(['oMath', 'e', 'sub', 'lim', 'num', 'den'].includes(tag), 'Unexpected XML structure: ' + tag);
    return combine(children.map(parse));
  };
  let budget = 20000;
  const walk = n => { assert(--budget > 0); if (n.name === 'm:oMath') formulas.push(parse(n)); else for (const c of n.elements || []) walk(c); };
  walk(root); return formulas;
}

for (const options of [{}, { em: 11, dx: 7, dy: 9, font: 'UVWXYZ+XITSMath-Regular',
  numerator: '4', denominator: ['7', 'ξ', 'z'], path: '𝑡', integrand: '𝑤', index: '𝑙', start: '6', upper: '𝑠',
  functions: ['𝑞', 'ℒ'], variable: '𝑐', stop: '' }]) {
  const f = fixture(options), snapshot = structuredClone(f.region), plan = planNativeMathRuns(f.region);
  check('independent handwritten AST matches the full parameterized class', () => {
    assert(plan); assert.deepEqual(plan.ast, f.expected); assert.equal(nativeMathReaderMode(plan.ast, plan.region), MODE);
    assert(validateMathAst(f.expected, plan.region)); assert(sourceShorthandEquation(f.expected, plan.region));
    assert.deepEqual(f.region, snapshot);
  });
  const math = nativeMath(plan.ast, plan.region, { measurementContext: createCanvas(1, 1).getContext('2d') });
  const docx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [math] })] }] }));
  const xml = await (await JSZip.loadAsync(docx)).file('word/document.xml').async('string');
  check('actual OMML exactly matches the independent full-expression oracle', () => assert.deepEqual(actualSemantics(xml), [f.semantic]));
  check('serialized geometry is finite and preserves the source baseline', () => {
    assert(Number.isFinite(math.sourceLayout.measured.width)); assert(Number.isFinite(math.sourceLayout.baseline));
  });
  const bad = (name, change) => check('rejects ' + name, () => {
    const ast = structuredClone(plan.ast), region = structuredClone(plan.region); change(ast, region);
    assert.equal(sourceShorthandEquation(ast, region), false); assert.notEqual(nativeMathReaderMode(ast, region), MODE);
    assert.equal(validateMathEvidence(ast, region), false);
  });
  bad('numerator/denominator swap', a => { const n = a.children[0]; [n.numerator, n.denominator] = [n.denominator, n.numerator]; });
  bad('invented differential', a => { a.children[1].differential = structuredClone(a.children[1].body); });
  bad('optional-differential ordinary integral', a => { a.children[1].type = 'integral'; });
  bad('sum bounds swapped', a => { const n = a.children[3]; [n.lower, n.upper] = [n.upper, n.lower]; });
  bad('truncated function body', a => { a.children[3].body.children.pop(); });
  bad('missing path', a => { delete a.children[1].lower; });
  bad('unknown shorthand property', a => { a.children[1].assumeShorthand = true; });
  bad('path/body source ownership swapped', a => { const n = a.children[1]; [n.lower, n.body] = [n.body, n.lower]; });
  bad('duplicated AST source id', a => { a.children[1].body.sourceId = a.children[1].lower.sourceId; });
  bad('missing row children', a => { delete a.children; });
  bad('mixed source subset', (a, r) => { r.mathGlyphs[0].font = 'QWERTY+XITSMath-Regular'; });
  bad('unknown font', (a, r) => { r.mathGlyphs[0].font = 'Unknown'; });
  bad('raster evidence', (a, r) => { r.mathGlyphs[0].raster = true; });
  bad('OCR evidence', (a, r) => { r.mathGlyphs[0].ocr = true; });
  bad('uncertain ink', (a, r) => { r.mathGlyphs[0].preciseInk = false; });
  bad('uncertain math style', (a, r) => { r.mathGlyphs[0].mathStyleUncertain = true; });
  bad('null glyph', (a, r) => { r.mathGlyphs[0] = null; });
  bad('null original run', (a, r) => { r.shorthandSourceRuns[0] = null; });
  bad('invalid slice offset', (a, r) => { r.mathGlyphs.find(g => g.splitFrom).sourceRange[0]++; });
  bad('unproven original trace', (a, r) => { delete r.shorthandSourceRuns; });
  bad('incomplete native trace', (a, r) => { r.shorthandSourceRuns.find(g => g.mathGlyphPositions).mathGlyphPositions.pop(); });
  bad('changed original run without matching trace', (a, r) => { r.shorthandSourceRuns.find(g => g.mathGlyphPositions).text += 'x'; });
  bad('missing original source', (a, r) => { r.sourceIds.pop(); });
  bad('duplicate source', (a, r) => { r.sourceIds.push(r.sourceIds[0]); });
  bad('duplicate glyph', (a, r) => { r.mathGlyphs.push(structuredClone(r.mathGlyphs[0])); });
  bad('incomplete fraction path', (a, r) => { r.mathStrokes[0].path.complete = false; });
  bad('mixed fraction color', (a, r) => { r.mathStrokes[0].color = 'FF0000'; });
  bad('slanted fraction rule', (a, r) => { r.mathStrokes[0].path.to[1] += 2; });
  bad('glyph/stroke source collision', (a, r) => { r.mathStrokes[0].id = r.mathGlyphs[0].id; });
  bad('unmapped stroke', (a, r) => { r.mathStrokes[0].unmapped = true; });
  bad('extra stroke collision', (a, r) => { r.mathStrokes.push({ ...r.mathStrokes[0], id: 'conflict' }); });
  bad('background overlap', (a, r) => { r.backgroundPaintIndexes = [1]; });
  bad('unaccounted drawing', (a, r) => { r.drawingIds = ['another-rule']; });
  bad('unknown source alphabet', (a, r) => { r.mathGlyphs[0].alphabet = 'doubleStruck'; });
  bad('nonfinite baseline', (a, r) => { r.mathGlyphs[0].baseline = Infinity; });
  bad('oversized AST', a => { a.children.push(...Array.from({ length: 200 }, () => structuredClone(a.children[2]))); });
  bad('cyclic AST', a => { a.children.push(a); });
  check('whole-region closure includes the complete traced closing run', () => {
    const grouped = groupPageRegions(structuredClone(f.originals), [structuredClone(f.bar)], [], structuredClone(f.sources));
    const native = grouped.items.filter(i => i.role === 'math').map(i => planNativeMathRuns(i))
      .filter(p => p && nativeMathReaderMode(p.ast, p.region) === MODE);
    assert.equal(native.length, 1, JSON.stringify({ options, groups: grouped.items.map(g => ({ role: g.role, sourceIds: g.sourceIds, text: g.text })) }));
    assert.deepEqual(native[0].ast, f.expected);
  });
  check('whole-region closure rejects a visible nonmember collision', () => {
    const glyph = { ...structuredClone(f.originals[3]), id: 'foreign-word', sourceIds: ['foreign-word'], text: 'prose',
      font: 'Times-Roman', rect: { ...f.originals[3].rect, width: 2 } };
    const grouped = groupPageRegions([...structuredClone(f.originals), glyph], [structuredClone(f.bar)], [],
      [...structuredClone(f.sources), { id: glyph.id, text: glyph.text, rect: glyph.rect, disposition: 'editable' }]);
    assert(!grouped.items.some(i => { const p = i.role === 'math' && planNativeMathRuns(i); return p && nativeMathReaderMode(p.ast, p.region) === MODE; }));
  });
  check('independent XML oracle rejects a changed coefficient', () => {
    assert.notDeepEqual(actualSemantics(xml.replace('>' + (options.numerator || '3') + '</m:t>', '>9</m:t>')), [f.semantic]);
  });
  for (const [name, pick] of [['ambiguous upper limit', g => g.text === (options.upper || '𝑟')],
    ['ambiguous path limit', g => g.text === (options.path || '𝑧')],
    ['competing closing source', g => /^\)[.,]?$/.test(g.text)]]) {
    check('whole-region closure rejects ' + name, () => {
      const text = structuredClone(f.originals), source = text.find(pick); assert(source);
      const extra = { ...structuredClone(source), id: 'competing-source', sourceIds: ['competing-source'] };
      const grouped = groupPageRegions([...text, extra], [structuredClone(f.bar)], [],
        [...structuredClone(f.sources), { id: extra.id, text: extra.text, rect: extra.rect, disposition: 'editable' }]);
      assert(!grouped.items.some(i => { const p = i.role === 'math' && planNativeMathRuns(i); return p && nativeMathReaderMode(p.ast, p.region) === MODE; }));
    });
  }
}
console.log(checks.length + ' self-contained synthetic shorthand-integral checks passed; no external source assets or reader claims.');
export const syntheticChecksPassed = checks.length;
export { fixture, actualSemantics };

const syntheticTotals={structure:syntheticChecksPassed};
function syntheticNativeContext(){return {font:'',fontKerning:'none',measureText(text){
  return {width:text===' '?278:text==='∫'?800:text==='𝛾'?1076/2048*1000:500,
    actualBoundingBoxLeft:0,actualBoundingBoxRight:500,actualBoundingBoxAscent:1000,actualBoundingBoxDescent:0,
    fontBoundingBoxAscent:1000,fontBoundingBoxDescent:0};
}};}
{
const textWidth = text => text === ' ' ? 278 : text === '∫' ? 800 : 500;
const context = { measureText(text) { return { width: textWidth(text), actualBoundingBoxLeft: 0,
  actualBoundingBoxRight: 500, actualBoundingBoxAscent: 1000, actualBoundingBoxDescent: 0,
  fontBoundingBoxAscent: 1000, fontBoundingBoxDescent: 0 }; } };
const els = n => n?.elements?.filter(e => e.type === 'element') || [];
const own = (n, name) => els(n).find(e => e.name === name);
const all = (n, name) => n?.name === name ? [n] : els(n).flatMap(e => all(e, name));
const text = n => own(n, 'm:t')?.elements?.map(e => e.text || '').join('') || '';
function advance(run, depth) {
  const p = own(run, 'w:rPr'), val = (name, fallback) => Number(own(p, name)?.attributes?.['w:val'] ?? fallback);
  let size = val('w:sz', 22) / 2;
  if (depth) size = Math.floor(size * (depth === 1 ? .73 : .6) * 2) / 2;
  return textWidth(text(run)) * size / 1000 * val('w:w', 100) / 100 + [...text(run)].length * val('w:spacing', 0) / 20;
}
const results = []; let checks = 0;
for (const options of [{ em: 14, scriptInset: .49 }, { em: 11, scriptInset: .51, dx: 9, dy: 7,
  numerator: '4', denominator: ['7', 'ξ', 'z'], path: '𝑡', integrand: '𝑤', index: '𝑙', start: '6', upper: '𝑠',
  functions: ['𝑞', 'ℒ'], variable: '𝑐', stop: '' }, { em: 14, scriptInset: .46 }]) {
  const f = fixture(options), before = structuredClone(f.region);
  const plan = planNativeMathRuns(f.region); assert(plan); assert.deepEqual(plan.ast, f.expected); checks += 2;
  const evidence = plan.region;
  const math = nativeMath(f.expected, evidence, { measurementContext: context });
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [math] })] }] }));
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string');
  assert.deepEqual(actualSemantics(xml), [f.semantic]); checks++;
  assert.deepEqual(f.region, before); checks++;
  const scripts = all(xml2js(xml, { captureSpacesBetweenElements: true }), 'm:sSub'); assert.equal(scripts.length, 3); checks++;
  assert.equal(math.sourceLayout.shorthandAttachments.length, 3); checks++;
  const glyphs = new Map(evidence.mathGlyphs.map(g => [g.id, g]));
  for (const [i, meta] of math.sourceLayout.shorthandAttachments.entries()) {
    const b = glyphs.get(meta.baseSourceId), s = glyphs.get(meta.scriptSourceId);
    // Analytic font has zero left bearing. Source native trace x is the oracle.
    const expected = s.rect.x - b.rect.x;
    const base = all(own(scripts[i], 'm:e'), 'm:r').reduce((v, r) => v + advance(r, 0), 0);
    const leading = els(own(scripts[i], 'm:sub')).filter(r => r.name === 'm:r' && /^\s+$/u.test(text(r)))
      .reduce((v, r) => v + advance(r, 1), 0);
    assert(Math.abs(base + leading - expected) <= .05, JSON.stringify({ expected, base, leading })); checks++;
    const spacing = Number(own(own(all(own(scripts[i], 'm:e'), 'm:r')[0], 'w:rPr'), 'w:spacing')?.attributes?.['w:val'] || 0);
    assert.equal(spacing, Math.round(meta.baseCharacterSpacing)); checks++;
    if (i === 0) { assert(spacing < 0, 'source-proven integral overlap shortens advance'); checks++; }
    else { assert.equal(spacing, 0, 'positive-gap indexed base remains unchanged'); assert(leading > .05);
      assert(base + leading >= expected - 1e-6, 'serialized positive attachment must reach the source origin'); checks += 3; }
    results.push({ em: options.em, role: i ? 'indexed-argument-' + i : 'integral-path', expected, actual: base + leading,
      baseCharacterSpacingTwips: spacing, scriptGap: leading });
  }
  const unmeasured = nativeMath(f.expected, evidence);
  assert.equal(unmeasured.sourceLayout, undefined); checks++;
  // Missing native source trace is rejected before any fitting can run.
  const missing = structuredClone(evidence); delete missing.shorthandSourceRuns;
  assert.throws(() => nativeMath(f.expected, missing, { measurementContext: context }), e => e.code === 'structure'); checks++;
  const excessive = { ...context, measureText(t) { const m = context.measureText(t); return { ...m, width: t === '∫' ? 2000 : m.width }; } };
  assert.throws(() => nativeMath(f.expected, evidence, { measurementContext: excessive }),
    e => e.code === 'native-math-layout', 'unbounded attachment correction refuses'); checks++;
}

syntheticTotals.attachment=checks;
}

{
assert.equal(SHORTHAND_GAMMA.advanceUnits,1076);
assert.equal(SHORTHAND_GAMMA.glyphId,2011);
assert.equal(SHORTHAND_GAMMA.unitsPerEm,2048);
let checks=3,otherGreekLetters=0;
const literal=text=>({'m:r':[{'m:rPr':[{'m:sty':{_attr:{'m:val':'i'}}},{'m:lit':{}}]},new RunProperties({font:'Cambria Math',size:22}).prepForXml({stack:[]}),{'m:t':[text]}]});
for(let point=0x1d6e2;point<=0x1d71b;point++){
 const text=String.fromCodePoint(point),gamma=point===0x1d6fe;
 assert.equal(mathUnicodeRunStyle(text),null);checks++;
 assert.equal(mathUnicodeRunStyle(text,{italicGreek:true}),null,'old broad flag must not enable Greek');checks++;
 assert.equal(mathUnicodeRunStyle(text,{sourceProvenItalicGamma:true}),gamma?'italic':null);checks++;
 assert.equal(sourceShorthandStyleCovered({mathGlyphs:[{text}]}),gamma);checks++;
 const measure=()=>({width:5,height:6,depth:2});
 assert.throws(()=>createNativeMathMeasurer(measure)([literal(text)],11),NativeMathLayoutError);checks++;
 if(!gamma){assert.throws(()=>createNativeMathMeasurer(measure,{sourceProvenItalicGamma:true})([literal(text)],11),NativeMathLayoutError);checks++;if(/^\p{L}$/u.test(text))otherGreekLetters++;}
 else{let seen;createNativeMathMeasurer(format=>{seen=format;return measure();},{sourceProvenItalicGamma:true})([literal(text)],11);assert.equal(seen.italic,false);assert.equal(seen.text,'𝛾');checks+=2;}
}
for(const path of ['𝜆','𝜃','𝛱','𝛴']){
 const f=fixture({path}),plan=planNativeMathRuns(f.region);assert(plan);assert.equal(nativeMathReaderMode(plan.ast,plan.region),null);
 assert.throws(()=>nativeMath(plan.ast,plan.region,{measurementContext:syntheticNativeContext()}),e=>e.code==='native-math-layout');checks+=3;
}
for(const options of [{path:'𝛾'},{em:11,dx:8,dy:13,path:'𝛾',numerator:'4',denominator:['7','ξ','z'],integrand:'𝑤',index:'𝑙',start:'6',upper:'𝑠',functions:['𝑞','ℒ'],variable:'𝑐',stop:''}]){
 const f=fixture(options),before=structuredClone(f.region),plan=planNativeMathRuns(f.region);assert(plan);assert.deepEqual(plan.ast,f.expected);checks+=2;
 assert.equal(nativeMathReaderMode(plan.ast,plan.region),'xits-shorthand-equation');checks++;
 const ctx=syntheticNativeContext(),math=nativeMath(plan.ast,plan.region,{measurementContext:ctx});
 const bytes=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph({children:[math]})]}]}));
 const xml=await(await JSZip.loadAsync(bytes)).file('word/document.xml').async('string');assert.deepEqual(actualSemantics(xml),[f.semantic]);checks++;
 const runs=[];function walk(n){if(n.name==='m:r')runs.push(n);for(const c of n.elements||[])walk(c);}walk(xml2js(xml));
 const greek=runs.filter(r=>r.elements?.find(n=>n.name==='m:t')?.elements?.some(n=>n.text==='𝛾'));assert.equal(greek.length,2);checks++;
 for(const r of greek){const p=r.elements.find(n=>n.name==='m:rPr');assert.equal(p.elements.find(n=>n.name==='m:sty').attributes['m:val'],'i');assert(!p.elements.some(n=>n.name==='m:nor'));checks+=2;}
 assert.deepEqual(f.region,before);checks++;
 assert.throws(()=>nativeMath(plan.ast,plan.region),e=>e.code==='native-math-layout');checks++;
 const fake={measureText(text){ctx.font='1000px "Cambria Math"';const m=ctx.measureText(text);return text==='𝛾'?{width:100,actualBoundingBoxLeft:0,actualBoundingBoxRight:100,actualBoundingBoxAscent:100,actualBoundingBoxDescent:0}:m;}};
 assert.throws(()=>nativeMath(plan.ast,plan.region,{measurementContext:fake}),e=>e.code==='native-math-layout','positive-width missing/substitute glyph rejects');checks++;
 const scalar=structuredClone(plan.region.mathGlyphs.find(g=>g.text==='𝛾'));
 scalar.id='generic-gamma';scalar.sourceIds=[scalar.id];delete scalar.splitFrom;delete scalar.sourceRange;
 const region={role:'math',sourceIds:[scalar.id],mathGlyphs:[scalar],mathStrokes:[],reasons:[],rect:scalar.rect};
 assert.equal(nativeMathReaderMode({type:'symbol',sourceId:scalar.id,text:scalar.text,italic:false,bold:false},region),null);checks++;
}
const ctx=syntheticNativeContext();ctx.font='1000px "Cambria Math"';ctx.fontKerning='none';const measured=ctx.measureText('𝛾');
assert(sourceShorthandGammaMeasurement({font:'Cambria Math',text:'𝛾',metrics:measured}));checks++;
for(const change of [m=>{m.width=1;},m=>{m.width=NaN;},m=>{m.actualBoundingBoxRight=0;m.actualBoundingBoxLeft=0;},m=>{m.actualBoundingBoxAscent=0;m.actualBoundingBoxDescent=0;},m=>{m.actualBoundingBoxLeft=Infinity;}]){
 const m={};for(const k of ['width','actualBoundingBoxLeft','actualBoundingBoxRight','actualBoundingBoxAscent','actualBoundingBoxDescent'])m[k]=measured[k];change(m);assert(!sourceShorthandGammaMeasurement({font:'Cambria Math',text:'𝛾',metrics:m}));checks++;
}
assert(!sourceShorthandGammaMeasurement({font:'Unknown',text:'𝛾',metrics:measured}));checks++;

syntheticTotals.gamma=checks;
}
{
 let count=0;
 const f=fixture({path:'𝛾',integrand:'𝑁',index:'𝑘',upper:'𝑚',functions:['𝑃','ℋ'],variable:'𝑎'});
 const items=structuredClone(f.originals);
 for(const g of items)if([...g.text].length===1){g.advanceWidth=g.rect.width+1;g.glyphPositions=[{text:g.text,rect:{...g.rect},sourceOffset:0}];}
 const sources=items.map(g=>({id:g.id,text:g.text,rect:{...g.rect},order:g.order,disposition:'editable'}));
 const separate={id:'unclaimed',type:'text',text:'𝛱',font:'ABCDEF+XITSMath-Regular',sourceIds:['unclaimed'],
  size:11,baseline:307,baselineX:540,advanceWidth:10,rect:{x:540,y:300,width:9,height:7},
  color:'152638',preciseInk:true,raster:false,bold:false,italic:false,order:100,
  glyphPositions:[{text:'𝛱',sourceOffset:0,rect:{x:540,y:300,width:9,height:7}}]};
 const ledger={id:separate.id,text:separate.text,rect:{...separate.rect},order:100,disposition:'editable'};
 assert(nativeUnicodeScalarCandidates(items,[],sources,[]).length>=3);count++;
 assert.equal(nativeUnicodeScalarCandidates(items,[],sources,[items]).length,0);count++;
 const result=groupPageRegions([...items,separate],[structuredClone(f.bar)],[],[...sources,ledger],{bounds:{x:0,y:0,width:700,height:1000}});
 const compound=result.items.filter(r=>{const p=planNativeMathRuns(r);return r.role==='math'&&r.mathGlyphs?.length>1
  &&sourceShorthandEquation(p?.ast||inferMathAst(r),p?.region||r);});
 assert.equal(compound.length,1,'shorthand owns its full original class before standalone scalar promotion');count++;
 const singletons=result.items.filter(nativeUnicodeScalarRegion);assert.equal(singletons.length,1);count++;
 assert.deepEqual(singletons[0].sourceIds,['unclaimed']);count++;
 const memberIds=new Set(f.originals.map(g=>g.id));assert(!singletons.some(r=>r.sourceIds.some(id=>memberIds.has(id))));count++;
 const compoundPlan=planNativeMathRuns(compound[0]);
 assert.equal(nativeMathReaderMode(compoundPlan?.ast||inferMathAst(compound[0]),compoundPlan?.region||compound[0]),'xits-shorthand-equation');count++;
 assert.equal(nativeMathReaderMode(inferMathAst(singletons[0]),singletons[0]),'unicode');count++;
 syntheticTotals.scalarOwnership=count;
}
export const focusedShorthandChecks=syntheticTotals;
console.log(Object.values(syntheticTotals).reduce((a,b)=>a+b,0)+' pure synthetic shorthand checks passed (source/AST/closure/OMML/attachment/gamma); no external source asset or reader invocation.');
