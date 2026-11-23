import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { preview } from 'vite';
const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES,'package.json') : import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve('tmp/word-watermark-production'); await mkdir(root,{recursive:true});
const server = await preview({configFile:false,preview:{host:'127.0.0.1',port:0,open:false}});
const browser = await chromium.launch({headless:true,channel:'msedge'}), page = await browser.newPage({viewport:{width:1440,height:900}}), errors=[];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => !document.documentElement.dataset.tkStartup && document.querySelector('#homeCustomTools') && !document.querySelector('.app').inert);
  await page.locator('#homeToolSearch').fill('Word'); await page.locator('#homeToolGrid [data-home-tool="word-to-pdf"]').click();
  await page.waitForFunction(() => document.getElementById('wordToPdfOverlay')?.classList.contains('visible'));
  assert.equal(await page.locator('#wordPdfWatermarkEnabled').isChecked(),false);
  await page.locator('#wordPdfWatermarkEnabled').check(); await page.locator('#wordPdfWatermarkText').fill('内部资料 DRAFT');
  await page.locator('#wordPdfWatermarkPreview').click(); await page.waitForFunction(() => !document.getElementById('wordPdfWatermarkCanvas').hidden);
  await page.screenshot({path:path.join(root,'production-text.png')});
  await page.locator('#wordPdfWatermarkType').selectOption('image'); await page.locator('#wordPdfWatermarkImage').setInputFiles('tmp/word-watermark/stamp.png');
  await page.locator('#wordPdfWatermarkPreview').click(); await page.waitForFunction(() => !document.getElementById('wordPdfWatermarkCanvas').hidden);
  await page.screenshot({path:path.join(root,'production-image.png')});
  await page.keyboard.press('Escape'); await page.waitForFunction(() => document.getElementById('wordToPdfOverlay').inert && !document.querySelector('.app').inert);
  assert.deepEqual(errors,[]); await writeFile(path.join(root,'report.json'),JSON.stringify({passed:true,checks:['production home search and lazy Word entry','default off','actual bundled-font PDF preview','actual PNG PDF preview','Escape returns home with reset controls'],errors},null,2));
  console.log('Word watermark production entry passed: real home route, lazy loading, offline fonts/worker, text/image previews and home return.');
} finally { await browser.close(); await server.close(); }
