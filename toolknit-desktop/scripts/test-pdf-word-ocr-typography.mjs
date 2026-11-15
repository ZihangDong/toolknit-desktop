import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { createOcrTypography } from '../src/features/pdf-to-word/adapters/ocr-typography.js';
import { prepareOcrScene } from '../src/features/pdf-to-word/core/ocr-scene.js';
const fit=createOcrTypography(createCanvas);
for(const font of ['SimSun','SimHei','Arial','Times New Roman']) {
  const text=font.startsWith('Sim')?'本地文字排版处理':'Sample typographic text';
  const canvas=createCanvas(1800,180),context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,1800,180);context.fillStyle='black';context.font=`60px "${font}"`;context.fontKerning='none';
  const words=[];let x=25;
  for(const char of text){const m=context.measureText(char);context.fillText(char,x,100);if(char.trim())words.push({text:char,x:x-m.actualBoundingBoxLeft,y:100-m.actualBoundingBoxAscent,width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent});x+=m.width;}
  const pixels=context.getImageData(0,0,1800,180).data;
  const bounds={x:Math.min(...words.map(w=>w.x)),y:Math.min(...words.map(w=>w.y)),width:Math.max(...words.map(w=>w.x+w.width))-words[0].x,height:Math.max(...words.map(w=>w.y+w.height))-Math.min(...words.map(w=>w.y))};
  const options={line:{text,words},pixels,width:1800,height:180,sx:3,sy:3,tight:Object.fromEntries(Object.entries(bounds).map(([k,v])=>[k,v/3])),inkAt:(x,y)=>pixels[(y*1800+x)*4]<150};
  const result=fit(options);assert(result);assert.equal(result.font,font);assert.equal(result.bold,false);assert(Math.abs(result.size-20)<.75);
  assert.equal(result.words.map(w=>w.text).join(''),text.replace(/\s/g,''));
  assert(Math.abs(result.baseline-100/3)<.75,'visible baseline is calibrated from original glyph ink');
  assert.equal(fit({...options,line:{text:'different',words}}),null,'inconsistent CTC boxes cannot replace source geometry');
  assert.equal(fit({...options,line:{text,words:[...words].reverse()}}),null,'nonmonotonic token positions are rejected');
  const w=words[0],single={...options,line:{text:w.text,words:[w]},tight:{x:w.x/3,y:w.y/3,width:w.width/3,height:w.height/3},fontHint:{font,bold:false}};
  const short=fit(single);assert(short);assert.equal(short.font,font);assert.equal(short.bold,false,'a verified neighbouring face calibrates a one-character label');
  const fitted=short.words[0];
  const measurement=createCanvas(1,1),measure=measurement.getContext('2d');
  measure.font=`1000px "${fitted.font}"`;measure.fontKerning='none';
  const outline=measure.measureText(fitted.text);
  assert(Math.abs((outline.actualBoundingBoxAscent+outline.actualBoundingBoxDescent)*fitted.size/1000-fitted.rect.height)<1e-7,
    'physical OCR size matches the writer outline instead of the rounded raster signature');
  assert(Math.abs(fitted.baseline-fitted.rect.y-outline.actualBoundingBoxAscent*fitted.size/1000)<1e-7,
    'baseline and size use the same continuous outline geometry');
  measurement.width=measurement.height=0;
  canvas.width=canvas.height=0;
}
console.log('OCR typography: Chinese/Latin source font evidence, size, baseline, per-character position and invalid CTC fallback passed.');

// A Chinese document's numeric footer may still be typeset in SimSun. Its
// source ink, not the absence of Han characters, determines the matching face.
for (const text of ['-10-', '-1-', '-11-', '11', '1', 'AA', '-1-1-']) {
  const canvas=createCanvas(600,150),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,600,150);ctx.fillStyle='black';ctx.font='60px "SimSun"';ctx.fontKerning='none';
  const words=[];let x=25;
  for(const char of text){const m=ctx.measureText(char);ctx.fillText(char,x,110);words.push({text:char,x:x-m.actualBoundingBoxLeft,y:110-m.actualBoundingBoxAscent,
    width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent,confidence:1});x+=m.width;}
  const pixels=ctx.getImageData(0,0,600,150).data,source=pixels.slice();
  const top=Math.min(...words.map(w=>w.y)),bottom=Math.max(...words.map(w=>w.y+w.height));
  const options={line:{text,words},pixels,width:600,height:150,sx:3,sy:3,allowSymbolCorrection:true,allowSingleNumeric:true,
    tight:{x:words[0].x/3,y:top/3,width:(words.at(-1).x+words.at(-1).width-words[0].x)/3,height:(bottom-top)/3},inkAt:(x,y)=>pixels[(y*600+x)*4]<180};
  const before=structuredClone(options.line),result=fit(options);
  if (['1', 'AA', '-1-1-'].includes(text)) {
    assert.equal(result, null, 'bare singleton, ordinary repeated letters and ambiguous numeric punctuation keep the original fallback');
    canvas.width=canvas.height=0;
    continue;
  }
  assert.equal(result?.font,'SimSun','purely numeric OCR must recover the independently rendered CJK face');
  assert(result.words.filter(w=>/[0-9]/u.test(w.text)).every(w=>w.font==='SimSun'),'numeric glyphs recover their actual source face');
  assert(result.words.every(w=>!w.bold),'plain numeric source glyphs do not acquire emphasis');
  assert.equal(result.words.map(w=>w.text).join(''),text);assert(Math.abs(result.size-20)<.75);
  assert.notEqual(fit({...options,allowSymbolCorrection:false})?.font,'SimSun','native typography keeps its existing candidate policy');
  assert.deepEqual(options.line,before);assert.deepEqual(pixels,source);
  if (text !== '-10-') {
    assert.equal(fit({ ...options, allowSingleNumeric: false }), null,
      'the one-distinct-digit path is a late fallback, not an initial font guess');
    assert.equal(fit({ ...options, line: { text, words: words.map(word => ({ ...word, confidence: .8 })) } }), null,
      'one distinct numeric sample needs independently confident complete glyphs');
    assert.equal(createOcrTypography(createCanvas, { nativeEvidence: true })(options), null,
      'native calibration cannot inherit this OCR-only numeric exception');
  }
  canvas.width=canvas.height=0;
}
console.log('OCR numeric footer: independent CJK source font, regular weight, size, exact text, native isolation and unchanged pixels passed.');

// The real scene pipeline must try its established neighbouring-font hint
// before admitting an otherwise unsupported one-distinct-digit label.
for (const withPeer of [true, false]) {
  const canvas=createCanvas(600,600),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,600,600);ctx.fillStyle='black';
  ctx.font='40px "SimSun"';ctx.fontKerning='none';
  const line=(text,baseline)=>{
    const words=[];let x=30;
    for(const char of text){const m=ctx.measureText(char);ctx.fillText(char,x,baseline);
      words.push({text:char,x:x-m.actualBoundingBoxLeft,y:baseline-m.actualBoundingBoxAscent,
        width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent,confidence:1});x+=m.width;}
    const left=Math.min(...words.map(w=>w.x)),top=Math.min(...words.map(w=>w.y));
    return {text,words,confidence:1,x:left,y:top,width:Math.max(...words.map(w=>w.x+w.width))-left,
      height:Math.max(...words.map(w=>w.y+w.height))-top};
  };
  const lines=[];if(withPeer)lines.push(line('本地字体',120));lines.push(line('-11-',180));
  const pixels=ctx.getImageData(0,0,600,600).data,before=pixels.slice(),calls=[];
  const fitted=prepareOcrScene({scene:{number:1,width:600,height:600,items:[],sources:[],rules:[],risks:['image-page'],characters:0},
    result:{width:600,height:600,lines},pixels,width:600,height:600,preserveGeometry:true,measurementContext:ctx,
    fitTypography:options=>{calls.push({text:options.line.text,hint:options.fontHint,single:options.allowSingleNumeric});return fit(options);}});
  const label=fitted.scene.items.find(item=>item.type==='text'&&item.text==='-11-');
  assert.equal(label?.words?.map(word=>word.text).join(''),'-11-');
  assert.deepEqual(pixels,before);
  for(const [index,word]of label.words.entries())for(const key of ['x','y','width','height'])
    assert(Math.abs(word.rect[key]-lines.at(-1).words[index][key])<=1,'the fallback keeps independently drawn source glyph bounds');
  const numeric=calls.filter(call=>call.text==='-11-');
  if(withPeer){
    assert.equal(label.font,'SimSun','the established peer font is retained even when one digit resembles several faces');
    assert(numeric.some(call=>call.hint?.font==='SimSun'),'a proven peer still supplies the font');
    assert(!numeric.some(call=>call.single===true),'successful peer calibration must not be guessed again');
  }else assert(numeric.some(call=>call.single===true),'an isolated proven numeric label receives the final fallback');
  canvas.width=canvas.height=0;
}
console.log('OCR numeric label ordering: proven neighbouring fonts win; isolated repeated digits retry only afterwards.');
