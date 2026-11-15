// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { contains, spatialIndex } from './geometry.js';

/** Raster detection and local isolation may describe the same field several
 * times. Compare against the original anchor, avoiding transitive merging of
 * nearby parallel strokes. This does not alter the page's table-rule ledger.
 */
export function coincidentWritingRules(rules,{inkAt,width,height}={}) {
  if(!Array.isArray(rules))return [];
  if(rules.length>128)return rules;
  const groups=[];let samples=4096;
  const sameThinStroke=(a,b,isolated)=>{
    if(!isolated||Math.abs(a.at-b.at)>2||typeof inkAt!=='function'
      ||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>16_000_000)return false;
    const left=Math.max(a.from,b.from),right=Math.min(a.to,b.to);
    const top=Math.floor(Math.min(a.at,b.at)),bottom=Math.ceil(Math.max(a.at,b.at));
    if(top<0||bottom>=height||left<0||right>=width)return false;
    for(const part of [.15,.35,.5,.65,.85])for(let y=top;y<=bottom;y++){
      if(samples<1)return false;samples--;
      if(!inkAt(Math.round(left+(right-left)*part),y))return false;
    }
    return true;
  };
  for(const rule of rules){
    if(!rule||rule.axis!=='h'||![rule.at,rule.from,rule.to].every(Number.isFinite)||rule.to<=rule.from){
      groups.push({anchor:null,rule});continue;
    }
    const existing=groups.find(({anchor:a,rule:r})=>{
      if(!a)return false;
      const close=Math.abs(a.from-rule.from)<=3&&Math.abs(a.to-rule.to)<=3;
      // Local isolation may prove a slightly longer complete core than the
      // page detector. Only that independently proven span may contain the
      // shorter record; generic geometry cannot grow a writing line.
      const isolatedCover=Math.abs(a.at-rule.at)<=.5&&Math.abs(a.from-rule.from)<=12&&Math.abs(a.to-rule.to)<=12
        &&(a.isolatedWriting&&a.from<=rule.from&&a.to>=rule.to
          ||rule.isolatedWriting&&rule.from<=a.from&&rule.to>=a.to);
      return (close||isolatedCover)
        &&Math.min(a.to,rule.to)-Math.max(a.from,rule.from)>=Math.min(a.to-a.from,rule.to-rule.from)*.9
        &&(Math.abs(a.at-rule.at)<=.5||sameThinStroke(a,rule,r.isolatedWriting||rule.isolatedWriting));
    });
    if(!existing){groups.push({anchor:rule,rule:{...rule}});continue;}
    existing.rule.from=Math.min(existing.rule.from,rule.from);existing.rule.to=Math.max(existing.rule.to,rule.to);
    if(rule.isolatedWriting)existing.rule.isolatedWriting=true;
  }
  // A complete isolated core may arrive after several shorter detector
  // records. Joining just the first match leaves a duplicate that makes one
  // underscore claim two lines. Use that original proof to reconcile all
  // contained records, while keeping the first baseline as the fixed anchor.
  for(const proof of rules){
    if(!proof?.isolatedWriting||proof.axis!=='h'||![proof.at,proof.from,proof.to].every(Number.isFinite))continue;
    let keeper=null;
    for(let i=0;i<groups.length;i++){
      const group=groups[i],a=group.anchor,r=group.rule;
      if(!a||Math.abs(a.at-proof.at)>.5||proof.from>r.from||proof.to<r.to
        ||Math.abs(proof.from-a.from)>12||Math.abs(proof.to-a.to)>12
        ||Math.min(a.to,proof.to)-Math.max(a.from,proof.from)<Math.min(a.to-a.from,proof.to-proof.from)*.9)continue;
      if(!keeper){keeper=group;continue;}
      if(Math.abs(keeper.anchor.at-a.at)>.5&&!sameThinStroke(keeper.anchor,a,true))continue;
      keeper.rule.from=Math.min(keeper.rule.from,r.from);keeper.rule.to=Math.max(keeper.rule.to,r.to);
      keeper.rule.isolatedWriting=true;groups.splice(i--,1);
    }
  }
  return groups.map(g=>g.rule);
}

/** A complete raw-ink font match can prove intersecting letter stems that the
 * conservative geometry-only pass must retain. Callers pass raster rules only;
 * native vectors, rectangular-only glyphs and rules extending beyond one
 * independently matched character cannot acquire this ownership.
 */
export function provenTextStrokeRules(rules,words,{sx=1,sy=1}={}) {
  const result=new Set();
  if(!Array.isArray(rules)||rules.length>3000||!Array.isArray(words)||words.length>200
    ||!Number.isFinite(sx)||!Number.isFinite(sy)||sx<=0||sy<=0)return result;
  const glyphs=words.filter(word=>word?.preciseInk&&word.confidence>=.9&&(word.ocrGlyphOwnershipScore??word.ocrGlyphScore)>=.8
    &&/^\p{Script=Han}$/u.test(word.text)&&!/[一二三口囗日目田回]/u.test(word.text)
    &&word.rect&&[word.rect.x,word.rect.y,word.rect.width,word.rect.height].every(Number.isFinite))
    .map(word=>({x:word.rect.x*sx,y:word.rect.y*sy,width:word.rect.width*sx,height:word.rect.height*sy}));
  const query=spatialIndex(glyphs.map(rect=>({rect})));
  for(const rule of rules){
    if(!rule||!['h','v'].includes(rule.axis)||![rule.at,rule.from,rule.to].every(Number.isFinite))continue;
    const rect=rule.axis==='h'?{x:rule.from,y:rule.at-.5,width:rule.to-rule.from,height:1}
      :{x:rule.at-.5,y:rule.from,width:1,height:rule.to-rule.from};
    if(rect.width<=0||rect.height<=0)continue;
    if(query(rect).some(({rect:g})=>g.width>=6&&g.height>=6&&contains(g,rect,1)))result.add(rule);
  }
  return result;
}

/** Restore only continuously isolated, thin ends omitted by raster detection.
 * Additional ranges protect measurement/erasure; they never redefine a table.
 */
export function extendIsolatedWritingRules(rules,{width,height,inkAt,budget,includeUnchanged=false}={}) {
  const extra=[];
  if(!Array.isArray(rules)||rules.length>3000||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)
    ||width<1||height<1||width*height>16_000_000||typeof inkAt!=='function'
    ||!budget||!Number.isFinite(budget.remaining)||budget.remaining<1)return extra;
  let exhausted=false;
  const sample=(x,y)=>{
    if(x<0||x>=width||y<0||y>=height)return false;
    if(budget.remaining<1){exhausted=true;return false;}
    budget.remaining--;return Boolean(inkAt(x,y));
  };
  for(const rule of rules){
    if(rule?.axis!=='h'||![rule.at,rule.from,rule.to].every(Number.isFinite)
      ||rule.to-rule.from<24||rule.to-rule.from>4096||rule.from<0||rule.to>=width||rule.at<5||rule.at>=height-5)continue;
    const row=Math.round(rule.at);
    const thinAt=x=>{
      const center=[0,-1,1,-2,2].map(d=>row+d).find(y=>sample(x,y));
      if(center===undefined||exhausted)return false;
      let top=center,bottom=center;
      while(top>0&&center-top<4&&sample(x,top-1))top--;
      while(bottom<height-1&&bottom-center<4&&sample(x,bottom+1))bottom++;
      if(bottom-top+1>4)return false;
      for(const y of[top-2,top-1,bottom+1,bottom+2])if(sample(x,y))return false;
      return !exhausted;
    };
    let valid=true;
    for(let x=Math.ceil(rule.from);x<=Math.floor(rule.to);x++)if(!thinAt(x)){valid=false;break;}
    if(exhausted)return extra;
    if(!valid)continue;
    let left=Math.ceil(rule.from),right=Math.floor(rule.to);
    for(let n=0;n<128&&left>0&&thinAt(left-1);n++)left--;
    for(let n=0;n<128&&right<width-1&&thinAt(right+1);n++)right++;
    if(exhausted)return extra;
    if(includeUnchanged||left<rule.from||right>rule.to)extra.push({...rule,from:Math.min(left,rule.from),to:Math.max(right,rule.to)});
  }
  return extra;
}

/** Short isolated writing lines may fall below whole-page rule detection.
 * An underscore peak supports short rules; an omitted field needs a longer
 * low, isolated stroke with no letter peak. Unit text only schedules probes,
 * never proves a line. These local rules never create Word tables.
 */
export function localOcrWritingRules(line,{width,height,inkAt,budget}={}) {
  const result=[];
  if(!line||typeof line.text!=='string'||!/[年月日元%‰㎡_]/u.test(line.text)||!(line.confidence>=.65)
    ||!Array.isArray(line.words)||line.words.length>200||!budget||budget.remaining<1
    ||!Number.isFinite(budget.remaining)||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1
    ||![line.x,line.y,line.width,line.height,width,height].every(Number.isFinite)
    ||line.height<6||line.height>180||line.width>4096||width*height>16_000_000||typeof inkAt!=='function')return result;
  if(line.words.some(word=>typeof word?.text!=='string')
    ||line.words.map(word=>word.text).join('').replace(/\s/gu,'')!==line.text.replace(/\s/gu,''))return result;
  const tokens=line.words.filter(word=>word.text==='_'&&Number.isFinite(word.x+word.width)&&word.width>0
    &&word.x+word.width/2>=line.x-2&&word.x+word.width/2<=line.x+line.width+2);
  if(tokens.length>32)return result;
  {
    const h=line.height,pad=Math.max(3,Math.ceil(h*.08));
    const x0=Math.max(0,Math.floor(line.x)-pad),x1=Math.min(width,Math.ceil(line.x+line.width)+pad);
    const explicit=tokens.length>0;
    const y0=Math.max(0,Math.floor(line.y+h*(explicit?.4:.75))-pad),y1=Math.min(height,Math.ceil(line.y+h)+pad*3);
    const w=x1-x0,rows=y1-y0,cost=w*rows;
    if(cost<1||cost>budget.remaining)return result;
    budget.remaining-=cost;
    const mask=new Uint8Array(cost);
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)mask[(y-y0)*w+x-x0]=inkAt(x,y)?1:0;
    const at=(x,y)=>x>=0&&x<w&&y>=0&&y<rows&&mask[y*w+x];
    const found=[];
    for(let y=pad;y<rows-pad;y++)for(let x=1;x<w-1;){
      if(!at(x,y)){x++;continue;}
      const start=x;while(x<w&&at(x,y))x++;const end=x;
      if(end>=w||end-start<Math.max(12,h*(explicit?.45:.8)))continue;
      let top=y,bottom=y+1;
      // Include the complete vertical extent, including tapered interpolation
      // rows. A partial edge is still part of this stroke; treating it as
      // exterior ink would incorrectly reject an otherwise isolated field.
      const support=yy=>{for(let xx=start;xx<end;xx++)if(at(xx,yy))return true;return false;};
      while(top>0&&support(top-1))top--;
      while(bottom<rows&&support(bottom))bottom++;
      if(top<pad||bottom+pad>rows||bottom-top>Math.max(4,h*.12))continue;
      let thinColumns=0;
      for(let xx=start;xx<end;xx++){
        let amount=0;for(let yy=top;yy<bottom;yy++)if(at(xx,yy))amount++;
        if(amount<=Math.max(4,h*.08))thinColumns++;
      }
      if(thinColumns<(end-start)*.9)continue;
      const clear=(left,right)=>{
        for(let yy=top-pad;yy<bottom+pad;yy++){
          if(yy>=top&&yy<bottom)continue;
          for(let xx=left;xx<right;xx++)if(at(xx,yy))return false;
        }
        return true;
      };
      // Reject character crossbars, underlined glyphs and grid junctions.
      if(!clear(start+Math.ceil((end-start)*.15),end-Math.ceil((end-start)*.15))
        ||!clear(start,start+2)||!clear(end-2,end))continue;
      const rule={axis:'h',at:y0+(top+bottom-1)/2,from:x0+start,to:x0+end-1};
      // Detector height includes paper padding. A shorter isolated field line
      // still needs a lower baseline and cannot own another confident letter.
      if((!explicit||end-start<h*.8)&&(rule.at<line.y+h*.75||line.words.some(word=>/^[\p{L}\p{N}]$/u.test(word.text)
        &&word.confidence>=.85&&!(!explicit&&/^[年月日元%‰㎡]$/u.test(word.text))
        &&word.x+word.width/2>=rule.from&&word.x+word.width/2<=rule.to)))continue;
      // Raster interpolation can expose several nested horizontal cores of
      // the same isolated stroke. They are one anchor, not competing fields.
      const same=found.find(r=>Math.abs(r.at-rule.at)<=1
        &&Math.min(r.to,rule.to)-Math.max(r.from,rule.from)>=Math.min(r.to-r.from,rule.to-rule.from)*.8);
      if(same){same.from=Math.min(same.from,rule.from);same.to=Math.max(same.to,rule.to);}
      else if(!found.some(r=>Math.abs(r.at-rule.at)<3&&Math.abs(r.from-rule.from)<3&&Math.abs(r.to-rule.to)<3))found.push(rule);
    }
    if(!explicit)return found.map(rule=>({...rule,isolatedWriting:true}));
    for(const token of tokens){
      const center=token.x+token.width/2;
      let anchors=found.filter(rule=>center>=rule.from&&center<=rule.to);
      if(!anchors.length&&token.confidence>=.75)anchors=found.filter(rule=>rule.to-rule.from<h*.8
        &&Math.max(rule.from-center,center-rule.to)<=Math.min(12,h*.15)
        &&withoutTextStrokeRules([rule],[line]).length===1);
      if(anchors.length!==1)continue;
      // The OCR may omit other blank lines in this same row. Require the same
      // independently isolated baseline as its one proven underscore anchor.
      for(const rule of found)if(Math.abs(rule.at-anchors[0].at)<3
        &&!result.some(other=>Math.abs(other.at-rule.at)<3&&Math.abs(other.from-rule.from)<3))result.push({...rule,isolatedWriting:true});
    }
  }
  return result;
}

/** Classify only isolated raster-detected rules proven to lie inside a single
 * confidently recognized letter. Real grid junctions and native rules survive.
 * CTC boxes describe peaks; midpoint cells assign their surrounding letter ink.
 */
export function withoutTextStrokeRules(rules, lines) {
  if (!rules.length) return rules;
  const letters=[];
  for (const line of lines) {
    if (typeof line?.text!=='string'||line.text.length>8000||!(line.confidence>=.85&&line.height>=6&&line.height<=600)
      ||![line.x,line.y,line.width,line.height].every(Number.isFinite)
      ||line.width<line.height*1.5||!Array.isArray(line.words)||line.words.length<2||line.words.length>200
      ||line.words.some(word=>!word||typeof word.text!=='string'||word.text.length>16)
      ||line.words.map(word=>word.text).join('').replace(/\s/gu,'')!==line.text.replace(/\s/gu,'')) continue;
    const words=line.words.filter(word=>typeof word.text==='string'&&word.text.trim());
    if(words.some((word,index)=>![word.x,word.y,word.width,word.height].every(Number.isFinite)
      ||word.width<=0||word.height<=0||word.x<line.x-2||word.x+word.width>line.x+line.width+2
      ||word.y<line.y-2||word.y+word.height>line.y+line.height+2
      ||index&&word.x+word.width/2<=words[index-1].x+words[index-1].width/2))continue;
    for (let index=0;index<words.length;index++) {
      const word=words[index];
      if(!/^\p{L}$/u.test(word.text))continue;
      const center=word.x+word.width/2,previous=words[index-1],next=words[index+1];
      const left=previous?(previous.x+previous.width/2+center)/2:line.x;
      const right=next?(center+next.x+next.width/2)/2:line.x+line.width;
      if(right-left>line.height*1.75)continue;
      // CTC peaks can move a few source pixels across the true whitespace.
      // Bold title peaks can be a few pixels beyond the ordinary body margin.
      // Bound that uncertainty by glyph height and a small absolute scan cap;
      // the full rule must still fit one letter, away from real grid junctions.
      const pad=Math.min(12,line.height*.08);
      letters.push({rect:{x:left-pad,y:line.y+line.height*.08,width:right-left+pad*2,height:line.height*.84},height:line.height});
      if(letters.length>20000)return rules;
    }
  }
  if(!letters.length)return rules;
  const query=spatialIndex(letters);
  const vertical=spatialIndex(rules.filter(rule=>rule.axis==='v').map(rule=>({rect:{x:rule.at-2,y:rule.from-2,width:4,height:rule.to-rule.from+4}})));
  let remaining=50000;
  return rules.filter(rule=>{
    if(rule.axis!=='h'||remaining<=0)return true;
    const rect={x:rule.from,y:rule.at-.5,width:rule.to-rule.from,height:1};
    if(vertical(rect).length)return true;
    for(const letter of query(rect)){
      if(--remaining<0)return true;
      if(rect.width<=letter.height*1.25&&contains(letter.rect,rect,0))return false;
    }
    return true;
  });
}
