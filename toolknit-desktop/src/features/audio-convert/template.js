export function audioConvertTemplate() {
  return String.raw`
<div class="pdf-merge-overlay pdf-merge-v2 audio-convert-v2 audio-convert-overlay audio-convert-feature" data-audio-convert-page>
  <div class="plasma-bg pdf-merge-v2-bg" data-audio-convert-bg></div>
  <div class="audio-convert-drop-zone pdf-merge-v2-drop-zone" data-audio-convert-drop-zone><span class="drop-hint" data-i18n="home.audioConvert.dropHint">松手即可上传</span></div>
  <header class="pdf-merge-v2-topbar audio-convert-v2-topbar">
    <div class="pdf-merge-v2-topbar-left audio-convert-v2-topbar-left">
        <button class="settings-v2-back settings-back pdf-merge-v2-back" type="button" data-audio-convert-action="back" data-i18n-title="settings.back" title="返回首页">
        <i data-lucide="arrow-left"></i>
        <span data-i18n="settings.back">返回首页</span>
      </button>
      <span class="pdf-merge-v2-top-tag audio-convert-v2-top-tag">AUDIO TOOLS · TOOL PAGE 3.1</span>
    </div>
    <div class="home-v2-top-actions pdf-merge-v2-top-actions">
        <button class="home-v2-nav-link" type="button" data-audio-convert-action="website">
        <i data-lucide="globe-2"></i>
        <span>网页版本</span>
      </button>
        <button class="home-v2-support-top" type="button" data-audio-convert-action="support">
        <i data-lucide="heart"></i>
        <span>支持作者</span>
      </button>
      <div class="home-v2-window-cluster" aria-label="窗口与设置">
        <button class="home-v2-icon-button" type="button" data-audio-convert-action="settings" data-i18n-title="nav.settings" title="设置" aria-label="设置">
          <i data-lucide="settings"></i>
        </button>
        <div class="home-v2-window-controls" aria-label="窗口控制">
          <button class="home-v2-window-button ctrl-btn" type="button" data-i18n-title="common.minimize" title="最小化" data-window-action="minimize"><i data-lucide="minus"></i></button>
          <button class="home-v2-window-button ctrl-btn" type="button" data-i18n-title="common.maximize" title="最大化" data-window-action="maximize"><i data-lucide="square"></i></button>
          <button class="home-v2-window-button ctrl-btn" type="button" data-i18n-title="common.close" title="关闭" data-window-action="close"><i data-lucide="x"></i></button>
        </div>
      </div>
    </div>
  </header>
  <div class="pdf-merge-v2-body audio-convert-v2-body" data-audio-convert-body>
    <aside class="pdf-merge-v2-poster audio-convert-v2-poster" aria-label="音频格式转换说明">
      <div class="pdf-merge-v2-poster-kicker" data-i18n="home.audioConvert.heroLabel">Audio Format Converter</div>
      <h1 class="pdf-merge-v2-title" data-i18n="home.audioConvert.title">音频文件格式转换</h1>
      <p class="pdf-merge-v2-subtitle" data-i18n="home.audioConvert.subtitle">支持 MP3、AAC、WAV、FLAC、ALAC、OGG、WMA 七种主流音频格式互转，批量处理一键完成。</p>
      <div class="pdf-merge-v2-poster-note">
        <span>LOCAL ONLY</span>
        <strong>音频在本机完成解码与转码，适合批量整理素材、播客、配音和音乐文件。</strong>
      </div>
      <div class="pdf-merge-v2-steps" aria-label="转换流程">
        <div class="pdf-merge-v2-step is-active">
          <span>01</span>
          <div><strong>添加音频</strong><p>拖入或选择多个音频文件，自动进入转换队列。</p></div>
        </div>
        <div class="pdf-merge-v2-step">
          <span>02</span>
          <div><strong>选择格式</strong><p>目标格式支持 MP3、AAC、WAV、FLAC、ALAC、OGG。</p></div>
        </div>
        <div class="pdf-merge-v2-step">
          <span>03</span>
          <div><strong>批量处理</strong><p>保持队列顺序，统一输出到 ToolKnit 音频目录。</p></div>
        </div>
        <div class="pdf-merge-v2-step">
          <span>04</span>
          <div><strong>查看结果</strong><p>完成后可直接打开输出文件夹。</p></div>
        </div>
      </div>
    </aside>
    <main class="pdf-merge-v2-workspace audio-convert-v2-workspace">
      <section class="pdf-merge-v2-upload audio-convert-v2-upload" aria-label="上传音频文件">
        <div class="pdf-merge-v2-upload-copy">
          <span class="pdf-merge-v2-upload-eyebrow">DROP OR SELECT</span>
          <h2>把需要转换的音频放到这里</h2>
          <p>支持拖拽或点击上传，上传后进入队列，再选择目标格式统一转码。</p>
        </div>
        <button class="audio-convert-cta pdf-merge-v2-cta" type="button" data-audio-convert-action="choose">
          <i data-lucide="upload"></i>
          <span data-i18n="home.audioConvert.cta">上传音频文件</span>
        </button>
      </section>
      <section class="pdf-merge-v2-options audio-convert-v2-options" aria-label="转换参数">
        <div class="audio-convert-format-selector">
          <span class="audio-convert-format-label" data-i18n="home.audioConvert.targetFormat">目标格式</span>
          <div class="audio-convert-format-options" data-audio-convert-formats>
            <button class="audio-convert-format-option active" type="button" data-format="MP3">MP3</button>
            <button class="audio-convert-format-option" type="button" data-format="AAC">AAC</button>
            <button class="audio-convert-format-option" type="button" data-format="WAV">WAV</button>
            <button class="audio-convert-format-option" type="button" data-format="FLAC">FLAC</button>
            <button class="audio-convert-format-option" type="button" data-format="ALAC">ALAC</button>
            <button class="audio-convert-format-option" type="button" data-format="OGG">OGG</button>
          </div>
        </div>
        <div class="pdf-merge-v2-options-hint">WMA 可作为源文件读取；如需无损存档优先选择 FLAC / ALAC / WAV。</div>
      </section>
      <section class="pdf-merge-v2-queue audio-convert-v2-queue" aria-label="待转换音频">
        <div class="pdf-merge-v2-section-head">
          <div>
            <span class="pdf-merge-v2-section-kicker">CONVERT QUEUE</span>
            <h2>待转换音频</h2>
          </div>
          <p>支持拖拽调整顺序，批量任务会按队列顺序处理。</p>
        </div>
        <div class="audio-convert-files pdf-merge-v2-files audio-convert-v2-files" data-audio-convert-files></div>
      </section>
      <section class="audio-convert-formats pdf-merge-v2-info audio-convert-v2-info" aria-label="支持格式">
        <h3 class="audio-convert-formats-title" data-i18n="home.audioConvert.formatsTitle">支持格式</h3>
        <div class="pdf-merge-info-grid">
          <div class="pdf-merge-info-item"><i data-lucide="music-2"></i><span>MP3 / AAC / OGG 适合通用播放和压缩分发</span></div>
          <div class="pdf-merge-info-item"><i data-lucide="audio-lines"></i><span>WAV / FLAC / ALAC 适合无损保存和后期处理</span></div>
          <div class="pdf-merge-info-item"><i data-lucide="file-audio"></i><span data-i18n="home.audioConvert.mapText">六种格式可互相转换，WMA 仅支持作为源文件读取</span></div>
          <div class="pdf-merge-info-item"><i data-lucide="shield"></i><span>纯本地处理，源文件不会上传也不会被修改</span></div>
        </div>
      </section>
      <footer class="pdf-merge-v2-actions audio-convert-v2-actions">
        <span>确认文件和目标格式后开始处理，完成后会自动弹出结果提示。</span>
        <button class="audio-convert-process-btn pdf-merge-v2-process" type="button" data-audio-convert-action="start" data-i18n="home.audioConvert.processBtn" style="display:none;">开始处理</button>
      </footer>
    </main>
  </div>
  <div class="audio-convert-process-mask" data-audio-convert-process>
  <div class="tk-mascot-lg" aria-hidden="true"></div>
  <div class="audio-convert-process-bar">
    <div class="audio-convert-process-bar-fill" data-audio-convert-progress></div>
  </div>
  <div class="audio-convert-process-text" data-audio-convert-process-text data-i18n="home.audioConvert.processing">正在处理...</div>
  <button class="audio-convert-cancel-btn" type="button" data-audio-convert-action="cancel" data-i18n="home.audioConvert.cancel">取消</button>
</div>

<div class="audio-convert-success-overlay" data-audio-convert-success>
  <div class="audio-convert-success-dialog">
    <div class="audio-convert-success-icon">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
    </div>
    <h3 class="audio-convert-success-title" data-i18n="home.audioConvert.successTitle">处理成功</h3>
    <div class="audio-convert-success-meta" data-audio-convert-success-meta></div>
    <div class="audio-convert-success-detail">
      <div class="audio-convert-success-row">
        <span class="audio-convert-success-key" data-i18n="home.audioConvert.successTarget">目标格式</span>
        <span class="audio-convert-success-value" data-audio-convert-success-format></span>
      </div>
      <div class="audio-convert-success-row">
        <span class="audio-convert-success-key" data-i18n="home.audioConvert.successCount">处理文件</span>
        <span class="audio-convert-success-value" data-audio-convert-success-count></span>
      </div>
      <div class="audio-convert-success-row">
        <span class="audio-convert-success-key" data-i18n="home.audioConvert.successPath">保存路径</span>
        <span class="audio-convert-success-value" data-audio-convert-success-path></span>
      </div>

    </div>
    <div class="audio-convert-success-actions">
      <button class="audio-convert-success-btn audio-convert-success-btn-secondary" type="button" data-audio-convert-action="open-folder" data-i18n="home.audioConvert.openFolder">打开文件夹</button>
      <button class="audio-convert-success-btn audio-convert-success-btn-primary" type="button" data-audio-convert-action="success-ok" data-i18n="home.audioConvert.ok">确定</button>
    </div>
  </div>
</div>
  </div>
  `;
}
