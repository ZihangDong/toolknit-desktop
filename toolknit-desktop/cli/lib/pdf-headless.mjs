import path from 'node:path';
import { createRequire } from 'node:module';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { ToolKnitError, throwIfAborted, cancellationError } from './errors.mjs';

const require = createRequire(import.meta.url);
export { createCanvas };
export async function withPdf(bytes, work, { maxPages = 300, signal } = {}) {
  throwIfAborted(signal);
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = path.dirname(require.resolve('pdfjs-dist/package.json')).replaceAll('\\', '/');
  const task = getDocument({ data: Uint8Array.from(bytes), verbosity: 0, isEvalSupported: false, enableXfa: false,
    fontExtraProperties: true, useSystemFonts: false, standardFontDataUrl: `${root}/standard_fonts/`,
    cMapUrl: `${root}/cmaps/`, cMapPacked: true, wasmUrl: `${root}/wasm/` });
  let pdf;
  let destruction;
  const destroy = () => destruction ||= task.destroy();
  const abort = () => { void destroy().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) abort();
    pdf = await task.promise;
    throwIfAborted(signal);
    if (pdf.numPages < 1 || pdf.numPages > maxPages) throw new ToolKnitError('INPUT_TOO_LARGE', `PDF must contain 1-${maxPages} pages.`);
    const result = await work(pdf, OPS);
    throwIfAborted(signal);
    return result;
  } catch (error) {
    if (signal?.aborted) throw cancellationError(signal);
    if (error.name === 'PasswordException') throw new ToolKnitError('PDF_PASSWORD_PROTECTED', 'Decrypt the PDF before using this operation.');
    if (error.name === 'InvalidPDFException') throw new ToolKnitError('INPUT_INVALID', 'Input is not a readable PDF.');
    throw error;
  } finally { signal?.removeEventListener('abort', abort); await destroy(); }
}
export function selectPages(value, count, maxPages = count) {
  const pages = value ?? Array.from({ length: count }, (_, index) => index + 1);
  if (!pages.length || pages.length > maxPages || new Set(pages).size !== pages.length || pages.some(page => !Number.isInteger(page) || page < 1 || page > count)) {
    throw new ToolKnitError('INVALID_ARGUMENT', `Select 1-${Math.min(maxPages, count)} unique page numbers within the document.`);
  }
  return pages;
}
