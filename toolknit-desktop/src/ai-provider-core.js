import { readResponseTextLimited as readBoundedResponseText, ResponseSizeLimitError } from './core/bounded-response.js';

export const AI_PROVIDER_LIMITS = Object.freeze({
  maxRequestBytes: 8 * 1024 * 1024,
  maxResponseBytes: 2 * 1024 * 1024,
  maxMessages: 12,
  maxMessageChars: 50000,
  maxMultimodalBytes: 8 * 1024 * 1024,
  maxTokens: 16384,
  maxTimeoutMs: 180000
});

export class AiProviderError extends Error {
  constructor(code, status = null, message = code, diagnostics = undefined) {
    super(message);
    this.name = 'AiProviderError';
    this.code = code;
    this.status = Number.isInteger(status) ? status : null;
    if (diagnostics) this.diagnostics = diagnostics;
  }
}

export const AI_DIAGNOSTIC_MAX_BYTES = 32 * 1024;
const MAX_FIELD_CHARS = 2048;
const ERROR_FIELDS = ['code', 'type', 'message', 'msg', 'detail', 'param', 'request_id'];

function safeText(value, { apiKey = '', messages = [] } = {}) {
  if (!['string', 'number', 'boolean'].includes(typeof value)) return undefined;
  let text = String(value);
  if (text.length > MAX_FIELD_CHARS) return '[omitted: diagnostic field too long]';
  const key = apiKey.trim();
  for (const secret of key ? [key, encodeURIComponent(key)] : []) text = text.split(secret).join('[redacted]');
  for (const message of messages) {
    for (const part of Array.isArray(message.content) ? message.content : []) {
      const image = part?.image_url?.url;
      if (typeof image !== 'string') continue;
      for (let offset = 0; offset + 16 <= text.length; offset += 8) {
        if (image.includes(text.slice(offset, offset + 16))) return '[redacted: image content]';
      }
    }
    const content = typeof message.content === 'string'
      ? message.content.trim()
      : Array.isArray(message.content)
        ? message.content.filter(part => part?.type === 'text').map(part => part.text || '').join('\n').trim()
        : '';
    if (!content) continue;
    if (text.includes(content)) return '[redacted: request content]';
    // Providers sometimes echo only an excerpt of a prompt inside error.message.
    for (let offset = 0; offset + 16 <= text.length; offset += 8) {
      if (content.includes(text.slice(offset, offset + 16))) return '[redacted: request content]';
    }
  }
  return text
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]')
    .replace(/\bsk[-_][a-z0-9_-]+/gi, '[redacted]')
    .replace(/\b(api[_-]?key|authorization|access[_-]?token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL omitted]')
    .replace(/(?:[a-z]:[\\/]|\\\\)[^\r\n"'<>]+/gi, '[path omitted]')
    .replace(/\/(?:Users|home|tmp|var)\/[^\s"'<>]+/g, '[path omitted]')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
}

function safeCompletionSummary(raw) {
  const summary = {};
  if (['stop', 'length', 'tool_calls', 'function_call', 'content_filter'].includes(raw?.finishReason)) summary.finishReason = raw.finishReason;
  for (const field of ['contentBytes', 'reasoningBytes']) {
    if (Number.isSafeInteger(raw?.[field]) && raw[field] >= 0) summary[field] = raw[field];
  }
  const usage = {};
  for (const field of ['promptTokens', 'completionTokens', 'totalTokens', 'reasoningTokens']) {
    if (Number.isSafeInteger(raw?.usage?.[field]) && raw.usage[field] >= 0) usage[field] = raw.usage[field];
  }
  if (Object.keys(usage).length) summary.usage = usage;
  return summary;
}

function completionSummary(payload) {
  const choice = payload?.choices?.[0];
  const message = choice?.message;
  return safeCompletionSummary({
    finishReason: choice?.finish_reason,
    contentBytes: typeof message?.content === 'string' ? utf8ByteLength(message.content) : undefined,
    reasoningBytes: typeof message?.reasoning_content === 'string' ? utf8ByteLength(message.reasoning_content) : undefined,
    usage: {
      promptTokens: payload?.usage?.prompt_tokens,
      completionTokens: payload?.usage?.completion_tokens,
      totalTokens: payload?.usage?.total_tokens,
      reasoningTokens: payload?.usage?.completion_tokens_details?.reasoning_tokens ?? payload?.usage?.reasoning_tokens
    }
  });
}

/** Project untrusted responses onto error fields; never expose choices/messages. */
export function createAiProviderDiagnostics(raw, request, { code, status, transport }) {
  const endpoint = new URL(request.url);
  const result = {
    transport, method: 'POST', host: safeText(endpoint.host, request),
    path: safeText(endpoint.pathname, request), model: safeText(request.model, request),
    code, status, stage: 'request', response: null
  };
  if (Number.isInteger(request.maxTokens) && request.maxTokens > 0) result.maxTokens = request.maxTokens;
  result.reasoningEffort = ['low', 'high', 'max'].includes(request.reasoningEffort) ? request.reasoningEffort : null;
  if (!raw || typeof raw !== 'object') return Object.freeze(result);
  if (result.status == null && Number.isInteger(raw.status) && raw.status >= 100 && raw.status <= 599) result.status = raw.status;
  if (raw.completion) result.completion = safeCompletionSummary(raw.completion);
  if (['request', 'response_headers', 'response_body', 'response_parse', 'completion'].includes(raw.stage)) result.stage = raw.stage;
  if (['connect', 'timeout', 'network_error', 'body_read_failed', 'body_too_large'].includes(raw.reason)) result.reason = raw.reason;
  if (typeof raw.contentType === 'string') result.contentType = safeText(raw.contentType.split(';')[0], request);
  if (typeof raw.requestId === 'string') result.requestId = safeText(raw.requestId, request);
  if (raw.truncated === true) result.truncated = true;
  if (typeof raw.body !== 'string' || !raw.body) return Object.freeze(result);
  if (new TextEncoder().encode(raw.body).byteLength > AI_DIAGNOSTIC_MAX_BYTES) {
    result.truncated = true;
    return Object.freeze(result);
  }
  let payload;
  try { payload = JSON.parse(raw.body); } catch {
    const html = raw.body.trimStart().startsWith('<');
    result.response = { format: html ? 'html' : 'text', message: html || code !== 'http_error'
      ? '[Non-JSON response omitted; check status and endpoint]' : safeText(raw.body, request) };
    return Object.freeze(result);
  }
  const source = payload?.error ?? (code === 'http_error' ? payload : null);
  if (result.stage === 'completion' && !result.completion) result.completion = completionSummary(payload);
  const error = {};
  if (typeof source === 'string') error.message = safeText(source, request);
  else if (source && typeof source === 'object' && !Array.isArray(source)) {
    for (const field of ERROR_FIELDS) {
      const value = safeText(source[field], request);
      if (value !== undefined) error[field] = value;
    }
  }
  result.response = { format: 'json', error };
  return Object.freeze(result);
}

export async function readAiErrorDiagnostics(response) {
  const raw = {
    stage: 'response_body', contentType: response.headers?.get?.('content-type'),
    requestId: response.headers?.get?.('x-request-id') || response.headers?.get?.('request-id')
  };
  let reader, timer;
  try {
    reader = response.body?.getReader?.();
    const source = reader ? { headers: response.headers, body: { getReader: () => reader } } : response;
    const deadline = new Promise(resolve => {
      timer = setTimeout(() => {
        raw.reason = 'timeout';
        try { void reader?.cancel?.().catch(() => {}); } catch {}
        resolve(null);
      }, 2000);
    });
    const body = await Promise.race([readBoundedResponseText(source, AI_DIAGNOSTIC_MAX_BYTES), deadline]);
    if (typeof body === 'string') raw.body = body;
  } catch (error) {
    raw.reason = error instanceof ResponseSizeLimitError ? 'body_too_large' : 'body_read_failed';
    raw.truncated = error instanceof ResponseSizeLimitError;
    try { await reader?.cancel?.(); } catch {}
  } finally {
    clearTimeout(timer);
    try { reader?.releaseLock?.(); } catch {}
  }
  return raw;
}

/**
 * Treat documentation placeholders as missing credentials before a provider
 * request is made. This keeps a copied MCP example from turning into a vague
 * authentication or retry failure.
 */
export function isPlaceholderAiApiKey(value) {
  if (typeof value !== 'string') return true;
  const key = value.trim();
  if (!key) return true;
  const compact = key.toLowerCase().replace(/[\s_-]+/g, '');
  if (/^(?:<|\[|\{).*(?:>|\]|\})$/.test(key)) return true;
  if (/\$\{[^}]+\}/.test(key)) return true;
  if (/^(?:changeme|placeholder|example|replace(?:me)?|your(?:apikey|deepseekapikey)|deepseekapikey|你的(?:deepseek)?(?:api)?(?:密钥|key)|请(?:填写|替换)(?:api)?(?:密钥|key))$/i.test(compact)) return true;
  return /(?:your|replace|placeholder|example|你的|请填写|请替换).{0,32}(?:api|密钥|key)/i.test(key);
}

function isValidContentPart(part) {
  if (!part || typeof part !== 'object' || typeof part.type !== 'string') return false;
  if (part.type === 'text') return typeof part.text === 'string' && part.text.length <= AI_PROVIDER_LIMITS.maxMessageChars;
  if (part.type === 'image_url') {
    const url = part.image_url?.url;
    const match = typeof url === 'string' && url.match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    return Boolean(match && match[1].length % 4 === 0 && url.length <= AI_PROVIDER_LIMITS.maxMultimodalBytes
      && (part.image_url.detail === undefined || ['auto', 'low', 'high'].includes(part.image_url.detail)));
  }
  return false;
}

function isValidMessage(message) {
  const contentValid = typeof message?.content === 'string'
    ? message.content.length <= AI_PROVIDER_LIMITS.maxMessageChars
    : Array.isArray(message?.content)
      && message.role === 'user'
      && message.content.length > 0
      && message.content.length <= 8
      && message.content.every(isValidContentPart)
      && message.content.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : 0), 0) <= AI_PROVIDER_LIMITS.maxMessageChars
      && utf8ByteLength(JSON.stringify(message.content)) <= AI_PROVIDER_LIMITS.maxMultimodalBytes;
  return message
    && typeof message === 'object'
    && (message.role === 'system' || message.role === 'user' || message.role === 'assistant')
    && contentValid;
}

function contentLengthOf(response) {
  const raw = response?.headers?.get?.('content-length');
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

async function readResponseTextLimited(response) {
  const reader = response?.body?.getReader?.();
  if (!reader) return response.text();

  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !Number.isSafeInteger(value.byteLength)) {
        throw new AiProviderError('invalid_response');
      }
      received += value.byteLength;
      if (!Number.isSafeInteger(received) || received > AI_PROVIDER_LIMITS.maxResponseBytes) {
        try { await reader.cancel(); } catch {}
        throw new AiProviderError('response_too_large');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    try { reader.releaseLock?.(); } catch {}
  }
}

function isLoopbackHost(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true;
  const octets = parseIpv4Host(hostname);
  return !!octets && octets[0] === 127;
}

function parseIpv4Host(hostname) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
  const octets = hostname.split('.').map(Number);
  return octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255) ? octets : null;
}

function isPrivateNetworkHost(hostname) {
  const octets = parseIpv4Host(hostname);
  if (octets) {
    return octets[0] === 10
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168);
  }
  const ipv6 = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return /^(?:fc|fd)[0-9a-f]{2}(?::|$)/.test(ipv6);
}

export function isPrivateHttpAiProviderUrl(value) {
  try {
    const endpoint = new URL(value);
    return endpoint.protocol === 'http:' && isPrivateNetworkHost(endpoint.hostname);
  } catch {
    return false;
  }
}

export function normalizeAiProviderConfig({ url, model, allowPrivateHttp = false }) {
  if (typeof url !== 'string' || !url.trim() || typeof model !== 'string' || !model.trim()) {
    throw new AiProviderError('invalid_config');
  }

  let endpoint;
  try {
    endpoint = new URL(url.trim());
  } catch {
    throw new AiProviderError('invalid_config');
  }
  endpoint.hash = '';
  const isSecureEndpoint = endpoint.protocol === 'https:';
  const isLoopbackHttp = endpoint.protocol === 'http:' && isLoopbackHost(endpoint.hostname);
  const isPrivateHttp = endpoint.protocol === 'http:' && isPrivateNetworkHost(endpoint.hostname);
  if (endpoint.username || endpoint.password) {
    throw new AiProviderError('invalid_config');
  }
  if (isPrivateHttp && !allowPrivateHttp) {
    throw new AiProviderError('private_http_requires_opt_in');
  }
  if (!isSecureEndpoint && !isLoopbackHttp && !isPrivateHttp) {
    throw new AiProviderError('insecure_http_not_allowed');
  }
  // Accept the common provider settings users copy from documentation while
  // preserving explicit custom endpoints for compatible services.
  const pathname = endpoint.pathname.replace(/\/+$/, '') || '/';
  if (pathname === '/' || pathname === '/v1') {
    endpoint.pathname = '/v1/chat/completions';
  }
  return { url: endpoint.href, model: model.trim() };
}

function nativeAiProviderError(error, request, diagnostics) {
  const value = typeof error === 'string' ? error : String(error?.message || error || '');
  const match = value.match(/^ai-provider:(http_error):(\d{3})(?=:diagnostic:|$)/);
  const code = value.match(/^ai-provider:(aborted|timeout|network_error|native_transport_unavailable|private_http_requires_opt_in|insecure_http_not_allowed|provider_changed|invalid_config|invalid_request|invalid_response|response_too_large|response_truncated|empty_response)(?=:diagnostic:|$)/)?.[1];
  const result = new AiProviderError(match ? match[1] : code || 'network_error', match ? Number(match[2]) : null);
  const marker = ':diagnostic:';
  const index = value.indexOf(marker);
  if (diagnostics && index >= 0 && value.length <= AI_DIAGNOSTIC_MAX_BYTES * 8) {
    try {
      const raw = JSON.parse(value.slice(index + marker.length));
      result.diagnostics = createAiProviderDiagnostics(raw, request, { ...result, transport: 'native' });
    } catch { /* Malformed diagnostics must not replace the original provider error. */ }
  }
  return result;
}

async function waitForNativeAiProvider(request, signal) {
  if (!signal) return request;
  if (signal.aborted) throw new AiProviderError('aborted');
  return new Promise((resolve, reject) => {
    const abort = () => reject(new AiProviderError('aborted'));
    signal.addEventListener('abort', abort, { once: true });
    request.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/**
 * Calls an OpenAI-compatible endpoint. Error bodies are opt-in, bounded and
 * projected onto sanitized diagnostics; normal requests never consume them.
 */
export async function requestAiCompletion(options) {
  const { timeoutMs, signal } = options;
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > AI_PROVIDER_LIMITS.maxTimeoutMs)) {
    throw new AiProviderError('invalid_request');
  }
  if (signal?.aborted) throw new AiProviderError('aborted');
  if (timeoutMs === undefined || typeof options.nativeRequestImpl === 'function') return requestAiCompletionImpl(options);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    return await requestAiCompletionImpl({ ...options, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new AiProviderError('timeout');
    if (signal?.aborted) throw new AiProviderError('aborted');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function requestAiCompletionImpl({
  url,
  apiKey,
  model,
  messages,
  maxTokens,
  timeoutMs,
  reasoningEffort,
  temperature,
  signal,
  fetchImpl,
  nativeRequestImpl,
  diagnostics = false,
  allowPrivateHttp = false
}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new AiProviderError('invalid_config');
  }
  const config = normalizeAiProviderConfig({ url, model, allowPrivateHttp });
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > AI_PROVIDER_LIMITS.maxMessages
    || !messages.every(isValidMessage)
    || messages.reduce((sum, message) => sum + (Array.isArray(message.content) ? utf8ByteLength(JSON.stringify(message.content)) : 0), 0) > AI_PROVIDER_LIMITS.maxMultimodalBytes) {
    throw new AiProviderError('invalid_request');
  }
  if (maxTokens !== undefined && (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > AI_PROVIDER_LIMITS.maxTokens)) {
    throw new AiProviderError('invalid_request');
  }
  if (reasoningEffort !== undefined && !['low', 'high', 'max'].includes(reasoningEffort)) throw new AiProviderError('invalid_request');
  if (temperature !== undefined && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) throw new AiProviderError('invalid_request');
  const requestFetch = fetchImpl ?? globalThis.fetch;
  if (typeof requestFetch !== 'function') {
    throw new AiProviderError('invalid_request');
  }

  const body = {
    model: config.model,
    messages,
    temperature: temperature ?? 0.7,
    stream: false
  };
  if (maxTokens !== undefined) body.max_tokens = maxTokens;

  const endpoint = new URL(config.url);
  // Reasoning shares the output budget. Apply the documented low default only
  // to verified official models, including callers using the legacy signature.
  const modelId = config.model.toLowerCase();
  const supportsReasoningEffort = (endpoint.hostname === 'open.bigmodel.cn'
    && ['glm-5.3', 'glm-5.3-flash'].includes(modelId))
    || (endpoint.hostname === 'api.deepseek.com'
      && ['deepseek-v4-pro', 'deepseek-v4-flash'].includes(modelId));
  if (supportsReasoningEffort) {
    body.reasoning_effort = reasoningEffort ?? 'low';
  }
  const encodedBody = JSON.stringify(body);
  if (utf8ByteLength(encodedBody) > AI_PROVIDER_LIMITS.maxRequestBytes) throw new AiProviderError('invalid_request');
  const diagnosticRequest = { ...config, apiKey, messages, maxTokens, reasoningEffort: body.reasoning_effort };
  // Tauri's WebView enforces browser CORS for public HTTPS providers. When a
  // native adapter is supplied, use it for both HTTPS and explicitly allowed
  // private HTTP endpoints; browser callers still use fetch as before.
  const useNativeTransport = typeof nativeRequestImpl === 'function';
  if (useNativeTransport) {
    let result;
    try {
      result = await waitForNativeAiProvider(nativeRequestImpl({
        url: config.url,
        apiKey: apiKey.trim(),
        model: config.model,
        messages,
        maxTokens,
        timeoutMs,
        reasoningEffort: body.reasoning_effort ?? reasoningEffort,
        ...(temperature !== undefined ? {temperature} : {}),
        ...(diagnostics === true ? { diagnostics: true } : {}),
        allowPrivateHttp: Boolean(allowPrivateHttp)
      }), signal);
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      throw nativeAiProviderError(error, diagnosticRequest, diagnostics === true);
    }
    const content = typeof result === 'string' ? result : result?.content;
    if (typeof content !== 'string') throw new AiProviderError('invalid_response');
    if (!content.trim()) throw new AiProviderError('empty_response');
    if (utf8ByteLength(content) > AI_PROVIDER_LIMITS.maxResponseBytes) {
      throw new AiProviderError('response_too_large');
    }
    return content;
  }
  if (isPrivateHttpAiProviderUrl(config.url)) {
    throw new AiProviderError('native_transport_unavailable');
  }

  let response;
  try {
    response = await requestFetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`
      },
      body: encodedBody,
      signal
    });
  } catch {
    const code = signal?.aborted ? 'aborted' : 'network_error';
    throw new AiProviderError(code, null, code, diagnostics === true
      ? createAiProviderDiagnostics({ reason: 'network_error' }, diagnosticRequest, { code, status: null, transport: 'fetch' }) : undefined);
  }
  if (!response || typeof response.ok !== 'boolean' || typeof response.text !== 'function') {
    throw new AiProviderError('invalid_response');
  }
  if (!response.ok) {
    const status = Number(response.status);
    const detail = diagnostics === true ? createAiProviderDiagnostics(await readAiErrorDiagnostics(response),
      diagnosticRequest, { code: 'http_error', status, transport: 'fetch' }) : undefined;
    throw new AiProviderError('http_error', status, 'http_error', detail);
  }
  if (contentLengthOf(response) > AI_PROVIDER_LIMITS.maxResponseBytes) {
    throw new AiProviderError('response_too_large');
  }

  let text;
  try {
    text = await readResponseTextLimited(response);
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError('invalid_response');
  }
  if (utf8ByteLength(text) > AI_PROVIDER_LIMITS.maxResponseBytes) {
    throw new AiProviderError('response_too_large');
  }
  let data;
  const responseError = (code, stage) => new AiProviderError(code, null, code, diagnostics === true
    ? createAiProviderDiagnostics({ stage, body: text, ...(stage === 'completion' ? { completion: completionSummary(data) } : {}) }, diagnosticRequest,
      { code, status: Number(response.status) || null, transport: 'fetch' }) : undefined);
  try {
    data = JSON.parse(text);
  } catch {
    throw responseError('invalid_response', 'response_parse');
  }
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'length') throw responseError('response_truncated', 'completion');
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw responseError('empty_response', 'completion');
  return content;
}
