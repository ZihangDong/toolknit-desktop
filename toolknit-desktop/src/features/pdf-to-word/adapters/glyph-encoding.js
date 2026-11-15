// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import fontkit from '@pdf-lib/fontkit';
import { wordFont } from './docx-fonts.js';

const INVALID = /^[\u0000-\u001f\u007f-\u009f\ufffd]$/u;
const CHARACTERS = [...Array.from({ length: 95 }, (_, index) => String.fromCodePoint(32 + index)).join('') + '“”‘’–—•…©®°±×÷£€'];
const FAMILIES = new Set(['Arial', 'Times New Roman', 'Courier New', 'Calibri', 'Cambria']);
const SIDE = 420, EM = 260, X = 50, Y = 330;
const keyFor = glyph => JSON.stringify([glyph.fontChar, glyph.unicode, glyph.width]);

/** Repair only broken Unicode maps. Shape, origin and advance must independently
 * agree with a known local face; ordinary text and ambiguous glyphs stay intact.
 * No source font is installed, embedded in the result, or sent over the network.
 */
export function createGlyphEncodingDecoder(createCanvas) {
  const templates = new Map(), measures = new Map();
  const probe = createCanvas(1, 1), measurement = probe.getContext('2d');
  function raster(draw, scale = 1) {
    const side = SIDE * scale;
    const canvas = createCanvas(side, side), context = canvas.getContext('2d');
    try {
      context.scale(scale, scale); context.fillStyle = 'black'; draw(context);
      const pixels = context.getImageData(0, 0, side, side).data;
      let left = side, top = side, right = 0, bottom = 0, count = 0;
      for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) if (pixels[(y * side + x) * 4 + 3] > 127) {
        left = Math.min(left, x); right = Math.max(right, x + 1);
        top = Math.min(top, y); bottom = Math.max(bottom, y + 1); count++;
      }
      if (count && (left < 1 || top < 1 || right >= side || bottom >= side)) return null;
      const width = Math.max(0, right - left), height = Math.max(0, bottom - top), mask = new Uint8Array(width * height);
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) mask[(y - top) * width + x - left] = pixels[(y * side + x) * 4 + 3] > 127 ? 1 : 0;
      return { mask, count, left, top, right, bottom, width };
    } finally { canvas.width = canvas.height = 0; }
  }
  function metrics(face, text) {
    const key = JSON.stringify([face, text]);
    if (!measures.has(key)) {
      measurement.font = face; measurement.fontKerning = 'none';
      if (measures.size >= 512) measures.delete(measures.keys().next().value);
      measures.set(key, measurement.measureText(text).width / EM);
    }
    return measures.get(key);
  }
  function template(face, text, scale = 1) {
    const key = JSON.stringify([face, text, scale]);
    if (!templates.has(key)) {
      const value = raster(context => { context.font = face; context.fontKerning = 'none'; context.fillText(text, X, Y); }, scale);
      if (templates.size >= 96) templates.delete(templates.keys().next().value);
      templates.set(key, value);
    }
    return templates.get(key);
  }
  function score(first, second) {
    if (!first?.count || !second?.count) return 0;
    let intersection = 0;
    for (let y = Math.max(first.top, second.top); y < Math.min(first.bottom, second.bottom); y++)
      for (let x = Math.max(first.left, second.left); x < Math.min(first.right, second.right); x++)
        intersection += first.mask[(y - first.top) * first.width + x - first.left] & second.mask[(y - second.top) * second.width + x - second.left];
    return 2 * intersection / (first.count + second.count);
  }
  function* draws(operations) {
    const stack=[];let fontId=null;
    for(const operation of operations){
      if(['save','paintFormXObjectBegin'].includes(operation.name))stack.push(fontId);
      if(['restore','paintFormXObjectEnd'].includes(operation.name))fontId=stack.pop()??null;
      if(operation.name==='setFont')fontId=operation.args[0];
      if(operation.name==='setGState')for(const[key,value]of operation.args[0]||[])if(key==='Font')fontId=value[0];
      if(!['showText','showSpacedText'].includes(operation.name))continue;
      for(const glyph of operation.args[0]||[])if(glyph&&typeof glyph.unicode==='string'&&typeof glyph.fontChar==='string'&&[...glyph.fontChar].length===1)yield [fontId,glyph];
    }
  }
  return (snapshot, check = () => {}) => {
    const wanted = new Map();
    for(const[id,glyph]of draws(snapshot.operations))if(INVALID.test(glyph.unicode)){
      if(!wanted.has(id)&&wanted.size<8)wanted.set(id,new Map());
      const list=wanted.get(id);if(list&&list.size<256)list.set(keyFor(glyph),glyph);
    }
    if (!wanted.size) return null;
    const observed=new Map([...wanted.keys()].map(id=>[id,new Map()]));
    for(const[id,glyph]of draws(snapshot.operations)){const list=observed.get(id);if(list&&list.size<384)list.set(keyFor(glyph),glyph);}
    const repaired = new Map(), compromised=new Set(); let remaining = 256;
    for (const [id, glyphs] of wanted) {
      check(); const metadata = snapshot.fonts[id];
      if (!metadata?.data?.length || metadata.data.length > 32 * 1024 * 1024 || metadata.vertical || metadata.type3 || metadata.missingFile) continue;
      const family = wordFont(metadata.name);
      if (!FAMILIES.has(family)) continue;
      const bold = metadata.bold || metadata.black || /bold|black|heavy/i.test(metadata.name);
      const italic = metadata.italic || /italic|oblique/i.test(metadata.name);
      const face = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${EM}px "${family}"`;
      let font; try { font = fontkit.create(metadata.data); } catch { continue; }
      if (!(font.unitsPerEm > 0)) continue;
      const processed=new Map();
      const decode = glyph => {
        const key=keyFor(glyph);if(processed.has(key))return processed.get(key);
        processed.set(key,null);if(--remaining<0)return null;
        check(); let source, drawSource;
        try {
          const path = font.glyphForCodePoint(glyph.fontChar.codePointAt(0)).path;
          if (!path || path.commands.length > 4096 || path.commands.some(command => !['moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'closePath'].includes(command.command)
            || command.args.some(value => !Number.isFinite(value) || Math.abs(value) > font.unitsPerEm * 8))) return null;
          drawSource = context => { context.translate(X, Y); context.scale(EM / font.unitsPerEm, -EM / font.unitsPerEm);
            context.beginPath(); for (const command of path.commands) context[command.command](...command.args); context.fill(); };
          source = glyph.isInFont===false?{count:0}:raster(drawSource);
        } catch { return null; }
        const advance = glyph.width * (metadata.matrixScale || .001);
        if (!source || !Number.isFinite(advance) || advance <= 0 || advance > 4) return null;
        let selected;
        if (!source.count) {
          const delta = Math.abs(metrics(face, ' ') - advance);
          if (delta <= .002) selected = { text: ' ', similarity: 1, margin: 1, advanceError: delta };
        } else {
          const candidates = [];
          for (const text of CHARACTERS) {
            const delta = Math.abs(metrics(face, text) - advance);
            if (delta <= .004) candidates.push({ text, similarity: score(source, template(face, text)), advanceError: delta });
          }
          candidates.sort((a, b) => b.similarity - a.similarity);
          let first = candidates[0], margin = first ? first.similarity - (candidates[1]?.similarity || 0) : 0;
          // Small punctuation can lose a few boundary pixels at this em size.
          // Recheck the same candidates at twice the resolution, retaining the
          // original acceptance thresholds and unique-match requirement.
          let comparisonScale = 1;
          if (first?.similarity >= .94 && first.similarity < .97 && margin >= .05) {
            check(); const precise = raster(drawSource, 2);
            for (const candidate of candidates) candidate.similarity = score(precise, template(face, candidate.text, 2));
            candidates.sort((a, b) => b.similarity - a.similarity);
            first = candidates[0]; margin = first.similarity - (candidates[1]?.similarity || 0); comparisonScale = 2;
          }
          if (first?.similarity >= .97 && margin >= .05) selected = { ...first, margin, comparisonScale };
        }
        if (selected) {
          if (!repaired.has(id)) repaired.set(id, new Map());
          const value={ text: selected.text, rule: 'local-font-outline', evidence: {
            family, similarity: selected.similarity, margin: selected.margin, advanceError: selected.advanceError,
            comparisonScale: selected.comparisonScale || 1,
            ...(glyph.isInFont===false?{rendererBlank:true}:{}) } };
          repaired.get(id).set(key,value);processed.set(key,value);return value;
        }
        return null;
      };
      let verifiedLetters=0;
      for(const glyph of glyphs.values()){const value=decode(glyph);if(value&&/[A-Za-z0-9]/u.test(value.text))verifiedLetters++;}
      // A broken map often continues into printable character codes. Once
      // multiple control slots prove the fault, verify the rest of that face
      // too; retaining its unverified printable bytes would produce wrong words.
      if(verifiedLetters>=3){compromised.add(id);for(const glyph of observed.get(id).values())decode(glyph);}
    }
    return repaired.size ? (id, glyph) => {
      const value=repaired.get(id)?.get(keyFor(glyph));
      if(value)return value.text===glyph.unicode?null:value;
      return compromised.has(id)?{uncertain:true}:null;
    } : null;
  };
}
