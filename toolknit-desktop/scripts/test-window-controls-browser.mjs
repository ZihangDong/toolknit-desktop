import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
const report = { checks: [], errors: [], scope: 'Real app DOM with simulated native replies; actual HWND visibility is covered by Rust tests.' };
await mkdir('tmp/window-close-fix', { recursive: true });
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 920 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin
      ? route.continue() : route.fulfill({ body: '[]', contentType: 'application/json' }));
    await context.addInitScript(theme => {
      localStorage.setItem('toolknit.theme.v3', theme);
      localStorage.setItem('toolknit-lang', 'zh');
      let id = 0, resizable = false;
      const callbacks = new Map(), listeners = new Map();
      window.__windowTest = { calls: [], visible: true, fail: false };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_, key) => listeners.delete(key) };
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: fn => { callbacks.set(++id, fn); return id; }, unregisterCallback: key => callbacks.delete(key),
        invoke: async (command, args = {}) => {
          const state = window.__windowTest; state.calls.push(command);
          if (command === 'hide_main_window') {
            if (state.fail) throw Error('window:hide-failed');
            state.visible = false; return;
          }
          if (command === 'plugin:window|hide') throw Error('Unexpected cached hide path');
          if (command === 'plugin:event|listen') { listeners.set(++id, args); return id; }
          if (command === 'plugin:event|unlisten') return;
          if (command === 'plugin:window|set_resizable') { resizable = args.value; return; }
          if (command === 'plugin:window|is_resizable') return resizable;
          if (/plugin:window\|(?:is_maximized|is_fullscreen|is_decorated)/.test(command)) return false;
          if (command === 'plugin:window|current_monitor') return { scaleFactor: 1, size: { width: 1920, height: 1080 }, workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } } };
          if (command === 'plugin:app|version') return '3.2.0';
          if (command === 'get_install_lang') return 'zh';
          if (/get_(?:output_root|default_output_root|documents_dir|download_dir)/.test(command)) return 'C:/TestOutput';
          if (command === 'get_autostart') return { supported: true, enabled: false };
          if (command === 'clipboard_history') return { enabled: false, total: 0, items: [] };
          if (command === 'local_translation') return { ready: false, installing: false, progress: {}, targetLanguage: 'zh-Hans' };
          if (command === 'quick_screenshot') return { history: false, shortcut: 'Alt+Q' };
          if (command.startsWith('list_')) return [];
          if (command.startsWith('is_') || command.startsWith('check_')) return false;
          return null;
        }
      };
    }, theme);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.errors.push(error.message));
    const settle = () => page.waitForFunction(() => {
      const veil = document.querySelector('[data-tk-page-transition-veil]');
      return !veil || getComputedStyle(veil).visibility === 'hidden';
    });
    await page.goto(url);
    await page.waitForSelector('#homeToolGrid .tool-result-card'); await settle();
    const closeAndRestore = async (name, selector, overlay) => {
      for (let iteration = 0; iteration < 3; iteration++) {
        const before = await page.evaluate(() => window.__windowTest.calls.filter(name => name === 'hide_main_window').length);
        await page.locator(selector).click();
        await page.waitForFunction(() => !window.__windowTest.visible);
        assert.equal(await page.evaluate(() => window.__windowTest.calls.filter(name => name === 'hide_main_window').length), before + 1);
        if (overlay) assert.equal(await page.locator(overlay).evaluate(node => node.classList.contains('visible') && !node.inert), true,
          'closing to tray must retain the current page');
        await page.evaluate(() => { window.__windowTest.visible = true; window.dispatchEvent(new Event('focus')); });
        await page.locator(selector).waitFor({ state: 'visible' });
      }
      report.checks.push(`${theme}: ${name}, single click and 3 restore/close cycles`);
    };
    await closeAndRestore('home', '.app > .home-v2-topbar [data-action="close"]');
    await page.locator('#homeV2Settings').click(); await settle();
    await closeAndRestore('settings', '#settingsOverlay [data-action="close"]', '#settingsOverlay');
    await page.locator('#settingsBack').click(); await settle();
    await page.waitForFunction(() => !document.querySelector('#settingsOverlay').classList.contains('visible'));
    await page.locator('[data-tool="pdf-merge"]').first().evaluate(node => node.click());
    await page.waitForSelector('#pdfMergeOverlay.visible'); await settle();
    await closeAndRestore('PDF tool', '#pdfMergeOverlay [data-action="close"]', '#pdfMergeOverlay');
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  await writeFile('tmp/window-close-fix/browser.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close(); await new Promise(resolve => server.httpServer.close(resolve));
}
