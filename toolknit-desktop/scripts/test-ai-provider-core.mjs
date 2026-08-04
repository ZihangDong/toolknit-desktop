import assert from 'node:assert/strict';
import {
  AI_PROVIDER_LIMITS,
  AiProviderError,
  isPlaceholderAiApiKey,
  normalizeAiProviderConfig,
  requestAiCompletion
} from '../src/ai-provider-core.js';

const request = {
  url: 'https://api.example.test/v1/chat/completions',
  apiKey: 'test-key',
  model: 'test-model',
  messages: [{ role: 'user', content: 'Hello' }]
};

assert.deepEqual(
  normalizeAiProviderConfig({ url: 'https://api.example.test/v1/chat/completions', model: ' test-model ' }),
  { url: 'https://api.example.test/v1/chat/completions', model: 'test-model' }
);
assert.deepEqual(
  normalizeAiProviderConfig({ url: 'http://localhost:11434/v1/chat/completions', model: 'local-model' }),
  { url: 'http://localhost:11434/v1/chat/completions', model: 'local-model' }
);
for (const url of ['http://api.example.test/v1/chat/completions', 'https://user:pass@api.example.test/v1/chat/completions', 'not a URL']) {
  assert.throws(
    () => normalizeAiProviderConfig({ url, model: 'test-model' }),
    error => error instanceof AiProviderError && error.code === 'invalid_config'
  );
}

assert.equal(isPlaceholderAiApiKey('你的 DeepSeek Key'), true);
assert.equal(isPlaceholderAiApiKey('<your DeepSeek API key>'), true);
assert.equal(isPlaceholderAiApiKey('sk-real-provider-key'), false);

let sentBody = null;
const content = await requestAiCompletion({
  ...request,
  maxTokens: 100,
  fetchImpl: async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return {
      ok: true,
      headers: { get: () => null },
      text: async () => JSON.stringify({ choices: [{ message: { content: 'World' } }] })
    };
  }
});
assert.equal(content, 'World');
assert.equal(sentBody.max_tokens, 100);
assert.equal(sentBody.stream, false);

let errorTextRead = false;
await assert.rejects(
  requestAiCompletion({
    ...request,
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      text: async () => { errorTextRead = true; return 'echoed secret'; }
    })
  }),
  error => error instanceof AiProviderError && error.code === 'http_error' && error.status === 401
);
assert.equal(errorTextRead, false);

let oversizedTextRead = false;
await assert.rejects(
  requestAiCompletion({
    ...request,
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => String(AI_PROVIDER_LIMITS.maxResponseBytes + 1) },
      text: async () => { oversizedTextRead = true; return ''; }
    })
  }),
  error => error instanceof AiProviderError && error.code === 'response_too_large'
);
assert.equal(oversizedTextRead, false);

const unicodeOversizedResponse = JSON.stringify({
  choices: [{ message: { content: '\u4e2d'.repeat(Math.ceil(AI_PROVIDER_LIMITS.maxResponseBytes / 3)) } }]
});
assert.ok(unicodeOversizedResponse.length < AI_PROVIDER_LIMITS.maxResponseBytes);
await assert.rejects(
  requestAiCompletion({
    ...request,
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      text: async () => unicodeOversizedResponse
    })
  }),
  error => error instanceof AiProviderError && error.code === 'response_too_large'
);

await assert.rejects(
  requestAiCompletion({
    ...request,
    fetchImpl: async () => ({ ok: true, headers: { get: () => null }, text: async () => '{broken' })
  }),
  error => error instanceof AiProviderError && error.code === 'invalid_response'
);
await assert.rejects(
  requestAiCompletion({ ...request, maxTokens: AI_PROVIDER_LIMITS.maxTokens + 1 }),
  error => error instanceof AiProviderError && error.code === 'invalid_request'
);

await assert.rejects(
  requestAiCompletion({
    ...request,
    fetchImpl: async () => { throw new TypeError('fetch failed'); }
  }),
  error => error instanceof AiProviderError && error.code === 'network_error'
);

await assert.rejects(
  requestAiCompletion({
    ...request,
    fetchImpl: async () => ({ ok: true, headers: { get: () => null }, text: async () => { throw new TypeError('stream failed'); } })
  }),
  error => error instanceof AiProviderError && error.code === 'invalid_response'
);

console.log('AI provider core regression checks passed');
