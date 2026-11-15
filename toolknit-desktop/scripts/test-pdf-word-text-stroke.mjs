import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, TextRenderingMode, setTextRenderingMode, setLineWidth, setLineJoin,
  setStrokingRgbColor, pushGraphicsState, popGraphicsState } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { buildPageScene } from '../src/features/pdf-to-word/core/scene.js';
import { glyphStrokeBounds } from '../src/features/pdf-to-word/core/font-outline.js';
import { inspectSceneInk } from '../src/features/pdf-to-word/core/ink-coverage.js';
import { inferDocument, validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import JSZip from 'jszip';

const face = fontkit.create(await readFile('public/assets/fonts/Montserrat-Regular.otf'));
const Path = face.glyphForCodePoint(65).path.constructor;
const paths = [
  new Path().moveTo(50, 20).lineTo(35, 70).lineTo(65, 70).closePath(),
  new Path().moveTo(20, 20).lineTo(60, 60),
  new Path().moveTo(20, 20).quadraticCurveTo(20, 20, 60, 60).lineTo(75, 25),
  new Path().moveTo(20, 60).bezierCurveTo(20, 60, 50, 20, 50, 20).lineTo(70, 65).closePath(),
];
for (const path of paths) for (const lineJoin of [0, 1, 2]) for (const lineCap of [0, 1, 2]) for (const miterLimit of [2, 10]) {
  const original = JSON.stringify(path.commands), outline = { path, bbox: path.bbox };
  const bounds = glyphStrokeBounds(outline, { width: 6, lineJoin, lineCap, miterLimit });
  const canvas = createCanvas(100, 100), context = canvas.getContext('2d');
  try {
    context.fillStyle = '#fff'; context.fillRect(0, 0, 100, 100);
    context.beginPath(); path.toFunction()(context); context.strokeStyle = '#000'; context.lineWidth = 6;
    context.lineJoin = ['miter', 'round', 'bevel'][lineJoin]; context.lineCap = ['butt', 'round', 'square'][lineCap];
    context.miterLimit = miterLimit; context.stroke();
    const pixels = context.getImageData(0, 0, 100, 100).data;
    let ink = 0;
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) if (pixels[(y * 100 + x) * 4] < 200) {
      ink++;
      assert(x + 1 >= bounds.minX && x <= bounds.maxX + 1 && y + 1 >= bounds.minY && y <= bounds.maxY + 1,
        'independently rendered sharp joins, square caps and curve tangents must be covered');
    }
    assert(ink > 100); assert.equal(JSON.stringify(path.commands), original);
  } finally { canvas.width = canvas.height = 0; }
}
const triangle = { path: paths[0], bbox: paths[0].bbox };
assert(glyphStrokeBounds(triangle, { width: 6 }).minY < 17, 'a sharp miter extends beyond the half-width envelope');
assert.equal(glyphStrokeBounds(triangle, { width: 6, miterLimit: 2 }).minY, 17, 'over-limit joins are beveled');
assert(glyphStrokeBounds({ path: paths[1], bbox: paths[1].bbox }, { width: 6, lineCap: 2 }).minX < 17,
  'diagonal square caps extend further than round caps');
for (const change of [{ width: NaN }, { width: -1 }, { lineJoin: 9 }, { lineCap: 9 }, { miterLimit: 0 }])
  assert.equal(glyphStrokeBounds(triangle, { width: 6, ...change }), null, 'invalid stroke metadata is not precise geometry');
const unknown = { bbox: triangle.bbox, path: { commands: [{ command: 'unknown', args: [] }] } };
assert.equal(glyphStrokeBounds(unknown, { width: 6 }).minY, triangle.bbox.minY - 30,
  'unrecognized outlines retain a source-bounded conservative stroke envelope');

// Synthetic public text, never a copy of a user's PDF or subset font.
const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
const font = await pdf.embedFont(await readFile('public/assets/fonts/Montserrat-Regular.otf'), { subset: false });
for (const mode of [TextRenderingMode.FillAndOutline, TextRenderingMode.Outline]) {
  const page = pdf.addPage([360, 320]);
  for (const [join, width, y] of [[0, 4, 240], [1, 3, 150], [2, 2, 60]]) {
    page.pushOperators(pushGraphicsState(), setTextRenderingMode(mode), setLineWidth(width), setLineJoin(join), setStrokingRgbColor(0, 0, 0));
    page.drawText('HAVW', { x: 40, y, size: 42, font });
    page.pushOperators(popGraphicsState());
  }
}
const task = getDocument({ data: await pdf.save(), fontExtraProperties: true, useSystemFonts: false, verbosity: 0 });
try {
  const document = await task.promise;
  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number), canvas = createCanvas(1, 1), operation = {};
    try {
      const snapshot = await snapshotPage(page, OPS), plan = await renderPage(page, canvas, operation);
      snapshot.fonts = snapshotFonts(page, snapshot.fontIds);
      const scene = buildPageScene(snapshot, { traceTypography: true, preserveGeometry: true });
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      assert(!scene.rasterPage, 'known stroked native text must not rasterize the entire page');
      const ink = inspectSceneInk(scene, pixels, canvas.width, canvas.height, plan.scale);
      assert.equal(ink.uncoveredPixels, 0, 'native outline/fill-and-outline paint must lie inside its source bounds');
      const matrixSized = structuredClone(snapshot);
      matrixSized.operations = matrixSized.operations.map(op => op.name === 'setFont' ? { ...op, args: [op.args[0], 1] }
        : op.name === 'setTextMatrix' ? { ...op, args: [Float32Array.from(op.args[0], (value, index) => index < 4 ? value * 42 : value)] } : op);
      const matrixScene = buildPageScene(matrixSized, { traceTypography: true, preserveGeometry: true });
      assert.equal(matrixScene.items.length, scene.items.length);
      matrixScene.items.forEach((item, index) => {
        for (const key of ['x', 'y', 'width', 'height']) assert(Math.abs(item.rect[key] - scene.items[index].rect[key]) < 1e-8,
          'large text matrix plus size=1 must use the same pen envelope as ordinary font sizing');
      });
      const ordinary = structuredClone(snapshot);
      ordinary.operations = ordinary.operations.map(op => op.name === 'setTextRenderingMode' ? { ...op, args: [0] } : op);
      const fillScene = buildPageScene(ordinary, { traceTypography: true, preserveGeometry: true });
      for (const item of scene.items.filter(item => item.type === 'text')) {
        const fill = fillScene.items.find(candidate => candidate.id === item.id);
        assert(fill && item.rect.width > fill.rect.width && item.rect.height > fill.rect.height);
        for (const key of ['text', 'baseline', 'baselineX', 'size', 'advanceWidth', 'sourceIds'])
          assert.deepEqual(item[key], fill[key], 'stroke geometry must preserve native text and anchors: ' + key);
        assert.equal(item.sourceIds.length, 1, 'stroke is the same source, not a second text layer');
      }
      const incomplete = { ...scene, items: scene.items.slice(1) };
      assert(!inspectSceneInk(incomplete, pixels, canvas.width, canvas.height, plan.scale).accepted,
        'genuinely missing native text still fails the unchanged pixel gate');
      const extraInk = pixels.slice(), isolated = (10 * canvas.width + 10) * 4;
      extraInk.fill(0, isolated, isolated + 3);
      assert(!inspectSceneInk(scene, extraInk, canvas.width, canvas.height, plan.scale).accepted,
        'even a single unrelated dark pixel still fails coverage');
      const withoutStroke = inspectSceneInk(fillScene, pixels, canvas.width, canvas.height, plan.scale);
      assert(!withoutStroke.accepted, 'the source fixture exercises actual pen overhang, not just text bookkeeping');
      const first = fillScene.items.find(item => item.type === 'text'), r = first.rect, bottom = scene.height - r.y - r.height;
      const cropped = structuredClone(snapshot);
      cropped.operations = [{ name: 'save', args: [] }, { name: 'clip', args: [] },
        { name: 'constructPath', args: ['endPath', [[0, r.x, bottom, 1, r.x + r.width, bottom,
          1, r.x + r.width, bottom + r.height, 1, r.x, bottom + r.height, 4]],
        [r.x, bottom, r.x + r.width, bottom + r.height]] }, ...cropped.operations, { name: 'restore', args: [] }];
      const cropScene = buildPageScene(cropped, { traceTypography: true, preserveGeometry: true });
      const visible = cropScene.sources.filter(source => source.disposition !== 'excluded-hidden');
      assert.equal(visible.length, 1);
      assert.equal(visible[0].text, first.text);
      assert.equal(visible[0].disposition, 'visible-image',
        'a clip cannot authorize editable text whose actual stroke is cut off');
      assert(cropScene.items.some(item => item.type === 'image'), 'the visible clipped portion is preserved');
      const result = inferDocument([scene], { preserveGeometry: true }); validateCoverage(result);
      const assets = await collectPageAssets(scene, canvas, createCanvas);
      const output = await createWordBytes(result, assets, { preserveGeometry: true, measurementContext: createCanvas(1, 1).getContext('2d') });
      const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
      assert(xml.includes('HAVW'), 'native content remains editable DOCX text');
    } finally { canvas.width = canvas.height = 0; page.cleanup(); }
  }
} finally { await task.destroy(); }
console.log('Native text stroke: real PDF paint coverage, joins, source anchors, editable DOCX and omission guards passed.');
