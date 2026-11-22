export const WORD_LIMITS = Object.freeze({
  files: 20,
  bytes: 50 * 1024 * 1024,
});
export const wordName = (path) =>
  String(path || '')
    .split(/[\\/]/)
    .pop() || '';
export const wordSupported = (name) => /\.(docx|doc)$/i.test(name);
export const wordZipIdentity = (archivePath, entryName) => `zip:${JSON.stringify([archivePath, entryName])}`;
export function addWordArchive(existing, manifest) {
  if (typeof manifest?.archivePath !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.archiveHash || '')
    || !Array.isArray(manifest.entries) || !manifest.entries.length || manifest.entries.length > WORD_LIMITS.files) {
    throw new Error('word-render:invalid-archive');
  }
  const result = [...existing], known = new Set(result.map(row => row.path.toLowerCase()));
  for (const entry of manifest.entries) {
    if (typeof entry.entryName !== 'string' || !wordSupported(entry.entryName)
      || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > WORD_LIMITS.bytes) throw new Error('word-render:invalid-archive');
    const path = wordZipIdentity(manifest.archivePath, entry.entryName);
    if (known.has(path.toLowerCase())) continue;
    known.add(path.toLowerCase());
    result.push({ path, name: wordName(entry.entryName), archivePath: manifest.archivePath,
      archiveEntry: entry.entryName, archiveHash: manifest.archiveHash,
      origin: `${wordName(manifest.archivePath)} / ${entry.entryName}`, status: 'pending', outputPath: null, error: null });
  }
  if (result.length > WORD_LIMITS.files) throw new Error('word-render:invalid-file-count');
  return result;
}
export function addWordFiles(existing, paths) {
  const result = [...existing];
  const known = new Set(result.map((row) => row.path.toLowerCase()));
  for (const path of paths) {
    if (typeof path !== 'string' || !wordSupported(wordName(path)))
      throw new Error('word-render:invalid-extension');
    if (!known.has(path.toLowerCase())) {
      known.add(path.toLowerCase());
      result.push({
        path,
        name: wordName(path),
        status: 'pending',
        outputPath: null,
        error: null,
      });
    }
  }
  if (result.length > WORD_LIMITS.files)
    throw new Error('word-render:invalid-file-count');
  return result;
}
export function wordErrorCode(error) {
  const code = String(error?.message || error || '').match(
    /word-render:([a-z-]+)/,
  )?.[1];
  const known = [
    'invalid-extension',
    'invalid-input',
    'input-too-large',
    'invalid-document',
    'invalid-file-count',
    'invalid-archive',
    'archive-limit',
    'archive-empty',
    'archive-changed',
    'active-content',
    'external-content',
    'password-or-invalid-document',
    'runtime-missing',
    'python-missing',
    'runtime-start-failed',
    'output-too-large',
    'output-path',
    'busy',
    'timeout',
    'cancelled',
    'empty-output',
    'field-update-failed',
    'field-update-limit',
    'field-update-unstable',
    'watermark-options', 'watermark-pages', 'watermark-image', 'watermark-font', 'watermark-engine', 'watermark-failed',
    'encryption-options', 'encryption-password', 'encryption-password-too-short', 'encryption-password-too-long', 'encryption-password-unsupported',
    'encryption-password-mismatch', 'encryption-permissions', 'encryption-pages', 'encryption-engine', 'encryption-failed',
    'source-changed', 'history-invalid', 'history-busy', 'history-failed',
  ];
  return known.includes(code) ? code : 'render-failed';
}
export function applyWordResult(rows, result) {
  const found = rows.find((row) => row.path === result?.inputPath);
  if (found)
    Object.assign(found, {
      status: result.status,
      outputPath: result.outputPath || null,
      outputBytes: result.outputBytes ?? result.bytes ?? 0,
      pageCount: result.pageCount ?? result.page_count ?? 0,
      error: result.error || null,
      fontNotices: result.fontNotices ?? result.font_notices ?? [],
      fieldUpdate: result.fieldUpdate ?? result.field_update ?? null,
      watermarkPages: result.watermarkPages ?? result.watermark_pages ?? null,
      encrypted: result.encrypted === true,
      sourceHash: result.sourceHash || found.sourceHash || null,
      outputHash: result.outputHash || null,
      ...(result.status === 'success' ? { historyIssue: null, historySourceState: 'available', currentSourceHash: result.sourceHash || found.sourceHash || null } : {}),
    });
  if (found && /word-render:source-changed/.test(String(result.error || ''))) Object.assign(found, { historyIssue: 'source-changed', historySourceState: 'changed', currentSourceHash: null });
}
