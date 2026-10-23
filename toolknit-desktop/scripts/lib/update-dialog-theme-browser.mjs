import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export async function checkUpdateDialogTheme(browser, url, output) {
  await mkdir(output, { recursive: true });
  const { version } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const currentTag = `v${version}`;
  const latestTag = `v${Number(version.split('.')[0]) + 1}.0.0`;
  const errors = [];
  for (const theme of ['light', 'dark']) {
    for (const language of ['zh', 'en']) {
      const context = await browser.newContext({ viewport: { width: 1400, height: 887 }, reducedMotion: 'reduce' });
      try {
        await context.route('**/*', route => {
          const target = new URL(route.request().url());
          if (target.origin === new URL(url).origin) return route.continue();
          return route.fulfill({ status: 200, contentType: 'application/json',
            body: target.pathname.endsWith('/tags') ? JSON.stringify([{ name: latestTag }]) : '{}' });
        });
        await context.addInitScript(({ theme, language }) => {
          localStorage.setItem('toolknit.theme.v3', theme);
          localStorage.setItem('toolknit-lang', language);
        }, { theme, language });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.text().includes('Blocked aria-hidden')) errors.push(message.text()); });
        await page.goto(url);
        await page.waitForFunction(() => !document.querySelector('#appStartupMask') && document.querySelector('#homeToolGrid .tool-result-card'));
        await page.locator('#homeV2Settings').click();
        await page.locator('#checkVersionUpdateBtn').click();
        const dialog = page.locator('#updateDialog');
        await dialog.waitFor({ state: 'visible' });
        assert.equal(await dialog.evaluate(node => node.matches(':modal')), true);
        assert.equal(await dialog.locator('[data-update-current]').textContent(), currentTag);
        assert.equal(await dialog.locator('[data-update-latest]').textContent(), latestTag);
        assert.equal(await dialog.locator('button').count(), 1, 'Only download is available');
        assert.equal(await dialog.locator('.update-dialog-symbol svg').evaluate(node => getComputedStyle(node).color),
          theme === 'light' ? 'rgb(17, 17, 17)' : 'rgb(255, 255, 255)', 'Rocket follows the monochrome theme');
        assert.equal(await dialog.locator('button').evaluate(node => getComputedStyle(node).outlineStyle), 'none', 'Automatic focus has no outline');
        assert.equal(await dialog.locator('.update-dialog-symbol svg').evaluate(node => getComputedStyle(node).animationName), 'none', 'Reduced motion disables the loop');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        const rocket = dialog.locator('.update-dialog-symbol svg');
        await rocket.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.ready)));
        const motion = await rocket.evaluate(node => {
          const animation = node.getAnimations()[0];
          animation.pause();
          animation.currentTime = 0;
          const start = getComputedStyle(node).transform;
          animation.currentTime = 1344;
          const middle = getComputedStyle(node).transform;
          animation.play();
          return { start, middle, iterations: animation.effect.getTiming().iterations };
        });
        assert.notEqual(motion.start, motion.middle, 'Rocket visibly moves through the loop');
        assert.equal(motion.iterations, Infinity, 'Rocket animation repeats');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        for (const [width, height] of [[1400, 887], [1024, 480], [720, 480], [390, 740]]) {
          await page.setViewportSize({ width, height });
          const metrics = await dialog.evaluate(node => {
            const r = node.getBoundingClientRect(), s = getComputedStyle(node);
            return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, scroll: node.scrollWidth, width: node.clientWidth,
              background: s.backgroundColor, foreground: s.color };
          });
          assert.ok(metrics.x >= 0 && metrics.y >= 0 && metrics.right <= width && metrics.bottom <= height);
          assert.ok(Math.abs(metrics.x - (width - (metrics.right - metrics.x)) / 2) <= 1, 'Dialog is horizontally centered');
          assert.ok(Math.abs(metrics.y - (height - (metrics.bottom - metrics.y)) / 2) <= 1, 'Dialog is vertically centered');
          assert.ok(metrics.scroll <= metrics.width + 1, 'No horizontal overflow');
          assert.equal(metrics.background, theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(24, 24, 24)');
          assert.equal(metrics.foreground, theme === 'light' ? 'rgb(24, 24, 24)' : 'rgb(245, 245, 245)');
          await page.screenshot({ path: path.join(output, `${theme}-${language}-${width}x${height}.png`) });
        }
        await page.keyboard.press('Escape');
        assert.equal(await dialog.evaluate(node => node.open), true, 'Escape cannot dismiss');
        await page.mouse.click(2, 2);
        assert.equal(await dialog.evaluate(node => node.open), true, 'Backdrop cannot dismiss');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-update-download')), true);
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-update-download')), true);
        await page.locator('#settingsBack').evaluate(node => node.focus());
        assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-update-download')), true, 'Native modal prevents background focus');
        // Exercise the same public check action twice; there must still be one modal.
        await page.locator('#checkVersionUpdateBtn').evaluate(node => node.click());
        assert.equal(await page.locator('dialog:modal').count(), 1);
        // Browser opener returns true; native opener failures are tested separately.
        await page.evaluate(() => { window.open = () => null; });
        await dialog.locator('[data-update-download]').click();
        await page.waitForFunction(() => document.querySelector('.update-dialog-status').textContent.length > 0);
        assert.equal(await dialog.evaluate(node => node.open), true, 'Opening the download page does not unlock');
        assert.ok(await dialog.locator('.update-dialog-status').textContent());
      } finally { await context.close(); }
    }
  }
  assert.deepEqual(errors, []);
  return 'Update modal: four theme/language combinations, four viewports, focus lock, Escape/backdrop, repeated check and download';
}
