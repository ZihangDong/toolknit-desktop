import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import { preview, createServer } from 'vite';
import { checkUpdateDialogTheme } from './lib/update-dialog-theme-browser.mjs';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0 } });
const browser = await chromium.launch({ headless: true,
  ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
try {
  console.log(await checkUpdateDialogTheme(browser, server.resolvedUrls.local[0], path.resolve('tmp/update-dialog-browser')));
  const dev = await createServer({ configFile: false, cacheDir: 'tmp/update-dialog-vite-cache',
    optimizeDeps: { entries: [] },
    server: { host: '127.0.0.1', port: 0, hmr: false,
      watch: { ignored: ['**/tmp/**', '**/src-tauri/**', '**/cli/vendor/**', '**/cli/resources/**'] } } });
  try {
    await dev.listen();
    const page = await browser.newPage();
    page.on('pageerror', error => console.error('Update harness page error:', error.message));
    page.on('requestfailed', request => console.error('Update harness request failed:', request.url(), request.failure()?.errorText));
    await page.route('**/__update-dialog-harness.html', route => route.fulfill({ contentType: 'text/html',
      body: '<html data-tk-auxiliary><body><button id="origin">Origin</button></body></html>' }));
    await page.goto(new URL('/__update-dialog-harness.html', dev.resolvedUrls.local[0]).href);
    let timer;
    const result = await Promise.race([new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Update controller browser test exceeded 30 seconds')), 30_000);
    }), page.evaluate(async () => {
      const { default: markup } = await import('/src/app/templates/update-dialog.html?raw');
      const { initUpdateDialog } = await import('/src/update-dialog.js');
      const { applyTranslations, setLangWithoutFade, t } = await import('/src/i18n.js');
      document.body.insertAdjacentHTML('beforeend', markup);
      applyTranslations();
      const dialog = document.querySelector('#updateDialog');
      const button = dialog.querySelector('[data-update-download]');
      const closeButton = dialog.querySelector('[data-update-close]');
      const origin = document.querySelector('#origin');
      const urls = [];
      let mode = 'false';
      let finish;
      const controller = initUpdateDialog({ openExternalUrl: async url => {
        urls.push(url);
        if (mode === 'throw') throw Error('Unable to launch browser');
        if (mode === 'pending') return new Promise(resolve => { finish = resolve; });
        return mode === 'true';
      } });
      const check = (value, message) => { if (!value) throw Error(message); };
      const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
      check(!controller.open({ version: '3.1.0', currentVersion: '3.1.0' }), 'Current version must not lock');
      check(!controller.open({ version: '4.0.0-rc.1', currentVersion: '3.1.0' }), 'Prerelease must not lock');
      origin.focus();
      check(controller.open({ version: '4.0.0', currentVersion: '3.1.0' }), 'Valid update opens');
      button.click(); await settle();
      check(dialog.querySelector('[data-error="true"]') && !button.disabled && dialog.open, 'False opener visibly fails and allows retry');
      mode = 'throw'; button.click(); await settle();
      check(dialog.querySelector('[data-error="true"]') && !button.disabled && dialog.open, 'Thrown opener visibly fails and allows retry');
      mode = 'true'; button.click(); await settle();
      check(dialog.querySelector('.update-dialog-status').textContent === t('updateDialog.opened') && dialog.open, 'Successful retry keeps the prompt visible');
      setLangWithoutFade('en');
      check(dialog.querySelector('h2').textContent === t('updateDialog.title'), 'Open modal title follows language');
      check(dialog.querySelector('.update-dialog-status').textContent === t('updateDialog.opened'), 'Open modal status follows language');
      check(closeButton.getAttribute('aria-label') === t('common.close'), 'Close label follows language');
      closeButton.click();
      check(!dialog.open && !document.body.classList.contains('update-dialog-open') && dialog.inert, 'Close releases the modal and page lock');
      check(document.activeElement === origin, 'Close restores focus for continued use');
      check(controller.open({ version: '4.0.0', currentVersion: '3.1.0' }), 'Manual check can reopen a dismissed update');
      check(!controller.open({ version: '3.9.0', currentVersion: '3.1.0' }), 'Older result cannot downgrade modal');
      mode = 'pending'; button.click(); button.click();
      check(urls.length === 4 && button.disabled, 'Repeated clicks share opening');
      closeButton.click();
      check(!dialog.open && document.activeElement === origin, 'Close remains usable while the download page is opening');
      finish(true); await settle();
      check(!dialog.open && document.activeElement === origin, 'Late download response cannot reopen or steal focus');
      controller.open({ version: '4.0.0', currentVersion: '3.1.0' });
      mode = 'pending'; button.click();
      controller.dispose(); controller.dispose();
      finish(true); await settle();
      check(!dialog.open && !document.body.classList.contains('update-dialog-open'), 'Dispose removes modal lock');
      check(document.activeElement === origin, 'Dispose restores focus');
      const prior = dialog.querySelector('.update-dialog-status').textContent;
      setLangWithoutFade('zh');
      check(dialog.querySelector('.update-dialog-status').textContent === prior, 'Disposed callback cannot render');
      check(!controller.open({ version: '5.0.0', currentVersion: '3.1.0' }), 'Disposed controller cannot reopen');
      button.click(); await settle();
      check(urls.length === 5, 'Dispose removes download listener');
      return urls;
    })]).finally(() => clearTimeout(timer));
    assert.deepEqual(result, Array(5).fill('https://toolknit.com/exe.html'));
    console.log('Update controller passed: close/reopen, pending download dismissal, opener false/error/retry, repeated click, live language, stale version, late response, disposal and focus recovery.');
    await page.close();
  } finally { await dev.close(); }
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
