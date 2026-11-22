import { createWordHistory, updateWordHistory } from '../app/word-conversion-history.js';
import { wordErrorCode } from '../features/word-to-pdf/core.js';
// Explicit allowlist keeps reads, credentials, and binary output payloads out of history.
const COMMANDS = {
  convert_word_to_pdf: ['Word → PDF', 'word-to-pdf', 'cancel_word_to_pdf'],
  convert_image_batch: ['图片格式转换 / Image conversion', 'image-convert', 'cancel_convert'],
  compress_image_batch: ['图片压缩 / Image compression', 'image-compress', 'cancel_convert'],
  convert_audio_batch: ['音频转换 / Audio conversion', 'audio-convert', 'cancel_convert'],
  convert_video_batch: ['视频转换 / Video conversion', 'video-convert', 'cancel_convert'],
};

function protectedWordError(error) {
  const code = wordErrorCode(error);
  return code === 'render-failed' ? 'word-render:encryption-failed' : `word-render:${code}`;
}

export function resultOutputs(value) {
  const paths = new Set();
  function visit(item, key = '') {
    if (typeof item === 'string' && /^(output_path|output_dir|outputPath|outputDir|output_paths|path)$/.test(key) && item) paths.add(item);
    else if (Array.isArray(item)) item.forEach(child => visit(child, key));
    else if (item && typeof item === 'object') Object.entries(item).forEach(([name, child]) => visit(child, name));
  }
  visit(value); return [...paths];
}

export function createTrackedInvoke({ invoke, listen, center, isEnabled = () => true }) {
  let tail = Promise.resolve();
  let active = null;
  const operations = new Set();
  return async function trackedInvoke(command, args, options) {
    if (command === 'cancel_word_to_pdf') {
      const owner = [...operations].find(item => item.tool === 'word-to-pdf' && item.args?.jobId === args?.jobId);
      if (owner) { await center.cancel(owner.id); return true; }
    }
    if (command === 'cancel_convert' && args?.toolknitTaskTool) {
      const owner = [...operations].reverse().find(item => item.tool === args.toolknitTaskTool);
      if (owner) { await center.cancel(owner.id); return true; }
      // An untracked tool must not cancel a conversion owned by a different page.
      if (active) return false;
      return invoke(command, {}, options);
    }
    if (['cancel_convert', 'cancel_word_to_pdf'].includes(command) && active
      && (command === 'cancel_convert' && active.command !== 'convert_word_to_pdf'
        || command === 'cancel_word_to_pdf' && active.command === 'convert_word_to_pdf' && args?.jobId === active.args?.jobId)) {
      const owner = active;
      const result = await invoke(command, args, options);
      owner.markCancelled(); return result;
    }
    const spec = COMMANDS[command];
    if (!spec || !isEnabled()) return invoke(command, args, options);
    const sensitive = command === 'convert_word_to_pdf' && Boolean(args?.encryption);
    let recovery = command === 'convert_word_to_pdf' ? createWordHistory(args) : null;
    let cancelled = false, started = false, unlisten;
    const cancelledError = () => Object.assign(new Error('已取消 / Cancelled'), { code: 'CANCELLED' });
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    const task = center.begin({ label: spec[0], tool: spec[1], recovery,
      cancel: async () => {
        cancelled = true;
        if (started) await invoke(spec[2], command === 'convert_word_to_pdf' ? { jobId: args.jobId } : {});
        else { if (sensitive) args.encryption.password = ''; task.fail(cancelledError()); }
      },
      retry: sensitive || recovery ? undefined : () => trackedInvoke(command, { ...args, ...(command === 'convert_word_to_pdf' ? { jobId: crypto.randomUUID() } : {}) }, options)
    });
    const operation = { id: task.id, tool: spec[1], args }; operations.add(operation);
    task.queued();
    try {
      await previous;
      if (cancelled) throw cancelledError();
      task.start();
      try {
        unlisten = await listen(command === 'convert_word_to_pdf' ? 'word-to-pdf-progress' : 'convert-progress', event => {
          const value = event?.payload || {};
          if (command === 'convert_word_to_pdf' && (value.job_id ?? value.jobId) !== args.jobId) return;
          if (recovery && value.file) { recovery = updateWordHistory(recovery, value.file); task.recovery?.(recovery); }
          const percent = value.percent ?? value.progress ?? (value.total > 0 ? value.current / value.total * 100 : null);
          task.progress(percent, value.message || value.current_file || '');
        });
      } catch { /* progress is optional */ }
      if (cancelled) throw cancelledError();
      started = true;
      active = { command, args, markCancelled: () => { cancelled = true; } };
      const result = await invoke(command, args, options);
      if (recovery) { for (const file of result?.files || []) recovery = updateWordHistory(recovery, file); task.recovery?.(recovery); }
      started = false;
      const outputs = resultOutputs(result);
      if (cancelled || result?.cancelled) task.fail(cancelledError(), { outputs });
      else if (Number(result?.fail_count) > 0 || result?.files?.some(row => row.status === 'failed')) {
        const errors = result.errors || result.files?.filter(row => row.error).map(row => row.error) || [];
        const message = sensitive
          ? errors.map(protectedWordError).join('\n') || protectedWordError()
          : errors.join('\n') || '部分文件处理失败 / Some files failed';
        task.fail(new Error(message), { outputs });
      } else task.finish({ outputs });
      return result;
    } catch (error) {
      const safeError = cancelled ? cancelledError() : sensitive ? new Error(protectedWordError(error)) : error;
      task.fail(cancelled ? Object.assign(new Error('Cancelled'), { code: 'CANCELLED' }) : safeError); throw safeError;
    } finally { if (sensitive) args.encryption.password = ''; try { unlisten?.(); } catch {} operations.delete(operation); if (active?.args === args) active = null; release(); }
  };
}
