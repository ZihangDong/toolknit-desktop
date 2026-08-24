// ============================================
// ToolKnit Desktop — Tkinter 极简 UI
// ============================================

const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

// ---- Tauri 动态导入 ----
async function tauriInvoke(cmd, args) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
}

async function openFile(opts) {
  const { open } = await import('@tauri-apps/plugin-dialog');
  return open(opts);
}

// ---- 窗口控制 ----
document.querySelectorAll('.tb-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!isTauri) return;
    const action = btn.dataset.action;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    if (action === 'minimize') await win.minimize();
    else if (action === 'maximize') await win.toggleMaximize();
    else if (action === 'close') await win.hide();
  });
});

// ---- 工具注册表 ----
// 每个工具: { id, name, category, icon?, inputs[], options[], action, handler }
// inputs: { type: 'file'|'text'|'none', multiple?, accept?, label? }
// options: { type: 'select'|'input'|'check', label, values?, default?, placeholder? }

const TOOLS = [];
function registerTool(tool) { TOOLS.push(tool); }

// ====== PDF 工具 ======
registerTool({
  id: 'pdf-merge', name: 'PDF 合并', category: 'PDF 工具',
  inputs: [{ type: 'file', multiple: true, accept: '.pdf', label: '选择 PDF 文件（至少 2 个）' }],
  options: [],
  action: '开始合并',
  handler: async (files) => {
    if (files.length < 2) throw new Error('至少需要 2 个 PDF 文件');
    // 使用 pdf-lib 合并
    const { PDFDocument } = await import('pdf-lib');
    const merged = await PDFDocument.create();
    for (const file of files) {
      const bytes = await readFileBytes(file.path);
      const doc = await PDFDocument.load(bytes);
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    }
    const outBytes = await merged.save();
    const outPath = await getOutputPath('PDF_Merge', 'merged.pdf');
    await writeFileBytes(outPath, outBytes);
    return { output: outPath };
  }
});

registerTool({
  id: 'pdf-split', name: 'PDF 拆分', category: 'PDF 工具',
  inputs: [{ type: 'file', accept: '.pdf', label: '选择 PDF 文件' }],
  options: [
    { type: 'input', label: '页码范围（如 1-3,5）', placeholder: '全部页面', default: '' }
  ],
  action: '开始拆分',
  handler: async (files, opts) => {
    const file = files[0];
    const bytes = await readFileBytes(file.path);
    const { PDFDocument } = await import('pdf-lib');
    const src = await PDFDocument.load(bytes);
    const total = src.getPageCount();
    const pages = parsePageRange(opts[0] || '', total);
    const outDir = await getOutputDir('PDF_Split');
    const outPaths = [];
    for (let i = 0; i < pages.length; i++) {
      const doc = await PDFDocument.create();
      const [page] = await doc.copyPages(src, [pages[i] - 1]);
      doc.addPage(page);
      const outBytes = await doc.save();
      const name = `split_page_${pages[i]}.pdf`;
      const p = outDir + '\\' + name;
      await writeFileBytes(p, outBytes);
      outPaths.push(p);
    }
    return { output: outDir, files: outPaths };
  }
});

registerTool({
  id: 'pdf-to-image', name: 'PDF 转图像', category: 'PDF 工具',
  inputs: [{ type: 'file', accept: '.pdf', label: '选择 PDF 文件' }],
  options: [
    { type: 'select', label: '输出格式', values: ['PNG', 'JPG'], default: 'PNG' },
    { type: 'select', label: '缩放', values: ['1x', '2x', '3x'], default: '2x' }
  ],
  action: '开始转换',
  handler: async (files, opts) => {
    const file = files[0];
    const outDir = await getOutputDir('PDF_ToImage');
    const result = await tauriInvoke('pdf_to_images', {
      inputPath: file.path,
      outputDir: outDir,
      format: (opts[0] || 'PNG').toLowerCase(),
      scale: parseInt(opts[1]) || 2
    });
    return { output: outDir, files: result?.files || [] };
  }
});

registerTool({
  id: 'pdf-rotate', name: 'PDF 页面旋转', category: 'PDF 工具',
  inputs: [{ type: 'file', accept: '.pdf', label: '选择 PDF 文件' }],
  options: [
    { type: 'select', label: '旋转角度', values: ['90', '180', '270'], default: '90' }
  ],
  action: '开始旋转',
  handler: async (files, opts) => {
    const file = files[0];
    const bytes = await readFileBytes(file.path);
    const { PDFDocument, degrees } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    const angle = parseInt(opts[0]) || 90;
    doc.getPages().forEach(p => p.setRotation(degrees((p.getRotation().angle + angle) % 360)));
    const outBytes = await doc.save();
    const outPath = await getOutputPath('PDF_Rotate', file.name.replace('.pdf', '_rotated.pdf'));
    await writeFileBytes(outPath, outBytes);
    return { output: outPath };
  }
});

registerTool({
  id: 'pdf-encrypt', name: 'PDF 文件加密', category: 'PDF 工具',
  inputs: [{ type: 'file', accept: '.pdf', label: '选择 PDF 文件' }],
  options: [
    { type: 'input', label: '密码', placeholder: '请输入密码', default: '' }
  ],
  action: '开始加密',
  handler: async (files, opts) => {
    const file = files[0];
    const password = opts[0];
    if (!password) throw new Error('请输入密码');
    const result = await tauriInvoke('encrypt_pdf', {
      inputPath: file.path,
      password,
      outputDir: await getOutputDir('PDF_Encrypt')
    });
    return { output: result?.outputPath || '' };
  }
});

registerTool({
  id: 'pdf-decrypt', name: 'PDF 文件解密', category: 'PDF 工具',
  inputs: [{ type: 'file', accept: '.pdf', label: '选择加密的 PDF 文件' }],
  options: [
    { type: 'input', label: '密码', placeholder: '请输入密码', default: '' }
  ],
  action: '开始解密',
  handler: async (files, opts) => {
    const file = files[0];
    const password = opts[0];
    if (!password) throw new Error('请输入密码');
    const result = await tauriInvoke('decrypt_pdf', {
      inputPath: file.path,
      password,
      outputDir: await getOutputDir('PDF_Decrypt')
    });
    return { output: result?.outputPath || '' };
  }
});

registerTool({
  id: 'pdf-compress', name: 'PDF 文件压缩', category: 'PDF 工具',
  inputs: [{ type: 'file', accept: '.pdf', label: '选择 PDF 文件' }],
  options: [
    { type: 'select', label: '压缩等级', values: ['low', 'medium', 'high'], default: 'medium' }
  ],
  action: '开始压缩',
  handler: async (files, opts) => {
    const file = files[0];
    const result = await tauriInvoke('compress_pdf', {
      inputPath: file.path,
      level: opts[0] || 'medium',
      outputDir: await getOutputDir('PDF_Compress')
    });
    return { output: result?.outputPath || '' };
  }
});

registerTool({
  id: 'pdf-editor', name: 'PDF 编辑器', category: 'PDF 工具',
  inputs: [{ type: 'file', accept: '.pdf', label: '选择 PDF 文件' }],
  options: [],
  action: '打开编辑器',
  handler: async () => { throw new Error('PDF 编辑器需要完整 UI 支持，请使用原版'); }
});

registerTool({
  id: 'pdf-enhance', name: 'PDF 文字增强', category: 'PDF 工具',
  inputs: [{ type: 'file', accept: '.pdf', label: '选择 PDF 文件' }],
  options: [],
  action: '开始增强',
  handler: async () => { throw new Error('文字增强需要完整 UI 支持，请使用原版'); }
});

// ====== PPT 工具 ======
registerTool({
  id: 'ppt-to-pdf', name: 'PPT 转 PDF', category: 'PPT 工具',
  inputs: [{ type: 'file', accept: '.pptx', label: '选择 PPT 文件' }],
  options: [],
  action: '开始转换',
  handler: async (files) => {
    const file = files[0];
    const outDir = await getOutputDir('PPT_ToPDF');
    const result = await tauriInvoke('ppt_to_pdf', { inputPath: file.path, outputDir: outDir });
    return { output: result?.outputPath || outDir };
  }
});

registerTool({
  id: 'ppt-to-image', name: 'PPT 转图片', category: 'PPT 工具',
  inputs: [{ type: 'file', accept: '.pptx', label: '选择 PPT 文件' }],
  options: [
    { type: 'select', label: '输出格式', values: ['PNG', 'JPG'], default: 'PNG' }
  ],
  action: '开始转换',
  handler: async (files, opts) => {
    const file = files[0];
    const outDir = await getOutputDir('PPT_ToImage');
    const result = await tauriInvoke('ppt_to_images', {
      inputPath: file.path, outputDir: outDir, format: (opts[0] || 'png').toLowerCase()
    });
    return { output: outDir, files: result?.files || [] };
  }
});

registerTool({
  id: 'ppt-image-extract', name: 'PPT 图片提取', category: 'PPT 工具',
  inputs: [{ type: 'file', accept: '.pptx', label: '选择 PPT 文件' }],
  options: [],
  action: '提取图片',
  handler: async (files) => {
    const file = files[0];
    const outDir = await getOutputDir('PPT_Images');
    const result = await tauriInvoke('ppt_extract_images', { inputPath: file.path, outputDir: outDir });
    return { output: outDir, files: result?.files || [] };
  }
});

registerTool({
  id: 'ppt-text-extract', name: 'PPT 文本提取', category: 'PPT 工具',
  inputs: [{ type: 'file', accept: '.pptx', label: '选择 PPT 文件' }],
  options: [
    { type: 'select', label: '输出格式', values: ['TXT', 'Markdown'], default: 'TXT' }
  ],
  action: '提取文本',
  handler: async (files, opts) => {
    const file = files[0];
    const result = await tauriInvoke('ppt_extract_text', { inputPath: file.path });
    return { text: result?.text || '' };
  }
});

registerTool({
  id: 'ppt-compress', name: 'PPT 压缩', category: 'PPT 工具',
  inputs: [{ type: 'file', accept: '.pptx', label: '选择 PPT 文件' }],
  options: [
    { type: 'select', label: '压缩等级', values: ['low', 'medium', 'high'], default: 'medium' }
  ],
  action: '开始压缩',
  handler: async (files, opts) => {
    const file = files[0];
    const outDir = await getOutputDir('PPT_Compress');
    const result = await tauriInvoke('ppt_compress', {
      inputPath: file.path, level: opts[0] || 'medium', outputDir: outDir
    });
    return { output: result?.outputPath || outDir };
  }
});

registerTool({
  id: 'ppt-outline', name: 'AI 生成 PPT 大纲', category: 'PPT 工具',
  inputs: [{ type: 'text', label: '输入主题和内容描述' }],
  options: [
    { type: 'select', label: '类型', values: ['product', 'pitch', 'report', 'training', 'review'], default: 'report' }
  ],
  action: '生成大纲',
  handler: async (_, opts, textContent) => {
    if (!textContent) throw new Error('请输入主题描述');
    // AI 大纲需要 provider
    return { text: '需要配置 AI 密钥才能使用此功能。请在设置中配置。' };
  }
});

registerTool({
  id: 'ppt-draft', name: 'AI 生成 PPT 草稿', category: 'PPT 工具',
  inputs: [{ type: 'text', label: '输入主题和内容描述' }],
  options: [],
  action: '生成草稿',
  handler: async () => {
    return { text: '需要配置 AI 密钥才能使用此功能。请在设置中配置。' };
  }
});

// ====== 图像工具 ======
registerTool({
  id: 'image-convert', name: '图片格式转换', category: '图像工具',
  inputs: [{ type: 'file', multiple: true, accept: 'image/*', label: '选择图片文件' }],
  options: [
    { type: 'select', label: '目标格式', values: ['PNG', 'JPG', 'WebP', 'BMP', 'GIF'], default: 'PNG' }
  ],
  action: '开始转换',
  handler: async (files, opts) => {
    const outDir = await getOutputDir('Image_Convert');
    const paths = files.map(f => f.path);
    const result = await tauriInvoke('image_batch_convert', {
      inputPaths: paths, outputDir: outDir, format: (opts[0] || 'png').toLowerCase()
    });
    return { output: outDir, files: result?.files || [] };
  }
});

registerTool({
  id: 'image-compress', name: '图片压缩', category: '图像工具',
  inputs: [{ type: 'file', multiple: true, accept: 'image/*', label: '选择图片文件' }],
  options: [
    { type: 'select', label: '质量', values: ['low', 'medium', 'high'], default: 'medium' }
  ],
  action: '开始压缩',
  handler: async (files, opts) => {
    const outDir = await getOutputDir('Image_Compress');
    const paths = files.map(f => f.path);
    const result = await tauriInvoke('image_batch_compress', {
      inputPaths: paths, outputDir: outDir, quality: opts[0] || 'medium'
    });
    return { output: outDir, files: result?.files || [] };
  }
});

registerTool({
  id: 'image-stitch', name: '长图拼接', category: '图像工具',
  inputs: [{ type: 'file', multiple: true, accept: 'image/*', label: '选择图片文件' }],
  options: [
    { type: 'select', label: '方向', values: ['vertical', 'horizontal'], default: 'vertical' }
  ],
  action: '开始拼接',
  handler: async (files, opts) => {
    const outDir = await getOutputDir('Image_Stitch');
    const paths = files.map(f => f.path);
    const result = await tauriInvoke('image_stitch', {
      inputPaths: paths, outputDir: outDir, direction: opts[0] || 'vertical'
    });
    return { output: result?.outputPath || outDir };
  }
});

registerTool({
  id: 'icon-gen', name: '图标生成器', category: '图像工具',
  inputs: [{ type: 'file', accept: 'image/*', label: '选择一张图片' }],
  options: [],
  action: '生成图标',
  handler: async (files) => {
    const outDir = await getOutputDir('Icon_Gen');
    const result = await tauriInvoke('icon_generate', { inputPath: files[0].path, outputDir: outDir });
    return { output: outDir, files: result?.files || [] };
  }
});

registerTool({
  id: 'color-extract', name: '配色提取器', category: '图像工具',
  inputs: [{ type: 'file', accept: 'image/*', label: '选择一张图片' }],
  options: [],
  action: '提取配色',
  handler: async (files) => {
    const result = await tauriInvoke('extract_colors', { inputPath: files[0].path });
    return { text: JSON.stringify(result?.palette || [], null, 2) };
  }
});

// ====== 音频工具 ======
registerTool({
  id: 'audio-convert', name: '音频格式转换', category: '音频工具',
  inputs: [{ type: 'file', multiple: true, accept: 'audio/*', label: '选择音频文件' }],
  options: [
    { type: 'select', label: '目标格式', values: ['MP3', 'AAC', 'WAV', 'FLAC', 'ALAC', 'OGG'], default: 'MP3' }
  ],
  action: '开始转换',
  handler: async (files, opts) => {
    const outDir = await getOutputDir('Audio_Convert');
    const paths = files.map(f => f.path);
    const result = await tauriInvoke('audio_batch_convert', {
      inputPaths: paths, outputDir: outDir, format: opts[0] || 'MP3'
    });
    return { output: outDir, files: result?.files || [] };
  }
});

registerTool({
  id: 'bpm-detect', name: 'BPM 节拍测速', category: '音频工具',
  inputs: [{ type: 'file', accept: 'audio/*', label: '选择音频文件' }],
  options: [],
  action: '分析 BPM',
  handler: async (files) => {
    const result = await tauriInvoke('detect_bpm', { inputPath: files[0].path });
    return { text: `BPM: ${result?.bpm || '未知'}` };
  }
});

registerTool({
  id: 'audio-extract', name: '音频提取', category: '音频工具',
  inputs: [{ type: 'file', accept: 'video/*', label: '选择视频文件' }],
  options: [
    { type: 'select', label: '输出格式', values: ['MP3', 'AAC', 'WAV', 'FLAC'], default: 'MP3' }
  ],
  action: '提取音频',
  handler: async (files, opts) => {
    const outDir = await getOutputDir('Audio_Extract');
    const result = await tauriInvoke('extract_audio', {
      inputPath: files[0].path, outputDir: outDir, format: opts[0] || 'MP3'
    });
    return { output: result?.outputPath || outDir };
  }
});

registerTool({
  id: 'audio-clip', name: '音频剪辑', category: '音频工具',
  inputs: [{ type: 'file', accept: 'audio/*', label: '选择音频文件' }],
  options: [
    { type: 'input', label: '开始时间（秒）', placeholder: '0', default: '0' },
    { type: 'input', label: '结束时间（秒）', placeholder: '全部', default: '' }
  ],
  action: '开始剪辑',
  handler: async (files, opts) => {
    const outDir = await getOutputDir('Audio_Clip');
    const result = await tauriInvoke('clip_audio', {
      inputPath: files[0].path, outputDir: outDir,
      startTime: parseFloat(opts[0]) || 0,
      endTime: opts[1] ? parseFloat(opts[1]) : undefined
    });
    return { output: result?.outputPath || outDir };
  }
});

// ====== 视频工具 ======
registerTool({
  id: 'video-convert', name: '视频格式转换', category: '视频工具',
  inputs: [{ type: 'file', multiple: true, accept: 'video/*', label: '选择视频文件' }],
  options: [
    { type: 'select', label: '目标格式', values: ['MP4', 'AVI', 'MKV', 'MOV', 'WebM'], default: 'MP4' }
  ],
  action: '开始转换',
  handler: async (files, opts) => {
    const outDir = await getOutputDir('Video_Convert');
    const paths = files.map(f => f.path);
    const result = await tauriInvoke('video_batch_convert', {
      inputPaths: paths, outputDir: outDir, format: opts[0] || 'MP4'
    });
    return { output: outDir, files: result?.files || [] };
  }
});

registerTool({
  id: 'video-frame', name: '视频高清单帧图', category: '视频工具',
  inputs: [{ type: 'file', accept: 'video/*', label: '选择视频文件' }],
  options: [
    { type: 'input', label: '时间点（如 00:01:30）', placeholder: '00:00:00', default: '00:00:00' }
  ],
  action: '截取帧',
  handler: async (files, opts) => {
    const outDir = await getOutputDir('Video_Frame');
    const result = await tauriInvoke('video_frame', {
      inputPath: files[0].path, outputDir: outDir, timestamp: opts[0] || '00:00:00'
    });
    return { output: result?.outputPath || outDir };
  }
});

registerTool({
  id: 'video-gif', name: '视频截取 GIF', category: '视频工具',
  inputs: [{ type: 'file', accept: 'video/*', label: '选择视频文件（≤30秒）' }],
  options: [
    { type: 'input', label: '开始时间（秒）', placeholder: '0', default: '0' },
    { type: 'input', label: '持续时间（秒）', placeholder: '5', default: '5' }
  ],
  action: '生成 GIF',
  handler: async (files, opts) => {
    const outDir = await getOutputDir('Video_Gif');
    const result = await tauriInvoke('video_to_gif', {
      inputPath: files[0].path, outputDir: outDir,
      startTime: parseFloat(opts[0]) || 0,
      duration: parseFloat(opts[1]) || 5
    });
    return { output: result?.outputPath || outDir };
  }
});

// ====== 文本工具 ======
registerTool({
  id: 'transcription', name: '音视频提取文字', category: '文本工具',
  inputs: [{ type: 'file', accept: 'audio/*,video/*', label: '选择音频或视频文件' }],
  options: [
    { type: 'select', label: '输出格式', values: ['TXT', 'SRT', 'JSON'], default: 'TXT' }
  ],
  action: '开始转写',
  handler: async (files, opts) => {
    const outDir = await getOutputDir('Transcription');
    const result = await tauriInvoke('transcribe_media', {
      inputPath: files[0].path, outputDir: outDir, format: opts[0] || 'TXT'
    });
    return { output: result?.outputPath || outDir, text: result?.text || '' };
  }
});

registerTool({
  id: 'text-stats', name: '文本统计器', category: '文本工具',
  inputs: [{ type: 'file', accept: '.txt,.md,.csv,.json,.html,.xml,.log', label: '选择文本文件' }],
  options: [],
  action: '开始统计',
  handler: async (files) => {
    const bytes = await readFileBytes(files[0].path);
    const text = new TextDecoder('utf-8').decode(bytes);
    const { calculateTextStats } = await import('./text-stats-core.js');
    const stats = calculateTextStats(text);
    const lines = [
      `字符数: ${stats.chars}`,
      `字符数（无空格）: ${stats.charsNoSpace}`,
      `单词数: ${stats.words}`,
      `行数: ${stats.lines}`,
      `段落数: ${stats.paragraphs}`,
      `句子数: ${stats.sentences}`,
      `中文字数: ${stats.chineseChars}`,
      `大写: ${stats.uppercase}  小写: ${stats.lowercase}`,
      `数字: ${stats.digits}  标点: ${stats.punctuation}`,
      `阅读时间: ~${stats.readingTime} 分钟`,
    ];
    return { text: lines.join('\n') };
  }
});

registerTool({
  id: 'text-format', name: '文本格式化', category: '文本工具',
  inputs: [{ type: 'file', accept: '.txt,.md,.csv', label: '选择文本文件' }],
  options: [],
  action: '格式化',
  handler: async (files) => {
    const bytes = await readFileBytes(files[0].path);
    const text = new TextDecoder('utf-8').decode(bytes);
    const { executeTextFormat } = await import('./text-format-core.js');
    const result = executeTextFormat(text);
    return { text: result };
  }
});

// ====== 计算器工具 ======
registerTool({
  id: 'bmi-calc', name: '体脂率计算器', category: '计算器工具',
  inputs: [{ type: 'none' }],
  options: [
    { type: 'input', label: '身高 (cm)', placeholder: '170', default: '' },
    { type: 'input', label: '体重 (kg)', placeholder: '65', default: '' },
    { type: 'input', label: '年龄', placeholder: '25', default: '' },
    { type: 'select', label: '性别', values: ['男', '女'], default: '男' }
  ],
  action: '计算',
  handler: async (_, opts) => {
    const h = parseFloat(opts[0]) / 100;
    const w = parseFloat(opts[1]);
    const age = parseInt(opts[2]);
    const sex = opts[3];
    if (!h || !w) throw new Error('请输入身高和体重');
    const bmi = w / (h * h);
    // US Navy 公式近似
    let bodyFat;
    if (sex === '男') bodyFat = 1.20 * bmi + 0.23 * age - 16.2;
    else bodyFat = 1.20 * bmi + 0.23 * age - 5.4;
    return { text: `BMI: ${bmi.toFixed(1)}\n估算体脂率: ${bodyFat.toFixed(1)}%\n注意：此为粗略估算，仅供参考。` };
  }
});

registerTool({
  id: 'timestamp-calc', name: '时间戳计算器', category: '计算器工具',
  inputs: [{ type: 'none' }],
  options: [
    { type: 'input', label: '时间戳（秒）', placeholder: '留空=当前时间', default: '' }
  ],
  action: '转换',
  handler: async (_, opts) => {
    const ts = opts[0] ? parseInt(opts[0]) : Math.floor(Date.now() / 1000);
    const date = new Date(ts * 1000);
    return { text: `时间戳: ${ts}\n日期: ${date.toLocaleString('zh-CN')}\nISO: ${date.toISOString()}` };
  }
});

registerTool({
  id: 'mortgage-calc', name: '房贷计算器', category: '计算器工具',
  inputs: [{ type: 'none' }],
  options: [
    { type: 'input', label: '贷款总额（万元）', placeholder: '100', default: '' },
    { type: 'input', label: '年利率（%）', placeholder: '3.5', default: '' },
    { type: 'input', label: '贷款年限（年）', placeholder: '30', default: '' }
  ],
  action: '计算',
  handler: async (_, opts) => {
    const total = parseFloat(opts[0]) * 10000;
    const rate = parseFloat(opts[1]) / 100 / 12;
    const months = parseInt(opts[2]) * 12;
    if (!total || !rate || !months) throw new Error('请填写完整信息');
    // 等额本息
    const payment = total * rate * Math.pow(1 + rate, months) / (Math.pow(1 + rate, months) - 1);
    const totalPayment = payment * months;
    const totalInterest = totalPayment - total;
    return {
      text: `月供: ¥${payment.toFixed(2)}\n总还款: ¥${totalPayment.toFixed(2)}\n总利息: ¥${totalInterest.toFixed(2)}`
    };
  }
});

registerTool({
  id: 'interest-calc', name: '利息计算器', category: '计算器工具',
  inputs: [{ type: 'none' }],
  options: [
    { type: 'input', label: '本金', placeholder: '10000', default: '' },
    { type: 'input', label: '年利率（%）', placeholder: '3.5', default: '' },
    { type: 'input', label: '期限（年）', placeholder: '5', default: '' }
  ],
  action: '计算',
  handler: async (_, opts) => {
    const principal = parseFloat(opts[0]);
    const rate = parseFloat(opts[1]) / 100;
    const years = parseInt(opts[2]);
    if (!principal || !rate || !years) throw new Error('请填写完整信息');
    const simple = principal * rate * years;
    const compound = principal * Math.pow(1 + rate, years) - principal;
    return {
      text: `单利利息: ¥${simple.toFixed(2)}\n复利利息: ¥${compound.toFixed(2)}\n单利本息合计: ¥${(principal + simple).toFixed(2)}\n复利本息合计: ¥${(principal + compound).toFixed(2)}`
    };
  }
});

registerTool({
  id: 'password-gen', name: '密码生成器', category: '计算器工具',
  inputs: [{ type: 'none' }],
  options: [
    { type: 'input', label: '密码长度', placeholder: '16', default: '16' },
    { type: 'check', label: '包含大写字母', default: true },
    { type: 'check', label: '包含数字', default: true },
    { type: 'check', label: '包含特殊字符', default: true }
  ],
  action: '生成密码',
  handler: async (_, opts) => {
    const len = parseInt(opts[0]) || 16;
    const useUpper = opts[1] !== false;
    const useDigits = opts[2] !== false;
    const useSpecial = opts[3] !== false;
    let chars = 'abcdefghijklmnopqrstuvwxyz';
    if (useUpper) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (useDigits) chars += '0123456789';
    if (useSpecial) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?';
    const arr = new Uint32Array(len);
    crypto.getRandomValues(arr);
    const pw = Array.from(arr, v => chars[v % chars.length]).join('');
    return { text: `密码: ${pw}` };
  }
});

// ====== 创意工具 ======
registerTool({
  id: 'typing-test', name: '打字测试器', category: '创意工具',
  inputs: [{ type: 'none' }],
  options: [],
  action: '开始测试',
  handler: async () => { return { text: '打字测试器需要完整 UI 支持，请使用原版。' }; }
});

// ====== 清理工具 ======
registerTool({
  id: 'large-file-cleanup', name: 'AI 大文件清理', category: '清理工具',
  inputs: [{ type: 'none' }],
  options: [
    { type: 'input', label: '扫描目录', placeholder: 'C:\\Users', default: 'C:\\Users' },
    { type: 'input', label: '最小文件大小（MB）', placeholder: '100', default: '100' }
  ],
  action: '扫描',
  handler: async (_, opts) => {
    const dir = opts[0] || 'C:\\Users';
    const minSize = (parseInt(opts[1]) || 100) * 1024 * 1024;
    const result = await tauriInvoke('scan_large_files', { directory: dir, minSizeBytes: minSize });
    const files = result?.files || [];
    const lines = files.slice(0, 50).map(f => `${f.sizeMB}MB  ${f.path}`);
    return { text: `找到 ${files.length} 个大文件：\n\n${lines.join('\n')}` };
  }
});

// ====== AI 工具 ======
registerTool({
  id: 'ai-polish', name: 'AI 文字润色', category: 'AI 工具',
  inputs: [{ type: 'text', label: '输入要润色的文字' }],
  options: [],
  action: '润色',
  handler: async (_, __, textContent) => {
    if (!textContent) throw new Error('请输入文字');
    return { text: '需要配置 AI 密钥才能使用此功能。请在设置中配置。' };
  }
});

registerTool({
  id: 'ai-translate', name: 'AI 智能翻译', category: 'AI 工具',
  inputs: [{ type: 'text', label: '输入要翻译的文字' }],
  options: [
    { type: 'select', label: '目标语言', values: ['中文', 'English', '日本語', '한국어'], default: 'English' }
  ],
  action: '翻译',
  handler: async () => {
    return { text: '需要配置 AI 密钥才能使用此功能。请在设置中配置。' };
  }
});

registerTool({
  id: 'ai-doc', name: 'AI 文档生成', category: 'AI 工具',
  inputs: [{ type: 'text', label: '输入文档主题' }],
  options: [],
  action: '生成文档',
  handler: async () => {
    return { text: '需要配置 AI 密钥才能使用此功能。请在设置中配置。' };
  }
});

registerTool({
  id: 'ai-table', name: 'AI 表格生成', category: 'AI 工具',
  inputs: [{ type: 'text', label: '输入表格描述' }],
  options: [],
  action: '生成表格',
  handler: async () => {
    return { text: '需要配置 AI 密钥才能使用此功能。请在设置中配置。' };
  }
});

// ====== 硬件工具 ======
registerTool({
  id: 'hw-overview', name: '整机概览', category: '硬件工具',
  inputs: [{ type: 'none' }],
  options: [],
  action: '读取信息',
  handler: async () => {
    const result = await tauriInvoke('hardware_overview');
    return { text: formatHardwareInfo(result) };
  }
});

registerTool({
  id: 'hw-cpu', name: 'CPU 与内存', category: '硬件工具',
  inputs: [{ type: 'none' }],
  options: [],
  action: '读取信息',
  handler: async () => {
    const result = await tauriInvoke('inspect_cpu_memory');
    return { text: formatHardwareInfo(result) };
  }
});

registerTool({
  id: 'hw-gpu', name: 'GPU 与显示器', category: '硬件工具',
  inputs: [{ type: 'none' }],
  options: [],
  action: '读取信息',
  handler: async () => {
    const result = await tauriInvoke('inspect_gpu_display');
    return { text: formatHardwareInfo(result) };
  }
});

registerTool({
  id: 'hw-mainboard', name: '主板与固件', category: '硬件工具',
  inputs: [{ type: 'none' }],
  options: [],
  action: '读取信息',
  handler: async () => {
    const result = await tauriInvoke('inspect_mainboard_firmware');
    return { text: formatHardwareInfo(result) };
  }
});

registerTool({
  id: 'hw-storage', name: '存储健康', category: '硬件工具',
  inputs: [{ type: 'none' }],
  options: [],
  action: '读取信息',
  handler: async () => {
    const result = await tauriInvoke('inspect_storage_health');
    return { text: formatHardwareInfo(result) };
  }
});

registerTool({
  id: 'hw-network', name: '网络设备', category: '硬件工具',
  inputs: [{ type: 'none' }],
  options: [],
  action: '读取信息',
  handler: async () => {
    const result = await tauriInvoke('inspect_network_devices');
    return { text: formatHardwareInfo(result) };
  }
});

registerTool({
  id: 'hw-power', name: '电源传感器', category: '硬件工具',
  inputs: [{ type: 'none' }],
  options: [],
  action: '读取信息',
  handler: async () => {
    const result = await tauriInvoke('inspect_power_sensors');
    return { text: formatHardwareInfo(result) };
  }
});

// ---- 设置 ----
registerTool({
  id: 'settings', name: '设置', category: '_settings',
  inputs: [{ type: 'none' }],
  options: [],
  action: '',
  handler: null // 特殊处理
});

// ============================================
// 工具函数
// ============================================

async function readFileBytes(path) {
  if (isTauri) {
    const result = await tauriInvoke('read_file_bytes_limited', { path, maxBytes: 500 * 1024 * 1024 });
    return result;
  }
  throw new Error('文件读取仅在桌面端可用');
}

async function writeFileBytes(path, bytes) {
  if (isTauri) {
    await tauriInvoke('write_file_bytes', { path, bytes });
    return;
  }
  throw new Error('文件写入仅在桌面端可用');
}

async function getOutputDir(subFolder) {
  if (isTauri) {
    try {
      const root = await tauriInvoke('get_output_root');
      if (root) return root + '\\' + subFolder;
    } catch {}
    try {
      const def = await tauriInvoke('get_default_output_root');
      return def + '\\' + subFolder;
    } catch {}
  }
  return '~/Downloads/ToolKnit/' + subFolder;
}

async function getOutputPath(subFolder, fileName) {
  const dir = await getOutputDir(subFolder);
  return dir + '\\' + fileName;
}

function parsePageRange(range, total) {
  if (!range.trim()) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set();
  range.split(',').forEach(part => {
    const [a, b] = part.split('-').map(Number);
    if (b) for (let i = a; i <= b; i++) if (i >= 1 && i <= total) pages.add(i);
    else if (a >= 1 && a <= total) pages.add(a);
  });
  return [...pages].sort((a, b) => a - b);
}

function formatHardwareInfo(info) {
  if (!info) return '无法获取信息';
  if (typeof info === 'string') return info;
  if (Array.isArray(info)) return info.map(item =>
    Object.entries(item).map(([k, v]) => `${k}: ${v}`).join('\n')
  ).join('\n---\n');
  return Object.entries(info).map(([k, v]) => `${k}: ${v}`).join('\n');
}

function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

// ============================================
// 分类定义
// ============================================

const CATEGORIES = [
  { id: 'home', name: '首页' },
  { id: 'PDF 工具', name: 'PDF 工具' },
  { id: 'PPT 工具', name: 'PPT 工具' },
  { id: '图像工具', name: '图像工具' },
  { id: '音频工具', name: '音频工具' },
  { id: '视频工具', name: '视频工具' },
  { id: '文本工具', name: '文本工具' },
  { id: '计算器工具', name: '计算器工具' },
  { id: '创意工具', name: '创意工具' },
  { id: '清理工具', name: '清理工具' },
  { id: 'AI 工具', name: 'AI 工具' },
  { id: '硬件工具', name: '硬件工具' },
  { id: '_settings', name: '设置' },
];

// ============================================
// 侧栏渲染
// ============================================

const sidebar = document.getElementById('sidebar');
const content = document.getElementById('content');
const statusbar = document.getElementById('statusbar');
let currentCategory = 'home';

function renderSidebar() {
  sidebar.innerHTML = CATEGORIES.map(cat =>
    `<button class="nav-item${cat.id === currentCategory ? ' active' : ''}" data-cat="${escapeHtml(cat.id)}">${escapeHtml(cat.name)}</button>`
  ).join('');

  sidebar.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      currentCategory = btn.dataset.cat;
      renderSidebar();
      renderContent();
    });
  });
}

// ============================================
// 内容区渲染
// ============================================

function renderContent() {
  if (currentCategory === '_settings') {
    renderSettings();
    return;
  }
  if (currentCategory === 'home') {
    renderHome();
    return;
  }
  renderCategory(currentCategory);
}

function renderHome() {
  const toolCount = TOOLS.filter(t => t.category !== '_settings').length;
  let html = `<div class="section-title">全部工具（${toolCount}）</div>`;
  html += `<div class="search-box"><input type="text" id="toolSearch" placeholder="搜索工具..."></div>`;
  html += `<div class="tool-grid" id="toolGrid">`;

  CATEGORIES.filter(c => c.id !== 'home' && c.id !== '_settings').forEach(cat => {
    const catTools = TOOLS.filter(t => t.category === cat.id);
    if (catTools.length === 0) return;
    html += `<div class="section-title">${escapeHtml(cat.name)}</div>`;
    catTools.forEach(tool => {
      html += `<div class="tool-item" data-tool="${escapeHtml(tool.id)}">${escapeHtml(tool.name)}</div>`;
    });
  });

  html += `</div>`;
  content.innerHTML = html;

  // 搜索
  document.getElementById('toolSearch')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    content.querySelectorAll('.tool-item').forEach(el => {
      el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
    content.querySelectorAll('.section-title').forEach(el => {
      const next = el.nextElementSibling;
      if (next?.classList.contains('tool-grid')) {
        const visibleItems = next.querySelectorAll('.tool-item:not([style*="display: none"])');
        el.style.display = visibleItems.length ? '' : 'none';
      }
    });
  });

  // 工具点击
  content.querySelectorAll('.tool-item').forEach(el => {
    el.addEventListener('click', () => {
      const tool = TOOLS.find(t => t.id === el.dataset.tool);
      if (tool) {
        renderToolPage(tool);
      }
    });
  });
}

function renderCategory(catId) {
  const catTools = TOOLS.filter(t => t.category === catId);
  let html = `<div class="section-title">${escapeHtml(CATEGORIES.find(c => c.id === catId)?.name || catId)}</div>`;

  if (catTools.length === 0) {
    html += `<p style="color:#555;">该分类暂无工具。</p>`;
  } else {
    html += `<div class="tool-grid">`;
    catTools.forEach(tool => {
      html += `<div class="tool-item" data-tool="${escapeHtml(tool.id)}">${escapeHtml(tool.name)}</div>`;
    });
    html += `</div>`;
  }

  content.innerHTML = html;

  content.querySelectorAll('.tool-item').forEach(el => {
    el.addEventListener('click', () => {
      const tool = TOOLS.find(t => t.id === el.dataset.tool);
      if (tool) renderToolPage(tool);
    });
  });
}

// ============================================
// 工具页渲染（通用渲染器）
// ============================================

function renderToolPage(tool) {
  let html = `<div class="tool-page">`;
  html += `<button class="btn" id="toolBack" style="margin-bottom:12px;">← 返回</button>`;
  html += `<h2>${escapeHtml(tool.name)}</h2>`;

  // 文件选择
  if (tool.inputs.some(i => i.type === 'file')) {
    const input = tool.inputs.find(i => i.type === 'file');
    html += `<div class="form-row">`;
    html += `<label>${escapeHtml(input.label || '选择文件')}</label>`;
    html += `<div class="file-drop" id="fileDrop">点击选择文件</div>`;
    html += `<ul class="file-list" id="fileList"></ul>`;
    html += `</div>`;
  }

  // 文本输入
  if (tool.inputs.some(i => i.type === 'text')) {
    const input = tool.inputs.find(i => i.type === 'text');
    html += `<div class="form-row">`;
    html += `<label>${escapeHtml(input.label || '输入内容')}</label>`;
    html += `<textarea id="toolTextInput" rows="4" placeholder="${escapeHtml(input.label || '')}"></textarea>`;
    html += `</div>`;
  }

  // 选项
  tool.options.forEach((opt, idx) => {
    html += `<div class="form-row">`;
    html += `<label>${escapeHtml(opt.label)}</label>`;
    if (opt.type === 'select') {
      html += `<select id="opt_${idx}">`;
      opt.values.forEach(v => {
        html += `<option value="${escapeHtml(v)}"${v === opt.default ? ' selected' : ''}>${escapeHtml(v)}</option>`;
      });
      html += `</select>`;
    } else if (opt.type === 'input') {
      html += `<input type="text" id="opt_${idx}" placeholder="${escapeHtml(opt.placeholder || '')}" value="${escapeHtml(opt.default || '')}">`;
    } else if (opt.type === 'check') {
      html += `<label><input type="checkbox" id="opt_${idx}"${opt.default ? ' checked' : ''}> ${escapeHtml(opt.label)}</label>`;
    }
    html += `</div>`;
  });

  // 操作按钮
  if (tool.action) {
    html += `<div class="form-row" style="margin-top:12px;">`;
    html += `<button class="btn btn-primary" id="toolAction">${escapeHtml(tool.action)}</button>`;
    html += `</div>`;
  }

  // 进度条
  html += `<div class="progress-wrap" id="toolProgress">`;
  html += `<div class="progress-bar"><div class="progress-fill" id="toolProgressFill"></div></div>`;
  html += `<div class="progress-text" id="toolProgressText">处理中...</div>`;
  html += `</div>`;

  // 结果区
  html += `<div class="result" id="toolResult"></div>`;

  html += `</div>`;
  content.innerHTML = html;
  content.scrollTop = 0;

  // ---- 绑定事件 ----
  let selectedFiles = [];

  // 返回按钮
  document.getElementById('toolBack')?.addEventListener('click', () => {
    renderContent();
  });

  // 文件选择
  const fileDrop = document.getElementById('fileDrop');
  const fileList = document.getElementById('fileList');
  if (fileDrop) {
    fileDrop.addEventListener('click', async () => {
      const input = tool.inputs.find(i => i.type === 'file');
      try {
        const result = await openFile({
          multiple: input?.multiple || false,
          filters: input?.accept ? [{ name: 'Files', extensions: input.accept.replace(/\*/g, '').replace(/\./g, '').split(',').filter(Boolean) }] : undefined
        });
        if (result) {
          const newFiles = Array.isArray(result) ? result : [result];
          newFiles.forEach(f => {
            if (!selectedFiles.some(sf => sf.path === f.path)) {
              selectedFiles.push(f);
            }
          });
          renderFileList();
        }
      } catch (e) {
        console.error('File dialog error:', e);
      }
    });

    // 拖拽
    fileDrop.addEventListener('dragover', (e) => { e.preventDefault(); fileDrop.classList.add('dragover'); });
    fileDrop.addEventListener('dragleave', () => { fileDrop.classList.remove('dragover'); });
    fileDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      fileDrop.classList.remove('dragover');
      // 拖拽在 Tauri 中不直接提供路径，用 dialog 兜底
    });
  }

  function renderFileList() {
    if (!fileList) return;
    fileList.innerHTML = selectedFiles.map((f, i) =>
      `<li><span>${escapeHtml(f.name || f.path)}</span><button class="file-remove" data-idx="${i}">✕</button></li>`
    ).join('');
    fileList.querySelectorAll('.file-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedFiles.splice(parseInt(btn.dataset.idx), 1);
        renderFileList();
      });
    });
    fileDrop.textContent = selectedFiles.length ? `已选 ${selectedFiles.length} 个文件，点击添加` : '点击选择文件';
  }

  // 操作按钮
  document.getElementById('toolAction')?.addEventListener('click', async () => {
    const progress = document.getElementById('toolProgress');
    const progressFill = document.getElementById('toolProgressFill');
    const progressText = document.getElementById('toolProgressText');
    const resultDiv = document.getElementById('toolResult');

    // 收集选项值
    const opts = tool.options.map((opt, idx) => {
      const el = document.getElementById(`opt_${idx}`);
      if (!el) return opt.default;
      if (opt.type === 'check') return el.checked;
      return el.value;
    });

    // 收集文本输入
    const textInput = document.getElementById('toolTextInput');
    const textContent = textInput?.value || '';

    // 显示进度
    progress?.classList.add('visible');
    progressFill.style.width = '30%';
    progressText.textContent = '处理中...';
    resultDiv?.classList.remove('visible', 'success', 'error');

    try {
      const result = await tool.handler(selectedFiles, opts, textContent);

      progressFill.style.width = '100%';
      progressText.textContent = '完成';

      // 显示结果
      let resultHtml = '';
      if (result.text) {
        resultHtml = `<pre style="white-space:pre-wrap;font-size:12px;max-height:300px;overflow:auto;">${escapeHtml(result.text)}</pre>`;
      }
      if (result.output) {
        resultHtml += `<div style="margin-top:8px;"><strong>输出位置:</strong> ${escapeHtml(result.output)}</div>`;
        resultHtml += `<div class="result-actions">`;
        resultHtml += `<button class="btn" onclick="window.__openPath('${escapeHtml(result.output)}')">打开文件夹</button>`;
        resultHtml += `</div>`;
      }
      if (result.files?.length) {
        resultHtml += `<div style="margin-top:8px;"><strong>输出文件 (${result.files.length}):</strong></div>`;
        result.files.slice(0, 20).forEach(f => {
          resultHtml += `<div style="font-size:11px;color:#555;">${escapeHtml(f)}</div>`;
        });
        if (result.files.length > 20) resultHtml += `<div style="font-size:11px;color:#999;">...共 ${result.files.length} 个文件</div>`;
      }

      resultDiv.innerHTML = resultHtml || '<div>处理完成</div>';
      resultDiv.classList.add('visible', 'success');
      statusbar.textContent = `${tool.name} — 完成`;

    } catch (err) {
      progressFill.style.width = '0%';
      progressText.textContent = '';
      progress?.classList.remove('visible');
      resultDiv.innerHTML = `<div style="color:#e81123;">${escapeHtml(err.message || String(err))}</div>`;
      resultDiv.classList.add('visible', 'error');
      statusbar.textContent = `${tool.name} — 失败`;
    }
  });
}

// ============================================
// 设置页
// ============================================

function renderSettings() {
  let html = `<div class="settings-page">`;
  html += `<div class="section-title">设置</div>`;

  // 语言
  html += `<div class="settings-section">`;
  html += `<h3>语言 / Language</h3>`;
  html += `<div class="settings-row">`;
  html += `<button class="btn" id="setLangZh">中文</button>`;
  html += `<button class="btn" id="setLangEn">English</button>`;
  html += `</div></div>`;

  // AI 密钥
  html += `<div class="settings-section">`;
  html += `<h3>AI 密钥</h3>`;
  html += `<div class="settings-row">`;
  html += `<label>DeepSeek Key</label>`;
  html += `<input type="password" id="aiKeyInput" placeholder="sk-...">`;
  html += `</div>`;
  html += `<button class="btn" id="saveAiKey">保存</button>`;
  html += `<p style="font-size:11px;color:#555;margin-top:4px;">密钥仅保存在本机。</p>`;
  html += `</div>`;

  // 存储路径
  html += `<div class="settings-section">`;
  html += `<h3>存储位置</h3>`;
  html += `<div class="settings-row">`;
  html += `<span id="storagePath" style="font-size:12px;">--</span>`;
  html += `<button class="btn" id="chooseStorage">更改</button>`;
  html += `</div></div>`;

  // FFmpeg
  html += `<div class="settings-section">`;
  html += `<h3>FFmpeg 运行时</h3>`;
  html += `<div class="settings-row">`;
  html += `<span id="ffmpegStatus" style="font-size:12px;">检查中...</span>`;
  html += `</div></div>`;

  html += `</div>`;
  content.innerHTML = html;

  // 语言切换
  document.getElementById('setLangZh')?.addEventListener('click', () => {
    localStorage.setItem('toolknit-lang', 'zh');
    location.reload();
  });
  document.getElementById('setLangEn')?.addEventListener('click', () => {
    localStorage.setItem('toolknit-lang', 'en');
    location.reload();
  });

  // AI 密钥
  const savedKey = localStorage.getItem('toolknit-ai-key') || '';
  const aiInput = document.getElementById('aiKeyInput');
  if (aiInput && savedKey) aiInput.value = savedKey;
  document.getElementById('saveAiKey')?.addEventListener('click', () => {
    const val = aiInput?.value?.trim();
    if (val) localStorage.setItem('toolknit-ai-key', val);
    else localStorage.removeItem('toolknit-ai-key');
    statusbar.textContent = 'AI 密钥已保存';
  });

  // 存储路径
  if (isTauri) {
    tauriInvoke('get_output_root').then(p => {
      document.getElementById('storagePath').textContent = p || '默认';
    }).catch(() => {});
  }
  document.getElementById('chooseStorage')?.addEventListener('click', async () => {
    try {
      const result = await openFile({ directory: true });
      if (result) {
        await tauriInvoke('set_output_root', { outputDir: result });
        document.getElementById('storagePath').textContent = result;
      }
    } catch {}
  });

  // FFmpeg 状态
  if (isTauri) {
    tauriInvoke('check_ffmpeg').then(r => {
      document.getElementById('ffmpegStatus').textContent = r?.installed ? `已安装 (${r.version || ''})` : '未安装';
    }).catch(() => {
      document.getElementById('ffmpegStatus').textContent = '未知';
    });
  }
}

// ============================================
// 全局辅助
// ============================================

window.__openPath = async (path) => {
  if (isTauri) {
    try { await tauriInvoke('open_path', { path }); } catch {}
  }
};

// ============================================
// 启动
// ============================================

renderSidebar();
renderContent();
statusbar.textContent = 'ToolKnit Desktop 2.0 — 极简版';
