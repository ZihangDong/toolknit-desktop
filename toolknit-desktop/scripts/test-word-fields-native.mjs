import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createWordFieldFixture } from './lib/word-field-fixtures.mjs';
import { word_to_pdf } from '../cli/lib/word-runtime.mjs';
import { resolveLibreOfficeRuntime } from '../cli/lib/ppt-render-runtime.mjs';

const run = promisify(execFile), base = path.resolve('tmp/word-fields');
await mkdir(base, { recursive: true });
const root = await mkdtemp(path.join(base, 'run-'));
const checks = [], outputs = [], requests = [];
const canary = createServer((request, response) => { requests.push(request.method); response.end('EXTERNAL_MUST_NOT_BE_FETCHED'); });
canary.listen(0, '127.0.0.1'); await once(canary, 'listening');
const cli = path.resolve('cli/toolknit.mjs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function lines(items) {
  const rows = new Map();
  for (const item of items) if ('str' in item) {
    const y = Math.round(item.transform[5] * 2) / 2;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(item);
  }
  return [...rows].sort((a, b) => b[0] - a[0]).map(([_y, parts]) => parts.sort((a, b) => a.transform[4] - b.transform[4]).map(item => item.str).join(' '));
}
async function inspect(file, updated, label, hasCaptionIndexes = true, hasLocalIndexes = true) {
  const loading = getDocument({ data: new Uint8Array(await readFile(file)), verbosity: 0, useSystemFonts: true });
  try {
    const pdf = await loading.promise, pages = [], body = new Map();
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n), rows = lines((await page.getTextContent()).items);
      const text = rows.join('\n'); pages.push({ rows, text });
      for (const match of text.matchAll(/BODY_ANCHOR_SECTION_(\d+)_/g)) body.set(Number(match[1]), n);
      const footer = text.match(/FOOTER_PAGE\s*(\d+)\s*\/\s*(\d+)/);
      assert.ok(footer, `${label}: footer ${n}`);
      assert.equal(Number(footer[1]), n); assert.equal(Number(footer[2]), pdf.numPages);
      page.cleanup();
    }
    assert.equal(body.size, 70, `${label}: all body sections retained`);
    assert.ok(pages[0].text.includes('TARGET_REFERENCE   TARGET_BOOKMARK_TEXT') || /TARGET_REFERENCE\s+TARGET_BOOKMARK_TEXT/.test(pages[0].text));
    assert.equal(Number(pages[0].text.match(/TARGET_PAGE\s+(\d+)/)?.[1]), body.get(70));
    assert.equal(Number(pages[0].text.match(/TOTAL_COUNT\s+(\d+)/)?.[1]), pdf.numPages);
    assert.ok(pages[0].text.includes('EXTERNAL_CACHED_TEXT'));
    const date = pages[0].text.match(/PRESERVED_DATE\s+(\d{4}-\d{2}-\d{2})/)?.[1]; assert.ok(date);
    if (hasCaptionIndexes) {
      assert.ok(pages.some(page => /LOCKED_DATE\s+2002-02-02/.test(page.text)), `${label}: locked date stays unchanged after pagination`);
      for (const marker of ['FIGURE', 'TABLE']) {
        assert.match(pages[body.get(70) - 1].text, new RegExp(`${marker}_LOCAL_CAPTION`));
        if (updated) {
          assert.ok(!pages.some(page => page.text.includes(`STALE_${marker}_INDEX`)));
          const row = pages.slice(0, body.get(1) - 1).flatMap(page => page.rows)
            .find(line => line.includes(`${marker}_LOCAL_CAPTION`));
          assert.equal(Number(row?.match(/(\d+)\s*$/)?.[1]), body.get(70), `${label}: ${marker} index points to the caption page`);
        } else {
          assert.ok(pages[0].text.includes(`STALE_${marker}_INDEX`), `${label}: the caption index cache survives by default`);
        }
      }
    }
    const extraFields = hasLocalIndexes ? pages.flatMap(page => page.rows).filter(row => /(?:EXPRESSION|PROPERTY)_VALUE/.test(row)).join('\n') : undefined;
    if (hasLocalIndexes) {
      assert.ok(extraFields, `${label}: skipped expressions and properties remain visible`);
      const targetPage = pages.findIndex(page => page.text.includes('LOCAL_INDEX_TARGET')) + 1;
      assert.ok(targetPage > 0);
      for (const [marker, entry] of [['ALPHA', 'ALPHABETIC_LOCAL_ENTRY'], ['CUSTOM', 'CUSTOM_LOCAL_ENTRY']]) {
        if (updated) {
          assert.ok(!pages.some(page => page.text.includes(`STALE_${marker}_INDEX`)));
          const rows = pages.slice(0, body.get(1) - 1).flatMap(page => page.rows).filter(row => !row.startsWith('FOOTER_PAGE'));
          const rowIndex = rows.findIndex(row => row.includes(entry));
          assert.ok(rowIndex >= 0, `${label}: ${marker} entry rebuilt`);
          // Writer may split an alphabetical index entry and its page onto adjacent rows.
          const reference = rows[rowIndex].match(/(\d+)\s*$/)?.[1] ?? rows[rowIndex + 1]?.match(/^[.\s]*(\d+)\s*$/)?.[1];
          assert.equal(Number(reference), targetPage, `${label}: ${marker} index points to actual target page`);
        } else assert.ok(pages[0].text.includes(`STALE_${marker}_INDEX`));
      }
    }
    if (updated) {
      assert.ok(!pages.some(page => page.text.includes('STALE_TOC')));
      const tocPages = body.get(1) - 1;
      assert.ok(tocPages >= 2, 'TOC crosses a page boundary');
      const entries = new Map();
      for (const page of pages.slice(0, tocPages)) for (const line of page.rows) {
        const match = line.match(/SECTION_(\d+)_.*?(\d+)\s*$/);
        if (match) entries.set(Number(match[1]), Number(match[2]));
      }
      assert.equal(entries.size, 70, `${label}: complete rebuilt TOC`);
      for (const [section, number] of entries) assert.equal(number, body.get(section), `${label}: TOC section ${section} points at its actual PDF page`);
    } else assert.ok(pages[0].text.includes('STALE_TOC 999'), 'default conversion does not explicitly rebuild the cached TOC');
    const evidence = { label, pageCount: pdf.numPages, tocUpdated: updated, sections: body.size, targetPage: body.get(70), footerChecks: pdf.numPages, date, extraFields };
    outputs.push(evidence); return evidence;
  } finally { await loading.destroy(); }
}
async function cliCall(name, args) {
  const file = path.join(root, `${name}.json`); await writeFile(file, JSON.stringify(args));
  const result = await run(process.execPath, [cli, 'run', 'toolknit_word_to_pdf', '--arguments-file', file, '--json'], { windowsHide: true, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.stderr, ''); return JSON.parse(result.stdout).result;
}
let nativeRoot;
try {
  const fixture = await createWordFieldFixture(root, { includeCaptionIndexes: true, includeLocalIndexes: true,
    externalUrl: `http://127.0.0.1:${canary.address().port}/blocked-field` });
  const sourceHash = digest(await readFile(fixture.source));
  const renderer = await resolveLibreOfficeRuntime(); assert.ok(renderer.available);
  const guard = await run(path.join(path.dirname(renderer.command), process.platform === 'win32' ? 'python.exe' : 'python3'),
    [path.resolve('scripts/test-word-index-guard.py'), renderer.command, fixture.source, path.join(root, 'guard-profile'),
      `http://127.0.0.1:${canary.address().port}/external-concordance.sdi`],
    { windowsHide: true, timeout: 180000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', SAL_USE_VCLPLUGIN: 'svp', SAL_DISABLE_PRINTERLIST: '1' } });
  const guardReport = JSON.parse(guard.stdout);
  assert.equal(guardReport.checks.length, 3); assert.equal(requests.length, 0);
  await writeFile(path.join(root, 'index-guard.json'), JSON.stringify(guardReport, null, 2));
  checks.push('actual Writer skips HTTP and file concordance sources without changing URLs or cached indexes; empty URL permits local XE update');
  const invalid = path.join(root, 'broken.docx'); await writeFile(invalid, 'invalid Word fixture');
  await assert.rejects(word_to_pdf({ input_path: fixture.source, output_path: path.join(root, 'never.pdf'), refresh_fields: 'true' }), error => error.code === 'INVALID_ARGUMENT');
  checks.push('nonboolean option rejected before conversion');
  const normal = await cliCall('default', { input_path: fixture.source, output_path: path.join(root, 'default.pdf') });
  assert.equal(normal.files[0].field_update, undefined);
  const before = await inspect(normal.output_path, false, 'CLI default'); checks.push('CLI default keeps cached TOC and existing dynamic-field behavior');
  const refreshed = await cliCall('updated', { input_path: fixture.source, output_path: path.join(root, 'updated.pdf'), refresh_fields: true });
  assert.equal(refreshed.files[0].field_update.indexes, 5); assert.ok(refreshed.files[0].field_update.skippedFields >= 6);
  const after = await inspect(refreshed.output_path, true, 'CLI refreshed');
  assert.ok(after.pageCount > before.pageCount); assert.equal(after.date, before.date);
  assert.equal(after.extraFields, before.extraFields, 'opt-in must not explicitly refresh expressions or custom properties');
  checks.push('CLI opt-in rebuilds 70-entry multipage TOC; all TOC targets, internal refs, page counts and footers match actual PDF pages');
  checks.push('figure and table indexes preserve their cache by default; opt-in resolves caption page numbers while a locked date remains unchanged');
  checks.push('alphabetical XE and marked TC indexes rebuild against actual PDF pages; expression and custom-property fields retain the default import results');
  const archive = new JSZip(); archive.file('目录/fields.docx', await readFile(fixture.source)); archive.file('broken.docx', 'invalid Word fixture');
  const zipPath = path.join(root, 'batch.zip'); await writeFile(zipPath, await archive.generateAsync({ type: 'nodebuffer' }));
  const zipHash = digest(await readFile(zipPath));
  const batch = await cliCall('zip', { input_paths: [zipPath], output_dir: path.join(root, 'zip-output'), refresh_fields: true });
  assert.equal(batch.status, 'partial'); assert.equal(batch.files[1].status, 'failed'); assert.ok(batch.outputs[0].field_update.stabilized);
  await inspect(batch.outputs[0].output_path, true, 'ZIP refreshed'); checks.push('ZIP batch carries opt-in per entry and retains successful refreshed output beside failed input');
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp', 'serve'], cwd: path.resolve('.'), stderr: 'pipe' });
  const client = new Client({ name: 'internal-fields-local-qa', version: '1' });
  try {
    await client.connect(transport);
    const response = await client.callTool({ name: 'toolknit_word_to_pdf', arguments: { input_path: fixture.source, output_path: path.join(root, 'mcp.pdf'), refresh_fields: true } }, undefined, { timeout: 180000 });
    assert.equal(response.isError, false); assert.ok(response.structuredContent.result.files[0].field_update.enabled);
    await inspect(response.structuredContent.result.output_path, true, 'MCP refreshed'); checks.push('actual MCP server receives opt-in and returns per-file update summary');
  } finally { await client.close(); }
  nativeRoot = await mkdtemp(path.join(os.tmpdir(), 'toolknit-fields-native-'));
  const native = await run('cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml', 'word_internal_fields_real_runtime_qa', '--lib', '--', '--ignored', '--test-threads=1'], {
    env: { ...process.env, TOOLKNIT_WORD_FIELDS_SOURCE: fixture.source, TOOLKNIT_WORD_FIELDS_INVALID: invalid, TOOLKNIT_WORD_FIELDS_OUTPUT: nativeRoot },
    windowsHide: true, timeout: 300000, maxBuffer: 4 * 1024 * 1024
  });
  await writeFile(path.join(root, 'native-tests.log'), native.stdout + native.stderr);
  const report = JSON.parse(await readFile(path.join(nativeRoot, 'report.json'), 'utf8'));
  for (const [name, result] of [['native-default', report.default], ['native-updated', report.updated]]) {
    const target = path.join(root, `${name}.pdf`); await copyFile(result.files[0].outputPath, target);
    await inspect(target, name === 'native-updated', name);
  }
  checks.push('actual Rust transport forwards false/true and isolates failed documents');
  // Produce a legacy DOC only from our own fixture without any external field.
  const safeLegacySource = await createWordFieldFixture(root, { name: 'legacy-source.docx', includeExternal: false, includeLocalIndexes: true });
  const legacyDir = path.join(root, 'legacy'); await mkdir(legacyDir);
  await run(renderer.command, ['--headless', '--nologo', '--nodefault', '--norestore',
    '-env:UserInstallation=' + pathToFileURL(path.join(root, 'legacy-profile')).href,
    '--convert-to', 'doc:MS Word 97', '--outdir', legacyDir, safeLegacySource.source], { windowsHide: true, timeout: 120000 });
  const legacy = await cliCall('legacy', { input_path: path.join(legacyDir, 'legacy-source.doc'), output_path: path.join(root, 'legacy.pdf'), refresh_fields: true });
  assert.equal(legacy.files[0].field_update.indexes, 3);
  await inspect(legacy.output_path, true, 'Legacy DOC refreshed', false); checks.push('legacy DOC imports expose the same outline TOC, alphabetical XE, marked TC and internal page/reference update contract');
  assert.equal(requests.length, 0, 'No conversion may fetch external INCLUDETEXT data'); checks.push('loopback external-data canary received zero requests across every conversion');
  assert.equal(digest(await readFile(fixture.source)), sourceHash); assert.equal(digest(await readFile(zipPath)), zipHash);
  checks.push('original DOCX and ZIP SHA-256 unchanged');
  const evidence = { root, checks, outputs, canaryRequests: requests.length, sourceUnchanged: true, zipUnchanged: true };
  await writeFile(path.join(root, 'report.json'), JSON.stringify(evidence, null, 2));
  await writeFile(path.join(base, 'report.json'), JSON.stringify(evidence, null, 2));
  console.log(`Word internal fields: ${checks.length} real acceptance groups, ${outputs.length} independently inspected PDFs; external requests: ${requests.length}.`);
} finally {
  if (nativeRoot) await rm(nativeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  canary.closeAllConnections(); await new Promise(resolve => canary.close(resolve));
}
