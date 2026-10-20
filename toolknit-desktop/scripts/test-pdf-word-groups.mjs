import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { buildPageScene } from '../src/features/pdf-to-word/core/scene.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { inspectSceneInk } from '../src/features/pdf-to-word/core/ink-coverage.js';

const source = await PDFDocument.create(), font = await source.embedFont(StandardFonts.Helvetica);
const form = source.context.flateStream('q BT /F1 12 Tf 10 30 Td (Inside group) Tj 0 65 Td (CLIPPED_SENTINEL) Tj ET Q', {
  Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 180, 60],
  Resources: { Font: { F1: font.ref } }, Group: { S: 'Transparency', I: false, K: false }
});
const page = source.addPage([400, 400]), name = page.node.newXObject('Group', source.context.register(form));
page.drawText('Before group', { x: 40, y: 350, size: 12, font });
page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, 40, 240), drawObject(name), popGraphicsState());
page.drawText('After group', { x: 40, y: 180, size: 12, font });
page.drawText('COVERED_SENTINEL', { x: 40, y: 110, size: 12, font });
const graphic = source.context.flateStream('q 1 1 1 rg 0 0 180 40 re f 0 0 0 rg 10 10 60 20 re f Q', {
  Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 180, 40],
  Group: { S: 'Transparency', I: false, K: true }
});
const graphicName = page.node.newXObject('Graphic', source.context.register(graphic));
page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, 40, 100), drawObject(graphicName), popGraphicsState());
const bytes = await source.save(), output = 'tmp/pdf-to-word-groups'; await mkdir(output, { recursive: true });
await writeFile(`${output}/source.pdf`, bytes);
const task = getDocument({ data: bytes.slice(), fontExtraProperties: true, verbosity: 0, standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
try {
  const pdf = await task.promise, page = await pdf.getPage(1), snapshot = await snapshotPage(page, OPS), canvas = createCanvas(1, 1);
  const plan = await renderPage(page, canvas, {}); snapshot.fonts = snapshotFonts(page, snapshot.fontIds);
  assert(snapshot.operations.some(operation => operation.name === 'beginGroup'), 'fixture must exercise the renderer group path');
  const scene = buildPageScene(snapshot);
  assert(!scene.rasterPage, 'a simple group must not rasterize unrelated page text');
  assert(scene.sources.some(item => item.text === 'CLIPPED_SENTINEL' && item.disposition === 'excluded-hidden'));
  for (const text of ['Before group', 'Inside group', 'After group']) assert(scene.items.some(item => item.type === 'text' && item.text === text));
  assert(inspectSceneInk(scene, canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, plan.scale).accepted);
  const assets = await collectPageAssets(scene, canvas, createCanvas);
  const result = await createWordBytes(inferDocument([scene], { preserveGeometry: true }), assets,
    { preserveGeometry: true, measurementContext: createCanvas(1, 1).getContext('2d') });
  await writeFile(`${output}/converted.docx`, result.bytes);
  const zip = await JSZip.loadAsync(result.bytes), xml = await zip.file('word/document.xml').async('string');
  assert(!xml.includes('CLIPPED_SENTINEL'));
  assert(!xml.includes('COVERED_SENTINEL'), 'final composited pixels must not expose text covered by a group');
  assert(scene.items.some(item => item.type === 'image' && item.reasons.includes('complex-graphics')),
    'bounded graphic groups retain final pixels without rasterizing surrounding text');
  for (const field of ['knockout', 'isGray', 'smask', 'needsIsolation']) {
    const unsafe = structuredClone(snapshot); unsafe.operations.find(operation => operation.name === 'beginGroup').args[0][field] = true;
    assert(buildPageScene(unsafe).rasterPage, `unsupported ${field} must retain the visibility fallback`);
  }
  const unbalanced = structuredClone(snapshot);
  unbalanced.operations = unbalanced.operations.filter(operation => operation.name !== 'endGroup');
  assert(buildPageScene(unbalanced).rasterPage, 'an unclosed group is not a proven editable scene');
  canvas.width = canvas.height = 0; page.cleanup();
} finally { await task.destroy(); }
console.log('PDF group checks passed: actual transparency form, clipped text exclusion, state restore, source ink and conservative complex-group fallback.');
