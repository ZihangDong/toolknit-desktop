# ToolKnit Desktop V3.0 架构迁移报告

> 2026-10-08 V3.1 增量：新增 `pdf-to-scan` 普通 PDF 工具，当前开发源码为 69 个桌面工具、12 个分类；已发布 V3.0 的 68 项历史基线不回写。实现、公开契约和验证边界见文末“PDF 转扫描件”与 [开发说明](PDF_TO_SCAN.zh-CN.md)。下文历史数量保留各轮当时状态。

> 2026-09-21 发布前复核：下文历史记录中的 `INTER-OFL.txt` 扫描阻塞和设置导航圆角差异已修复。
> 安全扫描现在读取实际存在的 tracked/untracked 源码及 native 领域实现；中英文重复字典节点已合并。
> 移出 3 个无引用静态文件（344,325 字节），生产构建剔除 AI 文档/表格演示数据，保留有消费者的字体、授权和兼容转发。
> 发布套件 94 项、单独新增产物门禁、安全 1227 项、CLI/MCP、架构、构建及完整 Rust（164 passed / 3 ignored）通过。
> Edge 双主题页面切换和四组启动遮罩场景均通过。当前包与验证范围以 [本次发布检查](V3_RELEASE_AUDIT_2026-09-21.zh-CN.md) 为准；下文保留各轮当时状态。

> 2026-09-21 启动显示修复：新增独立 `app/startup-runtime.js`，入口内联关键遮罩样式保证首屏先显示当前主题的圆环加载器。字体设置暴露 `ready`，背景运行时暴露 `whenHomeReady()`；应用组合根仅接线。等待字体、壁纸和首页图片就绪后，复用页面过渡的 350ms 淡出节奏。新增 `appStartupMask` / `data-tk-startup` 与 `app.loading` 中英文文案，无 storage、native、CLI/MCP 变化。慢资源、失败、页面离开和超时均有退出路径。

> 启动专项：运行时测试和 Edge 四组场景通过，含深浅主题、入口脚本/字体/壁纸延迟、字体失败、减少动画、1400/1024/390 窗口、输入恢复、设置返回和缓存重载，控制台无新增异常。架构及构建通过。完整发布检查仍在既有 `INTER-OFL.txt` 索引扫描处 ENOENT，不能据此宣称发布门禁全部通过；本轮按用户要求不打包。

> 补充验证：CLI/MCP 通过，Rust 164 passed / 3 ignored，diff 检查通过。较广的 `test-page-transition-browser.mjs` 在既有设置页与 PDF 编辑器网站按钮圆角比较处失败（999px 与 6px）；本轮未修改这些导航 CSS，保留为独立待处理项。启动专项单独覆盖加载结束后的设置打开/返回与主题切换，不把该广域脚本记为通过。安装后 WebView2 冷启动仍需下一次用户授权打包后验证。

> 2026-09-21 首页视觉细化：重画 `home-weaving.svg` 蜘蛛的分节躯干、八条关节腿和局部高光；深浅主题均保留石墨色主体，以银灰/深灰轮廓区分，替代纯白反色形体。蛛网减细并分层，字标取消粗描边，`homeWeavingTypeClearance` / `homeWeavingTypeFade` 为唯一挂载的 SVG 透明留白遮罩及渐变 ID；只影响内部绘图，无 storage/native/CLI 契约变化。腿部动作以连接处为原点缓慢摆动，复用既有隐藏/弹层/低功耗暂停策略，按钮和默认壁纸策略不变。

> 本次视觉细化验证：构建、架构和 diff 检查通过；首页 Edge 专项通过双主题、中英文、390–1920 窗口、动画运行/暂停、减少动态效果、键盘链接、切换工具和清除壁纸重开，控制台无新增异常。人工查看两套主题的整页与 SVG 局部截图，确认形体、透明留白和文字可见；保持既有大 chunk 提示。本轮仅调整首页绘图、专属 CSS、已有浏览器回归及维护说明。

> 2026-09-21 增量：首页深浅主题共用既有织网 SVG、生命周期与网站按钮，深色蜘蛛变白；移除旧网页截图模块、冗余 CSS 和图片。新增 `app/custom-background-default.js`，将用户提供的山景图内置为新安装用户的深色自定义壁纸；首次白天主题不变，已有主题/背景配置保留，清除后不恢复。新增 storage 标记 `toolknit.customBackground.defaultInitialized.v1`，复用原背景 metadata、事件、设置页与 native 命令；背景来源仅额外放行固定内置图片路径，无 CLI/MCP 变更。契约和验证入口见维护指南的首页视觉与默认壁纸说明。

> 本次首页验证：`test:theme`、`test:theme-browser`、`test:architecture`、`build`、`test:cli` 和首页 Edge 专项通过，Rust 164 passed / 3 ignored。专项覆盖首次白天、首次切深色、内置图片解码、设置预览、清除后重开、中英文、390–1920 窗口、网站按钮、动画暂停和控制台；共享主题回归覆盖设置、帮助、反馈、依赖弹层和更新预览。源码资源及 dist 中的壁纸与上传图片 SHA-256 一致，旧截图不再进入 dist。`test:release` 的首项 `test:security-release` 被已有字体删除状态阻断：扫描器仍读取 Git 索引里的 `public/assets/fonts/INTER-OFL.txt`，报 ENOENT；不能据此宣称完整发布门禁通过。未打包验证安装后的 WebView2，不改版本、不提交或发布。

> 2026-09-21 增量：颜色空间对比参考 Joshua-Zion 的 PR #67（`8691216`），在既有 `features/color-space-compare/` 内接入 HSV/HSL 双色轮与 HEX 输入，未直接合并 PR。复用原工具导航、八种模型与双主题；`wheel.js` 持有画布、指针与帧合并，控制器统一输入接管，修复旧数字草稿覆盖选色及 Escape 失焦丢失 HEX 撤销快照。新增 feature-local `hex-input`、`hex-row`、`wheels`、`wheel-hit` 角色与 `data-wheel` 标识，保留旧 `hex` 输出和根级转发；无 storage、native、CLI/MCP 契约变更。来源、许可、模块职责与验证方法见 [颜色空间模块说明](../src/features/color-space-compare/README.md)。focused、architecture、build、diff 检查通过，Edge 浏览器在 DPR 1/2 下通过双主题、像素、连续拖动、联动、复制、中英文、390–1440 宽度及关闭重开；保留既有大 chunk 与 crypto 提示，未验证全部 Windows/WebView2 设备，未打包、推送或发布。

> 2026-09-20 增量：新增 `clipboard-history` Windows 本地剪贴板历史，前端复用工具页导航、硬件主题、自定义下拉与弹层，原生服务独立持有系统监听和加密存储。新增 `clipboard_history`、`copy_sensitive_text` 两个命令及只含 revision 的事件；密码生成器接入隐私标记复制。当时为 68 个桌面工具、136 个 Tauri command 实现/135 个唯一名称、46 项 CLI/MCP 能力、HTML ID 无重复。存储、公开契约、生命周期和测试限制见 `CLIPBOARD_HISTORY.zh-CN.md`。

> 2026-09-20 增量：主题切换复用共享黑色页面过渡层；视频截图修复首次播放时序并自动续播，新增会话态展开布局。当前为 68 个桌面工具、137 个 Tauri command 实现/136 个唯一名称、46 项 CLI/MCP 能力、HTML ID 无重复。行为、取消契约与验证限制见文末“主题切换与视频连续预览”。

> 2026-09-20 增量：新增 AI 分类的 `pdf-ai-markdown`，复用普通 PDF 文本提取工作台与 Markdown 编辑器导入契约。共享 AI 请求增加有界图片消息和原生取消；普通版样式移至 `styles/components/pdf-markdown-workspace.css`，原入口保留。当前源码扫描为 67 个桌面工具、134 个 Tauri command 实现/133 个唯一名称、46 项 CLI/MCP 能力、HTML ID 无重复。实现边界、资源所有权与验证限制见 `AI_PDF_MARKDOWN.zh-CN.md`；下文统计保留为历史基线。

> 2026-09-12 增量：PDF 拆分作为专用 PDF 工作台的首个模板，本地 package 仍为 3.0.0。新增 `src/shared/pdf-workbench.js` 与 `styles/components/pdf-workbench.css`，共享工具导航、编辑器三栏视图、选页、缩放和按需缩略图；不依赖具体编辑器 feature。PDF 文档归拆分 preview，导出由独立 Worker 执行，文件发布保留原命令和输出目录。新增四个 DOM ID 的兼容说明与模块责任见维护指南“PDF 专用工作台首个模板：拆分”；CLI/MCP 与其他三个待迁移工具未变。下文日期、版本和统计属于原迁移基线。

> 本轮验证：当前页/所选页合成/单页 ZIP 核心与 Worker 取消测试通过；26 页两份 PDF 的 Edge 浏览器回归通过，含深浅主题、四种窗口尺寸、中英文、设置返回、取消、重开和输出可打开性，控制台无新增错误或警告。共享编辑器/裁剪/加页码主题回归、architecture、build、89 项发布脚本（含安全与 CLI/MCP）通过；Rust 131 passed、2 ignored。未运行打包 EXE 的原生保存测试，未打包、提交、推送或发布。

更新时间：2026-09-06
分支：`codex/v3.0`  
版本：`2.3.1`（版本号保持不变）

## 1. 结论摘要

V3.0 的 66 个桌面工具已经全部进入懒加载、生命周期可控的 feature 边界。应用壳、共享 UI、平台适配、CLI/MCP 契约和安全检查均保持现有公开协议。本阶段继续把原应用编排脚本中的高耦合职责拆成独立运行时，并补齐了对应的契约测试。

本地验证基线：

- 桌面工具：66 项，12 个分类。
- Tauri command：133 个实现，132 个唯一名称；包含四个 PDF 压缩写入命令和大文件扫描取消命令 `cancel_large_file_scan`。详见 `PDF_COMPRESSION_V3.zh-CN.md` 与 `AI_LARGE_FILE_CLEANUP.zh-CN.md`。数量以源码扫描为准。
- CLI/MCP：46 项能力，名称和参数协议未改动。
- HTML ID：1,315 个，重复数 0。
- Rust 单测：102 个，其中 1 个 LibreOffice 外部环境测试按设计忽略；AI 请求超时/思考预算兼容验证见 `AI_DOCUMENT_GLM_COMPATIBILITY.zh-CN.md`，田字格契约见 `IMAGE_STITCH_GRID.zh-CN.md`。
- `src/main.js`：32 行；`src/styles.css`：4 行；`index.html`：1,663 行。
- `src/application-runtime.js`：1,975 行，作为应用组合根，剩余职责主要是依赖门禁、窗口/平台协调和全局弹层编排。
- native runtime：38 个 Rust 文件；最大文件为 `system.rs`（1,872 行），没有超过 2,000 行的 native 文件。

## 2. 文件迁移映射

### 前端应用层

| 原职责 | 当前模块 | 主要责任 |
| --- | --- | --- |
| 应用启动和依赖注入 | `src/main.js`、`src/application.js` | 启动入口、应用组装 |
| 懒加载和工具实例切换 | `src/app/lazy-tool-registry.js` | 模板挂载、动态 import、open/close/dispose、过期请求隔离 |
| 生命周期 | `src/app/tool-lifecycle.js` | listener、timer、AbortController、revision token 统一释放 |
| AI 设置 | `src/app/ai-settings-runtime.js` | 平台配置、密钥门禁、本地存储、URL 校验 |
| 外链和 GitHub 数据 | `src/app/external-links-runtime.js` | HTTP(S) 白名单、Tauri/浏览器打开、统计缓存 |
| 首页工具浏览 | `src/app/home-explorer-runtime.js` | 搜索、分类、分页、收藏、事件委托、水波交互 |
| 白天首页织网动画 | `src/app/home-weaving.js` | 首页控制器持有生命周期；静态 SVG、视口/文档可见性、共享低功耗策略；网页按钮复用既有外链契约 |
| Office 运行时安装 | `native_runtime/dependencies/libreoffice_install.rs`、`native_runtime/office/probe.rs` | 托管 CRT 部署、暂存验证与发布、启动错误码；下载/命令边界保留在 dependencies.rs |
| Office 解包监控 | `native_runtime/dependencies/libreoffice_extract.rs`、`app/dependency-helpers.js` | MSI 活动/总时限、会话日志与取消；既有进度事件增加可选 extraction，弹层与设置复用状态文案，见 LIBREOFFICE_RUNTIME_REPAIR.zh-CN.md |
| 窗口圆角表层 | `styles/components/window-surface.css` | 启用 CSS 圆角时 body 不再提供实心底色，可见背景归内容层；不改原生阴影/偏好/命令，像素回归见 WINDOW_RADIUS_REPAIR.zh-CN.md |
| PDF 密码子页导航 | `features/pdf-security/shell.js`、`shared/tool-page-shell.js` | 移用原 topbar，显式 data-tool-page-chrome 复用全局代理；返回保留文件，焦点交给 modal session，见 PDF_SECURITY_NAVIGATION.zh-CN.md |
| PDF 压缩 | `core/pdf-compression.js`、`core/pdf-raster-candidate.js`、`features/pdf-compress/`、`native_runtime/pdf/compress_write.rs` | UI 与 CLI/MCP 共用搜索/候选核心；平台分别负责缓存、Worker 和原子写入；目标严格按最终字节判断，见 PDF_COMPRESSION_V3.zh-CN.md |
| 自定义字体 | `src/app/font-settings-runtime.js` | 字体资产导入、元数据、FontFace 加载和恢复 |
| 背景媒体 | `src/app/background-runtime.js` | 自定义背景解析、挂载、播放和销毁 |
| 输出目录 | `src/app/output-runtime.js` | 默认目录、子目录、路径校验和打开位置 |
| 更新服务 | `src/app/update-runtime.js` | 版本读取、Release 解析、缓存和延迟更新 |
| 弹层与 Toast | `src/app/modal-runtime.js`、`src/app/toast-manager.js` | 可访问性、焦点和 transient feedback |

### HTML 与样式

- `index.html` 只保留应用壳、首页首屏、全局控制和必要的 fallback。
- 设置、反馈、赞助、帮助、更新和工具模板位于 `src/app/templates/` 或对应 feature 的 `template.js`。
- 全局样式入口为 `src/styles/index.css`，基础、布局、组件、页面和兼容样式分层；工具专属样式位于 `src/features/*`。
- 静态模板使用统一的 trusted template 挂载契约；动态文本使用 `textContent`、`escapeHtml` 或经过验证的固定 HTML。

### Rust 原生层

`src-tauri/src/lib.rs` 目前只负责模块注册和公开 `native_runtime::run`。`native_runtime.rs` 将 `core`、`dependencies`、`transcription`、`pdf`、`image`、`media`、`system`、`office` 和 `runner` 作为独立领域模块组合；领域内部再按 picker、window、security、image operations、media I/O、PDF operations 等子职责组织，保持 command 私有可见性和现有协议不变。平台安全、路径和任务注册位于 `platform/*`、`runtime/*` 和 `commands/*`。

这种组织避免了高风险的命令签名迁移；后续如需继续缩小单个 Rust 领域文件，应继续沿现有领域边界拆分，并为跨域私有 helper 增加明确的 `pub(super)` 边界，禁止复制安全校验。

## 3. 依赖方向

```text
app -> features -> shared/platform/core
features -> shared/platform/core
shared -> platform/core
platform -> Tauri/browser runtime
core -> no UI or platform runtime
CLI/MCP -> exported core/runtime contracts
```

feature 不得导入 `main.js`，不得直接构造 Tauri API；所有 native 调用通过 `src/platform/tauri-runtime.js` 或 feature 注入的 adapter 进入。CLI/MCP 不依赖 DOM、页面模板或 Tauri 实例。

## 4. 本阶段修复的问题

1. 帮助中心从设置页打开时，设置层会先关闭，避免两个 modal 同时 visible、焦点栈和 ARIA 状态冲突。
2. 首页收藏查找不再把工具 ID 插入 CSS 选择器，兼容不提供 `CSS.escape` 的旧版 WebView2，并消除选择器注入风险。
3. 可选模板节点缺失时，AI、外链、首页和字体运行时不会在初始化阶段因事件绑定直接抛错。
4. 版本契约测试改为读取懒加载反馈模板，修复模板迁移后的错误失败。
5. AI 设置定时器改为注入窗口对象，浏览器测试和非窗口运行环境不再依赖隐式全局。
6. Rust 中明确的兼容入口和领域标记增加 `dead_code` 语义标注，并清理模块 glob 可见性、重复图像导入和 Excel 私有接口 warning；`cargo check` 当前无 warning。
7. 修复 PDF 编辑器拆分后控制器遗漏 `createPdfEditorThumbnails` import 导致的懒加载 `ReferenceError`，并在缩略图契约测试中加入导入链断裂检查。
8. 懒加载注册器现在在动态模板挂载后、初始化器完成后统一刷新 Lucide 图标；顶部工具导航不再依赖单个 feature 是否主动调用刷新，重复打开共享实例也不会重复挂载或刷新。
9. 工具页顶部导航统一由 `src/shared/tool-page-shell.js` 的捕获阶段代理接管，兼容新旧模板属性，覆盖网页版本、支持作者、设置和窗口控制；关闭前会清理 overlay 内焦点，避免 `aria-hidden` 后代焦点警告。Tauri 下的 OpenAI-compatible HTTPS 请求改走现有 Rust 网络命令，绕过 WebView CORS，同时保留浏览器端 `fetch` 和私有 HTTP 显式授权策略。

## 5. 性能与资源生命周期

- 首页首屏不会挂载懒加载工具 DOM；工具首次打开时才加载模板、脚本和 feature CSS。
- 重复打开共享实例不会重复挂载模板或初始化；关闭工具会失效旧 revision，阻止过期异步结果写入新工具。
- feature 生命周期统一回收事件、计时器、AbortController、原生 Tauri listener、PDF.js 任务和 object URL。
- 当前生产构建主入口约 1,311.06 kB JavaScript、344.52 kB CSS；PDF、编辑器、AI、图表、PPT 和媒体依赖继续以懒加载 chunk 输出。
- 当前超过 500 kB 的 JavaScript 输出为：主入口 1,311.06 kB、一个工具 chunk 1,004.39 kB、ExcelJS 929.56 kB、fontkit 710.96 kB、共享 chunk 662.10 kB；PDF worker 2,383.40 kB。它们均由重型第三方依赖或 worker 组成，工具依赖仍按需加载；本阶段保留为非阻断警告。
- 已知非阻断提示：`pdf-lib-plus-encrypt` 的浏览器 `crypto` externalization、若干超过 500 kB 的 chunk，以及 Windows 链接器将导入库生成信息标记为 `linker_messages`。它们均不改变功能；前两项暂不阻塞开发，链接器提示属于工具链信息输出。

## 6. 验证结果

- `npm run test:architecture`：当前基线同步后通过，包含懒加载、生命周期、运行时模块契约和架构基线。
- `npm run test:release`：88 个 npm 发布门禁全部通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`：94 passed、1 ignored、0 failed。
- `cargo test --manifest-path src-tauri/Cargo.toml`：94 passed、1 ignored、0 failed；仅有 Windows 链接器 `linker_messages` 信息提示。
- CLI clean worktree：打包并安装 `toolknit-cli@2.3.1`，46 个 MCP 工具枚举和调用契约通过。
- `npm run build`：通过；只保留上述已知非阻断 warning。单独执行的 `npm run test:security-release` 通过 939 项，`npm run test:cli` 通过 CLI/MCP clean-worktree 契约。
- `npm run tauri build -- --bundles nsis`：通过，生成 Windows x64 本地 NSIS 安装包；未签名、未上传。安装包为 50,435,242 bytes，SHA-256 为 `677E55528893343F4EA7EAEF6A936D97B728EF7188588728E8AA01D5135E3835`；应用为 46,488,064 bytes，SHA-256 为 `FD2641E9C146F4D4C3C2761ED1DC04DBEB071D6C1050C68FBFA99F13765EF18E`。
- 浏览器回归：首页搜索/分类、设置到帮助弹层链路和控制台检查通过，错误/警告数为 0。

## 7. 本地 checkpoint

- `5b2d65a`：完成懒加载模板边界。
- `87d33df`：拆分 AI、外链和首页运行时。
- `3ff273e`：隔离字体设置运行时。
- `ff9c4d1`：标注 native 兼容边界。
- `77426f2`：修正懒加载反馈模板版本契约。
- `c737520`、`e962681`、`37be412`、`556860d`：同步进度、架构快照和注入修复。

所有 checkpoint 仅存在本地 `codex/v3.0`，没有推送 GitHub、发布 npm、创建 Release 或修改版本号。
# PDF/PPT 回归执行记录（2026-09-05）

本轮仍在执行，完整清单与验证边界见 [V3_PDF_PPT_REGRESSION_PROGRESS.zh-CN.md](V3_PDF_PPT_REGRESSION_PROGRESS.zh-CN.md)。共享滚轮归属 `src/shared/horizontal-wheel.js`，模态交互锁与焦点会话归属既有 `src/app/modal-runtime.js`；共享 PDF 页选择与 PPT 工作台样式分别归属 `src/styles/components/pdf-page-selection.css`、`ppt-workbench.css`，由对应 feature 按需引用。未新增 DOM ID、Tauri command、事件或 CLI/MCP 能力，未改变技术栈及组合根。

## PPT 首次打开截断修复（2026-09-07）

### 原因与责任边界

- 复现路径：刷新后先开 PPT 草稿/文本提取等页面，正文被挤成顶部窄条；先开一次 PPT 图片提取再返回，其他页面恢复。不是双层背景遮挡。
- 多个 PPT 页面共用 `.ppt-images-scroll-top` 按钮，但其定位、尺寸、隐藏态及图标尺寸仅由图片提取的懒加载 CSS 提供。缺失样式时，该按钮进入页面 grid，生成巨大的第三行。
- 1400x888 下实测：修复前草稿页 grid 为 `68px 0px 1404px`，正文高度仅 52px，按钮为 static、1400x1404；修复后为 `68px 820px`，正文高度 820px，按钮为 absolute、52x52，图标为 24x24。
- 将原规则完整迁入已有 `src/styles/components/ppt-workbench.css`，从 `src/features/ppt-images/ppt-images.css` 移除。四个 PPT feature 入口原本已显式引用共享 CSS，不增加全局预加载，不改变业务、动画或层级数值。
- `scripts/test-ppt-images-tool-contract.mjs` 增加共享样式唯一归属、尺寸/状态和四个入口引用的防回归断言；新增 `scripts/test-ppt-cold-layout-browser.mjs` 验证真实冷启动布局。
- DOM ID、storage key、事件、Tauri command、CLI/MCP 协议不变；保留工作区已有其他修复。

### 本轮验证

- 四组 PPT feature contract 通过：图片提取、工作流、草稿、渲染。
- Headless Edge 基于稳定的生产前端产物完成 37 项页面检查：7 个工具分别独立冷启动，覆盖 1400x888 默认/自定义背景、1100x700 默认背景、1100x480 自定义背景；另覆盖先开图片提取后的全部工具、刷新、Escape 后重开。
- 检查正文填满页面、仅导航/正文参与 grid、工作区可用尺寸及命中层、按钮显隐/悬停尺寸、未捕获运行异常及 aria-hidden 焦点错误；测试截图和布局数据保存在被忽略的 `tmp/ppt-cold-layout/`。
- `npm run test:release`：88 个脚本通过，包含 architecture、968 项 security-release 检查、CLI/MCP 和最终 build；四组 focused contract 已单独执行。完整 Rust 测试为 106 passed、0 failed、1 ignored。
- `npm run build` 与 `git diff --check` 通过；保留已知大 chunk、crypto externalization 和 Windows linker 信息提示。没有新增依赖、修改版本、打包安装器、提交或发布。
- 本轮是页面 CSS 加载顺序验证，不代表 PPT 原生转换/导出的全功能重新验收；未调用真实 AI 账号，未打开可见开发窗口。

### 已修复：720x480 窄窗口（2026-09-07）

- 原因是 `ppt-workflows.css` 的低高度规则不区分横向双栏与上下堆叠布局，把共享的工作区最小高度覆盖为 0，文本提取工作区仅剩 58px。现在仅在宽度至少 981px 时允许内层收缩，窄窗口保留共享最小高度，由正文外层滚动；文本提取、压缩和大纲共用此修复。
- 同轮窄窗口回归发现 PPT 图片提取的 1280px 双栏规则覆盖了 980px 单栏规则，已将前者限定到 981-1280px，保留正常窗口样式。
- `test-ppt-cold-layout-browser.mjs` 默认包含 720x480 的普通/自定义背景，不再需要环境开关。54 项通过，覆盖 7 个 PPT 工具的冷启动、滚动后按钮命中、文本提取/压缩/图片提取上传后导出按钮可达、暖启动、刷新和重开。截图在页面完全不透明后获取，屏幕外控件须先滚动再判断遮挡。
- 浏览器脚本需要可用的 Playwright/Chromium；可通过 `TOOLKNIT_TEST_MODULES` 和 `TOOLKNIT_TEST_BROWSER` 指定本机运行时。先完成 `npm run build` 再执行脚本，不要并行重建 `dist`，以免懒加载资源被测试中的构建替换。

### 全局提示层修复（2026-09-07）

- `styles/components/toasts.css` 的共享提示层由 30000 调整为 90000，高于工具/设置/普通弹框，低于依赖安装、强制更新和黑幕转场。未调整各工具层级、消息管理器、持续时间或公开接口。
- 780px 以下提示起点为 130px，避开现有 122px 双行导航；空白提示容器保持 `pointer-events: none`，提示自身可关闭。
- `node scripts/test-toast-layers-browser.mjs` 的 6 组构建版测试通过：设置、提词器、背景移除各覆盖 1100x700 与 720x480，检查真实命中、导航避让、关闭、视口和焦点；设置通过实际按钮触发，两个工具通过既有 `showToast` 注入测试消息，不调用模型或麦克风。
- `test-page-transition-browser.mjs` 通过，含首页/工具/设置/帮助、快速切换、慢 CPU、语言切换和减少动画；本轮未更改导航动画。
- 本轮发布门禁 88 项全部通过（含安全 977 项、架构、CLI 隔离安装及 MCP、build）；完整 Rust 111 passed、1 ignored。保留既知大 chunk、crypto externalization、Windows linker 及传递依赖弃用提示。本轮仅修改共享提示 CSS、PPT 响应式 CSS 和回归/文档，不改变 DOM、storage、事件、原生命令或 CLI/MCP 参数。

## AI 输出截断真实复核（2026-09-07）

- 真实接口证实：DeepSeek V4 请求遗漏 `reasoning_effort: low`，导致同一短文档在 4096 token 对照额度下大量消耗思考额度并截断；补发后完整返回。GLM-5.3/Flash 的本轮短文档、合同、表格和润色样本正常，不能外推为任意长输入均成功。
- 责任边界仍为 `src/ai-provider-core.js` 与 `src-tauri/src/ai_provider.rs`。只对两个官方主机下的四个已验证型号设置 low 默认值，保持显式档位、其他提供商、原有 token/超时边界及截断错误契约；未向应用组合根或 feature 追加提供商逻辑。
- JS 发包/原生传输一致性和 Rust provider 专项通过，四种 AI 界面的六组双提供商浏览器运行通过；发布门禁 88 项通过，完整 Rust 107 passed、1 ignored。无新增 DOM、storage、event、Tauri command 或 CLI/MCP 参数。
- 真实样本、未覆盖边界和文件说明见 [AI_DOCUMENT_GLM_COMPATIBILITY.zh-CN.md](AI_DOCUMENT_GLM_COMPATIBILITY.zh-CN.md) 的本轮复核节。密钥没有落盘，未打包、提交或发布；现有测试安装包不包含本轮修复。

## 独立白色主题第一阶段（2026-09-08）

- 范围仅为主题基础、首页和设置页。白色导航与页面、黑色工具/收藏卡片、白色卡片分类标签且不增加描边；工具库分类筛选选中时为黑底白字。工具页、帮助与独立弹框仍保留深色，不做全局反色，也不改变页面结构、懒加载或转场时长。
- `src/app/theme-runtime.js` 是主题状态唯一 owner，负责持久化、选择状态、方向键/Home/End、跨窗口 storage 同步及订阅释放；`application-runtime.js` 仅创建和注入服务。默认深色，未知值和存储不可用时回退深色；存储写入失败不阻断当前会话切换。
- `src/styles/themes/index.css` 提供角色颜色和主题控件；`home-light.css`、`settings-light.css` 按页面作用域启用颜色。现有 `window-surface.css`、`tool-nav-unified.css` 只接入颜色变量，保留深色默认值和导航布局 owner，避免另一套导航或选择器权重竞争。
- `index.html` 在样式与应用模块加载前读取主题，避免白色主题启动时闪回黑色；屏幕取色独立窗口不启用该主题。测试通过延迟主入口响应验证首帧，而不只检查启动完成后的颜色。
- `settings.html` 删除旧的唯一深色基底/自定义背景说明，语言区域改为“语言和主题”，纵向显示深色和白色选项，包含“白色主题不支持自定义壁纸”提示；中英文词条同步。白色主题下自定义背景控件模糊、禁用且 inert，不清除已有壁纸设置。
- `background-runtime.js` 管理实际媒体策略，`custom-background-settings-runtime.js` 管理预览和导入策略。切白色时停止并移除首页、工具及设置预览的自定义媒体，不再解析新壁纸地址；切回深色恢复原配置。异步回复按主题 revision 隔离；已经启动的导入可以完成并保留元数据，但不得在白色主题显示媒体。未修改原生导入/清理命令。

### 新增契约与验证

- 新 storage key：`toolknit.theme.v1`，值为 `dark` / `light`；新根状态：`html[data-theme]`；设置契约为 `[data-theme-choice]`、`[data-background-controls]`、`#settingsThemeHint`。原有壁纸 storage key、DOM ID、事件、Tauri 命令及 CLI/MCP 参数保持兼容。
- `scripts/test-theme-runtime.mjs` 覆盖状态、键盘、存储失败、启动脚本、中英文、旧原生壁纸回复、工具媒体释放、设置预览过期回复、禁用态拦截及重复 dispose。`test:theme` 已加入发布门禁。
- `scripts/test-theme-browser.mjs` 基于生产前端产物通过 7 组检查：默认主题、白色设置/壁纸释放、键盘与语言、首页配色、连续切换与工具隔离、重启/紧凑窗口/壁纸恢复、主脚本加载前白色首帧。测试使用本机 FFmpeg 生成短视频，不读取用户媒体；截图和报告仅保存在忽略目录 `tmp/theme-browser/`。
- Headless Edge 截图已核对 1400x887、中英文、1024x480、780x600、640x600 设置布局；原有页面转场浏览器回归 24 组转场和 6 组导航检查通过。运行中无新增页面异常或 aria-hidden 焦点错误。
- `npm run test:release` 89 个脚本通过，包含架构、安全 977 项、CLI 隔离安装/MCP 及 build；追加主题边界测试通过。完整 Rust 为 111 passed、1 ignored。`git diff --check` 通过；仍仅有既知大 chunk、crypto externalization、Windows linker 信息及依赖弃用提示。
- 本轮未进行 Tauri 安装后主题实测，不代表所有工具功能重新验收；没有修改版本、生成安装包、提交、推送或发布。后续工具页白色主题应继续按共享组件及 feature 作用域接入，不给旧工具全局覆盖浅色变量。

### 首页浅灰卡片与原生阴影（2026-09-08）

- 按用户确认的精修方案，白色首页的工具/收藏卡片由黑底改为 `#F3F4F5`，标题 `#191919`、说明 `#65676B`，白色分类标签不变。移除卡片描边、投影和水纹层，保留小范围分类图标配色；悬停仅用 150ms 背景变化，不位移、不缩放，并尊重减少动画设置。
- 首页开源区取消整块黑色背景和外框，使用页面白底、深色文字和黑色操作按钮；780px 以下页脚给回顶按钮预留空间，避免文字被覆盖。样式仍只在 `home-light.css`，新增 `--tk-home-card-*` 角色变量，不更改设置页卡片或工具页配色。
- `window-runtime.js` 通过注入的 `appWindow.setShadow()` 管理原生窗口阴影，复用已有 `core:window:allow-set-shadow` 权限。白色主题普通窗口启用，深色主题、最大化和全屏关闭；启动先读取真实窗口状态，恢复后重新按当前主题应用。屏幕取色窗口和浏览器预览不调用此接口。
- 阴影与无边框修复复用同一原生调用队列，执行前读取最新主题并去重；调用失败保留重试机会，不把请求失败当作已成功应用。主题订阅、窗口缩放/尺寸监听及布局回调归属既有 lifecycle scope，销毁后旧任务不再修改窗口。应用组合根只增加主题 getter 和 subscription 注入。
- 没有修改窗口圆角 storage、CSS 裁切或 Rust 圆角逻辑，不引入窗口外围 CSS 阴影、透明留白、伴随窗口或系统标题栏。Tauri 原生阴影在 Windows 无边框窗口下可能带入系统边缘与圆角；此轮未做真实桌面阴影截图验收，不能保证不同 Windows 版本、DPI 和自定义圆角的外观完全相同，需要用户测试安装包确认。
- `test-window-shadow.mjs` 已接入 `test:window-radius`，覆盖启动、切换、最大化/全屏/恢复、迟到原生响应、失败重试、调用去重、无边框保持、监听释放及取色/浏览器隔离。未新增 DOM ID、storage key、事件或原生命令，也未修改 CLI/MCP 契约。
- 验证通过：主题专项、窗口圆角/阴影专项、架构、F12 配置检查；89 项发布门禁（含 977 项安全检查、CLI/MCP 与 build）；完整 Rust 111 passed、1 ignored。主题浏览器 7 组检查及原有 24 组转场/6 组导航检查通过；页脚调整后重新 build 并完整运行主题浏览器检查。
- Headless Edge 截图核对首页收藏、工具网格、开源区及 1100x700、720x480、640x600 窄窗口，验证颜色、无描边、悬停几何稳定及页脚不被回顶按钮遮挡；截图仅保存在忽略目录 `tmp/theme-browser/`。本轮按用户要求使用 `build:test-package` 生成带 F12 的本地 NSIS 测试包，不修改版本、不提交、不推送或发布；保留既知大 chunk、crypto externalization 和 Windows linker 信息提示。

### 圆角阴影纠正与首页二次精修（2026-09-08）

- 用户安装实测推翻了上一轮只验证 `setShadow` 调用的外观假设：WebView 用 CSS alpha 裁出自定义圆角，但 DWM 阴影仍按宿主窗口轮廓生成，二者不一致。不能把“原生调用成功”当作圆角阴影正确的证据。
- 已核对 [Tauri Window.setShadow](https://v2.tauri.app/reference/javascript/api/namespacewindow/#setshadow) 与本机已安装 API 注释：此开关没有自定义半径参数，而且在 Windows 无边框窗口上会带入系统边缘；微软的 [桌面圆角说明](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-rounded-corners) 也说明逐像素 alpha 和窗口区域对系统圆角的限制。保留任意 0–32px 自定义半径需要独立轮廓，而不是继续叠加一个系统圆角预设。
- 原生 owner 为 `src-tauri/src/platform/window_shadow.rs` 及其 `window_shadow/win32.rs`：纯几何按 CSS 逻辑半径和实际 DPI 生成黑色预乘 alpha 外沿，使用 Win32 `UpdateLayeredWindow` 显示。空心内部、对称轮廓、渐隐外沿；只计算周边像素，位移复用已有位图，尺寸/半径/DPI 变化才重画，分配上限 128 MiB。没有额外 WebView、页面透明内边距或逐帧轮询。
- 该 HWND 是主窗口正下方的不激活、穿透、无任务栏工具窗口；主窗口 subclass 同步移动/缩放/显示/隐藏，最小化、最大化、全屏及 DWM cloak 状态关闭阴影。主 HWND 销毁时释放 subclass 状态、WinEvent hook 和阴影 HWND，GDI bitmap/DC 使用 RAII 释放。虚拟桌面使用进程内 cloak/uncloak 事件和 `IVirtualDesktopManager` 同步辅助窗口，不切换用户桌面；参考微软 [分层窗口输入说明](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features#layered-windows) 和 [虚拟桌面管理接口](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ivirtualdesktopmanager)。
- 前端仍由 `src/app/window-runtime.js` 负责主题/圆角选择，关闭矩形系统阴影，并在同一串行队列中发送最新圆角与阴影状态，支持去重、失败重试和迟到回复隔离。应用组合根、窗口尺寸、导航、圆角 storage key、CSS 裁切和工具页均未改动。
- 契约：既有 `set_window_corner_radius` 新增可选 `shadow: bool`，保留原命令、`radius`、返回类型及 `main` 窗口限制；旧调用省略时保留当前阴影策略。通过 `run_on_main_thread` 更新原生资源，锁不跨 Win32 重入。`Cargo.toml` 只启用现有 windows 依赖的所需 API feature，没有升级依赖、扩大 Tauri capability 或新增 CLI/MCP 契约。
- 首页 `themes/index.css` 与 `home-light.css`：卡片由 `#F3F4F5` 加深到 `#E7E8EA`，hover 为 `#DDDFE2`；各分类工具/收藏图标统一深灰 `#404247` 和中性底 `#F8F8F9`，白色分类标签、无描边和无位移不变。开源模块使用居中单列，依次排列标记、标题、说明、原则、操作与仓库地址，Star 统计缩成居中收尾，不改 DOM 和中文/英文文案契约。
- 验证：`test-window-shadow.mjs` 覆盖主题/半径同队列、快速切换、过期原生回复、失败恢复及生命周期；3 个 Rust 阴影测试覆盖多半径/96–288 DPI、像素/内存边界及屏幕外真实 HWND 的层级、COM 适配、穿透、不抢焦点、移动、改半径、主题开关、DWM cloak/恢复、最小化、隐藏/重显和销毁。没有打开可见开发窗口。
- 首页浏览器 7 组测试通过，追加所有收藏类别的统一图标、中英文居中几何、宽窄窗口无溢出与截图检查。89 项发布门禁通过，包含 977 项安全检查、CLI/MCP 和前端 build；完整 Rust 114 passed、1 ignored；最终原生收尾另跑阴影专项通过。无新增构建 warning，仍有既知大 chunk、crypto externalization 和 linker 信息。
- 风险与未做事项：原生测试不是实际安装后桌面截图验收；多显示器不同 DPI、Windows 10/11 和真实虚拟桌面迁移仍需测试电脑确认。未打包、修改版本、提交、推送或发布；当前旧安装包不包含本节改动。

### 首页紧凑开源区、搜索焦点与白底纹理（2026-09-08）

- 责任边界仅为 `src/styles/themes/home-light.css`，不改窗口阴影、圆角、主题状态、导航和工具页。开源区使用居中标题/说明及横向信息栏，上方索引与仓库地址并排，宽窗口下原则、操作与 Star 统计同排，窄窗口仍让按钮与统计并排；收起重复的装饰图标和 kicker，减少上下留白。原有普通分组 div 只在白色主题下通过 `display: contents` 参与布局，保留 DOM、链接、i18n、统计更新与 section 的 `aria-labelledby` 契约。
- 搜索框黑色双竖线来自白色主题通用 `input:focus-visible` 外框与外层 `overflow: hidden` 的裁切组合。修复由 `.home-search-field:focus-within` 绘制完整圆角焦点提示，内层 input 不再绘制 outline/阴影；同时关闭搜索框旧的扫光伪元素。鼠标和键盘都保留焦点反馈，控件宽高不变，不修改搜索逻辑。
- 白色首页内容背景保留 `#FFFFFF`，添加 48px 间距、2.5% 深灰透明度的静态细网格；导航仍为纯白。纹理只作用于首页滚动容器，没有新增图片依赖、DOM 覆盖层、动画循环或自定义壁纸入口，深色主题恢复原样。
- `scripts/test-theme-browser.mjs` 新增鼠标/Tab 聚焦后的内外框检查、聚焦前后尺寸比较、搜索输入检查、网格主题隔离、开源区横向动作行和中文/英文溢出检查。宽版高度不超过 280px、紧凑窗口不超过 340px；英文按钮在窄窗口自动换行，不裁切文字和图标。
- 主题专项、架构与前端 build 通过，主题浏览器 7 组检查通过；已核对搜索框焦点、宽版/720px/640px 及英文开源区截图，文件仅在忽略目录 `tmp/theme-browser/`。本轮用户明确要求验证后打包，沿用既有 F12 测试包配置，不改版本、提交、推送或发布。

### 白色首页开源区双栏重排（2026-09-08）

- 根据安装后截图反馈替换上一节的分散布局：整体居中，左列统一对齐标题、简介和三项原则，右列集中源码操作和 Star 统计；标题 22px、正文 13px、辅助文字 11–12px，使用固定间距和 44px 最小按钮高度。白色主题收起英文索引、重复仓库地址、Star 宣传语及概念稿页脚，不新增卡片外框或装饰背景。中等窗口保留内边距，780px 以下操作与统计同排，480px 以下底部额外留出回顶按钮空间。
- 实现仅修改 `src/styles/themes/home-light.css`，沿用现有 DOM、i18n、源码链接和 `githubStars` 更新链路；没有新 DOM ID、storage、事件、Tauri 或 CLI/MCP 契约。普通分组的白色主题 `display: contents` 不变；深色布局、首页工具卡片、搜索焦点修复、网格背景、工具页与原生阴影均不改动。
- `scripts/test-theme-browser.mjs` 检查整组居中、左列对齐、内容顺序、右列对齐、窄版横向操作行、实际文字溢出、回顶按钮避让、键盘链接焦点及深色装饰恢复。增加 1400/1100/800/720/640/390px 中文和 1400/800/640/390px 英文截图与布局指标，输出仍只在忽略目录 `tmp/theme-browser/`。
- 本轮按页面 CSS 范围运行主题专项、主题浏览器、架构、前端 build 和 diff 格式检查；不涉及原生或业务修改，不代表全工具重新验收。未打包、改版本、提交、推送或发布，既有安装包仍是上一轮样式；F12 配置未改变。

### 开源信息与工具卡片边缘对齐（2026-09-08）

- 按用户标注取消白色开源区独立的最大宽度和横向内边距，直接沿用首页工具列表的内容边界。标题、简介、原则、GitHub 与 Star 数量全部左对齐；右列只保留源码按钮，按钮右边缘与卡片列表对齐，并跨越左侧全部信息行垂直居中。600px 以下保留左侧统计、右侧按钮的紧凑底栏，不改深色主题或既有 DOM/i18n/链接/统计更新契约。
- 仅更新 `home-light.css` 与主题浏览器回归，新增卡片左右边缘对齐、统计左对齐、右侧按钮整体垂直居中的几何断言，并增加 1920px 中英文截图；连同既有宽窄屏形成 12 组布局检查。主题专项、架构、前端 build 和 diff 检查通过；不涉及原生、业务或打包配置，未重新打包、改版本、提交或发布。

### 白色设置页与首页视觉统一（2026-09-08）

- 责任边界为 `src/styles/themes/settings-light.css`，复用首页灰色卡片与深色文字 token、纯白细网格背景；将原黑色侧栏海报改为紧凑页头，标题说明靠左、版本靠右，下方保留 15 项设置的响应式网格。仅在白色主题收起重复索引、装饰说明和概念稿页脚，深色设置、首页、工具页、窗口阴影及版本保持不变。
- 普通按钮和输入框为白底深字，选中项与主要操作为黑底白字；统一提示、路径、图标、开关、禁用、悬停和键盘焦点样式。语言选项等宽并排，并在白色设置卡片内明确尊重 `hidden`，避免已有按钮样式将隐藏的下载更新按钮重新显示。壁纸禁用/模糊与配置保存逻辑不变，模型管理弹框继续使用独立配色。
- 仅更新上述 CSS 与 `scripts/test-theme-browser.mjs`，未新增或改变 DOM ID、storage、事件、Tauri command 或 CLI/MCP 契约，没有修改业务处理与原生代码。浏览器基于生产前端产物完成 8 组检查，含 17 组中英文设置布局、15 张卡片/控件溢出检查、实际音效与圆角选项操作、焦点/禁用/隐藏状态、深浅切换和既有 12 组首页布局，未捕获页面错误；核对宽窄屏与底部截图，产物仅位于忽略目录 `tmp/theme-browser/`。
- 主题专项、架构、前端 build、F12 配置专项与 diff 格式检查通过；`npm run test:release` 的 89 个脚本全部通过，包含 977 项安全检查、CLI/MCP 与相关 Rust 专项，未另行重跑完整 Rust 套件。`npm run build:test-package -- --bundles nsis` 成功，V3.0.0 x64 F12 测试安装包生成于 2026-09-08 21:29:02，大小 50,557,138 字节，已核对 SHA256 和更新时间。保留既有大 chunk、crypto externalization 与 Windows linker 提示；浏览器验证不代表在另一台 Windows 电脑安装后的原生视觉验收。未打开开发窗口、提交、推送、发布或调整打包配置。

### 白色设置页侧栏、圆角与试听文字修正（2026-09-08）

- 根据安装反馈纠正上一轮布局改动：`settings-light.css` 恢复左侧设置中心、三项元信息和九项范围标签，不再将侧栏改成页头或隐藏内容。981px 以上保持左栏，980px 以下上下排列且保留全部内容；左栏在低高度窗口限制高度并可独立滚动到底部。右侧仍复用 15 项设置与既有浅色卡片 token。
- 页面级圆角变量统一为 32px 卡片/侧栏和 999px 胶囊控件，覆盖设置页顶部按钮，未修改原生窗口圆角偏好或共享导航实现。左栏标签去掉原规则对内层文本重复施加的胶囊背景，保留单层标签。
- 试听按钮的 Flex 盒子原本居中，但中文回退字体沿用英文首选字体的行度量，字形实际偏上。仅在白色设置页中文按钮/标签中优先使用既有中文字体，保留用户字体变量和英文页面字体，不使用位移或负边距。三倍截图确认修正，字体度量回归检查中文实际字形中心偏差不超过 1.5px；英文保持图标和文字盒子居中检查。
- 更新 `scripts/test-theme-browser.mjs`，检查侧栏信息完整、底部可达、宽窄布局、卡片/控件圆角与试听字形；8 组主题浏览器检查通过，包含 17 组设置布局、12 组既有首页布局、语言/键盘/主题切换、禁用与恢复，未捕获页面错误。主题专项、架构、前端 build 与 diff 检查通过，仅保留既有大 chunk 和 crypto externalization 提示；本轮未重跑完整发布/Rust 套件，不涉及业务或原生改动。
- 本轮仅修改上述 CSS、浏览器回归与本报告，无新增 DOM、storage、事件、Tauri、CLI/MCP 契约；深色主题、首页、工具页和模型弹框保持不变。按用户要求未打包、未打开开发窗口、未改版本、未提交或发布，21:29 的旧安装包不包含本节修复。

### 全局导航胶囊圆角与白色返回轮廓（2026-09-09）

- `tool-nav-unified.css` 统一提供支持作者与返回按钮的 `--tk-nav-button-radius: 999px`，首页、帮助/法律和反馈页既有样式消费同一变量；工具页继续复用共享导航，不改变导航高度、布局、网页入口或窗口控制按钮形状。
- 返回按钮的环绕悬停轮廓改用 `--tool-back-hover-outline`，白色设置页指定黑色，深色页面保留原浅色轮廓。当前尚未适配白色主题的工具/帮助页仍使用深色外观，不全局反转颜色；不增加位移或修改事件行为。
- 补充窗口圆角契约、主题浏览器回归和工具样式巡视：66 个工具的返回/支持作者圆角检查通过（转写页为浏览器模板检查），另有 24 个首页/设置/帮助/反馈/法律/支持作者页面的深浅主题与宽窄窗口场景通过。主题浏览器 8 组检查通过，保留 17 组设置及 12 组首页布局回归，无页面错误；截图与报告仅写入忽略目录 `tmp/`。
- focused tests、主题专项、前端 build、发布门禁 89 个脚本通过，包含架构、安全 977 项和 CLI/MCP；完整 Rust 为 114 passed、1 ignored。保留既有大 chunk、crypto externalization、Windows linker 与传递依赖弃用提示；无新增 DOM、storage、事件、Tauri command 或 CLI/MCP 契约。
- 按用户要求只启动本机浏览器预览（127.0.0.1:1420，关闭 HMR），不打开 Tauri 开发窗口、不打包、不改版本、不提交或发布。浏览器检查不代表另一台 Windows 电脑上的原生功能验收，已有安装包不包含本轮导航改动。

### 白色帮助中心与声明页面（2026-09-09）

- 本轮仅适配帮助中心、程序声明和使用规范。新增 `src/styles/themes/help-light.css`，由既有主题入口加载，复用首页/设置页的纯白、灰色面板、深色文字 token，目录为 32px 圆角、选择项与按钮为胶囊圆角；返回悬停轮廓为黑色。搜索、正文、步骤、FAQ、代码示例、复制按钮和空结果均使用页面作用域内的浅色配色，不改变工具、反馈、支持作者、AI 配置、模型弹窗或更新页。
- 保留模板、DOM ID、内容、语言字典和事件处理。声明页仅在白色主题下通过 CSS Grid 将原有返回标题放到全宽顶部，宽屏双栏、窄屏上下排列；帮助中心窄屏改由外层滚动承载完整正文，目录保留独立滚动。浅色步骤条目恢复连续文本排版，避免内联代码被旧两列网格逐项挤入编号列。深色页面的样式和布局保持原样，不修改业务运行时、层级、原生窗口或导航时长。
- `test-help-center.mjs` 增加主题入口、作用域和不竞争层级的契约；`test-theme-browser.mjs` 接入 `scripts/lib/help-theme-browser.mjs`。本地预览专项通过 108 份中英文帮助内容配色检查、26 组帮助/声明宽窄与低高度布局，包含搜索无结果、复制/键盘焦点、章节切换、返回/帮助 Escape、关闭重开、深浅切换、刷新与声明正文底部可达检查；截图核对 CLI 内联代码及中英文声明排版。测试使用隔离浏览器上下文并拦截外部请求，不读取用户密钥或调用模型。
- 本轮不打包、不改版本、不提交或发布，继续保留本地 1420 浏览器预览供用户验收。尚未进行其他电脑上的原生安装回归；第 2、3 项等待本轮验收，第 4 项仍待用户决定。
- 最终验证：帮助契约、主题专项、架构与前端 build 通过；发布门禁 89 个脚本全部通过，含安全 977 项和 CLI/MCP 检查。构建版主题浏览器 9 组检查通过，包含既有首页/设置回归，以及本轮 26 组帮助/声明布局、108 份中英文帮助内容、宽窄窗口正文滚动到底的验证，无页面错误。仅保留已知大 chunk、crypto externalization、Windows linker 与传递依赖弃用提示；未另行重跑完整 Rust 套件。浏览器截图与报告保存在忽略目录 `tmp/theme-browser/help/`，旧安装包时间和大小未改变。

### 白色辅助页面第二阶段（2026-09-09）

- 范围限定为反馈、支持作者和 AI 平台密钥配置页。新增 `src/styles/themes/secondary-pages-light.css` 并接入主题入口，复用已验收的白色背景、灰色面板、深色文字及胶囊按钮；反馈评价卡片和 AI 配置面板为 32px 圆角，支持作者的二维码原图、正文和入口保持不变。适配自定义 AI 地址/模型表单、下拉选中态、密码显隐按钮、开关、禁用/错误/成功状态及窄窗口滚动。
- `help-center-runtime.js` 通过注入的 `getTheme/onThemeChange` 控制反馈光效：浅色不创建 WebGL，深转浅立即释放，关闭页面不因切换主题重新启动，dispose 解除订阅。组合根仅增加两项服务注入；评价头像以角色变量覆盖固定渐变，深色保留原默认值。没有改 AI 密钥保存、传输、白名单或持久化逻辑，没有新增 DOM、storage、事件、Tauri 或 CLI/MCP 契约。
- 新增 `scripts/lib/secondary-theme-browser.mjs` 并接入既有主题浏览器回归；预览专项通过 30 组中英文页面布局，覆盖 1400/1024/820/720/390px、低高度、正文滚动、二维码加载、手记暂停/恢复和回到二维码、AI 平台切换/自定义配置/空值错误/保存/清除/重开、返回与深浅切换。密钥测试使用隔离上下文内的无效测试字符串，外部请求被拦截，不读取用户密钥或调用实际模型。
- `test-app-runtimes.mjs` 补充光效生命周期测试，`test-theme-runtime.mjs` 补充样式入口与范围契约。本轮不打包、不改版本、不提交或发布，保留 1420 本地预览；模型管理、依赖提示和缺少密钥提示属于第三阶段，更新页仍待用户决定，均未适配。
- 最终验证：主题/运行时专项、架构、build 与 diff 检查通过；发布门禁 89 个脚本通过，包含安全 977 项和 CLI/MCP；完整 Rust 为 114 passed、1 ignored。构建版主题浏览器 10 组检查全部通过，包含原有首页/设置、第一阶段帮助/声明和本轮 30 组辅助页面布局，无页面错误。首次构建版检查遇到 CSS 将黑色 `#000000` 压缩为 `#000` 导致的测试超时，已修正等价颜色断言并完整重跑通过，没有为此修改业务样式。仅保留既知大 chunk、crypto externalization、Windows linker 与传递依赖弃用提示。截图/报告在忽略目录 `tmp/theme-browser/secondary/`；旧安装包仍为 2026-09-09 09:47:23 的产物，本轮没有重新打包或进行其他电脑的安装验收。

### 白色辅助弹层第三阶段（2026-09-09）

- 范围限定为离线识别模型、抠图模型、FFmpeg 和 LibreOffice 运行时管理，以及缺少本地依赖、缺少 AI 密钥两个前置提示。新增 `src/styles/themes/dependency-dialogs-light.css`，通过主题入口显式接入六个既有 overlay；沿用前两阶段白灰黑配色、32px 弹层和胶囊按钮，保留下载状态、错误色、进度和禁用反馈，不改变工具内页或更新页。
- 移除 `settings-light.css` 中阶段一暂时将模型弹层锁为深色的规则；弹层由独立主题文件管理，未提升 z-index、修改模板或追加应用组合根业务。背景模糊只在弹层打开时启用；低高度使用弹层内滚动，长按钮和说明允许换行，保留键盘焦点轮廓。未修改 DOM ID、storage、事件、Tauri、CLI/MCP 或模型下载与密钥保存契约。
- `test-theme-runtime.mjs` 增加入口、作用域及状态契约；`scripts/lib/dependency-theme-browser.mjs` 接入主题浏览器回归，覆盖中英文六类弹层各四种尺寸（含 390px 窄屏及 720x320 低高度），共 48 组布局，并验证下载源切换、关闭重开、缺少密钥到配置页跳转、深色隔离、焦点与底部按钮遮挡。
- 浏览器使用隔离上下文和本地视觉样本展示模型条目、下载进度、错误与禁用状态；不启动原生下载、不读取用户密钥或文件，不将样本测试宣称为真实下载、取消或删除模型验收。本地预览专项 48 组通过；主题/依赖专项、架构、build、diff 检查通过，发布门禁 89 个脚本（包含安全 977 项和 CLI/MCP）通过，完整 Rust 为 114 passed、1 ignored。
- 最终截图对照发现 CSS 压缩器在标准 `backdrop-filter` 之后出现同值 WebKit 前缀声明时只保留前缀，导致构建版模糊失效。已在本阶段主题中将标准声明放在前缀之后，并加入样式契约和浏览器打开/关闭模糊断言；修正后重新执行主题专项、架构、build 与完整构建版主题浏览器回归，11 组全部通过，阶段三仍为 48 组布局、零页面错误。报告及截图位于忽略目录 `tmp/theme-browser/dependency/`。仅保留既知构建警告；其他电脑的原生下载仍待实测。本轮不打包、不改版本、不提交或发布，保留 1420 本地预览。

### 2026-09-12 增量：PDF 旋转专用工作台

- 旋转已接入 `shared/pdf-workbench.js`。共享视图通过可选角度读取和局部刷新服务旋转页，不导入 feature；原始文件、角度和输出仍由旋转 feature 管理。
- 拆分与旋转共用 `shared/pdf-export-job.js` 的 Worker 生命周期。现有拆分导出工厂和输出契约保留；旋转新增 Worker PDF/ZIP 输出，复用原 `rotatePdfPages` 规则。
- 保留旧工作台和导出 ID，新增 feature 内部 `data-rotate-*` 交互属性及中英文文案；无新原生命令、事件、storage 或 CLI/MCP 参数。维护与回归入口详见维护指南“PDF 旋转工作台接入”。

### 2026-09-15 增量：长图拼接参数控件

- 按用户确认移除 `imageStitchHelp` 按钮及 feature 内的帮助监听/注入，导入区改成单列，“添加图片”和“从 PDF 导入”等宽。保留全局帮助中心和其余控件 ID，PDF 导入、拼接算法、原生命令、storage、事件及 CLI/MCP 契约不变。
- 长图拼接外层保留兼容的 `pdf-merge-v2` 类；白色选项表面明确由 `.image-stitch-settings` 管理，避免 PDF 通用透明背景规则覆盖本页。方向、统一尺寸和格式继续复用同组选项类，未选中为浅灰底/细边框/7px 圆角，选中为黑底白字，没有更改其他工具的通用 CSS。
- 间距、比例及 JPG 质量使用 feature 内的 `image-stitch-number-field`，原生 number 输入与单位各占一列，不再通过负边距把单位压进输入框。原生增减按钮、键盘输入、上下限、焦点和既有 input/change 监听保留；深色与白色分别使用对应的原生控件色彩方案。
- 文件范围：`src/features/image-stitch/{template.js,controller.js,tool.js,image-stitch.css}`、`src/styles/themes/image-stitch-light.css`、两个 image-stitch 契约/浏览器测试及本报告。新增契约检查覆盖帮助入口移除、独立单位列和页面样式归属；浏览器覆盖三个选项组切换/悬停/键盘焦点，以及两种主题、三种宽度（1366/1100/390px）下三个数值输入的几何、原生增减点击、键盘与上下限。
- 验证：image-stitch core/runtime/contract、architecture、build、diff 检查通过；发布回归 89 个脚本通过，包含安全 981 项及 CLI/MCP。浏览器排序、预览、2x2 至 5x5 数量门禁与导出参数、关闭重开、重复 dispose 通过，未捕获页面错误；截图位于忽略目录 `tmp/image-stitch-ui/`。本轮导出参数使用注入 adapter 验证，不等同于 Windows 文件选择器、PDF 原生导入和真实文件导出验收；未单独重跑完整 Rust 套件。
- 保留既有 crypto externalization、大 chunk 和传递依赖弃用提示。未改版本、未打包、未提交或发布；本地预览保留在 127.0.0.1:1420，关闭 HMR。

### 2026-09-15 增量：图标生成器源图列表与结果操作

- 图标源图行由缩略图、文件名、大小和删除按钮四个元素组成，白色 PDF 通用三列网格曾将删除按钮挤到第二行。仅在 `src/features/icon-generator/icon-generator.css` 中明确该行的 Flex 布局、文件名左对齐与收缩边界、删除按钮固定宽度和白色文件大小文字颜色；深色保留相同单行结构，不修改共享 PDF 队列。
- 结果继续使用既有 `audio-convert-success-*` 弹框和双按钮样式，新增内部显示节点 `iconGenSuccessPath`。桌面版显示已发布 ZIP 的父目录，并通过注入的 `openOutputFolder` 打开该目录；浏览器下载不返回本机路径，因此保留禁用的文件夹按钮和中英文下载位置提示，不伪造下载目录或成功打开状态。
- 控制器增加文件夹操作防重复点击及结果 revision 检查：失败保留弹框供重试，旧异步结果不关闭新一轮结果；关闭弹框先移出其内部焦点。原生发布未返回有效路径时走既有生成失败反馈，不展示无路径的成功结果。保留输出命令、存储、事件和 CLI/MCP 契约，不改生成算法或 ZIP 发布实现。
- 文件范围：`src/features/icon-generator/{controller.js,template.js,icon-generator.css}`、中英文 `home.iconGen` 字典、图标工具契约测试、新增 `scripts/test-icon-gen-browser.mjs` 与本报告。契约覆盖新显示节点、单行样式所有权、文件夹状态和语言键；浏览器测试覆盖深浅主题三种宽度的长文件名、缩略图、大小和删除排列，删除重传、真实生成并下载含 19 个文件的 ZIP、中英文结果提示，以及宽窄弹框双按钮对齐。
- 浏览器专项已验证原生发布的注入命令参数、实际结果父目录传递、打开失败/拒绝/重试、防连点、旧请求隔离、关闭重开和重复 dispose，无未捕获页面错误；截图及 ZIP 仅写入忽略目录 `tmp/icon-gen-ui/`。原生文件发布和资源管理器使用 adapter 验证，不代表已重新打包并执行 Windows 安装包验收。
- 最终验证：图标 core/runtime/contract 与浏览器专项通过，发布门禁 89 个脚本全部通过，包含 architecture、build、安全 981 项、CLI/MCP 与相关 Rust 专项；未单独重跑完整 Rust 套件。完整应用的首页懒加载入口、白色源图行、ZIP 下载、结果操作及返回重开通过，无页面异常；diff 格式检查通过。保留既有 crypto externalization、大 chunk 和传递依赖弃用提示；未改版本、未打包、未提交或发布。已重启 127.0.0.1:1420 本地预览，关闭 HMR。

### 2026-09-15 增量：音视频转换队列白色布局

- 根因是两页继承 PDF 白色队列的三列规则，但文件行在大小可用时包含“序号、文件名、大小、删除”四个元素，第四个元素自动换行，大小文字仍沿用深色透明白。只在 `src/styles/themes/pdf-tools-light.css` 增加同一组限定到 `[data-audio-convert-files]` 和 `#videoConvertFiles` 的规则：存在大小时采用 `28px minmax(0, 1fr) max-content 30px` 四列，缺少大小时继续使用三列；大小文字改为深灰。
- 不修改控制器、模板、上传/转换、排序/删除、深色规则或其他工具队列，没有新增 DOM、事件、storage、Tauri、CLI/MCP 契约。更新 audio-convert 与 video-tools 契约测试，新增 `scripts/test-media-convert-queue-browser.mjs` 验证完整应用入口与列表实际交互。
- 浏览器用本地构造文件验证选择、长短文件名、可选大小、两种主题的 1400/1100/390px 横向排列、按钮悬停、拖动排序、序号重排、键盘/鼠标删除、重新选择及返回重开；未捕获页面异常。截图保存在忽略目录 `tmp/media-convert-queue-ui/`，已核对两页桌面完整截图。390px 下既有整页布局会挤压队列高度，本轮只验证行内横向几何，不宣称完成移动端整页适配；没有执行原生音视频转码。测试主动阻止外部请求，因此首页 GitHub 活动产生预期的 fetch 警告，与上传队列无关。
- 音视频 focused tests、发布门禁 89 个脚本全部通过，包含 architecture、build、安全 981 项及 CLI/MCP；保留既有 crypto externalization、大 chunk 和传递依赖弃用提示。未改版本、未打包、未提交或发布；已重启 127.0.0.1:1420 预览并保持关闭 HMR。
- 完整 Rust 回归为 137 passed、3 ignored，忽略项需要额外提供 LibreOffice 安装包、Excel 或图像样本；保留既有 Windows linker 信息。最终 diff 格式检查通过。

### 2026-09-15 增量：BPM 节拍测速器白天主题

- 新增 `src/styles/themes/bpm-light.css`，通过既有主题入口加载。导航、返回、上传、拖入提示和焦点继续消费 PDF-family 共享规则；BPM 专属层只适配三栏面板、标题/数字、时间线、置信度/调式、候选 BPM、播放器、节拍指示器、音量滑块及独立挂载的 `bpmProcessMask`。演示区域是内联工作区，不改成弹框；空闲和 `.visible` 就绪状态都保持白色表面。
- 左侧沿用浅灰控制面板，结果和演示为白色细边框，主要操作/选中候选黑底白字，未选中候选浅灰底。白天取消数字渐变、上传发光及装饰圆环循环动画，保留由实际播放驱动的节拍反馈；减少动态效果偏好下只保留颜色反馈。低高度三栏可以独立滚动，980px 以下使用按内容排列的单列；时间线允许 64 根数据条收缩，避免窄列溢出。
- 文件范围为上述主题文件、`src/styles/themes/index.css`、`scripts/test-audio-tools-contract.mjs`、新增 `scripts/test-bpm-theme-browser.mjs` 和本报告。未修改 BPM 模板、深色 feature CSS、控制器、算法、输入限制、原生音频处理或播放调度；无新增 DOM ID、storage、事件、Tauri、CLI/MCP 契约。既有部分硬编码中文及动态结果的语言刷新行为不在本轮翻译修复范围内，中英文回归只验证现有文案的排版与可达性。
- 浏览器专项支持开发服务器与 `--built` 构建产物两种模式，各通过 10 组窗口尺寸/语言布局（1400x887、1100x700、1100x520、980x640、390x844）。使用本地合成 120 BPM WAV 经真实文件选择、Web Audio 解码和现有分析器得到结果，验证候选切换/悬停/键盘焦点、64 根时间线、播放/停止、双音量键盘调整、播放中主题切换、清空演示、静音无节拍、损坏文件报错后重新分析、返回及 Escape 重开。
- 测试未捕获页面异常。主动拦截外部请求产生预期 fetch 警告，损坏音频样本产生预期解码错误；截图与报告位于忽略目录 `tmp/bpm-theme-ui/` 和 `tmp/bpm-theme-built/`。已核对桌面与窄屏、低高度截图；浏览器播放状态验证不等同于人工听感或 Windows 安装包验收。
- BPM core/runtime、audio-tools contract、architecture、build、89 项发布脚本全部通过，包含安全 981 项和 CLI/MCP；完整 Rust 为 137 passed、3 ignored。保留既有大 chunk、crypto externalization、Windows linker 与传递依赖弃用提示。未改版本、打包安装程序、提交、推送或发布；本地 127.0.0.1:1420 预览已重启，HMR 保持关闭。

### 2026-09-15 增量：音频剪辑白天主题

- 新增 `src/styles/themes/audio-clip-light.css` 并接入主题入口，继续复用 PDF-family 导航、返回、侧栏文字、主要操作和焦点样式，以及既有双按钮结果弹框。专属层适配空状态、格式标签、波形底色、选区/手柄/播放线、文件信息、时间信息、播放/微调/导出控件和独立加载遮罩；不修改模板或深色 feature CSS。
- 白天使用深灰波形、浅蓝选区、蓝色普通手柄、黑色活动手柄和橙色播放线，避免白色波形在浅色背景下消失。文件名、时长和删除按钮保持单行，操作区按可用宽度排列；低高度两栏独立滚动，980px 以下转单列并跟随导航实际高度。去除会扩大滚动宽度的侧栏越界装饰圆，保留既有文字水印。
- `src/features/audio-tools/clip-controller.js` 仅调整画布呈现：读取两个 feature 主题变量，深色仍回退原白色；打开时监听根节点 `data-theme` 与画布尺寸变化，复用现有 RAF 合并重绘，关闭/销毁释放观察器。音频解码、片段计算、播放调度、限制、FFmpeg 和输出流程不变；无新增 DOM ID、storage、事件、Tauri、CLI/MCP 契约。
- 文件范围为上述主题文件、主题入口、clip controller、`scripts/test-audio-tools-contract.mjs`、新增 `scripts/test-audio-clip-theme-browser.mjs` 和本报告。浏览器专项在开发版与构建版分别覆盖中英文 10 组布局、实际 WAV 选择解码、DPR 2 画布像素、选区拖动、±1 秒微调、重置、播放中切换主题、禁用/焦点、删除重传、损坏音频失败恢复、返回/Escape 重开及观察器释放/不叠加；共享结果弹框用呈现夹具核对宽窄窗口，不伪造原生导出。
- 浏览器导出仍明确提示仅支持桌面端；原生剪辑由既有 core/runtime 和 Rust 后端测试验证非空、时长及唯一输出，不等同于本轮重新运行 Windows 文件选择器、资源管理器或安装包验收。保留既有部分硬编码中文，中英文专项只验证现有语言路径下的布局。截图及报告在忽略目录 `tmp/audio-clip-theme-ui/`、`tmp/audio-clip-theme-built/`。
- 验证：audio-clip core/runtime、audio-tools contract、architecture、build、diff 检查通过，发布门禁 89 个脚本通过（含安全 981 项及 CLI/MCP），完整 Rust 为 137 passed、3 ignored。浏览器无未捕获页面错误；主动阻止外部请求的 fetch 警告及损坏样本的解码错误属于预期测试输出。保留既有大 chunk、crypto externalization 和 Windows linker 提示。未改版本、未打包、未提交、未推送或发布；127.0.0.1:1420 预览已重启，HMR 保持关闭。

### 2026-09-15 增量：音频提取器白天主题

- 音频提取器原本复用了 PDF 风格的页面结构类，但根节点没有接入 PDF-family 白天主题，导致通用导航、面板、文字和按钮仍使用深色表现。本轮新增 `tool-page-v2-light` 作为明确的共享主题 opt-in，并扩展 `pdf-tools-light.css` 的白天作用域；没有把音频提取器加入 PDF 页面布局或改变深色默认样式。
- 新增 `src/styles/themes/audio-extract-light.css`，适配空状态、文件名/大小/移除按钮、格式选项、原生音轨选择、支持信息、处理遮罩和既有双按钮结果弹框。长文件名通过收缩边界和换行规则保持可读，低高度和窄窗口按内容滚动；多音轨、进度、输出目录、原生命令、事件和取消流程不变。
- 模板只增加主题 opt-in class，主题入口加载新文件；没有新增 DOM ID、storage、事件、Tauri、CLI/MCP 契约。结果弹框继续复用共享 `audio-clip-success-*`，打开文件夹继续调用既有 `openOutputFolder(outputParent(...))`。
- 新增 `scripts/test-audio-extract-theme-browser.mjs`，开发版覆盖中英文 10 组窗口布局、空态/已选文件/格式切换、长文件名单行信息、失败恢复、主题切换、结果弹框、删除/返回/Escape 和焦点；注入适配器验证双音轨选择、WAV 输出、进度遮罩、结果目录和无音轨禁用态。原生文件选择、FFmpeg 真实提取和 Explorer 仍由既有 runtime/native 测试及 Windows 桌面回归负责，不将适配器夹具宣称为安装包验收。
- 本轮不改版本、不打包、不提交、推送或发布；截图/报告保存在忽略目录 `tmp/audio-extract-theme-ui/`。预期的外部 GitHub 请求和浏览器下 Tauri 拖放适配器警告不计为页面错误。
- 视频格式转换的目标格式从横向按钮组改为既有 `tool-custom-select` 下拉控件。原生 `select` 保留 `MP4/MKV/MOV/WebM/AVI/FLV/WMV/TS` 值和转换参数契约，增强控件负责可视触发器、菜单、选中态、键盘方向键、Escape、焦点恢复和生命周期释放；控制器改为监听 `change`，不修改转码命令或输出流程。
- 新增 `src/styles/themes/video-tools-light.css`，复用统一下拉菜单的白天触发器、菜单、悬停、选中和焦点配色；视频转换专属样式限制在 `.video-convert-v2`，帧捕获和 GIF 的按钮组选项保持原状。更新 `test-video-tools-contract.mjs` 及 `test-media-convert-queue-browser.mjs`，覆盖实际下拉选项切换、AVI 值传递、键盘展开/关闭、双主题队列和重开。
- 视频工具 focused contract、媒体队列浏览器回归、architecture 和 build 已通过；浏览器测试保留主动拦截外部 GitHub 请求产生的预期警告。未改 Tauri 命令、事件、storage、CLI/MCP 参数、版本、打包或发布。

### 2026-09-16 增量：视频截图与 GIF 工作区体验

- 视频高清截图和 GIF 工具的右侧空状态接入共享 `tk-empty-hero` 结构，补齐中心上传入口、图标、说明和白天主题颜色；左右上传入口共用既有文件选择流程，没有新增 Tauri 文件契约。
- 视频预览卡片改为连续媒体表面，文件信息栏与视频区域保持同一深色背景，避免白天模式下视频底部出现视觉断层；仍保持 `object-fit: contain`，不拉伸或裁剪原始视频比例。
- 视频截图控制区重排为源视频规格、时间轴、当前/总时长、快速定位、逐帧按钮、毫秒输入、PNG/JPG 输出格式和导出动作；新增开头、前后 5 秒、结尾按钮，并支持方向键、Shift 加速、Home/End 和空格播放。控制器仍使用既有 `probe_video`、预览、进度事件和 `extract_video_frame` 流程。
- 新增 10 个页面内 DOM ID，用于当前/总时长、分辨率、帧率、文件大小和四个快速定位按钮；原有 DOM、命令名、事件名、storage、CLI/MCP 参数及版本不变。更新视频工具 focused contract，覆盖双工具空状态入口、控制区结构、探测信息、快速定位和键盘逻辑；视频转换核心/运行时回归保持通过。
- 根据白天模式回归反馈，移除 Frame Capture 和 GIF Studio 左侧重复上传按钮，保留右侧空状态唯一主入口；修正视频空状态说明文字的主题覆盖，并让选择视频按钮在两套主题中保持固定颜色，悬停仅做上浮动画后自动回位。

### 2026-09-20 增量：主题切换与视频连续预览

- 范围：主题设置复用 `page-transition-runtime` 的黑色渐隐渐显；增加不可被导航丢弃的队列选项，主题 revision 保证快速反向切换、关闭和存储状态一致。应用组合根只负责注入同一个过渡实例。
- 视频责任边界：`features/video-tools/preview-playback.js` 持有媒体就绪、定位、播放、暂停和后续片段；`preview-request.js` 持有单个 IPC 请求及取消。控制器继续负责文件、时间轴、导出与展开布局。先等 metadata，再 seek/canplay，避免慢设备首次点击失败。
- 播放策略：当前片段加一个下一片段，逐段预加载并在 ended 后自动续播到原视频末尾。单段仍不超过 30 秒，GIF 导出上限保持 30 秒。缓冲尚未完成时可能短暂停顿，未承诺无缝播放。暂停、拖动、换文件、返回和 dispose 会取消本实例任务，迟到结果不能写回。
- 原生命令：新增 `cancel_video_preview({ requestId })`，两个既有 render 命令增加可选 `requestId`，省略参数的 GIF 调用兼容。注册表归 `native_runtime/media/preview_jobs.rs`，限制活动任务、ID、取消墓碑、stdout/stderr、90 秒编码及 10 秒探测超时；取消会终止并回收自己的子进程，支持取消先于 IPC。保留时间范围校验与错误码，不使用全局转换取消。
- 界面：新增 `videoFrameExpandToggle` 和对应双语标签；展开动画收起说明栏并扩大预览，设置 sidebar inert/aria-hidden，Escape 优先恢复布局。加载反馈留在按钮内部，按钮仍可取消；窄窗口下控制内容留在容器内。原有事件、storage key、导出参数、CLI/MCP 与版本不变。
- 验证：主题和页面过渡行为测试、视频 frame/GIF core、视频契约（包含预览行为测试）、architecture、build、CLI/MCP 通过。完整 Rust 为 164 passed、3 ignored；后续保留探测校验的调整再次通过原生 preview 专项。使用已有 FFmpeg 显式运行了真实编码、取消和超时测试。
- 浏览器：`test-video-frame-theme-browser.mjs` 与 `test-video-preview-browser.mjs` 通过。后者在 Edge 中使用真实 65 秒 MP4 和可控 IPC 夹具验证首次播放、30/60 秒边界、暂停、双主题展开、Escape、1100/720/390 宽度、关闭和重开；主题变更时确认黑色遮罩已覆盖。原生后端与浏览器分别验证，群友的 Windows/WebView2 环境尚需桌面复测。
- 发布门禁限制：`test:release` 在 `test:security-release` 扫描已删除的历史字体 `public/assets/fonts/INTER-OFL.txt` 时 ENOENT，未通过完整发布门禁。保留已知 crypto externalization、大 chunk 与 Windows linker 提示。本轮不打包、不提交、不推送或发布；浏览器证据位于忽略目录 `tmp/video-preview-regression/`。

### 2026-09-23 增量：PDF 表格还原与 Markdown 工作区

- `features/pdf-text-extract/table-grid.js` 负责从 PDF.js 6 绘图指令读取直线与细填充边框，按网格组织多行文本、空格和合并单元格；`core.js` 优先使用网格，再保守识别局部对齐的无框表格。纵向合并标签在对应行重复，横向合并内容只保留在首列，不伪造值。相邻页边缘、列边界一致的续表沿用前页表头，每页仍保留来源标记。未增加 OCR 或网络请求。
- PDF controller 在既有逐页任务中读取 operator list，保留 revision、取消和页面清理路径。绘图读取失败仍可提取文字；支持的表格边界不是对任意 PDF 的精确排版承诺。原始反馈只有截图，本轮使用合成五列课程表验证，用户原 PDF 尚未实测。
- Markdown controller 复用 `createModalSession`、注入的输出目录和打开文件夹接口，MD/HTML 成功后显示格式、文件名及实际位置。浏览器回退本地下载并准确标注浏览器下载位置；关闭或重开后迟到结果不得弹出。新增 `data-md-expand`、`data-md-expand-icon`、`data-md-export-success`、`data-md-success-*` 及 `mdExportSuccessTitle`，保留旧导出、导入、storage、事件和原生命令契约；新增文案同步中英文。
- 工作区展开采用网格宽度、透明度和位移动画，隐藏侧栏同步 inert/aria，Escape 优先收起。合并 feature 内重复 CSS 和白天覆盖，工具动作常驻第二行，悬停仅轻微放大文字/图标；保持文档预览为白纸表面。窄窗口覆盖历史 shell 的强制 flex，表格独立横向滚动，导出和视图按钮始终可达。
- Markdown 渲染仅允许无属性的 `<br>`，仍禁用任意原始 HTML；PDF 字面符号转义，来源元数据只在独立行隐藏且保留代码块与目录行号。MD 导出保留源文，HTML 保留既有清洗和 CSP。
- 新增真实 PDF.js 表格夹具和两组浏览器回归：`test-markdown-workspace-browser.mjs` 验证真实 PDF 导入、双主题、展开/悬停、下载弹框、焦点/Escape、低高度/窄窗口与重开；`test-markdown-export-browser.mjs` 用受控 native IPC 验证实际路径传递、语言切换、失败和迟到结果。Windows 文件选择器、资源管理器和安装包需桌面复测。浏览器截图与日志仅在忽略目录 `tmp/markdown-workspace/`。
- 验证完成：PDF/Markdown focused、architecture、build、diff 检查通过，完整发布门禁 95 项脚本通过（安全检查 1249 项）；完整 Rust 164 passed、3 ignored。三组浏览器脚本通过，包括原有 PDF 空/错/部分失败和重开回归，无新增未捕获页面错误。单独 CLI 检查最初与发布检查同时 staging 导致临时资源读取失败，结束 staging 后单独重跑 CLI/MCP 通过；后续这些命令应串行运行。保留既有大 chunk、crypto externalization 和 Windows linker 提示。未改版本、打安装包、提交、推送或发布。

### 2026-10-08 增量：PDF 转扫描件

- 新业务归属 `src/features/pdf-to-scan/`：`tool.js` 负责懒加载和依赖注入，`template.js` / `pdf-to-scan.css` 复用 PDF 工作台及双主题，`controller.js` 管理文件、密码、状态、预览、进度和弹框。`core.js` 承担无平台依赖的页码、DPI、尺寸、像素效果和输出名规则；`processor.js` 逐页 PDF.js 渲染、JPEG 编码和发布；`scan-worker.js` / `worker-client.js` / `writer.js` 承担 Worker 像素处理、pdf-lib 组装、超时和响应校验。没有向应用组合根追加业务。
- 首页入口与 lazy spec 同为 `pdf-to-scan`，overlay 为 `pdfScanOverlay`，initializer 为 `initPdfScanTool`；新增 feature-local DOM ID、`data-scan-*` 动作及中英文 `home.pdfScan` / `help.nav.pdfScan` 文案，并接入中英文帮助中心。核心和工具契约测试维护入口、模板、参数、输出和生命周期；不新增或变更 storage、事件、Tauri command、CLI/MCP 参数。
- `shared/pdf-workbench.js` 只增加可选 `transformPreview = null` 钩子，用临时画布处理当前页效果并检查 revision；未传钩子的既有工具保持原行为。共享组件不反向导入 feature，PDF 文档、渲染、画布、Worker、临时密码和任务均由会话 owner 管理；关闭/销毁、取消、解析失败和迟到结果沿同一清理边界处理。
- Native 输出复用 `begin_pdf_enhance_write`、`append_pdf_enhance_chunk`、`finalize_pdf_enhance_write`、`discard_pdf_enhance_write`，沿用路径校验、分块临时写入、qpdf 验证、唯一名称和原子发布。结果路径交给既有输出运行时；不复制文件夹打开逻辑。最终发布不能取消，关闭可留下有效保存结果，但不会向新会话写入旧状态。
- 文件处理限制为 64 MB / 100 页、单页 1600 万像素 / 单边 8192 像素、100 MB 输出、60 秒解析和 10 分钟转换。输出保留页面可见宽高与方向，但不保留原文字层、链接、表单、数字签名验证能力；图像可被 OCR 识别，原稿模式也存在 JPEG 压缩，不作为脱敏或无损转换承诺。重依赖和工具 CSS 仍按需加载；像素处理和 PDF 组装放在 Worker 内。
- 数量以本轮脚本为准：69 个桌面工具 / 12 个分类（PDF 14）；1445 个 HTML ID / 0 重复；137 个 Tauri command 实现 / 136 个唯一名称；167 个 Rust 测试；46 项 MCP 能力；111 个前端 invoke 名称 / 41 个事件名称。README 区分当前开发工具数与已发布 V3.0 的 68 项；版本契约继续验证历史发布说明，不把新工具改写成 V3.0 已发布能力。package/Tauri/CLI 仍为 3.0.0。
- 验证：新核心/工具契约、帮助中心、版本、architecture、build、维护状态统计与严格集成审计通过；完整发布门禁 98 项 npm 脚本通过、安全 1264 项通过；发布套件结束后单独 CLI/MCP 回归通过，完整 Rust 164 passed、3 ignored。浏览器用真实合成 PDF 实际下载输出，检查 qpdf 有效、每页一张可解码 JPEG、文字层为空、DPI/尺寸/旋转/顺序/选择及灰度/暖色像素；覆盖双主题、双语、1401x920 / 1280x520 / 720x820 / 390x740、弹框 Tab/Escape、损坏/空/加密/超限输入、密码重试/取消、转换取消、重置、关闭重开，以及中英文帮助入口。
- 共享回归：已有 PDF、PPT、Markdown、硬件页面冒烟通过，已有 PDF 工作台双主题与 Markdown 工作区浏览器专项通过；无新增 page/ARIA 错误。测试样本、截图和下载文件只写忽略目录 `tmp/pdf-to-scan/`。原生文件选择器、安装包、实际输出目录权限和资源管理器尚未执行本轮桌面实测；保留已有大 chunk、crypto externalization、Windows linker 提示。未改版本、打包安装器、提交、推送或发布；V3.1 记录同步根目录 `changelog.md`。
