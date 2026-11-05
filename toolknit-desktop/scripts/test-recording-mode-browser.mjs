import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { preview, createServer } from 'vite';

const { chromium } = createRequire(import.meta.url)('playwright');
const output = path.resolve('tmp/recording-mode-browser');
await mkdir(output, { recursive: true });
const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0 } });
const index = await readFile('index.html', 'utf8');
const prompt = index.slice(index.indexOf('<aside class="recording-mode-prompt"'), index.indexOf('</aside>', index.indexOf('<aside class="recording-mode-prompt"')) + 8);
assert.ok(prompt.includes('recordingModePromptToggle'));
const fixtureServer = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: ['lucide'] }, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, plugins: [{ name: 'recording-mode-fixture', configureServer(devServer) {
devServer.middlewares.use('/recording-fixture', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html lang="zh-CN" data-theme="light"><head><meta charset="utf-8"><link rel="stylesheet" href="/src/styles/pages/settings-v2.css"></head><body>
    <button id="recordingModeToggle" aria-pressed="false">Mode</button><span id="recordingModeStatus"></span>${prompt}
    <script type="module">
    import { createRecordingModeRuntime } from '/src/app/recording-mode-runtime.js';
    window.nativeState = JSON.parse(sessionStorage.getItem('nativeState') || '{"autostart":true,"clipboard":false,"history":false}');
    window.notifications = []; window.helpSections = []; window.failure = false;
    window.readFailure = new URL(location).searchParams.has('readFailure');
    window.listenFailure = new URL(location).searchParams.has('listenFailure');
    window.mutations = [];
    window.runtime = createRecordingModeRuntime({ adapter: { available: true,
      read: async () => { if (window.readFailure) throw Error('clipboard:busy'); return {...window.nativeState}; },
      set: async (key, value) => { window.mutations.push([key,value]); if (window.failure && key === 'history' && value) throw Error('screenshot:window-failed'); window.nativeState[key] = value; sessionStorage.setItem('nativeState', JSON.stringify(window.nativeState)); },
      subscribe: async listener => { if (window.listenFailure) throw Error('listen failed'); window.stateChanged = listener; return () => { window.stateChanged = null; }; }
    }, translate: (key, vars) => vars ? key + ':' + vars.step + ':' + vars.code : key, notify: message => window.notifications.push(message), onOpenHelp: section => window.helpSections.push(section) });
    </script></body></html>`);
});
devServer.middlewares.use('/shortcut-settings-fixture', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html><body><script type="module">
    import template from '/src/features/quick-screenshot/template.js';
    import { createQuickScreenshotController } from '/src/features/quick-screenshot/controller.js';
    import '/src/features/quick-screenshot/quick-screenshot.css';
    document.documentElement.dataset.theme = new URL(location).searchParams.get('theme') || 'light';
    document.body.innerHTML = template;
    window.settings = {shortcut:'Alt+Q',history:false,registered:null,error:'screenshot:shortcut-conflict'};
    window.shortcutAttempts = 0; window.shortcutConflict = true;
    window.quickController = createQuickScreenshotController({overlay:document.getElementById('quickScreenshotOverlay'),screenshotRuntime:{
      available:true, listen:async()=>()=>{}, call:async(action,payload)=>{
        if(action==='configure'){
          if(payload.updateShortcut || payload.preferences.shortcut !== window.settings.shortcut){
            window.shortcutAttempts++;
            if(window.shortcutConflict)throw Error('screenshot:shortcut-conflict');
            window.settings.registered=payload.preferences.shortcut; window.settings.error=null;
          }
          Object.assign(window.settings,payload.preferences);
        }
        return {...window.settings};
      }
    }});
    window.quickController.open();
  </script></body></html>`);
});
} }] });
await fixtureServer.listen();
const browser = await chromium.launch({ headless: true, ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const settle = () => page.waitForFunction(() => {
  const veil = document.querySelector('[data-tk-page-transition-veil]');
  return !veil || getComputedStyle(veil).visibility === 'hidden';
});
const shown = selector => page.waitForFunction(sel => {
  const n = document.querySelector(sel);
  return n?.classList.contains('visible') && !n.inert && getComputedStyle(n).opacity === '1';
}, selector);
const checkPage = async (source, kind, exit = 'back') => {
  const target = `#${kind}Overlay`;
  const sourceRoot = source.startsWith('.app') ? '.app' : source;
  await page.locator(`${source} [data-tool-${kind}]`).click();
  await shown(target); await settle();
  assert.equal(await page.locator(sourceRoot).evaluate(n => n.inert), true, 'source input is suspended');
  assert.equal(await page.evaluate(sel => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest(sel)?.id, target), `${kind}Overlay`, 'destination covers source');
  if (exit === 'escape') await page.keyboard.press('Escape');
  else await page.locator(kind === 'help' ? '#helpBackBtn' : '#feedbackBack').click();
  await settle();
  if (sourceRoot !== '.app') await shown(sourceRoot);
  assert.equal(await page.locator(sourceRoot).evaluate(n => n.inert), false, 'source input is restored');
  assert.equal(await page.locator(target).evaluate(n => !n.classList.contains('visible') && n.inert), true);
};
try {
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => !document.documentElement.dataset.tkStartup && !document.querySelector('.app').inert);
  assert.equal(await page.locator('#recordingModePrompt').isVisible(), false, 'native prompt is hidden in browser');
  for (const theme of ['light', 'dark']) {
    await page.locator('#homeV2Settings').click(); await settle();
    await page.locator(`[data-theme-choice="${theme}"]`).click(); await settle();
    assert.equal(await page.locator('#recordingModeToggle').isDisabled(), true);
    await checkPage('#settingsOverlay', 'help');
    await checkPage('#settingsOverlay', 'feedback', 'escape');
    await page.locator('#settingsBack').click(); await settle();
    await checkPage('.app .home-v2-topbar', 'help');
    await checkPage('.app .home-v2-topbar', 'feedback');
    for (const [tool, overlay] of [['pdf-merge', 'pdfMergeOverlay'], ['ppt-to-pdf', 'pptToPdfOverlay'], ['text-stats', 'textStatsOverlay'], ['hardware-overview', 'hardwareOverviewOverlay']]) {
      await page.evaluate(id => document.querySelector(`.audio-list-item[data-tool="${id}"]`).click(), tool);
      await shown(`#${overlay}`); await settle();
      await checkPage(`#${overlay}`, 'help', 'escape');
      await checkPage(`#${overlay}`, 'feedback');
      assert.equal(await page.locator(`#${overlay} [data-tool-help]`).count(), 1);
      for (const width of [1440, 1024, 800, 640]) {
        await page.setViewportSize({ width, height: 720 });
        const nav = page.locator(`#${overlay} .tk-tool-nav`);
        assert.equal(await nav.evaluate(n => n.scrollWidth <= n.clientWidth + 1), true, `${tool} ${theme} ${width}: nav fits`);
        const boxes = await nav.locator('.tk-nav-tag, .tk-nav-support, .tk-nav-help, .tk-nav-feedback, .tk-nav-settings').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; }));
        for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].y >= boxes[i - 1].bottom - 1 || boxes[i].x >= boxes[i - 1].right - 1, `${tool}: nav controls do not overlap`);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator(`#${overlay} .tk-nav-back`).click(); await settle();
    }
    await page.evaluate(() => { const prompt = document.querySelector('#recordingModePrompt'); prompt.hidden = false; document.querySelector('#recordingModePromptToggle').disabled = false; });
    const prompt = page.locator('#recordingModePrompt');
    assert.equal(await prompt.locator('#recordingModeDismiss svg').count(), 1, 'homepage prompt close icon renders');
    await prompt.screenshot({ path: path.join(output, `homepage-prompt-${theme}.png`) });
    await page.evaluate(() => { document.querySelector('#recordingModePrompt').hidden = true; document.querySelector('#recordingModePromptToggle').disabled = true; });
    console.log(`PASS ${theme}: home/settings/PDF/PPT/text/hardware navigation, Escape, focus locking, narrow layouts`);
  }
  await page.locator('#homeV2Settings').click(); await settle();
  await page.locator('[data-lang="en"]').click();
  await page.locator('#settingsOverlay [data-tool-help]').click(); await shown('#helpOverlay'); await settle();
  await page.locator('#helpOverlay [data-tool-feedback]').click(); await shown('#feedbackOverlay'); await settle();
  await page.locator('#feedbackOverlay .tk-nav-support').click(); await shown('#donationOverlay');
  await page.locator('#donationOverlay [data-tool-help]').click(); await shown('#helpOverlay'); await settle();
  await page.locator('#helpOverlay .tk-nav-settings').click(); await shown('#settingsOverlay'); await settle();
  assert.equal(await page.locator('#helpOverlay').evaluate(n => n.inert && !n.classList.contains('visible')), true);
  assert.equal(await page.locator('#settingsOverlay [data-tool-help]').getAttribute('title'), 'Help Center');

  const fixture = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  fixture.on('pageerror', e => errors.push(e.message));
  const url = `${fixtureServer.resolvedUrls.local[0]}recording-fixture`;
  await fixture.goto(url);
  await fixture.waitForFunction(() => window.runtime && !document.querySelector('#recordingModePromptToggle').disabled);
  for (const theme of ['light', 'dark']) {
    await fixture.evaluate(value => document.documentElement.dataset.theme = value, theme);
    const dimensions = await fixture.locator('#recordingModePromptToggle').evaluate(node => {
      const box = node.getBoundingClientRect(), thumb = getComputedStyle(node, '::before');
      return { width: box.width, height: box.height, thumb: thumb.width };
    });
    assert.deepEqual(dimensions, { width: 58, height: 32, thumb: '24px' }, `${theme}: prompt has a complete switch`);
    await fixture.locator('#recordingModePrompt').screenshot({ path: path.join(output, `prompt-${theme}.png`) });
  }
  await fixture.locator('[data-recording-mode-help]').click();
  assert.deepEqual(await fixture.evaluate(() => window.helpSections), ['recording-mode']);
  await fixture.locator('#recordingModePromptToggle').click();
  await fixture.waitForFunction(() => document.querySelector('#recordingModeToggle').getAttribute('aria-pressed') === 'true');
  assert.equal(await fixture.locator('#recordingModePrompt').isVisible(), false);
  assert.deepEqual(await fixture.evaluate(() => window.nativeState), { autostart: true, clipboard: true, history: true });
  await fixture.reload();
  await fixture.waitForFunction(() => document.querySelector('#recordingModeToggle').getAttribute('aria-pressed') === 'true');
  await fixture.locator('#recordingModeToggle').click();
  await fixture.waitForFunction(() => document.querySelector('#recordingModeToggle').getAttribute('aria-pressed') === 'false');
  assert.deepEqual(await fixture.evaluate(() => window.nativeState), { autostart: true, clipboard: false, history: false }, 'restart preserves original preferences');
  await fixture.evaluate(() => window.failure = true);
  await fixture.locator('#recordingModePromptToggle').click();
  await fixture.waitForFunction(() => window.notifications.some(message => message.startsWith('recordingMode.error ')));
  assert.match((await fixture.evaluate(() => window.notifications)).at(-1), /steps.history:screenshot:window-failed/);
  assert.deepEqual(await fixture.evaluate(() => window.nativeState), { autostart: true, clipboard: false, history: false });
  await fixture.locator('#recordingModeDismiss').hover();
  await fixture.locator('[data-recording-mode-dismiss="session"]').focus();
  await fixture.keyboard.press('Escape');
  assert.equal(await fixture.locator('#recordingModeDismissMenu').isVisible(), false, 'Escape closes the focused menu');
  await fixture.locator('#recordingModeDismiss').click();
  await fixture.locator('[data-recording-mode-dismiss="session"]').click();
  assert.equal(await fixture.locator('#recordingModePrompt').isVisible(), false);
  await fixture.reload(); await fixture.locator('#recordingModePrompt').waitFor({ state: 'visible' });
  await fixture.locator('#recordingModeDismiss').click();
  await fixture.locator('[data-recording-mode-dismiss="permanent"]').click();
  await fixture.reload(); await fixture.waitForFunction(() => window.runtime && !document.querySelector('#recordingModeToggle').disabled);
  assert.equal(await fixture.locator('#recordingModePrompt').isVisible(), false);
  await fixture.goto(url + '?readFailure&listenFailure');
  await fixture.waitForFunction(() => document.querySelector('#recordingModeStatus').textContent === 'recordingMode.statusError');
  assert.equal(await fixture.locator('#recordingModeToggle').isEnabled(), true, 'read failure allows explicit retry');
  await fixture.locator('#recordingModeToggle').click();
  assert.equal(await fixture.evaluate(() => window.mutations.length), 0, 'no write while state remains unknown');
  await fixture.evaluate(() => { window.readFailure = false; });
  await fixture.locator('#recordingModeToggle').click();
  await fixture.waitForFunction(() => document.querySelector('#recordingModeToggle').getAttribute('aria-pressed') === 'true');
  assert.deepEqual(await fixture.evaluate(() => window.nativeState), {autostart:true,clipboard:true,history:true}, 'listen failure does not disable direct setting actions');
  for (const theme of ['light', 'dark']) {
    await fixture.goto(`${fixtureServer.resolvedUrls.local[0]}shortcut-settings-fixture?theme=${theme}`);
    await fixture.waitForFunction(() => document.querySelector('#screenshotShortcutStatus')?.textContent);
    const conflictLabel = await fixture.locator('#screenshotShortcutStatus').textContent();
    await fixture.locator('#screenshotHistoryToggle').click();
    await fixture.waitForFunction(() => document.querySelector('#screenshotHistoryToggle').getAttribute('aria-checked') === 'true');
    assert.equal(await fixture.evaluate(() => window.shortcutAttempts), 0);
    assert.equal(await fixture.locator('#screenshotShortcutStatus').textContent(), conflictLabel, 'history success retains shortcut warning');
    await fixture.locator('#screenshotHistoryToggle').click();
    await fixture.waitForFunction(() => !window.settings.history);
    await fixture.locator('#screenshotShortcutSave').click();
    await fixture.waitForFunction(() => !document.querySelector('#screenshotPageError').hidden);
    assert.equal(await fixture.evaluate(() => window.shortcutAttempts), 1, 'explicit same-key save retries');
    await fixture.evaluate(() => { window.shortcutConflict = false; });
    await fixture.locator('#screenshotShortcutSave').click();
    await fixture.waitForFunction(() => window.settings.registered === 'Alt+Q');
    await fixture.locator('#screenshotShortcutDisable').click();
    await fixture.waitForFunction(() => window.settings.shortcut === null);
    const attempts = await fixture.evaluate(() => window.shortcutAttempts);
    await fixture.locator('#screenshotHistoryToggle').click();
    await fixture.waitForFunction(() => window.settings.history);
    assert.equal(await fixture.evaluate(() => window.shortcutAttempts), attempts);
    assert.equal(await fixture.evaluate(() => window.settings.registered), null, 'history does not enable a disabled shortcut');
  }
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log('PASS mode UI: double themes, native state verification, restart restore, failure rollback, help link, temporary/permanent dismissal');
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await browser.close();
  await server.httpServer.close();
  await fixtureServer.close();
}
