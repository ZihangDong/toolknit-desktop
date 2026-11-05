import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const run = promisify(execFile);
const inputs = JSON.parse(process.env.TOOLKNIT_WORD_QA_FILES || '[]');
assert.ok(
  Array.isArray(inputs) && inputs.length > 0 && inputs.length <= 20,
  'Set TOOLKNIT_WORD_QA_FILES to a JSON array of local DOC/DOCX paths.',
);
const output = await mkdtemp(path.join(os.tmpdir(), 'toolknit-word-batch-qa-'));
try {
  await run(
    'cargo',
    [
      'test',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      'word_real_batch_samples_qa',
      '--lib',
      '--',
      '--ignored',
      '--nocapture',
    ],
    {
      windowsHide: true,
      timeout: 600000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        TOOLKNIT_WORD_QA_FILES: JSON.stringify(inputs),
        TOOLKNIT_WORD_QA_OUTPUT: output,
      },
    },
  );
  const report = JSON.parse(
    await readFile(path.join(output, 'report.json'), 'utf8'),
  );
  assert.equal(report.files.length, inputs.length);
  const inspected = [];
  for (const [index, file] of report.files.entries()) {
    assert.equal(file.status, 'success', `Sample ${index + 1} failed conversion.`);
    assert.ok(file.outputPath && file.outputBytes > 0 && file.pageCount > 0);
    const bytes = await readFile(file.outputPath);
    const loading = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
    try {
      const pdf = await loading.promise;
      assert.ok(pdf.numPages > 0, `Sample ${index + 1} has no PDF pages.`);
      let textCharacters = 0;
      let drawingOperations = 0;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        try {
          const content = await page.getTextContent();
          textCharacters += content.items.reduce(
            (sum, item) => sum + String(item.str || '').trim().length,
            0,
          );
          drawingOperations += (await page.getOperatorList()).fnArray.length;
        } finally {
          page.cleanup();
        }
      }
      assert.ok(
        textCharacters > 0 || drawingOperations > 0,
        `Sample ${index + 1} produced pages without visible content.`,
      );
      inspected.push({
        index: index + 1,
        pages: pdf.numPages,
        bytes: bytes.length,
        textCharacters,
        drawingOperations,
      });
    } finally {
      await loading.destroy();
    }
  }
  console.log(
    JSON.stringify({ elapsedMs: report.elapsedMs, samples: inspected }, null, 2),
  );
} finally {
  await rm(output, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 });
}
