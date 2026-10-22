import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { checkHelpTheme } from './lib/help-theme-browser.mjs';
import { checkSecondaryTheme } from './lib/secondary-theme-browser.mjs';
import { checkDependencyTheme } from './lib/dependency-theme-browser.mjs';
import { checkUpdateDialogTheme } from './lib/update-dialog-theme-browser.mjs';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/theme-browser');
await mkdir(output, { recursive: true });
const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'],
  ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
const page = await browser.newPage({ viewport: { width: 1400, height: 887 } });
page.setDefaultTimeout(15000);
const report = { checks: [], errors: [], openSourceLayouts: [], settingsLayouts: [] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => { if (message.text().includes('Blocked aria-hidden')) report.errors.push(message.text()); });
const done = label => { report.checks.push(label); console.log(`PASS ${label}`); };
const color = (selector, property = 'backgroundColor') => page.locator(selector).first().evaluate((node, key) => {
  const style = getComputedStyle(node);
  return key.startsWith('--') ? style.getPropertyValue(key).trim() : style[key];
}, property);
const waitForColor = (selector, expected, property = 'backgroundColor') => page.waitForFunction(
  ({ selector, expected, property }) => getComputedStyle(document.querySelector(selector))[property] === expected,
  { selector, expected, property });
const settled = () => page.waitForFunction(() => {
  const veil = document.querySelector('[data-tk-page-transition-veil]');
  return !veil || getComputedStyle(veil).visibility === 'hidden';
});
const settingsTypeSizes = () => page.locator('#settingsOverlay').evaluate(overlay => {
  const selectors = ['.settings-v2-poster h1', '.settings-v2-poster p', '.settings-v2-head h2',
    '.settings-v2-btn', '.settings-v2-choice', '.settings-v2-link-card', '.settings-v2-hint',
    '.settings-v2-path', '.settings-v2-toggle-copy strong', '.settings-v2-toggle-copy span'];
  return Object.fromEntries(selectors.map(selector => [selector, getComputedStyle(overlay.querySelector(selector)).fontSize]));
});
async function settings() { await page.locator('#homeV2Settings').click(); await settled(); }
async function home() { await page.locator('#settingsBack').click(); await settled(); }
async function select(theme) {
  await page.locator(`[data-theme-choice="${theme}"]`).click();
  await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
  await page.waitForTimeout(220);
}
async function capture(name) { await page.screenshot({ path: path.join(output, `${name}.png`) }); }
async function checkBackCapsule(expected, screenshot) {
  const back = page.locator('#settingsBack');
  const before = await back.boundingBox();
  await back.hover();
  await page.waitForFunction(() => {
    return getComputedStyle(document.querySelector('#settingsBack')).width === '64px';
  });
  const style = await back.evaluate(n => {
    const s = getComputedStyle(n);
    return { background: s.backgroundColor, radius: s.borderRadius, outline: getComputedStyle(n, '::after').content };
  });
  assert.equal(style.background, expected, 'back capsule uses the page palette');
  assert.equal(style.radius, '999px');
  assert.equal(style.outline, 'none');
  const after = await back.boundingBox();
  assert.equal(after.x, before.x);
  assert.equal(after.height, before.height);
  assert.equal(after.width, 64, 'back expands rightward');
  await back.screenshot({ path: path.join(output, `${screenshot}.png`) });
  await page.mouse.move(1, 1);
}
async function checkSettingsLayout() {
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.settings-v2-layout, .settings-v2-poster').evaluateAll(nodes => nodes.forEach(n => { n.scrollTop = 0; }));
  const metrics = await page.locator('#settingsOverlay').evaluate(overlay => {
    const layout = overlay.querySelector('.settings-v2-layout');
    const cards = [...overlay.querySelectorAll('.settings-v2-card')];
    const aside = overlay.querySelector('.settings-v2-poster');
    const poster = aside.getBoundingClientRect();
    const first = cards[0].getBoundingClientRect();
    const language = [...overlay.querySelectorAll('.lang-options .lang-option')].map(n => n.getBoundingClientRect());
    const failures = [];
    const models = overlay.querySelector('#offlineModelSummary').closest('article').getBoundingClientRect();
    const matting = overlay.querySelector('#mattingModelStatus').closest('article').getBoundingClientRect();
    const grid = overlay.querySelector('.settings-v2-grid').getBoundingClientRect();
    if (Math.abs(models.width - matting.width) > 1 || Math.abs(matting.right - grid.right) > 1
      || (innerWidth > 720 && Math.abs(models.top - matting.top) > 1)) failures.push('model cards equal width and right alignment');
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      const style = getComputedStyle(card);
      if (style.backgroundColor !== 'rgb(231, 232, 234)' || style.color !== 'rgb(25, 25, 25)' || style.borderTopWidth !== '0px') failures.push('card palette');
      if (style.borderRadius !== '32px') failures.push('large card corners');
      for (const node of card.querySelectorAll('h2, p, button, .settings-v2-path, .settings-v2-toggle-copy')) {
        const rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        if (node.scrollWidth > node.clientWidth + 1 || rect.left < box.left - 1 || rect.right > box.right + 1) failures.push(node.id || node.className || node.tagName);
      }
      for (const node of card.querySelectorAll('.settings-v2-hint, .settings-theme-hint, .settings-v2-toggle-copy span, .settings-v2-font-slot-copy span')) {
        if (getComputedStyle(node).color !== 'rgb(101, 103, 107)') failures.push('muted text palette');
      }
      for (const node of card.querySelectorAll('[hidden]')) {
        if (getComputedStyle(node).display !== 'none') failures.push(`hidden: ${node.id || node.className}`);
      }
    }
    const entries = [...aside.querySelectorAll('.settings-v2-poster-list > span')];
    const meta = [...aside.querySelectorAll('.settings-v2-poster-meta > div')];
    if (entries.length !== 9 || meta.length !== 3 || [...entries, ...meta].some(n => !n.getBoundingClientRect().height)) failures.push('sidebar information missing');
    if (getComputedStyle(aside).borderRadius !== '32px' || aside.scrollWidth > aside.clientWidth + 1) failures.push('sidebar corners or overflow');
    for (const node of overlay.querySelectorAll('.settings-v2-topbar button, .settings-v2-btn, .settings-v2-choice, .settings-v2-icon-btn, .settings-v2-link-card, .settings-v2-radius-input')) {
      const radius = node.matches('.tk-nav-help, .tk-nav-feedback, .tk-nav-settings, .tk-nav-minimize, .tk-nav-maximize, .tk-nav-close') ? '6px' : '999px';
      if (getComputedStyle(node).borderRadius !== radius) failures.push(`control corners: ${node.id || node.className}`);
    }
    aside.scrollTop = aside.scrollHeight;
    const lastEntry = entries.at(-1).getBoundingClientRect();
    const sidebarReachable = lastEntry.bottom <= poster.bottom + 1 && lastEntry.top >= poster.top - 1;
    aside.scrollTop = 0;
    const preview = overlay.querySelector('#uiSoundPreview');
    const button = preview.getBoundingClientRect();
    const label = preview.querySelector('span');
    const text = label.getBoundingClientRect();
    const icon = preview.querySelector('svg').getBoundingClientRect();
    const s = getComputedStyle(label);
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const ink = context.measureText(label.textContent);
    // Flex centers boxes; font metrics also verify the painted glyphs, which may sit above the box center.
    const baseline = text.top + (text.height - ink.fontBoundingBoxAscent - ink.fontBoundingBoxDescent) / 2 + ink.fontBoundingBoxAscent;
    const glyphCenter = baseline + (ink.actualBoundingBoxDescent - ink.actualBoundingBoxAscent) / 2;
    const center = button.top + button.height / 2;
    const soundAlignment = { icon: Math.abs(icon.top + icon.height / 2 - center), label: Math.abs(text.top + text.height / 2 - center), glyph: Math.abs(glyphCenter - center) };
    const chineseGlyphsMisaligned = label.matches(':lang(zh)') && soundAlignment.glyph > 1.5;
    if (soundAlignment.icon > 1 || soundAlignment.label > 1 || chineseGlyphsMisaligned) failures.push('sound preview glyph alignment');
    return { width: innerWidth, language: document.documentElement.lang, cards: cards.length, failures,
      fits: layout.scrollWidth <= layout.clientWidth + 1,
      sidebarReachable, soundAlignment,
      sidebarLayout: innerWidth > 980 ? poster.right < first.left && Math.abs(poster.top - first.top) <= 1
        : poster.bottom <= first.top && Math.abs(poster.left - first.left) <= 1,
      languageRow: Math.abs(language[0].top - language[1].top) <= 1 && Math.abs(language[0].width - language[1].width) <= 1 };
  });
  report.settingsLayouts.push(metrics);
  assert.ok(metrics.cards >= 14, 'all settings groups remain present');
  assert.deepEqual(metrics.failures, [], `${metrics.width}px settings controls, copy and colors`);
  assert.ok(metrics.fits && metrics.sidebarLayout && metrics.sidebarReachable && metrics.languageRow, `${metrics.width}px settings preserves the sidebar, reachable information and equal-width language row without horizontal overflow`);
}
let releaseStartup;
try {
  const url = server.resolvedUrls.local[0];
  await page.goto(url);
  await page.waitForSelector('#homeToolGrid .tool-result-card', { state: 'attached' });
  assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
  await settings();
  await select('dark');
  await settled();
  await home();
  assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
  assert.equal(await color('.home-v2-topbar .home-v2-support-top', 'borderRadius'), '999px');
  await settings();
  assert.equal(await color('#settingsOverlay .home-v2-support-top', 'borderRadius'), '999px');
  await checkBackCapsule('rgb(243, 243, 244)', 'dark-back-hover');
  assert.equal(await page.getAttribute('[data-theme-choice="dark"]', 'aria-checked'), 'true');
  assert.equal(await page.locator('[data-i18n="settings.posterNote"], [data-i18n="settings.customBackgroundHint"]').count(), 0);
  const darkSettingsPalette = await page.locator('.settings-v2-card').first().evaluate(n => {
    const s = getComputedStyle(n);
    return [s.backgroundColor, s.backgroundImage, s.color, s.borderRadius];
  });
  await capture('dark-settings');
  const darkTypeSizes = await settingsTypeSizes();
  done('fresh light theme, switching to dark and settings controls');

  // A generated local video exercises playback without user files or downloads.
  const video = spawnSync(process.env.TOOLKNIT_TEST_FFMPEG || 'ffmpeg', [
    '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x66aa99:size=64x64:rate=10',
    '-t', '1', '-an', '-c:v', 'libvpx', '-f', 'webm', 'pipe:1'
  ], { windowsHide: true, timeout: 15000 });
  assert.equal(video.status, 0, video.error?.message || video.stderr?.toString());
  assert.ok(video.stdout.length > 200, 'valid local video fixture');
  await page.locator('#customBackgroundVideoInput').setInputFiles({ name: 'theme-fixture.webm', mimeType: 'video/webm', buffer: video.stdout });
  await page.waitForFunction(() => document.querySelector('#settingsBackgroundPreview video')?.readyState >= 2
    && document.querySelector('.app').classList.contains('has-custom-background')
    && !document.querySelector('#chooseBackgroundVideo').disabled);
  const wallpaper = await page.evaluate(() => {
    window.__themeVideos = [...document.querySelectorAll('video')];
    return localStorage.getItem('toolknit.customBackground.v1');
  });
  await select('light');
  assert.equal(await color('#settingsOverlay'), 'rgb(255, 255, 255)');
  assert.equal(await color('#settingsOverlay .settings-v2-topbar'), 'rgb(255, 255, 255)');
  assert.equal(await color('#settingsOverlay .home-v2-support-top', 'color'), 'rgb(255, 255, 255)');
  assert.equal(await color('#settingsOverlay .home-v2-support-top'), 'rgb(17, 17, 17)');
  await checkBackCapsule('rgb(17, 17, 17)', 'light-back-hover');
  assert.equal(await color('#settingsOverlay .home-v2-icon-button.is-current'), 'rgb(238, 238, 238)');
  assert.equal(await color('#settingsOverlay .home-v2-icon-button.is-current', 'color'), 'rgb(17, 17, 17)');
  assert.equal(await page.locator('#settingsOverlay').evaluate(n => getComputedStyle(n, '::before').display), 'none');
  assert.equal(await page.locator('#settingsOverlay .settings-v2-topbar').evaluate(n => n.getBoundingClientRect().height), 68);
  assert.equal(await page.locator('[data-background-controls]').evaluate(n => n.inert), true);
  assert.equal(await color('[data-background-controls]', 'filter'), 'blur(3px)');
  for (const id of ['chooseBackgroundImage', 'chooseBackgroundVideo', 'clearCustomBackground']) assert.equal(await page.locator(`#${id}`).isDisabled(), true);
  assert.equal(await page.locator('.toolknit-custom-background-media, #settingsBackgroundPreview video').count(), 0);
  assert.equal(await page.evaluate(() => window.__themeVideos.every(v => v.paused && !v.getAttribute('src'))), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('toolknit.customBackground.v1')), wallpaper);
  assert.equal(await color('.settings-v2-poster'), 'rgb(231, 232, 234)');
  assert.equal(await page.locator('.settings-v2-poster').evaluate(n => getComputedStyle(n, '::before').display), 'none');
  assert.match(await color('#settingsOverlay .settings-content', 'backgroundImage'), /linear-gradient/);
  assert.deepEqual(await settingsTypeSizes(), darkTypeSizes, 'light settings reuse dark typography sizes');
  assert.equal(await color('.settings-v2-path'), 'rgba(0, 0, 0, 0)', 'status text does not introduce nested cards');
  await checkSettingsLayout();
  await page.locator('.settings-v2-layout').evaluate(n => { n.scrollTop = 0; });
  await capture('light-settings');
  await page.locator('#uiSoundPreview').screenshot({ path: path.join(output, 'light-settings-sound-preview.png') });
  await page.locator('.settings-v2-background-card').scrollIntoViewIfNeeded();
  await capture('light-wallpaper-disabled');
  done('white settings, disabled wallpaper, stopped video and preserved configuration');

  const soundToggle = page.locator('#uiSoundToggle');
  const soundBefore = await soundToggle.getAttribute('aria-pressed');
  await soundToggle.click();
  await page.waitForFunction(before => document.querySelector('#uiSoundToggle').getAttribute('aria-pressed') !== before, soundBefore);
  assert.equal(await color('#uiSoundToggle'), soundBefore === 'true' ? 'rgb(156, 160, 166)' : 'rgb(17, 17, 17)');
  assert.equal(await page.locator('#uiSoundPreview').isDisabled(), soundBefore === 'true');
  await soundToggle.click();
  assert.equal(await soundToggle.getAttribute('aria-pressed'), soundBefore);
  const oldSound = await page.locator('[data-sound-style].active').getAttribute('data-sound-style');
  await page.locator('[data-sound-style="2"]').click();
  await page.mouse.move(1, 1);
  await waitForColor('[data-sound-style="2"]', 'rgb(17, 17, 17)');
  assert.equal(await color('[data-sound-style="2"]'), 'rgb(17, 17, 17)');
  assert.equal(await color('[data-sound-style="2"]', 'color'), 'rgb(255, 255, 255)');
  await page.locator(`[data-sound-style="${oldSound}"]`).click();
  const oldRadius = await page.locator('[data-window-radius-mode].active').getAttribute('data-window-radius-mode');
  const oldRadiusValue = await page.locator('#windowRadiusCustomInput').inputValue();
  await page.locator('[data-window-radius-mode="custom"]').click();
  const radiusInput = page.locator('#windowRadiusCustomInput');
  assert.equal(await radiusInput.isDisabled(), false);
  await radiusInput.fill('12');
  await radiusInput.press('Tab');
  assert.equal(await page.locator('#windowRadiusValue').innerText(), '12px');
  await waitForColor('#windowRadiusCustomInput', 'rgb(255, 255, 255)');
  assert.equal(await color('#windowRadiusCustomInput'), 'rgb(255, 255, 255)');
  assert.equal(await color('#windowRadiusCustomInput', 'color'), 'rgb(25, 25, 25)');
  await radiusInput.focus();
  assert.equal(await color('#windowRadiusCustomInput', 'outlineStyle'), 'none');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('windowRadiusCustomInput')).getPropertyValue('--tk-field-height').trim() === '3px');
  assert.equal(await color('#windowRadiusCustomInput', 'boxShadow'), 'none');
  await capture('light-settings-window-controls');
  await radiusInput.fill(oldRadiusValue);
  await radiusInput.press('Tab');
  await page.locator(`[data-window-radius-mode="${oldRadius}"]`).click();
  for (const selector of ['#settingsApiKey', '#manageMattingModelsBtn']) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.mouse.move(1, 1);
    await waitForColor(selector, 'rgb(17, 17, 17)');
    assert.equal(await color(selector), 'rgb(17, 17, 17)');
    assert.equal(await color(`${selector} svg`, 'color'), 'rgb(255, 255, 255)');
  }
  for (const selector of ['#manageOfflineModels', '#helpLink', '#declarationLink']) {
    assert.equal(await color(selector), 'rgb(255, 255, 255)');
    assert.equal(await color(`${selector} svg`, 'color'), 'rgb(25, 25, 25)');
  }
  await page.locator('#settingsFontCard').scrollIntoViewIfNeeded();
  await capture('light-settings-fonts');
  await page.locator('#usagePolicyLink').scrollIntoViewIfNeeded();
  await capture('light-settings-bottom');
  await page.locator('.settings-v2-layout').evaluate(n => { n.scrollTop = 0; });
  done('light settings button selection, switch, numeric input, focus and utility controls');

  await page.locator('[data-theme-choice="light"]').focus();
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.equal(await page.locator('[data-theme-choice="light"]').evaluate(n => n === document.activeElement), true);
  await page.locator('#settingsOverlay [data-lang="en"]').click();
  await page.waitForFunction(() => document.documentElement.lang === 'en' && !document.body.matches('.fade-in, .fade-out') && !document.querySelector('#transitionMask').classList.contains('visible'));
  assert.equal(await page.getAttribute('[data-theme-choice="light"]', 'aria-checked'), 'true');
  for (const width of [1920, 1400, 1100, 980, 780, 720, 640, 390]) {
    await page.setViewportSize({ width, height: 740 });
    await checkSettingsLayout();
    await page.locator('.settings-v2-layout').evaluate(n => { n.scrollTop = 0; });
    await capture(`light-settings-english-${width}`);
  }
  await page.setViewportSize({ width: 1400, height: 887 });
  await capture('light-settings-english');
  await page.locator('#settingsOverlay [data-lang="zh"]').click();
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN' && !document.body.matches('.fade-in, .fade-out') && !document.querySelector('#transitionMask').classList.contains('visible'));
  done('keyboard selection and language change preserve the theme');

  await home();
  await page.locator('.app .main-content').evaluate(n => { n.scrollTop = 0; });
  assert.equal(await color('.app.is-v2-home'), 'rgb(255, 255, 255)');
  assert.equal(await color('.home-v2-topbar'), 'rgb(255, 255, 255)');
  assert.equal(await color('.home-v2-topbar .home-v2-support-top', 'borderRadius'), '999px');
  assert.equal(await color('.hero-title-brand', 'color'), 'rgb(17, 17, 17)');
  assert.equal(await color('.app .main-content'), 'rgb(255, 255, 255)');
  assert.match(await color('.app .main-content', 'backgroundImage'), /linear-gradient/);
  await capture('light-home');
  const search = page.locator('#homeToolSearch');
  const field = page.locator('.home-search-field');
  await field.scrollIntoViewIfNeeded();
  const fieldBefore = await field.boundingBox();
  await search.click();
  await page.waitForTimeout(200);
  assert.equal(await color('#homeToolSearch', 'outlineStyle'), 'none', 'clipped input outline must not create vertical bars');
  assert.equal(await color('#homeToolSearch', 'boxShadow'), 'none');
  assert.equal(await color('#homeToolSearch', 'borderLeftWidth'), '0px');
  assert.equal(await color('.home-search-field', 'borderTopColor'), 'rgba(0, 0, 0, 0)');
  assert.equal(await color('.home-search-field', 'boxShadow'), 'none', 'focus stays inside the shared underline');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.home-search-field')).getPropertyValue('--tk-field-height').trim() === '3px');
  assert.equal(await color('#homeToolSearch'), 'rgba(0, 0, 0, 0)', 'the input must not cover its shell underline');
  assert.equal(await field.evaluate(n => getComputedStyle(n, '::after').display), 'none');
  const fieldAfter = await field.boundingBox();
  assert.equal(fieldAfter.width, fieldBefore.width);
  assert.equal(fieldAfter.height, fieldBefore.height);
  await field.screenshot({ path: path.join(output, 'light-search-mouse-focus.png') });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await search.evaluate(n => n === document.activeElement), true);
  assert.equal(await color('#homeToolSearch', 'outlineStyle'), 'none');
  await field.screenshot({ path: path.join(output, 'light-search-keyboard-focus.png') });
  await search.fill('PDF');
  await page.waitForFunction(() => document.querySelector('#homeToolGrid .tool-result-card'));
  await search.fill('');
  await page.locator('#favorites').scrollIntoViewIfNeeded();
  assert.equal(await color('.favorite-item'), 'rgb(231, 232, 234)');
  assert.equal(await color('.favorite-name', 'color'), 'rgb(25, 25, 25)');
  assert.equal(await color('.favorite-desc', 'color'), 'rgb(101, 103, 107)');
  assert.equal(await color('.favorite-item', 'borderTopWidth'), '0px');
  const iconPalette = async selector => page.locator(selector).evaluateAll(nodes => [...new Set(nodes.map(n => {
    const style = getComputedStyle(n);
    const glyph = n.querySelector('svg');
    return `${style.backgroundColor}|${style.color}|${glyph ? getComputedStyle(glyph).color : style.color}`;
  }))]);
  const expectedIcon = ['rgb(248, 248, 249)|rgb(64, 66, 71)|rgb(64, 66, 71)'];
  assert.deepEqual(await iconPalette('.favorite-icon'), expectedIcon, 'all favorite categories share the neutral icon palette');
  await capture('light-home-favorites');
  await page.getByRole('button', { name: '打开工具库', exact: true }).click();
  await page.locator('[data-home-category="ppt"]').click();
  await page.mouse.move(2, 75);
  await page.waitForTimeout(250);
  assert.equal(await color('[data-home-category="ppt"]'), 'rgb(17, 17, 17)');
  assert.equal(await color('[data-home-category="ppt"] span', 'color'), 'rgb(255, 255, 255)');
  assert.equal(await color('.tool-result-tag'), 'rgb(255, 255, 255)');
  assert.equal(await color('.tool-result-tag', 'color'), 'rgb(17, 17, 17)');
  assert.equal(await color('.tool-result-tag', 'borderTopWidth'), '0px');
  assert.equal(await color('.tool-result-card'), 'rgb(231, 232, 234)');
  assert.deepEqual(await iconPalette('.tool-result-icon'), expectedIcon);
  assert.equal(await color('.tool-result-name', 'color'), 'rgb(25, 25, 25)');
  assert.equal(await color('.tool-result-desc', 'color'), 'rgb(101, 103, 107)');
  assert.equal(await color('.tool-result-card', 'borderTopWidth'), '0px');
  await page.locator('#homeToolGrid').scrollIntoViewIfNeeded();
  await capture('light-home-tools');
  const card = page.locator('.tool-result-card').first();
  await card.scrollIntoViewIfNeeded();
  const beforeHover = await card.boundingBox();
  await card.hover();
  await page.waitForTimeout(200);
  assert.equal(await color('.tool-result-card'), 'rgb(221, 223, 226)');
  assert.equal(await color('.tool-result-card', 'transform'), 'none');
  assert.equal(await color('.tool-result-card', 'boxShadow'), 'none');
  assert.deepEqual(await card.boundingBox(), beforeHover);
  await page.mouse.move(2, 75);
  await page.locator('[data-home-category="all"]').click();
  await page.locator('.github-strip').scrollIntoViewIfNeeded();
  assert.equal(await color('.github-strip'), 'rgba(0, 0, 0, 0)');
  assert.equal(await color('.github-strip', 'borderTopWidth'), '0px');
  assert.equal(await color('.github-intro strong', 'color'), 'rgb(17, 17, 17)');
  assert.equal(await color('.github-open', 'color'), 'rgb(255, 255, 255)');
  assert.equal(await color('.github-open'), 'rgb(17, 17, 17)');
  const checkCompact = async () => {
    const metrics = await page.locator('.github-strip').evaluate(section => {
      const box = section.getBoundingClientRect();
      const nodes = ['#openSourceTitle', '.github-intro p', '.github-principles', '.github-open', '.github-stat'].map(selector => {
        const node = section.querySelector(selector);
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return { selector, fits: node.scrollWidth <= node.clientWidth + 1 && rect.left >= box.left - 1 && rect.right <= box.right + 1,
          fontSize: style.fontSize, textAlign: style.textAlign, letterSpacing: style.letterSpacing };
      });
      const rect = selector => section.querySelector(selector).getBoundingClientRect();
      const title = rect('#openSourceTitle');
      const copy = rect('.github-intro p');
      const principles = rect('.github-principles');
      const action = section.querySelector('.github-open').getBoundingClientRect();
      const stats = section.querySelector('.github-stat').getBoundingClientRect();
      const cards = document.querySelector('#homeToolGrid').getBoundingClientRect();
      const back = document.querySelector('.back-to-top').getBoundingClientRect();
      return { nodes, language: document.documentElement.lang, height: box.height, width: innerWidth,
        gridAligned: Math.abs(title.left - cards.left) <= 1 && Math.abs(box.left - cards.left) <= 1
          && Math.abs(box.right - cards.right) <= 1 && Math.abs(action.right - cards.right) <= 1,
        readingColumn: [copy, principles, stats].every(r => Math.abs(title.left - r.left) <= 1),
        rightActionCentered: Math.max(copy.right, principles.right, stats.right) + 16 <= action.left
          && Math.abs(action.top + action.height / 2 - (title.top + stats.bottom) / 2) <= 2,
        actionRow: Math.abs(action.top + action.height / 2 - stats.top - stats.height / 2) <= 2 && stats.right + 12 <= action.left,
        ordered: title.bottom <= copy.top && copy.bottom <= principles.top && principles.bottom <= stats.top,
        backUnobstructed: [action, stats].every(r => r.right <= back.left || r.bottom <= back.top || r.top >= back.bottom) };
    });
    report.openSourceLayouts.push(metrics);
    assert.ok(metrics.nodes.every(m => m.fits), 'every open-source element fits');
    assert.ok(metrics.gridAligned && metrics.readingColumn && metrics.ordered, 'all information aligns with the card grid left edge, only the action sits on the right');
    assert.ok(metrics.width > 600 ? metrics.rightActionCentered : metrics.actionRow, 'the right action is vertically centered; narrow screens retain a left-stat/right-action row');
    assert.ok(metrics.backUnobstructed, 'back-to-top never overlaps the action or stars');
    assert.ok(metrics.height <= (metrics.width > 780 ? 250 : 420), `open-source height is bounded, got ${metrics.height}px`);
    assert.equal(metrics.nodes[0].fontSize, '22px', 'footer title uses compact type, not hero-scale type');
    assert.equal(metrics.nodes[1].textAlign, 'left');
    assert.ok(metrics.nodes.every(m => ['normal', '0px'].includes(m.letterSpacing)));
    assert.equal(await color('.github-stat', 'borderLeftWidth'), '0px');
    assert.equal(await color('.github-stat', 'borderTopWidth'), '0px');
    for (const selector of ['.github-section-index', '.github-repo', '.github-stat-note', '.footer-note']) {
      assert.equal(await color(selector, 'display'), 'none', `${selector}: duplicate decoration is absent in light mode`);
    }
  };
  await checkCompact();
  await capture('light-home-open-source');
  await page.locator('.github-strip').screenshot({ path: path.join(output, 'light-open-source-detail.png') });
  await page.locator('.github-open').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('.github-open').evaluate(n => n === document.activeElement), true);
  assert.equal(await color('.github-open', 'outlineStyle'), 'solid');
  assert.match(await page.locator('.github-open').getAttribute('href'), /^https:\/\/github\.com\/ZihangDong\/toolknit-desktop$/);
  for (const [width, height] of [[1920, 1080], [1100, 700], [800, 600], [720, 480], [640, 600], [390, 740]]) {
    await page.setViewportSize({ width, height });
    await page.locator('.github-strip').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('.github-strip').evaluate(n => n.scrollWidth <= n.clientWidth + 1));
    await checkCompact();
    await capture(`light-open-source-${width}`);
    await page.locator('#homeToolGrid').scrollIntoViewIfNeeded();
    assert.ok(await card.evaluate(n => n.scrollWidth <= n.clientWidth + 1));
    await capture(`light-cards-${width}`);
  }
  await page.setViewportSize({ width: 1400, height: 887 });
  await settings();
  await page.locator('#settingsOverlay [data-lang="en"]').click();
  await page.waitForFunction(() => document.documentElement.lang === 'en' && !document.body.matches('.fade-in, .fade-out') && !document.querySelector('#transitionMask').classList.contains('visible'));
  await home();
  for (const width of [1920, 1400, 800, 640, 390]) {
    await page.setViewportSize({ width, height: 740 });
    await page.locator('.github-strip').scrollIntoViewIfNeeded();
    await checkCompact();
    await capture(`light-open-source-english-${width}`);
  }
  await page.setViewportSize({ width: 1400, height: 887 });
  await settings();
  await page.locator('#settingsOverlay [data-lang="zh"]').click();
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN' && !document.body.matches('.fade-in, .fade-out') && !document.querySelector('#transitionMask').classList.contains('visible'));
  await home();
  done('white grid texture, unified search focus and card-aligned open-source copy with one right action');

  await page.locator('[data-home-category="pdf"]').click();
  await page.locator('#homeToolSearch').fill('PDF');
  await page.evaluate(() => { window.__homeCard = document.querySelector('#homeToolGrid .tool-result-card'); });
  await settings();
  await page.evaluate(() => { for (let i = 0; i < 12; i++) document.querySelector(`[data-theme-choice="${i % 2 ? 'light' : 'dark'}"]`).click(); });
  await home();
  assert.equal(await page.locator('#homeToolSearch').inputValue(), 'PDF');
  assert.equal(await page.evaluate(() => window.__homeCard === document.querySelector('#homeToolGrid .tool-result-card')), true);
  assert.equal(await page.locator('.toolknit-custom-background-media').count(), 0);
  await page.locator('[data-home-tool="pdf-editor"]').first().click();
  await settled();
  assert.equal(await color('#pdfEditorOverlay', '--ink'), '#171717');
  await page.locator('#pdfEditorV2Settings').click();
  await settled();
  assert.equal(await color('#settingsOverlay'), 'rgb(255, 255, 255)');
  await home();
  await page.locator('#pdfEditorBack').click();
  await settled();
  assert.equal(await color('.app.is-v2-home'), 'rgb(255, 255, 255)');
  done('rapid switching preserves home state and applies the selected light tool theme');

  await page.reload();
  await page.waitForSelector('#homeToolGrid .tool-result-card', { state: 'attached' });
  assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
  assert.equal(await page.locator('.toolknit-custom-background-media, #settingsBackgroundPreview video').count(), 0);
  await settings();
  for (const [width, height] of [[1920, 1080], [1100, 700], [1024, 480], [980, 600], [780, 600], [720, 480], [640, 600], [390, 740]]) {
    await page.setViewportSize({ width, height });
    await checkSettingsLayout();
    await page.locator('.settings-language-theme-card').scrollIntoViewIfNeeded();
    const metrics = await page.locator('.settings-language-theme-card').evaluate(card => {
      const rect = card.getBoundingClientRect();
      return [...card.querySelectorAll('h2, button, .settings-theme-hint')].map(n => {
        const r = n.getBoundingClientRect();
        return { fits: r.left >= rect.left && r.right <= rect.right && n.scrollWidth <= n.clientWidth + 1 };
      });
    });
    assert.ok(metrics.every(m => m.fits), `${width}x${height}: settings text fits`);
    await capture(`light-settings-${width}`);
  }
  await page.setViewportSize({ width: 1400, height: 887 });
  await select('dark');
  assert.deepEqual(await page.locator('.settings-v2-card').first().evaluate(n => {
    const s = getComputedStyle(n);
    return [s.backgroundColor, s.backgroundImage, s.color, s.borderRadius];
  }), darkSettingsPalette, 'light settings refinements never change the dark card palette');
  assert.equal(await color('#settingsOverlay .settings-content', 'backgroundImage'), 'none');
  await page.waitForFunction(() => document.querySelector('#settingsBackgroundPreview video')?.readyState >= 2 && document.querySelector('.app').classList.contains('has-custom-background'));
  assert.equal(await color('.app .main-content', 'backgroundImage'), 'none', 'white grid texture never leaks into dark theme');
  assert.equal(await color('.github-mark', 'display'), 'grid', 'dark open-source layout is unchanged');
  assert.equal(await color('.github-section-index', 'display'), 'block');
  assert.equal(await color('.github-repo', 'display'), 'block');
  assert.equal(await color('.footer-note', 'display'), 'flex');
  assert.equal(await page.locator('[data-background-controls]').evaluate(n => n.inert), false);
  assert.equal(await page.locator('#clearCustomBackground').isDisabled(), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('toolknit.customBackground.v1')), wallpaper);
  done('restart, compact layouts and dark wallpaper restoration');

  await select('light');
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  releaseStartup = release;
  await page.route('**/assets/main-*.js', async route => { await hold; await route.continue(); });
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForSelector('.app.is-v2-home', { state: 'attached' });
  assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
  assert.equal(await color('body'), 'rgb(255, 255, 255)');
  assert.equal(await color('.app.is-v2-home'), 'rgb(255, 255, 255)');
  release();
  await page.waitForSelector('#homeToolGrid .tool-result-card', { state: 'attached' });
  assert.equal(await page.locator('.toolknit-custom-background-media').count(), 0);
  done('white first paint before application JavaScript loads');
  done(await checkHelpTheme(browser, url, path.join(output, 'help')));
  done(await checkSecondaryTheme(browser, url, path.join(output, 'secondary')));
  done(await checkDependencyTheme(browser, url, path.join(output, 'dependency')));
  done(await checkUpdateDialogTheme(browser, url, path.join(output, 'update-dialog')));
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error.stack || error);
  report.state = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    homeBackground: document.querySelector('.app')?.classList.contains('has-custom-background'),
    importDisabled: document.querySelector('#chooseBackgroundVideo')?.disabled,
    hasMetadata: Boolean(localStorage.getItem('toolknit.customBackground.v1')),
    media: [...document.querySelectorAll('video')].map(v => ({ parent: v.parentElement?.className, readyState: v.readyState, paused: v.paused, error: v.error?.code, bytes: v.getAttribute('src')?.length }))
  })).catch(() => null);
  await capture('failure').catch(() => {});
  throw error;
} finally {
  releaseStartup?.();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
