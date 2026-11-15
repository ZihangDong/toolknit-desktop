// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { nativePairSpacingBytes } from './native-pair-spacing.js';

/** Extra JS object/OOXML costs beyond the existing source/asset estimate. */
export function sceneLayoutBytes(scene) {
  let words=0, mathPositions=0, formCells=0, paintIndexes=0, recoveredMarks=0, opticalBytes=0, nativePairBytes=0, sourceProofBytes=0, colonFitBytes=0;
  const walk=blocks=>{for(const block of blocks){
    if(block.type==='columns')block.columns.forEach(column=>walk(column.blocks));
    if(block.cells)block.cells.forEach(cell=>walk(cell.blocks));
    if(block.emptyForm || block.nativeMappingBaseline || block.nativeOpenGrid!==undefined)formCells+=block.cells?.length||0;
    if(block.words)words+=block.words.length;
    // A bounded colon fit retains two score records in addition to its word.
    // Charge present markers even if a later consumer rejects their shape.
    colonFitBytes+=block.ocrColonFit!==undefined?1024:0;
    for(const word of block.words||[])colonFitBytes+=word.ocrColonFit!==undefined?1024:0;
    nativePairBytes+=nativePairSpacingBytes(block.nativePairSpacing || block.nativePairPolicy?.evidence) + (block.nativePairMap?.length || 0) * 8;
    for(const word of block.words||[])nativePairBytes+=nativePairSpacingBytes(word.nativePairSpacing || word.nativePairPolicy?.evidence) + (word.nativePairMap?.length || 0) * 8;
    if(block.ocrRecoveredMark)recoveredMarks++;
    sourceProofBytes+=(Array.isArray(block.ocrCorrections)?block.ocrCorrections.length:0)*512
      +(typeof block.ocrOriginalText==='string'?block.ocrOriginalText.length*2:0);
    // Whole-source math retains bounded copies of original runs, sources and
    // glyph traces beyond the ordinary source/asset estimate. Charge both
    // optional proofs, even malformed/colliding markers later rejected by the
    // writer; an invalid marker must not make the working estimate smaller.
    for(const name of ['sourceScalarRelation','sourceIndexedSum','sourceUpperAttachment','sourceAlignedEquation'])if(block[name]!==undefined){
      const members=block[name]?.members;
      sourceProofBytes+=4096+(Array.isArray(members)?members.length:0)*(name==='sourceAlignedEquation'?32768:4096);
    }
    if(block.rasterMathEvidence){const proof=block.rasterMathEvidence;
      opticalBytes+=4096+(proof.components?.length||0)*384+(block.mathGlyphs?.length||0)*1024
        +(proof.readings||[]).reduce((sum,reading)=>sum+(reading.characters?.length||0)*128,0)+(proof.indexReferences?.length||0)*4096;}
    paintIndexes+=(block.backgroundPaintIndexes?.length||0)+(block.decorationTextPaintIndexes?.length||0)
      +(block.relativeTextPaintIndexes?.length||0);
    mathPositions+=block.mathGlyphPositions?.length||0;
    for(const glyph of block.mathGlyphs||[])mathPositions+=glyph.mathGlyphPositions?.length||0;
    for(const line of block.lines||[])walk(line.items);
  }};
  walk(scene.items);
  const corrections=(scene.sources||[]).reduce((sum,source)=>sum+(source.encodingCorrections?.length||0),0);
  return words*512+Math.min(512,words)*2048+corrections*384+mathPositions*2048+formCells*2048+paintIndexes*16+recoveredMarks*2048+opticalBytes+nativePairBytes+sourceProofBytes+colonFitBytes;
}
