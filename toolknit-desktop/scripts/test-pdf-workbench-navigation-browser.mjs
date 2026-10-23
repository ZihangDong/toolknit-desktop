import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';

const baseline = process.argv.includes('--baseline');
const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/pdf-workbench-navigation');
await mkdir(output, { recursive: true });
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
for (let index = 0; index < 3; index++) pdf.addPage([420, 595]).drawText(`Navigation / page ${index + 1}`, { x: 30, y: 520, font, size: 18 });
const fixture = { name: 'navigation.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await chromium.launch({ headless: true,
  ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
const report = { baseline, checks: [], failures: [], errors: [], warnings: [] };
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 887 }, reducedMotion: 'reduce' });
  const url = server.resolvedUrls.local[0];
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin
    ? route.continue() : route.fulfill({ body: '{}', contentType: 'application/json' }));
  await context.addInitScript(() => {
    localStorage.setItem('toolknit.theme.v3', 'light');
    localStorage.setItem('toolknit-lang', 'zh');
  });
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) report.warnings.push(message.text()); });
  const settle = () => page.waitForFunction(() => {
    const veil = document.querySelector('[data-tk-page-transition-veil]');
    return !veil || getComputedStyle(veil).visibility === 'hidden';
  });
  async function inspect(root, label, full = false) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      for (const [width, height] of full ? [[1400, 887], [1100, 700], [900, 520], [720, 480]] : [[1400, 887]]) {
        await page.setViewportSize({ width, height });
        await page.mouse.move(2, height - 2);
        const state = await root.evaluate(node => {
          const header = node.querySelector('header');
          const rect = element => {
            const r = element?.getBoundingClientRect();
            return r ? { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height, center: r.y + r.height / 2 } : null;
          };
          const buttons = [...header.querySelectorAll('button')].map(button => ({
            box: rect(button), icon: rect(button.querySelector('svg')), name: button.dataset.navMotion,
            prepared: button.classList.contains('tk-nav-button'), region: getComputedStyle(button).webkitAppRegion,
            morphIcons: button.querySelectorAll('.tk-nav-morph > svg').length,
            label: button.getAttribute('aria-label') || button.title || button.textContent.trim()
          }));
          return { prepared: header.classList.contains('tk-tool-nav'), box: rect(header), background: getComputedStyle(header).backgroundColor,
            back: rect(header.querySelector('.pdf-merge-v2-back, .tool-page-v2-back')), buttons,
            help: header.querySelectorAll('[data-tool-help]').length, feedback: header.querySelectorAll('[data-tool-feedback]').length,
            windows: header.querySelectorAll('[data-tool-window], [data-ppt-window-action], [data-window-action], .home-v2-window-controls [data-action]').length,
            bodyTop: node.querySelector('.pdf-workbench-body')?.checkVisibility()
              ? node.querySelector('.pdf-workbench-body').getBoundingClientRect().top : null };
        });
        const problems = [];
        if (!state.prepared) problems.push('shared chrome not initialized');
        if (state.help !== 1 || state.feedback !== 1 || state.windows !== 3) problems.push('missing or duplicate navigation actions');
        if (state.background !== (theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(8, 8, 9)')) problems.push('wrong navigation surface');
        if (!state.back || state.back.x < 20 || state.back.width !== 36 || state.back.height !== 36) problems.push('back button geometry');
        for (const button of state.buttons) {
          if (!button.prepared || !button.label || !button.icon?.width || button.region !== 'no-drag') problems.push(`unprepared action: ${button.name || button.label}`);
          if (['web', 'support', 'help', 'feedback'].includes(button.name) && button.morphIcons !== 2) problems.push(`lost morph icons: ${button.name}`);
          if (button.box.x < 0 || button.box.right > width + 1 || button.box.y < state.box.y || button.box.bottom > state.box.bottom + 1) problems.push(`clipped action: ${button.name}`);
          if (width > 780 && Math.abs(button.box.center - state.box.center) > 1) problems.push(`misaligned action: ${button.name}`);
        }
        if (state.bodyTop != null && state.bodyTop < state.box.bottom - 1) problems.push('navigation overlaps workspace');
        if (problems.length) report.failures.push({ label, theme, width, problems, state });
        if (full && [1400, 720].includes(width)) await page.screenshot({ path: path.join(output, `${baseline ? 'before' : 'after'}-${label}-${theme}-${width}.png`) });
      }
    }
    report.checks.push(label);
    await page.setViewportSize({ width: 1400, height: 887 });
  }
  async function open(tool) {
    await page.evaluate(id => document.querySelector(`.audio-list-item[data-tool="${id}"]`).click(), tool);
    const root = page.locator(`#${LAZY_TOOL_SPECS[tool].overlayId}`);
    await root.waitFor({ state: 'visible' }); await settle();
    return root;
  }
  const nested = {
    'pdf-split': { workspace: 'pdfSplitWorkspace', cta: 'pdfSplitCta', process: 'pdfSplitProcessBtn' },
    'pdf-merge': { workspace: 'pdfMergeWorkspace', cta: 'pdfMergeCta', process: 'pdfMergeProcessBtn', multiple: true },
    'pdf-rotate': { workspace: 'pdfRotateWorkspace', input: 'pdfRotateInput', process: 'pdfRotateProcessBtn' },
    'pdf-to-image': { workspace: 'pdfToImageWorkspace', input: 'pdfToImageFileInput' }
  };
  async function upload(spec) {
    if (spec.input) await page.locator(`#${spec.input}`).setInputFiles(fixture);
    else {
      const chooser = page.waitForEvent('filechooser');
      await page.locator(`#${spec.cta}`).click();
      await (await chooser).setFiles(spec.multiple ? [fixture, { ...fixture, name: 'navigation-second.pdf' }] : fixture);
    }
    if (spec.process) await page.locator(`#${spec.process}`).click();
    await page.locator(`#${spec.workspace}.visible`).waitFor();
    await page.waitForFunction(id => document.querySelector(`#${id} [data-wb-canvas]`)?.width > 10, spec.workspace);
  }
  await page.goto(url);
  await page.waitForSelector('#homeToolGrid .tool-result-card');
  for (const tool of Object.keys(LAZY_TOOL_SPECS).filter(tool => tool.startsWith('pdf-') || tool === 'image-to-pdf')) {
    const root = await open(tool);
    await inspect(root, tool);
    if (nested[tool]) {
      const spec = nested[tool]; await upload(spec);
      const workspace = page.locator(`#${spec.workspace}`);
      await inspect(workspace, `${tool}-workspace`, true);
      if (!baseline) {
        const tileCount = await workspace.locator('.pdf-editor-tile').count();
        for (const [action, overlay, back] of [['help', 'helpOverlay', 'helpBackBtn'], ['feedback', 'feedbackOverlay', 'feedbackBack'], ['settings', 'settingsOverlay', 'settingsBack']]) {
          await workspace.locator(`[data-tool-${action}]`).click();
          await page.locator(`#${overlay}.visible`).waitFor(); await settle();
          await page.locator(`#${back}`).click(); await settle();
          await page.waitForFunction(id => { const n = document.getElementById(id); return n.classList.contains('visible') && !n.inert; }, spec.workspace);
          assert.equal(await workspace.locator('.pdf-editor-tile').count(), tileCount, 'subpage navigation preserves loaded pages');
          if (action === 'settings') {
            await workspace.locator('[data-tool-settings]').click();
            await page.locator('#settingsOverlay.visible').waitFor(); await settle();
            if (tool === 'pdf-split') {
              await page.locator('#localTranslationManage').click();
              await page.locator('#localTranslationOverlay.visible').waitFor();
              await page.keyboard.press('Escape');
              await page.waitForFunction(() => !document.querySelector('#localTranslationOverlay').classList.contains('visible'));
              assert.equal(await page.locator('#settingsOverlay').evaluate(node => node.classList.contains('visible') && !node.inert), true, 'model manager Escape keeps Settings open');
              await page.evaluate(() => document.activeElement?.blur());
            }
            await page.keyboard.press('Escape');
            await page.waitForFunction(() => !document.querySelector('#settingsOverlay').classList.contains('visible'));
            await settle();
            assert.equal(await workspace.evaluate(node => node.classList.contains('visible') && !node.inert), true, 'Settings Escape restores the loaded workspace');
            assert.equal(await workspace.locator('.pdf-editor-tile').count(), tileCount, 'Settings Escape does not close or reset the background tool');
          }
        }
        await workspace.locator('[data-tool-support]').click();
        await page.locator('#donationOverlay.visible').waitFor();
        await page.keyboard.press('Escape');
        await page.waitForFunction(id => !document.querySelector('#donationOverlay').classList.contains('visible') && !document.getElementById(id).inert, spec.workspace);
        await page.evaluate(() => document.querySelector('[data-lang="en"]').click());
        await page.waitForFunction(() => document.documentElement.lang === 'en');
        assert.equal(await workspace.locator('[data-tool-help]').getAttribute('aria-label'), 'Help Center');
        assert.match(await workspace.locator('.tk-nav-back').getAttribute('aria-label'), /Back|Close/);
        await page.evaluate(() => document.querySelector('[data-lang="zh"]').click());
        await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
        for (const action of ['website', 'support']) assert.equal(await workspace.locator(`[data-tool-${action}] .tk-nav-morph > svg`).count(), 2, 'translation preserves both animation icons');
      }
      await workspace.locator('.tool-page-v2-back').click();
      await page.waitForFunction(id => !document.getElementById(id).classList.contains('visible'), spec.workspace);
      await upload(spec);
      if (!baseline) assert.equal(await workspace.locator('[data-tool-help]').count(), 1, 'reopen does not duplicate controls');
      await page.keyboard.press('Escape');
      await page.waitForFunction(id => !document.getElementById(id).classList.contains('visible'), spec.workspace);
      report.checks.push(`${tool}: back/reopen/Escape${baseline ? '' : '/help/feedback/settings/support/language'}`);
    }
    await root.locator('.tk-nav-back').first().click(); await settle();
    await page.waitForFunction(id => !document.getElementById(id).classList.contains('visible'), LAZY_TOOL_SPECS[tool].overlayId);
  }
  assert.deepEqual(report.errors, []);
  assert.ok(!report.warnings.some(text => /aria-hidden/.test(text)), report.warnings.join('\n'));
  console.log(JSON.stringify({ checks: report.checks, failures: report.failures.map(({ label, theme, width, problems }) => ({ label, theme, width, problems })), errors: report.errors }, null, 2));
  if (!baseline) assert.deepEqual(report.failures, [], 'PDF navigation must be prepared, aligned, complete and unclipped');
} catch (failure) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw failure;
} finally {
  await writeFile(path.join(output, baseline ? 'baseline.json' : 'report.json'), JSON.stringify(report, null, 2));
  await browser.close(); await new Promise(resolve => server.httpServer.close(resolve));
}
