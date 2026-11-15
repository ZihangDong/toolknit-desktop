// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import {validRect,right,bottom,union,overlaps,spatialIndex} from './geometry.js';
import {nativeUnicodeScalarMetric,nativeUnicodeScalarMeasurement,nativeUnicodeScalarLayoutMeasurement} from './native-unicode-scalars.js';
import {sourceIndexedSumFontMetric} from './source-indexed-sum-font.js';

export const SOURCE_INDEXED_SUM_LIMITS=Object.freeze({items:20000,work:65536,runs:11,glyphs:13,strokes:1,nodes:32});
const face=/^(?:[A-Z]{6}\+)?XITSMath-Regular$/i;
const keys=(v,n)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>n.includes(k));
const rectEq=(a,b)=>validRect(a)&&validRect(b)&&['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<.001);
const expand=(r,a)=>({x:r.x-a,y:r.y-a,width:r.width+a*2,height:r.height+a*2});
const finite=(...v)=>v.every(Number.isFinite);
const latin=t=>typeof t==='string'&&t.length===2&&t.codePointAt(0)>=0x1d434&&t.codePointAt(0)<=0x1d467&&Boolean(nativeUnicodeScalarMetric(t));
const same=(a,b)=>Math.abs(a-b)<.05;
const itemKeys=['id','sourceIds','text','font','size','baseline','baselineX','advanceWidth','rect','color','preciseInk','raster','bold','italic','glyphPositions','mathGlyphPositions'];
const copyItem=g=>Object.fromEntries(itemKeys.filter(k=>g[k]!==undefined).map(k=>[k,structuredClone(g[k])]));
const copySource=s=>({id:s.id,text:s.text,rect:{...s.rect},order:s.order,disposition:s.disposition});
function original(g,s){
 return Boolean(g&&s&&typeof g.id==='string'&&g.id.length>0&&g.id.length<=256&&typeof g.text==='string'&&g.text.length>0&&g.text.length<=4
  &&face.test(g.font||'')&&validRect(g.rect)&&finite(g.size,g.baseline,g.baselineX,g.advanceWidth)&&g.size>=4&&g.size<=40
  &&(g.text==='\u0304'?g.advanceWidth===0:g.advanceWidth>0&&g.advanceWidth<g.size*2.5)
  &&g.preciseInk===true&&g.raster===false&&g.bold===false&&g.italic===false&&/^[0-9a-f]{6}$/i.test(g.color||'')
  &&!g.ocr&&!g.ocrEvidence&&!g.clipped&&!g.truncated&&!g.splitFrom&&!g.sourceRange&&!g.nativeCalibrated&&!g.fontAssetId
  &&!g.alphabet&&!g.mathStyleUncertain&&!g.radicalPart&&!g.delimiterPart
  &&Array.isArray(g.sourceIds)&&g.sourceIds.length===1&&g.sourceIds[0]===g.id
  &&Array.isArray(g.glyphPositions)&&g.glyphPositions.length>=1&&g.glyphPositions.length<=3
  &&g.glyphPositions.every(p=>p&&typeof p.text==='string'&&p.text.length<=2&&[...p.text].length===1&&validRect(p.rect))
  &&s.id===g.id&&s.text===g.text&&s.disposition==='editable'&&!s.ocrUnverified&&!s.encodingCorrections?.length&&rectEq(s.rect,g.rect));
}
const single=(g,s)=>original(g,s)&&g.glyphPositions.length===1&&g.glyphPositions[0].text===g.text&&rectEq(g.glyphPositions[0].rect,g.rect)&&!g.mathGlyphPositions?.length;
const letter=(g,s)=>single(g,s)&&latin(g.text);
function lowerParts(g,s){
 if(!original(g,s)||g.text.length!==4||!latin(g.text.slice(0,2))||g.text[2]!=='+'||!/^[0-9]$/.test(g.text[3])
  ||g.glyphPositions.length!==3||!Array.isArray(g.mathGlyphPositions)||g.mathGlyphPositions.length!==3)return null;
 const offsets=[0,2,3],ps=g.mathGlyphPositions;
 for(let i=0;i<3;i++){
  const p=ps[i],length=i?1:2;
  if(!p||p.sourceOffset!==offsets[i]||p.text!==g.text.slice(offsets[i],offsets[i]+length)||!rectEq(p.rect,g.glyphPositions[i].rect)
   ||p.text!==g.glyphPositions[i].text||!finite(p.baseline,p.baselineX,p.advanceWidth)||!same(p.baseline,g.baseline)||p.advanceWidth<=0||p.advanceWidth>g.size*1.3
   ||Math.abs(p.baselineX-p.rect.x)>g.size*.35||i&&p.baselineX<ps[i-1].baselineX+ps[i-1].advanceWidth-.05)return null;
 }
 if(!rectEq(union(ps.map(p=>p.rect)),g.rect)||!same(ps[0].baselineX,g.baselineX)
  ||!same(ps[2].baselineX+ps[2].advanceWidth-g.baselineX,g.advanceWidth))return null;
 return ps.map((p,i)=>({...g,id:g.id+':math-part:'+offsets[i],text:p.text,rect:p.rect,baseline:p.baseline,baselineX:p.baselineX,advanceWidth:p.advanceWidth,
  glyphPositions:undefined,mathGlyphPositions:undefined,splitFrom:g.id,sourceRange:[offsets[i],offsets[i]+(i?1:2)]}));
}
function drawing(d,color,em){
 const p=d?.path;
 if(!d||typeof d.id!=='string'||!d.id||d.id.length>256||!validRect(d.rect)||d.thin!==true||d.strokeColor!==color||d.opaque!==true
  ||!Number.isFinite(d.strokeWidth)||d.strokeWidth<=0||d.strokeWidth>em*.12||!p||p.complete!==true||p.paint!=='stroke'||p.color!==color
  ||!Array.isArray(p.from)||!Array.isArray(p.to)||p.from.length!==2||p.to.length!==2||!finite(...p.from,...p.to)
  ||Math.abs(p.from[1]-p.to[1])>.05||p.to[0]<=p.from[0]||d.rect.width<em*.3||d.rect.width>em*.9||d.rect.height>em*.13)return false;
 return rectEq(d.rect,{x:p.from[0]-d.strokeWidth/2,y:p.from[1]-d.strokeWidth/2,width:p.to[0]-p.from[0]+d.strokeWidth,height:d.strokeWidth});
}
function roles(members,d){
 if(!Array.isArray(members)||members.length!==11||members.some(m=>!keys(m,['item','source'])||!original(m.item,m.source)))return null;
 const [a,b,l,e,p,q,o,u,k,c,r]=members.map(m=>m.item),em=b.size,small=l.size;
 const distinct=new Set(members.map(m=>m.item.id));if(distinct.size!==11||distinct.has(d?.id))return null;
 const g=members.map(m=>m.item);if(g.some(x=>x.font!==b.font||x.color!==b.color))return null;
 const isSingle=i=>single(g[i],members[i].source),isLetter=i=>letter(g[i],members[i].source);
 if(![1,2,5,7,9,10].every(isLetter)||![0,3,4,6].every(isSingle)||!lowerParts(k,members[8].source)
  ||a.text!=='\u0304'||e.text!=='='||!/^[1-9]$/.test(p.text)||o.text!=='\u2211'
  ||q.text!==l.text||u.text!==l.text||c.text!==b.text||r.text!==k.text.slice(0,2)||!drawing(d,b.color,em))return null;
 if(![a,e,o,c].every(x=>same(x.size,em))||small<em*.55||small>em*.8||![p,q,u,k,r].every(x=>same(x.size,small)))return null;
 const baseLine=b.baseline,center=a.rect.x+a.rect.width/2,axis=d.path.from[1];
 const indexed=(base,index)=>index.rect.x>=right(base.rect)-.05&&index.rect.x-right(base.rect)<em*.35
  &&index.baseline-base.baseline>em*.15&&index.baseline-base.baseline<em*.45
  &&index.rect.y>base.rect.y+em*.15&&bottom(index.rect)>bottom(base.rect)+em*.1;
 if(!indexed(b,l)||!indexed(c,r)||!same(c.baseline,baseLine)||!same(e.baseline,baseLine)
  ||Math.abs(o.rect.y+o.rect.height/2+em*.25-baseLine)>.08)return null;
 if(a.rect.height<em*.02||a.rect.height>em*.15||a.rect.width<em*.15||a.rect.width>em*.65
  ||center<b.rect.x+em*.05||center>right(b.rect)||right(a.rect)>right(b.rect)+.1
  ||b.rect.y-bottom(a.rect)<em*.05||b.rect.y-bottom(a.rect)>em*.3
  ||baseLine-a.baseline<em*.1||baseLine-a.baseline>em*.3)return null;
 if(e.rect.x-right(l.rect)<em*.1||e.rect.x-right(l.rect)>em*.8||d.rect.x-right(e.rect)<em*.1||d.rect.x-right(e.rect)>em*.8
  ||Math.abs(axis-(baseLine-em*.25))>.1||bottom(p.rect)>axis-.2||q.rect.y<axis+.2
  ||axis-bottom(p.rect)>em*.6||q.rect.y-axis>em*.7)return null;
 for(const x of [p,q])if(x.rect.x<d.rect.x-.1||right(x.rect)>right(d.rect)+.1||Math.abs(x.rect.x+x.rect.width/2-d.rect.x-d.rect.width/2)>small*.4)return null;
 const edge=right(o.rect),ob=o.rect.y+o.rect.height/2+em*.25;
 if(o.rect.x-right(d.rect)<em*.1||o.rect.x-right(d.rect)>em*.8||o.rect.width<em*.55||o.rect.width>em*1.25||o.rect.height<em*.8||o.rect.height>em*1.6)return null;
 if([u,k].some(x=>x.rect.x<edge-.1||right(x.rect)>edge+em*1.2)||ob-u.baseline<em*.2||ob-u.baseline>em*.8
  ||k.baseline-ob<em*.2||k.baseline-ob>em*.7||bottom(u.rect)>k.rect.y-.1||k.rect.width>em*1.4)return null;
 if(c.rect.x-right(k.rect)<em*.1||c.rect.x-right(k.rect)>em*.65||c.rect.x-right(u.rect)<em*.3)return null;
 const rect=union([...g.map(x=>x.rect),d.rect]);if(rect.width>em*8||rect.height>em*2)return null;
 return{accent:a,base:b,index:l,relation:e,numerator:p,denominator:q,operator:o,upper:u,lower:k,body:c,bodyIndex:r,members,drawing:d,rect};
}
const stroke=d=>({id:d.id,rect:d.rect,thin:true,color:d.strokeColor,unmapped:false,path:d.path});
const glyphs=p=>structuredClone([...p.members.slice(0,8).map(m=>m.item),...lowerParts(p.lower,p.members[8].source),p.body,p.bodyIndex]);
function equalGlyph(a,b){
 return a&&rectEq(a.rect,b.rect)&&['id','text','font','size','baseline','baselineX','advanceWidth','color','preciseInk','raster','bold','italic','splitFrom'].every(k=>a[k]===b[k])
  &&!a.alphabet&&!a.mathStyleUncertain&&!a.radicalPart&&!a.delimiterPart&&!a.ocr&&!a.clipped&&!a.truncated
  &&(b.splitFrom?Array.isArray(a.sourceRange)&&a.sourceRange.length===2&&a.sourceRange.every((v,i)=>v===b.sourceRange[i]):!a.sourceRange);
}
export function sourceIndexedSumRegion(region){
 const proof=region?.sourceIndexedSum;
 if(!keys(proof,['version','members','drawing'])||proof.version!==1||region.type!=='image'||region.role!=='math'
  ||region.ocrMath||region.rasterMathEvidence!==undefined||region.reasons?.length||region.backgroundPaintIndexes?.length
  ||['sourceUpperAttachment','sourceScalarRelation','sourceFirstLevelIndex','sourceNativeUnicodeScalar'].some(k=>region[k]!==undefined)
  ||!Array.isArray(region.sourceIds)||region.sourceIds.length!==11||!Array.isArray(region.mathGlyphs)||region.mathGlyphs.length!==13
  ||!Array.isArray(region.mathStrokes)||region.mathStrokes.length!==1||!Array.isArray(region.drawingIds)||region.drawingIds.length!==1)return null;
 const p=roles(proof.members,proof.drawing);if(!p||!rectEq(region.rect,p.rect)||!region.sourceIds.every((id,i)=>id===p.members[i].item.id)||region.drawingIds[0]!==p.drawing.id)return null;
 const gs=glyphs(p),s=region.mathStrokes[0],expected=stroke(p.drawing);
 if(!region.mathGlyphs.every((g,i)=>equalGlyph(g,gs[i]))||!s||s.id!==expected.id||!rectEq(s.rect,expected.rect)||s.thin!==true||s.unmapped!==false||s.color!==expected.color
  ||JSON.stringify(s.path)!==JSON.stringify(expected.path))return null;
 return{...p,glyphs:gs,stroke:expected};
}
const sym=g=>({type:'symbol',sourceId:g.id,text:g.text,italic:false,bold:false});
function tree(p){
 const lower=lowerParts(p.lower,p.members[8].source);
 return{type:'row',children:[{type:'script',base:{type:'accent',sourceId:p.accent.id,text:p.accent.text,base:sym(p.base)},subscript:sym(p.index)},sym(p.relation),
  {type:'fraction',strokeId:p.drawing.id,numerator:sym(p.numerator),denominator:sym(p.denominator)},
  {type:'nary',operator:sym(p.operator),lower:{type:'row',children:lower.map(sym)},upper:sym(p.upper),body:{type:'script',base:sym(p.body),subscript:sym(p.bodyIndex)}}]};
}
export function inferSourceIndexedSum(region){const p=sourceIndexedSumRegion(region);return p?tree(p):null;}
export function sourceIndexedSum(ast,region){
 const p=sourceIndexedSumRegion(region);if(!p)return null;let budget=32;const seen=new Set();
 const match=(a,b,depth=0)=>{
  if(--budget<0||depth>8||!a||typeof a!=='object'||seen.has(a)||Array.isArray(a)!==Array.isArray(b))return false;seen.add(a);
  const ak=Object.keys(a),bk=Object.keys(b);return ak.length===bk.length&&ak.every(k=>Object.hasOwn(b,k)&&(b[k]&&typeof b[k]==='object'?match(a[k],b[k],depth+1):a[k]===b[k]));
 };
 return match(ast,tree(p))?p:null;
}
export function sourceIndexedSumMeasurement(text,metrics){
 if(latin(text))return nativeUnicodeScalarMeasurement({font:'Cambria Math',text,metrics});
 const m=sourceIndexedSumFontMetric(text);return Boolean(m&&metrics&&['width','actualBoundingBoxLeft','actualBoundingBoxRight','actualBoundingBoxAscent','actualBoundingBoxDescent'].every(k=>Number.isFinite(metrics[k])&&Math.abs(metrics[k])<=4096)
  &&Math.abs(metrics.width-m.advanceAt1000)<.1&&metrics.actualBoundingBoxLeft+metrics.actualBoundingBoxRight>0&&metrics.actualBoundingBoxAscent+metrics.actualBoundingBoxDescent>0);
}
export function sourceIndexedSumLayoutMeasurement(text,format,measured){
 if(latin(text))return nativeUnicodeScalarLayoutMeasurement(text,format,measured);
 const m=sourceIndexedSumFontMetric(text),unit=format.size/1000*format.scale/100;
 return Boolean(m&&format.font==='Cambria Math'&&measured&&finite(measured.width,measured.height,measured.depth)&&measured.height+measured.depth>0
  &&Math.abs(measured.width-m.advanceAt1000*unit-format.spacing)<Math.max(1e-9,.1*unit));
}

/** One complete bounded class, discovered from actual original records. No
 * filename/page/text-label/source-ID/coordinates enter this source proof. */
export function sourceIndexedSumCandidates(text,graphics,sources,groups){
 const L=SOURCE_INDEXED_SUM_LIMITS;if(![text,graphics,sources,groups].every(Array.isArray)||[text,graphics,sources,groups].some(a=>a.length>L.items)
  ||text.some(g=>typeof g?.id!=='string'||!validRect(g.rect))||graphics.some(g=>!validRect(g?.rect))||sources.some(s=>typeof s?.id!=='string'))return[];
 const byId=new Map(),textIds=new Set();for(const s of sources)byId.set(s.id,byId.has(s.id)?null:s);
 for(const g of text){if(textIds.has(g.id))return[];textIds.add(g.id);}let total=0;
 for(const gr of groups)if(!Array.isArray(gr)||(total+=gr.length)>L.items*2)return[];
 const query=spatialIndex([...text,...graphics]),proposals=[],claims=new Map();let work=0;
 const singleSource=g=>single(g,byId.get(g?.id)),letterSource=g=>letter(g,byId.get(g?.id));
 for(const a of text){
  if(a.text!=='\u0304'||!singleSource(a))continue;
  const near=query({x:a.rect.x-a.size,y:a.rect.y-a.size,width:a.size*9,height:a.size*3});if((work+=near.length)>L.work)return[];
  const one=fn=>{work+=near.length;if(work>L.work)return null;const list=near.filter(fn);return list.length===1?list[0]:null;};
  const b=one(g=>letterSource(g)&&same(g.size,a.size)&&g.rect.y>bottom(a.rect)&&g.rect.y-bottom(a.rect)<a.size*.3&&a.rect.x+a.rect.width/2>=g.rect.x&&a.rect.x+a.rect.width/2<=right(g.rect));if(!b)continue;
  const em=b.size,l=one(g=>letterSource(g)&&g.size>=em*.55&&g.size<=em*.8&&g.rect.x>=right(b.rect)-.05&&g.rect.x-right(b.rect)<em*.35&&g.baseline-b.baseline>em*.15&&g.baseline-b.baseline<em*.45);if(!l)continue;
  const e=one(g=>singleSource(g)&&g.text==='='&&same(g.size,em)&&same(g.baseline,b.baseline)&&g.rect.x>right(l.rect)&&g.rect.x-right(l.rect)<em*.8);if(!e)continue;
  const d=one(g=>!g.text&&drawing(g,b.color,em)&&g.rect.x>right(e.rect)&&g.rect.x-right(e.rect)<em*.8&&Math.abs(g.path.from[1]-(b.baseline-em*.25))<.1);if(!d)continue;
  const p=one(g=>singleSource(g)&&/^[1-9]$/.test(g.text)&&same(g.size,l.size)&&g.rect.x>=d.rect.x-.1&&right(g.rect)<=right(d.rect)+.1&&bottom(g.rect)<d.path.from[1]-.2);if(!p)continue;
  const q=one(g=>letterSource(g)&&g.text===l.text&&same(g.size,l.size)&&g.rect.x>=d.rect.x-.1&&right(g.rect)<=right(d.rect)+.1&&g.rect.y>d.path.from[1]+.2);if(!q)continue;
  const o=one(g=>singleSource(g)&&g.text==='\u2211'&&same(g.size,em)&&g.rect.x>right(d.rect)&&g.rect.x-right(d.rect)<em*.8);if(!o)continue;
  const u=one(g=>letterSource(g)&&g.text===l.text&&same(g.size,l.size)&&g.rect.x>=right(o.rect)-.1&&g.rect.x-right(o.rect)<em*.3&&g.baseline<b.baseline-em*.2);if(!u)continue;
  const k=one(g=>lowerParts(g,byId.get(g?.id))&&same(g.size,l.size)&&g.rect.x>=right(o.rect)-.1&&g.rect.x-right(o.rect)<em*.3&&g.baseline>b.baseline+em*.2);if(!k)continue;
  const c=one(g=>letterSource(g)&&g.text===b.text&&same(g.size,em)&&same(g.baseline,b.baseline)&&g.rect.x>right(k.rect)&&g.rect.x-right(k.rect)<em*.65);if(!c)continue;
  const r=one(g=>letterSource(g)&&g.text===k.text.slice(0,2)&&same(g.size,l.size)&&g.rect.x>=right(c.rect)-.05&&g.rect.x-right(c.rect)<em*.35&&g.baseline-c.baseline>em*.15&&g.baseline-c.baseline<em*.45);if(!r)continue;
  const items=[a,b,l,e,p,q,o,u,k,c,r],owned=new Set([...items,d]);
  if(groups.some(gr=>gr.some(g=>owned.has(g))&&!gr.every(g=>owned.has(g))))continue;
  const proof={version:1,members:items.map(g=>({item:copyItem(g),source:copySource(byId.get(g.id))})),drawing:structuredClone({id:d.id,rect:d.rect,thin:d.thin,strokeColor:d.strokeColor,strokeWidth:d.strokeWidth,opaque:d.opaque,path:d.path})};
  const p0=roles(proof.members,proof.drawing);if(!p0)continue;
  const others=query(expand(p0.rect,em*.35));if((work+=others.length)>L.work)return[];
  if(others.some(g=>!owned.has(g)&&(overlaps(expand(p0.rect,.1),g.rect,.1)||overlaps(expand(p0.rect,em*.35),g.rect,.1)&&(!g.text||/[\p{Script=Latin}\p{Script=Greek}\p{N}\p{Sm}\p{M}\u{1d400}-\u{1d7ff}()[\]{}|/]/u.test(g.text)))))continue;
  const region={type:'image',role:'math',rect:p0.rect,sourceIds:items.map(g=>g.id),mathGlyphs:glyphs(p0),mathStrokes:[structuredClone(stroke(proof.drawing))],drawingIds:[d.id],reasons:[],sourceIndexedSum:proof};
  if(!sourceIndexedSumRegion(region))continue;proposals.push({items,drawing:d,proof,glyphs:region.mathGlyphs,stroke:region.mathStrokes[0],region});
  for(const g of owned)claims.set(g,(claims.get(g)||0)+1);
 }
 return work>L.work?[]:proposals.filter(p=>[...p.items,p.drawing].every(g=>claims.get(g)===1));
}
