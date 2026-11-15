// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import {contains,spatialIndex,union,median,validRect} from './geometry.js';
import {LIMITS} from './input.js';

/** A detector row can span several cells. Partition only calibrated word ink
 * with unique ownership in one complete grid; never guess boundaries from gaps.
 * OCR ranges refer to the corrected parent row, not native PDF operations.
 */
export function splitOcrTableCells(text,grids,{maxExtra=LIMITS.itemsPerPage-text.length}={}){
  if(!Number.isSafeInteger(maxExtra)||maxExtra<0||!Array.isArray(grids)||grids.length>1000
    ||grids.reduce((sum,g)=>sum+(g?.cells?.length||0),0)>LIMITS.itemsPerPage)
    return {text,sources:[]};
  maxExtra=Math.min(maxExtra,LIMITS.itemsPerPage-text.length);
  const gridAt=spatialIndex(grids.filter(g=>g?.rows>=1&&g.columnWidths?.length>=2&&g.cells?.length>=2));
  const cellsAt=new Map(),sources=[],output=[],ids=new Set(text.map(item=>item.id));let growth=0;
  for(const item of text){
    if(!item.ocr||item.ocrNative||item.sourceIds?.length!==1||item.sourceIds[0]!==item.id||!Array.isArray(item.words)||item.words.length<2||item.words.length>200
      ||typeof item.text!=='string'||item.text.length>8000||!validRect(item.rect)){
      output.push(item);continue;
    }
    const owners=gridAt(item.rect).filter(grid=>contains(grid.rect,item.rect,.5));
    if(owners.length!==1){output.push(item);continue;}
    const grid=owners[0];
    if(!cellsAt.has(grid))cellsAt.set(grid,spatialIndex(grid.cells));
    const cellAt=cellsAt.get(grid),groups=[],visited=new Set(),starts=[];let cursor=0,valid=true;
    for(const [i,word]of item.words.entries()){
      if(!word?.preciseInk||!validRect(word.rect)||word.rect.width<=0||word.rect.height<=0||typeof word.text!=='string'||!word.text.trim()
        ||!Number.isFinite(word.baseline)){valid=false;break;}
      while(cursor<item.text.length&&/\s/u.test(item.text[cursor]))cursor++;
      if(item.text.slice(cursor,cursor+word.text.length)!==word.text){valid=false;break;}
      starts.push(cursor);cursor+=word.text.length;
      const cells=cellAt(word.rect).filter(cell=>contains(cell.rect,word.rect,.5));
      if(cells.length!==1){valid=false;break;}
      const cell=cells[0];
      if(groups.at(-1)?.cell!==cell){
        if(visited.has(cell)){valid=false;break;}
        visited.add(cell);groups.push({cell,first:i,words:[]});
      }
      groups.at(-1).words.push(word);
    }
    if(!valid||item.text.slice(cursor).trim()||groups.length<2||growth+groups.length-1>maxExtra){output.push(item);continue;}
    const nextIds=groups.map((_,i)=>`${item.id}:cell${i}`);
    if(nextIds.some(id=>ids.has(id))){output.push(item);continue;}
    growth+=groups.length-1;nextIds.forEach(id=>ids.add(id));
    for(const [i,group]of groups.entries()){
      const start=i?starts[group.first]:0,end=i+1<groups.length?starts[groups[i+1].first]:item.text.length;
      const rect=union(group.words.map(word=>word.rect)),id=nextIds[i];
      const part={...item,id,text:item.text.slice(start,end),sourceIds:[id],rect,advanceRect:{...rect},advanceWidth:rect.width,
        baseline:median(group.words.map(word=>word.baseline)),baselineX:group.words[0].baselineX??rect.x,words:group.words,
        ocrParentId:item.id,ocrTextRange:[start,end]};
      // Raw CTC corrections keep parent-relative indices and are stored once.
      if(i){delete part.ocrOriginalText;delete part.ocrCorrections;delete part.ocrRuleTokens;}
      else if(item.ocrOriginalText)part.ocrParentText=item.text;
      output.push(part);
      sources.push({id,text:part.text,rect,order:item.order,disposition:'editable',ocrParentId:item.id,ocrTextRange:[start,end]});
    }
  }
  return {text:output,sources};
}
