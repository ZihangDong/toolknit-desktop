import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFBool, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { exactRemovalMatches, removalPages } from '../src/features/pdf-object-remove/core.js';
import { analyzeRemovalPdf, buildRemovalPdf } from '../src/features/pdf-object-remove/processor.js';
import { pdfRemovalRenderQa } from './lib/pdf-removal-render-qa.mjs';

const N = PDFName.of;
const label = 'GROUP DRAFT';
const group = { Type: 'Group', S: 'Transparency', CS: 'DeviceRGB', I: true, K: false };
const paintColors = {
  DeviceRGB: ['0.15 0.55 0.84 rg', '0.85 0.1 0.05 rg'],
  DeviceGray: ['0.32 g', '0.04 g'],
  DeviceCMYK: ['0.9 0.43 0.1 0.05 k', '0.12 0.9 0.87 0.1 k'],
};
const pageText = '0 g BT /F0 13 Tf 20 142 Td (Page retained text) Tj ET\n';
const render = await pdfRemovalRenderQa('tmp/pdf-transparency-group');

async function makeFixture({ reference = false, variants, colorSpace = 'DeviceRGB', knockout = false,
  overlap = knockout } = {}) {
  const [bodyColor, targetColor] = paintColors[colorSpace];
  const groupBody = `q /Half gs ${bodyColor} 0 18 154 58 re f Q\n`
    + (overlap ? `q /Half gs ${targetColor} 75 19 64 60 re f Q\n` : '')
    + 'BT /F0 12 Tf 10 87 Td (Group retained text) Tj ET\n';
  const targetSize = colorSpace === 'DeviceRGB' ? 22 : 18;
  const target = `q /Half gs ${targetColor} BT /F0 ${targetSize} Tf 9 36 Td (GROUP DRAFT) Tj ET Q\n`;
  const doc = await PDFDocument.create(), ctx = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const stream = (drawing, fields) => ctx.register(ctx.flateStream(drawing, fields));
  const fields = resources => ({ Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 154, 110], Resources: resources });
  const inner = (drawing, options, indirect = false) => stream(drawing, {
    ...fields({ Font: { F0: font.ref }, ExtGState: { Half: { Type: 'ExtGState', ca: 0.56 } } }),
    Group: indirect ? ctx.register(ctx.obj(options)) : options,
  });
  function pageWith(drawing, objects) {
    const page = doc.addPage([370, 175]);
    page.node.set(N('Contents'), stream(drawing));
    page.node.set(N('Resources'), ctx.obj({
      Font: { F0: font.ref }, XObject: objects,
      ExtGState: { Composite: { Type: 'ExtGState', ca: 0.68, BM: 'Multiply' } },
    }));
  }
  if (variants) {
    for (const { options, single = false } of variants) {
      const ref = inner(single ? target : groupBody + target, options);
      pageWith(pageText + 'q 1 0 0 1 20 16 cm /Paint Do Q\n', { Paint: ref });
    }
    return doc.save();
  }
  const options = { ...group, CS: colorSpace, K: knockout };
  const shared = inner(groupBody + target, options, true);
  const clean = reference ? inner(groupBody, options, true) : shared;
  const outer = paint => stream('/Paint Do\n', fields({ XObject: { Paint: paint } }));
  const backdrop = '0.95 0.89 0.75 rg 0 0 370 175 re f\n'
    + '0.63 0.82 0.48 rg 90 0 200 130 re f\n' + pageText;
  const place = (name, x) => `q /Composite gs 1 0 0 1 ${x} 16 cm /${name} Do Q\n`;
  pageWith(backdrop + place('Left', 20) + place('Right', 194), { Left: clean, Right: shared });
  pageWith(backdrop + place('Left', 20), { Left: shared });
  pageWith(backdrop + place('Nested', 20), { Nested: outer(clean) });
  return doc.save();
}

async function verifyGroup(qa, colorSpace, knockout = false) {
  const input = await makeFixture({ colorSpace, knockout }), analysis = await analyzeRemovalPdf(input);
  const matches = analysis.candidates.filter(item => item.label === label);
  assert.deepEqual(matches.map(item => [item.pageIndex, item.formDepth]), [[0, 1], [0, 1], [1, 1], [2, 2]]);
  assert.deepEqual(exactRemovalMatches(analysis.candidates, matches[0], removalPages('', 3)),
    [matches[0].id, matches[2].id]);
  assert.ok(!analysis.candidates.some(item => item.kind === 'text-form' || item.kind === 'image-form'));
  const output = await buildRemovalPdf(analysis, [matches[0].id, matches[3].id]);
  const updated = await analyzeRemovalPdf(output);
  assert.deepEqual(updated.candidates.filter(item => item.label === label).map(item => item.pageIndex), [0, 1]);
  assert.equal(updated.candidates.filter(item => item.label === 'Group retained text').length, 4);
  assert.equal(updated.candidates.filter(item => item.label === 'Page retained text').length, 3);

  const { context } = await PDFDocument.load(output);
  const groups = context.enumerateIndirectObjects().filter(([, value]) => value.dict?.has(N('Group')));
  assert.equal(groups.length, 3, 'Original group and exactly two edited occurrences');
  const groupRef = groups[0][1].dict.get(N('Group'));
  assert.equal(context.lookup(groupRef).lookup(N('CS')), N(colorSpace));
  assert.equal(context.lookup(groupRef).lookup(N('K')), knockout ? PDFBool.True : PDFBool.False);
  assert.ok(groups.every(([, value]) => value.dict.get(N('Group')) === groupRef), 'Clones retain the same indirect group dictionary');
  const source = await qa.save('source', input);
  const edited = await qa.save('edited', output);
  const reference = await qa.save('reference', await makeFixture({ reference: true, colorSpace, knockout }));
  await qa.verify(edited);
  await qa.compare(edited, reference, 3, { allPdfjsPages: true });
  if (knockout) {
    const control = await qa.save('without-knockout', await makeFixture({ colorSpace, overlap: true }));
    await qa.verifyPdfjsDifference(source, control, 3);
  }
  return { colorSpace, pages: 3, sharedCalls: matches.length, selectedCalls: 2, ...qa.report() };
}

const rgbReport = await verifyGroup(render, 'DeviceRGB');
const addedSpaces = ['DeviceGray', 'DeviceCMYK'];
const colorRoot = path.resolve('tmp/pdf-transparency-group-colors');
const colorReports = [];
for (const colorSpace of addedSpaces) {
  const qa = await pdfRemovalRenderQa(path.join(colorRoot, colorSpace));
  colorReports.push(await verifyGroup(qa, colorSpace));
}
const knockoutRoot = path.resolve('tmp/pdf-transparency-group-knockout');
const knockoutReports = [];
for (const colorSpace of ['DeviceRGB', ...addedSpaces]) {
  const qa = await pdfRemovalRenderQa(path.join(knockoutRoot, colorSpace));
  knockoutReports.push(await verifyGroup(qa, colorSpace, true));
}

const variants = [
  { options: { ...group, I: false } }, { options: { ...group, I: false, K: true } },
  { options: { ...group, I: undefined } }, { options: { ...group, CS: undefined } },
  { options: { ...group, CS: ['CalRGB', { WhitePoint: [0.95, 1, 1.09] }] } }, { options: { ...group, CS: 'CustomSpace' } },
  { options: { ...group, I: 1 } }, { options: { ...group, K: 0 } },
  { options: { ...group, S: 'Other' } }, { options: { ...group, Type: 'Other' } },
  { options: { ...group, Unknown: 1 } }, { options: 'Transparency' },
  { options: { S: 'Transparency', CS: 'DeviceRGB', I: true }, single: true },
];
const mixed = await makeFixture({ variants }), mixedAnalysis = await analyzeRemovalPdf(mixed);
assert.deepEqual(mixedAnalysis.pages.map(page => page.candidates.map(item => [item.label, item.kind])),
  variants.map(({ single }) => [['Page retained text', 'text'], ...(single ? [[label, 'text']] : [])]));
const outside = mixedAnalysis.pages[0].candidates[0];
const mixedEdited = await buildRemovalPdf(mixedAnalysis, [outside.id]);
const preservedGroup = async bytes => {
  const doc = await PDFDocument.load(bytes);
  const form = doc.getPage(0).node.Resources().lookup(N('XObject')).lookup(N('Paint'));
  return [form.dict.lookup(N('Group')).toString(), form.getContents()];
};
assert.deepEqual(await preservedGroup(mixedEdited), await preservedGroup(mixed));

const report = { ...rgbReport, rejectedProfiles: variants.length - 1, directGroupWithDefaultKnockout: true };
await writeFile(path.join(render.root, 'report.json'), JSON.stringify(report, null, 2));
await writeFile(path.join(colorRoot, 'report.json'), JSON.stringify(colorReports, null, 2));
await writeFile(path.join(knockoutRoot, 'report.json'), JSON.stringify(knockoutReports, null, 2));
console.log(`PDF isolated transparency group passed: 3 device spaces with and without knockout, ${report.rejectedProfiles} rejected profiles, ${[report, ...colorReports, ...knockoutReports].reduce((n, item) => n + item.pixelChecks, 0)} reference pages per renderer when native checks are enabled.`);
