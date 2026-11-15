import assert from 'node:assert/strict';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { independentTextGroups } from '../src/features/pdf-to-word/core/text-paint-groups.js';
import { matchRenderedTextOperations, mappedTextSelection } from '../src/features/pdf-to-word/core/render-text-map.js';
import { raisedReferenceText } from '../src/features/pdf-to-word/core/raised-reference.js';
import { recoverGraphicTextLayers } from '../src/features/pdf-to-word/core/graphic-text-layers.js';
import { sceneLayoutBytes } from '../src/features/pdf-to-word/core/scene-budget.js';

const draw = text => ({ name: 'showText', args: [[{ unicode: text, fontChar: text, width: 500, isInFont: true }]] });
const source = [{ name: 'beginText' }, { name: 'setTextMatrix', args: [1, 0, 0, 1, 10, 20] }, draw('Base'),
  { name: 'moveText', args: [12, 4] }, draw('∗'), { name: 'moveText', args: [0, -4] }, draw(', Label Other Third'),
  { name: 'moveText', args: [-2, -12] }, draw('Neighbour'), { name: 'endText' }];
const names = Object.fromEntries(Object.entries(OPS).map(([name, code]) => [code, name]));
const display = ops => ({ fnArray: ops.map(op => OPS[op.name]), argsArray: ops.map(op => op.args || []), lastChunk: true });
assert.deepEqual(independentTextGroups(source), [[2, 4, 6, 8]], 'default source isolation remains unchanged');
assert.deepEqual(independentTextGroups(source, { relativeMoves: true }), [[2], [4], [6], [8]]);
const binding = matchRenderedTextOperations(source, display(source), names);
assert(binding); assert.equal(mappedTextSelection(binding, [6]), null);
assert.deepEqual([...mappedTextSelection(binding, [6], [6])], [6]);
assert.deepEqual([...mappedTextSelection(binding, [2, 4, 6, 8])], [2, 4, 6, 8]);
for (const args of [[[6], [2]], [[6, 6], [6]], [[6], [6, 6]], [[-1], [-1]], [[6], [NaN]]])
  assert.equal(mappedTextSelection(binding, ...args), null, 'explicit mode still owns each exact source selection');
for (const change of [
  ops => { ops[5] = { name: 'setLeading', args: [12] }; },
  ops => { ops[7] = { name: 'setLeading', args: [12] }; },
  ops => { ops[5].args = [NaN, 1]; },
  ops => { ops[7].args = [0]; },
]) {
  const rendered = structuredClone(source); change(rendered);
  const map = matchRenderedTextOperations(source, display(rendered), names);
  assert(map, 'unchanged full draw sequence can retain conservative default binding');
  assert.equal(mappedTextSelection(map, [6], [6]), null, 'both original and rendered reset boundaries must independently prove the selected group');
  const original = structuredClone(source); change(original);
  const reverse = matchRenderedTextOperations(original, display(source), names);
  assert(reverse); assert.equal(mappedTextSelection(reverse, [6], [6]), null);
}
const merged = structuredClone(source); merged[7] = { name: 'setLeading', args: [1] };
const map = matchRenderedTextOperations(source, display(merged), names);
assert.equal(mappedTextSelection(map, [6, 8], [6, 8]), null, 'joined display boundaries cannot inherit a finer source-only proof');
const changed = structuredClone(source); changed[6] = draw('Foreign');
assert.equal(matchRenderedTextOperations(source, display(changed), names), null);
for (const invalid of [
  [{ name: 'beginText' }, { name: 'beginText' }, draw('A'), { name: 'endText' }, { name: 'endText' }],
  [{ name: 'beginText' }, draw('A'), { name: 'nextLineShowText' }, { name: 'endText' }],
  [{ name: 'beginText' }, draw('A')],
]) assert.deepEqual(independentTextGroups(invalid, { relativeMoves: true }), []);

function fixture() {
  const make = (id, text, rect, baseline, size, font, baselineX = rect.x) => ({ id: 'p1:t' + id, order: id,
    sourceIds: ['p1:t' + id], text, rect, baseline, size, font, baselineX, preciseInk: true,
    bold: false, italic: false, raster: false, color: '000000', horizontalScale: 1 });
  const base = make(2, 'Base name', { x: 30, y: 40, width: 59, height: 8 }, 47, 10, 'NimbusRomNo9L-Regu');
  const mark = make(4, '∗', { x: 90, y: 40, width: 3, height: 3 }, 43.5, 7, 'CMSY7', 90);
  const body = make(6, ', Label Other Third', { x: 90, y: 40, width: 105, height: 9 }, 47, 10, base.font, 90);
  body.words = [
    { text: ',', rect: { x: 90, y: 45, width: 2, height: 3 } },
    { text: 'Label', rect: { x: 100, y: 40, width: 24, height: 7 } },
    { text: 'Other', rect: { x: 130, y: 40, width: 24, height: 7 } },
    { text: 'Third', rect: { x: 160, y: 40, width: 35, height: 7 } },
  ];
  const text = [base, mark, body];
  const sources = text.map(item => ({ id: item.id, text: item.text, rect: structuredClone(item.rect),
    order: item.order, disposition: item === base ? 'editable' : 'visible-image' }));
  return { number: 1, text, sources, operations: structuredClone(source), graphics: [], bounds: { x: 0, y: 0, width: 300, height: 200 },
    items: [{ id: 'combined', type: 'image', role: 'figure', rect: structuredClone(body.rect), sourceIds: [mark.id, body.id] }] };
}
const f = fixture(), before = structuredClone(f), result = recoverGraphicTextLayers(f);
assert.deepEqual([...raisedReferenceText(f.text, f.sources, f.bounds)], ['p1:t6']);
assert.equal(result.count, 1);
const background = result.items.find(item => item.type === 'image');
assert.deepEqual(background.sourceIds, ['p1:t4']); assert.deepEqual(background.backgroundPaintIndexes, [6]);
assert.deepEqual(background.relativeTextPaintIndexes, [6]);
assert.equal(result.items.find(item => item.id === 'p1:t6').text, f.text[2].text);
assert.equal(f.sources[1].disposition, 'visible-image'); assert.equal(f.sources[2].disposition, 'editable');
assert.deepEqual(f.text, before.text); assert.deepEqual(f.operations, before.operations); assert.deepEqual(f.items, before.items);
assert(sceneLayoutBytes({ items: result.items }) >= 2 * 16, 'finer selection metadata is included in the scene budget');
const nextLine = fixture(), peer = { ...structuredClone(nextLine.text[0]), id: 'p1:t10', order: 10, sourceIds: ['p1:t10'],
  baseline: 59, baselineX: 100, rect: { x: 100, y: 52, width: 49, height: 8 } };
const other = { ...structuredClone(nextLine.text[1]), id: 'p1:t12', order: 12, sourceIds: ['p1:t12'], text: '†',
  baseline: 55.5, baselineX: 150, rect: { x: 150, y: 50.1, width: 3, height: 4 } };
for (const item of [peer, other]) { nextLine.text.push(item); nextLine.sources.push({ id: item.id, text: item.text, rect: structuredClone(item.rect), order: item.order, disposition: 'editable' }); }
assert.equal(raisedReferenceText(nextLine.text, nextLine.sources, nextLine.bounds).size, 1, 'another line marker needs its own uniquely proven base plus a full vertical ink gap');
for (const mutate of [x => { x.text.at(-2).baseline += 3; }, x => { x.text.at(-1).rect.y -= .3; x.sources.at(-1).rect.y -= .3; },
  x => { x.sources.at(-2).disposition = 'excluded-hidden'; }]) {
  const input = structuredClone(nextLine); mutate(input);
  assert.equal(raisedReferenceText(input.text, input.sources, input.bounds).size, 0);
}
for (const [index, mutate] of [
  x => { x.sources[2].text = 'Foreign'; }, x => { x.sources[2].disposition = 'excluded-hidden'; },
  x => { x.sources[1].rect.x += 1; }, x => { x.text[2].words[0].rect.y = 41; },
  x => { x.text[2].order++; },
  x => { x.text[2].words[1].text = 'Different'; }, x => { x.text[2].font = 'Unknown'; },
  x => { x.text[1].font = 'Unknown'; }, x => { x.text[1].baseline += 4; },
  x => { x.text[2].ocr = true; }, x => { x.text[0].raster = true; },
  x => { x.text[0].baseline += 2; }, x => { x.text[1].color = 'ff0000'; },
  x => { x.text[2].horizontalScale = .5; }, x => { x.bounds.width = 150; },
  x => { x.sources.push(structuredClone(x.sources[2])); },
  x => { const peer = structuredClone(x.text[0]); peer.id = 'other'; peer.sourceIds = [peer.id]; x.text.push(peer); x.sources.push({ ...structuredClone(x.sources[0]), id: peer.id }); },
  x => { x.text[2].words.pop(); },
].entries()) {
  const input = fixture(); mutate(input); const copy = structuredClone(input);
  assert.equal(raisedReferenceText(input.text, input.sources, input.bounds).size, 0, 'foreign/unknown/ambiguous/scan/ink references stay untouched: ' + index);
  assert.deepEqual(input, copy);
}
for (const mutate of [x => { x.maxLayers = 0; }, x => { x.operations[5] = { name: 'setLeading', args: [12] }; },
  x => { x.operations[7] = { name: 'setLeading', args: [12] }; }, x => { x.items[0].role = 'math'; }]) {
  const input = fixture(); mutate(input); const output = recoverGraphicTextLayers(input);
  assert(!output.items.some(item => item.id === 'p1:t6'), 'full paint group ownership/layer cap/semantic role still enforced');
}
console.log('Relative text recovery: unchanged default grouping, exact source/display reset ownership, bounded reference word ink, real provenance and ambiguity/font/scan/hidden/capacity rejection passed.');
