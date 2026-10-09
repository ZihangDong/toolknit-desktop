const PAGE_COPY = Object.freeze({
  convert: Object.freeze({
    root: 'imageConvert',
    className: 'image-convert-v2',
    title: '图片格式转换',
    subtitle: '支持 JPG、PNG、WebP、BMP、GIF、SVG 六种图片格式输出，批量处理一键完成。',
    heroLabel: 'Image Format Converter',
    posterNote: '图片会保持原始分辨率处理，适合批量格式互转和素材整理。',
    workflowLabel: '转换流程',
    steps: [
      ['添加文件', '上传一个或多个图片，准备批量转换。'],
      ['选择格式', '选择 PNG、JPG、WebP、BMP、GIF 或 SVG。'],
      ['调整顺序', '支持拖拽排序，按队列顺序统一输出。'],
      ['导出结果', '转换完成后打开文件夹即可查看。']
    ],
    uploadLabel: '上传图片文件',
    uploadTitle: '把需要转换的图片放到这里',
    uploadDescription: '支持拖拽或点击上传，上传后会进入队列，按选择的格式批量导出。',
    optionLabel: '目标格式',
    options: [['format', 'PNG', 'PNG'], ['format', 'JPG', 'JPG'], ['format', 'WEBP', 'WebP'], ['format', 'BMP', 'BMP'], ['format', 'GIF', 'GIF'], ['format', 'SVG', 'SVG']],
    optionHint: 'SVG 更适合矢量素材，GIF 更适合动图输出，其余格式保持原始分辨率。',
    queueKicker: 'CONVERT QUEUE',
    queueTitle: '待转换文件',
    queueDescription: '支持拖拽排序，按队列顺序统一输出结果。',
    formats: ['保留原始分辨率，适合批量互转', 'JPG / PNG / WebP / BMP / GIF / SVG', '无损与有损格式都能快速切换', '纯本地处理，文件不上传服务器'],
    footer: '确认文件和目标格式后开始处理，完成后会自动弹出结果提示。'
  }),
  compress: Object.freeze({
    root: 'imageCompress',
    className: 'image-compress-v2',
    title: '图片压缩',
    subtitle: '支持 JPG、PNG、WebP 图片压缩；JPG 可选三档画质，PNG 与 WebP 无损优化，保留原始分辨率。',
    heroLabel: 'Image Compressor',
    posterNote: '自动平衡清晰度与体积，适合批量整理、分享和网页素材压缩。',
    workflowLabel: '压缩流程',
    steps: [
      ['添加图片', '上传一个或多个图片，准备批量压缩。'],
      ['选择画质', '高质量、中等、极致压缩三档自由切换。'],
      ['排队压缩', '支持拖拽排序，按队列顺序统一处理。'],
      ['导出结果', '完成后打开文件夹即可查看压缩后的图片。']
    ],
    uploadLabel: '上传图片文件',
    uploadTitle: '把需要压缩的图片放到这里',
    uploadDescription: '支持拖拽或点击上传，上传后会进入队列，按选择的画质批量压缩。',
    optionLabel: '压缩画质',
    options: [['quality', 'high', '高质量'], ['quality', 'medium', '中等'], ['quality', 'low', '极致压缩']],
    optionHint: '高质量保留更多细节，中等适合日常分享，极致压缩适合轻量传输和预览。',
    queueKicker: 'QUEUE LIST',
    queueTitle: '待压缩图片',
    queueDescription: '支持拖拽排序，按队列顺序统一输出结果。',
    formats: ['JPG / PNG / WebP', '三档画质自由切换', '批量压缩与排序处理', '纯本地处理，文件不上传服务器'],
    footer: '确认文件和目标画质后开始处理，完成后会自动弹出结果提示。'
  })
});

function optionTemplate(config, mode) {
  return config.options.map(([attribute, value, label], index) => {
    const active = mode === 'convert' ? index === 0 : value === 'medium';
    const i18n = mode === 'compress'
      ? ` data-i18n="home.imageCompress.quality${value[0].toUpperCase()}${value.slice(1)}"`
      : '';
    return `<button class="audio-convert-format-option${active ? ' active' : ''}" data-${attribute}="${value}"${i18n}>${label}</button>`;
  }).join('');
}

function stepTemplate(steps) {
  return steps.map(([title, description], index) => `<div class="pdf-merge-v2-step${index === 0 ? ' is-active' : ''}">
    <span>${String(index + 1).padStart(2, '0')}</span><div><strong>${title}</strong><p>${description}</p></div>
  </div>`).join('');
}

export function imageBatchPageTemplate(mode) {
  const config = PAGE_COPY[mode];
  if (!config) throw new Error(`image-batch:unknown-mode:${mode}`);
  const { root } = config;
  const i18nRoot = mode === 'convert' ? 'home.imageConvert' : 'home.imageCompress';
  const optionId = mode === 'convert' ? 'imageConvertFormatOptions' : 'imageCompressQualityOptions';
  return `
    <div class="plasma-bg pdf-merge-v2-bg" id="${root}PlasmaBg"></div>
    <div class="audio-convert-drop-zone pdf-merge-v2-drop-zone" id="${root}DropZone"><span class="drop-hint" data-i18n="${i18nRoot}.dropHint">松手即可上传</span></div>
    <header class="pdf-merge-v2-topbar ${config.className}-topbar">
      <div class="pdf-merge-v2-topbar-left ${config.className}-topbar-left">
        <button class="settings-v2-back settings-back pdf-merge-v2-back" id="${root}Back" type="button" data-i18n-title="settings.back" title="返回首页"><i data-lucide="arrow-left"></i><span data-i18n="settings.back">返回首页</span></button>
        <span class="pdf-merge-v2-top-tag ${config.className}-top-tag">IMAGE TOOLS · TOOL PAGE 3.1</span>
      </div>
      <div class="home-v2-top-actions pdf-merge-v2-top-actions">
        <button class="home-v2-nav-link" type="button" data-home-link="website"><i data-lucide="globe-2"></i><span>网页版本</span></button>
        <button class="home-v2-support-top" type="button" data-open-support><i data-lucide="heart"></i><span>支持作者</span></button>
        <div class="home-v2-window-cluster" aria-label="窗口与设置">
          <button class="home-v2-icon-button" id="${root}V2Settings" type="button" data-i18n-title="nav.settings" title="设置" aria-label="设置"><i data-lucide="settings"></i></button>
          <div class="home-v2-window-controls" aria-label="窗口控制">
            <button class="home-v2-window-button ctrl-btn" type="button" data-i18n-title="common.minimize" title="最小化" data-action="minimize"><i data-lucide="minus"></i></button>
            <button class="home-v2-window-button ctrl-btn" type="button" data-i18n-title="common.maximize" title="最大化" data-action="maximize"><i data-lucide="square"></i></button>
            <button class="home-v2-window-button ctrl-btn" type="button" data-i18n-title="common.close" title="关闭" data-action="close"><i data-lucide="x"></i></button>
          </div>
        </div>
      </div>
    </header>
    <div class="pdf-merge-v2-body ${config.className}-body" id="${root}Body">
      <aside class="pdf-merge-v2-poster ${config.className}-poster" aria-label="${config.title}说明">
        <div class="pdf-merge-v2-poster-kicker" data-i18n="${i18nRoot}.heroLabel">${config.heroLabel}</div>
        <h1 class="pdf-merge-v2-title" data-i18n="${i18nRoot}.title">${config.title}</h1>
        <p class="pdf-merge-v2-subtitle" data-i18n="${i18nRoot}.subtitle">${config.subtitle}</p>
        <div class="pdf-merge-v2-poster-note"><span>LOCAL ONLY</span><strong>${config.posterNote}</strong></div>
        <div class="pdf-merge-v2-steps" aria-label="${config.workflowLabel}">${stepTemplate(config.steps)}</div>
      </aside>
      <main class="pdf-merge-v2-workspace ${config.className}-workspace">
        <section class="pdf-merge-v2-upload ${config.className}-upload" aria-label="上传图片文件">
          <div class="pdf-merge-v2-upload-copy"><span class="pdf-merge-v2-upload-eyebrow">DROP OR SELECT</span><h2>${config.uploadTitle}</h2><p>${config.uploadDescription}</p></div>
          <button class="audio-convert-cta pdf-merge-v2-cta" id="${root}Cta" type="button"><i data-lucide="upload"></i><span data-i18n="${i18nRoot}.cta">${config.uploadLabel}</span></button>
        </section>
        <section class="pdf-merge-v2-options ${config.className}-options" aria-label="${config.optionLabel}">
          <div class="audio-convert-format-selector"><span class="audio-convert-format-label" data-i18n="${i18nRoot}.${mode === 'convert' ? 'targetFormat' : 'qualityLabel'}">${config.optionLabel}</span><div class="audio-convert-format-options" id="${optionId}">${optionTemplate(config, mode)}</div></div>
          <div class="pdf-merge-v2-options-hint">${config.optionHint}</div>
        </section>
        <section class="pdf-merge-v2-queue ${config.className}-queue" aria-label="${config.queueTitle}">
          <div class="pdf-merge-v2-section-head"><div><span class="pdf-merge-v2-section-kicker">${config.queueKicker}</span><h2>${config.queueTitle}</h2></div><p>${config.queueDescription}</p></div>
          <div class="audio-convert-files pdf-merge-v2-files ${config.className}-files" id="${root}Files"></div>
        </section>
        <section class="audio-convert-formats pdf-merge-v2-info ${config.className}-info" aria-label="支持格式"><h3 class="audio-convert-formats-title" data-i18n="${i18nRoot}.formatsTitle">支持格式</h3><div class="pdf-merge-info-grid">
          ${config.formats.map((text, index) => `<div class="pdf-merge-info-item"><i data-lucide="${['sparkles', 'file-image', 'layers-3', 'shield'][index]}"></i><span>${text}</span></div>`).join('')}
        </div></section>
        <footer class="pdf-merge-v2-actions ${config.className}-actions"><span>${config.footer}</span><button class="audio-convert-process-btn pdf-merge-v2-process" id="${root}ProcessBtn" data-i18n="${i18nRoot}.processBtn" style="display:none;">开始处理</button></footer>
      </main>
    </div>`;
}

function successRows(mode, root) {
  if (mode === 'convert') {
    return [['successTarget', '目标格式', 'Format'], ['successCount', '处理文件', 'Count'], ['successPath', '保存路径', 'Path']]
      .map(([key, label, suffix]) => `<div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.imageConvert.${key}">${label}</span><span class="audio-convert-success-value" id="${root}Success${suffix}"></span></div>`).join('');
  }
  return [
    ['successTarget', '压缩画质', 'Format'], ['successCount', '处理文件', 'Count'],
    ['originalSize', '原始大小', 'OriginalSize'], ['compressedSize', '压缩后大小', 'CompressedSize'],
    ['savedSize', '节省空间', 'SavedSize'], ['successPath', '保存路径', 'Path']
  ].map(([key, label, suffix]) => `<div class="audio-convert-success-row"><span class="audio-convert-success-key" data-i18n="home.imageCompress.${key}">${label}</span><span class="audio-convert-success-value" id="${root}Success${suffix}"></span></div>`).join('');
}

export function imageBatchPortalTemplate(mode) {
  const root = mode === 'convert' ? 'imageConvert' : 'imageCompress';
  const i18nRoot = mode === 'convert' ? 'home.imageConvert' : 'home.imageCompress';
  return `<div data-image-batch-portal="${mode}">
    <div class="audio-convert-process-mask" id="${root}ProcessMask" aria-hidden="true"><div class="tk-mascot-lg" aria-hidden="true"></div><div class="audio-convert-process-bar"><div class="audio-convert-process-bar-fill" id="${root}ProcessBarFill"></div></div><div class="audio-convert-process-text" id="${root}ProcessText" data-i18n="${i18nRoot}.processing">${mode === 'convert' ? '正在处理...' : '正在压缩...'}</div><button class="audio-convert-cancel-btn" id="${root}CancelBtn" data-i18n="${i18nRoot}.cancel">取消</button></div>
    <div class="audio-convert-success-overlay" id="${root}SuccessOverlay" aria-hidden="true"><div class="audio-convert-success-dialog"><div class="audio-convert-success-icon"><i data-lucide="check"></i></div><h3 class="audio-convert-success-title" data-i18n="${i18nRoot}.successTitle">${mode === 'convert' ? '处理成功' : '压缩完成'}</h3><div class="audio-convert-success-meta" id="${root}SuccessMeta"></div><div class="audio-convert-success-detail">${successRows(mode, root)}</div><div class="image-batch-failure-summary" id="${root}FailureSummary" aria-live="polite" hidden></div><div class="audio-convert-success-actions"><button class="audio-convert-success-btn audio-convert-success-btn-secondary" id="${root}OpenFolder" data-i18n="${i18nRoot}.openFolder">打开文件夹</button><button class="audio-convert-success-btn audio-convert-success-btn-primary" id="${root}SuccessOk" data-i18n="${i18nRoot}.ok">确定</button></div></div></div>
  </div>`;
}
