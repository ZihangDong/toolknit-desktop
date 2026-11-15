import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts, PDFArray, PDFNumber, PDFOperator, beginText, endText,
  pushGraphicsState, popGraphicsState, setFontAndSize, setTextMatrix, setCharacterSqueeze } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import { recoverMathLetters } from '../src/features/pdf-to-word/adapters/math-text.js';
import { hasLinearNativeMathRun, hasCompoundNativeMathRun, completeMathGlyphPositions } from '../src/features/pdf-to-word/core/math-limit-runs.js';
import { buildPageScene } from '../src/features/pdf-to-word/core/scene.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { snapshotPage, snapshotFonts, renderPage } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { resultTargets, layoutEditedText, applyResultEdits } from '../src/features/pdf-to-word/core/result-edit.js';
import { measureResultText } from '../src/features/pdf-to-word/result-preview.js';
import { positionedTextItems } from '../src/features/pdf-to-word/adapters/text-layout.js';

const context = createCanvas(1, 1).getContext('2d');
for (const value of ['197×', '10×20', '7÷2']) assert(hasLinearNativeMathRun(value, 'ABCDEF+TimesNewRomanPSMT'));
for (const [value, face] of [['197×年', 'TimesNewRomanPSMT'], ['10×20', 'Arial'], ['×÷', 'TimesNewRomanPSMT'], ['10²', 'TimesNewRomanPSMT']])
  assert(!hasLinearNativeMathRun(value, face), 'unknown faces, mixed prose, scripts and operator-only spans do not gain a native trace');
const union = rects => {
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
  return { x, y, width: Math.max(...rects.map(r => r.x + r.width)) - x, height: Math.max(...rects.map(r => r.y + r.height)) - y };
};
function run(text, font, italic, x, id, paintFont = italic ? 'Cambria Math' : 'Times New Roman') {
  const size = 11, baseline = 60, positions = []; let offset = 0, spaceBefore = false;
  context.font = `${italic ? 'italic ' : ''}1000px "${paintFont}"`;
  context.fontKerning = 'none';
  for (const character of text) {
    if (character === ' ') { x += 3.25; offset++; spaceBefore = true; continue; }
    const m = context.measureText(character), advanceWidth = m.width * size / 1000;
    const rect = { x: x - m.actualBoundingBoxLeft * size / 1000, y: baseline - m.actualBoundingBoxAscent * size / 1000,
      width: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * size / 1000,
      height: (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * size / 1000 };
    positions.push({ text: character, sourceOffset: offset++, rect, baseline, baselineX: x, advanceWidth, spaceBefore });
    x += advanceWidth + .3; spaceBefore = false;
  }
  return { id, text, font, italic, size, baseline, rect: union(positions.map(p => p.rect)), color: '000000', bold: false,
    raster: false, preciseInk: true, ...(positions.length > 1 ? { mathGlyphPositions: positions } : {}) };
}
function fresh() {
  const a = run('H', 'ABCDEF+CMMI10', true, 30, 'p1:t1');
  const b = run('= 1024', 'ABCDEF+CMR10', false, a.rect.x + a.rect.width + 2, 'p1:t2');
  const glyphs = [a, b], rect = union(glyphs.map(g => g.rect));
  return { number: 1, width: 500, height: 200, rules: [], risks: ['math-image'], characters: 7,
    sources: glyphs.map(g => ({ id: g.id, text: g.text, rect: { ...g.rect }, disposition: 'visible-image' })),
    items: [{ id: 'math', type: 'image', role: 'math', rect, order: 1, sourceIds: glyphs.map(g => g.id),
      mathGlyphs: glyphs, mathStrokes: [], drawingIds: [], reasons: [] }] };
}
const scene = fresh(), original = structuredClone(scene);
recoverMathLetters(scene, context);
assert.equal(scene.items.map(item => item.text).join(''), 'H= 1024');
assert(scene.items.every(item => item.type === 'text'));
assert.deepEqual(scene.sources, original.sources.map(source => ({ ...source, disposition: 'editable' })));
assert.deepEqual(scene.items[1].words.map(word => word.rect), original.items[0].mathGlyphs[1].mathGlyphPositions.map(part => part.rect));
assert.deepEqual(scene.items[1].words.map(word => word.sourceOffset), [0, 2, 3, 4, 5]);
assert.equal(scene.items[1].font, 'Times New Roman');
assert(scene.items[0].italic && scene.items[0].font === 'Cambria');
for (const value of ['197×', '10×20', '7÷2']) {
  const glyph = run(value, 'ABCDEF+TimesNewRomanPSMT', false, 30, 'operator-run');
  const test = { number: 1, width: 500, height: 200, rules: [], risks: ['math-image'], characters: value.length,
    sources: [{ id: glyph.id, text: value, rect: { ...glyph.rect }, disposition: 'visible-image' }],
    items: [{ id: 'operator-image', type: 'image', role: 'math', rect: { ...glyph.rect }, order: 1,
      sourceIds: [glyph.id], mathGlyphs: [glyph], mathStrokes: [], drawingIds: [], reasons: [] }] };
  const noTrace = structuredClone(test); delete noTrace.items[0].mathGlyphs[0].mathGlyphPositions;
  const frozen = structuredClone(noTrace); recoverMathLetters(noTrace, context); assert.deepEqual(noTrace, frozen, 'mixed numeric/operator run still requires complete source positions');
  recoverMathLetters(test, context);
  assert.equal(test.items[0].type, 'text'); assert.equal(test.items[0].text, value);
  assert.deepEqual(test.items[0].words.map(w => w.rect), glyph.mathGlyphPositions.map(p => p.rect));
  const output = await createWordBytes(inferDocument([test], { preserveGeometry: true }), [], { preserveGeometry: true, measurementContext: context });
  const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
  assert(!xml.includes('<w:drawing') && !xml.includes('<m:oMath'), 'flat original multiplication/division stays ordinary editable text');
  assert(value.split('').every(c => xml.includes('>' + c + '</w:t>')));
}

function temperature() {
  let x = 30;
  const glyphs = [
    ['10°', 'ABCDEF+XITSMath-Regular', 'Cambria Math'], ['C', 'ABCDEF+TimesNewRomanPSMT', 'Times New Roman'],
    ['～', 'ABCDEF+SimSun', 'SimSun'], ['20°', 'ABCDEF+XITSMath-Regular', 'Cambria Math'], ['C', 'ABCDEF+TimesNewRomanPSMT', 'Times New Roman'],
  ].map(([text, font, paintFont], index) => {
    const glyph = run(text, font, false, x, 'range:' + index, paintFont); x = glyph.rect.x + glyph.rect.width + 2; return glyph;
  });
  return { number: 1, width: 500, height: 200, rules: [], risks: ['math-image'], characters: 9,
    sources: glyphs.map(g => ({ id: g.id, text: g.text, rect: { ...g.rect }, disposition: 'visible-image' })),
    items: [{ id: 'temperature-image', type: 'image', role: 'math', rect: union(glyphs.map(g => g.rect)), order: 1,
      sourceIds: glyphs.map(g => g.id), mathGlyphs: glyphs, mathStrokes: [], drawingIds: [], reasons: [] }] };
}
const units = temperature(), sourceUnits = structuredClone(units);
recoverMathLetters(units, context);
assert.equal(units.items.map(item => item.text).join(''), '10°C～20°C');
assert(units.items.every(item => item.type === 'text') && units.sources.every(source => source.disposition === 'editable'));
assert.equal(units.items[2].font, 'SimSun');
for (const index of [0, 3]) assert.deepEqual(units.items[index].words.map(w => w.rect), sourceUnits.items[0].mathGlyphs[index].mathGlyphPositions.map(p => p.rect));
const repeatedUnits = structuredClone(units); recoverMathLetters(units, context); assert.deepEqual(units, repeatedUnits);
const unitOutput = await createWordBytes(inferDocument([units], { preserveGeometry: true }), [], { preserveGeometry: true, measurementContext: context });
const unitXml = await (await JSZip.loadAsync(unitOutput.bytes)).file('word/document.xml').async('string');
assert(!unitXml.includes('<w:drawing') && !unitXml.includes('<m:oMath'));
assert(unitXml.includes('>°</w:t>') && unitXml.includes('>～</w:t>'));
for (const mutate of [
  s => { delete s.items[0].mathGlyphs[0].mathGlyphPositions; },
  s => { s.items[0].mathGlyphs[3].mathGlyphPositions[1].sourceOffset = 0; },
  s => { s.items[0].mathGlyphs[2].font = 'UnknownFace'; },
  s => { s.items[0].mathGlyphs[0].font = 'ABCDEF+TimesNewRomanPSMT'; },
  s => { s.items[0].mathGlyphs[1].text = s.sources[1].text = 'F'; },
  s => { s.items[0].mathGlyphs[1].bold = true; },
  s => { s.items[0].mathGlyphs[2].italic = true; },
  s => { s.items[0].mathGlyphs[2].baseline += 1; },
  s => { s.items[0].mathGlyphs[2].color = 'FF0000'; },
  s => { s.items[0].mathGlyphs[2].raster = true; },
  s => { s.items[0].mathGlyphs[2].ocr = true; },
  s => { s.items[0].sourceIds[2] = s.items[0].sourceIds[1]; },
  s => { s.sources[2].text = 'wrong'; },
  s => { s.items[0].mathStrokes = [{ id: 'rule' }]; },
]) {
  const rejected = temperature(); mutate(rejected); const frozen = structuredClone(rejected);
  recoverMathLetters(rejected, context); assert.deepEqual(rejected, frozen, 'unit recovery needs complete native face/ink/ownership/trace evidence');
}
for (const fillers of [505, 490]) {
  const limited = temperature(), legacy = fresh();
  limited.items.push(...legacy.items, ...Array.from({ length: fillers }, () => ({ type: 'text', text: 'x', rect: { x: 10, y: 100, width: 5, height: 10 } })));
  limited.sources.push(...legacy.sources); recoverMathLetters(limited, context);
  assert(limited.sources.filter(s => s.id.startsWith('p1:')).every(s => s.disposition === 'editable'), 'earlier unit ranges cannot spend existing linear fragments\' frame allowance');
  assert(limited.sources.filter(s => s.id.startsWith('range:')).every(s => s.disposition === (fillers === 490 ? 'editable' : 'visible-image')),
    'unit ranges use only the remaining frame allowance');
}
console.log('Native temperature ranges: complete original traces, distinct text faces, ordinary DOCX, atomic refusal and legacy frame priority passed.');

function mapping() {
  const arrow = run('⇒', 'ABCDEF+XITSMath-Regular', false, 30, 'mapping-arrow', 'Cambria Math');
  const opening = run('(', 'ABCDEF+TimesNewRomanPSMT', false, arrow.rect.x + arrow.rect.width + 2, 'mapping-open');
  const glyphs = [arrow, opening]; let x = opening.rect.x + opening.rect.width + 1;
  const suffix = [['张昆等', 'SimSun'], [',', 'TimesNewRomanPSMT'], ['1994', 'TimesNewRomanPSMT'], [')', 'TimesNewRomanPSMT']].map(([text, font], index) => {
    const item = { ...run(text, 'ABCDEF+' + font, false, x, 'mapping-tail:' + index, font === 'SimSun' ? 'SimSun' : 'Times New Roman'), type: 'text' };
    delete item.mathGlyphPositions; item.sourceIds = [item.id]; x = item.rect.x + item.rect.width + 1; return item;
  });
  return { number: 1, width: 500, height: 200, rules: [], risks: ['math-image'], characters: 10,
    sources: [...glyphs.map(g => ({ id: g.id, text: g.text, rect: { ...g.rect }, disposition: 'visible-image' })),
      ...suffix.map(g => ({ id: g.id, text: g.text, rect: { ...g.rect }, disposition: 'editable' }))],
    items: [{ id: 'mapping-image', type: 'image', role: 'math', rect: union(glyphs.map(g => g.rect)), order: 1,
      sourceIds: glyphs.map(g => g.id), mathGlyphs: glyphs, mathStrokes: [], drawingIds: [], reasons: [] }, ...suffix] };
}
const mapped = mapping(), unmapped = structuredClone(mapped);
recoverMathLetters(mapped, context);
assert(mapped.items.every(item => item.type === 'text'));
assert.equal(mapped.items.map(item => item.text).join(''), '⇒(张昆等,1994)');
assert(mapped.sources.every(source => source.disposition === 'editable'));
assert.deepEqual(mapped.items.slice(2), unmapped.items.slice(1), 'the adjacent citation is evidence only and stays byte-for-byte owned');
const mappingDocument = inferDocument([mapped], { preserveGeometry: true });
const mappingOutput = await createWordBytes(mappingDocument, [], { preserveGeometry: true, measurementContext: context });
const mappingXml = await (await JSZip.loadAsync(mappingOutput.bytes)).file('word/document.xml').async('string');
assert(!mappingXml.includes('<w:drawing') && !mappingXml.includes('<m:oMath'));
assert(mappingXml.includes('>⇒</w:t>') && mappingXml.includes('>(</w:t>'));
const mappedAgain = structuredClone(mapped); recoverMathLetters(mapped, context); assert.deepEqual(mapped, mappedAgain);
for (const mutate of [
  s => { s.items.pop(); s.sources.pop(); },
  s => { s.items[4].text = s.sources.at(-1).text = ']'; },
  s => { s.items[3].text = s.sources[4].text = 'year'; },
  s => { s.items[1].text = s.sources[2].text = '(张昆等'; },
  s => { s.items[1].font = 'UnknownFace'; },
  s => { s.items[1].bold = true; },
  s => { s.items[2].color = 'FF0000'; },
  s => { s.items[1].raster = true; },
  s => { s.items[1].ocr = true; },
  s => { s.items[1].rect.x += 20; s.sources[2].rect.x += 20; },
  s => { s.items[1].baseline += 1; },
  s => { s.items[1].size -= 1; },
  s => { s.sources[2].text = 'wrong'; },
  s => { s.items[2].sourceIds = s.items[1].sourceIds; },
  s => { s.items.push({ ...structuredClone(s.items[1]), id: 'duplicate', sourceIds: ['duplicate'] });
    s.sources.push({ ...structuredClone(s.sources[2]), id: 'duplicate' }); },
  s => { s.items.push({ id: 'cover', type: 'image', rect: { ...s.items[2].rect }, sourceIds: [] }); },
  s => { const x = structuredClone(s.items[2]); x.baseline -= 3; x.id = 'raised'; s.items.push(x); },
  s => { s.items[0].mathGlyphs[0].font = 'UnknownFace'; },
  s => { s.items[0].mathGlyphs[1].font = 'ABCDEF+SimSun'; },
  s => { s.items[0].mathGlyphs[0].raster = true; },
  s => { s.items[0].drawingIds = ['drawing']; },
  s => { s.sources[0].text = 'wrong'; },
  s => { s.items.push(...Array.from({ length: 20000 }, () => ({ type: 'text', text: 'x', rect: { x: 10, y: 100, width: 5, height: 10 } }))); },
]) {
  const rejected = mapping(); mutate(rejected); const frozen = structuredClone(rejected);
  recoverMathLetters(rejected, context); assert.deepEqual(rejected, frozen, 'mapping recovery refuses incomplete/ambiguous/interrupted native rows atomically');
}
for (const fillers of [506, 490]) {
  const limited = mapping(), legacy = fresh();
  const legacyGlyph = legacy.items[0].mathGlyphs[0];
  Object.assign(legacy.items[0], { mathGlyphs: [legacyGlyph], sourceIds: [legacyGlyph.id], rect: { ...legacyGlyph.rect } });
  legacy.sources = legacy.sources.slice(0, 1);
  limited.items.push(...legacy.items, ...Array.from({ length: fillers }, () => ({ type: 'text', text: 'x', rect: { x: 10, y: 100, width: 5, height: 10 } })));
  limited.sources.push(...legacy.sources); recoverMathLetters(limited, context);
  assert(limited.sources.filter(s => s.id.startsWith('p1:')).every(s => s.disposition === 'editable'));
  assert(limited.sources.filter(s => ['mapping-arrow', 'mapping-open'].includes(s.id)).every(s => s.disposition === (fillers === 490 ? 'editable' : 'visible-image')),
    'mapping prefixes consume only frames remaining after previously supported native runs');
}
console.log('Native mapping prefixes: complete adjacent source citation, no copied suffix, actual DOCX, atomic negative controls and legacy priority passed.');

// Independent native ink dimensions for a letter plus membership operator.
// Office's measured exact-line baseline is 80% of the serialized line height;
// a Canvas hhea center placed the operator more than 1pt below this source ink.
{
  const glyphs = [
    { id: 'letter', text: 'W', font: 'ABCDEF+CMMI10', italic: true,
      rect: { x: 30, y: 52.5491, width: 10.8327, height: 7.6909 } },
    { id: 'member', text: '∈', font: 'ABCDEF+CMSY10', italic: false,
      rect: { x: 47.4785, y: 54.1091, width: 5.4546, height: 6.3273 } },
  ].map(g => ({ ...g, size: 10.9091, baseline: 60, color: '000000', bold: false, raster: false, preciseInk: true }));
  const scene = { number: 1, width: 300, height: 200, rules: [], risks: ['math-image'], characters: 2,
    sources: glyphs.map(g => ({ id: g.id, text: g.text, rect: { ...g.rect }, disposition: 'visible-image' })),
    items: [{ id: 'native-row', type: 'image', role: 'math', order: 1, rect: union(glyphs.map(g => g.rect)),
      sourceIds: glyphs.map(g => g.id), mathGlyphs: glyphs, mathStrokes: [], drawingIds: [], reasons: [] }] };
  recoverMathLetters(scene, context);
  assert.equal(scene.items.length, 2);
  assert.equal(scene.items[0].font, 'Cambria', 'ordinary italic letters use a real italic face');
  assert.equal(scene.items[1].font, 'Cambria Math', 'membership keeps its actual symbol font');
  const document = inferDocument([scene], { preserveGeometry: true });
  const output = await createWordBytes(document, [], { preserveGeometry: true, measurementContext: context });
  const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
  const paragraph = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].find(match => match[0].includes('>∈</w:t>'))?.[0];
  assert(paragraph && !paragraph.includes('<w:drawing'));
  const frame = paragraph.match(/<w:framePr\b[^>]*\bw:y="(-?\d+)"/);
  const leading = paragraph.match(/<w:spacing\b[^>]*\bw:line="(\d+)"/);
  const position = [...paragraph.matchAll(/<w:position w:val="(-?\d+)"/g)].at(-1)?.[1] || 0;
  assert(frame && leading);
  const item = scene.items[1];
  context.font = '1000px "Cambria Math"';
  const m = context.measureText('∈');
  const physicalTop = Number(frame[1]) / 20 + .8 * Number(leading[1]) / 20 - Number(position) / 2
    - m.actualBoundingBoxAscent * item.size / 1000;
  assert(Math.abs(physicalTop - glyphs[1].rect.y) <= .3,
    'actual frame, line height and half-point run position preserve the operator ink top');
}
const again = structuredClone(scene); recoverMathLetters(scene, context); assert.deepEqual(scene, again);
const reordered = fresh(), reorderedBefore = structuredClone(reordered);
reordered.items[0].mathGlyphs.reverse();
recoverMathLetters(reordered, context);
assert(reordered.items.every(item => item.type === 'text'), 'native flat glyphs use physical order, not discovery order');
assert.deepEqual(reordered.items, scene.items);
assert.deepEqual(reordered.sources, reorderedBefore.sources.map(source => ({ ...source, disposition: 'editable' })));
const document = inferDocument([scene], { preserveGeometry: true });
const options = { preserveGeometry: true, editableMath: true, strictMathGeometry: true, measurementContext: context };
const output = await createWordBytes(document, [], options);
const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
assert(!xml.includes('<w:drawing') && !xml.includes('<m:oMath'));
assert(xml.includes('>H</w:t>') && xml.includes('>4</w:t>'));
assert.equal(output.quality.nativeFormulas, 0);
const measure = (text, style) => measureResultText(text, style, context);
measure.metrics = (text, style) => measureResultText.metrics(text, style, context);
const target = resultTargets(document.pages[0]).find(item => item.type === 'text');
target.container = { x: 0, y: 0, width: 500, height: 200 };
assert.deepEqual(layoutEditedText(target, target.text, measure, { page: document.pages[0] }), { type: 'noop' });
const edit = layoutEditedText(target, target.text + '7', measure, { page: document.pages[0] });
assert(edit.lines?.length && edit.lines.flatMap(line => line.items).every(item => ['Times New Roman', 'Cambria'].includes(item.font)));
const edited = applyResultEdits(document, { [target.key]: edit });
assert(resultTargets(edited.pages[0]).some(item => item.text.endsWith('7')));
await createWordBytes(edited, [], options);
assert.deepEqual(document.pages[0].sources, scene.sources, 'editing leaves original source identities intact');

for (const mutate of [
  s => { delete s.items[0].mathGlyphs[1].mathGlyphPositions; },
  s => { s.items[0].mathGlyphs[1].mathGlyphPositions.pop(); },
  s => { s.items[0].mathGlyphs[1].mathGlyphPositions[1].sourceOffset = 0; },
  s => { s.items[0].mathGlyphs[1].mathGlyphPositions[1].baselineX = 0; },
  s => { s.items[0].mathGlyphs[1].mathGlyphPositions[1].rect.x += 100; },
  s => { s.items[0].mathGlyphs[1].baseline += 1; },
  s => { s.items[0].mathGlyphs[1].size /= 2; },
  s => { s.items[0].mathGlyphs[1].font = 'UnknownFace'; },
  s => { s.items[0].mathGlyphs[1].ocr = true; },
  s => { s.items[0].mathGlyphs[1].raster = true; },
  s => { s.items[0].mathGlyphs[1].mathStyleUncertain = true; },
  s => { s.items[0].sourceIds[1] = s.items[0].sourceIds[0]; },
  s => { s.sources[1].text = 'wrong'; },
  s => { s.items[0].mathStrokes = [{ id: 'fraction' }]; },
  s => { s.items[0].drawingIds = ['drawing']; },
  s => { s.items[0].backgroundPaintIndexes = [0]; },
  s => { s.rasterPage = true; },
  s => { const g = s.items[0].mathGlyphs[1]; g.text = '(1024'; s.sources[1].text = g.text; },
  s => { s.items.push(...Array.from({ length: 256 }, () => ({ type: 'text', preciseInk: true, text: '甲，乙', rect: { x: 10, y: 100, width: 30, height: 10 },
    words: ['甲', '，', '乙'].map((text, index) => ({ text, size: 11, baselineX: [10, 20, 25][index], rect: { x: [10, 20, 25][index], y: 100, width: 5, height: 10 } })) }))); },
]) {
  const rejected = fresh(); mutate(rejected); const before = structuredClone(rejected);
  recoverMathLetters(rejected, context);
  assert.deepEqual(rejected, before, 'bad traces, 2D/uncertain sources and exceeded object budgets refuse atomically');
}
for (const text of ['≤', '−∞']) {
  const rejected = fresh(), g = rejected.items[0].mathGlyphs[0];
  Object.assign(g, { text, font: 'ABCDEF+CMSY10', italic: false });
  Object.assign(rejected.items[0], { mathGlyphs: [g], sourceIds: [g.id], rect: { ...g.rect } });
  rejected.sources = [{ id: g.id, text, rect: { ...g.rect }, disposition: 'visible-image' }];
  const before = structuredClone(rejected); recoverMathLetters(rejected, context); assert.deepEqual(rejected, before);
}
const sharedBudget = fresh(), next = fresh();
next.sources.forEach(source => { source.id += ':second'; });
next.items[0].sourceIds = next.sources.map(source => source.id);
next.items[0].id += ':second'; next.items[0].mathGlyphs.forEach(glyph => { glyph.id += ':second'; });
sharedBudget.items.push(next.items[0], ...Array.from({ length: 501 }, () => ({ type: 'text', text: 'x', rect: { x: 10, y: 100, width: 5, height: 10 } })));
sharedBudget.sources.push(...next.sources);
recoverMathLetters(sharedBudget, context);
assert(sharedBudget.sources.slice(0, 2).every(source => source.disposition === 'editable'));
assert(sharedBudget.sources.slice(2).every(source => source.disposition === 'visible-image'), 'later candidates cannot spend the same remaining frames twice');
assert(sharedBudget.items.some(item => item.id === 'math:second' && item.type === 'image'));
const naturalWords = fresh();
naturalWords.items.push(...Array.from({ length: 200 }, () => ({ type: 'text', preciseInk: true, text: 'natural words', rect: { x: 10, y: 100, width: 30, height: 10 },
  words: [{ text: 'natural' }, { text: 'words' }, { text: 'remain' }] })));
recoverMathLetters(naturalWords, context);
assert(naturalWords.sources.every(source => source.disposition === 'editable'), 'ordinary in-frame words do not consume independent frame slots');
for (const text of ['= 1024', '(123)', '()']) assert(hasLinearNativeMathRun(text, 'ABCDEF+CMR10'));
for (const text of ['regular prose', '1+2'.repeat(50), '−∞', '(a)', 'x²']) assert(!hasLinearNativeMathRun(text, 'ABCDEF+CMR10'));
assert(!hasCompoundNativeMathRun('= 1024', 'ABCDEF+CMR10'), 'placement traces do not expand the AST splitter');
assert(!hasLinearNativeMathRun('1+20', 'UnknownFace'));
assert.equal(completeMathGlyphPositions({ text: '=123', rect: { x: 0, y: 0, width: 10, height: 10 }, baseline: 10, mathGlyphPositions: [null, null] }), null);

// Real PDF operators/outlines, not just hand-authored provenance. Sixty short
// runs exceed the 200-position additional per-page trace allowance.
const source = await PDFDocument.create(), font = await source.embedFont(StandardFonts.TimesRoman);
const pdfPage = source.addPage([300, 900]);
pdfPage.drawText('197×', { x: 30, y: 880, size: 10, font });
for (let index = 0; index < 60; index++) pdfPage.drawText('1+20', { x: 30, y: 850 - index * 12, size: 10, font });
const sparePage = source.addPage([300, 900]);
sparePage.drawText('197×', { x: 30, y: 880, size: 10, font });
for (let index = 0; index < 49; index++) sparePage.drawText('1+20', { x: 30, y: 850 - index * 12, size: 10, font });
const spanPage = source.addPage([320, 400]);
const spanFont = spanPage.node.newFontDictionary('SourceTimes', font.ref);
const spanCases = [
  { text: '2018a', prefix: -420, suffix: -300 },
  { text: '2024', prefix: 100, suffix: 0 },
  { text: '2026', prefix: 0, suffix: 0 },
  { text: '  2025  ', prefix: -420, suffix: -300, literalSpaces: true },
  { text: '2018 a', prefix: -420, suffix: -300, multipleWords: true },
  { text: '2018a', prefix: -100, suffix: -80, inner: -50 },
  { text: '2018a', prefix: -420, suffix: -300, matrixScale: 1.15, squeeze: 80 },
  { text: '  2025  ', prefix: 0, suffix: 0, literalSpaces: true },
];
for (const [index, sample] of spanCases.entries()) {
  const tj = PDFArray.withContext(source.context); tj.push(PDFNumber.of(sample.prefix));
  if (sample.inner) {
    tj.push(font.encodeText('20')); tj.push(PDFNumber.of(sample.inner)); tj.push(font.encodeText('18a'));
  } else tj.push(font.encodeText(sample.text));
  tj.push(PDFNumber.of(sample.suffix));
  spanPage.pushOperators(pushGraphicsState(), beginText(), setFontAndSize(spanFont, 10),
    setTextMatrix(sample.matrixScale || 1, 0, 0, 1, 40, 340 - index * 40), setCharacterSqueeze(sample.squeeze || 100),
    PDFOperator.of('TJ', [tj]), endText(), popGraphicsState());
}
const task = getDocument({ data: await source.save(), fontExtraProperties: true, verbosity: 0,
  standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/', cMapUrl: 'node_modules/pdfjs-dist/cmaps/', cMapPacked: true, wasmUrl: 'node_modules/pdfjs-dist/wasm/' });
const canvas = createCanvas(1, 1);
try {
  const pdf = await task.promise, page = await pdf.getPage(1), optionalContentConfig = await pdf.getOptionalContentConfig({ intent: 'display' });
  const snapshot = await snapshotPage(page, OPS, () => {}, optionalContentConfig);
  await renderPage(page, canvas, { optionalContentConfig }); snapshot.fonts = snapshotFonts(page, snapshot.fontIds);
  const parsed = buildPageScene(snapshot, { traceTypography: true });
  const glyphs = parsed.items.flatMap(item => item.mathGlyphs || [item]).filter(glyph => glyph.text === '1+20');
  assert.equal(glyphs.length, 60);
  assert.equal(glyphs.reduce((sum, glyph) => sum + (glyph.mathGlyphPositions?.length || 0), 0), 200);
  assert.deepEqual(glyphs[0].mathGlyphPositions.map(part => part.text), ['1', '+', '2', '0']);
  assert(completeMathGlyphPositions(glyphs[0]));
  assert.equal(glyphs.at(-1).mathGlyphPositions, undefined);
  const newlySupported = parsed.items.flatMap(item => item.mathGlyphs || [item]).find(g => g.text === '197×');
  assert.equal(newlySupported.mathGlyphPositions, undefined, 'new operator traces cannot consume the allowance of existing supported rows');
  page.cleanup();
  const spare = await pdf.getPage(2), spareSnapshot = await snapshotPage(spare, OPS, () => {}, optionalContentConfig);
  await renderPage(spare, canvas, { optionalContentConfig }); spareSnapshot.fonts = snapshotFonts(spare, spareSnapshot.fontIds);
  const spareScene = buildPageScene(spareSnapshot, { traceTypography: true });
  const spareGlyphs = spareScene.items.flatMap(item => item.mathGlyphs || [item]);
  assert.equal(spareGlyphs.reduce((sum, glyph) => sum + (glyph.mathGlyphPositions?.length || 0), 0), 200);
  assert.equal(spareGlyphs.filter(glyph => glyph.text === '1+20' && completeMathGlyphPositions(glyph)).length, 49);
  assert.deepEqual(spareGlyphs.find(glyph => glyph.text === '197×').mathGlyphPositions.map(part => part.text), ['1', '9', '7', '×'],
    'new operators use the remaining four positions after all previous supported rows');
  const untracedSpare = buildPageScene(spareSnapshot, { traceTypography: false });
  assert(untracedSpare.items.flatMap(item => item.mathGlyphs || [item]).every(glyph => !glyph.mathGlyphPositions),
    'deferred traces are disabled when typography tracing is disabled');
  spare.cleanup();
  const page2 = await pdf.getPage(3), content = await snapshotPage(page2, OPS, () => {}, optionalContentConfig);
  await renderPage(page2, canvas, { optionalContentConfig }); content.fonts = snapshotFonts(page2, content.fontIds);
  const spans = buildPageScene(content, { traceTypography: true });
  const untraced = buildPageScene(content, { traceTypography: false });
  for (const [index, sample] of spanCases.entries()) {
    const find = scene => scene.items.find(item => item.text?.trim() === sample.text.trim() && Math.abs(item.baseline - (60 + index * 40)) < .01);
    const item = find(spans), raw = find(untraced), factor = (sample.matrixScale || 1) * (sample.squeeze || 100) / 100;
    assert(item?.preciseInk && raw, JSON.stringify({ index, expected: sample.text,
      actual: spans.items.map(item => ({ text: item.text, baseline: item.baseline, preciseInk: item.preciseInk, role: item.role })) }));
    const visibleWidth = font.widthOfTextAtSize(sample.text, 10) - (sample.inner || 0) * .01;
    assert.equal(item.baselineX, raw.baselineX, 'the original command span is retained');
    assert.equal(item.advanceWidth, raw.advanceWidth);
    const leaves = positionedTextItems({ items: [item] });
    if (sample.multipleWords) {
      assert.equal(leaves.length, 2);
      assert(Math.abs(leaves[0].baselineX - (40 - sample.prefix * .01)) < .001);
    } else if (sample.literalSpaces && !sample.prefix && !sample.suffix) {
      assert.equal(leaves[0], item, 'literal whitespace alone does not change the historical source span');
    } else {
      const leadingSpaces = sample.text.length - sample.text.trimStart().length;
      const wordStart = 40 - sample.prefix * .01 * factor + font.widthOfTextAtSize(' '.repeat(leadingSpaces), 10) * factor;
      assert(Math.abs(leaves[0].baselineX - wordStart) < .001,
        'the first visible glyph, not leading TJ motion, starts a singleton text span');
      const trimmedWidth = sample.literalSpaces ? font.widthOfTextAtSize(sample.text.trim(), 10) : visibleWidth;
      assert(Math.abs(leaves[0].advanceWidth - trimmedWidth * factor) < .001,
        'non-text prefix/suffix motion cannot be distributed through a visible word');
    }
    assert.deepEqual(item.rect, raw.rect, 'visible ink and source text are never rewritten');
    assert.equal(item.text, raw.text, 'literal and parser-generated whitespace remains in the logical source');
  }
  const single = spans.items.find(item => item.words?.length === 1);
  for (const change of [
    item => { item.ocr = true; }, item => { item.raster = true; },
    item => { item.words[0].text = 'unrelated'; }, item => { item.words[0].baselineX = NaN; },
    item => { item.words[0].advanceWidth = 0; }, item => { item.words[0].rect.x += 100; },
    item => { delete item.rect; },
  ]) {
    const invalid = structuredClone(single); change(invalid);
    assert.equal(positionedTextItems({ items: [invalid] })[0], invalid, 'incomplete or unrelated singleton evidence keeps the original run');
  }
  const spanDocument = inferDocument([spans], { preserveGeometry: true });
  const spanOutput = await createWordBytes(spanDocument, [], options);
  const spanXml = await (await JSZip.loadAsync(spanOutput.bytes)).file('word/document.xml').async('string');
  assert(spanXml.includes('>2024</w:t>') && spanXml.includes('>2026</w:t>'));
  assert(!spanXml.includes('<w:drawing'));
  const spanTarget = resultTargets(spanDocument.pages[0]).find(target => target.type === 'text' && target.text.trim() === '2018a');
  assert(spanTarget);
  spanTarget.container = { x: 0, y: 0, width: 320, height: 400 };
  assert.deepEqual(layoutEditedText(spanTarget, spanTarget.text, measure, { page: spanDocument.pages[0] }), { type: 'noop' });
  const spanEdit = layoutEditedText(spanTarget, spanTarget.text.trimEnd() + '123', measure, { page: spanDocument.pages[0] });
  assert(spanEdit.lines.flatMap(line => line.items).every(item => item.size === 10 && item.font === 'Times-Roman'));
  await createWordBytes(applyResultEdits(spanDocument, { [spanTarget.key]: spanEdit }), [], options);
  page2.cleanup();
} finally { await task.destroy(); canvas.width = canvas.height = 1; }
console.log('Native visible word spans: real prefix/suffix/internal TJ, literal spaces, multiword text and horizontal transforms passed.');
console.log('Native linear math text: real PDF trace budgets, exact glyph origins, atomic refusal, style-preserving edits and actual DOCX passed.');
