// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { extendIsolatedWritingRules } from '../core/ocr-rule-ownership.js';
import { spatialIndex } from '../core/geometry.js';

function expand(mask, width, height) {
  const out = new Uint8Array(mask.length);
  for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
    if (!mask[y*width+x]) continue;
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++)
      if(x+dx>=0&&x+dx<width&&y+dy>=0&&y+dy<height) out[(y+dy)*width+x+dx]=1;
  }
  return out;
}

/** Sparse, bracketed Han ordinals cannot establish a face from two distinct
 * letters. Prove every source pixel and the whole three-glyph label instead;
 * a short bar must not be scaled into an unrelated multi-stroke numeral.
 */
export function fitOcrBracketedLabel(createCanvas, { line, chars, ordered, tight, inkAt, sx, sy, width, height, fonts, weights, lineFitBudget }) {
  const text=typeof line?.text==='string'?line.text.replace(/\s/gu,''):'';
  if(!/^[（(][一二三四五六七八九十][)）]$/u.test(text||'')||!Array.isArray(chars)||chars.length!==3
    ||!Array.isArray(ordered)||ordered.length!==3||chars.map(c=>c?.text).join('')!==text
    ||!(line.confidence>=.7&&line.confidence<=1)||!(ordered[1]?.confidence>=.95)||ordered.some(w=>!(w?.confidence>=.5&&w.confidence<=1))
    ||!Array.isArray(fonts)||!fonts.length||fonts.length>5||fonts.some(f=>!['SimSun','SimHei','Microsoft YaHei','FangSong','KaiTi'].includes(f))
    ||!Array.isArray(weights)||!weights.length||weights.length>2||weights.some(b=>typeof b!=='boolean')
    ||![sx,sy,width,height,tight?.x,tight?.y,tight?.width,tight?.height].every(Number.isFinite)
    ||sx<=0||sy<=0||width<1||height<1||width*height>16_000_000||typeof inkAt!=='function'
    ||!lineFitBudget||!Number.isFinite(lineFitBudget.remaining)||lineFitBudget.remaining<1)return null;
  const left=Math.max(0,Math.floor(tight.x*sx)),top=Math.max(0,Math.floor(tight.y*sy));
  const right=Math.min(width,Math.ceil((tight.x+tight.width)*sx)),bottom=Math.min(height,Math.ceil((tight.y+tight.height)*sy));
  const w=right-left,h=bottom-top;
  if(w<8||w>512||h<8||h>180||w*h>32768)return null;
  const boxes=chars.map(c=>c?.rect&&[c.rect.x,c.rect.y,c.rect.width,c.rect.height].every(Number.isFinite)
    &&c.rect.width>0&&c.rect.height>0&&!c.ruling
    ?{x:c.rect.x*sx,y:c.rect.y*sy,right:(c.rect.x+c.rect.width)*sx,bottom:(c.rect.y+c.rect.height)*sy}:null);
  if(boxes.some((b,i)=>!b||b.x<left-.1||b.y<top-.1||b.right>right+.1||b.bottom>bottom+.1
    ||i&&b.x<boxes[i-1].right+1))return null;
  const sourceCost=w*h;
  if(sourceCost>lineFitBudget.remaining)return null;
  lineFitBudget.remaining-=sourceCost;
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
    if(inkAt(x,y)&&boxes.filter(b=>x+.5>=b.x-.5&&x+.5<=b.right+.5&&y+.5>=b.y-.5&&y+.5<=b.bottom+.5).length!==1)return null;
  }
  const probes=boxes.map((box,index)=>{
    const x=Math.floor(box.x),y=Math.floor(box.y),w=Math.ceil(box.right)-x+4,h=Math.ceil(box.bottom)-y+4;
    const mask=new Uint8Array(w*h);
    for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
      const px=x+xx-2,py=y+yy-2;
      mask[yy*w+xx]=px>=0&&px<width&&py>=0&&py<height&&inkAt(px,py)?1:0;
    }
    return{...box,index,x0:x,y0:y,w,h,mask,expanded:expand(mask,w,h)};
  });
  const cost=probes.reduce((sum,p)=>sum+p.w*p.h*4,0)*fonts.length*weights.length;
  if(cost>lineFitBudget.remaining)return null;
  lineFitBudget.remaining-=cost;
  const candidates=[];
  for(const font of fonts)for(const bold of weights){
    const words=[];let minimum=1,total=0;
    for(const p of probes){
      const canvas=createCanvas(p.w,p.h),context=canvas.getContext('2d');
      try{
        context.font=`${bold?'bold ':''}1000px "${font}"`;context.fontKerning='none';
        const m=context.measureText(chars[p.index].text),inkWidth=m.actualBoundingBoxLeft+m.actualBoundingBoxRight;
        const inkHeight=m.actualBoundingBoxAscent+m.actualBoundingBoxDescent;
        if(!(inkWidth>0&&inkHeight>0))break;
        const rect=chars[p.index].rect,size=rect.height*1000/inkHeight;
        const glyphScale=Math.round(rect.width*100000/(inkWidth*size));
        if(!(size>=4&&size<=40&&glyphScale>=50&&glyphScale<=180))break;
        const xx=rect.width*sx/inkWidth,yy=rect.height*sy/inkHeight;
        context.setTransform(xx,0,0,yy,2+p.x-p.x0+m.actualBoundingBoxLeft*xx,2+p.y-p.y0+m.actualBoundingBoxAscent*yy);
        context.fillStyle='black';context.fillText(chars[p.index].text,0,0);
        const pixels=context.getImageData(0,0,p.w,p.h).data,mask=new Uint8Array(p.w*p.h);
        for(let i=0;i<mask.length;i++)mask[i]=pixels[i*4+3]>35?1:0;
        const grown=expand(mask,p.w,p.h);let a=0,b=0,ac=0,bc=0;
        for(let i=0;i<mask.length;i++){a+=p.mask[i];b+=mask[i];ac+=p.mask[i]&grown[i];bc+=mask[i]&p.expanded[i];}
        const recall=ac/Math.max(1,a),precision=bc/Math.max(1,b),score=2*precision*recall/Math.max(1e-6,precision+recall);
        if(a<12||b<12||score<(p.index===1?.9:.85))break;
        minimum=Math.min(minimum,score);total+=score;
        words.push({text:chars[p.index].text,rect,baseline:rect.y+m.actualBoundingBoxAscent/1000*size,
          baselineX:rect.x,advanceWidth:rect.width,size,font,fontFamily:font,bold,glyphScale,preciseInk:true,
          confidence:ordered[p.index].confidence,ocrGlyphScore:score});
      }finally{canvas.width=canvas.height=0;}
    }
    if(words.length!==3||total/3<.93||Math.max(...words.map(w=>w.size))/Math.min(...words.map(w=>w.size))>1.5)continue;
    candidates.push({font,bold,words,score:total/3,minimum});
  }
  candidates.sort((a,b)=>b.score-a.score);
  let best=candidates[0];if(!best)return null;
  const regular=best.bold&&candidates.find(c=>c.font===best.font&&!c.bold);
  if(regular&&best.score-regular.score<.03)best=regular;
  const middle=values=>[...values].sort((a,b)=>a-b)[1];
  return{font:best.font,fontFamily:best.font,bold:best.bold,size:middle(best.words.map(w=>w.size)),
    baseline:middle(best.words.map(w=>w.baseline)),words:best.words,ocrFontScore:Math.round(best.score*1000)/1000,ocrShortLabelFit:true};
}

/** An OCR-only, whole-line alternative to noisy character segmentation.
 * A one-pixel bidirectional ink tolerance accommodates scan blur, while the
 * full string and its natural proportions must agree. No spelling is changed.
 */
export function fitOcrLineTypography(createCanvas, {line,tight,inkAt,sx,sy,width,height,lineFitBudget}) {
  if(!/^[A-Za-z0-9 ,.;:'"()!?/\-]{4,96}$/.test(line.text)
    ||![sx,sy,tight.x,tight.y,tight.width,tight.height].every(Number.isFinite)||sx<=0||sy<=0)return null;
  const text=line.text.trim(),left=Math.max(0,Math.floor(tight.x*sx)),top=Math.max(0,Math.floor(tight.y*sy));
  const w=Math.min(width,Math.ceil((tight.x+tight.width)*sx))-left;
  const h=Math.min(height,Math.ceil((tight.y+tight.height)*sy))-top;
  const cost=w*h*10;
  if(h<12||h>128||w<12||w>3072||w*h>131072||!lineFitBudget||cost>lineFitBudget.remaining)return null;
  lineFitBudget.remaining-=cost;
  const source=new Uint8Array(w*h);let ink=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const value=inkAt(left+x,top+y)?1:0;source[y*w+x]=value;ink+=value;}
  if(ink<12||ink>source.length*.8)return null;
  const expanded=expand(source,w,h),candidates=[];
  const canvas=createCanvas(w+8,h+8),context=canvas.getContext('2d');
  try {
    for(const font of ['Arial','Times New Roman','Calibri','Cambria','Microsoft YaHei'])for(const bold of [false,true]){
      context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,w+8,h+8);
      context.font=`${bold?'bold ':''}1000px "${font}"`;context.fontKerning='none';
      const metrics=context.measureText(text),size=h*1000/(metrics.actualBoundingBoxAscent+metrics.actualBoundingBoxDescent);
      const scale=w/((metrics.actualBoundingBoxLeft+metrics.actualBoundingBoxRight)*size/1000);
      if(!Number.isFinite(size+scale)||size/sy<4||size/sy>120||scale<.8||scale>1.25)continue;
      context.setTransform(scale*size/1000,0,0,size/1000,4,4);context.fillStyle='black';
      context.fillText(text,metrics.actualBoundingBoxLeft,metrics.actualBoundingBoxAscent);
      const rgba=context.getImageData(0,0,w+8,h+8).data,mask=new Uint8Array((w+8)*(h+8));
      for(let i=0;i<mask.length;i++)mask[i]=rgba[i*4+3]>80?1:0;
      const dilation=expand(mask,w+8,h+8);let best=null;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        let count=0,forward=0,reverse=0;
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){
          const at=(y+4+dy)*(w+8)+x+4+dx,value=mask[at],i=y*w+x;
          count+=value;forward+=value&&expanded[i]?1:0;reverse+=source[i]&&dilation[at]?1:0;
        }
        const precision=forward/Math.max(1,count),recall=reverse/ink;
        const score=2*precision*recall/Math.max(1e-9,precision+recall)-Math.abs(Math.log(scale))*.35;
        if(!best||score>best.score)best={score,dx,dy};
      }
      candidates.push({font,bold,size,scale,metrics,...best});
    }
    candidates.sort((a,b)=>b.score-a.score);
    const best=candidates[0];
    if(!best||best.score<.93||best.score-(candidates[1]?.score??0)<.006)return null;
    const size=best.size/sy,glyphScale=Math.round(best.scale*sy/sx*100);
    const baseline=(top-best.dy+best.metrics.actualBoundingBoxAscent*best.size/1000)/sy;
    const origin=(left-best.dx+best.metrics.actualBoundingBoxLeft*best.size*best.scale/1000)/sx;
    context.setTransform(1,0,0,1,0,0);context.font=`${best.bold?'bold ':''}1000px "${best.font}"`;
    const words=[];let prefix='';
    for(const character of text){
      const advance=context.measureText(prefix).width*best.size*best.scale/1000/sx;prefix+=character;
      if(!character.trim())continue;
      const m=context.measureText(character),scale=best.size*best.scale/1000/sx;
      words.push({text:character,font:best.font,fontFamily:best.font,bold:best.bold,size,glyphScale,
        baseline,baselineX:origin+advance,preciseInk:true,
        advanceWidth:m.width*scale,rect:{x:origin+advance-m.actualBoundingBoxLeft*scale,
          y:baseline-m.actualBoundingBoxAscent*best.size/1000/sy,
          width:(m.actualBoundingBoxLeft+m.actualBoundingBoxRight)*scale,
          height:(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)*best.size/1000/sy}});
    }
    return {font:best.font,fontFamily:best.font,bold:best.bold,size,baseline,words,
      ocrFontScore:Math.round(best.score*1000)/1000,ocrLineTypography:true};
  } finally {canvas.width=canvas.height=0;}
}

/** Recover a small printed full stop at a proven blank writing-line end.
 * References establish physical body scale, not the expected sentence. A ring
 * must match the complete original ink at that scale; ordinary/small digits,
 * degree signs, grid junctions and already-owned text are never guessed away.
 */
export function fitOcrWritingPunctuation(createCanvas,{rules,text,pixels,width,height,sx,sy,budget,protectedRects=[]}={}) {
  if(!Array.isArray(rules)||rules.length>3000||!Array.isArray(text)||text.length>20000
    ||!(pixels instanceof Uint8ClampedArray)||pixels.length!==width*height*4
    ||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>16_000_000
    ||![sx,sy].every(n=>Number.isFinite(n)&&n>0)||!budget||!Number.isFinite(budget.remaining)||budget.remaining<1
    ||!Array.isArray(protectedRects)||protectedRects.length>20000)return [];
  const valid=r=>r&&[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>0&&r.height>0;
  const overlap=(a,b)=>valid(a)&&valid(b)&&Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)
    &&Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y);
  const faces=new Set(['SimSun','SimHei','Microsoft YaHei','FangSong','KaiTi']);
  const references=text.filter(t=>t?.ocr&&!t.ocrNative&&t.ocrFontScore>=.7&&faces.has(t.font)
    &&valid(t.rect)&&Number.isFinite(t.baseline)&&t.size>=6&&t.size<=40
    &&Array.isArray(t.words)&&t.words.length<=200&&t.words.filter(w=>/^\p{Script=Han}$/u.test(w?.text)&&w.confidence>=.9).length>=3);
  if(!references.length)return [];
  const query=spatialIndex(references),baselineCache=new Map();let metadataWork=100000;
  const baselineFor=(font,rule,nominal)=>{
    if(!baselineCache.has(font)){
      const pairs=[];
      for(const line of rules){
        if(metadataWork<1)break;
        if(line?.axis!=='h'||![line.at,line.from,line.to].every(Number.isFinite)||line.to-line.from<40)continue;
        const nearby=query({x:line.from/sx-160,y:line.at/sy-60,width:165,height:65}).slice(0,32);
        for(const t of nearby){
          if(t.font!==font)continue;
          const before=[];
          for(const w of t.words){
            if(--metadataWork<0)break;
            if(/^\p{Script=Han}$/u.test(w?.text)&&w.confidence>=.9&&w.ocrGlyphScore>=.6&&valid(w.rect)
              &&Number.isFinite(w.size+w.baseline)&&w.size>=6&&w.size<=40&&line.to-line.from>=w.size*sx*1.5
              &&Math.abs(w.baseline-line.at/sy)<w.size*.35&&w.rect.x+w.rect.width<=line.from/sx+1
              &&line.from/sx-w.rect.x-w.rect.width<w.size*4)before.push(w);
          }
          before.sort((a,b)=>b.rect.x-a.rect.x);
          if(before.length<3)continue;
          const last=before.slice(0,3),ratios=last.map(w=>(line.at/sy-w.baseline)/w.size).sort((a,b)=>a-b);
          if(ratios[0]<.03||ratios[2]>.3||ratios[2]-ratios[0]>.1)continue;
          pairs.push({at:line.at,from:line.from,to:line.to,ratio:ratios[1],sourceId:t.id});
        }
      }
      baselineCache.set(font,pairs);
    }
    const pairs=baselineCache.get(font),local=pairs.filter(p=>Math.abs(p.at-rule.at)<1&&Math.abs(p.from-rule.from)<2&&Math.abs(p.to-rule.to)<2);
    const chosen=local.length?local:pairs,values=chosen.map(p=>p.ratio).sort((a,b)=>a-b),ratio=values[Math.floor(values.length/2)];
    if(!Number.isFinite(ratio)||values.some(v=>Math.abs(v-ratio)>.05))return null;
    return{baseline:rule.at/sy-ratio*nominal,ratio,ids:[...new Set(chosen.map(p=>p.sourceId))].slice(0,3)};
  };
  const sample=(x,y,level=220)=>pixels[(y*width+x)*4]<level&&pixels[(y*width+x)*4+3]>=240
    &&Math.max(...pixels.subarray((y*width+x)*4,(y*width+x)*4+3))-Math.min(...pixels.subarray((y*width+x)*4,(y*width+x)*4+3))<30;
  const ring=(mask,w,h)=>{
    const seen=new Uint8Array(mask.length);let holes=0;
    for(let start=0;start<mask.length;start++){
      if(mask[start]||seen[start])continue;
      const queue=[start];seen[start]=1;let edge=false;
      for(let i=0;i<queue.length;i++){
        const p=queue[i],x=p%w,y=Math.floor(p/w);edge||=!x||x===w-1||!y||y===h-1;
        for(const n of[x?p-1:-1,x<w-1?p+1:-1,y?p-w:-1,y<h-1?p+w:-1]){
          if(n>=0&&!mask[n]&&!seen[n]){seen[n]=1;queue.push(n);}
        }
      }
      if(!edge&&queue.length>=2)holes++;
    }
    return holes===1;
  };
  const found=[];let probes=0;
  for(const rule of rules){
    if(found.length>=8||probes>=32||budget.remaining<1)break;
    if(rule?.axis!=='h'||![rule.at,rule.from,rule.to].every(Number.isFinite)||rule.to<=rule.from)continue;
    const peers=query({x:rule.from/sx-80,y:rule.at/sy-360,width:160,height:365}).slice(0,64).filter(t=>rule.at/sy>=t.baseline-1&&rule.at/sy-t.baseline<=t.size*8
      &&rule.from/sx>=t.rect.x-t.size*2&&rule.from/sx<=t.rect.x+t.rect.width+t.size*2)
      .sort((a,b)=>rule.at/sy-a.baseline-(rule.at/sy-b.baseline)).slice(0,3);
    if(!peers.length)continue;
    const peer=peers[0],sizes=peer.words.filter(w=>/^\p{Script=Han}$/u.test(w?.text)&&w.confidence>=.9
      &&Number.isFinite(w.size)&&w.size>=6&&w.size<=40).map(w=>w.size).sort((a,b)=>a-b);
    const nominal=sizes[Math.floor(sizes.length/2)];if(!nominal||rule.to-rule.from<nominal*sx*1.5)continue;
    const left=Math.max(0,Math.floor(rule.to)-3),right=Math.min(width,Math.ceil(rule.to+nominal*sx*.8));
    const top=Math.max(0,Math.floor(rule.at-nominal*sy*.55)),bottom=Math.min(height,Math.ceil(rule.at+nominal*sy*.2));
    const w=right-left,h=bottom-top,cost=w*h;if(w<4||h<4||w>160||h>160||cost>budget.remaining)continue;
    probes++;budget.remaining-=cost;
    const mask=new Uint8Array(cost),seen=new Uint8Array(cost);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)mask[y*w+x]=sample(left+x,top+y)?1:0;
    const candidates=[];
    for(let start=0;start<mask.length;start++){
      if(!mask[start]||seen[start])continue;
      const queue=[start];seen[start]=1;let x1=w,x2=0,y1=h,y2=0;
      for(let i=0;i<queue.length;i++){
        const at=queue[i],x=at%w,y=Math.floor(at/w);x1=Math.min(x1,x);x2=Math.max(x2,x+1);y1=Math.min(y1,y);y2=Math.max(y2,y+1);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          if(x+dx<0||x+dx>=w||y+dy<0||y+dy>=h)continue;
          const n=(y+dy)*w+x+dx;if(mask[n]&&!seen[n]){seen[n]=1;queue.push(n);}
        }
      }
      const ww=x2-x1,hh=y2-y1;
      if(x1<1||x2>w-1||y1<1||y2>h-1||queue.length<10||ww<4||hh<4
        ||ww>nominal*sx*.4||hh>nominal*sy*.4||ww/hh<.45||ww/hh>1.4)continue;
      const rect={x:(left+x1)/sx,y:(top+y1)/sy,width:ww/sx,height:hh/sy};
      if(protectedRects.some(r=>overlap(rect,r))||found.some(m=>overlap(rect,m.rect)))continue;
      const owners=text.filter(t=>overlap(rect,t.rect));
      if(owners.length>1||owners.length===1&&(owners[0].text!=='0'||!owners[0].ocr||owners[0].ocrNative||owners[0].confidence>=.95
        ||owners[0].rect.width>nominal*.5||owners[0].rect.height>nominal*.5))continue;
      const source=new Uint8Array((ww+4)*(hh+4));
      for(let y=0;y<hh;y++)for(let x=0;x<ww;x++)source[(y+2)*(ww+4)+x+2]=mask[(y+y1)*w+x+x1];
      if(!ring(source,ww+4,hh+4))continue;
      const paper=[[x1-1,y1-1],[x2,y1-1],[x1-1,y2],[x2,y2]].every(([x,y])=>{
        const p=((top+y)*width+left+x)*4;return pixels[p]>235&&pixels[p+1]>235&&pixels[p+2]>235&&pixels[p+3]>=240;
      });
      if(!paper)continue;
      const grown=expand(source,ww+4,hh+4),scores=[];
      const font=peer.font;
      const baselineHint=baselineFor(font,rule,nominal);if(!baselineHint)continue;
      for(const character of ['。','0','o','O','°','·'])for(const bold of [Boolean(peer.bold),!peer.bold]){
        const canvas=createCanvas(ww+4,hh+4),context=canvas.getContext('2d');
        try{
          context.font=`${bold?'bold ':''}1000px "${font}"`;context.fontKerning='none';const m=context.measureText(character);
          const inkWidth=m.actualBoundingBoxLeft+m.actualBoundingBoxRight,inkHeight=m.actualBoundingBoxAscent+m.actualBoundingBoxDescent;
          if(!(inkWidth>0&&inkHeight>0))continue;
          const size=rect.height*1000/inkHeight,glyphScale=Math.round(rect.width*100000/(inkWidth*size));
          const baseline=rect.y+m.actualBoundingBoxAscent/1000*size;
          if(size<nominal*.65||size>nominal*1.5||glyphScale<50||glyphScale>140
            ||Math.abs(baseline-baselineHint.baseline)>Math.max(.35,nominal*.04))continue;
          const work=source.length*4;if(work>budget.remaining)continue;budget.remaining-=work;
          const xx=ww/inkWidth,yy=hh/inkHeight;
          context.setTransform(xx,0,0,yy,2+m.actualBoundingBoxLeft*xx,2+m.actualBoundingBoxAscent*yy);
          context.fillText(character,0,0);const rgba=context.getImageData(0,0,ww+4,hh+4).data,paint=new Uint8Array(source.length);
          for(let i=0;i<paint.length;i++)paint[i]=rgba[i*4+3]>35?1:0;
          const expanded=expand(paint,ww+4,hh+4);let a=0,b=0,ac=0,bc=0;
          for(let i=0;i<source.length;i++){a+=source[i];b+=paint[i];ac+=source[i]&expanded[i];bc+=paint[i]&grown[i];}
          const precision=bc/Math.max(1,b),recall=ac/Math.max(1,a),score=2*precision*recall/Math.max(1e-9,precision+recall);
          scores.push({character,font,bold,size,glyphScale,baseline,score});
        }finally{canvas.width=canvas.height=0;}
      }
      const stops=scores.filter(s=>s.character==='。').sort((a,b)=>b.score-a.score);let stop=stops[0];
      const regular=stop?.bold&&stops.find(s=>!s.bold);if(regular&&stop.score-regular.score<.03)stop=regular;
      const other=Math.max(0,...scores.filter(s=>s.character!=='。').map(s=>s.score));
      if(!stop||stop.score<.93||stop.score-other<.1)continue;
      if(rules.some(r=>r?.axis==='v'&&Number.isFinite(r.at+r.from+r.to)
        &&Math.abs(r.at-rule.to)<=3&&r.from<=rule.at+3&&r.to>=rule.at-3))continue;
      // The left end may touch the preceding printed label. Prove the complete
      // isolated final two em of the detected line; this is endpoint evidence
      // only and never changes the page's full writing/table-rule ledger.
      const endpoint={...rule,from:Math.max(rule.from,rule.to-nominal*sx*2)};
      const cores=[180,200].map(level=>extendIsolatedWritingRules([endpoint],{width,height,
        inkAt:(x,y)=>sample(x,y,level),budget,includeUnchanged:true}));
      if(cores.some(p=>p.length!==1)||Math.abs(cores[0][0].to-cores[1][0].to)>2
        ||cores.some(p=>p[0].to>=rect.x*sx-1))continue;
      const proven={...endpoint,from:Math.max(...cores.map(p=>p[0].from)),to:Math.min(...cores.map(p=>p[0].to))};
      candidates.push({text:'。',rect,advanceRect:{...rect},advanceWidth:rect.width,baselineX:rect.x,
        baseline:stop.baseline,size:stop.size,font:stop.font,fontFamily:stop.font,bold:stop.bold,italic:false,
        color:'000000',preciseInk:true,glyphScale:stop.glyphScale,confidence:stop.score,
        replaces:owners[0]?.id,ocrRecoveredMark:{rule:'source-ink-writing-full-stop',similarity:stop.score,
          margin:stop.score-other,nominalSize:nominal,writingRule:{...rule},isolatedWritingEnd:proven,writingEndCoreThresholds:[180,200],
          baselineRatio:baselineHint.ratio,baselineSourceIds:baselineHint.ids,
          hintIds:peers.map(p=>p.id).filter(id=>typeof id==='string'&&id.length<=160)}});
    }
    if(candidates.length===1)found.push(candidates[0]);
  }
  return found;
}
