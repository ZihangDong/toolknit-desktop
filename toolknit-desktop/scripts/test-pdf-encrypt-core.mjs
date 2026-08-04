import assert from 'node:assert/strict';
import pdfLibPlusEncrypt from 'pdf-lib-plus-encrypt';
import {
  PDF_ENCRYPT_LIMITS,
  assertPdfEncryptInput,
  assertPdfEncryptPageCount,
  assertPdfEncryptPassword,
  assertPdfEncryptSelection,
  createPdfEncryptFileName,
  encryptPdf,
  normalizePdfEncryptPermissions
} from '../src/pdf-encrypt-core.js';

const { PDFDocument } = pdfLibPlusEncrypt;

const sourceDocument = await PDFDocument.create();
sourceDocument.addPage([612, 792]);
sourceDocument.addPage([420, 595]);
const source = await sourceDocument.save();
const progress = [];
const encrypted = await encryptPdf({
  fileData: source,
  password: 'strong-pass-2026',
  permissions: { printing: false, copying: false },
  onProgress: update => progress.push(update.percent)
});

assert.ok(encrypted.length > 0);
await assert.rejects(() => PDFDocument.load(encrypted));
assert.deepEqual(progress, [20, 60, 90]);
assert.deepEqual(normalizePdfEncryptPermissions({ printing: false, copying: false }), {
  printing: false,
  modifying: true,
  copying: false,
  annotating: true,
  fillingForms: true,
  contentAccessibility: true,
  documentAssembly: true
});
assert.equal(createPdfEncryptFileName('..\\unsafe/name.pdf'), 'name_encrypted.pdf');
assert.throws(() => assertPdfEncryptSelection([], 10));
assert.throws(() => assertPdfEncryptInput(new Uint8Array()));
assert.throws(() => assertPdfEncryptPageCount(PDF_ENCRYPT_LIMITS.maxPages + 1));
assert.throws(() => assertPdfEncryptPassword('short'));
await assert.rejects(() => encryptPdf({ fileData: encrypted, password: 'strong-pass-2026' }));

console.log('PDF encrypt core regression checks passed');
