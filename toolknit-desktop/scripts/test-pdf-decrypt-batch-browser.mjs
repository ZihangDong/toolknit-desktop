import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import pdfLibPlusEncrypt from 'pdf-lib-plus-encrypt';
import { encryptPdf } from '../src/pdf-encrypt-core.js';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const { PDFDocument } = pdfLibPlusEncrypt;
const root = path.resolve('tmp/pdf-decrypt-batch-browser');
const fixtureRoot = path.join(root, `run-${randomUUID()}`), outputDir = path.join(fixtureRoot, 'output');
await mkdir(outputDir, { recursive: true });
await mkdir(path.join(fixtureRoot, 'a'), { recursive: true });
await mkdir(path.join(fixtureRoot, 'b'), { recursive: true });
const alpha = 'batch-alpha-secret', beta = 'batch-beta-secret';
const source = await PDFDocument.create(); source.addPage([420, 595]).drawText('ToolKnit batch decryption');
const sourceBytes = await source.save();
const paths = {
  a: path.join(fixtureRoot, 'a', '合同, final.pdf'),
  b: path.join(fixtureRoot, 'b', '合同, final.pdf'),
  owner: path.join(fixtureRoot, 'owner-only.pdf'), plain: path.join(fixtureRoot, 'plain.pdf'),
  corrupt: path.join(fixtureRoot, 'corrupt.pdf'), many: path.join(fixtureRoot, '201-pages.pdf')
};
await writeFile(paths.a, await encryptPdf({ fileData: sourceBytes, password: alpha }));
await writeFile(paths.b, await encryptPdf({ fileData: sourceBytes, password: beta }));
const owner = await PDFDocument.create(); owner.addPage(); await owner.encrypt({ userPassword: '', ownerPassword: 'owner-test-secret' });
await writeFile(paths.owner, await owner.save());
await writeFile(paths.plain, sourceBytes); await writeFile(paths.corrupt, 'not a PDF');
const many = await PDFDocument.create(); for (let i = 0; i < 201; i++) many.addPage();
await writeFile(paths.many, await many.save());
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const originalHashes = new Map(await Promise.all(Object.values(paths).map(async file => [file, hash(await readFile(file))])));
const qpdf = path.resolve('src-tauri/resources/qpdf/qpdf.exe');
function run(args, password = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(qpdf, args, { windowsHide: true, stdio: [password === null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    const out = [], error = [];
    child.stdout.on('data', bytes => out.push(bytes)); child.stderr.on('data', bytes => error.push(bytes));
    child.once('error', () => reject(new Error('pdf-decrypt:qpdf-unavailable')));
    child.once('close', code => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(/password/i.test(Buffer.concat(error).toString('utf8')) ? 'pdf-decrypt:invalid-password' : 'pdf-decrypt:invalid-pdf'));
    });
    child.stdin?.on('error', () => {}); child.stdin?.end(`${password}\n`);
  });
}
const calls = [], outputs = [];
async function native(command, args) {
  if (command === 'get_file_size') return (await stat(args.path)).size;
  if (command === 'open_path') { calls.push({ command, path: args.path }); return; }
  if (command !== 'decrypt_pdf') throw new Error('unsupported fixture command');
  calls.push({ command, path: args.inputPath });
  const temporary = path.join(outputDir, `staging-${randomUUID()}.pdf`);
  try {
    await run(['--warning-exit-0', '--password-file=-', '--decrypt', args.inputPath, temporary], args.password);
    const pages = Number((await run(['--show-npages', temporary])).trim());
    if (pages > 200) throw new Error('pdf-decrypt:too-many-pages');
    const stem = path.basename(args.inputPath, path.extname(args.inputPath));
    for (let i = 0; i < 100; i++) {
      const target = path.join(outputDir, `${stem}_decrypted${i ? `_${i}` : ''}.pdf`);
      try { await link(temporary, target); outputs.push(target); return target; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    throw new Error('output collision limit');
  } finally { await unlink(temporary).catch(() => {}); }
}
const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : { channel: 'msedge' }) });
const report = { checks: [], errors: [], nativeTransport: 'Injected transport executes the bundled qpdf; Rust backend has its own regression tests.' };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.exposeFunction('__batchNative', native);
  await page.addInitScript(() => { localStorage.setItem('toolknit-lang', 'zh'); localStorage.setItem('toolknit.theme.v3', 'light'); });
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => !document.getElementById('appStartupMask') && !document.querySelector('.app')?.inert);
  await page.evaluate(async outputDir => {
    // Boot the real controller with an injected native transport. No production
    // test hooks or synthetic decryption results are shipped in the feature.
    let callbackId = 0;
    const callbacks = new Map();
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: fn => { callbacks.set(++callbackId, fn); return callbackId; },
      unregisterCallback: id => callbacks.delete(id),
      invoke: async (command, args) => {
        if (command === 'plugin:event|listen') return ++callbackId;
        if (command === 'plugin:dialog|open') { window.fixturePickerCalls = (window.fixturePickerCalls || 0) + 1; window.fixturePickerMultiple = args.options.multiple; return window.fixtureNextFiles; }
        return null;
      }
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    document.body.insertAdjacentHTML('beforeend', (await import('/src/features/pdf-security/template.html?raw')).default);
    const { initPdfDecryptTool } = await import('/src/features/pdf-security/decrypt-tool.js');
    const { createIcons, icons } = await import('/node_modules/lucide/dist/esm/lucide.js');
    window.fixtureCenter = (await import('/src/app/task-center.js')).taskCenter;
    window.fixtureMessages = [];
    window.fixture = initPdfDecryptTool({
      overlay: document.getElementById('pdfDecryptOverlay'), isTauri: true,
      center: window.fixtureCenter, displayFilesystemPath: value => value,
      refreshIcons: () => createIcons({ icons }),
      getOutputDir: async () => { if (window.fixtureBadDirectory) throw new Error('directory unavailable'); return outputDir; },
      invokeNative: async (command, args) => {
        if (command === 'decrypt_pdf' && window.fixtureGate) await new Promise(resolve => { window.fixtureRelease = resolve; });
        return window.__batchNative(command, args);
      },
      notify: value => window.fixtureMessages.push(value),
      openLazyTool: async () => { window.fixture.open(); return window.fixture; }
    });
    (await import('/src/shared/tool-page-chrome.js')).prepareToolPageChrome(document.getElementById('pdfDecryptOverlay'));
    window.fixture.open();
  }, outputDir);
  const queue = page.locator('#pdfDecryptFiles'), dialog = page.locator('#pdfDecryptPasswordDialog');
  const add = async files => {
    const previous = await page.evaluate(files => { window.fixtureNextFiles = files; return window.fixturePickerCalls || 0; }, files);
    await page.locator('#pdfDecryptCta').click();
    await page.waitForFunction(previous => window.fixturePickerCalls === previous + 1, previous);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  };
  const settle = () => page.waitForFunction(() => !document.querySelector('#pdfDecryptBatchCancel') || document.querySelector('#pdfDecryptBatchCancel').hidden);
  const confirm = async password => {
    await dialog.waitFor({ state: 'visible' });
    await page.locator('#pdfDecryptPasswordInput').fill(password);
    await page.locator('#pdfDecryptPasswordConfirm').click();
    await settle();
  };
  await add([paths.a, paths.b]); await add([paths.owner, paths.plain, paths.a]);
  assert.equal(await queue.locator('[data-decrypt-row]').count(), 4);
  assert.equal(await page.evaluate(() => window.fixturePickerMultiple), true);
  const ownerRow = queue.locator('[data-decrypt-row]').nth(2);
  await ownerRow.locator('select').selectOption('own');
  await page.locator('#pdfDecryptProcessBtn').click();
  await confirm(alpha);
  assert.deepEqual(await queue.locator('[data-decrypt-row]').evaluateAll(nodes => nodes.map(node => node.dataset.status)), ['succeeded', 'failed', 'succeeded', 'succeeded']);
  assert.equal(await page.locator('#pdfDecryptPasswordInput').inputValue(), '');
  const firstTask = await page.evaluate(() => window.fixtureCenter.list()[0]);
  assert.equal(firstTask.state, 'failed'); assert.equal(firstTask.outputs.length, 3);
  const beforeRetry = calls.filter(row => row.command === 'decrypt_pdf').length;
  await page.evaluate(async id => { await window.fixture.close(); await window.fixtureCenter.retry(id); }, firstTask.id);
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await queue.locator('[data-decrypt-row]').count(), 1);
  assert.equal(await page.locator('#pdfDecryptPasswordInput').inputValue(), '', 'history retry asks for credentials again');
  await confirm(beta);
  assert.equal(calls.filter(row => row.command === 'decrypt_pdf').length, beforeRetry + 1);
  assert.equal(await queue.locator('[data-status="succeeded"]').count(), 1);
  assert.equal(new Set(outputs).size, outputs.length, 'identical basenames produce separate outputs');
  report.checks.push('append, deduplication and native multiple picker', 'shared and explicit blank individual passwords', 'partial failure retains successful outputs', 'history retry restores only unfinished input and asks for password', 'same basename output collisions');

  await page.locator('#pdfDecryptBatchClear').click();
  await add([paths.b, paths.corrupt, paths.many]);
  await page.locator('#pdfDecryptProcessBtn').click(); await confirm(alpha);
  assert.equal(await queue.locator('[data-status="failed"]').count(), 3);
  assert.match(await queue.innerText(), /200/);
  const row = queue.locator('[data-decrypt-row]').first();
  await row.locator('select').selectOption('own'); await row.locator('input[type="password"]').fill(beta);
  await row.locator('[data-decrypt-retry]').click(); await confirm('');
  assert.equal(await queue.locator('[data-status="succeeded"]').count(), 1);
  assert.equal(await queue.locator('input[type="password"]').first().inputValue(), '');
  const successfulCalls = calls.filter(item => item.path === paths.b && item.command === 'decrypt_pdf').length;
  await page.locator('#pdfDecryptBatchRetry').click(); await confirm('');
  assert.equal(calls.filter(item => item.path === paths.b && item.command === 'decrypt_pdf').length, successfulCalls, 'retry all excludes completed files');
  await queue.locator('[data-decrypt-reveal]').click();
  assert.ok(calls.some(row => row.command === 'open_path' && outputs.includes(row.path)));
  report.checks.push('individual password retry', 'corrupt input and page limits', 'retry all excludes success', 'published output location');

  for (const [theme, language, width] of [['light', 'zh', 1440], ['dark', 'en', 1024], ['light', 'en', 390]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(async ({ theme, language }) => { document.documentElement.dataset.theme = theme; (await import('/src/i18n.js')).setLangWithoutFade(language); }, { theme, language });
    assert.equal(await page.locator('#pdfDecryptOverlay').evaluate(node => node.scrollWidth > node.clientWidth + 2), false);
    if (width < 760) await queue.scrollIntoViewIfNeeded();
    await queue.evaluate(node => { node.scrollTop = 0; });
    const layout = await queue.evaluate(node => {
      const list = node.getBoundingClientRect(), region = node.closest('.pdf-decrypt-v2-queue').getBoundingClientRect();
      const footer = document.querySelector('.pdf-decrypt-v2-actions').getBoundingClientRect();
      return { height: list.height, footerClear: region.bottom <= footer.top + 1, visibleRows: [...node.children].filter(child => {
        const r = child.getBoundingClientRect(); return r.height > 0 && r.bottom > list.top && r.top < list.bottom;
      }).length };
    });
    assert.ok(layout.height >= 100 && layout.visibleRows > 0 && layout.footerClear, `queue and footer remain usable at ${width}: ${JSON.stringify(layout)}`);
    await page.screenshot({ path: path.join(root, `queue-${theme}-${language}-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#pdfDecryptBatchClear').click(); await add([paths.a, paths.b, paths.plain]);
  await page.evaluate(() => { window.fixtureGate = true; });
  await page.locator('#pdfDecryptProcessBtn').click();
  await dialog.waitFor({ state: 'visible' }); await page.locator('#pdfDecryptPasswordInput').fill(alpha); await page.locator('#pdfDecryptPasswordConfirm').click();
  await page.waitForFunction(() => typeof window.fixtureRelease === 'function');
  assert.equal(await page.locator('#pdfDecryptCta').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.fixture.close()), false, 'busy queue vetoes close');
  await page.locator('#pdfDecryptBatchCancel').click();
  await page.evaluate(() => { window.fixtureGate = false; window.fixtureRelease(); window.fixtureRelease = null; });
  await settle();
  assert.deepEqual(await queue.locator('[data-decrypt-row]').evaluateAll(nodes => nodes.map(node => node.dataset.status)), ['succeeded', 'cancelled', 'cancelled']);
  assert.equal(await page.evaluate(() => window.fixtureCenter.list()[0].state), 'cancelled');
  assert.equal(await page.evaluate(() => window.fixtureCenter.list()[0].outputs.length), 1);
  report.checks.push('stop waits for current real decrypt and skips remaining files', 'busy mutation and close guards', 'cancelled task preserves published output');

  await page.locator('#pdfDecryptBatchClear').click(); await add([paths.a]);
  await page.evaluate(() => { window.fixtureBadDirectory = true; });
  await page.locator('#pdfDecryptProcessBtn').click(); await confirm(alpha);
  assert.equal(await queue.locator('[data-status="failed"]').count(), 1);
  assert.equal(await page.locator('#pdfDecryptCta').isEnabled(), true);
  await page.evaluate(() => { window.fixtureBadDirectory = false; });
  await page.locator('#pdfDecryptBatchClear').click();
  await add(Array.from({ length: 51 }, (_, i) => path.join(fixtureRoot, `${i}.pdf`)));
  assert.equal(await queue.locator('[data-decrypt-row]').count(), 0, 'oversized selection is rejected atomically');
  await add([paths.b]); await queue.locator('select').selectOption('own'); await queue.locator('input').fill(beta);
  await page.evaluate(() => window.fixture.close());
  assert.equal(await queue.locator('input[type="password"]').count(), 0, 'close clears row credentials');
  const saved = await page.evaluate(() => localStorage.getItem('toolknit.tasks.v1'));
  assert.ok(!saved.includes(alpha) && !saved.includes(beta), 'passwords never enter persistent task history');
  assert.deepEqual(report.errors, []);
  for (const output of outputs) {
    assert.match(await run(['--show-encryption', output]), /not encrypted/i);
    const pdf = await PDFDocument.load(await readFile(output)); assert.equal(pdf.getPageCount(), 1);
  }
  for (const [file, before] of originalHashes) assert.equal(hash(await readFile(file)), before, 'original input never changes');
  report.checks.push('output directory failure recovers', '50-file cap', 'close clears individual secrets', 'password-free persistent history', 'real qpdf output verification and original file hashes');
  report.passed = true; report.outputFilesVerified = outputs.length;
  console.log(`PDF decryption browser passed: ${report.checks.length} workflows; ${outputs.length} real decrypted outputs verified.`);
} finally {
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
