import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { preview } from 'vite';

const { chromium } = createRequire(import.meta.url)('playwright');
const output = 'tmp/shared-input-focus'; await mkdir(output, { recursive: true });
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, executablePath: process.env.TOOLKNIT_TEST_BROWSER });
const report = { fields: [], errors: [], empty: [] };
try {
  for (const [theme, language] of [['light', 'zh'], ['dark', 'en']]) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 760 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.fulfill({ body: '{}' }));
    await context.addInitScript(({ theme, language }) => {
      localStorage.setItem('toolknit.theme.v3', theme); localStorage.setItem('toolknit-lang', language);
      localStorage.setItem('toolknit.recording-mode.prompt-dismissed.v1', 'true');
    }, { theme, language });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(url); await page.locator('#homeToolGrid .tool-result-card').first().waitFor();
    await page.waitForFunction(() => !document.documentElement.dataset.tkStartup);
    const tools = await page.locator('.audio-list-item[data-tool]').evaluateAll(nodes => [...new Set(nodes.map(n => n.dataset.tool))]);
    for (const tool of ['home', ...tools]) {
      if (tool !== 'home') {
        await page.goto(url); await page.locator('#homeToolGrid .tool-result-card').first().waitFor();
        await page.waitForFunction(() => !document.documentElement.dataset.tkStartup);
        await page.locator(`.audio-list-item[data-tool="${tool}"]`).first().evaluate(el => el.click());
        await page.waitForTimeout(300);
        await page.waitForFunction(() => !document.querySelector('[data-tk-page-transition-veil]') || getComputedStyle(document.querySelector('[data-tk-page-transition-veil]')).visibility === 'hidden');
      }
      const results = await page.evaluate(async () => {
        const types = new Set(['text', 'search', 'password', 'email', 'url', 'tel', 'number', 'date', 'time', 'datetime-local', 'month', 'week', 'textarea']);
        const fields = [...document.querySelectorAll('input,textarea')].filter(el => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return types.has(el.type) && !el.disabled && !el.closest('[inert]') && r.width > 30 && r.height > 12 && (hit === el || el.contains(hit));
        });
        const out = [];
        for (const el of fields.slice(0, 20)) {
          const before = el.getBoundingClientRect(); el.focus({ preventScroll: true });
          if (document.activeElement !== el) continue;
          await new Promise(resolve => setTimeout(resolve, 240));
          const after = el.getBoundingClientRect(), css = getComputedStyle(el);
          const shell = el.closest('.home-search-field,.clipboard-search,.shot-history-search,.image-stitch-number-field,.color-space-compare-hex-row,.color-space-compare-value-group,.ai-doc-style-number');
          const surface = getComputedStyle(shell || el);
          out.push({ id: el.id || el.className, outline: css.outlineStyle, shadow: css.boxShadow,
            shellShadow: surface.boxShadow, shellOutline: surface.outlineStyle,
            fill: surface.getPropertyValue('--tk-field-fill').trim(), height: surface.getPropertyValue('--tk-field-height').trim(),
            movement: Math.max(Math.abs(before.width - after.width), Math.abs(before.height - after.height)) });
        }
        return out;
      });
      if (!results.length) report.empty.push({ theme, tool });
      for (const result of results) {
        const label = `${theme}/${tool}/${result.id}`;
        assert.equal(result.outline, 'none', label); assert.equal(result.shadow, 'none', label);
        assert.equal(result.shellShadow, 'none', label); assert.equal(result.shellOutline, 'none', label);
        assert.equal(result.fill, '100%', label); assert.equal(result.height, '3px', label);
        assert.ok(result.movement < 1, label); report.fields.push({ theme, tool, ...result });
      }
      if (results.length) console.log(`${theme}/${tool}: ${results.length} visible inputs passed`);
    }
    await page.goto(url); await page.locator('#homeToolGrid .tool-result-card').first().waitFor();
    await page.waitForFunction(() => !document.documentElement.dataset.tkStartup);
    const search = page.locator('.home-search-field input');
    await search.focus(); await page.waitForTimeout(300);
    await page.screenshot({ path: `${output}/${theme}-home.png` });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await search.evaluate(el => getComputedStyle(el.closest('.home-search-field')).transitionDuration), '0s');
    await page.emulateMedia({ forcedColors: 'active' });
    await search.focus();
    assert.equal(await search.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
    await context.close(); console.log(`${theme}: shared input audit complete`);
  }
  assert.ok(report.fields.length > 40, 'audit must cover actual fields beyond PDF tools');
  assert.deepEqual(report.errors, []);
  console.log(`${report.fields.length} focused fields, reduced motion and forced colors passed`);
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close(); await new Promise(resolve => server.httpServer.close(resolve));
}
