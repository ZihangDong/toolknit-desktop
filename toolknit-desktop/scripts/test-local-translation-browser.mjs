import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {build, preview} from 'vite';
import {createRequire} from 'node:module';
import path from 'node:path';

const require=createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES,'package.json')
  : import.meta.url);
const {chromium}=require('playwright');

const settings=await readFile('src/app/templates/settings.html','utf8');
const managers=await readFile('src/app/templates/dependency-managers.html','utf8');
const overlay=managers.slice(managers.indexOf('<div class="transcription-model-overlay" id="localTranslationOverlay"'));
const html=`<!doctype html><html><head><link rel="stylesheet" href="/src/styles/index.css"><link rel="stylesheet" href="/src/styles/themes/index.css"></head><body>${settings}${overlay}<script type="module">
import {createLocalTranslationSettings} from '/src/app/local-translation-runtime.js';
import zh from '/src/locales/zh.json'; import en from '/src/locales/en.json';
import {createIcons,icons} from 'lucide';
const translate=(key,vars={})=>{let value=key.split('.').reduce((v,k)=>v[k],window.__lang==='zh'?zh:en);for(const [name,text]of Object.entries(vars))value=value.replace('{'+name+'}',text);return value;};
window.__langChanged=[];
document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=translate(el.dataset.i18n));
document.getElementById('settingsOverlay').classList.add('visible');
document.getElementById('settingsOverlay').setAttribute('aria-hidden','false');
window.__manager=createLocalTranslationSettings({isTauri:true,translate,onLanguageChange:fn=>{window.__langChanged.push(fn);return()=>{};},notify:text=>window.__notices.push(text)});
createIcons({icons});
</script></body></html>`;
await mkdir('tmp/local-translation-browser',{recursive:true});
await writeFile('tmp/local-translation-settings.html',html);
await build({configFile:false,build:{outDir:'tmp/local-translation-settings-dist',emptyOutDir:true,rollupOptions:{input:'tmp/local-translation-settings.html'}}});
const server=await preview({configFile:false,build:{outDir:'tmp/local-translation-settings-dist'},preview:{host:'127.0.0.1',port:0,open:false}});
console.log('translation fixture server ready');
const browser=await chromium.launch({headless:true,timeout:15000,...(process.env.TOOLKNIT_TEST_BROWSER?{executablePath:process.env.TOOLKNIT_TEST_BROWSER}:{})});
console.log('translation fixture browser ready');
const errors=[];
await mkdir('tmp/local-translation-browser',{recursive:true});
try{
  for(const theme of ['light','dark'])for(const width of [1400,740,420])for(const height of [900,480]){
    const page=await browser.newPage({viewport:{width,height}});
    page.setDefaultTimeout(10000);
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(({theme})=>{
      document.addEventListener('DOMContentLoaded',()=>document.documentElement.dataset.theme=theme);
      window.__lang=theme==='light'?'zh':'en';window.__notices=[];window.__calls=[];window.__requests=[];window.__ready=false;window.__failure='';
      let id=0;const callbacks=new Map(),listeners=new Map();
      window.__emit=(event,payload)=>{for(const [eid,l]of listeners)if(l.event===event)callbacks.get(l.handler)?.({event,id:eid,payload});};
      window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:(_,eid)=>listeners.delete(eid)};
      window.__TAURI_INTERNALS__={transformCallback:f=>{callbacks.set(++id,f);return id;},unregisterCallback:i=>callbacks.delete(i),invoke:async(command,args={})=>{
        if(command==='plugin:event|listen'){listeners.set(++id,args);return id;}
        if(command==='plugin:event|unlisten')return;
        if(command!=='local_translation')throw Error(command);
        const action=args.request.action;window.__calls.push(action);window.__requests.push(structuredClone(args.request));
        const status=()=>({ready:window.__ready,installing:false,progress:{},targetLanguage:'zh-Hans'});
        if(action==='status'){
          const snapshot=status();
          if(window.__deferStatus)return new Promise(resolve=>{window.__finishStatus=()=>resolve(snapshot);});
          return snapshot;
        }
        if(action==='remove'){window.__ready=false;return status();}
        if(action==='cancel-install'){window.__finish(false,'translation:cancelled');return null;}
        if(action==='install'){
          if(window.__failure)throw window.__failure;
          window.__emit('local-translation-progress',{phase:'download',received:100,total:200,source:args.request.source==='accelerated'?'accelerated':'official'});
          return new Promise((resolve,reject)=>{window.__finish=(ready,error)=>{window.__ready=ready;window.__emit('local-translation-changed',status());error?reject(error):resolve(status());};});
        }
        throw Error(action);
      }};
    },{theme});
    await page.goto(`${server.resolvedUrls.local[0]}tmp/local-translation-settings.html`,{waitUntil:'domcontentloaded',timeout:20000});
    await page.waitForFunction(()=>window.__manager);
    await page.locator('#localTranslationManage').scrollIntoViewIfNeeded();
    const row=await page.locator('#localTranslationManage').evaluate(button=>{
      const card=button.closest('article').getBoundingClientRect();
      const startup=document.getElementById('autostartToggle').closest('article').getBoundingClientRect();
      const action=button.getBoundingClientRect();
      const copy=document.getElementById('localTranslationSummary').parentElement.getBoundingClientRect();
      return {fullWidth:Math.abs(card.width-startup.width)<1,buttonFits:action.left>=card.left&&action.right<=card.right,noOverlap:copy.right<=action.left||copy.bottom<=action.top};
    });
    assert.ok(row.fullWidth&&row.buttonFits&&row.noOverlap,'translation uses a full-width row with separate copy and management action');
    await page.locator('.settings-v2-translation-card').screenshot({path:`tmp/local-translation-browser/row-${theme}-${width}-${height}.png`,animations:'disabled'});
    const visible=()=>page.locator('#localTranslationOverlay').evaluate(el=>el.classList.contains('visible'));
    await page.locator('#localTranslationManage').click();assert.ok(await visible());
    assert.ok(!await page.locator('#localTranslationCancel').isVisible());
    assert.ok(!await page.locator('#localTranslationRemove').isVisible());
    const colors=await page.locator('#localTranslationOverlay .transcription-model-panel').evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,rect:el.getBoundingClientRect().toJSON()}));
    assert.equal(colors.color,theme==='light'?'rgb(17, 17, 17)':'rgb(255, 255, 255)');
    assert.ok(colors.rect.top>=0&&colors.rect.bottom<=height+1);
    assert.ok(theme==='light'?colors.background.includes('255'):!colors.background.includes('255'));
    const install=page.locator('#localTranslationInstall');
    const style=property=>install.evaluate((el,key)=>getComputedStyle(el)[key],property);
    if(theme==='light'){
      assert.equal(await style('backgroundColor'),'rgb(17, 17, 17)','light actions are black before hover');
      assert.equal(await style('color'),'rgb(255, 255, 255)');
      assert.equal(await style('borderRadius'),'999px');
      await install.hover();
      await page.waitForFunction(()=>getComputedStyle(document.getElementById('localTranslationInstall')).backgroundColor==='rgb(42, 42, 42)');
      await page.mouse.move(0,0);
      await page.waitForFunction(()=>getComputedStyle(document.getElementById('localTranslationInstall')).backgroundColor==='rgb(17, 17, 17)');
    }
    const source=page.locator('#localTranslationSourceOptions');
    assert.equal(await source.locator('[aria-pressed="true"]').getAttribute('data-source'),'auto');
    await source.locator('[data-source="accelerated"]').click();
    assert.equal(await source.locator('[aria-pressed="true"]').getAttribute('data-source'),'accelerated');
    await page.evaluate(()=>{window.__deferStatus=true;void window.__manager.refresh();});
    await page.waitForFunction(()=>Boolean(window.__finishStatus));
    await page.locator('#localTranslationInstall').click();
    await page.waitForFunction(()=>document.getElementById('localTranslationProgress').value===100);
    await page.evaluate(()=>{window.__deferStatus=false;window.__finishStatus();});
    await page.waitForTimeout(30);
    assert.ok(await page.locator('#localTranslationCancel').isVisible(),'late idle status must not erase installation progress');
    assert.equal(await page.evaluate(()=>window.__requests.find(r=>r.action==='install').source),'accelerated');
    assert.match(await page.locator('#localTranslationStatus').textContent(),/GitHub/);
    assert.equal(await source.locator('button:disabled').count(),3,'source cannot change mid-install');
    assert.ok(await page.locator('#localTranslationInstall').isDisabled());
    await page.locator('#localTranslationClose').click();assert.ok(!await visible());
    assert.ok(await page.locator('#localTranslationManage').evaluate(el=>el===document.activeElement));
    await page.locator('#localTranslationManage').click();
    assert.ok(await page.locator('#localTranslationCancel').isVisible());
    await page.locator('#localTranslationCancel').click();
    await page.waitForFunction(()=>!document.getElementById('localTranslationInstall').disabled);
    assert.ok((await page.locator('#localTranslationStatus').textContent()).length>10);
    await page.evaluate(()=>{window.__failure='translation:checksum';});
    await page.locator('#localTranslationInstall').click();
    await page.waitForFunction(()=>window.__notices.length===2);
    assert.match(await page.locator('#localTranslationStatus').textContent(),theme==='light'?/校验/:/verification/);
    await page.evaluate(()=>{window.__failure='translation:download';});
    await source.locator('[data-source="official"]').click();
    await install.click();
    await page.waitForFunction(()=>window.__notices.length===3);
    assert.match(await page.locator('#localTranslationStatus').textContent(),/Mozilla/);
    await source.locator('[data-source="auto"]').click();
    await page.evaluate(()=>{window.__failure='';});
    await page.locator('#localTranslationInstall').click();
    await page.waitForFunction(()=>!document.getElementById('localTranslationCancel').hidden);
    await page.evaluate(()=>window.__finish(true));
    await page.waitForFunction(()=>!document.getElementById('localTranslationRemove').hidden);
    await page.locator('#localTranslationInstall').click();
    await page.waitForFunction(()=>!document.getElementById('localTranslationCancel').hidden);
    await page.evaluate(()=>window.__finish(true));
    await page.waitForFunction(()=>!document.getElementById('localTranslationInstall').disabled);
    assert.ok(!await page.locator('#localTranslationCancel').isVisible());
    assert.ok(await page.locator('#localTranslationRemove').isVisible());
    assert.equal(await page.locator('#localTranslationClose svg').count(),1);
    await page.screenshot({path:`tmp/local-translation-browser/${theme}-${width}-${height}.png`,animations:'disabled'});
    await page.evaluate(()=>{window.__lang='en';window.__langChanged.forEach(fn=>fn());});
    assert.match(await page.locator('#localTranslationInstall').textContent(),/Repair/);
    assert.ok(await page.locator('#localTranslationInstall').evaluate(el=>el.getBoundingClientRect().height>=34));
    assert.equal(await page.locator('#localTranslationClose svg').count(),1);
    await page.locator('#localTranslationRemove').click();
    await page.waitForFunction(()=>document.getElementById('localTranslationRemove').hidden);
    await page.keyboard.press('Escape');assert.ok(!await visible());
    await page.locator('#localTranslationManage').click();await page.locator('#localTranslationClose').click();
    await page.evaluate(()=>{window.__manager.dispose();window.__manager.dispose();});
    assert.equal((await page.evaluate(()=>window.__calls.filter(a=>a==='install').length)),5);
    assert.deepEqual(await page.evaluate(()=>window.__requests.filter(r=>r.action==='install').map(r=>r.source)),['accelerated','accelerated','official','auto','auto']);
    console.log(`translation settings ${theme} ${width}x${height}: layout/buttons/sources/install/progress/cancel/checksum/network/repair/remove/language/focus/reopen passed`);
    await page.close();
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
