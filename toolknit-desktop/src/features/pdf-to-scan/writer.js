import { PDFDocument } from 'pdf-lib';
import { SCAN_LIMITS, scanError, validateScanPages } from './core.js';

export async function createScanWriter(count) {
  validateScanPages(count);
  const pdf = await PDFDocument.create();
  pdf.setProducer('ToolKnit Desktop');
  let size = 0;
  const dimensions = [];
  return {
    async add({ jpeg, width, height }) {
      if (!(jpeg instanceof Uint8Array) || !jpeg.length || !Number.isFinite(width) || !Number.isFinite(height)
        || width < 1 || height < 1 || width > 14400 || height > 14400 || dimensions.length >= count) throw scanError('output-invalid');
      size += jpeg.length;
      if (size > SCAN_LIMITS.outputBytes) throw scanError('output-large');
      const image = await pdf.embedJpg(jpeg);
      const page = pdf.addPage([width, height]);
      page.drawImage(image, { x: 0, y: 0, width, height });
      dimensions.push([width, height]);
    },
    async finish() {
      if (dimensions.length !== count) throw scanError('output-invalid');
      const bytes = await pdf.save({ useObjectStreams: true, addDefaultPage: false });
      if (!bytes.length || bytes.length > SCAN_LIMITS.outputBytes) throw scanError('output-large');
      const result = await PDFDocument.load(bytes, { updateMetadata: false });
      if (result.getPageCount() !== count || result.getPages().some((page, i) =>
        Math.abs(page.getWidth() - dimensions[i][0]) > 0.01 || Math.abs(page.getHeight() - dimensions[i][1]) > 0.01)) throw scanError('output-invalid');
      return bytes;
    }
  };
}
