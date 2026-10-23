import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function checkInstalledDependencies(root) {
  const read = file => readFile(path.join(root, file), 'utf8').then(JSON.parse);
  const manifest = await read('package.json');
  const lock = await read('package-lock.json');
  const failures = [];
  let checked = 0;
  for (const group of ['dependencies', 'devDependencies']) {
    for (const [name, requested] of Object.entries(manifest[group] || {})) {
      checked++;
      if (lock.packages?.['']?.[group]?.[name] !== requested) failures.push(`${name}: manifest and lock specification differ`);
      const expected = lock.packages?.[`node_modules/${name}`]?.version;
      if (!expected) { failures.push(`${name}: missing locked version`); continue; }
      // Read the installed file directly: npm's hidden lock can claim a new
      // version while the actual parser/bundler files still belong to an old one.
      let installed;
      try { installed = await read(`node_modules/${name}/package.json`); }
      catch { failures.push(`${name}: missing or unreadable installed package`); continue; }
      if (installed.version !== expected) failures.push(`${name}: installed ${installed.version}, locked ${expected}`);
    }
  }
  return { checked, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await checkInstalledDependencies(path.resolve(import.meta.dirname, '..'));
  if (result.failures.length) {
    console.error(`Dependency files do not match the lockfile:\n${result.failures.join('\n')}\nInstall the locked dependencies before building; npm metadata alone is not proof of installed versions.`);
    process.exitCode = 1;
  } else console.log(`Installed dependency files match the lockfile: ${result.checked} direct packages.`);
}
