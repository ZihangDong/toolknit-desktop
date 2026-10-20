import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/clipboard-history'); await mkdir(output, { recursive: true });
const harness = `
import markup from '/src/features/clipboard-history/template.js';
import { initClipboardHistoryTool } from '/src/features/clipboard-history/tool.js';
import { createIcons, icons } from 'lucide';
import { setLang } from '/src/i18n.js';
import { DEFAULT_SETTINGS } from '/src/features/clipboard-history/core.js';
export function setup() {
  document.body.insertAdjacentHTML('beforeend', markup);
  let enabled = false, records = [], listeners = new Set(), sequence = 0, settings = { ...DEFAULT_SETTINGS }, held = null;
  const calls = []; let holdNext = false, pinError = '', storageError = '';
  const status = () => ({ enabled, total: records.length, today: records.length, bytes: records.reduce((n,r)=>n+r.bytes,0), startedAt: enabled ? Date.now() : null, captured: records.length, skipped: 0, failed: 0, settings, latestId: sequence });
  const emit = payload => listeners.forEach(fn=>fn(payload));
  const runtime = { available:true, subscribe:async fn=>{listeners.add(fn);return ()=>listeners.delete(fn);}, request:async request=>{
    calls.push(request);
    if(request.action==='restart'){storageError='';records=[];enabled=false;settings={...DEFAULT_SETTINGS};return status();}
    if(storageError)throw storageError;
    if (request.action==='status') return status();
    if (request.action==='start') { enabled=true; settings={...settings,resumeOnLaunch:true}; }
    if (request.action==='stop') { enabled=false; settings={...settings,resumeOnLaunch:false}; }
    if (request.action==='settings') settings={...request.settings,resumeOnLaunch:enabled};
    if (request.action==='list') {
      const q=request.query;
      let items=records.filter(r=>(!q.kind||r.kind===q.kind)&&(!q.search||[r.text,r.preview,r.note].filter(Boolean).join(' ').includes(q.search))&&(!q.favorites||r.favorite)&&(!q.before||r.id<q.before)&&(!q.snapshot||r.id<=q.snapshot));
      return { items: structuredClone(items.slice(0,50)), next:items.length>50?items[49].id:null, snapshot:q.snapshot||sequence };
    }
    if (request.action==='detail') { const result=structuredClone(records.find(r=>r.id===request.id)); if(holdNext){holdNext=false;return new Promise(resolve=>held=()=>resolve(result));}return result; }
    if (request.action==='entry') return structuredClone(records.find(r=>r.id===request.id));
    if (request.action==='favorite') records.find(r=>r.id===request.id).favorite=request.favorite;
    if (request.action==='copy') records.find(r=>r.id===request.id).usedAt=Date.now();
    if (request.action==='pin'&&pinError) throw pinError;
    if (request.action==='delete') records=records.filter(r=>!request.ids.includes(r.id));
    if (request.action==='clear') records=records.filter(r=>!request.includeFavorites&&r.favorite);
    emit();return status();
  }};
  const tool=initClipboardHistoryTool({overlay:document.getElementById('clipboardHistoryOverlay'),clipboardRuntime:runtime,refreshIcons:()=>createIcons({icons}),notify:()=>{}});
  window.fixture={tool,calls,status,setLang,listeners,setStorageError:value=>{storageError=value;},setPinError:value=>{pinError=value;},hold:()=>{holdNext=true;},release:()=>{held?.();held=null;},
    note(id,note){records.find(r=>r.id===id).note=note;emit({recordId:id});},
    push(extra={}) {if(!enabled)return; const record={id:++sequence,capturedAt:Date.now()+sequence,offsetMinutes:480,kind:'text',favorite:false,source:'QA-editor.exe',preview:'Meeting notes: launch checklist',text:'Meeting notes: launch checklist\\n中文与 English 内容\\n<img src=x onerror=window.unsafe=true>',bytes:184,count:94,rich:false,paths:[],filesAvailable:true,...extra};records.unshift(record);emit();return record.id;},
    image() {const c=document.createElement('canvas');c.width=480;c.height=300;const x=c.getContext('2d');x.fillStyle='#f5f6f7';x.fillRect(0,0,480,300);x.fillStyle='#27684d';x.fillRect(30,40,150,200);x.fillStyle='#cc424f';x.fillRect(205,100,245,140);x.fillStyle='#141518';x.font='24px sans-serif';x.fillText('Clipboard image sample',35,280);const image=c.toDataURL();return this.push({kind:'image',image,thumbnail:image,width:480,height:300,count:0,bytes:5028,preview:''});}
  };tool.open();
}
`;
const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, plugins: [{ name: 'clipboard-test-harness', resolveId(id) { if (id === '/__clipboard-test.js') return '\0clipboard-test'; }, load(id) { if (id === '\0clipboard-test') return harness; } }], logLevel: 'error' });
console.log('Clipboard browser: starting fixture server');
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
const browser = await chromium.launch({ headless: true, channel: process.env.TOOLKNIT_TEST_CHANNEL || 'msedge' });
console.log('Clipboard browser: Edge ready');
async function screenshot(page, name) {
  const bounds = await page.locator('#clipboardHistoryOverlay').evaluate(root => {
    const header = root.querySelector('header').getBoundingClientRect();
    return { top: header.top, rootOverflow: root.scrollWidth > root.clientWidth + 1, toolbarOverflow: root.querySelector('.clipboard-toolbar').scrollWidth > root.querySelector('.clipboard-toolbar').clientWidth + 1 };
  });
  assert.equal(bounds.top, 0); assert.equal(bounds.rootOverflow, false); assert.equal(bounds.toolbarOverflow, false);
  assert.equal(await page.locator('#clipboardSearch').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'search must use its shared outer surface');
  await page.screenshot({ path: path.join(output, name + '.png') });
}
try {
  const entryPage = await browser.newPage({ viewport: { width: 1401, height: 920 } });
  const entryErrors = []; entryPage.on('pageerror', error => entryErrors.push(error.message));
  await entryPage.route('https://api.github.com/**', route => route.fulfill({ status: 200, body: '[]', contentType: 'application/json' }));
  await entryPage.goto(process.env.TOOLKNIT_PREVIEW_URL || url, { waitUntil: 'domcontentloaded' });
  await entryPage.locator('[data-home-category="hardware"]').click();
  for (let attempt = 0; attempt < 2; attempt++) {
    await entryPage.locator('[data-home-tool="clipboard-history"]').click();
    await entryPage.waitForSelector('#clipboardHistoryOverlay.visible');
    assert.ok(await entryPage.locator('#clipboardToggle').isDisabled());
    assert.match(await entryPage.locator('#clipboardEmptyTitle').innerText(), /Windows/);
    if (attempt === 0) await entryPage.locator('[data-clipboard-close]').click();
    else await entryPage.keyboard.press('Escape');
    await entryPage.waitForSelector('#clipboardHistoryOverlay.visible', { state: 'hidden' });
    assert.equal(await entryPage.locator('#clipboardHistoryOverlay').evaluate(el => el.contains(document.activeElement)), false);
  }
  assert.deepEqual(entryErrors, []); await entryPage.close();
  console.log('Clipboard browser: real homepage entry, desktop-only state, back and reopen passed');
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1401, height: 920 }, reducedMotion: 'reduce' });
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://api.github.com/**', route=>route.fulfill({status:200,body:'[]',contentType:'application/json'}));
    console.log(`Clipboard browser: ${theme} loading`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    console.log(`Clipboard browser: ${theme} mounting`);
    await page.evaluate(async theme=>{await import('/__clipboard-test.js').then(m=>m.setup());document.documentElement.dataset.theme=theme;},theme);
    await page.waitForSelector('#clipboardToggle:not(:disabled)');
    assert.equal(await page.locator('#clipboardToggle').getAttribute('aria-checked'),'false');
    await page.evaluate(()=>{window.fixture.tool.close();window.fixture.setStorageError('clipboard:key-missing');window.fixture.tool.open();});
    await page.locator('#clipboardRestart').waitFor({state:'visible'});
    assert.match(await page.locator('#clipboardError').textContent(),/missing|缺失/);
    const restartCount=await page.evaluate(()=>window.fixture.calls.filter(r=>r.action==='restart').length);
    await page.locator('#clipboardRestart').click();await page.locator('#clipboardDialogCancel').click();
    assert.equal(await page.evaluate(()=>window.fixture.calls.filter(r=>r.action==='restart').length),restartCount,'cancel must leave the old history untouched');
    await page.locator('#clipboardRestart').click();await page.locator('#clipboardDialogConfirm').click();
    await page.locator('#clipboardRestart').waitFor({state:'hidden'});
    assert.equal(await page.locator('#clipboardToggle').getAttribute('aria-checked'),'false','fresh history must not silently enable monitoring');
    await screenshot(page, `${theme}-empty`);
    await page.locator('#clipboardToggle').click(); await page.locator('#clipboardDialogConfirm').click();
    await page.waitForFunction(()=>window.fixture.status().enabled);
    await page.waitForSelector('#clipboardHistoryDialog.visible',{state:'hidden'});
    await page.evaluate(()=>window.fixture.push());
    await page.waitForSelector('[data-entry-id="1"]'); await page.locator('[data-entry-id="1"]').click();
    await page.waitForSelector('#clipboardPreview pre'); assert.equal(await page.evaluate(()=>window.unsafe),undefined);
    assert.equal(await page.locator('#clipboardOpenPinned').isVisible(),false,'text records have no image viewer action');
    assert.match(await page.locator('#clipboardMetadata').innerText(),/UTC\+08:00/);
    await page.evaluate(()=>window.fixture.note(1,'Shared note <script>fixture</script>'));
    await page.waitForFunction(()=>document.getElementById('clipboardMetadata').textContent.includes('Shared note'));
    assert.match(await page.locator('[data-entry-id="1"]').textContent(),/Shared note/);
    assert.equal(await page.locator('#clipboardMetadata script').count(),0);
    await page.evaluate(()=>window.fixture.image());
    await page.waitForSelector('#clipboardNew:not([hidden])');
    assert.match(await page.locator('#clipboardPreview').innerText(),/Meeting notes/,'new entries must not replace the selected preview');
    await page.locator('#clipboardNew').click(); await page.locator('[data-entry-id="2"]').click(); await page.waitForSelector('#clipboardPreview img');
    await page.locator('#clipboardOpenPinned').click();
    await page.waitForFunction(()=>window.fixture.calls.some(r=>r.action==='pin'));
    assert.deepEqual(await page.evaluate(()=>window.fixture.calls.findLast(r=>r.action==='pin')),{action:'pin',id:2},'pin sends only the selected native record ID');
    await page.evaluate(()=>window.fixture.setPinError('screenshot:viewer-limit'));
    await page.locator('#clipboardOpenPinned').click();
    await page.waitForSelector('#clipboardError:not([hidden])');
    assert.match(await page.locator('#clipboardError').innerText(),/窗口|viewers/);
    assert.ok(await page.locator('#clipboardOpenPinned').isEnabled(),'viewer failure restores the action');
    await page.evaluate(()=>window.fixture.setPinError(''));
    await page.locator('#clipboardOpenPinned').click();await page.waitForSelector('#clipboardError',{state:'hidden'});
    await screenshot(page,`${theme}-image`);
    await page.locator('#clipboardZoom').click(); await page.waitForSelector('#clipboardHistoryDialog.visible'); await screenshot(page,`${theme}-zoom`); await page.keyboard.press('Escape');
    await page.locator('#clipboardFavorite').click(); await page.waitForFunction(()=>document.querySelector('#clipboardFavorite').getAttribute('aria-pressed')==='true');
    await page.locator('#clipboardSettings').click(); await screenshot(page,`${theme}-settings`);
    assert.equal(await page.locator('#clipboardDialogBody [data-setting="resumeOnLaunch"]').count(), 0, 'monitoring has one user-facing switch');
    await page.locator('#clipboardDialogBody [data-setting="retentionDays"]').fill('14');
    await page.locator('#clipboardDialogConfirm').click();
    await page.waitForSelector('#clipboardHistoryDialog.visible',{state:'hidden'});
    assert.equal(await page.evaluate(()=>window.fixture.status().settings.retentionDays),14);
    assert.equal(await page.evaluate(()=>window.fixture.calls.findLast(r=>r.action==='settings').settings.resumeOnLaunch),true,'saving other settings preserves resume');
    await page.locator('#clipboardKind + .tool-custom-select button').click(); await page.waitForSelector('.tool-custom-select-menu:not([hidden])'); await page.keyboard.press('Escape');
    assert.ok(await page.locator('#clipboardHistoryOverlay').isVisible());
    await page.locator('#clipboardSearch').fill('no such match'); await page.waitForFunction(()=>document.querySelectorAll('[data-entry-id]').length===0); await screenshot(page,`${theme}-no-results`);
    await page.locator('#clipboardSearch').fill(''); await page.waitForSelector('[data-entry-id="1"]');
    await page.evaluate(()=>window.fixture.push({kind:'files',paths:['C:\\QA\\report.pdf','C:\\QA\\image.png'],preview:'report.pdf\nimage.png',count:2,bytes:120}));
    await page.locator('#clipboardNew').waitFor({state:'visible'}); await page.locator('#clipboardNew').click(); await page.locator('[data-entry-id="3"]').click(); await page.waitForSelector('#clipboardPreview li');
    await screenshot(page,`${theme}-files`);
    await page.setViewportSize({width:980,height:620}); await screenshot(page,`${theme}-compact`);
    await page.locator('#clipboardDetailBack').click(); await page.locator('[data-entry-id="1"]').click(); await page.waitForSelector('#clipboardPreview pre');
    await page.setViewportSize({width:620,height:720}); await screenshot(page,`${theme}-narrow`);
    await page.setViewportSize({width:1401,height:920});
    await page.evaluate(()=>window.fixture.setLang('en')); await screenshot(page,`${theme}-english`);
    await page.evaluate(()=>window.fixture.hold()); await page.locator('[data-entry-id="2"]').click();
    await page.evaluate(()=>window.fixture.tool.close()); assert.equal(await page.evaluate(()=>window.fixture.listeners.size),0);
    await page.evaluate(()=>{window.fixture.push();window.fixture.tool.open();window.fixture.release();}); await page.waitForSelector('[data-entry-id="4"]');
    assert.equal(await page.locator('#clipboardDetailContent').isVisible(),false,'stale detail must not enter a new session');
    assert.equal(await page.locator('#clipboardToggle').getAttribute('aria-checked'),'true','closing the view does not pause native monitoring');
    assert.equal(await page.evaluate(()=>window.fixture.listeners.size),1);
    assert.equal(await page.locator('#clipboardKind + .tool-custom-select').count(),1);
    await page.locator('#clipboardClear').click(); await page.locator('#clipboardDialogConfirm').click();
    await page.waitForFunction(()=>window.fixture.status().total===1);
    assert.equal(await page.evaluate(()=>window.fixture.status().enabled),true);
    await page.locator('#clipboardToggle').click(); await page.waitForFunction(()=>!window.fixture.status().enabled);
    assert.equal(await page.locator('#clipboardToggle').getAttribute('aria-checked'),'false');
    await page.evaluate(()=>window.fixture.tool.dispose()); assert.equal(await page.evaluate(()=>window.fixture.listeners.size),0);
    assert.equal(await page.locator('.tool-custom-select-menu').count(),0);
    assert.deepEqual(errors,[]); await page.close();
  }
  console.log('Clipboard history browser regression passed: light/dark, timeline, images, files, privacy text, filters, modals, language, resize, stale results, close/reopen and listener cleanup.');
} finally { await browser.close(); await server.close(); }
