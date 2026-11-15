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
      text += chunk.toString('utf8').slice(0, 4096 - text.length);
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
    await runWordDriver(
      python,
      [
        driver,
        renderer.command,
        source,
        pdf,
        path.join(directory, 'profile'),
      ],
      options,
    );
    const result = await readInputFile(pdf, {
      extensions: ['.pdf'],
      maxBytes: 150 * 1024 * 1024,
      signal: options.signal,
    });
    const info = await runDocumentWorker(
      'pdf_validate',
      { bytes: result.bytes },
      options,
    );
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
    for (const [index, inputPath] of inputs.entries()) {
      throwIfAborted(options.signal);
      options.reportProgress?.(
        5 + (20 * index) / inputs.length,
        `Preparing Word file ${index + 1}/${inputs.length}.`,
      );
      const stem = path.parse(inputPath).name.slice(0, 100) || 'document';
      let name = `${stem}.pdf`;
      let suffix = 1;
      while (used.has(name.toLowerCase())) name = `${stem}_${suffix++}.pdf`;
      used.add(name.toLowerCase());
      const item = {
        index,
        inputPath,
        sourceName: path.basename(inputPath),
        source: null,
        destination: path.join(batchDir, name),
        prepareError: null,
      };
      try {
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
        item.sourceName = input.name;
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
        items: convertible.map(({ index, source, destination }) => ({
          index,
          source,
          destination,
        })),
      }),
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    let driverError = null;
    if (convertible.length) {
      try {
        await runWordDriver(
          python,
          [driver, renderer.command, '--manifest', manifestPath, path.join(workDir, 'profile'), statusPath],
          options,
        );
      } catch (error) {
        driverError = error;
      }
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
      throwIfAborted(driverError?.code === 'CANCELLED' ? undefined : options.signal);
      if (item.prepareError) {
        results.push({
          input_path: item.inputPath,
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
      if (status?.status === 'success') {
        try {
          const pdf = await readInputFile(item.destination, {
            extensions: ['.pdf'],
            maxBytes: 150 * 1024 * 1024,
            signal: options.signal,
          });
          const info = await runDocumentWorker(
            'pdf_validate',
            { bytes: pdf.bytes },
            options,
          );
          results.push({
            input_path: item.inputPath,
            output_path: item.destination,
            bytes: pdf.size,
            page_count: info.page_count,
            status: 'success',
          });
          continue;
        } catch {
          // Treat a missing, truncated or unparsable PDF as a failed item.
        }
      }
      const code = status?.code || (driverError?.code === 'CANCELLED' ? 'cancelled' : 'render-failed');
      results.push({
        input_path: item.inputPath,
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

export async function word_to_pdf(args, options = {}) {
  throwIfAborted(options.signal);
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
  if (!inputs.length || inputs.length > 20)
    throw new ToolKnitError('INVALID_ARGUMENT', 'Select 1–20 Word files.');
  if (running >= 2)
    throw new ToolKnitError(
      'PROCESSING_FAILED',
      'Two Word jobs are running. Retry later.',
    );
  running++;
  try {
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
        files.push(...await convertBatch(inputs, batchDir, options, renderer));
        const outputs = files.filter((row) => row.status === 'success');
        return {
          tool: 'word.to-pdf',
          status: outputs.length === files.length ? 'success' : outputs.length ? 'partial' : 'failed',
          files,
          outputs,
          output_dir: batchDir,
          warnings: [
            'Uses one isolated LibreOffice Writer session for batch conversion. Missing fonts and complex layouts may differ. Macros and external updates are disabled; fields are not explicitly refreshed.',
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
        warnings: [
          'Uses LibreOffice Writer. Missing fonts and complex layouts may differ. Macros and external updates are disabled; fields are not explicitly refreshed.',
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
    running--;
  }
}
