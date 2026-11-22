const tr = key => `data-i18n="home.pdfPpt.${key}"`;
const button = (id, key, icon = '', extra = '') => `<button id="pdfPpt${id}" class="pdf-editor-tool" type="button" ${extra}>${icon ? `<i data-lucide="${icon}"></i>` : ''}<span ${tr(key)}></span></button>`;
export default `<div id="pdfPptOverlay" class="pdf-ppt" role="dialog" aria-modal="true" aria-labelledby="pdfPptTitle" aria-hidden="true" inert>
  <button id="pdfPptBack" type="button"></button><div id="pdfPptPages"></div>
  <section id="pdfPptUpload" class="pdf-ppt-upload">
    <div class="pdf-ppt-upload-copy"><h1 id="pdfPptTitle" ${tr('title')}></h1><p ${tr('subtitle')}></p>
      ${button('Pick', 'pick', 'upload', 'data-export-primary')}
      <p class="pdf-ppt-hint" ${tr('limits')}></p>
      <p class="pdf-ppt-notice" ${tr('editable')}></p><p class="pdf-ppt-hint" ${tr('local')}></p>
      <p id="pdfPptUploadStatus" role="status" aria-live="polite"></p>
    </div>
  </section>
  <div id="pdfPptMobileBar" class="pdf-ppt-mobile-bar" hidden>${button('MobileOptions', 'options', 'sliders-horizontal')}${button('MobileExport', 'export', 'download', 'data-export-primary')}</div>
  <div id="pdfPptActions" class="pdf-workbench-actions">
    <section class="pdf-ppt-section"><div id="pdfPptTitleSlot"></div><p class="pdf-ppt-hint" ${tr('editable')}></p></section>
    <section class="pdf-ppt-section"><label for="pdfPptRange" ${tr('range')}></label>
      <div class="pdf-ppt-range"><input id="pdfPptRange" type="text" placeholder="1-3, 5" maxlength="1000" aria-describedby="pdfPptRangeHint">${button('ApplyRange', 'apply')}</div>
      <p id="pdfPptRangeHint" class="pdf-ppt-hint" ${tr('rangeHint')}></p>
      <div class="pdf-ppt-segments">${button('All', 'all')}${button('None', 'none')}</div><p id="pdfPptSelected" class="pdf-ppt-hint"></p>
    </section>
    <section class="pdf-ppt-section"><strong ${tr('clarity')}></strong>
      <div class="pdf-ppt-segments" role="group" aria-labelledby="pdfPptClarityLabel">
        <span id="pdfPptClarityLabel" class="pdf-ppt-sr" ${tr('clarity')}></span>
        ${[144, 200, 300].map(dpi => `<button type="button" class="pdf-editor-tool" data-ppt-dpi="${dpi}" aria-pressed="${dpi === 200}">${dpi} DPI</button>`).join('')}
      </div><p class="pdf-ppt-hint" ${tr('clarityHint')}></p>
    </section>
    <section class="pdf-ppt-section"><strong ${tr('fitTitle')}></strong><p class="pdf-ppt-hint" ${tr('fitHint')}></p></section>
    <p id="pdfPptStatus" class="pdf-ppt-hint" role="status" aria-live="polite"></p>
    <div class="pdf-workbench-export">${button('Export', 'export', 'download', 'data-export-primary')}${button('Reset', 'replace', 'file-plus-2')}</div>
  </div><input id="pdfPptFileInput" type="file" accept="application/pdf,.pdf" hidden>
</div>
<div id="pdfPptProcess" class="audio-convert-process-mask pdf-ppt-process" role="dialog" aria-modal="true" aria-labelledby="pdfPptProgressTitle" aria-hidden="true" inert>
  <h2 id="pdfPptProgressTitle" aria-live="polite"></h2>
  <div class="audio-convert-process-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-labelledby="pdfPptProgressTitle"><div id="pdfPptProgressFill" class="audio-convert-process-bar-fill"></div></div>
  ${button('Cancel', 'cancel', 'x')}
</div>
<div id="pdfPptSuccess" class="audio-clip-success-overlay tk-file-result pdf-ppt-success" role="dialog" aria-modal="true" aria-labelledby="pdfPptSuccessTitle" aria-hidden="true" inert>
  <div class="audio-clip-success-dialog"><h2 id="pdfPptSuccessTitle" class="audio-clip-success-title" ${tr('success')}></h2>
    <p id="pdfPptSuccessName" class="audio-clip-success-meta"></p><p id="pdfPptSuccessMeta" class="audio-clip-success-meta"></p>
    <p class="pdf-ppt-hint" ${tr('editable')}></p><p id="pdfPptSuccessPath" class="audio-convert-success-value"></p>
    <p id="pdfPptResultStatus" class="pdf-ppt-hint" role="status"></p>
    <div class="audio-clip-success-actions"><button id="pdfPptFolder" class="audio-clip-success-btn audio-clip-success-btn-secondary" type="button" ${tr('folder')}></button><button id="pdfPptDone" class="audio-clip-success-btn audio-clip-success-btn-primary" type="button" ${tr('done')}></button></div>
  </div>
</div>`;
