import { spawnSync } from 'node:child_process';

const releaseTests = [
  'test:pdf-merge',
  'test:pdf-split',
  'test:pdf-rotate',
  'test:pdf-encrypt',
  'test:pdf-decrypt',
  'test:pdf-compress',
  'test:pdf-enhance',
  'test:ai-doc',
  'test:ai-table',
  'test:ai-provider',
  'test:ai-translate',
  'test:ai-polish',
  'test:text-format',
  'test:text-stats',
  'test:password',
  'test:color-extractor',
  'test:image-batch',
  'test:icon-gen',
  'test:audio-convert',
  'test:bpm-detect',
  'test:audio-extract',
  'test:audio-clip',
  'test:video-convert',
  'test:video-frame',
  'test:video-gif',
  'test:image-stitch',
  'test:dependencies',
  'test:help',
  'test:cli-package',
  'test:cli-agent'
];

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('test:release must be started through npm.');

for (const script of releaseTests) {
  console.log(`\n=== ${script} ===`);
  const result = spawnSync(process.execPath, [npmCli, 'run', script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`\nRelease test suite passed: ${releaseTests.length} npm scripts.`);
