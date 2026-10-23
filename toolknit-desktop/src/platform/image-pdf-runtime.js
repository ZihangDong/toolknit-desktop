import { tauriCorePromise } from './tauri-runtime.js';

export function createImagePdfRuntime({ tauri = tauriCorePromise } = {}) {
  return {
    async inspect(path) { return (await tauri).invoke('inspect_image_pdf_input', { path }); },
    async read({ path, digest, index, maxWidth, maxHeight }) {
      const value = await (await tauri).invoke('read_image_pdf_page', { path, digest, index, maxWidth, maxHeight });
      if (value instanceof ArrayBuffer) return new Uint8Array(value);
      if (value instanceof Uint8Array) return value;
      if (Array.isArray(value)) return Uint8Array.from(value);
      throw new Error('image-pdf:decode');
    }
  };
}
