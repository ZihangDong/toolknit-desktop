import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { PDFDocument } from 'pdf-lib';

// Run prepare-image-pdf-matrix and the native format matrix first.
const require = createRequire(import.meta.url), { chromium } = require('playwright');
const root = path.resolve('tmp/v32-pdf-creation/formats');
const inputs = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'))
  .filter(item => item.dpiX).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
const native = JSON.parse(await readFile(path.join(root, 'native-report.json'), 'utf8'));
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, executablePath: process.env.TOOLKNIT_TEST_BROWSER });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin
    ? route.continue() : route.fulfill({ body: '{}', contentType: 'application/json' }));
  await context.addInitScript(() => {
    localStorage.setItem('toolknit.theme.v3', 'light'); localStorage.setItem('toolknit-lang', 'zh');
    localStorage.setItem('toolknit.recording-mode.prompt-dismissed.v1', 'true');
  });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(25000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await page.waitForFunction(() => !document.documentElement.dataset.tkStartup);
  await page.locator('.audio-list-item[data-tool="image-to-pdf"]').evaluate(node => node.click());
  await page.waitForSelector('#imagePdfOverlay.visible');
  await page.waitForFunction(() => !document.querySelector('[data-tk-page-transition-veil]')
    || getComputedStyle(document.querySelector('[data-tk-page-transition-veil]')).visibility === 'hidden');
  await page.locator('#imagePdfInput').setInputFiles(inputs.map(input => path.join(root, input.name)));
  await page.waitForFunction(() => !document.querySelector('#imagePdfExport').disabled);
  await page.locator('[data-image-setting="paper"][data-value="original"]').click();
  assert.deepEqual(await page.locator('#imagePdfPages .image-pdf-page-select span').allTextContents(), inputs.map(input => input.name));
  const download = page.waitForEvent('download'); await page.locator('#imagePdfExport').click();
  const output = path.join(root, 'browser-physical-dimensions.pdf'); await (await download).saveAs(output);
  const doc = await PDFDocument.load(await readFile(output)); assert.equal(doc.getPageCount(), inputs.length);
  const report = [];
  doc.getPages().forEach((pdfPage, index) => {
    const input = inputs[index], frame = native.find(item => item.name === input.name).info.frames[0];
    const size = [pdfPage.getWidth(), pdfPage.getHeight()];
    const expected = [input.width * 72 / input.dpiX, input.height * 72 / input.dpiY];
    const nativeSize = [frame.width * 72 / frame.dpiX, frame.height * 72 / frame.dpiY];
    size.forEach((value, axis) => {
      assert.ok(Math.abs(value - expected[axis]) < .01, `${input.name}: physical size axis ${axis}: ${value} vs ${expected[axis]}`);
      assert.ok(Math.abs(value - nativeSize[axis]) < .0001, `${input.name}: browser/native parity`);
    });
    report.push({ name: input.name, points: size, expected, nativePoints: nativeSize });
  });
  assert.deepEqual(errors, []);
  await writeFile(path.join(root, 'physical-dimensions-report.json'), JSON.stringify(report, null, 2));
  console.log(`Actual browser PDF and native metadata preserve matching physical dimensions for ${inputs.length} PNG/JPEG/WebP/BMP inputs, including rotated asymmetric DPI`);
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
