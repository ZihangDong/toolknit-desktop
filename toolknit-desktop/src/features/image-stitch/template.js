const PAGE = String.raw`
      <div class="plasma-bg pdf-merge-v2-bg" id="imageStitchPlasmaBg"></div>
      <header class="pdf-merge-v2-topbar image-stitch-v2-topbar">
        <div class="pdf-merge-v2-topbar-left image-stitch-v2-topbar-left">
          <button class="settings-v2-back settings-back pdf-merge-v2-back" id="imageStitchBack" type="button" data-i18n-title="settings.back" title="返回首页">
            <i data-lucide="arrow-left"></i>
            <span data-i18n="settings.back">返回首页</span>
          </button>
          <span class="pdf-merge-v2-top-tag image-stitch-v2-top-tag">IMAGE STITCH · TOOL PAGE 3.1</span>
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
            <button class="home-v2-icon-button" id="imageStitchV2Settings" type="button" data-i18n-title="nav.settings" title="设置" aria-label="设置">
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
      <main class="image-stitch-body">
        <section class="image-stitch-control-card" aria-label="长图拼接导入与顺序">
          <div class="image-stitch-hero">
            <span class="pdf-merge-v2-poster-kicker">LONG CANVAS</span>
            <h1 class="audio-convert-hero-title" data-i18n="home.imageStitch.title">长图拼接</h1>
            <p class="audio-convert-hero-subtitle" data-i18n="home.imageStitch.subtitle">调整顺序与统一尺寸，在本地无损拼成一张完整长图。</p>
          </div>
          <div class="image-stitch-command-grid">
            <button class="image-stitch-text-button primary" id="imageStitchPick" type="button"><i data-lucide="plus"></i><span data-i18n="home.imageStitch.add">添加图片</span></button>
            <button class="image-stitch-text-button" id="imageStitchPdfPick" type="button"><i data-lucide="file-text"></i><span data-i18n="home.imageStitch.addPdf">从 PDF 导入</span></button>
            <button class="image-stitch-text-button danger" id="imageStitchClear" type="button" disabled><i data-lucide="trash-2"></i><span data-i18n="home.imageStitch.clear">全部清空</span></button>
          </div>
          <aside class="image-stitch-queue-panel">
            <div class="image-stitch-panel-heading">
              <span data-i18n="home.imageStitch.queue">拼接顺序</span>
              <strong id="imageStitchCount">0 / 100</strong>
            </div>
            <div class="image-stitch-queue-empty" id="imageStitchQueueEmpty">
              <i data-lucide="images"></i>
              <strong data-i18n="home.imageStitch.emptyTitle">添加至少两张图片</strong>
              <span data-i18n="home.imageStitch.emptyDesc">支持 JPG、PNG、WebP、BMP 与静态 GIF</span>
            </div>
            <div class="image-stitch-queue" id="imageStitchQueue" aria-live="polite"></div>
          </aside>
        </section>

        <section class="image-stitch-preview-panel" aria-label="长图实时预览">
          <div class="image-stitch-panel-heading">
            <span data-i18n="home.imageStitch.preview">实时预览</span>
            <strong id="imageStitchEstimate">-- × --</strong>
          </div>
          <div class="image-stitch-preview-viewport tk-vertical-stripe-surface" id="imageStitchPreviewViewport">
            <div class="image-stitch-preview-empty" id="imageStitchPreviewEmpty">
              <span>2+</span>
              <p data-i18n="home.imageStitch.previewEmpty">图片会按左侧顺序在这里组合</p>
            </div>
            <div class="image-stitch-preview-composition vertical" id="imageStitchPreview" hidden></div>
          </div>
        </section>

        <aside class="image-stitch-settings" aria-label="Stitch settings">
          <div class="image-stitch-settings-head">
            <span>STITCH OPTIONS</span>
            <strong>参数设置</strong>
          </div>
          <div class="image-stitch-setting-group">
            <span class="image-stitch-setting-label" data-i18n="home.imageStitch.direction">方向</span>
            <div class="audio-convert-format-options" id="imageStitchMode">
              <button class="audio-convert-format-option active" data-mode="vertical" type="button" data-i18n="home.imageStitch.vertical">上下拼接</button>
              <button class="audio-convert-format-option" data-mode="horizontal" type="button" data-i18n="home.imageStitch.horizontal">左右拼接</button>
              <button class="audio-convert-format-option" data-mode="grid-2" type="button">2x2</button>
              <button class="audio-convert-format-option" data-mode="grid-3" type="button">3x3</button>
              <button class="audio-convert-format-option" data-mode="grid-4" type="button">4x4</button>
              <button class="audio-convert-format-option" data-mode="grid-5" type="button">5x5</button>
            </div>
          </div>
          <div class="image-stitch-setting-group">
            <span class="image-stitch-setting-label" data-i18n="home.imageStitch.reference">统一尺寸</span>
            <div class="audio-convert-format-options" id="imageStitchReference">
              <button class="audio-convert-format-option active" data-reference="first" type="button" data-i18n="home.imageStitch.first">首张</button>
              <button class="audio-convert-format-option" data-reference="smallest" type="button" data-i18n="home.imageStitch.smallest">最小</button>
              <button class="audio-convert-format-option" data-reference="largest" type="button" data-i18n="home.imageStitch.largest">最大</button>
            </div>
          </div>
          <div class="image-stitch-settings-grid">
            <label class="image-stitch-number-setting"><span data-i18n="home.imageStitch.spacing">间距</span><span class="image-stitch-number-field"><input id="imageStitchSpacing" type="number" min="0" max="500" value="0"><em>px</em></span></label>
            <label class="image-stitch-number-setting"><span data-i18n="home.imageStitch.scale">比例</span><span class="image-stitch-number-field"><input id="imageStitchScale" type="number" min="10" max="100" value="100"><em>%</em></span></label>
          </div>
          <div class="image-stitch-setting-group">
            <span class="image-stitch-setting-label" data-i18n="home.imageStitch.format">格式</span>
            <div class="audio-convert-format-options" id="imageStitchFormat">
              <button class="audio-convert-format-option active" data-format="png" type="button">PNG</button>
              <button class="audio-convert-format-option" data-format="jpg" type="button">JPG</button>
            </div>
          </div>
          <label class="image-stitch-number-setting" id="imageStitchQualityWrap" hidden><span data-i18n="home.imageStitch.quality">质量</span><span class="image-stitch-number-field"><input id="imageStitchQuality" type="number" min="60" max="100" value="92"><em>%</em></span></label>
          <label class="image-stitch-name-setting"><span data-i18n="home.imageStitch.outputName">文件名</span><input id="imageStitchOutputName" type="text" maxlength="96" placeholder="stitched_image" autocomplete="off" spellcheck="false"></label>
          <footer class="image-stitch-footer">
            <span><i data-lucide="shield-check"></i><span data-i18n="home.imageStitch.local">图片仅在本机处理，源文件不会被修改</span></span>
            <button class="audio-convert-process-btn visible" id="imageStitchExport" type="button" disabled><span data-i18n="home.imageStitch.export">开始拼接</span></button>
          </footer>
        </aside>
      </main>
      <div class="audio-convert-drop-zone pdf-merge-v2-drop-zone" id="imageStitchDropZone"><span class="drop-hint" data-i18n="home.imageStitch.drop">松手即可添加图片</span></div>
      <div class="image-stitch-processing" id="imageStitchProcessing" aria-live="polite">
        <div class="image-stitch-processing-content">
          <div class="tk-mascot-lg" aria-hidden="true"></div>
          <span class="image-stitch-processing-value" id="imageStitchProgressValue">0%</span>
          <div class="audio-convert-process-bar"><div class="audio-convert-process-bar-fill" id="imageStitchProgressFill"></div></div>
          <p id="imageStitchProgressText" data-i18n="home.imageStitch.preparing">正在检查图片...</p>
          <button class="audio-convert-cancel-btn" id="imageStitchCancel" type="button" data-i18n="home.imageStitch.cancel">取消</button>
        </div>
      </div>

    <div class="audio-convert-success-overlay" id="imageStitchSuccessOverlay">
      <div class="audio-convert-success-dialog">
        <div class="audio-convert-success-icon">✓</div>
        <h3 class="audio-convert-success-title" data-i18n="home.imageStitch.successTitle">长图已导出</h3>
        <div class="audio-convert-success-meta" id="imageStitchSuccessMeta"></div>
        <div class="audio-convert-success-detail">
          <div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.imageStitch.finalSize">最终尺寸</span><span class="audio-convert-success-value" id="imageStitchSuccessSize"></span></div>
          <div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.imageStitch.savePath">保存路径</span><span class="audio-convert-success-value" id="imageStitchSuccessPath"></span></div>
        </div>
        <div class="audio-convert-success-actions">
          <button class="audio-convert-success-btn audio-convert-success-btn-secondary" id="imageStitchOpenFolder" type="button" data-i18n="home.imageStitch.openFolder">打开文件夹</button>
          <button class="audio-convert-success-btn audio-convert-success-btn-primary" id="imageStitchSuccessOk" type="button" data-i18n="home.imageStitch.ok">确定</button>
        </div>
      </div>
    </div>
`;

export function imageStitchPageTemplate() {
  return PAGE;
}
