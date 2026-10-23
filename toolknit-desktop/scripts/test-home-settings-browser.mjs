import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/home-settings-browser');
await mkdir(output, { recursive: true });
const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await chromium.launch({ headless: true,
  ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const settle = () => page.waitForFunction(() => {
  const veil = document.querySelector('[data-tk-page-transition-veil]');
  return !veil || getComputedStyle(veil).visibility === 'hidden';
});
const newTools = ['clipboard-history', 'duplicate-file-cleanup', 'image-to-pdf', 'pdf-to-scan', 'pdf-to-word', 'quick-screenshot'];
const visibleTools = () => page.locator('#homeToolGrid [data-home-tool]').evaluateAll(nodes => nodes.map(node => node.dataset.homeTool).sort());
const checkNewFeatures = async () => {
  const chip = page.locator('[data-home-category="new"]');
  await chip.focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await visibleTools(), newTools);
  assert.equal(await chip.getAttribute('aria-pressed'), 'true');
  assert.equal(await chip.locator('svg').count(), 1, 'new category uses a rendered icon');
  assert.equal(await page.locator('#homeToolLoadMore').evaluate(node => node.hidden), true);
  await page.locator('#homeToolSearch').fill('PDF');
  assert.deepEqual(await visibleTools(), ['image-to-pdf', 'pdf-to-scan', 'pdf-to-word']);
  await page.locator('#homeToolSearch').fill('no-matching-tool-123');
  assert.equal(await page.locator('#homeToolGrid .tool-result-empty').count(), 1);
  await page.locator('#homeToolSearch').fill('');
  for (const [category, ids] of [['pdf', ['image-to-pdf', 'pdf-to-scan', 'pdf-to-word']], ['creative', ['quick-screenshot']],
    ['hardware', ['clipboard-history']], ['clean', ['duplicate-file-cleanup']]]) {
    await page.locator(`[data-home-category="${category}"]`).click();
    const actual = await visibleTools();
    for (const id of ids) assert.ok(actual.includes(id), `${id} remains in ${category}`);
  }
  await chip.click();
  await page.locator('#homeToolGrid [data-home-tool="pdf-to-word"]').click();
  await page.waitForSelector('#pdfWordOverlay.visible');
  await settle();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#pdfWordOverlay').inert);
  await settle();
  assert.deepEqual(await visibleTools(), newTools, 'returning from a tool preserves the discovery filter');
  await page.locator('[data-home-category="all"]').click();
  assert.equal(await page.locator('#homeToolGrid .tool-result-card').count(), 12);
};
const checkSupport = async (background, trigger, exit = 'escape') => {
  await page.locator(trigger).click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#donationOverlay')).opacity === '1');
  assert.equal(await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('#donationOverlay')?.id), 'donationOverlay', 'support is above the current page');
  assert.equal(await page.locator(background).evaluate(n => n.inert), true, 'background is suspended');
  await page.locator('#donationOverlay').screenshot({ path: path.join(output, `support-${background.replace(/[^a-z0-9]/gi, '')}-${await page.locator('html').getAttribute('data-theme')}.png`) });
  if (exit === 'escape') await page.keyboard.press('Escape');
  else if (exit === 'settings') { await page.locator('#donationV2Settings').click(); await settle(); }
  else await page.locator('#donationOverlay [data-donation-close]').last().click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#donationOverlay')).opacity === '0');
  assert.equal(await page.locator(background).evaluate(n => n.inert), false, 'background input is restored');
  assert.equal(await page.locator('#donationOverlay').evaluate(n => n.inert && n.style.zIndex === ''), true, 'support session is released');
};
try {
  await page.addInitScript(() => {
    localStorage.setItem('toolknit_favorites', JSON.stringify([{tool:'quick-screenshot',name:'Quick Screenshot',category:'ai',ts:1}]));
    window.__copied = [];
    window.__links = [];
    Object.defineProperty(navigator, 'clipboard', { value: {
      writeText: async text => { window.__copied.push(text); }
    } });
    window.open = url => { window.__links.push(url); return null; };
  });
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => !document.documentElement.dataset.tkStartup && document.querySelector('#homeCustomTools') && !document.querySelector('.app').inert);
  assert.equal(await page.locator('#homeToolGrid .tool-result-card').count(), 12);
  assert.deepEqual(await page.locator('#homeCategoryStrip [data-home-category]').evaluateAll(nodes => nodes.map(node => node.dataset.homeCategory)),
    ['all', 'new', 'pdf', 'ppt', 'image', 'media', 'text', 'calc', 'creative', 'ai', 'hardware', 'developer', 'clean']);
  assert.equal(await page.locator('.content-section[data-category="creative"] [data-tool]').count(), 4);
  assert.equal(await page.locator('.content-section[data-category="ai"] [data-tool]').count(), 5);
  assert.equal(await page.locator('.content-section[data-category="creative"] [data-tool="quick-screenshot"]').count(), 1);
  assert.equal(await page.locator('#favoritesContent [data-tool="quick-screenshot"]').getAttribute('data-category'), 'creative', 'existing favorites follow the current category without changing their tool ID');
  for (const theme of ['light', 'dark']) {
    await page.locator('#homeV2Settings').click();
    await settle();
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    await settle();
    assert.equal(await page.locator('#autostartToggle').isDisabled(), true, 'browser cannot enable Windows startup');
    // Browser-only visual regression: native read/write is covered by runtime tests.
    await page.locator('#autostartToggle').evaluate(n => n.setAttribute('aria-pressed', 'true'));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#autostartToggle'), '::before').transform === 'matrix(1, 0, 0, 1, 26, 0)');
    await page.locator('#autostartToggle').evaluate(n => n.setAttribute('aria-pressed', 'false'));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#autostartToggle'), '::before').transform === 'none');
    await checkSupport('#settingsOverlay', '#settingsOverlay .tk-nav-support');
    assert.equal(await page.locator('#settingsOverlay').evaluate(n => n.classList.contains('visible')), true);
    await checkSupport('#settingsOverlay', '#settingsOverlay .tk-nav-support', 'close');
    await checkSupport('#settingsOverlay', '#settingsOverlay .tk-nav-support', 'settings');
    await page.locator('#homeLazyLoadToggle').click();
    assert.equal(await page.locator('#homeLazyLoadToggle').getAttribute('aria-pressed'), 'false');
    const total = await page.locator('.content-section:not([data-category="home"]) .audio-list-item:not([data-availability="planned"])').count();
    assert.equal(await page.locator('#homeToolGrid .tool-result-card').count(), total);
    assert.equal(await page.locator('#homeToolLoadMore').evaluate(n => n.hidden), true);
    await page.reload();
    await page.waitForFunction(() => !document.documentElement.dataset.tkStartup && !document.querySelector('.app').inert);
    assert.equal(await page.locator('#homeToolGrid .tool-result-card').count(), total);
    await page.locator('#homeV2Settings').click();
    await settle();
    assert.equal(await page.locator('#homeLazyLoadToggle').getAttribute('aria-pressed'), 'false');
    await page.locator('#homeLazyLoadToggle').click();
    assert.equal(await page.locator('#homeToolGrid .tool-result-card').count(), 12);
    for (const exit of ['back', 'settings', 'escape']) {
      await page.locator('#settingsApiKey').click();
      await page.waitForSelector('#apiKeyOverlay.visible');
      await settle();
      assert.equal(await page.locator('#settingsOverlay').evaluate(n => n.classList.contains('visible')), false);
      const nav = page.locator('#apiKeyOverlay .tk-tool-nav');
      assert.match(await nav.locator('.tk-nav-tag').innerText(), /AI KEY SETTINGS.*3\.2/);
      for (const role of ['web', 'support', 'settings', 'minimize', 'maximize', 'close']) {
        assert.equal(await nav.locator(`.tk-nav-${role}`).isVisible(), true, `${role} visible`);
      }
      await checkSupport('#apiKeyOverlay', '#apiKeyOverlay .tk-nav-support');
      if (exit === 'back') await page.locator('#apiKeyBack').click();
      else if (exit === 'settings') await nav.locator('.tk-nav-settings').click();
      else await page.keyboard.press('Escape');
      await settle();
      await page.waitForSelector('#settingsOverlay.visible');
      assert.equal(await page.locator('#apiKeyOverlay').evaluate(n => n.inert && !n.classList.contains('visible')), true);
    }
    await page.locator('#settingsBack').click();
    await settle();
    await checkNewFeatures();
    await checkSupport('.app', '.app .home-v2-topbar [data-open-support]');
    const malian = page.locator('.home-provider-malian');
    const doufu = page.locator('.home-provider-doufu');
    assert.equal(await malian.getAttribute('href'), 'https://www.mlai.online/register?aff=5Q2VVMD7YJVB');
    assert.equal(await doufu.getAttribute('href'), 'https://doufuapi.com/register?aff=TWKCBH9RGLN3');
    assert.notEqual(await malian.evaluate(n => getComputedStyle(n).color), await doufu.evaluate(n => getComputedStyle(n).color));
    await malian.click();
    await doufu.click();
    assert.equal(await page.evaluate(() => window.__links.length), 2, 'provider links use the shared opener after reload');
    for (const selector of ['.hero-actions [data-home-link="website"]', '.home-weaving-link']) {
      const button = page.locator(selector);
      for (let cycle = 0; cycle < 3; cycle++) {
        await button.hover();
        await page.waitForFunction(sel => getComputedStyle(document.querySelector(`${sel} .tk-nav-alternate`)).opacity === '1', selector);
        assert.match(await button.locator('.tk-nav-morph').evaluate(n => getComputedStyle(n).display), /^(inline-)?grid$/);
        const alternate = await button.locator('.tk-nav-alternate').boundingBox();
        const slot = await button.locator('.tk-nav-morph').boundingBox();
        assert.ok(Math.abs(alternate.x + alternate.width / 2 - slot.x - slot.width / 2) < 1 && Math.abs(alternate.y + alternate.height / 2 - slot.y - slot.height / 2) < 1, 'morphed icon remains centered');
        await page.mouse.move(0, 250);
        await page.waitForFunction(sel => getComputedStyle(document.querySelector(`${sel} .tk-nav-alternate`)).opacity === '0', selector);
      }
    }
    for (const exit of ['close', 'escape', 'copy']) {
      await page.locator('#homeCustomTools').click();
      await page.waitForSelector('#customToolsOverlay.visible');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#customToolsOverlay')).opacity === '1');
      assert.equal(await page.locator('.app').evaluate(n => n.inert), true);
      assert.equal(await page.locator('#customToolsDescription').evaluate(n => n.scrollHeight <= n.clientHeight), true, 'complete description is visible');
      assert.equal(await page.locator('#customToolsOverlay .audio-convert-success-dialog').evaluate(n => getComputedStyle(n).backgroundColor), theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(24, 24, 27)');
      if (exit === 'copy') {
        await page.locator('#customToolsCopy').click();
        await page.waitForFunction(() => window.__copied.includes('wunanvip6'));
        await page.locator('#customToolsOverlay').screenshot({ path: path.join(output, `custom-${theme}.png`) });
      }
      if (exit === 'escape') await page.keyboard.press('Escape');
      else await page.locator('#customToolsClose').click();
      await page.waitForFunction(() => !document.querySelector('#customToolsOverlay').classList.contains('visible'));
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#customToolsOverlay')).opacity === '0');
      assert.equal(await page.locator('.app').evaluate(n => n.inert), false);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'homeCustomTools');
    }
    await page.locator('[data-home-category="new"]').click();
    for (const width of [1440, 1100, 1024, 720, 640]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 640 });
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${theme} ${width} no document overflow`);
      assert.deepEqual(await visibleTools(), newTools);
      assert.equal(await page.locator('#homeToolGrid .tool-result-card:visible').count(), 5);
      await page.locator('#homeToolGrid').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `home-${theme}-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-home-category="all"]').click();
    console.log(`PASS ${theme}: startup switch, persisted home batching, support layering/focus, centered reversible morph, AI navigation, responsive homepage`);
  }
  await page.locator('#homeV2Settings').click();
  await settle();
  await page.locator('[data-lang="en"]').click();
  await page.locator('#settingsBack').click();
  await settle();
  assert.equal(await page.locator('[data-i18n="home.categoryNew"]').innerText(), 'New in V3.2');
  await checkNewFeatures();
  await page.locator('#homeCustomTools').click();
  assert.equal(await page.locator('#customToolsTitle').innerText(), 'Tools tailored to your work');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__links.length), 2, 'provider links use the shared opener');
  assert.deepEqual(errors, [], 'no uncaught application errors');
  console.log('PASS English and external-link dispatch');
} finally {
  await browser.close();
  await server.httpServer.close();
}
