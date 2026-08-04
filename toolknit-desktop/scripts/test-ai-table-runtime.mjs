import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { generateAiTableProject, generateTableFromPrompt } from '../cli/lib/ai-table-project-runtime.mjs';
import { ToolKnitError } from '../cli/lib/errors.mjs';

const providerResponse = {
  title: '产品销售复盘表',
  summary: '按产品比较销售额。',
  columns: ['产品名称', '季度', '销售额'],
  rows: [
    ['基础版', 'Q1', 128.5],
    ['专业版', 'Q1', 96]
  ],
  charts: [{ type: 'bar', title: '产品销售额', xAxis: '产品名称', yAxis: '销售额' }]
};

let requestBody;
const fetchImpl = async (_url, options) => {
  requestBody = JSON.parse(options.body);
  const prompt = String(requestBody.messages.at(-1)?.content || '');
  const table = prompt.includes('sheet-name-collision')
    ? { ...providerResponse, title: 'Charts' }
    : providerResponse;
  return {
    ok: true,
    headers: { get: () => null },
    text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(table) } }] })
  };
};
const env = {
  DEEPSEEK_API_KEY: 'toolknit-runtime-regression-key',
  TOOLKNIT_AI_API_URL: 'https://api.example.test/v1/chat/completions',
  TOOLKNIT_AI_MODEL: 'toolknit-runtime-regression-model'
};

async function assertPreviewContainsChart(previewPath) {
  const image = await loadImage(previewPath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const startY = Math.floor(image.height * 0.38);
  const pixels = ctx.getImageData(24, startY, image.width - 48, image.height - startY - 24).data;
  let visibleChartPixels = 0;
  for (let index = 0; index < pixels.length; index += 16) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const alpha = pixels[index + 3];
    if (alpha > 0 && (red < 235 || green < 235 || blue < 235)) visibleChartPixels += 1;
  }
  assert.ok(visibleChartPixels > 100, 'Generated preview chart area is blank.');
}

const normalized = await generateTableFromPrompt('生成产品销售复盘表。', { locale: 'zh-CN', env, fetchImpl });
assert.equal(normalized.ready, true);
assert.equal(normalized.columns[2].type, 'number');
assert.deepEqual(normalized.charts[0].valueColumns, [2]);
assert.match(requestBody.messages[0].content, /Never return columns as a string array/);
assert.match(requestBody.messages[0].content, /Never use xAxis, yAxis, data/);

await assert.rejects(
  generateTableFromPrompt('生成表格。', {
    locale: 'zh-CN',
    env: { DEEPSEEK_API_KEY: '你的 DeepSeek Key' },
    fetchImpl
  }),
  error => error instanceof ToolKnitError && error.code === 'ENGINE_UNAVAILABLE'
);

const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'toolknit-ai-table-runtime-'));
try {
  const outputPath = path.join(outputRoot, '产品销售复盘表.xlsx');
  const result = await generateAiTableProject({
    prompt: '生成产品销售复盘表。',
    output_path: outputPath,
    format: 'xlsx',
    locale: 'zh-CN',
    overwrite: false
  }, { env, fetchImpl });
  assert.equal(result.ready, true);
  assert.ok((await stat(outputPath)).size > 1000);
  assert.ok((await stat(result.project.path)).size > 100);
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile(outputPath));
  const chartsSheet = workbook.getWorksheet('Charts');
  assert.ok(chartsSheet, 'XLSX export is missing the Charts sheet.');
  assert.equal(chartsSheet.getImages().length, 1, 'XLSX export is missing the embedded chart image.');
  const preview = result.outputs.find(output => output.kind === 'preview');
  assert.ok(preview?.path);
  await assertPreviewContainsChart(preview.path);

  const collisionPath = path.join(outputRoot, 'Charts.xlsx');
  await generateAiTableProject({
    prompt: 'sheet-name-collision',
    output_path: collisionPath,
    format: 'xlsx',
    locale: 'en',
    overwrite: false
  }, { env, fetchImpl });
  const collisionWorkbook = new ExcelJS.Workbook();
  await collisionWorkbook.xlsx.load(await readFile(collisionPath));
  assert.ok(collisionWorkbook.getWorksheet('Charts'), 'XLSX export is missing the table sheet.');
  assert.ok(collisionWorkbook.getWorksheet('Charts 2'), 'XLSX export did not avoid a duplicate chart sheet name.');
} finally {
  await rm(outputRoot, { recursive: true, force: true });
}

console.log('AI table runtime regression checks passed');
