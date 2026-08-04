import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { checkFfmpegAvailability, convertAudioBatch } from '../cli/lib/audio-runtime.mjs';
import { resolveFfmpeg } from '../cli/lib/ffmpeg-runtime.mjs';
import { ToolKnitError } from '../cli/lib/errors.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(projectRoot, 'cli', 'toolknit.mjs');
const ffmpegCommand = await resolveFfmpeg();

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? projectRoot,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(options.environment ?? {}) }
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', code => resolve({
      code,
      stdout: Buffer.concat(stdout).toString('utf8').trim(),
      stderr: Buffer.concat(stderr).toString('utf8').trim()
    }));
  });
}

async function createTone(filePath, frequency) {
  const result = await run(ffmpegCommand, [
    '-hide_banner', '-nostdin', '-y',
    '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=0.25`,
    '-c:a', 'pcm_s16le', filePath
  ]);
  assert.equal(result.code, 0, result.stderr);
}

function createMcpClient() {
  const child = spawn(process.execPath, [cliPath, 'mcp', 'serve'], {
    cwd: projectRoot,
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const pending = new Map();
  const notifications = [];
  let nextId = 1;
  let buffer = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let lineEnd;
    while ((lineEnd = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id === undefined) {
        notifications.push(message);
        continue;
      }
      const resolver = pending.get(message.id);
      if (resolver) {
        pending.delete(message.id);
        resolver.resolve(message);
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });

  return {
    notifications,
    request(method, params) {
      const id = nextId++;
      const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return response;
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    async close() {
      child.stdin.end();
      if (!child.killed) child.kill();
      await new Promise(resolve => child.once('close', resolve));
      assert.equal(stderr, '', `MCP must not write diagnostics to stderr: ${stderr}`);
    }
  };
}

const directory = await mkdtemp(path.join(os.tmpdir(), 'toolknit-audio-runtime-'));
let client;
try {
  const ffmpeg = await checkFfmpegAvailability();
  assert.equal(ffmpeg.available, true, 'FFmpeg must be available from the managed runtime, PATH, or TOOLKNIT_FFMPEG_PATH for audio runtime tests');

  const inputA = path.join(directory, 'tone-a.wav');
  const inputB = path.join(directory, 'tone-b.wav');
  await createTone(inputA, 440);
  await createTone(inputB, 660);
  const sourceBytes = (await stat(inputA)).size;

  const directOutput = path.join(directory, 'direct-output');
  const progress = [];
  const direct = await convertAudioBatch({
    input_paths: [inputA, inputB],
    output_dir: directOutput,
    target_format: 'mp3',
    quality: 'high'
  }, { reportProgress: (value, message) => progress.push({ value, message }) });
  assert.equal(direct.tool, 'audio.convert');
  assert.equal(direct.success_count, 2);
  assert.equal(direct.fail_count, 0);
  assert.equal(direct.quality, 'high');
  assert.equal(direct.outputs.length, 2);
  assert.equal(path.extname(direct.outputs[0].path), '.mp3');
  assert.ok((await stat(direct.outputs[0].path)).size > 0);
  assert.equal((await stat(inputA)).size, sourceBytes, 'conversion must not modify the source');
  assert.equal(progress[0].value, 0);
  assert.equal(progress.at(-1).value, 100);

  const secondPass = await convertAudioBatch({
    input_paths: [inputA],
    output_dir: directOutput,
    target_format: 'mp3'
  });
  assert.match(path.basename(secondPass.outputs[0].path), /^tone-a_1\.mp3$/);

  const aacOutput = path.join(directory, 'aac-output');
  const aac = await convertAudioBatch({
    input_paths: [inputA],
    output_dir: aacOutput,
    target_format: 'aac',
    quality: 'medium'
  });
  assert.equal(path.extname(aac.outputs[0].path), '.m4a');

  await assert.rejects(
    convertAudioBatch({ input_paths: [inputA, inputA], output_dir: path.join(directory, 'duplicate-output'), target_format: 'ogg' }),
    error => error instanceof ToolKnitError && error.code === 'INPUT_INVALID'
  );

  const badInput = path.join(directory, 'bad.mp3');
  await writeFile(badInput, 'not an audio stream');
  const failedOutput = path.join(directory, 'failed-output');
  await assert.rejects(
    convertAudioBatch({ input_paths: [badInput], output_dir: failedOutput, target_format: 'flac' }),
    error => error instanceof ToolKnitError && error.code === 'PROCESSING_FAILED' && error.details.errors.length === 1
  );
  assert.deepEqual(await readdir(failedOutput), [], 'failed conversion must not publish a named or temporary output');

  const audioHelp = await run(process.execPath, [cliPath, 'audio', '--help']);
  assert.equal(audioHelp.code, 0, audioHelp.stderr);
  assert.match(audioHelp.stdout, /ToolKnit 音频工具/);
  assert.match(audioHelp.stdout, /--output-dir/);

  const cliOutput = path.join(directory, 'cli-output');
  const cliResult = await run(process.execPath, [
    cliPath, 'audio', 'convert', '--input', inputA, '--output-dir', cliOutput,
    '--format', 'flac', '--quality', 'high', '--json'
  ]);
  assert.equal(cliResult.code, 0, cliResult.stderr);
  const cliPayload = JSON.parse(cliResult.stdout);
  assert.equal(cliPayload.ok, true);
  assert.equal(cliPayload.result.target_format, 'FLAC');
  assert.equal(path.extname(cliPayload.result.outputs[0].path), '.flac');

  const unexpectedCliOption = await run(process.execPath, [
    cliPath, 'audio', 'convert', '--input', inputA, '--output-dir', cliOutput,
    '--format', 'mp3', '--output', path.join(directory, 'ignored.mp3'), '--json'
  ]);
  assert.equal(unexpectedCliOption.code, 2);
  assert.equal(JSON.parse(unexpectedCliOption.stderr).error.code, 'USAGE');

  client = createMcpClient();
  const initialized = await client.request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'audio-runtime-test', version: '1.0.0' }
  });
  assert.equal(initialized.result.serverInfo.name, 'toolknit');
  client.notify('notifications/initialized', {});
  const listed = await client.request('tools/list', {});
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_audio_convert'));
  const mcpOutput = path.join(directory, 'mcp-output');
  const mcpResult = await client.request('tools/call', {
    name: 'toolknit_audio_convert',
    arguments: {
      input_paths: [inputB],
      output_dir: mcpOutput,
      target_format: 'ogg',
      quality: 'low'
    },
    _meta: { progressToken: 'audio-convert-test' }
  });
  assert.equal(mcpResult.result.isError, false);
  assert.equal(mcpResult.result.structuredContent.ok, true);
  assert.equal(path.extname(mcpResult.result.structuredContent.result.outputs[0].path), '.ogg');
  assert.ok(client.notifications.some(message => message.method === 'notifications/progress' && message.params.progressToken === 'audio-convert-test' && message.params.progress === 100));
  await client.close();
  client = null;
} finally {
  if (client) await client.close();
  await rm(directory, { recursive: true, force: true });
}

console.log('Audio conversion CLI and MCP runtime checks passed');
