// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { right, bottom, union, contains, median } from './geometry.js';
import { baselineBands } from './reading-order.js';
import { lineText, buildParagraphs } from './text.js';
const numeric = value => /^[+−-]?\d[\d.,]*(?:\/\d[\d.,]*)?(?:[%kKmM])?$/u.test(value.trim());
const dash = value => /^[-−–—]$/u.test(value.trim());
const center = item => item.rect.x + item.rect.width / 2;
function paragraphs(items, rect, baseline) {
 if(!items.length)return [];
 const ordered=[...items].sort((a,b)=>a.rect.x-b.rect.x||a.order-b.order);
 return buildParagraphs([{id:ordered[0].id+':line',type:'line',items:ordered,text:lineText(ordered),rect:union(ordered.map(item=>item.rect)),baseline,size:Math.max(...items.map(item=>item.size)),sourceIds:items.flatMap(item=>item.sourceIds)}],rect).map(block=>({...block,align:'left'}));
}
/** Two or more independently repeated numeric columns, explicit dash values
 * and complete cell occupancy prove a sparse grid without shifting values.
 * Prose-only group rows and ambiguous/missing values retain the original path. */
export function sparseHorizontalTable(band,parents,tokens,rules,bounds){
 const top=band[0].at,separator=band[1].at,end=band.at(-1).at;
 const rect={x:band[0].from,y:top,width:band[0].to-band[0].from,height:end-top};
 if(!contains(bounds,rect)||rect.height<30||rect.height>400||tokens.length>2000||!tokens.length
   ||rules.some(rule=>rule.axis==='v'&&rule.at>rect.x+1&&rule.at<right(rect)-1&&rule.to>top&&rule.from<end))return null;
 const size=median(tokens.map(item=>item.size)),tolerance=Math.max(1,size*.75);
 const header=tokens.filter(item=>bottom(item.rect)<=separator+.2);
 if(!header.length||baselineBands(header).length!==1)return null;
 const values=tokens.filter(item=>item.rect.y>=separator-.2&&numeric(item.text)&&item.rect.x>rect.x+rect.width*.4);
 const byPosition=[];
 for(const item of values.sort((a,b)=>center(a)-center(b))){
  let cluster=byPosition.at(-1);
  if(!cluster||center(item)-median(cluster.map(center))>tolerance)byPosition.push(cluster=[]);
  cluster.push(item);
 }
 if(byPosition.length<2||byPosition.length>12||byPosition.some(cluster=>baselineBands(cluster).length<2))return null;
 const centers=byPosition.map(cluster=>median(cluster.map(center)));
 if(centers.some((at,i)=>i&&at-centers[i-1]<size*1.5))return null;
 const data=baselineBands(values).map(items=>({items,baseline:median(items.map(item=>item.baseline))}));
 if(data.length<3||data.length>100)return null;
 const nearest=item=>centers.reduce((best,at,i)=>Math.abs(center(item)-at)<Math.abs(center(item)-centers[best])?i:best,0);
 const all=[];
 for(const item of tokens.filter(item=>bottom(item.rect)>separator+.2)){
  const row=data.reduce((best,value,i)=>Math.abs(item.baseline-value.baseline)<Math.abs(item.baseline-data[best].baseline)?i:best,0);
  if(Math.abs(item.baseline-data[row].baseline)>Math.max(item.size,size)*.75)return null;
  const col=nearest(item);
  if((numeric(item.text)||dash(item.text))&&Math.abs(center(item)-centers[col])<=tolerance)all.push({item,row:row+1,col:col+1});
  else if(right(item.rect)<Math.min(...values.map(value=>value.rect.x))-size*.15)all.push({item,row:row+1,col:0});
  else return null;
 }
 if(data.some((row,i)=>!all.some(v=>v.row===i+1&&v.col===0&&/\p{L}/u.test(v.item.text))))return null;
 for(let row=1;row<=data.length;row++)for(let col=1;col<=centers.length;col++){
  if(all.filter(v=>v.row===row&&v.col===col).length!==1)return null;
 }
 const labels=all.filter(v=>v.col===0).map(v=>v.item);
 centers.unshift(median(labels.map(center)));
 for(const item of header){
  const col=centers.reduce((best,at,i)=>Math.abs(center(item)-at)<Math.abs(center(item)-centers[best])?i:best,0);
  all.push({item,row:0,col});
 }
 if(centers.some((x,i)=>i&&x-centers[i-1]<size*1.5))return null;
 const xs=[rect.x];
 for(let col=0;col+1<centers.length;col++){
  const left=Math.max(...all.filter(v=>v.col===col).map(v=>right(v.item.rect)));
  const next=Math.min(...all.filter(v=>v.col===col+1).map(v=>v.item.rect.x));
  if(!Number.isFinite(left+next)||next-left<Math.max(.5,size*.45))return null;
  xs.push((left+next)/2);
 }
 xs.push(right(rect));
 const ys=[top,separator];
 for(let i=0;i+1<data.length;i++){
  const floor=Math.max(...all.filter(v=>v.row===i+1).map(v=>bottom(v.item.rect)))+.1;
  const ceiling=Math.min(...all.filter(v=>v.row===i+2).map(v=>v.item.rect.y))-.1;
  if(ceiling<=floor)return null;
  const rule=band.find(rule=>rule.at>=floor&&rule.at<=ceiling);
  // Move only an unruled whitespace boundary when a real raised glyph needs
  // the space. Both adjacent cells still pass the measured Writer preflight.
  const raised=all.some(v=>v.row===i+2&&v.item.size<size*.8&&v.item.baseline<data[i+1].baseline-size*.25);
  ys.push(rule?.at??(raised?floor:Math.max(floor,Math.min(ceiling,(data[i].baseline+data[i+1].baseline)/2-size*.3))));
 }
 ys.push(end);
 if(ys.some((y,i)=>i&&y-ys[i-1]<size*1.1))return null;
 const membersByCell=new Map();
 for(const value of all){
  const key=value.row+':'+value.col;
  if(!membersByCell.has(key))membersByCell.set(key,[]);
  membersByCell.get(key).push(value.item);
 }
 const cells=[];
 for(let row=0;row+1<ys.length;row++)for(let col=0;col+1<xs.length;col++){
  const box={x:xs[col],y:ys[row],width:xs[col+1]-xs[col],height:ys[row+1]-ys[row]};
  const members=membersByCell.get(row+':'+col)||[];
  if(members.some(item=>!contains(box,item.rect,.2)))return null;
  cells.push({row,col,rowSpan:1,colSpan:1,rect:box,sourceIds:members.flatMap(item=>item.sourceIds),blocks:paragraphs(members,box,row?data[row-1].baseline:median(header.map(item=>item.baseline)))});
 }
 const sourceIds=cells.flatMap(cell=>cell.sourceIds);
 if(sourceIds.length!==tokens.flatMap(item=>item.sourceIds).length||new Set(sourceIds).size!==sourceIds.length)return null;
 return{id:parents[0].id+':sparse-horizontal-table',type:'table',borderless:true,rect,cells,sourceIds,horizontalRules:band,nativeRules:band,rows:ys.length-1,columnWidths:xs.slice(1).map((x,i)=>x-xs[i]),rowHeights:ys.slice(1).map((y,i)=>y-ys[i])};
}
