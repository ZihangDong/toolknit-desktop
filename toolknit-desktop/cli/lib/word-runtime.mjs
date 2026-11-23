import { spawn, execFile } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {
  readInputFile,
  prepareOutputFile,
  writeOutputFile,
  assertNoLinkedParents,
  localPath,
} from './safe-files.mjs';
import { resolveLibreOfficeRuntime } from './ppt-render-runtime.mjs';
import { ToolKnitError, throwIfAborted } from './errors.mjs';
import { runDocumentWorker } from './document-worker.mjs';
import { prepareWordBatchInputs } from './word-zip.mjs';
import { prepareWordWatermark, applyWordWatermark } from './word-watermark.mjs';
import { prepareWordEncryption, applyWordEncryption } from './word-encryption.mjs';

let running = 0;
export function runWordDriver(
  python,
  args,
  { signal, timeoutMs = 180000 } = {},
) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      cwd: path.dirname(python),
      stdio: ['ignore', 'pipe', 'ignore'],
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1',
        SAL_USE_VCLPLUGIN: 'svp',
        SAL_DISABLE_PRINTERLIST: '1',
      },
    });
    let text = '',
      failure = null,
      stopping = null;
    const stop = (code) => {
      if (stopping) return;
      failure = code;
      stopping = new Promise((done) => {
        if (process.platform === 'win32' && child.pid)
          execFile(
            'taskkill',
            ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true, timeout: 10000 },
            (error) => {
              if (error) child.kill('SIGKILL');
              done();
            },
          );
        else {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
          done();
        }
      });
    };
    const abort = () => stop('CANCELLED');
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => stop('TIMEOUT'), timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    };
    child.stdout.on('data', (chunk) => {
      // Per-font notices from a 20-file batch can exceed a short status line.
      text += chunk.toString('utf8').slice(0, Math.max(0, 8 * 1024 * 1024 - text.length));
    });
    child.once('error', () => {
      cleanup();
      reject(
        new ToolKnitError(
          'ENGINE_UNAVAILABLE',
          'Office UNO/Python could not start.',
        ),
      );
    });
    child.once('close', async (code) => {
      cleanup();
      await stopping;
      if (failure) {
        reject(
          new ToolKnitError(
            failure,
            failure === 'CANCELLED'
              ? 'Word conversion cancelled.'
              : 'Word conversion exceeded its time limit.',
          ),
        );
        return;
      }
      let status;
      try {
        status = JSON.parse(text.trim());
      } catch {}
      if (code !== 0 || !status?.ok) {
        const reason = /^[a-z-]{1,40}$/.test(status?.code || '')
          ? status.code
          : 'render-failed';
        reject(new ToolKnitError('PROCESSING_FAILED', `word-render:${reason}`));
        return;
      }
      resolve(status || { ok: true });
    });
    if (signal?.aborted) abort();
  });
}

async function resolveWordDriver() {
  let driver = new URL('../resources/office/word-to-pdf.py', import.meta.url);
  try {
    await access(driver);
  } catch {
    driver = new URL(
      '../../src-tauri/resources/office/word-to-pdf.py',
      import.meta.url,
    );
  }
  return fileURLToPath(driver);
}

async function convertOne(
  inputPath,
  outputPath,
  options,
  renderer,
  overwrite = false,
) {
  const prepared = await prepareOutputFile(outputPath, {
    extensions: ['.pdf'],
    inputPaths: [inputPath],
    overwrite,
    signal: options.signal,
  });
  const input = await readInputFile(inputPath, {
    extensions: ['.doc', '.docx'],
    maxBytes: 50 * 1024 * 1024,
    signal: options.signal,
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tk-word-cli-'));
  try {
    const source = path.join(
      directory,
      'input' + path.extname(inputPath).toLowerCase(),
    );
    const pdf = path.join(directory, 'result.pdf');
    await writeFile(source, input.bytes, { flag: 'wx', mode: 0o600 });
    const driver = await resolveWordDriver();
    const python = path.join(
      path.dirname(renderer.command),
      process.platform === 'win32' ? 'python.exe' : 'python3',
    );
    const driverStatus = await runWordDriver(
      python,
      [
        driver,
        renderer.command,
        source,
        pdf,
        path.join(directory, 'profile'),
        ...(options.refreshFields ? ['--refresh-fields'] : []),
      ],
      options,
    );
    if (options.refreshFields && (driverStatus.fieldUpdate?.enabled !== true || driverStatus.fieldUpdate?.stabilized !== true))
      throw new ToolKnitError('PROCESSING_FAILED', 'word-render:field-update-failed');
    const watermarkPages = await applyWordWatermark(pdf, options.watermark, options);
    let result = await readInputFile(pdf, {
      extensions: ['.pdf'],
      maxBytes: 150 * 1024 * 1024,
      signal: options.signal,
    });
    const info = await runDocumentWorker(
      'pdf_validate',
      { bytes: result.bytes },
      options,
    );
    const encrypted = await applyWordEncryption(pdf, options.encryption, options);
    if (encrypted) result = await readInputFile(pdf, { extensions: ['.pdf'], maxBytes: 150 * 1024 * 1024, signal: options.signal });
    const output = await writeOutputFile(outputPath, result.bytes, {
      prepared,
      signal: options.signal,
    });
    return {
      input_path: inputPath,
      output_path: output,
      bytes: result.size,
      page_count: info.page_count,
      status: 'success',
      font_notices: driverStatus.fontNotices || [],
      ...(encrypted ? { encrypted: true } : {}),
      ...(watermarkPages ? { watermark_pages: watermarkPages } : {}),
      ...(driverStatus.fieldUpdate ? { field_update: driverStatus.fieldUpdate } : {}),
    };
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 150,
    });
  }
}

async function convertBatch(inputs, batchDir, options, renderer) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'tk-word-cli-batch-'));
  const inputsDir = path.join(workDir, 'inputs');
  const manifestPath = path.join(workDir, 'manifest.json');
  const statusPath = path.join(workDir, 'status.json');
  const driver = await resolveWordDriver();
  const python = path.join(
    path.dirname(renderer.command),
    process.platform === 'win32' ? 'python.exe' : 'python3',
  );
  const used = new Set();
  const prepared = [];
  try {
    await mkdir(inputsDir, { recursive: true });
    for (const [index, descriptor] of inputs.entries()) {
      const inputPath = descriptor.path;
      throwIfAborted(options.signal);
      options.reportProgress?.(
        5 + (20 * index) / inputs.length,
        `Preparing Word file ${index + 1}/${inputs.length}.`,
      );
      const stem = path.parse(descriptor.sourceName).name.slice(0, 100) || 'document';
      let name = `${stem}.pdf`;
      let suffix = 1;
      while (used.has(name.toLowerCase())) name = `${stem}_${suffix++}.pdf`;
      used.add(name.toLowerCase());
      const item = {
        index,
        inputPath: descriptor.inputPath,
        origin: { input_path: descriptor.inputPath, source_name: descriptor.sourceName,
          ...(descriptor.archiveEntry ? { archive_entry: descriptor.archiveEntry } : {}) },
        sourceName: descriptor.sourceName,
        source: null,
        destination: path.join(batchDir, name),
        renderDestination: path.join(workDir, `${index}.pdf`),
        prepareError: descriptor.prepareError || null,
      };
      try {
        if (item.prepareError) { prepared.push(item); continue; }
        const input = await readInputFile(inputPath, {
          extensions: ['.doc', '.docx'],
          maxBytes: 50 * 1024 * 1024,
          signal: options.signal,
        });
        const staged = path.join(
          inputsDir,
          `${index}${path.extname(inputPath).toLowerCase()}`,
        );
        await writeFile(staged, input.bytes, { flag: 'wx', mode: 0o600 });
        item.source = staged;
      } catch (error) {
        if (options.signal?.aborted) throw error;
        item.prepareError =
          error.code === 'INPUT_TOO_LARGE' ? 'input-too-large' : 'invalid-input';
      }
      prepared.push(item);
    }
    const convertible = prepared.filter((item) => item.source);
    await writeFile(
      manifestPath,
      JSON.stringify({
        items: convertible.map(({ index, source, renderDestination }) => ({
          index,
          source,
          destination: renderDestination,
          refreshFields: options.refreshFields === true,
        })),
      }),
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    let driverError = null;
    const published = new Map();
    async function publishAvailable() {
      if (options.signal?.aborted) return;
      let statuses;
      try { statuses = JSON.parse(await readFile(statusPath, 'utf8')).files || []; } catch { return; }
      for (const status of statuses) {
        if (options.signal?.aborted) return;
        const item = prepared.find(candidate => candidate.index === status.index);
        if (!item?.source || published.has(item.index) || status.status !== 'success') continue;
        try {
          if (options.refreshFields && (status.fieldUpdate?.enabled !== true || status.fieldUpdate?.stabilized !== true))
            throw new ToolKnitError('PROCESSING_FAILED', 'word-render:field-update-failed');
          const watermarkPages = await applyWordWatermark(item.renderDestination, options.watermark, options);
          let pdf = await readInputFile(item.renderDestination, { extensions: ['.pdf'], maxBytes: 150 * 1024 * 1024, signal: options.signal });
          const info = await runDocumentWorker('pdf_validate', { bytes: pdf.bytes }, options);
          const encrypted = await applyWordEncryption(item.renderDestination, options.encryption, options);
          if (encrypted) pdf = await readInputFile(item.renderDestination, { extensions: ['.pdf'], maxBytes: 150 * 1024 * 1024, signal: options.signal });
          await writeOutputFile(item.destination, pdf.bytes, { signal: options.signal });
          published.set(item.index, { ...item.origin, output_path: item.destination, bytes: pdf.size, page_count: info.page_count,
            status: 'success', font_notices: status.fontNotices || [], ...(encrypted ? { encrypted: true } : {}),
            ...(status.fieldUpdate ? { field_update: status.fieldUpdate } : {}), ...(watermarkPages ? { watermark_pages: watermarkPages } : {}) });
          options.reportProgress?.(25 + 70 * published.size / prepared.length, `Saved Word file ${published.size}/${prepared.length}.`);
        } catch (error) {
          if (options.signal?.aborted) return;
          const reason = /word-render:([a-z-]+)/.exec(error.message)?.[1] || 'render-failed';
          published.set(item.index, { ...item.origin, status: 'failed', error: { code: error.code || 'PROCESSING_FAILED', message: `word-render:${reason}` } });
        }
      }
    }
    if (convertible.length) {
      let finished = false;
      const driverWork = runWordDriver(
          python,
          [driver, renderer.command, '--manifest', manifestPath, path.join(workDir, 'profile'), statusPath],
          options,
        ).catch(error => { driverError = error; }).finally(() => { finished = true; });
      // Publish each complete, validated item while Writer continues the batch.
      // Cancellation can then retain already stamped results without exposing plain intermediates.
      do { await publishAvailable(); if (!finished) await new Promise(resolve => setTimeout(resolve, 100)); } while (!finished);
      await driverWork;
      await publishAvailable();
    }
    let statusItems = [];
    try {
      const status = JSON.parse(await readFile(statusPath, 'utf8'));
      statusItems = Array.isArray(status.files) ? status.files : [];
    } catch {
      statusItems = [];
    }
    const results = [];
    for (const item of prepared) {
      if (published.has(item.index)) { results.push(published.get(item.index)); continue; }
      if (options.signal?.aborted) {
        results.push({ ...item.origin, status: 'cancelled', error: { code: 'CANCELLED', message: 'word-render:cancelled' } }); continue;
      }
      throwIfAborted(driverError?.code === 'CANCELLED' ? undefined : options.signal);
      if (item.prepareError) {
        results.push({
          ...item.origin,
          status: 'failed',
          error: {
            code:
              item.prepareError === 'input-too-large'
                ? 'INPUT_TOO_LARGE'
                : 'INPUT_INVALID',
            message: `word-render:${item.prepareError}`,
          },
        });
        continue;
      }
      const status = statusItems.find((candidate) => candidate.index === item.index);
      const fieldUpdateFailed = options.refreshFields && (status?.fieldUpdate?.enabled !== true || status?.fieldUpdate?.stabilized !== true);
      const code = status?.code || (driverError?.code === 'CANCELLED' ? 'cancelled' : fieldUpdateFailed ? 'field-update-failed' : 'render-failed');
      if (fieldUpdateFailed) await rm(item.destination, { force: true });
      results.push({
        ...item.origin,
        status: driverError?.code === 'CANCELLED' && !status ? 'cancelled' : 'failed',
        error: {
          code: driverError?.code || 'PROCESSING_FAILED',
          message: `word-render:${code}`,
        },
      });
    }
    if (driverError && driverError.code !== 'CANCELLED' && !results.some((row) => row.status === 'success'))
      throw driverError;
    return results;
  } finally {
    await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
  }
}

function fontWarnings(files) {
  return [
    'Missing fonts are replaced with available open-source families where possible. Commercial font licenses or embedding restrictions may affect PDF generation; verify your license and check the output layout.',
    ...files.flatMap(file => (file.font_notices || []).map(notice => {
      const prefix = `${file.source_name || path.basename(file.input_path)}: `;
      if (notice.code === 'font-check-unavailable' || notice.code === 'font-check-incomplete')
        return prefix + 'Font checks were unavailable or incomplete. Verify fonts in the generated PDF.';
      if (notice.code === 'font-replacement-failed') return prefix + `Could not replace "${notice.font}". Install a suitable open-source font or change the source document.`;
      const reason = notice.code === 'embedding-restricted' ? 'embedding restricted' : 'missing';
      return prefix + (notice.replacement
        ? `"${notice.font}" (${reason}) was replaced with open-source font "${notice.replacement}". Check pagination and line breaks.`
        : `"${notice.font}" (${reason}) has no suitable available open-source replacement. Install one or change the source document; PDF text or layout may differ.`);
    })),
  ];
}

function fieldWarnings(files, enabled) {
  if (!enabled) return ['Internal TOCs and fields are not explicitly refreshed; the import/layout engine may recalculate dynamic fields.'];
  return ['Requested internal TOC, page and reference updates only; dates, external data and unknown fields are not explicitly refreshed.',
    ...files.filter(file => file.field_update?.enabled).map(file => {
      const summary = file.field_update;
      return `${file.source_name || path.basename(file.input_path)}: updated ${summary.indexes} internal TOC(s) and ${summary.fields} field(s); skipped ${summary.skippedFields} other field(s) and ${summary.skippedIndexes} index(es).`;
    })];
}

export async function word_to_pdf(args, options = {}) {
  throwIfAborted(options.signal);
  if (args.refresh_fields !== undefined && typeof args.refresh_fields !== 'boolean')
    throw new ToolKnitError('INVALID_ARGUMENT', 'refresh_fields must be a boolean.');
  options = { ...options, refreshFields: args.refresh_fields === true };
  const batch = Array.isArray(args.input_paths);
  if (
    batch
      ? args.input_path !== undefined ||
        args.output_path !== undefined ||
        !args.output_dir ||
        args.overwrite !== undefined
      : !args.input_path || !args.output_path || args.output_dir !== undefined
  )
    throw new ToolKnitError(
      'INVALID_ARGUMENT',
      'Use input_path/output_path, or input_paths/output_dir for a batch.',
    );
  const inputs = batch ? args.input_paths : [args.input_path];
  if (!batch && /\.zip$/i.test(args.input_path)) throw new ToolKnitError('INVALID_ARGUMENT', 'ZIP input requires input_paths and output_dir.');
  if (!inputs.length || inputs.length > 20)
    throw new ToolKnitError('INVALID_ARGUMENT', 'Select 1–20 Word files.');
  if (running >= 2)
    throw new ToolKnitError(
      'PROCESSING_FAILED',
      'Two Word jobs are running. Retry later.',
    );
  running++;
  let preparedInputs;
  try {
    options.encryption = await prepareWordEncryption(args.encryption);
    options.watermark = await prepareWordWatermark(args.watermark, options);
    if (batch) preparedInputs = await prepareWordBatchInputs(inputs, options);
    const renderer = await resolveLibreOfficeRuntime();
    throwIfAborted(options.signal);
    if (!renderer.available)
      throw new ToolKnitError(
        'ENGINE_UNAVAILABLE',
        'Install LibreOffice with UNO/Python or configure TOOLKNIT_LIBREOFFICE_PATH.',
      );
    let batchDir = null;
    if (batch) {
      const parent = localPath(args.output_dir, 'OUTPUT_INVALID');
      await assertNoLinkedParents(parent, 'OUTPUT_INVALID');
      await mkdir(parent, { recursive: true });
      batchDir = await mkdtemp(path.join(parent, 'Word-PDF-'));
    }
    const files = [];
    const used = new Set();
    try {
      if (batch) {
        files.push(...await convertBatch(preparedInputs.sources, batchDir, options, renderer));
        const outputs = files.filter((row) => row.status === 'success');
        return {
          tool: 'word.to-pdf',
          status: outputs.length === files.length ? 'success' : outputs.length ? 'partial' : 'failed',
          files,
          outputs,
          output_dir: batchDir,
          warnings: [...fontWarnings(files), ...fieldWarnings(files, options.refreshFields), ...(preparedInputs.skipped ? [`Skipped ${preparedInputs.skipped} non-Word archive entries; nested ZIPs are not expanded.`] : []),
            'Uses one isolated LibreOffice Writer session for batch conversion. Missing fonts and complex layouts may differ. Macros and external updates are disabled.',
          ],
        };
      }
      for (const [index, input] of inputs.entries()) {
        throwIfAborted(options.signal);
        options.reportProgress?.(
          5 + (90 * index) / inputs.length,
          `Converting Word file ${index + 1}/${inputs.length}.`,
        );
        let target = args.output_path;
        if (batch) {
          const stem = path.parse(input).name.slice(0, 100) || 'document';
          let name = stem + '.pdf',
            n = 1;
          while (used.has(name.toLowerCase())) name = `${stem}_${n++}.pdf`;
          used.add(name.toLowerCase());
          target = path.join(batchDir, name);
        }
        try {
          files.push(
            await convertOne(input, target, options, renderer, args.overwrite),
          );
        } catch (error) {
          if (!batch || options.signal?.aborted || error.code === 'CANCELLED')
            throw error;
          files.push({
            input_path: input,
            status: 'failed',
            error: {
              code: error.code || 'PROCESSING_FAILED',
              message:
                error instanceof ToolKnitError
                  ? error.message
                  : 'word-render:render-failed',
            },
          });
        }
      }
      const outputs = files.filter((row) => row.status === 'success');
      return {
        tool: 'word.to-pdf',
        status:
          outputs.length === files.length
            ? 'success'
            : outputs.length
              ? 'partial'
              : 'failed',
        files,
        outputs,
        ...(batch
          ? { output_dir: batchDir }
          : {
              output_path: outputs[0].output_path,
              page_count: outputs[0].page_count,
            }),
        warnings: [...fontWarnings(files), ...fieldWarnings(files, options.refreshFields),
          'Uses LibreOffice Writer. Missing fonts and complex layouts may differ. Macros and external updates are disabled.',
        ],
      };
    } finally {
      if (batchDir) {
        const { readdir } = await import('node:fs/promises');
        if (!(await readdir(batchDir)).length)
          await rm(batchDir, { recursive: true });
      }
    }
  } finally {
    if (options.encryption) options.encryption.password = '';
    try { await preparedInputs?.dispose(); } finally { running--; }
  }
}
