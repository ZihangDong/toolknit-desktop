import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadImage } from '@napi-rs/canvas';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(projectRoot, 'cli', 'toolknit.mjs');
const outputBase = path.resolve(
  process.env.TOOLKNIT_AGENT_TABLE_QA_ROOT
    || path.join(projectRoot, 'output', 'ai-table', 'agent-natural-language-workflows')
);
const providerKey = 'toolknit-local-ai-table-qa-key';

const scenarios = [
  {
    id: 'user-a-project-manager',
    locale: 'zh-CN',
    fileName: '项目进度表.xlsx',
    format: 'xlsx',
    prompt: '请在当前 IDE 项目的 toolknit-output 中生成一份 4 列 6 行的中文表格《项目进度表》，包含任务、责任人、完成率、截止日期，并加入完成率趋势图。不要覆盖已有文件。',
    providerData: {
      ready: true,
      title: '项目进度表',
      summary: '项目阶段、责任人、完成率与截止日期。',
      columns: [
        { key: 'task', label: '任务', type: 'text' },
        { key: 'owner', label: '责任人', type: 'text' },
        { key: 'progress', label: '完成率', type: 'number' },
        { key: 'due_date', label: '截止日期', type: 'date' }
      ],
      rows: [
        ['需求梳理', '张三', 80, '2026-08-10'],
        ['界面设计', '李四', 65, '2026-08-12'],
        ['核心开发', '王五', 45, '2026-08-16'],
        ['联调测试', '赵六', 25, '2026-08-18'],
        ['文档整理', '钱七', 15, '2026-08-20'],
        ['发布准备', '孙八', 5, '2026-08-22']
      ],
      charts: [
        { type: 'line', title: '完成率趋势', labelColumn: 0, valueColumns: [2] }
      ]
    },
    editRequest: '请先 inspect 工程，不要根据预览图猜。把 C02 的标题改成“负责人”，把 R01/C02 改为“王小明”，交换 R01 和 R02，再把 G01 标题改成“完成率趋势（更新）”。先 dry-run，没有 error 后提交完全相同的 operations。',
    operations: [
      { type: 'update_column', column: 'C02', label: '负责人' },
      { type: 'update_cell', row: 'R01', column: 'C02', value: '王小明' },
      { type: 'swap_rows', first: 'R01', second: 'R02' },
      { type: 'update_chart', chart: 'G01', title: '完成率趋势（更新）' }
    ],
    assertAfterCommit(project) {
      assert.equal(project.columns.find(column => column.number === 'C02').label, '负责人');
      assert.equal(project.rows[0].number, 'R02');
      assert.equal(project.rows.find(row => row.number === 'R01').values[1], '王小明');
      assert.equal(project.charts.find(chart => chart.number === 'G01').title, '完成率趋势（更新）');
    }
  },
  {
    id: 'user-b-finance-ops',
    locale: 'en',
    fileName: 'budget-tracker.png',
    format: 'png',
    prompt: 'Use ToolKnit MCP to create an editable English budget tracker in the current IDE project. Save it as PNG in toolknit-output. It should have Item, Owner, Cost, Due Date, and Status columns. Do not include a chart in the first draft; I will add one later.',
    providerData: {
      ready: true,
      title: 'Budget Tracker',
      summary: 'Editable budget tracker for agent workflow QA.',
      columns: [
        { key: 'item', label: 'Item', type: 'text' },
        { key: 'owner', label: 'Owner', type: 'text' },
        { key: 'cost', label: 'Cost', type: 'number' },
        { key: 'due_date', label: 'Due Date', type: 'date' },
        { key: 'status', label: 'Status', type: 'text' }
      ],
      rows: [
        ['Design review', 'Product', 2800, '2026-09-01', 'Planned'],
        ['Security audit', 'Engineering', 6400, '2026-09-05', 'Planned'],
        ['Docs polish', 'Content', 1200, '2026-09-08', 'Queued'],
        ['Release QA', 'QA', 4300, '2026-09-12', 'Planned'],
        ['Community launch', 'Marketing', 5200, '2026-09-18', 'Draft']
      ],
      charts: []
    },
    editRequest: 'Inspect the table project first. Add a bar chart using Item as labels and Cost as values, sort rows by Cost descending, insert a Contingency row after R02, then delete the Status column C05. Dry-run first; if there is no error, commit exactly the same operations.',
    operations: [
      { type: 'insert_chart', chart: { type: 'bar', title: 'Cost by Item', labelColumnId: 'C01', valueColumnIds: ['C03'] } },
      { type: 'sort_rows', column: 'C03', direction: 'desc' },
      { type: 'insert_row', after: 'R02', values: ['Contingency', 'Operations', 7500, '2026-09-15', 'Planned'] },
      { type: 'delete_column', column: 'C05' }
    ],
    assertAfterCommit(project) {
      assert.equal(project.charts.length, 1);
      assert.equal(project.charts[0].number, 'G01');
      assert.equal(project.charts[0].title, 'Cost by Item');
      assert.equal(project.columns.some(column => column.number === 'C05'), false);
      assert.equal(project.rows.length, 6);
      assert.equal(project.rows.some(row => row.values[0] === 'Contingency'), true);
      assert.ok(Number(project.rows[0].values[2]) >= Number(project.rows.at(-1).values[2]));
    },
    undo: true,
    assertAfterUndo(project) {
      assert.equal(project.revision, 3);
      assert.equal(project.charts.length, 0);
      assert.equal(project.columns.length, 5);
      assert.equal(project.rows.length, 5);
      assert.equal(project.columns[4].number, 'C05');
    }
  }
];

async function createRunRoot() {
  await mkdir(path.dirname(outputBase), { recursive: true });
  for (let index = 1; index < 1000; index++) {
    const candidate = index === 1 ? outputBase : `${outputBase}-run${index}`;
    try {
      await mkdir(candidate, { recursive: false });
      return candidate;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`Could not create a unique QA output folder below ${path.dirname(outputBase)}.`);
}

function createProviderServer() {
  const authorizations = [];
  const server = createServer((request, response) => {
    authorizations.push(String(request.headers.authorization || ''));
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(payload.model, 'toolknit-ai-table-qa-model');
      assert.ok(payload.messages.some(message => String(message.content || '').includes('table and chart engine')));
      const userPrompt = String(payload.messages.at(-1)?.content || '');
      const scenario = /Budget Tracker|budget tracker|Cost/.test(userPrompt)
        ? scenarios.find(item => item.id === 'user-b-finance-ops')
        : scenarios.find(item => item.id === 'user-a-project-manager');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(scenario.providerData) } }] }));
    });
  });
  return { server, authorizations };
}

function createMcpClient(environment) {
  const child = spawn(process.execPath, [cliPath, 'mcp', 'serve'], {
    cwd: projectRoot,
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...environment }
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
    request(method, params, timeoutMs = 180_000) {
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
  assert.equal(response.result?.isError, false, response.result?.content?.[0]?.text || `${name} failed.`);
  return response.result.structuredContent.result;
}

function outputByKind(result, kind) {
  const output = result.outputs?.find(item => item.kind === kind);
  assert.ok(output, `Missing ${kind} output.`);
  return output;
}

async function fileSha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
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

async function assertPreviewImage(filePath) {
  assert.equal(path.isAbsolute(filePath), true);
  assert.ok((await stat(filePath)).size > 10_000, `Preview image is unexpectedly small: ${filePath}`);
  // Decode an in-memory copy so the Windows native image loader cannot hold the project directory open before edit.
  const image = await loadImage(await readFile(filePath));
  assert.ok(image.width >= 900 && image.height >= 600, `Preview image is too small: ${filePath}`);
  return { path: filePath, width: image.width, height: image.height };
}

async function readProject(projectPath) {
  return JSON.parse(await readFile(projectPath, 'utf8'));
}

async function runScenario(client, outputRoot, scenario) {
  const scenarioRoot = path.join(outputRoot, scenario.id);
  const outputDir = path.join(scenarioRoot, 'toolknit-output');
  await mkdir(outputDir, { recursive: true });
  const exportPath = path.join(outputDir, scenario.fileName);
  const parsed = path.parse(exportPath);
  const projectPath = path.join(parsed.dir, `${parsed.name}.toolknit-table.json`);
  const dataPath = path.join(parsed.dir, `${parsed.name}.toolknit-table`);
  const previewPath = path.join(dataPath, 'preview', 'preview.png');
  const conversation = [{ role: 'user', text: scenario.prompt }];

  const created = await callTool(client, 'toolknit_ai_table', {
    prompt: scenario.prompt,
    output_path: exportPath,
    format: scenario.format,
    locale: scenario.locale,
    overwrite: false
  }, `${scenario.id}-create`);
  assert.equal(created.ready, true);
  assert.equal(created.project.revision, 1);
  assert.equal(outputByKind(created, 'export').format, scenario.format);
  assert.equal((await stat(exportPath)).size > 1000, true);

  const initialProject = await readProject(projectPath);
  assert.equal(initialProject.schema, 'toolknit.ai-table');
  assert.equal(initialProject.revision, 1);
  assert.equal(initialProject.columns[0].number, 'C01');
  assert.equal(initialProject.rows[0].number, 'R01');

  const inspected = await callTool(client, 'toolknit_ai_table_inspect', { project_path: projectPath });
  assert.equal(inspected.project.revision, 1);
  assert.equal(inspected.table.columns.length, scenario.providerData.columns.length);
  assert.equal(inspected.table.rows.length, scenario.providerData.rows.length);
  const previewInfo = await assertPreviewImage(inspected.artifacts.preview);
  const previewHashBeforeEdit = await fileSha256(previewPath);

  conversation.push({ role: 'user', text: scenario.editRequest });
  const dryRun = await callTool(client, 'toolknit_ai_table_edit', {
    project_path: projectPath,
    operations: scenario.operations,
    dry_run: true
  }, `${scenario.id}-edit-dry-run`);
  assert.equal(dryRun.dry_run, true);
  assert.equal(dryRun.project.current_revision, 1);
  assert.equal(dryRun.diagnostics.some(diagnostic => diagnostic.severity === 'error'), false);
  assert.equal((await readProject(projectPath)).revision, 1, 'Dry-run must not write the table project.');

  const edited = await callTool(client, 'toolknit_ai_table_edit', {
    project_path: projectPath,
    operations: scenario.operations,
    dry_run: false
  }, `${scenario.id}-edit-commit`);
  assert.equal(edited.project.revision, 2);
  assert.equal(edited.diagnostics.some(diagnostic => diagnostic.severity === 'error'), false);
  assert.notEqual(await fileSha256(previewPath), previewHashBeforeEdit, 'Preview did not refresh after table edit.');
  const committedProject = await readProject(projectPath);
  assert.equal(committedProject.revision, 2);
  scenario.assertAfterCommit(committedProject);
  await assertPreviewImage(outputByKind(edited, 'preview').path);

  let finalProject = committedProject;
  let finalResult = edited;
  if (scenario.undo) {
    conversation.push({ role: 'user', text: '请撤销上一次 AI 表格修改，保留修订历史，然后重新渲染预览。' });
    const undone = await callTool(client, 'toolknit_ai_table_edit', {
      project_path: projectPath,
      operations: [{ type: 'undo', steps: 1 }]
    }, `${scenario.id}-undo`);
    assert.equal(undone.project.revision, 3);
    finalProject = await readProject(projectPath);
    scenario.assertAfterUndo(finalProject);
    finalResult = undone;
  }

  const rendered = await callTool(client, 'toolknit_ai_table_render', { project_path: projectPath }, `${scenario.id}-render`);
  assert.equal(rendered.project.revision, finalProject.revision);
  await assertPreviewImage(outputByKind(rendered, 'preview').path);
  assert.equal((await stat(exportPath)).size > 1000, true);

  for (const jsonPath of await jsonFiles(scenarioRoot)) {
    assert.equal((await readFile(jsonPath, 'utf8')).includes(providerKey), false, `Provider key leaked into ${jsonPath}`);
  }

  return {
    id: scenario.id,
    locale: scenario.locale,
    passed: true,
    conversation,
    export: exportPath,
    project: projectPath,
    preview: previewPath,
    previewInfo,
    finalRevision: finalProject.revision,
    columns: finalProject.columns.map(column => ({ number: column.number, label: column.label, type: column.type })),
    rows: finalProject.rows.length,
    charts: finalProject.charts.map(chart => ({ number: chart.number, title: chart.title, type: chart.type })),
    outputs: finalResult.outputs
  };
}

const runRoot = await createRunRoot();
const reportPath = path.join(runRoot, 'qa-report.json');
const { server: providerServer, authorizations } = createProviderServer();
await new Promise(resolve => providerServer.listen(0, '127.0.0.1', resolve));
const providerAddress = providerServer.address();
const client = createMcpClient({
  DEEPSEEK_API_KEY: providerKey,
  TOOLKNIT_AI_API_URL: `http://127.0.0.1:${providerAddress.port}/v1/chat/completions`,
  TOOLKNIT_AI_MODEL: 'toolknit-ai-table-qa-model'
});

try {
  const initialized = await client.request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'toolknit-ai-table-agent-workflow-qa', version: '1.0.0' }
  });
  assert.equal(initialized.result.serverInfo.name, 'toolknit');
  assert.match(initialized.result.instructions, /stable row, column, and chart numbers/i);
  client.notify('notifications/initialized');

  const listed = await client.request('tools/list', {});
  const toolNames = new Set(listed.result.tools.map(tool => tool.name));
  assert.equal(toolNames.size, listed.result.tools.length, 'MCP tool names must be unique.');
  for (const name of [
    'toolknit_ai_table',
    'toolknit_ai_table_inspect',
    'toolknit_ai_table_edit',
    'toolknit_ai_table_render'
  ]) assert.ok(toolNames.has(name), `Missing MCP tool: ${name}`);

  const workflows = [];
  for (const scenario of scenarios) workflows.push(await runScenario(client, runRoot, scenario));
  assert.equal(authorizations.every(value => value === `Bearer ${providerKey}`), true);

  const report = {
    passed: true,
    userSimulations: workflows.length,
    provider: 'local-openai-compatible-mock',
    workflows,
    progressEvents: client.notifications.filter(message => message.method === 'notifications/progress').length
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    passed: true,
    report: reportPath,
    workflows: workflows.map(workflow => ({
      id: workflow.id,
      export: workflow.export,
      project: workflow.project,
      revision: workflow.finalRevision
    }))
  })}\n`);
} finally {
  await client.close();
  await new Promise((resolve, reject) => providerServer.close(error => error ? reject(error) : resolve()));
}
