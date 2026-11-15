// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import {isolatedInkComponents} from '../core/ocr-ink-components.js';
import { contains, overlaps, validRect } from '../core/geometry.js';
import { inferDocument, leafBlocks } from '../core/layout.js';
import { ocrFrameLayout } from '../core/ocr-frame-layout.js';
import { compressedPunctuationChunks } from '../core/text-chunks.js';
import { positionedTextRuns, runOptions } from './text-layout.js';
const fonts=new Set(['SimSun','SimHei','Microsoft YaHei','FangSong','KaiTi']);
const median=xs=>xs.toSorted((a,b)=>a-b)[Math.floor(xs.length/2)];
const parts=(mask,w,h,check)=>isolatedInkComponents(mask,w,h,{check})?.toSorted((a,b)=>a.y-b.y);
function plans(scene,owner,word,replacement,context){
 const page=inferDocument([{...scene,items:scene.items.map(item=>item===owner?{...item,words:item.words.map(w=>w===word?{...replacement,sourceColonProbe:true}:w)}:item)}],{preserveGeometry:true}).pages[0];
 const frames=ocrFrameLayout(page),runs=[];
 for(const b of leafBlocks([...page.header,...page.blocks,...page.footer]))for(const line of b.lines||[])
  for(const chunk of frames.get(line.id)||compressedPunctuationChunks(line))runs.push(...positionedTextRuns(chunk,context).filter(r=>r.kind==='text'));
 return {run:runs.find(r=>r.item.sourceColonProbe&&r.item.text===word.text),runs};
}
function sameOthers(before,after){
 const clean=x=>x.runs.filter(r=>!r.item.sourceColonProbe).map(r=>[r.item.text,r.item.font,r.item.size,!!r.item.bold,!!r.item.italic,r.x,r.baseline,runOptions(r.item)]);
 return JSON.stringify(clean(before))===JSON.stringify(clean(after));
}
/** Fit only oversized two-dot colons with complete source ownership. Spelling,
 * raw recognition, font family and untouched run plans remain unchanged. Uses
 * the physical phase's existing remaining allowance after its accepted fits. */
export function fitSourceOwnedColons({scene,data,createCanvas,allowance,accepted,maxChanges,check=()=>{}}={}){
 check();
 if(!scene||!Array.isArray(scene.items)||scene.items.length>20000||!Array.isArray(scene.sources)||scene.sources.length>20000
  ||!Array.isArray(scene.rules)||scene.rules.length>3000||!Number.isFinite(scene.width+scene.height)||scene.width<=0||scene.height<=0
  ||!(data?.pixels instanceof Uint8ClampedArray)||!Number.isSafeInteger(data.width)||!Number.isSafeInteger(data.height)
  ||data.width<1||data.height<1||data.width*data.height>16000000||data.pixels.length!==data.width*data.height*4
  ||typeof createCanvas!=='function'||!(accepted instanceof Set)||!Number.isInteger(maxChanges)||maxChanges<1||maxChanges>128
  ||!Number.isSafeInteger(allowance?.remaining)||allowance.remaining<=0||allowance.remaining>4000000)return;
 const {pixels,width,height}=data,sx=width/scene.width,sy=height/scene.height;
 if(sx<=0||sy<=0||sx>8||sy>8||!Number.isFinite(sx+sy))return;
 const spend=n=>{check();if(!Number.isSafeInteger(n)||n<1||n>allowance.remaining)return false;allowance.remaining-=n;return true;};
 const sources=new Map(scene.sources.map(s=>[s.id,s]));if(sources.size!==scene.sources.length)return;
 const all=scene.items.flatMap(i=>i.words||[]);let probes=0;
 for(const item of scene.items){
  check();const source=item.sourceIds?.length===1&&sources.get(item.sourceIds[0]);
  if(item.type!=='text'||item.role==='math'||!item.ocr||item.ocrNative||item.raster||item.fontAssetId||item.italic||!item.words||item.words.length<4||item.words.length>96
   ||!fonts.has(item.font)||!(item.ocrFontScore>=.65)||!source||source.disposition!=='editable'||source.text!==item.text||!/[\p{Script=Han}]/u.test(item.text))continue;
  for(const word of item.words){
   check();
   if(accepted.size>=maxChanges||probes>=4)return;
   if(!/^[:：]$/u.test(word.text)||word.font!==item.font||word.fontAssetId||word.ocrColonFit||word.ocrPhysicalFit||word.italic||word.ocrRuling||!word.preciseInk
    ||!Number.isFinite(word.confidence)||word.confidence<.7||word.confidence>1||!validRect(word.rect)||word.rect.width>8||word.rect.height>30||!Number.isFinite(word.size+word.baseline+item.size)||word.size<item.size*1.25||accepted.has(word))continue;
   const color=word.color||item.color||'000000';if(!/^[0-9a-f]{6}$/i.test(color))continue;
   const rgb=[0,2,4].map(at=>parseInt(color.slice(at,at+2),16));if(Math.max(...rgb)>100||Math.max(...rgb)-Math.min(...rgb)>20)continue;
   const anchors=item.words.filter(w=>w!==word&&/^\p{Script=Han}$/u.test(w.text)&&w.confidence>=.98&&w.preciseInk&&w.font===word.font&&!!w.bold===!!word.bold&&Number.isFinite(w.size+w.baseline));
   if(anchors.length<3)continue;
   const nominal=median(anchors.map(w=>w.size)),base=median(anchors.map(w=>w.baseline));
   if(anchors.some(w=>Math.abs(w.size-nominal)>nominal*.15||Math.abs(w.baseline-base)>.65)||word.size<nominal*1.25)continue;
   const r=word.rect,x=Math.max(0,Math.floor((r.x-.5)*sx)),y=Math.max(0,Math.floor((r.y-.5)*sy));
   const w=Math.min(width,Math.ceil((r.x+r.width+.5)*sx))-x,h=Math.min(height,Math.ceil((r.y+r.height+.5)*sy))-y;
   const roi={x:x/sx,y:y/sy,width:w/sx,height:h/sy};
   if(w<4||h<6||w>64||h>192||w*h>10000||!contains(item.rect,roi,1)||all.some(a=>a!==word&&validRect(a.rect)&&overlaps(roi,a.rect,0)))continue;
   if(scene.rules.some(rule=>overlaps(roi,rule.axis==='h'?{x:rule.from,y:rule.at-.25,width:rule.to-rule.from,height:.5}:{x:rule.at-.25,y:rule.from,width:.5,height:rule.to-rule.from},0)))continue;
   if(!spend(w*h))return;probes++;
   const mask=new Uint8Array(w*h);let unsafe=false,ink=0;
   for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
    const at=((y+yy)*width+x+xx)*4,lo=Math.min(pixels[at],pixels[at+1],pixels[at+2]);
    if(lo>=180)continue;mask[yy*w+xx]=1;ink++;if(!xx||!yy||xx===w-1||yy===h-1||pixels[at+3]<240||Math.max(pixels[at],pixels[at+1],pixels[at+2])-lo>20)unsafe=true;
   }
   if(unsafe)continue;const sourceParts=parts(mask,w,h,check);
   if(sourceParts?.length!==2||sourceParts.some(p=>p.points.length<4))continue;
   const[a,b]=sourceParts,aw=a.right-a.x,ah=a.bottom-a.y,bw=b.right-b.x,bh=b.bottom-b.y;
   if(Math.abs(a.x+a.right-b.x-b.right)/2>Math.max(sx*.35,1)||Math.max(aw/bw,bw/aw,ah/bh,bh/ah)>1.8
    ||[aw/ah,bw/bh].some(v=>v<.5||v>2)||b.y-a.bottom<Math.min(ah,bh)*.75)continue;
   const tight={x:(x+Math.min(a.x,b.x))/sx,y:(y+a.y)/sy,width:(Math.max(a.right,b.right)-Math.min(a.x,b.x))/sx,height:(b.bottom-a.y)/sy};
   if(!contains(source.rect,tight,.5))continue;
   let metric,canvas;
   try{
    metric=createCanvas(1,1);const mc=metric.getContext('2d');mc.font=`${word.bold?'bold ':''}1000px "${word.font}"`;mc.fontKerning='none';
    const m=mc.measureText(word.text),heightEm=(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)/1000,widthEm=(m.actualBoundingBoxLeft+m.actualBoundingBoxRight)/1000;
    if(!(heightEm>0&&widthEm>0))continue;
    const fitted=Math.round(tight.height/heightEm*2)/2;
    if(fitted<nominal*.8||fitted>nominal*1.25||fitted<6||fitted>40)continue;
    const pad=Math.ceil(4*Math.max(sx,sy)),pw=w+pad*2,ph=h+pad*2;
    if(!Number.isSafeInteger(pw*ph)||pw*ph>65536)continue;
    canvas=createCanvas(pw,ph);const pc=canvas.getContext('2d',{willReadFrequently:true});
    const baselinePlan=plans(scene,item,word,word,mc);
    const score=candidate=>{
     if(!spend(pw*ph*8))return null;
     const plan=plans(scene,item,word,candidate,mc);if(!plan.run||!sameOthers(baselinePlan,plan))return null;
     const run=plan.run,o=runOptions(run.item),horizontal=(o.scale||100)/100;
     pc.setTransform(1,0,0,1,0,0);pc.fillStyle='#fff';pc.fillRect(0,0,pw,ph);pc.setTransform(sx,0,0,sy,-x+pad,-y+pad);
     pc.font=`${o.italics?'italic ':''}${o.bold?'bold ':''}${o.size/2}px "${o.font.ascii}"`;pc.fontKerning='none';pc.textBaseline='alphabetic';pc.fillStyle='#'+o.color;
     pc.save();pc.translate(run.x,run.baseline);pc.scale(horizontal,1);pc.fillText(run.item.text,0,0);pc.restore();
     const data=pc.getImageData(0,0,pw,ph).data,got=new Uint8Array(pw*ph);let total=0,common=0,clipped=false;
     for(let yy=0;yy<ph;yy++)for(let xx=0;xx<pw;xx++)if(Math.min(data[(yy*pw+xx)*4],data[(yy*pw+xx)*4+1],data[(yy*pw+xx)*4+2])<180){got[yy*pw+xx]=1;total++;clipped||=!xx||!yy||xx===pw-1||yy===ph-1;if(xx>=pad&&yy>=pad&&xx<pad+w&&yy<pad+h)common+=mask[(yy-pad)*w+xx-pad];}
     if(clipped)return null;const observed=parts(got,pw,ph,check);if(observed?.length!==2||observed.some(p=>p.points.length<4))return null;
     const edge=Math.max(...observed.flatMap((p,i)=>['x','y','right','bottom'].map((k,j)=>Math.abs(p[k]-pad-sourceParts[i][k])/(j%2?sy:sx))));
     return{raw:2*common/Math.max(1,total+ink),edge};
    };
    const before=score(word);if(!before||before.edge<=.75)continue;let winner,best=before,complete=true;
    for(const size of[fitted-.5,fitted,fitted+.5]){
     if(size<6||size>40||size<nominal*.8||size>nominal*1.25)continue;
     const scale=Math.round(tight.width/(widthEm*size)*100);if(scale<25||scale>400)continue;
     for(const delta of[-2,0,2]){
      if(scale+delta<25||scale+delta>400)continue;
      const candidate={...word,rect:{...tight},size,glyphScale:scale+delta},after=score(candidate);
      if(!after){complete=false;continue;}
      if(after.edge<=.75&&after.edge<before.edge-1/Math.max(sx,sy)&&after.raw>=Math.max(.8,before.raw+.05)&&(!winner||after.raw>best.raw)){winner=candidate;best=after;}
     }
    }
    check();
    if(winner&&complete){Object.assign(word,winner,{ocrColonFit:{version:1,before,after:best,sourcePixels:ink,sourceComponents:2,spellingAndConfidenceUnchanged:true}});accepted.add(word);}
   }catch(error){
    check();if(error?.code==='cancelled'||error?.name==='AbortError')throw error;
    if(error?.code!=='complexity'&&error?.code!=='layout-quality')throw error;
   }finally{if(metric)metric.width=metric.height=0;if(canvas)canvas.width=canvas.height=0;}
  }
 }
}
