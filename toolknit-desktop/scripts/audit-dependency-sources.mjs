import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('../src-tauri/src/', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const dependencies = await read('native_runtime/dependencies.rs');
const pinned = await read('platform/dependency_download.rs');
const records = JSON.parse(await read('native_runtime/local_translation/records.json'));
const origin = pinned.match(/RESOURCE_ORIGIN: &str = "(https:[^"]+)"/)?.[1];
if (!origin) throw new Error('Missing pinned resource origin');
const sources = [...pinned.matchAll(/const (\w+_URL): &str =\s*"(https:[^"]+)"/g)].map(([, name, url]) => ({ name, url }));
for (const model of ['base', 'small', 'medium']) sources.push({ name: `whisper-${model}`, url: `${origin}/models/whisper/ggml-${model}.bin` });
for (const record of records.data) sources.push({ name: `translation-${record.name}`, url: `${origin}/translation/4.0.33/models/${record.attachment.filename}` });
if (sources.length !== 4 + 3 + records.data.length || sources.some(source => new URL(source.url).origin !== origin)) throw new Error('Invalid resource source list');
const proxy = process.argv.find(arg => arg.startsWith('--proxy='))?.slice(8);
if (proxy && !/^http:\/\/127\.0\.0\.1:\d+$/.test(proxy)) throw new Error('Only an explicitly selected local proxy is supported');
const direct = process.argv.includes('--direct');
if (proxy && direct) throw new Error('Choose either --proxy or --direct');
const results = [];
// Limit concurrent HEAD requests; never download model bodies or disclose signed redirects.
let next = 0;
async function worker() {
  while (next < sources.length) {
    const { name, url } = sources[next++];
    const args = ['--head', '--silent', '--show-error', '--connect-timeout', '8', '--max-time', '25', '--proto', '=https', '--write-out', '\nMETA %{http_code} %{time_total} %{url_effective}', url];
    if (proxy) args.unshift('--proxy', proxy);
    if (direct) args.unshift('--noproxy', '*');
    let output;
    let failed = false;
    try { output = (await run('curl.exe', args, { timeout: 30000, maxBuffer: 128 * 1024, windowsHide: true })).stdout; }
    catch (error) { output = error.stdout || ''; failed = true; }
    const meta = output.match(/META (\d+) ([\d.]+) (\S+)/);
    const blocks = output.split(/\r?\n\r?\n/).filter(block => /^HTTP\//.test(block));
    const last = blocks.at(-1) || '';
    const status = Number(meta?.[1] || 0);
    results.push({ name, status, seconds: Number(meta?.[2] || 0), failed: failed || status !== 200, origin: meta?.[3]?.startsWith('https:') ? new URL(meta[3]).origin : null, bytes: last.match(/content-length:\s*(\d+)/i)?.[1] || null, range: last.match(/accept-ranges:\s*([^\r\n]+)/i)?.[1] || null });
  }
}
await Promise.all([worker(), worker(), worker()]);
const verified = [];
if (process.argv.includes('--verify-small') || process.argv.includes('--verify-office')) {
  const directory = await mkdtemp(join(tmpdir(), 'toolknit-source-audit-'));
  try {
    const ffmpegBytes = Number(dependencies.match(/FFMPEG_ARCHIVE_BYTES: u64 = ([\d_]+)/)[1].replaceAll('_', ''));
    const ffmpegHash = dependencies.match(/FFMPEG_ARCHIVE_SHA256: &str =\s*"([a-f\d]+)"/)[1];
    const officeBytes = Number(dependencies.match(/LIBREOFFICE_ARCHIVE_BYTES: u64 = ([\d_]+)/)[1].replaceAll('_', ''));
    const officeHash = dependencies.match(/LIBREOFFICE_ARCHIVE_SHA256: &str =\s*"([a-f\d]+)"/)[1];
    const bodySources = sources.filter(s =>
      (process.argv.includes('--verify-small') && ['FFMPEG_URL', 'MATTING_URL', 'whisper-base'].includes(s.name))
      || (process.argv.includes('--verify-office') && s.name === 'LIBREOFFICE_URL'));
    for (const { name, url } of bodySources) {
      const expected = name.startsWith('FFMPEG_') ? [ffmpegBytes, ffmpegHash]
        : name.startsWith('LIBREOFFICE_') ? [officeBytes, officeHash]
        : name === 'MATTING_URL' ? [25888640, '07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9']
        : [147951465, '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'];
      const destination = join(directory, 'sample');
      const args = ['--fail', '--silent', '--show-error', '--connect-timeout', '8', '--max-time', '180', '--max-filesize', String(expected[0]), '--proto', '=https', '--output', destination, '--write-out', '%{http_code} %{time_total} %{speed_download}', url];
      if (proxy) args.unshift('--proxy', proxy);
      if (direct) args.unshift('--noproxy', '*');
      const result = { name, verified: false };
      try {
        const { stdout } = await run('curl.exe', args, { timeout: 185000, maxBuffer: 4096, windowsHide: true });
        const [status, seconds, speed] = stdout.trim().split(' ').map(Number);
        const bytes = (await stat(destination)).size;
        const digest = createHash('sha256');
        for await (const chunk of createReadStream(destination)) digest.update(chunk);
        Object.assign(result, { status, seconds, bytesPerSecond: speed, bytes, verified: bytes === expected[0] && digest.digest('hex') === expected[1] });
      } catch (error) {
        result.failed = true;
        result.curlExitCode = typeof error.code === 'number' ? error.code : null;
        const [status, seconds] = String(error.stdout || '').trim().split(' ').map(Number);
        if (Number.isFinite(status)) result.status = status;
        if (Number.isFinite(seconds)) result.seconds = seconds;
      }
      verified.push(result);
      console.error(`${name}: ${result.verified ? 'body and SHA-256 verified' : 'verification unavailable/failed'}`);
      await rm(destination, { force: true });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), route: proxy ? 'local-proxy' : direct ? 'direct' : 'default', results, verified }, null, 2));
