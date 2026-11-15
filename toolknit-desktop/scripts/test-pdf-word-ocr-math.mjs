import assert from 'node:assert/strict';
import { ocrMathCandidate, ocrMathFallback, ocrRecognitionConfidence } from '../src/features/pdf-to-word/core/ocr-math.js';
import { inferMathAst } from '../src/features/pdf-to-word/core/math.js';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
const source={id:'p1:ocr0',type:'text',ocr:true,confidence:.999,size:12,baseline:50,order:0,text:'x=y+2',rect:{x:40,y:40,width:45,height:12},
  words:[...'x=y+2'].map((text,index)=>({text,font:'Times New Roman',size:12,baseline:50,rect:{x:40+index*9,y:41,width:7,height:9},confidence:.999,ocrGlyphScore:.99}))};
const result=ocrMathCandidate(source);assert(result);assert(result.item.mathGlyphs.every(glyph=>glyph.raster&&glyph.ocrEvidence));
assert.equal(ocrRecognitionConfidence({...source,words:[...source.words,{text:' ',confidence:.99}]}),(.999*5+.99)/6);
assert.equal(ocrRecognitionConfidence({...source,words:source.words.slice(1)}),null);
assert.equal(ocrRecognitionConfidence({...source,words:source.words.map((w,i)=>i?w:{...w,confidence:NaN})}),null);
assert(ocrMathCandidate({...source,confidence:.87,ocrRecognitionConfidence:.999}),
 'detector confidence cannot replace independently high recognition and glyph evidence');
assert.equal(ocrMathCandidate({...source,confidence:.7,ocrRecognitionConfidence:1}),null,
 'weak detection still cannot create an editable formula');
assert.equal(ocrMathCandidate({...source,confidence:.87,ocrRecognitionConfidence:.9}),null);
const uncertain={...source,sourceIds:[source.id],text:'A = ∑ biei.',confidence:.81};const saved=structuredClone(uncertain);
const fallback=ocrMathFallback(uncertain);assert(fallback?.item.ocrMathUnverified);
assert.equal(fallback.sources[0].disposition,'visible-image');assert(fallback.sources[0].ocrUnverified);
assert.equal(inferMathAst(fallback.item),null,'an uncertain scan operator cannot masquerade as proven structured math');
assert.deepEqual(uncertain,saved);
for(const text of ['English prose','求和公式为 A=∑x','x=y+2'])assert.equal(ocrMathFallback({...source,text}),null);
assert(inferMathAst(result.item));assert(result.sources.every(item=>item.provenance==='raster-ocr'));
for(const candidate of [{...source,confidence:.7},{...source,text:'English paragraph'}, {...source,words:source.words.map((word,i)=>i?word:{...word,confidence:.7})}, {...source,words:source.words.map((word,i)=>i?word:{...word,ocrGlyphScore:.2})}])assert.equal(ocrMathCandidate(candidate),null);
const forged=structuredClone(result.item);delete forged.mathGlyphs[0].ocrEvidence;assert.equal(inferMathAst(forged),null,'ordinary raster glyphs never masquerade as native font evidence');
const document=inferDocument([{number:1,width:300,height:200,sources:result.sources,items:[result.item],rules:[],risks:['ocr'],characters:5}],{preserveGeometry:true});
const canvas=createCanvas(90,24);canvas.getContext('2d').fillText('x=y+2',0,18);
const output=await createWordBytes(document,[{id:result.item.id,bytes:canvas.toBuffer('image/png'),width:90,height:24}],{preserveGeometry:true,editableMath:true,measurementContext:createCanvas(1,1).getContext('2d')});
const xml=await(await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');
assert(xml.includes('<m:oMath>'));assert.equal(output.quality.nativeFormulas,1);assert.equal(output.quality.nativeMathCharacters,5);
// Source-derived natural glyph positions exercise the production strict gate.
// The synthetic equally spaced boxes above intentionally test only serialization.
const measure=createCanvas(1,1).getContext('2d');measure.font='12px "Times New Roman"';measure.fontKerning='none';
let x=40;const words=[...'x=y+2'].map(text=>{const m=measure.measureText(text),word={text,font:'Times New Roman',size:12,
 baseline:50,preciseInk:true,confidence:.999,ocrGlyphScore:.99,
 rect:{x:x-m.actualBoundingBoxLeft,y:50-m.actualBoundingBoxAscent,width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,
 height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent}};x+=m.width;return word;});
const left=Math.min(...words.map(w=>w.rect.x)),top=Math.min(...words.map(w=>w.rect.y));
const strictCandidate=ocrMathCandidate({...source,words,confidence:.87,ocrRecognitionConfidence:.999,
 rect:{x:left,y:top,width:Math.max(...words.map(w=>w.rect.x+w.rect.width))-left,height:Math.max(...words.map(w=>w.rect.y+w.rect.height))-top}});
const strictDoc=inferDocument([{number:1,width:300,height:200,sources:strictCandidate.sources,items:[strictCandidate.item],rules:[],risks:['ocr'],characters:5}],{preserveGeometry:true});
const strict=await createWordBytes(strictDoc,[{id:strictCandidate.item.id,bytes:canvas.toBuffer('image/png'),width:90,height:24}],
 {preserveGeometry:true,editableMath:true,strictMathGeometry:true,measurementContext:measure});
assert.equal(strict.quality.nativeFormulas,1);
const nodes=(node,name)=>[...(node.name===name?[node]:[]),...(node.elements||[]).flatMap(c=>nodes(c,name))];
const strictXml=xml2js(await(await JSZip.loadAsync(strict.bytes)).file('word/document.xml').async('string'));
const paragraph=nodes(strictXml,'w:p').find(p=>nodes(p,'m:oMath').length);
const frame=nodes(paragraph,'w:framePr')[0].attributes,spacing=nodes(paragraph,'w:spacing')[0].attributes;
assert(Math.abs(Number(frame['w:y'])/20+Number(spacing['w:line'])/20*.8-50)<=.05,
 'a calibrated scan equation keeps its source baseline under the actual Office fixed-line rule');
console.log('OCR math: explicit raster evidence, bounded identity whitelist, uncertain fallback and real editable OMML passed.');
