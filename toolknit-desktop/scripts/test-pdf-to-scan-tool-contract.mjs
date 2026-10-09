import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';
import markup, { previewControlsMarkup } from '../src/features/pdf-to-scan/template.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const home = await read('index.html'), controller = await read('src/features/pdf-to-scan/controller.js');
const processor = await read('src/features/pdf-to-scan/processor.js');
const styles = await read('src/features/pdf-to-scan/pdf-to-scan.css');
const spec = LAZY_TOOL_SPECS['pdf-to-scan'];
assert.equal(spec.overlayId, 'pdfScanOverlay');
assert.equal(spec.init, 'initPdfScanTool');
assert.equal((await spec.markup()).default, markup);
assert.equal((home.match(/data-tool="pdf-to-scan"/g) || []).length, 1);
assert.match(home, /data-tool="pdf-to-scan" role="button" tabindex="0"/);
const ids = [...(markup + previewControlsMarkup).matchAll(/id="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size);
for (const id of ['pdfScanOverlay', 'pdfScanPick', 'pdfScanUploadStatus', 'pdfScanExport', 'pdfScanRange', 'pdfScanPasswordForm', 'pdfScanCancel', 'pdfScanSuccessOverlay', 'pdfScanOpenFolder', 'pdfScanSuccessOk', 'pdfScanExpand']) assert.ok(ids.includes(id));
assert.match(markup, /class="pdf-merge-v2-workspace pdf-scan-empty-workspace"/);
assert.match(markup, /class="pdf-scan-empty-state"/);
assert.match(markup, /class="pdf-scan-empty-mark" aria-hidden="true"/);
assert.match(markup, /data-lucide="file-scan"/);
assert.match(markup, /<h2 data-i18n="home\.pdfScan\.emptyHint"/);
assert.match(markup, /class="pdf-scan-empty-limit"/);
assert.match(markup, /id="pdfScanUploadStatus" role="status" aria-live="polite"/);
assert.doesNotMatch(markup, /class="pdf-merge-v2-upload(?:\s|")|class="pdf-merge-v2-info-grid(?:\s|")/);
assert.match(controller, /createPdfWorkbench/);
assert.match(controller, /tag: 'PDF TO SCAN · TOOL PAGE 3\.1'/);
assert.match(controller, /createModalSession/);
assert.match(controller, /owner\.use\(unlisten\)/);
assert.match(controller, /destroyPdfDocument/);
assert.match(controller, /sidebar\.inert = false/);
assert.match(controller, /URL\.revokeObjectURL/);
assert.match(controller, /invoke\('open_path', \{ path \}\)/);
assert.match(controller, /byId\('OpenFolder'\)\.hidden = !isTauri \|\| !result\.path/);
assert.match(controller, /byId\('SuccessPath'\)\.textContent = isTauri \? displayFilesystemPath\(result\.path\)/);
assert.match(processor, /return \{ bytes, path, name:/, 'PDF scan must return the final published file path');
assert.match(styles, /input:focus-visible, \.pdf-scan summary:focus-visible \{ outline: 2px solid var\(--scan-ink\); outline-offset: -2px; \}/);
assert.match(styles, /html\[data-theme="light"\] \.pdf-scan #pdfScanRange:focus,\s*html\[data-theme="light"\] \.pdf-scan #pdfScanRange:focus-visible \{ outline: 2px solid #171717; outline-offset: -2px; box-shadow: none; \}/);
assert.match(processor, /discard_pdf_enhance_write/);
for (const source of [controller, processor]) assert.doesNotMatch(source, /fetch\(|ai_request|@tauri-apps\/|__TAURI|localStorage/);
const zh = JSON.parse(await read('src/locales/zh.json')), en = JSON.parse(await read('src/locales/en.json'));
for (const key of ['pdfScan', 'pdfScanDesc', 'pdfScanMeta']) for (const locale of [zh, en]) assert.ok(locale.home.toolNames[key]);
function flatten(value, prefix = '') {
  return Object.entries(value).flatMap(([key, item]) => typeof item === 'string' ? [[prefix + key, item]] : flatten(item, `${prefix}${key}.`));
}
const chinese = new Map(flatten(zh.home.pdfScan)), english = new Map(flatten(en.home.pdfScan));
assert.ok(zh.help.nav.pdfScan && en.help.nav.pdfScan);
assert.match(await read('src/app/templates/help.html'), /data-help-section="pdf-to-scan" data-i18n="help.nav.pdfScan"/);
for (const file of ['src/help-data.js', 'src/help-data-en.js']) assert.match(await read(file), /'pdf-to-scan':/);
assert.deepEqual([...chinese.keys()].sort(), [...english.keys()].sort());
for (const [key, value] of chinese) {
  assert.ok(value.trim() && english.get(key).trim());
  assert.deepEqual((value.match(/\{\w+\}/g) || []).sort(), (english.get(key).match(/\{\w+\}/g) || []).sort());
}
for (const match of (markup + previewControlsMarkup).matchAll(/home\.pdfScan\.([\w.-]+)/g)) assert.ok(chinese.has(match[1]), match[1]);
console.log('PDF scan home, lazy loading, bilingual UI, lifecycle and offline contracts passed');
