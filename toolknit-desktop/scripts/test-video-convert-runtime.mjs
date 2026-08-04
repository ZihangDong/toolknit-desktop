import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { convertVideoBatch } from '../cli/lib/video-runtime.mjs';
import { ToolKnitError } from '../cli/lib/errors.mjs';
import { resolveFfmpeg, runFfmpeg } from '../cli/lib/ffmpeg-runtime.mjs';

async function makeVideo(command, filePath, frequency) {
  const result = await runFfmpeg(command, [
    '-hide_banner', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25:duration=1.5',
    '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=44100:duration=1.5`,
    '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', filePath
  ]);
  assert.equal(result.code, 0, result.stderr);
}

const directory = await mkdtemp(path.join(os.tmpdir(), 'toolknit-video-convert-'));
try {
  const command = await resolveFfmpeg();
  const firstInput = path.join(directory, 'first.mp4');
  const secondInput = path.join(directory, 'second.mp4');
  const outputDirectory = path.join(directory, 'output');
  await makeVideo(command, firstInput, 440);
  await makeVideo(command, secondInput, 880);

  const progress = [];
  const firstBatch = await convertVideoBatch({ input_paths: [firstInput, secondInput], output_dir: outputDirectory, target_format: 'webm' }, {
    reportProgress: (value, message) => progress.push({ value, message })
  });
  assert.equal(firstBatch.tool, 'video.convert');
  assert.equal(firstBatch.success_count, 2);
  assert.equal(firstBatch.fail_count, 0);
  assert.equal(firstBatch.target_format, 'WEBM');
  assert.ok(firstBatch.outputs.every(output => path.extname(output.path) === '.webm' && output.bytes > 0 && output.hardware_acceleration === false));
  assert.ok(progress.some(event => event.value === 0));
  assert.ok(progress.some(event => event.value === 100));

  const secondBatch = await convertVideoBatch({ input_paths: [firstInput], output_dir: outputDirectory, target_format: 'webm' });
  assert.notEqual(firstBatch.outputs[0].path, secondBatch.outputs[0].path);
  assert.equal(await stat(secondBatch.outputs[0].path).then(file => file.size > 0), true);

  await assert.rejects(
    () => convertVideoBatch({ input_paths: [firstInput, firstInput], output_dir: outputDirectory, target_format: 'mp4' }),
    error => error instanceof ToolKnitError && error.code === 'INPUT_INVALID'
  );
  await assert.rejects(
    () => convertVideoBatch({ input_paths: [firstInput], output_dir: outputDirectory, target_format: 'mpeg' }),
    error => error instanceof ToolKnitError && error.code === 'INVALID_ARGUMENT'
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('Video conversion runtime regression checks passed');
