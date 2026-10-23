import { lstat, opendir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertNoLinkedParents, localPath, readInputFile } from './safe-files.mjs';
import { ToolKnitError, throwIfAborted } from './errors.mjs';

async function scan(args, options) {
  const root = localPath(args.directory); await assertNoLinkedParents(root);
  try { if (!(await lstat(root)).isDirectory()) throw new Error(); }
  catch { throw new ToolKnitError('INPUT_INVALID', 'Supply one readable directory.'); }
  const queue = [{ directory: root, depth: 0 }], files = [], maxFiles = args.max_files ?? 10000, maxDepth = args.max_depth ?? 16;
  let visited = 0, skipped = 0, truncated = false;
  while (queue.length && !truncated) {
    throwIfAborted(options.signal);
    const current = queue.shift();
    await assertNoLinkedParents(current.directory);
    let directory;
    try { directory = await opendir(current.directory); } catch { skipped++; continue; }
    for await (const entry of directory) {
      throwIfAborted(options.signal);
      if (++visited > maxFiles) { truncated = true; break; }
      if (entry.isSymbolicLink()) { skipped++; continue; }
      const file = path.join(current.directory, entry.name);
      try {
        const info = await lstat(file);
        if (info.isSymbolicLink()) { skipped++; continue; }
        if (info.isDirectory()) {
          if (current.depth < maxDepth) queue.push({ directory: file, depth: current.depth + 1 });
          else skipped++;
        } else if (info.isFile()) files.push({ path: file, bytes: info.size, modified_ms: info.mtimeMs });
        else skipped++;
      } catch { skipped++; }
    }
    options.reportProgress?.(Math.min(45, visited / maxFiles * 45), 'Scanning explicit directory.');
  }
  return { files, visited: Math.min(visited, maxFiles), skipped, truncated };
}
export async function files_large(args, options) {
  const result = await scan(args, options), matching = result.files.filter(file => file.bytes >= (args.minimum_bytes ?? 100 * 1024 * 1024)).sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  return { tool: 'files.large', files: matching.slice(0, args.limit ?? 100), matching_count: matching.length,
    visited: result.visited, skipped: result.skipped, truncated: result.truncated || matching.length > (args.limit ?? 100), read_only: true };
}
export async function files_duplicates(args, options) {
  const scanned = await scan(args, options), sizes = new Map();
  for (const file of scanned.files) { const group = sizes.get(file.bytes) || []; group.push(file); sizes.set(file.bytes, group); }
  const groups = []; let hashedBytes = 0, skipped = scanned.skipped, hashed = 0;
  for (const group of sizes.values()) {
    if (group.length < 2) continue;
    const hashes = new Map();
    for (const file of group) {
      throwIfAborted(options.signal);
      if (file.bytes > 256 * 1024 * 1024 || hashedBytes + file.bytes > 2 * 1024 * 1024 * 1024) { skipped++; continue; }
      try {
        const input = await readInputFile(file.path, { maxBytes: 256 * 1024 * 1024, allowEmpty: true, signal: options.signal });
        if (input.size !== file.bytes) { skipped++; continue; }
        const digest = createHash('sha256').update(input.bytes).digest('hex'), candidates = hashes.get(digest) || [];
        candidates.push({ path: file.path, bytes: input.size }); hashes.set(digest, candidates); hashedBytes += input.size; hashed++;
      } catch (error) { if (options.signal?.aborted) throw error; skipped++; }
      options.reportProgress?.(45 + 45 * hashed / Math.max(1, scanned.files.length), 'Comparing candidate file contents.');
    }
    for (const [sha256, files] of hashes) if (files.length > 1) groups.push({ sha256, bytes_each: files[0].bytes, files });
  }
  const limit = args.limit ?? 100;
  return { tool: 'files.duplicates', groups: groups.slice(0, limit), group_count: groups.length, visited: scanned.visited, skipped,
    hashed_bytes: hashedBytes, truncated: scanned.truncated || groups.length > limit || skipped > 0, read_only: true };
}
