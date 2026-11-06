import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { convertAudioBatch } from '../cli/lib/audio-runtime.mjs';
import { convertVideoBatch } from '../cli/lib/video-runtime.mjs';
import { clipAudio } from '../cli/lib/audio-clip-runtime.mjs';
import { extractAudio } from '../cli/lib/audio-extract-runtime.mjs';
import { extractVideoFrame } from '../cli/lib/video-frame-runtime.mjs';
import { extractVideoGif } from '../cli/lib/video-gif-runtime.mjs';

// An explicit candidate path prevents a PATH or bundled binary from accidentally
// supplying evidence for the wrong distribution. Only synthetic files are used.
assert.ok(process.env.TOOLKNIT_FFMPEG_PATH, 'Set TOOLKNIT_FFMPEG_PATH to the exact distribution under test.');
const ffmpeg = path.resolve(process.env.TOOLKNIT_FFMPEG_PATH);
const output = path.resolve('tmp/ffmpeg-distribution', Date.now().toString());
await mkdir(output, { recursive: true });
const report = { binarySha256: createHash('sha256').update(await readFile(ffmpeg)).digest('hex'), checks: [] };
const run = args => execFileSync(ffmpeg, ['-hide_banner', '-nostdin', '-y', ...args],
  { encoding: 'utf8', windowsHide: true, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
const checkOutput = async file => {
  assert.ok((await stat(file)).size > 0, 'Output must not be empty');
  run(['-v', 'error', '-i', file, '-f', 'null', '-']);
};
const done = label => { report.checks.push(label); console.log(`PASS ${label}`); };
try {
  report.version = run(['-version']).split(/\r?\n/)[0];
  const encoders = run(['-encoders']);
  for (const encoder of ['libx264', 'libx265', 'libmp3lame', 'libvorbis', 'libopus', 'libvpx-vp9', 'libwebp', 'aac', 'flac', 'alac', 'wmav2', 'wmv2', 'h264_nvenc']) {
    assert.match(encoders, new RegExp(`\\b${encoder}\\b`));
  }
  const filters = run(['-filters']);
  for (const filter of ['scale', 'crop', 'fps', 'palettegen', 'paletteuse', 'volume', 'aresample']) {
    assert.match(filters, new RegExp(`\\b${filter}\\b`));
  }
  done('product codecs, image codecs, filters and NVENC registration');
  const wav = path.join(output, '中文 音频.wav');
  const video = path.join(output, '中文 视频.mp4');
  run(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1.5', wav]);
  run(['-f', 'lavfi', '-i', 'testsrc2=size=160x96:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100',
    '-t', '1.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video]);
  const original = createHash('sha256').update(await readFile(video)).digest('hex');
  for (const format of ['mp3', 'aac', 'wav', 'flac', 'alac', 'ogg']) {
    const result = await convertAudioBatch({ input_paths: [wav], output_dir: path.join(output, 'audio'), target_format: format });
    assert.equal(result.success_count, 1); await checkOutput(result.outputs[0].path);
    done(`audio ${format} conversion and decoding`);
  }
  let firstMp4;
  for (const format of ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'wmv', 'ts']) {
    const result = await convertVideoBatch({ input_paths: [video], output_dir: path.join(output, 'video'), target_format: format });
    assert.equal(result.success_count, 1); await checkOutput(result.outputs[0].path);
    if (format === 'mp4') firstMp4 = { path: result.outputs[0].path, bytes: await readFile(result.outputs[0].path) };
    done(`video ${format} conversion and decoding`);
  }
  const extract = await extractAudio({ input_path: video, output_dir: path.join(output, 'extract'), target_format: 'flac' });
  await checkOutput(extract.output.path); done('audio track extraction');
  const clip = await clipAudio({ input_path: wav, output_dir: path.join(output, 'clips'), start_seconds: 0.1, end_seconds: 1 });
  await checkOutput(clip.output.path); done('audio clip');
  for (const format of ['png', 'jpg']) {
    const result = await extractVideoFrame({ input_path: video, output_dir: path.join(output, 'frames'), timestamp_ms: 500, format });
    await checkOutput(result.output_path); done(`${format} video frame`);
  }
  const gif = await extractVideoGif({ input_path: video, output_dir: path.join(output, 'gifs'), start_ms: 100, end_ms: 900, frame_rate: 10, width: 160 });
  await checkOutput(gif.output_path); done('palette-filter GIF extraction');
  const cropped = path.join(output, 'cropped.mp4');
  run(['-i', video, '-vf', 'crop=128:64:8:8,scale=160:80', '-c:v', 'libx264', '-an', cropped]);
  await checkOutput(cropped); done('desktop crop and background scaling filters');
  const hevc = path.join(output, 'hevc.mp4');
  run(['-i', video, '-an', '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'pools=1', hevc]);
  await checkOutput(hevc);
  const hevcConversion = await convertVideoBatch({ input_paths: [hevc], output_dir: path.join(output, 'hevc-converted'), target_format: 'mp4' });
  await checkOutput(hevcConversion.outputs[0].path); done('HEVC input decoding and x265 encoding');
  const webp = path.join(output, 'frame.webp');
  run(['-i', video, '-frames:v', '1', '-c:v', 'libwebp', webp]);
  await checkOutput(webp); done('WebP encoding and decoding');
  if (process.env.TOOLKNIT_FFMPEG_REFERENCE_PATH) {
    const av1 = path.join(output, 'av1.mp4');
    execFileSync(path.resolve(process.env.TOOLKNIT_FFMPEG_REFERENCE_PATH), ['-hide_banner', '-nostdin', '-y', '-i', video,
      '-an', '-c:v', 'libaom-av1', '-cpu-used', '8', '-crf', '50', av1], { windowsHide: true, timeout: 60000, stdio: 'pipe' });
    await checkOutput(av1);
    const av1Conversion = await convertVideoBatch({ input_paths: [av1], output_dir: path.join(output, 'av1-converted'), target_format: 'mp4' });
    await checkOutput(av1Conversion.outputs[0].path); done('AV1 input from an independent reference encoder');
  } else report.uncovered = ['AV1 input: set TOOLKNIT_FFMPEG_REFERENCE_PATH to generate the independent synthetic fixture.'];
  const speech = path.join(output, 'speech.wav');
  run(['-i', video, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', speech]);
  await checkOutput(speech); done('Whisper mono 16 kHz preprocessing');
  const repeat = await convertVideoBatch({ input_paths: [video], output_dir: path.join(output, 'video'), target_format: 'mp4' });
  assert.notEqual(repeat.outputs[0].path, firstMp4.path);
  assert.deepEqual(await readFile(firstMp4.path), firstMp4.bytes);
  assert.equal(createHash('sha256').update(await readFile(video)).digest('hex'), original);
  done('source preservation and repeated-output unique naming');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(convertVideoBatch({ input_paths: [video], output_dir: path.join(output, 'cancel'), target_format: 'mp4' }, { signal: controller.signal }), e => e.code === 'CANCELLED');
  done('cancelled request rejects without conversion');
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.stack; throw error; }
finally { await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
console.log(`Distribution compatibility evidence: ${output}`);
