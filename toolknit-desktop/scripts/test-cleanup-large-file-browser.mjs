import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createServer } from 'vite';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/cleanup-large-file-browser');
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: false, logLevel: 'error', optimizeDeps: { entries: ['index.html'] }, server: { host: '127.0.0.1', port: 0, hmr: false, watch: { ignored: ['**/src-tauri/**', '**/cli/**', '**/tmp/**'] } } });
await server.listen();
const address = server.httpServer.address();
const browser = await chromium.launch({ headless: true, channel: process.env.TOOLKNIT_TEST_BROWSER || 'msedge' });
const page = await browser.newPage({ viewport: { width: 1400, height: 920 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());

async function idle() {
  await page.waitForFunction(() => !document.querySelector('#largeFileCleanupScanBtn').disabled);
}

async function scanRoot() {
  await page.locator('#largeFileCleanupScanBtn').click();
  await page.locator('#largeFileCleanupDriveRootOverlay.visible').waitFor();
  assert.equal(await page.locator('#largeFileCleanupDriveRootConfirm').isDisabled(), true);
  await page.locator('#largeFileCleanupDriveRootAck').check();
  await page.locator('#largeFileCleanupDriveRootConfirm').click();
  await idle();
}

async function assertLayout() {
  const bad = await page.locator('#largeFileCleanupOverlay :is(button, input, .cleanup-v2-path)').evaluateAll(nodes =>
    nodes.filter(node => node.getBoundingClientRect().width > 0 && !node.closest('.cleanup-large-files-list-wrap')
      && node.scrollWidth > node.clientWidth + 2).map(node => node.id || node.className));
  assert.deepEqual(bad, [], 'controls must fit without text clipping');
  const geometry = await page.locator('.cleanup-large-files-body').evaluate(node => ({ client: node.clientWidth, scroll: node.scrollWidth }));
  assert.ok(geometry.scroll <= geometry.client + 2, 'workspace must not overflow horizontally');
}

try {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/src/main.js') return route.fulfill({ contentType: 'text/javascript', body: '' });
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const { default: markup } = await import('/src/features/cleanup-tools/template.html?raw');
    const { initLargeFileCleanupTool } = await import('/src/features/cleanup-tools/tool.js');
    const { t, getLang, setLang } = await import('/src/i18n.js');
    document.body.innerHTML = markup;
    document.documentElement.dataset.theme = 'light';
    window.fixture = { calls: [], requests: [], notes: [], aiMode: 'good', scanMode: 'good', setLang };
    const fixture = window.fixture;
    fixture.candidates = [
      { id: 'a', name: 'review-video.mp4', path: 'C:\\Users\\sample\\Downloads\\合同, 样本 (1)\\review-video.mp4', folder_hint: 'Users/[user]/Downloads', category: 'video', risk: 'low' },
      { id: 'b', name: 'project-backup.zip', path: 'C:\\Users\\sample\\Projects\\project-backup.zip', folder_hint: 'Users/[user]/Projects', category: 'archives', risk: 'high' },
      { id: 'c', name: 'training-model.bin', path: 'C:\\Models\\training-model.bin', folder_hint: 'Models', category: 'models', risk: 'medium' }
    ].map(item => ({ ...item, size_bytes: 123456789, modified_at: 1700000000000, local_reason: 'review' }));
    const invoke = async (command, args) => {
      fixture.calls.push({ command, args });
      if (command === 'get_cleanup_drive_space') return { drive: 'C:', free_bytes: 50e9, total_bytes: 500e9 };
      if (command === 'scan_large_files') {
        const result = { scan_id: args.scanId, root_path: args.rootPath, candidates: fixture.candidates,
          scanned_files: 500, skipped_dirs: 14, protected_dirs: 12, protected_files: 20, denied_dirs: 2, elapsed_ms: 512, truncated: false };
        if (fixture.scanMode === 'pending') return new Promise(resolve => { fixture.finishScan = () => resolve(result); });
        if (fixture.scanMode === 'error') throw new Error('fixture scan failed');
        return result;
      }
      if (command === 'move_files_to_recycle_bin') return { requested: args.paths.length, moved: args.paths.length, failed: 0,
        freed_bytes: 123456789, items: args.paths.map(path => ({ path, ok: true })) };
      return null;
    };
    fixture.controller = initLargeFileCleanupTool({ overlay: document.querySelector('#largeFileCleanupOverlay'), isTauri: true,
      t, getLang, tauriCore: Promise.resolve({ invoke }), getAiApiKey: () => 'test-placeholder',
      notify: message => fixture.notes.push(message), loadDialog: async () => ({ open: async () => 'C:\\Users\\sample\\Downloads' }),
      requestAi: async (messages, signal) => {
        const payload = JSON.parse(messages[1].content);
        fixture.requests.push(payload);
        const items = payload.items.map(item => ({ id: item.id, decision: 'delete', identity: 'Review candidate', reason: 'Human review is required.' }));
        if (fixture.aiMode === 'pending') return new Promise(resolve => { fixture.finishAi = () => resolve(JSON.stringify({ items })); fixture.signal = signal; });
        if (fixture.aiMode === 'invalid') return '{"items":[]}';
        if (fixture.aiMode === 'partial') return JSON.stringify({ items: items.slice(0, 1) });
        return JSON.stringify({ items });
      }
    });
    fixture.controller.open();
  });
  await page.locator('#largeFileCleanupOverlay.visible').waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#largeFileCleanupOverlay')).opacity === '1');
  await page.screenshot({ path: path.join(output, 'light-empty.png') });
  await page.locator('#largeFileCleanupScanSystemDrive').click();
  const scansBefore = await page.evaluate(() => fixture.calls.filter(call => call.command === 'scan_large_files').length);
  await page.locator('#largeFileCleanupScanBtn').click();
  await page.locator('#largeFileCleanupDriveRootOverlay.visible').waitFor();
  assert.equal(await page.locator('#largeFileCleanupDriveRootConfirm').isDisabled(), true);
  assert.equal(await page.evaluate(() => fixture.calls.filter(call => call.command === 'scan_large_files').length), scansBefore);
  assert.equal(await page.locator('#largeFileCleanupOverlay').evaluate(node => node.inert), true);
  await page.locator('#largeFileCleanupDriveRootCancel').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'largeFileCleanupDriveRootAck', 'confirmation traps keyboard focus');
  await page.screenshot({ path: path.join(output, 'light-root-warning.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#largeFileCleanupDriveRootOverlay').getAttribute('aria-hidden'), 'true');
  assert.equal(await page.locator('#largeFileCleanupOverlay').evaluate(node => node.inert), false);
  await scanRoot();
  assert.equal(await page.locator('#largeFileCleanupTableBody input:checked').count(), 0);
  assert.equal(await page.locator('#largeFileCleanupTableBody input').count(), 3);
  const candidatePath = await page.evaluate(() => fixture.candidates[0].path);
  await page.locator('.cleanup-large-files-open-file').first().click();
  await page.waitForFunction(() => fixture.calls.some(call => call.command === 'open_path'));
  assert.equal(await page.evaluate(() => fixture.calls.filter(call => call.command === 'open_path').at(-1).args.path), candidatePath);
  await page.locator('.cleanup-large-files-open-file').first().click({ button: 'right' });
  await page.locator('.cleanup-large-files-context-menu.visible [data-action="open-folder"]').click();
  await page.waitForFunction(() => fixture.calls.filter(call => call.command === 'open_path').length === 2);
  assert.equal(await page.evaluate(() => fixture.calls.filter(call => call.command === 'open_path').at(-1).args.path), candidatePath,
    'the context menu keeps spaces, Unicode and commas in the original file path');
  assert.equal(await page.locator('.cleanup-large-files-context-menu.visible').count(), 0);
  await page.evaluate(() => { fixture.aiMode = 'partial'; });
  await page.locator('#largeFileCleanupAiBtn').click();
  await idle();
  await page.evaluate(() => { fixture.aiMode = 'good'; });
  await page.locator('#largeFileCleanupAiBtn').click();
  await idle();
  assert.deepEqual(await page.evaluate(() => fixture.requests.at(-1).items.map(item => item.id)), ['b', 'c'], 'resume only unreviewed items');
  assert.equal(await page.locator('#largeFileCleanupTableBody input:checked').count(), 0, 'AI must never select files');
  assert.equal(await page.evaluate(() => fixture.requests.some(request => request.items.some(item => 'path' in item))), false);
  const notesBefore = await page.evaluate(() => fixture.notes.length);
  await page.evaluate(() => { fixture.aiMode = 'invalid'; });
  await page.locator('#largeFileCleanupAiBtn').click();
  await idle();
  assert.ok(await page.evaluate(count => fixture.notes.slice(count).some(text => /有效|invalid|valid/i.test(text)), notesBefore), 'invalid reanalysis must report failure');
  await page.locator('#largeFileCleanupSearch').fill('project');
  assert.equal(await page.locator('#largeFileCleanupTableBody input').count(), 1);
  assert.equal(await page.locator('#largeFileCleanupSelectAllBtn').isDisabled(), true, 'high-risk-only filter cannot be batch selected');
  assert.equal(await page.locator('#largeFileCleanupTableBody input:checked').count(), 0, 'batch selection skips high risk');
  await page.locator('#largeFileCleanupSearch').fill('');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.waitForTimeout(250);
    for (const [width, height] of [[1400, 920], [1100, 700], [720, 640]]) {
      await page.setViewportSize({ width, height });
      await assertLayout();
      await page.screenshot({ path: path.join(output, `${theme}-${width}.png`) });
      if (width === 720) {
        await page.locator('.cleanup-v2-main-head').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `${theme}-720-results.png`) });
      }
    }
  }
  await page.setViewportSize({ width: 1400, height: 920 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; fixture.setLang('en'); });
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await assertLayout();
  await page.screenshot({ path: path.join(output, 'light-en.png') });
  await page.locator('#largeFileCleanupTableBody input').first().check();
  await page.locator('#largeFileCleanupDeleteBtn').click();
  await page.locator('#largeFileCleanupSuccessOverlay.visible').waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#largeFileCleanupSuccessOverlay')).opacity === '1');
  await page.screenshot({ path: path.join(output, 'light-success.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#largeFileCleanupSuccessOverlay').getAttribute('aria-hidden'), 'true');
  await page.evaluate(() => { fixture.scanMode = 'pending'; });
  await page.locator('#largeFileCleanupScanBtn').click();
  await page.locator('#largeFileCleanupDriveRootAck').check();
  await page.locator('#largeFileCleanupDriveRootConfirm').click();
  await page.waitForFunction(() => !!fixture.finishScan);
  await page.locator('#largeFileCleanupCancel').click();
  await page.evaluate(() => fixture.finishScan());
  await idle();
  assert.equal(await page.locator('#largeFileCleanupTableBody input').count(), 0, 'cancelled scan cannot repopulate results');
  await page.evaluate(() => { fixture.scanMode = 'good'; });
  await scanRoot();
  await page.evaluate(() => { fixture.aiMode = 'pending'; });
  await page.locator('#largeFileCleanupAiBtn').click();
  await page.waitForFunction(() => !!fixture.finishAi);
  await page.locator('#largeFileCleanupCancel').click();
  assert.equal(await page.evaluate(() => fixture.signal.aborted), true);
  await page.evaluate(() => { fixture.finishAi(); fixture.controller.close(); fixture.controller.open(); });
  assert.equal(await page.locator('#largeFileCleanupTableBody input').count(), 0);
  assert.equal(await page.locator('#largeFileCleanupDriveRootOverlay').getAttribute('aria-hidden'), 'true');
  await page.evaluate(() => { fixture.controller.dispose(); fixture.controller.dispose(); });
  assert.deepEqual(errors, []);
  if (process.env.TOOLKNIT_TEST_PREVIEW_URL) {
    const previewPage = await browser.newPage({ viewport: { width: 1400, height: 920 } });
    previewPage.on('pageerror', error => errors.push(error.message));
    await previewPage.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
      ? route.continue() : route.abort());
    await previewPage.goto(process.env.TOOLKNIT_TEST_PREVIEW_URL, { waitUntil: 'domcontentloaded' });
    await previewPage.locator('[data-tool="large-file-cleanup"]').first().evaluate(node => node.click());
    await previewPage.locator('#largeFileCleanupOverlay.visible').waitFor();
    await previewPage.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await previewPage.waitForTimeout(300);
    assert.equal(await previewPage.locator('#largeFileCleanupScanSystemDrive').count(), 1);
    assert.equal(await previewPage.locator('#largeFileCleanupRiskFilter').count(), 1);
    assert.equal(await previewPage.locator('.cleanup-large-files-empty-icon').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(23, 23, 23)');
    await previewPage.screenshot({ path: path.join(output, 'preview-light.png') });
    await previewPage.close();
    assert.deepEqual(errors, [], 'built app must open through its real lazy registry');
  }
  console.log(`Cleanup browser behavior and theme checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
  await server.close();
}
