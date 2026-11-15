// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { inferMathAst } from './math.js';
// Native line confidence is capped by region detection. Keep recognition
// evidence separate; the original CTC sequence, including spaces, must match.
export function ocrRecognitionConfidence(line) {
  const words=line?.words;
  if(!Array.isArray(words)||!words.length||words.length>200||typeof line.text!=='string'
    ||words.some(word=>typeof word?.text!=='string'||!Number.isFinite(word.confidence)||word.confidence<0||word.confidence>1)
    ||words.map(word=>word.text).join('').replace(/\s/gu,'')!==line.text.replace(/\s/gu,''))return null;
  return words.reduce((sum,word)=>sum+word.confidence,0)/words.length;
}
/** A clear math-only row with an unproven two-dimensional operator must keep
 * source pixels. Ordinary OCR text cannot supply its indices or operand roles.
 */
export function ocrMathFallback(item) {
  if(!item?.ocr||typeof item.text!=='string'||item.text.length>120||!/[=<>≤≥]/u.test(item.text)
    ||!/[∑∏∫√]/u.test(item.text)||!/^[\p{Script=Latin}\p{Script=Greek}0-9\s+\-−=×÷*/().,[\]{}<>≤≥∑∏∫√]+$/u.test(item.text)
    ||item.sourceIds?.length!==1||item.sourceIds[0]!==item.id)return null;
  return {item:{id:item.id+':math-image',type:'image',role:'math',ocrMath:true,ocrMathUnverified:true,
    sourceIds:item.sourceIds,rect:item.rect,order:item.order,reasons:['ocr-math-unverified']},
    sources:[{id:item.id,text:item.text,rect:item.rect,disposition:'visible-image',provenance:'raster-ocr',ocrUnverified:true}]};
}
/** Raster evidence is explicit and separate from native PDF glyph provenance.
 * This small whitelist handles clear one-line identities and measured scripts;
 * ambiguous symbols, prose and unproven two-dimensional structures stay visible.
 */
export function ocrMathCandidate(item) {
  const text=item.text.replace(/\s/g,'');
  const recognition=item.ocrRecognitionConfidence??item.confidence;
  if(!item.ocr||!Number.isFinite(item.confidence)||item.confidence<.85||!Number.isFinite(recognition)||recognition<.95
    ||recognition>1||text.length<3||text.length>80||!/[=<>≤≥]/u.test(text)
    ||!/^[a-zA-Z0-9+\-−=×÷*/().,[\]{}<>≤≥]+$/u.test(text)||!item.words?.length)return null;
  if(item.words.map(word=>word.text).join('')!==text||item.words.some(word=>!(word.confidence>=.98&&word.ocrGlyphScore>=.8)))return null;
  const glyphs=item.words.map((word,index)=>({...word,id:item.id+':math-glyph-'+index,raster:true,
    ocrEvidence:{confidence:word.confidence,shapeScore:word.ocrGlyphScore},italic:false}));
  const candidate={id:item.id+':math',type:'image',role:'math',ocrMath:true,rect:item.rect,sourceIds:glyphs.map(g=>g.id),
    mathGlyphs:glyphs,mathStrokes:[],reasons:[],size:item.size,baseline:item.baseline,order:item.order};
  if(!inferMathAst(candidate))return null;
  return {item:candidate,sources:glyphs.map(g=>({id:g.id,text:g.text,rect:g.rect,disposition:'visible-image',provenance:'raster-ocr'}))};
}
