import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createServer } from 'vite';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const server = await createServer({ configFile:false, logLevel:'error',
  cacheDir:'tmp/markdown-export/vite-cache', server:{host:'127.0.0.1',port:0,hmr:false,watch:null},
  optimizeDeps:{entries:['src/features/markdown-editor/tool.js']},
  plugins:[{name:'markdown-test-shell',configureServer(server) {
    server.middlewares.use('/md-test', (_req,res)=> {
      res.setHeader('Content-Type','text/html');
      res.end('<!doctype html><html data-theme="light"><head><link rel="stylesheet" href="/src/styles/index.css"><link rel="stylesheet" href="/src/tool-page-v2-final.css"><link rel="stylesheet" href="/src/tool-nav-unified.css"><link rel="stylesheet" href="/src/styles/themes/index.css"></head><body><div class="feature-tool-overlay markdown-editor-overlay" id="markdownEditorOverlay" aria-hidden="true"></div></body></html>');
    });
  }}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({headless:true,channel:process.env.TOOLKNIT_TEST_CHANNEL||'msedge'});
  const page = await browser.newPage({viewport:{width:1401,height:920}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}md-test`);
  await page.evaluate(async () => {
    const qa=window.mdQA={calls:[],folders:[],roots:[],messages:[],mode:'success'};
    window.__TAURI_INTERNALS__={ metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
      transformCallback:()=>1, unregisterCallback:()=>{}, invoke:async(command,args)=> {
        if (!['export_markdown_bundle','write_unique_file_bytes'].includes(command)) return 1;
        qa.calls.push({command,args});
        if (qa.mode==='failure') throw new Error('simulated output failure');
        if (qa.mode==='pending') await new Promise(resolve=> { qa.finish=resolve; });
        return command==='export_markdown_bundle'
          ? {directory:'C:/qa-output/Markdown/report-2',markdown_path:'C:/qa-output/Markdown/report-2/report.md',asset_count:0}
          : 'C:/qa-output/Markdown/report-2.html';
      } };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
    localStorage.setItem('toolknit.markdown.draft.v1','# Report\n\n| A | B |\n| --- | --- |\n| first<br>second | text |');
    const {initMarkdownEditorTool}=await import('/src/features/markdown-editor/tool.js');
    const {createModalRuntime}=await import('/src/app/modal-runtime.js');
    const {setLangWithoutFade}=await import('/src/i18n.js');
    qa.setLang=setLangWithoutFade;
    qa.modals=createModalRuntime(); qa.modals.initA11y(); qa.modals.initOverflow();
    qa.tool=initMarkdownEditorTool({overlay:document.querySelector('#markdownEditorOverlay'),isTauri:true,
      notify:message=>qa.messages.push(message),
      getOutputDir:async suffix=> { qa.roots.push(suffix); return suffix ? 'C:/qa-output/'+suffix : 'C:/qa-output'; },
      openOutputFolder:async folder=> { qa.folders.push(folder); return true; } });
    qa.tool.open();
  });
  for (const format of ['md','html']) {
    await page.locator(`[data-md-export="${format}"]`).click();
    await page.waitForSelector('[data-md-export-success].visible');
    assert.equal(await page.locator('[data-md-success-path]').textContent(),format==='md' ? 'C:/qa-output/Markdown/report-2' : 'C:/qa-output/Markdown');
    assert.equal(await page.locator('[data-md-success-file]').textContent(),format==='md'?'report.md':'report-2.html');
    await page.locator('[data-md-success-open-folder]').click();
    await page.evaluate(()=>window.mdQA.setLang('en'));
    assert.equal(await page.locator('#mdExportSuccessTitle').textContent(),'Export complete');
    assert.equal(await page.locator('[data-md-success-open-folder]').textContent(),'Open folder');
    await page.locator('[data-md-success-ok]').click();
  }
  assert.deepEqual(await page.evaluate(()=>window.mdQA.folders),['C:/qa-output/Markdown/report-2','C:/qa-output/Markdown']);
  const calls=await page.evaluate(()=>window.mdQA.calls);
  assert.equal(calls[0].args.outputRoot,'C:/qa-output');
  assert.match(new TextDecoder().decode(Uint8Array.from(calls[0].args.markdownBytes)),/first<br>second/);
  assert.equal(calls[1].args.directory,'C:/qa-output/Markdown');
  assert.match(new TextDecoder().decode(Uint8Array.from(calls[1].args.bytes)),/<table>/);
  assert.deepEqual(await page.evaluate(()=>window.mdQA.messages),[],'success must not use a toast');
  await page.evaluate(()=> { window.mdQA.mode='failure'; });
  await page.locator('[data-md-export="md"]').click();
  await page.waitForFunction(()=>window.mdQA.messages.length===1);
  assert.equal(await page.locator('[data-md-export-success].visible').count(),0);
  assert.equal(await page.locator('[data-md-export="md"]').isEnabled(),true);
  await page.evaluate(()=> { window.mdQA.mode='pending'; });
  await page.locator('[data-md-export="md"]').click();
  await page.waitForFunction(()=>!!window.mdQA.finish);
  await page.evaluate(()=> { window.mdQA.tool.close(); window.mdQA.tool.open(); window.mdQA.finish(); });
  await page.waitForTimeout(250);
  assert.equal(await page.locator('[data-md-export-success].visible').count(),0,'late export must not affect reopened editor');
  assert.equal(await page.locator('[data-md-export="md"]').isEnabled(),true);
  await page.evaluate(()=> { window.mdQA.tool.dispose(); window.mdQA.tool.dispose(); window.mdQA.modals.dispose(); });
  assert.deepEqual(errors,[]);
  console.log('PASS native IPC fixture: output paths, folder targets, translations, success modal, failure recovery, stale export, dispose');
} finally {
  await browser?.close();
  await server.close();
}
