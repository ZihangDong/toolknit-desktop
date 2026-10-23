import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { PDFDocument } from 'pdf-lib';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const root = path.resolve('tmp/v32-pdf-creation/formats'), output = path.join(root, 'exports');
await mkdir(output, { recursive: true });
const report = JSON.parse(await readFile(path.join(root, 'native-report.json'), 'utf8'));
const byName = new Map(report.map(item => [item.name, item]));
const selected = report.map(item => path.join(root, item.name));
const expectedPages = report.reduce((count, item) => count + (item.info?.frames.length || 0), 0);
const writes = new Map(), calls = [], published = [];
let sequence = 0, failAppend = false, holdBegin = null, holdFinish = null, resizable = false;
const assets = [];
for (const name of await readdir('dist/assets')) if (/\.(js|css)$/.test(name)) assets.push({ name, source: await readFile(path.join('dist/assets', name), 'utf8') });
const artifact = (test, extension) => {
  const found = assets.filter(file => file.name.endsWith(extension) && test(file.source));
  assert.equal(found.length, 1, 'expected one built artifact: ' + found.map(file => file.name).join(', '));
  return '/assets/' + found[0].name;
};
const templateUrl = artifact(source => source.includes('id="imagePdfOverlay"'), '.js');
const toolUrl = artifact(source => source.includes('as initImagePdfTool'), '.js');
const styleUrl = artifact(source => source.includes('.image-pdf-button'), '.css');
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, executablePath: process.env.TOOLKNIT_TEST_BROWSER });
const watchdog = setTimeout(() => { void browser.close(); }, 120000);
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } }); page.setDefaultTimeout(30000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.exposeFunction('imagePdfTestStage', stage => console.log(stage));
  await page.exposeFunction('imagePdfNativeBridge', async (command, args) => {
    calls.push(command);
    if (command === 'plugin:app|version') return '3.2.0';
    if (command === 'get_output_root') return 'C:/ToolKnit-Output';
    if (command === 'load_ai_api_key') return '';
    if (['list_custom_fonts', 'list_transcription_models', 'list_matting_models'].includes(command)) return [];
    if (['get_autostart', 'plugin:window|is_maximized', 'plugin:window|is_decorated'].includes(command)) return false;
    if (command === 'plugin:window|current_monitor') return null;
    if (command === 'plugin:window|is_resizable') return resizable;
    if (command === 'plugin:window|set_resizable') { resizable = args.value; return; }
    if (command.startsWith('plugin:window|set_')) return;
    if (command === 'get_screen_picker_shortcut') return { enabled: false, shortcut: 'Ctrl+Shift+A' };
    if (command === 'get_ffmpeg_runtime_status') return { installed: false, available: false };
    if (command === 'local_translation') return { ready: false, installing: false, progress: {}, targetLanguage: 'zh-Hans' };
    if (command === 'quick_screenshot') return { enabled: false, historyEnabled: false, shortcut: 'Alt+Q' };
    if (command === 'plugin:dialog|open') return selected;
    if (command === 'plugin:event|listen') return ++sequence;
    if (command === 'plugin:event|unlisten') return;
    if (command === 'inspect_image_pdf_input') {
      const item = byName.get(path.basename(args.path));
      if (item.error) throw new Error('image-pdf:' + item.error);
      return structuredClone(item.info);
    }
    if (command === 'read_image_pdf_page') {
      const item = byName.get(path.basename(args.path)); assert.equal(args.digest, item.info.digest);
      const bytes = await readFile(path.join(root, item.decoded[args.index]));
      return { binary: bytes.toString('base64') };
    }
    if (command === 'begin_pdf_enhance_write') {
      const id = ++sequence; writes.set(id, { args, chunks: [] });
      if (holdBegin) { const hold = holdBegin; holdBegin = null; await hold.promise; }
      return id;
    }
    if (command === 'append_pdf_enhance_chunk') {
      if (failAppend) throw new Error('pdf-enhance:output-path');
      assert.ok(args.bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255));
      writes.get(args.sessionId).chunks.push(Buffer.from(args.bytes)); return;
    }
    if (command === 'discard_pdf_enhance_write') { writes.delete(args.sessionId); return; }
    if (command === 'finalize_pdf_enhance_write') {
      if (holdFinish) { const hold = holdFinish; holdFinish = null; await hold.promise; }
      const item = writes.get(args.sessionId), bytes = Buffer.concat(item.chunks);
      const pdf = await PDFDocument.load(bytes); assert.equal(pdf.getPageCount(), item.args.expectedPages);
      const file = path.join(output, `native-bridge-${published.length + 1}.pdf`);
      await writeFile(file, bytes); writes.delete(args.sessionId); published.push({ path: file, pages: pdf.getPageCount() });
      return file;
    }
    if (command === 'open_image_pdf_result' || command === 'open_path') {
      assert.equal(args.path, published.at(-1).path); return;
    }
    throw new Error('Unexpected native command: ' + command);
  });
  await page.addInitScript(() => {
    let callback = 0;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => ++callback,
      unregisterCallback: () => {},
      invoke: async (command, args) => {
        const value = await window.imagePdfNativeBridge(command, args);
        if (value?.binary) return Uint8Array.from(atob(value.binary), c => c.charCodeAt(0)).buffer;
        return value;
      }
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    localStorage.setItem('toolknit-lang', 'zh');
  });
  await page.route('**/__image-pdf-test', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html data-theme="light" data-tk-auxiliary><body style="margin:0;font-family:sans-serif"></body></html>' }));
  await page.goto(new URL('__image-pdf-test', url).href);
  console.log('Opened isolated native bridge host');
  await page.evaluate(async ({ templateUrl, toolUrl, styleUrl }) => {
    const sheet = document.createElement('link'); sheet.rel = 'stylesheet'; sheet.href = styleUrl; document.head.append(sheet);
    const markup = (await import(templateUrl)).default;
    await window.imagePdfTestStage('Imported template');
    document.body.innerHTML = markup;
    const { initImagePdfTool } = await import(toolUrl);
    await window.imagePdfTestStage('Imported controller');
    window.imagePdfTool = initImagePdfTool({ overlay: document.getElementById('imagePdfOverlay'), isTauri: true,
      getOutputDir: async kind => 'C:/ToolKnit-Output/' + kind });
    window.imagePdfTool.open();
  }, { templateUrl, toolUrl, styleUrl });
  console.log('Mounted native image PDF controller');
  await page.locator('#imagePdfPick').click();
  await page.waitForFunction(count => document.querySelectorAll('[data-image-page]').length === count
    && !document.querySelector('#imagePdfProcess').classList.contains('visible'), expectedPages);
  assert.equal(await page.locator('[data-remove-failure]').count(), 1, 'unsupported TIFF remains an explicit rejected input');
  console.log('Imported native decoded format matrix');
  await page.locator('[data-remove-failure]').click();
  await page.waitForFunction(() => !document.querySelector('#imagePdfExport').disabled);
  await page.locator('#imagePdfExport').click(); await page.locator('#imagePdfSuccess.visible').waitFor();
  assert.equal(published[0].pages, expectedPages);
  await page.locator('#imagePdfOpen').click(); await page.locator('#imagePdfFolder').click();
  await page.locator('#imagePdfDone').click();
  assert.equal(writes.size, 0);
  failAppend = true;
  await page.locator('#imagePdfExport').click();
  await page.waitForFunction(() => !document.querySelector('#imagePdfProcess').classList.contains('visible'));
  assert.equal(published.length, 1); assert.equal(writes.size, 0);
  assert.ok(calls.includes('discard_pdf_enhance_write'), 'failed writes are discarded');
  assert.equal(await page.locator('#imagePdfStatus').evaluate(node => node.classList.contains('is-error')), true);
  failAppend = false;
  const gate = Promise.withResolvers(); holdBegin = gate;
  await page.locator('#imagePdfExport').click();
  for (let attempts = 0; writes.size === 0 && attempts < 200; attempts++) await page.waitForTimeout(50);
  assert.equal(writes.size, 1);
  await page.locator('#imagePdfCancel').click(); gate.resolve();
  await page.waitForFunction(() => !document.querySelector('#imagePdfProcess').classList.contains('visible'));
  assert.equal(published.length, 1); assert.equal(writes.size, 0);
  assert.equal(await page.locator('[data-image-page]').count(), expectedPages, 'cancel preserves imported images');
  const finishGate = Promise.withResolvers(); holdFinish = finishGate;
  await page.locator('#imagePdfExport').click();
  await page.waitForFunction(() => document.querySelector('#imagePdfCancel').disabled);
  assert.equal(await page.evaluate(() => window.imagePdfTool.close()), false, 'ordinary close cannot interrupt final publication');
  await page.evaluate(() => window.imagePdfTool.dispose());
  assert.equal(await page.locator('#imagePdfOverlay').isVisible(), false, 'disposal still releases UI during final publication');
  finishGate.resolve();
  for (let attempts = 0; published.length < 2 && attempts < 100; attempts++) await page.waitForTimeout(20);
  assert.equal(published.length, 2); assert.equal(writes.size, 0);
  assert.equal(await page.locator('#imagePdfSuccess').isVisible(), false, 'late save does not reopen disposed UI');
  // A fresh instance owns the next session after disposal.
  await page.evaluate(async toolUrl => {
    const { initImagePdfTool } = await import(toolUrl);
    window.imagePdfTool = initImagePdfTool({ overlay: document.getElementById('imagePdfOverlay'), isTauri: true,
      getOutputDir: async kind => 'C:/ToolKnit-Output/' + kind });
  }, toolUrl);
  await page.evaluate(() => window.imagePdfTool.close());
  await page.evaluate(() => window.imagePdfTool.open());
  assert.equal(await page.locator('[data-image-page]').count(), 0);
  await page.evaluate(() => window.imagePdfTool.dispose());
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'bridge-report.json'), JSON.stringify({ published, calls, errors }, null, 2));
  console.log('Native-decoded format matrix -> real worker PDF -> binary IPC, write failure/cancellation cleanup, result actions and reentry passed');
} finally { clearTimeout(watchdog); await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
