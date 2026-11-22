import { randomBytes } from 'node:crypto';
import { rename, rm, stat } from 'node:fs/promises';
import { loadCore } from './core-loader.mjs';
import { resolveQpdf, runProcess } from './pdf-runtime.mjs';
import { ToolKnitError, throwIfAborted } from './errors.mjs';

export async function prepareWordEncryption(value) {
  if (value === undefined) return null;
  try { return (await loadCore('word-encryption-core.js')).normalizeWordEncryption(value); }
  catch (error) { throw new ToolKnitError('INVALID_ARGUMENT', /word-render:encryption-[a-z-]+/.exec(error.message)?.[0] || 'word-render:encryption-options'); }
}
export async function applyWordEncryption(source, encryption, options) {
  if (!encryption) return false;
  const command = await resolveQpdf(), destination = source + '.encrypted.pdf';
  const timeout = AbortSignal.timeout(120000), signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  const run = async (args, input, capture = false) => {
    let result;
    try {
      result = await runProcess(command, args, input, { signal });
      if (result.code !== 0) throw new ToolKnitError('PROCESSING_FAILED', 'word-render:encryption-failed');
      return capture ? result.stdout.toString('utf8').trim() : '';
    } finally { result?.stdout.fill(0); result?.stderr.fill(0); }
  };
  const owner = randomBytes(32), permissions = encryption.permissions;
  let payload, password;
  try {
    const pages = Number(await run(['--show-npages', source], undefined, true));
    if (!Number.isSafeInteger(pages) || pages < 1 || pages > 200) throw new Error('word-render:encryption-pages');
    // qpdf reads the complete argument list from stdin: no secret in process arguments or disk files.
    const lines = ['--warning-exit-0', '--password-mode=unicode', '--encrypt', `--user-password=${encryption.password}`,
      `--owner-password=${owner.toString('hex')}`, '--bits=256', `--print=${permissions.printing === false ? 'none' : permissions.printing === 'lowResolution' ? 'low' : 'full'}`,
      ...Object.entries({extract:permissions.copying,'modify-other':permissions.modifying,annotate:permissions.annotating,form:permissions.fillingForms,accessibility:true,assemble:permissions.documentAssembly})
        .map(([key,value]) => `--${key}=${value ? 'y' : 'n'}`), '--', source, destination];
    if (lines.some(line => /[\0\r\n]/.test(line))) throw new Error('word-render:encryption-options');
    payload = Buffer.from(lines.join('\n')+'\n'); lines.fill('');
    await run(['@-'], payload);
    const size = (await stat(destination)).size;
    if (size < 128 || size > 150 * 1024 * 1024) throw new Error('word-render:encryption-failed');
    password = Buffer.from(encryption.password+'\n');
    const prefix = ['--password-mode=unicode', '--password-file=-'];
    await run([...prefix,'--check',destination], password);
    const after = Number(await run([...prefix,'--show-npages',destination], password, true));
    if (after !== pages) throw new Error('word-render:encryption-failed');
    throwIfAborted(options.signal); await rename(destination, source); return true;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ToolKnitError('PROCESSING_FAILED', /word-render:encryption-[a-z-]+/.exec(error.message)?.[0] || 'word-render:encryption-failed');
  } finally { owner.fill(0); payload?.fill(0); password?.fill(0); await rm(destination,{force:true}); }
}
