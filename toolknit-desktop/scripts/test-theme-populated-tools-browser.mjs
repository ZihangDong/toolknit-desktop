import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { auditVisibleColors } from './lib/theme-color-audit.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const output = path.resolve('tmp/theme-audit-v32/populated-tools');
await mkdir(output, { recursive: true });
const source = createCanvas(240, 160), drawing = source.getContext('2d');
drawing.fillStyle = '#ffffff'; drawing.fillRect(0, 0, 240, 160);
drawing.fillStyle = '#d74a50'; drawing.fillRect(120, 0, 120, 160);
const fixture = { name: 'theme-sample.png', mimeType: 'image/png', buffer: await source.encode('png') };
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, open: false } });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, executablePath: process.env.TOOLKNIT_TEST_BROWSER });
const report = { checks: [], errors: [] };
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.fulfill({ body: '{}' }));
    await page.addInitScript(theme => {
      localStorage.setItem('toolknit.theme.v3', theme);
      localStorage.setItem('toolknit-lang', 'zh');
      localStorage.setItem('toolknit.recording-mode.prompt-dismissed.v1', 'true');
      localStorage.setItem('ai_platform', 'custom');
      localStorage.setItem('ai_custom_url', 'https://theme-audit.test/v1/chat/completions');
      localStorage.setItem('ai_custom_model', 'theme-fixture');
      localStorage.setItem('ai_api_key', 'local-theme-test-not-a-real-key');
    }, theme);
    const open = async (id, overlay) => {
      await page.goto(url);
      await page.waitForFunction(() => !document.documentElement.dataset.tkStartup);
      await page.locator(`.audio-list-item[data-tool="${id}"]`).evaluate(n => n.click());
      await page.locator(`${overlay}.visible`).waitFor();
      await page.waitForFunction(selector => getComputedStyle(document.querySelector(selector)).opacity === '1', overlay);
      await page.waitForFunction(() => {
        const veil = document.querySelector('[data-tk-page-transition-veil]');
        return !veil || getComputedStyle(veil).visibility === 'hidden';
      });
    };
    const check = async (label, root, minimum = 3) => {
      const audit = await page.evaluate(auditVisibleColors, root);
      assert.ok(audit.checked > 0, `${label}: inspect actual visible content`);
      const failures = audit.findings.filter(f => !f.ambiguous && f.opacity === 1 && f.contrast < minimum);
      report.checks.push({ theme, label, ...audit });
      assert.deepEqual(failures, [], `${theme}/${label}`);
      await page.screenshot({ path: path.join(output, `${theme}-${label}.png`) });
    };
    // Sample the rendered surface: a transparent field over a gradient cannot
    // be assessed reliably by adding only ancestor background-color values.
    const checkPlaceholder = async selector => {
      const field = page.locator(selector);
      await field.scrollIntoViewIfNeeded();
      assert.equal(await field.inputValue(), '');
      assert.ok(await field.getAttribute('placeholder'));
      const ink = await field.evaluate(node => {
        const css = getComputedStyle(node, '::placeholder');
        const rgba = css.color.match(/[\d.]+/g).map(Number);
        return [...rgba.slice(0, 3), (rgba[3] ?? 1) * Number(css.opacity)];
      });
      const png = await field.screenshot({ path: path.join(output, `${theme}-${selector.slice(1)}-placeholder.png`) });
      const bitmap = await loadImage(png), canvas = createCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const surface = [...ctx.getImageData(bitmap.width - 8, Math.floor(bitmap.height / 2), 1, 1).data].slice(0, 3);
      const foreground = ink.slice(0, 3).map((n, i) => n * ink[3] + surface[i] * (1 - ink[3]));
      const luminance = rgb => rgb.map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
        .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
      const a = luminance(foreground), b = luminance(surface), contrast = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      report.checks.push({ theme, label: 'placeholder', selector, contrast, surface, foreground });
      assert.ok(contrast >= 4.5, `${theme}/${selector}: placeholder contrast ${contrast.toFixed(2)}`);
    };
    for (const [id, overlay, fields] of [
      ['image-crop', '#imageCropOverlay', ['#imageCropOutputName']],
      ['image-stitch', '#imageStitchOverlay', ['#imageStitchOutputName']],
      ['text-format', '#textFormatOverlay', ['#textFormatInput', '#textFormatOutput']],
      ['text-stats', '#textStatsOverlay', ['#textStatsInput']],
      ['ai-polish', '#aiPolishOverlay', ['#aiPolishInput']],
      ['ai-translate', '#aiTranslateOverlay', ['#aiTranslateInput']],
      ['ai-doc', '#aiDocOverlay', ['#aiDocChatInput']],
      ['ai-table', '#aiTableOverlay', ['#aiTableChatInput']]
    ]) {
      await open(id, overlay);
      await page.evaluate(() => document.fonts.ready);
      for (const selector of fields) await checkPlaceholder(selector);
    }
    for (const [id, overlay] of [['convert', '#audioConvertFeatureOverlay'], ['video-convert', '#videoConvertOverlay'], ['image-convert', '#imageConvertOverlay'], ['image-compress', '#imageCompressOverlay']]) {
      await open(id, overlay);
      await check(id, `${overlay} .pdf-merge-v2-options`, 4.5);
    }
    await open('markdown-editor', '#markdownEditorOverlay');
    await page.locator('.cm-editor').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await check('markdown-source', '.md-input-pane', 4.5);
    const tokens = await page.locator('.cm-line span').count();
    assert.ok(tokens > 12, 'actual Markdown syntax tokens are present');
    const before = await page.locator('.cm-content').textContent();
    const paper = await page.locator('.md-preview-pane').evaluate(n => getComputedStyle(n).backgroundColor);
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme === 'light' ? 'dark' : 'light'; }, theme);
    await page.waitForTimeout(350);
    await check('markdown-source-switched', '.md-input-pane', 4.5);
    assert.equal(await page.locator('.cm-content').textContent(), before, 'theme change preserves source');
    assert.equal(await page.locator('.md-preview-pane').evaluate(n => getComputedStyle(n).backgroundColor), paper, 'paper remains a content surface');

    await open('image-color-replace', '#imageColorReplaceOverlay');
    await check('color-pair-arrow', '.color-pair-arrow');
    for (const selector of ['.color-replace-empty .tk-empty-hero-icon', '.color-replace-empty em', '.color-replace-stage-footer']) await check(`color-empty-${selector.endsWith('em') ? 'button' : selector.includes('footer') ? 'zoom' : 'icon'}`, selector);
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.color-replace-empty').click();
    await (await chooser).setFiles(fixture);
    await page.locator('[data-cr-stage].has-image').waitFor();
    await page.locator('[data-cr-target]').evaluate(n => { n.value = '#36965a'; n.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(350);
    await check('color-loaded', '.color-replace-stage-section');
    const downloaded = page.waitForEvent('download');
    await page.locator('[data-cr-export]').click();
    const file = await downloaded;
    const png = await readFile(await file.path());
    const result = await loadImage(png);
    assert.equal(result.width, 240); assert.equal(result.height, 160);
    const preview = createCanvas(240, 160), ctx = preview.getContext('2d'); ctx.drawImage(result, 0, 0);
    const pixel = ctx.getImageData(20, 20, 1, 1).data;
    assert.ok(pixel[1] > pixel[0] && pixel[1] > pixel[2], 'actual export applies the selected green to the white region');
    report.checks.push({ theme, label: 'color-export', width: result.width, height: result.height });

    await open('json-tools', '#developerToolboxOverlay');
    await page.locator('[data-dev-input]').fill('{"title":"Theme check","count":42}');
    await page.waitForFunction(() => document.querySelector('[data-dev-output]').value.includes('42'));
    await check('json-result', '.developer-toolbox-workspace');
    await page.locator('[data-dev-input]').fill('{invalid json');
    await page.locator('[data-dev-status].is-error').waitFor();
    await check('json-error', '.developer-toolbox-workspace');
    await page.locator('[data-dev-input]').fill('{"recovered":true}');
    await page.waitForFunction(() => !document.querySelector('[data-dev-status]').classList.contains('is-error'));
    await check('json-recovered', '.developer-toolbox-workspace');
    await page.close();
    console.log(`PASS ${theme}: converter hints, Markdown tokens, true image export and JSON result/error/recovery`);
  }
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
