// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { right, bottom, contains, median, union } from './geometry.js';
import { baselineBands } from './reading-order.js';
import { groupLines, lineText, buildParagraphs } from './text.js';

/** Join only touching collinear fragments. A short header band followed by a
 * long body is allowed here; the sequential index/prose proof is separate. */
export function indexedRuleBands(rules, { headerless = false } = {}) {
  const levels = [];
  for (const rule of rules.filter(r => r.axis === 'h' && [r.at,r.from,r.to].every(Number.isFinite) && r.to > r.from)
    .sort((a,b) => a.at-b.at || a.from-b.from)) {
    let level = levels.at(-1);
    if (!level || rule.at-level[0].at > .65) levels.push(level=[]);
    level.push(rule);
  }
  const joined = [];
  for (const level of levels) {
    const spans = [];
    for (const rule of [...level].sort((a,b) => a.from-b.from)) {
      let span = spans.at(-1);
      if (!span || rule.from-span.to > 1) spans.push(span={ from:rule.from, to:rule.to, members:[] });
      span.to = Math.max(span.to, rule.to); span.members.push(rule);
    }
    for (const span of spans) if (span.to-span.from >= 80) joined.push({ axis:'h', from:span.from, to:span.to,
      // Keep an actual source rule as the grid boundary. The midpoint of a
      // double rule can bisect its visible ink and is not a source boundary.
      at:Math.min(...span.members.map(r=>r.at)), members:span.members });
  }
  const groups = [];
  for (const rule of joined) {
    let group = groups.find(g => Math.abs(g[0].from-rule.from)<=1 && Math.abs(g[0].to-rule.to)<=1);
    if (!group) groups.push(group=[]);
    group.push(rule);
  }
  const result = [];
  for (const group of groups) {
    group.sort((a,b)=>a.at-b.at);
    // An unheaded label table must have exactly two outer rules, never a pair
    // chosen from a larger ruled grid or an omitted header separator.
    if (headerless && group.length !== 2) continue;
    const count = headerless ? 2 : 3;
    for (let i=0;i+count<=group.length && result.length<64;i++) {
      const band=group.slice(i,i+count),header=band[1].at-band[0].at,height=band.at(-1).at-band[0].at;
      if (height<30 || height>(headerless?700:400) || !headerless&&(header<6||header>35)) continue;
      band.nativeRules=band.flatMap(r=>r.members);result.push(band);
    }
  }
  return result;
}

const integer = item => /^[1-9]\d{0,2}$/u.test(item.text.trim());
const plain = text => text.replace(/\s/gu,'');
function cellBlocks(members, rect, baseline = null) {
  if (!members.length) return [];
  const grouped = groupLines(members);
  const lines=(baseline === null ? baselineBands(grouped) : [grouped]).map(band=>{
    const items=band.flatMap(line=>line.items).sort((a,b)=>a.rect.x-b.rect.x||a.order-b.order);
    return {...band[0],items,text:lineText(items),rect:union(items.map(item=>item.rect)),sourceIds:items.flatMap(item=>item.sourceIds),
      baseline:baseline ?? median(band.map(line=>line.baseline)),size:Math.max(...items.map(item=>item.size))};
  });
  return buildParagraphs(lines,rect).map(block=>({...block,align:'left'}));
}

/** A real three-rule table with a named index header, consecutive integer
 * rows, one stable prose column and complete ownership. Ordinary numbered
 * lists, arbitrary two-column prose and partially assigned text are rejected. */
export function indexedHorizontalTable(band, parents, tokens, rules, bounds) {
  const [top,separator,end]=band.map(r=>r.at),rect={x:band[0].from,y:top,width:band[0].to-band[0].from,height:end-top};
  if (!tokens.length || tokens.length>2000 || !contains(bounds,rect)
    || rules.some(r=>r.axis==='v'&&r.at>rect.x+1&&r.at<right(rect)-1&&r.to>top&&r.from<end)) return null;
  const size=median(tokens.map(item=>item.size));
  if (!(size>=4 && size<=40)) return null;
  const header=tokens.filter(item=>bottom(item.rect)<=separator+.2),body=tokens.filter(item=>item.rect.y>=separator-.2);
  if (!header.length || header.length+body.length!==tokens.length || baselineBands(header).length>2) return null;
  const lines=baselineBands(body).sort((a,b)=>median(a.map(i=>i.baseline))-median(b.map(i=>i.baseline)));
  const numbers=body.filter(item=>integer(item)&&item.rect.x<rect.x+rect.width*.25);
  if (numbers.length<3) return null;
  const firstX=Math.min(...numbers.map(item=>item.rect.x)),tolerance=Math.max(1,size*.55);
  const indices=new Set(numbers.filter(item=>Math.abs(item.rect.x-firstX)<=tolerance));
  const starts=[];
  for (const [line,items] of lines.entries()) {
    const index=items.filter(item=>indices.has(item));
    if (index.length>1) return null;
    if (index.length) starts.push({line,item:index[0],baseline:median(items.map(item=>item.baseline))});
  }
  if (starts.length<3 || starts.length>100 || starts[0].line!==0
    || starts.some((row,i)=>Number(row.item.text)!==i+1)) return null;
  const maxIndexRight=Math.max(...starts.map(row=>right(row.item.rect)));
  const rightStarts=starts.map(row=>lines[row.line].filter(item=>item!==row.item&&item.rect.x>=maxIndexRight+size*.5)
    .reduce((min,item)=>Math.min(min,item.rect.x),Infinity));
  const proseX=median(rightStarts);
  if (!Number.isFinite(proseX) || proseX-firstX<size*2 || proseX>rect.x+rect.width*.4
    || rightStarts.some(x=>Math.abs(x-proseX)>size*.75)) return null;
  const leftHeader=header.filter(item=>right(item.rect)<proseX-size*.2),rightHeader=header.filter(item=>!leftHeader.includes(item));
  if (!/^(?:ItemNo\.?|No\.?|Index|序号|编号)$/iu.test(plain(leftHeader.map(i=>i.text).join('')))
    || !/[\p{L}]{2}/u.test(rightHeader.map(i=>i.text).join('')) || rightHeader.some(item=>item.rect.x<proseX-size*.2)) return null;
  const leftEdge=Math.max(maxIndexRight,...leftHeader.map(item=>right(item.rect)));
  const rightEdge=Math.min(...rightHeader.map(item=>item.rect.x),...body.filter(item=>!indices.has(item)).map(item=>item.rect.x));
  if (rightEdge-leftEdge<Math.max(.5,size*.4)) return null;
  const xs=[rect.x,(leftEdge+rightEdge)/2,right(rect)],assigned=[];
  for (const item of header) assigned.push({item,row:0,col:leftHeader.includes(item)?0:1});
  for (const [line,items] of lines.entries()) {
    let row=starts.length-1;
    while (row>0&&line<starts[row].line) row--;
    for (const item of items) {
      if (item===starts[row].item) assigned.push({item,row:row+1,col:0});
      else {
        if (item.rect.x<xs[1]+.1) return null;
        assigned.push({item,row:row+1,col:1});
      }
    }
  }
  if (starts.some((_,i)=>!/[\p{L}]{2}/u.test(assigned.filter(v=>v.row===i+1&&v.col===1).map(v=>v.item.text).join('')))) return null;
  return completeTable({band,parents,tokens,rect,xs,assigned,baselines:starts.map(row=>row.baseline),size,suffix:'indexed-horizontal-table'});
}

function completeTable({ band, parents, tokens, rect, xs, assigned, baselines, size, suffix, allowEmpty = false, singleLineBaselines = null }) {
  const top=band[0].at,end=band.at(-1).at,headerRows=band.length===3?1:0;
  const ys=headerRows?[top,band[1].at]:[top];
  for (let row=1;row<baselines.length;row++) {
    const floor=Math.max(...assigned.filter(v=>v.row===row-1+headerRows).map(v=>bottom(v.item.rect)))+.1;
    const ceiling=Math.min(...assigned.filter(v=>v.row===row+headerRows).map(v=>v.item.rect.y))-.1;
    if (ceiling<=floor) return null;
    ys.push(Math.max(floor,Math.min(ceiling,(baselines[row-1]+baselines[row])/2-size*.3)));
  }
  ys.push(end);
  if (ys.some((y,i)=>i&&y-ys[i-1]<size*.95)) return null;
  const cells=[];
  for (let row=0;row+1<ys.length;row++) for (let col=0;col+1<xs.length;col++) {
    const box={x:xs[col],y:ys[row],width:xs[col+1]-xs[col],height:ys[row+1]-ys[row]},members=assigned.filter(v=>v.row===row&&v.col===col).map(v=>v.item);
    if (!allowEmpty && !members.length || members.some(item=>!contains(box,item.rect,.2))) return null;
    const baseline = singleLineBaselines?.[row];
    const blocks=cellBlocks(members,box,Number.isFinite(baseline) ? baseline : null);
    cells.push({row,col,rowSpan:1,colSpan:1,rect:box,sourceIds:members.flatMap(item=>item.sourceIds),blocks});
  }
  const sourceIds=cells.flatMap(cell=>cell.sourceIds);
  if (sourceIds.length!==tokens.flatMap(item=>item.sourceIds).length||new Set(sourceIds).size!==sourceIds.length) return null;
  return {id:parents[0].id+':'+suffix,type:'table',borderless:true,rect,cells,sourceIds,
    rows:ys.length-1,columnWidths:xs.slice(1).map((x,i)=>x-xs[i]),rowHeights:ys.slice(1).map((y,i)=>y-ys[i]),
    horizontalRules:band.map(({axis,at,from,to})=>({axis,at,from,to})),nativeRules:band.nativeRules};
}

export { completeTable as completeHorizontalTable };

/** Example tables need a repeated original column endpoint on both the top
 * and bottom rules. A textual gutter alone cannot prove their column width.
 * Short independent labels and aligned example starts prove each body row. */
function sourceColumnCut(band, rect) {
  const top=band[0].at,end=band.at(-1).at;
  const ends=[];
  for(const rule of band.nativeRules||[]){
    if(Math.abs(rule.from-rect.x)>1||rule.to<rect.x+20||rule.to>right(rect)-20)continue;
    let group=ends.find(g=>Math.abs(median(g.map(r=>r.to))-rule.to)<=1);
    if(!group)ends.push(group=[]);group.push(rule);
  }
  const repeated=ends.filter(g=>g.some(r=>Math.abs(r.at-top)<=.7)&&g.some(r=>Math.abs(r.at-end)<=.7));
  return repeated.length===1?median(repeated[0].map(r=>r.to)):null;
}

export function exampleHorizontalTable(band, parents, tokens, rules, bounds) {
  const [top,separator,end]=band.map(r=>r.at),rect={x:band[0].from,y:top,width:band[0].to-band[0].from,height:end-top};
  if (!tokens.length || tokens.length>2000 || !contains(bounds,rect)
    || rules.some(r=>r.axis==='v'&&r.at>rect.x+1&&r.at<right(rect)-1&&r.to>top&&r.from<end)) return null;
  const size=median(tokens.map(item=>item.size));if(!(size>=4&&size<=40))return null;
  const cut=sourceColumnCut(band,rect);if(cut===null)return null;
  const xs=[rect.x,cut,right(rect)];
  const header=tokens.filter(item=>bottom(item.rect)<=separator+.2),body=tokens.filter(item=>item.rect.y>=separator-.2);
  if(!header.length||header.length+body.length!==tokens.length||baselineBands(header).length!==1)return null;
  const leftHeader=header.filter(item=>right(item.rect)<cut-.1),rightHeader=header.filter(item=>item.rect.x>cut+.1);
  if(leftHeader.length+rightHeader.length!==header.length||!leftHeader.length
    ||!/[\p{L}]{2}/u.test(leftHeader.map(item=>item.text).join(''))
    ||!/^(?:Examples?|示例|案例|例子|举例)$/iu.test(plain(rightHeader.map(item=>item.text).join(''))))return null;
  const left=body.filter(item=>right(item.rect)<cut-.1),rightItems=body.filter(item=>item.rect.x>cut+.1);
  if(left.length+rightItems.length!==body.length)return null;
  const labels=baselineBands(left).sort((a,b)=>median(a.map(i=>i.baseline))-median(b.map(i=>i.baseline)));
  if(labels.length<3||labels.length>30)return null;
  const starts=labels.map(items=>({items,baseline:median(items.map(item=>item.baseline)),rect:union(items.map(item=>item.rect))}));
  const labelX=median(starts.map(row=>row.rect.x));
  for(const row of starts){
    const value=lineText([...row.items].sort((a,b)=>a.rect.x-b.rect.x));
    if(!/^(?:\p{Lu}|\p{Script=Han})[\p{L}\p{N}\s()-]*$/u.test(value)||row.rect.width>(cut-rect.x)*.8
      ||Math.abs(row.rect.x-labelX)>size*.3||row.items.some(item=>Math.abs(item.baseline-row.baseline)>size*.08))return null;
  }
  const assigned=header.map(item=>({item,row:0,col:leftHeader.includes(item)?0:1}));
  starts.forEach((row,i)=>row.items.forEach(item=>assigned.push({item,row:i+1,col:0})));
  const rightLines=baselineBands(rightItems).sort((a,b)=>median(a.map(i=>i.baseline))-median(b.map(i=>i.baseline)));
  const firstRight=new Map();
  for(const items of rightLines){
    const baseline=median(items.map(item=>item.baseline));let row=starts.length-1;
    while(row>0&&baseline<starts[row].baseline-size*.08)row--;
    if(baseline<starts[row].baseline-size*.08)return null;
    if(!firstRight.has(row))firstRight.set(row,{items,baseline});
    for(const item of items)assigned.push({item,row:row+1,col:1});
  }
  const rightX=[];
  for(const [i,row]of starts.entries()){
    const first=firstRight.get(i);
    if(!first||Math.abs(first.baseline-row.baseline)>size*.08)return null;
    const ordered=[...first.items].sort((a,b)=>a.rect.x-b.rect.x),value=lineText(ordered);
    if(!/^(?:\p{Lu}|\p{Script=Han})/u.test(value))return null;
    rightX.push(ordered[0].rect.x);
  }
  if(rightX.some(x=>Math.abs(x-median(rightX))>size*.3))return null;
  return completeTable({band,parents,tokens,rect,xs,assigned,baselines:starts.map(row=>row.baseline),size,suffix:'example-horizontal-table'});
}

/** Two original outer rules and a repeated real column endpoint support this
 * narrow label/description table. Bold title-case labels prove row starts;
 * a lowercase wrapped label continues its row rather than inventing a new one.
 */
export function labelledHorizontalTable(band, parents, tokens, rules, bounds) {
  if (band.length!==2) return null;
  const top=band[0].at,end=band[1].at,rect={x:band[0].from,y:top,width:band[0].to-band[0].from,height:end-top};
  if (!tokens.length||tokens.length>2000||!contains(bounds,rect)
    ||rules.some(r=>r.axis==='v'&&r.at>rect.x+1&&r.at<right(rect)-1&&r.to>top&&r.from<end))return null;
  const size=median(tokens.map(item=>item.size)),cut=sourceColumnCut(band,rect);
  if (!(size>=4&&size<=40)||cut===null)return null;
  const left=tokens.filter(item=>right(item.rect)<cut-.1),rightItems=tokens.filter(item=>item.rect.x>cut+.1);
  if(left.length+rightItems.length!==tokens.length||!left.length||!rightItems.length
    ||left.some(item=>!item.bold||item.italic)||rightItems.some(item=>item.bold))return null;
  const labelLines=baselineBands(left).sort((a,b)=>median(a.map(i=>i.baseline))-median(b.map(i=>i.baseline)));
  const starts=[];
  for (const items of labelLines) {
    const ordered=[...items].sort((a,b)=>a.rect.x-b.rect.x),value=lineText(ordered),baseline=median(items.map(item=>item.baseline));
    if(!/^[A-Za-z][A-Za-z\s-]*$/u.test(value)||value.length>80)return null;
    if(/^[A-Z]/.test(value))starts.push({items:[...items],baseline});
    else {
      const previous=starts.at(-1);
      if(!previous||baseline-median(previous.items.map(item=>item.baseline))>size*1.5)return null;
      previous.items.push(...items);
    }
  }
  if(starts.length<4||starts.length>40)return null;
  const labelX=median(starts.map(row=>Math.min(...row.items.map(item=>item.rect.x))));
  if(labelLines.some(items=>Math.abs(Math.min(...items.map(item=>item.rect.x))-labelX)>size*.3)
    ||starts.some(row=>row.items.some(item=>right(item.rect)-rect.x>(cut-rect.x)*.94)))return null;
  const assigned=starts.flatMap((row,i)=>row.items.map(item=>({item,row:i,col:0}))),firstRight=new Map();
  const bodyLines=baselineBands(rightItems).sort((a,b)=>median(a.map(i=>i.baseline))-median(b.map(i=>i.baseline)));
  for(const items of bodyLines){
    const baseline=median(items.map(item=>item.baseline));let row=starts.length-1;
    while(row>0&&baseline<starts[row].baseline-size*.08)row--;
    if(baseline<starts[row].baseline-size*.08)return null;
    if(!firstRight.has(row))firstRight.set(row,{items,baseline});
    for(const item of items)assigned.push({item,row,col:1});
  }
  const rightX=[];
  for(const [i,row]of starts.entries()){
    const first=firstRight.get(i);
    if(!first||Math.abs(first.baseline-row.baseline)>size*.08)return null;
    const ordered=[...first.items].sort((a,b)=>a.rect.x-b.rect.x),value=lineText(ordered);
    if(!/^[A-Z]/.test(value))return null;
    rightX.push(ordered[0].rect.x);
  }
  if(rightX.some(x=>Math.abs(x-median(rightX))>size*.3))return null;
  return completeTable({band,parents,tokens,rect,xs:[rect.x,cut,right(rect)],assigned,
    baselines:starts.map(row=>row.baseline),size,suffix:'labelled-horizontal-table'});
}
