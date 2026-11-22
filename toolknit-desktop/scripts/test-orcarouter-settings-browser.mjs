import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const server = await createServer({ configFile: false, logLevel: 'error', server: {
  host: '127.0.0.1', port: 0, hmr: false, watch: { ignored: ['**/tmp/**', '**/src-tauri/**', '**/cli/**'] }
} });
server.middlewares.use('/__orcarouter-settings', (_request, response) => {
  response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><body></body></html>');
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__orcarouter-settings`);
  const checks = await page.evaluate(async () => {
    document.body.innerHTML = await (await fetch('/src/app/templates/ai-key.html')).text();
    const { createAiSettingsRuntime } = await import('/src/app/ai-settings-runtime.js');
    let savedKey = '', saves = 0;
    const key = 'local-browser-orca-fixture-credential', checks = [];
    const check = (condition, name) => { if (!condition) throw new Error(name); checks.push(name); };
    const runtime = createAiSettingsRuntime({ aiKeyStore: {
      get: async () => savedKey, hasKey: () => Boolean(savedKey), set: async value => { savedKey = value; saves++; }
    }, onError: error => { throw error; } });
    try {
      for (const url of ['https://api.orcarouter.ai', 'https://api.orcarouter.ai/v1',
        'https://api.orcarouter.ai/v1/', 'https://api.orcarouter.ai/v1/chat/completions']) {
        await runtime.openApiKeySettings(); runtime.setApiKeyPlatform('custom');
        document.getElementById('apiKeyInput').value = key;
        document.getElementById('apiKeyCustomUrl').value = url;
        document.getElementById('apiKeyCustomModel').value = 'openai/gpt-4o-mini';
        document.getElementById('apiKeySave').click();
        await new Promise(resolve => setTimeout(resolve, 0));
        const config = runtime.getAiPlatformConfig();
        check(config.url === 'https://api.orcarouter.ai/v1/chat/completions'
          && config.model === 'openai/gpt-4o-mini' && !config.allowPrivateHttp, `custom save ${new URL(url).pathname}`);
      }
      check(savedKey === key && saves === 4, 'key passed to dedicated store');
      check(!JSON.stringify({ ...localStorage }).includes(key), 'key absent from configuration storage');
      await runtime.openApiKeySettings();
      check(document.getElementById('apiKeyCustomModel').value === 'openai/gpt-4o-mini'
        && document.getElementById('apiKeyCustomUrl').value.endsWith('/v1/chat/completions'), 'custom settings restored');
      document.getElementById('apiKeyCustomUrl').value = 'http://api.orcarouter.ai/v1';
      document.getElementById('apiKeySave').click(); await new Promise(resolve => setTimeout(resolve, 0));
      check(saves === 4 && document.getElementById('apiKeyStatus').classList.contains('error'), 'public HTTP rejected before key save');
      document.getElementById('apiKeyCustomUrl').value = 'https://api.orcarouter.ai/v1';
      document.getElementById('apiKeyCustomModel').value = '';
      document.getElementById('apiKeySave').click(); await new Promise(resolve => setTimeout(resolve, 0));
      check(saves === 4, 'missing model rejected before key save');
      return checks;
    } finally { runtime.dispose(); localStorage.clear(); }
  });
  assert.deepEqual(errors, []);
  const directory = new URL('../tmp/orcarouter/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('settings-browser-report.json', directory), JSON.stringify({
    scope: 'actual-settings-template-and-runtime-with-memory-key-store', authenticatedProvider: 'unverified', checks
  }, null, 2) + '\n');
  console.log(`OrcaRouter settings: ${checks.length} Edge checks passed.`);
} finally { await browser?.close(); await server.close(); }
