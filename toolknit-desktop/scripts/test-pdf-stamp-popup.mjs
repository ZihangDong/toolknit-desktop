import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { exactRemovalMatches, removalPages } from '../src/features/pdf-object-remove/core.js';
import { analyzeRemovalPdf, buildRemovalPdf } from '../src/features/pdf-object-remove/processor.js';
import { pdfRemovalRenderQa } from './lib/pdf-removal-render-qa.mjs';

const N = PDFName.of;
const qa = await pdfRemovalRenderQa('tmp/pdf-stamp-popup');

async function fixture({ clean = false, variant } = {}) {
  const doc = await PDFDocument.create(), ctx = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [doc.addPage([320, 200]), doc.addPage([320, 200])];
  const appearance = ctx.register(ctx.flateStream('.8 .1 .12 rg 0 0 80 30 re f\n', {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 80, 30], Resources: {},
  }));
  const pairs = pages.map((page, index) => {
    page.node.set(N('Resources'), ctx.obj({ Font: { F0: font.ref } }));
    page.node.set(N('Contents'), ctx.register(ctx.flateStream(
      `.96 .94 .88 rg 0 0 320 200 re f 0 g BT /F0 16 Tf 20 167 Td (Popup body page ${index + 1}) Tj ET\n`,
    )));
    const stamp = ctx.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [140, 85, 220, 115],
      Name: 'Draft', Contents: PDFString.of(`Different comment ${index + 1}`), F: 4, AP: { N: appearance }, P: page.ref });
    const stampRef = ctx.register(stamp);
    const popup = ctx.obj({ Type: 'Annot', Subtype: 'Popup', Open: false,
      Parent: stampRef, Rect: [220, 85, 310, 155], P: page.ref });
    const popupRef = ctx.register(popup);
    stamp.set(N('Popup'), popupRef);
    const linkRef = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [15, 156, 170, 186],
      Border: [0, 0, 0], Dest: [page.ref, N('Fit')] }));
    // Non-adjacent stamps and popups exercise removal by index rather than adjacency.
    return { stamp, stampRef, popup, popupRef, entries: index === 0 && clean ? [linkRef] : [popupRef, linkRef, stampRef] };
  });
  if (variant) variant(pairs, ctx, pages);
  for (const [index, page] of pages.entries()) page.node.set(N('Annots'), ctx.register(ctx.obj(pairs[index].entries)));
  return doc.save();
}

const input = await fixture(), analysis = await analyzeRemovalPdf(input);
const stamps = analysis.candidates.filter(item => item.kind === 'stamp');
assert.deepEqual(stamps.map(item => [item.pageIndex, item.annotationIndex, item.popupAnnotationIndex]), [[0, 2, 0], [1, 2, 0]]);
assert.ok(analysis.summary.candidates.every(item => !('popupAnnotationIndex' in item)));
assert.deepEqual(exactRemovalMatches(stamps, stamps[0], removalPages('', 2)), [stamps[0].id]);
const output = await buildRemovalPdf(analysis, [stamps[0].id]);
const annotationRefs = async bytes => (await PDFDocument.load(bytes)).getPages().map(page =>
  page.node.Annots().asArray().map(String));
const originalRefs = await annotationRefs(input), editedRefs = await annotationRefs(output);
assert.deepEqual(editedRefs, [[originalRefs[0][1]], originalRefs[1]]);
const reopened = await analyzeRemovalPdf(output);
assert.deepEqual(reopened.candidates.filter(item => item.kind === 'stamp').map(item => item.pageIndex), [1]);
assert.equal(reopened.candidates.filter(item => item.label.startsWith('Popup body page')).length, 2);

const variants = [
  ['reply on another page', ([a,b],ctx) => b.entries.push(ctx.register(ctx.obj({ Subtype: 'Text', IRT: a.stampRef })))],
  ['another owner', ([a,b]) => b.stamp.set(N('Popup'), a.popupRef)],
  ['missing reciprocal parent', ([a]) => a.popup.delete(N('Parent'))],
  ['wrong parent', ([a,b]) => a.popup.set(N('Parent'), b.stampRef)],
  ['different page', ([a,b]) => { a.entries.shift(); b.entries.push(a.popupRef); }],
  ['duplicate popup', ([a]) => a.entries.push(a.popupRef)],
  ['reused stamp', ([a,b]) => b.entries.push(a.stampRef)],
  ['locked stamp', ([a],ctx) => a.stamp.set(N('F'), ctx.obj(132))],
  ['locked popup', ([a],ctx) => a.popup.set(N('F'), ctx.obj(128))],
  ['open popup', ([a],ctx) => a.popup.set(N('Open'), ctx.obj(true))],
  ['wrong page reference', ([a],ctx,pages) => a.popup.set(N('P'), pages[1].ref)],
  ['popup action', ([a],ctx) => a.popup.set(N('AA'), ctx.obj({}))],
];
for (const [name, variant] of variants) {
  const bytes = await fixture({ variant });
  const value = await analyzeRemovalPdf(bytes);
  assert.ok(!value.pages[0].candidates.some(item => item.kind === 'stamp'), name);
  const body = value.pages[0].candidates.find(item => item.kind === 'text');
  assert.ok(body, name);
  assert.deepEqual(await annotationRefs(await buildRemovalPdf(value, [body.id])), await annotationRefs(bytes), name);
}

const source = await qa.save('source', input);
const edited = await qa.save('edited', output);
const reference = await qa.save('reference', await fixture({ clean: true }));
await qa.verify(source);
await qa.verify(edited);
await qa.compare(edited, reference, 2, { allPdfjsPages: true });
const report = { popupPairs: 2, removedPairs: 1, rejectedProfiles: variants.length, ...qa.report() };
await writeFile(path.join(qa.root, 'report.json'), JSON.stringify(report, null, 2));
console.log(`PDF stamp popup passed: 2 pairs, 12 rejected profiles, ${report.pixelChecks} Poppler pages and ${report.pdfjsComparisons} PDF.js comparisons.`);
