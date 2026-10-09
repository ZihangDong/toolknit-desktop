export function audioExtractTemplate() {
  return `<div class="audio-extract-v2 audio-extract-feature tool-page-v2-shell tool-page-v2-light">
    <div class="plasma-bg pdf-merge-v2-bg" data-audio-extract-bg></div>
    <div class="audio-convert-drop-zone pdf-merge-v2-drop-zone" data-audio-extract-drop-zone>
      <span class="drop-hint" data-audio-extract-text="dropHint">松手即可上传</span>
    </div>
    <header class="pdf-merge-v2-topbar audio-extract-v2-topbar tool-page-v2-topbar" data-tauri-drag-region>
      <div class="settings-v2-topbar-left pdf-merge-v2-topbar-left">
        <button class="settings-v2-back settings-back pdf-merge-v2-back" type="button" data-audio-extract-action="back" data-audio-extract-title="back">
          <i data-lucide="arrow-left"></i><span data-audio-extract-text="back">返回首页</span>
        </button>
        <span class="pdf-merge-v2-top-tag">AUDIO EXTRACTOR · TOOL PAGE 3.1</span>
      </div>
      <div class="home-v2-top-actions pdf-merge-v2-top-actions">
        <button class="home-v2-nav-link" type="button" data-audio-extract-action="website" data-audio-extract-title="website"><i data-lucide="globe-2"></i><span data-audio-extract-text="website">网页版本</span></button>
        <button class="home-v2-support-top" type="button" data-audio-extract-action="support"><i data-lucide="heart"></i><span data-audio-extract-text="support">支持作者</span></button>
        <div class="home-v2-window-cluster" aria-label="窗口与设置">
          <button class="home-v2-icon-button" type="button" data-audio-extract-action="settings" data-audio-extract-title="settings"><i data-lucide="settings"></i></button>
          <div class="home-v2-window-controls" aria-label="窗口控制">
            <button class="home-v2-window-button ctrl-btn" type="button" data-window-action="minimize" data-audio-extract-title="minimize"><i data-lucide="minus"></i></button>
            <button class="home-v2-window-button ctrl-btn" type="button" data-window-action="maximize" data-audio-extract-title="maximize"><i data-lucide="square"></i></button>
            <button class="home-v2-window-button ctrl-btn" type="button" data-window-action="close" data-audio-extract-title="close"><i data-lucide="x"></i></button>
          </div>
        </div>
      </div>
    </header>
    <div class="audio-extract-body pdf-merge-v2-body" data-audio-extract-body>
      <aside class="pdf-merge-v2-poster audio-extract-v2-poster" aria-label="音频提取说明">
        <div class="pdf-merge-v2-poster-kicker" data-audio-extract-text="heroLabel">Audio Extractor</div>
        <h1 class="pdf-merge-v2-title extract-hero-title" data-audio-extract-text="title">音频提取器</h1>
        <p class="pdf-merge-v2-subtitle" data-audio-extract-text="subtitle">从视频文件中提取音轨，保存为独立音频文件，支持 MP4、MKV、AVI、MOV、WebM 等主流视频格式。</p>
        <div class="pdf-merge-v2-poster-note"><span>LOCAL ONLY</span><strong>从视频中剥离音轨，不改动原视频，适合剪辑素材、课程音频和配音整理。</strong></div>
        <div class="pdf-merge-v2-steps" aria-label="提取流程">
          <div class="pdf-merge-v2-step is-active"><span>01</span><div><strong>上传视频</strong><p>选择单个视频文件，自动读取大小、时长与音轨。</p></div></div>
          <div class="pdf-merge-v2-step"><span>02</span><div><strong>选择音轨</strong><p>多音轨视频可指定需要导出的音轨。</p></div></div>
          <div class="pdf-merge-v2-step"><span>03</span><div><strong>选择格式</strong><p>支持 MP3、AAC、WAV、FLAC、OGG 输出。</p></div></div>
          <div class="pdf-merge-v2-step"><span>04</span><div><strong>导出音频</strong><p>输出到 ToolKnit 音频目录，完成后可直接打开文件夹。</p></div></div>
        </div>
      </aside>
      <main class="pdf-merge-v2-workspace audio-extract-v2-workspace">
        <section class="pdf-merge-v2-upload audio-extract-v2-upload" aria-label="上传视频文件">
          <div class="pdf-merge-v2-upload-copy"><span class="pdf-merge-v2-upload-eyebrow">DROP OR SELECT</span><h2>把要提取音频的视频放到这里</h2><p>支持拖拽或点击上传。读取完成后可以选择音轨和输出格式。</p></div>
          <button class="audio-extract-cta audio-convert-cta pdf-merge-v2-cta" type="button" data-audio-extract-action="choose"><i data-lucide="upload"></i><span data-audio-extract-text="cta">上传视频文件</span></button>
        </section>
        <section class="audio-extract-v2-state" aria-label="视频状态">
          <div class="audio-extract-hero-top" data-audio-extract-hero>
            <div class="audio-extract-v2-empty-icon"><i data-lucide="file-video"></i></div><h2>等待选择视频文件</h2><p>选择视频后，ToolKnit 会先探测音轨信息，再允许开始提取。</p>
          </div>
          <div class="audio-extract-info" data-audio-extract-info hidden>
            <div class="audio-extract-info-row"><div class="audio-extract-info-icon"><i data-lucide="file-video"></i></div><div class="audio-extract-info-main"><div class="audio-extract-info-name" data-audio-extract-file-name>--</div><div class="audio-extract-info-meta" data-audio-extract-file-meta>--</div></div><button class="audio-clip-file-remove" type="button" data-audio-extract-action="remove" aria-label="移除文件"><i data-lucide="x"></i></button></div>
            <div class="audio-extract-format-selector"><span class="audio-convert-format-label" data-audio-extract-text="targetFormat">输出格式</span><div class="audio-convert-format-options" data-audio-extract-formats><button class="audio-convert-format-option active" data-format="MP3" type="button">MP3</button><button class="audio-convert-format-option" data-format="AAC" type="button">AAC</button><button class="audio-convert-format-option" data-format="WAV" type="button">WAV</button><button class="audio-convert-format-option" data-format="FLAC" type="button">FLAC</button><button class="audio-convert-format-option" data-format="OGG" type="button">OGG</button></div></div>
            <div class="audio-extract-track-selector" data-audio-extract-track-wrap hidden><label class="audio-extract-track-label" data-audio-extract-text="selectTrack">选择音轨</label><select class="audio-extract-track-select" data-audio-extract-track></select></div>
            <div class="audio-extract-actions"><button class="audio-extract-cta audio-extract-start audio-convert-process-btn pdf-merge-v2-process" type="button" data-audio-extract-action="start" disabled><i data-lucide="audio-lines"></i><span data-audio-extract-text="extractBtn">提取音频</span></button></div>
          </div>
        </section>
        <section class="audio-convert-formats pdf-merge-v2-info audio-extract-v2-info" aria-label="支持视频格式"><h3 class="audio-convert-formats-title" data-audio-extract-text="formatsTitle">支持视频格式</h3><div class="pdf-merge-info-grid"><div class="pdf-merge-info-item"><i data-lucide="film"></i><span>MP4 / MOV / WebM 适合常见视频素材。</span></div><div class="pdf-merge-info-item"><i data-lucide="layers"></i><span>MKV / TS 支持多轨视频，必要时可选择音轨。</span></div><div class="pdf-merge-info-item"><i data-lucide="file-audio"></i><span>MP3 / AAC 适合分享，WAV / FLAC 适合后期。</span></div><div class="pdf-merge-info-item"><i data-lucide="shield"></i><span>纯本地提取，原视频不会被修改。</span></div></div></section>
        <footer class="pdf-merge-v2-actions audio-extract-v2-actions"><span>读取到音轨后即可开始提取，输出会保存到 ToolKnit 音频目录。</span></footer>
      </main>
    </div>
    <div class="audio-convert-process-mask" data-audio-extract-process><div class="tk-mascot-lg" aria-hidden="true"></div><div class="audio-convert-process-bar"><div class="audio-convert-process-bar-fill" data-audio-extract-progress></div></div><div class="audio-convert-process-text" data-audio-extract-process-text>正在提取...</div></div>
    <div class="audio-clip-success-overlay" data-audio-extract-success aria-hidden="true"><div class="audio-clip-success-dialog"><div class="audio-clip-success-icon"><i data-lucide="check"></i></div><h3 class="audio-clip-success-title" data-audio-extract-text="successTitle">提取完成</h3><div class="audio-clip-success-meta" data-audio-extract-success-meta></div><div class="audio-convert-success-detail"><div class="audio-convert-success-row"><span class="audio-convert-success-key" data-audio-extract-text="successSource">源文件</span><span class="audio-convert-success-value" data-audio-extract-success-file></span></div><div class="audio-convert-success-row"><span class="audio-convert-success-key" data-audio-extract-text="successFormat">输出格式</span><span class="audio-convert-success-value" data-audio-extract-success-format></span></div><div class="audio-convert-success-row"><span class="audio-convert-success-key" data-audio-extract-text="successPath">保存路径</span><span class="audio-convert-success-value" data-audio-extract-success-path></span></div></div><div class="audio-clip-success-actions"><button class="audio-clip-success-btn audio-clip-success-btn-secondary" type="button" data-audio-extract-action="open-folder" data-audio-extract-text="openFolder">打开文件夹</button><button class="audio-clip-success-btn audio-clip-success-btn-primary" type="button" data-audio-extract-action="success-ok" data-audio-extract-text="ok">确定</button></div></div></div>
  </div>`;
}
