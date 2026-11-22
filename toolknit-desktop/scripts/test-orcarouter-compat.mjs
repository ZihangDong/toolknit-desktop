// Local protocol fixtures only. No real provider requests or configured user keys.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { normalizeAiProviderConfig, requestAiCompletion } from '../src/ai-provider-core.js';
import { createAiRequestRuntime } from '../src/app/ai-request-runtime.js';
import { executeTool } from '../cli/lib/tool-registry.mjs';

const official = 'https://api.orcarouter.ai/v1/chat/completions';
const model = 'openai/gpt-4o-mini', key = 'local-orca-protocol-fixture-credential';
const source = 'Synthetic meeting at 15:00.', output = 'Synthetic meeting starts at 15:00.';
const messages = [{ role: 'user', content: source }];
const checks = [], failures = [], children = new Set();
let mode = 'success', calls = 0, arrival;
const mark = name => checks.push(name);
async function boundedArrival(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Provider fixture was not reached in time.')), 10000);
  })]); } finally { clearTimeout(timer); }
}
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.headers.authorization, `Bearer ${key}`);
    assert.equal(request.headers['content-type'], 'application/json');
    const parts = [];
    for await (const chunk of request) parts.push(chunk);
    const body = JSON.parse(Buffer.concat(parts));
    assert.equal(body.model, model);
    assert.equal(body.stream, false);
    assert.ok(body.max_tokens > 0 && body.max_tokens <= 16384);
    assert.equal(body.reasoning_effort, undefined, 'Do not inject official-provider reasoning flags into a gateway.');
    calls++; arrival?.(); arrival = undefined;
    if (mode === 'slow') return; // Kept open until the client cancels or times out.
    const status = mode === 'auth' ? 401 : mode === 'quota' ? 402 : mode === 'rate' ? 429 : 200;
    response.writeHead(status, { 'content-type': 'application/json', ...(status === 429 ? { 'retry-after': '1' } : {}) });
    // Empty-body 429 is documented. Other errors deliberately contain sensitive fixture data.
    response.end(status === 429 ? '' : status !== 200 ? JSON.stringify({ error: { message: `${key} ${source}`, type: 'orcarouter_api_error' } })
      : mode === 'malformed' ? '{broken' : JSON.stringify({ id: 'fixture', object: 'chat.completion', model,
        choices: [{ message: { role: 'assistant', content: output }, finish_reason: mode === 'truncated' ? 'length' : 'stop' }] }));
  } catch (error) { failures.push(error); response.writeHead(500); response.end(); }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/v1`;
// Child processes receive only synthetic credentials, overriding any user configuration.
const env = { ...process.env, TOOLKNIT_AI_API_KEY: key, DEEPSEEK_API_KEY: '', TOOLKNIT_AI_API_URL: url, TOOLKNIT_AI_MODEL: model };
const cli = new URL('../cli/toolknit.mjs', import.meta.url);
const { fileURLToPath } = await import('node:url');
const args = { text: source, style: 'formal' };
const safe = value => { const text = JSON.stringify(value); assert.ok(!text.includes(key)); assert.ok(!text.includes(source)); };
function child(argv) {
  const processChild = spawn(process.execPath, [fileURLToPath(cli), ...argv], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(processChild); processChild.once('close', () => children.delete(processChild));
  return processChild;
}
async function runCli() {
  const processChild = child(['run', 'toolknit_ai_polish', '--arguments-stdin', '--json']);
  let stdout = '', stderr = '';
  processChild.stdout.on('data', data => { stdout += data; });
  processChild.stderr.on('data', data => { stderr += data; });
  const timer = setTimeout(() => processChild.kill(), 15000);
  try {
    const completion = once(processChild, 'close');
    processChild.stdin.end(JSON.stringify(args));
    const [code] = await completion;
    assert.equal(code === 0 ? stderr : stdout, '');
    return { code, payload: JSON.parse(code === 0 ? stdout : stderr) };
  } finally { clearTimeout(timer); }
}
const previousWindow = globalThis.window;
try {
  for (const base of ['https://api.orcarouter.ai', 'https://api.orcarouter.ai/v1', 'https://api.orcarouter.ai/v1/', official]) {
    assert.deepEqual(normalizeAiProviderConfig({ url: base, model }), { url: official, model });
    mark(`normalize ${new URL(base).pathname}`);
  }
  assert.equal(await requestAiCompletion({ url, model, apiKey: key, messages, maxTokens: 1024, timeoutMs: 1000 }), output);
  mark('HTTP nonstreaming completion and Bearer/model/token envelope');
  // Actual app adapter, with an explicit fake Tauri boundary. Rust is tested separately.
  const pending = new Map(); let bridgeCalls = 0, cancelled = 0;
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, value) => {
    if (command === 'cancel_private_ai_completion') { pending.get(value.requestId)?.abort(); cancelled++; return; }
    assert.equal(command, 'request_private_ai_completion');
    assert.equal(value.request.url, official); assert.equal(value.request.model, model); bridgeCalls++;
    const controller = new AbortController(); pending.set(value.request.requestId, controller);
    try { return { content: await requestAiCompletion({ ...value.request, url, signal: controller.signal }) }; }
    catch (error) { throw `ai-provider:${error.code}${error.status ? ':' + error.status : ''}`; }
    finally { pending.delete(value.request.requestId); }
  } } };
  const desktop = createAiRequestRuntime({ getApiKey: async () => key, getConfig: () => ({ url: official, model }), isTauri: true });
  assert.equal(await desktop(messages, undefined, 1024, { timeoutMs: 1000 }), output);
  mark('desktop app adapter forwards custom HTTPS configuration through native boundary fixture');
  for (const [selected, status] of [['auth', 401], ['quota', 402], ['rate', 429]]) {
    mode = selected;
    await assert.rejects(desktop(messages, undefined, 1024), error => { safe(error); return error.code === 'http_error' && error.status === status; });
    mark(`desktop native bridge fixture HTTP ${status}`);
  }
  mode = 'slow';
  await assert.rejects(desktop(messages, undefined, 1024, { timeoutMs: 50 }), error => error.code === 'timeout');
  mark('desktop native bridge fixture timeout');
  const controller = new AbortController();
  const started = new Promise(resolve => { arrival = resolve; });
  const work = desktop(messages, controller.signal, 1024, { timeoutMs: 1000 });
  const rejected = assert.rejects(work, error => error.code === 'aborted');
  await boundedArrival(started); controller.abort(); await rejected;
  assert.equal(cancelled, 1); assert.ok(bridgeCalls > 0);
  mark('desktop request-id cancellation reaches native boundary fixture');
  for (const [selected, reason] of [['truncated', 'response_truncated'], ['malformed', 'invalid_response']]) {
    mode = selected;
    await assert.rejects(executeTool('toolknit_ai_polish', args, { env }), error => error.code === 'PROVIDER_ERROR' && error.details.reason === reason);
    mark(`CLI runtime rejects ${selected} output`);
  }
  mode = 'slow';
  await assert.rejects(executeTool('toolknit_ai_polish', args, { env, timeoutMs: 50 }), error => error.code === 'PROVIDER_TIMEOUT');
  mark('CLI runtime maps shared HTTP deadline');
  for (const [selected, status] of [['success', 200], ['auth', 401], ['quota', 402], ['rate', 429]]) {
    mode = selected;
    const result = await runCli();
    if (status === 200) { assert.equal(result.code, 0); assert.equal(result.payload.result.text, output); }
    else { assert.notEqual(result.code, 0); safe(result); assert.equal(result.payload.error.code, 'PROVIDER_ERROR'); assert.equal(result.payload.error.details.status, status); }
    mark(`CLI subprocess ${status}`);
  }
  const mcp = child(['mcp', 'serve']), waiting = new Map();
  let stderr = '';
  mcp.stderr.on('data', data => { stderr += data; });
  const lines = createInterface({ input: mcp.stdout });
  lines.on('line', line => { const message = JSON.parse(line); if (message.id !== undefined) waiting.get(message.id)?.(message); });
  let nextId = 0;
  const send = message => mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const rpc = (method, params) => {
    const id = ++nextId;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`MCP fixture deadline ${method}`)); }, 10000);
      waiting.set(id, message => { clearTimeout(timer); waiting.delete(id); resolve(message); });
    });
    send({ id, method, params }); return { id, promise };
  };
  await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'local-orca-fixture', version: '1' } }).promise;
  send({ method: 'notifications/initialized' });
  for (const [selected, status] of [['success', 200], ['auth', 401], ['quota', 402], ['rate', 429]]) {
    mode = selected;
    const { result } = await rpc('tools/call', { name: 'toolknit_ai_polish', arguments: args }).promise;
    if (status === 200) { assert.equal(result.isError, false); assert.equal(result.structuredContent.result.text, output); }
    else { assert.equal(result.isError, true); safe(result); assert.equal(result.structuredContent.error.details.status, status); }
    mark(`MCP subprocess ${status}`);
  }
  mode = 'slow';
  const mcpStarted = new Promise(resolve => { arrival = resolve; });
  const cancelledCall = rpc('tools/call', { name: 'toolknit_ai_polish', arguments: args });
  await boundedArrival(mcpStarted);
  send({ method: 'notifications/cancelled', params: { requestId: cancelledCall.id, reason: 'Local fixture cancellation' } });
  const cancelledResult = await cancelledCall.promise;
  assert.equal(cancelledResult.result.structuredContent.error.code, 'CANCELLED'); safe(cancelledResult);
  mark('MCP cancellation notification aborts in-flight HTTP call');
  mode = 'success';
  assert.equal((await rpc('tools/call', { name: 'toolknit_ai_polish', arguments: args }).promise).result.isError, false);
  assert.equal(stderr, '');
  mark('MCP remains usable after cancellation');
  mcp.stdin.end(); lines.close();
  assert.deepEqual(failures, []);
  const report = { scope: 'local-protocol-fixtures-only', realAuthenticatedProvider: 'unverified', checks, requests: calls };
  const directory = new URL('../tmp/orcarouter/', import.meta.url);
  await mkdir(directory, { recursive: true }); await writeFile(new URL('compat-report.json', directory), JSON.stringify(report, null, 2) + '\n');
  console.log(`OrcaRouter local compatibility: ${checks.length} checks passed (${calls} fixture HTTP requests).`);
} finally {
  if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  for (const processChild of children) processChild.kill();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
