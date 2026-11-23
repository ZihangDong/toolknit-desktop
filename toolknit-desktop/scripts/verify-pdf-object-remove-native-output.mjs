import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeRemovalPdf } from '../src/features/pdf-object-remove/processor.js';
import { pdfRemovalRenderQa } from './lib/pdf-removal-render-qa.mjs';

const [inputPath, outputPath] = process.argv.slice(2);
assert.ok(inputPath && outputPath, 'Pass the selected fixture path and the real exported PDF path');
assert.notEqual(path.resolve(inputPath).toLowerCase(), path.resolve(outputPath).toLowerCase());
const fixture = 'tmp/pdf-content-predictor/source.pdf';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const expectedHash = sha256(await readFile(fixture));
assert.equal(sha256(await readFile(inputPath)), expectedHash, 'The selected fixture must match the original SHA-256');

const output = await readFile(outputPath);
const { summary } = await analyzeRemovalPdf(output);
assert.equal(summary.pageCount, 7);
assert.ok(summary.pages.every(page => !page.reason));
assert.ok(!summary.candidates.some(item => item.label === 'PREDICTED CONTENT MARK'));
assert.equal(summary.candidates.filter(item => item.label === 'Predictor retained body').length, 7);
assert.ok(summary.candidates.some(item => item.label === 'Form retained body'));

const root = await mkdtemp(path.resolve('tmp/pdf-object-remove-native-verification-'));
const qa = await pdfRemovalRenderQa(root);
const actual = await qa.save('export', output);
const clean = await qa.save('clean-reference', await readFile('tmp/pdf-content-predictor/clean-reference.pdf'));
await qa.verify(actual);
await qa.compare(actual, clean, 7, { allPdfjsPages: true });
const result = { sourceSha256: expectedHash, pageCount: summary.pageCount, ...qa.report() };
assert.equal(result.qpdfChecks, 1, 'Run with independent qpdf and Poppler checks enabled');
assert.equal(result.pixelChecks, 7);
assert.equal(result.pdfjsComparisons, 7);
await writeFile(path.join(root, 'report.json'), JSON.stringify(result, null, 2));
console.log('PDF output verification passed:', path.relative(process.cwd(), root));
