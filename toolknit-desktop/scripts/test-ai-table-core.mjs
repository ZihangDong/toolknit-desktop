import assert from 'node:assert/strict';
import {
  AI_TABLE_LIMITS,
  AiTableDataError,
  assertAiTableTextBudget,
  cloneAiTableData,
  isAiTableResponseReady,
  makeAiTableCsv,
  normalizeAiTableData,
  normalizeAiTableSheetName,
  parseAiTableNumber,
  safeSpreadsheetCellValue
} from '../src/ai-table-core.js';

const validTable = {
  ready: true,
  title: 'Quarterly sales',
  summary: 'A safe sample table',
  columns: [
    { key: 'product', label: 'Product', type: 'text' },
    { key: 'sales', label: 'Sales', type: 'number' },
    { key: 'date', label: 'Date', type: 'date' }
  ],
  rows: [
    ['=HYPERLINK("https://example.com")', '1,250', '2026-01-01'],
    ['Widget', 320, '2026-02-01']
  ],
  charts: [{ type: 'line', title: 'Sales', labelColumn: 0, valueColumns: [1, 99] }]
};

const normalized = normalizeAiTableData(validTable);
assert.equal(normalized.rows[0][1], 1250);
assert.deepEqual(normalized.charts[0].valueColumns, [1]);
assert.match(makeAiTableCsv(normalized), /"'=HYPERLINK/);
assert.equal(safeSpreadsheetCellValue(' -2'), "' -2");
assert.equal(parseAiTableNumber('1,250.5'), 1250.5);
assert.equal(parseAiTableNumber('not-a-number'), null);
assert.equal(parseAiTableNumber('1e100'), null);
assert.equal(normalizeAiTableSheetName(" :*?' "), 'Sheet1');
assert.equal(normalizeAiTableSheetName('Quarterly / Sales'), 'Quarterly  Sales');
assert.doesNotThrow(() => assertAiTableTextBudget(AI_TABLE_LIMITS.maxTotalTextChars));
assert.throws(() => assertAiTableTextBudget(AI_TABLE_LIMITS.maxTotalTextChars + 1), AiTableDataError);

const editable = cloneAiTableData(normalized);
editable.rows[0][0] = 'Changed';
assert.equal(normalized.rows[0][0], '=HYPERLINK("https://example.com")');

assert.throws(
  () => normalizeAiTableData({ ...validTable, columns: Array(AI_TABLE_LIMITS.maxColumns + 1).fill(validTable.columns[0]) }),
  error => error instanceof AiTableDataError && error.code === 'table_too_large'
);
assert.throws(
  () => normalizeAiTableData({ ...validTable, rows: [[{ unsafe: true }]] }),
  error => error instanceof AiTableDataError && error.code === 'invalid_table'
);
assert.throws(
  () => normalizeAiTableData({ ...validTable, charts: [{ type: 'bar', labelColumn: 0, valueColumns: [0] }] }),
  error => error instanceof AiTableDataError && error.code === 'invalid_table'
);

const deepSeekStyleTable = normalizeAiTableData({
  title: '产品销售复盘表',
  description: '按产品比较季度销售额和增长率。',
  columns: ['产品名称', '季度', '销售额', '增长率', '备注'],
  data: [
    ['基础版', 'Q1', 128.5, 0.12, '稳定增长'],
    ['专业版', 'Q1', 96, 0.08, '待确认']
  ],
  charts: [{
    type: 'bar',
    title: '各产品销售额',
    xAxis: '产品名称',
    yAxis: '销售额',
    data: [{ 产品名称: '基础版', 销售额: 128.5 }]
  }]
});
assert.equal(isAiTableResponseReady({ columns: ['产品'], data: [['基础版']] }), true);
assert.equal(isAiTableResponseReady({ columns: ['产品'], rows: [['基础版']] }), true);
assert.equal(isAiTableResponseReady({ ready: false, question: '需要补充信息' }), false);
assert.equal(deepSeekStyleTable.ready, true);
assert.deepEqual(deepSeekStyleTable.columns.map(column => column.type), ['text', 'text', 'number', 'number', 'text']);
assert.equal(deepSeekStyleTable.charts[0].labelColumn, 0);
assert.deepEqual(deepSeekStyleTable.charts[0].valueColumns, [2]);
assert.equal(deepSeekStyleTable.summary, '按产品比较季度销售额和增长率。');

console.log('AI table core regression checks passed');
