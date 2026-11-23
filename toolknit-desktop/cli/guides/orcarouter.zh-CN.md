# OrcaRouter 自定义配置与验证边界

核对日期：2026-11-20。OrcaRouter 的官方 Chat Completions 协议可沿用现有自定义配置，无需专用预设。**本轮完成文档核对、公开目录访问与本地模拟服务回归；真实密钥生成尚未验证，TK-013 保持未完成。**

## 配置值

| 字段 | 填写值 |
| --- | --- |
| API 地址 | `https://api.orcarouter.ai/v1/chat/completions` |
| 也可填写 | `https://api.orcarouter.ai/v1`；ToolKnit 补齐 Chat Completions 路径 |
| 模型 | 官方示例 `openai/gpt-4o-mini`；使用账号实际有权限的完整模型 ID |
| API Key | 自己的 OrcaRouter 密钥，通过 `Authorization: Bearer …` 发送 |
| 允许私网 HTTP | 关闭；此服务使用公网 HTTPS |

模型通常带提供商前缀。不要把默认 `deepseek-chat` 或其他服务的密钥原样用于此网关。模型示例不是价格、可用性或质量承诺。官方模型查询接口为 `GET https://api.orcarouter.ai/v1/models`；2026-11-20 本机未带鉴权访问返回 200，目录含 217 项并列出上述示例。公开目录可见不代表个人账号拥有调用权限。

## 桌面端

1. 打开设置中的 AI 密钥配置，平台选择“自定义”。
2. 填入上表 API 地址、完整模型 ID 和自己的 OrcaRouter 密钥，保存。
3. 先使用少量合成文字执行 AI 润色或翻译，检查结果后再用于需要的任务。

桌面沿用本地配置和专用密钥存储。正式 Tauri 请求走 Rust HTTP 层，不依赖浏览器 CORS；纯浏览器预览使用 fetch，CORS / 网络错误不能直接作为桌面兼容性结论。桌面密钥不会自动共享给 CLI / MCP。

只有主动执行 AI 功能时才发送该功能需要的文字或图像。图像输入要求所选模型支持视觉；本次没有验证所有视觉、AI 文档、表格或 PPT 场景。配置仅使用现有非流式 Chat Completions 文本输出，不会自动启用图像 / 视频生成、工具调用、路由头、额外回退参数或合作分成。

## CLI

在启动 CLI 的同一个 PowerShell 进程设置三个环境变量。下面通过隐藏输入读取密钥，示例为合成文字；执行生成会使用自己的服务额度。

```powershell
$env:TOOLKNIT_AI_API_URL = 'https://api.orcarouter.ai/v1/chat/completions'
$env:TOOLKNIT_AI_MODEL = 'openai/gpt-4o-mini'
$orcaKey = Read-Host 'OrcaRouter API Key' -AsSecureString
$env:TOOLKNIT_AI_API_KEY = [System.Net.NetworkCredential]::new('', $orcaKey).Password
toolknit ai polish --text 'Synthetic meeting at 15:00.' --style formal --json
Remove-Item Env:TOOLKNIT_AI_API_KEY
$orcaKey = $null
```

源码目录可把 `toolknit` 替换为 `node .\cli\toolknit.mjs`。同时设置 URL、模型与专用 `TOOLKNIT_AI_API_KEY`，避免缺项时回退到默认 URL、模型或旧的 `DEEPSEEK_API_KEY`。密钥不要放入仓库、参数文件、Agent 对话或日志。清除环境变量只影响此进程，不撤销服务端密钥。

## MCP / IDE Agent

启动命令仍是 `toolknit mcp serve`。Windows 客户端若不支持命令包装器，可沿用现有 MCP 配置，以 `node` 加 CLI 入口绝对路径启动。为 **MCP 服务子进程** 设置：

| 环境变量 | 值 |
| --- | --- |
| `TOOLKNIT_AI_API_URL` | `https://api.orcarouter.ai/v1/chat/completions` |
| `TOOLKNIT_AI_MODEL` | `openai/gpt-4o-mini` 或账号实际可用模型 |
| `TOOLKNIT_AI_API_KEY` | 在客户端的密钥 / 环境设置中提供自己的 OrcaRouter 密钥 |

各客户端的密钥插值语法不同，按客户端支持方式注入，不把占位符当作密钥。修改后重启 MCP 服务或 IDE，先用 `toolknit_ai_polish` 处理合成文字。桌面与 MCP 配置、环境和密钥存储各自独立。

## 错误与限制

| 现象 | 检查方向 |
| --- | --- |
| 401 | 当前服务的密钥是否正确、是否失效 |
| 402 / 403 | 额度、账号策略、模型权限；同一状态可能有多种原因，在服务控制台确认 |
| 404 / 425 / 503 | 地址、完整模型 ID、模型上线状态及当前可用性 |
| 429 | 暂停请求并查看服务控制台与限流说明；部分响应只有状态码和响应头 |
| 超时 / 取消 | 中断连接不等于上游未处理 / 未计费，重试前核对用量 |
| 输出为空 / 截断 / 格式错误 | 换用适合任务的模型或减少输入；此类输出不会作为成功成品接受 |

ToolKnit 发送 `stream: false`、`model`、`messages`、`temperature`，按任务传 `max_tokens`；不向此网关注入官方 DeepSeek / GLM 专属推理选项。共享上限：12 条消息、单条文字 50000 字符、请求 8 MiB、响应 2 MiB、输出预算 16384 tokens、单次最长 180 秒；各功能可能更严格。要求正文文字回复，不将纯推理内容当成品。现有部分生成流程有有界重试，此次不新增网关自动回退或全部错误元数据解析。

## 证据与复跑

- `node scripts/probe-orcarouter-public.mjs`：显式联网，仅 GET 六份官方文档与公开模型目录，记录状态、大小、文档 SHA-256 和示例模型；不读取密钥、不发生成请求。
- `node scripts/test-orcarouter-compat.mjs`：24 项本地协议检查，覆盖地址、模型、Bearer、请求参数、实际桌面请求适配器与模拟原生边界、真实 CLI / MCP 子进程、401 / 402 / 空体 429、共享超时、取消、敏感信息不进入错误、坏 JSON / 截断拒绝及 MCP 取消后继续调用。
- `node scripts/test-orcarouter-settings-browser.mjs`：真实 Edge 中实际设置模板 / 运行时与内存密钥存储，9 项保存、恢复、密钥不入配置存储和无效配置检查。需要 Playwright / Edge；`TOOLKNIT_TEST_MODULES` 可指向现有模块目录。
- `node scripts/test-ai-provider-core.mjs` 与 `cargo test --manifest-path src-tauri/Cargo.toml ai_provider --lib`：共享 JS / Rust 请求层回归，包括原生本地 HTTP、取消和超时，不连接真实网关。

报告位于包目录 `tmp/orcarouter/`。模拟边界不替代正式 Tauri / WebView2 与真实网关端到端验收。真实认证生成、账号额度、真实限流、上游取消 / 计费及各工具输出质量仍待专用测试凭据。

## 官方资料

[Quickstart](https://docs.orcarouter.ai/getting-started/quickstart) · [密钥](https://docs.orcarouter.ai/getting-started/get-api-key) · [模型](https://docs.orcarouter.ai/getting-started/models) · [HTTP 格式](https://docs.orcarouter.ai/native-formats/openai-compat) · [Chat API](https://docs.orcarouter.ai/api-reference/chat/create-a-chat-completion) · [错误](https://docs.orcarouter.ai/operations/errors)

[English guide](orcarouter.en.md)
