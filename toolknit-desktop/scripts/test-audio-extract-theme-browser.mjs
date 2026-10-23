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
const output = path.resolve(built ? 'tmp/audio-extract-theme-built' : 'tmp/audio-extract-theme-ui');
await mkdir(output, { recursive: true });
const server = built ? await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0 } })
  : await createServer({ configFile: false, plugins: [pdfjsAssets()],
    cacheDir: 'tmp/audio-extract-theme-ui/vite-cache', optimizeDeps: { entries: ['index.html'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
const english = JSON.parse(await readFile('src/locales/en.json', 'utf8'));
const sourceName = 'long-video-source-filename-for-audio-extract-layout-regression-and-track-selection.mp4';
// Browser selection validates the file name/size only; no native decode is claimed.
const file = { name: sourceName, mimeType: 'video/mp4', buffer: Buffer.alloc(2048) };
const report = { errors: [], layouts: [], nativeAdapter: false };
let browser;
let page;

try {
  if (!built) await server.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
  page = await browser.newPage({ viewport: { width: 1400, height: 887 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(url.hostname) || ['blob:', 'data:'].includes(url.protocol)
      ? route.continue() : route.abort();
  });
  await page.addInitScript(() => localStorage.setItem('toolknit.theme.v3', 'light'));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  const host = page.locator('#audioExtractFeatureOverlay');
  const action = name => host.locator(`[data-audio-extract-action="${name}"]`);
  const color = (selector, property = 'backgroundColor') => host.locator(selector).first().evaluate((n, p) => getComputedStyle(n)[p], property);
  const screenshot = name => page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
  const open = async () => {
    await page.locator('[data-tool="audio-extract"]').evaluate(n => n.click());
    await page.waitForSelector('#audioExtractFeatureOverlay.visible');
    await action('choose').hover();
    await page.mouse.move(1390, 880);
    await page.evaluate(() => document.fonts.ready);
  };
  const upload = async value => {
    const chooser = page.waitForEvent('filechooser');
    await action('choose').click();
    await (await chooser).setFiles(value);
    await host.locator('[data-audio-extract-info]').waitFor({ state: 'visible' });
  };
  const setTheme = async theme => {
    await page.evaluate(value => document.querySelector(`[data-theme-choice="${value}"]`).click(), theme);
    await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
    await page.waitForFunction(() => document.getAnimations().every(a =>
      a.constructor.name !== 'CSSTransition' || a.playState !== 'running'));
  };

  await open();
  assert.equal(await color('.audio-extract-feature'), 'rgb(255, 255, 255)');
  assert.equal(await color('.audio-extract-hero-top h2', 'color'), 'rgb(23, 23, 23)');
  const unscoped = await page.evaluate(css => {
    const sheet = new CSSStyleSheet(); sheet.replaceSync(css);
    const invalid = [];
    const walk = rules => { for (const rule of rules) {
      if (rule instanceof CSSStyleRule && !rule.selectorText.startsWith('html[data-theme="light"] ')) invalid.push(rule.selectorText);
      if (rule.cssRules) walk(rule.cssRules);
    } };
    walk(sheet.cssRules); return invalid;
  }, await readFile('src/styles/themes/audio-extract-light.css', 'utf8'));
  assert.deepEqual(unscoped, [], 'extractor styles must not change dark mode or other tools');
  await screenshot('light-empty');
  await setTheme('dark');
  const darkSnapshot = () => host.evaluate(root => Object.fromEntries([
    '.audio-extract-feature', '.audio-extract-body', '.audio-extract-v2-poster',
    '.audio-extract-v2-workspace', '.audio-extract-hero-top', '.extract-hero-title',
    '.audio-extract-v2-topbar', '[data-audio-extract-action="choose"]'
  ].map(selector => {
    const n = root.querySelector(selector); const s = getComputedStyle(n); const r = n.getBoundingClientRect();
    return [selector, { background: s.backgroundColor, color: s.color, border: s.borderColor,
      radius: s.borderRadius, font: s.fontSize, columns: s.gridTemplateColumns, rows: s.gridTemplateRows,
      width: r.width, height: r.height }];
  })));
  report.dark = await darkSnapshot();
  await setTheme('light');
  await setTheme('dark');
  assert.deepEqual(await darkSnapshot(), report.dark, 'theme round-trip preserves current dark palette and geometry');
  await screenshot('dark-empty');
  await setTheme('light');
  await upload(file);
  assert.equal(await color('.audio-extract-info-meta', 'color'), 'rgb(96, 99, 106)');
  assert.equal(await color('[data-format="AAC"]'), 'rgb(245, 246, 247)');
  for (const format of ['AAC', 'WAV', 'FLAC', 'OGG', 'MP3']) {
    await host.locator(`[data-format="${format}"]`).click();
    await page.waitForFunction(value => getComputedStyle(document.querySelector(
      `#audioExtractFeatureOverlay [data-format="${value}"]`)).backgroundColor === 'rgb(23, 23, 23)', format);
    assert.equal(await color(`[data-format="${format}"]`), 'rgb(23, 23, 23)');
    assert.equal(await host.locator('[data-format].active').count(), 1);
  }
  await setTheme('dark'); await setTheme('light');
  assert.equal(await host.locator('[data-audio-extract-file-name]').textContent(), sourceName);
  await page.mouse.move(1390, 880);
  await screenshot('light-loaded');
  for (const language of ['zh', 'en']) {
    await page.evaluate(lang => document.querySelector(`.lang-option[data-lang="${lang}"]`).click(), language);
    await page.waitForFunction(lang => document.documentElement.lang === (lang === 'zh' ? 'zh-CN' : 'en')
      && !document.body.classList.contains('fade-out') && !document.body.classList.contains('fade-in'), language);
    for (const [width, height] of [[1400, 887], [1100, 700], [1100, 520], [980, 640], [390, 844]]) {
      await page.setViewportSize({ width, height });
      for (const selector of ['.audio-extract-body', '.audio-extract-v2-poster', '.audio-extract-v2-workspace', '.audio-extract-info', '.audio-extract-info-row']) {
        const fits = await host.locator(selector).evaluate(n => n.scrollWidth <= n.clientWidth + 1);
        assert.ok(fits, `${language} ${width}x${height}: ${selector} no horizontal overflow`);
      }
      for (const name of ['choose', 'remove', 'start']) {
        await action(name).scrollIntoViewIfNeeded();
        const reachable = await action(name).evaluate(n => {
          const r = n.getBoundingClientRect();
          const header = n.closest('.audio-extract-feature').querySelector('header').getBoundingClientRect();
          return r.top >= header.bottom - 1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1;
        });
        assert.ok(reachable, `${language} ${width}x${height}: ${name} reachable`);
      }
      const row = await host.locator('.audio-extract-info-row').evaluate(n => [...n.children].map(c => {
        const r = c.getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, right: r.right };
      }));
      assert.ok(row.every(r => Math.abs(r.y - row[0].y) < 1), 'file icon, metadata and remove remain on one row');
      assert.ok(row.slice(1).every((r, i) => r.x >= row[i].right), 'file row items do not overlap');
      await screenshot(`light-${language}-${width}x${height}`);
      report.layouts.push({ language, width, height });
    }
  }
  await page.setViewportSize({ width: 1400, height: 887 });
  await action('start').click();
  await page.waitForFunction(text => [...document.querySelectorAll('.app-toast')].some(n => n.textContent.includes(text)), english.home.audioExtract.desktopOnly);
  assert.equal(await host.locator('[data-audio-extract-success].visible').count(), 0);
  await page.locator('.app-toast').filter({ hasText: english.home.audioExtract.desktopOnly }).locator('.app-toast-close').click();
  await page.waitForSelector('.app-toast', { state: 'hidden' });

  // Presentation fixtures supplement the adapter test; these are not real native exports.
  for (const [width, height] of [[1400, 887], [390, 520]]) {
    await page.setViewportSize({ width, height });
    await host.evaluate((root, name) => {
      root.querySelector('[data-audio-extract-success-file]').textContent = name;
      root.querySelector('[data-audio-extract-success-path]').textContent = `Audio/${name}.mp3`;
      root.querySelector('[data-audio-extract-success-format]').textContent = 'MP3';
      root.querySelector('[data-audio-extract-success-meta]').textContent = name;
      root.querySelector('[data-audio-extract-success]').classList.add('visible');
    }, sourceName);
    await action('success-ok').hover();
    const fits = await host.locator('.audio-clip-success-dialog').evaluate(n => {
      const r = n.getBoundingClientRect();
      return n.scrollWidth <= n.clientWidth + 1 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
    });
    assert.ok(fits, 'result dialog must fit long names and small viewports');
    assert.equal(await action('open-folder').isVisible(), true);
    await screenshot(`result-fixture-${width}x${height}`);
    await action('success-ok').click();
    await page.waitForFunction(() => !document.querySelector('#audioExtractFeatureOverlay [data-audio-extract-success]')?.classList.contains('visible'));
  }
  await page.setViewportSize({ width: 1400, height: 887 });
  await upload({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
  assert.equal(await action('start').isDisabled(), true);
  assert.equal(await color('[data-audio-extract-action="start"]'), 'rgb(226, 227, 230)');
  await upload(file);
  assert.equal(await action('start').isEnabled(), true);
  await action('remove').focus();
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  assert.equal(await color('[data-audio-extract-action="remove"]', 'outlineStyle'), 'solid');
  await action('remove').click();
  await host.locator('[data-audio-extract-hero]').waitFor({ state: 'visible' });
  await action('back').click();
  await page.waitForSelector('#audioExtractFeatureOverlay.visible', { state: 'hidden' });
  assert.equal(await host.evaluate(n => n.contains(document.activeElement)), false);
  await open();
  await host.locator('[data-audio-extract-hero]').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await page.waitForSelector('#audioExtractFeatureOverlay.visible', { state: 'hidden' });

  if (!built) {
    // Drive the production controller with injected native adapters, without writing files or opening Explorer.
    await page.evaluate(async name => {
      const { createAudioExtractController } = await import('/src/features/audio-extract/controller.js');
      const { audioExtractTemplate } = await import('/src/features/audio-extract/template.js');
      const root = document.createElement('div');
      root.id = 'extract-theme-adapter'; root.className = 'feature-tool-overlay audio-extract-feature-host';
      root.innerHTML = audioExtractTemplate(); document.body.append(root);
      const qa = window.extractThemeAdapter = { calls: [], notices: [], opened: [], unlistens: 0, mode: 'tracks' };
      qa.controller = createAudioExtractController({ overlay: root, isTauri: true,
        loadDialog: async () => ({ open: async () => `C:/fixture/${name}` }),
        getOutputDir: async () => 'C:/fixture/Audio',
        openOutputFolder: async value => qa.opened.push(value),
        notify: value => qa.notices.push(value),
        tauriCore: Promise.resolve({ invoke: async (command, args) => {
          qa.calls.push({ command, args });
          if (command === 'get_file_size') return 4096;
          if (command === 'probe_video') return new Promise(resolve => { qa.resolveProbe = () => resolve({
            duration: 92, file_size: 4096, audio_tracks: qa.mode === 'silent' ? [] : [
              { index: 0, codec: 'aac', language: 'eng', channels: 2 },
              { index: 1, codec: 'aac', language: 'zho', channels: 2 }
            ] }); });
          if (command === 'extract_audio') return new Promise(resolve => { qa.resolveExtract = resolve; });
        } }),
        tauriEvents: Promise.resolve({ listen: async (event, callback) => {
          qa.progress = callback; return () => { qa.unlistens++; };
        } })
      });
      qa.controller.open();
    }, sourceName);
    const adapter = page.locator('#extract-theme-adapter');
    const click = name => adapter.locator(`[data-audio-extract-action="${name}"]`).click();
    await click('choose');
    await page.waitForFunction(() => !!window.extractThemeAdapter.resolveProbe);
    assert.equal(await adapter.locator('[data-audio-extract-action="start"]').isDisabled(), true);
    await page.evaluate(() => window.extractThemeAdapter.resolveProbe());
    await adapter.locator('[data-audio-extract-track-wrap]').waitFor({ state: 'visible' });
    await adapter.locator('[data-audio-extract-track]').selectOption('1');
    await adapter.locator('[data-format="WAV"]').click();
    await setTheme('dark'); await setTheme('light');
    assert.equal(await adapter.locator('[data-audio-extract-track]').inputValue(), '1');
    assert.equal(await adapter.locator('option').first().evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(255, 255, 255)');
    await screenshot('light-multitrack-adapter');
    await click('start');
    await page.waitForFunction(() => !!window.extractThemeAdapter.resolveExtract);
    await page.evaluate(() => window.extractThemeAdapter.progress({ payload: { progress: 0.5, status: 'extract' } }));
    assert.equal(await adapter.locator('[data-audio-extract-progress]').evaluate(n => n.style.width), '50%');
    assert.equal(await adapter.locator('[data-audio-extract-process]').evaluate(n => getComputedStyle(n).backgroundColor), 'rgba(255, 255, 255, 0.96)');
    await screenshot('light-progress-adapter');
    await page.evaluate(() => window.extractThemeAdapter.resolveExtract({ success: true, output_path: 'C:/fixture/Audio/output.wav' }));
    await adapter.locator('[data-audio-extract-success].visible').waitFor();
    await click('open-folder');
    assert.deepEqual(await page.evaluate(() => window.extractThemeAdapter.opened), ['C:/fixture/Audio/output.wav'], 'reveal selects the actual output file');
    const extract = await page.evaluate(() => window.extractThemeAdapter.calls.find(c => c.command === 'extract_audio').args);
    assert.equal(extract.trackIndex, 1); assert.equal(extract.targetFormat, 'WAV');
    await click('success-ok');
    await page.evaluate(() => { window.extractThemeAdapter.mode = 'silent'; window.extractThemeAdapter.resolveProbe = null; });
    await click('choose');
    await page.waitForFunction(() => !!window.extractThemeAdapter.resolveProbe);
    await page.evaluate(() => window.extractThemeAdapter.resolveProbe());
    assert.equal(await adapter.locator('[data-audio-extract-action="start"]').isDisabled(), true);
    await screenshot('light-no-audio-adapter');
    assert.equal(await page.evaluate(() => window.extractThemeAdapter.unlistens), 1);
    await page.evaluate(() => window.extractThemeAdapter.controller.dispose());
    report.nativeAdapter = true;
  }
  assert.deepEqual(report.errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Audio extract ${built ? 'built' : 'dev'} theme: ${report.layouts.length} layouts, theme, file selection, formats, recovery, result dialog and lifecycle passed; native adapter: ${report.nativeAdapter}`);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: error.stack, ...report }, null, 2));
  throw error;
} finally {
  await browser?.close();
  if (built) await new Promise(resolve => server.httpServer.close(resolve));
  else await server.close();
}
