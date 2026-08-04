import assert from 'node:assert/strict';
import {
  PDF_ENHANCE_LIMITS,
  assertPdfEnhancePagePlan,
  assertPdfEnhanceSelection,
  assertPdfEnhanceStrength,
  getPdfEnhanceErrorCode
} from '../src/pdf-enhance-core.js';

assert.doesNotThrow(() => assertPdfEnhanceSelection([{ name: 'scan.pdf', size: 1024 }]));
assert.throws(() => assertPdfEnhanceSelection([]), /single-file-required/);
assert.throws(() => assertPdfEnhanceSelection([{ name: 'scan.png', size: 1024 }]), /invalid-pdf/);
assert.throws(() => assertPdfEnhanceSelection([{ name: 'scan.pdf', size: PDF_ENHANCE_LIMITS.maxInputBytes + 1 }]), /input-too-large/);

assert.doesNotThrow(() => assertPdfEnhanceStrength('medium'));
assert.throws(() => assertPdfEnhanceStrength('maximum'), /invalid-strength/);

const validPlan = [{ outputWidth: 612, outputHeight: 792, renderWidth: 1530, renderHeight: 1980 }];
assert.equal(assertPdfEnhancePagePlan(validPlan).totalPixels, 3_029_400);
assert.throws(() => assertPdfEnhancePagePlan([]), /invalid-pdf/);
assert.throws(() => assertPdfEnhancePagePlan([{ outputWidth: 612, outputHeight: 792, renderWidth: 9000, renderHeight: 10 }]), /page-too-large/);
assert.throws(() => assertPdfEnhancePagePlan(Array.from({ length: 21 }, () => ({ outputWidth: 612, outputHeight: 792, renderWidth: 1530, renderHeight: 1980 }))), /document-too-large/);
assert.equal(getPdfEnhanceErrorCode('pdf-enhance:input-too-large'), 'input-too-large');
assert.equal(getPdfEnhanceErrorCode(new Error('PasswordException: No password given')), 'password-protected');

console.log('PDF enhance core contract checks passed');
