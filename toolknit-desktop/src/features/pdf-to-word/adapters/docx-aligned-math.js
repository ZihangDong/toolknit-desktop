// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { Math as OfficeMath, MathRun, RunProperties, BuilderElement } from 'docx';
import { sourceAlignedEquation } from '../core/source-aligned-equations.js';
import { createNativeMathMeasurer, NativeMathLayoutError } from '../core/native-math-layout.js';

class AlignmentSpace extends MathRun {
  constructor(width) {
    super({ text: ' ', literal: true, style: 'italic' });
    this.properties = new RunProperties({ font: 'Arial', size: 2, sizeComplexScript: 2,
      characterSpacing: Math.ceil((width - 0.27783203125) * 20) });
  }
  prepForXml(context) {
    const result = super.prepForXml(context), body = result['m:r'];
    body.splice(body.findIndex(child => child['m:t']), 0, this.properties.prepForXml(context));
    return result;
  }
}
class EquationRow extends BuilderElement {
  constructor(math, before, after) {
    super({ name: 'm:e' }); this.math = math;
    this.before = before > .05 ? new AlignmentSpace(before) : null;
    this.after = after > .05 ? new AlignmentSpace(after) : null;
  }
  prepForXml(context) {
    return { 'm:e': [...(this.before ? [this.before.prepForXml(context)] : []),
      ...this.math.prepForXml(context)['m:oMath'], ...(this.after ? [this.after.prepForXml(context)] : [])] };
  }
}
// Match the existing source-baseline paragraph's point/twip rounding. The array
// retains the first row's line metrics; its frame also contains the last row.
function sourceRowFrame(layout, item) {
  const requested = Math.max(layout.height, (layout.baseline - item.rect.y + 1) / .8,
    (item.rect.y + item.rect.height - layout.baseline + 1) / .2);
  const height = Math.max(.5, Math.min(requested, Math.floor(layout.baseline / .8 * 20) / 20));
  const y = Math.round((layout.baseline - Math.round(height * 20) / 20 * .8) * 20) / 20;
  return { x: Math.round(layout.x * 20) / 20, y, lineHeight: Math.round(height * 20) / 20,
    height: Math.round(Math.max(requested, item.rect.y + item.rect.height - (layout.baseline - height * .8) + 1) * 20) / 20 };
}

export function nativeAlignedMath(ast, region, { measurementContext, defaultSize }, buildRow) {
  const source = sourceAlignedEquation(ast, region);
  if (!source || !measurementContext || typeof buildRow !== 'function') throw new NativeMathLayoutError('Incomplete aligned equation evidence');
  const rows = source.rows.map((row, index) => buildRow(row.ast, row.region,
    { measurementContext, defaultSize, sourceAlignedRow: { parent: region, index } }));
  if (rows.some(row => !row.sourceLayout?.measured)) throw new NativeMathLayoutError('Aligned row lacks native measurement');
  const layouts = rows.map(row => row.sourceLayout), first = layouts[0];
  const starts = layouts.map(layout => layout.x - first.x);
  const width = Math.max(...layouts.map((layout, index) => starts[index] + layout.measured.width));
  const drop = layouts[1].baseline - first.baseline;
  if (!(starts[0] === 0 && starts[1] >= 0 && width > 0 && width <= 1200 && drop > 0 && drop <= 100))
    throw new NativeMathLayoutError('Invalid aligned source placement');
  const props = new BuilderElement({ name: 'm:eqArrPr', children: [
    ...[['baseJc', 'top'], ['rSpRule', 3], ['rSp', Math.round(drop * 20)]].map(([name, value]) =>
      new BuilderElement({ name: 'm:' + name, attributes: { val: { key: 'm:val', value } } }))] });
  const array = new BuilderElement({ name: 'm:eqArr', children: [props,
    ...rows.map((row, index) => new EquationRow(row, starts[index], width - starts[index] - layouts[index].measured.width))] });
  const result = new OfficeMath({ children: [array] });
  const measure = createNativeMathMeasurer(format => {
    measurementContext.font = `${format.italic ? 'italic ' : ''}${format.bold ? 'bold ' : ''}1000px "${format.font}"`;
    measurementContext.fontKerning = 'none';
    const value = measurementContext.measureText(format.text), scale = format.size / 1000;
    return { width: Math.max(0, value.width * scale * format.scale / 100 + [...format.text].length * format.spacing),
      height: value.actualBoundingBoxAscent * scale, depth: value.actualBoundingBoxDescent * scale };
  }, { sourceAlignedEquationRegion: region });
  const measured = measure(result.prepForXml({ stack: [] })['m:oMath'], first.size);
  const frames = layouts.map((layout, index) => sourceRowFrame(layout, source.rows[index].region));
  const frame = { ...frames[0], height: frames[1].y + frames[1].height - frames[0].y };
  if (![frame.x, frame.y, frame.height, frame.lineHeight].every(Number.isFinite)
    || frame.x < 0 || frame.y < 0 || frame.height <= 0 || frame.lineHeight <= 0)
    throw new NativeMathLayoutError('Aligned frame exceeds source page');
  result.sourceLayout = { ...first, height: frame.height, measured, alignedFrame: frame };
  return result;
}
