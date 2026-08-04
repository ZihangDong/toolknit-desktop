import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectAudioBpm } from '../cli/lib/bpm-runtime.mjs';
import { ToolKnitError } from '../cli/lib/errors.mjs';

function makeWav(samples, sampleRate) {
  const payloadBytes = samples.length * Int16Array.BYTES_PER_ELEMENT;
  const output = Buffer.alloc(44 + payloadBytes);
  output.write('RIFF', 0);
  output.writeUInt32LE(36 + payloadBytes, 4);
  output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36);
  output.writeUInt32LE(payloadBytes, 40);
  for (let index = 0; index < samples.length; index++) {
    output.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[index])) * 32767), 44 + index * 2);
  }
  return output;
}

const directory = await mkdtemp(path.join(os.tmpdir(), 'toolknit-bpm-runtime-'));
try {
  const sampleRate = 44100;
  const samples = new Float32Array(sampleRate * 20);
  for (let beat = 0; beat < 40; beat++) {
    const start = Math.round(beat * sampleRate * 0.5);
    for (let offset = 0; offset < 360; offset++) samples[start + offset] = (1 - offset / 360) * 0.85;
  }
  const beatFile = path.join(directory, 'click-120.wav');
  await writeFile(beatFile, makeWav(samples, sampleRate));
  const progress = [];
  const result = await detectAudioBpm({ input_path: beatFile }, { reportProgress: (value, message) => progress.push({ value, message }) });
  assert.equal(result.tool, 'audio.bpm');
  assert.ok(result.bpm >= 118 && result.bpm <= 122, `Expected 120 BPM, got ${result.bpm}`);
  assert.ok(result.confidence > 0.1);
  assert.equal(result.input.channels, 1);
  assert.ok(progress.some(event => event.value === 0));
  assert.ok(progress.some(event => event.value === 100));

  const badFile = path.join(directory, 'not-audio.txt');
  await writeFile(badFile, 'not audio');
  await assert.rejects(
    () => detectAudioBpm({ input_path: badFile }),
    error => error instanceof ToolKnitError && error.code === 'INPUT_INVALID'
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('BPM runtime regression checks passed');
