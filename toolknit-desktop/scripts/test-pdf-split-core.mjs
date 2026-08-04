import assert from 'node:assert/strict';
import { PDFDocument, degrees } from 'pdf-lib';
import {
  PDF_SPLIT_LIMITS,
  assertPdfSplitPageCount,
  assertPdfSplitSelection,
  createPdfSplitFileName,
  splitPdfPages
} from '../src/pdf-split-core.js';

async function createPdf(pageSpecs) {
  const document = await PDFDocument.create();
  for (const [width, height, rotation] of pageSpecs) {
    const page = document.addPage([width, height]);
    page.setRotation(degrees(rotation));
  }
  return document.save();
}

const sourceA = await createPdf([[612, 792, 0], [420, 595, 90]]);
const sourceB = await createPdf([[595, 842, 0]]);
const progress = [];
const outputs = await splitPdfPages({
  documents: [
    { fileName: 'report.pdf', fileData: sourceA },
    { fileName: 'second.pdf', fileData: sourceB }
  ],
  pages: [
    { fileIndex: 0, pageIndex: 2 },
    { fileIndex: 1, pageIndex: 1 }
  ],
  onProgress: update => progress.push(update.completed)
});

assert.equal(outputs.length, 2);
assert.equal(outputs[0].fileName, 'report_page_2.pdf');
assert.equal(outputs[1].fileName, 'second_page_1.pdf');
assert.equal((await PDFDocument.load(outputs[0].bytes)).getPageCount(), 1);
assert.equal((await PDFDocument.load(outputs[0].bytes)).getPage(0).getRotation().angle, 90);
assert.equal((await PDFDocument.load(outputs[1].bytes)).getPageCount(), 1);
assert.deepEqual(progress, [1, 2]);

assert.equal(createPdfSplitFileName('..\\unsafe/name.pdf', 3), 'name_page_3.pdf');
assert.throws(() => createPdfSplitFileName('report.pdf', 0));
assert.throws(() => assertPdfSplitSelection([], 0));
assert.throws(() => assertPdfSplitSelection(Array(PDF_SPLIT_LIMITS.maxFiles + 1).fill({}), 0));
assert.throws(() => assertPdfSplitSelection([{}], PDF_SPLIT_LIMITS.maxTotalBytes + 1));
assert.throws(() => assertPdfSplitPageCount(PDF_SPLIT_LIMITS.maxPreviewPages + 1));
await assert.rejects(() => splitPdfPages({
  documents: [{ fileName: 'report.pdf', fileData: sourceA }],
  pages: [{ fileIndex: 0, pageIndex: 3 }]
}));

console.log('PDF split core regression checks passed');
