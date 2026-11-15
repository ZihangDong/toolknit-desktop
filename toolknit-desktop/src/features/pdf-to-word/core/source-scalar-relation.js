// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import {validRect,right,bottom,union,overlaps,spatialIndex} from './geometry.js';
import {nativeUnicodeScalarItem} from './native-unicode-scalars.js';

const MAX_ITEMS=20000,MAX_WORK=65536;
const keys=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>names.includes(k));
const sameRect=(a,b)=>validRect(a)&&validRect(b)&&['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<.001);
const expand=(r,a)=>({x:r.x-a,y:r.y-a,width:r.width+2*a,height:r.height+2*a});
const face=/^(?:[A-Z]{6}\+)?XITSMath-Regular$/i;
const itemKeys=['id','text','sourceIds','rect','font','size','baseline','baselineX','advanceWidth','color','bold','italic','preciseInk','raster','glyphPositions','mathGlyphPositions'];
const copyItem=g=>Object.fromEntries(itemKeys.filter(k=>g[k]!==undefined).map(k=>[k,structuredClone(g[k])]));
const copySource=s=>({id:s.id,text:s.text,rect:{...s.rect},order:s.order,disposition:s.disposition});
const original=(g,s)=>Boolean(g&&s&&typeof g.id==='string'&&g.id.length>0&&g.id.length<=256
 &&typeof g.text==='string'&&g.text.length>0&&g.text.length<=4&&face.test(g.font||'')
 &&Array.isArray(g.sourceIds)&&g.sourceIds.length===1&&g.sourceIds[0]===g.id&&validRect(g.rect)
 &&Number.isFinite(g.size)&&g.size>=4&&g.size<=40&&Number.isFinite(g.baseline)&&Number.isFinite(g.baselineX)
 &&Number.isFinite(g.advanceWidth)&&g.advanceWidth>0&&g.advanceWidth<=g.size*3
 &&g.preciseInk===true&&g.raster===false&&g.bold===false&&g.italic===false&&/^[0-9a-f]{6}$/i.test(g.color||'')
 &&!g.splitFrom&&!g.sourceRange&&!g.nativeCalibrated&&!g.fontAssetId&&!g.clipped&&!g.truncated&&!g.ocr&&!g.ocrEvidence
 &&!g.alphabet&&!g.mathStyleUncertain&&!g.radicalPart&&!g.delimiterPart
 &&Array.isArray(g.glyphPositions)&&g.glyphPositions.length>=1&&g.glyphPositions.length<=2
 &&g.glyphPositions.every(p=>p&&typeof p.text==='string'&&p.text.length<=2&&[...p.text].length===1&&validRect(p.rect))
 &&s.id===g.id&&s.text===g.text&&s.disposition==='editable'&&!s.ocrUnverified&&!s.encodingCorrections?.length&&sameRect(s.rect,g.rect));
const single=(g,s)=>original(g,s)&&g.glyphPositions.length===1&&g.glyphPositions[0].text===g.text
 &&sameRect(g.glyphPositions[0].rect,g.rect)&&!g.mathGlyphPositions?.length;

// Exact complete native tail, never a guessed substring or uniformly divided box.
function tailParts(g,s){
 if(!original(g,s)||!/^([=≠≤≥]) ?([0-9])$/u.test(g.text)||g.glyphPositions.length!==2
  ||!Array.isArray(g.mathGlyphPositions)||g.mathGlyphPositions.length!==2)return null;
 const parts=g.mathGlyphPositions;
 for(let i=0;i<2;i++){
  const p=parts[i],offset=i?g.text.length-1:0;
  if(!p||!validRect(p.rect)||p.text!==g.text[offset]||p.sourceOffset!==offset
   ||!sameRect(p.rect,g.glyphPositions[i].rect)||p.text!==g.glyphPositions[i].text
   ||!Number.isFinite(p.baseline)||Math.abs(p.baseline-g.baseline)>.05||!Number.isFinite(p.baselineX)
   ||!Number.isFinite(p.advanceWidth)||p.advanceWidth<=0||p.advanceWidth>g.size*1.5
   ||Math.abs(p.baselineX-p.rect.x)>g.size*.35)return null;
 }
 if(!sameRect(union(parts.map(p=>p.rect)),g.rect)||parts[1].rect.x<=right(parts[0].rect)
  ||parts[1].baselineX<parts[0].baselineX+parts[0].advanceWidth-.05
  ||parts[1].rect.x-right(parts[0].rect)>g.size*.6)return null;
 return parts.map(p=>({...g,id:g.id+':math-part:'+p.sourceOffset,text:p.text,rect:p.rect,
  baseline:p.baseline,baselineX:p.baselineX,advanceWidth:p.advanceWidth,
  glyphPositions:undefined,mathGlyphPositions:undefined,splitFrom:g.id,sourceRange:[p.sourceOffset,p.sourceOffset+1]}));
}
function geometry(base,upper,tail){
 const shift=base.baseline-upper.baseline,gap=upper.rect.x-right(base.rect);
 return base.id!==upper.id&&base.id!==tail.id&&upper.id!==tail.id
  &&base.font===upper.font&&base.font===tail.font&&base.color===upper.color&&base.color===tail.color
  &&upper.size>=base.size*.55&&upper.size<=base.size*.8&&Math.abs(tail.size-base.size)<.05
  &&Math.abs(tail.baseline-base.baseline)<.05&&shift>base.size*.2&&shift<base.size*.65
  &&gap>=0&&gap<base.size*.25&&bottom(upper.rect)<base.baseline-base.size*.15
  &&upper.rect.y<base.rect.y-base.size*.15&&!overlaps(base.rect,upper.rect,.05)
  &&tail.rect.x>right(upper.rect)+base.size*.05&&tail.rect.x-right(upper.rect)<base.size*.6
  &&[base,upper].every(g=>g.rect.width>=g.size*.08&&g.rect.width<=g.size*1.3
   &&g.rect.height>=g.size*.25&&g.rect.height<=g.size*1.2&&Math.abs(g.baselineX-g.rect.x)<=g.size*.35);
}
const glyphEqual=(a,b)=>a&&sameRect(a.rect,b.rect)
 &&['id','text','font','size','baseline','baselineX','advanceWidth','color','preciseInk','raster','bold','italic','splitFrom'].every(k=>a[k]===b[k])
 &&!a.alphabet&&!a.mathStyleUncertain&&!a.radicalPart&&!a.delimiterPart&&!a.ocr&&!a.clipped&&!a.truncated
 &&(b.splitFrom?Array.isArray(a.sourceRange)&&a.sourceRange.length===2&&a.sourceRange.every((v,i)=>v===b.sourceRange[i]):!a.sourceRange);

/** Entire source-bound relation. The existing scalar16 table remains the only
 * nondefault glyph profile. A boolean or a singleton proof cannot enable it. */
export function sourceScalarRelationRegion(region){
 const p=region?.sourceScalarRelation;
 if(!keys(p,['version','members'])||p.version!==1||!Array.isArray(p.members)||p.members.length!==3
  ||region.type!=='image'||region.role!=='math'||region.ocrMath||region.rasterMathEvidence!==undefined
  ||region.reasons?.length||region.mathStrokes?.length||region.drawingIds?.length||region.backgroundPaintIndexes?.length
  ||region.sourceNativeUnicodeScalar!==undefined||region.sourceFirstLevelIndex!==undefined||region.sourceUpperAttachment!==undefined
  ||!Array.isArray(region.sourceIds)||region.sourceIds.length!==3||!Array.isArray(region.mathGlyphs)||region.mathGlyphs.length!==4)return null;
 if(p.members.some(m=>!keys(m,['item','source'])||!original(m.item,m.source)))return null;
 const [b,u,t]=p.members,[base,upper,tail]=p.members.map(m=>m.item);
 if(!single(base,b.source)||!nativeUnicodeScalarItem(base,b.source)||!single(upper,u.source)||!/^[0-9]$/.test(upper.text)
  ||!geometry(base,upper,tail)||!sameRect(region.rect,union([base.rect,upper.rect,tail.rect])))return null;
 const parts=tailParts(tail,t.source);if(!parts)return null;
 const glyphs=[base,upper,...parts];
 if(!region.sourceIds.every((id,i)=>id===p.members[i].item.id)||!region.mathGlyphs.every((g,i)=>glyphEqual(g,glyphs[i])))return null;
 return {base,upper,tail,glyphs,members:p.members};
}
export function sourceScalarRelation(ast,region){
 const proof=sourceScalarRelationRegion(region);
 if(!proof||!keys(ast,['type','children'])||ast.type!=='row'||!Array.isArray(ast.children)||ast.children.length!==3)return null;
 const [power,operator,rhs]=ast.children;
 const symbol=(n,g)=>keys(n,['type','sourceId','text','italic','bold'])&&n.type==='symbol'&&n.sourceId===g.id&&n.text===g.text&&n.italic===false&&n.bold===false;
 return keys(power,['type','base','superscript'])&&power.type==='script'&&symbol(power.base,proof.base)&&symbol(power.superscript,proof.upper)
  &&symbol(operator,proof.glyphs[2])&&symbol(rhs,proof.glyphs[3])?proof:null;
}

/** Bounded whole-source discovery before singletons. Only a fully contained
 * existing tail singleton may be replaced. Complete formula owners win. */
export function sourceScalarRelationCandidates(text,graphics,sources,groups){
 if(![text,graphics,sources,groups].every(Array.isArray)||[text,graphics,sources,groups].some(a=>a.length>MAX_ITEMS)
  ||text.some(g=>typeof g?.id!=='string'||!validRect(g.rect))||graphics.some(g=>!validRect(g?.rect))
  ||sources.some(s=>typeof s?.id!=='string'))return [];
 const byId=new Map(),textIds=new Set();let total=0;
 for(const s of sources)byId.set(s.id,byId.has(s.id)?null:s);
 for(const g of text){if(textIds.has(g.id))return [];textIds.add(g.id);}
 for(const group of groups)if(!Array.isArray(group)||(total+=group.length)>MAX_ITEMS*2)return [];
 const query=spatialIndex([...text,...graphics]),proposals=[],claims=new Map();let work=0;
 for(const base of text){
  if(!single(base,byId.get(base.id))||!nativeUnicodeScalarItem(base,byId.get(base.id)))continue;
  const near=query(expand(base.rect,base.size*2));if((work+=near.length)>MAX_WORK)return [];
  const uppers=near.filter(g=>g!==base&&single(g,byId.get(g.id))&&/^[0-9]$/.test(g.text));
  const tails=near.filter(g=>g!==base&&tailParts(g,byId.get(g.id)));
  for(const upper of uppers)for(const tail of tails){
   if(++work>MAX_WORK)return [];
   if(!geometry(base,upper,tail))continue;
   const items=[base,upper,tail],members=new Set(items),rect=union(items.map(g=>g.rect));
   if(groups.some(gr=>gr.some(g=>members.has(g))&&!(gr.length===1&&gr[0]===tail)))continue;
   const neighbors=query(expand(rect,base.size*.5));if((work+=neighbors.length)>MAX_WORK)return [];
   if(neighbors.some(g=>!members.has(g)&&(overlaps(expand(rect,.1),g.rect,.1)
    ||overlaps(expand(rect,base.size*.5),g.rect,.1)&&(face.test(g.font||'')||!g.text||/[\p{Script=Latin}\p{Script=Greek}\p{N}\p{Sm}\p{M}\u{1d400}-\u{1d7ff}()[\]{}|/]/u.test(g.text)))))continue;
   const proof={version:1,members:items.map(g=>({item:copyItem(g),source:copySource(byId.get(g.id))}))};
   const glyphs=structuredClone([proof.members[0].item,proof.members[1].item,...tailParts(proof.members[2].item,proof.members[2].source)]);
   const region={type:'image',role:'math',rect,sourceIds:items.map(g=>g.id),mathGlyphs:glyphs,mathStrokes:[],drawingIds:[],reasons:[],sourceScalarRelation:proof};
   if(!sourceScalarRelationRegion(region))continue;
   proposals.push({items,proof,glyphs});for(const g of items)claims.set(g,(claims.get(g)||0)+1);
  }
 }
 return proposals.filter(p=>p.items.every(g=>claims.get(g)===1));
}
