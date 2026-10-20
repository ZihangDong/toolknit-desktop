// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
// Adapted from docx 9.12.0's equations layout, MIT, Copyright (c) 2016 Dolan.
// Full notice: public/assets/licenses/pdf-word-dependencies.txt.
// Only the normal-text structures emitted by this writer are supported. This
// predicts geometry; actual reader rendering remains the acceptance authority.
const UNITS = 2048;
const CONSTANTS = Object.freeze({ axisHeight: 585, subscriptShiftDown: 418, subscriptTopMax: 760,
  subscriptBaselineDropMin: 320, superscriptShiftUp: 750, superscriptShiftUpCramped: 615,
  superscriptBottomMin: 239, superscriptBaselineDropMax: 460, subSuperscriptGapMin: 300,
  spaceAfterScript: 85, upperLimitGapMin: 133, upperLimitBaselineRiseMin: 500,
  lowerLimitGapMin: 133, lowerLimitBaselineDropMin: 1240,
  fractionNumeratorShiftUp: 1200, fractionNumeratorDisplayStyleShiftUp: 1550,
  fractionDenominatorShiftDown: 1030, fractionDenominatorDisplayStyleShiftDown: 1370,
  fractionNumeratorGapMin: 133, fractionNumDisplayStyleGapMin: 260, fractionRuleThickness: 133,
  fractionDenominatorGapMin: 133, fractionDenomDisplayStyleGapMin: 260,
  radicalVerticalGap: 166, radicalDisplayStyleVerticalGap: 345, radicalRuleThickness: 133,
  radicalExtraAscender: 133, radicalKernBeforeDegree: 133, radicalKernAfterDegree: -640 });
// Cambria Math advance, ink bottom and ink top in font units; no font outlines.
const ROOTS = [[1345, -85, 1886], [1521, -570, 1973], [1537, -1635, 2933],
  [1566, -2745, 4083], [1572, -3895, 5233], [1534, -5045, 6383]];
const SUM = [[1451, -430, 1431], [2715, -1370, 2540]];
const IGNORED = new Set(['_attr', 'm:argPr', 'm:ctrlPr', 'm:oMathPr']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const children = value => Array.isArray(value) ? value.filter(object) : [];
const find = (value, name) => children(value).find(item => Object.hasOwn(item, name))?.[name];
const attributes = value => (Array.isArray(value) ? value.find(item => object(item) && item._attr) : value)?._attr || {};
const off = value => ['0', 'false', 'off'].includes(String(value));
const on = (value, name, prefix = 'm') => find(value, name) !== undefined && !off(attributes(find(value, name))[`${prefix}:val`]);
const property = (value, name) => attributes(find(value, name))['m:val'];
const scriptSize = (size, depth) => depth ? Math.floor(size * (depth === 1 ? .73 : .60) * 2) / 2 : size;
const fontSize = style => scriptSize(style.size, style.level < 2 ? 0 : style.level - 1);
const points = (units, style) => units * fontSize(style) / UNITS;
const constant = (name, style) => points(CONSTANTS[name], style);
const plain = (width, height, depth, characters = false) => ({ width, height, depth, italic: 0, characters });
const glyphBox = ([advance, bottom, top], style) => plain(points(advance, style), points(top, style), points(-bottom, style), true);

export class NativeMathLayoutError extends Error {
  constructor(reason) { super(reason); this.code = 'native-math-layout'; }
}
const fail = reason => { throw new NativeMathLayoutError(reason); };

/** The callback measures the exact font used by the serialized normal-text run.
 * Each invocation has its own traversal budget and script/font contexts.
 */
export function createNativeMathMeasurer(measureRun) {
  if (typeof measureRun !== 'function') throw new TypeError('Math text measurement is required');
  return (equation, size, context = {}) => {
    if (!Number.isFinite(size) || size < .5 || size > 400) fail('Invalid math size');
    const initial = { size, level: context.mathLevel ?? 0, depth: context.depth ?? 0, cramped: Boolean(context.cramped) };
    if (![initial.level, initial.depth].every(value => Number.isInteger(value) && value >= 0 && value <= 32) || initial.level > 3) fail('Invalid math context');
    let visited = 0, textCharacters = 0;
    const budget = (value, nesting) => {
      if (++visited > 32768 || nesting > 128 || Array.isArray(value) && value.length > 8192) fail('Math measurement budget exceeded');
    };
    const checked = box => {
      if (![box.width, box.height, box.depth].every(value => Number.isFinite(value) && Math.abs(value) <= 100000)
        || box.width < 0) fail('Invalid math box');
      return box;
    };
    const row = (parts, style) => {
      const atoms = parts.filter(part => !part.space);
      let width = 0, previous;
      for (const part of parts) {
        if (part.space) { width += part.box.width; continue; }
        const before = previous?.after || previous?.kind;
        if (previous && (part.kind === 'operator' || before === 'operator'
          || style.level < 2 && (before === 'inner' || part.kind === 'inner'))) width += points(UNITS / 6, style);
        width += part.box.width; previous = part;
      }
      return checked(plain(width, Math.max(0, ...atoms.map(part => part.box.height)),
        Math.max(0, ...atoms.map(part => part.box.depth)), atoms.every(part => part.box.characters)));
    };
    const argument = (value, style, nesting) => {
      const adjust = Number(property(find(value, 'm:argPr'), 'm:argSz') ?? 0);
      if (!Number.isInteger(adjust) || Math.abs(adjust) > 2) fail('Unsupported math argument size');
      return row(parts(value, { ...style, depth: Math.max(0, style.depth - adjust) }, nesting), style);
    };
    const scriptStyle = (style, lower = false, levels = 1) => ({ ...style, depth: style.depth + levels,
      level: levels === 2 || style.level >= 2 ? 3 : 2, cramped: lower || style.cramped });
    const limits = (base, lower, upper, style) => {
      const height = upper ? base.height + Math.max(constant('upperLimitBaselineRiseMin', style),
        constant('upperLimitGapMin', style) + upper.depth) + upper.height : base.height;
      const depth = lower ? base.depth + Math.max(constant('lowerLimitBaselineDropMin', style),
        constant('lowerLimitGapMin', style) + lower.height) + lower.depth : base.depth;
      return { ...plain(Math.max(base.width, lower?.width || 0, upper?.width || 0), height, depth),
        placement: { lower: lower ? depth - lower.depth : 0, upper: upper ? -(height - upper.height) : 0 } };
    };
    const attachScripts = (base, sub, sup, style, operator = false) => {
      let up = 0, down = 0;
      if (sup) up = Math.max(constant(style.cramped ? 'superscriptShiftUpCramped' : 'superscriptShiftUp', style),
        base.characters ? 0 : base.height - constant('superscriptBaselineDropMax', style), constant('superscriptBottomMin', style) + sup.depth);
      if (sub) down = Math.max(constant('subscriptShiftDown', style), base.characters ? 0 : base.depth + constant('subscriptBaselineDropMin', style),
        sub.height - constant('subscriptTopMax', style));
      if (sub && sup) {
        const missing = constant('subSuperscriptGapMin', style) - (up - sup.depth - (sub.height - down));
        if (missing > 0) { up += missing / 2; down += missing / 2; }
      }
      return { ...plain(base.width + Math.max(sub?.width || 0, sup?.width || 0) + (operator ? 0 : constant('spaceAfterScript', style)),
        Math.max(base.height, sup ? up + sup.height : 0), Math.max(base.depth, sub ? down + sub.depth : 0)),
        placement: { subscript: down, superscript: -up } };
    };
    const scripts = (value, style, nesting) => {
      const baseParts = parts(find(value, 'm:e'), style, nesting), real = baseParts.filter(part => !part.space);
      if (!real.length) fail('Empty script base');
      const base = row(baseParts, style);
      // Normal-text sequences attach to their final glyph. Explicit boxes and
      // single built-up bases retain their own extent. Verified in WPS probes.
      if (real.at(-1).box.characters) base.characters = true;
      const sub = find(value, 'm:sub') === undefined ? null : argument(find(value, 'm:sub'), scriptStyle(style), nesting);
      const sup = find(value, 'm:sup') === undefined ? null : argument(find(value, 'm:sup'), scriptStyle(style), nesting);
      return attachScripts(base, sub, sup, style);
    };
    const fraction = (value, style, nesting) => {
      if (!['bar', undefined].includes(property(find(value, 'm:fPr'), 'm:type'))) fail('Unsupported fraction type');
      const inner = { ...style, level: style.level < 2 ? 1 : style.level };
      const numerator = argument(find(value, 'm:num'), inner, nesting);
      const denominator = argument(find(value, 'm:den'), { ...inner, cramped: true }, nesting);
      const padded = ['m:num', 'm:den'].some(name => {
        const own = children(find(value, name)).filter(child => !IGNORED.has(Object.keys(child)[0]));
        return own.length === 1 && Object.hasOwn(own[0], 'm:f');
      });
      const axis = constant('axisHeight', style), rule = constant('fractionRuleThickness', style), shown = style.level === 0;
      const up = Math.max(constant(shown ? 'fractionNumeratorDisplayStyleShiftUp' : 'fractionNumeratorShiftUp', style),
        axis + rule / 2 + constant(shown ? 'fractionNumDisplayStyleGapMin' : 'fractionNumeratorGapMin', style) + numerator.depth);
      const down = Math.max(constant(shown ? 'fractionDenominatorDisplayStyleShiftDown' : 'fractionDenominatorShiftDown', style),
        denominator.height - axis + rule / 2 + constant(shown ? 'fractionDenomDisplayStyleGapMin' : 'fractionDenominatorGapMin', style));
      return { ...plain(Math.max(numerator.width, denominator.width) + (padded ? points(UNITS / 5, { ...style, level: 1 }) : 0),
        Math.max(up + numerator.height, axis + rule / 2), Math.max(down + denominator.depth, rule / 2 - axis)),
        placement: { numerator: -up, denominator: down, fractionRule: -axis } };
    };
    const radical = (value, style, nesting) => {
      const body = argument(find(value, 'm:e'), { ...style, cramped: true }, nesting);
      const rule = constant('radicalRuleThickness', style), gap = constant(style.level > 0 ? 'radicalVerticalGap' : 'radicalDisplayStyleVerticalGap', style);
      const tall = least => Math.max(body.height, points(least, style));
      const variants = [1243, 1250, 1260].map(least => ROOTS.findIndex(([, bottom, top]) => points(top - bottom, style) >= tall(least) + body.depth + gap + rule));
      if (variants[0] < 0 || variants[0] !== variants[2]) fail('Unsupported radical size');
      const sign = glyphBox(ROOTS[variants[1]], style);
      const top = Math.max((tall(1250) - body.depth + points(250, style) + sign.height + sign.depth) / 2, body.height + gap + rule);
      const shift = top - sign.height;
      let x = 0, height = top + constant('radicalExtraAscender', style);
      if (!on(find(value, 'm:radPr'), 'm:degHide')) {
        const degree = argument(find(value, 'm:deg'), { ...scriptStyle(style, false, 2), cramped: false }, nesting);
        const raise = (sign.height + sign.depth) * .65 - sign.depth + shift + degree.depth;
        x = Math.max(0, constant('radicalKernBeforeDegree', style) + degree.width + constant('radicalKernAfterDegree', style));
        height = Math.max(height, raise + degree.height);
      }
      return { ...plain(x + sign.width + body.width, height, Math.max(body.depth, sign.depth - shift)),
        placement: { radicalRule: -top + rule / 2, radicalBottom: sign.depth - shift,
          radicalHeight: sign.height + sign.depth } };
    };
    const nary = (value, style, nesting) => {
      const own = find(value, 'm:naryPr');
      if (property(own, 'm:chr') !== '\u2211' || on(own, 'm:grow') || ![undefined, 'undOvr'].includes(property(own, 'm:limLoc'))) fail('Unsupported n-ary operator');
      const sign = glyphBox(SUM[style.level === 0 ? 1 : 0], style), shift = constant('axisHeight', style) - (sign.height - sign.depth) / 2;
      const base = { ...sign, height: sign.height + shift, depth: sign.depth - shift };
      const lower = on(own, 'm:subHide') ? null : argument(find(value, 'm:sub'), scriptStyle(style, true), nesting);
      const upper = on(own, 'm:supHide') ? null : argument(find(value, 'm:sup'), scriptStyle(style), nesting);
      const box = style.level === 0 ? limits(base, lower, upper, style) : lower || upper ? attachScripts(base, lower, upper, style, true) : base;
      const body = argument(find(value, 'm:e'), style, nesting);
      return plain(box.width + points(UNITS / 6, style) + body.width, Math.max(box.height, body.height), Math.max(box.depth, body.depth));
    };
    const matrix = (value, style, nesting) => {
      const props = find(value, 'm:mPr'), rule = Number(property(props, 'm:rSpRule') ?? 0);
      const requested = Number(property(props, 'm:rSp') ?? 0) / 20;
      if (![0, 3].includes(rule) || !Number.isFinite(requested) || requested < 0 || requested > 1440
        || ![undefined, 'center'].includes(property(props, 'm:baseJc'))
        || ['m:cGp', 'm:cGpRule', 'm:cSp'].some(name => Number(property(props, name) ?? 0) !== 0)) fail('Unsupported matrix spacing');
      const rows = children(value).filter(item => item['m:mr']).map(item => children(item['m:mr'])
        .filter(cell => cell['m:e']).map(cell => argument(cell['m:e'], style, nesting + 1)));
      const columns = rows[0]?.length;
      if (rows.length < 2 || rows.length > 16 || !columns || columns > 16 || rows.length * columns > 128
        || rows.some(row => row.length !== columns)) fail('Invalid matrix dimensions');
      const widths = Array.from({ length: columns }, (_, column) => Math.max(...rows.map(row => row[column].width)));
      const heights = rows.map(row => Math.max(...row.map(cell => cell.height))), depths = rows.map(row => Math.max(...row.map(cell => cell.depth)));
      const baselines = [0], minimum = rule === 3 ? requested : points(2401, style);
      for (let index = 1; index < rows.length; index++) baselines.push(baselines.at(-1)
        + Math.max(minimum, depths[index - 1] + heights[index] + points(653, style)));
      const top = heights[0], bottom = baselines.at(-1) + depths.at(-1);
      const shift = constant('axisHeight', style) - (top - bottom) / 2;
      return { ...plain(widths.reduce((sum, value) => sum + value, 0) + fontSize(style) * (columns - 1), top + shift, bottom - shift),
        placement: { matrixRows: baselines.map(value => value - shift), matrixWidths: widths } };
    };
    const run = (value, style) => {
      if (!on(find(value, 'm:rPr'), 'm:nor')) fail('Unsupported nonliteral math text');
      const props = find(value, 'w:rPr'), attr = name => attributes(find(props, name));
      const text = children(value).filter(child => child['m:t']).map(child => Array.isArray(child['m:t'])
        ? child['m:t'].filter(item => typeof item === 'string').join('') : '').join('');
      textCharacters += text.length;
      if (!text || text.length > 4096 || textCharacters > 65536) fail('Math text budget exceeded');
      const ownSize = Number(attr('w:sz')['w:val'] ?? style.size * 2) / 2;
      const format = { text, size: scriptSize(ownSize, style.depth), font: attr('w:rFonts')['w:ascii'] || 'Cambria Math',
        bold: on(props, 'w:b', 'w'), italic: on(props, 'w:i', 'w'), scale: Number(attr('w:w')['w:val'] ?? 100),
        spacing: Number(attr('w:spacing')['w:val'] ?? 0) / 20 };
      if (!Number.isFinite(format.size) || format.size < .5 || format.size > 400 || !Number.isFinite(format.scale)
        || format.scale < 1 || format.scale > 600 || !Number.isFinite(format.spacing) || Math.abs(format.spacing) > 1440
        || typeof format.font !== 'string' || format.font.length > 80) fail('Invalid math text format');
      return { box: checked({ ...measureRun(format), italic: 0, characters: true }), kind: 'ordinary', ...(text.trim() ? {} : { space: true }) };
    };
    const parts = (value, style, nesting = 0) => {
      budget(value, nesting);
      if (style.depth > 32) fail('Math script nesting exceeded');
      const result = [];
      for (const element of children(value)) {
        const names = Object.keys(element);
        if (names.length !== 1) fail('Invalid math element');
        const name = names[0], content = element[name];
        if (IGNORED.has(name)) continue;
        budget(content, nesting);
        if (name === 'm:r') { result.push(run(content, style)); continue; }
        let box, kind = 'ordinary', after;
        if (name === 'm:box') {
          // WPS restores display style inside a box in a fraction argument;
          // script styles remain small. Font depth and cramped state persist.
          const inner = { ...style, level: style.level === 1 ? 0 : style.level };
          const contentParts = parts(find(content, 'm:e'), inner, nesting + 1);
          box = { ...(contentParts.length === 1 ? contentParts[0].box : row(contentParts, inner)), characters: false };
        }
        else if (name === 'm:f') { box = fraction(content, style, nesting + 1); kind = 'inner'; }
        else if (['m:sSub', 'm:sSup', 'm:sSubSup'].includes(name)) box = scripts(content, style, nesting + 1);
        else if (name === 'm:rad') box = radical(content, style, nesting + 1);
        else if (name === 'm:nary') { box = nary(content, style, nesting + 1); kind = 'operator'; after = 'ordinary'; }
        else if (name === 'm:m') box = matrix(content, style, nesting + 1);
        else if (['m:limLow', 'm:limUpp'].includes(name)) {
          const upper = name === 'm:limUpp', base = argument(find(content, 'm:e'), style, nesting + 1);
          const lim = argument(find(content, 'm:lim'), scriptStyle(style, !upper), nesting + 1);
          box = limits(base, upper ? null : lim, upper ? lim : null, style);
        } else fail('Unsupported math structure');
        result.push({ box: checked(box), kind, ...(after ? { after } : {}) });
      }
      if (!result.length) fail('Empty math argument');
      return result;
    };
    const measured = parts(equation, initial);
    return context.direct && measured.length === 1 ? measured[0].box : row(measured, initial);
  };
}
