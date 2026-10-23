import { Worker } from 'node:worker_threads';
import { ToolKnitError, throwIfAborted, cancellationError } from './errors.mjs';

let active = 0;
export async function runDocumentWorker(job, args, options = {}) {
  throwIfAborted(options.signal);
  if (active >= 2) throw new ToolKnitError('PROCESSING_FAILED', 'Two document/image jobs are already running. Retry after one finishes.');
  active++;
  let worker;
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return; settled = true;
        clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
        void worker?.terminate().finally(() => error ? reject(error) : resolve(value));
      };
      const abort = () => finish(cancellationError(options.signal));
      const timer = setTimeout(() => finish(new ToolKnitError('PROCESSING_FAILED', 'Document processing exceeded the 10 minute time limit.')), 10 * 60 * 1000);
      try { worker = new Worker(new URL('./document-worker-entry.mjs', import.meta.url), { workerData: { job, args }, resourceLimits: { maxOldGenerationSizeMb: 768 } }); }
      catch { clearTimeout(timer); reject(new ToolKnitError('ENGINE_UNAVAILABLE', 'Document worker could not start.')); return; }
      options.signal?.addEventListener('abort', abort, { once: true });
      worker.on('message', message => {
        if (message.type === 'progress') { if (!settled) options.reportProgress?.(message.percent, message.message); }
        else if (message.type === 'result') finish(null, message.result);
        else if (message.type === 'error') finish(new ToolKnitError(message.code, message.message, { details: message.details }));
      });
      worker.once('error', () => finish(new ToolKnitError('PROCESSING_FAILED', 'Document worker failed. No result was published.')));
      worker.once('exit', () => { if (!settled) finish(new ToolKnitError('PROCESSING_FAILED', 'Document worker exited without a result.')); });
      if (options.signal?.aborted) abort();
    });
  } finally { active--; }
}
