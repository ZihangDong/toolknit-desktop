// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import {validRect,union,overlaps} from './geometry.js';
/** Exact leading was reader-verified only for untransformed, source-proven
 * ordinary Times rows in the new partitioned grid. Other table/frame contracts
 * remain independent; this predicate alone never establishes source ownership. */
export function nativeTableRowCandidate(item) {
  if (!item || !item.preciseInk || item.raster || item.ocr || item.alphabet || item.mathStyleUncertain || item.italic
    || !Number.isFinite(item.size) || item.size < 5 || item.size > 20
    || !Number.isFinite(item.baseline) || Math.abs((item.horizontalScale ?? 1) - 1) > .001
    || /[=<>∑∫√^_]/u.test(item.text || '')) return false;
  const font = String(item.font || '').replace(/^[A-Z]{6}\+/, '');
  return /^(?:NimbusRomNo9L-(?:Regu|Medi)|Times(?:-Roman|-Bold|NewRomanPS(?:MT|-BoldMT))?)$/i.test(font);
}

/** A complete, source-owned flat CM9 function inside an open native grid.
 * Ordinary Times labels may surround it; partial/extra/mixed math never passes. */
export function nativeTableFunctionGlyphs(items,sources){
 if(!Array.isArray(items)||items.length>1500||items.some(g=>!g||typeof g!=='object')||!(sources instanceof Map)||sources.size>12000)return null;
 const known=/^(?:[A-Z]{6}\+)?(?:CMMI9|CMR9)$/;
 const glyphs=items.filter(g=>known.test(g?.font||'')).sort((a,b)=>a.rect?.x-b.rect?.x);
 if(glyphs.length!==4||!/^[A-Za-z]$/.test(glyphs[0].text||'')||glyphs[1].text!=='('
  ||!/^[A-Za-z]$/.test(glyphs[2].text||'')||glyphs[3].text!==')')return null;
 const ids=new Set();
 for(const[i,g]of glyphs.entries()){
  const s=g.sourceIds?.length===1&&sources.get(g.sourceIds[0]);
  if((g.type!==undefined&&g.type!=='text')||g.words?.length||g.mathGlyphs?.length||!validRect(g.rect)||!g.preciseInk||g.raster!==false||g.ocr||g.alphabet||g.mathStyleUncertain||g.radicalPart||g.delimiterPart||g.bold||g.fontAssetId
   ||!Number.isFinite(g.baseline)||!Number.isFinite(g.size)||g.size<5||g.size>20||Math.abs(g.baseline-glyphs[0].baseline)>.05||Math.abs(g.size-glyphs[0].size)>.05
   ||!/^[0-9a-f]{6}$/i.test(g.color||'')||g.color!==glyphs[0].color||!Number.isFinite(g.horizontalScale??1)||Math.abs((g.horizontalScale??1)-1)>.001||!s||s.disposition!=='editable'||s.id!==g.id||s.text!==g.text||!validRect(s.rect)
   ||['x','y','width','height'].some(k=>Math.abs(s.rect[k]-g.rect[k])>.001)||typeof s.id!=='string'||!s.id||s.id.length>160||ids.has(s.id)
   ||(i%2===0?!/^(?:[A-Z]{6}\+)?CMMI9$/.test(g.font)||!g.italic:!/^(?:[A-Z]{6}\+)?CMR9$/.test(g.font)||g.italic)
   ||i&&(g.rect.x<glyphs[i-1].rect.x+glyphs[i-1].rect.width-.2||g.rect.x-glyphs[i-1].rect.x-glyphs[i-1].rect.width>g.size*.75))return null;
  ids.add(s.id);
 }
 const own=new Set(glyphs),span=union(glyphs.map(g=>g.rect));
 if(items.some(g=>!own.has(g)&&validRect(g.rect)&&overlaps(span,g.rect,.01)))return null;
 return glyphs;
}

/** Complete source-owned numeric uncertainty row, not arbitrary math. */
export function nativeTableNumericGlyphs(items,sources){
 if(!Array.isArray(items)||items.length<3||items.length>16||items.some(g=>!g||typeof g!=='object')||!(sources instanceof Map)||sources.size>12000)return null;
 const glyphs=[...items].sort((a,b)=>a?.rect?.x-b?.rect?.x);
 if(!/^\d{1,8}(?:\.\d{1,6})?±\d{1,8}(?:\.\d{1,6})?$/.test(glyphs.map(g=>g?.text||'').join('')))return null;
 const ids=new Set(),first=glyphs[0];
 for(const[i,g]of glyphs.entries()){
  const source=g?.sourceIds?.length===1&&sources.get(g.sourceIds[0]),font=String(g?.font||'').replace(/^[A-Z]{6}\+/,'');
  if((g.type!==undefined&&g.type!=='text')||g.lines?.length||g.cells?.length||g.columns?.length||!validRect(g.rect)||!g.preciseInk||g.raster!==false||g.ocr||g.alphabet||g.mathStyleUncertain||g.radicalPart||g.delimiterPart||g.fontAssetId||g.words?.length||g.mathGlyphs?.length
   ||!Number.isFinite(g.baseline+g.size)||g.size<5||g.size>20||Math.abs(g.size-first.size)>.01||Math.abs(g.baseline-first.baseline)>.05
   ||!Number.isFinite(g.horizontalScale??1)||Math.abs((g.horizontalScale??1)-1)>.001||!/^[0-9a-f]{6}$/i.test(g.color||'')||g.color!==first.color
   ||!source||source.disposition!=='editable'||source.id!==g.id||source.text!==g.text||!validRect(source.rect)||typeof source.id!=='string'||!source.id||source.id.length>160||ids.has(source.id)
   ||['x','y','width','height'].some(k=>Math.abs(source.rect[k]-g.rect[k])>.001)
   ||(g.text==='±'?font!=='CMSY10'||g.bold||g.italic:g.text==='.'?font!=='CMMI10'||g.bold||!g.italic:!/^\d+$/.test(g.text)||!['CMR10','CMBX10'].includes(font)||Boolean(g.bold)!==(font==='CMBX10')||g.italic)
   ||i&&(g.rect.x<glyphs[i-1].rect.x+glyphs[i-1].rect.width-.2||g.rect.x-glyphs[i-1].rect.x-glyphs[i-1].rect.width>g.size*.75))return null;
  ids.add(source.id);
 }
 return glyphs;
}
