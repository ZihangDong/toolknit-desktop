// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { groupLines } from './text.js';
import { right } from './geometry.js';
/** Restore only a source-split, space-terminated capitalized prose word next
 * to matching italic prose. Symbol fonts, scripts and isolated variables are
 * deliberately outside this lexical boundary check. */
export function proseFragments(text){
 const proven=new Set();
 const safe=item=>item.italic&&item.preciseInk&&!item.raster&&!item.alphabet&&!item.mathStyleUncertain
  &&typeof item.font==='string'&&!/(?:math|symbol|cmmi|cmsy|cmex|msam|msbm|mtmi|mtsy)/i.test(item.font);
 const same=(a,b)=>safe(a)&&safe(b)&&a.font===b.font&&a.bold===b.bold&&a.color===b.color
  &&Math.abs(a.size-b.size)<.01&&Math.abs(a.baseline-b.baseline)<.1;
 for(const line of groupLines(text)){
  let word=[];
  const finish=next=>{
   const previous=word.at(-1),combined=word.map(item=>item.text).join('').trim();
   if(word.length>1&&/^[A-Z][a-z]{2,}$/u.test(combined)&&word.some(item=>item.text.trim().length>=2)
    &&previous&&/\s$/u.test(previous.text)&&next&&same(previous,next)&&/^[a-z]{3,}(?:\s|$)/u.test(next.text)
    &&next.rect.x-right(previous.rect)>=-.1&&next.rect.x-right(previous.rect)<=previous.size*.8)
    word.forEach(item=>proven.add(item));
   word=[];
  };
  for(const item of line.items){
   const previous=word.at(-1);
   if(previous&&(!same(previous,item)||/\s$/u.test(previous.text)||item.spaceBefore
    ||item.rect.x-right(previous.rect)<-.1||item.rect.x-right(previous.rect)>item.size*.22))finish(item);
   if(safe(item)&&/^[A-Za-z]+\s*$/u.test(item.text))word.push(item);else finish(item);
  }
  finish(null);
 }
 return proven;
}
