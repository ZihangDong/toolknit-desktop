import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { analyzeTextFile, analyzeTextStats, readUtf8Stdin } from '../cli/lib/text-stats-runtime.mjs';
import { ToolKnitError } from '../cli/lib/errors.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'toolknit-text-stats-'));
try {
  const input = path.join(directory, 'brief.txt');
  const invalid = path.join(directory, 'binary.txt');
  await writeFile(input, '你好，world!\nitem 10\n最后一句', 'utf8');
  await writeFile(invalid, Buffer.from([0xff, 0xfe, 0x00, 0x01]));
  const progress = [];
  const result = await analyzeTextFile({ input_path: input }, { reportProgress: (value, message) => progress.push({ value, message }) });
  assert.equal(result.tool, 'text.stats');
  assert.equal(result.input.source, 'file');
  assert.equal(result.stats.words, 8);
  assert.ok(progress.some(event => event.value === 0));
  assert.ok(progress.some(event => event.value === 100));
  const stdinValue = await readUtf8Stdin(Readable.from([Buffer.from('alpha beta', 'utf8')]));
  assert.equal(analyzeTextStats(stdinValue.text, stdinValue.input).stats.englishWords, 2);
  await assert.rejects(() => analyzeTextFile({ input_path: invalid }), error => error instanceof ToolKnitError && error.code === 'INPUT_INVALID');
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('Text statistics runtime regression checks passed');
