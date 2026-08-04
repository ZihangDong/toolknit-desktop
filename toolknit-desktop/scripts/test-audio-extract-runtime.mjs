import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractAudio } from '../cli/lib/audio-extract-runtime.mjs';
import { ToolKnitError } from '../cli/lib/errors.mjs';
import { resolveFfmpeg, runFfmpeg } from '../cli/lib/ffmpeg-runtime.mjs';

async function createFixture(command, filePath, withAudio) {
  const args = withAudio
    ? [
        '-hide_banner', '-nostdin', '-y',
        '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=25:d=1.5',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1.5',
        '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=44100:duration=1.5',
        '-map', '0:v:0', '-map', '1:a:0', '-map', '2:a:0', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', filePath
      ]
    : [
        '-hide_banner', '-nostdin', '-y',
        '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=25:d=1.5',
        '-c:v', 'mpeg4', filePath
      ];
  const result = await runFfmpeg(command, args);
  assert.equal(result.code, 0, result.stderr);
}

const directory = await mkdtemp(path.join(os.tmpdir(), 'toolknit-audio-extract-'));
try {
  const command = await resolveFfmpeg();
  const source = path.join(directory, 'two-tracks.mp4');
  const silentSource = path.join(directory, 'no-audio.mp4');
  const outputDirectory = path.join(directory, 'output');
  await createFixture(command, source, true);
  await createFixture(command, silentSource, false);

  const progress = [];
  const first = await extractAudio({ input_path: source, output_dir: outputDirectory, target_format: 'mp3', track_index: 0, quality: 'high' }, {
    reportProgress: (value, message) => progress.push({ value, message })
  });
  assert.equal(first.tool, 'audio.extract');
  assert.equal(first.track_index, 0);
  assert.equal(first.output.format, 'MP3');
  assert.equal(path.extname(first.output.path), '.mp3');
  assert.equal(await stat(first.output.path).then(file => file.size > 0), true);
  assert.ok(progress.some(event => event.value === 0));
  assert.ok(progress.some(event => event.value === 100));

  const second = await extractAudio({ input_path: source, output_dir: outputDirectory, target_format: 'wav', track_index: 1 });
  assert.equal(second.track_index, 1);
  assert.equal(path.extname(second.output.path), '.wav');
  assert.equal(await stat(second.output.path).then(file => file.size > 0), true);
  const repeated = await extractAudio({ input_path: source, output_dir: outputDirectory, target_format: 'mp3', track_index: 0 });
  assert.notEqual(repeated.output.path, first.output.path);

  await assert.rejects(
    () => extractAudio({ input_path: source, output_dir: outputDirectory, target_format: 'mp3', track_index: 2 }),
    error => error instanceof ToolKnitError && error.code === 'PROCESSING_FAILED'
  );
  await assert.rejects(
    () => extractAudio({ input_path: silentSource, output_dir: outputDirectory, target_format: 'mp3' }),
    error => error instanceof ToolKnitError && error.code === 'PROCESSING_FAILED'
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('Audio extraction runtime regression checks passed');
