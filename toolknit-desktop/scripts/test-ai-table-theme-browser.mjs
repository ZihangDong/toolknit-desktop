import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { preview } from 'vite';
import { AI_TABLE_DEMO_DATA } from '../src/features/ai-table/prompts.js';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/ai-table-theme');
const apiUrl = 'https://ai-table-theme.test/v1/chat/completions';
const fixture = structuredClone(AI_TABLE_DEMO_DATA);
fixture.charts = ['bar', 'line', 'pie'].map(type => ({ ...fixture.charts[0], type, title: `Synthetic ${type}` }));
const viewports = [
  { width: 1400, height: 900 }, { width: 1280, height: 720 },
  { width: 1100, height: 760 }, { width: 900, height: 700 }, { width: 720, height: 640 }
];
const textSelectors = [
  '.ai-table-v2-card-head h2', '.ai-table-v2-card-head p', '.ai-table-v2-feature-grid span',
  '.ai-doc-chat-bubble', '.ai-doc-chip-title', '.ai-doc-prompt-chip', '.ai-table-v2-input-helper span',
  '.ai-doc-chat-input', '.ai-doc-chat-send span', '.ai-doc-canvas-empty p', '.ai-table-empty-guide-item span',
  '.ai-doc-pill-btn span', '.ai-table-title', '.ai-table-edit-guide-title', '.ai-table-edit-guide-text',
  '.ai-table-preview-stats', '.ai-table-guide-link span', '.ai-table-grid th span', '.ai-table-grid td[data-col-idx]',
  '.ai-table-add-btn span', '.ai-table-chart-title', '.home-v2-support-top span',
  '#aiTableMask .audio-convert-process-text', '#aiTableSuccessOverlay .audio-clip-success-title',
  '#aiTableSuccessOverlay .audio-convert-success-key', '#aiTableSuccessOverlay .audio-convert-success-value',
  '#aiTableSuccessOverlay button'
];

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
}

async function readable(page) {
  await settle(page);
  const failures = await page.locator(textSelectors.map(selector => selector.startsWith('#')
    ? selector : `#aiTableOverlay ${selector}`).join(',')).evaluateAll(nodes => {
    const rgba = value => (value.match(/[\d.]+/g) || []).map(Number);
    const blend = (front, back) => front.slice(0, 3).map((value, i) =>
      value * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
    const luminance = rgb => rgb.reduce((total, value, i) => {
      const channel = value / 255;
      return total + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
        * [0.2126, 0.7152, 0.0722][i];
    }, 0);
    return nodes.filter(node => node.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      && !node.closest('#aiTableMask:not(.visible), #aiTableSuccessOverlay:not(.visible)')
      && (node.textContent.trim() || node.value)).flatMap(node => {
      const chain = [];
      for (let parent = node; parent; parent = parent.parentElement) chain.unshift(parent);
      const background = chain.reduce((color, element) => blend(rgba(getComputedStyle(element).backgroundColor), color), [255, 255, 255]);
      const foreground = blend(rgba(getComputedStyle(node).color), background);
      const [hi, lo] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      const contrast = (hi + 0.05) / (lo + 0.05);
      return contrast >= 4.5 ? [] : [{ node: node.id || node.className, parent: node.parentElement.className, contrast }];
    });
  });
  assert.deepEqual(failures, [], 'light workbench text must be readable in every state');
}

async function fits(page) {
  const issues = await page.locator('#aiTableOverlay').evaluate(root => {
    const issues = [];
    for (const panel of root.querySelectorAll('.ai-table-v2-chat-card, .ai-table-v2-preview-card')) {
      const outer = panel.getBoundingClientRect();
      if (outer.right > innerWidth + 1 || outer.left < -1) issues.push({ panel: panel.id, reason: 'outside viewport' });
      for (const node of panel.querySelectorAll('button, textarea, .ai-table-edit-guide, .ai-table-title, .ai-table-chart-wrap')) {
        if (!node.checkVisibility() || node.closest('.ai-table-wrap')) continue;
        const rect = node.getBoundingClientRect();
        if (rect.left < outer.left - 1 || rect.right > outer.right + 1) issues.push({ node: node.id || node.className });
      }
    }
    const preview = root.querySelector('#aiTablePreviewScroll');
    if (preview.checkVisibility() && preview.scrollWidth > preview.clientWidth + 1) issues.push({ reason: 'preview has horizontal overflow' });
    return issues;
  });
  assert.deepEqual(issues, [], 'only the table and chart should scroll horizontally');
}

async function openTool(page) {
  await page.locator('.audio-list-item[data-tool="ai-table"]').evaluate(node => node.click());
  await page.locator('#aiTableOverlay.visible').waitFor();
  await settle(page);
}

async function chartsReady(page) {
  await page.waitForFunction(() => {
    const canvases = [...document.querySelectorAll('#aiTablePreviewScroll canvas')];
    return canvases.length === 3 && canvases.every(canvas => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 0; i < data.length; i += 16) if (data[i + 3] && data[i] < 220) ink++;
      return ink > 100;
    });
  });
}

await mkdir(output, { recursive: true });
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, open: false } });
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: viewports[0], reducedMotion: 'reduce' });
    const errors = [];
    let releaseResponse;
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ theme, apiUrl }) => {
      localStorage.setItem('toolknit.theme.v3', theme);
      localStorage.setItem('ai_platform', 'custom');
      localStorage.setItem('ai_custom_url', apiUrl);
      localStorage.setItem('ai_custom_model', 'table-theme-fixture');
      localStorage.setItem('ai_api_key', 'local-theme-fixture-not-a-real-key');
    }, { theme, apiUrl });
    await page.route('https://api.github.com/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
    await page.route(apiUrl, async route => {
      await new Promise(resolve => { releaseResponse = resolve; });
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{
        finish_reason: 'stop', message: { content: JSON.stringify(fixture) }
      }] }) }).catch(() => {});
    });
    try {
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
      await openTool(page);
      assert.equal(await page.locator('#aiTableChatSend').isDisabled(), true);
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        if (theme === 'light') await readable(page);
        await fits(page);
        await page.screenshot({ path: path.join(output, `${theme}-empty-${viewport.width}.png`) });
      }
      await page.setViewportSize(viewports[0]);
      await page.locator('.ai-table-v2 .ai-doc-prompt-chip').first().hover();
      if (theme === 'light') await readable(page);
      await page.locator('.ai-table-v2 .ai-doc-prompt-chip').first().click();
      assert.equal(await page.locator('#aiTableChatSend').isEnabled(), true);
      await page.locator('#aiTableChatInput').fill('Generate a synthetic table with three charts.');
      await page.locator('#aiTableChatSend').click();
      await page.locator('#aiTableMask.visible').waitFor();
      if (theme === 'light') await readable(page);
      await page.screenshot({ path: path.join(output, `${theme}-processing.png`) });
      assert.ok(releaseResponse);
      releaseResponse();
      releaseResponse = null;
      await page.locator('#aiTableMask').waitFor({ state: 'hidden' });
      await chartsReady(page);
      const cell = page.locator('.ai-table-grid tbody tr').first().locator('td[data-col-idx="1"]');
      await cell.click();
      await cell.fill('123');
      if (theme === 'light') await readable(page);
      await page.screenshot({ path: path.join(output, `${theme}-editing.png`) });
      await cell.press('Escape');
      assert.equal(await cell.innerText(), '123');
      assert.equal(await page.locator('#aiTableUndoBtn').isEnabled(), true);
      await page.locator('#aiTableUndoBtn').click();
      assert.equal(await cell.innerText(), String(fixture.rows[0][1]));
      assert.equal(await page.locator('#aiTableUndoBtn').isDisabled(), true);
      await page.locator('.ai-table-title').click();
      await page.locator('.ai-table-title').fill('Synthetic editable table');
      await page.locator('.ai-table-title').press('Escape');
      assert.equal(await page.locator('.ai-table-title').innerText(), 'Synthetic editable table');
      await page.locator('.ai-table-grid th[data-col-idx="1"]').click();
      assert.equal(await cell.innerText(), '65');
      await page.locator('#aiTableUndoBtn').click();
      await page.locator('.ai-table-add-btn').first().click();
      assert.equal(await page.locator('.ai-table-grid tbody tr').count(), 4);
      await page.locator('.ai-table-del-btn').last().click();
      assert.equal(await page.locator('.ai-table-grid tbody tr').count(), 3);
      await page.locator('.ai-table-add-btn').last().click();
      assert.equal(await page.locator('.ai-table-grid th[data-col-idx]').count(), 4);
      await page.locator('.ai-table-col-delete').last().click();
      assert.equal(await page.locator('.ai-table-grid th[data-col-idx]').count(), 3);
      await chartsReady(page);
      const chartPixels = await page.locator('.ai-table-chart-canvas').evaluateAll(nodes => nodes.map(canvas => canvas.toDataURL()));
      await page.evaluate(theme => document.documentElement.dataset.theme = theme === 'light' ? 'dark' : 'light', theme);
      assert.deepEqual(await page.locator('.ai-table-chart-canvas').evaluateAll(nodes => nodes.map(canvas => canvas.toDataURL())), chartPixels);
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        if (theme === 'light') await readable(page);
        await fits(page);
        await page.locator('#aiTableCanvasToolbar').scrollIntoViewIfNeeded();
        await settle(page);
        await page.screenshot({ path: path.join(output, `${theme}-result-${viewport.width}.png`) });
      }
      await page.setViewportSize(viewports[0]);
      await page.locator('.ai-table-chart-title').last().scrollIntoViewIfNeeded();
      await settle(page);
      await page.screenshot({ path: path.join(output, `${theme}-charts.png`) });
      for (const selector of ['#aiTableUndoBtn', '#aiTableResetBtn', '[data-fmt="png"]', '.ai-table-add-btn']) {
        await page.locator(selector).first().hover();
        if (theme === 'light') await readable(page);
      }
      for (const format of ['csv', 'xlsx', 'png', 'pdf']) {
        const downloadPromise = page.waitForEvent('download');
        await page.locator(`#aiTableCanvasToolbar [data-fmt="${format}"]`).click();
        const download = await downloadPromise;
        const bytes = await readFile(await download.path());
        assert.ok(bytes.length > 30);
        if (format === 'csv') assert.match(bytes.toString('utf8'), /100/);
        if (format === 'xlsx') assert.equal(bytes.subarray(0, 2).toString(), 'PK');
        if (format === 'png') assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
        if (format === 'pdf') assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
      }
      // Native-only dialog appearance is checked with a local fixture.
      await page.evaluate(() => {
        document.getElementById('aiTableSuccessPath').textContent = 'D:/Theme-fixture/output/'.repeat(7) + 'table.xlsx';
        document.getElementById('aiTableSuccessOverlay').classList.add('visible');
      });
      if (theme === 'light') await readable(page);
      await page.screenshot({ path: path.join(output, `${theme}-success.png`) });
      await page.locator('#aiTableSuccessOk').click();
      await page.locator('#aiTableResetBtn').click();
      assert.equal(await page.locator('#aiTableCanvasEmpty').isVisible(), true);
      await page.keyboard.press('Escape');
      await page.locator('#aiTableOverlay').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#aiTableOverlay').evaluate(node => node.contains(document.activeElement)), false);
      await openTool(page);
      assert.equal(await page.locator('#aiTableChatInput').inputValue(), '');
      await page.evaluate(() => localStorage.setItem('toolknit-lang', 'en'));
      await page.reload();
      await openTool(page);
      if (theme === 'light') await readable(page);
      await fits(page);
      assert.deepEqual(errors, []);
      console.log(`PASS AI table ${theme}: contrast, five viewports, edits, sorting, undo, charts, exports and reopen`);
    } catch (error) {
      await page.screenshot({ path: path.join(output, `${theme}-failure.png`) });
      throw error;
    } finally {
      releaseResponse?.();
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
