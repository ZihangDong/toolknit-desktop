import { PDF_DECRYPT_LIMITS, assertPdfDecryptPassword, assertPdfDecryptSelection, getPdfDecryptErrorCode } from '../../pdf-decrypt-core.js';

export const PDF_DECRYPT_MAX_FILES = 50;
const ERROR_CODES = new Set(['invalid-password', 'input-too-large', 'too-many-pages', 'invalid-pdf', 'desktop-only', 'qpdf-unavailable', 'output-path', 'decryption-failed']);

export function decryptErrorCode(error) {
  const code = getPdfDecryptErrorCode(error);
  return ERROR_CODES.has(code) ? code : 'decryption-failed';
}

export function decryptFileKey(file) {
  return file.path ? String(file.path).replace(/\\/g, '/').toLowerCase()
    : `${file.name}\0${file.size}\0${file.lastModified || 0}`;
}

/** Atomic additions: invalid selections never replace an existing queue. */
export function addDecryptFiles(rows, files) {
  const result = [...rows], keys = new Set(rows.map(row => decryptFileKey(row.file)));
  for (const file of Array.from(files || [])) {
    if (!file || !/\.pdf$/i.test(String(file.name || ''))) throw new Error('pdf-decrypt:invalid-pdf');
    if (file.size > PDF_DECRYPT_LIMITS.maxInputBytes) throw new Error('pdf-decrypt:input-too-large');
    const key = decryptFileKey(file);
    if (keys.has(key)) continue;
    if (result.length >= PDF_DECRYPT_MAX_FILES) throw new Error('pdf-decrypt:too-many-files');
    keys.add(key);
    result.push({ id: crypto.randomUUID(), file, status: 'pending', passwordMode: 'shared', password: '', error: '', outputPath: '' });
  }
  return result;
}

export function prepareDecryptJobs(rows, ids, sharedPassword) {
  const selected = new Set(ids);
  const jobs = [];
  try {
    for (const row of rows) {
      if (!selected.has(row.id) || row.status === 'succeeded') continue;
      const password = row.passwordMode === 'own' ? row.password : sharedPassword;
      try { assertPdfDecryptPassword(password); } catch { throw new Error('pdf-decrypt:password-unsupported'); }
      if (password.includes('\0') || password.length > 1024) throw new Error('pdf-decrypt:password-unsupported');
      jobs.push({ id: row.id, file: row.file, password });
    }
    return jobs;
  } catch (error) {
    clearDecryptJobs(jobs);
    throw error;
  }
}

export function clearDecryptJobs(jobs) {
  for (const job of jobs) job.password = '';
}

/** Sequential native calls; abort stops pending files, never discards a published output. */
export async function runDecryptBatch(jobs, { prepare, sizeOf, decrypt, signal, onUpdate = () => {} }) {
  const results = [];
  const releasePasswords = () => clearDecryptJobs(jobs);
  signal?.addEventListener('abort', releasePasswords, { once: true });
  const emit = result => {
    results.push(result);
    onUpdate(result, results.length, jobs.length);
  };
  try {
    let outputDir;
    try {
      if (!signal?.aborted) outputDir = await prepare();
    } catch {
      for (const job of jobs) emit({ id: job.id, status: signal?.aborted ? 'cancelled' : 'failed', error: signal?.aborted ? '' : 'output-path', outputPath: '' });
      return results;
    }
    for (const job of jobs) {
      if (signal?.aborted) { job.password = ''; emit({ id: job.id, status: 'cancelled', error: '', outputPath: '' }); continue; }
      onUpdate({ id: job.id, status: 'running', error: '', outputPath: '' }, results.length, jobs.length);
      try {
        const bytes = await sizeOf(job.file);
        if (signal?.aborted) { emit({ id: job.id, status: 'cancelled', error: '', outputPath: '' }); continue; }
        if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error('pdf-decrypt:invalid-pdf');
        if (bytes > PDF_DECRYPT_LIMITS.maxInputBytes) throw new Error('pdf-decrypt:input-too-large');
        assertPdfDecryptSelection([job.file], bytes);
        const pending = decrypt(job.file, job.password, outputDir);
        job.password = '';
        const outputPath = await pending;
        if (typeof outputPath !== 'string' || !outputPath) throw new Error('pdf-decrypt:decryption-failed');
        emit({ id: job.id, status: 'succeeded', error: '', outputPath });
      } catch (error) {
        emit({ id: job.id, status: 'failed', error: decryptErrorCode(error), outputPath: '' });
      } finally { job.password = ''; }
    }
    return results;
  } finally {
    signal?.removeEventListener('abort', releasePasswords);
    clearDecryptJobs(jobs);
  }
}
