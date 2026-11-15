import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function checkSecondaryTheme(browser, url, output) {
  await mkdir(output, { recursive: true });
  const report = { layouts: [], errors: [] };
  const origin = new URL(url).origin;
  for (const language of ['zh', 'en']) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 887 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.text().includes('Blocked aria-hidden')) report.errors.push(message.text()); });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin
      ? route.continue() : route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await context.addInitScript(lang => {
      localStorage.setItem('toolknit.theme.v3', 'light');
      localStorage.setItem('toolknit-lang', lang);
    }, language);
    const settle = () => page.waitForFunction(() => {
      const veil = document.querySelector('[data-tk-page-transition-veil]');
      return !veil || getComputedStyle(veil).visibility === 'hidden';
    });
    const click = async selector => { await page.locator(selector).first().click(); await settle(); };
    const style = (selector, key) => page.locator(selector).first().evaluate((n, property) => getComputedStyle(n)[property], key);
    const capture = name => page.screenshot({ path: path.join(output, `${language}-${name}.png`), animations: 'disabled' });
    const closed = id => page.waitForFunction(selector => !document.querySelector(selector).classList.contains('visible'), id);
    async function layout(root, name, scroll) {
      await page.evaluate(() => document.fonts.ready);
      await page.locator(scroll).evaluate(n => { n.scrollTop = 0; });
      const failures = await page.locator(root).evaluate(overlay => {
        const failures = [];
        for (const n of overlay.querySelectorAll('button, input, h1, h2, h3, h4, p, .api-key-dropdown-trigger, .donation-qr-card')) {
          if (n.closest('.feedback-marquee')) continue;
          const r = n.getBoundingClientRect();
          if (!r.width || !r.height || getComputedStyle(n).visibility === 'hidden') continue;
          if (r.left < -1 || r.right > innerWidth + 1 || (n.tagName !== 'INPUT' && n.scrollWidth > n.clientWidth + 2)) failures.push(n.id || n.className);
        }
        return failures;
      });
      assert.deepEqual(failures, [], `${language} ${name}: text and controls fit`);
      assert.equal(await style(root, 'backgroundColor'), 'rgb(255, 255, 255)');
      await capture(name);
      await page.locator(scroll).evaluate(n => { n.scrollTop = n.scrollHeight; });
      assert.ok(await page.locator(scroll).evaluate(n => n.scrollTop + n.clientHeight >= n.scrollHeight - 1));
      await capture(`${name}-bottom`);
      report.layouts.push({ language, name, viewport: page.viewportSize() });
    }
    async function openKey() {
      await click('#settingsApiKey');
      await page.waitForFunction(() => document.querySelector('#apiKeyOverlay').classList.contains('visible'));
      await settle();
    }
    try {
      await page.goto(url);
      await page.waitForSelector('#homeToolGrid .tool-result-card');
      await click('#homeV2Settings');
      await click('#feedbackLink');
      assert.equal(await page.locator('#lightraysBg canvas').count(), 0);
      assert.equal(await style('#feedbackCta', 'color'), 'rgb(255, 255, 255)');
      assert.equal(await style('.feedback-hero-title', 'color'), 'rgb(17, 17, 17)');
      assert.equal(await style('.marquee-card', 'backgroundColor'), 'rgb(231, 232, 234)');
      assert.equal(await style('.marquee-avatar', 'backgroundColor'), 'rgb(64, 66, 71)');
      for (const [width, height] of [[1400, 887], [1024, 480], [820, 600], [720, 480], [390, 740]]) {
        await page.setViewportSize({ width, height });
        await layout('#feedbackOverlay', `feedback-${width}`, '.feedback-body');
      }
      await page.locator('#feedbackBack').hover();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#feedbackBack')).width === '64px');
      assert.equal(await style('#feedbackBack', 'backgroundColor'), 'rgb(17, 17, 17)');
      await click('#feedbackBack');
      await closed('#feedbackOverlay');
      await page.setViewportSize({ width: 1400, height: 887 });
      await click('#settingsBack');
      await click('.app .home-v2-support-top');
      await page.waitForFunction(() => document.querySelector('#donationJournalReaderTitle').textContent.length > 0);
      assert.deepEqual(await page.locator('.donation-qr-card img').evaluateAll(nodes => nodes.map(n => n.complete && n.naturalWidth > 0)), [true, true]);
      for (const [width, height] of [[1400, 887], [1024, 480], [820, 600], [720, 480], [390, 740]]) {
        await page.setViewportSize({ width, height });
        await layout('#donationOverlay', `support-${width}`, '.donation-scroll');
        await page.locator('#donationJournalReader').scrollIntoViewIfNeeded();
        const fits = await page.locator('#donationJournalReader').evaluate(n => n.querySelector('.donation-journal-reader-body').getBoundingClientRect().bottom <= n.querySelector('.donation-journal-reader-hint').getBoundingClientRect().top);
        assert.ok(fits, 'journal body does not overlap the pause hint');
        await capture(`support-journal-${width}`);
      }
      const reader = page.locator('#donationJournalReader');
      await reader.focus();
      await page.keyboard.press('Enter');
      assert.equal(await reader.getAttribute('aria-pressed'), 'true');
      assert.equal(await style('#donationJournalReader', 'backgroundColor'), 'rgb(221, 223, 226)');
      await page.keyboard.press('Enter');
      assert.equal(await reader.getAttribute('aria-pressed'), 'false');
      await click('[data-donation-top]');
      await page.waitForFunction(() => document.querySelector('.donation-scroll').scrollTop === 0);
      await page.keyboard.press('Escape');
      await closed('#donationOverlay');
      await page.setViewportSize({ width: 1400, height: 887 });
      await click('#homeV2Settings');
      await openKey();
      const keyCentering = await page.locator('#apiKeyOverlay').evaluate(overlay => {
        const content = overlay.querySelector('.api-key-content').getBoundingClientRect();
        const section = overlay.querySelector('.api-key-section').getBoundingClientRect();
        return Math.abs((section.top + section.bottom) / 2 - (content.top + content.bottom) / 2);
      });
      // The asymmetric 32px/48px vertical padding intentionally leaves room
      // for the bottom action area while keeping the card centered in the
      // usable scroll region.
      assert.ok(keyCentering <= 10, `${language} AI key content is centered in its scroll region`);
      await click('#apiKeySave');
      assert.equal(await style('#apiKeyStatus', 'color'), 'rgb(157, 34, 34)');
      await capture('api-empty-error');
      for (const value of ['openai', 'qwen', 'moonshot', 'deepseek', 'custom']) {
        await click('#apiKeyDropdownTrigger');
        await capture(`api-menu-${value}`);
        await click(`#apiKeyDropdownMenu [data-value="${value}"]`);
        assert.equal(await page.locator('#apiKeyDropdownMenu .active').getAttribute('data-value'), value);
        assert.equal(await style('#apiKeyDropdownMenu .active', 'color'), 'rgb(255, 255, 255)');
      }
      for (const [width, height] of [[1400, 887], [1024, 480], [820, 600], [720, 480], [390, 740]]) {
        await page.setViewportSize({ width, height });
        await layout('#apiKeyOverlay', `api-custom-${width}`, '.api-key-content');
        await page.locator('#apiKeySave').scrollIntoViewIfNeeded();
        assert.equal(await style('#apiKeySave', 'backgroundColor'), 'rgb(17, 17, 17)');
      }
      await click('#apiKeyPrivateHttpSwitch');
      assert.equal(await page.locator('#apiKeyPrivateHttpSwitch').getAttribute('aria-checked'), 'true');
      await click('#apiKeyPrivateHttpSwitch');
      await page.locator('#apiKeyInput').fill('test-only-not-a-real-key');
      await click('#apiKeyToggle');
      assert.equal(await page.locator('#apiKeyInput').getAttribute('type'), 'text');
      await click('#apiKeyToggle');
      await page.locator('#apiKeyCustomUrl').fill('https://example.com/v1/chat/completions');
      await page.locator('#apiKeyCustomModel').fill('fixture-model');
      await click('#apiKeySave');
      await page.waitForSelector('#apiKeyStatus.success');
      assert.equal(await style('#apiKeyStatus', 'color'), 'rgb(27, 99, 61)');
      await closed('#apiKeyOverlay');
      await openKey();
      assert.equal(await page.locator('#apiKeyCustomModel').inputValue(), 'fixture-model');
      await click('#apiKeyClear');
      await closed('#apiKeyOverlay');
      await openKey();
      assert.equal(await page.locator('#apiKeyInput').inputValue(), '');
      await page.locator('#apiKeyBack').hover();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#apiKeyBack')).width === '64px');
      assert.equal(await style('#apiKeyBack', 'backgroundColor'), 'rgb(17, 17, 17)');
      assert.equal(await style('#apiKeyBack', 'borderRadius'), '999px');
      assert.equal(await page.locator('#apiKeyBack svg').count(), 1);
      await click('#apiKeyBack');
      await page.setViewportSize({ width: 1400, height: 887 });
      await click('[data-theme-choice="dark"]');
      await openKey();
      assert.equal(await style('#apiKeyOverlay', 'backgroundColor'), 'rgba(10, 10, 15, 0.98)');
      await capture('dark-api');
      await click('#apiKeyBack');
      await click('#feedbackLink');
      assert.equal(await style('#feedbackOverlay', 'backgroundColor'), 'rgb(10, 10, 15)');
      await capture('dark-feedback');
      await click('#feedbackBack');
      await click('[data-theme-choice="light"]');
      await click('#feedbackLink');
      assert.equal(await page.locator('#lightraysBg canvas').count(), 0);
      await click('#feedbackBack');
      await click('#settingsBack');
      await page.reload();
      await page.waitForSelector('#homeToolGrid .tool-result-card');
      await click('.app .home-v2-support-top');
      assert.equal(await style('.donation-dialog', 'backgroundColor'), 'rgb(255, 255, 255)');
      await click('.donation-close');
      await closed('#donationOverlay');
    } catch (error) {
      await capture('failure').catch(() => {});
      throw error;
    } finally {
      await context.close();
      await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    }
  }
  assert.deepEqual(report.errors, []);
  return `${report.layouts.length} feedback/support/AI settings layouts and isolated configuration interactions`;
}
