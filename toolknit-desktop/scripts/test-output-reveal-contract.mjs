import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = await Promise.all([
  readFile(new URL('../src-tauri/src/native_runtime/office/files.rs', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-merge/exporter.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-rotate/exporter.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-split/exporter.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-page-number/tool.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-crop/tool.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-editor/events.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-to-image/tool.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-compress/tool.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/ppt-render/controller.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/excel-to-pdf/controller.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-to-scan/controller.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/pdf-to-scan/processor.js', import.meta.url), 'utf8')
]);

const [native, merge, rotate, split, pageNumber, crop, editor, pdfToImage, pdfCompress, pptRender, excel, pdfScanController, pdfScanProcessor] = files;

assert.match(native, /format!\("\/select,\{\}", canonical_requested\.display\(\)\)/,
  'Windows file reveal must use Explorer selection');
assert.match(native, /canonical_requested\.is_file\(\)/, 'native reveal must distinguish files from directories');
assert.match(native, /Path must be absolute/, 'native reveal must reject relative paths');
assert.match(merge, /invoke\('open_path', \{ path: lastOutputPath \}\)/, 'PDF merge must pass the actual output file');
assert.match(rotate, /invoke\('open_path', \{ path: lastSavedPath \}\)/, 'PDF rotate must pass the actual output file');
assert.match(split, /let lastSavedPath = ''/, 'PDF split must retain the published output path');
assert.match(split, /const outputPath = await saveBytes/, 'PDF split must capture the published output path');
assert.match(pageNumber, /result\.outputPath \|\| result\.outputDir/, 'page-number reveal must prefer the published file');
assert.match(crop, /result\.outputPath \|\| result\.outputDir/, 'PDF crop reveal must prefer the published file');
assert.match(editor, /getLastSuccess\(\)\?\.outputPath/, 'PDF editor reveal must prefer its published file');
assert.match(pdfToImage, /getLastOutputPath/, 'PDF-to-image reveal must retain a real output item path');
assert.match(pdfCompress, /lastSavedPath \|\| outputDirectory/, 'PDF compression reveal must prefer a successful output file');
assert.match(pptRender, /result\?\.outputPath \|\| result\?\.output_path \|\| result\?\.outputDir/, 'PPT render reveal must prefer a published file');
assert.match(excel, /firstOutputPath \|\| String\(result\?\.outputDir/, 'Excel to PDF reveal must prefer its first published file');
assert.match(pdfScanProcessor, /const path = await publishScanBytes/, 'PDF scan must publish before reporting success');
assert.match(pdfScanProcessor, /return \{ bytes, path, name:/, 'PDF scan must retain the final published file path');
assert.match(pdfScanController, /SuccessPath.*displayFilesystemPath\(result\.path\)/s, 'PDF scan success must show the final output path');
assert.match(pdfScanController, /invoke\('open_path', \{ path \}\)/, 'PDF scan must pass the final output file to Explorer');

console.log('Output reveal contract passed: file paths select outputs and directory paths remain folder opens');
