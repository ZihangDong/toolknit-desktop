import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import katex from 'katex';

export const MARKDOWN_DRAFT_KEY = 'toolknit.markdown.draft.v1';

export const DEFAULT_MARKDOWN = `# ToolKnit Markdown 文档

> 一份留在本机、可以随时继续编辑的文档。

## 从这里开始

编辑区输入 Markdown，预览区会实时呈现排版结果。你可以使用顶部工具栏插入常用语法，也可以打开 **语法帮助** 查看完整示例。

### 常用内容

- [x] 支持 GitHub Flavored Markdown
- [x] 支持 Mermaid 图表
- [x] 支持数学公式
- [ ] 写下你的下一项计划

| 能力 | 状态 | 说明 |
| --- | :---: | --- |
| 实时预览 | 可用 | 输入后自动更新 |
| 本地草稿 | 可用 | 不会上传文档内容 |
| 离线导出 | 可用 | Markdown 或精美 HTML |

## Mermaid 示例

\`\`\`mermaid
flowchart LR
  A[写作] --> B[预览]
  B --> C[导出]
\`\`\`

## 数学公式

行内公式：$E = mc^2$

块级公式：

$$
f(x) = \\int_{-\\infty}^{\\infty} \\hat f(\\xi)e^{2\\pi i\\xi x} d\\xi
$$

---

继续写下你的内容。`;

function installMathRules(md, output = 'htmlAndMathml') {
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false;
    const end = state.src.indexOf('$', state.pos + 1);
    if (end < 0) return false;
    if (!silent) { const token = state.push('math_inline', 'math', 0); token.content = state.src.slice(state.pos + 1, end); }
    state.pos = end + 1;
    return true;
  });
  md.block.ruler.after('blockquote', 'math_block', (state, start, end, silent) => {
    const first = state.bMarks[start] + state.tShift[start];
    if (!state.src.startsWith('$$', first)) return false;
    let next = start;
    let content = state.src.slice(first + 2, state.eMarks[start]);
    if (content.trim().endsWith('$$')) content = content.trim().slice(0, -2);
    else {
      for (next = start + 1; next < end; next += 1) {
        const line = state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]);
        if (line.trim().endsWith('$$')) { content += `\n${line.replace(/\$\$\s*$/, '')}`; break; }
        content += `\n${line}`;
      }
      if (next >= end) return false;
    }
    if (!silent) { const token = state.push('math_block', 'math', 0); token.block = true; token.content = content; token.map = [start, next + 1]; }
    state.line = next + 1;
    return true;
  });
  md.renderer.rules.math_inline = (tokens, index) => katex.renderToString(tokens[index].content, { throwOnError: false, output });
  md.renderer.rules.math_block = (tokens, index) => `<div class="md-math-block">${katex.renderToString(tokens[index].content, { displayMode: true, throwOnError: false, output })}</div>`;
}

export function createMarkdownRenderer(output = 'htmlAndMathml') {
  // Preserve document punctuation and engineering symbols exactly as typed.
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false });
  md.use(taskLists, { enabled: true, label: true, labelAfter: true });
  // Permit bare line breaks for multiline GFM cells without enabling HTML.
  md.inline.ruler.before('html_inline', 'table_line_break', (state, silent) => {
    const match = /^<br\s*\/?\s*>/i.exec(state.src.slice(state.pos));
    if (!match) return false;
    if (!silent) state.push('hardbreak', 'br', 0);
    state.pos += match[0].length;
    return true;
  });
  md.renderer.rules.table_open = () => '<div class="md-table-scroll" tabindex="0"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';
  installMathRules(md, output);
  return md;
}

/** Removes metadata comments from rendered output while keeping them in the source. */
export function stripMarkdownMetadata(markdown = '') {
  const source = String(markdown ?? '');
  const protectedLines = new Set();
  for (const token of headingParser.parse(source, {})) {
    if (!['fence', 'code_block'].includes(token.type) || !token.map) continue;
    for (let line = token.map[0]; line < token.map[1]; line++) protectedLines.add(line);
  }
  // Keep line numbers stable for the outline; only hide our own standalone metadata.
  return source.split('\n').map((line, index) => !protectedLines.has(index)
    && /^ {0,3}<!--\s*(?:source-page:\s*\d+|generated-by: ToolKnit local PDF text extraction)\s*-->\s*$/.test(line)
    ? '' : line).join('\n');
}

const headingParser = new MarkdownIt({ html: false });

function inlineHeadingText(token) {
  const children = token?.children || [];
  return children.map(child => {
    if (['text', 'code_inline'].includes(child.type)) return child.content;
    if (child.type === 'image') return child.content || child.attrGet('alt') || '';
    if (['softbreak', 'hardbreak'].includes(child.type)) return ' ';
    return '';
  }).join('').replace(/\s+/g, ' ').trim();
}

export function extractMarkdownHeadingsFromTokens(tokens = []) {
  const headings = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'heading_open') continue;
    const text = inlineHeadingText(tokens[index + 1]);
    if (!text) continue;
    headings.push({ level: Number(token.tag.slice(1)), text, line: (token.map?.[0] ?? 0) + 1, id: `md-heading-${headings.length + 1}` });
  }
  return headings;
}

export function extractMarkdownHeadings(markdown = '') {
  return extractMarkdownHeadingsFromTokens(headingParser.parse(String(markdown), {}));
}

const TOOL_ACTIONS = {
  bold: ['**', '**', '加粗文字'],
  italic: ['*', '*', '斜体文字'],
  strike: ['~~', '~~', '删除线文字'],
  code: ['`', '`', '代码'],
  link: ['[', '](https://example.com)', '链接文字'],
  quote: ['> ', '', '引用内容'],
  h1: ['# ', '', '一级标题'],
  h2: ['## ', '', '二级标题'],
  h3: ['### ', '', '三级标题'],
  ul: ['- ', '', '列表项目'],
  ol: ['1. ', '', '列表项目'],
  task: ['- [ ] ', '', '待办事项'],
  divider: ['\n---\n', '', ''],
  table: ['\n| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |\n', '', ''],
  codeblock: ['\n```text\n', '\n```\n', '代码内容']
};

export function applyMarkdownAction(text, start, end, action) {
  const source = String(text ?? '');
  const safeStart = Math.max(0, Math.min(Number(start) || 0, source.length));
  const safeEnd = Math.max(safeStart, Math.min(Number(end) || safeStart, source.length));
  const selected = source.slice(safeStart, safeEnd);
  const spec = TOOL_ACTIONS[action];
  if (!spec) return { text: source, start: safeStart, end: safeEnd };
  const [prefix, suffix, fallback] = spec;
  const body = selected || fallback;
  const inserted = `${prefix}${body}${suffix}`;
  const next = `${source.slice(0, safeStart)}${inserted}${source.slice(safeEnd)}`;
  const selectionStart = safeStart + prefix.length;
  return { text: next, start: selectionStart, end: selectionStart + body.length };
}

export function rewriteMarkdownImages(markdown, assets = []) {
  let result = String(markdown ?? '');
  assets.forEach(asset => {
    if (!asset?.source || !asset?.fileName) return;
    result = result.split(asset.source).join(`assets/${asset.fileName}`);
  });
  return result;
}

export function sanitizeExportBaseName(value, fallback = 'toolknit-document') {
  const name = String(value || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 80);
  return name || fallback;
}

export function buildStandaloneMarkdownHtml({ title, renderedHtml, katexCss = '' }) {
  const safeTitle = String(title || 'ToolKnit Markdown').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><meta name="referrer" content="no-referrer">
<title>${safeTitle}</title><style>
:root{color-scheme:light;--ink:#17201d;--muted:#5e6b66;--line:#dce3df;--accent:#136f63}
*{box-sizing:border-box}body{margin:0;background:#eef2ef;color:var(--ink);font:16px/1.8 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
main{width:min(900px,calc(100% - 40px));margin:40px auto;padding:56px 64px;background:#fff;border:1px solid var(--line);box-shadow:0 18px 50px rgba(18,38,32,.08)}
h1,h2,h3,h4,h5,h6{line-height:1.35;margin:1.8em 0 .65em;scroll-margin-top:24px}h1{font-size:2.35rem;border-bottom:2px solid var(--ink);padding-bottom:.35em}h2{font-size:1.7rem;border-bottom:1px solid var(--line);padding-bottom:.25em}
a{color:var(--accent)}blockquote{margin:1.4em 0;padding:.25em 1.2em;border-left:4px solid var(--accent);color:var(--muted);background:#f5f8f6}code{padding:.15em .35em;background:#eef3f0;border-radius:4px}pre{overflow:auto;padding:20px;background:#17201d;color:#f2f6f4;border-radius:6px}pre code{padding:0;background:none;color:inherit}
main{overflow-wrap:anywhere}p,li{line-height:1.8}.md-table-scroll{max-width:100%;overflow:auto;margin:1.5em 0}table{min-width:100%;border-collapse:collapse;font-size:14px;line-height:1.65}th,td{min-width:90px;max-width:420px;padding:12px 16px;border:1px solid var(--line);text-align:left;vertical-align:top;overflow-wrap:break-word}th{background:#f1f3f5;font-weight:650}tbody tr:nth-child(even){background:#fafbfc}img,svg{max-width:100%;height:auto}hr{border:0;border-top:1px solid var(--line);margin:2.2em 0}.mermaid{text-align:center}
${katexCss}
@media(max-width:680px){main{width:100%;margin:0;padding:30px 22px;border:0}h1{font-size:1.9rem}}
@media print{body{background:#fff}main{width:auto;margin:0;padding:0;border:0;box-shadow:none}}
</style></head><body><main>${renderedHtml}</main></body></html>`;
}
