import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { snapshotPage, snapshotFonts, renderPage, collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { buildPageScene } from '../src/features/pdf-to-word/core/scene.js';
import { prepareWordScene } from '../src/features/pdf-to-word/adapters/scene.js';
import { inferDocument, validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes, wordFont } from '../src/features/pdf-to-word/adapters/docx.js';

assert.equal(wordFont('ABCDEF+\u00e5\u00ae\u008b\u00e4\u00bd\u0093'), 'SimSun', 'UTF-8 PDF font names misread as Latin-1 still identify the actual family');
assert.equal(wordFont('\u5b8b\u4f53'), 'SimSun');
assert.equal(wordFont('Example\u00e9'), 'Example\u00e9', 'invalid UTF-8 is not repaired by guessing');
assert.equal(wordFont('ABCDEF+NimbusRomNo9L-ReguItal'), 'Times New Roman');
assert.equal(wordFont('NimbusSanL-Regu'), 'Arial');
assert.equal(wordFont('NimbusMonL-Regu'), 'Courier New');
assert.equal(wordFont('Font\u008b'), 'SimSun', 'unrepaired control bytes cannot become output font names');

const output = 'tmp/pdf-to-word-complex'; await mkdir(output, { recursive: true });
const source = await PDFDocument.create(); source.registerFontkit(fontkit);
const font = await source.embedFont(await readFile('public/assets/fonts/NotoSansSC-Regular.ttf'), { subset: false });
const page = source.addPage([456, 100]);
page.drawText('\u6d4b\u8bd5\u6587\u5b57 123 ABC', { x: 12, y: 78, size: 11, font });
page.drawText('x', { x: 40, y: 50, size: 12, font, ySkew: degrees(10) });
page.drawText('2', { x: 49, y: 55, size: 7, font });
page.drawText('=', { x: 59, y: 50, size: 12, font });
page.drawText('1', { x: 75, y: 57, size: 9, font });
page.drawLine({ start: { x: 72, y: 54 }, end: { x: 84, y: 54 }, thickness: .4 });
page.drawText('3', { x: 75, y: 43, size: 9, font });
page.drawText('END', { x: 100, y: 50, size: 11, font });
page.drawText('(', { x: 170, y: 50, size: 11, font });
for (const [y, x] of [[30, 34], [15, 38]]) {
  page.drawText('[1]', { x: 12, y, size: 11, font });
  page.drawText('Bastien, F. and Other', { x, y, size: 11, font });
}
const hidden = source.addPage([456, 90]);
hidden.drawText('CONFIDENTIAL', { x: 20, y: 60, size: 11, font });
hidden.drawRectangle({ x: 19, y: 58, width: 130, height: 16, color: rgb(0, 0, 0) });
hidden.drawText('VISIBLE', { x: 20, y: 30, size: 11, font });
const bytes = await source.save(); await writeFile(`${output}/source.pdf`, bytes);
const task = getDocument({ data: bytes.slice(), fontExtraProperties: true, verbosity: 0 });
const scenes = [], assets = []; let fallbackScene, fallbackAssets, nimbusScene, nimbusAssets;
try {
  const pdf = await task.promise;
  for (let n = 1; n <= pdf.numPages; n++) {
    const current = await pdf.getPage(n), snapshot = await snapshotPage(current, OPS), canvas = createCanvas(1, 1);
    await renderPage(current, canvas, {}); snapshot.fonts = snapshotFonts(current, snapshot.fontIds);
    if (n === 1) {
      const tagged = structuredClone(snapshot);
      tagged.operations.unshift({ name: 'beginMarkedContentProps', args: ['P', 0] });
      tagged.operations.push({ name: 'endMarkedContent' });
      const taggedScene = buildPageScene(tagged);
      assert(!taggedScene.rasterPage, 'structure-only marked content retains editable text');
      assert(taggedScene.items.some(item => item.type === 'text'));
      const emptyPath = structuredClone(snapshot);
      emptyPath.operations.unshift({ name: 'constructPath', args: ['fillStroke', [[4]], [Infinity, Infinity, -Infinity, -Infinity]] });
      assert.equal(buildPageScene(emptyPath).items.length, buildPageScene(snapshot).items.length, 'empty close-only paint is a no-op');
      emptyPath.operations.unshift({ name: 'clip' });
      assert(buildPageScene(emptyPath).sources.every(source => source.disposition === 'excluded-hidden'), 'empty clipping still suppresses following text');
      tagged.operations[0].args = ['OC', { type: 'OCG', id: 'hidden-layer' }];
      const optionalScene = buildPageScene(tagged);
      assert(optionalScene.rasterPage && optionalScene.risks.includes('optional-content'), 'optional hidden layers never leak as editable text');
      fallbackScene = optionalScene; fallbackAssets = await collectPageAssets(optionalScene, canvas, createCanvas);
      const nimbus = structuredClone(snapshot);
      for (const font of Object.values(nimbus.fonts)) { font.name = 'NimbusRomNo9L-MediItal'; font.bold = font.italic = false; }
      nimbusScene = buildPageScene(nimbus);
      assert(nimbusScene.items.filter(item => item.type === 'text').every(item => item.bold && item.italic), 'Nimbus vendor emphasis survives source flags that omit it');
      nimbusAssets = await collectPageAssets(nimbusScene, canvas, createCanvas);
      const remapped = structuredClone(snapshot);
      const glyph = remapped.operations.filter(op => op.name === 'showText').flatMap(op => op.args[0]).find(glyph => glyph.unicode === '(');
      glyph.unicode = ' '; remapped.textCharacters--;
      const recovered = buildPageScene(remapped);
      assert(!recovered.rasterPage);
      assert(recovered.items.some(item => item.reasons?.includes('unmapped-glyph')), 'visible glyph encoded as whitespace must not disappear');
    }
    const scene = prepareWordScene(snapshot, { measurementContext: createCanvas(1, 1).getContext('2d') });
    assets.push(...await collectPageAssets(scene, canvas, createCanvas)); scenes.push(scene);
    canvas.width = canvas.height = 0; current.cleanup();
  }
} finally { await task.destroy(); }
await writeFile(`${output}/scenes.json`, JSON.stringify(scenes, null, 2));
assert(scenes[0].items.some(item => item.type === 'text' && item.preciseInk));
const wordLine = scenes[0].items.find(item => item.type === 'text' && item.text.includes('123 ABC'));
assert.equal(wordLine.words.length, 3, 'source word positions survive extraction');
assert(wordLine.words[1].rect.x > wordLine.words[0].rect.x + wordLine.words[0].rect.width);
assert(!scenes[0].risks.includes('complex-text'), 'bounded synthetic italic stays supported');
assert(scenes[0].items.some(item => item.type === 'image' && item.role === 'math'), 'whole formula fallback exists');
for (const scene of scenes) {
  const ids = scene.drawingOwnership.map(item => item.id);
  assert.equal(ids.length, new Set(ids).size, 'a drawing has a single output owner');
}
const document = inferDocument(scenes); validateCoverage(document);
assert(document.quality.pages[0].imageFormulas > 0, 'inline formulas remain visible in quality reporting');
const converted = await createWordBytes(document, assets, { measurementContext: createCanvas(1, 1).getContext('2d') });
await writeFile(`${output}/converted.docx`, converted.bytes);
const zip = await JSZip.loadAsync(converted.bytes), xml = await zip.file('word/document.xml').async('string');
assert(!xml.includes('<m:oMath>'), 'the default path keeps formulas faithful until native math clears independent validation');
assert(xml.includes('VISIBLE')); assert(!xml.includes('CONFIDENTIAL'));
assert(xml.includes('w:framePr')); assert(xml.includes('w:autoSpaceDE w:val="false"'));
const walk = node => [node, ...(node.elements || []).flatMap(walk)];
for (const position of walk(xml2js(xml)).filter(node => node.name === 'w:position')) {
  assert.match(position.attributes['w:val'], /^-?\d+$/, 'baseline offsets use integer half-points, never unit strings');
}
const paragraphs = walk(xml2js(xml)).filter(node => node.name === 'w:p');
const visibleText = walk(xml2js(xml, { captureSpacesBetweenElements: true })).filter(node => node.name === 'w:t').map(node => node.elements?.map(child => child.text || '').join('')).join('').replace(/\s+/g, ' ');
assert(visibleText.includes('\u6d4b\u8bd5\u6587\u5b57 123 ABC'), 'positioned words keep actual spaces in the editable result');
const referenceRuns = walk(xml2js(xml)).filter(node => node.name === 'w:r')
  .filter(run => walk(run).some(node => node.name === 'w:t' && node.elements?.some(child => child.text === '[1]')));
assert.equal(referenceRuns.length, 2);
const referenceSpacing = referenceRuns.map(run => walk(run).find(node => node.name === 'w:spacing')?.attributes['w:val'] ?? '0');
assert.equal(referenceSpacing[0], referenceSpacing[1], 'whitespace after a reference label must not stretch the label itself');
for (const paragraph of paragraphs) {
  const properties = walk(paragraph.elements?.find(node => node.name === 'w:pPr') || {});
  assert(!(properties.some(node => node.name === 'w:sectPr') && properties.some(node => node.name === 'w:framePr')),
    'section break must never attach to a floating line');
}
assert.equal((xml.match(/<w:sectPr>/g) || []).length, 2);
const continuous = await createWordBytes(document, assets, { continuous: true, measurementContext: createCanvas(1, 1).getContext('2d') });
await writeFile(`${output}/continuous.docx`, continuous.bytes);
const continuousZip = await JSZip.loadAsync(continuous.bytes);
const continuousXml = await continuousZip.file('word/document.xml').async('string');
assert.equal((continuousXml.match(/<w:sectPr>/g) || []).length, 1, 'source pages must not force separate sections in continuous mode');
assert(continuousXml.includes('w:w="11906" w:h="16838"'));
assert(continuousXml.includes('w:framePr'), 'complex fragments retain their internal geometry on a shared A4 page');
assert(continuousXml.includes('toolknit_source_1')); assert(continuousXml.includes('toolknit_source_2'));
assert(continuousXml.includes('VISIBLE')); assert(!continuousXml.includes('CONFIDENTIAL'));
assert.equal(continuous.quality.layoutMode, 'continuous-a4');
assert.equal(continuous.quality.sourceMap.length, 2);
const fallback = await createWordBytes(inferDocument([fallbackScene], { preserveGeometry: true }), fallbackAssets, { preserveGeometry: true });
const fallbackZip = await JSZip.loadAsync(fallback.bytes), fallbackXml = await fallbackZip.file('word/document.xml').async('string');
assert.equal(fallback.quality.editableCharacters, 0, 'positioning does not make fallback images editable');
assert(fallbackXml.includes('<wp:anchor') && !fallbackXml.includes('<wp:inline'), 'full-page fidelity uses page coordinates without paragraph offsets');
assert(fallbackXml.includes('w:top="0"') && fallbackXml.includes('w:bottom="0"'));
const nimbus = await createWordBytes(inferDocument([nimbusScene], { preserveGeometry: true }), nimbusAssets,
  { preserveGeometry: true, measurementContext: createCanvas(1, 1).getContext('2d') });
const nimbusZip = await JSZip.loadAsync(nimbus.bytes), nimbusXml = await nimbusZip.file('word/document.xml').async('string');
const nimbusRuns = walk(xml2js(nimbusXml)).filter(node => node.name === 'w:r')
  .filter(run => walk(run).some(node => node.name === 'w:rFonts' && node.attributes['w:ascii'] === 'Times New Roman'));
assert(nimbusRuns.length > 0);
assert(nimbusRuns.every(run => walk(run).filter(node => node.name === 'w:position').every(node => Number(node.attributes['w:val']) === 0)),
  'metric-compatible replacement uses source baselines instead of shifting each word to a different glyph outline');
console.log('Complex PDF checks passed: embedded-font geometry, shear, mixed formula line, drawing ownership, redaction, short-page section anchors.');
