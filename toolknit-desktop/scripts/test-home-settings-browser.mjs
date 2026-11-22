import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const releaseSeries = require('../package.json').version.split('.').slice(0, 2).join('.');
const browserRequire = process.env.TOOLKNIT_TEST_MODULES
  ? createRequire(path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json')) : require;
const { chromium } = browserRequire('playwright');
const output = path.resolve('tmp/home-settings-browser');
await mkdir(output, { recursive: true });
const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await chromium.launch({ headless: true,
  ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER }
    : process.platform === 'win32' ? { channel: 'msedge' } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const settle = () => page.waitForFunction(() => {
  const veil = document.querySelector('[data-tk-page-transition-veil]');
  return !veil || getComputedStyle(veil).visibility === 'hidden';
});
const newTools = ['batch-rename','clipboard-history','content-search','disk-space','document-compare','duplicate-file-cleanup','file-search','folder-automation','image-to-pdf','meeting-notes','ocr-editor','pdf-object-remove','pdf-to-ppt','pdf-to-scan','pdf-to-word','quick-launcher','quick-screenshot','subtitle-workbench','task-center','tool-workflows','word-to-pdf','xml-tools'];
const expandNewFeatures=async()=>{while(!await page.locator('#homeToolLoadMore').evaluate(node=>node.hidden))await page.locator('#homeToolLoadMoreButton').click();};
const visibleTools = () => page.locator('#homeToolGrid [data-home-tool]').evaluateAll(nodes => nodes.map(node => node.dataset.homeTool).sort());
const visibleReleaseGroups = () => page.locator('#homeToolGrid [data-release-version]').evaluateAll(nodes => nodes.map(node => node.dataset.releaseVersion));
const checkSponsorLayout = async () => {
  const row = page.locator('.tool-feedback-prompt');
  const promo = page.locator('.home-provider-promo');
  const action = page.locator('.tool-feedback-actions');
  assert.deepEqual(await page.locator('.hero-support-note [data-home-link]').evaluateAll(nodes => nodes.map(n => n.dataset.homeLink)), ['niuniu']);
  assert.deepEqual(await promo.locator('[data-home-link]').evaluateAll(nodes => nodes.map(n => n.dataset.homeLink)), ['doufu', 'malian', 'niuniu']);
  const overflow = await page.locator('.tool-feedback-prompt, .home-provider-promo, .tool-feedback-actions, .hero-support-note, .home-provider-links a, .home-provider-niuniu').evaluateAll(nodes =>
    nodes.filter(n => n.scrollWidth > n.clientWidth + 2).map(n => n.className));
  assert.deepEqual(overflow, [], 'sponsor/feedback content wraps without clipping');
  if (page.viewportSize().width >= 1100) {
    const r = await row.boundingBox(), p = await promo.boundingBox(), a = await action.boundingBox();
    assert(Math.abs(p.x - r.x) < 2 && p.x + p.width <= a.x + 2, 'sponsors occupy the left side of the feedback row');
    assert(Math.abs(a.x + a.width - r.x - r.width) < 2, 'the feature request stays aligned to the right');
    assert(Math.abs((p.y + p.height / 2) - (a.y + a.height / 2)) < 3, 'sponsors and feedback share one desktop row');
  }
  const theme = await page.locator('html').getAttribute('data-theme');
  const lang = await page.locator('html').getAttribute('lang');
  await row.screenshot({ path: path.join(output, `sponsors-${theme}-${lang}-${page.viewportSize().width}.png`) });
  if (page.viewportSize().width >= 1100) await page.locator('.hero-support-note').screenshot({ path: path.join(output, `primary-sponsor-${theme}-${lang}.png`) });
};
const checkNewFeatures = async () => {
  const chip = page.locator('[data-home-category="new"]');
  await chip.focus();
  await page.keyboard.press('Enter');
  await expandNewFeatures();
  assert.deepEqual(await visibleTools(), newTools);
  assert.deepEqual(await visibleReleaseGroups(), ['3.4', '3.3', '3.2'], 'release groups list newest first');
  assert.deepEqual(await page.locator('#homeToolGrid [data-release-version="3.4"] [data-home-tool]').evaluateAll(nodes => nodes.map(node => node.dataset.homeTool)), ['pdf-object-remove','pdf-to-ppt','ocr-editor','subtitle-workbench','meeting-notes','quick-launcher','content-search','document-compare','folder-automation','batch-rename','task-center','tool-workflows','disk-space','xml-tools']);
  assert.deepEqual(await page.locator('#homeToolGrid [data-release-version="3.3"] [data-home-tool]').evaluateAll(nodes => nodes.map(node => node.dataset.homeTool)), ['word-to-pdf', 'file-search']);
  assert.deepEqual(await page.locator('#homeToolGrid [data-release-version="3.2"] [data-home-tool]').evaluateAll(nodes => nodes.map(node => node.dataset.homeTool)),
    ['pdf-to-word', 'image-to-pdf', 'pdf-to-scan', 'quick-screenshot', 'duplicate-file-cleanup', 'clipboard-history']);
  assert.deepEqual(await page.locator('#homeToolGrid .tool-result-release-heading h3').allTextContents(), ['V3.4', 'V3.3', 'V3.2']);
  const english = (await page.locator('html').getAttribute('lang') || '').startsWith('en');
  assert.deepEqual(await page.locator('#homeToolGrid .tool-result-release-count').allTextContents(), english ? ['14 tools', '2 tools', '6 tools'] : ['14 项工具', '2 项工具', '6 项工具']);
  assert.equal(await chip.getAttribute('aria-pressed'), 'true');
  assert.equal(await chip.locator('svg').count(), 1, 'new category uses a rendered icon');
  assert.equal(await page.locator('#homeToolLoadMore').evaluate(node => node.hidden), true);
  const search = page.locator('#homeToolSearch'), clearSearch = page.locator('#homeToolSearchClear');
  assert.equal(await clearSearch.isHidden(), true, 'empty search hides the clear action');
  await search.fill('PDF');
  assert.equal(await clearSearch.isVisible(), true, 'query exposes the clear action');
  assert.deepEqual(await visibleTools(), ['content-search','image-to-pdf', 'pdf-object-remove', 'pdf-to-ppt', 'pdf-to-scan', 'pdf-to-word', 'tool-workflows', 'word-to-pdf']);
  await search.fill('no-matching-tool-123');
  assert.equal(await page.locator('#homeToolGrid .tool-result-empty').count(), 1);
  await clearSearch.focus(); await page.keyboard.press('Enter');
  assert.equal(await search.inputValue(), '', 'clear resets the query');
  assert.equal(await clearSearch.isHidden(), true, 'clear action hides after reset');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'homeToolSearch', 'focus returns to search');
  for (const [category, ids] of [['pdf', ['image-to-pdf', 'pdf-to-scan', 'pdf-to-word']], ['creative', ['quick-screenshot']],
    ['hardware', ['clipboard-history']], ['clean', ['duplicate-file-cleanup', 'file-search']]]) {
    await page.locator(`[data-home-category="${category}"]`).click();
    const actual = await visibleTools();
    for (const id of ids) assert.ok(actual.includes(id), `${id} remains in ${category}`);
  }
  await chip.click();
  await expandNewFeatures();
  await page.locator('#homeToolGrid [data-home-tool="word-to-pdf"]').click();
  await page.waitForSelector('#wordToPdfOverlay.visible');
  await settle();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#wordToPdfOverlay').inert);
  await settle();
  assert.deepEqual(await visibleTools(), newTools, 'returning from a tool preserves the discovery filter');
  await page.locator('[data-home-category="all"]').click();
  assert.equal(await page.locator('#homeToolGrid .tool-result-card').count(), 12);
  assert.equal(await page.locator('#transitionMask .tk-mascot-lg').evaluate(node => getComputedStyle(node).animationPlayState), 'paused', 'hidden transition must not run its sprite');
  assert.equal(await page.locator('#marqueeTrack').evaluate(node => getComputedStyle(node).animationPlayState), 'paused', 'hidden feedback must not run its wide marquee');
};
const checkSupport = async (background, trigger, exit = 'escape') => {
  await page.locator(trigger).click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#donationOverlay')).opacity === '1');
  assert.equal(await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('#donationOverlay')?.id), 'donationOverlay', 'support is above the current page');
  assert.equal(await page.locator(background).evaluate(n => n.inert), true, 'background is suspended');
  await page.waitForFunction(() => [...document.querySelectorAll('.donation-qr-card img')].every(n => n.complete && n.naturalWidth > 0));
  const englishSupport = (await page.locator('html').getAttribute('lang') || '').startsWith('en');
  assert.equal(await page.locator('[data-i18n="home.supportPage.statViewsValue"]').textContent(), englishSupport ? '3M+' : '300万+');
  assert.equal(await page.locator('.donation-pledge-date').textContent(), englishSupport ? 'December 31, 2027' : '2027 年 12 月 31 日');
  assert.match(await page.locator('.donation-reward').textContent(), /¥30/);
  if (background === '.app') {
    const viewport = page.viewportSize();
    const theme = await page.locator('html').getAttribute('data-theme');
    for (const width of [1440,1100,720,390]) {
      await page.setViewportSize({width,height:900});
      const panel = page.locator('.donation-support-panel');
      await panel.scrollIntoViewIfNeeded();
      assert.equal(await panel.evaluate(n => n.scrollWidth > n.clientWidth + 1), false, 'support content stays inside its panel');
      assert.equal(await page.locator('.donation-scroll').evaluate(n => n.scrollWidth > n.clientWidth + 1), false, 'support page has no horizontal clipping');
      // The whole section exceeds the scroll viewport. Capture actual visible
      // top/bottom views instead of a clipped, oversized element screenshot.
      await page.locator('.donation-support-title').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(output, `support-coffee-${theme}-${englishSupport ? 'en' : 'zh'}-${width}.png`)});
      await page.locator('.donation-support-bottom button').scrollIntoViewIfNeeded();
      const footerBox = await page.locator('.donation-support-bottom button').boundingBox();
      await page.screenshot({path:path.join(output, `support-coffee-bottom-${theme}-${englishSupport ? 'en' : 'zh'}-${width}.png`)});
      assert(footerBox.y >= -1 && footerBox.y + footerBox.height <= 901, `continue command stays reachable: ${width}px ${JSON.stringify(footerBox)}`);
    }
    for (const [kind, name] of [['alipay','ToolKnit-Alipay.png'], ['wechat','ToolKnit-WeChat.png']]) {
      const [download] = await Promise.all([page.waitForEvent('download'),page.locator(`[data-donation-save-qr="${kind}"]`).click()]);
      assert.equal(download.suggestedFilename(), name);
      const saved = path.join(output,name);
      await download.saveAs(saved);
      assert.deepEqual(await readFile(saved),await readFile(path.resolve('public/assets/donate',name)), 'download matches the original supplied image');
    }
    await page.setViewportSize(viewport);
  }
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
    await page.locator('.app > .home-v2-topbar [data-tool-feedback]').click();
    await page.waitForFunction(() => document.querySelector('#feedbackOverlay').classList.contains('visible') && !document.querySelector('#feedbackOverlay').inert);
    await settle();
    await page.mouse.move(1, 1);
    assert.equal(await page.locator('#marqueeTrack').evaluate(node => getComputedStyle(node).animationPlayState), 'running', 'visible feedback retains its animation');
    await page.keyboard.press('Escape');
    await settle();
    assert.equal(await page.locator('#marqueeTrack').evaluate(node => getComputedStyle(node).animationPlayState), 'paused', 'closing feedback stops its animation');
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
      assert.equal(await nav.locator('.tk-nav-tag').innerText(), `AI KEY SETTINGS · TOOL PAGE ${releaseSeries}`);
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
    await checkSupport('.app', '.app > .home-v2-topbar [data-open-support]');
    const malian = page.locator('.home-provider-malian');
    const doufu = page.locator('.home-provider-doufu');
    const niuniu = page.locator('.hero-support-note .home-provider-niuniu');
    const niuniuInline = page.locator('.home-provider-niuniu-inline');
    assert.equal(await niuniu.getAttribute('href'), 'https://s2acf.fucksb.com/register?aff=28G79Z33FT63');
    assert.equal(await niuniu.innerText(), (await page.locator('html').getAttribute('lang'))?.startsWith('en')
      ? "NiuNiu API (GPT at full capability, wallet-friendly) · Author's pick"
      : '牛牛API（GPT专用不降智，不烧心）· 作者推荐');
    assert.equal(await niuniuInline.innerText(), (await page.locator('html').getAttribute('lang'))?.startsWith('en') ? 'NiuNiu AI' : '牛牛AI');
    assert.equal(await niuniuInline.getAttribute('href'), 'https://s2acf.fucksb.com/register?aff=28G79Z33FT63');
    assert.equal(await malian.getAttribute('href'), 'https://www.mlai.online/register?aff=5Q2VVMD7YJVB');
    assert.equal(await doufu.getAttribute('href'), 'https://doufuapi.com/register?aff=TWKCBH9RGLN3');
    assert.notEqual(await malian.evaluate(n => getComputedStyle(n).color), await doufu.evaluate(n => getComputedStyle(n).color));
    await niuniu.focus(); await page.keyboard.press('Enter');
    await doufu.focus(); await page.keyboard.press('Enter');
    await malian.click();
    await niuniuInline.click();
    assert.deepEqual(await page.evaluate(() => window.__links), [
      'https://s2acf.fucksb.com/register?aff=28G79Z33FT63',
      'https://doufuapi.com/register?aff=TWKCBH9RGLN3',
      'https://www.mlai.online/register?aff=5Q2VVMD7YJVB',
      'https://s2acf.fucksb.com/register?aff=28G79Z33FT63'
    ], 'all sponsor links preserve their affiliate URL and use one shared opener');
    await checkSponsorLayout();
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
      assert.equal(await page.locator('#customToolsOverlay .audio-convert-success-dialog').evaluate(n => getComputedStyle(n).backgroundColor), theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(20, 21, 24)');
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
    await expandNewFeatures();
    assert.deepEqual(await visibleReleaseGroups(), ['3.4', '3.3', '3.2'], `${theme}: newest release first`);
    assert.deepEqual(await page.locator('#homeToolGrid .tool-result-release-heading h3').allTextContents(), ['V3.4', 'V3.3', 'V3.2']);
    for (const width of [1440, 1100, 1024, 720, 640]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 640 });
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${theme} ${width} no document overflow`);
      await checkSponsorLayout();
      assert.deepEqual(await visibleTools(), newTools);
      assert.equal(await page.locator('#homeToolGrid .tool-result-card:visible').count(), newTools.length);
      assert.equal(await page.locator('#homeToolGrid .tool-result-release-group:visible').count(), 3, `${theme} ${width}: release sections remain visible`);
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
  assert.equal(await page.locator('[data-i18n="home.categoryNew"]').innerText(), "What's New");
  assert.equal(await page.locator('.hero-support-note .home-provider-niuniu').innerText(), "NiuNiu API (GPT at full capability, wallet-friendly) · Author's pick");
  for (const width of [1440, 1100, 720, 640]) {
    await page.setViewportSize({ width, height: 900 });
    await checkSponsorLayout();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await checkNewFeatures();
  await page.locator('[data-home-category="new"]').click();
  await expandNewFeatures();
  assert.deepEqual(await page.locator('#homeToolGrid .tool-result-release-heading h3').allTextContents(), ['V3.4', 'V3.3', 'V3.2']);
  assert.deepEqual(await page.locator('#homeToolGrid .tool-result-release-subtitle').allTextContents(), ['Current version', 'Previous version', 'Previous version']);
  assert.deepEqual(await page.locator('#homeToolGrid .tool-result-release-count').allTextContents(), ['14 tools', '2 tools', '6 tools']);
  await page.locator('#homeCustomTools').click();
  assert.equal(await page.locator('#customToolsTitle').innerText(), 'Tools tailored to your work');
  await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.__links.length), 4, 'provider links use the shared opener');
  await checkSupport('.app', '.app > .home-v2-topbar [data-open-support]');
  assert.deepEqual(errors, [], 'no uncaught application errors');
  console.log('PASS English and external-link dispatch');
} finally {
  await browser.close();
  await server.httpServer.close();
}
