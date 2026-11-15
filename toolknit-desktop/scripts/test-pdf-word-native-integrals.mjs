import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { recoverMathLetters } from '../src/features/pdf-to-word/adapters/math-text.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { MAX_POSITIONED_FRAMES } from '../src/features/pdf-to-word/core/positioned-budget.js';
import { resultTargets, layoutEditedText, applyResultEdits } from '../src/features/pdf-to-word/core/result-edit.js';
import { measureResultText } from '../src/features/pdf-to-word/result-preview.js';

const context = createCanvas(1, 1).getContext('2d');
function fixture(text = '∫') {
  const glyph = { id: 'operator', text, rect: { x: 100, y: 60, width: text === '∫' ? 4.188 : 5.412, height: 13.728 },
    font: 'ABCDEF+XITSMath-Regular', size: 12, baseline: 70.86, color: '000000',
    preciseInk: true, raster: false, bold: false, italic: false };
  return { number: 1, width: 300, height: 200, risks: ['math-image'], rules: [],
    characters: 1, sources: [{ id: glyph.id, text, rect: { ...glyph.rect }, order: 1, disposition: 'visible-image' }],
    items: [{ id: 'operator:image', type: 'image', role: 'math', order: 1, rect: { ...glyph.rect },
      sourceIds: [glyph.id], mathGlyphs: [glyph], mathStrokes: [], drawingIds: [], reasons: [] }] };
}
for (const text of ['∫', '∮']) {
  const scene = fixture(text), before = structuredClone(scene);
  recoverMathLetters(scene, context);
  assert.equal(scene.items[0].type, 'text', 'complete native upright integral symbols become ordinary editable text');
  const item = scene.items[0];
  assert.equal(item.text, text); assert.equal(item.font, 'Cambria Math');
  assert(item.nativeCalibrated && item.preciseInk);
  assert.equal(item.sourceFont, before.items[0].mathGlyphs[0].font);
  assert.equal(item.sourceSize, 12);
  assert.equal(item.size, 12.5);
  assert.equal(item.glyphScale, text === '∫' ? 69 : 87);
  assert.deepEqual(item.rect, before.items[0].rect);
  assert.deepEqual(scene.sources, before.sources.map(s => ({ ...s, disposition: 'editable' })));
  const xml = await (await JSZip.loadAsync((await createWordBytes(inferDocument([scene], { preserveGeometry: true }), [],
    { preserveGeometry: true, measurementContext: context })).bytes)).file('word/document.xml').async('string');
  assert(xml.includes(`>${text}</w:t>`));
  assert(!xml.includes('<w:drawing>') && !xml.includes('<m:oMath>'), 'standalone operator text does not inflate structured formula counts');
  assert(xml.includes('Cambria Math') && xml.includes('w:sz w:val="25"'));
}
for (const change of [
  s => { s.rasterPage = true; }, s => { s.items[0].type = 'text'; }, s => { s.items[0].role = 'decoration'; },
  s => { s.items[0].mathGlyphs.push(structuredClone(s.items[0].mathGlyphs[0])); },
  s => { s.items[0].mathStrokes.push({}); }, s => { s.items[0].drawingIds.push('rule'); },
  s => { s.items[0].reasons.push('clipped'); }, s => { s.items[0].backgroundPaintIndexes = [1]; },
  s => { s.items[0].sourceIds.push('other'); }, s => { s.items[0].order = NaN; },
  s => { s.items[0].rect.width += 1; }, s => { s.sources[0].rect.x += 1; },
  s => { s.sources[0].text = '∮'; }, s => { s.sources[0].disposition = 'editable'; },
  s => { s.sources.push(structuredClone(s.sources[0])); },
  s => { s.items[0].mathGlyphs[0].font = 'UnknownMath'; },
  s => { s.items[0].mathGlyphs[0].font = 'ABCDEF+CMEX10'; },
  s => { s.items[0].mathGlyphs[0].raster = true; }, s => { s.items[0].mathGlyphs[0].preciseInk = false; },
  s => { s.items[0].mathGlyphs[0].ocr = true; }, s => { s.items[0].mathGlyphs[0].bold = true; },
  s => { s.items[0].mathGlyphs[0].italic = true; }, s => { s.items[0].mathGlyphs[0].alphabet = 'script'; },
  s => { s.items[0].mathGlyphs[0].mathStyleUncertain = true; }, s => { s.items[0].mathGlyphs[0].radicalPart = 'root'; },
  s => { s.items[0].mathGlyphs[0].delimiterPart = 'top'; },
  s => { s.items[0].mathGlyphs[0].baseline = NaN; }, s => { s.items[0].mathGlyphs[0].size = 4; },
  s => { s.items[0].mathGlyphs[0].size = 25; }, s => { s.items[0].mathGlyphs[0].color = 'invalid'; },
  s => { s.width = 101; }, s => { s.height = 65; },
  s => { const g = s.items[0].mathGlyphs[0]; g.rect.x = -1; s.items[0].rect.x = -1; s.sources[0].rect.x = -1; },
  s => { s.items.push({ id: 'cover', type: 'image', rect: { ...s.items[0].rect } }); },
  s => { for (let n = 0; n < MAX_POSITIONED_FRAMES; n++) s.items.push({ id: 'frame'+n, type:'text',
    text:'a', rect:{x:200,y:100,width:3,height:8}, size:10, baseline:108 }); },
]) {
  const scene = fixture(); change(scene); const before = structuredClone(scene);
  recoverMathLetters(scene, context);
  assert.deepEqual(scene, before, 'ambiguous, clipped, decorated, scanned, unsupported, overlapping or over-budget symbols refuse atomically');
}
for (const text of ['∑', '∬', '∫x', '∫∮']) {
  const scene = fixture(text), before = structuredClone(scene);
  recoverMathLetters(scene, context); assert.deepEqual(scene, before, 'unknown or compound operators retain their existing path');
}
{
  const scene = fixture(); recoverMathLetters(scene, context);
  const first = scene.items[0], second = { ...structuredClone(first), id: 'second', sourceIds: ['second'], text: '∮', glyphScale: 87,
    rect: { ...first.rect, x: 120, width: 5.412 }, advanceWidth: 6.53668212890625 };
  const comma = { id: 'comma', type: 'text', sourceIds: ['comma'], text: '、', font: 'SimSun', size: 12,
    rect: { x: 110, y: 68.26, width: 2.3, height: 2.3 }, baseline: first.baseline - .024, baselineX: 108,
    preciseInk: true, raster: false, advanceWidth: 12, color: '000000', order: 2 };
  second.order = 3; scene.items.push(comma, second);
  scene.sources.push(...[comma, second].map(i => ({ id: i.id, text: i.text, rect: { ...i.rect }, disposition: 'editable', order: i.order })));
  const doc = inferDocument([scene], { preserveGeometry: true }), page = doc.pages[0], target = resultTargets(page).find(t => t.type === 'text' && t.text.includes('∫'));
  assert(target && target.text.includes('∮'));
  const measure = (text, style) => measureResultText(text, style, context);
  measure.metrics = (text, style) => measureResultText.metrics(text, style, context);
  const edit = layoutEditedText(target, target.text.replace('∫', '∮'), measure, { page });
  const items = edit.lines.flatMap(l => l.items), symbols = items.filter(i => i.text === '∮');
  assert.equal(symbols.length, 2);
  assert.equal(symbols[0].size, first.size); assert.equal(symbols[0].font, first.font);
  assert(Math.abs(symbols[0].rect.y - first.rect.y) < .01, 'changing the symbol preserves the fitted visible baseline, not the substitute font default');
  assert.deepEqual(symbols[1].rect, second.rect, 'an untouched operator after punctuation retains its source anchor across sub-twip baseline differences');
  assert.equal(symbols[1].baseline, second.baseline);
  await createWordBytes(applyResultEdits(doc, { [target.key]: edit }), [], { preserveGeometry: true, measurementContext: context });
}
console.log('Native standalone integrals: complete original glyph ownership, upright XITS shape/spacing, bounded refusal and actual editable DOCX passed.');
