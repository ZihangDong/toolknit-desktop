const PAGE = String.raw`
<div class="plasma-bg pdf-merge-v2-bg" id="pptImagesPlasmaBg"></div>
<div class="audio-convert-drop-zone pdf-merge-v2-drop-zone" id="pptImagesDropZone"><span class="drop-hint" data-i18n="home.pptImagesPage.dropHint">松手即可上传 PPTX</span></div>
<input id="pptImagesFileInput" type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" hidden>
<header class="pdf-merge-v2-topbar">
  <div class="settings-v2-topbar-left pdf-merge-v2-topbar-left">
    <button class="settings-v2-back settings-back pdf-merge-v2-back" id="pptImagesBack" data-i18n-title="settings.back" type="button" title="返回首页">
      <i data-lucide="arrow-left"></i>
      <span data-i18n="settings.back">返回首页</span>
    </button>
    <span class="pdf-merge-v2-top-tag">PPT ASSETS · TOOL PAGE 3.1</span>
  </div>
  <div class="home-v2-top-actions pdf-merge-v2-top-actions">
    <button class="home-v2-nav-link" type="button" data-home-link="website">
      <i data-lucide="globe-2"></i>
      <span>网页版本</span>
    </button>
    <button class="home-v2-support-top" type="button" data-open-support>
      <i data-lucide="heart"></i>
      <span>支持作者</span>
    </button>
    <div class="home-v2-window-cluster" aria-label="窗口与设置">
      <button class="home-v2-icon-button" id="pptImagesV2Settings" type="button" data-i18n-title="nav.settings" title="设置" aria-label="设置">
        <i data-lucide="settings"></i>
      </button>
      <div class="home-v2-window-controls" aria-label="窗口控制">
        <button class="home-v2-window-button ctrl-btn" type="button" data-i18n-title="common.minimize" title="最小化" data-action="minimize"><i data-lucide="minus"></i></button>
        <button class="home-v2-window-button ctrl-btn" type="button" data-i18n-title="common.maximize" title="最大化" data-action="maximize"><i data-lucide="square"></i></button>
        <button class="home-v2-window-button ctrl-btn" type="button" data-i18n-title="common.close" title="关闭" data-action="close"><i data-lucide="x"></i></button>
      </div>
    </div>
  </div>
</header>
<div class="pdf-merge-v2-body" id="pptImagesBody">
  <aside class="pdf-merge-v2-poster" aria-label="PPT 图片提取说明">
    <div class="pdf-merge-v2-poster-kicker" data-i18n="home.pptImagesPage.heroLabel">PPT Asset Extractor</div>
    <h1 class="pdf-merge-v2-title" id="pptImagesTitle" data-i18n="home.pptImagesPage.title">PPT 图片提取</h1>
    <p class="pdf-merge-v2-subtitle" data-i18n="home.pptImagesPage.subtitle">提取 PPTX 内嵌图片、Logo、截图和背景素材，保留原始格式并生成导出清单。</p>
    <div class="pdf-merge-v2-poster-note">
      <span>LOCAL ONLY</span>
      <strong data-i18n="home.pptImagesPage.localNote">文件只在本机扫描，不会上传到服务器，也不会修改原演示文稿。可查看每张素材的页码、格式、尺寸与大小，按页码筛选并跳过完全重复项。导出保留图片原始格式，附带素材清单，方便整理、查找与再次使用。</strong>
    </div>
    <div class="pdf-merge-v2-steps" aria-label="图片提取流程">
      <div class="pdf-merge-v2-step is-active">
        <span>01</span>
        <div>
          <strong>上传 PPTX</strong>
          <p>读取并扫描演示文稿内的图片素材。</p>
        </div>
      </div>
      <div class="pdf-merge-v2-step">
        <span>02</span>
        <div>
          <strong>筛选素材</strong>
          <p>按页码筛选、跳过重复项或手动选择。</p>
        </div>
      </div>
      <div class="pdf-merge-v2-step">
        <span>03</span>
        <div>
          <strong>导出结果</strong>
          <p>保留原始格式并生成 manifest 清单。</p>
        </div>
      </div>
    </div>
  </aside>
  <main class="pdf-merge-v2-workspace ppt-images-v2-workspace ppt-file-workspace" id="pptImagesScrollArea">
    <section class="ppt-images-v2-upload ppt-file-upload" aria-label="上传 PPTX 文件">
      <div class="pdf-merge-v2-upload-copy">
        <span class="pdf-merge-v2-upload-eyebrow">DROP OR SELECT</span>
        <h2>把 PPTX 放到这里提取图片</h2>
        <p>扫描内嵌图片、Logo、截图和背景素材，保留原始格式与尺寸。</p>
      </div>
      <button class="audio-convert-cta ppt-images-v2-cta ppt-file-cta" id="pptImagesCta" type="button">
        <i data-lucide="upload"></i>
        <span data-i18n="home.pptImagesPage.cta">上传 PPTX 文件</span>
      </button>
    </section>
    <p class="ppt-images-file ppt-images-v2-file" id="pptImagesFileName"></p>
    <section class="ppt-images-panel ppt-file-panel" id="pptImagesPanel" aria-live="polite">
      <div class="ppt-images-empty ppt-images-v2-empty" id="pptImagesEmpty">
        <i data-lucide="image-up" aria-hidden="true"></i>
        <strong data-i18n="home.pptImagesPage.emptyTitle">先上传一个 PPTX</strong>
        <span data-i18n="home.pptImagesPage.emptyDesc">扫描后会显示每张素材的页码、格式、尺寸、大小和重复状态。</span>
      </div>
      <div class="ppt-images-results" id="pptImagesResults" hidden>
        <div class="ppt-images-summary" id="pptImagesSummary"></div>
        <div class="ppt-images-toolbar">
          <label class="ppt-images-filter">
            <span data-i18n="home.pptImagesPage.pageFilter">页码筛选</span>
            <input id="pptImagesPageFilter" type="text" placeholder="1,3-5" data-i18n-placeholder="home.pptImagesPage.pageFilterPlaceholder">
          </label>
          <label class="ppt-images-toggle">
            <input id="pptImagesSkipDuplicates" type="checkbox">
            <span data-i18n="home.pptImagesPage.skipDuplicates">跳过完全重复素材</span>
          </label>
          <div class="ppt-images-toolbar-actions">
            <button class="ppt-images-small-btn" id="pptImagesSelectAll" type="button" data-i18n="home.pptImagesPage.selectAll">全选</button>
            <button class="ppt-images-small-btn" id="pptImagesClearSelection" type="button" data-i18n="home.pptImagesPage.clearSelection">清空</button>
            <button class="audio-convert-process-btn ppt-images-export" id="pptImagesExportBtn" type="button" data-i18n="home.pptImagesPage.exportSelected">导出已选素材</button>
          </div>
        </div>
        <div class="ppt-images-list" id="pptImagesList"></div>
      </div>
    </section>
  </main>
</div>
<button class="ppt-images-scroll-top" id="pptImagesScrollTop" type="button" aria-label="回到顶部" data-i18n-aria-label="common.backToTop">
  <svg class="ppt-images-scroll-top-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 19V5"></path>
    <path d="M6 11l6-6 6 6"></path>
  </svg>
</button>
`;

const PORTAL = String.raw`
<div data-ppt-images-portal>
  <div class="audio-clip-success-overlay ppt-images-preview" id="pptImagesPreviewOverlay" role="dialog" aria-modal="true" aria-labelledby="pptImagesPreviewTitle" aria-hidden="true" inert>
    <div class="audio-clip-success-dialog ppt-images-preview-dialog">
      <div class="ppt-images-preview-heading">
        <h3 id="pptImagesPreviewTitle"></h3>
        <p id="pptImagesPreviewMeta"></p>
      </div>
      <div class="ppt-images-preview-media"><img id="pptImagesPreviewImage" alt=""></div>
      <button class="audio-clip-success-btn audio-clip-success-btn-primary ppt-images-preview-close" id="pptImagesPreviewClose" type="button"><i data-lucide="x" aria-hidden="true"></i><span data-i18n="home.pptImagesPage.closePreview">关闭预览</span></button>
    </div>
  </div>
  
  <div class="audio-convert-process-mask" id="pptImagesProcessMask">
    <div class="tk-mascot-lg" aria-hidden="true"></div>
    <div class="audio-convert-process-bar">
      <div class="audio-convert-process-bar-fill" id="pptImagesProcessBarFill"></div>
    </div>
    <div class="audio-convert-process-text" id="pptImagesProcessText" data-i18n="home.pptImagesPage.processing">正在处理...</div>
  </div>
  
  <div class="audio-clip-success-overlay" id="pptImagesSuccessOverlay">
    <div class="audio-clip-success-dialog">
      <div class="audio-clip-success-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
      </div>
      <h3 class="audio-clip-success-title" data-i18n="home.pptImagesPage.successTitle">图片提取完成</h3>
      <div class="audio-clip-success-meta" id="pptImagesSuccessMeta"></div>
      <div class="audio-convert-success-detail">
        <div class="audio-convert-success-row">
          <span class="audio-convert-success-key" data-i18n="home.pptImagesPage.successCount">导出素材</span>
          <span class="audio-convert-success-value" id="pptImagesSuccessCount"></span>
        </div>
        <div class="audio-convert-success-row">
          <span class="audio-convert-success-key" data-i18n="home.pptImagesPage.successPath">保存位置</span>
          <span class="audio-convert-success-value" id="pptImagesSuccessPath"></span>
        </div>
      </div>
      <div class="audio-clip-success-actions">
        <button class="audio-clip-success-btn audio-clip-success-btn-secondary" id="pptImagesSuccessOpenFolder" data-i18n="home.pptImagesPage.openFolder">打开文件夹</button>
        <button class="audio-clip-success-btn audio-clip-success-btn-primary" id="pptImagesSuccessOk" data-i18n="home.pptImagesPage.ok">确定</button>
      </div>
    </div>
  </div>
</div>
`;

export function pptImagesPageTemplate() {
  return PAGE;
}

export function pptImagesPortalTemplate() {
  return PORTAL;
}
