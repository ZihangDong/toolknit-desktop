import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const output = path.resolve('tmp/v32-pdf-creation/stress'); await mkdir(output, { recursive: true });
const canvas = createCanvas(1200, 1600), ctx = canvas.getContext('2d');
ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1200, 1600); ctx.fillStyle = '#171717'; ctx.font = '28px sans-serif';
for (let y = 80; y < 1500; y += 48) ctx.fillText(`ToolKnit image PDF stress sample, row ${y}`, 70, y);
ctx.strokeStyle = '#246b45'; ctx.lineWidth = 3; ctx.strokeRect(60, 60, 1080, 1470);
const imageBytes = canvas.toBuffer('image/png');
const inputs = Array.from({ length: 100 }, (_, index) => ({ name: `page-${index + 1}.png`, mimeType: 'image/png', buffer: imageBytes }));
async function documentFixture(count) {
  const pdf = await PDFDocument.create();
  for (let i = 1; i <= count; i++) pdf.addPage([595.28, 841.89]).drawText(`Synthetic page ${i}`, { x: 50, y: 740, size: 18 });
  return { name: `pages-${count}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
}
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, executablePath: process.env.TOOLKNIT_TEST_BROWSER });
const report = { errors: [], samples: [], timings: {} };
const watchdog = setTimeout(() => { void browser.close(); }, 300000);
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin
    ? route.continue() : route.fulfill({ body: '{}', contentType: 'application/json' }));
  await context.addInitScript(() => {
    localStorage.setItem('toolknit.theme.v3', 'light'); localStorage.setItem('toolknit-lang', 'zh');
    localStorage.setItem('toolknit.recording-mode.prompt-dismissed.v1', 'true');
    const resources = window.__pdfResources = { urls: new Map(), workers: new Set(), longTasks: [] };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); resources.urls.set(url, blob.size); return url; };
    URL.revokeObjectURL = url => { resources.urls.delete(url); revoke(url); };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); resources.workers.add(this); }
      terminate() { resources.workers.delete(this); return super.terminate(); }
    };
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) resources.longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
  });
  const page = await context.newPage(); page.setDefaultTimeout(45000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (/Blocked aria-hidden/.test(message.text())) report.errors.push(message.text()); });
  const cdp = await context.newCDPSession(page);
  const settle = () => page.waitForFunction(() => !document.querySelector('[data-tk-page-transition-veil]')
    || getComputedStyle(document.querySelector('[data-tk-page-transition-veil]')).visibility === 'hidden');
  const open = async (tool, overlay) => {
    await page.locator(`.audio-list-item[data-tool="${tool}"]`).evaluate(node => node.click());
    await page.waitForSelector(`#${overlay}.visible`); await settle();
  };
  const imageReady = async () => {
    await page.waitForFunction(() => !document.querySelector('#imagePdfExport').disabled);
    await page.waitForFunction(() => !document.querySelector('#imagePdfPreview').hidden && document.querySelector('#imagePdfPreview').naturalWidth > 0);
  };
  const resources = () => page.evaluate(() => ({ urls: window.__pdfResources.urls.size,
    bytes: [...window.__pdfResources.urls.values()].reduce((a, b) => a + b, 0), workers: window.__pdfResources.workers.size }));
  await page.goto(url); await page.waitForFunction(() => !document.documentElement.dataset.tkStartup);
  await open('image-to-pdf', 'imagePdfOverlay');
  const start = performance.now();
  await page.locator('#imagePdfInput').setInputFiles(inputs); await imageReady();
  report.timings.import100Ms = performance.now() - start;
  assert.equal(await page.locator('[data-image-page]').count(), 100);
  assert.ok(await page.locator('#imagePdfPages img').evaluateAll(images => images.filter(image => image.naturalWidth > 0).length) < 20,
    '100 inputs should not eagerly decode every thumbnail');
  await page.locator('#imagePdfInput').setInputFiles(inputs.slice(0, 1));
  assert.equal(await page.locator('[data-image-page]').count(), 100);
  assert.equal(await page.locator('#imagePdfStatus').evaluate(node => node.classList.contains('is-error')), true);
  await page.locator('[data-image-setting="quality"][data-value="clear"]').click(); await imageReady();
  await page.locator('#imagePdfExport').click();
  await page.locator('#imagePdfProcess.visible').waitFor(); await page.locator('#imagePdfCancel').click();
  await page.waitForFunction(() => !document.querySelector('#imagePdfProcess').classList.contains('visible'));
  assert.equal(await page.locator('[data-image-page]').count(), 100); await imageReady();
  const beforeExport = await page.evaluate(() => performance.now());
  const exportStarted = performance.now(), download = page.waitForEvent('download', { timeout: 180000 });
  await page.locator('#imagePdfExport').click();
  const file = path.join(output, '100-pages-high-quality.pdf'); await (await download).saveAs(file);
  report.timings.export100HighMs = performance.now() - exportStarted;
  const pdf = await PDFDocument.load(await readFile(file)); assert.equal(pdf.getPageCount(), 100);
  report.exportLongTasks = await page.evaluate(start => window.__pdfResources.longTasks.filter(task => task.start >= start), beforeExport);
  await page.locator('#imagePdfDone').click();
  await page.screenshot({ path: path.join(output, '100-pages.png') });
  await page.locator('[data-image-pdf-close]').click(); await settle();
  await page.waitForFunction(() => window.__pdfResources.workers.size === 0);
  const baseResources = await resources();
  await cdp.send('HeapProfiler.collectGarbage');
  const baseHeap = await cdp.send('Runtime.getHeapUsage');
  for (let iteration = 0; iteration < 20; iteration++) {
    await open('image-to-pdf', 'imagePdfOverlay');
    await page.locator('#imagePdfInput').setInputFiles(inputs.slice(0, 3)); await imageReady();
    // Closing while a replacement preview is underway exercises stale decoding.
    await page.locator('[data-image-setting="mode"][data-value="natural"]').click();
    await page.locator('[data-image-pdf-close]').click(); await settle();
    await page.waitForFunction(() => window.__pdfResources.workers.size === 0);
    if ((iteration + 1) % 5 === 0) {
      await cdp.send('HeapProfiler.collectGarbage');
      report.samples.push({ iteration: iteration + 1, resources: await resources(), heap: await cdp.send('Runtime.getHeapUsage') });
    }
  }
  for (const sample of report.samples) {
    assert.equal(sample.resources.urls, baseResources.urls, 'closing releases every session URL');
    assert.equal(sample.resources.workers, 0);
  }
  assert.ok(report.samples.at(-1).heap.usedSize - baseHeap.usedSize < 20 * 1024 * 1024, 'reopening must not retain full image buffers in the main heap');
  await open('pdf-editor', 'pdfEditorOverlay');
  const fixture500 = await documentFixture(500);
  const loadStarted = performance.now(); await page.locator('#pdfEditorFileInput').setInputFiles(fixture500);
  await page.waitForFunction(() => document.querySelectorAll('#pdfEditorPageStrip .pdf-editor-tile').length === 500 && !document.querySelector('#pdfEditorExport').disabled);
  report.timings.editor500LoadMs = performance.now() - loadStarted;
  assert.equal(await page.locator('#pdfEditorBlankPage').isDisabled(), true);
  assert.equal(await page.locator('#pdfEditorDuplicate').isDisabled(), true);
  for (const index of [499, 250, 0]) {
    const tile = page.locator('#pdfEditorPageStrip .pdf-editor-tile').nth(index);
    await tile.scrollIntoViewIfNeeded(); await tile.click();
    await page.waitForFunction(() => document.querySelector('.pdf-editor-main-canvas')?.width > 100);
  }
  report.editorLiveThumbnailCanvases = await page.locator('#pdfEditorPageStrip canvas').evaluateAll(nodes => nodes.filter(node => node.width > 1 && node.height > 1).length);
  assert.ok(report.editorLiveThumbnailCanvases < 100, '500-page editor uses bounded thumbnail canvases');
  await page.locator('#pdfEditorFileInput').setInputFiles(await documentFixture(501));
  await page.waitForFunction(() => !document.querySelector('#pdfEditorProcessMask').classList.contains('visible'));
  assert.equal(await page.locator('#pdfEditorPageStrip .pdf-editor-tile').count(), 500, 'failed replacement retains the existing document');
  const editorDownload = page.waitForEvent('download', { timeout: 90000 }); await page.locator('#pdfEditorExport').click();
  const editorFile = path.join(output, '500-pages-editor.pdf'); await (await editorDownload).saveAs(editorFile);
  assert.equal((await PDFDocument.load(await readFile(editorFile))).getPageCount(), 500);
  await page.locator('#pdfEditorSuccessOk').click(); await page.locator('#pdfEditorBack').click(); await settle();
  await page.waitForFunction(() => window.__pdfResources.workers.size === 0);
  assert.deepEqual(report.errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ timings: report.timings, reopened: 20, liveThumbnails: report.editorLiveThumbnailCanvases,
    remainingResources: await resources(), exportLongTasks: report.exportLongTasks.length }, null, 2));
} finally { clearTimeout(watchdog); await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
