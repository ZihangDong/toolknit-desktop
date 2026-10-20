import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { alignedTables } from '../src/features/pdf-to-word/core/aligned-tables.js';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { prepareWordScene } from '../src/features/pdf-to-word/adapters/scene.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const directory = 'tmp/pdf-word-aligned-tables'; await mkdir(directory, { recursive: true });
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([340, 320]);
const rows = [['Description', 'Quantity', 'Price'], ['Paper pack', '12', '45.50'], ['Desk lamp', '2', '129.00'], ['Notebook', '25', '7.25']];
for (const [index, values] of rows.entries()) for (const [col, text] of values.entries()) {
  page.drawText(text, { x: col ? [0, 215, 300][col] - font.widthOfTextAtSize(text, 10) : 30, y: 250 - index * 24, size: 10, font });
}
for (let row = 0; row < 3; row++) {
  page.drawText(`Paragraph ${row + 1}`, { x: 30, y: 120 - row * 20, font, size: 10 });
  page.drawText('ordinary prose', { x: 200, y: 120 - row * 20, font, size: 10 });
}
const input = await pdf.save(); await writeFile(`${directory}/source.pdf`, input);
const task = getDocument({ data: input.slice(), fontExtraProperties: true, verbosity: 0,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
try {
  const document = await task.promise, original = await document.getPage(1), canvas = createCanvas(1, 1);
  const operation = { optionalContentConfig: await document.getOptionalContentConfig({ intent: 'display' }) };
  const snapshot = await snapshotPage(original, OPS, () => {}, operation.optionalContentConfig);
  await renderPage(original, canvas, operation); snapshot.fonts = snapshotFonts(original, snapshot.fontIds);
  const scene = prepareWordScene(snapshot, { measurementContext: createCanvas(1, 1).getContext('2d') });
  const tables = scene.items.filter(item => item.type === 'table');
  assert.equal(tables.length, 1, 'stable label and amount columns become a table, ordinary prose does not');
  assert(tables[0].borderless); assert.equal(tables[0].rows, 4); assert.equal(tables[0].columnWidths.length, 3);
  const lines = tables[0].cells.flatMap(cell => cell.blocks.flatMap(block => block.lines));
  assert.equal(alignedTables(lines, [{ x: 10, y: 10, width: 330, height: 300 }]).length, 0, 'graphics and existing grids block new inference');
  assert.equal(alignedTables(lines, [], { x: 0, y: 0, width: 100, height: 100 }).length, 0, 'inferred cell padding cannot leave the source page');
  const uncertain = structuredClone(lines); uncertain[5].items[0].mathStyleUncertain = true;
  assert.equal(alignedTables(uncertain).length, 0);
  assert(scene.sources.every(source => source.disposition === 'editable'));
  const output = await createWordBytes(inferDocument([scene], { preserveGeometry: true }),
    await collectPageAssets(scene, canvas, createCanvas), { preserveGeometry: true, measurementContext: createCanvas(1, 1).getContext('2d') });
  const xml = xml2js(await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string'), { captureSpacesBetweenElements: true });
  const nodes = (node, name) => [...(node.name === name ? [node] : []), ...(node.elements || []).flatMap(child => nodes(child, name))];
  const actual = nodes(xml, 'w:tbl'); assert.equal(actual.length, 1);
  assert.deepEqual(nodes(actual[0], 'w:tc').map(cell => nodes(cell, 'w:t').flatMap(n => n.elements || []).map(n => n.text || '').join('')), rows.flat());
  assert(nodes(actual[0], 'w:tblBorders').flatMap(node => node.elements).every(border => border.attributes['w:val'] === 'none'));
  await writeFile(`${directory}/result.docx`, output.bytes);
  canvas.width = canvas.height = 0;
} finally { await task.destroy(); }
console.log('PDF Word aligned borderless table tests passed.');
