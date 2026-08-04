import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(projectRoot, 'cli', 'toolknit.mjs');
const outputRoot = path.resolve(
  process.env.TOOLKNIT_AGENT_QA_ROOT
    || path.join(projectRoot, 'output', 'pdf', 'agent-natural-language-workflows')
);
const reportPath = path.join(outputRoot, 'qa-report.json');
const secret = process.env.TOOLKNIT_AI_API_KEY || process.env.DEEPSEEK_API_KEY || '';

assert.ok(secret, 'A ToolKnit AI provider key must be present in the process environment.');

const scenarios = [
  {
    id: 'user-a-product-manager',
    locale: 'zh-CN',
    pageCount: 3,
    fileName: '开源工作坊执行方案.pdf',
    prompt: `生成一份三页中文 A4 文档《开源工作坊执行方案》。
第 1 页说明活动目标、参与角色、准备清单和成功标准；第 2 页说明报名、准备、现场协作、成果提交和复盘流程；第 3 页列出风险、责任分工、检查清单和后续行动。
这是初稿，必须完全不包含图片、图片占位符或 image 区域。第 2 页为后续插图保留至少 180px 的纵向编辑余量。每页使用 6 到 10 个内容区域，表格不超过 5 行，内容具体但简洁。
使用现代黑白专业版式，不使用 emoji、虚假引用、彩色装饰或占位文字。没有提供的日期、版本、负责人姓名和验收结果必须写“待确认”。`,
    insertPage: 2,
    deletePage: 3,
    placement: 'after',
    imageFileName: '参与流程.png',
    imageLabel: '参与流程示意',
    imageFormat: 'png',
    imageWidth: 540,
    imageHeight: 150,
    insertionRequest: ({ anchor, relativeImage }) => `请先检查工程，在第 2 页 ${anchor.number} 后面插入当前项目里的 ${relativeImage}，显示宽 540、高 150。先试运行，没有错误再正式提交；不要改变其他控件。`,
    deletionRequest: ({ target }) => `请删除第 3 页编号图中的 ${target.number}（${target.text || target.type}）。先检查并试运行，只删除这个组件，完成后告诉我新修订号。`
  },
  {
    id: 'user-b-engineering-lead',
    locale: 'en',
    pageCount: 2,
    fileName: 'incident-response-playbook.pdf',
    prompt: `Create a two-page English A4 document titled "Incident Response Workshop Playbook".
Page 1 explains purpose, roles, intake, and triage. Keep escalation brief or move the detailed escalation discussion to page 2 if needed, and reserve a clearly empty lower band of at least 220 px on page 1 for a diagram that will be added later. Page 2 explains containment, communication, evidence capture, review, and follow-up actions.
This initial draft must contain no images, image placeholders, or image regions. Use 5 to 8 content regions per page and no more than five rows in a table. Do not place any paragraph, table, or note into the reserved lower band on page 1.
Use a modern monochrome professional layout. Do not use emoji, colorful decoration, fabricated citations, or filler. Dates, named owners, service levels, versions, and test results that were not provided must say "Not provided".`,
    insertPage: 1,
    insertAnchorAtPageEnd: true,
    deletePage: 2,
    placement: 'after',
    imageFileName: 'response-path.jpg',
    imageLabel: 'Response path diagram',
    imageFormat: 'jpeg',
    imageWidth: 540,
    imageHeight: 150,
    insertLayoutMode: 'absolute',
    insertX: 56,
    insertY: 900,
    insertionRequest: ({ anchor, relativeImage }) => `Inspect the project, then insert ${relativeImage} from the current workspace after the last control on page 1 in the reserved space at 540 by 150. Dry-run first and submit the identical operation only if there is no error.`,
    deletionRequest: ({ target }) => `Delete only ${target.number} (${target.text || target.type}) from page 2. Inspect it first, dry-run the single deletion, then commit it and report the updated numbered map.`
  }
];

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
    request(method, params, timeoutMs = 300_000) {
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

function chooseAnchor(project, pageNumber) {
  const page = project.pages[pageNumber - 1];
  assert.ok(page, `Missing requested insertion page ${pageNumber}.`);
  const preferred = page.controls.filter(control => ['section-heading', 'sub-heading'].includes(control.type));
  return preferred[Math.min(1, preferred.length - 1)]
    || page.controls.find(control => ['body', 'emphasis', 'note'].includes(control.type))
    || page.controls[0];
}

function chooseDeletionTarget(project, pageNumber) {
  const page = project.pages[pageNumber - 1];
  assert.ok(page?.controls.length > 1, `Page ${pageNumber} has no safely deletable component.`);
  return [...page.controls].reverse().find(control => ['note', 'body', 'body-indent', 'list-item', 'emphasis'].includes(control.type))
    || page.controls.at(-1);
}

async function createWorkflowImage(filePath, scenario) {
  const canvas = createCanvas(1800, 500);
  const context = canvas.getContext('2d');
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#111111';
  context.fillRect(0, 0, canvas.width, 18);
  context.font = '700 58px sans-serif';
  context.fillText(scenario.locale === 'en' ? 'RESPONSE PATH' : 'OPEN SOURCE WORKFLOW', 80, 105);
  const labels = scenario.locale === 'en'
    ? ['INTAKE', 'TRIAGE', 'RESPOND', 'REVIEW']
    : ['DISCOVER', 'PREPARE', 'COLLABORATE', 'SHARE'];
  labels.forEach((label, index) => {
    const x = 80 + index * 425;
    context.fillStyle = index % 2 === 0 ? '#111111' : '#E8E8E8';
    context.fillRect(x, 185, 300, 150);
    context.fillStyle = index % 2 === 0 ? '#FFFFFF' : '#111111';
    context.font = '700 34px sans-serif';
    context.fillText(String(index + 1).padStart(2, '0'), x + 26, 235);
    context.font = '600 25px sans-serif';
    context.fillText(label, x + 26, 295);
    if (index < labels.length - 1) {
      context.fillStyle = '#777777';
      context.fillRect(x + 318, 257, 76, 5);
    }
  });
  context.fillStyle = '#555555';
  context.font = '400 24px sans-serif';
  context.fillText('ToolKnit editable document workflow', 80, 420);
  const bytes = scenario.imageFormat === 'jpeg'
    ? canvas.toBuffer('image/jpeg')
    : canvas.toBuffer('image/png');
  await writeFile(filePath, bytes, { flag: 'wx' });
}

async function assertNumberedMaps(paths, expectedCount) {
  assert.equal(paths.length, expectedCount);
  const dimensions = [];
  for (const filePath of paths) {
    assert.equal(path.isAbsolute(filePath), true);
    assert.ok((await stat(filePath)).size > 10_000, `Numbered map is unexpectedly small: ${filePath}`);
    const image = await loadImage(await readFile(filePath));
    assert.ok(image.width >= 1400 && image.height >= 2000, `Numbered map is not high resolution: ${filePath}`);
    dimensions.push({ path: filePath, width: image.width, height: image.height });
  }
  return dimensions;
}

async function runScenario(client, scenario) {
  const scenarioRoot = path.join(outputRoot, scenario.id);
  const assetsRoot = path.join(scenarioRoot, 'workspace-assets');
  await mkdir(assetsRoot, { recursive: true });
  const pdfPath = path.join(scenarioRoot, scenario.fileName);
  const parsedPdf = path.parse(pdfPath);
  const projectPath = path.join(parsedPdf.dir, `${parsedPdf.name}.toolknit.json`);
  const dataPath = path.join(parsedPdf.dir, `${parsedPdf.name}.toolknit`);
  const sourceImagePath = path.join(assetsRoot, scenario.imageFileName);
  await createWorkflowImage(sourceImagePath, scenario);

  const conversation = [{ role: 'user', text: scenario.prompt }];
  const created = await callTool(client, 'toolknit_ai_document', {
    prompt: scenario.prompt,
    output_path: pdfPath,
    page_count: scenario.pageCount,
    locale: scenario.locale,
    overwrite: false
  }, `${scenario.id}-create`);
  assert.equal(created.project.revision, 1);
  assert.equal(outputByKind(created, 'pdf').pages, scenario.pageCount);
  const initialProject = JSON.parse(await readFile(projectPath, 'utf8'));
  assert.equal(initialProject.assets.length, 0, 'The image-free draft unexpectedly contains assets.');
  assert.equal(initialProject.pages.flatMap(page => page.controls).some(control => control.type === 'image'), false, 'The image-free draft contains an image control.');

  const initialInspection = await callTool(client, 'toolknit_ai_document_inspect', { project_path: projectPath });
  const initialPdfInspection = await callTool(client, 'toolknit_pdf_inspect', { input_path: pdfPath });
  assert.equal(initialPdfInspection.input.pages, scenario.pageCount);
  const initialMapPaths = initialInspection.artifacts.numberedPages;
  const mapDimensions = await assertNumberedMaps(initialMapPaths, scenario.pageCount);
  const insertionPageMap = initialMapPaths[scenario.insertPage - 1];
  const initialInsertionMapHash = await fileSha256(insertionPageMap);

  const anchor = scenario.insertAnchorAtPageEnd
    ? initialProject.pages[scenario.insertPage - 1].controls.at(-1)
    : scenario.insertAnchorNumber
    ? initialProject.pages.flatMap(page => page.controls).find(control => control.number === scenario.insertAnchorNumber)
    : chooseAnchor(initialProject, scenario.insertPage);
  assert.ok(anchor, `Missing insertion anchor for page ${scenario.insertPage}.`);
  const relativeImage = path.relative(scenarioRoot, sourceImagePath);
  const insertionRequest = scenario.insertionRequest({ anchor, relativeImage });
  conversation.push({ role: 'user', text: insertionRequest });
  const insertOperation = {
    type: 'insert_control',
    [scenario.placement]: anchor.number,
    control: {
      type: 'image',
      source_path: sourceImagePath,
      label: scenario.imageLabel,
      w: scenario.imageWidth,
      h: scenario.imageHeight,
      ...(scenario.insertLayoutMode ? { layoutMode: scenario.insertLayoutMode } : {}),
      ...(scenario.insertX !== undefined ? { x: scenario.insertX } : {}),
      ...(scenario.insertY !== undefined ? { y: scenario.insertY } : {})
    }
  };
  const beforeInsertRevision = initialProject.revision;
  const insertDryRun = await callTool(client, 'toolknit_ai_document_edit', {
    project_path: projectPath,
    operations: [insertOperation],
    dry_run: true
  }, `${scenario.id}-insert-dry-run`);
  assert.equal(insertDryRun.dry_run, true);
  assert.equal(insertDryRun.project.current_revision, beforeInsertRevision);
  assert.equal(insertDryRun.diagnostics.some(diagnostic => diagnostic.severity === 'error'), false);
  assert.equal(JSON.parse(await readFile(projectPath, 'utf8')).revision, beforeInsertRevision);

  const inserted = await callTool(client, 'toolknit_ai_document_edit', {
    project_path: projectPath,
    operations: [insertOperation],
    dry_run: false
  }, `${scenario.id}-insert-commit`);
  assert.equal(inserted.project.revision, beforeInsertRevision + 1);
  const insertedNumber = inserted.changes[0].control;
  const imageProject = JSON.parse(await readFile(projectPath, 'utf8'));
  const imagePage = imageProject.pages[scenario.insertPage - 1];
  const anchorIndex = imagePage.controls.findIndex(control => control.number === anchor.number);
  const imageIndex = imagePage.controls.findIndex(control => control.number === insertedNumber);
  assert.equal(imageIndex, anchorIndex + (scenario.placement === 'after' ? 1 : -1));
  const imageControl = imagePage.controls[imageIndex];
  assert.equal(imageControl.type, 'image');
  assert.ok(imageControl.assetId);
  const asset = imageProject.assets.find(item => item.id === imageControl.assetId);
  assert.ok(asset);
  const copiedAssetPath = path.join(dataPath, asset.relativePath);
  assert.equal(await fileSha256(copiedAssetPath), asset.sha256);
  assert.notEqual(await fileSha256(insertionPageMap), initialInsertionMapHash, 'The numbered map did not refresh after image insertion.');
  await assertNumberedMaps(outputByKind(inserted, 'demo').page_files, scenario.pageCount);
  assert.equal((await callTool(client, 'toolknit_pdf_inspect', { input_path: pdfPath })).input.pages, scenario.pageCount);

  const deletionTarget = chooseDeletionTarget(imageProject, scenario.deletePage);
  assert.notEqual(deletionTarget.number, insertedNumber);
  const deletionPageMap = path.join(dataPath, 'demo', `page-${String(scenario.deletePage).padStart(2, '0')}-controls.png`);
  const beforeDeleteMapHash = await fileSha256(deletionPageMap);
  const deletionRequest = scenario.deletionRequest({ target: deletionTarget });
  conversation.push({ role: 'user', text: deletionRequest });
  const deleteOperation = { type: 'delete_control', control: deletionTarget.number };
  const deleteDryRun = await callTool(client, 'toolknit_ai_document_edit', {
    project_path: projectPath,
    operations: [deleteOperation],
    dry_run: true
  }, `${scenario.id}-delete-dry-run`);
  assert.equal(deleteDryRun.dry_run, true);
  assert.equal(deleteDryRun.project.current_revision, imageProject.revision);
  assert.equal(deleteDryRun.diagnostics.some(diagnostic => diagnostic.severity === 'error'), false);
  assert.equal(JSON.parse(await readFile(projectPath, 'utf8')).revision, imageProject.revision);

  const deleted = await callTool(client, 'toolknit_ai_document_edit', {
    project_path: projectPath,
    operations: [deleteOperation],
    dry_run: false
  }, `${scenario.id}-delete-commit`);
  assert.equal(deleted.project.revision, imageProject.revision + 1);
  const finalProject = JSON.parse(await readFile(projectPath, 'utf8'));
  const finalControls = finalProject.pages.flatMap(page => page.controls);
  assert.equal(finalControls.some(control => control.number === deletionTarget.number), false);
  assert.equal(finalControls.some(control => control.number === insertedNumber && control.type === 'image'), true);
  assert.notEqual(await fileSha256(deletionPageMap), beforeDeleteMapHash, 'The numbered map did not refresh after deletion.');
  await assertNumberedMaps(outputByKind(deleted, 'demo').page_files, scenario.pageCount);
  const finalPdfInspection = await callTool(client, 'toolknit_pdf_inspect', { input_path: pdfPath });
  assert.equal(finalPdfInspection.input.pages, scenario.pageCount);
  assert.deepEqual(deleted.diagnostics, []);

  for (const jsonPath of await jsonFiles(scenarioRoot)) {
    assert.equal((await readFile(jsonPath, 'utf8')).includes(secret), false, `Provider key leaked into ${jsonPath}`);
  }

  return {
    id: scenario.id,
    locale: scenario.locale,
    passed: true,
    conversation,
    pdf: pdfPath,
    project: projectPath,
    pages: finalPdfInspection.input.pages,
    initialImageControls: 0,
    inserted: { control: insertedNumber, anchor: anchor.number, placement: scenario.placement, source: sourceImagePath },
    deleted: { control: deletionTarget.number, text: deletionTarget.text || '', type: deletionTarget.type },
    finalRevision: finalProject.revision,
    finalControlCount: finalControls.length,
    numberedMaps: outputByKind(deleted, 'demo').page_files,
    mapDimensions,
    diagnostics: deleted.diagnostics
  };
}

await mkdir(path.dirname(outputRoot), { recursive: true });
await mkdir(outputRoot, { recursive: false });
const client = createMcpClient();
try {
  const initialized = await client.request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'toolknit-natural-language-workflow-qa', version: '1.0.0' }
  });
  assert.equal(initialized.result.serverInfo.name, 'toolknit');
  assert.match(initialized.result.instructions, /semantic target/i);
  assert.match(initialized.result.instructions, /absolute local PNG or JPEG path/i);
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
  const results = [];
  for (const scenario of scenarios) results.push(await runScenario(client, scenario));

  const report = {
    passed: true,
    provider: process.env.TOOLKNIT_AI_MODEL || 'deepseek-chat',
    userSimulations: results.length,
    workflows: results,
    progressEvents: client.notifications.filter(message => message.method === 'notifications/progress').length
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ passed: true, report: reportPath, workflows: results.map(result => ({ id: result.id, pdf: result.pdf, revision: result.finalRevision })) })}\n`);
} finally {
  await client.close();
}
