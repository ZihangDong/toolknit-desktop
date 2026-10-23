import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const minutes = Math.min(90, Math.max(0, Number(process.env.TOOLKNIT_NAV_SOAK_MINUTES) || 0));
const output = path.resolve(process.env.TOOLKNIT_NAV_SOAK_OUTPUT || 'tmp/navigation-soak');
await mkdir(output, { recursive: true });
const server = await preview({ configFile: false, logLevel: 'error', build: { outDir: process.env.TOOLKNIT_TEST_DIST || 'dist' }, preview: { host: '127.0.0.1', port: 0 } });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, executablePath: process.env.TOOLKNIT_TEST_BROWSER });
const tools = ['pdf-split', 'pdf-merge', 'pdf-rotate', 'pdf-to-image', 'pdf-editor', 'pdf-to-word', 'image-to-pdf',
  'ppt-text', 'ppt-draft', 'markdown-editor', 'clipboard-history', 'duplicate-file-cleanup', 'quick-screenshot',
  'ai-doc', 'ai-table', 'ai-polish', 'json-tools', 'uuid', 'typing-test', 'mortgage-calc'];
const report = { startedAt: new Date().toISOString(), minutes, tools, rounds: [], errors: [] };
let page;
const watchdog = setTimeout(() => { void browser.close(); }, Math.max(15, minutes + 10) * 60000);
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin
    ? route.continue() : route.fulfill({ body: '{}', contentType: 'application/json' }));
  await context.addInitScript(() => {
    localStorage.setItem('toolknit.theme.v3', 'light');
    localStorage.setItem('toolknit-lang', 'zh');
    localStorage.setItem('toolknit.recording-mode.prompt-dismissed.v1', 'true');
    localStorage.setItem('ai_platform', 'custom');
    localStorage.setItem('ai_custom_url', 'https://navigation-fixture.invalid/v1/chat/completions');
    localStorage.setItem('ai_custom_model', 'navigation-fixture');
    localStorage.setItem('ai_api_key', 'local-navigation-test-not-a-key');
    const resources = window.__navResources = { urls: new Set(), workers: new Set() };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = value => { const url = create(value); resources.urls.add(url); return url; };
    URL.revokeObjectURL = url => { resources.urls.delete(url); return revoke(url); };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); resources.workers.add(this); }
      terminate() { resources.workers.delete(this); return super.terminate(); }
    };
  });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  const captureError = error => { if (report.errors.length < 20) report.errors.push(error); };
  page.on('pageerror', error => captureError(error.message));
  page.on('console', message => { if (/Blocked aria-hidden/.test(message.text())) captureError(message.text()); });
  await page.goto(url); await page.waitForFunction(() => !document.documentElement.dataset.tkStartup);
  const cdp = await context.newCDPSession(page);
  const settle = () => page.waitForFunction(() => {
    const veil = document.querySelector('[data-tk-page-transition-veil]');
    return !veil || getComputedStyle(veil).visibility === 'hidden';
  });
  const start = performance.now(); let baseline;
  for (let round = 0; round < 3 || performance.now() - start < minutes * 60000; round++) {
    const row = { round: round + 1, elapsedMinutes: (performance.now() - start) / 60000, navigations: 0 };
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, round % 2 ? 'dark' : 'light');
    for (const id of tools) {
      report.current = { round: round + 1, tool: id };
      assert.ok(LAZY_TOOL_SPECS[id], id);
      const root = '#' + LAZY_TOOL_SPECS[id].overlayId;
      await page.locator(`.audio-list-item[data-tool="${id}"]`).first().evaluate(node => node.click());
      await page.locator(root + '.visible').waitFor(); await settle();
      assert.equal(await page.locator(root).evaluate(node => node.inert), false, `${id}: active tool is interactive`);
      const nav = page.locator(root + ' .tk-tool-nav').first();
      assert.equal(await nav.count(), 1, `${id}: one primary navigation`);
      if (row.navigations % 5 === 0) {
        await nav.locator('.tk-nav-settings').click();
        await page.locator('#settingsOverlay.visible').waitFor(); await settle();
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('#settingsOverlay').classList.contains('visible'));
        await settle();
        assert.equal(await page.locator(root).evaluate(node => node.classList.contains('visible') && !node.inert), true, `${id}: settings returns to the tool`);
      }
      if (round % 2) await page.keyboard.press('Escape');
      else await nav.locator('.tk-nav-back').click();
      await page.waitForFunction(selector => !document.querySelector(selector).classList.contains('visible'), root);
      await settle();
      assert.equal(await page.locator(root).evaluate(node => !node.contains(document.activeElement)), true, `${id}: hidden tool releases focus`);
      row.navigations++;
    }
    await cdp.send('HeapProfiler.collectGarbage');
    const dom = await cdp.send('Memory.getDOMCounters');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const resources = await page.evaluate(() => ({ workers: window.__navResources.workers.size, urls: window.__navResources.urls.size }));
    Object.assign(row, { heapMiB: heap.usedSize / 1048576, ...dom, ...resources });
    assert.equal(row.workers, 0, 'closed tools leave no workers');
    assert.equal(row.urls, 0, 'closed tools leave no object URLs');
    if (round === 2) baseline = { ...row };
    if (baseline) {
      assert.ok(row.heapMiB <= baseline.heapMiB + 24, 'heap stays within a bounded lazy-cache allowance');
      assert.ok(row.nodes <= baseline.nodes + 4000, 'DOM nodes do not accumulate across navigation');
      assert.ok(row.jsEventListeners <= baseline.jsEventListeners + 1500, 'listeners do not accumulate across navigation');
    }
    report.rounds.push(row);
    assert.deepEqual(report.errors, []);
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(row));
  }
  await page.screenshot({ path: path.join(output, 'completed.png') });
  console.log(`Navigation soak passed: ${report.rounds.length * tools.length} tool visits, no page errors or retained workers/URLs.`);
} catch (error) {
  report.failure = String(error);
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  clearTimeout(watchdog);
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
