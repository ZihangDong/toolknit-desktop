import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const tools = [
  ['ppt-draft', 'pptDraftOverlay'], ['ppt-text', 'pptTextOverlay'],
  ['ppt-compress', 'pptCompressOverlay'], ['ppt-outline', 'pptOutlineOverlay'],
  ['ppt-to-pdf', 'pptToPdfOverlay'], ['ppt-to-image', 'pptToImageOverlay'],
  ['ppt-images', 'pptImagesOverlay']
];
const output = path.resolve('tmp/ppt-cold-layout');
const report = [];
const profiles = [
  { width: 1400, height: 888, custom: false }, { width: 1400, height: 888, custom: true },
  { width: 1100, height: 700, custom: false }, { width: 1100, height: 480, custom: true },
  { width: 720, height: 480, custom: false }, { width: 720, height: 480, custom: true }
];
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, open: false } });
let browser;
try {
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true,
    ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
  const configurePage = async (viewport, custom) => {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.text().includes('Blocked aria-hidden')) errors.push(message.text());
    });
    await page.route('https://**/*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.addInitScript(custom => {
      localStorage.setItem('toolknit.theme.v3', custom ? 'dark' : 'light');
      localStorage.setItem('toolknit.recording-mode.prompt-dismissed.v1', 'true');
    }, custom);
    if (custom) await page.addInitScript(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 120;
      const context = canvas.getContext('2d');
      context.fillStyle = '#245541';
      context.fillRect(0, 0, 240, 120);
      context.fillStyle = '#d2dbe0';
      context.fillRect(120, 0, 120, 120);
      localStorage.setItem('toolknit.customBackground.v1', JSON.stringify({ type: 'image', src: canvas.toDataURL(), name: 'Synthetic QA background' }));
    });
    await page.goto(url);
    await page.waitForFunction(() => !document.documentElement.dataset.tkStartup);
    return { page, errors };
  };
  const open = async (page, [id, overlayId]) => {
    const card = page.locator(`.audio-list-item[data-tool="${id}"]`);
    await card.waitFor({ state: 'attached' });
    await card.evaluate(node => node.click());
    await page.waitForSelector(`#${overlayId}.visible`);
    await page.waitForFunction(id => getComputedStyle(document.getElementById(id)).opacity === '1', overlayId);
    await page.waitForFunction(() => {
      const veil = document.querySelector('[data-tk-page-transition-veil]');
      return !veil || getComputedStyle(veil).visibility === 'hidden';
    });
  };
  const close = async (page, overlayId) => {
    await page.locator(`#${overlayId} header .pdf-merge-v2-back`).click();
    await page.waitForSelector(`#${overlayId}:not(.visible)`, { state: 'attached' });
  };
  const check = async (page, overlayId, label, custom) => {
    if (custom) await page.waitForFunction(id => {
      const image = document.querySelector(`#${id} .plasma-bg.has-custom-background img`);
      return image?.complete && image.naturalWidth > 0;
    }, overlayId);
    const layout = await page.locator(`#${overlayId}`).evaluate(overlay => {
      const body = overlay.querySelector(':scope > .pdf-merge-v2-body');
      const header = overlay.querySelector(':scope > header');
      const button = overlay.querySelector(':scope > .ppt-images-scroll-top');
      const workspace = body.querySelector('.pdf-merge-v2-workspace');
      const rect = node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const flow = [...overlay.children].filter(node => {
        const style = getComputedStyle(node);
        return style.display !== 'none' && !['absolute', 'fixed'].includes(style.position);
      });
      const r = workspace.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = Math.min(r.bottom, innerHeight) - 20;
      return {
        overlay: rect(overlay), header: rect(header), body: rect(body), workspace: rect(workspace),
        rows: getComputedStyle(overlay).gridTemplateRows, flow: flow.map(node => node.id || node.tagName),
        workspaceHit: workspace.contains(document.elementFromPoint(x, y)),
        button: button ? { position: getComputedStyle(button).position, width: getComputedStyle(button).width,
          height: getComputedStyle(button).height, opacity: getComputedStyle(button).opacity,
          pointerEvents: getComputedStyle(button).pointerEvents, iconWidth: getComputedStyle(button.querySelector('svg')).width } : null
      };
    });
    report.push({ label, layout });
    assert.equal(layout.flow.length, 2, `${label}: only header and body may consume grid rows (${layout.rows})`);
    assert.ok(Math.abs(layout.header.bottom - layout.body.top) <= 1, `${label}: body starts below navigation`);
    assert.ok(Math.abs(layout.body.bottom - layout.overlay.bottom) <= 1, `${label}: body must fill the page, not collapse`);
    assert.ok(layout.workspace.width > 100 && layout.workspace.height > 100, `${label}: workspace remains usable`);
    if (layout.workspace.top < layout.body.bottom - 40) {
      assert.equal(layout.workspaceHit, true, `${label}: content is not covered by another layer`);
    }
    if (layout.button) {
      assert.equal(layout.button.position, 'absolute');
      assert.equal(layout.button.width, '52px');
      assert.equal(layout.button.height, '52px');
      assert.equal(layout.button.iconWidth, '24px');
      assert.equal(layout.button.pointerEvents, 'none');
      await page.waitForFunction(id => getComputedStyle(document.querySelector(`#${id} > .ppt-images-scroll-top`)).opacity === '0', overlayId);
      const button = page.locator(`#${overlayId} > .ppt-images-scroll-top`);
      await button.evaluate(node => node.classList.add('visible'));
      await page.waitForFunction(id => getComputedStyle(document.querySelector(`#${id} > .ppt-images-scroll-top`)).opacity === '1', overlayId);
      assert.equal(await button.evaluate(node => getComputedStyle(node).pointerEvents), 'auto');
      await button.hover();
      assert.equal(await page.locator(`#${overlayId} > .pdf-merge-v2-body`).evaluate(node => node.getBoundingClientRect().height), layout.body.height);
      await button.evaluate(node => node.classList.remove('visible'));
      await page.waitForFunction(id => getComputedStyle(document.querySelector(`#${id} > .ppt-images-scroll-top`)).opacity === '0', overlayId);
    }
    if (page.viewportSize().width <= 980) {
      const workspace = page.locator(`#${overlayId} .pdf-merge-v2-workspace`);
      assert.ok(layout.workspace.height >= 400, `${label}: stacked workspace must not collapse in short windows`);
      const action = workspace.locator('button:not([disabled])').first();
      await action.scrollIntoViewIfNeeded();
      await action.click({ trial: true });
      const reached = await action.evaluate(node => {
        const box = node.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, hit: node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
      });
      assert.ok(reached.top >= layout.header.bottom && reached.bottom <= page.viewportSize().height, `${label}: action scrolls into the usable viewport`);
      assert.equal(reached.hit, true, `${label}: scrolled action is not covered`);
      await page.screenshot({ path: path.join(output, `${label}-workspace.png`) });
    }
    console.log(`PASS ${label}`);
  };
  for (const profile of profiles) {
    for (const tool of tools) {
      const { page, errors } = await configurePage({ width: profile.width, height: profile.height }, profile.custom);
      const label = `cold-${tool[0]}-${profile.width}x${profile.height}-${profile.custom ? 'custom' : 'default'}`;
      try {
        await open(page, tool);
        await check(page, tool[1], label, profile.custom);
        if (tool[0] === 'ppt-draft') await page.screenshot({ path: path.join(output, `${label}.png`) });
        await close(page, tool[1]);
        assert.deepEqual(errors, [], `${label}: no runtime or focus errors`);
      } catch (error) {
        await page.screenshot({ path: path.join(output, `${label}-failed.png`) });
        throw error;
      } finally { await page.close(); }
    }
  }
  const PptxGen = require('pptxgenjs');
  const ppt = new PptxGen();
  const slide = ppt.addSlide();
  slide.addText('Narrow window export regression', { x: 1, y: 1, w: 7, h: 1 });
  slide.addImage({ data: 'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', x: 1, y: 3, w: 1, h: 1 });
  const pptFile = { name: 'narrow-regression.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(await ppt.write({ outputType: 'nodebuffer' })) };
  for (const [id, prefix] of [['ppt-text', 'pptText'], ['ppt-compress', 'pptCompress'], ['ppt-images', 'pptImages']]) {
    const { page, errors } = await configurePage({ width: 720, height: 480 }, false);
    const label = `loaded-${id}-720x480`;
    try {
      await open(page, [id, `${prefix}Overlay`]);
      await page.locator(`#${prefix}FileInput`).setInputFiles(pptFile);
      const action = page.locator(`#${prefix}ExportBtn`);
      await page.waitForFunction(id => !document.getElementById(id).disabled, `${prefix}ExportBtn`);
      await action.scrollIntoViewIfNeeded();
      await action.click({ trial: true });
      const box = await action.boundingBox();
      const header = await page.locator(`#${prefix}Overlay > header`).boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 720 && box.y >= header.y + header.height && box.y + box.height <= 480, `${label}: export fits below navigation without horizontal clipping`);
      assert.deepEqual(errors, []);
      report.push({ label, export: box });
      console.log(`PASS ${label}`);
    } finally {
      await page.screenshot({ path: path.join(output, `${label}.png`) });
      await page.close();
    }
  }
  const { page, errors } = await configurePage({ width: 1400, height: 888 }, true);
  try {
    await open(page, tools.at(-1));
    await close(page, tools.at(-1)[1]);
    for (const tool of tools) {
      await open(page, tool);
      await check(page, tool[1], `after-images-${tool[0]}`, true);
      await close(page, tool[1]);
    }
    await page.reload();
    await open(page, tools[0]);
    await check(page, tools[0][1], 'reload-draft', true);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#pptDraftOverlay:not(.visible)', { state: 'attached' });
    await open(page, tools[0]);
    await check(page, tools[0][1], 'reopen-draft', true);
    assert.deepEqual(errors, [], 'warm/reload/reopen: no runtime or focus errors');
  } finally { await page.close(); }
  console.log(`PPT cold layout regression passed: ${report.length} page checks`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
