// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
// Character-specific retention for complete equations, not general Greek admission.
// Independent cmap/hmtx facts; no font bytes, source ids or locations.
export const SHORTHAND_GAMMA = Object.freeze({codePoint:0x1d6fe,glyphId:2011,
  font:'Cambria Math',postScriptName:'CambriaMath',unitsPerEm:2048,advanceUnits:1076});
export const sourceShorthandItalicGamma=text=>text==='\u{1d6fe}';
export function sourceShorthandStyleCovered(region){
  return Array.isArray(region?.mathGlyphs)&&region.mathGlyphs.length>0&&region.mathGlyphs.length<=96
    &&region.mathGlyphs.every(g=>typeof g?.text==='string'&&g.text.length<=4096
      &&[...g.text].every(c=>{const p=c.codePointAt(0);return p<0x1d6e2||p>0x1d71b||sourceShorthandItalicGamma(c);}));
}
export function sourceShorthandGammaMeasurement({font,text,metrics}){
  if(font!==SHORTHAND_GAMMA.font||!sourceShorthandItalicGamma(text)||!metrics)return false;
  const values=['width','actualBoundingBoxLeft','actualBoundingBoxRight','actualBoundingBoxAscent','actualBoundingBoxDescent'];
  return values.every(k=>Number.isFinite(metrics[k])&&Math.abs(metrics[k])<=4096)
    &&Math.abs(metrics.width-SHORTHAND_GAMMA.advanceUnits/SHORTHAND_GAMMA.unitsPerEm*1000)<=.02
    &&metrics.actualBoundingBoxLeft+metrics.actualBoundingBoxRight>0
    &&metrics.actualBoundingBoxAscent+metrics.actualBoundingBoxDescent>0;
}
