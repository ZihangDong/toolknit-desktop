// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { validRect, right, bottom, union, overlaps, spatialIndex } from './geometry.js';
import { nativeUnicodeScalarItem } from './native-unicode-scalars.js';

const MAX_ITEMS = 20000, MAX_WORK = 65536;
const sameRect = (a, b) => validRect(a) && validRect(b)
  && ['x','y','width','height'].every(k => Math.abs(a[k] - b[k]) < .001);
const expand = (r, amount) => ({ x:r.x-amount, y:r.y-amount, width:r.width+2*amount, height:r.height+2*amount });
const keys = (v, names) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).every(k => names.includes(k));

/** Two complete source-native scalar records, one first-level LOWER index.
 * Coverage is exactly the existing 16-scalar profile. No Greek-range admission,
 * normalized spelling, split compound run, or caller's boolean is evidence. */
function pair(base, index) {
  if (!base || !index || base.id === index.id || base.font !== index.font || base.color !== index.color
    || [base,index].some(g => g.splitFrom || g.sourceRange || g.mathGlyphPositions?.length
      || g.clipped || g.truncated || g.ocrEvidence || g.rect.height < g.size*.25 || g.rect.height > g.size*1.2
      || g.rect.width < g.size*.08 || g.rect.width > g.size*1.3
      || g.advanceWidth > g.size*2 || Math.abs(g.baselineX-g.rect.x) > g.size*.35)) return false;
  const offset = index.baseline-base.baseline, gap=index.rect.x-right(base.rect);
  return index.size >= base.size*.55 && index.size <= base.size*.8
    && offset > base.size*.18 && offset < base.size*.4
    && gap >= -.05 && gap < base.size*.25
    && index.rect.y > base.rect.y+base.size*.1 && bottom(index.rect) > bottom(base.rect)+base.size*.08
    && !overlaps(base.rect,index.rect,.05);
}

export function sourceFirstLevelIndexRegion(region) {
  const proof=region?.sourceFirstLevelIndex;
  if (!keys(proof,['version','baseId','indexId','members']) || proof.version !== 1
    || !Array.isArray(proof.members) || proof.members.length !== 2
    || region.type !== 'image' || region.role !== 'math' || region.ocrMath || region.rasterMathEvidence !== undefined
    || region.reasons?.length || region.mathStrokes?.length || region.drawingIds?.length || region.backgroundPaintIndexes?.length
    || region.sourceNativeUnicodeScalar !== undefined || !Array.isArray(region.mathGlyphs) || region.mathGlyphs.length !== 2
    || !Array.isArray(region.sourceIds) || region.sourceIds.length !== 2) return null;
  const members=proof.members;
  if (members.some(p => !keys(p,['item','source']) || !nativeUnicodeScalarItem(p.item,p.source))) return null;
  const [base,index]=members.map(p=>p.item);
  if (proof.baseId !== base.id || proof.indexId !== index.id || !pair(base,index)
    || !sameRect(region.rect,union([base.rect,index.rect]))
    || region.sourceIds[0] !== base.id || region.sourceIds[1] !== index.id) return null;
  const glyphs=new Map(region.mathGlyphs.map(g=>[g.id,g]));
  if (glyphs.size !== 2 || [base,index].some(item => {
    const g=glyphs.get(item.id);
    return !g || !sameRect(g.rect,item.rect) || g.alphabet || g.mathStyleUncertain || g.radicalPart || g.delimiterPart || g.ocr
      || ['id','text','font','size','baseline','color','preciseInk','raster','bold','italic'].some(k=>g[k]!==item[k]);
  })) return null;
  return { base,index,members };
}

export function sourceFirstLevelIndex(ast, region) {
  const proof=sourceFirstLevelIndexRegion(region);
  if (!proof || !keys(ast,['type','base','subscript']) || ast.type !== 'script') return null;
  const matches=(node,g) => keys(node,['type','sourceId','text','italic','bold']) && node.type === 'symbol'
    && node.sourceId === g.id && node.text === g.text && node.italic === false && node.bold === false;
  return matches(ast.base,proof.base) && matches(ast.subscript,proof.index) ? proof : null;
}

/** Close only an isolated complete pair before the independent singleton pass.
 * An expanded visible neighborhood rejects accents, roots, operators, other
 * script candidates and collisions. Existing formula ownership always wins. */
export function sourceFirstLevelIndexCandidates(text, graphics, sources, groups) {
  if (![text,graphics,sources,groups].every(Array.isArray)
    || [text,graphics,sources,groups].some(a=>a.length>MAX_ITEMS)
    || text.some(g=>!validRect(g?.rect)) || graphics.some(g=>!validRect(g?.rect)) || sources.some(s=>typeof s?.id!=='string')) return [];
  let total=0;
  for (const group of groups) if (!Array.isArray(group) || (total+=group.length)>MAX_ITEMS*2) return [];
  const ids=new Map(), textIds=new Set();
  for (const s of sources) ids.set(s.id,ids.has(s.id)?null:s);
  if (text.some(g=>typeof g?.id!=='string' || textIds.has(g.id) || !textIds.add(g.id))) return [];
  const owned=new Set(groups.flat()), available=text.filter(g=>!owned.has(g) && nativeUnicodeScalarItem(g,ids.get(g.id)));
  const query=spatialIndex([...text,...graphics]), proposals=[], claims=new Map();let work=0;
  for (const base of available) {
    const near=query(expand(base.rect,base.size));work+=near.length;
    if (work>MAX_WORK) return [];
    const eligible=near.filter(index=>index!==base && !owned.has(index) && nativeUnicodeScalarItem(index,ids.get(index.id)) && pair(base,index));
    for (const index of eligible) {
      const rect=union([base.rect,index.rect]), neighbors=query(expand(rect,base.size*.5));work+=neighbors.length;
      if (work>MAX_WORK) return [];
      if (neighbors.some(g=>g!==base && g!==index && overlaps(expand(rect,base.size*.5),g.rect,.1))) continue;
      const proof={ version:1,baseId:base.id,indexId:index.id,members:[base,index].map(item=>({
        item:structuredClone(item),source:structuredClone(ids.get(item.id)) })) };
      const region={ type:'image',role:'math',rect,sourceIds:[base.id,index.id],mathGlyphs:[base,index],
        mathStrokes:[],drawingIds:[],reasons:[],sourceFirstLevelIndex:proof };
      if (!sourceFirstLevelIndexRegion(region)) continue;
      proposals.push({items:[base,index],proof});
      for (const member of [base,index]) claims.set(member,(claims.get(member)||0)+1);
    }
  }
  return proposals.filter(p=>p.items.every(g=>claims.get(g)===1));
}
