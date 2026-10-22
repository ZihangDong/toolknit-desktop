import path from 'node:path';
import { readInputFile, prepareOutputFile, writeOutputFile } from './safe-files.mjs';
import { runDocumentWorker } from './document-worker.mjs';
import { ToolKnitError, throwIfAborted } from './errors.mjs';

async function convert(job, args, options, extensions, maxBytes = 64 * 1024 * 1024) {
  const prepared = await prepareOutputFile(args.output_path, { extensions, inputPaths: args.input_path ? [args.input_path] : [], overwrite: args.overwrite, signal: options.signal });
  const input = args.input_path ? await readInputFile(args.input_path, { extensions: ['.pdf'], maxBytes, signal: options.signal }) : null;
  const converted = await runDocumentWorker(job, { ...args, input: input && { name: input.name, bytes: Uint8Array.from(input.bytes) }, output_extension: path.extname(args.output_path).toLowerCase() }, options);
  throwIfAborted(options.signal);
  if (!converted.bytes?.length || converted.bytes.length > 100 * 1024 * 1024) throw new ToolKnitError('PROCESSING_FAILED', 'Output exceeded the document size limit.');
  const output = await writeOutputFile(args.output_path, converted.bytes, { prepared, signal: options.signal });
  return { tool: job.replaceAll('_', '.'), ...converted.meta, output_path: output, outputs: [{ path: output, bytes: converted.bytes.length }] };
}
export const pdf_to_word = (args, options) => convert('pdf_to_word', args, options, ['.docx']);
export const pdf_text = (args, options) => convert('pdf_text', args, options, ['.md', '.txt'], 150 * 1024 * 1024);
export const pdf_crop = (args, options) => convert('pdf_crop', args, options, ['.pdf'], 150 * 1024 * 1024);
export const pdf_page_number = (args, options) => convert('pdf_page_number', args, options, ['.pdf'], 150 * 1024 * 1024);
export const pdf_to_scan = (args, options) => convert('pdf_to_scan', args, options, ['.pdf']);
export const pdf_create = (args, options) => convert('pdf_create', args, options, ['.pdf']);
