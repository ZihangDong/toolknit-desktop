import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const baseline = process.argv.includes('--baseline');
const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/pdf-workbench-interaction');
await mkdir(output, { recursive: true });
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let i = 0; i < 24; i++) {
  const page = pdf.addPage([1000, 1200]);
  for (let line = 0; line < 36; line++) page.drawText(`PAGE ${i + 1} - Preview zoom regression line ${line}`, { x: 50, y: 1120 - line * 28, size: 16, font });
}
const fixture = { name: 'workbench-24.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await chromium.launch({ headless: true, ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
const report = { baseline, chrome: [], zoom: [], errors: [] };
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const url = server.resolvedUrls.local[0];
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.fulfill({ body: '{}', contentType: 'application/json' }));
  await context.addInitScript(() => {
    localStorage.setItem('toolknit.theme.v3', 'light'); localStorage.setItem('toolknit-lang', 'zh');
  });
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(url);
  await page.waitForSelector('#homeToolGrid .tool-result-card');
  await page.evaluate(() => document.querySelector('.audio-list-item[data-tool="pdf-split"]').click());
  await page.waitForSelector('#pdfSplitOverlay.visible');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#pdfSplitCta').click(); await (await chooser).setFiles(fixture);
  const parts = { header: 'header', back: '.tk-nav-back', tag: '.tk-nav-tag', website: '.tk-nav-web', support: '.tk-nav-support', help: '.tk-nav-help', feedback: '.tk-nav-feedback', settings: '.tk-nav-settings', minimize: '.tk-nav-minimize', maximize: '.tk-nav-maximize', close: '.tk-nav-close' };
  async function styles(root, selector) {
    return page.locator(`${root} ${selector}`).evaluate(node => {
      const properties = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'backgroundColor', 'borderRadius', 'borderColor', 'borderWidth', 'padding', 'gap', 'display', 'alignItems', 'justifyContent', 'transition', 'boxShadow', 'height', 'width', 'transform'];
      const read = (target, pseudo) => target ? Object.fromEntries(properties.map(key => [key, getComputedStyle(target, pseudo)[key]])) : null;
      return { text: node.matches('button,.pdf-merge-v2-top-tag') ? node.textContent.trim() : null, own: read(node), span: read(node.querySelector('span')), icon: read(node.querySelector('svg')), before: read(node, '::before'), after: read(node, '::after') };
    });
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const original = {};
    for (const [key, selector] of Object.entries(parts)) {
      await page.mouse.move(600, 670); await page.waitForTimeout(170);
      original[key] = { idle: await styles('#pdfSplitOverlay', selector) };
      await page.locator(`#pdfSplitOverlay ${selector}`).hover(); await page.waitForTimeout(650);
      original[key].hover = await styles('#pdfSplitOverlay', selector);
    }
    await page.locator('#pdfSplitProcessBtn').click();
    await page.waitForSelector('#pdfSplitWorkspace.visible');
    for (const [key, selector] of Object.entries(parts)) {
      await page.mouse.move(600, 670); await page.waitForTimeout(170);
      const workbench = { idle: await styles('#pdfSplitWorkspace', selector) };
      await page.locator(`#pdfSplitWorkspace ${selector}`).hover(); await page.waitForTimeout(650);
      workbench.hover = await styles('#pdfSplitWorkspace', selector);
      const relevant = value => JSON.stringify({ fontSize: value.own.fontSize, fontWeight: value.own.fontWeight,
        lineHeight: value.own.lineHeight, color: value.own.color, backgroundColor: value.own.backgroundColor,
        borderRadius: value.own.borderRadius, padding: value.own.padding, gap: value.own.gap,
        alignItems: value.own.alignItems, justifyContent: value.own.justifyContent, height: value.own.height });
      if (relevant(original[key].idle) !== relevant(workbench.idle)
        || relevant(original[key].hover) !== relevant(workbench.hover)) report.chrome.push({ theme, key, original: original[key], workbench });
    }
    await page.locator('#pdfSplitWorkspaceClose').click();
  }
  await page.locator('#pdfSplitProcessBtn').click();
  await page.waitForSelector('#pdfSplitWorkspace.visible');
  const beforeWheel = await page.locator('[data-wb-zoom="fit"]').innerText();
  await page.locator('[data-wb-scroll]').hover();
  await page.mouse.wheel(0, -180);
  await page.waitForFunction(previous => document.querySelector('[data-wb-zoom="fit"]').textContent !== previous, beforeWheel);
  assert.notEqual(await page.locator('[data-wb-zoom="fit"]').innerText(), beforeWheel);
  await page.mouse.move(600, 670);
  await page.waitForTimeout(800);
  // Track only the main preview. Thumbnail completion is not a main redraw.
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-wb-canvas]');
    const scroll = document.querySelector('[data-wb-scroll]');
    window.__wbAudit = { mutations: 0, hidden: 0, resizes: [] };
    const mutations = new MutationObserver(entries => {
      window.__wbAudit.mutations += entries.length;
      window.__wbAudit.hidden += entries.filter(entry => entry.attributeName === 'hidden').length;
    });
    mutations.observe(canvas, { attributes: true });
    const resize = new ResizeObserver(entries => {
      const box = entries[0].contentRect;
      if (window.__wbAudit.resizes.length < 200) window.__wbAudit.resizes.push([box.width, box.height]);
    });
    resize.observe(scroll);
    window.__stopWbAudit = () => { mutations.disconnect(); resize.disconnect(); };
  });
  for (const target of [30, 40, 45, 55, 80, 120]) {
    // Start at the minimum, then increase without relying on the fit label's text.
    await page.evaluate(() => { for (let i = 0; i < 22; i++) document.querySelector('[data-wb-zoom="out"]').click(); });
    await page.waitForTimeout(300);
    for (let i = 0; i < 25; i++) {
      const value = parseInt(await page.locator('[data-wb-zoom="fit"]').innerText());
      if (value >= target) break;
      await page.locator('[data-wb-zoom="in"]').click();
    }
    await page.waitForTimeout(600);
    await page.evaluate(() => { window.__wbAudit = { mutations: 0, hidden: 0, resizes: [] }; });
    await page.waitForTimeout(1200);
    report.zoom.push(await page.evaluate(() => ({ label: document.querySelector('[data-wb-zoom="fit"]').textContent, ...window.__wbAudit })));
  }
  await page.evaluate(() => window.__stopWbAudit());
  await page.screenshot({ path: path.join(output, baseline ? 'baseline.png' : 'fixed.png') });
  if (!baseline) {
    assert.equal(await page.locator('#pdfSplitWorkspace .pdf-merge-v2-topbar').evaluate(node => node.classList.contains('tool-page-v2-topbar')), true);
    assert.equal(await page.locator('#pdfSplitWorkspace .pdf-workbench-shell').evaluate(node => node.classList.contains('tool-page-v2-shell')), true);
    assert.equal(await page.locator('#pdfSplitWorkspace .pdf-merge-v2-back').evaluate(node => node.classList.contains('tool-page-v2-back')), true);
    assert.equal(await page.locator('#pdfSplitWorkspace .home-v2-support-top').evaluate(node => {
      const style = getComputedStyle(node);
      const label = node.querySelector('span');
      const icon = node.querySelector('svg');
      const theme = document.documentElement.dataset.theme;
      return Boolean(label?.getBoundingClientRect().width && icon?.getBoundingClientRect().width)
        && (theme === 'light'
          ? style.color === 'rgb(255, 255, 255)' && style.backgroundColor === 'rgb(17, 17, 17)'
          : style.color === 'rgb(17, 17, 17)' && style.backgroundColor === 'rgb(243, 243, 244)');
    }), true);
    assert.match(await page.locator('#pdfSplitWorkspace .pdf-merge-v2-back').innerText(), /返回首页|Back to home/);
    assert.equal(report.chrome.length, 0, 'workbench navigation must exactly match the reference tool page');
    assert.ok(report.zoom.every(sample => sample.mutations === 0 && sample.resizes.length === 0), 'idle main preview must not redraw or resize');
    assert.deepEqual(report.errors, []);
  }
  console.log(JSON.stringify({ chromeDifferences: report.chrome.map(({ theme, key }) => ({ theme, key })), zoom: report.zoom, errors: report.errors }, null, 2));
} finally {
  await writeFile(path.join(output, baseline ? 'baseline.json' : 'report.json'), JSON.stringify(report, null, 2));
  await browser.close(); await new Promise(resolve => server.httpServer.close(resolve));
}
