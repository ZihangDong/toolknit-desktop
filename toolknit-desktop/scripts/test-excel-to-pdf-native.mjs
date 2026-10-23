import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, copyFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { checkLibreOfficeAvailability } from '../cli/lib/ppt-to-pdf-runtime.mjs';

const run = promisify(execFile);
const renderer = await checkLibreOfficeAvailability();
assert.ok(renderer.available, 'This opt-in integration test requires a real LibreOffice runtime.');
const root = await mkdtemp(path.join(os.tmpdir(), 'toolknit-excel-content-'));
const evidence = process.env.TOOLKNIT_EXCEL_TEST_EVIDENCE;
const checks = [];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const source = path.join(root, 'fixture.xlsx');
  const book = new ExcelJS.Workbook();
  const invoice = book.addWorksheet('Invoice');
  invoice.columns = [{ header: 'Item', width: 24 }, { header: 'Quantity', width: 14 }, { header: 'Total', width: 16 }];
  invoice.addRow(['VISIBLE_INVOICE', 3, { formula: 'B2*12', result: 36 }]);
  invoice.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1 };
  book.addWorksheet('Notes').addRow(['VISIBLE_NOTES']);
  book.addWorksheet('Internal', { state: 'hidden' }).addRow(['HIDDEN_WORKSHEET_CONTENT']);
  await book.xlsx.writeFile(source);
  for (const format of ['xlsx', 'xls', 'ods', 'xls-visible']) {
    const allVisible = format === 'xls-visible';
    const extension = format.split('-')[0];
    let fixture = source;
    if (allVisible) {
      book.getWorksheet('Internal').state = 'visible';
      fixture = path.join(root, 'visible-fixture.xlsx');
      await book.xlsx.writeFile(fixture);
    }
    let input = fixture;
    if (extension !== 'xlsx') {
      const directory = path.join(root, format);
      const profile = path.join(root, 'fixture-profile-' + format);
      await mkdir(directory); await mkdir(profile);
      await run(renderer.command, ['--headless', '--nologo', '--nodefault', '--norestore',
        '-env:UserInstallation=' + pathToFileURL(profile).href, '--convert-to',
        extension === 'xls' ? 'xls:MS Excel 97' : 'ods:calc8', '--outdir', directory, fixture],
      { windowsHide: true, timeout: 120000, env: { ...process.env, SAL_USE_VCLPLUGIN: 'svp', SAL_DISABLE_PRINTERLIST: '1' } });
      input = path.join(directory, path.parse(fixture).name + '.' + extension);
    }
    const originalHash = sha256(await readFile(input));
    const output = path.join(root, 'output-' + format);
    const started = Date.now();
    await run('cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml', 'excel_real_runtime_qa', '--lib', '--', '--ignored', '--nocapture'], {
      windowsHide: true, timeout: 600000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, TOOLKNIT_EXCEL_QA_FILE: input, TOOLKNIT_EXCEL_QA_OUTPUT_DIR: output }
    });
    assert.equal(sha256(await readFile(input)), originalHash, `${format}: original workbook is unchanged`);
    const directories = await readdir(output);
    assert.equal(directories.length, 2, `${format}: exactly two outputs, no temporary profile or staging directory`);
    for (const directory of directories) {
      const folder = path.join(output, directory);
      const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'));
      const mode = manifest.options.sheetRange;
      assert.ok(['all', 'visible'].includes(mode));
      const bytes = await readFile(path.join(folder, manifest.outputs[0].outputFile));
      const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, verbosity: 0 });
      try {
        const pdf = await loading.promise;
        const texts = [], dimensions = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const page = await pdf.getPage(pageNumber);
          texts.push((await page.getTextContent()).items.map(item => item.str).join(' '));
          const viewport = page.getViewport({ scale: 1 });
          dimensions.push([viewport.width, viewport.height]);
        }
        const text = texts.join('\n');
        assert.match(text, /VISIBLE_INVOICE/);
        assert.match(text, /VISIBLE_NOTES/);
        assert.match(text, /36/, `${format}: cached/recalculated formula value is rendered`);
        assert.equal(text.includes('HIDDEN_WORKSHEET_CONTENT'), mode === 'all' || allVisible, `${format}/${mode}: actual PDF must honor hidden-sheet selection`);
        assert.equal(pdf.numPages, mode === 'all' || allVisible ? 3 : 2, `${format}/${mode}: one page per nonempty selected worksheet`);
        if (mode === 'visible') assert.ok(dimensions.every(([w, h]) => Math.abs(w - 792) < 1 && Math.abs(h - 612) < 1), 'Letter landscape options reach the actual PDF');
        checks.push({ format, mode, pages: pdf.numPages, bytes: bytes.length, unchangedSource: true });
      } finally { await loading.destroy(); }
      if (evidence) {
        await mkdir(evidence, { recursive: true });
        await copyFile(path.join(folder, manifest.outputs[0].outputFile), path.join(evidence, `${format}-${mode}.pdf`));
      }
    }
    console.log(`PASS ${format}: real all/visible output content, formula, paper/orientation, source preservation and cleanup (${Date.now() - started} ms)`);
  }
  if (evidence) await writeFile(path.join(evidence, 'report.json'), JSON.stringify({ checks }, null, 2));
} finally {
  const relative = path.relative(os.tmpdir(), root);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  await rm(root, { recursive: true, force: true });
}
