import { getLang } from './i18n.js';
import { HELP_CONTENT_EN } from './help-data-en.js';

export const HELP_CONTENT = {
  'overview': {
    title: '功能概览',
    html: `<div class="help-doc">
      <h2>ToolKnit 功能概览</h2>
      <p>ToolKnit 2.3 是一款<strong>本地优先</strong>的 Windows 多功能工具箱，当前提供 12 个分类、65 个桌面工具，并通过 CLI / MCP 向 IDE Agent 暴露 46 项能力。PDF、PPT、图像、音视频、文本、计算、创意、开发者、清理和硬件处理默认在本机完成。</p>

      <h3>工具分类一览</h3>
      <div class="help-tool-grid">
        <div class="help-tool-card"><div class="help-tool-card-name">PDF 工具</div><div class="help-tool-card-desc">编辑、合并、拆分、添加页码、转图像、旋转、加密、解密、压缩、文字增强与 Excel 转 PDF</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">PPT 工具</div><div class="help-tool-card-desc">转 PDF / 图像、素材与文字提取、压缩、AI 大纲和黑白极简草稿</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">图像工具</div><div class="help-tool-card-desc">格式转换、图片压缩、长图拼接、图标生成器、图像与屏幕取色</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">音频工具</div><div class="help-tool-card-desc">格式转换、BPM 测速、剪辑、从视频提取音频</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">视频工具</div><div class="help-tool-card-desc">格式转换、高清单帧图、最长 30 秒 GIF</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">文本工具</div><div class="help-tool-card-desc">音视频转文字、提词器、文本统计、文本格式化</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">计算器工具</div><div class="help-tool-card-desc">体脂率、时间戳、房贷、利息、密码生成</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">创意工具</div><div class="help-tool-card-desc">配色提取、打字测试</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">清理工具</div><div class="help-tool-card-desc">扫描大文件、AI 元数据建议、移入回收站</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">硬件工具</div><div class="help-tool-card-desc">只读查看整机、CPU、内存、显卡、主板、磁盘、网络和传感器</div></div>
        <div class="help-tool-card"><div class="help-tool-card-name">AI 工具</div><div class="help-tool-card-desc">AI 润色、翻译、可编辑文档、可编辑表格</div></div>
      </div>

      <h3>核心特性</h3>
      <ul>
        <li><strong>本地优先</strong>：源文件默认不上传 ToolKnit 服务器；只有用户主动调用 AI 时才向所选 AI 服务发送必要文字或元数据</li>
        <li><strong>批量操作</strong>：支持批量文件处理，提高工作效率</li>
        <li><strong>拖拽上传</strong>：支持拖拽文件到工具页面直接处理</li>
        <li><strong>双语界面</strong>：支持中文和英文切换</li>
        <li><strong>多种工作方式</strong>：桌面端负责可视化预览，CLI 适合命令和批处理，IDE Agent 可用自然语言调用已接入能力</li>
        <li><strong>按需依赖</strong>：FFmpeg、Whisper 离线模型和 LibreOffice 只在相关工具需要时安装</li>
      </ul>

      <div class="help-note">
        <p>AI 润色、翻译、文档、表格、PPT AI 和转写二次润色会向你配置的 AI 服务发送必要文字；AI 清理只发送候选文件元数据。依赖下载、读取 GitHub 公开项目数据和打开外部链接也需要联网，其他本地文件处理可离线使用。</p>
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
        <li>磁盘空间：基础应用建议预留至少 200 MB；可选运行时单独占用空间</li>
        <li>网页运行时：需要 Microsoft Edge WebView2（Windows 10/11 通常已安装）</li>
      </ul>

      <h3>安装步骤</h3>
      <ol class="help-steps">
        <li>下载 ToolKnit 安装包（<code>.exe</code> 安装程序）</li>
        <li>双击运行安装程序，选择安装路径</li>
        <li>等待安装完成，桌面会出现 ToolKnit 快捷方式</li>
        <li>双击快捷方式启动应用</li>
      </ol>

      <h3>首次启动</h3>
      <p>首次启动不强制下载附加组件。进入相关功能时，程序会检查并提示按需安装：FFmpeg 下载约 29 MB，推荐的 Whisper Small 模型约 465 MB，LibreOffice 下载包约 356 MB。下载进度到 100% 后仍可能继续进行校验、解压或安装，请等待完成提示。</p>

      <div class="help-note">
        <p>FFmpeg、Whisper 和 LibreOffice 均可在设置中选择自动、官方或国内镜像源。LibreOffice 用于 Excel 转 PDF、PPT 转 PDF 和 PPT 转图像。极少数没有 WebView2 的离线 Windows 设备，需要先联网安装 WebView2 Runtime 才能启动应用。</p>
      </div>
    </div>`
  },

  'settings': {
    title: '设置与偏好',
    html: `<div class="help-doc">
      <h2>设置与偏好</h2>
      <p>点击任意页面顶部导航栏右侧的<strong>设置按钮</strong>进入设置页。设置页负责应用级配置，不会改变原始文件。</p>

      <h3>语言切换</h3>
      <p>支持<strong>中文</strong>和<strong>English</strong>两种语言，切换后界面立即生效。</p>

      <h3>AI 密钥</h3>
      <p>支持 DeepSeek、OpenAI、通义千问、Moonshot 和自定义 OpenAI 兼容接口。AI 文档、AI 表格、AI 润色、AI 翻译、PPT AI、AI 清理复核和可选的转写润色需要密钥。密钥只保存在本机，并只发送给你选择的服务商。</p>

      <h3>离线识别模型</h3>
      <p>“音视频提取文字”首次使用前需要下载一个本地模型。<strong>Small</strong> 是默认推荐项；Base 更小更快，Medium 更偏向质量。下载完成后，语音识别可离线运行；只有你主动开启“AI 二次润色”时，识别出的文字才会发送给所配置的 AI 平台。</p>

      <h3>FFmpeg 运行时</h3>
      <p>音频转换、音频剪辑、音频提取、视频转换、单帧图、GIF 和转写预处理都需要 FFmpeg。安装包不再内置它：可在这里选择自动、官方或国内镜像下载。进入相关工具时若未安装，也会弹出依赖安装窗口。</p>

      <h3>LibreOffice 运行时</h3>
      <p>供 Excel 转 PDF、PPT 转 PDF 和 PPT 转图像使用。可选择自动、官方或国内镜像；下载完成后还需校验和解压，安装完成后可离线转换。</p>

      <h3>窗口、音效与快捷键</h3>
      <p>可调整窗口拉伸与小圆角 / 大圆角 / 自定义圆角；窗口最大化时会自动取消圆角并贴合屏幕，恢复窗口后重新应用。全局音效提供总开关和三套风格。屏幕取色默认快捷键为 <code>Ctrl+Shift+C</code>，可自定义或恢复默认；启动取色时主窗口会自动最小化，选中颜色后返回配色提取器。</p>

      <h3>默认存储位置</h3>
      <p>默认位置是<strong>下载目录下的 ToolKnit</strong>。你可以改成任意已有文件夹。每个输出会自动进入对应工具的二级目录，例如 <code>PDF_Merge</code>、<code>PDF_Split</code>、<code>Images</code>、<code>Videos</code>、<code>Transcripts</code>、<code>AI_Doc</code> 和 <code>AI_Table</code>；原文件不会被改写。</p>

      <h3>帮助与反馈</h3>
      <p>点击“帮助中心”查看功能说明、常见问题、程序声明与使用规范；点击“反馈 BUG”会打开项目反馈入口。</p>
    </div>`
  },

  'cli-guide': {
    title: 'CLI 命令行入门',
    html: `<div class="help-doc">
      <h2>CLI 命令行入门</h2>
      <p><strong>桌面端</strong>适合点选与预览；<strong>CLI</strong>适合 PowerShell、脚本和批量任务；<strong>IDE Agent</strong>则由你用自然语言下达目标，再通过 CLI/MCP 调用同一套文件处理能力。三者不会互相替代，也不需要一直开着桌面程序。</p>

      <h3>安装并确认 CLI 可用</h3>
      <ol class="help-steps">
        <li>安装 Node.js <code>20.12.0+</code>，然后执行 <code>npm install --global @toolknit/cli</code></li>
        <li>在 PowerShell 执行 <code>toolknit doctor</code> 检查环境和按需依赖</li>
        <li>看到环境状态后，执行 <code>toolknit --help</code> 查看全部命令</li>
        <li>需要某个命令的参数和示例时，执行 <code>toolknit help &lt;分类&gt; &lt;工具&gt;</code>，例如 <code>toolknit help video gif</code></li>
      </ol>

      <h3>命令分类</h3>
      <ul>
        <li><code>pdf</code>：查看、合并、按页拆分、转图像、旋转、加密、解密、压缩、扫描件增强</li>
        <li><code>ppt</code>：转 PDF、转图像、提取素材、提取文字、压缩、AI 大纲、AI 草稿 / PPTX</li>
        <li><code>hardware</code>：只读查看整机、CPU / 内存、显卡、主板、存储、网络设备和电源传感器</li>
        <li><code>audio</code>：格式转换、BPM、剪辑、从视频提取音轨</li>
        <li><code>model</code> 与 <code>transcribe</code>：管理本地识别模型、把音频或视频输出为 TXT、SRT、JSON</li>
        <li><code>video</code>：格式转换、精确导出单帧图、截取最长 30 秒 GIF</li>
        <li><code>text stats</code>、<code>image colors</code>、<code>image stitch</code>：本地统计、取色、长图拼接</li>
        <li><code>ai-doc</code> 与 <code>ai-table</code>：生成、检查、编辑、撤销和重新渲染可编辑工程</li>
      </ul>

      <h3>CLI 的安全默认值</h3>
      <p>所有会写文件的命令都要求明确输出位置。已有文件默认不会覆盖，只有显式传入 <code>--overwrite</code> 才会替换。密码不会作为命令行参数出现；JSON 输出、管道输出和 MCP 模式也不会混入 ASCII 横幅。</p>

      <h3>连接 IDE Agent</h3>
      <p>MCP 服务命令是 <code>toolknit mcp serve</code>。把它配置到支持 MCP 的 IDE 后，Agent 可调用当前 46 项能力；桌面端不需要保持打开。</p>

      <div class="help-note"><p>CLI 和 IDE Agent 使用的是单独的环境配置。桌面端保存的 AI 密钥不会自动交给 CLI；只有 AI 文档、AI 表格、PPT 文本 AI 整理、AI 生成 PPT 大纲、AI 生成 PPT 草稿 / PPTX 和 AI 二次润色需要在 CLI/MCP 进程中配置密钥。</p></div>
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

  'pdf-page-number': {
    title: 'PDF 加页码',
    html: `<div class="help-doc">
      <h2>PDF 加页码</h2>
      <p>把一个多页 PDF 或多个 PDF 展开成统一页面序列，在实时预览中设置页码范围、编号方式、位置和外观，再导出为一个 PDF 或逐页 ZIP。</p>
      <h3>页面管理</h3>
      <ol class="help-steps">
        <li>点击“添加 PDF”或把文件拖入工具页，单次最多 25 个文件、150 MB、200 页</li>
        <li>在左侧单击页面查看预览，使用勾选、Ctrl 或 Shift 选择多页</li>
        <li>拖动页面右侧手柄调整最终顺序，或删除单页和批量删除；工具始终至少保留一页</li>
        <li>误删后可使用一次“撤销删除”恢复上一次删除前的页面序列</li>
      </ol>
      <h3>页码设置与导出</h3>
      <ul>
        <li>可应用到全部、奇数、偶数、自定义范围或左侧已选页面，并支持跳过封面</li>
        <li>支持连续编号、每个来源文件重新编号、起始值、步长和自定义文本模板</li>
        <li>九宫格位置支持边距与水平/垂直微调，外观包含纯文字、圆形、胶囊、标签和横条</li>
        <li>“单个 PDF”按左侧顺序合并导出；“逐页 PDF + ZIP”会为每页生成独立 PDF 后统一打包</li>
      </ul>
      <div class="help-note"><p>页码由 PDF 矢量指令直接写入，不会把原页面截图压缩。受密码保护的文件请先用“PDF 文件解密”处理；源文件不会被修改或上传。</p></div>
    </div>`
  },

  'pdf-crop': {
    title: 'PDF 裁剪',
    html: `<div class="help-doc">
      <h2>PDF 裁剪</h2>
      <p>在可视化预览中框选每页需要保留的区域，或输入精确边距，再导出一个多页 PDF 或逐页 ZIP。工具只支持单个 PDF，源文件始终保持不变。</p>
      <h3>框选与页面范围</h3>
      <ol class="help-steps">
        <li>点击“选择 PDF”或把一个 PDF 拖入工具页，载入后在底部缩略图切换页面</li>
        <li>默认使用“全部页面”，拖动画出保留区域后，同一比例的裁剪框会应用到全部页面</li>
        <li>切换为“当前页面”后，拖动、移动或调整八个控制点只会修改正在预览的页面</li>
        <li>如果页面尚未裁剪，可直接拖动画框；已有裁剪时使用“重新框选”开始绘制新区域</li>
      </ol>
      <h3>精确调整与导出</h3>
      <ul>
        <li>支持毫米和 PDF 点两种单位，并可联动上、右、下、左四个边距</li>
        <li>“重置本页”只恢复当前页，“重置全部裁剪”恢复整个文档；撤销和重做会保留最近的裁剪历史</li>
        <li>“合并为单个 PDF”保持原页序和多页结构；“逐页 PDF + ZIP”为每页生成一个独立 PDF</li>
        <li>缩放、适应窗口和切换页面仅改变预览，不会修改裁剪范围</li>
      </ul>
      <div class="help-note"><p>裁剪通过修改 PDF 页面边界实现，页面内容不会被截图压缩。它不是安全脱敏：边界外内容仍可能存在于文件结构中，敏感信息请使用真正的涂黑或内容移除工具。单次支持 150 MB、500 页；加密 PDF 请先使用“PDF 文件解密”。</p></div>
    </div>`
  },

  'pdf-to-image': {
    title: 'PDF 转图像',
    html: `<div class="help-doc">
      <h2>PDF 转图像</h2>
      <p>从一个 PDF 中选择需要的页面，导出为独立图像，或按原页码顺序生成高清长图。读取、渲染和写入全部在本机完成，文件不会上传到服务器。</p>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>点击“上传 PDF 文件”，或将一个 PDF 拖入工具页</li>
        <li>在真实页面缩略图中点击选择或取消页面，也可全选</li>
        <li>选择 PNG、JPG 或 WebP 格式，再选择需要的清晰度</li>
        <li>点击“导出图像”可将每个所选页面分别保存为一张图</li>
        <li>点击“导出长图”可按页码顺序合成长图</li>
        <li>完成后在弹框中查看输出数量和保存路径，或点击“打开文件夹”</li>
      </ol>

      <h3>清晰度</h3>
      <ul>
        <li><strong>标准（144 DPI）：</strong>文件较小，适合屏幕阅读和日常分享</li>
        <li><strong>高清（200 DPI）：</strong>默认选项，兼顾细节和文件大小</li>
        <li><strong>印刷（300 DPI）：</strong>适合需要放大文字、图表或后续印刷的场景</li>
      </ul>

      <h3>长图分组规则</h3>
      <p>长图单次最多选择 20 页，优先每 5 页生成一张。例如选择 16 页时，通常会输出 4 张图：1-5、6-10、11-15 和第 16 页。如果某组在当前清晰度下超过安全边长或内存限制，工具会自动拆成更小的组，不通过压缩原始页面来勉强拼接。</p>

      <div class="help-note">
        <p>每次只能读取一个 PDF，文件最大 150 MB、最多 200 页。受密码保护的 PDF 需要先使用“PDF 文件解密”处理。导出期间可取消，工具会清理未完成的临时文件。</p>
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

  'pdf-editor': {
    title: 'PDF 编辑器',
    html: `<div class="help-doc">
      <h2>PDF 编辑器</h2>
      <p>轻量级 PDF 编辑：替换文字、插入文本/图像/形状、页面排序、旋转、提取与追加合并，文件仅在本机处理。</p>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>上传需要编辑的 PDF 文件</li>
        <li>点击「编辑文字」选中文字后修改内容，点击「插入文本 / 图像 / 形状」向页面添加内容</li>
        <li>点击「选择组件」后可单击选中任意文字、图像或形状，再拖动、缩放、旋转或删除</li>
        <li>使用底部或侧栏工具调整页面顺序、旋转、删除与提取</li>
        <li>点击「导出 PDF」保存编辑结果</li>
      </ol>

      <h3>注意事项</h3>
      <ul>
        <li>输入限制为 150 MB、500 页</li>
        <li>文字替换依赖 PDF 自带的文字层，扫描件或纯图像型 PDF 不支持文字编辑</li>
        <li>文件全程在本地处理，不上传服务器</li>
      </ul>
    </div>`
  },

  'excel-to-pdf': {
    title: 'Excel 转 PDF',
    html: `<div class="help-doc">
      <h2>Excel 转 PDF</h2>
      <p>使用本地 LibreOffice 渲染运行时，把 Excel 工作簿转换为适合分享、打印和归档的 PDF。源文件不会被修改，也不会上传服务器。</p>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>上传或拖入一个或多个 <code>XLSX</code>、<code>XLS</code>、<code>ODS</code> 工作簿</li>
        <li>选择导出全部工作表或仅可见工作表</li>
        <li>设置页面方向、纸张类型和缩放方式</li>
        <li>点击「开始转换」，每个工作簿会分别生成一个 PDF</li>
        <li>转换完成后打开输出文件夹查看 PDF 和 <code>manifest.json</code></li>
      </ol>

      <h3>页面与工作表规则</h3>
      <ul>
        <li>「全部工作表」会包含隐藏工作表；不需要隐藏内容时请选择「仅可见工作表」</li>
        <li>方向支持跟随源文件、纵向和横向；纸张支持自动、A4 和美式信纸</li>
        <li>「适合页面」会缩放内容以减少横向截断；「原始比例」更接近工作簿原有打印设置</li>
      </ul>

      <h3>注意事项</h3>
      <ul>
        <li>每批最多 20 个文件，单个文件不能超过 200 MB</li>
        <li>首次使用需要按需安装约 356 MB 的 LibreOffice 运行时；安装完成后可离线转换</li>
        <li>如果本机缺少工作簿使用的字体，分页、行高或文字宽度可能与原文件略有差异</li>
        <li>复杂宏、外部数据连接和交互控件不会在 PDF 中继续运行</li>
      </ul>
    </div>`
  },

  'ppt-tools': {
    title: 'PPT 工具总览',
    html: `<div class="help-doc">
      <h2>PPT 工具总览</h2>
      <p>PPT 工具面向演示文稿素材整理和 AI 辅助写作。当前优先支持 <strong>.pptx</strong>，处理过程在本地读取文件结构；只有你主动开启 AI 整理或 AI 大纲生成时，才会把文字内容发送给你配置的 AI 服务，PPTX 文件本体不会上传。</p>

      <h3>PPT 转 PDF</h3>
      <ul>
        <li>通过本机 LibreOffice / soffice 渲染 PPTX，输出可分享、可打印的 PDF。</li>
        <li>源文件不会被修改；输出目录会包含 PDF 和 <code>manifest.json</code>。</li>
        <li>如果机器缺少 LibreOffice，桌面端会提示安装或配置路径；CLI/Agent 可通过 <code>TOOLKNIT_LIBREOFFICE_PATH</code> 指定 soffice。</li>
      </ul>

      <h3>PPT 转图片</h3>
      <ul>
        <li>先把 PPTX 本地渲染为中间 PDF，再进入高清页码选择工作区。</li>
        <li>支持按页导出 PNG / JPG / WebP；PPT 页面不会在此工具中拼成长图。</li>
        <li>适合把 PPT 页面交给短视频、图文笔记或 AI Agent 后续处理。</li>
      </ul>

      <h3>PPT 图片提取</h3>
      <ul>
        <li>从 PPTX 中提取内嵌图片、Logo、截图和背景素材。</li>
        <li>支持按幻灯片页码筛选，也可以一次性导出全部素材。</li>
        <li>优先保留原始图片格式，并生成 <code>manifest.json</code> 记录来源页、文件名和尺寸线索。</li>
      </ul>

      <h3>PPT AI 文本提取</h3>
      <ul>
        <li>读取每页标题、正文和演讲者备注，按真实幻灯片顺序输出。</li>
        <li>可导出 <code>Markdown</code>、<code>TXT</code>、<code>JSON</code>，也可以一次性导出全部格式。</li>
        <li>支持页码范围，例如 <code>1,3-5</code>；会自动跳过页脚、日期和页码等低价值占位符。</li>
        <li>AI 整理可选输出大纲、演讲稿、会议纪要或学习笔记；未配置密钥时仍可使用本地提取。</li>
      </ul>

      <h3>PPT 压缩</h3>
      <ul>
        <li>本地生成压缩副本，源 PPTX 不会被改写。</li>
        <li>支持无损清理与图片压缩两类策略：<code>low</code> 不降低图片质量，<code>medium</code> / <code>high</code> 会压缩大图素材来明显降低体积。</li>
        <li>压缩后如果图片没有变小，会自动保留原始图片；源 PPTX 不会被修改。</li>
        <li>会生成 <code>manifest.json</code>，记录原始大小、压缩后大小、节省空间和清理项目。</li>
      </ul>

      <h3>AI 生成 PPT 大纲</h3>
      <ul>
        <li>从主题、资料、目标受众和演示目标生成一套新的演示大纲。</li>
        <li>支持类型预设（如产品发布、投资人路演、工作汇报、培训课件），AI 会按对应叙事结构规划页面。</li>
        <li>视觉统一为黑白极简风：大面积白底、黑色点缀，不再让用户选择效果不稳定的视觉风格。</li>
        <li>不会读取 PPTX，也不会生成 PPTX 文件；它输出 <code>outline.md</code>、<code>outline.json</code> 和 <code>manifest.json</code>。</li>
        <li><code>outline.json</code> 是稳定结构，包含事实边界、页面角色、布局意图和质量自检，后续可以继续接入 AI 生成 PPT 草稿 / PPTX。</li>
        <li>AI 只接收你输入的文字；如果缺少事实，会放进待确认信息和事实库，而不是编造。</li>
      </ul>

      <h3>AI 生成 PPT 草稿 / PPTX</h3>
      <ul>
        <li>根据文字资料生成结构化大纲，再由 ToolKnit 本地写出可编辑 PPTX 草稿。</li>
        <li>也支持把已有 <code>outline.json</code> 直接转成 PPTX，不再调用 AI。</li>
        <li>和大纲工具一样支持 <code>deck_type</code> 类型预设，适合产品发布、路演、汇报、培训等不同叙事场景。</li>
        <li>固定输出黑白极简模板；没有真实素材时使用浅灰矩形占位和基础几何色块，不伪造图片。</li>
        <li>输出 <code>.pptx</code>、<code>outline.json</code>、<code>outline.md</code> 和 <code>manifest.json</code>，默认不覆盖已有文件。</li>
        <li>第一阶段是稳定极简草稿，不承诺复杂动画、视频或企业母版像素级还原。</li>
      </ul>

      <h3>CLI / Agent 示例</h3>
      <pre><code>toolknit ppt to-pdf --input demo.pptx --output-dir out
toolknit ppt to-image --input demo.pptx --output-dir out --pages 1,3-5 --format png --clarity print
toolknit ppt images --input demo.pptx --output-dir out --pages 1,3-5
toolknit ppt text --input demo.pptx --output-dir out --format all --ai-mode outline
toolknit ppt compress --input demo.pptx --output-dir out --level medium
toolknit ppt outline --prompt-file brief.txt --output-dir out --slide-count 8 --deck-type product-launch
toolknit ppt draft --prompt-file brief.txt --output-dir out --slide-count 8 --deck-type product-launch --theme minimal-mono
toolknit ppt draft --outline-file outline.json --output-dir out --theme minimal-mono</code></pre>

      <div class="help-note">
        <p>如果你用 IDE Agent，可以直接说：“用 ToolKnit 把这个 PPT 转成 PDF / 把第 1、3-5 页转成高清 PNG”。如果是写新内容，则说“根据这份产品资料生成 8 页 PPT 大纲”。这些需求对应不同工具。</p>
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
        <p>首次使用音频转换需要按提示下载 FFmpeg 运行时（约 29 MB），完成校验与安装后即可离线使用。</p>
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

  'teleprompter': {
    title: '提词器',
    html: `<div class="help-doc"><h2>提词器</h2><p>粘贴台词或读取 TXT、Markdown、DOCX、PDF 文稿，在高对比度提词区按设定速度滚动。可调整速度、字号、水平/垂直镜像，也可进入专注模式。</p><h3>普通滚动</h3><ol class="help-steps"><li>输入或读取文稿，点击句子可直接定位</li><li>在底部调整速度和字号，需要拍摄镜面时开启镜像</li><li>点击播放；播放期间左侧说明栏会自动收起</li></ol><h3>句子级语音跟随</h3><ul><li><strong>自动选择</strong>：桌面端默认使用稳定的 ToolKnit 离线识别；网页环境使用系统识别</li><li><strong>Windows 系统识别</strong>：依赖 Windows 语音服务；未真正启动或长时间没有返回结果时会自动切到离线识别</li><li><strong>ToolKnit 离线识别</strong>：麦克风片段只在本机处理。未安装模型时会弹出依赖下载窗口，完成校验后自动继续</li></ul><p>读完当前句会进入下一句；连续相同的句子每次只前进一段，无标点长稿也会自动拆成可跟随的小段。快捷键：<code>Space</code> 播放/暂停，<code>←</code>/<code>→</code> 切句，<code>+</code>/<code>-</code> 调速，<code>R</code> 回到开头，<code>F</code> 切换专注模式。</p><div class="help-note"><p>若系统与离线识别都无法工作，播放会明确改用普通自动滚动，不会停在原地。关闭工具、暂停播放或切换引擎时，ToolKnit 会停止麦克风、取消未完成识别并释放模型会话。</p></div></div>`
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
    html: `<div class="help-doc"><h2>配色提取器</h2><p>既可从 PNG、JPG、WebP 图片提取主色，也可用全局屏幕取色器读取其他应用中的像素颜色。</p><h3>图像取色</h3><ol class="help-steps"><li>上传图片或拖入页面</li><li>等待本地分析完成，在色板中选择颜色</li><li>查看 HEX、RGB 等详情并一键复制；可随时重新选择图片</li></ol><h3>屏幕取色</h3><ol class="help-steps"><li>点击“启动屏幕取色”或按默认快捷键 <code>Ctrl+Shift+C</code></li><li>主窗口自动最小化；拖动 21×21 像素放大准星定位目标像素</li><li>确认后返回配色提取器，颜色会加入结果并可继续复制</li></ol><div class="help-note"><p>屏幕取色只在内存中采样准星附近像素，不保存截图、不上传画面。CLI/IDE Agent 也可分析一个明确的图片路径并返回色板。</p></div></div>`
  },

  'typing-test': {
    title: '打字测试器',
    html: `<div class="help-doc"><h2>打字测试器</h2><p>选择中文或英文、难度和时长后开始输入，实时显示速度和准确率。</p><h3>使用方法</h3><ol class="help-steps"><li>设置语言、难度与测试时长</li><li>点击“开始测试”，再点击输入区域开始打字</li><li>结束后查看 WPM、准确率等结果；需要重测时点击“重新开始”</li></ol><div class="help-note"><p>这是桌面端的交互工具，不提供 CLI 或 IDE Agent 调用。</p></div></div>`
  },

  'rubiks-cube': {
    title: '图论与魔方',
    html: `<div class="help-doc"><h2>图论与魔方</h2><p>上方二维展开图与下方三维魔方实时联动，支持 2–7 阶，内置层先法与 CFOP 复原公式速查。</p><h3>界面说明</h3><ol class="help-steps"><li><strong>二维展开图</strong>：六面平铺展示，点击色块可选中对应面</li><li><strong>三维魔方</strong>：可旋转视角、缩放，色块与展开图一一对应</li><li><strong>底部控件</strong>：面 / 轴 / 层选择 + 顺逆时针转动按钮</li></ol><h3>操控方式</h3><ol class="help-steps"><li><strong>鼠标</strong>：左键点击色块选中面，右键选中纵向层，拖拽色块转动该层，拖拽空白旋转视角</li><li><strong>键盘</strong>：W/S 上下、A/D 左右、Q/E 前后选择层位；R 切换横Y/纵X/面Z；Ctrl 逆时针、Space 顺时针；数字 1–7 直接选层</li><li><strong>按钮</strong>：顶部阶数切换、打乱、还原、复原公式面板</li></ol><h3>复原公式</h3><p>点击右上角"复原公式"打开速查面板，包含层先法七步、CFOP 的 F2L/OLL/PLL 以及桥式、ZZ 等其他方法，每条公式附 U/F 面情况示意图，点击公式可复制。</p><div class="help-note"><p>打乱步数与还原步数分开计数；公式面板中的情况图以黄色为顶面、蓝色为前面。这是桌面端交互工具，不提供 CLI 或 IDE Agent 调用。</p></div></div>`
  },

  'ai-polish': {
    title: 'AI 文字润色',
    html: `<div class="help-doc">
      <h2>AI 文字润色</h2>
      <p>智能分析文本并优化表达，支持粘贴、选择文档或把文档拖入页面，再按需要选择润色方向。</p>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>输入文本，或导入支持的本地文档并确认解析预览</li>
        <li>选择润色方向（正式/简洁/学术/口语化等）</li>
        <li>点击"开始润色"</li>
        <li>对比原文和润色结果</li>
        <li>在应用内对比原文和结果，再复制或导出</li>
      </ol>
      <div class="help-note"><p>文档先在本机提取文字，源文件不会上传；只有预览中实际提交的文字会发送给你配置的 AI 服务。</p></div>
    </div>`
  },

  'ai-translate': {
    title: 'AI 智能翻译',
    html: `<div class="help-doc">
      <h2>AI 智能翻译</h2>
      <p>支持粘贴、选择文档或拖入文件，并在应用内逐句对照翻译和预览。</p>

      <h3>使用方法</h3>
      <ol class="help-steps">
        <li>输入文本，或导入支持的本地文档并确认解析预览</li>
        <li>选择源语言和目标语言</li>
        <li>点击"开始翻译"</li>
        <li>查看逐句对照结果，再复制或导出</li>
      </ol>
      <div class="help-note"><p>源文档在本机解析，不会上传；只有准备翻译的文字会发送给你选择的 AI 服务。</p></div>
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
      <div class="help-agent-scope"><p>当前 MCP 一共提供 <strong>46 项</strong>能力。下面按你平时会说的话归类，Agent 会自己转成明确的工具参数：</p><ul><li><strong>PDF（9 项）</strong>：查看页数和大小、合并、按页拆分、旋转、加密、解密、压缩、增强扫描件文字可读性，以及把 PDF 导出为逐页图像或拼成长图。</li><li><strong>PPT（7 项）</strong>：把 PPTX 转成 PDF；把 PPTX 按页导出为图片；从 PPTX 提取内嵌图片素材；提取每页标题、正文和备注，并可选把提取出的文字交给 AI 整理成大纲、讲稿、纪要或学习笔记；安全压缩 PPTX 并保留图片质量；根据文字资料生成结构化 PPT 大纲；生成可编辑 PPTX 草稿。</li><li><strong>硬件只读（8 项）</strong>：查看整机概况、CPU 与内存、实时状态、显卡与显示器、主板与固件、磁盘与健康、网络与设备、电源与传感器；只读取本机信息，不写入文件。</li><li><strong>音频（4 项）</strong>：转格式、测 BPM、按明确起止时间剪辑、从视频提取指定音轨。</li><li><strong>音视频转文字（4 项）</strong>：查看本地模型、下载模型、切换当前模型、输出 TXT / SRT / JSON；可选把识别文字交给 AI 润色，媒体本身不会上传。</li><li><strong>视频（3 项）</strong>：转格式、按精确毫秒导出单帧 PNG/JPG、按明确起止时间截取最长 30 秒 GIF。</li><li><strong>文本和图像（3 项）</strong>：统计 UTF-8 文本文件、提取主色板、把 2-100 张图片拼成长图。</li><li><strong>AI 文档（4 项）</strong>：生成 PDF、检查可编辑工程、按编号修改控件、重新渲染 PDF 和编号图。</li><li><strong>AI 表格（4 项）</strong>：生成 CSV/XLSX/PDF/PNG、检查工程、按行列图表编号修改、重新渲染。</li></ul></div>

      <h3>哪些功能不让 Agent 调用</h3>
      <p>图片格式转换、图片压缩、图标生成、文本格式化、计算器、密码生成器、打字测试、AI 润色和 AI 翻译目前是<strong>桌面端专用</strong>。这不是漏接：其中一部分不适合在终端或 Agent 对话里传递内容、密码或交互状态。</p>

      <h3>首次连接</h3>
      <ol class="help-steps">
        <li>安装 ToolKnit CLI 后，先在 PowerShell 运行 <code>toolknit doctor</code>。本地文件工具和非 AI PPT 不需要 AI 密钥；AI 文档、AI 表格、PPT 文本 AI 整理、AI 生成 PPT 大纲、AI 生成 PPT 草稿 / PPTX 和 AI 二次润色才需要配置密钥。</li>
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
        <p class="help-agent-prompt-text">请务必调用 ToolKnit MCP 的 toolknit_ai_document，不要只在对话中编写内容。在当前 IDE 项目的 toolknit-output 中生成一份 4 页中文 A4 PDF《ToolKnit v2.0 产品方案》，不要覆盖已有文件。生成后报告 PDF、.toolknit.json 工程、预览目录、每一页高清编号图和总览图的绝对路径，并调用 toolknit_pdf_inspect 确认真实 PDF 恰好为 4 页。</p>
        <button class="help-prompt-copy" type="button" data-copy-prompt="请务必调用 ToolKnit MCP 的 toolknit_ai_document，不要只在对话中编写内容。在当前 IDE 项目的 toolknit-output 中生成一份 4 页中文 A4 PDF《ToolKnit v2.0 产品方案》，不要覆盖已有文件。生成后报告 PDF、.toolknit.json 工程、预览目录、每一页高清编号图和总览图的绝对路径，并调用 toolknit_pdf_inspect 确认真实 PDF 恰好为 4 页。">复制话术</button>
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
        <div class="help-faq-a">A：本地工具不会上传源文件。只有你主动使用 AI 功能时，必要文字或清理候选元数据会发送到你选择的 AI 服务；依赖下载、GitHub 公开数据和外链也会联网。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：支持哪些操作系统？</div>
        <div class="help-faq-a">A：目前支持 Windows 10/11（64 位），macOS 和 Linux 版本正在规划中。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：如何切换语言？</div>
        <div class="help-faq-a">A：点击任意页面顶部导航栏右侧的设置按钮，在“语言”区域选择中文或 English。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：文件保存在哪里？</div>
        <div class="help-faq-a">A：默认保存在“下载”目录下的 ToolKnit 文件夹中，并按具体工具进入二级目录，例如 PDF_Merge、Images、Videos、Transcripts、AI_Doc。可在设置页面查看、打开或更换根目录。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：支持批量处理吗？</div>
        <div class="help-faq-a">A：支持。大部分工具（PDF 合并、图片转换、音频转换等）都支持批量文件处理。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：需要注册账户或同步数据吗？</div>
        <div class="help-faq-a">A：不需要。桌面端没有账户系统或云端收藏同步，设置、收藏、密钥和已下载运行时都保存在本机。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：启动时提示缺少 WebView2 怎么办？</div>
        <div class="help-faq-a">A：Windows 10/11 通常已经包含 WebView2。若精简系统或离线设备缺失，请联网安装 Microsoft Edge WebView2 Runtime 后再启动。</div>
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
        <div class="help-faq-a">A：当前 Windows 运行时下载包约 29 MB。它安装在 ToolKnit 的本机应用数据目录，不占用默认输出目录；安装后可离线使用。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：下载 FFmpeg 失败怎么办？</div>
        <div class="help-faq-a">A：在设置的“FFmpeg 运行时”里切换自动、官方或国内镜像后重试。下载会校验完整性；不要从不明网站手动替换可执行文件。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：可以手动安装 FFmpeg 吗？</div>
        <div class="help-faq-a">A：桌面端建议只使用设置页管理的运行时。CLI 可使用 PATH 中的 FFmpeg 或 TOOLKNIT_FFMPEG_PATH；两者的配置互不影响。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：Whisper 和 LibreOffice 分别做什么？</div>
        <div class="help-faq-a">A：Whisper 模型用于本地音视频转写，推荐的 Small 约 465 MB；LibreOffice 用于 Excel 转 PDF、PPT 转 PDF 和 PPT 转图像，下载包约 356 MB。两者都按需安装。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：下载到 100% 后为什么还没完成？</div>
        <div class="help-faq-a">A：100% 表示网络下载完成，之后还要做哈希校验、解压或安装。请等到界面明确显示“安装完成”，不要中途退出。</div>
      </div>
    </div>`
  },

  'faq-privacy': {
    title: '隐私与安全',
    html: `<div class="help-doc">
      <h2>常见问题 - 隐私与安全</h2>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：我的文件安全吗？</div>
        <div class="help-faq-a">A：PDF、PPT、图像、音视频、文本和硬件等本地处理不会上传源文件。涉及 AI 时会先在界面说明需要发送的文字或元数据。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：AI 工具会保存我的数据吗？</div>
        <div class="help-faq-a">A：AI 功能把必要文字发送给你选择的 DeepSeek、OpenAI、通义千问、Moonshot 或自定义兼容接口；服务商如何保存数据以其政策为准。密钥保存在本机，CLI/MCP 不会自动继承桌面端密钥。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：PDF 加密安全吗？</div>
        <div class="help-faq-a">A：PDF 加密使用行业标准加密算法，安全性取决于密码强度。建议使用 8 位以上包含字母、数字、特殊字符的密码。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：应用会收集使用数据吗？</div>
        <div class="help-faq-a">A：ToolKnit 不内置用户行为分析或广告追踪。支持作者区域会读取 GitHub 的公开 Star 等项目数据；点击网站、GitHub 或反馈入口时会打开对应外部链接。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：屏幕取色会截图或上传屏幕吗？</div>
        <div class="help-faq-a">A：不会。只有主动点击或快捷键触发后，程序才在内存中读取准星附近 21×21 像素；不会保存截图，也不会上传画面。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：AI 大文件清理会读取文件内容吗？</div>
        <div class="help-faq-a">A：不会。扫描在本机完成；AI 复核只接收文件名、大小、类型、时间、相对目录线索和风险原因等元数据，不接收文件内容或完整绝对路径。</div>
      </div>
    </div>`
  },

  'transcription': {
    title: '音视频提取文字',
    html: `<div class="help-doc"><h2>音视频提取文字</h2><p>使用内置的离线 Whisper 引擎识别本机音频或视频中的中文和英文。媒体文件不会上传。</p><h3>首次使用</h3><ol class="help-steps"><li>进入设置，打开“离线识别模型”</li><li>推荐下载 Small；Base 更快且更小，Medium 质量更高但占用更多空间</li><li>选择自动、官方或国内镜像下载源，完成校验后模型可离线使用</li></ol><h3>输出与润色</h3><p>每次识别都会保留原始 JSON、SRT、TXT。开启 AI 二次润色后，仅识别出的字幕文字会提交给已配置的 AI 平台；字幕段编号和时间轴不会被增加、删除、拆分或合并。</p><div class="help-note"><p>AI 只能修正标点、语法和明显的上下文识别错误，不能听见原音频。涉及专有名词、数字或不清晰发音时，请以原始字幕和音频为准。</p></div></div>`
  },

  'large-file-cleanup': {
    title: 'AI 大文件清理',
    html: `<div class="help-doc">
      <h2>AI 大文件清理</h2>
      <p>这个工具用于找出指定文件夹里的大文件，并在你确认后把文件移入 Windows 回收站。它适合清理下载目录、临时导出目录、录屏目录、安装包和压缩包。</p>

      <h3>推荐使用方式</h3>
      <ol class="help-steps">
        <li>选择一个具体目录，例如“下载”“视频”“桌面临时文件夹”，不要选择整个磁盘。</li>
        <li>保留默认阈值 <strong>50MB</strong>，先用“视频优先”或“全部大文件”扫描。</li>
        <li>查看列表里的大小、类别、目录线索和本地风险提示。</li>
        <li>如果已配置 AI 密钥，可点击“AI 轮询分析”，让 AI 根据元数据给出 delete / keep / review 建议。</li>
        <li>只勾选自己确认无误的项目，点击“移入回收站”。误删后可从回收站恢复。</li>
      </ol>

      <h3>隐私与安全</h3>
      <ul>
        <li><strong>扫描是本地只读</strong>：不会读取文件内容，也不会修改原文件。</li>
        <li><strong>AI 只看元数据</strong>：只发送文件名、大小、类别、修改时间、相对目录线索和本地风险理由；不会发送文件内容，也不会发送完整绝对路径。</li>
        <li><strong>高风险保护</strong>：聊天文件、项目/源码目录、模型/开发包会被标记为高风险。即使 AI 误判，本地也会把高风险 delete 改成人工复核。</li>
        <li><strong>不会永久删除</strong>：删除动作默认移入 Windows 回收站，不做不可恢复清空。</li>
      </ul>

      <div class="help-note"><p>最稳的习惯是：先扫“下载目录”和“临时导出目录”。项目仓库、微信聊天目录、模型目录和重要资料目录，即使显示很大，也建议手动复核后再处理。</p></div>
    </div>`
  },

  'c-drive-cleanup': {
    title: 'C盘清理',
    html: `<div class="help-doc">
      <h2>C盘清理</h2>
      <p>按低、中、高三个风险档清理系统缓存和临时空间。每档独立执行，清理前会弹出遮罩说明影响，并在 5 秒倒计时后确认。</p>

      <h3>三个风险档</h3>
      <ul>
        <li><strong>低风险</strong>：用户 / Windows 临时文件、浏览器缓存、缩略图、着色器、崩溃报告和网络缓存。系统会自动重建。</li>
        <li><strong>中风险</strong>：Windows 更新缓存、传递优化缓存、Windows 日志和开发者缓存。可能需要重新下载部分更新组件。</li>
        <li><strong>高风险</strong>：休眠文件、系统还原点和回收站清空。会关闭休眠 / 快速启动、删除已有还原点、清空回收站。</li>
      </ul>

      <h3>管理员权限</h3>
      <p>系统级缓存需要管理员权限。如果不是管理员启动，进入页面会提示“以管理员身份重启”，点击后触发 UAC 自动重开；也可以手动退出后用管理员身份重新运行。</p>

      <h3>隐私与安全</h3>
      <ul>
        <li><strong>只读扫描</strong>：先扫描预估空间，不产生任何写入。</li>
        <li><strong>永久删除</strong>：缓存和系统空间项为永久删除、不进回收站；下载、文档、桌面、图片、音乐、视频、聊天记录等个人文件绝不清理。</li>
        <li><strong>白名单与跳过锁定</strong>：只清理固定白名单目录，跳过被占用和受保护的文件，不跟随符号链接或联接点。</li>
      </ul>

      <div class="help-note"><p>高风险档会改变系统能力，请认真看弹框里的说明后再执行。误关闭休眠可随时重新开启，但删除的系统还原点和回收站内容无法恢复。</p></div>
    </div>`
  },

  'color-space-compare': {
    title: '颜色空间对比',
    html: `<div class="help-doc">
      <h2>颜色空间对比</h2>
      <p>在 OKLCH、OKLab、CIELAB D65、CIELCH D65、RGB、HSL、HSV 和近似 CMYK 之间实时联动。拖动任意轨道或输入精确数值，其余空间会立即更新。</p>
      <h3>精确值与轨道范围</h3>
      <p>颜色换算后的真实通道值可能超出可视轨道范围。此时数值框保留真实值，轨道手柄停在边缘并显示虚线；微调按钮会从真实值平滑回退，不会突然跳到边界。</p>
      <h3>色域与预览</h3>
      <p>页面同时检查 sRGB、Display P3、Adobe RGB 和 Rec.2020。超出 sRGB 时，屏幕预览会映射到可显示范围，但复制的颜色模型数值仍保留原始计算结果。</p>
      <div class="help-note"><p>CIELAB / CIELCH 使用 D65 白点，与 CSS Color 4 常见的 D50 Lab 语义不同；CMYK 为设备无关近似，正式印刷请使用对应设备的 ICC 色彩配置。</p></div>
    </div>`
  },

  'developer-tools': {
    title: '开发者工具',
    html: `<div class="help-doc"><h2>2.3 开发者工具</h2><p>这里集中介绍本次新增的本地工具。它们默认在需要时加载，关闭页面后会释放 Worker、Canvas 和临时任务。</p><h3>Markdown 文档编辑器</h3><p>支持 GFM、任务列表、Mermaid、数学公式、目录跳转、草稿恢复，以及 Markdown 和离线 HTML 导出。导出本地图片时会自动整理 assets 目录。</p><h3>智能颜色替换</h3><p>使用吸管选择源色和目标色，可调节感知阈值、边缘柔化、亮度保持和八连通智能保护。预览使用降采样 Worker，导出由 Rust 按原始分辨率完成。</p><h3>Hash &amp; Crypto</h3><p>覆盖常用 Hash、HMAC、国密、AES 文件加密、RSA 和 SM2。旧算法仅用于兼容，敏感输入不会写入历史或本地存储。</p></div>`
  },
  'hardware-tools': {
    title: '硬件工具总览',
    html: `<div class="help-doc">
      <h2>硬件工具总览</h2>
      <p>硬件工具用于本地只读查看电脑信息，定位配置、驱动、磁盘空间、网络设备和电源状态。它类似一个轻量系统信息面板，不会写入硬件配置，也不会上传设备数据。</p>

      <h3>目前包含的页面</h3>
      <ul>
        <li><strong>整机概览</strong>：系统版本、设备型号、核心硬件、固件安全状态和磁盘空间摘要。</li>
        <li><strong>CPU 与内存</strong>：CPU 核心/线程、频率、缓存、虚拟化状态、内存总量、插槽、品牌、型号和当前配置频率。</li>
        <li><strong>显卡与显示器</strong>：显卡名称、显存、驱动版本、显示器分辨率和刷新率等系统可读取信息。</li>
        <li><strong>主板与固件</strong>：主板、BIOS/UEFI、Secure Boot、TPM、PCI 设备等只读信息。</li>
        <li><strong>磁盘与健康</strong>：物理磁盘、卷、容量、剩余空间、接口和可读取的健康状态。</li>
        <li><strong>网络与设备</strong>：网络适配器、IP 配置、蓝牙、音频、摄像头、键鼠等外设摘要。</li>
        <li><strong>电源与传感器</strong>：电源计划、电池、ACPI 温度区和风扇接口能返回的状态。</li>
      </ul>

      <h3>读取限制</h3>
      <p>Windows 对部分硬件字段有限制：例如内存 SPD/XMP 频率、部分硬盘 SMART 细节、显卡实时温度等，普通应用不一定能稳定读取。ToolKnit 会展示系统接口能安全返回的数据，读取不到时会显示为空或不可用。</p>

      <div class="help-note"><p>硬件工具是“查看器”，不是超频、驱动安装或清理器。它不会改 BIOS、电源计划、注册表或硬件驱动。</p></div>
    </div>`
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
        <div class="help-faq-a">A：正常覆盖安装不会主动清除本机应用数据。设置、已下载的 FFmpeg、Whisper 模型和 LibreOffice 通常会保留；卸载时若选择清除应用数据则会删除。</div>
      </div>

      <div class="help-faq-item">
        <div class="help-faq-q">Q：更新失败怎么办？</div>
        <div class="help-faq-a">A：确认主程序已从托盘退出，再重新运行安装程序。若 Windows 提示文件被占用，关闭正在预览输出文件的程序后重试。</div>
      </div>
    </div>`
  }
};

HELP_CONTENT['developer-tools'].html += `<h3>开发者常用工具</h3><ul><li>JSON 格式化：校验、Pretty Print 与 Minify。</li><li>Base64 编解码：按 UTF-8 处理中文文本。</li><li>URL 编解码：处理查询参数和路径片段。</li><li>UUID 生成：批量生成随机 UUID v4。</li><li>JWT 查看：只解析 Header 和 Payload，不验证签名。</li></ul>`;

export function getHelpContent() {
  return getLang() === 'zh' ? HELP_CONTENT : HELP_CONTENT_EN;
}

export { HELP_CONTENT_EN };

export default HELP_CONTENT;
