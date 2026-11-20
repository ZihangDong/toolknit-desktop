import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

export async function fileSha256(file) {
  const hash = createHash('sha256');
  for await (const data of createReadStream(file)) hash.update(data);
  return hash.digest('hex');
}

export async function validateBundledOffice(root, pin, allFiles = false) {
  const manifestFile = path.join(root, 'manifest.json');
  if (await fileSha256(manifestFile) !== pin.manifestSha256) throw new Error('Office manifest differs from the pin');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (manifest.kernelId !== pin.kernelId) throw new Error('Office kernel version differs from the pin');
  const expected = allFiles ? Object.fromEntries(Object.entries(manifest.files).map(([name, entry]) => [name, entry.sha256])) : pin.criticalFiles;
  for (const [name, hash] of Object.entries(expected)) {
    const file = path.resolve(root, name);
    if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error('Invalid Office manifest path');
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || await fileSha256(file) !== hash) throw new Error('Office runtime file differs: ' + name);
  }
  return { kernelId: manifest.kernelId, files: Object.keys(manifest.files).length };
}
