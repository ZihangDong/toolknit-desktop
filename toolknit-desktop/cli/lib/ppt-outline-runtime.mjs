import { randomUUID } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ToolKnitError, throwIfAborted, waitForAbortable } from './errors.mjs';

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ROOT = path.resolve(CLI_ROOT, '..');
const STAGED_CORE_ROOT = path.join(CLI_ROOT, 'lib', 'core');
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_GENERATION_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 350;
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

const [outlineCore, providerCore] = await Promise.all([
  importCore('ppt-outline-core.js'),
  importCore('ai-provider-core.js')
]);

const {
  PptOutlineError,
  buildPptOutlineMessages,
  createPptOutlineGuide,
  createPptOutlineManifest,
  createPptOutlineMarkdown,
  extractPptOutlineJson,
  normalizePptOutlineRequest,
  normalizePptOutlineResult,
  sanitizePptOutlineBaseName
} = outlineCore;
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

function mapPptOutlineError(error) {
  if (error instanceof ToolKnitError) return error;
  if (error instanceof PptOutlineError) {
    const message = error.userMessage || error.message;
    if (['invalid_request', 'invalid_slide_count', 'invalid_locale'].includes(error.code)) {
      return new ToolKnitError('INVALID_ARGUMENT', message);
    }
    if (['input_too_large'].includes(error.code)) return new ToolKnitError('INPUT_TOO_LARGE', message);
    if (['invalid_ai_response'].includes(error.code)) {
      return new ToolKnitError('AI_LAYOUT_INVALID', message, {
        details: { stage: 'provider_response', retryable: true }
      });
    }
    return new ToolKnitError('PROCESSING_FAILED', message);
  }
  if (error instanceof AiProviderError) {
    if (error.code === 'timeout') return new ToolKnitError('PROVIDER_TIMEOUT', 'AI PPT outline generation timed out.', {
      details: { stage: 'provider_request', retryable: true }
    });
    if (error.code === 'invalid_config') {
      return new ToolKnitError('ENGINE_UNAVAILABLE', 'AI provider configuration is invalid or missing.', {
        details: { stage: 'provider_config', retryable: false }
      });
    }
    if (error.code === 'http_error') {
      const retryable = error.status === 408 || error.status === 409 || error.status === 425 || error.status === 429 || error.status >= 500;
      return new ToolKnitError('PROVIDER_ERROR', `The AI provider rejected the request${error.status ? ` (HTTP ${error.status})` : ''}.`, {
        details: { stage: 'provider_request', retryable, ...(error.status ? { status: error.status } : {}) }
      });
    }
    if (error.code === 'response_too_large') {
      return new ToolKnitError('PROVIDER_ERROR', 'The AI provider response exceeded the safe size limit.', {
        details: { stage: 'provider_response', retryable: false }
      });
    }
    return new ToolKnitError('PROVIDER_ERROR', 'The AI provider returned an invalid response.', {
      details: { stage: error.code === 'network_error' ? 'provider_request' : 'provider_response', retryable: true }
    });
  }
  if (error?.name === 'AbortError') {
    return new ToolKnitError('PROVIDER_TIMEOUT', 'AI PPT outline generation timed out.', {
      details: { stage: 'provider_request', retryable: true }
    });
  }
  return new ToolKnitError('PROCESSING_FAILED', String(error?.message || error || 'PPT outline generation failed.'));
}

function assertPathValue(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new ToolKnitError('INVALID_ARGUMENT', `${label} must be a non-empty path.`);
  }
  return path.resolve(value.trim());
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
  const safeBaseName = sanitizePptOutlineBaseName(baseName);
  for (let index = 0; index < 10_000; index++) {
    const suffix = index === 0 ? '' : `_${index}`;
    const candidate = path.join(parentDirectory, `${safeBaseName}_ppt_outline${suffix}`);
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
  throw new ToolKnitError('OUTPUT_WRITE_FAILED', 'Could not reserve a unique PPT outline output directory.');
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

async function requestOutline({ request, provider, options, retry }) {
  try {
    throwIfAborted(options.signal);
    const content = await requestAiCompletion({
      url: provider.url,
      apiKey: provider.apiKey,
      model: provider.model,
      messages: buildPptOutlineMessages(request, { retry }),
      maxTokens: 8192,
      signal: options.signal,
      timeoutMs: REQUEST_TIMEOUT_MS,
      fetchImpl: options.fetchImpl
    });
    if (String(content || '').length > outlineCore.PPT_OUTLINE_LIMITS.maxResponseChars) {
      throw new ToolKnitError('PROVIDER_ERROR', 'The AI provider response exceeded the safe size limit.');
    }
    const parsed = extractPptOutlineJson(content);
    if (!parsed) throw new PptOutlineError('invalid_ai_response', 'The AI provider did not return valid PPT outline JSON.');
    return normalizePptOutlineResult(parsed, request);
  } catch (error) {
    throwIfAborted(options.signal);
    throw error;
  }
}

function dryRunResult(request) {
  const messages = buildPptOutlineMessages(request);
  return {
    tool: 'ppt.outline',
    dry_run: true,
    request,
    plan: {
      output_files: ['outline.md', 'outline-guide.md', 'outline.json', 'manifest.json'],
      requires_ai_provider: true,
      slide_count: request.slide_count,
      deck_type: request.deck_type,
      schema_version: 2,
      quality_guardrails: [
        'fact_bank_no_invention',
        'slide_roles',
        'layout_intent',
        'self_check'
      ],
      prompt_characters: request.prompt.length,
      system_prompt_characters: messages[0].content.length,
      user_prompt_characters: messages[1].content.length
    }
  };
}

export async function generatePptOutline(args, options = {}) {
  try {
    throwIfAborted(options.signal);
    assertObject(args);
    assertOnlyKeys(args, new Set([
      'prompt',
      'output_dir',
      'slide_count',
      'audience',
      'purpose',
      'tone',
      'style',
      'deck_type',
      'locale',
      'dry_run',
      'output_name'
    ]));
    report(options, 0, 'Validating PPT outline request.');
    const request = normalizePptOutlineRequest(args);
    if (args.dry_run === true) {
      report(options, 100, 'PPT outline dry-run completed.');
      return dryRunResult(request);
    }

    const provider = providerConfig(options.env || process.env);
    let outline = null;
    let lastError = null;
    const retryDelayMs = Number.isFinite(options.retryDelayMs)
      ? Math.max(0, Math.min(5000, options.retryDelayMs))
      : DEFAULT_RETRY_DELAY_MS;
    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
      try {
        throwIfAborted(options.signal);
        report(options, attempt === 0 ? 18 : 28 + attempt * 12, attempt === 0
          ? 'Generating PPT outline with AI.'
          : `Retrying PPT outline generation (${attempt + 1}/${MAX_GENERATION_ATTEMPTS}).`);
        outline = await requestOutline({ request, provider, options, retry: attempt > 0 });
        lastError = null;
        break;
      } catch (error) {
        lastError = mapPptOutlineError(error);
        const canRetry = lastError.details?.retryable === true && attempt + 1 < MAX_GENERATION_ATTEMPTS;
        if (!canRetry) throw lastError;
        if (retryDelayMs > 0) await waitForAbortable(retryDelayMs * (attempt + 1), options.signal);
      }
    }
    if (!outline) throw lastError || new ToolKnitError('PROCESSING_FAILED', 'PPT outline generation failed.');

    report(options, 62, 'Validated generated PPT outline structure.');
    throwIfAborted(options.signal);
    const outputParent = await prepareOutputParent(args.output_dir);
    const baseName = args.output_name || outline.title || 'ppt-outline';
    const finalDirectory = await reserveBatchDirectory(outputParent, baseName);
    const temporaryDirectory = await mkdtemp(path.join(outputParent, '.toolknit-ppt-outline-'));
    try {
      const result = {
        tool: 'ppt.outline',
        dry_run: false,
        output_dir: finalDirectory,
        run_id: randomUUID(),
        generated_at: new Date().toISOString(),
        provider: { url: provider.url, model: provider.model },
        outline,
        outputs: [],
        manifest_path: path.join(finalDirectory, 'manifest.json')
      };
      report(options, 78, 'Writing PPT outline outputs.');
      throwIfAborted(options.signal);
      const outputSpecs = [
        { file: 'outline.md', kind: 'markdown', content: createPptOutlineMarkdown(outline) },
        { file: 'outline-guide.md', kind: 'guide', content: createPptOutlineGuide(outline) },
        { file: 'outline.json', kind: 'json', content: `${JSON.stringify(outline, null, 2)}\n` }
      ];
      for (const spec of outputSpecs) {
        throwIfAborted(options.signal);
        const temporaryPath = path.join(temporaryDirectory, spec.file);
        await writeFile(temporaryPath, spec.content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        const metadata = await stat(temporaryPath);
        result.outputs.push({ path: path.join(finalDirectory, spec.file), relative_path: spec.file, kind: spec.kind, bytes: metadata.size });
      }
      const manifest = {
        ...createPptOutlineManifest(outline),
        tool: result.tool,
        dry_run: false,
        output_dir: finalDirectory,
        run_id: result.run_id,
        generated_at: result.generated_at,
        provider: result.provider,
        outputs: result.outputs
      };
      await writeFile(path.join(temporaryDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600
      });
      report(options, 94, 'Publishing PPT outline output directory.');
      throwIfAborted(options.signal);
      await rename(temporaryDirectory, finalDirectory);
      report(options, 100, 'Published PPT outline outputs.');
      return result;
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  } catch (error) {
    throw mapPptOutlineError(error);
  }
}
