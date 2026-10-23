# 快速截图维护说明

## 桌面提示与拖放（2026-10-17）

当前悬浮历史按持久排序展示 20 条，常用语仅填写标题和内容；排序、完整历史保留和原生拖放的当前契约见 `CLIPBOARD_HISTORY.zh-CN.md` 首节，下方早期“最新 20 条”描述为初始默认顺序。

`quick_screenshot/feedback.rs` 持有独立 `screenshot-toast` WebView：白色胶囊、小勾号、阴影，固定 Windows 主显示器工作区底部中央；不随历史窗口移动，不激活、不参与任务栏、鼠标穿透。`feedback-window.js` 只显示白名单状态文案，无历史正文和操作按钮。成功复制及转存走此窗口，失败仍由原交互提供错误恢复；创建提示失败回落到共享 Toast，不把已成功复制误报为失败。

2026-10-18 修正提示窗透明背景：共享 `window-surface.css` 的 body 背景带 `!important`，提示窗必须设置 `--tk-window-bg:transparent`，仅写普通 `background:transparent` 会被覆盖。回归同时检查 html/body/root 的计算背景与透明 PNG 的外围 alpha；白色胶囊和半透明阴影保留，不用图片查看器的黑色底判断是否透明。

沿用 `quick_screenshot` 命令增加历史窗 `feedback {kind}` 和提示窗 `boot` / `feedback-ready {revision}`，新增事件 `desktop-feedback` 仅携带类型、语言及 revision。提示窗无剪贴板权限，独立 `desktop-feedback` capability 仅允许订阅/取消事件，生产和 QA 配置均显式保留。连续提示复用一个窗口和定时器，主线程核对 revision 后显示/隐藏；2.2 秒后收起。截图开始前隐藏提示且不加入恢复窗口列表。隐藏复用已修补的真实 HWND 路径。新增 DOM：`shotDesktopToast`、`shotDesktopToastText`；卡片新增 `.shot-history-open` 和 `data-history-reorder`。

`history-drag.js` 使用同一历史服务的 ID 动作，窗口头部拖动仍归原窗口控制器，不与列表排序混用。切换按钮图标缩为 15px，线宽 1.8，点击范围不缩小。状态和具体验证证据见 V3.2 历史记录改进报告。

## V3.2 当前历史实现（2026-10-17）

以下早期 V3.1 章节中的独立历史缓存已由统一剪贴板历史取代。`history-window.js` 默认查询最新 20 条、空搜索时本地分类；搜索走原生完整历史查询，返回最新 20 条匹配项。顶部输入框实时搜索（180ms 合并输入，中文组词完成后查询），移除搜索提交按钮及聚焦动画；自绘清空按钮在白天为黑色，隐藏 WebView 原生叉号。新 DOM `shotHistorySearchClear`、前端 action `history-search-clear` 不改变原生接口。输入时使旧查询失效，切换模式保留各自搜索和缓存归属。记录开关位于底部进度条上方。图片卡片 228px（有备注 252px），列表只加载缩略图，新图片摘要上限 320×200，旧摘要仍可显示；文字内容区居中、最多两行省略，详情全文。底部 3px 横条无溢出时隐藏。

右上角按钮按切换、菜单、关闭排列，切换独立常用语模式；创建、编辑、搜索、单击复制和确认删除均通过剪贴板服务，纯文字历史可导入。`history-editor.js` 持有备注/常用语表单与提交状态，保存失败保留草稿，关闭隔离迟到结果；复用已挂载的共享弹框。`history-motion.js` 持有逐字立体翻转、分类滑块与可见卡片入场；主辅助入口注入既有 `page-transition-runtime`，以 250ms 覆盖、350ms 揭开整窗，白天白色、深色黑色，不改变原生窗口尺寸。关闭/销毁取消转场与卡片动画，减少动画时直接切换；标题悬停离开恢复原文，点击后显示新模式名。两种模式分别保存搜索词和滚动位置，常用语按 50 条滚动加载，不等待慢查询才结束过渡。存储边界详见 `CLIPBOARD_HISTORY.zh-CN.md`。

`history_menu.rs` 管理独立透明菜单窗口 `screenshot-history-menu`；前端 `history-menu-window.js` 复用 `shared/context-menu.js` 和双主题样式，自绘圆角菜单，避免改变 96px 悬浮球窗口尺寸。全局菜单包含展开/收起、打开剪贴板历史、记录勾选状态、隐藏到下次重启 ToolKnit、关闭悬浮窗；记录菜单提供查看/置顶、复制和确认删除。删除仅允许一个正数 ID，经共享弹框确认同步主库，不删除原文件。菜单无剪贴板读取权限，只接收 ID、类型和状态；每次打开绑定 token，旧关闭/选择动作无效，失焦、Escape、截图开始或历史窗关闭均退出。

2026-10-18 首次打开优化：历史窗口初始化完成后延迟 100ms 调用 `prepare-history-menu`，仅允许 `HISTORY_LABEL`，与正式打开共用 `menu_transition` 锁及 `ensure_window`。后台只创建隐藏、不聚焦的 WebView，加载模块及菜单字体，不建立可选择会话；失败不影响正式打开的按需创建。`menu-boot` 无会话时返回 `menu:null`，前端保持空菜单且不发送 `menu-ready`。后续打开通过控制器 `update` 更新，token 去重，避免重复创建监听；共享菜单 render revision 隔离旧异步操作的 finally，旧选择失败也不能污染新会话。没有新增命令名称、事件、存储或权限。

菜单新增打开主程序、备注、文字转存常用语和常用语编辑。标题按钮使用 `toggle:true`；鼠标在 pointerdown 阶段提交，键盘仍通过 click。Windows blur 若发生在同一触发按钮上，隐藏菜单并短暂保留 token，让随后的 toggle 收起，不重新弹出；超时只关闭对应 token。`anchor` 包含父窗口内的 x/y/width/height，记录动作增加 kind，区分历史与常用语 ID。菜单尺寸按动作数量调整，始终限制在当前工作区。主程序和剪贴板历史入口复用托盘的 `show_main_window`，先恢复最小化、显示并聚焦；`navigate target=main` 保留当前页面，不发页面切换事件。

`history_actions.rs` 持有会话隐藏与边界回退。会话隐藏仅保存在进程状态；关闭会更新持久化开关，设置页关闭立即隐藏。截图恢复检查当前状态，Destroyed 不改设置。拖动结束后按最近显示器工作区夹取位置，约 224ms 仅移动窗口；缩小屏幕必要时一次调整窗口尺寸，减少动画模式直接定位。

2026-10-17 隐藏链修复：`show_without_activation` 用 Win32 显示，不能依赖 Tao 缓存的 VISIBLE 标志判断 `.hide()` 是否实际生效。新增 `window_visibility.rs`：在主线程先同步框架隐藏，再用 `SWP_HIDEWINDOW | SWP_NOACTIVATE` 隐藏实际 HWND，核对 `IsWindowVisible` 后才报告成功；该路径覆盖菜单隐藏/关闭、工具页关闭及截图前的窗口隐藏。失败恢复会话标记与持久偏好；关闭菜单的异步焦点恢复重新检查 allowed 和实际可见性，hide/close 不回送焦点；隐藏后的迟到 expand 会再次确认隐藏并返回 expired，不恢复显示。前端忽略预期 expired，真实隐藏失败显示专用错误；操作错误与读取错误分开，后台读取成功不抹去操作失败，反馈位置避开底部开关。

原生回归使用当前锁定的 Tao 0.37.1（仅新增直接 dev-dependency）在独立子进程创建屏幕外窗口，真实复现“Win32 显示后 Tao hide 被跳过”，并验证 96×96 和 376×760 两种形态各连续三轮正确隐藏、重复隐藏和无效 HWND 错误。测试不启动用户应用、不访问历史/剪贴板，子进程超时有界。浏览器 mock 只验证菜单分发与反馈，不能替代该原生证据。

开启悬浮历史不自动开启全局监控。监控已开启时，截图复制由原有监听与过滤链路记录；监控关闭时，用户主动确认的本程序截图可写入同一历史库，保留图片开关与容量约束。图片记录上限 20 MiB，截图处理上限 32 MiB；置顶查看器继续最多 8 个 / 合计 64 MiB。

`screenshot-history-changed` 不再作为列表数据来源；`clipboard-history-changed` 通知两个窗口重新查询。`screenshot-history-action` 兼容字符串动作及 `{action,id}`；`screenshot-menu-opened` 通知菜单重新读取上下文。`quick_screenshot` 新增 `history-menu/close-history/dismiss-history-menu` 与菜单专用 `menu-boot/menu-ready/menu-select/menu-dismiss` action；菜单命令校验窗口身份和 token。`history-menu` 可选 `anchor:{x,y}` 为父窗口逻辑坐标，标题按钮按自身位置展开，右键按光标展开，两者均限制在工作区。`hide-history` 改为会话隐藏，删除无消费者的旧 `history/viewer` action。原图查看走 `clipboard_history pin`；菜单导航复用主页面 owner 关闭流程，不叠加残留设置页。

当前 V3.2 验证与测试包记录见 [历史记录改进报告](V3_2_HISTORY_IMPROVEMENT.zh-CN.md)。以下 V3.1 测试包和“未重新打包”描述保留对应轮次的历史状态，不代表当前源码已生成新包。

后续源码修复：打开文件夹前退出截图、剪贴板历史图片置顶及普通文字选框贴合尚未纳入上述测试包。核心像素/输出契约、架构/构建、发布回归 100 项脚本（含安全 1329 项与 CLI/MCP）、Rust 206 passed/7 ignored、Edge 截图 8 场景及剪贴板双主题/中英文回归通过。浏览器断言先结束 capture 再调用 `open_path`，viewer 保持可用，普通文字缩短/改字号后选框重算；原生窗口及 Explorer 仍需安装后验收。

## 入口与交互

V3.1 新增 `quick-screenshot`；V3.2 将入口移至创意分类，当前为 71 个工具、12 个分类，创意 4 项、AI 5 项，CLI/MCP 仍为 46 项。tool ID、收藏和偏好保持兼容。默认全局快捷键为 `Alt+Q`，可修改、重置或关闭；修改必须包含 Alt/Ctrl/Super 修饰键，冲突时反馈注册失败。关闭工具页面不等于关闭全局快捷键，退出应用后快捷键释放。

截图时隐藏 ToolKnit 窗口，捕获桌面后打开独立编辑窗口。鼠标捕捉窗口显示绿色边框，也可拖动选择区域；放大镜显示像素位置、颜色和选区尺寸。工具条按内容收紧，按显示器可用宽度换行并保留 8px 边距。矩形、圆形、箭头绘制及文字添加后自动进入选中调整状态，支持移动及八方向缩放；双击文字编辑，删除键删除可编辑标注，方向键微调，Shift 配合方向键调整 10 像素。画笔和马赛克沿指针路径连续涂抹，绘制后固定、不参与图层选择与移动缩放，但仍可撤销/重做。马赛克使用圆头路径遮罩，未涂抹区域保留原图，像素网格按原图坐标对齐。

原图对比必须按住查看、松开恢复，不保存为编辑状态；鼠标移出按钮后松开、指针取消、按钮或窗口失焦、页面隐藏均恢复编辑显示。按钮获得焦点时可按住 Space/Enter 查看，释放后恢复，Enter 不会误确认截图。

`Ctrl+Z` 撤销，`Ctrl+Y` 或 `Ctrl+Shift+Z` 重做，`Ctrl+S` 保存，`Ctrl+C` 复制，Enter 确认。Escape 优先退出当前操作、取消选中或选区，最后取消截图；处理中取消不会让迟到结果写回新会话。确认复制结果并恢复截图前窗口的可见/最小化状态，不激活主应用、不改变它的前后层级，可选将结果加入历史；复制与保存不等于结束本次截图。隐藏在托盘的主应用不主动显示。仅明确置顶查看或点击查看器导航时打开并激活对应目标。

PNG/JPG 导出复用输出目录运行时，写入 Screenshots 子目录，安全发布唯一文件名。成功弹框保留实际结果路径；截图窗口点击“打开文件夹”先关闭弹框、结束本次截图，再复用资源管理器选中文件路径，避免截图遮罩挡住资源管理器。独立查看窗口的同一动作保留查看窗口。独立查看窗口使用通用导航，支持缩放、适应窗口、原尺寸、拖拽、复制、保存和置顶开关，默认置顶。

普通文字标注以 Canvas 实际字形边界和 2px 内边距计算选框，添加、编辑、修改字号和缩放后重新收紧；中英文、多行、空行及下伸字符使用同一绘制和命中尺寸。译文覆盖标注保留原文遮盖范围，不套用普通文字收紧。默认标注颜色仍为红色。

剪贴板历史图片可通过“打开置顶”复用同一查看器：原生剪贴板服务按记录 ID 解密读取 PNG，校验图片尺寸与编码后创建查看窗口。继续使用最多 8 个窗口/编码总量 64 MiB 的限制；不启动截图、不复制图片、不追加截图历史。不存在或非图片记录、窗口容量超限等失败返回剪贴板工具显示提示。

查看器名称与版本仅显示在左侧标签，右侧不重复显示标题；共享导航在未提供 title 时省略标题节点，其余工具既有标题保持。历史窗改为点击展开，不消费悬停来调整窗口。展开时先在 Windows 主线程用一次 SetWindowPos 提交位置与尺寸，再通过内部面板的圆形裁切、轻微缩放和透明度完成 380ms 展开；前四张卡片错开进入。收起动画 260ms，结束后窗口一次恢复到圆形锚点；相同操作与动画期间重复点击去重，支持减少动态效果。

悬浮历史默认关闭，可在工具页开启。显示 64px 的圆形真实 Logo 和阴影，窗口为 96×96 逻辑像素以留出阴影空间；拖动超过 6px 调用既有原生 startDragging，拖动后的点击不会误展开。点击 Logo 打开最大 376×760 逻辑像素的面板，通常完整容纳四张 156px 高的卡片，更多记录滚动查看；小屏自动约束到显示器工作区，支持负坐标与不同 DPI。展开后可拖动顶部 Logo/标题区域，关闭按钮和图片点击独立工作；原生记录面板位移，点击 × 或 Escape 收起后的小圆窗跟随新位置，不关闭工具页的历史偏好。再次截图只更新列表，不改变窗口的展开状态或位置。

缩略图点击打开独立查看窗口；最多保留 10 张，新结果在前，旧结果超量移除，编码总量最多 64 MiB。图片完成解码后才替换列表，读取或解码失败保留旧图片和滚动位置并显示重试；初始化失败也能从 Logo 重试。历史只在本次运行内保留，不持久保存截图文件。

## 隐私与平台边界

捕获、标注、复制、保存与 Windows OCR 在本机完成，不依赖 AI Key。本地 OCR 优先使用界面语言对应的已安装语言包，不可用时回退 Windows 用户语言；识别失败不能静默转交 AI。浏览器预览不能执行系统截图、注册全局快捷键或操作真实辅助窗口。

AI 提取/翻译仅在主动点击 AI 按钮后发送内容，复用既有 AI 配置、密钥存储、请求与有界响应运行时。AI 提取发送所选区域图像，仍要求模型支持图像输入，但不再需要手动确认；辅助窗口仅同步服务元数据、主题和语言，不同步密钥。AI 提取使用忠实转录提示、高细节 PNG（最长边最多 4096px，编码超限回退 JPEG）和 temperature=0，不要求模型总结、补全或改写。

截图翻译只支持中文与英文，目标使用自定义下拉，保存到原生应用数据目录，不依赖不同 WebView 的 localStorage。设置中的本地翻译管理提供安装、取消、修复和卸载。翻译前检查依赖，未安装时仅提示前往设置，不识别、调用 AI 或自动下载。配置了 URL、模型与已存密钥时，本地 OCR 定位并合并相邻段落，AI 对照所需图像与编号框校正，再将文字交给本地引擎；无密钥时直接本地 OCR 与翻译。不支持图像、认证、网络、超时或非法结果均显示原因，只有用户确认后才使用原 OCR，不静默回退。

`translation.js` 仅负责图像校正、段落分批与安全布局；每批最多 12 个文字块/约 2200 字符，输出预算 4096–16384 tokens。截断或结构错误先增加额度再拆失败批次，AI 识别总计最多 45 秒/24 次请求。共享 AI 请求 temperature 默认保持 0.7，截图提取/识别使用 0。本地翻译上限为 512 块、每块 8000 字节、合计 64000 字节、响应 256 KiB、请求 30 秒。取消与服务变更使旧结果失效；界面区分 OCR、图像校正、重试、本地翻译与排版，不用假进度承诺外部服务速度。

本地运行时采用 MTranServer 4.0.33（Apache-2.0）与固定 Mozilla 中英文双向模型记录，首次下载 201,647,315 字节（约 192 MiB），安装后约 225 MiB。引擎来自[官方发布](https://github.com/xxnuo/MTranServer/releases/tag/v4.0.33)，模型来自 [Mozilla 翻译模型记录](https://firefox.settings.services.mozilla.com/v1/buckets/main-preview/collections/translations-models-v2/records)，7 个记录及原始/解压 SHA-256 保存在 `records.json`。模型来源与授权按上游记录维护，不把模型二进制提交或打入主安装包。下载到 staging，核验压缩/解压大小与哈希，双向试译成功后发布；失败保留旧版本、支持重试。安装/卸载互斥，路径拒绝 symlink/reparse，下载可以取消。

引擎仅监听随机本地回环端口，使用随机令牌鉴权；禁用在线模型下载、UI、更新与请求日志，客户端只访问本地端点。进程由应用持有，空闲约 120 秒退出，应用退出释放；Windows Job kill-on-close 处理异常退出。目标语言持久保存，截图文字只在任务内存传递；仅 AI 识别阶段将必要图像与识别文字发往用户配置服务。

编辑会话缓存一份未变化图像与语言的 OCR，以及同图像/语言/模型配置的成功校正结果，重复翻译替换旧译文而不识别旧译文；用户标注保留。译文只在选区内向右/下方空白扩展，避开其他 OCR 文字、既有标注与已放置译文，维持可读字号。放不下或超过标注容量时保留原图对应区域，显示部分覆盖数量及完整译文，用户可复制；覆盖可撤销。缓存随会话销毁释放。该策略不保证复杂背景上的精确文字擦除，用户应核对识别与翻译结果。

编辑文字弹框提供圆形图标复制按钮，读取当前 textarea 内容，复用截图复制路径并保持弹框打开；输入内快捷键不触发截图确认。

接口可填写网站根地址或 `/v1`，由共享 `normalizeAiProviderConfig` 在发请求时补全 `/v1/chat/completions`；已经填写的完整接口（包括 `/chat/completions` 与自定义路径）不改写，不修改已保存配置。缺密钥/配置、HTTP 401/403/404/429/5xx、网络、超时、空响应、截断或非法响应均提供可见双语提示。截图与查看器复用共享 Toast，`screenshot.html` 必须保留 `toastContainer` 挂载点；深色覆盖仅作用于截图辅助窗口。取消与模型切换让任务 revision 失效，避免迟到结果覆盖当前会话。

原生 OCR 对最长边不超过 1600px 的小图受控放大两倍，超过引擎尺寸限制的图像缩小到上限；统一灰度，深色像素占多数时反转背景。返回行/词坐标按宽高独立比例映射回原图，不改变选区坐标。`core.js` 根据词框重建文字，去除中文逐字空格，保留英文/代码空格；按纵向分行、横向排列，较大间隔保留分列与段落，无有效坐标时规范化原识别文本。预处理不能恢复原图不存在的细节，该整理不猜测修正字符，也不保证复杂多栏阅读顺序。

截图使用 Windows GDI 与可见窗口枚举。保护内容、特殊 GPU/视频画面、远程桌面及不同 DPI 多屏仍需实际设备验证；不是所有窗口均保证可捕获。单图上限为 3200 万像素、编码数据 32 MiB；完整虚拟桌面同样受此限制。历史编码总量最多 64 MiB；查看窗口最多 8 个，查看图像编码总量最多 64 MiB。OCR、保存、复制一旦进入原生执行不能中途撤回，前端取消仅隔离迟到结果并恢复交互。

## 模块与公开契约

| 边界 | 责任 |
| --- | --- |
| `src/features/quick-screenshot/` | 懒加载工具页、纯几何/渲染、编辑器、查看器和悬浮历史 |
| `src/shared/snapshot-history.js` | 可复用有容量边界的撤销历史；PDF 编辑器兼容复用 |
| `src/platform/screenshot-runtime.js` | 既有 Tauri adapter 的截图调用与事件适配 |
| `src/app/screenshot-context-runtime.js` | 主窗口到辅助窗口的主题、语言、模型元数据同步 |
| `src-tauri/src/native_runtime/quick_screenshot/` | 原生窗口、快捷键、会话、捕获、OCR、输出与容量限制 |
| `src/app/local-translation-runtime.js` | 设置安装管理、状态事件、共享弹层与生命周期 |
| `src/platform/local-translation-runtime.js` | 本地翻译 command/event adapter |
| `src-tauri/src/native_runtime/local_translation/` | 固定模型安装/校验、应用持有引擎、有界批量翻译与取消 |
| `screenshot.html` | 辅助 WebView 入口，role 为 capture/viewer/history |

新增原生命令 `quick_screenshot` 通过 `request.action` 分发，按照调用窗口角色验证允许操作，辅助窗口能力仅授予必要窗口/事件权限，不授予文件、Shell 或 HTTP 插件权限。新增事件为 `screenshot-opened`、`screenshot-ended`、`screenshot-context-changed`、`screenshot-history-changed`、`screenshot-preferences-changed`、`screenshot-error`、`screenshot-navigate`。截图偏好保存在应用数据目录 `quick-screenshot.json`；旧视觉声明键 `toolknit.screenshot.vision-provider.v1` 不再读取，不删除用户既有存储。OCR action 可选 `language: zh/en`，返回增加 `words` 坐标，未提供参数的调用兼容。内部 DOM 和中英文 key 由专项/集成测试核对，无 CLI/MCP 参数变更。

`local_translation` 通过 `request.action` 提供 `status/target/install/cancel-install/remove/translate/cancel`。主窗口才能安装或卸载；翻译仅允许有有效截图 session 的 capture 窗口，history/viewer 禁止。新增 `local-translation-progress`（主窗口安装进度）与 `local-translation-changed`（状态）；目标语言保存在 `local-translation/target-language`，只接受 `zh-Hans/en`。并发任务、requestId 与取消均有界，结束重新核对 session；不新增 CLI/MCP。

安装 request 可选 `source=auto/official/accelerated`，省略保持自动；拒绝任意 URL。自动优先固定 GitHub Release，网络或校验失败再用既有 `gh-proxy.com` 第三方加速；指定来源只尝试该引擎源。模型始终由固定 Mozilla CDN 清单提供，最多一次重试。响应及流读取采用 20 秒停滞上限，单文件总时限仍为 600 秒；取消/存储错误不换源。所有来源保持固定大小和 SHA-256 验证，完整缓存复用，部分文件重下，不宣称断点续传。进度新增 `source=official/accelerated/mozilla`，完成阶段为空；UI 复用依赖 source row，内部 DOM 新增 `localTranslationSourceOptions/SourceHint`，不新增偏好 key。

截图确认/复制、查看器复制和提取文字复制使用 `clipboard_history::windows::write_captured_content`，复用 PNG/DIBV5/Unicode 与大小校验，但不写历史回放内部排除标记；收录必须经真实监听、设置过滤和后台存储，不直接插入历史。历史再次复制继续使用 `write` 并写入内部排除标记，敏感复制保持隐私格式。2026-10-13 隔离 Windows station/desktop 专项通过生产 screenshot wrappers 验证图像像素、透明度、文字、类型禁用、历史回放排除与停机；不触碰用户剪贴板。

圆形悬浮窗复用既有 `expand` action，返回逻辑坐标 `origin` 与 `width/height` 供内部动画定位；没有新增原生命令、事件或偏好。内部 DOM 增加 `shotHistoryBubble`、`shotHistoryCount`、`shotHistoryPanel`，按钮 action 为 `expand-history`、`collapse-history`，中英文 `collapseHistory` 取代旧 `closeHistory`。控制器拥有动画、拖动和监听的生命周期，关闭时取消动画并隔离迟到更新。

主窗口与辅助窗口各自持有 lifecycle；会话通过 revision 隔离，关闭/重开释放监听、RAF、观察器、图片与画布。原生取消、初始化失败和窗口销毁均恢复截图前窗口状态。窗口默认关闭 DevTools。

`screenshot-opened` 和 `screenshot-ended` 仅由 capture 角色订阅，history/viewer 不消费截图会话的结束事件。Tauri 前端事件监听默认目标为 Any，不能仅因原生从某个窗口 emit 就假设其他窗口收不到；历史列表由 `screenshot-history-changed` 更新，各角色通过自己的生命周期释放资源。

## 验证证据

2026-10-13：截图核心/契约、共享 AI、架构、构建与完整发布回归 100 项脚本通过；完整 Rust 202 passed、7 ignored。Edge 截图 8 场景覆盖双主题/DPR/窄屏、依赖先行门禁、无 Key 不调用 AI、显式识别失败回退、超时/取消/迟到结果、实际下拉选项与持久化、实时复制、缓存、布局与撤销。安装管理 4 场景覆盖双主题 740×900/480、安装进度、取消、校验失败、修复、卸载、语言、焦点、Escape、关闭重开与销毁；入口为 `node scripts/test-local-translation-browser.mjs`。

真实下载与本地双向试译通过；冷启动英译中 2 句约 4.39 秒，中译英 1 句约 0.97 秒，热启动英译中 20 段约 1.24 秒；State Drop 后确认回环端点关闭。真实测试入口：`cargo test --manifest-path src-tauri/Cargo.toml translation_real_install_and_bidirectional_smoke -- --ignored --nocapture --test-threads=1`，会下载固定依赖到应用数据目录，模型不进入仓库。上述为本机合成样本，不保证任意截图 15 秒；有 AI 时仍受识别服务延迟影响。本轮未读取用户密钥或真实调用模型，安装后截图交互与翻译质量仍需验收。

Windows 原生 OCR 四组临时合成样本（白底、深色、小字、大尺寸）此前单独通过，坐标映射检查通过，约 0.9–2.5 秒。设置 `TOOLKNIT_SCREENSHOT_OCR_MATRIX` 为合成样本目录后运行 `cargo test --manifest-path src-tauri/Cargo.toml --lib screenshot_native_ocr_matrix -- --ignored --nocapture --test-threads=1`；不是通用准确率基准。

2026-10-12：专项核心/像素/契约测试、架构和前端构建通过；Edge 浏览器专项通过白天/深色 1400×900 DPR1 与 740×480 DPR2 的选区、标注、撤销、OCR/AI 桥接、输出与重开，以及双主题查看器和历史悬浮窗。OCR/AI/系统窗口在浏览器专项中使用桥接夹具，不能作为原生验证。

Windows 原生 `screenshot_native_capture_smoke` 与 `screenshot_native_ocr_smoke` 实际通过，后者使用临时合成图片。运行方式：设置 `TOOLKNIT_SCREENSHOT_OCR_FIXTURE` 为合成 PNG，再运行 `cargo test --manifest-path src-tauri/Cargo.toml --lib screenshot_native_ -- --ignored --test-threads=1`。测试图片留在忽略的 tmp 目录，不保存私人截图到仓库。

圆形悬浮窗改版：完整发布回归 100 项 npm 脚本通过，包含安全、架构、CLI/MCP、构建及产物审计。Rust 串行全量 195 passed、5 ignored；上述两个 ignored 原生截图专项此前已单独通过，本轮未重复执行。布局专项验证 DPI 1/1.25/1.5/2、负坐标显示器、拖动锚点恢复及小工作区约束。Edge 专项 8 个场景通过，包含双主题/DPR 编辑器、查看器及历史窗，验证真实 Logo 加载、透明背景、四张完整卡片与滚动、连续截图、事件隔离、重复点击、Escape、拖动不误展开、减少动态效果、失败保留/重试及图像像素。原生辅助窗口在此浏览器专项中使用桥接夹具，实际 Windows 窗口动画尚待新版测试包回归。

维护复盘：新增工具时同步帮助内容、导航映射与数量契约；辅助 WebView 的主题/语言/服务元数据通过 `screenshot-context-runtime.js` 同步，密钥仍由现有安全存储按需读取。后续多窗口功能优先复用该边界，并区分浏览器桥接测试、真实原生测试与安装后回归。

历史窗修复复盘：跨窗口事件必须明确消费角色，回归需要验证一次截图结束后历史与查看器仍可使用；图片刷新失败不应清空旧结果。视觉检查必须使用最终构建产物，结合 computed style、截图与像素验证，本次发现旧 CSS 前缀被构建器保留而导致 Edge 模糊失效，已移除该冗余前缀。全高与 DPI 的纯几何测试不能替代真实 Windows 原生窗口的悬停和连续截图测试。

过渡复盘：用户反馈旧悬停窗口逐帧伸缩仍然抽搐，因此删除侧栏宽度循环与悬停几何逻辑。新方案在状态切换时一次提交原生边界，只对内部面板做动画；拖动锚点与面板边界分开保存，收起才能恢复原位置。透明辅助窗口必须同时覆盖共享 `--tk-window-bg`，不能只写 body background；Logo 直接复用现有素材并圆形裁切。CSS 与浏览器桥接只证明样式和交互契约，不能代替原生窗口手感。

测试包更新：用户授权后于 2026-10-12 15:18 重新生成包含历史窗修复的 V3.1.0 x64 F12 安装包，替换 14:13 的同名旧包。版本/QA 权限契约、前端构建、原生编译、NSIS 打包与产物审计通过，文件大小和 SHA-256 见根日志及安装包旁置校验文件；真实安装后悬浮窗交互待回归，未提交、推送或外部发布。

旧过渡测试包：2026-10-12 16:11 生成 V3.1.0 x64 F12 安装包，包含查看器标题清理及原生同步移动/缩放，大小 55,135,445 字节。该包包含旧悬停侧栏，现已由下述圆形 Logo 改版测试包替换。

圆形 Logo 测试包：用户授权后于 2026-10-12 17:22 生成 V3.1.0 x64 F12 安装包，包含可拖动圆形 Logo、点击展开四张历史、×/Escape 收起与内部动画，替换同名旧包。大小 55,173,073 字节，安装器与程序版本均为 3.1.0，SHA-256 为 `b4c1dd6dd95168e718aa70ddf7060f77efb3e226de5b3d5708e5b964030cb116`，旁置校验文件同步；版本/QA 权限/截图契约、前端构建、原生编译、NSIS 打包与产物审计通过。实际安装后的窗口动画、拖动与连续截图仍待用户回归，未提交、推送或外部发布。

完整安装后快捷键冲突、多显示器不同 DPI、真实模型响应、资源管理器定位和长时间使用仍需桌面环境回归。既有大 chunk、crypto externalization 与 Windows linker 提示不作为截图功能通过证据。

2026-10-12 后续修复：历史窗展开后复用 Logo 拖动逻辑，原生将展开窗实际位置与上次提交边界的差值累加到收起锚点；截图隐藏前保存最小化状态，正常结束与失败兜底共用不激活的恢复路径。Windows 普通窗口使用 `SetWindowPos` 的 `SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW`，原最小化窗口使用 `SW_SHOWMINNOACTIVE`，历史窗也不抢焦点。完整发布回归 100 项脚本、Rust 全量 196 passed / 5 ignored、Edge 浏览器 8 场景与格式检查通过。浏览器验证展开标题区域拖动和关闭按钮/图片点击的隔离，原生几何测试覆盖面板位移后的收起与重开；实际桌面焦点/最小化恢复尚未实测。17:22 的测试包不含本轮后续修复，尚未重新打包。

复盘：为悬浮窗同时检查收起和展开形态的拖动入口；恢复窗口时保存完整相关状态并区分显示与激活，不能把普通 `show()` 当作无副作用恢复。改动保持在历史控制器与截图原生域内，无新增公开契约。

2026-10-12 编辑器交互修复：核心像素专项、架构和前端构建通过；Edge 8 场景覆盖双主题、1400×900 DPR1、740×480 DPR2、工具条边距与控件换行、形状自动选中和直接拖动、画笔/马赛克固定、马赛克沿路径与未涂抹区域像素、撤销/重做，以及对比按钮的按住/释放/失焦/取消/键盘行为。辅助窗口、OCR/AI 仍使用桥接夹具，不代替真实 Windows 安装回归。未改动原生命令、事件、偏好或 DOM ID；新增工具条内部布局类，原图对比复用既有双语 key。未重新打包。

最新测试包：2026-10-12 18:03 经用户授权生成 V3.1.0 x64 F12 安装包，已包含上述展开窗拖动、不抢焦点恢复与编辑器交互修复，替换 17:22 的同名旧包；前文“未重新打包”仅指当轮状态。大小 55,067,174 字节，程序版本 3.1.0，SHA-256 为 `13702bc2299251b91f36bc939bd308f5b280e11bd0c7c73ec45f6f0c25a0eb5e`，旁置校验文件同步。版本/QA 权限/截图专项、安全 1320 项检查、前端构建、原生编译、NSIS 打包及产物审计通过，真实安装后交互待回归；未提交、推送或外部发布。构建日志保存在忽略的 `tmp/screenshot-test-package-build.log`。

交互复盘：绘制数据需要可撤销，不代表每一种绘制都应成为可拖动图层；选择和缩放统一排除涂抹笔迹。按住查看类动作必须覆盖释放与失焦路径，不能复用切换开关。工具条用独立两行布局约束内容宽度，避免百分比宽度参与容器固有尺寸计算。涂抹复用现有撤销历史与采样点上限，两块绘制缓冲画布归编辑会话所有，销毁时释放。

2026-10-12 AI/OCR 修复验证：AI 与截图核心专项、架构、构建、发布回归 100 项脚本（含安全 1320 项与 CLI/MCP）通过，Rust 全量串行 196 passed、5 ignored。Edge 8 场景覆盖双主题/DPR、OCR 行序、AI 成功/失败的可见 Toast、缺密钥、取消后的工具条恢复、模型切换及迟到结果隔离。AI/窗口使用原生桥接夹具，不代替真实中转站与安装包验证。本轮未打包，18:03 的测试包不含这些修复。

复盘：复用 Toast 不只要创建 manager，还需确认辅助页面的容器、样式和实际可见结果；失败路径不能仅靠命令抛错断言。模拟桥接应复制返回数据以符合 Tauri 序列化语义；绘图像素测试先关闭 Toast，避免提示挡住鼠标路径，并用有纹理的样本验证马赛克，不依赖纯色块边缘的插值差异。

AI/OCR 测试包：2026-10-12 23:05 经用户授权生成 V3.1.0 x64 F12 安装包，包含地址补全、可见错误 Toast 和 OCR 排版修复，替换 18:03 的同名旧包。大小 55,149,173 字节，程序 ProductVersion/FileVersion 均为 3.1.0，SHA-256 为 `eb33556eaa720c6bd33ebd6f9114bdb5b62e434265216fa1f4b12ba9243c03a4`，旁置校验文件同步。版本、QA 权限、AI/截图专项、安全 1320 项、前端构建、原生编译、NSIS 和产物审计通过；实际安装及真实中转站功能待用户回归。未提交、推送或正式发布，构建日志在忽略的 `tmp/screenshot-ai-test-package-build.log`。
