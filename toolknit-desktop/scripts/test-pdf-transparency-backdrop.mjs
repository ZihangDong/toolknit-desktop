import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFBool, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { exactRemovalMatches, removalPages } from '../src/features/pdf-object-remove/core.js';
import { analyzeRemovalPdf, buildRemovalPdf } from '../src/features/pdf-object-remove/processor.js';
import { pdfRemovalRenderQa } from './lib/pdf-removal-render-qa.mjs';

const N = PDFName.of, label = 'BACKDROP DRAFT';
const qa = await pdfRemovalRenderQa('tmp/pdf-transparency-group-backdrop');

async function fixture({ clean = false, isolation = false, knockout = true, caller, localOverride,
  pageGroup = false, wrappedGroup = false, resetCaller = false } = {}) {
  const doc = await PDFDocument.create(), ctx = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const attrs = { Type: 'Group', S: 'Transparency' };
  if (knockout !== 'default') attrs.K = knockout;
  if (isolation !== 'default') attrs.I = isolation;
  const group = ctx.register(ctx.obj(attrs));
  const form = (drawing, resources, groupRef) => ctx.register(ctx.flateStream(drawing, {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 153, 110], Resources: resources,
    ...(groupRef ? { Group: groupRef } : {}),
  }));
  const local = { Font: { F0: font.ref }, ExtGState: {
    Half: localOverride || { Type: 'ExtGState', ca: .55 },
    Multiply: { Type: 'ExtGState', ca: .7, BM: 'Multiply' },
  } };
  const body = 'q /Half gs .2 .63 .92 rg 4 17 139 59 re f Q\n'
    + 'q /Multiply gs .78 .32 .57 rg 65 21 73 52 re f Q\n'
    + '0 g BT /F0 12 Tf 9 88 Td (Backdrop group body) Tj ET\n';
  const mark = 'q /Multiply gs .68 .15 .08 rg BT /F0 17 Tf 8 36 Td (BACKDROP DRAFT) Tj ET Q\n';
  const shared = form(body + mark, local, group);
  const selected = clean ? form(body, local, group) : shared;
  const parentGroup = pageGroup || wrappedGroup
    ? ctx.register(ctx.obj({ S: 'Transparency', I: true, CS: 'DeviceRGB' })) : undefined;
  const wrapper = form('/Inner Do\n', { XObject: { Inner: selected } }, wrappedGroup ? parentGroup : undefined);
  const applyCaller = caller && !resetCaller ? '/Caller gs ' : '';
  const place = (name, x) => `q ${applyCaller}1 0 0 1 ${x} 18 cm /${name} Do Q\n`;
  const drawings = [
    [place('Left', 18) + place('Right', 194), { Left: selected, Right: shared }, '.93 .82 .58'],
    [place('Left', 18), { Left: shared }, '.58 .86 .71'],
    [place('Wrapped', 18), { Wrapped: wrapper }, '.7 .77 .98'],
  ];
  for (const [drawing, xobjects, background] of drawings) {
    const page = doc.addPage([370, 175]);
    if (pageGroup) page.node.set(N('Group'), parentGroup);
    page.node.set(N('Resources'), ctx.obj({ Font: { F0: font.ref }, XObject: xobjects,
      ...(caller ? { ExtGState: { Caller: caller } } : {}),
    }));
    page.node.set(N('Contents'), ctx.register(ctx.flateStream(
      `${background} rg 0 0 370 175 re f\n.4 .66 .75 rg 83 0 235 130 re f\n`
      + '0 g BT /F0 13 Tf 20 145 Td (Backdrop page body) Tj ET\n'
      + (caller && resetCaller ? 'q /Caller gs Q\n' : '') + drawing)));
  }
  return doc.save();
}

async function verifyBackdrop(qa, knockout) {
  const input = await fixture({ knockout }), analysis = await analyzeRemovalPdf(input);
  const targets = analysis.candidates.filter(item => item.label === label);
  assert.deepEqual(targets.map(item => [item.pageIndex, item.formDepth]), [[0, 1], [0, 1], [1, 1], [2, 2]]);
  for (const target of targets) {
    assert.deepEqual(exactRemovalMatches(analysis.candidates, target, removalPages('', 3)), [target.id]);
  }
  assert.ok(!analysis.candidates.some(item => item.kind === 'text-form' || item.kind === 'image-form'));
  const editedBytes = await buildRemovalPdf(analysis, [targets[0].id, targets[3].id]);
  const editedAnalysis = await analyzeRemovalPdf(editedBytes);
  assert.deepEqual(editedAnalysis.candidates.filter(item => item.label === label).map(item => item.pageIndex), [0, 1]);
  assert.equal(editedAnalysis.candidates.filter(item => item.label === 'Backdrop group body').length, 4);
  assert.equal(editedAnalysis.candidates.filter(item => item.label === 'Backdrop page body').length, 3);

  const { context } = await PDFDocument.load(editedBytes);
  const groups = context.enumerateIndirectObjects().filter(([, object]) => object.dict?.has(N('Group')));
  assert.equal(groups.length, 3);
  const ref = groups[0][1].dict.get(N('Group'));
  assert.ok(groups.every(([, object]) => object.dict.get(N('Group')) === ref), 'Clones keep the original group reference');
  const attrs = context.lookup(ref);
  assert.equal(attrs.lookup(N('I')), PDFBool.False);
  assert.equal(attrs.lookup(N('K')), knockout ? PDFBool.True : PDFBool.False);
  assert.ok(!attrs.has(N('CS')));

  const defaultIsolation = await analyzeRemovalPdf(await fixture({ isolation: 'default', knockout }));
  assert.equal(defaultIsolation.candidates.filter(item => item.label === label).length, 4);

  const source = await qa.save('source', input);
  const control = await qa.save('isolated-control', await fixture({ isolation: true, knockout }));
  const edited = await qa.save('edited', editedBytes);
  const reference = await qa.save('reference', await fixture({ clean: true, knockout }));
  await qa.verify(edited);
  await qa.compare(edited, reference, 3, { allPdfjsPages: true });
  await qa.verifyPdfjsDifference(source, control, 3);
  return { sharedCalls: targets.length, editedCalls: 2, occurrenceOnlyMatches: 4, ...qa.report() };
}

const report = await verifyBackdrop(qa, true);
await writeFile(path.join(qa.root, 'report.json'), JSON.stringify(report, null, 2));

const ordinaryQa = await pdfRemovalRenderQa('tmp/pdf-transparency-group-ordinary');
const ordinary = await verifyBackdrop(ordinaryQa, false);
const countTargets = async options => (await analyzeRemovalPdf(await fixture({ knockout: false, ...options })))
  .candidates.filter(item => item.label === label).length;
for (const [name, options, expected] of [
  ['caller opacity', { caller: { ca: .7 } }, 0],
  ['caller blend mode', { caller: { BM: 'Multiply' } }, 0],
  ['caller compositing flags', { caller: { AIS: true } }, 0],
  ['caller soft mask', { caller: { SMask: { S: 'Alpha' } } }, 0],
  ['page group', { pageGroup: true }, 0],
  ['enclosing transparency group', { wrappedGroup: true }, 3],
  ['local transfer resources', { localOverride: { ca: .55, TR: 'Identity' } }, 0],
  ['local soft mask', { localOverride: { SMask: { S: 'Alpha' } } }, 0],
  ['explicit default graphics state', { caller: { ca: 1, CA: 1, BM: 'Normal', SMask: 'None' } }, 4],
  ['restored caller opacity', { caller: { ca: .7 }, resetCaller: true }, 4],
  ['omitted isolation and knockout', { isolation: 'default', knockout: 'default' }, 4],
]) {
  assert.equal(await countTargets(options), expected, name);
}
await writeFile(path.join(ordinaryQa.root, 'report.json'), JSON.stringify({ ...ordinary, eligibilityProfiles: 11 }, null, 2));
console.log('PDF non-isolated transparency passed: knockout and ordinary profiles, per-call edits, 6 pages of isolation controls.');
