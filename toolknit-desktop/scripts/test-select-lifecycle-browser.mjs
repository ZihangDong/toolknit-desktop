import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';

const { chromium } = createRequire(import.meta.url)('playwright');
const server = process.env.TOOLKNIT_TEST_URL ? null : await createServer({ configFile: false, logLevel: 'error',
  optimizeDeps: { noDiscovery: true, entries: [] }, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
if (server) await server.listen();
const url = process.env.TOOLKNIT_TEST_URL || server.resolvedUrls.local[0];
const output = path.resolve('tmp/theme-audit-v32/select-lifecycle');
await mkdir(output, { recursive: true });
const css = await readFile('src/styles/components/tool-custom-select.css', 'utf8');
let browser;
const report = { rounds: [], errors: [] };
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.TOOLKNIT_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 600, height: 480 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.route('**/__select-theme-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>${css}
    body { margin: 30px; font: 14px sans-serif; } form { width: min(270px,100%); display:grid; gap:15px; }
    html[data-theme=dark] { background:#18181a;color:white; } label { display:grid;gap:8px; }
    </style></head><body><form><input id="before" aria-label="Before"><label>Mode<select id="sample"><option value="a">Alpha</option><option value="b">Beta</option><option value="c" disabled>Unavailable</option></select></label><input id="after" aria-label="After"></form></body></html>` }));
  await page.goto(new URL('__select-theme-fixture', url).href);
  await page.evaluate(async moduleUrl => {
    const { enhanceToolSelect } = await import(moduleUrl);
    const nativeAdd = EventTarget.prototype.addEventListener;
    const globalListeners = new Set();
    const NativeObserver = MutationObserver;
    const observers = new Set();
    window.MutationObserver = class extends NativeObserver {
      // Playwright also observes the document while resolving locators.
      observe(target, ...args) { if (target.id === 'sample') observers.add(this); return super.observe(target, ...args); }
      disconnect() { observers.delete(this); return super.disconnect(); }
    };
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if ((this === document || this === window) && options?.signal) {
        const registration = { type, listener };
        globalListeners.add(registration);
        nativeAdd.call(options.signal, 'abort', () => globalListeners.delete(registration), { once: true });
      }
      return nativeAdd.call(this, type, listener, options);
    };
    const select = document.getElementById('sample');
    let handle;
    window.selectFixture = {
      mount() { handle = enhanceToolSelect(select); },
      dispose() { handle.dispose(); },
      refresh() { handle.refresh(); },
      count() { return { listeners: globalListeners.size, observers: observers.size }; }
    };
  }, new URL(`src/tool-custom-select.js?theme-lifecycle=${Date.now()}`, url).href);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [600, 420, 320]) {
      await page.setViewportSize({ width, height: 480 });
      for (let iteration = 0; iteration < 8; iteration++) {
        await page.evaluate(() => { const select = document.getElementById('sample'); select.value = 'a'; window.selectFixture.mount(); });
        assert.equal(await page.locator('.tool-custom-select').count(), 1);
        assert.equal(await page.locator('.tool-custom-select-menu').count(), 1);
        await page.locator('#before').focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('.tool-custom-select-trigger').evaluate(n => n === document.activeElement), true);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('End');
        assert.equal(await page.locator('[data-tool-select-value="b"]').evaluate(n => n === document.activeElement), true, 'disabled choices are skipped');
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#sample').inputValue(), 'b');
        await page.locator('.tool-custom-select-trigger').click();
        await page.evaluate(() => { document.getElementById('sample').disabled = true; });
        await page.waitForFunction(() => document.querySelector('.tool-custom-select-trigger').disabled);
        assert.equal(await page.locator('.tool-custom-select-menu:not([hidden])').count(), 0);
        const updated = `Updated Beta ${theme} ${width} ${iteration}`;
        await page.evaluate(label => { document.getElementById('sample').disabled = false; document.getElementById('sample').options[1].textContent = label; }, updated);
        await page.waitForFunction(label => document.querySelector('.tool-custom-select-label').textContent === label, updated);
        await page.locator('.tool-custom-select-trigger').press('ArrowDown');
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('#after').evaluate(n => n === document.activeElement), true);
        await page.locator('.tool-custom-select-trigger').click();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.tool-custom-select-trigger').getAttribute('aria-expanded'), 'false');
        await page.evaluate(() => { window.selectFixture.dispose(); window.selectFixture.dispose(); });
        assert.equal(await page.locator('.tool-custom-select-menu,.tool-custom-select').count(), 0);
        assert.equal(await page.locator('#sample').getAttribute('tabindex'), null);
        assert.equal(await page.locator('#sample').getAttribute('aria-hidden'), null);
        assert.deepEqual(await page.evaluate(() => window.selectFixture.count()), { listeners: 0, observers: 0 }, 'global listeners and option observers are released');
        report.rounds.push({ theme, width, iteration });
      }
    }
  }
  assert.deepEqual(report.errors, []);
  console.log(`Shared selects: ${report.rounds.length} mount/select/disable/mutate/Tab/Escape/dispose rounds, no retained global listeners`);
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  if (server) await server.close();
}
