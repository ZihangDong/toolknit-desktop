export function excelToPdfTemplate() {
  return `
    <div class="plasma-bg pdf-merge-v2-bg excel-pdf-bg" data-excel-bg></div>
    <div class="audio-convert-drop-zone pdf-merge-v2-drop-zone" data-excel-drop-zone>
      <span class="drop-hint" data-excel-text="dropHint">松手即可添加 Excel 工作簿</span>
    </div>
    <header class="pdf-merge-v2-topbar excel-pdf-topbar" data-tauri-drag-region>
      <div class="pdf-merge-v2-topbar-left">
        <button class="settings-v2-back settings-back pdf-merge-v2-back" type="button" data-excel-action="back" data-excel-title="back">
          <i data-lucide="arrow-left"></i><span data-excel-text="back">返回首页</span>
        </button>
        <span class="pdf-merge-v2-top-tag">SPREADSHEET · TOOL PAGE 3.1</span>
      </div>
      <div class="home-v2-top-actions pdf-merge-v2-top-actions">
        <button class="home-v2-nav-link" type="button" data-excel-action="website" data-excel-title="website">
          <i data-lucide="globe-2"></i><span data-excel-text="website">网页版本</span>
        </button>
        <button class="home-v2-support-top" type="button" data-excel-action="support">
          <i data-lucide="heart"></i><span data-excel-text="support">支持作者</span>
        </button>
        <div class="home-v2-window-cluster" aria-label="窗口与设置">
          <button class="home-v2-icon-button" type="button" data-excel-action="settings" data-excel-title="settings"><i data-lucide="settings"></i></button>
          <div class="home-v2-window-controls" aria-label="窗口控制">
            <button class="home-v2-window-button" type="button" data-window-action="minimize" data-excel-title="minimize"><i data-lucide="minus"></i></button>
            <button class="home-v2-window-button" type="button" data-window-action="maximize" data-excel-title="maximize"><i data-lucide="square"></i></button>
            <button class="home-v2-window-button" type="button" data-window-action="close" data-excel-title="close"><i data-lucide="x"></i></button>
          </div>
        </div>
      </div>
    </header>

    <div class="pdf-merge-v2-body excel-pdf-body">
      <aside class="pdf-merge-v2-poster excel-pdf-poster" data-excel-title="title">
        <div class="pdf-merge-v2-poster-kicker" data-excel-text="heroLabel">Workbook Renderer</div>
        <h1 class="pdf-merge-v2-title" data-excel-text="title">Excel 转 PDF</h1>
        <p class="pdf-merge-v2-subtitle" data-excel-text="subtitle">把 Excel 工作簿转换为适合分享、打印和归档的 PDF。</p>
        <div class="pdf-merge-v2-poster-note">
          <span data-excel-text="localLabel">LOCAL RENDER</span>
          <strong data-excel-text="localNote">使用 ToolKnit 的本地 LibreOffice 运行时，文件不会上传服务器。</strong>
        </div>
        <div class="pdf-merge-v2-steps">
          ${[1, 2, 3, 4].map(number => `
            <div class="pdf-merge-v2-step${number === 1 ? ' is-active' : ''}">
              <span>0${number}</span>
              <div><strong data-excel-text="step${number}Title"></strong><p data-excel-text="step${number}Desc"></p></div>
            </div>`).join('')}
        </div>
      </aside>

      <main class="pdf-merge-v2-workspace excel-pdf-workspace">
        <section class="pdf-merge-v2-upload excel-pdf-upload">
          <div class="pdf-merge-v2-upload-copy">
            <span class="pdf-merge-v2-upload-eyebrow" data-excel-text="uploadEyebrow">DROP OR SELECT</span>
            <h2 data-excel-text="uploadTitle">把需要转换的 Excel 放到这里</h2>
            <p data-excel-text="uploadDesc">支持 XLSX、XLS 和 ODS；当前版本用于确认界面与操作流程。</p>
          </div>
          <button class="audio-convert-cta pdf-merge-v2-cta" type="button" data-excel-action="upload">
            <i data-lucide="upload"></i><span data-excel-text="uploadButton">上传 Excel 文件</span>
          </button>
          <input type="file" accept=".xlsx,.xls,.ods" multiple data-excel-input hidden>
        </section>

        <section class="excel-pdf-settings" aria-labelledby="excelPdfSettingsTitle">
          <div class="excel-pdf-settings-head">
            <span class="pdf-merge-v2-section-kicker" data-excel-text="settingsEyebrow">PAGE SETUP</span>
            <h2 id="excelPdfSettingsTitle" data-excel-text="settingsTitle">转换设置</h2>
          </div>
          <div class="excel-pdf-settings-grid">
            <fieldset class="excel-pdf-setting" data-setting-group="sheets">
              <legend data-excel-text="sheetRange">工作表范围</legend>
              <div class="excel-pdf-segment">
                <button class="is-active" type="button" data-setting-value="all" data-excel-text="sheetAll" aria-pressed="true">全部</button>
                <button type="button" data-setting-value="visible" data-excel-text="sheetVisible" aria-pressed="false">仅可见</button>
              </div>
            </fieldset>
            <fieldset class="excel-pdf-setting" data-setting-group="orientation">
              <legend data-excel-text="orientation">页面方向</legend>
              <div class="excel-pdf-segment excel-pdf-segment-three">
                <button class="is-active" type="button" data-setting-value="source" data-excel-text="orientationSource" aria-pressed="true">跟随源文件</button>
                <button type="button" data-setting-value="portrait" data-excel-text="orientationPortrait" aria-pressed="false">纵向</button>
                <button type="button" data-setting-value="landscape" data-excel-text="orientationLandscape" aria-pressed="false">横向</button>
              </div>
            </fieldset>
            <fieldset class="excel-pdf-setting" data-setting-group="paper">
              <legend data-excel-text="paper">纸张</legend>
              <div class="excel-pdf-segment excel-pdf-segment-three">
                <button class="is-active" type="button" data-setting-value="auto" data-excel-text="paperAuto" aria-pressed="true">自动</button>
                <button type="button" data-setting-value="a4" data-excel-text="paperA4" aria-pressed="false">A4</button>
                <button type="button" data-setting-value="letter" data-excel-text="paperLetter" aria-pressed="false">Letter</button>
              </div>
            </fieldset>
            <fieldset class="excel-pdf-setting" data-setting-group="scale">
              <legend data-excel-text="scale">缩放</legend>
              <div class="excel-pdf-segment">
                <button class="is-active" type="button" data-setting-value="fit" data-excel-text="scaleFit" aria-pressed="true">适合页面</button>
                <button type="button" data-setting-value="original" data-excel-text="scaleOriginal" aria-pressed="false">原始比例</button>
              </div>
            </fieldset>
          </div>
        </section>

        <section class="pdf-merge-v2-queue excel-pdf-queue">
          <div class="pdf-merge-v2-section-head">
            <div>
              <span class="pdf-merge-v2-section-kicker" data-excel-text="queueEyebrow">CONVERT QUEUE</span>
              <h2 data-excel-text="queueTitle">待转换工作簿</h2>
            </div>
            <div class="excel-pdf-queue-actions">
              <p data-excel-text="queueDesc">每个工作簿输出一个独立 PDF。</p>
              <button class="excel-pdf-icon-button" type="button" data-excel-action="clear" data-excel-title="clearQueue" hidden><i data-lucide="trash-2"></i></button>
            </div>
          </div>
          <div class="excel-pdf-queue-surface">
            <button class="excel-pdf-empty" type="button" data-excel-action="upload">
              <i data-lucide="file-spreadsheet"></i>
              <strong data-excel-text="queueEmptyTitle">还没有 Excel 文件</strong>
              <span data-excel-text="queueEmptyDesc">点击上传按钮或把工作簿拖到页面中。</span>
            </button>
            <div class="excel-pdf-files" data-excel-files hidden></div>
          </div>
        </section>

        <section class="pdf-merge-v2-info excel-pdf-info">
          <h3 class="audio-convert-formats-title" data-excel-text="formatsTitle">输出说明</h3>
          <div class="pdf-merge-info-grid">
            <div class="pdf-merge-info-item"><i data-lucide="sheet"></i><span data-excel-text="formatTypes">XLSX / XLS / ODS</span></div>
            <div class="pdf-merge-info-item"><i data-lucide="files"></i><span data-excel-text="onePdf">每个工作簿生成一个 PDF</span></div>
            <div class="pdf-merge-info-item"><i data-lucide="type"></i><span data-excel-text="fontNote">字体缺失时版式可能略有变化</span></div>
            <div class="pdf-merge-info-item"><i data-lucide="shield-check"></i><span data-excel-text="privacy">纯本地处理，不上传文件</span></div>
          </div>
        </section>

        <footer class="pdf-merge-v2-actions excel-pdf-actions">
          <span data-excel-status data-excel-text="footerEmpty">添加工作簿并确认页面设置后，即可进入转换流程。</span>
          <button class="audio-convert-process-btn pdf-merge-v2-process" type="button" data-excel-action="convert" hidden disabled>
            <i data-lucide="file-output"></i><span data-excel-text="startButton">开始转换</span>
          </button>
        </footer>
      </main>
    </div>

    <div class="audio-convert-process-mask" data-excel-process>
      <div class="tk-mascot-lg" aria-hidden="true"></div>
      <div class="audio-convert-process-bar">
        <div class="audio-convert-process-bar-fill" data-excel-progress></div>
      </div>
      <div class="audio-convert-process-text" data-excel-process-text></div>
      <button class="audio-convert-cancel-btn" type="button" data-excel-action="cancel" data-excel-text="cancelButton">取消转换</button>
    </div>

    <div class="audio-clip-success-overlay" data-excel-success aria-hidden="true">
      <div class="audio-clip-success-dialog">
        <div class="audio-clip-success-icon"><i data-lucide="check"></i></div>
        <h3 class="audio-clip-success-title" data-excel-text="successTitle">Excel 转 PDF 完成</h3>
        <div class="audio-clip-success-meta" data-excel-success-meta></div>
        <div class="audio-convert-success-detail">
          <div class="audio-convert-success-row">
            <span class="audio-convert-success-key" data-excel-text="successFiles">转换文件</span>
            <span class="audio-convert-success-value" data-excel-success-files></span>
          </div>
          <div class="audio-convert-success-row">
            <span class="audio-convert-success-key" data-excel-text="successPages">PDF 页数</span>
            <span class="audio-convert-success-value" data-excel-success-pages></span>
          </div>
          <div class="audio-convert-success-row">
            <span class="audio-convert-success-key" data-excel-text="successPath">保存位置</span>
            <span class="audio-convert-success-value" data-excel-success-path></span>
          </div>
        </div>
        <div class="audio-clip-success-actions">
          <button class="audio-clip-success-btn audio-clip-success-btn-secondary" type="button" data-excel-action="open-output" data-excel-text="openFolder">打开文件夹</button>
          <button class="audio-clip-success-btn audio-clip-success-btn-primary" type="button" data-excel-action="success-ok" data-excel-text="ok">确定</button>
        </div>
      </div>
    </div>
  `;
}
