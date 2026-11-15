import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { prepareHorizontalTables } from '../src/features/pdf-to-word/core/horizontal-tables.js';
import { inferDocument, validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes, tablesRequiringFallback } from '../src/features/pdf-to-word/adapters/docx.js';

function fixture() {
  const text = [], values = [['System', 'Dev', 'Test'], ['Alpha', '51.9', '52.7'], ['Beta', '59.1', '59.2'],
    ['Gamma', '-', '78.0'], ['Delta', '81.6', '-'], ['Epsilon', '86.6', '86.3']];
  for (const [row, cells] of values.entries()) for (const [col, value] of cells.entries()) {
    const id = 'p1:t' + text.length, baseline = row ? 45 + row * 20 : 26, width = value.length * 5;
    text.push({ id, sourceIds: [id], text: value, size: 10, font: 'Arial', color: '000000', preciseInk: true,
      baseline, order: text.length, rect: { x: col ? 170 + col * 70 - width / 2 : 20, y: baseline - 8, width, height: 8 } });
  }
  const rules = [10, 42, 115, 155].map(at => ({ axis: 'h', at, from: 10, to: 340 }));
  const graphics = rules.map((rule, index) => ({ id: 'd' + index, decoration: true, thin: true, opaque: true,
    rect: { x: 10, y: rule.at - .25, width: 330, height: .5 } }));
  const sources = text.map(item => ({ id: item.id, text: item.text, rect: item.rect, disposition: 'editable' }));
  return { text, rules, graphics, sources, values, bounds: { x: 0, y: 0, width: 350, height: 180 } };
}
const data = fixture(), original = structuredClone(data);
const prepared = prepareHorizontalTables(data.text, data.graphics, data.rules, data.sources, data.bounds);
assert.equal(prepared.tables.length, 1);
const table = prepared.tables[0];
assert.equal(table.rows, 6); assert.equal(table.columnWidths.length, 3); assert.equal(table.cells.length, 18);
assert.deepEqual(table.cells.map(cell => cell.blocks.flatMap(block => block.lines).map(line => line.text).join('')), data.values.flat());
assert.deepEqual(data.text, original.text); assert.deepEqual(data.graphics, original.graphics); assert.deepEqual(data.sources, original.sources);
assert.equal(new Set(table.sourceIds).size, 18);
const context = createCanvas(1, 1).getContext('2d');
assert.deepEqual(tablesRequiringFallback({ items: [table] }, context), []);
const raised = fixture(), label = raised.text.find(item => item.text === 'Epsilon');
raised.rules[2].at = 93; raised.graphics[2].rect.y = 92.75;
const marker = { ...label, id: 'p1:marker', sourceIds: ['p1:marker'], text: '†', size: 6,
  baseline: label.baseline - 4, rect: { x: label.rect.x + label.rect.width + 1, y: label.rect.y - 7, width: 3, height: 6 } };
raised.text.push(marker); raised.sources.push({ id: marker.id, text: marker.text, rect: marker.rect, disposition: 'editable' });
const raisedTable = prepareHorizontalTables(raised.text, raised.graphics, raised.rules, raised.sources, raised.bounds).tables[0];
assert(raisedTable);
assert.equal(raisedTable.cells.find(cell => cell.row === 5 && cell.col === 0).blocks[0].lines[0].items.at(-1).baseline,
  marker.baseline, 'a raised footnote keeps its own source baseline');
assert(raisedTable.cells.find(cell => cell.row === 5 && cell.col === 0).rect.y < table.cells.find(cell => cell.row === 5 && cell.col === 0).rect.y,
  'only the unruled boundary moves through proven whitespace to reserve the real raised ink');
assert.deepEqual(tablesRequiringFallback({ items: [raisedTable] }, context), []);
const document = inferDocument([{ number: 1, width: 350, height: 180, sources: data.sources, items: [table],
  rules: data.rules, risks: [], characters: data.values.flat().join('').length }], { preserveGeometry: true });
assert.equal(validateCoverage(document).imageCharacters, 0);
const output = await createWordBytes(document, [], { preserveGeometry: true, measurementContext: context });
const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
assert.equal((xml.match(/<w:tbl>/gu) || []).length, 1);
assert.deepEqual([...xml.matchAll(/<w:tc>(.*?)<\/w:tc>/gs)].map(match =>
  [...match[1].matchAll(/<w:t(?: [^>]*)?>(.*?)<\/w:t>/gs)].map(value => value[1]).join('')), data.values.flat(),
  'actual Word cells retain every explicit missing-value dash in the correct column');
for (const change of [
  d => { d.text = d.text.filter(item => item.text !== '-'); },
  d => { d.text.find(item => item.text === '59.2').rect.x += 20; },
  d => { const item = d.text.find(item => item.text === 'Test'); item.rect.y += 16; item.baseline += 16; },
  d => { d.text.find(item => item.text === 'Gamma').text = '123'; },
  d => { d.rules.push({ axis: 'v', at: 190, from: 10, to: 155 }); },
  d => { d.graphics.push({ rect: { x: 25, y: 50, width: 30, height: 25 } }); },
  d => { d.graphics[0].opaque = false; },
  d => { d.sources[1].disposition = 'excluded-hidden'; },
  d => { d.sources[2].encodingCorrections = [{}]; },
  d => { d.text[3].raster = true; },
]) {
  const invalid = fixture(); change(invalid); const before = structuredClone(invalid.sources);
  assert.equal(prepareHorizontalTables(invalid.text, invalid.graphics, invalid.rules, invalid.sources, invalid.bounds).tables.length, 0,
    'unproven sparse values, columns, headers or source evidence preserve fallback: ' + change.toString());
  assert.deepEqual(invalid.sources, before);
}
console.log('Sparse horizontal tables: explicit dash values, repeated independent columns, exact source ownership, native Word cells and conservative rejection passed.');
