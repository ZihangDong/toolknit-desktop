export function teleprompterTemplate() {
  return `
    <div class="plasma-bg teleprompter-bg" data-tele-bg></div>
    <header class="pdf-merge-v2-topbar teleprompter-topbar" data-tauri-drag-region>
      <div class="pdf-merge-v2-topbar-left">
        <button class="settings-v2-back settings-back pdf-merge-v2-back" type="button" data-tele-action="back" data-tele-title="backTitle" title="返回首页">
          <i data-lucide="arrow-left"></i>
          <span data-tele-text="backTitle">返回</span>
        </button>
        <span class="pdf-merge-v2-top-tag">TELEPROMPTER · TOOL PAGE 3.1</span>
      </div>
      <div class="home-v2-top-actions pdf-merge-v2-top-actions teleprompter-top-actions">
        <button class="home-v2-nav-link" type="button" data-tele-action="website" data-tele-title="website">
          <i data-lucide="globe-2"></i><span data-tele-text="website">网页版本</span>
        </button>
        <button class="home-v2-support-top" type="button" data-tele-action="support">
          <i data-lucide="heart"></i><span data-tele-text="support">支持作者</span>
        </button>
        <div class="home-v2-window-cluster" aria-label="窗口与设置">
          <button class="home-v2-icon-button" type="button" data-tele-action="settings" data-tele-title="settingsTitle"><i data-lucide="settings"></i></button>
          <div class="home-v2-window-controls" aria-label="窗口控制">
            <button class="home-v2-window-button" type="button" data-window-action="minimize" data-tele-title="minimize"><i data-lucide="minus"></i></button>
            <button class="home-v2-window-button" type="button" data-window-action="maximize" data-tele-title="maximize"><i data-lucide="square"></i></button>
            <button class="home-v2-window-button" type="button" data-window-action="close" data-tele-title="close"><i data-lucide="x"></i></button>
          </div>
        </div>
      </div>
    </header>
    <button class="teleprompter-focus-exit" type="button" data-tele-action="exit-focus" data-tele-title="exitFocusTitle">
      <kbd>ESC</kbd><span data-tele-text="exitFocus">返回</span>
    </button>

    <div class="teleprompter-body">
      <aside class="teleprompter-poster">
        <span class="teleprompter-kicker">TEXT TOOL / LIVE READING</span>
        <h1 data-tele-text="title">提词器</h1>
        <p class="teleprompter-poster-subtitle" data-tele-text="subtitle">让文稿按你的节奏平稳前进，也可以听着你的声音逐句跟随。</p>
        <div class="teleprompter-local-note">
          <span>LOCAL FIRST</span>
          <strong data-tele-text="localNote">普通滚动完全离线。ToolKnit 离线识别不会上传麦克风音频；系统识别能力由 Windows 环境决定。</strong>
        </div>

        <section class="teleprompter-engine-card">
          <div class="teleprompter-engine-head">
            <strong data-tele-text="voiceEngine">语音引擎</strong>
            <span class="teleprompter-engine-status" data-tele-engine-status data-state="idle">待机</span>
          </div>
          <label>
            <span data-tele-text="engineLabel">跟随方式</span>
            <select class="teleprompter-engine-select" data-tele-engine>
              <option value="auto" data-tele-option="engineAuto">自动选择</option>
              <option value="system" data-tele-option="engineSystem">Windows 系统识别</option>
              <option value="offline" data-tele-option="engineOffline">ToolKnit 离线识别</option>
            </select>
          </label>
          <p class="teleprompter-engine-help" data-tele-engine-help></p>
          <div class="teleprompter-switch-row">
            <div class="teleprompter-switch-copy"><strong data-tele-text="voiceFollow">语音跟随</strong><span data-tele-text="voiceFollowHint">按句匹配，不做跳动的逐字追踪</span></div>
            <button class="teleprompter-switch" type="button" data-tele-action="voice" aria-pressed="false" data-tele-title="voiceFollow"></button>
          </div>
        </section>

        <div class="teleprompter-steps">
          <div class="teleprompter-step"><span>01</span><div><strong data-tele-text="step1Title">准备文稿</strong><p data-tele-text="step1Desc">粘贴或读取 TXT、Markdown、DOCX、PDF。</p></div></div>
          <div class="teleprompter-step"><span>02</span><div><strong data-tele-text="step2Title">调整节奏</strong><p data-tele-text="step2Desc">设置速度、字号和镜像方向。</p></div></div>
          <div class="teleprompter-step"><span>03</span><div><strong data-tele-text="step3Title">开始提示</strong><p data-tele-text="step3Desc">播放后说明栏自动收起，注意力留给文稿。</p></div></div>
        </div>
      </aside>

      <main class="teleprompter-workspace">
        <section class="teleprompter-editor">
          <div class="teleprompter-panel-head">
            <div><span class="teleprompter-section-kicker">SCRIPT</span><h2 data-tele-text="scriptTitle">台词内容</h2></div>
            <div class="teleprompter-editor-actions">
              <button class="teleprompter-small-button" type="button" data-tele-action="upload"><i data-lucide="file-up"></i><span data-tele-text="upload">读取文稿</span></button>
              <button class="teleprompter-small-button" type="button" data-tele-action="clear"><i data-lucide="trash-2"></i><span data-tele-text="clear">清空</span></button>
            </div>
          </div>
          <input type="file" data-tele-file accept=".txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.docx,.pdf,text/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden>
          <div class="teleprompter-drop-card">
            <div><span class="teleprompter-drop-label">DROP OR SELECT</span><p data-tele-text="dropHint">把文稿拖进来，或直接在下方输入。文件内容只在本机读取。</p></div>
            <span class="teleprompter-small-button" aria-hidden="true"><i data-lucide="text-cursor-input"></i><span data-tele-file-name data-tele-text="manualInput">手动输入</span></span>
          </div>
          <textarea class="teleprompter-input tk-vertical-stripe-surface" data-tele-input data-tele-placeholder="placeholder" spellcheck="true"></textarea>
          <div class="teleprompter-editor-footer">
            <div class="teleprompter-script-meta"><strong data-tele-count>0</strong><span data-tele-text="characters">字符</span><span>·</span><strong data-tele-duration>00:00</strong></div>
            <span class="teleprompter-current-copy" data-tele-current-copy data-tele-text="notStarted">尚未开始</span>
          </div>
        </section>

        <section class="teleprompter-stage">
          <div class="teleprompter-panel-head">
            <div><span class="teleprompter-section-kicker">PROMPT VIEW</span><h2 data-tele-text="previewTitle">提词显示</h2></div>
            <div class="teleprompter-stage-actions">
              <span class="teleprompter-stage-status" data-tele-play-status data-tele-text="ready">准备就绪</span>
              <button class="teleprompter-small-button" type="button" data-tele-action="focus"><i data-lucide="maximize-2"></i><span data-tele-text="focus">专注模式</span></button>
            </div>
          </div>
          <div class="teleprompter-screen" data-tele-screen>
            <div class="teleprompter-focus-band"></div>
            <div class="teleprompter-screen-fade is-top"></div>
            <div class="teleprompter-screen-fade is-bottom"></div>
            <div class="teleprompter-scroll" data-tele-scroll tabindex="0">
              <div class="teleprompter-scroll-content" data-tele-content></div>
            </div>
            <div class="teleprompter-empty" data-tele-empty><div><i data-lucide="captions"></i><strong data-tele-text="emptyTitle">等待文稿</strong><span data-tele-text="emptyDesc">输入台词后，这里会生成适合远距离阅读的提词画面。</span></div></div>
          </div>
          <div class="teleprompter-progress-row"><span data-tele-elapsed>00:00</span><div class="teleprompter-progress-track"><span data-tele-progress></span></div><span data-tele-remaining>00:00</span></div>
        </section>

        <footer class="teleprompter-controls" aria-label="提词器控制栏">
          <div class="teleprompter-control-group">
            <button class="teleprompter-control-button" type="button" data-tele-action="reset" data-tele-title="reset"><i data-lucide="rotate-ccw"></i></button>
            <button class="teleprompter-control-button" type="button" data-tele-action="previous" data-tele-title="previous"><i data-lucide="skip-back"></i></button>
            <button class="teleprompter-control-button" type="button" data-tele-action="next" data-tele-title="next"><i data-lucide="skip-forward"></i></button>
          </div>
          <div class="teleprompter-control-group is-center">
            <span class="teleprompter-control-icon" aria-hidden="true"><i data-lucide="gauge"></i></span>
            <div class="teleprompter-wave-slot" data-tele-speed-slider></div>
            <button class="teleprompter-control-button teleprompter-play-button" type="button" data-tele-action="play" data-tele-title="play"><i data-lucide="play"></i></button>
          </div>
          <div class="teleprompter-control-group is-end">
            <span class="teleprompter-control-icon" aria-hidden="true"><i data-lucide="a-large-small"></i></span>
            <div class="teleprompter-wave-slot" data-tele-font-slider></div>
            <span class="teleprompter-control-separator"></span>
            <button class="teleprompter-control-button" type="button" data-tele-action="mirror-x" data-tele-title="mirrorX"><i data-lucide="flip-horizontal-2"></i></button>
            <button class="teleprompter-control-button" type="button" data-tele-action="mirror-y" data-tele-title="mirrorY"><i data-lucide="flip-vertical-2"></i></button>
          </div>
        </footer>
      </main>
    </div>
  `;
}
