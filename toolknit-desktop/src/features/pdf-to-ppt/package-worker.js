import { createImagePresentation } from './package.js';
let presentation;
self.onmessage = async ({ data: { id, type, payload } }) => {
  try {
    let output = null;
    if (type === 'start') presentation = createImagePresentation(payload);
    else if (!presentation) throw new Error('pdf-ppt:invalid');
    else if (type === 'page') presentation.add({ ...payload, bytes: new Uint8Array(payload.buffer) });
    else if (type === 'finish') { output = await presentation.finish(); presentation = null; }
    else throw new Error('pdf-ppt:invalid');
    self.postMessage({ id, output }, output ? [output.buffer] : []);
  } catch (error) { presentation = null; self.postMessage({ id, error: String(error.message || error) }); }
};
