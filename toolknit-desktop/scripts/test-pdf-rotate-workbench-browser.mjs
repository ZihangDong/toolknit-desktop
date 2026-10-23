import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import JSZip from 'jszip';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/pdf-rotate-workbench');
await mkdir(output, { recursive: true });
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
for (let index = 0; index < 24; index++) {
  const p = pdf.addPage([420, 595]);
  p.drawText('PAGE ' + (index + 1) + ' / TOP', { x: 30, y: 530, font, size: 24 });
  p.drawRectangle({ x: 30, y: 80, width: 90, height: 340, color: rgb(.15, .5, .4) });
  if (index === 1) p.setRotation(degrees(90));
}
const fixture = { name: 'rotation-24.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await chromium.launch({ headless: true, ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
const report = { checks: [], errors: [], warnings: [], chrome: [] };
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 887 } });
  const url = server.resolvedUrls.local[0];
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.fulfill({ body: '{}', contentType: 'application/json' }));
  await context.addInitScript(() => {
    if (!localStorage.getItem('toolknit.theme.v3')) localStorage.setItem('toolknit.theme.v3', 'light');
    if (!localStorage.getItem('toolknit-lang')) localStorage.setItem('toolknit-lang', 'zh');
  });
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) report.warnings.push(message.text()); });
  await page.goto(url);
  await page.waitForSelector('#homeToolGrid .tool-result-card');
  await page.evaluate(() => document.querySelector('.audio-list-item[data-tool="pdf-rotate"]').click());
  await page.waitForSelector('#pdfRotateOverlay.visible');
  await page.locator('#pdfRotateInput').setInputFiles(fixture);
  const wb = page.locator('#pdfRotateWorkspace');
  const main = wb.locator('[data-wb-canvas]');
  const parts = ['.tk-nav-back', '.tk-nav-tag', '.tk-nav-web', '.tk-nav-support', '.tk-nav-help', '.tk-nav-feedback', '.tk-nav-settings', '.tk-nav-minimize', '.tk-nav-maximize', '.tk-nav-close'];
  const styles = locator => locator.first().evaluate(n => {
    const read = x => x ? Object.fromEntries(['fontSize', 'fontWeight', 'lineHeight', 'color', 'backgroundColor', 'borderRadius', 'height', 'padding'].map(k => [k, getComputedStyle(x)[k]])) : null;
    return { root: read(n), span: read(n.querySelector('span')), icon: read(n.querySelector('svg')) };
  });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.waitForTimeout(700);
    const baseline = [];
    for (const part of parts) {
      await page.mouse.move(700, 500); await page.waitForTimeout(220);
      const button = page.locator('#pdfRotateOverlay ' + part).first();
      const idle = await styles(button); await button.hover(); await page.waitForTimeout(650);
      baseline.push({ idle, hover: await styles(button) });
    }
    await page.locator('#pdfRotateProcessBtn').click();
    await page.waitForSelector('#pdfRotateWorkspace.visible');
    await page.waitForFunction(() => document.querySelector('#pdfRotateWorkspace [data-wb-canvas]').width > 100);
    for (const [index, part] of parts.entries()) {
      await page.mouse.move(700, 500); await page.waitForTimeout(220);
      const button = wb.locator(part).first(), idle = await styles(button);
      await button.hover(); await page.waitForTimeout(650);
      const actual = { idle, hover: await styles(button) };
      if (JSON.stringify(actual) !== JSON.stringify(baseline[index])) report.chrome.push({ theme, part, baseline: baseline[index], actual });
    }
    await page.locator('#pdfRotateWorkspaceClose').click();
  }
  assert.deepEqual(report.chrome, [], 'navigation matches upload page in both themes');
  report.checks.push('navigation fonts/icons/idle/hover match both themes');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.locator('#pdfRotateProcessBtn').click();
  await page.waitForSelector('#pdfRotateWorkspace.visible');
  await page.waitForFunction(() => document.querySelector('#pdfRotateWorkspace [data-wb-canvas]').width > 100);
  assert.equal(await wb.locator('.pdf-editor-tile').count(), 24);
  assert.ok(await wb.locator('.pdf-editor-tile-canvas').count() < 24);
  assert.ok(await main.evaluate(n => n.getContext('2d').getImageData(0, 0, n.width, n.height).data.some((v, i) => i % 4 === 0 && v < 100)));
  await wb.locator('[data-rotate-turn="90"]').click();
  await page.waitForFunction(() => { const c = document.querySelector('#pdfRotateWorkspace [data-wb-canvas]'); return c.width > c.height; });
  await wb.locator('.pdf-editor-tile').nth(1).click();
  await wb.locator('[data-rotate-turn="90"]').click();
  await page.waitForFunction(() => { const c = document.querySelector('#pdfRotateWorkspace [data-wb-canvas]'); return c.height > c.width; });
  assert.match(await wb.locator('[data-rotate-angle]').textContent(), /90/);
  await wb.locator('.pdf-editor-tile-select').nth(1).click();
  async function download(selector, mode, count, rotations) {
    const wait = page.waitForEvent('download'); await wb.locator(selector).click();
    const result = await wait, bytes = await readFile(await result.path());
    if (mode === 'zip') {
      const files = Object.values((await JSZip.loadAsync(bytes)).files);
      assert.equal(files.length, count);
      for (const entry of files) assert.equal((await PDFDocument.load(await entry.async('uint8array'))).getPageCount(), 1);
    } else {
      const saved = await PDFDocument.load(bytes);
      assert.equal(saved.getPageCount(), count);
      if (rotations) assert.deepEqual(saved.getPages().map(p => p.getRotation().angle), rotations);
    }
    await page.waitForSelector('#pdfRotateSuccessOverlay.visible');
    await page.locator('#pdfRotateSuccessOk').click();
    assert.equal(await wb.evaluate(n => n.inert), false);
  }
  await download('[data-rotate-export="current"]', 'single', 1, [180]);
  await download('#pdfRotateDownloadAllBtn', 'all', 23, [90, ...Array(22).fill(0)]);
  await download('[data-rotate-export="zip"]', 'zip', 23);
  report.checks.push('24 lazy pages; original 90 plus edit 90; unselected current export; 23-page PDF and ZIP');
  await wb.locator('[data-rotate-select]').click();
  await wb.locator('[data-rotate-scope="all"]').click();
  await wb.locator('[data-rotate-turn="-90"]').click();
  await download('#pdfRotateDownloadAllBtn', 'all', 24, [0, 90, ...Array(22).fill(270)]);
  await wb.locator('[data-rotate-turn="reset"]').click();
  await download('#pdfRotateDownloadAllBtn', 'all', 24, [0, 90, ...Array(22).fill(0)]);
  await wb.locator('[data-rotate-select]').click();
  assert.equal(await wb.locator('#pdfRotateDownloadAllBtn').isDisabled(), true);
  assert.equal(await wb.locator('[data-rotate-export="zip"]').isDisabled(), true);
  assert.equal(await wb.locator('[data-rotate-export="current"]').isEnabled(), true);
  await wb.locator('[data-rotate-scope="selected"]').click();
  assert.equal(await wb.locator('[data-rotate-turn="90"]').isDisabled(), true);
  await wb.locator('.pdf-editor-tile-select').nth(0).click();
  await wb.locator('[data-rotate-turn="90"]').click();
  await download('#pdfRotateDownloadAllBtn', 'all', 1, [90]);
  report.checks.push('all/selected scope, reset to source, zero selection disabled');
  await wb.locator('[data-rotate-select]').click();
  await context.route('**/export-worker-*.js', route => route.abort());
  page.once('dialog', dialog => dialog.dismiss());
  await wb.locator('[data-rotate-export="zip"]').click();
  await page.waitForFunction(() => !document.querySelector('#pdfRotateDownloadAllBtn').disabled);
  await context.unroute('**/export-worker-*.js');
  // Failures are expected only for this deliberately unavailable worker.
  report.warnings = report.warnings.filter(s => /export error|ERR_FAILED|Failed to load resource/.test(s) === false);
  let cancelledDownload = false;
  const cancelledListener = () => { cancelledDownload = true; };
  page.on('download', cancelledListener);
  await context.route('**/export-worker-*.js', async route => { await new Promise(r => setTimeout(r, 500)); await route.continue().catch(() => {}); });
  await wb.locator('[data-rotate-export="zip"]').click();
  await page.locator('[data-rotate-cancel]').click();
  await page.waitForTimeout(800);
  page.off('download', cancelledListener);
  await context.unroute('**/export-worker-*.js');
  assert.equal(cancelledDownload, false);
  assert.equal(await wb.locator('#pdfRotateDownloadAllBtn').isEnabled(), true);
  report.checks.push('worker failure recovery, cancellation prevents download');
  for (const toast of await page.locator('.app-toast-close').all()) await toast.click();
  await wb.locator('[data-tool-settings]').click();
  await page.waitForSelector('#settingsOverlay.visible'); await page.locator('#settingsBack').click();
  await page.waitForFunction(() => !document.querySelector('#settingsOverlay').classList.contains('visible'));
  assert.equal(await wb.evaluate(n => n.inert), false);
  const zoomBefore = await wb.locator('[data-wb-zoom="fit"]').textContent();
  await wb.locator('[data-wb-scroll]').hover(); await page.mouse.wheel(0, -240); await page.waitForTimeout(350);
  assert.notEqual(await wb.locator('[data-wb-zoom="fit"]').textContent(), zoomBefore);
  const geometry = [];
  for (let i = 0; i < 10; i++) { geometry.push(await main.boundingBox()); await page.waitForTimeout(60); }
  assert.ok(geometry.every(b => b.width === geometry[0].width && b.height === geometry[0].height), 'zoom settles without oscillation');
  await wb.locator('[data-wb-zoom="fit"]').click();
  await page.waitForTimeout(1500);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const [width, height] of [[1400,887], [1100,700], [900,520], [720,480]]) {
      await page.setViewportSize({ width, height });
      if (width <= 980) {
        const previewBox = await wb.locator('.pdf-editor-preview').boundingBox();
        const panelBox = await wb.locator('.pdf-editor-tool-panel').boundingBox();
        assert.ok(previewBox.y + previewBox.height <= panelBox.y, 'stacked preview must not overlap the operation panel');
      }
      const exportButton = wb.locator('#pdfRotateDownloadAllBtn');
      await exportButton.scrollIntoViewIfNeeded(); await exportButton.hover(); await page.waitForTimeout(250);
      assert.equal(await exportButton.evaluate(n => getComputedStyle(n).color), 'rgb(255, 255, 255)');
      assert.equal(await exportButton.locator('svg').evaluate(n => getComputedStyle(n).color), 'rgb(255, 255, 255)');
      assert.ok(await exportButton.evaluate(n => { const r = n.getBoundingClientRect(); return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); }));
      await page.screenshot({ path: path.join(output, theme + '-' + width + '.png') });
    }
  }
  report.checks.push('settings return, wheel zoom, stable geometry, both themes/four sizes/export hover');
  await page.setViewportSize({ width: 1400, height: 887 });
  await page.evaluate(() => { localStorage.setItem('toolknit-lang', 'en'); });
  await page.reload(); await page.waitForSelector('#homeToolGrid .tool-result-card');
  await page.evaluate(() => document.querySelector('.audio-list-item[data-tool="pdf-rotate"]').click());
  await page.waitForSelector('#pdfRotateOverlay.visible');
  await page.locator('#pdfRotateInput').setInputFiles(fixture); await page.locator('#pdfRotateProcessBtn').click();
  await page.waitForSelector('#pdfRotateWorkspace.visible');
  assert.match(await wb.locator('[data-rotate-turn="reset"]').textContent(), /Reset orientation/);
  await page.locator('#pdfRotateWorkspaceClose').focus(); await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#pdfRotateWorkspace').classList.contains('visible'));
  assert.equal(await wb.locator('canvas').count(), 1);
  assert.equal(await main.evaluate(n => n.width), 0);
  assert.equal(await wb.evaluate(n => n.contains(document.activeElement)), false);
  await page.locator('#pdfRotateProcessBtn').click(); await page.waitForSelector('#pdfRotateWorkspace.visible');
  assert.match(await wb.locator('[data-rotate-angle]').textContent(), /0/);
  report.checks.push('English, Escape, canvas release, reopen resets rotations');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close(); await new Promise(resolve => server.httpServer.close(resolve));
}
console.log(JSON.stringify(report));
