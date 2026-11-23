import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import JSZip from 'jszip';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/icon-gen-ui');
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: false, root: process.cwd(), cacheDir: 'tmp/icon-gen-ui/vite-cache',
  optimizeDeps: { noDiscovery: true, include: ['jszip'] },
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  plugins: [{ name: 'icon-gen-test-shell', configureServer(server) {
    server.middlewares.use('/icon-test', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html data-theme="light"><head><link rel="stylesheet" href="/src/styles/index.css"><link rel="stylesheet" href="/src/tool-page-v2-final.css"><link rel="stylesheet" href="/src/tool-nav-unified.css"></head><body><div class="pdf-merge-overlay pdf-merge-v2 icon-gen-v2 audio-convert-overlay" id="iconGenOverlay" aria-hidden="true"></div></body></html>');
    });
  } }]
});
let browser;
let page;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
  page = await browser.newPage({ viewport: { width: 1400, height: 887 }, acceptDownloads: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}icon-test`);
  const imageBase64 = await page.evaluate(async () => {
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1, unregisterCallback: () => {}, invoke: async () => 1
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    const { initIconGeneratorTool } = await import('/src/features/icon-generator/tool.js');
    const { t, onLangChange, setLangWithoutFade: setLang } = await import('/src/i18n.js');
    const { createIcons, icons } = await import('/node_modules/lucide/dist/esm/lucide.js');
    const { createModalRuntime } = await import('/src/app/modal-runtime.js');
    const modals = createModalRuntime();
    modals.initA11y();
    modals.initOverflow();
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#257a6b'; ctx.fillRect(0, 0, 128, 96);
    ctx.fillStyle = '#edcd3e'; ctx.fillRect(32, 24, 64, 48);
    const base64 = canvas.toDataURL('image/png').split(',')[1];
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    window.iconQA = { messages: [], folderCalls: [], nativeCalls: [], setLang, mode: 'success',
      savedPath: 'C:/qa-output/Icons/icons_123.zip', modals };
    const qa = window.iconQA;
    qa.init = native => {
      qa.tool?.dispose();
      qa.tool = initIconGeneratorTool({
        overlay: document.querySelector('#iconGenOverlay'), isTauri: native, t, onLangChange,
        getOutputDir: async () => 'C:/qa-output/Icons', refreshIcons: () => createIcons({ icons }),
        showError: message => qa.messages.push(message),
        tauriCore: Promise.resolve({ invoke: async (command, args) => {
          qa.nativeCalls.push({ command, directory: args?.directory });
          if (command === 'begin_icon_archive_write') return 42;
          if (command === 'append_icon_archive_chunk') return;
          if (command === 'finalize_icon_archive_write') return qa.savedPath;
          if (command === 'discard_icon_archive_write') return;
          throw new Error(`Unexpected command: ${command}`);
        } }),
        openOutputFolder: async directory => {
          qa.folderCalls.push(directory);
          if (qa.mode === 'reject') throw new Error('folder unavailable');
          if (qa.mode === 'false') return false;
          if (qa.mode === 'pending') return new Promise(resolve => { qa.finishOpen = resolve; });
          return true;
        }
      });
      qa.tool.open();
    };
    qa.add = (name = 'source.png') => {
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { files: [new File([bytes], name, { type: 'image/png' })] } });
      document.querySelector('#iconGenOverlay').dispatchEvent(event);
    };
    qa.init(false);
    return base64;
  });
  const source = { name: 'source.png', mimeType: 'image/png', buffer: Buffer.from(imageBase64, 'base64') };
  await page.locator('input[type="file"]').setInputFiles(source);
  await page.waitForSelector('#iconGenFiles .audio-convert-file-thumb');
  const longName = 'image-with-a-very-long-name-'.repeat(8) + '.png';
  await page.evaluate(name => window.iconQA.add(name), longName);
  await page.waitForFunction(name => document.querySelector('#iconGenFiles .audio-convert-file-name').textContent === name, longName);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [1400, 1100, 390]) {
      await page.setViewportSize({ width, height: 887 });
      const row = page.locator('#iconGenFiles .audio-convert-file-item');
      await row.scrollIntoViewIfNeeded();
      const geometry = await row.evaluate(n => {
        const bounds = node => { const r = node.getBoundingClientRect(); return { x: r.x, right: r.right, center: r.y + r.height / 2, width: r.width, height: r.height }; };
        return { row: bounds(n), children: [...n.children].map(bounds),
          align: getComputedStyle(n.children[1]).textAlign, color: getComputedStyle(n.children[2]).color,
          loaded: n.children[0].complete && n.children[0].naturalWidth > 0 };
      });
      assert.equal(geometry.children.length, 4);
      assert.equal(geometry.align, 'left');
      assert.ok(geometry.loaded, 'thumbnail must decode');
      assert.equal(geometry.children[0].width, 42);
      for (let i = 0; i < 4; i++) {
        assert.ok(Math.abs(geometry.children[i].center - geometry.row.center) < 1, 'all source fields share one row');
        assert.ok(geometry.children[i].right <= geometry.row.right);
        if (i) assert.ok(geometry.children[i].x >= geometry.children[i - 1].right);
      }
      if (theme === 'light') assert.equal(geometry.color, 'rgb(101, 104, 111)');
      await row.screenshot({ path: path.join(output, `${theme}-source-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 1400, height: 887 });
  await page.locator('#iconGenFiles .audio-convert-file-remove').click();
  assert.equal(await page.locator('#iconGenFiles .audio-convert-file-item').count(), 0);
  await page.locator('input[type="file"]').setInputFiles(source);
  const downloadReady = page.waitForEvent('download');
  await page.locator('#iconGenProcessBtn').click();
  const download = await downloadReady;
  await download.saveAs(path.join(output, 'icons.zip'));
  const zip = await JSZip.loadAsync(await readFile(path.join(output, 'icons.zip')));
  assert.equal(Object.values(zip.files).filter(entry => !entry.dir).length, 19);
  const popup = page.locator('#iconGenSuccessOverlay');
  const folder = page.locator('#iconGenOpenFolder');
  const waitSuccess = () => page.waitForSelector('#iconGenSuccessOverlay.visible');
  await waitSuccess();
  assert.equal(await folder.isVisible(), true);
  assert.equal(await folder.isDisabled(), true);
  assert.match(await page.locator('#iconGenSuccessPath').innerText(), /icons.zip/);
  await page.evaluate(() => window.iconQA.setLang('en'));
  assert.match(await folder.getAttribute('title'), /browser/);
  assert.match(await page.locator('#iconGenSuccessPath').innerText(), /browser downloads/);
  await page.evaluate(() => window.iconQA.setLang('zh'));
  await popup.screenshot({ path: path.join(output, 'browser-result.png') });
  await page.locator('#iconGenSuccessOk').click();
  assert.equal(await popup.getAttribute('aria-hidden'), 'true');
  console.log('PASS light/dark source layout, long names, remove/reupload, real 19-file ZIP and browser result');

  await page.evaluate(() => { window.iconQA.init(true); window.iconQA.add(); });
  const generate = async () => { await page.locator('#iconGenProcessBtn').click(); await waitSuccess(); };
  await generate();
  assert.equal(await folder.isEnabled(), true);
  assert.equal(await page.locator('#iconGenSuccessPath').textContent(), 'C:/qa-output/Icons');
  const calls = await page.evaluate(() => window.iconQA.nativeCalls.map(call => call.command));
  assert.deepEqual(calls, ['begin_icon_archive_write', 'append_icon_archive_chunk', 'finalize_icon_archive_write']);
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [1400, 390]) {
      await page.setViewportSize({ width, height: 887 });
      const dialog = await popup.locator('.audio-convert-success-dialog').boundingBox();
      const buttons = await popup.locator('.audio-convert-success-actions button').evaluateAll(nodes => nodes.map(n => {
        const r = n.getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y, width: r.width };
      }));
      assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= width + 1);
      assert.equal(buttons[0].y, buttons[1].y);
      assert.ok(buttons[0].right <= buttons[1].x);
      assert.ok(Math.abs(buttons[0].width - buttons[1].width) < 1);
      await popup.screenshot({ path: path.join(output, `${theme}-native-result-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 1400, height: 887 });
  await page.evaluate(() => { window.iconQA.mode = 'false'; });
  await folder.click();
  await page.waitForFunction(() => !document.querySelector('#iconGenOpenFolder').disabled);
  assert.equal(await popup.evaluate(n => n.classList.contains('visible')), true);
  await page.evaluate(() => { window.iconQA.mode = 'reject'; });
  await folder.click();
  await page.waitForFunction(() => window.iconQA.messages.length === 1);
  assert.equal(await popup.evaluate(n => n.classList.contains('visible')), true);
  await page.evaluate(() => { window.iconQA.mode = 'success'; });
  await folder.click();
  await page.waitForFunction(() => !document.querySelector('#iconGenSuccessOverlay').classList.contains('visible'));
  assert.deepEqual(await page.evaluate(() => window.iconQA.folderCalls), Array(3).fill('C:/qa-output/Icons'));
  await generate();
  await page.evaluate(() => { window.iconQA.mode = 'pending'; });
  await folder.click();
  assert.equal(await folder.isDisabled(), true);
  await page.evaluate(() => document.querySelector('#iconGenOpenFolder').click());
  assert.equal(await page.evaluate(() => window.iconQA.folderCalls.length), 4);
  await page.locator('#iconGenSuccessOk').click();
  await generate();
  await page.evaluate(() => window.iconQA.finishOpen(true));
  assert.equal(await popup.evaluate(n => n.classList.contains('visible')), true, 'old folder requests cannot dismiss a new result');
  await page.locator('#iconGenSuccessOk').click();
  await page.evaluate(() => { window.iconQA.tool.close(); window.iconQA.tool.open(); });
  assert.equal(await page.locator('#iconGenFiles .audio-convert-file-item').count(), 0);
  assert.equal(await popup.evaluate(n => n.classList.contains('visible')), false);
  assert.equal(await popup.getAttribute('aria-hidden'), 'true');
  assert.equal(await popup.evaluate(n => n.inert), true);
  await page.evaluate(() => { window.iconQA.tool.dispose(); window.iconQA.tool.dispose(); });
  assert.equal(await page.locator('[data-icon-generator-portal]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS native archive publication, real output parent, dual actions, folder failures/retry, stale requests and lifecycle');
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
