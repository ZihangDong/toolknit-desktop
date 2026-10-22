import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { buildPptDraftPptx } from '../src/ppt-draft-core.js';
import { checkLibreOfficeAvailability, convertPptToPdf } from '../cli/lib/ppt-to-pdf-runtime.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(projectRoot, 'cli', 'toolknit.mjs');

function outlinePayload(slides = 3) {
  return {
    ready: true,
    title: 'ToolKnit PPT 转 PDF 测试',
    subtitle: 'LibreOffice 渲染链路',
    audience: '测试用户',
    purpose: '验证 PPTX 转 PDF',
    narrative: { central_takeaway: 'PPTX can be rendered to PDF.' },
    design: {},
    slides: Array.from({ length: slides }, (_, index) => ({
      page: index + 1,
      type: index === 0 ? 'title' : 'content',
      title: `测试第 ${index + 1} 页`,
      claim: `这是第 ${index + 1} 页`,
      body: [`PPT 转 PDF 要稳定`, `源文件不能被修改`],
      visual_suggestion: '简洁文字页',
      speaker_note: '测试备注',
      transition: '继续'
    }))
  };
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: projectRoot,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', code => resolve({
      code,
      stdout: Buffer.concat(stdout).toString('utf8').trim(),
      stderr: Buffer.concat(stderr).toString('utf8').trim()
    }));
  });
}

const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'toolknit-ppt-to-pdf-'));
const inputPath = path.join(fixtureDirectory, 'demo.pptx');
const outputDirectory = path.join(fixtureDirectory, 'out');
const draft = await buildPptDraftPptx(outlinePayload(3), { theme: 'minimal-light' });
await writeFile(inputPath, draft.bytes);

const dryRun = await convertPptToPdf({
  input_path: inputPath,
  output_dir: outputDirectory,
  dry_run: true,
  output_name: 'deck-pdf'
});
assert.equal(dryRun.tool, 'ppt.to-pdf');
assert.equal(dryRun.dry_run, true);
assert.equal(dryRun.slide_count, 3);
assert.equal(dryRun.output_file, 'deck-pdf.pdf');
await assert.rejects(() => readdir(outputDirectory), /ENOENT|no such file/i);

const cliHelp = await runCli(['ppt', 'to-pdf', '--help']);
assert.equal(cliHelp.code, 0, cliHelp.stderr);
assert.match(cliHelp.stdout, /PPT 转 PDF/);
assert.match(cliHelp.stdout, /LibreOffice/);

const cliDryRun = await runCli([
  'ppt', 'to-pdf',
  '--input', inputPath,
  '--output-dir', outputDirectory,
  '--dry-run',
  '--json'
]);
assert.equal(cliDryRun.code, 0, cliDryRun.stderr);
assert.equal(JSON.parse(cliDryRun.stdout).result.tool, 'ppt.to-pdf');

const renderer = await checkLibreOfficeAvailability();
if (!renderer.available) {
  console.log('PPT to PDF runtime actual conversion skipped: LibreOffice unavailable.');
} else {
  const exported = await convertPptToPdf({
    input_path: inputPath,
    output_dir: outputDirectory,
    output_name: 'deck-pdf'
  });
  assert.equal(exported.dry_run, false);
  assert.equal(exported.output_file, 'deck-pdf.pdf');
  assert.equal(exported.page_count, 3);
  assert.ok(await stat(exported.output_path).then(file => file.size > 1000));
  assert.ok(await stat(path.join(exported.output_dir, 'manifest.json')).then(file => file.size > 100));
  const pdf = await PDFDocument.load(await readFile(exported.output_path));
  assert.equal(pdf.getPageCount(), 3);

  // The output remains accessible while the old nested Office profile exceeds
  // Windows' practical path budget. Use a non-ASCII directory as well.
  const cliOut = path.join(fixtureDirectory, 'deep-office-output-'.repeat(3), '中文输出');
  const cli = await runCli([
    'ppt', 'to-pdf',
    '--input', inputPath,
    '--output-dir', cliOut,
    '--output-name', 'cli-deck',
    '--json'
  ]);
  assert.equal(cli.code, 0, cli.stderr);
  const cliJson = JSON.parse(cli.stdout);
  assert.equal(cliJson.result.tool, 'ppt.to-pdf');
  assert.equal(cliJson.result.output_file, 'cli-deck.pdf');
  assert.equal(await stat(cliJson.result.output_path).then(file => file.size > 1000), true);
}

console.log('PPT to PDF runtime regression checks passed');
