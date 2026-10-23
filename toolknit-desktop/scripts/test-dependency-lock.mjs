import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkInstalledDependencies } from './check-dependency-lock.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'toolknit-dependency-lock-'));
const write = (file, value) => writeFile(path.join(root, file), JSON.stringify(value));
try {
  await mkdir(path.join(root, 'node_modules/parser'), { recursive: true });
  await mkdir(path.join(root, 'node_modules/@scope/bundler'), { recursive: true });
  const manifest = { dependencies: { parser: '^1.0.1' }, devDependencies: { '@scope/bundler': '^2.1.0' } };
  const lock = { packages: { '': manifest, 'node_modules/parser': { version: '1.0.1' }, 'node_modules/@scope/bundler': { version: '2.1.0' } } };
  await write('package.json', manifest); await write('package-lock.json', lock);
  await write('node_modules/parser/package.json', { version: '1.0.1' });
  await write('node_modules/@scope/bundler/package.json', { version: '2.1.0' });
  assert.deepEqual(await checkInstalledDependencies(root), { checked: 2, failures: [] });
  await write('node_modules/.package-lock.json', lock);
  await write('node_modules/parser/package.json', { version: '1.0.0' });
  assert.deepEqual((await checkInstalledDependencies(root)).failures, ['parser: installed 1.0.0, locked 1.0.1']);
  await write('node_modules/parser/package.json', { version: '1.0.1' });
  await rm(path.join(root, 'node_modules/@scope/bundler/package.json'));
  assert.deepEqual((await checkInstalledDependencies(root)).failures, ['@scope/bundler: missing or unreadable installed package']);
  await write('node_modules/@scope/bundler/package.json', { version: '2.1.0' });
  await write('package.json', { ...manifest, dependencies: { parser: '^1.0.2' } });
  assert.deepEqual((await checkInstalledDependencies(root)).failures, ['parser: manifest and lock specification differ']);
  console.log('Dependency lock checks passed: exact installed versions, stale npm metadata, missing packages and manifest drift.');
} finally { await rm(root, { recursive: true, force: true }); }
