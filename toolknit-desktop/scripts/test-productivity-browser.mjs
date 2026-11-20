import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
const require = createRequire(import.meta.url);
const browserRequire = process.env.TOOLKNIT_TEST_MODULES ? createRequire(path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json')) : require;
const { chromium } = browserRequire('playwright');
const output = path.resolve('tmp/productivity-browser'); await mkdir(output, { recursive: true });
const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await chromium.launch({ headless: true, ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : { channel: 'msedge' }) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errors = []; page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(15000);
const ready = () => page.waitForFunction(() => !document.getElementById('appStartupMask') && !document.querySelector('.app')?.inert);
const settle = () => page.waitForFunction(() => { const veil = document.querySelector('[data-tk-page-transition-veil]'); return (!veil || getComputedStyle(veil).visibility === 'hidden') && !document.getAnimations().some(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity); });
try {
  await page.goto(server.resolvedUrls.local[0]);
  await page.locator('#homeToolGrid [data-home-tool]').first().waitFor();
  await ready();
  const search = page.locator('#homeToolSearch'); await search.fill('批量重命名');
  await page.locator('#homeToolGrid [data-home-tool="batch-rename"]').click();
  const root = page.locator('#productivityOverlay'); await root.waitFor({ state: 'visible' });
  await settle();
  assert.equal(await root.getAttribute('aria-hidden'), 'false');
  assert.equal(await page.locator('.app').evaluate(element => element.inert), true, 'workspace owns keyboard focus');
  await root.locator('[data-rename-input]').setInputFiles([
    { name: '照片1.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('preview') },
    { name: '照片2.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('preview') }
  ]);
  await root.locator('[name="pattern"]').fill('旅行_{n}');
  assert.match(await root.locator('[data-rename-rows]').innerText(), /旅行_001.jpg/);
  assert.equal(await root.locator('[data-action="rename"]').isDisabled(), true, 'browser preview cannot modify real files');
  await root.locator('[name="pattern"]').fill('same');
  assert.match(await root.locator('[data-rename-rows]').innerText(), /Duplicate target/);
  await root.locator('[name="pattern"]').fill('旅行_{n}');
  await page.screenshot({ path: path.join(output, 'rename-desktop.png') });

  await root.locator('[data-productivity-tab="tool-workflows"]').click();
  await root.locator('[name="presetName"]').fill('我的归档');
  await root.locator('[data-action="save-preset"]').click();
  assert.equal(await root.locator('[name="preset"] option').count(), 3);
  const png = await sharp({ create: { width: 200, height: 120, channels: 3, background: '#e7c55a' } }).png().toBuffer();
  await root.locator('[data-flow-input]').setInputFiles([{ name: 'image.png', mimeType: 'image/png', buffer: png }]);
  const imageDownload = page.waitForEvent('download'); await root.locator('[data-action="run-flow"]').click();
  const imageFile = await imageDownload; const imagePath = path.join(output, 'images.pdf'); await imageFile.saveAs(imagePath);
  assert.equal((await PDFDocument.load(await readFile(imagePath))).getPageCount(), 1);
  await root.locator('[data-action="run-flow"]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('[data-action="run-flow"]').disabled);
  await root.locator('[data-action="clear-flow"]').click();
  await root.locator('[name="preset"]').selectOption('merge-pdf');
  const inputs = [];
  for (const [index, width] of [300, 600].entries()) { const doc = await PDFDocument.create(); doc.addPage([width, 400]).drawText(`Source ${index + 1}`); inputs.push({ name: `${index + 1}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) }); }
  await root.locator('[data-flow-input]').setInputFiles(inputs);
  await root.locator('.productivity-file').first().getByRole('button', { name: /下移/ }).click();
  await page.screenshot({ path: path.join(output, 'workflow-desktop.png') });
  const pdfDownload = page.waitForEvent('download'); await root.locator('[data-action="run-flow"]').click();
  const pdfFile = await pdfDownload; const pdfPath = path.join(output, 'merged.pdf'); await pdfFile.saveAs(pdfPath);
  const merged = await PDFDocument.load(await readFile(pdfPath));
  assert.deepEqual(merged.getPages().map(item => item.getWidth()), [600, 300], 'reordering controls affect the real PDF output');
  await root.locator('[data-productivity-tab="task-center"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-state="succeeded"]').length === 2);
  await page.screenshot({ path: path.join(output, 'tasks-desktop.png') });
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const tab of ['batch-rename', 'task-center', 'tool-workflows']) {
      await root.locator(`[data-productivity-tab="${tab}"]`).click();
      const overflow = await root.locator('.productivity-sheet').evaluate(element => element.scrollWidth > element.clientWidth + 2);
      assert.equal(overflow, false, `${tab} has no horizontal overflow at ${width}`);
      await page.screenshot({ path: path.join(output, `${tab}-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { const config = JSON.parse(localStorage.getItem('toolknit.appearance.v1')); localStorage.setItem('toolknit.appearance.v1', JSON.stringify({ ...config, mode: 'dark' })); });
  await page.reload(); await ready();
  await search.fill('批量重命名'); await page.locator('#homeToolGrid [data-home-tool="batch-rename"]').click();
  await root.waitFor({ state: 'visible' }); await settle();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await root.locator('[data-productivity-tab="batch-rename"]').click();
  await page.screenshot({ path: path.join(output, 'rename-dark.png') });
  await page.reload();
  await page.locator('#homeToolGrid [data-home-tool]').first().waitFor();
  await ready();
  await search.fill('任务中心'); await page.locator('#homeToolGrid [data-home-tool="task-center"]').click();
  await root.waitFor({ state: 'visible' });
  assert.equal(await root.locator('[data-state="succeeded"]').count(), 2, 'task history survives reload');
  await root.locator('[data-productivity-tab="tool-workflows"]').click();
  assert.equal(await root.locator('[name="preset"] option').count(), 3, 'custom presets survive reload');
  assert.equal(await root.locator('[data-action="delete-preset"]').isDisabled(), true);
  await page.evaluate(() => localStorage.setItem('toolknit-lang', 'en')); await page.reload();
  await page.locator('#homeToolGrid [data-home-tool]').first().waitFor();
  await ready();
  await search.fill('Batch rename'); await page.locator('#homeToolGrid [data-home-tool="batch-rename"]').click();
  await root.waitFor({ state: 'visible' });
  await settle();
  assert.equal(await root.locator('h1:visible').innerText(), 'Batch rename');
  await page.screenshot({ path: path.join(output, 'rename-english.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('productivityOverlay').inert);
  assert.equal(await page.locator('.app').evaluate(element => element.inert), false, 'closing restores the homepage');
  assert.deepEqual(errors, []);
  console.log(`Productivity browser passed: real image/PDF exports, order, presets, history, English and responsive layouts. Screenshots: ${output}`);
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
  console.error({ errors, search: await page.locator('#homeToolSearch').inputValue(), grid: await page.locator('#homeToolGrid').innerText() });
  throw error;
} finally { await browser.close(); await server.close(); }
