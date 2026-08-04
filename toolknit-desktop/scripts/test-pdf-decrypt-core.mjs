import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { PDFDocument, StandardFonts } from 'pdf-lib-plus-encrypt';
import { encryptPdf } from '../src/pdf-encrypt-core.js';
import {
  PDF_DECRYPT_LIMITS,
  assertPdfDecryptInputSize,
  assertPdfDecryptPageCount,
  assertPdfDecryptPassword,
  assertPdfDecryptSelection,
  getPdfDecryptErrorCode
} from '../src/pdf-decrypt-core.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const qpdfPath = join(projectRoot, 'src-tauri', 'resources', 'qpdf', 'qpdf.exe');
const auditDir = await mkdtemp(join(tmpdir(), 'toolknit-pdf-decrypt-'));

function runQpdf(args, password = '') {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(qpdfPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', rejectRun);
    child.once('close', code => {
      if (code === 0) {
        resolveRun({ stdout, stderr });
      } else {
        rejectRun(new Error(stderr || stdout || `qpdf failed with exit code ${code}`));
      }
    });
    child.stdin.end(`${password}\n`);
  });
}

const sourceDocument = await PDFDocument.create();
const font = await sourceDocument.embedFont(StandardFonts.Helvetica);
for (const text of ['decrypt audit page 1', 'decrypt audit page 2', 'decrypt audit page 3']) {
  const page = sourceDocument.addPage([612, 792]);
  page.drawText(text, { x: 72, y: 700, size: 18, font });
}

const encryptedPath = join(auditDir, 'source-encrypted.pdf');
const decryptedPath = join(auditDir, 'source-decrypted.pdf');
const ownerOnlyPath = join(auditDir, 'owner-only.pdf');
const ownerOnlyDecryptedPath = join(auditDir, 'owner-only-decrypted.pdf');
const encryptedBytes = await encryptPdf({
  fileData: await sourceDocument.save(),
  password: 'strong-pass-2026',
  permissions: { printing: false, copying: false }
});
await writeFile(encryptedPath, encryptedBytes);

await runQpdf(['--password-file=-', '--decrypt', encryptedPath, decryptedPath], 'strong-pass-2026');
const encryptionInfo = await runQpdf(['--show-encryption', decryptedPath]);
assert.match(encryptionInfo.stdout, /File is not encrypted/);
const decryptedDocument = await PDFDocument.load(await (await import('node:fs/promises')).readFile(decryptedPath));
assert.equal(decryptedDocument.getPageCount(), 3);
const ownerOnlyDocument = await PDFDocument.create();
ownerOnlyDocument.addPage([612, 792]);
await ownerOnlyDocument.encrypt({ userPassword: '', ownerPassword: 'owner-secret-2026' });
await writeFile(ownerOnlyPath, await ownerOnlyDocument.save());
await runQpdf(['--decrypt', ownerOnlyPath, ownerOnlyDecryptedPath]);
const ownerOnlyInfo = await runQpdf(['--show-encryption', ownerOnlyDecryptedPath]);
assert.match(ownerOnlyInfo.stdout, /File is not encrypted/);
await assert.rejects(
  () => runQpdf(['--password-file=-', '--decrypt', encryptedPath, join(auditDir, 'wrong-password.pdf')], 'wrong-password'),
  /password/i
);

assert.throws(() => assertPdfDecryptSelection([], 1));
assert.throws(() => assertPdfDecryptSelection([{ name: 'not-a-pdf.txt' }], 1));
assert.throws(() => assertPdfDecryptInputSize(PDF_DECRYPT_LIMITS.maxInputBytes + 1));
assert.throws(() => assertPdfDecryptPageCount(PDF_DECRYPT_LIMITS.maxPages + 1));
assert.throws(() => assertPdfDecryptPassword('line\nbreak'));
assert.doesNotThrow(() => assertPdfDecryptPassword(''));
assert.equal(getPdfDecryptErrorCode('pdf-decrypt:invalid-password'), 'invalid-password');
assert.equal(getPdfDecryptErrorCode(new Error('unexpected')), 'decryption-failed');

console.log('PDF decrypt core and qpdf regression checks passed');
