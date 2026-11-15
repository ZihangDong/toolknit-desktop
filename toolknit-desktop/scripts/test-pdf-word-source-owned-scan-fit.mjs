import assert from'node:assert/strict';import{createCanvas}from'@napi-rs/canvas';
import{fitSourceOwnedScanGlyphs}from'../src/features/pdf-to-word/adapters/source-owned-scan-fit.js';
import{inferDocument}from'../src/features/pdf-to-word/core/layout.js';
import{drawResultText}from'../src/features/pdf-to-word/adapters/text-rendering.js';
const scale=4;
function fixture(text='田',bold=false) {
 const c=createCanvas(960,480),ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,960,480);
 ctx.fillStyle='#000';ctx.font=`${bold?'bold ':''}56px "SimSun"`;ctx.fontKerning='none';ctx.fillText(text,120,240);ctx.fillText('林',344,240);
 const pixels=ctx.getImageData(0,0,960,480).data;
 function box(left,end){let x=end,y=480,r=left,b=0;for(let yy=0;yy<480;yy++)for(let xx=left;xx<end;xx++){const i=(yy*960+xx)*4;if(Math.min(pixels[i],pixels[i+1],pixels[i+2])<180){x=Math.min(x,xx);y=Math.min(y,yy);r=Math.max(r,xx+1);b=Math.max(b,yy+1)}}return{x:x/4,y:y/4,width:(r-x)/4,height:(b-y)/4};}
 const source=box(0,280),next=box(280,600),r={x:source.x-1,y:source.y-1,width:source.width+2.5,height:source.height+2.5};
 const word={text,rect:r,size:14,baseline:60,baselineX:r.x,advanceWidth:r.width,font:'SimSun',fontFamily:'SimSun',bold,italic:false,color:'000000',glyphScale:100,confidence:.9999,ocrGlyphScore:.8,preciseInk:true};
 const neighbour={...word,text:'林',rect:next,size:14,baselineX:next.x,advanceWidth:next.width,ocrGlyphScore:.98};
 const rect={x:r.x,y:Math.min(r.y,next.y),width:next.x+next.width-r.x,height:Math.max(r.y+r.height,next.y+next.height)-Math.min(r.y,next.y)};
 const item={id:'synthetic-source',type:'text',sourceIds:['synthetic-source'],text:text+'林',rect,baseline:60,baselineX:rect.x,size:14,font:'SimSun',fontFamily:'SimSun',bold,italic:false,color:'000000',ocr:true,raster:false,preciseInk:true,ocrFontScore:.9,words:[word,neighbour]};
 const scene={number:1,width:240,height:120,items:[item],sources:[{id:item.id,text:item.text,rect:{...rect},disposition:'editable'}],rules:[],risks:['ocr'],characters:2};
 c.width=c.height=0;return{scene,data:{pixels,width:960,height:480},item,word,neighbour,source};
}
const owned=[];
function canvas(w,h){const c=createCanvas(w,h),state={};for(const axis of['width','height']){const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(c),axis);Object.defineProperty(c,axis,{get:()=>d.get.call(c),set:v=>{state[axis]=v;d.set.call(c,v)}})}owned.push(state);return c;}
function fit(s,o={}){const allowance=o.allowance||{remaining:4e6};fitSourceOwnedScanGlyphs({scene:s.scene,data:s.data,createCanvas:o.createCanvas||canvas,accepted:o.accepted||new Set(),allowance,maxChanges:o.maxChanges??128,check:o.check||(()=>{})});assert(allowance.remaining>=0&&allowance.remaining<=4e6);return allowance;}
function render(s){const c=createCanvas(960,480),ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,960,480);ctx.setTransform(4,0,0,4,0,0);drawResultText(inferDocument([s.scene],{preserveGeometry:true}).pages[0],ctx);const out=ctx.getImageData(0,0,960,480).data;c.width=c.height=0;return out;}
function f1(s,out){const r=s.source,x=Math.floor((r.x-3)*4),y=Math.floor((r.y-3)*4),rr=Math.ceil((r.x+r.width+3)*4),bb=Math.ceil((r.y+r.height+3)*4);let a=0,b=0,both=0;for(let yy=y;yy<bb;yy++)for(let xx=x;xx<rr;xx++){const i=(yy*960+xx)*4,left=Math.min(...s.data.pixels.subarray(i,i+3))<180,right=Math.min(...out.subarray(i,i+3))<180;a+=left;b+=right;both+=left&&right}return return2(both,a,b);}
function return2(common,a,b){return 2*common/Math.max(1,a+b);}
const semantic=w=>Object.fromEntries(Object.entries(w).filter(([k])=>!['rect','glyphScale','ocrPhysicalFit'].includes(k)));
let checks=0;const cases=[];
for(const[text,bold]of[['田',false],['利',false],['田',true],['森',false]]) {
 const s=fixture(text,bold),before=structuredClone(s.scene),pixels=s.data.pixels.slice(),old=render(s),oldF1=f1(s,old),style=semantic(s.word),neighbour=structuredClone(s.neighbour);
 const budget=fit(s),after=render(s);assert(s.word.ocrPhysicalFit,'independent connected/multipart/emphasized source fit');
 assert.equal(s.word.ocrPhysicalFit.phase,'source-owned-independent');assert(f1(s,after)>=Math.max(.75,oldF1+.05));
 assert.deepEqual(semantic(s.word),style);assert.deepEqual(s.neighbour,neighbour);assert.deepEqual(s.scene.sources,before.sources);assert.deepEqual(s.scene.rules,before.rules);assert.deepEqual(s.data.pixels,pixels);
 for(let y=0;y<480;y++)assert.deepEqual(after.subarray((y*960+300)*4,(y*960+600)*4),old.subarray((y*960+300)*4,(y*960+600)*4),'neighbour actual render pixel exact');
 assert(budget.remaining<4e6);cases.push({text,bold,beforeF1:oldF1,afterF1:f1(s,after),remaining:budget.remaining});checks++;
}
for(const[name,change]of[
 ['low-confidence',s=>s.word.confidence=.979999],['low-parent-score',s=>s.item.ocrFontScore=.649999],
 ['high-signature-score',s=>s.word.ocrGlyphScore=.9],['italic',s=>s.word.italic=true],['native',s=>s.item.ocrNative=true],
 ['generated-font',s=>s.word.fontAssetId='existing-font'],['already-accepted-fit',s=>s.word.ocrPhysicalFit={phase:'old'}],
 ['ruling',s=>s.word.ocrRuling=true],['non-Han',s=>s.word.text=';'],['bad-parent',s=>s.item.preciseInk=false],
 ['source-text-mismatch',s=>s.scene.sources[0].text='different'],['raster-source',s=>s.scene.sources[0].disposition='visible-image'],
 ['ambiguous-neighbour',s=>s.neighbour.rect={...s.word.rect}],
 ['rule-contact',s=>s.scene.rules.push({axis:'h',at:s.source.y+s.source.height/2,from:0,to:120})],
 ['partial-source-crop',s=>s.word.rect.height-=s.word.rect.height/2],
 ['source-outside-parent',s=>s.item.rect={...s.word.rect,width:1,height:1}],
 ['source-outside-ledger',s=>s.scene.sources[0].rect={...s.word.rect,width:1,height:1}],
 ['ordinary-table',s=>s.scene.items=[{type:'table',cells:[{blocks:[s.item]}]}]],
 ['AI-option-grid',s=>s.scene.items=[{type:'option-grid',cells:[{blocks:[s.item]}]}]],
 ['colored-source',s=>{for(let i=0;i<s.data.pixels.length;i+=4)if(s.data.pixels[i]<180){s.data.pixels[i]=0;s.data.pixels[i+1]=100;s.data.pixels[i+2]=0}}],
 ['detached-source-speck',s=>{const x=Math.floor((s.word.rect.x+.5)*4),y=Math.floor((s.word.rect.y+.5)*4),at=(y*960+x)*4;s.data.pixels[at]=s.data.pixels[at+1]=s.data.pixels[at+2]=0}]
]){const s=fixture();change(s);const before=structuredClone(s.scene);fit(s);assert.deepEqual(s.scene,before,name+' declines without changing source/scene');checks++;}
for(const amount of[0,1,100,5000]){const s=fixture(),before=structuredClone(s.scene);fit(s,{allowance:{remaining:amount}});assert.deepEqual(s.scene,before,'bounded remainder cannot be replenished');checks++;}
{const s=fixture(),before=structuredClone(s.scene);fit(s,{maxChanges:0});assert.deepEqual(s.scene,before);checks++;}
{const s=fixture(),before=structuredClone(s.scene);fit(s,{accepted:new Set([s.word])});assert.deepEqual(s.scene,before);checks++;}
{const s=fixture(),before=structuredClone(s.scene);let calls=0;assert.throws(()=>fit(s,{check:()=>{if(++calls>4)throw Error('cancelled')}}),/cancelled/);assert.deepEqual(s.scene,before);checks++;}
function sourceCache(sample) {
 const result=new Map();
 for(const word of sample.item.words) {
  const r=word.rect,x=Math.max(0,Math.floor((r.x-.4)*4)),y=Math.max(0,Math.floor((r.y-.4)*4));
  const w=Math.min(960,Math.ceil((r.x+r.width+.4)*4))-x,h=Math.min(480,Math.ceil((r.y+r.height+.4)*4))-y;
  const mask=new Uint8Array(w*h);let ink=0,bx=w,by=h,br=0,bb=0;
  for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){const at=((y+yy)*960+x+xx)*4;if(Math.min(...sample.data.pixels.subarray(at,at+3))<180){mask[yy*w+xx]=1;ink++;bx=Math.min(bx,xx);by=Math.min(by,yy);br=Math.max(br,xx+1);bb=Math.max(bb,yy+1)}}
  result.set(word,{x,y,w,h,mask,ink,bx,by,br,bb,color:false,rectKey:JSON.stringify(r),tight:{x:(x+bx)/4,y:(y+by)/4,width:(br-bx)/4,height:(bb-by)/4}});
 }
 return result;
}
function cachedFit(sample,samples,options={}) {
 const allowance=options.allowance||{remaining:4e6};
 fitSourceOwnedScanGlyphs({scene:sample.scene,data:sample.data,createCanvas:canvas,accepted:new Set(),allowance,
   maxChanges:options.maxChanges??128,check:()=>{},samples});
 assert(allowance.remaining>=0&&allowance.remaining<=4e6);return{allowance};
}
{const s=fixture(),samples=sourceCache(s),original=s.data.pixels;let reads=0;
 s.data.pixels=new Proxy(original,{get(target,key){if(typeof key==='string'&&/^\d+$/.test(key))reads++;return Reflect.get(target,key,target)}});
 const result=cachedFit(s,samples);assert(s.word.ocrPhysicalFit);assert.equal(reads,0,'paid complete source mask is reused with no new sourceRGBA scan');
 assert(result.allowance.remaining<4e6);checks++;}
{const s=fixture(),samples=sourceCache(s);s.word.rect.x-=.1;const before=structuredClone(s.scene),result=cachedFit(s,samples);assert.deepEqual(s.scene,before);checks++;}
{const s=fixture(),before=structuredClone(s.scene),result=cachedFit(s,new Map());assert.deepEqual(s.scene,before);assert.equal(result.allowance.remaining,4e6);checks++;}
for(const confidence of[.98,.985,.989999]){
 const s=fixture(),before=structuredClone(s.scene),pixels=s.data.pixels.slice();s.word.confidence=confidence;
 const original=structuredClone(s.word),neighbour=structuredClone(s.neighbour),prior=f1(s,render(s));
 cachedFit(s,new Map());
 assert(s.word.ocrPhysicalFit,'ordinary lower-confidence glyph pays for its own complete sample');
 assert.equal(s.word.confidence,confidence,'source confidence is never raised');
 for(const key of['text','font','fontFamily','bold','italic','baseline','baselineX','advanceWidth'])assert.deepEqual(s.word[key],original[key]);
 assert(Math.abs(s.word.size-Math.round(original.size*2)/2)<=1);
 assert(f1(s,render(s))>=Math.max(.75,prior+.05));assert.deepEqual(s.neighbour,neighbour);
 assert.deepEqual(s.scene.sources,before.sources);assert.deepEqual(s.data.pixels,pixels);checks++;
}
{const s=fixture('国');s.word.confidence=.985;s.word.rect={...s.source};s.word.size=13;
 const original=structuredClone(s.word),prior=f1(s,render(s));cachedFit(s,new Map());
 assert(s.word.ocrPhysicalFit,'an accurate source box must not hide an actual painted-size error');
 assert(Math.abs(s.word.size-13)<=1);assert(f1(s,render(s))>=Math.max(.75,prior+.05));
 assert.equal(s.word.font,original.font);assert.equal(s.word.baseline,original.baseline);checks++;}
{const s=fixture();s.word.rect={...s.source};const before=structuredClone(s.scene);
 cachedFit(s,sourceCache(s));assert.deepEqual(s.scene,before,'established high-confidence accurate-box path stays unchanged');checks++;}
{const s=fixture();s.word.confidence=.985;const samples=sourceCache(s);s.word.rect.x-=.1;const before=structuredClone(s.scene);
 cachedFit(s,samples);assert.deepEqual(s.scene,before,'lower confidence cannot reuse a stale cached source mask');checks++;}
for(const remaining of[0,1,100]){const s=fixture();s.word.confidence=.985;const before=structuredClone(s.scene);
 cachedFit(s,new Map(),{allowance:{remaining}});assert.deepEqual(s.scene,before,'supplemental sampling cannot borrow a new budget');checks++;}
{const s=fixture(),samples=sourceCache(s);samples.get(s.word).color=true;const before=structuredClone(s.scene);cachedFit(s,samples);assert.deepEqual(s.scene,before);checks++;}
{const s=fixture(),samples=sourceCache(s),before=structuredClone(s.scene);cachedFit(s,samples,{allowance:{remaining:1}});assert.deepEqual(s.scene,before);checks++;}
{const s=fixture();s.neighbour.rect={x:s.neighbour.rect.x-2,y:s.neighbour.rect.y-2,width:s.neighbour.rect.width+5,height:s.neighbour.rect.height+5};s.neighbour.size=14;s.neighbour.ocrGlyphScore=.8;
 s.item.rect={...s.item.rect,width:s.item.rect.width+6,height:s.item.rect.height+6};s.scene.sources[0].rect={...s.item.rect};
 const samples=sourceCache(s);cachedFit(s,samples,{maxChanges:1});assert(s.neighbour.ocrPhysicalFit,'later but more inflated source box is scheduled first');assert(!s.word.ocrPhysicalFit);checks++;}
assert(owned.every(s=>s.width===0&&s.height===0),'all owned canvases released');checks++;
console.log('Independent scan fitter synthetic checks passed: '+checks);
