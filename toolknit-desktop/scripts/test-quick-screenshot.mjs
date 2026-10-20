import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { rectangle, moveRect, resizeRect, resizeAnnotation, windowAt, parseTranslations, formatOcrText, ocrLines, normalizeOcrText, fitText, annotationTextLayout, tightenTextAnnotation, isPaintStroke, errorKey } from '../src/features/quick-screenshot/core.js';
import { translationBatches, translationBudget, translationBlocks, resolveTranslationBatches, createTranslationRequestBudget, layoutTranslations } from '../src/features/quick-screenshot/translation.js';
import { composeScreenshot } from '../src/features/quick-screenshot/renderer.js';
import { createSnapshotHistory } from '../src/shared/snapshot-history.js';

assert.deepEqual(rectangle({x:200,y:150},{x:-20,y:10},160,100),{x:0,y:10,width:160,height:90});
assert.deepEqual(moveRect({x:20,y:20,width:60,height:40},500,-50,160,100),{x:100,y:0,width:60,height:40});
for(let handle=0;handle<8;handle++) {
  const r=resizeRect({x:20,y:20,width:60,height:40},handle,{x:-100,y:500},160,100);
  assert.ok(r.x>=0 && r.y>=0 && r.width>=1 && r.height>=1 && r.x+r.width<=160 && r.y+r.height<=100);
}
assert.deepEqual(resizeRect({x:20,y:20,width:60,height:40},3,{x:120,y:90},160,100),{x:20,y:20,width:100,height:40});
assert.deepEqual(resizeAnnotation({x:20,y:20,width:60,height:40,points:[{x:20,y:20},{x:80,y:60}]},{x:10,y:10,width:120,height:80}).points,[{x:10,y:10},{x:130,y:90}]);
assert.deepEqual(windowAt({bounds:{x:-1920,y:-100,width:3840,height:1200},windows:[{x:-1800,y:0,width:600,height:500}]},{x:200,y:200}),{x:120,y:100,width:600,height:500});
const lines=[{id:1,text:'one'},{id:2,text:'two'}];
assert.deepEqual(parseTranslations('[{"id":2,"text":"B"},{"id":1,"text":"A"}]',lines).map(l=>l.text),['A','B']);
assert.equal(formatOcrText({text:'fallback',lines:[
  {id:2,text:'world',x:60,y:40,width:40,height:16},
  {id:1,text:'hello',x:10,y:40,width:40,height:16},
  {id:3,text:'下一行',x:10,y:80,width:50,height:16}
]}), 'hello world\n下一行');
assert.equal(formatOcrText({text:'fallback'}), 'fallback');
assert.equal(normalizeOcrText('我 先 检 查 内 容 ，然后运行 git status --short\n下一行'), '我先检查内容，然后运行 git status --short\n下一行');
const words=[{text:'Hello',x:10,y:10,width:28,height:14},{text:'world',x:40,y:10,width:30,height:14}];
assert.equal(formatOcrText({lines:[{text:'bad fallback',x:10,y:10,width:60,height:14,words}]}),'Hello world');
assert.equal(ocrLines({lines:[{id:9,text:'我 先 检 查',x:10,y:10,width:60,height:14},null,{text:'bad',x:0,y:0,width:0,height:0}]}).length,1);
assert.deepEqual(translationBatches(Array.from({length:81},(_,id)=>({id,text:'hello'}))).map(batch=>batch.length),[12,12,12,12,12,12,9]);
assert.deepEqual(translationBatches([{id:0,text:'x'.repeat(4000)},{id:1,text:'y'.repeat(3000)}]).map(batch=>batch.length),[1,1]);
assert.ok(translationBudget([{text:'short'}]) < translationBudget([{text:'x'.repeat(2000)}]));
assert.ok(translationBudget([{text:'short'}])>=4096,'short text also needs room for reasoning and JSON');
assert.throws(()=>parseTranslations('[null,null]',lines),/invalid-translation/);
assert.throws(()=>parseTranslations('broken json',lines),/invalid-translation/);
const paragraphs=translationBlocks([
  {id:0,text:'A wrapped',x:10,y:10,width:100,height:16},
  {id:1,text:'sentence.',x:10,y:32,width:90,height:16},
  {id:2,text:'- Another item',x:10,y:54,width:120,height:16},
  {id:3,text:'Separate column',x:240,y:54,width:140,height:16}
]);
assert.equal(paragraphs.length,3);assert.equal(paragraphs[0].text,'A wrapped\nsentence.');
assert.equal(paragraphs[0].height,38);assert.equal(paragraphs[0].fontHeight,16);
const response=batch=>JSON.stringify(batch.map(line=>({id:line.id,text:`Translated ${line.id}`})));
const truncated=()=>Object.assign(new Error('truncated'),{code:'response_truncated'});
const retries=[];
const recovered=await resolveTranslationBatches(lines,async(batch,tokens)=>{
  retries.push(tokens);if(retries.length===1)throw truncated();return response(batch);
});
assert.equal(recovered.lines.length,2);assert.equal(recovered.failed.length,0);assert.equal(retries[1],16384);
const splitCalls=[];
const split=await resolveTranslationBatches(lines,async(batch)=>{
  splitCalls.push(batch.length);if(batch.length>1)throw truncated();return response(batch);
});
assert.deepEqual(splitCalls,[2,2,1,1]);assert.equal(split.lines.length,2);
const partial=await resolveTranslationBatches(lines,async(batch)=>{
  if(batch.some(line=>line.id===2))return 'not JSON';return response(batch);
});
assert.deepEqual(partial.lines.map(line=>line.id),[1]);assert.equal(partial.failed[0].line.id,2);
let requests=0;
const stopped=await resolveTranslationBatches(lines,async()=>{requests++;throw Object.assign(new Error('unauthorized'),{code:'http_error',status:401});});
assert.equal(requests,1);assert.equal(stopped.failed.length,2);
const exhausted=await resolveTranslationBatches(lines,async()=>{throw new Error('must not request');},{budget:{requests:24,deadline:100,now:()=>0}});
assert.equal(exhausted.lines.length,0);assert.equal(exhausted.failed.length,2);
const timedOut=await resolveTranslationBatches(lines,async()=>{throw new Error('must not request');},{budget:{requests:0,deadline:100,now:()=>100}});
assert.equal(timedOut.failed[0].error.code,'timeout');
const cancellation=new AbortController();
await assert.rejects(()=>resolveTranslationBatches(lines,async()=>{cancellation.abort();return response(lines);},{signal:cancellation.signal}),/aborted/);
assert.ok(createTranslationRequestBudget().deadline>Date.now());
assert.equal(formatOcrText({lines:[
  {text:'第二段',x:10,y:100,width:60,height:16},
  {text:'中文',x:10,y:10,width:30,height:16},
  {text:'内容',x:42,y:11,width:30,height:16}
]}),'中文内容\n\n第二段');
assert.equal(formatOcrText({lines:[{text:'名称',x:10,y:10,width:30,height:16},{text:'数量',x:150,y:10,width:30,height:16}]}),'名称\t数量');
assert.equal(formatOcrText({text:'fallback',lines:[{text:'bad',x:0,y:0,width:0,height:0}]}),'fallback');
for(const [code,key]of [['aborted','cancelled'],['provider_changed','providerChanged'],['timeout','aiTimeout'],['invalid_config','aiInvalidConfig'],['network_error','aiNetwork']])assert.equal(errorKey({code,message:'localized'}),key);
assert.equal(errorKey({code:'http_error',status:507}),'aiProviderUnavailable');
for(const input of ['[]','[{"id":1,"text":"A"},{"id":1,"text":"B"}]','[{"id":1,"text":"A"},{"id":3,"text":"B"}]','[{"id":1,"text":""},{"id":2,"text":"B"}]'])assert.throws(()=>parseTranslations(input,lines));

globalThis.document={createElement:()=>createCanvas(1,1)};
const source=createCanvas(320,200), ctx=source.getContext('2d');
for(let x=0;x<320;x+=4){ctx.fillStyle=x%8?'#0000ff':'#ff0000';ctx.fillRect(x,0,4,200);}
const crop={x:40,y:20,width:200,height:120};
const result=composeScreenshot(source,crop,[{kind:'rectangle',x:60,y:40,width:30,height:30,color:'#00ff00',fill:true}]);
assert.equal(result.width,200);assert.equal(result.height,120);
assert.deepEqual([...result.getContext('2d').getImageData(30,30,1,1).data],[0,255,0,255]);
assert.deepEqual([...ctx.getImageData(70,50,1,1).data],[0,0,255,255]);
const pixel=(context,x,y)=>[...context.getImageData(x,y,1,1).data];
const stroke={kind:'mosaic',x:10,y:30,width:60,height:30,block:8,points:[{x:10,y:30},{x:70,y:30},{x:70,y:60}]};
const mosaic=composeScreenshot(source,{x:0,y:0,width:80,height:80},[stroke]).getContext('2d');
assert.notDeepEqual(pixel(mosaic,30,30),pixel(ctx,30,30),'the continuous painted path must pixelate');
assert.deepEqual(pixel(mosaic,30,30),pixel(mosaic,31,30),'pixels in one mosaic block match');
assert.deepEqual(pixel(mosaic,30,50),pixel(ctx,30,50),'the unpainted interior of the bounding box stays original');
assert.notDeepEqual(pixel(mosaic,70,55),pixel(ctx,70,55),'the stroke follows its turn');
const dot={kind:'brush',x:20,y:20,width:1,height:1,color:'#00ff00',stroke:8,points:[{x:20,y:20},{x:20,y:20}]};
assert.deepEqual(pixel(composeScreenshot(source,crop,[{...dot,x:60,y:40,points:[{x:60,y:40},{x:60,y:40}]}]).getContext('2d'),20,20),[0,255,0,255],'one click paints a round dot');
const edgeMosaic=composeScreenshot(source,{x:0,y:0,width:80,height:80},[{...stroke,x:0,y:0,width:1,height:1,points:[{x:0,y:0},{x:0,y:0}]}]).getContext('2d');
assert.notDeepEqual(pixel(edgeMosaic,2,2),pixel(ctx,2,2),'a mosaic click at the edge paints without going out of bounds');
assert.deepEqual(pixel(edgeMosaic,30,30),pixel(ctx,30,30));
assert.ok(isPaintStroke(stroke)&&isPaintStroke(dot)&&!isPaintStroke({kind:'rectangle'}));
const fitted=fitText(ctx,'A longer sentence that should wrap',110,90,24);
const blank=createCanvas(320,200);
for(const text of ['Short', '中文测试', 'Ágj italic?', 'First line\n第二行', 'First\n\nLast', 'A longer sentence that wraps across several lines']) {
  const item=tightenTextAnnotation(ctx,{kind:'text',text,x:10,y:10,width:160,height:170,font:28,color:'#ff0000'});
  const layout=annotationTextLayout(ctx,item);
  assert.ok(layout.fits && item.width<=160 && item.height<=170,text);
  assert.deepEqual(tightenTextAnnotation(ctx,item),item,'tightening must be stable across redraws');
  const rendered=composeScreenshot(blank,{x:0,y:0,width:320,height:200},[item]);
  const data=rendered.getContext('2d').getImageData(0,0,320,200).data;
  let left=320,right=0,top=200,bottom=0;
  for(let y=0;y<200;y++)for(let x=0;x<320;x++)if(data[(y*320+x)*4+3]){
    left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  assert.ok(left>=item.x && top>=item.y && right<item.x+item.width && bottom<item.y+item.height,'ink stays inside the selection');
  assert.ok(item.x+item.width-right<=10 && item.y+item.height-bottom<=6,'selection hugs visible ink');
}
const longText=tightenTextAnnotation(ctx,{kind:'text',text:'Long text annotation',x:10,y:10,width:300,height:170,font:28});
const shortText=tightenTextAnnotation(ctx,{...longText,text:'短',width:300,height:170});
assert.ok(shortText.width<longText.width/2,'editing to shorter text shrinks its selection');
const largerText=tightenTextAnnotation(ctx,{...shortText,font:48,width:300,height:170});
assert.ok(largerText.width>shortText.width && largerText.height>shortText.height,'font changes update both dimensions');
const narrowText=tightenTextAnnotation(ctx,{...longText,width:70,height:170});
assert.ok(narrowText.width<=70 && annotationTextLayout(ctx,narrowText).lines.length>1,'resizing wraps text and stays bounded');
const cover={...longText,cover:true,width:280,height:90};
assert.deepEqual(tightenTextAnnotation(ctx,cover),cover,'translation cover geometry must remain unchanged');
assert.throws(()=>tightenTextAnnotation(ctx,{...longText,width:5,height:5}),/text-overflow/);
const sources=[{id:0,text:'a',x:10,y:10,width:30,height:20},{id:1,text:'b',x:10,y:80,width:120,height:20}];
const laid=layoutTranslations(ctx,[{id:0,text:'A longer translated sentence'}, {id:1,text:'Next'}],sources,300,200);
assert.equal(laid.layers.length,2);
assert.ok(laid.layers[0].width>sources[0].width,'translated boxes expand into free space');
for(const layer of laid.layers){
  assert.ok(layer.x>=0 && layer.y>=0 && layer.x+layer.width<=300 && layer.y+layer.height<=200);
  assert.ok(fitText(ctx,layer.text,layer.width,layer.height,layer.font).fits);
}
const crowded=layoutTranslations(ctx,[{id:0,text:'x'.repeat(4000)}],sources,140,110,[{x:42,y:0,width:98,height:110}]);
assert.equal(crowded.layers.length,0);assert.equal(crowded.skipped.length,1);
assert.ok(composeScreenshot(source,{x:0,y:0,width:300,height:200},laid.layers.map(layer=>({...layer,kind:'text',cover:true,color:'#111'}))));
assert.ok(fitted.fits && fitted.lines.length>1);
assert.equal(fitText(ctx,'x'.repeat(4000),20,10,24).fits,false);
assert.throws(()=>composeScreenshot(source,crop,[{kind:'text',text:'x'.repeat(4000),x:40,y:20,width:20,height:10,color:'#000',font:24}]),/text-overflow/);

let value=0;
const history=createSnapshotHistory({capture:()=>value,apply:n=>{value=n;},equals:(a,b)=>a===b,measure:()=>10,maxBytes:35});
history.reset();for(value=1;value<8;value++)history.commit();
assert.equal(history.length,3);assert.ok(history.undo());assert.equal(value,6);
assert.ok(history.redo());assert.equal(value,7);
history.undo();value=20;history.commit();assert.equal(history.canRedo(),false);
history.withLock(()=>assert.equal(history.commit(),false));

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const zh=JSON.parse(read('../src/locales/zh.json')).home.quickScreenshot;
const en=JSON.parse(read('../src/locales/en.json')).home.quickScreenshot;
const settingsZh=JSON.parse(read('../src/locales/zh.json')).settings.localTranslation;
const settingsEn=JSON.parse(read('../src/locales/en.json')).settings.localTranslation;
assert.deepEqual(Object.keys(settingsZh).sort(),Object.keys(settingsEn).sort());
for(const key of Object.keys(settingsZh))assert.ok(settingsZh[key]&&settingsEn[key],key);
assert.deepEqual(Object.keys(zh).sort(),Object.keys(en).sort());
for(const key of Object.keys(zh)){assert.ok(zh[key] && en[key],key);}
assert.match(read('../index.html'),/data-tool="quick-screenshot"/);
assert.match(read('../src/features/lazy-tools.js'),/quick-screenshot/);
const caps=JSON.parse(read('../src-tauri/capabilities/screenshot.json'));
assert.ok(!caps.permissions.some(p=>/^(shell|http|fs):/.test(typeof p==='string'?p:p.identifier)));
assert.match(read('../src-tauri/src/native_runtime/quick_screenshot/mod.rs'),/devtools\(false\)/);
const native=read('../src-tauri/src/native_runtime/quick_screenshot/mod.rs');
assert.match(native,/"prepare-history-menu" if label == HISTORY_LABEL\s*=>\s*\{\s*history_menu::warm\(&app\)\.await\?/,'hidden menu preparation is restricted to the history window');
assert.match(native,/"main"\s*\|\s*"settings"/);
assert.match(native,/super::show_main_window\(&app\)/,'auxiliary navigation uses the tray restoration path');
assert.match(read('../src-tauri/src/native_runtime/quick_screenshot/history_actions.rs'),/window_visibility::hide\(&window\)\.await/,'session hiding verifies the real OS window');
assert.match(native,/"expand" if label == HISTORY_LABEL[\s\S]*?!history_actions::allowed/,'late expand must not revive a hidden window');
const restore=read('../src-tauri/src/native_runtime/runner.rs').split('pub(super) fn show_main_window')[1].split('pub(super) fn minimize_main_window')[0];
assert.match(restore,/unminimize\(\)[\s\S]*show\(\)[\s\S]*set_focus\(\)/);
assert.match(read('../src/features/quick-screenshot/capture-editor.js'),/expectedProvider:provider/);
assert.match(read('../screenshot.html'),/id="toastContainer"/);
delete globalThis.document;
console.log('Quick screenshot geometry, pixels, text, history and integration passed.');
