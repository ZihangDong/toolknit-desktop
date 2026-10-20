import assert from 'node:assert/strict';
import { createAiProviderDiagnostics, AI_DIAGNOSTIC_MAX_BYTES } from '../src/ai-provider-core.js';
import {
  AI_PROVIDER_LIMITS,
  AiProviderError,
  isPrivateHttpAiProviderUrl,
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

const largeVision = [{ role: 'user', content: [{ type: 'image_url', image_url: {
  url: 'data:image/png;base64,' + 'YWFh'.repeat(3 * 1024 * 1024 / 4)
} }] }];
for (const native of [false, true]) {
  let dispatched = 0;
  const transport = native ? { nativeRequestImpl: async () => { dispatched++; return { content: 'ok' }; } }
    : { fetchImpl: async () => { dispatched++; return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })); } };
  assert.equal(await requestAiCompletion({ ...request, messages: largeVision, ...transport }), 'ok');
  assert.equal(dispatched, 1, 'valid image requests can exceed the response-size budget');
  const nearLimit = structuredClone(largeVision);
  nearLimit[0].content[0].image_url.url = 'data:image/png;base64,' + 'YWFh'.repeat((AI_PROVIDER_LIMITS.maxRequestBytes - 1024) / 4);
  nearLimit.unshift({ role: 'system', content: 'x'.repeat(2048) });
  await assert.rejects(requestAiCompletion({ ...request, messages: nearLimit, ...transport }), error => error.code === 'invalid_request');
  assert.equal(dispatched, 1, 'the full serialized request budget includes its text envelope');
}

assert.deepEqual(
  normalizeAiProviderConfig({ url: 'https://api.example.test/v1/chat/completions', model: ' test-model ' }),
  { url: 'https://api.example.test/v1/chat/completions', model: 'test-model' }
);
for (const [url, expected] of [
  ['https://api.example.test/', 'https://api.example.test/v1/chat/completions'],
  ['https://api.example.test/v1', 'https://api.example.test/v1/chat/completions'],
  ['https://api.example.test/v1/', 'https://api.example.test/v1/chat/completions'],
  ['https://api.example.test/chat/completions', 'https://api.example.test/chat/completions'],
  ['https://api.example.test/custom/chat/completions', 'https://api.example.test/custom/chat/completions']
]) {
  assert.equal(normalizeAiProviderConfig({ url, model: 'test-model' }).url, expected);
}
assert.deepEqual(
  normalizeAiProviderConfig({ url: 'http://localhost:11434/v1/chat/completions', model: 'local-model' }),
  { url: 'http://localhost:11434/v1/chat/completions', model: 'local-model' }
);
assert.equal(isPrivateHttpAiProviderUrl('http://172.23.20.253:3001/v1/chat/completions'), true);
assert.equal(isPrivateHttpAiProviderUrl('http://192.168.1.20/v1/chat/completions'), true);
assert.equal(isPrivateHttpAiProviderUrl('http://8.8.8.8/v1/chat/completions'), false);
assert.throws(
  () => normalizeAiProviderConfig({ url: 'http://172.23.20.253:3001/v1/chat/completions', model: 'test-model' }),
  error => error instanceof AiProviderError && error.code === 'private_http_requires_opt_in'
);
assert.deepEqual(
  normalizeAiProviderConfig({
    url: 'http://172.23.20.253:3001/v1/chat/completions#ignored',
    model: ' test-model ',
    allowPrivateHttp: true
  }),
  { url: 'http://172.23.20.253:3001/v1/chat/completions', model: 'test-model' }
);
for (const url of ['http://api.example.test/v1/chat/completions', 'http://8.8.8.8/v1/chat/completions']) {
  assert.throws(
    () => normalizeAiProviderConfig({ url, model: 'test-model' }),
    error => error instanceof AiProviderError && error.code === 'insecure_http_not_allowed'
  );
}
for (const url of ['https://user:pass@api.example.test/v1/chat/completions', 'not a URL']) {
  assert.throws(
    () => normalizeAiProviderConfig({ url, model: 'test-model' }),
    error => error instanceof AiProviderError && error.code === 'invalid_config'
  );
}

let nativeRequest = null;
assert.equal(await requestAiCompletion({
  ...request,
  url: 'http://172.23.20.253:3001/v1/chat/completions',
  allowPrivateHttp: true,
  nativeRequestImpl: async value => {
    nativeRequest = value;
    return { content: 'LAN response' };
  }
}), 'LAN response');
assert.equal(nativeRequest.url, 'http://172.23.20.253:3001/v1/chat/completions');
assert.equal(nativeRequest.allowPrivateHttp, true);
assert.equal(nativeRequest.apiKey, request.apiKey);

nativeRequest = null;
assert.equal(await requestAiCompletion({
  ...request,
  nativeRequestImpl: async value => {
    nativeRequest = value;
    return { content: 'HTTPS native response' };
  }
}), 'HTTPS native response');
assert.equal(nativeRequest.url, request.url, 'Tauri native transport must cover public HTTPS providers');
assert.equal(nativeRequest.allowPrivateHttp, false);

await assert.rejects(
  requestAiCompletion({
    ...request,
    url: 'http://172.23.20.253:3001/v1/chat/completions',
    allowPrivateHttp: true
  }),
  error => error instanceof AiProviderError && error.code === 'native_transport_unavailable'
);

await assert.rejects(
  requestAiCompletion({
    ...request,
    url: 'http://172.23.20.253:3001/v1/chat/completions',
    allowPrivateHttp: true,
    nativeRequestImpl: async () => { throw 'ai-provider:http_error:429'; }
  }),
  error => error instanceof AiProviderError && error.code === 'http_error' && error.status === 429
);

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
assert.equal(sentBody.temperature, 0.7);
for (const temperature of [0, 1.2]) {
  await requestAiCompletion({...request, temperature, fetchImpl:async(_url,options)=>{
    assert.equal(JSON.parse(options.body).temperature,temperature);
    return new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}));
  }});
  await requestAiCompletion({...request,temperature,nativeRequestImpl:async value=>{
    assert.equal(value.temperature,temperature);return {content:'ok'};
  }});
}
for (const temperature of [-1,3,NaN,'0']) await assert.rejects(requestAiCompletion({...request,temperature}),error=>error.code==='invalid_request');

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

let streamedBytesRead = 0;
let streamedResponseCancelled = false;
await assert.rejects(
  requestAiCompletion({
    ...request,
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      text: async () => { throw new Error('streaming response must not use text()'); },
      body: {
        getReader: () => ({
          read: async () => {
            streamedBytesRead += 1024 * 1024;
            return { done: false, value: new Uint8Array(1024 * 1024) };
          },
          cancel: async () => { streamedResponseCancelled = true; },
          releaseLock: () => {}
        })
      }
    })
  }),
  error => error instanceof AiProviderError && error.code === 'response_too_large'
);
assert.equal(streamedBytesRead, 3 * 1024 * 1024);
assert.equal(streamedResponseCancelled, true);

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

for (const [url, model, expectedEffort] of [
  ['https://open.bigmodel.cn/api/paas/v4/chat/completions', 'glm-5.3-flash', 'low'],
  ['https://open.bigmodel.cn/api/paas/v4/chat/completions', 'glm-5.3', 'low'],
  ['https://open.bigmodel.cn/api/paas/v4/chat/completions', ' GLM-5.3 ', 'low'],
  ['https://api.deepseek.com/chat/completions', 'deepseek-v4-pro', 'low'],
  ['https://api.deepseek.com/v1/chat/completions', 'deepseek-v4-flash', 'low'],
  ['https://api.deepseek.com/chat/completions', ' DEEPSEEK-V4-PRO ', 'low'],
  ['https://api.deepseek.com.example.test/chat/completions', 'deepseek-v4-pro', undefined],
  ['https://api.deepseek.com/chat/completions', 'deepseek-v4-pro-preview', undefined],
  ['https://api.deepseek.com/chat/completions', 'glm-5.3', undefined],
  ['https://open.bigmodel.cn/api/paas/v4/chat/completions', 'deepseek-v4-pro', undefined],
  [request.url, 'glm-5.3-flash', undefined],
  [request.url, 'glm-5.3', undefined],
  ['https://open.bigmodel.cn.example.test/v1/chat/completions', 'glm-5.3', undefined],
  ['https://open.bigmodel.cn/api/paas/v4/chat/completions', 'glm-5.3-preview', undefined],
  ['https://open.bigmodel.cn/api/paas/v4/chat/completions', 'another-model', undefined]
]) {
  await requestAiCompletion({ ...request, url, model, maxTokens: 8192, reasoningEffort: 'low', timeoutMs: 180000,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.reasoning_effort, expectedEffort);
      assert.equal(body.max_tokens, 8192);
      assert.equal(body.thinking, undefined, 'always-thinking models must not receive thinking:disabled');
      assert.equal(body.timeoutMs, undefined, 'timeout is a local transport setting');
      return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: 'valid' }, finish_reason: 'stop' }] }) };
    }
  });
}
for (const [url, model] of [
  ['https://api.deepseek.com/chat/completions', 'deepseek-v4-pro'],
  ['https://api.deepseek.com/v1/chat/completions', 'deepseek-v4-flash'],
  ['https://open.bigmodel.cn/api/paas/v4/chat/completions', 'glm-5.3'],
  ['https://open.bigmodel.cn/api/paas/v4/chat/completions', 'glm-5.3-flash']
]) {
  for (const reasoningEffort of [undefined, 'low', 'high', 'max']) {
    const expected = reasoningEffort ?? 'low';
    await requestAiCompletion({ ...request, url, model, reasoningEffort, fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.reasoning_effort, expected);
      assert.equal(body.thinking, undefined);
      assert.equal(body.max_tokens, undefined, 'do not silently change output ceilings');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'valid' }, finish_reason: 'stop' }] }));
    } });
    await requestAiCompletion({ ...request, url, model, reasoningEffort, nativeRequestImpl: async value => {
      assert.equal(value.reasoningEffort, expected, 'native and fetch must use the same effective effort');
      return { content: 'valid' };
    } });
  }
  await assert.rejects(requestAiCompletion({ ...request, url, model, diagnostics: true,
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length',
      message: { content: '', reasoning_content: 'synthetic private reasoning' } }] }))
  }), error => error.code === 'response_truncated' && error.diagnostics.reasoningEffort === 'low');
}
await requestAiCompletion({ ...request, timeoutMs: 180000, reasoningEffort: 'low', nativeRequestImpl: async value => {
  assert.equal(value.timeoutMs, 180000); assert.equal(value.reasoningEffort, 'low'); return { content: 'valid' };
} });
for (const code of ['timeout', 'response_truncated', 'empty_response']) {
  await assert.rejects(requestAiCompletion({ ...request, nativeRequestImpl: async () => { throw `ai-provider:${code}`; } }), error => error.code === code);
}
for (const timeoutMs of [0, -1, 180001, Infinity, '90000']) {
  await assert.rejects(requestAiCompletion({ ...request, timeoutMs }), error => error.code === 'invalid_request');
}
await assert.rejects(requestAiCompletion({ ...request, timeoutMs: 10, fetchImpl: (_url, { signal }) => new Promise((_, reject) => {
  signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
}) }), error => error.code === 'timeout');
const aborter = new AbortController(); aborter.abort();
let dispatched = false;
await assert.rejects(requestAiCompletion({ ...request, signal: aborter.signal, nativeRequestImpl: async () => {
  dispatched = true; return { content: 'unexpected' };
} }), error => error.code === 'aborted');
assert.equal(dispatched, false);
for (const [choice, expectedCode] of [
  [{ message: { content: '', reasoning_content: 'not final output' }, finish_reason: 'length' }, 'response_truncated'],
  [{ message: { content: '{partial' }, finish_reason: 'length' }, 'response_truncated'],
  [{ message: { content: '' }, finish_reason: 'stop' }, 'empty_response']
]) {
  await assert.rejects(requestAiCompletion({ ...request, fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify({ choices: [choice] }) }) }),
    error => error.code === expectedCode);
}
console.log('Long document timeout, GLM reasoning budget, cancellation and response error contracts passed');

const privateRequest = {
  ...request, url: `${request.url}?access_token=private-query-value`,
  apiKey: 'local-diagnostic-test-credential',
  messages: [{ role: 'user', content: 'Private document paragraph with unique confidential content.' }]
};

const imagePart = { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,YWJj', detail: 'high' } };
const visionMessages = [{ role: 'user', content: [{ type: 'text', text: 'Synthetic page' }, imagePart] }];
let visionBody;
assert.equal(await requestAiCompletion({ ...request, messages: visionMessages,
  fetchImpl: async (_url, init) => { visionBody = JSON.parse(init.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'recognized' } }] })); }
}), 'recognized');
assert.deepEqual(visionBody.messages, visionMessages);
for (const content of [[], [{ type: 'image_url', image_url: { url: 'https://private.test/image.png' } }],
  [{ type: 'image_url', image_url: { url: 'data:image/svg+xml;base64,YWJj' } }],
  [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,not valid' } }],
  Array.from({ length: 9 }, () => imagePart)]) {
  await assert.rejects(requestAiCompletion({ ...request, messages: [{ role: 'user', content }] }), error => error.code === 'invalid_request');
}
await assert.rejects(requestAiCompletion({ ...request, messages: [{ role: 'system', content: [imagePart] }] }), error => error.code === 'invalid_request');
const largeImage = { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + 'a'.repeat(5 * 1024 * 1024) } };
await assert.rejects(requestAiCompletion({ ...request, messages: [1, 2].map(() => ({ role: 'user', content: [largeImage] })) }), error => error.code === 'invalid_request');
const diagnosticBody = JSON.stringify({
  error: { code: 'model_not_found', type: 'invalid_request_error', message: 'The requested model does not exist.' },
  apiKey: privateRequest.apiKey, messages: privateRequest.messages,
  choices: [{ message: { content: 'Private generated document must not enter diagnostics.' } }]
});
for (const transport of ['fetch', 'native']) {
  await assert.rejects(requestAiCompletion({
    ...privateRequest, diagnostics: true,
    ...(transport === 'native' ? { nativeRequestImpl: async args => {
      assert.equal(args.diagnostics, true);
      throw `ai-provider:http_error:404:diagnostic:${JSON.stringify({ stage: 'response_body', body: diagnosticBody })}`;
    } } : { fetchImpl: async () => new Response(diagnosticBody, { status: 404, headers: { 'content-type': 'application/json', 'x-request-id': 'test-trace-404' } }) })
  }), error => {
    assert.equal(error.code, 'http_error');
    assert.equal(error.status, 404);
    assert.equal(error.diagnostics.transport, transport);
    assert.equal(error.diagnostics.path, '/v1/chat/completions');
    assert.equal(error.diagnostics.response.error.code, 'model_not_found');
    assert.equal(error.diagnostics.response.error.message, 'The requested model does not exist.');
    const logged = JSON.stringify(error);
    for (const secret of [privateRequest.apiKey, 'private-query-value', 'Private document', 'Private generated']) assert.ok(!logged.includes(secret));
    return true;
  });
}
for (const message of [privateRequest.apiKey, encodeURIComponent(privateRequest.apiKey), privateRequest.messages[0].content,
  `Invalid input: ${privateRequest.messages[0].content.slice(8, 50)}`,
  'Authorization: Bearer unrelated-secret', 'File C:\\Users\\Private\\Document.txt', 'https://example.test/?key=secret']) {
  const detail = createAiProviderDiagnostics({ body: JSON.stringify({ error: { message } }) }, privateRequest,
    { code: 'http_error', status: 400, transport: 'native' });
  assert.notEqual(detail.response.error.message, message, 'sensitive error fields must be redacted');
}
const nativeNetworkError = `ai-provider:network_error:diagnostic:${JSON.stringify({ stage: 'request', reason: 'connect' })}`;
await assert.rejects(requestAiCompletion({ ...privateRequest, diagnostics: true, nativeRequestImpl: async () => { throw nativeNetworkError; } }), error => {
  assert.equal(error.diagnostics.reason, 'connect');
  assert.equal(error.diagnostics.response, null);
  return true;
});
await assert.rejects(requestAiCompletion({ ...request, nativeRequestImpl: async () => { throw nativeNetworkError; } }), error => !error.diagnostics);
await assert.rejects(requestAiCompletion({ ...request, diagnostics: true, nativeRequestImpl: async () => { throw 'ai-provider:http_error:404:diagnostic:{broken'; } }), error => error.status === 404 && !error.diagnostics);
for (const [body, format] of [['Not Found', 'text'], ['<html>Private contents</html>', 'html']]) {
  await assert.rejects(requestAiCompletion({ ...request, diagnostics: true, fetchImpl: async () => new Response(body, { status: 404 }) }), error => {
    assert.equal(error.diagnostics.response.format, format);
    assert.ok(!JSON.stringify(error).includes('Private contents'));
    return true;
  });
}
await assert.rejects(requestAiCompletion({ ...request, diagnostics: true,
  fetchImpl: async () => new Response('x'.repeat(AI_DIAGNOSTIC_MAX_BYTES + 1), { status: 404 })
}), error => error.status === 404 && error.diagnostics.truncated && error.diagnostics.response === null);
await assert.rejects(requestAiCompletion({ ...request, diagnostics: true, fetchImpl: async () => new Response(JSON.stringify({
  choices: [{ message: { content: 'Never log partial document text' }, finish_reason: 'length' }]
})) }), error => error.code === 'response_truncated' && !JSON.stringify(error).includes('Never log'));
console.log('AI diagnostic status, response projection, redaction, limits and legacy transport checks passed');

let diagnosticStreamCancelled = false;
await assert.rejects(requestAiCompletion({ ...request, diagnostics: true,
  fetchImpl: async () => new Response(new ReadableStream({
    start() {}, cancel() { diagnosticStreamCancelled = true; }
  }), { status: 404 })
}), error => error.status === 404 && error.diagnostics.reason === 'timeout' && error.diagnostics.response === null);
assert.equal(diagnosticStreamCancelled, true, 'diagnostic deadline must cancel the response stream');
await assert.rejects(requestAiCompletion({ ...request, diagnostics: true,
  fetchImpl: async () => new Response('A generated private document in an unsupported response format')
}), error => error.code === 'invalid_response' && !JSON.stringify(error).includes('generated private document'));
console.log('Diagnostic deadlines preserve HTTP status and omit unexpected successful response bodies');

const truncatedPayload = {
  choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'private reasoning '.repeat(2200) } }],
  usage: { prompt_tokens: 200, completion_tokens: 8192, total_tokens: 8392,
    completion_tokens_details: { reasoning_tokens: 8192, secret: 'never log this' } }
};
const summary = {
  finishReason: 'length', contentBytes: 0,
  reasoningBytes: new TextEncoder().encode(truncatedPayload.choices[0].message.reasoning_content).byteLength,
  usage: { promptTokens: 200, completionTokens: 8192, totalTokens: 8392, reasoningTokens: 8192 }
};
for (const transport of ['fetch', 'native']) {
  await assert.rejects(requestAiCompletion({
    ...request, url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-5.3',
    maxTokens: 8192, reasoningEffort: 'low', diagnostics: true,
    ...(transport === 'fetch' ? { fetchImpl: async () => new Response(JSON.stringify(truncatedPayload)) }
      : { nativeRequestImpl: async () => { throw `ai-provider:response_truncated:diagnostic:${JSON.stringify({
        stage: 'completion', status: 200, completion: summary, truncated: true
      })}`; } })
  }), error => {
    assert.equal(error.code, 'response_truncated');
    assert.equal(error.status, null, 'existing domain error status is unchanged');
    assert.equal(error.diagnostics.status, 200, 'diagnostics retain the actual successful HTTP status');
    assert.equal(error.diagnostics.maxTokens, 8192);
    assert.equal(error.diagnostics.reasoningEffort, 'low');
    assert.deepEqual(error.diagnostics.completion, summary);
    assert.equal(error.diagnostics.truncated, true, 'large body omission must not discard token counters');
    assert.ok(!JSON.stringify(error).includes('private reasoning'));
    assert.ok(!JSON.stringify(error).includes('never log this'));
    return true;
  });
}
const invalidSummary = createAiProviderDiagnostics({ status: 'secret-status', completion: {
  finishReason: 'private content', contentBytes: -1, reasoningBytes: 'secret-text',
  usage: { promptTokens: 'secret-value', completionTokens: Infinity, totalTokens: -1, reasoningTokens: Number.MAX_SAFE_INTEGER + 1 }
} }, request, { code: 'response_truncated', status: null, transport: 'native' });
assert.deepEqual(invalidSummary.completion, {});
assert.equal(invalidSummary.status, null);
assert.ok(!JSON.stringify(invalidSummary).includes('secret'));
console.log('GLM-5.3 reasoning and bounded completion telemetry checks passed');

// Verify the app adapter forwards cancellation to the native owner and releases its listener.
const { createAiRequestRuntime } = await import('../src/app/ai-request-runtime.js');
const previousWindow = globalThis.window;
let nativeStarted;
const started = new Promise(resolve => { nativeStarted = resolve; });
let rejectNative, nativeId;
const cancelledIds = [];
globalThis.window = { __TAURI_INTERNALS__: { invoke: (command, args) => {
  if (command === 'request_private_ai_completion') {
    nativeId = args.request.requestId;
    nativeStarted();
    return new Promise((_resolve, reject) => { rejectNative = reject; });
  }
  if (command === 'cancel_private_ai_completion') {
    cancelledIds.push(args.requestId); rejectNative('ai-provider:aborted'); return Promise.resolve();
  }
  throw new Error('Unexpected command');
} } };
try {
  const runtime = createAiRequestRuntime({ getApiKey: async () => request.apiKey, getConfig: () => request, isTauri: true });
  await assert.rejects(createAiRequestRuntime({getApiKey:async()=>'',getConfig:()=>request})(visionMessages),error=>error.code==='invalid_config');
  await assert.rejects(runtime(visionMessages, new AbortController().signal, 4096, { expectedProvider: { ...request, url: 'https://changed.test/api' } }), error => error.code === 'provider_changed');
  const controller = new AbortController();
  const pending = runtime(visionMessages, controller.signal, 4096);
  await started;
  controller.abort();
  await assert.rejects(pending, error => error.code === 'aborted');
  assert.deepEqual(cancelledIds, [nativeId]);
  assert.match(nativeId, /^[a-z0-9-]{36}$/);
} finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
console.log('Multimodal validation and native cancellation bridge passed');

for (const [failure, key] of [
  ['ai-provider:http_error:401','unauthorized'], ['ai-provider:http_error:403','forbidden'],
  ['ai-provider:http_error:404','notFound'], ['ai-provider:http_error:429','rateLimited'],
  ['ai-provider:http_error:507','providerUnavailable'], ['ai-provider:timeout','timeout'],
  ['ai-provider:network_error','network'], ['ai-provider:invalid_response','invalidResponse']
]) {
  globalThis.window={__TAURI_INTERNALS__:{invoke:async()=>{throw failure;}}};
  try {
    const runtime=createAiRequestRuntime({getApiKey:async()=>request.apiKey,getConfig:()=>request,isTauri:true});
    await assert.rejects(runtime(visionMessages),error=>error.message.startsWith(`home.aiRequestErrors.${key}`));
  } finally { if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow; }
}
console.log('Shared AI failure messages passed');
