import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createServer } from 'vite';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
// Exercise the real auxiliary page, controller closures and platform adapters.
// Only the IPC boundary is simulated; no screenshots, keys or user files leave the test.
const server = await createServer({ configFile: false, optimizeDeps: { entries: ['screenshot.html'] },
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: { ignored: ['**/tmp/**', '**/src-tauri/target/**', '**/.git/**'] } }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, channel: process.env.TOOLKNIT_TEST_BROWSER_CHANNEL || undefined });
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(theme => {
      const callbacks = new Map(), listeners = new Map(); let id = 0;
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1200, 800);
      ctx.fillStyle = '#111'; ctx.font = '28px sans-serif'; ctx.fillText('Hello world', 150, 150);
      const image = canvas.toDataURL();
      window.__qa = { calls: [], ready: true, translationReady: true, fail: '', deferred: false, key: 'synthetic-test-key', blockAI: true };
      const qa = window.__qa;
      const context = { theme, lang: 'zh', provider: { url: 'https://example.invalid/v1', model: 'synthetic' } };
      qa.context = context;
      qa.emit = (event, payload) => { for (const [key, listener] of listeners) if (listener.event === event) callbacks.get(listener.handler)?.({ event, id: key, payload }); };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_, key) => listeners.delete(key) };
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'screenshot-capture' }, currentWebview: { label: 'screenshot-capture' } },
        transformCallback(fn) { callbacks.set(++id, fn); return id; }, unregisterCallback(key) { callbacks.delete(key); },
        async invoke(command, args = {}) {
          const r = args.request; qa.calls.push({ command, ...r });
          if (command === 'plugin:event|listen') { listeners.set(++id, args); return id; }
          if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
          if (command.startsWith('plugin:window|')) return;
          if (command === 'get_output_root' || command === 'get_default_output_root') return 'C:/SyntheticOutput';
          if (command === 'quick_screenshot_image') return Uint8Array.from(atob(image.split(',')[1]), c => c.charCodeAt(0)).buffer;
          if (command === 'load_ai_api_key') { if (qa.blockAI) throw 'AI key must not be read for local translation'; return qa.key; }
          if (command === 'request_private_ai_completion') { if (qa.blockAI) throw 'Translation must not call AI'; return { content: 'Synthetic AI extraction' }; }
          if (command === 'cancel_private_ai_completion') return;
          if (command === 'quick_screenshot') {
            if (r.action === 'boot') return { session: 7, context, desktop: { bounds: { x: 0, y: 0, width: 1200, height: 800 }, windows: [], monitors: [] } };
            if (r.action === 'metadata') return { context };
            if (r.action === 'cancel') qa.emit('screenshot-ended');
            return null;
          }
          if (command === 'local_ocr') {
            if (r.session !== 7) throw 'screenshot:expired';
            if (r.action === 'status') {
              if (qa.deferStatus) await new Promise(resolve => { qa.releaseStatus = resolve; });
              return { ready: qa.ready, installing: false };
            }
            if (r.action === 'open-manager') { qa.emit('screenshot-ended'); return; }
            if (r.action === 'cancel') return;
            if (r.action === 'recognize') {
              if (qa.fail) throw qa.fail;
              const result = { engine: 'pp-ocrv5-mobile', text: 'Hello world', lines: [{ text: 'Hello world', x: 40, y: 40, width: 180, height: 28 }] };
              if (qa.deferred) await new Promise(resolve => { qa.release = resolve; });
              return result;
            }
          }
          if (command === 'local_translation') {
            if (r.action === 'status') return { ready: qa.translationReady, targetLanguage: 'zh-Hans' };
            if (r.action === 'translate') {
              if (qa.deferTranslation) await new Promise(resolve => { qa.releaseTranslation = resolve; });
              return { results: r.texts.map(() => '你好，世界') };
            }
            if (r.action === 'cancel') return;
          }
          throw Error(`Unexpected test IPC: ${command}/${r?.action}`);
        }
      };
    }, theme);
    await page.goto(`${server.resolvedUrls.local[0]}screenshot.html?role=capture`);
    const calls = (command, action) => page.evaluate(([command, action]) => __qa.calls.filter(c => c.command === command && c.action === action).length, [command, action]);
    const button = action => page.locator(`[data-shot-action="${action}"]`);
    const idle = () => page.waitForFunction(() => document.getElementById('shotBusy').hidden);
    const crop = async () => {
      await page.mouse.move(100, 100); await page.mouse.down(); await page.mouse.move(700, 450); await page.mouse.up();
      await page.locator('#shotToolbar').waitFor({ state: 'visible' });
    };
    const reopen = async () => {
      const count = await calls('quick_screenshot', 'ready');
      await page.evaluate(() => __qa.emit('screenshot-opened', 7));
      await page.waitForFunction(count => __qa.calls.filter(c => c.command === 'quick_screenshot' && c.action === 'ready').length > count, count);
      await crop();
    };
    await page.waitForFunction(() => __qa.calls.some(c => c.action === 'ready'));
    await crop();
    await button('ocr').click();
    await page.locator('#shotDialog textarea').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#shotDialog textarea').inputValue(), 'Hello world');
    assert.equal(await calls('local_ocr', 'recognize'), 1);
    await page.locator('#shotDialogOk').click(); await idle();
    await button('ai-translate').click(); await idle();
    assert.equal(await calls('local_translation', 'translate'), 1, 'configured AI cannot gate local translation');
    assert.equal(await calls('local_ocr', 'recognize'), 1, 'unchanged crop reuses successful OCR');
    assert.equal(await calls('request_private_ai_completion', undefined), 0, 'local actions never upload an image');
    assert.equal(await calls('load_ai_api_key', undefined), 0, 'translation does not read the configured AI credential');
    await page.evaluate(() => { __qa.deferTranslation = true; });
    await button('ai-translate').click(); await page.waitForFunction(() => typeof __qa.releaseTranslation === 'function');
    const translationCancels = await calls('local_translation', 'cancel');
    await page.evaluate(() => { __qa.context.provider.model = 'changed-while-translating'; __qa.emit('screenshot-context-changed'); });
    await page.waitForFunction(() => __qa.calls.some(c => c.command === 'quick_screenshot' && c.action === 'metadata'));
    await page.waitForTimeout(100);
    assert.equal(await calls('local_translation', 'cancel'), translationCancels, 'AI settings changes cannot cancel local translation');
    assert.equal(await page.locator('#shotBusy').isVisible(), true);
    await page.evaluate(() => { __qa.deferTranslation = false; __qa.releaseTranslation(); }); await idle();
    assert.equal(await calls('request_private_ai_completion', undefined), 0);
    await page.evaluate(() => { __qa.blockAI = false; });
    await button('ai-extract').click();
    await page.locator('#shotDialog textarea').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#shotDialog textarea').inputValue(), 'Synthetic AI extraction');
    await page.locator('#shotDialogOk').click(); await idle();
    await button('cancel').click(); await reopen();
    const translationCount = await calls('local_translation', 'translate');
    await page.evaluate(() => { __qa.translationReady = false; });
    await button('ai-translate').click(); await idle();
    assert.equal(await calls('local_translation', 'translate'), translationCount, 'missing translation model does not start a job');
    assert.equal(await calls('local_ocr', 'recognize'), 1);
    await page.evaluate(() => { __qa.translationReady = true; __qa.fail = 'ocr:model-load'; });
    await button('ocr').click(); await idle();
    assert.equal(await page.locator('#shotDialog textarea').isVisible(), false, 'failed OCR must not show a stale result');
    assert(await button('ocr').isEnabled(), 'failure restores actions');
    await page.evaluate(() => { __qa.fail = ''; __qa.deferred = true; });
    await button('ocr').click(); await page.waitForFunction(() => typeof __qa.release === 'function');
    await page.locator('#shotAbort').click();
    assert.equal(await calls('local_ocr', 'cancel'), 1, 'abort propagates to the native job');
    await page.evaluate(() => { __qa.deferred = false; });
    await button('ocr').click();
    await page.locator('#shotDialog textarea').waitFor({ state: 'visible' });
    await page.locator('#shotDialogOk').click(); await idle();
    await page.evaluate(() => __qa.release());
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#shotDialog textarea').isVisible(), false, 'old completion cannot overwrite the next action');
    await button('cancel').click(); await reopen();
    await page.evaluate(() => { __qa.deferred = true; delete __qa.release; });
    await button('ocr').click(); await page.waitForFunction(() => typeof __qa.release === 'function');
    const cancelled = await calls('local_ocr', 'cancel');
    await page.evaluate(() => __qa.emit('screenshot-ended'));
    await page.waitForFunction(() => document.getElementById('shotDesktop').getAttribute('src') === null);
    assert.equal(await calls('local_ocr', 'cancel'), cancelled + 1, 'disposing capture aborts its native OCR job');
    await page.evaluate(() => { __qa.deferred = false; __qa.release(); });
    await reopen();
    assert.equal(await page.locator('#shotDialog textarea').isVisible(), false, 'closed capture cannot publish its late result');
    await page.evaluate(() => { __qa.ready = false; __qa.deferStatus = true; });
    await button('ocr').click(); await page.waitForFunction(() => typeof __qa.releaseStatus === 'function');
    await page.locator('#shotAbort').click();
    await page.evaluate(() => { __qa.deferStatus = false; __qa.releaseStatus(); });
    await page.waitForTimeout(100);
    assert.equal(await calls('local_ocr', 'open-manager'), 0, 'cancelling a slow status check cannot open the model manager');
    await button('ocr').click();
    await page.waitForFunction(() => __qa.calls.some(c => c.command === 'local_ocr' && c.action === 'open-manager'));
    assert.equal(await page.locator('#shotToolbar').isVisible(), false, 'model manager handoff disposes capture');
    assert.equal(await page.locator('#shotDesktop').getAttribute('src'), null);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`Screenshot OCR ${theme}: actual button path, IPC/session, offline translation, cache, AI compatibility, failure recovery, abort/late completion and model handoff passed.`);
  }
} finally { await browser.close(); await server.close(); }
