import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Document, Packer, Paragraph } from 'docx';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { sourceFontTraits, mathDisplayText } from '../src/features/pdf-to-word/core/font-style.js';
import { createGlyphMetrics } from '../src/features/pdf-to-word/core/font-metrics.js';
import { buildPageScene } from '../src/features/pdf-to-word/core/scene.js';
import { snapshotPage, snapshotFonts, renderPage } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { inferMathAst, validateMathEvidence } from '../src/features/pdf-to-word/core/math.js';
import { nativeMath } from '../src/features/pdf-to-word/adapters/docx-math.js';
import { mathWordFont } from '../src/features/pdf-to-word/adapters/docx-fonts.js';

const traits = (name, text, metadata = {}) => sourceFontTraits({ name: `ABCDEF+${name}` }, text, { name, ...metadata });
assert(traits('CMBX10', 'x').bold);
assert(traits('CMMI10', 'W', { italic: true }).italic);
assert(traits('CMBXTI10', 'x').bold && traits('CMBXTI10', 'x').italic);
assert.equal(traits('CMSY10', 'F', { italic: true }).alphabet, 'script');
assert.equal(traits('CMSY10', 'F', { italic: true }).italic, false);
assert.equal(traits('CMSY10', '{}', { italic: true }).italic, false, 'symbol-font angle cannot italicize upright delimiters');
assert.equal(traits('CMSY10', '{}').alphabet, undefined);
assert(traits('CMBSY10', 'F').bold && traits('CMBSY10', 'F').alphabet === 'script');
assert.equal(traits('MSBM10', 'E').alphabet, 'doubleStruck');
assert(traits('CMSY10', 'Fa').mathStyleUncertain, 'unverified mixed symbol encodings are not guessed');
assert(traits('MSBM10', 'a').mathStyleUncertain, 'unverified symbol slots are not ordinary lowercase letters');
assert(sourceFontTraits({ name: 'CMSY10' }, 'F').mathStyleUncertain);
assert(sourceFontTraits({ name: 'CMSY10' }, 'F', { name: 'OtherFont' }).mathStyleUncertain,
  'a renamed ordinary font cannot claim calligraphic encoding');
assert.equal(traits('OtherCMSY10', 'F').alphabet, undefined);
assert.equal(traits('CMSY10' + 'x'.repeat(200), 'F').alphabet, undefined);
assert.equal(mathDisplayText('F + 2', 'script'), '\u2131 + 2');
assert.equal(mathDisplayText('F', 'script', true), String.fromCodePoint(0x1d4d5));
assert.equal(mathDisplayText('E R', 'doubleStruck'), String.fromCodePoint(0x1d53c) + ' \u211d');
assert.equal(mathDisplayText('E', 'doubleStruck', true), null);
assert.equal(mathDisplayText('F', 'invented'), null);
assert.equal(mathDisplayText('x', undefined), 'x');
assert.equal([...mathDisplayText('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'script')].length, 26);

const source = { id: 'F', text: 'F', size: 12, baseline: 22, rect: { x: 10, y: 13, width: 9, height: 9 },
  font: 'CMSY10', bold: false, italic: false, alphabet: 'script' };
const region = { role: 'math', reasons: [], rect: source.rect, mathGlyphs: [source], mathStrokes: [] };
const ast = inferMathAst(region); assert.equal(ast.alphabet, 'script');
for (const mutation of [node => { delete node.alphabet; }, node => { node.alphabet = 'doubleStruck'; },
  node => { node.bold = true; }, node => { node.italic = true; }]) {
  const changed = structuredClone(ast); mutation(changed); assert(!validateMathEvidence(changed, region));
}
const uncertain = structuredClone(region); uncertain.mathGlyphs[0].mathStyleUncertain = true;
assert.equal(inferMathAst(uncertain), null); assert(!validateMathEvidence(ast, uncertain));
const shearedScript = structuredClone(region); shearedScript.mathGlyphs[0].italic = true;
assert.equal(inferMathAst(shearedScript), null, 'an additional unverified script slant retains its image');
const context = createCanvas(1, 1).getContext('2d'), native = nativeMath(ast, region, { measurementContext: context });
assert.equal(source.text, 'F', 'display measurement cannot rewrite the source text');
assert.equal(native.sourceLayout.font, 'Cambria Math');
const plain = structuredClone(region); delete plain.mathGlyphs[0].alphabet; plain.mathGlyphs[0].font = 'Times-Roman';
const bold = structuredClone(region); bold.mathGlyphs[0].bold = true;
const expectation = structuredClone(region); Object.assign(expectation.mathGlyphs[0], { text: 'E', alphabet: 'doubleStruck', font: 'MSBM10' });
const doc = new Document({ sections: [{ children: [region, plain, bold, expectation].map(sample => new Paragraph({
  children: [nativeMath(inferMathAst(sample), sample, { measurementContext: context })], run: { size: 24 }, spacing: { after: 240 }
})) }] });
const bytes = await Packer.toBuffer(doc), xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string');
const nodes = node => [node, ...(node.elements || []).flatMap(nodes)];
const runs = nodes(xml2js(xml)).filter(node => node.name === 'm:r');
assert.equal(runs.length, 4);
assert(nodes(runs[0]).some(node => node.name === 'm:t' && node.elements?.some(text => text.text === '\u2131')),
  'source-bound math alphabet is represented by its equivalent Unicode glyph');
assert(nodes(runs[0]).some(node => node.name === 'm:nor'), 'literal glyphs avoid readers dropping the OMML script property');
assert(nodes(runs[1]).some(node => node.name === 'm:nor'));
assert(nodes(runs[2]).some(node => node.name === 'm:t' && node.elements?.some(text => text.text === String.fromCodePoint(0x1d4d5))));
assert(nodes(runs[3]).some(node => node.name === 'm:t' && node.elements?.some(text => text.text === String.fromCodePoint(0x1d53c))));

assert.equal(mathWordFont({ font: 'Times-Roman', text: 'x+\u00b5' }), 'Times New Roman',
  'a Greek variable beside an ASCII operator does not make the whole run a missing math symbol');
assert.equal(mathWordFont({ font: 'Helvetica', text: 'x=2' }), 'Arial');
const operatorSamples = ['\u2220', '\u2208', '\u2282', '\u22a4', '\u00d7', '='].map((text, index) => {
  const glyph = { ...source, id: `operator-${index}`, text, font: 'Times-Roman', alphabet: undefined };
  return { ...region, mathGlyphs: [glyph] };
});
const operatorOriginals = structuredClone(operatorSamples);
const operatorDoc = new Document({ sections: [{ children: operatorSamples.map(sample => {
  const formula = nativeMath(inferMathAst(sample), sample, { measurementContext: context });
  assert.equal(formula.sourceLayout.font, sample.mathGlyphs[0].text === '=' ? 'Times New Roman' : 'Cambria Math');
  return new Paragraph({ children: [formula] });
}) }] });
const operatorBytes = await Packer.toBuffer(operatorDoc);
const operatorXml = await (await JSZip.loadAsync(operatorBytes)).file('word/document.xml').async('string');
const operatorRuns = nodes(xml2js(operatorXml)).filter(node => node.name === 'm:r');
assert.equal(operatorRuns.length, operatorSamples.length);
operatorRuns.forEach((run, index) => {
  const glyph = operatorSamples[index].mathGlyphs[0], actual = nodes(run);
  assert.equal(actual.find(node => node.name === 'm:t').elements.find(node => node.type === 'text').text, glyph.text);
  const face = actual.find(node => node.name === 'w:rFonts').attributes;
  assert.equal(face['w:ascii'], glyph.text === '=' ? 'Times New Roman' : 'Cambria Math');
  assert.equal(face['w:hAnsi'], face['w:ascii'], 'measurement and actual Unicode output use the same explicit face');
});
assert.deepEqual(operatorSamples, operatorOriginals, 'target font selection preserves source glyphs and their semantic text');

const pdf = await PDFDocument.create(), page = pdf.addPage([100, 60]);
page.drawText('x', { x: 10, y: 25, size: 12, font: await pdf.embedFont(StandardFonts.HelveticaBoldOblique) });
const task = getDocument({ data: await pdf.save(), fontExtraProperties: true, verbosity: 0,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
try {
  const current = await (await task.promise).getPage(1), snapshot = await snapshotPage(current, OPS), canvas = createCanvas(1, 1);
  await renderPage(current, canvas, {}); const fonts = snapshotFonts(current, snapshot.fontIds), metrics = createGlyphMetrics(fonts);
  const embedded = metrics.style(snapshot.fontIds[0]);
  assert(embedded?.italic, 'embedded font metadata supplies slant evidence independently of the name heuristic');
  const renamed = structuredClone({ ...snapshot, fonts });
  for (const font of Object.values(renamed.fonts)) font.name = 'ABCDEF+CMSY10';
  const uncertainScene = buildPageScene(renamed);
  assert(uncertainScene.sources.every(item => item.disposition === 'visible-image'),
    'unverified TeX font identity also blocks ordinary editable text, not only native formulas');
  canvas.width = canvas.height = 0; current.cleanup();
} finally { await task.destroy(); }
await mkdir('tmp/pdf-word-math/font-style', { recursive: true });
await writeFile('tmp/pdf-word-math/font-style/alphabets-extended.docx', bytes);
await writeFile('tmp/pdf-word-math/font-style/unicode-operators.docx', operatorBytes);
console.log('Math font style checks passed: embedded slant, bound TeX aliases, script alphabet, ambiguous fallback and immutable AI symbol styles.');
