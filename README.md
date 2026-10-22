<div align="center">

<img src="assets/readme/v3.1/01-hero.webp" alt="ToolKnit Desktop：小男孩和头顶的蜘蛛，把桌面上的事变简单" width="100%" />

# ToolKnit Desktop 3.2

V3.2 开发中，尚未发布；当前正式版为 V3.1。安装包发布状态以下载页为准，npm 包计划在 V3.2 发布时同步。

**把零散的桌面小事，收进一个工具箱。**

73 项桌面工具 · 12 个分类 · 本地文件工作台 · CLI / MCP

<p align="center">
<a href="https://toolknit.com/exe.html"><img src="assets/readme/v3.1/link-download-zh.svg" alt="下载 Windows 版" width="168" height="40" /></a>
<a href="https://toolknit.com"><img src="assets/readme/v3.1/link-web-zh.svg" alt="打开网页端" width="144" height="40" /></a>
<a href="README_EN.md"><img src="assets/readme/v3.1/link-english.svg" alt="English" width="104" height="40" /></a>
</p>

</div>

## 关于项目和我

<p><img src="assets/readme/v3.1/spider-wave.svg" alt="眨眨眼、挥挥手的 ToolKnit 小蜘蛛" width="88" height="88" /></p>

你好，我是董子航，一个喜欢把日常麻烦做成小工具的独立开发者。
ToolKnit 像一只不停织网的蜘蛛：一个需求牵出一根线，越来越多的工具被织出来，慢慢被大家发现、使用，再一起变得更好。
小男孩是我，头顶的蜘蛛是这个工具箱的小伙伴。

### 先用网页端

打开 **[ToolKnit.com](https://toolknit.com)**，无需安装，在 Windows、macOS、Linux 或手机的现代浏览器中都能访问。
目前有 **95 项网页工具**，覆盖 PDF、图片、视频、音频、文本、计算、时间、创意、AI 与自测。
多数工具无需注册；支持的文件任务在浏览器本地处理，AI 和在线服务的联网要求以具体工具说明为准。

### 再用桌面端

需要长期处理文件、找回复制内容或快速截图？[安装 Windows 桌面端](https://toolknit.com/exe.html)，当前开发目录提供 **73 项工具**；PDF 转 Word、图像转 PDF 随 V3.2 测试，正式安装包以 Release 为准。
首次使用先设置输出目录；常用工具可收藏，重型模型按需安装。打开**一键记录模式**，让开机自启、剪贴板实时监控和截图历史悬浮窗一起就位，再用 `Alt + Q` 开始截图。
安装环境与详细步骤见[开始使用](#08--开始使用)。

### 一起把它织好

<table width="100%">
<tr>
<td align="center" width="33%"><a href="https://github.com/ZihangDong"><img src="assets/readme/v3.1/avatar-zihang.png" width="64" height="64" alt="Zihang Dong 的头像，点击访问 GitHub" /></a><br /><strong>Zihang Dong</strong><br />产品设计 · 开发 · 维护</td>
<td align="center" width="33%"><a href="https://github.com/Joshua-Zion"><img src="assets/readme/v3.1/avatar-joshua.png" width="64" height="64" alt="Joshua-Zion 的头像，点击访问 GitHub" /></a><br /><strong>Joshua-Zion</strong><br />颜色空间转换 · 交互增强</td>
<td align="center" width="33%"><a href="https://github.com/hqyx2025"><img src="assets/readme/v3.1/avatar-hqyx.png" width="64" height="64" alt="hqyx2025 的头像，点击访问 GitHub" /></a><br /><strong>hqyx2025</strong><br />项目查验 · Bug 测试</td>
</tr>
</table>

感谢每一位使用、反馈与贡献的朋友。Joshua-Zion 的贡献见 [PR #23](https://github.com/ZihangDong/toolknit-desktop/pull/23)、[PR #67](https://github.com/ZihangDong/toolknit-desktop/pull/67)。

### 目录

[01 项目理念](#01--少开几个软件多做一点事情) · [02 一键记录](#02--一键记录让灵感留下来) · [03 快速截图](#03--截图之后还能继续处理) · [04 剪贴板](#04--复制过的内容随时找回来)

[05 文件处理](#05--把文件处理集中在一个地方) · [06 图片与声音](#06--图片与声音也有自己的工具台) · [07 CLI / Agent](#07--你来操作也能交给-agent) · [真实截图](#看看真实的工作台)

[08 开始使用](#08--开始使用) · [完整工具目录](#完整工具目录) · [支持与反馈](#支持与反馈) · [源码运行与构建](#源码运行与构建) · [技术栈](#技术栈) · [源码许可](#源码许可) · [Star History](#star-history)

<table width="100%">
<tr>
<td width="50%"><strong>马良 AI</strong><br />作者推荐中转站 · 低价不降智<br /><a href="https://www.mlai.online/register?aff=5Q2VVMD7YJVB">了解马良 AI →</a></td>
<td width="50%"><strong>豆腐 AI</strong><br />作者推荐中转站 · 多模型接口<br /><a href="https://doufuapi.com/register?aff=TWKCBH9RGLN3">了解豆腐 AI →</a></td>
</tr>
</table>

推荐链接含推广标识；服务价格、模型能力与可用性以服务商为准。

## 01 / 少开几个软件，多做一点事情

[↑ 返回目录](#目录)

从一个小工具开始，把越来越多的桌面麻烦织进同一张网。

ToolKnit 把 PDF、PPT、图片、音视频、文字、系统与开发者工具放在一起：
用桌面端处理本地文件，用网页端快速体验，也能把适合自动化的任务交给 CLI 和 Agent。

裁一页 PDF，找回刚才复制的文字，给截图标两笔，把图片里的背景去掉。
事情不大，却经常要在几个软件之间来回切换。

## 02 / 一键记录，让灵感留下来

[↑ 返回目录](#目录)

![一键开启，复制与截图，历史随时找回：小男孩继续工作，蜘蛛收好内容](assets/readme/v3.1/02-record.webp)

**在设置里打开一次，让需要的记录功能一起就位。**

| 一次开启 | 帮你做什么 |
| --- | --- |
| 程序开机自启动 | 重启电脑后，工具继续在系统托盘待命 |
| 剪贴板实时监控 | 记录开启之后复制的文字、图片与文件路径 |
| 历史记录悬浮窗 | 用可拖动的小 Logo，按分类查看剪贴板文字、图片和文件记录 |

这是你主动开启的组合模式。关闭时会恢复启用前的相关设置；也可以分别管理这些开关。
它不会记录键盘输入、浏览行为或系统里的所有活动，完全退出程序后停止监控。

## 03 / 截图之后，还能继续处理

[↑ 返回目录](#目录)

![截图、标注、识别翻译与桌面置顶的黑白漫画](assets/readme/v3.1/03-screenshot.webp)

**默认按 `Alt + Q`，从窗口或选区开始。** 快捷键可以修改或关闭。

矩形、圆形、箭头、画笔、涂抹式马赛克与文字标注，配合撤销、恢复和按住查看原图。
确认后可复制、保存 PNG / JPG，或在独立查看器中缩放、拖动、置顶。
历史悬浮窗点击展开，可按内容和备注搜索记录，旧截图也能重新打开；常用语独立保存，方便重复复制。

| 你想做的事 | 实际处理方式 |
| --- | --- |
| 提取文字 | Windows 本地 OCR；小字、复杂背景和排版可能识别不准 |
| AI 提取内容 | 把所选区域发送到你配置的支持图像输入的模型，提取可复制的文字 |
| 截图中英互译 | 先在设置安装本地中英文模型，再识别文字、在本机翻译并覆盖到截图 |

截图翻译只支持**中文与英文**。配置好 AI 地址、模型和密钥后，会用本地 OCR 定位、AI 对照图像校正，再交给本地引擎翻译；没有 AI 配置时使用本地 OCR。
AI 校正失败会说明原因，需你确认才回退到 OCR。文本放不下时提供完整译文供复制，不要求盲目缩小截图。

本地翻译组件按需下载，约 **192 MiB 下载 / 225 MiB 安装占用**，不塞进主安装包。
本地翻译速度与整个截图流程耗时不同，外部 AI 延迟仍取决于服务商；识别和译文都建议核对。

## 04 / 复制过的内容，随时找回来

[↑ 返回目录](#目录)

![蜘蛛从历史记录中找回文字和图片，小男孩把图片打开置顶](assets/readme/v3.1/04-clipboard.webp)

**不必再问：刚才那段话，我到底复制到哪去了？**

剪贴板历史按时间保存文字、图片与文件路径，支持搜索、筛选、收藏和本地加密。
图片记录可以直接打开置顶查看器；ToolKnit 截图确认复制后，也能进入开启中的实时监控。
记录开关会保存，重启后无需重复打开。

只记录开启之后的新内容，不会导入系统既有的 Win + V 历史。请留意剪贴板可能包含的隐私内容，按需暂停和清理。

## 05 / 把文件处理，集中在一个地方

[↑ 返回目录](#目录)

![小男孩处理 PDF 和 PPT，蜘蛛在重复文件中保留一份](assets/readme/v3.1/05-files.webp)

**从预览到输出，让文件工作少一点折返。**

| 工作流 | 常用能力 |
| --- | --- |
| PDF | 合并、拆分、裁剪、页码、旋转、转图片、转 Word（V3.2）、压缩、加解密、编辑、提取文本 / Markdown |
| PPT | 转 PDF / 图片、提取图片与文字、压缩，使用 AI 生成大纲或可编辑 PPTX 草稿 |
| 清理 | 大文件分析、C 盘清理、按类型扫描重复文件 |

电子 PDF 的文本提取不需要 AI Key；扫描件和复杂排版可使用 AI 视觉工作流。
重复文件按内容核对，默认不勾选删除，每组至少留一份，清理前再次检查并移入回收站。

文件处理默认保留原文件，结果写入输出目录。**PDF 编辑器的视觉遮盖不是安全脱敏**；转扫描件也不意味着防复制。
清理保护规则不能替代你对文件的判断。

## 06 / 图片与声音，也有自己的工具台

[↑ 返回目录](#目录)

![小男孩与蜘蛛在一个简洁工作台上处理图片、胶片和声波](assets/readme/v3.1/06-media.webp)

图片裁剪、压缩、格式转换、长图拼接、图标生成与本地模型抠图；
音视频转码、音频剪辑与提取、视频单帧、GIF，还有离线转写和 Markdown 编辑。

FFmpeg、LibreOffice、离线识别与抠图模型按需检测、安装。
已经存在且可用的运行时尽量复用，不为每个工具重复安装。
WPS / Microsoft Office 不等同于 LibreOffice，不能替代需要 `soffice` 的转换链路。

## 07 / 你来操作，也能交给 Agent

[↑ 返回目录](#目录)

![电脑旁的终端把文件任务送到工作台，小男孩与蜘蛛一起处理](assets/readme/v3.1/07-agent.webp)

**桌面端负责看得见的交互，CLI 负责批处理，Agent 负责串起任务。**

适合自动化的能力通过 `@toolknit/cli` 和 **46 项 CLI / MCP 能力**提供。
它们与桌面工具的范围不同：并非全部 73 项工具都能从命令行调用。

```powershell
npm install --global @toolknit/cli
toolknit doctor --json
toolknit --help
```

<details>
<summary><strong>在支持 MCP 的客户端中接入</strong></summary>

```json
{
  "mcpServers": {
    "toolknit": {
      "command": "toolknit",
      "args": ["mcp", "serve"]
    }
  }
}
```

基础文件能力不需要 AI Key。需要 AI 的 CLI / MCP 工作流，在进程环境中配置 `DEEPSEEK_API_KEY` 或 `TOOLKNIT_AI_API_KEY`，具体要求以命令契约为准。

[CLI / MCP 契约](toolknit-desktop/docs/cli-agent.md) · [中文 Agent 手册](toolknit-desktop/docs/agent-guide.zh-CN.md) · [English Agent guide](toolknit-desktop/docs/agent-guide.en.md)

</details>

## 看看真实的工作台

### Windows 桌面端

![ToolKnit Desktop 3.1 首页，黑白展示](assets/readme/v3.1/desktop-home.webp)

本仓库 3.1 首页的真实界面截图（浏览器渲染），统一转为灰度展示；原生文件、快捷键和系统能力需在 Windows 安装版使用。

### 免安装网页端

![ToolKnit 官网工具首页，黑白展示](assets/readme/v3.1/web-home.webp)

[ToolKnit.com](https://toolknit.com) 的真实首页截图，统一转为灰度展示。网页端与桌面端的工具范围、依赖与离线能力分别以各端说明为准。

## 08 / 开始使用

[↑ 返回目录](#目录)

![小男孩与头顶的蜘蛛挥手：一个人开发，一起把它变好](assets/readme/v3.1/08-start.webp)

| 入口 | 适合谁 |
| --- | --- |
| [下载 Windows 桌面端](https://toolknit.com/exe.html) | 长期处理本地文件、使用记录模式与截图工具 |
| [打开 ToolKnit.com](https://toolknit.com) | 快速体验、跨平台、不方便安装应用 |
| [安装 CLI](https://www.npmjs.com/package/@toolknit/cli) | 脚本、批处理与 MCP Agent 工作流 |

Windows 10 **1803 / build 17134 及以上**或 Windows 11；需要 Microsoft Edge WebView2 Runtime。
安装包内置 WebView2 引导程序，缺失时仍需联网下载运行时。Windows 7 / 8 / 8.1 不受支持。
安装包以下载页实际提供的版本为准，签名状态见[代码签名政策](CODE_SIGNING_POLICY.md)。

### 本地优先，边界说清楚

普通文件处理默认在本机完成。AI 功能仅在你主动使用时，将必要的文件内容或截图区域发送给你配置的服务。
依赖下载与更新检查需要联网；已安装的离线能力不要求 AI Key。
文件大小、页数、像素和批量限制按各工具能力区分，不承诺所有格式都无限制。

## 完整工具目录

<details>
<summary><strong>展开 73 项桌面工具 / 12 个分类</strong></summary>

| 分类 | 数量 | 工具 |
| --- | ---: | --- |
| PDF | 16 | 文件合并、文件拆分、加页码、裁剪、转图像、转 Word、转扫描件、图像转 PDF、文本提取 / Markdown、编辑器（支持新建空白 PDF）、页面旋转、加密、解密、压缩、文字增强、Excel 转 PDF |
| PPT | 7 | 转 PDF、转图片、图片提取、AI 文本提取、压缩、AI 大纲、AI 草稿 / PPTX |
| 图片 | 7 | 裁剪、智能颜色替换、背景移除、格式转换、压缩、长图拼接、图标生成器 |
| 音频 | 4 | 格式转换、BPM 节拍测速、剪辑、音频提取 |
| 视频 | 3 | 格式转换、高清单帧图、截取 GIF |
| 文本 | 5 | Markdown 编辑器、音视频提取文字、提词器、文本统计、文本格式化 |
| 计算 | 5 | 体脂率、时间戳、房贷、利息、密码生成器 |
| 创意 | 4 | 配色提取、颜色空间对比、快速截图、打字测试 |
| 清理 | 3 | AI 大文件清理、C 盘清理、重复文件清理 |
| AI | 5 | PDF 转 Markdown、文字润色、智能翻译、文档生成、表格生成 |
| 硬件 | 8 | 整机概览、CPU 与内存、显卡与显示器、主板与固件、磁盘与健康、网络与设备、电源与传感器、剪贴板历史 |
| 开发者 | 6 | JSON 格式化、Base64、URL 编解码、UUID、JWT 查看、Hash & Crypto |

</details>

## 支持与反馈

感谢 [AtomGit](https://atomgit.com/) 提供代码托管与开发协作平台。仓库镜像：[AtomGit / ToolKnit Desktop](https://atomgit.com/ZihangDong/toolknit-desktop)。

**ToolKnit 推荐：让开源创意，更快被看见。** AtomGit 集代码托管、项目管理与开发协作于一体，连接开发者与开源项目。发现实用的开源工具，分享自己的作品，与更多开发者一起把好想法变成好项目。[前往 AtomGit，探索更多开源可能。](https://atomgit.com/)

[反馈 Bug](https://github.com/ZihangDong/toolknit-desktop/issues/new?template=bug_report.yml) · [提出建议](https://github.com/ZihangDong/toolknit-desktop/issues/new?template=feature_request.yml) · [贡献指南](CONTRIBUTING.md)

如果 ToolKnit 帮你省下了时间，欢迎 Star 或[一次性捐赠支持](assets/readme/donation-support.webp)。
[感谢支持者](assets/readme/supporters-thanks.webp)。捐赠用于开发、AI 测试与维护，不代表购买功能或承诺实现需求。
定制工具：微信 **wunanvip6**；代码授权申请（含商业授权）：[info@toolknit.com](mailto:info@toolknit.com)。

## 源码运行与构建

[↑ 返回目录](#目录)

### 准备环境

本分支含单独授权的 PDF 转 Word 引擎。下述完整应用的源码运行、测试与构建须先取得该引擎的书面授权；仅阅读源码无需申请。普通用户使用官方安装包转换文件，按应用许可执行。详见[引擎许可](LICENSES/ToolKnit-PDF-Word-Source-View-1.0.md)。

使用受支持的 Windows 10 / 11，安装 Node.js **22.13+**（推荐 24）、Rust stable **1.88+**、Visual Studio C++ Build Tools（含“使用 C++ 的桌面开发”和 Windows SDK），以及 Microsoft Edge WebView2 Runtime。
首次安装 npm 与 Rust 依赖需要联网；使用已有锁文件安装依赖。

### 启动桌面端

```powershell
git clone https://github.com/ZihangDong/toolknit-desktop.git
Set-Location toolknit-desktop\toolknit-desktop
npm ci
npm run tauri dev
```

以上检出默认分支；安装包发布状态以下载页为准。只查看前端界面可在同一目录执行 `npm run dev`，访问 `http://localhost:1420/`；原生文件、系统托盘、全局截图等能力需要 Tauri 桌面环境。

### 构建安装包

在内层 `toolknit-desktop/` 目录执行：

```powershell
npm run build:release-package
```

此命令会先构建前端，再构建桌面应用；不会自动配置代码签名。默认 NSIS 安装包位于 `src-tauri/target/release/bundle/nsis/`，使用自定义 Cargo target 目录时以构建输出为准。
FFmpeg、LibreOffice 与可选模型仍按需安装，源码不包含用户密钥或完整模型包。

### 源码结构

```text
仓库根目录/
├── README.md / README_EN.md   项目介绍
├── BUILD.md                  完整构建指南
├── assets/                   文档与视觉素材
└── toolknit-desktop/          npm / Tauri 工作目录
    ├── src/features/         各工具的页面、逻辑与样式
    ├── src/app/              应用编排与生命周期
    ├── src/shared/           共享 UI 与运行时
    ├── src/platform/         浏览器与原生适配
    ├── src-tauri/            Rust 原生能力与桌面配置
    ├── cli/                  CLI / MCP 接口
    └── scripts/              检查、测试与构建脚本
```

进一步阅读：[构建指南](BUILD.md) · [贡献指南](CONTRIBUTING.md) · [架构与维护](toolknit-desktop/docs/V3_MAINTENANCE_GUIDE.zh-CN.md) · [CLI / MCP](toolknit-desktop/docs/cli-agent.md)。

### 技术栈

| 层次 | 使用的技术 | 在项目中的用途 |
| --- | --- | --- |
| 桌面与原生 | Tauri 2、Rust、Windows API、WebView2 | 桌面窗口、系统托盘、快捷键、截图、本地 OCR 与文件操作 |
| 前端与构建 | 原生 JavaScript（ES Modules）、HTML / CSS、Vite 8、Lucide | 模块化工具页、按需加载、双主题与图标 |
| PDF 与办公文件 | PDF.js、pdf-lib、docx、ExcelJS、JSZip | PDF 预览与编辑、可编辑 Word、表格生成、文档归档处理 |
| Markdown 与编辑 | CodeMirror 6、markdown-it、KaTeX、Mermaid、DOMPurify | 编辑、排版、公式与图表渲染、HTML 清理 |
| 图像与音视频 | Canvas、Rust image / oxipng、FFmpeg | 图像处理与压缩、音视频转换；FFmpeg 按需安装 |
| 本地模型与外部运行时 | ONNX Runtime、离线识别与中英翻译组件、LibreOffice | 抠图、转写、本地翻译与办公文件渲染，按功能安装 |
| 数据与网络 | SQLite、AES-GCM / Argon2、Tokio、reqwest | 本地历史存储与加密、异步任务和原生网络请求 |
| 自动化与 AI | Node.js CLI、MCP、OpenAI-compatible 接口 | 批处理、Agent 调用与用户主动配置的 AI 工作流 |

第三方组件遵循各自许可，具体版本以 `package-lock.json` 与 `src-tauri/Cargo.lock` 为准。可选运行时与模型不全部包含在主安装包中。

## 源码许可

本仓库按代码范围分别授权，详见 [NOTICE](NOTICE)：

- **一般作者代码**：自 2026-10-14 起采用 [PolyForm Noncommercial 1.0.0](LICENSE)。非商业使用、修改与分发须遵守许可、保留必要声明；商业用途须另行授权。
- **PDF 转 Word 自研引擎**：`toolknit-desktop/src/features/pdf-to-word/` 全目录及 `toolknit-desktop/src-tauri/src/native_runtime/pdf/docx_write.rs` 使用[源码阅览专属许可](LICENSES/ToolKnit-PDF-Word-Source-View-1.0.md)，不适用一般 PolyForm 授权。允许阅读源码；运行、编译、修改、集成、分发或提供服务等其他用途，**商业和非商业均须事先取得书面授权**。联系：[info@toolknit.com](mailto:info@toolknit.com)。
- **官方应用使用**：普通用户使用作者分发的官方 ToolKnit 应用或测试版转换文件，按应用使用条款执行，不因引擎源码许可另行申请；不授予提取、复用引擎或自行编译修改版本的权利。

版权仍归各自作者所有。这些属于源码可见许可，**不是 OSI 定义的开源许可**。一般思路的独立实现不因此被禁止，第三方权利与法定不可排除权利不受影响。

此前已授予的 Apache-2.0 权利不撤销；此前按 Apache-2.0 发布的未改动代码及第三方贡献保留原授权。
详见 [Apache-2.0](LICENSES/Apache-2.0.txt)、[NOTICE](NOTICE) 和版本历史。
第三方依赖、字体、模型与运行时遵循各自许可；ToolKnit 品牌、域名与托管网页服务不随源码许可授权。

## Star History

[![ToolKnit 的 GitHub 星标历史，由 Star History 动态更新](https://api.star-history.com/chart?repos=ZihangDong/toolknit-desktop&type=date&legend=top-left&sealed_token=EEoF4uyEt78cKNHZvUBEUdT5yBOuWINv90m_TWMMcy6U8sziyyBtrHlNdiHMyYXLcobnnBnywdq7HDcegwIk0Yz4IZQieMCISiRGhbR2JeweVhmBWpGlwQPb1EQB_6ZlH62IB9O1vzTDofo6dhca9fEGaXwNwNbOe5u4ZR4-McXwDHUCSiZ234AMgx3j)](https://star-history.com/#ZihangDong/toolknit-desktop&Date)
