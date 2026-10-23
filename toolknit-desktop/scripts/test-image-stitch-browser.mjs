import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const server = process.env.TOOLKNIT_TEST_URL ? null : await createServer({
  logLevel: 'error', optimizeDeps: { entries: ['index.html', 'screenshot.html'] },
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null }
});
await server?.listen();
const browser = await chromium.launch({ headless: true,
  ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
await page.addInitScript(() => {
  localStorage.setItem('toolknit.theme.v3', 'dark');
  localStorage.setItem('toolknit.recording-mode.prompt-dismissed.v1', 'true');
});
await page.emulateMedia({ reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const output = path.resolve('tmp/image-stitch-ui');
await mkdir(output, { recursive: true });

async function checkImportWidths() {
  assert.equal(await page.locator('#imageStitchHelp').count(), 0);
  const add = await page.locator('#imageStitchPick').boundingBox();
  const pdf = await page.locator('#imageStitchPdfPick').boundingBox();
  assert.ok(Math.abs(add.width - pdf.width) < 1, 'image and PDF import buttons have equal widths');
  assert.equal(add.x, pdf.x);
}

async function checkLightOptions() {
  for (const id of ['imageStitchMode', 'imageStitchReference', 'imageStitchFormat']) {
    const options = page.locator(`#${id} button`);
    const initial = await options.evaluateAll(nodes => nodes.findIndex(n => n.classList.contains('active')));
    for (let i = 0; i < await options.count(); i++) {
      await options.nth(i).click();
      await page.mouse.move(5, 5);
      const styles = await options.evaluateAll(nodes => nodes.map(n => {
        const style = getComputedStyle(n);
        return { active: n.classList.contains('active'), background: style.backgroundColor,
          color: style.color, border: style.borderColor, radius: style.borderRadius };
      }));
      assert.equal(styles.filter(s => s.active).length, 1);
      for (const style of styles) {
        assert.equal(style.background, style.active ? 'rgb(23, 23, 23)' : 'rgb(247, 248, 249)');
        assert.equal(style.border, style.active ? 'rgb(23, 23, 23)' : 'rgb(213, 216, 221)');
        assert.equal(style.radius, '7px');
        if (style.active) assert.equal(style.color, 'rgb(255, 255, 255)');
      }
      const unselected = options.nth((i + 1) % styles.length);
      await unselected.hover();
      await page.waitForFunction(n => getComputedStyle(n).backgroundColor === 'rgb(233, 234, 236)', await unselected.elementHandle());
    }
    await options.nth(initial).click();
    await options.nth(initial).press('Tab');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await options.nth(initial).evaluate(n => getComputedStyle(n).outlineStyle), 'solid');
  }
}

async function checkNumberField(selector, theme) {
  const input = page.locator(selector);
  const original = await input.inputValue();
  const bounds = await input.evaluate(n => ({ min: Number(n.min), max: Number(n.max) }));
  const geometry = () => input.evaluate(n => {
    const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    return { input: rect(n), unit: rect(n.nextElementSibling), field: rect(n.parentElement),
      scheme: getComputedStyle(n).colorScheme };
  });
  await input.scrollIntoViewIfNeeded();
  await page.mouse.move(5, 5);
  const before = await geometry();
  assert.equal(before.scheme, theme);
  assert.ok(before.input.right + 7 <= before.unit.x, `${selector}: unit has its own space beyond the native spinner`);
  assert.ok(before.unit.right <= before.field.right - 10);
  assert.ok(before.unit.y >= before.field.y && before.unit.bottom <= before.field.bottom);
  await input.hover();
  const after = await geometry();
  assert.deepEqual(after, before, `${selector}: hovering must not shift the input or unit`);
  await input.fill(String(bounds.min + 1));
  await input.press('ArrowUp');
  assert.equal(await input.inputValue(), String(bounds.min + 2));
  await input.press('ArrowDown');
  assert.equal(await input.inputValue(), String(bounds.min + 1));
  assert.equal(await input.evaluate(n => getComputedStyle(n.parentElement).outlineStyle), 'none');
  assert.equal(await input.evaluate(n => getComputedStyle(n.parentElement).getPropertyValue('--tk-field-height').trim()), '3px');
  assert.equal(await input.evaluate(n => getComputedStyle(n).backgroundColor), 'rgba(0, 0, 0, 0)');
  const box = await input.boundingBox();
  await page.mouse.click(box.x + box.width - 7, box.y + box.height / 4);
  assert.equal(await input.inputValue(), String(bounds.min + 2), `${selector}: native spinner remains clickable`);
  for (const [value, expected] of [[bounds.min - 1, bounds.min], [bounds.max + 1, bounds.max]]) {
    await input.fill(String(value));
    await input.press('Tab');
    assert.equal(await input.inputValue(), String(expected));
  }
  await input.fill(original);
  await input.press('Tab');
}

try {
  await page.goto(process.env.TOOLKNIT_TEST_URL || server.resolvedUrls.local[0]);
  await page.waitForSelector('[data-home-tool]', { state: 'attached' });
  await page.waitForFunction(() => !document.documentElement.dataset.tkStartup);
  await page.evaluate(async () => {
    const { initImageStitchTool } = await import('/src/features/image-stitch/tool.js');
    const { t, onLangChange } = await import('/src/i18n.js');
    const { calculateStitchLayout } = await import('/src/features/image-stitch/core.js');
    const inspect = file => {
      const index = Number(file.match(/(\d+)\.png$/)[1]);
      const canvas = document.createElement('canvas');
      canvas.width = 80; canvas.height = index % 2 ? 60 : 80;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = `hsl(${index * 37 % 360} 55% 65%)`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000'; ctx.font = '24px sans-serif'; ctx.fillText(String(index), 20, 36);
      return { path: file, name: file.split('/').at(-1), width: canvas.width, height: canvas.height, thumbnail_data_url: canvas.toDataURL() };
    };
    const requests = [];
    const tool = initImageStitchTool({
      overlay: document.querySelector('#imageStitchOverlay'), t, onLangChange,
      getOutputDir: async () => 'C:/qa-output',
      tauriEvents: Promise.resolve({ listen: async () => () => {} }),
      tauriCore: Promise.resolve({ invoke: async (command, args) => {
        if (command === 'inspect_image_stitch_inputs') return args.inputPaths.map(inspect);
        if (command !== 'stitch_images') throw new Error(`Unexpected command ${command}`);
        requests.push(args);
        await new Promise(resolve => { window.stitchQa.finishExport = resolve; });
        const result = calculateStitchLayout(args.inputPaths.map(inspect), { mode: args.mode, reference: args.reference,
          scale_percent: args.scalePercent, spacing_px: args.spacingPx });
        return { width: result.width, height: result.height, count: args.inputPaths.length,
          format: args.format.toUpperCase(), output_path: 'C:/qa-output/result.' + args.format };
      } })
    });
    window.stitchQa = { tool, requests,
      add: count => tool.openWithFile({ paths: Array.from({ length: count }, (_, i) => `C:/qa/image-${i + 1}.png`) }) };
    tool.open();
    await window.stitchQa.add(4);
  });
  const names = () => page.locator('.image-stitch-row-info strong').allTextContents();
  const previews = () => page.locator('.image-stitch-preview-item').evaluateAll(nodes => nodes.map(n => n.title));
  const first = await names();
  await page.locator('.image-stitch-row [data-action="down"]').first().click();
  assert.deepEqual(await names(), [first[1], first[0], first[2], first[3]]);
  assert.deepEqual(await previews(), await names());
  await page.locator('.image-stitch-row [data-action="up"]').nth(1).click();
  assert.deepEqual(await names(), first);
  const source = await page.locator('.image-stitch-row').first().boundingBox();
  const target = await page.locator('.image-stitch-row').nth(1).boundingBox();
  await page.mouse.move(source.x + 45, source.y + 30);
  await page.mouse.down();
  await page.mouse.move(target.x + 45, target.y + target.height - 4, { steps: 12 });
  assert.equal(await page.locator('#imageStitchDropZone').evaluate(n => n.classList.contains('visible')), false);
  await page.mouse.up();
  assert.deepEqual(await names(), [first[1], first[0], first[2], first[3]], 'pointer reorder updates the queue');
  assert.deepEqual(await previews(), await names(), 'pointer reorder updates the preview');
  assert.equal(await page.locator('#imageStitchExport').evaluate(n => getComputedStyle(n).color), 'rgb(0, 0, 0)');
  assert.equal(await page.locator('.image-stitch-hero p').evaluate(n => getComputedStyle(n).textAlign), 'left');
  console.log('PASS arrows, pointer drag, preview order, upload-mask isolation and styling');

  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#imageStitchOverlay')).backgroundColor === 'rgb(255, 255, 255)');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.image-stitch-control-card').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(247, 248, 249)');
  assert.equal(await page.locator('.image-stitch-preview-panel').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(255, 255, 255)');
  assert.equal(await page.locator('.image-stitch-settings').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(255, 255, 255)');
  assert.equal(await page.locator('.image-stitch-preview-viewport').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(243, 244, 245)');
  assert.equal(await page.locator('.image-stitch-row').first().evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(255, 255, 255)');
  assert.equal(await page.locator('#imageStitchMode .active').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(23, 23, 23)');
  assert.equal(await page.locator('#imageStitchMode .active').evaluate(n => getComputedStyle(n).color), 'rgb(255, 255, 255)');
  assert.equal(await page.locator('#imageStitchExport').evaluate(n => getComputedStyle(n).color), 'rgb(255, 255, 255)');
  await page.screenshot({ path: path.join(output, 'light-workspace.png') });
  console.log('PASS light shell, queue, preview and settings surfaces');

  await checkLightOptions();
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.locator('#imageStitchFormat [data-format="jpg"]').click();
    for (const viewport of [{ width: 1366, height: 900 }, { width: 1100, height: 700 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await checkImportWidths();
      for (const selector of ['#imageStitchSpacing', '#imageStitchScale', '#imageStitchQuality']) await checkNumberField(selector, theme);
      await page.locator('.image-stitch-settings').screenshot({ path: path.join(output, `${theme}-controls-${viewport.width}.png`) });
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.locator('#imageStitchFormat [data-format="png"]').click();
    assert.equal(await page.locator('#imageStitchQualityWrap').isHidden(), true);
    console.log(`PASS ${theme}: equal imports, three number fields, native spinners, keyboard and bounds at three widths`);
  }

  for (const side of [2, 3, 4, 5]) {
    await page.locator('#imageStitchClear').click();
    await page.locator(`[data-mode="grid-${side}"]`).click();
    await page.evaluate(count => window.stitchQa.add(count), side * side - 1);
    assert.equal(await page.locator('#imageStitchExport').isDisabled(), true);
    await page.evaluate(count => window.stitchQa.add(count), side * side);
    assert.equal(await page.locator('#imageStitchExport').isEnabled(), true);
    assert.equal(await page.locator('.image-stitch-preview-item').count(), side * side);
    assert.equal(await page.locator('#imageStitchPreview').evaluate(n => getComputedStyle(n).position), 'relative');
    await page.evaluate(count => window.stitchQa.add(count), side * side + 1);
    assert.equal(await page.locator('#imageStitchExport').isDisabled(), true);
    await page.locator('.image-stitch-row [data-action="remove"]').last().click();
    assert.equal(await page.locator('#imageStitchExport').isEnabled(), true);
    await page.locator('#imageStitchExport').click();
    await page.waitForFunction(() => Boolean(window.stitchQa.finishExport));
    const request = await page.evaluate(() => window.stitchQa.requests.at(-1));
    assert.equal(request.mode, `grid-${side}`);
    assert.equal(request.inputPaths.length, side * side);
    assert.equal(await page.locator('.image-stitch-row [data-action="down"]').first().isDisabled(), true);
    await page.evaluate(() => { window.stitchQa.finishExport(); window.stitchQa.finishExport = null; });
    await page.waitForSelector('#imageStitchSuccessOverlay.visible');
    await page.locator('#imageStitchSuccessOk').click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#imageStitchSuccessOverlay')).opacity === '0');
    await page.screenshot({ path: path.join(output, `grid-${side}.png`) });
    await page.locator('.image-stitch-row [data-action="remove"]').last().click();
    assert.equal(await page.locator('#imageStitchExport').isDisabled(), true);
    console.log(`PASS ${side}x${side}: missing/exact/excess/delete counts, preview and native request`);
  }
  await page.locator('[data-mode="horizontal"]').click();
  assert.equal(await page.locator('#imageStitchExport').isEnabled(), true, 'linear mode retains 2-100 image support');
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.locator('[data-mode="grid-5"]').click();
  await page.evaluate(() => window.stitchQa.add(25));
  await page.locator('#imageStitchExport').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#imageStitchQualityWrap').isHidden(), true);
  await page.locator('[data-format="jpg"]').click();
  assert.equal(await page.locator('#imageStitchQualityWrap').isVisible(), true);
  const panels = await page.locator('.image-stitch-settings > *').evaluateAll(nodes => nodes
    .filter(n => getComputedStyle(n).display !== 'none')
    .map(n => ({ top: n.getBoundingClientRect().top, bottom: n.getBoundingClientRect().bottom })));
  for (let i = 1; i < panels.length; i++) assert.ok(panels[i].top >= panels[i - 1].bottom, 'compact settings must not overlap');
  await page.locator('#imageStitchExport').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'compact.png') });
  await page.evaluate(() => { window.stitchQa.tool.close(); window.stitchQa.tool.open(); });
  assert.equal(await page.locator('#imageStitchExport').isEnabled(), true);
  await page.evaluate(() => { window.stitchQa.tool.dispose(); window.stitchQa.tool.dispose(); });
  assert.deepEqual(errors, []);
  console.log('PASS compact settings, reopen and disposal');
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await browser.close();
  await server?.close();
}
