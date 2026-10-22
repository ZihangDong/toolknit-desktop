// Explicit opt-in: paid network tests using synthetic inputs only.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';

if (!process.argv.includes('--live') || !process.env.TOOLKNIT_AI_API_KEY || !process.env.TOOLKNIT_AI_API_URL || !process.env.TOOLKNIT_AI_MODEL) {
  console.log('Skipped: supply --live and TOOLKNIT_AI_API_KEY/API_URL/MODEL in the process environment. Sends synthetic fixtures to the configured provider.');
  process.exit(0);
}
const app = fileURLToPath(new URL('../', import.meta.url));
const entry = process.env.TOOLKNIT_CLI_ENTRY || path.join(app, 'cli/toolknit.mjs');
const root = path.join(app, 'tmp', `cli-ai-live-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(root, { recursive: true });
const file = name => path.join(root, name);
const secret = process.env.TOOLKNIT_AI_API_KEY;
const results = [], started = new Date().toISOString();
const selected = process.argv.find(value => value.startsWith('--only='))?.slice(7).split(',');
const enabled = name => !selected || selected.some(prefix => name.startsWith(prefix));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const serialize = value => {
  const text = JSON.stringify(value, null, 2);
  assert.ok(!text.includes(secret), 'Credential must not enter evidence files.');
  return text;
};
const save = async () => writeFile(file('report.json'), serialize({ started, model: process.env.TOOLKNIT_AI_MODEL,
  provider: new URL(process.env.TOOLKNIT_AI_API_URL).origin, results }));
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
const page = pdf.addPage([595, 842]);
const lines = ['Synthetic Project Brief', 'Project: Northwind', 'Version: 1.2', 'Meeting: Friday at 15:00',
  'Budget: 1200 CNY', 'Owner: Alice', 'Items: notebooks 10, pens 20', 'Next step: review the draft.'];
lines.forEach((text, index) => page.drawText(text, { font, size: index ? 14 : 22, x: 45, y: 770 - index * 48 }));
await writeFile(file('source.pdf'), await pdf.save());
const ppt = new JSZip();
ppt.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' + [1, 2, 3].map(n => `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('') + '</Types>');
ppt.file('ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>' + [1, 2, 3].map(n => `<p:sldId id="${255 + n}" r:id="rId${n}"/>`).join('') + '</p:sldIdLst></p:presentation>');
ppt.file('ppt/_rels/presentation.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + [1, 2, 3].map(n => `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/>`).join('') + '</Relationships>');
for (let index = 0; index < 3; index++) {
  const title = ['Northwind 项目', '项目事实', '行动安排'][index];
  const body = ['版本 1.2，预算 1200 元。', '负责人 Alice；笔记本 10 本，笔 20 支。', '周五 15:00 评审草稿，不要编造测试结论。'][index];
  const shape = (text, type, id) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${type}"/><p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
  ppt.file(`ppt/slides/slide${index + 1}.xml`, '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>' + shape(title, 'title', 2) + shape(body, 'body', 3) + '</p:spTree></p:cSld></p:sld>');
}
await writeFile(file('source.pptx'), await ppt.generateAsync({ type: 'nodebuffer' }));
const inputHashes = Object.fromEntries(await Promise.all(['source.pdf', 'source.pptx'].map(async name => [name, hash(await readFile(file(name)))])));
const transport = new StdioClientTransport({ command: process.execPath, args: [entry, 'mcp', 'serve'], cwd: root, env: process.env, stderr: 'pipe' });
let stderr = ''; transport.stderr.on('data', data => { stderr += data; });
const client = new Client({ name: 'toolknit-opt-in-live-ai-qa', version: '1.0.0' });
async function call(name, args, requestOptions = {}) {
  const response = await client.callTool({ name: `toolknit_${name}`, arguments: args }, undefined,
    { timeout: 600000, ...requestOptions });
  assert.ok(!JSON.stringify(response).includes(secret), 'Credential must not enter MCP output.');
  if (response.isError) {
    const info = response.structuredContent?.error;
    const error = new Error('MCP tool reported failure');
    error.code = info?.code || 'MCP_ERROR';
    error.safeMessage = String(info?.message || '').replaceAll(secret, '[REDACTED]').slice(0, 500);
    throw error;
  }
  const result = response.structuredContent.result;
  for (const output of result.outputs || []) if (output.path) {
    const info = await stat(output.path); assert.ok(info.isDirectory() || info.size > 0);
  }
  return result;
}
async function test(name, action) {
  if (!enabled(name)) return;
  const start = performance.now();
  console.log(JSON.stringify({ case: name, phase: 'start' }));
  try {
    const value = await action();
    await writeFile(file(`${name}.json`), serialize(value ?? {}));
    results.push({ name, status: 'passed', seconds: +( (performance.now() - start) / 1000).toFixed(2) });
  } catch (error) {
    results.push({ name, status: 'failed', seconds: +((performance.now() - start) / 1000).toFixed(2),
      code: error.code || error.name, message: (error.safeMessage || error.message || '').replaceAll(secret, '[REDACTED]').slice(0, 500) });
  }
  await save(); console.log(JSON.stringify(results.at(-1)));
}
try {
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 77);
  await test('polish-cli', async () => {
    const child = spawn(process.execPath, [entry, 'run', 'toolknit_ai_polish', '--arguments-stdin', '--json'], { cwd: root, env: process.env, windowsHide: true });
    let stdout = '', errors = '';
    child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { errors += bytes; });
    child.stdin.end(JSON.stringify({ text: '周五15:00开会讨论Northwind 1.2，预算1200元，负责人Alice。', style: 'formal' }));
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    assert.ok(!stdout.includes(secret) && !errors.includes(secret));
    assert.equal(code, 0, 'CLI polish exit code');
    const output = JSON.parse(stdout); assert.match(stdout, /1,?200/); assert.match(stdout, /Alice/);
    return output;
  });
  await test('translate-zh', async () => {
    const output = await call('ai_translate', { text: lines.slice(1).join('\n'), target_language: 'zh-CN' });
    assert.match(output.text, /1,?200/); assert.match(output.text, /[\u4e00-\u9fff]/); return output;
  });
  await test('translate-en', async () => {
    const output = await call('ai_translate', { text: '负责人Alice，预算1200元。\n周五15:00讨论1.2版。\n\n保留原始文件。', target_language: 'en' });
    assert.match(output.text, /Alice/); assert.match(output.text, /1,?200/); return output;
  });
  await test('vision-markdown', async () => {
    const output = await call('pdf_ai_markdown', { input_path: file('source.pdf'), output_path: file('vision.md'), locale: 'zh-CN' });
    assert.equal(output.status, 'success'); const text = await readFile(file('vision.md'), 'utf8');
    assert.match(text, /Northwind/); assert.match(text, /1,?200/); assert.match(text, /Alice/); return output;
  });
  await test('word-layout', async () => {
    const output = await call('pdf_to_word', { input_path: file('source.pdf'), output_path: file('assisted.docx'), ai_mode: true, layout: 'a4' });
    assert.ok(output.ai_review.reviewed > 0); assert.equal(output.ai_review.remaining, 0);
    const xml = await (await JSZip.loadAsync(await readFile(file('assisted.docx')))).file('word/document.xml').async('string');
    for (const text of lines) assert.ok(xml.includes(text), `Source missing: ${text}`); return output;
  });
  for (const mode of ['outline', 'speaker-notes', 'meeting-notes', 'study-notes']) await test(`ppt-text-${mode}`, async () => {
    const output = await call('ppt_text', { input_path: file('source.pptx'), output_dir: file('ppt-text'), ai_mode: mode, format: 'all' });
    assert.ok(output.ai_result.content.length > 50); assert.match(output.ai_result.content, /1,?200/); return output;
  });
  const brief = 'Northwind项目内部评审：版本1.2，预算1200元，负责人Alice，周五15:00开会。安排为准备材料、核对数量、讨论草稿。制作三页中文演示：项目背景、资源安排、下一步。不虚构测试和完成状态。';
  await test('ppt-outline', async () => {
    const output = await call('ppt_outline', { prompt: brief, output_dir: file('outline'), slide_count: 3, deck_type: 'project-review' });
    const jsonFile = output.outputs.find(item => item.path.endsWith('outline.json'));
    const outline = JSON.parse(await readFile(jsonFile.path, 'utf8')); assert.equal(outline.slides.length, 3); return output;
  });
  await test('ppt-draft', async () => {
    const output = await call('ppt_draft', { prompt: brief, output_dir: file('draft'), slide_count: 3, deck_type: 'project-review' });
    const target = output.outputs.find(item => item.path.endsWith('.pptx')).path;
    const zip = await JSZip.loadAsync(await readFile(target)); assert.equal(zip.file(/^ppt\/slides\/slide\d+\.xml$/).length, 3);
    const rendering = await call('ppt_to_pdf', { input_path: target, output_dir: file('draft-render') }); return { output, rendering };
  });
  await test('document-project', async () => {
    const output = await call('ai_document', { prompt: '请生成两页中文内部计划。仅有事实：项目Northwind、负责人Alice、预算1200元、版本1.2。第一页说明项目背景和这些事实；第二页列出待办事项与待确认信息。不要声称测试通过，不要虚构日期。', output_path: file('document.pdf'), page_count: 2 });
    assert.equal((await PDFDocument.load(await readFile(file('document.pdf')))).getPageCount(), 2);
    const project_path = file('document.toolknit.json');
    const before = await call('ai_document_inspect', { project_path });
    const control = before.project.pages[0].controls.find(item => item.type === 'title'); assert.ok(control);
    await call('ai_document_edit', { project_path, operations: [{ type: 'update_text', control: control.number, text: 'Northwind 计划' }] });
    const edited = await call('ai_document_inspect', { project_path }); assert.equal(edited.project.pages[0].controls.find(item => item.number === control.number).text, 'Northwind 计划');
    await call('ai_document_edit', { project_path, operations: [{ type: 'undo', steps: 1 }] });
    const undone = await call('ai_document_inspect', { project_path }); assert.equal(undone.project.pages[0].controls.find(item => item.number === control.number).text, control.text);
    const rendered = await call('ai_document_render', { project_path }); return { output, rendered };
  });
  await test('table-project', async () => {
    const output = await call('ai_table', { prompt: '生成中文采购表，列为项目、数量、单价。数据必须严格为：笔记本10本单价12元，笔20支单价3元，文件夹5个单价8元。仅三条数据，数字为数值类型。不添加虚构项目。', output_path: file('table.xlsx'), format: 'xlsx' });
    assert.ok((await JSZip.loadAsync(await readFile(file('table.xlsx')))).file('xl/workbook.xml'));
    const project_path = file('table.toolknit-table.json');
    const before = await call('ai_table_inspect', { project_path }); assert.equal(before.table.rows.length, 3);
    const row = before.project.rows[0], column = before.project.columns[0];
    await call('ai_table_edit', { project_path, operations: [{ type: 'update_cell', row: row.number, column: column.number, value: 'Updated item' }] });
    const edited = await call('ai_table_inspect', { project_path }); assert.equal(edited.project.rows[0].values[0], 'Updated item');
    await call('ai_table_edit', { project_path, operations: [{ type: 'undo', steps: 1 }] });
    const undone = await call('ai_table_inspect', { project_path }); assert.deepEqual(undone.project.rows[0].values, row.values);
    return { output, rendered: await call('ai_table_render', { project_path }) };
  });
  await test('transcribe-refine', async () => {
    const speech = "Add-Type -AssemblyName System.Speech; $voice = New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $voice.SetOutputToWaveFile($env:TOOLKNIT_QA_SPEECH_FILE); $voice.Speak('This is a synthetic speech test. The project has three pages. Alice will review the document on Friday.'); } finally { $voice.Dispose() }";
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(speech, 'utf16le').toString('base64')], { windowsHide: true, timeout: 30000, env: { ...process.env, TOOLKNIT_QA_SPEECH_FILE: file('speech.wav') } });
    const output = await call('transcribe', { input_path: file('speech.wav'), output_dir: file('speech-output'), language: 'en', refine: true });
    const raw = await readFile(output.raw_srt_path, 'utf8'), refined = await readFile(output.refined_srt_path, 'utf8');
    const timings = text => text.split(/\r?\n/).filter(line => /^\d+$/.test(line) || line.includes('-->'));
    assert.deepEqual(timings(refined), timings(raw)); assert.match(refined, /project|document|Alice/i); return output;
  });
  await test('cancel-recover', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      await assert.rejects(call('ai_translate', { text: lines.join('\n'), target_language: 'zh-CN' }, { signal: controller.signal }));
    } finally { clearTimeout(timer); }
    await client.ping(); return await call('uuid', { count: 1 });
  });
  for (const [name, digest] of Object.entries(inputHashes)) assert.equal(hash(await readFile(file(name))), digest);
  assert.ok(!stderr.includes(secret));
} finally { await client.close(); await save(); }
console.log(JSON.stringify({ report: file('report.json'), passed: results.filter(item => item.status === 'passed').length, failed: results.filter(item => item.status === 'failed').length }));
process.exitCode = results.some(item => item.status === 'failed') ? 1 : 0;
