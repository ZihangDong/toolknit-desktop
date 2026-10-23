<div align="center">

<img src="assets/readme/v3.1/01-hero.webp" alt="ToolKnit Desktop：小男孩和头顶的蜘蛛，把桌面上的事变简单" width="100%" />

# ToolKnit Desktop 3.2

**把零散的桌面小事，收进一个工具箱。**

73 项桌面工具 · 12 个分类 · 77 项 CLI / MCP 能力 · 本地优先

[源码许可与 PDF 转 Word 独立授权](#源码许可)

<p align="center">
<a href="https://toolknit.com/exe.html"><img src="assets/readme/v3.1/link-download-zh.svg" alt="下载 Windows 版" width="168" height="40" /></a>
<a href="https://toolknit.com"><img src="assets/readme/v3.1/link-web-zh.svg" alt="打开网页端" width="144" height="40" /></a>
<a href="README_EN.md"><img src="assets/readme/v3.1/link-english.svg" alt="English" width="104" height="40" /></a>
</p>

</div>

## 关于项目和我

<p><img src="assets/readme/v3.1/spider-wave.svg" alt="眨眨眼、挥挥手的 ToolKnit 小蜘蛛" width="88" height="88" /></p>

你好，我是董子航，一个把日常麻烦做成小工具的独立开发者。
ToolKnit 像一只不停织网的蜘蛛。每个需求牵出一根线，织成一个工具。大家发现它、使用它，也帮它变得更好。
小男孩是我，头顶的蜘蛛是这个工具箱的小伙伴。

### 先用网页端

打开 **[ToolKnit.com](https://toolknit.com)**，无需安装。电脑和手机的现代浏览器均可访问。
**95 项网页工具**，覆盖 PDF、图片、音视频、文本、计算、时间、创意、AI 与自测。
多数工具无需注册。支持的文件任务在浏览器本地处理；联网要求见各工具说明。

### 再用桌面端

需要常用的文件工作台？[安装 Windows 桌面端](https://toolknit.com/exe.html)。V3.2 包含 **73 项工具**，新增 PDF 转 Word、图像转 PDF，并升级悬浮历史和常用语。
先设置输出目录，再收藏常用工具。模型按需安装。
打开**一键记录模式**，一次启用开机自启、剪贴板监控与历史悬浮窗。按 `Alt + Q` 即可截图。
首页“V3.2新功能”集中展示六项新增或增强工具。
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

主动开启，随时暂停。关闭模式会恢复启用前的设置，也可分别管理三个开关。
首页提示可本次关闭或永久关闭；设置中始终保留入口。
不记录键盘输入或浏览行为。完全退出程序后停止监控。

## 03 / 截图之后，还能继续处理

[↑ 返回目录](#目录)

![截图、标注、识别翻译与桌面置顶的黑白漫画](assets/readme/v3.1/03-screenshot.webp)

**默认按 `Alt + Q`，从窗口或选区开始。** 快捷键可以修改或关闭。

支持矩形、圆形、箭头、画笔、马赛克与文字。可撤销、重做，也可按住查看原图。
文字选框贴合内容，编辑弹框支持一键复制。
确认后复制、保存 PNG / JPG，或打开置顶查看器。保存后可退出截图，并在文件夹中选中结果。
入口位于“创意工具”。截图和其他应用的复制内容共用历史，旧图也能重新打开。

| 你想做的事 | 实际处理方式 |
| --- | --- |
| 提取文字 | Windows 本地 OCR；小字、复杂背景和排版可能识别不准 |
| AI 提取内容 | 把所选区域发送到你配置的支持图像输入的模型，提取可复制的文字 |
| 截图中英互译 | 先在设置安装本地中英文模型，再识别文字、在本机翻译并覆盖到截图 |

截图翻译只支持**中文与英文**。无 AI 配置时，本地 OCR 识别后直接翻译。
配置好图像 AI 后，先由 OCR 定位、AI 校正，再交给本地引擎翻译。
AI 校正失败时，由你确认是否改用 OCR。译文放不下时，仍可复制完整内容。

本地翻译组件按需下载，约 **192 MiB 下载 / 225 MiB 安装占用**，不塞进主安装包。
外部 AI 延迟取决于服务商，不承诺整个流程固定耗时。识别和译文建议核对。

## 04 / 复制过的内容，随时找回来

[↑ 返回目录](#目录)

![蜘蛛从历史记录中找回文字和图片，小男孩把图片打开置顶](assets/readme/v3.1/04-clipboard.webp)

**不必再问：刚才那段话，我到底复制到哪去了？**

文字、图片与文件路径按时间保存。支持分类、搜索、收藏和本地加密，监控开关在重启后保留。

| 常用操作 | V3.2 的使用方式 |
| --- | --- |
| 查看悬浮历史 | 与完整历史共用数据，显示前 20 条；按类型筛选，查看详细时间 |
| 搜索与备注 | 输入即搜索内容、来源和备注；右键添加备注或删除记录 |
| 调整顺序 | 拖动排序柄；新记录进入队首，挤出的记录仍保留在完整历史 |
| 保存常用语 | 填写标题和内容，或从文字历史加入；独立搜索，只手动删除 |
| 复制与拖放 | 单击复制常用语；常用语、历史文字和原图可拖入其他应用 |
| 看清图片 | 列表使用缩略图，打开预览恢复原图；支持置顶查看 |
| 管理悬浮窗 | 圆角右键菜单，快速打开主程序或历史；可隐藏到下次重启 ToolKnit |

记录开关位于底部，细横条显示滚动位置。悬浮窗拖出屏幕后会平滑移回。
菜单可再次点击收起，打开历史时会恢复主窗口。复制提示显示在主屏底部，不抢焦点。
拖放是否被接收取决于目标应用，**不会自动发送消息**。常用语不受历史清空或轮换影响。

只记录开启之后的新内容，不导入系统 Win + V 历史。隐私内容请按需暂停和清理。
密钥备份受 Windows 账户保护，可用于恢复丢失的密钥文件。无可用密钥时保留旧库，**不能承诺恢复已丢失的加密内容**。

## 05 / 把文件处理，集中在一个地方

[↑ 返回目录](#目录)

![小男孩处理 PDF 和 PPT，蜘蛛在重复文件中保留一份](assets/readme/v3.1/05-files.webp)

**从预览到输出，让文件工作少一点折返。**

| 工作流 | 常用能力 |
| --- | --- |
| PDF | 合并、拆分、裁剪、页码、旋转、转图片 / Word、压缩、加解密、编辑、提取文本 / Markdown |
| PPT | 转 PDF / 图片、提取图片与文字、压缩，使用 AI 生成大纲或可编辑 PPTX 草稿 |
| Excel | XLSX / XLS / ODS 转 PDF；选择全部或可见工作表，设置纸张、方向和缩放 |
| 清理 | 大文件分析、C 盘清理、按类型扫描重复文件 |

### PDF 转 Word：转换后还能改

本地分析文字、段落、表格和分栏，导出可编辑 DOCX。无需 Python、Office、显卡或额外模型。
适配论文、合同、电子书、发票、报价单和常见表格。改善中文字体、行序、字距与分页。

| 选择 | 作用 |
| --- | --- |
| 保留原页 | 按原纸张尺寸和内容位置输出，优先保留版面 |
| A4 连续排版 | 将内容整理到 A4，适配宽度并按安全边界分页 |
| 开始编辑 | 改文字、删除内容、替换图片；字号自动适配，支持撤销、重做和重置 |
| AI 辅助排版 | 可选图像 AI 判断局部结构；保留本地原文，超时后可继续处理 |

三栏工作台：左侧参数，中间预览，右侧分页。支持选页转换、取消和重新导出。
改善表格背景挡住文字、短字段变成图片及跨阅读器间距等问题。
复杂公式和不确定区域保留局部图片。**不执行扫描 OCR，也不保证所有内容可编辑或跨阅读器完全一致。**
单文件最多 **64 MiB / 100 页**。启用 AI 时才发送必要的局部图像和文字。
**该自研引擎有独立源码许可，商业与非商业复用均需书面授权。** [查看授权说明](#pdf-转-word-引擎独立条款)。

### 图像转 PDF：把多张图片整理成文件

- 支持 JPG、PNG、BMP、WebP、GIF 和常见 TIFF；多页 TIFF 展开，动态图取首帧。
- 支持拖动排序、旋转和删除；可选 A4、原图尺寸、页边距和方向。
- 原彩、灰度或扫描件效果，搭配三档清晰度；透明区域铺白底。
- 最多 100 页，单张不超过 64 MiB。逐页处理，支持取消、重试和唯一文件名保存。

### PDF 编辑与选页：从空白页也能开始

无需上传文件即可新建 A4 空白 PDF。支持多行文字、图片、形状，以及撤销和重做。
改善旋转页编辑、贴边放置、选框与导出一致性。修复撤销后图片丢失和快速重开残留。

拆分工作台默认不选页。输入 `1-10`，再输入 `15-20`，会累计选中这 **16 页**，不包含 `11-14`。
支持全选、单页、重叠去重和多文件连续编号。每次选中后清空输入，可继续追加。

PDF 预览用滚轮围绕鼠标缩放，中键或空格拖动画布。侧栏和文字区保留滚动。
统一工作台导航、双主题、输入底线和完成弹框，减少切页闪白与按钮裁切。

### 输出与清理

Excel 的“全部工作表”会包含隐藏表，只调整临时副本。普通文本 PDF 提取不需要 AI Key；扫描件文字识别请使用对应的 AI 视觉工具。
重复文件按内容核对。默认不选删除项，每组至少留一份；确认后再次检查，再移入回收站。

文件处理默认保留原文件，结果写入输出目录。**PDF 编辑器的视觉遮盖不是安全脱敏**；转扫描件也不意味着防复制。
清理保护规则不能替代你对文件的判断。

## 06 / 图片与声音，也有自己的工具台

[↑ 返回目录](#目录)

![小男孩与蜘蛛在一个简洁工作台上处理图片、胶片和声波](assets/readme/v3.1/06-media.webp)

图片裁剪、压缩、格式转换、长图拼接、图标生成与本地模型抠图；
音视频转码、音频剪辑与提取、视频单帧、GIF，还有离线转写和 Markdown 编辑。

FFmpeg、LibreOffice、离线识别与抠图模型按需检测、安装。优先复用已安装且可用的运行时。
下载支持候选源回退、断点续传和完整性校验；失败时保留可用的旧组件。网络速度因环境而异。
抠图支持 CPU 兼容模式，自动模式下显卡失败会尝试 CPU。缺少运行组件时给出明确提示。
WPS / Microsoft Office 不等同于 LibreOffice，不能替代需要 `soffice` 的转换。

## 07 / 你来操作，也能交给 Agent

[↑ 返回目录](#目录)

![电脑旁的终端把文件任务送到工作台，小男孩与蜘蛛一起处理](assets/readme/v3.1/07-agent.webp)

**桌面端负责看得见的交互，CLI 负责批处理，Agent 负责串起任务。**

V3.2 源码从 46 项扩展至 **77 项 CLI / MCP 能力**，通过 `@toolknit/cli` 调用。

> 桌面 V3.2 已发布，npm 3.2.0 暂缓发布。下面的安装命令目前仍安装 2.3.1；新增能力需等待 npm 3.2.0 发布。

| 类型 | 自动化能力举例 |
| --- | --- |
| 文档 | PDF 转 Word、图像转 PDF、PDF 选页与文本、Excel 转 PDF、Markdown 导出 |
| 图片 | 转换、压缩、裁剪、旋转、图标包 |
| 文本与计算 | 格式化、统计、编码、开发者工具和计算工具 |
| AI 与媒体 | 润色、翻译、文档 / 表格工作流、转码和离线转写 |
| 文件检查 | 只读扫描、依赖检测、结构化 JSON 结果 |

支持进度、取消和明确错误。保护原文件，失败保留已有输出；改进中文路径、长路径和模型下载。
窗口、剪贴板监听和系统清理等交互能力仍在桌面端。**77 项接口不等于 73 项桌面工具逐一对应。**

使用 **`@toolknit/cli` 3.2.0 或更高版本**，无需安装桌面端。77 项能力见[完整清单](toolknit-desktop/docs/CLI_CAPABILITIES.md)。需要 Node.js **22.13+**。

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

Windows 10 **1803 / build 17134 及以上**或 Windows 11，需要 Microsoft Edge WebView2 Runtime。
安装包内置引导程序。缺少 WebView2 时需联网补装；要求重启时，重启后再使用。
Windows 7 / 8 / 8.1 不受支持。
安装包以下载页实际提供的版本为准，签名状态见[代码签名政策](CODE_SIGNING_POLICY.md)。

### 安装与日常体验

| 环节 | 已改进的行为 |
| --- | --- |
| 覆盖升级 | 兼容旧安装记录与中文路径，等待程序释放占用，保留数据和自启动设置 |
| 卸载异常 | 区分取消、失败和需要重启；仍被占用时保留安装记录并提示重试 |
| 窗口与返回 | 修复关闭偶发失效；托盘恢复页面，设置 Escape 不再误关后台工具 |
| 双主题 | 修复 PPT 下拉箭头、提取详情、AI 编辑页及图片 / 媒体工具配色 |
| 输入与弹框 | 聚焦底线内收；改善窄窗口、禁用按钮的焦点与嵌套弹框关闭顺序 |
| 稳定性 | 加强取消、失败恢复和重复打开后的资源释放；更新安全依赖 |

检查更新读取 GitHub 与 AtomGit，下载统一进入官网。详细变更见[更新日志](changelog.md)。

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

**先确认授权，再运行源码。** 本分支包含 PDF 转 Word 引擎。
运行、测试或构建包含该引擎的完整应用，须事先取得书面授权；仅阅读源码无需申请。
官方应用和官方 CLI 的正常使用按各自条款执行。详见[引擎许可](LICENSES/ToolKnit-PDF-Word-Source-View-1.0.md)。

使用受支持的 Windows 10 / 11，安装 Node.js **22.13+**（推荐 24）、Rust stable **1.90+**、Visual Studio C++ Build Tools（含“使用 C++ 的桌面开发”和 Windows SDK），以及 Microsoft Edge WebView2 Runtime。
首次安装 npm 与 Rust 依赖需要联网；使用已有锁文件安装依赖。

### 启动桌面端

```powershell
git clone --branch main https://github.com/ZihangDong/toolknit-desktop.git
Set-Location toolknit-desktop\toolknit-desktop
npm ci
npm run tauri dev
```

以上检出 `main` 主分支。在已获授权的前提下，可运行 `npm run dev` 预览前端，默认访问 `http://localhost:1420/`。
原生文件、托盘和全局截图需要 Tauri 桌面环境。

### 构建安装包

在内层 `toolknit-desktop/` 目录执行：

```powershell
npm run build:release-package
```

先构建前端，再构建桌面应用。生产配置关闭 DevTools，代码签名需另行配置。
默认 NSIS 安装包位于 `src-tauri/target/release/bundle/nsis/`。自定义 Cargo target 目录时以构建输出为准。
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

**源码可见，不代表可以直接复用。不同组件采用不同许可。**

| 范围 | 许可与边界 |
| --- | --- |
| 一般作者代码 | 自 2026-10-14 起采用 [PolyForm Noncommercial 1.0.0](LICENSE)；合规非商业使用、修改和分发须保留声明，商业用途另行授权 |
| PDF 转 Word 自研引擎 | 采用[独立源码阅览许可](LICENSES/ToolKnit-PDF-Word-Source-View-1.0.md)，**不适用一般 PolyForm 授权** |
| 既有授权与第三方 | 此前已授予的 Apache-2.0 等权利不撤销；第三方代码、字体、模型与运行时保留原许可 |

### PDF 转 Word 引擎独立条款

适用于以下路径中的作者自有引擎代码：

- [`toolknit-desktop/src/features/pdf-to-word/`](toolknit-desktop/src/features/pdf-to-word/) 全目录。
- [`toolknit-desktop/src-tauri/src/native_runtime/pdf/docx_write.rs`](toolknit-desktop/src-tauri/src/native_runtime/pdf/docx_write.rs)。

| 行为 | 是否需要另行授权 |
| --- | --- |
| 阅读实现，保留阅览必需的私人副本 | 无需申请，须保留许可及版权声明 |
| 运行、编译、测试或修改引擎源码 | **需要事先书面授权，商业和非商业均适用** |
| 集成到产品、再分发、提供在线转换服务 | **需要事先书面授权，免费提供也不例外** |
| 正常使用作者分发的官方应用、测试版或官方 CLI/MCP | 按应用条款使用，无需仅因本引擎许可另行申请；不扩大商业使用权 |

官方 npm 包内的引擎副本和适配器继续受同一许可约束。移动、改名或提取代码不会改变授权。
官方应用使用例外**不允许提取复用引擎，也不允许自行编译修改版**。
你的输入文件和转换结果不因此归作者所有，也不会被附加引擎源码许可。

授权联系：**[info@toolknit.com](mailto:info@toolknit.com)**。请说明用途、部署和分发范围。
申请邮件、捐赠、付款或源码公开本身均不等于授权。

版权归各自作者。这些是源码可见许可，**不是 OSI 定义的开源许可**。
不复制受保护代码的一般思路独立实现、托管平台明确授予的权利及法定不可排除权利不受影响。
ToolKnit 品牌、域名与托管服务不随源码许可授权。
以上为摘要，具体范围与条件见 [NOTICE](NOTICE)、[引擎许可](LICENSES/ToolKnit-PDF-Word-Source-View-1.0.md) 和 [Apache-2.0](LICENSES/Apache-2.0.txt)。

## Star History

[![ToolKnit 的 GitHub 星标历史，由 Star History 动态更新](https://api.star-history.com/chart?repos=ZihangDong/toolknit-desktop&type=date&legend=top-left&sealed_token=EEoF4uyEt78cKNHZvUBEUdT5yBOuWINv90m_TWMMcy6U8sziyyBtrHlNdiHMyYXLcobnnBnywdq7HDcegwIk0Yz4IZQieMCISiRGhbR2JeweVhmBWpGlwQPb1EQB_6ZlH62IB9O1vzTDofo6dhca9fEGaXwNwNbOe5u4ZR4-McXwDHUCSiZ234AMgx3j)](https://star-history.com/#ZihangDong/toolknit-desktop&Date)
