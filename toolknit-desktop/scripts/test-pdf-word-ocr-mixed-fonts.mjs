import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {fixtureFonts} from './lib/pdf-word-font-fixture.mjs';
import {createOcrTypography} from '../src/features/pdf-to-word/adapters/ocr-typography.js';
import {prepareOcrScene} from '../src/features/pdf-to-word/core/ocr-scene.js';

for(const color of ['#2E74B5','#000000']){
  const phrase='监测中心2026年6月29日19时50分发布预警';
  const canvas=createCanvas(1800,180),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,1800,180);ctx.fontKerning='none';
  const words=[],expected=[];let x=25,groupStart=0,inNumber=false,numberIndex=0;
  for(const char of phrase){
    const latin=/[0-9]/u.test(char);
    ctx.font=latin?'bold 60px "Times New Roman"':'60px "Microsoft YaHei"';
    ctx.fillStyle=color;const m=ctx.measureText(char);ctx.fillText(char,x,115);
    expected.push({text:char,x:x-m.actualBoundingBoxLeft,y:115-m.actualBoundingBoxAscent,
      width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent});
    if(latin&&!inNumber){groupStart=x;numberIndex=0;}
    const center=latin?groupStart+m.width*(.4+numberIndex++*.5):x+m.width*.5;
    words.push({text:char,x:center-2,y:55,width:4,height:65,confidence:.99});
    x+=m.width;inNumber=latin;
  }
  const left=Math.min(...expected.map(c=>c.x)),top=Math.min(...expected.map(c=>c.y));
  const right=Math.max(...expected.map(c=>c.x+c.width)),bottom=Math.max(...expected.map(c=>c.y+c.height));
  const line={text:phrase,x:left,y:top,width:right-left,height:bottom-top,words,confidence:.8},before=structuredClone(line);
  const pixels=ctx.getImageData(0,0,1800,180).data,fit=createOcrTypography(createCanvas);
  const options={line,pixels,width:1800,height:180,sx:3,sy:3,allowSymbolCorrection:true,requireColorEvidence:color!=='#000000',
    tight:{x:left/3,y:top/3,width:(right-left)/3,height:(bottom-top)/3},inkAt:(x,y)=>pixels[(y*1800+x)*4+2]<230};
  const budget={remaining:100000},result=fit({...options,alignmentBudget:budget});
  assert(result?.words?.length,'a mixed-font date needs complete source-ink ownership');
  assert.equal(result.words.map(w=>w.text).join(''),phrase);
  for(const [i,word]of result.words.entries())for(const key of ['x','y','width','height'])
    assert(Math.abs(word.rect[key]-expected[i][key]/3)<.7,`mixed date glyph${i}/${key}`);
  assert(result.ocrFontScore>=.72);assert(budget.remaining>=0&&budget.remaining<100000);
  const digits=result.words.filter(w=>/^[0-9]$/u.test(w.text));
  assert.equal(new Set(digits.map(w=>`${w.font}/${w.bold}`)).size,1,'one proven numeric face serves the entire mixed line');
  assert(digits.every(w=>w.bold),'genuine numeric emphasis survives');
  assert.deepEqual(line,before);
  assert(!fit({...options,allowSymbolCorrection:false,alignmentBudget:{remaining:100000}})?.ocrGlyphAlignment,
    'known native typography never enters the OCR mixed-script repair');
  assert(!fit({...options,alignmentBudget:{remaining:1}})?.ocrGlyphAlignment,'an exhausted search cannot claim a new alignment');
  const scene=prepareOcrScene({scene:{number:1,width:600,height:60,items:[],sources:[],rules:[],risks:['image-page'],characters:0},
    result:{width:1800,height:180,lines:[line]},pixels,width:1800,height:180,preserveGeometry:true,measurementContext:ctx,fitTypography:fit});
  const editable=scene.scene.items.find(item=>item.type==='text');
  assert.equal(editable?.text,phrase);assert.equal(editable.words.length,words.length);
  assert.equal(scene.scene.sources.filter(s=>s.disposition==='visible-image').length,0);
  let residual=0;
  for(let y=Math.floor(top);y<Math.ceil(bottom);y++)for(let x=Math.floor(left);x<Math.ceil(right);x++)
    if(Math.min(...scene.pixels.slice((y*1800+x)*4,(y*1800+x)*4+3))<180)residual++;
  assert.equal(residual,0,'the full original text is removed before mixed editable runs are painted');
  canvas.width=canvas.height=0;
}
for(const font of fixtureFonts(['FangSong','SimSun','Microsoft YaHei']))for(const phrase of ['甲方（用人单位）：乙方（劳动者）：','Test（2026）：09']){
 const c=createCanvas(1500,160),ctx=c.getContext('2d');
 ctx.fillStyle='white';ctx.fillRect(0,0,1500,160);ctx.fillStyle='black';ctx.font=`60px "${font}"`;ctx.fontKerning='none';
 const words=[];let x=20;
 for(const text of phrase){const m=ctx.measureText(text);ctx.fillText(text,x,110);
  words.push({text,x:x+m.width*.45,y:45,width:4,height:70,confidence:.99});x+=m.width;}
 const p=ctx.getImageData(0,0,1500,160).data;
 const out=createOcrTypography(createCanvas)({line:{text:phrase,words,x:20,y:45,width:x-20,height:70,confidence:.99},
  pixels:p,width:1500,height:160,sx:3,sy:3,tight:{x:20/3,y:45/3,width:(x-20)/3,height:70/3},inkAt:(x,y)=>p[(y*1500+x)*4]<180,
  allowSymbolCorrection:true,alignmentBudget:{remaining:100000,pixelsRemaining:4e6}});
 assert.equal(out.words.map(w=>w.text).join(''),phrase);
 assert(out.words.filter(w=>/[（）：]/u.test(w.text)).every(w=>!['Arial','Times New Roman','Calibri'].includes(w.font)),
  'fullwidth CJK punctuation never relies on an implicit Latin-font substitution');
 c.width=c.height=0;
}
console.log('OCR mixed fonts: source ownership, Chinese/numeric styles, explicit CJK punctuation faces, erasure, native isolation and bounded failure passed.');
