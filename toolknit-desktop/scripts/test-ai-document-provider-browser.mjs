import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import { AI_DOC_EDITOR_DEMO_LAYOUT } from '../src/features/ai-document/prompts.js';
import zh from '../src/locales/zh.json' with { type: 'json' };

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const testModel = process.env.TOOLKNIT_TEST_AI_MODEL || 'glm-5.3';
const testUrl = process.env.TOOLKNIT_TEST_AI_URL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, open: false, hmr: false } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
  const errors = [], requests = [], diagnostics = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    const prefix = '[AI Doc] API diagnostics: ';
    if (message.text().startsWith(prefix)) diagnostics.push(JSON.parse(message.text().slice(prefix.length)));
  });
  await page.addInitScript(({ model, url }) => {
    localStorage.setItem('ai_platform', 'custom');
    localStorage.setItem('ai_custom_url', url);
    localStorage.setItem('ai_custom_model', model);
    localStorage.setItem('ai_api_key', 'local-browser-test-not-a-key');
  }, { model: testModel, url: testUrl });
  await page.route('https://api.github.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  let mode = 'truncated';
  await page.route(testUrl, route => {
    const body = route.request().postDataJSON();
    requests.push({ model: body.model, maxTokens: body.max_tokens, reasoningEffort: body.reasoning_effort, thinking: body.thinking });
    assert.equal(body.diagnostics, undefined, 'diagnostic options must not reach the provider');
    if (mode === 'network') return route.abort('connectionrefused');
    if (mode === 'plain-404') return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' });
    if (mode === 'json-404') return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({
      error: { code: 'model_not_found', type: 'invalid_request_error', message: 'The requested model does not exist.' },
      apiKey: 'local-browser-test-not-a-key', messages: body.messages
    }) });
    const choice = mode === 'truncated'
      ? { finish_reason: 'length', message: { content: '', reasoning_content: 'synthetic reasoning, not a document' } }
      : mode === 'empty' ? { finish_reason: 'stop', message: { content: '' } }
      : { finish_reason: 'stop', message: { content: JSON.stringify(AI_DOC_EDITOR_DEMO_LAYOUT) } };
    return route.fulfill({ status: mode === 'http' ? 429 : 200, contentType: 'application/json', body: JSON.stringify({
      choices: [choice], usage: { prompt_tokens: 200, completion_tokens: 8192, total_tokens: 8392 }
    }) });
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  const card = page.locator('.audio-list-item[data-tool="ai-doc"]');
  await card.waitFor({ state: 'attached' });
  await card.evaluate(node => node.click());
  await page.waitForSelector('#aiDocOverlay.visible');
  for (const [nextMode, expected] of [['truncated', '输出长度上限'], ['empty', '未返回正文'], ['http', '429'],
    ['json-404', '404'], ['plain-404', '404'], ['network', zh.home.aiRequestErrors.network]]) {
    mode = nextMode;
    await page.locator('#aiDocChatInput').fill('Create a synthetic one-page QA document.');
    await page.locator('#aiDocChatSend').click();
    await page.waitForFunction(expected => [...document.querySelectorAll('.ai-doc-chat-msg-ai .ai-doc-chat-bubble')]
      .at(-1)?.textContent.includes(expected), expected);
    await page.waitForFunction(() => !document.querySelector('#aiDocMask').classList.contains('visible'));
    console.log(`PASS document error feedback: ${nextMode}`);
  }
  mode = 'success';
  await page.locator('#aiDocChatInput').fill('Retry the synthetic document.');
  await page.locator('#aiDocChatSend').click();
  await page.waitForSelector('.ai-doc-gen-link');
  await page.waitForFunction(() => document.querySelector('#aiDocThumbScroll')?.children.length > 0);
  await page.locator('.ai-doc-gen-link').click();
  await page.waitForSelector('#aiDocEditOverlay.visible');
  await mkdir('tmp/ai-document-provider', { recursive: true });
  await page.screenshot({ path: 'tmp/ai-document-provider/editor-after-retry.png' });
  assert.equal(requests.length, 7);
  assert.equal(diagnostics.length, 6);
  const truncated = diagnostics.find(detail => detail.code === 'response_truncated');
  assert.equal(truncated.status, 200);
  assert.equal(truncated.maxTokens, 8192);
  assert.equal(truncated.reasoningEffort, 'low');
  assert.equal(truncated.completion.finishReason, 'length');
  assert.equal(truncated.completion.contentBytes, 0);
  assert.equal(truncated.completion.usage.completionTokens, 8192);
  assert.ok(diagnostics.some(detail => detail.status === 404 && detail.response?.error?.code === 'model_not_found'));
  assert.ok(diagnostics.some(detail => detail.status === 404 && detail.response?.format === 'text'));
  assert.ok(diagnostics.some(detail => detail.code === 'network_error' && detail.response === null));
  assert.ok(!JSON.stringify(diagnostics).includes('local-browser-test-not-a-key'));
  assert.ok(!JSON.stringify(diagnostics).includes('Create a synthetic one-page QA document.'));
  assert.ok(!JSON.stringify(diagnostics).includes('synthetic reasoning'));
  for (const request of requests) {
    assert.equal(request.model, testModel);
    assert.equal(request.reasoningEffort, 'low');
    assert.equal(request.maxTokens, 8192);
    assert.equal(request.thinking, undefined);
  }
  assert.deepEqual(errors, []);
  console.log('AI document provider browser checks passed: safe API diagnostics, GLM options, errors, retry, preview and editor');
} finally {
  await browser?.close();
  await server.close();
}
