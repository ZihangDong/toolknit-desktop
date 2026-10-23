import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { auditVisibleColors } from './lib/theme-color-audit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const PptxGenJS = require('pptxgenjs');
const output = path.resolve('tmp/theme-audit-v32/focused');
await mkdir(output, { recursive: true });
const ppt = new PptxGenJS();
for (const index of [1, 2]) {
  const slide = ppt.addSlide();
  slide.addText(`Theme check ${index}`, { x: .6, y: .4, w: 7, h: .6, fontSize: 26 });
  slide.addText('Readable body text 12345.\nSecond line remains editable.', { x: .6, y: 1.5, w: 7, h: 1, fontSize: 16 });
  slide.addTable([['Name', 'Value'], ['Alpha', '42']], { x: .6, y: 3, w: 7, h: 1.2 });
  slide.addNotes('Speaker notes: verify contrast in both themes.');
}
const fixture = { name: 'theme-check.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: await ppt.write({ outputType: 'nodebuffer' }) };
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, open: false } });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, executablePath: process.env.TOOLKNIT_TEST_BROWSER });
const report = { checks: [], errors: [] };
try {
  for (const theme of ['light', 'dark']) {
    for (const dpr of [1, 1.25, 2]) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: dpr, reducedMotion: 'reduce' });
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('console', message => { if (message.text().includes('Blocked aria-hidden')) report.errors.push(message.text()); });
      await page.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.fulfill({ body: '{}' }));
      await page.addInitScript(theme => {
        localStorage.setItem('toolknit.theme.v3', theme);
        localStorage.setItem('toolknit-lang', 'zh');
        localStorage.setItem('toolknit.recording-mode.prompt-dismissed.v1', 'true');
      }, theme);
      await page.goto(url);
      await page.waitForFunction(() => !document.documentElement.dataset.tkStartup);
      const open = async (id, prefix) => {
        await page.locator(`.audio-list-item[data-tool="${id}"]`).evaluate(node => node.click());
        await page.locator(`#${prefix}Overlay.visible`).waitFor();
        await page.waitForFunction(prefix => getComputedStyle(document.getElementById(`${prefix}Overlay`)).opacity === '1', prefix);
        await page.evaluate(() => document.fonts.ready);
      };
      await open('image-stitch', 'imageStitch');
      await page.locator('#imageStitchFormat [data-format="jpg"]').click();
      for (const id of ['imageStitchSpacing', 'imageStitchScale', 'imageStitchQuality']) {
        const input = page.locator(`#${id}`), field = input.locator('..');
        await field.scrollIntoViewIfNeeded();
        await input.hover();
        await input.focus();
        const before = await input.boundingBox();
        const png = await field.screenshot({ path: path.join(output, `${theme}-${dpr}-${id}.png`) });
        const img = await loadImage(png), canvas = createCanvas(img.width, img.height), ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
        const ink = (x, y) => {
          const i = (y * img.width + x) * 4;
          return theme === 'light' ? Math.max(...pixels.slice(i, i + 3)) < 80 : Math.min(...pixels.slice(i, i + 3)) > 210;
        };
        const heights = Array.from({ length: img.width - Math.ceil(16 * dpr) }, (_, index) => {
          const x = index + Math.ceil(8 * dpr);
          let count = 0;
          for (let y = img.height - 1; y >= Math.max(0, img.height - Math.ceil(6 * dpr)); y--) if (ink(x, y)) count++;
          return count;
        });
        assert.ok(Math.min(...heights) >= Math.floor(2 * dpr), `${theme}/${dpr}/${id}: underline must not be covered by the child field: ${heights}`);
        assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, `${id}: uniform underline under text and suffix`);
        assert.equal(await input.evaluate(n => getComputedStyle(n).backgroundColor), 'rgba(0, 0, 0, 0)');
        assert.deepEqual(await input.boundingBox(), before);
        report.checks.push({ theme, dpr, id, inkHeightRange: [Math.min(...heights), Math.max(...heights)], sampledColumns: heights.length });
      }
      await page.locator('#imageStitchBack').click();
      for (const [id, prefix, count] of [['ppt-draft', 'pptDraft', 3], ['ppt-outline', 'pptOutline', 2]]) {
        await open(id, prefix);
        const controls = page.locator(`#${prefix}Overlay .tool-custom-select-trigger`);
        assert.equal(await controls.count(), count);
        await page.locator(`#${prefix}SlideCount`).focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.locator(`#${prefix}Locale + .tool-custom-select button`).evaluate(n => n === document.activeElement), true, 'Tab must skip the invisible native select');
        await controls.first().press('ArrowDown');
        await page.keyboard.press('Tab');
        assert.equal(await page.locator(`#${prefix}DeckType + .tool-custom-select button`).evaluate(n => n === document.activeElement), true, 'Tab leaves the portal in form order');
        await controls.first().press('ArrowDown');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.locator(`#${prefix}SlideCount`).evaluate(n => n === document.activeElement), true, 'Shift+Tab returns to the previous input');
        for (const trigger of await controls.all()) {
          await trigger.scrollIntoViewIfNeeded();
          const styles = await trigger.evaluate(n => ({ ink: getComputedStyle(n).color, svgInk: getComputedStyle(n.querySelector('svg')).color, stroke: getComputedStyle(n.querySelector('svg')).stroke }));
          assert.equal(styles.svgInk, styles.ink);
          assert.equal(styles.stroke, styles.ink);
          await trigger.click();
          await page.locator('.tool-custom-select-menu:not([hidden])').waitFor();
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('.tool-custom-select-menu:not([hidden])').count(), 0);
          assert.equal(await page.locator(`#${prefix}Overlay.visible`).count(), 1);
          await trigger.press('ArrowDown');
          await page.keyboard.press('End');
          await page.keyboard.press('Enter');
          const value = await trigger.evaluate(n => {
            const select = n.closest('.tool-custom-select').previousElementSibling;
            return { label: n.textContent.trim(), selected: select.selectedOptions[0].textContent.trim() };
          });
          assert.equal(value.label, value.selected);
        }
        await page.locator(`[data-${id}-preset="training"]`).click();
        assert.equal(await page.locator(`#${prefix}DeckType + .tool-custom-select .tool-custom-select-label`).textContent(), '培训课件 / 教学演示');
        await page.screenshot({ path: path.join(output, `${theme}-${dpr}-${id}.png`) });
        await controls.first().click();
        await page.locator(`#${prefix}Back`).click();
        assert.equal(await page.locator('.tool-custom-select-menu:not([hidden])').count(), 0);
        await open(id, prefix);
        assert.equal(await controls.count(), count, 'reopen must not duplicate controls');
        await page.locator(`#${prefix}Back`).click();
        report.checks.push({ theme, dpr, id, menus: count });
      }
      await open('ppt-text', 'pptText');
      await page.locator('#pptTextFileInput').setInputFiles(fixture);
      await page.locator('.ppt-text-item-toggle').first().click();
      await page.waitForSelector('#pptTextProcessMask.visible', { state: 'hidden' });
      assert.ok((await page.locator('.ppt-text-detail-line').allTextContents()).some(text => text.includes('Readable body')));
      const checkText = async current => {
        const audit = await page.evaluate(auditVisibleColors, '#pptTextList');
        const bad = audit.findings.filter(f => !f.ambiguous && f.contrast < 4.5 && f.kind === 'text');
        assert.deepEqual(bad, [], `${current}: expanded title, body, table and notes must be readable`);
        await page.locator('#pptTextOverlay').screenshot({ path: path.join(output, `${current}-${dpr}-ppt-text.png`) });
        report.checks.push({ theme: current, dpr, id: 'ppt-text-detail', checked: audit.checked });
      };
      await checkText(theme);
      const next = theme === 'light' ? 'dark' : 'light';
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, next);
      await page.waitForTimeout(350);
      await checkText(next);
      await page.locator('.ppt-text-item-toggle').first().click();
      await page.locator('#pptTextBack').click();
      await page.close();
      console.log(`PASS ${theme} at ${dpr * 100}%: pixel underline, menus, expanded PPT text and live theme switch`);
    }
  }
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
