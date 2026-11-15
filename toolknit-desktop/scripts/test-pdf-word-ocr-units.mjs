import assert from 'node:assert/strict';
import {createCanvas,ImageData} from '@napi-rs/canvas';
import JSZip from 'jszip';
import {createOcrTypography} from '../src/features/pdf-to-word/adapters/ocr-typography.js';
import {recoverOcrSquareMetre} from '../src/features/pdf-to-word/core/ocr-symbols.js';
import {prepareOcrScene} from '../src/features/pdf-to-word/core/ocr-scene.js';
import {inferDocument} from '../src/features/pdf-to-word/core/layout.js';
import {createWordBytes} from '../src/features/pdf-to-word/adapters/docx.js';
import {collectPageAssets} from '../src/features/pdf-to-word/adapters/pdfjs.js';

const fit=createOcrTypography(createCanvas);
function sample(symbol,font,size=60,confidence=.99,repeats=1){
 const canvas=createCanvas(1400,180),context=canvas.getContext('2d');
 context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);
 context.fillStyle='black';context.font=`${size}px "${font}"`;context.fontKerning='none';
 const chinese=['SimSun','SimHei','FangSong'].includes(font),prefix=chinese?'约定':'Rate',suffix=chinese?'每日':'day';
 const words=[];let x=25;
 for(const token of [...prefix,...Array(repeats).fill(symbol),...suffix]){
  const m=context.measureText(token);context.fillText(token,x,110);
  words.push({text:[...prefix,...suffix].includes(token)?token:'m',x:x-m.actualBoundingBoxLeft,
   y:110-m.actualBoundingBoxAscent,width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,
   height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent,confidence});x+=m.width;
 }
 const left=Math.min(...words.map(w=>w.x)),top=Math.min(...words.map(w=>w.y));
 const right=Math.max(...words.map(w=>w.x+w.width)),bottom=Math.max(...words.map(w=>w.y+w.height));
 const line={text:words.map(w=>w.text).join(''),words,confidence,x:left,y:top,width:right-left,height:bottom-top};
 const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
 return {canvas,context,line,pixels,expected:prefix+'㎡'.repeat(repeats)+suffix,options:{line,pixels,width:canvas.width,height:canvas.height,sx:3,sy:3,
  allowSymbolCorrection:true,tight:{x:left/3,y:top/3,width:(right-left)/3,height:(bottom-top)/3},
  inkAt:(x,y)=>pixels[(y*canvas.width+x)*4]<180}};
}
for(const font of ['SimSun','SimHei','FangSong','Arial','Times New Roman']){
 for(const size of [36,60]){
  const {canvas,options,expected}=sample('㎡',font,size),before=structuredClone(options.line),result=fit(options);
  // This Node backend exposes identical missing-glyph boxes for squared/cubic
  // units in the Latin faces. Such pixels cannot prove a particular unit.
  if(['Arial','Times New Roman'].includes(font)){
   assert.equal(result?.ocrCorrections,undefined,'an unavailable unit face cannot authorize spelling repair');
   assert.deepEqual(options.line,before);canvas.width=canvas.height=0;continue;
  }
  assert.equal(result?.text,expected,`${font}/${size}: retain the raised2 from source ink`);
  assert.equal(result.ocrOriginalText,before.text);
  assert.equal(result.ocrCorrections.length,1);
  assert.equal(result.ocrCorrections[0].rule,'source-ink-square-metre');
  assert.deepEqual(options.line,before,'the original recognizer result is immutable');
  const native=fit({...options,allowSymbolCorrection:false});
  assert.equal(native?.ocrCorrections,undefined,'known native text never opts into OCR spelling repair');
  canvas.width=canvas.height=0;
 }
 for(const symbol of ['m','M','m2','㎥','m³','m°']){
  const {canvas,options}=sample(symbol,font),before=structuredClone(options.line),result=fit(options);
  assert(!result?.ocrCorrections?.some(c=>c.rule==='source-ink-square-metre'),`${font}/${symbol}: do not invent a squared unit`);
  assert.deepEqual(options.line,before);canvas.width=canvas.height=0;
 }
}
{
 const {canvas,options}=sample('㎡','SimSun',60,.6);
 assert.equal(fit(options)?.ocrCorrections,undefined,'weak token membership cannot authorize a unit correction');
 canvas.width=canvas.height=0;
}
{
 const {canvas,options}=sample('㎡','SimSun',60,.99,6),result=fit(options);
 assert.equal(result.ocrCorrections.length,4,'per-line unit comparison work is bounded');
 assert.equal([...result.text].filter(c=>c==='㎡').length,4);
 canvas.width=canvas.height=0;
}
{
 const {canvas,context,line,pixels}=sample('㎡','SimSun');const before=structuredClone(line);
 const result=prepareOcrScene({scene:{number:1,width:canvas.width/3,height:canvas.height/3,sources:[],items:[],rules:[],risks:['image-page'],characters:0},
  result:{width:canvas.width,height:canvas.height,lines:[line]},pixels,width:canvas.width,height:canvas.height,
  preserveGeometry:true,fitTypography:fit,measurementContext:context});
 const text=result.scene.items.find(item=>item.type==='text');
 assert.equal(text.text,'约定㎡每日');assert.equal(result.scene.sources[0].text,text.text);
 assert.equal(text.words.map(word=>word.text).join(''),text.text);
 const word=line.words[2];let ink=0;
 for(let y=Math.ceil(word.y);y<Math.floor(word.y+word.height);y++)for(let x=Math.ceil(word.x);x<Math.floor(word.x+word.width);x++)
  if(result.pixels[(y*canvas.width+x)*4]<180)ink++;
 assert.equal(ink,0,'the complete original unit including the raised2 is erased');
 const clean=createCanvas(canvas.width,canvas.height);clean.getContext('2d').putImageData(new ImageData(result.pixels,canvas.width,canvas.height),0,0);
 const assets=await collectPageAssets(result.scene,clean,createCanvas),document=inferDocument([result.scene],{preserveGeometry:true});
 const packed=await createWordBytes(document,assets,{preserveGeometry:true,measurementContext:context});
 const xml=await(await JSZip.loadAsync(packed.bytes)).file('word/document.xml').async('string');
 assert(xml.includes('㎡'));assert.equal(packed.quality.editableCharacters,5);
 assert.equal(packed.quality.nativeFormulas,0,'a literal unit is not counted as a recovered formula');
 assert.deepEqual(line,before);clean.width=clean.height=canvas.width=canvas.height=0;
}
for(const mask of [null,new Uint8Array(32),new Uint8Array(1024),new Uint8Array(1024).fill(1)]){
 let calls=0;assert.equal(recoverOcrSquareMetre({text:'m',mask,width:40,height:35,confidence:.99,score:()=>{calls++;return 1;}}),null);
 assert.equal(calls,0,'invalid or unproven geometry never requests template matching');
}
console.log('OCR units: source-proven raised2, cubic/degree/plain-letter rejection, native isolation, immutable evidence, bounded work and actual editable DOCX passed.');
