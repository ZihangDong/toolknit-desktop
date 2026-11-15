import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { inferDocument, validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { resultTargets, layoutEditedText, applyResultEdits, availableTextRect } from '../src/features/pdf-to-word/core/result-edit.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
const text = (id, value, y) => ({ id, type: 'text', text: value, size: 12, font: 'Helvetica', baseline: y + 12,
  rect: { x: 40, y, width: 240, height: 14.4 }, sourceIds: [id], color: '000000' });
const original = inferDocument([{ number: 1, width: 595, height: 842, characters: 18,
  sources: [{ id: 'a', text: 'Original title', disposition: 'editable' }, { id: 'b', text: 'Keep me', disposition: 'editable' }],
  items: [text('a', 'Original title', 40), text('b', 'Keep me', 110),
    { id: 'image', type: 'image', rect: { x: 40, y: 200, width: 50, height: 50 }, sourceIds: [] }], risks: [] }], { preserveGeometry: true });
const targets = resultTargets(original.pages[0]), first = targets.find(target => target.text === 'Original title');
const measure = (value, style) => [...value].length * style.size * .5;
const replacement = layoutEditedText(first, 'Updated title', measure);
const edits = { [first.key]: replacement, '1/image': { type: 'delete' } };
const updated = applyResultEdits(original, edits);
assert.equal(validateCoverage(updated).editableCharacters, 'UpdatedtitleKeepme'.length);
assert.equal(original.pages[0].sources[0].text, 'Original title');
const result = await createWordBytes(updated, [], { preserveGeometry: true });
const zip = await JSZip.loadAsync(result.bytes), xml = await zip.file('word/document.xml').async('string');
assert(xml.includes('Updated title')); assert(xml.includes('Keep me')); assert(!xml.includes('Original title')); assert(!xml.includes('<w:drawing>'));
const removed = applyResultEdits(original, { [first.key]: { type: 'delete' }, '1/image': { type: 'delete' } });
assert(!removed.pages[0].sources.some(source => source.id === 'a'));
assert.equal(validateCoverage(removed).editableCharacters, 6);
assert.equal(applyResultEdits(original, {}), original);
assert.deepEqual(layoutEditedText(first, first.text, measure), { type: 'noop' });
assert.equal(applyResultEdits(original, { [first.key]: { type: 'noop' } }), original);
const exactBaseline = structuredClone(original);
exactBaseline.pages[0].blocks.find(block => block.id !== first.key.slice(2) && block.lines).rect.width += 1e-10;
const untouchedPage = structuredClone(exactBaseline.pages[0]); untouchedPage.number = 2;
exactBaseline.pages.push(untouchedPage);
const exactChanged = applyResultEdits(exactBaseline, { [first.key]: replacement, '1/image': {type:'noop'} });
assert.deepEqual(exactChanged.pages[1], exactBaseline.pages[1], 'unmodified page geometry is not recomputed');
for (const block of exactBaseline.pages[0].blocks.filter(block=>block.id !== first.key.slice(2))) {
  assert.deepEqual(exactChanged.pages[0].blocks.find(value=>value.id===block.id), block, 'unmodified sibling data and no-op image remain exact');
}
// Independent source faces, color, fractional sizes and calibrated advances
// survive both the first change and subsequent changes to that paragraph.
const richItems = [
  { ...text('r1', 'Term ', 40), font: 'Arial', size: 10.45, preciseInk: true, baselineX: 40, advanceWidth: 25, rect: { x: 40, y: 40, width: 25, height: 14.4 } },
  { ...text('r2', '/fəʊn/', 40), font: 'Times New Roman', size: 11, italic: true, color: 'C02020', preciseInk: true, baselineX: 65, advanceWidth: 33, rect: { x: 65, y: 40, width: 33, height: 14.4 } },
  { ...text('r3', '中文', 40), font: 'SimSun', size: 12, preciseInk: true, baselineX: 98, advanceWidth: 24, rect: { x: 98, y: 40, width: 24, height: 14.4 } }
];
const richLine = { id: 'rich', baseline: 52, items: richItems, rect: { x: 40, y: 40, width: 82, height: 14.4 } };
const rich = { ...first, key: '1/rich', items: richItems, lines: [richLine], text: 'Term /fəʊn/中文', rect: richLine.rect, container: { x: 40, y: 40, width: 300, height: 60 } };
const changed = layoutEditedText(rich, 'Term /fəʊn/中文123', measure, { page: { ...original.pages[0], blocks: [] } });
const changedRuns = changed.lines.flatMap(line => line.items);
assert.deepEqual(changedRuns.map(run => run.font), ['Arial','Times New Roman','SimSun']);
assert.equal(changedRuns[0].size, 10.45); assert.equal(changedRuns[1].italic, true); assert.equal(changedRuns[1].color, 'C02020');
assert.equal(changedRuns[0].baselineX, 40); assert.equal(changedRuns[1].baselineX, 65); assert.equal(changedRuns[2].advanceWidth, 60);
const again = layoutEditedText(rich, 'Terms /fəʊn/中文123', measure, { page: { ...original.pages[0], blocks: [] }, edits: { [rich.key]: changed } });
assert(again.lines.flatMap(line => line.items).some(run => run.font === 'Times New Roman' && run.italic && run.color === 'C02020'));
assert.deepEqual(layoutEditedText(rich, rich.text, measure, { edits: { [rich.key]: again } }), { type: 'noop' });
const unicodeEdit = layoutEditedText(rich, 'Term /fəʊn/中文👨‍👩‍👧‍👦é', measure, { page: { ...original.pages[0], blocks: [] } });
assert.equal(unicodeEdit.lines.map(line => line.text).join(''), 'Term /fəʊn/中文👨‍👩‍👧‍👦é');
assert.throws(() => layoutEditedText(first, 'Too much '.repeat(100), measure), /edit-fit/);
assert.throws(() => layoutEditedText({ ...first, size: NaN }, 'test', measure), /edit-text/);
const imageChanged = applyResultEdits(original, { '1/image': { type: 'image', assetId: 'word-edit-123' } });
assert.equal(resultTargets(imageChanged.pages[0]).find(target => target.type === 'image').item.assetId, 'word-edit-123');
// Non-half-point source sizes used to trip the HTML number step validator.
const fractional = { ...first, size: 10.450000155717134 };
assert.equal(layoutEditedText(fractional, first.text + '123', measure, { page: original.pages[0] }).size, fractional.size,
  'editing does not quantize the source size before Word serialization');
assert.equal(layoutEditedText({ ...first, size: 3 }, 'small', measure).size, 3, 'already-small source text is not enlarged to a UI minimum');
const short = { ...first, rect: { ...first.rect, width: 24 }, container: { x: 40, y: 40, width: 100, height: 50 } };
assert(availableTextRect(short, original.pages[0]).width > short.rect.width);
const extended = layoutEditedText(short, '123456789012', measure, { page: original.pages[0] });
assert.equal(extended.size, 12);
assert.equal(extended.lines.length, 1);
const confined = { ...first, rect: { x: 40, y: 40, width: 60, height: 14.4 }, container: { x: 40, y: 40, width: 60, height: 14.4 } };
const shrunk = layoutEditedText(confined, '123456789012', measure);
assert(shrunk.size < 12 && shrunk.size >= 8.5);
assert.equal(shrunk.lines.map(line => line.text).join(''), '123456789012');
const two = structuredClone(original);
two.pages[0].blocks[0].lines.push({ ...structuredClone(two.pages[0].blocks[0].lines[0]), id: 'soft-line-2',
  text: '末行', items: [{ ...text('soft-2', '末行', 60), rect: { x: 40, y: 60, width: 24, height: 14.4 } }] });
two.pages[0].blocks[0].lines[0].items[0].text = '中文换行';
assert.equal(resultTargets(two.pages[0]).find(target => target.type === 'text').text, '中文换行末行');
const boundary = availableTextRect(first, original.pages[0]);
assert(boundary.y + boundary.height < 110, 'next paragraph is protected');
const existingEdit = { ...replacement, lines: [{ text: 'Other', x: 280, baseline: 55, width: 30 }] };
const second = targets.find(target => target.text === 'Keep me');
const reserved = availableTextRect({ ...short, container: { x: 40, y: 40, width: 350, height: 50 } }, original.pages[0], { [second.key]: existingEdit });
assert(reserved.x + reserved.width < 280, 'previous edits reserve their current geometry');
const inferredPage = structuredClone(original.pages[0]), narrowBlock = inferredPage.blocks[0];
narrowBlock.rect.width = narrowBlock.lines[0].rect.width = narrowBlock.lines[0].items[0].rect.width = 24;
narrowBlock.lines[0].items[0].text = '1234'; narrowBlock.lines[0].text = '1234';
inferredPage.sources.find(source => source.id === 'a').text = '1234';
const inferredTable = { id: 'inferred', type: 'table', aiInferred: true, borderless: true, rect: narrowBlock.rect,
  sourceIds: narrowBlock.sourceIds, cells: [{ row: 0, col: 0, rowSpan: 1, colSpan: 1, rect: narrowBlock.rect, blocks: [narrowBlock] }] };
inferredPage.blocks[0] = inferredTable;
const inferredTarget = resultTargets(inferredPage).find(target => target.text === '1234');
const inferredEdit = layoutEditedText(inferredTarget, '123456789012', measure, { page: inferredPage });
assert.equal(inferredEdit.size, 12, 'AI semantic cell bounds are not a measured physical border');
assert.equal(inferredEdit.lines.length, 1);
assert(availableTextRect(inferredTarget, inferredPage).y + availableTextRect(inferredTarget, inferredPage).height < 110);
inferredTable.aiInferred = false;
assert.equal(resultTargets(inferredPage).find(target => target.text === '1234').container.width, 24,
  'actual locally measured table borders remain strict editing boundaries');
const capsItem = { ...text('caps', 'AB', 40), baseline: 52, size: 12, rect: { x: 40, y: 43, width: 12, height: 9 } };
const caps = { ...first, key: '1/caps', text: 'AB', size: 12, rect: capsItem.rect, container: { x: 40, y: 43, width: 100, height: 9 },
  items: [capsItem], lines: [{ baseline: 52, items: [capsItem], rect: capsItem.rect }] };
const capsMeasure = (value, style) => value.length * style.size * .5;
capsMeasure.metrics = (value, style) => ({ ascent: style.size * .75, descent: 0, left: 0 });
const capsEdit = layoutEditedText(caps, 'AB123', capsMeasure, { page: { ...original.pages[0], blocks: [] } });
assert.equal(capsEdit.size, 12, 'zero-ink descenders do not invent a 0.2em collision in a tight title');
assert(capsEdit.lines.flatMap(line => line.items).every(item => item.rect.y + item.rect.height <= 52));
console.log('Result edits passed: immutable baseline, actual DOCX edits, automatic font sizing, soft wraps, free space and neighbouring content protection.');
