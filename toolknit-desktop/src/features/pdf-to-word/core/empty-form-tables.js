// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import{contains,overlaps,right,bottom}from './geometry.js';
import{tableOwnsStroke,ruledTableGrids}from './tables.js';
const close=(a,b)=>Math.abs(a-b)<.6;
/** Repeated paired row sides may have short cosmetic gaps at their corners.
 * This does not relax the general closed-grid detector. */
function blankGrids(rules){
 const vs=rules.filter(r=>r.axis==='v'&&r.to-r.from>=8&&r.to-r.from<=80),hs=rules.filter(r=>r.axis==='h');
 if(vs.length>512)return[];
 const cells=[];let probes=0;
 for(const a of vs)for(const b of vs){
  if(b.at-a.at<40||b.at-a.at>600||!close(a.from,b.from)||!close(a.to,b.to))continue;
  if(++probes>4096||cells.length>=256)return[];
  const horizontal=(r,y)=>Math.abs(r.at-y)<=1&&r.from>=a.at-.6&&r.from<=a.at+6&&Math.abs(r.to-b.at)<.6&&r.to-r.from>=(b.at-a.at)*.94;
  const top=hs.filter(r=>horizontal(r,Math.min(a.from,b.from))).sort((x,y)=>Math.abs(x.at-a.from)-Math.abs(y.at-a.from))[0];
  const end=hs.filter(r=>horizontal(r,Math.max(a.to,b.to))).sort((x,y)=>Math.abs(x.at-a.to)-Math.abs(y.at-a.to))[0];
  if(!top||!end||end.at-top.at<8||cells.some(c=>close(c.x,a.at)&&close(c.y,top.at)&&close(right(c),b.at)&&close(bottom(c),end.at)))continue;
  cells.push({x:a.at,y:top.at,width:b.at-a.at,height:end.at-top.at});
 }
 const groups=[];
 for(const cell of cells.sort((a,b)=>a.x-b.x||a.y-b.y)){
  let g=groups.find(g=>close(g[0].x,cell.x)&&close(g[0].width,cell.width)&&close(bottom(g.at(-1)),cell.y));
  if(!g)groups.push(g=[]);g.push(cell);
 }
 return groups.filter(g=>g.length>=2&&g.length<=24).map(group=>({rect:{x:group[0].x,y:group[0].y,width:group[0].width,height:bottom(group.at(-1))-group[0].y},rows:group.length,columnWidths:[group[0].width],rowHeights:group.map(c=>c.height),cells:group.map((rect,row)=>({row,col:0,rowSpan:1,colSpan:1,rect,blocks:[],sourceIds:[]}))}));
}
/** Add only blank, labelled, single-column form grids over a trusted text-free
 * rectangular backdrop. No new raster asset or source-text ownership is created. */
export function emptyFormTables({number,items,text,rules,graphics,bounds,tableFallbackIds=[],tableGrids}){
 const labelled=text.filter(t=>t.bold&&!t.raster&&t.preciseInk&&t.size>=4&&t.size<=16
  &&/^[A-Z\p{Script=Han}][A-Z\p{Script=Han}\s/%-]{1,60}$/u.test(t.text.trim())&&!/(?:math|symbol|cmmi|cmsy|cmex)/i.test(t.font||''));
 if(labelled.length<2||rules.length>3000||graphics.length>20000)return{items,count:0};
 const candidates=[...(tableGrids||ruledTableGrids(rules)),...blankGrids(rules)].filter(g=>g.rows>=2&&g.rows<=24&&g.columnWidths.length===1&&g.cells.length===g.rows&&g.cells.every(c=>c.colSpan===1&&c.rowSpan===1&&c.rect.width>=40&&c.rect.width<=600&&c.rect.height>=14&&c.rect.height<=80));
 if(candidates.length>128)return{items,count:0};
 const grids=[];for(const g of candidates.sort((a,b)=>b.cells.length-a.cells.length)){if(!grids.some(other=>overlaps(g.rect,other.rect,0)))grids.push(g);}
 const forms=[],backdrops=new Set();let cells=0;
 for(const [i,grid]of grids.entries()){
  const id=`p${number}:empty-form:${i}`;
  if(tableFallbackIds.includes(id)||cells+grid.cells.length>256||forms.length>=16||!contains(bounds,grid.rect)
   ||text.some(t=>overlaps(grid.rect,t.rect,0))||items.some(t=>t.type==='table'&&overlaps(grid.rect,t.rect,0))
   ||forms.some(t=>overlaps(grid.rect,t.rect,0)))continue;
  const labels=grid.cells.filter(c=>labelled.some(t=>t.baseline>c.rect.y&&t.baseline<bottom(c.rect)
   &&c.rect.x-right(t.rect)>=1&&c.rect.x-right(t.rect)<=t.size*1.5));
  if(labels.length<2||labels.length<grid.rows*.6)continue;
  const images=items.filter(t=>t.type==='image'&&overlaps(grid.rect,t.rect,0));
  if(images.length!==1||images[0].sourceIds.length||!contains(images[0].rect,grid.rect,.6)
   ||!contains({...grid.rect,x:grid.rect.x-1,y:grid.rect.y-1,width:grid.rect.width+2,height:grid.rect.height+2},images[0].rect))continue;
  const drawingIds=new Set(images[0].drawingIds||[]),paint=graphics.filter(g=>drawingIds.has(g.id));
  // A chart bar or partial coloured patch is not an empty cell background.
  const fills=paint.filter(g=>(g.fillRect||g.strokedFillRect)&&!g.thin&&g.opaque===true&&grid.cells.some(c=>contains(c.rect,g.rect,.6)&&g.rect.width*g.rect.height>=c.rect.width*c.rect.height*.9));
  if(!paint.length||paint.length!==drawingIds.size||paint.some(g=>!g.decoration||g.opaque!==true
   ||!tableOwnsStroke(g,grid)&&!((g.fillRect||g.strokedFillRect)&&grid.cells.some(c=>contains(c.rect,g.rect,.6)
    &&fills.some(fill=>fill.fillColor===g.fillColor&&contains(c.rect,fill.rect,.6))))))continue;
  cells+=grid.cells.length;backdrops.add(images[0].id);forms.push({...grid,id,type:'table',borderless:true,emptyForm:true,sourceIds:[],cells:grid.cells.map(c=>({...c,blocks:[],sourceIds:[]}))});
 }
 return{items:[...items.map(item=>backdrops.has(item.id)?{...item,formTableBackdrop:true}:item),...forms],count:forms.length};
}
