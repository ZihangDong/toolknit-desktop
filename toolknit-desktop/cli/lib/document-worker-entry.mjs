import { parentPort, workerData } from 'node:worker_threads';
import { ToolKnitError } from './errors.mjs';

try {
  const { processDocument } = await import('./document-engine.mjs');
  const result = await processDocument(workerData.job, workerData.args, {
    reportProgress: (percent, message) => parentPort.postMessage({ type: 'progress', percent, message })
  });
  parentPort.postMessage({ type: 'result', result }, result.bytes?.buffer instanceof ArrayBuffer ? [result.bytes.buffer] : []);
} catch (error) {
  const known = error instanceof ToolKnitError;
  const missingDependency = ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED'].includes(error?.code);
  parentPort.postMessage({ type: 'error', code: known ? error.code : missingDependency ? 'ENGINE_UNAVAILABLE' : 'PROCESSING_FAILED',
    message: known ? error.message : missingDependency ? 'A required package dependency is missing or cannot load. Reinstall ToolKnit CLI with its optional native dependencies.' : 'The document could not be processed within the supported format and complexity limits.',
    details: known ? error.details : { reason: /^[a-z-]{1,40}$/.test(error?.code || '') ? error.code : 'invalid-document' } });
}
