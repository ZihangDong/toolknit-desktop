import { compareDocuments } from './diff-core.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ result: compareDocuments(data.before, data.after, data.options) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
