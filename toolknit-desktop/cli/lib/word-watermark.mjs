import { access, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { ToolKnitError, throwIfAborted } from './errors.mjs';
import { readInputFile } from './safe-files.mjs';
import { resolveQpdf, runProcess } from './pdf-runtime.mjs';

let corePromise;
async function core() {
  return corePromise ||= (async () => {
    const staged = new URL('./core/word-watermark-core.js', import.meta.url);
    return import(await access(staged).then(() => staged.href, () => new URL('../../src/word-watermark-core.js', import.meta.url).href));
  })();
}
export async function prepareWordWatermark(value, options) {
  if (value === undefined) return null;
  try {
    const engine = await core();
    const settings = engine.normalizeWatermark(value);
    let fontBytes, imageBytes;
    if (settings.type === 'image') {
      imageBytes = (await readInputFile(value.image_path, { extensions: ['.png', '.jpg', '.jpeg'], maxBytes: engine.WATERMARK_MAX_BYTES, signal: options.signal })).bytes;
    } else {
      let font = new URL('../resources/fonts/NotoSansSC-Regular.ttf', import.meta.url);
      if (!await access(font).then(() => true, () => false)) font = new URL('../../public/assets/fonts/NotoSansSC-Regular.ttf', import.meta.url);
      fontBytes = new Uint8Array(await readFile(font).catch(() => { throw new Error('word-render:watermark-font'); }));
    }
    throwIfAborted(options.signal);
    return await engine.createWordWatermark(settings, { fontBytes, imageBytes });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ToolKnitError('INVALID_ARGUMENT', /word-render:watermark-[a-z]+/.exec(error.message)?.[0]
      || (value?.type === 'image' ? 'word-render:watermark-image' : 'word-render:watermark-options'));
  }
}

export async function applyWordWatermark(source, watermark, options) {
  if (!watermark) return null;
  const engine = await core(), directory = path.dirname(source), overlay = path.join(directory, 'watermark-overlay.pdf');
  const stamped = source + '.stamped.pdf';
  const command = await resolveQpdf();
  const timeout = AbortSignal.timeout(120000);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  const run = async args => {
    const result = await runProcess(command, args, undefined, { signal });
    if (result.code !== 0) throw new ToolKnitError('PROCESSING_FAILED', 'word-render:watermark-failed');
    return result.stdout.toString('utf8').trim();
  };
  try {
    const count = Number(await run(['--show-npages', source]));
    if (!Number.isSafeInteger(count) || count < 1 || count > 10000) throw new Error('word-render:watermark-pages');
    const pages = engine.watermarkPages(watermark.pages, count);
    await writeFile(overlay, watermark.bytes, { mode: 0o600 });
    await run([source, '--overlay', overlay, '--from=', '--repeat=1', ...(pages ? [`--to=${pages}`] : []), '--', stamped]);
    await readInputFile(stamped, { extensions: ['.pdf'], maxBytes: 150 * 1024 * 1024, signal });
    await run(['--check', stamped]);
    throwIfAborted(options.signal);
    await rename(stamped, source);
    return pages ? engine.watermarkPageCount(pages) : count;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ToolKnitError('PROCESSING_FAILED', /word-render:watermark-[a-z]+/.exec(error.message)?.[0] || 'word-render:watermark-failed');
  } finally {
    await rm(stamped, { force: true }); await rm(overlay, { force: true });
  }
}
