export function iconGeneratorPageTemplate() {
  return `
    <div class="plasma-bg pdf-merge-v2-bg" id="iconGenPlasmaBg"></div>
    <div class="audio-convert-drop-zone pdf-merge-v2-drop-zone" id="iconGenDropZone"><span class="drop-hint" data-i18n="home.iconGen.dropHint">松手即可上传</span></div>
    <header class="pdf-merge-v2-topbar icon-gen-v2-topbar">
      <div class="pdf-merge-v2-topbar-left icon-gen-v2-topbar-left">
        <button class="settings-v2-back settings-back pdf-merge-v2-back" id="iconGenBack" type="button" data-i18n-title="settings.back" title="返回首页"><i data-lucide="arrow-left"></i><span data-i18n="settings.back">返回首页</span></button>
        <span class="pdf-merge-v2-top-tag icon-gen-v2-top-tag">IMAGE TOOLS · TOOL PAGE 3.1</span>
      </div>
      <div class="home-v2-top-actions pdf-merge-v2-top-actions">
        <button class="home-v2-nav-link" type="button" data-home-link="website"><i data-lucide="globe-2"></i><span>网页版本</span></button>
        <button class="home-v2-support-top" type="button" data-open-support><i data-lucide="heart"></i><span>支持作者</span></button>
        <div class="home-v2-window-cluster" aria-label="窗口与设置">
          <button class="home-v2-icon-button" id="iconGenV2Settings" type="button" data-i18n-title="nav.settings" title="设置" aria-label="设置"><i data-lucide="settings"></i></button>
          <div class="home-v2-window-controls" aria-label="窗口控制">
            <button class="home-v2-window-button ctrl-btn" type="button" data-i18n-title="common.minimize" title="最小化" data-action="minimize"><i data-lucide="minus"></i></button>
            <button class="home-v2-window-button ctrl-btn" type="button" data-i18n-title="common.maximize" title="最大化" data-action="maximize"><i data-lucide="square"></i></button>
            <button class="home-v2-window-button ctrl-btn" type="button" data-i18n-title="common.close" title="关闭" data-action="close"><i data-lucide="x"></i></button>
          </div>
        </div>
      </div>
    </header>
    <div class="pdf-merge-v2-body icon-gen-v2-body" id="iconGenBody">
      <aside class="pdf-merge-v2-poster icon-gen-v2-poster" aria-label="图标生成器说明">
        <div class="pdf-merge-v2-poster-kicker" data-i18n="home.iconGen.heroLabel">Icon Generator</div>
        <h1 class="pdf-merge-v2-title" data-i18n="home.iconGen.title">图标生成器</h1>
        <p class="pdf-merge-v2-subtitle" data-i18n="home.iconGen.subtitle">上传图片，一键生成多尺寸图标（16px-1024px），打包为 ZIP 下载。</p>
        <div class="pdf-merge-v2-poster-note"><span>LOCAL ONLY</span><strong>自动居中裁切并输出全套图标，适合桌面端和网站图标制作。</strong></div>
        <div class="pdf-merge-v2-steps" aria-label="生成流程">
          <div class="pdf-merge-v2-step is-active"><span>01</span><div><strong>上传源图</strong><p>添加一张清晰的 PNG、JPG 或 WebP 图片。</p></div></div>
          <div class="pdf-merge-v2-step"><span>02</span><div><strong>自动裁正</strong><p>系统会自动居中裁切为方形基础图层。</p></div></div>
          <div class="pdf-merge-v2-step"><span>03</span><div><strong>生成图标包</strong><p>输出 PNG、ICO、SVG 和 favicon 组合。</p></div></div>
          <div class="pdf-merge-v2-step"><span>04</span><div><strong>ZIP 下载</strong><p>生成完成后可直接打开文件夹查看结果。</p></div></div>
        </div>
      </aside>
      <main class="pdf-merge-v2-workspace icon-gen-v2-workspace">
        <section class="pdf-merge-v2-upload icon-gen-v2-upload" aria-label="上传图标源图">
          <div class="pdf-merge-v2-upload-copy"><span class="pdf-merge-v2-upload-eyebrow">DROP OR SELECT</span><h2>把需要生成图标的图片放到这里</h2><p>支持拖拽或点击上传，上传后会显示源图预览并进入生成队列。</p></div>
          <button class="audio-convert-cta pdf-merge-v2-cta" id="iconGenCta" type="button"><i data-lucide="upload"></i><span data-i18n="home.iconGen.cta">上传图片文件</span></button>
        </section>
        <section class="pdf-merge-v2-queue icon-gen-v2-queue" aria-label="已选源图">
          <div class="pdf-merge-v2-section-head"><div><span class="pdf-merge-v2-section-kicker">SOURCE FILE</span><h2>已选源图</h2></div><p>支持 PNG、JPG、WebP，选中后即可生成全套图标。</p></div>
          <div class="audio-convert-files pdf-merge-v2-files icon-gen-v2-files" id="iconGenFiles"></div>
        </section>
        <section class="audio-convert-formats pdf-merge-v2-info icon-gen-v2-info" aria-label="输出格式">
          <h3 class="audio-convert-formats-title" data-i18n="home.iconGen.formatsTitle">输出格式</h3>
          <div class="pdf-merge-info-grid">
            <div class="pdf-merge-info-item"><i data-lucide="sparkles"></i><span>PNG 多尺寸图标</span></div>
            <div class="pdf-merge-info-item"><i data-lucide="package"></i><span>ICO 兼容桌面端</span></div>
            <div class="pdf-merge-info-item"><i data-lucide="file-image"></i><span>SVG 矢量版本</span></div>
            <div class="pdf-merge-info-item"><i data-lucide="shield"></i><span>ZIP 打包一键下载</span></div>
          </div>
        </section>
        <footer class="pdf-merge-v2-actions icon-gen-v2-actions"><span>只需要一张清晰源图，生成后会自动打包下载。</span><button class="audio-convert-process-btn pdf-merge-v2-process" id="iconGenProcessBtn" data-i18n="home.iconGen.processBtn" style="display:none;">开始生成</button></footer>
      </main>
    </div>`;
}

export function iconGeneratorPortalTemplate() {
  return `<div data-icon-generator-portal>
    <div class="audio-convert-process-mask" id="iconGenProcessMask" aria-hidden="true"><div class="tk-mascot-lg" aria-hidden="true"></div><div class="audio-convert-process-bar"><div class="audio-convert-process-bar-fill" id="iconGenProcessBarFill"></div></div><div class="audio-convert-process-text" id="iconGenProcessText" data-i18n="home.iconGen.processing">正在生成...</div><button class="audio-convert-cancel-btn" id="iconGenCancelBtn" data-i18n="home.iconGen.cancel">取消</button></div>
    <div class="audio-convert-success-overlay" id="iconGenSuccessOverlay" aria-hidden="true">
      <div class="audio-convert-success-dialog">
        <div class="audio-convert-success-icon"><i data-lucide="check"></i></div>
        <h3 class="audio-convert-success-title" data-i18n="home.iconGen.successTitle">生成完成</h3>
        <div class="audio-convert-success-meta" id="iconGenSuccessMeta"></div>
        <div class="audio-convert-success-detail">
          <div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.iconGen.successCount">生成图标</span><span class="audio-convert-success-value" id="iconGenSuccessCount"></span></div>
          <div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.iconGen.successPath">保存路径</span><span class="audio-convert-success-value" id="iconGenSuccessPath"></span></div>
        </div>
        <div class="audio-convert-success-actions">
          <button class="audio-convert-success-btn audio-convert-success-btn-secondary" id="iconGenOpenFolder" type="button" data-i18n="home.iconGen.openFolder">打开文件夹</button>
          <button class="audio-convert-success-btn audio-convert-success-btn-primary" id="iconGenSuccessOk" type="button" data-i18n="home.iconGen.ok">确定</button>
        </div>
      </div>
    </div>
  </div>`;
}
