import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import { emptyFormTables } from '../src/features/pdf-to-word/core/empty-form-tables.js';
import { sceneLayoutBytes } from '../src/features/pdf-to-word/core/scene-budget.js';
import { inferDocument, validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { prepareWordScene } from '../src/features/pdf-to-word/adapters/scene.js';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';

function fixture(chinese = false, openCorners = false) {
  const labels = chinese ? ['姓名', '电话', '邮箱'] : ['NAME', 'PHONE', 'EMAIL'];
  const text = labels.map((value, row) => ({ id: 'label' + row, text: value, preciseInk: true, bold: true,
    size: 8, font: chinese ? 'SimSun' : 'Arial', baseline: 34 + row * 22,
    rect: { x: 20, y: 28 + row * 22, width: 34, height: 6 } }));
  const rules = [20, 42, 64, 86].map(at => ({ axis: 'h', at, from: 60, to: 200 }));
  if (openCorners) { rules[0].from += 4.8; rules.at(-1).from += 4.8; }
  for (let row = 0; row < 3; row++) for (const at of [60, 200])
    rules.push({ axis: 'v', at, from: 20 + row * 22 + .25, to: 42 + row * 22 - .25 });
  const graphics = rules.map((rule, i) => ({ id: 'g' + i, decoration: true, thin: true, opaque: true,
    rect: rule.axis === 'h' ? { x: rule.from, y: rule.at - .25, width: rule.to - rule.from, height: .5 }
      : { x: rule.at - .25, y: rule.from, width: .5, height: rule.to - rule.from } }));
  graphics.push({ id: 'fill', decoration: true, thin: false, opaque: true, fillRect: true, fillColor: 'DDDDDD',
    rect: { x: 60.25, y: 42.25, width: 139.5, height: 21.5 } });
  return { number: 1, text, rules, graphics, bounds: { x: 0, y: 0, width: 240, height: 120 },
    items: [{ id: 'background', type: 'image', role: 'figure', sourceIds: [],
      drawingIds: graphics.map(item => item.id), rect: { x: 59.75, y: 19.75, width: 140.5, height: 66.5 } }] };
}
for (const chinese of [false, true]) for (const openCorners of [false, true]) {
  const input = fixture(chinese, openCorners), original = structuredClone(input), result = emptyFormTables(input);
  assert.equal(result.count, 1);
  assert.deepEqual(input, original, 'detection does not mutate the source extraction, rules or backdrop');
  const table = result.items.find(item => item.emptyForm);
  assert.equal(table.cells.length, 3); assert.equal(table.columnWidths.length, 1);
  assert.deepEqual(table.rowHeights, [22, 22, 22]);
  assert(table.cells.every(cell => cell.blocks.length === 0 && cell.sourceIds.length === 0));
  assert(result.items.find(item => item.id === 'background').formTableBackdrop);
  assert(sceneLayoutBytes({ items: result.items }) >= 3 * 2048, 'new empty-cell objects are charged to the layout budget');
  assert.equal(emptyFormTables({ ...input, items: result.items }).count, 0, 'recovery is idempotent');
  assert.equal(emptyFormTables({ ...input, tableFallbackIds: [table.id] }).count, 0, 'a rejected table stays rejected on rebuild');
}
for (const change of [
  d => { d.text.forEach(item => { item.bold = false; }); },
  d => { d.text.forEach(item => { item.font = 'Cambria Math'; }); },
  d => { d.text.push({ ...d.text[0], rect: { x: 80, y: 25, width: 20, height: 8 } }); },
  d => { d.items[0].sourceIds.push('unknown-raster-text'); },
  d => { d.items.push({ ...d.items[0], id: 'overlapping-image' }); },
  d => { d.items.push({ type: 'table', rect: { x: 60, y: 20, width: 140, height: 66 } }); },
  d => { d.graphics[0].opaque = false; },
  d => { d.items[0].drawingIds.push('unknown-paint'); },
  d => { const item = { id: 'chart-bar', decoration: true, fillRect: true, opaque: true,
    fillColor: 'CC0000', rect: { x: 70, y: 47, width: 60, height: 10 } };
    d.graphics.push(item); d.items[0].drawingIds.push(item.id); },
  d => { while (d.rules.length <= 3000) d.rules.push({ axis: 'v', at: d.rules.length, from: 0, to: 50 }); },
]) {
  const input = fixture(); change(input);
  assert.equal(emptyFormTables(input).count, 0, 'unknown, nonempty or graphical regions remain images: ' + change.toString());
}

// Real PDF.js extraction and the actual Word writer, including explicit mode isolation.
const pdf = await PDFDocument.create(), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const page = pdf.addPage([340, 300]);
for (const [row, label] of ['NAME', 'PHONE', 'EMAIL'].entries()) {
  page.drawRectangle({ x: 70, y: 300 - 40 - (row + 1) * 22, width: 200, height: 22,
    color: row === 1 ? rgb(.85, .85, .85) : rgb(1, 1, 1), borderColor: rgb(.5, .5, .5), borderWidth: .5 });
  page.drawText(label, { x: 64 - bold.widthOfTextAtSize(label, 8), y: 300 - 54 - row * 22, font: bold, size: 8 });
}
const loading = getDocument({ data: await pdf.save(), fontExtraProperties: true, useSystemFonts: false, verbosity: 0,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
try {
  const source = await loading.promise, ops = OPS;
  const native = await source.getPage(1), canvas = createCanvas(1, 1), context = createCanvas(1, 1).getContext('2d');
  try {
    const operation = { optionalContentConfig: await source.getOptionalContentConfig({ intent: 'display' }) };
    const snapshot = await snapshotPage(native, ops, () => {}, operation.optionalContentConfig);
    await renderPage(native, canvas, operation); snapshot.fonts = snapshotFonts(native, snapshot.fontIds);
    const legacy = prepareWordScene(snapshot, { measurementContext: context, createCanvas });
    const scene = prepareWordScene(snapshot, { measurementContext: context, createCanvas, preserveGeometry: true });
    assert.equal(legacy.items.filter(item => item.emptyForm).length, 0, 'default/headless legacy analysis is unchanged');
    assert.equal(scene.items.filter(item => item.emptyForm).length, 1, 'explicit original-layout analysis recovers real blank fields');
    const document = inferDocument([scene], { preserveGeometry: true }), assets = await collectPageAssets(scene, canvas, createCanvas);
    assert.equal(validateCoverage(document).imageCharacters, 0);
    const output = await createWordBytes(document, assets, { preserveGeometry: true, measurementContext: context });
    const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
    assert.equal((xml.match(/<w:tbl>/gu) || []).length, 1);
    assert.equal((xml.match(/<w:tc>/gu) || []).length, 3);
    assert(xml.includes('behindDoc="1"'), 'the original fill/borders stay behind future typed text');
    const cells = [...xml.matchAll(/<w:tc>(.*?)<\/w:tc>/gs)].map(match => match[1]);
    for (const cell of cells) {
      assert(cell.includes('<w:sz w:val="22"/>'), 'empty fields inherit a usable 11pt typing size');
      assert(!cell.includes('w:lineRule="exact"'), 'tiny exact empty-anchor leading cannot clip future typing');
    }
    const a4 = inferDocument([legacy], { continuous: true });
    const reflow = await createWordBytes(a4, await collectPageAssets(legacy, canvas, createCanvas), { continuous: true, measurementContext: context });
    const a4xml = await (await JSZip.loadAsync(reflow.bytes)).file('word/document.xml').async('string');
    assert.equal((a4xml.match(/<w:tbl>/gu) || []).length, 0, 'continuous A4 retains its former image/flow ownership');
  } finally { canvas.width = canvas.height = 0; native.cleanup(); }
} finally { await loading.destroy(); }
console.log('Empty form tables: real PDF/Word, Chinese/English labels, open corners, text-free backdrops, normal typing style, A4 isolation, budgets and rejection passed.');
