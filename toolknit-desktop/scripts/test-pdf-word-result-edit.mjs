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
assert.throws(() => layoutEditedText(first, 'Too much '.repeat(100), measure), /edit-fit/);
assert.throws(() => layoutEditedText({ ...first, size: NaN }, 'test', measure), /edit-text/);
const imageChanged = applyResultEdits(original, { '1/image': { type: 'image', assetId: 'word-edit-123' } });
assert.equal(resultTargets(imageChanged.pages[0]).find(target => target.type === 'image').item.assetId, 'word-edit-123');
// Non-half-point source sizes used to trip the HTML number step validator.
const fractional = { ...first, size: 10.450000155717134 };
assert.equal(layoutEditedText(fractional, first.text + '123', measure, { page: original.pages[0] }).size, 10.5);
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
console.log('Result edits passed: immutable baseline, actual DOCX edits, automatic font sizing, soft wraps, free space and neighbouring content protection.');
