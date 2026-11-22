// Durable metadata only. Never copy invocation objects, passwords, watermark text,
// PDFs, image data or arbitrary properties into task storage.
const HASH = /^[a-f0-9]{64}$/;
const STATES = new Set(['pending', 'converting', 'success', 'failed', 'cancelled']);
export function wordHistoryPath(value) {
  return typeof value === 'string' && value.length <= 4096 && !/[\0\r\n]/.test(value)
    && (/^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value) || value.startsWith('/'));
}
const wordPath = value => wordHistoryPath(value) && /\.(docx|doc)$/i.test(value);
const hash = value => typeof value === 'string' && HASH.test(value) ? value : null;
const number = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max ? value : 0;
const identity = archive => `zip:${JSON.stringify([archive.archivePath, archive.entryName])}`;
function permissions(value) {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) return null;
  if (value?.printing !== undefined && ![false, 'lowResolution', 'highResolution'].includes(value.printing)) return null;
  if (['copying', 'modifying', 'annotating', 'fillingForms', 'documentAssembly'].some(key => value?.[key] !== undefined && typeof value[key] !== 'boolean')) return null;
  const result = { printing: [false, 'lowResolution', 'highResolution'].includes(value?.printing) ? value.printing : 'highResolution' };
  for (const key of ['copying', 'modifying', 'annotating', 'fillingForms', 'documentAssembly']) result[key] = value?.[key] !== false;
  return result;
}
export function sanitizeWordHistory(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.files) || !value.files.length || value.files.length > 20) return null;
  if (['refreshFields', 'watermarkRequired', 'encryptionRequired'].some(key => value[key] !== undefined && typeof value[key] !== 'boolean')) return null;
  const savedPermissions = value.encryptionRequired ? permissions(value.permissions) : null;
  if (value.encryptionRequired && !savedPermissions) return null;
  const files = [], known = new Set();
  for (const file of value.files) {
    if (!file || typeof file.inputPath !== 'string' || file.inputPath.length > 8192) return null;
    if ((file.sourceHash != null && !hash(file.sourceHash)) || (file.outputHash != null && !hash(file.outputHash))
      || (file.encrypted !== undefined && typeof file.encrypted !== 'boolean')) return null;
    let archive = null;
    if (file.archive) {
      const a = file.archive;
      if (!wordHistoryPath(a.archivePath) || !/\.zip$/i.test(a.archivePath) || typeof a.entryName !== 'string' || a.entryName.length > 4096
        || !/\.(docx|doc)$/i.test(a.entryName) || !hash(a.archiveHash) || /[\0\r\n\\]/.test(a.entryName)
        || a.entryName.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) return null;
      archive = { archivePath: a.archivePath, entryName: a.entryName, archiveHash: a.archiveHash };
      if (identity(archive) !== file.inputPath) return null;
    } else if (!wordPath(file.inputPath)) return null;
    const key = file.inputPath.toLowerCase(); if (known.has(key)) return null; known.add(key);
    const outputPath = wordHistoryPath(file.outputPath) && /\.pdf$/i.test(file.outputPath) ? file.outputPath : null;
    files.push({ inputPath: file.inputPath, ...(archive ? { archive } : {}), sourceHash: hash(file.sourceHash),
      status: STATES.has(file.status) ? file.status : 'pending', outputPath, outputHash: outputPath ? hash(file.outputHash) : null,
      outputBytes: outputPath ? number(file.outputBytes, 150 * 1024 * 1024) : 0,
      pageCount: outputPath ? number(file.pageCount, 100000) : 0, encrypted: file.encrypted === true,
      watermarkPages: outputPath ? number(file.watermarkPages, 10000) : 0 });
  }
  return { version: 1, refreshFields: value.refreshFields === true, watermarkRequired: value.watermarkRequired === true,
    encryptionRequired: value.encryptionRequired === true, ...(value.encryptionRequired === true ? { permissions: savedPermissions } : {}), files };
}
export function createWordHistory(args) {
  if (!Array.isArray(args?.inputPaths)) return null;
  if ((args.archiveInputs !== undefined && !Array.isArray(args.archiveInputs)) || (args.expectedHashes !== undefined && !Array.isArray(args.expectedHashes))) return null;
  if (args.archiveInputs?.some(item => !item) || args.expectedHashes?.some(item => !item)) return null;
  const archives = new Map((args.archiveInputs || []).map(archive => [identity(archive), archive]));
  const expected = new Map((args.expectedHashes || []).map(item => [item.inputPath, item.sourceHash]));
  return sanitizeWordHistory({ version: 1, refreshFields: args.refreshFields, watermarkRequired: Boolean(args.watermark),
    encryptionRequired: Boolean(args.encryption), permissions: args.encryption?.permissions,
    files: args.inputPaths.map(inputPath => ({ inputPath, archive: archives.get(inputPath), sourceHash: expected.get(inputPath), status: 'pending' })) });
}
export function updateWordHistory(history, result) {
  if (!history || !result) return history;
  return sanitizeWordHistory({ ...history, files: history.files.map(file => file.inputPath !== result.inputPath ? file : {
    ...file, status: result.status, sourceHash: hash(result.sourceHash) || file.sourceHash,
    outputPath: result.outputPath || null, outputHash: result.outputHash || null, outputBytes: result.outputBytes,
    pageCount: result.pageCount, encrypted: result.encrypted, watermarkPages: result.watermarkPages
  }) });
}
