import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { preview } from 'vite';
import { AI_DOC_EDITOR_DEMO_LAYOUT } from '../src/features/ai-document/prompts.js';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/ai-document-theme');
const apiUrl = 'https://ai-document-theme.test/v1/chat/completions';
const viewports = [
  { width: 1400, height: 900 }, { width: 1100, height: 760 },
  { width: 900, height: 700 }, { width: 720, height: 640 }
];
const textSelectors = [
  '.ai-doc-v2-card-head h2', '.ai-doc-v2-card-head p', '.ai-doc-v2-capability-grid span',
  '.ai-doc-chat-bubble', '.ai-doc-chip-title', '.ai-doc-prompt-chip', '.ai-doc-v2-input-helper span',
  '.ai-doc-chat-input', '.ai-doc-chat-send span', '.ai-doc-canvas-empty p', '.ai-doc-v2-empty-guide span',
  '.ai-doc-pill-btn span', '.ai-doc-edit-preview-head h2', '.ai-doc-edit-preview-head p',
  '.ai-doc-edit-side-card-head h3', '.ai-doc-edit-side-card-head > span', '.ai-doc-edit-selection-status',
  '.ai-doc-edit-icon-btn span', '.ai-doc-style-number > span', '.ai-doc-style-number input',
  '.ai-doc-color-control em', '.ai-doc-global-style-group select', '.ai-doc-global-style-apply',
  '.ai-doc-style-inspector label', '.ai-doc-style-inspector output', '.ai-doc-style-inspector-title',
  '#aiDocEditOverlay .home-v2-support-top span', '#aiDocMask .audio-convert-process-text',
  '#aiDocSuccessOverlay .audio-clip-success-title', '#aiDocSuccessOverlay .audio-convert-success-key',
  '#aiDocSuccessOverlay .audio-convert-success-value', '#aiDocSuccessOverlay .audio-clip-success-btn'
].join(',');

async function readable(page) {
  await settle(page);
  const failures = await page.locator(textSelectors).evaluateAll(nodes => {
    const rgba = text => (text.match(/[\d.]+/g) || []).map(Number);
    const blend = (front, back) => front.slice(0, 3).map((value, i) =>
      value * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
    const luminance = rgb => rgb.reduce((total, value, i) => {
      const channel = value / 255;
      return total + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
        * [0.2126, 0.7152, 0.0722][i];
    }, 0);
    return nodes.filter(node => node.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      && !node.closest('#aiDocMask:not(.visible), #aiDocSuccessOverlay:not(.visible)')
      && (node.textContent.trim() || node.value)).flatMap(node => {
      const chain = [];
      for (let parent = node; parent; parent = parent.parentElement) chain.unshift(parent);
      const background = chain.reduce((color, element) => blend(rgba(getComputedStyle(element).backgroundColor), color), [255, 255, 255]);
      const foreground = blend(rgba(getComputedStyle(node).color), background);
      const [hi, lo] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      const contrast = (hi + 0.05) / (lo + 0.05);
      return contrast >= 4.5 ? [] : [{ node: node.id || node.getAttribute('data-i18n') || node.className,
        parent: node.parentElement.className, contrast }];
    });
  });
  assert.deepEqual(failures, [], 'light controls and messages need readable contrast');
}

async function fits(page, selector) {
  const issues = await page.locator(selector).evaluate(root => {
    const selectors = ['.ai-doc-v2-chat-card', '.ai-doc-v2-preview-card', '.ai-doc-edit-side-card'];
    return [...root.querySelectorAll(selectors.join(','))].filter(node => node.checkVisibility()).flatMap(card => {
      const box = card.getBoundingClientRect();
      return [...card.querySelectorAll('button, input:not([type="color"]), select, textarea')]
        .filter(node => node.checkVisibility()).flatMap(node => {
          const rect = node.getBoundingClientRect();
          return rect.left >= box.left - 1 && rect.right <= box.right + 1
            ? [] : [{ node: node.id || node.className, card: card.className }];
        });
    });
  });
  assert.deepEqual(issues, [], 'controls must fit their owning panel');
}

async function openTool(page) {
  await page.locator('.audio-list-item[data-tool="ai-doc"]').evaluate(node => node.click());
  await page.locator('#aiDocOverlay.visible').waitFor();
  await settle(page);
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
}

async function documentColors(page) {
  return page.locator('#aiDocEditScroll .ai-doc-region-text').evaluateAll(nodes => nodes.map(node => {
    const text = getComputedStyle(node), region = getComputedStyle(node.parentElement);
    const visibleBorders = style => ['Top', 'Right', 'Bottom', 'Left'].map(side =>
      parseFloat(style[`border${side}Width`]) > 0 && !['none', 'hidden'].includes(style[`border${side}Style`])
        ? style[`border${side}Color`] : null);
    return { color: text.color, background: region.backgroundColor,
      borders: [visibleBorders(region), visibleBorders(text)] };
  }));
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
      localStorage.setItem('ai_custom_model', 'document-theme-fixture');
      localStorage.setItem('ai_api_key', 'local-theme-fixture-not-a-real-key');
    }, { theme, apiUrl });
    await page.route('https://api.github.com/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
    await page.route(apiUrl, async route => {
      await new Promise(resolve => { releaseResponse = resolve; });
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{
        finish_reason: 'stop', message: { content: JSON.stringify(AI_DOC_EDITOR_DEMO_LAYOUT) }
      }] }) }).catch(() => {});
    });
    try {
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
      await openTool(page);
      assert.equal(await page.locator('#aiDocChatSend').isDisabled(), true);
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        if (theme === 'light') await readable(page);
        await fits(page, '#aiDocOverlay');
        await page.screenshot({ path: path.join(output, `${theme}-empty-${viewport.width}.png`) });
      }
      await page.setViewportSize(viewports[0]);
      await page.locator('.ai-doc-prompt-chip').first().click();
      assert.equal(await page.locator('#aiDocChatSend').isEnabled(), true);
      await page.locator('#aiDocChatInput').fill('Create a synthetic document for local theme verification.');
      await page.locator('#aiDocChatSend').click();
      await page.locator('#aiDocMask.visible').waitFor();
      await settle(page);
      if (theme === 'light') await readable(page);
      await page.screenshot({ path: path.join(output, `${theme}-processing.png`) });
      assert.ok(releaseResponse, 'the local provider fixture must receive the request');
      releaseResponse();
      releaseResponse = null;
      await page.locator('.ai-doc-gen-link').waitFor();
      await page.locator('#aiDocMask').waitFor({ state: 'hidden' });
      assert.ok(await page.locator('.ai-doc-thumb').count() > 0);
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        if (theme === 'light') await readable(page);
        await fits(page, '#aiDocOverlay');
        await page.screenshot({ path: path.join(output, `${theme}-result-${viewport.width}.png`) });
      }
      await page.setViewportSize(viewports[0]);
      await page.locator('#aiDocOpenEditorBtn').click();
      await page.locator('#aiDocEditOverlay.visible').waitFor();
      await settle(page);
      assert.equal(await page.locator('#aiDocBoldBtn').isDisabled(), true);
      if (theme === 'light') await readable(page);
      await page.screenshot({ path: path.join(output, `${theme}-editor-idle.png`) });
      const contentBefore = await documentColors(page);
      assert.ok(contentBefore.length > 0);
      // Swap the theme only, so document content equality is independent of generation.
      await page.evaluate(theme => document.documentElement.dataset.theme = theme === 'light' ? 'dark' : 'light', theme);
      assert.deepEqual(await documentColors(page), contentBefore, 'application themes must not recolor the document');
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await page.locator('#aiDocEditScroll .ai-doc-region[data-region-type="title"]').first().click();
      assert.equal(await page.locator('#aiDocBoldBtn').isEnabled(), true);
      await page.locator('#aiDocAlignCenterBtn').click();
      assert.equal(await page.locator('#aiDocAlignCenterBtn').getAttribute('aria-pressed'), 'true');
      await page.locator('#aiDocAlignCenterBtn').hover();
      if (theme === 'light') await readable(page);
      await page.locator('#aiDocMoreStyleBtn').click();
      await page.locator('#aiDocStyleInspector.visible').waitFor();
      if (theme === 'light') await readable(page);
      await page.screenshot({ path: path.join(output, `${theme}-editor-detail.png`) });
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        if (theme === 'light') await readable(page);
        await fits(page, '#aiDocEditOverlay');
        const bounds = await page.evaluate(() => {
          const canvas = document.getElementById('aiDocEditScroll');
          canvas.scrollLeft = 0;
          const side = document.querySelector('.ai-doc-edit-side-panel');
          return { pageLeft: canvas.querySelector('.ai-doc-page').getBoundingClientRect().left,
            canvasLeft: canvas.getBoundingClientRect().left, sideOverflow: side.scrollHeight - side.clientHeight };
        });
        assert.ok(bounds.pageLeft >= bounds.canvasLeft - 1, 'the A4 left edge must remain reachable');
        if (viewport.width <= 1060) assert.ok(bounds.sideOverflow <= 1,
          'horizontal side panels must not clip controls through hidden vertical scrolling');
        await page.locator('#aiDocEditExportBtn').scrollIntoViewIfNeeded();
        await settle(page);
        await page.screenshot({ path: path.join(output, `${theme}-editor-${viewport.width}.png`) });
      }
      // The native-only success dialog uses a local fixture; no native file is written.
      await page.setViewportSize(viewports[0]);
      await page.evaluate(() => {
        document.getElementById('aiDocSuccessPath').textContent = 'D:/Theme-fixture/long-output-directory/'.repeat(4) + 'document.pdf';
        document.getElementById('aiDocSuccessOverlay').classList.add('visible');
      });
      await page.locator('#aiDocSuccessOverlay.visible').waitFor();
      if (theme === 'light') await readable(page);
      await page.screenshot({ path: path.join(output, `${theme}-success.png`) });
      await page.locator('#aiDocSuccessOk').click();
      await page.locator('#aiDocEditBack').click();
      await page.locator('#aiDocResetBtn').click();
      assert.equal(await page.locator('#aiDocCanvasEmpty').isVisible(), true);
      await page.keyboard.press('Escape');
      await page.locator('#aiDocOverlay').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#aiDocOverlay').evaluate(node => node.contains(document.activeElement)), false);
      await openTool(page);
      assert.equal(await page.locator('#aiDocChatInput').inputValue(), '');
      await page.locator('#aiDocBack').click();
      await page.evaluate(() => localStorage.setItem('toolknit-lang', 'en'));
      await page.reload();
      await page.setViewportSize(viewports[1]);
      await openTool(page);
      if (theme === 'light') await readable(page);
      await fits(page, '#aiDocOverlay');
      await page.screenshot({ path: path.join(output, `${theme}-english.png`) });
      assert.deepEqual(errors, []);
      console.log(`PASS AI document ${theme}: empty, processing, result, editor states, document colors, responsive layout, success fixture and reopen`);
    } finally {
      releaseResponse?.();
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
