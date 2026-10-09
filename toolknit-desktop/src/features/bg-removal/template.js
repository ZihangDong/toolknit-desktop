export function bgRemovalTemplate() {
  return `
    <div class="plasma-bg bg-removal-bg" data-bgr-bg></div>
    <header class="pdf-merge-v2-topbar bg-removal-topbar" data-tauri-drag-region>
      <div class="pdf-merge-v2-topbar-left">
        <button class="settings-v2-back settings-back pdf-merge-v2-back" type="button" data-bgr-action="back" data-bgr-title="backTitle" title="返回">
          <i data-lucide="arrow-left"></i><span data-bgr-text="backTitle">返回</span>
        </button>
        <span class="pdf-merge-v2-top-tag">BACKGROUND REMOVAL · TOOL PAGE 3.1</span>
      </div>
      <div class="home-v2-top-actions pdf-merge-v2-top-actions">
        <button class="home-v2-nav-link" type="button" data-bgr-action="website" data-bgr-title="website">
          <i data-lucide="globe-2"></i><span data-bgr-text="website">网页版本</span>
        </button>
        <button class="home-v2-support-top" type="button" data-bgr-action="support">
          <i data-lucide="heart"></i><span data-bgr-text="support">支持作者</span>
        </button>
        <div class="home-v2-window-cluster" aria-label="窗口与设置">
          <button class="home-v2-icon-button" type="button" data-bgr-action="settings" data-bgr-title="settingsTitle"><i data-lucide="settings"></i></button>
          <div class="home-v2-window-controls" aria-label="窗口控制">
            <button class="home-v2-window-button" type="button" data-window-action="minimize" data-bgr-title="minimize"><i data-lucide="minus"></i></button>
            <button class="home-v2-window-button" type="button" data-window-action="maximize" data-bgr-title="maximize"><i data-lucide="square"></i></button>
            <button class="home-v2-window-button" type="button" data-window-action="close" data-bgr-title="close"><i data-lucide="x"></i></button>
          </div>
        </div>
      </div>
    </header>

    <div class="bg-removal-body" data-bgr-body>
      <button class="bg-removal-drawer-scrim" type="button" data-bgr-action="close-params" data-bgr-title="closeParams" tabindex="-1" hidden></button>
      <aside class="bg-removal-panel" data-bgr-params data-bgr-title="params" aria-label="处理参数">
        <div class="bg-removal-drawer-head">
          <span data-bgr-text="params">处理参数</span>
          <button class="bg-removal-icon-button" type="button" data-bgr-action="close-params" data-bgr-title="closeParams"><i data-lucide="x"></i></button>
        </div>
        <div class="bg-removal-intro">
          <span class="bg-removal-kicker">IMAGE TOOL / AI CUTOUT</span>
          <h1 class="bg-removal-title" data-bgr-text="title">背景移除</h1>
          <p class="bg-removal-subtitle" data-bgr-text="subtitle">AI 一键抠出主体，发丝级边缘，导出透明 PNG。</p>
        </div>
        <div class="bg-removal-note">
          <i data-lucide="shield-check"></i>
          <span data-bgr-text="localNote">推理在本机完成，照片不会上传。</span>
        </div>

        <section class="bg-removal-file-section" aria-labelledby="bgRemovalFileHeading">
          <div class="bg-removal-section-row">
            <span id="bgRemovalFileHeading" class="bg-removal-field-label" data-bgr-text="fileInfo">图片信息</span>
            <span class="bg-removal-file-badge" data-bgr-file-badge>—</span>
          </div>
          <div class="bg-removal-file-empty" data-bgr-file-empty data-bgr-text="noImage">尚未选择图片</div>
          <dl class="bg-removal-file-details" data-bgr-file-details hidden>
            <div><dt data-bgr-text="imageName">文件</dt><dd data-bgr-file-name></dd></div>
            <div><dt data-bgr-text="imageSize">尺寸</dt><dd data-bgr-file-size></dd></div>
            <div><dt data-bgr-text="fileSize">大小</dt><dd data-bgr-file-bytes></dd></div>
          </dl>
          <button class="bg-removal-upload" type="button" data-bgr-action="upload">
            <i data-lucide="image-up"></i><span data-bgr-upload-label data-bgr-text="upload">选择图片</span>
          </button>
        </section>

        <section class="bg-removal-parameters">
          <div>
            <div class="bg-removal-section-row">
              <label class="bg-removal-field-label" for="bgRemovalModel" data-bgr-text="modelLabel">抠图模型</label>
              <button class="bg-removal-link-button" type="button" data-bgr-action="manage-models">
                <i data-lucide="box"></i><span data-bgr-text="manageModels">管理模型</span>
              </button>
            </div>
            <select id="bgRemovalModel" class="bg-removal-select" data-bgr-model></select>
          </div>
          <div>
            <label class="bg-removal-field-label" for="bgRemovalFeather" data-bgr-text="featherLabel">边缘羽化</label>
            <div class="bg-removal-slider-row">
              <input id="bgRemovalFeather" class="bg-removal-slider" data-bgr-feather type="range" min="0" max="8" step="0.2" value="1.2">
              <span class="bg-removal-slider-value" data-bgr-feather-value>1.2px</span>
            </div>
          </div>
        </section>

        <div class="bg-removal-status" data-bgr-status data-state="idle" role="status" aria-live="polite"><span></span></div>
        <button class="bg-removal-process" type="button" data-bgr-action="process" disabled>
          <i data-lucide="wand-sparkles"></i><span data-bgr-process-label data-bgr-text="startCutout">开始抠图</span>
        </button>
      </aside>

      <main class="bg-removal-stage">
        <div class="bg-removal-panel-head">
          <div><span class="bg-removal-section-kicker">AI CUTOUT</span><h2 data-bgr-text="previewTitle">透明预览</h2></div>
          <button class="bg-removal-params-button" type="button" data-bgr-action="open-params">
            <i data-lucide="sliders-horizontal"></i><span data-bgr-text="params">处理参数</span>
          </button>
        </div>

        <div class="bg-removal-screen" data-bgr-screen data-state="empty" data-processed="false">
          <div class="bg-removal-viewport" data-bgr-viewport>
            <div class="bg-removal-canvas-stack" data-bgr-canvas-stack hidden>
              <canvas class="bg-removal-canvas-original" data-bgr-canvas-original></canvas>
              <canvas class="bg-removal-canvas-result" data-bgr-canvas-result></canvas>
            </div>
          </div>

          <button class="bg-removal-empty tk-empty-hero" type="button" data-bgr-empty data-bgr-action="upload">
            <span class="bg-removal-empty-icon tk-empty-hero-icon"><i data-lucide="image-up"></i></span>
            <span class="tk-empty-hero-kicker">LOCAL AI WORKSPACE</span>
            <strong data-bgr-text="emptyTitle">选择一张图片开始</strong>
            <span class="tk-empty-hero-description" data-bgr-text="emptyDesc">支持 JPG、PNG、WebP、BMP，也可以直接拖入。</span>
            <em><i data-lucide="upload"></i><span data-bgr-text="emptyAction">选择图片</span></em>
          </button>

          <div class="bg-removal-progress" data-bgr-progress hidden>
            <span class="bg-removal-spinner" aria-hidden="true"></span>
            <strong data-bgr-progress-title></strong>
            <span data-bgr-text="processingHint">推理完全在本机进行，请保持窗口开启。</span>
          </div>

          <div class="bg-removal-toolbar" data-bgr-toolbar hidden>
            <button class="bg-removal-tool-btn" type="button" data-bgr-tool="pan" data-bgr-title="pan"><i data-lucide="hand"></i></button>
            <span class="bg-removal-tool-divider"></span>
            <button class="bg-removal-tool-btn" type="button" data-bgr-tool="restore" data-bgr-title="restore"><i data-lucide="brush"></i></button>
            <button class="bg-removal-tool-btn" type="button" data-bgr-tool="erase" data-bgr-title="erase"><i data-lucide="eraser"></i></button>
            <span class="bg-removal-tool-divider"></span>
            <button class="bg-removal-tool-btn" type="button" data-bgr-action="undo" data-bgr-title="undo"><i data-lucide="undo-2"></i></button>
            <button class="bg-removal-tool-btn" type="button" data-bgr-action="redo" data-bgr-title="redo"><i data-lucide="redo-2"></i></button>
            <button class="bg-removal-tool-btn" type="button" data-bgr-action="reset-edits" data-bgr-title="resetEdits"><i data-lucide="rotate-ccw"></i></button>
            <div class="bg-removal-brush-wrap" data-bgr-brush-wrap>
              <button class="bg-removal-tool-btn is-size" type="button" data-bgr-action="brush-size" data-bgr-title="brushSize"><i data-lucide="circle"></i></button>
              <div class="bg-removal-brush-pop" data-bgr-brush-pop hidden>
                <span data-bgr-text="brushSize">笔刷粗细</span>
                <input class="bg-removal-slider" data-bgr-brush-size type="range" min="4" max="160" step="2" value="36">
                <span class="bg-removal-slider-value" data-bgr-brush-size-value>36px</span>
              </div>
            </div>
          </div>

          <div class="bg-removal-zoombar" data-bgr-zoombar hidden>
            <button class="bg-removal-tool-btn" type="button" data-bgr-action="zoom-out" data-bgr-title="zoomOut"><i data-lucide="minus"></i></button>
            <span class="bg-removal-zoom-value" data-bgr-zoom-value>100%</span>
            <button class="bg-removal-tool-btn" type="button" data-bgr-action="zoom-in" data-bgr-title="zoomIn"><i data-lucide="plus"></i></button>
            <button class="bg-removal-tool-btn" type="button" data-bgr-action="zoom-fit" data-bgr-title="zoomFit"><i data-lucide="scan"></i></button>
            <span class="bg-removal-tool-divider"></span>
            <button class="bg-removal-tool-btn is-compare" type="button" data-bgr-action="compare" data-bgr-title="holdCompare" aria-pressed="false"><i data-lucide="eye"></i></button>
          </div>
        </div>

        <footer class="bg-removal-footer">
          <button class="bg-removal-small-button is-primary" type="button" data-bgr-action="save" hidden>
            <i data-lucide="download"></i><span data-bgr-save-label data-bgr-text="savePng">保存透明 PNG</span>
          </button>
        </footer>
      </main>
    </div>

    <div class="audio-clip-success-overlay bg-removal-success-overlay" data-bgr-success aria-hidden="true" inert>
      <div class="audio-clip-success-dialog" role="dialog" aria-modal="true" aria-labelledby="bgRemovalSuccessTitle">
        <div class="audio-clip-success-icon"><i data-lucide="check"></i></div>
        <h3 class="audio-clip-success-title" id="bgRemovalSuccessTitle" data-bgr-text="doneTitle">背景移除完成</h3>
        <div class="audio-clip-success-meta" data-bgr-text="doneMeta">透明 PNG 已保存到本机。</div>
        <div class="audio-convert-success-detail">
          <div class="audio-convert-success-row">
            <span class="audio-convert-success-key" data-bgr-text="doneFileLabel">输出文件</span>
            <span class="audio-convert-success-value" data-bgr-success-file></span>
          </div>
          <div class="audio-convert-success-row">
            <span class="audio-convert-success-key" data-bgr-text="donePathLabel">保存路径</span>
            <span class="audio-convert-success-value" data-bgr-success-path></span>
          </div>
        </div>
        <div class="audio-clip-success-actions">
          <button class="audio-clip-success-btn audio-clip-success-btn-secondary" type="button" data-bgr-action="open-folder" data-bgr-text="openFolder">打开文件夹</button>
          <button class="audio-clip-success-btn audio-clip-success-btn-primary" type="button" data-bgr-action="success-ok" data-bgr-text="ok">确定</button>
        </div>
      </div>
    </div>
  `;
}
