import path from 'node:path';
import { readInputFile, prepareOutputFile, writeOutputFile, localPath, assertNoLinkedParents } from './safe-files.mjs';
import { runDocumentWorker } from './document-worker.mjs';
import { ToolKnitError, throwIfAborted } from './errors.mjs';

const extensions = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff'];
async function readImage(value, options, maxBytes = 20 * 1024 * 1024) {
  const input = await readInputFile(value, { extensions, maxBytes, signal: options.signal });
  return { name: input.name, path: input.path, size: input.size, bytes: Uint8Array.from(input.bytes) };
}
async function one(job, args, options, outputExtensions) {
  const prepared = await prepareOutputFile(args.output_path, { extensions: outputExtensions, inputPaths: [args.input_path], overwrite: args.overwrite, signal: options.signal });
  const input = await readImage(args.input_path, options);
  const result = await runDocumentWorker(job, { ...args, input, output_extension: path.extname(args.output_path).slice(1).toLowerCase() }, options);
  const output = await writeOutputFile(args.output_path, result.bytes, { prepared, signal: options.signal });
  return { tool: job, ...result.meta, output_path: output, outputs: [{ path: output, bytes: result.bytes.length }] };
}
export const image_crop = (args, options) => one('image_crop', args, options, ['.png', '.jpg', '.jpeg', '.webp']);
export const image_color_replace = (args, options) => one('image_color_replace', args, options, ['.png']);
export const image_icons = (args, options) => one('image_icons', args, options, ['.zip']);
export async function image_to_pdf(args, options) {
  const prepared = await prepareOutputFile(args.output_path, { extensions: ['.pdf'], inputPaths: args.input_paths, overwrite: args.overwrite, signal: options.signal });
  const inputs = []; let size = 0;
  for (const file of args.input_paths) {
    const input = await readImage(file, options, 64 * 1024 * 1024); size += input.size;
    if (size > 256 * 1024 * 1024) throw new ToolKnitError('INPUT_TOO_LARGE', 'Combined images exceed 256 MiB.');
    inputs.push(input);
  }
  const converted = await runDocumentWorker('image_to_pdf', { ...args, inputs }, options);
  const output = await writeOutputFile(args.output_path, converted.bytes, { prepared, signal: options.signal });
  return { tool: 'image.to-pdf', ...converted.meta, output_path: output, outputs: [{ path: output, bytes: converted.bytes.length }] };
}
async function batch(job, args, options) {
  const directory = localPath(args.output_dir, 'OUTPUT_INVALID'); await assertNoLinkedParents(directory, 'OUTPUT_INVALID');
  const normalized = args.input_paths.map(value => localPath(value));
  if (new Set(normalized.map(value => process.platform === 'win32' ? value.toLowerCase() : value)).size !== normalized.length) throw new ToolKnitError('INVALID_ARGUMENT', 'Duplicate input files are not supported.');
  const results = [], outputs = [];
  for (const [index, value] of normalized.entries()) {
    throwIfAborted(options.signal);
    try {
      if (job === 'image_compress' && !['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(value).toLowerCase())) throw new ToolKnitError('INPUT_INVALID', 'Compression accepts PNG/JPEG/WebP only.');
      const input = await readImage(value, options);
      const converted = await runDocumentWorker(job, { ...args, input }, { ...options, reportProgress: percent => options.reportProgress?.((index + percent / 100) / normalized.length * 95, 'Processing image batch.') });
      if (!converted.bytes) { results.push({ input_path: value, status: 'no-reduction', ...converted.meta }); continue; }
      const stem = path.parse(input.name).name, extension = converted.meta.format;
      let output;
      for (let suffix = 0; suffix < 10000; suffix++) {
        const target = path.join(directory, `${stem}_${job === 'image_convert' ? 'converted' : 'compressed'}${suffix ? '_' + suffix : ''}.${extension}`);
        try { output = await writeOutputFile(target, converted.bytes, { inputPaths: normalized, signal: options.signal }); break; }
        catch (error) { if (error.code !== 'OUTPUT_EXISTS') throw error; }
      }
      if (!output) throw new ToolKnitError('OUTPUT_CONFLICT', 'Could not allocate a unique image name.');
      const item = { path: output, bytes: converted.bytes.length }; outputs.push(item);
      results.push({ input_path: value, status: 'success', ...converted.meta, output: item });
    } catch (error) {
      if (options.signal?.aborted) throw new ToolKnitError('CANCELLED', 'Image batch cancelled. Completed outputs were retained.', { details: { outputs } });
      results.push({ input_path: value, status: 'failed', code: error instanceof ToolKnitError ? error.code : 'PROCESSING_FAILED' });
    }
  }
  if (results.every(item => item.status === 'failed')) throw new ToolKnitError('PROCESSING_FAILED', 'No image could be processed.', { details: { results } });
  return { tool: job, outputs, results, status: results.some(item => item.status === 'failed') ? 'partial' : 'success' };
}
export const image_convert = (args, options) => batch('image_convert', args, options);
export const image_compress = (args, options) => batch('image_compress', args, options);
