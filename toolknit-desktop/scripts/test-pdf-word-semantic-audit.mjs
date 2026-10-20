import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const directory = 'tmp/pdf-word-semantic-audit'; await mkdir(directory, { recursive: true });
const pdf = await PDFDocument.create(), page = pdf.addPage([100, 100]), font = await pdf.embedFont(StandardFonts.TimesRoman);
page.drawText('x', { x: 10, y: 70, font, size: 12 }); page.drawText('2', { x: 17, y: 76, font, size: 7 });
const bytes = await pdf.save(), digest = createHash('sha256').update(bytes).digest('hex');
await writeFile(`${directory}/source.pdf`, bytes);
const document = { schemaVersion: 1, sourceSha256: digest, pages: [{ number: 1, blocks: [{ id: 'power', type: 'image', role: 'math', reasons: [],
  mathGlyphs: [{ id: 'x', text: 'x', baseline: 30, size: 12, rect: { x: 10, y: 21, width: 6, height: 9 } },
    { id: 'two', text: '2', baseline: 24, size: 7, rect: { x: 17, y: 18.75, width: 4, height: 5.25 } }], mathStrokes: [] }] }] };
const annotations = { schemaVersion: 1, sourceSha256: digest, unit: 'formula-fragment', entries: [{ page: 1, regionId: 'power',
  expected: { roles: { x: [], two: ['superscript'] }, order: ['x', 'two'], bars: {} } }] };
async function audit(label, layout, truth, sourceFile = `${directory}/source.pdf`) {
  await writeFile(`${directory}/${label}-layout.json`, JSON.stringify(layout));
  await writeFile(`${directory}/${label}-annotations.json`, JSON.stringify(truth));
  return spawnSync(process.execPath, ['scripts/check-pdf-word-math-semantics.mjs', sourceFile,
    `${directory}/${label}-layout.json`, `${directory}/${label}-annotations.json`, `${directory}/${label}-report.json`],
  { encoding: 'utf8', timeout: 10000 });
}
const valid = await audit('matched', document, annotations); assert.equal(valid.status, 0, valid.stderr);
const positive = JSON.parse(await readFile(`${directory}/matched-report.json`, 'utf8'));
assert.equal(positive.matched, 1); assert.equal(positive.overallAccepted, false); assert.equal(positive.independentCorpusComplete, false);
for (const [label, layout, truth, message] of [
  ['layout-sha', { ...document, sourceSha256: '0'.repeat(64) }, annotations, 'Layout evidence must belong'],
  ['annotations-sha', document, { ...annotations, sourceSha256: '0'.repeat(64) }, 'Annotations must belong'],
  ['wrong-page', document, { ...annotations, entries: [{ ...annotations.entries[0], page: 2 }] }, 'Annotation page must match']
]) {
  const result = await audit(label, layout, truth); assert.notEqual(result.status, 0); assert(result.stderr.includes(message));
}
const wrong = structuredClone(annotations); wrong.entries[0].expected.roles.two = ['subscript'];
const invalid = await audit('wrong-role', document, wrong); assert.equal(invalid.status, 2);
const negative = JSON.parse(await readFile(`${directory}/wrong-role-report.json`, 'utf8'));
assert.equal(negative.mismatched, 1); assert.equal(negative.matched, 0);
const completeDocument = structuredClone(document), completePage = completeDocument.pages[0];
completePage.blocks[0].sourceIds = ['x', 'two'];
completePage.sources = completePage.blocks[0].mathGlyphs.map(item => ({ ...item, disposition: 'visible-image' }));
const completeLabels = { schemaVersion: 2, sourceSha256: digest, unit: 'complete-formula', entries: [{
  id: 'independent-power', page: 1, rect: { x: 9, y: 18, width: 13, height: 13 }, expected: annotations.entries[0].expected }] };
const whole = await audit('whole', completeDocument, completeLabels); assert.equal(whole.status, 0, whole.stderr);
const wholeReport = JSON.parse(await readFile(`${directory}/whole-report.json`, 'utf8'));
assert.equal(wholeReport.boundaryComplete, 1); assert.equal(wholeReport.matched, 1); assert.equal(wholeReport.symbolStylesVerified, false);
const styledLabels = structuredClone(completeLabels); styledLabels.entries[0].symbolStyles = { x: 'roman', two: 'roman' };
const styleMatch = await audit('whole-styles', completeDocument, styledLabels); assert.equal(styleMatch.status, 0, styleMatch.stderr);
assert.equal(JSON.parse(await readFile(`${directory}/whole-styles-report.json`, 'utf8')).symbolStylesVerified, true);
assert.equal(JSON.parse(await readFile(`${directory}/whole-styles-report.json`, 'utf8')).annotatedSemanticsVerified, false);
const completeTruth = structuredClone(styledLabels);
completeTruth.entries[0].symbolTexts = { x: 'x', two: '2' };
completeTruth.entries[0].structures = [{ type: 'script', base: ['x'], subscript: [], superscript: ['two'] }];
assert.equal((await audit('all-semantics', completeDocument, completeTruth)).status, 0);
assert.equal(JSON.parse(await readFile(`${directory}/all-semantics-report.json`, 'utf8')).annotatedSemanticsVerified, true);
const wrongText = structuredClone(completeTruth); wrongText.entries[0].symbolTexts.x = 'y';
assert.equal((await audit('bad-symbol', completeDocument, wrongText)).status, 2);
assert.equal(JSON.parse(await readFile(`${directory}/bad-symbol-report.json`, 'utf8')).sourceSymbolMismatched, 1);
const wrongBase = structuredClone(completeTruth); wrongBase.entries[0].structures[0].base = ['x', 'two'];
assert.equal((await audit('bad-script-base', completeDocument, wrongBase)).status, 2);
assert(JSON.parse(await readFile(`${directory}/bad-script-base-report.json`, 'utf8')).results[0].differences.structures);
styledLabels.entries[0].symbolStyles.x = 'bold';
const lostBold = await audit('lost-bold', completeDocument, styledLabels); assert.equal(lostBold.status, 2);
const styleReport = JSON.parse(await readFile(`${directory}/lost-bold-report.json`, 'utf8'));
assert.equal(styleReport.symbolStylesVerified, false); assert.equal(styleReport.results[0].differences.styles[0].id, 'x');
styledLabels.entries[0].symbolStyles = { two: 'roman' };
const partialStyles = await audit('partial-styles', completeDocument, styledLabels); assert.equal(partialStyles.status, 0);
assert.equal(JSON.parse(await readFile(`${directory}/partial-styles-report.json`, 'utf8')).symbolStylesVerified, false,
  'partially styled annotations cannot claim complete style verification');
const mixed = structuredClone(completeDocument);
mixed.pages[0].blocks[0].sourceIds.push('prose');
mixed.pages[0].sources.push({ id: 'prose', text: 'where', rect: { x: 25, y: 20, width: 20, height: 9 }, disposition: 'visible-image' });
const contaminated = await audit('mixed-content', mixed, completeLabels); assert.equal(contaminated.status, 2);
assert.equal(JSON.parse(await readFile(`${directory}/mixed-content-report.json`, 'utf8')).mixedContent, 1);
const split = structuredClone(completeDocument);
split.pages[0].blocks = completePage.blocks[0].mathGlyphs.map(item => ({ id: item.id + ':image', type: 'image', role: 'math',
  sourceIds: [item.id], mathGlyphs: [item], mathStrokes: [], reasons: [] }));
const fragmented = await audit('fragmented', split, completeLabels); assert.equal(fragmented.status, 2);
assert.equal(JSON.parse(await readFile(`${directory}/fragmented-report.json`, 'utf8')).fragmented, 1);
const incompleteBounds = structuredClone(completeLabels); incompleteBounds.entries[0].rect.width = 7;
const missed = await audit('incomplete-bounds', completeDocument, incompleteBounds); assert.notEqual(missed.status, 0);
assert(missed.stderr.includes('Whole-formula bounds'));
const duplicated = structuredClone(completeLabels); duplicated.entries.push({ ...structuredClone(duplicated.entries[0]), id: 'renamed-copy' });
const duplicateResult = await audit('duplicate-formula', completeDocument, duplicated); assert.notEqual(duplicateResult.status, 0);
assert(duplicateResult.stderr.includes('must not count the same source symbol twice'));
const limitPdf = await PDFDocument.create(), limitPage = limitPdf.addPage([100, 100]);
limitPage.drawText('min', { x: 10, y: 70, size: 12, font: await limitPdf.embedFont(StandardFonts.TimesRoman) });
limitPage.drawText('i', { x: 17, y: 63, size: 7, font: await limitPdf.embedFont(StandardFonts.TimesRomanItalic) });
const limitBytes = await limitPdf.save(), limitDigest = createHash('sha256').update(limitBytes).digest('hex');
await writeFile(`${directory}/limit-source.pdf`, limitBytes);
const limitGlyphs = [
  { id: 'operator', text: 'min', italic: false, baseline: 30, size: 12, rect: { x: 10, y: 21.6, width: 18, height: 8.4 } },
  { id: 'index', text: 'i', italic: true, baseline: 37, size: 7, rect: { x: 17, y: 32.1, width: 4, height: 4.9 } },
];
const limitDocument = { schemaVersion: 1, sourceSha256: limitDigest, pages: [{ number: 1,
  sources: limitGlyphs.map(glyph => ({ ...glyph, disposition: 'visible-image' })),
  blocks: [{ id: 'limit', type: 'image', role: 'math', reasons: [], sourceIds: ['operator', 'index'], mathGlyphs: limitGlyphs, mathStrokes: [] }] }] };
const limitTruth = { schemaVersion: 2, sourceSha256: limitDigest, unit: 'complete-formula', entries: [{ id: 'minimum', page: 1,
  rect: { x: 9, y: 21, width: 20, height: 17 }, expected: { roles: { operator: [], index: ['lowerLimit'] }, order: ['operator', 'index'], bars: {} },
  symbolTexts: { operator: 'min', index: 'i' }, symbolStyles: { operator: 'roman', index: 'italic' },
  structures: [{ type: 'limit', base: ['operator'], lower: ['index'], upper: [] }] }] };
assert.equal((await audit('limit', limitDocument, limitTruth, `${directory}/limit-source.pdf`)).status, 0);
const wrongLimit = structuredClone(limitTruth); wrongLimit.entries[0].expected.roles.index = ['subscript'];
assert.equal((await audit('wrong-limit-role', limitDocument, wrongLimit, `${directory}/limit-source.pdf`)).status, 2);
console.log('Math semantic audit checks passed: source/layout/annotation binding, page identity and independent-role mismatch.');
