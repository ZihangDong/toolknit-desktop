import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { preview } from 'vite';

const require = createRequire(process.env.TOOLKNIT_TEST_MODULES
  ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const testModel = process.env.TOOLKNIT_TEST_AI_MODEL || 'glm-5.3-flash';
const testUrl = process.env.TOOLKNIT_TEST_AI_URL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const expectedEffort = process.env.TOOLKNIT_TEST_AI_REASONING_EFFORT === 'none'
  ? undefined : process.env.TOOLKNIT_TEST_AI_REASONING_EFFORT || 'low';
const server = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0, open: false } });
const directions = { directions: [
  { name: 'Formal', desc: 'Use a professional tone.' },
  { name: 'Concise', desc: 'Use fewer words.' },
  { name: 'Friendly', desc: 'Use a natural tone.' }
] };
const sourceText = 'Hello, thank you for your help.';
const translationText = 'Bonjour, merci pour votre aide.';
const polishedText = 'Hello, and thank you for your assistance.';
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.TOOLKNIT_TEST_BROWSER ? { executablePath: process.env.TOOLKNIT_TEST_BROWSER } : {}) });
  for (const phase of ['translation', 'polish-analysis', 'polish-output']) {
    const translating = phase === 'translation';
    const prefix = translating ? 'aiTranslate' : 'aiPolish';
    const tool = translating ? 'ai-translate' : 'ai-polish';
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
    const requests = [], errors = [], delayed = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ model, url }) => {
      localStorage.setItem('ai_platform', 'custom');
      localStorage.setItem('ai_custom_url', url);
      localStorage.setItem('ai_custom_model', model);
      localStorage.setItem('ai_api_key', 'local-text-qa-not-a-real-key');
    }, { model: testModel, url: testUrl });
    await page.route('https://api.github.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    let responseMode = 'truncated';
    await page.route(testUrl, async route => {
      const body = route.request().postDataJSON();
      assert.equal(body.model, testModel);
      const analyzing = body.messages[1].content.startsWith('\u8bf7\u5206\u6790');
      requests.push({ hasTokenCap: Object.hasOwn(body, 'max_tokens'), effort: body.reasoning_effort, thinking: body.thinking });
      const mode = phase === 'polish-output' && analyzing ? 'success' : responseMode;
      const content = analyzing ? JSON.stringify(directions)
        : translating ? JSON.stringify({ pairs: [{ original: sourceText, translated: translationText }] }) : polishedText;
      const choice = mode === 'truncated' ? { finish_reason: 'length', message: { content: '', reasoning_content: 'synthetic reasoning' } }
        : mode === 'empty' ? { finish_reason: 'stop', message: { content: '' } }
        : { finish_reason: 'stop', message: { content } };
      if (mode === 'delayed') await new Promise(resolve => delayed.push(resolve));
      await route.fulfill({ status: mode === 'auth' ? 401 : mode === 'rate' ? 429 : 200,
        contentType: 'application/json', body: JSON.stringify({ choices: [choice] }) }).catch(() => {});
    });
    try {
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
      const card = page.locator(`.audio-list-item[data-tool="${tool}"]`);
      await card.waitFor({ state: 'attached' });
      const open = async () => {
        await card.evaluate(node => node.click());
        await page.waitForSelector(`#${prefix}Overlay.visible`);
        await page.locator(`#${prefix}Input`).fill(sourceText);
        if (phase === 'polish-output') {
          await page.locator('#aiPolishStartBtn').click();
          await page.waitForSelector('#aiPolishDirectionList button');
        }
      };
      const trigger = async () => {
        if (phase === 'polish-output') await page.locator('#aiPolishDirectionList button').first().click();
        else {
          await page.locator(`#${prefix}StartBtn`).click();
          if (translating) await page.locator('#aiTranslateLangList button').filter({ hasText: 'French' }).click();
        }
      };
      const feedback = expected => page.waitForFunction(expected => [...document.querySelectorAll('.app-toast')]
        .some(node => node.textContent.includes(expected)), expected);
      const maskHidden = () => page.waitForFunction(id => !document.getElementById(id).classList.contains('visible'), `${prefix}Mask`);
      const waitDelayed = async () => {
        for (let i = 0; !delayed.length && i < 100; i++) await page.waitForTimeout(20);
        assert.ok(delayed.length, 'request must reach the provider fixture');
      };
      const finishDelayed = () => { for (const finish of delayed.splice(0)) finish(); };

      await open();
      for (const [mode, expected] of [['truncated', '\u8f93\u51fa\u957f\u5ea6\u4e0a\u9650'], ['empty', '\u672a\u8fd4\u56de\u6b63\u6587'], ['auth', '401'], ['rate', '429']]) {
        responseMode = mode;
        await trigger();
        await feedback(expected);
        await maskHidden();
      }
      await page.clock.install();
      responseMode = 'delayed';
      await trigger();
      await waitDelayed();
      await page.clock.fastForward(90100);
      assert.equal(await page.locator(`#${prefix}Mask`).evaluate(node => node.classList.contains('visible')), true,
        'request must not stop at the old 90-second deadline');
      await page.clock.fastForward(90100);
      await feedback('\u54cd\u5e94\u8d85\u65f6');
      await maskHidden();
      finishDelayed();

      responseMode = 'success';
      await trigger();
      await maskHidden();
      if (translating) assert.equal(await page.locator('#aiTranslateResult').innerText(), translationText);
      else if (phase === 'polish-analysis') assert.equal(await page.locator('#aiPolishDirectionList button').count(), 3);
      else assert.equal(await page.locator('#aiPolishPolishedText').innerText(), polishedText);

      await page.locator(`#${prefix}Back`).click();
      await open();
      responseMode = 'delayed';
      await trigger();
      await waitDelayed();
      await page.keyboard.press('Escape');
      await page.waitForFunction(id => !document.getElementById(id).classList.contains('visible'), `${prefix}Overlay`);
      responseMode = 'success';
      await open();
      finishDelayed();
      await page.waitForTimeout(100);
      assert.equal(await page.locator(`#${translating ? 'aiTranslateResult' : 'aiPolishPolishedText'}`).innerText(), '',
        'old completion cannot enter a reopened session');
      await trigger();
      await maskHidden();
      for (const request of requests) {
        assert.equal(request.hasTokenCap, false, 'do not impose a new output-token limit');
        assert.equal(request.effort, expectedEffort);
        assert.equal(request.thinking, undefined);
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${phase}: error codes, 180-second deadline, unchanged output allowance, retry, success and stale-response isolation`);
    } finally {
      for (const finish of delayed.splice(0)) finish();
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
