import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { createCanvas } from '@napi-rs/canvas';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { compressedPunctuationChunks } from '../src/features/pdf-to-word/core/text-chunks.js';
import { positionedFrameCost } from '../src/features/pdf-to-word/core/positioned-budget.js';
import { positionedTextRuns, measureLineBox, positionedLineOrigin, originX } from '../src/features/pdf-to-word/adapters/text-layout.js';

const nodes = node => [node, ...(node.elements || []).flatMap(nodes)];
const measurementContext = { measureText(text) { return { width: [...text].length * 1000, actualBoundingBoxLeft: 0,
  actualBoundingBoxAscent: 800, fontBoundingBoxAscent: 900, fontBoundingBoxDescent: 200 }; } };
async function convert(parts, font = 'SimSun') {
  const items = parts.map(([text, x, spaceBefore], index) => ({ id: `g${index}`, sourceIds: [`g${index}`], type: 'text',
    text, size: 10, baseline: 30, baselineX: x, rect: { x, y: 22, width: [...text].length * 10, height: 10 },
    advanceWidth: [...text].length * 10, preciseInk: true, font, color: '000000', spaceBefore, order: index }));
  const original = structuredClone(items);
  const scene = { number: 1, width: 500, height: 100, items, risks: [], rasterPage: false,
    sources: items.map(item => ({ id: item.id, text: item.text, rect: item.rect, order: item.order, disposition: 'editable' })) };
  const layout = inferDocument([scene], { preserveGeometry: true, pageModes: { 1: 'single' } });
  const output = await createWordBytes(layout, [], { preserveGeometry: true, measurementContext });
  assert.deepEqual(items, original, 'spacing correction cannot change source text, positions or word boundaries');
  const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
  const all = nodes(xml2js(xml, { captureSpacesBetweenElements: true }));
  const text = all.filter(node => node.name === 'w:t').map(node => node.elements?.map(item => item.text || '').join('') || '').join('');
  return { text, all };
}

const cjk = await convert([['\u7532', 10], ['\u4e59', 20.2], ['\u4e19', 30.4]]);
assert.equal(cjk.text, '\u7532\u4e59\u4e19', 'small inter-glyph placements do not become artificial space characters');
const advances = cjk.all.filter(node => node.name === 'w:r').filter(run => nodes(run).some(node => node.name === 'w:t'
  && node.elements?.some(child => child.type === 'text' && child.text.length)));
assert.equal(advances.length, 3);
assert.equal(nodes(advances[0]).find(node => node.name === 'w:spacing').attributes['w:val'], '4');
assert.equal(nodes(advances[1]).find(node => node.name === 'w:spacing').attributes['w:val'], '4');
const explicit = await convert([['A', 10], ['B', 20.2, true]]);
assert.equal(explicit.text, 'A B', 'an explicit source word boundary survives even when the gap is small');
const distant = await convert([['A', 10], ['B', 25]]);
assert.equal(distant.text, 'A B', 'a word-sized gap remains a real editable space');
const words = await convert([['word', 10], ['next', 50.2]]);
assert.equal(words.text, 'word next', 'word runs are not stretched to absorb their trailing gaps');
const tight = await convert([['A', 10], ['B', 19.8]]);
assert.equal(tight.text, 'AB', 'overlapping advances retain the existing bounded condensation path');
const compressed = await convert([['甲', 10], ['”', 20], ['、', 25], ['乙', 30], ['丙', 40]]);
assert.equal(compressed.text, '甲”、乙丙', 'compressed source punctuation is neither dropped nor padded with spaces');
const resumes = compressed.all.filter(node => node.name === 'w:framePr').map(node => Number(node.attributes['w:x']));
assert(resumes.includes(25 * 20) && resumes.includes(30 * 20), 'reader frames resume at the original origins after compressed punctuation');
const nativeLine = { id: 'compressed', baseline: 30, items: ['甲','”','、','乙'].map((text,index) => ({
  type:'text', text, preciseInk:true, size:10, font:'SimSun', baseline:30, baselineX:[10,20,25,30][index],
  rect:{x:[10,20,25,30][index],y:22,width:10,height:10} })) };
const unchanged = structuredClone(nativeLine);
assert.equal(compressedPunctuationChunks(nativeLine).length, 3);
assert.equal(positionedFrameCost([{type:'paragraph',lines:[nativeLine]}]), 3, 'punctuation frames consume the existing safety budget');
assert.deepEqual(nativeLine, unchanged);
const latinLine = {...nativeLine,items:nativeLine.items.map(item=>({...item,text:'word'}))};
assert.equal(compressedPunctuationChunks(latinLine)[0],latinLine,'ordinary Latin words keep their existing shaping');
const scannedLine = {...nativeLine,items:nativeLine.items.map(item=>({...item,ocr:true}))};
assert.equal(compressedPunctuationChunks(scannedLine)[0],scannedLine,'OCR keeps its independently bounded physical frames');
for (const punctuation of ['，','。','！','？','、','；','：']) {
  const source = { ...nativeLine, items: ['甲',punctuation,'乙'].map((text,index) => ({
    ...nativeLine.items[0], text, baselineX:[10,20,29][index],
    rect:{x:[10,20,29][index],y:22,width:10,height:10}
  })) };
  const before = structuredClone(source);
  assert.equal(compressedPunctuationChunks(source).length,2,
    'near-full-width CJK stops must not carry reader-clamped spacing into the next glyph');
  assert.equal(positionedFrameCost([{type:'paragraph',lines:[source]}]),2,
    'near-full-width protection uses the same existing frame limit');
  assert.deepEqual(source,before);
  const latin = {...source,items:source.items.map((item,index)=>({...item,text:['A',punctuation,'B'][index]}))};
  assert.equal(compressedPunctuationChunks(latin)[0],latin,
    'CJK stop handling does not split a Latin word solely because of its punctuation');
  const wide = {...source,items:source.items.map((item,index)=>index===2
    ? {...item,baselineX:32,rect:{...item.rect,x:32}} : item)};
  assert.equal(compressedPunctuationChunks(wide)[0],wide,'a genuine larger source gap keeps its shaping');
}
const nearFullWidth = await convert([['甲',10],['，',20],['乙',29],['丙',39]]);
assert.equal(nearFullWidth.text,'甲，乙丙');
assert(nearFullWidth.all.some(node=>node.name==='w:framePr'&&Number(node.attributes['w:x'])===29*20),
  'the actual DOCX resumes at the next source origin after a near-full-width comma');
const numericGap = {...nativeLine,items:['甲','2','0','乙'].map((text,index)=>({
  ...nativeLine.items[0],text,baselineX:[10,25,30,40][index],advanceWidth:[10,5,5,10][index],
  rect:{x:[10,25,30,40][index],y:22,width:[10,5,5,10][index],height:10}
}))};
const numericBefore=structuredClone(numericGap),numericChunks=compressedPunctuationChunks(numericGap);
assert.deepEqual(numericChunks.map(chunk=>chunk.items.map(item=>item.text).join('')),['甲','20','乙'],
  'proven CJK/numeric gaps reset the field origin while retaining the complete numeric value');
assert.equal(positionedFrameCost([{type:'paragraph',lines:[numericGap]}]),3);
assert.deepEqual(numericGap,numericBefore);
for (const items of [
  numericGap.items.map(item=>({...item,advanceWidth:undefined})),
  numericGap.items.map((item,index)=>({...item,text:['A','2','0','B'][index]})),
  numericGap.items.map((item,index)=>({...item,baselineX:[10,20,25,30][index]}))
]) {
  const ordinary={...numericGap,items};
  assert.equal(compressedPunctuationChunks(ordinary)[0],ordinary,
    'unproven advances, Latin words and naturally contiguous numeric runs stay intact');
}
const calibriMetrics = { measureText() { return { width: 500, actualBoundingBoxLeft: -25,
  actualBoundingBoxAscent: 656.25, fontBoundingBoxAscent: 750, fontBoundingBoxDescent: 250 }; } };
for (const size of [10, 12, 16, 24, 35.45]) {
  const item = { type: 'text', text: '9', font: 'Calibri', size, baseline: 100,
    rect: { x: 30, y: 100 - Math.round(size * 2) / 2 * .65625, width: size * .5, height: size * .65625 },
    preciseInk: true, ocr: true };
  const line = { baseline: 100, items: [item] }, before = structuredClone(line);
  const box = measureLineBox(line, calibriMetrics);
  assert.equal(box.baselineOffset, Math.round(box.height * 20) / 20 * .8, 'OCR baseline uses the serialized exact line height');
  assert.deepEqual(line, before, 'physical frame calibration must not mutate editable source positions or styles');
  const native = measureLineBox({ ...line, items: [{ ...item, ocr: false }] }, calibriMetrics);
  assert.equal(native.height, box.height, 'line capacity and physical frame height stay unchanged');
  assert.notEqual(native.baselineOffset, box.baselineOffset, 'native hhea layout is unaffected');
  assert.equal(measureLineBox(line, calibriMetrics, true).baselineOffset, native.baselineOffset,
    'image-bearing flow keeps its existing baseline rule');
}
const bearingContext = { measureText(text) { return { ...measurementContext.measureText(text),
  actualBoundingBoxLeft: text === '（' ? -700 : 0 }; } };
const bracket = { id: 'bracket', type: 'text', text: '（', size: 10, font: 'SimSun', ocr: true,
  preciseInk: true, rect: { x: 20, y: 22, width: 3, height: 8 }, advanceWidth: 3, baseline: 30 };
const bracketLine = { baseline: 30, items: [bracket] }, bracketCopy = structuredClone(bracketLine);
const bracketPlan = positionedTextRuns(bracketLine, bearingContext);
assert.equal(bracketPlan[0].x, 13, 'the source ink origin still includes the full-width blank left bearing');
assert.equal(bracketPlan[0].spacing, 0, 'the last OCR glyph keeps a font-width frame instead of clipping its ink');
assert.deepEqual(bracketLine, bracketCopy);
const following = { ...bracket, id: 'following', text: '甲', rect: { x: 24, y: 22, width: 10, height: 8 }, advanceWidth: 10 };
const together = positionedTextRuns({ baseline: 30, items: [bracket, following] }, bearingContext);
assert.equal(together[0].spacing, -140, 'internal OCR advances retain their physical source spacing');
const nativeTogether = positionedTextRuns({ baseline: 30, items: [{ ...bracket, ocr: false }, { ...following, ocr: false }] }, bearingContext);
assert.equal(together.find(run => run.item?.id === 'following').x, nativeTogether.find(run => run.item?.id === 'following').x,
  'the next origin uses the unchanged, twip-quantized source spacing plan');
assert.equal(positionedTextRuns({ baseline: 30, items: [{ ...bracket, ocr: false }] }, bearingContext)[0].spacing, -140,
  'native text retains its existing spacing contract');
assert.equal(positionedTextRuns({ baseline: 30, items: [{ ...bracket, ocr: false, nativeCalibrated: true }] }, bearingContext)[0].spacing, 0,
  'a calibrated native terminal glyph also reserves its full left-bearing advance');
const calibratedLine = { ...nativeLine, items: nativeLine.items.map(item => ({ ...item, nativeCalibrated: true })) };
assert.equal(compressedPunctuationChunks(calibratedLine).length, 3,
  'native font calibration does not bypass the reader protection for compressed punctuation');
assert.equal(positionedFrameCost([{ type: 'paragraph', lines: [calibratedLine] }]), 3,
  'calibrated punctuation still consumes the existing physical frame budget');
assert(positionedTextRuns({ baseline: 30, items: [{ ...bracket, text: 'word' }] }, bearingContext)[0].spacing < 0,
  'a multi-character OCR run retains its internal shaping and condensation');
for (const [requested, serialized] of [['KaiTi', '\u6977\u4f53'], ['FangSong', '\u4eff\u5b8b']]) {
  const result = await convert([['\u7532', 10], ['\u4e59', 20]], requested);
  assert.equal(result.text, '\u7532\u4e59');
  const faces = result.all.filter(node => node.name === 'w:rFonts').map(node => node.attributes);
  assert(faces.some(face => face['w:ascii'] === serialized && face['w:eastAsia'] === serialized && face['w:hAnsi'] === serialized));
  assert(!faces.some(face => Object.values(face).includes(requested)), 'serialized font uses the reader-compatible name');
  assert(measurementContext.font.endsWith(`"${requested}"`), 'font aliasing does not change the measurement family');
}
{
  const canvasContext=createCanvas(1,1).getContext('2d'),baseline=90,size=10;
  // Chromium includes the leading-space advance in the negative ink bearing.
  // This Node backend omits it; derive that valid bearing independently from
  // the measured whitespace width so the DOCX test exercises the browser case.
  const context={
    get font(){return canvasContext.font;},set font(value){canvasContext.font=value;},
    get fontKerning(){return canvasContext.fontKerning;},set fontKerning(value){canvasContext.fontKerning=value;},
    measureText(text){
      const value=canvasContext.measureText(text),trimmed=text.trimStart();
      return text===trimmed?value:{...value,actualBoundingBoxLeft:canvasContext.measureText(trimmed).actualBoundingBoxLeft
        -(value.width-canvasContext.measureText(trimmed).width)};
    }
  };
  context.font='1000px "Times New Roman"';context.fontKerning='none';
  const words=[['Visible',130],['footer',167]].map(([text,x])=>{
    const m=context.measureText(text);
    return {text,spaceBefore:true,baselineX:x,advanceWidth:m.width*.01,
      rect:{x:x-m.actualBoundingBoxLeft*.01,y:baseline-m.actualBoundingBoxAscent*.01,
        width:(m.actualBoundingBoxLeft+m.actualBoundingBoxRight)*.01,
        height:(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)*.01}};
  });
  const rect={x:words[0].rect.x,y:Math.min(...words.map(w=>w.rect.y)),
    width:words.at(-1).rect.x+words.at(-1).rect.width-words[0].rect.x,
    height:Math.max(...words.map(w=>w.rect.y+w.rect.height))-Math.min(...words.map(w=>w.rect.y))};
  const parent={id:'leading',type:'text',text:' '.repeat(24)+'Visible footer',font:'Times-Roman',fontFamily:'serif',size,
    preciseInk:true,color:'000000',baseline,baselineX:70,advanceWidth:120,rect,words,sourceIds:['leading'],order:1};
  const line={id:'leading-line',items:[parent],rect,baseline,size},before=structuredClone(line);
  const x=positionedLineOrigin(line,context),runs=positionedTextRuns(line,context);
  assert(Math.abs(x-130)<.01,'the writer anchors to the first actual word, not the parent padding');
  assert(originX(parent,context)<x-30,'the fixture exposes the leading-space parent/child mismatch');
  assert(Math.abs(runs.find(run=>run.kind==='text').x-x)<.1);
  assert.equal(runs.filter(run=>run.kind==='text').map(run=>run.item.text).join(' '),'Visible footer');
  const picture=createCanvas(45,12);picture.getContext('2d').fillRect(0,0,45,12);
  const image={id:'left-image',type:'image',sourceIds:[],rect:{x:70,y:80,width:45,height:12},order:0};
  const scene={number:1,width:400,height:200,items:[image,parent],rules:[],risks:[],rasterPage:false,
    sources:[{id:parent.id,text:parent.text,rect:parent.rect,order:parent.order,disposition:'editable'}]};
  const document=inferDocument([scene],{preserveGeometry:true}),original=structuredClone(document);
  const output=await createWordBytes(document,[{id:image.id,format:'png',bytes:picture.toBuffer('image/png'),width:45,height:12}],
    {preserveGeometry:true,measurementContext:context});
  const xml=await(await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
  const all=nodes(xml2js(xml,{captureSpacesBetweenElements:true}));
  const positioned=all.filter(node=>node.name==='w:framePr').map(node=>Number(node.attributes['w:x']));
  assert(positioned.some(value=>Math.abs(value-130*20)<=1),'actual DOCX keeps text clear of the independently positioned image');
  assert.equal(all.filter(node=>node.name==='pic:pic').length,1);
  assert(!xml.includes(' '.repeat(24)+'Visible'),'padding is represented once as physical positions');
  assert.deepEqual(document,original);assert.deepEqual(line,before,'frame and run planning cannot mutate source whitespace or styles');
  picture.width=picture.height=0;
}
console.log('PDF Word text spacing checks passed: contiguous glyphs, explicit/large word gaps, source immutability, word-frame anchors and measured/serialized CJK font aliases.');
