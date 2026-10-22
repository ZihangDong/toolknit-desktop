import { loadCore } from './core-loader.mjs';
import { ToolKnitError, throwIfAborted, cancellationError } from './errors.mjs';

export async function aiConfiguration(env = process.env) {
  const core = await loadCore('ai-provider-core.js');
  const apiKey = [env.TOOLKNIT_AI_API_KEY, env.DEEPSEEK_API_KEY].find(value => !core.isPlaceholderAiApiKey(value));
  if (!apiKey) throw new ToolKnitError('ENGINE_UNAVAILABLE', 'Set a real TOOLKNIT_AI_API_KEY or DEEPSEEK_API_KEY in the CLI/MCP process environment.');
  try {
    return { ...core.normalizeAiProviderConfig({ url: env.TOOLKNIT_AI_API_URL || 'https://api.deepseek.com/v1/chat/completions', model: env.TOOLKNIT_AI_MODEL || 'deepseek-chat' }), apiKey };
  } catch { throw new ToolKnitError('INVALID_ARGUMENT', 'The AI provider URL/model configuration is invalid. Use HTTPS or a loopback HTTP endpoint.'); }
}
export function aiFailure(error, signal) {
  if (signal?.aborted || error?.code === 'aborted') return cancellationError(signal);
  if (error instanceof ToolKnitError) return error;
  return new ToolKnitError(error?.code === 'timeout' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
    error?.code === 'timeout' ? 'The AI provider timed out.' : 'The AI request failed or returned invalid content.',
    { details: { reason: /^[a-z_-]{1,40}$/.test(error?.code || '') ? error.code : 'invalid-response', ...(Number.isInteger(error?.status) ? { status: error.status } : {}) } });
}
export async function requestConfiguredAi(messages, options = {}) {
  throwIfAborted(options.signal);
  const core = await loadCore('ai-provider-core.js'), configuration = options.configuration || await aiConfiguration(options.env);
  return core.requestAiCompletion({ ...configuration, messages, maxTokens: options.maxTokens ?? 8192, temperature: .1,
    timeoutMs: options.timeoutMs ?? 120000, signal: options.signal, fetchImpl: options.fetchImpl });
}
