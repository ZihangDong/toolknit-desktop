# PDF 工作台导航维护记录

实现日期：2026-10-22；完整回归完成于 2026-10-23。V3.2 未发布，本次修补基于当前工作区，保留上一轮范围选页功能。

## 定位

1. 拆分、合并、旋转和 PDF 转图像的 Workspace 是工具主 overlay 的兄弟节点。可信模板最初被准备后，`createPdfWorkbench` 又重建了导航；lazy registry 随后只准备主 overlay，没有覆盖新的兄弟导航。
2. 缺少 `prepareToolPageChrome` 意味着没有 `.tk-tool-nav`、按钮形态与帮助/反馈入口。旧 header 类仍在，但已经不足以获得统一导航的布局、间距、主题表面与动画。
3. 工作台翻译用按钮下第一个 `span` 查找文案。共享导航的双图标动画也使用 span；完成初始化后，再次翻译会把图标容器替换为文字，造成图标消失和标签重复。扫描件工作台也会在语言切换时受影响。

## 修补边界

- 仅在 `src/shared/pdf-workbench.js` 补上最终挂载后的共享导航准备；不复制导航 CSS，不额外注册窗口动作监听。
- 网页版本和支持作者文案定位到已有 `data-i18n` 标签，保持动画 SVG；返回按钮同步文本、title 和 aria-label。
- 沿用全局捕获阶段动作代理、原有工作台 modal、PDF 文档生命周期、预览和导出链路。
- 不新增 DOM ID、Tauri command、事件、storage key、依赖或工具。现有 73 工具、12 分类、77 CLI/MCP 能力保持不变。

## 回归证据

- 新增 `npm run test:pdf-workbench-navigation-browser`：基于已构建的 dist 和本地合成 PDF，检查全部 16 个 PDF 工具入口，以及拆分/合并/旋转/转图像四个已载入工作台。
- 修补前 `--baseline` 复现四个二级导航未准备、按钮错位及入口缺失。修补后检查双主题、1400×887、1100×700、900×520、720×480，验证导航表面、按钮位置、图标、无裁切与不遮挡内容。
- 四个工作台验证帮助、反馈、设置、支持作者打开及返回后保留页面；中英文切换、返回、重新进入和 Escape 不重复添加控件。中文/英文刷新后保留两枚动画图标。
- `test-pdf-workbench-interaction-browser.mjs` 对照主页面和工作台的默认/悬停样式，验证六档缩放后画布空闲时不持续重绘。修正旧测试将通用图标类误当唯一设置按钮，以及已过期的导航颜色断言。
- 拆分实测 26 页多文件输入、两段范围生成 16 页、当前页及 25 页 PDF/ZIP；旋转实测原始方向叠加、选页 PDF/ZIP、取消、失败恢复和重开。均无页面异常；新导航、拆分及旋转报告均无控制台警告。
- 架构门禁和工具契约通过；集成审计的工具、分类、中英文 key 与占位符匹配通过。
- 共享导航浏览器抽查通过：PDF 扫描件、PPT 草稿、Markdown、硬件总览和重复文件清理，覆盖双主题、反复悬停、返回按钮展开、窗口图标动画与减少动态效果。
- 完整 `test:release` 108 项 npm 脚本通过，包含生产构建、1655 项安全检查、CLI/MCP 独立安装与协议回归、版本/许可/资源审计。`cargo test --manifest-path src-tauri/Cargo.toml` 为 260 passed、0 failed、11 ignored；原有大 chunk、依赖弃用和 Windows linker 提示仍存在。私有 Skill 校验和 `git diff --check` 通过。

测试产物保存在忽略目录 `tmp/pdf-workbench-navigation/`、`tmp/pdf-workbench-interaction/`、`tmp/pdf-split-workbench/`、`tmp/pdf-rotate-workbench/`；门禁日志为 `tmp/pdf-navigation-*.log`。

## 验证限制

浏览器覆盖真实模板、样式、PDF 读取/导出与共享页面导航。窗口动作代理沿用架构测试中二级页面三种动作各转发一次的契约；不把它当作安装后真实 Win32 窗口操作验收。本轮未重新生成安装包，2026-10-22 的 23:25 测试包不包含此修补。
