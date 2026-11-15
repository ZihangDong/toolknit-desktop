import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { recoverMathLetters } from '../src/features/pdf-to-word/adapters/math-text.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { resultTargets, layoutEditedText, applyResultEdits } from '../src/features/pdf-to-word/core/result-edit.js';
import { measureResultText } from '../src/features/pdf-to-word/result-preview.js';

const context = createCanvas(1, 1).getContext('2d');
context.font = 'italic 1000px "Cambria Math"';
const m = context.measureText('G'), size = 11, baseline = 60;
const rect = { x: 30, y: baseline - m.actualBoundingBoxAscent / 1000 * size,
  width: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) / 1000 * size,
  height: (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 1000 * size };
const source = { id: 'p1:t1', text: 'G', rect, order: 1, disposition: 'visible-image' };
const image = { id: 'p1:t1:image', type: 'image', role: 'math', sourceIds: [source.id], rect, order: 1,
  reasons: [], drawingIds: [], mathStrokes: [], mathGlyphs: [{ id: source.id, text: 'G', rect, baseline,
    size, font: 'ABCDEF+CMMI10', italic: true, bold: false, color: '000000', raster: false, preciseInk: true }] };
const fresh = () => structuredClone({ number: 1, width: 300, height: 220, sources: [source], items: [image], rules: [], risks: ['math-image'], characters: 1 });
const scene = fresh();
recoverMathLetters(scene, context);
assert.equal(scene.items[0].type, 'text');
assert.equal(scene.items[0].id, source.id);
assert.equal(scene.items[0].text, source.text);
assert.equal(scene.items[0].font, 'Cambria');
const outputSize = scene.items[0].size;
context.font = 'italic 1000px "Cambria"';
const fitted = context.measureText(scene.items[0].text);
assert(Math.abs((fitted.actualBoundingBoxAscent + fitted.actualBoundingBoxDescent) * outputSize / 1000 - rect.height) <= .3);
assert(Math.abs((fitted.actualBoundingBoxLeft + fitted.actualBoundingBoxRight) * outputSize / 1000 * scene.items[0].glyphScale / 100 - rect.width) <= .1,
  'a real italic face still fits the original physical glyph bounds');
assert(scene.items[0].italic);
assert.deepEqual(scene.sources[0], { ...source, disposition: 'editable' });
assert.deepEqual(scene.items[0].rect, rect);
assert.deepEqual(recoverMathLetters(scene, context), scene);

const refuse = mutate => {
  const probe = fresh(); mutate(probe);
  const before = structuredClone(probe);
  recoverMathLetters(probe, context);
  assert.deepEqual(probe, before);
};
for (const property of ['raster', 'mathStyleUncertain', 'radicalPart', 'delimiterPart']) {
  refuse(p => { p.items[0].mathGlyphs[0][property] = true; });
}
refuse(p => { p.items[0].mathGlyphs[0].font = 'UnknownFace'; });
refuse(p => { p.items[0].mathGlyphs[0].preciseInk = false; });
refuse(p => { delete p.items[0].mathGlyphs[0].preciseInk; });
refuse(p => { p.items[0].mathGlyphs[0].alphabet = 'script'; });
refuse(p => { p.items[0].mathGlyphs[0].text = 'GG'; });
refuse(p => { p.items[0].mathGlyphs[0].text = '\u0393'; });
refuse(p => { p.items[0].mathGlyphs[0].baseline = NaN; });
refuse(p => { p.items[0].mathGlyphs[0].size *= 10; });
refuse(p => { p.items[0].mathGlyphs[0].rect.width *= 10; });
refuse(p => { p.items[0].mathGlyphs[0].color = 'transparent'; });
refuse(p => { p.items[0].mathGlyphs.push({ ...p.items[0].mathGlyphs[0], id: 'other' }); });
refuse(p => { p.items[0].mathStrokes.push({ id: 'bar' }); });
refuse(p => { p.items[0].drawingIds.push('drawing'); });
refuse(p => { p.items[0].reasons.push('overlapping-graphics'); });
refuse(p => { p.items[0].backgroundPaintIndexes = [1]; });
refuse(p => { p.sources[0].disposition = 'excluded-hidden'; });
refuse(p => { p.sources[0].id = 'other'; });
refuse(p => { p.sources[0].text = 'H'; });
refuse(p => { p.rasterPage = true; });
const noContext = fresh(); recoverMathLetters(noContext, null); assert.deepEqual(noContext, fresh());

function indexFixture(typed = false) {
  const glyph = (text, size, baseline, x, font) => {
    context.font = 'italic 1000px "Cambria Math"'; const m = context.measureText(text);
    return { id: 'index-' + text, sourceIds: ['index-' + text], type: 'text', text, font, size, baseline,
      preciseInk: true, raster: false, italic: true, color: '000000',
      rect: { x, y: baseline - m.actualBoundingBoxAscent / 1000 * size,
        width: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) / 1000 * size,
        height: (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 1000 * size } };
  };
  const base = glyph('d', 11, 60, 30, 'ABCDEF+CMMI10');
  const script = glyph('v', 7.5, 62, 30 + base.rect.width + .2, 'ABCDEF+CMMI7');
  if (!typed) { delete base.type; delete script.type; }
  base.words = [{ text: base.text, rect: { ...base.rect } }];
  return { number: 1, width: 300, height: 220,
    sources: [base, script].map(item => ({ id: item.id, text: item.text, rect: { ...item.rect }, disposition: 'editable' })),
    items: [{ type: 'table', cells: [{ blocks: [{ type: 'paragraph', lines: [{ items: [base, script] }] }] }] }] };
}
const indexed = indexFixture(), oldSources = structuredClone(indexed.sources);
recoverMathLetters(indexed, context);
const indexedItems = indexed.items[0].cells[0].blocks[0].lines[0].items;
assert(indexedItems.every(item => item.font === 'Cambria' && item.glyphScale >= 70 && item.glyphScale <= 150));
assert.deepEqual(indexedItems.map(item => item.baseline), [60, 62], 'a confirmed index keeps both source baselines');
assert.deepEqual(indexed.sources, oldSources, 'font substitution cannot rewrite the source ledger');
const indexedBefore = structuredClone(indexed); recoverMathLetters(indexed, context); assert.deepEqual(indexed, indexedBefore);
const typedIndex = indexFixture(true); recoverMathLetters(typedIndex, context);
assert(typedIndex.items[0].cells[0].blocks[0].lines[0].items.every(item => item.font === 'Cambria'),
  'typed restored cells and the raw core table shape share the same guarded calibration');
for (const alter of [
  items => { items[1].baseline = items[0].baseline; },
  items => { items[1].font = 'UnknownFace'; },
  items => { items[1].raster = true; },
  items => { items[0].text = 'model'; },
  items => { items[1].sourceIds = ['missing']; },
  items => { items[1].mathStyleUncertain = true; },
  items => { items.push({ ...items[1], id: 'ambiguous', sourceIds: ['ambiguous'] }); },
]) {
  const probe = indexFixture(), items = probe.items[0].cells[0].blocks[0].lines[0].items; alter(items);
  if (items.length > 2) probe.sources.push({ id: 'ambiguous', text: items[2].text, rect: { ...items[2].rect }, disposition: 'editable' });
  const before = structuredClone(probe); recoverMathLetters(probe, context); assert.deepEqual(probe, before);
}

const document = inferDocument([scene], { preserveGeometry: true });
const result = await createWordBytes(document, [], { preserveGeometry: true, editableMath: true, strictMathGeometry: true, measurementContext: context });
const xml = await (await JSZip.loadAsync(result.bytes)).file('word/document.xml').async('string');
assert(xml.includes('>G</w:t>'));
assert(xml.includes('w:ascii="Cambria"'));
assert(xml.includes('<w:i/>'));
assert(!xml.includes('<m:oMath') && !xml.includes('<w:drawing'));
assert.equal(result.quality.editableCharacters, 1);
assert.equal(result.quality.nativeFormulas, 0, 'ordinary letters do not inflate the native formula count');
const target = resultTargets(document.pages[0]).find(item => item.type === 'text');
// This fixture has only one glyph; explicitly supply its known empty text cell
// when testing the edit fitter rather than the paragraph/column inference.
target.container = { x: 0, y: 0, width: 300, height: 220 };
const measure = (text, style) => measureResultText(text, style, context);
measure.metrics = (text, style) => measureResultText.metrics(text, style, context);
assert.deepEqual(layoutEditedText(target, 'G', measure, { page: document.pages[0] }), { type: 'noop' });
const edit = layoutEditedText(target, 'H123', measure, { page: document.pages[0] });
assert(edit.lines.flatMap(line => line.items).every(item => item.size === outputSize && item.italic && item.font === 'Cambria'));
const edited = applyResultEdits(document, { [target.key]: edit });
assert(resultTargets(edited.pages[0]).some(item => item.text === 'H123'));
const deleted = applyResultEdits(document, { [target.key]: { type: 'delete' } });
assert(!resultTargets(deleted.pages[0]).some(item => item.type === 'text'));

// Printed answer-key ranges are one-dimensional text, even when PDF grouping
// initially classified the tilde as a mathematical symbol.
function rangeScene(value='1~20') {
  context.font='1000px "Times New Roman"';context.fontKerning='none';
  let x=30;
  const glyphs=[...value].map((text,index)=>{
    const m=context.measureText(text),size=11,baseline=60;
    const rect={x:x-m.actualBoundingBoxLeft*size/1000,y:baseline-m.actualBoundingBoxAscent*size/1000,
      width:(m.actualBoundingBoxLeft+m.actualBoundingBoxRight)*size/1000,
      height:(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)*size/1000};
    x+=m.width*size/1000;
    return {id:'range:'+index,text,rect,baseline,size,font:'ABCDEF+TimesNewRomanPSMT',
      raster:false,preciseInk:true,bold:false,italic:false,color:'000000'};
  });
  const left=Math.min(...glyphs.map(g=>g.rect.x)),top=Math.min(...glyphs.map(g=>g.rect.y));
  const rect={x:left,y:top,width:Math.max(...glyphs.map(g=>g.rect.x+g.rect.width))-left,
    height:Math.max(...glyphs.map(g=>g.rect.y+g.rect.height))-top};
  return {number:1,width:300,height:220,rasterPage:false,rules:[],risks:[],
    sources:glyphs.map(g=>({id:g.id,text:g.text,rect:{...g.rect},disposition:'visible-image'})),
    items:[{id:'range:image',type:'image',role:'math',rect,order:1,sourceIds:glyphs.map(g=>g.id),
      mathGlyphs:glyphs,mathStrokes:[],drawingIds:[],reasons:[]}]};
}
const range=rangeScene();recoverMathLetters(range,context);
assert.equal(range.items.map(item=>item.text).join(''),'1~20');
assert(range.items.every(item=>item.type==='text'&&item.preciseInk));
assert(range.sources.every(source=>source.disposition==='editable'));
const rangeDocument=inferDocument([range],{preserveGeometry:true});
const rangeOutput=await createWordBytes(rangeDocument,[],{preserveGeometry:true,measurementContext:context});
const rangeXml=await(await JSZip.loadAsync(rangeOutput.bytes)).file('word/document.xml').async('string');
assert(!rangeXml.includes('<m:oMath')&&!rangeXml.includes('<w:drawing'));
assert.equal(rangeOutput.quality.editableCharacters,4);
assert.equal(rangeOutput.quality.nativeFormulas,0,'ordinary printed ranges are not counted as formulas');
for(const mutate of [
  s=>{s.items[0].mathGlyphs[1].baseline+=3;},
  s=>{s.items[0].mathGlyphs[1].raster=true;},
  s=>{s.items[0].mathGlyphs[1].font='UnknownTextFace';},
  s=>{s.items[0].mathGlyphs[1].mathStyleUncertain=true;},
  s=>{s.items[0].sourceIds[1]=s.items[0].sourceIds[0];},
  s=>{s.sources[1].text='=';},
  s=>{s.items[0].drawingIds=['line'];},
  s=>{s.items[0].mathStrokes=[{rect:{x:30,y:60,width:20,height:1}}];},
  s=>{s.items[0].mathGlyphs[2].rect.x=s.items[0].mathGlyphs[0].rect.x;},
]) {
  const rejected=rangeScene();mutate(rejected);const before=structuredClone(rejected);
  recoverMathLetters(rejected,context);assert.deepEqual(rejected,before,
    'uncertain, overlapping, structured or unowned range candidates retain their original fallback');
}
const simpleExpression=rangeScene('1+20');recoverMathLetters(simpleExpression,context);
assert(simpleExpression.items.every(item=>item.type==='text'));
assert.equal(simpleExpression.items.map(item=>item.text).join(''),'1+20','an exact single-baseline expression is ordinary editable text');
for(const value of ['x~20','1~x','1~2~3','12345~9']) {
  const rejected=rangeScene(value),before=structuredClone(rejected);
  recoverMathLetters(rejected,context);assert.deepEqual(rejected,before,'only a short literal numeric range is recovered');
}
for (const [text, font, italic] of [
  ['or', 'ABCDEF+NimbusRomNo9L-ReguItal', true],
  ['2048', 'ABCDEF+CMR7', false],
  ['×××', 'ABCDEF+TimesNewRomanPSMT', false],
]) {
  context.font = `${italic ? 'italic ' : ''}1000px "${text === 'or' ? 'Times New Roman' : 'Cambria Math'}"`;
  const m = context.measureText(text), probe = fresh(), item = probe.items[0], g = item.mathGlyphs[0];
  Object.assign(g, { text, font, italic, size: 11, baseline: 60,
    rect: { x: 30, y: 60 - m.actualBoundingBoxAscent * .011,
      width: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * .011,
      height: (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * .011 } });
  item.rect = { ...g.rect };
  Object.assign(probe.sources[0], { text, rect: { ...g.rect } }); probe.characters = text.length;
  const sourceBefore = structuredClone(probe.sources);
  recoverMathLetters(probe, context);
  assert.equal(probe.items[0].type, 'text');
  assert.equal(probe.items[0].text, text);
  assert.equal(probe.items[0].sourceFont, font);
  assert.equal(probe.items[0].italic, italic);
  assert.deepEqual(probe.sources, sourceBefore.map(s => ({ ...s, disposition: 'editable' })));
  const doc = inferDocument([probe], { preserveGeometry: true });
  const output = await createWordBytes(doc, [], { preserveGeometry: true, editableMath: true, strictMathGeometry: true, measurementContext: context });
  const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
  assert(!xml.includes('<m:oMath') && !xml.includes('<w:drawing'), 'plain words, axis labels and placeholders remain ordinary text');
  assert.equal(output.quality.editableCharacters, text.length);
  assert.equal(output.quality.nativeFormulas, 0);
  const target = resultTargets(doc.pages[0]).find(t => t.type === 'text');
  assert.deepEqual(layoutEditedText(target, text, measure, { page: doc.pages[0] }), { type: 'noop' });
}
// A known native CMSY literal must not rely on an implicit CJK substitute in
// a narrow frame. Source spelling, ownership and physical ink bounds stay exact.
for (const text of ['〈','〉']) {
  context.font='1000px "SimSun"';const metric=context.measureText(text),size=13;
  const rect={x:30,y:45,width:(metric.actualBoundingBoxLeft+metric.actualBoundingBoxRight)*size/1000*.75,
    height:(metric.actualBoundingBoxAscent+metric.actualBoundingBoxDescent)*size/1000};
  const make=()=>({number:1,width:300,height:220,rules:[],risks:[],characters:1,
    sources:[{id:'angle',text,rect:{...rect},disposition:'editable'}],
    items:[{id:'angle',type:'text',text,rect:{...rect},sourceIds:['angle'],order:0,raster:false,
      font:'ABCDEF+CMSY10',fontFamily:'sans-serif',size:11,baseline:55,preciseInk:true,color:'000000'}]});
  const scene=make(),ledger=structuredClone(scene.sources);recoverMathLetters(scene,context);
  const item=scene.items[0];assert.equal(item.font,'SimSun');assert.equal(item.text,text);
  assert.deepEqual(item.rect,rect);assert.deepEqual(scene.sources,ledger);assert.equal(item.sourceFont,'ABCDEF+CMSY10');
  const before=structuredClone(scene);recoverMathLetters(scene,context);assert.deepEqual(scene,before,'literal calibration is idempotent');
  const doc=inferDocument([scene],{preserveGeometry:true});
  const result=await createWordBytes(doc,[],{preserveGeometry:true,measurementContext:context});
  const xml=await(await JSZip.loadAsync(result.bytes)).file('word/document.xml').async('string');
  assert(xml.includes(text)&&xml.includes('w:ascii="SimSun"')&&xml.includes('w:eastAsia="SimSun"'));
  assert(!xml.includes('<m:oMath')&&!xml.includes('<w:drawing'),'a literal bracket remains editable ordinary text');
  const target=resultTargets(doc.pages[0]).find(t=>t.type==='text');
  assert.deepEqual(layoutEditedText(target,text,measure,{page:doc.pages[0]}),{type:'noop'});
  for (const mutate of [
    s=>{s.items[0].font='UnknownCMSY';},s=>{s.items[0].raster=true;},s=>{s.items[0].ocr=true;},
    s=>{s.items[0].bold=true;},s=>{s.items[0].italic=true;},s=>{s.items[0].delimiterPart=true;},
    s=>{s.items[0].preciseInk=false;},s=>{s.items[0].words=[{text}];},s=>{s.items[0].alphabet='script';},
    s=>{s.sources[0].disposition='excluded-hidden';},s=>{s.sources[0].text='different';},
    s=>{s.items[0].sourceIds=['unowned'];},s=>{s.items[0].rect.width*=10;},
    s=>{s.items[0].glyphPositions=[{text:'different',rect:{...rect}}];},
    s=>{s.items[0].size=100;},s=>{s.items[0].baseline=NaN;},s=>{s.items[0].color='transparent';},
  ]) {
    const rejected=make();mutate(rejected);const before=structuredClone(rejected);
    recoverMathLetters(rejected,context);assert.deepEqual(rejected,before,'uncertain glyph provenance or geometry retains its original path');
  }
}
console.log('Native math text: literal angle visibility, exact sources/ink bounds, style-preserving edits, real DOCX and conservative rejections passed.');
console.log('Math letters: native source ownership, conservative refusal, editable ordinary text, style-preserving edits and real DOCX passed.');
