import { getLang } from './i18n.js';
import { HELP_CONTENT_EN } from './help-data-en.js';

export const HELP_CONTENT = {
  'overview': {
    title: '功能概览',
    html: `<div class="help-doc">
      <h2>ToolKnit 功能概览</h2>
      <p>ToolKnit 是一款<strong>纯本地</strong>多功能工具箱桌面应用，涵盖 PDF、图像、音频、视频、文本、计算器、创意和 AI 八大工具分类，所有文件处理均在本地完成，不上传服务器。</p>

      <h3>工具分类一览</h3>
      <div class="help-tool-grid">
        <div class="help-tool-card"><div class="help-tool-card-name">PDF 工具</div><div class="help-tool-card-desc">合并、拆分、旋转、加密、解密、压缩、文字增强</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">图像工具</div><div class="help-tool-card-desc">格式转换、图片压缩、长图拼接、图标生成器</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">音频工具</div><div class="help-tool-card-desc">格式转换、BPM 测速、剪辑、从视频提取音频</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">视频工具</div><div class="help-tool-card-desc">格式转换、高清单帧图、最长 30 秒 GIF</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">文本工具</div><div class="help-tool-card-desc">音视频转文字、文本统计、文本格式化</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">计算器工具</div><div class="help-tool-card-desc">体脂率、时间戳、房贷、利息、密码生成</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">创意工具</div><div class="help-tool-card-desc">配色提取、打字测试</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">AI 工具</div><div class="help-tool-card-desc">AI 润色、翻译、可编辑文档、可编辑表格</div></div>
      </div>

      <h3>核心特性</h3>
      <ul>
        <li><strong>纯本地处理</strong>：所有文件操作在设备本地完成，文件不上传任何服务器</li>
        <li><strong>批量操作</strong>：支持批量文件处理，提高工作效率</li>
        <li><strong>拖拽上传</strong>：支持拖拽文件到工具页面直接处理</li>
        <li><strong>双语界面</strong>：支持中文和英文切换</li>
        <li><strong>多种工作方式</strong>：桌面端负责可视化预览，CLI 适合命令和批处理，IDE Agent 可用自然语言调用已接入能力</li>
        <li><strong>按需依赖</strong>：用到音视频功能时再下载 FFmpeg；用到音视频转文字时再选择下载离线模型</li>
      </ul>

      <div class="help-note">
        <p>本地工具不会上传文件。只有你主动使用 AI 润色、翻译、文档、表格或转写二次润色时，对应文字才会发送到你自己配置的 AI 服务。</p>
      </div>
    </div>`
  },

  'install': {
    title: '安装与启动',
    html: `<div class="help-doc">
      <h2>安装与启动</h2>

      <h3>系统要求</h3>
      <ul>
        <li>操作系统：Windows 10/11（64 位）</li>
        <li>内存：建议 4GB 以上</li>
        <li>磁盘空间：至少 200MB；FFmpeg 和离线模型按需下载，所需空间因所选模型而异</li>
      </ul>

      <h3>安装步骤</h3>
      <ol class="help-steps">
        <li>下载 ToolKnit 安装包（<code>.exe</code> 安装程序）</li>
        <li>双击运行安装程序，选择安装路径</li>
        <li>等待安装完成，桌面会出现 ToolKnit 快捷方式</li>
        <li>双击快捷方式启动应用</li>
      </ol>

      <h3>首次启动</h3>
      <p>首次启动不强制下载任何附加组件。进入需要 FFmpeg 的音视频工具，或使用“音视频提取文字”时，程序会清楚说明缺少的依赖并提供下载入口。</p>

      <div class="help-note">
        <p>在设置中可为 FFmpeg 和离线模型选择自动、官方或国内镜像源。下载完成后，本地处理可离线运行。</p>
      </div>
    </div>`
  },

  'settings': {
    title: '设置与偏好',
    html: `<div class="help-doc">
      <h2>设置与偏好</h2>
      <p>点击左侧边栏底部的<strong>设置图标</strong>进入设置页面。这里负责应用级配置，不会改变任何原始文件。</p>

      <h3>语言切换</h3>
      <p>支持<strong>中文</strong>和<strong>English</strong>两种语言，切换后界面立即生效。</p>

      <h3>AI 密钥</h3>
      <p>AI 文档、AI 表格、AI 润色、AI 翻译和可选的转写润色需要在这里配置 AI 平台密钥。密钥只保存在本机；PDF、图片、音频、视频等本地工具不需要密钥。</p>

      <h3>离线识别模型</h3>
      <p>“音视频提取文字”首次使用前需要下载一个本地模型。<strong>Small</strong> 是默认推荐项；Base 更小更快，Medium 更偏向质量。下载完成后，语音识别可离线运行；只有你主动开启“AI 二次润色”时，识别出的文字才会发送给所配置的 AI 平台。</p>

      <h3>FFmpeg 运行时</h3>
      <p>音频转换、音频剪辑、音频提取、视频转换、单帧图、GIF 和转写预处理都需要 FFmpeg。安装包不再内置它：可在这里选择自动、官方或国内镜像下载。进入相关工具时若未安装，也会弹出依赖安装窗口。</p>

      <h3>默认存储位置</h3>
      <p>默认位置是<strong>下载目录下的 ToolKnit</strong>。你可以改成任意已有文件夹。每个输出会自动进入对应工具的二级目录，例如 <code>PDF_Merge</code>、<code>PDF_Split</code>、<code>Images</code>、<code>Videos</code>、<code>Transcripts</code>、<code>AI_Doc</code> 和 <code>AI_Table</code>；原文件不会被改写。</p>

      <h3>自定义背景</h3>
      <p>可上传图片或视频，用于首页和所有分类页。程序会在内容上方保留遮罩，保证文字可读；点击“清除”即可立即回到 ToolKnit 默认动态背景。</p>

      <h3>帮助与反馈</h3>
      <p>点击"帮助中心"打开本帮助页面；点击"反馈 BUG"可提交问题反馈。</p>
    </div>`
  },

  'cli-guide': {
    title: 'CLI 命令行入门',
    html: `<div class="help-doc">
      <h2>CLI 命令行入门</h2>
      <p><strong>桌面端</strong>适合点选与预览；<strong>CLI</strong>适合 PowerShell、脚本和批量任务；<strong>IDE Agent</strong>则由你用自然语言下达目标，再通过 CLI/MCP 调用同一套文件处理能力。三者不会互相替代，也不需要一直开着桌面程序。</p>

      <h3>先确认 CLI 可用</h3>
      <ol class="help-steps">
        <li>安装 ToolKnit CLI 后，在 PowerShell 执行 <code>toolknit doctor</code></li>
        <li>看到环境状态后，执行 <code>toolknit --help</code> 查看全部命令</li>
        <li>需要某个命令的参数和示例时，执行 <code>toolknit help &lt;分类&gt; &lt;工具&gt;</code>，例如 <code>toolknit help video gif</code></li>
      </ol>

      <h3>命令分类</h3>
      <ul>
        <li><code>pdf</code>：查看、合并、拆分、旋转、加密、解密、压缩、扫描件增强</li>
        <li><code>audio</code>：格式转换、BPM、剪辑、从视频提取音轨</li>
        <li><code>model</code> 与 <code>transcribe</code>：管理本地识别模型、把音频或视频输出为 TXT、SRT、JSON</li>
        <li><code>video</code>：格式转换、精确导出单帧图、截取最长 30 秒 GIF</li>
        <li><code>text stats</code>、<code>image colors</code>、<code>image stitch</code>：本地统计、取色、长图拼接</li>
        <li><code>ai-doc</code> 与 <code>ai-table</code>：生成、检查、编辑、撤销和重新渲染可编辑工程</li>
      </ul>

      <h3>CLI 的安全默认值</h3>
      <p>所有会写文件的命令都要求明确输出位置。已有文件默认不会覆盖，只有显式传入 <code>--overwrite</code> 才会替换。密码不会作为命令行参数出现；JSON 输出、管道输出和 MCP 模式也不会混入 ASCII 横幅。</p>

      <div class="help-note"><p>CLI 和 IDE Agent 使用的是单独的环境配置。桌面端保存的 AI 密钥不会自动交给 CLI；只有 AI 文档、AI 表格和 AI 二次润色需要在 CLI/MCP 进程中配置密钥。</p></div>
    </div>`
  },

  'update': {
    title: '版本更新',
    html: `<div class="help-doc">
      <h2>版本与更新</h2>
      <p>设置页会显示当前桌面端版本。当前发行方式不会在后台静默下载或强制安装更新。</p>
      <ol class="help-steps">
        <li>在 GitHub Release 或项目发布页查看新版本说明与安装包</li>
        <li>先关闭 ToolKnit 主窗口（它会驻留到系统托盘），再从托盘菜单选择“退出”</li>
        <li>运行新安装程序完成覆盖安装</li>
        <li>重新启动后，在设置页确认版本号</li>
      </ol>
      <div class="help-note"><p>桌面端设置、已下载的 FFmpeg 与离线模型位于本机应用数据目录；是否保留它们取决于卸载时是否选择清除应用数据。</p></div>
    </div>`
  },

  'pdf-merge': {
    title: 'PDF 文件合并',
    html: `<div class="help-doc">
      <h2>PDF 文件合并</h2>
      <p>将多个 PDF 文件按顺序合并为一个 PDF 文件。</p>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>在 PDF 工具分类中点击"PDF 文件合并"</li>
        <li>点击"上传 PDF 文件"或拖拽文件到页面</li>
        <li>拖拽文件列表可调整合并顺序</li>
        <li>点击"开始合并"按钮</li>
        <li>等待处理完成，成功后弹出提示并可打开保存文件夹</li>
      </ol>

      <h3>注意事项</h3>
      <ul>
        <li>所有文件必须是 PDF 格式</li>
        <li>合并顺序按列表中的排列顺序</li>
        <li>处理完成后文件保存到默认存储位置</li>
      </ul>
    </div>`
  },

  'pdf-split': {
    title: 'PDF 文件拆分',
    html: `<div class="help-doc">
      <h2>PDF 文件拆分</h2>
      <p>预览 PDF 的每一页，选择需要导出的页面并生成独立 PDF 文件。</p>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>上传需要拆分的 PDF 文件</li>
        <li>点击"开始拆分"以生成页面预览</li>
        <li>点击页面选择或取消选择，也可单独导出某一页</li>
        <li>点击"导出已选页面"，在保存目录查看拆分后的文件</li>
      </ol>

      <div class="help-note">
        <p>每个导出文件只包含一个原始页面。单次最多处理 25 个文件、150 MB 输入和 200 页预览。</p>
      </div>
    </div>`
  },

  'pdf-rotate': {
    title: 'PDF 页面旋转',
    html: `<div class="help-doc">
      <h2>PDF 页面旋转</h2>
      <p>旋转 PDF 中的页面方向，支持单页旋转和整体旋转。</p>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>上传 PDF 文件</li>
        <li>选择旋转角度：90°、180°、270°</li>
        <li>选择旋转范围：全部页面或指定页面</li>
        <li>点击"开始旋转"，完成后下载结果</li>
      </ol>

      <div class="help-note">
        <p>单次支持 1 个 PDF、150 MB 输入和 200 页预览。受密码保护的 PDF 请先使用“PDF 文件解密”工具解锁。</p>
      </div>
    </div>`
  },

  'pdf-encrypt': {
    title: 'PDF 文件加密',
    html: `<div class="help-doc">
      <h2>PDF 文件加密</h2>
      <p>为 PDF 文件添加密码保护和权限控制。</p>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>上传需要加密的 PDF 文件</li>
        <li>设置至少 8 位的打开密码</li>
        <li>选择权限：是否允许打印、复制、修改</li>
        <li>点击"确认加密"，完成后在保存目录查看加密后的 PDF</li>
      </ol>

      <div class="help-note">
        <p>单次支持 1 个 PDF、150 MB 输入和 200 页。请妥善保管密码，忘记密码后将无法恢复 PDF 内容；已加密的 PDF 请先使用“PDF 文件解密”工具解锁。</p>
      </div>
    </div>`
  },

  'pdf-decrypt': {
    title: 'PDF 文件解密',
    html: `<div class="help-doc">
      <h2>PDF 文件解密</h2>
      <p>移除 PDF 文件的密码保护和使用限制。</p>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>上传已加密的 PDF 文件</li>
        <li>输入正确的密码</li>
        <li>点击"开始解密"</li>
        <li>完成后下载解密后的 PDF</li>
      </ol>

      <div class="help-note">
        <p>解密需要知道原密码，无法破解未知密码的 PDF。单次支持 1 个 PDF、150 MB 输入和 200 页；如果文件只有权限限制而没有打开密码，可将密码留空。</p>
      </div>
    </div>`
  },

  'pdf-compress': {
    title: 'PDF 文件压缩',
    html: `<div class="help-doc">
      <h2>PDF 文件压缩</h2>
      <p>压缩 PDF 文件体积，支持三种压缩等级。</p>

      <h3>压缩等级</h3>
      <ul>
        <li><strong>低</strong>：轻度压缩，画质损失最小</li>
        <li><strong>中</strong>：平衡压缩，推荐大多数场景</li>
        <li><strong>高</strong>：最大压缩，体积最小但画质有一定损失</li>
      </ul>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>上传一个或多个 PDF 文件</li>
        <li>选择压缩等级</li>
        <li>点击"开始压缩"</li>
        <li>处理完成后查看压缩结果，支持打开文件夹</li>
      </ol>
    </div>`
  },

  'pdf-enhance': {
    title: 'PDF 文字增强',
    html: `<div class="help-doc">
      <h2>PDF 文字增强</h2>
      <p>提升扫描件和图像型 PDF 中模糊文字的可读性，通过对比度与锐化处理增强页面图像。</p>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>上传需要增强的 PDF 文件</li>
        <li>选择轻度、中度或强力增强</li>
        <li>点击"开始增强"并等待处理完成</li>
        <li>在结果中定位增强后的 PDF</li>
      </ol>

      <div class="help-note">
        <p>此功能会将页面栅格化，输出不保留原始可搜索文字、链接或表单。仅适合扫描件和图像型 PDF；效果取决于原始扫描质量。</p>
      </div>
    </div>`
  },

  'img-convert': {
    title: '图片格式转换',
    html: `<div class="help-doc">
      <h2>图片格式转换</h2>
      <p>支持 JPG、PNG、WebP、BMP、GIF、SVG 六种图片格式输出，支持批量处理。</p>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>在图像工具分类中点击"图片格式转换"</li>
        <li>上传一个或多个图片文件</li>
        <li>选择目标格式（JPG / PNG / WebP / BMP / GIF / SVG）</li>
        <li>点击"开始转换"</li>
        <li>处理完成后弹出成功提示，可打开保存文件夹</li>
      </ol>

      <div class="help-note">
        <p>转换过程保留原始分辨率，不改变图片尺寸。</p>
      </div>
    </div>`
  },

  'img-compress': {
    title: '图片压缩',
    html: `<div class="help-doc">
      <h2>图片压缩</h2>
      <p>压缩图片体积，支持三档画质选择，批量处理。</p>

      <h3>压缩等级</h3>
      <ul>
        <li><strong>低</strong>：高质量，体积较大</li>
        <li><strong>中</strong>：平衡画质与体积（推荐）</li>
        <li><strong>高</strong>：最大压缩，体积最小</li>
      </ul>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>上传一个或多个图片文件</li>
        <li>选择压缩等级</li>
        <li>点击"开始压缩"</li>
        <li>处理完成后显示压缩结果，可打开文件夹查看</li>
      </ol>

      <p>支持格式：JPG / PNG / WebP / BMP / GIF</p>
    </div>`
  },

  'image-stitch': {
    title: '长图拼接',
    html: `<div class="help-doc">
      <h2>长图拼接</h2>
      <p>把 2–100 张 JPG、PNG、WebP、BMP 或静态 GIF 按指定顺序拼成一张完整图片。全程在本机完成，不修改源文件。</p>

      <h3>推荐流程</h3>
      <ol class="help-steps">
        <li>点击“添加图片”、拖入图片，或点击“从 PDF 导入”把最多 100 页按页码转换为本地临时图片；动态 GIF 会被明确拒绝</li>
        <li>在左侧拖拽排序，也可使用上移、下移和删除按钮</li>
        <li>选择上下或左右拼接，并确定以首张、最小或最大尺寸为基准</li>
        <li>在右侧检查实时预览与预计像素尺寸，再设置间距、比例、背景、格式和可选文件名</li>
        <li>点击“开始拼接”；完成后通过结果弹框打开输出文件夹</li>
      </ol>

      <h3>尺寸规则</h3>
      <ul>
        <li><strong>上下拼接</strong>：所有图片统一宽度，高度按原比例计算</li>
        <li><strong>左右拼接</strong>：所有图片统一高度，宽度按原比例计算</li>
        <li><strong>0px 间距</strong>：图片边缘直接相接，不插入额外像素</li>
        <li><strong>比例</strong>：10–100%；超出安全尺寸时会自动降低比例并明确提示</li>
      </ul>

      <h3>输出说明</h3>
      <p>PNG 支持透明背景并无损编码；JPG 会把透明区域铺到所选背景色，质量范围 60–100，默认 92。输出位于全局存储位置下的 <code>Images/Image Stitch</code> 子目录。可填写安全文件名；重名时自动追加序号，绝不覆盖已有文件。</p>

      <div class="help-note"><p>图片排序就是最终拼接顺序。PDF 临时页面在拼接完成、取消或下次启动时清理；用户已有的导出图片不会被删除。清空、取消或处理失败都不会留下残缺输出。</p></div>
    </div>`
  },

  'icon-gen': {
    title: '图标生成器',
    html: `<div class="help-doc">
      <h2>图标生成器</h2>
      <p>上传一张图片，一键生成全套图标（PNG 多尺寸 + ICO + SVG），打包为 ZIP 下载。</p>

      <h3>生成内容</h3>
      <ul>
        <li><strong>PNG 图标</strong>：16/24/32/48/64/96/128/144/152/167/180/192/256/384/512/1024px 共 16 种尺寸</li>
        <li><strong>ICO 文件</strong>：多尺寸 ICO（16~256px），适用于 Windows 应用程序图标</li>
        <li><strong>favicon.ico</strong>：经典网站 favicon（16/32/48px）</li>
        <li><strong>SVG 文件</strong>：矢量图标，任意尺寸不失真</li>
      </ul>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>上传一张图片（JPG 或 PNG）</li>
        <li>点击"开始生成"</li>
        <li>等待蜘蛛精灵遮罩层显示生成进度</li>
        <li>生成完成后自动下载 <code>icons.zip</code></li>
        <li>成功弹框中可点击"打开文件夹"查看文件</li>
      </ol>

      <div class="help-note">
        <p>图片会自动裁剪为正方形（居中裁剪），建议使用正方形或接近正方形的图片以获得最佳效果。</p>
      </div>
    </div>`
  },

  'audio-convert': {
    title: '音频格式转换',
    html: `<div class="help-doc">
      <h2>音频格式转换</h2>
      <p>支持 MP3、AAC、WAV、FLAC、ALAC、OGG、WMA 等格式互转，批量处理。</p>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>在音频工具分类中点击"音频文件格式转换"</li>
        <li>上传一个或多个音频文件</li>
        <li>选择目标格式</li>
        <li>点击"开始处理"并查看每个文件的实际进度</li>
        <li>完成后打开保存目录查看唯一命名的输出文件</li>
      </ol>

      <div class="help-note">
        <p>首次使用音频转换需要下载 FFmpeg 扩展包（约 80-100MB），下载后即可离线使用。</p>
      </div>

      <h3>格式说明</h3>
      <ul>
        <li><strong>MP3</strong>：最通用有损格式，兼容性最好</li>
        <li><strong>AAC</strong>：高压缩比有损格式</li>
        <li><strong>WAV</strong>：无损未压缩格式</li>
        <li><strong>FLAC</strong>：无损压缩格式</li>
        <li><strong>OGG</strong>：开源有损格式</li>
      </ul>
    </div>`
  },

  'bpm-detect': {
    title: 'BPM 节拍测速',
    html: `<div class="help-doc">
      <h2>BPM 节拍测速器</h2>
      <p>上传音频文件，自动检测音乐的 BPM（每分钟节拍数）。</p>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>上传音频文件</li>
        <li>点击"开始检测"</li>
        <li>等待分析完成，显示 BPM 结果</li>
      </ol>

      <div class="help-note">
        <p>BPM 检测对纯音乐/电子音乐效果最佳，人声为主的歌曲可能检测不够准确。</p>
      </div>
    </div>`
  },

  'audio-clip': {
    title: '音频剪辑',
    html: `<div class="help-doc">
      <h2>音频剪辑</h2>
      <p>波形可视化剪辑，支持区域选择、播放预览、精准裁剪。</p>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>上传音频文件</li>
        <li>在波形图上拖拽选择要保留的区域</li>
        <li>点击播放预览选中的片段</li>
        <li>确认后点击"裁剪"按钮</li>
        <li>导出剪辑后的音频文件</li>
      </ol>
    </div>`
  },

  'audio-extract': {
    title: '音频提取',
    html: `<div class="help-doc">
      <h2>音频提取</h2>
      <p>从视频文件中提取音频轨道，保存为独立音频文件。</p>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>上传视频文件（支持 MP4 / MOV / MKV 等）</li>
        <li>选择输出音频格式</li>
        <li>点击"开始提取"</li>
        <li>导出提取的音频文件</li>
      </ol>
    </div>`
  },

  'video-convert': {
    title: '视频格式转换',
    html: `<div class="help-doc">
      <h2>视频格式转换</h2>
      <p>支持 MP4、AVI、MKV、MOV、WebM、FLV、WMV、TS 八种格式互转，批量处理。</p>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>在视频工具分类中点击"视频格式转换"</li>
        <li>上传一个或多个视频文件</li>
        <li>选择目标格式</li>
        <li>点击"开始转换"</li>
        <li>处理完成后弹出成功提示</li>
      </ol>

      <div class="help-note">
        <p>视频转换仅在桌面版运行，使用内置 FFmpeg 在本地处理。每个文件最大 10 GB，单次最多可处理 30 个文件。</p>
      </div>
    </div>`
  },

  'video-frame': {
    title: '视频高清单帧图',
    html: `<div class="help-doc"><h2>视频高清单帧图</h2><p>从本地视频中定位任意时点，按原始画面分辨率导出 PNG 无损图或高质量 JPG。</p><h3>使用方法</h3><ol class="help-steps"><li>进入视频工具，选择“视频高清单帧图”</li><li>上传一个本地视频，等待元数据读取完成</li><li>拖动时间轴、输入毫秒，或用左右按钮按真实帧率微调</li><li>选择 PNG 或 JPG，点击“导出当前帧”</li></ol><div class="help-note"><p>导出仅在本机使用 FFmpeg，不会上传或改写源视频。输出会保留已有同名图片，并使用唯一文件名。CLI/IDE Agent 调用时必须提供明确的毫秒时间点。</p></div></div>`
  },

  'video-gif': {
    title: '视频截取 GIF',
    html: `<div class="help-doc"><h2>视频截取 GIF</h2><p>从本地视频中选取起始帧和结束帧，生成最长 30 秒、经过调色板优化的循环 GIF。</p><h3>使用方法</h3><ol class="help-steps"><li>进入视频工具，选择“视频截取 GIF”，上传或直接拖入一个视频</li><li>上传完成后默认会选中从开头开始、最长 30 秒的范围；拖动时间轴或用逐帧按钮调整起点和终点，白色区间就是导出范围</li><li>选择帧率、输出宽度和质量。文件太大时优先选 6/8 FPS、360/480px、“小体积”或“极小”</li><li>点击播放按钮会循环预览起点到终点；暂停会停在当前帧，再点击“导出 GIF”</li></ol><div class="help-note"><p>GIF 的起点和终点必须明确，且区间不能超过 30 秒。导出在本机通过 FFmpeg 处理，源视频不会修改。IDE Agent 不能猜“精彩片段”，应先让你在桌面预览中确定两个时间点。</p></div></div>`
  },

  'text-stats': {
    title: '文本统计器',
    html: `<div class="help-doc"><h2>文本统计器</h2><p>在桌面端输入或粘贴文字，统计结果会立即更新，不会上传或保存这段文字。</p><h3>可以看到什么</h3><ul><li>总字符、不含空格字符、空格、中文字符、英文单词、字母、数字和标点</li><li>行数、段落数、句子数、最长行、平均行长和预计阅读时间</li></ul><h3>使用方法</h3><ol class="help-steps"><li>进入“文本统计器”并粘贴内容</li><li>直接查看右侧统计卡片</li><li>需要交给他人时点击“复制统计结果”；需要重新开始时点击“清空”</li></ol><div class="help-note"><p>CLI/IDE Agent 也可统计一个明确的 UTF-8 文本文件，但不会把文件正文回传到对话或日志中。</p></div></div>`
  },

  'text-format': {
    title: '文本格式化',
    html: `<div class="help-doc"><h2>文本格式化</h2><p>把一段文字转换为常见的大小写、空格、行序和全半角形式。处理结果先显示在右侧，只有你复制或继续使用时才会离开页面。</p><h3>常用操作</h3><ul><li>全大写、全小写、标题式大小写、每句首字母大写</li><li>去多余空格、去行首尾空格、去空行、去重复行</li><li>升序或降序排序、添加或移除行号、反转行序或字符</li><li>全角转半角、半角转全角</li></ul><h3>使用方法</h3><ol class="help-steps"><li>输入或粘贴文本</li><li>点击一个处理动作，在结果区检查变化</li><li>点击“复制结果”，或用“结果作为输入”继续叠加处理</li></ol><div class="help-note"><p>该工具目前仅在桌面端提供，适合需要先看到文本变化再决定下一步的操作。</p></div></div>`
  },

  'bmi-calc': {
    title: '体脂率计算器',
    html: `<div class="help-doc"><h2>体脂率计算器</h2><p>根据性别、年龄、身高和体重给出 BMI、体脂率估算、基础代谢率和理想体重参考；精准模式可额外使用腰围、颈围和女性臀围。</p><h3>使用方法</h3><ol class="help-steps"><li>选择简易模式或精准模式</li><li>填写身体数据；数值在合理范围内会自动计算</li><li>查看 BMI、体脂区间、基础代谢和体重差值</li></ol><div class="help-note"><p>结果只作健康管理参考，不用于诊断、治疗或替代专业医疗意见。</p></div></div>`
  },

  'timestamp-calc': {
    title: '时间戳计算器',
    html: `<div class="help-doc"><h2>时间戳计算器</h2><p>在 Unix 秒级时间戳、毫秒时间戳和日期时间之间互相转换，同时显示本地时间、UTC、ISO 8601 和相对时间。</p><h3>使用方法</h3><ol class="help-steps"><li>需要查当前值时，直接复制页面上的当前秒级或毫秒级时间戳</li><li>选择“时间戳 → 日期”或“日期 → 时间戳”</li><li>输入值后查看结果并复制</li></ol><div class="help-note"><p>转换结果取决于所选的本地时间或 UTC 格式；排查跨时区问题时优先使用 UTC 或 ISO 8601。</p></div></div>`
  },

  'mortgage-calc': {
    title: '房贷计算器',
    html: `<div class="help-doc"><h2>房贷计算器</h2><p>按贷款金额、年利率、期限和还款方式估算月供、总利息与还款明细，支持等额本息和等额本金。</p><h3>使用方法</h3><ol class="help-steps"><li>填写贷款金额、年利率和期限</li><li>选择等额本息或等额本金</li><li>查看月供、利息和还款计划；可调整参数重新比较</li></ol><div class="help-note"><p>本工具用于估算，实际利率、税费、提前还款规则和银行账单以金融机构说明为准。</p></div></div>`
  },

  'interest-calc': {
    title: '利息计算器',
    html: `<div class="help-doc"><h2>利息计算器</h2><p>快速计算本金、年利率和期限对应的利息与本息合计，适合做基础的存款或借款估算。</p><h3>使用方法</h3><ol class="help-steps"><li>填入本金、年利率和期限</li><li>选择页面支持的计息方式和时间单位</li><li>查看利息、本息合计与明细，再按需要修改参数</li></ol><div class="help-note"><p>结果不包含复利、税费、手续费或提前支取等特殊规则，实际业务以合同为准。</p></div></div>`
  },

  'password-gen': {
    title: '密码生成器',
    html: `<div class="help-doc"><h2>密码生成器</h2><p>在本机随机生成密码，可选择长度、字符类型和强度预设。生成内容只保留在当前页面内存中，复制后请自行妥善保管。</p><h3>使用方法</h3><ol class="help-steps"><li>选择强度预设，或按需要启用大小写字母、数字和特殊字符</li><li>生成密码并确认长度与字符规则</li><li>点击复制；完成后可使用“清除”移除当前页面中的密码</li></ol><div class="help-note"><p>密码不会接入 CLI 或 IDE Agent，避免秘密进入命令历史、对话记录和日志。</p></div></div>`
  },

  'color-extractor': {
    title: '配色提取器',
    html: `<div class="help-doc"><h2>配色提取器</h2><p>从一张 PNG、JPG 或 WebP 图片中提取主色，并展示可复制的颜色信息。</p><h3>使用方法</h3><ol class="help-steps"><li>上传图片或拖入页面</li><li>等待本地分析完成，查看主色圆点</li><li>点击颜色查看详情或复制 HEX 值；可随时重新选择图片</li></ol><div class="help-note"><p>CLI/IDE Agent 可以分析一个明确的图片路径并返回色板，不会上传源图，也不会写入输出文件。</p></div></div>`
  },

  'typing-test': {
    title: '打字测试器',
    html: `<div class="help-doc"><h2>打字测试器</h2><p>选择中文或英文、难度和时长后开始输入，实时显示速度和准确率。</p><h3>使用方法</h3><ol class="help-steps"><li>设置语言、难度与测试时长</li><li>点击“开始测试”，再点击输入区域开始打字</li><li>结束后查看 WPM、准确率等结果；需要重测时点击“重新开始”</li></ol><div class="help-note"><p>这是桌面端的交互工具，不提供 CLI 或 IDE Agent 调用。</p></div></div>`
  },

  'ai-polish': {
    title: 'AI 文字润色',
    html: `<div class="help-doc">
      <h2>AI 文字润色</h2>
      <p>智能分析文本并优化表达，支持多种润色方向。</p>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>输入需要润色的文本</li>
        <li>选择润色方向（正式/简洁/学术/口语化等）</li>
        <li>点击"开始润色"</li>
        <li>对比原文和润色结果</li>
        <li>复制满意的结果</li>
      </ol>
    </div>`
  },

  'ai-translate': {
    title: 'AI 智能翻译',
    html: `<div class="help-doc">
      <h2>AI 智能翻译</h2>
      <p>逐句对照翻译，高亮显示对应关系。</p>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>输入需要翻译的文本</li>
        <li>选择源语言和目标语言</li>
        <li>点击"开始翻译"</li>
        <li>查看逐句对照翻译结果</li>
      </ol>
    </div>`
  },

  'ai-doc': {
    title: 'AI 文档生成',
    html: `<div class="help-doc">
      <h2>AI 文档生成</h2>
      <p>通过自然语言生成专业多页 PDF，并保留可继续修改的 ToolKnit 文档工程。桌面端适合可视化生成和手动微调；CLI/MCP 适合让 IDE Agent 在项目文件夹内自动生成、检查、插图、删除组件和撤销修订。</p>

      <h3>桌面端使用方法</h3>
      <ol class="help-steps">
        <li>输入文档主题、页数、语言、必须包含和禁止出现的内容。</li>
        <li>点击生成后等待 AI 完成内容规划、排版和 PDF 渲染。</li>
        <li>在预览中检查页数、页脚、表格、图片和文字是否被裁切。</li>
        <li>进入编辑视图后，点击锁定单个图层，可移动、缩放、删除、上下调整顺序，并支持撤销上一步。</li>
        <li>确认无误后导出 PDF；建议保存需求原文，方便后续复用。</li>
      </ol>

      <h3>写需求时这样更稳</h3>
      <ul>
        <li>明确页数，例如“生成 3 页 A4 PDF”，不要只说“做一份文档”。</li>
        <li>说明结构，例如每页主题、表格行数、是否需要签字区、是否允许图片。</li>
        <li>没有提供的日期、姓名、版本号、负责人等信息，应要求写“待确认”。</li>
        <li>如果后续要通过 Agent 插图，初稿可以明确要求“不要包含图片、图片占位符或 image 区域，并在第 2 页保留编辑余量”。</li>
      </ul>

      <div class="help-note"><p>AI 文档会调用你配置的 AI 服务生成内容。文件和渲染产物保存在本地；不要在需求中粘贴 API Key、密码、身份证号等敏感信息。</p></div>

      <h3>Agent / CLI 工作流</h3>
      <p>通过 CLI/MCP 生成时，ToolKnit 会同时输出 PDF、<code>.toolknit.json</code> 工程、干净预览、逐页高清编号图和修订历史。用户在 IDE 左侧文件树中打开 <code>page-XX-controls.png</code>，就可以按编号继续让 Agent 修改。</p>

      <div class="help-agent-prompt">
        <h4>生成无图初稿</h4>
        <p class="help-agent-prompt-text">请使用 ToolKnit MCP，在当前 IDE 项目的 toolknit-output 中生成一份 3 页中文 A4 PDF《项目执行方案》。不要覆盖已有文件。初稿不得包含图片、图片占位符或 image 控件。生成后检查真实页数，并 inspect 工程，确认 image 类型控件数量为 0。告诉我 PDF、工程文件和每一页高清编号图的绝对路径。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请使用 ToolKnit MCP，在当前 IDE 项目的 toolknit-output 中生成一份 3 页中文 A4 PDF《项目执行方案》。不要覆盖已有文件。初稿不得包含图片、图片占位符或 image 控件。生成后检查真实页数，并 inspect 工程，确认 image 类型控件数量为 0。告诉我 PDF、工程文件和每一页高清编号图的绝对路径。">复制话术</button>
      </div>

      <div class="help-agent-prompt">
        <h4>按编号精确修改</h4>
        <p class="help-agent-prompt-text">请使用 ToolKnit MCP 修改 &lt;工程文件.toolknit.json&gt;。先 inspect，不要根据截图猜测。把 P1-01 和 P1-02 交换位置；再把 P1-01 的背景设为 #000000、文字设为 #FFFFFF。先 dry-run 并报告诊断；没有 error 后，用完全相同的 operations 正式提交。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请使用 ToolKnit MCP 修改 &lt;工程文件.toolknit.json&gt;。先 inspect，不要根据截图猜测。把 P1-01 和 P1-02 交换位置；再把 P1-01 的背景设为 #000000、文字设为 #FFFFFF。先 dry-run 并报告诊断；没有 error 后，用完全相同的 operations 正式提交。">复制话术</button>
      </div>

      <div class="help-agent-prompt">
        <h4>插入本地图片</h4>
        <p class="help-agent-prompt-text">请使用 ToolKnit MCP，在 &lt;工程文件.toolknit.json&gt; 的 P2-04 后插入图片控件，图片来源是 &lt;本地 PNG 或 JPEG 绝对路径&gt;，宽 520、高 150。先 inspect，再 dry-run；检查图片分辨率、页面溢出和重叠诊断后提交。不要使用 base64。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请使用 ToolKnit MCP，在 &lt;工程文件.toolknit.json&gt; 的 P2-04 后插入图片控件，图片来源是 &lt;本地 PNG 或 JPEG 绝对路径&gt;，宽 520、高 150。先 inspect，再 dry-run；检查图片分辨率、页面溢出和重叠诊断后提交。不要使用 base64。">复制话术</button>
      </div>

      <div class="help-note"><p>Agent 修改 AI 文档时必须先 inspect，再 dry-run，最后提交相同操作。<code>page_count_changed</code>、越界、严重重叠或图片无效时不应强行发布。</p></div>
    </div>`
  },

  'ai-table': {
    title: 'AI 表格生成',
    html: `<div class="help-doc">
      <h2>AI 表格生成</h2>
      <p>通过自然语言生成可编辑的表格工程，适合报表、清单、统计表和带图表的数据页。桌面端适合快速生成和手动微调；CLI/MCP 适合让 IDE Agent 在项目文件夹中生成、检查、改表、加删行列、调整图表和撤销修订。</p>

      <h3>桌面端使用方法</h3>
      <ol class="help-steps">
        <li>输入表格主题、列名、行数、数据范围、图表需求和导出格式。</li>
        <li>点击生成后等待 AI 完成列设计、行数据、图表和导出。</li>
        <li>在预览中检查列宽、数字类型、空单元格和图表是否正确。</li>
        <li>桌面预览区可直接轻编辑：点击标题或单元格修改，点击列头排序，使用 + 添加行列，误操作可撤销上一步。</li>
        <li>确认无误后导出 CSV、XLSX、PDF 或 PNG。</li>
      </ol>

      <h3>写需求时这样更稳</h3>
      <ul>
        <li>明确列数和行数，并说明每列类型，例如 text、number 或 date。</li>
        <li>说明是否需要图表，以及图表类型、标签列和数值列。</li>
        <li>说明汇总行、空值、单位、排序规则和导出格式。</li>
        <li>如果后续要通过 Agent 修改，建议预留清晰列名，不要使用模糊标题。</li>
      </ul>

      <div class="help-note"><p>AI 表格会调用你配置的 AI 服务生成内容。文件和渲染产物保存在本地；不要在需求中粘贴 API Key、密码、身份证号等敏感信息。</p></div>

      <h3>Agent / CLI 工作流</h3>
      <p>通过 CLI/MCP 生成时，ToolKnit 会同时输出导出文件、<code>.toolknit-table.json</code> 工程和预览图。表格工程使用稳定的行号、列号和图表号，例如 <code>R01</code>、<code>C01</code>、<code>G01</code>；用户可在 IDE 左侧文件树中打开 <code>preview/preview.png</code> 后继续按编号修改。</p>
      <div class="help-note"><p>如果只是快速改几个单元格，用桌面端更快；如果需要连续多轮“把 R01 和 R02 互换、插入图表、调整列类型、撤销修订”，建议使用 Agent/CLI 工程模式。</p></div>

      <div class="help-agent-prompt">
        <h4>生成可编辑表格</h4>
        <p class="help-agent-prompt-text">请使用 ToolKnit MCP，在当前 IDE 项目的 toolknit-output 中生成一份 4 列 6 行的中文 A4 表格《项目进度表》，导出为 xlsx，不要覆盖已有文件。表格需要包含状态图表，并在生成后告诉我导出文件、工程文件和预览图的绝对路径，再 inspect 一次确认行号、列号和图表号都存在。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请使用 ToolKnit MCP，在当前 IDE 项目的 toolknit-output 中生成一份 4 列 6 行的中文 A4 表格《项目进度表》，导出为 xlsx，不要覆盖已有文件。表格需要包含状态图表，并在生成后告诉我导出文件、工程文件和预览图的绝对路径，再 inspect 一次确认行号、列号和图表号都存在。">复制话术</button>
      </div>

      <div class="help-agent-prompt">
        <h4>按编号修改表格</h4>
        <p class="help-agent-prompt-text">请使用 ToolKnit MCP 修改 &lt;工程文件.toolknit-table.json&gt;。先 inspect，不要根据预览图猜测。把 R01 和 R02 交换位置；再把 C02 的标题改成“负责人”；把 R01 的 C02 列值改为“张三”；最后把 G01 的标题改成“完成率趋势”。先 dry-run 并报告诊断，没有 error 后再用完全相同的 operations 正式提交。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请使用 ToolKnit MCP 修改 &lt;工程文件.toolknit-table.json&gt;。先 inspect，不要根据预览图猜测。把 R01 和 R02 交换位置；再把 C02 的标题改成“负责人”；把 R01 的 C02 列值改为“张三”；最后把 G01 的标题改成“完成率趋势”。先 dry-run 并报告诊断，没有 error 后再用完全相同的 operations 正式提交。">复制话术</button>
      </div>

      <h3>AI 表格修改规则</h3>
      <ul>
        <li><code>R01</code>、<code>C01</code>、<code>G01</code> 这类编号属于行、列、图表本身；交换顺序或删除后编号不会因为位置改变而重排。</li>
        <li>优先打开预览图和 inspect 结果；如果语义描述匹配到多个目标，Agent 必须先问用户。</li>
        <li>图表修改必须指向稳定的图表编号或 id，不能只靠预览图猜坐标。</li>
        <li>输出路径应始终明确；没有明确授权时，Agent 不应覆盖任何已有文件。</li>
      </ul>
    </div>`
  },

  'agent-guide': {
    title: 'AI Agent 快速手册',
    html: `<div class="help-doc">
      <h2>让 AI Agent 使用 ToolKnit</h2>
      <p>把 ToolKnit CLI 连接到支持 MCP 的 IDE 后，你可以直接用自然语言让 Agent 处理项目里的本地文件。Agent 调用的是真正的 ToolKnit 工具，不需要打开桌面端，也不应把“我已经处理好了”当成没有调用工具时的替代答案。</p>

      <h3>当前可用范围</h3>
      <div class="help-agent-scope"><p>当前 MCP 一共提供 <strong>30 项</strong>能力。下面按你平时会说的话归类，Agent 会自己转成明确的工具参数：</p><ul><li><strong>PDF（8 项）</strong>：查看页数和大小、合并、按页拆分、旋转、加密、解密、压缩、增强扫描件文字可读性。</li><li><strong>音频（4 项）</strong>：转格式、测 BPM、按明确起止时间剪辑、从视频提取指定音轨。</li><li><strong>音视频转文字（4 项）</strong>：查看本地模型、下载模型、切换当前模型、输出 TXT / SRT / JSON；可选把识别文字交给 AI 润色，媒体本身不会上传。</li><li><strong>视频（3 项）</strong>：转格式、按精确毫秒导出单帧 PNG/JPG、按明确起止时间截取最长 30 秒 GIF。</li><li><strong>文本和图像（3 项）</strong>：统计 UTF-8 文本文件、提取主色板、把 2-100 张图片拼成长图。</li><li><strong>AI 文档（4 项）</strong>：生成 PDF、检查可编辑工程、按编号修改控件、重新渲染 PDF 和编号图。</li><li><strong>AI 表格（4 项）</strong>：生成 CSV/XLSX/PDF/PNG、检查工程、按行列图表编号修改、重新渲染。</li></ul></div>

      <h3>哪些功能不让 Agent 调用</h3>
      <p>图片格式转换、图片压缩、图标生成、文本格式化、计算器、密码生成器、打字测试、AI 润色和 AI 翻译目前是<strong>桌面端专用</strong>。这不是漏接：其中一部分不适合在终端或 Agent 对话里传递内容、密码或交互状态。</p>

      <h3>首次连接</h3>
      <ol class="help-steps">
        <li>安装 ToolKnit CLI 后，先在 PowerShell 运行 <code>toolknit doctor</code>。本地文件工具不需要 AI 密钥；AI 文档、AI 表格和 AI 二次润色才需要配置密钥。</li>
        <li>在 IDE 设置中搜索 <code>MCP</code>，添加 Server：命令填写 <code>toolknit</code>，参数填写 <code>mcp serve</code>，保存后重启或重新连接 Agent。</li>
        <li>在 Agent 对话中说清输入文件、要执行的操作、保存位置，以及是否允许覆盖已有文件。说“保存到当前项目”时，Agent 应使用当前工作区的 <code>toolknit-output</code> 文件夹，而不是猜测路径。</li>
      </ol>

      <div class="help-note"><p>最稳妥的话术是“先检查，再处理，保存到当前项目的 toolknit-output，不要覆盖原文件”。输出路径应始终明确；没有明确授权时，Agent 不应覆盖任何已有文件。AI 文档和表格修改必须先 inspect，再 dry-run，最后提交同一组操作。</p></div>

      <h3>可直接复制的话术</h3>

      <div class="help-agent-prompt">
        <h4>查看 PDF 信息</h4>
        <p class="help-agent-prompt-text">请使用 ToolKnit MCP 检查 &lt;输入 PDF 路径&gt;。告诉我页数和文件大小；不要修改文件。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请使用 ToolKnit MCP 检查 &lt;输入 PDF 路径&gt;。告诉我页数和文件大小；不要修改文件。">复制话术</button>
      </div>

      <div class="help-agent-prompt">
        <h4>只提取某一页或多页</h4>
        <p class="help-agent-prompt-text">请使用 ToolKnit MCP，先检查 &lt;输入 PDF 路径&gt;，再提取第 &lt;页码，例如 2 或 1,3-5&gt; 页，输出到 &lt;输出文件夹&gt;。不要覆盖已有文件。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请使用 ToolKnit MCP，先检查 &lt;输入 PDF 路径&gt;，再提取第 &lt;页码，例如 2 或 1,3-5&gt; 页，输出到 &lt;输出文件夹&gt;。不要覆盖已有文件。">复制话术</button>
      </div>

      <div class="help-agent-prompt">
        <h4>合并 PDF</h4>
        <p class="help-agent-prompt-text">请使用 ToolKnit MCP，先检查 &lt;PDF 1 路径&gt; 和 &lt;PDF 2 路径&gt;，再按这个顺序合并，输出为 &lt;输出 PDF 路径&gt;。不要覆盖已有文件。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请使用 ToolKnit MCP，先检查 &lt;PDF 1 路径&gt; 和 &lt;PDF 2 路径&gt;，再按这个顺序合并，输出为 &lt;输出 PDF 路径&gt;。不要覆盖已有文件。">复制话术</button>
      </div>

      <div class="help-agent-prompt">
        <h4>旋转 PDF</h4>
        <p class="help-agent-prompt-text">请使用 ToolKnit MCP，先检查 &lt;输入 PDF 路径&gt;，再将全部页面顺时针旋转 &lt;90、180 或 270&gt; 度，输出为 &lt;输出 PDF 路径&gt;。不要覆盖已有文件。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请使用 ToolKnit MCP，先检查 &lt;输入 PDF 路径&gt;，再将全部页面顺时针旋转 &lt;90、180 或 270&gt; 度，输出为 &lt;输出 PDF 路径&gt;。不要覆盖已有文件。">复制话术</button>
      </div>

      <div class="help-agent-prompt">
        <h4>压缩 PDF</h4>
        <p class="help-agent-prompt-text">请使用 ToolKnit MCP，先检查 &lt;输入 PDF 路径&gt;，再以 &lt;low、medium 或 high&gt; 等级压缩，输出为 &lt;输出 PDF 路径&gt;。不要覆盖已有文件。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请使用 ToolKnit MCP，先检查 &lt;输入 PDF 路径&gt;，再以 &lt;low、medium 或 high&gt; 等级压缩，输出为 &lt;输出 PDF 路径&gt;。不要覆盖已有文件。">复制话术</button>
      </div>

      <div class="help-agent-prompt">
        <h4>增强扫描件</h4>
        <p class="help-agent-prompt-text">请使用 ToolKnit MCP，先检查 &lt;扫描件 PDF 路径&gt;，再以 &lt;light、medium 或 strong&gt; 强度增强，输出为 &lt;输出 PDF 路径&gt;。增强会重新栅格化页面，不要保留可搜索文字、链接或表单的预期。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请使用 ToolKnit MCP，先检查 &lt;扫描件 PDF 路径&gt;，再以 &lt;light、medium 或 strong&gt; 强度增强，输出为 &lt;输出 PDF 路径&gt;。增强会重新栅格化页面，不要保留可搜索文字、链接或表单的预期。">复制话术</button>
      </div>

      <div class="help-agent-prompt">
        <h4>处理当前项目里的音频</h4>
        <p class="help-agent-prompt-text">请使用 ToolKnit MCP，把当前项目 assets/采访.m4a 转成高质量 MP3，保存到当前项目的 toolknit-output。先从 IDE 文件树解析绝对路径，不要修改原文件，也不要覆盖已有文件。完成后报告输出路径、实际格式和失败原因。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请使用 ToolKnit MCP，把当前项目 assets/采访.m4a 转成高质量 MP3，保存到当前项目的 toolknit-output。先从 IDE 文件树解析绝对路径，不要修改原文件，也不要覆盖已有文件。完成后报告输出路径、实际格式和失败原因。">复制话术</button>
      </div>

      <div class="help-agent-prompt">
        <h4>离线把音视频转成文字</h4>
        <p class="help-agent-prompt-text">请使用 ToolKnit MCP，先检查本地离线识别模型。如果没有可用模型，告诉我推荐 Small 模型的下载大小并等待我确认；不要自行下载。确认后，把当前项目 assets/会议.mp4 离线转写为中文，保存到当前项目的 toolknit-output，输出 TXT、SRT 和 JSON。不要上传媒体文件，也不要覆盖已有文件。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请使用 ToolKnit MCP，先检查本地离线识别模型。如果没有可用模型，告诉我推荐 Small 模型的下载大小并等待我确认；不要自行下载。确认后，把当前项目 assets/会议.mp4 离线转写为中文，保存到当前项目的 toolknit-output，输出 TXT、SRT 和 JSON。不要上传媒体文件，也不要覆盖已有文件。">复制话术</button>
      </div>

      <div class="help-agent-prompt">
        <h4>从视频导出单帧或 GIF</h4>
        <p class="help-agent-prompt-text">请使用 ToolKnit MCP，从当前项目 recordings/demo.mp4 的 12500 毫秒导出一张 PNG 单帧图，保存到当前项目的 toolknit-output。不要修改源视频。若我要 GIF，请先让我明确起始毫秒和结束毫秒；不得猜测精彩片段，片段最长 30 秒。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请使用 ToolKnit MCP，从当前项目 recordings/demo.mp4 的 12500 毫秒导出一张 PNG 单帧图，保存到当前项目的 toolknit-output。不要修改源视频。若我要 GIF，请先让我明确起始毫秒和结束毫秒；不得猜测精彩片段，片段最长 30 秒。">复制话术</button>
      </div>

      <div class="help-agent-prompt">
        <h4>取色、统计或拼接图片</h4>
        <p class="help-agent-prompt-text">请使用 ToolKnit MCP，分析当前项目 assets/海报.png 的 6 个主色，报告 HEX、RGB、占比，不要创建文件。需要拼接时，请把当前项目里的三张截图按给定顺序纵向拼接为 PNG，保存到 toolknit-output，不要修改原图或覆盖已有文件。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请使用 ToolKnit MCP，分析当前项目 assets/海报.png 的 6 个主色，报告 HEX、RGB、占比，不要创建文件。需要拼接时，请把当前项目里的三张截图按给定顺序纵向拼接为 PNG，保存到 toolknit-output，不要修改原图或覆盖已有文件。">复制话术</button>
      </div>

      <div class="help-agent-prompt">
        <h4>生成多页 AI 文档</h4>
        <p class="help-agent-prompt-text">请务必调用 ToolKnit MCP 的 toolknit_ai_document，不要只在对话中编写内容。在当前 IDE 项目的 toolknit-output 中生成一份 4 页中文 A4 PDF《ToolKnit v1.2 产品方案》，不要覆盖已有文件。生成后报告 PDF、.toolknit.json 工程、预览目录、每一页高清编号图和总览图的绝对路径，并调用 toolknit_pdf_inspect 确认真实 PDF 恰好为 4 页。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请务必调用 ToolKnit MCP 的 toolknit_ai_document，不要只在对话中编写内容。在当前 IDE 项目的 toolknit-output 中生成一份 4 页中文 A4 PDF《ToolKnit v1.2 产品方案》，不要覆盖已有文件。生成后报告 PDF、.toolknit.json 工程、预览目录、每一页高清编号图和总览图的绝对路径，并调用 toolknit_pdf_inspect 确认真实 PDF 恰好为 4 页。">复制话术</button>
      </div>

      <div class="help-agent-prompt">
        <h4>看编号图后修改 AI 文档</h4>
        <p class="help-agent-prompt-text">请使用 ToolKnit MCP 修改 &lt;工程文件.toolknit.json&gt;。先 inspect 当前修订和控件，不要直接改 JSON，也不要只根据截图猜坐标。把 P1-03 和 P1-05 交换位置，再把 P1-03 的背景改成 #000000、文字改成 #FFFFFF。先 dry-run 并报告所有诊断；没有 error 后再正式提交，完成后告诉我新修订号和更新后的编号图路径。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请使用 ToolKnit MCP 修改 &lt;工程文件.toolknit.json&gt;。先 inspect 当前修订和控件，不要直接改 JSON，也不要只根据截图猜坐标。把 P1-03 和 P1-05 交换位置，再把 P1-03 的背景改成 #000000、文字改成 #FFFFFF。先 dry-run 并报告所有诊断；没有 error 后再正式提交，完成后告诉我新修订号和更新后的编号图路径。">复制话术</button>
      </div>

      <div class="help-agent-prompt">
        <h4>删除或撤销组件</h4>
        <p class="help-agent-prompt-text">请删除 &lt;工程文件.toolknit.json&gt; 中编号图里的 P3-06。先 inspect 确认编号和文字，再 dry-run；没有 error 后只删除这个控件，不要删除其他内容。若我说撤销上一步，请调用 toolknit_ai_document_edit 的唯一操作 {"type":"undo","steps":1}。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请删除 &lt;工程文件.toolknit.json&gt; 中编号图里的 P3-06。先 inspect 确认编号和文字，再 dry-run；没有 error 后只删除这个控件，不要删除其他内容。若我说撤销上一步，请调用 toolknit_ai_document_edit 的唯一操作 {&quot;type&quot;:&quot;undo&quot;,&quot;steps&quot;:1}。">复制话术</button>
      </div>

      <div class="help-agent-prompt">
        <h4>生成可编辑表格</h4>
        <p class="help-agent-prompt-text">请务必调用 ToolKnit MCP 的 toolknit_ai_table，不要只在对话里写表格。请在当前 IDE 项目的 toolknit-output 中生成一份 4 列 6 行的中文 A4 表格《项目进度表》，导出为 xlsx，不要覆盖已有文件。表格需要包含状态图表；生成后告诉我导出文件、工程文件和预览图的绝对路径，并 inspect 一次确认行号、列号和图表号都存在。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请务必调用 ToolKnit MCP 的 toolknit_ai_table，不要只在对话里写表格。请在当前 IDE 项目的 toolknit-output 中生成一份 4 列 6 行的中文 A4 表格《项目进度表》，导出为 xlsx，不要覆盖已有文件。表格需要包含状态图表；生成后告诉我导出文件、工程文件和预览图的绝对路径，并 inspect 一次确认行号、列号和图表号都存在。">复制话术</button>
      </div>

      <div class="help-agent-prompt">
        <h4>按编号修改表格</h4>
        <p class="help-agent-prompt-text">请使用 ToolKnit MCP 修改 &lt;工程文件.toolknit-table.json&gt;。先 inspect，不要根据预览图猜测。把 R01 和 R02 交换位置；再把 C02 的标题改成“负责人”；把 R01 的 C02 列值改为“张三”；最后把 G01 的标题改成“完成率趋势”。先 dry-run 并报告所有诊断；没有 error 后再用完全相同的 operations 正式提交，并告诉我新的预览图路径。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请使用 ToolKnit MCP 修改 &lt;工程文件.toolknit-table.json&gt;。先 inspect，不要根据预览图猜测。把 R01 和 R02 交换位置；再把 C02 的标题改成“负责人”；把 R01 的 C02 列值改为“张三”；最后把 G01 的标题改成“完成率趋势”。先 dry-run 并报告所有诊断；没有 error 后再用完全相同的 operations 正式提交，并告诉我新的预览图路径。">复制话术</button>
      </div>

      <h3>AI 文档修改规则</h3>
      <ul>
        <li>优先打开逐页高清编号图，例如 <code>demo/page-02-controls.png</code>，不要只看总览图。</li>
        <li><code>P1-01</code> 这类编号属于控件本身；交换位置或移动后编号不会重排。</li>
        <li>语义描述只匹配到一个控件时，Agent 才能转换为操作；匹配多个时必须先问用户。</li>
        <li>插图必须使用本地 PNG/JPEG 绝对路径，不能传 base64，不能生成静默占位图。</li>
      </ul>

      <h3>AI 表格修改规则</h3>
      <ul>
        <li><code>R01</code>、<code>C01</code>、<code>G01</code> 这类编号属于行、列和图表本身；交换顺序或删除后编号不会因为位置改变而重排。</li>
        <li>修改表格时优先 inspect 和预览；如果语义描述匹配到多个目标，Agent 必须先问用户。</li>
        <li>图表修改必须指向稳定的图表编号或 id，不能只靠预览图猜测。</li>
        <li>输出路径应始终明确；没有明确授权时，Agent 不应覆盖任何已有文件。</li>
      </ul>

      <h3>密码文件</h3>
      <p>加密和解密需要密码。不要把密码粘贴进 Agent 对话、共享记录或任务描述。处理密码保护 PDF 时，建议使用 ToolKnit 桌面端；如必须通过 Agent 操作，要求它不要回显、复述或写入密码。</p>

      <h3>遇到问题时</h3>
      <p>让 Agent 先运行 <code>toolknit doctor</code> 或检查输入路径。常见问题是文件路径不存在、输出文件已经存在，或 PDF 本身受密码保护。</p>
    </div>`
  },

  'faq-general': {
    title: '通用问题',
    html: `<div class="help-doc">
      <h2>常见问题 - 通用</h2>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：ToolKnit 是免费的吗？</div>
        <div class="help-faq-a">A：是的，ToolKnit 完全免费使用，不包含任何广告或内购。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：文件会上传到服务器吗？</div>
        <div class="help-faq-a">A：不会。所有文件处理均在本地完成，文件不会上传到任何服务器。AI 工具仅将文本内容发送到 AI 接口进行处理。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：支持哪些操作系统？</div>
        <div class="help-faq-a">A：目前支持 Windows 10/11（64 位），macOS 和 Linux 版本正在规划中。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：如何切换语言？</div>
        <div class="help-faq-a">A：点击侧边栏底部的设置图标，在"语言"区域选择中文或 English 即可。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：文件保存在哪里？</div>
        <div class="help-faq-a">A：默认保存在“下载”目录下的 ToolKnit 文件夹中，并按具体工具进入二级目录，例如 PDF_Merge、Images、Videos、Transcripts、AI_Doc。可在设置页面查看、打开或更换根目录。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：支持批量处理吗？</div>
        <div class="help-faq-a">A：支持。大部分工具（PDF 合并、图片转换、音频转换等）都支持批量文件处理。</div>
      </div>
    </div>`
  },

  'faq-ffmpeg': {
    title: 'FFmpeg 相关',
    html: `<div class="help-doc">
      <h2>常见问题 - FFmpeg</h2>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：什么是 FFmpeg 扩展包？</div>
        <div class="help-faq-a">A：FFmpeg 是一个开源的多媒体处理库，ToolKnit 的音频转换、视频转换等功能依赖它。首次使用相关功能时会自动提示下载。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：FFmpeg 下载需要多大空间？</div>
        <div class="help-faq-a">A：当前 Windows 运行时下载包约 30MB。它安装在 ToolKnit 的本机应用数据目录，不占用你的默认输出目录；安装后可离线使用。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：下载 FFmpeg 失败怎么办？</div>
        <div class="help-faq-a">A：在设置的“FFmpeg 运行时”里切换自动、官方或国内镜像后重试。下载会校验完整性；不要从不明网站手动替换可执行文件。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：可以手动安装 FFmpeg 吗？</div>
        <div class="help-faq-a">A：桌面端建议只使用设置页管理的运行时。CLI 可使用 PATH 中的 FFmpeg 或 TOOLKNIT_FFMPEG_PATH；两者的配置互不影响。</div>
      </div>
    </div>`
  },

  'faq-privacy': {
    title: '隐私与安全',
    html: `<div class="help-doc">
      <h2>常见问题 - 隐私与安全</h2>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：我的文件安全吗？</div>
        <div class="help-faq-a">A：是的。所有文件处理（PDF、图片、音频、视频等）均在本地完成，不会上传到任何服务器。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：AI 工具会保存我的数据吗？</div>
        <div class="help-faq-a">A：AI 工具（润色、翻译、对话等）会将文本内容发送到 AI 接口进行处理，但不会在本地保存您的输入内容。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：PDF 加密安全吗？</div>
        <div class="help-faq-a">A：PDF 加密使用行业标准加密算法，安全性取决于密码强度。建议使用 8 位以上包含字母、数字、特殊字符的密码。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：应用会收集使用数据吗？</div>
        <div class="help-faq-a">A：ToolKnit 不收集任何用户隐私数据，不包含追踪代码或分析工具。</div>
      </div>
    </div>`
  },

  'transcription': {
    title: '音视频提取文字',
    html: `<div class="help-doc"><h2>音视频提取文字</h2><p>使用内置的离线 Whisper 引擎识别本机音频或视频中的中文和英文。媒体文件不会上传。</p><h3>首次使用</h3><ol class="help-steps"><li>进入设置，打开“离线识别模型”</li><li>推荐下载 Small；Base 更快且更小，Medium 质量更高但占用更多空间</li><li>选择自动、官方或国内镜像下载源，完成校验后模型可离线使用</li></ol><h3>输出与润色</h3><p>每次识别都会保留原始 JSON、SRT、TXT。开启 AI 二次润色后，仅识别出的字幕文字会提交给已配置的 AI 平台；字幕段编号和时间轴不会被增加、删除、拆分或合并。</p><div class="help-note"><p>AI 只能修正标点、语法和明显的上下文识别错误，不能听见原音频。涉及专有名词、数字或不清晰发音时，请以原始字幕和音频为准。</p></div></div>`
  },

  'faq-update': {
    title: '更新问题',
    html: `<div class="help-doc">
      <h2>常见问题 - 更新</h2>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：如何检查更新？</div>
        <div class="help-faq-a">A：在 GitHub Release 或项目发布页查看新版本说明和安装包。设置页只显示当前已安装版本，不会在后台静默下载或强制安装更新。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：怎样安装新版本？</div>
        <div class="help-faq-a">A：先关闭主窗口，再在 Windows 右下角 ToolKnit 托盘菜单选择“退出”。然后运行新的安装程序覆盖安装，重启后在设置页确认版本号。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：覆盖安装会丢失设置或模型吗？</div>
        <div class="help-faq-a">A：正常覆盖安装不会主动清除本机应用数据。设置、已下载的 FFmpeg 和离线模型是否保留，取决于卸载旧版时是否选择清除应用数据。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：更新失败怎么办？</div>
        <div class="help-faq-a">A：确认主程序已从托盘退出，再重新运行安装程序。若 Windows 提示文件被占用，关闭正在预览输出文件的程序后重试。</div>
      </div>
    </div>`
  }
};

export function getHelpContent() {
  return getLang() === 'zh' ? HELP_CONTENT : HELP_CONTENT_EN;
}

export { HELP_CONTENT_EN };

export default HELP_CONTENT;
