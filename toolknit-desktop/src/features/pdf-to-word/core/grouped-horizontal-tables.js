// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
// Recover source-proven grouped headers and sparse sections; ambiguous grids
// retain their existing non-table path. No document-specific text or geometry.
import { right,bottom,union,contains,median } from './geometry.js';
import { baselineBands } from './reading-order.js';
import { groupLines,lineText,buildParagraphs } from './text.js';
const numeric=s=>/^[+−-]?\d[\d.,]*(?:\/\d[\d.,]*)?(?:[%kKmM])?$/u.test(s.trim());
const dash=s=>/^[-−–—]$/u.test(s.trim());
const center=t=>t.rect.x+t.rect.width/2;
function paragraphs(items,rect,baseline){
 if(!items.length)return [];
 const ordered=[...items].sort((a,b)=>a.rect.x-b.rect.x||a.order-b.order);
 return buildParagraphs([{id:ordered[0].id+':line',type:'line',items:ordered,text:lineText(ordered),rect:union(ordered.map(t=>t.rect)),size:Math.max(...ordered.map(t=>t.size)),baseline,sourceIds:ordered.flatMap(t=>t.sourceIds)}],rect).map(p=>({...p,align:'left'}));
}
export function groupedHeaderBands(rules){
 if(rules.length>1500)return [];
 const horizontal=rules.filter(r=>r.axis==='h'&&r.to-r.from>=8),out=[];
 const outer=horizontal.filter(r=>r.to-r.from>=80);
 if(horizontal.length*outer.length>250000)return [];
 for(const top of outer){
  const matching=horizontal.filter(r=>r.at>top.at+20&&r.at<top.at+400&&Math.abs(r.from-top.from)<=1&&Math.abs(r.to-top.to)<=1).sort((a,b)=>a.at-b.at);
  if(!matching.length)continue;
  // Only fill a missing header-rule band between two full outer boundaries.
  const end=matching[0];
  const inner=horizontal.filter(r=>r.at>top.at+.5&&r.at<end.at-.5&&r.from>=top.from-.2&&r.to<=top.to+.2);
  if(inner.length<2||inner.length>16||inner.some(r=>Math.abs(r.from-top.from)<=1&&Math.abs(r.to-top.to)<=1))continue;
  const levels=[...new Set(inner.map(r=>Math.round(r.at*10)/10))];
  if(levels.length<1||levels.length>3)continue;
  out.push([top,...inner.sort((a,b)=>a.at-b.at),end]);
 }
 return out;
}
export function groupedHorizontalGrid(band,parents,tokens,rules,bounds){
 const top=band[0],end=band.at(-1),rect={x:top.from,y:top.at,width:top.to-top.from,height:end.at-top.at};
 if(!contains(bounds,rect)||rect.height<30||rect.height>400||tokens.length<12||tokens.length>2000
  ||Math.abs(end.from-top.from)>1||Math.abs(end.to-top.to)>1
  ||rules.some(r=>r.axis==='v'&&r.at>rect.x+1&&r.at<right(rect)-1&&r.to>rect.y&&r.from<bottom(rect)))return null;
 const size=median(tokens.map(t=>t.size)),tolerance=Math.max(1,size*.65);
 const physical=baselineBands(tokens).map(items=>({items,baseline:median(items.filter(t=>t.size>=size*.85).map(t=>t.baseline))}));
 if(physical.length<4||physical.length>100||physical.some(row=>!Number.isFinite(row.baseline)))return null;
 const clusters=[];
 const inlineNumber=item=>numeric(item.text)&&tokens.some(t=>t!==item&&/^[),.;]/u.test(t.text)
  &&Math.abs(t.baseline-item.baseline)<size*.2&&t.rect.x>=right(item.rect)-.2&&t.rect.x-right(item.rect)<size*.4);
 for(const item of tokens.filter(t=>(numeric(t.text)||dash(t.text))&&!inlineNumber(t)).sort((a,b)=>center(a)-center(b))){
  let c=clusters.at(-1);
  if(!c||center(item)-median(c.map(center))>tolerance)clusters.push(c=[]);
  c.push(item);
 }
 const repeated=clusters.filter(c=>baselineBands(c).length>=3);
 if(repeated.length<2||repeated.length>12)return null;
 const centers=repeated.map(c=>median(c.map(center)));
 if(centers.some((x,i)=>i&&x-centers[i-1]<size*1.3))return null;
 const nearest=item=>centers.reduce((best,x,i)=>Math.abs(center(item)-x)<Math.abs(center(item)-centers[best])?i:best,0);
 const isValue=item=>(numeric(item.text)||dash(item.text))&&Math.abs(center(item)-centers[nearest(item)])<=tolerance;
 const data=physical.filter(row=>row.items.filter(isValue).length>=2);
 if(data.length<3)return null;
 const firstY=Math.min(...data[0].items.map(t=>t.rect.y));
 const separators=band.filter(r=>r.at<=firstY-.2&&r.at>top.at+.5);
 const separator=Math.max(...separators.map(r=>r.at));
 if(!Number.isFinite(separator))return null;
 const header=physical.filter(row=>row.items.every(t=>bottom(t.rect)<=separator+.2));
 const body=physical.filter(row=>row.items.every(t=>t.rect.y>=separator-.2));
 if(header.length<1||header.length>4||header.length+body.length!==physical.length||!body.length)return null;
 if(header.some(row=>[...row.items].sort((a,b)=>a.rect.x-b.rect.x)
  .some((t,i,a)=>i&&t.rect.x<right(a[i-1].rect)-.2)))return null;
 const values=body.flatMap(row=>row.items.filter(isValue));
 const firstNumericX=Math.min(...values.map(t=>t.rect.x));
 const label=body.flatMap(row=>row.items.filter(t=>!isValue(t)&&right(t.rect)<firstNumericX-size*.15));
 const hasLabel=label.length>0,labelSet=new Set(label);
 if(hasLabel&&body.filter(row=>row.items.some(isValue)&&row.items.some(t=>labelSet.has(t))).length<data.length*.6)return null;
 const assigned=[],sections=[];
 for(let row=0;row<body.length;row++){
  const items=body[row].items,number=items.filter(isValue);
  if(number.length){
   for(const t of items){
    if(isValue(t))assigned.push({item:t,row:row+header.length,col:nearest(t)+(hasLabel?1:0),rowSpan:1,colSpan:1});
    else if(hasLabel&&labelSet.has(t))assigned.push({item:t,row:row+header.length,col:0,rowSpan:1,colSpan:1});
    else return null;
   }
   for(let col=0;col<centers.length;col++)if(number.filter(t=>nearest(t)===col).length>1)return null;
  }else{
   const box=union(items.map(t=>t.rect));
   if(items.some(t=>numeric(t.text)||dash(t.text)))return null;
   if(Math.abs(center({rect:box})-(rect.x+rect.width/2))<=size*.4){
    sections.push({row:row+header.length,col:0,rowSpan:1,colSpan:centers.length+(hasLabel?1:0),items});
   }else if(hasLabel&&items.every(t=>right(t.rect)<firstNumericX-size*.15)){
    assigned.push(...items.map(item=>({item,row:row+header.length,col:0,rowSpan:1,colSpan:1})));
    sections.push({labelOnly:true,row:row+header.length});
   }else return null;
  }
 }
 const count=centers.length+(hasLabel?1:0),xs=[rect.x];
 for(let col=0;col+1<count;col++){
  const left=Math.max(...assigned.filter(v=>v.col===col).map(v=>right(v.item.rect)));
  const next=Math.min(...assigned.filter(v=>v.col===col+1).map(v=>v.item.rect.x));
  if(!Number.isFinite(left+next)||next-left<Math.max(.5,size*.35))return null;
  xs.push((left+next)/2);
 }xs.push(right(rect));
 const headerGroups=header.map(row=>{
  const groups=[];
  for(const item of [...row.items].sort((a,b)=>a.rect.x-b.rect.x)){
   let g=groups.at(-1),p=g?.at(-1);
   if(!p||item.rect.x-right(p.rect)>size*.45)groups.push(g=[]);
   g.push(item);
  }return groups;
 });
 // Leaf header text can extend into whitespace beyond the body-derived
 // midpoint. Include its complete ink before proving any spanning title.
 const edgeMembers=assigned.slice();
 for(const groups of headerGroups)for(const items of groups){
  const box=union(items.map(t=>t.rect)),col=nearest({rect:box})+(hasLabel?1:0);
  if(Math.abs(center({rect:box})-centers[col-(hasLabel?1:0)])>size*.5
   ||box.x<xs[col]-size*.5||right(box)>xs[col+1]+size*.5)continue;
  edgeMembers.push(...items.map(item=>({item,col})));
 }
 const refined=[rect.x];
 for(let col=0;col+1<count;col++){
  const left=Math.max(...edgeMembers.filter(v=>v.col===col).map(v=>right(v.item.rect)));
  const next=Math.min(...edgeMembers.filter(v=>v.col===col+1).map(v=>v.item.rect.x));
  if(next-left<Math.max(.5,size*.35))return null;
  refined.push((left+next)/2);
 }refined.push(right(rect));xs.splice(0,xs.length,...refined);
 const headerAssignments=[];let merges=0;
 for(let row=header.length-1;row>=0;row--){
  const groups=headerGroups[row];
  const taken=new Set();
  for(const items of groups){
   const box=union(items.map(t=>t.rect)),choices=[];
   for(let first=0;first<count;first++)for(let last=first+1;last<=count;last++){
    if(box.x<xs[first]-.2||right(box)>xs[last]+.2)continue;
    if(last-first>1){
     if(Math.abs(center({rect:box})-(xs[first]+xs[last])/2)>size*.4)continue;
     if(Array.from({length:last-first},(_,i)=>first+i).some(col=>!headerAssignments.some(v=>v.row>row&&col>=v.col&&col<v.col+v.colSpan)))continue;
    }
    if(Array.from({length:last-first},(_,i)=>first+i).some(col=>taken.has(col)))continue;
    choices.push({row,col:first,rowSpan:1,colSpan:last-first,items});
   }
   choices.sort((a,b)=>b.colSpan-a.colSpan);
   if(!choices.length)return null;
   const choice=choices[0];
   if(choice.colSpan>1)merges++;
   for(let col=choice.col;col<choice.col+choice.colSpan;col++)taken.add(col);
   headerAssignments.push(choice);
  }
 }
 // Ordinary multi-row headers keep the established parser and rejection
 // policy. This path adds section rows or proven partial header rules.
 const partialHeader=band.some(r=>r.at>top.at+.5&&r.at<=separator+.2
  &&(r.from>rect.x+1||r.to<right(rect)-1));
 if(!sections.length&&!(merges&&partialHeader))return null;
 const rows=[...header,...body],ys=[top.at];
 for(let i=0;i+1<rows.length;i++){
  const floor=Math.max(...rows[i].items.map(t=>bottom(t.rect)))+.1;
  const ceiling=Math.min(...rows[i+1].items.map(t=>t.rect.y))-.1;
  if(ceiling<=floor)return null;
  const line=band.find(r=>r.at>=floor&&r.at<=ceiling);
  ys.push(line?.at??Math.max(floor,Math.min(ceiling,(rows[i].baseline+rows[i+1].baseline)/2-size*.3)));
 }ys.push(end.at);
 if(ys.some((y,i)=>i&&y-ys[i-1]<size*1.1))return null;
 const spans=[...headerAssignments,...sections.filter(s=>!s.labelOnly)];
 const members=new Map();
 for(const v of assigned){const k=v.row+':'+v.col;if(!members.has(k))members.set(k,[]);members.get(k).push(v.item);}
 for(const v of spans)members.set(v.row+':'+v.col,v.items);
 const cells=[];
 for(let row=0;row<rows.length;row++)for(let col=0;col<count;col++){
  const span=spans.find(v=>v.row===row&&col>=v.col&&col<v.col+v.colSpan);
  if(span&&span.col!==col)continue;
  const meta=span?{row,col,rowSpan:1,colSpan:span.colSpan}:{row,col,rowSpan:1,colSpan:1};
  const box={x:xs[col],y:ys[row],width:xs[col+meta.colSpan]-xs[col],height:ys[row+1]-ys[row]};
  const items=members.get(row+':'+col)||[];
  if(items.some(t=>!contains(box,t.rect,.2)))return null;
  cells.push({...meta,rect:box,sourceIds:items.flatMap(t=>t.sourceIds),blocks:paragraphs(items,box,rows[row].baseline)});
 }
 const ids=cells.flatMap(c=>c.sourceIds),expected=tokens.flatMap(t=>t.sourceIds);
 const owned=new Set(ids);
 if(ids.length!==expected.length||owned.size!==ids.length||expected.some(id=>!owned.has(id)))return null;
 return{id:parents[0].id+':grouped-horizontal-table',type:'table',borderless:true,rect,cells,sourceIds:ids,rows:rows.length,
  columnWidths:xs.slice(1).map((x,i)=>x-xs[i]),rowHeights:ys.slice(1).map((y,i)=>y-ys[i]),horizontalRules:band,nativeRules:band};
}
