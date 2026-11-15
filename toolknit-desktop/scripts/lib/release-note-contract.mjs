import assert from 'node:assert/strict';

const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function assertNpmReleaseNotes(notes, { sourceCapabilities, desktopVersion }) {
  assert.match(notes, new RegExp(`CLI / MCP 源码扩展至 ${sourceCapabilities} 项能力`),
    'Release notes must state the current source capability count');
  const published = [...notes.matchAll(/npm CLI \/ MCP (\d+\.\d+\.\d+) 已于 \d{4}-\d{2}-\d{2} 发布/g)];
  assert.equal(published.length, 1, 'Release notes must state the independently published npm version and date');
  const npmVersion = published[0][1], npm = npmVersion.split('.').map(Number), desktop = desktopVersion.split('.').map(Number);
  const difference = npm.findIndex((value, i) => value !== desktop[i]);
  assert.ok(difference < 0 || npm[difference] < desktop[difference], 'Published npm notes cannot announce a future source version');
  assert.match(notes, new RegExp(`npmjs\\.com/package/@toolknit/cli/v/${escaped(npmVersion)}(?:[)/\\s]|$)`),
    'Release notes must link the stated published npm version');
}
