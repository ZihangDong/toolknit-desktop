import assert from 'node:assert/strict';
import { comparePageInk } from './lib/pdf-word-fidelity.mjs';
import { inspectLayoutQuality, assertLayoutQuality } from '../src/features/pdf-to-word/core/quality.js';
import { horizontalTextGeometry } from '../src/features/pdf-to-word/core/text-geometry.js';
import { inspectSceneInk } from '../src/features/pdf-to-word/core/ink-coverage.js';
import { planPackedPages } from '../src/features/pdf-to-word/core/page-plan.js';
import { positionedFrameCost, MAX_POSITIONED_FRAMES } from '../src/features/pdf-to-word/core/positioned-budget.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import { tablesRequiringFallback } from '../src/features/pdf-to-word/adapters/docx.js';
import { createCanvas } from '@napi-rs/canvas';
import { inferDocument, leafBlocks } from '../src/features/pdf-to-word/core/layout.js';
import { planContinuousSection } from '../src/features/pdf-to-word/adapters/docx-continuous.js';

const pixels = (points, size = 100) => {
  const result = new Uint8Array(size * size * 4).fill(255);
  for (const [x, y] of points) result.fill(0, (y * size + x) * 4, (y * size + x) * 4 + 3);
  return result;
};
const ink = Array.from({ length: 40 }, (_, i) => [i + 10, 20]);
assert.equal(comparePageInk(pixels(ink), pixels(ink), 100, 100).f1, 1);
assert.equal(comparePageInk(pixels(ink), pixels([]), 100, 100).f1, 0, 'empty output cannot score with white margins');
assert.equal(comparePageInk(pixels([]), pixels(ink), 100, 100).f1, 0);
assert.equal(comparePageInk(pixels(ink), pixels(ink.map(([x, y]) => [x, y + 5])), 100, 100).f1, 0, 'no content alignment or page warping');
assert.equal(comparePageInk(pixels(ink), pixels(ink.slice(0, 20)), 100, 100, { tolerancePt: 0 }).recall, .5);
const duplicate = comparePageInk(pixels(ink), pixels([...ink, ...ink.map(([x, y]) => [x, y + 10])]), 100, 100);
assert.equal(duplicate.precision, .5, 'duplicate ink is penalized');
const page = { number: 1, width: 456, height: 100, header: [], footer: [], blocks: [] };
const clean = { pages: [page] };
assert.equal(inspectLayoutQuality(clean).fidelity, null);
assert.equal(inspectLayoutQuality(clean).rendered, false);
const broken = structuredClone(clean);
broken.pages[0].blocks = Array.from({ length: 40 }, (_, i) => ({ type: 'image', id: `i${i}`, rect: { x: i, y: 10, width: 2, height: 12 } }));
assert.equal(inspectLayoutQuality(broken).status, 'blocked');
assert.throws(() => assertLayoutQuality(broken), /layout-quality/);
assert.equal(assertLayoutQuality(clean).status, 'unverified', 'valid structure is not a fidelity certification');
console.log('PDF Word quality checks passed: foreground-only scoring, missing/duplicate/displaced content and fragmented layout.');
const italic = horizontalTextGeometry([1, 0, .176, -1, 20, 30], 12);
assert.equal(italic.size, 12); assert(italic.italic); assert.equal(italic.horizontalScale, 1);
assert.equal(horizontalTextGeometry([0, 1, 1, 0, 20, 30], 12), null);
assert.equal(horizontalTextGeometry([-1, 0, 0, -1, 20, 30], 12), null);
assert.equal(horizontalTextGeometry([1, 0, 1, -1, 20, 30], 12), null);
assert.equal(horizontalTextGeometry([1, 0, 0, -1, 20, 30], -12), null);
const unowned = inspectSceneInk({ width: 100, height: 100, items: [] }, pixels(ink), 100, 100);
assert.equal(unowned.accepted, false, 'an unencoded visible symbol cannot pass a text-only ledger');
assert.equal(unowned.uncoveredPixels, 40);
assert.equal(inspectSceneInk({ width: 100, height: 100, items: [{ rect: { x: 10, y: 20, width: 40, height: 1 } }] }, pixels(ink), 100, 100).accepted, true);
assert.equal(inspectSceneInk({ width: 100, height: 100, items: [{ rect: { x: 10, y: 20, width: 40, height: 1 } }] }, pixels([[51, 20]]), 100, 100).accepted, true,
  'one hinted edge pixel remains attached to known geometry');
assert.equal(inspectSceneInk({ width: 100, height: 100, items: [{ rect: { x: 10, y: 20, width: 40, height: 1 } }] }, pixels([[55, 20]]), 100, 100).accepted, false,
  'even one isolated missing dot must fail');
const styleLine = { items: [
  { font: 'Arial', size: 10, preciseInk: true, color: '000000' },
  { font: 'Arial', size: 10, preciseInk: true, color: 'FF0000' },
  { type: 'image' }, { font: 'Arial', size: 10, preciseInk: true, color: 'FF0000' },
] };
assert.equal(positionedFrameCost([{ type: 'option-grid', cells: [{ blocks: [{ type: 'paragraph', lines: [styleLine] }] }] }]), 3,
  'option cells, color changes and image interruptions consume frame budget');
assert.equal(positionedFrameCost([{ type: 'paragraph', lines: [{ items: [50, 52, 50].map(baseline =>
  ({ font: 'Arial', size: 10, color: '000000', preciseInk: true, baseline })) }] }]), 3,
  'independent raised and lowered frames are included in the same safety budget as the writer');
const fragment = (number, text, height) => ({ number, width: 450, height: height + 20, header: [], footer: [], risks: [],
  sources: [{ id: `s${number}`, order: 0, text, disposition: 'editable' }],
  blocks: [{ type: 'paragraph', rect: { x: 10, y: 10, width: 420, height }, sourceIds: [`s${number}`], lines: [{ text, baseline: 18, items: [] }] }] });
const packed = planPackedPages({ schemaVersion: 1, pages: [fragment(1, 'Introduction', 650), fragment(2, '1. Question', 50), fragment(3, '\u3010\u89e3\u6790\u3011', 100)] });
assert.equal(packed.sources[1].targetPage, 2);
assert.equal(packed.sources[2].targetPage, 2, 'a small explicit answer stays with its question');
assert.equal(packed.sources.length, 3);
const sectionQuestion = planPackedPages({ schemaVersion: 1, pages: [fragment(1, 'Introduction', 650),
  fragment(2, '\u4e09\u3001\u586b\u7a7a\u9898 12. Question', 50), fragment(3, '\u3010\u7b54\u6848\u3011', 100)] });
assert.equal(sectionQuestion.sources[1].targetPage, sectionQuestion.sources[2].targetPage, 'a section heading must not hide the question/answer connection');
const detailedAnswer = planPackedPages({ schemaVersion: 1, pages: [fragment(1, 'Introduction', 650),
  fragment(2, '15. Question', 50), fragment(3, '\u3010\u89e3\u9898\u5206\u6790\u3011', 100)] });
assert.equal(detailedAnswer.sources[1].targetPage, detailedAnswer.sources[2].targetPage);
const oversized = fragment(1, 'Oversized', 800);
assert.throws(() => planPackedPages({ schemaVersion: 1, pages: [oversized] }), /a4-fit/);
const crowded = fragment(1, 'Crowded', 30);
crowded.blocks[0].lines = Array.from({ length: MAX_POSITIONED_FRAMES + 1 }, () => ({ items: [{ font: 'Arial', size: 10, preciseInk: true }] }));
assert.throws(() => planPackedPages({ schemaVersion: 1, pages: [crowded] }), /layout-quality/);
const geometryScenes = [600, 100].map((height, index) => {
  const id = `mixed-${index}`, rect = { x: 20, y: 20, width: 100, height: 10 };
  return { number: index + 1, width: 450, height, characters: id.length, risks: [], sources: [{ id, text: id, rect, order: 0, disposition: 'editable' }],
    items: [{ id, sourceIds: [id], type: 'text', text: id, rect, size: 10, baseline: 28, preciseInk: true,
      advanceRect: { x: 20, y: 16, width: 100, height: 14 }, font: 'Arial', color: '000000', order: 0 }] };
});
geometryScenes.push({ number: 3, width: 450, height: 600, characters: 0, risks: [], sources: [], items: [] });
const mixedContinuous = inferDocument(geometryScenes, { continuous: true });
assert(mixedContinuous.pages.flatMap(page => leafBlocks(page.blocks)).flatMap(block => block.lines || [])
  .flatMap(line => line.items).every(item => item.preciseInk && item.rect.y === 20), 'one packed source page keeps precise geometry for the whole continuous document');
const mixedPlan = planContinuousSection(mixedContinuous);
assert.equal(mixedPlan.sources.length, 3);
assert(mixedPlan.sources.find(source => source.page === 3).emptySourcePage, 'blank source pages retain a bookmark without invalid geometry');
const regularFlow = inferDocument([geometryScenes[0]], { continuous: true });
assert.equal(planContinuousSection(regularFlow), null, 'ordinary paragraph flow retains its existing strategy');
assert.equal(leafBlocks(regularFlow.pages[0].blocks)[0].lines[0].items[0].preciseInk, false);
function tableScene(rowHeight, color = '000000') {
  const rules = [0, 1, 2].map(index => ({ axis: 'h', at: 10 + index * rowHeight, from: 10, to: 110 }))
    .concat([10, 60, 110].map(at => ({ axis: 'v', at, from: 10, to: 10 + 2 * rowHeight })));
  const graphics = rules.map((rule, index) => ({ id: `d${index}`, sourceIds: [], order: index, raster: true, decoration: true, thin: true,
    reason: 'image', strokeColor: color, strokeWidth: .4, rect: rule.axis === 'h'
      ? { x: rule.from - .2, y: rule.at - .2, width: rule.to - rule.from + .4, height: .4 }
      : { x: rule.at - .2, y: rule.from - .2, width: .4, height: rule.to - rule.from + .4 } }));
  const text = Array.from({ length: 4 }, (_, index) => ({ id: `t${index}`, sourceIds: [`t${index}`], order: 10 + index,
    text: `Cell${index}`, size: 12, font: 'Arial', baseline: 18 + Math.floor(index / 2) * rowHeight,
    rect: { x: 15 + index % 2 * 50, y: 11 + Math.floor(index / 2) * rowHeight, width: 30, height: 7 } }));
  const sources = text.map(item => ({ id: item.id, order: item.order, text: item.text, disposition: 'editable' }));
  return { result: groupPageRegions(text, graphics, rules, sources), sources, rules };
}
assert(tableScene(18).result.items.some(item => item.type === 'table'));
const measured = tableScene(18).result;
const metricsContext = createCanvas(1, 1).getContext('2d');
assert.deepEqual(tablesRequiringFallback(measured, metricsContext), []);
for (const cell of measured.items.find(item => item.type === 'table').cells) for (const block of cell.blocks) {
  block.rect.y += 9;
  for (const line of block.lines) { line.rect.y += 9; line.baseline += 9; for (const item of line.items) { item.rect.y += 9; item.baseline += 9; } }
}
assert.equal(tablesRequiringFallback(measured, metricsContext).length, 1, 'cell whitespace and measured line occupancy are checked before export');
for (const { result, sources } of [tableScene(12), tableScene(18, '990099')]) {
  assert(!result.items.some(item => item.type === 'table'));
  assert.equal(result.items.length, 1, 'unrepresentable table is one owned crop, never fragmented rows');
  assert(result.risks.includes('table-image'), 'local table fallback requires visible consent');
  assert.equal(result.items[0].sourceIds.length, 4);
  assert(sources.every(source => source.disposition === 'visible-image'));
}
const cellPictures = tableScene(18);
const preserved = inferDocument([{ number: 1, width: 180, height: 100, characters: 20,
  sources: cellPictures.sources.map(source => ({ ...source, disposition: 'visible-image' })), rules: cellPictures.rules, risks: ['table-image'],
  rasterPage: false, drawingOwnership: [], items: Array.from({ length: 4 }, (_, index) => ({ id: `crop${index}`, type: 'image',
    sourceIds: [`t${index}`], baseline: 22 + Math.floor(index / 2) * 18, size: 12,
    rect: { x: 15 + index % 2 * 50, y: 14 + Math.floor(index / 2) * 18, width: 30, height: 8 } })) }], { preserveGeometry: true });
const noNewTables = blocks => { for (const block of blocks) { assert.notEqual(block.type, 'table'); if (block.type === 'columns') block.columns.forEach(column => noNewTables(column.blocks)); } };
noNewTables(preserved.pages[0].blocks);
assert.equal(preserved.quality.imageCharacters, 20, 'late layout must retain image ownership rather than re-promote rejected cells');
