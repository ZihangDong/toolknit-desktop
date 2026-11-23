import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, PDFName, PDFRef, PDFString, StandardFonts } from 'pdf-lib';
import { exactRemovalMatches, removalPages } from '../src/features/pdf-object-remove/core.js';
import { analyzeRemovalPdf, buildRemovalPdf } from '../src/features/pdf-object-remove/processor.js';
import { pdfRemovalRenderQa } from './lib/pdf-removal-render-qa.mjs';

const N = PDFName.of;
const qa = await pdfRemovalRenderQa('tmp/pdf-stamp-states');

async function fixture({ clean = false, variants } = {}) {
  const doc = await PDFDocument.create(), ctx = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = color => ctx.register(ctx.flateStream(`${color} rg 0 0 80 30 re f\n`, {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 80, 30], Resources: {},
  }));
  const draft = form('.83 .14 .1'), approved = form('.12 .34 .79');
  function add(state, { indirect = false, direct = false, omit = false, mutate } = {}) {
    const page = doc.addPage([320, 200]);
    page.node.set(N('Resources'), ctx.obj({ Font: { F0: font.ref } }));
    page.node.set(N('Contents'), ctx.register(ctx.flateStream(
      '1 .96 .9 rg 0 0 320 200 re f 0 g BT /F0 16 Tf 20 164 Td (Stamp state body) Tj ET\n',
    )));
    const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [15, 155, 190, 183],
      Border: [0, 0, 0], Dest: [page.ref, N('Fit')] }));
    const states = ctx.obj(indirect
      ? { Proof: draft, Approved: approved, Draft: draft } : { Draft: draft, Approved: approved, Proof: draft });
    const ap = ctx.obj({ N: direct ? draft : indirect ? ctx.register(states) : states });
    const annotation = ctx.obj({ Type: 'Annot', Subtype: 'Stamp', Name: 'Draft', Rect: [140, 85, 220, 115],
      F: 4, AP: ap, ...(state ? { AS: state } : {}) });
    mutate?.({ annotation, states, ap, ctx, draft });
    page.node.set(N('Annots'), ctx.obj(omit ? [link] : [link, ctx.register(annotation)]));
  }
  if (variants) {
    for (const mutate of variants) add('Draft', { mutate });
  } else {
    add('Draft', { omit: clean });
    add('Draft', { omit: clean, indirect: true });
    add('Approved');
    add('Proof');
    add(null, { direct: true });
  }
  return doc.save({ useObjectStreams: true });
}

const input = await fixture(), analysis = await analyzeRemovalPdf(input);
const targets = analysis.candidates.filter(item => item.kind === 'stamp');
assert.deepEqual(targets.map(item => item.pageIndex), [0, 1, 2, 3, 4]);
const ids = exactRemovalMatches(targets, targets[0], removalPages('', 5));
assert.deepEqual(ids, [targets[0].id, targets[1].id]);
const output = await buildRemovalPdf(analysis, ids);
const reopened = await analyzeRemovalPdf(output);
assert.deepEqual(reopened.candidates.filter(item => item.kind === 'stamp').map(item => item.pageIndex), [2, 3, 4]);
assert.equal(reopened.candidates.filter(item => item.label === 'Stamp state body').length, 5);
const annotationRefs = async bytes => (await PDFDocument.load(bytes)).getPages().map(page =>
  page.node.Annots().asArray().map(String));
const originalRefs = await annotationRefs(input);
assert.deepEqual(await annotationRefs(output), originalRefs.map((refs, i) => i < 2 ? refs.slice(0, 1) : refs));

const variants = [
  ({ annotation }) => annotation.delete(N('AS')),
  ({ annotation }) => annotation.set(N('AS'), N('Unknown')),
  ({ annotation }) => annotation.set(N('AS'), PDFString.of('Draft')),
  ({ annotation, ctx }) => annotation.set(N('AS'), ctx.obj(1)),
  ({ states, ctx }) => states.set(N('Draft'), ctx.obj({})),
  ({ states }) => states.set(N('Draft'), PDFRef.of(9000)),
  ({ states, ctx }) => states.set(N('Draft'), ctx.register(ctx.flateStream('q Q'))),
  ({ ap, ctx, draft }) => ap.set(N('R'), ctx.obj({ Draft: draft })),
  ({ ap, ctx, draft }) => ap.set(N('D'), ctx.obj({ Draft: draft })),
];
const unsupported = await analyzeRemovalPdf(await fixture({ variants }));
assert.deepEqual(unsupported.pages.map(page => page.candidates.map(item => item.kind)), variants.map(() => ['text']));

const source = await qa.save('source', input);
const edited = await qa.save('edited', output);
const reference = await qa.save('reference', await fixture({ clean: true }));
await qa.verify(source);
await qa.verify(edited);
await qa.compare(edited, reference, 5, { allPdfjsPages: true });
// The chosen state must visibly render, so the reference comparison is not vacuous.
await qa.verifyPdfjsDifference(
  await qa.save('red-state-control', await fixture({ variants: [() => {}] })),
  await qa.save('blue-state-control', await fixture({ variants: [({ annotation }) => annotation.set(N('AS'), N('Approved'))] })),
  1,
);
const report = { stamps: targets.length, matched: ids.length, rejectedProfiles: variants.length, ...qa.report() };
await writeFile(path.join(qa.root, 'report.json'), JSON.stringify(report, null, 2));
console.log(`PDF stamp states passed: ${report.stamps} stamps, ${report.matched} exact matches, ${report.rejectedProfiles} rejected profiles.`);
