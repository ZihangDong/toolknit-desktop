import {createRequire}from'node:module';import{createServer}from'vite';import{writeFile,mkdir}from'node:fs/promises';import path from'node:path';
const out=path.resolve('tmp/pdf-word-ocr-latin-recovery');await mkdir(out,{recursive:true});await writeFile(path.join(out,'empty.html'),'<html><body></body></html>');
const require=createRequire(process.env.TOOLKNIT_TEST_MODULES?path.join(process.env.TOOLKNIT_TEST_MODULES,'package.json'):import.meta.url);const{chromium}=require('playwright');
const plugins=[];
const server=await createServer({configFile:false,plugins,cacheDir:path.join(out,'vite'),optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0,hmr:false,watch:{ignored:['**/tmp/**','**/src-tauri/target/**','**/cli/**','**/dist/**']}},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'chrome',headless:true});
try{const page=await browser.newPage();page.on('pageerror',e=>console.log('Browser test error: '+e.message));await page.goto(server.resolvedUrls.local[0]+'tmp/pdf-word-ocr-latin-recovery/empty.html');
const result=await page.evaluate(async()=>{
 const{refineOcrLatinCharacters:refineLatinRecovery}=await import('/src/features/pdf-to-word/adapters/ocr-latin-recovery.js');
 const{inferDocument}=await import('/src/features/pdf-to-word/core/layout.js');
 const{ocrFrameLayout}=await import('/src/features/pdf-to-word/core/ocr-frame-layout.js');
 const assert=(yes,message)=>{if(!yes)throw Error(message);};const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);let tests=0;
 const fixture=(target='E',observed='e')=>{
  const width=1200,height=600,source=new OffscreenCanvas(width,height),ctx=source.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
  const real='ABCD '+target+' FGH',text='ABCD '+observed+' FGH',words=[],font='Calibri',size=12,baseline=50;ctx.font='48px "Calibri"';ctx.fontKerning='none';ctx.letterSpacing='0px';
  let x=30,wordIndex=0;
  for(const char of real){
   if(char===' '){x+=6;continue;}
   ctx.fillStyle='#000';ctx.fillText(char,x*4,baseline*4);const advance=ctx.measureText(char).width/4;
   const l=Math.floor((x-2)*4),r=Math.ceil((x+advance+2)*4),t=35*4,b=53*4,raw=ctx.getImageData(l,t,r-l,b-t).data;let bx=r,by=b,br=l,bb=t;
   for(let yy=t;yy<b;yy++)for(let xx=l;xx<r;xx++){const at=((yy-t)*(r-l)+xx-l)*4;if(raw[at]<180){bx=Math.min(bx,xx);by=Math.min(by,yy);br=Math.max(br,xx+1);bb=Math.max(bb,yy+1);}}
   assert(br>bx&&bb>by,'complete source fixture glyph');const rect={x:bx/4,y:by/4,width:(br-bx)/4,height:(bb-by)/4},wrong=wordIndex>=4&&wordIndex<4+[...target].length,model=wrong?[...observed][wordIndex-4]:char;
   const mc=new OffscreenCanvas(1,1).getContext('2d');mc.font='1000px "Calibri"';const m=mc.measureText(model),height=(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)/1000;
   words.push({text:model,rect,size:wrong&&model!==char?rect.height/height:12,baseline,baselineX:rect.x,advanceWidth:rect.width,font,fontFamily:font,bold:false,italic:false,glyphScale:100,preciseInk:true,confidence:.999,ocrGlyphScore:wrong&&model!==char?.5:.999});x+=advance+3;wordIndex++;
  }
  const first=words[0].rect,last=words.at(-1).rect,rect={x:first.x,y:Math.min(...words.map(w=>w.rect.y)),width:last.x+last.width-first.x,height:Math.max(...words.map(w=>w.rect.y+w.rect.height))-Math.min(...words.map(w=>w.rect.y))};
  const item={type:'text',id:'p1:fixture',sourceIds:['p1:fixture'],text,words,font,fontFamily:font,size,baseline,baselineX:rect.x,rect,bold:false,italic:false,ocr:true,preciseInk:true,raster:false,color:'000000',ocrFontScore:.95};
  const prepared={changed:true,pixels:new Uint8ClampedArray(width*height*4),scene:{number:1,width:300,height:150,items:[item],sources:[{id:item.id,text,rect:{...rect},order:0,disposition:'editable'}],rules:[],risks:[],characters:text.length}};
  return{prepared,data:{pixels:ctx.getImageData(0,0,width,height).data,width,height},item,word:words[4],correctText:real};
 };
 const run=(f,options={})=>{const canvases=[],budget=options.budget||{remaining:100000,pixelsRemaining:4000000};const before=structuredClone(f.prepared),pixels=f.data.pixels.slice();
  const create=(w,h)=>{if(options.failCreate&&canvases.length===1)throw Error('synthetic allocation failure');const c=new OffscreenCanvas(w,h);canvases.push(c);if(options.alias){const get=c.getContext.bind(c);c.getContext=(...args)=>{const real=get(...args);return new Proxy(real,{get(t,k){const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;},set(t,k,v){return Reflect.set(t,k,k==='font'?v.replace(/"[^"]+"/g,'"Calibri"'):v,t);}});};}return c;};
  let result,error;try{result=refineLatinRecovery(create,f.prepared,{...f.data,budget,check:options.check||(()=>{})});}catch(e){error=e;}
  assert(same(f.prepared,before),'source scene is immutable');assert(f.data.pixels.every((n,i)=>n===pixels[i]),'source RGBA immutable');assert(canvases.every(c=>!c.width&&!c.height),'all owned canvases released');assert(budget.remaining>=0&&budget.pixelsRemaining>=0,'budget never replenishes or underflows');return{result,error,budget};
 };
 const good=fixture(),first=run(good);assert(!first.error,'positive has no exception');assert(first.result.scene.items[0].text===good.correctText,'actual E recovery from isolated source pixels');assert(first.result.scene.sources[0].text===good.correctText,'coverage ledger follows explicitly corrected spelling');assert(first.result.scene.items[0].ocrOriginalText===good.item.text,'original OCR retained');assert(first.result.scene.items[0].ocrCorrections.length===1,'one source proof');assert(first.result.scene.items[0].words[4].text==='E','corrected actual word');tests++;
 {const f=fixture('EE','ee'),r=run(f);assert(!r.error&&r.result.scene.items[0].text===f.correctText&&r.result.scene.items[0].ocrCorrections.length===2,'two simultaneous corrections retain a single independently verified combined writer plan');tests++;}
 for(const [truth,observed]of[['E','E'],['I','I'],['l','l'],['O','O'],['0','0'],['"','"']]){const f=fixture(truth,observed),r=run(f);assert(!r.error&&same(r.result,f.prepared),'correct/ambiguous '+truth+' retains source');tests++;}
 for(const [name,mutate]of[
  ['source mismatch',f=>f.prepared.scene.sources[0].text='different'],['image source',f=>f.prepared.scene.sources[0].disposition='visible-image'],
  ['native text',f=>f.item.ocrNative=true],['italic',f=>f.item.italic=true],['mixed target weight',f=>f.word.bold=true],['low line score',f=>f.item.ocrFontScore=.69],
  ['mixed non-Latin text',f=>{f.item.text=f.item.text.replace('A','甲');f.item.words[0].text='甲';f.prepared.scene.sources[0].text=f.item.text;}],
  ['explicit formula',f=>f.item.role='math'],['generated line',f=>f.item.fontAssetId='font:already-owned'],
  ['generated word',f=>f.word.fontAssetId='font:already-owned'],['ruling',f=>f.word.ocrRuling=true],['low confidence',f=>f.word.confidence=.39],
  ['no anchors',f=>f.item.words.forEach(w=>w.ocrGlyphScore=.1)],['unknown family',f=>f.item.font='UnprovenPrivateFont'],
  ['duplicate source id',f=>f.prepared.scene.sources.push({...f.prepared.scene.sources[0]})],
  ['ordinary table',f=>f.prepared.scene.items=[{type:'table',cells:[{blocks:[f.item]}]}]],
  ['source damaged',f=>{const r=f.word.rect;for(let y=Math.floor(r.y*4);y<Math.floor((r.y+r.height/2)*4);y++)for(let x=Math.floor(r.x*4);x<Math.ceil((r.x+r.width)*4);x++){const at=(y*f.data.width+x)*4;f.data.pixels[at]=f.data.pixels[at+1]=f.data.pixels[at+2]=255;}}],
  ['coloured source',f=>{for(let i=0;i<f.data.pixels.length;i+=4)if(f.data.pixels[i]<180){f.data.pixels[i]=0;f.data.pixels[i+1]=100;f.data.pixels[i+2]=0;}}]
 ]){const f=fixture();mutate(f);const r=run(f);assert(!r.error&&same(r.result,f.prepared),name+' refuses safely');tests++;}
 for(const amount of[1,100,1000]){const f=fixture(),r=run(f,{budget:{remaining:100000,pixelsRemaining:amount}});assert(!r.error&&same(r.result,f.prepared),'bounded incomplete probe cannot rewrite text');tests++;}
 {const f=fixture(),r=run(f,{alias:true});assert(!r.error&&same(r.result,f.prepared),'missing/aliased family cannot authorize spelling');tests++;}
 {const f=fixture();let n=0;const r=run(f,{check(){if(++n>25)throw Object.assign(Error('cancelled'),{name:'AbortError'});}});assert(r.error?.name==='AbortError','cancellation propagates');tests++;}
 {const f=fixture(),r=run(f,{failCreate:true});assert(r.error?.message==='synthetic allocation failure','allocation failure propagates after releasing the first surface');tests++;}
 {const f=fixture();for(let i=1;i<=3;i++){
   const clone=structuredClone(f.item),id='p1:literal'+i;clone.id=id;clone.sourceIds=[id];clone.ocrLiteralPlacement={version:1};clone.ocrFontScore=0;
   clone.rect.y+=i*22;clone.baseline+=i*22;for(const w of clone.words){w.rect.y+=i*22;w.baseline+=i*22;}
   f.prepared.scene.items.push(clone);f.prepared.scene.sources.push({id,text:clone.text,rect:clone.rect,order:i,disposition:'editable'});
  }
  let overflow;try{ocrFrameLayout(inferDocument([f.prepared.scene],{preserveGeometry:true}).pages[0]);}catch(e){overflow=e;}
  assert(overflow?.code==='layout-quality','fixture reaches the actual positioned-frame limit');
  const r=run(f);assert(!r.error&&same(r.result,f.prepared),'optional spelling repair retains the original scene when no safe writer plan fits');tests++;
 }
 return{tests,scope:'Real-browser synthetic source-glyph recovery/refusals, immutable source pixels/scene, budget, alias safety and canvas cleanup; not OCR accuracy on unseen documents.'};
});await writeFile(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await server.close();}
