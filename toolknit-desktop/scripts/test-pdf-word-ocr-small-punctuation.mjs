import assert from 'node:assert/strict';
import {createCanvas,ImageData} from '@napi-rs/canvas';
import {fitIsolatedLatinPunctuation,refinePreparedLatinPunctuation} from '../src/features/pdf-to-word/adapters/ocr-small-punctuation.js';

// Independent actual Canvas metrics for the injectable existing-glyph contract.
// No FontFace/global availability flag and no private/source-document fixtures.
function metricProvider(){
 const cache=new Map();
 return (text,font,bold,budget)=>{
  const key=JSON.stringify([text,font,bold]);if(cache.has(key))return cache.get(key);
  if(budget.pixelsRemaining<35200)return null;budget.pixelsRemaining-=35200;
  const c=createCanvas(220,160),x=c.getContext('2d');
  try{
   x.font=`${bold?'bold ':''}100px "${font}"`;x.fontKerning='none';const m=x.measureText(text),left=Math.ceil(m.actualBoundingBoxLeft),asc=Math.ceil(m.actualBoundingBoxAscent);
   const w=Math.ceil(m.actualBoundingBoxLeft+m.actualBoundingBoxRight),h=asc+Math.ceil(m.actualBoundingBoxDescent);if(w<1||h<1||w>200||h>140)return null;
   x.fillStyle='black';x.fillText(text,left,asc);const rgba=x.getImageData(0,0,w,h).data,mask=new Uint8Array(1024);
   for(let yy=0;yy<32;yy++)for(let xx=0;xx<32;xx++)mask[yy*32+xx]=rgba[(Math.min(h-1,Math.floor(yy*h/32))*w+Math.min(w-1,Math.floor(xx*w/32)))*4+3]>100?1:0;
   x.font=`${bold?'bold ':''}1000px "${font}"`;const f=x.measureText(text),g={mask,outline:{width:(f.actualBoundingBoxLeft+f.actualBoundingBoxRight)/10,height:(f.actualBoundingBoxAscent+f.actualBoundingBoxDescent)/10,ascent:f.actualBoundingBoxAscent/10,descent:f.actualBoundingBoxDescent/10}};
   cache.set(key,g);return g;
  }finally{c.width=c.height=1;}
 };
}

let passed=0;const checks=[];
function test(name,fn){fn();passed++;checks.push(name);}
function fixture(mark='.',font='Calibri',size=20,scale=3){
 const phrase=mark==='.'?'AF.60 SAME TEXT':mark==='-'?'AB8-8 SAME TEXT':'ABCD,EFGH';
 const c=createCanvas(1500,200),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='black';ctx.fontKerning='none';ctx.font=`${size*scale}px "${font}"`;
 const words=[];let x=20;const baseline=100;
 for(const text of phrase){const m=ctx.measureText(text);ctx.fillText(text,x,baseline);if(text.trim())words.push({text,font,fontFamily:font,bold:false,size,baseline:baseline/scale,
  baselineX:x/scale,glyphScale:100,preciseInk:true,confidence:.99,ocrGlyphScore:.95,sourceTag:'preserve-me',
  rect:{x:(x-m.actualBoundingBoxLeft)/scale,y:(baseline-m.actualBoundingBoxAscent)/scale,width:(m.actualBoundingBoxLeft+m.actualBoundingBoxRight)/scale,height:(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)/scale}});x+=m.width;}
 const index=words.findIndex(w=>w.text===mark),correct=structuredClone(words[index]),prev=words[index-1];
 const old=words[index];old.rect={x:prev.rect.x+prev.rect.width*.75,y:prev.rect.y,width:correct.rect.x+correct.rect.width-(prev.rect.x+prev.rect.width*.75),height:Math.max(prev.rect.height,correct.rect.y+correct.rect.height-prev.rect.y)};
 ctx.font=`1000px "${font}"`;const m=ctx.measureText(mark);old.size=Math.min(120,old.rect.height*1000/(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent));old.ocrGlyphScore=.1;
 const pixels=ctx.getImageData(0,0,c.width,c.height).data;c.width=c.height=0;
 return {mark,index,correct,options:{line:{text:phrase},words,pixels,width:1500,height:200,sx:scale,sy:scale,budget:{remaining:100000,pixelsRemaining:4000000},glyph:metricProvider(),
  inkAt:(x,y)=>Math.min(pixels[(y*1500+x)*4],pixels[(y*1500+x)*4+1],pixels[(y*1500+x)*4+2])<220}};
}
for(const font of ['Arial','Calibri','Times New Roman','Cambria'])for(const mark of ['.',',','-'])for(const scale of [3,4])test(`isolated ${font}/${mark}/${scale}`,()=>{
 const f=fixture(mark,font,20,scale),before=structuredClone(f.options.words),p=f.options.pixels.slice();
 const result=fitIsolatedLatinPunctuation(createCanvas,f.options),actual=result?.words[f.index];
 assert(actual?.ocrSmallPunctuationFit,`${font}/${mark}/${scale} has a real supported template: actual original-ink template`);
 assert.equal(actual.text,mark);assert.equal(actual.font,font);assert(Math.abs(actual.size-20)<=2);
 for(const axis of ['x','y'])assert(Math.abs(actual.rect[axis]-f.correct.rect[axis])<=.6);
 assert.deepEqual(f.options.words,before);assert.deepEqual(f.options.pixels,p);assert.equal(actual.sourceTag,'preserve-me');
 for(let i=0;i<before.length;i++)if(i!==f.index)assert.deepEqual(result.words[i],before[i]);
 assert(f.options.budget.remaining>=0&&f.options.budget.remaining<100000);assert(f.options.budget.pixelsRemaining>=0&&f.options.budget.pixelsRemaining<4000000);
});
test('good punctuation is an exact no-op',()=>{const f=fixture();f.options.words[f.index]=f.correct;assert.equal(fitIsolatedLatinPunctuation(createCanvas,f.options),null);});
for(const name of ['native input','NaN confidence','spelling mismatch','no ink','wrong literal template','unavailable face','unknown glyph metrics','fallback alias','foreign FONT','mixed peer faces','weak anchors','weak punctuation','CJK line','numeric-only line','protected rule','exhausted comparisons','exhausted pixels','oversized budget','invalid pixels','colour','alpha'])test(name,()=>{
 const f=fixture();const o=f.options;
 if(name==='native input')o.nativeEvidence=true;
 if(name==='NaN confidence')o.words[f.index].confidence=NaN;
 if(name==='spelling mismatch')o.line.text+='Z';
 if(name==='no ink'){o.inkAt=()=>false;o.pixels.fill(255);}
 if(name==='wrong literal template'){o.words[f.index].text='-';o.line.text=o.line.text.replace('.','-');}
 if(name==='unavailable face')o.glyph=()=>null;
 if(name==='unknown glyph metrics')o.glyph=()=>({mask:new Uint8Array(1024),outline:{width:1,height:1,ascent:1,descent:0}});
 if(name==='fallback alias'){const g=o.glyph;o.glyph=(text,font,bold,budget)=>g(text,'Calibri',bold,budget);}
 if(name==='foreign FONT')o.words[f.index].font='FONTForeignUnverified';
 if(name==='colour')for(let i=0;i<o.pixels.length;i+=4)if(o.pixels[i]<220){o.pixels[i]=0;o.pixels[i+1]=50;o.pixels[i+2]=180;}
 if(name==='alpha')for(let i=0;i<o.pixels.length;i+=4)if(o.pixels[i]<220)o.pixels[i+3]=100;
 if(name==='mixed peer faces')for(let i=f.index+1;i<o.words.length;i++)o.words[i].font='Arial';
 if(name==='weak anchors')for(let i=0;i<o.words.length;i++)if(i!==f.index)o.words[i].ocrGlyphScore=.4;
 if(name==='weak punctuation')o.words[f.index].confidence=.6;
 if(name==='CJK line'){o.words[0].text='中';o.line.text=o.words.map(w=>w.text).join('');}
 if(name==='numeric-only line'){o.words=o.words.map((w,i)=>({...w,text:i===f.index?'-':String(i%10)}));o.line.text=o.words.map(w=>w.text).join('');}
 if(name==='protected rule'){const r=o.words[f.index].rect;o.protectedRules=[{axis:'h',at:(r.y+r.height)*3,from:r.x*3,to:(r.x+r.width)*3}];}
 if(name==='exhausted comparisons')o.budget.remaining=0;
 if(name==='exhausted pixels')o.budget.pixelsRemaining=1;
 if(name==='oversized budget')o.budget.pixelsRemaining=4000001;
 if(name==='invalid pixels')o.pixels=new Uint8ClampedArray(4);
 const before=structuredClone(o.words),budgetBefore={...o.budget};assert.equal(fitIsolatedLatinPunctuation(createCanvas,o),null,name);assert.deepEqual(o.words,before);
 if(['native input','CJK line','numeric-only line'].includes(name))assert.deepEqual(o.budget,budgetBefore,'protected typography does not consume repair allowance');
});
test('genuinely large punctuation cannot be clamped to body size',()=>{
 const f=fixture();f.options.words[f.index].rect={...f.options.words[f.index].rect,width:20,height:20};
 // The source pixels contain no giant punctuation template; a large mark is
 // tested independently by rendering it at 60pt into the otherwise blank ROI.
 const o=f.options,c=createCanvas(o.width,o.height),x=c.getContext('2d');x.putImageData(new ImageData(o.pixels,o.width,o.height),0,0);
 x.fillStyle='white';x.fillRect(f.correct.rect.x*3-2,15,65,130);x.font='180px "Calibri"';x.fillStyle='black';x.fillText('.',f.correct.baselineX*3,100);
 o.pixels=x.getImageData(0,0,c.width,c.height).data;o.inkAt=(xx,yy)=>o.pixels[(yy*o.width+xx)*4]<220;
 assert.equal(fitIsolatedLatinPunctuation(createCanvas,o),null,'large source ink must not be silently shrunk');c.width=c.height=0;
});
test('two equally supported source components remain ambiguous',()=>{
 const f=fixture(),o=f.options,c=createCanvas(o.width,o.height),x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='black';x.font='60px "Calibri"';
 const start=f.correct.baselineX*3;x.fillText('.',start,100);x.fillText('.',start+16,100);
 for(let i=f.index+1;i<o.words.length;i++){o.words[i].rect.x+=12;o.words[i].baselineX+=12;}
 o.words[f.index].rect={x:start/3-1,y:18,width:12,height:16};o.pixels=x.getImageData(0,0,c.width,c.height).data;o.inkAt=(xx,yy)=>o.pixels[(yy*o.width+xx)*4]<220;
 assert.equal(fitIsolatedLatinPunctuation(createCanvas,o),null,'do not pick a punctuation component by proximity');c.width=c.height=0;
});
test('clipped punctuation cannot acquire a complete-ink certificate',()=>{
 const f=fixture(),o=f.options;const target=f.correct.rect;o.width=Math.floor((target.x+target.width*.5)*3);
 const clipped=new Uint8ClampedArray(o.width*o.height*4);
 for(let y=0;y<o.height;y++)clipped.set(o.pixels.subarray(y*1500*4,(y*1500+o.width)*4),y*o.width*4);
 o.pixels=clipped;o.inkAt=(x,y)=>o.pixels[(y*o.width+x)*4]<220;assert.equal(fitIsolatedLatinPunctuation(createCanvas,o),null);
});
test('allocated canvases are bounded and released',()=>{
 const f=fixture(),held=[];const tracked=(w,h)=>{assert(w*h<=20000);const c=createCanvas(w,h);held.push(c);return c;};
 assert(fitIsolatedLatinPunctuation(tracked,f.options));assert(held.length>0);assert(held.every(c=>c.width===1&&c.height===1),'Napi canvas treats zero as its default size; 1x1 releases the large backing surface');
});
test('cancellation before work preserves source inputs',()=>{
 const f=fixture(),words=structuredClone(f.options.words),pixels=f.options.pixels.slice();let allocations=0;
 assert.throws(()=>fitIsolatedLatinPunctuation((w,h)=>{allocations++;return createCanvas(w,h);},{...f.options,check:()=>{throw Error('cancelled');}}),/cancelled/);
 assert.equal(allocations,0);assert.deepEqual(f.options.words,words);assert.deepEqual(f.options.pixels,pixels);
});
test('cancellation during painting releases surfaces without committing',()=>{
 const f=fixture(),words=structuredClone(f.options.words),pixels=f.options.pixels.slice(),held=[];let stop=false;
 assert.throws(()=>fitIsolatedLatinPunctuation((w,h)=>{const c=createCanvas(w,h);held.push(c);return c;},{...f.options,
  check:()=>{if(held.some(c=>c.width>1&&c.height>1))throw Error('cancelled');}}),/cancelled/);
 assert(held.length>0&&held.every(c=>c.width===1&&c.height===1));assert.deepEqual(f.options.words,words);assert.deepEqual(f.options.pixels,pixels);
 assert(f.options.budget.remaining<100000&&f.options.budget.pixelsRemaining<4000000,'cancellation rolls back state, never spent work');
});
for(const exhausted of ['remaining','pixelsRemaining'])test(`budget exhausted after first paint rejects incomplete search: ${exhausted}`,()=>{
 const f=fixture(),o=f.options,before=structuredClone(o.words),pixels=o.pixels.slice(),held=[];let paints=0;
 const tracked=(w,h)=>{
  const c=createCanvas(w,h);held.push(c);
  if(w>1&&h>1){const x=c.getContext('2d'),draw=x.fillText.bind(x);x.fillText=(...args)=>{draw(...args);paints++;o.budget[exhausted]=0;};}
  return c;
 };
 assert.equal(fitIsolatedLatinPunctuation(tracked,o),null,'a best-so-far candidate cannot certify a completed search');
 assert.equal(paints,1);assert.equal(o.budget[exhausted],0,'spent budget is never restored or upgraded');
 assert(held.every(c=>c.width===1&&c.height===1));assert.deepEqual(o.words,before);assert.deepEqual(o.pixels,pixels);
});
test('post-table adapter preserves table/native/CJK/numeric/math and all provenance',()=>{
 const f=fixture(),o=f.options,id='ordinary',target={id,type:'text',ocr:true,sourceIds:[id],text:o.line.text,color:'000000',words:o.words};
 const table={id:'table',type:'table',cells:[{blocks:[{lines:[{items:[structuredClone(target)]}]}]}]};
 const native={...structuredClone(target),id:'native',ocrNative:true,sourceIds:['native']};
 const han={...structuredClone(target),id:'han',text:'中文'+target.text,sourceIds:['han']};
 const number={...structuredClone(target),id:'number',text:'123-456',sourceIds:['number']};
 const math={...structuredClone(target),id:'math',role:'math',sourceIds:['math']};
 const items=[target,table,native,han,number,math],sources=items.filter(i=>i.type==='text').map(i=>({id:i.id,text:i.text,rect:{x:1,y:1,width:100,height:30},disposition:'editable'}));
 const scene={number:1,width:o.width/o.sx,height:o.height/o.sy,items,sources,rules:[],characters:321,risks:['ocr-low-confidence']},clean=o.pixels.slice(),prepared={scene,pixels:clean,changed:true};
 const before=structuredClone(prepared),result=refinePreparedLatinPunctuation(createCanvas,prepared,{...o});
 assert(result!==prepared);assert(result.scene.items[0]!==target);for(let i=1;i<items.length;i++)assert.deepEqual(result.scene.items[i],items[i]);
 assert.deepEqual(result.scene.sources,sources);assert.equal(result.scene.sources,sources);assert.equal(result.scene.rules,scene.rules);assert.equal(result.pixels,clean);
 for(const key of ['number','width','height','characters','risks'])assert.deepEqual(result.scene[key],scene[key]);assert.deepEqual(prepared,before);
});



console.log(JSON.stringify({passed,checks,scope:'Synthetic original-ink and state invariants; no document/reader vote.'}));
