import assert from 'node:assert/strict';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import {fitSourceOwnedColons as refineSourceColon} from '../src/features/pdf-to-word/adapters/ocr-colon-typography.js';
import {isolatedInkComponents} from '../src/features/pdf-to-word/core/ocr-ink-components.js';
import {sceneLayoutBytes} from '../src/features/pdf-to-word/core/scene-budget.js';
import {inferDocument,leafBlocks} from '../src/features/pdf-to-word/core/layout.js';
import {resultTargets,layoutEditedText,applyResultEdits} from '../src/features/pdf-to-word/core/result-edit.js';
import {measureResultText} from '../src/features/pdf-to-word/result-preview.js';
import {createWordBytes} from '../src/features/pdf-to-word/adapters/docx.js';
import JSZip from 'jszip';
// Use one font alias for both source and writer in this synthetic test. The
// real FangSong/localized-family reader path is independently tested in WPS.
const fixtureFont=GlobalFonts.registerFromPath('public/assets/fonts/NotoSansSC-Regular.ttf','SimHei');assert(fixtureFont);
try {
const make=({sourceSize=17,oldSize=21}={})=>{
 const width=800,height=400,canvas=createCanvas(width,height),ctx=canvas.getContext('2d'),scale=4,baseline=60;
 ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.fillStyle='#000';ctx.fontKerning='none';
 const text='文档所在地址:',words=[];
 for(const[index,char]of [...text].entries()){
  const colon=char===':',size=colon?sourceSize:14.5,x=20+index*16;
  ctx.font=`${size*scale}px "SimHei"`;ctx.fillText(char,x*scale,baseline*scale);
  const pixels=ctx.getImageData(0,0,width,height).data;
  let left=width,top=height,right=0,bottom=0;
  for(let y=0;y<height;y++)for(let xx=x*scale-5;xx<(x+16)*scale;xx++)if(Math.min(pixels[(y*width+xx)*4],pixels[(y*width+xx)*4+1],pixels[(y*width+xx)*4+2])<180){left=Math.min(left,xx);top=Math.min(top,y);right=Math.max(right,xx+1);bottom=Math.max(bottom,y+1);}
  const rect={x:left/scale,y:top/scale,width:(right-left)/scale,height:(bottom-top)/scale};
  words.push({text:char,rect,size:colon?oldSize:size,font:'SimHei',fontFamily:'SimHei',baseline,baselineX:rect.x,advanceWidth:rect.width,confidence:colon?.7578:.9999,ocrGlyphScore:.7,preciseInk:true,glyphScale:100,bold:false,italic:false,color:'000000'});
 }
 const x=Math.min(...words.map(w=>w.rect.x)),y=Math.min(...words.map(w=>w.rect.y)),right=Math.max(...words.map(w=>w.rect.x+w.rect.width)),bottom=Math.max(...words.map(w=>w.rect.y+w.rect.height));
 const rect={x,y,width:right-x,height:bottom-y},item={id:'source',sourceIds:['source'],text,type:'text',ocr:true,preciseInk:true,font:'SimHei',fontFamily:'SimHei',size:14.5,baseline,rect,words,ocrFontScore:.85,bold:false,italic:false};
 const scene={number:1,width:width/scale,height:height/scale,items:[item],sources:[{id:item.id,text,rect,disposition:'editable'}],rules:[],risks:[],characters:text.length};
 const data={pixels:ctx.getImageData(0,0,width,height).data,width,height};canvas.width=canvas.height=0;
 return{scene,data,createCanvas,allowance:{remaining:4000000},accepted:new Set(),maxChanges:128};
};
const row=make(),before=structuredClone(row.scene),word=row.scene.items[0].words.at(-1);
refineSourceColon(row);

assert.equal(row.accepted.size,1);
assert.equal(word.text,before.items[0].words.at(-1).text);assert.equal(word.confidence,before.items[0].words.at(-1).confidence);
assert.deepEqual(row.scene.items[0].words.slice(0,-1),before.items[0].words.slice(0,-1));assert.deepEqual(row.scene.sources,before.sources);
assert.equal(sceneLayoutBytes(row.scene)-sceneLayoutBytes(before),1024,'retained score metadata is charged to the unchanged working cap');
const invalidProof=structuredClone(before);invalidProof.items[0].words.at(-1).ocrColonFit=null;
assert.equal(sceneLayoutBytes(invalidProof)-sceneLayoutBytes(before),1024,'an invalid marker cannot reduce the charge');
const after=structuredClone(row.scene);refineSourceColon(row);assert.deepEqual(row.scene,after,'an accepted fit is not fitted again');
const rows=[{name:'same-font-size-and-geometry-repair-no-spelling-or-neighbour-change',pass:true}];
for(const[name,alter]of[
 ['normal-size',f=>{f.scene.items[0].words.at(-1).size=14.5;}],
 ['below-punctuation-confidence',f=>{f.scene.items[0].words.at(-1).confidence=.69;}],
 ['native',f=>{f.scene.items[0].ocrNative=true;}],
 ['generated-font',f=>{f.scene.items[0].words.at(-1).fontAssetId='font:existing';}],
 ['accepted-fit',f=>{f.accepted.add(f.scene.items[0].words.at(-1));}],
 ['existing-physical-fit',f=>{f.scene.items[0].words.at(-1).ocrPhysicalFit={phase:'prior'};}],
 ['unproven-parent-font',f=>{delete f.scene.items[0].ocrFontScore;}],
 ['coloured-word',f=>{f.scene.items[0].words.at(-1).color='B01010';}],
 ['invalid-size',f=>{f.scene.items[0].words.at(-1).size=NaN;}],
 ['too-few-anchors',f=>{f.scene.items[0].words.slice(0,-1).forEach(w=>w.confidence=.8);}],
 ['duplicate-owner',f=>{f.scene.sources.push({...f.scene.sources[0]});}],
 ['unowned-source',f=>{f.scene.sources=[];}],
 ['no-budget',f=>{f.allowance.remaining=0;}],
 ['invalid-budget',f=>{f.allowance.remaining=Infinity;}],
 ['invalid-dimensions',f=>{f.data.width=0;}],
 ['partial-probe-budget',f=>{f.allowance.remaining=15000;}],
 ['table',f=>{f.scene.items=[{type:'table',cells:[{blocks:f.scene.items}]}];}],
 ['rule-crosses-source',f=>{const r=f.scene.items[0].words.at(-1).rect;f.scene.rules.push({axis:'h',at:r.y+r.height/2,from:r.x-1,to:r.x+r.width+1});}],
 ['extra-component',f=>{const w=f.scene.items[0].words.at(-1),x=Math.round((w.rect.x+w.rect.width/2)*4),y=Math.round((w.rect.y+w.rect.height/2)*4);for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const at=((y+dy)*f.data.width+x+dx)*4;f.data.pixels[at]=f.data.pixels[at+1]=f.data.pixels[at+2]=0;}}]
]){
 const f=make();alter(f);const old=structuredClone(f.scene),initial=f.accepted.size;refineSourceColon(f);assert.equal(f.accepted.size,initial,name);assert.deepEqual(f.scene,old,name);rows.push({name,pass:true});
}
const cancelled=make();cancelled.check=()=>{throw Object.assign(Error('cancelled'),{code:'cancelled'});};const old=structuredClone(cancelled.scene);
assert.throws(()=>refineSourceColon(cancelled),e=>e.code==='cancelled');assert.deepEqual(cancelled.scene,old);rows.push({name:'cancellation-before-mutation',pass:true});
// NAPI clamps a native zero-sized surface; record the release assignments,
// while the real browser/Worker regression verifies browser rendering itself.
function trackedCanvas(owned,w,h){
 const c=createCanvas(w,h),state={width:w,height:h};
 for(const axis of['width','height']){const descriptor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(c),axis);Object.defineProperty(c,axis,{get:()=>descriptor.get.call(c),set:value=>{state[axis]=value;descriptor.set.call(c,value);}});}
 owned.push(state);return c;
}
const traced=make(),canvases=[];let calls=0;
traced.check=()=>{calls++;};traced.createCanvas=(w,h)=>trackedCanvas(canvases,w,h);
refineSourceColon(traced);assert.equal(traced.accepted.size,1);assert(canvases.every(c=>c.width===0&&c.height===0));
for(const at of new Set([Math.floor(calls/3),Math.floor(calls*2/3),calls])){
 const f=make(),previous=structuredClone(f.scene),owned=[];let count=0;
 f.check=()=>{if(++count===at)throw Object.assign(Error('cancelled'),{code:'cancelled'});};
 f.createCanvas=(w,h)=>trackedCanvas(owned,w,h);
 assert.throws(()=>refineSourceColon(f),e=>e.code==='cancelled');assert.deepEqual(f.scene,previous);assert.equal(f.accepted.size,0);assert(owned.every(c=>c.width===0&&c.height===0));
 rows.push({name:'mid-probe-cancellation-and-canvas-release-'+at,pass:true});
}
const failure=make(),owned=[];failure.createCanvas=(w,h)=>{if(owned.length)throw Error('canvas-unavailable');return trackedCanvas(owned,w,h);};
assert.throws(()=>refineSourceColon(failure),/canvas-unavailable/);assert.equal(failure.accepted.size,0);assert(owned.every(c=>c.width===0&&c.height===0));rows.push({name:'unknown-failure-surfaces-and-releases',pass:true});
const mask=Uint8Array.from([0,1,1,0,0,1,1,0,0,0,0,0,0,1,1,0,0,1,1,0]),saved=mask.slice(),parts=isolatedInkComponents(mask,4,5);
assert.equal(parts.length,2);assert.equal(parts.reduce((n,p)=>n+p.points.length,0),8);assert.equal(new Set(parts.flatMap(p=>p.points)).size,8);assert.deepEqual(mask,saved);
assert.equal(isolatedInkComponents(Uint8Array.from([1,0,0,1]),2,2).length,1,'diagonal strokes stay connected');
assert.equal(isolatedInkComponents(Uint8Array.from({length:18},(_,i)=>i%2===0?1:0),18,1),null,'excess components are refused without dropping noise');
assert.equal(isolatedInkComponents(new Uint8Array(262145),262145,1),null);
assert.equal(isolatedInkComponents(mask,2,2),null);
assert.throws(()=>isolatedInkComponents(mask,4,5,{check:cancelled.check}),e=>e.code==='cancelled');
rows.push({name:'bounded-components-preserve-all-pixels-connectivity-and-cancellation',pass:true});
const document=inferDocument([row.scene],{preserveGeometry:true}),page=document.pages[0],target=resultTargets(page).find(t=>t.type==='text');
const context=createCanvas(1,1).getContext('2d'),measure=(text,style)=>measureResultText(text,style,context);
measure.metrics=(text,style)=>measureResultText.metrics(text,style,context);
const edit=layoutEditedText(target,target.text.replace('文','公'),measure,{page}),edited=applyResultEdits(document,{[target.key]:edit});
const colon=leafBlocks(edited.pages[0].blocks).flatMap(b=>(b.lines||[]).flatMap(l=>l.items)).find(i=>i.text===':');
assert(colon);assert.equal(colon.size,word.size);assert.equal(colon.font,word.font);assert.equal(colon.baseline,word.baseline);
const result=await createWordBytes(edited,[],{preserveGeometry:true}),zip=await JSZip.loadAsync(result.bytes),xml=await zip.file('word/document.xml').async('string');
const colonRun=[...xml.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)].find(m=>m[1].includes('>:</w:t>'));
assert(colonRun);assert.match(colonRun[1],new RegExp('<w:sz w:val="'+Math.round(word.size*2)+'"'));assert(xml.includes('公'));
rows.push({name:'adjacent-character-edit-and-actual-docx-preserve-colon-style',pass:true});
console.log(JSON.stringify({passed:rows.length}));
} finally { GlobalFonts.remove(fixtureFont); }
