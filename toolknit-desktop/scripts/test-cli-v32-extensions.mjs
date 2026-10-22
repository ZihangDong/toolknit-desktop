import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir, symlink, link } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { listTools, executeTool } from '../cli/lib/tool-registry.mjs';
import { readInputFile, writeOutputFile } from '../cli/lib/safe-files.mjs';
import { EXTENDED_OPERATIONS } from '../cli/lib/extended-tools.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'toolknit-v32-cli-'));
const call = (name, args, options = {}) => executeTool(`toolknit_${name}`, args, options);
const denied = (work, code) => assert.rejects(work, error => error.code === code);
try {
  const source = path.join(root, 'source.pdf');
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  const first = pdf.addPage([360, 480]); first.drawText('ToolKnit editable document', { x: 35, y: 420, size: 18, font });
  first.drawText('Source content must survive conversion.', { x: 35, y: 370, size: 11, font });
  const second = pdf.addPage([360, 480]); second.setRotation(degrees(90)); second.drawText('Second page', { x: 35, y: 400, size: 14, font });
  const sourceBytes = await pdf.save(); await writeFile(source, sourceBytes);
  const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
  const output = name => path.join(root, name);
  const secondSource = output('second-source.pdf'); await writeFile(secondSource, sourceBytes);
  for (const [name, parameters] of [
    ['pdf_merge', { input_paths: [source, secondSource], output_path: output('cancel-merge.pdf') }],
    ['pdf_rotate', { input_path: source, output_path: output('cancel-rotate.pdf'), rotation: 90 }],
    ['pdf_encrypt', { input_path: source, output_path: output('cancel-encrypt.pdf'), password: 'fixture-password' }],
    ['pdf_split', { input_path: source, output_dir: output('cancel-split'), pages: [1, 2] }],
    ['pdf_enhance', { input_path: source, output_path: output('cancel-enhance.pdf') }]
  ]) {
    const abort = new AbortController();
    await denied(call(name, parameters, { signal: abort.signal, reportProgress: () => abort.abort() }), 'CANCELLED');
    assert.ok(!(await readdir(root)).includes(path.basename(parameters.output_path || parameters.output_dir)), `${name} must not publish after cancellation`);
  }
  for (const tool of listTools()) {
    await assert.rejects(executeTool(tool.name, { unknown_v32_parameter: true }), error => error.code === 'INVALID_ARGUMENT', `${tool.name} rejects unknown parameters before work`);
  }
  assert.equal((await call('text_format', { text: 'a\na\nb', action: 'removeDuplicateLines' })).text, 'a\nb');
  assert.equal((await call('json', { text: '{"n":1}', indent: 'compact' })).text, '{"n":1}');
  const encoded = await call('base64', { text: '中文 email@example.test', action: 'encode' });
  assert.equal((await call('base64', { text: encoded.text, action: 'decode' })).text, '中文 email@example.test');
  await denied(call('base64', { text: 'secret-invalid-base64!', action: 'decode' }), 'INPUT_INVALID');
  const uri = await call('url_codec', { text: 'a b/中文', action: 'encode' });
  assert.equal((await call('url_codec', { text: uri.text, action: 'decode' })).text, 'a b/中文');
  assert.equal(new Set((await call('uuid', { count: 100 })).identifiers).size, 100);
  await denied(call('uuid', { count: '2' }), 'INVALID_ARGUMENT');
  const jwt = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"fixture"}').toString('base64url')}.signature`;
  const decoded = await call('jwt_decode', { text: jwt }); assert.equal(decoded.signature_verified, false); assert.equal(decoded.signature, undefined); assert.equal(decoded.payload.sub, 'fixture');
  assert.equal((await call('hash', { text: 'abc' })).checksum, createHash('sha256').update('abc').digest('hex'));
  assert.equal((await call('timestamp', { timestamp: 0, unit: 'seconds' })).iso, '1970-01-01T00:00:00.000Z');
  await denied(call('timestamp', { iso: '2026-10-22' }), 'INVALID_ARGUMENT');
  await denied(call('timestamp', { iso: '2026-10-22T00:00:00Z', timestamp: 0 }), 'INVALID_ARGUMENT');
  for (const iso of ['2026-02-30T00:00:00Z', '1900-02-29T00:00:00Z', '2026-01-01T24:00:00Z', '2026-04-31T12:00:00+08:00']) {
    await denied(call('timestamp', { iso }), 'INVALID_ARGUMENT');
  }
  assert.equal((await call('timestamp', { iso: '2000-02-29T00:00:00+08:00' })).iso, '2000-02-28T16:00:00.000Z');
  assert.equal((await call('bmi', { height: 200, weight: 80, age: 30, gender: 'male' })).calculation.bmi, 20);
  assert.equal((await call('mortgage', { principal: 100000, term_years: 10, annual_rate: 3 })).calculation.schedule.length, 120);
  assert.equal((await call('interest', { principal: 1000, term_years: 2, annual_rate: 5 })).calculation.totalAmount, 1100);
  assert.equal((await call('color_convert', { hex: '#ff0000' })).hex.toLowerCase(), '#ff0000');

  await call('pdf_create', { output_path: output('blank.pdf'), page_count: 3 });
  assert.equal((await PDFDocument.load(await readFile(output('blank.pdf')))).getPageCount(), 3);
  await call('pdf_page_number', { input_path: source, output_path: output('numbered.pdf'), template: 'Page {page} / {total}' });
  await call('pdf_text', { input_path: output('numbered.pdf'), output_path: output('text.md') });
  const markdown = await readFile(output('text.md'), 'utf8');
  assert.match(markdown, /ToolKnit editable document/); assert.match(markdown, /Page 1 \/ 2/);
  await call('pdf_crop', { input_path: source, output_path: output('cropped.pdf'), pages: [2], rect: { x: 0, y: 0, width: .5, height: 1 } });
  const cropped = await PDFDocument.load(await readFile(output('cropped.pdf')));
  assert.equal(cropped.getPage(0).getHeight(), 480); assert.equal(cropped.getPage(1).getHeight(), 240);
  await denied(call('pdf_crop', { input_path: source, output_path: output('bad-crop.pdf'), rect: { x: .8, y: 0, width: .5, height: 1 } }), 'INVALID_ARGUMENT');
  await call('pdf_to_scan', { input_path: source, output_path: output('scan.pdf'), mode: 'grayscale', pages: [1], dpi: 150 });
  assert.equal((await PDFDocument.load(await readFile(output('scan.pdf')))).getPageCount(), 1);
  await call('pdf_text', { input_path: output('scan.pdf'), output_path: output('scan.md') });
  assert.doesNotMatch(await readFile(output('scan.md'), 'utf8'), /Source content must survive/);
  for (const layout of ['original', 'a4']) {
    await call('pdf_to_word', { input_path: source, output_path: output(`${layout}.docx`), layout });
    const zip = await JSZip.loadAsync(await readFile(output(`${layout}.docx`)));
    const texts = [];
    const visit = node => { if (node.name === 'w:t') texts.push((node.elements || []).map(item => item.text || '').join('')); for (const child of node.elements || []) visit(child); };
    for (const name of Object.keys(zip.files).filter(name => /^word\/(?:document|header\d*|footer\d*)\.xml$/.test(name))) visit(xml2js(await zip.file(name).async('string')));
    assert.ok(texts.join('').replace(/\s/g, '').includes('ToolKniteditabledocument'), `${layout}: horizontal text remains editable across split Word runs and page chrome`);
    assert.ok(Object.keys(zip.files).some(name => name.startsWith('word/media/')), 'Rotated text retains its visible image fallback');
    assert.ok(zip.file('[Content_Types].xml'));
  }
  await denied(call('pdf_to_word', { input_path: source, output_path: output('original.docx') }), 'OUTPUT_EXISTS');
  await denied(call('pdf_crop', { input_path: source, output_path: source, overwrite: true, rect: { x: 0, y: 0, width: .5, height: 1 } }), 'OUTPUT_INVALID');
  const controller = new AbortController();
  const cancelled = call('pdf_to_scan', { input_path: source, output_path: output('cancelled.pdf') }, { signal: controller.signal, reportProgress: () => controller.abort() });
  await denied(cancelled, 'CANCELLED');
  assert.ok(!(await readdir(root)).includes('cancelled.pdf'));
  const gridPdf = await PDFDocument.create();
  for (let page = 0; page < 4; page++) gridPdf.addPage([72, 144]);
  await writeFile(output('grid-source.pdf'), await gridPdf.save());
  for (const mode of ['long-horizontal', 'grid']) {
    const exported = await call('pdf_to_image', { input_path: output('grid-source.pdf'), output_dir: output('grid'), mode, clarity: 'standard' });
    assert.equal(exported.output_count, 1);
    assert.equal(exported.outputs[0].width, mode === 'grid' ? 312 : 576);
    assert.equal(exported.outputs[0].height, mode === 'grid' ? 600 : 288);
  }
  assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'), sourceHash);
  await writeFile(output('existing.txt'), 'keep');
  const signal = AbortSignal.abort();
  await denied(writeOutputFile(output('existing.txt'), Buffer.from('new'), { overwrite: true, signal }), 'CANCELLED');
  assert.equal(await readFile(output('existing.txt'), 'utf8'), 'keep');
  await writeOutputFile(output('existing.txt'), Buffer.from('new'), { overwrite: true });
  assert.equal(await readFile(output('existing.txt'), 'utf8'), 'new');
  await link(source, output('alias.pdf'));
  await denied(writeOutputFile(output('alias.pdf'), Buffer.from('new'), { overwrite: true, inputPaths: [source] }), 'OUTPUT_INVALID');
  await mkdir(output('real'));
  await symlink(output('real'), output('linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await denied(writeOutputFile(path.join(output('linked'), 'result.txt'), Buffer.from('x')), 'OUTPUT_INVALID');
  await denied(readInputFile(path.join(output('linked'), 'anything.txt')), 'INPUT_INVALID');
  assert.ok(!(await readdir(root)).some(name => name.endsWith('.toolknit.tmp')));
  const stdout = execFileSync(process.execPath, ['cli/toolknit.mjs', 'dev', 'base64', '--action', 'encode', '--stdin', '--json'], { input: 'hello', encoding: 'utf8', windowsHide: true });
  assert.equal(JSON.parse(stdout).result.text, 'aGVsbG8=');
  for (const group of new Set(EXTENDED_OPERATIONS.map(item => item.command[0]))) {
    const help = execFileSync(process.execPath, ['cli/toolknit.mjs', group, '--help'], { encoding: 'utf8', windowsHide: true });
    for (const item of EXTENDED_OPERATIONS.filter(item => item.command[0] === group)) assert.ok(help.includes(`toolknit ${item.command.join(' ')} --help`));
  }
  console.log(`V3.2 extensions passed: ${listTools().length} schemas; utility operations, real PDFs/DOCX, crop rotation, cancellation and output safety.`);
} finally { await rm(root, { recursive: true, force: true }); }
