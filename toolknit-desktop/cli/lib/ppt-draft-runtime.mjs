import { randomUUID } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
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

const [draftCore, outlineCore, providerCore] = await Promise.all([
  importCore('ppt-draft-core.js'),
  importCore('ppt-outline-core.js'),
  importCore('ai-provider-core.js')
]);

const {
  PptDraftError,
  buildPptDraftPptx,
  createPptDraftManifest,
  createPptDraftMarkdown,
  normalizePptDraftOutline,
  normalizePptDraftRequest,
  sanitizePptDraftBaseName
} = draftCore;
const {
  PptOutlineError,
  buildPptOutlineMessages,
  extractPptOutlineJson,
  normalizePptOutlineResult
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

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function assertOnlyKeys(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ToolKnitError('INVALID_ARGUMENT', `Unknown argument: ${key}`);
  }
}

function mapPptDraftError(error) {
  if (error instanceof ToolKnitError) return error;
  if (error instanceof PptDraftError || error instanceof PptOutlineError) {
    const message = error.userMessage || error.message;
    if (['invalid_request', 'invalid_slide_count', 'invalid_locale', 'invalid_theme', 'invalid_outline'].includes(error.code)) {
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
    if (error.code === 'timeout') return new ToolKnitError('PROVIDER_TIMEOUT', 'AI PPT draft generation timed out.', {
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
    return new ToolKnitError('PROVIDER_TIMEOUT', 'AI PPT draft generation timed out.', {
      details: { stage: 'provider_request', retryable: true }
    });
  }
  return new ToolKnitError('PROCESSING_FAILED', String(error?.message || error || 'PPT draft generation failed.'));
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
  const safeBaseName = sanitizePptDraftBaseName(baseName);
  for (let index = 0; index < 10_000; index++) {
    const suffix = index === 0 ? '' : `_${index}`;
    const candidate = path.join(parentDirectory, `${safeBaseName}_ppt_draft${suffix}`);
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
  throw new ToolKnitError('OUTPUT_WRITE_FAILED', 'Could not reserve a unique PPT draft output directory.');
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

async function readOutlineFile(filePathValue) {
  const filePath = assertPathValue(filePathValue, 'outline_path');
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch {
    throw new ToolKnitError('INPUT_INVALID', `Outline file cannot be read: ${filePath}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 2 || metadata.size > 5 * 1024 * 1024) {
    throw new ToolKnitError('INPUT_INVALID', 'outline_path must be a regular JSON file no larger than 5 MB.');
  }
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    throw new ToolKnitError('INPUT_INVALID', 'outline_path must contain valid JSON.');
  }
}

async function requestOutline({ request, provider, options, retry }) {
  try {
    throwIfAborted(options.signal);
    const style = [request.style, `PPTX draft theme: ${request.theme}`].filter(Boolean).join('\n');
    const content = await requestAiCompletion({
      url: provider.url,
      apiKey: provider.apiKey,
      model: provider.model,
      messages: buildPptOutlineMessages({ ...request, style }, { retry }),
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

function dryRunResult(request, hasOutline) {
  return {
    tool: 'ppt.draft',
    dry_run: true,
    request,
    plan: {
      output_files: ['draft.pptx', 'outline.json', 'outline.md', 'manifest.json'],
      requires_ai_provider: !hasOutline,
      slide_count: request.slide_count,
      deck_type: request.deck_type,
      theme: request.theme,
      prompt_characters: request.prompt.length,
      mode: hasOutline ? 'outline-to-pptx' : 'prompt-to-outline-to-pptx'
    }
  };
}

export async function generatePptDraft(args, options = {}) {
  try {
    throwIfAborted(options.signal);
    assertObject(args);
    assertOnlyKeys(args, new Set([
      'prompt',
      'outline',
      'outline_path',
      'output_dir',
      'slide_count',
      'deck_type',
      'audience',
      'purpose',
      'tone',
      'style',
      'theme',
      'locale',
      'dry_run',
      'output_name'
    ]));
    const inputModes = [args.prompt, args.outline, args.outline_path]
      .filter(value => value !== undefined && value !== null && value !== '').length;
    if (inputModes !== 1) {
      throw new ToolKnitError('INVALID_ARGUMENT', 'Provide exactly one of prompt, outline, or outline_path.');
    }
    report(options, 0, 'Validating PPT draft request.');
    const outlinePayload = args.outline || (args.outline_path ? await readOutlineFile(args.outline_path) : null);
    const outlineDraftRequest = plainObject(outlinePayload?.draft_request);
    const outlineRequest = plainObject(outlinePayload?.request);
    const outlineDesign = plainObject(outlinePayload?.design);
    const request = normalizePptDraftRequest({
      ...args,
      prompt: args.prompt || outlineDraftRequest.prompt || outlineRequest.prompt || outlinePayload?.title || 'PPT draft',
      slide_count: args.slide_count || outlineDraftRequest.slide_count || outlineRequest.slide_count || outlinePayload?.slides?.length || 8,
      deck_type: args.deck_type || outlineDraftRequest.deck_type || outlineRequest.deck_type || outlinePayload?.deck_type,
      audience: args.audience || outlineDraftRequest.audience || outlineRequest.audience || outlinePayload?.audience,
      purpose: args.purpose || outlineDraftRequest.purpose || outlineRequest.purpose || outlinePayload?.purpose,
      tone: args.tone || outlineDraftRequest.tone || outlineRequest.tone,
      style: args.style || outlineDraftRequest.style || outlineRequest.style || outlineDesign.style || outlineDesign.visual_system,
      theme: args.theme || outlineDraftRequest.theme || outlineRequest.theme || outlineDesign.theme
    });
    if (args.dry_run === true) {
      report(options, 100, 'PPT draft dry-run completed.');
      return dryRunResult(request, Boolean(outlinePayload));
    }

    let outline = null;
    let provider = null;
    if (outlinePayload) {
      report(options, 18, 'Using provided PPT outline.');
      outline = normalizePptDraftOutline(outlinePayload, request);
    } else {
      provider = providerConfig(options.env || process.env);
      let lastError = null;
      const retryDelayMs = Number.isFinite(options.retryDelayMs)
        ? Math.max(0, Math.min(5000, options.retryDelayMs))
        : DEFAULT_RETRY_DELAY_MS;
      for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
        try {
          throwIfAborted(options.signal);
          report(options, attempt === 0 ? 18 : 28 + attempt * 12, attempt === 0
            ? 'Generating PPT draft outline with AI.'
            : `Retrying PPT draft outline (${attempt + 1}/${MAX_GENERATION_ATTEMPTS}).`);
          outline = await requestOutline({ request, provider, options, retry: attempt > 0 });
          lastError = null;
          break;
        } catch (error) {
          lastError = mapPptDraftError(error);
          const canRetry = lastError.details?.retryable === true && attempt + 1 < MAX_GENERATION_ATTEMPTS;
          if (!canRetry) throw lastError;
          if (retryDelayMs > 0) await waitForAbortable(retryDelayMs * (attempt + 1), options.signal);
        }
      }
      if (!outline) throw lastError || new ToolKnitError('PROCESSING_FAILED', 'PPT draft outline generation failed.');
      outline = normalizePptDraftOutline(outline, request);
    }

    report(options, 58, 'Building editable PPTX draft.');
    throwIfAborted(options.signal);
    const draft = await buildPptDraftPptx(outline, { theme: request.theme, request });
    throwIfAborted(options.signal);
    const outputParent = await prepareOutputParent(args.output_dir);
    const baseName = args.output_name || outline.title || 'ppt-draft';
    const finalDirectory = await reserveBatchDirectory(outputParent, baseName);
    const temporaryDirectory = await mkdtemp(path.join(outputParent, '.toolknit-ppt-draft-'));
    try {
      const safeFileBase = sanitizePptDraftBaseName(baseName);
      const pptxFile = `${safeFileBase}.pptx`;
      const result = {
        tool: 'ppt.draft',
        dry_run: false,
        output_dir: finalDirectory,
        run_id: randomUUID(),
        generated_at: new Date().toISOString(),
        provider: provider ? { url: provider.url, model: provider.model } : null,
        theme: draft.theme,
        outline: draft.outline,
        output_file: pptxFile,
        output_path: path.join(finalDirectory, pptxFile),
        outputs: [],
        manifest_path: path.join(finalDirectory, 'manifest.json')
      };
      report(options, 78, 'Writing PPT draft outputs.');
      throwIfAborted(options.signal);
      const outputSpecs = [
        { file: pptxFile, kind: 'pptx', content: draft.bytes, binary: true },
        { file: 'outline.json', kind: 'json', content: `${JSON.stringify(draft.outline, null, 2)}\n` },
        { file: 'outline.md', kind: 'markdown', content: createPptDraftMarkdown(draft.outline) }
      ];
      for (const spec of outputSpecs) {
        throwIfAborted(options.signal);
        const temporaryPath = path.join(temporaryDirectory, spec.file);
        await writeFile(temporaryPath, spec.content, spec.binary
          ? { flag: 'wx', mode: 0o600 }
          : { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        const metadata = await stat(temporaryPath);
        result.outputs.push({ path: path.join(finalDirectory, spec.file), relative_path: spec.file, kind: spec.kind, bytes: metadata.size });
      }
      const manifest = {
        ...createPptDraftManifest({
          outline: draft.outline,
          theme: draft.theme,
          outputFile: pptxFile,
          outputBytes: draft.bytes.byteLength,
          outputs: result.outputs,
          assets: draft.assets,
          assetManifest: draft.asset_manifest
        }),
        tool: result.tool,
        dry_run: false,
        output_dir: finalDirectory,
        run_id: result.run_id,
        generated_at: result.generated_at,
        provider: result.provider
      };
      await writeFile(path.join(temporaryDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600
      });
      report(options, 94, 'Publishing PPT draft output directory.');
      throwIfAborted(options.signal);
      await rename(temporaryDirectory, finalDirectory);
      report(options, 100, 'Published PPT draft outputs.');
      return result;
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  } catch (error) {
    throw mapPptDraftError(error);
  }
}
