import assert from 'node:assert/strict';
import {
  addWordFiles,
  applyWordResult,
  wordErrorCode,
} from '../src/features/word-to-pdf/core.js';
import { TOOL_DEFINITIONS } from '../cli/lib/tool-definitions.mjs';
import { readFile } from 'node:fs/promises';
const rows = addWordFiles(
  [],
  ['C:\\资料\\Word 文档.docx', 'C:\\资料\\旧文档.DOC'],
);
assert.equal(addWordFiles(rows, ['c:\\资料\\word 文档.DOCX']).length, 2);
assert.throws(() => addWordFiles(rows, ['C:\\fake.pdf']));
assert.throws(() =>
  addWordFiles(
    [],
    Array.from({ length: 21 }, (_, i) => `C:\\${i}.docx`),
  ),
);
applyWordResult(rows, {
  inputPath: rows[0].path,
  status: 'success',
  outputPath: 'C:\\结果.pdf',
  outputBytes: 100,
  pageCount: 2,
});
applyWordResult(rows, {
  inputPath: rows[1].path,
  status: 'failed',
  error: 'word-render:invalid-document',
});
assert.equal(rows[0].status, 'success');
assert.equal(rows[0].outputBytes, 100);
applyWordResult(rows, {
  inputPath: rows[1].path,
  status: 'success',
  outputPath: 'C:\\结果2.pdf',
  bytes: 240,
  page_count: 3,
});
assert.equal(rows[1].outputBytes, 240);
assert.equal(rows[1].pageCount, 3);
assert.equal(rows[1].status, 'success');
applyWordResult(rows, {
  inputPath: rows[1].path,
  status: 'failed',
  error: 'word-render:invalid-document',
});
assert.equal(rows[1].status, 'failed');
assert.equal(wordErrorCode('private details at C:\\secret'), 'render-failed');
assert.equal(wordErrorCode('word-render:timeout'), 'timeout');
assert.ok(TOOL_DEFINITIONS.find((t) => t.name === 'toolknit_word_to_pdf'));
const template = await readFile('src/features/word-to-pdf/template.js', 'utf8');
assert.match(template, /toolTopbarMarkup/);
assert.match(template, /pdf-merge-v2-workspace/);
assert.match(template, /tk-file-result/);
assert.match(template, /wordPdfSuccessName/);
assert.match(template, /wordPdfSuccessPath/);
assert.match(template, /wordPdfSuccessEditor/);
assert.match(template, /wordPdfSuccessFolder/);
assert.doesNotMatch(template, /wordPdf(Stage|Paper|Previous|Next|Fit|SuccessOpen)/);
const controller = await readFile('src/features/word-to-pdf/controller.js', 'utf8');
assert.doesNotMatch(controller, /createWordPdfPreview|read_pdf_to_image_source|open_image_pdf_result/);
assert.match(controller, /openLazyTool\?\.\('pdf-editor'\)/);
const native = await readFile('src-tauri/src/native_runtime/runner.rs', 'utf8');
assert.match(native, /office::convert_word_to_pdf/);
assert.match(native, /office::cancel_word_to_pdf/);
console.log(
  'Word to PDF: queue limits, de-duplication, per-file results, safe errors and public registrations passed.',
);
