import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { startMcpServer } from '../cli/lib/mcp-server.mjs';
import { ToolKnitError } from '../cli/lib/errors.mjs';

const input = new PassThrough(), output = new PassThrough(), messages = [], calls = [];
let buffer = '';
output.setEncoding('utf8');
output.on('data', chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) { messages.push(JSON.parse(buffer.slice(0, end))); buffer = buffer.slice(end + 1); }
});
const server = startMcpServer({ input, output, list: () => [], execute: async (name, args, options) => {
  calls.push({ name, args, options });
  if (name === 'large') return { text: 'x'.repeat(9 * 1024 * 1024) };
  if (name === 'instant') { options.reportProgress(20, 'one'); options.reportProgress(10, 'two'); return { value: 1 }; }
  return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new ToolKnitError('CANCELLED', 'Cancelled.')), { once: true }));
} });
const send = value => input.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const tick = () => new Promise(resolve => setImmediate(resolve));
send({ id: 1, method: 'tools/list', params: {} }); await tick();
assert.equal(messages.at(-1).error.code, -32002);
send({ method: 'initialize', params: { protocolVersion: '2025-11-25' } });
send({ id: 2, method: 'tools/list' }); await tick();
assert.equal(messages.at(-1).error.code, -32002, 'notification cannot initialize a session');
send({ id: 3, method: 'initialize', params: { protocolVersion: '2025-11-25' } }); await tick();
assert.equal(messages.at(-1).result.protocolVersion, '2025-11-25');
send({ id: 4, method: 'tools/list', params: [] }); await tick(); assert.equal(messages.at(-1).error.code, -32602);
send({ id: 5, method: 'tools/list', params: { cursor: 'unknown' } }); await tick(); assert.equal(messages.at(-1).error.code, -32602);
send({ id: 6, method: 'tools/call', params: { name: 'instant', _meta: { progressToken: {} } } }); await tick(); assert.equal(messages.at(-1).error.code, -32602);
send({ id: 7, method: 'tools/call', params: { name: 'instant', _meta: { progressToken: 'progress' } } }); await tick();
assert.deepEqual(messages.filter(item => item.method === 'notifications/progress' && item.params.progressToken === 'progress').map(item => item.params.progress), [0, 20, 20, 100]);
send({ id: 8, method: 'tools/call', params: { name: 'large' } }); await tick();
assert.equal(messages.find(item => item.id === 8).result.isError, true, 'large response becomes bounded structured failure');
const beforeOversize = calls.length;
input.write('x'.repeat(8 * 1024 * 1024 + 1));
input.write(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'instant' } }) + '\n');
send({ id: 10, method: 'ping' }); await tick();
assert.equal(calls.length, beforeOversize, 'tail of oversized unterminated line cannot execute as a fresh request');
assert.ok(messages.some(item => item.id === 10 && item.result));
for (let id = 20; id < 24; id++) send({ id, method: 'tools/call', params: { name: 'wait' } });
send({ id: 20, method: 'tools/call', params: { name: 'wait' } });
send({ id: 24, method: 'tools/call', params: { name: 'wait' } }); await tick();
assert.ok(messages.some(item => item.id === 20 && item.error?.code === -32600));
assert.equal(messages.find(item => item.id === 24).error.code, -32000);
send({ method: 'notifications/cancelled', params: { requestId: 20, reason: 'a secret that must not be echoed' } }); await tick();
assert.equal(calls.find(item => item.name === 'wait').options.signal.aborted, true);
assert.equal(messages.find(item => item.id === 20 && item.result).result.structuredContent.error.code, 'CANCELLED');
assert.ok(!JSON.stringify(messages).includes('a secret that must not be echoed'));
input.end(); await tick();
assert.ok(calls.filter(item => item.name === 'wait').every(item => item.options.signal.aborted), 'EOF stops all active jobs');
server.close(); output.end();
for (const failure of ['throw', 'backpressure']) {
  const disconnectedInput = new PassThrough(), disconnectedOutput = new PassThrough();
  let writes = 0;
  disconnectedOutput.resume();
  const disconnected = startMcpServer({ input: disconnectedInput, output: disconnectedOutput, execute: async () => ({ text: 'x'.repeat(9 * 1024 * 1024) }) });
  disconnectedInput.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }) + '\n');
  await tick();
  disconnectedOutput.write = () => { writes++; throw new Error('Disconnected output.'); };
  if (failure === 'backpressure') Object.defineProperty(disconnectedOutput, 'writableLength', { value: 17 * 1024 * 1024 });
  disconnectedInput.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'large' } }) + '\n');
  await tick();
  assert.equal(writes, failure === 'throw' ? 1 : 0, 'Oversized response must use the same bounded and exception-safe output path.');
  disconnected.close(); disconnectedInput.destroy(); disconnectedOutput.destroy();
}
console.log('MCP V3.2 protocol passed: initialization, framing, oversized tail, bounded output, progress, duplicate/concurrent IDs, cancellation and EOF cleanup.');
