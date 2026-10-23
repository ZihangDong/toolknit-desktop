import assert from 'node:assert/strict';
import { longFractionBars } from '../src/features/pdf-to-word/core/math-region-evidence.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import { inferMathAst } from '../src/features/pdf-to-word/core/math.js';

const glyph = (id, x, y, text = 'x') => ({ id, sourceIds: [id], type: 'text', text, size: 10, baseline: y + 7,
  italic: text === 'x', rect: { x, y, width: 5, height: 7 }, order: 1, raster: false });
const text = [glyph('left', 11, 31), glyph('equal', 22, 34, '=')];
text[1].rect.height = 2; text[1].baseline = 38;
for (let index = 0; index < 12; index++) {
  text.push(glyph(`top-${index}`, 34 + index * 10, 20), glyph(`bottom-${index}`, 34 + index * 10, 40));
}
const line = { id: 'long-bar', type: 'image', thin: true, decoration: true, order: 2,
  rect: { x: 30, y: 34.8, width: 125, height: .4 } };
const strong = item => item.italic || item.text === '=';
const detected = longFractionBars(text, text, [line], strong);
assert.equal(detected.get(line)?.size, 24, 'a long rule with centered upper/lower math is admitted');
const original = structuredClone({ text, line });
const sources = text.map(item => ({ id: item.id, text: item.text, rect: item.rect, order: item.order, disposition: 'editable' }));
const grouped = groupPageRegions(text, [line], [], sources);
const images = grouped.items.filter(item => item.type === 'image');
assert.equal(images.length, 1, 'the relation and long fraction form one complete formula');
assert.equal(images[0].sourceIds.length, text.length);
assert.deepEqual(images[0].drawingIds, ['long-bar']);
const ast = inferMathAst(images[0]);
assert(ast?.type === 'row' && ast.children.some(child => child.type === 'fraction'));
assert.deepEqual({ text, line }, original);
for (const [label, rows, graphics] of [
  ['one-sided separator', text.filter(item => !item.id.startsWith('bottom')), [line]],
  ['ordinary prose', text.map(item => ({ ...item, text: 'explanation', italic: false })), [line]],
  ['table side rule', text, [line, { id: 'vertical', rect: { x: 30, y: 15, width: .4, height: 40 } }]],
  ['clipped line', text, [{ ...line, path: { complete: false } }]],
  ['thick divider', text, [{ ...line, rect: { ...line.rect, height: 3 } }]],
  ['unbalanced numerator', text.filter(item => !item.id.startsWith('top') || item.id === 'top-0'), [line]],
]) assert.equal(longFractionBars(rows, rows, graphics, strong).size, 0, label);
const ordinary = [...text, glyph('prose', 80, 30, 'note')];
assert.equal(longFractionBars(ordinary, text, [line], strong).size, 0, 'unowned prose in the rule band prevents a math claim');
const touching = [...text, glyph('touching', 80, 33)];
assert.equal(longFractionBars(touching, touching, [line], strong).size, 0, 'a bar through glyph ink is not a fraction separator');
console.log('Long fraction rules passed: whole formula ownership, relation axis, immutable evidence, separator/table/prose/clipping rejection.');
