import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import { createCanvas } from '@napi-rs/canvas';
const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/file-search-live-results'); await mkdir(output, { recursive: true });
const canvas = createCanvas(64, 64), context = canvas.getContext('2d'); context.fillStyle = '#ef3020'; context.fillRect(0, 0, 64, 64);
const image = canvas.toDataURL('image/png'); canvas.width = canvas.height = 1;
await writeFile('tmp/file-search-live-results.html', `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font-family:Segoe UI,sans-serif}#stage{height:520px;display:flex;flex-direction:column}</style></head><body><section id="stage"><div id="root" style="height:100%;min-height:0;display:flex;flex-direction:column"></div></section><script type="module">
import {createResults,resultsMarkup} from '/src/features/file-search/results.js';import {t,setLangWithoutFade} from '/src/i18n.js';
await import(window.mode==='main'?'/src/features/file-search/file-search.css':'/src/features/file-search/floating.css');
setLangWithoutFade('zh');document.documentElement.dataset.theme=window.theme;
const root=document.querySelector('#root');document.querySelector('#stage').className=window.mode==='main'?'fs-tool':'';root.className=window.mode==='main'?'fs-results':'fs-card';root.dataset.visible='true';root.innerHTML=resultsMarkup();
window.rows=Array.from({length:260},(_,i)=>({id:String(i),name:'photo-'+String(i).padStart(3,'0')+(i%2?'.svg':'.png'),parent:'C:\\\\Synthetic',extension:i%2?'svg':'png',size:300,modified:1}));
let generation=1,loaded=0;window.hold=false;window.calls=[];window.previewCalls=0;window.release=null;window.ready=false;
window.mutate=()=>{rows.unshift({id:'new',name:'first.svg',parent:'C:\\\\Synthetic',extension:'svg',size:300,modified:1});generation++;};
window.tool=createResults({root,tr:(key,vars)=>t('fileSearch.'+key,vars),runtime:{call:async(action,data)=>{
if(action==='query-invalidate'||action==='reveal')return null;
if(action==='query-check')return {changed:true,generation};
if(action==='thumbnail'){window.previewCalls++;return {image:window.image};}
if(action!=='search')throw Error(action);if(window.failNext){window.failNext=false;throw Error('file-search:worker');}
window.calls.push(structuredClone(data));if(window.hold)await new Promise(resolve=>window.release=resolve);
const replace=Boolean(data.cursor&&data.cursor.generation!==generation),start=data.cursor&&!replace?loaded:0;
const length=data.cursor?(replace?loaded+50:50):(data.limit||50),page=rows.slice(start,start+length);loaded=start+page.length;
return {result:{rows:page,total:rows.length,extensions:['svg','png']},cursor:loaded<rows.length?{after:page.at(-1).id,generation}:null,ticket:'query-'+generation,replace,generation,index:{phase:'ready',generation}};
}}});tool.session.set({text:'photo'});tool.session.start();window.ready=true;
addEventListener('pagehide',()=>tool.dispose(),{once:true});
</script></body></html>`);
const server = await createServer({ configFile: false, logLevel: 'error', optimizeDeps: { entries: ['tmp/file-search-live-results.html'] }, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } }); await server.listen();
const browser = await chromium.launch({ headless: true, ...(process.env.TOOLKNIT_TEST_BROWSER_CHANNEL ? { channel: process.env.TOOLKNIT_TEST_BROWSER_CHANNEL } : {}) });
const checks = [], errors = [];
try {
  for (const mode of ['main', 'float']) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: mode === 'main' ? 960 : 420, height: 600 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(data => Object.assign(window, data), { mode, theme, image });
    await page.goto(server.resolvedUrls.local[0] + 'tmp/file-search-live-results.html');
    await page.waitForFunction(() => window.ready && document.querySelector('[data-thumbnail=ready]'));
    const list = page.locator('.fs-list');
    const bottom = async () => { await list.evaluate(n => { n.scrollTop = n.scrollHeight; n.dispatchEvent(new Event('scroll')); }); await page.waitForTimeout(40); };
    await bottom();
    const initialTop = await list.evaluate(n => n.scrollTop);
    await page.locator('[data-fs-more]').click();
    await page.waitForFunction(() => document.querySelector('.fs-row')?.getAttribute('aria-setsize') === '260' && window.calls.length === 2);
    assert.ok(await list.evaluate(n => n.scrollTop >= 3000), 'append does not go back to the first page');
    await bottom(); assert.ok(await list.evaluate(n => n.scrollTop > 6000), 'the next 50 rows are really added');
    // Index changes between pages: native recovery returns the whole retained
    // prefix and the next page, not a duplicate first page.
    await page.evaluate(() => window.mutate()); await page.locator('[data-fs-more]').click();
    await page.waitForFunction(() => window.calls.length === 3 && document.querySelector('.fs-row')?.getAttribute('aria-setsize') === '261');
    assert.ok(await list.evaluate(n => n.scrollTop > 6000));
    await list.evaluate(n => { n.scrollTop = 80 * 74 + 13; n.dispatchEvent(new Event('scroll')); }); await page.waitForTimeout(60);
    const anchor = await page.evaluate(() => { const list=document.querySelector('.fs-list'); const index=Math.floor(list.scrollTop/74);return {id:document.querySelector('[data-fs-row="'+index+'"] [data-fs-reveal]').dataset.fsReveal,offset:list.scrollTop%74}; });
    await page.evaluate(() => { window.kept=document.querySelector('[data-fs-reveal="'+String(79)+'"]');window.mutate=()=>{rows.unshift({id:'newer',name:'newer.png',parent:'C:\\Synthetic',extension:'png',size:300,modified:1});};window.mutate();window.hold=true;window.tool.setIndex({phase:'ready',generation:10}); });
    await page.locator('.fs-refresh').waitFor({ state: 'visible' }); await page.locator('.fs-refresh').click();
    await page.waitForFunction(() => Boolean(window.release));
    assert.equal(await page.evaluate(() => window.calls.at(-1).limit), 150, 'manual refresh retains 150 loaded rows');
    assert.ok(await list.evaluate(n => n.scrollTop > 5000), 'old results remain during the refresh');
    await page.evaluate(() => {window.hold=false;window.release();}); await page.waitForTimeout(80);
    const after = await page.evaluate(() => { const list=document.querySelector('.fs-list'),index=Math.floor(list.scrollTop/74);return {id:document.querySelector('[data-fs-row="'+index+'"] [data-fs-reveal]').dataset.fsReveal,offset:list.scrollTop%74,retained:window.kept===document.querySelector('[data-fs-reveal="79"]')}; });
    assert.equal(after.id, anchor.id, 'refresh anchors the same visible file after insertions'); assert.equal(after.offset, anchor.offset); assert.ok(after.retained, 'unchanged row DOM and thumbnail are reused');
    assert.ok(await page.locator('[data-thumbnail=ready]').count() > 2);
    const beforeFailure=await list.evaluate(n=>n.scrollTop);
    await page.evaluate(()=>{window.failNext=true;return window.tool.session.refresh();});
    assert.equal(await list.evaluate(n=>n.scrollTop),beforeFailure,'failed refresh keeps old results and position');
    assert.equal(await page.locator('.fs-refresh').isVisible(),true,'failed refresh offers a retry');
    await page.locator('.fs-refresh').click();await page.waitForFunction(()=>document.querySelector('.fs-refresh').hidden);
    await page.screenshot({ path: path.join(output, `${mode}-${theme}.png`) });
    checks.push(`${mode}/${theme}: real 50/100/150-row paging, live-index rebase, retained refresh, stable file/offset anchor and reused image DOM`);
    await page.evaluate(() => window.tool.dispose()); await page.close();
  }
  assert.deepEqual(errors, []); console.log(checks.join('\n')); await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors }, null, 2) + '\n');
} finally { await browser.close(); await server.close(); }
