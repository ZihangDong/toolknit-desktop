# 主窗口关闭与实际可见状态

## 2026-10-20 修复

用户在首页白天模式发现关闭偶发无反应，再点击其他导航窗口按钮才消失。
截图结束的`show_without_activation`通过Win32恢复主窗口，以避免抢走当前应用焦点；
Tao 0.37.1内部可见性缓存却可能仍为隐藏。其`set_visible(false)`只按缓存差值更新，
会把随后关闭请求视为无需操作。窗口其他属性改变时重新应用缓存样式，解释了后续操作才隐藏的现象。
此前悬浮窗已经针对同源问题做过校正，但主窗口前端仍直接调用框架`hide()`。

## 责任与契约

- `src-tauri/src/platform/window_visibility.rs`集中隐藏实现：在UI线程先调用框架hide维护缓存，再用有界Win32操作隐藏实际HWND，并核验真实可见状态。无轮询、模拟输入或显示再隐藏的闪烁补丁。
- `native_runtime/core/window.rs`新增`hide_main_window`，无参数，只接受调用窗口label为`main`。返回成功或`window:main-only`/`window:hide-failed`，前端使用已有窗口操作失败提示，不暴露原生句柄或用户数据。
- `app/window-runtime.js`统一关闭入口调用该命令；原有队列、重复请求合并、超时及销毁行为保留。窗口关闭到托盘不改变页面DOM或把工具页关闭。
- `native_runtime/runner.rs`的主窗CloseRequested处理仍阻止进程退出，调用同一个平台隐藏实现。托盘显示、截图无焦点恢复方式及辅助窗口各自关闭语义保留。
- 截图域`window_visibility.rs`保留转发接口及`screenshot:window-hide-failed`错误契约，避免两套校正逻辑再次漂移。
- 白天模式阴影仍由原生窗口消息同步，不新增阴影线程或计时器。无新的storage/event/CLI契约；架构命令计数同步为151个实现、150个唯一名称。

## 验证证据

- Rust隔离子进程创建真实Tao/Win32窗口，覆盖96×96、376×760和1100×700三种尺寸、每种10轮。每轮先证明原生恢复后旧框架hide仍可见，再执行修复路径并验证立即隐藏、重复隐藏幂等、框架重新显示及再次关闭。交替启用/停用真实白天阴影，核对阴影随主窗隐藏。
- `test-window-runtime.mjs`验证新命令派发、同动作去重、队列顺序、失败/超时恢复、销毁和焦点刷新；源码契约覆盖主窗label限制与系统关闭入口。
- `test-window-controls-browser.mjs`使用实际应用DOM及模拟原生返回，双主题首页/设置/PDF工具页共18轮单次点击和隐藏恢复通过，错误为0。它不冒充真实WebView2端到端点击验收。
- 完整`npm run test:release`104个脚本通过，含架构、构建、1503项安全检查、CLI/MCP及产物审计；`cargo test --manifest-path src-tauri/Cargo.toml`为250 passed、9 ignored。独立阴影/截图专项、差异格式与私有Skill校验通过。发布门禁中的干净检出检查基于已提交的V3.2，不能当成本轮未提交隐藏修复的安装验收。
- 日志位于本机忽略目录`tmp/window-close-fix/`。已安装应用的Windows画面捕获两次超时，未将该路径记作手工验收，也未退出用户当前任务。未安装、打包或推送此次修复。

## 2026-10-20 授权测试打包

用户随后要求打测试包，执行`npm run build:test-package -- --bundles nsis`成功，包含主窗口关闭修复、此前表格文字可编辑性修复和引擎专属许可。沿用上节完整回归，打包时重新通过QA配置、版本、许可、前端构建及资源审计；生产配置DevTools仍关闭，私有Skill与测试文件不进入安装包。

- 产物：`src-tauri/target/release/bundle/nsis/toolknit-desktop_3.2.0_x64-F12-test-20261020-110018-setup.exe`。
- 大小：56,541,010字节（53.92 MiB）；安装器与程序版本均为3.2.0，程序架构x64，安装器未签名，主窗支持F12。
- SHA-256：`33948FBA88A8DCC95380FE4B000CEB772CBAC85B5B39FC04349C5AF3158CD9E7`。时间戳副本与默认构建产物一致，旁附`.sha256`文件。
- 构建记录：`tmp/window-close-fix/test-package-20261020-105632.log`与`test-package-metadata.json`。既有大chunk、STATIC_VCRUNTIME弃用和Windows linker提示不阻断构建。
- 本轮未运行安装器、提交、推送或正式发布，安装后的实际首页关闭交互留待本测试包验收。
