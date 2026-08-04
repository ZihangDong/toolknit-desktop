import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clipAudio } from '../cli/lib/audio-clip-runtime.mjs';
import { ToolKnitError } from '../cli/lib/errors.mjs';
import { probeFfmpegDuration, resolveFfmpeg } from '../cli/lib/ffmpeg-runtime.mjs';

function createToneWav(sampleRate = 44100, seconds = 4) {
  const sampleCount = sampleRate * seconds;
  const output = Buffer.alloc(44 + sampleCount * 2);
  output.write('RIFF', 0);
  output.writeUInt32LE(36 + sampleCount * 2, 4);
  output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36);
  output.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index++) {
    output.writeInt16LE(Math.round(Math.sin(index / sampleRate * Math.PI * 880) * 0.5 * 32767), 44 + index * 2);
  }
  return output;
}

const directory = await mkdtemp(path.join(os.tmpdir(), 'toolknit-audio-clip-'));
try {
  const input = path.join(directory, 'tone.wav');
  const outputDirectory = path.join(directory, 'clips');
  await writeFile(input, createToneWav());
  const progress = [];
  const first = await clipAudio({ input_path: input, output_dir: outputDirectory, start_seconds: 1, end_seconds: 2.25 }, {
    reportProgress: (value, message) => progress.push({ value, message })
  });
  assert.equal(first.tool, 'audio.clip');
  assert.equal(first.output.stream_copy, true);
  assert.equal(first.output.format, 'wav');
  assert.equal(await stat(first.output.path).then(file => file.size > 0), true);
  const command = await resolveFfmpeg();
  assert.ok(Math.abs((await probeFfmpegDuration(command, first.output.path)) - 1.25) < 0.08);
  assert.ok(progress.some(event => event.value === 0));
  assert.ok(progress.some(event => event.value === 100));

  const second = await clipAudio({ input_path: input, output_dir: outputDirectory, start_seconds: 1, end_seconds: 2.25 });
  assert.notEqual(first.output.path, second.output.path);
  const mp3 = await clipAudio({ input_path: input, output_dir: outputDirectory, start_seconds: 0, end_seconds: 1, target_format: 'mp3' });
  assert.equal(path.extname(mp3.output.path), '.mp3');
  assert.equal(mp3.output.stream_copy, false);
  await assert.rejects(
    () => clipAudio({ input_path: input, output_dir: outputDirectory, start_seconds: 3, end_seconds: 3.05 }),
    error => error instanceof ToolKnitError && error.code === 'INVALID_ARGUMENT'
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('Audio clip runtime regression checks passed');
