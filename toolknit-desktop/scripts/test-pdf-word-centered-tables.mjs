import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { centeredTextTables } from '../src/features/pdf-to-word/core/centered-text-tables.js';
import { groupLines } from '../src/features/pdf-to-word/core/text.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import { inferDocument, validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes, tablesRequiringFallback } from '../src/features/pdf-to-word/adapters/docx.js';
import { resultTargets, applyResultEdits } from '../src/features/pdf-to-word/core/result-edit.js';

const context = createCanvas(1, 1).getContext('2d');
function fixture({ merged = false } = {}) {
  const text = [];
  function item(value, center, baseline, size) {
    context.font = `1000px "SimSun"`; const m = context.measureText(value), scale = size / 1000;
    const x = center - m.width * scale / 2, id = 'native:' + text.length;
    const t = { id, type: 'text', sourceIds: [id], text: value, baseline, baselineX: x, size, font: 'SimSun',
      color: '000000', raster: false, preciseInk: true, order: text.length, advanceWidth: m.width * scale,
      rect: { x: x - m.actualBoundingBoxLeft * scale, y: baseline - m.actualBoundingBoxAscent * scale,
        width: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * scale,
        height: (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * scale } };
    text.push(t);
  }
  item('人员名单', 210, 30, 14);
  if (merged) {
    const data = [['主席', '甲', '教授', '大学'], ['委员', '乙', '教授', '学校'], ['', '', '', '学院'], ['', '', '', '研究所'],
      ['', '丁', '教授', '大学'], ['', '戊', '副教授', '学校'], ['秘书', '己', '助理教授', '学院']];
    data.forEach((row, i) => row.forEach((value, col) => { if (value) item(value, [60, 150, 250, 390][col], 56 + i * 20, 12); }));
    item('丙', 150, 106, 12); item('研究员', 250, 106, 12);
  } else [['甲', '教授', '大学'], ['乙', '副教授', '学院'], ['丙', '助理教授', '学校']].forEach((row, i) =>
    row.forEach((value, col) => item(value, [70, 180, 340][col], 56 + i * 20, 12)));
  return { text, sources: text.map(t => ({ id: t.id, text: t.text, rect: { ...t.rect }, disposition: 'editable', order: t.order })),
    bounds: { x: 0, y: 0, width: merged ? 460 : 430, height: merged ? 230 : 160 }, excluded: [] };
}
const prepare = f => centeredTextTables(groupLines(f.text), f.excluded, f.bounds, f.sources);
const f = fixture(), before = structuredClone(f), tables = prepare(f);
assert.equal(tables.length, 1); const table = tables[0];
assert.equal(table.rows, 3); assert.equal(table.columnWidths.length, 3); assert.equal(table.cells.length, 9);
assert(table.borderless && table.cells.every(c => c.rowSpan === 1 && c.colSpan === 1));
assert.deepEqual(f, before, 'proposals retain all original native items, styles, positions and sources');
const nativeCore = fixture(); nativeCore.text.forEach(item => { delete item.type; });
assert.equal(prepare(nativeCore).length, 1, 'real pre-layout native scene leaves do not yet have a type discriminator');
assert.deepEqual(tablesRequiringFallback({ items: [table] }, context), []);
const grouped = groupPageRegions(f.text, [], [], f.sources, { bounds: f.bounds });
assert.equal(grouped.items.filter(i => i.type === 'table').length, 1, 'the actual scene pipeline recognizes the grid before column inference');
const scene = { number: 1, width: 430, height: 160, items: grouped.items, sources: f.sources, rules: [], risks: [], characters: 30 };
const document = inferDocument([scene], { preserveGeometry: true });
assert.equal(validateCoverage(document).imageCharacters, 0);
const bytes = await createWordBytes(document, [], { preserveGeometry: true, measurementContext: context });
const xml = await (await JSZip.loadAsync(bytes.bytes)).file('word/document.xml').async('string');
assert.equal((xml.match(/<w:tbl>/g) || []).length, 1); assert.equal((xml.match(/<w:tc>/g) || []).length, 9);
assert(!xml.includes('<w:drawing>') && !xml.includes('<m:oMath>'), 'short table labels stay ordinary editable cells');
const target = resultTargets(document.pages[0]).find(t => t.type === 'text' && t.text.includes('助理教授'));
assert(target);
const edited = applyResultEdits(document, { [target.key]: { type: 'delete' } });
assert(!resultTargets(edited.pages[0]).some(t => t.key === target.key));
assert.equal(edited.pages[0].blocks.find(b => b.type === 'table').cells.length, 9, 'editing leaves the grid and other cells intact');
const mf = fixture({ merged: true }), mBefore = structuredClone(mf), mt = prepare(mf);
assert.equal(mt.length, 1); assert.deepEqual(mf, mBefore);
assert.equal(mt[0].rows, 7); assert.equal(mt[0].columnWidths.length, 4);
assert.equal(mt[0].cells.filter(c => c.rowSpan === 2).length, 2);
assert.equal(mt[0].cells.filter(c => !c.blocks.length).length, 4, 'absent labels are genuine independent blanks, not invented vertical merges');
assert.deepEqual(tablesRequiringFallback({ items: mt }, context), []);
const md = inferDocument([{ ...scene, width: 460, height: 230, items: [mf.text[0], ...mt], sources: mf.sources }], { preserveGeometry: true });
const mb = await createWordBytes(md, [], { preserveGeometry: true, measurementContext: context });
const mx = await (await JSZip.loadAsync(mb.bytes)).file('word/document.xml').async('string');
assert.equal((mx.match(/<w:vMerge w:val="restart"/g) || []).length, 2);
assert.equal((mx.match(/<w:vMerge w:val="continue"/g) || []).length, 2);
assert.equal((mx.match(/<w:tc>/g) || []).length, 28, 'physical grid remains complete after DOCX writes merge continuation cells');
for (const mutate of [
  value => { const t = value.text.find(t => t.text === '研究员'); t.baseline -= 10; t.rect.y -= 10; value.sources.find(s => s.id === t.id).rect.y -= 10; },
  value => { const t = value.text.find(t => t.text === '研究员'); t.baseline += 2; t.rect.y += 2; value.sources.find(s => s.id === t.id).rect.y += 2; },
  value => { const t = value.text.find(t => t.text === '学院' && t.baseline === 96); value.text.splice(value.text.indexOf(t), 1); },
]) { const value = fixture({ merged: true }); mutate(value); assert.equal(prepare(value).length, 0, 'paired span and complete neighbouring physical rows must both be proven'); }
for (const [index, mutate] of [
  x => { x.text.shift(); },
  x => { x.text[0].size = 12; },
  x => { x.text = x.text.filter((_, i) => i % 3 !== 0 || i === 0); },
  x => { x.text[4].baseline += 3; x.text[4].rect.y += 3; x.sources[4].rect.y += 3; },
  x => { x.text[5].rect.x += 12; x.sources[5].rect.x += 12; },
  x => { x.text[4].raster = true; },
  x => { x.text[4].ocr = true; },
  x => { x.text[4].preciseInk = false; },
  x => { x.text[4].mathStyleUncertain = true; },
  x => { x.text[4].italic = true; },
  x => { x.sources[4].disposition = 'visible-image'; },
  x => { x.sources[4].text = '不同文字'; },
  x => { x.sources[4].rect.width += 1; },
  x => { x.sources.push(structuredClone(x.sources[4])); },
  x => { x.excluded.push({ x: 60, y: 40, width: 10, height: 70 }); },
  x => { x.bounds.width = 250; },
  x => { x.text.pop(); },
].entries()) {
  const value = fixture(); mutate(value); const saved = structuredClone(value);
  assert.equal(prepare(value).length, 0, `insufficient, foreign, ambiguous, scanned or conflicting geometry stays unchanged: ${index}`);
  assert.deepEqual(value, saved);
}
console.log('Centered native tables: distinct heading, repeated aligned cells, real scene/DOCX/deletion, complete source ownership and prose/scan/geometry exclusion passed.');
