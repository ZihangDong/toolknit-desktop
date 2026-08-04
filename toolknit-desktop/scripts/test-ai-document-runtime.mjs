import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadImage } from '@napi-rs/canvas';
import { generateAiDocument } from '../cli/lib/ai-document-runtime.mjs';

const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'toolknit-ai-document-runtime-'));
const environment = {
  DEEPSEEK_API_KEY: 'toolknit-runtime-test-key',
  TOOLKNIT_AI_API_URL: 'https://provider.example.test/v1/chat/completions',
  TOOLKNIT_AI_MODEL: 'toolknit-test-model'
};

function layoutWith(subtitle, emphasis) {
  return {
    ready: true,
    summary: 'ToolKnit runtime verification document',
    pages: [{
      regions: [
        { type: 'title', x: 56, y: 60, w: 682, h: 50, text: 'ToolKnit 运行时验证', fontSize: 30, bold: true, align: 'center' },
        { type: 'subtitle', x: 56, y: 122, w: 682, h: 28, text: subtitle, fontSize: 14, bold: false, align: 'center' },
        { type: 'section-heading', x: 56, y: 184, w: 682, h: 36, text: '验证范围', fontSize: 18, bold: true, align: 'left' },
        { type: 'body', x: 56, y: 240, w: 682, h: 76, text: '验证供应商重试、事实约束、原子发布和高清编号图。', fontSize: 14, bold: false, align: 'left' },
        { type: 'table-row', x: 56, y: 342, w: 682, h: 46, text: '检查项 | 状态', fontSize: 13, bold: true, align: 'left' },
        { type: 'emphasis', x: 56, y: 418, w: 682, h: 62, text: emphasis, fontSize: 14, bold: true, align: 'left' }
      ]
    }]
  };
}

function providerResponse(layout) {
  return {
    ok: true,
    headers: { get: () => null },
    text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(layout) } }] })
  };
}

try {
  const retryOutput = path.join(fixtureDirectory, 'retry-safe.pdf');
  let retryCalls = 0;
  const progress = [];
  const retryResult = await generateAiDocument({
    prompt: '生成一页中文运行时验证文档。未提供日期、版本、兼容平台或测试结论，缺失事实必须写待确认。',
    output_path: retryOutput,
    page_count: 1,
    locale: 'zh-CN'
  }, {
    env: environment,
    retryDelayMs: 0,
    reportProgress: value => progress.push(value),
    fetchImpl: async () => {
      retryCalls += 1;
      if (retryCalls === 1) throw new TypeError('simulated network interruption');
      if (retryCalls === 2) {
        return providerResponse(layoutWith(
          '验收日期：2025年12月18日 | 版本：9.9.9 | Windows 11',
          '各项测试全部通过，可投入生产使用。'
        ));
      }
      return providerResponse(layoutWith('日期与版本：待确认', '验收结果：待确认，不得宣称产品可投入生产。'));
    }
  });
  assert.equal(retryCalls, 3);
  assert.deepEqual(progress.slice(0, 4), [5, 15, 35, 45]);
  assert.equal(retryResult.diagnostics.some(diagnostic => diagnostic.code === 'ungrounded_fact_replaced'), false);
  assert.equal(retryResult.outputs[0].pages, 1);
  const demoOutput = retryResult.outputs.find(output => output.kind === 'demo');
  assert.equal(demoOutput.page_files.length, 1);
  assert.equal(path.isAbsolute(demoOutput.page_files[0]), true);
  const pageMap = await loadImage(await readFile(demoOutput.page_files[0]));
  assert.ok(pageMap.width >= 1400, `Expected a high-resolution numbered map, received ${pageMap.width}px.`);
  assert.ok(pageMap.height >= 2000, `Expected a high-resolution numbered map, received ${pageMap.height}px.`);
  const overview = await loadImage(await readFile(demoOutput.path));
  assert.ok(overview.width >= 900, `Expected a readable single-column overview, received ${overview.width}px.`);

  let unauthorizedCalls = 0;
  await assert.rejects(
    generateAiDocument({
      prompt: 'Generate a one-page document.',
      output_path: path.join(fixtureDirectory, 'unauthorized.pdf'),
      page_count: 1,
      locale: 'en'
    }, {
      env: environment,
      retryDelayMs: 0,
      fetchImpl: async () => {
        unauthorizedCalls += 1;
        return { ok: false, status: 401, headers: { get: () => null }, text: async () => { throw new Error('must not read'); } };
      }
    }),
    error => error.code === 'PROVIDER_ERROR'
      && error.details.stage === 'provider_request'
      && error.details.retryable === false
      && error.details.attempts === 1
  );
  assert.equal(unauthorizedCalls, 1);

  const unverifiedOutput = path.join(fixtureDirectory, 'unverified.pdf');
  let unverifiedCalls = 0;
  const repairedResult = await generateAiDocument({
    prompt: '生成一页产品验收摘要，未提供任何测试结果或版本。',
    output_path: unverifiedOutput,
    page_count: 1,
    locale: 'zh-CN'
  }, {
    env: environment,
    retryDelayMs: 0,
    fetchImpl: async () => {
      unverifiedCalls += 1;
      return providerResponse(layoutWith('版本：8.8.8', '所有检查均已通过，具备上线条件。'));
    }
  });
  assert.equal(unverifiedCalls, 3);
  const groundingWarning = repairedResult.diagnostics.find(diagnostic => diagnostic.code === 'ungrounded_fact_replaced');
  assert.ok(groundingWarning);
  assert.ok(groundingWarning.claimTypes.includes('version'));
  assert.ok(groundingWarning.claimTypes.includes('unverified_outcome'));
  const repairedProject = await readFile(path.join(fixtureDirectory, 'unverified.toolknit.json'), 'utf8');
  assert.doesNotMatch(repairedProject, /8\.8\.8|所有检查均已通过|具备上线条件/);
  assert.match(repairedProject, /待确认/);

  console.log('AI document runtime retry, grounding, and preview checks passed');
} finally {
  await rm(fixtureDirectory, { recursive: true, force: true });
}
