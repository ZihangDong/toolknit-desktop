import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { compressionFixtures } from './lib/pdf-compress-fixtures.mjs';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/pdf-compress-redesign/browser');
await mkdir(output, { recursive: true });
const fixtures = await compressionFixtures();
const oversizedDocument = await PDFDocument.create();
const oversizedFont = await oversizedDocument.embedFont(StandardFonts.Helvetica);
const oversizedPage = oversizedDocument.addPage([4000, 4000]);
for (let index = 0; index < 5000; index += 1) {
  oversizedPage.drawText(`Oversized-page clarity fixture ${index} ${'x'.repeat(24)}`, {
    x: 80 + (index % 8) * 420,
    y: 3900 - Math.floor(index / 8) * 7,
    size: 10,
    font: oversizedFont
  });
}
const oversizedPagePdf = Buffer.from(await oversizedDocument.save());
const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await chromium.launch({ headless: true,
  ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
const report = { results: [], layouts: [], errors: [] };
try {
  const url = server.resolvedUrls.local[0];
  for (const language of ['zh', 'en']) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 887 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin
      ? route.continue() : route.fulfill({ status: 200, body: '{}', contentType: 'application/json' }));
    await context.addInitScript(lang => {
      localStorage.setItem('toolknit.theme.v3', 'light');
      localStorage.setItem('toolknit-lang', lang);
    }, language);
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.text().includes('Blocked aria-hidden')) report.errors.push(message.text()); });
    const downloads = [];
    page.on('download', download => downloads.push(download));
    const select = (id, value) => page.locator(`#${id}`).evaluate((select, value) => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    const waitResult = async status => {
      await page.waitForSelector('#pdfCompressSuccessOverlay.visible');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#pdfCompressSuccessOverlay')).opacity === '1');
      assert.equal(await page.locator('.pdf-compress-result-status').getAttribute('data-status'), status);
      assert.equal(await page.locator('#pdfCompressSuccessOverlay .audio-convert-success-icon').getAttribute('data-result-state'), status === 'compressed' ? 'success' : 'info');
      assert.ok(!(await page.locator('#pdfCompressSuccessOverlay').innerText()).includes('home.pdfCompress.'));
      report.results.push({ language, status, downloads: downloads.length });
    };
    const assertWorkspaceLayout = async label => {
      const metrics = await page.locator('.pdf-compress-v2-workspace').evaluate(workspace => {
        const rect = node => {
          const value = node.getBoundingClientRect();
          return {
            top: value.top,
            right: value.right,
            bottom: value.bottom,
            left: value.left
          };
        };
        const options = workspace.querySelector('.pdf-compress-v2-options');
        const workflow = workspace.querySelector('.pdf-compress-workflow-switch');
        const optionPanels = workspace.querySelector('.pdf-compress-option-panels');
        const queue = workspace.querySelector('.pdf-compress-v2-queue');
        const files = workspace.querySelector('#pdfCompressFiles');
        const info = workspace.querySelector('.pdf-compress-v2-info');
        const visibleControls = [...options.querySelectorAll('button, input, .tool-custom-select')]
          .filter(node => node.getClientRects().length > 0)
          .map(rect);
        const levelButtons = [...options.querySelectorAll('#pdfCompressLevelOptions button')]
          .filter(node => node.getClientRects().length > 0)
          .map(rect);
        return {
          options: rect(options),
          workflow: rect(workflow),
          optionPanels: rect(optionPanels),
          queue: rect(queue),
          files: rect(files),
          info: rect(info),
          visibleControls,
          levelButtons,
          regularVisible: workspace.querySelector('#pdfCompressRegularOptions')?.getClientRects().length > 0,
          regularSelectors: [...workspace.querySelectorAll('#pdfCompressRegularOptions > .audio-convert-format-selector')]
            .filter(node => node.getClientRects().length > 0).map(rect),
          regularControlGroups: ['#pdfCompressModeOptions', '#pdfCompressLevelOptions']
            .map(selector => workspace.querySelector(selector))
            .filter(node => node?.getClientRects().length > 0)
            .map(rect),
          targetVisible: workspace.querySelector('#pdfCompressTargetOptions')?.getClientRects().length > 0,
          targetFields: [...workspace.querySelectorAll('#pdfCompressTargetOptions .pdf-compress-target-field')]
            .filter(node => node.getClientRects().length > 0).map(rect)
        };
      });
      assert.ok(metrics.options.bottom <= metrics.queue.top + 1, `${label}: compression options overlap the queue`);
      assert.ok(metrics.files.bottom <= metrics.info.top + 1, `${label}: file queue overlaps compression notes`);
      assert.ok(Math.abs(metrics.workflow.left - metrics.options.left) <= 1
        && Math.abs(metrics.workflow.right - metrics.options.right) <= 1,
      `${label}: workflow controls must align with the option divider`);
      assert.ok(Math.abs(metrics.optionPanels.left - metrics.options.left) <= 1
        && Math.abs(metrics.optionPanels.right - metrics.options.right) <= 1,
      `${label}: workflow panel must align with the option divider`);
      const escapedControls = metrics.visibleControls.filter(control => control.left < metrics.options.left - 1
        || control.right > metrics.options.right + 1);
      assert.deepEqual(escapedControls, [], `${label}: a compression control escapes the options section`);
      if (metrics.regularVisible && metrics.regularSelectors.length === 2
        && Math.abs(metrics.regularSelectors[0].top - metrics.regularSelectors[1].top) <= 1) {
        const selectorGap = metrics.regularSelectors[1].left - metrics.regularSelectors[0].right;
        assert.ok(Math.abs(selectorGap - 15) <= 1,
          `${label}: regular compression groups must keep a 15px gap, received ${selectorGap}`);
      }
      if (metrics.regularVisible && metrics.regularControlGroups.length === 2
        && Math.abs(metrics.regularControlGroups[0].top - metrics.regularControlGroups[1].top) <= 1) {
        const visibleGap = metrics.regularControlGroups[1].left - metrics.regularControlGroups[0].right;
        assert.ok(Math.abs(visibleGap - 15) <= 1,
          `${label}: visible regular compression controls must keep a 15px gap, received ${visibleGap}`);
      }
      if (metrics.levelButtons.length > 1) {
        assert.ok(metrics.levelButtons.every(button => Math.abs(button.top - metrics.levelButtons[0].top) <= 1),
          `${label}: compression level buttons wrap onto multiple rows`);
      }
    };
    try {
      await page.goto(url);
      await page.waitForSelector('#homeToolGrid .tool-result-card');
      await page.evaluate(() => document.querySelector('.audio-list-item[data-tool="pdf-compress"]').click());
      await page.waitForSelector('#pdfCompressOverlay.visible');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-tk-page-transition-veil]')).visibility === 'hidden');
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        for (const [width, height] of [[1400, 887], [1100, 700], [720, 480]]) {
          await page.setViewportSize({ width, height });
          await page.locator('#pdfCompressWorkflowOptions [data-workflow="regular"]').click();
          assert.equal(await page.locator('#pdfCompressRegularOptions').isVisible(), true);
          assert.equal(await page.locator('#pdfCompressTargetOptions').isVisible(), false);
          await page.locator('#pdfCompressModeOptions [data-mode="structure"]').click();
          await assertWorkspaceLayout(`${language}/${theme}/${width}x${height}/structure-auto`);
          await page.locator('#pdfCompressModeOptions [data-mode="raster"]').click();
          await assertWorkspaceLayout(`${language}/${theme}/${width}x${height}/raster-auto`);
          await page.locator('#pdfCompressWorkflowOptions [data-workflow="target"]').click();
          assert.equal(await page.locator('#pdfCompressRegularOptions').isVisible(), false);
          assert.equal(await page.locator('#pdfCompressTargetOptions').isVisible(), true);
          const targetFields = page.locator('#pdfCompressTargetOptions .pdf-compress-target-controls > .pdf-compress-target-field');
          assert.equal(await targetFields.count(), 2);
          const targetFieldRects = await targetFields.evaluateAll(nodes => nodes.map(node => {
            const rect = node.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom };
          }));
          assert.ok(targetFieldRects[1].top >= targetFieldRects[0].bottom - 1,
            `${language}/${theme}/${width}x${height}: clarity must follow target size`);
          assert.equal(await page.locator('#pdfCompressModeOptions [data-mode="structure"]').isDisabled(), true,
            `${language}/${theme}/${width}x${height}: regular controls must be locked in target workflow`);
          await assertWorkspaceLayout(`${language}/${theme}/${width}x${height}/target`);
          await select('pdfCompressTargetSize', 'custom');
          await assertWorkspaceLayout(`${language}/${theme}/${width}x${height}/target-custom`);
          await page.locator('#pdfCompressWorkflowOptions [data-workflow="regular"]').click();
          assert.equal(await page.locator('#pdfCompressRegularOptions').isVisible(), true);
          assert.equal(await page.locator('#pdfCompressTargetOptions').isVisible(), false);
          assert.equal(await page.locator('#pdfCompressModeOptions [data-mode="raster"]').getAttribute('aria-pressed'), 'true');
          await page.locator('#pdfCompressModeOptions [data-mode="structure"]').click();
          await assertWorkspaceLayout(`${language}/${theme}/${width}x${height}/structure-auto-restored`);
        }
      }
      await page.setViewportSize({ width: 1400, height: 887 });
      await page.evaluate(() => document.documentElement.dataset.theme = 'light');
      assert.equal(await page.locator('#pdfCompressModeOptions [data-mode="raster"]').innerText(), language === 'zh' ? '图像化强压缩' : 'Image-only compression');
      await page.locator('#pdfCompressWorkflowOptions [data-workflow="target"]').click();
      assert.equal(await page.locator('#pdfCompressTargetOptions').isVisible(), true);
      assert.equal(await page.locator('#pdfCompressModeOptions [data-mode="structure"]').isDisabled(), true);
      await page.locator('#pdfCompressTargetValue').fill('500');
      const chooserPromise = page.waitForEvent('filechooser');
      await page.locator('#pdfCompressCta').click();
      await (await chooserPromise).setFiles({ name: 'image-source.pdf', mimeType: 'application/pdf', buffer: Buffer.from(fixtures.image) });
      await page.locator('#pdfCompressProcessBtn').click();
      await waitResult('compressed');
      assert.equal(await page.locator('#pdfCompressSuccessOverlay .audio-convert-success-title').innerText(), language === 'zh' ? '处理结果' : 'Processing results');
      assert.equal(downloads.length, 1);
      const stream = await downloads[0].createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      assert.ok(bytes.length <= 500 * 1024 && bytes.length < fixtures.image.length);
      const pdf = await PDFDocument.load(bytes);
      assert.equal(pdf.getPageCount(), 3);
      pdf.getPages().forEach((page, index) => {
        assert.equal(page.getWidth(), fixtures.expectedSizes[index][0]);
        assert.equal(page.getHeight(), fixtures.expectedSizes[index][1]);
      });
      await page.locator('.pdf-compress-result-row summary').click();
      await page.waitForFunction(() => document.querySelector('.pdf-compress-preview img')?.naturalWidth > 0);
      const previewImage = page.locator('.pdf-compress-preview img');
      const imageBefore = await previewImage.boundingBox();
      await page.locator('.pdf-compress-preview').hover();
      await page.mouse.wheel(0, -180);
      await page.waitForFunction(width => document.querySelector('.pdf-compress-preview img').getBoundingClientRect().width > width, imageBefore.width);
      assert.equal(await page.locator('#pdfCompressSuccessOverlay .audio-convert-success-icon').evaluate(node => Math.abs(node.getBoundingClientRect().width - node.getBoundingClientRect().height) < 1), true, 'result icon must stay circular when details expand');
      await page.screenshot({ path: path.join(output, `${language}-target-result.png`) });
      await page.locator('#pdfCompressSuccessOk').click();
      await page.locator('#pdfCompressTargetValue').fill('50');
      await page.locator('#pdfCompressProcessBtn').click();
      await waitResult('target-not-reached');
      assert.equal(downloads.length, 1, 'unreachable target must not trigger a download');
      assert.equal(await page.locator('#pdfCompressSuccessOpenFolder').isDisabled(), true);
      await page.locator('#pdfCompressSuccessOk').click();
      await select('pdfCompressTargetSize', '50');
      await page.locator('#pdfCompressProcessBtn').click();
      await waitResult('already-within-target');
      assert.equal(downloads.length, 1, 'an already-compliant source is not re-encoded or copied');
      await page.locator('#pdfCompressSuccessOk').click();
      await select('pdfCompressTargetSize', 'custom');
      await page.locator('#pdfCompressTargetValue').fill('500');
      await page.locator('#pdfCompressProcessBtn').click();
      await page.waitForSelector('#pdfCompressProcessMask.visible');
      const cancelGeometry = await page.locator('#pdfCompressCancel').evaluate(button => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return { width: rect.width, height: rect.height, flexGrow: style.flexGrow, alignSelf: style.alignSelf };
      });
      assert.ok(cancelGeometry.width >= 120 && cancelGeometry.height >= 32 && cancelGeometry.height <= 56,
        `processing cancel must remain button-sized: ${JSON.stringify(cancelGeometry)}`);
      assert.equal(cancelGeometry.flexGrow, '0');
      assert.equal(cancelGeometry.alignSelf, 'center');
      await page.locator('#pdfCompressCancel').click();
      await page.waitForFunction(() => !document.querySelector('#pdfCompressProcessMask').classList.contains('visible'));
      assert.equal(await page.locator('#pdfCompressSuccessOverlay').evaluate(node => node.classList.contains('visible')), false);
      assert.equal(downloads.length, 1);
      await page.waitForFunction(async () => !(await indexedDB.databases()).some(db => db.name.startsWith('toolknit-pdf-compress-')));
      if (language === 'zh') {
        await page.locator('#pdfCompressFiles .audio-convert-file-remove').click();
        await page.locator('#pdfCompressTargetValue').fill('50');
        await page.locator('#pdfCompressClarity').selectOption('readable');
        const chooser = page.waitForEvent('filechooser');
        await page.locator('#pdfCompressCta').click();
        await (await chooser).setFiles({ name: 'oversized-page.pdf', mimeType: 'application/pdf', buffer: oversizedPagePdf });
        await page.locator('#pdfCompressProcessBtn').click();
        await waitResult('error');
        assert.match(await page.locator('.pdf-compress-result-meta').innerText(), /72 DPI|安全像素|safety/i);
        assert.equal(await page.locator('.pdf-compress-retry-compact').count(), 1);
        await page.screenshot({ path: path.join(output, `${language}-page-too-large-guidance.png`) });
        await page.locator('.pdf-compress-retry-compact').click();
        await page.waitForFunction(() => !document.querySelector('#pdfCompressSuccessOverlay').classList.contains('visible'));
        assert.equal(await page.locator('#pdfCompressClarity').inputValue(), 'compact');
        assert.equal(await page.locator('#pdfCompressTargetOptions').isVisible(), true);
        assert.equal(await page.locator('#pdfCompressProcessMask').evaluate(node => node.classList.contains('visible')), false);
        await page.locator('#pdfCompressFiles .audio-convert-file-remove').click();
      }
      if (language === 'zh') {
        await page.addInitScript(() => {
          const NativeWorker = window.Worker;
          window.Worker = class extends NativeWorker {
            constructor(url, options) {
              if (String(url).includes('raster-worker')) throw new Error('Synthetic worker-unavailable fixture');
              super(url, options);
            }
          };
        });
        await page.reload();
        await page.waitForSelector('#homeToolGrid .tool-result-card');
        await page.evaluate(() => document.querySelector('.audio-list-item[data-tool="pdf-compress"]').click());
        await page.waitForSelector('#pdfCompressOverlay.visible');
        await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-tk-page-transition-veil]')).visibility === 'hidden');
        await page.locator('#pdfCompressModeOptions [data-mode="raster"]').click();
        await page.locator('#pdfCompressWorkflowOptions [data-workflow="target"]').click();
        await select('pdfCompressTargetSize', 'custom');
        const chooser = page.waitForEvent('filechooser');
        await page.locator('#pdfCompressCta').click();
        await (await chooser).setFiles({ name: 'fallback.pdf', mimeType: 'application/pdf', buffer: Buffer.from(fixtures.image) });
        await page.locator('#pdfCompressProcessBtn').click();
        await waitResult('compressed');
        assert.ok((await page.locator('.pdf-compress-result-meta').first().innerText()).includes('兼容模式编码'));
        assert.equal(downloads.length, 2, 'worker startup failure falls back to cached-page encoding');
        await page.locator('#pdfCompressSuccessOk').click();
        await page.waitForFunction(async () => !(await indexedDB.databases()).some(db => db.name.startsWith('toolknit-pdf-compress-')));
      }
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#pdfCompressProcessMask')).opacity === '0'
        && getComputedStyle(document.querySelector('#pdfCompressSuccessOverlay')).opacity === '0');
      await page.evaluate(() => document.fonts.ready);
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        for (const [width, height] of [[1400, 887], [1100, 700], [720, 480]]) {
          await page.setViewportSize({ width, height });
          assert.equal(await page.locator('#pdfCompressOverlay .pdf-merge-v2-title').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, 'translated title fits its poster');
          const overflow = await page.locator('.pdf-compress-v2-options').evaluate(root => {
            const rect = root.getBoundingClientRect();
            return { rootOverflow: root.scrollWidth > root.clientWidth + 1,
              controls: [...root.querySelectorAll('button, input')].filter(node => node.getClientRects().length)
                .filter(node => { const r = node.getBoundingClientRect(); return r.left < rect.left - 1 || r.right > rect.right + 1 || node.scrollWidth > node.clientWidth + 1; }).map(node => node.id || node.className) };
          });
          assert.equal(overflow.rootOverflow, false);
          assert.deepEqual(overflow.controls, []);
          await page.locator('.pdf-compress-v2-options').scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(output, `${language}-${theme}-${width}-${height}.png`) });
          report.layouts.push({ language, theme, width, height });
        }
      }
    } catch (error) {
      await page.screenshot({ path: path.join(output, `${language}-failure.png`) });
      throw error;
    } finally { await context.close(); }
  }
  assert.deepEqual(report.errors, []);
  console.log(`PDF compression browser target/no-export/cancel/cache/preview checks passed; ${report.layouts.length} layouts.`);
} catch (error) {
  report.failure = String(error.stack || error);
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
