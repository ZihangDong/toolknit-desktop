const text = key => `<span data-i18n="home.pdfScan.${key}"></span>`;
const button = (id, icon, key, extra = '') => `<button id="${id}" class="pdf-editor-tool" type="button" ${extra}><i data-lucide="${icon}"></i>${text(key)}</button>`;
export default `
<div id="pdfScanOverlay" class="pdf-scan" role="dialog" aria-modal="true" aria-label="" aria-hidden="true" inert>
  <button id="pdfScanBack" type="button"></button><div id="pdfScanPages"></div>
  <div id="pdfScanUpload" class="pdf-merge-v2-body">
    <aside class="pdf-merge-v2-poster">
      <div class="pdf-merge-v2-poster-kicker">PDF TO SCAN</div>
      <h1 class="pdf-merge-v2-title" data-i18n="home.pdfScan.title"></h1>
      <p class="pdf-merge-v2-subtitle" data-i18n="home.pdfScan.subtitle"></p>
      <div class="pdf-merge-v2-poster-note"><span>LOCAL ONLY</span><strong data-i18n="home.pdfScan.local"></strong></div>
      <div class="pdf-merge-v2-steps">
        <div class="pdf-merge-v2-step is-active"><span>01</span><div><strong data-i18n="home.pdfScan.pick"></strong><p data-i18n="home.pdfScan.inputLimit"></p></div></div>
        <div class="pdf-merge-v2-step"><span>02</span><div><strong data-i18n="home.pdfScan.preview"></strong><p data-i18n="home.pdfScan.previewHint"></p></div></div>
        <div class="pdf-merge-v2-step"><span>03</span><div><strong data-i18n="home.pdfScan.export"></strong><p data-i18n="home.pdfScan.outputHint"></p></div></div>
      </div>
    </aside>
    <main class="pdf-merge-v2-workspace pdf-scan-empty-workspace">
      <section class="pdf-scan-empty-state">
        <div class="pdf-scan-empty-mark" aria-hidden="true"><i data-lucide="file-scan"></i><span><i data-lucide="arrow-right"></i><i data-lucide="file-image"></i></span></div>
        <div class="pdf-scan-empty-copy"><span class="pdf-merge-v2-upload-eyebrow">PDF / SCAN</span><h2 data-i18n="home.pdfScan.emptyHint"></h2><p data-i18n="home.pdfScan.defaultHint"></p></div>
        <button id="pdfScanPick" class="audio-convert-cta pdf-merge-v2-cta" type="button"><i data-lucide="upload"></i>${text('pick')}</button>
        <p class="pdf-scan-empty-limit" data-i18n="home.pdfScan.emptyLimit"></p>
        <section class="pdf-scan-upload-info">
          <div><i data-lucide="scan"></i><strong data-i18n="home.pdfScan.faithful"></strong><p data-i18n="home.pdfScan.faithfulHint"></p></div>
          <div><i data-lucide="contrast"></i><strong data-i18n="home.pdfScan.grayscale"></strong><p data-i18n="home.pdfScan.grayscaleHint"></p></div>
          <div><i data-lucide="file-image"></i><strong data-i18n="home.pdfScan.natural"></strong><p data-i18n="home.pdfScan.naturalHint"></p></div>
        </section>
        <p class="pdf-scan-empty-note" data-i18n="home.pdfScan.warning"></p>
      </section>
      <p id="pdfScanUploadStatus" role="status" aria-live="polite"></p>
    </main>
  </div>
  <div id="pdfScanActions" class="pdf-workbench-actions">
    <section class="pdf-scan-section"><strong data-i18n="home.pdfScan.mode"></strong>
      <div class="pdf-scan-modes" role="group" data-i18n-aria-label="home.pdfScan.mode">
        ${button('pdfScanFaithful', 'scan', 'faithful', 'data-scan-mode="faithful"')}
        ${button('pdfScanGrayscale', 'contrast', 'grayscale', 'data-scan-mode="grayscale"')}
        ${button('pdfScanNatural', 'file-image', 'natural', 'data-scan-mode="natural"')}
      </div><p id="pdfScanModeHint" class="pdf-scan-hint"></p>
    </section>
    <section class="pdf-scan-section"><strong data-i18n="home.pdfScan.resolution"></strong>
      <div class="pdf-scan-segments" role="group" data-i18n-aria-label="home.pdfScan.resolution">
        <button type="button" class="pdf-editor-tool" data-scan-dpi="150">150 DPI</button><button type="button" class="pdf-editor-tool" data-scan-dpi="200">200 DPI</button><button type="button" class="pdf-editor-tool" data-scan-dpi="300">300 DPI</button>
      </div>
    </section>
    <details id="pdfScanAdvanced"><summary data-i18n="home.pdfScan.advanced"></summary>
      <label class="pdf-scan-slider">${text('noise')}<output id="pdfScanNoiseValue"></output><input id="pdfScanNoise" type="range" min="0" max="8" step="1" value="2"></label>
      <label class="pdf-scan-slider">${text('warmth')}<output id="pdfScanWarmthValue"></output><input id="pdfScanWarmth" type="range" min="0" max="10" step="1" value="3"></label>
      <label class="pdf-scan-slider">${text('skew')}<output id="pdfScanSkewValue"></output><input id="pdfScanSkew" type="range" min="0" max="0.8" step="0.05" value="0.25"></label>
    </details>
    <section class="pdf-scan-section"><label for="pdfScanRange" data-i18n="home.pdfScan.range"></label>
      <div class="pdf-scan-range"><input id="pdfScanRange" type="text" placeholder="1-3, 5" maxlength="600">${button('pdfScanApplyRange', 'check', 'apply')}</div>
      <div class="pdf-scan-segments">${button('pdfScanAll', 'check-check', 'all')}${button('pdfScanNone', 'square', 'none')}</div>
      <span id="pdfScanSelected" class="pdf-scan-hint"></span>
    </section>
    <p id="pdfScanStatus" class="pdf-scan-hint" role="status" aria-live="polite"></p>
    <div class="pdf-workbench-export"><p class="pdf-scan-warning" data-i18n="home.pdfScan.warning"></p>
      ${button('pdfScanExport', 'download', 'export', 'data-export-primary')}
      ${button('pdfScanReset', 'file-plus-2', 'replace')}
    </div>
  </div>
  <input id="pdfScanFileInput" type="file" accept="application/pdf,.pdf" hidden>
</div>
<div id="pdfScanProcessOverlay" class="audio-convert-process-mask" role="dialog" aria-modal="true" aria-labelledby="pdfScanProgressTitle" aria-hidden="true" inert>
  <div class="audio-convert-process-spinner"></div><div id="pdfScanProgressTitle" class="audio-convert-process-text"></div>
  <div class="audio-convert-process-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-i18n-aria-label="home.pdfScan.progress"><div id="pdfScanProgressFill" class="audio-convert-process-bar-fill"></div></div>
  <button id="pdfScanCancel" class="audio-convert-cancel-btn" type="button"><i data-lucide="x"></i>${text('cancel')}</button>
</div>
<div id="pdfScanPasswordOverlay" class="audio-clip-success-overlay" role="dialog" aria-modal="true" aria-labelledby="pdfScanPasswordTitle" aria-hidden="true" inert>
  <form id="pdfScanPasswordForm" class="audio-clip-success-dialog">
    <h3 id="pdfScanPasswordTitle" class="audio-clip-success-title" data-i18n="home.pdfScan.passwordTitle"></h3>
    <p id="pdfScanPasswordHint" class="audio-clip-success-meta"></p>
    <input id="pdfScanPassword" type="password" autocomplete="off" data-i18n-aria-label="home.pdfScan.passwordTitle">
    <div class="audio-clip-success-actions"><button id="pdfScanPasswordCancel" class="audio-clip-success-btn audio-clip-success-btn-secondary" type="button">${text('cancel')}</button><button class="audio-clip-success-btn audio-clip-success-btn-primary" type="submit">${text('unlock')}</button></div>
  </form>
</div>
<div id="pdfScanSuccessOverlay" class="audio-clip-success-overlay" role="dialog" aria-modal="true" aria-labelledby="pdfScanSuccessTitle" aria-hidden="true" inert>
  <div class="audio-clip-success-dialog">
    <div class="audio-clip-success-icon"><i data-lucide="check"></i></div><h3 id="pdfScanSuccessTitle" class="audio-clip-success-title" data-i18n="home.pdfScan.success"></h3>
    <p id="pdfScanSuccessMeta" class="audio-clip-success-meta"></p>
    <div class="audio-convert-success-detail"><div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.pdfScan.fileName"></span><span id="pdfScanSuccessName" class="audio-convert-success-value"></span></div>
      <div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.pdfScan.location"></span><span id="pdfScanSuccessPath" class="audio-convert-success-value"></span></div></div>
    <div class="audio-clip-success-actions"><button id="pdfScanOpenFolder" class="audio-clip-success-btn audio-clip-success-btn-secondary" type="button">${text('openFolder')}</button><button id="pdfScanSuccessOk" class="audio-clip-success-btn audio-clip-success-btn-primary" type="button">${text('ok')}</button></div>
  </div>
</div>`;

export const previewControlsMarkup = `<div class="pdf-scan-preview-controls"><div class="pdf-scan-segments" role="group" data-i18n-aria-label="home.pdfScan.preview"><button type="button" class="pdf-editor-tool" data-scan-preview="original">${text('original')}</button><button type="button" class="pdf-editor-tool" data-scan-preview="effect">${text('effect')}</button></div><button id="pdfScanExpand" class="pdf-editor-zoom-btn" type="button"><i data-lucide="panel-left-close"></i></button></div>`;
