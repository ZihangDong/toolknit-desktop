import { randomUUID } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ToolKnitError, throwIfAborted, cancellationError } from './errors.mjs';

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ROOT = path.resolve(CLI_ROOT, '..');
const STAGED_CORE_ROOT = path.join(CLI_ROOT, 'lib', 'core');
const REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-chat';

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function importCore(fileName) {
  const stagedPath = path.join(STAGED_CORE_ROOT, fileName);
  if (await fileExists(stagedPath)) return import(pathToFileURL(stagedPath).href);
  return import(pathToFileURL(path.join(PROJECT_ROOT, 'src', fileName)).href);
}

const [pptTextCore, providerCore] = await Promise.all([
  importCore('ppt-text-extract-core.js'),
  importCore('ai-provider-core.js')
]);

const {
  PPT_TEXT_EXTRACT_LIMITS,
  PptTextExtractError,
  analyzePptxText,
  buildPptTextAiMessages,
  createPptTextMarkdown,
  createPptTextJson,
  createPptTextTxt,
  normalizePptTextAiMode,
  normalizePptTextFormat,
  planPptTextExport,
  sanitizePptTextBaseName
} = pptTextCore;
const { AiProviderError, isPlaceholderAiApiKey, requestAiCompletion } = providerCore;

function report(options, progress, message) {
  options.reportProgress?.(Math.max(0, Math.min(100, progress)), message);
}

function assertObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'arguments must be an object.');
  }
}

function assertOnlyKeys(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ToolKnitError('INVALID_ARGUMENT', `Unknown argument: ${key}`);
  }
}

function mapPptTextError(error) {
  if (error instanceof ToolKnitError) return error;
  if (error instanceof PptTextExtractError) {
    const message = error.userMessage || error.message;
    if (['invalid_request', 'invalid_selection', 'invalid_format', 'invalid_ai_mode'].includes(error.code)) return new ToolKnitError('INVALID_ARGUMENT', message);
    if (['input_too_large', 'too_many_slides', 'slide_text_too_large', 'text_too_large'].includes(error.code)) return new ToolKnitError('INPUT_TOO_LARGE', message);
    if (['invalid_extension', 'invalid_pptx', 'no_text'].includes(error.code)) return new ToolKnitError('INPUT_INVALID', message);
    return new ToolKnitError('PROCESSING_FAILED', message);
  }
  if (error instanceof AiProviderError) {
    if (error.code === 'timeout') return new ToolKnitError('PROVIDER_TIMEOUT', 'AI PPT text organization timed out.');
    if (error.code === 'invalid_config') {
      return new ToolKnitError('ENGINE_UNAVAILABLE', 'AI provider configuration is invalid or missing.');
    }
    const statusSuffix = error.code === 'http_error' && error.status ? ` (HTTP ${error.status})` : '';
    return new ToolKnitError('PROVIDER_ERROR', `The AI provider request failed${statusSuffix}.`, {
      details: { stage: 'provider_request', providerCode: error.code, retryable: ['network_error', 'invalid_response'].includes(error.code)
        || (error.code === 'http_error' && ([408, 409, 425, 429].includes(error.status) || error.status >= 500)) }
    });
  }
  return new ToolKnitError('PROCESSING_FAILED', String(error?.message || error || 'PPT text extraction failed.'));
}

function assertPathValue(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new ToolKnitError('INVALID_ARGUMENT', `${label} must be a non-empty path.`);
  }
  return path.resolve(value.trim());
}

async function inspectPptxInput(inputPath) {
  const requested = assertPathValue(inputPath, 'input_path');
  if (path.extname(requested).toLowerCase() !== '.pptx') {
    throw new ToolKnitError('INPUT_INVALID', 'PPT text extraction currently supports .pptx files only.');
  }
  let metadata;
  try {
    metadata = await lstat(requested);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new ToolKnitError('INPUT_NOT_FOUND', `PPTX input does not exist: ${requested}`);
    throw new ToolKnitError('INPUT_INVALID', `PPTX input cannot be inspected: ${requested}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 1) {
    throw new ToolKnitError('INPUT_INVALID', `PPTX input must be a non-empty regular file: ${requested}`);
  }
  if (metadata.size > PPT_TEXT_EXTRACT_LIMITS.maxInputBytes) {
    throw new ToolKnitError('INPUT_TOO_LARGE', `PPTX files for text extraction must be ${PPT_TEXT_EXTRACT_LIMITS.maxInputBytes / 1024 / 1024}MB or smaller.`);
  }
  return { path: await realpath(requested), name: path.basename(requested), size: metadata.size };
}

async function readInputBytes(input) {
  try {
    const bytes = await readFile(input.path);
    if (bytes.length !== input.size) {
      throw new ToolKnitError('INPUT_INVALID', `PPTX input changed while it was being read: ${input.path}`);
    }
    return bytes;
  } catch (error) {
    if (error instanceof ToolKnitError) throw error;
    throw new ToolKnitError('INPUT_INVALID', `PPTX input cannot be read: ${input.path}`);
  }
}

async function prepareOutputParent(value) {
  const requested = assertPathValue(value, 'output_dir');
  try {
    await mkdir(requested, { recursive: true });
  } catch {
    throw new ToolKnitError('OUTPUT_INVALID', `Cannot create output directory: ${requested}`);
  }
  const metadata = await lstat(requested);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new ToolKnitError('OUTPUT_INVALID', 'output_dir must be a real directory, not a symbolic link.');
  }
  return realpath(requested);
}

async function reserveBatchDirectory(parentDirectory, baseName) {
  const safeBaseName = sanitizePptTextBaseName(baseName);
  for (let index = 0; index < 10_000; index++) {
    const suffix = index === 0 ? '' : `_${index}`;
    const candidate = path.join(parentDirectory, `${safeBaseName}_ppt_text${suffix}`);
    try {
      await lstat(candidate);
      continue;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new ToolKnitError('OUTPUT_INVALID', `Output directory cannot be inspected: ${candidate}`);
      }
      return candidate;
    }
  }
  throw new ToolKnitError('OUTPUT_WRITE_FAILED', 'Could not reserve a unique PPT text output directory.');
}

function publicSlide(slide) {
  return {
    page: slide.page,
    source_slide_number: slide.source_slide_number,
    title: slide.title,
    title_confidence: slide.title_confidence,
    title_source: slide.title_source,
    body: slide.body,
    notes: slide.notes,
    text_characters: slide.text_characters,
    has_notes: slide.has_notes,
    is_empty: slide.is_empty
  };
}

function providerConfig(env) {
  const apiKey = [env?.TOOLKNIT_AI_API_KEY, env?.DEEPSEEK_API_KEY]
    .find(candidate => !isPlaceholderAiApiKey(candidate));
  if (!apiKey) {
    throw new ToolKnitError(
      'ENGINE_UNAVAILABLE',
      'AI provider key is missing or still a placeholder. Set DEEPSEEK_API_KEY or TOOLKNIT_AI_API_KEY in the ToolKnit MCP/CLI environment.'
    );
  }
  return {
    apiKey,
    url: env?.TOOLKNIT_AI_API_URL || DEFAULT_API_URL,
    model: env?.TOOLKNIT_AI_MODEL || DEFAULT_MODEL
  };
}

async function requestAiOrganization(result, plan, options) {
  const provider = providerConfig(options.env || process.env);
  try {
    throwIfAborted(options.signal);
    const { messages, source } = buildPptTextAiMessages(result, {
      ai_mode: plan.ai_mode,
      locale: result.locale || 'zh-CN'
    });
    const content = await requestAiCompletion({
      url: provider.url,
      apiKey: provider.apiKey,
      model: provider.model,
      messages,
      maxTokens: 4096,
      signal: options.signal,
      timeoutMs: REQUEST_TIMEOUT_MS,
      fetchImpl: options.fetchImpl
    });
    return {
      mode: plan.ai_mode,
      provider: { url: provider.url, model: provider.model },
      content: String(content || '').trim(),
      source
    };
  } catch (error) {
    if (options.signal?.aborted) throw cancellationError(options.signal);
    throw error;
  }
}

function outputFormats(format) {
  return format === 'all' ? ['markdown', 'txt', 'json'] : [format];
}

function outputFileName(format) {
  if (format === 'markdown') return 'slides.md';
  if (format === 'txt') return 'slides.txt';
  return 'slides.json';
}

function serializeOutput(format, result) {
  if (format === 'markdown') return createPptTextMarkdown(result);
  if (format === 'txt') return createPptTextTxt(result);
  return createPptTextJson(result);
}

export async function extractPptText(args, options = {}) {
  try {
    throwIfAborted(options.signal);
    assertObject(args);
    assertOnlyKeys(args, new Set(['input_path', 'output_dir', 'pages', 'format', 'ai_mode', 'locale', 'dry_run', 'output_name']));
    report(options, 0, 'Validating PPTX text extraction request.');
    const input = await inspectPptxInput(args.input_path);
    const inputBytes = await readInputBytes(input);
    throwIfAborted(options.signal);
    report(options, 16, 'Extracting slide text and speaker notes.');
    const manifest = await analyzePptxText(inputBytes, { sourceName: input.name });
    throwIfAborted(options.signal);
    if (manifest.text_characters < 1) {
      throw new PptTextExtractError('no_text', 'No extractable text was found in this PPTX.');
    }
    const plan = planPptTextExport(manifest, {
      pages: args.pages,
      format: args.format || 'markdown',
      ai_mode: args.ai_mode || 'none'
    });
    const locale = args.locale === 'en' ? 'en' : 'zh-CN';
    const selectedSlides = plan.selected_slides.map(publicSlide);
    const inputResult = { path: input.path, name: input.name, bytes: input.size };
    const summary = {
      tool: 'ppt.text',
      input: inputResult,
      slide_count: manifest.slide_count,
      text_characters: manifest.text_characters,
      body_paragraph_count: manifest.body_paragraph_count,
      notes_paragraph_count: manifest.notes_paragraph_count,
      notes_slide_count: manifest.notes_slide_count,
      empty_slide_count: manifest.empty_slide_count,
      selected_count: plan.selected_count,
      selected_text_characters: plan.selected_text_characters,
      pages: plan.pages,
      format: plan.format,
      ai_mode: plan.ai_mode,
      locale,
      dry_run: args.dry_run === true,
      slides: manifest.slides.map(publicSlide),
      selected_slides: selectedSlides
    };

    if (args.dry_run === true) {
      report(options, 100, 'PPT text scan completed.');
      return summary;
    }

    let aiResult = null;
    if (plan.ai_mode !== 'none') {
      report(options, 52, 'Asking AI to organize extracted PPT text.');
      aiResult = await requestAiOrganization({ ...summary, selected_slides: selectedSlides, locale }, plan, options);
      throwIfAborted(options.signal);
    }

    const outputParent = await prepareOutputParent(args.output_dir);
    const finalDirectory = await reserveBatchDirectory(outputParent, args.output_name || input.name);
    const temporaryDirectory = await mkdtemp(path.join(outputParent, '.toolknit-ppt-text-'));
    try {
      const result = {
        ...summary,
        dry_run: false,
        output_dir: finalDirectory,
        run_id: randomUUID(),
        generated_at: new Date().toISOString(),
        ai_result: aiResult,
        outputs: [],
        manifest_paths: {
          json: path.join(finalDirectory, 'manifest.json')
        }
      };
      report(options, 72, 'Writing PPT text outputs.');
      for (const format of outputFormats(plan.format)) {
        throwIfAborted(options.signal);
        const fileName = outputFileName(format);
        const temporaryPath = path.join(temporaryDirectory, fileName);
        await writeFile(temporaryPath, serializeOutput(format, result), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        const metadata = await stat(temporaryPath);
        result.outputs.push({ path: path.join(finalDirectory, fileName), relative_path: fileName, format, bytes: metadata.size });
      }
      if (aiResult?.content) {
        const aiFileName = `ai-${plan.ai_mode}.md`;
        const aiTemporaryPath = path.join(temporaryDirectory, aiFileName);
        await writeFile(aiTemporaryPath, `${aiResult.content.trim()}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        const metadata = await stat(aiTemporaryPath);
        result.outputs.push({ path: path.join(finalDirectory, aiFileName), relative_path: aiFileName, format: 'markdown', kind: 'ai_result', bytes: metadata.size });
      }
      await writeFile(path.join(temporaryDirectory, 'manifest.json'), `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      report(options, 94, 'Publishing PPT text output directory.');
      throwIfAborted(options.signal);
      await rename(temporaryDirectory, finalDirectory);
      report(options, 100, 'Published PPT text extraction outputs.');
      return result;
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  } catch (error) {
    throw mapPptTextError(error);
  }
}
