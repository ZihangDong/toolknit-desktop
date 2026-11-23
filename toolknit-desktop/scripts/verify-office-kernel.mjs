import { readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { validateBundledOffice } from '../cli/lib/bundled-office-runtime.mjs';

const root = path.resolve(import.meta.dirname, '..');
const pin = JSON.parse(await readFile(path.join(root, 'office-kernel/runtime.lock.json'), 'utf8'));
const bundle = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'src-tauri/resources/office-kernel');
const result = await validateBundledOffice(bundle, pin, true);
const manifest = JSON.parse(await readFile(path.join(bundle, 'manifest.json'), 'utf8'));
async function checkContents(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await checkContents(file); continue; }
    const name = path.relative(bundle, file).replaceAll('\\', '/');
    if (!entry.isFile()) throw new Error(`Unexpected runtime link: ${name}`);
    if (name === 'manifest.json' || manifest.files[name]) continue;
    // Local QA can create Python bytecode in the generated staging directory.
    // Never carry these caches (or any other undeclared file) into NSIS.
    if (name.startsWith('runtime/') && name.includes('/__pycache__/') && name.endsWith('.pyc')) {
      await unlink(file);
    } else throw new Error(`Unexpected runtime file: ${name}`);
  }
}
await checkContents(bundle);
console.log(`Bundled Office kernel verified: ${result.kernelId}, ${result.files} files.`);
