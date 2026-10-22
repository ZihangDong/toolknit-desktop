const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'cli');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Prepare the CLI package through npm.');
const run = args => execFileSync(process.execPath, args, { cwd: cli, stdio: 'inherit', windowsHide: true, timeout: 240000 });
run([path.join(__dirname, 'stage-cli-resources.cjs')]);
// A library's overrides do not apply in a consumer project. Bundle the locked
// ExcelJS dependency tree so its audited UUID fix also reaches npm users.
run([npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
const excel = path.join(cli, 'node_modules/exceljs');
const uuidEntry = require.resolve('uuid/package.json', { paths: [excel] });
if (JSON.parse(readFileSync(uuidEntry, 'utf8')).version !== '11.1.1') {
  throw new Error('Bundled ExcelJS must resolve the audited UUID version.');
}
const excelManifestPath = path.join(excel, 'package.json');
const excelManifest = JSON.parse(readFileSync(excelManifestPath, 'utf8'));
if (excelManifest.version !== '4.4.0' || excelManifest.dependencies.uuid !== '^8.3.0') {
  throw new Error('ExcelJS dependency patch needs review for this upstream version.');
}
// Keep consumer npm validation consistent with the bundled override. This is
// the only upstream metadata change; the original MIT license remains intact.
excelManifest.dependencies.uuid = '11.1.1';
writeFileSync(excelManifestPath, JSON.stringify(excelManifest, null, 2) + '\n');
console.log('Prepared locked ExcelJS dependencies for npm bundling.');
