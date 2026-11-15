# V3.3 版本说明、截图与支持作者页修正

日期：2026-11-14。3.3.0 仍为未发布开发版本。

## 用户可见变化

- 首次版本说明扩大到接近主窗口可用区域，正文放大、独立滚动，底部使用胶囊确认按钮。
- 弹框显示即累计可见时间，满 10 秒可以确认。隐藏时暂停，按版本记忆已读的规则不变。
- 截图保留主窗口，不最小化、隐藏或事后重新显示；搜索胶囊、历史浮窗等辅助界面继续按原会话临时隐藏并恢复。
- 支持作者区域按用户提供的网页参考展示咖啡说明、支付宝/微信双收款码、免费运营日期、早期支持者回馈及联系邮箱。
- 使用用户提供的两张 PNG，支持独立保存。累计内容播放改为 300万+，工具数量同步当前注册表的 75 项。

## 原因与责任边界

### 首次说明

`src/app/release-announcement-runtime.js` 原先要求 `document.hasFocus()`，可见 WebView 尚未返回焦点时不会推进计时；每次 tick 又截断为最多一秒，延迟投递可能进一步延长等待。现在使用单调时钟累计实际可见时间，并在可见性切换时结算。

`src/styles/components/release-announcement.css` 管理尺寸、正文滚动和按钮；启动遮罩结束后才打开说明，主页面惯性、焦点循环及确认后检查更新的顺序保持一致。

### 截图

`src-tauri/src/native_runtime/quick_screenshot/mod.rs` 在隐藏流程入口排除 `main`，桌面合成等待也不再因主窗口可见而触发。保持辅助窗口的快照、较新隐藏/禁用意图优先及不激活恢复。

`file_search/native_capture_tests.rs` 增加屏幕外真实主窗口断言：辅助浮窗隐藏/恢复期间，主 HWND 保持可见、不抢焦点。测试不采集私人桌面像素。

### 支持作者

- `src/app/templates/donation.html`、`src/styles/pages/donation.css` 和双语字典维护内容及布局，保留现有支持页导航和开发手记。
- `src/app/donation-qr-runtime.js` 只接受两种固定图片标识。浏览器保存本地资源；桌面使用现有保存对话框和写文件命令。
- `donation-controller.js` 管理保存中的禁用状态和取消所有权；关闭后不启动迟到的文件写入，也不显示过期反馈。
- 移除旧双码拼图及对应废弃样式；产物审计和主题回归改为检查新 PNG。

## 契约与维护

- 沿用 `toolknit_release_notice_acknowledged_version`，没有清空既有用户状态。
- 新增 `data-donation-save-qr` 动作及双语支持区文案；复用 `dialog:allow-save`、`write_file_bytes`，没有新增 Tauri 命令或权限。
- CLI/MCP 数量及文件处理功能不变。重依赖、模型与下载源不变。
- 根 changelog 合并短句；私有 Skill 修正可见计时、主窗保留和收款码原图保存约束，未复制进项目或安装资源。

## 验证

- 完整发布门禁：116 个 npm 脚本通过，包含架构、构建、版本/许可、CLI 独立安装及 MCP SDK 互通；安全检查 2027 项通过。
- 完整 Rust：330 passed、31 ignored。另行执行真实 WebView2/Win32 窗口回归通过：主窗保持可见、不抢焦点，辅助窗恢复与新隐藏意图优先，100 轮菜单/筛选/折叠无原生标题栏残留。
- 首次说明浏览器回归通过：模拟 `hasFocus() = false` 时立即推进、真实可见 10 秒、隐藏暂停、延迟 tick、Esc/Tab、按版本记忆及中英文、双主题、窄窗口。
- 首页/支持页浏览器回归通过：1440、1100、720、390 宽度，双主题及英文长文案、支持页入口/退出/设置返回、滚动及底部按钮可达，支付宝/微信下载内容与原 PNG 一致。
- 收款码单测通过：浏览器与桌面保存、原始字节、取消、关闭后的迟到回调及无效图片/标识拒绝。桌面保存使用模拟对话框与写命令；实际 Windows 文件保存对话框未做人工操作验收。
- 集成严格审计：75 工具、12 分类、78 CLI/MCP 能力，双语无缺失/空 key 或占位符不匹配；产物资源与 `git diff --check` 通过。私有 Skill 校验通过。

本机日志在忽略目录 `tmp/v33-ui-followup-release.log`、`v33-ui-followup-rust.log`、`v33-ui-main-window-native.log`、`v33-ui-announcement-browser.log`、`v33-ui-support-browser.log`。视觉证据在 `tmp/release-announcement/` 和 `tmp/home-settings-browser/support-coffee-*.png`，不进入安装包。

既有大 chunk/crypto 提示未新增解决承诺；另一台 Windows、多屏混合 DPI 与安装升级仍按发布环境验收。本轮未改版本、提交、推送或重新打安装包。
