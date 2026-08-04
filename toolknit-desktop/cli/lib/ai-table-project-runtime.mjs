import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ToolKnitError } from './errors.mjs';

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGED_CORE_ROOT = path.join(CLI_ROOT, 'lib', 'core');
const PROJECT_SUFFIX = '.toolknit-table.json';
const DATA_SUFFIX = '.toolknit-table';
const MAX_PROJECT_BYTES = 5 * 1024 * 1024;
const MAX_EXPORT_BYTES = 50 * 1024 * 1024;
const MAX_COPY_ENTRIES = 5000;

async function importCore(fileName) {
  const stagedPath = path.join(STAGED_CORE_ROOT, fileName);
  try {
    await readFile(stagedPath);
    return import(pathToFileURL(stagedPath).href);
  } catch {
    return import(new URL(`../../src/${fileName}`, import.meta.url));
  }
}

const [tableProjectCore, tableCore, providerCore] = await Promise.all([
  importCore('ai-table-project-core.js'),
  importCore('ai-table-core.js'),
  importCore('ai-provider-core.js')
]);

const {
  AI_TABLE_PROJECT_SCHEMA,
  AI_TABLE_PROJECT_REVISION_SCHEMA,
  applyAiTableProjectOperations,
  cloneAiTableProject,
  createAiTableProjectFromData,
  ensureAiTableFallbackCharts,
  inspectAiTableProject,
  normalizeAiTableProject,
  projectToAiTableData
} = tableProjectCore;
const {
  AI_TABLE_LIMITS,
  AiTableDataError,
  isAiTableResponseReady,
  makeAiTableCsv,
  normalizeAiTableSheetName,
  normalizeAiTableData,
  parseAiTableNumber,
  safeSpreadsheetCellValue
} = tableCore;
const { AiProviderError, isPlaceholderAiApiKey, requestAiCompletion } = providerCore;

const FILE_BUSY_ERROR_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);
const PUBLISH_RETRY_DELAYS_MS = [100, 250, 500];

function assertObject(value, label = 'arguments') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolKnitError('INVALID_ARGUMENT', `${label} must be an object.`);
  }
}

function assertOnlyKeys(value, keys) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new ToolKnitError('INVALID_ARGUMENT', `Unknown argument: ${key}`);
  }
}

function assertString(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new ToolKnitError('INVALID_ARGUMENT', `${label} must be a non-empty string.`);
  }
  return value.trim();
}

function isFileBusyError(error) {
  return FILE_BUSY_ERROR_CODES.has(error?.code);
}

function waitFor(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function renameWithRetry(source, target) {
  let lastError;
  for (let attempt = 0; attempt <= PUBLISH_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (!isFileBusyError(error) || attempt === PUBLISH_RETRY_DELAYS_MS.length) throw error;
      await waitFor(PUBLISH_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

async function stagedFiles(root, relativePath = '') {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw new ToolKnitError('INPUT_INVALID', `Staged table artifact contains a symbolic link: ${path.join(root, entry.name)}`);
    }
    const nextRelativePath = path.join(relativePath, entry.name);
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await stagedFiles(entryPath, nextRelativePath));
    } else if (entry.isFile()) {
      files.push({ source: entryPath, relativePath: nextRelativePath });
    } else {
      throw new ToolKnitError('INPUT_INVALID', `Staged table artifact contains an unsupported entry: ${entryPath}`);
    }
  }
  return files;
}

function dataFileTarget(dataPath, relativePath) {
  const root = path.resolve(dataPath);
  const target = path.resolve(root, relativePath);
  const comparableRoot = process.platform === 'win32' ? `${root}${path.sep}`.toLowerCase() : `${root}${path.sep}`;
  const comparableTarget = process.platform === 'win32' ? target.toLowerCase() : target;
  if (!comparableTarget.startsWith(comparableRoot)) {
    throw new ToolKnitError('OUTPUT_WRITE_FAILED', 'A staged table artifact escapes the project data directory.');
  }
  return target;
}

async function replaceStagedFile(source, target, backupRoot) {
  const metadata = await pathMetadata(target);
  if (metadata && (!metadata.isFile() || metadata.isSymbolicLink())) {
    throw new ToolKnitError('OUTPUT_WRITE_FAILED', `Cannot replace a non-file table artifact: ${target}`);
  }
  const backup = metadata ? path.join(backupRoot, `${randomUUID()}.backup`) : null;
  if (backup) await copyFile(target, backup);
  await mkdir(path.dirname(target), { recursive: true });
  const temporaryPath = path.join(path.dirname(target), `.toolknit-publish-${process.pid}-${randomUUID()}.tmp`);
  try {
    await copyFile(source, temporaryPath);
    await renameWithRetry(temporaryPath, target);
    return { target, backup };
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    error.toolknitTarget = target;
    throw error;
  }
}

async function restoreFallbackFiles(changes) {
  for (const change of [...changes].reverse()) {
    if (change.backup) {
      await renameWithRetry(change.backup, change.target).catch(() => {});
    } else {
      await rm(change.target, { force: true }).catch(() => {});
    }
  }
}

async function publishStageFileFallback(stage, paths) {
  const backupRoot = path.join(stage.root, `.toolknit-file-backups-${randomUUID()}`);
  const changes = [];
  try {
    await mkdir(backupRoot, { recursive: true });
    for (const file of await stagedFiles(stage.dataPath)) {
      const target = dataFileTarget(paths.dataPath, file.relativePath);
      changes.push(await replaceStagedFile(file.source, target, backupRoot));
    }
    changes.push(await replaceStagedFile(stage.exportPath, paths.exportPath, backupRoot));
    changes.push(await replaceStagedFile(stage.projectPath, paths.projectPath, backupRoot));
  } catch (error) {
    await restoreFallbackFiles(changes);
    await rm(stage.root, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  await rm(stage.root, { recursive: true, force: true }).catch(() => {});
}

async function restoreStageBackups(backups) {
  for (const backup of [...backups].reverse()) {
    await renameWithRetry(backup.backup, backup.target);
  }
}

function mapProjectError(error) {
  if (error instanceof ToolKnitError) return error;
  if (error instanceof AiTableDataError) {
    return new ToolKnitError(
      ['invalid_operation', 'invalid_project'].includes(error.code) ? 'INVALID_ARGUMENT' : 'INPUT_INVALID',
      error.message,
      { details: { projectCode: error.code, ...(error.details || {}) } }
    );
  }
  return new ToolKnitError('PROCESSING_FAILED', 'ToolKnit could not process the AI table project.');
}

export function projectPathsFromOutput(outputPath) {
  const exportPath = path.resolve(assertString(outputPath, 'output_path'));
  const extension = path.extname(exportPath).toLowerCase();
  if (!['.csv', '.xlsx', '.pdf', '.png'].includes(extension)) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'output_path must end with .csv, .xlsx, .pdf, or .png.');
  }
  const basePath = exportPath.slice(0, -extension.length);
  return {
    basePath,
    exportPath,
    format: extension.slice(1),
    projectPath: `${basePath}${PROJECT_SUFFIX}`,
    dataPath: `${basePath}${DATA_SUFFIX}`
  };
}

export function projectPathsFromJson(projectPathValue) {
  const projectPath = path.resolve(assertString(projectPathValue, 'project_path'));
  if (!projectPath.toLowerCase().endsWith(PROJECT_SUFFIX)) {
    throw new ToolKnitError('INVALID_ARGUMENT', `project_path must end with ${PROJECT_SUFFIX}.`);
  }
  const basePath = projectPath.slice(0, -PROJECT_SUFFIX.length);
  return {
    basePath,
    exportPath: `${basePath}.xlsx`,
    format: 'xlsx',
    projectPath,
    dataPath: `${basePath}${DATA_SUFFIX}`
  };
}

async function pathMetadata(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new ToolKnitError('INPUT_INVALID', `Path cannot be inspected: ${target}`);
  }
}

export async function assertAiTableOutputAvailable(outputPath, overwrite = false) {
  const paths = projectPathsFromOutput(outputPath);
  if (overwrite === true) return paths;
  const existing = [];
  for (const target of [paths.exportPath, paths.projectPath, paths.dataPath]) {
    if (await pathMetadata(target)) existing.push(target);
  }
  if (existing.length) {
    throw new ToolKnitError('OUTPUT_EXISTS', `Refusing to overwrite existing AI table artifacts: ${existing.join(', ')}`);
  }
  return paths;
}

async function readRegularFile(filePath, { maxBytes, label }) {
  const metadata = await pathMetadata(filePath);
  if (!metadata) throw new ToolKnitError('INPUT_NOT_FOUND', `${label} does not exist: ${filePath}`);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new ToolKnitError('INPUT_INVALID', `${label} must be a regular file: ${filePath}`);
  }
  if (metadata.size < 1 || metadata.size > maxBytes) {
    throw new ToolKnitError('INPUT_INVALID', `${label} has an invalid size: ${filePath}`);
  }
  return readFile(filePath);
}

async function readExportFile(filePath) {
  const metadata = await pathMetadata(filePath);
  if (!metadata) throw new ToolKnitError('INPUT_NOT_FOUND', `AI table export does not exist: ${filePath}`);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new ToolKnitError('INPUT_INVALID', `AI table export must be a regular file: ${filePath}`);
  }
  if (metadata.size < 1 || metadata.size > MAX_EXPORT_BYTES) {
    throw new ToolKnitError('INPUT_INVALID', `AI table export has an invalid size: ${filePath}`);
  }
  return readFile(filePath);
}

export async function loadAiTableProject(projectPathValue) {
  const paths = projectPathsFromJson(projectPathValue);
  try {
    const bytes = await readRegularFile(paths.projectPath, { maxBytes: MAX_PROJECT_BYTES, label: 'AI table project' });
    const project = normalizeAiTableProject(JSON.parse(bytes.toString('utf8')));
    const exportOutput = project.outputs.find(output => output.kind === 'export');
    if (exportOutput?.path) {
      paths.exportPath = path.resolve(exportOutput.path);
      paths.format = exportOutput.format || normalizeFormatFromPath(paths.exportPath);
      paths.basePath = paths.exportPath.slice(0, -path.extname(paths.exportPath).length);
    }
    return { project, paths, bytes: bytes.length };
  } catch (error) {
    if (error instanceof SyntaxError) throw new ToolKnitError('INPUT_INVALID', 'AI table project JSON is invalid.');
    throw mapProjectError(error);
  }
}

async function safeCopyTree(source, destination, state = { entries: 0 }) {
  const metadata = await pathMetadata(source);
  if (!metadata) return;
  if (metadata.isSymbolicLink()) throw new ToolKnitError('INPUT_INVALID', `Project data contains a symbolic link: ${source}`);
  state.entries += 1;
  if (state.entries > MAX_COPY_ENTRIES) throw new ToolKnitError('INPUT_INVALID', 'Project data contains too many files.');
  if (metadata.isFile()) {
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    return;
  }
  if (!metadata.isDirectory()) throw new ToolKnitError('INPUT_INVALID', `Project data contains an unsupported entry: ${source}`);
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new ToolKnitError('INPUT_INVALID', `Project data contains a symbolic link: ${path.join(source, entry.name)}`);
    await safeCopyTree(path.join(source, entry.name), path.join(destination, entry.name), state);
  }
}

function revisionRecord({ project, parentRevision, operations, changes }) {
  return {
    schema: AI_TABLE_PROJECT_REVISION_SCHEMA,
    schemaVersion: 1,
    revision: project.revision,
    parentRevision,
    createdAt: project.updatedAt,
    operations,
    changes,
    project
  };
}

function resultOutputs(paths, rendered) {
  return [
    { kind: 'export', format: rendered.exportFormat, path: paths.exportPath, bytes: rendered.exportBytes.length },
    { kind: 'project', path: paths.projectPath, revision: null },
    { kind: 'preview', path: path.join(paths.dataPath, 'preview', 'preview.png'), bytes: rendered.previewBytes.length }
  ];
}

function blockingDiagnostics(diagnostics) {
  return (diagnostics || []).filter(diagnostic => diagnostic.severity === 'error');
}

function normalizeFormatFromPath(outputPath) {
  const extension = path.extname(outputPath).toLowerCase();
  if (!extension) throw new ToolKnitError('INVALID_ARGUMENT', 'output_path must end with .csv, .xlsx, .pdf, or .png.');
  return extension.slice(1);
}

function ensureProjectOutputPaths(project, paths, format) {
  const outputs = Array.isArray(project.outputs) ? project.outputs.map(output => ({ ...output })) : [];
  const exportIndex = outputs.findIndex(output => output.kind === 'export');
  const projectIndex = outputs.findIndex(output => output.kind === 'project');
  const previewIndex = outputs.findIndex(output => output.kind === 'preview');
  const previewPath = path.join(paths.dataPath, 'preview', 'preview.png');
  const nextOutputs = [
    ...(exportIndex === -1 ? [] : [outputs[exportIndex]]),
    ...(projectIndex === -1 ? [] : [outputs[projectIndex]]),
    ...(previewIndex === -1 ? [] : [outputs[previewIndex]])
  ];
  if (exportIndex === -1) {
    nextOutputs.unshift({ kind: 'export', format, path: paths.exportPath });
  } else {
    nextOutputs[0] = { kind: 'export', format, path: paths.exportPath };
  }
  if (projectIndex === -1) {
    nextOutputs.splice(1, 0, { kind: 'project', path: paths.projectPath, revision: null });
  } else {
    nextOutputs[1] = { kind: 'project', path: paths.projectPath, revision: null };
  }
  if (previewIndex === -1) {
    nextOutputs.push({ kind: 'preview', path: previewPath });
  } else {
    nextOutputs[nextOutputs.length - 1] = { kind: 'preview', path: previewPath };
  }
  return nextOutputs;
}

function chartPalette(index) {
  const colors = ['#1f1f1f', '#4b4b4b', '#7a7a7a', '#a0a0a0'];
  return colors[index % colors.length];
}

let chartJsPromise = null;
async function getChartJs() {
  if (!chartJsPromise) {
    chartJsPromise = import('chart.js/auto').then(mod => mod.default || mod);
  }
  return chartJsPromise;
}

function truncateText(ctx, text, maxWidth) {
  const raw = String(text ?? '');
  if (ctx.measureText(raw).width <= maxWidth) return raw;
  let candidate = raw;
  while (candidate.length > 1 && ctx.measureText(`${candidate}…`).width > maxWidth) {
    candidate = candidate.slice(0, -1);
  }
  return `${candidate}…`;
}

function wrapText(ctx, text, maxWidth, maxLines = 3) {
  const raw = String(text ?? '').trim();
  if (!raw) return [];
  const lines = [];
  let current = '';
  for (const token of raw.split(/\s+/g)) {
    const candidate = current ? `${current} ${token}` : token;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = token;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length > maxLines) {
    return lines.slice(0, maxLines - 1).concat(truncateText(ctx, lines[maxLines - 1], maxWidth));
  }
  return lines;
}

function measureColumnWidths(ctx, data, contentWidth) {
  const count = data.columns.length;
  const minimum = count <= 4 ? 130 : count <= 8 ? 100 : count <= 12 ? 80 : count <= 16 ? 64 : 48;
  const maximum = count <= 4 ? 280 : count <= 8 ? 220 : count <= 12 ? 180 : count <= 16 ? 160 : 140;
  const widths = data.columns.map((column, columnIndex) => {
    const headerWidth = ctx.measureText(column.label || column.key).width;
    const cellWidth = data.rows.reduce((max, row) => Math.max(max, ctx.measureText(String(row[columnIndex] ?? '')).width), 0);
    return Math.max(minimum, Math.min(maximum, Math.ceil(Math.max(headerWidth, cellWidth) + 24)));
  });
  let total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= contentWidth) return widths;
  while (total > contentWidth) {
    const index = widths.reduce((bestIndex, width, currentIndex, array) => {
      if (width <= minimum) return bestIndex;
      if (bestIndex === -1) return currentIndex;
      return width > array[bestIndex] ? currentIndex : bestIndex;
    }, -1);
    if (index === -1) break;
    widths[index] -= 1;
    total -= 1;
  }
  return widths;
}

async function renderAiTableChartCanvas(chartDef, data, width = 960, height = 360) {
  const ChartJS = await getChartJs();
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const labelCol = chartDef.labelColumn || 0;
  const valueColumns = (chartDef.valueColumns && chartDef.valueColumns.length) ? chartDef.valueColumns : [1];
  const labels = data.rows.map((row, rowIndex) => String(row[labelCol] ?? `#${rowIndex + 1}`));
  const tickFont = { family: 'Microsoft YaHei, Noto Sans SC, sans-serif', size: 11 };
  const legendFont = { family: 'Microsoft YaHei, Noto Sans SC, sans-serif', size: 12 };
  const seriesColors = ['#1f1f1f', '#555555', '#8a8a8a', '#b5b5b5'];

  const datasets = valueColumns.map((columnIndex, seriesIndex) => {
    const color = seriesColors[seriesIndex % seriesColors.length];
    const values = data.rows.map(row => {
      const parsed = parseAiTableNumber(row[columnIndex]);
      return parsed === null ? 0 : parsed;
    });
    if (chartDef.type === 'line') {
      return {
        label: data.columns[columnIndex]?.label || data.columns[columnIndex]?.key || `Series ${seriesIndex + 1}`,
        data: values,
        borderColor: color,
        borderWidth: 2.5,
        tension: 0.35,
        fill: true,
        backgroundColor: 'rgba(0,0,0,0.08)',
        pointRadius: values.length > 18 ? 0 : 3,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: color,
        pointBorderWidth: 2
      };
    }
    return {
      label: data.columns[columnIndex]?.label || data.columns[columnIndex]?.key || `Series ${seriesIndex + 1}`,
      data: values,
      backgroundColor: color,
      borderRadius: 4,
      borderSkipped: false,
      maxBarThickness: 48
    };
  });

  const chartConfig = chartDef.type === 'pie'
    ? {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            data: data.rows.map(row => {
              const parsed = parseAiTableNumber(row[valueColumns[0]]);
              return parsed === null ? 0 : parsed;
            }),
            backgroundColor: labels.map((_, index) => chartPalette(index)),
            borderColor: '#ffffff',
            borderWidth: 3,
            hoverOffset: 6
          }]
        },
        options: {
          responsive: false,
          animation: false,
          cutout: '62%',
          plugins: {
            legend: { position: 'right', labels: { color: '#404040', font: legendFont, usePointStyle: true, pointStyle: 'circle' } },
            tooltip: { enabled: false }
          }
        }
      }
    : {
        type: chartDef.type === 'line' ? 'line' : 'bar',
        data: { labels, datasets },
        options: {
          responsive: false,
          animation: false,
          plugins: {
            legend: { display: datasets.length > 1, labels: { color: '#404040', font: legendFont, usePointStyle: true, pointStyle: 'circle' } },
            tooltip: { enabled: false }
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: '#6b6b6b', font: tickFont, maxRotation: 0, autoSkip: true } },
            y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { color: '#7b7b7b', font: tickFont, callback: value => String(value) } }
          }
        }
      };

  let chart;
  try {
    chart = new ChartJS(ctx, chartConfig);
    chart.render();
    // Chart.js clears its backing canvas during destroy(). Keep an independent
    // bitmap so the preview can release the Chart instance without losing it.
    const renderedCanvas = createCanvas(width, height);
    renderedCanvas.getContext('2d').drawImage(canvas, 0, 0);
    return renderedCanvas;
  } finally {
    chart?.destroy();
  }
}

async function buildPreviewCanvas(data) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const titleFont = 'bold 28px Microsoft YaHei, Noto Sans SC, sans-serif';
  const summaryFont = '400 16px Microsoft YaHei, Noto Sans SC, sans-serif';
  const headerFont = '700 13px Microsoft YaHei, Noto Sans SC, sans-serif';
  const rowFont = '400 12px Microsoft YaHei, Noto Sans SC, sans-serif';
  const margin = 48;
  const contentWidth = 1104;
  const chartCanvases = [];
  for (const [index, chart] of (data.charts || []).entries()) {
    try {
      chartCanvases.push({ chart, canvas: await renderAiTableChartCanvas(chart, data, contentWidth, 360) });
    } catch {
      throw new ToolKnitError('PROCESSING_FAILED', `Chart ${index + 1} could not be rendered.`);
    }
  }
  const validCharts = chartCanvases;

  const measureCanvas = createCanvas(1200, 1200);
  const measureCtx = measureCanvas.getContext('2d');
  measureCtx.textBaseline = 'top';
  measureCtx.font = titleFont;
  let totalHeight = margin;
  if (data.title) {
    const titleLines = wrapText(measureCtx, data.title, contentWidth, 2);
    totalHeight += titleLines.length * 36 + 6;
  }
  if (data.summary) {
    measureCtx.font = summaryFont;
    const summaryLines = wrapText(measureCtx, data.summary, contentWidth, 3);
    totalHeight += summaryLines.length * 24 + 14;
  }
  measureCtx.font = headerFont;
  const columnWidths = measureColumnWidths(measureCtx, data, contentWidth);
  const headerHeight = 40;
  const rowHeight = 36;
  totalHeight += headerHeight + (data.rows.length * rowHeight);
  if (validCharts.length > 0) {
    totalHeight += 28;
    totalHeight += validCharts.reduce((sum, chartArtifact) => {
      const scaledHeight = Math.round(chartArtifact.canvas.height * (contentWidth / chartArtifact.canvas.width));
      return sum + 24 + scaledHeight + 22;
    }, 0);
  }
  totalHeight += margin;

  const canvas = createCanvas(1200, Math.max(totalHeight, 1200));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#1a1a1a';
  ctx.textBaseline = 'top';
  let y = margin;

  if (data.title) {
    ctx.font = titleFont;
    const titleLines = wrapText(ctx, data.title, contentWidth, 2);
    titleLines.forEach(line => {
      const width = ctx.measureText(line).width;
      ctx.fillText(line, (canvas.width - width) / 2, y);
      y += 36;
    });
    y += 6;
  }

  if (data.summary) {
    ctx.font = summaryFont;
    const summaryLines = wrapText(ctx, data.summary, contentWidth, 3);
    summaryLines.forEach(line => {
      const width = ctx.measureText(line).width;
      ctx.fillStyle = '#5d5d5d';
      ctx.fillText(line, (canvas.width - width) / 2, y);
      y += 24;
    });
    y += 14;
    ctx.fillStyle = '#1a1a1a';
  }

  const tableLeft = margin;
  const tableTop = y;
  const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0);

  ctx.fillStyle = '#1f1f1f';
  ctx.fillRect(tableLeft, tableTop, tableWidth, headerHeight);
  let x = tableLeft;
  ctx.font = headerFont;
  ctx.fillStyle = '#ffffff';
  data.columns.forEach((column, index) => {
    const width = columnWidths[index];
    const label = truncateText(ctx, column.label || column.key, width - 16);
    ctx.fillText(label, x + 8, tableTop + 12);
    ctx.strokeStyle = '#303030';
    ctx.strokeRect(x, tableTop, width, headerHeight);
    x += width;
  });

  y += headerHeight;
  ctx.font = rowFont;
  data.rows.forEach((row, rowIndex) => {
    const rowFill = rowIndex % 2 === 1 ? '#f5f5f5' : '#ffffff';
    ctx.fillStyle = rowFill;
    ctx.fillRect(tableLeft, y, tableWidth, rowHeight);
    ctx.strokeStyle = '#d9d9d9';
    x = tableLeft;
    row.forEach((cell, columnIndex) => {
      const width = columnWidths[columnIndex];
      const column = data.columns[columnIndex];
      const text = truncateText(ctx, String(cell ?? ''), width - 16);
      ctx.fillStyle = '#262626';
      ctx.textAlign = column?.type === 'number' ? 'right' : 'left';
      ctx.fillText(text, column?.type === 'number' ? x + width - 8 : x + 8, y + 11);
      ctx.strokeRect(x, y, width, rowHeight);
      x += width;
    });
    y += rowHeight;
  });

  if (validCharts.length > 0) {
    y += 28;
    for (let index = 0; index < validCharts.length; index++) {
      const chartCanvas = validCharts[index].canvas;
      const chartTitle = validCharts[index].chart?.title || `Chart ${index + 1}`;
      ctx.textAlign = 'left';
      ctx.font = '600 16px Microsoft YaHei, Noto Sans SC, sans-serif';
      ctx.fillStyle = '#1a1a1a';
      ctx.fillText(chartTitle, margin, y);
      y += 24;
      const drawHeight = Math.round(chartCanvas.height * (contentWidth / chartCanvas.width));
      ctx.drawImage(chartCanvas, margin, y, contentWidth, drawHeight);
      y += drawHeight + 22;
    }
  }

  return canvas;
}

async function buildXlsxBuffer(data) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const tableSheetName = normalizeAiTableSheetName(data.title);
  const ws = wb.addWorksheet(tableSheetName);
  const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  const allBorders = { top: thin, left: thin, bottom: thin, right: thin };
  const measure = (value) => {
    const text = String(value == null ? '' : value);
    let width = 0;
    for (const ch of text) width += /[\u4e00-\u9fff\uff00-\uffef]/.test(ch) ? 1.8 : 1;
    return width;
  };

  let startRow = 1;
  if (data.title) {
    ws.mergeCells(1, 1, 1, data.columns.length);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = safeSpreadsheetCellValue(data.title);
    titleCell.font = { bold: true, size: 16, color: { argb: 'FF1A1A1A' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 28;
    startRow = 2;
  }
  if (data.summary) {
    ws.mergeCells(startRow, 1, startRow, data.columns.length);
    const summaryCell = ws.getCell(startRow, 1);
    summaryCell.value = safeSpreadsheetCellValue(data.summary);
    summaryCell.font = { size: 11, color: { argb: 'FF5C5C5C' } };
    summaryCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    ws.getRow(startRow).height = 24;
    startRow += 1;
  }

  const headerRow = ws.getRow(startRow);
  data.columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = safeSpreadsheetCellValue(column.label || column.key);
    cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E2E2E' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = allBorders;
  });
  headerRow.height = 22;

  data.rows.forEach((row, rowIndex) => {
    const excelRow = ws.getRow(startRow + 1 + rowIndex);
    data.columns.forEach((column, columnIndex) => {
      const cell = excelRow.getCell(columnIndex + 1);
      const value = row[columnIndex];
      cell.value = column.type === 'number' && parseAiTableNumber(value) !== null
        ? parseAiTableNumber(value)
        : safeSpreadsheetCellValue(value);
      cell.alignment = { horizontal: column.type === 'number' ? 'right' : 'left', vertical: 'middle' };
      cell.border = allBorders;
      if (rowIndex % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F6F6' } };
      }
    });
    excelRow.height = 18;
  });

  data.columns.forEach((column, columnIndex) => {
    let max = measure(column.label || column.key);
    data.rows.forEach(row => { max = Math.max(max, measure(row[columnIndex])); });
    ws.getColumn(columnIndex + 1).width = Math.min(Math.max(max + 3, 10), 40);
  });

  if (Array.isArray(data.charts) && data.charts.length > 0) {
    let chartsSheetName = 'Charts';
    if (chartsSheetName.toLocaleLowerCase() === tableSheetName.toLocaleLowerCase()) {
      chartsSheetName = 'Charts 2';
    }
    const chartsSheet = wb.addWorksheet(chartsSheetName);
    chartsSheet.views = [{ showGridLines: false }];
    for (let column = 1; column <= 12; column++) chartsSheet.getColumn(column).width = 12;
    chartsSheet.mergeCells(1, 1, 1, 12);
    const heading = chartsSheet.getCell(1, 1);
    heading.value = data.title ? `${data.title} - Charts` : 'Charts';
    heading.font = { bold: true, size: 16, color: { argb: 'FF1A1A1A' } };
    heading.alignment = { horizontal: 'center', vertical: 'middle' };
    chartsSheet.getRow(1).height = 28;

    let chartTitleRow = 3;
    for (const [index, chartDef] of data.charts.entries()) {
      const chartCanvas = await renderAiTableChartCanvas(chartDef, data, 960, 360);
      chartsSheet.mergeCells(chartTitleRow, 1, chartTitleRow, 12);
      const chartTitle = chartsSheet.getCell(chartTitleRow, 1);
      chartTitle.value = chartDef.title || `Chart ${index + 1}`;
      chartTitle.font = { bold: true, size: 12, color: { argb: 'FF262626' } };
      chartTitle.alignment = { horizontal: 'left', vertical: 'middle' };
      chartsSheet.getRow(chartTitleRow).height = 22;
      const imageId = wb.addImage({ buffer: chartCanvas.toBuffer('image/png'), extension: 'png' });
      chartsSheet.addImage(imageId, {
        tl: { col: 0, row: chartTitleRow },
        ext: { width: 960, height: 360 }
      });
      chartTitleRow += 22;
    }
    wb.views = [{ activeTab: 1 }];
  }

  return wb.xlsx.writeBuffer();
}

async function buildPdfBytesFromPreview(previewCanvas) {
  const pdfLib = await import('pdf-lib-plus-encrypt');
  const { PDFDocument } = pdfLib;
  const { createCanvas } = await import('@napi-rs/canvas');
  const pdfDoc = await PDFDocument.create();
  const pageW = 595.28;
  const pageH = 841.89;
  const margin = 32;
  const scale = (pageW - margin * 2) / previewCanvas.width;
  const sliceHeight = Math.max(1, Math.floor((pageH - margin * 2) / scale));
  let offsetY = 0;
  while (offsetY < previewCanvas.height) {
    const segmentHeight = Math.min(sliceHeight, previewCanvas.height - offsetY);
    const sliceCanvas = createCanvas(previewCanvas.width, segmentHeight);
    const sliceCtx = sliceCanvas.getContext('2d');
    sliceCtx.fillStyle = '#ffffff';
    sliceCtx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    sliceCtx.drawImage(previewCanvas, 0, offsetY, previewCanvas.width, segmentHeight, 0, 0, previewCanvas.width, segmentHeight);
    const pngBytes = sliceCanvas.toBuffer('image/png');
    const image = await pdfDoc.embedPng(pngBytes);
    const page = pdfDoc.addPage([pageW, pageH]);
    const drawWidth = pageW - margin * 2;
    const drawHeight = segmentHeight * scale;
    page.drawImage(image, { x: margin, y: pageH - margin - drawHeight, width: drawWidth, height: drawHeight });
    offsetY += segmentHeight;
  }
  return pdfDoc.save();
}

async function renderProject(project, paths, { previews = true } = {}) {
  const normalizedProject = normalizeAiTableProject(project);
  const data = ensureAiTableFallbackCharts(projectToAiTableData(normalizedProject));
  const exportFormat = normalizedProject.outputs.find(output => output.kind === 'export')?.format || paths.format;
  const previewCanvas = await buildPreviewCanvas(data);
  const previewBytes = previewCanvas.toBuffer('image/png');
  let exportBytes;
  if (exportFormat === 'csv') {
    exportBytes = Buffer.from(makeAiTableCsv(data), 'utf8');
  } else if (exportFormat === 'xlsx') {
    exportBytes = Buffer.from(await buildXlsxBuffer(data));
  } else if (exportFormat === 'png') {
    exportBytes = previewBytes;
  } else if (exportFormat === 'pdf') {
    exportBytes = Buffer.from(await buildPdfBytesFromPreview(previewCanvas));
  } else {
    throw new ToolKnitError('INVALID_ARGUMENT', `Unknown AI table export format: ${exportFormat}`);
  }
  const diagnostics = [];
  return {
    data,
    previewCanvas,
    previewBytes,
    exportBytes,
    exportFormat,
    diagnostics,
    previewArtifacts: previews ? { preview: { fileName: 'preview.png', bytes: previewBytes } } : null
  };
}

async function writeProjectStage({ project, paths, rendered, revisionRecord, preserveExisting }) {
  const parent = path.dirname(paths.projectPath);
  await mkdir(parent, { recursive: true });
  const stageRoot = path.join(parent, `.${path.basename(paths.basePath)}.${process.pid}.${randomUUID()}.toolknit-stage`);
  const stage = {
    root: stageRoot,
    exportPath: path.join(stageRoot, path.basename(paths.exportPath)),
    projectPath: path.join(stageRoot, path.basename(paths.projectPath)),
    dataPath: path.join(stageRoot, path.basename(paths.dataPath))
  };
  await mkdir(stage.dataPath, { recursive: true });
  try {
    if (preserveExisting) {
      await safeCopyTree(path.join(paths.dataPath, 'revisions'), path.join(stage.dataPath, 'revisions'));
    }
    await Promise.all([
      mkdir(path.join(stage.dataPath, 'preview'), { recursive: true }),
      mkdir(path.join(stage.dataPath, 'revisions'), { recursive: true })
    ]);
    if (revisionRecord) {
      const revisionPath = path.join(stage.dataPath, 'revisions', `revision-${String(project.revision).padStart(4, '0')}.json`);
      await writeFile(revisionPath, `${JSON.stringify(revisionRecord, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    }
    await writeFile(path.join(stage.dataPath, 'preview', 'preview.png'), rendered.previewBytes, { flag: 'wx' });
    await Promise.all([
      writeFile(stage.exportPath, rendered.exportBytes, { flag: 'wx', mode: 0o600 }),
      writeFile(stage.projectPath, `${JSON.stringify(project, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    ]);
    return stage;
  } catch (error) {
    await rm(stageRoot, { recursive: true, force: true });
    throw error;
  }
}

async function publishStage(stage, paths, overwrite) {
  const entries = [
    { source: stage.exportPath, target: paths.exportPath },
    { source: stage.projectPath, target: paths.projectPath },
    { source: stage.dataPath, target: paths.dataPath }
  ];
  const existing = [];
  for (const entry of entries) {
    const metadata = await pathMetadata(entry.target);
    if (metadata) existing.push(entry.target);
  }
  if (existing.length && !overwrite) {
    await rm(stage.root, { recursive: true, force: true });
    throw new ToolKnitError('OUTPUT_EXISTS', `Refusing to overwrite existing AI table artifacts: ${existing.join(', ')}`);
  }
  const backups = [];
  const published = [];
  let activeTarget = null;
  try {
    for (const entry of entries) {
      const metadata = await pathMetadata(entry.target);
      if (!metadata) continue;
      const backup = `${entry.target}.${process.pid}.${randomUUID()}.toolknit-backup`;
      activeTarget = entry.target;
      try {
        await renameWithRetry(entry.target, backup);
      } catch (error) {
        if (entry.target === paths.dataPath && isFileBusyError(error)) {
          await restoreStageBackups(backups);
          await publishStageFileFallback(stage, paths);
          return;
        }
        throw error;
      }
      backups.push({ target: entry.target, backup });
    }
    for (const entry of entries) {
      activeTarget = entry.target;
      await renameWithRetry(entry.source, entry.target);
      published.push(entry.target);
    }
  } catch (error) {
    for (const target of published.reverse()) await rm(target, { recursive: true, force: true }).catch(() => {});
    for (const backup of backups.reverse()) await renameWithRetry(backup.backup, backup.target).catch(() => {});
    await rm(stage.root, { recursive: true, force: true }).catch(() => {});
    if (error instanceof ToolKnitError) throw error;
    if (activeTarget && isFileBusyError(error)) {
      throw new ToolKnitError(
        'OUTPUT_WRITE_FAILED',
        `AI table artifact is open or access is denied: ${activeTarget}. Close Excel, the IDE preview, or another program using the file, then retry. Existing artifacts were restored.`,
        { details: { artifact: activeTarget, reason: 'file_in_use_or_access_denied', retryable: true } }
      );
    }
    throw new ToolKnitError('OUTPUT_WRITE_FAILED', 'AI table artifacts could not be published. Existing artifacts were restored.');
  }
  await rm(stage.root, { recursive: true, force: true }).catch(() => {});
  for (const backup of backups) await rm(backup.backup, { recursive: true, force: true }).catch(() => {});
}

export async function createAiTableProjectArtifacts({ data, outputPath, locale, format, overwrite, reportProgress }) {
  const paths = await assertAiTableOutputAvailable(outputPath, overwrite === true);
  const project = createAiTableProjectFromData(data, { locale, title: data.title, summary: data.summary });
  project.outputs = ensureProjectOutputPaths(project, paths, format || paths.format);
  reportProgress?.(50, 'Created the editable ToolKnit table project.');
  const rendered = await renderProject(project, paths);
  reportProgress?.(75, 'Rendered the table preview and export file.');
  const record = revisionRecord({ project, parentRevision: null, operations: [{ type: 'create' }], changes: [] });
  const stage = await writeProjectStage({ project, paths, rendered, revisionRecord: record, preserveExisting: false });
  await publishStage(stage, paths, overwrite === true);
  reportProgress?.(95, 'Published the editable table project and its artifacts.');
  const outputs = resultOutputs(paths, rendered);
  outputs.find(output => output.kind === 'project').revision = project.revision;
  return { project, paths, rendered, outputs };
}

export async function inspectAiTableProjectFile(argsValue) {
  assertObject(argsValue);
  assertOnlyKeys(argsValue, new Set(['project_path']));
  const loaded = await loadAiTableProject(assertString(argsValue.project_path, 'project_path'));
  const inspection = inspectAiTableProject(loaded.project);
  return {
    tool: 'ai.table.inspect',
    project: { path: loaded.paths.projectPath, bytes: loaded.bytes, ...inspection.project },
    table: inspection.table,
    artifacts: {
      export: loaded.paths.exportPath,
      preview: path.join(loaded.paths.dataPath, 'preview', 'preview.png'),
      revisions: path.join(loaded.paths.dataPath, 'revisions')
    }
  };
}

async function loadRevisionProject(loaded, revision) {
  const revisionPath = path.join(loaded.paths.dataPath, 'revisions', `revision-${String(revision).padStart(4, '0')}.json`);
  const bytes = await readRegularFile(revisionPath, { maxBytes: MAX_PROJECT_BYTES * 2, label: 'AI table revision' });
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    const project = normalizeAiTableProject(value.project);
    if (project.projectId !== loaded.project.projectId || project.revision !== revision) {
      throw new ToolKnitError('INPUT_INVALID', 'AI table revision does not belong to this project.');
    }
    return project;
  } catch (error) {
    if (error instanceof ToolKnitError) throw error;
    throw mapProjectError(error instanceof SyntaxError ? new ToolKnitError('INPUT_INVALID', 'AI table revision JSON is invalid.') : error);
  }
}

export async function editAiTableProject(argsValue, options = {}) {
  assertObject(argsValue);
  assertOnlyKeys(argsValue, new Set(['project_path', 'operations', 'dry_run']));
  if (!Array.isArray(argsValue.operations) || argsValue.operations.length === 0) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'operations must be a non-empty array.');
  }
  if (argsValue.dry_run !== undefined && typeof argsValue.dry_run !== 'boolean') {
    throw new ToolKnitError('INVALID_ARGUMENT', 'dry_run must be true or false.');
  }
  const loaded = await loadAiTableProject(assertString(argsValue.project_path, 'project_path'));
  const now = new Date().toISOString();
  const reportProgress = typeof options.reportProgress === 'function' ? options.reportProgress : () => {};
  reportProgress(10, 'Loaded and validated the editable table project.');

  try {
    let editedProject;
    let changes;
    if (argsValue.operations.length === 1 && argsValue.operations[0]?.type === 'undo') {
      const steps = argsValue.operations[0].steps === undefined ? 1 : argsValue.operations[0].steps;
      if (!Number.isSafeInteger(steps) || steps < 1 || steps >= loaded.project.revision) {
        throw new ToolKnitError('INVALID_ARGUMENT', 'undo steps must target an available earlier revision.');
      }
      const targetRevision = loaded.project.revision - steps;
      const restored = await loadRevisionProject(loaded, targetRevision);
      editedProject = normalizeAiTableProject({ ...restored, revision: loaded.project.revision + 1, updatedAt: now });
      changes = [{ type: 'undo', fromRevision: loaded.project.revision, restoredRevision: targetRevision }];
    } else {
      if (argsValue.operations.some(operation => operation?.type === 'undo')) {
        throw new ToolKnitError('INVALID_ARGUMENT', 'undo must be the only operation in an edit request.');
      }
      const applied = applyAiTableProjectOperations(loaded.project, argsValue.operations, { now });
      editedProject = applied.project;
      changes = applied.changes;
    }
    reportProgress(35, 'Applied the operations atomically.');
    editedProject.outputs = ensureProjectOutputPaths(editedProject, loaded.paths, loaded.project.outputs.find(output => output.kind === 'export')?.format || loaded.paths.format);
    const rendered = await renderProject(editedProject, loaded.paths);
    reportProgress(70, 'Validated the table preview and export artifacts.');
    if (argsValue.dry_run === true) {
      return {
        tool: 'ai.table.edit',
        dry_run: true,
        project: { path: loaded.paths.projectPath, current_revision: loaded.project.revision, proposed_revision: editedProject.revision },
        changes,
        diagnostics: rendered.diagnostics
      };
    }
    const blocking = blockingDiagnostics(rendered.diagnostics);
    if (blocking.length) {
      throw new ToolKnitError('INVALID_ARGUMENT', 'The proposed edit has blocking diagnostics. Run dry_run and correct them before committing.', {
        details: { diagnostics: blocking }
      });
    }
    const record = revisionRecord({
      project: editedProject,
      parentRevision: loaded.project.revision,
      operations: argsValue.operations,
      changes
    });
    const stage = await writeProjectStage({
      project: editedProject,
      paths: loaded.paths,
      rendered,
      revisionRecord: record,
      preserveExisting: true
    });
    await publishStage(stage, loaded.paths, true);
    reportProgress(95, 'Published the new revision and refreshed artifacts.');
    const outputs = resultOutputs(loaded.paths, rendered);
    outputs.find(output => output.kind === 'project').revision = editedProject.revision;
    return {
      tool: 'ai.table.edit',
      dry_run: false,
      project: { path: loaded.paths.projectPath, revision: editedProject.revision, previous_revision: loaded.project.revision },
      changes,
      diagnostics: rendered.diagnostics,
      outputs
    };
  } catch (error) {
    throw mapProjectError(error);
  }
}

export async function renderAiTableProject(argsValue, options = {}) {
  assertObject(argsValue);
  assertOnlyKeys(argsValue, new Set(['project_path']));
  const loaded = await loadAiTableProject(assertString(argsValue.project_path, 'project_path'));
  const reportProgress = typeof options.reportProgress === 'function' ? options.reportProgress : () => {};
  reportProgress(15, 'Loaded and validated the editable table project.');
  const rendered = await renderProject(loaded.project, loaded.paths);
  const blocking = blockingDiagnostics(rendered.diagnostics);
  if (blocking.length) {
    throw new ToolKnitError('INPUT_INVALID', 'The project has blocking diagnostics and was not rendered.', {
      details: { diagnostics: blocking }
    });
  }
  reportProgress(75, 'Rendered the table preview and export file.');
  const stage = await writeProjectStage({
    project: loaded.project,
    paths: loaded.paths,
    rendered,
    revisionRecord: null,
    preserveExisting: true
  });
  await publishStage(stage, loaded.paths, true);
  reportProgress(95, 'Refreshed the table artifacts.');
  const outputs = resultOutputs(loaded.paths, rendered);
  outputs.find(output => output.kind === 'project').revision = loaded.project.revision;
  return {
    tool: 'ai.table.render',
    project: { path: loaded.paths.projectPath, revision: loaded.project.revision },
    diagnostics: rendered.diagnostics,
    outputs
  };
}

export async function generateAiTableProject(argsValue, options = {}) {
  assertObject(argsValue);
  assertOnlyKeys(argsValue, new Set(['prompt', 'output_path', 'format', 'locale', 'overwrite']));
  if (typeof argsValue.prompt !== 'string' || !argsValue.prompt.trim()) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'prompt must be a non-empty string.');
  }
  const prompt = argsValue.prompt.trim();
  if (prompt.length > AI_TABLE_LIMITS.maxPromptChars) {
    throw new ToolKnitError('INVALID_ARGUMENT', `prompt exceeds the ${AI_TABLE_LIMITS.maxPromptChars}-character limit.`);
  }
  if (typeof argsValue.output_path !== 'string' || !argsValue.output_path.trim()) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'output_path must be a non-empty export path.');
  }
  const locale = argsValue.locale === undefined ? 'zh-CN' : argsValue.locale;
  if (locale !== 'zh-CN' && locale !== 'en') {
    throw new ToolKnitError('INVALID_ARGUMENT', 'locale must be zh-CN or en.');
  }
  if (argsValue.format !== undefined && !['csv', 'xlsx', 'pdf', 'png'].includes(argsValue.format)) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'format must be csv, xlsx, pdf, or png.');
  }
  if (argsValue.overwrite !== undefined && typeof argsValue.overwrite !== 'boolean') {
    throw new ToolKnitError('INVALID_ARGUMENT', 'overwrite must be true or false.');
  }
  const paths = projectPathsFromOutput(argsValue.output_path);
  if (argsValue.format && argsValue.format !== paths.format) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'format must match the output_path extension.');
  }
  const reportProgress = typeof options.reportProgress === 'function' ? options.reportProgress : () => {};
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  reportProgress(5, 'Validated the table request.');
  const project = await generateTableFromPrompt(prompt, { locale, reportProgress, env, fetchImpl });
  if (!project.ready) {
    return {
      tool: 'ai.table.generate',
      ready: false,
      question: project.question
    };
  }
  reportProgress(45, 'Normalized the AI table response.');
  const createResult = await createAiTableProjectArtifacts({
    data: project,
    outputPath: paths.exportPath,
    locale,
    format: argsValue.format || paths.format,
    overwrite: argsValue.overwrite === true,
    reportProgress
  });
  return {
    tool: 'ai.table.generate',
    ready: true,
    project: { path: createResult.paths.projectPath, revision: createResult.project.revision },
    outputs: createResult.outputs,
    table: {
      title: createResult.project.title,
      summary: createResult.project.summary,
      columns: createResult.project.columns.length,
      rows: createResult.project.rows.length,
      charts: createResult.project.charts.length
    }
  };
}

function cleanJsonString(str) {
  return str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFEFF\uFFFD]/g, '');
}

function extractBalancedJson(str, start) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return str.substring(start, i + 1);
    }
  }
  return null;
}

function repairTruncatedJson(str) {
  const start = str.indexOf('{');
  if (start === -1) return null;
  const candidates = [];
  let stack = [];
  let inString = false;
  let escape = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { if (inString) escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') {
      stack.push(ch);
    } else if (ch === '}' || ch === ']') {
      stack.pop();
      candidates.push({ pos: i, stack: stack.slice() });
    }
  }
  for (let k = candidates.length - 1; k >= 0; k--) {
    const { pos, stack: rem } = candidates[k];
    let closing = '';
    for (let j = rem.length - 1; j >= 0; j--) {
      closing += rem[j] === '{' ? '}' : ']';
    }
    const candidate = str.substring(start, pos + 1) + closing;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

function extractJson(str) {
  if (!str || typeof str !== 'string') return null;
  try {
    JSON.parse(str.trim());
    return str.trim();
  } catch {}
  const codeBlockRegex = /```(?:json|javascript|js)?\s*\n([\s\S]*?)\n```/g;
  const matches = [];
  let match;
  while ((match = codeBlockRegex.exec(str)) !== null) {
    matches.push(match[1]);
  }
  for (const blockContent of matches) {
    const trimmed = cleanJsonString(blockContent.trim());
    try { JSON.parse(trimmed); return trimmed; } catch {}
    const start = trimmed.indexOf('{');
    if (start !== -1) {
      const result = extractBalancedJson(trimmed, start);
      if (result) {
        try { JSON.parse(result); return result; } catch {}
      }
    }
  }
  const cleaned = cleanJsonString(str.replace(/```(?:json|javascript|js)?\s*/g, '').replace(/```\s*/g, '').trim());
  try { JSON.parse(cleaned); return cleaned; } catch {}
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  const balanced = extractBalancedJson(cleaned, start);
  if (balanced) {
    try { JSON.parse(balanced); return balanced; } catch {}
  }
  const lastClose = cleaned.lastIndexOf('}');
  if (start !== -1 && lastClose > start) {
    const candidate = cleaned.substring(start, lastClose + 1);
    try { JSON.parse(candidate); return candidate; } catch {}
  }
  const repaired = repairTruncatedJson(cleaned);
  if (repaired) {
    try { JSON.parse(repaired); return repaired; } catch {}
  }
  if (balanced) return balanced;
  return null;
}

function promptAllowsHypotheticalFacts(prompt) {
  return /(?:虚构|假设数据|示例数据|模拟数据|演示数据|fictional|hypothetical|mock data|sample data)/i.test(prompt);
}

function normalizeForGrounding(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

function isNegatedOutcome(segment, index) {
  const prefix = segment.slice(Math.max(0, index - 50), index);
  return /(?:不得|不能|不可|尚未|并非|并未|没有|无需)[^。；\n]{0,40}$/i.test(prefix)
    || /\b(?:not|never|cannot|can't|isn't|is not|hasn't|has not|without)\b[^.\n]{0,40}$/i.test(prefix);
}

function ungroundedContentClaims(data, prompt) {
  if (promptAllowsHypotheticalFacts(prompt)) return [];
  const grounded = normalizeForGrounding(prompt);
  const claims = [];
  const seen = new Set();
  const addClaim = (kind, value, location) => {
    const normalized = normalizeForGrounding(value);
    if (!normalized || grounded.includes(normalized)) return;
    const key = `${location.field}:${kind}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push({ kind, value, ...location });
  };
  const segments = [
    { value: data.title, field: 'title' },
    { value: data.summary, field: 'summary' },
    ...data.columns.flatMap((column, index) => [
      { value: column.label || column.key || '', field: `column-${index + 1}-label` }
    ]),
    ...data.rows.flatMap((row, rowIndex) => row.map((cell, columnIndex) => ({
      value: String(cell ?? ''),
      field: `row-${rowIndex + 1}-col-${columnIndex + 1}`
    })))
  ];
  for (const item of segments) {
    const segment = item.value || '';
    for (const match of segment.matchAll(/(?:20\d{2}[-/.]\d{1,2}(?:[-/.]\d{1,2})?|20\d{2}年\d{1,2}月(?:\d{1,2}日)?)/g)) {
      addClaim('date', match[0], item);
    }
    for (const match of segment.matchAll(/\bv?\d+\.\d+\.\d+(?:\.\d+)?\b/gi)) addClaim('version', match[0], item);
    for (const match of segment.matchAll(/\bv\d+\.\d+(?:\.\d+)?\b/gi)) addClaim('version', match[0], item);
    for (const pattern of [
      /(?:全部|所有|各项|均)[^。；\n]{0,20}(?:通过|达标|合格)/g,
      /(?:已|均|成功)[^。；\n]{0,12}(?:通过验收|通过测试|达到验收标准)/g,
      /(?:可投入生产(?:使用)?|具备(?:上线|发布|生产)条件|未发现[^。；\n]{0,16}(?:问题|缺陷|风险|阻塞))/g,
      /(?:all (?:tests|checks)[^.\n]{0,20}pass(?:ed)?|production[- ]ready|ready for production|acceptance[^.\n]{0,12}pass(?:ed)?)/gi
    ]) {
      for (const match of segment.matchAll(pattern)) {
        if (!isNegatedOutcome(segment, match.index)) addClaim('unverified_outcome', match[0], item);
      }
    }
  }
  return claims;
}

function sanitizeUngroundedClaims(data, claims, locale) {
  const replacementFor = kind => kind === 'unverified_outcome'
    ? (locale === 'en' ? 'Acceptance status: not provided' : '验收状态：待确认')
    : (locale === 'en' ? 'Not provided' : '待确认');
  const cloned = {
    ...data,
    columns: data.columns.map(column => ({ ...column })),
    rows: data.rows.map(row => [...row]),
    charts: data.charts.map(chart => ({ ...chart, valueColumns: [...chart.valueColumns] }))
  };
  for (const claim of claims) {
    const current = claim.field === 'title'
      ? cloned.title
      : claim.field === 'summary'
        ? cloned.summary
        : null;
    if (claim.field === 'title' && typeof current === 'string' && current.includes(claim.value)) {
      cloned.title = current.split(claim.value).join(replacementFor(claim.kind));
    } else if (claim.field === 'summary' && typeof current === 'string' && current.includes(claim.value)) {
      cloned.summary = current.split(claim.value).join(replacementFor(claim.kind));
    }
  }
  return cloned;
}

function tableGenerationSystemPrompt({ locale, retry = false }) {
  const language = locale === 'en' ? 'English' : 'Simplified Chinese';
  return `You are ToolKnit's professional table and chart engine.
Create a polished table response in ${language} from the user's brief.

Hard requirements:
- Return one raw JSON object only. Do not use markdown fences or explanatory text.
- The object must be {"ready":true,"title":"...","summary":"...","columns":[...],"rows":[...],"charts":[...]} or {"ready":false,"question":"..."}.
- columns must contain between 1 and ${AI_TABLE_LIMITS.maxColumns} items.
- rows must contain between 1 and ${AI_TABLE_LIMITS.maxRows} items.
- Do not exceed ${AI_TABLE_LIMITS.maxCharts} charts.
- Every columns item MUST be an object in exactly this form: {"key":"lowercase_identifier","label":"visible column name","type":"text"|"number"|"date"}. Never return columns as a string array.
- Every rows item MUST be an array whose values follow the columns array in the same order. Do not return row objects.
- Every charts item MUST be {"type":"bar"|"line"|"pie","title":"...","labelColumn":0,"valueColumns":[1]}. labelColumn and valueColumns use zero-based column indexes. Never use xAxis, yAxis, data, labels, datasets, or column names in a chart definition.
- Use only text, number, and date column types. A chart valueColumns entry must point to a number column; pie charts use one value column.
- Exact valid example: {"ready":true,"title":"Product sales","summary":"Quarterly comparison","columns":[{"key":"product","label":"Product","type":"text"},{"key":"sales","label":"Sales","type":"number"}],"rows":[["A",128.5],["B",96]],"charts":[{"type":"bar","title":"Sales by product","labelColumn":0,"valueColumns":[1]}]}.
- Keep table text under the configured character limits and do not invent unsupported factual claims.
- When a requested factual field is missing, write "待确认" in Chinese or "Not provided" in English.
- If the request is incomplete, ask a single clarifying question. Ask at most two questions total.
- Do not use markdown, comments, fake citations, or explanatory prose outside JSON.
- Return data that can be normalized into a safe spreadsheet and chart preview.
${retry ? '- This is a correction attempt: preserve the requested intent and return the exact schema above, with valid JSON only.' : ''}`;
}

async function providerConfig(env) {
  const apiKey = [env.TOOLKNIT_AI_API_KEY, env.DEEPSEEK_API_KEY]
    .find(candidate => !isPlaceholderAiApiKey(candidate));
  if (!apiKey) {
    throw new ToolKnitError(
      'ENGINE_UNAVAILABLE',
      'AI provider key is missing or still a placeholder. Set DEEPSEEK_API_KEY to a real key in the ToolKnit MCP server environment, then restart the IDE.'
    );
  }
  return {
    apiKey,
    url: env.TOOLKNIT_AI_API_URL || 'https://api.deepseek.com/v1/chat/completions',
    model: env.TOOLKNIT_AI_MODEL || 'deepseek-chat'
  };
}

function retryableProviderFailure(error) {
  if (!(error instanceof AiProviderError)) return false;
  if (['network_error', 'invalid_response', 'response_too_large'].includes(error.code)) return true;
  return error.code === 'http_error' && (error.status === 429 || error.status >= 500);
}

function providerFailure(error) {
  const statusSuffix = error?.code === 'http_error' && Number.isInteger(error.status) ? ` (HTTP ${error.status})` : '';
  const message = error?.code === 'http_error' && error.status !== null && error.status < 500 && error.status !== 429
    ? `The AI provider rejected the request${statusSuffix}. Check the configured API key, model, and provider URL.`
    : `ToolKnit could not complete the AI provider request${statusSuffix}.`;
  return new ToolKnitError('PROVIDER_ERROR', message, {
    details: { stage: 'provider_request', providerCode: error?.code || 'unknown', retryable: retryableProviderFailure(error) }
  });
}

function invalidProviderTableFailure(stage, details = {}) {
  return new ToolKnitError(
    'PROVIDER_ERROR',
    'The AI provider returned a table response that does not match the ToolKnit schema after bounded correction attempts.',
    { details: { stage, retryable: false, ...details } }
  );
}

function tableSchemaCorrectionPrompt() {
  return 'Correct the previous response. Return raw JSON only with ready=true, columns as [{"key":"...","label":"...","type":"text|number|date"}], rows as arrays, and charts as [{"type":"bar|line|pie","title":"...","labelColumn":0,"valueColumns":[1]}]. Do not use string columns or xAxis/yAxis/data.';
}

async function generateTableFromPrompt(prompt, { locale, reportProgress, env = process.env, fetchImpl } = {}) {
  const provider = await providerConfig(env);
  const messages = [
    { role: 'system', content: tableGenerationSystemPrompt({ locale }) },
    { role: 'user', content: prompt }
  ];
  let content = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    reportProgress?.(15 + attempt * 8, `Generating table draft (attempt ${attempt + 1}).`);
    try {
      content = await requestAiCompletion({
        url: provider.url,
        apiKey: provider.apiKey,
        model: provider.model,
        messages,
        maxTokens: 8192,
        fetchImpl
      });
    } catch (error) {
      if (error instanceof AiProviderError) {
        if (!retryableProviderFailure(error) || attempt === 4) throw providerFailure(error);
        await waitFor(200 * (attempt + 1));
        continue;
      }
      throw error;
    }
    if (typeof content !== 'string' || !content.trim()) {
      if (attempt === 4) throw invalidProviderTableFailure('empty_response');
      messages.push({ role: 'user', content: tableSchemaCorrectionPrompt() });
      continue;
    }
    const jsonStr = extractJson(content);
    if (!jsonStr) {
      if (attempt === 4) throw invalidProviderTableFailure('json_extraction');
      messages.push({ role: 'user', content: tableSchemaCorrectionPrompt() });
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      if (attempt === 4) throw invalidProviderTableFailure('json_parse');
      messages.push({ role: 'user', content: tableSchemaCorrectionPrompt() });
      continue;
    }
    if (parsed.ready === false && parsed.question) {
      return { ready: false, question: String(parsed.question).trim() };
    }
    if (isAiTableResponseReady(parsed)) {
      try {
        const normalized = normalizeAiTableData(parsed);
        const claims = ungroundedContentClaims(normalized, prompt);
        if (claims.length > 0 && !promptAllowsHypotheticalFacts(prompt)) {
          const sanitized = sanitizeUngroundedClaims(normalized, claims, locale);
          return normalizeAiTableData(sanitized);
        }
        return normalized;
      } catch (error) {
        if (attempt === 4) {
          throw invalidProviderTableFailure('schema_validation', { tableCode: error instanceof AiTableDataError ? error.code : 'unknown' });
        }
        messages.push({ role: 'user', content: tableSchemaCorrectionPrompt() });
        continue;
      }
    }
    if (attempt === 4) throw invalidProviderTableFailure('ready_flag');
    messages.push({ role: 'user', content: tableSchemaCorrectionPrompt() });
  }
  throw new ToolKnitError('PROCESSING_FAILED', 'ToolKnit could not complete the AI table request.');
}

export async function loadAiTableExportBytes(exportPath) {
  return readExportFile(exportPath);
}

export {
  generateTableFromPrompt,
  renderProject,
  normalizeFormatFromPath
};
