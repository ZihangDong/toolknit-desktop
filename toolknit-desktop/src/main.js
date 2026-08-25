// ============================================
// ToolKnit Desktop — Tkinter 极简 UI
// ============================================

import { t, getLang, setLang, onLangChange } from './i18n.js';

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
const TOOLS = [];
function registerTool(tool) { TOOLS.push(tool); }

// ====== PDF 工具 ======
registerTool({
  id: 'pdf-merge', nameKey: 'nav.pdfTools', name: 'PDF 合并', category: 'pdfTools',
  inputs: [{ type: 'file', multiple: true, accept: '.pdf', label: '选择 PDF 文件（至少 2 个）' }],
  options: [],
  action: '开始合并',
  handler: async (files) => {
    if (files.length < 2) throw new Error('至少需要 2 个 PDF 文件');
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
  id: 'pdf-split', name: 'PDF 拆分', category: 'pdfTools',
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
    for (const i of pages) {
      const doc = await PDFDocument.create();
      const [page] = await doc.copyPages(src, [i - 1]);
      doc.addPage(page);
      const outBytes = await doc.save();
      const p = outDir + '\\' + `split_page_${i}.pdf`;
      await writeFileBytes(p, outBytes);
      outPaths.push(p);
    }
    return { output: outDir, files: outPaths };
  }
});

registerTool({
  id: 'pdf-to-image', name: 'PDF 转图像', category: 'pdfTools',
  inputs: [{ type: 'file', accept: '.pdf', label: '选择 PDF 文件' }],
  options: [
    { type: 'select', label: '输出格式', values: ['PNG', 'JPG'], default: 'PNG' },
    { type: 'select', label: '缩放', values: ['1x', '2x', '3x'], default: '2x' }
  ],
  action: '开始转换',
  handler: async (files, opts) => {
    const outDir = await getOutputDir('PDF_ToImage');
    const result = await tauriInvoke('pdf_to_images', {
      inputPath: files[0].path, outputDir: outDir,
      format: (opts[0] || 'PNG').toLowerCase(), scale: parseInt(opts[1]) || 2
    });
    return { output: outDir, files: result?.files || [] };
  }
});

registerTool({
  id: 'pdf-rotate', name: 'PDF 页面旋转', category: 'pdfTools',
  inputs: [{ type: 'file', accept: '.pdf', label: '选择 PDF 文件' }],
  options: [{ type: 'select', label: '旋转角度', values: ['90', '180', '270'], default: '90' }],
  action: '开始旋转',
  handler: async (files, opts) => {
    const bytes = await readFileBytes(files[0].path);
    const { PDFDocument, degrees } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    const angle = parseInt(opts[0]) || 90;
    doc.getPages().forEach(p => p.setRotation(degrees((p.getRotation().angle + angle) % 360)));
    const outBytes = await doc.save();
    const outPath = await getOutputPath('PDF_Rotate', files[0].name.replace('.pdf', '_rotated.pdf'));
    await writeFileBytes(outPath, outBytes);
    return { output: outPath };
  }
});

registerTool({
  id: 'pdf-encrypt', name: 'PDF 文件加密', category: 'pdfTools',
  inputs: [{ type: 'file', accept: '.pdf', label: '选择 PDF 文件' }],
  options: [{ type: 'input', label: '密码', placeholder: '请输入密码' }],
  action: '开始加密',
  handler: async (files, opts) => {
    if (!opts[0]) throw new Error('请输入密码');
    const result = await tauriInvoke('encrypt_pdf', {
      inputPath: files[0].path, password: opts[0],
      outputDir: await getOutputDir('PDF_Encrypt')
    });
    return { output: result?.outputPath || '' };
  }
});

registerTool({
  id: 'pdf-decrypt', name: 'PDF 文件解密', category: 'pdfTools',
  inputs: [{ type: 'file', accept: '.pdf', label: '选择加密的 PDF 文件' }],
  options: [{ type: 'input', label: '密码', placeholder: '请输入密码' }],
  action: '开始解密',
  handler: async (files, opts) => {
    if (!opts[0]) throw new Error('请输入密码');
    const result = await tauriInvoke('decrypt_pdf', {
      inputPath: files[0].path, password: opts[0],
      outputDir: await getOutputDir('PDF_Decrypt')
    });
    return { output: result?.outputPath || '' };
  }
});

registerTool({
  id: 'pdf-compress', name: 'PDF 文件压缩', category: 'pdfTools',
  inputs: [{ type: 'file', accept: '.pdf', label: '选择 PDF 文件' }],
  options: [{ type: 'select', label: '压缩等级', values: ['low', 'medium', 'high'], default: 'medium' }],
  action: '开始压缩',
  handler: async (files, opts) => {
    const result = await tauriInvoke('compress_pdf', {
      inputPath: files[0].path, level: opts[0] || 'medium',
      outputDir: await getOutputDir('PDF_Compress')
    });
    return { output: result?.outputPath || '' };
  }
});

registerTool({
  id: 'pdf-editor', name: 'PDF 编辑器', category: 'pdfTools',
  inputs: [{ type: 'file', accept: '.pdf', label: '选择 PDF 文件' }],
  options: [],
  action: '打开编辑器',
  handler: async () => { throw new Error('PDF 编辑器需要完整 UI 支持'); }
});

registerTool({
  id: 'pdf-enhance', name: 'PDF 文字增强', category: 'pdfTools',
  inputs: [{ type: 'file', accept: '.pdf', label: '选择 PDF 文件' }],
  options: [],
  action: '开始增强',
  handler: async () => { throw new Error('文字增强需要完整 UI 支持'); }
});

// ====== PPT 工具 ======
registerTool({
  id: 'ppt-to-pdf', name: 'PPT 转 PDF', category: 'pptTools',
  inputs: [{ type: 'file', accept: '.pptx', label: '选择 PPT 文件' }],
  options: [],
  action: '开始转换',
  handler: async (files) => {
    const outDir = await getOutputDir('PPT_ToPDF');
    const result = await tauriInvoke('ppt_to_pdf', { inputPath: files[0].path, outputDir: outDir });
    return { output: result?.outputPath || outDir };
  }
});

registerTool({
  id: 'ppt-to-image', name: 'PPT 转图片', category: 'pptTools',
  inputs: [{ type: 'file', accept: '.pptx', label: '选择 PPT 文件' }],
  options: [{ type: 'select', label: '输出格式', values: ['PNG', 'JPG'], default: 'PNG' }],
  action: '开始转换',
  handler: async (files, opts) => {
    const outDir = await getOutputDir('PPT_ToImage');
    const result = await tauriInvoke('ppt_to_images', {
      inputPath: files[0].path, outputDir: outDir, format: (opts[0] || 'png').toLowerCase()
    });
    return { output: outDir, files: result?.files || [] };
  }
});

registerTool({
  id: 'ppt-image-extract', name: 'PPT 图片提取', category: 'pptTools',
  inputs: [{ type: 'file', accept: '.pptx', label: '选择 PPT 文件' }],
  options: [],
  action: '提取图片',
  handler: async (files) => {
    const outDir = await getOutputDir('PPT_Images');
    const result = await tauriInvoke('ppt_extract_images', { inputPath: files[0].path, outputDir: outDir });
    return { output: outDir, files: result?.files || [] };
  }
});

registerTool({
  id: 'ppt-text-extract', name: 'PPT 文本提取', category: 'pptTools',
  inputs: [{ type: 'file', accept: '.pptx', label: '选择 PPT 文件' }],
  options: [{ type: 'select', label: '输出格式', values: ['TXT', 'Markdown'], default: 'TXT' }],
  action: '提取文本',
  handler: async (files) => {
    const result = await tauriInvoke('ppt_extract_text', { inputPath: files[0].path });
    return { text: result?.text || '' };
  }
});

registerTool({
  id: 'ppt-compress', name: 'PPT 压缩', category: 'pptTools',
  inputs: [{ type: 'file', accept: '.pptx', label: '选择 PPT 文件' }],
  options: [{ type: 'select', label: '压缩等级', values: ['low', 'medium', 'high'], default: 'medium' }],
  action: '开始压缩',
  handler: async (files, opts) => {
    const outDir = await getOutputDir('PPT_Compress');
    const result = await tauriInvoke('ppt_compress', {
      inputPath: files[0].path, level: opts[0] || 'medium', outputDir: outDir
    });
    return { output: result?.outputPath || outDir };
  }
});

registerTool({
  id: 'ppt-outline', name: 'AI 生成 PPT 大纲', category: 'pptTools',
  inputs: [{ type: 'text', label: '输入主题和内容描述' }],
  options: [{ type: 'select', label: '类型', values: ['product', 'pitch', 'report', 'training', 'review'], default: 'report' }],
  action: '生成大纲',
  handler: async () => ({ text: '需要配置 AI 密钥才能使用此功能。请在设置中配置。' })
});

registerTool({
  id: 'ppt-draft', name: 'AI 生成 PPT 草稿', category: 'pptTools',
  inputs: [{ type: 'text', label: '输入主题和内容描述' }],
  options: [],
  action: '生成草稿',
  handler: async () => ({ text: '需要配置 AI 密钥才能使用此功能。请在设置中配置。' })
});

// ====== 图像工具 ======
registerTool({
  id: 'image-convert', name: '图片格式转换', category: 'imageTools',
  inputs: [{ type: 'file', multiple: true, accept: 'image/*', label: '选择图片文件' }],
  options: [{ type: 'select', label: '目标格式', values: ['PNG', 'JPG', 'WebP', 'BMP', 'GIF'], default: 'PNG' }],
  action: '开始转换',
  handler: async (files, opts) => {
    const outDir = await getOutputDir('Image_Convert');
    const result = await tauriInvoke('image_batch_convert', {
      inputPaths: files.map(f => f.path), outputDir: outDir, format: (opts[0] || 'png').toLowerCase()
    });
    return { output: outDir, files: result?.files || [] };
  }
});

registerTool({
  id: 'image-compress', name: '图片压缩', category: 'imageTools',
  inputs: [{ type: 'file', multiple: true, accept: 'image/*', label: '选择图片文件' }],
  options: [{ type: 'select', label: '质量', values: ['low', 'medium', 'high'], default: 'medium' }],
  action: '开始压缩',
  handler: async (files, opts) => {
    const outDir = await getOutputDir('Image_Compress');
    const result = await tauriInvoke('image_batch_compress', {
      inputPaths: files.map(f => f.path), outputDir: outDir, quality: opts[0] || 'medium'
    });
    return { output: outDir, files: result?.files || [] };
  }
});

registerTool({
  id: 'image-stitch', name: '长图拼接', category: 'imageTools',
  inputs: [{ type: 'file', multiple: true, accept: 'image/*', label: '选择图片文件' }],
  options: [{ type: 'select', label: '方向', values: ['vertical', 'horizontal'], default: 'vertical' }],
  action: '开始拼接',
  handler: async (files, opts) => {
    const result = await tauriInvoke('image_stitch', {
      inputPaths: files.map(f => f.path), outputDir: await getOutputDir('Image_Stitch'),
      direction: opts[0] || 'vertical'
    });
    return { output: result?.outputPath || '' };
  }
});

registerTool({
  id: 'icon-gen', name: '图标生成器', category: 'imageTools',
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
  id: 'color-extract', name: '配色提取器', category: 'imageTools',
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
  id: 'audio-convert', name: '音频格式转换', category: 'audioTools',
  inputs: [{ type: 'file', multiple: true, accept: 'audio/*', label: '选择音频文件' }],
  options: [{ type: 'select', label: '目标格式', values: ['MP3', 'AAC', 'WAV', 'FLAC', 'ALAC', 'OGG'], default: 'MP3' }],
  action: '开始转换',
  handler: async (files, opts) => {
    const outDir = await getOutputDir('Audio_Convert');
    const result = await tauriInvoke('audio_batch_convert', {
      inputPaths: files.map(f => f.path), outputDir: outDir, format: opts[0] || 'MP3'
    });
    return { output: outDir, files: result?.files || [] };
  }
});

registerTool({
  id: 'bpm-detect', name: 'BPM 节拍测速', category: 'audioTools',
  inputs: [{ type: 'file', accept: 'audio/*', label: '选择音频文件' }],
  options: [],
  action: '分析 BPM',
  handler: async (files) => {
    const result = await tauriInvoke('detect_bpm', { inputPath: files[0].path });
    return { text: `BPM: ${result?.bpm || '未知'}` };
  }
});

registerTool({
  id: 'audio-extract', name: '音频提取', category: 'audioTools',
  inputs: [{ type: 'file', accept: 'video/*', label: '选择视频文件' }],
  options: [{ type: 'select', label: '输出格式', values: ['MP3', 'AAC', 'WAV', 'FLAC'], default: 'MP3' }],
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
  id: 'audio-clip', name: '音频剪辑', category: 'audioTools',
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
      startTime: parseFloat(opts[0]) || 0, endTime: opts[1] ? parseFloat(opts[1]) : undefined
    });
    return { output: result?.outputPath || outDir };
  }
});

// ====== 视频工具 ======
registerTool({
  id: 'video-convert', name: '视频格式转换', category: 'videoTools',
  inputs: [{ type: 'file', multiple: true, accept: 'video/*', label: '选择视频文件' }],
  options: [{ type: 'select', label: '目标格式', values: ['MP4', 'AVI', 'MKV', 'MOV', 'WebM'], default: 'MP4' }],
  action: '开始转换',
  handler: async (files, opts) => {
    const outDir = await getOutputDir('Video_Convert');
    const result = await tauriInvoke('video_batch_convert', {
      inputPaths: files.map(f => f.path), outputDir: outDir, format: opts[0] || 'MP4'
    });
    return { output: outDir, files: result?.files || [] };
  }
});

registerTool({
  id: 'video-frame', name: '视频高清单帧图', category: 'videoTools',
  inputs: [{ type: 'file', accept: 'video/*', label: '选择视频文件' }],
  options: [{ type: 'input', label: '时间点（如 00:01:30）', placeholder: '00:00:00', default: '00:00:00' }],
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
  id: 'video-gif', name: '视频截取 GIF', category: 'videoTools',
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
      startTime: parseFloat(opts[0]) || 0, duration: parseFloat(opts[1]) || 5
    });
    return { output: result?.outputPath || outDir };
  }
});

// ====== 文本工具 ======
registerTool({
  id: 'transcription', name: '音视频提取文字', category: 'textTools',
  inputs: [{ type: 'file', accept: 'audio/*,video/*', label: '选择音频或视频文件' }],
  options: [{ type: 'select', label: '输出格式', values: ['TXT', 'SRT', 'JSON'], default: 'TXT' }],
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
  id: 'text-stats', name: '文本统计器', category: 'textTools',
  inputs: [{ type: 'file', accept: '.txt,.md,.csv,.json,.html,.xml,.log', label: '选择文本文件' }],
  options: [],
  action: '开始统计',
  handler: async (files) => {
    const bytes = await readFileBytes(files[0].path);
    const text = new TextDecoder('utf-8').decode(bytes);
    const { calculateTextStats } = await import('./text-stats-core.js');
    const s = calculateTextStats(text);
    return { text: [
      `字符: ${s.chars}`, `无空格: ${s.charsNoSpace}`, `单词: ${s.words}`,
      `行: ${s.lines}`, `段落: ${s.paragraphs}`, `句子: ${s.sentences}`,
      `中文: ${s.chineseChars}`, `大写: ${s.uppercase}  小写: ${s.lowercase}`,
      `数字: ${s.digits}  标点: ${s.punctuation}`, `阅读: ~${s.readingTime}分钟`
    ].join('\n') };
  }
});

registerTool({
  id: 'text-format', name: '文本格式化', category: 'textTools',
  inputs: [{ type: 'file', accept: '.txt,.md,.csv', label: '选择文本文件' }],
  options: [],
  action: '格式化',
  handler: async (files) => {
    const bytes = await readFileBytes(files[0].path);
    const text = new TextDecoder('utf-8').decode(bytes);
    const { executeTextFormat } = await import('./text-format-core.js');
    return { text: executeTextFormat(text) };
  }
});

// ====== 计算器工具 ======
registerTool({
  id: 'bmi-calc', name: '体脂率计算器', category: 'calculator',
  inputs: [{ type: 'none' }],
  options: [
    { type: 'input', label: '身高 (cm)', placeholder: '170' },
    { type: 'input', label: '体重 (kg)', placeholder: '65' },
    { type: 'input', label: '年龄', placeholder: '25' },
    { type: 'select', label: '性别', values: ['男', '女'], default: '男' }
  ],
  action: '计算',
  handler: async (_, opts) => {
    const h = parseFloat(opts[0]) / 100, w = parseFloat(opts[1]), age = parseInt(opts[2]);
    if (!h || !w) throw new Error('请输入身高和体重');
    const bmi = w / (h * h);
    const bf = opts[3] === '男' ? 1.20 * bmi + 0.23 * age - 16.2 : 1.20 * bmi + 0.23 * age - 5.4;
    return { text: `BMI: ${bmi.toFixed(1)}\n估算体脂率: ${bf.toFixed(1)}%\n注意：此为粗略估算，仅供参考。` };
  }
});

registerTool({
  id: 'timestamp-calc', name: '时间戳计算器', category: 'calculator',
  inputs: [{ type: 'none' }],
  options: [{ type: 'input', label: '时间戳（秒）', placeholder: '留空=当前时间' }],
  action: '转换',
  handler: async (_, opts) => {
    const ts = opts[0] ? parseInt(opts[0]) : Math.floor(Date.now() / 1000);
    const d = new Date(ts * 1000);
    return { text: `时间戳: ${ts}\n日期: ${d.toLocaleString('zh-CN')}\nISO: ${d.toISOString()}` };
  }
});

registerTool({
  id: 'mortgage-calc', name: '房贷计算器', category: 'calculator',
  inputs: [{ type: 'none' }],
  options: [
    { type: 'input', label: '贷款总额（万元）', placeholder: '100' },
    { type: 'input', label: '年利率（%）', placeholder: '3.5' },
    { type: 'input', label: '贷款年限（年）', placeholder: '30' }
  ],
  action: '计算',
  handler: async (_, opts) => {
    const total = parseFloat(opts[0]) * 10000, rate = parseFloat(opts[1]) / 100 / 12, months = parseInt(opts[2]) * 12;
    if (!total || !rate || !months) throw new Error('请填写完整信息');
    const pmt = total * rate * Math.pow(1 + rate, months) / (Math.pow(1 + rate, months) - 1);
    return { text: `月供: ¥${pmt.toFixed(2)}\n总还款: ¥${(pmt * months).toFixed(2)}\n总利息: ¥${(pmt * months - total).toFixed(2)}` };
  }
});

registerTool({
  id: 'interest-calc', name: '利息计算器', category: 'calculator',
  inputs: [{ type: 'none' }],
  options: [
    { type: 'input', label: '本金', placeholder: '10000' },
    { type: 'input', label: '年利率（%）', placeholder: '3.5' },
    { type: 'input', label: '期限（年）', placeholder: '5' }
  ],
  action: '计算',
  handler: async (_, opts) => {
    const p = parseFloat(opts[0]), r = parseFloat(opts[1]) / 100, y = parseInt(opts[2]);
    if (!p || !r || !y) throw new Error('请填写完整信息');
    const simple = p * r * y, compound = p * Math.pow(1 + r, y) - p;
    return { text: `单利利息: ¥${simple.toFixed(2)}\n复利利息: ¥${compound.toFixed(2)}\n单利合计: ¥${(p + simple).toFixed(2)}\n复利合计: ¥${(p + compound).toFixed(2)}` };
  }
});

registerTool({
  id: 'password-gen', name: '密码生成器', category: 'calculator',
  inputs: [{ type: 'none' }],
  options: [
    { type: 'input', label: '密码长度', placeholder: '16', default: '16' },
    { type: 'check', label: '大写字母', default: true },
    { type: 'check', label: '数字', default: true },
    { type: 'check', label: '特殊字符', default: true }
  ],
  action: '生成密码',
  handler: async (_, opts) => {
    let chars = 'abcdefghijklmnopqrstuvwxyz';
    if (opts[1]) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (opts[2]) chars += '0123456789';
    if (opts[3]) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?';
    const arr = new Uint32Array(parseInt(opts[0]) || 16);
    crypto.getRandomValues(arr);
    return { text: `密码: ${Array.from(arr, v => chars[v % chars.length]).join('')}` };
  }
});

// ====== 创意工具 ======
registerTool({
  id: 'typing-test', name: '打字测试器', category: 'creative',
  inputs: [{ type: 'none' }], options: [], action: '开始测试',
  handler: async () => ({ text: '打字测试器需要完整 UI 支持。' })
});

// ====== 清理工具 ======
registerTool({
  id: 'large-file-cleanup', name: 'AI 大文件清理', category: 'cleanupTools',
  inputs: [{ type: 'none' }],
  options: [
    { type: 'input', label: '扫描目录', placeholder: 'C:\\Users', default: 'C:\\Users' },
    { type: 'input', label: '最小文件大小（MB）', placeholder: '100', default: '100' }
  ],
  action: '扫描',
  handler: async (_, opts) => {
    const result = await tauriInvoke('scan_large_files', {
      directory: opts[0] || 'C:\\Users', minSizeBytes: (parseInt(opts[1]) || 100) * 1024 * 1024
    });
    const files = result?.files || [];
    return { text: `找到 ${files.length} 个大文件：\n\n${files.slice(0, 50).map(f => `${f.sizeMB}MB  ${f.path}`).join('\n')}` };
  }
});

// ====== AI 工具 ======
registerTool({ id: 'ai-polish', name: 'AI 文字润色', category: 'aiTools', inputs: [{ type: 'text', label: '输入要润色的文字' }], options: [], action: '润色', handler: async () => ({ text: '需要配置 AI 密钥。请在设置中配置。' }) });
registerTool({ id: 'ai-translate', name: 'AI 智能翻译', category: 'aiTools', inputs: [{ type: 'text', label: '输入要翻译的文字' }], options: [{ type: 'select', label: '目标语言', values: ['中文', 'English', '日本語'], default: 'English' }], action: '翻译', handler: async () => ({ text: '需要配置 AI 密钥。请在设置中配置。' }) });
registerTool({ id: 'ai-doc', name: 'AI 文档生成', category: 'aiTools', inputs: [{ type: 'text', label: '输入文档主题' }], options: [], action: '生成文档', handler: async () => ({ text: '需要配置 AI 密钥。请在设置中配置。' }) });
registerTool({ id: 'ai-table', name: 'AI 表格生成', category: 'aiTools', inputs: [{ type: 'text', label: '输入表格描述' }], options: [], action: '生成表格', handler: async () => ({ text: '需要配置 AI 密钥。请在设置中配置。' }) });

// ====== 硬件工具 ======
registerTool({ id: 'hw-overview', name: '整机概览', category: 'hardware', inputs: [{ type: 'none' }], options: [], action: '读取信息', handler: async () => ({ text: formatHw(await tauriInvoke('hardware_overview')) }) });
registerTool({ id: 'hw-cpu', name: 'CPU 与内存', category: 'hardware', inputs: [{ type: 'none' }], options: [], action: '读取信息', handler: async () => ({ text: formatHw(await tauriInvoke('inspect_cpu_memory')) }) });
registerTool({ id: 'hw-gpu', name: 'GPU 与显示器', category: 'hardware', inputs: [{ type: 'none' }], options: [], action: '读取信息', handler: async () => ({ text: formatHw(await tauriInvoke('inspect_gpu_display')) }) });
registerTool({ id: 'hw-mainboard', name: '主板与固件', category: 'hardware', inputs: [{ type: 'none' }], options: [], action: '读取信息', handler: async () => ({ text: formatHw(await tauriInvoke('inspect_mainboard_firmware')) }) });
registerTool({ id: 'hw-storage', name: '存储健康', category: 'hardware', inputs: [{ type: 'none' }], options: [], action: '读取信息', handler: async () => ({ text: formatHw(await tauriInvoke('inspect_storage_health')) }) });
registerTool({ id: 'hw-network', name: '网络设备', category: 'hardware', inputs: [{ type: 'none' }], options: [], action: '读取信息', handler: async () => ({ text: formatHw(await tauriInvoke('inspect_network_devices')) }) });
registerTool({ id: 'hw-power', name: '电源传感器', category: 'hardware', inputs: [{ type: 'none' }], options: [], action: '读取信息', handler: async () => ({ text: formatHw(await tauriInvoke('inspect_power_sensors')) }) });

// ============================================
// 工具函数
// ============================================

function esc(s) { const e = document.createElement('span'); e.textContent = s; return e.innerHTML; }

async function readFileBytes(path) {
  if (!isTauri) throw new Error('文件读取仅在桌面端可用');
  return tauriInvoke('read_file_bytes_limited', { path, maxBytes: 500 * 1024 * 1024 });
}

async function writeFileBytes(path, bytes) {
  if (!isTauri) throw new Error('文件写入仅在桌面端可用');
  await tauriInvoke('write_file_bytes', { path, bytes });
}

async function getOutputDir(sub) {
  if (isTauri) {
    try { const r = await tauriInvoke('get_output_root'); if (r) return r + '\\' + sub; } catch {}
    try { return (await tauriInvoke('get_default_output_root')) + '\\' + sub; } catch {}
  }
  return '~/Downloads/ToolKnit/' + sub;
}

async function getOutputPath(sub, name) { return (await getOutputDir(sub)) + '\\' + name; }

function parsePageRange(range, total) {
  if (!range.trim()) return Array.from({ length: total }, (_, i) => i + 1);
  const s = new Set();
  range.split(',').forEach(p => {
    const [a, b] = p.split('-').map(Number);
    if (b) for (let i = a; i <= b; i++) if (i >= 1 && i <= total) s.add(i);
    else if (a >= 1 && a <= total) s.add(a);
  });
  return [...s].sort((a, b) => a - b);
}

function formatHw(info) {
  if (!info) return '无法获取信息';
  if (typeof info === 'string') return info;
  if (Array.isArray(info)) return info.map(i => Object.entries(i).map(([k, v]) => `${k}: ${v}`).join('\n')).join('\n---\n');
  return Object.entries(info).map(([k, v]) => `${k}: ${v}`).join('\n');
}

// ============================================
// 分类 + 侧栏
// ============================================

const CATS = [
  { id: 'home', label: 'nav.home', icon: '⌂' },
  { id: 'pdfTools', label: 'nav.pdfTools', icon: 'PDF' },
  { id: 'pptTools', label: 'nav.pptTools', icon: 'PPT' },
  { id: 'imageTools', label: 'nav.imageTools', icon: 'IMG' },
  { id: 'audioTools', label: 'nav.audioTools', icon: '♪' },
  { id: 'videoTools', label: 'nav.videoTools', icon: '▶' },
  { id: 'textTools', label: 'nav.textTools', icon: 'TXT' },
  { id: 'calculator', label: 'nav.calculator', icon: '#' },
  { id: 'creative', label: 'nav.creative', icon: '✦' },
  { id: 'cleanupTools', label: 'nav.cleanupTools', icon: '♻' },
  { id: 'aiTools', label: 'nav.aiTools', icon: 'AI' },
  { id: 'hardware', label: 'nav.hardware', icon: '⚙' },
  { id: '_settings', label: 'nav.settings', icon: '⚙' },
];

const sidebar = document.getElementById('sidebar');
const content = document.getElementById('content');
const statusbar = document.getElementById('statusbar');
let curCat = 'home';

function renderSidebar() {
  sidebar.innerHTML = CATS.map(c =>
    `<button class="nav-item${c.id === curCat ? ' active' : ''}" data-cat="${esc(c.id)}"><span class="nav-icon">${c.icon}</span><span class="nav-label" data-i18n="${c.label}">${t(c.label)}</span></button>`
  ).join('');
  sidebar.querySelectorAll('.nav-item').forEach(btn => {
    btn.onclick = () => { curCat = btn.dataset.cat; renderSidebar(); renderContent(); };
  });
}

// ============================================
// 内容区
// ============================================

function renderContent() {
  if (curCat === '_settings') return renderSettings();
  if (curCat === 'home') return renderHome();
  renderCategory(curCat);
}

function renderHome() {
  const toolCount = TOOLS.filter(t => t.category !== '_settings').length;
  let h = `<div class="content-header"><h1>${t('app.title')}</h1><p class="subtitle">${t('home.posterDesc')}</p></div>`;
  h += `<div class="search-box"><input type="text" id="toolSearch" placeholder="${t('home.searchPlaceholder') || '搜索工具...'}"></div>`;

  CATS.filter(c => c.id !== 'home' && c.id !== '_settings').forEach(cat => {
    const tools = TOOLS.filter(t => t.category === cat.id);
    if (!tools.length) return;
    h += `<div class="section-title" data-i18n="${cat.label}">${t(cat.label)}</div>`;
    h += `<div class="tool-grid">`;
    tools.forEach(tool => {
      h += `<div class="tool-item" data-tool="${esc(tool.id)}">${esc(tool.name)}</div>`;
    });
    h += `</div>`;
  });

  content.innerHTML = h;

  document.getElementById('toolSearch')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    content.querySelectorAll('.tool-item').forEach(el => {
      el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  content.querySelectorAll('.tool-item').forEach(el => {
    el.onclick = () => { const tool = TOOLS.find(t => t.id === el.dataset.tool); if (tool) renderToolPage(tool); };
  });
}

function renderCategory(catId) {
  const tools = TOOLS.filter(t => t.category === catId);
  const cat = CATS.find(c => c.id === catId);
  let h = `<div class="content-header"><button class="btn btn-back" id="toolBack">← ${t('nav.home')}</button><h1>${cat ? t(cat.label) : catId}</h1></div>`;
  h += `<div class="tool-grid">`;
  tools.forEach(tool => {
    h += `<div class="tool-item" data-tool="${esc(tool.id)}">${esc(tool.name)}</div>`;
  });
  h += `</div>`;
  content.innerHTML = h;

  document.getElementById('toolBack')?.addEventListener('click', () => { curCat = 'home'; renderSidebar(); renderContent(); });
  content.querySelectorAll('.tool-item').forEach(el => {
    el.onclick = () => { const tool = TOOLS.find(t => t.id === el.dataset.tool); if (tool) renderToolPage(tool); };
  });
}

// ============================================
// 工具页（通用渲染器）
// ============================================

function renderToolPage(tool) {
  let h = `<div class="tool-page">`;
  h += `<div class="content-header"><button class="btn btn-back" id="toolBack">← ${t(CATS.find(c => c.id === tool.category)?.label || 'nav.home')}</button><h1>${esc(tool.name)}</h1></div>`;

  // 文件选择
  if (tool.inputs.some(i => i.type === 'file')) {
    const inp = tool.inputs.find(i => i.type === 'file');
    h += `<div class="form-group"><label class="form-label">${esc(inp.label || '选择文件')}</label>`;
    h += `<div class="file-drop" id="fileDrop"><span class="file-drop-icon">📂</span><span>${esc(inp.label || '点击选择文件')}</span></div>`;
    h += `<ul class="file-list" id="fileList"></ul></div>`;
  }

  // 文本输入
  if (tool.inputs.some(i => i.type === 'text')) {
    const inp = tool.inputs.find(i => i.type === 'text');
    h += `<div class="form-group"><label class="form-label">${esc(inp.label || '输入内容')}</label>`;
    h += `<textarea id="toolTextInput" rows="4" placeholder="${esc(inp.label || '')}"></textarea></div>`;
  }

  // 选项
  tool.options.forEach((opt, idx) => {
    h += `<div class="form-group"><label class="form-label">${esc(opt.label)}</label>`;
    if (opt.type === 'select') {
      h += `<select id="opt_${idx}">${opt.values.map(v => `<option value="${esc(v)}"${v === opt.default ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
    } else if (opt.type === 'input') {
      h += `<input type="text" id="opt_${idx}" placeholder="${esc(opt.placeholder || '')}" value="${esc(opt.default || '')}">`;
    } else if (opt.type === 'check') {
      h += `<label class="check-label"><input type="checkbox" id="opt_${idx}"${opt.default ? ' checked' : ''}> ${esc(opt.label)}</label>`;
    }
    h += `</div>`;
  });

  // 操作按钮
  if (tool.action) {
    h += `<div class="form-actions"><button class="btn btn-primary" id="toolAction">${esc(tool.action)}</button></div>`;
  }

  // 进度
  h += `<div class="progress-wrap" id="toolProgress"><div class="progress-bar"><div class="progress-fill" id="toolProgressFill"></div></div><div class="progress-text" id="toolProgressText"></div></div>`;

  // 结果
  h += `<div class="result" id="toolResult"></div>`;
  h += `</div>`;
  content.innerHTML = h;
  content.scrollTop = 0;

  // ---- 事件 ----
  let selectedFiles = [];

  document.getElementById('toolBack')?.addEventListener('click', () => renderCategory(tool.category));

  const fileDrop = document.getElementById('fileDrop');
  const fileList = document.getElementById('fileList');

  if (fileDrop) {
    fileDrop.onclick = async () => {
      const inp = tool.inputs.find(i => i.type === 'file');
      try {
        const result = await openFile({
          multiple: inp?.multiple || false,
          filters: inp?.accept ? [{ name: 'Files', extensions: inp.accept.replace(/\*/g, '').replace(/\./g, '').split(',').filter(Boolean) }] : undefined
        });
        if (result) {
          (Array.isArray(result) ? result : [result]).forEach(f => {
            if (!selectedFiles.some(sf => sf.path === f.path)) selectedFiles.push(f);
          });
          renderFL();
        }
      } catch (e) { console.error(e); }
    };
  }

  function renderFL() {
    if (!fileList) return;
    fileList.innerHTML = selectedFiles.map((f, i) =>
      `<li><span class="file-name">${esc(f.name || f.path)}</span><button class="file-remove" data-i="${i}">✕</button></li>`
    ).join('');
    fileList.querySelectorAll('.file-remove').forEach(b => {
      b.onclick = () => { selectedFiles.splice(parseInt(b.dataset.i), 1); renderFL(); };
    });
    if (fileDrop) fileDrop.querySelector('span:last-child').textContent = selectedFiles.length ? `已选 ${selectedFiles.length} 个文件` : (tool.inputs.find(i => i.type === 'file')?.label || '点击选择文件');
  }

  // 执行
  document.getElementById('toolAction')?.addEventListener('click', async () => {
    const prog = document.getElementById('toolProgress');
    const fill = document.getElementById('toolProgressFill');
    const ptxt = document.getElementById('toolProgressText');
    const res = document.getElementById('toolResult');

    const opts = tool.options.map((opt, idx) => {
      const el = document.getElementById(`opt_${idx}`);
      return opt.type === 'check' ? el?.checked : el?.value || opt.default;
    });
    const textContent = document.getElementById('toolTextInput')?.value || '';

    prog?.classList.add('visible');
    fill.style.width = '30%';
    ptxt.textContent = t('common.processing') || '处理中...';
    res?.classList.remove('visible', 'success', 'error');

    try {
      const result = await tool.handler(selectedFiles, opts, textContent);
      fill.style.width = '100%';
      ptxt.textContent = t('common.done') || '完成';

      let rh = '';
      if (result.text) rh += `<pre class="result-text">${esc(result.text)}</pre>`;
      if (result.output) {
        rh += `<div class="result-path"><strong>${t('common.output') || '输出'}:</strong> ${esc(result.output)}</div>`;
        rh += `<div class="result-actions"><button class="btn" onclick="window.__openPath('${esc(result.output)}')">${t('common.openFolder') || '打开文件夹'}</button></div>`;
      }
      if (result.files?.length) {
        rh += `<div class="result-path"><strong>${t('common.output') || '输出'} (${result.files.length}):</strong></div>`;
        result.files.slice(0, 20).forEach(f => { rh += `<div class="result-file">${esc(f)}</div>`; });
      }

      res.innerHTML = rh || `<div>${t('common.done') || '处理完成'}</div>`;
      res.classList.add('visible', 'success');
      statusbar.textContent = `${tool.name} — ${t('common.done') || '完成'}`;
    } catch (err) {
      fill.style.width = '0%';
      prog?.classList.remove('visible');
      res.innerHTML = `<div class="result-error">${esc(err.message || String(err))}</div>`;
      res.classList.add('visible', 'error');
      statusbar.textContent = `${tool.name} — ${t('common.failed') || '失败'}`;
    }
  });
}

// ============================================
// 设置页
// ============================================

function renderSettings() {
  const lang = getLang();
  let h = `<div class="settings-page">`;
  h += `<div class="content-header"><button class="btn btn-back" id="toolBack">← ${t('nav.home')}</button><h1>${t('nav.settings')}</h1></div>`;

  // 语言
  h += `<div class="settings-section"><h3>${t('settings.language')}</h3>`;
  h += `<div class="settings-row"><button class="btn${lang === 'zh' ? ' btn-active' : ''}" id="setLangZh">中文</button><button class="btn${lang === 'en' ? ' btn-active' : ''}" id="setLangEn">English</button></div></div>`;

  // AI
  h += `<div class="settings-section"><h3>${t('settings.aiFeatures') || 'AI 功能'}</h3>`;
  h += `<div class="settings-row"><label>${t('settings.configureApiKey') || '密钥'}</label><input type="password" id="aiKeyInput" placeholder="sk-..."></div>`;
  h += `<button class="btn" id="saveAiKey">${t('common.save') || '保存'}</button>`;
  h += `<p class="settings-hint">${t('settings.aiProviderHint') || '密钥仅保存在本机。'}</p></div>`;

  // 存储
  h += `<div class="settings-section"><h3>${t('settings.storagePath') || '存储位置'}</h3>`;
  h += `<div class="settings-row"><span id="storagePath" class="settings-value">--</span><button class="btn" id="chooseStorage">${t('settings.customStorageFolder') || '更改'}</button></div></div>`;

  // FFmpeg
  h += `<div class="settings-section"><h3>${t('settings.ffmpegRuntime') || 'FFmpeg 运行时'}</h3>`;
  h += `<div class="settings-row"><span id="ffmpegStatus" class="settings-value">${t('common.loading') || '检查中...'}</span></div></div>`;

  h += `</div>`;
  content.innerHTML = h;
  content.scrollTop = 0;

  // 返回
  document.getElementById('toolBack')?.addEventListener('click', () => { curCat = 'home'; renderSidebar(); renderContent(); });

  // 语言切换 — 调用 i18n 模块
  document.getElementById('setLangZh')?.addEventListener('click', () => { setLang('zh'); renderAll(); });
  document.getElementById('setLangEn')?.addEventListener('click', () => { setLang('en'); renderAll(); });

  // AI 密钥
  const savedKey = localStorage.getItem('toolknit-ai-key') || '';
  const aiInput = document.getElementById('aiKeyInput');
  if (aiInput && savedKey) aiInput.value = savedKey;
  document.getElementById('saveAiKey')?.addEventListener('click', () => {
    const val = aiInput?.value?.trim();
    if (val) localStorage.setItem('toolknit-ai-key', val);
    else localStorage.removeItem('toolknit-ai-key');
    statusbar.textContent = t('common.done') || '已保存';
  });

  // 存储路径
  if (isTauri) {
    tauriInvoke('get_output_root').then(p => { document.getElementById('storagePath').textContent = p || '默认'; }).catch(() => {});
  }
  document.getElementById('chooseStorage')?.addEventListener('click', async () => {
    try {
      const result = await openFile({ directory: true });
      if (result) { await tauriInvoke('set_output_root', { outputDir: result }); document.getElementById('storagePath').textContent = result; }
    } catch {}
  });

  // FFmpeg
  if (isTauri) {
    tauriInvoke('check_ffmpeg').then(r => {
      document.getElementById('ffmpegStatus').textContent = r?.installed ? `${r.version || ''}` : (t('settings.ffmpegRuntimeEmpty') || '未安装');
    }).catch(() => { document.getElementById('ffmpegStatus').textContent = '—'; });
  }
}

// ============================================
// 全局刷新
// ============================================

function renderAll() {
  renderSidebar();
  renderContent();
}

// 监听语言变化
onLangChange(() => renderAll());

// ============================================
// 启动
// ============================================

window.__openPath = async (path) => {
  if (isTauri) { try { await tauriInvoke('open_path', { path }); } catch {} }
};

renderAll();
statusbar.textContent = `ToolKnit Desktop 2.0 — easyui`;
