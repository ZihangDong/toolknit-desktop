import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { fixtureFonts } from './lib/pdf-word-font-fixture.mjs';
import { fitOcrLineTypography, fitOcrBracketedLabel } from '../src/features/pdf-to-word/adapters/ocr-line-typography.js';
import { createOcrTypography } from '../src/features/pdf-to-word/adapters/ocr-typography.js';
const text='Computer Self-Efficacy',source=createCanvas(500,100),ctx=source.getContext('2d');
ctx.fillStyle='white';ctx.fillRect(0,0,500,100);ctx.font='36px "Times New Roman"';ctx.fontKerning='none';ctx.fillStyle='black';ctx.fillText(text,20,60);
// Simulate a small scan's darkened antialias fringe without a font/word hint.
const data=ctx.getImageData(0,0,500,100).data;let left=500,top=100,right=0,bottom=0;
const inkAt=(x,y)=>data[(y*500+x)*4]<220;
for(let y=0;y<100;y++)for(let x=0;x<500;x++)if(inkAt(x,y)){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
const budget={remaining:4_000_000},before=budget.remaining;
const input={line:{text},tight:{x:left/3,y:top/3,width:(right-left)/3,height:(bottom-top)/3},inkAt,sx:3,sy:3,width:500,height:100,lineFitBudget:budget};
const fitted=fitOcrLineTypography(createCanvas,input);assert(fitted);assert(fitted.ocrLineTypography);
assert.equal(fitted.font,'Times New Roman');assert.equal(fitted.bold,false);
assert.equal(new Set(fitted.words.map(w=>w.font)).size,1);assert.equal(new Set(fitted.words.map(w=>w.size)).size,1);
assert.equal(new Set(fitted.words.map(w=>w.baseline)).size,1);assert(Math.abs(fitted.baseline-20)<.5);
assert(Math.abs(fitted.size-12)<1);assert.equal(fitted.words.map(w=>w.text).join(''),text.replaceAll(' ',''));
assert(budget.remaining>=0&&budget.remaining<before);
assert.equal(fitOcrLineTypography(createCanvas,{...input,line:{text:'Unrelated source text'}}),null,'a similar-sized box does not prove unrelated glyphs');
assert.equal(fitOcrLineTypography(createCanvas,{...input,line:{text:'中文字样'}}),null,'Latin line evidence cannot replace the independent CJK path');
assert.equal(fitOcrLineTypography(createCanvas,{...input,lineFitBudget:{remaining:0}}),null,'exhausted page budget retains existing typography');

function labelFixture(value='（二）',font='SimSun'){
 const canvas=createCanvas(250,120),context=canvas.getContext('2d');
 context.fillStyle='white';context.fillRect(0,0,250,120);context.fillStyle='black';context.font=`50px "${font}"`;
 for(const [i,c]of [...value].entries())context.fillText(c,20+i*70,80);
 const pixels=context.getImageData(0,0,250,120).data,inkAt=(x,y)=>pixels[(y*250+x)*4]<220;
 const chars=[...value].map((text,i)=>{
  let x=250,y=120,right=0,bottom=0;
  for(let yy=0;yy<120;yy++)for(let xx=15+i*70;xx<80+i*70;xx++)if(inkAt(xx,yy)){
   x=Math.min(x,xx);y=Math.min(y,yy);right=Math.max(right,xx+1);bottom=Math.max(bottom,yy+1);
  }
  return{text,rect:{x:x/3,y:y/3,width:(right-x)/3,height:(bottom-y)/3}};
 });
 const x=Math.min(...chars.map(c=>c.rect.x)),y=Math.min(...chars.map(c=>c.rect.y));
 const tight={x,y,width:Math.max(...chars.map(c=>c.rect.x+c.rect.width))-x,height:Math.max(...chars.map(c=>c.rect.y+c.rect.height))-y};
 return{canvas,pixels,chars,ordered:chars.map(c=>({text:c.text,confidence:.999})),line:{text:value,confidence:.96},tight,
  width:250,height:120,sx:3,sy:3,inkAt,fonts:['SimSun','SimHei','Microsoft YaHei','FangSong','KaiTi'],weights:[false,true],lineFitBudget:{remaining:4_000_000}};
}
for(const font of fixtureFonts(['SimSun','FangSong','Microsoft YaHei']))for(const value of ['（一）','（二）','（三）','（四）','（五）','（十）']){
 const f=labelFixture(value,font),saved=structuredClone(f.chars);
 const result=fitOcrBracketedLabel(createCanvas,f);
 assert(result?.ocrShortLabelFit,`${font} ${value} retains its three complete source glyphs`);
 assert.equal(result.words.map(w=>w.text).join(''),value);assert(result.ocrFontScore>=.93);
 assert.deepEqual(result.words.map(w=>w.rect),saved.map(w=>w.rect));assert.deepEqual(f.chars,saved);
 assert(result.words.every(w=>w.preciseInk&&w.ocrGlyphScore>=.85));
 f.canvas.width=f.canvas.height=0;
}
const label=labelFixture(),raw={...label.line,words:label.chars.map(c=>({text:c.text,confidence:.999,
 x:(c.rect.x+c.rect.width/2)*3-3,y:20,width:6,height:70}))};
const actual=createOcrTypography(createCanvas)({...label,line:raw,allowLineFit:true,allowSymbolCorrection:true});
assert(actual?.ocrShortLabelFit,'the real typography entry must calibrate short labels without borrowing a neighbouring face');
assert.equal(actual.font,'SimSun');assert.equal(actual.words.length,3);
for(const value of ['（一）','（三）','（四）','（五）','（六）','（七）','（八）','（九）','（十）']){
 const f=labelFixture('（二）');f.line.text=value;f.chars[1].text=[...value][1];f.ordered[1].text=[...value][1];
 assert.equal(fitOcrBracketedLabel(createCanvas,f),null,'full source shape and font scale reject another numeral: '+value);
 f.canvas.width=f.canvas.height=0;
}
for(const change of [
 f=>{f.lineFitBudget.remaining=0;},f=>{f.ordered[1].confidence=.8;},f=>{f.chars[1].rect.width/=2;},
 f=>{f.chars[2].rect.x=f.chars[1].rect.x;},f=>{f.chars.pop();},f=>{f.fonts=['UnknownFace'];},
 f=>{f.line.text='（文字）';},f=>{f.chars[1].ruling={axis:'h'};},
]){const f=labelFixture();change(f);assert.equal(fitOcrBracketedLabel(createCanvas,f),null);f.canvas.width=f.canvas.height=0;}
label.canvas.width=label.canvas.height=0;
assert.equal(fitOcrLineTypography(createCanvas,{...input,inkAt:()=>true}),null,'solid artwork cannot be assigned a font');
assert.equal(fitOcrLineTypography(createCanvas,{...input,inkAt:()=>false}),null,'empty pixels cannot prove a line');
source.width=source.height=0;
console.log('OCR whole-line typography: source ink, uniform face/size/baseline, unchanged spelling, uncertain/CJK fallback and page work budget passed.');
