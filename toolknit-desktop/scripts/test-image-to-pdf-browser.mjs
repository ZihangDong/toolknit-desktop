import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const output = path.resolve('tmp/v32-pdf-creation/images');
await mkdir(output, { recursive: true });
function fixture(name, width, height, color, transparent = false) {
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  if (!transparent) { ctx.fillStyle = color; ctx.fillRect(0, 0, width, height); }
  ctx.fillStyle = transparent ? color : '#ffffff'; ctx.fillRect(width * .25, height * .25, width / 2, height / 2);
  ctx.fillStyle = '#000000'; ctx.font = '30px sans-serif'; ctx.fillText(name, width * .3, height * .48);
  return { name, mimeType: 'image/png', buffer: canvas.toBuffer('image/png') };
}
const fixtures = [fixture('page10.png', 400, 600, '#2040f0'), fixture('page2.png', 600, 400, '#20b030'), fixture('page1.png', 400, 600, '#f02020', true)];
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, executablePath: process.env.TOOLKNIT_TEST_BROWSER });
const errors = [], checks = [];
async function verifyPdf(file, dimensions) {
  const bytes = new Uint8Array(await readFile(file));
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), dimensions.length);
  pdf.getPages().forEach((page, i) => assert.deepEqual([page.getWidth(), page.getHeight()], dimensions[i]));
  const task = getDocument({ data: bytes.slice() }), doc = await task.promise, samples = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i), viewport = page.getViewport({ scale: .8 });
      assert.equal((await page.getTextContent()).items.length, 0, 'image-only output has no invented OCR text');
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height)), ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const point = (x, y) => [...ctx.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data];
      samples.push({ center: point(.3, .3), margin: point(.01, .01), corner: point(.15, .15) });
      await writeFile(file.replace('.pdf', `-page${i}.png`), canvas.toBuffer('image/png'));
      canvas.width = canvas.height = 0;
    }
  } finally { await task.destroy(); }
  return samples;
}
try {
  for (const [theme, lang] of [['light', 'zh'], ['dark', 'en']]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin
      ? route.continue() : route.fulfill({ body: '{}', contentType: 'application/json' }));
    await context.addInitScript(({ theme, lang }) => {
      localStorage.setItem('toolknit.theme.v3', theme); localStorage.setItem('toolknit-lang', lang);
      localStorage.setItem('toolknit.recording-mode.prompt-dismissed.v1', 'true');
    }, { theme, lang });
    const page = await context.newPage(); page.setDefaultTimeout(25000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/Blocked aria-hidden/.test(message.text())) errors.push(message.text()); });
    const settle = () => page.waitForFunction(() => !document.querySelector('[data-tk-page-transition-veil]')
      || getComputedStyle(document.querySelector('[data-tk-page-transition-veil]')).visibility === 'hidden');
    const open = async () => {
      await page.locator('.audio-list-item[data-tool="image-to-pdf"]').evaluate(node => node.click());
      await page.waitForSelector('#imagePdfOverlay.visible'); await settle();
    };
    const ready = async () => {
      await page.waitForFunction(() => !document.querySelector('#imagePdfExport').disabled);
      await page.waitForFunction(() => !document.querySelector('#imagePdfPreview').hidden && document.querySelector('#imagePdfPreview').naturalWidth > 0);
    };
    const setting = async (key, value) => {
      const previous = await page.locator('#imagePdfPreview').getAttribute('src');
      await page.locator(`[data-image-setting="${key}"][data-value="${value}"]`).click();
      await ready(); await page.waitForFunction(src => document.querySelector('#imagePdfPreview').src !== src, previous);
    };
    const exportFile = async name => {
      const download = page.waitForEvent('download');
      await page.locator('#imagePdfExport').click();
      const file = path.join(output, `${theme}-${name}.pdf`); await (await download).saveAs(file);
      await page.locator('#imagePdfSuccess.visible').waitFor();
      assert.equal(await page.locator('#imagePdfOpen').isVisible(), false);
      assert.equal(await page.locator('#imagePdfFolder').isVisible(), false);
      await page.locator('#imagePdfDone').click(); await ready(); return file;
    };
    await page.goto(url); await page.waitForFunction(() => !document.documentElement.dataset.tkStartup);
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    await open();
    for (const [width, height] of [[1440, 900], [1100, 700], [800, 600], [640, 480], [390, 740]]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: path.join(output, `empty-${theme}-${width}.png`) });
      assert.equal(await page.locator('#imagePdfPick').isVisible(), true);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#imagePdfInput').setInputFiles(fixtures); await ready();
    assert.deepEqual(await page.locator('#imagePdfPages .image-pdf-page-select span').allTextContents(), ['page1.png', 'page2.png', 'page10.png']);
    await page.waitForFunction(() => [...document.querySelectorAll('#imagePdfPages img')].every(image => image.naturalWidth > 0));
    await page.screenshot({ path: path.join(output, `loaded-${theme}.png`) });
    let samples = await verifyPdf(await exportFile('a4'), [[595.28, 841.89], [841.89, 595.28], [595.28, 841.89]]);
    assert.ok(samples.every(sample => sample.margin.slice(0, 3).every(value => value > 245)), 'white A4 margins');
    assert.ok(samples[0].corner.slice(0, 3).every(value => value > 245), 'transparent image is flattened onto white');
    assert.ok(samples[1].corner[1] > samples[1].corner[0] + 70, 'natural page order preserves green image');
    assert.ok(samples[2].corner[2] > samples[2].corner[0] + 70, 'natural page order preserves blue image');
    // Keyboard order has the same effect on actual exported pages as pointer sorting.
    await page.locator('.image-pdf-grip').first().focus(); await page.keyboard.press('ArrowDown');
    assert.deepEqual(await page.locator('#imagePdfPages .image-pdf-page-select span').allTextContents(), ['page2.png', 'page1.png', 'page10.png']);
    await setting('paper', 'original');
    assert.equal(await page.locator('[data-image-setting="margin"]').first().isDisabled(), true);
    await page.locator('#imagePdfRotate').click(); await ready();
    samples = await verifyPdf(await exportFile('original-reordered'), [[450, 300], [450, 300], [300, 450]]);
    await setting('mode', 'grayscale');
    samples = await verifyPdf(await exportFile('grayscale'), [[450, 300], [450, 300], [300, 450]]);
    assert.ok(samples.every(({ corner: [r, g, b] }) => Math.max(r, g, b) - Math.min(r, g, b) <= 2), 'true grayscale output');
    await setting('mode', 'natural');
    await exportFile('scanned');
    await page.locator('#imagePdfDelete').click(); await ready();
    assert.equal(await page.locator('[data-image-page]').count(), 2);
    await page.locator('#imagePdfInput').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') });
    await page.waitForFunction(() => !document.querySelector('#imagePdfProcess').classList.contains('visible'));
    assert.equal(await page.locator('#imagePdfExport').isDisabled(), true);
    assert.equal(await page.locator('[data-remove-failure]').count(), 1);
    await page.locator('[data-remove-failure]').click(); await ready();
    await page.locator('#imagePdfInput').setInputFiles(['broken-a.png', 'broken-b.png'].map(name => ({ name, mimeType: 'image/png', buffer: Buffer.from('broken') })));
    await page.waitForSelector('#imagePdfFailureSection:not([hidden])');
    await page.waitForFunction(() => !document.querySelector('#imagePdfProcess').classList.contains('visible'));
    assert.equal(await page.locator('[data-remove-failure]').count(), 2);
    await page.locator('#imagePdfRemoveFailed').click(); await ready();
    assert.equal(await page.locator('[data-image-page]').count(), 2, 'bulk removal preserves valid pages');
    assert.equal(await page.locator('#imagePdfFailureSection').isVisible(), false);
    for (const [width, height] of [[1100, 700], [800, 600], [640, 480], [390, 740]]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: path.join(output, `loaded-${theme}-${width}.png`) });
      const bounds = await page.locator('#imagePdfExport').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height, 'export remains reachable');
      assert.deepEqual(await page.locator('#imagePdfOverlay button').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length
        && node.scrollWidth > node.clientWidth + 2).map(node => node.textContent.trim())), [], 'button labels must not clip at narrow widths');
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#imagePdfClear').click();
    assert.equal(await page.locator('#imagePdfEmpty').isVisible(), true);
    const tiny = createCanvas(8, 8), tinyContext = tiny.getContext('2d');
    tinyContext.fillStyle = '#f02020'; tinyContext.fillRect(0, 0, 8, 8);
    await page.locator('#imagePdfInput').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: tiny.toBuffer('image/png') }); await ready();
    await setting('paper', 'a4'); await setting('mode', 'faithful');
    const tinySamples = await verifyPdf(await exportFile('tiny-a4'), [[595.28, 841.89]]);
    assert.ok(tinySamples[0].margin.slice(0, 3).every(value => value > 245), 'tiny inputs retain real white margins');
    assert.ok(tinySamples[0].center[0] > tinySamples[0].center[1] + 100, 'tiny input remains present on the page');
    await page.locator('#imagePdfClear').click();
    await page.locator('[data-image-pdf-close]').click(); await settle();
    await open(); assert.equal(await page.locator('[data-image-page]').count(), 0);
    await page.keyboard.press('Escape'); await settle();
    checks.push(`${theme}/${lang}: natural sorting, A4 and original size, real image-only PDFs, transparency, rotation, grayscale, scanned effect, error recovery, reset/reopen, responsive layout`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(checks.join('\n'));
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
