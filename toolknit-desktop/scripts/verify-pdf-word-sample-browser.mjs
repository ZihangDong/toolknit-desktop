import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw Error('Usage: verify-pdf-word-sample-browser.mjs input.pdf output.docx');
const pageRange = process.argv.slice(4).find(argument => argument.startsWith('--pages='))?.slice(8) || '';
const diagnostics = process.argv.includes('--diagnostics');
assert(pageRange.length <= 1000);
let exists = false; try { await access(destination); exists = true; } catch {}
if (exists) throw Error('Output already exists; choose a new filename.');
const bytes = await readFile(source);
assert(bytes.length > 0 && bytes.length <= 64 * 1024 * 1024);
const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, open: false } });
const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
let browser;
const errors = [], externalPosts = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 920 }, acceptDownloads: true });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL(url).origin) return route.continue();
    if (route.request().method() === 'POST') externalPosts.push(new URL(route.request().url()).origin);
    return route.fulfill({ body: '{}', contentType: 'application/json' });
  });
  await context.addInitScript(captureDiagnostics => {
    localStorage.setItem('toolknit.theme.v3', 'light'); localStorage.setItem('toolknit-lang', 'en');
    const NativeWorker = window.Worker;
    if (captureDiagnostics) window.__pdfWordSampleSnapshots = [];
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args); this.finishRequests = new Set();
        this.addEventListener('message', event => {
          if (this.finishRequests.delete(event.data.id) && event.data.result?.quality) window.__pdfWordSampleQuality = event.data.result.quality;
        });
      }
      postMessage(data, ...args) {
        if (data?.type === 'finish') this.finishRequests.add(data.id);
        if (captureDiagnostics && data?.type === 'scene') window.__pdfWordSampleSnapshots.push(structuredClone(data.snapshot));
        return super.postMessage(data, ...args);
      }
    };
  }, diagnostics);
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('[data-tool="pdf-to-word"]').first().evaluate(node => node.click());
  await page.waitForSelector('#pdfWordOverlay.visible');
  await page.waitForFunction(() => !document.querySelector('[data-tk-page-transition-veil]') || getComputedStyle(document.querySelector('[data-tk-page-transition-veil]')).visibility === 'hidden');
  await page.locator('#pdfWordFileInput').setInputFiles({ name: 'benchmark.pdf', mimeType: 'application/pdf', buffer: bytes });
  await page.waitForFunction(() => !document.querySelector('#pdfWordAnalyze').disabled);
  await page.locator('#pdfWordLocal').click();
  if (pageRange) await page.locator('#pdfWordRange').fill(pageRange);
  if (process.argv.includes('--continuous')) await page.locator('#pdfWordFlow').click();
  const started = performance.now(); await page.locator('#pdfWordAnalyze').click();
  await page.waitForFunction(() => !document.querySelector('#pdfWordAnalyze').disabled
    && (!document.querySelector('#pdfWordReview').hidden || document.querySelector('#pdfWordStatus').classList.contains('is-error')), null, { timeout: 120000 });
  assert(!await page.locator('#pdfWordStatus').evaluate(node => node.classList.contains('is-error')), await page.locator('#pdfWordStatus').innerText());
  if (await page.locator('#pdfWordFallbackLabel').isVisible()) await page.locator('#pdfWordFallback').check();
  const download = page.waitForEvent('download', { timeout: 120000 }); await page.locator('#pdfWordExport').click();
  const exported = await Promise.race([download,
    page.waitForFunction(() => document.querySelector('#pdfWordStatus').classList.contains('is-error'), null, { timeout: 120000 })
      .then(async () => { throw Error(await page.locator('#pdfWordStatus').innerText()); })]);
  await exported.saveAs(destination);
  if (diagnostics) await writeFile(`${destination}.snapshots.json`, await page.evaluate(() => JSON.stringify(window.__pdfWordSampleSnapshots,
    (_, value) => ArrayBuffer.isView(value) ? { numericArrayType: value.constructor.name, values: Array.from(value) } : value)), { flag: 'wx' });
  assert.deepEqual(errors, []); assert.deepEqual(externalPosts, []);
  const metrics = { milliseconds: Math.round(performance.now() - started), bytes: (await readFile(destination)).length, pageRange,
    quality: await page.evaluate(() => window.__pdfWordSampleQuality), errors, externalPosts };
  assert(metrics.quality);
  await writeFile(`${destination}.metrics.json`, JSON.stringify(metrics, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ milliseconds: metrics.milliseconds, bytes: metrics.bytes,
    quality: await page.locator('#pdfWordQuality').innerText(), errors, externalPosts }, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
