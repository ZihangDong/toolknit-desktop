import { createImagePdfRuntime } from '../../platform/image-pdf-runtime.js';
import { readRasterDimensions } from '../../core/image-dimensions.js';
import { readImageResolution } from '../../core/image-resolution.js';
import { LIMITS, imagePdfError, validateInput, validateDimensions } from './core.js';

export function createImageInputs({ isTauri = false, native = createImagePdfRuntime() } = {}) {
  let queued = Promise.resolve();
  const serialize = task => { const result = queued.then(task); queued = result.catch(() => {}); return result; };
  async function inspect(file, check) {
    if (isTauri && file.path) {
      const info = await serialize(() => { check(); return native.inspect(file.path); }); check();
      validateInput({ ...file, size: info.bytes });
      if (!Array.isArray(info.frames) || !info.frames.length || info.frames.length > LIMITS.pages) throw imagePdfError('pages');
      for (const frame of info.frames) validateDimensions(frame.width, frame.height);
      return { file, size: info.bytes, digest: info.digest, frames: info.frames, firstFrame: info.firstFrame };
    }
    validateInput(file);
    if (/\.tiff?$/i.test(file.name)) throw imagePdfError('tiff-desktop');
    const bytes = new Uint8Array(await file.arrayBuffer()); check();
    const extension = file.name.split('.').pop().toLowerCase();
    const size = readRasterDimensions(bytes, extension);
    if (!size) throw imagePdfError('decode');
    validateDimensions(size.width, size.height);
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      check(); validateDimensions(bitmap.width, bitmap.height);
      return { file, size: file.size, firstFrame: /\.(gif|webp)$/i.test(file.name),
        frames: [{ index: 0, width: bitmap.width, height: bitmap.height, ...readImageResolution(bytes, extension) }] };
    } finally { bitmap.close(); }
  }
  async function bitmap(entry, maxWidth, maxHeight, check) {
    check();
    let result;
    if (isTauri && entry.source.file.path) {
      const bytes = await serialize(() => { check(); return native.read({ path: entry.source.file.path, digest: entry.source.digest, index: entry.index, maxWidth, maxHeight }); });
      check(); result = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    } else result = await createImageBitmap(entry.source.file, { imageOrientation: 'from-image' });
    try { check(); } catch (error) { result.close(); throw error; }
    return result;
  }
  return { inspect, bitmap };
}
