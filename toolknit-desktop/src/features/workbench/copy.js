export const COPY = {
  previousPage:['上一页','Previous page'],nextPage:['下一页','Next page'],
  workspace:['文档与自动化','Documents & automation'], search:['文档内容搜索','Document content search'], compare:['文档对比','Document comparison'], subtitles:['字幕工作台','Subtitle workbench'], folders:['文件夹自动处理','Folder automation'],
  searchHint:['在选定文件夹中建立本机文字索引，搜索 PDF、DOCX 和文本里的内容。','Index a chosen folder locally and search inside PDFs, DOCX and text files.'],
  addFolder:['选择文件夹并索引','Choose folder & index'], addFiles:['添加文档','Add documents'], clearIndex:['清除文字索引','Clear text index'], searchPlaceholder:['搜索文档内容，至少 2 个字','Search document contents, at least 2 characters'], searchAction:['搜索内容','Search contents'], cancel:['取消','Cancel'],
  searchLimits:['每次最多 2000 份文档、单份 64 MB；每份索引前 20 万字符。扫描件请先 OCR。','Up to 2,000 documents per scan, 64 MB per file; indexes the first 200,000 characters. Run OCR on scanned documents first.'],
  searchEmpty:['先添加文档或选择一个文件夹','Add documents or choose a folder first'], searchLocal:['索引保存在本机。浏览器版仅在本次会话搜索所选文件。','The index stays on this device. Browser mode searches selected files in this session.'],
  openLocation:['打开所在位置','Show in folder'], indexed:['已索引','Indexed'], truncated:['内容已截断','Text truncated'], noMatches:['没有匹配结果','No matching results'],
  compareHint:['导入两份文档或粘贴文字，逐行查看新增和删除；比较的是文字内容。','Import two documents or paste text to inspect added and removed lines. Compares text content.'],
  before:['原文','Before'], after:['新文','After'], loadBefore:['导入原文','Load before'], loadAfter:['导入新文','Load after'], compareAction:['开始对比','Compare'], ignoreSpace:['忽略空白差异','Ignore whitespace differences'], changesOnly:['仅显示变化','Changes only'], exportDiff:['导出差异报告','Export diff'], previous:['上一处','Previous'], next:['下一处','Next'],
  compareLimits:['支持 PDF、DOCX 和文本。每份最多 10000 行；大范围修改会按整块显示并明确提示。','Supports PDFs, DOCX and text. Up to 10,000 lines each; very large edits are shown as a labeled replacement block.'],
  compareEmpty:['添加两份文档后，变化会显示在这里。','Add two documents to see changes here.'],
  subtitleHint:['导入字幕或本地转写，编辑时间和文字，再导出 SRT / VTT。','Import subtitles or transcribe locally, edit timings and text, then export SRT / VTT.'],
  importSubtitles:['导入 SRT / VTT','Import SRT / VTT'], chooseMedia:['选择音视频','Choose media'], transcribe:['本地转写为字幕','Transcribe locally'], exportSrt:['导出 SRT','Export SRT'], exportVtt:['导出 VTT','Export VTT'],
  cueEditor:['编辑选中字幕','Edit selected cue'], startTime:['开始时间','Start time'], endTime:['结束时间','End time'], cueText:['字幕文字','Cue text'], addCue:['新增字幕','Add cue'], deleteCue:['删除字幕','Delete cue'], splitCue:['在播放位置拆分','Split at playhead'],
  offset:['整体偏移（毫秒）','Shift all cues (ms)'], applyOffset:['应用偏移','Apply shift'], subtitleList:['字幕列表','Subtitle cues'], playCue:['播放此句','Play cue'], language:['转写语言','Transcription language'], auto:['自动识别','Auto detect'],
  subtitleEmpty:['导入一份字幕，或添加第一条字幕。','Import subtitles or add the first cue.'], subtitleLimits:['支持最多 5000 条字幕。时间格式为 00:00:00,000；重叠会提示，时间无效会阻止导出。草稿自动保存在本机。','Up to 5,000 cues. Time format: 00:00:00,000. Overlaps are marked; invalid timings block export. Drafts are saved locally.'],
  foldersHint:['文件写入稳定后执行规则；关闭主窗口后可在托盘继续处理。','Run rules after files finish writing; processing continues while the app stays in the tray.'],
  ruleName:['规则名称','Rule name'], inputFolder:['监控文件夹','Watch folder'], outputFolder:['输出文件夹','Output folder'], choose:['选择','Choose'], action:['处理方式','Action'], imageConvert:['图片格式转换','Convert image format'], imageCompress:['图片压缩','Compress images'], archiveCopy:['按扩展名复制归档','Copy into extension folders'],
  format:['目标格式','Target format'], quality:['压缩质量','Compression quality'], high:['高','High'], medium:['均衡','Balanced'], low:['较小文件','Smaller file'], enableRule:['启用规则','Enable rule'], saveRule:['保存规则','Save rule'], resetRule:['新建规则','New rule'], rules:['我的规则','My rules'], history:['最近处理记录','Recent processing history'], refresh:['刷新','Refresh'], edit:['编辑','Edit'], delete:['删除','Delete'], pause:['暂停','Pause'], resume:['启用','Enable'], retry:['重试','Retry'],
  foldersLimits:['仅桌面版。最多 8 条规则，只监控文件夹第一层，最多 5000 个目录项。首次启用跳过已有文件；原文件保留，输出目录须与输入目录分开。','Desktop only. Up to 8 rules, watching the top folder level with at most 5,000 entries. Existing files are skipped on enable; originals are kept and output folders must be separate.'],
  folderEmpty:['还没有自动处理规则','No folder rules yet'], noHistory:['还没有处理记录','No processing history yet'], enabled:['已启用','Enabled'], paused:['已暂停','Paused'], desktopOnly:['此功能需要桌面版访问本机文件夹。','This feature needs the desktop app to access local folders.'],
  launcher:['快捷启动器','Quick launcher'], launcherHint:['搜索工具，Enter 打开，↑ ↓ 选择，Esc 返回。','Search tools; Enter to open, ↑ ↓ to select, Esc to close.'], launcherPlaceholder:['搜索工具或粘贴文件名…','Search tools or paste a filename…'], shortcut:['系统快捷键','Global shortcut'], saveShortcut:['保存快捷键','Save shortcut'], disableShortcut:['关闭系统快捷键','Disable global shortcut'], recent:['最近使用','Recent tools'], suggestions:['适合此文件的工具','Tools for this file'], allTools:['工具搜索','Tool search'],
  pasteHint:['粘贴文件名或路径可推荐工具；打开后在工具中添加文件。','Paste a filename or path for tool suggestions, then add the file in that tool.'], shortcutHint:['默认 Ctrl+Shift+Space；应用内也可按 Ctrl+K。','Default: Ctrl+Shift+Space. Ctrl+K also works inside the app.']
};
export const copy = (key, lang = 'zh') => COPY[key]?.[lang === 'en' ? 1 : 0] || key;
export function applyCopy(root, lang) {
  root.querySelectorAll('[data-wb-copy]').forEach(node => { node.textContent = copy(node.dataset.wbCopy, lang); });
  root.querySelectorAll('[data-wb-placeholder]').forEach(node => { node.placeholder = copy(node.dataset.wbPlaceholder, lang); });
}
