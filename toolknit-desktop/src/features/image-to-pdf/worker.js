import { createScanWriter } from '../../shared/scanned-pdf-writer.js';
import { applyScanPixels, scanSkewGeometry, DEFAULT_SCAN_SETTINGS } from '../../core/pdf-scan.js';
import { LIMITS, QUALITY, errorCode, imagePdfError, settingsFor } from './core.js';

let writer = null;
async function render({ bitmap, plan, settings: value, ordinal = 1, preview = false }) {
  const settings = settingsFor(value), width = plan.pixelWidth, height = plan.pixelHeight;
  if (![width, height].every(Number.isSafeInteger) || width < 1 || height < 1 || Math.max(width, height) > LIMITS.renderSide
    || width * height > LIMITS.renderPixels) throw imagePdfError('pixels');
  const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d', { willReadFrequently: settings.mode !== 'faithful' });
  try {
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
    context.save(); context.scale(width / plan.width, height / plan.height);
    context.translate(plan.x + plan.drawWidth / 2, plan.y + plan.drawHeight / 2);
    context.rotate(plan.rotation * Math.PI / 180);
    const [w, h] = plan.rotation % 180 ? [plan.drawHeight, plan.drawWidth] : [plan.drawWidth, plan.drawHeight];
    context.drawImage(bitmap, -w / 2, -h / 2, w, h); context.restore();
    if (settings.mode !== 'faithful') {
      const scan = { ...DEFAULT_SCAN_SETTINGS, mode: settings.mode };
      const pixels = context.getImageData(0, 0, width, height);
      applyScanPixels(pixels.data, width, height, scan, ordinal); context.putImageData(pixels, 0, 0);
      const { angle, scale } = scanSkewGeometry(width, height, scan, ordinal);
      if (angle) {
        const copy = new OffscreenCanvas(width, height); copy.getContext('2d').drawImage(canvas, 0, 0);
        context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
        context.translate(width / 2, height / 2); context.rotate(angle); context.scale(scale, scale);
        context.drawImage(copy, -width / 2, -height / 2); copy.width = 0; copy.height = 0;
      }
    }
    const mime = !preview && settings.quality === 'clear' && settings.mode !== 'natural' ? 'image/png' : 'image/jpeg';
    const blob = await canvas.convertToBlob({ type: mime, quality: QUALITY[settings.quality].jpeg });
    if (blob.size > LIMITS.outputBytes) throw imagePdfError('output-size');
    return { buffer: await blob.arrayBuffer(), mime };
  } finally { bitmap.close(); canvas.width = 0; canvas.height = 0; }
}
self.onmessage = async ({ data }) => {
  try {
    let result;
    if (data.type === 'render') result = await render(data);
    else if (data.type === 'start') { writer = await createScanWriter(data.count); result = true; }
    else if (data.type === 'page' && writer) {
      await writer.add({ [data.mime === 'image/png' ? 'png' : 'jpeg']: new Uint8Array(data.buffer), width: data.width, height: data.height }); result = true;
    } else if (data.type === 'finish' && writer) { result = (await writer.finish()).buffer; writer = null; }
    else throw imagePdfError('worker');
    self.postMessage({ id: data.id, result }, result instanceof ArrayBuffer ? [result] : result?.buffer ? [result.buffer] : []);
  } catch (error) { data.bitmap?.close(); self.postMessage({ id: data.id, error: errorCode(error) }); }
};
