import { toolTopbarMarkup } from '../../shared/tool-page-shell.js';

export function markdownSyntaxHelpMarkup() {
  return `<article class="md-help-document">
    <header class="md-help-hero"><div><span>MARKDOWN REFERENCE</span><h1>Markdown 语法手册</h1><p>基础排版、GFM、流程图和数学公式都在这里。所有示例都可以直接放进编辑器。</p></div><button class="md-help-return" type="button" data-md-help-close><i data-lucide="arrow-left"></i><span>返回编辑</span></button></header>
    <div class="md-help-overview" aria-label="语法手册内容"><div><b>基础排版</b><span>标题、强调、引用与列表</span></div><div><b>扩展语法</b><span>任务、表格、Mermaid 与公式</span></div><div><b>本地导出</b><span>图片资源与离线 HTML</span></div></div>
    <section><div class="md-help-section-title"><span>01</span><h2>标题与段落</h2><p>使用井号定义层级，普通段落之间留一个空行。</p></div><pre><code># 一级标题\n## 二级标题\n### 三级标题\n\n普通段落之间留一个空行。</code></pre></section>
    <section><div class="md-help-section-title"><span>02</span><h2>强调与引用</h2><p>可组合使用粗体、斜体、删除线、行内代码和引用。</p></div><pre><code>**粗体**  *斜体*  ~~删除线~~  \`行内代码\`\n\n&gt; 引用内容</code></pre></section>
    <section><div class="md-help-section-title"><span>03</span><h2>列表与任务</h2><p>任务列表是 GFM 语法，预览中可直接查看完成状态。</p></div><pre><code>- 无序项目\n1. 有序项目\n- [x] 已完成\n- [ ] 待完成</code></pre></section>
    <section><div class="md-help-section-title"><span>04</span><h2>链接与图片</h2><p>通过工具栏插入的本地图片，会在导出时自动整理资源路径。</p></div><pre><code>[ToolKnit](https://toolknit.com)\n![替代文字](assets/image.png)</code></pre></section>
    <section><div class="md-help-section-title"><span>05</span><h2>表格</h2><p>使用竖线分隔单元格；冒号可以指定列的对齐方式。</p></div><pre><code>| 名称 | 状态 |\n| --- | :---: |\n| ToolKnit | 可用 |</code></pre></section>
    <section><div class="md-help-section-title"><span>06</span><h2>代码块</h2><p>在首行标记语言，可以保留代码结构并方便阅读。</p></div><pre><code>\`\`\`js\nconsole.log('ToolKnit')\n\`\`\`</code></pre></section>
    <section><div class="md-help-section-title"><span>07</span><h2>Mermaid 图表</h2><p>使用 mermaid 代码块生成流程图，预览和 HTML 导出都会渲染为图形。</p></div><pre><code>\`\`\`mermaid\nflowchart LR\n  A[输入] --&gt; B[处理]\n  B --&gt; C[输出]\n\`\`\`</code></pre></section>
    <section><div class="md-help-section-title"><span>08</span><h2>数学公式</h2><p>单个美元符号用于行内公式，双美元符号用于独立公式块。</p></div><pre><code>行内：$E = mc^2$\n\n块级：\n$$\nf(x)=\\int_{-\\infty}^{\\infty} e^{-x^2} dx\n$$</code></pre></section>
    <section><div class="md-help-section-title"><span>09</span><h2>导出说明</h2><p>Markdown 导出会创建同级 <code>assets</code> 目录并重写图片相对路径。HTML 导出会嵌入图片、图表和公式，可离线阅读。</p></div></section>
  </article>`;
}

export function markdownEditorTemplate() {
  return `<div class="tool-page-v2-shell tool-page-v2-light md-tool-shell">
    ${toolTopbarMarkup({ tag: 'MARKDOWN EDITOR · TOOL PAGE 3.1', title: 'Markdown 文档编辑器', closeAttr: 'data-md-close' })}
    <main class="tool-page-v2-body md-tool-main">
      <aside class="tool-page-v2-rail md-outline-panel">
        <div class="tool-page-v2-rail-kicker">MARKDOWN STUDIO</div><h1>Markdown<br>文档编辑器</h1><p>实时编辑、预览和导出 Markdown 文档，支持 GFM、Mermaid 与数学公式。</p>
        <div class="tool-page-v2-rail-note"><span>LOCAL ONLY</span><strong>文档和图片只在本机处理，关闭页面后清除编辑器实例。</strong></div>
        <div class="tool-page-v2-steps"><div class="is-active"><b>01</b><span><strong>编辑文档</strong><small>使用右侧工具栏快速插入语法。</small></span></div><div><b>02</b><span><strong>实时预览</strong><small>分屏查看渲染结果和目录。</small></span></div><div><b>03</b><span><strong>导出文件</strong><small>导出 Markdown 或离线 HTML。</small></span></div></div>
        <div class="md-outline-block"><div class="md-panel-label"><span>DOCUMENT MAP</span><strong>文档目录</strong></div><nav class="md-outline" data-md-outline></nav><div class="md-draft-state"><i data-lucide="save"></i><span data-md-draft-state>草稿已保存在本机</span></div></div>
      </aside>
      <section class="md-workbench">
        <div class="md-toolbar" role="toolbar" aria-label="Markdown 编辑工具栏">
          <div class="md-toolbar-scroll"><div class="md-toolbar-content">
            <div class="md-toolbar-group"><button title="撤销" data-md-command="undo"><i data-lucide="undo-2"></i></button><button title="重做" data-md-command="redo"><i data-lucide="redo-2"></i></button><button title="重置模板" data-md-command="reset"><i data-lucide="rotate-ccw"></i></button><button title="清空文档" data-md-command="clear"><i data-lucide="eraser"></i></button></div>
            <div class="md-toolbar-group"><button title="一级标题" data-md-action="h1"><span>H1</span></button><button title="二级标题" data-md-action="h2"><span>H2</span></button><button title="三级标题" data-md-action="h3"><span>H3</span></button><button title="粗体" data-md-action="bold"><b>B</b></button><button title="斜体" data-md-action="italic"><i>I</i></button><button title="删除线" data-md-action="strike"><s>S</s></button><button title="引用" data-md-action="quote"><i data-lucide="quote"></i></button><button title="行内代码" data-md-action="code"><i data-lucide="code"></i></button><button title="代码块" data-md-action="codeblock"><i data-lucide="square-code"></i></button></div>
            <div class="md-toolbar-group"><button title="无序列表" data-md-action="ul"><i data-lucide="list"></i></button><button title="有序列表" data-md-action="ol"><i data-lucide="list-ordered"></i></button><button title="任务列表" data-md-action="task"><i data-lucide="list-checks"></i></button><button title="表格" data-md-action="table"><i data-lucide="table-2"></i></button><button title="链接" data-md-action="link"><i data-lucide="link"></i></button><button title="插入图片" data-md-command="image"><i data-lucide="image-plus"></i></button><button title="分割线" data-md-action="divider"><i data-lucide="minus"></i></button></div>
          </div></div>
          <div class="md-toolbar-actions">
            <div class="md-export-group" role="group" data-i18n-aria-label="home.markdownEditor.exportGroup">
              <button class="md-export-action" type="button" data-md-export="md" data-i18n-title="home.markdownEditor.exportMd"><i data-lucide="file-down"></i><span data-i18n="home.markdownEditor.exportMd">导出 MD</span></button>
              <button class="md-export-action" type="button" data-md-export="html" data-i18n-title="home.markdownEditor.exportHtml"><i data-lucide="file-code-2"></i><span data-i18n="home.markdownEditor.exportHtml">导出 HTML</span></button>
            </div>
            <button class="md-help-action" type="button" data-md-help title="打开语法手册" aria-expanded="false"><i data-lucide="book-open"></i><span>语法手册</span></button>
            <div class="md-view-switch" role="group" aria-label="编辑器视图"><button data-md-view="preview"><span>预览</span></button><button class="is-active" data-md-view="split"><span>分屏</span></button><button data-md-view="editor"><span>编辑</span></button></div>
            <button class="md-workspace-expand" type="button" data-md-expand aria-pressed="false" title="展开编辑区"><i data-lucide="panel-left-close" data-md-expand-icon="expand"></i><i data-lucide="panel-left-open" data-md-expand-icon="collapse" hidden></i></button>
          </div>
        </div>
        <div class="md-editor-view" data-md-workspace><section class="md-preview-pane"><div class="md-pane-head"><span>PREVIEW</span><small data-md-count>0 字</small></div><div class="md-preview markdown-body" data-md-preview></div></section><section class="md-input-pane"><div class="md-pane-head"><span>EDITOR</span><small>Markdown / UTF-8</small></div><div class="md-codemirror" data-md-editor></div></section></div>
        <div class="md-help-page" data-md-help-page role="region" aria-label="Markdown 语法手册" tabindex="-1" hidden>${markdownSyntaxHelpMarkup()}</div>
      </section>
    </main>
  </div>
        <div class="md-export-success-overlay audio-clip-success-overlay" data-md-export-success aria-hidden="true" inert>
          <div class="audio-clip-success-dialog md-export-success-dialog" role="dialog" aria-modal="true" aria-labelledby="mdExportSuccessTitle">
            <div class="audio-clip-success-icon"><i data-lucide="check"></i></div>
            <h3 class="audio-clip-success-title" id="mdExportSuccessTitle" data-i18n="home.markdownEditor.exportComplete">导出完成</h3>
            <div class="audio-clip-success-meta" data-md-success-meta></div>
            <div class="audio-convert-success-detail">
              <div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.markdownEditor.format">导出格式</span><span class="audio-convert-success-value" data-md-success-format></span></div>
              <div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.markdownEditor.file">输出文件</span><span class="audio-convert-success-value" data-md-success-file></span></div>
              <div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.markdownEditor.location">保存位置</span><span class="audio-convert-success-value audio-clip-success-path" data-md-success-path></span></div>
            </div>
            <div class="audio-clip-success-actions"><button class="audio-clip-success-btn audio-clip-success-btn-secondary" type="button" data-md-success-open-folder data-i18n="home.markdownEditor.openFolder">打开文件夹</button><button class="audio-clip-success-btn audio-clip-success-btn-primary" type="button" data-md-success-ok data-i18n="common.ok">确定</button></div>
          </div>
        </div>`;
}
