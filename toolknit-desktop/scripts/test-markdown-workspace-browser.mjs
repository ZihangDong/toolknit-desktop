import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { createTablePdf } from './fixtures/pdf-table-fixture.mjs';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/markdown-workspace');
await mkdir(output, { recursive: true });
const sample = Buffer.from(await createTablePdf({ continuation: true }));
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await chromium.launch({ headless: true, channel: process.env.TOOLKNIT_TEST_CHANNEL || 'msedge' });
const root = '#markdownEditorOverlay';
const modal = '[data-md-export-success]';
try {
  for (const theme of ['light','dark']) {
    const page = await browser.newPage({ viewport: { width: 1401, height: 920 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error=>errors.push(error.message));
    page.on('console', message=> { if (/Blocked aria-hidden/.test(message.text())) errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    await page.locator('[data-tool="pdf-text-markdown"]').first().evaluate(node=>node.click());
    await page.waitForSelector('#pdfTextExtractOverlay.visible');
    await page.evaluate(value=> { document.documentElement.dataset.theme=value; }, theme);
    await page.locator('#pdfTextExtractFileInput').setInputFiles({ name:'Schedule.pdf', mimeType:'application/pdf', buffer:sample });
    await page.waitForSelector('#pdfTextExtractOverlay[data-state="selected"]');
    await page.locator('#pdfTextExtractProcess').click();
    await page.waitForSelector('#pdfTextExtractOverlay[data-state="success"]');
    await page.locator('#pdfTextExtractImport').click();
    await page.waitForSelector(`${root}.visible`);
    await page.waitForFunction(() => document.querySelectorAll('[data-md-preview] table').length === 2);
    assert.equal(await page.locator('[data-md-preview] table').count(), 2);
    assert.equal(await page.locator('[data-md-preview] table').first().locator('th').count(), 5);
    assert.match(await page.locator('[data-md-preview]').innerText(), /First lesson\ncontinued in the same cell/);
    assert.equal(await page.locator('[data-md-preview] tag, [data-md-preview] math').count(), 0);
    await page.screenshot({ path:path.join(output, `${theme}-split.png`) });
    const before = await page.locator('.md-workbench').boundingBox();
    await page.locator('[data-md-expand]').click();
    await page.waitForTimeout(350);
    const after = await page.locator('.md-workbench').boundingBox();
    assert.ok(after.width>before.width+200);
    assert.equal(await page.locator('.md-outline-panel').evaluate(node=>node.inert), true);
    await page.screenshot({ path:path.join(output, `${theme}-expanded.png`) });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator(`${root}.visible`).count(), 1);
    assert.equal(await page.locator('[data-md-expand]').getAttribute('aria-pressed'), 'false');
    const button=page.locator('[data-md-action="bold"]');
    const background=await button.evaluate(node=>getComputedStyle(node).backgroundColor);
    await button.hover(); await page.waitForTimeout(200);
    assert.equal(await button.evaluate(node=>getComputedStyle(node).backgroundColor), background);
    assert.match(await button.locator('b').evaluate(node=>getComputedStyle(node).transform), /1\.06/);
    for (const format of ['md','html']) {
      const waiting=page.waitForEvent('download');
      await page.locator(`[data-md-export="${format}"]`).click();
      const download=await waiting;
      await page.waitForSelector(`${modal}.visible`);
      assert.equal(await page.locator('.md-tool-shell').evaluate(node=>node.inert), true);
      assert.equal(await page.locator('[data-md-success-ok]').evaluate(node=>node===document.activeElement), true);
      assert.equal(await page.locator('[data-md-success-open-folder]').isVisible(), false);
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('[data-md-success-ok]').evaluate(node=>node===document.activeElement), true);
      const saved=path.join(output, `${theme}.${format}`);
      await download.saveAs(saved);
      const content=await readFile(saved,'utf8');
      assert.match(content, format==='md' ? /\| Date \| Time \| Course/ : /<table>/);
      if (format==='html') {
        assert.match(content, /Content-Security-Policy/);
        assert.doesNotMatch(content, /source-page|<tag>/);
      }
      await page.screenshot({ path:path.join(output, `${theme}-${format}-success.png`) });
      await page.keyboard.press('Escape');
      await page.waitForSelector(`${modal}.visible`, { state:'hidden' });
      assert.equal(await page.locator('.md-tool-shell').evaluate(node=>node.inert), false);
    }
    await page.locator('[data-md-help]').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-md-help-page]').isVisible(), false);
    for (const [width,height] of [[1280,520],[720,820],[390,740]]) {
      await page.setViewportSize({ width,height });
      await page.waitForTimeout(350);
      await page.screenshot({ path:path.join(output, `${theme}-${width}-controls.png`) });
      for (const selector of ['[data-md-export="md"]','[data-md-export="html"]','[data-md-view="preview"]']) {
        const bounds=await page.locator(selector).boundingBox();
        assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width+1 && bounds.y+bounds.height<=height, JSON.stringify({ selector,width,height,bounds }));
      }
      await page.locator('[data-md-view="preview"]').click();
      assert.equal(await page.locator('.md-preview-pane').isVisible(), true);
      assert.equal(await page.locator('.md-input-pane').isVisible(), false);
      await page.screenshot({ path:path.join(output, `${theme}-${width}.png`) });
      await page.locator('[data-md-view="split"]').click();
    }
    await page.keyboard.press('Escape');
    await page.waitForSelector(`${root}.visible`, { state:'hidden' });
    await page.locator('[data-tool="markdown-editor"]').first().evaluate(node=>node.click());
    await page.waitForSelector(`${root}.visible`);
    await page.waitForFunction(() => document.querySelectorAll('[data-md-preview] table').length === 2);
    assert.equal(await page.locator(`${modal}.visible`).count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${theme}: PDF import, tables, symbols, expand, hover, downloads, modal focus/Escape, help, resize, reopen`);
  }
} finally {
  await browser.close();
  await new Promise(resolve=>server.httpServer.close(resolve));
}
