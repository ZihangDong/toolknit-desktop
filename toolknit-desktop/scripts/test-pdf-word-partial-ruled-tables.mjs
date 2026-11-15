import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createCanvas } from '@napi-rs/canvas';
import { prepareHorizontalTables, horizontalTableRule } from '../src/features/pdf-to-word/core/horizontal-tables.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import { inferDocument, validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes, tablesRequiringFallback } from '../src/features/pdf-to-word/adapters/docx.js';
import { needsPageOcr } from '../src/features/pdf-to-word/core/ocr-scene.js';
import { measureLineBox } from '../src/features/pdf-to-word/adapters/text-layout.js';

function fixture() {
  let serial = 0;
  const item = (text, x, baseline, words = null) => ({ id: 's' + serial, sourceIds: ['s' + serial++],
    text, type: 'text', size: 10, font: 'Arial', color: '000000', baseline, baselineX: x,
    rect: { x, y: baseline - 7, width: text.length * 4, height: 7 }, order: serial,
    preciseInk: true, advanceWidth: text.length * 4, ...(words ? { words } : {}) });
  const text = [], anchors = [98, 163, 228, 318, 388];
  const row = (values, baseline) => values.forEach((value, col) => {
    if (value !== '') text.push(item(value, anchors[col], baseline));
  });
  ['A', 'B', 'C', 'Score', 'Rank'].forEach((value, col) => text.push(item(value, anchors[col], 30)));
  text.push(item('base', 20, 55)); row(['1', '10', '20', '9.1', '50'], 55);
  text.push(item('(A)', 20, 95));
  row(['2', '', '', '9.2', '51'], 75);
  row(['', '30', '', '9.3', '52'], 95);
  row(['', '', '40', '9.4', '53'], 115);
  const words = ['shared', 'settings', 'instead'].map((text, index) => ({ text, spaceBefore: index > 0,
    rect: { x: 80 + index * 60, y: 128, width: text.length * 4, height: 7 }, baselineX: 80 + index * 60,
    baseline: 135, advanceWidth: text.length * 4 }));
  const phrase = item('shared settings instead', 80, 135, words);
  phrase.rect.width = 148; text.push(item('(E)', 20, 135), phrase); row(['', '', '', '9.5', '54'], 135);
  text.push(item('big', 20, 155)); row(['3', '50', '60', '9.6', '55'], 155);
  const rules = [10, 40, 60, 120, 140, 170].map(at => ({ axis: 'h', at, from: 10, to: 450 }));
  // Split each continuous vertical rule at every row, as real PDF writers do.
  for (const at of [60, 280]) for (const [index, from] of [10, 40, 60, 80, 100, 120, 140].entries()) {
    const to = [40, 60, 80, 100, 120, 140, 170][index]; rules.push({ axis: 'v', at, from: from + .2, to: to - .2 });
  }
  const graphics = rules.map((rule, index) => ({ id: 'd' + index, order: 0, decoration: true, thin: true, opaque: true,
    rect: rule.axis === 'h' ? { x: rule.from - .2, y: rule.at - .2, width: rule.to - rule.from + .4, height: .4 }
      : { x: rule.at - .2, y: rule.from - .2, width: .4, height: rule.to - rule.from + .4 } }));
  return { text, rules, graphics, sources: text.map(item => ({ id: item.id, text: item.text, rect: item.rect,
    order: item.order, disposition: 'editable' })), bounds: { x: 0, y: 0, width: 470, height: 190 } };
}
const data = fixture(), before = structuredClone(data);
const prepared = prepareHorizontalTables(data.text, data.graphics, data.rules, data.sources, data.bounds);
assert.equal(prepared.tables.length, 1);
const table = prepared.tables[0];
assert.equal(table.rows, 7); assert.equal(table.columnWidths.length, 6);
const cellText = cell => cell.blocks.flatMap(block => block.lines).map(line => line.text).join(' ');
assert.equal(table.cells.find(cell => cellText(cell) === '(A)').rowSpan, 3, 'group label spans the proven horizontal section');
assert.equal(table.cells.find(cell => cellText(cell) === 'shared settings instead').colSpan, 3,
  'prose spans only the region bounded by continuous original vertical rules');
for (const [row, col, value] of [[2, 1, '2'], [2, 2, ''], [3, 2, '30'], [3, 1, ''], [4, 3, '40']]) {
  assert.equal(cellText(table.cells.find(cell => cell.row === row && cell.col === col)), value,
    'sparse cells keep their source column rather than shifting across a missing value');
}
assert(data.graphics.every(item => horizontalTableRule(item, table)));
assert.deepEqual(data.text, before.text); assert.deepEqual(data.graphics, before.graphics);
assert.equal(data.sources.map(s => s.text).join('').replace(/\s/gu, ''), before.sources.map(s => s.text).join('').replace(/\s/gu, ''));
assert.equal(new Set(data.sources.map(s => s.id)).size, data.sources.length);
const grouped = groupPageRegions(prepared.text, data.graphics, data.rules, data.sources, { horizontalTables: prepared.tables, bounds: data.bounds });
assert.equal(grouped.items.filter(item => item.type === 'table').length, 1,
  'complete recovery supersedes partial ruled candidates without competing source ownership');
const imageRules = grouped.items.filter(item => item.type === 'image');
assert.equal(imageRules.length, 8, 'collinear vertical pieces merge into two strips; crossing rules never become a full table crop');
assert(imageRules.every(item => item.rect.width <= 2 || item.rect.height <= 2));
assert.equal(grouped.drawingOwnership.length, data.graphics.length);
const scene = { number: 1, width: 470, height: 190, sources: data.sources, items: grouped.items,
  rules: data.rules, risks: grouped.risks, characters: before.sources.reduce((sum, item) => sum + item.text.replace(/\s/gu, '').length, 0) };
assert.equal(needsPageOcr(scene), false, 'a proven sparse native table does not trigger an unnecessary whole-page OCR pass');
const context = createCanvas(1, 1).getContext('2d');
assert.deepEqual(tablesRequiringFallback(scene, context), []);
const document = inferDocument([{ ...scene, items: [table] }], { preserveGeometry: true });
assert.equal(validateCoverage(document).imageCharacters, 0);
const result = await createWordBytes(document, [], { preserveGeometry: true, measurementContext: context });
const xml = await (await JSZip.loadAsync(result.bytes)).file('word/document.xml').async('string');
assert.equal((xml.match(/<w:tbl>/gu) || []).length, 1);
assert(xml.includes('<w:gridSpan w:val="3"/>'));
assert(xml.includes('<w:vMerge w:val="restart"/>') && (xml.match(/<w:vMerge w:val="continue"\/>/gu) || []).length === 2);
assert(xml.includes('shared') && xml.includes('settings') && xml.includes('instead'));
for (const change of [
  d => { d.rules = d.rules.filter(rule => !(rule.axis === 'v' && rule.at === 60 && rule.from > 60 && rule.from < 81)); },
  d => { d.text.find(item => item.text === '30').rect.x += 25; },
  d => { d.text[7].raster = true; },
  d => { d.graphics[0].opaque = false; },
  d => { d.sources[7].disposition = 'excluded-hidden'; },
  d => { d.text.find(item => item.words).words[0].text = 'wrong'; },
  d => { d.graphics.push({ rect: { x: 290, y: 70, width: 40, height: 40 } }); },
]) {
  const value = fixture(); change(value); const originalSources = structuredClone(value.sources);
  assert.equal(prepareHorizontalTables(value.text, value.graphics, value.rules, value.sources, value.bounds).tables.length, 0);
  assert.deepEqual(value.sources, originalSources, 'a rejected candidate cannot mutate the source ledger');
}
const line = { baseline: 100, items: [{ type: 'text', text: '45', size: 10, font: 'Arial', preciseInk: true,
  baseline: 100, rect: { x: 20, y: 93, width: 10, height: 7 } }] };
const originalLine = structuredClone(line), normal = measureLineBox(line, context);
const fit = measureLineBox(line, context, false, { top: 91, bottom: 102 });
assert(fit.height < normal.height && fit.height >= 7);
assert(line.baseline - fit.baselineOffset >= 91 - .05);
assert(line.baseline - fit.baselineOffset + fit.height <= 102 + .05);
assert.deepEqual(line, originalLine, 'compact leading never changes source font, size, baseline or glyphs');
assert.equal(measureLineBox(line, context, false, { top: 97, bottom: 102 }).height, normal.height,
  'a source glyph crossing the cell boundary cannot be made to fit by clipping');
assert.equal(measureLineBox({ ...line, items: [{ ...line.items[0], ocr: true }] }, context, false,
  { top: 91, bottom: 102 }).height, normal.height, 'OCR retains its separately calibrated line metrics');
console.log('Partial ruled tables: sparse columns, row/column merges, strip ownership, real Word cells, bounded leading and conservative rejection passed.');
