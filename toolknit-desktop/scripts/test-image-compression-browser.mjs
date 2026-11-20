import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const server = await createServer({ configFile: false, root: process.cwd(),
  cacheDir: 'tmp/image-compression-ui/vite-cache',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  plugins: [{ name: 'compression-test-shell', configureServer(server) {
    server.middlewares.use('/compression-test', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html data-theme="light"><head><link rel="stylesheet" href="/src/styles/index.css"><link rel="stylesheet" href="/src/tool-page-v2-final.css"><link rel="stylesheet" href="/src/tool-nav-unified.css"></head><body><div id="imageCompressOverlay" class="pdf-merge-overlay pdf-merge-v2 image-compress-v2 audio-convert-overlay" aria-hidden="true"></div></body></html>');
    });
  } }]
});
let browser;
const output = path.resolve('tmp/image-compression-ui');
await mkdir(output, { recursive: true });
try {
  await server.listen();
  console.log('Compression UI test server ready');
  browser = await chromium.launch({ headless: true,
    ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
  const page = await browser.newPage({ viewport: { width: 1400, height: 887 } });
  const timeout = setTimeout(() => { void page.close(); }, 90000);
  timeout.unref();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}compression-test`);
  console.log('Compression test shell loaded');
  await page.evaluate(async () => {
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1, unregisterCallback: () => {}, invoke: async () => 1
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    const { initImageCompressTool } = await import('/src/features/image-batch/tool.js');
    const { t, onLangChange, setLangWithoutFade: setLang } = await import('/src/i18n.js');
    const { createIcons, icons } = await import('/node_modules/lucide/dist/esm/lucide.js');
    const { createModalRuntime } = await import('/src/app/modal-runtime.js');
    const modals = createModalRuntime();
    modals.initA11y();
    modals.initOverflow();
    window.compressionQA = { messages: [], pending: false, result: null, setLang };
    const qa = window.compressionQA;
    const tool = initImageCompressTool({
      overlay: document.querySelector('#imageCompressOverlay'), isTauri: true, t, onLangChange,
      getOutputDir: async () => 'C:/qa-output', refreshIcons: () => createIcons({ icons }),
      showError: message => qa.messages.push(message),
      tauriEvents: Promise.resolve({ listen: async () => () => {} }),
      tauriCore: Promise.resolve({ invoke: async command => {
        if (command === 'cancel_convert') return;
        if (command !== 'compress_image_batch') throw new Error(`Unexpected command: ${command}`);
        if (qa.pending) await new Promise(resolve => { qa.finish = resolve; });
        return qa.result;
      } })
    });
    qa.tool = tool;
    qa.add = () => {
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { files: ['one.png', 'two.png', 'three.png']
        .map(name => ({ name, path: `C:/qa/${name}`, size: 1024 })) } });
      document.querySelector('#imageCompressOverlay').dispatchEvent(event);
    };
    tool.open();
    qa.add();
  });
  console.log('Compression controller initialized');
  const resultModal = page.locator('#imageCompressSuccessOverlay');
  const waitResult = () => page.waitForSelector('#imageCompressSuccessOverlay.visible');
  const isResultOpen = () => resultModal.evaluate(node => node.classList.contains('visible'));
  const result = async (success, fail, errors = []) => {
    await page.evaluate(value => { window.compressionQA.result = value; }, {
      success_count: success, fail_count: fail, errors, output_dir: 'C:/qa-output',
      original_size: 3072, compressed_size: success ? 2048 : 3072
    });
    await page.locator('#imageCompressProcessBtn').click();
  };
  for (const [success, fail, unchanged] of [[3, 0, 0], [1, 0, 2], [0, 0, 3], [1, 1, 1], [0, 1, 2]]) {
    await result(success, fail, fail ? ['three.png: invalid PNG data'] : []);
    console.log(`Checking compression result ${success}/${fail}/${unchanged}`);
    await waitResult();
    const text = await page.locator('#imageCompressSuccessMeta').innerText();
    if (unchanged) assert.ok(text.includes(`${unchanged} 张未变小`), text);
    assert.equal(await page.locator('#imageCompressOpenFolder').isDisabled(), success === 0);
    assert.equal(await page.locator('#imageCompressFailureSummary').isVisible(), fail > 0);
    assert.equal(await resultModal.locator('.audio-convert-success-icon').getAttribute('data-result-state'),
      success > 0 && fail === 0 ? 'success' : 'info');
    await page.evaluate(() => window.compressionQA.setLang('en'));
    assert.ok(!(await resultModal.innerText()).includes('home.imageCompress.'));
    if (unchanged) assert.match(await page.locator('#imageCompressSuccessMeta').innerText(), /not smaller/);
    await page.evaluate(() => window.compressionQA.setLang('zh'));
    if (success === 0 && fail === 0) {
      for (const [width, height] of [[1400, 887], [1024, 700], [390, 844]]) {
        await page.setViewportSize({ width, height });
        const box = await resultModal.locator('.audio-convert-success-dialog').boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
        await page.screenshot({ path: path.join(output, `unchanged-${width}.png`) });
      }
      await page.setViewportSize({ width: 1400, height: 887 });
    }
    await page.locator('#imageCompressSuccessOk').click();
    await page.evaluate(() => window.compressionQA.add());
  }
  await result(0, 3, ['invalid one', 'invalid two', 'invalid three']);
  await page.waitForFunction(() => window.compressionQA.messages.length === 1);
  assert.equal(await isResultOpen(), false);
  assert.equal(await page.locator('#imageCompressFiles .audio-convert-file-item').count(), 3);
  await page.evaluate(() => { window.compressionQA.pending = true; });
  await result(3, 0);
  await page.waitForFunction(() => typeof window.compressionQA.finish === 'function');
  await page.locator('#imageCompressCancelBtn').click();
  await page.evaluate(() => { window.compressionQA.finish(); window.compressionQA.pending = false; });
  await page.waitForTimeout(600);
  assert.equal(await isResultOpen(), false, 'cancelled results must not reopen the modal');
  await result(3, 0);
  await waitResult();
  await page.locator('#imageCompressSuccessOk').click();
  await page.evaluate(() => { window.compressionQA.tool.close(); window.compressionQA.tool.open(); window.compressionQA.tool.dispose(); });
  assert.equal(await page.locator('#imageCompressSuccessOverlay').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS compression outcomes, languages, responsive results, retry, cancel and reopen (mock IPC; native codec tested separately)');
} finally {
  await browser?.close();
  await server.close();
}
