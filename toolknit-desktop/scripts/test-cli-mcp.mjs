import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { resolveFfmpeg, runFfmpeg } from '../cli/lib/ffmpeg-runtime.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cliPath = process.env.TOOLKNIT_CLI_ENTRY
  ? path.resolve(process.env.TOOLKNIT_CLI_ENTRY)
  : path.join(projectRoot, 'cli', 'toolknit.mjs');

function runCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: projectRoot,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(options.environment || {}) }
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout: Buffer.concat(stdout).toString('utf8').trim(), stderr: Buffer.concat(stderr).toString('utf8').trim() }));
    child.stdin.end(options.stdin ?? '');
  });
}

function parseCliJson(result) {
  assert.equal(result.stderr, '', `CLI must not write errors on success: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

async function createPdf(filePath, pages) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index++) {
    const page = pdf.addPage([240, 180]);
    page.drawText(`ToolKnit CLI test page ${index + 1}`, { x: 24, y: 90, size: 14 });
  }
  await writeFile(filePath, await pdf.save());
}

async function pdfPageCount(filePath) {
  return (await PDFDocument.load(await readFile(filePath))).getPageCount();
}

function createClickTrackWav(filePath, bpm = 120, seconds = 20, sampleRate = 44100) {
  const sampleCount = seconds * sampleRate;
  const payloadBytes = sampleCount * 2;
  const wav = Buffer.alloc(44 + payloadBytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + payloadBytes, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(payloadBytes, 40);
  const interval = sampleRate * 60 / bpm;
  for (let beat = 0; beat < seconds * bpm / 60; beat++) {
    const start = Math.round(beat * interval);
    for (let offset = 0; offset < 360 && start + offset < sampleCount; offset++) {
      wav.writeInt16LE(Math.round((1 - offset / 360) * 0.85 * 32767), 44 + (start + offset) * 2);
    }
  }
  return writeFile(filePath, wav);
}

async function createTwoTrackVideo(filePath) {
  const command = await resolveFfmpeg();
  const result = await runFfmpeg(command, [
    '-hide_banner', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=25:d=1.5',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1.5',
    '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=44100:duration=1.5',
    '-map', '0:v:0', '-map', '1:a:0', '-map', '2:a:0', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', filePath
  ]);
  assert.equal(result.code, 0, result.stderr);
}

function createMcpClient(environment = {}) {
  const child = spawn(process.execPath, [cliPath, 'mcp', 'serve'], {
    cwd: projectRoot,
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...environment }
  });
  const pending = new Map();
  let nextId = 1;
  let lineBuffer = '';
  let stderr = '';
  const notifications = [];

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    lineBuffer += chunk;
    let position;
    while ((position = lineBuffer.indexOf('\n')) !== -1) {
      const line = lineBuffer.slice(0, position).trim();
      lineBuffer = lineBuffer.slice(position + 1);
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
  child.once('error', error => {
    for (const resolver of pending.values()) resolver.reject(error);
    pending.clear();
  });

  return {
    async request(method, params) {
      const id = nextId++;
      const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return response;
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    notifications,
    async close() {
      child.stdin.end();
      if (!child.killed) child.kill();
      await new Promise(resolve => child.once('close', resolve));
      assert.equal(stderr, '', `MCP server must keep stderr empty: ${stderr}`);
    }
  };
}

const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'toolknit-cli-mcp-'));
let providerServer;
try {
  const firstPdf = path.join(fixtureDirectory, 'first.pdf');
  const secondPdf = path.join(fixtureDirectory, 'second.pdf');
  await createPdf(firstPdf, 2);
  await createPdf(secondPdf, 1);

  const pdfHelp = await runCli(['pdf', '--help']);
  assert.equal(pdfHelp.code, 0, pdfHelp.stderr);
  assert.match(pdfHelp.stdout, /ToolKnit PDF/);
  assert.match(pdfHelp.stdout, /toolknit pdf <工具> --help/);

  const mergeHelp = await runCli(['pdf', 'merge', '--help']);
  assert.equal(mergeHelp.code, 0, mergeHelp.stderr);
  assert.match(mergeHelp.stdout, /PDF 合并/);
  assert.match(mergeHelp.stdout, /page-selections/);

  const aliasHelp = await runCli(['help', 'pdf', 'merge']);
  assert.equal(aliasHelp.code, 0, aliasHelp.stderr);
  assert.equal(aliasHelp.stdout, mergeHelp.stdout);

  const agentGuide = await runCli(['agent', 'guide']);
  assert.equal(agentGuide.code, 0, agentGuide.stderr);
  assert.match(agentGuide.stdout, /ToolKnit AI Agent/);
  assert.match(agentGuide.stdout, /30 项 ToolKnit 工具/);
  assert.match(agentGuide.stdout, /toolknit_ai_document/);
  assert.match(agentGuide.stdout, /toolknit_ai_document_edit/);
  assert.match(agentGuide.stdout, /toolknit_ai_table/);
  assert.match(agentGuide.stdout, /toolknit_audio_convert/);
  assert.match(agentGuide.stdout, /toolknit_audio_bpm/);
  assert.match(agentGuide.stdout, /toolknit_audio_clip/);
  assert.match(agentGuide.stdout, /toolknit_video_convert/);
  assert.match(agentGuide.stdout, /toolknit_video_frame/);
  assert.match(agentGuide.stdout, /toolknit_video_gif/);
  assert.match(agentGuide.stdout, /toolknit_text_stats/);
  assert.match(agentGuide.stdout, /toolknit_color_extract/);
  assert.match(agentGuide.stdout, /toolknit_image_stitch/);
  assert.match(agentGuide.stdout, /toolknit_model_list/);
  assert.match(agentGuide.stdout, /toolknit_transcribe/);

  const englishAgentGuide = await runCli(['agent', 'guide', '--lang', 'en']);
  assert.equal(englishAgentGuide.code, 0, englishAgentGuide.stderr);
  assert.match(englishAgentGuide.stdout, /ToolKnit AI Agent Quick Guide/);
  assert.match(englishAgentGuide.stdout, /30 ToolKnit tools/);
  assert.match(englishAgentGuide.stdout, /toolknit_ai_document/);
  assert.match(englishAgentGuide.stdout, /toolknit_ai_document_edit/);
  assert.match(englishAgentGuide.stdout, /toolknit_ai_table/);
  assert.match(englishAgentGuide.stdout, /toolknit_audio_convert/);
  assert.match(englishAgentGuide.stdout, /toolknit_audio_bpm/);
  assert.match(englishAgentGuide.stdout, /toolknit_audio_clip/);
  assert.match(englishAgentGuide.stdout, /toolknit_video_convert/);
  assert.match(englishAgentGuide.stdout, /toolknit_video_frame/);
  assert.match(englishAgentGuide.stdout, /toolknit_video_gif/);
  assert.match(englishAgentGuide.stdout, /toolknit_text_stats/);
  assert.match(englishAgentGuide.stdout, /toolknit_color_extract/);
  assert.match(englishAgentGuide.stdout, /toolknit_image_stitch/);
  assert.match(englishAgentGuide.stdout, /toolknit_model_list/);
  assert.match(englishAgentGuide.stdout, /toolknit_transcribe/);

  const invalidAgentGuide = await runCli(['agent', 'guide', '--lang', 'invalid']);
  assert.equal(invalidAgentGuide.code, 2);
  assert.match(invalidAgentGuide.stderr, /--lang must be zh or en/);

  const mcpHelp = await runCli(['mcp', '--help']);
  assert.equal(mcpHelp.code, 0, mcpHelp.stderr);
  assert.match(mcpHelp.stdout, /ToolKnit MCP 服务/);
  assert.match(mcpHelp.stdout, /toolknit mcp serve/);
  const mcpAliasHelp = await runCli(['help', 'mcp']);
  assert.equal(mcpAliasHelp.code, 0, mcpAliasHelp.stderr);
  assert.equal(mcpAliasHelp.stdout, mcpHelp.stdout);

  const aiDocHelp = await runCli(['ai-doc', '--help']);
  assert.equal(aiDocHelp.code, 0, aiDocHelp.stderr);
  assert.match(aiDocHelp.stdout, /<工作区绝对路径>\\toolknit-output\\<文件名>\.pdf/);
  assert.match(aiDocHelp.stdout, /demo\\page-01-controls\.png/);
  assert.doesNotMatch(aiDocHelp.stdout, /\t/);

  const aiTableHelp = await runCli(['ai-table', '--help']);
  assert.equal(aiTableHelp.code, 0, aiTableHelp.stderr);
  assert.match(aiTableHelp.stdout, /ToolKnit AI 表格工程/);
  assert.match(aiTableHelp.stdout, /toolknit ai-table create --prompt-file/);
  assert.match(aiTableHelp.stdout, /preview\\preview\.png/);

  const aliasAiTableHelp = await runCli(['help', 'ai-table']);
  assert.equal(aliasAiTableHelp.code, 0, aliasAiTableHelp.stderr);
  assert.equal(aliasAiTableHelp.stdout, aiTableHelp.stdout);

  const agentHelp = await runCli(['help', 'agent']);
  assert.equal(agentHelp.code, 0, agentHelp.stderr);
  assert.equal(agentHelp.stdout, agentGuide.stdout);

  const inspect = await runCli(['pdf', 'inspect', '--input', firstPdf, '--json']);
  assert.equal(inspect.code, 0);
  assert.equal(parseCliJson(inspect).result.input.pages, 2);

  const forcedBanner = await runCli(['pdf', 'inspect', '--input', firstPdf, '--banner=always']);
  assert.equal(forcedBanner.code, 0, forcedBanner.stderr);
  assert.match(forcedBanner.stdout, /%%%%%%%%%/);
  assert.match(forcedBanner.stdout, /pdf\.inspect completed/);

  const jsonWithForcedBanner = await runCli(['pdf', 'inspect', '--input', firstPdf, '--banner=always', '--json']);
  assert.equal(jsonWithForcedBanner.code, 0, jsonWithForcedBanner.stderr);
  assert.doesNotMatch(jsonWithForcedBanner.stdout, /%%%%%%%%%/);
  assert.equal(parseCliJson(jsonWithForcedBanner).result.input.pages, 2);

  const mergedPdf = path.join(fixtureDirectory, 'merged.pdf');
  const merge = await runCli(['pdf', 'merge', '--input', firstPdf, '--input', secondPdf, '--output', mergedPdf, '--json']);
  assert.equal(merge.code, 0, merge.stderr);
  assert.equal(parseCliJson(merge).result.outputs[0].pages, 3);
  assert.equal(await pdfPageCount(mergedPdf), 3);

  const selectedMergedPdf = path.join(fixtureDirectory, 'selected-merged.pdf');
  const selection = JSON.stringify([{ input_index: 0, pages: [2] }]);
  const selectedMerge = await runCli(['pdf', 'merge', '--input', firstPdf, '--input', secondPdf, '--output', selectedMergedPdf, '--page-selections', selection, '--json']);
  assert.equal(selectedMerge.code, 0, selectedMerge.stderr);
  assert.equal(await pdfPageCount(selectedMergedPdf), 2);

  const sentinelOutput = path.join(fixtureDirectory, 'existing.pdf');
  await writeFile(sentinelOutput, 'do-not-replace');
  const overwriteRefusal = await runCli(['pdf', 'merge', '--input', firstPdf, '--input', secondPdf, '--output', sentinelOutput, '--json']);
  assert.equal(overwriteRefusal.code, 4);
  assert.equal(JSON.parse(overwriteRefusal.stderr).error.code, 'OUTPUT_EXISTS');
  assert.equal(await readFile(sentinelOutput, 'utf8'), 'do-not-replace');

  const rotatedPdf = path.join(fixtureDirectory, 'rotated.pdf');
  const rotate = await runCli(['pdf', 'rotate', '--input', firstPdf, '--output', rotatedPdf, '--rotation', '180', '--json']);
  assert.equal(rotate.code, 0, rotate.stderr);
  assert.equal(await pdfPageCount(rotatedPdf), 2);

  const splitDirectory = path.join(fixtureDirectory, 'split');
  const split = await runCli(['pdf', 'split', '--input', firstPdf, '--pages', '1,2', '--output-dir', splitDirectory, '--json']);
  assert.equal(split.code, 0, split.stderr);
  assert.equal(parseCliJson(split).result.outputs.length, 2);
  assert.equal(await pdfPageCount(path.join(splitDirectory, 'first_page_1.pdf')), 1);

  const encryptedPdf = path.join(fixtureDirectory, 'encrypted.pdf');
  const encrypt = await runCli(['pdf', 'encrypt', '--input', firstPdf, '--output', encryptedPdf, '--password-stdin', '--json'], { stdin: 'not-a-cli-password\n' });
  assert.equal(encrypt.code, 0, encrypt.stderr);
  assert.equal(await stat(encryptedPdf).then(file => file.size > 0), true);

  const decryptedPdf = path.join(fixtureDirectory, 'decrypted.pdf');
  const decrypt = await runCli(['pdf', 'decrypt', '--input', encryptedPdf, '--output', decryptedPdf, '--password-stdin', '--json'], { stdin: 'not-a-cli-password\n' });
  assert.equal(decrypt.code, 0, decrypt.stderr);
  assert.equal(await pdfPageCount(decryptedPdf), 2);

  const compressedPdf = path.join(fixtureDirectory, 'compressed.pdf');
  const compress = await runCli(['pdf', 'compress', '--input', mergedPdf, '--output', compressedPdf, '--level', 'high', '--json']);
  assert.equal(compress.code, 0, compress.stderr);
  const compressResult = parseCliJson(compress).result;
  assert.ok(compressResult.outputs.length === 1 || compressResult.warnings?.length === 1);

  const enhancedPdf = path.join(fixtureDirectory, 'enhanced.pdf');
  const enhance = await runCli(['pdf', 'enhance', '--input', firstPdf, '--output', enhancedPdf, '--strength', 'light', '--json']);
  assert.equal(enhance.code, 0, enhance.stderr);
  assert.equal(await pdfPageCount(enhancedPdf), 2);

  const bpmTrack = path.join(fixtureDirectory, 'click-120.wav');
  await createClickTrackWav(bpmTrack);
  const bpmHelp = await runCli(['audio', 'bpm', '--help']);
  assert.equal(bpmHelp.code, 0, bpmHelp.stderr);
  assert.match(bpmHelp.stdout, /BPM 节拍测速/);
  assert.match(bpmHelp.stdout, /前 120 秒/);
  const bpmCli = await runCli(['audio', 'bpm', '--input', bpmTrack, '--json']);
  assert.equal(bpmCli.code, 0, bpmCli.stderr);
  const bpmCliResult = parseCliJson(bpmCli).result;
  assert.equal(bpmCliResult.tool, 'audio.bpm');
  assert.ok(bpmCliResult.bpm >= 118 && bpmCliResult.bpm <= 122, `Expected 120 BPM, got ${bpmCliResult.bpm}`);
  assert.ok(bpmCliResult.confidence > 0.1);
  const invalidBpmCli = await runCli(['audio', 'bpm', '--json']);
  assert.equal(invalidBpmCli.code, 2);
  assert.equal(JSON.parse(invalidBpmCli.stderr).error.code, 'USAGE');
  const clipOutput = path.join(fixtureDirectory, 'clips');
  const clipCli = await runCli(['audio', 'clip', '--input', bpmTrack, '--start', '1', '--end', '2.25', '--output-dir', clipOutput, '--json']);
  assert.equal(clipCli.code, 0, clipCli.stderr);
  const clipCliResult = parseCliJson(clipCli).result;
  assert.equal(clipCliResult.tool, 'audio.clip');
  assert.equal(clipCliResult.output.stream_copy, true);
  assert.ok(await stat(clipCliResult.output.path).then(file => file.size > 0));

  const twoTrackVideo = path.join(fixtureDirectory, 'two-tracks.mp4');
  await createTwoTrackVideo(twoTrackVideo);
  const extractHelp = await runCli(['audio', 'extract', '--help']);
  assert.equal(extractHelp.code, 0, extractHelp.stderr);
  assert.match(extractHelp.stdout, /音频提取/);
  assert.match(extractHelp.stdout, /track-index/);
  const extractCli = await runCli(['audio', 'extract', '--input', twoTrackVideo, '--output-dir', path.join(fixtureDirectory, 'extracted'), '--format', 'mp3', '--track-index', '1', '--quality', 'high', '--json']);
  assert.equal(extractCli.code, 0, extractCli.stderr);
  const extractCliResult = parseCliJson(extractCli).result;
  assert.equal(extractCliResult.tool, 'audio.extract');
  assert.equal(extractCliResult.track_index, 1);
  assert.equal(extractCliResult.output.format, 'MP3');
  assert.ok(await stat(extractCliResult.output.path).then(file => file.size > 0));
  const invalidExtractCli = await runCli(['audio', 'extract', '--input', twoTrackVideo, '--output-dir', path.join(fixtureDirectory, 'extracted'), '--format', 'mp3', '--track-index', '32', '--json']);
  assert.equal(invalidExtractCli.code, 2);
  assert.equal(JSON.parse(invalidExtractCli.stderr).error.code, 'USAGE');

  const videoHelp = await runCli(['video', 'convert', '--help']);
  assert.equal(videoHelp.code, 0, videoHelp.stderr);
  assert.match(videoHelp.stdout, /视频格式转换/);
  assert.match(videoHelp.stdout, /hardware_acceleration/);
  const videoCli = await runCli(['video', 'convert', '--input', twoTrackVideo, '--output-dir', path.join(fixtureDirectory, 'video-converted'), '--format', 'webm', '--json']);
  assert.equal(videoCli.code, 0, videoCli.stderr);
  const videoCliResult = parseCliJson(videoCli).result;
  assert.equal(videoCliResult.tool, 'video.convert');
  assert.equal(videoCliResult.target_format, 'WEBM');
  assert.equal(videoCliResult.success_count, 1);
  assert.equal(videoCliResult.outputs[0].hardware_acceleration, false);
  assert.ok(await stat(videoCliResult.outputs[0].path).then(file => file.size > 0));
  const invalidVideoCli = await runCli(['video', 'convert', '--input', twoTrackVideo, '--output-dir', path.join(fixtureDirectory, 'video-converted'), '--format', 'mpeg', '--json']);
  assert.equal(invalidVideoCli.code, 2);
  assert.equal(JSON.parse(invalidVideoCli.stderr).error.code, 'USAGE');
  const videoFrameHelp = await runCli(['video', 'frame', '--help']);
  assert.equal(videoFrameHelp.code, 0, videoFrameHelp.stderr);
  assert.match(videoFrameHelp.stdout, /视频高清单帧图/);
  assert.match(videoFrameHelp.stdout, /timestamp-ms/);
  const videoFrameCli = await runCli(['video', 'frame', '--input', twoTrackVideo, '--output-dir', path.join(fixtureDirectory, 'video-frames'), '--timestamp-ms', '500', '--format', 'png', '--json']);
  assert.equal(videoFrameCli.code, 0, videoFrameCli.stderr);
  const videoFrameCliResult = parseCliJson(videoFrameCli).result;
  assert.equal(videoFrameCliResult.tool, 'video.frame');
  assert.equal(videoFrameCliResult.format, 'png');
  assert.ok(await stat(videoFrameCliResult.output_path).then(file => file.size > 0));
  const invalidVideoFrameCli = await runCli(['video', 'frame', '--input', twoTrackVideo, '--output-dir', path.join(fixtureDirectory, 'video-frames'), '--timestamp-ms', '-1', '--json']);
  assert.equal(invalidVideoFrameCli.code, 2);
  assert.equal(JSON.parse(invalidVideoFrameCli.stderr).error.code, 'USAGE');
  const videoGifHelp = await runCli(['video', 'gif', '--help']);
  assert.equal(videoGifHelp.code, 0, videoGifHelp.stderr);
  assert.match(videoGifHelp.stdout, /视频转 GIF/);
  assert.match(videoGifHelp.stdout, /30 秒/);
  const videoGifCli = await runCli(['video', 'gif', '--input', twoTrackVideo, '--output-dir', path.join(fixtureDirectory, 'video-gifs'), '--start-ms', '100', '--end-ms', '900', '--frame-rate', '10', '--width', '320', '--json']);
  assert.equal(videoGifCli.code, 0, videoGifCli.stderr);
  const videoGifCliResult = parseCliJson(videoGifCli).result;
  assert.equal(videoGifCliResult.tool, 'video.gif');
  assert.equal(videoGifCliResult.duration_ms, 800);
  assert.ok(await stat(videoGifCliResult.output_path).then(file => file.size > 0));
  const invalidVideoGifCli = await runCli(['video', 'gif', '--input', twoTrackVideo, '--output-dir', path.join(fixtureDirectory, 'video-gifs'), '--start-ms', '0', '--end-ms', '30001', '--json']);
  assert.equal(invalidVideoGifCli.code, 2);
  assert.equal(JSON.parse(invalidVideoGifCli.stderr).error.code, 'USAGE');

  const textInput = path.join(fixtureDirectory, 'notes.txt');
  await writeFile(textInput, '你好，world!\nitem 10\n最后一句', 'utf8');
  const textHelp = await runCli(['text', 'stats', '--help']);
  assert.equal(textHelp.code, 0, textHelp.stderr);
  assert.match(textHelp.stdout, /文本统计/);
  assert.match(textHelp.stdout, /--stdin/);
  const textCli = await runCli(['text', 'stats', '--input', textInput, '--json']);
  assert.equal(textCli.code, 0, textCli.stderr);
  const textCliResult = parseCliJson(textCli).result;
  assert.equal(textCliResult.tool, 'text.stats');
  assert.equal(textCliResult.input.source, 'file');
  assert.equal(textCliResult.stats.words, 8);
  const stdinTextCli = await runCli(['text', 'stats', '--stdin', '--json'], { stdin: 'alpha beta\n' });
  assert.equal(stdinTextCli.code, 0, stdinTextCli.stderr);
  assert.equal(parseCliJson(stdinTextCli).result.stats.englishWords, 2);
  const invalidTextCli = await runCli(['text', 'stats', '--input', textInput, '--stdin', '--json']);
  assert.equal(invalidTextCli.code, 2);
  assert.equal(JSON.parse(invalidTextCli.stderr).error.code, 'USAGE');
  const colorCli = await runCli(['image', 'colors', '--input', path.join(projectRoot, 'public', 'logo.png'), '--count', '3', '--json']);
  assert.equal(colorCli.code, 0, colorCli.stderr);
  assert.equal(parseCliJson(colorCli).result.tool, 'color.extract');
  assert.equal(parseCliJson(colorCli).result.palette.length, 3);
  const stitchFirst = path.join(fixtureDirectory, '拼接 01.png');
  const stitchSecond = path.join(fixtureDirectory, 'stitch-02.png');
  await copyFile(path.join(projectRoot, 'public', 'logo.png'), stitchFirst);
  await copyFile(path.join(projectRoot, 'public', 'logo.png'), stitchSecond);
  const stitchCli = await runCli(['image', 'stitch', '--input', stitchFirst, '--input', stitchSecond, '--output-dir', path.join(fixtureDirectory, 'cli-stitch'), '--spacing', '4', '--json']);
  assert.equal(stitchCli.code, 0, stitchCli.stderr);
  const stitchCliResult = parseCliJson(stitchCli).result;
  assert.equal(stitchCliResult.tool, 'image.stitch');
  assert.equal(stitchCliResult.count, 2);
  assert.equal(stitchCliResult.height, stitchCliResult.width * 2 + 4);
  assert.ok(await stat(stitchCliResult.output_path).then(file => file.size > 0));

  const generatedLayout = {
    ready: true,
    summary: 'Four-page ToolKnit MCP document test',
    pages: [
      { regions: [
        { type: 'title', x: 56, y: 60, w: 682, h: 50, text: 'ToolKnit 多页文档测试', fontSize: 30, bold: true, align: 'center' },
        { type: 'subtitle', x: 56, y: 120, w: 682, h: 24, text: 'MCP / PAGE 01', fontSize: 14, bold: false, align: 'center' },
        { type: 'table-row', x: 56, y: 170, w: 682, h: 42, text: '版本 | v1.2 | 形态 | CLI + MCP', fontSize: 13, bold: false, align: 'left' },
        { type: 'section-heading', x: 56, y: 242, w: 682, h: 34, text: '01 / 执行摘要', fontSize: 18, bold: true, align: 'left' },
        { type: 'emphasis', x: 56, y: 296, w: 682, h: 58, text: 'Agent 必须真实调用 ToolKnit，并在发布前校验输出页数。', fontSize: 14, bold: true, align: 'left' },
        { type: 'body', x: 56, y: 374, w: 682, h: 66, text: '此测试通过本地模拟的 OpenAI 兼容端点生成布局，不访问外部服务，也不会把测试密钥写入结果。', fontSize: 14, bold: false, align: 'left' },
        { type: 'note', x: 56, y: 462, w: 682, h: 50, text: '第一页用于验证标题、表格、强调区和中文字体。', fontSize: 12.5, bold: false, align: 'left' }
      ] },
      { regions: [
        { type: 'title', x: 56, y: 60, w: 682, h: 50, text: '验证与发布', fontSize: 30, bold: true, align: 'center' },
        { type: 'subtitle', x: 56, y: 120, w: 682, h: 24, text: 'MCP / PAGE 02', fontSize: 14, bold: false, align: 'center' },
        { type: 'section-heading', x: 56, y: 174, w: 682, h: 34, text: '02 / 验收清单', fontSize: 18, bold: true, align: 'left' },
        { type: 'table-row', x: 56, y: 228, w: 682, h: 42, text: '检查项 | 预期结果 | 状态', fontSize: 13, bold: true, align: 'left' },
        { type: 'table-row', x: 56, y: 270, w: 682, h: 42, text: '真实页数 | 4 页 | 通过', fontSize: 13, bold: false, align: 'left' },
        { type: 'table-row', x: 56, y: 312, w: 682, h: 42, text: '安全写入 | 不静默覆盖 | 通过', fontSize: 13, bold: false, align: 'left' },
        { type: 'body', x: 56, y: 382, w: 682, h: 66, text: '生成结果由 PDF 检查工具再次读取，确认实际页数与请求完全一致。', fontSize: 14, bold: false, align: 'left' },
        { type: 'note', x: 56, y: 470, w: 682, h: 50, text: '第二页用于验证表格连续性、页脚编号与原子发布。', fontSize: 12.5, bold: false, align: 'left' }
      ] },
      { regions: [
        { type: 'title', x: 56, y: 60, w: 682, h: 50, text: 'CLI 与 Agent 架构', fontSize: 30, bold: true, align: 'center' },
        { type: 'subtitle', x: 56, y: 120, w: 682, h: 24, text: 'MCP / PAGE 03', fontSize: 14, bold: false, align: 'center' },
        { type: 'section-heading', x: 56, y: 174, w: 682, h: 34, text: '03 / 能力契约', fontSize: 18, bold: true, align: 'left' },
        { type: 'table-row', x: 56, y: 228, w: 682, h: 42, text: '入口 | 输入 | 输出', fontSize: 13, bold: true, align: 'left' },
        { type: 'table-row', x: 56, y: 270, w: 682, h: 42, text: 'CLI | 文件与参数 | 明确路径', fontSize: 13, bold: false, align: 'left' },
        { type: 'table-row', x: 56, y: 312, w: 682, h: 42, text: 'MCP | 结构化参数 | 结构化结果', fontSize: 13, bold: false, align: 'left' },
        { type: 'emphasis', x: 56, y: 382, w: 682, h: 58, text: '桌面端、CLI 与 Agent 共享同一处理契约。', fontSize: 14, bold: true, align: 'left' },
        { type: 'note', x: 56, y: 462, w: 682, h: 50, text: '第三页用于验证加粗字体、表格和强调区的跨页稳定性。', fontSize: 12.5, bold: false, align: 'left' }
      ] },
      { regions: [
        { type: 'title', x: 56, y: 60, w: 682, h: 50, text: '发布验收', fontSize: 30, bold: true, align: 'center' },
        { type: 'subtitle', x: 56, y: 120, w: 682, h: 24, text: 'MCP / PAGE 04', fontSize: 14, bold: false, align: 'center' },
        { type: 'section-heading', x: 56, y: 174, w: 682, h: 34, text: '04 / 最终检查', fontSize: 18, bold: true, align: 'left' },
        { type: 'table-row', x: 56, y: 228, w: 682, h: 42, text: '责任角色 | 优先级 | 验收结果', fontSize: 13, bold: true, align: 'left' },
        { type: 'table-row', x: 56, y: 270, w: 682, h: 42, text: '维护者 | P0 | 真实 4 页', fontSize: 13, bold: false, align: 'left' },
        { type: 'table-row', x: 56, y: 312, w: 682, h: 42, text: '测试者 | P0 | 字体无缺字', fontSize: 13, bold: false, align: 'left' },
        { type: 'body', x: 56, y: 382, w: 682, h: 66, text: '最终文件必须能够重新打开，页脚从第一页连续编号到第四页，且不会泄露提供商密钥。', fontSize: 14, bold: false, align: 'left' },
        { type: 'note', x: 56, y: 470, w: 682, h: 50, text: '第四页用于完成真实多页、页脚和发布结果验收。', fontSize: 12.5, bold: false, align: 'left' }
      ] }
    ]
  };
  const generatedTable = {
    ready: true,
    title: '项目进度表',
    summary: 'ToolKnit AI table regression test',
    columns: [
      { key: 'task', label: '任务', type: 'text' },
      { key: 'owner', label: '负责人', type: 'text' },
      { key: 'progress', label: '完成率', type: 'number' },
      { key: 'due', label: '截止日期', type: 'date' }
    ],
    rows: [
      ['需求梳理', '张三', 80, '2026-08-10'],
      ['设计', '李四', 60, '2026-08-12'],
      ['开发', '王五', 40, '2026-08-15'],
      ['联调', '赵六', 20, '2026-08-18'],
      ['测试', '钱七', 10, '2026-08-20'],
      ['发布', '孙八', 0, '2026-08-22']
    ],
    charts: [
      { type: 'line', title: '完成率趋势', labelColumn: 0, valueColumns: [2] }
    ]
  };
  let providerAuthorization = '';
  providerServer = createServer((request, response) => {
    providerAuthorization = String(request.headers.authorization || '');
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(payload.model, 'toolknit-test-model');
      assert.equal(payload.messages.at(-1).role, 'user');
      response.writeHead(200, { 'content-type': 'application/json' });
      const isTableRequest = payload.messages.some(message => String(message.content || '').includes('table and chart engine'));
      const content = isTableRequest
        ? generatedTable
        : generatedLayout;
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
    });
  });
  await new Promise(resolve => providerServer.listen(0, '127.0.0.1', resolve));
  const providerAddress = providerServer.address();
  const aiEnvironment = {
    DEEPSEEK_API_KEY: 'toolknit-local-test-key',
    TOOLKNIT_AI_API_URL: `http://127.0.0.1:${providerAddress.port}/v1/chat/completions`,
    TOOLKNIT_AI_MODEL: 'toolknit-test-model'
  };
  const cliPromptPath = path.join(fixtureDirectory, 'document-brief.txt');
  const cliAiDocumentPath = path.join(fixtureDirectory, 'cli-ai-document.pdf');
  await writeFile(cliPromptPath, '生成四页 ToolKnit CLI 验证文档。使用以下明确提供的模拟数据：版本 v1.2，文档内列出的测试结果均允许写为通过。');
  const cliCreate = await runCli([
    'ai-doc', 'create', '--prompt-file', cliPromptPath, '--output', cliAiDocumentPath,
    '--page-count', '4', '--locale', 'zh-CN', '--json'
  ], { environment: aiEnvironment });
  assert.equal(cliCreate.code, 0, cliCreate.stderr);
  const cliCreateResult = parseCliJson(cliCreate).result;
  assert.equal(cliCreateResult.outputs.find(output => output.kind === 'pdf').pages, 4);
  assert.equal(await pdfPageCount(cliAiDocumentPath), 4);
  assert.equal(JSON.parse(await readFile(path.join(fixtureDirectory, 'cli-ai-document.toolknit.json'), 'utf8')).revision, 1);
  const cliCreateConflict = await runCli([
    'ai-doc', 'create', '--prompt', 'This provider call must never run.', '--output', cliAiDocumentPath,
    '--page-count', '4', '--json'
  ], { environment: { DEEPSEEK_API_KEY: '' } });
  assert.equal(cliCreateConflict.code, 4);
  assert.equal(JSON.parse(cliCreateConflict.stderr).error.code, 'OUTPUT_EXISTS');

  const tablePromptPath = path.join(fixtureDirectory, 'table-brief.txt');
  const cliAiTablePath = path.join(fixtureDirectory, 'cli-ai-table.xlsx');
  await writeFile(tablePromptPath, '生成一份 4 列 6 行的项目进度表，包含状态图表，导出为 xlsx。');
  const cliCreateTable = await runCli([
    'ai-table', 'create', '--prompt-file', tablePromptPath, '--output', cliAiTablePath,
    '--format', 'xlsx', '--locale', 'zh-CN', '--json'
  ], { environment: aiEnvironment });
  assert.equal(cliCreateTable.code, 0, cliCreateTable.stderr);
  const cliCreateTableResult = parseCliJson(cliCreateTable).result;
  assert.equal(cliCreateTableResult.outputs.find(output => output.kind === 'export').format, 'xlsx');
  assert.equal(cliCreateTableResult.table.columns, 4);
  assert.equal(cliCreateTableResult.table.rows, 6);
  assert.equal(cliCreateTableResult.table.charts, 1);
  assert.equal(await stat(cliAiTablePath).then(file => file.size > 1000), true);
  const cliAiTableProject = JSON.parse(await readFile(path.join(fixtureDirectory, 'cli-ai-table.toolknit-table.json'), 'utf8'));
  assert.equal(cliAiTableProject.schema, 'toolknit.ai-table');
  assert.equal(cliAiTableProject.revision, 1);
  assert.equal(cliAiTableProject.columns[0].number, 'C01');
  assert.equal(cliAiTableProject.rows[0].number, 'R01');
  assert.equal(cliAiTableProject.charts[0].number, 'G01');
  const cliCreateTableConflict = await runCli([
    'ai-table', 'create', '--prompt', 'This provider call must never run.', '--output', cliAiTablePath,
    '--format', 'xlsx', '--json'
  ], { environment: aiEnvironment });
  assert.equal(cliCreateTableConflict.code, 4);
  assert.equal(JSON.parse(cliCreateTableConflict.stderr).error.code, 'OUTPUT_EXISTS');

  const client = createMcpClient(aiEnvironment);
  const initialize = await client.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'toolknit-contract-test', version: '1.0.0' } });
  assert.equal(initialize.result.serverInfo.name, 'toolknit');
  assert.match(initialize.result.instructions, /workspace root/i);
  assert.match(initialize.result.instructions, /per-page high-resolution numbered map/i);
  assert.match(initialize.result.instructions, /stable row, column, and chart numbers/i);
  client.notify('notifications/initialized');
  const listed = await client.request('tools/list', {});
  assert.equal(listed.result.tools.length, 30);
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_pdf_merge'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_pdf_enhance'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_audio_convert'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_audio_bpm'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_audio_clip'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_audio_extract'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_model_list'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_model_install'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_model_use'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_transcribe'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_video_convert'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_video_frame'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_video_gif'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_text_stats'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_color_extract'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_image_stitch'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_ai_document'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_ai_document_inspect'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_ai_document_edit'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_ai_document_render'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_ai_table'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_ai_table_inspect'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_ai_table_edit'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'toolknit_ai_table_render'));
  const aiEditDefinition = listed.result.tools.find(tool => tool.name === 'toolknit_ai_document_edit');
  assert.equal(aiEditDefinition.inputSchema.properties.operations.items.additionalProperties, false);
  assert.match(aiEditDefinition.inputSchema.properties.operations.items.properties.control.anyOf[1].properties.source_path.description, /absolute path/i);

  const mcpBpm = await client.request('tools/call', {
    name: 'toolknit_audio_bpm',
    arguments: { input_path: bpmTrack },
    _meta: { progressToken: 'bpm-test' }
  });
  assert.equal(mcpBpm.result.isError, false, mcpBpm.result.content[0].text);
  assert.ok(mcpBpm.result.structuredContent.result.bpm >= 118 && mcpBpm.result.structuredContent.result.bpm <= 122);
  assert.ok(client.notifications.some(message => message.method === 'notifications/progress' && message.params.progressToken === 'bpm-test' && message.params.progress === 100));

  const mcpClip = await client.request('tools/call', {
    name: 'toolknit_audio_clip',
    arguments: { input_path: bpmTrack, output_dir: path.join(fixtureDirectory, 'mcp-clips'), start_seconds: 2, end_seconds: 4 },
    _meta: { progressToken: 'clip-test' }
  });
  assert.equal(mcpClip.result.isError, false, mcpClip.result.content[0].text);
  assert.equal(mcpClip.result.structuredContent.result.tool, 'audio.clip');
  assert.ok(client.notifications.some(message => message.method === 'notifications/progress' && message.params.progressToken === 'clip-test' && message.params.progress === 100));

  const mcpExtract = await client.request('tools/call', {
    name: 'toolknit_audio_extract',
    arguments: { input_path: twoTrackVideo, output_dir: path.join(fixtureDirectory, 'mcp-extracted'), target_format: 'flac', track_index: 0 },
    _meta: { progressToken: 'extract-test' }
  });
  assert.equal(mcpExtract.result.isError, false, mcpExtract.result.content[0].text);
  assert.equal(mcpExtract.result.structuredContent.result.tool, 'audio.extract');
  assert.equal(mcpExtract.result.structuredContent.result.track_index, 0);
  assert.ok(await stat(mcpExtract.result.structuredContent.result.output.path).then(file => file.size > 0));
  assert.ok(client.notifications.some(message => message.method === 'notifications/progress' && message.params.progressToken === 'extract-test' && message.params.progress === 100));

  const mcpVideo = await client.request('tools/call', {
    name: 'toolknit_video_convert',
    arguments: { input_paths: [twoTrackVideo], output_dir: path.join(fixtureDirectory, 'mcp-video'), target_format: 'mkv' },
    _meta: { progressToken: 'video-test' }
  });
  assert.equal(mcpVideo.result.isError, false, mcpVideo.result.content[0].text);
  assert.equal(mcpVideo.result.structuredContent.result.tool, 'video.convert');
  assert.equal(mcpVideo.result.structuredContent.result.outputs[0].format, 'MKV');
  assert.equal(mcpVideo.result.structuredContent.result.outputs[0].hardware_acceleration, false);
  assert.ok(await stat(mcpVideo.result.structuredContent.result.outputs[0].path).then(file => file.size > 0));
  assert.ok(client.notifications.some(message => message.method === 'notifications/progress' && message.params.progressToken === 'video-test' && message.params.progress === 100));

  const mcpVideoFrame = await client.request('tools/call', {
    name: 'toolknit_video_frame',
    arguments: { input_path: twoTrackVideo, output_dir: path.join(fixtureDirectory, 'mcp-video-frames'), timestamp_ms: 500, format: 'jpg' },
    _meta: { progressToken: 'video-frame-test' }
  });
  assert.equal(mcpVideoFrame.result.isError, false, mcpVideoFrame.result.content[0].text);
  assert.equal(mcpVideoFrame.result.structuredContent.result.tool, 'video.frame');
  assert.equal(mcpVideoFrame.result.structuredContent.result.format, 'jpg');
  assert.ok(await stat(mcpVideoFrame.result.structuredContent.result.output_path).then(file => file.size > 0));
  assert.ok(client.notifications.some(message => message.method === 'notifications/progress' && message.params.progressToken === 'video-frame-test' && message.params.progress === 100));

  const mcpVideoGif = await client.request('tools/call', {
    name: 'toolknit_video_gif',
    arguments: { input_path: twoTrackVideo, output_dir: path.join(fixtureDirectory, 'mcp-video-gifs'), start_ms: 100, end_ms: 900, frame_rate: 10, width: 320 },
    _meta: { progressToken: 'video-gif-test' }
  });
  assert.equal(mcpVideoGif.result.isError, false, mcpVideoGif.result.content[0].text);
  assert.equal(mcpVideoGif.result.structuredContent.result.tool, 'video.gif');
  assert.equal(mcpVideoGif.result.structuredContent.result.duration_ms, 800);
  assert.ok(await stat(mcpVideoGif.result.structuredContent.result.output_path).then(file => file.size > 0));
  assert.ok(client.notifications.some(message => message.method === 'notifications/progress' && message.params.progressToken === 'video-gif-test' && message.params.progress === 100));

  const mcpTextStats = await client.request('tools/call', {
    name: 'toolknit_text_stats',
    arguments: { input_path: textInput },
    _meta: { progressToken: 'text-stats-test' }
  });
  assert.equal(mcpTextStats.result.isError, false, mcpTextStats.result.content[0].text);
  assert.equal(mcpTextStats.result.structuredContent.result.tool, 'text.stats');
  assert.equal(mcpTextStats.result.structuredContent.result.stats.words, 8);
  assert.ok(client.notifications.some(message => message.method === 'notifications/progress' && message.params.progressToken === 'text-stats-test' && message.params.progress === 100));
  const mcpColors = await client.request('tools/call', { name: 'toolknit_color_extract', arguments: { input_path: path.join(projectRoot, 'public', 'logo.png'), count: 3 }, _meta: { progressToken: 'colors-test' } });
  assert.equal(mcpColors.result.isError, false, mcpColors.result.content[0].text);
  assert.equal(mcpColors.result.structuredContent.result.palette.length, 3);
  assert.ok(client.notifications.some(message => message.method === 'notifications/progress' && message.params.progressToken === 'colors-test' && message.params.progress === 100));
  const mcpStitch = await client.request('tools/call', { name: 'toolknit_image_stitch', arguments: { input_paths: [stitchSecond, stitchFirst], output_dir: path.join(fixtureDirectory, 'mcp-stitch'), output_name: 'mcp-long-strip', mode: 'horizontal', reference: 'first', spacing_px: 2, format: 'jpg', jpeg_quality: 92, background_rgba: '#000000FF' }, _meta: { progressToken: 'stitch-test' } });
  assert.equal(mcpStitch.result.isError, false, mcpStitch.result.content[0].text);
  assert.equal(mcpStitch.result.structuredContent.result.tool, 'image.stitch');
  assert.equal(mcpStitch.result.structuredContent.result.width, mcpStitch.result.structuredContent.result.height * 2 + 2);
  assert.equal(path.basename(mcpStitch.result.structuredContent.result.output_path), 'mcp-long-strip.jpg');
  assert.ok(await stat(mcpStitch.result.structuredContent.result.output_path).then(file => file.size > 0));
  assert.ok(client.notifications.some(message => message.method === 'notifications/progress' && message.params.progressToken === 'stitch-test' && message.params.progress === 100));

  const mcpInspect = await client.request('tools/call', { name: 'toolknit_pdf_inspect', arguments: { input_path: firstPdf } });
  assert.equal(mcpInspect.result.isError, false);
  assert.equal(mcpInspect.result.structuredContent.result.input.pages, 2);

  const mcpMergedPdf = path.join(fixtureDirectory, 'mcp-merged.pdf');
  const mcpMerge = await client.request('tools/call', { name: 'toolknit_pdf_merge', _meta: { progressToken: 'merge-test' }, arguments: { input_paths: [firstPdf, secondPdf], output_path: mcpMergedPdf } });
  assert.equal(mcpMerge.result.isError, false);
  assert.equal(await pdfPageCount(mcpMergedPdf), 3);
  assert.deepEqual(
    client.notifications
      .filter(message => message.method === 'notifications/progress' && message.params.progressToken === 'merge-test')
      .map(message => message.params.progress),
    [0, 100]
  );

  const mcpEnhancedPdf = path.join(fixtureDirectory, 'mcp-enhanced.pdf');
  const mcpEnhance = await client.request('tools/call', { name: 'toolknit_pdf_enhance', arguments: { input_path: firstPdf, output_path: mcpEnhancedPdf, strength: 'strong' } });
  assert.equal(mcpEnhance.result.isError, false);
  assert.equal(await pdfPageCount(mcpEnhancedPdf), 2);

  const mcpAiDocument = path.join(fixtureDirectory, 'mcp-ai-document.pdf');
  const aiDocument = await client.request('tools/call', {
    name: 'toolknit_ai_document',
    _meta: { progressToken: 'ai-document-test' },
    arguments: {
      prompt: '生成四页 ToolKnit MCP 验证文档。使用以下明确提供的模拟数据：版本 v1.2，文档内列出的测试结果均允许写为通过。',
      output_path: mcpAiDocument,
      page_count: 4,
      locale: 'zh-CN',
      overwrite: false
    }
  });
  assert.equal(aiDocument.result.isError, false, aiDocument.result.content[0].text);
  assert.equal(aiDocument.result.structuredContent.result.outputs[0].pages, 4);
  assert.equal(await pdfPageCount(mcpAiDocument), 4);
  assert.equal(providerAuthorization, 'Bearer toolknit-local-test-key');
  assert.doesNotMatch(JSON.stringify(aiDocument), /toolknit-local-test-key/);
  assert.deepEqual(
    client.notifications
      .filter(message => message.method === 'notifications/progress' && message.params.progressToken === 'ai-document-test')
      .map(message => message.params.progress),
    [0, 5, 15, 60, 68, 82, 90, 96, 100]
  );

  const aiProjectPath = path.join(fixtureDirectory, 'mcp-ai-document.toolknit.json');
  const aiDataPath = path.join(fixtureDirectory, 'mcp-ai-document.toolknit');
  const aiProject = JSON.parse(await readFile(aiProjectPath, 'utf8'));
  assert.equal(aiProject.schema, 'toolknit.ai-document');
  assert.equal(aiProject.revision, 1);
  assert.equal(aiProject.assets.length, 0);
  assert.equal(aiProject.pages.flatMap(page => page.controls).some(control => control.type === 'image'), false);
  assert.equal(aiProject.pages[0].controls[0].number, 'P1-01');
  assert.ok(aiProject.pages[0].controls[0].id);
  assert.equal((await stat(path.join(aiDataPath, 'preview', 'page-01.png'))).size > 1000, true);
  assert.equal((await stat(path.join(aiDataPath, 'demo', 'page-01-controls.png'))).size > 1000, true);
  assert.equal((await stat(path.join(aiDataPath, 'demo', 'controls-overview.png'))).size > 1000, true);
  const demoOutput = aiDocument.result.structuredContent.result.outputs.find(output => output.kind === 'demo');
  assert.equal(demoOutput.page_files.length, 4);
  assert.equal(demoOutput.page_files.every(filePath => path.isAbsolute(filePath)), true);
  assert.equal((await stat(path.join(aiDataPath, 'revisions', 'revision-0001.json'))).size > 1000, true);

  const mcpAiTable = path.join(fixtureDirectory, 'mcp-ai-table.xlsx');
  const aiTable = await client.request('tools/call', {
    name: 'toolknit_ai_table',
    _meta: { progressToken: 'ai-table-test' },
    arguments: {
      prompt: '生成一份 4 列 6 行的项目进度表，包含状态图表。',
      output_path: mcpAiTable,
      format: 'xlsx',
      locale: 'zh-CN',
      overwrite: false
    }
  });
  assert.equal(aiTable.result.isError, false, aiTable.result.content[0].text);
  assert.equal(aiTable.result.structuredContent.result.outputs.find(output => output.kind === 'export').format, 'xlsx');
  assert.equal(aiTable.result.structuredContent.result.table.columns, 4);
  assert.equal(aiTable.result.structuredContent.result.table.rows, 6);
  assert.equal(aiTable.result.structuredContent.result.table.charts, 1);
  assert.equal(await stat(mcpAiTable).then(file => file.size > 1000), true);
  assert.equal(providerAuthorization, 'Bearer toolknit-local-test-key');
  assert.doesNotMatch(JSON.stringify(aiTable), /toolknit-local-test-key/);
  assert.deepEqual(
    client.notifications
      .filter(message => message.method === 'notifications/progress' && message.params.progressToken === 'ai-table-test')
      .map(message => message.params.progress),
    [0, 5, 15, 45, 50, 75, 95, 100]
  );

  const aiTableProjectPath = path.join(fixtureDirectory, 'mcp-ai-table.toolknit-table.json');
  const aiTableDataPath = path.join(fixtureDirectory, 'mcp-ai-table.toolknit-table');
  const aiTableProject = JSON.parse(await readFile(aiTableProjectPath, 'utf8'));
  assert.equal(aiTableProject.schema, 'toolknit.ai-table');
  assert.equal(aiTableProject.revision, 1);
  assert.equal(aiTableProject.columns[0].number, 'C01');
  assert.equal(aiTableProject.rows[0].number, 'R01');
  assert.equal(aiTableProject.charts[0].number, 'G01');
  assert.equal((await stat(path.join(aiTableDataPath, 'preview', 'preview.png'))).size > 1000, true);
  assert.equal((await stat(path.join(aiTableDataPath, 'revisions', 'revision-0001.json'))).size > 1000, true);

  const tableInspect = await client.request('tools/call', {
    name: 'toolknit_ai_table_inspect',
    arguments: { project_path: aiTableProjectPath }
  });
  assert.equal(tableInspect.result.isError, false, tableInspect.result.content[0].text);
  assert.equal(tableInspect.result.structuredContent.result.project.revision, 1);
  assert.equal(tableInspect.result.structuredContent.result.table.columns.length, 4);
  assert.equal(tableInspect.result.structuredContent.result.table.rows.length, 6);
  assert.equal(tableInspect.result.structuredContent.result.table.charts.length, 1);
  assert.equal(tableInspect.result.structuredContent.result.artifacts.preview, path.join(aiTableDataPath, 'preview', 'preview.png'));

  const dryRunTableEdit = await client.request('tools/call', {
    name: 'toolknit_ai_table_edit',
    arguments: {
      project_path: aiTableProjectPath,
      dry_run: true,
      operations: [
        { type: 'update_cell', row: 'R01', column: 'C02', value: 'Alice' },
        { type: 'swap_rows', first: 'R01', second: 'R02' },
        { type: 'update_chart', chart: 'G01', title: '完成率趋势（更新）' }
      ]
    }
  });
  assert.equal(dryRunTableEdit.result.isError, false, dryRunTableEdit.result.content[0].text);
  assert.equal(dryRunTableEdit.result.structuredContent.result.dry_run, true);
  assert.equal(dryRunTableEdit.result.structuredContent.result.project.proposed_revision, 2);
  assert.equal(JSON.parse(await readFile(aiTableProjectPath, 'utf8')).revision, 1, 'AI table dry-run must not write the project.');

  const committedTableEdit = await client.request('tools/call', {
    name: 'toolknit_ai_table_edit',
    _meta: { progressToken: 'ai-table-edit-test' },
    arguments: {
      project_path: aiTableProjectPath,
      operations: [
        { type: 'update_cell', row: 'R01', column: 'C02', value: 'Alice' },
        { type: 'swap_rows', first: 'R01', second: 'R02' },
        { type: 'update_chart', chart: 'G01', title: '完成率趋势（更新）' }
      ]
    }
  });
  assert.equal(committedTableEdit.result.isError, false, committedTableEdit.result.content[0].text);
  assert.equal(committedTableEdit.result.structuredContent.result.project.revision, 2);
  assert.deepEqual(
    client.notifications
      .filter(message => message.method === 'notifications/progress' && message.params.progressToken === 'ai-table-edit-test')
      .map(message => message.params.progress),
    [0, 10, 35, 70, 95, 100]
  );
  assert.equal((await stat(path.join(aiTableDataPath, 'revisions', 'revision-0002.json'))).size > 1000, true);
  const editedTableProject = JSON.parse(await readFile(aiTableProjectPath, 'utf8'));
  assert.equal(editedTableProject.revision, 2);
  assert.equal(editedTableProject.rows[0].number, 'R02');
  assert.equal(editedTableProject.rows.find(row => row.number === 'R01').values[1], 'Alice');
  assert.equal(editedTableProject.charts.find(chart => chart.number === 'G01').title, '完成率趋势（更新）');

  const undoTableEdit = await client.request('tools/call', {
    name: 'toolknit_ai_table_edit',
    arguments: { project_path: aiTableProjectPath, operations: [{ type: 'undo', steps: 1 }] }
  });
  assert.equal(undoTableEdit.result.isError, false, undoTableEdit.result.content[0].text);
  assert.equal(undoTableEdit.result.structuredContent.result.project.revision, 3);
  const undoneTableProject = JSON.parse(await readFile(aiTableProjectPath, 'utf8'));
  assert.equal(undoneTableProject.revision, 3);
  assert.equal(undoneTableProject.rows[0].number, 'R01');
  assert.equal(undoneTableProject.rows.find(row => row.number === 'R01').values[1], '张三');
  assert.equal(undoneTableProject.charts.find(chart => chart.number === 'G01').title, '完成率趋势');

  const rerenderTable = await client.request('tools/call', {
    name: 'toolknit_ai_table_render',
    arguments: { project_path: aiTableProjectPath }
  });
  assert.equal(rerenderTable.result.isError, false, rerenderTable.result.content[0].text);
  assert.equal(rerenderTable.result.structuredContent.result.project.revision, 3);
  assert.equal((await stat(path.join(aiTableDataPath, 'preview', 'preview.png'))).size > 1000, true);

  const projectInspect = await client.request('tools/call', {
    name: 'toolknit_ai_document_inspect',
    arguments: { project_path: aiProjectPath }
  });
  assert.equal(projectInspect.result.isError, false, projectInspect.result.content[0].text);
  assert.equal(projectInspect.result.structuredContent.result.project.revision, 1);
  assert.equal(projectInspect.result.structuredContent.result.project.pages[0].controls[0].number, 'P1-01');
  assert.equal(projectInspect.result.structuredContent.result.artifacts.numberedPages.length, 4);

  const operationsFile = path.join(fixtureDirectory, 'operations.json');
  await writeFile(operationsFile, JSON.stringify([
    { type: 'update_text', control: 'P1-01', text: 'CLI dry-run title' }
  ]));
  const cliDryRun = await runCli([
    'ai-doc', 'edit', '--project', aiProjectPath, '--operations-file', operationsFile, '--dry-run', '--json'
  ]);
  assert.equal(cliDryRun.code, 0, cliDryRun.stderr);
  assert.equal(parseCliJson(cliDryRun).result.dry_run, true);
  assert.equal(JSON.parse(await readFile(aiProjectPath, 'utf8')).revision, 1, 'dry-run must not write the project.');

  const dryRunEdit = await client.request('tools/call', {
    name: 'toolknit_ai_document_edit',
    arguments: {
      project_path: aiProjectPath,
      dry_run: true,
      operations: [
        { type: 'update_style', control: 'P1-01', style: { backgroundColor: '#000000', textColor: '#FFFFFF', fontSize: 32 } },
        { type: 'swap_positions', first: 'P1-01', second: 'P1-02' }
      ]
    }
  });
  assert.equal(dryRunEdit.result.isError, false, dryRunEdit.result.content[0].text);
  assert.equal(dryRunEdit.result.structuredContent.result.dry_run, true);
  assert.equal(dryRunEdit.result.structuredContent.result.project.proposed_revision, 2);
  assert.equal(JSON.parse(await readFile(aiProjectPath, 'utf8')).revision, 1, 'MCP dry-run must not write the project.');

  const imagePath = path.join(fixtureDirectory, 'inserted-image.png');
  const { createCanvas } = await import('@napi-rs/canvas');
  const imageCanvas = createCanvas(640, 320);
  const imageContext = imageCanvas.getContext('2d');
  imageContext.fillStyle = '#FFFFFF';
  imageContext.fillRect(0, 0, imageCanvas.width, imageCanvas.height);
  imageContext.fillStyle = '#111111';
  imageContext.font = 'bold 48px sans-serif';
  imageContext.fillText('ToolKnit', 180, 175);
  await writeFile(imagePath, imageCanvas.toBuffer('image/png'));

  const missingImageSource = await client.request('tools/call', {
    name: 'toolknit_ai_document_edit',
    arguments: {
      project_path: aiProjectPath,
      dry_run: true,
      operations: [{ type: 'insert_control', after: 'P1-01', control: { type: 'image', label: 'Missing source', w: 320, h: 160 } }]
    }
  });
  assert.equal(missingImageSource.result.isError, true);
  assert.equal(missingImageSource.result.structuredContent.error.code, 'INVALID_ARGUMENT');
  assert.match(missingImageSource.result.structuredContent.error.message, /requires an absolute source_path/i);

  const relativeImageSource = await client.request('tools/call', {
    name: 'toolknit_ai_document_edit',
    arguments: {
      project_path: aiProjectPath,
      dry_run: true,
      operations: [{ type: 'insert_control', after: 'P1-01', control: { type: 'image', source_path: 'inserted-image.png', label: 'Relative source', w: 320, h: 160 } }]
    }
  });
  assert.equal(relativeImageSource.result.isError, true);
  assert.equal(relativeImageSource.result.structuredContent.error.code, 'INVALID_ARGUMENT');
  assert.match(relativeImageSource.result.structuredContent.error.message, /must be an absolute/i);
  assert.equal(JSON.parse(await readFile(aiProjectPath, 'utf8')).revision, 1);

  const pageDriftOperations = [{
    type: 'insert_control',
    after: 'P1-01',
    control: { type: 'image', source_path: imagePath, label: 'Oversized flow image', w: 640, h: 900 }
  }];
  const pageDriftDryRun = await client.request('tools/call', {
    name: 'toolknit_ai_document_edit',
    arguments: { project_path: aiProjectPath, operations: pageDriftOperations, dry_run: true }
  });
  assert.equal(pageDriftDryRun.result.isError, false, pageDriftDryRun.result.content[0].text);
  assert.ok(pageDriftDryRun.result.structuredContent.result.diagnostics.some(diagnostic => diagnostic.code === 'page_count_changed'));
  const pageDriftCommit = await client.request('tools/call', {
    name: 'toolknit_ai_document_edit',
    arguments: { project_path: aiProjectPath, operations: pageDriftOperations }
  });
  assert.equal(pageDriftCommit.result.isError, true);
  assert.equal(pageDriftCommit.result.structuredContent.error.code, 'INVALID_ARGUMENT');
  assert.ok(pageDriftCommit.result.structuredContent.error.details.diagnostics.some(diagnostic => diagnostic.code === 'page_count_changed'));
  assert.equal(JSON.parse(await readFile(aiProjectPath, 'utf8')).revision, 1, 'A page-count-changing edit must not be published.');

  const committedEdit = await client.request('tools/call', {
    name: 'toolknit_ai_document_edit',
    _meta: { progressToken: 'ai-edit-test' },
    arguments: {
      project_path: aiProjectPath,
      operations: [
        { type: 'update_style', control: 'P1-01', style: { backgroundColor: '#000000', textColor: '#FFFFFF', fontSize: 32 } },
        { type: 'update_style', control: 'P1-03', style: { backgroundColor: '#F2F2F2', borderColor: '#111111', borderWidth: 1, dividerColor: '#111111', dividerWidth: 2 } },
        { type: 'swap_positions', first: 'P1-01', second: 'P1-02' },
        { type: 'insert_control', after: 'P1-02', control: { type: 'image', source_path: imagePath, label: 'Inserted image', x: 56, y: 540, w: 320, h: 160 } }
      ]
    }
  });
  assert.equal(committedEdit.result.isError, false, committedEdit.result.content[0].text);
  assert.equal(committedEdit.result.structuredContent.result.project.revision, 2);
  assert.equal((await stat(path.join(aiDataPath, 'revisions', 'revision-0002.json'))).size > 1000, true);
  const editedProject = JSON.parse(await readFile(aiProjectPath, 'utf8'));
  assert.equal(editedProject.revision, 2);
  assert.equal(editedProject.pages[0].controls[0].number, 'P1-02');
  const editedTitle = editedProject.pages[0].controls.find(control => control.number === 'P1-01');
  assert.equal(editedTitle.style.backgroundColor, '#000000');
  assert.equal(editedTitle.style.textColor, '#FFFFFF');
  const editedTable = editedProject.pages[0].controls.find(control => control.number === 'P1-03');
  assert.equal(editedTable.style.dividerWidth, 2);
  assert.equal(editedTable.style.dividerColor, '#111111');
  const insertedControl = editedProject.pages[0].controls.find(control => control.type === 'image');
  assert.ok(insertedControl.assetId);
  assert.equal((await stat(path.join(aiDataPath, editedProject.assets[0].relativePath))).size > 1000, true);
  assert.equal(await pdfPageCount(mcpAiDocument), 4);
  if (process.env.TOOLKNIT_QA_PDF_OUTPUT) {
    const qaOutput = path.resolve(process.env.TOOLKNIT_QA_PDF_OUTPUT);
    const parsedQa = path.parse(qaOutput);
    await mkdir(parsedQa.dir, { recursive: true });
    await copyFile(mcpAiDocument, path.join(parsedQa.dir, `${parsedQa.name}-edited${parsedQa.ext}`));
    await copyFile(
      path.join(aiDataPath, 'demo', 'controls-overview.png'),
      path.join(parsedQa.dir, 'ai-doc-project-qa-controls-overview-edited.png')
    );
  }

  const rerender = await client.request('tools/call', {
    name: 'toolknit_ai_document_render',
    arguments: { project_path: aiProjectPath }
  });
  assert.equal(rerender.result.isError, false, rerender.result.content[0].text);
  assert.equal(rerender.result.structuredContent.result.project.revision, 2);

  const undo = await client.request('tools/call', {
    name: 'toolknit_ai_document_edit',
    arguments: { project_path: aiProjectPath, operations: [{ type: 'undo', steps: 1 }] }
  });
  assert.equal(undo.result.isError, false, undo.result.content[0].text);
  assert.equal(undo.result.structuredContent.result.project.revision, 3);
  const undoneProject = JSON.parse(await readFile(aiProjectPath, 'utf8'));
  assert.equal(undoneProject.revision, 3);
  assert.equal(undoneProject.pages[0].controls[0].number, 'P1-01');
  assert.equal(undoneProject.pages[0].controls.some(control => control.type === 'image'), false);
  assert.equal((await stat(path.join(aiDataPath, 'revisions', 'revision-0003.json'))).size > 1000, true);
  assert.doesNotMatch(await readFile(aiProjectPath, 'utf8'), /toolknit-local-test-key/);

  const invalidEdit = await client.request('tools/call', {
    name: 'toolknit_ai_document_edit',
    arguments: {
      project_path: aiProjectPath,
      dry_run: true,
      operations: [{ type: 'update_text', control: 'P1-01', text: 'No write', typo_property: true }]
    }
  });
  assert.equal(invalidEdit.result.isError, true);
  assert.equal(invalidEdit.result.structuredContent.error.code, 'INVALID_ARGUMENT');
  assert.equal(invalidEdit.result.structuredContent.error.details.operationIndex, 0);
  assert.equal(JSON.parse(await readFile(aiProjectPath, 'utf8')).revision, 3);

  const outOfBoundsOperations = [{ type: 'move', control: 'P1-01', x: 760, y: 60, layoutMode: 'absolute' }];
  const outOfBoundsDryRun = await client.request('tools/call', {
    name: 'toolknit_ai_document_edit',
    arguments: { project_path: aiProjectPath, dry_run: true, operations: outOfBoundsOperations }
  });
  assert.equal(outOfBoundsDryRun.result.isError, false, outOfBoundsDryRun.result.content[0].text);
  assert.ok(outOfBoundsDryRun.result.structuredContent.result.diagnostics.some(diagnostic => diagnostic.code === 'control_out_of_bounds'));
  const outOfBoundsCommit = await client.request('tools/call', {
    name: 'toolknit_ai_document_edit',
    arguments: { project_path: aiProjectPath, operations: outOfBoundsOperations }
  });
  assert.equal(outOfBoundsCommit.result.isError, true);
  assert.equal(outOfBoundsCommit.result.structuredContent.error.code, 'INVALID_ARGUMENT');
  assert.equal(outOfBoundsCommit.result.structuredContent.error.details.diagnostics[0].code, 'control_out_of_bounds');
  assert.equal(JSON.parse(await readFile(aiProjectPath, 'utf8')).revision, 3, 'A blocking layout diagnostic must prevent publication.');

  const aiInspect = await client.request('tools/call', { name: 'toolknit_pdf_inspect', arguments: { input_path: mcpAiDocument } });
  assert.equal(aiInspect.result.isError, false);
  assert.equal(aiInspect.result.structuredContent.result.input.pages, 4);
  if (process.env.TOOLKNIT_QA_PDF_OUTPUT) {
    const qaOutput = path.resolve(process.env.TOOLKNIT_QA_PDF_OUTPUT);
    await mkdir(path.dirname(qaOutput), { recursive: true });
    await copyFile(mcpAiDocument, qaOutput);
    await copyFile(
      path.join(aiDataPath, 'demo', 'controls-overview.png'),
      path.join(path.dirname(qaOutput), 'ai-doc-project-qa-controls-overview.png')
    );
  }

  const mcpEnhanceInvalid = await client.request('tools/call', { name: 'toolknit_pdf_enhance', arguments: { input_path: sentinelOutput, output_path: path.join(fixtureDirectory, 'invalid-enhanced.pdf') } });
  assert.equal(mcpEnhanceInvalid.result.isError, true);
  assert.equal(mcpEnhanceInvalid.result.structuredContent.error.code, 'INPUT_INVALID');

  const mcpInvalid = await client.request('tools/call', { name: 'toolknit_pdf_inspect', arguments: { input_path: firstPdf, unexpected: true } });
  assert.equal(mcpInvalid.result.isError, true);
  assert.equal(mcpInvalid.result.structuredContent.error.code, 'INVALID_ARGUMENT');
  await client.close();
  await new Promise((resolve, reject) => providerServer.close(error => error ? reject(error) : resolve()));
  providerServer = null;

  console.log('CLI and MCP contract checks passed');
} finally {
  if (providerServer?.listening) {
    await new Promise(resolve => providerServer.close(() => resolve()));
  }
  await rm(fixtureDirectory, { recursive: true, force: true });
}
