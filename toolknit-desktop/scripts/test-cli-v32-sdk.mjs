import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { TOOL_DEFINITIONS } from '../cli/lib/tool-definitions.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'toolknit-sdk-'));
const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('cli/toolknit.mjs'), 'mcp', 'serve'], cwd: root, stderr: 'pipe' });
let stderr = ''; transport.stderr.on('data', data => { stderr += data; });
const client = new Client({ name: 'toolknit-v32-sdk-verification', version: '1.0.0' });
try {
  await client.connect(transport);
  const wire = [];
  const deliver = transport.onmessage;
  transport.onmessage = (message, extra) => { wire.push(message); deliver(message, extra); };
  assert.equal(client.getServerVersion().version, '3.2.0');
  const listed = await client.listTools(); assert.equal(listed.tools.length, TOOL_DEFINITIONS.length);
  const result = await client.callTool({ name: 'toolknit_text_format', arguments: { text: 'b\na\na', action: 'removeDuplicateLines' } });
  assert.equal(result.isError, false); assert.equal(result.structuredContent.result.text, 'b\na');
  const invalid = await client.callTool({ name: 'toolknit_uuid', arguments: { count: '3' } });
  assert.equal(invalid.isError, true); assert.equal(invalid.structuredContent.error.code, 'INVALID_ARGUMENT');
  const target = path.join(root, 'blank.pdf');
  const progress = [];
  const created = await client.callTool({ name: 'toolknit_pdf_create', arguments: { output_path: target, page_count: 2 } }, undefined,
    { onprogress: value => progress.push(value.progress), timeout: 30000 });
  assert.equal(created.isError, false); assert.equal((await PDFDocument.load(await readFile(target))).getPageCount(), 2);
  // SDK 1.32.1 dispatches notifications in a microtask but removes progress
  // handlers synchronously on response. A single stdio chunk can therefore
  // suppress its final callback; verify actual wire order without server sleeps.
  const notifications = wire.filter(message => message.method === 'notifications/progress');
  const token = notifications[0].params.progressToken;
  const updates = notifications.filter(message => message.params.progressToken === token);
  assert.equal(updates[0].params.progress, 0); assert.equal(updates.at(-1).params.progress, 100);
  assert.ok(updates.every((message, index) => index === 0 || message.params.progress >= updates[index - 1].params.progress));
  assert.ok(wire.indexOf(updates.at(-1)) < wire.findIndex(message => message.id === token));
  assert.ok(progress.every(value => value >= 0 && value <= 100));
  const source = await PDFDocument.create(), font = await source.embedFont(StandardFonts.Helvetica);
  source.addPage([595, 842]).drawText('Cancellation fixture', { font, x: 40, y: 750, size: 16 });
  const input = path.join(root, 'source.pdf'); await writeFile(input, await source.save());
  const controller = new AbortController();
  const cancelled = client.callTool({ name: 'toolknit_pdf_to_scan', arguments: { input_path: input, output_path: path.join(root, 'cancelled.pdf') } }, undefined,
    { signal: controller.signal, onprogress: () => controller.abort(), timeout: 30000 });
  await assert.rejects(cancelled);
  await client.ping();
  const later = await client.callTool({ name: 'toolknit_uuid', arguments: { count: 1 } }); assert.equal(later.isError, false);
  assert.ok(!(await readdir(root)).includes('cancelled.pdf'));
  await client.close();
  assert.equal(stderr, '', 'Protocol client receives no warning/debug contamination');
  console.log(`Official MCP SDK 1.32.1 interop passed: ${listed.tools.length} tools, real PDF, errors, progress, cancellation and subsequent requests.`);
} finally { await client.close().catch(() => {}); await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }); }
