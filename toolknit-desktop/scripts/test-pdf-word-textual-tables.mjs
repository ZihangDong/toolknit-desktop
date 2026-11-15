import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { prepareHorizontalTables } from '../src/features/pdf-to-word/core/horizontal-tables.js';
import { inferDocument, validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes, tablesRequiringFallback } from '../src/features/pdf-to-word/adapters/docx.js';
import { resultTargets, applyResultEdits } from '../src/features/pdf-to-word/core/result-edit.js';
import { union } from '../src/features/pdf-to-word/core/geometry.js';

const context = createCanvas(1, 1).getContext('2d');
function glyph(text, x, baseline, size = 10) {
  context.font = '1000px "SimSun"'; context.fontKerning = 'none';
  const m = context.measureText(text), k = size / 1000;
  return { text, size, font: 'SimSun', preciseInk: true, baseline, baselineX: x,
    advanceWidth: m.width * k, rect: { x: x - m.actualBoundingBoxLeft * k, y: baseline - m.actualBoundingBoxAscent * k,
      width: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * k,
      height: (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * k } };
}
function fixture({ sparse = false, first = 5, align = 'center', note = false } = {}) {
  const texts = sparse ? [['Head1', 'Head2', 'Head3', 'Head4'], ...[first, first + 1, first + 2].map(n => ['Line' + n])]
    : [['字段', '描述'], ['alpha.dat', '说明，继续'], ['beta.dat', '普通文本'], ['gamma.dat', '详细说明']];
  const text = [], centers = sparse ? [45, 100, 155, 210] : [75, 220];
  for (const [row, cells] of texts.entries()) {
    const baseline = row ? 36 + row * 26 : 25, words = [];
    for (const [col, value] of cells.entries()) {
      const parts = value.includes('，') ? ['说明', '，', '继续'] : [value];
      const width = parts.reduce((sum, p) => sum + glyph(p, 0, baseline).advanceWidth, 0);
      let x = align === 'left' ? (sparse ? centers[col] - 20 : col ? 160 : 25) : centers[col] - width / 2;
      for (const [i, part] of parts.entries()) {
        const word = glyph(part, x, baseline); word.spaceBefore = col > 0 && i === 0;
        words.push(word); x += word.advanceWidth;
      }
    }
    const id = 'native:' + row;
    text.push({ id, sourceIds: [id], type: 'text', text: cells.join(' '), words, size: 10,
      font: 'SimSun', color: '000000', preciseInk: true, baseline, baselineX: words[0].baselineX,
      order: row, rect: union(words.map(w => w.rect)) });
  }
  if (note) {
    const main = text[1].words[0], mark = glyph('a', main.rect.x + main.rect.width + .3, main.baseline - 4, 7);
    text.push({ ...mark, id: 'note', sourceIds: ['note'], type: 'text', order: 10, color: '000000' });
  }
  const rules = [10, 36, 121].map(at => ({ axis: 'h', at, from: 10, to: 290 }));
  const graphics = rules.map((r, i) => ({ id: 'line:' + i, type: 'image', sourceIds: [], decoration: true, thin: true,
    opaque: true, rect: { x: r.from, y: r.at - .25, width: r.to - r.from, height: .5 } }));
  return { text, rules, graphics, bounds: { x: 0, y: 0, width: 310, height: 150 },
    sources: text.map(t => ({ id: t.id, text: t.text, rect: t.rect, disposition: 'editable' })) };
}
const prepare = f => prepareHorizontalTables(f.text, f.graphics, f.rules, f.sources, f.bounds);
for (const options of [{}, { align: 'left' }, { note: true }, { sparse: true }, { sparse: true, first: 8 }]) {
  const f = fixture(options), before = structuredClone(f), prepared = prepare(f);
  assert.equal(prepared.tables.length, 1, JSON.stringify(options));
  const table = prepared.tables[0], cols = options.sparse ? 4 : 2;
  assert.equal(table.rows, 4); assert.equal(table.cells.length, 4 * cols);
  assert.deepEqual(f.text, before.text, 'cell recovery does not mutate extracted glyph styles');
  assert.deepEqual(f.graphics, before.graphics, 'original rules and drawing ownership remain intact');
  assert.equal(f.sources.map(s => s.text).join('').replace(/\s/gu, ''), before.sources.map(s => s.text).join('').replace(/\s/gu, ''));
  assert.equal(new Set(table.sourceIds).size, table.sourceIds.length);
  assert.deepEqual(tablesRequiringFallback({ items: [table] }, context), [], 'the actual writer can fit every cell: ' + JSON.stringify(options));
  if (options.sparse) {
    assert.equal(table.cells.filter(c => c.blocks.length === 0).length, 9, 'empty columns remain independent cells');
    assert(table.cells.every(c => c.colSpan === 1 && c.rowSpan === 1), 'short row labels do not invent merged cells');
  } else {
    const contents = table.cells.map(c => c.blocks.flatMap(b => b.lines).map(l => l.text).join('').replace(/\s/gu, ''));
    assert(contents.includes('说明，继续'), 'a comma side-bearing cannot split its real cell');
    if (options.note) assert(table.cells.some(c => c.blocks.flatMap(b => b.lines).flatMap(l => l.items).some(i => i.text === 'a' && i.baseline === before.text.at(-1).baseline)));
  }
  const doc = inferDocument([{ number: 1, width: 310, height: 150, items: [table], sources: f.sources, rules: f.rules, risks: [], characters: 0 }], { preserveGeometry: true });
  assert.equal(validateCoverage(doc).imageCharacters, 0);
  const bytes = await createWordBytes(doc, [], { preserveGeometry: true, measurementContext: context });
  const xml = await (await JSZip.loadAsync(bytes.bytes)).file('word/document.xml').async('string');
  assert.equal((xml.match(/<w:tbl>/g) || []).length, 1); assert.equal((xml.match(/<w:tc>/g) || []).length, cols * 4);
  if (options.sparse) {
    const blank = [...xml.matchAll(/<w:tc>(.*?)<\/w:tc>/gs)].map(m => m[1]).filter(cell => !/<w:t(?:\s|>)/u.test(cell));
    assert.equal(blank.length, 9);
    assert(blank.every(cell => cell.includes('<w:sz w:val="22"')), 'blank cells keep the existing readable fillable style');
  }
  const target = resultTargets(doc.pages[0]).find(t => t.type === 'text' && t.text.includes(options.sparse ? 'Line' : 'alpha'));
  assert(target); const edited = applyResultEdits(doc, { [target.key]: { type: 'delete' } });
  assert(!resultTargets(edited.pages[0]).some(t => t.key === target.key));
  assert.equal(edited.pages[0].blocks[0].cells.length, table.cells.length, 'deletion retains all neighbouring and empty cells');
}
for (const change of [
  f => { f.rules = f.rules.filter(r => r.at !== 36); },
  f => { f.rules.push({ axis: 'v', at: 110, from: 10, to: 121 }); },
  f => { f.graphics.push({ type: 'image', rect: { x: 30, y: 45, width: 10, height: 10 }, sourceIds: [] }); },
  f => { for (const t of f.text) t.ocr = true; },
  f => { f.text[1].raster = true; },
  f => { f.text[1].words[0].mathStyleUncertain = true; },
  f => { f.text[1].words[0].text = 'a=b'; f.text[1].text = f.text[1].text.replace('alpha.dat', 'a=b'); f.sources[1].text = f.text[1].text; },
  f => { f.text[2].words[1].rect.x += 25; },
  f => { f.text = f.text.slice(0, 3); f.sources = f.sources.slice(0, 3); },
]) {
  const f = fixture(); change(f); const before = structuredClone(f.sources);
  assert.equal(prepare(f).tables.length, 0, 'ambiguous geometry, graphics, scans, math and too few rows do not create a text grid');
  assert.deepEqual(f.sources, before);
}
const nonconsecutive = fixture({ sparse: true });
nonconsecutive.text[2].text = 'Line9'; nonconsecutive.text[2].words[0].text = 'Line9'; nonconsecutive.sources[2].text = 'Line9';
assert.equal(prepare(nonconsecutive).tables.length, 0, 'blank columns need complete consecutive row-label evidence');
console.log('Native text tables: centred/left alignment, source punctuation advance, raised notes, genuine blank cells, continuation indices, actual DOCX/deletion and conservative refusal passed.');
