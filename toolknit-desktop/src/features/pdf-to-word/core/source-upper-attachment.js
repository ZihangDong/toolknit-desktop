// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { validRect, union, right, bottom, overlaps, spatialIndex, contains } from './geometry.js';
import { completeMathGlyphPositions, nativeMathRunParts } from './math-limit-runs.js';
import { sourceUpperAttachmentMetric } from './source-upper-attachment-profile.js';

const MAX_ITEMS=20000, MAX_WORK=65536;
const xits=/^(?:[A-Z]{6}\+)?XITSMath-Regular$/;
const times=/^(?:[A-Z]{6}\+)?TimesNewRomanPSMT$/;
const sameRect=(a,b)=>validRect(a)&&validRect(b)&&['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<.001);
const keys=(o, allowed)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>allowed.includes(k));
function canonical(value) {
  let work=0;
  const visit=(o,depth=0)=>{
    if(++work>2048||depth>12||typeof o==='string'&&o.length>4096)throw Error('bounded-attachment-evidence');
    if(Array.isArray(o)){if(o.length>64)throw Error('bounded-attachment-array');return o.map(v=>visit(v,depth+1));}
    if(o&&typeof o==='object'){
      const names=Object.keys(o);if(names.length>64||names.some(k=>k.length>256))throw Error('bounded-attachment-object');
      return Object.fromEntries(names.filter(k=>o[k]!==undefined).sort().map(k=>[k,visit(o[k],depth+1)]));
    }
    if(!['undefined','boolean','string','number'].includes(typeof o)&&o!==null||typeof o==='number'&&!Number.isFinite(o))throw Error('invalid-attachment-value');
    return o;
  };
  return visit(value);
}
const exact=(a,b)=>{try{return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));}catch{return false;}};
const expand=(r,p)=>({x:r.x-p,y:r.y-p,width:r.width+2*p,height:r.height+2*p});
const mathLetter=s=>typeof s==='string'&&[...s].length===1&&/^\p{L}$/u.test(s)
  &&(s==='ℎ'||s.codePointAt(0)>=0x1d434&&s.codePointAt(0)<=0x1d467);
const symbol=g=>({type:'symbol',sourceId:g.id,text:g.text,italic:false,bold:false});
const row=children=>children.length===1?children[0]:{type:'row',children};
const clean=g=>g&&typeof g.id==='string'&&g.id.length>0&&g.id.length<=256&&typeof g.text==='string'&&g.text.length<=64
  &&typeof g.font==='string'&&g.font.length<=160
  &&g.preciseInk===true&&g.raster===false&&!g.reason&&!g.ocr&&!g.ocrEvidence&&!g.alphabet&&!g.mathStyleUncertain
  &&!g.radicalPart&&!g.delimiterPart&&!g.bold&&!g.italic&&!g.nativeCalibrated&&!g.fontAssetId
  &&!g.splitFrom&&!g.sourceRange&&!g.clipped&&!g.truncated&&validRect(g.rect)&&g.size>=4&&g.size<=40
  &&Number.isFinite(g.baseline+g.baselineX+g.advanceWidth)&&g.advanceWidth>0&&g.advanceWidth<=g.size*8
  &&g.horizontalScale===1&&/^[0-9a-f]{6}$/i.test(g.color||'')&&g.sourceIds?.length===1&&g.sourceIds[0]===g.id;
const ledger=(g,s)=>clean(g)&&s?.id===g.id&&s.text===g.text&&sameRect(s.rect,g.rect)
  &&s.disposition==='editable'&&!s.ocrUnverified&&!s.encodingCorrections?.length;

function spans(g) {
  const w=g.words;
  if(!times.test(g.font||'')||!Array.isArray(w)||w.length<2||w.length>4
    ||!/^[a-z]{3,8}$/.test(g.text)||w.map(p=>p.text).join('')!==g.text
    ||w.some((p,i)=>!p||!/^[a-z]{1,2}$/.test(p.text)||p.spaceBefore!==false||!validRect(p.rect)
      ||!contains(g.rect,p.rect,.001)||!Number.isFinite(p.baselineX+p.advanceWidth)||p.advanceWidth<=0
      ||Math.abs(p.baselineX-p.rect.x)>g.size*.2||i&&(p.rect.x<right(w[i-1].rect)
        ||p.baselineX-w[i-1].baselineX-w[i-1].advanceWidth<g.size*.08
        ||p.baselineX-w[i-1].baselineX-w[i-1].advanceWidth>g.size*.4))
    ||w.at(-1).text.length!==1||!sameRect(g.rect,union(w.map(p=>p.rect)))
    ||Math.abs(w[0].baselineX-g.baselineX)>.001
    ||Math.abs(w.at(-1).baselineX+w.at(-1).advanceWidth-g.baselineX-g.advanceWidth)>.001) return null;
  let offset=0;
  return w.map(p=>{
    const start=offset;offset+=p.text.length;
    return {...g,id:g.id+':upper-word:'+start,text:p.text,rect:{...p.rect},baselineX:p.baselineX,advanceWidth:p.advanceWidth,
      words:undefined,glyphPositions:undefined,mathGlyphPositions:undefined,splitFrom:g.id,sourceRange:[start,offset]};
  });
}

function pair(main, exponent) {
  if(!clean(main)||!clean(exponent)||main.id===exponent.id||main.color!==exponent.color
    ||!xits.test(exponent.font||'')||exponent.size<main.size*.55||exponent.size>main.size*.8) return null;
  let kind, parts, upper;
  const positions=completeMathGlyphPositions(main,3);
  if(xits.test(main.font||'')&&main.font===exponent.font&&positions?.length===3
    &&positions[0].sourceOffset===0&&positions[1].text==='='&&mathLetter(positions[0].text)&&mathLetter(positions[2].text)
    &&mathLetter(exponent.text)&&exponent.glyphPositions?.length===1
    &&exponent.glyphPositions[0].text===exponent.text&&sameRect(exponent.glyphPositions[0].rect,exponent.rect)) {
    kind='literal-equality-power';parts=nativeMathRunParts(main);upper=[exponent];
    if(!parts||parts.length!==3) return null;
  } else {
    parts=spans(main);
    const power=completeMathGlyphPositions(exponent,2);
    if(!parts||!/^[−][1-9]$/u.test(exponent.text)||power?.length!==2||power[0].text!=='−'
      ||power[1].text!==exponent.text[1]||power[0].sourceOffset!==0||power[1].sourceOffset!==1) return null;
    upper=nativeMathRunParts(exponent);if(!upper||upper.length!==2)return null;
    kind='upright-negative-power';
  }
  const base=parts.at(-1), offset=exponent.baseline-main.baseline, gap=exponent.rect.x-right(base.rect);
  if(offset>=-main.size*.2||offset<=-main.size*.6||gap<-.05||gap>main.size*.25
    ||bottom(exponent.rect)>main.baseline-main.size*.15
    ||exponent.rect.y>=base.rect.y-main.size*.12||overlaps(base.rect,exponent.rect,.05))return null;
  const glyphs=[...parts,...upper];
  if(new Set(glyphs.map(g=>g.id)).size!==glyphs.length)return null;
  if(glyphs.some(g=>[...g.text].some(c=>!sourceUpperAttachmentMetric(times.test(g.font||'')?'Times New Roman':'Cambria Math',c))))return null;
  const expected=row([...parts.slice(0,-1).map(symbol),{type:'script',base:symbol(base),superscript:row(upper.map(symbol))}]);
  return {kind,glyphs,expected,base,exponent};
}

export function sourceUpperAttachmentRegion(region) {
  const p=region?.sourceUpperAttachment;
  if(!keys(p,['version','kind','members'])||p.version!==1||!Array.isArray(p.members)||p.members.length!==2
    ||region.type!=='image'||region.role!=='math'||region.ocrMath||region.rasterMathEvidence!==undefined
    ||region.sourceNativeUnicodeScalar!==undefined||region.sourceFirstLevelIndex!==undefined||region.sourceScalarRelation!==undefined||region.sourceIndexedSum!==undefined
    ||region.mathStrokes?.length||region.drawingIds?.length||region.reasons?.length||region.backgroundPaintIndexes?.length
    ||!Array.isArray(region.sourceIds)||region.sourceIds.length!==2||!Array.isArray(region.mathGlyphs))return null;
  if(p.members.some(m=>!keys(m,['item','source'])||!ledger(m.item,m.source)))return null;
  const [main,exponent]=p.members.map(m=>m.item), result=pair(main,exponent);
  if(!result||p.kind!==result.kind||!exact(region.sourceIds,[main.id,exponent.id])
    ||!sameRect(region.rect,union([main.rect,exponent.rect]))||!exact(region.mathGlyphs,result.glyphs))return null;
  return {...result,main};
}

/** Entire tree, source text, trace ownership and active style must agree.
 * This proof admits neither a caller boolean nor any additional Greek scalar. */
export function sourceUpperAttachment(ast,region) {
  const p=sourceUpperAttachmentRegion(region);
  return p&&exact(ast,p.expected)?p:null;
}

export function sourceUpperAttachmentCandidates(text,graphics,sources,groups) {
  if(![text,graphics,sources,groups].every(Array.isArray)||[text,graphics,sources,groups].some(a=>a.length>MAX_ITEMS)
    ||text.some(g=>!validRect(g?.rect))||graphics.some(g=>!validRect(g?.rect)))return [];
  const byId=new Map(),seen=new Set(),owners=new Map();let work=0,members=0;
  for(const s of sources){if(!s||typeof s.id!=='string')return [];byId.set(s.id,byId.has(s.id)?null:s);}
  for(const g of text){if(seen.has(g.id))return [];seen.add(g.id);}
  for(const g of groups){
    if(!Array.isArray(g)||(members+=g.length)>MAX_ITEMS*2)return [];
    for(const i of g){const own=owners.get(i)||[];own.push(g);owners.set(i,own);}
  }
  const query=spatialIndex([...text,...graphics]),proposals=[],claims=new Map();
  for(const main of text) {
    if(!ledger(main,byId.get(main.id))||!(completeMathGlyphPositions(main,3)?.length===3||spans(main)))continue;
    const near=query(expand(main.rect,main.size*.65));work+=near.length;if(work>MAX_WORK)return [];
    for(const exp of near) {
      if(exp===main||!ledger(exp,byId.get(exp.id)))continue;
      const p=pair(main,exp);if(!p)continue;
      const items=[main,exp],set=new Set(items),rect=union(items.map(g=>g.rect));
      if(p.glyphs.some(g=>g.splitFrom&&byId.has(g.id)))continue;
      // Only a whole isolated exponent fragment may be reclaimed. Any existing
      // larger formula/other source owner keeps its members and partition.
      const ownGroups=new Set(items.flatMap(i=>owners.get(i)||[]));work+=ownGroups.size;if(work>MAX_WORK)return [];
      if([...ownGroups].some(g=>!(g.length===1&&g[0]===exp)))continue;
      const visible=query(expand(rect,main.size*.12));work+=visible.length;if(work>MAX_WORK)return [];
      if(visible.some(i=>!set.has(i)&&overlaps(expand(rect,main.size*.12),i.rect,.05)))continue;
      const proof={version:1,kind:p.kind,members:items.map(item=>({item:structuredClone(item),source:structuredClone(byId.get(item.id))}))};
      const region={type:'image',role:'math',rect,sourceIds:items.map(g=>g.id),mathGlyphs:p.glyphs,
        mathStrokes:[],drawingIds:[],reasons:[],sourceUpperAttachment:proof};
      if(!sourceUpperAttachmentRegion(region))continue;
      proposals.push({items,proof,glyphs:p.glyphs,expected:p.expected});
      items.forEach(i=>claims.set(i,(claims.get(i)||0)+1));
    }
  }
  return proposals.filter(p=>p.items.every(i=>claims.get(i)===1));
}

export function sourceUpperAttachmentMeasurement(font,text,measured) {
  const m=sourceUpperAttachmentMetric(font,text);
  return Boolean(m&&measured&&['width','actualBoundingBoxLeft','actualBoundingBoxRight','actualBoundingBoxAscent','actualBoundingBoxDescent']
    .every(k=>Number.isFinite(measured[k])&&Math.abs(measured[k])<=4096)
    &&Math.abs(measured.width-m.advanceAt1000)<.1
    &&measured.actualBoundingBoxLeft+measured.actualBoundingBoxRight>0
    &&measured.actualBoundingBoxAscent+measured.actualBoundingBoxDescent>0);
}
