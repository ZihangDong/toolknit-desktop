import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { calibrateNativeTypography } from '../src/features/pdf-to-word/adapters/native-typography.js';
import { createOcrTypography } from '../src/features/pdf-to-word/adapters/ocr-typography.js';
import { ocrFrameLayout } from '../src/features/pdf-to-word/core/ocr-frame-layout.js';
import { PDFDocument,StandardFonts } from 'pdf-lib';
import { getDocument,OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { snapshotPage,snapshotFonts,renderPage } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { prepareWordScene } from '../src/features/pdf-to-word/adapters/scene.js';
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { missingFontAliases, missingFontContext } from '../src/features/pdf-to-word/adapters/missing-font-context.js';
import { createNativeDisplayFitter, nativeDisplayCandidate } from '../src/features/pdf-to-word/adapters/native-display-typography.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { renderResultPage } from '../src/features/pdf-to-word/result-preview.js';
import { measureLineBox } from '../src/features/pdf-to-word/adapters/text-layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import JSZip from 'jszip';

// One source font can contain ASCII text and Unicode-encoded math styles.
// A strong ASCII donor must not overwrite the mathematical face, or vice versa.
{
  const make = (id, text, extra = {}) => ({ id, type: 'text', text, font: 'ABCDEF+XITSMath-Regular',
    size: 12, baseline: 20, rect: { x: 5, y: 10, width: 24, height: 10 }, raster: false,
    preciseInk: true, color: '000000', sourceIds: [id],
    glyphPositions: [...text].map((text, i) => ({ text, rect: { x: 5 + i * 5, y: 10, width: 4, height: 10 } })), ...extra });
  const math = make('math', '𝑦 = 𝑥'), ascii = make('ascii', 'ab'), single = make('single', '𝒙'),
    asciiSingle = make('ascii-single', 'a'), unknown = make('unknown', '𝑦 = 𝑥', { font: 'UnknownMath' }),
    uncertain = make('uncertain', '𝑦 = 𝑥', { mathStyleUncertain: true }), short = make('short', '⩽ 𝑧');
  const shortGeometry = structuredClone({ size: short.size, baseline: short.baseline, rect: short.rect });
  const scene = { width: 100, height: 50, items: [short, math, ascii, single, asciiSingle, unknown, uncertain],
    sources: [short, math, ascii, single, asciiSingle, unknown, uncertain].map(item => ({ id: item.id, text: item.text, disposition: 'editable' })) };
  const sources = structuredClone(scene.sources), calls = [];
  calibrateNativeTypography(scene, new Uint8ClampedArray(100 * 50 * 4), 100, 50, options => {
    calls.push({ text: options.line.text, hint: options.fontHint });
    if (options.line.text === short.text) return null;
    return { font: options.fontHint?.font || 'Times New Roman', size: 12, bold: false,
      ocrFontScore: options.fontHint ? .8 : .99 };
  });
  assert.deepEqual(calls, [{ text: '⩽ 𝑧', hint: { font: 'Cambria Math', bold: false } },
    { text: '𝑦 = 𝑥', hint: { font: 'Cambria Math', bold: false } }, { text: 'ab', hint: undefined }]);
  assert.equal(math.font, 'Cambria Math'); assert.equal(single.font, 'Cambria Math');
  assert.equal(ascii.font, 'Times New Roman'); assert.equal(asciiSingle.font, 'Times New Roman');
  assert.equal(unknown.font, 'UnknownMath'); assert.equal(uncertain.font, 'ABCDEF+XITSMath-Regular');
  assert.equal(short.font, 'Cambria Math'); assert(!short.nativeCalibrated);
  assert.deepEqual({ size: short.size, baseline: short.baseline, rect: short.rect }, shortGeometry);
  assert.equal(math.text, '𝑦 = 𝑥'); assert.equal(single.text, '𝒙'); assert.deepEqual(scene.sources, sources);
  const noDonor = make('no-donor', '⩽ 𝑧'), original = structuredClone(noDonor);
  calibrateNativeTypography({ width: 100, height: 50, items: [noDonor] }, new Uint8ClampedArray(100 * 50 * 4), 100, 50, () => null);
  delete original.glyphPositions; assert.deepEqual(noDonor, original, 'failed fitting without a proven same-kind donor does not invent a face');
}

// Actual glyph fitting and DOCX serialization use the same face. The Unicode
// characters retain their encoded italic style without a second synthetic slant.
{
  const canvas = createCanvas(800, 180), context = canvas.getContext('2d'), text = '𝑦 = 𝑥';
  context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'black'; context.font = '60px "Cambria Math"'; context.fontKerning = 'none';
  let x = 30; const glyphPositions = [];
  for (const char of text) {
    const m = context.measureText(char); context.fillText(char, x, 100);
    if (char.trim()) glyphPositions.push({ text: char, rect: { x: (x - m.actualBoundingBoxLeft) / 3,
      y: (100 - m.actualBoundingBoxAscent) / 3, width: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) / 3,
      height: (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 3 } });
    x += m.width;
  }
  const item = { id: 'unicode-math', type: 'text', text, font: 'ABCDEF+XITSMath-Regular',
    size: 20, baseline: 100 / 3, rect: { x: 10, y: 10, width: x / 3, height: 30 },
    raster: false, preciseInk: true, color: '000000', glyphPositions, sourceIds: ['unicode-math'] };
  const scene = { number: 1, width: 800 / 3, height: 60, items: [item], sources: [{ id: item.id, text, disposition: 'editable' }] };
  calibrateNativeTypography(scene, context.getImageData(0, 0, 800, 180).data, 800, 180,
    createOcrTypography(createCanvas, { nativeEvidence: true }));
  assert(item.nativeCalibrated); assert.equal(item.font, 'Cambria Math');
  assert.equal(item.text, text); assert(!item.bold && !item.italic);
  assert(item.words.every(word => word.font === 'Cambria Math' && !word.bold && !word.italic));
  Object.assign(scene, { rules: [], risks: [], characters: [...text.replace(/\s/g, '')].length });
  const output = await createWordBytes(inferDocument([scene], { preserveGeometry: true }), [],
    { preserveGeometry: true, measurementContext: context });
  const xml = await (await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
  assert(xml.includes('Cambria Math') && xml.includes('𝑦') && xml.includes('𝑥'));
  assert(!xml.includes('<w:i/>') && !xml.includes('<w:b/>'), 'encoded math styles are not synthesized a second time');
  canvas.width = canvas.height = 0;
}

// An unavailable PDF face has nominal bounds unrelated to the calibrated
// children. Extra parent whitespace must not reposition the emitted text.
for (const family of ['SimHei', 'Calibri', 'Arial', 'SimSun']) {
  const canvas = createCanvas(1, 1), context = canvas.getContext('2d');
  const words = [...'SCHEME'].map((text, index) => ({ text, font: family, fontFamily: family,
    rect: { x: 20 + index * 28, y: 50, width: 20, height: 32 },
    size: index === 2 ? 49.5 : 50, baseline: 85, advanceWidth: 20, preciseInk: true }));
  const parent = { id: 'display', type: 'text', text: 'SCHEME', sourceIds: ['display'],
    font: family, fontFamily: family, nativeCalibrated: true, preciseInk: true, sourceFont: 'UnavailableDisplay',
    sourceSize: 55, size: 50, baseline: 85, rect: { x: 20, y: 50, width: 160, height: 32 }, words };
  const line = { id: 'display:line', baseline: 85, rect: { ...parent.rect }, items: [parent] };
  const padded = structuredClone(line);
  Object.assign(padded.items[0], { size: 77, rect: { x: 3, y: 20, width: 210, height: 100 } });
  const frozen = structuredClone(padded);
  assert.deepEqual(measureLineBox(padded, context, false, null, true), measureLineBox(line, context, false, null, true),
    'nominal parent padding/size cannot move independently fitted native glyphs');
  const box = measureLineBox(padded, context, false, null, true);
  assert.equal(box.baselineOffset, Math.round(box.height * 20) / 20 * .8,
    'calibrated native word runs use the same exact-line baseline as their Office output');
  assert.deepEqual(padded, frozen);
  assert.notDeepEqual(measureLineBox(padded, context), box,
    'table/flow preflight keeps its existing nominal-line contract; the new native rule belongs to positioned frames');
  const document = value => inferDocument([{ number: 1, width: 300, height: 180, risks: [], rules: [], characters: 6,
    items: structuredClone(value.items), sources: [{ id: 'display', text: 'SCHEME', rect: line.rect, disposition: 'editable', order: 0 }] }], { preserveGeometry: true });
  const xml = async value => (await JSZip.loadAsync((await createWordBytes(document(value), [],
    { preserveGeometry: true, measurementContext: context })).bytes)).file('word/document.xml').async('string');
  assert.equal(await xml(padded), await xml(line), 'actual Word frame coordinates, spacing and run styles are invariant');
  canvas.width = canvas.height = 0;
}
// Rich editing expands one calibrated native run into scalar children. Its
// Office baseline must survive that change of representation.
{
  const context = createCanvas(1, 1).getContext('2d'); context.font = '1000px "Cambria Math"'; context.fontKerning = 'none';
  const words = [...'20°'].map((text, index) => {
    const m = context.measureText(text), size = 12;
    return { text, font: 'Cambria Math', size, preciseInk: true, baseline: 60, baselineX: 30 + index * 8,
      advanceWidth: m.width * size / 1000, rect: { x: 30 + index * 8 - m.actualBoundingBoxLeft * size / 1000,
        y: 60 - m.actualBoundingBoxAscent * size / 1000, width: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * size / 1000,
        height: (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * size / 1000 } };
  });
  const parent = { id: 'temperature', type: 'text', text: '20°', font: 'Cambria Math', size: 12, baseline: 60,
    sourceFont: 'ABCDEF+XITSMath-Regular', sourceSize: 12, nativeCalibrated: true, preciseInk: true,
    rect: { x: 30, y: 50, width: 24, height: 12 }, words };
  const original = { baseline: 60, size: 12, rect: parent.rect, items: [parent] };
  const editedShape = { ...original, items: words.map(word => ({ ...parent, ...word, words: undefined })) };
  const before = measureLineBox(original, context, false, null, true), after = measureLineBox(editedShape, context, false, null, true);
  assert.deepEqual(after, before, 'flattened XITS-to-Cambria source children retain the same frame and exact-line baseline');
  assert.equal(after.baselineOffset, Math.round(after.height * 20) / 20 * .8);
  const unproven = structuredClone(editedShape); unproven.items.forEach(item => { item.nativeCalibrated = false; });
  assert.deepEqual(measureLineBox(editedShape, context), measureLineBox(unproven, context), 'flow/table preflight does not inherit a positioned-only calibration');
  assert.notEqual(measureLineBox(unproven, context, false, null, true).baselineOffset, after.baselineOffset);
}
const canvas=createCanvas(1400,160),context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,1400,160);context.fillStyle='black';context.font='60px Arial';context.fontKerning='none';
const text='Native typography',glyphPositions=[];let x=30;
for(const char of text){const metrics=context.measureText(char);context.fillText(char,x,100);if(char.trim())glyphPositions.push({text:char,rect:{x:(x-metrics.actualBoundingBoxLeft)/3,y:(100-metrics.actualBoundingBoxAscent)/3,width:(metrics.actualBoundingBoxLeft+metrics.actualBoundingBoxRight)/3,height:(metrics.actualBoundingBoxAscent+metrics.actualBoundingBoxDescent)/3}});x+=metrics.width;}
const rect={x:10,y:15,width:x/3,height:25},item={id:'a',type:'text',text,font:'UnavailableCustomFace',fontMetrics:{ascent:.99,descent:.2},size:20,baseline:100/3,rect,glyphPositions,color:'000000',sourceIds:['a']};
const scene={number:1,width:1400/3,height:160/3,items:[item],sources:[{id:'a',text,disposition:'editable'}]},ledger=structuredClone(scene.sources);
calibrateNativeTypography(scene,context.getImageData(0,0,1400,160).data,1400,160,createOcrTypography(createCanvas));
assert(item.nativeCalibrated);assert.equal(item.font,'Arial');assert.equal(item.fontMetrics,undefined);assert.equal(item.sourceFont,'UnavailableCustomFace');assert(!item.glyphPositions);assert.deepEqual(scene.sources,ledger);assert.equal(item.text,text);
const page={header:[],footer:[],blocks:[{type:'paragraph',lines:Array.from({length:80},(_,i)=>({id:'l'+i,baseline:10+i*12,items:[{...item,ocr:true,words:Array.from({length:50},(_,j)=>({text:'a',baseline:10+i*12,rect:{x:j*5,y:i*12,width:4,height:8}}))}]}))}]};
const plan=ocrFrameLayout(page);assert.equal(plan.size,80);assert([...plan.values()].reduce((sum,frames)=>sum+frames.length,0)<=512,'dense scan frames stay within the original page budget');
const exactPage=structuredClone(page);
exactPage.blocks[0].lines=exactPage.blocks[0].lines.slice(0,10);
exactPage.blocks[0].lines.forEach(line=>{line.items[0].words=line.items[0].words.slice(0,49);});
const exactPlan=ocrFrameLayout(exactPage);
assert.equal([...exactPlan.values()].reduce((sum,frames)=>sum+frames.length,0),490,
  '490 source glyphs fit independently; redundant line reservations cannot force positional pairs');
assert([...exactPlan.values()].every(frames=>frames.every(frame=>frame.items.length===1)));
const crowdedPage=structuredClone(page);
crowdedPage.blocks[0].lines=crowdedPage.blocks[0].lines.slice(0,12);
const crowdedPlan=ocrFrameLayout(crowdedPage),crowdedFrames=[...crowdedPlan.values()].flat();
assert(crowdedFrames.length>480&&crowdedFrames.length<=512,'dense scans use available precision instead of grouping every pair');
assert([...crowdedPlan.values()].every(frames=>frames.length>=40),'remaining precision is shared across all lines');
assert.equal(crowdedFrames.reduce((sum,frame)=>sum+frame.items.length,0),600,'every glyph is assigned once');
const generatedPage=structuredClone(crowdedPage), generatedName='TKInk'+'a'.repeat(24);
generatedPage.blocks[0].lines.forEach((line,index)=>line.items[0].words.forEach((word,j)=>{
  if((index+j)%4===0)Object.assign(word,{font:generatedName,fontAssetId:'font:'+generatedName});
}));
const generatedBefore=structuredClone(generatedPage),generatedPlan=ocrFrameLayout(generatedPage),generatedFrames=[...generatedPlan.values()].flat();
assert(generatedFrames.length<=512&&generatedFrames.reduce((n,f)=>n+f.items.length,0)===600);
assert(generatedFrames.every(frame=>!frame.items.some(item=>item.fontAssetId==='font:'+generatedName)||frame.items.length===1),
  'generated OCR glyphs have independent origins instead of pushing an ordinary neighbour through reader-specific CJK advances');
assert.deepEqual(generatedPage,generatedBefore,'planning does not mutate glyphs, source styles or geometry');
const overfull=structuredClone(crowdedPage);
overfull.blocks[0].lines.forEach(line=>line.items[0].words.forEach(word=>Object.assign(word,{font:generatedName,fontAssetId:'font:'+generatedName})));
assert.throws(()=>ocrFrameLayout(overfull),error=>error.code==='layout-quality','unisolatable generated glyphs cannot silently exceed the existing page frame budget');
const ordinaryBefore=structuredClone(crowdedPage);
assert.throws(()=>ocrFrameLayout(crowdedPage,{generatedWord:()=>true}),error=>error.code==='layout-quality',
  'the font proposer can preflight future replacements before mutating its scene');
assert.deepEqual(crowdedPage,ordinaryBefore);
const overfullLines=structuredClone(page);
overfullLines.blocks[0].lines=Array.from({length:500},(_,i)=>{
  const line=structuredClone(page.blocks[0].lines[0]);line.id='single'+i;
  line.items[0].words=line.items[0].words.slice(0,1);return line;
});
assert.throws(()=>ocrFrameLayout(overfullLines,{generatedWord:()=>true}),error=>error.code==='layout-quality',
  'one generated glyph per line still requires a mandatory frame and cannot bypass the shared budget');
const fixture=await PDFDocument.create(),face=await fixture.embedFont(StandardFonts.Helvetica);
fixture.addPage([300,200]).drawText('A, variable-width line.',{x:20,y:140,size:12,font:face});
fixture.registerFontkit(fontkit);
const cjkFace=await fixture.embedFont(await readFile('public/assets/fonts/Alibaba-PuHuiTi-Medium.ttf'),{subset:true});
fixture.addPage([300,200]).drawText('中文标点，“字距”需要保持。',{x:20,y:140,size:12,font:cjkFace});
const task=getDocument({data:await fixture.save(),fontExtraProperties:true,verbosity:0,standardFontDataUrl:'node_modules/pdfjs-dist/standard_fonts/',cMapUrl:'node_modules/pdfjs-dist/cmaps/',cMapPacked:true,wasmUrl:'node_modules/pdfjs-dist/wasm/'});
try{
  const pdf=await task.promise,p=await pdf.getPage(1),canvas=createCanvas(1,1),op={optionalContentConfig:await pdf.getOptionalContentConfig({intent:'display'})};
  const snapshot=await snapshotPage(p,OPS,()=>{},op.optionalContentConfig);await renderPage(p,canvas,op);snapshot.fonts=snapshotFonts(p,snapshot.fontIds);
  const scene=prepareWordScene(snapshot,{pixels:canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,width:canvas.width,height:canvas.height,measurementContext:canvas.getContext('2d')});
  const value=scene.items.find(item=>item.type==='text');assert(value.words.length<10,'ordinary Latin words retain shaping instead of becoming isolated glyphs');
  assert.equal(value.words.map(word=>word.text).join(''),value.text.replace(/\s/g,''));
  assert(value.words.every(word=>Number.isFinite(word.baselineX)&&word.advanceWidth>0));
  const chinese=await pdf.getPage(2),cjkSnapshot=await snapshotPage(chinese,OPS,()=>{},op.optionalContentConfig);
  await renderPage(chinese,canvas,op);cjkSnapshot.fonts=snapshotFonts(chinese,cjkSnapshot.fontIds);
  const cjkScene=prepareWordScene(cjkSnapshot,{pixels:canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,width:canvas.width,height:canvas.height,measurementContext:canvas.getContext('2d')});
  const cjkText=cjkScene.items.find(item=>item.type==='text');assert(cjkText,'a valid embedded CJK face retains native editable text');assert(cjkText.words.length>8,'CJK punctuation keeps individual source advances');
  assert.equal(cjkText.words.map(word=>word.text).join(''),cjkText.text.replace(/\s/g,''));
  canvas.width=canvas.height=0;
}finally{await task.destroy();}
{
  const records=new Map([
    ['missing',Object.freeze({name:'FZH4FW--GB1-0',loadedName:'FZH4FW',missingFile:true})],
    ['embedded',Object.freeze({name:'FZH4FW--GB1-0',loadedName:'embedded',missingFile:false})],
    ['unknown',Object.freeze({name:'UnknownDisplay',loadedName:'unknown',missingFile:true})],
    ['unsafe',Object.freeze({name:'FZH4FW--GB1-0',loadedName:'bad"name',missingFile:true})],
  ]);
  const aliases=missingFontAliases({commonObjs:{get:id=>records.get(id)}},[...records.keys()]);
  assert.deepEqual([...aliases],[['"FZH4FW"','"SimHei"']]);
  const canvas=createCanvas(350,100),context=canvas.getContext('2d'),proxy=missingFontContext(context,aliases);
  assert.equal(missingFontContext(context,new Map()),context,'ordinary rendering keeps its original context');
  assert.equal(proxy.canvas,canvas);proxy.font='24px "FZH4FW", sans-serif';
  assert.match(context.font,/SimHei/);proxy.fillText('SCHEME',10,50);
  assert.equal(proxy.measureText('SCHEME').width,context.measureText('SCHEME').width,'native context methods keep their real receiver');
  assert.equal(records.get('missing').loadedName,'FZH4FW','read-only PDF.js font objects are never changed');
  canvas.width=canvas.height=0;
}
{
  const canvas=createCanvas(1200,270),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,1200,270);ctx.fillStyle='black';ctx.font='bold 100px "SimHei"';ctx.fontKerning='none';
  const glyphPositions=[];let x=40;
  for(const text of'车辆'){
    const m=ctx.measureText(text);ctx.fillText(text,x,180);
    glyphPositions.push({text,rect:{x:(x-m.actualBoundingBoxLeft)/3,y:(180-m.actualBoundingBoxAscent)/3,
      width:(m.actualBoundingBoxLeft+m.actualBoundingBoxRight)/3,height:(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)/3}});x+=m.width;
  }
  const left=Math.min(...glyphPositions.map(g=>g.rect.x)),top=Math.min(...glyphPositions.map(g=>g.rect.y));
  const right=Math.max(...glyphPositions.map(g=>g.rect.x+g.rect.width)),bottom=Math.max(...glyphPositions.map(g=>g.rect.y+g.rect.height));
  const item={id:'display',type:'text',text:'车辆',font:'UnavailableHeavyDisplay',size:100/3,baseline:60,
    rect:{x:left,y:top,width:right-left,height:bottom-top},glyphPositions,sourceIds:['display'],color:'000000'};
  assert(nativeDisplayCandidate(item));
  for(const mutate of[
    i=>{i.ocr=true;},i=>{i.raster=true;},i=>{i.font='SimHei';},i=>{i.sourceIds=['other'];},
    i=>{i.glyphPositions.pop();},i=>{i.size=12;},i=>{i.text='x=1';},
  ]){const rejected=structuredClone(item);mutate(rejected);assert(!nativeDisplayCandidate(rejected),'unproven/ordinary text cannot enter display-font proposals');}
  const scene={number:1,width:400,height:90,items:[item],sources:[{id:'display',text:'车辆',rect:item.rect,disposition:'editable'}],rules:[],risks:[],characters:2};
  const pixels=ctx.getImageData(0,0,1200,270).data,source=pixels.slice(),ledger=structuredClone(scene.sources);
  const control=structuredClone(scene),canvases=[];
  // The Node canvas backend substitutes default dimensions for zero. Observe
  // the reset operations themselves; browser worker disposal is checked apart.
  const create=(w,h)=>{
    const c=createCanvas(w,h),record={widthReset:false,heightReset:false};canvases.push(record);
    return new Proxy(c,{get(target,key){const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;},
      set(target,key,value){if(value===0&&key==='width')record.widthReset=true;if(value===0&&key==='height')record.heightReset=true;return Reflect.set(target,key,value,target);}});
  };
  calibrateNativeTypography(control,pixels,1200,270,createOcrTypography(createCanvas));
  control.items[0].words=control.items[0].words.map(w=>({...w,font:'KaiTi',fontFamily:'KaiTi',bold:false}));
  const refined=structuredClone(control);
  createNativeDisplayFitter(create)(refined,pixels,1200,270,new Map([['display',structuredClone(item)]]));
  const paint=async scene=>{const target=createCanvas(1200,270);await renderResultPage(inferDocument([scene],{preserveGeometry:true}).pages[0],target,new Map());const data=target.getContext('2d').getImageData(0,0,1200,270).data;target.width=target.height=0;return data;};
  const errors=data=>{let n=0;for(let i=0;i<data.length;i+=4)if((data[i]<180)!==(source[i]<180))n++;return n;};
  const prior=errors(await paint(control)),current=errors(await paint(refined));
  assert(current<prior*.9,'actual serialized text painting must improve the independent source glyph pixels');
  assert(refined.items[0].words.every(w=>w.bold),'native bold proposals are not downgraded by the blurry-scan policy');
  assert.deepEqual(refined.sources,ledger);assert.deepEqual(pixels,source);
  assert(!Object.hasOwn(refined.items[0],'nativePixelProbe'),'private experiment diagnostics do not enter the product scene');
  assert(canvases.every(c=>c.widthReset&&c.heightReset),'all owned signature/physical-scoring canvases receive their final reset');
  canvas.width=canvas.height=0;
}
console.log('Native typography: known source text, actual display-font pixels, missing-font isolation, ledger preservation and bounded/released canvases passed.');
