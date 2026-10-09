import { PPTX_ACCEPT } from './shared.js';

function topbar(root, tag) {
  return `<header class="pdf-merge-v2-topbar">
    <div class="settings-v2-topbar-left pdf-merge-v2-topbar-left">
      <button class="settings-v2-back settings-back pdf-merge-v2-back" id="${root}Back" data-i18n-title="settings.back" type="button" title="返回首页"><i data-lucide="arrow-left"></i><span data-i18n="settings.back">返回首页</span></button>
      <span class="pdf-merge-v2-top-tag">${tag}</span>
    </div>
    <div class="home-v2-top-actions pdf-merge-v2-top-actions">
      <button class="home-v2-nav-link" type="button" data-ppt-host-action="website"><i data-lucide="globe-2"></i><span>网页版本</span></button>
      <button class="home-v2-support-top" type="button" data-ppt-host-action="support"><i data-lucide="heart"></i><span>支持作者</span></button>
      <div class="home-v2-window-cluster" aria-label="窗口与设置">
        <button class="home-v2-icon-button" id="${root}V2Settings" type="button" data-i18n-title="nav.settings" title="设置" aria-label="设置" data-ppt-host-action="settings"><i data-lucide="settings"></i></button>
        <div class="home-v2-window-controls" aria-label="窗口控制">
          <button class="home-v2-window-button ctrl-btn" type="button" data-i18n-title="common.minimize" title="最小化" data-ppt-window-action="minimize"><i data-lucide="minus"></i></button>
          <button class="home-v2-window-button ctrl-btn" type="button" data-i18n-title="common.maximize" title="最大化" data-ppt-window-action="maximize"><i data-lucide="square"></i></button>
          <button class="home-v2-window-button ctrl-btn" type="button" data-i18n-title="common.close" title="关闭" data-ppt-window-action="close"><i data-lucide="x"></i></button>
        </div>
      </div>
    </div>
  </header>`;
}

function scrollTopButton(root) {
  return `<button class="ppt-images-scroll-top" id="${root}ScrollTop" type="button" aria-label="回到顶部" data-i18n-aria-label="common.backToTop">
    <svg class="ppt-images-scroll-top-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="M6 11l6-6 6 6"></path></svg>
  </button>`;
}

function processMask(root, i18nRoot, fallback) {
  return `<div class="audio-convert-process-mask" id="${root}ProcessMask" aria-hidden="true">
    <div class="tk-mascot-lg" aria-hidden="true"></div>
    <div class="audio-convert-process-bar"><div class="audio-convert-process-bar-fill" id="${root}ProcessBarFill"></div></div>
    <div class="audio-convert-process-text" id="${root}ProcessText" data-i18n="${i18nRoot}.processing">${fallback}</div>
  </div>`;
}

export function pptTextPageTemplate() {
  return `<div class="plasma-bg pdf-merge-v2-bg" id="pptTextPlasmaBg"></div>
    <div class="audio-convert-drop-zone pdf-merge-v2-drop-zone" id="pptTextDropZone"><span class="drop-hint" data-i18n="home.pptTextPage.dropHint">松手即可上传 PPTX</span></div>
    <input id="pptTextFileInput" type="file" accept="${PPTX_ACCEPT}" hidden>
    ${topbar('pptText', 'PPT TEXT AI · TOOL PAGE 3.1')}
    <div class="pdf-merge-v2-body" id="pptTextBody">
      <aside class="pdf-merge-v2-poster" aria-label="PPT AI 文本提取说明">
        <div class="pdf-merge-v2-poster-kicker" data-i18n="home.pptTextPage.heroLabel">PPT Text Intelligence</div>
        <h1 class="pdf-merge-v2-title" id="pptTextTitle" data-i18n="home.pptTextPage.title">PPT AI 文本提取</h1>
        <p class="pdf-merge-v2-subtitle" data-i18n="home.pptTextPage.subtitle">本地提取每页标题、正文和备注，可导出 Markdown / TXT / JSON，也能让 AI 整理成大纲、讲稿或纪要。</p>
        <div class="pdf-merge-v2-poster-note"><span>LOCAL FIRST</span><strong data-i18n="home.pptTextPage.localNote">基础提取在本机完成，不会修改原演示文稿。可按页查看标题、正文、表格文字与备注，筛选后导出 Markdown、TXT 或 JSON。仅在选择 AI 整理时，将提取出的文字和备注发送给配置的模型，不上传 PPTX 文件。</strong></div>
        <div class="pdf-merge-v2-steps" aria-label="文本提取流程">
          <div class="pdf-merge-v2-step is-active"><span>01</span><div><strong>上传 PPTX</strong><p>本地解包并逐页解析标题、正文与备注。</p></div></div>
          <div class="pdf-merge-v2-step"><span>02</span><div><strong>筛选与预览</strong><p>按页码筛选，点开单页查看完整提取文本。</p></div></div>
          <div class="pdf-merge-v2-step"><span>03</span><div><strong>导出结果</strong><p>导出 MD / TXT / JSON，或让 AI 整理成大纲、讲稿、纪要。</p></div></div>
        </div>
      </aside>
      <main class="pdf-merge-v2-workspace ppt-text-v2-workspace ppt-file-workspace" id="pptTextScrollArea">
        <section class="ppt-text-v2-upload ppt-file-upload" aria-label="上传 PPTX 文件">
          <div class="pdf-merge-v2-upload-copy"><span class="pdf-merge-v2-upload-eyebrow">DROP OR SELECT</span><h2 data-i18n="home.pptTextPage.uploadTitle">把 PPTX 放到这里提取文本</h2><p data-i18n="home.pptTextPage.uploadDesc">逐页提取标题、正文、备注与表格文字；AI 整理只接收提取文字。</p></div>
          <button class="audio-convert-cta ppt-text-v2-cta ppt-file-cta" id="pptTextCta" type="button"><i data-lucide="upload"></i><span data-i18n="home.pptTextPage.cta">上传 PPTX 文件</span></button>
        </section>
        <p class="ppt-images-file ppt-text-v2-file" id="pptTextFileName"></p>
        <section class="ppt-images-panel ppt-file-panel" id="pptTextPanel" aria-live="polite">
          <div class="ppt-images-empty ppt-text-v2-empty" id="pptTextEmpty"><i data-lucide="file-text" aria-hidden="true"></i><strong data-i18n="home.pptTextPage.emptyTitle">先上传一个 PPTX</strong><span data-i18n="home.pptTextPage.emptyDesc">扫描后会按页显示标题、正文摘要和备注状态。基础提取完全本地完成。</span></div>
          <div class="ppt-images-results" id="pptTextResults" hidden>
            <div class="ppt-images-summary" id="pptTextSummary"></div>
            <div class="ppt-images-toolbar ppt-text-toolbar">
              <label class="ppt-images-filter"><span data-i18n="home.pptTextPage.pageFilter">页码筛选</span><input id="pptTextPageFilter" type="text" placeholder="1,3-5" data-i18n-placeholder="home.pptTextPage.pageFilterPlaceholder"></label>
              <label class="ppt-images-filter"><span data-i18n="home.pptTextPage.format">导出格式</span><select id="pptTextFormat"><option value="markdown" data-i18n="home.pptTextPage.formatMarkdown">Markdown</option><option value="txt" data-i18n="home.pptTextPage.formatTxt">TXT</option><option value="json" data-i18n="home.pptTextPage.formatJson">JSON</option><option value="all" data-i18n="home.pptTextPage.formatAll">全部格式</option></select></label>
              <label class="ppt-images-filter"><span data-i18n="home.pptTextPage.aiMode">AI 整理</span><select id="pptTextAiMode"><option value="none" data-i18n="home.pptTextPage.aiNone">不使用 AI</option><option value="outline" data-i18n="home.pptTextPage.aiOutline">整理成大纲</option><option value="speaker-notes" data-i18n="home.pptTextPage.aiSpeakerNotes">生成讲稿</option><option value="meeting-notes" data-i18n="home.pptTextPage.aiMeetingNotes">会议纪要</option><option value="study-notes" data-i18n="home.pptTextPage.aiStudyNotes">学习笔记</option></select></label>
              <div class="ppt-images-toolbar-actions"><button class="audio-convert-process-btn ppt-images-export ppt-text-export" id="pptTextExportBtn" type="button" data-i18n="home.pptTextPage.exportSelected">导出文本</button></div>
            </div>
            <p class="ppt-text-ai-note" data-i18n="home.pptTextPage.aiPrivacyNote">预览列表展示的是 PPT 内真实文本；选择 AI 整理后，导出的文件会额外包含 AI 大纲/讲稿/纪要。AI 只接收文字和备注，不上传 PPTX 文件。</p>
            <div class="ppt-text-list" id="pptTextList"></div>
          </div>
        </section>
      </main>
    </div>${scrollTopButton('pptText')}`;
}

export function pptTextPortalTemplate() {
  return `<div data-ppt-text-portal>${processMask('pptText', 'home.pptTextPage', '正在处理...')}
    <div class="audio-clip-success-overlay" id="pptTextSuccessOverlay" aria-hidden="true"><div class="audio-clip-success-dialog"><div class="audio-clip-success-icon"><i data-lucide="check"></i></div><h3 class="audio-clip-success-title" data-i18n="home.pptTextPage.successTitle">文本提取完成</h3><div class="audio-clip-success-meta" id="pptTextSuccessMeta"></div><div class="audio-convert-success-detail"><div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.pptTextPage.successCount">导出文件</span><span class="audio-convert-success-value" id="pptTextSuccessCount"></span></div><div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.pptTextPage.successPath">保存位置</span><span class="audio-convert-success-value" id="pptTextSuccessPath"></span></div></div><div class="audio-clip-success-actions"><button class="audio-clip-success-btn audio-clip-success-btn-secondary" id="pptTextSuccessOpenFolder" data-i18n="home.pptTextPage.openFolder">打开文件夹</button><button class="audio-clip-success-btn audio-clip-success-btn-primary" id="pptTextSuccessOk" data-i18n="home.pptTextPage.ok">确定</button></div></div></div>
  </div>`;
}

export function pptCompressPageTemplate() {
  return `<div class="plasma-bg pdf-merge-v2-bg" id="pptCompressPlasmaBg"></div>
    <div class="audio-convert-drop-zone pdf-merge-v2-drop-zone" id="pptCompressDropZone"><span class="drop-hint" data-i18n="home.pptCompressPage.dropHint">松手即可上传 PPTX</span></div>
    <input id="pptCompressFileInput" type="file" accept="${PPTX_ACCEPT}" hidden>
    ${topbar('pptCompress', 'PPT COMPRESSOR · TOOL PAGE 3.1')}
    <div class="pdf-merge-v2-body" id="pptCompressBody">
      <aside class="pdf-merge-v2-poster" aria-label="PPT 压缩说明">
        <div class="pdf-merge-v2-poster-kicker" data-i18n="home.pptCompressPage.heroLabel">PPT Optimizer</div><h1 class="pdf-merge-v2-title" id="pptCompressTitle" data-i18n="home.pptCompressPage.title">PPT 压缩</h1><p class="pdf-merge-v2-subtitle" data-i18n="home.pptCompressPage.subtitle">本地安全压缩 PPTX：可选择无损清理，也可以压缩大图素材来明显降低体积，源文件不会被修改。</p>
        <div class="pdf-merge-v2-poster-note"><span>LOCAL ONLY</span><strong data-i18n="home.pptCompressPage.localNote">在本机优化演示文稿中的图片，不会上传到服务器。可选择压缩档位，查看文件大小与图片统计，再另存为新的 PPTX，原文件保持不变。压缩效果取决于图片占比和原始质量，已优化的文件可能节省较少空间。</strong></div>
        <div class="pdf-merge-v2-steps" aria-label="压缩流程"><div class="pdf-merge-v2-step is-active"><span>01</span><div><strong>上传 PPTX</strong><p>读取并扫描演示文稿内的媒体素材。</p></div></div><div class="pdf-merge-v2-step"><span>02</span><div><strong>选择等级</strong><p>无损清理或推荐 / 强力图片压缩。</p></div></div><div class="pdf-merge-v2-step"><span>03</span><div><strong>压缩导出</strong><p>生成压缩后的 PPTX 并保留版式。</p></div></div><div class="pdf-merge-v2-step"><span>04</span><div><strong>查看结果</strong><p>查看体积变化并打开输出目录。</p></div></div></div>
      </aside>
      <main class="pdf-merge-v2-workspace ppt-compress-v2-workspace ppt-file-workspace" id="pptCompressScrollArea">
        <section class="ppt-compress-v2-upload ppt-file-upload" aria-label="上传 PPTX 文件"><div class="pdf-merge-v2-upload-copy"><span class="pdf-merge-v2-upload-eyebrow">DROP OR SELECT</span><h2 data-i18n="home.pptCompressPage.uploadTitle">把 PPTX 放到这里压缩</h2><p data-i18n="home.pptCompressPage.uploadDesc">扫描媒体素材后可选择无损清理，或压缩大图来明显降低体积。</p></div><button class="audio-convert-cta ppt-compress-v2-cta ppt-file-cta" id="pptCompressCta" type="button"><i data-lucide="upload"></i><span data-i18n="home.pptCompressPage.cta">上传 PPTX 文件</span></button></section>
        <p class="ppt-images-file ppt-compress-v2-file" id="pptCompressFileName"></p>
        <section class="ppt-images-panel ppt-file-panel" id="pptCompressPanel" aria-live="polite"><div class="ppt-images-empty ppt-compress-v2-empty" id="pptCompressEmpty"><i data-lucide="archive" aria-hidden="true"></i><strong data-i18n="home.pptCompressPage.emptyTitle">先上传一个 PPTX</strong><span data-i18n="home.pptCompressPage.emptyDesc">扫描后会显示页数、媒体数量、原始大小、图片压缩数量和预计压缩结果。</span></div><div class="ppt-images-results" id="pptCompressResults" hidden><div class="ppt-images-summary" id="pptCompressSummary"></div><div class="ppt-images-toolbar ppt-compress-toolbar"><label class="ppt-images-filter"><span data-i18n="home.pptCompressPage.level">压缩等级</span><select id="pptCompressLevel"><option value="low" data-i18n="home.pptCompressPage.levelLow">无损清理：不降低图片质量</option><option value="medium" selected data-i18n="home.pptCompressPage.levelMedium">推荐压缩：适度压缩大图</option><option value="high" data-i18n="home.pptCompressPage.levelHigh">强力压缩：体积优先</option></select></label><div class="ppt-images-toolbar-actions"><button class="audio-convert-process-btn ppt-images-export ppt-compress-export" id="pptCompressExportBtn" type="button" data-i18n="home.pptCompressPage.exportSelected">导出压缩版</button></div></div><p class="ppt-text-ai-note" data-i18n="home.pptCompressPage.qualityNote">无损清理不会改图片；推荐/强力会重压缩大图，压缩后如果没有变小会自动保留原图。</p><div class="ppt-compress-stats" id="pptCompressStats"></div></div></section>
      </main>
    </div>${scrollTopButton('pptCompress')}`;
}

export function pptCompressPortalTemplate() {
  return `<div data-ppt-compress-portal>${processMask('pptCompress', 'home.pptCompressPage', '正在处理...')}
    <div class="audio-clip-success-overlay" id="pptCompressSuccessOverlay" aria-hidden="true"><div class="audio-clip-success-dialog"><div class="audio-clip-success-icon"><i data-lucide="check"></i></div><h3 class="audio-clip-success-title" data-i18n="home.pptCompressPage.successTitle">PPT 压缩完成</h3><div class="audio-clip-success-meta" id="pptCompressSuccessMeta"></div><div class="audio-convert-success-detail"><div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.pptCompressPage.successOriginal">原始大小</span><span class="audio-convert-success-value" id="pptCompressSuccessOriginal"></span></div><div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.pptCompressPage.successCompressed">压缩后</span><span class="audio-convert-success-value" id="pptCompressSuccessCompressed"></span></div><div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.pptCompressPage.successSaved">节省空间</span><span class="audio-convert-success-value" id="pptCompressSuccessSaved"></span></div><div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.pptCompressPage.successPath">保存位置</span><span class="audio-convert-success-value" id="pptCompressSuccessPath"></span></div></div><div class="audio-clip-success-actions"><button class="audio-clip-success-btn audio-clip-success-btn-secondary" id="pptCompressSuccessOpenFolder" data-i18n="home.pptCompressPage.openFolder">打开文件夹</button><button class="audio-clip-success-btn audio-clip-success-btn-primary" id="pptCompressSuccessOk" data-i18n="home.pptCompressPage.ok">确定</button></div></div></div>
  </div>`;
}

function presetCard(key, icon, titleKey, title, descriptionKey, description) {
  return `<button class="ppt-ai-preset-card" type="button" data-ppt-outline-preset="${key}"><span class="ppt-ai-preset-icon" aria-hidden="true">${icon}</span><strong data-i18n="home.pptAiPresets.${titleKey}.title">${title}</strong><em data-i18n="home.pptAiPresets.${descriptionKey}.desc">${description}</em></button>`;
}

export function pptOutlinePageTemplate() {
  const presets = [
    presetCard('product-launch', '<i data-lucide="rocket"></i>', 'productLaunch', '产品发布', 'productLaunch', '版本发布 / 功能介绍'),
    presetCard('work-report', '<i data-lucide="chart-no-axes-column-increasing"></i>', 'workReport', '工作汇报', 'workReport', '成果复盘 / 下一步计划'),
    presetCard('investor-pitch', '<i data-lucide="gem"></i>', 'investorPitch', '路演融资', 'investorPitch', '商业计划 / 合作沟通'),
    presetCard('training', '<i data-lucide="graduation-cap"></i>', 'training', '培训课件', 'training', '新手教学 / 课程大纲'),
    presetCard('industry-research', '<i data-lucide="search"></i>', 'industryResearch', '行业研究', 'industryResearch', '趋势洞察 / 分析报告'),
    presetCard('short-video-demo', '<i data-lucide="clapperboard"></i>', 'shortVideoDemo', '短视频演示', 'shortVideoDemo', '爆点脚本 / 分镜展示')
  ].join('');
  return `<div class="plasma-bg pdf-merge-v2-bg" id="pptOutlinePlasmaBg"></div>
    ${topbar('pptOutline', 'PPT OUTLINE AI · TOOL PAGE 3.1')}
    <div class="pdf-merge-v2-body" id="pptOutlineBody">
      <aside class="pdf-merge-v2-poster" aria-label="AI 生成 PPT 大纲说明"><div class="pdf-merge-v2-poster-kicker" data-i18n="home.pptOutlinePage.heroLabel">PPT Strategist</div><h1 class="pdf-merge-v2-title" id="pptOutlineTitle" data-i18n="home.pptOutlinePage.title">AI 生成 PPT 大纲</h1><p class="pdf-merge-v2-subtitle" data-i18n="home.pptOutlinePage.subtitle">输入主题、资料、受众和演示目标，生成可继续进入 PPTX 草稿阶段的结构化大纲。</p><div class="pdf-merge-v2-poster-note"><span>AI POWERED</span><strong>只发送你输入的文字，不读取或上传 PPTX 文件。</strong></div><div class="pdf-merge-v2-steps" aria-label="大纲生成流程"><div class="pdf-merge-v2-step is-active"><span>01</span><div><strong>选择预设或填写参数</strong><p>选择类型预设，或填写主题、受众与目标。</p></div></div><div class="pdf-merge-v2-step"><span>02</span><div><strong>生成大纲</strong><p>AI 规划标题、叙事结构与页面列表。</p></div></div><div class="pdf-merge-v2-step"><span>03</span><div><strong>预览结果</strong><p>查看事实库、质量检查与逐页建议。</p></div></div><div class="pdf-merge-v2-step"><span>04</span><div><strong>导出 / 生成草稿</strong><p>导出 MD，或继续进入 PPTX 草稿阶段。</p></div></div></div></aside>
      <main class="pdf-merge-v2-workspace ppt-outline-v2-workspace" id="pptOutlineScrollArea"><section class="ppt-outline-grid" aria-label="AI 生成 PPT 大纲工作区"><div class="ppt-outline-compose"><div class="ppt-ai-preset-panel" id="pptOutlinePresetPanel"><div class="ppt-ai-preset-title"><span data-i18n="home.pptOutlinePage.quickPresets">快速开始预设</span><em data-i18n="home.pptOutlinePage.quickPresetsHint">点一下填好参数，再改主题即可生成</em></div><div class="ppt-ai-preset-grid" id="pptOutlinePresetGrid" aria-label="PPT outline quick presets">${presets}</div></div>
        <label class="ppt-outline-field ppt-outline-field-full"><span data-i18n="home.pptOutlinePage.promptLabel">主题 / 资料</span><textarea id="pptOutlinePrompt" rows="7" data-i18n-placeholder="home.pptOutlinePage.promptPlaceholder" placeholder="例如：给 ToolKnit 2.0 做一份 8 页发布演示，强调本地优先、AI Agent、PPT 工具和用户隐私..."></textarea></label>
        <div class="ppt-outline-row"><label class="ppt-outline-field"><span data-i18n="home.pptOutlinePage.slideCount">页数</span><input id="pptOutlineSlideCount" type="number" min="3" max="30" value="8"></label><label class="ppt-outline-field"><span data-i18n="home.pptOutlinePage.locale">语言</span><select id="pptOutlineLocale"><option value="zh-CN" data-i18n="home.pptOutlinePage.localeZh">中文</option><option value="en" data-i18n="home.pptOutlinePage.localeEn">English</option></select></label></div>
        <label class="ppt-outline-field"><span data-i18n="home.pptOutlinePage.deckType">类型预设</span><select id="pptOutlineDeckType"><option value="auto" data-i18n="home.pptOutlinePage.deckTypeAuto">自动判断</option><option value="product-launch" data-i18n="home.pptOutlinePage.deckTypeProductLaunch">产品发布 / 功能发布</option><option value="investor-pitch" data-i18n="home.pptOutlinePage.deckTypeInvestorPitch">融资路演 / 投资人沟通</option><option value="work-report" data-i18n="home.pptOutlinePage.deckTypeWorkReport">工作汇报 / 项目汇报</option><option value="training" data-i18n="home.pptOutlinePage.deckTypeTraining">培训课件 / 教学演示</option><option value="industry-research" data-i18n="home.pptOutlinePage.deckTypeIndustryResearch">行业研究 / 趋势报告</option><option value="competitive-analysis" data-i18n="home.pptOutlinePage.deckTypeCompetitiveAnalysis">竞品分析 / 对比研究</option><option value="short-video-demo" data-i18n="home.pptOutlinePage.deckTypeShortVideoDemo">短视频脚本 / 演示拆解</option><option value="project-review" data-i18n="home.pptOutlinePage.deckTypeProjectReview">项目复盘 / 迭代总结</option></select></label>
        <label class="ppt-outline-field"><span data-i18n="home.pptOutlinePage.audience">目标受众</span><input id="pptOutlineAudience" type="text" data-i18n-placeholder="home.pptOutlinePage.audiencePlaceholder" placeholder="例如：开源用户、投资人、学生、内部评审"></label><label class="ppt-outline-field"><span data-i18n="home.pptOutlinePage.purpose">演示目标</span><input id="pptOutlinePurpose" type="text" data-i18n-placeholder="home.pptOutlinePage.purposePlaceholder" placeholder="例如：说服下载试用、解释方案、汇报结论"></label><label class="ppt-outline-field"><span data-i18n="home.pptOutlinePage.tone">语气</span><input id="pptOutlineTone" type="text" data-i18n-placeholder="home.pptOutlinePage.tonePlaceholder" placeholder="例如：专业、有感染力、适合短视频"></label><p class="ppt-text-ai-note" data-i18n="home.pptOutlinePage.aiNote">需要先在设置里配置 AI 密钥。此工具只发送你输入的文字，不读取或上传 PPTX 文件。</p><button class="audio-convert-process-btn ppt-images-export ppt-outline-generate" id="pptOutlineGenerateBtn" type="button" data-i18n="home.pptOutlinePage.generate">生成并导出大纲</button></div>
        <div class="ppt-outline-preview" id="pptOutlinePreview"><div class="ppt-images-empty ppt-outline-empty" id="pptOutlineEmpty"><i data-lucide="sparkles" aria-hidden="true"></i><strong data-i18n="home.pptOutlinePage.emptyTitle">还没有生成大纲</strong><span data-i18n="home.pptOutlinePage.emptyDesc">生成后会在这里预览标题、叙事结构、页面列表和待确认信息。</span><div class="ppt-outline-v2-empty-hints" aria-hidden="true"><span data-i18n="home.pptOutlinePage.emptyHintTitle">标题与叙事</span><span data-i18n="home.pptOutlinePage.emptyHintFacts">事实库</span><span data-i18n="home.pptOutlinePage.emptyHintQuality">质量检查</span><span data-i18n="home.pptOutlinePage.emptyHintSlides">逐页建议</span></div></div><div class="ppt-outline-result" id="pptOutlineResult" hidden><div class="ppt-images-summary" id="pptOutlineSummary"></div><section class="ppt-outline-guide" id="pptOutlineGuide" hidden><div class="ppt-outline-guide-head"><div><span class="ppt-outline-guide-eyebrow" data-i18n="home.pptOutlinePage.guideEyebrow">PLAIN LANGUAGE</span><strong data-i18n="home.pptOutlinePage.guideTitle">大白话说明</strong></div><button class="ppt-outline-action-btn" id="pptOutlineGuideCopy" type="button" data-i18n="home.pptOutlinePage.guideCopy">复制说明</button></div><div id="pptOutlineGuideBody"></div></section><div class="ppt-outline-meta" id="pptOutlineMeta"></div><div class="ppt-outline-fact-bank" id="pptOutlineFactBank"></div><div class="ppt-outline-quality" id="pptOutlineQuality"></div><div class="ppt-outline-slide-list" id="pptOutlineSlideList"></div></div></div></section></main>
    </div>${scrollTopButton('pptOutline')}`;
}

export function pptOutlinePortalTemplate() {
  return `<div data-ppt-outline-portal>${processMask('pptOutline', 'home.pptOutlinePage', '正在生成大纲...')}
    <div class="audio-clip-success-overlay" id="pptOutlineSuccessOverlay" aria-hidden="true"><div class="audio-clip-success-dialog"><div class="audio-clip-success-icon"><i data-lucide="check"></i></div><h3 class="audio-clip-success-title" data-i18n="home.pptOutlinePage.successTitle">PPT 大纲已生成</h3><div class="audio-clip-success-meta" id="pptOutlineSuccessMeta"></div><div class="audio-convert-success-detail"><div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.pptOutlinePage.successSlides">页数</span><span class="audio-convert-success-value" id="pptOutlineSuccessSlides"></span></div><div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.pptOutlinePage.successFiles">导出文件</span><span class="audio-convert-success-value" id="pptOutlineSuccessFiles"></span></div><div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.pptOutlinePage.successPath">保存位置</span><span class="audio-convert-success-value" id="pptOutlineSuccessPath"></span></div></div><div class="audio-clip-success-actions"><button class="audio-clip-success-btn audio-clip-success-btn-secondary" id="pptOutlineSuccessOpenFolder" data-i18n="home.pptOutlinePage.openFolder">打开文件夹</button><button class="audio-clip-success-btn audio-clip-success-btn-secondary" id="pptOutlineSuccessToDraft" data-i18n="home.pptOutlinePage.continueDraft">生成 PPTX 草稿</button><button class="audio-clip-success-btn audio-clip-success-btn-primary" id="pptOutlineSuccessOk" data-i18n="home.pptOutlinePage.ok">确定</button></div></div></div>
  </div>`;
}
