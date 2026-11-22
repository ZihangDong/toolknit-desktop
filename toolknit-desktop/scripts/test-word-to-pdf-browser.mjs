// Interactive browser regression; the fixture tests injected native transport
// separately from test-word-to-pdf-native.mjs, which executes real Office jobs.
import { createServer } from 'vite';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pdfjsAssets } from './lib/pdfjs-assets.mjs';
await access('tmp/word-pdf-native/single.pdf').catch(() => {
  throw new Error(
    'Run npm run test:word-to-pdf-native first to create the real PDF fixture.',
  );
});
const server = await createServer({
  configFile: false,
  plugins: [pdfjsAssets()],
  server: { host: '127.0.0.1', port: 0, open: false, hmr: false, watch: { ignored: ['**/tmp/**', '**/src-tauri/**', '**/cli/vendor/**', '**/cli/resources/**'] } },
  optimizeDeps: { entries: ['scripts/fixtures/word-to-pdf-browser.html'], include: ['jszip', 'ogl'] },
});
await server.listen();
if (process.argv.includes('--automated')) {
  const directory = path.resolve('tmp/word-pdf-browser-acceptance');
  await mkdir(directory, { recursive: true });
  const report = { checks: [], errors: [], console: [] };
  let browser;
  try {
    const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true, ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : { channel: 'msedge' }) });
    for (const theme of ['light', 'dark']) for (const language of ['zh', 'en']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('console', message => { if (['error', 'warning'].includes(message.type())) report.console.push(message.text()); });
      await page.addInitScript(({ theme, language }) => {
        localStorage.setItem('toolknit.theme.v3', theme);
        localStorage.setItem('toolknit-lang', language);
      }, { theme, language });
      await page.goto(server.resolvedUrls.local[0] + 'scripts/fixtures/word-to-pdf-browser.html');
      await page.waitForSelector('#wordToPdfOverlay.visible');
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      assert.equal(await page.locator('html').evaluate(node => getComputedStyle(node).colorScheme), theme);
      const background = await page.locator('#wordToPdfOverlay').evaluate(node => getComputedStyle(node).backgroundColor);
      assert.equal(background, theme === 'dark' ? 'rgb(20, 21, 24)' : 'rgb(255, 255, 255)', 'fixture applies the actual appearance palette');
      await page.locator('#qa-run').click();
      await page.waitForFunction(() => /^(PASS|FAIL)/.test(document.getElementById('qa-result').textContent), undefined, { timeout: 45000 });
      const result = await page.locator('#qa-result').textContent();
      assert.match(result, /^PASS /, `${theme}/${language}: ${result}`);
      report.checks.push({ theme, language, background, result });
      await page.locator('#qa-demo').click();
      await page.waitForFunction(() => document.getElementById('wordPdfFiles').children.length === 2);
      await page.waitForFunction(() => ['wordPdfProcess', 'wordPdfSuccess'].every(id => {
        const style = getComputedStyle(document.getElementById(id));
        return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0;
      }));
      for (const width of [1440, 1024, 720, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const overflow = await page.locator('#wordToPdfOverlay').evaluate(node => node.scrollWidth > node.clientWidth + 2);
        assert.equal(overflow, false, `Word conversion layout at ${theme}/${language}/${width}`);
        if (width === 390) {
          assert.ok(await page.locator('#wordPdfFiles').evaluate(node => node.clientHeight >= 200), 'narrow queue retains room for archive origins');
          await page.locator('#wordPdfConvert').scrollIntoViewIfNeeded();
          const bounds = await page.locator('#wordPdfConvert').boundingBox();
          assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 900, 'conversion action remains reachable by scrolling');
        }
        await page.screenshot({ path: path.join(directory, `${theme}-${language}-${width}.png`), style: '#qa-controls { display: none !important; }' });
      }
      await page.locator('#wordPdfWatermarkEnabled').check();
      await page.locator('#wordPdfWatermarkText').fill(language === 'zh' ? '内部资料 DRAFT' : 'INTERNAL DRAFT');
      await page.locator('#wordPdfWatermarkPreview').click();
      await page.waitForFunction(() => !document.getElementById('wordPdfWatermarkCanvas').hidden);
      for (const width of [1440, 1024, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator('#wordPdfWatermarkEnabled').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('#wordToPdfOverlay').evaluate(node => node.scrollWidth > node.clientWidth + 2), false, 'expanded watermark layout has no horizontal overflow');
        await page.screenshot({ path: path.join(directory, `watermark-${theme}-${language}-${width}.png`), style: '#qa-controls { display: none !important; }' });
        await page.locator('#wordPdfConvert').scrollIntoViewIfNeeded();
        const bounds = await page.locator('#wordPdfConvert').boundingBox();
        assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 900, 'expanded settings keep conversion reachable');
      }
      await page.locator('#wordPdfEncryptionEnabled').check();
      await page.locator('#wordPdfEncryptionPrinting').selectOption('lowResolution');
      await page.locator('#wordPdfEncryptionCopying').uncheck();
      for (const width of [1440, 1024, 720, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator('#wordPdfEncryptionEnabled').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('#wordToPdfOverlay').evaluate(node => node.scrollWidth > node.clientWidth + 2), false, 'encryption settings have no horizontal overflow');
        await page.screenshot({ path: path.join(directory, `encryption-${theme}-${language}-${width}.png`), style: '#qa-controls { display: none !important; }' });
        await page.locator('#wordPdfConvert').scrollIntoViewIfNeeded();
        const bounds = await page.locator('#wordPdfConvert').boundingBox();
        assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 900, 'conversion stays reachable with both optional settings expanded');
      }
      await page.evaluate(() => window.wordHistoryDemo());
      for (const width of [1440, 1024, 720, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator('#wordPdfHistory').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('#wordToPdfOverlay').evaluate(node => node.scrollWidth > node.clientWidth + 2), false, 'history recovery has no horizontal overflow');
        await page.screenshot({ path: path.join(directory, `history-${theme}-${language}-${width}.png`), style: '#qa-controls { display: none !important; }' });
        await page.locator('#wordPdfConvert').scrollIntoViewIfNeeded();
        const bounds = await page.locator('#wordPdfConvert').boundingBox();
        assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 900, 'history conversion action is reachable');
      }
      await page.close();
    }
    assert.deepEqual(report.errors, []);
    report.passed = true;
    console.log(`Word browser acceptance passed: ${report.checks.length} theme/language runs and 60 layout screenshots.`);
  } catch (error) {
    report.failure = String(error.message || error);
    const page = browser?.contexts().flatMap(context => context.pages())[0];
    if (page) {
      await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
      report.diagnostics = await page.evaluate(() => ({
        editorVisible: document.getElementById('pdfEditorOverlay')?.classList.contains('visible'),
        editorFile: document.getElementById('pdfEditorFileName')?.textContent,
        pageCount: document.querySelectorAll('#pdfEditorPageStrip .pdf-editor-tile').length,
        editorMessage: [...document.querySelectorAll('.toast')].map(node => node.textContent)
      })).catch(() => null);
    }
    throw error;
  } finally {
    await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    await browser?.close();
    await server.close();
  }
} else {
console.log(
  server.resolvedUrls.local[0] + 'scripts/fixtures/word-to-pdf-browser.html',
);
console.log(
  'Open the local page and click Run regression. Check Light/Dark and English/中文. Ctrl+C closes the server.',
);
}
