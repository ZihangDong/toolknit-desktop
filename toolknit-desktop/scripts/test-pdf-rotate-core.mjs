import assert from 'node:assert/strict';
import { PDFDocument, degrees } from 'pdf-lib';
import pdfLibPlusEncrypt from 'pdf-lib-plus-encrypt';
import {
  PDF_ROTATE_LIMITS,
  assertPdfRotateInput,
  assertPdfRotatePageCount,
  assertPdfRotateSelection,
  createPdfRotateFileName,
  normalizePdfRotation,
  rotatePdfPages
} from '../src/pdf-rotate-core.js';

const { PDFDocument: EncryptedPDFDocument } = pdfLibPlusEncrypt;

async function createPdf(pageSpecs) {
  const document = await PDFDocument.create();
  for (const [width, height, rotation] of pageSpecs) {
    const page = document.addPage([width, height]);
    page.setRotation(degrees(rotation));
  }
  return document.save();
}

const source = await createPdf([[612, 792, 0], [420, 595, 90], [842, 595, 180]]);
const progress = [];
const rotated = await rotatePdfPages({
  fileData: source,
  pages: [
    { pageIndex: 1, rotation: 90 },
    { pageIndex: 2, rotation: 270 },
    { pageIndex: 3, rotation: 180 }
  ],
  onProgress: update => progress.push(update.completed)
});
const rotatedDocument = await PDFDocument.load(rotated);

assert.equal(rotatedDocument.getPageCount(), 3);
assert.deepEqual(rotatedDocument.getPage(0).getSize(), { width: 612, height: 792 });
assert.equal(rotatedDocument.getPage(0).getRotation().angle, 90);
assert.deepEqual(rotatedDocument.getPage(1).getSize(), { width: 420, height: 595 });
assert.equal(rotatedDocument.getPage(1).getRotation().angle, 0);
assert.equal(rotatedDocument.getPage(2).getRotation().angle, 0);
assert.deepEqual(progress, [1, 2, 3]);

assert.equal(normalizePdfRotation(-90), 270);
assert.throws(() => normalizePdfRotation(45));
assert.equal(createPdfRotateFileName('..\\unsafe/name.pdf'), 'name_rotated.pdf');
assert.equal(createPdfRotateFileName('report.pdf', 2), 'report_page_2_rotated.pdf');
assert.throws(() => createPdfRotateFileName('report.pdf', 0));
assert.throws(() => assertPdfRotateSelection([], 10));
assert.throws(() => assertPdfRotateSelection([{}], PDF_ROTATE_LIMITS.maxInputBytes + 1));
assert.throws(() => assertPdfRotateInput(new Uint8Array()));
assert.throws(() => assertPdfRotatePageCount(PDF_ROTATE_LIMITS.maxPreviewPages + 1));
await assert.rejects(() => rotatePdfPages({
  fileData: source,
  pages: [{ pageIndex: 4, rotation: 0 }]
}));

const encrypted = await EncryptedPDFDocument.create();
encrypted.addPage([612, 792]);
encrypted.encrypt({ userPassword: 'rotate-test', ownerPassword: 'rotate-test' });
const encryptedBytes = await encrypted.save({ useObjectStreams: false });
await assert.rejects(() => rotatePdfPages({
  fileData: encryptedBytes,
  pages: [{ pageIndex: 1, rotation: 90 }]
}));

console.log('PDF rotate core regression checks passed');
