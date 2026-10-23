# ToolKnit Desktop 3.2.0

发布日期：2026-10-23。Windows x64 无签名正式版，关闭 F12 / DevTools。

## V3.2 正式版记录

- 12 个分类、73 项工具；CLI / MCP 源码扩展至 77 项能力。
- 新增 PDF 转 Word：本地分析文字型 PDF，支持原页布局、A4 重排和可选 AI 辅助。转换后可编辑文字、替换或删除图片、重置结果，再导出 Word；扫描件暂不支持。
- 新增图像转 PDF：多图合并、排序、旋转与页边距设置，支持原彩、灰度和扫描件效果；常见多页 TIFF 可展开为独立页面。
- 记录悬浮窗接入完整剪贴板历史，增加分类、实时搜索、备注和常用语。文字与图像支持跨应用拖放，列表可拖动排序；超出悬浮窗 20 条展示范围的记录仍保留在完整历史中。
- 完善悬浮窗右键菜单、隐藏与主窗口恢复，修复首次菜单卡顿和桌面提示背景；加强剪贴板密钥备份与恢复保护。
- PDF 编辑器无需上传即可新建空白页；修复旋转、文字编辑、撤销及导出中的多项问题。PDF 拆分支持范围累加选择，进入工作台默认不选页。
- PDF 画布统一支持滚轮围绕鼠标缩放。统一输入框底线聚焦、工作台导航与结果弹框，改善双主题、PPT 下拉菜单和提取内容的可读性。
- 修复覆盖升级偶发误报卸载失败，改进托盘运行时退出、文件占用等待、旧安装目录识别与用户数据保护。
- 改进 FFmpeg、Office 与模型检测、下载和失败恢复；更新依赖并加强异常输入、任务取消和输出文件保护。
- 首页新增“V3.2新功能”分类；一键记录模式、帮助中心与工具入口继续完善。

## 下载与使用

- 安装包：本页 Assets 中的 `toolknit-desktop_3.2.0_x64-setup.exe`，附 `.sha256` 校验文件。
- 系统：Windows 10 1803（内部版本 17134）及以上的 x64 系统，包括 Windows 11。安装器携带 WebView2 引导程序；缺少运行时时需联网安装。
- 本次安装包未进行 Authenticode 签名。请从本仓库 Release 或 [ToolKnit 官网](https://toolknit.com/exe.html)下载。FFmpeg、Office 和本地模型按需安装。
- 干净源码：`toolknit-desktop_3.2.0_source.zip`，不含私有 Skill、密钥、用户数据、依赖缓存和测试输出。构建步骤见 [README](https://github.com/ZihangDong/toolknit-desktop/blob/v3.2.0/README.md#源码运行与构建)。
- **npm 3.2.0 暂缓发布。** 本次发布桌面端和源码；npm 当前仍为 2.3.1，不能通过 npm 安装尚未发布的 3.2.0。CLI / MCP 后续单独发布。
- 普通工具优先本地处理；主动使用 AI 时，所选内容会发送到用户配置的服务。复杂 PDF 与不同 Office 预览器可能存在排版差异，重要文件请核对。

## 代码许可

- 项目作者新授权代码适用 PolyForm Noncommercial 1.0.0；既有 Apache-2.0 授权及第三方权利保留。
- **PDF 转 Word 自研引擎适用单独的源码阅览条款。** 可阅读及保留必要的私人阅览副本；集成、修改、再分发等商业或非商业使用，须事先取得书面授权。官方应用正常运行属于条款规定的例外。
- 完整条款见 [引擎专属许可](https://github.com/ZihangDong/toolknit-desktop/blob/v3.2.0/LICENSES/ToolKnit-PDF-Word-Source-View-1.0.md)及 [NOTICE](https://github.com/ZihangDong/toolknit-desktop/blob/v3.2.0/NOTICE)。授权联系：info@toolknit.com。
- 完整更新内容见 [V3.2 更新日志](https://github.com/ZihangDong/toolknit-desktop/blob/v3.2.0/changelog.md)。

---

# ToolKnit Desktop 3.1.0

发布日期：2026-10-15。Windows x64 无签名正式版，关闭 F12 / DevTools。

## V3.1 正式版记录

- 12 个分类、71 项工具；CLI / MCP 保持 46 项已发布能力，本次不发布 npm 包。
- 新增一键记录模式：一次开启自启动、剪贴板实时监控和悬浮截图历史，关闭时恢复此前设置。
- 新增快速截图，默认快捷键 `Alt+Q`；支持窗口捕捉、区域选择、形状、画笔、马赛克、文字、撤销/重做及按住查看原图。历史图片可打开独立置顶查看器。
- 提供 Windows OCR、AI 图像文字提取与本地中英文翻译。翻译模型在设置中按需安装，不内置于主安装包；配置 AI 后可先校正识别再本地翻译。
- 新增重复文件清理与 PDF 转扫描件；完善 PDF 编辑、裁剪、表格转 Markdown 及 Markdown 导出。
- 改善预装 FFmpeg / LibreOffice 检测、模型下载换源、续传与完整性校验，减少重复安装。
- 修复部分电脑 ONNX Runtime 加载失败，补齐 x64 运行库；抠图自动模式支持显卡初始化或推理失败后转 CPU，也可手动使用 CPU 兼容模式。
- 统一导航、双主题与设置弹框，优化托盘恢复、窗口操作、剪贴板记录和历史缩略图性能。
- 更新检查同时读取 GitHub 与 AtomGit 标签，下载统一进入 [ToolKnit 官网](https://toolknit.com/exe.html)；检查失败不阻止使用。
- 新授权的作者代码及修改采用 PolyForm Noncommercial 1.0.0，非商业使用须遵守许可；既有 Apache-2.0 授权与第三方权利继续保留。

## V3.1 下载与安装

- 官网：[toolknit.com/exe.html](https://toolknit.com/exe.html)。本页 Assets 提供 `toolknit-desktop_3.1.0_x64-setup.exe` 及 SHA-256 校验文件。
- 系统要求：Windows 10 1803（内部版本 17134）及以上的 x64 系统，包括 Windows 11。缺少 WebView2 时需要联网安装，安装器携带引导程序。
- 安装包未进行 Authenticode 签名。请从官网或本仓库 Release 下载，并核对 `.sha256`；本地模型、FFmpeg 和 Office 渲染运行时按需安装。
- 干净源码见 `toolknit-desktop_3.1.0_source.zip`；不含私有 Skill、个人配置、依赖缓存、临时输出或安装包。运行和构建步骤见 [README](https://github.com/ZihangDong/toolknit-desktop/blob/v3.1.0/README.md#源码运行与构建)。
- 普通工具优先本地处理；主动使用 AI 时会将所选内容发送至用户配置的服务。OCR 和翻译结果请核对原文。
- 完整更新内容见 [V3.1 更新日志](../changelog.md)。CLI / MCP 源码包含在仓库中，npm 发布独立进行。

---

## V3.0 历史发布说明

## 新增与改进

- V3.0 桌面目录为 12 个分类、68 项工具；CLI / MCP 保持 46 项已发布能力。
- 新增本地 PDF 文本转 Markdown、AI 视觉 PDF 转 Markdown、Windows 剪贴板历史，复用编辑器和工具页主题。
- 全面适配白天与深色主题，首次进入 3.0 默认白天模式；主题切换和启动加载使用遮罩过渡，减少字体与布局闪动。
- 改进 PPT 大纲、PPTX 草稿和图片素材工作流；完善 PDF/PPT 的预览、导出、取消和失败恢复。
- AI 大文件清理开放受保护的系统盘扫描，跳过系统黑名单与危险路径；清理结果仍需用户逐项判断。
- 升级色彩空间对比、视频预览与 GIF 工作区；首页、帮助、设置和依赖弹层保持双主题一致。
- 界面英文使用 Montserrat，保留 PDF 专用字体；清理旧字体、旧首页截图和不再使用的静态资源。
- 正式版关闭 F12/DevTools 与远程调试入口，默认不携带按需下载的 FFmpeg 或 AI 模型。

## 下载与安装

- Windows 安装包：本页 Assets 中的 `toolknit-desktop_3.0.0_x64-setup.exe`，适用于 Windows 10 1803（内部版本 17134）及以上的 x64 系统，包括 Windows 11。
- 安装器携带 WebView2 引导程序；缺少运行时时需要联网安装。FFmpeg、Office 渲染运行时和 AI 模型按具体功能需要检测与下载。
- V3.0.0 安装包暂未进行正式 Authenticode 代码签名。SignPath 测试签名不等于正式受信任签名，本次不使用测试签名包。请从本仓库 Release 下载，并核对随包提供的 `.sha256` 文件。
- 正式版关闭 F12 / DevTools。反馈问题时请附版本号、Windows 版本、操作步骤、错误提示与脱敏截图。

## CLI / MCP

需要 Node.js 20.12 或更高版本：

```sh
npm install -g @toolknit/cli@3.0.0
toolknit --version
toolknit mcp serve
```

CLI / MCP 保持 46 项已发布能力，不代表桌面端全部 68 项工具均开放命令行调用。详细参数与 MCP 配置见 [CLI 使用指南](https://github.com/ZihangDong/toolknit-desktop/blob/v3.0.0/toolknit-desktop/cli/README.md)。

## 隐私与使用边界

- 普通文件工具优先在本机处理；使用 AI 功能时，所选内容会发送至用户自行配置的模型服务。
- 剪贴板监控由用户主动开启，记录开启后的复制内容并保存在本机；请注意其中可能包含个人信息。
- 系统盘扫描会跳过受保护路径，但扫描结果不等于可直接删除的安全清单，请核实后再清理。

---

以下保留 V2.3.1 的历史发布说明，安装与签名信息仅针对该历史版本。

# ToolKnit Desktop 2.3.1

> V2.3.1 是 V2.3 正式发布后的安全与稳定性热修。工具目录和工作流保持不变，建议所有 V2.3.0 用户更新。

## 背景移除修复

- 本地模型目录只保留有完整官方来源和 SHA-256 校验信息的 MODNet，不再展示或请求不完整的 ISNet、U2Net 来源。
- 合并重复下载请求，避免连续点击时出现 `matting:download-busy` 或未捕获的 Promise 错误。
- 模型下载超过签名目录中的预期大小时立即中止，并继续执行最终大小与 SHA-256 校验。

## 桌面端安全加固

- 正式构建关闭 WebView2 DevTools 和 F12 调试入口，并从 Tauri 编译特性中移除 DevTools 支持。
- Markdown 实时预览不再自动请求远程图片或本机服务；外部 HTTP/HTTPS 链接经过校验后交给系统浏览器，不会导航 ToolKnit 主窗口。
- 原生外链命令拒绝超长地址、控制字符、非 HTTP(S) 协议和带用户名或密码的 URL。
- “打开文件夹”只接受真实存在的绝对文件或目录路径，文件路径会解析到父目录后再交给资源管理器。
- CSP 明确禁止对象、子页面、基址和表单外发；Tauri 前端仍不具备通用 Shell、文件系统、进程、HTTP 或 Opener 权限。
- 系统盘环境变量只接受盘符加冒号；自定义背景、硬件检测和 AI 解析日志不再记录用户路径、硬件载荷、文件名或模型返回正文。
- 发布版停止写入屏幕取色和硬件检测临时调试日志，运行时创建的取色窗口也显式关闭 DevTools。
- AI API Key 从 WebView 明文存储无损迁移到 Windows 当前用户 DPAPI 加密文件；加密落盘失败时保留旧数据并提示用户，不会造成密钥丢失。
- 自定义背景的 localhost 媒体服务增加每次进程随机的 128 位访问令牌，其他本机请求无法只凭端口和文件名读取背景内容。
- 原生导航守卫只允许 ToolKnit 内部页面进入 WebView；外链打开失败时不再回退到未受控的新窗口。

## CLI、MCP 与供应链

- Whisper 模型下载在响应体超过签名目录大小时立即中止，桌面端与 CLI 保持相同边界。
- MCP stdio 增加 8 MB 原始消息上限、4 项活动调用上限，并拒绝重复请求 ID 与非法 ID 类型。
- GitHub Actions 第三方步骤全部固定到完整提交 SHA，CI 和正式发布继续执行 JavaScript、Rust 与依赖漏洞审计。
- 发布门禁新增自动安全检查，覆盖 DevTools、CSP、Tauri 权限、资源作用域、CI 供应链、敏感文件、日志隐私、API Key 加密存储、下载边界、Markdown 预览和 MCP 限流。

## 发布说明

- V2.3 桌面目录保持 12 个分类、65 项工具；CLI / MCP 保持 46 项已发布能力。
- 安装器继续携带 WebView2 引导程序，缺少运行时时会引导联网安装。
- 桌面端最低支持 Windows 10 1803（内部版本 17134）；Windows 7/8/8.1 及更早的 Windows 10 构建在安装器启动阶段明确拦截。WebView2 引导程序执行路径已加引号，并在失败弹框中保留退出码，便于区分系统版本、网络和策略问题。
- V2.3.1 暂未进行 Authenticode 代码签名。请只从本仓库 GitHub Release 下载，并核对随安装包发布的 SHA-256 文件。
