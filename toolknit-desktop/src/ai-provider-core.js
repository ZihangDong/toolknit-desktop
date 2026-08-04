export const AI_PROVIDER_LIMITS = Object.freeze({
  maxResponseBytes: 2 * 1024 * 1024,
  maxMessages: 12,
  maxMessageChars: 50000,
  maxTokens: 16384
});

export class AiProviderError extends Error {
  constructor(code, status = null) {
    super(code);
    this.name = 'AiProviderError';
    this.code = code;
    this.status = Number.isInteger(status) ? status : null;
  }
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

function isValidMessage(message) {
  return message
    && typeof message === 'object'
    && (message.role === 'system' || message.role === 'user' || message.role === 'assistant')
    && typeof message.content === 'string'
    && message.content.length <= AI_PROVIDER_LIMITS.maxMessageChars;
}

function contentLengthOf(response) {
  const raw = response?.headers?.get?.('content-length');
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function normalizeAiProviderConfig({ url, model }) {
  if (typeof url !== 'string' || !url.trim() || typeof model !== 'string' || !model.trim()) {
    throw new AiProviderError('invalid_config');
  }

  let endpoint;
  try {
    endpoint = new URL(url.trim());
  } catch {
    throw new AiProviderError('invalid_config');
  }
  const isSecureEndpoint = endpoint.protocol === 'https:';
  const isLoopbackHttp = endpoint.protocol === 'http:' && isLoopbackHost(endpoint.hostname);
  if ((!isSecureEndpoint && !isLoopbackHttp) || endpoint.username || endpoint.password) {
    throw new AiProviderError('invalid_config');
  }
  return { url: endpoint.href, model: model.trim() };
}

/**
 * Calls an OpenAI-compatible chat-completions endpoint without retaining or
 * reporting provider response bodies. A caller supplies fetch for testability.
 */
export async function requestAiCompletion({
  url,
  apiKey,
  model,
  messages,
  maxTokens,
  signal,
  fetchImpl
}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new AiProviderError('invalid_config');
  }
  const config = normalizeAiProviderConfig({ url, model });
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > AI_PROVIDER_LIMITS.maxMessages
    || !messages.every(isValidMessage)) {
    throw new AiProviderError('invalid_request');
  }
  if (maxTokens !== undefined && (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > AI_PROVIDER_LIMITS.maxTokens)) {
    throw new AiProviderError('invalid_request');
  }
  const requestFetch = fetchImpl ?? globalThis.fetch;
  if (typeof requestFetch !== 'function') {
    throw new AiProviderError('invalid_request');
  }

  const body = {
    model: config.model,
    messages,
    temperature: 0.7,
    stream: false
  };
  if (maxTokens !== undefined) body.max_tokens = maxTokens;

  let response;
  try {
    response = await requestFetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify(body),
      signal
    });
  } catch {
    throw new AiProviderError(signal?.aborted ? 'aborted' : 'network_error');
  }
  if (!response || typeof response.ok !== 'boolean' || typeof response.text !== 'function') {
    throw new AiProviderError('invalid_response');
  }
  if (!response.ok) {
    // Do not consume an error body: providers and proxies may echo prompts or keys.
    throw new AiProviderError('http_error', Number(response.status));
  }
  if (contentLengthOf(response) > AI_PROVIDER_LIMITS.maxResponseBytes) {
    throw new AiProviderError('response_too_large');
  }

  let text;
  try {
    text = await response.text();
  } catch {
    throw new AiProviderError('invalid_response');
  }
  if (utf8ByteLength(text) > AI_PROVIDER_LIMITS.maxResponseBytes) {
    throw new AiProviderError('response_too_large');
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AiProviderError('invalid_response');
  }
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}
