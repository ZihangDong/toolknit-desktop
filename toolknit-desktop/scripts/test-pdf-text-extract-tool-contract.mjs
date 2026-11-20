import { readAppMarkup } from './lib/app-markup.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';

const read = relativePath => readFile(new URL(relativePath, import.meta.url), 'utf8');
const [html, template, tool, controller, core, styles, zh, en, markdownController, helpZh, helpEn] = await Promise.all([
  readAppMarkup(import.meta.url),
  read('../src/features/pdf-text-extract/template.html'),
  read('../src/features/pdf-text-extract/tool.js'),
  read('../src/features/pdf-text-extract/controller.js'),
  read('../src/features/pdf-text-extract/core.js'),
  read('../src/styles/components/pdf-markdown-workspace.css'),
  read('../src/locales/zh.json'),
  read('../src/locales/en.json'),
  read('../src/features/markdown-editor/controller.js'),
  read('../src/help-data.js'),
  read('../src/help-data-en.js')
]);

for (const id of [
  'pdfTextExtractOverlay', 'pdfTextExtractBack', 'pdfTextExtractFileInput',
  'pdfTextExtractDropZone', 'pdfTextExtractCta', 'pdfTextExtractFileCard',
  'pdfTextExtractFileName', 'pdfTextExtractFileSize', 'pdfTextExtractPageCount',
  'pdfTextExtractTextLayer', 'pdfTextExtractRemove', 'pdfTextExtractStatusPanel',
  'pdfTextExtractProgressWrap', 'pdfTextExtractProgressFill',
  'pdfTextExtractProcessedPages', 'pdfTextExtractCharCount', 'pdfTextExtractSourceType',
  'pdfTextExtractWarning', 'pdfTextExtractResult', 'pdfTextExtractResultSummary',
  'pdfTextExtractReset', 'pdfTextExtractImport', 'pdfTextExtractProcess',
  'pdfTextExtractProcessIcon', 'pdfTextExtractCancelIcon', 'pdfTextExtractProcessLabel'
]) {
  assert.match(template, new RegExp(`id=["']${id}["']`), `missing PDF text extraction DOM contract: ${id}`);
}

assert.match(html, /data-tool="pdf-text-markdown"/, 'the PDF text extraction launcher must be present');
assert.equal(LAZY_TOOL_SPECS['pdf-text-markdown']?.overlayId, 'pdfTextExtractOverlay');
assert.match(
  LAZY_TOOL_SPECS['pdf-text-markdown']?.load?.toString() || '',
  /\.\/pdf-text-extract\/tool\.js/,
  'PDF text extraction must load its feature entry directly'
);
assert.match(tool, /from ['"]\.\/controller\.js['"]/);
assert.match(tool, /import ['"]\.\/pdf-text-extract\.css['"]/);
assert.match(controller, /createLifecycleScope\(\)/);
assert.match(controller, /from ['"]\.\.\/\.\.\/platform\/tauri-runtime\.js['"]/);
assert.match(controller, /from ['"]\.\.\/\.\.\/shared\/pdfjs-options\.js['"]/);
assert.match(controller, /destroyPdfDocument/);
assert.match(controller, /owner\.use\(unlisten\)/);
assert.match(controller, /async function importMarkdown\(\)/);
assert.match(controller, /openLazyTool\('markdown-editor'\)/);
assert.match(controller, /raw\?\.importMarkdown \|\| editorInstance\?\.importMarkdown/);
assert.match(controller, /return \{ open, close, dispose, importMarkdown \}/);
assert.match(controller, /function renderState\(\)/);
assert.match(controller, /function renderSourceInfo\(\)/);
assert.match(controller, /setProgress\(progressSnapshot\.current, progressSnapshot\.total, progressSnapshot\.chars\)/);
assert.match(controller, /function cancelExtraction\(\)/);
assert.match(controller, /setState\('selected', 'cancelledDesc'\)/);

const inspectFileBody = controller.slice(
  controller.indexOf('async function inspectFile'),
  controller.indexOf('function assertCurrent')
);
const loadPdfBody = controller.slice(
  controller.indexOf('async function loadPdf'),
  controller.indexOf('async function inspectFile')
);
assert.match(inspectFileBody, /result = null;/, 'a newly selected PDF must clear the previous result');
assert.match(loadPdfBody, /task\.onPassword = \(\) =>/);
assert.match(loadPdfBody, /void task\.destroy\(\)/, 'password-protected PDFs must terminate their loading task');
assert.doesNotMatch(loadPdfBody, /callback\(['"]{2}\)/, 'an empty password would make PDF.js retry forever');
assert.doesNotMatch(controller, /from ['"]@tauri-apps\//);
assert.doesNotMatch(controller, /\.addEventListener\(/);
assert.doesNotMatch(controller, /\.innerHTML\s*=/);

for (const exportName of [
  'reconstructPdfPage', 'convertPdfPagesToMarkdown', 'normalizePdfTextError',
  'isPdfTextCancellation'
]) {
  assert.match(core, new RegExp(`export function ${exportName}`), `missing core export: ${exportName}`);
}
assert.match(core, /source-page:/);
assert.match(core, /no-text-layer/);
assert.doesNotMatch(core, /document|window|@tauri-apps/);

assert.match(styles, /html:root\[data-theme\] \.pdf-text-extract-v2/);
assert.match(styles, /html:root\[data-theme\][\s\S]*--pdf-text-surface: var\(--tk-on-accent\)/);
assert.match(styles, /@media \(max-height: 520px\)/);
assert.match(styles, /@media \(max-width: 980px\)/);

for (const [locale, source] of [['zh', zh], ['en', en]]) {
  const data = JSON.parse(source);
  assert.ok(data.home?.pdfTextMarkdown, `${locale} PDF text extraction copy is missing`);
  for (const key of [
    'title', 'uploadTitle', 'process', 'import', 'noTextWarning', 'importUnavailable',
    'processedPages', 'extractedChars', 'sourceType', 'cancel', 'cancellingButton', 'cancelledDesc',
    'uploadLimit', 'capText', 'capStructure', 'capLocal', 'planRead', 'planStructure', 'planOutput',
    'previewTitle', 'pageNavigation', 'previewPage', 'previewNote', 'previewEmpty', 'previewFailed'
  ]) {
    assert.equal(typeof data.home.pdfTextMarkdown[key], 'string', `${locale} is missing home.pdfTextMarkdown.${key}`);
  }
  assert.equal(typeof data.home?.toolNames?.pdfTextMarkdown, 'string', `${locale} tool name is missing`);
  assert.equal(typeof data.home?.toolNames?.pdfTextMarkdownDesc, 'string', `${locale} tool description is missing`);
  assert.equal(typeof data.home?.toolNames?.pdfTextMarkdownMeta, 'string', `${locale} tool metadata is missing`);
}

assert.match(markdownController, /function importMarkdown\(markdownText, sourceName = ''\)/);
assert.match(markdownController, /localStorage\.removeItem\(MARKDOWN_ASSET_KEY\)/);
assert.match(markdownController, /catch \{\s*\/\/ The document can still be imported when persistent storage is unavailable\./);
assert.match(markdownController, /return \{ open, close, dispose, importMarkdown \}/);
assert.match(helpZh, /'pdf-text-markdown': \{/);
assert.match(helpEn, /'pdf-text-markdown': \{/);

for (const [name, source] of [['controller', controller], ['core', core]]) {
  assert.ok(source.split(/\r?\n/).length <= 700, `PDF text extraction ${name} module is oversized`);
}

console.log('PDF text extraction and local Markdown integration contracts passed');
