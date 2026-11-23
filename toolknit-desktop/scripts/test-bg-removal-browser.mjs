import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { build } from 'vite';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/matting-browser');
await mkdir(output, { recursive: true });
const html = `<!doctype html><html data-tk-auxiliary><head>
<link rel="stylesheet" href="/src/styles/index.css">
<link rel="stylesheet" href="/src/tool-custom-select.css">

</head><body><div id="bgRemovalOverlay"></div><script type="module">
import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
mockWindows('main');
const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 100;
canvas.getContext('2d').fillRect(20, 20, 60, 60);
const png = Array.from(new Uint8Array(await (await fetch(canvas.toDataURL())).arrayBuffer()));
window.calls = []; window.notices = []; window.outcome = 'cpu';
mockIPC(async (cmd, args) => {
  window.calls.push({cmd, args});
  if (cmd === 'get_output_root') return 'C:/synthetic-output';
  if (cmd === 'list_matting_models') return [{id:'modnet', installed:true, current:true, display_name:'MODNet', bytes:25888640}];
  if (cmd === 'plugin:dialog|open') return 'C:/synthetic-image.png';
  if (cmd === 'read_file_bytes') return png;
  if (cmd === 'segment_image') {
    await new Promise(resolve => { window.finishSegment = resolve; });
    if (window.outcome === 'failure') throw 'matting:backends-failed:gpu=[synthetic];cpu=[synthetic]';
    return {path:'C:/synthetic-preview.png', used_cpu_fallback:window.outcome === 'fallback'};
  }
  return null;
}, {shouldMockEvents:true});
const { initBgRemovalTool } = await import('/src/features/bg-removal/tool.js');
const { setLangWithoutFade } = await import('/src/i18n.js');
window.setTestLang = setLangWithoutFade;
window.mountTool = () => {
  window.tool = initBgRemovalTool({overlay:document.querySelector('#bgRemovalOverlay'),
    isTauri:true, notify:message => window.notices.push(message)});
  window.tool.open();
};
window.mountTool(); window.ready = true;
</script></body></html>`;
const entry = ['/src/styles/index.css', '/src/tool-custom-select.css', '/src/styles/index.css']
  .map(file => `import '${file}';`).join('\n')
  + html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const bundle = await build({configFile:false, logLevel:'error',
  plugins:[{name:'matting-test-harness', resolveId(id) {
    if (id === 'virtual:matting-test') return '\0matting-test';
  }, load(id) { if (id === '\0matting-test') return entry; }}],
  build:{write:false, cssCodeSplit:false, rollupOptions:{input:'virtual:matting-test',
    output:{entryFileNames:'test.js'}}}});
const assets = new Map(bundle.output.map(item => [`/${item.fileName}`, item]));
const styles = bundle.output.filter(item => item.fileName.endsWith('.css'))
  .map(item => `<link rel="stylesheet" href="/${item.fileName}">`).join('');
const server = createServer((req,res) => {
  const asset = assets.get(req.url);
  if (asset) {
    res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'application/javascript');
    res.end(asset.type === 'chunk' ? asset.code : asset.source);
  } else {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><html data-tk-auxiliary><head>${styles}</head><body>
      <div id="bgRemovalOverlay"></div><script type="module" src="/test.js"></script></body></html>`);
  }
});
let browser;
const report = { checks: [], errors: [] };
try {
  console.log('Starting background-removal browser harness');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  console.log('Launching browser');
  browser = await chromium.launch({headless:true,
    ...(process.env.TOOLKNIT_TEST_BROWSER ? {executablePath:process.env.TOOLKNIT_TEST_BROWSER} : {})});
  const page = await browser.newPage({viewport:{width:1400,height:920}});
  console.log('Loading feature');
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => window.ready);
  const mode = page.locator('[data-bgr-execution-mode]');
  const trigger = page.locator('[data-bgr-execution-mode] + .tool-custom-select button');
  for (const theme of ['light', 'dark']) {
    for (const lang of ['zh', 'en']) {
      await page.evaluate(({theme,lang}) => {
        document.documentElement.dataset.theme = theme; window.setTestLang(lang);
      }, {theme,lang});
      await trigger.click();
      await page.locator('[data-tool-select-value="cpu"]').click();
      assert.equal(await mode.inputValue(), 'cpu');
      assert.match(await trigger.textContent(), /CPU/);
      await page.evaluate(() => { window.tool.close(); window.tool.dispose(); window.mountTool(); });
      assert.equal(await mode.inputValue(), 'cpu', 'preference survives disposal and reconstruction');
      await page.screenshot({path:path.join(output, `${theme}-${lang}.png`)});
      const geometry = await trigger.evaluate(node => {
        const text = node.querySelector('span'); const rect = node.getBoundingClientRect();
        return {overflow:text.scrollWidth > text.clientWidth + 1, right:rect.right, width:innerWidth};
      });
      assert.equal(geometry.overflow, false);
      assert.ok(geometry.right <= geometry.width);
      report.checks.push(`${theme}/${lang}: dropdown, persistence, layout`);
    }
  }
  await page.locator('[data-bgr-action="upload"]').first().click();
  await page.waitForFunction(() => document.querySelector('#bgRemovalOverlay').dataset.bgRemovalState === 'ready');
  await page.locator('[data-bgr-action="process"]').click();
  assert.equal(await trigger.isDisabled(), true, 'mode cannot change while processing');
  await page.waitForFunction(() => typeof window.finishSegment === 'function');
  assert.equal(await page.evaluate(() => window.calls.findLast(c => c.cmd === 'segment_image').args.forceCpu), true);
  await page.evaluate(() => { window.finishSegment(); window.finishSegment = null; });
  await page.waitForFunction(() => document.querySelector('#bgRemovalOverlay').dataset.bgRemovalState === 'editing');
  assert.doesNotMatch(await page.locator('[data-bgr-status]').textContent(), /GPU acceleration is unavailable/);
  assert.equal(await trigger.isDisabled(), false);
  await trigger.click(); await page.locator('[data-tool-select-value="auto"]').click();
  await page.evaluate(() => { window.outcome = 'fallback'; });
  await page.locator('[data-bgr-action="process"]').click();
  await page.waitForFunction(() => typeof window.finishSegment === 'function');
  assert.equal(await page.evaluate(() => window.calls.findLast(c => c.cmd === 'segment_image').args.forceCpu), false);
  await page.evaluate(() => { window.finishSegment(); window.finishSegment = null; });
  await page.waitForFunction(() => document.querySelector('#bgRemovalOverlay').dataset.bgRemovalState === 'editing');
  assert.match(await page.locator('[data-bgr-status]').textContent(), /GPU acceleration is unavailable/);
  assert.match(await page.evaluate(() => window.notices.at(-1)), /GPU acceleration is unavailable/);
  await page.evaluate(() => { window.outcome = 'failure'; });
  await page.locator('[data-bgr-action="process"]').click();
  await page.waitForFunction(() => typeof window.finishSegment === 'function');
  assert.equal(await page.evaluate(() => window.calls.findLast(c => c.cmd === 'segment_image').args.forceCpu), false);
  await page.evaluate(() => window.finishSegment());
  await page.waitForFunction(() => document.querySelector('#bgRemovalOverlay').dataset.bgRemovalState === 'error');
  assert.match(await page.locator('[data-bgr-status]').textContent(), /Repair or reinstall/);
  assert.match(await page.evaluate(() => window.notices.at(-1)), /Repair or reinstall/);
  report.checks.push('native payload, busy state, fallback feedback, dual failure feedback');
  await page.evaluate(() => { window.tool.close(); window.tool.dispose(); });
  assert.equal(await page.locator('.tool-custom-select-menu').count(), 0, 'detached menus must be disposed');
  assert.deepEqual(report.errors, []);
  console.log(`Background removal browser tests passed: ${report.checks.length} checks`);
} catch (error) {
  report.errors.push(String(error));
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
