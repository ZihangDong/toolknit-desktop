import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { orderBandBlocks } from '../src/features/pdf-to-word/core/reading-order.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { buildParagraphs, groupLines } from '../src/features/pdf-to-word/core/text.js';
import { createCanvas } from '@napi-rs/canvas';

const text = (id, x, baseline, y = baseline - 8) => ({ id, type: 'text', sourceIds: [id], order: 0,
  text: id, size: 10, baseline, font: 'Arial', color: '000000', rect: { x, y, width: 30, height: baseline + 2 - y } });
const paragraph = item => ({ id: `${item.id}:paragraph`, type: 'paragraph', role: 'paragraph', sourceIds: item.sourceIds,
  rect: { ...item.rect }, size: item.size, lines: [{ id: `${item.id}:line`, type: 'line', items: [item], text: item.text,
    sourceIds: item.sourceIds, baseline: item.baseline, size: item.size, rect: { ...item.rect } }] });
const left = paragraph(text('first', 20, 50)), right = paragraph(text('last', 200, 49, 30));
const next = paragraph(text('next', 20, 66));
const input = [right, next, left], before = structuredClone(input);
assert.deepEqual(orderBandBlocks(input).map(block => block.id), [left.id, right.id, next.id]);
assert.deepEqual(input, before, 'reading order changes neither source content nor visual positions');
const descending = [paragraph(text('top', 100, 10)), paragraph(text('middle', 60, 12)), paragraph(text('bottom', 20, 14))];
assert.deepEqual(orderBandBlocks(descending).map(block => block.id), ['middle:paragraph', 'top:paragraph', 'bottom:paragraph'],
  'bounded baseline bands do not merge a chain of small shifts across several rows');
const multi = structuredClone(left); multi.lines.push({ ...multi.lines[0], baseline: 65 }); multi.rect.height = 25;
const table = { id: 'table', type: 'table', rect: { x: 20, y: 75, width: 220, height: 20 } };
const mixed = orderBandBlocks([table, right, multi]);
assert(mixed.includes(multi) && mixed.at(-1) === table, 'multi-line paragraphs and tables remain atomic');
const nearRight = paragraph(text('tail', 200, 49.7)).lines[0];
const nearLeft = paragraph(text('prefix', 20, 50)).lines[0];
const column = { x: 20, y: 0, width: 350, height: 100 };
const near = buildParagraphs([nearLeft, nearRight], column);
assert.equal(near.length, 2, 'sub-point baseline differences do not become a false second paragraph line');
assert.deepEqual(orderBandBlocks(near).flatMap(block => block.sourceIds), ['prefix', 'tail']);
const wrapped = paragraph(text('continued', 20, 64)).lines[0];
assert.equal(buildParagraphs([nearLeft, wrapped], column).length, 1, 'actual vertically wrapped prose retains paragraph grouping');
const splitRow = buildParagraphs([nearLeft, nearRight, wrapped], column);
assert.equal(splitRow.length, 3, 'the tail of a split row cannot own the next whole row while its prefix is outside');
assert.deepEqual(orderBandBlocks(splitRow).flatMap(block => block.sourceIds), ['prefix', 'tail', 'continued']);

const staggered = [
  { ...text('L', 20, 50), rect: { x: 20, y: 42, width: 6, height: 8 } },
  { ...text('A', 24, 48.2), size: 7, rect: { x: 24, y: 42.6, width: 4, height: 5.6 } },
  { ...text('T', 28, 50), rect: { x: 28, y: 42, width: 6, height: 8 } },
  { ...text('E', 32, 52.2), rect: { x: 32, y: 44.2, width: 6, height: 8 } },
  { ...text('X', 36, 50), rect: { x: 36, y: 42, width: 6, height: 8 } },
];
const staggeredBefore = structuredClone(staggered), staggeredLines = groupLines(staggered);
assert.equal(staggeredLines.length, 1, 'a small raised prefix must not anchor the whole row above its normal-size text');
assert.equal(staggeredLines[0].text, 'LATEX');
assert.equal(staggeredLines[0].baseline, 50);
assert.deepEqual(staggered, staggeredBefore, 'grouping does not alter visible glyph positions or source characters');
assert.equal(groupLines([...staggered, { ...text('next', 20, 64), rect: { x: 20, y: 56, width: 30, height: 8 } }]).length, 2,
  'the adjacent real line remains separate');
const regularSteps = [text('one', 20, 50), text('two', 60, 52), text('three', 100, 54)];
assert.deepEqual(groupLines(regularSteps).map(line => line.sourceIds), [['one', 'two'], ['three']],
  'equal-size baselines cannot drift through a chain of small offsets');

const staggeredScene = { number: 1, width: 300, height: 100, items: staggered, characters: 5, risks: [], rasterPage: false,
  sources: staggered.map(item => ({ id: item.id, text: item.text, rect: item.rect, order: item.order, disposition: 'editable' })) };
const staggeredOutput = await createWordBytes(inferDocument([staggeredScene], { preserveGeometry: true, pageModes: { 1: 'single' } }), [], { preserveGeometry: true });
const staggeredTree = xml2js(await (await JSZip.loadAsync(staggeredOutput.bytes)).file('word/document.xml').async('string'), { captureSpacesBetweenElements: true });
const allText = node => (node.name === 'w:t' ? (node.elements || []).map(child => child.text || '').join('') : (node.elements || []).map(allText).join(''));
assert.equal(allText(staggeredTree), 'LATEX', 'actual Word text order retains raised and lowered ordinary letters in place');
const preciseScene = structuredClone(staggeredScene);
preciseScene.items.forEach(item => { item.preciseInk = true; });
const measurementCanvas = createCanvas(1, 1), measurementContext = measurementCanvas.getContext('2d');
const measured = await createWordBytes(inferDocument([preciseScene], { preserveGeometry: true, pageModes: { 1: 'single' } }), [], { preserveGeometry: true, measurementContext });
const measuredTree = xml2js(await (await JSZip.loadAsync(measured.bytes)).file('word/document.xml').async('string'), { captureSpacesBetweenElements: true });
const descendants = node => [node, ...(node.elements || []).flatMap(descendants)];
const measuredFrames = descendants(measuredTree).filter(node => node.name === 'w:p' && descendants(node).some(child => child.name === 'w:framePr'));
const lowered = measuredFrames.find(node => allText(node) === 'E');
assert(lowered, 'a displaced glyph retains its own fixed frame while its document order stays inline');
const loneScene = { ...preciseScene, items: [preciseScene.items[3]], sources: [preciseScene.sources[3]], characters: 1 };
const lone = await createWordBytes(inferDocument([loneScene], { preserveGeometry: true }), [], { preserveGeometry: true, measurementContext });
const loneTree = xml2js(await (await JSZip.loadAsync(lone.bytes)).file('word/document.xml').async('string'), { captureSpacesBetweenElements: true });
assert.equal(descendants(lowered).find(node => node.name === 'w:framePr').attributes['w:y'],
  descendants(loneTree).find(node => node.name === 'w:framePr').attributes['w:y'], 'grouping cannot move a lowered glyph vertically');
assert.equal(allText(measuredTree), 'LATEX');
measurementCanvas.width = measurementCanvas.height = 0;

const items = [text('first', 20, 50, 42), text('last', 200, 50, 41.6)];
const scene = { number: 1, width: 400, height: 100, items, characters: 9, risks: [], rasterPage: false,
  sources: items.map(item => ({ id: item.id, text: item.text, rect: item.rect, order: item.order, disposition: 'editable' })) };
const document = inferDocument([scene], { preserveGeometry: true, pageModes: { 1: 'single' } });
assert.deepEqual(document.pages[0].blocks.map(block => block.sourceIds), [['first'], ['last']]);
const converted = await createWordBytes(document, [], { preserveGeometry: true });
const zip = await JSZip.loadAsync(converted.bytes);
const tree = xml2js(await zip.file('word/document.xml').async('string'), { captureSpacesBetweenElements: true });
const runs = [];
const visit = node => {
  if (node.name === 'w:t') runs.push(...(node.elements || []).filter(child => child.type === 'text').map(child => child.text));
  else node.elements?.forEach(visit);
};
visit(tree);
assert.equal(runs.join(''), 'firstlast', 'actual DOCX text order follows the complete sentence, not glyph top edges');
console.log('PDF reading order checks passed: baseline bands, source immutability, atomic blocks and actual DOCX text stream.');
