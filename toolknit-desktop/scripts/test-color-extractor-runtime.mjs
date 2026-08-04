import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { extractColorPalette } from '../cli/lib/color-extract-runtime.mjs';
import { ToolKnitError } from '../cli/lib/errors.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'toolknit-color-extract-'));
try {
  const input = path.join(directory, 'palette.png');
  const canvas = createCanvas(100, 50); const context = canvas.getContext('2d');
  context.fillStyle = '#FF0000'; context.fillRect(0, 0, 75, 50); context.fillStyle = '#0000FF'; context.fillRect(75, 0, 25, 50);
  await canvas.encode('png').then(bytes => import('node:fs/promises').then(({ writeFile }) => writeFile(input, bytes)));
  const progress = [];
  const result = await extractColorPalette({ input_path: input, count: 2 }, { reportProgress: (value, message) => progress.push({ value, message }) });
  assert.equal(result.tool, 'color.extract'); assert.equal(result.palette.length, 2); assert.equal(result.palette[0].hex, '#FF0000'); assert.equal(result.palette[0].percentage, 75); assert.equal(result.palette[1].hex, '#0000FF'); assert.equal(result.palette[1].percentage, 25);
  assert.ok(progress.some(event => event.value === 0)); assert.ok(progress.some(event => event.value === 100));
  await assert.rejects(() => extractColorPalette({ input_path: input, count: 1 }), error => error instanceof ToolKnitError && error.code === 'INVALID_ARGUMENT');
} finally { await rm(directory, { recursive: true, force: true }); }
console.log('Color extraction runtime regression checks passed');
