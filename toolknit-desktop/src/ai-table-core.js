export const AI_TABLE_LIMITS = Object.freeze({
  maxPromptChars: 12000,
  maxHistoryMessages: 8,
  maxHistoryMessageChars: 4000,
  maxResponseChars: 100000,
  maxTitleChars: 160,
  maxSummaryChars: 500,
  maxColumns: 20,
  maxRows: 200,
  maxCellChars: 1000,
  maxTotalTextChars: 80000,
  maxAbsoluteNumber: 1_000_000_000_000_000,
  maxCharts: 4,
  maxChartTitleChars: 120,
  maxChartSeries: 4
});

const COLUMN_TYPES = new Set(['text', 'number', 'date']);
const CHART_TYPES = new Set(['bar', 'line', 'pie']);

export class AiTableDataError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AiTableDataError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cleanString(value, maxLength, fieldName) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new AiTableDataError('invalid_table', `${fieldName} must be a string.`);
  }
  if (value.length > maxLength) {
    throw new AiTableDataError('table_too_large', `${fieldName} exceeds its allowed length.`);
  }
  return value.replace(/\u0000/g, '').trim();
}

function normalizeColumnKey(value, index, usedKeys) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const base = /^[a-z][a-z0-9_]{0,63}$/.test(candidate) ? candidate : `col_${index + 1}`;
  let key = base;
  let suffix = 2;
  while (usedKeys.has(key)) {
    key = `${base.slice(0, 58)}_${suffix}`;
    suffix += 1;
  }
  usedKeys.add(key);
  return key;
}

function normalizeLooseColumnType(value) {
  const type = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (COLUMN_TYPES.has(type)) return type;
  if (['numeric', 'integer', 'float', 'decimal', 'currency', 'percentage', 'percent'].includes(type)) return 'number';
  if (['datetime', 'timestamp', 'time'].includes(type)) return 'date';
  return '';
}

function looseColumnLabel(column, index) {
  if (typeof column === 'string') return column.trim();
  if (!isPlainObject(column)) return '';
  for (const candidate of [column.label, column.name, column.title, column.key, column.field]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return `Column ${index + 1}`;
}

function looseColumnKey(column, index) {
  if (!isPlainObject(column)) return `col_${index + 1}`;
  for (const candidate of [column.key, column.field, column.name, column.label]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return `col_${index + 1}`;
}

function normalizeLooseRows(rows, columns) {
  return rows.map(row => {
    if (Array.isArray(row)) return row;
    if (!isPlainObject(row)) return row;
    return columns.map((column, index) => {
      const keys = new Set([
        looseColumnKey(column, index),
        looseColumnLabel(column, index),
        `col_${index + 1}`,
        String(index)
      ]);
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
      }
      return undefined;
    });
  });
}

function looksLikeAiTableDate(value) {
  if (typeof value !== 'string') return false;
  return /^\d{4}(?:[-/]\d{1,2})(?:[-/]\d{1,2})?(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.test(value.trim());
}

function inferLooseColumnType(rows, index) {
  const values = rows
    .filter(Array.isArray)
    .map(row => row[index])
    .filter(value => value !== undefined && value !== null && String(value).trim() !== '');
  if (values.length === 0) return 'text';
  if (values.every(looksLikeAiTableDate)) return 'date';
  if (values.every(value => parseAiTableNumber(value) !== null)) return 'number';
  return 'text';
}

function normalizedColumnReference(value) {
  return typeof value === 'string' ? value.trim().normalize('NFKC').toLocaleLowerCase() : '';
}

function resolveLooseColumnIndex(reference, columns) {
  if (Number.isInteger(reference) && reference >= 0 && reference < columns.length) return reference;
  const needle = normalizedColumnReference(reference);
  if (!needle) return null;
  const index = columns.findIndex(column => [column.key, column.label]
    .some(candidate => normalizedColumnReference(candidate) === needle));
  return index === -1 ? null : index;
}

function normalizeLooseChart(chart, columns) {
  if (!isPlainObject(chart)) return chart;
  const rawType = typeof chart.type === 'string' ? chart.type.trim().toLowerCase() : chart.type;
  const type = rawType === 'column' ? 'bar' : rawType;
  const labelColumn = Number.isInteger(chart.labelColumn)
    ? chart.labelColumn
    : resolveLooseColumnIndex(chart.labelColumn ?? chart.xAxis ?? chart.x_axis ?? chart.label, columns) ?? 0;
  const rawValues = chart.valueColumns ?? chart.yAxis ?? chart.y_axis ?? chart.values ?? chart.value;
  const valueColumns = (Array.isArray(rawValues) ? rawValues : [rawValues])
    .flatMap(reference => typeof reference === 'string' && reference.includes(',')
      ? reference.split(',').map(item => item.trim())
      : [reference])
    .map(reference => resolveLooseColumnIndex(reference, columns))
    .filter(index => index !== null);
  return {
    type,
    title: typeof chart.title === 'string' ? chart.title : (typeof chart.name === 'string' ? chart.name : ''),
    labelColumn,
    valueColumns: [...new Set(valueColumns)]
  };
}

/**
 * Some OpenAI-compatible providers return a conventional table shape even
 * when instructed otherwise. Convert only unambiguous aliases here, then let
 * the strict validator below enforce ToolKnit's bounded internal contract.
 */
function adaptAiTableModelResponse(value) {
  if (!isPlainObject(value)) return value;
  const rawColumns = Array.isArray(value.columns) ? value.columns : null;
  const rawRows = Array.isArray(value.rows) ? value.rows : (Array.isArray(value.data) ? value.data : null);
  const looksLikeTable = rawColumns !== null && rawRows !== null;
  if (value.ready !== true && !(value.ready === undefined && looksLikeTable)) return value;
  if (!looksLikeTable) return value;

  const rows = normalizeLooseRows(rawRows, rawColumns);
  const columns = rawColumns.map((column, index) => ({
    key: looseColumnKey(column, index),
    label: looseColumnLabel(column, index),
    type: normalizeLooseColumnType(isPlainObject(column) ? column.type : undefined) || inferLooseColumnType(rows, index)
  }));
  const charts = Array.isArray(value.charts)
    ? value.charts.map(chart => normalizeLooseChart(chart, columns))
    : value.charts;

  return {
    ...value,
    ready: true,
    ...(value.title === undefined && typeof value.name === 'string' ? { title: value.name } : {}),
    ...(value.summary === undefined && typeof value.description === 'string' ? { summary: value.description } : {}),
    columns,
    rows,
    charts
  };
}

/**
 * Identifies a completed table response before normalization. Keep this
 * permissive gate shared by desktop, CLI, and MCP so compatible provider
 * aliases such as `data` do not get rejected by only one entry point.
 */
export function isAiTableResponseReady(value) {
  if (!isPlainObject(value)) return false;
  if (value.ready === true) return true;
  return value.ready === undefined
    && Array.isArray(value.columns)
    && (Array.isArray(value.rows) || Array.isArray(value.data));
}

function normalizeCell(value, type, totalTextState) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new AiTableDataError('invalid_table', 'A table number is not finite.');
    if (Math.abs(value) > AI_TABLE_LIMITS.maxAbsoluteNumber) {
      throw new AiTableDataError('invalid_table', 'A table number is outside the supported range.');
    }
    return type === 'number' ? value : String(value);
  }
  if (typeof value === 'boolean') return String(value);
  if (typeof value !== 'string') {
    throw new AiTableDataError('invalid_table', 'A table cell must contain only text, a number, or a boolean.');
  }
  const text = cleanString(value, AI_TABLE_LIMITS.maxCellChars, 'A table cell');
  totalTextState.count += text.length;
  if (totalTextState.count > AI_TABLE_LIMITS.maxTotalTextChars) {
    throw new AiTableDataError('table_too_large', 'Table text exceeds the supported limit.');
  }
  if (type !== 'number' || text === '') return text;
  const number = parseAiTableNumber(text);
  return number === null ? text : number;
}

function normalizeChart(chart, columns, chartIndex) {
  if (!isPlainObject(chart) || !CHART_TYPES.has(chart.type)) {
    throw new AiTableDataError('invalid_table', `Chart ${chartIndex + 1} is invalid.`);
  }
  const labelColumn = Number.isInteger(chart.labelColumn) && chart.labelColumn >= 0 && chart.labelColumn < columns.length
    ? chart.labelColumn
    : 0;
  const valueColumns = Array.isArray(chart.valueColumns) ? chart.valueColumns : [];
  const validValueColumns = [...new Set(valueColumns.filter(index =>
    Number.isInteger(index) && index >= 0 && index < columns.length && columns[index].type === 'number'
  ))].slice(0, AI_TABLE_LIMITS.maxChartSeries);
  if (validValueColumns.length === 0) {
    throw new AiTableDataError('invalid_table', `Chart ${chartIndex + 1} has no numeric value column.`);
  }
  return {
    type: chart.type,
    title: cleanString(chart.title, AI_TABLE_LIMITS.maxChartTitleChars, 'Chart title'),
    labelColumn,
    valueColumns: chart.type === 'pie' ? validValueColumns.slice(0, 1) : validValueColumns
  };
}

/** Converts a model response into a bounded table with primitive cell values only. */
export function normalizeAiTableData(value) {
  value = adaptAiTableModelResponse(value);
  if (!isPlainObject(value) || value.ready !== true) {
    throw new AiTableDataError('invalid_table', 'AI response is not a completed table.');
  }
  if (!Array.isArray(value.columns) || value.columns.length === 0 || !Array.isArray(value.rows) || value.rows.length === 0) {
    throw new AiTableDataError('invalid_table', 'AI response does not contain table data.');
  }
  if (value.columns.length > AI_TABLE_LIMITS.maxColumns || value.rows.length > AI_TABLE_LIMITS.maxRows) {
    throw new AiTableDataError('table_too_large', 'The table exceeds the supported row or column limit.');
  }

  const usedKeys = new Set();
  const columns = value.columns.map((column, index) => {
    if (!isPlainObject(column)) throw new AiTableDataError('invalid_table', 'A column definition must be an object.');
    const key = normalizeColumnKey(column.key, index, usedKeys);
    const label = cleanString(column.label || key, 80, 'Column label') || key;
    return { key, label, type: COLUMN_TYPES.has(column.type) ? column.type : 'text' };
  });

  const totalTextState = { count: 0 };
  const rows = value.rows.map((row, rowIndex) => {
    if (!Array.isArray(row)) throw new AiTableDataError('invalid_table', `Row ${rowIndex + 1} must be an array.`);
    return columns.map((column, columnIndex) => normalizeCell(row[columnIndex], column.type, totalTextState));
  });

  if (value.charts !== undefined && !Array.isArray(value.charts)) {
    throw new AiTableDataError('invalid_table', 'Charts must be an array.');
  }
  if ((value.charts || []).length > AI_TABLE_LIMITS.maxCharts) {
    throw new AiTableDataError('table_too_large', 'The response contains too many charts.');
  }
  const charts = (value.charts || []).map((chart, index) => normalizeChart(chart, columns, index));

  return {
    ready: true,
    title: cleanString(value.title, AI_TABLE_LIMITS.maxTitleChars, 'Table title'),
    summary: cleanString(value.summary, AI_TABLE_LIMITS.maxSummaryChars, 'Table summary'),
    columns,
    rows,
    charts
  };
}

export function cloneAiTableData(data) {
  if (!data || !Array.isArray(data.columns) || !Array.isArray(data.rows)) {
    throw new AiTableDataError('invalid_table', 'Table data is invalid.');
  }
  return {
    ready: data.ready === true,
    title: typeof data.title === 'string' ? data.title : '',
    summary: typeof data.summary === 'string' ? data.summary : '',
    columns: data.columns.map(column => ({ ...column })),
    rows: data.rows.map(row => [...row]),
    charts: Array.isArray(data.charts) ? data.charts.map(chart => ({ ...chart, valueColumns: [...(chart.valueColumns || [])] })) : []
  };
}

export function compactAiTableHistoryMessage(value) {
  return typeof value === 'string'
    ? value.replace(/\u0000/g, '').trim().slice(0, AI_TABLE_LIMITS.maxHistoryMessageChars)
    : '';
}

/** Returns a chart- and spreadsheet-safe numeric value, or null for non-numeric input. */
export function parseAiTableNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && Math.abs(value) <= AI_TABLE_LIMITS.maxAbsoluteNumber ? value : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) && Math.abs(number) <= AI_TABLE_LIMITS.maxAbsoluteNumber ? number : null;
}

export function assertAiTableTextBudget(textChars) {
  if (!Number.isSafeInteger(textChars) || textChars < 0 || textChars > AI_TABLE_LIMITS.maxTotalTextChars) {
    throw new AiTableDataError('table_too_large', 'Table text exceeds the supported limit.');
  }
}

export function normalizeAiTableSheetName(value) {
  const title = typeof value === 'string' ? value : '';
  const name = title
    .replace(/[\u0000-\u001F\\/?*\[\]:]/g, '')
    .trim()
    .replace(/^'+|'+$/g, '')
    .slice(0, 31);
  return name && name.toLowerCase() !== 'history' ? name : 'Sheet1';
}

/** Prevent spreadsheet formula execution when text is exported to CSV/XLSX. */
export function safeSpreadsheetCellValue(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
}

export function makeAiTableCsv(data) {
  const header = data.columns.map(column => column.label || column.key);
  const rows = [header, ...data.rows];
  return '\uFEFF' + rows.map(row => row.map(value => {
    const safe = safeSpreadsheetCellValue(value).replace(/"/g, '""');
    return `"${safe}"`;
  }).join(',')).join('\n');
}
