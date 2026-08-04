import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ToolKnitError } from './errors.mjs';
import { assertAiDocumentOutputAvailable, createAiDocumentProjectArtifacts } from './ai-document-project-runtime.mjs';

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGED_CORE_ROOT = path.join(CLI_ROOT, 'lib', 'core');
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_GENERATION_ATTEMPTS = 5;
const DEFAULT_RETRY_DELAY_MS = 350;
const DEFAULT_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-chat';

async function importCore(fileName) {
  const stagedPath = path.join(STAGED_CORE_ROOT, fileName);
  try {
    await readFile(stagedPath);
    return import(pathToFileURL(stagedPath).href);
  } catch {
    return import(new URL(`../../src/${fileName}`, import.meta.url));
  }
}

const [documentCore, providerCore] = await Promise.all([
  importCore('ai-doc-core.js'),
  importCore('ai-provider-core.js')
]);

const { AI_DOC_LIMITS, AiDocLayoutError, normalizeAiDocLayout } = documentCore;
const { AiProviderError, isPlaceholderAiApiKey, requestAiCompletion } = providerCore;

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

function normalizeArguments(args) {
  assertObject(args);
  assertOnlyKeys(args, new Set(['prompt', 'output_path', 'page_count', 'locale', 'overwrite']));
  if (typeof args.prompt !== 'string' || !args.prompt.trim()) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'prompt must be a non-empty string.');
  }
  const prompt = args.prompt.trim();
  if (prompt.length > AI_DOC_LIMITS.maxPromptChars) {
    throw new ToolKnitError('INVALID_ARGUMENT', `prompt exceeds the ${AI_DOC_LIMITS.maxPromptChars}-character limit.`);
  }
  if (typeof args.output_path !== 'string' || !args.output_path.trim()) {
    throw new ToolKnitError('INVALID_ARGUMENT', 'output_path must be a non-empty PDF path.');
  }
  const pageCount = args.page_count === undefined ? 3 : args.page_count;
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > AI_DOC_LIMITS.maxPages) {
    throw new ToolKnitError('INVALID_ARGUMENT', `page_count must be an integer from 1 to ${AI_DOC_LIMITS.maxPages}.`);
  }
  const locale = args.locale === undefined ? 'zh-CN' : args.locale;
  if (locale !== 'zh-CN' && locale !== 'en') {
    throw new ToolKnitError('INVALID_ARGUMENT', 'locale must be zh-CN or en.');
  }
  if (args.overwrite !== undefined && typeof args.overwrite !== 'boolean') {
    throw new ToolKnitError('INVALID_ARGUMENT', 'overwrite must be true or false.');
  }
  return {
    prompt,
    outputPath: args.output_path.trim(),
    pageCount,
    locale,
    overwrite: args.overwrite === true
  };
}

function providerConfig(env) {
  const apiKey = [env.TOOLKNIT_AI_API_KEY, env.DEEPSEEK_API_KEY]
    .find(candidate => !isPlaceholderAiApiKey(candidate));
  if (!apiKey) {
    throw new ToolKnitError(
      'ENGINE_UNAVAILABLE',
      'AI provider key is missing or still a placeholder. Set DEEPSEEK_API_KEY to a real key in the ToolKnit MCP server environment, then restart the IDE.'
    );
  }
  return {
    apiKey,
    url: env.TOOLKNIT_AI_API_URL || DEFAULT_API_URL,
    model: env.TOOLKNIT_AI_MODEL || DEFAULT_MODEL
  };
}

function buildSystemPrompt({ pageCount, locale, retry = false }) {
  const outputLanguage = locale === 'en' ? 'English' : 'Simplified Chinese';
  return `You are ToolKnit's professional document editor and A4 layout engine.
Create a polished ${pageCount}-page PDF document in ${outputLanguage} from the user's brief.

Hard requirements:
- Return one raw JSON object only. Do not use markdown fences or explanatory text.
- The object must be {"ready":true,"summary":"...","pages":[{"regions":[...]}]}.
- pages must contain exactly ${pageCount} items. Do not return fewer or more pages.
- Every page must contain meaningful, non-repeated content. Keep each page within y=60..960 and leave a bottom safety margin so rendering never creates an extra page.
- Each page may contain at most 16 regions, counting every table row separately. Merge or shorten content instead of adding more regions.
- Do not return page-header or page-footer regions; ToolKnit creates page chrome and exact page numbers.
- Never invent dates, version numbers, identifiers, compatibility claims, measurements, test outcomes, acceptance results, or release status.
- Use only facts explicitly supplied by the user. When a requested factual field is missing, write "待确认" in Chinese or "Not provided" in English and do not infer a value.
- Do not claim that a test passed, a product is production-ready, or a risk is resolved unless the user explicitly supplied that result.
- Do not use generic filler, emoji, decorative symbols, fake citations, or invented factual sources. "待确认" and "Not provided" are allowed only for missing factual fields.
- Use modern monochrome business-document styling with clear hierarchy and restrained whitespace.
- Page 1 should establish the title, executive context, and key facts. Middle pages should develop the subject. The final page should close with conclusions, actions, risks, or next steps as appropriate.

A4 layout:
- Canvas: 794 x 1123 px. Content x=56, width=682. Usable y=60..1000.
- Each page should contain 6-16 regions and remain comfortably within the usable area. The sum of rendered region heights and gaps must stay below 900 px.
- Place regions in reading order with non-overlapping y values. Related content must stay together.

Allowed region types:
- title: fontSize 28-32, bold, centered, h about 50.
- subtitle: fontSize 13-15, centered, h about 24.
- section-heading: fontSize 16-19, bold, h about 34.
- sub-heading: fontSize 14-16, bold, h about 26.
- body/body-indent: fontSize 13.5-15, complete paragraphs, h based on line count.
- list-item: fontSize 13-14, concise numbered or bulleted item.
- table-row: fontSize 12-14; text uses " | " between 2-4 cells; adjacent rows use the same cell count. Use bold=true for table headers.
- emphasis: fontSize 13-15, bold=true; use for one key conclusion, not ordinary paragraphs.
- note: fontSize 11.5-13; use for a restrained supplementary note.
- signature/date/divider/image are allowed only when the user's document genuinely needs them.

Content rules:
- Consolidate metadata into table-row regions instead of one block per field.
- Use table-row for schedules, comparisons, responsibilities, milestones, budgets, and action lists.
- Keep body regions to focused 1-3 line paragraphs. Prefer editing and synthesis over padding.
- Honor the user's requested facts and tone. Clearly label assumptions instead of presenting them as verified facts.
${retry ? '- This is a correction attempt: the previous response failed safety or layout validation. Remove every unsupported factual claim, preserve exact page count, return valid JSON, and keep content within the page bounds.' : ''}`;
}

function normalizeForGrounding(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

function promptAllowsHypotheticalFacts(prompt) {
  return /(?:虚构|假设数据|示例数据|模拟数据|演示数据|fictional|hypothetical|mock data|sample data)/i.test(prompt);
}

function isNegatedOutcome(segment, index) {
  const prefix = segment.slice(Math.max(0, index - 50), index);
  return /(?:不得|不能|不可|尚未|并非|并未|没有|无需)[^。；\n]{0,40}$/i.test(prefix)
    || /\b(?:not|never|cannot|can't|isn't|is not|hasn't|has not|without)\b[^.\n]{0,40}$/i.test(prefix);
}

function ungroundedContentClaims(layout, prompt) {
  if (promptAllowsHypotheticalFacts(prompt)) return [];
  const grounded = normalizeForGrounding(prompt);
  const claims = [];
  const seen = new Set();
  const addClaim = (kind, value, location) => {
    const normalized = normalizeForGrounding(value);
    if (!normalized || grounded.includes(normalized)) return;
    const key = `${location.pageIndex ?? 'summary'}:${location.regionIndex ?? 0}:${location.field}:${kind}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push({ kind, value, ...location });
  };
  const segments = [
    { value: layout.summary, pageIndex: null, regionIndex: null, field: 'summary' },
    ...layout.pages.flatMap((page, pageIndex) => page.regions.map((region, regionIndex) => ({
      value: region.text || region.label || '',
      pageIndex,
      regionIndex,
      field: region.text ? 'text' : 'label'
    })))
  ];
  for (const item of segments) {
    const segment = item.value;
    for (const match of segment.matchAll(/(?:20\d{2}[-/.]\d{1,2}(?:[-/.]\d{1,2})?|20\d{2}年\d{1,2}月(?:\d{1,2}日)?)/g)) {
      addClaim('date', match[0], item);
    }
    for (const match of segment.matchAll(/\bv?\d+\.\d+\.\d+(?:\.\d+)?\b/gi)) addClaim('version', match[0], item);
    for (const match of segment.matchAll(/\bv\d+\.\d+(?:\.\d+)?\b/gi)) addClaim('version', match[0], item);
    if (/(?:版本|version)/i.test(segment)) {
      for (const match of segment.matchAll(/\b\d+\.\d+(?:\.\d+)?\b/g)) addClaim('version', match[0], item);
    }
    for (const match of segment.matchAll(/\b(?:Windows\s*\d+(?:\.\d+)?|macOS\s*\d+(?:\.\d+)?|iOS\s*\d+(?:\.\d+)?|Android\s*\d+(?:\.\d+)?)\+?\b/gi)) {
      addClaim('platform_compatibility', match[0], item);
    }
    for (const match of segment.matchAll(/\b[A-Z]{2,}(?:-[A-Z0-9]+){2,}\b/g)) addClaim('identifier', match[0], item);
    for (const pattern of [
      /(?:全部|所有|各项|六阶段)[^。；\n]{0,20}(?:通过|达标|合格)/g,
      /(?:验收|测试)(?:状态|结果|结论)[^。；\n]{0,12}(?:通过|成功|达标|合格)/g,
      /(?:已|均|成功)[^。；\n]{0,12}(?:通过验收|通过测试|达到验收标准)/g,
      /(?:可投入生产(?:使用)?|具备(?:上线|发布|生产)条件|未发现[^。；\n]{0,16}(?:问题|缺陷|风险|阻塞))/g,
      /(?:all (?:tests|checks)[^.\n]{0,20}pass(?:ed)?|production[- ]ready|ready for production|acceptance[^.\n]{0,12}pass(?:ed)?)/gi
    ]) {
      for (const match of segment.matchAll(pattern)) {
        if (!isNegatedOutcome(segment, match.index)) addClaim('unverified_outcome', match[0], item);
      }
    }
  }
  return claims;
}

function sanitizeUngroundedClaims(layout, claims, locale) {
  const replacementFor = kind => kind === 'unverified_outcome'
    ? (locale === 'en' ? 'Acceptance status: not provided' : '验收状态：待确认')
    : (locale === 'en' ? 'Not provided' : '待确认');
  const sanitized = {
    ...layout,
    pages: layout.pages.map(page => ({
      ...page,
      regions: page.regions.map(region => ({ ...region }))
    }))
  };
  for (const claim of claims) {
    const target = claim.pageIndex === null
      ? sanitized
      : sanitized.pages[claim.pageIndex].regions[claim.regionIndex];
    const current = target[claim.field];
    if (typeof current !== 'string' || !current.includes(claim.value)) continue;
    target[claim.field] = current.split(claim.value).join(replacementFor(claim.kind));
  }
  return sanitized;
}

function extractJsonObject(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const direct = JSON.parse(trimmed);
    return direct && typeof direct === 'object' ? direct : null;
  } catch {}

  const start = trimmed.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < trimmed.length; index++) {
    const character = trimmed[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function withErrorContext(error, details) {
  return new ToolKnitError(error.code, error.message, {
    exitCode: error.exitCode,
    details: { ...(error.details || {}), ...details }
  });
}

function normalizeProviderError(error, stage = 'provider_request') {
  if (error instanceof ToolKnitError) {
    if (error.details?.stage) return error;
    const contentStage = error.code === 'AI_LAYOUT_INVALID' || error.code === 'AI_CONTENT_UNVERIFIED';
    return withErrorContext(error, {
      stage: contentStage && stage === 'provider_request' ? 'provider_response' : stage,
      retryable: contentStage
    });
  }
  if (error?.name === 'AbortError') {
    return new ToolKnitError('PROVIDER_TIMEOUT', 'AI document generation timed out.', {
      details: { stage: 'provider_request', retryable: true }
    });
  }
  if (error instanceof AiProviderError) {
    if (error.code === 'invalid_config') {
      return new ToolKnitError('ENGINE_UNAVAILABLE', 'The AI provider configuration is invalid.', {
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
      details: { stage: 'provider_response', retryable: true }
    });
  }
  if (error instanceof AiDocLayoutError) {
    return new ToolKnitError('AI_LAYOUT_INVALID', 'The AI provider returned an invalid document layout.', {
      details: { stage: 'provider_response', retryable: true }
    });
  }
  if (stage === 'provider_request' && (error instanceof TypeError || typeof error?.code === 'string')) {
    return new ToolKnitError('PROVIDER_ERROR', 'The AI provider request could not be completed.', {
      details: { stage: 'provider_request', retryable: true }
    });
  }
  return new ToolKnitError('PROCESSING_FAILED', 'ToolKnit could not generate the AI document.', {
    details: { stage, retryable: false }
  });
}

async function requestLayout({ args, config, fetchImpl, retry, repairUngrounded }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const content = await requestAiCompletion({
      url: config.url,
      apiKey: config.apiKey,
      model: config.model,
      maxTokens: 16384,
      signal: controller.signal,
      fetchImpl,
      messages: [
        { role: 'system', content: buildSystemPrompt({ pageCount: args.pageCount, locale: args.locale, retry }) },
        { role: 'user', content: args.prompt }
      ]
    });
    if (content.length > AI_DOC_LIMITS.maxResponseChars) {
      throw new ToolKnitError('PROVIDER_ERROR', 'The AI document response exceeded the safe size limit.');
    }
    const parsed = extractJsonObject(content);
    if (!parsed) throw new ToolKnitError('AI_LAYOUT_INVALID', 'The AI provider did not return valid document JSON.');
    const layout = normalizeAiDocLayout(parsed);
    if (layout.pages.length !== args.pageCount) {
      throw new ToolKnitError('AI_LAYOUT_INVALID', `The AI layout did not contain exactly ${args.pageCount} pages.`);
    }
    const claims = ungroundedContentClaims(layout, args.prompt);
    if (claims.length) {
      const claimTypes = [...new Set(claims.map(claim => claim.kind))];
      if (repairUngrounded) {
        return {
          layout: sanitizeUngroundedClaims(layout, claims, args.locale),
          contentDiagnostics: [{
            severity: 'warning',
            code: 'ungrounded_fact_replaced',
            message: `Replaced ${claims.length} unsupported factual claim(s) with an explicit not-provided marker.`,
            claimTypes
          }]
        };
      }
      throw new ToolKnitError(
        'AI_CONTENT_UNVERIFIED',
        'The AI provider introduced factual claims that were not supplied by the user.',
        {
          details: {
            stage: 'content_validation',
            retryable: true,
            claimTypes
          }
        }
      );
    }
    return { layout, contentDiagnostics: [] };
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateAiDocument(argsValue, options = {}) {
  const args = normalizeArguments(argsValue);
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const retryDelayMs = Number.isFinite(options.retryDelayMs)
    ? Math.max(0, Math.min(5000, options.retryDelayMs))
    : DEFAULT_RETRY_DELAY_MS;
  const reportProgress = typeof options.reportProgress === 'function' ? options.reportProgress : () => {};
  await assertAiDocumentOutputAvailable(args.outputPath, args.overwrite);
  const config = providerConfig(env);
  reportProgress(5, 'Validated the document request and output path.');

  let lastError;
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    try {
      reportProgress(attempt === 0 ? 15 : 25 + attempt * 10, attempt === 0
        ? 'Generating the document layout.'
        : `Retrying document generation after a recoverable failure (${attempt + 1}/${MAX_GENERATION_ATTEMPTS}).`);
      const { layout, contentDiagnostics } = await requestLayout({
        args,
        config,
        fetchImpl,
        retry: attempt > 0,
        repairUngrounded: attempt >= 2
      });
      reportProgress(60, 'Validated the generated document structure.');
      let artifacts;
      try {
        artifacts = await createAiDocumentProjectArtifacts({
          layout,
          outputPath: args.outputPath,
          locale: args.locale,
          overwrite: args.overwrite,
          expectedPageCount: args.pageCount,
          reportProgress
        });
      } catch (error) {
        throw normalizeProviderError(error, 'document_render');
      }
      return {
        tool: 'ai.document',
        request: { locale: args.locale, pages: args.pageCount, prompt_characters: args.prompt.length },
        summary: layout.summary,
        project: { path: artifacts.paths.projectPath, revision: artifacts.project.revision },
        diagnostics: [...contentDiagnostics, ...artifacts.rendered.diagnostics],
        outputs: artifacts.outputs
      };
    } catch (error) {
      lastError = normalizeProviderError(error, 'provider_request');
      const canRetry = lastError.details?.retryable === true && attempt + 1 < MAX_GENERATION_ATTEMPTS;
      if (!canRetry) {
        throw withErrorContext(lastError, { attempts: attempt + 1 });
      }
      if (retryDelayMs > 0) await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)));
    }
  }
  throw lastError || new ToolKnitError('PROCESSING_FAILED', 'ToolKnit could not generate the AI document.');
}
