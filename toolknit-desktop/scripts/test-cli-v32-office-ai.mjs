import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { executeTool } from '../cli/lib/tool-registry.mjs';
import { checkLibreOfficeAvailability } from '../cli/lib/ppt-render-runtime.mjs';
import { inspectWorkbookArchive } from '../cli/lib/office-archive.mjs';
import { publishTemporaryOutput } from '../cli/lib/fs-safety.mjs';
import { withPdf } from '../cli/lib/pdf-headless.mjs';
import { runDocumentWorker } from '../cli/lib/document-worker.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'toolknit-cli-office-'));
const file = name => path.join(root, name), call = (name, args, options = {}) => executeTool(`toolknit_${name}`, args, options);
const env = { TOOLKNIT_AI_API_KEY: 'local-fixture-provider-credential', TOOLKNIT_AI_API_URL: 'http://127.0.0.1:1/v1', TOOLKNIT_AI_MODEL: 'fixture' };
const response = content => new Response(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
let server;
const savedEnvironment = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
try {
  const polished = await call('ai_polish', { text: 'hello world', style: 'formal' }, { env, fetchImpl: async () => response('Hello, world.') });
  assert.equal(polished.text, 'Hello, world.');
  const translated = await call('ai_translate', { text: 'Hello world.', target_language: 'zh-CN' }, { env, fetchImpl: async () => response({ pairs: [{ original: 'Hello world.', translated: '你好，世界。' }] }) });
  assert.equal(translated.text, '你好，世界。');
  await assert.rejects(call('ai_translate', { text: 'Hello world.', target_language: 'en' }, { env, fetchImpl: async () => response({ pairs: [{ original: 'wrong', translated: 'anything' }] }) }), error => error.code === 'PROVIDER_ERROR');
  await assert.rejects(call('ai_polish', { text: 'private fixture text', style: 'formal' }, { env, fetchImpl: async () => new Response('private server body ' + env.TOOLKNIT_AI_API_KEY, { status: 401 }) }), error => error.code === 'PROVIDER_ERROR' && !JSON.stringify(error).includes(env.TOOLKNIT_AI_API_KEY));
  await assert.rejects(call('ai_polish', { text: 'hello', style: 'formal' }, { env: {}, fetchImpl: () => assert.fail('No key must not issue a request') }), error => error.code === 'ENGINE_UNAVAILABLE');
  await assert.rejects(call('ai_translate', { text: 'hello', target_language: 'en' }, { env, signal: AbortSignal.abort(), fetchImpl: () => assert.fail('Cancelled request must not contact AI') }), error => error.code === 'CANCELLED');

  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([595, 842]);
  for (let row = 0; row < 8; row++) page.drawText(`Paragraph ${row + 1}: original content for layout analysis.`, { font, size: 12, x: 40, y: 750 - row * 42 });
  await writeFile(file('source.pdf'), await pdf.save());
  const loadCancellation = new AbortController();
  await assert.rejects(withPdf(await pdf.save(), async () => { loadCancellation.abort(); }, { signal: loadCancellation.signal }), error => error.code === 'CANCELLED');
  let visualCalls = 0, wordCalls = 0;
  server = createServer(async (request, reply) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    let content;
    if (Array.isArray(body.messages[1].content)) {
      const text = body.messages[1].content[0].text;
      assert.match(body.messages[1].content[1].image_url.url, /^data:image\/(?:png|jpeg);base64,/);
      if (text.startsWith('{')) {
        const wire = JSON.parse(text); wordCalls++;
        const group = scope => ({ scopeId: scope.scopeId, groups: scope.regions.map((region, index) => ({ id: `g${index}`, role: 'paragraph', sourceIds: [region.id] })), readingOrder: scope.regions.map((_, index) => `g${index}`) });
        content = { schemaVersion: wire.schemaVersion, requestId: wire.requestId, inputDigest: wire.inputDigest, sourceDigest: wire.sourceDigest, page: wire.page,
          ...(wire.scopes ? { scopes: wire.scopes.map(group) } : group(wire)) };
      } else { visualCalls++; content = { pageType: 'document', confidence: .9, blocks: [{ type: 'paragraph', text: 'Original fixture content.' }], warnings: [] }; }
    } else content = { title: 'Fixture', summary: 'Fixture summary.', outline: ['Page 1'] };
    reply.setHeader('content-type', 'application/json'); reply.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  env.TOOLKNIT_AI_API_URL = `http://127.0.0.1:${server.address().port}/v1`;
  const vision = await call('pdf_ai_markdown', { input_path: file('source.pdf'), output_path: file('vision.md') }, { env });
  assert.equal(vision.status, 'success'); assert.equal(visualCalls, 1); assert.match(await readFile(file('vision.md'), 'utf8'), /Original fixture content/);
  const visionCancellation = new AbortController();
  await assert.rejects(call('pdf_ai_markdown', { input_path: file('source.pdf'), output_path: file('cancelled-vision.md') }, {
    env, signal: visionCancellation.signal, fetchImpl: async () => { visionCancellation.abort(); throw new Error('Cancelled fixture.'); }
  }), error => error.code === 'CANCELLED');
  assert.ok(!(await readdir(root)).includes('cancelled-vision.md'));
  Object.assign(process.env, env);
  const word = await call('pdf_to_word', { input_path: file('source.pdf'), output_path: file('assisted.docx'), ai_mode: true, layout: 'a4' });
  assert.ok(wordCalls > 0); assert.ok(word.ai_review.reviewed > 0); assert.equal(word.ai_review.remaining, 0);
  assert.ok((await JSZip.loadAsync(await readFile(file('assisted.docx')))).file('word/document.xml'));

  await writeFile(file('source.md'), '# Document\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n$E=mc^2$\n\n<script>alert(1)</script>\n\n![private](https://example.invalid/tracker.png)');
  await call('markdown_html', { input_path: file('source.md'), output_path: file('result.html') });
  const html = await readFile(file('result.html'), 'utf8'); assert.match(html, /<table>/); assert.match(html, /<math/); assert.doesNotMatch(html, /<script|<img/); assert.match(html, /default-src 'none'/);

  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Sheet 1'); sheet.addRow(['Item', 'Price']); sheet.addRow(['Fixture', 42]);
  sheet.addTable({ name: 'LocalItems', ref: 'D1', headerRow: true, columns: [{ name: 'Amount' }], rows: [[5], [7]] });
  sheet.getCell('C1').value = { formula: 'SUM(LocalItems[Amount])', result: 12 };
  sheet.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1 };
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer()); await writeFile(file('workbook.xlsx'), xlsx);
  await inspectWorkbookArchive(xlsx);
  for (const formula of ["'[book.xlsx]Sheet 1'!A1", 'cmd|topic!item', 'WEBSERVICE("https://example.invalid")', 'IMAGE("https://example.invalid/image.png")']) {
    const external = new ExcelJS.Workbook(); external.addWorksheet('External').getCell('A1').value = { formula, result: 0 };
    await assert.rejects(inspectWorkbookArchive(Buffer.from(await external.xlsx.writeBuffer())), error => error.code === 'INPUT_INVALID');
  }
  const workerCancellation = new AbortController();
  const inspection = runDocumentWorker('workbook_inspect', { bytes: xlsx }, { signal: workerCancellation.signal });
  workerCancellation.abort();
  await assert.rejects(inspection, error => error.code === 'CANCELLED');
  const malicious = await JSZip.loadAsync(xlsx); malicious.file('xl/externalLinks/externalLink1.xml', '<x/>');
  await assert.rejects(inspectWorkbookArchive(await malicious.generateAsync({ type: 'nodebuffer' })), error => error.code === 'INPUT_INVALID');
  const office = await checkLibreOfficeAvailability();
  if (office.available) {
    const converted = await call('excel_to_pdf', { input_path: file('workbook.xlsx'), output_path: file('workbook.pdf') });
    assert.equal(converted.page_count, 1); assert.equal((await PDFDocument.load(await readFile(file('workbook.pdf')))).getPageCount(), 1);
    console.log('Real LibreOffice XLSX -> PDF passed.');
  } else {
    await assert.rejects(call('excel_to_pdf', { input_path: file('workbook.xlsx'), output_path: file('workbook.pdf') }), error => error.code === 'ENGINE_UNAVAILABLE');
    console.log('LibreOffice unavailable: structured missing-runtime path passed; actual XLSX rendering not covered.');
  }
  await writeFile(file('previous.pdf'), 'previous-valid-result');
  await assert.rejects(publishTemporaryOutput({ target: file('previous.pdf'), temporaryPath: file('missing.tmp'), overwrite: true }), error => error.code === 'OUTPUT_WRITE_FAILED');
  assert.equal(await readFile(file('previous.pdf'), 'utf8'), 'previous-valid-result');
  await writeFile(file('copy-one.txt'), 'duplicate fixture'); await writeFile(file('copy-two.txt'), 'duplicate fixture');
  const duplicate = await call('files_duplicates', { directory: root });
  assert.ok(duplicate.groups.some(group => group.files.some(item => item.path.endsWith('copy-one.txt')) && group.files.some(item => item.path.endsWith('copy-two.txt'))));
  assert.equal((await call('files_large', { directory: root, minimum_bytes: 0, max_files: 2 })).truncated, true);
  console.log('AI/Office/file-scan passed: local provider transport, content preservation, vision layout, privacy errors, HTML safety, ZIP preflight and read-only scanning.');
} finally {
  for (const [key, value] of Object.entries(savedEnvironment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
