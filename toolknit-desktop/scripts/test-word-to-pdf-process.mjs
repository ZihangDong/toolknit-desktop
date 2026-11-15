import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { runWordDriver } from '../cli/lib/word-runtime.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'tk-word-process-test-'));
const script = path.join(root, 'driver.mjs');
await writeFile(
  script,
  `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
writeFileSync(process.argv[2],JSON.stringify([process.pid,child.pid]));
setInterval(()=>{},1000);
`,
);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function waitForPids(marker) {
  for (let i = 0; i < 100; i++) {
    try {
      return JSON.parse(await readFile(marker, 'utf8'));
    } catch {
      await delay(50);
    }
  }
  throw new Error('Driver did not start');
}
try {
  for (const mode of ['cancel', 'timeout']) {
    const marker = path.join(root, `${mode}.json`);
    const controller = new AbortController();
    const result = runWordDriver(process.execPath, [script, marker], {
      signal: controller.signal,
      timeoutMs: mode === 'timeout' ? 1500 : 10000,
    });
    const rejected = assert.rejects(
      result,
      (error) => error.code === (mode === 'timeout' ? 'TIMEOUT' : 'CANCELLED'),
    );
    const pids = await waitForPids(marker);
    if (mode === 'cancel') controller.abort();
    await rejected;
    for (let i = 0; i < 50 && pids.some(alive); i++) await delay(40);
    assert.ok(
      pids.every((pid) => !alive(pid)),
      `${mode} stops driver and descendant`,
    );
  }
  await assert.rejects(
    runWordDriver(path.join(root, 'missing.exe'), []),
    (error) => error.code === 'ENGINE_UNAVAILABLE',
  );
  console.log(
    'Word process runner: live cancellation, timeout, descendant cleanup and missing runtime passed.',
  );
} finally {
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}
