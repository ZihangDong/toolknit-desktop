# OrcaRouter custom configuration

Checked November 20, 2026. The documented Chat Completions interface fits ToolKnit's existing custom configuration without a dedicated preset. **Documentation, a public catalog request and local protocol fixtures have been checked; authenticated generation remains unverified and TK-013 stays open.**

| Setting | Value |
| --- | --- |
| API URL | `https://api.orcarouter.ai/v1/chat/completions` |
| Also accepted | `https://api.orcarouter.ai/v1` (ToolKnit appends the completion path) |
| Model | Official example: `openai/gpt-4o-mini`; use a full ID available to your account |
| API key | Your own OrcaRouter key, sent as `Authorization: Bearer …` |
| Allow private HTTP | Off; this endpoint uses public HTTPS |

Model IDs normally include a provider prefix. Do not reuse a default `deepseek-chat` model name or another service's key. The example is not a price, availability or quality guarantee. On November 20, 2026, an unauthenticated `GET https://api.orcarouter.ai/v1/models` returned 200 with 217 entries including that example. Catalog visibility does not establish account permission.

## Desktop

Open AI key settings, select **Custom**, enter the URL, full model ID and your own key, then save. Start with synthetic text in polishing or translation. Desktop uses its existing local configuration and dedicated key store. Tauri uses Rust HTTP for HTTPS; browser previews use fetch and can encounter CORS restrictions. Desktop keys are not automatically shared with CLI/MCP.

An explicit AI action sends the content required by that feature. Vision requires a model supporting image input. This check does not establish every vision, document, spreadsheet or PPT workflow. Custom configuration uses existing nonstreaming Chat Completions with text output; it does not enable image/video generation, tool calls, routing headers, extra fallback parameters or a partner program.

## CLI and MCP

Set URL, model and dedicated key together in the CLI or MCP **server process**. Missing values can fall back to the existing default URL/model or `DEEPSEEK_API_KEY`. In PowerShell, use hidden input:

```powershell
$env:TOOLKNIT_AI_API_URL = 'https://api.orcarouter.ai/v1/chat/completions'
$env:TOOLKNIT_AI_MODEL = 'openai/gpt-4o-mini'
$orcaKey = Read-Host 'OrcaRouter API Key' -AsSecureString
$env:TOOLKNIT_AI_API_KEY = [System.Net.NetworkCredential]::new('', $orcaKey).Password
toolknit ai polish --text 'Synthetic meeting at 15:00.' --style formal --json
Remove-Item Env:TOOLKNIT_AI_API_KEY
$orcaKey = $null
```

Generation uses your allowance. In a source checkout replace `toolknit` with `node .\cli\toolknit.mjs`. Clearing an environment variable does not revoke the key. Keep keys out of source, argument files, Agent conversations and logs.

MCP still starts with `toolknit mcp serve`. Windows clients that cannot invoke the command wrapper can use `node` plus the absolute CLI entry path, as in the existing setup. Inject `TOOLKNIT_AI_API_URL`, `TOOLKNIT_AI_MODEL` and your `TOOLKNIT_AI_API_KEY` through the client's supported environment/secret mechanism. Secret substitution syntax depends on the client. Restart the server or IDE and start with `toolknit_ai_polish` on synthetic text. Desktop and MCP configuration are independent.

## Errors and limits

| Result | Check |
| --- | --- |
| 401 | Correct, valid key for this service |
| 402 / 403 | Credit, account policy or model permission; inspect the service console |
| 404 / 425 / 503 | Endpoint, full model ID, launch state and current availability |
| 429 | Pause requests and follow the service's rate-limit guidance; some responses have no JSON body |
| Timeout / cancellation | An interrupted connection does not establish that upstream processing or billing stopped; inspect usage before retrying |
| Empty, truncated or malformed output | Choose a suitable model or reduce input; these outputs are rejected |

Requests use `stream: false`, `model`, `messages`, `temperature` and a task-specific `max_tokens` budget. Official DeepSeek/GLM reasoning flags are not automatically added for this gateway. Shared limits: 12 messages, 50,000 text characters per message, 8 MiB request, 2 MiB response, 16,384 output tokens and 180 seconds per request; tools can be stricter. A text answer is required; reasoning-only output is not accepted as final content. Some existing workflows retry within bounds; this change adds no gateway fallback policy or complete parsing of its error metadata.

## Verification

Run from the app package directory:

- `node scripts/probe-orcarouter-public.mjs`: explicit credential-free GET requests for six official documents and the public catalog; records hashes and metadata, never a completion.
- `node scripts/test-orcarouter-compat.mjs`: 24 local checks for URL/model/Bearer/token envelope, actual desktop request adapter with a simulated native boundary, CLI/MCP subprocesses, 401/402/empty-body 429, shared deadlines, cancellation, sanitized errors, malformed/truncated output and MCP recovery.
- `node scripts/test-orcarouter-settings-browser.mjs`: nine actual Edge checks using the settings template/runtime and an in-memory key store. Requires Playwright/Edge; `TOOLKNIT_TEST_MODULES` can point to an existing module directory.
- `node scripts/test-ai-provider-core.mjs` and `cargo test --manifest-path src-tauri/Cargo.toml ai_provider --lib`: shared JS/Rust transport regressions, including local native HTTP, cancellation and timeout; no real gateway calls.

Reports are under `tmp/orcarouter/`. Local fixtures do not replace real Tauri/WebView2 and gateway acceptance. Authenticated completions, account quotas, actual rate limits, upstream cancellation/billing and per-tool quality remain pending dedicated test credentials.

Official references: [Quickstart](https://docs.orcarouter.ai/getting-started/quickstart), [keys](https://docs.orcarouter.ai/getting-started/get-api-key), [models](https://docs.orcarouter.ai/getting-started/models), [HTTP format](https://docs.orcarouter.ai/native-formats/openai-compat), [Chat API](https://docs.orcarouter.ai/api-reference/chat/create-a-chat-completion), [errors](https://docs.orcarouter.ai/operations/errors).

[中文说明](orcarouter.zh-CN.md)
