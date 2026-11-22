import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { PDFDocument } from 'pdf-lib';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/pdf-security-navigation/browser');
await mkdir(output, { recursive: true });
const pdf = await PDFDocument.create();
pdf.addPage([420, 595]).drawText('ToolKnit password navigation fixture');
const file = { name: 'navigation-fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await chromium.launch({ headless: true,
  ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
const report = { layouts: [], flows: [], errors: [], windowActions: 'Global chrome contract covers minimize/maximize/close dispatch; browser does not control OS windows.' };
const viewports = [[1400, 887], [1100, 700], [720, 480], [720, 320]];

try {
  const url = server.resolvedUrls.local[0];
  for (const theme of ['light', 'dark']) {
    for (const language of ['zh', 'en']) {
      const context = await browser.newContext({ viewport: { width: 1400, height: 887 } });
      await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin
        ? route.continue() : route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
      await context.addInitScript(({ theme, language }) => {
        localStorage.setItem('toolknit.theme.v3', theme);
        localStorage.setItem('toolknit-lang', language);
        window.__testOpenedUrls = [];
        window.open = url => { window.__testOpenedUrls.push(String(url)); return null; };
      }, { theme, language });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('console', message => {
        if (message.text().includes('Blocked aria-hidden')) report.errors.push(message.text());
      });
      page.on('dialog', dialog => dialog.dismiss());
      const settle = () => page.waitForFunction(() => {
        const veil = document.querySelector('[data-tk-page-transition-veil]');
        return !veil || getComputedStyle(veil).visibility === 'hidden';
      });
      const openTool = async tool => {
        await page.evaluate(tool => document.querySelector(`.audio-list-item[data-tool="${tool}"]`).click(), tool);
        const id = { 'pdf-compress': 'pdfCompressOverlay', 'pdf-encrypt': 'pdfEncryptOverlay', 'pdf-decrypt': 'pdfDecryptOverlay' }[tool];
        await page.waitForSelector(`#${id}.visible`);
        await settle();
      };
      const passwordReady = selector => page.waitForFunction(selector => {
        const root = document.querySelector(selector);
        return root?.classList.contains('visible') && !root.inert && getComputedStyle(root).opacity === '1';
      }, selector);
      try {
        await page.goto(url);
        await page.waitForSelector('#homeToolGrid .tool-result-card');
        await openTool('pdf-compress');
        const templates = new Map();
        for (const [width, height] of viewports) {
          await page.setViewportSize({ width, height });
          templates.set(`${width}-${height}`, await page.locator('#pdfCompressOverlay > .pdf-merge-v2-topbar').evaluate(node => {
            const s = getComputedStyle(node);
            return { height: node.getBoundingClientRect().height, padding: s.padding, background: s.backgroundColor };
          }));
        }
        await page.setViewportSize({ width: 1400, height: 887 });
        await page.locator('#pdfCompressBack').click();
        await settle();
        for (const kind of ['encrypt', 'decrypt']) {
          const prefix = kind === 'encrypt' ? 'pdfEncrypt' : 'pdfDecrypt';
          const overlay = `#${prefix}Overlay`;
          const dialog = `#${prefix}PasswordDialog`;
          const label = `${theme}-${language}-${kind}`;
          await openTool(`pdf-${kind}`);
          await page.evaluate(selector => {
            window.__originalSecurityBar = document.querySelector(`${selector} > .pdf-merge-v2-topbar`);
          }, overlay);
          await page.locator(`#${prefix}Input`).setInputFiles(file);
          await page.locator(`#${prefix}ProcessBtn`).click();
          await passwordReady(dialog);
          assert.equal(await page.locator(overlay).evaluate(node => node.inert), true, 'password page suspends only its parent tool');
          assert.equal(await page.locator(`${dialog} > .pdf-merge-v2-topbar`).evaluate(node => node === window.__originalSecurityBar), true, 'the same navigation node is reused');
          assert.equal(await page.locator(`#${prefix}Back`).count(), 1);
          assert.equal(await page.locator(`#${prefix}Back`).innerText(), language === 'zh' ? '返回上一级' : 'Back');
          assert.equal(await page.locator(dialog).getAttribute('aria-hidden'), 'false');

          for (const [width, height] of viewports) {
            await page.setViewportSize({ width, height });
            const template = templates.get(`${width}-${height}`);
            const metrics = await page.locator(dialog).evaluate(root => {
              const bar = root.querySelector('.pdf-merge-v2-topbar');
              const box = bar.getBoundingClientRect();
              const style = getComputedStyle(bar);
              const panel = root.querySelector('.pdf-encrypt-password-dialog');
              const r = panel.getBoundingClientRect();
              return {
                nav: { height: box.height, padding: style.padding, background: style.backgroundColor },
                atTop: box.top === 0 && box.left === 0 && box.right === innerWidth,
                panelFits: r.top >= box.bottom && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
                noHorizontalOverflow: panel.scrollWidth <= panel.clientWidth + 1,
                controls: [...bar.querySelectorAll('button')].map(button => {
                  const r = button.getBoundingClientRect();
                  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                  return { enabled: !button.disabled, visible: r.width > 0 && r.height > 0,
                    reachable: hit === button || button.contains(hit), icons: [...button.querySelectorAll('svg')].filter(icon => getComputedStyle(icon).opacity !== '0').length };
                })
              };
            });
            assert.equal(metrics.nav.height, template.height);
            assert.equal(metrics.nav.background, template.background);
            if (width >= 1100) assert.equal(metrics.nav.padding, template.padding);
            assert.ok(metrics.atTop && metrics.panelFits && metrics.noHorizontalOverflow, `${label} ${width}x${height}: layout fits`);
            assert.equal(metrics.controls.length, 9, 'Back, website, support, help, feedback, settings and three window controls');
            assert.equal(await page.locator(`${dialog} > .pdf-merge-v2-topbar [data-tool-help]`).count(), 1);
            assert.equal(await page.locator(`${dialog} > .pdf-merge-v2-topbar [data-tool-feedback]`).count(), 1);
            assert.ok(metrics.controls.every(control => control.enabled && control.visible && control.reachable && control.icons === 1));
            await page.locator(`${dialog} .pdf-encrypt-password-dialog`).evaluate(panel => { panel.scrollTop = panel.scrollHeight; });
            assert.equal(await page.locator(`#${prefix}PasswordConfirm`).evaluate(button => {
              const r = button.getBoundingClientRect();
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return hit === button || button.contains(hit);
            }), true, 'confirm stays reachable in a short window');
            await page.screenshot({ path: path.join(output, `${label}-${width}-${height}.png`) });
            report.layouts.push({ label, width, height, ...metrics });
          }

          await page.setViewportSize({ width: 1400, height: 887 });
          await page.locator(`${dialog} .pdf-encrypt-password-dialog`).evaluate(panel => { panel.scrollTop = 0; });
          await page.locator(`#${prefix}Back`).hover();
          await page.waitForFunction(selector => getComputedStyle(document.querySelector(selector)).width === '64px', `#${prefix}Back`);
          const hover = await page.locator(`#${prefix}Back`).evaluate(node => {
            const probe = document.createElement('span');
            probe.style.backgroundColor = 'var(--tk-nav-ink)';
            node.append(probe);
            const expected = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return { actual: getComputedStyle(node).backgroundColor, expected };
          });
          assert.equal(hover.actual, hover.expected, 'back uses the shared inverse capsule token');
          await page.locator(`#${prefix}PasswordInput`).fill('ToolKnit-test-42');
          await page.locator(`#${prefix}PasswordConfirm`).focus();
          await page.keyboard.press('Tab');
          assert.equal(await page.evaluate(() => document.activeElement.id), `${prefix}Back`, 'Tab wraps inside the password page');
          await page.locator(`${dialog} [data-home-link="website"]`).click();
          assert.ok(await page.evaluate(() => window.__testOpenedUrls.includes('https://toolknit.com/')));
          await page.locator(`${dialog} [data-open-support]`).click();
          await page.waitForSelector('#donationOverlay.visible');
          await page.locator('#donationOverlay [data-donation-close]').first().click();
          await page.waitForFunction(() => !document.querySelector('#donationOverlay').classList.contains('visible'));
          assert.equal(await page.locator(`#${prefix}PasswordInput`).inputValue(), 'ToolKnit-test-42', 'support navigation retains the password form');
          await page.locator(`#${prefix}V2Settings`).click();
          await settle();
          await page.waitForSelector('#settingsOverlay.visible');
          for (const nextLanguage of [language === 'zh' ? 'en' : 'zh', language]) {
            await page.locator(`#settingsOverlay [data-lang="${nextLanguage}"]`).click();
            await page.waitForFunction(lang => document.documentElement.lang === (lang === 'zh' ? 'zh-CN' : 'en')
              && !document.body.matches('.fade-in, .fade-out')
              && !document.querySelector('#transitionMask').classList.contains('visible'), nextLanguage);
            assert.equal(await page.locator(`#${prefix}Back`).innerText(), nextLanguage === 'zh' ? '返回上一级' : 'Back', 'language changes preserve the subpage Back meaning');
          }
          await page.locator('#settingsBack').click();
          await settle();
          assert.equal(await page.locator(`#${prefix}PasswordInput`).inputValue(), 'ToolKnit-test-42', 'settings returns to the same form');

          for (const exit of ['back', 'cancel', 'escape']) {
            if (exit === 'back') await page.locator(`#${prefix}Back`).click();
            else if (exit === 'cancel') await page.locator(`#${prefix}PasswordCancel`).click();
            else {
              await page.locator(`#${prefix}PasswordInput`).focus();
              await page.keyboard.press('Escape');
            }
            await page.waitForFunction(selector => !document.querySelector(selector).classList.contains('visible') && document.querySelector(selector).inert, dialog);
            assert.equal(await page.locator(`${overlay} > .pdf-merge-v2-topbar`).evaluate(node => node === window.__originalSecurityBar), true);
            assert.equal(await page.locator(overlay).evaluate(node => node.classList.contains('visible') && !node.inert), true);
            assert.equal(await page.locator(`#${prefix}Files .audio-convert-file-name`).innerText(), file.name);
            assert.equal(await page.locator(`#${prefix}PasswordInput`).inputValue(), '', 'leaving password entry clears secrets');
            await page.locator(`#${prefix}ProcessBtn`).click();
            await passwordReady(dialog);
          }
          if (kind === 'encrypt' && theme === 'light' && language === 'zh') {
            await page.locator('#pdfEncryptPasswordInput').fill('ToolKnit-test-42');
            await page.locator('#pdfEncryptConfirmInput').fill('different-password');
            await page.locator('#pdfEncryptPasswordConfirm').click();
            assert.equal(await page.locator(dialog).evaluate(node => node.classList.contains('visible')), true, 'password mismatch keeps the form open');
            await page.locator('#pdfEncryptConfirmInput').fill('ToolKnit-test-42');
            const downloadPromise = page.waitForEvent('download');
            await page.locator('#pdfEncryptPasswordConfirm').click();
            const download = await downloadPromise;
            const stream = await download.createReadStream();
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const result = Buffer.concat(chunks);
            assert.ok(result.length > 200 && result.includes(Buffer.from('/Encrypt')));
            await page.waitForSelector('#pdfEncryptSuccessOverlay.visible');
            await page.locator('#pdfEncryptSuccessOk').click();
            report.flows.push('real browser PDF encryption and output passed');
          } else {
            await page.locator(`#${prefix}PasswordCancel`).click();
          }
          await page.locator(`#${prefix}Back`).click();
          await settle();
          await openTool(`pdf-${kind}`);
          assert.equal(await page.locator(`${overlay} > .pdf-merge-v2-topbar`).count(), 1);
          assert.equal(await page.locator(`#${prefix}Files .audio-convert-file-name`).count(), 0, 'new tool session starts with an empty queue');
          await page.locator(`#${prefix}Back`).click();
          await settle();
          report.flows.push(`${label}: upload, navigation, focus, back/cancel/Escape and reopen`);
        }
      } catch (error) {
        await page.screenshot({ path: path.join(output, `${theme}-${language}-failure.png`) }).catch(() => {});
        throw error;
      } finally { await context.close(); }
    }
  }
  assert.deepEqual(report.errors, []);
  console.log(`PDF security navigation passed: ${report.layouts.length} layouts, ${report.flows.length} flows.`);
} catch (error) {
  report.failure = String(error.stack || error);
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
