import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {Document,Packer,TextRun} from 'docx';
import JSZip from 'jszip';
import {nativeUnicodeScalarMetric,nativeUnicodeScalarItem,nativeUnicodeScalarCandidates,nativeUnicodeScalarRegion} from '../src/features/pdf-to-word/core/native-unicode-scalars.js';
import {nativeUnicodeScalarFontCovered} from '../src/features/pdf-to-word/adapters/native-unicode-scalar-font.js';
import {sourceNativeUnicodeScalar,nativeUnicodeScalarMeasurement} from '../src/features/pdf-to-word/core/native-unicode-scalars.js';
import {createNativeMathMeasurer} from '../src/features/pdf-to-word/core/native-math-layout.js';
import {groupPageRegions} from '../src/features/pdf-to-word/core/regions.js';
import {mathUnicodeRunStyle} from '../src/features/pdf-to-word/core/font-style.js';
import {inferMathAst} from '../src/features/pdf-to-word/core/math.js';
import {nativeMathReaderMode} from '../src/features/pdf-to-word/core/native-math-policy.js';
import {nativeMath} from '../src/features/pdf-to-word/adapters/docx-math.js';
import {positionedFrameCost,MAX_POSITIONED_FRAMES} from '../src/features/pdf-to-word/core/positioned-budget.js';
import {positionedPage} from '../src/features/pdf-to-word/adapters/docx-positioned.js';
import {runOptions,originX,measureLineBox,positionedTextRuns} from '../src/features/pdf-to-word/adapters/text-layout.js';
import {PdfParagraph as Paragraph} from '../src/features/pdf-to-word/adapters/docx-paragraph.js';

const context=createCanvas(1,1).getContext('2d');let checks=0;
const test=(name,fn)=>{fn();checks++;};
const make=(text='𝑁',id='glyph',x=50)=>({id,type:'text',sourceIds:[id],text,font:'ABCDEF+XITSMath-Regular',fontFamily:'serif',size:10.5,
  rect:{x,y:80,width:8,height:7},baseline:87,baselineX:x-.3,advanceWidth:8.5,preciseInk:true,raster:false,
  bold:false,italic:false,color:'000000',order:1,glyphPositions:[{text,rect:{x,y:80,width:8,height:7}}]});
const ledger=g=>({id:g.id,text:g.text,rect:{...g.rect},order:g.order,disposition:'editable'});
const g=make(),source=ledger(g),bounds={x:0,y:0,width:500,height:700};
const group=(items,graphics=[],sources=items.map(ledger))=>groupPageRegions(items,graphics,[],sources,{bounds});
const region=group([structuredClone(g)]).items.find(nativeUnicodeScalarRegion);assert(region);

test('Verified cmap/hmtx profile retains three independent known records',()=>{
 assert.deepEqual(nativeUnicodeScalarMetric('𝑁'),{codePoint:0x1d441,glyphId:1840,advanceAt1000:1500/2048*1000});
 assert.deepEqual(nativeUnicodeScalarMetric('𝛱'),{codePoint:0x1d6f1,glyphId:1998,advanceAt1000:1466/2048*1000});
 assert.deepEqual(nativeUnicodeScalarMetric('𝛴'),{codePoint:0x1d6f4,glyphId:2001,advanceAt1000:1243/2048*1000});
 for(const text of ['N','Π','Σ','𝗡','𝓝','𝟙','𝑏','𝛼','𝑁𝑁','\ud835'])assert.equal(nativeUnicodeScalarMetric(text),null);
 assert.equal(mathUnicodeRunStyle('𝑏'),'italic','Established Latin style survives without admitting an unverified standalone scalar');
});
test('Every admitted profile letter has actual matching Canvas advance and preserved Unicode semantics',()=>{
 const points=[0x210e,...Array.from({length:52},(_,i)=>0x1d434+i),...Array.from({length:58},(_,i)=>0x1d6e2+i)];let supported=0;
 for(const cp of points){const text=String.fromCodePoint(cp);if(!nativeUnicodeScalarMetric(text))continue;supported++;
  const item=make(text),r=group([item]).items.find(nativeUnicodeScalarRegion);assert(r,text);
  assert.equal(mathUnicodeRunStyle(text,{sourceProvenUnicodeScalar:true}),'italic');assert.equal(r.mathGlyphs[0].text,text);
  assert.equal(nativeMathReaderMode(inferMathAst(r),r),'unicode');assert(nativeUnicodeScalarFontCovered(r,context),text);
 }assert.equal(supported,16);
});
test('Exact native trace and independent source ledger are required',()=>{
 assert(nativeUnicodeScalarItem(g,source));
 for(const patch of [{id:''},{size:'10.5'},{font:'Times New Roman'},{raster:true},{preciseInk:false},{bold:true},{italic:true},{ocr:true},{mathStyleUncertain:true},{radicalPart:{}},{alphabet:'script'},{nativeCalibrated:true},{fontAssetId:'owned-font'},{baselineX:undefined},{advanceWidth:0},{glyphPositions:[]},{sourceIds:['other']},{text:'N'}])assert.equal(nativeUnicodeScalarItem({...g,...patch},source),false);
 for(const patch of [{id:'other'},{text:'N'},{disposition:'visible-image'},{ocrUnverified:true},{encodingCorrections:[{}]},{rect:{...source.rect,x:51}}])assert.equal(nativeUnicodeScalarItem(g,{...source,...patch}),false);
});
test('Unique ownership, existing groups, foreign overlap and bounded context gate candidate admission',()=>{
 assert.equal(nativeUnicodeScalarCandidates([g],[],[source],[]).length,1);
 assert.equal(nativeUnicodeScalarCandidates([g],[],[source,{...source}],[]).length,0);
 assert.equal(nativeUnicodeScalarCandidates([g],[],[source],[[g]]).length,0);
 assert.equal(nativeUnicodeScalarCandidates([g],[{rect:{...g.rect}}],[source],[]).length,0);
 assert.equal(nativeUnicodeScalarCandidates(Array(20001).fill(g),[],[source],[]).length,0);
 assert.equal(nativeUnicodeScalarCandidates([g],[],null,[]).length,0);
 assert.equal(nativeUnicodeScalarCandidates([g],[],[null],[]).length,0);
 assert.equal(nativeUnicodeScalarCandidates([g],[],[source],[null]).length,0);
});
test('Positive missing-glyph measurement cannot masquerade as coverage and context state is restored',()=>{
 const fake={font:'before',fontKerning:'auto',measureText:()=>({width:816.72,actualBoundingBoxAscent:700,actualBoundingBoxDescent:0,actualBoundingBoxLeft:0,actualBoundingBoxRight:700})};
 assert.equal(nativeUnicodeScalarFontCovered(region,fake),false);assert.equal(fake.font,'before');assert.equal(fake.fontKerning,'auto');
 assert.equal(nativeUnicodeScalarFontCovered(region,null),false);
 assert.equal(nativeUnicodeScalarFontCovered(region,{}),false);
 const throwing={font:'before',fontKerning:'auto',measureText(){throw Error('Unavailable measurement');}};
 assert.equal(nativeUnicodeScalarFontCovered(region,throwing),false);assert.equal(throwing.font,'before');
 assert.throws(()=>nativeMath(inferMathAst(region),region,{measurementContext:fake}),e=>e.code==='native-math-layout');
});
test('Independent scalar promotion preserves unrelated ordinary body sources',()=>{
 const body={...make('ordinary words','body',95),font:'TimesNewRomanPSMT',glyphPositions:undefined,rect:{x:95,y:80,width:70,height:7}};
 const result=group([structuredClone(g),body]);assert.equal(result.items.filter(nativeUnicodeScalarRegion).length,1);
 const unchanged=result.items.find(i=>i.id==='body');assert.equal(unchanged.text,body.text);assert.deepEqual(unchanged.rect,body.rect);assert.equal(unchanged.font,body.font);
});
test('Scalar metadata cannot redefine a compound figure as a newly supported math structure',()=>{
 const one={...make('1','numeral',40),size:9,baseline:66,rect:{x:40,y:60,width:3,height:6},glyphPositions:undefined};
 const sum={...make('∑','sum',48),size:18,baseline:75,rect:{x:48,y:63,width:10,height:12},glyphPositions:undefined};
 const small=make('𝑛','lower',40);Object.assign(small,{size:9,baseline:78,rect:{x:40,y:74,width:4,height:4}});small.glyphPositions[0].rect={...small.rect};
 const bar={id:'rule',type:'image',rect:{x:39,y:68,width:4,height:.4},thin:true,strokeColor:'000000',drawingIds:['rule'],sourceIds:[],order:2};
 const result=group([one,sum,small],[bar]);
 const compound=result.items.filter(i=>i.type==='image'&&i.sourceIds?.length>1&&i.sourceIds.includes('lower'));assert.equal(compound.length,1);
 for(const image of compound)assert.equal(image.role,'figure');
 assert(!result.items.some(i=>i.role==='math'&&i.mathGlyphs?.length>1&&i.sourceIds?.includes('lower')));
});

const textRuns=(line,assets,c)=>positionedTextRuns(line,c).map(r=>r.kind==='space'?new TextRun({text:' ',font:'Arial',size:2,characterSpacing:r.spacing,snapToGrid:false}):new TextRun({...r.options,text:r.item.text,characterSpacing:r.spacing,position:r.position}));
const render=blocks=>positionedPage({width:500,height:700,header:[],footer:[],blocks},[],{textRuns,runOptions,originX,measureLineBox,measurementContext:context,
 empty:()=>new Paragraph({children:[]}),image:()=>{throw Error('Unexpected image fallback');},table:()=>{throw Error('Unexpected table');},mathFor:r=>nativeMath(inferMathAst(r),r,{measurementContext:context})});
test('Standalone and inline scalar reservations retain existing source-face keys and exact 512 cap',()=>{
 assert.equal(MAX_POSITIONED_FRAMES,512);assert.equal(positionedFrameCost([region]),1);assert.equal(positionedFrameCost([{lines:[{items:[region]}]}]),1);
 const a={...make('a'),font:'Times New Roman',sourceFont:'Original-One'},b={...a,id:'second',sourceIds:['second'],sourceFont:'Original-Two'};
 assert.deepEqual(runOptions(a),runOptions(b));assert.equal(positionedFrameCost([{lines:[{items:[a,b]}]}]),2);
 const maximum=Array.from({length:512},()=>structuredClone(region));assert.equal(positionedFrameCost(maximum),512);assert.equal(render(maximum).lines,512);
 assert.equal(positionedFrameCost([...maximum,region]),513);assert.throws(()=>render([...maximum,region]),e=>e.code==='layout-quality');
});
const built=render([region]),doc=new Document({sections:[{children:built.children}]});
const bytes=await Packer.toBuffer(doc),zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');
test('Word serialization preserves editable semantic Unicode, explicit face and native frame',()=>{
 assert(xml.includes('<m:oMath>'));assert(xml.includes('>𝑁</m:t>'));assert(xml.includes('Cambria Math'));assert(xml.includes('<m:sty'));assert(xml.includes('<w:framePr'));assert(!xml.includes('<w:drawing'));
 const edited=xml.replace('>𝑁</m:t>','>𝑀</m:t>');assert.notEqual(edited,xml);assert.equal(edited.replace('>𝑀</m:t>','>𝑁</m:t>'),xml);
});
test('Default Latin, source gamma and source scalar style permissions stay independent',()=>{
 for(const text of ['𝑏','ℎ','𝑁'])assert.equal(mathUnicodeRunStyle(text),'italic');
 for(const text of ['𝛱','𝛴','𝜅','𝜇','𝜈','𝜎']){
  assert.equal(mathUnicodeRunStyle(text),null);assert.equal(mathUnicodeRunStyle(text,{sourceProvenItalicGamma:true}),null);
  assert.equal(mathUnicodeRunStyle(text,{sourceProvenUnicodeScalar:true}),'italic');
 }
 assert.equal(mathUnicodeRunStyle('𝛾'),null);
 assert.equal(mathUnicodeRunStyle('𝛾',{sourceProvenUnicodeScalar:true}),null);
 assert.equal(mathUnicodeRunStyle('𝛾',{sourceProvenItalicGamma:true}),'italic');
 for(const text of ['𝛼','𝛱𝛴','𝛾𝛱'])assert.equal(mathUnicodeRunStyle(text,{sourceProvenUnicodeScalar:true}),null);
});

test('Scalar keeps complete original evidence before consumed ledger disposition changes',()=>{
 const item=make('𝛱'),sources=[ledger(item)],r=group([item],[],sources).items.find(nativeUnicodeScalarRegion);
 assert(r);assert.equal(sources[0].disposition,'visible-image');
 assert.equal(r.sourceNativeUnicodeScalar.source.disposition,'editable');assert(sourceNativeUnicodeScalar(r));
 assert.equal(r.sourceNativeUnicodeScalar.item.glyphPositions[0].text,'𝛱');
 assert.equal(r.sourceNativeUnicodeScalar.item.font,'ABCDEF+XITSMath-Regular');
});

test('Policy and writer reject forged, incomplete or mismatched scalar source proof',()=>{
 const r=group([make('𝛱')]).items.find(nativeUnicodeScalarRegion);assert(r);
 for(const mutate of [x=>{x.sourceNativeUnicodeScalar=true;},x=>{delete x.sourceNativeUnicodeScalar.item.glyphPositions;},
  x=>{x.sourceNativeUnicodeScalar.source.text='Π';},x=>{x.sourceNativeUnicodeScalar.source.disposition='hidden';},
  x=>{x.sourceNativeUnicodeScalar.item.font='Times New Roman';},x=>{x.sourceNativeUnicodeScalar.item.rect.x+=1;}]){
  const bad=structuredClone(r);mutate(bad);assert(!sourceNativeUnicodeScalar(bad));
  assert.equal(nativeMathReaderMode(inferMathAst(bad),bad),null);
  assert.throws(()=>nativeMath(inferMathAst(bad),bad,{measurementContext:context}),e=>e.code==='native-math-layout');
 }
});

const exactMeasure=format=>{
 context.font=`1000px "${format.font}"`;context.fontKerning='none';const m=context.measureText(format.text),unit=format.size/1000;
 return {width:m.width*unit*format.scale/100+[...format.text].length*format.spacing,
  height:m.actualBoundingBoxAscent*unit,depth:m.actualBoundingBoxDescent*unit};
};
const piRegion=group([make('𝛱')]).items.find(nativeUnicodeScalarRegion);
const piEquation=nativeMath(inferMathAst(piRegion),piRegion,{measurementContext:context}).prepForXml({stack:[]})['m:oMath'];

test('Measurer accepts scalar permission only with the same complete single-source region',()=>{
 for(const options of [{},{sourceProvenItalicGamma:true},{sourceProvenUnicodeScalar:true},
  {sourceProvenUnicodeScalar:{...piRegion,sourceNativeUnicodeScalar:true}}])
  assert.throws(()=>createNativeMathMeasurer(exactMeasure,options)(piEquation,10),e=>e.code==='native-math-layout');
 const measured=createNativeMathMeasurer(exactMeasure,{sourceProvenUnicodeScalar:piRegion})(piEquation,10);
 assert(measured.width>0);
});

test('Measurer verifies the same bounded hmtx instead of accepting any positive box',()=>{
 const wrong=format=>({...exactMeasure(format),width:exactMeasure(format).width+.2});
 assert.throws(()=>createNativeMathMeasurer(wrong,{sourceProvenUnicodeScalar:piRegion})(piEquation,10),e=>e.code==='native-math-layout');
});

test('Writer rechecks actual glyph hmtx after initial font coverage',()=>{
 const real=createCanvas(1,1).getContext('2d');let calls=0;
 const unstable={get font(){return real.font;},set font(x){real.font=x;},get fontKerning(){return real.fontKerning;},set fontKerning(x){real.fontKerning=x;},
  measureText(text){const m=real.measureText(text),out={};for(const k of ['width','actualBoundingBoxLeft','actualBoundingBoxRight','actualBoundingBoxAscent','actualBoundingBoxDescent','fontBoundingBoxAscent','fontBoundingBoxDescent'])out[k]=m[k];if(++calls>1)out.width+=100;return out;}};
 assert.throws(()=>nativeMath(inferMathAst(piRegion),piRegion,{measurementContext:unstable}),e=>e.code==='native-math-layout');assert(calls>=2);
});

test('Shared cmap/hmtx coverage rejects foreign font and missing-glyph measurements',()=>{
 context.font='1000px "Cambria Math"';context.fontKerning='none';const m=context.measureText('𝛱');
 assert(nativeUnicodeScalarMeasurement({font:'Cambria Math',text:'𝛱',metrics:m}));
 assert(!nativeUnicodeScalarMeasurement({font:'Times New Roman',text:'𝛱',metrics:m}));
 assert(!nativeUnicodeScalarMeasurement({font:'Cambria Math',text:'𝛾',metrics:m}));
 assert(!nativeUnicodeScalarMeasurement({font:'Cambria Math',text:'𝛱',metrics:{width:10,actualBoundingBoxLeft:0,actualBoundingBoxRight:10,actualBoundingBoxAscent:10,actualBoundingBoxDescent:0}}));
 assert.equal(group([make('𝛾')]).items.filter(nativeUnicodeScalarRegion).length,0);
});
console.log(JSON.stringify({checks,admittedProfileLetters:16,maximumPositionedFrames:MAX_POSITIONED_FRAMES,status:'synthetic contracts only; reader tolerance gates unchanged'}));
