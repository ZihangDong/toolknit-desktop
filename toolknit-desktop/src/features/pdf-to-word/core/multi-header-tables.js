// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { right, bottom, union, contains, median } from './geometry.js';
import { baselineBands } from './reading-order.js';
import { groupLines, lineText, buildParagraphs } from './text.js';
const numeric = value => /^[+−-]?\d[\d.,]*(?:\/\d[\d.,]*)?(?:[%kKmM])?$/u.test(value.trim());
const center = item => item.rect.x + item.rect.width / 2;

function paragraphs(items, rect, baseline = null) {
  if (!items.length) return [];
  const ordered = [...items].sort((a,b) => a.rect.x-b.rect.x || a.order-b.order);
  const lines = baseline === null ? groupLines(items) : [{ id: ordered[0].id+':line',type:'line',items:ordered,
    text:lineText(ordered),rect:union(ordered.map(item=>item.rect)),size:Math.max(...ordered.map(item=>item.size)),
    baseline,sourceIds:ordered.flatMap(item=>item.sourceIds) }];
  return buildParagraphs(lines,rect).map(block=>({...block,align:'left'}));
}

function columnEdges(assignment, centers, rect, size) {
  const xs=[rect.x];
  for(let col=0;col+1<centers.length;col++){
    const left=Math.max(...assignment.filter(value=>value.col===col).map(value=>right(value.item.rect)));
    const next=Math.min(...assignment.filter(value=>value.col===col+1).map(value=>value.item.rect.x));
    if(!Number.isFinite(left+next)||next-left<Math.max(.5,size*.5))return null;
    xs.push((left+next)/2);
  }
  xs.push(right(rect));return xs;
}

function rowEdges(rows, start, end, size, rules) {
  const ys=[start];
  for(let index=0;index+1<rows.length;index++){
    const floor=Math.max(...rows[index].items.map(item=>bottom(item.rect)))+.1;
    const ceiling=Math.min(...rows[index+1].items.map(item=>item.rect.y))-.1;
    if(ceiling<=floor)return null;
    const line=rules.find(rule=>rule.at>=floor&&rule.at<=ceiling);
    const mid=(rows[index].baseline+rows[index+1].baseline)/2-size*.3;
    ys.push(line?.at??Math.max(floor,Math.min(ceiling,mid)));
  }
  ys.push(end);
  return ys.some((y,index)=>index&&y-ys[index-1]<size*1.1)?null:ys;
}

/** Recover a bounded horizontal-rule grid only when repeated numeric columns,
 * lower header ownership and centered group titles independently agree.
 * Missing values or ambiguous spans keep the original non-table path. */
export function multiHeaderGrid(band, parents, tokens, rules, bounds) {
  const top=band[0].at,end=band.at(-1).at;
  let separator=band[1].at;
  const rect={x:band[0].from,y:top,width:band[0].to-band[0].from,height:end-top};
  if(!contains(bounds,rect)||rect.height<20||rect.height>400||tokens.length>4000
    ||rules.some(rule=>rule.axis==='v'&&rule.at>rect.x+1&&rule.at<right(rect)-1&&rule.to>top&&rule.from<end))return null;
  const size=median(tokens.map(item=>item.size));
  let data=baselineBands(tokens.filter(item=>item.rect.y>=separator-.2))
    .map(items=>({items,baseline:median(items.filter(item=>item.size>=size*.85).map(item=>item.baseline))}))
    .filter(row=>row.items.filter(item=>numeric(item.text)).length>=3);
  if(data.length<3||data.length>100)return null;
  separator=band.filter(rule=>rule.at<=Math.min(...data[0].items.map(item=>item.rect.y))-.2).at(-1)?.at??separator;
  data=data.filter(row=>row.items.every(item=>item.rect.y>=separator-.2));
  if(data.length<3||data.length>100)return null;
  const numericRows=data.map(row=>row.items.filter(item=>numeric(item.text)).sort((a,b)=>center(a)-center(b)));
  const count=numericRows[0].length,tolerance=Math.max(1,size*.75);
  if(count<3||count>12||numericRows.some(row=>row.length!==count||row.some((item,index)=>Math.abs(center(item)-center(numericRows[0][index]))>tolerance)))return null;
  const centers=Array.from({length:count},(_,index)=>median(numericRows.map(row=>center(row[index]))));
  const labels=data.map(row=>row.items.filter(item=>right(item.rect)<Math.min(...numericRows.map(row=>row[0].rect.x))-size*.2));
  if(labels.flat().length){
    if(labels.filter(items=>/[\p{L}]{2}/u.test(items.map(item=>item.text).join(''))).length<data.length*.6)return null;
    centers.unshift(median(labels.flat().map(center)));
  }
  if(centers.some((x,index)=>index&&x-centers[index-1]<size*1.3))return null;
  const nearest=item=>centers.reduce((best,at,index)=>Math.abs(center(item)-at)<Math.abs(center(item)-centers[best])?index:best,0);
  const body=[];
  for(const item of tokens.filter(item=>bottom(item.rect)>separator+.2)){
    const row=data.reduce((best,value,index)=>Math.abs(item.baseline-value.baseline)<Math.abs(item.baseline-data[best].baseline)?index:best,0);
    if(Math.abs(item.baseline-data[row].baseline)>Math.max(item.size,size)*.75)return null;
    body.push({item,row,col:nearest(item)});
  }
  const header=baselineBands(tokens.filter(item=>bottom(item.rect)<=separator+.2))
    .map(items=>({items,baseline:median(items.filter(item=>item.size>=size*.85).map(item=>item.baseline))}));
  if(header.length<2||header.length>4||header.reduce((n,row)=>n+row.items.length,0)>256
    ||header.some(row=>!Number.isFinite(row.baseline)))return null;
  const rough=columnEdges(body,centers,rect,size);if(!rough)return null;
  const placed=header.flatMap((row,index)=>row.items.map(item=>({item,row:index,col:nearest(item),rowSpan:1,colSpan:1})));
  const merged=[],grouped=new Set();
  {
    const row=0; // Group titles require an independently proven lower header for every child column.
    const groups=[];
    for(const value of placed.filter(value=>value.row===row).sort((a,b)=>a.item.rect.x-b.item.rect.x)){
      let group=groups.at(-1),previous=group?.at(-1).item;
      if(!previous||value.item.rect.x-right(previous.rect)>size*.4)groups.push(group=[]);
      group.push(value);
    }
    if(groups.length>64)return null;
    for(const group of groups){
      const box=union(group.map(value=>value.item.rect)),xc=box.x+box.width/2;
      const below=new Set(placed.filter(value=>value.row>row).map(value=>value.col));
      const candidates=[];
      for(let first=0;first<centers.length;first++)for(let last=first+2;last<=centers.length;last++){
        if(box.x<rough[first]-.2||right(box)>rough[last]+.2||Math.abs(xc-(rough[first]+rough[last])/2)>size*.35)continue;
        if(Array.from({length:last-first},(_,i)=>first+i).some(col=>!below.has(col)))continue;
        if(placed.some(value=>value.row===row&&!group.includes(value)&&value.col>=first&&value.col<last))continue;
        candidates.push({row,col:first,rowSpan:1,colSpan:last-first});
      }
      const candidate=candidates.sort((a,b)=>b.colSpan-a.colSpan)[0];
      if(!candidate)continue;
      merged.push(candidate);for(const value of group){Object.assign(value,candidate);grouped.add(value);}
    }
  }
  if(!merged.length)return null;
  // An unproven group title must not silently become a single ordinary cell.
  if(placed.some(value=>value.row===0&&!grouped.has(value)
    &&Math.abs(center(value.item)-centers[value.col])>size*.35))return null;
  const xs=columnEdges([...body,...placed.filter(value=>!grouped.has(value))],centers,rect,size);if(!xs)return null;
  for(const merge of merged){
    const group=placed.filter(value=>grouped.has(value)&&value.row===merge.row&&value.col===merge.col),box=union(group.map(value=>value.item.rect));
    if(box.x<xs[merge.col]-.2||right(box)>xs[merge.col+merge.colSpan]+.2
      ||Math.abs(center({rect:box})-(xs[merge.col]+xs[merge.col+merge.colSpan])/2)>size*.35)return null;
  }
  const hy=rowEdges(header,top,separator,size,band),dy=rowEdges(data,separator,end,size,band);if(!hy||!dy)return null;
  for(let col=0;col<centers.length;col++){
    const values=placed.filter(value=>!grouped.has(value)&&value.col===col);
    if(values.length!==1||merged.some(merge=>col>=merge.col&&col<merge.col+merge.colSpan))continue;
    const value=values[0],box=value.item.rect;
    if(Math.abs(box.y+box.height/2-(top+separator)/2)>size*.35)continue;
    const merge={row:0,col,rowSpan:header.length,colSpan:1};Object.assign(value,merge);merged.push(merge);
  }
  const ys=[...hy,...dy.slice(1)],assignments=[...placed,...body.map(value=>({...value,row:value.row+header.length,rowSpan:1,colSpan:1}))];
  const members=new Map();
  for(const value of assignments){
    const key=value.row+':'+value.col;
    if(!members.has(key))members.set(key,[]);
    members.get(key).push(value.item);
  }
  const cells=[];
  for(let row=0;row+1<ys.length;row++)for(let col=0;col+1<xs.length;col++){
    const merge=merged.find(value=>row>=value.row&&row<value.row+value.rowSpan&&col>=value.col&&col<value.col+value.colSpan);
    if(merge&&(merge.row!==row||merge.col!==col))continue;
    const meta=merge||{row,col,rowSpan:1,colSpan:1};
    const cellRect={x:xs[col],y:ys[row],width:xs[col+meta.colSpan]-xs[col],height:ys[row+meta.rowSpan]-ys[row]};
    const items=members.get(row+':'+col)||[];
    if(items.some(item=>!contains(cellRect,item.rect,.2)))return null;
    cells.push({...meta,rect:cellRect,sourceIds:items.flatMap(item=>item.sourceIds),blocks:paragraphs(items,cellRect,row>=header.length?data[row-header.length].baseline:null)});
  }
  const sourceIds=cells.flatMap(cell=>cell.sourceIds);
  if(sourceIds.length!==tokens.flatMap(item=>item.sourceIds).length||new Set(sourceIds).size!==sourceIds.length)return null;
  return {id:parents[0].id+':multi-header-table',type:'table',borderless:true,rect,cells,sourceIds,
    horizontalRules:band,nativeRules:band,rows:ys.length-1,columnWidths:xs.slice(1).map((x,index)=>x-xs[index]),rowHeights:ys.slice(1).map((y,index)=>y-ys[index])};
}
