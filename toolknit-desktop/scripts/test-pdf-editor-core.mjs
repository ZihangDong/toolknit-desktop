import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import {
  PDF_EDITOR_LIMITS,
  assertPdfEditorFile,
  assertPdfEditorPageCount,
  assertPdfEditorMergeSelection,
  normalizePageRotation,
  resolvePdfPageRotation,
  sanitizePdfBaseName,
  buildPdfName,
  assemblePdf,
  assemblePdfWithTextEdits,
  estimateInsertedTextWidth,
  rotatePdfBoxOriginAroundCenter,
  rotatePdfTextAnchorAroundBox,
  uiRotationToPdfAngle,
  splitPdfPages
} from '../src/pdf-editor-core.js';

async function createPdf(pageSpecs) {
  const document = await PDFDocument.create();
  for (const [width, height, rotation] of pageSpecs) {
    const page = document.addPage([width, height]);
    page.setRotation(degrees(rotation));
  }
  return document.save();
}

function pageContentText(document, pageIndex = 0) {
  const page = document.getPage(pageIndex);
  const contents = page.node.Contents();
  const context = contents?.context || page.node.context;
  const refs = Array.isArray(contents?.array) ? contents.array : [contents];
  return refs.map(reference => {
    const stream = reference?.getContents ? reference : context?.lookup(reference);
    if (!stream?.getContents) return '';
    let bytes = stream.getContents();
    try { bytes = inflateSync(Buffer.from(bytes)); } catch (_) {}
    return Buffer.from(bytes).toString('latin1');
  }).join('\n');
}

const sourceA = await createPdf([[612, 792, 0], [612, 792, 0]]);
const sourceB = await createPdf([[420, 595, 0]]);

const assembled = await assemblePdf({
  sources: [{ name: 'a.pdf', bytes: sourceA }, { name: 'b.pdf', bytes: sourceB }],
  pages: [
    { sourceIndex: 1, pageIndex: 0, rotation: 0 },
    { sourceIndex: 0, pageIndex: 1, rotation: 90 },
    { sourceIndex: 0, pageIndex: 0, rotation: 0 }
  ],
  onProgress: () => {}
});
const assembledDocument = await PDFDocument.load(assembled);
assert.equal(assembledDocument.getPageCount(), 3);
assert.deepEqual(assembledDocument.getPage(0).getSize(), { width: 420, height: 595 });
assert.equal(assembledDocument.getPage(1).getRotation().angle, 90);
assert.deepEqual(assembledDocument.getPage(2).getSize(), { width: 612, height: 792 });

const split = await splitPdfPages({
  sources: [{ name: 'a.pdf', bytes: sourceA }],
  pages: [
    { sourceIndex: 0, pageIndex: 0, rotation: 0 },
    { sourceIndex: 0, pageIndex: 1, rotation: 0 }
  ],
  onPage: () => {}
});
assert.equal(split.length, 2);
for (const bytes of split) {
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
}

// Text editing path: cover original glyphs and redraw replacement text without
// changing page count, page size or rotation.
const textSource = await (async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('Hello World', { x: 100, y: 700, size: 24, font });
  return document.save();
})();

const edited = await assemblePdfWithTextEdits({
  sources: [{ name: 'text.pdf', bytes: textSource }],
  pages: [{ sourceIndex: 0, pageIndex: 0, rotation: 0 }],
  textEdits: [{
    pageIndex: 0,
    baselineX: 100,
    baselineY: 700,
    fontSize: 24,
    text: 'Hi there',
    box: { x: 99, y: 695, width: 124, height: 26 }
  }],
  onProgress: () => {}
});
const editedDocument = await PDFDocument.load(edited);
assert.equal(editedDocument.getPageCount(), 1);
assert.deepEqual(editedDocument.getPage(0).getSize(), { width: 612, height: 792 });

const tinyPng = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
));
const inserted = await assemblePdfWithTextEdits({
  sources: [{ name: 'insert.pdf', bytes: textSource }],
  pages: [{ sourceIndex: 0, pageIndex: 0, rotation: 0 }],
  textObjects: [{ pageIndex: 0, x: 120, y: 620, text: 'Inserted', fontSize: 16 }],
  imageObjects: [{ pageIndex: 0, x: 220, y: 600, width: 32, height: 32, bytes: tinyPng, mimeType: 'image/png' }],
  onProgress: () => {}
});
const insertedDocument = await PDFDocument.load(inserted);
assert.equal(insertedDocument.getPageCount(), 1);
assert.ok(inserted.length > textSource.length);

// A replacement that is moved without rotation still needs an opaque
// destination mask. Use a deliberately narrow source box and a wide glyph
// run to prove the mask uses embedded-font metrics plus padding rather than
// the source box or character-count estimate.
const movedWideText = await assemblePdfWithTextEdits({
  sources: [{ name: 'moved-wide-text.pdf', bytes: textSource }],
  pages: [{ sourceIndex: 0, pageIndex: 0, rotation: 0 }],
  textEdits: [{
    pageIndex: 0,
    baselineX: 200,
    baselineY: 300,
    fontSize: 20,
    text: 'WWW',
    rotation: 0,
    box: { x: 100, y: 190, width: 10, height: 20 },
    textBox: { x: 200, y: 290, width: 10, height: 20 }
  }]
});
const movedWideTextDocument = await PDFDocument.load(movedWideText);
const movedWideTextContent = pageContentText(movedWideTextDocument);
assert.match(movedWideTextContent, /1 0 0 1 175\.88 290 cm/);
assert.match(movedWideTextContent, /58\.24 20 l/);

// Inserted-text rotation must use the same deterministic visual width as the
// canvas fallback when the caller does not supply measured visual bounds.
assert.ok(Math.abs(estimateInsertedTextWidth('WWW', 16) - 45.6) < 1e-9);
assert.equal(estimateInsertedTextWidth('\u4e2d\u6587', 16), 32);
const insertedRotated = await assemblePdfWithTextEdits({
  sources: [{ name: 'insert-rotated.pdf', bytes: textSource }],
  pages: [{ sourceIndex: 0, pageIndex: 0, rotation: 0 }],
  textObjects: [{ pageIndex: 0, x: 100, y: 200, text: 'WWW', fontSize: 16, rotation: 90 }]
});
const insertedRotatedDocument = await PDFDocument.load(insertedRotated);
const insertedRotatedContent = pageContentText(insertedRotatedDocument);
const insertedRotatedAnchor = rotatePdfTextAnchorAroundBox(
  100,
  200,
  { x: 100, y: 200 - 16 * 1.15 * 0.2, width: estimateInsertedTextWidth('WWW', 16), height: 16 * 1.15 },
  uiRotationToPdfAngle(90)
);
assert.match(
  insertedRotatedContent,
  new RegExp(`0\\.00000000000000006123233995736767 -1 1 0\\.00000000000000006123233995736767 ${insertedRotatedAnchor.x} ${insertedRotatedAnchor.y} Tm`)
);

// Component rotation is stored in the UI as a clockwise CSS angle. PDF
// content uses a Cartesian y axis, so export must flip the sign while the
// low-level geometry helpers retain their mathematical positive semantics.
assert.equal(uiRotationToPdfAngle(90), -90);
assert.equal(uiRotationToPdfAngle(-90), 90);
assert.equal(uiRotationToPdfAngle('not-a-number'), 0);

// Rotated components must keep the same visual center in the exported PDF as
// they have in the editor canvas. The content-stream checks below exercise the
// actual pdf-lib matrices, not only the helper arithmetic.
const rotatedOrigin = rotatePdfBoxOriginAroundCenter(100, 100, 40, 20, 90);
assert.deepEqual(rotatedOrigin, { x: 130, y: 90 });
const rotatedAnchor = rotatePdfTextAnchorAroundBox(
  110,
  220,
  { x: 100, y: 210, width: 60, height: 20 },
  uiRotationToPdfAngle(90)
);
assert.deepEqual(rotatedAnchor, { x: 130, y: 240 });

const rotatedComponents = await assemblePdfWithTextEdits({
  sources: [{ name: 'rotated.pdf', bytes: textSource }],
  pages: [{ sourceIndex: 0, pageIndex: 0, rotation: 0 }],
  textEdits: [{
    pageIndex: 0,
    baselineX: 110,
    baselineY: 220,
    fontSize: 20,
    text: 'Rotate',
    rotation: 90,
    box: { x: 100, y: 210, width: 60, height: 20 },
    textBox: { x: 100, y: 210, width: 60, height: 20 }
  }],
  imageObjects: [{
    pageIndex: 0,
    x: 100,
    y: 100,
    width: 40,
    height: 20,
    rotation: 90,
    bytes: tinyPng,
    mimeType: 'image/png'
  }],
  shapeObjects: [{
    pageIndex: 0,
    shapeType: 'rect',
    x: 300,
    y: 100,
    width: 40,
    height: 20,
    rotation: 90,
    fill: [1, 0, 0],
    stroke: [0, 0, 0],
    strokeWidth: 1
  }, {
    pageIndex: 0,
    shapeType: 'line',
    x: 400,
    y: 100,
    width: 40,
    height: 20,
    rotation: 0,
    stroke: [0, 0, 0],
    strokeWidth: 2
  }]
});
const rotatedComponentsDocument = await PDFDocument.load(rotatedComponents);
const rotatedContent = pageContentText(rotatedComponentsDocument);
assert.match(rotatedContent, /1 0 0 1 99\.2 210 cm/);
assert.match(rotatedContent, /1 0 0 1 110 130 cm/);
assert.match(rotatedContent, /0\.00000000000000006123233995736767 -1 1 0\.00000000000000006123233995736767 0 0 cm/);
assert.match(rotatedContent, /0\.00000000000000006123233995736767 -1 1 0\.00000000000000006123233995736767 130 240 Tm/);
assert.match(rotatedContent, /1 0 0 1 310 130 cm/);
assert.match(rotatedContent, /40 0 0 20 0 0 cm/);
assert.match(rotatedContent, /400 120 m\s+440 100 l/);

// A moved/resized replacement must rotate its source mask around the edited
// text box, not around the immutable source box. The latter leaves the mask
// near the old glyph location and lets rotated replacement content drift out
// of sync with the editor preview. The rotated mask dimensions and origin are
// taken from the edited visual box itself.
const movedRotated = await assemblePdfWithTextEdits({
  sources: [{ name: 'moved-rotated.pdf', bytes: textSource }],
  pages: [{ sourceIndex: 0, pageIndex: 0, rotation: 0 }],
  textEdits: [{
    pageIndex: 0,
    baselineX: 190,
    baselineY: 315,
    fontSize: 20,
    text: 'Move',
    rotation: 90,
    box: { x: 100, y: 210, width: 60, height: 20 },
    textBox: { x: 180, y: 300, width: 90, height: 30 }
  }]
});
const movedRotatedDocument = await PDFDocument.load(movedRotated);
const movedRotatedContent = pageContentText(movedRotatedDocument);
assert.match(movedRotatedContent, /1 0 0 1 210 360 cm/);
assert.match(movedRotatedContent, /90 30 l/);
assert.match(movedRotatedContent, /0\.00000000000000006123233995736767 -1 1 0\.00000000000000006123233995736767 225 350 Tm/);

const formSource = await (async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const form = document.getForm();
  const field = form.createTextField('profile.name');
  field.setText('ToolKnit');
  field.addToPage(page, { x: 48, y: 680, width: 220, height: 28 });
  document.setTitle('PDF editor structure regression');
  return document.save();
})();

const rotatedFormBytes = await assemblePdf({
  sources: [{ name: 'form.pdf', bytes: formSource }],
  pages: [{ sourceIndex: 0, pageIndex: 0, rotation: 90 }]
});
const rotatedFormDocument = await PDFDocument.load(rotatedFormBytes);
assert.equal(rotatedFormDocument.getTitle(), 'PDF editor structure regression');
assert.equal(rotatedFormDocument.getPage(0).getRotation().angle, 90);
assert.deepEqual(rotatedFormDocument.getForm().getFields().map(field => field.getName()), ['profile.name']);

const annotatedFormBytes = await assemblePdfWithTextEdits({
  sources: [{ name: 'form.pdf', bytes: formSource }],
  pages: [{ sourceIndex: 0, pageIndex: 0, rotation: 0 }],
  textObjects: [{ pageIndex: 0, x: 48, y: 620, text: 'Reviewed', fontSize: 14 }]
});
const annotatedFormDocument = await PDFDocument.load(annotatedFormBytes);
assert.equal(annotatedFormDocument.getTitle(), 'PDF editor structure regression');
assert.deepEqual(annotatedFormDocument.getForm().getFields().map(field => field.getName()), ['profile.name']);

assert.equal(normalizePageRotation(-90), 270);
assert.equal(normalizePageRotation(450), 90);
assert.equal(resolvePdfPageRotation(90, 0), 90);
assert.equal(resolvePdfPageRotation(90, -90), 0);
assert.equal(resolvePdfPageRotation(270, 180), 90);
assert.equal(sanitizePdfBaseName('C:\\Docs\\A/B:c.pdf'), 'B_c');
assert.equal(buildPdfName('report.pdf', 'edited'), 'report_edited.pdf');

assert.throws(() => assertPdfEditorFile('notes.txt', 10));
assert.throws(() => assertPdfEditorFile('big.pdf', PDF_EDITOR_LIMITS.maxInputBytes + 1));
assert.throws(() => assertPdfEditorPageCount(0));
assert.throws(() => assertPdfEditorPageCount(PDF_EDITOR_LIMITS.maxPages + 1));
assert.throws(() => assertPdfEditorMergeSelection([], 0));
assert.throws(() => assertPdfEditorMergeSelection([{}], PDF_EDITOR_LIMITS.maxMergeTotalBytes + 1));
assert.doesNotThrow(() => assertPdfEditorMergeSelection(
  Array(PDF_EDITOR_LIMITS.maxMergeFiles).fill({}),
  PDF_EDITOR_LIMITS.maxMergeTotalBytes
));
assert.throws(() => assertPdfEditorMergeSelection(
  Array(PDF_EDITOR_LIMITS.maxMergeFiles + 1).fill({}),
  PDF_EDITOR_LIMITS.maxMergeTotalBytes
));

console.log('PDF editor core regression checks passed');
