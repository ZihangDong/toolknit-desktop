import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  PDF_COMPRESS_LIMITS,
  assertPdfCompressLevel,
  assertPdfCompressSelection,
  getPdfCompressErrorCode
} from '../src/pdf-compress-core.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const qpdfPath = join(projectRoot, 'src-tauri', 'resources', 'qpdf', 'qpdf.exe');
const auditDir = await mkdtemp(join(tmpdir(), 'toolknit-pdf-compress-'));

function runQpdf(args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(qpdfPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', rejectRun);
    child.once('close', code => code === 0 ? resolveRun({ stdout, stderr }) : rejectRun(new Error(stderr || stdout || `qpdf failed with exit code ${code}`)));
  });
}

const sourceDocument = await PDFDocument.create();
const font = await sourceDocument.embedFont(StandardFonts.Helvetica);
for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
  const page = sourceDocument.addPage([612, 792]);
  for (let line = 0; line < 90; line++) {
    page.drawText(`ToolKnit compression audit ${pageIndex + 1}-${line}: lossless stream optimization`, { x: 48, y: 740 - line * 7, size: 7, font });
  }
}

const rawPath = join(auditDir, 'raw.pdf');
const expandedPath = join(auditDir, 'expanded.pdf');
const compressedPath = join(auditDir, 'compressed.pdf');
await writeFile(rawPath, await sourceDocument.save({ useObjectStreams: false }));
await runQpdf(['--stream-data=uncompress', '--object-streams=disable', rawPath, expandedPath]);
await runQpdf(['--warning-exit-0', '--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9', expandedPath, compressedPath]);
const [expanded, compressed] = await Promise.all([readFile(expandedPath), readFile(compressedPath)]);
assert.ok(compressed.length < expanded.length);
const outputDocument = await PDFDocument.load(compressed);
assert.equal(outputDocument.getPageCount(), 3);
await runQpdf(['--check', compressedPath]);

assert.throws(() => assertPdfCompressSelection([]));
assert.throws(() => assertPdfCompressSelection([{ name: 'not-a-pdf.txt', size: 1 }]));
assert.throws(() => assertPdfCompressSelection([{ name: 'large.pdf', size: PDF_COMPRESS_LIMITS.maxInputBytes + 1 }]));
assert.throws(() => assertPdfCompressSelection(Array.from({ length: PDF_COMPRESS_LIMITS.maxFiles + 1 }, () => ({ name: 'file.pdf', size: 1 }))));
assert.throws(() => assertPdfCompressLevel('invalid'));
assert.doesNotThrow(() => assertPdfCompressLevel('high'));
assert.equal(getPdfCompressErrorCode('pdf-compress:input-too-large'), 'input-too-large');

console.log('PDF compress core and qpdf regression checks passed');
