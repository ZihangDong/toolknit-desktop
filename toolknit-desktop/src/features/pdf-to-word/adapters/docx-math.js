// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { sourceAlignedRow, sourceAlignedMeasurement } from '../core/source-aligned-equations.js';
import { nativeAlignedMath } from './docx-aligned-math.js';
import { sourceUpperAttachment, sourceUpperAttachmentMeasurement } from '../core/source-upper-attachment.js';
import {sourceIndexedSum,sourceIndexedSumMeasurement} from '../core/source-indexed-sum.js';
import {sourceScalarRelation} from '../core/source-scalar-relation.js';
import { sourceFirstLevelIndex } from '../core/source-first-level-index.js';
import { sourceNativeUnicodeScalar, nativeUnicodeScalarMeasurement } from '../core/native-unicode-scalars.js';
import { nativeUnicodeScalarFontCovered } from './native-unicode-scalar-font.js';
import { Math as OfficeMath, MathRun, MathFraction, MathRadical, MathSubScript, MathSuperScript, MathSubSuperScript,
  MathLimitLower, MathLimitUpper, MathSum, MathIntegral, RunProperties, BuilderElement } from 'docx';
import { MathMatrix } from 'docx/math';
import { validateMathAst } from '../core/math.js';
import { wordError } from '../core/input.js';
import { median, union, right } from '../core/geometry.js';
import { mathWordFont } from './docx-fonts.js';
import { mathDisplayText, mathUnicodeRunStyle } from '../core/font-style.js';
import { createNativeMathMeasurer, NativeMathLayoutError } from '../core/native-math-layout.js';
import { fitNativeMathGeometry, fitNativeFractionGeometry } from '../core/native-math-fitting.js';
import { sideMathNaryLimit } from '../core/math-rows.js';
import { sourceShorthandEquation } from '../core/source-shorthand-integral.js';
import { sourceShorthandStyleCovered, sourceShorthandItalicGamma, sourceShorthandGammaMeasurement } from '../core/source-shorthand-gamma.js';

// Cambria Math MATH table: the default Office math face uses 73% and 60%.
const SCRIPT_SCALE = [1, .73, .60];

class SizedMathRun extends MathRun {
  constructor(options, size, properties = {}) {
    super(options);
    this.format = { size, sizeComplexScript: size, font: 'Cambria Math', ...properties };
    this.wordProperties = new RunProperties(this.format);
  }
  prepForXml(context) {
    const result = super.prepForXml(context), content = result['m:r'];
    const text = content.findIndex(child => child['m:t']);
    content.splice(text < 0 ? content.length : text, 0, this.wordProperties.prepForXml(context));
    return result;
  }
}

function sizedStructure(component, tag, pointSize, font, color) {
  const prepare = component.prepForXml.bind(component);
  const properties = new RunProperties({ font, color, size: Math.round(pointSize * 2), sizeComplexScript: Math.round(pointSize * 2) });
  component.prepForXml = context => {
    const value = prepare(context), content = value[tag], key = `${tag}Pr`;
    let holder = content.find(child => Object.hasOwn(child, key));
    if (!holder) { holder = { [key]: [] }; content.unshift(holder); }
    if (!Array.isArray(holder[key])) holder[key] = holder[key] && Object.keys(holder[key]).length ? [holder[key]] : [];
    const own = holder[key];
    own.push({ 'm:ctrlPr': [properties.prepForXml(context)] });
    return value;
  };
  return component;
}

export function nativeMath(ast, region, { measurementContext = null, defaultSize = 11, sourceAlignedRow:alignedContext=null } = {}) {
  if(region?.sourceAlignedEquation!==undefined||ast?.type==='aligned-equations') {
    if(alignedContext!==null)throw new NativeMathLayoutError('Nested aligned row evidence');
    return nativeAlignedMath(ast,region,{measurementContext,defaultSize},nativeMath);
  }
  const alignedRowSource=sourceAlignedRow(ast,region,alignedContext);
  if(alignedContext!==null&&!alignedRowSource)throw new NativeMathLayoutError('Incomplete aligned row evidence');
  if (!validateMathAst(ast, region)) throw wordError('structure');
  const upperSource=sourceUpperAttachment(ast,region);
  if(region.sourceUpperAttachment!==undefined&&!upperSource)throw new NativeMathLayoutError('Incomplete upper attachment AST/source evidence');
  if(upperSource&&(!measurementContext||typeof measurementContext.measureText!=='function'))throw new NativeMathLayoutError('Upper attachment requires font coverage measurement');
  const sumSource=sourceIndexedSum(ast,region);
  if(region.sourceIndexedSum!==undefined&&!sumSource)throw new NativeMathLayoutError('Incomplete indexed sum AST/source');
  if(sumSource&&(!measurementContext||typeof measurementContext.measureText!=='function'))throw new NativeMathLayoutError('Indexed sum requires font coverage');
  const relationSource=sourceScalarRelation(ast,region);
  if(region.sourceScalarRelation!==undefined&&!relationSource)throw new NativeMathLayoutError('Incomplete scalar relation AST/source evidence');
  if(relationSource&&(!measurementContext||typeof measurementContext.measureText!=='function'))
    throw new NativeMathLayoutError('Scalar relation requires native font coverage measurement');
  const indexSource = sourceFirstLevelIndex(ast, region);
  if (region.sourceFirstLevelIndex !== undefined && !indexSource) throw new NativeMathLayoutError('Incomplete first-level index AST/source evidence');
  if (indexSource && (!measurementContext || typeof measurementContext.measureText !== 'function'))
    throw new NativeMathLayoutError('First-level index requires native font coverage measurement');
  if (indexSource) {
    const previousFont=measurementContext.font, previousKerning=measurementContext.fontKerning;
    try {
      measurementContext.font='1000px "Cambria Math"';measurementContext.fontKerning='none';
      for (const glyph of [indexSource.base,indexSource.index])
        if (!nativeUnicodeScalarMeasurement({font:'Cambria Math',text:glyph.text,metrics:measurementContext.measureText(glyph.text)}))
          throw new NativeMathLayoutError('First-level index font coverage unavailable');
    } catch {
      throw new NativeMathLayoutError('First-level index font coverage unavailable');
    } finally {measurementContext.font=previousFont;measurementContext.fontKerning=previousKerning;}
  }
  const scalarSource = sourceNativeUnicodeScalar(region);
  if (region.sourceNativeUnicodeScalar !== undefined && !scalarSource)
    throw new NativeMathLayoutError('Incomplete source Unicode scalar evidence');
  if (scalarSource && !nativeUnicodeScalarFontCovered(region, measurementContext))
    throw new NativeMathLayoutError('Source Unicode scalar font coverage/metrics unavailable');
  // The complete bounded source proof is required; a reader-mode flag alone
  // never enables attachment fitting for an ordinary equation.
  const shorthandGreekStyle = sourceShorthandEquation(ast, region);
  if (shorthandGreekStyle && !sourceShorthandStyleCovered(region))
    throw new NativeMathLayoutError('Unverified shorthand italic character');
  if (shorthandGreekStyle && region.mathGlyphs.some(g => sourceShorthandItalicGamma(g.text)) && !measurementContext)
    throw new NativeMathLayoutError('Shorthand gamma requires native font measurement');
  const sourceAttachments = Boolean(measurementContext && (shorthandGreekStyle || indexSource || relationSource || sumSource || upperSource));
  const attachmentGeometry = new Map();
  const matrixNodes = [];
  const collectMatrices = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'matrix') matrixNodes.push(node);
    Object.values(node).forEach(value => Array.isArray(value) ? value.forEach(collectMatrices) : collectMatrices(value));
  };
  collectMatrices(ast);
  const size = Math.max(2, Math.min(800, Math.round(Math.max(...region.mathGlyphs.map(glyph => glyph.size)) * 2)));
  const metrics = new Map();
  const measureSourceText = text => {
    try {return measurementContext.measureText(text);}
    catch (error) {if(indexSource || relationSource || sumSource || upperSource || alignedRowSource) throw new NativeMathLayoutError('First-level index font measurement unavailable');throw error;}
  };
  const measureGlyph = glyph => {
    const font = mathWordFont(glyph);
    measurementContext.font = `${!glyph.alphabet && glyph.italic ? 'italic ' : ''}${!glyph.alphabet && glyph.bold ? 'bold ' : ''}1000px "${font}"`;
    measurementContext.fontKerning = 'none';
    const displayText = mathDisplayText(glyph.text, glyph.alphabet, glyph.bold);
    if (displayText === null) throw wordError('structure');
    const measured = measureSourceText(displayText), inkHeight = measured.actualBoundingBoxAscent + measured.actualBoundingBoxDescent;
    if (shorthandGreekStyle && sourceShorthandItalicGamma(displayText)
      && !sourceShorthandGammaMeasurement({font,text:displayText,metrics:measured}))
      throw new NativeMathLayoutError('Unverified shorthand gamma font coverage');
    if ((scalarSource || indexSource || relationSource && glyph.id===relationSource.base.id) && !nativeUnicodeScalarMeasurement({ font, text: displayText, metrics: measured }))
      throw new NativeMathLayoutError('Unverified source Unicode scalar glyph measurement');
    if(sumSource&&!sourceIndexedSumMeasurement(displayText,measured))throw new NativeMathLayoutError('Unverified indexed sum glyph');
    if(upperSource)for(const c of displayText)if(!sourceUpperAttachmentMeasurement(font,c,measureSourceText(c)))throw new NativeMathLayoutError('Unverified upper attachment cmap/hmtx coverage');
    if(alignedRowSource)for(const c of displayText)if(!sourceAlignedMeasurement(font,c,measureSourceText(c)))throw new NativeMathLayoutError('Unverified aligned cmap/hmtx coverage');
    const inferredSize = inkHeight > 0 ? glyph.rect.height * 1000 / inkHeight : glyph.size;
    const pointSize = Math.round(inferredSize * 2) / 2;
    if (!Number.isFinite(pointSize) || pointSize < .5 || pointSize > 400) throw wordError('structure');
    const inkWidth = measured.actualBoundingBoxLeft + measured.actualBoundingBoxRight;
    const scale = inkWidth > 0 ? Math.max(25, Math.min(400, Math.round(glyph.rect.width * 100000 / (inkWidth * pointSize)))) : 100;
    return { ...glyph, font, pointSize, scale,
      advance: measured.width / 1000 * pointSize * scale / 100,
      left: measured.actualBoundingBoxLeft / 1000 * pointSize * scale / 100,
      inkAscent: measured.actualBoundingBoxAscent / 1000,
      ascent: measured.fontBoundingBoxAscent / 1000, descent: measured.fontBoundingBoxDescent / 1000 };
  };
  if (measurementContext) for (const glyph of region.mathGlyphs) metrics.set(glyph.id, measureGlyph(glyph));
  const delimiterCache = new Map();
  const matrixDelimiter = (node, side) => {
    const ids = side === 'left' ? node.leftGlyphIds : node.rightGlyphIds, key = JSON.stringify(ids);
    if (!delimiterCache.has(key)) {
      const sources = ids.map(id => metrics.get(id)), rect = union(sources.map(item => item.rect));
      const text = node.brackets === 'round' ? side === 'left' ? '(' : ')' : side === 'left' ? '[' : ']';
      delimiterCache.set(key, measureGlyph({ ...sources[0], text, rect, font: 'Cambria Math', bold: false, italic: false, alphabet: undefined }));
    }
    return delimiterCache.get(key);
  };
  const strokes = new Map((region.mathStrokes || []).map(stroke => [stroke.id, stroke]));
  const bounds = node => node.type === 'symbol' ? metrics.get(node.sourceId).rect : node.type === 'row'
    ? union(node.children.map(bounds)) : node.type === 'accent' ? union([metrics.get(node.sourceId).rect, bounds(node.base)]) : node.type === 'fraction'
      ? union([bounds(node.numerator), bounds(node.denominator), strokes.get(node.strokeId).rect])
      : node.type === 'radical' ? union([bounds(node.radicand), ...node.strokeIds.map(id => strokes.get(id).rect),
        ...(node.glyphIds || []).map(id => metrics.get(id).rect), ...(node.degree ? [bounds(node.degree)] : [])])
      : node.type === 'limit' ? union([bounds(node.base), ...(node.lower ? [bounds(node.lower)] : []), ...(node.upper ? [bounds(node.upper)] : [])])
      : node.type === 'matrix' ? union([...node.leftGlyphIds, ...node.rightGlyphIds].map(id => metrics.get(id).rect).concat(node.rows.flat().map(bounds)))
      : ['nary', 'integral', 'shorthand-integral'].includes(node.type) ? union([bounds(node.operator), bounds(node.body), ...(node.differential ? [bounds(node.differential)] : []), ...(node.lower ? [bounds(node.lower)] : []), ...(node.upper ? [bounds(node.upper)] : [])])
      : union([bounds(node.base), ...(node.subscript ? [bounds(node.subscript)] : []), ...(node.superscript ? [bounds(node.superscript)] : [])]);
  const origin = node => node.type === 'symbol' ? metrics.get(node.sourceId).rect.x + metrics.get(node.sourceId).left
    : node.type === 'row' ? origin(node.children[0]) : ['script', 'accent'].includes(node.type) ? origin(node.base)
      : node.type === 'matrix' ? matrixDelimiter(node, 'left').rect.x + matrixDelimiter(node, 'left').left
      : ['radical', 'limit', 'nary', 'integral', 'shorthand-integral'].includes(node.type) ? bounds(node).x : sumSource?strokes.get(node.strokeId).path.from[0]:strokes.get(node.strokeId).rect.x;
  const width = node => node.type === 'symbol' ? metrics.get(node.sourceId).advance : node.type === 'row'
    ? origin(node.children.at(-1)) - origin(node.children[0]) + width(node.children.at(-1))
    : node.type === 'fraction' ? sumSource?strokes.get(node.strokeId).path.to[0]-strokes.get(node.strokeId).path.from[0]:strokes.get(node.strokeId).rect.width : right(bounds(node)) - origin(node);
  const visibleZeroWidth=runs=>new BuilderElement({name:'m:phant',children:[new BuilderElement({name:'m:phantPr',children:[
    new BuilderElement({name:'m:show',attributes:{val:{key:'m:val',value:'1'}}}),
    new BuilderElement({name:'m:zeroWid',attributes:{val:{key:'m:val',value:'1'}}})]}),new BuilderElement({name:'m:e',children:runs})]});
  const gapRun = points => new SizedMathRun({ text: ' ', ...(alignedRowSource?{style:'italic'}:{normalText:true}), literal: true }, 2,
    { font: 'Arial', characterSpacing: Math.round((points - .278) * 20) });
  const symbols = node => node.type === 'symbol' ? [metrics.get(node.sourceId)] : node.type === 'row'
    ? node.children.flatMap(symbols) : node.type === 'fraction' ? [...symbols(node.numerator), ...symbols(node.denominator)]
      : node.type === 'radical' ? symbols(node.radicand) : node.type === 'matrix' ? node.rows.flat().flatMap(symbols)
      : ['nary', 'integral', 'shorthand-integral'].includes(node.type) ? symbols(node.body) : symbols(node.base);
  const control = (component, tag, node) => {
    if (!metrics.size) return component;
    const selected = symbols(node), pointSize = median(selected.map(item => item.pointSize));
    const color = node.type === 'radical' ? strokes.get(node.strokeIds[0])?.path?.color || strokes.get(node.strokeIds[0])?.color
      : node.type === 'fraction' ? strokes.get(node.strokeId)?.color : selected[0].color;
    const result = sizedStructure(component, tag, pointSize, selected[0].font, /^[0-9a-f]{6}$/i.test(color || '') ? color : undefined);
    return tag === 'm:f' ? new BuilderElement({ name: 'm:box', children: [new BuilderElement({ name: 'm:e', children: [result] })] }) : result;
  };
  const bases = node => node.type === 'symbol' ? [metrics.get(node.sourceId)] : node.type === 'row'
    ? node.children.flatMap(bases) : ['script', 'limit', 'accent'].includes(node.type) ? bases(node.base) : node.type === 'radical' ? bases(node.radicand)
      : ['nary', 'integral', 'shorthand-integral'].includes(node.type) ? bases(node.body) : [];
  const referenceBaseline = node => metrics.size ? median(bases(node).map(item => item.baseline)) : 0;
  const mainMetricRuns = metrics.size ? bases(ast) : [];
  const firstGlyph = node => node.type === 'symbol' ? metrics.get(node.sourceId)
    : node.type === 'row' ? firstGlyph(node.children[0]) : node.type === 'fraction' ? firstGlyph(node.numerator)
    : node.type === 'matrix' ? firstGlyph(node.rows[0][0])
    : node.type === 'radical' ? firstGlyph(node.degree || node.radicand) : ['nary', 'integral', 'shorthand-integral'].includes(node.type) ? firstGlyph(node.body) : firstGlyph(node.base);
  const firstAtom = node => node.type === 'row' ? firstAtom(node.children[0]) : node;
  let nativeSize = metrics.size ? firstAtom(ast).type === 'fraction' ? defaultSize : firstGlyph(ast).pointSize : size / 2;
  const measure = measurementContext && createNativeMathMeasurer(format => {
    measurementContext.font = `${format.italic ? 'italic ' : ''}${format.bold ? 'bold ' : ''}1000px "${format.font}"`;
    measurementContext.fontKerning = 'none';
    const value = measureSourceText(format.text), scale = format.size / 1000;
    return { width: Math.max(0, value.width * scale * format.scale / 100 + [...format.text].length * format.spacing),
      height: value.actualBoundingBoxAscent * scale, depth: value.actualBoundingBoxDescent * scale };
  }, { sourceProvenItalicGamma: shorthandGreekStyle, sourceProvenUnicodeScalar: scalarSource ? region : null, sourceIndexRegion: indexSource ? region : null, sourceScalarRelationRegion: relationSource ? region : null, sourceIndexedSumRegion:sumSource?region:null,sourceUpperAttachmentRegion:upperSource?region:null,sourceAlignedRow:alignedRowSource?alignedContext:null });
  const measuredWidth = (runs, level = 0, style = { level: 0, cramped: false }) => measure(
    runs.map(run => run.prepForXml({ stack: [] })), nativeSize, { mathLevel: style.level, cramped: style.cramped, depth: level }).width;
  const nativePlacement = (component, level, style) => measure([component.prepForXml({ stack: [] })], nativeSize,
    { mathLevel: style.level, cramped: style.cramped, depth: level, direct: true }).placement;
  const rootGeometry = new Map(), fractionGeometry = new Map();
  const children = (node, level = 0, baseline = referenceBaseline(node), style = { level: 0, cramped: false }) => {
    if (node.type === 'accent') {
      if (!metrics.size || level || style.level > 1) throw new NativeMathLayoutError('Unverified accent context');
      const source = metrics.get(node.sourceId), body = children(node.base, level, baseline, style);
      const padding = 2 * (source.rect.x + source.rect.width / 2 - origin(node.base)) - measuredWidth(body, level, style);
      if (!Number.isFinite(padding) || padding < -.1 || padding > source.size * .5) throw new NativeMathLayoutError('Unverified accent alignment');
      const controlSize = Math.round(source.size * 2);
      return [new BuilderElement({ name: 'm:acc', children: [new BuilderElement({ name: 'm:accPr', children: [
        new BuilderElement({ name: 'm:chr', attributes: { val: { key: 'm:val', value: node.text } } }),
        new BuilderElement({ name: 'm:ctrlPr', children: [new RunProperties({ font: 'Cambria Math', size: controlSize,
          sizeComplexScript: controlSize, color: /^[0-9a-f]{6}$/i.test(source.color || '') ? source.color : undefined })] })] }),
        new BuilderElement({ name: 'm:e', children: [...body, ...(padding > .05 ? [gapRun(padding)] : [])] })] })];
    }
    if (node.type === 'matrix') {
      if (!metrics.size) return [new MathMatrix({ brackets: node.brackets, rows: node.rows.map(row => row.map(cell => children(cell, level, undefined, style))) })];
      if (level || style.level > 1) throw new NativeMathLayoutError('Scripted matrix placement is not yet verified');
      style = { ...style, level: 0 };
      const rowBaselines = node.rows.map(row => median(row.flatMap(cell => bases(cell)).map(item => item.baseline)));
      const rowDrop = median(rowBaselines.slice(1).map((value, index) => value - rowBaselines[index]));
      if (!(rowDrop > 0) || rowBaselines.slice(1).some((value, index) => Math.abs(value - rowBaselines[index] - rowDrop) > .35))
        throw new NativeMathLayoutError('Nonuniform matrix row spacing');
      const starts = node.rows[0].map((_, index) => Math.min(...node.rows.map(row => origin(row[index]))));
      const raw = node.rows.map(row => row.map(cell => children(cell, level, undefined, style)));
      const widths = starts.map((start, column) => Math.max(...node.rows.map((row, index) => origin(row[column]) - start + measuredWidth(raw[index][column], level, style))));
      const targets = widths.map((width, column) => column + 1 < starts.length ? starts[column + 1] - starts[column] - nativeSize : width);
      if (targets.some((target, column) => target < widths[column] - .1)) throw new NativeMathLayoutError('Matrix columns need a smaller native gap');
      const padded = (cell, column, targetBaseline) => {
        const runs = children(cell, level, targetBaseline, style), inset = origin(cell) - starts[column];
        const after = targets[column] - inset - measuredWidth(runs, level, style);
        return [...(inset > .05 ? [gapRun(inset)] : []), ...runs, ...(after > .05 ? [gapRun(after)] : [])];
      };
      const matrix = rows => {
        const result = new MathMatrix({ rows, columnAlignment: 'left' }), prepare = result.prepForXml.bind(result);
        result.prepForXml = context => {
          const value = prepare(context), properties = value['m:m'].find(child => child['m:mPr'])['m:mPr'];
          properties.push({ 'm:rSpRule': { _attr: { 'm:val': 3 } } }, { 'm:rSp': { _attr: { 'm:val': Math.round(rowDrop * 20) } } });
          return value;
        };
        return result;
      };
      const initial = matrix(node.rows.map(row => row.map((cell, column) => padded(cell, column))));
      const shifts = nativePlacement(initial, level, style);
      const content = matrix(node.rows.map((row, index) => row.map((cell, column) => padded(cell, column, baseline + shifts.matrixRows[index]))));
      const delimiterRun = source => new SizedMathRun({ text: source.text, literal: true, normalText: true }, source.pointSize * 2,
        { font: source.font, scale: source.scale, color: /^[0-9a-f]{6}$/i.test(source.color || '') ? source.color : undefined,
          position: Math.round((baseline - source.rect.y - source.inkAscent * source.pointSize) * 2) });
      const left = matrixDelimiter(node, 'left'), last = matrixDelimiter(node, 'right'), leading = delimiterRun(left);
      leading.format.characterSpacing = Math.round((starts[0] - origin(node) - left.advance) * 20);
      leading.wordProperties = new RunProperties(leading.format);
      const inset = last.rect.x + last.left - starts[0] - measuredWidth([content], level, style);
      if (inset < -.5) throw new NativeMathLayoutError('Matrix cells exceed the closing delimiter');
      return [new BuilderElement({ name: 'm:box', children: [new BuilderElement({ name: 'm:e', children: [leading, content,
        ...(inset > .05 ? [gapRun(inset)] : []), delimiterRun(last)] })] })];
    }
    if (node.type === 'symbol') {
      const source = metrics.get(node.sourceId);
      const unicodeStyle = !node.alphabet && mathUnicodeRunStyle(node.text, { sourceProvenItalicGamma: shorthandGreekStyle, sourceProvenUnicodeScalar: scalarSource || Boolean(relationSource && node.sourceId===relationSource.base.id), sourceIndexRegion: indexSource ? region : null });
      if (source) {
        // Compensate the script level using the actual serialized half-points.
        // The internal native path still requires independent reader validation.
        const scale = SCRIPT_SCALE[Math.min(level, 2)];
        const halfPoints = Math.max(2, Math.min(800, Math.ceil(source.pointSize * 2 / scale)));
        const effectiveSize = level ? Math.floor(halfPoints * scale) / 2 : halfPoints / 2;
        return [new SizedMathRun({ text: mathDisplayText(node.text, node.alphabet, node.bold), literal: true,
          normalText: !unicodeStyle, ...(unicodeStyle ? { style: unicodeStyle } : {}) },
          halfPoints,
          { font: source.font, scale: Math.max(25, Math.min(400, Math.round(source.scale * source.pointSize / effectiveSize))),
            color: /^[0-9a-f]{6}$/i.test(source.color || '') ? source.color : undefined,
            position: Math.round((baseline - source.rect.y - source.inkAscent * effectiveSize) * 2),
            bold: !node.alphabet && node.bold || undefined, italics: !node.alphabet && node.italic || undefined })];
      }
      if (node.alphabet) return [new SizedMathRun({ text: mathDisplayText(node.text, node.alphabet, node.bold),
        literal: true, normalText: true }, size)];
      return [new SizedMathRun({ text: node.text, literal: true,
        style: unicodeStyle || (node.bold ? node.italic ? 'boldItalic' : 'bold' : node.italic ? 'italic' : 'plain') }, size)];
    }
    if (node.type === 'row') {
      if (!metrics.size) return node.children.flatMap(child => children(child, level, baseline));
      const runs = []; let cursor = origin(node);
      for (const [index, child] of node.children.entries()) {
        const gap = origin(child) - cursor;
        if (gap > .05) runs.push(gapRun(gap));
        const actualRuns = children(child, level, baseline, style), next = node.children[index + 1];
        let actualWidth = measuredWidth(actualRuns, level, style);
        if (child.type === 'accent' && next && origin(child) + actualWidth > origin(next) + .15)
          throw new NativeMathLayoutError('Accent argument exceeds the following source gap');
        if (child.type === 'symbol' && [...child.text].length === 1 && next && actualRuns.length === 1) {
          const desired = origin(next) - origin(child);
          if (desired > 0 && desired < actualWidth) {
            const run = actualRuns[0]; run.format.characterSpacing = Math.round((desired - actualWidth) * 20);
            run.wordProperties = new RunProperties(run.format); actualWidth = measuredWidth(actualRuns, level, style);
          }
        }
        runs.push(...actualRuns); cursor = Math.max(cursor, origin(child)) + actualWidth;
      }
      return runs;
    }
    if (node.type === 'fraction') {
      if (metrics.size && style.level === 1) style = { ...style, level: 0 };
      const argument = (child, targetBaseline) => {
        const inner = { level: style.level < 2 ? 1 : style.level, cramped: style.cramped || child === node.denominator };
        const runs = children(child, level, targetBaseline, inner);
        if (!metrics.size) return runs;
        if(sumSource){
          const source=strokes.get(node.strokeId),start=source.path.from[0],target=source.path.to[0]-start,before=origin(child)-start,after=target-before;
          if(!Number.isFinite(before+after)||before<-.05||after<=0||target>source.rect.width)throw new NativeMathLayoutError('Unverified source fraction argument extent');
          return [...(before>.05?[gapRun(before)]:[]),visibleZeroWidth(runs),gapRun(after)];
        }
        const bar = strokes.get(node.strokeId).rect, before = origin(child) - bar.x, after = right(bar) - origin(child) - measuredWidth(runs, level, inner);
        return [...(before > .05 ? [gapRun(before)] : []), ...runs, ...(after > .05 ? [gapRun(after)] : [])];
      };
      const initial = control(new MathFraction({ numerator: argument(node.numerator), denominator: argument(node.denominator) }), 'm:f', node);
      if (!metrics.size) return [initial];
      const shifts = nativePlacement(initial, level, style);
      const result = control(new MathFraction({ numerator: argument(node.numerator, baseline + shifts.numerator),
        denominator: argument(node.denominator, baseline + shifts.denominator) }), 'm:f', node);
      fractionGeometry.set(node, baseline + shifts.fractionRule);
      return [result];
    }
    if (node.type === 'radical') {
      const content = children(node.radicand, level, baseline, { ...style, cramped: true });
      const degree = node.degree ? children(node.degree, level + 2) : undefined;
      const create = values => control(new MathRadical({ children: values, ...(degree ? { degree } : {}) }), 'm:rad', node);
      let component = create(content);
      if (!metrics.size) return [component];
      const intrinsicInset = measuredWidth([component], level, style) - measuredWidth(content, level, { ...style, cramped: true });
      const inset = origin(node.radicand) - origin(node) - intrinsicInset;
      if (inset > .05) {
        const effectiveSize = level ? Math.floor(nativeSize * 2 * SCRIPT_SCALE[Math.min(level, 2)]) / 2 : nativeSize;
        content.unshift(new SizedMathRun({ text: ' ', normalText: true, literal: true }, Math.round(nativeSize * 2),
          { font: 'Arial', characterSpacing: Math.round((inset - .278 * effectiveSize) * 20) }));
        component = create(content);
      }
      const delta = width(node) - measuredWidth([component], level, style);
      const result = delta > .05 ? create([...content, gapRun(delta)]) : component;
      const placement = nativePlacement(result, level, style);
      rootGeometry.set(node, { ruleY: baseline + placement.radicalRule,
        bottom: baseline + placement.radicalBottom, height: placement.radicalHeight });
      return [result];
    }
    if (node.type === 'limit') {
      let result = children(node.base, level, baseline, style);
      if (node.lower) result = [control(new MathLimitLower({ children: result, limit: children(node.lower, level + 1) }), 'm:limLow', node.base)];
      if (node.upper) result = [control(new MathLimitUpper({ children: result, limit: children(node.upper, level + 1) }), 'm:limUpp', node.base)];
      return result;
    }
    if (node.type === 'shorthand-integral') {
      const script = { type: 'script', base: node.operator, subscript: node.lower };
      const head = children(script, level, baseline, style), body = children(node.body, level, baseline, style);
      const inset = metrics.size ? origin(node.body) - origin(node.operator) - measuredWidth(head, level, style) : 0;
      return [new BuilderElement({ name: 'm:box', children: [new BuilderElement({ name: 'm:e', children: [
        ...head, ...(inset > .05 ? [gapRun(inset)] : []), ...body] })] })];
    }
    if (node.type === 'nary' || node.type === 'integral') {
      const integral = node.type === 'integral';
      const body = integral ? { type: 'row', children: [node.body, node.differential] } : node.body;
      const Constructor = integral ? MathIntegral : MathSum;
      if (!metrics.size) return [control(new Constructor({ children: children(body, level, baseline, style), limits: integral ? 'side' : 'aboveBelow',
        ...(node.lower ? { subScript: children(node.lower, level + 1) } : {}),
        ...(node.upper ? { superScript: children(node.upper, level + 1) } : {}) }), 'm:nary', node)];
      if (style.level === 1) style = { ...style, level: 0 };
      const sourceOperator = region.mathGlyphs.find(glyph => glyph.id === node.operator.sourceId);
      const limitGlyphs = value => value.type === 'symbol' ? [region.mathGlyphs.find(glyph => glyph.id === value.sourceId)]
        : value.type === 'row' ? value.children.flatMap(limitGlyphs) : [];
      const side = !integral && (sumSource&&node.operator.sourceId===sumSource.operator.id || [node.lower, node.upper].filter(Boolean)
        .every(limit => sideMathNaryLimit(sourceOperator, limitGlyphs(limit), limit === node.upper)));
      if (side) {
        const script = { type: 'script', base: node.operator,
          ...(node.lower ? { subscript: node.lower } : {}), ...(node.upper ? { superscript: node.upper } : {}) };
        const head = children(script, level, baseline, style);
        const inset = origin(body) - origin(node.operator) - measuredWidth(head, level, style);
        return [new BuilderElement({ name: 'm:box', children: [new BuilderElement({ name: 'm:e', children: [
          ...head, ...(inset > .05 ? [gapRun(inset)] : []), ...children(body, level, baseline, style)] })] })];
      }
      // Office's fixed n-ary glyph ignores source width/height. Keep the actual
      // operator editable, attach native limits, and group it with its body.
      const block = union([bounds(node.operator), ...(node.lower ? [bounds(node.lower)] : []), ...(node.upper ? [bounds(node.upper)] : [])]);
      const argument = (child, depth, target, innerStyle) => {
        const runs = children(child, depth, target, innerStyle), start = origin(child) - block.x;
        const end = block.width - start - measuredWidth(runs, depth, innerStyle);
        return [...(start > .05 ? [gapRun(start)] : []), ...runs, ...(end > .05 ? [gapRun(end)] : [])];
      };
      let result = argument(node.operator, level, baseline, style);
      const inner = { level: style.level < 2 ? 2 : 3, cramped: style.cramped };
      for (const [key, Constructor] of [['lower', MathLimitLower], ['upper', MathLimitUpper]]) if (node[key]) {
        const initial = new Constructor({ children: result, limit: argument(node[key], level + 1, undefined, inner) });
        const shifts = nativePlacement(initial, level, style);
        result = [new Constructor({ children: result, limit: argument(node[key], level + 1, baseline + shifts[key], inner) })];
      }
      const inset = origin(body) - block.x - measuredWidth(result, level, style);
      return [new BuilderElement({ name: 'm:box', children: [new BuilderElement({ name: 'm:e', children: [
        ...result, ...(inset > .05 ? [gapRun(inset)] : []), ...children(body, level, baseline, style)] })] })];
    }
    const baseRuns = children(node.base, level, baseline, style);
    if (sourceAttachments && metrics.size && node.base.type === 'symbol' && (node.subscript && !node.superscript || (relationSource || upperSource) && node.superscript && !node.subscript) && baseRuns.length === 1) {
      const desired = origin(node.subscript || node.superscript) - origin(node.base), actual = measuredWidth(baseRuns, level, style);
      if (!Number.isFinite(desired) || desired <= 0) throw new NativeMathLayoutError('Unverified shorthand attachment origin');
      if (desired < actual) {
        const delta = desired - actual, source = metrics.get(node.base.sourceId);
        // Fit advance only: font, ink scale, point size and vertical position
        // remain source-bound. Reject a large correction instead of clipping.
        if (Math.abs(delta) > Math.min(actual * .35, source.pointSize * .25))
          throw new NativeMathLayoutError('Shorthand attachment exceeds bounded base fitting');
        const run = baseRuns[0];
        run.format.characterSpacing = (run.format.characterSpacing || 0) + Math.round(delta * 20);
        run.wordProperties = new RunProperties(run.format);
      }
    }
    if(sumSource&&node.base.type==='accent'&&node.subscript&&!node.superscript){
      const desired=origin(node.subscript)-origin(node.base),actual=measuredWidth(baseRuns,level,style);
      if(!Number.isFinite(desired)||desired<=0||actual-desired<0||actual-desired>sumSource.base.size*.25)throw new NativeMathLayoutError('Unverified accented source advance');
      const visible=visibleZeroWidth([...baseRuns]);
      baseRuns.splice(0,baseRuns.length,visible,gapRun(desired));
    }
    const serializedBaseAdvance = sourceAttachments && metrics.size ? measuredWidth(baseRuns, level, style) : null;
    let attachmentPlacement = null;
    const scriptArgument = (child, targetBaseline) => {
      const runs = children(child, level + 1, targetBaseline, { level: style.level < 2 ? 2 : 3, cramped: style.cramped });
      if (!metrics.size) return runs;
      const nativeX = attachmentPlacement?.[child === node.subscript ? 'subscriptX' : 'superscriptX'] ?? serializedBaseAdvance;
      const gap = origin(child) - origin(node.base) - (sourceAttachments ? nativeX : width(node.base));
      if (gap <= .05) return runs;
      const space = upperSource && node.superscript ? new SizedMathRun({ text: ' ', style: 'italic', literal: true }, 2,
    { font: 'Arial', characterSpacing: Math.round((gap - .278) * 20) }) : gapRun(gap);
      if (sourceAttachments) {
        const inner = { level: style.level < 2 ? 2 : 3, cramped: style.cramped };
        // Measure the intrinsic serialized space before fitting. Measuring an
        // already negatively spaced run can hit the nonnegative-width clamp.
        space.format.characterSpacing = 0;
        space.wordProperties = new RunProperties(space.format);
        const actual = measuredWidth([space], level + 1, inner);
        // A one-point space shrinks at native script depth. Fit the actual
        // serialized advance in this context, including half-point rounding.
        // Quantize the serialized positive gap upward to the least twip that
        // reaches its source origin. Nearest rounding can underfill it.
        space.format.characterSpacing = Math.ceil((gap - actual) * 20);
        space.wordProperties = new RunProperties(space.format);
        const fittedGap = measuredWidth([space], level + 1, inner);
        if (fittedGap < gap - 1e-6 || fittedGap > gap + 1 / 20 + 1e-6)
          throw new NativeMathLayoutError('Shorthand source gap is not represented within one twip');
      }
      return [space, ...runs];
    };
    const options = { children: baseRuns,
      ...(node.subscript ? { subScript: scriptArgument(node.subscript) } : {}),
      ...(node.superscript ? { superScript: scriptArgument(node.superscript) } : {}) };
    const both = node.subscript && node.superscript;
    const createScript = values => control(both ? new MathSubSuperScript(values) : node.subscript ? new MathSubScript(values) : new MathSuperScript(values),
      both ? 'm:sSubSup' : node.subscript ? 'm:sSub' : 'm:sSup', node.base);
    const initial = createScript(options);
    if (!metrics.size) return [initial];
    const shifts = nativePlacement(initial, level, style);
    if (sourceAttachments) {
      attachmentPlacement = shifts;
      if (![shifts.baseAdvance, shifts.subscriptX, shifts.superscriptX].every(Number.isFinite))
        throw new NativeMathLayoutError('Missing shorthand attachment measurement');
      attachmentGeometry.set(node.base.sourceId, { baseSourceId: node.base.sourceId, scriptSourceId: node.subscript?.sourceId,
        sourceBaseAdvance: width(node.base), serializedBaseAdvance, nativeSubscriptX: shifts.subscriptX,
        sourceSubscriptX: node.subscript ? origin(node.subscript) - origin(node.base) : null,
        baseCharacterSpacing: baseRuns[0]?.format?.characterSpacing || 0,
        ...(upperSource?{scriptSourceIds:upperSource.glyphs.filter(g=>g.id!==node.base.sourceId&&g.baseline<upperSource.main.baseline).map(g=>g.id),nativeSuperscriptX:shifts.superscriptX,sourceSuperscriptX:origin(node.superscript)-origin(node.base)}:{}),
        ...(relationSource?{superscriptSourceId:node.superscript?.sourceId,nativeSuperscriptX:shifts.superscriptX,
          sourceSuperscriptX:origin(node.superscript)-origin(node.base)}:{}) });
    }
    return [createScript({ children: options.children,
      ...(node.subscript ? { subScript: scriptArgument(node.subscript, baseline + shifts.subscript) } : {}),
      ...(node.superscript ? { superScript: scriptArgument(node.superscript, baseline + shifts.superscript) } : {}) })];
  };
  let globalBaseline = mainMetricRuns.length ? median(mainMetricRuns.map(item => item.baseline))
    : matrixNodes.length ? (() => { const node = matrixNodes[0], rect = bounds(node); return rect.y + rect.height / 2
      + metrics.get(node.leftGlyphIds[0]).size * .25; })()
    : region.mathStrokes?.[0]?.rect ? region.mathStrokes[0].rect.y + region.mathStrokes[0].rect.height / 2 + nativeSize * .25 : region.baseline;
  let fitted = false;
  if (metrics.size) {
    const roots = [], fractionCenters = [];
    const visit = node => {
      if (node.type === 'fraction') {
        const bar = strokes.get(node.strokeId).rect, center = bar.y + bar.height / 2;
        if (Math.abs(center + nativeSize * 585 / 2048 - globalBaseline) < nativeSize / 2) fractionCenters.push(center);
      } else if (node.type === 'radical') {
        if (node.strokeIds.length) roots.push(node);
        visit(node.radicand);
      } else if (node.type === 'row') node.children.forEach(visit);
      else if (['script', 'limit', 'accent'].includes(node.type)) visit(node.base);
      else if (node.type === 'nary' || node.type === 'integral' || node.type === 'shorthand-integral') visit(node.body);
    };
    visit(ast);
    const originalSize = nativeSize, originalBaseline = globalBaseline;
    const targets = roots.map(node => {
      const ownStrokes = node.strokeIds.map(id => strokes.get(id));
      const sign = union(node.glyphIds?.length ? node.glyphIds.map(id => metrics.get(id).rect) : ownStrokes.map(stroke => stroke.rect));
      const horizontal = ownStrokes.filter(stroke => stroke.path && Math.abs(stroke.path.from[1] - stroke.path.to[1]) < .1 || stroke.rect.height < .7);
      const bar = horizontal.map(stroke => stroke.rect).sort((a, b) => b.width - a.width)[0];
      if (!bar) return null;
      return { ruleY: bar.y + bar.height / 2, ruleWidth: bar.width, bottom: sign.y + sign.height,
        signWidth: node.glyphIds?.length ? sign.width : Math.max(.5, bar.x - sign.x), height: sign.height };
    });
    const fit = fitNativeMathGeometry({ size: nativeSize, baseline: globalBaseline, targets, fractionCenters,
      measure: (nextSize, nextBaseline) => {
        nativeSize = nextSize; globalBaseline = nextBaseline; rootGeometry.clear();
        try { children(ast, 0, globalBaseline); }
        catch (error) { if (error?.code !== 'native-math-layout') throw error; return null; }
        return roots.map(node => rootGeometry.get(node));
      } });
    nativeSize = fit?.size ?? originalSize; globalBaseline = fit?.baseline ?? originalBaseline; fitted = Boolean(fit);
  }
  if (metrics.size && !fitted) {
    const fractions = [], fractionCenters = []; let nested = false, hasRoot = false;
    const visit = (node, depth = 0, main = true) => {
      if (node.type === 'radical') hasRoot = true;
      if (node.type === 'fraction') {
        const bar = strokes.get(node.strokeId).rect;
        if (depth) nested = true;
        else if (main) fractionCenters.push(bar.y + bar.height / 2);
        fractions.push(node); depth++;
      }
      for (const [key, value] of Object.entries(node)) if (value && typeof value === 'object') {
        if (Array.isArray(value)) value.forEach(child => child?.type && visit(child, depth, main));
        else if (value.type) visit(value, depth, main && !['numerator', 'denominator', 'degree', 'upper', 'lower', 'subscript', 'superscript'].includes(key));
      }
    };
    visit(ast);
    if (nested && !hasRoot) {
      const originalSize = nativeSize, originalBaseline = globalBaseline;
      const fit = fitNativeFractionGeometry({ size: nativeSize, baseline: globalBaseline, fractionCenters,
        targets: fractions.map(node => { const bar = strokes.get(node.strokeId).rect; return { ruleY: bar.y + bar.height / 2, width: bar.width }; }),
        measure: (nextSize, nextBaseline) => {
          nativeSize = nextSize; globalBaseline = nextBaseline; fractionGeometry.clear();
          try { children(ast, 0, globalBaseline); }
          catch (error) { if (error?.code !== 'native-math-layout') throw error; return null; }
          return fractions.map(node => fractionGeometry.get(node));
        } });
      nativeSize = fit?.size ?? originalSize; globalBaseline = fit?.baseline ?? originalBaseline; fitted = Boolean(fit);
    }
  }
  fitted ||= matrixNodes.length > 0;
  const result = new OfficeMath({ children: [...(fitted ? [new SizedMathRun({ text: ' ', normalText: true, literal: true }, nativeSize * 2,
    { font: 'Times New Roman', characterSpacing: -Math.ceil(nativeSize * .25 * 20) })] : []), ...children(ast, 0, metrics.size ? globalBaseline : undefined)] });
  if (metrics.size) {
    const primary = bases(ast), main = primary.length ? primary : matrixNodes.length ? matrixNodes.flatMap(symbols) : [...metrics.values()];
    const startsWithStructure = node => ['fraction', 'radical', 'limit', 'nary', 'integral', 'matrix', 'shorthand-integral'].includes(node.type) || node.type === 'row' && startsWithStructure(node.children[0])
      || node.type === 'script' && startsWithStructure(node.base);
    const pointSize = median(main.map(item => item.pointSize)), font = main[0].font;
    const bar = region.mathStrokes?.[0]?.rect;
    const baseline = fitted ? globalBaseline : primary.length ? median(primary.map(item => item.baseline)) : bar ? bar.y + bar.height / 2 + pointSize * .25 : region.baseline;
    let ascent = 0, descent = 0;
    for (const [index, item] of main.entries()) {
      const rise = Math.round((baseline - item.rect.y - item.inkAscent * item.pointSize) * 2) / 2;
      ascent = Math.max(ascent, item.ascent * item.pointSize + rise);
      descent = Math.max(descent, item.descent * item.pointSize - rise);
      if (!index) { ascent = Math.max(ascent, item.ascent * item.pointSize); descent = Math.max(descent, item.descent * item.pointSize); }
    }
    if (region.rect) {
      ascent = Math.max(ascent, baseline - region.rect.y);
      descent = Math.max(descent, region.rect.y + region.rect.height - baseline);
    }
    const height = Math.max(Math.max(...main.map(item => item.pointSize)) * 1.2, ascent + descent);
    if (![baseline, ascent, descent].every(Number.isFinite) || ascent + descent <= 0) throw wordError('structure');
    const paragraphSize = Math.round(pointSize * 2) / 2;
    result.sourceLayout = { font, color: main[0].color, size: paragraphSize, baseline, height, baselineOffset: (height + ascent - descent) / 2,
      x: firstAtom(ast).type === 'matrix' ? origin(ast) : primary.length && !startsWithStructure(ast) ? primary[0].rect.x + primary[0].left : region.rect.x,
      measured: measure(result.prepForXml({ stack: [] })['m:oMath'], nativeSize) };
    if (sourceAttachments) result.sourceLayout[upperSource ? 'upperAttachments' : sumSource ? 'indexedSumAttachments' : relationSource ? 'scalarRelationAttachments' : indexSource ? 'firstLevelIndexAttachments' : 'shorthandAttachments'] = [...attachmentGeometry.values()];
  }
  return result;
}
