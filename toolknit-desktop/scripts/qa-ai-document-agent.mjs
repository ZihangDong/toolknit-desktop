import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(projectRoot, 'cli', 'toolknit.mjs');
const outputRoot = path.resolve(
  process.env.TOOLKNIT_AGENT_QA_ROOT || path.join(projectRoot, 'output', 'pdf', 'agent-e2e-real-provider')
);
const pdfPath = path.join(outputRoot, 'toolknit-agent-e2e.pdf');
const projectPath = path.join(outputRoot, 'toolknit-agent-e2e.toolknit.json');
const dataPath = path.join(outputRoot, 'toolknit-agent-e2e.toolknit');
const sourceImagePath = path.join(outputRoot, 'agent-insert-source.png');
const reportPath = path.join(outputRoot, 'qa-report.json');
const secret = process.env.TOOLKNIT_AI_API_KEY || process.env.DEEPSEEK_API_KEY || '';

assert.ok(secret, 'A ToolKnit AI provider key must be present in the process environment.');

function createMcpClient() {
  const child = spawn(process.execPath, [cliPath, 'mcp', 'serve'], {
    cwd: projectRoot,
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env
  });
  let nextId = 1;
  let stdoutBuffer = '';
  let stderr = '';
  const pending = new Map();
  const notifications = [];

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    stdoutBuffer += chunk;
    let lineEnd;
    while ((lineEnd = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, lineEnd).trim();
      stdoutBuffer = stdoutBuffer.slice(lineEnd + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id === undefined) {
        notifications.push(message);
        continue;
      }
      const entry = pending.get(message.id);
      if (!entry) continue;
      clearTimeout(entry.timeout);
      pending.delete(message.id);
      entry.resolve(message);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', error => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  });

  return {
    notifications,
    request(method, params, timeoutMs = 240_000) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP request timed out: ${method}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timeout });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    async close() {
      child.stdin.end();
      if (!child.killed) child.kill();
      await new Promise(resolve => child.once('close', resolve));
      assert.equal(stderr, '', 'MCP stderr must remain empty during a successful QA run.');
    }
  };
}

async function callTool(client, name, argumentsValue, progressToken) {
  const response = await client.request('tools/call', {
    name,
    ...(progressToken ? { _meta: { progressToken } } : {}),
    arguments: argumentsValue
  });
  const progress = progressToken
    ? client.notifications
      .filter(message => message.method === 'notifications/progress'
        && message.params?.progressToken === progressToken)
      .map(message => `${message.params.progress}:${message.params.message || ''}`)
    : [];
  assert.equal(
    response.result?.isError,
    false,
    `${response.result?.content?.[0]?.text || `${name} failed.`}${progress.length ? ` Progress: ${progress.join(' -> ')}` : ''}`
  );
  return response.result.structuredContent.result;
}

function flattenedControls(inspection) {
  return inspection.project.pages.flatMap(page => page.controls.map(control => ({ ...control, page: page.page })));
}

async function jsonFiles(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(target);
    }
  }
  await walk(root);
  return files;
}

await mkdir(path.dirname(outputRoot), { recursive: true });
await mkdir(outputRoot, { recursive: false });
const imageCanvas = createCanvas(2400, 1260);
const imageContext = imageCanvas.getContext('2d');
imageContext.fillStyle = '#FFFFFF';
imageContext.fillRect(0, 0, imageCanvas.width, imageCanvas.height);
imageContext.fillStyle = '#111111';
imageContext.font = '700 148px sans-serif';
imageContext.fillText('ToolKnit Agent', 180, 500);
imageContext.font = '400 76px sans-serif';
imageContext.fillStyle = '#4A4A4A';
imageContext.fillText('Editable document workflow / v1.2', 180, 660);
imageContext.fillStyle = '#111111';
imageContext.fillRect(180, 780, 2040, 12);
await writeFile(sourceImagePath, imageCanvas.toBuffer('image/png'), { flag: 'wx' });

const client = createMcpClient();
try {
  const initialized = await client.request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'toolknit-real-provider-qa-agent', version: '1.0.0' }
  });
  assert.equal(initialized.result.serverInfo.name, 'toolknit');
  client.notify('notifications/initialized');

  const listed = await client.request('tools/list', {});
  const toolNames = new Set(listed.result.tools.map(tool => tool.name));
  assert.equal(toolNames.size, listed.result.tools.length, 'MCP tool names must be unique.');
  for (const name of [
    'toolknit_ai_document',
    'toolknit_ai_document_inspect',
    'toolknit_ai_document_edit',
    'toolknit_ai_document_render'
  ]) assert.ok(toolNames.has(name), `Missing MCP tool: ${name}`);

  const created = await callTool(client, 'toolknit_ai_document', {
    prompt: `生成一份三页中文 A4 文档《ToolKnit Agent 原生可编辑工作流验收报告》。
第 1 页必须包含标题和副标题，说明验收目标、测试范围、桌面端与 CLI/MCP 的关系，并包含版本信息表格和一个重点结论。
第 2 页用分阶段表格说明“生成、检查、试运行、提交、撤销、重渲染”的完整 Agent 工作流，每一阶段写明输入、动作和验收证据。
第 3 页列出安全边界、风险、验收清单和后续建议，包含责任角色、优先级与验证方法。
每页控制在 8 到 14 个内容区域，每个表格最多 5 行；内容必须具体但简洁，页面下半部分也要有有效内容，不得为了填充而重复。使用现代黑白专业版式，不使用 emoji、虚假引用、彩色装饰或占位文字。
未提供的版本号、日期、平台兼容性、验收状态和性能数据必须写“待确认”，不得自行补充，也不得声称已通过验收或可投入生产。`,
    output_path: pdfPath,
    page_count: 3,
    locale: 'zh-CN',
    overwrite: false
  }, 'qa-create');
  assert.equal(created.project.revision, 1);
  assert.equal(created.outputs.find(output => output.kind === 'pdf').pages, 3);
  const createdDemoOutput = created.outputs.find(output => output.kind === 'demo');
  assert.equal(createdDemoOutput.page_files.length, 3);
  assert.equal(createdDemoOutput.page_files.every(filePath => path.isAbsolute(filePath)), true);

  const initialInspection = await callTool(client, 'toolknit_ai_document_inspect', { project_path: projectPath });
  assert.equal(initialInspection.project.revision, 1);
  const controls = flattenedControls(initialInspection);
  const title = controls.find(control => control.type === 'title');
  const subtitle = controls.find(control => control.page === title?.page && control.type === 'subtitle');
  const table = controls.find(control => control.type === 'table-row');
  const imageReplacement = controls
    .filter(control => control.page === title?.page && ['body', 'note', 'emphasis'].includes(control.type))
    .sort((first, second) => second.h - first.h)[0];
  const groupCandidates = controls.filter(control => control.page === title?.page
    && control.number !== imageReplacement?.number
    && !['title', 'subtitle', 'page-header', 'page-footer', 'divider', 'image'].includes(control.type)).slice(0, 2);
  assert.ok(title && subtitle && table && imageReplacement && groupCandidates.length === 2, 'The generated layout lacks controls required by the editing scenario.');

  const operations = [
    { type: 'update_style', control: title.number, style: { backgroundColor: '#000000', textColor: '#FFFFFF', fontSize: 32, padding: 12 } },
    { type: 'update_style', control: table.number, style: { backgroundColor: '#F2F2F2', borderColor: '#111111', borderWidth: 1, dividerColor: '#111111', dividerWidth: 2 } },
    { type: 'group_controls', controls: groupCandidates.map(control => control.number), group: 'qa-summary-group' },
    { type: 'align_controls', controls: groupCandidates.map(control => control.number), anchor: groupCandidates[0].number, alignment: 'left' },
    { type: 'swap_positions', first: title.number, second: subtitle.number },
    {
      type: 'insert_control',
      after: imageReplacement.number,
      control: {
        type: 'image',
        source_path: sourceImagePath,
        label: 'ToolKnit Agent workflow',
        w: imageReplacement.w,
        h: imageReplacement.h
      }
    },
    { type: 'delete_control', control: imageReplacement.number }
  ];

  const dryRun = await callTool(client, 'toolknit_ai_document_edit', {
    project_path: projectPath,
    operations,
    dry_run: true
  }, 'qa-dry-run');
  assert.equal(dryRun.dry_run, true);
  assert.equal(dryRun.project.current_revision, 1);
  assert.equal(dryRun.project.proposed_revision, 2);
  assert.equal(dryRun.diagnostics.some(diagnostic => diagnostic.severity === 'error'), false);
  assert.equal(JSON.parse(await readFile(projectPath, 'utf8')).revision, 1, 'Dry-run wrote the project.');

  const edited = await callTool(client, 'toolknit_ai_document_edit', {
    project_path: projectPath,
    operations,
    dry_run: false
  }, 'qa-edit');
  assert.equal(edited.project.revision, 2);
  const editedProject = JSON.parse(await readFile(projectPath, 'utf8'));
  const editedControls = editedProject.pages.flatMap(page => page.controls);
  const editedTitle = editedControls.find(control => control.number === title.number);
  assert.equal(editedTitle.style.backgroundColor, '#000000');
  assert.equal(editedTitle.style.textColor, '#FFFFFF');
  assert.ok(editedControls.some(control => control.type === 'image' && control.assetId));
  assert.equal(editedControls.some(control => control.number === imageReplacement.number), false);
  assert.equal(editedControls.filter(control => control.groupId === 'qa-summary-group').length, 2);

  const rerendered = await callTool(client, 'toolknit_ai_document_render', { project_path: projectPath }, 'qa-render');
  assert.equal(rerendered.project.revision, 2);

  const undone = await callTool(client, 'toolknit_ai_document_edit', {
    project_path: projectPath,
    operations: [{ type: 'undo', steps: 1 }]
  }, 'qa-undo');
  assert.equal(undone.project.revision, 3);
  const undoneProject = JSON.parse(await readFile(projectPath, 'utf8'));
  assert.deepEqual(undoneProject.pages, JSON.parse(await readFile(path.join(dataPath, 'revisions', 'revision-0001.json'), 'utf8')).project.pages);

  const restored = await callTool(client, 'toolknit_ai_document_edit', {
    project_path: projectPath,
    operations: [{ type: 'undo', steps: 1 }]
  }, 'qa-restore-edited');
  assert.equal(restored.project.revision, 4);
  assert.deepEqual(restored.diagnostics, []);
  const finalProject = JSON.parse(await readFile(projectPath, 'utf8'));
  assert.ok(finalProject.pages.flatMap(page => page.controls).some(control => control.type === 'image' && control.assetId));
  const finalText = finalProject.pages.flatMap(page => page.controls.map(control => control.text || '')).join('\n');
  assert.doesNotMatch(finalText, /(?:全部|所有|各项|六阶段)[^。；\n]{0,20}(?:通过|达标|合格)/);
  const positiveClaimText = finalText.replace(
    /(?:不得|不能|不可|尚未|未)[^。；\n]{0,50}(?:可投入生产(?:使用)?|具备(?:上线|发布|生产)条件)[^。；\n]*/g,
    ''
  );
  assert.doesNotMatch(positiveClaimText, /(?:可投入生产(?:使用)?|具备(?:上线|发布|生产)条件)/);

  const pdfInspection = await callTool(client, 'toolknit_pdf_inspect', { input_path: pdfPath });
  assert.equal(pdfInspection.input.pages, 3);
  assert.equal((await stat(path.join(dataPath, 'demo', 'controls-overview.png'))).size > 1000, true);
  assert.equal((await stat(path.join(dataPath, 'preview', 'page-01.png'))).size > 1000, true);
  assert.equal((await stat(path.join(dataPath, 'revisions', 'revision-0004.json'))).size > 1000, true);

  for (const jsonPath of [projectPath, ...(await jsonFiles(path.join(dataPath, 'revisions')))]) {
    assert.equal((await readFile(jsonPath, 'utf8')).includes(secret), false, `Provider key leaked into ${jsonPath}`);
  }

  const progress = Object.fromEntries([...new Set(client.notifications
    .filter(message => message.method === 'notifications/progress')
    .map(message => message.params.progressToken))]
    .map(token => [token, client.notifications
      .filter(message => message.method === 'notifications/progress' && message.params.progressToken === token)
      .map(message => message.params.progress)]));
  const report = {
    passed: true,
    provider: process.env.TOOLKNIT_AI_MODEL || 'deepseek-chat',
    tools: listed.result.tools.length,
    project: projectPath,
    pdf: pdfPath,
    pages: pdfInspection.input.pages,
    finalRevision: finalProject.revision,
    controlCount: finalProject.pages.reduce((sum, page) => sum + page.controls.length, 0),
    creationDiagnostics: created.diagnostics,
    diagnostics: restored.diagnostics,
    previewDirectory: path.join(dataPath, 'preview'),
    controlsOverview: path.join(dataPath, 'demo', 'controls-overview.png'),
    numberedPages: createdDemoOutput.page_files,
    progress
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ passed: true, report: reportPath, pdf: pdfPath, project: projectPath, pages: report.pages, revision: report.finalRevision })}\n`);
} finally {
  await client.close();
}
