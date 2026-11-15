// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import {validRect,contains,overlaps} from '../core/geometry.js';
import {inferDocument} from '../core/layout.js';
import {ocrFrameLayout} from '../core/ocr-frame-layout.js';
import {runOptions} from './text-layout.js';
import {drawResultText} from './text-rendering.js';
import {isolatedInkComponents as components} from '../core/ocr-ink-components.js';
const boxes=(a,b,sx,sy)=>Math.max(...['x','y','right','bottom'].map((k,i)=>Math.abs(a[k]-b[k])/(i%2?sy:sx)));
function f1(a,b,w,h,radius){
 const cover=(source,target)=>{const expanded=new Uint8Array(w*h);for(const at of target){const xx=at%w,yy=Math.floor(at/w);for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){const x=xx+dx,y=yy+dy;if(x>=0&&y>=0&&x<w&&y<h)expanded[y*w+x]=1;}}return source.reduce((sum,at)=>sum+expanded[at],0)/source.length;};
 const precision=cover(a,b),recall=cover(b,a);return 2*precision*recall/Math.max(1e-9,precision+recall);
}
export function fitLiteralLabelPlacement({scene,data,createCanvas,allowance,accepted=new Set(),maxChanges=128,check=()=>{}}={}){
 if(!(accepted instanceof Set)||!Number.isInteger(maxChanges)||maxChanges<1||maxChanges>128)return;
 if(!scene||!Array.isArray(scene.items)||scene.items.length>20000||!Array.isArray(scene.sources)||scene.sources.length>20000||typeof createCanvas!=='function'||!Number.isFinite(allowance?.remaining)||allowance.remaining<=0)return;
 const {pixels,width,height}=data||{};
 if(!(pixels instanceof Uint8ClampedArray)||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16000000||pixels.length!==width*height*4)return;
 const sx=width/scene.width,sy=height/scene.height;if(![sx,sy].every(v=>Number.isFinite(v)&&v>0&&v<=8))return;
 const sources=new Map(scene.sources.map(s=>[s.id,s]));
 const spend=n=>{check();if(!Number.isSafeInteger(n)||n<1||n>allowance.remaining)return false;allowance.remaining-=n;return true;};
 let inspected=0;
 for(const item of scene.items){
  check();
  if(item.type!=='text'||!item.ocr||item.ocrNative||item.raster||item.fontAssetId||item.words?.length||!item.preciseInk||item.italic||item.ocrLiteralPlacement
   ||!/^-[0-9]{1,6}-$/.test(item.text||'')||!Number.isFinite(item.confidence)||item.confidence<.7||item.confidence>1
   ||!(item.ocrRecognitionConfidence>=.98)||!validRect(item.rect)||item.rect.y<scene.height*.8
   ||item.sourceIds?.length!==1||item.sourceIds[0]!==item.id||!['Microsoft YaHei','Arial','Calibri','Cambria','Times New Roman','SimSun','FangSong','SimHei','KaiTi'].includes(item.fontFamily))continue;
  if(++inspected>4)return;
  const source=sources.get(item.id);if(!source||source.disposition!=='editable'||source.text!==item.text||!validRect(source.rect))continue;
  const x=Math.max(0,Math.floor(item.rect.x*sx)-2),y=Math.max(0,Math.floor(item.rect.y*sy)-2),right=Math.min(width,Math.ceil((item.rect.x+item.rect.width)*sx)+2),bottom=Math.min(height,Math.ceil((item.rect.y+item.rect.height)*sy)+2),w=right-x,h=bottom-y;
  if(w<3||h<3||w>512||h>128||w*h>32768)continue;
  const roi={x:x/sx,y:y/sy,width:w/sx,height:h/sy};
  if(scene.items.some(peer=>peer!==item&&peer.type==='text'&&validRect(peer.rect)&&overlaps(roi,peer.rect,0)))continue;
  if((scene.rules||[]).some(rule=>rule.axis==='h'?overlaps(roi,{x:rule.from,y:rule.at-.25,width:rule.to-rule.from,height:.5},0):rule.axis==='v'&&overlaps(roi,{x:rule.at-.25,y:rule.from,width:.5,height:rule.to-rule.from},0)))continue;
  if(!spend(w*h*12))return;
  const mask=new Uint8Array(w*h);let unsafe=false;
  for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
   const at=((y+yy)*width+x+xx)*4,low=Math.min(pixels[at],pixels[at+1],pixels[at+2]);if(low>=180)continue;
   if(!xx||!yy||xx===w-1||yy===h-1||pixels[at+3]<240||Math.max(pixels[at],pixels[at+1],pixels[at+2])-low>30)unsafe=true;mask[yy*w+xx]=1;
  }
  const parts=unsafe?null:components(mask,w,h);
  if(!parts||parts.length!==item.text.length||parts.some((p,i)=>p.points.length<4||i&&p.x<parts[i-1].right))continue;
  if(accepted.size+parts.length>maxChanges)continue;
  const tight={x:(x+parts[0].x)/sx,y:(y+Math.min(...parts.map(p=>p.y)))/sy,width:(parts.at(-1).right-parts[0].x)/sx,height:(Math.max(...parts.map(p=>p.bottom))-Math.min(...parts.map(p=>p.y)))/sy};
  if(!contains(item.rect,tight,.5)||!contains(source.rect,tight,.5))continue;
  let measure,paint;
  try{
   measure=createCanvas(1,1);const mc=measure.getContext('2d'),o=runOptions(item),nominal=o.size/2;
   if(!(nominal>=4&&nominal<=40))continue;
   mc.font=`${o.bold?'bold ':''}1000px "${o.font.ascii.replaceAll('"','')}"`;mc.fontKerning='none';
   const words=parts.map((part,i)=>{const text=item.text[i],m=mc.measureText(text),rect={x:(x+part.x)/sx,y:(y+part.y)/sy,width:(part.right-part.x)/sx,height:(part.bottom-part.y)/sy},inkWidth=(m.actualBoundingBoxLeft+m.actualBoundingBoxRight)/1000,glyphScale=Math.round(rect.width/(inkWidth*nominal)*100);
    return {...item,text,rect,size:item.size,words:undefined,glyphScale,baseline:rect.y+m.actualBoundingBoxAscent/1000*nominal,baselineX:rect.x,advanceWidth:rect.width};});
   if(words.some(word=>!Number.isFinite(word.glyphScale+word.baseline)||word.glyphScale<25||word.glyphScale>400))continue;
   const proposed={...item,words,ocrLiteralPlacement:{version:1}},make=label=>inferDocument([{number:scene.number,width:scene.width,height:scene.height,characters:item.text.length,items:[label],sources:[source],risks:[]}],{preserveGeometry:true}).pages[0];
   const pad=Math.ceil(Math.max(sx,sy)*2),pw=w+pad*2,ph=h+pad*2;
   paint=createCanvas(pw,ph);const context=paint.getContext('2d',{willReadFrequently:true});
   const score=label=>{
    if(!spend(pw*ph*20))return null;
    context.setTransform(1,0,0,1,0,0);context.fillStyle='#fff';context.fillRect(0,0,pw,ph);context.setTransform(sx,0,0,sy,-x+pad,-y+pad);drawResultText(make(label),context);
    const rgba=context.getImageData(0,0,pw,ph).data,got=new Uint8Array(pw*ph);let clipped=false;
    for(let yy=0;yy<ph;yy++)for(let xx=0;xx<pw;xx++){const at=(yy*pw+xx)*4;if(Math.min(rgba[at],rgba[at+1],rgba[at+2])>=180)continue;got[yy*pw+xx]=1;if(!xx||!yy||xx===pw-1||yy===ph-1)clipped=true;}
    const seen=clipped?null:components(got,pw,ph);if(!seen||seen.length!==parts.length||seen.some(p=>p.points.length<4))return null;
    const radius=Math.floor(Math.min(sx,sy)),pointVisits=parts.reduce((s,p)=>s+p.points.length,0)+seen.reduce((s,p)=>s+p.points.length,0);
    if(!spend(pointVisits*((2*radius+1)**2+2)+parts.length*2*pw*ph))return null;
    const scores=parts.map((p,i)=>{const target={...p,x:p.x+pad,y:p.y+pad,right:p.right+pad,bottom:p.bottom+pad,points:p.points.map(at=>(Math.floor(at/w)+pad)*pw+at%w+pad)};return {edge:boxes(target,seen[i],sx,sy),f1:f1(target.points,seen[i].points,pw,ph,radius)};});
    return {edge:Math.max(...scores.map(s=>s.edge)),f1:Math.min(...scores.map(s=>s.f1))};
   };
   const before=score(item);if(!before||before.edge<=1&&before.f1>=.95)continue;
   const after=score(proposed);
   // The source raster's last pixel has a one-pixel sampling interval. This is
   // an optimizer bound, not a change to independent reader-position checks.
   if(!after||after.edge>1+1/Math.min(sx,sy)||after.f1<.95||after.f1<before.f1+.03)continue;
   const preflight=inferDocument([{...scene,items:scene.items.map(old=>old===item?proposed:old)}],{preserveGeometry:true}).pages[0];ocrFrameLayout(preflight);check();
   item.words=words;words.forEach(word=>accepted.add(word));item.ocrLiteralPlacement={version:1,sourcePixels:parts.reduce((s,p)=>s+p.points.length,0),components:parts.length,before,after,nominalUnchanged:true,spellingAndConfidenceUnchanged:true};
  }catch(error){check();if(error?.code==='cancelled'||error?.name==='AbortError')throw error;}
  finally{if(measure)measure.width=measure.height=0;if(paint)paint.width=paint.height=0;}
 }
}
