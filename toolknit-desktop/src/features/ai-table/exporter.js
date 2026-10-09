import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import {
  makeAiTableCsv,
  normalizeAiTableSheetName,
  parseAiTableNumber,
  safeSpreadsheetCellValue
} from '../../ai-table-core.js';
import { t } from '../../i18n.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import { buildAiTablePdf } from './pdf.js';

function cloneData(data) {
  return data ? JSON.parse(JSON.stringify(data)) : null;
}

function encodeBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function measureSpreadsheetText(value) {
  let width = 0;
  for (const character of String(value ?? '')) {
    width += /[\u4e00-\u9fff\uff00-\uffef]/.test(character) ? 1.8 : 1;
  }
  return width;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas produced an empty PNG.'));
    }, 'image/png');
  });
}

async function canvasPngBytes(canvas) {
  const dataUrl = canvas.toDataURL('image/png');
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Chart canvas produced an invalid PNG data URL.');
  const binary = atob(dataUrl.slice(comma + 1));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function createAiTableExporter({
  isTauri = false,
  isDemo = false,
  getData,
  getChartEntries = () => [],
  waitForCharts = () => Promise.resolve([]),
  getOutputDir,
  displayFilesystemPath = value => String(value || ''),
  showMask = () => {},
  hideMask = () => {},
  reportError = () => {}
} = {}) {
  const lifecycle = createLifecycleScope();
  const successOverlay = document.getElementById('aiTableSuccessOverlay');
  const successPath = document.getElementById('aiTableSuccessPath');
  const openFolderButton = document.getElementById('aiTableSuccessOpenFolder');
  const okButton = document.getElementById('aiTableSuccessOk');
  const exportButtons = [...document.querySelectorAll('.ai-table-export-btn')];
  let session = null;
  let runId = 0;
  let exporting = false;
  let lastExportPath = '';
  let fontRegularBytes = null;

  const bind = (target, type, listener, options) => target
    && lifecycle.event(target, type, listener, options);
  const current = (owner, id) => owner === session && !owner?.disposed && runId === id;

  async function loadRegularFont() {
    if (fontRegularBytes) return fontRegularBytes;
    const response = await fetch('/assets/fonts/NotoSansSC-Regular.ttf');
    if (!response.ok) throw new Error(`AI Table font request failed: ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (new Uint8Array(bytes, 0, 1)[0] === 0x3C) {
      throw new Error('AI Table font request returned HTML.');
    }
    fontRegularBytes = bytes;
    return bytes;
  }

  async function writeDemoBridge(blob, format) {
    if (!isDemo) return;
    let bridge = document.getElementById('aiTableDemoExport');
    if (!bridge) {
      bridge = document.createElement('textarea');
      bridge.id = 'aiTableDemoExport';
      bridge.hidden = true;
      document.body.appendChild(bridge);
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    bridge.value = encodeBase64(bytes);
    bridge.dataset.format = format;
    bridge.dataset.byteLength = String(bytes.length);
  }

  function showSuccess(path) {
    lastExportPath = path;
    if (successPath) successPath.textContent = displayFilesystemPath(path);
    successOverlay?.classList.add('visible');
  }

  async function saveBlob(blob, fileName, format, owner, id) {
    if (!current(owner, id)) return false;
    await writeDemoBridge(blob, format);
    if (!current(owner, id)) return false;
    if (isTauri) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!current(owner, id)) return false;
      const outputDirectory = await getOutputDir('AI_Table');
      if (!current(owner, id)) return false;
      const { invoke } = await tauriCorePromise;
      const outputPath = await invoke('write_unique_file_bytes', {
        directory: outputDirectory,
        fileName,
        bytes: Array.from(bytes)
      });
      if (!current(owner, id)) return false;
      showSuccess(outputPath);
      return true;
    }
    if (typeof URL.createObjectURL === 'function') {
      const url = URL.createObjectURL(blob);
      const revoke = () => URL.revokeObjectURL(url);
      owner.use(revoke);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      owner.timeout(revoke, 0);
    }
    return true;
  }

  async function requireCharts(owner, id) {
    const results = await waitForCharts();
    if (!current(owner, id)) return null;
    const failed = results.find(result => !result?.ok && !result?.cancelled);
    if (failed) throw failed.error || new Error('Chart rendering failed.');
    return getChartEntries();
  }

  async function buildXlsx(source, chartEntries) {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheetName = normalizeAiTableSheetName(source.title);
    const worksheet = workbook.addWorksheet(sheetName);
    const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
    const borders = { top: thin, left: thin, bottom: thin, right: thin };
    let startRow = 1;

    if (source.title) {
      worksheet.mergeCells(1, 1, 1, source.columns.length);
      const title = worksheet.getCell(1, 1);
      title.value = safeSpreadsheetCellValue(source.title);
      title.font = { bold: true, size: 16, color: { argb: 'FF1A1A1A' } };
      title.alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(1).height = 28;
      startRow = 2;
    }

    const header = worksheet.getRow(startRow);
    source.columns.forEach((column, columnIndex) => {
      const cell = header.getCell(columnIndex + 1);
      cell.value = safeSpreadsheetCellValue(column.label || column.key);
      cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E2E2E' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = borders;
    });
    header.height = 22;

    source.rows.forEach((row, rowIndex) => {
      const worksheetRow = worksheet.getRow(startRow + 1 + rowIndex);
      source.columns.forEach((column, columnIndex) => {
        const cell = worksheetRow.getCell(columnIndex + 1);
        const numeric = column.type === 'number' ? parseAiTableNumber(row[columnIndex]) : null;
        cell.value = column.type === 'number' && numeric !== null
          ? numeric
          : safeSpreadsheetCellValue(row[columnIndex]);
        cell.alignment = {
          horizontal: column.type === 'number' ? 'right' : 'left',
          vertical: 'middle'
        };
        cell.border = borders;
        if (rowIndex % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
        }
      });
      worksheetRow.height = 18;
    });

    source.columns.forEach((column, columnIndex) => {
      let width = measureSpreadsheetText(column.label || column.key);
      source.rows.forEach(row => {
        width = Math.max(width, measureSpreadsheetText(row[columnIndex]));
      });
      worksheet.getColumn(columnIndex + 1).width = Math.min(Math.max(width + 3, 10), 50);
    });

    if (source.charts?.length) {
      if (chartEntries.length !== source.charts.length) {
        throw new Error('Rendered chart count does not match the table data.');
      }
      const chartsLabel = t('home.aiTable.chartSheet') || 'Charts';
      const chartsBaseName = normalizeAiTableSheetName(chartsLabel);
      let chartsSheetName = chartsBaseName;
      let suffixIndex = 2;
      while (chartsSheetName.toLocaleLowerCase() === sheetName.toLocaleLowerCase()) {
        const suffix = ` ${suffixIndex++}`;
        chartsSheetName = `${chartsBaseName.slice(0, 31 - suffix.length)}${suffix}`;
      }
      const chartsSheet = workbook.addWorksheet(chartsSheetName);
      chartsSheet.views = [{ showGridLines: false }];
      for (let column = 1; column <= 12; column += 1) chartsSheet.getColumn(column).width = 12;
      chartsSheet.mergeCells(1, 1, 1, 12);
      const heading = chartsSheet.getCell(1, 1);
      heading.value = source.title ? `${source.title} - ${chartsLabel}` : chartsLabel;
      heading.font = { bold: true, size: 16, color: { argb: 'FF1A1A1A' } };
      heading.alignment = { horizontal: 'center', vertical: 'middle' };
      chartsSheet.getRow(1).height = 28;

      let chartRow = 3;
      chartEntries.forEach(({ canvas, chartDef }, chartIndex) => {
        chartsSheet.mergeCells(chartRow, 1, chartRow, 12);
        const chartTitle = chartsSheet.getCell(chartRow, 1);
        chartTitle.value = chartDef.title || `${t('home.aiTable.defaultChartTitle')} ${chartIndex + 1}`;
        chartTitle.font = { bold: true, size: 12, color: { argb: 'FF262626' } };
        chartTitle.alignment = { horizontal: 'left', vertical: 'middle' };
        chartsSheet.getRow(chartRow).height = 22;
        const imageData = canvas.toDataURL('image/png');
        if (!imageData || imageData.length < 128) {
          throw new Error(`Chart ${chartIndex + 1} produced an empty image.`);
        }
        const imageId = workbook.addImage({ base64: imageData, extension: 'png' });
        chartsSheet.addImage(imageId, {
          tl: { col: 0, row: chartRow },
          ext: { width: 760, height: 380 }
        });
        chartRow += 22;
      });
      workbook.views = [{ activeTab: 1 }];
    }

    return new Blob([await workbook.xlsx.writeBuffer()], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  async function buildPng(source, chartEntries) {
    const padding = 40;
    const tableWidth = 600;
    const headerHeight = source.title ? 40 : 0;
    const rowHeight = 32;
    const tableHeight = headerHeight + (source.rows.length + 1) * rowHeight + 20;
    const chartsHeight = chartEntries.reduce((sum, entry) => sum + entry.canvas.height + 30, 0);
    const totalWidth = Math.max(tableWidth, ...chartEntries.map(entry => entry.canvas.width)) + padding * 2;
    const totalHeight = padding + tableHeight + chartsHeight + padding;
    const canvas = document.createElement('canvas');
    canvas.width = totalWidth;
    canvas.height = totalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('AI Table export canvas context is unavailable.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, totalWidth, totalHeight);
    let y = padding;

    if (source.title) {
      context.fillStyle = '#1a1a1a';
      context.font = 'bold 18px sans-serif';
      context.textAlign = 'center';
      context.fillText(source.title, totalWidth / 2, y + 20);
      y += headerHeight;
    }
    const columnWidth = (totalWidth - padding * 2) / source.columns.length;
    context.fillStyle = '#1a1a1a';
    context.fillRect(padding, y, totalWidth - padding * 2, rowHeight);
    context.fillStyle = '#ffffff';
    context.font = 'bold 12px sans-serif';
    context.textAlign = 'left';
    source.columns.forEach((column, columnIndex) => {
      context.fillText(column.label || column.key, padding + columnIndex * columnWidth + 8, y + 20);
    });
    y += rowHeight;
    source.rows.forEach((row, rowIndex) => {
      context.fillStyle = rowIndex % 2 === 1 ? '#f2f2f2' : '#ffffff';
      context.fillRect(padding, y, totalWidth - padding * 2, rowHeight);
      context.fillStyle = '#262626';
      context.font = '12px sans-serif';
      row.forEach((value, columnIndex) => {
        const maxWidth = columnWidth - 16;
        let text = String(value ?? '');
        while (text.length > 1 && context.measureText(text).width > maxWidth) {
          text = text.slice(0, -1);
        }
        if (text !== String(value ?? '')) text = `${text}…`;
        context.fillText(text, padding + columnIndex * columnWidth + 8, y + 20);
      });
      y += rowHeight;
    });
    context.strokeStyle = '#d9d9d9';
    context.lineWidth = 1;
    context.strokeRect(
      padding,
      padding + headerHeight,
      totalWidth - padding * 2,
      (source.rows.length + 1) * rowHeight
    );
    y += 20;
    chartEntries.forEach(entry => {
      context.drawImage(entry.canvas, padding, y);
      y += entry.canvas.height + 30;
    });
    return canvasToBlob(canvas);
  }

  const exportTasks = {
    async csv(source, _charts, owner, id) {
      const csv = makeAiTableCsv(source);
      return saveBlob(
        new Blob([csv], { type: 'text/csv;charset=utf-8' }),
        `ai_table_${Date.now()}.csv`,
        'csv', owner, id
      );
    },
    async xlsx(source, chartEntries, owner, id) {
      const blob = await buildXlsx(source, chartEntries);
      return saveBlob(blob, `ai_table_${Date.now()}.xlsx`, 'xlsx', owner, id);
    },
    async png(source, chartEntries, owner, id) {
      const blob = await buildPng(source, chartEntries);
      return saveBlob(blob, `ai_table_${Date.now()}.png`, 'png', owner, id);
    },
    async pdf(source, chartEntries, owner, id) {
      const fontBytes = await loadRegularFont();
      if (!current(owner, id)) return false;
      const chartBytes = await Promise.all(chartEntries.map(entry => canvasPngBytes(entry.canvas)));
      const bytes = await buildAiTablePdf({
        data: source,
        chartPngBytes: chartBytes,
        fontRegularBytes: fontBytes
      });
      return saveBlob(
        new Blob([bytes], { type: 'application/pdf' }),
        `ai_table_${Date.now()}.pdf`,
        'pdf', owner, id
      );
    }
  };

  const maskKeys = {
    csv: null,
    xlsx: 'home.aiTable.exportingExcel',
    png: 'home.aiTable.exportingPng',
    pdf: 'home.aiTable.exportingPdf'
  };
  const errorKeys = {
    csv: 'home.aiTable.errCsv',
    xlsx: 'home.aiTable.errXlsx',
    png: 'home.aiTable.errPng',
    pdf: 'home.aiTable.errPdf'
  };

  async function exportFormat(format) {
    const task = exportTasks[format];
    const source = cloneData(getData?.());
    if (!task || !source || exporting) return false;
    const owner = session;
    if (!owner || owner.disposed) return false;
    const id = ++runId;
    exporting = true;
    if (maskKeys[format]) showMask(t(maskKeys[format]));
    try {
      const chartEntries = format === 'csv' ? [] : await requireCharts(owner, id);
      if (!chartEntries || !current(owner, id)) return false;
      return await task(source, chartEntries, owner, id);
    } catch (error) {
      if (current(owner, id)) {
        console.error(`[AI Table] ${format.toUpperCase()} export error:`, error);
        reportError(t(errorKeys[format]));
      }
      return false;
    } finally {
      if (current(owner, id)) {
        exporting = false;
        hideMask();
      }
    }
  }

  bind(okButton, 'click', () => successOverlay?.classList.remove('visible'));
  bind(openFolderButton, 'click', async () => {
    if (!isTauri || !lastExportPath) return;
    try {
      const { invoke } = await tauriCorePromise;
      await invoke('open_path', { path: lastExportPath });
    } catch (error) {
      console.error('[AI Table] Open folder error:', error);
    }
  });
  exportButtons.forEach(button => bind(button, 'click', () => {
    void exportFormat(button.dataset.fmt);
  }));

  function close() {
    runId += 1;
    exporting = false;
    session?.dispose();
    session = null;
    hideMask();
    successOverlay?.classList.remove('visible');
  }

  function dispose() {
    close();
    lifecycle.dispose();
    document.getElementById('aiTableDemoExport')?.remove();
    fontRegularBytes = null;
  }

  return {
    close,
    dispose,
    exportFormat,
    open() {
      session?.dispose();
      session = createLifecycleScope();
      runId += 1;
      exporting = false;
    }
  };
}
