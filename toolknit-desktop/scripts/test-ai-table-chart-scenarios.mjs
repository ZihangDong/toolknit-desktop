import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import pdfLibPlusEncrypt from 'pdf-lib-plus-encrypt';
import {
  editAiTableProject,
  generateAiTableProject,
  generateTableFromPrompt,
  inspectAiTableProjectFile,
  renderAiTableProject
} from '../cli/lib/ai-table-project-runtime.mjs';

const { PDFDocument } = pdfLibPlusEncrypt;

const env = {
  DEEPSEEK_API_KEY: 'toolknit-chart-scenario-test',
  TOOLKNIT_AI_API_URL: 'https://api.example.test/v1/chat/completions',
  TOOLKNIT_AI_MODEL: 'toolknit-chart-scenario-model'
};

const providerTables = {
  'scenario-multi-xlsx': {
    ready: true,
    title: 'Multi chart regression',
    summary: 'Bar, line, and pie charts share one editable data table.',
    columns: [
      { key: 'segment', label: 'Segment', type: 'text' },
      { key: 'revenue', label: 'Revenue', type: 'number' },
      { key: 'cost', label: 'Cost', type: 'number' }
    ],
    rows: [
      ['North', 120, 72],
      ['South', 95, 61],
      ['East', 145, 88],
      ['West', 108, 70]
    ],
    charts: [
      { type: 'bar', title: 'Revenue and cost', labelColumn: 0, valueColumns: [1, 2] },
      { type: 'line', title: 'Revenue trend', labelColumn: 0, valueColumns: [1] },
      { type: 'pie', title: 'Revenue mix', labelColumn: 0, valueColumns: [1] }
    ]
  },
  'scenario-pie-pdf': {
    title: 'Budget allocation',
    description: 'A loose OpenAI-compatible provider response for pie-chart PDF export.',
    columns: ['Department', 'Budget', 'Actual'],
    rows: [
      ['Research', 48, 43],
      ['Operations', 36, 32],
      ['Support', 24, 20],
      ['Marketing', 18, 17]
    ],
    charts: [{ type: 'pie', title: 'Budget allocation', xAxis: 'Department', yAxis: 'Budget' }]
  },
  'scenario-fallback-png': {
    ready: true,
    title: 'Fallback chart regression',
    summary: 'No chart is supplied by the provider, so ToolKnit should create a safe fallback.',
    columns: [
      { key: 'task', label: 'Task', type: 'text' },
      { key: 'progress', label: 'Progress', type: 'number' }
    ],
    rows: [
      ['Plan', 20],
      ['Build', 55],
      ['Verify', 80],
      ['Release', 100]
    ],
    charts: []
  },
  'scenario-loose-csv': {
    title: 'Loose CSV response',
    columns: ['Product', 'Units', 'Margin'],
    data: [
      ['Alpha', 18, 0.42],
      ['Beta', 27, 0.36],
      ['Gamma', 15, 0.31]
    ],
    charts: [{ type: 'line', title: 'Units trend', xAxis: 'Product', yAxis: 'Units' }]
  },
  'scenario-question': {
    ready: false,
    question: 'Which reporting period should the table cover?'
  }
};

const fetchImpl = async (_url, options) => {
  const request = JSON.parse(options.body);
  const prompt = String(request.messages.at(-1)?.content || '');
  const scenarioId = Object.keys(providerTables).find(key => prompt.includes(key));
  assert.ok(scenarioId, `Mock provider did not recognize prompt: ${prompt}`);
  const response = providerTables[scenarioId];
  const content = scenarioId === 'scenario-pie-pdf'
    ? `\`\`\`json\n${JSON.stringify(response)}\n\`\`\``
    : JSON.stringify(response);
  return {
    ok: true,
    headers: { get: () => null },
    text: async () => JSON.stringify({ choices: [{ message: { content } }] })
  };
};

function outputByKind(result, kind) {
  const output = result.outputs.find(item => item.kind === kind);
  assert.ok(output, `Missing ${kind} output.`);
  return output;
}

async function assertFile(pathname, minimumBytes = 64) {
  const info = await stat(pathname);
  assert.ok(info.isFile(), `Expected a file: ${pathname}`);
  assert.ok(info.size >= minimumBytes, `File is unexpectedly small: ${pathname}`);
}

async function assertPreviewContainsChart(previewPath) {
  const image = await loadImage(previewPath);
  assert.ok(image.width >= 900 && image.height >= 900, 'Preview image is unexpectedly small.');
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const chartTop = Math.min(380, image.height - 1);
  const pixels = context.getImageData(40, chartTop, image.width - 80, image.height - chartTop - 40).data;
  let visiblePixels = 0;
  for (let index = 0; index < pixels.length; index += 16) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const alpha = pixels[index + 3];
    if (alpha > 0 && (red < 230 || green < 230 || blue < 230)) visiblePixels += 1;
  }
  assert.ok(visiblePixels > 300, `Chart region is blank: ${previewPath}`);
}

async function sha256(pathname) {
  return createHash('sha256').update(await readFile(pathname)).digest('hex');
}

const question = await generateTableFromPrompt('scenario-question', { locale: 'en', env, fetchImpl });
assert.deepEqual(question, { ready: false, question: 'Which reporting period should the table cover?' });

const root = await mkdtemp(path.join(os.tmpdir(), 'toolknit-ai-table-chart-scenarios-'));
try {
  const multiPath = path.join(root, 'multi.xlsx');
  const multi = await generateAiTableProject({
    prompt: 'scenario-multi-xlsx',
    output_path: multiPath,
    format: 'xlsx',
    locale: 'en',
    overwrite: false
  }, { env, fetchImpl });
  assert.equal(multi.ready, true);
  assert.equal(multi.table.charts, 3);
  await assertFile(multiPath, 8_000);
  const multiPreview = outputByKind(multi, 'preview');
  await assertPreviewContainsChart(multiPreview.path);
  const multiWorkbook = new ExcelJS.Workbook();
  await multiWorkbook.xlsx.load(await readFile(multiPath));
  const multiChartsSheet = multiWorkbook.getWorksheet('Charts');
  assert.ok(multiChartsSheet, 'XLSX is missing its chart worksheet.');
  assert.equal(multiChartsSheet.getImages().length, 3, 'XLSX is missing one or more embedded charts.');

  const multiProjectPath = multi.project.path;
  const previewHashBeforeEdit = await sha256(multiPreview.path);
  const editOperations = [
    { type: 'update_cell', row: 'R01', column: 'C02', value: 133 },
    { type: 'update_chart', chart: 'G01', chartType: 'line', title: 'Revenue and cost trend' },
    { type: 'delete_chart', chart: 'G02' },
    { type: 'insert_chart', chart: { type: 'bar', title: 'Cost comparison', labelColumnId: 'C01', valueColumnIds: ['C03'] } }
  ];
  const dryRun = await editAiTableProject({ project_path: multiProjectPath, operations: editOperations, dry_run: true });
  assert.equal(dryRun.dry_run, true);
  assert.equal(dryRun.project.current_revision, 1);
  const committed = await editAiTableProject({ project_path: multiProjectPath, operations: editOperations, dry_run: false });
  assert.equal(committed.project.revision, 2);
  assert.notEqual(await sha256(multiPreview.path), previewHashBeforeEdit, 'Chart preview did not refresh after edit.');
  await assertPreviewContainsChart(multiPreview.path);
  const editedInspection = await inspectAiTableProjectFile({ project_path: multiProjectPath });
  assert.deepEqual(editedInspection.project.charts.map(chart => chart.number), ['G01', 'G03', 'G04']);
  assert.equal(editedInspection.project.charts.find(chart => chart.number === 'G01').type, 'line');
  const editedWorkbook = new ExcelJS.Workbook();
  await editedWorkbook.xlsx.load(await readFile(multiPath));
  assert.equal(editedWorkbook.getWorksheet('Charts').getImages().length, 3, 'Edited XLSX lost chart images.');
  const rerendered = await renderAiTableProject({ project_path: multiProjectPath });
  assert.equal(rerendered.project.revision, 2);
  await assertPreviewContainsChart(outputByKind(rerendered, 'preview').path);

  const pdfPath = path.join(root, 'pie.pdf');
  const piePdf = await generateAiTableProject({
    prompt: 'scenario-pie-pdf',
    output_path: pdfPath,
    format: 'pdf',
    locale: 'en',
    overwrite: false
  }, { env, fetchImpl });
  await assertFile(pdfPath, 4_000);
  assert.ok((await PDFDocument.load(await readFile(pdfPath))).getPageCount() >= 1, 'Pie-chart PDF has no pages.');
  await assertPreviewContainsChart(outputByKind(piePdf, 'preview').path);
  assert.equal(piePdf.table.charts, 1);

  const pngPath = path.join(root, 'fallback.png');
  const fallback = await generateAiTableProject({
    prompt: 'scenario-fallback-png',
    output_path: pngPath,
    format: 'png',
    locale: 'en',
    overwrite: false
  }, { env, fetchImpl });
  await assertFile(pngPath, 8_000);
  await assertPreviewContainsChart(outputByKind(fallback, 'preview').path);
  assert.equal(fallback.table.charts, 0, 'Fallback chart must not mutate the editable project.');

  const csvPath = path.join(root, 'loose.csv');
  const looseCsv = await generateAiTableProject({
    prompt: 'scenario-loose-csv',
    output_path: csvPath,
    format: 'csv',
    locale: 'en',
    overwrite: false
  }, { env, fetchImpl });
  await assertFile(csvPath, 40);
  const csvContents = (await readFile(csvPath, 'utf8')).replace(/^\uFEFF/, '');
  assert.match(csvContents, /^"Product","Units","Margin"\r?\n/);
  await assertPreviewContainsChart(outputByKind(looseCsv, 'preview').path);
  assert.equal(looseCsv.table.charts, 1);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('AI table multi-chart and multi-format scenarios passed');
