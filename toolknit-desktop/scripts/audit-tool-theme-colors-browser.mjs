import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';
import { auditVisibleColors } from './lib/theme-color-audit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve(process.env.TOOLKNIT_THEME_AUDIT_OUTPUT || 'tmp/theme-audit-v32/baseline');
await mkdir(output, { recursive: true });
const server = process.env.TOOLKNIT_THEME_AUDIT_URL ? null : await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, open: false } });
const url = process.env.TOOLKNIT_THEME_AUDIT_URL || server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, executablePath: process.env.TOOLKNIT_TEST_BROWSER });
const requested = process.env.TOOLKNIT_THEME_AUDIT_TOOLS?.split(',');
const tools = Object.entries(LAZY_TOOL_SPECS).filter(([id]) => !requested || requested.includes(id));
const report = { startedAt: new Date().toISOString(), cases: [], errors: [] };
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.fulfill({ body: '{}' }));
    await context.addInitScript(theme => {
      localStorage.setItem('toolknit.theme.v3', theme);
      localStorage.setItem('toolknit-lang', 'zh');
      localStorage.setItem('toolknit.recording-mode.prompt-dismissed.v1', 'true');
      localStorage.setItem('ai_platform', 'custom');
      localStorage.setItem('ai_custom_url', 'https://theme-audit.test/v1/chat/completions');
      localStorage.setItem('ai_custom_model', 'theme-fixture');
      localStorage.setItem('ai_api_key', 'local-theme-test-not-a-real-key');
    }, theme);
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    let activeTool = 'home';
    page.on('pageerror', error => report.errors.push({ theme, tool: activeTool, error: error.message }));
    for (const [id, spec] of tools) {
      activeTool = id;
      const item = { theme, tool: id, states: [] };
      try {
        await page.goto(url);
        await page.locator('#homeToolGrid .tool-result-card').first().waitFor();
        await page.waitForFunction(() => !document.documentElement.dataset.tkStartup);
        await page.locator(`.audio-list-item[data-tool="${id}"]`).first().evaluate(node => node.click());
        await page.locator(`#${spec.overlayId}.visible`).waitFor();
        await page.waitForFunction(id => getComputedStyle(document.getElementById(id)).opacity === '1', spec.overlayId);
        await page.waitForFunction(() => {
          const veil = document.querySelector('[data-tk-page-transition-veil]');
          return !veil || getComputedStyle(veil).visibility === 'hidden';
        });
        await page.evaluate(() => document.fonts.ready);
        for (const position of ['top', 'bottom']) {
          if (position === 'bottom') await page.locator(`#${spec.overlayId}`).evaluate(root => {
            for (const node of root.querySelectorAll('*')) {
              const css = getComputedStyle(node);
              if (node.scrollHeight > node.clientHeight + 20 && /auto|scroll/.test(css.overflowY)) node.scrollTop = node.scrollHeight;
            }
          });
          await page.waitForTimeout(100);
          item.states.push({ position, ...await page.evaluate(auditVisibleColors, `#${spec.overlayId}`) });
          await page.screenshot({ path: path.join(output, `${theme}-${id}-${position}.png`) });
        }
        const count = item.states.reduce((n, state) => n + state.findings.length, 0);
        console.log(`${theme}/${id}: ${count} color candidates`);
      } catch (error) {
        item.error = error.message;
        console.log(`${theme}/${id}: audit unavailable (${error.message.split('\n')[0]})`);
      }
      report.cases.push(item);
      await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    }
    await context.close();
  }
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  if (server) await new Promise(resolve => server.httpServer.close(resolve));
}
