import { readAppMarkup } from './lib/app-markup.mjs';
import { readGlobalStyles } from './lib/global-styles.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';
import {
  applyCleanupAiBatch,
  cleanupBatchSelection,
  filterCleanupCandidates,
  classifyCleanupRecycleError,
  cleanupFileNameFromPath,
  cleanupDriveLabel,
  cleanupDriveLetter,
  extractCleanupJson,
  isCleanupDriveRoot,
  isCleanupSystemDriveRoot,
  normalizeCleanupDriveSpace
} from '../src/features/cleanup-tools/large-file-core.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [main, html, lazyTools, entry, largeFiles, cDrive, largeFileStyles, cDriveStyles, cDriveLightStyles, appStyles] = await Promise.all([
  read('src/main.js'),
  readAppMarkup(import.meta.url),
  read('src/features/lazy-tools.js'),
  read('src/features/cleanup-tools/tool.js'),
  read('src/features/cleanup-tools/large-file-controller.js'),
  read('src/features/cleanup-tools/c-drive-controller.js'),
  read('src/features/cleanup-tools/large-file.css'),
  read('src/features/cleanup-tools/c-drive.css'),
  read('src/features/cleanup-tools/cleanup-tools.css'),
  readGlobalStyles(import.meta.url)
]);

for (const [toolId, overlayId, initializer] of [
  ['large-file-cleanup', 'largeFileCleanupOverlay', 'initLargeFileCleanupTool'],
  ['c-drive-cleanup', 'cDriveCleanupOverlay', 'initCDriveCleanupTool']
]) {
  const spec = LAZY_TOOL_SPECS[toolId];
  assert.equal(spec?.overlayId, overlayId);
  assert.equal(spec?.init, initializer);
  assert.match(spec.load.toString(), /cleanup-tools\/tool\.js/);
  assert.match(lazyTools, new RegExp(`['"]${toolId}['"]?:\\s*Object\\.freeze\\(`));
  assert.match(html, new RegExp(`id="${overlayId}"`));
}

assert.match(entry, /from ['"]\.\/large-file-controller\.js['"]/);
assert.match(entry, /from ['"]\.\/c-drive-controller\.js['"]/);
assert.match(entry, /import ['"]\.\/large-file\.css['"]/);
assert.match(entry, /import ['"]\.\/c-drive\.css['"]/);
assert.doesNotMatch(main, /Cleanup \/ Large Files/);
assert.doesNotMatch(main, /async function cDriveCleanupStartScan/);

for (const source of [largeFiles, cDrive]) {
  assert.match(source, /createLifecycleScope\(/);
  assert.match(source, /open:/);
  assert.match(source, /close:/);
  assert.match(source, /dispose\(\)/);
  assert.match(source, /lifecycle\.dispose\(\)/);
  assert.match(source, /from ['"]\.\.\/\.\.\/platform\/tauri-runtime\.js['"]/);
  assert.doesNotMatch(source, /from ['"]@tauri-apps\//);
}

for (const command of [
  'system_cleanup_is_admin',
  'system_cleanup_scan',
  'system_cleanup_run',
  'system_cleanup_relaunch_as_admin'
]) {
  assert.match(cDrive, new RegExp(`['"]${command}['"]`));
}
assert.match(cDrive, /cDriveCleanupScanRunId \+= 1/);
assert.match(cDrive, /cDriveCleanupRunId \+= 1/);
assert.match(cDrive, /runId !== cDriveCleanupScanRunId \|\| !isCurrentOpen\(owner\)/);
assert.match(cDrive, /runId !== cDriveCleanupRunId \|\| !isCurrentOpen\(owner\)/);
assert.match(cDrive, /if \(isTauri\) void cDriveCleanupStartScan\(\)/);
assert.match(cDrive, /createModalSession\(/);
assert.match(cDrive, /adminModal\.dispose\(\)/);
assert.match(cDrive, /confirmModal\.dispose\(\)/);

for (const command of [
  'get_cleanup_drive_space',
  'scan_large_files',
  'move_files_to_recycle_bin',
  'open_recycle_bin'
]) {
  assert.match(largeFiles, new RegExp(`['"]${command}['"]`));
}
assert.match(largeFiles, /largeFileCleanupDeleteRunId \+= 1/);
assert.match(largeFiles, /runId !== largeFileCleanupDeleteRunId \|\| !isCurrentOpen\(owner\)/);
assert.match(largeFiles, /renderScope\.dispose\(\)/);
assert.match(largeFiles, /hoverToastScope\.dispose\(\)/);

const aiFunction = largeFiles.slice(
  largeFiles.indexOf('async function largeFileCleanupAnalyze()'),
  largeFiles.indexOf('function largeFileCleanupSelectAll(')
);
assert.match(aiFunction, /Absolute local paths and file contents are intentionally withheld/);
assert.match(aiFunction, /folder_hint: item\.folder_hint/);
assert.doesNotMatch(aiFunction, /path:\s*item\.path/);
assert.doesNotMatch(aiFunction, /content:\s*item\./);
assert.match(largeFiles, /applyCleanupAiBatch\(/);
const applyFunction = largeFiles.slice(largeFiles.indexOf('function largeFileCleanupApplyAiDecisions'), largeFiles.indexOf('async function largeFileCleanupAnalyze'));
assert.doesNotMatch(applyFunction, /largeFileCleanupSelectedPaths\s*=/);
assert.match(largeFiles, /requestAi\(prompt, abort\.signal/);
assert.match(largeFiles, /cancel_large_file_scan/);
assert.match(entry, /cleanup-tools\.css/);
assert.match(cDriveLightStyles, /html:root\[data-theme\] #cDriveCleanupOverlay/);
assert.match(cDriveLightStyles, /\.c-drive-cleanup-option\[aria-checked="true"\]/);
assert.match(cDriveLightStyles, /#cDriveCleanupAdminMask/);
assert.match(cDriveLightStyles, /#cDriveCleanupConfirmMask/);
for (const id of ['largeFileCleanupScanSystemDrive', 'largeFileCleanupDriveRootAck', 'largeFileCleanupCancel', 'largeFileCleanupSearch', 'largeFileCleanupRiskFilter', 'largeFileCleanupCategoryFilter', 'largeFileCleanupScanStats']) {
  assert.match(html, new RegExp(`id="${id}"`));
}
const candidates = [
  { id: 'a', path: 'D:/Downloads/a.zip', name: 'a.zip', risk: 'low', category: 'archives' },
  { id: 'b', path: 'D:/project/b.bin', name: 'b.bin', risk: 'high', category: 'models' },
  { id: 'c', path: 'D:/other/c.mp4', name: 'c.mp4', risk: 'medium', category: 'video' }
];
const recommendation = id => ({ id, identity: 'Archive', decision: 'delete', reason: 'Review first' });
const result = applyCleanupAiBatch(candidates, { items: candidates.map(item => recommendation(item.id)) }, ['a', 'b']);
assert.equal(result[0].ai_decision, 'delete');
assert.equal(result[1].ai_decision, 'review');
assert.equal(result[2].ai_decision, undefined, 'another batch cannot be modified');
assert.equal(candidates[0].ai_decision, undefined, 'input is immutable');
assert.equal(applyCleanupAiBatch(candidates, { items: [recommendation('a'), recommendation('a')] }, ['a'])[0].ai_decision, undefined);
assert.equal(applyCleanupAiBatch(candidates, { items: [{ ...recommendation('a'), decision: 'remove' }] }, ['a'])[0].ai_decision, undefined);
assert.deepEqual(cleanupBatchSelection(candidates), [candidates[0].path, candidates[2].path]);
assert.equal(cleanupBatchSelection(Array.from({ length: 240 }, (_, i) => ({ path: String(i), risk: 'low' }))).length, 200);
assert.deepEqual(filterCleanupCandidates(candidates, 'DOWNLOADS', 'low', 'archives'), [candidates[0]]);

assert.match(largeFileStyles, /Cleanup & Large Files \(2\.0\)/);
assert.match(largeFileStyles, /\.cleanup-large-files-table/);
assert.match(cDriveStyles, /C-drive \(system\) cleanup/);
assert.match(cDriveStyles, /\.c-drive-cleanup-overlay \.c-drive-cleanup-body/);
assert.doesNotMatch(appStyles, /Cleanup & Large Files \(2\.0\)/);
assert.doesNotMatch(appStyles, /C-drive \(system\) cleanup/);
assert.doesNotMatch(appStyles, /\.c-drive-cleanup-overlay \.c-drive-cleanup-body/);

assert.equal(cleanupDriveLetter('d:\\'), 'D');
assert.equal(cleanupDriveLabel('e:/'), 'E:\\');
assert.equal(isCleanupDriveRoot('D:\\'), true);
assert.equal(isCleanupSystemDriveRoot('c:/'), true);
assert.equal(isCleanupSystemDriveRoot('D:\\'), false);
assert.deepEqual(normalizeCleanupDriveSpace({ drive: 'D:', free_bytes: 25, total_bytes: 100 }), {
  drive: 'D:',
  freeBytes: 25,
  totalBytes: 100
});
assert.deepEqual(extractCleanupJson('result: {"items":[{"id":"1"}]} done'), { items: [{ id: '1' }] });
assert.equal(cleanupFileNameFromPath('D:\\Downloads\\archive.zip'), 'archive.zip');
assert.deepEqual(classifyCleanupRecycleError('Access is denied'), { key: 'recycleFailureAccessDenied' });

console.log('Cleanup tools lazy loading, lifecycle, safety, privacy and CSS ownership checks passed');
