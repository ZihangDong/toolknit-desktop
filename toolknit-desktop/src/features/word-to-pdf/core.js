export const WORD_LIMITS = Object.freeze({
  files: 20,
  bytes: 50 * 1024 * 1024,
});
export const wordName = (path) =>
  String(path || '')
    .split(/[\\/]/)
    .pop() || '';
export const wordSupported = (name) => /\.(docx|doc)$/i.test(name);
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
    });
}
