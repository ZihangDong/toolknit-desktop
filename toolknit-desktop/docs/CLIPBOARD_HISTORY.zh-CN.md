# Windows 剪贴板历史

## V3.2 排序与拖放补充（2026-10-17）

- 当前 schema 3 增量新增 `history_order` / `phrase_order`，按原 ID 初始化，保留所有旧密文及复制时间。`ordering.rs` 持有真实顺序；`reorder {collection,id,targetId,after}` 在事务中根据当前锚点移动，不覆盖拖动期间新增的记录。外键随记录删除清理排序，不改变主历史的日期时间线、保留期限和容量清理。
- 悬浮历史 `list.query.ordered=true` 按保存顺序取前 20 条，新记录总进队首；底部移出仅影响展示，不删除原库。空搜索仍在这 20 条内分类，搜索按保存顺序查完整历史。主工具原 ID/snapshot 分页兼容；ordered 查询不接受旧 before/snapshot。常用语分页以锚点 ID 查当前 rank，复制/编辑不改变位置；锚点消失返回 `clipboard:order-changed` 并刷新。
- 常用语 UI 只显示标题和内容，搜索仅匹配这两项。`phraseSave.note` 改为可选：省略时保留旧记录已有备注，新建为空；从历史转存不再复制备注，原历史备注保留。旧备注不自动删除；下方 schema 2 / 备注容量说明保留兼容背景。
- `drag {collection,id}` 仅允许历史悬浮窗口，只接收有限 collection 和记录 ID，不接收任意路径或正文。原生解密完整内容后在主线程启动 Windows Shell OLE 拖放，文字使用 `CF_UNICODETEXT`，图片使用 `CF_HDROP` 指向完整原图 PNG。只允许 COPY，不修改剪贴板，不发送消息，不将拖放结果等同于用户已提交/发送。准备完成后再次检查鼠标左键和源窗口可见性，松手或窗口消失不启动迟到拖放；仅一个拖放会话可运行。
- 2026-10-18：`drag.rs::text_payload` 将 LF、CR、CRLF 统一为 Windows CRLF 后编码 UTF-16，已有 CRLF 不重复插入 CR；保留段落、空行、末尾换行、空格与 Unicode，不改存储正文。数据来自记录 ID 对应的完整正文，不读取卡片 DOM 的视觉折行。测试覆盖单行邮箱、长中英文及 emoji、混合换行和转换幂等；接收应用自身的视觉折行仍需按实际目标和样例区分。
- 图片导出位于应用缓存的 `clipboard-drag`，随机文件名、create_new、不覆盖。最多 64 个/128 MiB；每次图片拖放清理超过 24 小时的受控命名普通文件，近期文件保留供聊天草稿延迟读取，不在 Drop 返回时立即删。容量满拒绝新增，不删近期草稿；不接受前端提供的路径。
- 前端 `history-drag.js` 负责拖动柄、插入标记、边缘滚动和手势区分；正文拖出、柄内排序，点击与取消不混淆。拖动开始使旧查询失效，结束重查并合并新记录，失败恢复实际数据库顺序；模式切换和筛选在拖动中不执行。纯文件路径记录只排序，未新增文件内容外拖。

验证入口：`cargo test --manifest-path src-tauri/Cargo.toml clipboard_history --lib`、`scripts/test-quick-screenshot-browser.mjs`。原生测试检查实际 OLE 数据对象、长 Unicode/换行和文件格式、原图尺寸及临时容量；浏览器验证指针手势和桥接调用。它们不等同于微信具体版本的拖入预览或实际发送验收。

## 使用行为

- 入口位于硬件工具分类，`data-tool="clipboard-history"`。默认关闭监控；在工具页确认开启后，仅记录之后观察到的复制事件，不导入 Windows Win+V 历史或开启前的当前内容。
- 支持 Unicode 文字、图片、文件路径。富文本只保存纯文字；图片统一为 PNG；文件只保存路径，不读取文件正文。
- 返回首页、切换工具、隐藏到托盘后继续监控。工具页、托盘及历史悬浮窗均可暂停；开启监控同时保存下次启动恢复，暂停则取消恢复，不再有第二个恢复开关。完全退出会停止原生监听与存储线程。
- 按日期分组、倒序显示观察时间；详情包含毫秒、采集时的 UTC 偏移、来源进程、类型和大小。来源取剪贴板 owner，无法获取时显示未知，不猜测前台应用。
- 相同内容仅存储一份加密实体，每次观察到的新复制仍保留独立时间线事件。来源应用与文字/路径可搜索；支持类型、日期、收藏过滤，50 条分页、批量删除和清空。
- 新记录到达时保留当前阅读位置与预览，显示新记录入口。支持完整文字、图片缩放、图片另存、文件路径列表及再次复制；再次复制文件按 copy 处理，绝不恢复 cut 行为。
- 查看文件记录不访问原路径；用户点击复制文件时才检查可用性，文件缺失时可改为复制路径。删除历史不会删除原文件或清空系统当前剪贴板。
- 图片详情提供“打开置顶”，复用截图独立查看器，默认置顶并支持缩放、拖动、保存与复制。读取本地加密历史图片，不启动截图、不自动再次复制、不加入截图历史；最多 8 个查看窗口、编码总量 64 MiB。非图片不显示入口，执行中禁用图片操作，失败恢复按钮并提示原因。

## 模块与所有权

V3.2：悬浮窗也读取本服务，按照图片、文字、文件过滤并显示毫秒和采集时区。图片列表复用摘要缩略图，点击后按 ID 打开原图查看器；文字及文件详情可复制。主窗口和悬浮窗有独立查询 revision，共享保留时间、容量及监控状态。

悬浮窗默认展示全局最新 20 条，空搜索时在这 20 条内分类；搜索查询完整保留历史，返回最新 20 条匹配项，可按正文、来源、路径或备注匹配。`Query.limit` 可选、默认 50、范围 1–50；原工具页分页兼容。悬浮窗单条删除经确认，原生只接受一个正数 ID，不删除原文件。底部横条表示当前列表滚动位置，不代表存储容量。

## 备注与独立常用语（2026-10-17）

- `clipboard_history/library.rs` 持有备注、常用语、查询、去重和容量；`Store` 延用 AES-GCM/DPAPI，schema 由 1 增量到 2，新增 `event_notes` 和 `phrases` 表，不重建旧库。备注按事件 ID 加密，最大 4 KiB，随对应历史删除；相同内容的两次复制有独立备注。备注计入历史容量，超限写入回滚，不自动删除记录来腾空间。
- 常用语正文、名称、备注和时间均加密；重复检测使用带密钥的正文 HMAC，不能从指纹直接读出内容。每条密文绑定自身 ID。常用语独立于历史过期、清空和容量淘汰；最多 2000 条、合计 16 MiB，正文 64 KiB、名称 256 字节、备注 4 KiB。达到边界拒绝新增或修改，不自动淘汰。
- 常用语按 ID 倒序、50 条增量读取，列表只返回前 240 字摘要，详情和复制读取全文。只允许从文字历史导入；导入生成独立记录，原历史删除不影响它。相同正文（忽略首尾空白和 CRLF 差异）拒绝重复，不覆盖旧记录。
- `phraseCopy` 复用 `windows::write(..., false, false)`，保留历史再次复制标记，不重复收录；不会写文件或访问文件路径。仅主窗口和历史悬浮窗可读写，菜单/捕获/图片查看器均无权限。
- `clipboard_history` 增加 `entry`、`note`、`phraseList/phraseDetail/phraseSave/phraseFromHistory/phraseDelete/phraseCopy` action，命令名称保持不变。`clipboard-history-changed` 兼容数字 revision；备注携带 `{revision,recordId}`、常用语变化携带 `{revision,library:true}`，不广播正文。主历史页按 ID 拉取摘要同步备注。常用语模式的普通复制事件仅刷新监控状态，避免反复解密列表。
- 密钥恢复样本包含常用语表，即使清空全部历史、仅剩常用语也先校验密文再恢复密钥；不能把“历史为空”误认为数据库没有需要保护的内容。数据保持本地，不新增网络请求。

密钥文件丢失时，V3.2 从数据库 `key_backup` 中读取当前 Windows 账户 DPAPI 保护的副本，验证现有密文后恢复文件；主文件损坏时保留损坏副本。没有原密钥及可用备份的 V3.1 库不会自动替换或清空。仅主窗口出现对应错误时提供 `clipboardRestart` 确认入口，将整个旧目录保留为同级 `clipboard-history-preserved-<timestamp>` 后建立新库，默认暂停监控；取消不改变原记录。原始文件读取、DPAPI 解锁、密钥不匹配和存储错误分别映射双语提示。

| 边界 | 文件 | 职责 |
| --- | --- | --- |
| 懒加载工具 | `src/features/clipboard-history/` | 模板、交互、纯格式化、状态与样式 |
| 共用 UI | `shared/tool-page-shell.js`、`app/modal-runtime.js`、`tool-custom-select.js` | 导航、窗口动作、焦点与弹层、自定义下拉菜单 |
| 硬件主题 | `styles/components/hardware-workbench.css`、`hardware-workbench-light.css` | 原硬件主题移至共享层，旧 feature 路径保留 import 兼容入口 |
| 平台适配 | `src/platform/clipboard-runtime.js` | invoke/listen、浏览器能力边界、敏感文字复制 |
| 应用级服务 | `src-tauri/src/clipboard_history/mod.rs` | 服务状态、托盘、命令、退出与线程生命周期 |
| Windows 监听 | `clipboard_history/windows.rs` | message-only window、格式监听、读取边界、敏感标记、重写剪贴板 |
| 持久化 | `clipboard_history/store.rs` | SQLite、加密、去重、时间线、分页、搜索、容量和过期清理 |
| Windows 密钥保护 | `platform/protected_data.rs` | 当前 Windows 用户的 DPAPI 包装 |

前端 `close/dispose` 释放自己的事件、下拉菜单、弹层、DOM 内容和异步会话，不停止应用持有的监控。原生层通过 generation 取消过期采集、query revision 取消过期搜索；关闭软件的 `ExitRequested` 将线程收尾放到后台，完成后才允许退出，避免主线程等待正在更新托盘的工作线程。

## 新增契约

- 首页/lazy ID：`clipboard-history`；overlay：`clipboardHistoryOverlay`；initializer：`initClipboardHistoryTool`。
- UI DOM 统一采用 `clipboard*` 前缀，核心包括 `clipboardToggle`、`clipboardList`、`clipboardPreview`、`clipboardHistoryDialog`；静态模板通过契约测试检查 ID 唯一性。
- Tauri `clipboard_history({ request })`，主窗口支持 `status/start/stop/settings/list/detail/favorite/delete/clear/copy/pin/restart`；历史窗口 `screenshot-history` 仅支持 `status/start/stop/list/detail/copy/pin`，其他辅助窗口仍被拒绝。两窗口查询 revision 独立，避免互相取消。
- `settings` 带完整 settings；`list` 带 query；detail/favorite/copy/pin 带 id；delete 带 ids；clear 带 includeFavorites；copy 可带 paths，仅复制路径文字。`pin` 只接受整数记录 ID，不接受外部路径或图像载荷；原生层读取并校验历史图片后调用查看器。生成式模板新增内部 DOM `clipboardOpenPinned`，不新增命令、事件或存储 key。
- 事件 `clipboard-history-changed` 仅包含 revision，发送给主窗口与历史悬浮窗，不广播剪贴板正文。页面按需重新查询。
- Tauri `copy_sensitive_text({ text })` 供密码生成器使用；写入 Windows 隐私格式标记。原有普通复制契约保持不变。
- 中英文键：`home.clipboardHistory.*`。不新增 CLI/MCP 剪贴板读取入口。

## 存储与限制

数据位于 Tauri `app_local_data_dir()/clipboard-history/`：`history.sqlite`、`history-key.dpapi`、`resume.json`。正文、摘要、缩略图、来源与设置使用 AES-256-GCM 加密，随机密钥由当前 Windows 用户 DPAPI 保护；内容去重采用带密钥 HMAC。事件 ID、时间、类型、收藏标志为明文元数据。损坏或无法解密的密钥不会被静默替换。

默认保留 7 天、2000 条、256 MB 内容容量；可设置 1–365 天、100–10000 条、32–2048 MB。容量统计包含加密内容、摘要与事件估算，不是数据库磁盘文件硬上限，索引、空闲页与 SQLite 文件开销另计。普通记录按旧到新清理，收藏不自动删除；收藏占满上限时暂停记录。启动监控、写入、保存设置及查询状态时执行有界频率的过期清理。

单条文字上限 2 MB；图片 20 MB、3200 万像素；文件路径最多 1000 个，合计 2 MB。监听线程只做有界读取，图片解码、加密和写库由后台存储线程处理，队列有界以控制突发复制的内存。

## 隐私和能力边界

默认无上传、无 AI 请求。排除应用按进程文件名匹配，尊重 `ExcludeClipboardContentFromMonitorProcessing`、`CanIncludeInClipboardHistory=0`、`Clipboard Viewer Ignore` 等标记；应用内部从历史复制使用自身标记防止循环记账。密码生成器同时设置不进系统历史和不同步云剪贴板的格式标记。

新截图与 OCR 文字复制不同于历史回放：复用 `write_impl` 的格式和大小边界，但通过 `write_captured_content` 不写自身排除标记，因此监控开启且允许相应类型时正常收录。V3.2 的主动截图确认另有窄入口：仅在悬浮历史开启且全局监控关闭时，把用户刚确认的图片写入同一库，仍检查图片开关、应用排除和容量；不读取或导入外部当前剪贴板。监控开启时不重复插入。历史回放仍排除，敏感复制仍不入库。

无法承诺识别所有密码：第三方应用可能不标记敏感内容，owner 也可能不可用；开启说明明确提示暂停或排除应用。加密保护静态文件，不能隔离同一登录用户下的恶意程序，也不能承诺删除历史等于磁盘安全擦除。

系统格式通知不是无损消息队列。极快覆盖、延迟渲染、剪贴板占用、超限或不支持格式可能无法收录；界面显示跳过/失败计数，不伪造记录或时间。浏览器预览不读取系统剪贴板，只显示桌面能力提示。

## 验证

2026-10-13 图片置顶增量：核心/请求契约覆盖精确 ID 载荷、拒绝额外路径/图像字段及错误映射；Edge 双主题/中英文回归覆盖图片入口、文字/文件隐藏入口、窗口容量错误的可见提示和重试恢复。完整 Rust 206 passed/7 ignored、发布回归 100 项脚本（含安全 1329 项、CLI/MCP）、架构/构建/集成检查通过。窗口使用合成桥接，真实桌面置顶交互待新版安装包验证；本轮尚未重新打包。

- `npm run test:clipboard-history`：设置/时间、适配器、敏感复制、中英文、生命周期和入口契约。
- `cargo test --manifest-path src-tauri/Cargo.toml clipboard_history --lib`：加密去重、事件、持久化、搜索分页、收藏、过期、篡改、容量回滚、文件路径和图片边界。
- 原生监听测试在独立子进程的私有 Windows window station/desktop 中执行，验证开启前不补录、重复复制、隐私标记、图片、暂停；不读取或替换用户剪贴板。
- `scripts/test-clipboard-history-browser.mjs`：真实共享样式配合注入的合成原生数据，覆盖深浅主题、中英文、三种视口、预览、搜索、收藏、弹层、后台继续、关闭重开与过期异步结果。
- 发布检查包含安全、架构、帮助中心与 CLI/MCP 回归；完整 Rust 测试与生产前端构建单独运行。

浏览器注入测试不能替代安装包中的多应用复制、Windows 10/11、远程桌面或长时间后台测试。测试数据均为合成内容；安装包验证由后续用户打包测试完成。

2026-09-20 本地结果：92 项发布脚本（包含安全、架构、CLI/MCP 与构建）通过；Rust 全量 161 passed、3 ignored，其中剪贴板 10 项全部通过。Edge 深浅主题截图与交互回归通过；生产预览的真实首页入口、桌面限制提示、返回与重复打开通过。保留既知的大 chunk、crypto externalization、Windows linker 信息提示，没有新增同类构建警告。未打包、提交或发布。
