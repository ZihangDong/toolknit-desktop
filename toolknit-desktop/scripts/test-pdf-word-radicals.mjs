import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, pushGraphicsState, popGraphicsState, moveTo, lineTo, stroke, setLineWidth } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { Document, Packer, Paragraph } from 'docx';
import JSZip from 'jszip';
import { mkdir, writeFile } from 'node:fs/promises';
import { snapshotPage, snapshotFonts, renderPage } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { buildPageScene } from '../src/features/pdf-to-word/core/scene.js';
import { inferMathAst, validateMathAst, validateMathEvidence } from '../src/features/pdf-to-word/core/math.js';
import { radicalPaths } from '../src/features/pdf-to-word/core/math-paths.js';
import { nativeMath } from '../src/features/pdf-to-word/adapters/docx-math.js';
import { strokeMayTouchRect } from '../src/features/pdf-to-word/core/geometry.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';

const glyph = (id, text, x, baseline, size = 12, width = 6) => ({ id, text, baseline, size, font: 'Times-Roman',
  italic: false, bold: false, rect: { x, y: baseline - size * .75, width, height: size * .75 } });
const rootPath = (id, x = 10, y = 10, width = 24, height = 12) => {
  const points = [[x, y + height * .75], [x + height * .1, y + height * .62], [x + height * .3, y + height],
    [x + height * .65, y], [x + width, y]];
  return points.slice(0, -1).map((from, segment) => {
    const to = points[segment + 1];
    return { id: `${id}-${segment}`, thin: true, unmapped: false,
      rect: { x: Math.min(from[0], to[0]) - .2, y: Math.min(from[1], to[1]) - .2,
        width: Math.abs(from[0] - to[0]) + .4, height: Math.abs(from[1] - to[1]) + .4 },
      path: { id, segment, from, to, paint: 'stroke', color: '000000', complete: true } };
  });
};
const region = (mathGlyphs, mathStrokes) => ({ role: 'math', reasons: [], rect: { x: 0, y: 0, width: 80, height: 60 }, mathGlyphs, mathStrokes });
const simple = region([glyph('x', 'x', 20, 22)], rootPath('root'));
const groupRoot = (extra = []) => {
  const text = [glyph('equals', '=', 0, 22, 12, 5), ...simple.mathGlyphs, ...extra].map((item, order) => ({
    ...item, sourceIds: [item.id], order }));
  const drawings = simple.mathStrokes.map((item, order) => ({ ...item, sourceIds: [], order: order + 20,
    raster: true, reason: 'image', decoration: true, strokeColor: '000000' }));
  const sources = text.map(item => ({ id: item.id, text: item.text, order: item.order, disposition: 'editable' }));
  return { ...groupPageRegions(text, drawings, [], sources), sources };
};
const completeRoot = groupRoot();
assert.equal(completeRoot.items.length, 1, 'a root separated by normal operator spacing remains with its preceding equality');
assert.deepEqual(new Set(completeRoot.items[0].sourceIds), new Set(['equals', 'x']));
assert.equal(inferMathAst(completeRoot.items[0]).type, 'row');
const separatedRoot = groupRoot([glyph('prose', '\u5373', 5.5, 22, 5, 3)]);
assert(separatedRoot.items.some(item => item.id === 'prose' && item.type === 'text'), 'intervening prose must not be absorbed');
assert(!separatedRoot.items.some(item => item.sourceIds?.includes('equals') && item.sourceIds.includes('x')));
const nextLineRoot = groupRoot([glyph('other-line', 'y', 35, 38, 12, 5)]);
assert(!nextLineRoot.items.some(item => item.sourceIds?.includes('equals') && item.sourceIds.includes('other-line')),
  'an adjacent horizontal position on the next line is not a formula continuation');
assert(!strokeMayTouchRect({ paint: 'stroke', from: [10, 22], to: [18, 10], strokeRadius: .2, joinRadius: 2 },
  { x: 17.5, y: 18, width: 4, height: 4 }), 'a diagonal bounding box is not evidence that the stroke covers text');
assert(strokeMayTouchRect({ paint: 'stroke', from: [10, 20], to: [24, 20], strokeRadius: .2, joinRadius: 2 },
  { x: 17.5, y: 18, width: 4, height: 4 }));
assert(strokeMayTouchRect({ paint: 'stroke', from: [10, 22], to: [18, 10], strokeRadius: .2, joinRadius: 8 },
  { x: 17.5, y: 18, width: 4, height: 4 }), 'large miter joins remain conservatively covered');
assert(strokeMayTouchRect({ paint: 'stroke', from: [10, 22], to: [18, 10], strokeRadius: .2, joinRadius: null },
  { x: 17.5, y: 18, width: 4, height: 4 }));
assert.equal(radicalPaths(simple.mathStrokes).length, 1);
const ast = inferMathAst(simple); assert.equal(ast.type, 'radical'); assert.equal(ast.radicand.sourceId, 'x');
assert.deepEqual(ast.strokeIds, ['root-0', 'root-1', 'root-2', 'root-3']); assert(validateMathAst(ast, simple));
const indexed = region([glyph('index', '3', 8, 15, 5, 3), glyph('x', 'x', 20, 22)], rootPath('root'));
const indexedAst = inferMathAst(indexed); assert.equal(indexedAst.degree.sourceId, 'index'); assert.equal(indexedAst.radicand.sourceId, 'x');
const swapped = { ...indexedAst, degree: indexedAst.radicand, radicand: indexedAst.degree };
assert(!validateMathAst(swapped, indexed), 'the root index cannot become the radicand');
const sibling = region([glyph('left', '2', 0, 22), glyph('x', 'x', 20, 22), glyph('right', '3', 38, 22)], rootPath('root'));
const siblingAst = inferMathAst(sibling); assert.deepEqual(siblingAst.children.map(node => node.type), ['symbol', 'radical', 'symbol']);
assert.equal(siblingAst.children[1].radicand.sourceId, 'x', 'outside coefficients do not enter the radicand');
const fractionalRoot = region([glyph('one', '1', 29, 19, 7, 4), glyph('two', '2', 29, 29, 7, 4)],
  [...rootPath('root', 10, 8, 28, 23), { id: 'bar', thin: true, rect: { x: 27, y: 21.8, width: 8, height: .4 } }]);
const fractionalAst = inferMathAst(fractionalRoot); assert.equal(fractionalAst.type, 'radical'); assert.equal(fractionalAst.radicand.type, 'fraction');
const rootInFraction = region([glyph('x', 'x', 20, 18, 7, 4), glyph('d', '2', 20, 35, 10, 6)],
  [...rootPath('root', 12, 8, 20, 10), { id: 'bar', thin: true, rect: { x: 9, y: 23.8, width: 26, height: .4 } }]);
const rootFractionAst = inferMathAst(rootInFraction); assert.equal(rootFractionAst.type, 'fraction'); assert.equal(rootFractionAst.numerator.type, 'radical');
const nested = region([glyph('x', 'x', 35, 32, 8, 4)], [...rootPath('outer', 5, 5, 45, 29), ...rootPath('inner', 25, 19, 16, 13)]);
const nestedAst = inferMathAst(nested); assert.equal(nestedAst.type, 'radical'); assert.equal(nestedAst.radicand.type, 'radical');
for (const change of [value => { value.mathStrokes[0].path.complete = false; }, value => { value.mathStrokes[0].path.paint = 'fillStroke'; },
  value => { value.mathStrokes[0].path.color = 'FF0000'; }, value => { value.mathStrokes[1].path.from = [value.mathStrokes[1].path.from[0] + 1, value.mathStrokes[1].path.from[1]]; },
  value => { value.mathStrokes.pop(); }, value => { value.mathGlyphs[0].rect.x = 70; }]) {
  const invalid = structuredClone(simple); change(invalid); assert.equal(inferMathAst(invalid), null, 'uncertain or unowned shapes remain images');
}
assert(!validateMathEvidence({ ...ast, strokeIds: ['root-0', 'root-1', 'root-2', 'root-2'] }, simple));
assert(!validateMathEvidence({ ...ast, strokeIds: [...ast.strokeIds].reverse() }, simple));
const gray = structuredClone(simple);
gray.mathStrokes.forEach(stroke => { stroke.path.color = '2C2E35'; stroke.color = '2C2E35'; });
gray.mathGlyphs.forEach(glyph => { glyph.color = '2C2E35'; });
assert.equal(inferMathAst(gray).type, 'radical', 'a consistently colored root retains its geometry and original color');
const grayFormula = nativeMath(inferMathAst(gray), gray, { measurementContext: createCanvas(1, 1).getContext('2d') });
const grayXml = await (await JSZip.loadAsync(await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [grayFormula] })] }] })))).file('word/document.xml').async('string');
assert((grayXml.match(/w:color w:val="2C2E35"/g) || []).length >= 2, 'both radical control properties and symbol runs retain source color');
const pdf = await PDFDocument.create(), page = pdf.addPage([100, 80]), font = await pdf.embedFont(StandardFonts.TimesRoman);
page.drawText('x', { x: 17.2, y: 58, size: 8, font });
const points = [simple.mathStrokes[0].path.from, ...simple.mathStrokes.map(item => item.path.to)];
page.pushOperators(pushGraphicsState(), setLineWidth(.25), moveTo(points[0][0], 80 - points[0][1]),
  ...points.slice(1).map(([x, y]) => lineTo(x, 80 - y)), stroke(), popGraphicsState());
const covered = pdf.addPage([100, 80]);
covered.drawText('x', { x: 17.2, y: 58, size: 8, font });
covered.pushOperators(pushGraphicsState(), setLineWidth(.25), moveTo(points[0][0], 80 - points[0][1]),
  ...points.slice(1).map(([x, y]) => lineTo(x, 80 - y)), stroke(), moveTo(16, 60), lineTo(24, 60), stroke(), popGraphicsState());
const task = getDocument({ data: await pdf.save(), fontExtraProperties: true, verbosity: 0,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' });
try {
  const source = await (await task.promise).getPage(1), snapshot = await snapshotPage(source, OPS), canvas = createCanvas(1, 1);
  await renderPage(source, canvas, {}); snapshot.fonts = snapshotFonts(source, snapshot.fontIds);
  const scene = buildPageScene(snapshot), image = scene.items.find(item => item.role === 'math');
  assert(image); assert.equal(image.mathStrokes.length, 4); assert(image.mathStrokes.every(item => item.path.complete));
  assert(image.mathGlyphs.every(item => !item.raster), 'empty space beside a root diagonal does not falsely hide the radicand');
  assert.equal(inferMathAst(image).type, 'radical', 'actual PDF drawing paths survive scene/grouping and become source-bound radical evidence');
  const hiddenPage = await (await task.promise).getPage(2), hiddenSnapshot = await snapshotPage(hiddenPage, OPS);
  await renderPage(hiddenPage, canvas, {}); hiddenSnapshot.fonts = snapshotFonts(hiddenPage, hiddenSnapshot.fontIds);
  const hiddenScene = buildPageScene(hiddenSnapshot), obscured = hiddenScene.items.find(item => item.role === 'math');
  assert(obscured?.mathGlyphs.some(item => item.raster)); assert.equal(inferMathAst(obscured), null,
    'a stroke that actually crosses the symbol must still block native reconstruction');
} finally { await task.destroy(); }
const output = 'tmp/pdf-word-math/native-math'; await mkdir(output, { recursive: true });
const samples = [simple, indexed, fractionalRoot, rootInFraction, nested];
const doc = new Document({ sections: [{ children: samples.map(sample => new Paragraph({
  children: [nativeMath(inferMathAst(sample), sample)], run: { size: 24 }, spacing: { after: 240 }
})) }] });
const bytes = await Packer.toBuffer(doc); await writeFile(`${output}/radicals.docx`, bytes);
const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string');
assert.equal((xml.match(/<m:rad>/g) || []).length, 6); assert(xml.includes('<m:degHide'));
assert(!xml.includes('<w:drawing>'), 'root constructs are native OMML, not overlay pictures');
console.log('Radical checks passed: complete path evidence, index, nesting, fraction composition, ambiguity rejection, real PDF and native OMML.');
