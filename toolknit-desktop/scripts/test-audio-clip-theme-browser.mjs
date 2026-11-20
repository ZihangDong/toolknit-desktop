import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer, preview } from 'vite';
import { pdfjsAssets } from './lib/pdfjs-assets.mjs';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const built = process.argv.includes('--built');
const output = path.resolve(built ? 'tmp/audio-clip-theme-built' : 'tmp/audio-clip-theme-ui');
await mkdir(output, { recursive: true });
const server = built ? await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0 } })
  : await createServer({ configFile: false, plugins: [pdfjsAssets()],
    cacheDir: 'tmp/audio-clip-theme-ui/vite-cache', optimizeDeps: { entries: ['index.html'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });

function wav() {
  const rate = 22050;
  const frames = rate * 12;
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) buffer.writeInt16LE(Math.round(
    Math.sin(i / rate * 440 * 2 * Math.PI) * (0.2 + 0.15 * Math.sin(i / rate * 2)) * 32767), 44 + i * 2);
  return { name: 'long-source-filename-for-audio-clip-layout-and-waveform-regression.wav', mimeType: 'audio/wav', buffer };
}

let browser;
let page;
const report = { errors: [], layouts: [], waveforms: [], progress: [], consoleErrors: [] };
const english = JSON.parse(await readFile('src/locales/en.json', 'utf8'));
try {
  if (!built) await server.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
  page = await browser.newPage({ viewport: { width: 1400, height: 887 }, reducedMotion: 'reduce', deviceScaleFactor: 2 });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(url.hostname) || ['blob:', 'data:'].includes(url.protocol)
      ? route.continue() : route.abort();
  });
  await page.addInitScript(() => {
    localStorage.setItem('toolknit.theme.v3', 'light');
    window.clipThemeObservers = {};
    for (const name of ['MutationObserver', 'ResizeObserver']) {
      const Native = window[name];
      const active = window.clipThemeObservers[name] = new Set();
      window[name] = class extends Native {
        observe(target, options) {
          super.observe(target, options);
          if (target.id === 'audioClipCanvas' || options?.attributeFilter?.join() === 'data-theme') active.add(this);
        }
        disconnect() { active.delete(this); super.disconnect(); }
      };
    }
  });
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  const open = async () => {
    await page.locator('[data-tool="audio-clip"]').evaluate(n => n.click());
    await page.waitForSelector('#audioClipOverlay.visible');
    await page.locator('#audioClipCta').hover();
    await page.evaluate(() => document.fonts.ready);
  };
  const upload = async file => {
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#audioClipCta').click();
    await (await chooser).setFiles(file);
  };
  const color = (selector, property = 'backgroundColor') => page.locator(selector).first().evaluate((n, key) => getComputedStyle(n)[key], property);
  const screenshot = name => page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
  const setTheme = async theme => {
    await page.evaluate(value => document.querySelector(`[data-theme-choice="${value}"]`).click(), theme);
    // Pixel checks wait for the observer-triggered redraw, not merely the CSS attribute.
    await page.waitForFunction(light => {
      const c = document.querySelector('#audioClipCanvas');
      const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 180 && pixels[i + 3] < 256) {
        if (light ? pixels[i] === 73 : pixels[i] === 255) return true;
      }
      return false;
    }, theme === 'light');
  };
  const wavePixels = async theme => {
    const data = await page.locator('#audioClipCanvas').evaluate(c => {
      const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let wave = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 180 && pixels[i] < 100) wave++;
      return { width: c.width, cssWidth: c.getBoundingClientRect().width, wave };
    });
    if (theme === 'light') assert.ok(data.wave > 1000, 'light waveform must contain visible dark pixels');
    else assert.equal(data.wave, 0, 'dark waveform must retain the original white ink');
    assert.ok(Math.abs(data.width - Math.floor(data.cssWidth) * 2) <= 1, 'waveform must stay sharp at DPR 2');
    report.waveforms.push({ theme, ...data });
  };

  await open();
  const unscoped = await page.evaluate(css => {
    const sheet = new CSSStyleSheet(); sheet.replaceSync(css);
    const invalid = [];
    const walk = rules => { for (const rule of rules) {
      if (rule instanceof CSSStyleRule && !rule.selectorText.startsWith('html[data-theme="light"] ')) invalid.push(rule.selectorText);
      if (rule.cssRules) walk(rule.cssRules);
    } };
    walk(sheet.cssRules); return invalid;
  }, await readFile('src/features/audio-tools/audio-clip.css', 'utf8'));
  assert.deepEqual(unscoped, []);
  assert.equal(await color('.audio-clip-v2-empty h2', 'color'), 'rgb(23, 23, 23)');
  assert.equal(await color('.audio-clip-format-chip', 'color'), 'rgb(96, 99, 106)');
  await screenshot('light-empty');
  await page.evaluate(() => {
    window.clipThemeQA = { progress: [] };
    const mask = document.querySelector('#audioClipProcessMask');
    window.clipThemeQA.observer = new MutationObserver(() => {
      if (mask.classList.contains('visible')) window.clipThemeQA.progress.push(getComputedStyle(mask).backgroundColor);
    });
    window.clipThemeQA.observer.observe(mask, { attributes: true, attributeFilter: ['class'] });
  });
  await upload(wav());
  await page.waitForSelector('#audioClipOverlay.has-file');
  await setTheme('light');
  await wavePixels('light');
  assert.equal(await page.locator('#audioClipSelEnd').textContent(), '0:12');
  assert.equal(await color('#audioClipFileName', 'color'), 'rgb(23, 23, 23)');
  await page.locator('#audioClipPlusBtn').click();
  assert.equal(await page.locator('#audioClipSelStart').textContent(), '0:01');
  await page.locator('#audioClipMinusBtn').click();
  assert.equal(await page.locator('#audioClipSelStart').textContent(), '0:00');

  const canvas = await page.locator('#audioClipCanvas').boundingBox();
  const end = await page.locator('#audioClipHandleEnd .audio-clip-handle-grip').boundingBox();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * 0.75, end.y + end.height / 2, { steps: 8 });
  await page.mouse.up();
  assert.equal(await page.locator('#audioClipSelEnd').textContent(), '0:09');
  await page.locator('#audioClipMinusBtn').click();
  assert.equal(await page.locator('#audioClipSelEnd').textContent(), '0:08');
  await page.locator('#audioClipCanvas').click({ position: { x: 10, y: 50 } });
  assert.equal(await page.locator('#audioClipPlusBtn').isDisabled(), true);
  assert.equal(await color('#audioClipPlusBtn', 'color'), 'rgb(152, 157, 166)');
  await page.locator('#audioClipResetBtn').click();
  await page.locator('#audioClipPlayBtn').click();
  await page.waitForFunction(() => document.querySelector('#audioClipCurrentTime').textContent === '0:02');
  await setTheme('dark');
  await wavePixels('dark');
  assert.equal(await page.locator('#audioClipPlayBtn rect').count(), 2, 'theme switch must not stop playback');
  await screenshot('dark-playing');
  await setTheme('light');
  await wavePixels('light');
  await page.locator('#audioClipPlayBtn').click();
  await page.mouse.move(1390, 880);
  await screenshot('light-loaded');

  for (const language of ['zh', 'en']) {
    await page.evaluate(lang => document.querySelector(`.lang-option[data-lang="${lang}"]`).click(), language);
    await page.waitForFunction(lang => document.documentElement.lang === (lang === 'zh' ? 'zh-CN' : 'en')
      && !document.body.classList.contains('fade-out') && !document.body.classList.contains('fade-in'), language);
    for (const [width, height] of [[1400, 887], [1100, 700], [1100, 520], [980, 640], [390, 844]]) {
      await page.setViewportSize({ width, height });
      for (const selector of ['.audio-clip-v2-body', '.audio-clip-v2-sidebar', '.audio-clip-v2-workspace', '.audio-clip-v2-console', '.audio-clip-controls']) {
        const dimensions = await page.locator(selector).evaluate(n => ({ width: n.clientWidth, scroll: n.scrollWidth }));
        assert.ok(dimensions.scroll <= dimensions.width + 1, `${language} ${width}: ${selector} no horizontal overflow`);
      }
      for (const selector of ['#audioClipCta', '#audioClipFileRemove', '#audioClipExportBtn']) {
        await page.locator(selector).scrollIntoViewIfNeeded();
        const reachable = await page.locator(selector).evaluate(n => {
          const r = n.getBoundingClientRect();
          const header = document.querySelector('.audio-clip-v2-topbar').getBoundingClientRect();
          return r.top >= header.bottom && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
        });
        assert.ok(reachable, `${language} ${width}x${height}: ${selector} reachable`);
      }
      const row = await page.locator('#audioClipFileInfo').evaluate(n => [...n.children].map(c => {
        const r = c.getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, right: r.right };
      }));
      assert.ok(row.every(r => Math.abs(r.y - row[0].y) < 1), 'file name, duration and remove remain on one row');
      assert.ok(row.slice(1).every((r, i) => r.x >= row[i].right), 'file row items do not overlap');
      await screenshot(`light-${language}-${width}x${height}`);
      report.layouts.push({ language, width, height });
    }
  }
  await page.setViewportSize({ width: 1400, height: 887 });
  await page.locator('#audioClipExportBtn').click();
  // Browser export is intentionally desktop-only; do not simulate a successful native file.
  await page.waitForFunction(text => [...document.querySelectorAll('.app-toast')].some(n => n.textContent.includes(text)), english.home.audioClip.desktopOnly);
  assert.equal(await page.locator('#audioClipSuccessOverlay.visible').count(), 0);
  await page.locator('.app-toast').filter({ hasText: english.home.audioClip.desktopOnly }).locator('.app-toast-close').click();
  await page.waitForSelector('.app-toast', { state: 'hidden' });

  // Presentation fixture only: native output and Explorer are not mocked as real exports.
  for (const [width, height] of [[1400, 887], [390, 520]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      document.querySelector('#audioClipSuccessFile').textContent = 'tone.wav';
      document.querySelector('#audioClipSuccessDuration').textContent = '0:08';
      document.querySelector('#audioClipSuccessPath').textContent = 'Audio/tone-clip.wav';
      document.querySelector('#audioClipSuccessMeta').textContent = 'tone.wav - 0:08';
      document.querySelector('#audioClipSuccessOverlay').classList.add('visible');
    });
    await page.locator('#audioClipSuccessOk').hover();
    const fits = await page.locator('#audioClipSuccessOverlay .audio-clip-success-dialog').evaluate(n => {
      const r = n.getBoundingClientRect();
      return n.scrollWidth <= n.clientWidth + 1 && r.left >= 0 && r.right <= innerWidth
        && r.top >= 0 && r.bottom <= innerHeight;
    });
    assert.ok(fits, 'shared result dialog must fit the viewport');
    assert.equal(await page.locator('#audioClipSuccessOpenFolder').isVisible(), true);
    await screenshot(`result-fixture-${width}x${height}`);
    await page.locator('#audioClipSuccessOk').click();
    await page.waitForSelector('#audioClipSuccessOverlay.visible', { state: 'hidden' });
  }
  await page.setViewportSize({ width: 1400, height: 887 });

  await page.locator('#audioClipResetBtn').focus();
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  assert.equal(await color('#audioClipResetBtn', 'outlineStyle'), 'solid');
  await page.locator('#audioClipFileRemove').click();
  assert.equal(await page.locator('#audioClipOverlay.has-file').count(), 0);
  await upload({ name: 'invalid.wav', mimeType: 'audio/wav', buffer: Buffer.from('invalid audio') });
  await page.waitForFunction(() => !document.querySelector('#audioClipProcessMask').classList.contains('visible'));
  await upload(wav());
  await page.waitForSelector('#audioClipOverlay.has-file');
  await page.locator('#audioClipBack').click();
  await page.waitForSelector('#audioClipOverlay.visible', { state: 'hidden' });
  assert.equal(await page.locator('#audioClipOverlay').evaluate(n => n.contains(document.activeElement)), false);
  assert.deepEqual(await page.evaluate(() => Object.values(window.clipThemeObservers).map(set => set.size)), [0, 0], 'closing releases both view observers');
  await open();
  assert.deepEqual(await page.evaluate(() => Object.values(window.clipThemeObservers).map(set => set.size)), [1, 1], 'reopening creates exactly one of each observer');
  assert.equal(await page.locator('#audioClipOverlay.has-file').count(), 0);
  await upload(wav());
  await page.waitForSelector('#audioClipOverlay.has-file');
  await setTheme('dark'); await setTheme('light');
  await wavePixels('light');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#audioClipOverlay.visible', { state: 'hidden' });
  report.progress = await page.evaluate(() => { window.clipThemeQA.observer.disconnect(); return window.clipThemeQA.progress; });
  assert.ok(report.progress.length > 0 && report.progress.every(c => c === 'rgba(255, 255, 255, 0.96)'));
  assert.deepEqual(report.errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Audio clip ${built ? 'built' : 'dev'} theme: ${report.layouts.length} layouts, real WAV, drag, fine tune, playback, theme redraw, export guard and recovery passed`);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: error.stack, ...report }, null, 2));
  throw error;
} finally {
  await browser?.close();
  if (built) await new Promise(resolve => server.httpServer.close(resolve));
  else await server.close();
}
