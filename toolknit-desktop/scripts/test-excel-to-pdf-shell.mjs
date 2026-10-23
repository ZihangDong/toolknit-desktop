import { readAppMarkup } from './lib/app-markup.mjs';
import './test-pdfjs-assets.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  EXCEL_TO_PDF_MAX_FILES,
  excelWorkbookKey,
  excelWorkbookNameFromPath,
  formatExcelWorkbookBytes,
  getExcelToPdfErrorKey,
  isSupportedExcelWorkbook,
  normalizeExcelWorkbookRecord
} from '../src/features/excel-to-pdf/core.js';

const [
  html,
  main,
  lazyTools,
  tool,
  controller,
  template,
  compatibility,
  compatibilityCss,
  css,
  rust,
  zh,
  en
] = await Promise.all([
  readAppMarkup(import.meta.url),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8').then(async main => `${main}\n${await readFile(new URL('../src/application-runtime.js', import.meta.url), 'utf8')}`),
  readFile(new URL('../src/features/lazy-tools.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/excel-to-pdf/tool.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/excel-to-pdf/controller.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/excel-to-pdf/template.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/excel-to-pdf-ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/excel-to-pdf.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/excel-to-pdf/excel-to-pdf.css', import.meta.url), 'utf8'),
  readFile(new URL('../src-tauri/src/native_runtime.rs', import.meta.url), 'utf8').then(async nativeRuntime => `${nativeRuntime}\n${await readFile(new URL('../src-tauri/src/native_runtime/office.rs', import.meta.url), 'utf8')}\n${await readFile(new URL('../src-tauri/src/native_runtime/office/excel.rs', import.meta.url), 'utf8')}\n${await readFile(new URL('../src-tauri/src/native_runtime/office/ppt.rs', import.meta.url), 'utf8')}\n${await readFile(new URL('../src-tauri/src/native_runtime/runner.rs', import.meta.url), 'utf8')}`),
  readFile(new URL('../src/locales/zh.json', import.meta.url), 'utf8'),
  readFile(new URL('../src/locales/en.json', import.meta.url), 'utf8')
]);

assert.match(html, /data-tool="excel-to-pdf"/);
assert.match(html, /data-category="pdf"[\s\S]*data-tool="excel-to-pdf"/);
assert.match(html, /id="excelToPdfOverlay"/);
assert.match(lazyTools, /'excel-to-pdf':[\s\S]*import\('\.\/excel-to-pdf\/tool\.js'\)[\s\S]*initExcelToPdfTool/);
assert.match(main, /createLazyToolRegistry\([\s\S]*specs:\s*LAZY_TOOL_SPECS/);
assert.match(main, /currentPhase === 'installing'\s*\? dependencyInstallingDetail\(currentName, currentProgress\)/);
assert.match(main, /currentPhase === 'verifying'[\s\S]*home\.dependencies\.verifyingDetail/);
assert.match(main, /dataset\.indeterminate = isPostDownload/);
assert.match(tool, /from ['"]\.\/template\.js['"]/);
assert.match(tool, /from ['"]\.\/controller\.js['"]/);
assert.match(tool, /import ['"]\.\/excel-to-pdf\.css['"]/);
assert.match(template, /accept="\.xlsx,\.xls,\.ods"/);
assert.match(template, /data-setting-group="sheets"/);
assert.match(template, /data-setting-group="orientation"/);
assert.match(template, /data-setting-group="paper"/);
assert.match(template, /data-setting-group="scale"/);
assert.match(template, /class="audio-convert-process-btn pdf-merge-v2-process"[^>]*\bdisabled\b/);
assert.match(template, /data-excel-action="convert"/);
assert.match(controller, /invoke\('convert_excel_to_pdf'/);
assert.match(controller, /sheetRange:\s*settings\.sheets/);
assert.match(controller, /createLifecycleScope\(\)/);
assert.match(controller, /owner\.use\(unlisten\)/);
assert.match(controller, /isOpenSession\(owner\)/);
assert.ok(controller.indexOf('processing = true;') < controller.indexOf('await ensureLibreOfficeAvailable()'), 'lock before the first runtime check');
assert.match(controller, /moveFocusOutOfHiddenRegion\(successOverlay/);
assert.match(controller, /if \(nativeStarted\) void invoke\('cancel_convert'/);
assert.match(rust, /prop\("ReadOnly", read_only\)/);
assert.match(rust, /load_workbook\(desktop, input_url, input_path, True\)/);
assert.match(rust, /load_workbook\(desktop, input_url, input_path, False\)/);
assert.match(rust, /std::fs::copy\(&input\.path, &staged_input\)/);
assert.match(rust, /Calc could not include a hidden worksheet in the export/);
assert.match(controller, /filesContainer\.replaceChildren\(fragment\)/);
assert.doesNotMatch(controller, /filesContainer\.innerHTML/);
assert.match(controller, /from ['"]\.\.\/\.\.\/platform\/tauri-runtime\.js['"]/);
assert.doesNotMatch(controller, /from ['"]@tauri-apps\//);
assert.match(compatibility, /from ['"]\.\/features\/excel-to-pdf\/tool\.js['"]/);
assert.equal(compatibilityCss.trim(), "@import url('./features/excel-to-pdf/excel-to-pdf.css');");
assert.equal(EXCEL_TO_PDF_MAX_FILES, 20);
assert.equal(excelWorkbookNameFromPath('C:\\Work\\季度报表.xlsx'), '季度报表.xlsx');
assert.equal(isSupportedExcelWorkbook('budget.ODS'), true);
assert.equal(isSupportedExcelWorkbook('budget.csv'), false);
assert.equal(formatExcelWorkbookBytes(1536, '未知'), '2 KB');
assert.equal(formatExcelWorkbookBytes(undefined, '未知'), '未知');
const normalized = normalizeExcelWorkbookRecord({ path: 'C:\\Work\\Budget.XLSX', size: 2048 }, 7);
assert.deepEqual(normalized, {
  id: 7,
  name: 'Budget.XLSX',
  extension: 'XLSX',
  size: 2048,
  path: 'C:\\Work\\Budget.XLSX'
});
assert.equal(excelWorkbookKey(normalized), 'c:\\work\\budget.xlsx::2048');
assert.equal(getExcelToPdfErrorKey('excel-render:all-failed'), 'renderFailed');
assert.equal(getExcelToPdfErrorKey('excel-render:busy'), 'busy');
assert.equal(getExcelToPdfErrorKey('unexpected'), 'conversionFailed');
assert.match(rust, /async fn convert_excel_to_pdf\(/);
assert.match(rust, /convert_excel_to_pdf,[\s\S]*convert_video_batch/);
assert.match(rust, /"\.xlsx": "Calc MS Excel 2007 XML"/);
assert.match(rust, /"\.xls": "MS Excel 97"/);
assert.match(rust, /"\.ods": "calc8"/);
assert.match(css, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
assert.match(css, /\.excel-to-pdf-overlay \.audio-clip-success-btn-secondary\s*\{[\s\S]*?color:\s*#333/);
assert.match(css, /\.excel-to-pdf-overlay \.audio-clip-success-btn-secondary:hover\s*\{[\s\S]*?color:\s*#222/);
assert.match(css, /@media \(max-width: 980px\)/);
assert.match(css, /@media \(max-width: 620px\)/);

const zhLocale = JSON.parse(zh);
const enLocale = JSON.parse(en);
assert.equal(zhLocale.home.toolNames.excelToPdf, 'Excel 转 PDF');
assert.equal(enLocale.home.toolNames.excelToPdf, 'Excel to PDF');
assert.equal(zhLocale.home.excelToPdfPage.paperLetter, '美式信纸');
assert.equal(zhLocale.home.excelToPdfPage.startButton, '开始转换');
assert.equal(enLocale.home.excelToPdfPage.startButton, 'Start conversion');
assert.equal(zhLocale.home.excelToPdfPage.renderFailed, 'LibreOffice 无法读取或渲染这个工作簿，请先用 Excel 或 WPS 重新另存为标准 XLSX 后再试。');
assert.equal(enLocale.home.excelToPdfPage.renderFailed, 'LibreOffice could not read or render this workbook. Save it as a standard XLSX in Excel or WPS, then try again.');
assert.equal(zhLocale.home.dependencies.installingDetail, '正在安装 {name}，请稍等...');
assert.equal(zhLocale.home.dependencies.verifyingDetail, '正在校验 {name}，请稍等...');
assert.equal(enLocale.home.dependencies.installingDetail, 'Installing {name}. Please wait...');
assert.equal(enLocale.home.dependencies.verifyingDetail, 'Verifying {name}. Please wait...');

console.log('Excel to PDF feature contract passed');
