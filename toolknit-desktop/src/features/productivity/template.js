import { toolTopbarMarkup } from '../../shared/tool-page-shell.js';
export default `<div id="productivityOverlay" class="productivity-overlay" aria-hidden="true" inert data-tool-page-chrome>
${toolTopbarMarkup({ tag: 'ToolKnit · <span data-i18n="productivity.workspace">文件工作台</span>', title: '', closeAttr: 'data-tool-close' })}
<main class="productivity-sheet">
  <nav class="productivity-tabs" aria-label="文件工作台" data-i18n-aria-label="productivity.workspace">
    <button type="button" data-productivity-tab="batch-rename" data-i18n="productivity.rename">批量重命名</button>
    <button type="button" data-productivity-tab="task-center" data-i18n="productivity.tasks">任务中心</button>
    <button type="button" data-productivity-tab="tool-workflows" data-i18n="productivity.workflows">工具串联</button>
  </nav>
  <section data-productivity-panel="batch-rename">
    <div class="productivity-heading"><div><h1 data-i18n="productivity.rename">批量重命名</h1><p data-i18n="productivity.renameHint">先预览新名称，再统一修改。扩展名自动保留，可撤销最近一次操作。</p></div><button type="button" class="productivity-primary" data-action="pick-rename" data-i18n="productivity.addFiles">添加文件</button></div>
    <div class="productivity-layout">
      <form class="productivity-controls" data-rename-form>
        <h2 data-i18n="productivity.namingRules">命名规则</h2>
        <label><span data-i18n="productivity.pattern">命名模板</span><input name="pattern" value="{name}_{n}" maxlength="200" autocomplete="off" spellcheck="false"></label>
        <p class="productivity-muted" data-i18n="productivity.tokens">{name} 原名称 · {n} 序号 · {date} 日期</p>
        <div class="productivity-fields"><label><span data-i18n="productivity.start">起始序号</span><input name="start" type="number" min="0" max="999999999" value="1"></label><label><span data-i18n="productivity.digits">序号位数</span><input name="digits" type="number" min="1" max="10" value="3"></label></div>
        <label><span data-i18n="productivity.find">查找名称中的文字</span><input name="find" maxlength="120" autocomplete="off"></label>
        <label><span data-i18n="productivity.replace">替换为</span><input name="replace" maxlength="120" autocomplete="off"></label>
        <label class="productivity-check"><input name="regex" type="checkbox"><span data-i18n="productivity.regex">使用正则表达式</span></label>
        <button class="productivity-primary" type="button" data-action="rename" disabled data-i18n="productivity.applyRename">应用重命名</button>
        <button type="button" data-action="undo" disabled data-i18n="productivity.undo">撤销上次重命名</button>
      </form>
      <div class="productivity-preview"><div class="productivity-toolbar"><h2 data-i18n="productivity.preview">名称预览</h2><div><button type="button" data-action="sort-rename" data-i18n="productivity.sort">按名称排序</button><button type="button" data-action="clear-rename" data-i18n="productivity.clear">清空</button></div></div>
        <p class="productivity-inline" data-rename-summary role="status" aria-live="polite"></p>
        <div class="productivity-table-scroll"><table><thead><tr><th data-i18n="productivity.original">原名称</th><th data-i18n="productivity.newName">新名称</th><th><span class="sr-only" data-i18n="productivity.actions">操作</span></th></tr></thead><tbody data-rename-rows></tbody></table></div>
        <div class="productivity-empty" data-rename-empty><i data-lucide="file-pen-line"></i><h3 data-i18n="productivity.renameEmpty">为一组文件整理名字</h3><p data-i18n="productivity.renameEmptyHint">添加文件后实时显示修改结果；同名冲突会在执行前检查。</p></div>
      </div>
    </div>
  </section>
  <section data-productivity-panel="task-center" hidden>
    <div class="productivity-heading"><div><h1 data-i18n="productivity.tasks">任务中心</h1><p data-i18n="productivity.tasksHint">查看串联流程及已接入转换的状态。历史保存在本机；重试适用于当前会话。</p></div><button type="button" data-action="clear-tasks" data-i18n="productivity.clearFinished">清除已结束记录</button></div>
    <div class="productivity-toolbar"><label class="productivity-search"><span class="sr-only" data-i18n="productivity.searchTasks">搜索任务</span><input data-task-search data-i18n-placeholder="productivity.searchTasks" placeholder="搜索任务"></label><label><span class="sr-only" data-i18n="productivity.filter">筛选状态</span><select data-task-filter><option value="all" data-i18n="productivity.all">全部状态</option><option value="active" data-i18n="productivity.active">处理中</option><option value="succeeded" data-i18n="productivity.succeeded">已完成</option><option value="failed" data-i18n="productivity.failed">失败</option><option value="cancelled" data-i18n="productivity.cancelled">已取消</option><option value="interrupted" data-i18n="productivity.interrupted">已中断</option></select></label></div>
    <p class="productivity-inline" data-task-summary role="status" aria-live="polite"></p><div data-task-rows></div>
  </section>
  <section data-productivity-panel="tool-workflows" hidden>
    <div class="productivity-heading"><div><h1 data-i18n="productivity.workflows">工具串联</h1><p data-i18n="productivity.flowHint">选一条流程，按文件顺序完成处理，最后输出一份 PDF。</p></div><button type="button" data-action="pick-flow" class="productivity-primary" data-i18n="productivity.addFiles">添加文件</button></div>
    <div class="productivity-layout">
      <form class="productivity-controls" data-workflow-form>
        <h2 data-i18n="productivity.flowSettings">流程设置</h2>
        <label><span data-i18n="productivity.preset">选择预设</span><select name="preset"></select></label>
        <label><span data-i18n="productivity.input">输入类型</span><select name="input"><option value="images" data-i18n="productivity.images">图片</option><option value="pdf">PDF</option></select></label>
        <label><span data-i18n="productivity.quality">图片质量</span><select name="quality"><option value="clear" data-i18n="productivity.qualityClear">清晰</option><option value="balanced" data-i18n="productivity.qualityBalanced">均衡</option><option value="small" data-i18n="productivity.qualitySmall">较小文件</option></select></label>
        <label class="productivity-check"><input name="number" type="checkbox" checked><span data-i18n="productivity.addNumbers">添加连续页码</span></label>
        <label><span data-i18n="productivity.startPage">页码从此开始</span><input name="start" type="number" min="1" max="999999" value="1"></label>
        <label><span data-i18n="productivity.presetName">自定义预设名称</span><input name="presetName" maxlength="60" autocomplete="off"></label>
        <div class="productivity-fields"><button type="button" data-action="save-preset" data-i18n="productivity.savePreset">保存预设</button><button type="button" data-action="delete-preset" disabled data-i18n="productivity.deletePreset">删除预设</button></div>
        <button type="button" class="productivity-primary" data-action="run-flow" disabled data-i18n="productivity.runFlow">运行流程</button>
      </form>
      <div class="productivity-preview"><h2 data-i18n="productivity.processingSteps">处理步骤</h2><ol class="productivity-steps" data-flow-steps></ol>
        <div class="productivity-toolbar"><h2 data-i18n="productivity.fileOrder">文件顺序</h2><button type="button" data-action="clear-flow" data-i18n="productivity.clear">清空</button></div>
        <p class="productivity-muted" data-i18n="productivity.flowLimits">最多 100 个文件、150 MB 输入、200 页。图片使用首帧或本地解码帧，按当前顺序排列。</p>
        <div data-flow-files></div><p class="productivity-inline" data-flow-status role="status" aria-live="polite"></p>
        <button type="button" data-action="view-tasks" data-i18n="productivity.viewTasks">在任务中心查看进度</button>
      </div>
    </div>
  </section>
  <p class="productivity-message" data-productivity-message role="status" aria-live="polite"></p>
  <input type="file" data-rename-input multiple hidden><input type="file" data-flow-input multiple hidden>
</main></div>`;
