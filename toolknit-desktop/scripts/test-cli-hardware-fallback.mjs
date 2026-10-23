import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { executeTool } from '../cli/lib/tool-registry.mjs';

const moduleUrl = new URL('../cli/lib/hardware-runtime.mjs', import.meta.url).href;
const result = execFileSync(process.execPath, ['--input-type=module', '--eval', `
  import assert from 'node:assert/strict';
  import os from 'node:os';
  const hardware = await import(${JSON.stringify(moduleUrl)});
  const overview = await hardware.inspectHardwareOverview();
  const cpu = await hardware.inspectCpuMemoryInfo();
  assert.equal(overview.fallback, true);
  assert.equal(cpu.fallback, true);
  assert.equal(overview.core.cpu_threads, os.cpus().length);
  assert.equal(overview.core.memory_total_bytes, os.totalmem());
  assert.equal(cpu.cpu.threads, os.cpus().length);
  assert.equal(cpu.memory.total_bytes, os.totalmem());
  assert.ok(cpu.memory.available_bytes > 0);
  assert.equal(overview.providers['node-os'], 'node-os');
  assert.equal(cpu.providers['node-os'], 'node-os');
  await assert.rejects(hardware.inspectCpuMemoryInfo({ signal: AbortSignal.abort() }), error => error.code === 'CANCELLED');
  console.log('Hardware fallback passed without PowerShell: real Node CPU/memory values, provider attribution and cancellation.');
`], { cwd: import.meta.dirname, env: { ...process.env, PATH: '', Path: '' }, encoding: 'utf8', windowsHide: true, timeout: 30000 });
assert.match(result, /Hardware fallback passed/);
process.stdout.write(result);
if (process.platform === 'win32') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30);
  try {
    await assert.rejects(executeTool('toolknit_hardware_cpu_memory', {}, { signal: controller.signal }), error => error.code === 'CANCELLED');
    console.log('MCP registry forwards cancellation to the running hardware query.');
  } finally { clearTimeout(timer); }
}
