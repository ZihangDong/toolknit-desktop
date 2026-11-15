// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
// Isolated original ink, existing glyph metrics and unchanged OCR spelling.
const FACES=new Set(['Arial','Calibri','Cambria','Times New Roman']);
const middle=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
const valid=r=>r&&[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>0&&r.height>0;
const overlap=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
function spend(budget,pixels,comparisons=1){
 if(!Number.isSafeInteger(pixels)||pixels<1||!Number.isFinite(budget?.remaining)||!Number.isFinite(budget?.pixelsRemaining)
   ||budget.remaining<comparisons||budget.pixelsRemaining<pixels)return false;
 budget.remaining-=comparisons;budget.pixelsRemaining-=pixels;return true;
}
function components(mask,w,h,check){
 const seen=new Uint8Array(mask.length),result=[];
 for(let first=0;first<mask.length;first++){
  if(!mask[first]||seen[first])continue;
  const queue=[first];seen[first]=1;let x=w,y=h,right=0,bottom=0;
  for(let cursor=0;cursor<queue.length;cursor++){
   if(cursor%256===0)check();
   const at=queue[cursor],xx=at%w,yy=Math.floor(at/w);x=Math.min(x,xx);y=Math.min(y,yy);right=Math.max(right,xx+1);bottom=Math.max(bottom,yy+1);
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const nx=xx+dx,ny=yy+dy,n=ny*w+nx;
    if(nx>=0&&ny>=0&&nx<w&&ny<h&&!seen[n]&&mask[n]){seen[n]=1;queue.push(n);}
   }
  }
  result.push({x,y,right,bottom,ink:queue.length,points:queue,border:!x||!y||right===w||bottom===h});
  if(result.length>64)return null;
 }
 return result;
}
function expand(mask,w,h){
 const out=new Uint8Array(mask.length);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x])
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&y+dy>=0&&x+dx<w&&y+dy<h)out[(y+dy)*w+x+dx]=1;
 return out;
}
export function fitIsolatedLatinPunctuation(createCanvas,{line,words,pixels,inkAt,width,height,sx,sy,budget,protectedRules=[],glyph,check=()=>{},nativeEvidence=false}={}){
 check();
 if(nativeEvidence||typeof createCanvas!=='function'||typeof glyph!=='function'||typeof inkAt!=='function'||!Array.isArray(words)||words.length<5||words.length>200
  ||typeof line?.text!=='string'||words.some(w=>typeof w?.text!=='string')||words.map(w=>w.text).join('')!==line.text.replace(/\s/gu,'')||!/[A-Za-z]/.test(line.text)||/[\p{Script=Han}\u3000-\u303f\uff01-\uff60]/u.test(line.text)
  ||![sx,sy,width,height].every(Number.isFinite)||sx<=0||sy<=0||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>16000000
  ||!(pixels instanceof Uint8ClampedArray)||pixels.length!==width*height*4
  ||!Number.isFinite(budget?.remaining)||!Number.isFinite(budget?.pixelsRemaining)||budget.remaining<=0||budget.remaining>100000||budget.pixelsRemaining<=0||budget.pixelsRemaining>4000000
  ||!Array.isArray(protectedRules)||protectedRules.length>3000)return null;
 const out=words.slice(),repairs=[];
 const sourceInk=(x,y)=>inkAt(x,y)&&(!pixels||Math.min(pixels[(y*width+x)*4],pixels[(y*width+x)*4+1],pixels[(y*width+x)*4+2])<180);
 for(let index=0,probes=0;index<words.length&&probes<8;index++){
  check();
  const old=words[index];
  if(!/^[.,-]$/.test(old?.text)||!FACES.has(old.font)||!valid(old.rect)||!Number.isFinite(old.size)||old.size<4||old.size>120||!Number.isFinite(old.confidence)||old.confidence<.7||old.confidence>1||old.fontAssetId||old.italic||old.ocrRuling||old.ocrSmallPunctuationFit)continue;
  const peers=words.flatMap((w,i)=>i!==index&&Math.abs(i-index)<=8&&/^[A-Za-z0-9]$/.test(w.text)&&w.preciseInk&&!w.italic&&!w.fontAssetId
   &&FACES.has(w.font)&&w.confidence>=.85&&w.ocrGlyphScore>=.78&&valid(w.rect)&&w.size>=6&&w.size<=40&&Number.isFinite(w.baseline)
   ?[{...w,index:i}]:[]);
  const left=peers.filter(w=>w.index<index).sort((a,b)=>b.index-a.index)[0],right=peers.filter(w=>w.index>index).sort((a,b)=>a.index-b.index)[0];
  if(!left||!right||left.font!==right.font||Boolean(left.bold)!==Boolean(right.bold))continue;
  const anchors=peers.filter(w=>w.font===left.font&&Boolean(w.bold)===Boolean(left.bold)).sort((a,b)=>Math.abs(a.index-index)-Math.abs(b.index-index)).slice(0,4);
  if(anchors.length<3)continue;
  const nominal=middle(anchors.map(w=>w.size)),baseline=middle(anchors.map(w=>w.baseline));
  if(anchors.some(w=>Math.abs(w.size-nominal)>nominal*.18||Math.abs(w.baseline-baseline)>.65||Math.abs(w.rect.x-old.rect.x)>nominal*4))continue;
  if(old.size<nominal*1.7)continue;
  const font=left.font,bold=Boolean(left.bold),pad=nominal*.4;
  // Existing typography glyph metrics/signatures are the font evidence.
  // A global FontFace constructor/FontFaceSet check does not prove availability.
  const supported=g=>g?.mask?.length===1024&&g.mask.some(v=>v===1)&&g.outline
   &&['width','height','ascent','descent'].every(k=>Number.isFinite(g.outline[k]))&&g.outline.width>0&&g.outline.height>0;
  const witnesses=['A','g','0'].map(text=>glyph(text,font,bold,budget));
  const punctuation=glyph(old.text,font,bold,budget);
  if(!supported(punctuation)||witnesses.some(g=>!supported(g)))continue;
  const identical=(a,b)=>supported(b)&&['width','height','ascent','descent'].every(k=>Math.abs(a.outline[k]-b.outline[k])<1e-6)
   &&a.mask.every((n,i)=>n===b.mask[i]);
  let aliased=false;
  for(const other of FACES){
   check();if(other===font)continue;
   if(!spend(budget,1,3)){aliased=true;break;}
   const otherWitnesses=['A','g','0'].map(text=>glyph(text,other,bold,budget));
   if(otherWitnesses.every((g,i)=>identical(witnesses[i],g))){aliased=true;break;}
  }
  if(aliased)continue;
  const x=Math.max(0,Math.floor((old.rect.x-pad)*sx)),y=Math.max(0,Math.floor((baseline-nominal)*sy)-2);
  const r=Math.min(width,Math.ceil((old.rect.x+old.rect.width+pad)*sx)),b=Math.min(height,Math.ceil((baseline+nominal*.4)*sy)+2);
  const w=r-x,h=b-y,cost=w*h;
  if(w<4||h<4||w>192||h>192||cost>20000)continue;
  const roi={x:x/sx,y:y/sy,width:w/sx,height:h/sy};
  if(protectedRules.some(rule=>rule?.axis==='h'?overlap(roi,{x:rule.from/sx,y:rule.at/sy-.5,width:(rule.to-rule.from)/sx,height:1})
   :rule?.axis==='v'&&overlap(roi,{x:rule.at/sx-.5,y:rule.from/sy,width:1,height:(rule.to-rule.from)/sy})))continue;
  if(!spend(budget,cost))break;probes++;
  const mask=new Uint8Array(cost);let unsafe=false;
  for(let yy=0;yy<h;yy++){check();for(let xx=0;xx<w;xx++){
   const at=((y+yy)*width+x+xx)*4,min=Math.min(pixels[at],pixels[at+1],pixels[at+2]);
   if(min<220&&(pixels[at+3]<240||Math.max(pixels[at],pixels[at+1],pixels[at+2])-min>25))unsafe=true;
   mask[yy*w+xx]=sourceInk(x+xx,y+yy)?1:0;
  }}
  if(unsafe)continue;
  const parts=components(mask,w,h,check);if(!parts)continue;
  let measure,paint;
  try{
   measure=createCanvas(1,1);const mc=measure.getContext('2d');mc.font=`${bold?'bold ':''}1000px "${font}"`;mc.fontKerning='none';
   const m=mc.measureText(old.text),eh=(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)*nominal/1000,ew=(m.actualBoundingBoxLeft+m.actualBoundingBoxRight)*nominal/1000;
   if(Math.abs((m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)/10-punctuation.outline.height)>1e-6
    ||Math.abs((m.actualBoundingBoxLeft+m.actualBoundingBoxRight)/10-punctuation.outline.width)>1e-6)continue;
   if(![eh,ew,m.actualBoundingBoxAscent,m.actualBoundingBoxLeft].every(Number.isFinite)||eh<=0||ew<=0||eh>nominal*.4||ew>nominal*.5)continue;
   const proposals=[];let completed=true;
   for(const part of parts){
    check();
    if(part.border||part.x<2||part.y<2||part.right>w-2||part.bottom>h-2||part.ink<3)continue;
    const physical={x:(x+part.x)/sx,y:(y+part.y)/sy,width:(part.right-part.x)/sx,height:(part.bottom-part.y)/sy};
    if(physical.x<old.rect.x-.5||physical.x+physical.width>old.rect.x+old.rect.width+.5
     ||Math.abs(physical.height-eh)>Math.max(.4,eh*.35)||Math.abs(physical.width-ew)>Math.max(.45,ew*.4)
     ||anchors.some(a=>overlap(physical,a.rect)))continue;
    // Every chosen connected component is complete; a one-pixel clear ring
    // separates it from all untouched components. No pixels are deleted here.
    const px=x+part.x-2,py=y+part.y-2,pw=part.right-part.x+4,ph=part.bottom-part.y+4;
    if(px<0||py<0||px+pw>width||py+ph>height||pw*ph>4096)continue;
    const source=new Uint8Array(pw*ph);let sourceInk=0;
    for(let yy=0;yy<ph;yy++)for(let xx=0;xx<pw;xx++){
     const value=mask[(py+yy-y)*w+px+xx-x]===1?1:0;source[yy*pw+xx]=value;sourceInk+=value;
    }
    if(sourceInk!==part.ink)continue;
    const expanded=expand(source,pw,ph);paint=createCanvas(pw,ph);const pc=paint.getContext('2d');
    let best=null;
    const rounded=Math.round(nominal*2)/2;
    for(const size of [rounded,rounded-.5,rounded+.5]){
     if(size<6||Math.abs(size-nominal)>nominal*.12)continue;
     const measuredScale=Math.round(physical.width/((m.actualBoundingBoxLeft+m.actualBoundingBoxRight)*size/1000)*100);
     for(const scale of new Set([100,...(measuredScale>=85&&measuredScale<=115?[measuredScale]:[])])){
     const fittedBaseline=physical.y+m.actualBoundingBoxAscent*size/1000;
     for(const base of [...new Set([Math.round(baseline*20)/20,Math.round(fittedBaseline*20)/20])]){
      check();
      if(Math.abs(base-baseline)>.65)continue;
      // Never certify uniqueness from only a prefix of the template search.
      // Consumed work stays charged; an incomplete mark keeps its old style.
      if(!spend(budget,pw*ph*3)){completed=false;continue;}
      const origin=physical.x+m.actualBoundingBoxLeft*size*scale/100000;
      pc.setTransform(1,0,0,1,0,0);pc.clearRect(0,0,pw,ph);pc.font=`${bold?'bold ':''}${size*sy}px "${font}"`;pc.fontKerning='none';
      pc.fillStyle='black';pc.setTransform(scale*sx/sy/100,0,0,1,origin*sx-px,base*sy-py);pc.fillText(old.text,0,0);
      const data=pc.getImageData(0,0,pw,ph).data,candidate=new Uint8Array(source.length);let amount=0,common=0,near=0,bx=pw,by=ph,br=0,bb=0,border=false;
      for(let i=0;i<source.length;i++)if(data[i*4+3]>75){candidate[i]=1;amount++;common+=source[i];near+=expanded[i];const xx=i%pw,yy=Math.floor(i/pw);bx=Math.min(bx,xx);by=Math.min(by,yy);br=Math.max(br,xx+1);bb=Math.max(bb,yy+1);border||=!xx||!yy||xx===pw-1||yy===ph-1;}
      if(!amount||border)continue;
      const expandedCandidate=expand(candidate,pw,ph);let recalled=0;for(let i=0;i<source.length;i++)if(source[i])recalled+=expandedCandidate[i];
      const exact=2*common/(amount+sourceInk),precision=near/amount,recall=recalled/sourceInk;
      const edges=Math.max(Math.abs(bx-2)/sx,Math.abs(by-2)/sy,Math.abs(br-(pw-2))/sx,Math.abs(bb-(ph-2))/sy);
      if(exact<.65||precision<.97||recall<.97||edges>.5)continue;
      const score=exact-Math.abs(size-nominal)/nominal*.05-Math.abs(base-baseline)*.01;
      const next={...old,font,fontFamily:font,bold,size,baseline:base,baselineX:origin,glyphScale:scale,rect:physical,advanceWidth:physical.width,
       ocrSmallPunctuationFit:{nominalSize:nominal,nominalBaseline:baseline,anchorIndexes:anchors.map(a=>a.index),originalSize:old.size,
        sourceComponentPixels:part.ink,unmodifiedOtherComponents:parts.length-1,exactF1:exact,precision1px:precision,recall1px:recall,edgePt:edges,
        isolatedSourceRect:physical,sourceRoi:roi,originalText:old.text,originalRect:{...old.rect},fontEvidence:'existing glyph outline/signature; A,g,0 fallback-alias rejection'}};
      if(!best||score>best.score)best={score,word:next};
     }
     }
    }
    if(best)proposals.push(best);
    paint.width=paint.height=1;paint=null;
   }
   // Multiple physically supported components are ambiguous; never pick one
   // by punctuation meaning, expected prose, or a hard-coded document index.
   if(!completed||proposals.length!==1)continue;
   out[index]=proposals[0].word;repairs.push(index);
  }finally{if(measure)measure.width=measure.height=1;if(paint)paint.width=paint.height=1;}
 }
 return repairs.length?{words:out,repairs}:null;
}


/** Apply AFTER existing table ownership, BEFORE generated fonts.
 * Source and cleaned pixels, rules, sources, IDs, text and tables stay intact.
 * This adapter receives the existing page budget; it never creates a new one.
 */
export function refinePreparedLatinPunctuation(createCanvas,prepared,{pixels,width,height,budget,glyph,check=()=>{}}={}){
 check();
 const scene=prepared?.scene;
 if(!prepared?.changed||!scene||!Array.isArray(scene.items)||scene.items.length>20000||!Array.isArray(scene.sources)
  ||!Array.isArray(scene.rules)||!(pixels instanceof Uint8ClampedArray)||pixels.length!==width*height*4)return prepared;
 const sources=new Map(scene.sources.map(s=>[s.id,s])),sx=width/scene.width,sy=height/scene.height;
 const items=scene.items.slice();let changed=0;
 for(let i=0;i<items.length;i++){
  check();
  const item=items[i],source=item.sourceIds?.length===1&&sources.get(item.sourceIds[0]);
  // Do not descend into table cells or columns. Native, math, uncertain image
  // ownership and coloured typography are outside this experiment's scope.
  if(item.type!=='text'||!item.ocr||item.ocrNative||item.raster||item.italic||item.fontAssetId||item.role==='math'
   ||!source||source.disposition!=='editable'||source.text!==item.text||!item.words?.length
   ||item.words.map(w=>w.text).join('')!==item.text.replace(/\s/gu,''))continue;
  const rgb=/^[0-9a-f]{6}$/i.test(item.color||'')?[0,2,4].map(at=>parseInt(item.color.slice(at,at+2),16)):null;
  if(rgb&&(Math.max(...rgb)-Math.min(...rgb)>20||Math.max(...rgb)>100))continue;
  const repaired=fitIsolatedLatinPunctuation(createCanvas,{line:{text:item.text},words:item.words,pixels,width,height,sx,sy,budget,glyph,check,
   protectedRules:scene.rules.map(r=>({...r,at:r.at*(r.axis==='h'?sy:sx),from:r.from*(r.axis==='h'?sx:sy),to:r.to*(r.axis==='h'?sx:sy)})),
   inkAt:(x,y)=>Math.min(pixels[(y*width+x)*4],pixels[(y*width+x)*4+1],pixels[(y*width+x)*4+2])<220});
  if(repaired){items[i]={...item,words:repaired.words};changed+=repaired.repairs.length;}
 }
 return changed?{...prepared,scene:{...scene,items}}:prepared;
}
