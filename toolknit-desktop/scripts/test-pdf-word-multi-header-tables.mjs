import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { prepareHorizontalTables } from '../src/features/pdf-to-word/core/horizontal-tables.js';
import { inferDocument, validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

function fixture(allNumeric = false) {
  const text = [], top = 10, separator = allNumeric ? 60 : 82, end = allNumeric ? 132 : 152;
  const columns = allNumeric ? 6 : 5, width = columns * 80;
  function add(value, center, baseline) {
    const id = 'p1:t' + text.length, itemWidth = value.length * 5;
    text.push({ id, sourceIds: [id], text: value, size: 10, font: 'Arial', color: '000000',
      preciseInk: true, order: text.length, baseline,
      rect: { x: center - itemWidth / 2, y: baseline - 8, width: itemWidth, height: 8 } });
  }
  if (allNumeric) {
    add('Parameters', 130, 28); add('Scores', 370, 28);
    ['L', 'H', 'A', 'MNLI', 'MRPC', 'SST'].forEach((value, col) => add(value, 50 + col * 80, 50));
    [['3', '768', '12', '77.9', '79.8', '88.4'], ['6', '768', '3', '80.6', '82.2', '90.7'],
      ['12', '1024', '16', '85.7', '86.9', '93.3']].forEach((row, index) =>
      row.forEach((value, col) => add(value, 50 + col * 80, 80 + index * 20)));
  } else {
    add('Tasks', 50, 50); add('Dev', 241, 28); add('Set', 259, 28);
    ['MNLI', 'MRPC', 'SST', 'QNLI'].forEach((value, col) => add(value, 130 + col * 80, 50));
    for (let col = 0; col < 4; col++) add('(Acc)', 130 + col * 80, 72);
    [['ModelA', '84.4', '88.4', '86.7', '92.7'], ['ModelB', '83.9', '84.9', '86.5', '92.6'],
      ['ModelC', '82.1', '84.3', '77.5', '92.1']].forEach((row, index) =>
      row.forEach((value, col) => add(value, 50 + col * 80, 102 + index * 20)));
  }
  const rules = [top, separator, end].map(at => ({ axis: 'h', at, from: 10, to: 10 + width }));
  const graphics = rules.map((rule, index) => ({ id: 'd' + index, decoration: true, thin: true, opaque: true,
    rect: { x: 10, y: rule.at - .25, width, height: .5 } }));
  const sources = text.map(item => ({ id: item.id, text: item.text, rect: item.rect, disposition: 'editable' }));
  return { text, graphics, rules, sources, bounds: { x: 0, y: 0, width: width + 20, height: end + 20 } };
}
const cellText = cell => cell.blocks.flatMap(block => block.lines).map(line => line.text).join('');
for (const numeric of [false, true]) {
  const data = fixture(numeric), before = structuredClone(data);
  const prepared = prepareHorizontalTables(data.text, data.graphics, data.rules, data.sources, data.bounds);
  assert.equal(prepared.tables.length, 1, 'a repeated numeric grid can retain proven grouped headers');
  const table = prepared.tables[0];
  assert.equal(table.rows, numeric ? 5 : 6);
  assert.equal(table.columnWidths.length, numeric ? 6 : 5);
  assert.deepEqual(data.text, before.text); assert.deepEqual(data.graphics, before.graphics);
  assert.deepEqual(data.sources, before.sources, 'unsplit source identities and source geometry remain unchanged');
  assert.equal(new Set(table.sourceIds).size, data.text.length);
  assert.deepEqual(new Set(table.sourceIds), new Set(data.text.map(item => item.id)));
  if (numeric) {
    assert.equal(table.cells.length, 26);
    assert.deepEqual(table.cells.filter(cell => cell.colSpan > 1).map(cell => [cell.row, cell.col, cell.colSpan, cellText(cell)]),
      [[0, 0, 3, 'Parameters'], [0, 3, 3, 'Scores']]);
  } else {
    assert.equal(table.cells.length, 25);
    assert.deepEqual(table.cells.filter(cell => cell.rowSpan > 1).map(cell => [cell.row, cell.col, cell.rowSpan, cellText(cell)]),
      [[0, 0, 3, 'Tasks']]);
    assert.deepEqual(table.cells.filter(cell => cell.colSpan > 1).map(cell => [cell.row, cell.col, cell.colSpan, cellText(cell).replace(/\s/gu, '')]),
      [[0, 1, 4, 'DevSet']]);
  }
  const document = inferDocument([{ number: 1, width: data.bounds.width, height: data.bounds.height,
    sources: data.sources, items: [table], risks: [], rules: data.rules,
    characters: data.sources.reduce((sum, item) => sum + item.text.replace(/\s/gu, '').length, 0) }], { preserveGeometry: true });
  assert.equal(validateCoverage(document).imageCharacters, 0);
  const result = await createWordBytes(document, [], { preserveGeometry: true,
    measurementContext: createCanvas(1, 1).getContext('2d') });
  const xml = await (await JSZip.loadAsync(result.bytes)).file('word/document.xml').async('string');
  assert.equal((xml.match(/<w:tbl>/gu) || []).length, 1);
  assert(xml.includes('<w:gridSpan w:val="3"/>') || xml.includes('<w:gridSpan w:val="4"/>'));
  if (!numeric) assert(xml.includes('<w:vMerge w:val="restart"/>') && xml.includes('<w:vMerge w:val="continue"/>'));
  for (const change of [
    d => { d.text.find(item => item.text === (numeric ? 'Parameters' : 'Dev')).rect.x += 16; },
    d => { d.text.find(item => item.text === (numeric ? '85.7' : '82.1')).rect.x += 20; },
    d => { d.rules.push({ axis: 'v', at: 90, from: 10, to: 132 }); },
    d => { d.graphics[0].opaque = false; },
    d => { d.graphics.push({ rect: { x: 30, y: 35, width: 30, height: 20 } }); },
    d => { d.sources[0].disposition = 'excluded-hidden'; },
    d => { d.sources[0].encodingCorrections = [{}]; },
    d => { d.text[0].raster = true; },
  ]) {
    const invalid = fixture(numeric); change(invalid); const originalSources = structuredClone(invalid.sources);
    const rejected = prepareHorizontalTables(invalid.text, invalid.graphics, invalid.rules, invalid.sources, invalid.bounds);
    assert.equal(rejected.tables.length, 0,
      'ambiguous spans, columns, rules, image content or source evidence keep the fallback path: ' + change.toString());
    assert.deepEqual(invalid.sources, originalSources);
  }
}
console.log('Multi-level table headers: proven column/row spans, all-numeric bodies, real Word tables and conservative rejection passed.');
