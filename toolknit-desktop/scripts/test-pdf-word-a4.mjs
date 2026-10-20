import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createCanvas } from '@napi-rs/canvas';
import { planPackedPages } from '../src/features/pdf-to-word/core/page-plan.js';
import { validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { planContinuousSection } from '../src/features/pdf-to-word/adapters/docx-continuous.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const paragraph = (id, x, y, width = 300, height = 12) => {
  const rect = { x, y, width, height };
  const item = { id, sourceIds: [id], type: 'text', text: id, rect, size: 12, baseline: y + 10,
    baselineX: x, font: 'Arial', color: '000000', preciseInk: true, advanceRect: rect, advanceWidth: width };
  return { id: id + ':p', type: 'paragraph', rect, sourceIds: [id], size: 12,
    lines: [{ id: id + ':l', rect, sourceIds: [id], items: [item], text: id, size: 12, baseline: y + 10 }] };
};
const documentFor = blocks => ({ schemaVersion: 1, pages: [{ number: 1, width: 900, height: 2000, header: [], footer: [], blocks,
  sources: blocks.flatMap(block => block.sourceIds).map(id => ({ id, text: id, disposition: 'editable' })), risks: [],
  content: { x: 20, y: 20, width: 800, height: 1900 }, backgroundTextLayers: 1 }] });
const background = { id: 'background', type: 'image', rect: { x: 20, y: 20, width: 700, height: 200 }, sourceIds: [], assetId: 'background',
  mathStrokes: [{ rect: { x: 20, y: 20, width: 700, height: 1 }, path: { from: [20, 20], to: [720, 20], strokeRadius: .5, joinRadius: 1 } }] };
const wide = documentFor([background, paragraph('cell-one', 30, 35), paragraph('cell-two', 400, 80)]);
const original = JSON.stringify(wide), plan = planPackedPages(wide);
assert.equal(JSON.stringify(wide), original, 'A4 planning never mutates the editable source coordinates');
assert.equal(validateCoverage(plan.document).characters, validateCoverage(wide).characters);
const placed = plan.document.pages[0].blocks, ratio = plan.sources[0].scale;
assert(ratio > .7 && ratio < .8);
assert(Math.abs(placed[1].rect.x - placed[0].rect.x - 10 * ratio) < .001, 'cell text stays attached to its background');
assert.equal(placed[1].lines[0].items[0].size, 12 * ratio);
assert.equal(placed[1].lines[0].items[0].advanceWidth, 300 * ratio);
assert.equal(placed[1].lines[0].items[0].baselineX, placed[1].rect.x);
assert.deepEqual(placed[0].mathStrokes[0].path.from, [36, 36]);
assert.equal(placed[0].mathStrokes[0].path.strokeRadius, .5 * ratio);

const long = documentFor([paragraph('first-band', 20, 20), paragraph('last-band', 20, 1500)]);
long.pages[0].sources.push({ id: 'hidden', text: 'HIDDEN', disposition: 'excluded-hidden' },
  { id: 'redraw', text: 'last-band', disposition: 'redraw', equivalentTo: 'last-band' });
const split = planPackedPages(long);
assert.equal(split.sources.length, 2);
assert(split.sources.every(source => source.scale === 1), 'large empty gaps split at safe bands instead of shrinking all text');
assert.equal(new Set(split.sources.map(source => source.bookmark)).size, 2);
assert.equal(validateCoverage(split.document).characters, validateCoverage(long).characters);
assert.equal(validateCoverage(split.document).hiddenCharacters, 6);
assert.equal(validateCoverage(split.document).redrawCharacters, 9);

const rows = Array.from({ length: 80 }, (_, index) => paragraph('row-' + index, 20, 20 + index * 20));
const longParagraph = { ...rows[0], sourceIds: rows.flatMap(row => row.sourceIds), lines: rows.flatMap(row => row.lines),
  rect: { x: 20, y: 20, width: 300, height: 1592 } };
const multi = planPackedPages(documentFor([longParagraph]));
assert.equal(multi.document.pages.length, 3, 'long paragraphs paginate at complete physical lines');
assert.equal(multi.document.pages.flatMap(page => page.blocks).length, 80);
validateCoverage(multi.document);
for (const page of multi.document.pages) for (const block of page.blocks) {
  assert(block.rect.x >= 36 && block.rect.y >= 36);
  assert(block.rect.x + block.rect.width <= 559.31 && block.rect.y + block.rect.height <= 805.91);
}

const tallBackground = documentFor([{ ...background, rect: { x: 20, y: 20, width: 400, height: 1000 } },
  paragraph('top-cell', 30, 30), paragraph('bottom-cell', 30, 980)]);
const wholeTable = planPackedPages(tallBackground);
assert.equal(wholeTable.sources.length, 1, 'background/text pairs cannot be split through the table');
assert(wholeTable.sources[0].scale > .75);
assert.equal(validateCoverage(wholeTable.document).characters, validateCoverage(tallBackground).characters);

const tooWide = documentFor([paragraph('poster', 20, 20, 1600)]);
assert.throws(() => planPackedPages(tooWide), /a4-fit/, 'unreadably small posters remain an explicit failure');
assert.throws(() => planPackedPages(wide, { margin: 500 }), /geometry/);
const invalid = documentFor([{ ...background, rect: { x: NaN, y: 20, width: 300, height: 100 } }]);
assert.throws(() => planPackedPages(invalid), /geometry/);
const flowFallback = structuredClone(wide); delete flowFallback.pages[0].backgroundTextLayers;
assert(planContinuousSection(flowFallback), 'wide flow images use the fitting planner');

const canvas = createCanvas(700, 200); canvas.getContext('2d').fillRect(0, 0, 700, 200);
const assets = [{ id: 'background', bytes: new Uint8Array(canvas.toBuffer('image/png')), format: 'png' }];
const output = await createWordBytes(wide, assets, { continuous: true, measurementContext: createCanvas(1, 1).getContext('2d') });
const zip = await JSZip.loadAsync(output.bytes), xml = await zip.file('word/document.xml').async('string');
assert(xml.includes('cell-one') && xml.includes('cell-two') && xml.includes('w:framePr') && xml.includes('w:drawing'));
assert(xml.includes('w:w="11906" w:h="16838"'));
assert.equal(output.quality.editableCharacters, validateCoverage(wide).editableCharacters);
const cells = Array.from({ length: 4 }, (_, index) => {
  const x = 20 + index % 2 * 350, y = 20 + Math.floor(index / 2) * 40;
  return { row: Math.floor(index / 2), col: index % 2, rowSpan: 1, colSpan: 1,
    rect: { x, y, width: 350, height: 40 }, blocks: [paragraph('native-cell-' + index, x + 5, y + 5, 100)] };
});
const nativeTable = { id: 'native-table', type: 'table', rect: { x: 20, y: 20, width: 700, height: 80 },
  rows: 2, columnWidths: [350, 350], rowHeights: [40, 40], cells, sourceIds: cells.flatMap(cell => cell.blocks[0].sourceIds) };
const native = await createWordBytes(documentFor([nativeTable]), [], { continuous: true, measurementContext: createCanvas(1, 1).getContext('2d') });
const nativeXml = await (await JSZip.loadAsync(native.bytes)).file('word/document.xml').async('string');
assert.equal((nativeXml.match(/<w:tbl>/g) || []).length, 1, 'wide native tables retain editable cells after fitting');
for (let index = 0; index < 4; index++) assert(nativeXml.includes('native-cell-' + index));
const paginated = await createWordBytes(documentFor([longParagraph]), [], { continuous: true, measurementContext: createCanvas(1, 1).getContext('2d') });
const paginatedXml = await (await JSZip.loadAsync(paginated.bytes)).file('word/document.xml').async('string');
assert.equal((paginatedXml.match(/<w:sectPr>/g) || []).length, 3);
for (let index = 0; index < 80; index++) assert.equal((paginatedXml.match(new RegExp('>row-' + index + '</w:t>', 'g')) || []).length, 1);
console.log('A4 fit checks passed: margins, width, safe pagination, backgrounds, editable output, coverage and guards.');
