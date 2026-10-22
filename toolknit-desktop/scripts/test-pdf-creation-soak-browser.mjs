import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { preview } from 'vite';
import { PDFDocument, degrees } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const minutes = Math.min(90, Math.max(0, Number(process.env.TOOLKNIT_PDF_SOAK_MINUTES) || 0));
const rounds = Math.max(12, Number(process.env.TOOLKNIT_PDF_SOAK_ROUNDS) || 12);
const output = path.resolve(process.env.TOOLKNIT_SOAK_OUTPUT || 'tmp/v32-pdf-creation/soak'); await mkdir(output, { recursive: true });
function imageFixture(width, height, name) {
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#21693f'; ctx.fillRect(width * .1, height * .1, width * .8, height * .8);
  ctx.fillStyle = '#fff'; ctx.font = '28px sans-serif'; ctx.fillText(name, width * .15, height * .5);
  const result = { name: name + '.png', mimeType: 'image/png', buffer: canvas.toBuffer('image/png') };
  canvas.width = canvas.height = 0; return result;
}
const images = [imageFixture(1200, 1800, 'portrait'), imageFixture(32, 3200, 'tall'),
  imageFixture(3200, 32, 'wide'), imageFixture(6000, 6000, '36MP')];
const appendix = await PDFDocument.create(), appendixPage = appendix.addPage([400, 300]);
appendixPage.setCropBox(20, 10, 360, 280); appendixPage.setRotation(degrees(90));
appendixPage.drawText('Synthetic crop and rotation sample', { x: 30, y: 200, size: 12 });
const extra = { name: 'rotated-crop.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await appendix.save()) };
const server = await preview({ configFile: false, logLevel: 'error', build: { outDir: process.env.TOOLKNIT_TEST_DIST || 'dist' }, preview: { host: '127.0.0.1', port: 0 } });
const url = server.resolvedUrls.local[0], report = { minutes, started: new Date().toISOString(), cycles: [], errors: [] };
const browser = await chromium.launch({ headless: true, executablePath: process.env.TOOLKNIT_TEST_BROWSER });
const watchdog = setTimeout(() => { void browser.close(); }, Math.max(180000, (minutes + 5) * 60000, rounds * 15000));
let activePage;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin
    ? route.continue() : route.fulfill({ body: '{}', contentType: 'application/json' }));
  await context.addInitScript(trace => {
    localStorage.setItem('toolknit.theme.v3', 'light'); localStorage.setItem('toolknit-lang', 'zh');
    localStorage.setItem('toolknit.recording-mode.prompt-dismissed.v1', 'true');
    const resources = window.__soakResources = { urls: new Set(), workers: new Set() };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); resources.urls.add(url); return url; };
    URL.revokeObjectURL = url => { resources.urls.delete(url); revoke(url); };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); resources.workers.add(this); }
      terminate() { resources.workers.delete(this); return super.terminate(); }
    };
    if (trace) {
      const events = window.__soakEvents = [], add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function(type, handler, options) {
        if (this instanceof Node) events.push({ target: new WeakRef(this), type,
          signal: options?.signal ? new WeakRef(options.signal) : null });
        return add.call(this, type, handler, options);
      };
    }
  }, process.env.TOOLKNIT_SOAK_TRACE === '1');
  const page = await context.newPage(), cdp = await context.newCDPSession(page);
  activePage = page;
  page.setDefaultTimeout(35000); page.on('pageerror', error => report.errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  page.on('console', message => { if (/Blocked aria-hidden/.test(message.text())) report.errors.push(message.text()); });
  const settle = () => page.waitForFunction(() => !document.querySelector('[data-tk-page-transition-veil]')
    || getComputedStyle(document.querySelector('[data-tk-page-transition-veil]')).visibility === 'hidden');
  const open = async tool => {
    await page.locator(`.audio-list-item[data-tool="${tool}"]`).evaluate(node => node.click());
    await page.locator(tool === 'pdf-editor' ? '#pdfEditorOverlay.visible' : '#imagePdfOverlay.visible').waitFor();
    await settle();
  };
  const editorReady = () => page.waitForFunction(() => !document.querySelector('#pdfEditorExport').disabled
    && document.querySelector('.pdf-editor-main-canvas')?.width > 10);
  const imageReady = () => page.waitForFunction(() => !document.querySelector('#imagePdfExport').disabled
    && !document.querySelector('#imagePdfPreview').hidden && document.querySelector('#imagePdfPreview').naturalWidth > 0);
  async function verifyDownload(button, expectedPages) {
    const promise = page.waitForEvent('download', { timeout: 120000 }); await page.locator(button).click();
    const download = await promise, bytes = await readFile(await download.path());
    const pdf = await PDFDocument.load(bytes); assert.equal(pdf.getPageCount(), expectedPages);
    await download.delete(); return bytes.length;
  }
  await page.goto(url); await page.waitForFunction(() => !document.documentElement.dataset.tkStartup);
  const started = performance.now(); let baselineHeap = null, baselineDom = null, baselineConnected = null;
  for (let i = 0; i < rounds || performance.now() - started < minutes * 60000; i++) {
    const begin = performance.now(), row = { cycle: i + 1, image: images[i % images.length].name };
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, i % 2 ? 'dark' : 'light');
    await open('image-to-pdf');
    await page.locator('#imagePdfInput').setInputFiles([images[i % images.length], images[0]]); await imageReady();
    if (i % 3 === 0) { await page.locator('#imagePdfRotate').click(); await imageReady(); }
    const mode = ['faithful', 'grayscale', 'natural'][i % 3];
    await page.locator(`[data-image-setting="mode"][data-value="${mode}"]`).click();
    await page.locator(`[data-image-setting="quality"][data-value="${['clear', 'balanced', 'small'][i % 3]}"]`).click();
    await imageReady(); row.imagePdfBytes = await verifyDownload('#imagePdfExport', 2);
    await page.locator('#imagePdfDone').click(); await page.locator('[data-image-pdf-close]').click(); await settle();
    await open('pdf-editor'); await page.locator('#pdfEditorNewDocument').click(); await editorReady();
    await page.locator('#pdfEditorInsertText').click();
    await page.locator('#pdfEditorEditInput').fill(`Cycle ${i + 1}\n\nEditable document`);
    await page.locator('#pdfEditorEditInput').press('Control+Enter');
    await page.locator('.pdf-editor-main-canvas').click({ position: { x: 100, y: 120 } });
    await page.locator('.pdf-editor-inserted-text').waitFor();
    await page.locator('#pdfEditorDuplicate').click(); await editorReady();
    await page.locator('#pdfEditorAppendInput').setInputFiles(extra);
    await page.waitForFunction(() => document.querySelectorAll('#pdfEditorPageStrip .pdf-editor-tile').length === 3); await editorReady();
    await page.locator('#pdfEditorUndo').click();
    await page.waitForFunction(() => document.querySelectorAll('#pdfEditorPageStrip .pdf-editor-tile').length === 2);
    await page.locator('#pdfEditorRedo').click();
    await page.waitForFunction(() => document.querySelectorAll('#pdfEditorPageStrip .pdf-editor-tile').length === 3); await editorReady();
    if (i % 4 === 0) {
      await page.locator('#pdfEditorFileInput').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF broken') });
      await page.waitForFunction(() => !document.querySelector('#pdfEditorProcessMask').classList.contains('visible'));
      assert.equal(await page.locator('#pdfEditorPageStrip .pdf-editor-tile').count(), 3);
    }
    row.editedPdfBytes = await verifyDownload('#pdfEditorExport', 3);
    await page.locator('#pdfEditorSuccessOk').click(); await page.locator('#pdfEditorBack').click(); await settle();
    await page.waitForFunction(() => window.__soakResources.workers.size === 0 && window.__soakResources.urls.size === 0);
    assert.deepEqual(report.errors, []);
    if (i % 5 === 0) {
      await cdp.send('HeapProfiler.collectGarbage'); row.heap = await cdp.send('Runtime.getHeapUsage');
      row.dom = await cdp.send('Memory.getDOMCounters'); baselineHeap ??= row.heap.usedSize;
      baselineDom ??= row.dom;
      assert.ok(row.dom.jsEventListeners <= baselineDom.jsEventListeners + 18, 'closed sessions must not accumulate DOM listeners');
      row.connected = await page.evaluate(() => ({ all: document.querySelectorAll('*').length,
        toasts: document.querySelectorAll('.app-toast').length, hiddenToasts: document.querySelectorAll('.app-toast.hiding').length,
        editorText: document.querySelectorAll('.pdf-editor-text-segment,.pdf-editor-inserted-text').length }));
      baselineConnected ??= row.connected.all;
      assert.ok(row.connected.all <= baselineConnected + 64, 'closed tools must not accumulate mounted DOM nodes');
      if (process.env.TOOLKNIT_SOAK_TRACE === '1') row.detached = await page.evaluate(() => {
        const groups = {};
        for (const event of window.__soakEvents) {
          const node = event.target.deref(); if (!node || node.isConnected) continue;
          const key = `${node.nodeName}.${node.className || node.id || ''}:${event.type}:${event.signal?.deref()?.aborted ?? 'no-signal'}`;
          groups[key] = (groups[key] || 0) + 1;
        }
        return groups;
      });
      assert.ok(row.heap.usedSize - baselineHeap < 32 * 1024 * 1024, 'closed sessions must not accumulate image buffers or PDF models');
    }
    row.elapsedMs = performance.now() - begin; report.cycles.push(row);
    if (i % 5 === 0) {
      await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ completed: i + 1, elapsedMinutes: ((performance.now() - started) / 60000).toFixed(1),
        heapMiB: (row.heap.usedSize / 1048576).toFixed(1), workers: 0, urls: 0 }));
    }
  }
  report.finished = new Date().toISOString();
  if (process.env.TOOLKNIT_SOAK_HEAP === '1') {
    await page.evaluate(() => {}); await cdp.send('HeapProfiler.collectGarbage');
    const stream = createWriteStream(path.join(output, 'closed-session.heapsnapshot'));
    cdp.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }) => stream.write(chunk));
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false }); stream.end(); await once(stream, 'finish');
  }
  console.log(`Soak passed: ${report.cycles.length} complete image-PDF and editable-document cycles, no retained workers/URLs or page errors`);
} catch (error) {
  report.failure = String(error);
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    report.visibleStatus = await activePage.locator('#imagePdfStatus,#imagePdfPreviewStatus,#pdfEditorProcessText').allTextContents().catch(() => []);
  }
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  clearTimeout(watchdog); await browser.close(); await new Promise(resolve => server.httpServer.close(resolve));
}
