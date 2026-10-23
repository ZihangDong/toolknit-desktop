import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { prepareWordScene } from '../src/features/pdf-to-word/adapters/scene.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const directory = 'tmp/pdf-word-table-backgrounds'; await mkdir(directory, { recursive: true });
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
const cases = [1, .35].flatMap(opacity => [false, true].map(stroked => ({ opacity, stroked })));
const shortLabels = ['v1.2', 'SDK+CLI+MCP', 'Q', 'api_tool'];
for (const { opacity, stroked } of cases) {
  const page = pdf.addPage([400, 400]);
  if (!stroked) page.drawRectangle({ x: 30, y: 260, width: 170, height: 30, color: rgb(.5, .7, .9), opacity });
  for (const [index, [text, x, y]] of [['CELL-ALPHA', 50, 270], ['CELL-BETA', 220, 270], ['CELL-GAMMA', 50, 110], ['CELL-DELTA', 220, 110]].entries()) {
    // Real generators paint a row and its labels before the next row. Its
    // border touches the previous cell without covering the previous text.
    if (stroked && index % 2 === 0) page.drawRectangle({ x: 30, y: index < 2 ? 200 : 40, width: 340, height: 160,
      color: rgb(.9, .9, .88), opacity, borderColor: rgb(.8, .8, .78), borderWidth: .55 });
    page.drawText(stroked ? shortLabels[index] : text, { x, y, font, size: 12 });
  }
  for (const x of [30, 200, 370]) page.drawLine({ start: { x, y: 40 }, end: { x, y: 360 }, thickness: .5, color: rgb(0, 0, 0) });
  for (const y of [40, 200, 360]) page.drawLine({ start: { x: 30, y }, end: { x: 370, y }, thickness: .5, color: rgb(0, 0, 0) });
}
const input = await pdf.save(); await writeFile(`${directory}/source.pdf`, input);
const task = getDocument({ data: input.slice(), fontExtraProperties: true, verbosity: 0,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
try {
  const document = await task.promise, scenes = [], assets = [];
  for (let number = 1; number <= cases.length; number++) {
    const page = await document.getPage(number), canvas = createCanvas(1, 1);
    const operation = { optionalContentConfig: await document.getOptionalContentConfig({ intent: 'display' }) };
    const snapshot = await snapshotPage(page, OPS, () => {}, operation.optionalContentConfig);
    const plan = await renderPage(page, canvas, operation); snapshot.fonts = snapshotFonts(page, snapshot.fontIds);
    const scene = prepareWordScene(snapshot, { measurementContext: createCanvas(1, 1).getContext('2d') });
    assert(scene.sources.every(source => source.disposition === 'editable'),
      'plain labels, versions, plus-separated names and single letters remain editable over table fills with or without borders');
    const pageAssets = await collectPageAssets(scene, canvas, createCanvas);
    for (const { rect: word } of scene.sources) for (const item of scene.items.filter(item => item.type === 'image')) {
      if (item.rect.x >= word.x + word.width || item.rect.x + item.rect.width <= word.x
        || item.rect.y >= word.y + word.height || item.rect.y + item.rect.height <= word.y) continue;
      const asset = pageAssets.find(asset => asset.id === item.id), decoded = await loadImage(asset.bytes);
      const crop = createCanvas(decoded.width, decoded.height), context = crop.getContext('2d'); context.drawImage(decoded, 0, 0);
      const left = Math.max(0, Math.floor(word.x * plan.scale) - Math.floor(item.rect.x * plan.scale));
      const top = Math.max(0, Math.floor(word.y * plan.scale) - Math.floor(item.rect.y * plan.scale));
      const width = Math.min(crop.width - left, Math.ceil(word.width * plan.scale));
      const height = Math.min(crop.height - top, Math.ceil(word.height * plan.scale));
      if (width > 0 && height > 0) {
        const data = context.getImageData(left, top, width, height).data;
        assert(!data.some((value, index) => index % 4 === 0 && value < 70 && data[index + 1] < 70 && data[index + 2] < 70),
          'removing the Word text must not reveal an old copy in a partial cell background');
      }
      crop.width = crop.height = 0;
    }
    scenes.push(scene); assets.push(...pageAssets); canvas.width = canvas.height = 0;
  }
  const output = await createWordBytes(inferDocument(scenes, { preserveGeometry: true }), assets,
    { preserveGeometry: true, measurementContext: createCanvas(1, 1).getContext('2d') });
  const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
  assert.equal(xml.split('CELL-ALPHA').length - 1, 2, 'each source page owns one editable label');
  for (const label of shortLabels) assert.equal(xml.split(`>${label}<`).length - 1, 2,
    'each short label occurs once as native Word text on each stroked-background page');
  await writeFile(`${directory}/result.docx`, output.bytes);
} finally { await task.destroy(); }
console.log('PDF Word table background editing tests passed.');
