import { applyScanPixels, scanErrorCode } from './core.js';
import { createScanWriter } from './writer.js';

let writer = null;
self.onmessage = async ({ data }) => {
  try {
    let result;
    if (data.type === 'effect') result = applyScanPixels(new Uint8ClampedArray(data.buffer), data.width, data.height, data.settings, data.pageNumber).buffer;
    else if (data.type === 'start') { writer = await createScanWriter(data.count); result = true; }
    else if (data.type === 'page' && writer) { await writer.add({ ...data, jpeg: new Uint8Array(data.buffer) }); result = true; }
    else if (data.type === 'finish' && writer) { result = (await writer.finish()).buffer; writer = null; }
    else throw new Error('pdf-scan:output-invalid');
    self.postMessage({ id: data.id, result }, result instanceof ArrayBuffer ? [result] : []);
  } catch (error) { self.postMessage({ id: data.id, error: scanErrorCode(error) }); }
};
