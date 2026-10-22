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
const output = path.resolve(built ? 'tmp/bpm-theme-built' : 'tmp/bpm-theme-ui');
await mkdir(output, { recursive: true });
const server = built ? await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0 } })
  : await createServer({ configFile: false, plugins: [pdfjsAssets()],
  cacheDir: 'tmp/bpm-theme-ui/vite-cache', optimizeDeps: { entries: ['index.html'] },
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });

function wav(silent = false) {
  const rate = 22050;
  const frames = rate * 24;
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  if (!silent) for (let beat = 0; beat < 48; beat++) {
    const start = Math.round(beat * rate * 0.5);
    for (let offset = 0; offset < 110; offset++) {
      buffer.writeInt16LE(Math.round((1 - offset / 110) * 0.9 * 32767), 44 + (start + offset) * 2);
    }
  }
  return { name: silent ? 'silence.wav' : 'click-120-bpm.wav', mimeType: 'audio/wav', buffer };
}

let browser;
let page;
const report = { errors: [], layouts: [], progress: [], consoleErrors: [] };
try {
  if (!built) await server.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
  page = await browser.newPage({ viewport: { width: 1400, height: 887 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(url.hostname) || ['blob:', 'data:'].includes(url.protocol)
      ? route.continue() : route.abort();
  });
  await page.addInitScript(() => localStorage.setItem('toolknit.theme.v3', 'light'));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  const open = async () => {
    await page.locator('[data-tool="bpm-detect"]').evaluate(n => n.click());
    await page.waitForSelector('#bpmDetectOverlay.visible');
    await page.locator('#bpmDetectCta').hover();
    await page.evaluate(() => document.fonts.ready);
  };
  const upload = async file => {
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#bpmDetectCta').click();
    await (await chooser).setFiles(file);
  };
  const color = (selector, property = 'backgroundColor') => page.locator(selector).first().evaluate((n, key) => getComputedStyle(n)[key], property);
  const screenshot = name => page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
  const setTheme = async theme => {
    await page.evaluate(value => document.querySelector(`[data-theme-choice="${value}"]`).click(), theme);
    await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.constructor.name !== 'CSSTransition' || animation.playState !== 'running'));
  };

  await open();
  // Parse the dedicated theme with the browser, including nested media rules.
  const themeSource = await readFile('src/styles/themes/bpm-light.css', 'utf8');
  const unscoped = await page.evaluate(css => {
    const sheet = new CSSStyleSheet(); sheet.replaceSync(css);
    const invalid = [];
    const walk = rules => { for (const rule of rules) {
      if (rule instanceof CSSStyleRule && !rule.selectorText.startsWith('html[data-theme="light"] ')) invalid.push(rule.selectorText);
      if (rule.cssRules) walk(rule.cssRules);
    } };
    walk(sheet.cssRules);
    return invalid;
  }, themeSource);
  assert.deepEqual(unscoped, []);
  assert.equal(await color('.bpm-detect-control-card'), 'rgb(247, 248, 249)');
  assert.equal(await color('.bpm-analysis-panel'), 'rgb(255, 255, 255)');
  assert.equal(await color('.bpm-demo-panel'), 'rgb(255, 255, 255)');
  assert.equal(await color('.bpm-hero-title', 'backgroundImage'), 'none');
  assert.equal(await page.locator('#bpmDemoPlayBtn').isDisabled(), true);
  assert.equal(await color('#bpmDemoPlayBtn'), 'rgb(241, 242, 244)');
  await screenshot('light-empty');

  await page.evaluate(() => {
    window.bpmThemeQA = { progress: [] };
    const mask = document.querySelector('#bpmProcessMask');
    window.bpmThemeQA.observer = new MutationObserver(() => {
      if (mask.classList.contains('visible')) window.bpmThemeQA.progress.push({
        background: getComputedStyle(mask).backgroundColor,
        bar: getComputedStyle(mask.querySelector('.audio-convert-process-bar-fill')).backgroundColor,
        text: getComputedStyle(mask.querySelector('.audio-convert-process-text')).color
      });
    });
    window.bpmThemeQA.observer.observe(mask, { attributes: true, attributeFilter: ['class'] });
  });
  await upload(wav());
  await page.waitForFunction(() => !document.querySelector('#bpmDemoPlayBtn').disabled, null, { timeout: 60000 });
  const bpm = Number(await page.locator('#bpmResultNumber').textContent());
  assert.ok(Math.abs(bpm - 120) <= 2, `Actual WAV must analyze near 120 BPM, got ${bpm}`);
  assert.equal(await page.locator('.bpm-timeline-bar').count(), 64);
  assert.equal(await color('.bpm-demo-panel'), 'rgb(255, 255, 255)', 'ready panel must stay white');
  assert.equal(await color('.bpm-result-number', 'color'), 'rgb(23, 23, 23)');
  assert.equal(await color('.bpm-timeline-bar.beat'), 'rgb(23, 23, 23)');
  assert.equal(await color('.bpm-candidate-chip.active'), 'rgb(23, 23, 23)');
  const inactive = page.locator('.bpm-candidate-chip:not(.active)').first();
  assert.ok(await inactive.count(), 'real analysis should expose alternate candidates');
  assert.equal(await inactive.evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(245, 246, 247)');
  await inactive.hover();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.bpm-candidate-chip:hover')).backgroundColor === 'rgb(233, 234, 236)');
  await inactive.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await inactive.evaluate(n => getComputedStyle(n).outlineStyle), 'solid');
  const alternative = await inactive.getAttribute('data-bpm');
  await inactive.press('Enter');
  assert.equal(await page.locator('#bpmResultNumber').textContent(), alternative);
  assert.equal(await page.locator('#bpmDemoBpmNumber').textContent(), alternative);
  await page.locator(`.bpm-candidate-chip[data-bpm="${bpm}"]`).click();
  await page.mouse.move(1390, 880);
  await screenshot('light-result');

  for (const language of ['zh', 'en']) {
    await page.evaluate(lang => document.querySelector(`.lang-option[data-lang="${lang}"]`).click(), language);
    await page.waitForFunction(lang => document.documentElement.lang === (lang === 'zh' ? 'zh-CN' : 'en')
      && !document.body.classList.contains('fade-out') && !document.body.classList.contains('fade-in'), language);
    for (const [width, height] of [[1400, 887], [1100, 700], [1100, 520], [980, 640], [390, 844]]) {
      await page.setViewportSize({ width, height });
      const dimensions = await page.locator('.bpm-detect-body').evaluate(n => ({
        width: n.clientWidth, scrollWidth: n.scrollWidth,
        cards: [...n.children].map(p => ({ width: p.clientWidth, scrollWidth: p.scrollWidth }))
      }));
      assert.ok(dimensions.scrollWidth <= dimensions.width + 1, `${language} ${width}: no horizontal page overflow`);
      for (const card of dimensions.cards) assert.ok(card.scrollWidth <= card.width + 1, `${language} ${width}: no clipped panel content`);
      for (const selector of ['.bpm-formats', '#bpmReanalyzeBtn', '#bpmDemoBeatVolume']) {
        const node = page.locator(selector);
        await node.scrollIntoViewIfNeeded();
        const reachable = await node.evaluate(n => {
          const r = n.getBoundingClientRect();
          const panel = n.closest('.bpm-detect-card').getBoundingClientRect();
          return r.top >= Math.max(68, panel.top) - 1 && r.bottom <= Math.min(innerHeight, panel.bottom) + 1;
        });
        assert.ok(reachable, `${language} ${width}x${height}: ${selector} must be reachable`);
      }
      const track = await page.locator('.bpm-timeline-track').evaluate(n => ({
        width: n.clientWidth, scrollWidth: n.scrollWidth,
        bars: [...n.children].map(b => b.getBoundingClientRect().width)
      }));
      assert.ok(track.scrollWidth <= track.width + 1 && track.bars.every(w => w > 0), 'all 64 bars must fit even in narrow columns');
      report.layouts.push({ language, width, height });
      await screenshot(`${language}-${width}x${height}-demo`);
      if (width === 390 || height === 520) {
        await page.locator('#bpmReanalyzeBtn').scrollIntoViewIfNeeded();
        await screenshot(`${language}-${width}x${height}-result`);
      }
    }
  }

  await page.setViewportSize({ width: 1400, height: 887 });
  await page.locator('#bpmDemoPlayBtn').click();
  await page.waitForFunction(() => document.querySelector('#bpmDemoBeatIndicator').classList.contains('beat-active'));
  assert.equal(await page.locator('#bpmDemoStopBtn').isVisible(), true);
  await page.locator('#bpmDemoAudioVolume').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#bpmDemoAudioVolume').inputValue(), '31');
  await page.locator('#bpmDemoBeatVolume').focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#bpmDemoBeatVolume').inputValue(), '79');
  await setTheme('dark');
  assert.equal(await color('.bpm-detect-control-card', 'borderRadius'), '24px');
  assert.equal(await color('.bpm-demo-panel'), 'rgba(8, 8, 9, 0.34)');
  assert.equal(await page.locator('#bpmDemoStopBtn').isVisible(), true, 'theme switch preserves playback');
  await screenshot('dark-result-playing');
  await setTheme('light');
  assert.equal(await color('.bpm-demo-panel'), 'rgb(255, 255, 255)');
  await page.locator('#bpmDemoStopBtn').click();
  assert.equal(await page.locator('#bpmDemoPlayBtn').isVisible(), true);
  assert.equal(await page.locator('.bpm-demo-beat-indicator.beat-active').count(), 0);
  await page.locator('#bpmDemoClose').click();
  assert.equal(await page.locator('#bpmDemoPlayBtn').isDisabled(), true);
  assert.equal(await page.locator('.bpm-demo-panel').isVisible(), true, 'clear does not hide the inline workspace');

  await upload(wav(true));
  await page.waitForFunction(() => document.querySelector('#bpmResultNumber').textContent === '?');
  assert.equal(await page.locator('#bpmDemoPlayBtn').isDisabled(), true);
  assert.equal(await page.locator('.bpm-candidate-chip').count(), 0);
  await screenshot('light-no-beat');
  await upload({ name: 'invalid.wav', mimeType: 'audio/wav', buffer: Buffer.from('not audio') });
  await page.waitForFunction(() => !document.querySelector('#bpmProcessMask').classList.contains('visible')
    && !document.querySelector('#bpmResult').classList.contains('visible'));
  assert.equal(await page.locator('#bpmAnalysisEmpty').isVisible(), true);
  await upload(wav());
  await page.waitForFunction(() => !document.querySelector('#bpmDemoPlayBtn').disabled);
  await page.locator('#bpmDemoPlayBtn').click();
  await page.locator('#bpmDetectBack').click();
  await page.waitForFunction(() => !document.querySelector('#bpmDetectOverlay').classList.contains('visible'));
  assert.equal(await page.locator('.bpm-demo-beat-indicator.beat-active').count(), 0);
  await open();
  assert.equal(await page.locator('#bpmDemoPlayBtn').isDisabled(), true);
  assert.equal(await page.locator('#bpmAnalysisEmpty').isVisible(), true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#bpmDetectOverlay').classList.contains('visible'));
  report.progress = await page.evaluate(() => {
    window.bpmThemeQA.observer.disconnect();
    return window.bpmThemeQA.progress;
  });
  assert.ok(report.progress.length >= 3);
  for (const item of report.progress) assert.deepEqual(item, {
    background: 'rgba(255, 255, 255, 0.96)', bar: 'rgb(23, 23, 23)', text: 'rgb(96, 99, 106)'
  });
  assert.deepEqual(report.errors, []);
  console.log(`BPM theme browser checks passed: ${report.layouts.length} layouts, real WAV analysis, playback, failure recovery and lifecycle`);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png'), animations: 'disabled' }).catch(() => {});
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  if (built) await new Promise(resolve => server.httpServer.close(resolve));
  else await server.close();
}
