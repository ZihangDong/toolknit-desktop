import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { TOOL_DEFINITIONS } from '../cli/lib/tool-definitions.mjs';
import { EXTENDED_OPERATIONS } from '../cli/lib/extended-tools.mjs';
import { DESKTOP_COVERAGE } from '../cli/lib/desktop-coverage.mjs';
import { LAZY_TOOL_SPECS } from '../src/features/lazy-tools.js';

const names = new Set(TOOL_DEFINITIONS.map(tool => tool.name));
assert.equal(names.size, TOOL_DEFINITIONS.length, 'MCP tool names must be unique.');
assert.deepEqual(DESKTOP_COVERAGE.map(item => item.desktop).sort(), Object.keys(LAZY_TOOL_SPECS).sort(), 'Every desktop tool needs exactly one coverage entry.');
for (const item of DESKTOP_COVERAGE) {
  assert.ok(['supported', 'partial', 'desktop-only'].includes(item.scope));
  assert.equal(item.tools.length === 0, item.scope === 'desktop-only');
  assert.ok(item.scope === 'supported' || item.note.length > 0, 'Limited coverage must explain its scope.');
  for (const name of item.tools) assert.ok(names.has(name), `Unknown tool in desktop coverage: ${name}`);
}

const pkg = JSON.parse(await readFile(new URL('../cli/package.json', import.meta.url), 'utf8'));
const aliases = { toolknit_color_extract: 'image colors', toolknit_ai_document: 'ai-doc create', toolknit_ai_table: 'ai-table create', toolknit_transcribe: 'transcribe' };
function command(name) {
  const extended = EXTENDED_OPERATIONS.find(operation => operation.definition.name === name);
  if (extended) return extended.command.join(' ');
  if (aliases[name]) return aliases[name];
  if (name.startsWith('toolknit_ai_document_')) return 'ai-doc ' + name.slice('toolknit_ai_document_'.length);
  if (name.startsWith('toolknit_ai_table_')) return 'ai-table ' + name.slice('toolknit_ai_table_'.length);
  const [group, ...rest] = name.slice('toolknit_'.length).split('_'); return group + ' ' + rest.join('-');
}
const clean = text => text.replaceAll('|', '\\|').replaceAll('\n', ' ');
const counts = Object.fromEntries(['supported', 'partial', 'desktop-only'].map(scope => [scope, DESKTOP_COVERAGE.filter(item => item.scope === scope).length]));
const lines = [
  '# V3.2 CLI / MCP 能力清单', '',
  `版本 ${pkg.version}，${TOOL_DEFINITIONS.length} 项 MCP 能力；CLI 可通过对应命令或通用 run 入口调用同一能力。本文由 scripts/sync-cli-catalog.mjs 从注册表生成。V3.2 尚未发布 npm。`, '',
  '需要 Node.js >=22.13.0。本地工具不要求 AI Key；标有 AI 的操作仅在主动调用或明确开启 AI 模式时请求外部服务。', '',
  '## 能力目录', '',
  '| CLI（前缀 toolknit） | MCP 名称 | 参数与边界 |', '| --- | --- | --- |',
  ...TOOL_DEFINITIONS.map(tool => `| \`${command(tool.name)}\` | \`${tool.name}\` | ${clean(tool.description)} |`), '',
  '运行 `toolknit tools describe <MCP名称> --json` 查看精确参数；结构化参数推荐 `toolknit run <MCP名称> --arguments-file request.json --json`，密码仅从 `--arguments-stdin` 传入。不要把 AI Key 写入参数、文件路径或 Agent 对话。', '',
  '## 桌面覆盖', '',
  `${DESKTOP_COVERAGE.length} 个桌面工具：${counts.supported} 项支持、${counts.partial} 项按明确范围部分支持、${counts['desktop-only']} 项保留桌面。MCP 另有 PDF 检查、模型管理和工程编辑等辅助接口，因此数量与桌面卡片数不同。`, '',
  '| 桌面工具 ID | 覆盖 | MCP 接口 / 说明 |', '| --- | --- | --- |',
  ...DESKTOP_COVERAGE.map(item => `| \`${item.desktop}\` | ${{ supported: '支持', partial: '部分支持', 'desktop-only': '保留桌面' }[item.scope]} | ${item.tools.map(name => `\`${name}\``).join(', ')}${item.note ? ' ' + clean(item.note) : ''} |`), '',
  '## 运行边界', '',
  '- Windows 硬件能力取决于系统查询权限；其他平台不宣称具有完整硬件数据。',
  '- 音视频需要 FFmpeg；PPT/Excel 渲染需要 LibreOffice；离线转写需要已安装的 Whisper 模型。缺少依赖返回结构化错误，不自动下载大模型。',
  '- PDF 转 Word 默认离线，AI 模式只辅助结构；复杂图形/公式可保留图像，扫描件 OCR 不在其转换范围。引擎遵循独立授权，联系 info@toolknit.com。',
  '- 只读文件扫描不删除内容。剪贴板监控、密码生成、系统清理和交互型悬浮窗口没有 headless 入口。',
  '- 直接调用 AI 文本/PDF 图像识别或开启 PDF-to-Word ai_mode 会发送相关文字/区域图像；桌面 Key 不与 CLI/MCP 共享。',
  '- 文件输出显式指定，默认拒绝覆盖。工具若返回 partial/no-reduction 等状态，应检查 outputs、warnings 和逐项结果。', ''
];
const outputs = new Map([
  [new URL('../docs/CLI_CAPABILITIES.md', import.meta.url), lines.join('\n')],
  [new URL('../docs/CLI_CAPABILITIES.json', import.meta.url), JSON.stringify({ version: pkg.version, node: pkg.engines.node, tools: TOOL_DEFINITIONS, desktopCoverage: DESKTOP_COVERAGE }, null, 2) + '\n']
]);
for (const [file, content] of outputs) {
  if (process.argv.includes('--check')) {
    if ((await readFile(file, 'utf8')).replaceAll('\r\n', '\n') !== content) throw new Error(`CLI catalog is stale: ${file.pathname}`);
  } else await writeFile(file, content);
}
console.log(`CLI catalog ${process.argv.includes('--check') ? 'verified' : 'generated'}: ${TOOL_DEFINITIONS.length} tools, ${DESKTOP_COVERAGE.length} desktop entries.`);
