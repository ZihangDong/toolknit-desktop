import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { preview } from 'vite';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const output = path.resolve('tmp/word-history-production');
await mkdir(output, { recursive: true });
const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const recipe = { version: 1, refreshFields: true, watermarkRequired: true, encryptionRequired: true,
  permissions: { printing: false, copying: false }, files: [{ inputPath: 'C:/synthetic-history/合同.docx',
    sourceHash: 'a'.repeat(64), status: 'success', outputPath: 'C:/synthetic-history/合同.pdf',
    outputHash: 'b'.repeat(64), outputBytes: 4096, pageCount: 2, encrypted: true }] };
const seed = ['succeeded', 'running', 'failed'].map((state, index) => ({ id: `history-qa-${index}`, tool: 'word-to-pdf',
  label: ['History completed', 'History interrupted', 'Legacy Word history'][index], state,
  createdAt: '2026-11-21T01:00:00.000Z', outputs: ['C:/synthetic-history/合同.pdf'],
  ...(index < 2 ? { recovery: { ...recipe, password: 'HISTORY_SECRET_SENTINEL', watermarkText: 'WATERMARK_SENTINEL' } } : {}) }));
async function openTasks() {
  await page.waitForFunction(() => !document.getElementById('appStartupMask') && !document.querySelector('.app')?.inert);
  await page.locator('#homeToolSearch').fill('Task');
  await page.locator('#homeToolGrid [data-home-tool="task-center"]').click();
  await page.locator('#productivityOverlay.visible').waitFor();
  await page.waitForFunction(() => { const veil = document.querySelector('[data-tk-page-transition-veil]'); return !veil || getComputedStyle(veil).visibility === 'hidden'; });
}
try {
  await page.addInitScript(rows => {
    if (!localStorage.getItem('word-history-qa-seeded')) {
      localStorage.setItem('toolknit.tasks.v1', JSON.stringify(rows));
      localStorage.setItem('toolknit-lang', 'en');
      localStorage.setItem('word-history-qa-seeded', '1');
    }
  }, seed);
  await page.goto(server.resolvedUrls.local[0]);
  await openTasks();
  const root = page.locator('#productivityOverlay');
  assert.equal(await root.locator('[data-task-recovery="word"]').count(), 2);
  for (const button of await root.locator('[data-task-recovery="word"]').all()) assert.equal(await button.isDisabled(), true);
  checks.push('production home opens lazy Task Center; two Word recipes have desktop-only recovery controls');
  assert.equal(await root.locator('[data-state="interrupted"]').count(), 1);
  assert.match(await root.innerText(), /source|reselect|re-select/i);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('toolknit.tasks.v1')));
  assert.equal(stored[1].state, 'interrupted');
  assert.equal(stored[0].recovery.files[0].sourceHash, recipe.files[0].sourceHash);
  assert.equal(JSON.stringify(stored).includes('SENTINEL'), false);
  checks.push('unfinished records become interrupted; safe fingerprints survive while unrecognized secret fields are projected away');
  const legacy = root.locator('.productivity-task').filter({ hasText: 'Legacy Word history' });
  assert.equal(await legacy.locator('[data-task-recovery]').count(), 0);
  assert.match(await legacy.innerText(), /source|reselect|re-select/i);
  assert.equal(await root.locator('[data-task-storage-warning]').isVisible(), false);
  await page.screenshot({ path: path.join(output, 'history-production-en.png') });
  checks.push('legacy records explain missing source metadata; working storage shows no warning');
  await page.reload(); await openTasks();
  assert.equal(await root.locator('[data-task-recovery="word"]').count(), 2);
  assert.equal(await root.locator('[data-state="interrupted"]').count(), 1);
  checks.push('recoverability and interrupted status survive a second production reload');
  await root.locator('[data-action="clear-tasks"]').click();
  assert.equal(await root.locator('.productivity-task').count(), 0);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('toolknit.tasks.v1'))), []);
  checks.push('clear finished history removes persisted metadata');
  await page.reload(); await openTasks();
  assert.equal(await root.locator('.productivity-task').count(), 0);
  checks.push('cleared records stay cleared after reload');
  await page.close();
  const blocked = await browser.newPage();
  blocked.on('pageerror', error => errors.push(error.message));
  await blocked.addInitScript(rows => { localStorage.setItem('toolknit.tasks.v1', JSON.stringify(rows));
    const set = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) {
    if (key === 'toolknit.tasks.v1') throw new DOMException('Synthetic quota test', 'QuotaExceededError');
    return set.call(this, key, value);
  }; }, seed);
  await blocked.goto(server.resolvedUrls.local[0]);
  await blocked.waitForFunction(() => !document.getElementById('appStartupMask') && !document.querySelector('.app')?.inert);
  await blocked.locator('#homeToolSearch').fill('任务中心');
  await blocked.locator('#homeToolGrid [data-home-tool="task-center"]').click();
  await blocked.locator('#productivityOverlay.visible').waitFor();
  assert.equal(await blocked.locator('[data-task-storage-warning]').isVisible(), true);
  checks.push('production Task Center visibly reports task-storage failure');
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks, errors }, null, 2));
  console.log(`Word history production passed: ${checks.length} checks.`);
} catch (error) {
  if (!page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
  throw error;
} finally { await browser.close(); await server.close(); }
