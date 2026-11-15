import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import { createCanvas } from '@napi-rs/canvas';
const require=createRequire(process.env.TOOLKNIT_TEST_MODULES?path.join(process.env.TOOLKNIT_TEST_MODULES,'package.json'):import.meta.url);
const { chromium }=require('playwright');
const canvas=createCanvas(240,120),ctx=canvas.getContext('2d');ctx.fillStyle='#ee2518';ctx.fillRect(0,0,120,120);ctx.fillStyle='#164bdf';ctx.fillRect(120,0,120,120);
const image=canvas.toDataURL('image/png');canvas.width=canvas.height=1;
const output=path.resolve('tmp/file-search-thumbnails-browser');await mkdir(output,{recursive:true});
await writeFile('tmp/file-search-thumbnails.html',`<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font-family:"Segoe UI","Microsoft YaHei",sans-serif}#stage{height:520px;display:flex;flex-direction:column}</style></head><body><section id="stage"><div id="list" style="height:100%;min-height:0;display:flex;flex-direction:column"></div></section><script type="module">
import {createResults,resultsMarkup} from '/src/features/file-search/results.js';import {t,setLangWithoutFade} from '/src/i18n.js';
const mode=new URLSearchParams(location.search).get('mode');await import(mode==='main'?'/src/features/file-search/file-search.css':'/src/features/file-search/floating.css');
setLangWithoutFade(window.__lang);document.documentElement.dataset.theme=window.__theme;
const stage=document.querySelector('#stage'),root=document.querySelector('#list');stage.className=mode==='main'?'fs-tool':'';root.className=mode==='main'?'fs-results':'fs-card';root.dataset.visible='true';root.innerHTML=resultsMarkup();
window.__calls=[];window.__active=0;window.__maxActive=0;window.__hold=false;window.__pending=[];
const rows=Array.from({length:1000},(_,i)=>({id:String(i),name:i%7===0?'notes'+i+'.pdf':'photo'+i+'.png',parent:'C:\\\\Synthetic\\\\Images',extension:i%7===0?'pdf':'png',size:400,modified:1793664000}));
window.__results=createResults({root,tr:(key,vars)=>t('fileSearch.'+key,vars),runtime:{call:async(action,payload)=>{
if(action==='search')return {result:{rows,total:1000,extensions:['png','pdf']},ticket:payload.query.text||'initial',generation:1,index:{phase:'ready',generation:1}};
if(action==='query-invalidate'||action==='reveal')return null;
if(action==='thumbnail'){window.__calls.push(payload);window.__active++;window.__maxActive=Math.max(window.__maxActive,window.__active);const hold=window.__hold;await new Promise(resolve=>hold?window.__pending.push(resolve):setTimeout(resolve,25));window.__active--;return payload.id==='4'?null:{image:window.__image};}
throw Error(action);
}}});window.__results.session.set({text:'initial'});window.__results.session.start();window.__ready=true;
addEventListener('pagehide',()=>window.__results.dispose(),{once:true});
</script></body></html>`);
const server=await createServer({configFile:false,logLevel:'error',optimizeDeps:{entries:['tmp/file-search-thumbnails.html','file-search.html']},server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true,...(process.env.TOOLKNIT_TEST_BROWSER_CHANNEL?{channel:process.env.TOOLKNIT_TEST_BROWSER_CHANNEL}:{})});
const base=server.resolvedUrls.local[0],errors=[],checks=[];
try {
 for(const mode of ['main','float'])for(const theme of ['light','dark']) {
  const page=await browser.newPage({viewport:{width:mode==='main'?960:420,height:600},deviceScaleFactor:theme==='dark'?2:1});
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({image,theme})=>{window.__image=image;window.__theme=theme;window.__lang=theme==='dark'?'en':'zh';},{image,theme});
  await page.goto(`${base}tmp/file-search-thumbnails.html?mode=${mode}`);await page.waitForFunction(()=>window.__ready);
  await page.waitForFunction(()=>document.querySelectorAll('[data-thumbnail=ready]').length>=4);
  const first=await page.locator('[data-thumbnail=ready] img').first().evaluate(img=>{const c=document.createElement('canvas');c.width=2;c.height=1;const x=c.getContext('2d');x.drawImage(img,0,0,2,1);return {pixels:[...x.getImageData(0,0,2,1).data],width:img.getBoundingClientRect().width};});
  assert.ok(first.pixels[0]>180&&first.pixels[6]>180,'preview contains actual red/blue picture pixels');assert.ok(first.width>=44,'preview is large enough to identify an image');
  await page.waitForFunction(()=>window.__active===0);assert.ok(await page.evaluate(()=>window.__maxActive<=2));
  assert.ok(await page.evaluate(()=>window.__calls.length<25),'only the virtual viewport is previewed, not all 1000 matches');
  const unchanged=await page.evaluate(()=>{window.__imageNode=document.querySelector('[data-thumbnail=ready] img');const before=window.__calls.length;for(let i=0;i<100;i++)window.__results.render();return before;});
  await page.waitForTimeout(60);assert.equal(await page.evaluate(()=>window.__calls.length),unchanged);assert.equal(await page.evaluate(()=>window.__imageNode===document.querySelector('[data-thumbnail=ready] img')),true);
  await page.locator('.fs-list').evaluate(list=>{for(let i=0;i<30;i++){list.scrollTop=20000+i*100;list.dispatchEvent(new Event('scroll'));}});
  await page.waitForFunction(()=>Number(document.querySelector('.fs-row')?.dataset.fsRow)>250);await page.waitForFunction(()=>document.querySelectorAll('[data-thumbnail=ready]').length>=4);
  assert.ok(await page.locator('.fs-list').evaluate(list=>list.scrollTop>20000),'thumbnail completion does not pull the scroll position back to the top');
  await page.locator('.fs-list').evaluate(list=>{list.scrollTop=0;list.dispatchEvent(new Event('scroll'));});await page.waitForFunction(()=>document.querySelector('.fs-row')?.dataset.fsRow==='0');
  await page.waitForFunction(()=>window.__active===0);await page.evaluate(()=>{window.__hold=true;window.__results.session.set({text:'old'},{immediate:true});});
  await page.waitForFunction(()=>window.__pending.length===2);await page.evaluate(()=>{window.__hold=false;window.__results.session.set({text:'new'},{immediate:true});});
  await page.waitForFunction(()=>document.querySelectorAll('[data-thumbnail=ready]').length>=4);await page.evaluate(()=>window.__pending.splice(0).forEach(resolve=>resolve()));
  await page.waitForTimeout(50);assert.ok(await page.evaluate(()=>window.__calls.slice(-4).every(x=>x.ticket==='new')),'old images cannot become new query results');
  await page.screenshot({path:path.join(output,`${mode}-${theme}.png`)});
  await page.setViewportSize({width:340,height:600});assert.equal(await page.locator('#stage').evaluate(n=>n.scrollWidth>n.clientWidth+1),false);
  await page.evaluate(()=>window.__results.pause());await page.close();checks.push(`${mode}/${theme}: real thumbnail pixels, bounded requests, stable virtual scrolling, cache, stale replies and narrow layout`);
 }
 const page=await browser.newPage({viewport:{width:148,height:56}});page.on('pageerror',error=>errors.push(error.message));
 await page.exposeFunction('__resize',expanded=>page.setViewportSize({width:expanded?500:148,height:56}));
 await page.addInitScript(()=>{
  let serial=0;const callbacks=new Map(),listeners=new Map();let timer;
  const state={enabled:true,hidden:false,suspended:false,expanded:false,generation:1,settledGeneration:1,context:{lang:'zh',reducedMotion:false},query:{text:''},layout:{scale:1,originX:352,originY:0,bar:{width:148}}};
  window.__emit=(event,payload)=>{for(const [id,x]of listeners)if(x.event===event)callbacks.get(x.handler)?.({event,id,payload:structuredClone(payload)});};
  window.__change=async expanded=>{const changed=state.expanded!==expanded;clearTimeout(timer);state.generation++;state.expanded=expanded;state.settledGeneration=changed?0:state.generation;state.layout.bar.width=expanded?500:148;const owner=state.generation;await window.__resize(expanded||changed);window.__emit('file-search-state',state);if(changed)timer=setTimeout(async()=>{if(owner!==state.generation)return;await window.__resize(expanded);state.settledGeneration=owner;if(!window.__dropSettled)window.__emit('file-search-settled',owner);},320);return structuredClone(state);};
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:(_,id)=>listeners.delete(id)};
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'file-search-bar'},currentWebview:{label:'file-search-bar'}},transformCallback:fn=>{callbacks.set(++serial,fn);return serial;},unregisterCallback:id=>callbacks.delete(id),invoke:async(command,args={})=>{
   if(command==='plugin:event|listen'){listeners.set(++serial,args);return serial;}if(command==='plugin:event|unlisten')return;
   if(command!=='file_search')return null;const action=args.request.action;
   if(action==='boot'||action==='ready')return structuredClone(state);
   if(action==='expand'||action==='collapse')return window.__change(action==='expand');
   return null;
  }};
 });
 await page.goto(`${base}file-search.html?role=bar`);await page.waitForFunction(()=>document.querySelector('.fs-capsule span')?.textContent);
 for(let i=0;i<12;i++) {
  await page.locator('.fs-capsule').click();await page.waitForTimeout(35);
  await page.locator('.fs-collapse').click({force:true});await page.waitForTimeout(20);await page.evaluate(()=>window.__change(false));
  await page.waitForFunction(()=>document.querySelector('.fs-bar').getAnimations().length===0);
  const value=await page.locator('.fs-bar').evaluate(n=>({x:n.getBoundingClientRect().x,width:n.getBoundingClientRect().width,text:n.querySelector('.fs-capsule').textContent.trim(),opacity:getComputedStyle(n.querySelector('.fs-capsule')).opacity}));
  assert.equal(value.x,0);assert.equal(value.width,148);assert.equal(value.opacity,'1');assert.ok(value.text);
 }
 await page.evaluate(()=>window.__dropSettled=true);await page.locator('.fs-capsule').click();await page.waitForFunction(()=>document.querySelector('.fs-bar').getAnimations().length===0);
 await page.locator('.fs-collapse').click();await page.waitForFunction(()=>document.querySelector('.fs-bar').getAnimations().length===0);
 assert.equal(await page.locator('.fs-bar').evaluate(n=>n.getBoundingClientRect().x),0);
 await page.screenshot({path:path.join(output,'capsule-recovered.png')});await page.close();checks.push('capsule: 12 interrupted duplicate-collapse cycles and lost-settled-event recovery with a right-edge anchor');
 assert.deepEqual(errors,[]);console.log(checks.join('\n'));
 await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors},null,2)+'\n');
} finally {await browser.close();await server.close();}
