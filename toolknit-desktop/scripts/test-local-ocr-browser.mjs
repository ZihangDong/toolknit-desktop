import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(process.env.TOOLKNIT_TEST_MODULES?path.join(process.env.TOOLKNIT_TEST_MODULES,'package.json'):import.meta.url);
const {chromium}=require('playwright');
const settings=await readFile('src/app/templates/settings.html','utf8'),managers=await readFile('src/app/templates/dependency-managers.html','utf8');
await mkdir('tmp/local-ocr-browser',{recursive:true});
await writeFile('tmp/local-ocr-manager.html',`<!doctype html><html><head><link rel="stylesheet" href="/src/styles/index.css"></head><body>${settings}${managers}<script type="module">
import {createLocalOcrSettings} from '/src/app/local-ocr-runtime.js';import {createLocalOcrRuntime} from '/src/platform/local-ocr-runtime.js';import zh from '/src/locales/zh.json';import en from '/src/locales/en.json';
const dict=window.__theme==='light'?zh:en;const translate=key=>key.split('.').reduce((v,k)=>v?.[k],dict)||key;
document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=translate(el.dataset.i18n));document.getElementById('settingsOverlay').classList.add('visible');document.getElementById('settingsOverlay').inert=false;
window.__manager=createLocalOcrSettings({isTauri:true,translate});window.__ocr=createLocalOcrRuntime({isTauri:true});
</script></body></html>`);
const server=await createServer({configFile:false,optimizeDeps:{entries:['tmp/local-ocr-manager.html']},server:{host:'127.0.0.1',port:0,hmr:false,watch:{ignored:['**/tmp/**','**/src-tauri/target/**','**/.git/**']}},logLevel:'error'});await server.listen();
const browser=await chromium.launch({headless:true,channel:process.env.TOOLKNIT_TEST_BROWSER_CHANNEL||undefined});
try{
 for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width:900,height:600}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({theme})=>{
   window.__theme=theme;document.addEventListener('DOMContentLoaded',()=>document.documentElement.dataset.theme=theme);
   const callbacks=new Map(),listeners=new Map();let id=0,ready=false;
   window.__emit=(event,payload)=>{for(const [eventId,entry]of listeners)if(entry.event===event)callbacks.get(entry.handler)?.({event,id:eventId,payload});};
   window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:(_,id)=>listeners.delete(id)};
   window.__TAURI_INTERNALS__={transformCallback:fn=>{callbacks.set(++id,fn);return id;},unregisterCallback:id=>callbacks.delete(id),invoke:async(command,args={})=>{
    if(command==='plugin:event|listen'){listeners.set(++id,args);return id;}if(command==='plugin:event|unlisten')return;
    if(command!=='local_ocr')throw Error(command);const action=args.request.action,status=()=>({ready,installing:false,downloadBytes:21407098});
    if(action==='status')return status();if(action==='remove'){ready=false;return status();}
    if(action==='cancel-install'){window.__finish(false,'ocr:cancelled');return;}
    if(action==='install'){window.__emit('local-ocr-progress',{phase:'download',received:100,total:200});return new Promise((resolve,reject)=>{window.__finish=(ok,error)=>{ready=ok;error?reject(error):resolve(status());};});}
    throw Error(action);
   }};
  },{theme});
  await page.goto(`${server.resolvedUrls.local[0]}tmp/local-ocr-manager.html`);await page.waitForFunction(()=>window.__manager);
  await page.locator('#localOcrManage').click();await assert.doesNotReject(()=>page.locator('#localOcrInstall').waitFor({state:'visible'}));
  assert(!await page.locator('#localOcrCancel').isVisible());
  const panel=await page.locator('#localOcrOverlay .transcription-model-panel').evaluate(el=>({color:getComputedStyle(el).color,rect:el.getBoundingClientRect().toJSON()}));assert(panel.rect.top>=0&&panel.rect.bottom<=601);assert.equal(panel.color,theme==='light'?'rgb(17, 17, 17)':'rgb(255, 255, 255)');
  await page.locator('#localOcrInstall').click();await page.waitForFunction(()=>document.getElementById('localOcrProgress').value===100);await page.locator('#localOcrCancel').click();await page.waitForFunction(()=>!document.getElementById('localOcrInstall').disabled);
  await page.locator('#localOcrClose').click();await page.evaluate(()=>{window.__gate=null;void window.__ocr.ensure().then(()=>window.__gate=true).catch(()=>window.__gate=false);});
  await page.locator('#localOcrInstall').waitFor({state:'visible'});await page.locator('#localOcrInstall').click();await page.waitForFunction(()=>document.getElementById('localOcrProgress').value===100);await page.evaluate(()=>window.__finish(true));await page.waitForFunction(()=>window.__gate===true);
  assert.equal(await page.locator('#localOcrOverlay').getAttribute('aria-hidden'),'true');
  await page.locator('#localOcrManage').click();assert(await page.locator('#localOcrRemove').isVisible());await page.screenshot({path:`tmp/local-ocr-browser/${theme}.png`});await page.keyboard.press('Escape');
  assert.equal(await page.locator('#localOcrOverlay').getAttribute('aria-hidden'),'true');assert.deepEqual(errors,[]);await page.close();
 }
 console.log('OCR manager browser passed: both themes, bounded modal, cancellation, first-use continuation, model removal state and Escape.');
}finally{await browser.close();await server.close();}
