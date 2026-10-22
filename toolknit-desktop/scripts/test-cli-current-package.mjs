import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import { createCanvas } from '@napi-rs/canvas';
import { listSourceFiles } from './lib/source-inventory.mjs';
import { TOOL_DEFINITIONS } from '../cli/lib/tool-definitions.mjs';

// Test current source, including local fixes, without an older HEAD snapshot or
// any dependency resolution through the repository's node_modules directory.
const projectRoot = path.resolve(import.meta.dirname, '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this verification through npm.');
function run(command, args, cwd, inherit = false) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe', maxBuffer: 20 * 1024 * 1024, windowsHide: true, timeout: 240000 });
}
function runNode(entry, args, cwd, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Installed CLI timed out.')); }, 60000);
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end(input);
  });
}
function runMcp(entry, cwd, requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, 'mcp', 'serve'], { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const responses = new Map(); let buffer = '', stderr = '', failure, finished = false, position = 0;
    const timeout = setTimeout(() => { failure = new Error('Installed MCP timed out.'); child.kill(); }, 60000);
    const next = () => {
      if (position >= requests.length) { finished = true; child.stdin.end(); return; }
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...requests[position++] }) + '\n');
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk; let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {
          const message = JSON.parse(line);
          if (message.id !== undefined) { responses.set(message.id, message); next(); }
        } catch { failure = new Error('Installed MCP emitted invalid protocol output.'); child.kill(); }
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { failure = error; });
    child.once('close', code => {
      clearTimeout(timeout);
      if (failure) reject(failure);
      else if (!finished || code !== 0 || stderr.trim()) reject(new Error(`Installed MCP exited unexpectedly: ${code}; ${stderr.slice(0, 500)}`));
      else resolve(responses);
    });
    next();
  });
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'toolknit-current-cli-'));
const snapshot = path.join(tempRoot, 'source', 'toolknit-desktop'), consumer = path.join(tempRoot, 'consumer');
try {
  const gitRoot = run('git', ['rev-parse', '--show-toplevel'], projectRoot).trim();
  const prefix = path.relative(gitRoot, projectRoot).replaceAll('\\', '/') + '/';
  const files = listSourceFiles(gitRoot).filter(file => file.startsWith(prefix));
  for (const file of files) {
    const target = path.join(tempRoot, 'source', file); await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(gitRoot, file), target);
  }
  run(process.execPath, [path.join(snapshot, 'scripts/prepare-cli-package.cjs')], snapshot, true);
  const pack = JSON.parse(run(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json'], path.join(snapshot, 'cli')))[0];
  const tarball = path.join(snapshot, 'cli', pack.filename);
  assert.equal(pack.version, JSON.parse(await readFile(path.join(snapshot, 'cli/package.json'), 'utf8')).version);
  assert.ok(pack.files.some(file => file.path === 'lib/pdf-word-engine.mjs'));
  assert.ok(!pack.files.some(file => /(?:SKILL\.md|V32_CLI_MCP_AUDIT|\.env$)/i.test(file.path)));
  assert.ok(!pack.files.filter(file => !file.path.startsWith('node_modules/')).some(file => /(?:scripts\/test-|\.map$)/i.test(file.path)), 'Private source maps and test scripts must not ship; upstream bundled package maps are public assets.');
  await mkdir(consumer);
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ private: true, name: 'toolknit-current-consumer' }));
  run(process.execPath, [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', tarball], consumer, true);
  const dependencyTree = JSON.parse(run(process.execPath, [npmCli, 'ls', '--all', '--json'], consumer));
  assert.ok(!dependencyTree.problems?.length, 'Installed dependency tree must be complete.');
  const audit = JSON.parse(run(process.execPath, [npmCli, 'audit', '--omit=dev', '--json', '--registry=https://registry.npmjs.org'], consumer));
  assert.equal(audit.metadata.vulnerabilities.total, 0, 'Audit the actual consumer install, not only the source lockfile.');
  const imported = run(process.execPath, ['--input-type=module', '--eval', `
    import { readdir } from 'node:fs/promises';
    import path from 'node:path';
    import { pathToFileURL } from 'node:url';
    const root = path.resolve('node_modules/@toolknit/cli/lib/core');
    let count = 0;
    async function visit(directory) {
      for (const item of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, item.name);
        if (item.isDirectory()) await visit(file);
        else if (item.name.endsWith('.js')) { await import(pathToFileURL(file).href); count++; }
      }
    }
    await visit(root);
    console.log(JSON.stringify({ imported_core_modules: count }));
  `], consumer);
  assert.ok(JSON.parse(imported).imported_core_modules > 80);
  console.log(`Independent dependency audit passed; ${JSON.parse(imported).imported_core_modules} pure modules loaded with Node ${process.version}.`);
  const entry = path.join(consumer, 'node_modules/@toolknit/cli/toolknit.mjs');
  for (const args of [['--version'], ['help', 'pdf', 'merge'], ['tools', 'coverage', '--json']]) {
    const result = await runNode(entry, args, consumer); assert.equal(result.code, 0, result.stderr); assert.equal(result.stderr.trim(), '');
    if (args[0] === '--version') assert.equal(result.stdout.trim(), pack.version);
    if (args[0] === 'tools') assert.equal(JSON.parse(result.stdout).desktop_tools, 73);
  }
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([595, 842]).drawText('Installed CLI fixture', { font, x: 50, y: 700, size: 15 });
  await writeFile(path.join(consumer, 'source.pdf'), await pdf.save());
  const canvas = createCanvas(40, 30); canvas.getContext('2d').fillRect(0, 0, 40, 30);
  await writeFile(path.join(consumer, 'image.png'), canvas.toBuffer('image/png')); canvas.width = canvas.height = 0;
  const converted = await runNode(entry, ['pdf', 'to-word', '--input', 'source.pdf', '--output', 'converted.docx', '--json'], consumer);
  assert.equal(converted.code, 0, converted.stderr); assert.equal(converted.stderr.trim(), '');
  assert.ok((await JSZip.loadAsync(await readFile(path.join(consumer, 'converted.docx')))).file('word/document.xml'));
  const requests = [
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'toolknit-package-test', version: '1' } } },
    { id: 2, method: 'tools/list', params: {} },
    { id: 3, method: 'tools/call', params: { name: 'toolknit_uuid', arguments: { count: 3 } } },
    { id: 4, method: 'tools/call', params: { name: 'toolknit_image_to_pdf', arguments: { input_paths: [path.join(consumer, 'image.png')], output_path: path.join(consumer, 'images.pdf') } } }
  ];
  const mcp = await runMcp(entry, consumer, requests);
  assert.equal(mcp.get(1).result.serverInfo.version, pack.version);
  assert.equal(mcp.get(2).result.tools.length, TOOL_DEFINITIONS.length);
  assert.equal(mcp.get(3).result.isError, false); assert.equal(mcp.get(3).result.structuredContent.result.identifiers.length, 3);
  assert.equal(mcp.get(4).result.isError, false, mcp.get(4).result.content[0]?.text);
  assert.equal((await PDFDocument.load(await readFile(path.join(consumer, 'images.pdf')))).getPageCount(), 1);
  const previousEntry = process.env.TOOLKNIT_CLI_ENTRY;
  try {
    process.env.TOOLKNIT_CLI_ENTRY = entry;
    run(process.execPath, [path.join(projectRoot, 'scripts/test-cli-mcp.mjs')], projectRoot, true);
    run(process.execPath, [path.join(projectRoot, 'scripts/test-cli-transcription-native.mjs')], consumer, true);
  } finally {
    if (previousEntry === undefined) delete process.env.TOOLKNIT_CLI_ENTRY;
    else process.env.TOOLKNIT_CLI_ENTRY = previousEntry;
  }
  console.log(`Current-source npm package passed: ${pack.filename}; ${pack.size} bytes; ${TOOL_DEFINITIONS.length} MCP tools; installed CLI DOCX and MCP image PDF verified.`);
} finally {
  assert.equal(path.dirname(tempRoot), path.resolve(os.tmpdir()));
  assert.ok(path.basename(tempRoot).startsWith('toolknit-current-cli-'));
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
