import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const PptxGenJS = require('pptxgenjs');
const output = path.resolve('tmp/ppt-image-controls');
await mkdir(output, { recursive: true });
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await chromium.launch({ headless: true,
  ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
const report = [];

async function openTool(page, tool, prefix) {
  await page.locator(`.audio-list-item[data-tool="${tool}"]`).evaluate(node => node.click());
  await page.waitForFunction(prefix => {
    const node = document.getElementById(`${prefix}Overlay`);
    return node?.classList.contains('visible') && getComputedStyle(node).opacity === '1';
  }, prefix);
}

async function upload(page, prefix, fixture) {
  const chooser = page.waitForEvent('filechooser');
  await page.locator(`#${prefix}Cta`).click();
  await (await chooser).setFiles(fixture);
  await page.waitForSelector(`#${prefix}Results:not([hidden])`);
  await page.waitForFunction(prefix => {
    const mask = document.getElementById(`${prefix}ProcessMask`);
    return !mask.classList.contains('visible') && getComputedStyle(mask).opacity === '0';
  }, prefix);
}

async function openPreview(page, thumb) {
  await thumb.click();
  await page.waitForFunction(() => {
    const modal = document.getElementById('pptImagesPreviewOverlay');
    const img = document.getElementById('pptImagesPreviewImage');
    return modal.classList.contains('visible') && getComputedStyle(modal).opacity === '1'
      && img.complete && img.naturalWidth > 0;
  });
  // The dialog has its own transform transition in addition to the backdrop fade.
  await page.locator('.ppt-images-preview-dialog').evaluate(async node => {
    await Promise.all(node.getAnimations().map(animation => animation.finished));
  });
}

try {
  const fixturePage = await browser.newPage();
  const images = await fixturePage.evaluate(() => [[1600, 900], [600, 1000]].map(([width, height]) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    const pixels = ctx.createImageData(width, height);
    let seed = 71;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels.data[i] = seed & 255;
      pixels.data[i + 1] = (seed >>> 8) & 255;
      pixels.data[i + 2] = (seed >>> 16) & 255;
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(40, 40, 460, 150);
    ctx.fillStyle = '#17181b'; ctx.font = 'bold 48px sans-serif';
    ctx.fillText(`${width} x ${height}`, 60, 135);
    return canvas.toDataURL('image/png');
  }));
  await fixturePage.close();
  const deck = new PptxGenJS();
  for (const data of [images[0], images[1], images[0]]) {
    deck.addSlide().addImage({ data, x: 1, y: 1, w: 6, h: 4 });
  }
  const fixture = { name: 'image-controls.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: await deck.write({ outputType: 'nodebuffer' }) };

  for (const theme of ['light', 'dark']) {
    for (const language of ['zh', 'en']) {
      const label = `${theme}-${language}`;
      const page = await browser.newPage({ viewport: { width: 1401, height: 920 }, reducedMotion: 'reduce' });
      page.setDefaultTimeout(20000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (/Blocked aria-hidden/.test(message.text())) errors.push(message.text()); });
      await page.addInitScript(({ theme, language }) => {
        localStorage.setItem('toolknit.theme.v3', theme);
        localStorage.setItem('toolknit-lang', language);
        window.revokedPreviewUrls = [];
        const revoke = URL.revokeObjectURL.bind(URL);
        URL.revokeObjectURL = url => { window.revokedPreviewUrls.push(url); revoke(url); };
      }, { theme, language });
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
      await openTool(page, 'ppt-images', 'pptImages');
      await upload(page, 'pptImages', fixture);
      await page.waitForFunction(() => document.querySelectorAll('.ppt-images-thumb:enabled').length === 3);
      const checks = page.locator('.ppt-images-check');
      assert.equal(await checks.count(), 3);
      const thumbs = await page.locator('.ppt-images-thumb').evaluateAll(nodes => nodes.map(node => ({
        frame: node.getBoundingClientRect().toJSON(), image: node.querySelector('img').getBoundingClientRect().toJSON()
      })));
      for (const { frame, image } of thumbs) {
        assert.ok(image.width <= frame.width && image.height <= frame.height,
          `thumbnail image must fit its frame: ${JSON.stringify({ frame, image })}`);
      }
      if (theme === 'light') {
        assert.equal(await page.locator('#pptImagesSummary strong').evaluate(node => getComputedStyle(node).color),
          'rgb(23, 24, 27)', 'selected count must remain readable in light mode');
      }
      const style = await page.locator('.ppt-images-checkmark').first().evaluate(node => {
        const css = getComputedStyle(node); const glyph = getComputedStyle(node.querySelector('svg'));
        return { fill: css.backgroundColor, color: css.color, radius: css.borderRadius, glyph: glyph.visibility,
          width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height };
      });
      assert.equal(style.fill, theme === 'light' ? 'rgb(23, 24, 27)' : 'rgb(255, 255, 255)');
      assert.equal(style.color, theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(23, 24, 27)');
      assert.equal(style.radius, '50%'); assert.equal(style.glyph, 'visible');
      assert.equal(style.width, 24); assert.equal(style.height, 24);
      await checks.first().click();
      assert.equal(await checks.first().isChecked(), false);
      await checks.first().press('Space');
      assert.equal(await checks.first().isChecked(), true);
      await page.locator('.ppt-images-info').first().click();
      assert.equal(await checks.first().isChecked(), false);
      await page.locator('#pptImagesSelectAll').click();
      assert.equal(await page.locator('.ppt-images-check:checked').count(), 3);
      await page.locator('#pptImagesClearSelection').click();
      assert.equal(await page.locator('.ppt-images-check:checked').count(), 0);
      assert.equal(await page.locator('#pptImagesExportBtn').isDisabled(), true);
      await page.locator('#pptImagesSelectAll').click();
      await page.locator('#pptImagesSkipDuplicates').check();
      assert.equal(await page.locator('.ppt-images-check:disabled').count(), 1);
      assert.equal(await page.locator('.ppt-images-check:checked').count(), 2);
      await page.locator('#pptImagesSkipDuplicates').uncheck();
      await page.locator('#pptImagesSelectAll').click();
      await page.screenshot({ path: path.join(output, `${label}-list.png`) });

      const thumb = page.locator('.ppt-images-thumb').first();
      await openPreview(page, thumb);
      assert.equal(await page.locator('.ppt-images-check:checked').count(), 3, 'preview must not toggle selection');
      assert.equal(await page.locator('#pptImagesOverlay').evaluate(node => node.inert), true);
      const dimensions = await page.locator('.ppt-images-preview-dialog').boundingBox();
      assert.equal(Math.round(dimensions.width), 840); assert.equal(Math.round(dimensions.height), 600);
      const media = await page.locator('.ppt-images-preview-media').boundingBox();
      const close = await page.locator('#pptImagesPreviewClose').boundingBox();
      assert.ok(close.y >= media.y + media.height, 'close button must be below the image');
      const closeIcon = await page.locator('#pptImagesPreviewClose svg').boundingBox();
      const closeLabel = await page.locator('#pptImagesPreviewClose span').boundingBox();
      assert.ok(Math.abs(closeIcon.y + closeIcon.height / 2 - closeLabel.y - closeLabel.height / 2) < 1,
        'close icon and label must be vertically centered');
      assert.equal(await page.locator('#pptImagesPreviewImage').evaluate(img => getComputedStyle(img).objectFit), 'contain');
      await page.screenshot({ path: path.join(output, `${label}-preview.png`) });
      await page.locator('#pptImagesPreviewClose').click();
      assert.equal(await thumb.evaluate(node => node === document.activeElement), true);
      assert.equal(await page.locator('#pptImagesPreviewImage').getAttribute('src'), null);
      await openPreview(page, page.locator('.ppt-images-thumb').nth(1));
      const portrait = await page.locator('.ppt-images-preview-dialog').boundingBox();
      assert.equal(Math.round(portrait.width), 840); assert.equal(Math.round(portrait.height), 600);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('pptImagesPreviewOverlay').classList.contains('visible'));
      assert.equal(await page.locator('#pptImagesOverlay').evaluate(node => !node.inert && node.classList.contains('visible')), true);

      await page.setViewportSize({ width: 720, height: 480 });
      await openPreview(page, thumb);
      const small = await page.locator('.ppt-images-preview-dialog').boundingBox();
      assert.ok(small.x >= 0 && small.y >= 0 && small.x + small.width <= 720 && small.y + small.height <= 480);
      await page.screenshot({ path: path.join(output, `${label}-preview-small.png`) });
      // The window's rounded top corner is outside its hit-test surface.
      assert.equal(await page.evaluate(() => document.elementFromPoint(5, innerHeight / 2)?.id), 'pptImagesPreviewOverlay');
      await page.locator('#pptImagesPreviewOverlay').click({ position: { x: 5, y: 240 } });
      await page.waitForFunction(() => !document.getElementById('pptImagesPreviewOverlay').classList.contains('visible'));
      await page.setViewportSize({ width: 1401, height: 920 });
      const oldUrls = await page.locator('.ppt-images-thumb img').evaluateAll(nodes => nodes.map(node => node.src));
      await upload(page, 'pptImages', fixture);
      await page.waitForFunction(() => document.querySelectorAll('.ppt-images-thumb:enabled').length === 3);
      assert.ok(await page.evaluate(urls => urls.every(url => window.revokedPreviewUrls.includes(url)), oldUrls));
      const lastUrls = await page.locator('.ppt-images-thumb img').evaluateAll(nodes => nodes.map(node => node.src));
      await page.locator('#pptImagesBack').click();
      assert.ok(await page.evaluate(urls => urls.every(url => window.revokedPreviewUrls.includes(url)), lastUrls));
      await openTool(page, 'ppt-images', 'pptImages');
      assert.equal(await checks.count(), 0);
      assert.equal(await page.locator('#pptImagesPreviewOverlay').evaluate(node => node.inert), true);
      await page.locator('#pptImagesBack').click();

      await openTool(page, 'ppt-compress', 'pptCompress');
      await upload(page, 'pptCompress', fixture);
      const trigger = page.locator('#pptCompressOverlay .tool-custom-select-trigger');
      const native = page.locator('#pptCompressLevel');
      assert.equal(await native.getAttribute('data-tool-select-ready'), '1');
      assert.equal(await native.inputValue(), 'medium');
      assert.equal(await trigger.isEnabled(), true);
      await trigger.click();
      await page.screenshot({ path: path.join(output, `${label}-dropdown.png`) });
      await page.keyboard.press('Escape');
      assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('#pptCompressOverlay').evaluate(node => node.classList.contains('visible')), true);
      await trigger.press('ArrowDown');
      await page.keyboard.press('Escape');
      assert.equal(await trigger.getAttribute('aria-expanded'), 'false');

      await native.evaluate(node => {
        window.disabledCompressionControl = false;
        node.addEventListener('change', () => {
          window.disabledCompressionControl = node.disabled
            && node.parentElement.querySelector('.tool-custom-select-trigger').disabled;
        });
      });
      const stats = {};
      for (const value of ['low', 'high', 'medium']) {
        await trigger.click();
        await page.locator(`.tool-custom-select-menu:not([hidden]) [data-tool-select-value="${value}"]`).click();
        assert.equal(await native.inputValue(), value);
        assert.equal(await page.evaluate(() => window.disabledCompressionControl), true);
        await page.waitForFunction(() => !document.getElementById('pptCompressLevel').disabled);
        const selectedText = await native.locator('option:checked').textContent();
        assert.equal(await trigger.locator('.tool-custom-select-label').textContent(), selectedText);
        stats[value] = await page.locator('#pptCompressStats').textContent();
      }
      assert.notEqual(stats.low, stats.high, 'changing compression level must recompute image compression stats');
      await trigger.click();
      await page.locator('#pptCompressBack').click();
      assert.equal(await page.locator('.tool-custom-select-menu:not([hidden])').count(), 0);
      await openTool(page, 'ppt-compress', 'pptCompress');
      assert.equal(await native.inputValue(), 'medium');
      assert.equal(await trigger.locator('.tool-custom-select-label').textContent(), await native.locator('option:checked').textContent());
      await page.locator('#pptCompressBack').click();
      assert.deepEqual(errors, [], `${label}: runtime and focus errors`);
      report.push({ label, style, dimensions, small, stats });
      console.log(`PASS ${label}: selection, preview, cleanup, compression dropdown`);
      await page.close();
    }
  }
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await server.httpServer.close();
}
