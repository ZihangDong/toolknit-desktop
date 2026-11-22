import { APPEARANCE_STORAGE_KEY, createThemePalette, normalizeThemeConfig } from '../src/app/theme-palette.js';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { DEFAULT_DARK_BACKGROUND_SRC, CUSTOM_BACKGROUND_STORAGE_KEY } from '../src/app/custom-background-default.js';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/startup-browser');
await mkdir(output, { recursive: true });
const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await chromium.launch({ headless: true,
  ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
const report = { scenarios: [], errors: [] };
const baseUrl = server.resolvedUrls.local[0];

async function scenario(theme, { savedAppearance = false, reduced = false, failFonts = false, width = 1400, height = 887 } = {}) {
  const label = `${theme}-${reduced ? 'reduced' : 'normal'}-${failFonts ? 'failed-fonts' : 'cold'}-${width}${savedAppearance ? '-saved-appearance' : ''}`;
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => report.errors.push(`${label}: ${error.message}`));
  page.on('console', message => {
    if (/\[startup\]|Blocked aria-hidden/.test(message.text())) report.errors.push(`${label}: ${message.text()}`);
  });
  const preferences = savedAppearance
    ? { [APPEARANCE_STORAGE_KEY]: JSON.stringify(normalizeThemeConfig({ mode: theme })) }
    : {
        'toolknit.theme.v3': theme,
        [CUSTOM_BACKGROUND_STORAGE_KEY]: JSON.stringify({ type: 'image', src: DEFAULT_DARK_BACKGROUND_SRC, name: 'Default' })
      };
  const storageKey = savedAppearance ? APPEARANCE_STORAGE_KEY : 'toolknit.theme.v3';
  await page.addInitScript(({ preferences, storageKey }) => {
    if (localStorage.getItem(storageKey) === null) {
      for (const [key, value] of Object.entries(preferences)) localStorage.setItem(key, value);
    }
    window.__startupFrames = [];
    const sample = () => {
      const mask = document.getElementById('appStartupMask');
      const state = document.documentElement.dataset.tkStartup;
      if (mask && state) window.__startupFrames.push({ state, opacity: Number(getComputedStyle(mask).opacity),
        fonts: document.fonts.status, time: performance.now() });
      if (state || !document.querySelector('.app')) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, { preferences, storageKey });
  let releaseScripts;
  let releaseFonts;
  let releaseBackground;
  const scriptGate = new Promise(resolve => { releaseScripts = resolve; });
  const fontGate = new Promise(resolve => { releaseFonts = resolve; });
  const backgroundGate = new Promise(resolve => { releaseBackground = resolve; });
  let scriptsReleased = false;
  let fontsReleased = false;
  let backgroundReleased = false;
  let fontRequests = 0;
  await page.route('**/assets/*.js', async route => { if (!scriptsReleased) await scriptGate; await route.continue(); });
  await page.route('**/assets/fonts/*', async route => {
    fontRequests += 1;
    if (!fontsReleased) await fontGate;
    if (failFonts) await route.abort('failed'); else await route.continue();
  });
  await page.route(`**${DEFAULT_DARK_BACKGROUND_SRC}`, async route => {
    if (!backgroundReleased) await backgroundGate;
    await route.continue();
  });
  try {
    await page.goto(baseUrl, { waitUntil: 'commit' });
    await page.waitForSelector('#appStartupMask', { state: 'visible' });
    const measure = () => page.locator('#appStartupMask').evaluate(node => {
      const rect = node.getBoundingClientRect();
      const spinner = node.querySelector('.tk-startup-spinner');
      const ring = spinner.getBoundingClientRect();
      const css = getComputedStyle(node);
      return { background: css.backgroundColor, opacity: css.opacity, color: getComputedStyle(spinner).color,
        width: rect.width, height: rect.height, cx: ring.x + ring.width / 2, cy: ring.y + ring.height / 2,
        top: document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('#appStartupMask') === node };
    });
    const initial = await measure();
    const palette = createThemePalette({ mode: theme });
    const rgb = value => 'rgb(' + [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)).join(', ') + ')';
    assert.equal(initial.background, rgb(palette['--tk-page-bg']));
    assert.equal(initial.color, rgb(palette['--tk-ink']));
    assert.equal(initial.opacity, '1');
    assert.equal(initial.width, width);
    assert.equal(initial.height, height);
    assert.ok(initial.top);
    assert.ok(Math.abs(initial.cx - width / 2) < 1 && Math.abs(initial.cy - height / 2) < 1);
    // Playwright's screenshot normally waits for fonts, which are deliberately held here.
    const cdp = await context.newCDPSession(page);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(output, `${label}-loading.png`), Buffer.from(screenshot.data, 'base64'));
    await cdp.detach();
    scriptsReleased = true; releaseScripts();
    await page.waitForFunction(() => document.querySelector('.app')?.inert);
    await page.waitForTimeout(1400);
    assert.ok(fontRequests > 0, 'real bundled font requests were delayed');
    assert.equal((await measure()).opacity, '1', 'slow fonts must stay completely covered');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.querySelector('.app').contains(document.activeElement)), false);
    fontsReleased = true; releaseFonts();
    await page.evaluate(() => document.fonts.ready);
    if (theme === 'dark' && !savedAppearance) {
      await page.waitForTimeout(150);
      assert.equal((await measure()).opacity, '1', 'home wallpaper decoding must also finish before reveal');
    }
    backgroundReleased = true; releaseBackground();
    await page.waitForSelector('#appStartupMask', { state: 'detached' });
    const frames = await page.evaluate(() => window.__startupFrames);
    assert.ok(frames.some(frame => frame.state === 'revealing' && frame.opacity > 0 && frame.opacity < 1), 'fade must have intermediate frames');
    assert.ok(frames.filter(frame => frame.state === 'revealing').every(frame => frame.fonts === 'loaded'), 'no font swap during reveal');
    assert.equal(await page.locator('.app').evaluate(node => node.inert), false);
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme, 'the revealed app keeps its startup theme');
    await page.screenshot({ path: path.join(output, `${label}-ready.png`) });
    await page.locator('#homeV2Settings').click();
    await page.waitForSelector('#settingsOverlay.visible');
    for (const nextTheme of [theme === 'dark' ? 'light' : 'dark', theme]) {
      await page.locator(`[data-theme-choice="${nextTheme}"]`).click();
      await page.waitForFunction(value => document.documentElement.dataset.theme === value
        && !document.documentElement.classList.contains('tk-theme-switching'), nextTheme);
      assert.equal(await page.locator('#appStartupMask').count(), 0, 'theme changes keep using the existing page veil');
    }
    await page.locator('#settingsBack').click();
    await page.waitForFunction(() => !document.querySelector('#settingsOverlay').classList.contains('visible'));
    assert.equal(await page.locator('#appStartupMask').count(), 0, 'returning home must not replay startup');
    await page.unrouteAll({ behavior: 'wait' });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#appStartupMask', { state: 'detached' });
    assert.equal(await page.locator('.app').evaluate(node => node.inert), false, 'warm reload releases input too');
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme, 'the reloaded app keeps its saved theme');
    report.scenarios.push({ label, fontRequests, initial, frames });
    console.log(`PASS ${label}: first paint, slow fonts, background, fade, keyboard, theme switching, settings and reload`);
  } finally {
    releaseScripts(); releaseFonts(); releaseBackground();
    await context.close();
  }
}

try {
  await scenario('light');
  await scenario('dark');
  await scenario('dark', { savedAppearance: true });
  await scenario('light', { reduced: true, width: 1024, height: 600 });
  await scenario('dark', { reduced: true, failFonts: true, width: 390, height: 780 });
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
