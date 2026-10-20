import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';

const locales={};
for(const lang of ['zh','en'])locales[lang]=JSON.parse(await readFile(new URL(`../src/locales/${lang}.json`,import.meta.url),'utf8')).home.quickScreenshot;

const require=createRequire(process.env.TOOLKNIT_TEST_MODULES?path.join(process.env.TOOLKNIT_TEST_MODULES,'package.json'):import.meta.url);
const {chromium}=require('playwright');
const fixture=createCanvas(1400,900),ctx=fixture.getContext('2d');
ctx.fillStyle='#edf2f5';ctx.fillRect(0,0,1400,900);ctx.fillStyle='#fff';ctx.fillRect(100,80,800,440);
ctx.fillStyle='#111';ctx.font='32px sans-serif';ctx.fillText('SCREENSHOT TEST',160,160);
ctx.fillStyle='#14965c';ctx.fillRect(160,210,180,120);
for(let x=332;x<340;x+=2){ctx.fillStyle=x%4?'#14965c':'#ffffff';ctx.fillRect(x,210,2,120);}
const image=fixture.toDataURL('image/png'),out=path.resolve('tmp/quick-screenshot-browser');
await mkdir(out,{recursive:true});
const server=await preview({configFile:false,preview:{host:'127.0.0.1',port:0,open:false}});
const browser=await chromium.launch({headless:true,...(process.env.TOOLKNIT_TEST_BROWSER?{executablePath:process.env.TOOLKNIT_TEST_BROWSER}:{})});
const errors=[],results=[],url=server.resolvedUrls.local[0];
async function open(role,theme,width=1400,height=900,dpr=1,{warmMenu=false}={}){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr});
  const page=await context.newPage();page.setDefaultTimeout(10000);
  await page.exposeFunction('__shotResize',async expanded=>page.setViewportSize(expanded?{width:376,height:760}:{width:96,height:96}));
  page.on('pageerror',e=>errors.push(`${role}/${theme}: ${e.message}`));
  await page.addInitScript(({role,theme,image,warmMenu})=>{
    const strokeRect=CanvasRenderingContext2D.prototype.strokeRect;
    CanvasRenderingContext2D.prototype.strokeRect=function(x,y,width,height){
      if(this.strokeStyle==='#60a5fa'&&width>20&&height>10)window.__textSelection={x,y,width,height};
      return strokeRect.call(this,x,y,width,height);
    };
    let id=0;const callbacks=new Map(),listeners=new Map();
    const label=role==='viewer'?'screenshot-viewer-2':`screenshot-${role}`;
    const shared={theme,lang:theme==='light'?'zh':'en',provider:{url:'https://api.example.com/v1/chat/completions',model:'vision-test'}};
    window.__shotContext=shared;window.__shotAiFailure='';window.__shotAiDeferred=false;window.__shotKeyMissing=false;
    window.__localReady=true;window.__localTarget='zh-Hans';window.__localFailure='';
    const shot={id:2,width:1400,height:900,time:Date.now(),image};
    window.__shotHistory=role==='history'?Array.from({length:6},(_,i)=>({...shot,id:i+2})):[shot,{...shot,id:3}];window.__shotHistoryFailure=false;
    window.__menu=warmMenu?null:{token:1,entryId:null,kind:'',expanded:false,recording:true};
    window.__phrases=[];window.__phraseId=100;
    window.__shotCalls=[];
    window.__shotEmit=(event,payload)=>{for(const [eid,l]of listeners)if(l.event===event)callbacks.get(l.handler)?.({event,id:eid,payload});};
    window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:(_,eid)=>listeners.delete(eid)};
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label},currentWebview:{label}},transformCallback:f=>{callbacks.set(++id,f);return id;},unregisterCallback:i=>callbacks.delete(i),
      invoke:async(command,args={})=>{
        window.__shotCalls.push({command,args});
        if(command==='plugin:event|listen'){listeners.set(++id,args);return id;}
        if(command==='plugin:event|unlisten')return;
        if(command.startsWith('plugin:window|'))return;
        if(command==='get_output_root')return 'C:/TestOutput';
        if(command==='get_default_output_root')return 'C:/TestOutput';
        if(command==='open_path')return;
        if(command==='clipboard_history'){
          if(window.__shotHistoryFailure)throw 'clipboard:key-missing';
          const r=args.request;
          const records=window.__shotHistory.map(s=>({kind:'image',capturedAt:s.time,offsetMinutes:480,thumbnail:s.image,source:'WeChat.exe',...s}));
          if(r.action==='status')return {enabled:!window.__paused,total:records.length};
          if(r.action==='start'||r.action==='stop'){
            if(window.__monitorDelay)await new Promise(resolve=>window.__resolveMonitor=resolve);
            if(window.__monitorFailure)throw 'clipboard:storage-failed';
            window.__paused=r.action==='stop';return {enabled:!window.__paused};
          }
          if(r.action==='list'){
            const list=records.filter(s=>(!r.query.kind||s.kind===r.query.kind)&&(!r.query.search||[s.text,s.preview,s.note,s.source,...(s.paths||[])].filter(Boolean).join('\n').toLowerCase().includes(r.query.search.toLowerCase())));
            if(r.query.search&&r.query.search===window.__delaySearch)await new Promise(resolve=>window.__releaseSearch=resolve);
            return {items:list.slice(0,r.query.limit||50),next:null,snapshot:100};
          }
          if(r.action==='delete'){
            if(window.__deleteFailure)throw 'clipboard:storage-failed';
            window.__shotHistory=window.__shotHistory.filter(s=>!r.ids.includes(s.id));window.__shotEmit('clipboard-history-changed');return {enabled:!window.__paused};
          }
          if(r.action==='detail'||r.action==='entry')return structuredClone(records.find(s=>s.id===r.id));
          if(r.action==='note'){
            if(window.__noteFailure)throw 'clipboard:storage-failed';
            window.__shotHistory.find(s=>s.id===r.id).note=r.note;window.__shotEmit('clipboard-history-changed',{recordId:r.id});return {};
          }
          if(r.action==='phraseList'){
            const after=r.query.before?window.__phrases.findIndex(p=>p.id===r.query.before)+1:0;
            const list=window.__phrases.slice(after).filter(p=>[p.title,p.text].join('\n').toLowerCase().includes((r.query.search||'').toLowerCase()));
            return {items:structuredClone(list.slice(0,50)),next:list.length>50?list[49].id:null};
          }
          if(r.action==='phraseDetail')return structuredClone(window.__phrases.find(p=>p.id===r.id));
          if(r.action==='phraseSave'||r.action==='phraseFromHistory'){
            if(window.__phraseFailure)throw 'clipboard:storage-failed';
            const source=r.action==='phraseFromHistory'?records.find(s=>s.id===r.id):null;
            if(source&&source.kind!=='text')throw 'clipboard:phrase-text-only';
            const data=source?{title:source.text.slice(0,60),text:source.text,note:''}:r;
            const existing=r.action==='phraseSave'&&r.id?window.__phrases.find(p=>p.id===r.id):null;
            if(window.__phrases.some(p=>p.id!==existing?.id&&p.text===data.text))throw 'clipboard:phrase-duplicate';
            const value={id:existing?.id||++window.__phraseId,title:data.title,text:data.text,note:data.note,createdAt:existing?.createdAt||Date.now(),updatedAt:Date.now()};
            if(existing)window.__phrases.splice(window.__phrases.indexOf(existing),1,value);else window.__phrases.unshift(value);
            window.__shotEmit('clipboard-history-changed',{library:true});return structuredClone(value);
          }
          if(r.action==='phraseDelete'){window.__phrases=window.__phrases.filter(p=>p.id!==r.id);window.__shotEmit('clipboard-history-changed',{library:true});return {};}
          if(r.action==='phraseCopy'){window.__lastPhraseCopy=window.__phrases.find(p=>p.id===r.id).text;return {};}
          if(r.action==='reorder'){
            if(window.__reorderFailure)throw 'clipboard:storage-failed';
            const items=r.collection==='phrases'?window.__phrases:window.__shotHistory;
            const from=items.findIndex(p=>p.id===r.id),item=items.splice(from,1)[0],target=items.findIndex(p=>p.id===r.targetId);
            items.splice(target+(r.after?1:0),0,item);window.__shotEmit('clipboard-history-changed',{library:r.collection==='phrases'});return {};
          }
          if(r.action==='drag'){
            window.__dragPayload=structuredClone(r.collection==='phrases'?window.__phrases.find(p=>p.id===r.id):window.__shotHistory.find(p=>p.id===r.id));
            if(window.__dragDeferred)await new Promise(resolve=>window.__releaseDrag=resolve);
            return {accepted:false};
          }
          if(r.action==='copy'||r.action==='pin')return {enabled:!window.__paused};
        }
        if(command==='load_ai_api_key')return window.__shotKeyMissing?'':'local-test-key';
        if(command==='local_translation'){
          const r=args.request;
          if(r.action==='status')return {ready:window.__localReady,targetLanguage:window.__localTarget};
          if(r.action==='target'){window.__localTarget=r.target;return {ready:true,targetLanguage:r.target};}
          if(r.action==='cancel')return null;
          if(r.action==='translate'){
            if(window.__localFailure)throw window.__localFailure;
            if(window.__localDeferred)return new Promise(resolve=>{window.__localFinish=()=>resolve({results:r.texts.map(()=> 'Late translation')});});
            return {results:r.texts.map((_,i)=>window.__shotLongTranslation&&i===0?'A very long translation\n'.repeat(140):i===0?'Translated':'Second line')};
          }
        }
        if(command==='request_private_ai_completion'){
          if(window.__shotAiFailure)throw window.__shotAiFailure;
          if(window.__shotAiDeferred)return new Promise(resolve=>{window.__shotFinishAi=()=>resolve({content:'Late result must be ignored'});});
          const structured=args.request.messages.some(m=>m.role==='system');
          if(!structured)return {content:'Extracted sample text'};
          const user=args.request.messages.find(m=>m.role==='user'),vision=Array.isArray(user.content);
          const input=JSON.parse(vision?user.content[0].text:user.content),batch=input.blocks||input.lines;
          if(vision&&window.__shotRejectVision)throw 'ai-provider:http_error:400';
          if(vision&&window.__shotTruncateRemaining>0){window.__shotTruncateRemaining--;throw 'ai-provider:response_truncated';}
          if(vision&&window.__shotTruncateMulti&&batch.length>1)throw 'ai-provider:response_truncated';
          if(!vision&&window.__shotMalformedPart&&batch.some(line=>line.id===1))return {content:'[]'};
          return {content:JSON.stringify(batch.map(line=>({id:line.id,text:vision?`Corrected text ${line.id}`:
            window.__shotLongTranslation&&line.id===0?'A very long translation\n'.repeat(140):line.id===0?'Translated':'Second line'})))};
        }
        if(command==='cancel_private_ai_completion')return;
        if(command==='quick_screenshot'){
          const r=args.request;
          if(r.action==='hide-history'||r.action==='close-history'){
            if(window.__hideFailure)throw 'screenshot:window-hide-failed';
            window.__nativeHistoryHidden=true;return null;
          }
          if(r.action==='history-menu'&&window.__nativeHistoryHidden)throw 'screenshot:expired';
          if(r.action==='menu-boot')return {context:structuredClone(shared),menu:structuredClone(window.__menu)};
          if(r.action==='menu-ready'){window.__menuReadyMs=performance.now()-window.__menuStarted;return null;}
          if(r.action==='menu-select'){
            if(window.__delayMenuSelect)await new Promise((resolve,reject)=>{window.__resolveMenuSelect=resolve;window.__rejectMenuSelect=reject;});
            return null;
          }
          if(r.action==='menu-dismiss')return null;
          if(r.action==='boot')return {context:structuredClone(shared),feedback:{revision:1,kind:'copied',lang:shared.lang},session:1,shot,desktop:{bounds:{x:-1400,y:-100,width:1400,height:900},windows:[{x:-1300,y:-20,width:800,height:440}],monitors:[{x:-1400,y:-100,width:1400,height:900}]},image};
          if(r.action==='metadata')return {context:structuredClone(shared)};
          if(r.action==='expand'){
            if(window.__shotExpandFailure)throw new Error('Window temporarily unavailable');
            await window.__shotResize(r.expanded);
            return {origin:r.expanded?{x:188,y:48}:{x:48,y:48},width:r.expanded?376:96,height:r.expanded?760:96};
          }
          if(r.action==='save')return 'C:/TestOutput/Screenshots/test.png';
          if(r.action==='ocr')return {text:'Scrambled fallback',lines:[{id:1,text:'Second line',x:50,y:110,width:240,height:24},{id:0,text:'Sample text',x:50,y:50,width:240,height:44}]};
          if(r.action==='confirm'||r.action==='cancel'||r.action==='pin')window.__shotEmit('screenshot-ended');
          return null;
        }
        throw new Error(`Unexpected command: ${command}`);
      }};
  },{role,theme,image,warmMenu});
  await page.goto(`${url}screenshot.html?role=${role}`);
  return {page,context};
}
try{
  for(const [theme,width,height,dpr]of [['light',1400,900,1],['dark',1400,900,1],['light',740,480,2],['dark',740,480,2]]){
    if(process.env.TOOLKNIT_SHOT_SCOPE==='history')break;
    const {page,context}=await open('capture',theme,width,height,dpr);
    await page.waitForFunction(()=>window.__shotCalls.some(c=>c.args?.request?.action==='ready'));
    await page.mouse.move(width*.2,height*.2);await page.mouse.click(width*.2,height*.2);
    await page.locator('#shotToolbar').waitFor({state:'visible'});
    await page.waitForFunction(()=>{const r=document.getElementById('shotToolbar').getBoundingClientRect();return r.right<=innerWidth+1&&r.bottom<=innerHeight+1;});
    const box=await page.locator('#shotToolbar').boundingBox();
    assert.ok(box.x>=8&&box.y>=8&&box.x+box.width<=width-7&&box.y+box.height<=height-7,JSON.stringify(box));
    if(width===1400)assert.ok(box.width<1000,'toolbar must fit its contents instead of stretching to the screen edge');
    assert.ok(await page.locator('#shotToolbar').evaluate(el=>{
      const bounds=el.getBoundingClientRect();return [...el.querySelectorAll('button,input')].every(control=>{
        const r=control.getBoundingClientRect();return r.left>=bounds.left&&r.right<=bounds.right&&r.bottom<=bounds.bottom;
      });
    }),'toolbar controls wrap within the available width');
    const drawStroke=async(points)=>{
      await page.locator('.app-toast-close').evaluateAll(buttons=>buttons.forEach(button=>button.click()));
      await page.waitForFunction(()=>document.querySelectorAll('.app-toast').length===0);
      await page.mouse.move(points[0][0]*width/1400,points[0][1]*height/900);await page.mouse.down();
      for(const [x,y]of points.slice(1))await page.mouse.move(x*width/1400,y*height/900,{steps:8});
      await page.mouse.up();
    };
    const exportShot=async()=>{
      const count=await page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='copy').length);
      await page.locator('#shotCanvas').focus();await page.keyboard.press('Control+c');
      await page.waitForFunction(n=>window.__shotCalls.filter(c=>c.args?.request?.action==='copy').length>n,count);
      await page.waitForFunction(()=>document.getElementById('shotBusy').hidden);
      const request=await page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='copy').at(-1).args.request);
      const img=await loadImage(request.image),buffer=createCanvas(img.width,img.height),c=buffer.getContext('2d');c.drawImage(img,0,0);
      return (x,y)=>[...c.getImageData(x-request.origin[0],y-request.origin[1],1,1).data];
    };
    const editorPixel=async(x,y)=>page.locator('#shotCanvas').evaluate((c,[x,y])=>[...c.getContext('2d').getImageData(Math.round(x*c.width/1400),Math.round(y*c.height/900),1,1).data],[x,y]);
    await page.locator('[data-shot-action="rectangle"]').click();
    await page.mouse.move(width*.3,height*.25);await page.mouse.down();await page.mouse.move(width*.4,height*.33,{steps:8});await page.mouse.up();
    assert.equal(await page.locator('[data-shot-action="select"]').getAttribute('aria-pressed'),'true','drawing a shape immediately selects it');
    const nonblank=await page.locator('#shotCanvas').evaluate(c=>[...c.getContext('2d').getImageData(0,0,1,1).data]);assert.ok(nonblank[3]>0);
    await drawStroke([[470,250],[500,270]]);
    const moved=await exportShot();assert.deepEqual(moved(450,270),[239,68,68,255],'new shape moves without reselecting a tool');assert.deepEqual(moved(420,255),[255,255,255,255]);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');assert.equal(await page.locator('[data-shot-action="redo"]').isEnabled(),true);
    await page.keyboard.press('Control+y');await page.keyboard.press('Control+y');
    await page.mouse.click(500*width/1400,270*height/900);await page.keyboard.press('Delete');
    for(const kind of ['ellipse','arrow']){
      await page.locator(`[data-shot-action="${kind}"]`).click();await drawStroke([[420,225],[560,297]]);
      assert.equal(await page.locator('[data-shot-action="select"]').getAttribute('aria-pressed'),'true');await page.keyboard.press('Delete');
    }
    await page.locator('[data-shot-action="brush"]').click();await drawStroke([[400,360],[520,370]]);
    assert.equal(await page.locator('[data-shot-action="brush"]').getAttribute('aria-pressed'),'true','brush remains active for continuous painting');
    const brush=(await exportShot())(460,365);assert.deepEqual(brush,[239,68,68,255]);
    await page.locator('[data-shot-action="select"]').click();await drawStroke([[460,365],[468,370]]);await page.keyboard.press('Delete');
    assert.deepEqual((await exportShot())(460,365),brush,'painted brush strokes cannot be selected, moved or deleted as layers');
    await page.keyboard.press('Control+z');
    await page.locator('[data-shot-action="mosaic"]').click();await drawStroke([[300,250],[360,250],[360,310]]);
    const originalMosaicPixel=[...ctx.getImageData(332,250,1,1).data];
    const painted=await exportShot();assert.deepEqual(painted(332,250),painted(334,250),'pixels in a painted mosaic block match across the textured fixture');
    assert.deepEqual(painted(320,290),[20,150,92,255],'unpainted area within the path bounds stays intact');
    await page.locator('[data-shot-action="select"]').click();await drawStroke([[320,250],[328,255]]);await page.keyboard.press('Delete');
    assert.deepEqual((await exportShot())(332,250),painted(332,250),'mosaic strokes stay fixed after selection and dragging');
    await page.keyboard.press('Control+z');await page.keyboard.press('Control+z');
    const undone=await exportShot();assert.deepEqual(undone(332,250),originalMosaicPixel,'undo removes the mosaic stroke');
    assert.notDeepEqual(undone(332,250),undone(334,250),'undo restores texture inside the previously pixelated block');
    await page.keyboard.press('Control+y');assert.deepEqual((await exportShot())(332,250),painted(332,250),'redo restores the painted mosaic');
    const original=page.locator('[data-shot-action="original"]'),originalBox=await original.boundingBox();
    await page.mouse.move(originalBox.x+18,originalBox.y+18);await page.mouse.down();
    assert.equal(await original.getAttribute('aria-pressed'),'true');assert.equal((await editorPixel(460,365))[3],0,'holding compare hides annotations');
    await page.mouse.move(width-2,height-2);await page.mouse.up();
    assert.equal(await original.getAttribute('aria-pressed'),'false');assert.ok((await editorPixel(460,365))[3]>0,'release outside the button restores edits');
    await original.click();assert.equal(await original.getAttribute('aria-pressed'),'false','clicking compare does not toggle it on');
    await original.hover();await page.mouse.down();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    assert.equal(await original.getAttribute('aria-pressed'),'false','losing focus restores edits');await page.mouse.up();
    await original.hover();await page.mouse.down();await original.dispatchEvent('pointercancel');
    assert.equal(await original.getAttribute('aria-pressed'),'false','pointer cancellation restores edits');await page.mouse.up();
    for(const key of ['Space','Enter']){
      await original.focus();await page.keyboard.down(key);assert.equal(await original.getAttribute('aria-pressed'),'true');
      await page.keyboard.up(key);assert.equal(await original.getAttribute('aria-pressed'),'false');
    }
    assert.ok(await page.evaluate(()=>!window.__shotCalls.some(c=>c.args?.request?.action==='confirm')),'keyboard compare must not confirm the screenshot');
    await page.screenshot({path:path.join(out,`capture-toolbar-${theme}-${width}.png`)});
    await page.locator('[data-shot-action="text"]').click();await page.mouse.click(width*.25,height*.4);
    await page.locator('#shotDialog textarea').fill('A sample annotation with multiple words');
    await page.locator('#shotDialogCopy').click();
    assert.equal(await page.locator('#shotDialog').isVisible(),true,'copy keeps editing open');
    assert.ok(await page.locator('#shotDialogCopy').evaluate(el=>{const r=el.getBoundingClientRect();return r.width===r.height&&getComputedStyle(el).borderRadius==='50%';}));
    assert.equal(await page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='copy-text').at(-1).args.request.text),'A sample annotation with multiple words');
    await page.locator('#shotDialog textarea').fill('Edited text copied live');await page.locator('#shotDialogCopy').click();
    assert.equal(await page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='copy-text').at(-1).args.request.text),'Edited text copied live');
    await page.locator('#shotDialogOk').click();
    const longSelection=await page.evaluate(()=>window.__textSelection);
    assert.ok(longSelection.width<600,'ordinary text no longer keeps the remaining crop width');
    await page.locator('.app-toast-close').evaluateAll(buttons=>buttons.forEach(button=>button.click()));
    await page.waitForFunction(()=>document.querySelectorAll('.app-toast').length===0);
    await page.mouse.dblclick((longSelection.x+longSelection.width*.3)*width/1400,(longSelection.y+longSelection.height/2)*height/900);
    await page.locator('#shotDialog textarea').fill('中文\n测试');await page.locator('#shotDialogOk').click();
    const shortSelection=await page.evaluate(()=>window.__textSelection);
    assert.ok(shortSelection.width<longSelection.width/2,'editing shorter CJK text tightens its eight handles');
    const expectedWidth=await page.evaluate(()=>{
      const c=document.createElement('canvas').getContext('2d');c.font='28px sans-serif';
      return Math.max(c.measureText('中文').width,c.measureText('测试').width);
    });
    assert.ok(Math.abs(shortSelection.width-expectedWidth)<8,'CJK selection hugs measured text width');
    await page.locator('#shotFont').fill('40');await page.locator('#shotFont').dispatchEvent('change');
    const largeSelection=await page.evaluate(()=>window.__textSelection);
    assert.ok(largeSelection.width>shortSelection.width&&largeSelection.height>shortSelection.height,'font changes resize both handle axes');
    await page.locator('[data-shot-action="ocr"]').click();
    await page.locator('#shotDialog textarea').waitFor();assert.equal(await page.locator('#shotDialog textarea').inputValue(),'Sample text\nSecond line');
    await page.locator('#shotDialogOk').click();
    await page.locator('[data-shot-action="ai-extract"]').click();await page.locator('#shotDialog textarea').waitFor();
    assert.equal(await page.locator('#shotDialog textarea').inputValue(),'Extracted sample text');await page.locator('#shotDialogOk').click();
    assert.ok(await page.evaluate(()=>window.__shotCalls.some(c=>c.command==='request_private_ai_completion'&&c.args.request.temperature===0&&c.args.request.messages[0].content[1].image_url.url.startsWith('data:image/png;')&&c.args.request.messages[0].content[1].image_url.detail==='high')),'AI extraction uses a lossless detailed image without a declaration checkbox');
    const language=theme==='light'?'zh':'en',texts=locales[language];
    const clearToasts=async()=>{
      await page.locator('.app-toast-close').evaluateAll(buttons=>buttons.forEach(button=>button.click()));
      await page.waitForFunction(()=>document.querySelectorAll('.app-toast').length===0);
    };
    const expectToast=async key=>{
      const message=page.locator('.app-toast-message').filter({hasText:texts[key]}).last();
      try { await message.waitFor({state:'visible'}); }
      catch(error) {
        console.error(await page.evaluate(()=>({toasts:[...document.querySelectorAll('.app-toast-message')].map(el=>el.textContent),dialog:document.querySelector('#shotDialog textarea')?.value,requests:window.__shotCalls.filter(c=>c.command==='request_private_ai_completion').slice(-4).map(c=>({tokens:c.args.request.maxTokens,vision:Array.isArray(c.args.request.messages.at(-1).content)}))})));
        throw error;
      }
      await message.evaluate(el=>Promise.all(el.parentElement.getAnimations().map(animation=>animation.finished)));
      await page.waitForFunction(()=>document.getElementById('shotBusy').hidden);
      const colors=await message.evaluate(el=>{const style=getComputedStyle(el.parentElement);return {background:style.backgroundColor,color:style.color};});
      assert.notEqual(colors.background,colors.color,'feedback remains readable in either theme');
      if(theme==='dark')assert.equal(colors.background,'rgb(25, 25, 25)');
      assert.ok(await page.locator('[data-shot-action="ai-extract"]').isEnabled(),'failure must restore the toolbar');
    };
    for(const [failure,key]of [
      ['ai-provider:http_error:401','aiUnauthorized'],['ai-provider:http_error:404','aiNotFound'],
      ['ai-provider:http_error:429','aiRateLimited'],['ai-provider:http_error:503','aiProviderUnavailable'],
      ['ai-provider:network_error','aiNetwork'],['ai-provider:timeout','aiTimeout'],
      ['ai-provider:empty_response','aiEmpty'],['ai-provider:invalid_response','aiInvalidResponse'],
      ['ai-provider:response_truncated','aiTruncated'],['ai-provider:response_too_large','aiTooLarge']
    ]){
      await clearToasts();await page.evaluate(value=>{window.__shotAiFailure=value;},failure);
      await page.locator('[data-shot-action="ai-extract"]').click();await expectToast(key);
      if(key==='aiUnauthorized')await page.screenshot({path:path.join(out,`ai-error-${theme}-${width}.png`)});
    }
    await clearToasts();await page.evaluate(()=>{window.__shotAiFailure='';window.__shotKeyMissing=true;});
    await page.locator('[data-shot-action="ai-extract"]').click();await expectToast('aiInvalidConfig');
    await page.evaluate(()=>{window.__shotKeyMissing=false;window.__shotContext.provider.url='https://api.example.com/v1';window.__shotEmit('screenshot-context-changed');});
    await clearToasts();await page.evaluate(()=>{delete window.__shotFinishAi;window.__shotAiDeferred=true;});
    await page.locator('[data-shot-action="ai-extract"]').click();await page.locator('#shotBusy').waitFor({state:'visible'});
    await page.waitForFunction(()=>typeof window.__shotFinishAi==='function');
    await page.locator('#shotAbort').click();await expectToast('cancelled');
    await page.evaluate(()=>{window.__shotFinishAi();window.__shotAiDeferred=false;});
    await page.locator('[data-shot-action="ai-extract"]').click();await page.locator('#shotDialog textarea').waitFor();
    assert.equal(await page.locator('#shotDialog textarea').inputValue(),'Extracted sample text','cancelled response cannot overwrite a new action');
    assert.ok(await page.evaluate(()=>window.__shotCalls.some(c=>c.command==='request_private_ai_completion'&&c.args.request.url==='https://api.example.com/v1/chat/completions')));
    await page.locator('#shotDialogOk').click();
    await clearToasts();await page.evaluate(()=>{delete window.__shotFinishAi;window.__shotAiDeferred=true;});
    await page.locator('[data-shot-action="ai-extract"]').click();await page.locator('#shotBusy').waitFor({state:'visible'});
    await page.waitForFunction(()=>typeof window.__shotFinishAi==='function');
    await page.evaluate(()=>{window.__shotContext.provider.model='changed-vision';window.__shotEmit('screenshot-context-changed');});
    await expectToast('providerChanged');
    await page.evaluate(()=>{window.__shotFinishAi();window.__shotAiDeferred=false;});
    await page.locator('[data-shot-action="ai-translate"]').click();await page.waitForFunction(()=>document.getElementById('shotBusy').hidden);
    await expectToast('translated');
    const translationCalls=await page.evaluate(()=>window.__shotCalls.filter(c=>c.command==='request_private_ai_completion'&&c.args.request.messages.some(m=>m.role==='system')));
    assert.ok(translationCalls.length);
    assert.ok(translationCalls.some(c=>Array.isArray(c.args.request.messages[1].content)),'translation first corrects OCR against the image');
    const textCalls=translationCalls.filter(c=>typeof c.args.request.messages[1].content==='string');
    assert.equal(textCalls.length,0,'translation never sends text to the external AI');
    assert.ok(await page.evaluate(()=>window.__shotCalls.filter(c=>c.command==='local_translation'&&c.args.request.action==='translate').at(-1).args.request.texts.every(t=>t.startsWith('Corrected text'))),'corrected extraction feeds the local engine');
    for(const call of translationCalls){assert.equal(call.args.request.temperature,0);assert.ok(call.args.request.maxTokens>=4096&&call.args.request.maxTokens<=16384);}
    const ocrCount=await page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='ocr').length);
    const visionCount=await page.evaluate(()=>window.__shotCalls.filter(c=>c.command==='request_private_ai_completion'&&c.args.request.messages.some(m=>m.role==='system')&&Array.isArray(c.args.request.messages[1].content)).length);
    await clearToasts();await page.locator('[data-shot-action="ai-translate"]').click();await expectToast('translated');
    assert.equal(await page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='ocr').length),ocrCount,'repeat translation reuses OCR of the unchanged source');
    assert.equal(await page.evaluate(()=>window.__shotCalls.filter(c=>c.command==='request_private_ai_completion'&&c.args.request.messages.some(m=>m.role==='system')&&Array.isArray(c.args.request.messages[1].content)).length),visionCount,'repeat translation reuses image correction');
    await clearToasts();await page.evaluate(()=>{window.__shotContext.lang=window.__shotContext.lang==='zh'?'en':'zh';window.__shotEmit('screenshot-context-changed');});
    await page.locator('[data-shot-action="ai-translate"]').click();
    await page.waitForFunction(()=>document.getElementById('shotBusy').hidden);
    assert.equal(await page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='ocr').length),ocrCount+1,'a language change invalidates OCR anchors');
    assert.equal(await page.evaluate(()=>window.__shotCalls.filter(c=>c.command==='request_private_ai_completion'&&c.args.request.messages.some(m=>m.role==='system')&&Array.isArray(c.args.request.messages[1].content)).length),visionCount+1,'image correction must use the current language anchors');
    await clearToasts();await page.evaluate(value=>{window.__shotContext.lang=value;window.__shotEmit('screenshot-context-changed');},language);
    await clearToasts();await page.evaluate(()=>{window.__shotTruncateRemaining=1;window.__shotContext.provider.model='retry-vision';window.__shotEmit('screenshot-context-changed');});
    await page.locator('[data-shot-action="ai-translate"]').click();await expectToast('translated');
    assert.ok(await page.evaluate(()=>window.__shotCalls.some(c=>c.command==='request_private_ai_completion'&&c.args.request.maxTokens===16384)),'a truncated response retries with a larger budget');
    await clearToasts();await page.evaluate(()=>{window.__shotTruncateMulti=true;window.__shotContext.provider.model='split-vision';window.__shotEmit('screenshot-context-changed');});
    await page.locator('[data-shot-action="ai-translate"]').click();await expectToast('translated');
    assert.ok(await page.evaluate(()=>window.__shotCalls.some(c=>c.command==='request_private_ai_completion'&&Array.isArray(c.args.request.messages[1]?.content)&&JSON.parse(c.args.request.messages[1].content[0].text).blocks?.length===1)),'persistent recognition truncation splits the failing batch');
    await clearToasts();await page.evaluate(()=>{window.__shotTruncateMulti=false;window.__shotRejectVision=true;window.__shotContext.provider.model='text-only';window.__shotEmit('screenshot-context-changed');});
    const localCalls=()=>page.evaluate(()=>window.__shotCalls.filter(c=>c.command==='local_translation'&&c.args.request.action==='translate').length);
    const beforeFallback=await localCalls();
    await page.locator('[data-shot-action="ai-translate"]').click();await page.locator('#shotDialogCancel').waitFor({state:'visible'});
    assert.ok((await page.locator('#shotDialogContent').textContent()).includes(texts.fallbackPrompt));
    assert.equal(await localCalls(),beforeFallback,'no silent fallback');
    await page.locator('#shotDialogCancel').click();await page.waitForFunction(()=>document.getElementById('shotBusy').hidden);
    assert.equal(await localCalls(),beforeFallback,'declining leaves the screenshot unchanged');
    await page.locator('[data-shot-action="ai-translate"]').click();await page.locator('#shotDialogOk').click();await expectToast('translated');
    assert.deepEqual(await page.evaluate(()=>window.__shotCalls.filter(c=>c.command==='local_translation'&&c.args.request.action==='translate').at(-1).args.request.texts),['Sample text','Second line']);
    await clearToasts();await page.evaluate(()=>{window.__shotRejectVision=false;window.__shotKeyMissing=true;});
    const beforeNoKey=await page.evaluate(()=>window.__shotCalls.filter(c=>c.command==='request_private_ai_completion').length);
    await page.locator('[data-shot-action="ai-translate"]').click();await expectToast('translated');
    assert.equal(await page.evaluate(()=>window.__shotCalls.filter(c=>c.command==='request_private_ai_completion').length),beforeNoKey,'no AI key uses OCR directly');
    await clearToasts();await page.evaluate(()=>{window.__localReady=false;});
    const beforeMissing=await page.evaluate(()=>window.__shotCalls.filter(c=>c.command==='request_private_ai_completion'||c.args.request?.action==='ocr'||c.args.request?.action==='translate').length);
    await page.locator('[data-shot-action="ai-translate"]').click();await expectToast('localMissing');
    assert.equal(await page.evaluate(()=>window.__shotCalls.filter(c=>c.command==='request_private_ai_completion'||c.args.request?.action==='ocr'||c.args.request?.action==='translate').length),beforeMissing,'readiness gate precedes extraction');
    await clearToasts();await page.evaluate(()=>{window.__localReady=true;window.__localFailure='translation:timeout';});
    await page.locator('[data-shot-action="ai-translate"]').click();await expectToast('localTimeout');
    await clearToasts();await page.evaluate(()=>{window.__localFailure='';window.__localDeferred=true;});
    await page.locator('[data-shot-action="ai-translate"]').click();await page.waitForFunction(()=>typeof window.__localFinish==='function');
    await page.locator('#shotAbort').click();await expectToast('cancelled');
    await page.evaluate(()=>{window.__localFinish();window.__localDeferred=false;});
    await page.locator('[data-shot-action="ai-translate"]').click();await expectToast('translated');
    assert.ok(await page.evaluate(()=>window.__shotCalls.some(c=>c.command==='local_translation'&&c.args.request.action==='cancel')));
    const languageTrigger=page.locator('#shotLanguage + .tool-custom-select button');
    await languageTrigger.click();
    assert.equal(await page.locator('.tool-custom-select-menu:not([hidden]) [role="option"]').count(),2);
    await page.locator('.tool-custom-select-menu:not([hidden]) [data-tool-select-value="en"]').click();
    assert.equal(await languageTrigger.getAttribute('aria-expanded'),'false');
    await page.waitForFunction(()=>window.__localTarget==='en');
    assert.equal(await page.locator('#shotLanguage option').count(),2);
    await page.locator('[data-shot-action="ai-translate"]').click();await expectToast('translated');
    assert.equal(await page.evaluate(()=>window.__shotCalls.filter(c=>c.command==='local_translation'&&c.args.request.action==='translate').at(-1).args.request.target),'en');
    await page.evaluate(()=>{window.__shotKeyMissing=false;});
    await clearToasts();await page.evaluate(()=>{window.__shotRejectVision=false;window.__shotContext.provider.model='vision-restored';window.__shotEmit('screenshot-context-changed');});
    await clearToasts();await page.evaluate(()=>{window.__shotLongTranslation=true;});
    await page.locator('[data-shot-action="ai-translate"]').click();await page.locator('#shotDialog textarea').waitFor();
    assert.match(await page.locator('#shotDialog textarea').inputValue(),/A very long translation/,'overflow retains complete translation text');
    assert.ok(await page.locator('#shotDialogContent p').filter({hasText:texts.translationPartial.split('{count}')[0]}).count());
    assert.equal(await page.locator('.app-toast').count(),0,'partial translation explains its count inside the result dialog without covering it');
    await page.screenshot({path:path.join(out,`translation-partial-${theme}-${width}.png`)});
    await page.locator('#shotDialogOk').click();await page.evaluate(()=>{window.__shotLongTranslation=false;});await clearToasts();
    await page.locator('[data-shot-action="ai-translate"]').click();await expectToast('translated');
    await page.locator('[data-shot-action="save"]').click();await page.locator('#shotDialogFolder').waitFor({state:'visible'});
    await page.screenshot({path:path.join(out,`capture-${theme}-${width}.png`)});
    const beforeReveal=await page.evaluate(()=>window.__shotCalls.length);
    await page.locator('#shotDialogFolder').click();
    await page.waitForFunction(()=>window.__shotCalls.some(c=>c.command==='open_path'&&c.args.path==='C:/TestOutput/Screenshots/test.png'));
    const revealCalls=await page.evaluate(start=>window.__shotCalls.slice(start),beforeReveal);
    assert.ok(revealCalls.findIndex(c=>c.args?.request?.action==='cancel')<revealCalls.findIndex(c=>c.command==='open_path'),'capture ends before revealing the saved file');
    assert.ok(revealCalls.some(c=>c.args?.request?.action==='cancel'),'Open folder exits capture');
    assert.equal(await page.locator('#shotToolbar').isVisible(),false);
    assert.equal(await page.locator('#shotDialog').isVisible(),false);
    await page.evaluate(()=>window.__shotEmit('screenshot-opened',2));
    await page.waitForFunction(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='ready').length===2);
    await page.mouse.click(width*.3,height*.25);
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.__shotCalls.some(c=>c.args?.request?.action==='confirm'));
    assert.equal(await page.locator('#shotToolbar').isVisible(),false);
    await page.evaluate(()=>window.__shotEmit('screenshot-opened',2));
    await page.waitForFunction(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='ready').length===3);
    await page.keyboard.press('Escape');
    results.push(`capture ${theme} ${width}x${height} DPR${dpr}: compact toolbar, auto-select/drag shapes, fixed brush/mosaic, stroke pixels, undo/redo, hold compare, ordered OCR, AI success/error Toast, missing key, cancel/late result, provider change, output, reopen`);await context.close();
  }
  for(const theme of ['light','dark']){
    const {page,context}=await open('viewer',theme,1000,720);
    await page.locator('#shotZoomValue').waitFor();await page.locator('[data-shot-action="actual"]').click();
    assert.equal(await page.locator('.tool-page-v2-title').count(),0,'viewer must not render the duplicate right-side title');
    assert.match(await page.locator('.tool-page-v2-tag').textContent(),/SCREENSHOT VIEWER/);
    assert.equal(await page.locator('#shotZoomValue').textContent(),'100%');
    await page.locator('[data-shot-action="zoom-in"]').click();assert.equal(await page.locator('#shotZoomValue').textContent(),'125%');
    await page.locator('#shotPin').uncheck();
    await page.evaluate(()=>{window.__shotEmit('screenshot-ended');window.__shotEmit('screenshot-opened',2);});
    assert.ok(await page.locator('#shotViewImage').evaluate(img=>img.complete&&img.naturalWidth>0),'another capture must not clear the viewer');
    await page.locator('[data-shot-action="zoom-in"]').click();assert.equal(await page.locator('#shotZoomValue').textContent(),'156%');
    await page.locator('[data-shot-action="save"]').click();await page.locator('#shotDialogFolder').waitFor({state:'visible'});
    await page.screenshot({path:path.join(out,`viewer-${theme}.png`)});
    await page.locator('#shotDialogFolder').click();
    await page.waitForFunction(()=>window.__shotCalls.some(c=>c.command==='open_path'&&c.args.path==='C:/TestOutput/Screenshots/test.png'));
    assert.ok(await page.locator('#shotViewImage').isVisible(),'revealing a file keeps the viewer open');
    assert.ok(await page.evaluate(()=>!window.__shotCalls.some(c=>c.args?.request?.action==='cancel')),'viewer reveal must not cancel another capture');
    results.push(`viewer ${theme}: shared chrome, zoom, pin, save`);await context.close();
    const shelf=await open('history',theme,96,96);
    await shelf.page.waitForFunction(()=>document.querySelectorAll('.shot-history-item').length===6);
    assert.ok(await shelf.page.locator('#shotHistoryBubble img').evaluate(img=>img.complete&&img.naturalWidth>0),'reuse the real logo asset');
    assert.equal(await shelf.page.locator('#shotHistoryPanel').isVisible(),false);
    assert.equal(await shelf.page.locator('#shotHistoryBubble').getAttribute('aria-expanded'),'false');
    assert.equal(await shelf.page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
    await shelf.page.mouse.move(48,48);
    assert.equal(await shelf.page.locator('#shotHistory').getAttribute('data-state'),'collapsed','hover must not resize the window');
    await shelf.page.screenshot({path:path.join(out,`history-${theme}-collapsed.png`)});
    await shelf.page.locator('#shotHistoryBubble').click();
    await shelf.page.waitForFunction(()=>document.getElementById('shotHistory').dataset.state==='expanded');
    const visibleCards=await shelf.page.locator('#shotHistoryList').evaluate(el=>[...el.children].filter(c=>{const r=c.getBoundingClientRect(),p=el.getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom+1;}).length);
    assert.ok(visibleCards>=1,'enlarged cards stay usable in the available height');
    assert.ok((await shelf.page.locator('.shot-history-content.is-image').first().boundingBox()).height>=130,'thumbnail has a readable preview area');
    assert.ok(await shelf.page.locator('#shotHistoryList').evaluate(el=>el.scrollHeight>el.clientHeight),'older images scroll');
    await shelf.page.evaluate(()=>{
      window.__existingCards=[...document.querySelectorAll('.shot-history-item')];
      window.__imageDecodes=0;
      const decode=HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode=function(){window.__imageDecodes++;return decode.call(this);};
      window.__shotEmit('clipboard-history-changed');
    });
    await shelf.page.waitForTimeout(100);
    assert.equal(await shelf.page.evaluate(()=>window.__imageDecodes),0,'unchanged history reuses decoded thumbnails');
    assert.ok(await shelf.page.evaluate(()=>window.__existingCards.every((card,i)=>card===document.querySelectorAll('.shot-history-item')[i])));
    assert.equal(await shelf.page.locator('#shotHistoryPanel').getAttribute('aria-hidden'),'false');
    assert.equal(await shelf.page.locator('#shotHistoryBubble').getAttribute('aria-expanded'),'true');
    await shelf.page.evaluate(()=>window.__shotEmit('screenshot-ended'));
    assert.equal(await shelf.page.locator('.shot-history-item').count(),6,'finishing a capture must not dispose the history window');
    await shelf.page.evaluate(()=>{window.__shotHistory.unshift({...window.__shotHistory[0],id:9});window.__shotEmit('clipboard-history-changed');});
    await shelf.page.waitForFunction(()=>document.querySelector('.shot-history-item')?.dataset.entryId==='9');
    assert.ok(await shelf.page.locator('.shot-history-item img').first().evaluate(img=>img.complete&&img.naturalWidth>0),'new thumbnail renders');
    assert.ok(await shelf.page.evaluate(()=>window.__existingCards.every(card=>card.isConnected)),'adding a capture preserves existing card nodes');
    assert.equal(await shelf.page.locator('#shotHistory').getAttribute('data-state'),'expanded','new captures must preserve the open panel');
    assert.equal(await shelf.page.locator('.shot-history-item').count(),7);
    await shelf.page.evaluate(()=>{window.__shotHistoryFailure=true;window.__shotEmit('clipboard-history-changed');});
    await shelf.page.locator('#shotHistoryStatus').waitFor({state:'visible'});
    assert.equal(await shelf.page.locator('.shot-history-item').count(),7,'failed refresh must keep the previous images');
    await shelf.page.evaluate(()=>{window.__shotHistoryFailure=false;});
    await shelf.page.locator('[data-shot-action="retry-history"]').click();
    await shelf.page.locator('#shotHistoryStatus').waitFor({state:'hidden'});
    for(let i=0;i<3;i++){
      await shelf.page.locator('[data-shot-action="collapse-history"]').click();
      await shelf.page.waitForFunction(()=>document.getElementById('shotHistory').dataset.state==='collapsed');
      assert.equal(await shelf.page.locator('#shotHistoryBubble').getAttribute('aria-expanded'),'false');
      assert.equal(await shelf.page.locator('#shotHistoryCount').textContent(),'7');
      await shelf.page.locator('#shotHistoryBubble').click();
      await shelf.page.evaluate(()=>{document.getElementById('shotHistoryBubble').click();document.getElementById('shotHistoryBubble').click();});
      await shelf.page.waitForFunction(()=>document.getElementById('shotHistory').dataset.state==='expanded');
      const expandCalls=await shelf.page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='expand').length);
      await shelf.page.evaluate(()=>{document.body.dispatchEvent(new PointerEvent('pointerenter'));document.body.dispatchEvent(new PointerEvent('pointerenter'));});
      assert.equal(await shelf.page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='expand').length),expandCalls,'hover must not change click-controlled state');
    }
    const dragCount=()=>shelf.page.evaluate(()=>window.__shotCalls.filter(c=>c.command==='plugin:window|start_dragging').length);
    const titleText=locales[theme==='light'?'zh':'en'];
    assert.deepEqual(await shelf.page.locator('#shotHistoryPanel header button').evaluateAll(nodes=>nodes.map(n=>n.dataset.shotAction)),['history-mode','history-menu','collapse-history']);
    assert.equal(await shelf.page.locator('#shotHistorySearchForm button[type="submit"]').count(),0);
    const settleTitle=()=>shelf.page.locator('#shotHistoryTitle').evaluate(async el=>{await Promise.allSettled(el.getAnimations({subtree:true}).map(a=>a.finished));});
    for(let i=0;i<3;i++){
      await shelf.page.locator('#shotHistoryMode').hover();
      await shelf.page.waitForFunction(()=>document.getElementById('shotHistoryTitle').dataset.preview==='true');
      if(i===0){
        const flips=await shelf.page.locator('.shot-title-hint>span').evaluateAll(nodes=>nodes.map(n=>({delay:getComputedStyle(n).transitionDelay,transform:getComputedStyle(n).transform})));
        assert.ok(new Set(flips.map(f=>f.delay)).size>3,'letters flip in staggered order');
        assert.ok(flips.some(f=>f.transform.startsWith('matrix3d')),'the title has a real 3D rotation');
      }
      await settleTitle();
      assert.equal(await shelf.page.locator('#shotHistoryTitle').getAttribute('aria-label'),titleText.historySwitchPhrases);
      if(i===0)await shelf.page.screenshot({path:path.join(out,`history-title-${theme}.png`)});
      await shelf.page.locator('#shotHistoryTitle').hover();await settleTitle();
      assert.equal(await shelf.page.locator('#shotHistoryTitle').getAttribute('aria-label'),titleText.recent);
      assert.equal(await shelf.page.locator('#shotHistory').getAttribute('data-mode'),'history','hover alone never changes data mode');
    }
    const searchStyle=()=>shelf.page.locator('#shotHistorySearch').evaluate(el=>{
      const s=getComputedStyle(el);return {outline:s.outlineStyle,shadow:s.boxShadow,transform:s.transform,transition:s.transitionDuration,animation:s.animationName,background:s.backgroundColor};
    });
    const unfocusedSearch=await searchStyle();await shelf.page.locator('#shotHistorySearch').focus();
    assert.deepEqual(await searchStyle(),unfocusedSearch,'search focus has no outline, transform, shadow or animated styling');
    assert.equal(unfocusedSearch.outline,'none');assert.equal(unfocusedSearch.shadow,'none');assert.equal(unfocusedSearch.transition,'0s');assert.equal(unfocusedSearch.animation,'none');
    await shelf.page.locator('#shotHistorySearch').fill('no matching synthetic record');
    await shelf.page.locator('#shotHistoryEmpty').waitFor({state:'visible'});
    assert.equal(await shelf.page.locator('#shotHistorySearchClear svg').evaluate(el=>getComputedStyle(el).color),theme==='light'?'rgb(17, 17, 17)':'rgb(245, 245, 245)');
    await shelf.page.locator('#shotHistorySearchClear').click();await shelf.page.waitForFunction(()=>document.querySelectorAll('.shot-history-item').length===7);
    assert.equal(await shelf.page.locator('#shotHistorySearch').inputValue(),'');
    assert.equal(await shelf.page.locator('#shotHistorySearchClear').isVisible(),false);
    // The shared veil covers header, controls and list before changing mode.
    await shelf.page.locator('#shotHistoryMode').click();
    await shelf.page.waitForFunction(()=>document.querySelector('[data-tk-page-transition-veil]')?.classList.contains('is-active'));
    const veil=await shelf.page.locator('[data-tk-page-transition-veil]').evaluate(el=>({color:getComputedStyle(el).backgroundColor,rect:el.getBoundingClientRect().toJSON()}));
    const panelRect=await shelf.page.locator('#shotHistoryPanel').boundingBox();
    assert.equal(veil.color,theme==='light'?'rgb(255, 255, 255)':'rgb(0, 0, 0)');
    assert.equal(veil.rect.width,panelRect.width);assert.equal(veil.rect.height,panelRect.height);
    await shelf.page.waitForFunction(()=>document.getElementById('shotHistory').dataset.mode==='phrases'&&!document.getElementById('shotHistoryMode').disabled);
    await shelf.page.locator('#shotHistoryTitle').hover();await shelf.page.locator('#shotHistoryMode').hover();await settleTitle();
    assert.equal(await shelf.page.locator('#shotHistoryTitle').getAttribute('aria-label'),titleText.historySwitchRecords);
    await shelf.page.locator('#shotHistoryMode').click();await shelf.page.waitForFunction(()=>document.getElementById('shotHistory').dataset.mode==='history'&&!document.getElementById('shotHistoryMode').disabled);
    assert.equal(await shelf.page.locator('[data-tk-page-transition-veil]').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
    await shelf.page.locator('#shotHistoryMode').click();
    await shelf.page.waitForFunction(()=>document.querySelector('[data-tk-page-transition-veil]')?.classList.contains('is-active'));
    await shelf.page.keyboard.press('Escape');await shelf.page.waitForFunction(()=>document.getElementById('shotHistory').dataset.state==='collapsed');
    assert.equal(await shelf.page.locator('[data-tk-page-transition-veil]').count(),0,'closing during transition releases its veil');
    await shelf.page.locator('#shotHistoryBubble').click();await shelf.page.waitForFunction(()=>document.getElementById('shotHistory').dataset.state==='expanded');
    assert.equal(await shelf.page.locator('#shotHistory').getAttribute('data-mode'),'history','cancelled transition cannot change mode later');
    assert.equal(await shelf.page.locator('#shotHistoryMode').isDisabled(),false);
    const beforeHeaderDrag=await dragCount();
    const title=await shelf.page.locator('.shot-history-panel header>span').boundingBox();
    await shelf.page.mouse.move(title.x+10,title.y+10);await shelf.page.mouse.down();await shelf.page.mouse.move(title.x+36,title.y+26,{steps:4});await shelf.page.mouse.up();
    await shelf.page.waitForFunction(n=>window.__shotCalls.filter(c=>c.command==='plugin:window|start_dragging').length===n,beforeHeaderDrag+1);
    assert.equal(await shelf.page.locator('#shotHistory').getAttribute('data-state'),'expanded','header drag must keep the panel expanded');
    const closeButton=await shelf.page.locator('[data-shot-action="collapse-history"]').boundingBox();
    await shelf.page.mouse.move(closeButton.x+10,closeButton.y+16);await shelf.page.mouse.down();await shelf.page.mouse.move(closeButton.x+19,closeButton.y+16,{steps:3});await shelf.page.mouse.up();
    await shelf.page.waitForFunction(()=>document.getElementById('shotHistory').dataset.state==='collapsed');
    assert.equal(await dragCount(),beforeHeaderDrag+1,'close button must not start a header drag');
    await shelf.page.locator('#shotHistoryBubble').click();
    await shelf.page.waitForFunction(()=>document.getElementById('shotHistory').dataset.state==='expanded');
    await shelf.page.locator('.shot-history-item').first().click();
    assert.ok(await shelf.page.evaluate(()=>window.__shotCalls.some(c=>c.command==='clipboard_history'&&c.args?.request?.action==='pin')));
    await shelf.page.screenshot({path:path.join(out,`history-${theme}.png`)});
    const pixels=await loadImage(path.join(out,`history-${theme}.png`));
    const raster=createCanvas(pixels.width,pixels.height),rasterCtx=raster.getContext('2d');rasterCtx.drawImage(pixels,0,0);
    assert.ok([...rasterCtx.getImageData(0,0,pixels.width,pixels.height).data].some((value,i,a)=>i%4===1&&value>a[i-1]+35&&value>a[i+1]+35),'shelf screenshot must contain the fixture green image');
    assert.match(await shelf.page.locator('.shot-history-info').first().textContent(),/2026|\d{4}/);
    assert.match(await shelf.page.locator('.shot-history-info').first().textContent(),/UTC\+08:00/);
    await shelf.page.evaluate(()=>{
      window.__shotHistory.unshift({id:15,kind:'text',time:Date.now(),preview:'Text from another application',text:'Complete text <script>unsafe()</script>',source:'Editor.exe'});
      window.__shotHistory.unshift({id:16,kind:'files',time:Date.now(),preview:'sample.pdf',paths:['C:/Synthetic/sample.pdf'],source:'explorer.exe'});
      window.__shotEmit('clipboard-history-changed');
    });
    await shelf.page.locator('[data-history-kind="text"]').click();
    await shelf.page.waitForFunction(()=>document.querySelector('.shot-history-item')?.dataset.kind==='text');
    await shelf.page.locator('#shotHistoryFilters').evaluate(async el=>{await Promise.allSettled(el.getAnimations({subtree:true}).map(a=>a.finished));});
    const indicatorBounds=await shelf.page.locator('.shot-history-filter-indicator').boundingBox(),textTab=await shelf.page.locator('[data-history-kind="text"]').boundingBox();
    assert.ok(Math.abs(indicatorBounds.x-textTab.x)<1&&Math.abs(indicatorBounds.width-textTab.width)<1,'sliding selection settles exactly beneath its tab');
    await shelf.page.evaluate(()=>{document.querySelector('[data-history-kind="files"]').click();document.querySelector('[data-history-kind=""]').click();document.querySelector('[data-history-kind="text"]').click();});
    await shelf.page.waitForFunction(()=>document.querySelectorAll('.shot-history-item').length===1&&document.querySelector('.shot-history-item')?.dataset.kind==='text');
    await shelf.page.waitForFunction(()=>document.querySelectorAll('.shot-history-item').length===1);
    await shelf.page.locator('.shot-history-item').click();
    await shelf.page.locator('#shotHistoryDetail').waitFor({state:'visible'});
    assert.match(await shelf.page.locator('#shotHistoryDetailBody').textContent(),/Complete text <script>/);
    assert.equal(await shelf.page.locator('#shotHistoryDetailBody script').count(),0);
    await shelf.page.locator('[data-shot-action="history-copy"]').click();
    await shelf.page.waitForFunction(()=>window.__shotCalls.some(c=>c.command==='clipboard_history'&&c.args.request.action==='copy'&&c.args.request.id===15));
    await shelf.page.keyboard.press('Escape');
    await shelf.page.locator('[data-history-kind="files"]').click();
    await shelf.page.waitForFunction(()=>document.querySelector('.shot-history-item')?.dataset.entryId==='16');
    await shelf.page.locator('.shot-history-item').click();
    assert.match(await shelf.page.locator('#shotHistoryDetailBody').textContent(),/C:\/Synthetic\/sample.pdf/);
    await shelf.page.locator('[data-shot-action="history-back"]').click();
    await shelf.page.locator('[data-history-kind=""]').click();
    await shelf.page.waitForFunction(()=>document.querySelectorAll('.shot-history-item').length===9);
    await shelf.page.locator('#shotHistoryPanel header').click({button:'right'});
    await shelf.page.waitForFunction(()=>window.__shotCalls.some(c=>c.args?.request?.action==='history-menu'));
    await shelf.page.locator('[data-shot-action="history-menu"]').focus();await shelf.page.keyboard.press('Enter');
    assert.ok(await shelf.page.evaluate(()=>window.__shotCalls.some(c=>c.args?.request?.action==='history-menu'&&Number.isFinite(c.args.request.anchor?.x))), 'keyboard opens beside the menu button');
    await shelf.page.evaluate(()=>window.__shotEmit('screenshot-history-action','monitor'));
    await shelf.page.waitForFunction(()=>document.getElementById('shotHistoryRecording').getAttribute('aria-checked')==='false');
    await shelf.page.evaluate(()=>window.__shotEmit('screenshot-history-action','open'));
    await shelf.page.waitForFunction(()=>window.__shotCalls.some(c=>c.args?.request?.target==='clipboard-history'));
    await shelf.page.keyboard.press('Escape');
    await shelf.page.waitForFunction(()=>document.getElementById('shotHistory').dataset.state==='collapsed');
    assert.ok(await shelf.page.evaluate(()=>!window.__shotCalls.some(c=>c.args?.request?.action==='hide-history')),'collapse must not disable the user preference');
    const beforeBubbleDrag=await dragCount();
    await shelf.page.mouse.move(48,48);await shelf.page.mouse.down();await shelf.page.mouse.move(65,60,{steps:4});await shelf.page.mouse.up();
    await shelf.page.waitForFunction(n=>window.__shotCalls.filter(c=>c.command==='plugin:window|start_dragging').length===n,beforeBubbleDrag+1);
    assert.equal(await shelf.page.locator('#shotHistory').getAttribute('data-state'),'collapsed','drag must not open the panel');
    await shelf.page.evaluate(()=>{window.__shotExpandFailure=true;});
    await shelf.page.locator('#shotHistoryBubble').click();
    await shelf.page.waitForFunction(()=>document.getElementById('shotHistoryBubble').dataset.error==='true');
    assert.equal(await shelf.page.locator('#shotHistory').getAttribute('data-state'),'collapsed');
    await shelf.page.evaluate(()=>{window.__shotExpandFailure=false;});
    await shelf.page.emulateMedia({reducedMotion:'reduce'});
    await shelf.page.locator('#shotHistoryBubble').focus();await shelf.page.keyboard.press('Enter');
    await shelf.page.waitForFunction(()=>document.getElementById('shotHistory').dataset.state==='expanded');
    await shelf.page.setViewportSize({width:320,height:440});
    const bounds=await shelf.page.locator('[data-shot-action="collapse-history"]').boundingBox();
    assert.ok(bounds.x+bounds.width<=320&&bounds.y+bounds.height<=440,'low-height panel controls stay visible');
    await shelf.page.locator('#shotHistoryMode').hover();await settleTitle();
    const narrowTitle=await shelf.page.locator('#shotHistoryTitle').evaluate(el=>({right:el.getBoundingClientRect().right,last:el.querySelector('.shot-title-hint').lastElementChild.getBoundingClientRect().right}));
    assert.ok(narrowTitle.last<=narrowTitle.right+1,'the complete switch hint fits at 320px');
    await shelf.page.locator('#shotHistoryMode').click();await shelf.page.waitForFunction(()=>document.getElementById('shotHistory').dataset.mode==='phrases'&&!document.getElementById('shotHistoryMode').disabled);
    await shelf.page.locator('#shotHistoryMode').click();await shelf.page.waitForFunction(()=>document.getElementById('shotHistory').dataset.mode==='history'&&!document.getElementById('shotHistoryMode').disabled);
    assert.equal(await shelf.page.locator('[data-tk-page-transition-veil]').count(),0,'reduced motion switches without a flash');
    await shelf.page.evaluate(()=>{window.__hideFailure=true;window.__shotEmit('screenshot-history-action','hide');});
    await shelf.page.waitForFunction(()=>document.getElementById('shotHistoryBubble').dataset.error==='true');
    assert.equal(await shelf.page.locator('#shotHistoryMessage').textContent(),locales[theme==='light'?'zh':'en'].windowHideFailed);
    assert.equal(await shelf.page.evaluate(()=>Boolean(window.__nativeHistoryHidden)),false,'failed hide keeps the view usable');
    const priorMenus=await shelf.page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='history-menu').length);
    await shelf.page.locator('#shotHistoryPanel header').click({button:'right'});
    await shelf.page.waitForFunction(n=>window.__shotCalls.filter(c=>c.args?.request?.action==='history-menu').length>n,priorMenus);
    await shelf.page.evaluate(()=>{window.__hideFailure=false;window.__shotEmit('screenshot-history-action','hide');});
    await shelf.page.waitForFunction(()=>window.__shotCalls.some(c=>c.args?.request?.action==='hide-history'));
    await shelf.page.waitForFunction(()=>window.__nativeHistoryHidden===true);
    await shelf.page.locator('#shotHistoryPanel header').click({button:'right'});
    await shelf.page.waitForTimeout(100);
    assert.equal(await shelf.page.locator('#shotHistoryBubble').getAttribute('data-error'),null,'a late request after hide must not create a red error indicator');
    await shelf.page.evaluate(()=>{window.__nativeHistoryHidden=false;});
    await shelf.page.evaluate(()=>window.__shotEmit('screenshot-history-action','close'));
    await shelf.page.waitForFunction(()=>window.__shotCalls.some(c=>c.args?.request?.action==='close-history'));
    await shelf.page.waitForFunction(()=>window.__nativeHistoryHidden===true);
    await shelf.page.evaluate(()=>{window.__nativeHistoryHidden=false;});
    await shelf.page.evaluate(()=>{window.__shotHistory=[];window.__shotEmit('clipboard-history-changed');});
    await shelf.page.locator('#shotHistoryEmpty').waitFor({state:'visible'});
    await shelf.page.setViewportSize({width:376,height:760});
    await shelf.page.evaluate(()=>{
      window.__shotHistory=Array.from({length:21},(_,i)=>({id:50-i,kind:i===0?'files':'text',time:Date.now(),source:'Editor.exe',preview:'超长中文与 English '.repeat(40),text:'完整内容'.repeat(100),paths:['C:/Synthetic/only-path.txt']}));
      window.__shotEmit('clipboard-history-changed');
    });
    await shelf.page.waitForFunction(()=>document.querySelectorAll('.shot-history-item').length===20);
    assert.equal(await shelf.page.locator('#shotHistoryCount').textContent(),'20');
    assert.equal(await shelf.page.evaluate(()=>window.__shotHistory.length),21,'the display cap never prunes storage');
    assert.equal(await shelf.page.locator('#shotHistoryMore').count(),0);
    const layout=await shelf.page.locator('.shot-history-item').first().evaluate(row=>{
      const preview=row.querySelector('.shot-history-preview'),time=row.querySelector('time');
      return {clamp:getComputedStyle(preview).webkitLineClamp,previewBottom:preview.getBoundingClientRect().bottom,timeTop:time.getBoundingClientRect().top,padding:parseFloat(getComputedStyle(row).paddingTop)};
    });
    assert.equal(layout.clamp,'2');assert.ok(layout.previewBottom<=layout.timeTop);assert.ok(layout.padding>=12);
    assert.equal(await shelf.page.locator('.shot-history-recording').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
    assert.equal(await shelf.page.locator('#shotHistoryList').evaluate(el=>getComputedStyle(el).scrollbarWidth),'none');
    await shelf.page.locator('#shotHistoryList').evaluate(el=>{el.scrollTop=el.scrollHeight;});
    await shelf.page.waitForFunction(()=>document.getElementById('shotHistoryScroll').getAttribute('aria-valuenow')==='100');
    await shelf.page.locator('#shotHistoryList').evaluate(el=>{el.scrollTop=0;});
    await shelf.page.waitForFunction(()=>document.getElementById('shotHistoryScroll').getAttribute('aria-valuenow')==='0');
    await shelf.page.locator('.shot-history-item').first().click({button:'right'});
    assert.ok(await shelf.page.evaluate(()=>window.__shotCalls.some(c=>c.args?.request?.action==='history-menu'&&c.args.request.id===50)));
    await shelf.page.evaluate(()=>window.__shotEmit('screenshot-history-action',{action:'delete',id:50}));
    await shelf.page.locator('#shotDialog').waitFor({state:'visible'});
    await shelf.page.locator('#shotDialogCancel').click();
    assert.equal(await shelf.page.evaluate(()=>window.__shotHistory.length),21,'cancel preserves the shared record');
    await shelf.page.evaluate(()=>window.__shotEmit('screenshot-history-action',{action:'delete',id:50}));
    await shelf.page.locator('#shotDialogOk').click();
    await shelf.page.waitForFunction(()=>window.__shotHistory.length===20);
    await shelf.page.waitForFunction(()=>document.querySelector('.shot-history-item')?.dataset.entryId==='49');
    assert.equal(await shelf.page.locator('.shot-history-item').count(),20,'delete fills the latest twenty from shared history');
    await shelf.page.evaluate(()=>{window.__deleteFailure=true;window.__shotEmit('screenshot-history-action',{action:'delete',id:49});});
    await shelf.page.locator('#shotDialogOk').click();await shelf.page.locator('#shotHistoryStatus').waitFor({state:'visible'});
    assert.equal(await shelf.page.evaluate(()=>window.__shotHistory.length),20);
    await shelf.page.evaluate(()=>{window.__deleteFailure=false;});
    await shelf.page.locator('[data-shot-action="retry-history"]').click();await shelf.page.locator('#shotHistoryStatus').waitFor({state:'hidden'});
    const initialRecording=await shelf.page.locator('#shotHistoryRecording').getAttribute('aria-checked');
    await shelf.page.evaluate(()=>{window.__monitorFailure=true;});
    await shelf.page.locator('#shotHistoryRecording').click();await shelf.page.locator('#shotHistoryStatus').waitFor({state:'visible'});
    assert.equal(await shelf.page.locator('#shotHistoryRecording').getAttribute('aria-checked'),initialRecording,'failed writes preserve the actual recording state');
    await shelf.page.evaluate(()=>{window.__monitorFailure=false;window.__monitorDelay=true;});
    await shelf.page.locator('#shotHistoryRecording').click();await shelf.page.waitForFunction(()=>!!window.__resolveMonitor);
    assert.equal(await shelf.page.locator('#shotHistoryRecording').isDisabled(),true);
    const monitorCalls=await shelf.page.evaluate(()=>window.__shotCalls.filter(c=>['start','stop'].includes(c.args?.request?.action)).length);
    await shelf.page.locator('#shotHistoryRecording').evaluate(el=>el.click());
    assert.equal(await shelf.page.evaluate(()=>window.__shotCalls.filter(c=>['start','stop'].includes(c.args?.request?.action)).length),monitorCalls);
    await shelf.page.evaluate(()=>{window.__monitorDelay=false;window.__resolveMonitor();});
    await shelf.page.waitForFunction(initial=>document.getElementById('shotHistoryRecording').getAttribute('aria-checked')!==initial,initialRecording);
    await shelf.page.locator('#shotHistoryStatus').waitFor({state:'hidden'});
    await shelf.page.waitForFunction(()=>{
      const control=document.getElementById('shotHistoryRecording');
      return getComputedStyle(control.firstElementChild).transform===(control.getAttribute('aria-checked')==='true'?'matrix(1, 0, 0, 1, 18, 0)':'none');
    });
    await shelf.page.screenshot({path:path.join(out,`history-${theme}-twenty.png`)});
    const footer=await shelf.page.locator('.shot-history-recording').boundingBox(),listBounds=await shelf.page.locator('#shotHistoryList').boundingBox();
    assert.ok(footer.y>=listBounds.y+listBounds.height,'recording controls belong below the list');
    assert.equal(await shelf.page.locator('.shot-history-content').first().evaluate(el=>getComputedStyle(el).textAlign),'center');
    await shelf.page.evaluate(()=>window.__shotEmit('screenshot-history-action','main'));
    assert.ok(await shelf.page.evaluate(()=>window.__shotCalls.some(c=>c.args?.request?.target==='main')));
    await shelf.page.evaluate(()=>window.__shotEmit('screenshot-history-action',{action:'note',id:49,kind:'text'}));
    await shelf.page.locator('#shotDialogContent textarea[name="note"]').fill('Synthetic account note');
    await shelf.page.evaluate(()=>{window.__noteFailure=true;});
    await shelf.page.locator('#shotDialogOk').click();await shelf.page.locator('.shot-editor-error').waitFor({state:'visible'});
    assert.equal(await shelf.page.locator('#shotDialogContent textarea[name="note"]').inputValue(),'Synthetic account note','failed save preserves the draft');
    await shelf.page.evaluate(()=>{window.__noteFailure=false;});await shelf.page.locator('#shotDialogOk').click();
    await shelf.page.locator('#shotDialog').waitFor({state:'hidden'});
    await shelf.page.waitForFunction(()=>document.querySelector('.shot-history-note')?.textContent==='Synthetic account note');
    await shelf.page.evaluate(()=>window.__shotEmit('screenshot-history-action',{action:'phrase-add',id:49,kind:'text'}));
    await shelf.page.waitForFunction(()=>window.__phrases.length===1);
    await shelf.page.evaluate(()=>window.__shotEmit('screenshot-history-action',{action:'phrase-add',id:49,kind:'text'}));
    await shelf.page.waitForFunction(()=>/相同|already/.test(document.getElementById('shotHistoryMessage').textContent));
    assert.equal(await shelf.page.evaluate(()=>window.__phrases.length),1,'duplicate imports preserve the existing phrase');
    await shelf.page.evaluate(()=>{window.__shotHistory.push({id:1,kind:'text',time:Date.now(),text:'old full text',preview:'old preview',note:'beyond twenty'});window.__shotEmit('clipboard-history-changed');});
    const countQueries=()=>shelf.page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='list').length);
    const beforeComposition=await countQueries();
    await shelf.page.locator('#shotHistorySearch').dispatchEvent('compositionstart');
    await shelf.page.locator('#shotHistorySearch').fill('临时拼音');await shelf.page.waitForTimeout(240);
    assert.equal(await countQueries(),beforeComposition,'IME composition does not search incomplete text');
    await shelf.page.locator('#shotHistorySearch').fill('beyond twenty');await shelf.page.locator('#shotHistorySearch').dispatchEvent('compositionend');
    await shelf.page.waitForFunction(()=>document.querySelectorAll('.shot-history-item').length===1&&document.querySelector('.shot-history-item').dataset.entryId==='1');
    await shelf.page.evaluate(()=>{window.__delaySearch='Synthetic account';});
    await shelf.page.locator('#shotHistorySearch').fill('Synthetic account');await shelf.page.waitForFunction(()=>Boolean(window.__releaseSearch));
    await shelf.page.locator('#shotHistorySearch').fill('beyond twenty');
    await shelf.page.waitForFunction(()=>window.__shotCalls.at(-1)?.args?.request?.query?.search==='beyond twenty');
    await shelf.page.evaluate(()=>{window.__delaySearch=null;window.__releaseSearch();});await shelf.page.waitForTimeout(80);
    assert.equal(await shelf.page.locator('.shot-history-item').first().getAttribute('data-entry-id'),'1','late old search cannot replace newer results');
    await shelf.page.locator('#shotHistoryMode').click();await shelf.page.waitForFunction(()=>document.getElementById('shotHistory').dataset.mode==='phrases'&&!document.getElementById('shotHistoryMode').disabled);
    assert.equal(await shelf.page.locator('#shotHistorySearch').inputValue(),'');
    await shelf.page.locator('#shotPhraseCreate').click();
    await shelf.page.locator('#shotDialogContent input[name="title"]').fill('Work email');
    await shelf.page.locator('#shotDialogContent textarea[name="text"]').fill('fixture@example.test');
    assert.equal(await shelf.page.locator('#shotDialogContent textarea[name="note"]').count(),0,'phrase editor only asks for title and content');
    await shelf.page.locator('#shotDialogOk').click();await shelf.page.locator('#shotDialog').waitFor({state:'hidden'});
    await shelf.page.waitForFunction(()=>document.querySelectorAll('.shot-history-item').length===2);
    await shelf.page.locator('.shot-history-item').first().click();
    await shelf.page.waitForFunction(()=>window.__lastPhraseCopy==='fixture@example.test');
    await shelf.page.waitForFunction(()=>window.__shotCalls.some(c=>c.args?.request?.action==='feedback'&&c.args.request.kind==='copied'));
    assert.equal(await shelf.page.locator('#shotHistoryStatus').isVisible(),false,'successful copy does not show error actions');
    assert.equal(await shelf.page.evaluate(()=>window.__shotHistory.length),21,'copying phrases does not grow clipboard history');
    await shelf.page.evaluate(()=>window.__shotEmit('screenshot-history-action',{action:'phrase-edit',id:window.__phrases[0].id,kind:'phrase'}));
    await shelf.page.locator('#shotDialogContent textarea[name="text"]').fill('edited@example.test');await shelf.page.locator('#shotDialogOk').click();await shelf.page.locator('#shotDialog').waitFor({state:'hidden'});
    await shelf.page.locator('#shotHistorySearch').fill('Work email');
    await shelf.page.waitForFunction(()=>document.querySelectorAll('.shot-history-item').length===1);
    await shelf.page.screenshot({path:path.join(out,`phrases-${theme}.png`)});
    const beforeList=await shelf.page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='phraseList').length);
    await shelf.page.evaluate(()=>window.__shotEmit('clipboard-history-changed',1000));await shelf.page.waitForTimeout(180);
    assert.equal(await shelf.page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='phraseList').length),beforeList,'unrelated clipboard events do not decrypt phrases again');
    await shelf.page.locator('#shotHistoryMode').click();await shelf.page.waitForFunction(()=>document.getElementById('shotHistory').dataset.mode==='history'&&!document.getElementById('shotHistoryMode').disabled);
    assert.equal(await shelf.page.locator('#shotHistorySearch').inputValue(),'beyond twenty');
    assert.equal(await shelf.page.locator('.shot-history-item').first().getAttribute('data-entry-id'),'1');
    await shelf.page.evaluate(()=>{window.__shotHistory=[];window.__shotEmit('clipboard-history-changed');});
    await shelf.page.locator('#shotHistoryMode').click();await shelf.page.waitForFunction(()=>document.getElementById('shotHistory').dataset.mode==='phrases'&&!document.getElementById('shotHistoryMode').disabled);
    assert.equal(await shelf.page.locator('#shotHistorySearch').inputValue(),'Work email');
    assert.equal(await shelf.page.locator('.shot-history-item').count(),1,'clearing history preserves saved phrases');
    await shelf.page.evaluate(()=>window.__shotEmit('screenshot-history-action',{action:'delete',id:window.__phrases[0].id,kind:'phrase'}));
    await shelf.page.locator('#shotDialogCancel').click();assert.equal(await shelf.page.evaluate(()=>window.__phrases.length),2);
    await shelf.page.evaluate(()=>window.__shotEmit('screenshot-history-action',{action:'delete',id:window.__phrases[0].id,kind:'phrase'}));
    await shelf.page.locator('#shotDialogOk').click();await shelf.page.waitForFunction(()=>window.__phrases.length===1);
    await shelf.page.locator('#shotHistorySearch').fill('');
    await shelf.page.evaluate(()=>{window.__phrases=Array.from({length:51},(_,i)=>({id:500-i,title:`Phrase ${i}`,text:`Value ${i}`,note:'',createdAt:Date.now(),updatedAt:Date.now()}));window.__shotEmit('clipboard-history-changed',{library:true});});
    await shelf.page.waitForFunction(()=>document.querySelectorAll('.shot-history-item').length===50);
    await shelf.page.locator('#shotHistoryList').evaluate(el=>el.scrollTop=el.scrollHeight);
    await shelf.page.waitForFunction(()=>document.querySelectorAll('.shot-history-item').length===51);
    await shelf.page.locator('.shot-history-item').last().click();await shelf.page.waitForFunction(()=>window.__lastPhraseCopy==='Value 50');
    assert.equal(await shelf.page.locator('.shot-history-item').count(),51,'copy keeps loaded phrases and scroll context');
    await shelf.page.locator('#shotHistoryList').evaluate(el=>el.scrollTop=0);
    const moveCard=async(from,to)=>{
      const grip=await shelf.page.locator('.shot-history-item').nth(from).locator('[data-history-reorder]').boundingBox();
      const target=await shelf.page.locator('.shot-history-item').nth(to).boundingBox();
      await shelf.page.mouse.move(grip.x+12,grip.y+12);await shelf.page.mouse.down();
      await shelf.page.mouse.move(target.x+40,target.y+target.height-20,{steps:12});await shelf.page.mouse.up();
    };
    await moveCard(0,1);
    await shelf.page.waitForFunction(()=>document.querySelector('.shot-history-item')?.dataset.entryId==='499');
    assert.deepEqual(await shelf.page.evaluate(()=>window.__phrases.slice(0,3).map(p=>p.id)),[499,500,498]);
    await shelf.page.evaluate(()=>{window.__reorderFailure=true;});await moveCard(0,1);
    await shelf.page.waitForFunction(()=>document.querySelector('.shot-history-item')?.dataset.entryId==='499'&&document.getElementById('shotHistoryStatus').hidden===false);
    await shelf.page.evaluate(()=>{window.__reorderFailure=false;});await shelf.page.locator('[data-shot-action="retry-history"]').click();
    await shelf.page.locator('#shotHistoryStatus').waitFor({state:'hidden'});
    const reordersBeforeCancel=await shelf.page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='reorder').length);
    const cancelGrip=await shelf.page.locator('[data-history-reorder]').first().boundingBox();
    await shelf.page.mouse.move(cancelGrip.x+12,cancelGrip.y+12);await shelf.page.mouse.down();await shelf.page.mouse.move(100,cancelGrip.y+40,{steps:4});await shelf.page.mouse.move(2,2);await shelf.page.mouse.up();
    assert.equal(await shelf.page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='reorder').length),reordersBeforeCancel,'dropping outside the list cancels sorting');
    await shelf.page.locator('[data-history-reorder]').first().focus();await shelf.page.keyboard.press('ArrowDown');
    await shelf.page.waitForFunction(()=>document.querySelector('.shot-history-item')?.dataset.entryId==='500'&&document.activeElement?.closest('[data-entry-id]')?.dataset.entryId==='499');
    await shelf.page.keyboard.press('ArrowUp');await shelf.page.waitForFunction(()=>document.querySelector('.shot-history-item')?.dataset.entryId==='499');
    const copyBeforeDrag=await shelf.page.evaluate(()=>window.__shotCalls.filter(c=>['phraseCopy','copy','pin'].includes(c.args?.request?.action)).length);
    const dragCard=async()=>{
      await shelf.page.evaluate(()=>{window.__dragDeferred=true;window.__releaseDrag=null;});
      const box=await shelf.page.locator('.shot-history-open').first().boundingBox();
      await shelf.page.mouse.move(box.x+box.width/2,box.y+box.height/2);await shelf.page.mouse.down();await shelf.page.mouse.move(box.x+box.width/2+24,box.y+box.height/2,{steps:5});
      await shelf.page.waitForFunction(()=>Boolean(window.__releaseDrag));await shelf.page.mouse.up();
      await shelf.page.evaluate(()=>{window.__dragDeferred=false;window.__releaseDrag();});
      await shelf.page.waitForFunction(()=>!document.querySelector('.shot-history-item.is-dragging'));
    };
    await dragCard();assert.equal(await shelf.page.evaluate(()=>window.__dragPayload.text),'Value 1');
    assert.equal(await shelf.page.evaluate(()=>window.__shotCalls.filter(c=>['phraseCopy','copy','pin'].includes(c.args?.request?.action)).length),copyBeforeDrag,'drag/cancel must not also copy or open a viewer');
    await shelf.page.locator('#shotHistoryMode').click();await shelf.page.waitForFunction(()=>document.getElementById('shotHistory').dataset.mode==='history'&&!document.getElementById('shotHistoryMode').disabled);
    await shelf.page.evaluate(({image})=>{
      window.__shotHistory=[{id:901,kind:'text',text:'完整正文'.repeat(100),preview:'truncated preview',time:Date.now()},{id:900,kind:'image',image,time:Date.now()}];window.__shotEmit('clipboard-history-changed');
    },{image});
    await shelf.page.locator('#shotHistorySearchClear').click();await shelf.page.waitForFunction(()=>document.querySelectorAll('.shot-history-item').length===2);
    await dragCard();assert.equal(await shelf.page.evaluate(()=>window.__dragPayload.text.length),400);
    await moveCard(0,1);await shelf.page.waitForFunction(()=>document.querySelector('.shot-history-item')?.dataset.entryId==='900');
    await dragCard();assert.equal(await shelf.page.evaluate(()=>window.__dragPayload.image),image,'image drag references the full original');
    assert.equal(await shelf.page.locator('#shotHistoryMode svg').evaluate(el=>getComputedStyle(el).width),'15px');
    results.push(`history ${theme}: repeated title flips, veil/cancel/reduced motion, live search/IME/stale replies/clear contrast, tab motion, 320px fit, latest twenty, notes/phrases, delete failures and repeated open/close`);await shelf.context.close();
    const menu=await open('history-menu',theme,304,286,1,{warmMenu:true});
    await menu.page.waitForFunction(()=>window.__shotCalls.some(c=>c.args?.request?.action==='menu-boot'));
    await menu.page.waitForFunction(()=>document.getElementById('shotMenu')?.hidden===true);
    assert.equal(await menu.page.locator('#shotMenu button').count(),0,'prewarmed menu has no actions or focus');
    assert.equal(await menu.page.locator('#shotMenuError').isVisible(),false);
    assert.ok(await menu.page.evaluate(()=>!window.__shotCalls.some(c=>c.args?.request?.action==='menu-ready')),'warming must not show the native window');
    await menu.page.evaluate(()=>{window.__menu={token:1,entryId:null,kind:'',expanded:false,recording:true};window.__menuStarted=performance.now();window.__shotEmit('screenshot-menu-opened',1);});
    await menu.page.locator('[data-menu-action="hide"]').waitFor({state:'visible'});
    results.push(`menu ${theme}: prepared WebView DOM to ready ${Math.round(await menu.page.evaluate(()=>window.__menuReadyMs))}ms (mock native bridge)`);
    assert.equal(await menu.page.locator('#shotMenu').evaluate(el=>getComputedStyle(el).borderRadius),'14px');
    assert.equal(await menu.page.locator('#shotMenu button').count(),6);
    await menu.page.locator('#shotMenu').evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished));});
    await menu.page.screenshot({path:path.join(out,`menu-${theme}.png`)});
    await menu.page.keyboard.press('ArrowDown');
    assert.equal(await menu.page.evaluate(()=>document.activeElement.dataset.menuAction),'main');
    await menu.page.keyboard.press('Escape');
    assert.ok(await menu.page.evaluate(()=>window.__shotCalls.some(c=>c.args?.request?.action==='menu-dismiss')));
    await menu.page.evaluate(()=>{window.__menu={token:2,entryId:49,kind:'text',expanded:true,recording:false};window.__shotEmit('screenshot-menu-opened',2);});
    await menu.page.setViewportSize({width:304,height:252});
    await menu.page.locator('[data-menu-action="delete"]').waitFor({state:'visible'});
    await menu.page.locator('#shotMenu').evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished));});
    assert.equal(await menu.page.locator('#shotMenu button').count(),5);
    const entryBounds=await menu.page.locator('#shotMenu').boundingBox();
    assert.ok(entryBounds.x>=0&&entryBounds.y>=0&&entryBounds.x+entryBounds.width<=304&&entryBounds.y+entryBounds.height<=252,'entry menu fits its native viewport');
    await menu.page.locator('[data-menu-action="delete"]').click();
    assert.ok(await menu.page.evaluate(()=>window.__shotCalls.some(c=>c.args?.request?.action==='menu-select'&&c.args.request.token===2&&c.args.request.selected==='delete')));
    await menu.page.screenshot({path:path.join(out,`menu-entry-${theme}.png`)});
    for(const [index,kind] of ['image','phrase'].entries()){
      await menu.page.evaluate(({kind,token})=>{window.__menu={token,entryId:49,kind,expanded:true,recording:false};window.__shotEmit('screenshot-menu-opened',token);},{kind,token:index+3});
      await menu.page.setViewportSize({width:304,height:214});
      await menu.page.waitForFunction(()=>document.querySelectorAll('#shotMenu button').length===4);
      assert.equal(await menu.page.locator('[data-menu-action="phrase-add"]').count(),0,'only text history can become a phrase');
      assert.equal(await menu.page.locator('[data-menu-action="phrase-edit"]').count(),kind==='phrase'?1:0);
    }
    const readyBeforeDuplicate=await menu.page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='menu-ready').length);
    await menu.page.evaluate(()=>window.__shotEmit('screenshot-menu-opened',4));await menu.page.waitForTimeout(50);
    assert.equal(await menu.page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='menu-ready').length),readyBeforeDuplicate,'duplicate session notification does not reinitialize or show again');
    const selectsBeforeReuse=await menu.page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='menu-select').length);
    await menu.page.locator('[data-menu-action="copy"]').click();
    assert.equal(await menu.page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='menu-select').length),selectsBeforeReuse+1,'reused menu dispatches exactly once');
    assert.equal(await menu.page.evaluate(()=>window.__shotCalls.filter(c=>c.args?.request?.action==='menu-select').at(-1).args.request.token),4);
    await menu.page.evaluate(()=>{window.__delayMenuSelect=true;});
    await menu.page.locator('[data-menu-action="copy"]').click();await menu.page.waitForFunction(()=>Boolean(window.__rejectMenuSelect));
    await menu.page.evaluate(()=>{window.__delayMenuSelect=false;window.__menu={token:5,entryId:null,kind:'',expanded:false,recording:true};window.__shotEmit('screenshot-menu-opened',5);});
    await menu.page.locator('[data-menu-action="hide"]').waitFor({state:'visible'});
    await menu.page.evaluate(()=>window.__rejectMenuSelect('screenshot:expired'));await menu.page.waitForTimeout(40);
    assert.equal(await menu.page.locator('#shotMenuError').isVisible(),false,'a late failure from the old session must not paint over the current menu');
    assert.equal(await menu.page.locator('[data-menu-action="hide"]').isDisabled(),false);
    results.push(`menu ${theme}: rounded surface, keyboard, reuse, context selection token and dismissal`);await menu.context.close();
    const feedback=await open('toast',theme,340,88);
    await feedback.page.waitForFunction(()=>window.__shotCalls.some(c=>c.args?.request?.action==='feedback-ready'));
    await feedback.page.locator('#shotDesktopToast').evaluate(el=>{for(const animation of el.getAnimations()){animation.pause();animation.currentTime=300;}});
    const toastStyle=await feedback.page.locator('#shotDesktopToast').evaluate(el=>({background:getComputedStyle(el).backgroundColor,radius:getComputedStyle(el).borderRadius,shadow:getComputedStyle(el).boxShadow}));
    assert.equal(toastStyle.background,'rgb(255, 255, 255)');assert.equal(toastStyle.radius,'999px');assert.notEqual(toastStyle.shadow,'none');
    assert.equal(await feedback.page.locator('button').count(),0);
    for(const selector of ['html','body','#screenshotRoot']){
      assert.equal(await feedback.page.locator(selector).evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)',`${selector} must be transparent behind the capsule`);
    }
    const toastPng=await feedback.page.screenshot({path:path.join(out,`desktop-toast-${theme}.png`),omitBackground:true});
    const toastImage=await loadImage(toastPng),toastCanvas=createCanvas(340,88),toastCtx=toastCanvas.getContext('2d');toastCtx.drawImage(toastImage,0,0);
    for(const [x,y] of [[0,0],[339,0],[0,87],[339,87],[12,44]])assert.equal(toastCtx.getImageData(x,y,1,1).data[3],0,'outside the capsule and shadow must have zero alpha');
    const alpha=toastCtx.getImageData(0,0,340,88).data;
    assert.ok(alpha.some((value,index)=>index%4===3&&value>0&&value<255),'soft shadow keeps partial alpha');
    await feedback.page.evaluate(()=>window.__shotEmit('desktop-feedback',{revision:2,kind:'copied',lang:'zh'}));
    await feedback.page.waitForFunction(()=>window.__shotCalls.some(c=>c.args?.request?.action==='feedback-ready'&&c.args.request.revision===2));
    assert.equal(await feedback.page.locator('#shotDesktopToast').count(),1);
    results.push(`desktop toast ${theme}: transparent body/corners, white capsule, alpha shadow, no controls, reusable feedback`);await feedback.context.close();
  }
  assert.deepEqual(errors,[]);console.log(results.join('\n'));
}finally{
  await writeFile(path.join(out,'report.json'),JSON.stringify({results,errors},null,2));
  await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));
}
