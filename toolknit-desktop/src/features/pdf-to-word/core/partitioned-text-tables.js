// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import {right,bottom,median,contains,overlaps,union} from './geometry.js';
import {groupLines,buildParagraphs,lineText} from './text.js';
import {baselineBands} from './reading-order.js';
import { nativeTableRowCandidate, nativeTableFunctionGlyphs, nativeTableNumericGlyphs } from './native-table-row.js';

const same=(a,b)=>a&&b&&['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<.01);
function continuous(rules,top,end){let cursor=top;for(const r of [...rules].sort((a,b)=>a.from-b.from)){if(r.from>cursor+.6)return false;cursor=Math.max(cursor,r.to);}return cursor>=end-.6;}
function paragraphs(items,rect){
 const lines=groupLines(items.map(item=>({...item,type:'text'}))),bands=baselineBands(lines).map(group=>{
  const parts=group.flatMap(l=>l.items).sort((a,b)=>a.rect.x-b.rect.x);
  return {...group[0],items:parts,text:lineText(parts),sourceIds:parts.flatMap(t=>t.sourceIds),rect:union(parts.map(t=>t.rect))};
 });
 return buildParagraphs(bands,rect).map(b=>({...b,align:'left'}));
}
/** Closed horizontal extent and continuous internal partitions prove a native
 * text/numeric grid. Preserve open side edges and the original rule artwork. */
export function partitionedTextTables(text,rules,sources,bounds){
 if(!bounds||text.length>2500||rules.length>1200||sources.length>12000)return[];
 const src=new Map(sources.map(s=>[s.id,s]));if(src.size!==sources.length)return[];
 const bands=[];
 for(const h of rules.filter(r=>r.axis==='h'&&r.to-r.from>=80)){
  let band=bands.find(b=>Math.abs(b[0].from-h.from)<.5&&Math.abs(b[0].to-h.to)<.5);
  if(!band)bands.push(band=[]);if(!band.some(r=>Math.abs(r.at-h.at)<.3))band.push(h);
 }
 const tables=[];
 for(const band of bands){
  if(tables.length>=4)break;
  band.sort((a,b)=>a.at-b.at);if((band.length!==1&&band.length<3)||band.length>40)continue;
  const sparse=band.length===1;
  const x=band[0].from,endX=band[0].to,vertical=rules.filter(r=>r.axis==='v'&&r.at>x+2&&r.at<endX-2&&r.to>band[0].at-(sparse?1:0)&&r.from<band.at(-1).at+(sparse?1:0));
  const columns=[];
  for(const v of vertical){let col=columns.find(c=>Math.abs(c[0].at-v.at)<.3);if(!col)columns.push(col=[]);col.push(v);}
  // Continue only the same observed internal strokes through adjacent segments;
  // header/footer segments may sit outside the first/last horizontal separator.
  for(const col of columns){
   const candidates=rules.filter(r=>r.axis==='v'&&Math.abs(r.at-col[0].at)<.3);
   for(let pass=0;pass<candidates.length;pass++){
    const from=Math.min(...col.map(r=>r.from)),to=Math.max(...col.map(r=>r.to));
    const linked=candidates.filter(r=>!col.includes(r)&&r.from<=to+.6&&r.to>=from-.6);
    if(!linked.length)break;col.push(...linked);
   }
  }
  if(columns.length<2||columns.length>8)continue;columns.sort((a,b)=>a[0].at-b[0].at);
  const starts=columns.map(c=>Math.min(...c.map(r=>r.from))),ends=columns.map(c=>Math.max(...c.map(r=>r.to)));
  if(Math.max(...starts)-Math.min(...starts)>.3||Math.max(...ends)-Math.min(...ends)>.3)continue;
  const closed=Math.abs(median(starts)-band[0].at)<.8&&Math.abs(median(ends)-band.at(-1).at)<.8;
  if(!closed&&!(median(starts)<band[0].at-4&&median(ends)>band.at(-1).at+4&&(band.length>=3||sparse)))continue;
  const top=closed?band[0].at:median(starts),end=closed?band.at(-1).at:median(ends);
  if(end-top<25||end-top>450||columns.some(c=>!continuous(c,top,end)||c.some(v=>v.from<top-.6||v.to>end+.6)))continue;
  const rect={x,y:top,width:endX-x,height:end-top};if(!contains(bounds,rect,0)||tables.some(t=>overlaps(t.rect,rect,0)))continue;
  const parents=text.filter(t=>overlaps(rect,t.rect,0));
  if(parents.length<8||parents.length>1500||parents.some(t=>{
   const s=src.get(t.id);return !contains(rect,t.rect,.25)||t.radicalPart||t.delimiterPart
    ||t.sourceIds?.length!==1||t.sourceIds[0]!==t.id||s?.disposition!=='editable'||s.text!==t.text||!same(s.rect,t.rect);
  }))continue;
  const exceptional=parents.filter(t=>!nativeTableRowCandidate(t));
  const functionGlyphs=exceptional.length&&!closed&&!sparse?nativeTableFunctionGlyphs(parents,src):null;
  if(!sparse&&exceptional.length&&(closed||!functionGlyphs||functionGlyphs.length!==exceptional.length||exceptional.some(g=>!functionGlyphs.includes(g))))continue;
  const xs=[x,...columns.map(c=>median(c.map(r=>r.at))),endX],size=median(parents.map(t=>t.size));
  let ys;
  if(closed||sparse){
   const rows=baselineBands(parents).map(r=>({items:r,baseline:median(r.map(t=>t.baseline))}));
   if(rows.length<5||rows.length>100)continue;
   const numeric=/^\s*[+−-]?\d+(?:[.,]\d+)?\s*$/u;
   if(rows.slice(1).filter(row=>row.items.some(t=>numeric.test(t.text))).length<rows.length-2)continue;
   ys=[top];let bad=false;
   for(let i=0;i+1<rows.length;i++){
    const a=rows[i],b=rows[i+1],floor=Math.max(...a.items.map(t=>bottom(t.rect)))+.05,ceiling=Math.min(...b.items.map(t=>t.rect.y))-.05;
    if(ceiling<=floor){bad=true;break;}
    const dividers=band.filter(h=>h.at>=floor&&h.at<=ceiling);
    if(dividers.length>1){bad=true;break;}
    ys.push(dividers[0]?.at??Math.max(floor,Math.min(ceiling,(a.baseline+b.baseline)/2-size*.3)));
   }
   if(bad)continue;ys.push(end);
  }
  if(!closed&&!sparse)ys=[top,...band.map(h=>h.at),end];
  if(ys.some((y,i)=>i&&y-ys[i-1]<size*.85))continue;
  const cells=[];let bad=false;
  for(let row=0;row+1<ys.length;row++)for(let col=0;col+1<xs.length;col++){
   const cell={x:xs[col],y:ys[row],width:xs[col+1]-xs[col],height:ys[row+1]-ys[row]};
   const items=parents.filter(t=>contains(cell,t.rect,.25));
   cells.push({row,col,rowSpan:1,colSpan:1,rect:cell,sourceIds:items.flatMap(t=>t.sourceIds),blocks:paragraphs(items,cell)});
   if(items.length===0&&(closed||row!==0||col!==0))bad=true;
  }
  if(sparse){
   if(cells.some(c=>{
    const own=parents.filter(p=>c.sourceIds.includes(p.id));
    return c.row===0||c.col===0?own.some(p=>!nativeTableRowCandidate(p)):!nativeTableNumericGlyphs(own,src);
   }))continue;
  }
  const ids=cells.flatMap(c=>c.sourceIds);if(bad||ids.length!==parents.length||new Set(ids).size!==ids.length)continue;
  if(functionGlyphs&&cells.filter(c=>functionGlyphs.every(g=>c.sourceIds.includes(g.id))).length!==1)continue;
  tables.push({id:parents[0].id+':partitioned-text-table',type:'table',borderless:true,nativeRowBaseline:true,...(closed?{}:{nativeOpenGrid:true}),rect,rows:ys.length-1,cells,sourceIds:ids,
   nativeRules:[...band,...columns.flat()],horizontalRules:band,columnWidths:xs.slice(1).map((v,i)=>v-xs[i]),rowHeights:ys.slice(1).map((v,i)=>v-ys[i])});
 }
 return tables;
}
