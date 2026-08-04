import assert from 'node:assert/strict';
import {
  applyAiTableProjectOperations,
  createAiTableProjectFromData,
  inspectAiTableProject,
  normalizeAiTableProject,
  projectToAiTableData
} from '../src/ai-table-project-core.js';

const tableData = {
  ready: true,
  title: '项目进度表',
  summary: 'AI table project regression fixture',
  columns: [
    { key: 'task', label: '任务', type: 'text' },
    { key: 'progress', label: '完成率', type: 'number' },
    { key: 'owner', label: '负责人', type: 'text' }
  ],
  rows: [
    ['需求', 80, '张三'],
    ['设计', 55, '李四'],
    ['开发', 30, '王五']
  ],
  charts: []
};

const project = createAiTableProjectFromData(tableData, { locale: 'zh-CN' });
assert.equal(project.schema, 'toolknit.ai-table');
assert.equal(project.revision, 1);
assert.equal(project.columns[0].number, 'C01');
assert.equal(project.rows[0].number, 'R01');

const normalized = normalizeAiTableProject(project);
assert.equal(normalized.columns.length, 3);
assert.equal(projectToAiTableData(normalized).rows.length, 3);
assert.equal(inspectAiTableProject(normalized).project.rows[0].number, 'R01');

const insertedChart = applyAiTableProjectOperations(normalized, [
  {
    type: 'insert_chart',
    chart: {
      type: 'bar',
      title: '完成率对比',
      labelColumnId: 'C01',
      valueColumnIds: ['C02']
    }
  }
]).project;
assert.equal(insertedChart.revision, 2);
assert.equal(insertedChart.charts.length, 1);
assert.equal(insertedChart.charts[0].number, 'G01');
assert.equal(insertedChart.charts[0].labelColumnId, insertedChart.columns[0].id);
assert.deepEqual(insertedChart.charts[0].valueColumnIds, [insertedChart.columns[1].id]);

const editedChart = applyAiTableProjectOperations(insertedChart, [
  {
    type: 'update_chart',
    chart: 'G01',
    chartType: 'line',
    title: '完成率趋势',
    valueColumnIds: ['完成率']
  }
]).project;
assert.equal(editedChart.revision, 3);
assert.equal(editedChart.charts[0].type, 'line');
assert.equal(editedChart.charts[0].title, '完成率趋势');
assert.deepEqual(editedChart.charts[0].valueColumnIds, [editedChart.columns[1].id]);

const editedCell = applyAiTableProjectOperations(editedChart, [
  { type: 'update_cell', row: 'R01', column: 'C03', value: '赵六' },
  { type: 'swap_rows', first: 'R01', second: 'R02' }
]).project;
assert.equal(editedCell.revision, 4);
assert.equal(editedCell.rows[0].number, 'R02');
assert.equal(editedCell.rows.find(row => row.number === 'R01').values[2], '赵六');

const renamedColumn = applyAiTableProjectOperations(editedCell, [
  { type: 'update_column', column: 'C03', label: '责任人' }
]).project;
assert.equal(renamedColumn.revision, 5);
assert.equal(renamedColumn.columns.find(column => column.number === 'C03').label, '责任人');
assert.equal(renamedColumn.columns.find(column => column.number === 'C03').type, 'text');

console.log('AI table project core regression checks passed');
