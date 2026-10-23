import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import markup from '../src/features/image-to-pdf/template.js';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';
const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');
const spec = LAZY_TOOL_SPECS['image-to-pdf'];
assert.equal(spec.overlayId, 'imagePdfOverlay'); assert.equal(spec.init, 'initImagePdfTool');
assert.equal((await spec.markup()).default, markup);
assert.equal(((await read('index.html')).match(/data-tool="image-to-pdf"/g) || []).length, 1);
const ids = [...markup.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size);
const flatten = (value, prefix = '') => Object.entries(value).flatMap(([key, value]) => typeof value === 'string' ? [[prefix + key, value]] : flatten(value, prefix + key + '.'));
const locales = await Promise.all(['zh', 'en'].map(async lang => JSON.parse(await read(`src/locales/${lang}.json`))));
const [zh, en] = locales.map(locale => new Map(flatten(locale.home.imagePdf)));
assert.deepEqual([...zh.keys()].sort(), [...en.keys()].sort());
for (const [key, value] of zh) {
  assert.ok(value.trim() && en.get(key).trim(), key);
  assert.deepEqual((value.match(/\{\w+\}/g) || []).sort(), (en.get(key).match(/\{\w+\}/g) || []).sort(), key);
}
for (const match of markup.matchAll(/home\.imagePdf\.([\w.-]+)/g)) assert.ok(zh.has(match[1]), match[1]);
for (const locale of locales) for (const key of ['imagePdf', 'imagePdfDesc', 'imagePdfMeta']) assert.ok(locale.home.toolNames[key]);
for (const name of ['controller', 'input', 'export', 'worker']) {
  const source = await read(`src/features/image-to-pdf/${name}.js`);
  assert.doesNotMatch(source, /fetch\(|ai_request|@tauri-apps\/|__TAURI|localStorage|innerHTML/);
}
const native = await read('src-tauri/src/native_runtime/image/image_pdf.rs');
const registry = await read('src-tauri/src/native_runtime/runner.rs');
for (const command of ['inspect_image_pdf_input', 'read_image_pdf_page', 'open_image_pdf_result']) assert.match(registry, new RegExp('\\b' + command + '\\b'));
assert.match(native, /window\.label\(\) != "main"/);
assert.match(native, /Semaphore/);
assert.match(native, /expected_digest/);
console.log('Image PDF lazy entry, unique IDs, bilingual strings, offline and native contracts passed');
