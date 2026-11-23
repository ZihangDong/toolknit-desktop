import assert from 'node:assert/strict';
import {createCanvas,GlobalFonts} from '@napi-rs/canvas';
import {refineScanTextTypography} from '../src/features/pdf-to-word/adapters/scan-text-typography.js';
import {inferDocument,validateCoverage} from '../src/features/pdf-to-word/core/layout.js';
import {createWordBytes} from '../src/features/pdf-to-word/adapters/docx.js';
import JSZip from 'jszip';

const bodyFont=GlobalFonts.has('KaiTi')?'KaiTi':'SimSun';
assert(GlobalFonts.has(bodyFont),'A real installed CJK face must generate the scan fixture');
if(bodyFont!=='KaiTi')console.log('Optional real-KaiTi unavailable; scan emphasis uses installed SimSun source pixels.');

function fixture(scale=4,{residual=false,clippedInk=false}={}){
 const width=1600,height=2200,canvas=createCanvas(width,height),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,width,height);
 const items=[],sources=[];
 function line(text,x,y,{font=bodyFont,size=11,bold=false,mixed=false,badWeights=true,option=false}={}){
  const mc=createCanvas(1,1).getContext('2d'),words=[];let cursor=x;
  for(const [i,ch]of [...text].entries()){
   const family=option?(i<2?'Times New Roman':'SimSun'):font,weight=bold||mixed&&i>=text.length-3;
   mc.font=`${weight?'bold ':''}1000px "${family}"`;const m=mc.measureText(ch);
   ctx.font=`${weight?'bold ':''}${size*scale}px "${family}"`;ctx.fillStyle='black';ctx.fillText(ch,cursor*scale,y*scale);
   const rect={x:cursor-m.actualBoundingBoxLeft/1000*size,y:y-m.actualBoundingBoxAscent/1000*size,
    width:(m.actualBoundingBoxLeft+m.actualBoundingBoxRight)/1000*size,height:(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)/1000*size};
   words.push({text:ch,font:family,fontFamily:family,bold:badWeights?i%2===0:weight,size:size+(badWeights?(i%3-1)*.5:0),rect,baseline:y,
    baselineX:cursor,advanceWidth:rect.width,preciseInk:true,confidence:.999,ocrGlyphScore:.8,glyphScale:100});cursor+=m.width/1000*size;
  }
  if(option){const old=words[1];old.size=55;old.font='Calibri';old.fontFamily='Calibri';old.rect={x:words[0].rect.x+words[0].rect.width*.5,y:words[0].rect.y,width:old.rect.x+old.rect.width-(words[0].rect.x+words[0].rect.width*.5),height:words[0].rect.height};words[0].rect={...words[0].rect,width:words[0].rect.width*.5};}
  const x1=Math.min(...words.map(w=>w.rect.x)),y1=Math.min(...words.map(w=>w.rect.y)),right=Math.max(...words.map(w=>w.rect.x+w.rect.width)),bottom=Math.max(...words.map(w=>w.rect.y+w.rect.height));
  const id='s'+items.length,rect={x:x1,y:y1,width:right-x1,height:bottom-y1};
  items.push({id,type:'text',text,font,fontFamily:font,size,bold:badWeights?true:bold,ocr:true,preciseInk:true,sourceIds:[id],rect,baseline:y,words});
  sources.push({id,text,rect:{...rect},disposition:'editable'});
 }
 line('测试正文应当保持清晰自然排版',25,55);
 line('相邻正文不应随机改变粗细字号',25,80);
 line('本行末尾保留真正加粗文字',25,105,{mixed:true});
 line('真正加粗标题20文字',25,150,{font:'SimSun',size:16,bold:true,badWeights:false});
 line('C.③',25,195,{option:true,badWeights:false});
 line('B.②③',150,195,{option:true,badWeights:false});
 line('第1页共11页',130,480,{font:'SimSun',size:10.5});
 if(residual){
  for(let i=0;i<3;i++)line('邻行字号参考保持自然常规字体',25,260+i*24,{font:'SimSun',size:10,badWeights:false});
  line('A.这行较大字号不得误判粗体',25,332,{font:'SimSun',size:10.5,badWeights:false});
  const target=items.at(-1);target.font=target.fontFamily='SimHei';target.bold=false;target.size=10;
  for(const word of target.words){word.font=word.fontFamily='SimHei';word.bold=false;word.size=10;if(clippedInk)word.rect.height*=.92;}
 }
 const scene={number:1,width:width/scale,height:height/scale,items,sources,ocr:true,rules:[],risks:['ocr'],characters:sources.reduce((s,a)=>s+a.text.length,0)};
 return{prepared:{scene,changed:true,pixels:ctx.getImageData(0,0,width,height).data.slice()},data:{width,height,pixels:ctx.getImageData(0,0,width,height).data},canvas};
}
const {prepared,data}=fixture(),originalSources=structuredClone(prepared.scene.sources),sourcePixels=data.pixels.slice(),background=prepared.pixels.slice();
const anchors=prepared.scene.items.map(i=>({rect:{...i.rect},baseline:i.baseline,size:i.size}));
refineScanTextTypography(prepared,data,createCanvas);
assert(prepared.scene.scanTypography.lines>=4);
for(const line of prepared.scene.items.slice(0,2)){
 assert(line.words.every(w=>w.bold===false),'ordinary source text remains regular despite alternating initial emphasis');
 assert.equal(new Set(line.words.map(w=>w.size)).size,1,'one physical em per ordinary line');
 assert(line.words.every(w=>w.ocrStyleCohort));
}
const mixed=prepared.scene.items[2];
assert(mixed.words.slice(-3).every(w=>w.bold),'a genuinely bold source span survives');
assert(mixed.words.slice(0,-3).every(w=>!w.bold));
assert(prepared.scene.items[3].words.every(w=>w.bold),'a truly bold heading is not flattened');
for(const line of prepared.scene.items.slice(4,6)){
 assert.equal(line.ocrCoherentTypography?.kind,'isolated-option');
 const dot=line.words.find(w=>w.text==='.');assert(dot.size<20);assert(dot.rect.height<3);assert(dot.ocrOptionInkFit);
 assert(line.words.every(w=>w.ocrOptionInkFit),'the full letter and circled number are accounted for with the dot');
}
assert.deepEqual(prepared.scene.sources,originalSources);assert.deepEqual(data.pixels,sourcePixels);assert.deepEqual(prepared.pixels,background);
assert.deepEqual(prepared.scene.items.map(i=>({rect:i.rect,baseline:i.baseline,size:i.size})),anchors,'style repairs preserve source line grouping and reading-order anchors');
const document=inferDocument([prepared.scene],{preserveGeometry:true});validateCoverage(document);
const result=await createWordBytes(document,[],{preserveGeometry:true}),zip=await JSZip.loadAsync(result.bytes),xml=await zip.file('word/document.xml').async('string');
assert(xml.includes('C'));assert(xml.includes('③'));assert(!xml.includes('TKInk'));
const refuses=fixture();const before=structuredClone(refuses.prepared.scene);refineScanTextTypography(refuses.prepared,refuses.data,createCanvas,{pixelBudget:1});
assert.deepEqual(refuses.prepared.scene.items,before.items,'exhausted work cannot partially restyle a line');
const cancelled=fixture();assert.throws(()=>refineScanTextTypography(cancelled.prepared,cancelled.data,createCanvas,{check:()=>{throw new Error('cancelled');}}),/cancelled/);
for(const clippedInk of [false,true]){
 const residual=fixture(4,{residual:true,clippedInk});refineScanTextTypography(residual.prepared,residual.data,createCanvas);
 const repaired=residual.prepared.scene.items.at(-1);
 assert(repaired.ocrCoherentTypography?.regularEmRepair,'source-sized regular retry recovers a line rejected by the rounded cohort, including underestimated ink height');
 assert.equal(repaired.ocrCoherentTypography.font,'SimSun');
 assert.equal(repaired.ocrCoherentTypography.bold,false);
 assert.equal(repaired.ocrCoherentTypography.size,10.5);
 assert(repaired.words.filter(w=>/^\p{Script=Han}$/u.test(w.text)).every(w=>w.bold===false&&w.size===10.5));
}
console.log('Scan typography: source regular/bold spans, coherent size, complete option punctuation, original content/pixels, real DOCX, budget and cancellation passed.');
