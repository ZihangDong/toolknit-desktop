import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { nativeMappingTablePlans, nativeMappingRowCandidate } from '../src/features/pdf-to-word/core/native-mapping-tables.js';
import { recoverNativeMappingTables } from '../src/features/pdf-to-word/adapters/native-mapping-tables.js';
import { fitNativeMappingArrow } from '../src/features/pdf-to-word/adapters/math-text.js';
import { measureLineBox } from '../src/features/pdf-to-word/adapters/text-layout.js';
import { createWordBytes, tablesRequiringFallback } from '../src/features/pdf-to-word/adapters/docx.js';
import { inferDocument, validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { sceneLayoutBytes } from '../src/features/pdf-to-word/core/scene-budget.js';
import { resultTargets, layoutEditedText, applyResultEdits } from '../src/features/pdf-to-word/core/result-edit.js';
import { measureResultText } from '../src/features/pdf-to-word/result-preview.js';

const context = createCanvas(1, 1).getContext('2d');
function native(text, font, paintFont, x, baseline, size, id) {
  context.font = `1000px "${paintFont}"`; context.fontKerning = 'none'; const m = context.measureText(text), k = size / 1000;
  return { id, type: 'text', sourceIds: [id], text, font: 'ABCDEF+' + font, size, baseline, baselineX: x, advanceWidth: m.width * k,
    rect: { x: x - m.actualBoundingBoxLeft * k, y: baseline - m.actualBoundingBoxAscent * k,
      width: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * k, height: (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * k },
    preciseInk: true, raster: false, italic: false, bold: false, color: '000000', order: Number(id.split(':')[1]) || 1 };
}
function fixture() {
  const items = [], sources = [];
  for (let row = 0; row < 5; row++) {
    const y = 55 + row * 22, left = native('source{' + 'x'.repeat(row) + row + '}', 'CourierNewPSMT', 'Courier New', 20, y, 12, `left:${row}`);
    const arrow = native('⇒', 'XITSMath-Regular', 'Cambria Math', 180, y, 12, `arrow:${row}`);
    const rhs = native('示例', 'SimSun', 'SimSun', 210, y, 12, `rhs:${row}`);
    const index = native('[12]', 'TimesNewRomanPSMT', 'Times New Roman', 236, y - (row % 2 ? 4.8 : 0), row % 2 ? 9 : 12, `index:${row}`);
    items.push(left, { id: arrow.id + ':image', type: 'image', role: 'math', sourceIds: [arrow.id], rect: { ...arrow.rect }, order: row,
      mathGlyphs: [arrow], mathStrokes: [], drawingIds: [], reasons: [] }, rhs, index);
    sources.push(...[left, arrow, rhs, index].map(item => ({ id: item.id, text: item.text, rect: { ...item.rect }, order: item.order,
      disposition: item === arrow ? 'visible-image' : 'editable' })));
  }
  return { number: 1, width: 400, height: 220, items, sources, rules: [], risks: [], characters: sources.reduce((n, s) => n + s.text.length, 0) };
}
const planner = scene => nativeMappingTablePlans(scene, { fitArrow: glyph => fitNativeMappingArrow(glyph, context),
  measureLine: line => measureLineBox(line, context, false, null, true) });
const original = fixture(), frozen = structuredClone(original), plans = planner(original);
assert.equal(plans.length, 1); assert.deepEqual(original, frozen, 'the pure planner preserves all original text, source identities and ink geometry');
const prepared = structuredClone(original); recoverNativeMappingTables(prepared, context);
assert.equal(prepared.items.length, 1); const table = prepared.items[0];
assert(table.borderless && table.nativeMappingBaseline && table.rows === 5 && table.cells.length === 15 && table.columnWidths.length === 3);
assert.equal(new Set(table.sourceIds).size, original.sources.length);
assert.deepEqual(prepared.sources, original.sources.map(source => ({ ...source, disposition: 'editable' })));
assert.deepEqual(tablesRequiringFallback(prepared, context), []);
assert(sceneLayoutBytes(prepared) >= table.cells.length * 2048, 'derived native cells count against scene memory');
const again = structuredClone(prepared); recoverNativeMappingTables(prepared, context); assert.deepEqual(prepared, again);
const excluded = fixture(); recoverNativeMappingTables(excluded, context, [table.id]); assert.deepEqual(excluded, original, 'a rejected table cannot be reconstructed by the fallback pass');
const tooTight = structuredClone(table); tooTight.cells[0].rect.height = 2; tooTight.rowHeights[0] = 2;
assert.deepEqual(tablesRequiringFallback({ items: [tooTight] }, context), [table.id], 'impossible cell ink/leading still fails the unchanged writer preflight');
const rowLine = table.cells[0].blocks[0].lines[0], measured = measureLineBox(rowLine, context, false, null, true);
assert.equal(measured.baselineOffset, Math.round(measured.height * 20) / 20 * .8);
assert.notEqual(measureLineBox(rowLine, context).baselineOffset, measured.baselineOffset, 'ordinary flow/table paths do not inherit the new row calibration');
for (const change of [item => { item.font = 'UnknownFace'; }, item => { item.ocr = true; }, item => { item.italic = true; },
  item => { item.size = NaN; }, item => { item.font = 'Arial'; item.sourceFont = 'ABCDEF+CourierNewPSMT'; }]) {
  const item = structuredClone(rowLine.items[0]); change(item); assert(!nativeMappingRowCandidate(item));
}
for (const mutate of [
  scene => { scene.items[0].font = 'UnknownFace'; },
  scene => { scene.items[0].bold = true; },
  scene => { scene.items[0].raster = true; },
  scene => { scene.items[0].ocr = true; },
  scene => { scene.items[0].color = 'FF0000'; },
  scene => { scene.items[4].rect.x += 2; scene.sources[4].rect.x += 2; },
  scene => { scene.items[0].rect.x = -1; scene.sources[0].rect.x = -1; },
  scene => { scene.sources[0].text = 'unrelated'; },
  scene => { scene.sources.push(structuredClone(scene.sources[0])); },
  scene => { scene.items[3].baseline -= 20; },
  scene => { scene.items[5].mathGlyphs[0].baseline += 2; },
  scene => { scene.items[1].mathGlyphs[0].font = 'UnknownFace'; },
  scene => { scene.items.push({ id: 'overlay', type: 'image', sourceIds: [], rect: { x: 150, y: 80, width: 20, height: 10 } }); },
  scene => { scene.rules.push({ axis: 'h', at: 90, from: 10, to: 300 }); },
  scene => { scene.rules.push({ axis: 'v', at: NaN, from: 10, to: 300 }); },
  scene => { scene.items.splice(8); scene.sources.splice(8); },
  scene => { scene.items.push(...Array.from({ length: 3001 }, () => structuredClone(scene.items[0]))); },
]) {
  const bad = fixture(); mutate(bad); const before = structuredClone(bad); assert.equal(planner(bad).length, 0, 'ambiguous grid, wrong source/style, clipping, graphics and exhausted budgets refuse whole plans');
  assert.deepEqual(bad, before);
}
assert.deepEqual(nativeMappingTablePlans(original, { fitArrow: () => ({ font: 'Cambria Math', size: NaN }), measureLine: () => ({ height: 20, baselineOffset: 16 }) }), []);
assert.deepEqual(nativeMappingTablePlans(original, { fitArrow: glyph => fitNativeMappingArrow(glyph, context), measureLine: () => ({ height: 20, baselineOffset: NaN }) }), []);
const document = inferDocument([prepared], { preserveGeometry: true }); validateCoverage(document);
const options = { preserveGeometry: true, measurementContext: context }, result = await createWordBytes(document, [], options);
const xml = await (await JSZip.loadAsync(result.bytes)).file('word/document.xml').async('string');
assert.equal((xml.match(/<w:tbl>/g) || []).length, 1); assert.equal((xml.match(/<w:tc>/g) || []).length, 15);
assert(!xml.includes('<w:drawing') && xml.includes('>⇒</w:t>'));
const page = document.pages[0], targets = resultTargets(page), target = targets.find(t => t.text === 'source{0}'); assert(target);
const measure = (text, style) => measureResultText(text, style, context); measure.metrics = (text, style) => measureResultText.metrics(text, style, context);
assert.deepEqual(layoutEditedText(target, target.text, measure, { page }), { type: 'noop' });
const edit = layoutEditedText(target, 'source{1}', measure, { page });
assert(edit.lines.flatMap(line => line.items).every(item => item.font === target.items[0].font && item.size === 12));
await createWordBytes(applyResultEdits(document, { [target.key]: edit }), [], options);
const deleted = applyResultEdits(document, Object.fromEntries(targets.map(t => [t.key, { type: 'delete' }])));
assert.equal(deleted.pages[0].blocks[0].cells.length, 15); assert(deleted.pages[0].blocks[0].cells.every(cell => !cell.blocks.length));
await createWordBytes(deleted, [], options); assert.deepEqual(applyResultEdits(document, {}), document);
console.log('Native mapping tables: complete native sources, regular monospace pairs, separate arrow cells, mixed raised text, bounded/atomic plans, preflight/fallback, actual DOCX, source-styled edits and deletion passed.');
