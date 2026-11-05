# Win顺搜索引擎复用审查

日期：2026-11-03。目的：判断 ToolKnit 能否直接复用 Win顺、未来能否收费，以及适合怎样接入。此轮为研究与隔离验证，没有将上游代码加入产品。

## 1. 结论

**可以复用。Win顺自身 MIT 代码允许复制、修改、整合、商业使用及闭源分发，不需要另行购买作者授权；必须保留版权与许可声明。**依赖和数据分别核对，不能将仓库的 MIT 标签理解成所有随包内容都只有 MIT 条件。

技术上也具备实际复用基础。本次将上游原始拼音、字符串匹配和 NTFS 解析源文件独立编译，没有 Qt、没有安装服务、没有扫描用户磁盘，29 项合成输入检查通过。该结果证明这些模块可以独立构建并完成所测行为；不证明整个搜索引擎已接入、真实全盘索引可靠或性能达到 Everything。

推荐：**以 Win顺搜索模块为主要候选，保留适用的 C++ 核心，移除 Qt 适配与无关业务，通过受限接口接到 ToolKnit Rust 后端和既有页面。**先做独立引擎验证，再决定其余模块是否迁移为 Rust。这样能够保留已有算法与测试积累。

## 2. 固定审查范围

- 上游：[LingCore/WinShun](https://github.com/LingCore/WinShun)。固定提交：[7e47148a8300bf019d969ad523ec8cbe3c7eae07](https://github.com/LingCore/WinShun/tree/7e47148a8300bf019d969ad523ec8cbe3c7eae07)。该提交顶层 CMake 声明版本 0.18.0；这是源码版本，不据此声称该版本已发布。
- 阅读范围：MIT LICENSE、README、构建依赖、NTFS/MFT/USN、名称索引、查询/拼音/排序、快照、目录监听、服务协议与实现、核心/服务/语法测试、架构记录及近期 issue 复查。
- 本项目：V3.3 / 3.3.0 开发中，Rust/Tauri + Vite。保留已有大量未提交改动；本轮只新增审查文档和被 Git 忽略的研究材料。
- 引用的源码固定在上述提交。上游报告、测试源码和本次实际执行结果分别表述。

## 3. MIT 具体允许什么

| 用户关心的问题 | 当前许可下的结论 |
| --- | --- |
| 把搜索源码直接复制进 ToolKnit | 允许，保留相关版权与完整 MIT 文本 |
| 修改功能、改界面、移植到 Rust | 允许；移植或改名不抹掉上游贡献与许可义务 |
| 将来收费或用于商业产品 | MIT 允许，无需另向作者购买商用许可 |
| 自己的应用或修改必须公开吗 | MIT 不要求公开应用源码或修改 |
| ToolKnit 必须整体改成 MIT 吗 | 不需要；自有代码按自身许可，第三方部分保留其适用条款 |
| 能否删掉作者声明、称整个引擎完全自研 | 不应这样处理；保留来源和许可，不将复用部分误标成完全原创 |
| 可以直接使用 Win顺名称、Logo、品牌吗 | MIT 源码许可不自动授予商标或背书权；我们继续使用 ToolKnit 品牌 |

上游 [LICENSE](https://github.com/LingCore/WinShun/blob/7e47148a8300bf019d969ad523ec8cbe3c7eae07/LICENSE)的版权人为 `Copyright (c) 2026 LingCore`，正文明确列出 use/copy/modify/merge/publish/distribute/sublicense/sell，并要求在副本或实质部分保留版权与许可声明。

建议将来落地时在明确的第三方目录保存 LICENSE、固定来源版本和修改说明，并进入根 NOTICE、桌面/CLI 随包声明及关于页面。源码目录和对外说明区分“上游 MIT 部分”和“ToolKnit 新增部分”。当前 PolyForm Noncommercial 或自有模块的独立许可不能替换被复用部分的 MIT 声明，也不能收回上游已授予的权利。

无需为了合法使用 MIT 代码单独请求作者批准；友好致谢或贡献修复是可选交流，不是额外授权门槛。

## 4. 依赖是否也能商用

### 4.1 Qt 是整套搬入的主要额外成本

顶层 [CMakeLists.txt](https://github.com/LingCore/WinShun/blob/7e47148a8300bf019d969ad523ec8cbe3c7eae07/CMakeLists.txt)要求 Qt 6.8 以上，使用 Core、Gui、Qml、Quick、Sql、Svg、Network、LinguistTools。`wscore` 自身构建为静态库，但链接 Qt Core/Sql；**wscore 是 STATIC 并不等于 Qt 也采用静态链接**。

Qt 本身有商业及开源许可，实际模块、版本、插件与链接方式需要分别确认。[Qt 官方 LGPL 说明](https://www.qt.io/development/open-source-lgpl-obligations)明确：满足 LGPLv3 条件时可以保持应用源码闭源，不能简单说“Qt 商用一定付费”；同样，也不能认为“主仓库 MIT，所以带上 Qt 不用履行任何义务”。

如果分发 LGPL Qt，需要对应源码的合规提供方式、版权/许可告知、用户替换或重新链接库的权利及相关调试逆向例外等。静态链接另有重新链接材料等要求，某些 Qt 模块只有 GPL/商业路径。是否购买商业许可取决于实际方案。本项目已有 Tauri 界面，因此没有必要为文件搜索引入整套 Qt GUI。

### 4.2 拼音数据许可已单独核实

[PinyinTable.cpp](https://github.com/LingCore/WinShun/blob/7e47148a8300bf019d969ad523ec8cbe3c7eae07/src/core/PinyinTable.cpp)由 [make_pinyin.py](https://github.com/LingCore/WinShun/blob/7e47148a8300bf019d969ad523ec8cbe3c7eae07/tools/make_pinyin.py)生成。生成器标明数据来自 `mozillazg/pinyin-data`；仓库保存了独立 [MIT 许可](https://github.com/LingCore/WinShun/blob/7e47148a8300bf019d969ad523ec8cbe3c7eae07/tools/data/pinyin-data-LICENSE.txt)，版权人为 `Copyright (c) 2016 mozillazg`。复用生成表也应保留数据来源与许可，不能只带 Win顺的 LICENSE。

### 4.3 不把整包依赖自动带入

仓库还包含 PDFium、miniz、图标、字体、OCR、二维码及插件等。它们各有许可和分发要求。文件名搜索不需要同时引入 PDF 正文提取、OCR、字体、截图、剪贴板、AI、WebDAV 或插件商店。复用范围越明确，依赖、安装包和维护边界越可控。

## 5. 源码里的真实搜索架构

```text
普通权限界面 / 查询编排
  ├─ 搜索核心：FileIndex → Query/NameMatcher → NameSearch → 有限结果
  ├─ 本地快照：Snapshot + 卷标识 / USN 位置 / 搜索范围
  └─ 索引维护：IndexService
       ├─ NTFS：直接 VolumeAccess 或服务管道
       │    → 批量读取 MFT → NtfsIndexer → USN 增量追踪
       └─ 其他范围：Crawler + ChangeWatcher / 远程目录扫描
```

### 5.1 为什么它能够快

- `Ntfs.cpp` 使用 Windows 原生接口与异步块读取，并解析 MFT 记录和数据运行列表；通过空闲记录位图跳过部分不需要读取的区域。
- `FileIndex` 使用紧凑条目、父子关系和名字存储；当前 `Entry` 有明确的 **17 字节 static_assert**。这只是基础条目大小，不含名字、时间、文件编号映射、缓存等全部成本。
- 文件名存储有去重，并为 SIMD 比较预留尾部空间；`TextUtil` 使用 SSE2 一次比较多个位置。新包装必须保留内存布局契约。
- `NameSearch` 把候选按 16,384 条切片，通过 worker pool 并行匹配；小结果集用每 worker 的 Top-K 再合并，避免对全部命中完整排序。不是先拿任意几十条再声称全局最相关。
- 筛选尽量先看类型、大小和时间；路径还原、深度计算等相对昂贵操作延后。索引查询无需打开每个实际文件。
- USN 更新和磁盘快照减少重启后的全量扫描。`IndexService` 检查 journal ID/有效位置；不能继续追踪时进入重新校正流程。

上游架构文档包含其 i9-14900HX/Windows 11 环境下约 400 万条快照的查询测量；本次没有重复实测，不将其毫秒数或内存数字作为 ToolKnit 的成绩。正式验收同时测冷加载、暖查询、首帧、增量更新和完整进程内存，不能只展示空闲工作集。

### 5.2 哪些可以拿，哪些需要适配

| 模块 | 已核实边界 | 建议 |
| --- | --- | --- |
| `Pinyin.*`、`PinyinTable.cpp`、`TextUtil.*` | C++ 标准库/SSE2；本次已独立编译运行 | 优先直接复用，保留代码与数据 MIT |
| `Ntfs.*` | C++ 标准库 + Win32，含记录解析、MFT 与 USN 读写接口 | 优先复用解析/读取；把查询与创建日志行为分开 |
| `WorkerPool.*` | 无直接 Qt 依赖 | 可复用；线程预算由 ToolKnit 控制 |
| `VolumeProtocol.*` | 无直接 Qt 依赖，但含 Win顺服务名称和其他能力 | 参考边界或裁出必要协议；改为 ToolKnit 独立名称与版本 |
| `ServiceLocation.*` | Win32 服务安装位置等约束 | 参考安全目录、升级卸载处理，不复用 Win顺注册信息 |
| `FileIndex.*`、`Wtf8.*` | 核心大部分是 C++，仍含 QString 与路径转换依赖 | 提取/替换 Qt 适配后复用；保留 UTF-16 非规范码元处理 |
| `NameSearch.*`、`NtfsIndexer.*`、`Crawler.*` | 自身未直接 include Qt，但通过其他头文件间接依赖 | 必须检查依赖闭包，不能仅凭当前文件没有 Qt include 就声称独立 |
| `Query.*` | QString、QDateTime、QRegularExpression 与搜索模型耦合 | 适配字符串、日期、语法与正则；用上游行为测试校对差异 |
| `Snapshot.*` | QDir/QFile/QSaveFile，另有 Windows 压缩 API | 保留格式设计/边界校验思路，改用项目受控存储与原子发布 |
| `IndexService`、`SearchEngine` | QObject/信号/定时器；混有全文、收藏、历史、网络等业务 | 只抽需要的调度规则，不把整套编排照搬进 application-runtime |
| QML 页面、启动器、插件体系 | 一整套独立产品 | 交互参考；ToolKnit 继续复用已有 UI、主题、导航、生命周期 |

源码链接：[FileIndex](https://github.com/LingCore/WinShun/blob/7e47148a8300bf019d969ad523ec8cbe3c7eae07/src/core/FileIndex.h)、[NameSearch](https://github.com/LingCore/WinShun/blob/7e47148a8300bf019d969ad523ec8cbe3c7eae07/src/core/NameSearch.cpp)、[Ntfs](https://github.com/LingCore/WinShun/blob/7e47148a8300bf019d969ad523ec8cbe3c7eae07/src/core/Ntfs.cpp)、[Query](https://github.com/LingCore/WinShun/blob/7e47148a8300bf019d969ad523ec8cbe3c7eae07/src/core/Query.h)、[Snapshot](https://github.com/LingCore/WinShun/blob/7e47148a8300bf019d969ad523ec8cbe3c7eae07/src/core/Snapshot.cpp)。

## 6. 深挖后需要保留或调整的细节

### 6.1 不能拆掉速度背后的内存契约

`findFoldedPadded` 明确允许读取字符串逻辑末尾之后最多 16 字节，配套 FileIndex 会实际分配并填充这段内存。直接把任意 Rust `&str` 指针交给它不安全。FFI 应使用有明确长度/容量的内部缓冲，或走不要求 padding 的函数；C++ 异常不能穿过 Rust ABI。

当前 SSE2 实现针对 x64；不能直接宣称这份实现同时适配 Windows ARM64。跨架构需要另外实现或选编译分支，并分别验证。

### 6.2 拼音功能有清楚的覆盖范围

当前表覆盖 U+4E00–U+9FFF，一字最多三个读音；查询至少两字符、最多 63 字符，允许首字母、全拼及音节前缀混用。能处理常见中文文件名，不代表完整汉字扩展区、所有人名读音或按上下文判断多音字。

中文直搜、纯数字、单字母等仍由普通字面匹配负责；不能误用拼音接口把它们全部当“不匹配”。原文高亮保留 UTF-16/UTF-8 单位映射，emoji 不能导致后续高亮错位。

### 6.3 紧凑大小和时间适合搜索列表，不宜代替文件事实

当前文件大小压成 float32 的位表示，约 16MB 以内精确，较大值有近似；时间使用秒级整数，另有对非常旧或异常未来日期的排序策略。这些是取舍，不是发现了崩溃漏洞。

ToolKnit 精确显示、导出清单或临界大小筛选需要读取真实文件属性/采用明确的精度规则。索引结果用于定位，执行操作前再次校验文件存在、类型、权限与大小，避免 stale path 和错误属性。

### 6.4 名为“查询”的函数有系统写入行为

`Ntfs.cpp::queryJournal` 在日志不存在时会以写权限打开卷并调用 `FSCTL_CREATE_USN_JOURNAL`。因此不能把它放在无副作用的“检测索引能力”路径里。

接入时区分只读查询与用户开启高速索引后的初始化：日常检测不改变卷配置；无日志、无管理员或服务被禁用时有目录遍历回退。SDK/代码复用本身不让 ToolKnit 获得绕过 UAC 的权限。

### 6.5 不整套复制高权限服务

Win顺 [服务构建文件](https://github.com/LingCore/WinShun/blob/7e47148a8300bf019d969ad523ec8cbe3c7eae07/src/service/CMakeLists.txt)说明服务本身不依赖 Qt，避免升级时服务占用 Qt DLL。但当前服务除索引外，还涉及 UIAccess 输入监听、对话框导航、剪贴板显示，以及全文索引使用的批量文件内容读取。

批量内容路径在源码中存在客户端 token 和 AccessCheck，不能因它是原始卷读取就未经验证宣布漏洞；不过这些能力不属于首版文件名搜索需要的范围。建议创建 ToolKnit 自己的最小元数据服务，只保留必要的 MFT/USN 读取、取消、版本握手和关闭。

需要保留的设计：限制管道帧大小、协议版本校验、连接限制、拒绝远程管道客户端、超时与取消、服务程序安全安装目录、真实卷身份以及断连恢复。还需决定同机多用户是否共享文件名可见范围；原始卷元数据枚举与读取文件内容是不同权限边界。

服务名、管道名、缓存目录、安装项、事件和日志全部独立命名，确保安装了 Win顺的用户不会被覆盖或卸载它的服务。ToolKnit 主程序保持普通权限；启用服务通常只需安装/配置阶段一次管理员授权，未授权时使用普通目录模式。

## 7. 接入方式比较

| 方案 | 优点 | 成本 | 判断 |
| --- | --- | --- | --- |
| 调用 Win顺整套程序/CLI | 前期接入快，保留原实现 | 外部安装、配置/服务生命周期、Qt 和全部依赖，需要协调两套程序 | 适合对照测试，不作为自包含工具的首选 |
| 保留其 Qt 核心，做无界面 worker | 改动算法较少 | Qt 运行库和 LGPL 分发、现有编排耦合仍需处理 | 可行的备选，不等于必须购买 Qt 商业许可 |
| 提取 C++ 核心、替换 Qt 适配 | 保留主要算法，避免第二套 GUI；可用现有 MSVC | 需要设计清晰接口并移植测试；搜索 worker/服务由我们维护 | **建议优先验证** |
| 全部重写为 Rust | 技术栈统一 | 开发周期更长，容易丢掉边界处理和性能特性；移植仍需保留上游归属 | 后续按模块评估，不作为启动前提 |

建议结构：Tauri 页面 → Rust 搜索任务管理 → 普通权限搜索 worker/受限原生接口；索引数据由普通目录枚举或可选的最小 NTFS 服务提供。是否将纯查询核心直接静态链接进 Rust 进程，以隔离故障、取消性能和部署测试决定。对原始文件系统数据的解析优先考虑独立进程边界。

跨语言接口使用定长整数、受限缓冲或版本化消息；不向 WebView 传整份索引，不让 JS 管理 C++ 指针，不用每次搜索启动一次短命进程。常驻 worker 的所有权、空闲退出、崩溃重启和任务 generation 由 Rust 统一管理。

## 8. 本次实际验证

固定提交的原始 `Pinyin.cpp`、`PinyinTable.cpp`、`TextUtil.cpp`、`Ntfs.cpp` 和相应头文件参与独立 MSVC x64 / C++20 Release 编译，保留未改动内容与许可。

本机执行结果：**29 passed，0 failed**。

覆盖：

- 全拼、首字母、音节混用、中文/数字混合名字、负例。
- emoji 前缀后的 UTF-16 匹配位置；扩展汉字范围和拼音查询长度限制。
- ASCII 大小写、扩展名通配、英文单词首字母、满足 padding 契约的 SSE2 匹配。
- 标准/4K/非法 NTFS 几何参数；有效及截断/稀疏运行列表、无效 MFT 记录、文件编号位提取。

没有执行原始卷扫描、读取私人文件、安装服务、修改注册表或启用监听。上游 `tst_core` / `tst_service` / `tst_querysyntax` 只阅读相关测试，没有宣称其整套 Qt 测试在本机通过。

研究材料位于被忽略的 `tmp/winshun-audit-20261103/`，含固定来源、许可、下载清单、源码、隔离测试入口和构建产物；不属于 ToolKnit 产品或未来默认随包内容。

## 9. 下一步验证与完成条件

用户决定实现后，建议分四包推进，不先铺完整界面：

1. **最小引擎**：提取索引/匹配/拼音，补 Qt 适配；用固定合成文件树验证结果集合、Top-K 排序、取消、编码及精确属性边界。维护源文件来源与修改清单。
2. **真实索引与恢复**：在明确的测试目录/卷上测首次扫描、重启增量、目录改名、硬链接、日志丢失、拔盘、权限不足；服务安装升级卸载单独验证，不覆盖既有 Win顺。
3. **ToolKnit 页面**：复用导航、输入样式、双主题、虚拟列表、快捷键冲突提示和输出/打开位置路径。文件动作通过既有适配，CLI/MCP 只开放明确范围的查询契约。
4. **同机对照与许可清单**：以相同范围、查询和输出上限对比 Win顺/Everything，分别测建索引、冷/暖查询、首屏、更新延迟、私有提交内存和工作集；检查每个随包依赖和第三方声明。

性能门槛先沿用规划书的已索引普通查询端到端 p95 ≤200ms 目标，并另外统计底层查询毫秒数。错误或遗漏结果不能通过缩小检索范围而隐瞒。复杂正则、海量命中、网络目录明确单列，不使用最快的一条查询代表全场景。

## 10. 对当前 V3.3 计划的影响

此前的 Everything 可选接入仍是可行备选，但用户倾向自带引擎后，Win顺已经成为值得优先验证的复用候选。**目前可以确认许可允许、部分核心可独立构建；还不能确认整体移植成本、真实稳定性和达到目标的速度。**

录音分析与截图优化计划不因本次选型讨论而自动变化。本轮不改工具数量、版本、功能代码和产品 changelog；Skill 已有第三方许可分层核验及最窄责任边界规则，专项发现留在本报告，避免追加冗长上下文。
