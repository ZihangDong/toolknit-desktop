import assert from 'node:assert/strict';
import { PDFDocument, degrees } from 'pdf-lib';
import { PDF_MERGE_LIMITS, assertPdfMergeSelection, mergePdfPages } from '../src/pdf-merge-core.js';

async function createPdf(pageSpecs) {
  const document = await PDFDocument.create();
  for (const [width, height, rotation] of pageSpecs) {
    const page = document.addPage([width, height]);
    page.setRotation(degrees(rotation));
  }
  return document.save();
}

const sourceA = await createPdf([[612, 792, 0], [612, 792, 0]]);
const sourceB = await createPdf([[420, 595, 0]]);
const merged = await mergePdfPages({
  documents: [{ fileData: sourceA }, { fileData: sourceB }],
  pages: [
    { fileIndex: 1, pageIndex: 1, rotation: 0 },
    { fileIndex: 0, pageIndex: 2, rotation: 90 },
    { fileIndex: 0, pageIndex: 1, rotation: 0 }
  ]
});
const mergedDocument = await PDFDocument.load(merged);

assert.equal(mergedDocument.getPageCount(), 3);
assert.deepEqual(mergedDocument.getPage(0).getSize(), { width: 420, height: 595 });
assert.equal(mergedDocument.getPage(1).getRotation().angle, 90);
assert.deepEqual(mergedDocument.getPage(2).getSize(), { width: 612, height: 792 });

assert.throws(() => assertPdfMergeSelection([{ name: 'only.pdf' }], 10));
assert.throws(() => assertPdfMergeSelection(Array(PDF_MERGE_LIMITS.maxFiles + 1).fill({}), 10));
assert.throws(() => assertPdfMergeSelection([{}, {}], PDF_MERGE_LIMITS.maxTotalBytes + 1));
await assert.rejects(() => mergePdfPages({ documents: [{ fileData: sourceA }], pages: [{ fileIndex: 0, pageIndex: 9 }] }));

console.log('PDF merge core regression checks passed');
