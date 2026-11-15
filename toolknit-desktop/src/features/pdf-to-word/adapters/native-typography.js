// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
/** Known PDF characters provide the text; pixels calibrate unavailable fonts.
 * This does not run OCR or alter the source ledger, symbols, images or clipping.
 */
import { nativeDisplayCandidate } from './native-display-typography.js';
import { sourceFontAssetId } from '../core/source-font.js';
import { sourceIndexedSumRegion } from '../core/source-indexed-sum.js';

// Mathematical alphanumeric code points already encode their weight/slant.
// Ordinary text faces may paint a fallback or a missing glyph while exposing
// unrelated metrics. Keep their measured/written face separate from ASCII
// donors of the same PDF font; do not synthesize another bold/italic style.
const mathTextFace = item => !item.bold && !item.italic && !item.mathStyleUncertain
  && /^(?:[A-Z]{6}\+)?XITSMath-Regular$/i.test(item.font || '')
  && /[\u{1d400}-\u{1d7ff}]/u.test(item.text || '');

export function calibrateNativeTypography(scene, pixels, width, height, fit, refineDisplay = null) {
  if(!fit||!(pixels instanceof Uint8ClampedArray)||pixels.length!==width*height*4)return scene;
  const sx=width/scene.width,sy=height/scene.height;
  const choices=new Map(),unmatched=[],originals=new Map();
  const faceKey=item=>JSON.stringify([item.font?.replace(/^[A-Z]{6}\+/,''),/[\p{Script=Han}]/u.test(item.text),Boolean(item.bold),Boolean(item.italic),mathTextFace(item)]);
  const fitItem=item=>{
    const color=/^[0-9a-f]{6}$/i.test(item.color)?[0,2,4].map(i=>parseInt(item.color.slice(i,i+2),16)):[0,0,0];
    const inkAt=(x,y)=>{const p=(y*width+x)*4;return [0,1,2].every(channel=>Math.abs(pixels[p+channel]-color[channel])<60);};
    const line={text:item.text,confidence:1,words:item.glyphPositions.map(glyph=>({text:glyph.text,x:glyph.rect.x*sx,y:glyph.rect.y*sy,width:glyph.rect.width*sx,height:glyph.rect.height*sy,confidence:1}))};
    const result=fit({line,pixels,width,height,sx,sy,tight:item.rect,inkAt,
      fontHint:mathTextFace(item)?{font:'Cambria Math',bold:false}:undefined});
    if(!result||result.ocrFontScore<.65)return null;
    const key=faceKey(item),previous=choices.get(key);
    if(!previous||previous.ocrFontScore<result.ocrFontScore)choices.set(key,result);
    return result;
  };
  const walk=blocks=>{for(const item of blocks){
    if(item.type==='columns')item.columns.forEach(column=>walk(column.blocks));
    if(item.cells)item.cells.forEach(cell=>walk(cell.blocks));
    if(item.lines)item.lines.forEach(line=>walk(line.items));
    // Recovering an entire formula must not remove a previously available font
    // calibration donor for nearby ordinary characters of the same source face.
    // Donors are complete original records; no extra text or rendering is added.
    const sum=sourceIndexedSumRegion(item);
    if(sum)for(const {item:donor} of sum.members){
      if(donor.glyphPositions.length>=2&&!/[=<>∑∫√]/u.test(donor.text))fitItem(donor);
    }
    if(item.type!=='text'||item.raster||!item.glyphPositions?.length||item.alphabet)continue;
    if(item.fontAssetId && sourceFontAssetId(item.font) === item.fontAssetId)continue;
    if(refineDisplay&&nativeDisplayCandidate(item))originals.set(item.id,structuredClone(item));
    if(item.glyphPositions.length<2){unmatched.push(item);continue;}
    if(!/[\p{Script=Han}]/u.test(item.text)&&/[=<>∑∫√]/u.test(item.text)&&!mathTextFace(item))continue;
    const result=fitItem(item);
    // A short mixed operator/letter run may lack enough independent ink for
    // size fitting. A verified donor may still supply its font, just as for
    // single characters; retain this run's own size, baseline and geometry.
    if(!result){if(mathTextFace(item))unmatched.push(item);continue;}
    Object.assign(item,{sourceFont:item.font,sourceSize:item.size,sourceFontMetrics:item.fontMetrics,fontMetrics:undefined,...result,nativeCalibrated:true,preciseInk:true});
    delete item.glyphPositions;
  }};
  walk(scene.items);
  for(const item of unmatched){const selected=choices.get(faceKey(item));if(selected)Object.assign(item,{sourceFont:item.font,sourceSize:item.size,sourceFontMetrics:item.fontMetrics,fontMetrics:undefined,font:selected.font,fontFamily:selected.fontFamily,bold:selected.bold});}
  const strip=blocks=>{for(const item of blocks){delete item.glyphPositions;if(item.cells)item.cells.forEach(cell=>strip(cell.blocks));if(item.columns)item.columns.forEach(column=>strip(column.blocks));if(item.lines)item.lines.forEach(line=>strip(line.items));}};
  strip(scene.items);
  if(originals.size)refineDisplay(scene,pixels,width,height,originals);
  return scene;
}
