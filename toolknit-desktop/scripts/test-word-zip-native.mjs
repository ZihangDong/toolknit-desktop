import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp, mkdir, rm, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const run = promisify(execFile), root = path.resolve('tmp/word-zip');
const source = path.join(root, 'valid.zip'), original = createHash('sha256').update(await readFile(source)).digest('hex');
const checks = [], outputs = [];
async function verify(file) {
  const bytes = await readFile(file), loading = getDocument({ data: new Uint8Array(bytes), verbosity: 0, useSystemFonts: true });
  try {
    const pdf = await loading.promise;
    assert.equal(pdf.numPages, 1);
    const page = await pdf.getPage(1), text = (await page.getTextContent()).items.map(item => item.str).join('');
    assert.ok(text.includes('ZIP_WORD_BODY') && text.includes('中文合同'));
    outputs.push({ name: path.basename(file), bytes: bytes.length, pageCount: 1, searchableChinese: true });
  } finally { await loading.destroy(); }
}
function verifyBatch(result) {
  assert.equal(result.status, 'partial'); assert.equal(result.files.length, 3); assert.equal(result.outputs.length, 2);
  assert.deepEqual(result.files.map(file => file.archive_entry), ['合同/同名.docx', '副本/同名.docx', '损坏.docx']);
  assert.equal(result.files[2].status, 'failed');
  assert.ok(!JSON.stringify(result).includes('tk-word-zip-'), 'Temporary input paths must not enter results.');
  assert.notEqual(result.outputs[0].output_path, result.outputs[1].output_path);
}
const cli = path.resolve('cli/toolknit.mjs');
// Exercise the real generic CLI using a JSON argument file (no passwords).
const args = { input_paths: [source, source], output_dir: path.join(root, 'cli-output') };
await writeFile(path.join(root, 'request.json'), JSON.stringify(args));
const cliResult = await run(process.execPath, [cli, 'run', 'toolknit_word_to_pdf', '--arguments-file', path.join(root, 'request.json'), '--json'], { windowsHide: true, timeout: 180000 });
assert.equal(cliResult.stderr, ''); const batch = JSON.parse(cliResult.stdout).result;
verifyBatch(batch); for (const output of batch.outputs) await verify(output.output_path);
checks.push('CLI ZIP expansion, repeated-source de-duplication, same-name outputs, partial failure and searchable PDFs');
const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp', 'serve'], cwd: path.resolve('.'), stderr: 'pipe' });
const client = new Client({ name: 'word-zip-local-qa', version: '1' });
try {
  await client.connect(transport);
  const response = await client.callTool({ name: 'toolknit_word_to_pdf', arguments: { input_paths: [source], output_dir: path.join(root, 'mcp-output') } }, undefined, { timeout: 180000 });
  assert.equal(response.isError, false); verifyBatch(response.structuredContent.result);
  for (const output of response.structuredContent.result.outputs) await verify(output.output_path);
  checks.push('MCP real ZIP conversion and per-entry origins');
} finally { await client.close(); }
const nativeOutput = await mkdtemp(path.join(os.tmpdir(), 'toolknit-word-zip-qa-'));
try {
  const result = await run('cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml', 'word_zip', '--lib', '--', '--include-ignored', '--test-threads=1'], {
    env: { ...process.env, TOOLKNIT_WORD_ZIP_FIXTURES: root, TOOLKNIT_WORD_ZIP_OUTPUT: nativeOutput }, windowsHide: true, timeout: 300000, maxBuffer: 4 * 1024 * 1024
  });
  await writeFile(path.join(root, 'native-tests.log'), result.stdout + result.stderr);
  const report = JSON.parse(await readFile(path.join(nativeOutput, 'report.json'), 'utf8'));
  const evidence = path.join(root, 'native-output'); await mkdir(evidence, { recursive: true });
  for (const [index, output] of [...report.result.files.filter(file => file.status === 'success'), report.cancelled.files[0]].entries()) {
    await verify(output.outputPath); await copyFile(output.outputPath, path.join(evidence, `${index + 1}.pdf`));
  }
  assert.equal(report.cancelled.files[1].status, 'cancelled');
  assert.equal(report.manifest.skipped, 2); checks.push('Rust shared malformed ZIP fixtures, real native conversion, changed hash, CRC and cancellation with retained output');
  await writeFile(path.join(root, 'native-report.json'), JSON.stringify(report, null, 2));
} finally { await rm(nativeOutput, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'), original); checks.push('source archive SHA-256 unchanged');
await writeFile(path.join(root, 'real-report.json'), JSON.stringify({ checks, outputs, sourceUnchanged: true }, null, 2));
console.log(`Word ZIP native acceptance: ${checks.length} groups, ${outputs.length} independently reopened searchable PDFs.`);
