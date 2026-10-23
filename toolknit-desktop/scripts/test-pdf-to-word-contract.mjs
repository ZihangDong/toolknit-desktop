import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';
import markup from '../src/features/pdf-to-word/template.js';
import { LIMITS } from '../src/features/pdf-to-word/core/input.js';

const read = path => readFile(path, 'utf8');
const spec = LAZY_TOOL_SPECS['pdf-to-word'];
assert.equal(spec.overlayId, 'pdfWordOverlay'); assert.equal(spec.init, 'initPdfWordTool');
assert.equal((await spec.markup()).default, markup);
const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size);
for (const id of ['pdfWordOverlay', 'pdfWordEmptyPick', 'pdfWordExport', 'pdfWordCanvas', 'pdfWordCancel', 'pdfWordThumbnails', 'pdfWordReset', 'pdfWordEditText']) assert(ids.includes(id));
for (const id of ['pdfWordAnalyze', 'pdfWordFallback', 'pdfWordReview', 'pdfWordAuto', 'pdfWordFontSize']) assert(!ids.includes(id));
for (const language of ['zh', 'en']) {
  const dictionary = JSON.parse(await read(`src/locales/${language}.json`));
  for (const [, key] of markup.matchAll(/data-i18n(?:-aria-label|-title)?="([^"]+)"/g)) {
    const value = key.split('.').reduce((current, part) => current?.[part], dictionary);
    assert.equal(typeof value, 'string', `${language}:${key}`); assert(value.trim());
  }
}
const controller = await read('src/features/pdf-to-word/controller.js');
assert(!controller.includes('.innerHTML')); assert(!controller.includes("from '@tauri-apps"));
assert(controller.includes('createLifecycleScope')); assert(controller.includes('requestAiKeyConfiguration'));
const native = await read('src-tauri/src/native_runtime/pdf/docx_write.rs');
const runner = await read('src-tauri/src/native_runtime/runner.rs');
for (const command of ['begin_pdf_to_word_write', 'append_pdf_to_word_chunk', 'finalize_pdf_to_word_write', 'discard_pdf_to_word_write', 'open_pdf_to_word_result']) {
  assert(native.includes(`fn ${command}(`)); assert(runner.includes(command));
}
assert(native.includes('window.label() != "main"')); assert(native.includes('create_new(true)'));
assert.equal(LIMITS.outputBytes, 64 * 1024 * 1024); assert.equal(LIMITS.chunkBytes, 2 * 1024 * 1024);
assert(native.includes('const MAX_DOCX_BYTES: u64 = 64 * 1024 * 1024')); assert(native.includes('const MAX_DOCX_CHUNK: usize = 2 * 1024 * 1024'));
assert.equal(LIMITS.renderSide, 8192); assert.equal(LIMITS.renderPixels, 16_000_000);
assert(native.includes('const MAX_DOCX_IMAGE_SIDE: u32 = 8_192'));
assert(native.includes('const MAX_DOCX_IMAGE_PIXELS: u64 = 16_000_000'));
const pkg = JSON.parse(await read('package.json')), lock = JSON.parse(await read('package-lock.json'));
assert.equal(pkg.dependencies.docx, '9.12.0'); assert.equal(lock.packages['node_modules/docx'].version, '9.12.0');
assert.equal(pkg.dependencies['pdfjs-dist'], lock.packages['node_modules/pdfjs-dist'].version);
console.log('PDF to Word contracts passed: lazy shell, i18n, platform, output commands, limits and pinned dependencies.');
