import { randomUUID } from 'node:crypto';
import {
  AI_TABLE_LIMITS,
  AiTableDataError,
  cloneAiTableData,
  normalizeAiTableData,
  parseAiTableNumber
} from './ai-table-core.js';

export const AI_TABLE_PROJECT_SCHEMA = 'toolknit.ai-table';
export const AI_TABLE_PROJECT_REVISION_SCHEMA = 'toolknit.ai-table.revision';

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cleanString(value, maxLength, fieldName) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new AiTableDataError('invalid_project', `${fieldName} must be a string.`);
  }
  if (value.length > maxLength) {
    throw new AiTableDataError('table_too_large', `${fieldName} exceeds its allowed length.`);
  }
  return value.replace(/\u0000/g, '').trim();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function makeStableNumber(prefix, index) {
  return `${prefix}${pad2(index + 1)}`;
}

function generateId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function normalizeLocale(value) {
  return value === 'en' ? 'en' : 'zh-CN';
}

function normalizeType(value) {
  return value === 'number' || value === 'date' ? value : 'text';
}

function normalizeSheetCellValue(value, type) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > AI_TABLE_LIMITS.maxAbsoluteNumber) {
      throw new AiTableDataError('invalid_project', 'A table number is outside the supported range.');
    }
    return type === 'number' ? value : String(value);
  }
  if (typeof value === 'boolean') {
    return type === 'number' ? (value ? 1 : 0) : String(value);
  }
  if (typeof value !== 'string') {
    throw new AiTableDataError('invalid_project', 'A table cell must contain only text, a number, or a boolean.');
  }
  const text = cleanString(value, AI_TABLE_LIMITS.maxCellChars, 'A table cell');
  if (type !== 'number' || text === '') return text;
  const number = parseAiTableNumber(text);
  if (number === null) {
    throw new AiTableDataError('invalid_project', 'A number column cell must contain a numeric value.');
  }
  return number;
}

function cloneOutputs(outputs) {
  return Array.isArray(outputs) ? outputs.map(output => ({ ...output })) : [];
}

export function cloneAiTableProject(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw new AiTableDataError('invalid_project', 'The AI table project is invalid.');
  }
  return {
    ...project,
    columns: Array.isArray(project.columns) ? project.columns.map(column => ({ ...column })) : [],
    rows: Array.isArray(project.rows) ? project.rows.map(row => ({ ...row, values: Array.isArray(row.values) ? [...row.values] : [] })) : [],
    charts: Array.isArray(project.charts) ? project.charts.map(chart => ({ ...chart, valueColumnIds: Array.isArray(chart.valueColumnIds) ? [...chart.valueColumnIds] : [] })) : [],
    outputs: cloneOutputs(project.outputs)
  };
}

function normalizeOutputEntry(output, index) {
  if (!isPlainObject(output)) {
    throw new AiTableDataError('invalid_project', `Output ${index + 1} is invalid.`);
  }
  const kind = cleanString(output.kind, 40, 'Output kind') || 'export';
  const path = cleanString(output.path, 2048, 'Output path');
  if (!path) {
    throw new AiTableDataError('invalid_project', `Output ${index + 1} is missing a path.`);
  }
  const normalized = { kind, path };
  if (typeof output.format === 'string' && output.format.trim()) normalized.format = output.format.trim();
  if (Number.isInteger(output.revision) && output.revision > 0) normalized.revision = output.revision;
  return normalized;
}

function normalizeColumn(column, index, usedIds, usedNumbers, usedKeys) {
  if (!isPlainObject(column)) {
    throw new AiTableDataError('invalid_project', `Column ${index + 1} is invalid.`);
  }
  const id = cleanString(column.id, 120, 'Column id') || generateId('column');
  if (usedIds.has(id)) throw new AiTableDataError('invalid_project', `Column ${index + 1} has a duplicate id.`);
  usedIds.add(id);

  const number = cleanString(column.number, 40, 'Column number') || makeStableNumber('C', index);
  if (usedNumbers.has(number)) throw new AiTableDataError('invalid_project', `Column ${index + 1} has a duplicate number.`);
  usedNumbers.add(number);

  const candidateKey = typeof column.key === 'string' ? column.key.trim().toLowerCase() : '';
  const key = /^[a-z][a-z0-9_]{0,63}$/.test(candidateKey) ? candidateKey : `col_${index + 1}`;
  if (usedKeys.has(key)) throw new AiTableDataError('invalid_project', `Column ${index + 1} has a duplicate key.`);
  usedKeys.add(key);

  return {
    id,
    number,
    key,
    label: cleanString(column.label || key, 80, 'Column label') || key,
    type: normalizeType(column.type)
  };
}

function normalizeRow(row, index, columns, usedIds, usedNumbers) {
  if (!isPlainObject(row)) {
    throw new AiTableDataError('invalid_project', `Row ${index + 1} is invalid.`);
  }
  const id = cleanString(row.id, 120, 'Row id') || generateId('row');
  if (usedIds.has(id)) throw new AiTableDataError('invalid_project', `Row ${index + 1} has a duplicate id.`);
  usedIds.add(id);

  const number = cleanString(row.number, 40, 'Row number') || makeStableNumber('R', index);
  if (usedNumbers.has(number)) throw new AiTableDataError('invalid_project', `Row ${index + 1} has a duplicate number.`);
  usedNumbers.add(number);

  const values = Array.isArray(row.values) ? row.values : [];
  if (values.length > columns.length) {
    throw new AiTableDataError('invalid_project', `Row ${index + 1} has too many cell values.`);
  }
  return {
    id,
    number,
    values: columns.map((column, columnIndex) => normalizeSheetCellValue(values[columnIndex], column.type))
  };
}

function resolveColumnIndex(project, ref) {
  const columns = project.columns || [];
  if (Number.isSafeInteger(ref) && ref >= 0 && ref < columns.length) return ref;
  const text = cleanString(typeof ref === 'string' ? ref : '', 120, 'Column reference');
  if (!text) throw new AiTableDataError('invalid_project', 'A column reference is required.');
  const exactMatches = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) =>
      column.id === text
      || column.number === text
      || column.key === text.toLowerCase()
      || column.label === text
      || column.label?.toLowerCase?.() === text.toLowerCase()
    );
  if (exactMatches.length === 1) return exactMatches[0].index;
  if (exactMatches.length > 1) {
    throw new AiTableDataError('invalid_project', `Column reference "${text}" is ambiguous.`);
  }
  const labelMatches = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => column.label && column.label.toLowerCase() === text.toLowerCase());
  if (labelMatches.length === 1) return labelMatches[0].index;
  if (labelMatches.length > 1) {
    throw new AiTableDataError('invalid_project', `Column reference "${text}" is ambiguous.`);
  }
  throw new AiTableDataError('invalid_project', `Column reference not found: ${text}`);
}

function resolveRowIndex(project, ref) {
  const rows = project.rows || [];
  if (Number.isSafeInteger(ref) && ref >= 0 && ref < rows.length) return ref;
  const text = cleanString(typeof ref === 'string' ? ref : '', 120, 'Row reference');
  if (!text) throw new AiTableDataError('invalid_project', 'A row reference is required.');
  const exactMatches = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.id === text || row.number === text || row.number?.toLowerCase?.() === text.toLowerCase());
  if (exactMatches.length === 1) return exactMatches[0].index;
  if (exactMatches.length > 1) {
    throw new AiTableDataError('invalid_project', `Row reference "${text}" is ambiguous.`);
  }
  throw new AiTableDataError('invalid_project', `Row reference not found: ${text}`);
}

function resolveChartIndex(project, ref) {
  const charts = project.charts || [];
  if (Number.isSafeInteger(ref) && ref >= 0 && ref < charts.length) return ref;
  const text = cleanString(typeof ref === 'string' ? ref : '', 120, 'Chart reference');
  if (!text) throw new AiTableDataError('invalid_project', 'A chart reference is required.');
  const exactMatches = charts
    .map((chart, index) => ({ chart, index }))
    .filter(({ chart }) => chart.id === text || chart.number === text || chart.title?.toLowerCase?.() === text.toLowerCase());
  if (exactMatches.length === 1) return exactMatches[0].index;
  if (exactMatches.length > 1) {
    throw new AiTableDataError('invalid_project', `Chart reference "${text}" is ambiguous.`);
  }
  throw new AiTableDataError('invalid_project', `Chart reference not found: ${text}`);
}

function normalizeChart(chart, index, columns, usedIds, usedNumbers) {
  if (!isPlainObject(chart) || !['bar', 'line', 'pie'].includes(chart.type)) {
    throw new AiTableDataError('invalid_project', `Chart ${index + 1} is invalid.`);
  }
  const id = cleanString(chart.id, 120, 'Chart id') || generateId('chart');
  if (usedIds.has(id)) throw new AiTableDataError('invalid_project', `Chart ${index + 1} has a duplicate id.`);
  usedIds.add(id);

  const number = cleanString(chart.number, 40, 'Chart number') || makeStableNumber('G', index);
  if (usedNumbers.has(number)) throw new AiTableDataError('invalid_project', `Chart ${index + 1} has a duplicate number.`);
  usedNumbers.add(number);

  const labelColumnId = typeof chart.labelColumnId === 'string' && columns.some(column => column.id === chart.labelColumnId)
    ? chart.labelColumnId
    : columns[0]?.id;
  if (!labelColumnId) {
    throw new AiTableDataError('invalid_project', `Chart ${index + 1} has no label column.`);
  }

  const valueColumnIds = Array.isArray(chart.valueColumnIds)
    ? [...new Set(chart.valueColumnIds.filter(columnId =>
      typeof columnId === 'string' && columns.some(column => column.id === columnId && column.type === 'number')
    ))]
    : [];
  if (valueColumnIds.length === 0) {
    throw new AiTableDataError('invalid_project', `Chart ${index + 1} has no numeric value column.`);
  }
  return {
    id,
    number,
    type: chart.type,
    title: cleanString(chart.title, AI_TABLE_LIMITS.maxChartTitleChars, 'Chart title'),
    labelColumnId,
    valueColumnIds: chart.type === 'pie' ? valueColumnIds.slice(0, 1) : valueColumnIds.slice(0, AI_TABLE_LIMITS.maxChartSeries)
  };
}

function fallbackChartsForData(data) {
  if (!data || !Array.isArray(data.columns) || !Array.isArray(data.rows)) return data;
  if (Array.isArray(data.charts) && data.charts.length > 0) return data;
  const labelColumn = data.columns.findIndex(column => column.type !== 'number');
  const valueColumn = data.columns.findIndex(column => column.type === 'number');
  if (valueColumn === -1) return data;
  const next = cloneAiTableData(data);
  next.charts = [{
    type: 'bar',
    title: `${next.columns[valueColumn].label || next.columns[valueColumn].key} 对比`,
    labelColumn: labelColumn === -1 ? 0 : labelColumn,
    valueColumns: [valueColumn]
  }];
  return next;
}

export function ensureAiTableFallbackCharts(data) {
  return fallbackChartsForData(data);
}

export function projectToAiTableData(project) {
  if (!project || !Array.isArray(project.columns) || !Array.isArray(project.rows) || !Array.isArray(project.charts)) {
    throw new AiTableDataError('invalid_project', 'AI table project data is invalid.');
  }
  const columns = project.columns.map(column => ({
    key: column.key,
    label: column.label,
    type: column.type
  }));
  const rows = project.rows.map(row => [...row.values]);
  const columnIndexById = new Map(project.columns.map((column, index) => [column.id, index]));
  const charts = project.charts.map((chart, chartIndex) => {
    const labelColumn = columnIndexById.get(chart.labelColumnId);
    if (!Number.isInteger(labelColumn)) {
      throw new AiTableDataError('invalid_project', `Chart ${chartIndex + 1} label column is missing.`);
    }
    const valueColumns = chart.valueColumnIds.map(columnId => {
      const index = columnIndexById.get(columnId);
      if (!Number.isInteger(index)) {
        throw new AiTableDataError('invalid_project', `Chart ${chartIndex + 1} value column is missing.`);
      }
      return index;
    });
    return {
      type: chart.type,
      title: chart.title,
      labelColumn,
      valueColumns
    };
  });
  return {
    ready: true,
    title: project.title,
    summary: project.summary,
    columns,
    rows,
    charts
  };
}

function normalizeCounters(project) {
  const rowNumbers = project.rows.map(row => Number.parseInt(String(row.number).replace(/\D+/g, ''), 10)).filter(Number.isFinite);
  const columnNumbers = project.columns.map(column => Number.parseInt(String(column.number).replace(/\D+/g, ''), 10)).filter(Number.isFinite);
  const chartNumbers = project.charts.map(chart => Number.parseInt(String(chart.number).replace(/\D+/g, ''), 10)).filter(Number.isFinite);
  return {
    nextRowNumber: Number.isSafeInteger(project.nextRowNumber) && project.nextRowNumber > 0
      ? project.nextRowNumber
      : (rowNumbers.length ? Math.max(...rowNumbers) + 1 : project.rows.length + 1),
    nextColumnNumber: Number.isSafeInteger(project.nextColumnNumber) && project.nextColumnNumber > 0
      ? project.nextColumnNumber
      : (columnNumbers.length ? Math.max(...columnNumbers) + 1 : project.columns.length + 1),
    nextChartNumber: Number.isSafeInteger(project.nextChartNumber) && project.nextChartNumber > 0
      ? project.nextChartNumber
      : (chartNumbers.length ? Math.max(...chartNumbers) + 1 : project.charts.length + 1)
  };
}

export function normalizeAiTableProject(value) {
  if (!isPlainObject(value) || value.schema !== AI_TABLE_PROJECT_SCHEMA) {
    throw new AiTableDataError('invalid_project', 'AI table project schema is invalid.');
  }
  const revision = Number.isSafeInteger(value.revision) && value.revision > 0 ? value.revision : 1;
  const locale = normalizeLocale(value.locale);
  const title = cleanString(value.title, AI_TABLE_LIMITS.maxTitleChars, 'Table title');
  const summary = cleanString(value.summary, AI_TABLE_LIMITS.maxSummaryChars, 'Table summary');
  const projectId = cleanString(value.projectId, 120, 'Project id') || generateId('table');
  const createdAt = cleanString(value.createdAt, 80, 'Created at') || new Date().toISOString();
  const updatedAt = cleanString(value.updatedAt, 80, 'Updated at') || createdAt;

  if (!Array.isArray(value.columns) || value.columns.length === 0) {
    throw new AiTableDataError('invalid_project', 'AI table project does not contain columns.');
  }
  if (!Array.isArray(value.rows) || value.rows.length === 0) {
    throw new AiTableDataError('invalid_project', 'AI table project does not contain rows.');
  }
  if (value.columns.length > AI_TABLE_LIMITS.maxColumns || value.rows.length > AI_TABLE_LIMITS.maxRows) {
    throw new AiTableDataError('table_too_large', 'The table exceeds the supported row or column limit.');
  }

  const usedColumnIds = new Set();
  const usedColumnNumbers = new Set();
  const usedColumnKeys = new Set();
  const columns = value.columns.map((column, index) => normalizeColumn(column, index, usedColumnIds, usedColumnNumbers, usedColumnKeys));

  const usedRowIds = new Set();
  const usedRowNumbers = new Set();
  const rows = value.rows.map((row, index) => normalizeRow(row, index, columns, usedRowIds, usedRowNumbers));

  const usedChartIds = new Set();
  const usedChartNumbers = new Set();
  const charts = Array.isArray(value.charts)
    ? value.charts.map((chart, index) => normalizeChart(chart, index, columns, usedChartIds, usedChartNumbers))
    : [];
  if (charts.length > AI_TABLE_LIMITS.maxCharts) {
    throw new AiTableDataError('table_too_large', 'The response contains too many charts.');
  }

  const outputs = Array.isArray(value.outputs) ? value.outputs.map((output, index) => normalizeOutputEntry(output, index)) : [];
  const normalized = {
    schema: AI_TABLE_PROJECT_SCHEMA,
    schemaVersion: 1,
    projectId,
    revision,
    locale,
    title,
    summary,
    createdAt,
    updatedAt,
    columns,
    rows,
    charts,
    outputs,
    nextRowNumber: normalizeCounters({ rows, columns, charts, nextRowNumber: value.nextRowNumber, nextColumnNumber: value.nextColumnNumber, nextChartNumber: value.nextChartNumber }).nextRowNumber,
    nextColumnNumber: normalizeCounters({ rows, columns, charts, nextRowNumber: value.nextRowNumber, nextColumnNumber: value.nextColumnNumber, nextChartNumber: value.nextChartNumber }).nextColumnNumber,
    nextChartNumber: normalizeCounters({ rows, columns, charts, nextRowNumber: value.nextRowNumber, nextColumnNumber: value.nextColumnNumber, nextChartNumber: value.nextChartNumber }).nextChartNumber
  };

  try {
    const validated = normalizeAiTableData(projectToAiTableData(normalized));
    normalized.columns = normalized.columns.map((column, index) => ({
      ...column,
      key: validated.columns[index].key,
      label: validated.columns[index].label,
      type: validated.columns[index].type
    }));
    normalized.rows = normalized.rows.map((row, index) => ({
      ...row,
      values: [...validated.rows[index]]
    }));
    normalized.title = validated.title;
    normalized.summary = validated.summary;
  } catch (error) {
    if (error instanceof AiTableDataError) throw error;
    throw new AiTableDataError('invalid_project', 'AI table project data is invalid.');
  }
  return normalized;
}

export function createAiTableProjectFromData(data, { locale = 'zh-CN', title, summary } = {}) {
  const normalized = normalizeAiTableData(data);
  const project = {
    schema: AI_TABLE_PROJECT_SCHEMA,
    schemaVersion: 1,
    projectId: generateId('table'),
    revision: 1,
    locale: normalizeLocale(locale),
    title: cleanString(title ?? normalized.title, AI_TABLE_LIMITS.maxTitleChars, 'Table title'),
    summary: cleanString(summary ?? normalized.summary, AI_TABLE_LIMITS.maxSummaryChars, 'Table summary'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    columns: normalized.columns.map((column, index) => ({
      id: generateId('column'),
      number: makeStableNumber('C', index),
      key: column.key,
      label: column.label,
      type: column.type
    })),
    rows: normalized.rows.map((row, index) => ({
      id: generateId('row'),
      number: makeStableNumber('R', index),
      values: [...row]
    })),
    charts: normalized.charts.map((chart, index) => ({
      id: generateId('chart'),
      number: makeStableNumber('G', index),
      type: chart.type,
      title: chart.title,
      labelColumnId: null,
      valueColumnIds: []
    })),
    outputs: [],
    nextRowNumber: normalized.rows.length + 1,
    nextColumnNumber: normalized.columns.length + 1,
    nextChartNumber: normalized.charts.length + 1
  };
  const columnIds = project.columns.map(column => column.id);
  project.charts = normalized.charts.map((chart, index) => ({
    id: project.charts[index]?.id || generateId('chart'),
    number: project.charts[index]?.number || makeStableNumber('G', index),
    type: chart.type,
    title: chart.title,
    labelColumnId: columnIds[chart.labelColumn],
    valueColumnIds: chart.valueColumns.map(columnIndex => columnIds[columnIndex])
  }));
  return project;
}

export function inspectAiTableProject(projectValue) {
  const project = normalizeAiTableProject(projectValue);
  return {
    project: {
      schema: project.schema,
      schemaVersion: project.schemaVersion,
      projectId: project.projectId,
      revision: project.revision,
      locale: project.locale,
      title: project.title,
      summary: project.summary,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      nextRowNumber: project.nextRowNumber,
      nextColumnNumber: project.nextColumnNumber,
      nextChartNumber: project.nextChartNumber,
      columns: project.columns.map(column => ({ ...column })),
      rows: project.rows.map(row => ({ ...row, values: [...row.values] })),
      charts: project.charts.map(chart => ({ ...chart, valueColumnIds: [...chart.valueColumnIds] })),
      outputs: cloneOutputs(project.outputs)
    },
    table: projectToAiTableData(project)
  };
}

function insertAt(array, index, value) {
  array.splice(Math.max(0, Math.min(index, array.length)), 0, value);
}

function moveItem(array, fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  const [item] = array.splice(fromIndex, 1);
  array.splice(Math.max(0, Math.min(toIndex, array.length)), 0, item);
}

function normalizeInsertIndex(project, operation, kind) {
  const anchor = operation.before ?? operation.after;
  if (anchor !== undefined) {
    const index = kind === 'row'
      ? resolveRowIndex(project, anchor)
      : resolveColumnIndex(project, anchor);
    return operation.before !== undefined ? index : index + 1;
  }
  if (Number.isSafeInteger(operation.index)) {
    return Math.max(0, Math.min(operation.index, kind === 'row' ? project.rows.length : project.columns.length));
  }
  return kind === 'row' ? project.rows.length : project.columns.length;
}

function defaultRowValues(columns) {
  return columns.map(column => (column.type === 'number' ? 0 : ''));
}

function normalizeUpdateRowValues(values, columns) {
  if (!Array.isArray(values)) {
    throw new AiTableDataError('invalid_operation', 'Row values must be an array.');
  }
  if (values.length > columns.length) {
    throw new AiTableDataError('invalid_operation', 'Row values exceed the column count.');
  }
  return columns.map((column, index) => normalizeSheetCellValue(values[index], column.type));
}

function normalizeUpdateColumnValues(values, rows, columnType) {
  if (!Array.isArray(values)) {
    throw new AiTableDataError('invalid_operation', 'Column values must be an array.');
  }
  if (values.length > rows.length) {
    throw new AiTableDataError('invalid_operation', 'Column values exceed the row count.');
  }
  return rows.map((_, rowIndex) => normalizeSheetCellValue(values[rowIndex], columnType));
}

function createRow(project, values = []) {
  const row = {
    id: generateId('row'),
    number: makeStableNumber('R', project.nextRowNumber),
    values: normalizeUpdateRowValues(values, project.columns)
  };
  project.nextRowNumber += 1;
  return row;
}

function createColumn(project, column = {}) {
  const normalizedType = normalizeType(column.type);
  const columnRecord = {
    id: generateId('column'),
    number: makeStableNumber('C', project.nextColumnNumber),
    key: /^[a-z][a-z0-9_]{0,63}$/.test(typeof column.key === 'string' ? column.key.trim().toLowerCase() : '') ? column.key.trim().toLowerCase() : `col_${project.nextColumnNumber}`,
    label: cleanString(column.label || column.key || `col_${project.nextColumnNumber}`, 80, 'Column label') || `col_${project.nextColumnNumber}`,
    type: normalizedType
  };
  project.nextColumnNumber += 1;
  return columnRecord;
}

function updateChartReferencesAfterColumnDelete(project, removedColumnId) {
  project.charts = project.charts
    .map(chart => {
      const valueColumnIds = chart.valueColumnIds.filter(columnId => columnId !== removedColumnId);
      const labelColumnId = chart.labelColumnId === removedColumnId ? project.columns[0]?.id ?? null : chart.labelColumnId;
      return { ...chart, labelColumnId, valueColumnIds };
    })
    .filter(chart => chart.labelColumnId && chart.valueColumnIds.length > 0);
}

function applySingleOperation(project, operation, now) {
  if (!isPlainObject(operation) || typeof operation.type !== 'string') {
    throw new AiTableDataError('invalid_operation', 'Every operation must be an object with a type.');
  }
  switch (operation.type) {
    case 'update_title': {
      const title = cleanString(operation.title, AI_TABLE_LIMITS.maxTitleChars, 'Table title');
      const previous = project.title;
      project.title = title;
      return [{ type: 'update_title', from: previous, to: title }];
    }
    case 'update_summary': {
      const summary = cleanString(operation.summary, AI_TABLE_LIMITS.maxSummaryChars, 'Table summary');
      const previous = project.summary;
      project.summary = summary;
      return [{ type: 'update_summary', from: previous, to: summary }];
    }
    case 'update_cell': {
      const rowIndex = resolveRowIndex(project, operation.row ?? operation.row_number ?? operation.rowId ?? operation.row_id);
      const columnIndex = resolveColumnIndex(project, operation.column ?? operation.column_number ?? operation.columnId ?? operation.column_id);
      const row = project.rows[rowIndex];
      const column = project.columns[columnIndex];
      const value = normalizeSheetCellValue(operation.value, column.type);
      const previous = row.values[columnIndex];
      row.values[columnIndex] = value;
      return [{ type: 'update_cell', row: row.number, column: column.number, from: previous, to: value }];
    }
    case 'update_row': {
      const rowIndex = resolveRowIndex(project, operation.row ?? operation.row_number ?? operation.rowId ?? operation.row_id);
      const row = project.rows[rowIndex];
      if (operation.values === undefined && operation.cells === undefined) {
        throw new AiTableDataError('invalid_operation', 'update_row requires values or cells.');
      }
      const values = normalizeUpdateRowValues(operation.values ?? operation.cells, project.columns);
      const previous = [...row.values];
      row.values = values;
      return [{ type: 'update_row', row: row.number, from: previous, to: [...values] }];
    }
    case 'update_column': {
      const columnIndex = resolveColumnIndex(project, operation.column ?? operation.column_number ?? operation.columnId ?? operation.column_id);
      const column = project.columns[columnIndex];
      const previous = { ...column };
      if (operation.label !== undefined) column.label = cleanString(operation.label, 80, 'Column label') || column.label;
      if (operation.key !== undefined) {
        const candidate = cleanString(operation.key, 64, 'Column key').toLowerCase();
        if (!/^[a-z][a-z0-9_]{0,63}$/.test(candidate)) throw new AiTableDataError('invalid_operation', 'Column key is invalid.');
        const usedKeys = new Set(project.columns.map((item, index) => index === columnIndex ? null : item.key).filter(Boolean));
        if (usedKeys.has(candidate)) throw new AiTableDataError('invalid_operation', 'Column key must be unique.');
        column.key = candidate;
      }
      if (operation.columnType !== undefined) {
        const nextType = normalizeType(operation.columnType);
        if (nextType !== column.type) {
          const nextValues = project.rows.map(row => normalizeSheetCellValue(row.values[columnIndex], nextType));
          project.rows.forEach((row, rowIndex) => { row.values[columnIndex] = nextValues[rowIndex]; });
          column.type = nextType;
        }
      }
      return [{ type: 'update_column', column: column.number, from: previous, to: { ...column } }];
    }
    case 'insert_row': {
      const index = normalizeInsertIndex(project, operation, 'row');
      const row = createRow(project, operation.values ?? operation.cells ?? []);
      insertAt(project.rows, index, row);
      return [{ type: 'insert_row', row: row.number, index }];
    }
    case 'delete_row': {
      if (project.rows.length <= 1) {
        throw new AiTableDataError('invalid_operation', 'The table must keep at least one row.');
      }
      const rowIndex = resolveRowIndex(project, operation.row ?? operation.row_number ?? operation.rowId ?? operation.row_id);
      const [removed] = project.rows.splice(rowIndex, 1);
      return [{ type: 'delete_row', row: removed.number, index: rowIndex }];
    }
    case 'swap_rows': {
      const firstIndex = resolveRowIndex(project, operation.first ?? operation.row1 ?? operation.row_a);
      const secondIndex = resolveRowIndex(project, operation.second ?? operation.row2 ?? operation.row_b);
      if (firstIndex === secondIndex) return [];
      const firstNumber = project.rows[firstIndex].number;
      const secondNumber = project.rows[secondIndex].number;
      [project.rows[firstIndex], project.rows[secondIndex]] = [project.rows[secondIndex], project.rows[firstIndex]];
      return [{ type: 'swap_rows', first: firstNumber, second: secondNumber }];
    }
    case 'move_row': {
      const rowIndex = resolveRowIndex(project, operation.row ?? operation.row_number ?? operation.rowId ?? operation.row_id);
      const before = operation.before;
      const after = operation.after;
      const targetIndex = before !== undefined
        ? resolveRowIndex(project, before)
        : after !== undefined
          ? resolveRowIndex(project, after) + 1
          : Number.isSafeInteger(operation.index) ? Math.max(0, Math.min(operation.index, project.rows.length - 1)) : rowIndex;
      moveItem(project.rows, rowIndex, targetIndex);
      return [{ type: 'move_row', row: project.rows[targetIndex]?.number ?? operation.row, index: targetIndex }];
    }
    case 'sort_rows': {
      const columnIndex = resolveColumnIndex(project, operation.column ?? operation.column_number ?? operation.columnId ?? operation.column_id);
      const direction = String(operation.direction || 'asc').toLowerCase() === 'desc' ? -1 : 1;
      const column = project.columns[columnIndex];
      const collator = new Intl.Collator(project.locale === 'en' ? 'en' : 'zh', { numeric: true, sensitivity: 'base' });
      project.rows.sort((left, right) => {
        const a = left.values[columnIndex];
        const b = right.values[columnIndex];
        if (column.type === 'number') {
          const na = parseAiTableNumber(a);
          const nb = parseAiTableNumber(b);
          if (na === null && nb === null) return 0;
          if (na === null) return 1 * direction;
          if (nb === null) return -1 * direction;
          return (na - nb) * direction;
        }
        return collator.compare(String(a ?? ''), String(b ?? '')) * direction;
      });
      return [{ type: 'sort_rows', column: column.number, direction: direction === -1 ? 'desc' : 'asc' }];
    }
    case 'insert_column': {
      if (project.columns.length >= AI_TABLE_LIMITS.maxColumns) {
        throw new AiTableDataError('table_too_large', 'The table exceeds the supported column limit.');
      }
      const index = normalizeInsertIndex(project, operation, 'column');
      const columnInput = isPlainObject(operation.column) ? operation.column : {
        key: operation.key,
        label: operation.label,
        type: operation.columnType ?? operation.type
      };
      const column = createColumn(project, columnInput);
      project.columns.splice(index, 0, column);
      const normalizedValues = normalizeUpdateColumnValues(operation.values ?? [], project.rows, column.type);
      project.rows.forEach((row, rowIndex) => {
        row.values.splice(index, 0, operation.values ? normalizedValues[rowIndex] : (column.type === 'number' ? 0 : ''));
      });
      return [{ type: 'insert_column', column: column.number, index }];
    }
    case 'delete_column': {
      if (project.columns.length <= 1) {
        throw new AiTableDataError('invalid_operation', 'The table must keep at least one column.');
      }
      const columnIndex = resolveColumnIndex(project, operation.column ?? operation.column_number ?? operation.columnId ?? operation.column_id);
      const [removed] = project.columns.splice(columnIndex, 1);
      project.rows.forEach(row => row.values.splice(columnIndex, 1));
      updateChartReferencesAfterColumnDelete(project, removed.id);
      return [{ type: 'delete_column', column: removed.number, index: columnIndex }];
    }
    case 'swap_columns': {
      const firstIndex = resolveColumnIndex(project, operation.first ?? operation.column1 ?? operation.column_a);
      const secondIndex = resolveColumnIndex(project, operation.second ?? operation.column2 ?? operation.column_b);
      if (firstIndex === secondIndex) return [];
      const firstNumber = project.columns[firstIndex].number;
      const secondNumber = project.columns[secondIndex].number;
      [project.columns[firstIndex], project.columns[secondIndex]] = [project.columns[secondIndex], project.columns[firstIndex]];
      project.rows.forEach(row => {
        [row.values[firstIndex], row.values[secondIndex]] = [row.values[secondIndex], row.values[firstIndex]];
      });
      return [{ type: 'swap_columns', first: firstNumber, second: secondNumber }];
    }
    case 'move_column': {
      const columnIndex = resolveColumnIndex(project, operation.column ?? operation.column_number ?? operation.columnId ?? operation.column_id);
      const before = operation.before;
      const after = operation.after;
      const targetIndex = before !== undefined
        ? resolveColumnIndex(project, before)
        : after !== undefined
          ? resolveColumnIndex(project, after) + 1
          : Number.isSafeInteger(operation.index) ? Math.max(0, Math.min(operation.index, project.columns.length - 1)) : columnIndex;
      moveItem(project.columns, columnIndex, targetIndex);
      project.rows.forEach(row => moveItem(row.values, columnIndex, targetIndex));
      return [{ type: 'move_column', column: project.columns[targetIndex]?.number ?? operation.column, index: targetIndex }];
    }
    case 'insert_chart': {
      if (project.charts.length >= AI_TABLE_LIMITS.maxCharts) {
        throw new AiTableDataError('table_too_large', 'The table exceeds the supported chart limit.');
      }
      const index = Number.isSafeInteger(operation.index) ? Math.max(0, Math.min(operation.index, project.charts.length)) : project.charts.length;
      const chartInput = isPlainObject(operation.chart) ? operation.chart : operation;
      const chartType = chartInput.type;
      if (!['bar', 'line', 'pie'].includes(chartType)) {
        throw new AiTableDataError('invalid_operation', 'Chart type is invalid.');
      }
      const labelColumnRef = chartInput.labelColumnId ?? chartInput.labelColumn ?? chartInput.labelColumnRef;
      const labelColumnIndex = labelColumnRef === undefined ? 0 : resolveColumnIndex(project, labelColumnRef);
      const rawValueColumnRefs = chartInput.valueColumnIds ?? chartInput.valueColumns ?? chartInput.valueColumnRefs;
      if (!Array.isArray(rawValueColumnRefs) || rawValueColumnRefs.length === 0) {
        throw new AiTableDataError('invalid_operation', 'Chart needs at least one numeric value column.');
      }
      const valueColumnIds = [...new Set(rawValueColumnRefs.map(ref => {
        const columnIndex = resolveColumnIndex(project, ref);
        const column = project.columns[columnIndex];
        return column?.type === 'number' ? column.id : null;
      }).filter(Boolean))];
      if (valueColumnIds.length === 0) {
        throw new AiTableDataError('invalid_operation', 'Chart needs at least one numeric value column.');
      }
      const chart = normalizeChart({
        type: chartType,
        title: chartInput.title,
        labelColumnId: project.columns[labelColumnIndex].id,
        valueColumnIds
      }, project.nextChartNumber - 1, project.columns, new Set(project.charts.map(item => item.id)), new Set(project.charts.map(item => item.number)));
      const record = {
        id: generateId('chart'),
        number: makeStableNumber('G', project.nextChartNumber),
        ...chart
      };
      project.nextChartNumber += 1;
      insertAt(project.charts, index, record);
      return [{ type: 'insert_chart', chart: record.number, index }];
    }
    case 'update_chart': {
      const chartIndex = resolveChartIndex(project, operation.chart ?? operation.chart_number ?? operation.chartId ?? operation.chart_id);
      const chart = project.charts[chartIndex];
      const previous = { ...chart, valueColumnIds: [...chart.valueColumnIds] };
      if (operation.title !== undefined) chart.title = cleanString(operation.title, AI_TABLE_LIMITS.maxChartTitleChars, 'Chart title');
      if (operation.chartType !== undefined) {
        if (!['bar', 'line', 'pie'].includes(operation.chartType)) throw new AiTableDataError('invalid_operation', 'Chart type is invalid.');
        chart.type = operation.chartType;
      }
      if (operation.labelColumn !== undefined || operation.labelColumnId !== undefined) {
        const columnIndex = operation.labelColumnId !== undefined
          ? resolveColumnIndex(project, operation.labelColumnId)
          : resolveColumnIndex(project, operation.labelColumn);
        chart.labelColumnId = project.columns[columnIndex].id;
      }
      if (operation.valueColumns !== undefined || operation.valueColumnIds !== undefined) {
        const refs = operation.valueColumnIds ?? operation.valueColumns;
        if (!Array.isArray(refs)) throw new AiTableDataError('invalid_operation', 'Chart value columns must be an array.');
        const ids = [...new Set(refs.map(ref => project.columns[resolveColumnIndex(project, ref)]?.id).filter(Boolean).filter(columnId => project.columns.some(column => column.id === columnId && column.type === 'number')))];
        if (ids.length === 0) throw new AiTableDataError('invalid_operation', 'Chart needs at least one numeric value column.');
        chart.valueColumnIds = chart.type === 'pie' ? ids.slice(0, 1) : ids.slice(0, AI_TABLE_LIMITS.maxChartSeries);
      }
      return [{ type: 'update_chart', chart: chart.number, from: previous, to: { ...chart, valueColumnIds: [...chart.valueColumnIds] } }];
    }
    case 'delete_chart': {
      if (project.charts.length <= 0) return [];
      const chartIndex = resolveChartIndex(project, operation.chart ?? operation.chart_number ?? operation.chartId ?? operation.chart_id);
      const [removed] = project.charts.splice(chartIndex, 1);
      return [{ type: 'delete_chart', chart: removed.number, index: chartIndex }];
    }
    default:
      throw new AiTableDataError('invalid_operation', `Unknown table operation: ${operation.type}`);
  }
}

export function applyAiTableProjectOperations(projectValue, operations, { now = new Date().toISOString() } = {}) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new AiTableDataError('invalid_operation', 'operations must be a non-empty array.');
  }
  const project = normalizeAiTableProject(projectValue);
  const changes = [];
  for (const operation of operations) {
    if (!isPlainObject(operation)) {
      throw new AiTableDataError('invalid_operation', 'Each operation must be an object.');
    }
    const nextChanges = applySingleOperation(project, operation, now);
    if (Array.isArray(nextChanges)) changes.push(...nextChanges);
  }
  const normalized = normalizeAiTableProject({
    ...project,
    updatedAt: now
  });
  normalized.revision = Number.isSafeInteger(project.revision) ? project.revision + 1 : 2;
  normalized.updatedAt = now;
  return { project: normalized, changes };
}
