import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { prepareWordScene } from '../src/features/pdf-to-word/adapters/scene.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { inspectSceneInk } from '../src/features/pdf-to-word/core/ink-coverage.js';

const directory = 'tmp/pdf-word-table-cells';
await mkdir(directory, { recursive: true });
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
const page = pdf.addPage([300, 240]);
const xs = [30, 150, 270], ys = [50, 80, 110, 140, 170];
for (const x of xs) page.drawLine({ start: { x, y: ys[0] }, end: { x, y: ys.at(-1) }, thickness: .5, color: rgb(0, 0, 0) });
for (const y of ys) page.drawLine({ start: { x: xs[0], y }, end: { x: xs.at(-1), y }, thickness: .5, color: rgb(0, 0, 0) });
const rows = [['Invoice date', '2026-10-20'], ['Quantity', '12'], ['Unit price', '25.50'], ['Total', '306.00']];
for (const [index, values] of rows.entries()) {
  const y = 151 - index * 30;
  page.drawText(values[0], { x: 148 - font.widthOfTextAtSize(values[0], 10), y, font, size: 10 });
  page.drawText(values[1], { x: 153, y, font, size: 10 });
}
page.drawText('Reference A-1001', { x: 30, y: 205, font, size: 11 });
const input = await pdf.save(); await writeFile(`${directory}/source.pdf`, input);
const task = getDocument({ data: input.slice(), fontExtraProperties: true, verbosity: 0,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
try {
  const document = await task.promise, original = await document.getPage(1), canvas = createCanvas(1, 1);
  const operation = { optionalContentConfig: await document.getOptionalContentConfig({ intent: 'display' }) };
  const snapshot = await snapshotPage(original, OPS, () => {}, operation.optionalContentConfig);
  const plan = await renderPage(original, canvas, operation); snapshot.fonts = snapshotFonts(original, snapshot.fontIds);
  const scene = prepareWordScene(snapshot, { measurementContext: createCanvas(1, 1).getContext('2d') });
  const tables = scene.items.filter(item => item.type === 'table');
  assert.equal(tables.length, 1, 'close text across a border must remain an editable table');
  assert.equal(tables[0].rows, 4); assert.equal(tables[0].columnWidths.length, 2);
  assert.deepEqual(tables[0].cells.map(cell => cell.blocks.flatMap(block => block.lines.map(line => line.text)).join('')), rows.flat());
  assert(scene.sources.every(source => source.disposition === 'editable'));
  scene.inkCoverage = inspectSceneInk(scene, canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data,
    canvas.width, canvas.height, plan.scale);
  assert(scene.inkCoverage.accepted);
  const output = await createWordBytes(inferDocument([scene], { preserveGeometry: true }),
    await collectPageAssets(scene, canvas, createCanvas), { preserveGeometry: true, measurementContext: createCanvas(1, 1).getContext('2d') });
  const zip = await JSZip.loadAsync(output.bytes), xml = xml2js(await zip.file('word/document.xml').async('string'), { captureSpacesBetweenElements: true });
  const nodes = (node, name) => [...(node.name === name ? [node] : []), ...(node.elements || []).flatMap(child => nodes(child, name))];
  const wordTables = nodes(xml, 'w:tbl'); assert.equal(wordTables.length, 1);
  assert.deepEqual(nodes(wordTables[0], 'w:tc').map(cell => nodes(cell, 'w:t').flatMap(text => text.elements || []).map(text => text.text || '').join('')), rows.flat());
  await writeFile(`${directory}/result.docx`, output.bytes);
  canvas.width = canvas.height = 0;
} finally { await task.destroy(); }

const nestedPdf = await PDFDocument.create(), nestedFont = await nestedPdf.embedFont(StandardFonts.Helvetica);
const nestedPage = nestedPdf.addPage([320, 320]);
const grid = (xs, ys) => {
  for (const x of xs) nestedPage.drawLine({ start: { x, y: ys[0] }, end: { x, y: ys.at(-1) }, thickness: .5, color: rgb(0, 0, 0) });
  for (const y of ys) nestedPage.drawLine({ start: { x: xs[0], y }, end: { x: xs.at(-1), y }, thickness: .5, color: rgb(0, 0, 0) });
};
grid([30, 160, 290], [30, 150, 270]); grid([45, 95, 145], [170, 210, 250]);
for (const [text, x, y] of [['A1', 50, 230], ['A2', 100, 230], ['B1', 50, 190], ['B2', 100, 190],
  ['Right cell', 170, 230], ['Outside child', 45, 100], ['Amount 123.45', 170, 100]]) nestedPage.drawText(text, { x, y, font: nestedFont, size: 9 });
const boxPage = nestedPdf.addPage([320, 320]);
boxPage.drawRectangle({ x: 40, y: 40, width: 240, height: 240, borderWidth: .5, borderColor: rgb(0, 0, 0) });
boxPage.drawRectangle({ x: 90, y: 110, width: 140, height: 100, borderWidth: .5, borderColor: rgb(0, 0, 0) });
boxPage.drawText('Figure label', { x: 105, y: 150, font: nestedFont, size: 10 });
const nestedInput = await nestedPdf.save(); await writeFile(`${directory}/nested-source.pdf`, nestedInput);
const nestedTask = getDocument({ data: nestedInput.slice(), fontExtraProperties: true, verbosity: 0,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
try {
  const document = await nestedTask.promise, scenes = [], assets = [];
  for (let number = 1; number <= 2; number++) {
    const page = await document.getPage(number), canvas = createCanvas(1, 1);
    const operation = { optionalContentConfig: await document.getOptionalContentConfig({ intent: 'display' }) };
    const snapshot = await snapshotPage(page, OPS, () => {}, operation.optionalContentConfig);
    await renderPage(page, canvas, operation); snapshot.fonts = snapshotFonts(page, snapshot.fontIds);
    const scene = prepareWordScene(snapshot, { measurementContext: createCanvas(1, 1).getContext('2d') });
    const owners = scene.items.flatMap(item => item.sourceIds);
    assert.equal(owners.length, new Set(owners).size, 'nested outlines cannot claim the same source twice');
    if (number === 2) assert(!scene.items.some(item => item.type === 'table'), 'a single framed label is not evidence of a table');
    scenes.push(scene); assets.push(...await collectPageAssets(scene, canvas, createCanvas));
    canvas.width = canvas.height = 0;
  }
  const output = await createWordBytes(inferDocument(scenes, { preserveGeometry: true }), assets,
    { preserveGeometry: true, measurementContext: createCanvas(1, 1).getContext('2d') });
  await writeFile(`${directory}/nested.docx`, output.bytes);
} finally { await nestedTask.destroy(); }
console.log('PDF Word adjacent table cell tests passed.');
