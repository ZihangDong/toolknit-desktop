import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import {
  PDF_COMPRESS_LIMITS,
  assertPdfCompressLevel,
  assertPdfCompressSelection,
  normalizePdfCompressTarget,
  normalizePdfCompressionOptions,
  structureCompressionArguments
} from '../../pdf-compress-core.js';

export class PdfCompressCancelledError extends Error {
  constructor() {
    super('pdf-compress:cancelled');
    this.name = 'PdfCompressCancelledError';
  }
}

function normalizeSize(value) {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new Error('pdf-compress:invalid-pdf');
  }
  return size;
}

function normalizeNativeResult(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('pdf-compress:compression-failed');
  }
  const originalSize = normalizeSize(result.original_size);
  const compressedSize = normalizeSize(result.compressed_size);
  const outputPath = typeof result.output_path === 'string' ? result.output_path : '';
  const outputDir = typeof result.output_dir === 'string' ? result.output_dir : '';
  const targetSizeMb = result.target_size_mb != null && Number.isSafeInteger(Number(result.target_size_mb))
    ? Number(result.target_size_mb) : null;
  return {
    originalSize, compressedSize, outputPath, outputDir,
    targetSizeMb,
    targetReached: result.target_reached == null ? null : result.target_reached === true,
    targetBytes: result.target_bytes ?? (targetSizeMb == null ? null : targetSizeMb * 1024 * 1024),
    status: result.status || (outputPath ? 'compressed' : 'no-reduction'),
    pages: result.page_count,
    smallestSize: result.candidate_size ?? originalSize,
    attempts: result.candidate_size == null ? [] : [{ attempt: 1, bytes: result.candidate_size }]
  };
}

export function createPdfCompressProcessor({
  isTauri = false,
  getOutputDir,
  saveBrowser = async () => { throw new Error('pdf-compress:desktop-only'); }
} = {}) {
  if (typeof getOutputDir !== 'function') throw new Error('pdf-compress:missing-output-directory');
  let disposed = false;

  const getInvoke = async () => (await tauriCorePromise).invoke;
  const assertCurrent = operation => {
    if (disposed || !operation || operation.cancelled || !operation.isCurrent()) {
      throw new PdfCompressCancelledError();
    }
  };

  async function sizeFile(file, operation) {
    assertCurrent(operation);
    if (!isTauri || !file?.path) return {
      ...file, name: file?.name, size: normalizeSize(file?.size),
      arrayBuffer: () => file.arrayBuffer()
    };
    const invoke = await getInvoke();
    const size = await invoke('get_file_size', { path: file.path });
    assertCurrent(operation);
    return { ...file, size: normalizeSize(size) };
  }

  function cancel(operation) {
    if (!operation) return Promise.resolve();
    operation.cancelled = true;
    operation.controller?.abort();
    if (!isTauri) return Promise.resolve();
    if (!operation.cancelPromise) {
      operation.cancelPromise = getInvoke()
        .then(invoke => operation.writeSessionId != null
          ? invoke('discard_pdf_compress_write', { sessionId: operation.writeSessionId })
          : operation.nativeCompression ? invoke('cancel_convert', { toolknitTaskTool: 'pdf-compress' }) : undefined)
        .catch(() => {});
    }
    return operation.cancelPromise;
  }

  async function writeRaster(result, file, directory, operation) {
    const invoke = await getInvoke();
    try {
      operation.writeSessionId = await invoke('begin_pdf_compress_write', {
        inputPath: file.path, directory, expectedBytes: result.bytes.byteLength, targetBytes: result.targetBytes
      });
      assertCurrent(operation);
      for (let offset = 0; offset < result.bytes.length; offset += 1024 * 1024) {
        await invoke('append_pdf_compress_chunk', { sessionId: operation.writeSessionId, offset,
          bytes: Array.from(result.bytes.subarray(offset, offset + 1024 * 1024)) });
        assertCurrent(operation);
      }
      const output = await invoke('finalize_pdf_compress_write', { sessionId: operation.writeSessionId });
      operation.writeSessionId = null;
      assertCurrent(operation);
      const actualSize = await invoke('get_file_size', { path: output });
      if (actualSize !== result.bytes.byteLength) throw new Error('pdf-compress:output-invalid');
      return output;
    } finally {
      if (operation.writeSessionId != null) {
        await invoke('discard_pdf_compress_write', { sessionId: operation.writeSessionId }).catch(() => {});
        operation.writeSessionId = null;
      }
    }
  }

  async function run({ files = [], level = 'medium', mode = 'structure', clarity = 'readable', targetSizeMb = null, targetBytes = null, operation, onProgress = () => {} } = {}) {
    if (disposed) throw new PdfCompressCancelledError();
    assertCurrent(operation);
    if (!isTauri && mode === 'structure') throw new Error('pdf-compress:desktop-only');
    operation.controller = new AbortController();

    const snapshot = Array.from(files);
    const sizedFiles = [];
    for (const file of snapshot) {
      sizedFiles.push(await sizeFile(file, operation));
    }
    assertCurrent(operation);
    assertPdfCompressSelection(sizedFiles, PDF_COMPRESS_LIMITS);
    assertPdfCompressLevel(level);
    const normalizedTarget = normalizePdfCompressTarget(targetSizeMb);
    const options = normalizePdfCompressionOptions({ mode, level, clarity,
      targetBytes: targetBytes ?? (normalizedTarget == null ? null : normalizedTarget * 1024 * 1024) });

    const results = [];
    const errors = [];
    let outputDir = '';
    for (let index = 0; index < sizedFiles.length; index += 1) {
      assertCurrent(operation);
      const file = sizedFiles[index];
      onProgress(Math.round(((index + 0.3) / sizedFiles.length) * 100), {
        current: index + 1,
        total: sizedFiles.length
      });
      let normalized = null;
      const attemptTrace = [];
      try {
        const invoke = isTauri ? await getInvoke() : null;
        const directory = isTauri ? await getOutputDir('PDF_Compress') : '';
        assertCurrent(operation);
        if (mode === 'structure') {
          if (!file?.path) throw new Error('pdf-compress:desktop-only');
          operation.nativeCompression = true;
          try {
            normalized = normalizeNativeResult(await invoke('compress_pdf', {
              inputPath: file.path, level, targetSizeMb: normalizedTarget, targetBytes: options.targetBytes, outputDir: directory
            }));
            normalized.arguments = structureCompressionArguments(level);
          } finally { operation.nativeCompression = false; }
        } else {
          let bytes = isTauri
            ? Uint8Array.from(await invoke('read_file_bytes_limited', { path: file.path, maxBytes: PDF_COMPRESS_LIMITS.maxInputBytes }))
            : new Uint8Array(await file.arrayBuffer());
          assertCurrent(operation);
          if (bytes.byteLength !== file.size) throw new Error('pdf-compress:input-changed');
          const { rasterizePdfForCompression } = await import('./raster.js');
          assertCurrent(operation);
          let lastPart = 0;
          normalized = await rasterizePdfForCompression({ bytes, originalSize: file.size, options,
            signal: operation.controller.signal,
            onProgress: detail => {
              if (operation.cancelled || !operation.isCurrent()) return;
              if (detail.phase === 'attempt') attemptTrace.push({ attempt: detail.attempt, bytes: detail.bytes, scale: detail.scale, quality: detail.quality, elapsedMs: detail.elapsedMs });
              const part = detail.phase === 'preparing' ? 0.3 * detail.current / detail.total
                : detail.phase === 'encoding' ? 0.3 + 0.65 * ((detail.attempt - 1 + detail.current / detail.total) / detail.totalAttempts) : lastPart;
              lastPart = Math.max(lastPart, part);
              onProgress(Math.round((index + lastPart) / sizedFiles.length * 100), { ...detail, fileIndex: index + 1, fileTotal: sizedFiles.length });
            }
          });
          bytes = null;
          assertCurrent(operation);
          normalized.outputPath = '';
          if (normalized.status === 'compressed') {
            onProgress(Math.round((index + 0.97) / sizedFiles.length * 100), { phase: 'verifying', current: index + 1, total: sizedFiles.length });
            normalized.outputPath = isTauri ? await writeRaster(normalized, file, directory, operation)
              : await saveBrowser(normalized.bytes, String(file.name).replace(/\.pdf$/i, '') + '_compressed.pdf', operation);
          }
          normalized.bytes = null;
          normalized.outputDir = directory;
          normalized.targetReached = options.targetBytes == null ? null : ['compressed', 'already-within-target'].includes(normalized.status);
        }
        assertCurrent(operation);
        outputDir = normalized.outputDir || outputDir;
        results.push({
          ...normalized, mode, clarity,
          name: String(file.name || file.path || 'document.pdf'),
          originalSize: normalized.originalSize,
          compressedSize: normalized.compressedSize,
          outputPath: normalized.outputPath,
          targetSizeMb: normalized.targetSizeMb,
          targetReached: normalized.targetReached
        });
      } catch (error) {
        if (error instanceof PdfCompressCancelledError || operation.cancelled || !operation.isCurrent()) {
          throw new PdfCompressCancelledError();
        }
        errors.push({
          name: String(file.name || file.path || 'document.pdf'),
          error
        });
        results.push({ name: String(file.name || 'document.pdf'), mode, clarity, status: 'error',
          originalSize: file.size, compressedSize: null, targetBytes: options.targetBytes,
          targetSizeMb: normalizedTarget, outputPath: '', error,
          attempts: normalized?.attempts || attemptTrace });
      }
    }
    assertCurrent(operation);
    onProgress(100, { current: sizedFiles.length, total: sizedFiles.length });
    return { results, errors, outputDir };
  }

  function dispose() {
    disposed = true;
  }

  return { cancel, dispose, run };
}
