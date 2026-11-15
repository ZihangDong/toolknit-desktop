import assert from 'node:assert/strict';
import { assertNpmReleaseNotes } from './lib/release-note-contract.mjs';

const notes = (version, count = 78) => `CLI / MCP 源码扩展至 ${count} 项能力\nnpm CLI / MCP ${version} 已于 2026-11-15 发布\nhttps://www.npmjs.com/package/@toolknit/cli/v/${version}`;
const context = { sourceCapabilities: 78, desktopVersion: '3.3.0' };
assert.doesNotThrow(() => assertNpmReleaseNotes(notes('3.2.0'), context), 'desktop publication is independent of npm');
assert.doesNotThrow(() => assertNpmReleaseNotes(notes('3.3.0'), context));
assert.throws(() => assertNpmReleaseNotes(notes('3.4.0'), context), /future/);
assert.throws(() => assertNpmReleaseNotes(notes('3.2.0', 77), context), /capability count/);
assert.throws(() => assertNpmReleaseNotes(notes('3.2.0').replace('v/3.2.0', 'v/3.3.0'), context), /link/);
assert.throws(() => assertNpmReleaseNotes('CLI / MCP 源码扩展至 78 项能力', context), /published npm/);
console.log('Release note contract passed: current capabilities, independent desktop/npm dates and correct published links.');
