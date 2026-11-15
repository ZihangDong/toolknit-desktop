# V3.3 文件搜索自动配置实施记录

日期：2026-11-04。状态：实施与本机验收完成。用户确认管理员授权后已完成新协议服务及整机索引实测，并确认操作后缀/排序再收起不再闪现。临时服务已卸载，测试窗口与进程已退出。依据为已批准的 `V33_FILE_SEARCH_AUTOMATIC_SETUP_PLAN_20261104.zh-CN.md`；环境覆盖限制见末节。本轮只本地实现与验证。

## 产品与责任边界

- 首次居中 Logo 引导，点击启用后自动准备索引；移除手动范围、磁盘加速模块。旧用户明确启用后才迁移，备份旧范围，保留胶囊设置与位置。
- 自动发现本地盘、移动盘、挂载卷、已有映射网络盘和旧版明确配置的共享。按卷身份去重；支持的 NTFS 自动加速，其他位置普通索引。不开启局域网探测，不解锁或挂载设备。
- `scope_policy.rs` 在普通扫描、MFT/USN、监听、远程 helper、缓存中统一过滤明确的系统/缓存噪声。保留用户资料、微信接收文件、源码及 build/dist/target 等可能的交付目录。排除规则不是“99% 用户”的统计结论。
- 云目录检查使用 OPEN_REPARSE_POINT / OPEN_NO_RECALL 和云 reparse tag，只访问元数据；通用目录链接仍拒绝。MFT 路径缓存同时记录允许和拒绝。无法安全恢复的历史云目录路径回退重扫。
- `index_remote.rs` 使用两个有界远程生产者和批量消息，只有索引线程写 SQLite；网络等待不占用本地更新线程。初次发现不等待共享连通，部分失败保留待核实缓存。
- 普通全盘修复间隔延长为 30 分钟；监听先过滤噪声再入队，完整保留跨排除范围的改名事件。嵌套卷不会被父卷清理；盘符复用先清理旧卷缓存。
- 主页面搜索框采用共享输入样式的 plain 变体，无默认或聚焦底线，保留键盘焦点提示。授权、暂停/继续、重建和修复状态双语可见；部分覆盖不显示全部就绪。
- 主页面/浮窗共用 16 个本地彩色 SVG。来源是 Material Icon Theme 固定提交，MIT 原许可、哈希与来源清单、NOTICE 和安装资源已保留。

主要入口：`features/file-search/{controller,template,results,file-icons}.js`、相关 CSS、`native_runtime/file_search/{automatic,discovery,scope_policy,index_remote,index_fast,storage}.rs`。既有 `file_search` 命令增加 automatic-setup/resume/rebuild 动作；新偏好字段有默认值，旧动作保留兼容。工具数量与 CLI/MCP 数量未因本轮改变，搜索仍为桌面能力。

## 原生闪现与压力崩溃

1. 筛选是网页自定义菜单，截图中的系统标题栏来自结果 HWND。旧 Tao 无边框窗口仍保留 caption 等样式；原生回归在操作菜单后查出 `0x14cb0000` 样式。
2. 搜索窗专用 `window_chrome.rs` 阻止 caption/frame/system-menu 样式恢复，禁用该 HWND 的 DWM 系统过渡和非客户区绘制；保留激活消息语义。隐藏前先收起网页筛选，物理隐藏 HWND 后再同步框架可见状态。
3. 扩展 debug 压力测试又暴露堆破坏。撤掉上述新边框保护仍会复现，不能归因于 CSS。源码确认 Tauri Context 的跨线程 Clone/Drop 会操作 Tao 内部 Rc 计数。
4. 在 `src-tauri/vendor/tauri-runtime-wry` 保留 2.12.1 上游源码与原许可，以小范围 Arc 所有权修补避免跨线程复制内部 Rc；GUI 访问仍经过原线程检查。`TOOLKNIT-PATCH.md` 记录上游提交、差异和移除条件，未改 Cargo 注册表缓存。
5. 新回归覆盖四线程公共窗口句柄复制/释放、100 次真实 WebView2 筛选/选择/折叠、50 次开合、动画反向中断、窗口重建、截图隐藏/不激活恢复。所有临时 baseline 诊断分支已移除。

## 服务生命周期

服务协议更新为 4，包含受限排除策略。兼容判断校验受保护 host.json 中的组件指纹/协议、所属安装、宿主实际 SHA256 和 SCM 路径；UI-only 变化不再要求主 EXE 哈希相同。首次安装、组件变化或安装迁移仍可能需要 UAC。后台恢复不会自行弹出管理员确认；不兼容时普通索引继续，并提供修复入口。

完全退出停止索引和辅助进程；服务随客户端断连/退出回收。临时清单写入失败会清理本轮临时文件。目录/文件权限校验及普通用户客户端边界保留。

## 已取得证据

- 浏览器 43 项通过：引导、后台安装中重开、防重复授权、取消、无底线、Logo/图标、IME、滚动与分页、定位、暂停/重建、部分/错误状态、500 次筛选、50 次重开。英文 800×600 与双主题实看，控制台无新增错误。
- Rust 搜索专项：35 passed / 6 ignored，日志 `tmp/file-search-auto-focused-debug-final.log`。包含缓存策略迁移、盘符复用、嵌套卷、云标记/链接拒绝、跨排除目录移动、远程等待时本地刷新和队列取消。
- debug 原生回归再次完整通过，`tmp/file-search-auto-frame-debug-final.log`；更早的修补后 debug 也通过。未修补时多次崩溃，单次旧 release 通过不足以否认故障。
- 最新 release 原生回归通过，`tmp/file-search-auto-frame-release-final.log`。真实发布 EXE 的文件 helper 与现有 localhost 共享增删校正 2/2 通过，`tmp/file-search-auto-helper-tests.log`。
- 无需服务的真实自动范围补测通过：发现 3 个位置、其中 2 个 NTFS，发现耗时 2ms；普通模式首批 256 条结果 284ms，取消并清理独立测试缓存 101ms。`tmp/file-search-auto-ordinary-live.log`。此测试只验证首批可用、策略过滤和取消，不代表全机覆盖已完成，也不替代 NTFS 服务实测。
- 原生双 WebView 的 25 次/规模合成测试：10 万条输入到可用 P95 149.70ms；100 万条 P50 199.50ms / P95 231.20ms（含防抖），与此前约 199–237ms 基线接近。对应 native receipt 到可用 P95 105.28ms；日志 `tmp/file-search-auto-latency.log`。这是合成查询交互，不是整机初次索引耗时。
- 实际显示测试窗后，通过键盘打开了两种菜单；窗口捕获工具超时，无法据此确认逐帧视觉。测试窗已正常自动关闭，合成文件已由夹具回收，`tmp/file-search-auto-visual.log`。
- 架构、JS 搜索、帮助、许可、Skill 接入审计通过。原生 loader 审计无新增 C++ 运行库依赖；产物审计 46 个原生资源通过。
- 完整发布门禁 113 组 npm 脚本通过，包含安全检查、CLI 包/独立安装、78 项 MCP 契约与 SDK 互操作；日志 `tmp/file-search-auto-release-gate.log`。完整 Rust 为 302 passed / 20 ignored，`tmp/file-search-auto-full-rust.log`。
- 构建通过，保留既知大 chunk 和 Windows linker 信息；新增 unused 警告已移除。

## 最终实机验收（2026-11-04）

- 使用协议 4 的当前 release 宿主，客户端保持普通权限。C/D 盘各自通过首次扫描、直接 USN 增量、大小写改名、退出后补齐、无效检查点回退、取消与客户端异常退出回收。C 盘样本首扫 4032ms、直接增量 46ms；D 盘 4664ms、25ms。证据：`tmp/file-search-auto-service-C.log`、`tmp/file-search-auto-service-D.log`。限定样本首扫也读取卷元数据，不能与完整索引耗时混用。
- 实际受保护服务通过组件指纹、协议、宿主 SHA256 和安装归属检查；不同安装身份被拒绝。两盘反复连接、停止及重连均未再次要求 UAC。服务首次安装需要授权，组件升级或迁移仍可能需要再次授权。
- 自动发现 3 个位置，其中 2 个支持 NTFS。首批结果 2257ms；初次全范围索引 99289ms，944758 条，状态 ready、skipped=0、无加速错误。每个在线本地范围均有结果，所有结果通过统一排除策略检查。查询“合同”核心耗时 200ms，返回 16 条。这里只校验当前策略下覆盖与过滤，未逐文件人工清点整台电脑。
- 同一缓存重新启动后 25370ms 达到 ready、944773 条；其中一次 MetadataChanged 触发安全重扫，因此该数值不代表纯 USN 增量。测试过程中抽样观察到客户端峰值工作集 659MiB，服务峰值 108MiB；这是本机该轮样本，不是跨设备内存上限。证据：`tmp/file-search-auto-whole-machine.log`。
- 用户实际操作“全部后缀”“最相关”后折叠，回复“已检查，不再闪现”。对应测试窗正常关闭并清理合成样本，`tmp/file-search-auto-final-visual.log`。自动化 debug/release 100 轮窗口样式与隐藏检查提供补充证据；屏幕捕获工具未成功，不冒充已保存逐帧视频。
- 服务监督脚本在 finally 执行卸载，信号 `tmp/file-search-auto-service-lease-20261104/removed` 已确认；SCM 无 ToolKnitSearch 服务，测试宿主及监督进程均不在运行。全机测试仅使用独立缓存、读取文件名等元数据，未修改用户文件。

## 完成核对与覆盖限制

- 窗口：用户可见验收、真实 WebView2 压力、截图 guard、重建、快速反向开关均通过。100%/125%/150%/200% 的几何与圆角裁切由单测覆盖；当前物理设备只有单屏。
- 范围：真实本机发现与全量索引、普通模式首批/取消、共享 helper/localhost 共享、缓存策略迁移/盘符复用、嵌套卷归属与云标记校验覆盖。设备变化发现及逐卷错误继续处理已核查实现；物理拔插、真实第三方云占位文件、跨机器 ACL/企业策略和不同 Windows/显卡未做实体环境实测，后续兼容性反馈仍需追踪。
- 首次引导、隐藏配置、双语/双主题、输入无底线、彩色图标及许可链路、暂停/重建和取消授权已验证。旧范围与胶囊设置兼容；完全退出停止维护，重启继续补齐。
- 架构/build/release/security/CLI/Rust、loader/产物与 diff 检查通过；本轮实机补证没有修改产品源码，无需重复无关完整构建。
- 根 changelog 已合并完成内容和用户验收；Skill 保留本轮已验证的自动索引隔离和运行时所有权约束，实测数值仅记在本报告。

无打包、提交、推送或发布。现有 V3.3 无关改动均保留。

## 复测入口

本轮程序是 release 构建的测试产物，并非发布包：`src-tauri/target/release/toolknit-desktop.exe`，SHA256 `49f35f77d9b69186418b95ab6570479e8ca1e9378846d4d550798326e9fda7b5`。release 测试程序为 `src-tauri/target/release/deps/toolknit_desktop_lib-af5a3abe7df9351a.exe`。后续复测应创建新的监督信号目录、核对当前服务/宿主/权限，再运行 ignored 原生用例；不要重用已完成的 finish/removed 标记。架构盘点现为 323 个 Rust 测试，包含后来单独通过的普通模式实机用例。
